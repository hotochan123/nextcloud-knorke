<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Service\ItemRegistry;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\Mindmaps;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Tables;
use OCA\Knorke\Tests\Support\IntegrationCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * How long one batch of Limits::MAX_OPS ops holds the board lock on the
 * largest objects a board allows (factory job 250). The whole object checks
 * (Tables::check, Mindmaps::check, Lanes::checkFrame, ItemRegistry::bytes,
 * fitsShape, changedCells/changedTexts) and the keep shift run once per op
 * under the lock; the time of applyOps() is an upper bound of the lock time
 * (validation before the lock included). Every case runs RUNS times and
 * reports median and max on STDERR; there is no time bound here (no flaky
 * test), the numbers go to docs/ENTWICKLUNG.md §5.10.
 *
 *   KD_NS=<ns> tests/php/run.sh integration --group lock-time
 */
#[Group('lock-time')]
final class LockTimeIntegrationTest extends IntegrationCase {
    private const RUNS = 5;
    private const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

    /** @var list<string> */
    private static array $report = [];

    public static function tearDownAfterClass(): void {
        if (self::$report !== []) {
            fwrite(STDERR, "\n[lock-time] " . self::dbKind() . ', ' . Limits::MAX_OPS . " ops per batch, " . self::RUNS . " runs\n"
                . implode("\n", self::$report) . "\n");
        }
    }

    private static function sticky(string $parent, int $i): array {
        return ['x' => 10 + ($i % 70) * 210, 'y' => 10 + intdiv($i, 70) * 210, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i5',
            'parent' => $parent, 'data' => ['text' => 'Note ' . $i], 'style' => ['fill' => '#a8d8f8']];
    }

    /** Applies $ops in batches of MAX_OPS; every op must answer ok. */
    private function fill(Principal $p, int $b, array $ops): void {
        foreach (array_chunk($ops, Limits::MAX_OPS) as $chunk) {
            [, $res] = $this->sync->applyOps($p, $b, 'cFill', $chunk, self::nowMs());
            $this->assertSame(array_fill(0, count($chunk), 'ok'), $res, 'fill');
        }
    }

    /**
     * Runs $batch(run) RUNS times through applyOps (presence [] like a
     * sync request: a text patch reads the lease under the lock) and notes
     * median and max in ms.
     *
     * @param \Closure(int): list<array> $batch
     */
    private function measure(string $case, Principal $p, int $b, \Closure $batch, int $n = Limits::MAX_OPS): void {
        $ms = [];
        for ($run = 1; $run <= self::RUNS; $run++) {
            $ops = $batch($run);
            $ops = array_slice($ops, 0, $n);
            $this->assertCount($n, $ops);
            $t0 = hrtime(true);
            [, $res] = $this->sync->applyOps($p, $b, 'cLock', $ops, self::nowMs(), []);
            $ms[] = (hrtime(true) - $t0) / 1e6;
            $this->assertSame(array_fill(0, $n, 'ok'), $res, $case . ' run ' . $run . ': every op ok');
        }
        sort($ms);
        self::$report[] = sprintf('%-28s median %7.1f ms  max %7.1f ms', $case, $ms[intdiv(self::RUNS, 2)], $ms[self::RUNS - 1]);
    }

