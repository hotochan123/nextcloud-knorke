<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Db\PrimaryReads;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Compactor;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\IAppConfig;
use OCP\ICacheFactory;
use OCP\Server;

/**
 * Stage 4 on the real database of the dev stack — every KD_DB kind
 * (PostgreSQL, MariaDB, MySQL, also utf8mb3, SQLite) — and its Redis
 * (SPEC-M1 §4.13.6, §4.13.7, §8.2 integration, R19 T4-15):
 *
 *  - 12 000 tombstones older than the retention → three blocks, min_rev
 *    monotonic; a SECOND PROCESS (own connection) keeps asking for the
 *    board row lock and measures how long it waits per block: gate < 1 s
 *    per block on every kind, < 200 ms is the target (reported, [WP-B4]);
 *  - the cap with its 24-h grace, the changes cap (exactly the newest revs,
 *    all rows of rev R, blocks of 5000) and the board's 30-day cut: the
 *    block boundaries are SELECTs with LIMIT/OFFSET of the query builder,
 *    the DELETEs plain `rev <= ?` — the dialects differ in exactly this;
 *  - occ knorke:compact (the <commands> entry, exit codes, the JSON line);
 *  - a run of CleanupJob (cursor as a lazy int app config);
 *  - the write budget on real Redis (TTL of w:/wo:, busy, derived rows of a
 *    keep patch on a frame with 2500 children) and the snapshot throttle
 *    on Nextcloud's real ILimiter.
 */
final class CleanupIntegrationTest extends IntegrationCase {
    private const DAY = 86400000;

    /** A Compactor of the real services with optional caps (no app config is written). */
    private function compactor(?int $tombstoneCap = null, ?int $changesCap = null, ?BoardStore $boards = null, ?FastCache $cache = null): Compactor {
        $limits = new class(Server::get(IAppConfig::class), $tombstoneCap, $changesCap) extends Limits {
            public function __construct(IAppConfig $c, private ?int $tCap, private ?int $cCap) {
                parent::__construct($c);
            }

            public function tombstoneCap(): int {
                return $this->tCap ?? parent::tombstoneCap();
            }

            public function changesCap(): int {
                return $this->cCap ?? parent::changesCap();
            }
        };
        return new Compactor($this->items, $boards ?? $this->boards, $cache ?? $this->cache, Server::get(LinkPolicy::class), $limits, $this->db, Server::get(IAppConfig::class));
    }

    /** $count item rows from rev $fromRev on, $perRev per rev, multi-row INSERTs of 500. */
    private function itemRows(int $b, int $fromRev, int $count, int $perRev, bool $deleted, int $modifiedAt, int $idBase = 0, ?string $parent = null, string $type = 'sticky'): void {
        for ($start = 0; $start < $count; $start += 500) {
            $n = min(500, $count - $start);
            $values = [];
            $params = [];
            for ($i = $start; $i < $start + $n; $i++) {
                $values[] = "(?, ?, '$type', ?, 'i1', 10, 10, 200, 200, 0, '{}', '{}', 1, ?, ?, 'u:it', 0, 'u:it', ?)";
                array_push($params, $b, sprintf('01JY%022d', $idBase + $i), $parent, $fromRev + intdiv($i, $perRev), $deleted ? 1 : 0, $modifiedAt);
            }
            $this->db->executeStatement('INSERT INTO *PREFIX*knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, version, rev, deleted,'
                . ' created_by, created_at, modified_by, modified_at) VALUES ' . implode(', ', $values), $params);
        }
    }

    /** $count change rows from rev $fromRev on, $perRev per rev, written at $ts. */
    private function changeRows(int $b, int $fromRev, int $count, int $perRev, int $ts): void {
        for ($start = 0; $start < $count; $start += 500) {
            $n = min(500, $count - $start);
            $values = [];
            $params = [];
            for ($i = $start; $i < $start + $n; $i++) {
                $values[] = "(?, ?, ?, 'patch', '{}', 'u:it', 'cIt', ?)";
                array_push($params, $b, $fromRev + intdiv($i, $perRev), sprintf('01JY%022d', $i % $perRev), $ts);
            }
            $this->db->executeStatement('INSERT INTO *PREFIX*knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES ' . implode(', ', $values), $params);
        }
    }

