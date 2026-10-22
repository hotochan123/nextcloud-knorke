<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\PublicSyncController;
use OCA\Knorke\Controller\SyncController;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\RawJsonResponse;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\SqliteDb;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Route 12 (SPEC-M1 §4.4): who gets what of the share dialog's state in the
 * snapshot. Moderators (owner; shares with `moderate`) get board.links =
 * {edit, vote} read only, only the owner linksAllowed and linkPolicy,
 * everybody else none of them; the M0 key board.link is gone. The stored
 * title comes from SyncService (one read after the rev), never from the
 * controller.
 *
 * Stage 4 (SPEC-M1 §4.1 routes 12 and 15, §4.2): the snapshot throttle runs
 * AFTER the rights check and BEFORE the snapshot is built; a throttled call
 * answers 429 slow_down {retryMs} with Retry-After and builds nothing.
 *
 * M2 privacy notice (AK9): board.linkOpenSince for EVERY role of route 12 –
 * the real SQL of BoardStore::linkOpenSince over SQLite: the later
 * created_at of the active edit and vote link, null without one (revoked or
 * expired links do not count); route 15 (guests) does not carry it.
 */
final class SnapshotControllerTest extends TestCase {
    /** @var array<string, mixed>|null what the controller handed to snapshotJson */
    private ?array $meta = null;
    private ?int $now = null;
    /** @var list<string> calls of the fake Access in order */
    public array $calls = [];
    /** The throttle refuses with this error (null: passes). */
    public ?HttpError $throttled = null;
    /** Links table of linkOpenSince (real SQL); null until a test adds links. */
    public ?SqliteDb $db = null;
    /** Server time of linkOpenSince (ms). */
    public const NOW = 1760000000000;

    /** @internal called by the BoardService stand-in: the real BoardStore SQL over SQLite */
    public function openSince(int $board): ?int {
        $this->db ??= new SqliteDb();
        return (new BoardStore($this->db->connection()))->linkOpenSince($board, self::NOW);
    }

    /** A header set on the response itself (Response::getHeaders() needs a running server). */
    private static function header(\OCP\AppFramework\Http\Response $r, string $name): ?string {
        $p = new \ReflectionProperty(\OCP\AppFramework\Http\Response::class, 'headers');
        return $p->getValue($r)[$name] ?? null;
    }

    /** @internal called by the Access stand-in */
    public function accessCall(string $call): void {
        $this->calls[] = $call;
        if (str_starts_with($call, 'throttle') && $this->throttled !== null) {
            throw $this->throttled;
        }
    }

    private function access(Principal $p, array $row): Access {
        return new class($p, $row, $this) extends Access {
            public function __construct(private Principal $p, private array $row, private SnapshotControllerTest $test) {
            }

            public function forUserWithRow(int $board): array {
                $this->test->accessCall('forUserWithRow');
                return [new AccessResult($this->p, 3, 0, 2), $this->row];
            }

            public function forGuestWithRow(#[\SensitiveParameter] string $token, int $board): array {
                $this->test->accessCall('forGuestWithRow');
                return [new AccessResult($this->p, 3, 0, 2), $this->row];
            }

            public function throttleSnapshot(): void {
                $this->test->accessCall('throttleSnapshot');
            }

            public function throttleGuestSnapshot(Principal $p, int $board, string $ip): void {
                $this->test->accessCall('throttleGuestSnapshot ' . $p->id . ' ' . $board . ' ' . $ip);
            }
        };
    }

    private function sync(): SyncService {
        return new class($this) extends SyncService {
            public function __construct(private SnapshotControllerTest $test) {
            }

            public function snapshotJson(AccessResult $a, int $board, array $boardMeta, ?array $guest = null, ?int $nowMs = null): string {
                $this->test->captured($boardMeta, $nowMs);
                return '{}';
            }
        };
    }

