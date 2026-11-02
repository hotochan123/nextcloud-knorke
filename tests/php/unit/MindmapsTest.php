<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Mindmaps;
use PHPUnit\Framework\TestCase;

/**
 * Factory job 195 (AK1): the form of a mind map's data against
 * tests/fixtures/mindmap-golden.json (which the JS test
 * tests/js/model/mindmap.test.mjs reads as well), and the nodes whose text a
 * patch changes (the lease per node).
 */
final class MindmapsTest extends TestCase {
    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/mindmap-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testGoldenChecks(): void {
        $g = self::golden();
        $this->assertGreaterThanOrEqual(30, count($g['checks']));
        $wrong = [];
        foreach ($g['checks'] as $c) {
            if (Mindmaps::check($c['data']) !== $c['ok']) {
                $wrong[] = $c['name'];
            }
        }
        $this->assertSame([], $wrong);
        // the named cases of the spec are in the fixture
        $names = array_column($g['checks'], 'ok', 'name');
        foreach (['a new mind map' => true, 'a three-level tree with both sides' => true, 'two roots' => false,
            'a cycle beside the root' => false, 'orphan p' => false, '501 nodes' => false, 'node in the wrong pot' => false,
            '1001 code points' => false, 'extra key in data' => false, 'colour with C' => false, 'unknown shape' => false,
            '101 nodes in one pot' => false] as $name => $ok) {
            $this->assertSame($ok, $names[$name] ?? null, $name);
        }
    }

    public function testGoldenChangedTexts(): void {
        foreach (self::golden()['changed'] as $c) {
            $this->assertSame($c['keys'], Mindmaps::changedTexts($c['before'], $c['after']), $c['name']);
        }
    }

    public function testNodeForm(): void {
        foreach (['n00000001' => 1, 'nzzzzzzzz' => 1, 'N00000001' => 0, 'n0000001' => 0, 'n000000001' => 0, "n00000001\n" => 0,
            'c00000001.r00000001' => 0] as $key => $ok) {
            $this->assertSame($ok, preg_match(Mindmaps::NODE_RE, $key), $key);
        }
        $this->assertSame('b7', Mindmaps::bucketOf('n7abcdefg'));
    }

    /** A deep chain is checked without recursion (a 500 node line). */
    public function testDeepChain(): void {
        $alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
        $key = static fn (int $i): string => 'n' . $alphabet[$i % 36] . str_pad((string)intdiv($i, 36), 7, '0', STR_PAD_LEFT);
        $nodes = [];
        for ($i = 0; $i < 500; $i++) {
            $n = ['o' => 'i0'];
            if ($i > 0) {
                $n['p'] = $key($i - 1);
            }
            $nodes[Mindmaps::bucketOf($key($i))][$key($i)] = $n;
        }
        $this->assertTrue(Mindmaps::check(['nodes' => $nodes]));
        // the last one pointing at the second: a cycle below the root
        $nodes[Mindmaps::bucketOf($key(1))][$key(1)]['p'] = $key(499);
        $this->assertFalse(Mindmaps::check(['nodes' => $nodes]));
    }
}
