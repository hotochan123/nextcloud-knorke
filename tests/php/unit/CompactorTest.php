<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Tests\Support\CompactorHarness;
use PHPUnit\Framework\TestCase;

/**
 * Tombstone purge, changes cap and 30-day cut (SPEC-M1 §4.13.7 with R19
 * T4-06, T4-07, T4-15; §8.2 (4)) on a real SQL engine (SQLite in memory):
 * X1/X2/Xz/X, blocks of PURGE_CHUNK rows plus the rows of the boundary rev,
 * min_rev monotonic through the CASE update, setGens after every block,
 * "Xz null" ends only the tombstone blocks, the cap keeps every row of rev
 * R, the board's 30-day cut, --board and --now semantics, the cursor and
 * the time budget of a run. All times are fixed numbers (no wall clock).
 */
final class CompactorTest extends TestCase {
    private const NOW = 1_760_000_000_000;
    private const DAY = 86400000;
    private const LINE_KEYS = ['board', 'blocks', 'tombstones', 'changes', 'minRevBefore', 'minRev'];
    private CompactorHarness $h;

    protected function setUp(): void {
        $this->h = new CompactorHarness();
    }

    private function tombstones(int $board): int {
        return $this->h->count('SELECT COUNT(*) FROM oc_knorke_items WHERE board_id = ? AND deleted = 1', [$board]);
    }

    private function live(int $board): int {
        return $this->h->count('SELECT COUNT(*) FROM oc_knorke_items WHERE board_id = ? AND deleted = 0', [$board]);
    }

    public function testTwelveThousandTombstonesInThreeBlocks(): void {
        // §8.2 (4): 12 000 tombstones older than the retention → three blocks,
        // min_rev monotonic. Three tombstones share each rev (1–4000): a block
        // ends at the rev of the 5000th oldest and takes the rows of that rev
        // along (5001 rows ≤ PURGE_CHUNK + 199).
        $b = $this->h->board(4100);
        $this->h->items($b, 1, 12000, 3, true, self::NOW - 40 * self::DAY);
        $this->h->items($b, 4001, 10, 1, false, self::NOW - 40 * self::DAY, 20000);
        $this->h->items($b, 4050, 5, 1, true, self::NOW - 1000, 30000);
        $minRevAtLock = [];
        $setsAtLock = [];
        $setsAtRaise = [];
        $this->h->sql->onStatement = function (string $sql) use ($b, &$minRevAtLock, &$setsAtLock, &$setsAtRaise): void {
            $sets = count(array_filter($this->h->mem->log, static fn (string $l): bool => $l === 'set a:' . $b));
            if (str_starts_with($sql, 'UPDATE oc_knorke_boards SET acl_gen')) {
                $minRevAtLock[] = (int)$this->h->sql->pdo->query('SELECT min_rev FROM oc_knorke_boards WHERE id = ' . $b)->fetchColumn();
                $setsAtLock[] = $sets;
            } elseif (str_starts_with($sql, 'UPDATE oc_knorke_boards SET min_rev')) {
                $setsAtRaise[] = $sets;
            }
        };
        $line = $this->h->compactor->board($b, self::NOW);
        $this->assertSame(['board' => $b, 'blocks' => 3, 'tombstones' => 12000, 'changes' => 0, 'minRevBefore' => 0, 'minRev' => 4000], $line);
        $this->assertSame(self::LINE_KEYS, array_keys($line));
        $this->assertSame([0, 1667, 3334, 4000], $minRevAtLock, 'min_rev before each block (the fourth finds nothing): monotonic steps X = 1667, 3334, 4000');
        $this->assertSame([0, 1, 2, 3], $setsAtLock, 'setGens after each block, before the next lock');
        $this->assertSame([0, 1, 2], $setsAtRaise, 'never before the block\'s own min_rev update (it follows its COMMIT)');
        $deletes = $this->h->statements('DELETE FROM oc_knorke_items');
        $this->assertCount(3, $deletes);
        $this->assertSame('DELETE FROM oc_knorke_items WHERE board_id = ? AND deleted = 1 AND rev <= ?', $deletes[0], 'a plain DELETE by rev: no LIMIT, no ORDER BY, no subquery');
        $this->assertSame([10, 5, 4000], [$this->live($b), $this->tombstones($b), $this->h->minRev($b)], 'live items and young tombstones stay');
        $this->assertSame([1, 1, 4000, 1, 1], $this->h->mem->get('a:' . $b), 'the new minRev on the fast path');
        $this->assertSame(['board' => $b, 'blocks' => 0, 'tombstones' => 0, 'changes' => 0, 'minRevBefore' => 4000, 'minRev' => 4000],
            $this->h->compactor->board($b, self::NOW), 'nothing due any more');
    }

