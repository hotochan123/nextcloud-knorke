<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Lanes;
use PHPUnit\Framework\TestCase;

/**
 * Factory job 199 (AK1): the form of data.lanes of a frame and the order of
 * its lanes, against tests/fixtures/lanes-golden.json (which the JS test
 * tests/js/model/lanes.test.mjs reads as well).
 */
final class LanesTest extends TestCase {
    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/lanes-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testGoldenChecks(): void {
        $g = self::golden();
        $this->assertGreaterThanOrEqual(25, count($g['checks']));
        $wrong = [];
        foreach ($g['checks'] as $c) {
            if (Lanes::check($c['lanes']) !== $c['ok']) {
                $wrong[] = $c['name'];
            }
        }
        $this->assertSame([], $wrong);
        // the named cases of the spec are in the fixture
        $names = array_column($g['checks'], 'ok', 'name');
        foreach (['three lanes' => true, 'a lane without t' => true, '0 lanes' => false, '31 lanes' => false, 'h 59' => false,
            'h 100001' => false, 'h as text' => false, 'lane key L1234567a' => false, 'extra key in a lane' => false,
            't 201 code points' => false, 't empty' => false] as $name => $ok) {
            $this->assertSame($ok, $names[$name] ?? null, $name);
        }
    }

    public function testGoldenOrders(): void {
        foreach (self::golden()['orders'] as $o) {
            $this->assertTrue(Lanes::check($o['lanes']), $o['name']);
            $this->assertSame($o['keys'], Lanes::ordered($o['lanes']), $o['name']);
        }
    }

    public function testNoMapAtAll(): void {
        foreach ([null, 'x', 5, true, []] as $v) {
            $this->assertFalse(Lanes::check($v), var_export($v, true));
        }
    }

    public function testGoldenColumns(): void {
        // Job 208 (AK1): the form of data.cols and the order of the columns
        $g = self::golden();
        $wrong = [];
        foreach ($g['colChecks'] as $c) {
            if (Lanes::checkCols($c['cols']) !== $c['ok']) {
                $wrong[] = $c['name'];
            }
        }
        $this->assertSame([], $wrong);
        $names = array_column($g['colChecks'], 'ok', 'name');
        foreach (['three columns' => true, 'a column without t' => true, '0 columns' => false, '31 columns' => false, 'w 99' => false,
            'w 100001' => false, 'w as text' => false, 'column key C1234567a' => false, 'column key l1234567a' => false,
            'extra key in a column' => false, 't 201 code points' => false, 't empty' => false] as $name => $ok) {
            $this->assertSame($ok, $names[$name] ?? null, $name);
        }
        foreach ($g['colOrders'] as $o) {
            $this->assertTrue(Lanes::checkCols($o['cols']), $o['name']);
            $this->assertSame($o['keys'], Lanes::ordered($o['cols']), $o['name']);
        }
        foreach ([null, 'x', 5, true, []] as $v) {
            $this->assertFalse(Lanes::checkCols($v), var_export($v, true));
        }
    }

    public function testGoldenGroups(): void {
        // Job 225 (AK1): lanes and columns with groups, the form of data.lgroups and data.cgroups
        $g = self::golden();
        $this->assertGreaterThanOrEqual(20, count($g['groupChecks']));
        $wrong = [];
        foreach ($g['groupChecks'] as $c) {
            $groups = $c['groups'] ?? null;
            $ok = $c['kind'] === 'cols' ? Lanes::checkCols($c['map'], $groups) : Lanes::check($c['map'], $groups);
            if ($ok !== $c['ok']) {
                $wrong[] = $c['name'];
            }
        }
        $this->assertSame([], $wrong);
        $names = array_column($g['groupChecks'], 'ok', 'name');
        foreach (['lanes with a group' => true, 'a group without a name' => true, 'g names a missing group' => false, 'g without lgroups' => false,
            'group key G1234567a' => false, '0 groups' => false, '31 groups' => false, 'a group as a map' => false,
            'group name 201 code points' => false, 'columns with a group' => true, 'column g names a lane group' => false] as $name => $ok) {
            $this->assertSame($ok, $names[$name] ?? null, $name);
        }
        foreach ([null, 'x', 5, true, []] as $v) {
            $this->assertFalse(Lanes::checkGroups($v), var_export($v, true));
        }
        $frame = ['lanes' => ['l00000001' => ['o' => 'i0', 'h' => 600, 'g' => 'g00000001']], 'lgroups' => ['g00000001' => '']];
        $this->assertTrue(Lanes::checkFrame($frame));
        $this->assertFalse(Lanes::checkFrame(['lgroups' => ['h00000001' => '']]), 'lane groups without lanes keep their form');
        $this->assertTrue(Lanes::checkFrame(['title' => 'x']), 'a plain frame');
    }
}
