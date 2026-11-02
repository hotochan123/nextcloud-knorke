<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Reactions;
use PHPUnit\Framework\TestCase;

/**
 * Emoji reactions of notes (factory job 172, AK1): the emoji check against
 * tests/fixtures/reactions-golden.json (the same cases as
 * tests/js/model/reactions.test.mjs), the op key, the paths that touch
 * data.react, the stored name and the put filter.
 */
final class ReactionsTest extends TestCase {
    private const PID = '3f9a1c0b7d2e4a51';

    /** @return array<string, mixed> */
    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/reactions-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testGoldenEmojiCases(): void {
        $cases = self::golden()['emoji'];
        $this->assertGreaterThan(30, count($cases));
        $valid = array_column(array_filter($cases, static fn (array $c): bool => $c['valid']), 'e');
        foreach (['1f44d', '2764-fe0f', '1f602', '1f389', '1f914', '1f440', '1f680', '1f468-200d-1f469-200d-1f467-200d-1f466',
            '1f3f4-e0067-e0062-e0065-e006e-e0067-e007f', '31-fe0f-20e3', '1f1e9-1f1ea'] as $e) {
            $this->assertContains($e, $valid, 'AK1 lists ' . $e . ' as valid');
        }
        foreach ($cases as $c) {
            $this->assertSame($c['valid'], Reactions::isEmoji($c['e']), $c['note'] . ' (' . $c['e'] . ')');
            if ($c['valid']) {
                // native ↔ hex is lossless: the code points of the native text are e
                $hex = implode('-', array_map(static fn (string $ch): string => dechex(mb_ord($ch, 'UTF-8')), mb_str_split($c['native'], 1, 'UTF-8')));
                $this->assertSame($c['e'], $hex, $c['note']);
            }
        }
        foreach ([null, 1, 0x1f44d, true, ['1f44d'], 1.5] as $v) {
            $this->assertFalse(Reactions::isEmoji($v), json_encode($v));
        }
    }

    public function testOpKeyAndTouches(): void {
        $this->assertSame('p' . self::PID, Reactions::opKey(['data.react.p' . self::PID => null]));
        $this->assertSame('foo', Reactions::opKey(['data.react.foo' => ['e' => '1f44d']]), 'a foreign key is still a reaction op (denied later)');
        $this->assertNull(Reactions::opKey(['data.react' => []]));
        $this->assertNull(Reactions::opKey(['data.react.p' . self::PID . '.e' => '1f44d']));
        $this->assertNull(Reactions::opKey(['data.react.p' . self::PID => null, 'data.text' => 'x']));
        $this->assertNull(Reactions::opKey(['data.text' => 'x']));
        $this->assertNull(Reactions::opKey(['data.react.' => null]));
        $this->assertNull(Reactions::opKey('data.react.p1'));
        $this->assertNull(Reactions::opKey([1]));
        $this->assertTrue(Reactions::touches('data.react'));
        $this->assertTrue(Reactions::touches('data.react.pX.e'));
        $this->assertFalse(Reactions::touches('data.reactions'));
        $this->assertFalse(Reactions::touches('style.react'));
        $this->assertSame('p' . self::PID, Reactions::keyOf(self::PID));
    }

    public function testNameIsCutLikeTheLockerName(): void {
        $this->assertSame('Bob Berg', Reactions::name("  Bob\u{0000}\n  Berg  ", true));
        $long = str_repeat('abcdefghij', 7);
        $this->assertSame(substr($long, 0, 64), Reactions::name($long, true));
        $this->assertSame("\u{FFFD}Bob", Reactions::name('😀Bob', false));
        $this->assertSame('😀Bob', Reactions::name('😀Bob', true));
        $this->assertSame('', Reactions::name('', true));
    }

    public function testFilterPut(): void {
        $item = static fn (string $t, mixed $react): array => ['t' => $t, 'data' => ['text' => 'A', 'react' => $react], 'style' => []];
        $good = ['p' . self::PID => ['e' => '1f44d', 'n' => 'Alice'], 'pbbbbbbbbbbbbbbbb' => ['e' => '2764-fe0f', 'n' => 'Bob']];
        $bad = [
            'pcccccccccccccccc' => ['e' => '1F44D', 'n' => 'Carol'],
            'pdddddddddddddddd' => ['e' => '1f44d'],
            'peeeeeeeeeeeeeeee' => ['e' => '1f44d', 'n' => 7],
            'p123' => ['e' => '1f44d', 'n' => 'Short'],
            'xfffffffffffffffff' => ['e' => '1f44d', 'n' => 'Other'],
            'p0000000000000000' => 'not a map',
        ];
        // without revive: gone
        $this->assertSame(['text' => 'A'], Reactions::filterPut($item('sticky', $good), false, true)['data']);
        // revive of a sticky: the valid entries stay
        $this->assertSame(['text' => 'A', 'react' => $good], Reactions::filterPut($item('sticky', $good + $bad), true, true)['data']);
        $this->assertSame(['text' => 'A'], Reactions::filterPut($item('sticky', $bad), true, true)['data'], 'nothing valid: no data.react');
        $this->assertSame(['text' => 'A'], Reactions::filterPut($item('sticky', 'x'), true, true)['data']);
        // revive of another type: gone
        $this->assertSame(['text' => 'A'], Reactions::filterPut($item('shape', $good), true, true)['data']);
        // the names are cut like a written name
        $named = Reactions::filterPut($item('sticky', ['p' . self::PID => ['e' => '1f44d', 'n' => ' 😀 Alice ', 'x' => 1]]), true, false)['data']['react'];
        $this->assertSame(['p' . self::PID => ['e' => '1f44d', 'n' => "\u{FFFD} Alice"]], $named);
        // no reactions at all: the item as it was
        $plain = ['t' => 'sticky', 'data' => ['text' => 'A'], 'style' => []];
        $this->assertSame($plain, Reactions::filterPut($plain, true, true));
    }
}
