<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Service\WriteBudget;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

/**
 * SyncService wired to fakes with ONE call log: the fake connection logs
 * begin/commit/rollBack, the fake store every statement, the cache every
 * bumpRev — so tests can check "lockAndBumpRev first" and "bumpRev after
 * COMMIT". BoardStore::meta() (title, meta, meta_rev) answers from the
 * FakeItemStore's board rows and logs "meta". The epoch is $epoch->value
 * (default EPOCH, the `ep` of every harness request).
 *
 * The rights hooks of the write path (SPEC-M1 §4.13.2 step 9) can be
 * observed or overridden per test: $sync->onAuthorize(p, op, cur, row) and
 * $sync->onAuthorizeRef(p, refId, refCur); unset, they keep the M1 answers
 * (allowed, true).
 *
 * The vote path (stage 3) answers from closures: $votes->onApply(p, board,
 * ops, now, authorize), $votes->onProgress(p, board, seen, now) and
 * $votes->onMine(board, pid); unset: no session is open (every vote op
 * `closed`, progress null, mine null). Every call is logged as
 * "votes.apply …", "votes.progress …", "votes.mine …". The real
 * VoteService runs in VoteHarness (SQLite).
 *
 * The write budget (stage 4, SPEC-M1 §4.13.6) is the real WriteBudget over
 * the harness's MemoryCache; its limits come from $app (budget_syncs,
 * budget_ops), the window from $now.
 */
final class SyncHarness {
    /** The board epoch the harness requests carry as `ep` (SPEC-M1 §4.5, §5.4). */
    public const EPOCH = 'k3x9a0b2';
    /** The system secret `secret` (getSystemValueString): the key of the pids of lock.by. */
    public const SECRET = 'sync-secret';

    /** @var list<string> */
    public array $log = [];
    public FakeItemStore $store;
    public MemoryCache $mem;
    public FastCache $cache;
    public FakePresenceStore $presence;
    public SyncService $sync;
    public VoteService $votes;
    public EpochStub $epoch;
    public BoardStore $boards;
    /** @var array<string, mixed> system config */
    public array $system = [];
    /** @var array<string, int|string> app config (the byte keys of P7 are read as text) */
    public array $app = [];
    public int $now = 1_760_000_000_000;
    /** IDBConnection::supports4ByteText() (false: legacy MySQL/MariaDB with utf8mb3 tables) */
    public bool $fourByte = true;
    /** Open transactions of the fake connection (inTransaction(): MetaService and the vote path check it). */
    public int $depth = 0;
    /** How often getSystemValueString('secret') was read (at most once per answer, only for a locked row). */
    public int $secretReads = 0;

