<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Input;
use PHPUnit\Framework\TestCase;

/** Client values never cause a warning or a TypeError (Pulse port + Knorke text rules). */
final class InputTest extends TestCase {
    public function testStr(): void {
        $this->assertSame('', Input::str(['a']));
        $this->assertSame('', Input::str(null));
        $this->assertSame('x', Input::str(null, 'x'));
        $this->assertSame('12', Input::str(12));
        $this->assertSame('ab', Input::str("a\0b"));
        $this->assertSame('', Input::str("\xff"));
        $this->assertSame('', Input::str(INF));
    }

    public function testNumbers(): void {
        $this->assertSame(12, Input::int('12'));
        $this->assertSame(1, Input::int(1.9));
        $this->assertNull(Input::int(1e100));
        $this->assertNull(Input::int(['1']));
        $this->assertNull(Input::int(true));
        $this->assertNull(Input::number(INF));
        $this->assertTrue(Input::flag('true'));
        $this->assertFalse(Input::flag(0));
        $this->assertNull(Input::flag('maybe'));
        $this->assertNull(Input::flag([1]));
    }

    public function testText(): void {
        $this->assertSame("a\nb\tc", Input::text("a\r\nb\tc\x01", 10));
        $this->assertSame('ab', Input::text("a\rb", 10));
        $this->assertNull(Input::text(str_repeat('ü', 11), 10));
        $this->assertSame(str_repeat('ü', 10), Input::text(str_repeat('ü', 10), 10));
        $this->assertNull(Input::text(5, 10));
        $this->assertNull(Input::text("\xc3", 10));
    }

    public function testTitle(): void {
        $this->assertSame('Retro KW41', Input::title("  Retro KW41 \n", 200));
        $this->assertSame('', Input::title('   ', 200));
        $this->assertSame('', Input::title(null, 200));
        $this->assertNull(Input::title("a\nb", 200));
        $this->assertNull(Input::title(str_repeat('x', 201), 200));
        $this->assertSame(str_repeat('é', 200), Input::title(str_repeat('é', 200), 200));
        $this->assertNull(Input::title(['x'], 200));
    }

    public function testDisplayName(): void {
        $this->assertSame('Gina', Input::displayName('  Gina  '));
        $this->assertSame('Gina Berg', Input::displayName("Gina\n\t  Berg"));
        $this->assertSame('', Input::displayName("\u{200B}\u{2800}\u{3164}"));
        $this->assertSame('Anna', Input::displayName("An\u{200B}na\u{0007}"));
        $this->assertSame(str_repeat('😀', 40), Input::displayName(str_repeat('😀', 50)));
        $this->assertSame('', Input::displayName(['Gina']));
        $this->assertSame('Tom & Jerry <b>', Input::displayName('Tom & Jerry <b>'), 'names are data, not markup');
    }
}
