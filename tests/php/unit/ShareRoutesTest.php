<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\BoardApiController;
use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Controller\PublicPageController;
use OCA\Knorke\Controller\ShareApiController;
use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Services\IInitialState;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Security\Bruteforce\IThrottler;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Routes 9/10/11 and 17–21 (SPEC-M1 §4.1, §4.10, §4.11) end to end on the
 * in-memory services: who gets what on route 19, the route budgets of 20
 * and 21 (429 slow_down with retryMs = period/limit and Retry-After), the
 * query gate of 21, the voting link routes, and /p/{token} with expired
 * and linkInfo (§4.11.3).
 */
final class ShareRoutesTest extends TestCase {
    private AccessHarness $h;
    private int $b;
    /** @var list<string> */
    private array $limited = [];
    /** @var list<string> */
    private array $limiterCalls = [];

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'A')['id'];
    }

    private function request(array $route, ?array $body = null, array $query = []): IRequest {
        $params = array_merge($query, $route, $body ?? []);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? '10' : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'getRemoteAddress' => fn (): string => '10.0.0.1',
        ], ['urlParams' => $route]);
    }

    private function limiter(): ILimiter {
        return Fake::of(ILimiter::class, ['registerUserRequest' => function (string $id, int $limit, int $period, IUser $user): void {
            $this->limiterCalls[] = "$id $limit $period " . $user->getUID();
            if (in_array($id, $this->limited, true)) {
                throw new class('limited') extends \RuntimeException implements IRateLimitExceededException {
                };
            }
        }]);
    }

    private function session(): IUserSession {
        return Fake::of(IUserSession::class, ['getUser' => fn () => $this->h->uid === null ? null : $this->h->user($this->h->uid)]);
    }

    private function shareApi(IRequest $r): ShareApiController {
        return new ShareApiController($r, Fake::of(LoggerInterface::class), $this->h->access, $this->h->shares, $this->h->service,
            $this->h->sharePolicy, $this->session(), $this->limiter());
    }

    private function boardApi(IRequest $r): BoardApiController {
        return new BoardApiController($r, $this->h->service, $this->session(), $this->limiter(), PageControllerTest::limits(), Fake::of(LoggerInterface::class));
    }

    /** A header set by the controller (Response::getHeaders() needs the server). */
    private static function header(Response $r, string $name): ?string {
        $p = new \ReflectionProperty(Response::class, 'headers');
        return $p->getValue($r)[$name] ?? null;
    }

    /** @return array{0: int, 1: mixed} [status, data] */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), $r->getData()];
    }

    public function testRoute19WhoGetsWhat(): void {
        $route = ['id' => (string)$this->b];
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        [$status, $data] = self::out($this->shareApi($this->request($route))->index($this->b));
        $this->assertSame(200, $status);
        $this->assertSame(['shares', 'policy', 'links', 'linksAllowed', 'linkPolicy'], array_keys($data));
        $this->assertSame(['edit', 'vote'], array_keys($data['links']));
        $this->assertNull($data['links']['vote']);
        $this->assertSame(['passwordEnforced', 'expireDefaultDays', 'expireEnforced', 'expireMaxDays', 'today'], array_keys($data['linkPolicy']), 'R14-04: today added');
        $this->assertSame('2025-10-09', $data['linkPolicy']['today']);
        // A moderator: only the links (CVE-2025-66513).
        $this->h->shareRows->add($this->b, 'user', 'bob', 'moderate');
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->uid = 'bob';
        [$status, $data] = self::out($this->shareApi($this->request($route))->index($this->b));
        $this->assertSame([200, ['links']], [$status, array_keys($data)]);
        $this->assertSame($this->h->service->links($this->b, 'alice'), $data['links']);
        $this->h->uid = 'carol';
        $this->assertSame([403, 'forbidden'], [self::out($this->shareApi($this->request($route))->index($this->b))[0], self::out($this->shareApi($this->request($route))->index($this->b))[1]['error']]);
        $this->h->uid = 'erin';
        $this->assertSame(404, self::out($this->shareApi($this->request($route))->index($this->b))[0]);
        // Moderators may not change anything.
        $this->h->uid = 'bob';
        $this->assertSame(403, self::out($this->shareApi($this->request($route, ['shares' => []]))->update($this->b))[0]);
        $this->assertSame(403, self::out($this->shareApi($this->request($route, null, ['q' => 'bo']))->sharees($this->b))[0]);
        $this->assertSame(403, self::out($this->boardApi($this->request($route, []))->enableVoteLink($this->b))[0]);
        $this->assertSame([], $this->limiterCalls, 'no budget charged for refused callers');
    }

    public function testRoute20BudgetAndAnswer(): void {
        $route = ['id' => (string)$this->b];
        [$status, $data] = self::out($this->shareApi($this->request($route, ['shares' => [['kind' => 'user', 'id' => 'bob', 'role' => 'moderate']]]))->update($this->b));
        $this->assertSame(200, $status);
        $this->assertSame(['shares', 'policy', 'links', 'linksAllowed', 'linkPolicy'], array_keys($data), 'like GET');
        $this->assertSame('2025-10-09', $data['linkPolicy']['today'] ?? null, 'like GET, with today (R14-04)');
        $this->assertSame('moderate', $data['shares'][0]['role']);
        $this->assertSame(['knorke-share 30 600 alice'], $this->limiterCalls, 'the route budget in the controller');
        $this->assertSame(['knorke-share-new 60 600 alice'], $this->h->limiterCalls, 'one charge per new recipient in ShareService (R13)');
        $this->limited = ['knorke-share'];
        $r = $this->shareApi($this->request($route, ['shares' => []]))->update($this->b);
        $this->assertSame([429, 'slow_down', 20000], [$r->getStatus(), $r->getData()['error'], $r->getData()['retryMs']]);
        $this->assertSame('20', self::header($r, 'Retry-After'));
        $this->assertSame(['user:bob=moderate'], $this->h->shareRows->of($this->b), 'nothing changed');
        $this->limited = [];
        foreach ([['shares' => 'x'], ['shares' => [['kind' => 'user']]], ['other' => 1]] as $body) {
            $this->assertSame(400, self::out($this->shareApi($this->request($route, $body))->update($this->b))[0]);
        }
        [$status, $data] = self::out($this->shareApi($this->request($route, ['shares' => [['kind' => 'group', 'id' => 'nope', 'role' => 'view']]]))->update($this->b));
        $this->assertSame([400, ['error' => 'recipient_not_found', 'message' => 'The recipient was not found.', 'at' => 0]], [$status, $data]);
    }

    /**
     * R14-04 (§4.10.1/§4.10.2): linkPolicy.today of routes 19 and 20 is today
     * in the OWNER's zone (stored zone, else the instance default) — the same
     * day enableLink checks expiry_past against; moderators get no
     * linkPolicy; SharePolicy::linkPolicy (the snapshot's board.linkPolicy)
     * stays without today.
     */
    public function testRoutes19And20TodayInTheOwnersZone(): void {
        // A fresh harness per case: ownerZone is remembered for one request.
        $todayWith = function (?string $ownerZone, string $defaultZone): string {
            $this->h = new AccessHarness();
            $this->h->time = 1_760_050_000; // 2025-10-09 22:46:40 UTC
            $this->h->defaultZone = $defaultZone;
            if ($ownerZone !== null) {
                $this->h->zones['alice'] = $ownerZone;
            }
            $this->b = $this->h->service->create('alice', 'A')['id'];
            return self::out($this->shareApi($this->request(['id' => (string)$this->b]))->index($this->b))[1]['linkPolicy']['today'];
        };
        $this->assertSame('2025-10-09', $todayWith(null, 'UTC'), 'instance default UTC');
        $this->assertSame('2025-10-10', $todayWith(null, 'Pacific/Kiritimati'), 'instance default, 12:46 of the next day there');
        $this->assertSame('2025-10-09', $todayWith('America/Los_Angeles', 'Pacific/Kiritimati'), 'the owner\'s stored zone wins over the default');
        $this->assertSame('2025-10-10', $todayWith('Pacific/Kiritimati', 'UTC'), 'the owner\'s zone, not UTC');
        $route = ['id' => (string)$this->b];
        [$status, $data] = self::out($this->shareApi($this->request($route, ['shares' => [['kind' => 'user', 'id' => 'bob', 'role' => 'moderate']]]))->update($this->b));
        $this->assertSame([200, '2025-10-10'], [$status, $data['linkPolicy']['today']], 'route 20 answers like GET');
        // The same day as the server's checks: today is accepted, the UTC date (yesterday there) is expiry_past.
        $l = $this->h->service->enableLink('alice', $this->b, 'vote', ['expiresAt' => '2025-10-10']);
        $this->assertSame('2025-10-10', $l['expiresOn']);
        try {
            $this->h->service->enableLink('alice', $this->b, 'vote', ['expiresAt' => '2025-10-09']);
            $this->fail('expiry_past expected');
        } catch (\OCA\Knorke\Exception\HttpError $e) {
            $this->assertSame([400, 'expiry_past'], [$e->status, $e->error]);
        }
        // The moderator (own zone far away) gets no linkPolicy at all.
        $this->h->zones['bob'] = 'America/Los_Angeles';
        $this->h->uid = 'bob';
        $this->assertSame(['links'], array_keys(self::out($this->shareApi($this->request($route))->index($this->b))[1]));
        $this->assertArrayNotHasKey('today', $this->h->sharePolicy->linkPolicy(), 'the snapshot\'s board.linkPolicy stays without today');
    }

    public function testRoute21QueryAndBudget(): void {
        $route = ['id' => (string)$this->b];
        $this->h->search = [['users' => [['label' => 'Bob', 'value' => ['shareWith' => 'bob']]]], false];
        [$status, $data] = self::out($this->shareApi($this->request($route, null, ['q' => 'bo']))->sharees($this->b));
        $this->assertSame([200, ['sharees' => [['kind' => 'user', 'id' => 'bob', 'name' => 'Bob', 'sub' => 'bob']], 'more' => false]], [$status, $data]);
        $this->assertSame('bo', $this->h->searchCalls[0]['q']);
        $this->assertSame(400, self::out($this->shareApi($this->request($route, null, ['q' => 'bo', 'shareType' => '7']))->sharees($this->b))[0], 'never shareType');
        $this->assertSame(400, self::out($this->shareApi($this->request($route, null, ['q' => str_repeat('b', 201)]))->sharees($this->b))[0]);
        $this->assertSame(200, self::out($this->shareApi($this->request($route))->sharees($this->b))[0], 'q missing = ""');
        $this->limited = ['knorke-sharees'];
        $r = $this->shareApi($this->request($route, null, ['q' => 'bo']))->sharees($this->b);
        $this->assertSame([429, 1000, '1'], [$r->getStatus(), $r->getData()['retryMs'], self::header($r, 'Retry-After')]);
        $this->assertContains('knorke-sharees 60 60 alice', $this->limiterCalls);
    }

    public function testLinkRoutesAnswerTheLinkForm(): void {
        $route = ['id' => (string)$this->b];
        [$status, $data] = self::out($this->boardApi($this->request($route, ['password' => 'pw-1', 'expiresAt' => '2025-10-20']))->enableVoteLink($this->b));
        $this->assertSame(200, $status);
        $this->assertSame(['token', 'role', 'url', 'password', 'expiresAt', 'expiresOn'], array_keys($data['link']));
        $this->assertSame(['vote', true, '2025-10-20'], [$data['link']['role'], $data['link']['password'], $data['link']['expiresOn']]);
        $edit = self::out($this->boardApi($this->request($route, ['rotate' => false]))->enableLink($this->b))[1]['link'];
        $this->assertSame(['edit', false], [$edit['role'], $edit['password']]);
        $this->assertSame([400, 'bad_request'], [self::out($this->boardApi($this->request($route, ['expiresAt' => 1760000000000]))->enableLink($this->b))[0],
            self::out($this->boardApi($this->request($route, ['expiresAt' => 1760000000000]))->enableLink($this->b))[1]['error']]);
        $this->assertSame(400, self::out($this->boardApi($this->request($route, ['name' => 'x']))->enableVoteLink($this->b))[0], 'unknown body key');
        [$status, $data] = self::out($this->boardApi($this->request($route))->disableVoteLink($this->b));
        $this->assertSame([200, ['link' => null]], [$status, $data]);
        $this->assertNull($this->h->boards->activeLinkOf($this->b, 'vote'));
        $this->assertNotNull($this->h->boards->activeLinkOf($this->b, 'edit'));
        // Route 11 with a password.
        $this->h->service->enableLink('alice', $this->b, 'edit', ['password' => 'pw-e']);
        $this->h->uid = 'bob';
        $tok = ['token' => $edit['token']];
        $r = $this->boardApi($this->request($tok, []))->joinLink($edit['token']);
        $this->assertSame([403, 'password_required'], [$r->getStatus(), $r->getData()['error']]);
        $r = $this->boardApi($this->request($tok, ['password' => 5]))->joinLink($edit['token']);
        $this->assertSame(400, $r->getStatus());
        $r = $this->boardApi($this->request($tok, ['password' => 'pw-e']))->joinLink($edit['token']);
        $this->assertSame([200, ['boardId' => $this->b]], [$r->getStatus(), $r->getData()]);
    }

    /** @var array<string, string> provided initial state, JSON-encoded */
    private array $state = [];

    public function testPublicPageExpiredAndLinkInfo(): void {
        $page = fn (): PublicPageController => new PublicPageController(
            Fake::of(IRequest::class, ['getRemoteAddress' => fn (): string => '10.0.0.1']),
            Fake::of(IUserSession::class, ['isLoggedIn' => fn (): bool => false]),
            Fake::of(IURLGenerator::class),
            $this->h->boards,
            new LinkThrottle(Fake::of(IThrottler::class)),
            Fake::of(IInitialState::class, ['provideInitialState' => function (string $key, $data): void {
                $this->state[$key] = json_encode($data);
            }]),
            Fake::of(IConfig::class),
            Fake::of(IAppConfig::class),
            PageControllerTest::limits(),
            Fake::of(ITimeFactory::class, ['now' => fn (): \DateTimeImmutable => new \DateTimeImmutable('@' . $this->h->time)]),
            PageControllerTest::privacy('en', []),
        );
        $edit = $this->h->service->enableLink('alice', $this->b, 'edit', ['password' => 'pw']);
        $vote = $this->h->service->enableLink('alice', $this->b, 'vote', ['expiresAt' => '2025-10-10']);
        $page()->show($edit['token']);
        $this->assertSame(['"ok"', '{"role":"edit","password":true}', (string)$this->b], [$this->state['linkState'], $this->state['linkInfo'], $this->state['boardId']]);
        $page()->show($vote['token']);
        $this->assertSame(['"ok"', '{"role":"vote","password":false}'], [$this->state['linkState'], $this->state['linkInfo']]);
        $this->h->time += 2 * 86400;
        $page()->show($vote['token']);
        $this->assertSame(['"expired"', 'null', 'null'], [$this->state['linkState'], $this->state['linkInfo'], $this->state['boardId']], 'known, expired: no miss');
        $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($this->state));
        $this->h->service->disableLink('alice', $this->b, 'edit');
        $page()->show($edit['token']);
        $this->assertSame(['"revoked"', 'null'], [$this->state['linkState'], $this->state['linkInfo']]);
    }
}
