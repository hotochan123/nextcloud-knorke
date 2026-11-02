<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\PublicTagController;
use OCA\Knorke\Controller\TagApiController;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Routes 44 and 45 (factory job 191, AK1) through both controllers on the
 * in-memory rights of AccessHarness: the answer {"board": {title, meta,
 * metaRev}, "now"} (meta {} when empty), strangers and unknown boards 404,
 * a guest token of another board 401, vote and view 403, the guest of the
 * edit link 200, route 45 without same-origin 403 cross_site, the body
 * gate (an unknown key, a route override through `id`: 400) and the
 * budget (429 slow_down with Retry-After).
 */
final class TagRoutesTest extends TestCase {
    private AccessHarness $h;
    private int $b;
    private int $other;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'Retro')['id'];
        $this->other = $this->h->service->create('alice', 'Other')['id'];
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'vic', 'vote');
    }

    private static function tid(int $n): string {
        return '01JA' . str_pad((string)$n, 22, '0', STR_PAD_LEFT);
    }

    private static function add(int $n, string $name): array {
        return ['action' => 'add', 'tags' => [['id' => self::tid($n), 'name' => $name, 'color' => '#f5d76e']]];
    }

    /** @param array<string, string> $headers */
    private function request(int $board, ?array $body = null, array $headers = []): IRequest {
        $route = ['id' => (string)$board, '_route' => 'x'];
        $params = array_merge($route, $body ?? []);
        $headers = array_change_key_case($headers + ['Content-Length' => '10'], CASE_LOWER);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => $headers[strtolower($name)] ?? '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'getRemoteAddress' => fn (): string => '10.0.0.9',
        ], ['urlParams' => $route]);
    }

    private function api(?string $uid, int $board, ?array $body = null): Response {
        $this->h->uid = $uid;
        return (new TagApiController($this->request($board, $body), Fake::of(LoggerInterface::class), $this->h->access, $this->h->tagService))->update($board);
    }

    private function pub(string $token, int $board, ?array $body = null, bool $xhr = true): Response {
        $headers = ['X-Knorke-Guest' => $token] + ($xhr ? ['X-Requested-With' => 'XMLHttpRequest'] : []);
        return (new PublicTagController($this->request($board, $body, $headers), Fake::of(LoggerInterface::class), $this->h->access, $this->h->tagService))->update($board);
    }

    /** @return array{0: int, 1: mixed} */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), json_decode($r->render(), true)];
    }

    /** [status, error code or null] */
    private static function code(Response $r): array {
        [$status, $data] = self::out($r);
        return [$status, $data['error'] ?? null];
    }

    public function testTheAnswerHasTheFormOfTheModerationRoutes(): void {
        $r = $this->api('alice', $this->b, self::add(1, 'Kosten'));
        $this->assertSame(200, $r->getStatus());
        $raw = $r->render();
        $this->assertMatchesRegularExpression('/^\{"board":\{"title":"Retro","meta":\{"tags":\[\{"id":"' . self::tid(1) . '","name":"Kosten","color":"#f5d76e"\}\]\},"metaRev":\d+\},"now":\d+\}$/', $raw);
        $data = json_decode($raw, true);
        $this->assertSame(['board', 'now'], array_keys($data));
        $this->assertSame(['title', 'meta', 'metaRev'], array_keys($data['board']));
        $rev = $data['board']['metaRev'];
        $this->assertSame($rev, $this->h->boards->boards[$this->b]['meta_rev']);
        $r = $this->api('alice', $this->b, ['action' => 'delete', 'tag' => self::tid(1)]);
        $this->assertStringContainsString('"meta":{}', $r->render(), 'an empty meta is {}');
        $this->assertSame($rev + 1, json_decode($r->render(), true)['board']['metaRev']);
        $r = $this->api('alice', $this->b, ['action' => 'delete', 'tag' => self::tid(1)]);
        $this->assertSame([200, $rev + 1], [$r->getStatus(), json_decode($r->render(), true)['board']['metaRev']], 'no effect: the same metaRev');
    }

    public function testWhoMayWrite(): void {
        $this->assertSame(200, $this->api('carol', $this->b, self::add(1, 'Edit share'))->getStatus());
        $edit = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        $this->assertSame(200, $this->pub($edit, $this->b, self::add(2, 'Edit guest'))->getStatus());
        $this->assertSame([403, 'forbidden'], self::code($this->api('bob', $this->b, self::add(3, 'View'))));
        $this->assertSame([403, 'forbidden'], self::code($this->api('vic', $this->b, self::add(4, 'Vote'))));
        $vote = $this->h->token($this->b, 1, 'vote', 'gVOTE0000001');
        $this->assertSame([403, 'forbidden'], self::code($this->pub($vote, $this->b, self::add(5, 'Vote guest'))));
        $this->assertSame([404, 'not_found'], self::code($this->api('dave', $this->b, self::add(6, 'Stranger'))), 'a stranger');
        $this->assertSame([404, 'not_found'], self::code($this->api('alice', 999, self::add(7, 'Gone'))), 'an unknown board');
        $foreign = $this->h->token($this->other, 1, 'edit', 'gEDIT0000001');
        $this->assertSame([401, 'guest_token'], self::code($this->pub($foreign, $this->b, self::add(8, 'Foreign'))), 'a guest token of another board');
        $this->assertSame(['Edit share', 'Edit guest'], array_column(json_decode((string)$this->h->boards->boards[$this->b]['meta'], true)['tags'], 'name'));
    }

    public function testTheGuardsOfTheRoutes(): void {
        $edit = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        $this->assertSame([403, 'cross_site'], self::code($this->pub($edit, $this->b, self::add(1, 'A'), false)), 'no same-origin');
        $this->assertSame([403, 'cross_site'], self::code($this->pub('nope', $this->b, self::add(1, 'A'), false)), 'before the token');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, self::add(1, 'A') + ['pid' => 'x'])), 'an unknown key');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['action' => 'delete', 'id' => self::tid(1)])), 'id would override the route');
        $this->assertSame([400, 'bad_request'], self::code($this->pub($edit, $this->b, ['action' => 'add', 'tags' => 'x'])));
        $this->assertSame([409, 'tag_gone'], self::code($this->api('alice', $this->b, ['action' => 'update', 'tag' => self::tid(1), 'name' => 'B'])));
        $this->assertNull($this->h->boards->boards[$this->b]['meta']);
    }

    public function testTheBudgetAnswers429(): void {
        $this->h->limiterFull = ['knorke-tags'];
        $r = $this->api('alice', $this->b, self::add(1, 'A'));
        [$status, $data] = self::out($r);
        $this->assertSame([429, 'slow_down', 1000], [$status, $data['error'], $data['retryMs']]);
        $headers = (new \ReflectionProperty(Response::class, 'headers'))->getValue($r);
        $this->assertSame('1', $headers['Retry-After'] ?? null);
        $edit = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        $this->assertSame([429, 'slow_down'], self::code($this->pub($edit, $this->b, self::add(1, 'A'))));
    }
}