    /** A frame with 4999 notes as children: 5000 live items, the default maxItemsPerBoard. */
    private function frameBoard(): array {
        $b = $this->board();
        $p = $this->owner($b);
        $f = self::ulid(1);
        $ops = [['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 0, 'y' => 0, 'w' => 15000, 'h' => 15000, 'r' => 0, 'z' => 'h5',
            'parent' => null, 'data' => ['title' => 'Workshop'], 'style' => []]]];
        for ($i = 0; $i < 4999; $i++) {
            $ops[] = ['o' => 'put', 'id' => self::ulid(100 + $i), 't' => 'sticky', 'p' => self::sticky($f, $i)];
        }
        $this->fill($p, $b, $ops);
        $this->assertSame(5000, $this->itemCount($b));
        $this->assertSame(5000, \OCP\Server::get(Limits::class)->maxItemsPerBoard(), 'the default limit is full');
        return [$b, $p, $f];
    }

    public function testFrameMovedWithKeep(): void {
        [$b, $p, $f] = $this->frameBoard();
        $x = 0;
        $batch = static function () use ($f, &$x): array {
            $ops = [];
            for ($i = 0; $i < Limits::MAX_OPS; $i++) {
                $x++;
                $ops[] = ['o' => 'patch', 'id' => $f, 'p' => ['x' => $x, 'y' => $x, 'parent' => null], 'keep' => true];
            }
            return $ops;
        };
        // the same move as ONE op: what the 5000 child rows cost without the per-op work
        $this->measure('F1 frame + 4999, keep, 1 op', $p, $b, $batch, 1);
        $this->measure('F1 frame + 4999, keep', $p, $b, $batch);
    }

    public function testChildrenMovedInFrame(): void {
        [$b, $p, $f] = $this->frameBoard();
        $this->measure('F2 200 of 4999 children', $p, $b, static function (int $run) use ($f): array {
            $ops = [];
            for ($i = 0; $i < Limits::MAX_OPS; $i++) {
                $ops[] = ['o' => 'patch', 'id' => self::ulid(100 + $i * 20), 'p' => ['x' => $run * 3 + $i, 'y' => $run * 5, 'parent' => $f]];
            }
            return $ops;
        });
    }

    public function testTableCells(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $t = self::ulid(1);
        $cols = [];
        $rows = [];
        for ($c = 0; $c < Tables::MAX_COLS; $c++) {
            $cols[sprintf('c%08d', $c)] = ['o' => 'i' . self::DIGITS[$c], 'w' => 120];
        }
        for ($r = 0; $r < Tables::MAX_ROWS; $r++) {
            $rows[sprintf('r%08d', $r)] = ['o' => 'j' . self::DIGITS[intdiv($r, 36)] . self::DIGITS[$r % 36]];
        }
        // 1000 cells; the text length that brings the table just below MAX_ITEM_BYTES
        $len = 1;
        do {
            $item = $this->tableItem($cols, $rows, $len + 1, 0);
            $fits = ItemRegistry::bytes($item) <= Limits::MAX_ITEM_BYTES - 64;
            $len += $fits ? 1 : 0;
        } while ($fits);
        $item = $this->tableItem($cols, $rows, $len, 0);
        $this->assertGreaterThan(0.9 * Limits::MAX_ITEM_BYTES, ItemRegistry::bytes($item), 'a table near MAX_ITEM_BYTES');
        $this->assertTrue(Tables::check($item['data']));
        $this->fill($p, $b, [['o' => 'put', 'id' => $t, 't' => 'table', 'p' => $item]]);
        $keys = [];
        foreach (array_keys($cols) as $c) {
            foreach (array_keys($rows) as $r) {
                $keys[] = 'data.cells.' . $c . '.' . $r;
            }
        }
        $this->measure('T table 20 x 50, ' . ItemRegistry::bytes($item) . ' B', $p, $b, static function (int $run) use ($t, $keys, $len): array {
            $ops = [];
            for ($i = 0; $i < Limits::MAX_OPS; $i++) {
                $ops[] = ['o' => 'patch', 'id' => $t, 'p' => [$keys[$i * 5] => self::text($run, $len)]];
            }
            return $ops;
        });
    }

    public function testMindmapTexts(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $m = self::ulid(1);
        $keys = [];
        for ($i = 0; $i < Mindmaps::MAX_NODES; $i++) {
            // the second character spreads the nodes over 36 pots (≤ 100 keys per object)
            $keys[] = 'n' . self::DIGITS[$i % 36] . sprintf('%07d', $i);
        }
        $len = 1;
        do {
            $item = $this->mindItem($keys, $len + 1, 0);
            $fits = ItemRegistry::bytes($item) <= Limits::MAX_ITEM_BYTES - 64;
            $len += $fits ? 1 : 0;
        } while ($fits);
        $item = $this->mindItem($keys, $len, 0);
        $this->assertGreaterThan(0.9 * Limits::MAX_ITEM_BYTES, ItemRegistry::bytes($item), 'a mind map near MAX_ITEM_BYTES');
        $this->assertTrue(Mindmaps::check($item['data']));
        $this->fill($p, $b, [['o' => 'put', 'id' => $m, 't' => 'mindmap', 'p' => $item]]);
        $this->measure('M mind map 500, ' . ItemRegistry::bytes($item) . ' B', $p, $b, static function (int $run) use ($m, $keys, $len): array {
            $ops = [];
            for ($i = 0; $i < Limits::MAX_OPS; $i++) {
                $k = $keys[$i * 2];
                $ops[] = ['o' => 'patch', 'id' => $m, 'p' => ['data.texts.b' . $k[1] . '.' . $k => self::text($run, $len)]];
            }
            return $ops;
        });
    }

    /** A text of exactly $len characters that differs per run. */
    private static function text(int $run, int $len): string {
        return substr(str_repeat('v' . $run . 'x', $len), 0, $len);
    }

    private function tableItem(array $cols, array $rows, int $len, int $run): array {
        $cells = [];
        foreach (array_keys($cols) as $c) {
            foreach (array_keys($rows) as $r) {
                $cells[$c][$r] = self::text($run, $len);
            }
        }
        return ['x' => 0, 'y' => 0, 'w' => 2400, 'h' => 1800, 'r' => 0, 'z' => 'i5', 'parent' => null,
            'data' => ['cols' => $cols, 'rows' => $rows, 'cells' => $cells], 'style' => []];
    }

    private function mindItem(array $keys, int $len, int $run): array {
        $nodes = [];
        $texts = [];
        foreach ($keys as $i => $k) {
            $pot = 'b' . $k[1];
            // a tree: node i hangs below node (i - 1) / 4, the root has no p
            $nodes[$pot][$k] = $i === 0 ? ['o' => 'i0'] : ['o' => 'i' . self::DIGITS[$i % 36], 'p' => $keys[intdiv($i - 1, 4)]];
            $texts[$pot][$k] = self::text($run, $len);
        }
        return ['x' => 0, 'y' => 0, 'w' => 2000, 'h' => 1200, 'r' => 0, 'z' => 'i5', 'parent' => null,
            'data' => ['nodes' => $nodes, 'texts' => $texts], 'style' => []];
    }
}
