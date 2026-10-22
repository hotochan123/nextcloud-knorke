<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\PathOps;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * tests/fixtures/paths-golden.json, read like production does it:
 * json_decode(…, true) — {} and [] become the same PHP array (SPEC-M0 §4.7
 * rule 3, §9.1). src/model/paths.js is pinned by the same file.
 */
final class PathOpsTest extends TestCase {
    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/paths-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public static function pathCases(): array {
        $out = [];
        foreach (self::golden()['paths'] as $c) {
            $out[$c['name']] = [$c['item'], $c['path'], $c['value'], $c['expect']];
        }
        return $out;
    }

    public static function valueCases(): array {
        $out = [];
        foreach (self::golden()['values'] as $c) {
            $out[$c['name']] = [$c['value'], $c['ok']];
        }
        return $out;
    }

    public function testGoldenHasEnoughCases(): void {
        $g = self::golden();
        $this->assertSame(['paths', 'values'], array_keys($g));
        $this->assertGreaterThanOrEqual(35, count($g['paths']));
        foreach ($g['paths'] as $c) {
            $this->assertSame(['name', 'item', 'path', 'value', 'expect'], array_keys($c));
        }
    }

    #[DataProvider('pathCases')]
    public function testSetPathGolden(array $item, string $path, mixed $value, array $expect): void {
        $got = PathOps::setPath($item, $path, $value);
        // Strict: values, types AND key order.
        $this->assertSame($expect, $got);
        $this->assertTrue(PathOps::isWireValue($value), 'every golden patch value is a wire value');
    }

    #[DataProvider('valueCases')]
    public function testIsWireValueGolden(mixed $value, bool $ok): void {
        $this->assertSame($ok, PathOps::isWireValue($value));
    }

    public function testNumericObjectKeyBecomesAListInPhp(): void {
        // Documented PHP limit (C35): {"0": "a"} decodes to a list and is stored as ["a"].
        $v = json_decode('{"0":"a"}', true);
        $this->assertTrue(PathOps::isWireValue($v));
        $item = PathOps::setPath(['data' => [], 'style' => []], 'data.o', $v);
        $this->assertSame(['a'], $item['data']['o']);
    }

    public function testGetPath(): void {
        $item = ['x' => 1.0, 'parent' => null, 'data' => ['a' => ['b' => 2], 'l' => [1, 2]], 'style' => []];
        $this->assertSame(2, PathOps::getPath($item, 'data.a.b'));
        $this->assertSame(['b' => 2], PathOps::getPath($item, 'data.a'));
        $this->assertNull(PathOps::getPath($item, 'data.l.0'), 'lists are not walked into');
        $this->assertNull(PathOps::getPath($item, 'data.missing.x'));
        $this->assertNull(PathOps::getPath($item, 'parent'));
        $this->assertSame(1.0, PathOps::getPath($item, 'x'));
    }

    public function testSetInCreatesAndReplaces(): void {
        $this->assertSame(['a' => ['b' => ['c' => 1]]], PathOps::setIn([], ['a', 'b', 'c'], 1));
        $this->assertSame(['a' => ['b' => 1], 'z' => 2], PathOps::setIn(['a' => 'scalar', 'z' => 2], ['a', 'b'], 1));
    }

    public function testCleanIsRecursive(): void {
        $this->assertSame([false, null], PathOps::clean(['a' => [], 'b' => null, 'c' => ['d' => []]]));
        $this->assertSame([true, [['x' => 1]]], PathOps::clean([['x' => 1, 'y' => null]]));
        $this->assertSame([true, ''], PathOps::clean(''));
        $this->assertSame([true, false], PathOps::clean(false));
    }

    public function testSame(): void {
        $this->assertTrue(PathOps::same(['a' => 1, 'b' => 2], ['b' => 2, 'a' => 1]), 'maps ignore key order');
        $this->assertTrue(PathOps::same(1, 1.0), 'numbers compare by value');
        $this->assertFalse(PathOps::same([1, 2], [2, 1]), 'lists keep order');
        $this->assertFalse(PathOps::same(0, false));
        $this->assertFalse(PathOps::same('1', 1));
        $this->assertFalse(PathOps::same(null, ''));
        $this->assertTrue(PathOps::same(null, null));
    }
}