    private function snapshot(Principal $p): \OCP\AppFramework\Http\Response {
        $row = ['id' => 7, 'owner' => 'alice', 'title' => 'Row title', 'schema_version' => 1, 'rev' => 3, 'min_rev' => 0, 'meta_rev' => 2];
        $access = $this->access($p, $row);
        $sync = $this->sync();
        $boards = new class($this) extends BoardService {
            public function __construct(private SnapshotControllerTest $test) {
            }

            public function linkOpenSince(int $board): ?int {
                return $this->test->openSince($board);
            }

            public function links(int $board, string $ownerUid): array {
                return ['edit' => ['token' => 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'role' => 'edit', 'url' => 'https://x/p/Ab3dEf6hIj9kLm2nOp5qRs8t'], 'vote' => null];
            }

            public function linksAllowed(string $owner): bool {
                return $owner === 'alice';
            }
        };
        $request = Fake::of(IRequest::class, ['getParam' => fn (string $k, $d = null) => $k === 'id' ? '7' : $d], ['urlParams' => ['id' => '7']]);
        $policy = new class() extends SharePolicy {
            public function __construct() {
            }

            public function linkPolicy(): array {
                return ['passwordEnforced' => true, 'expireDefaultDays' => 7, 'expireEnforced' => false, 'expireMaxDays' => null];
            }
        };
        $c = new SyncController($request, $access, $sync, $boards, Fake::of(LoggerInterface::class), $policy);
        $this->meta = null;
        $r = $c->snapshot(7);
        if ($this->throttled === null) {
            $this->assertInstanceOf(RawJsonResponse::class, $r);
            $this->assertSame(200, $r->getStatus());
        }
        return $r;
    }

    public function testRoute12ThrottleAfterTheRightsCheck(): void {
        $this->snapshot(self::p(Role::Owner, 'owner'));
        $this->assertSame(['forUserWithRow', 'throttleSnapshot'], $this->calls, 'rights first (a refused caller spends nothing), then the budget');
        $this->calls = [];
        $this->throttled = new HttpError(429, 'slow_down', '', ['retryMs' => 2000]);
        $r = $this->snapshot(self::p(Role::Owner, 'owner'));
        $this->assertSame(429, $r->getStatus());
        $this->assertSame(['error' => 'slow_down', 'message' => 'Too many requests, please wait a moment.', 'retryMs' => 2000], $r->getData());
        $this->assertSame('2', self::header($r, 'Retry-After'), 'Retry-After in whole seconds (§4.2)');
        $this->assertNull($this->meta, 'no snapshot built');
    }

    public function testRoute15ThrottleAfterTheTokenCheck(): void {
        $g = new Principal('g:gAbcdEfgh123', Role::Edit, 'Gina', '0123456789abcdef', true, null, 'guest');
        $row = ['id' => 7, 'owner' => 'alice', 'title' => 'T', 'schema_version' => 1, 'rev' => 3, 'min_rev' => 0, 'meta_rev' => 2];
        $request = Fake::of(IRequest::class, [
            'getParam' => fn (string $k, $d = null) => $k === 'id' ? '7' : $d,
            'getHeader' => fn (string $name): string => $name === PublicSyncController::GUEST_HEADER ? 'tok' : '',
            'getRemoteAddress' => fn (): string => '10.1.2.3',
        ], ['urlParams' => ['id' => '7']]);
        $c = new PublicSyncController($request, $this->access($g, $row), $this->sync(), Fake::of(LoggerInterface::class));
        $this->assertSame(200, $c->snapshot(7)->getStatus());
        $this->assertSame(['forGuestWithRow', 'throttleGuestSnapshot g:gAbcdEfgh123 7 10.1.2.3'], $this->calls);
        $this->calls = [];
        $this->meta = null;
        $this->throttled = new HttpError(429, 'slow_down', '', ['retryMs' => 200]);
        $r = $c->snapshot(7);
        $this->assertSame([429, 200, '1'], [$r->getStatus(), $r->getData()['retryMs'], self::header($r, 'Retry-After')]);
        $this->assertNull($this->meta, 'no snapshot built');
    }

    /** @internal called by the SyncService stand-in */
    public function captured(array $boardMeta, ?int $nowMs): void {
        $this->meta = $boardMeta;
        $this->now = $nowMs;
    }

    private static function p(Role $role, string $origin, bool $facilitator = false): Principal {
        return new Principal('u:x', $role, 'X', '0123456789abcdef', false, 'x', $origin, $facilitator);
    }

    public function testOwnerGetsLinksAndLinksAllowed(): void {
        $this->snapshot(self::p(Role::Owner, 'owner'));
        $link = ['token' => 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'role' => 'edit', 'url' => 'https://x/p/Ab3dEf6hIj9kLm2nOp5qRs8t'];
        $this->assertSame(['id' => 7, 'role' => 'owner', 'schema' => 1, 'links' => ['edit' => $link, 'vote' => null], 'linksAllowed' => true,
            'linkPolicy' => ['passwordEnforced' => true, 'expireDefaultDays' => 7, 'expireEnforced' => false, 'expireMaxDays' => null], 'linkOpenSince' => null], $this->meta);
        $this->assertIsInt($this->now, 'the request time goes along (now)');
    }

    public function testModeratorGetsLinksOnly(): void {
        $this->snapshot(self::p(Role::Edit, 'share', true));
        $this->assertSame(['id', 'role', 'schema', 'links', 'linkOpenSince'], array_keys($this->meta));
        $this->assertSame([null, 'edit'], [$this->meta['links']['vote'], $this->meta['role']]);
    }

