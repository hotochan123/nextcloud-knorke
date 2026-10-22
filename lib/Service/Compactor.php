<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCP\AppFramework\Db\TTransactional;
use OCP\IAppConfig;
use OCP\IDBConnection;

/**
 * Tombstone purge, changes cap and 30-day cut per board (SPEC-M1 §4.13.7),
 * shared by CleanupJob and `occ knorke:compact`. Per board, in this order:
 *
 *  1. tombstone blocks: each ONE transaction with the board row lock first
 *     (BoardStore::lockBoard, serialised with the write path), then
 *     ItemStore::purgeTombstones (X, at most PURGE_CHUNK rows plus the rows
 *     of rev X, min_rev = max(min_rev, X)); after COMMIT FastCache::setGens
 *     with the new min_rev (the fast path sees it at once). min_rev rises
 *     monotonically in steps, every intermediate state is correct on its
 *     own: a client with since < min_rev resyncs (the slow path reads
 *     min_rev again after its page, §4.13.8 step 7). "Xz null" ends ONLY
 *     the tombstone blocks;
 *  2. the changes cap (ItemStore::pruneChangesCap), blocks of at most
 *     PURGE_CHUNK rows, each its own short transaction without the board
 *     lock — also when no tombstone was due;
 *  2b. the byte cap (P7, SPEC-M1 §33.1 c, app config changes_bytes_cap,
 *     0 = off): R_bytes from ItemStore::changesBytesBoundary (read in
 *     blocks, newest revs first, only rev and length; the newest rev always
 *     stays), then the rows with rev < R_bytes in the same blocks
 *     (pruneChangesBelow). Together with step 2: rev < max(R_rows, R_bytes);
 *  3. the board's change rows older than 30 days (pruneBoardChanges), the
 *     same blocks.
 *
 * run() (CleanupJob, compact without --board, §4.13.7 (a)): the
 * instance-wide pruning of change rows and links as before, then the
 * boards after the app config `cleanup_cursor` (the last board a run
 * finished; ascending, wrapping around) within CLEANUP_BUDGET_MS (60 s,
 * checked between blocks; an interrupted board is resumed by the next run).
 * board() (compact --board=N, (b)): only that board, every block, no
 * budget, the cursor and the links untouched. $nowMs is the clock of the
 * cuts only (retention, 24-h grace of the cap, 30 days) — compact --now
 * (c); nothing written carries it.
 *
 * Every processed board yields one line (d):
 *   {board, blocks, tombstones, changes, minRevBefore, minRev}
 * blocks = tombstone blocks (transactions under the board lock that purged
 * tombstones and raised min_rev); tombstones and changes = deleted rows
 * (changes: both caps and the 30-day cut). The orphan reconciliation
 * (OrphanReconciler) is not part of the Compactor: CleanupJob runs it after
 * run(), occ knorke:compact never (ED-14).
 */
class Compactor {
    use TTransactional;

    /** App config: id of the last board a run finished (lazy int). */
    public const CURSOR_KEY = 'cleanup_cursor';

    public function __construct(
        private ItemStore $items,
        private BoardStore $boards,
        private FastCache $cache,
        private LinkPolicy $policy,
        private Limits $limits,
        private IDBConnection $db,
        private IAppConfig $appConfig,
    ) {
    }

    /**
     * One run of CleanupJob (SPEC-M1 §4.13.7 (a)).
     *
     * @param (callable(array): void)|null $onBoard receives the line of every processed board
     * @return array{changes: int, links: int, boards: list<array>, complete: bool} instance-wide
     *   deleted rows, the board lines, false when the time budget stopped the run early
     */
    public function run(int $nowMs, ?callable $onBoard = null): array {
        $cut = $nowMs - Limits::CHANGES_RETENTION_MS;
        $changes = $this->items->pruneChanges($cut);
        $links = $this->boards->pruneLinks($cut);
        $deadline = $this->clockMs() + Limits::CLEANUP_BUDGET_MS;
        $cursor = $this->cursor();
        $ids = $this->boards->boardIds();
        $order = array_merge(
            array_values(array_filter($ids, static fn (int $id): bool => $id > $cursor)),
            array_values(array_filter($ids, static fn (int $id): bool => $id <= $cursor)),
        );
        $lines = [];
        $finished = null;
        $complete = true;
        foreach ($order as $b) {
            if ($this->clockMs() > $deadline) {
                $complete = false;
                break;
            }
            [$line, $done] = $this->compactBoard($b, $nowMs, $deadline);
            if ($line !== null) {
                $lines[] = $line;
                if ($onBoard !== null) {
                    $onBoard($line);
                }
            }
            if (!$done) {
                $complete = false;
                break;
            }
            $finished = $b;
        }
        if ($finished !== null) {
            $this->setCursor($finished);
        }
        return ['changes' => $changes, 'links' => $links, 'boards' => $lines, 'complete' => $complete];
    }

