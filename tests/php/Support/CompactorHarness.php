<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Service\Compactor;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\IUser;

/**
 * Compactor (SPEC-M1 §4.13.7) for unit tests.
 *
 * new CompactorHarness(): the REAL ItemStore/BoardStore SQL on an in-memory
 * SQLite (SqliteDb; the two block-boundary SELECTs of the query builder are
 * the same SELECTs in raw SQL in SqlItemStore, BoardStore::pruneLinks — no
 * links table here — answers 0), a MemoryCache behind FastCache (setGens
 * observable), a link policy that always allows, app config in $app
 * (tombstone_days, tombstone_cap, changes_cap, cleanup_cursor; writes are
 * logged in $appWrites; P7: changes_bytes_cap as text through
 * getValueString) and the budget clock $clock (a closure returning
 * monotonic ms; default: always 0, so the 60-s budget never runs out).
 *
 * CompactorHarness::over($items, $boards): the same wiring over other
 * stores (the fakes of the CleanupJob tests).
 */
final class CompactorHarness {
    public SqliteDb $sql;
    public IDBConnection $db;
    public ItemStore $items;
    public BoardStore $boards;
    public MemoryCache $mem;
    public FastCache $cache;
    public Compactor $compactor;
    /** @var array<string, int|string> app config of the app */
    public array $app = [];
    /** @var list<string> "<key>=<value>" of every app-config write */
    public array $appWrites = [];
    /** @var \Closure(): float */
    public \Closure $clock;
    /** Calls of the budget clock. */
    public int $clockCalls = 0;

