<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\ModerationApiController;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\ModerationService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IDBConnection;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Routes 22–26 (SPEC-M1 §4.1, §4.12, §4.9) on the in-memory rights: a
 * stranger 404 (no ownership oracle, nothing charged), a role without
 * moderation 403 forbidden — edit through a share, a group, a link — the
 * owner and a share with `moderate` (also through a group) 200; the budget
 * knorke-moderate 120/600 s → 429 slow_down {retryMs 5000} + Retry-After;
 * the body gate (unknown key 400); the answer {"board": {title, meta,
 * metaRev}, "now"} with meta {} when empty. Vote sessions answer from a
 * recording VoteService (its semantics: VoteServiceTest); timer and summon
 * run through the real ModerationService and MetaService.
 */
final class ModerationRoutesTest extends TestCase {
    private AccessHarness $h;
    private int $b;
    /** @var list<string> */
    private array $limiterCalls = [];
    private bool $limited = false;
    /** @var list<array> calls of the recording VoteService */
    public array $voteCalls = [];

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'Retro')['id'];
    }

    private function request(array $route, ?array $body = null): IRequest {
        $params = array_merge($route, $body ?? []);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? '10' : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
        ], ['urlParams' => $route]);
    }

    private function controller(?array $body = null, ?array $route = null): ModerationApiController {
        $limiter = Fake::of(ILimiter::class, ['registerUserRequest' => function (string $id, int $limit, int $period, IUser $user): void {
            $this->limiterCalls[] = "$id $limit $period " . $user->getUID();
            if ($this->limited) {
                throw new class('limited') extends \RuntimeException implements IRateLimitExceededException {
                };
            }
        }]);
        $session = Fake::of(IUserSession::class, ['getUser' => fn () => $this->h->uid === null ? null : $this->h->user($this->h->uid)]);
        $test = $this;
        $db = Fake::of(IDBConnection::class);
        $votes = new class(new VoteStore($db), $this->h->boards, $this->h->meta, $this->h->cache, $db, Fake::of(LoggerInterface::class), $test) extends VoteService {
            public function __construct(VoteStore $s, BoardStore $b, MetaService $m, FastCache $c, IDBConnection $d, LoggerInterface $l, private ModerationRoutesTest $test) {
                parent::__construct($s, $b, $m, $c, $d, $l);
            }

            public function start(Principal $p, int $board, array $cfg, int $nowMs): array {
                $this->test->voteCalls[] = ['start', $p->id, $board, $cfg];
                if (($cfg['per'] ?? null) === 0) {
                    throw new HttpError(400, 'vote_config');
                }
                return ['title' => 'Retro', 'meta' => ['vote' => ['sid' => 1, 'state' => 'open']], 'metaRev' => 5];
            }

            public function update(Principal $p, int $board, string $action, ?int $minutes, int $nowMs): array {
                $this->test->voteCalls[] = ['update', $p->id, $board, $action, $minutes];
                if ($action === 'clear') {
                    throw new HttpError(409, 'vote_closed');
                }
                return ['title' => 'Retro', 'meta' => [], 'metaRev' => 6];
            }
        };
        return new ModerationApiController($this->request($route ?? ['id' => (string)$this->b], $body), Fake::of(LoggerInterface::class),
            $this->h->access, $votes, new ModerationService($this->h->meta), $session, $limiter);
    }

    /** @return array{0: int, 1: mixed} [status, decoded body] */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), json_decode($r->render(), true)];
    }

    private static function header(Response $r, string $name): ?string {
        $p = new \ReflectionProperty(Response::class, 'headers');
        return $p->getValue($r)[$name] ?? null;
    }

    /** Every route once for the current user: [status, error|null] each. */
    private function everyRoute(): array {
        $out = [];
        $out[] = self::out($this->controller(['per' => 3])->startVote($this->b));
        $out[] = self::out($this->controller(['action' => 'end'])->updateVote($this->b));
        $out[] = self::out($this->controller(['action' => 'start', 'ms' => 60000])->timer($this->b));
        $out[] = self::out($this->controller(['client' => 'cTabA'])->summon($this->b));
        $out[] = self::out($this->controller()->endSummon($this->b));
        return array_map(static fn (array $o): array => [$o[0], $o[1]['error'] ?? null], $out);
    }

    public function testWhoMayModerate(): void {
        // Owner.
        $this->assertSame(array_fill(0, 5, [200, null]), $this->everyRoute());
        $this->assertSame(array_fill(0, 5, 'knorke-moderate 120 600 alice'), $this->limiterCalls);
        // Share role moderate → facilitator (user and group).
        $this->h->shareRows->add($this->b, 'user', 'bob', 'moderate');
        $this->h->uid = 'bob';
        $this->assertSame(array_fill(0, 5, [200, null]), $this->everyRoute());
        $this->h->shareRows->add($this->b, 'group', 'staff', 'edit');
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'moderate');
        $this->h->uid = 'carol';
        $this->assertSame(array_fill(0, 5, [200, null]), $this->everyRoute(), 'moderate through a group');
        // edit through a share, a group or a link: 403 forbidden, nothing charged.
        $this->h->shareRows->add($this->b, 'user', 'dora', 'edit');
        $this->h->groups['staff'][] = 'erin';
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->h->boards->addMember($this->b, 'fred', 'edit', $this->h->boards->activeLinkOf($this->b, 'edit')['id'], 1);
        $this->h->shareRows->add($this->b, 'user', 'vic', 'vote');
        foreach (['dora', 'erin', 'fred', 'vic'] as $uid) {
            $this->h->uid = $uid;
            $this->limiterCalls = [];
            $this->assertSame(array_fill(0, 5, [403, 'forbidden']), $this->everyRoute(), $uid);
            $this->assertSame([], $this->limiterCalls, "$uid: refused before the budget");
        }
        // A stranger: 404 everywhere (no ownership oracle).
        $this->h->uid = 'zoe';
        $this->assertSame(array_fill(0, 5, [404, 'not_found']), $this->everyRoute());
        $this->assertSame(404, self::out($this->controller(['per' => 3], ['id' => '999'])->startVote(999))[0]);
    }

    public function testBudgetAndAnswerShape(): void {
        $this->limited = true;
        $r = $this->controller(['action' => 'stop'])->timer($this->b);
        $this->assertSame([429, ['error' => 'slow_down', 'message' => 'Too many requests, please wait a moment.', 'retryMs' => 5000]], [$r->getStatus(), $r->getData()]);
        $this->assertSame('5', self::header($r, 'Retry-After'));
        $this->limited = false;
        // {"board": {title, meta, metaRev}, "now"}; meta {} when empty, the stored title.
        $r = $this->controller()->endSummon($this->b);
        $this->assertMatchesRegularExpression('/^\{"board":\{"title":"Retro","meta":\{\},"metaRev":0\},"now":\d{13}\}$/', $r->render(), 'DELETE without summon: no write');
        [$status, $d] = self::out($this->controller(['client' => 'cTabA'])->summon($this->b));
        $this->assertSame([200, ['board', 'now'], ['title', 'meta', 'metaRev']], [$status, array_keys($d), array_keys($d['board'])]);
        $this->assertSame(['pid', 'client', 'name', 'seq', 'at'], array_keys($d['board']['meta']['summon']));
        $this->assertSame(['cTabA', 'Alice Display', 1], [$d['board']['meta']['summon']['client'], $d['board']['meta']['summon']['name'], $d['board']['meta']['summon']['seq']]);
        $this->assertSame(1, $d['board']['metaRev']);
        [, $d] = self::out($this->controller(['action' => 'start', 'ms' => 60000])->timer($this->b));
        $this->assertSame(['running', 60000, 'Alice Display', 1], [$d['board']['meta']['timer']['state'], $d['board']['meta']['timer']['dur'], $d['board']['meta']['timer']['by'], $d['board']['meta']['timer']['seq']]);
        $this->assertLessThanOrEqual(1000, abs($d['board']['meta']['timer']['end'] - $d['now'] - 60000), 'C73: end − now ≈ 60000');
        // Votes go to VoteService with the principal and the raw body.
        [$status, $d] = self::out($this->controller(['per' => 3, 'types' => ['sticky']])->startVote($this->b));
        $this->assertSame([200, 5, ['start', 'u:alice', $this->b, ['per' => 3, 'types' => ['sticky']]]], [$status, $d['board']['metaRev'], $this->voteCalls[0]]);
        self::out($this->controller(['action' => 'extend', 'minutes' => 5.0])->updateVote($this->b));
        self::out($this->controller(['action' => 'end', 'minutes' => 'x'])->updateVote($this->b));
        $this->assertSame([['update', 'u:alice', $this->b, 'extend', 5], ['update', 'u:alice', $this->b, 'end', null]], array_slice($this->voteCalls, 1));
        $this->assertSame([400, 'vote_config'], [self::out($this->controller(['per' => 0])->startVote($this->b))[0], self::out($this->controller(['per' => 0])->startVote($this->b))[1]['error']]);
        $this->assertSame([409, 'vote_closed'], [self::out($this->controller(['action' => 'clear'])->updateVote($this->b))[0], self::out($this->controller(['action' => 'clear'])->updateVote($this->b))[1]['error']]);
    }

    public function testBodyGate(): void {
        foreach ([
            ['startVote', ['per' => 3, 'evil' => 1]],
            ['updateVote', ['action' => 'end', 'ms' => 1]],
            ['updateVote', ['minutes' => 1]],
            ['updateVote', ['action' => 7]],
            ['timer', ['action' => 'start', 'minutes' => 1]],
            ['timer', ['action' => 'start']],
            ['timer', ['action' => 'jump', 'ms' => 1000]],
            ['timer', ['action' => 'start', 'ms' => 6000000]],
            ['summon', []],
            ['summon', ['client' => 'cTabA', 'pid' => 'x']],
            ['summon', ['client' => '']],
        ] as [$method, $body]) {
            [$status, $d] = self::out($this->controller($body)->$method($this->b));
            $this->assertSame([400, 'bad_request'], [$status, $d['error']], $method . ' ' . json_encode($body));
        }
        // A body {id} that overrides the route → 400 (JsonBody step 3), also on DELETE.
        [$status] = self::out($this->controller(['id' => '999'], ['id' => (string)$this->b])->endSummon($this->b));
        $this->assertSame(400, $status);
        $this->assertSame([], $this->voteCalls);
    }
}
