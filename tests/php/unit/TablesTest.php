<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Tables;
use PHPUnit\Framework\TestCase;

/**
 * Factory job 173 (AK1): the form of a table's data, its order, the x of its
 * columns and its width, against tests/fixtures/table-golden.json (which the
 * JS test tests/js/model/table.test.mjs reads as well), and the cells whose
 * text a patch changes (the lease per cell).
 */
final class TablesTest extends TestCase {
    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/table-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testGoldenChecks(): void {
        $g = self::golden();
        $this->assertGreaterThanOrEqual(30, count($g['checks']));
        $wrong = [];
        foreach ($g['checks'] as $c) {
            if (Tables::check($c['data']) !== $c['ok']) {
                $wrong[] = $c['name'];
            }
        }
        $this->assertSame([], $wrong);
        // the named cases of the spec are in the fixture
        $names = array_column($g['checks'], 'ok', 'name');
        foreach (['a new 3 × 3 table' => true, '0 rows' => false, '51 rows' => false, '21 columns' => false, 'width 39' => false,
            'width 1001' => false, 'column key C1234567a' => false, 'orphan cell (no such column)' => false,
            '1001 code points' => false, 'extra key in data' => false] as $name => $ok) {
            $this->assertSame($ok, $names[$name] ?? null, $name);
        }
    }

    public function testGoldenOrderXAndWidth(): void {
        foreach (self::golden()['orders'] as $o) {
            $this->assertTrue(Tables::check($o['data']), $o['name']);
            $this->assertSame($o['cols'], Tables::ordered($o['data']['cols']), $o['name']);
            $this->assertSame($o['rows'], Tables::ordered($o['data']['rows']), $o['name']);
            [$x, $w] = Tables::colX($o['data']);
            $this->assertSame(array_map('floatval', $o['x']), $x, $o['name']);
            $this->assertSame((float)$o['w'], $w, $o['name']);
        }
    }

    public function testChangedCells(): void {
        $base = ['cols' => ['c00000001' => ['o' => 'i0', 'w' => 160], 'c00000002' => ['o' => 'i1', 'w' => 160]],
            'rows' => ['r00000001' => ['o' => 'i0'], 'r00000002' => ['o' => 'i1']],
            'cells' => ['c00000001' => ['r00000001' => 'a', 'r00000002' => 'b']]];
        $text = $base;
        $text['cells']['c00000001']['r00000001'] = 'A';
        $text['cells']['c00000002'] = ['r00000002' => 'new'];
        $this->assertSame(['c00000001.r00000001', 'c00000002.r00000002'], Tables::changedCells($base, $text));
        $this->assertSame([], Tables::changedCells($base, $base));
        // deleting a row with its cells changes no cell that still exists
        $row = $base;
        unset($row['rows']['r00000002'], $row['cells']['c00000001']['r00000002']);
        $this->assertSame([], Tables::changedCells($base, $row));
        // deleting a column with its cells neither
        $col = $base;
        unset($col['cols']['c00000001'], $col['cells']);
        $this->assertSame([], Tables::changedCells($base, $col));
        // a cleared cell is a change
        $cleared = $base;
        unset($cleared['cells']['c00000001']['r00000001']);
        $this->assertSame(['c00000001.r00000001'], Tables::changedCells($base, $cleared));
    }

    public function testCellForm(): void {
        foreach (['c00000001.r00000001' => 1, 'c0000000z.r0000000a' => 1, 'C00000001.r00000001' => 0, 'c00000001r00000001' => 0,
            'c00000001.r00000001 ' => 0, "c00000001.r00000001\n" => 0, 'r00000001.c00000001' => 0] as $cell => $ok) {
            $this->assertSame($ok, preg_match(Tables::CELL_RE, $cell), $cell);
        }
    }
}