    /** The database of the report lines: provider (mariadb apart from mysql) and, on MySQL/MariaDB, the 4-byte setting. */
    private static function dbLabel(): string {
        $db = Server::get(\OCP\IDBConnection::class);
        return $db->getDatabaseProvider(true) . (self::dbKind() === 'mysql' ? ($db->supports4ByteText() ? ' utf8mb4' : ' utf8mb3') : '');
    }

    private function setRev(int $b, int $rev, int $minRev = 0): void {
        $this->db->executeStatement('UPDATE *PREFIX*knorke_boards SET rev = ?, min_rev = ? WHERE id = ?', [$rev, $minRev, $b]);
    }

    private function one(string $sql, array $params): int {
        return (int)$this->db->executeQuery($sql, $params)->fetchOne();
    }

    private function tombstones(int $b): int {
        return $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 1', [$b]);
    }

    /** @return list<int> */
    private function changeRevs(int $b): array {
        return array_map('intval', $this->db->executeQuery('SELECT rev FROM *PREFIX*knorke_changes WHERE board_id = ? ORDER BY rev, item_id', [$b])->fetchFirstColumn());
    }

    /**
     * A second PHP process with its own connection (SPEC-M1 §8.2 R19): on
     * every "go" line it asks for the board row lock at once (lockBoard's
     * statement in its own transaction) and records how long it waited. The
     * test sends "go" right after a block took the lock, so each wait is
     * the time a writer would wait for that block; "stop" ends it.
     *
     * @return array{0: resource, 1: array} [process, pipes]
     */
    private function lockProber(int $b): array {
        [$dsn, $user, $pass, $prefix] = self::pdoParams();
        $code = <<<'CHILD'
            $kind = getenv('KT_KIND');
            // SQLite: no busy timeout of the driver (its handler sleeps in coarse
            // steps and would smear the wait over two blocks); the loop below
            // retries every 0.2 ms instead.
            $pdo = new PDO(getenv('KT_DSN'), getenv('KT_USER'), getenv('KT_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => $kind === 'sqlite' ? 0 : 10]);
            if ($kind === 'pgsql') {
                $pdo->exec("SET lock_timeout = '10s'");
            } elseif ($kind === 'mysql') {
                $pdo->exec('SET SESSION innodb_lock_wait_timeout = 10');
            }
            $sql = 'UPDATE ' . getenv('KT_PREFIX') . 'knorke_boards SET acl_gen = acl_gen + 0, link_gen = link_gen + 0, vote_link_gen = vote_link_gen + 0 WHERE id = ' . (int)getenv('KT_BOARD');
            fwrite(STDOUT, "ready\n");
            fflush(STDOUT);
            $waits = [];
            while (($line = fgets(STDIN)) !== false && trim($line) === 'go') {
                $t0 = microtime(true);
                if ($kind === 'sqlite') {
                    while (true) {
                        try {
                            $pdo->exec('BEGIN IMMEDIATE');
                            break;
                        } catch (PDOException $e) {
                            if ((int)($e->errorInfo[1] ?? 0) !== 5 || microtime(true) - $t0 > 10) {
                                throw $e;
                            }
                            usleep(200);
                        }
                    }
                    $pdo->exec($sql);
                    $pdo->exec('COMMIT');
                } else {
                    $pdo->beginTransaction();
                    $pdo->exec($sql);
                    $pdo->commit();
                }
                $waits[] = round((microtime(true) - $t0) * 1000, 1);
            }
            fwrite(STDOUT, json_encode(['waits' => $waits]) . "\n");
            CHILD;
        $env = getenv() + ['KT_DSN' => $dsn, 'KT_USER' => $user, 'KT_PASS' => $pass, 'KT_PREFIX' => $prefix, 'KT_BOARD' => (string)$b, 'KT_KIND' => self::dbKind()];
        $proc = proc_open([PHP_BINARY, '-r', $code], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        $this->assertIsResource($proc);
        $line = fgets($pipes[1]);
        if ($line !== "ready\n") {
            $this->fail('lock prober did not start: ' . var_export($line, true) . ' ' . stream_get_contents($pipes[2]));
        }
        return [$proc, $pipes];
    }

    /** @return array{waits: list<float>} waits in ms, one per "go" */
    private function stopProber(array $prober): array {
        [$proc, $pipes] = $prober;
        fwrite($pipes[0], "stop\n");
        fclose($pipes[0]);
        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);
        $this->assertSame(0, $code, 'lock prober: ' . $err);
        return json_decode((string)$out, true, 8, JSON_THROW_ON_ERROR);
    }

    /** occ in a child process (www-data, same instance); [exit code, stdout, stderr]. */
    private function occ(array $args): array {
        $proc = proc_open([PHP_BINARY, \OC::$SERVERROOT . '/occ', ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, \OC::$SERVERROOT, getenv());
        $this->assertIsResource($proc);
        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return [proc_close($proc), (string)$out, (string)$err];
    }

    public function testTwelveThousandTombstonesInThreeBlocksWithAShortLock(): void {
        $now = self::nowMs();
        $b = $this->board();
        $this->setRev($b, 4100);
        $this->itemRows($b, 1, 12000, 3, true, $now - 40 * self::DAY);
        $this->itemRows($b, 4001, 10, 1, false, $now - 40 * self::DAY, 20000);
        $this->itemRows($b, 4050, 5, 1, true, $now - 1000, 30000);
        $this->db->executeStatement('UPDATE *PREFIX*knorke_boards SET item_count = 10, item_bytes = 40 WHERE id = ?', [$b]);
        // Block windows: the lock is held from lockBoard's return to setGens
        // (called after COMMIT); min_rev as each block found it. Right after
        // the lock is taken, the second process is told to ask for it too.
        $events = new \ArrayObject();
        $prober = $this->lockProber($b);
        $go = static function () use ($prober): void {
            fwrite($prober[1][0], "go\n");
            fflush($prober[1][0]);
        };
        $boards = new class(Server::get(\OCP\IDBConnection::class), Server::get(PrimaryReads::class), $events, $go) extends BoardStore {
            public function __construct(\OCP\IDBConnection $db, ?PrimaryReads $p, private \ArrayObject $events, private \Closure $go) {
                parent::__construct($db, $p);
            }

            public function lockBoard(int $board, bool $bumpAcl, ?string $bumpLinkRole, int $nowMs): ?array {
                $row = parent::lockBoard($board, $bumpAcl, $bumpLinkRole, $nowMs);
                $this->events[] = ['lock', microtime(true), $row['min_rev'] ?? null];
                ($this->go)();
                return $row;
            }
        };
        $cache = new class(Server::get(ICacheFactory::class), Server::get(Epoch::class), $events) extends FastCache {
            public function __construct(ICacheFactory $f, Epoch $e, private \ArrayObject $events) {
                parent::__construct($f, $e);
            }

            public function setGens(int $b, int $acl, int $link, int $minRev, bool $links, int $voteLink): void {
                $this->events[] = ['gens', microtime(true), $minRev];
                parent::setGens($b, $acl, $link, $minRev, $links, $voteLink);
            }
        };
        try {
            $t0 = microtime(true);
            $line = $this->compactor(null, null, $boards, $cache)->board($b, $now);
            $total = microtime(true) - $t0;
        } finally {
            $probe = $this->stopProber($prober);
        }
        $this->assertSame(['board' => $b, 'blocks' => 3, 'tombstones' => 12000, 'changes' => 0, 'minRevBefore' => 0, 'minRev' => 4000], $line);
        $locks = array_values(array_filter($events->getArrayCopy(), static fn (array $e): bool => $e[0] === 'lock'));
        $gens = array_values(array_filter($events->getArrayCopy(), static fn (array $e): bool => $e[0] === 'gens'));
        $this->assertSame([0, 1667, 3334, 4000], array_column($locks, 2), 'min_rev monotonic: X = 1667, 3334, 4000 (the fourth lock finds nothing)');
        $this->assertSame([1667, 3334, 4000], array_column($gens, 2), 'setGens after every block');
        $this->assertSame([10, 5, 4000], [
            $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0', [$b]),
            $this->tombstones($b),
            $this->one('SELECT min_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$b]),
        ]);
        $this->assertSame([10, 40, 4100], [
            $this->one('SELECT item_count FROM *PREFIX*knorke_boards WHERE id = ?', [$b]),
            $this->one('SELECT item_bytes FROM *PREFIX*knorke_boards WHERE id = ?', [$b]),
            $this->dbRev($b),
        ], 'item_count, item_bytes and rev untouched (C78)');
        $this->assertSame([1, 1, 4000, 1, 1], $this->redis->get('a:' . $b), 'the new minRev on the fast path');
        // Per block: the hold (lock → after COMMIT) and the wait of the second process asking inside it.
        $holds = [];
        for ($k = 0; $k < 3; $k++) {
            $holds[] = (int)round(($gens[$k][1] - $locks[$k][1]) * 1000);
        }
        $this->assertCount(4, $probe['waits'], 'one lock request of the second process per lock (three blocks and the empty fourth)');
        $waits = array_slice($probe['waits'], 0, 3);
        fwrite(STDERR, sprintf("\n[WP-B4] %s: 12000 tombstones purged in 3 blocks (%.0f ms in all); lock held per block %s ms; a second process asking during each block waited %s ms (gate < 1000, target < 200; the empty fourth lock: %s ms)\n",
            self::dbLabel(), $total * 1000, implode('/', $holds), implode('/', $waits), $probe['waits'][3]));
        foreach ([...$holds, ...$probe['waits']] as $ms) {
            $this->assertLessThan(1000, $ms, 'gate: < 1 s per block');
        }
    }

    public function testCapGraceChangesCapAndThirtyDays(): void {
        $now = self::nowMs();
        // The tombstone cap (20) with its 24-h grace: only revs 1–5 are older than 24 h.
        $b = $this->board();
        $this->setRev($b, 40);
        $this->itemRows($b, 1, 5, 1, true, $now - 2 * self::DAY);
        $this->itemRows($b, 6, 25, 1, true, $now - 3600000, 100);
        $line = $this->compactor(20)->board($b, $now);
        $this->assertSame([1, 5, 5, 25], [$line['blocks'], $line['tombstones'], $line['minRev'], $this->tombstones($b)], 'the grace beats the cap');
        // changes cap 50, one row per rev: exactly the 50 newest revs.
        $c = $this->board();
        $this->setRev($c, 120);
        $this->changeRows($c, 1, 120, 1, $now);
        $this->assertSame(70, $this->compactor(null, 50)->board($c, $now)['changes']);
        $this->assertSame(range(71, 120), $this->changeRevs($c));
        // three rows per rev: all rows of rev R stay.
        $d = $this->board();
        $this->setRev($d, 40);
        $this->changeRows($d, 1, 120, 3, $now);
        $this->assertSame(69, $this->compactor(null, 50)->board($d, $now)['changes']);
        $revs = $this->changeRevs($d);
        $this->assertSame([51, 24, 40], [count($revs), $revs[0], $revs[50]]);
        // blocks of 5000: 12 000 rows, cap 1000 → 1000 stay.
        $e = $this->board();
        $this->setRev($e, 12000);
        $this->changeRows($e, 1, 12000, 1, $now);
        $t0 = microtime(true);
        $this->assertSame(11000, $this->compactor(null, 1000)->board($e, $now)['changes']);
        $ms = (microtime(true) - $t0) * 1000;
        $this->assertSame(range(11001, 12000), $this->changeRevs($e));
        // the board's 30-day cut only: another board's old rows stay.
        $f = $this->board();
        $g = $this->board();
        $this->changeRows($f, 1, 10, 1, $now - 31 * self::DAY);
        $this->changeRows($f, 11, 5, 1, $now - self::DAY);
        $this->changeRows($g, 1, 10, 1, $now - 31 * self::DAY);
        $this->assertSame(10, $this->compactor()->board($f, $now)['changes']);
        $this->assertSame(range(11, 15), $this->changeRevs($f));
        $this->assertCount(10, $this->changeRevs($g));
        fwrite(STDERR, sprintf("\n[WP-B4] %s: changes cap 12000 → 1000 rows in blocks of 5000: %.0f ms\n", self::dbLabel(), $ms));
    }

    public function testOccCompactCommand(): void {
        $now = self::nowMs();
        $b = $this->board();
        $this->setRev($b, 6);
        $this->itemRows($b, 1, 6, 2, true, $now - 40 * self::DAY);
        [$code, $out, $err] = $this->occ(['knorke:compact', '--board=' . $b]);
        $this->assertSame(0, $code, $out . $err);
        $lines = array_values(array_filter(explode("\n", $out), static fn (string $l): bool => str_starts_with($l, '{')));
        $this->assertSame(['{"board":' . $b . ',"blocks":1,"tombstones":6,"changes":0,"minRevBefore":0,"minRev":3}'], $lines, 'one JSON line on stdout');
        [$code, $out, $err] = $this->occ(['knorke:compact', '--board=999999999']);
        $this->assertSame([1, ''], [$code, trim($out)], $err);
        $this->assertStringContainsString('Board 999999999 not found.', $err);
        [$code] = $this->occ(['knorke:compact', '--board=x']);
        $this->assertSame(2, $code);
        [$code, $out] = $this->occ(['list', 'knorke']);
        $this->assertSame(0, $code);
        $this->assertStringContainsString('knorke:compact', $out, 'registered through <commands> (info.xml)');
        $this->assertStringContainsString('knorke:epoch:rotate', $out);
    }

    public function testCleanupRunStoresTheCursor(): void {
        $now = self::nowMs();
        $ids = [$this->board(), $this->board()];
        foreach ($ids as $b) {
            $this->setRev($b, 3);
            $this->itemRows($b, 1, 3, 1, true, $now - 40 * self::DAY);
        }
        $config = Server::get(IAppConfig::class);
        $had = $config->hasKey('knorke', Compactor::CURSOR_KEY, null);
        $old = $had ? $config->getValueInt('knorke', Compactor::CURSOR_KEY, 0, true) : null;
        try {
            $config->deleteKey('knorke', Compactor::CURSOR_KEY);
            $r = $this->compactor()->run($now);
            $mine = array_values(array_filter($r['boards'], static fn (array $l): bool => in_array($l['board'], $ids, true)));
            $this->assertSame([[$ids[0], 1, 3], [$ids[1], 1, 3]], array_map(static fn (array $l): array => [$l['board'], $l['blocks'], $l['minRev']], $mine));
            $this->assertTrue($r['complete']);
            $this->assertSame(max(array_column($r['boards'], 'board')), $config->getValueInt('knorke', Compactor::CURSOR_KEY, 0, true), 'the last board of the run');
            $this->assertTrue($config->isLazy('knorke', Compactor::CURSOR_KEY), 'a lazy key: not in the preloaded set of every request');
        } finally {
            $config->deleteKey('knorke', Compactor::CURSOR_KEY);
            if ($old !== null) {
                $config->setValueInt('knorke', Compactor::CURSOR_KEY, $old, true);
            }
        }
    }

    public function testWriteBudgetOnRedis(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $now = intdiv(self::nowMs(), 10000) * 10000 + 3456;
        $sync = function (array $ops, int $seq) use ($b, $p, $now): array {
            $r = SyncRequest::fromBody(['proto' => 2, 'ep' => Server::get(Epoch::class)->current(), 'client' => 'cIt', 'since' => 0, 'seq' => $seq, 'ops' => $ops, 'pres' => 0]);
            return json_decode($this->sync->sync(new AccessResult($p, null, 0), $b, $r, $now), true, 512, JSON_THROW_ON_ERROR);
        };
        $win = intdiv($now, 10000);
        $wKey = 'w:' . $b . ':' . $p->pid . ':' . $win;
        $woKey = 'wo:' . $b . ':' . $p->pid . ':' . $win;
        try {
            $put = static fn (int $n): array => ['o' => 'put', 'id' => self::ulid(5000 + $n), 't' => 'sticky', 'p' => ['x' => $n, 'y' => 0, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null, 'data' => ['text' => ''], 'style' => ['fill' => '#a8d8f8']]];
            for ($i = 1; $i <= 60; $i++) {
                $this->assertSame(['ok'], $sync([$put($i)], $i)['acks']['res'], "request $i");
            }
            $ttl = $this->redis->getTTL($wKey);
            $this->assertTrue(is_int($ttl) && $ttl > 0 && $ttl <= 25, 'w: has a TTL ≤ 25 s, got ' . var_export($ttl, true));
            $this->assertTrue(($t = $this->redis->getTTL($woKey)) > 0 && $t <= 25);
            $rev = $this->dbRev($b);
            $d = $sync([$put(61)], 61);
            $this->assertSame(['seq' => 61, 'rev' => null, 'res' => ['busy'], 'retryMs' => (intdiv($d['now'], 10000) + 1) * 10000 - $d['now'] + 100], $d['acks']);
            $this->assertSame($rev, $this->dbRev($b), 'nothing applied');
            $this->assertSame(61, $this->redis->get($wKey));
        } finally {
            $this->redis->remove($wKey);
            $this->redis->remove($woKey);
        }
    }

    public function testKeepOnTwentyFiveHundredChildrenChargesTheNextRequest(): void {
        // C76 (c) on the real database: the keep patch is ok, its 2500
        // derived rows go on wo:, the next request of the same principal is busy.
        $b = $this->board();
        $p = $this->owner($b);
        $frame = self::ulid(9000);
        $this->db->executeStatement("INSERT INTO *PREFIX*knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, version, rev, deleted,"
            . " created_by, created_at, modified_by, modified_at) VALUES (?, ?, 'frame', NULL, 'h0', 0, 0, 20000, 20000, 0, '{\"title\":\"F\"}', '{}', 1, 1, 0, 'u:it', 0, 'u:it', 0)", [$b, $frame]);
        $this->itemRows($b, 2, 2500, 2500, false, self::nowMs(), 0, $frame);
        $this->setRev($b, 2);
        $this->db->executeStatement('UPDATE *PREFIX*knorke_boards SET item_count = 2501 WHERE id = ?', [$b]);
        $now = intdiv(self::nowMs(), 10000) * 10000 + 500;
        $win = intdiv($now, 10000);
        $woKey = 'wo:' . $b . ':' . $p->pid . ':' . $win;
        $wKey = 'w:' . $b . ':' . $p->pid . ':' . $win;
        try {
            [$rev, $res, $derived] = $this->sync->applyOpsCounted($p, $b, 'cIt', [['o' => 'patch', 'id' => $frame, 'keep' => true, 'p' => ['x' => -100, 'y' => -50, 'parent' => null]]], $now);
            $this->assertSame([['ok'], 2500], [$res, $derived]);
            $budget = Server::get(\OCA\Knorke\Service\WriteBudget::class);
            $this->assertNull($budget->check($p, $b, 1, $now), 'this request (1 op) still within the budget');
            $budget->charge($p, $b, $derived, $now);
            $this->assertSame(2501, $this->redis->get($woKey));
            $this->assertNotNull($budget->check($p, $b, 1, $now), 'the next request: busy');
        } finally {
            $this->redis->remove($woKey);
            $this->redis->remove($wKey);
        }
    }

    public function testSnapshotThrottleOnTheRealLimiter(): void {
        // Nextcloud's ILimiter on the dev stack's Redis: 30 per 60 s per gid
        // and IP, the 31st → 429 slow_down {retryMs 2000}. A random gid and
        // address: no other test shares the budget.
        $b = $this->board();
        $gid = 'gIt' . bin2hex(random_bytes(4));
        $ip = '10.250.' . random_int(0, 255) . '.' . random_int(1, 254);
        $g = new Principal('g:' . $gid, Role::Edit, 'Gina', $this->access->pid($b, 'g:' . $gid), true, null, 'guest');
        $access = Server::get(Access::class);
        for ($i = 1; $i <= 30; $i++) {
            $access->throttleGuestSnapshot($g, $b, $ip);
        }
        try {
            $access->throttleGuestSnapshot($g, $b, $ip);
            $this->fail('the 31st snapshot of the gid is throttled');
        } catch (HttpError $e) {
            $this->assertSame([429, 'slow_down', 2000], [$e->status, $e->error, $e->extra['retryMs'] ?? null]);
        }
    }
}
