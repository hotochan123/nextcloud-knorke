<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use Psr\Log\LoggerInterface;

/**
 * Explicit shares of a board (routes 19–21, SPEC-M1 §4.1, §4.10). CSRF stays
 * on; signed-in users only. Who may do what comes from the full rights
 * check (Access::forUserWithRow): a stranger is 404 everywhere (no
 * ownership oracle); the owner gets everything; a moderator (share role
 * moderate) reads only the links on route 19 (lesson of CVE-2025-66513);
 * every other member is 403 forbidden.
 *
 * Budgets (ILimiter per owner; 429 slow_down with retryMs = period/limit):
 * route 20 knorke-share 30/600 s plus knorke-share-new 60/600 s per new
 * recipient (inside ShareService::save, R13 order), route 21
 * knorke-sharees 60/60 s. Route 21 reads its query `q` through
 * JsonBody::query (never `shareType`, which switches the Circles search
 * plugin to its expensive mode).
 */
final class ShareApiController extends Controller {
    use ApiResponses;

    public const SHARE_LIMIT = 30;
    public const SHARE_PERIOD = 600;
    public const SHAREES_LIMIT = 60;
    public const SHAREES_PERIOD = 60;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private ShareService $shares,
        private BoardService $boards,
        private SharePolicy $policy,
        private IUserSession $userSession,
        private ILimiter $limiter,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * Route 19 `GET /api/v1/boards/{id}/shares` → owner: {shares, policy,
     * links, linksAllowed, linkPolicy (+ today, R14)}; moderators: {"links": …}
     * only (§4.10.1).
     */
    #[NoAdminRequired]
    public function index(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            [$p, $row] = $this->principal($id);
            if ($p->role === Role::Owner) {
                return $this->json($this->ownerView($id, (string)$row['owner']));
            }
            if ($p->canModerate()) {
                return $this->json(['links' => $this->boards->links($id, (string)$row['owner'])]);
            }
            throw new HttpError(403, 'forbidden');
        });
    }

    /** Route 20 `PUT /api/v1/boards/{id}/shares` {"shares": [{kind, id, role}, …]} → like GET; owner only (§4.10.2). */
    #[NoAdminRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['shares']);
            $owner = $this->requireOwner($id);
            $this->charge('knorke-share', self::SHARE_LIMIT, self::SHARE_PERIOD);
            $shares = $body['shares'] ?? null;
            if (!is_array($shares)) {
                throw new HttpError(400, 'bad_request', 'shares must be a list.');
            }
            return $this->json($this->ownerView($id, $owner, $this->shares->save($owner, $id, $shares)));
        });
    }

    /** Route 21 `GET /api/v1/boards/{id}/sharees?q=<term>` → {sharees, more}; owner only (§4.10.3). */
    #[NoAdminRequired]
    public function sharees(int $id): Response {
        return $this->run(function () use ($id): Response {
            $query = JsonBody::query($this->request, ['q']);
            $owner = $this->requireOwner($id);
            $this->charge('knorke-sharees', self::SHAREES_LIMIT, self::SHAREES_PERIOD);
            return $this->json($this->shares->sharees($owner, $id, $query['q'] ?? ''));
        });
    }

    /**
     * {shares, policy, links, linksAllowed, linkPolicy} in the order of
     * §4.10.1. linkPolicy carries the additive `today` (R14-04): today in the
     * OWNER's zone (LinkSecrets::today/ownerZone), so the share dialog
     * computes its defaults and checks with the server's day. Only here (REST,
     * owner); the snapshot's board.linkPolicy stays without it.
     */
    private function ownerView(int $board, string $owner, ?array $list = null): array {
        $out = $list ?? $this->shares->list($owner, $board);
        $out['links'] = $this->boards->links($board, $owner);
        $out['linksAllowed'] = $this->boards->linksAllowed($owner);
        $out['linkPolicy'] = $this->policy->linkPolicy();
        $out['linkPolicy']['today'] = $this->boards->linkToday($owner);
        return $out;
    }

    /** @return array{0: Principal, 1: array} the full check (404 for strangers) */
    private function principal(int $board): array {
        [$a, $row] = $this->access->forUserWithRow($board);
        return [$a->principal, $row];
    }

    /** The owner's uid, else 403 (member) / 404 (stranger). */
    private function requireOwner(int $board): string {
        [$p] = $this->principal($board);
        if ($p->role !== Role::Owner || $p->uid === null) {
            throw new HttpError(403, 'forbidden');
        }
        return $p->uid;
    }

    /** @throws HttpError 429 slow_down with retryMs = ceil(period · 1000 / limit) (§4.2) */
    private function charge(string $id, int $limit, int $period): void {
        $user = $this->userSession->getUser() ?? throw new HttpError(401, 'not_logged_in', 'Not logged in.');
        try {
            $this->limiter->registerUserRequest($id, $limit, $period, $user);
        } catch (IRateLimitExceededException) {
            throw new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil($period * 1000 / $limit)]);
        }
    }
}
