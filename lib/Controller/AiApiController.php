<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AiService;
use OCA\Knorke\Service\MetaService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * The AI tasks of a board for signed-in accounts (factory job 267, routes
 * 59–62). CSRF stays on; guests have no route here (accounts only). Order:
 * the body gate (JsonBody), the rights check (Access::forUser: a stranger
 * and an unknown board 404), then AiService (403 forbidden without the
 * right to edit, 403 ai_unavailable, 400, 409 ai_notice, 429 ai_limit).
 *
 *  59 GET    /api/v1/boards/{id}/ai              → AiService::state
 *  60 POST   /api/v1/boards/{id}/ai              {kind, ids, frame?, acceptNotice?} or (job 268) {kind: diagram, shape, prompt, acceptNotice?} → 202 {task}
 *  61 DELETE /api/v1/boards/{id}/ai?task=<id>    → {task, forgotten}
 *  62 PUT    /api/v1/boards/{id}/aiswitch        {allowed} → {"board": {title, meta, metaRev}, "now"} (owner)
 */
final class AiApiController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private AiService $ai,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 59: availability, notice, limit and this account's tasks on the board. */
    #[NoAdminRequired]
    public function index(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            $a = $this->access->forUser($id);
            return $this->json($this->ai->state($a->principal, $id, self::nowMs()));
        });
    }

    /** Route 60: start "Summarise", "Cluster by topic" or (job 268) a diagram from a prompt. */
    #[NoAdminRequired]
    public function start(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['kind', 'ids', 'frame', 'acceptNotice', 'shape', 'prompt']);
            $a = $this->access->forUser($id);
            return $this->json($this->ai->start($a->principal, $id, $body, self::nowMs()), 202);
        });
    }

    /** Route 61: cancel a running task or forget a finished one. */
    #[NoAdminRequired]
    public function cancel(int $id): Response {
        return $this->run(function () use ($id): Response {
            $q = JsonBody::query($this->request, ['task']);
            $a = $this->access->forUser($id);
            return $this->json($this->ai->forget($a->principal, $id, $q['task'] ?? null));
        });
    }

    /** Route 62: the board switch "Allow AI on this board" (owner only). */
    #[NoAdminRequired]
    public function allow(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['allowed']);
            $a = $this->access->forUser($id);
            $now = self::nowMs();
            return $this->raw(TagApiController::answer($this->ai->allow($a->principal, $id, $body['allowed'] ?? null, $now), $now));
        });
    }
}