    /** @param bool $redis false = the distributed cache is not available (no fast path, no presence) */
    public function __construct(bool $redis = true) {
        $this->store = new FakeItemStore($this->log);
        $this->mem = new MemoryCache();
        $this->mem->available = $redis;
        $this->epoch = new EpochStub(self::EPOCH);
        $log = &$this->log;
        $this->cache = new class($this->mem->factory(), $this->epoch->epoch(), $log) extends FastCache {
            /** @param list<string> $log */
            public function __construct(\OCP\ICacheFactory $f, \OCA\Knorke\Service\Epoch $e, private array &$log) {
                parent::__construct($f, $e);
            }

            public function bumpRev(int $b, int $rev): void {
                $this->log[] = "bumpRev $rev";
                parent::bumpRev($b, $rev);
            }
        };
        $this->presence = new FakePresenceStore($this->mem->factory(), $this->epoch->epoch());
        $store = $this->store;
        $this->boards = new class($store, $log) extends BoardStore {
            /** @param list<string> $log */
            public function __construct(private FakeItemStore $store, private array &$log) {
            }

            public function meta(int $board): ?array {
                $this->log[] = 'meta';
                $b = $this->store->boards[$board] ?? null;
                return $b === null ? null : ['title' => $b['title'], 'meta' => $b['meta'], 'meta_rev' => $b['meta_rev']];
            }
        };
        $db = Fake::of(IDBConnection::class, [
            'supports4ByteText' => fn (): bool => $this->fourByte,
            'beginTransaction' => function (): void {
                $this->depth++;
                $this->log[] = 'begin';
                $this->store->begin();
            },
            'commit' => function (): void {
                $this->depth--;
                $this->log[] = 'commit';
                $this->store->commit();
            },
            'rollBack' => function (): void {
                $this->depth--;
                $this->log[] = 'rollBack';
                $this->store->rollBack();
            },
            'inTransaction' => fn (): bool => $this->depth > 0,
        ]);
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $app, string $key, int $default = 0, ?bool $lazy = false): int => is_int($this->app[$key] ?? null) ? $this->app[$key] : $default,
            'getValueString' => fn (string $app, string $key, string $default = '', ?bool $lazy = false): string => isset($this->app[$key]) ? (string)$this->app[$key] : $default,
        ]);
        $config = Fake::of(IConfig::class, [
            'getSystemValueBool' => fn (string $key, bool $default = false): bool => (bool)($this->system[$key] ?? $default),
            'getSystemValue' => fn (string $key, $default = '') => $this->system[$key] ?? $default,
            'getSystemValueString' => function (string $key, string $default = ''): string {
                if ($key === 'secret') {
                    $this->secretReads++;
                    return self::SECRET;
                }
                return (string)($this->system[$key] ?? $default);
            },
        ]);
        $this->votes = new class(new VoteStore($db), $this->boards, new MetaService($this->boards, $this->cache, $db), $this->cache, $db,
            Fake::of(LoggerInterface::class), $log) extends VoteService {
            /** @var (\Closure(Principal, int, array, int, ?callable): array)|null */
            public ?\Closure $onApply = null;
            /** @var (\Closure(Principal, int, int, int): ?array)|null */
            public ?\Closure $onProgress = null;
            /** @var (\Closure(int, string): ?array)|null */
            public ?\Closure $onMine = null;

            /** @param list<string> $log */
            public function __construct(VoteStore $s, BoardStore $b, MetaService $m, FastCache $c, IDBConnection $d, LoggerInterface $l, private array &$log) {
                parent::__construct($s, $b, $m, $c, $d, $l);
            }

            public function apply(Principal $p, int $board, array $voteOps, int $nowMs, ?callable $authorize = null): array {
                $this->log[] = 'votes.apply ' . json_encode($voteOps);
                if ($this->onApply !== null) {
                    return ($this->onApply)($p, $board, $voteOps, $nowMs, $authorize);
                }
                return ['res' => array_map(static fn (array $o): string => $o['o'] === 'vote' ? 'closed' : $o['o'], $voteOps), 'sid' => null, 'mine' => null, 'left' => null];
            }

            public function progress(Principal $p, int $board, int $seenSeq, int $nowMs): ?array {
                $this->log[] = "votes.progress $seenSeq";
                return $this->onProgress === null ? null : ($this->onProgress)($p, $board, $seenSeq, $nowMs);
            }

            public function mine(int $board, string $pid): ?array {
                $this->log[] = "votes.mine $pid";
                return $this->onMine === null ? null : ($this->onMine)($board, $pid);
            }
        };
        // clockMs() (the lease re-read under the lock) is pinned: 0 → max(nowMs, 0) = nowMs.
        $limits = new Limits($appConfig);
        $this->sync = new class($this->store, $this->cache, $this->presence, $db, $limits, $config, $this->epoch->epoch(), $this->boards, $this->votes,
            new WriteBudget($this->cache, $limits)) extends SyncService {
            public int $clock = 0;
            /** @var (\Closure(Principal, array, ?array, ?array): ?string)|null */
            public ?\Closure $onAuthorize = null;
            /** @var (\Closure(Principal, string, ?array): bool)|null */
            public ?\Closure $onAuthorizeRef = null;

            protected function clockMs(): int {
                return $this->clock;
            }

            protected function authorize(Principal $p, array $op, ?array $cur, ?array $row): ?string {
                return $this->onAuthorize === null ? parent::authorize($p, $op, $cur, $row) : ($this->onAuthorize)($p, $op, $cur, $row);
            }

            protected function authorizeRef(Principal $p, string $refId, ?array $refCur): bool {
                return $this->onAuthorizeRef === null ? parent::authorizeRef($p, $refId, $refCur) : ($this->onAuthorizeRef)($p, $refId, $refCur);
            }
        };
    }

    /** An account; origin owner for Role::Owner, else link (stage 0 has no shares). */
    public static function user(string $uid = 'alice', Role $role = Role::Owner, ?string $origin = null, bool $facilitator = false): Principal {
        return new Principal('u:' . $uid, $role, ucfirst($uid), substr(hash('sha256', $uid), 0, 16), false, $uid,
            $origin ?? ($role === Role::Owner ? 'owner' : 'link'), $facilitator);
    }

    public static function guest(string $gid = 'gAAAAAAAAAAA', string $name = 'Gina', Role $role = Role::Edit): Principal {
        return new Principal('g:' . $gid, $role, $name, substr(hash('sha256', $gid), 0, 16), true, null, 'guest');
    }

    /** @return array{0: ?int, 1: list<string>} */
    public function apply(array $ops, ?Principal $p = null, ?array $presence = null, int $board = 1): array {
        return $this->sync->applyOps($p ?? self::user(), $board, 'cTest', $ops, $this->now, $presence);
    }

    /** Decoded /sync answer. */
    public function syncDecoded(array $body, ?Principal $p = null, ?int $dbRev = null, int $minRev = 0, int $board = 1, ?int $metaRev = null): array {
        return json_decode($this->syncRaw($body, $p, $dbRev, $minRev, $board, $metaRev), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * $metaRev: meta_rev of a full check (with $dbRev: the board head the slow path may reuse).
     * The request's bodyBytes (daily byte quota, P7) is the length of its JSON text.
     */
    public function syncRaw(array $body, ?Principal $p = null, ?int $dbRev = null, int $minRev = 0, int $board = 1, ?int $metaRev = null): string {
        $body += ['proto' => Application::PROTOCOL, 'client' => 'cTest', 'ep' => self::EPOCH];
        $r = SyncRequest::fromBody($body, strlen(json_encode($body, JSON_THROW_ON_ERROR)));
        return $this->sync->sync(new AccessResult($p ?? self::user(), $dbRev, $minRev, $metaRev), $board, $r, $this->now);
    }

    public static function sticky(array $p = [], string $z = 'i1'): array {
        return $p + ['x' => 100, 'y' => 40, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => $z, 'parent' => null, 'data' => ['text' => ''], 'style' => ['fill' => '#a8d8f8']];
    }

    /** A shape put payload (SPEC-M1 §3.10), rect by default. */
    public static function shape(array $p = [], string $z = 'i2'): array {
        return $p + ['x' => 100, 'y' => 40, 'w' => 200, 'h' => 120, 'r' => 0, 'z' => $z, 'parent' => null, 'data' => ['kind' => 'rect', 'text' => ''], 'style' => ['fill' => '#ffffff', 'stroke' => '#1a1a1a', 'strokeWidth' => 2]];
    }

    /** A text put payload (SPEC-M1 §3.10). */
    public static function text(array $p = [], string $z = 'i3'): array {
        return $p + ['x' => 0, 'y' => 0, 'w' => 240, 'h' => 31.2, 'r' => 0, 'z' => $z, 'parent' => null, 'data' => ['text' => 'Title'], 'style' => ['fontSize' => 24, 'color' => '#1a1a1a', 'align' => 'left']];
    }

    /** A connector put payload: placement none (rule 12), the two ends required. */
    public static function connector(array $start, array $end, array $p = [], string $z = 'i4'): array {
        return $p + ['z' => $z, 'data' => ['start' => $start, 'end' => $end, 'route' => 'straight'], 'style' => ['stroke' => '#1a1a1a', 'strokeWidth' => 2, 'endCap' => 'arrow']];
    }

    public static function frame(array $p = [], string $z = 'hz'): array {
        return $p + ['x' => 1000, 'y' => 500, 'w' => 800, 'h' => 600, 'r' => 0, 'z' => $z, 'parent' => null, 'data' => ['title' => 'F'], 'style' => ['fill' => '#ffffff']];
    }

    public static function put(string $id, array $p, string $t = 'sticky', bool $revive = false): array {
        return ['o' => 'put', 'id' => $id, 't' => $t, 'p' => $p] + ($revive ? ['revive' => true] : []);
    }

    public static function patch(string $id, array $p, bool $keep = false): array {
        return ['o' => 'patch', 'id' => $id, 'p' => $p] + ($keep ? ['keep' => true] : []);
    }

    public static function remove(string $id): array {
        return ['o' => 'remove', 'id' => $id];
    }

    /** Positions of the given entries in the log (first occurrence), -1 = absent. */
    public function pos(string $entry): int {
        foreach ($this->log as $i => $l) {
            if ($l === $entry || str_starts_with($l, $entry . ' ')) {
                return $i;
            }
        }
        return -1;
    }
}