    public function testOthersGetNeither(): void {
        foreach ([self::p(Role::Edit, 'link'), self::p(Role::Edit, 'share'), self::p(Role::View, 'share'), self::p(Role::Vote, 'link')] as $p) {
            $this->snapshot($p);
            $this->assertSame(['id' => 7, 'role' => $p->role->value, 'schema' => 1, 'linkOpenSince' => null], $this->meta, $p->role->value . ' ' . $p->origin);
        }
    }

    /** Owner, moderator, member (share and link), voter: all of them get linkOpenSince. */
    private function everyRole(): array {
        return [self::p(Role::Owner, 'owner'), self::p(Role::Edit, 'share', true), self::p(Role::Edit, 'share'), self::p(Role::Edit, 'link'), self::p(Role::Vote, 'link'), self::p(Role::View, 'share')];
    }

    public function testLinkOpenSinceIsTheLaterOfBothLinksForEveryRole(): void {
        $this->db = new SqliteDb();
        $this->db->addLink(7, 'edit', 1000);
        $this->db->addLink(7, 'vote', 2000, null, self::NOW + 60000);
        $this->db->addLink(8, 'edit', 9000);
        foreach ($this->everyRole() as $p) {
            $this->snapshot($p);
            $this->assertSame(2000, $this->meta['linkOpenSince'] ?? 'missing', $p->role->value . ' ' . $p->origin);
        }
        $this->assertArrayNotHasKey('links', $this->meta, 'a member still gets no links');
    }

    /** @return array<string, array{0: list<array{0: string, 1: int, 2: ?int, 3: ?int}>, 1: ?int}> */
    public static function openCases(): array {
        $now = self::NOW;
        return [
            'no link' => [[], null],
            'only a revoked link' => [[['edit', 1000, 5000, null]], null],
            'only an expired link' => [[['edit', 1000, null, $now - 1]], null],
            'expired exactly now' => [[['vote', 1000, null, $now]], null],
            'a pure voting link counts' => [[['vote', 3000, null, null]], 3000],
            'edit with a future expiry' => [[['edit', 4000, null, $now + 1]], 4000],
            'renewed: the new row counts, the revoked old one not' => [[['edit', 1000, 1500, null], ['edit', 1500, null, null]], 1500],
            'second link switched off: the value sinks' => [[['edit', 1000, null, null], ['vote', 2000, 2500, null]], 1000],
            'expired newer, active older' => [[['edit', 1000, null, null], ['vote', 5000, null, $now - 10]], 1000],
            'only the link roles edit and vote count' => [[['view', 7000, null, null]], null],
        ];
    }

    /** @param list<array{0: string, 1: int, 2: ?int, 3: ?int}> $links */
    #[\PHPUnit\Framework\Attributes\DataProvider('openCases')]
    public function testLinkOpenSinceCases(array $links, ?int $want): void {
        $this->db = new SqliteDb();
        foreach ($links as [$role, $created, $revoked, $expires]) {
            $this->db->addLink(7, $role, $created, $revoked, $expires);
        }
        foreach ([self::p(Role::Owner, 'owner'), self::p(Role::Edit, 'share')] as $p) {
            $this->snapshot($p);
            $this->assertArrayHasKey('linkOpenSince', $this->meta);
            $this->assertSame($want, $this->meta['linkOpenSince'], $p->role->value);
        }
    }

    public function testRoute15HasNoLinkOpenSince(): void {
        $this->db = new SqliteDb();
        $this->db->addLink(7, 'edit', 1000);
        $g = new Principal('g:gAbcdEfgh123', Role::Edit, 'Gina', '0123456789abcdef', true, null, 'guest');
        $row = ['id' => 7, 'owner' => 'alice', 'title' => 'T', 'schema_version' => 1, 'rev' => 3, 'min_rev' => 0, 'meta_rev' => 2];
        $request = Fake::of(IRequest::class, [
            'getParam' => fn (string $k, $d = null) => $k === 'id' ? '7' : $d,
            'getHeader' => fn (string $name): string => $name === PublicSyncController::GUEST_HEADER ? 'tok' : '',
            'getRemoteAddress' => fn (): string => '10.1.2.3',
        ], ['urlParams' => ['id' => '7']]);
        $c = new PublicSyncController($request, $this->access($g, $row), $this->sync(), Fake::of(LoggerInterface::class));
        $this->assertSame(200, $c->snapshot(7)->getStatus());
        $this->assertSame(['id' => 7, 'role' => 'edit', 'schema' => 1], $this->meta, 'guests: no linkOpenSince');
    }
}
