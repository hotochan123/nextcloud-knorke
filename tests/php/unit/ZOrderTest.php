<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\ZOrder;
use PHPUnit\Framework\TestCase;

/** tests/fixtures/zorder-golden.json (SPEC-M0 §4.8), shared with src/model/zorder.js. */
final class ZOrderTest extends TestCase {
    private static function golden(): array {
        return json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/zorder-golden.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testGoldenValid(): void {
        $g = self::golden();
        $this->assertSame(['valid', 'invalid'], array_keys($g));
        foreach (['i0', 'hz', 'j00', 'i0a', 'i1', 'zzzzzzzzzzzzzzzzzzz'] as $must) {
            $this->assertContains($must, $g['valid']);
        }
        foreach ($g['valid'] as $z) {
            $this->assertTrue(ZOrder::isValid($z), 'valid: ' . $z);
        }
    }

    public function testGoldenInvalid(): void {
        $g = self::golden();
        foreach (['a', 'zz', '0', 'i10', '', 'i0V', '0000000000000000000'] as $must) {
            $this->assertContains($must, $g['invalid']);
        }
        $this->assertNotEmpty(array_filter($g['invalid'], static fn (string $z): bool => strlen($z) === 65));
        foreach ($g['invalid'] as $z) {
            $this->assertFalse(ZOrder::isValid($z), 'invalid: ' . json_encode($z));
        }
    }

    public function testTrailingNewlineIsInvalid(): void {
        // A $-anchored regex would accept "i0\n".
        $this->assertFalse(ZOrder::isValid("i0\n"));
        $this->assertTrue(ZOrder::isValid('i0'));
    }

    public function testSixtyFourIsTheLimit(): void {
        $this->assertTrue(ZOrder::isValid('i0' . str_repeat('1', 62)));
        $this->assertFalse(ZOrder::isValid('i0' . str_repeat('1', 63)));
    }
}