    public function testABlockIsExactlyPurgeChunkWithOneTombstonePerRev(): void {
        // X = rev of the PURGE_CHUNK-oldest tombstone (OFFSET PURGE_CHUNK − 1):
        // with one tombstone per rev a block deletes exactly 5000 rows.
        $b = $this->h->board(10001);
        $this->h->items($b, 1, 10001, 1, true, self::NOW - 40 * self::DAY);
        $deleted = [];
        $this->h->sql->onStatement = function (string $sql) use ($b, &$deleted): void {
            if (str_starts_with($sql, 'UPDATE oc_knorke_boards SET acl_gen')) {
                $deleted[] = 10001 - (int)$this->h->sql->pdo->query('SELECT COUNT(*) FROM oc_knorke_items WHERE board_id = ' . $b)->fetchColumn();
            }
        };
        $line = $this->h->compactor->board($b, self::NOW);
        $this->assertSame([3, 10001, 10001], [$line['blocks'], $line['tombstones'], $line['minRev']]);
        $this->assertSame([0, 5000, 10000, 10001], $deleted, 'rows gone before each lock: 5000 per block, then the single rest');
    }

    public function testTheCapPurgesTheOldestButNeverWithin24Hours(): void {
        $this->h->app['tombstone_cap'] = 20;
        // 30 tombstones (one per rev) 2 days old: younger than the retention,
        // older than 24 h → X2 = min(rev of the 10th oldest, MAX(rev) older than 24 h) = 10.
        $b = $this->h->board(40);
        $this->h->items($b, 1, 30, 1, true, self::NOW - 2 * self::DAY);
        $this->assertSame(['blocks' => 1, 'tombstones' => 10, 'minRev' => 10],
            array_intersect_key($this->h->compactor->board($b, self::NOW), ['blocks' => 1, 'tombstones' => 1, 'minRev' => 1]));
        $this->assertSame(20, $this->tombstones($b), 'exactly the cap stays');
        // All younger than 24 h: X2 = null, nothing goes although cnt > cap.
        $young = $this->h->board(40);
        $this->h->items($young, 1, 30, 1, true, self::NOW - 3600000);
        $this->assertSame(0, $this->h->compactor->board($young, self::NOW)['blocks']);
        $this->assertSame(30, $this->tombstones($young));
        // Only revs 1–5 older than 24 h: the cap stops at rev 5.
        $mixed = $this->h->board(40);
        $this->h->items($mixed, 1, 5, 1, true, self::NOW - 2 * self::DAY);
        $this->h->items($mixed, 6, 25, 1, true, self::NOW - 3600000, 100);
        $line = $this->h->compactor->board($mixed, self::NOW);
        $this->assertSame([1, 5, 5], [$line['blocks'], $line['tombstones'], $line['minRev']]);
        $this->assertSame(25, $this->tombstones($mixed), 'the 24-h grace beats the cap');
    }

    public function testRetentionFromTheAppConfig(): void {
        $this->h->app['tombstone_days'] = 2;
        $b = $this->h->board(20);
        $this->h->items($b, 1, 4, 2, true, self::NOW - 3 * self::DAY);
        $this->h->items($b, 3, 4, 2, true, self::NOW - 1 * self::DAY, 50);
        $line = $this->h->compactor->board($b, self::NOW);
        $this->assertSame([1, 4, 2], [$line['blocks'], $line['tombstones'], $line['minRev']], 'tombstone_days 2: the 3-day old ones (revs 1–2) go');
        $this->assertSame(4, $this->tombstones($b));
    }

