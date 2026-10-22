<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\Input;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\ModerationService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\VoteService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use Psr\Log\LoggerInterface;

/**
 * Moderation of a board: voting, timer, "Bring everyone here" (routes
 * 22–26, SPEC-M1 §4.1, §4.12). CSRF stays on; signed-in users only —
 * moderators are always accounts (§4.9), guests have no moderation routes.
 *
 * Order of every action: the body gate (JsonBody: unknown key, route
 * override → 400), the full rights check (a stranger 404, no ownership
 * oracle; a role without moderation — Principal::canModerate(), owner or
 * share role `moderate` — 403 forbidden), the budget `knorke-moderate`
 * (ILimiter, 120 per 600 s and moderator → 429 slow_down with retryMs
 * 5000), then the action (400 bad_request / vote_config, 409 vote_open /
 * vote_closed / timer_state). The client never repeats these routes on its
 * own, except the idempotent automatic `end` at endsAt (§4.12, R16).
 *
 * Every answer: {"board": {"title", "meta", "metaRev"}, "now": ms} — the
 * shape of the `board` block of the sync answer; the client merges it
 * through onMeta, everybody else gets it on the next tick. An action
 * without effect (DELETE summon without a summon, show/hide to the value it
 * has) writes nothing and answers the stored state (same metaRev).
 */
final class ModerationApiController extends Controller {
    use ApiResponses;

    /** ILimiter budget of the moderation routes (SPEC-M1 §4.1, §7.6). */
    public const MODERATE_LIMIT = 120;
    public const MODERATE_PERIOD = 600;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private VoteService $votes,
        private ModerationService $moderation,
        private IUserSession $userSession,
        private ILimiter $limiter,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 22 `POST /api/v1/boards/{id}/vote` {per, perItem, scope, types, minutes} (§4.12.1). */
    #[NoAdminRequired]
    public function startVote(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['per', 'perItem', 'scope', 'types', 'minutes']);
            $p = $this->moderator($id);
            return $this->answer($this->votes->start($p, $id, $body, self::nowMs()));
        });
    }

    /** Route 23 `PATCH /api/v1/boards/{id}/vote` {action, minutes?} (§4.12, §4.12.1). */
    #[NoAdminRequired]
    public function updateVote(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['action', 'minutes']);
            $p = $this->moderator($id);
            $action = $body['action'] ?? null;
            if (!is_string($action)) {
                throw new HttpError(400, 'bad_request', 'Unknown action.');
            }
            return $this->answer($this->votes->update($p, $id, $action, Input::whole($body['minutes'] ?? null), self::nowMs()));
        });
    }

    /** Route 24 `PUT /api/v1/boards/{id}/timer` {action, ms?} (§4.12.2). */
    #[NoAdminRequired]
    public function timer(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['action', 'ms']);
            $p = $this->moderator($id);
            return $this->answer($this->moderation->timer($p, $id, $body['action'] ?? null, $body['ms'] ?? null, self::nowMs()));
        });
    }

    /** Route 25 `POST /api/v1/boards/{id}/summon` {client} (§4.12.3). */
    #[NoAdminRequired]
    public function summon(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['client']);
            $p = $this->moderator($id);
            return $this->answer($this->moderation->summon($p, $id, $body['client'] ?? null, self::nowMs()));
        });
    }

    /** Route 26 `DELETE /api/v1/boards/{id}/summon` (§4.12.3; any moderator may end it). */
    #[NoAdminRequired]
    public function endSummon(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            $this->moderator($id);
            return $this->answer($this->moderation->endSummon($id, self::nowMs()));
        });
    }

    /**
     * The full rights check, then the budget: 404 (stranger), 403
     * forbidden (no moderation right), 429 slow_down.
     */
    private function moderator(int $board): Principal {
        [$a] = $this->access->forUserWithRow($board);
        $p = $a->principal;
        if (!$p->canModerate()) {
            throw new HttpError(403, 'forbidden');
        }
        $user = $this->userSession->getUser() ?? throw new HttpError(401, 'not_logged_in', 'Not logged in.');
        try {
            $this->limiter->registerUserRequest('knorke-moderate', self::MODERATE_LIMIT, self::MODERATE_PERIOD, $user);
        } catch (IRateLimitExceededException) {
            throw new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil(self::MODERATE_PERIOD * 1000 / self::MODERATE_LIMIT)]);
        }
        return $p;
    }

    /** {"board": {"title", "meta", "metaRev"}, "now"}; meta a JSON object ({} when empty). */
    private function answer(array $state): Response {
        return $this->raw('{"board":{"title":' . json_encode($state['title'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)
            . ',"meta":' . MetaService::json($state['meta']) . ',"metaRev":' . (int)$state['metaRev'] . '},"now":' . self::nowMs() . '}');
    }
}
