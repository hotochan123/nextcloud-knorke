<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\TagService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * The tag list of a board for signed-in users (factory job 191, route 44).
 * CSRF stays on. Order: the body gate (JsonBody: unknown key, route
 * override → 400), the rights check (Access::forUser: a stranger and an
 * unknown board 404), then TagService (403 forbidden without the right to
 * edit, 429 slow_down, 400, 409 tag_limit|tag_exists|tag_gone).
 *
 *  44 PUT /api/v1/boards/{id}/tags  {action: add, tags} | {action: update, tag, name?, color?} | {action: delete, tag}
 *     → {"board": {"title", "meta", "metaRev"}, "now"} (the answer of routes 22–26)
 */
final class TagApiController extends Controller {
    use ApiResponses;

    /** The body keys of routes 44 and 45. */
    public const BODY = ['action', 'tags', 'tag', 'name', 'color'];

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private Access $access,
        private TagService $tags,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 44: add, rename, recolour or delete tags. */
    #[NoAdminRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $body = JsonBody::read($this->request, self::BODY);
            $a = $this->access->forUser($id);
            return $this->raw(self::answer($this->tags->write($a->principal, $id, $body, $this->request->getRemoteAddress(), self::nowMs()), self::nowMs()));
        });
    }

    /** {"board": {"title", "meta", "metaRev"}, "now"}; meta a JSON object ({} when empty). */
    public static function answer(array $state, int $now): string {
        return '{"board":{"title":' . json_encode($state['title'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)
            . ',"meta":' . MetaService::json($state['meta']) . ',"metaRev":' . (int)$state['metaRev'] . '},"now":' . $now . '}';
    }
}
