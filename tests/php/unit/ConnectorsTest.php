<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Connectors;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Connector math (SPEC-M1 §3.10, §4.7 rule 14 and the rounding formula q,
 * §9.7), pinned by tests/fixtures/connector-golden.json (anchor points) and
 * the endpoint cases of tests/fixtures/registry-golden.json. The fixtures are
 * read like production reads bodies: json_decode(…, true). src/model/
 * connectors.js and src/model/geometry.js are pinned by the same files.
 *
 * Floats are compared with assertSame (exact, type-strict) AND through
 * json_encode, because 0.0 === -0.0 in PHP: only the encoded form shows the
 * sign of a zero, and (R7) says q never returns -0.
 */
final class ConnectorsTest extends TestCase {
    private const U = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';
    private const JSON = JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    private static function fixture(string $name): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/' . $name), true, 512, JSON_THROW_ON_ERROR);
    }

    private static function enc(mixed $v): string {
        return json_encode($v, self::JSON);
    }

    /**
     * The spec formula of rule 14 without the final q (same operation order),
     * to check properties of the golden cases themselves.
     *
     * @return array{0: float, 1: float}
     */
    private static function raw(array $c): array {
        $x = (float)$c['box']['x'];
        $y = (float)$c['box']['y'];
        if ($c['parent'] !== null) {
            $x = $x + (float)$c['parent']['x'];
            $y = $y + (float)$c['parent']['y'];
        }
        $w = (float)$c['box']['w'];
        $h = (float)$c['box']['h'];
        $cx = $x + $w / 2;
        $cy = $y + $h / 2;
        if (!array_key_exists('ax', $c['ep'])) {
            return [$cx, $cy];
        }
        $dx = ((float)$c['ep']['ax'] - 0.5) * $w;
        $dy = ((float)$c['ep']['ay'] - 0.5) * $h;
        $t = (float)$c['box']['r'] * M_PI / 180;
        return [$cx + $dx * cos($t) - $dy * sin($t), $cy + $dx * sin($t) + $dy * cos($t)];
    }

    /** Distance of |v|·100 from the rounding edge of q(v, 100) (0.5 = farthest). */
    private static function margin(float $v): float {
        $p = abs($v) * 100;
        return abs($p - floor($p) - 0.5);
    }

    // ---- connector-golden.json ------------------------------------------

    public function testGoldenFormat(): void {
        $g = self::fixture('connector-golden.json');
        $this->assertSame(['cases'], array_keys($g));
        $this->assertGreaterThanOrEqual(20, count($g['cases']));
        $angles = [];
        $parents = 0;
        $names = [];
        foreach ($g['cases'] as $c) {
            $this->assertSame(['name', 'box', 'parent', 'ep', 'expect'], array_keys($c));
            $this->assertSame(['x', 'y', 'w', 'h', 'r'], array_keys($c['box']), $c['name']);
            $this->assertTrue($c['parent'] === null || array_keys($c['parent']) === ['x', 'y'], $c['name']);
            $this->assertNotNull(Connectors::endpoint($c['ep']), $c['name'] . ': ep is a valid end');
            $this->assertArrayHasKey('item', $c['ep'], $c['name'] . ': anchor points exist for bound ends only');
            $this->assertSame(Connectors::endpoint($c['ep']), array_map(static fn ($v) => is_int($v) ? (float)$v : $v, $c['ep']), $c['name'] . ': ep is stored form (ax/ay on the 1e-4 grid)');
            $this->assertCount(2, $c['expect']);
            $names[] = $c['name'];
            if (array_key_exists('ax', $c['ep'])) {
                $angles[] = $c['box']['r'];
            }
            $parents += $c['parent'] !== null ? 1 : 0;
        }
        $this->assertSame($names, array_values(array_unique($names)), 'unique names');
        foreach ([0, 30, 90, -45] as $r) {
            $this->assertContains($r, $angles, "an anchored case at r = $r");
        }
        $this->assertGreaterThanOrEqual(3, $parents, 'frame parent cases');
    }

    public function testGoldenHalfBoundariesOnlyAtZeroRotation(): void {
        // §4.7 rule 14: sin/cos of libm and V8 may differ in the last bit, so a
        // rotated case must lie far from the edge of q (≥ 0.01 in units of the
        // 0.01 grid); exact half-boundaries only at r = 0.
        $halves = 0;
        $r7 = 0;
        foreach (self::fixture('connector-golden.json')['cases'] as $c) {
            foreach (self::raw($c) as $v) {
                $m = self::margin($v);
                if ($c['box']['r'] != 0 && array_key_exists('ax', $c['ep'])) {
                    $this->assertGreaterThanOrEqual(0.01, $m, $c['name'] . ': rotated case too close to a half-boundary (' . sprintf('%.17g', $v) . ')');
                }
                if ($m < 1e-9) {
                    $this->assertEquals(0, $c['box']['r'], $c['name'] . ': half-boundary only at r = 0');
                    $halves++;
                }
                if ($v < 0 && $v > -0.005) {
                    $r7++;
                }
            }
        }
        $this->assertGreaterThanOrEqual(4, $halves, 'half-boundary coordinates');
        $this->assertGreaterThanOrEqual(1, $r7, '(R7): a raw coordinate in (-0.005, 0)');
    }

    public static function goldenCases(): array {
        $out = [];
        foreach (self::fixture('connector-golden.json')['cases'] as $c) {
            $out[$c['name']] = [$c['box'], $c['parent'], $c['ep'], $c['expect']];
        }
        return $out;
    }

    #[DataProvider('goldenCases')]
    public function testGoldenAnchorPoint(array $box, ?array $parent, array $ep, array $expect): void {
        $got = Connectors::anchorPoint($box, $parent, $ep);
        $this->assertSame([0, 1], array_keys($got));
        $this->assertIsFloat($got[0]);
        $this->assertIsFloat($got[1]);
        $this->assertSame([(float)$expect[0], (float)$expect[1]], $got);
        $this->assertSame(self::enc([(float)$expect[0], (float)$expect[1]]), self::enc($got), 'sign of zero (R7)');
    }

    public function testAnchorPointBasics(): void {
        $box = ['x' => 100, 'y' => 40, 'w' => 200, 'h' => 120, 'r' => 0];
        $this->assertSame([200.0, 100.0], Connectors::anchorPoint($box, null, ['item' => self::U]));
        $this->assertSame(
            Connectors::anchorPoint($box, null, ['item' => self::U, 'ax' => 0.25, 'ay' => 1]),
            Connectors::anchorPoint($box, ['x' => 0, 'y' => 0], ['item' => self::U, 'ax' => 0.25, 'ay' => 1]),
            'a parent at the origin changes nothing',
        );
        $this->assertSame([200.0, 100.0], Connectors::anchorPoint(['r' => 45.0] + $box, null, ['item' => self::U]), 'auto = centre, rotation ignored');
        $this->assertSame([1150.0, -460.0], Connectors::anchorPoint($box, ['x' => 1000, 'y' => -500], ['item' => self::U, 'ax' => 0.25, 'ay' => 0]), 'containers are roots: parent.x/y are absolute');
    }

    // ---- q ----------------------------------------------------------------

    /** @return array<string, array{0: float, 1: int, 2: string}> [v, k, json_encode(q(v, k))] */
    public static function qTable(): array {
        return [
            '51.945 (double 5194.5 after ×100) → 51.95' => [51.945, 100, '51.95'],
            '-0.005 → -0.01 (half away from zero)' => [-0.005, 100, '-0.01'],
            '0 → 0' => [0.0, 100, '0.0'],
            '-0.0 → +0' => [-0.0, 100, '0.0'],
            '-0.001 → +0, not -0 (R7)' => [-0.001, 100, '0.0'],
            '-0.0049 → +0 (R7)' => [-0.0049, 100, '0.0'],
            '-1e-300 → +0 (R7)' => [-1e-300, 100, '0.0'],
            '1.005 → 1 (1.005·100 = 100.49999999999999; PHP round gives 1.01)' => [1.005, 100, '1.0'],
            '2.675 → 2.68' => [2.675, 100, '2.68'],
            '-2.675 → -2.68' => [-2.675, 100, '-2.68'],
            '9999999.995 → 9999999.99 (its double lies below the half)' => [9999999.995, 100, '9999999.99'],
            '-1e7 stays' => [-10000000.0, 100, '-10000000.0'],
            'k=10000: 0.12345 → 0.1235' => [0.12345, 10000, '0.1235'],
            'k=10000: 0.123456 → 0.1235' => [0.123456, 10000, '0.1235'],
            'k=10000: 0.654321 → 0.6543' => [0.654321, 10000, '0.6543'],
            'k=10000: 0.00015 → 0.0001 (1.4999999999999998)' => [0.00015, 10000, '0.0001'],
            'k=10000: 0.00025 → 0.0003' => [0.00025, 10000, '0.0003'],
            'k=10000: 0.99995 → 1' => [0.99995, 10000, '1.0'],
            'k=10000: 0.00004 → 0' => [0.00004, 10000, '0.0'],
            'k=10000: -0.00004 → +0 (R7)' => [-0.00004, 10000, '0.0'],
            'k=10: 1234.56 → 1234.6' => [1234.56, 10, '1234.6'],
            'k=10: -0.05 → -0.1' => [-0.05, 10, '-0.1'],
        ];
    }

    #[DataProvider('qTable')]
    public function testQ(float $v, int $k, string $json): void {
        $r = Connectors::q($v, $k);
        $this->assertIsFloat($r);
        $this->assertSame($json, self::enc($r));
        if ($r == 0) {
            $this->assertSame(INF, fdiv(1.0, $r), '+0, never -0');
        }
    }

    public function testQDiffersFromRound(): void {
        // Why q exists (§4.7): PHP round() rounds the decimal, q the double.
        $this->assertSame(1.01, round(1.005, 2));
        $this->assertSame(1.0, Connectors::q(1.005, 100));
        $this->assertSame('-0.0', self::enc(-1 * floor(abs(-0.001) * 100 + 0.5) / 100), 'without (R7) the formula yields -0');
    }

    public function testSourceUsesNoRound(): void {
        $src = '';
        foreach (token_get_all((string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/Connectors.php')) as $t) {
            if (!is_array($t) || ($t[0] !== T_COMMENT && $t[0] !== T_DOC_COMMENT)) {
                $src .= is_array($t) ? $t[1] : $t;
            }
        }
        $this->assertDoesNotMatchRegularExpression('/\bround\s*\(/', $src, 'never PHP round() (§4.7)');
    }

    // ---- endpoint ---------------------------------------------------------

    public function testRegistryGoldenEndpointCases(): void {
        // The endpoint cases of registry-golden.json against Connectors::endpoint,
        // which ItemRegistry::checkField('endpoint') delegates to (WP-B1).
        $n = 0;
        $diff = [];
        foreach (self::fixture('registry-golden.json')['values'] as $i => $c) {
            if ($c['type'] !== 'connector' || ($c['path'] !== 'data.start' && $c['path'] !== 'data.end')) {
                continue;
            }
            $n++;
            $e = Connectors::endpoint($c['value']);
            $ok = $e !== null;
            if ($ok !== $c['ok'] || $e !== $c['norm'] || self::enc($e) !== self::enc($c['norm'])) {
                $diff[] = "#$i " . self::enc($c['value']) . ': got ' . self::enc($e) . ', want ' . self::enc($c['norm']);
            }
        }
        $this->assertGreaterThanOrEqual(40, $n);
        $this->assertSame([], $diff);
    }

    public function testEndpointForms(): void {
        $this->assertSame(['item' => self::U], Connectors::endpoint(['item' => self::U]));
        $this->assertSame(['item' => self::U, 'ax' => 0.1235, 'ay' => 0.6543], Connectors::endpoint(['item' => self::U, 'ax' => 0.123456, 'ay' => 0.654321]), 'six decimals → q(v, 10000)');
        $this->assertSame(['item' => self::U, 'ax' => 1.0, 'ay' => 0.0], Connectors::endpoint(['ay' => 0, 'item' => self::U, 'ax' => 1]), 'fixed key order, floats');
        $this->assertSame(['x' => 1234.5, 'y' => -80.0], Connectors::endpoint(['y' => -80, 'x' => 1234.5]), 'free end: fixed key order, floats, not rounded');
        $this->assertSame(['x' => 10000000.0, 'y' => -10000000.0], Connectors::endpoint(['x' => 10000000, 'y' => -10000000.0]), '|v| = NUM_ABS_MAX');
        $this->assertSame('{"x":0.0,"y":0.0}', self::enc(Connectors::endpoint(['x' => -0.0, 'y' => -0.0])), 'a free end is never stored as -0');
        $this->assertSame('{"item":"' . self::U . '","ax":0.0,"ay":0.0}', self::enc(Connectors::endpoint(['item' => self::U, 'ax' => -0.0, 'ay' => -0.0])), '-0 is in [0, 1] and normalised to +0');
    }

    /** @return array<string, array{0: mixed}> */
    public static function invalidEnds(): array {
        return [
            'null' => [null],
            'empty' => [[]],
            'list' => [[self::U]],
            'string' => [self::U],
            'number' => [1.5],
            'bool' => [true],
            'item null' => [['item' => null]],
            'item empty' => [['item' => '']],
            'item int' => [['item' => 7]],
            'item list' => [['item' => [self::U]]],
            'item not a ULID' => [['item' => 'not-a-ulid']],
            'item lowercase ULID' => [['item' => '01jf5q4t0v9w8x7y6z5a4b3c2d']],
            'extra key' => [['item' => self::U, 'side' => 'top']],
            'ax without ay' => [['item' => self::U, 'ax' => 0.5]],
            'ay without ax' => [['item' => self::U, 'ay' => 0.5]],
            'anchor without item' => [['ax' => 0.5, 'ay' => 0.5]],
            'ax/ay null (absent only after generic cleaning)' => [['item' => self::U, 'ax' => null, 'ay' => null]],
            'ax NAN' => [['item' => self::U, 'ax' => NAN, 'ay' => 0.5]],
            'ay INF' => [['item' => self::U, 'ax' => 0.5, 'ay' => INF]],
            'ax > 1' => [['item' => self::U, 'ax' => 1.00004, 'ay' => 0.5]],
            'ay < 0' => [['item' => self::U, 'ax' => 0.5, 'ay' => -0.00001]],
            'ax numeric text' => [['item' => self::U, 'ax' => '0.5', 'ay' => 0.5]],
            'ax bool' => [['item' => self::U, 'ax' => false, 'ay' => 0.5]],
            'x NAN' => [['x' => NAN, 'y' => 0]],
            'x INF' => [['x' => INF, 'y' => 0]],
            'y -INF' => [['x' => 0, 'y' => -INF]],
            'x beyond 1e7' => [['x' => 10000000.01, 'y' => 0]],
            'y huge int' => [['x' => 0, 'y' => PHP_INT_MAX]],
            'x text' => [['x' => '1', 'y' => 2]],
            'x without y' => [['x' => 1]],
            'free end with extra key' => [['x' => 1, 'y' => 2, 'z' => 3]],
            'mixed: item + x/y' => [['item' => self::U, 'x' => 1, 'y' => 2]],
            'mixed: anchor + x/y' => [['item' => self::U, 'ax' => 0.5, 'ay' => 0.5, 'x' => 1, 'y' => 2]],
            'numeric keys' => [[0 => 1.0, 1 => 2.0]],
        ];
    }

    #[DataProvider('invalidEnds')]
    public function testEndpointInvalid(mixed $v): void {
        $this->assertNull(Connectors::endpoint($v));
    }
}