    public function testMinRevNeverGoesDown(): void {
        // CASE WHEN min_rev < X: a min_rev already above X (set-min-rev, a
        // concurrent purge) stays; setGens carries the higher one.
        $b = $this->h->board(60, 50);
        $this->h->items($b, 1, 10, 1, true, self::NOW - 40 * self::DAY);
        $this->assertSame(['board' => $b, 'blocks' => 1, 'tombstones' => 10, 'changes' => 0, 'minRevBefore' => 50, 'minRev' => 50],
            $this->h->compactor->board($b, self::NOW));
        $this->assertSame(50, $this->h->minRev($b));
        $this->assertSame(50, $this->h->mem->get('a:' . $b)[2]);
    }

    public function testChangesCapKeepsExactlyTheNewestRevs(): void {
        // T4-06, C79 in small: one row per rev, cap 50 → exactly the 50 highest revs stay.
        $this->h->app['changes_cap'] = 50;
        $b = $this->h->board(120);
        $this->h->changes($b, 1, 120, 1, self::NOW - 1000);
        $line = $this->h->compactor->board($b, self::NOW);
        $this->assertSame([0, 70], [$line['blocks'], $line['changes']], 'no tombstones due: the cap runs anyway ("Xz null" ends only the tombstones)');
        $this->assertSame(range(71, 120), $this->h->changeRevs($b));
        // Three rows per rev: R = rev of the 50th newest row (24); every row of R stays.
        $c = $this->h->board(40);
        $this->h->changes($c, 1, 120, 3, self::NOW - 1000);
        $this->assertSame(69, $this->h->compactor->board($c, self::NOW)['changes']);
        $revs = $this->h->changeRevs($c);
        $this->assertSame([51, 24, 40], [count($revs), $revs[0], $revs[50]], 'at least the cap, all rows of rev R');
        // At most the cap: nothing.
        $d = $this->h->board(50);
        $this->h->changes($d, 1, 50, 1, self::NOW - 1000);
        $this->assertSame(0, $this->h->compactor->board($d, self::NOW)['changes']);
        $this->assertCount(50, $this->h->changeRevs($d));
    }

    public function testChangesCapInBlocksOfFiveThousand(): void {
        $this->h->app['changes_cap'] = 1000;
        $b = $this->h->board(12000);
        $this->h->changes($b, 1, 12000, 1, self::NOW - 1000);
        $this->assertSame(11000, $this->h->compactor->board($b, self::NOW)['changes']);
        $this->assertSame(range(11001, 12000), $this->h->changeRevs($b));
        $deletes = $this->h->statements('DELETE FROM oc_knorke_changes');
        $this->assertSame([
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ? AND rev <= ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ? AND rev <= ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND ts < ?',
        ], $deletes, 'two full blocks (≤ 5000 rows each), the rest, nothing below R any more; then the 30-day cut (nothing old)');
        $this->assertSame(ItemStore::PURGE_CHUNK, 5000);
    }

    // ---- P7: the byte cap of the change log (SPEC-M1 §33.1 c, ED-09; C81 (d) in small) ----

    /** A patch text of exactly $bytes bytes, made of $char (1, 2 or 4 bytes each; the rest padded with "x"). */
    private static function patchOf(int $bytes, string $char = 'x'): string {
        $head = '{"data.text":"';
        $room = $bytes - strlen($head) - 2;
        $n = intdiv($room, strlen($char));
        return $head . str_repeat($char, $n) . str_repeat('x', $room - $n * strlen($char)) . '"}';
    }

    public function testByteCapKeepsTheNewestRevsWithinTheCap(): void {
        // 40 revs with one 1000-byte row each, cap 20000: exactly the 20 newest stay.
        $this->h->app['changes_bytes_cap'] = '20000';
        $b = $this->h->board(40);
        $this->h->changesWith($b, array_fill_keys(range(1, 40), [self::patchOf(1000)]), self::NOW - 1000);
        $this->assertSame(40000, $this->h->changeBytes($b));
        $line = $this->h->compactor->board($b, self::NOW);
        $this->assertSame([0, 20], [$line['blocks'], $line['changes']], 'changes = rows deleted by the byte cap');
        $this->assertSame(range(21, 40), $this->h->changeRevs($b), 'the newest revs');
        $this->assertSame(20000, $this->h->changeBytes($b), '≤ the cap, and the next older row would exceed it');
        $this->assertSame(0, $this->h->compactor->board($b, self::NOW)['changes'], 'a second pass deletes nothing');
    }