    public function __construct(?ItemStore $items = null, ?BoardStore $boards = null) {
        $this->clock = static fn (): float => 0.0;
        $this->sql = new SqliteDb();
        $this->db = $this->sql->connection();
        $this->items = $items ?? new SqlItemStore($this->db);
        $this->boards = $boards ?? new class($this->db) extends BoardStore {
            public function pruneLinks(int $olderThanMs): int {
                return 0;
            }
        };
        $this->mem = new MemoryCache();
        $this->cache = new FastCache($this->mem->factory(), (new EpochStub())->epoch());
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $app, string $key, int $default = 0, ?bool $lazy = false): int => is_int($this->app[$key] ?? null) ? $this->app[$key] : $default,
            'getValueString' => fn (string $app, string $key, string $default = '', ?bool $lazy = false): string => isset($this->app[$key]) ? (string)$this->app[$key] : $default,
            'setValueInt' => function (string $app, string $key, int $value, ?bool $lazy = false, bool $sensitive = false): bool {
                $this->app[$key] = $value;
                $this->appWrites[] = $key . '=' . $value . ($lazy ? ' lazy' : '');
                return true;
            },
            'deleteKey' => function (string $app, string $key): void {
                unset($this->app[$key]);
            },
        ]);
        $policy = new class() extends LinkPolicy {
            public function __construct() {
            }

            public function allows(string $ownerUid, ?IUser $known = null): bool {
                return true;
            }
        };
        $h = $this;
        $this->compactor = new class($this->items, $this->boards, $this->cache, $policy, new Limits($appConfig), $this->db, $appConfig, $h) extends Compactor {
            public function __construct(ItemStore $i, BoardStore $b, FastCache $c, LinkPolicy $p, Limits $l, IDBConnection $d, IAppConfig $a, private CompactorHarness $h) {
                parent::__construct($i, $b, $c, $p, $l, $d, $a);
            }

            protected function clockMs(): float {
                $this->h->clockCalls++;
                return ($this->h->clock)();
            }
        };
    }

    public static function over(ItemStore $items, BoardStore $boards): self {
        return new self($items, $boards);
    }

    /** A board row (rev = the highest rev the test will use). */
    public function board(int $rev, int $minRev = 0, string $owner = 'alice'): int {
        $id = $this->sql->addBoard($owner, 'B', $rev);
        $this->sql->pdo->prepare('UPDATE oc_knorke_boards SET min_rev = ?, updated_at = 7 WHERE id = ?')->execute([$minRev, $id]);
        return $id;
    }

    /**
     * $count item rows from rev $fromRev on, $perRev rows per rev (ids
     * 01JZ<board><n>), deleted or live, modified at $modifiedAt.
     */
    public function items(int $board, int $fromRev, int $count, int $perRev, bool $deleted, int $modifiedAt, int $idBase = 0): void {
        $st = $this->sql->pdo->prepare('INSERT INTO oc_knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, version, rev, deleted,'
            . ' created_by, created_at, modified_by, modified_at) VALUES (?, ?, \'sticky\', NULL, \'i1\', 0, 0, 200, 200, 0, \'{}\', \'{}\', 1, ?, ?, \'u:a\', 0, \'u:a\', ?)');
        $this->sql->pdo->beginTransaction();
        for ($i = 0; $i < $count; $i++) {
            $st->execute([$board, sprintf('01JZ%04d%018d', $board, $idBase + $i), $fromRev + intdiv($i, $perRev), $deleted ? 1 : 0, $modifiedAt]);
        }
        $this->sql->pdo->commit();
    }

    /** $count change rows from rev $fromRev on, $perRev rows per rev, written at $ts. */
    public function changes(int $board, int $fromRev, int $count, int $perRev, int $ts): void {
        $st = $this->sql->pdo->prepare('INSERT INTO oc_knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES (?, ?, ?, \'patch\', \'{}\', \'u:a\', \'c\', ?)');
        $this->sql->pdo->beginTransaction();
        for ($i = 0; $i < $count; $i++) {
            $st->execute([$board, $fromRev + intdiv($i, $perRev), sprintf('01JZ%04d%018d', $board, $i % $perRev), $ts]);
        }
        $this->sql->pdo->commit();
    }

    /**
     * One change row per entry of $patches (P7 byte cap): rev => list of
     * patch texts (null = a remove row without payload), item ids by
     * position, written at $ts.
     *
     * @param array<int, list<?string>> $patches
     */
    public function changesWith(int $board, array $patches, int $ts): void {
        $st = $this->sql->pdo->prepare('INSERT INTO oc_knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES (?, ?, ?, ?, ?, \'u:a\', \'c\', ?)');
        $this->sql->pdo->beginTransaction();
        foreach ($patches as $rev => $list) {
            foreach (array_values($list) as $i => $patch) {
                $st->execute([$board, $rev, sprintf('01JZ%04d%018d', $board, $i), $patch === null ? 'remove' : 'patch', $patch, $ts]);
            }
        }
        $this->sql->pdo->commit();
    }

    /** Σ octet length of the board's change rows (strlen in PHP, NULL = 0). */
    public function changeBytes(int $board): int {
        $sum = 0;
        foreach ($this->sql->all('SELECT patch FROM oc_knorke_changes WHERE board_id = ?', [$board]) as $r) {
            $sum += strlen((string)($r['patch'] ?? ''));
        }
        return $sum;
    }

    public function count(string $sql, array $params = []): int {
        return (int)$this->sql->one($sql, $params);
    }

    public function minRev(int $board): int {
        return $this->count('SELECT min_rev FROM oc_knorke_boards WHERE id = ?', [$board]);
    }

    /** @return list<int> the revs of the board's change rows, ascending (with repeats) */
    public function changeRevs(int $board): array {
        return array_map(static fn (array $r): int => (int)$r['rev'], $this->sql->all('SELECT rev FROM oc_knorke_changes WHERE board_id = ? ORDER BY rev, item_id', [$board]));
    }

    /** The SQL statements that ran, filtered by a prefix (e.g. 'DELETE FROM oc_knorke_items'). */
    public function statements(string $prefix): array {
        return array_values(array_filter($this->sql->statements, static fn (string $s): bool => str_starts_with($s, $prefix)));
    }
}