    /**
     * Only board $board, every block, no time budget, cursor and links
     * untouched (SPEC-M1 §4.13.7 (b)).
     *
     * @return array{board: int, blocks: int, tombstones: int, changes: int, minRevBefore: int, minRev: int}|null
     *   null = no such board
     */
    public function board(int $board, int $nowMs): ?array {
        return $this->compactBoard($board, $nowMs, null)[0];
    }

    /**
     * @return array{0: ?array, 1: bool} [the board's line (null: no such board), finished]
     */
    private function compactBoard(int $b, int $nowMs, ?float $deadline): array {
        $before = $this->items->readMinRev($b);
        if ($before === null) {
            return [null, true];
        }
        $line = ['board' => $b, 'blocks' => 0, 'tombstones' => 0, 'changes' => 0, 'minRevBefore' => $before, 'minRev' => $before];
        $retentionCut = $nowMs - $this->limits->tombstoneRetentionMs();
        $cap = $this->limits->tombstoneCap();
        // 1) Tombstone blocks under the board lock.
        while (true) {
            if ($deadline !== null && $this->clockMs() > $deadline) {
                return [$this->finish($line), false];
            }
            $block = $this->atomic(function () use ($b, $retentionCut, $cap, $nowMs): ?array {
                $row = $this->boards->lockBoard($b, false, null, $nowMs);
                if ($row === null) {
                    return null;
                }
                $deleted = 0;
                $x = $this->items->purgeTombstones($b, $retentionCut, $cap, $nowMs, $deleted);
                return [$row, $x, $deleted];
            }, $this->db);
            if ($block === null) {
                // Deleted meanwhile: nothing left to do.
                return [$this->finish($line), true];
            }
            [$row, $x, $deleted] = $block;
            if ($x === null) {
                break;
            }
            // After COMMIT: the new minRev on the fast path at once (§5.3).
            $minRev = max((int)$row['min_rev'], $x);
            $this->cache->setGens($b, $row['acl_gen'], $row['link_gen'], $minRev, $this->policy->allows((string)$row['owner']), $row['vote_link_gen']);
            $line['blocks']++;
            $line['tombstones'] += $deleted;
        }
        // 2) The changes cap, 2b) the byte cap, 3) the 30-day cut: short
        //    transactions, no board lock. R_bytes is read once after step 2,
        //    outside the blocks' transactions: newer writes only add rows
        //    above it, so the rows below it stay deletable.
        $changesCap = $this->limits->changesCap();
        $bytesCap = $this->limits->changesBytesCap();
        $cut = $nowMs - Limits::CHANGES_RETENTION_MS;
        $bytesBoundary = null;
        $steps = [
            fn (): int => $this->items->pruneChangesCap($b, $changesCap),
            function () use ($b, &$bytesBoundary): int {
                return $bytesBoundary === null ? 0 : $this->items->pruneChangesBelow($b, $bytesBoundary);
            },
            fn (): int => $this->items->pruneBoardChanges($b, $cut),
        ];
        foreach ($steps as $i => $step) {
            if ($i === 1) {
                if ($deadline !== null && $this->clockMs() > $deadline) {
                    return [$this->finish($line), false];
                }
                $bytesBoundary = $this->items->changesBytesBoundary($b, $bytesCap);
                if ($bytesBoundary === null) {
                    // Within the cap (or off): no block, not even an empty transaction.
                    continue;
                }
            }
            while (true) {
                if ($deadline !== null && $this->clockMs() > $deadline) {
                    return [$this->finish($line), false];
                }
                $n = $this->atomic($step, $this->db);
                if ($n === 0) {
                    break;
                }
                $line['changes'] += $n;
            }
        }
        return [$this->finish($line), true];
    }

    /** The line with min_rev as stored now. */
    private function finish(array $line): array {
        $line['minRev'] = $this->items->readMinRev($line['board']) ?? $line['minRev'];
        return $line;
    }

    /** The cursor of run(): id of the last finished board, 0 when unset or unusable. */
    private function cursor(): int {
        try {
            $v = $this->appConfig->getValueInt(Application::APP_ID, self::CURSOR_KEY, 0, lazy: true);
        } catch (\Throwable) {
            return 0;
        }
        return max(0, $v);
    }

    private function setCursor(int $board): void {
        try {
            $this->appConfig->setValueInt(Application::APP_ID, self::CURSOR_KEY, $board, lazy: true);
        } catch (\Throwable) {
            // Stored with another type by hand: replace it.
            $this->appConfig->deleteKey(Application::APP_ID, self::CURSOR_KEY);
            $this->appConfig->setValueInt(Application::APP_ID, self::CURSOR_KEY, $board, lazy: true);
        }
    }

    /** Monotonic milliseconds for the time budget (never the --now clock). */
    protected function clockMs(): float {
        return hrtime(true) / 1e6;
    }
}
