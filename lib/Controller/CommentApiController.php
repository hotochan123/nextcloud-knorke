<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\CommentService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Comments of signed-in users (factory job 189, routes 35–39). CSRF stays
 * on. Order of every action: the body or query gate (JsonBody: unknown key,
 * route override → 400), the rights check (Access::forUser: a stranger and
 * an unknown board 404), then CommentService (403 forbidden, 429 slow_down,
 * 400, 404 not_found for a comment id of another board, 409).
 *
 *  35 GET    /api/v1/boards/{id}/comments            → {threads}
 *  36 POST   /api/v1/boards/{id}/comments            {text, thread} | {text, x, y, item?} → 201 {thread}
 *  37 PATCH  /api/v1/boards/{id}/comments            {comment, text | resolved | x, y} → {thread}
 *  38 DELETE /api/v1/boards/{id}/comments?comment=   → {deleted: [ids]}
 *  39 GET    /api/v1/boards/{id}/mentions?q=         → {accounts: [{id, name}]}
 */
final class CommentApiController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private CommentService $comments,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 35: the threads of the board, every role. */
    #[NoAdminRequired]
    public function index(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::query($this->request, []);
            $a = $this->access->forUser($id);
            return $this->json($this->comments->threads($a->principal, $id));
        });
    }

    /** Route 36: a new thread or a reply. */
    #[NoAdminRequired]
    public function create(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['text', 'thread', 'x', 'y', 'item', 'node']);
            $a = $this->access->forUser($id);
            return $this->json($this->comments->create($a->principal, $id, $body, $this->request->getRemoteAddress(), self::nowMs()), 201);
        });
    }

    /** Route 37: edit, resolve/reopen, or the spot of a thread on an item. */
    #[NoAdminRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, ['comment', 'text', 'resolved', 'x', 'y']);
            $a = $this->access->forUser($id);
            return $this->json($this->comments->update($a->principal, $id, $body, $this->request->getRemoteAddress(), self::nowMs()));
        });
    }

    /** Route 38 `?comment=<id>`: delete a comment (the first one takes its thread). */
    #[NoAdminRequired]
    public function destroy(int $id): Response {
        return $this->run(function () use ($id): Response {
            $q = JsonBody::query($this->request, ['comment']);
            $a = $this->access->forUser($id);
            return $this->json($this->comments->delete($a->principal, $id, $q['comment'] ?? null, $this->request->getRemoteAddress(), self::nowMs()));
        });
    }

    /** Route 39 `?q=`: the accounts the @ list offers (accounts with the right to write). */
    #[NoAdminRequired]
    public function mentions(int $id): Response {
        return $this->run(function () use ($id): Response {
            $q = JsonBody::query($this->request, ['q']);
            $a = $this->access->forUser($id);
            return $this->json($this->comments->mentionable($a->principal, $id, $q['q'] ?? ''));
        });
    }
}
