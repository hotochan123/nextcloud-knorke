<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\BoardApiController;
use OCA\Knorke\Controller\ShareApiController;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IAppConfig;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * The link throttle (P7, SPEC-M1 §33.1 d, AUTHZ-3; C80 in small): every
 * POST and DELETE of routes 9, 10, 17 and 18 counts in the ILimiter budget
 * knorke-link (app config link_limit, default 20, per account and 600 s)
 * AFTER the owner check and before step 2 — a stranger (404) or a member
 * (403) spends nothing; a call that then ends with 400, an unchanged answer
 * or "no link" has counted. Over it → 429 slow_down {retryMs = ceil(600000 /
 * link_limit)} with Retry-After, nothing written. Route 19 is never
 * throttled. The limiter here counts like Nextcloud's (per identifier and
 * account, refuses once the limit is reached).
 */
final class LinkLimitTest extends TestCase {
    private AccessHarness $h;
    private int $b;
    /** @var array<string, int> "<id> <uid>" → calls */
    private array $counts = [];
    /** @var list<string> */
    private array $calls = [];
    /** @var array<string, int> app config of the Limits (getValueInt) */
    private array $app = [];

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'A')['id'];
    }

    private function request(array $route, ?array $body = null): IRequest {
        $params = array_merge($route, $body ?? []);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? '10' : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'getRemoteAddress' => fn (): string => '10.0.0.1',
        ], ['urlParams' => $route]);
    }

    private function limiter(): ILimiter {
        return Fake::of(ILimiter::class, ['registerUserRequest' => function (string $id, int $limit, int $period, IUser $user): void {
            $this->calls[] = "$id $limit $period " . $user->getUID();
            $k = $id . ' ' . $user->getUID();
            if (($this->counts[$k] ?? 0) >= $limit) {
                throw new class('limited') extends \RuntimeException implements IRateLimitExceededException {
                };
            }
            $this->counts[$k] = ($this->counts[$k] ?? 0) + 1;
        }]);
    }

    private function api(?array $body = null): BoardApiController {
        $session = Fake::of(IUserSession::class, ['getUser' => fn () => $this->h->uid === null ? null : $this->h->user($this->h->uid)]);
        $limits = new Limits(Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $a, string $k, int $d = 0, ?bool $lazy = false): int => $this->app[$k] ?? $d,
        ]));
        return new BoardApiController($this->request(['id' => (string)$this->b], $body), $this->h->service, $session, $this->limiter(), $limits, Fake::of(LoggerInterface::class));
    }

    /** @return array{0: int, 1: mixed} */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), $r->getData()];
    }

    private static function header(Response $r, string $name): ?string {
        $p = new \ReflectionProperty(Response::class, 'headers');
        return $p->getValue($r)[$name] ?? null;
    }

    private function linkCalls(): array {
        return array_values(array_filter($this->calls, static fn (string $c): bool => str_starts_with($c, 'knorke-link ')));
    }

    public function testStrangersAndMembersSpendNothing(): void {
        // C80 (a): a stranger gets 404 every time, never 429; then its own board → 200.
        $this->h->uid = 'bob';
        for ($i = 0; $i < 25; $i++) {
            $this->assertSame(404, self::out($this->api([])->enableLink($this->b))[0], "stranger call $i");
        }
        $this->assertSame([404, 404, 404], [
            self::out($this->api()->disableLink($this->b))[0],
            self::out($this->api([])->enableVoteLink($this->b))[0],
            self::out($this->api()->disableVoteLink($this->b))[0],
        ]);
        $this->assertSame([], $this->linkCalls(), 'nothing counted before the owner check');
        $own = $this->h->service->create('bob', 'B')['id'];
        $this->b = $own;
        $this->assertSame(200, self::out($this->api([])->enableLink($own))[0], 'bob on his own board');
        $this->assertSame(['knorke-link 20 600 bob'], $this->linkCalls());
        // A member (share edit) of alice's board: 403, not counted either.
        $this->calls = [];
        $this->b = 1;
        $this->h->shareRows->add(1, 'user', 'carol', 'edit');
        $this->h->uid = 'carol';
        $this->assertSame([403, 'forbidden'], [self::out($this->api([])->enableLink(1))[0], self::out($this->api([])->enableLink(1))[1]['error']]);
        $this->assertSame(403, self::out($this->api()->disableVoteLink(1))[0]);
        $this->assertSame([], $this->linkCalls());
    }

    public function testTheTwentyFirstWritingCallIsRefused(): void {
        // C80 (b): 20 writing calls mixed over routes 9, 10, 17, 18 → 200; the 21st (route 9) → 429.
        $this->h->uid = 'alice';
        $api = fn (?array $body = null): BoardApiController => $this->api($body);
        $calls = [
            fn () => $api([])->enableLink($this->b),
            fn () => $api([])->enableVoteLink($this->b),
            fn () => $api(['rotate' => true])->enableLink($this->b),
            fn () => $api()->disableVoteLink($this->b),
            fn () => $api()->disableLink($this->b),
        ];
        for ($i = 0; $i < 20; $i++) {
            $this->assertSame(200, self::out(($calls[$i % 5])())[0], "writing call " . ($i + 1));
        }
        $this->assertSame(array_fill(0, 20, 'knorke-link 20 600 alice'), $this->linkCalls());
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $before = $this->h->boards->activeLinkOf($this->b, 'edit');
        $r = $this->api(['rotate' => true])->enableLink($this->b);
        $this->assertSame([429, ['error' => 'slow_down', 'message' => 'Too many requests, please wait a moment.', 'retryMs' => 30000]], self::out($r));
        $this->assertSame('30', self::header($r, 'Retry-After'));
        $this->assertSame($before, $this->h->boards->activeLinkOf($this->b, 'edit'), 'nothing written: the link row is unchanged');
        $this->assertSame(429, self::out($this->api()->disableLink($this->b))[0], 'DELETE is throttled too');
        $this->assertSame($before, $this->h->boards->activeLinkOf($this->b, 'edit'));
        // C80 (c): reading is never throttled.
        $this->calls = [];
        $session = Fake::of(IUserSession::class, ['getUser' => fn () => $this->h->user('alice')]);
        $shares = new ShareApiController($this->request(['id' => (string)$this->b]), Fake::of(LoggerInterface::class), $this->h->access, $this->h->shares,
            $this->h->service, $this->h->sharePolicy, $session, $this->limiter());
        for ($i = 0; $i < 3; $i++) {
            $this->assertSame(200, self::out($shares->index($this->b))[0]);
        }
        $this->assertSame([], $this->linkCalls(), 'GET shares does not count');
    }

    public function testCountedAfterTheOwnerCheckWhateverFollows(): void {
        // Unchanged POST (SRV-12), DELETE without a link, a 400 of the body
        // values and links_disabled all count; a JsonBody 400 (unknown key,
        // before the owner check) does not.
        $this->h->uid = 'alice';
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->assertSame(200, self::out($this->api([])->enableLink($this->b))[0], 'unchanged');
        $this->assertSame(200, self::out($this->api()->disableVoteLink($this->b))[0], 'no voting link: nothing to do');
        $this->assertSame([400, 'bad_request'], [self::out($this->api(['password' => 5])->enableLink($this->b))[0], 'bad_request']);
        $this->h->linksAllowed['alice'] = false;
        $this->assertSame([403, 'links_disabled'], [self::out($this->api([])->enableVoteLink($this->b))[0], self::out($this->api([])->enableVoteLink($this->b))[1]['error']]);
        $this->assertCount(5, $this->linkCalls(), '5 calls after the owner check (the last line called twice)');
        $this->assertSame(400, self::out($this->api(['name' => 'x'])->enableLink($this->b))[0], 'unknown body key');
        $this->assertCount(5, $this->linkCalls(), 'refused by JsonBody before the owner check: not counted');
    }

    public function testLinkLimitFromTheAppConfig(): void {
        $this->app = ['link_limit' => 3];
        $this->h->uid = 'alice';
        for ($i = 0; $i < 3; $i++) {
            $this->assertSame(200, self::out($this->api([])->enableLink($this->b))[0]);
        }
        $r = $this->api([])->enableLink($this->b);
        $this->assertSame([429, 200000], [self::out($r)[0], self::out($r)[1]['retryMs']], 'retryMs = ceil(600000 / 3)');
        $this->assertSame('200', self::header($r, 'Retry-After'));
        $this->assertSame('knorke-link 3 600 alice', $this->linkCalls()[0]);
        // 0 is not "off": the default 20 applies.
        $this->app = ['link_limit' => 0];
        $this->counts = [];
        $this->calls = [];
        $this->assertSame(200, self::out($this->api([])->enableLink($this->b))[0]);
        $this->assertSame(['knorke-link 20 600 alice'], $this->linkCalls());
    }
}