    public function testByteCapCountsOctetsNotCharacters(): void {
        // Two-byte "ä": 10 revs of 1000 bytes (≈ 500 characters each), cap 5500 → 5 revs stay
        // (5000 ≤ 5500 < 6000). Character counting would keep all 10 (≈ 5000 characters).
        $this->h->app['changes_bytes_cap'] = '5500';
        $b = $this->h->board(10);
        $this->h->changesWith($b, array_fill_keys(range(1, 10), [self::patchOf(1000, 'ä')]), self::NOW - 1000);
        $this->assertSame(10000, $this->h->changeBytes($b));
        $this->assertSame(5, $this->h->compactor->board($b, self::NOW)['changes']);
        $this->assertSame(range(6, 10), $this->h->changeRevs($b));
        // Four-byte emoji the same way.
        $c = $this->h->board(10);
        $this->h->changesWith($c, array_fill_keys(range(1, 10), [self::patchOf(1000, '😀')]), self::NOW - 1000);
        $this->assertSame(5, $this->h->compactor->board($c, self::NOW)['changes']);
    }

    public function testByteCapSumsPerRevAndTheNewestRevAlwaysStays(): void {
        // Rows of one rev count together; NULL (remove rows) is 0.
        $this->h->app['changes_bytes_cap'] = '3000';
        $b = $this->h->board(5);
        $this->h->changesWith($b, [
            1 => [self::patchOf(500)],
            2 => [self::patchOf(1000), self::patchOf(1000)],
            3 => [null, null, null],
            4 => [self::patchOf(1000), null],
            5 => [self::patchOf(900)],
        ], self::NOW - 1000);
        // Newest first: 5 → 900, 4 → 1900, 3 → 1900, 2 → 3900 > 3000: R_bytes = 3, rows of revs 1 and 2 go.
        $this->assertSame(3, $this->h->compactor->board($b, self::NOW)['changes']);
        $this->assertSame([3, 3, 3, 4, 4, 5], $this->h->changeRevs($b));
        // The newest rev alone over the cap: it stays, everything older goes.
        $this->h->app['changes_bytes_cap'] = '1000';
        $c = $this->h->board(3);
        $this->h->changesWith($c, [1 => [self::patchOf(100)], 2 => [self::patchOf(100)], 3 => [self::patchOf(1500), self::patchOf(1500)]], self::NOW - 1000);
        $this->assertSame(2, $this->h->compactor->board($c, self::NOW)['changes']);
        $this->assertSame([3, 3], $this->h->changeRevs($c));
        // Only one rev and it is over: nothing to delete.
        $this->assertSame(0, $this->h->compactor->board($c, self::NOW)['changes']);
        $this->assertSame(3000, $this->h->changeBytes($c));
    }

    public function testByteCapOffAndAtOrBelowTheCap(): void {
        $b = $this->h->board(10);
        $this->h->changesWith($b, array_fill_keys(range(1, 10), [self::patchOf(1000)]), self::NOW - 1000);
        foreach (['0', 'abc', '10000'] as $cap) {
            $this->h->app['changes_bytes_cap'] = $cap;
            $this->assertSame(0, $this->h->compactor->board($b, self::NOW)['changes'], 'cap ' . $cap . ': 0 = off, text = the default 64 MiB, exactly the total = nothing');
        }
        $this->assertCount(10, $this->h->changeRevs($b));
        $this->assertSame(67108864, (new \OCA\Knorke\Service\Limits(\OCA\Knorke\Tests\Support\Fake::of(\OCP\IAppConfig::class)))->changesBytesCap());
    }

