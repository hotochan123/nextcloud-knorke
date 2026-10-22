<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\ItemRegistry;
use PHPUnit\Framework\TestCase;

/** Type rules (SPEC-M0 §4.8; v2: SPEC-M1 §4.8, §4.7 rules 12, 14, 18, 19). */
final class ItemRegistryTest extends TestCase {
    private static function item(array $over = [], string $t = 'sticky'): array {
        return $over + ['t' => $t, 'x' => 0.0, 'y' => 0.0, 'w' => 200.0, 'h' => 200.0, 'r' => 0.0, 'z' => 'i0', 'parent' => null, 'data' => [], 'style' => []];
    }

    public function testKnownTypes(): void {
        $this->assertTrue(ItemRegistry::has('sticky'));
        $this->assertTrue(ItemRegistry::has('frame'));
        // SPEC-M1 §12.3 tripwire: shape/text/connector are known since stage 1; pen stays a later type.
        foreach (['shape', 'text', 'connector'] as $t) {
            $this->assertTrue(ItemRegistry::has($t), $t);
        }
        $this->assertFalse(ItemRegistry::has('pen'));
        $this->assertFalse(ItemRegistry::has('constructor'));
        $this->assertTrue(ItemRegistry::isContainer('frame'));
        $this->assertFalse(ItemRegistry::isContainer('sticky'));
    }

    public function testChildOf(): void {
        $this->assertTrue(ItemRegistry::canBeChildOf('sticky', 'frame'));
        $this->assertFalse(ItemRegistry::canBeChildOf('sticky', 'sticky'));
        $this->assertFalse(ItemRegistry::canBeChildOf('frame', 'frame'));
        $this->assertTrue(ItemRegistry::canBeChildOf('shape', 'frame'));
        $this->assertTrue(ItemRegistry::canBeChildOf('text', 'frame'));
        $this->assertFalse(ItemRegistry::canBeChildOf('connector', 'frame'), 'connectors are never children');
        $this->assertFalse(ItemRegistry::canBeChildOf('pen', 'frame'), 'unknown type = GENERIC: no parent');
    }

    public function testGenericForUnknownTypes(): void {
        $info = ItemRegistry::info('mindmap');
        $this->assertFalse($info['container']);
        $this->assertSame([], $info['childOf']);
        $this->assertTrue($info['rotatable']);
        $this->assertSame([0, 1000000], $info['size']);
        $this->assertSame([], $info['fields']);
        $this->assertNull(ItemRegistry::textPath('mindmap'));
        $this->assertNull(ItemRegistry::checkItem(self::item([], 'mindmap')), 'put accepts registry types only');
        $this->assertSame(['w' => 5.0, 'data.anything' => 'x'], ItemRegistry::checkPatch('mindmap', ['w' => 5.0, 'data.anything' => 'x']));
        $this->assertNull(ItemRegistry::checkPatch('mindmap', ['x' => 1.0, 'y' => 1.0, 'parent' => '01JF5Q4T0V9W8X7Y6Z5A4B3C2D']));
        $this->assertNotNull(ItemRegistry::checkPatch('mindmap', ['x' => 1.0, 'y' => 1.0, 'parent' => null]));
    }

    public function testTextPaths(): void {
        $this->assertSame('data.text', ItemRegistry::textPath('sticky'));
        $this->assertSame('data.title', ItemRegistry::textPath('frame'));
        $this->assertSame('data.label', ItemRegistry::textPath('connector'));
        // SPEC-M1 §12.3 tripwire (R8): allTextPaths gains data.label.
        $this->assertSame(['data.text', 'data.title', 'data.label'], ItemRegistry::allTextPaths());
    }

