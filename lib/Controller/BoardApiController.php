<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\Input;
use OCA\Knorke\Service\Limits;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use Psr\Log\LoggerInterface;

/**
 * Board list, board CRUD, the edit link and joining a link as a signed-in
 * user (routes 5–11, SPEC-M0 §4.1, §4.3), and the voting link (routes
 * 17/18, SPEC-M1 §4.1, §4.11). CSRF stays on. Body fields are never method
 * parameters: JsonBody reads them (the frozen key lists of SPEC-M1 §4.1),
 * BoardService checks their values.
 *
 * Link routes (SPEC-M1 §4.11): body {rotate?, password?, expiresAt?:
 * "YYYY-MM-DD"|null}; the answer is {"link": Link} with the Link form of
 * §4.4 (token, role, url, password, expiresAt, expiresOn), DELETE {"link":
 * null}. Owner only (member 403, stranger 404).
 *
 * Link throttle (P7, SPEC-M1 §33.1 d): every POST and DELETE of routes 9,
 * 10, 17 and 18 counts in the ILimiter budget `knorke-link` (app config
 * link_limit, default 20, per account and 600 s) right AFTER the owner check
 * (BoardService::requireLinkOwner, step 1 of §4.11.2) and before anything
 * else: members and strangers spend nothing; a call that then ends with
 * sharing_disabled, links_disabled, a 400 or an unchanged link has counted,
 * and the password hashing always lies behind it.
 * Over it → 429 slow_down {retryMs = ceil(600000 / link_limit)} with
 * Retry-After, nothing written. Reading (route 19, the snapshot) is never
 * throttled.
 */
final class BoardApiController extends Controller {
    use ApiResponses;

    /** Body keys of routes 9 and 17 (SPEC-M1 §4.1). */
    private const LINK_BODY = ['rotate', 'password', 'expiresAt'];

    public function __construct(
        IRequest $request,
        private BoardService $boards,
        private IUserSession $userSession,
        private ILimiter $limiter,
        private Limits $limits,
        private LoggerInterface $logger,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 5 `GET /api/v1/boards` → {"boards": [Board, …]}. */
    #[NoAdminRequired]
    public function index(): Response {
        return $this->run(fn (): Response => $this->json(['boards' => $this->boards->listFor($this->user()->getUID())]));
    }

    /** Route 6 `POST /api/v1/boards` {"title"} → 201 {"board": Board}. */
    #[NoAdminRequired]
    public function create(): Response {
        return $this->run(function (): Response {
            $body = JsonBody::read($this->request, ['title']);
            $user = $this->user();
            try {
                $this->limiter->registerUserRequest('knorke-create', $this->limits->createPer10Min(), 600, $user);
            } catch (IRateLimitExceededException) {
                throw new HttpError(429, 'rate_limited');
            }
            $board = $this->boards->create($user->getUID(), self::text($body['title'] ?? null));
            return $this->json(['board' => $board], 201);
        });
    }

    /**
     * Route 7 `PATCH /api/v1/boards/{id}` {"title"} → {"board": Board + {meta, metaRev}};
     * owner only. meta/metaRev come from the meta write (SPEC-M1 §15, additive).
     */
    #[NoAdminRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['title']);
            return $this->json(['board' => $this->boards->rename($this->user()->getUID(), $id, self::text($body['title'] ?? null))]);
        });
    }

    /** Route 8 `DELETE /api/v1/boards/{id}` → {"deleted": true}; owner only. */
    #[NoAdminRequired]
    public function destroy(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            $this->boards->delete($this->user()->getUID(), $id);
            return $this->json(['deleted' => true]);
        });
    }

    /** Route 9 `POST /api/v1/boards/{id}/link` {rotate?, password?, expiresAt?} → {"link": Link}; owner only. */
    #[NoAdminRequired]
    public function enableLink(int $id): Response {
        return $this->run(fn (): Response => $this->linkOn($id, 'edit'));
    }

    /** Route 10 `DELETE /api/v1/boards/{id}/link` → {"link": null}; owner only. */
    #[NoAdminRequired]
    public function disableLink(int $id): Response {
        return $this->run(fn (): Response => $this->linkOff($id, 'edit'));
    }

    /**
     * Route 11 `POST /api/v1/links/{token}/join` {password?} → {"boardId": 7}: an account opens an
     * edit or voting link (SPEC-M1 §4.11.4); the password only when the link has one.
     */
    #[NoAdminRequired]
    public function joinLink(#[\SensitiveParameter] string $token): Response {
        return $this->run(function () use ($token): Response {
            $body = JsonBody::read($this->request, ['password']);
            $password = $body['password'] ?? null;
            if ($password !== null && !is_string($password)) {
                throw new HttpError(400, 'bad_request', 'password must be text.');
            }
            $user = $this->user();
            try {
                $this->limiter->registerUserRequest('knorke-linkjoin', 60, 600, $user);
            } catch (IRateLimitExceededException) {
                throw new HttpError(429, 'rate_limited');
            }
            return $this->json(['boardId' => $this->boards->joinLinkAsUser($user->getUID(), $token, $password)]);
        });
    }

    /**
     * Route 17 `POST /api/v1/boards/{id}/votelink` {rotate?, password?, expiresAt?} → {"link": Link};
     * owner only (SPEC-M1 §4.11.1): the voting link, its own generation vote_link_gen.
     */
    #[NoAdminRequired]
    public function enableVoteLink(int $id): Response {
        return $this->run(fn (): Response => $this->linkOn($id, 'vote'));
    }

    /** Route 18 `DELETE /api/v1/boards/{id}/votelink` → {"link": null}; owner only (SPEC-M1 §4.11.1). */
    #[NoAdminRequired]
    public function disableVoteLink(int $id): Response {
        return $this->run(fn (): Response => $this->linkOff($id, 'vote'));
    }

    private function linkOn(int $id, string $role): Response {
        $body = JsonBody::read($this->request, self::LINK_BODY);
        $user = $this->user();
        $this->boards->requireLinkOwner($user->getUID(), $id);
        $this->throttleLink($user);
        return $this->json(['link' => $this->boards->enableLink($user->getUID(), $id, $role, $body)]);
    }

    private function linkOff(int $id, string $role): Response {
        JsonBody::guardRoute($this->request);
        $user = $this->user();
        $this->boards->requireLinkOwner($user->getUID(), $id);
        $this->throttleLink($user);
        $this->boards->disableLink($user->getUID(), $id, $role);
        return $this->json(['link' => null]);
    }

    /** One writing link call of $user (§33.1 d): ILimiter knorke-link, link_limit per 600 s → 429 slow_down. */
    private function throttleLink(IUser $user): void {
        $limit = $this->limits->linkLimit();
        try {
            $this->limiter->registerUserRequest('knorke-link', $limit, Limits::LINK_PERIOD, $user);
        } catch (IRateLimitExceededException) {
            throw new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil(Limits::LINK_PERIOD * 1000 / $limit)]);
        }
    }

    private function user(): IUser {
        return $this->userSession->getUser() ?? throw new HttpError(401, 'not_logged_in', 'Not logged in.');
    }

    /** A title field: text, or '' for anything that is not (→ title_required). */
    private static function text(mixed $v): string {
        return is_string($v) ? $v : Input::str($v);
    }
}