    public function testByteCapReadsAndDeletesInBlocks(): void {
        // 12 000 revs of exactly 10 bytes, cap 50 000: the boundary read needs a
        // second block of PURGE_CHUNK revs; 7000 rows go in blocks of ≤ 5000.
        $this->h->app['changes_bytes_cap'] = '50000';
        $b = $this->h->board(12000);
        $this->h->changesWith($b, array_fill_keys(range(1, 12000), ['{"x":"12"}']), self::NOW - 1000);
        $this->assertSame(120000, $this->h->changeBytes($b));
        $this->h->sql->statements = [];
        $this->assertSame(7000, $this->h->compactor->board($b, self::NOW)['changes']);
        $this->assertSame(range(7001, 12000), $this->h->changeRevs($b));
        $sums = $this->h->statements('SELECT rev, SUM(LENGTH(CAST(patch AS BLOB)))');
        $this->assertCount(2, $sums, 'two blocks of the boundary read, newest first');
        $this->assertStringContainsString('ORDER BY rev DESC LIMIT 5000', $sums[0]);
        $this->assertSame([
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ? AND rev <= ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND rev < ?',
            'DELETE FROM oc_knorke_changes WHERE board_id = ? AND ts < ?',
        ], $this->h->statements('DELETE FROM oc_knorke_changes'), 'byte cap: one full block, the rest, then nothing; then the 30-day cut');
    }

    public function testByteCapAndRowCapTakeTheStricterBoundary(): void {
        // rev < max(R_rows, R_bytes): the row cap keeps 30, the byte cap 10 → 10 stay; and the other way round.
        $this->h->app['changes_cap'] = 30;
        $this->h->app['changes_bytes_cap'] = '10000';
        $b = $this->h->board(50);
        $this->h->changesWith($b, array_fill_keys(range(1, 50), [self::patchOf(1000)]), self::NOW - 1000);
        $this->assertSame(40, $this->h->compactor->board($b, self::NOW)['changes'], '20 by the row cap, 20 by the byte cap');
        $this->assertSame(range(41, 50), $this->h->changeRevs($b));
        $this->h->app['changes_cap'] = 5;
        $c = $this->h->board(50);
        $this->h->changesWith($c, array_fill_keys(range(1, 50), [self::patchOf(1000)]), self::NOW - 1000);
        $this->assertSame(45, $this->h->compactor->board($c, self::NOW)['changes']);
        $this->assertSame(range(46, 50), $this->h->changeRevs($c));
    }

    public function testRunAppliesTheByteCapToo(): void {
        // CleanupJob / compact without --board (a): every board, the same rule.
        $this->h->app['changes_bytes_cap'] = '2000';
        $b = $this->h->board(5);
        $this->h->changesWith($b, array_fill_keys(range(1, 5), [self::patchOf(1000)]), self::NOW - 1000);
        $r = $this->h->compactor->run(self::NOW);
        $this->assertSame([[$b, 3]], array_map(static fn (array $l): array => [$l['board'], $l['changes']], $r['boards']));
        $this->assertSame([4, 5], $this->h->changeRevs($b));
    }

    public function testThirtyDayCutOfOneBoardOnly(): void {
        $b = $this->h->board(30);
        $other = $this->h->board(30);
        $this->h->changes($b, 1, 10, 1, self::NOW - 31 * self::DAY);
        $this->h->changes($b, 11, 5, 1, self::NOW - self::DAY);
        $this->h->changes($other, 1, 10, 1, self::NOW - 31 * self::DAY);
        $this->assertSame(10, $this->h->compactor->board($b, self::NOW)['changes']);
        $this->assertSame(range(11, 15), $this->h->changeRevs($b));
        $this->assertCount(10, $this->h->changeRevs($other), '--board touches no other board');
        $this->assertSame([], $this->h->statements('DELETE FROM oc_knorke_changes WHERE ts'), 'no instance-wide pruning with --board');
        $this->assertSame([], $this->h->appWrites, 'the cursor stays untouched');
    }