    public function testColorNormalization(): void {
        $item = ItemRegistry::checkItem(self::item(['style' => ['fill' => '#A8D8F8']]));
        $this->assertSame('#a8d8f8', $item['style']['fill']);
        $this->assertSame(['style.fill' => '#ffcc00'], ItemRegistry::checkPatch('sticky', ['style.fill' => '#FFCC00']));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['style.fill' => 'red']));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['style.fill' => '#fff']));
        $this->assertSame(['style.fill' => null], ItemRegistry::checkPatch('sticky', ['style.fill' => null]), 'null deletes');
    }

    public function testSizeAndRotation(): void {
        $this->assertNull(ItemRegistry::checkItem(self::item(['w' => 19.9])));
        $this->assertNotNull(ItemRegistry::checkItem(self::item(['w' => 20.0, 'h' => 2000.0])));
        $this->assertNull(ItemRegistry::checkItem(self::item(['w' => 49.0, 'h' => 600.0], 'frame')));
        $this->assertNotNull(ItemRegistry::checkItem(self::item(['w' => 100000.0, 'h' => 600.0], 'frame')));
        $this->assertNull(ItemRegistry::checkItem(self::item(['w' => 800.0, 'h' => 600.0, 'r' => 5.0], 'frame')));
        $this->assertNotNull(ItemRegistry::checkItem(self::item(['r' => 45.0])));
        $this->assertNull(ItemRegistry::checkPatch('frame', ['r' => 1.0]));
        $this->assertNotNull(ItemRegistry::checkPatch('frame', ['r' => 0.0]));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['w' => 2001.0]));
        $this->assertNull(ItemRegistry::checkPatch('frame', ['x' => 0.0, 'y' => 0.0, 'parent' => '01JF5Q4T0V9W8X7Y6Z5A4B3C2D']));
    }

    public function testTypedFields(): void {
        $this->assertNull(ItemRegistry::checkPatch('frame', ['data.title' => str_repeat('t', 201)]));
        $this->assertNotNull(ItemRegistry::checkPatch('frame', ['data.title' => str_repeat('t', 200)]));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['data.text' => 5]));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['data.text.inner' => 'x']), 'a typed leaf never becomes a map');
        $this->assertSame(['style.fontSize' => 12], ItemRegistry::checkPatch('sticky', ['style.fontSize' => 12.0]));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['style.fontSize' => 7]));
        $this->assertNull(ItemRegistry::checkPatch('sticky', ['style.fontSize' => 12.5]));
        $this->assertSame(['data.unknown' => [1, 2]], ItemRegistry::checkPatch('sticky', ['data.unknown' => [1, 2]]), 'unknown fields are kept');
    }

    public function testItemBytes(): void {
        $this->assertTrue(ItemRegistry::fitsBytes(self::item(['data' => ['text' => str_repeat('😀', 6000)], 'style' => ['fill' => '#ffffff']])));
        $this->assertFalse(ItemRegistry::fitsBytes(self::item(['data' => ['a' => str_repeat('x', 6000), 'b' => str_repeat('😀', 6000), 'c' => str_repeat('😀', 6000), 'd' => str_repeat('😀', 6000)]])));
    }

    public function testBytesAndShape(): void {
        // T1/T10: one byte formula; the shape rules of put on a stored item.
        $item = self::item(['data' => ['text' => 'abc'], 'style' => []]);
        $this->assertSame(strlen('{"text":"abc"}') + 2, ItemRegistry::bytes($item));
        $keys = array_fill_keys(array_map(static fn ($k) => "k$k", range(1, 100)), 1);
        $this->assertTrue(ItemRegistry::fitsShape(self::item(['data' => $keys])));
        $this->assertFalse(ItemRegistry::fitsShape(self::item(['data' => $keys + ['k0' => 1]])), '101 root keys');
        $this->assertTrue(ItemRegistry::fitsShape(self::item(['data' => $keys + ['k0' => 1]]), ['style']), 'only the given containers');
        $six = ['a' => ['b' => ['c' => ['d' => ['e' => ['f' => 1]]]]]];
        $this->assertTrue(ItemRegistry::fitsShape(self::item(['style' => ['w' => $six]])), 'a 6-level root value');
        $this->assertFalse(ItemRegistry::fitsShape(self::item(['style' => ['w' => ['x' => $six]]])), '7 levels');
        $this->assertFalse(ItemRegistry::fitsShape(self::item(['data' => ['l' => range(0, 1000)]])), '1001 list elements');
    }

    // ---- Registry v2 (SPEC-M1 §4.8, rules 12, 14, 18, 19) ------------------

    private const U = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';

    private static function connector(array $over = []): array {
        return $over + ['t' => 'connector', 'x' => 0.0, 'y' => 0.0, 'w' => 0.0, 'h' => 0.0, 'r' => 0.0, 'z' => 'i0', 'parent' => null,
            'data' => ['start' => ['item' => self::U], 'end' => ['x' => 1.5, 'y' => -2]], 'style' => []];
    }

    public function testBindableVotablePlacementAndGeneric(): void {
        $this->assertSame([true, false, true, true, false, false], array_map([ItemRegistry::class, 'isBindable'], ['sticky', 'frame', 'shape', 'text', 'connector', 'pen']));
        $this->assertSame([true, false, true, true, false, false], array_map([ItemRegistry::class, 'isVotable'], ['sticky', 'frame', 'shape', 'text', 'connector', 'pen']));
        $this->assertSame(['box', 'box', 'box', 'box', 'none', 'box'], array_map(static fn (string $t): string => ItemRegistry::info($t)['placement'], ['sticky', 'frame', 'shape', 'text', 'connector', 'pen']));
        $generic = ItemRegistry::info('pen');
        $this->assertSame([false, false, 'box', [], [], null], [$generic['bindable'], $generic['votable'], $generic['placement'], $generic['required'], $generic['fields'], $generic['textPath']], 'GENERIC keys (§4.8)');
        $this->assertSame(['data.start', 'data.end'], ItemRegistry::info('connector')['required']);
        foreach (['sticky', 'frame', 'shape', 'text'] as $t) {
            $this->assertSame([], ItemRegistry::info($t)['required'], $t);
        }
    }

    public function testEnumIsStrict(): void {
        // (R8): a loose in_array would accept true (and 0 on PHP < 8).
        $rule = ItemRegistry::info('shape')['fields']['data.kind'];
        $this->assertSame([true, 'roundRect'], ItemRegistry::checkField($rule, 'roundRect'));
        foreach ([true, false, 0, 1, null, 'RECT', 'rect ', ['rect'], ['a' => 'rect'], 1.0] as $v) {
            $this->assertSame([false, null], ItemRegistry::checkField($rule, $v), var_export($v, true));
        }
        $this->assertNull(ItemRegistry::checkPatch('connector', ['style.endCap' => true]));
        $this->assertSame(['style.endCap' => 'dot'], ItemRegistry::checkPatch('connector', ['style.endCap' => 'dot']));
    }

    public function testEndpointDelegatesToConnectors(): void {
        $rule = ItemRegistry::info('connector')['fields']['data.start'];
        foreach ([['item' => self::U], ['item' => self::U, 'ax' => 0.123456, 'ay' => 1], ['x' => -0.0, 'y' => 12.5], ['item' => 'nope'], ['item' => self::U, 'ax' => 1.00004, 'ay' => 0], ['x' => 1], 'x', null] as $v) {
            $ep = \OCA\Knorke\Service\Connectors::endpoint($v);
            $this->assertSame($ep === null ? [false, null] : [true, $ep], ItemRegistry::checkField($rule, $v), json_encode($v));
        }
        $this->assertSame(['data.end' => ['item' => self::U, 'ax' => 0.5, 'ay' => 0.0]], ItemRegistry::checkPatch('connector', ['data.end' => ['item' => self::U, 'ax' => 0.5, 'ay' => 0]]));
    }

    public function testReservedCheckersRefuseEverything(): void {
        foreach (['points', 'bool', 'number', 'later'] as $kind) {
            foreach ([[[1, 2]], true, 1.5, 'x'] as $v) {
                $this->assertSame([false, null], ItemRegistry::checkField([$kind], $v), $kind);
            }
        }
    }

    public function testPlacementNone(): void {
        // Rule 12: a connector has no own position; stored as +0.0.
        $item = ItemRegistry::checkItem(self::connector(['x' => -0.0, 'r' => -0.0]));
        $this->assertNotNull($item);
        $this->assertSame('{"x":0.0,"y":0.0,"w":0.0,"h":0.0,"r":0.0}', json_encode(['x' => $item['x'], 'y' => $item['y'], 'w' => $item['w'], 'h' => $item['h'], 'r' => $item['r']], JSON_PRESERVE_ZERO_FRACTION));
        $this->assertSame(['item' => self::U], $item['data']['start']);
        $this->assertSame(['x' => 1.5, 'y' => -2.0], $item['data']['end'], 'free end as float');
        foreach (['x' => 1.0, 'y' => -0.5, 'w' => 1.0, 'h' => 0.1, 'r' => 45.0, 'parent' => self::U] as $k => $v) {
            $this->assertNull(ItemRegistry::checkItem(self::connector([$k => $v])), "put $k");
            $this->assertNull(ItemRegistry::checkPatch('connector', $k === 'parent' ? ['x' => 0.0, 'y' => 0.0, 'parent' => null] : [$k => 0.0]), "patch $k");
        }
        $this->assertSame(['z' => 'i5'], ItemRegistry::checkPatch('connector', ['z' => 'i5']));
    }

    public function testRequiredEnds(): void {
        // Rule 19: put without an end → bad; a patch deleting one → bad.
        foreach (['start', 'end'] as $which) {
            $c = self::connector();
            unset($c['data'][$which]);
            $this->assertNull(ItemRegistry::checkItem($c), "put without data.$which");
            $this->assertNull(ItemRegistry::checkPatch('connector', ["data.$which" => null]), "patch data.$which null");
            $this->assertNull(ItemRegistry::checkPatch('connector', ["data.$which" => []]), "patch data.$which []");
            $this->assertNull(ItemRegistry::checkPatch('connector', ["data.$which.item" => self::U]), "patch below data.$which");
            $this->assertNull(ItemRegistry::checkPatch('connector', ["data.$which.ax" => 0.5]), "patch data.$which.ax");
        }
        $this->assertTrue(ItemRegistry::hasRequired(self::connector()));
        $this->assertFalse(ItemRegistry::hasRequired(['t' => 'connector', 'data' => ['start' => ['item' => self::U]]]));
        $this->assertTrue(ItemRegistry::hasRequired(['t' => 'sticky', 'data' => []]), 'no required fields');
        $this->assertSame(['data.label' => null, 'data.route' => null], ItemRegistry::checkPatch('connector', ['data.label' => null, 'data.route' => null]), 'other fields may be deleted');
    }

    public function testShapeAndTextFields(): void {
        $shape = self::item(['t' => 'shape', 'w' => 10.0, 'h' => 20000.0, 'data' => ['kind' => 'triangle', 'text' => 'x'], 'style' => ['fill' => '#ABCDEF', 'fillOpacity' => 50.0, 'strokeWidth' => 24, 'textColor' => '#000000', 'fontSize' => 200, 'valign' => 'top']], 'shape');
        $this->assertSame(['fill' => '#abcdef', 'fillOpacity' => 50, 'strokeWidth' => 24, 'textColor' => '#000000', 'fontSize' => 200, 'valign' => 'top'], ItemRegistry::checkItem($shape)['style']);
        $this->assertNull(ItemRegistry::checkItem(self::item(['w' => 9.0], 'shape')));
        $this->assertNull(ItemRegistry::checkItem(self::item(['style' => ['fontSize' => 201]], 'shape')));
        $this->assertNotNull(ItemRegistry::checkItem(self::item(['w' => 4.0, 'h' => 50000.0, 'style' => ['fontSize' => 400]], 'text')));
        $this->assertNull(ItemRegistry::checkItem(self::item(['style' => ['fontSize' => 401]], 'text')));
        $this->assertNull(ItemRegistry::checkItem(self::item(['style' => ['color' => '#ffffff\n']], 'text')), 'whole-string colour (R8)');
        $this->assertSame(['data.kind' => 'arrowRight', 'w' => 20000.0], ItemRegistry::checkPatch('shape', ['data.kind' => 'arrowRight', 'w' => 20000.0]));
        $this->assertNull(ItemRegistry::checkPatch('text', ['style.align' => 'justify']));
    }

    // ---- tests/fixtures/registry-golden.json (SPEC-M1 §4.8, §9.2) --------
    //
    // Frozen in stage 1, phase 0; src/model/registry.js (checkField) is pinned
    // by the same file. Read like production reads bodies: json_decode(…, true).
    // checkField keeps its M0 signature checkField(rule, value); the rule comes
    // from info(t)['fields'][path]. Until WP-B1 (stage 1, phase 1) delivers
    // ItemRegistry v2, testGoldenTypes and testGoldenValuesOfM1Types are red by
    // design; the M0 part (sticky, frame) is green from the start.

    private const GOLDEN_TYPE_KEYS = ['layer', 'container', 'childOf', 'rotatable', 'size', 'textPath', 'bindable', 'votable', 'placement', 'required', 'fields'];
    private const JSON = JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/registry-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testGoldenFixtureFormat(): void {
        $g = self::golden();
        $this->assertSame(['types', 'enums', 'values'], array_keys($g));
        $this->assertSame(['sticky', 'frame', 'shape', 'text', 'connector'], array_keys($g['types']));
        $this->assertSame(['shapeKinds', 'dashes', 'aligns', 'valigns', 'routes', 'caps'], array_keys($g['enums']));
        // Every enum rule refers to one of the listed enums, literally.
        $used = [];
        foreach ($g['types'] as $t => $info) {
            $this->assertSame(self::GOLDEN_TYPE_KEYS, array_keys($info), $t);
            foreach ($info['fields'] as $path => $rule) {
                $this->assertContains($rule[0], ['text', 'color', 'int', 'enum', 'endpoint'], "$t $path");
                if ($rule[0] === 'enum') {
                    $name = array_search($rule[1], $g['enums'], true);
                    $this->assertIsString($name, "$t $path: enum list is one of enums");
                    $used[$name] = true;
                }
            }
        }
        $this->assertCount(6, $used, 'every enum is used by a rule');
        $this->assertGreaterThanOrEqual(60, count($g['values']));
        foreach ($g['values'] as $i => $c) {
            $this->assertSame(['type', 'path', 'value', 'ok', 'norm'], array_keys($c), "#$i");
            $this->assertArrayHasKey($c['path'], $g['types'][$c['type']]['fields'], "#$i: a typed field");
            $this->assertIsBool($c['ok'], "#$i");
            if (!$c['ok']) {
                $this->assertNull($c['norm'], "#$i: norm is null when not ok");
            }
        }
    }

    public function testGoldenTypes(): void {
        // RED until stage-1 phase 1 (WP-B1): ItemRegistry v2 (§4.8).
        $g = self::golden();
        $want = [];
        $got = [];
        $textPaths = [];
        foreach ($g['types'] as $t => $info) {
            $info['fields'] = self::sortedFields($info['fields']);
            $want[$t] = ['has' => true] + $info;
            $actual = ItemRegistry::info($t);
            $row = ['has' => ItemRegistry::has($t)];
            foreach (self::GOLDEN_TYPE_KEYS as $k) {
                // required: §4.8 lists it only for connector; missing = none.
                $row[$k] = array_key_exists($k, $actual) ? $actual[$k] : ($k === 'required' ? [] : '<missing>');
            }
            $row['fields'] = is_array($row['fields']) ? self::sortedFields($row['fields']) : $row['fields'];
            $got[$t] = $row;
            if ($info['textPath'] !== null && !in_array($info['textPath'], $textPaths, true)) {
                $textPaths[] = $info['textPath'];
            }
        }
        $this->assertSame($want, $got);
        $this->assertSame($textPaths, ItemRegistry::allTextPaths(), 'allTextPaths in registry order');
        $this->assertFalse(ItemRegistry::has('pen'), 'pen is a later type');
        $generic = ItemRegistry::info('pen');
        $this->assertSame([false, false, 'box'], [$generic['bindable'] ?? '<missing>', $generic['votable'] ?? '<missing>', $generic['placement'] ?? '<missing>'], 'GENERIC (§4.8)');
    }

    public function testGoldenValuesOfM0Types(): void {
        // Green from the start: the fixture pins the M0 semantics of sticky and frame.
        $this->assertSame([], self::goldenValueMismatches(['sticky', 'frame']));
    }

    public function testGoldenValuesOfM1Types(): void {
        // RED until stage-1 phase 1 (WP-B1): checkers enum and endpoint, types shape/text/connector.
        $this->assertSame([], self::goldenValueMismatches(['shape', 'text', 'connector']));
    }

    /** @return array<string, array> fields sorted by path (the rule lists themselves stay as they are) */
    private static function sortedFields(array $fields): array {
        ksort($fields, SORT_STRING);
        return $fields;
    }

    /**
     * Every golden value of the given types through checkField; ok and norm
     * must match exactly (assertSame semantics plus the JSON form, which alone
     * shows the sign of a zero).
     *
     * @param list<string> $types
     * @return list<string> one line per mismatch
     */
    private static function goldenValueMismatches(array $types): array {
        $out = [];
        $n = 0;
        foreach (self::golden()['values'] as $i => $c) {
            if (!in_array($c['type'], $types, true)) {
                continue;
            }
            $n++;
            $rule = ItemRegistry::info($c['type'])['fields'][$c['path']] ?? null;
            if ($rule === null) {
                $out[] = "#$i {$c['type']} {$c['path']}: no rule";
                continue;
            }
            [$ok, $norm] = ItemRegistry::checkField($rule, $c['value']);
            $value = json_encode($c['value'], self::JSON);
            if ($ok !== $c['ok'] || $norm !== $c['norm'] || json_encode($norm, self::JSON) !== json_encode($c['norm'], self::JSON)) {
                $out[] = sprintf('#%d %s %s %s: got [%s, %s], want [%s, %s]', $i, $c['type'], $c['path'],
                    mb_strlen($value) > 60 ? mb_substr($value, 0, 57) . '…' : $value,
                    json_encode($ok), self::short($norm), json_encode($c['ok']), self::short($c['norm']));
            }
        }
        if ($n === 0) {
            $out[] = 'no golden values for ' . implode(', ', $types);
        }
        return $out;
    }

    private static function short(mixed $v): string {
        $s = json_encode($v, self::JSON);
        return mb_strlen($s) > 60 ? mb_substr($s, 0, 57) . '…' : $s;
    }
}
