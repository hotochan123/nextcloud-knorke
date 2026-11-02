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
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Comments of guests (factory job 189, routes 40–43), with the signed guest
 * token in `X-Knorke-Guest` (the checks of the sync: 401 guest_token, 403
 * link_revoked / links_disabled, 404). #[NoCSRFRequired] switches
 * Nextcloud's CSRF check off, so every write runs refuseCrossSite() first
 * (403 cross_site). Then the same as CommentApiController: guests of both
 * links write (canVote), never mention and never see a uid.
 *
 *  40 GET    /pub/v1/boards/{id}/comments
 *  41 POST   /pub/v1/boards/{id}/comments
 *  42 PATCH  /pub/v1/boards/{id}/comments
 *  43 DELETE /pub/v1/boards/{id}/comments?comment=
 */
final class PublicCommentController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private CommentService $comments,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 40: the threads of the board; after the token check the guest's list throttle (factory job 251). */
    #[PublicPage]
    #[NoCSRFRequired]
    public function index(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::query($this->request, []);
            $a = $this->access->forGuest($this->request->getHeader(PublicSyncController::GUEST_HEADER), $id);
            $this->access->throttleGuestComments($a->principal, $this->request->getRemoteAddress());
            return $this->json($this->comments->threads($a->principal, $id));
        });
    }

    /** Route 41: a new thread or a reply. */
    #[PublicPage]
    #[NoCSRFRequired]
    public function create(int $id): Response {
        return $this->run(function () use ($id): Response {
            $this->refuseCrossSite();
            $body = JsonBody::read($this->request, ['text', 'thread', 'x', 'y', 'item', 'node']);
            $a = $this->access->forGuest($this->request->getHeader(PublicSyncController::GUEST_HEADER), $id);
            return $this->json($this->comments->create($a->principal, $id, $body, $this->request->getRemoteAddress(), self::nowMs()), 201);
        });
    }

    /** Route 42: edit (own comments), resolve/reopen, the spot. */
    #[PublicPage]
    #[NoCSRFRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $this->refuseCrossSite();
            $body = JsonBody::read($this->request, ['comment', 'text', 'resolved', 'x', 'y']);
            $a = $this->access->forGuest($this->request->getHeader(PublicSyncController::GUEST_HEADER), $id);
            return $this->json($this->comments->update($a->principal, $id, $body, $this->request->getRemoteAddress(), self::nowMs()));
        });
    }

    /** Route 43 `?comment=<id>`: delete an own comment. */
    #[PublicPage]
    #[NoCSRFRequired]
    public function destroy(int $id): Response {
        return $this->run(function () use ($id): Response {
            $this->refuseCrossSite();
            $q = JsonBody::query($this->request, ['comment']);
            $a = $this->access->forGuest($this->request->getHeader(PublicSyncController::GUEST_HEADER), $id);
            return $this->json($this->comments->delete($a->principal, $id, $q['comment'] ?? null, $this->request->getRemoteAddress(), self::nowMs()));
        });
    }
}