    public function testNowOnlyMovesTheCuts(): void {
        // --now (c): tombstones of "now" are 31 days old at now + 31 days; nothing written carries the clock.
        $b = $this->h->board(10);
        $this->h->items($b, 1, 3, 1, true, self::NOW);
        $this->h->changes($b, 1, 3, 1, self::NOW);
        $before = $this->h->sql->all('SELECT acl_gen, link_gen, vote_link_gen, updated_at, rev FROM oc_knorke_boards WHERE id = ?', [$b]);
        $this->assertSame(0, $this->h->compactor->board($b, self::NOW)['blocks']);
        $line = $this->h->compactor->board($b, self::NOW + 31 * self::DAY);
        $this->assertSame([1, 3, 3, 3], [$line['blocks'], $line['tombstones'], $line['changes'], $line['minRev']]);
        $this->assertSame($before, $this->h->sql->all('SELECT acl_gen, link_gen, vote_link_gen, updated_at, rev FROM oc_knorke_boards WHERE id = ?', [$b]),
            'the lock bumps nothing and writes no time');
    }

    public function testUnknownBoard(): void {
        $this->assertNull($this->h->compactor->board(999, self::NOW));
    }

    public function testRunWalksTheBoardsAfterTheCursorAndStoresIt(): void {
        $ids = [];
        for ($i = 0; $i < 3; $i++) {
            $ids[] = $b = $this->h->board(5);
            $this->h->items($b, 1, 5, 1, true, self::NOW - 40 * self::DAY);
        }
        $this->h->changes($ids[0], 1, 2, 1, self::NOW - 31 * self::DAY);
        $out = [];
        $r = $this->h->compactor->run(self::NOW, function (array $l) use (&$out): void {
            $out[] = $l['board'];
        });
        $this->assertSame([$ids, true], [array_column($r['boards'], 'board'), $r['complete']]);
        $this->assertSame($ids, $out, 'the callback sees every line as it is done');
        $this->assertSame([5, 5, 5], array_map(fn (int $b): int => $this->h->minRev($b), $ids));
        $this->assertSame(2, $r['changes'], 'instance-wide 30-day pruning first, as before');
        $this->assertSame(['cleanup_cursor=' . $ids[2] . ' lazy'], $this->h->appWrites, 'the last finished board, once, lazy');
        // The next run starts after the cursor and wraps around.
        $this->h->app['cleanup_cursor'] = $ids[0];
        $this->assertSame([$ids[1], $ids[2], $ids[0]], array_column($this->h->compactor->run(self::NOW)['boards'], 'board'));
    }

    public function testTheTimeBudgetStopsAndTheNextRunResumes(): void {
        $ids = [];
        for ($i = 0; $i < 3; $i++) {
            $ids[] = $b = $this->h->board(5);
            $this->h->items($b, 1, 5, 1, true, self::NOW - 40 * self::DAY);
        }
        // The budget clock jumps past 60 s once two tombstone blocks are done:
        // board 1 finished, board 2 interrupted after its block.
        $this->h->clock = fn (): float => count($this->h->statements('DELETE FROM oc_knorke_items')) >= 2 ? 1e9 : 0.0;
        $r = $this->h->compactor->run(self::NOW);
        $this->assertFalse($r['complete']);
        $this->assertSame([[$ids[0], 1], [$ids[1], 1]], array_map(static fn (array $l): array => [$l['board'], $l['blocks']], $r['boards']), 'the interrupted board still reports its line');
        $this->assertSame(['cleanup_cursor=' . $ids[0] . ' lazy'], $this->h->appWrites, 'the cursor stays at the last FINISHED board');
        $this->assertSame([0, 0, 5], array_map(fn (int $b): int => $this->tombstones($b), $ids));
        // Next run: resumes with the interrupted board (its finished block is not repeated).
        $this->h->clock = static fn (): float => 0.0;
        $r = $this->h->compactor->run(self::NOW);
        $this->assertSame([[$ids[1], 0], [$ids[2], 1], [$ids[0], 0]], array_map(static fn (array $l): array => [$l['board'], $l['blocks']], $r['boards']));
        $this->assertTrue($r['complete']);
        $this->assertSame([0, 0, 0], array_map(fn (int $b): int => $this->tombstones($b), $ids));
        // A budget used up before the first board: nothing touched, no cursor write.
        $this->h->appWrites = [];
        $this->h->clock = fn (): float => $this->h->clockCalls > 1 ? 1e9 : 0.0;
        $this->h->clockCalls = 0;
        $r = $this->h->compactor->run(self::NOW);
        $this->assertSame([[], false, []], [$r['boards'], $r['complete'], $this->h->appWrites]);
    }
}
