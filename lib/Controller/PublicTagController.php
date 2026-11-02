<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\TagService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * The tag list of a board for guests (factory job 191, route 45), with the
 * signed guest token in `X-Knorke-Guest` (the checks of the sync: 401
 * guest_token, 403 link_revoked / links_disabled, 404). #[NoCSRFRequired]
 * switches Nextcloud's CSRF check off, so the write runs refuseCrossSite()
 * first (403 cross_site). Then as TagApiController: only guests of the edit
 * link may write (TagService: canEdit, else 403 forbidden), the budget
 * knorke-tags counts per IP.
 *
 *  45 PUT /pub/v1/boards/{id}/tags
 */
final class PublicTagController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private TagService $tags,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 45: add, rename, recolour or delete tags. */
    #[PublicPage]
    #[NoCSRFRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $this->refuseCrossSite();
            $body = JsonBody::read($this->request, TagApiController::BODY);
            $a = $this->access->forGuest($this->request->getHeader(PublicSyncController::GUEST_HEADER), $id);
            return $this->raw(TagApiController::answer($this->tags->write($a->principal, $id, $body, $this->request->getRemoteAddress(), self::nowMs()), self::nowMs()));
        });
    }
}
