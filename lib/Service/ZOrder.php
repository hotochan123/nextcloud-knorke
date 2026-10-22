<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Validity of a z (order) key (SPEC-M0 §4.8). Port of validateOrderKey,
 * getIntegerLength and isSmallestInteger from fractional-indexing 4.0 (CC0),
 * with digits = intDigits = base 36. src/model/zorder.js isValidKey() applies
 * the same rules; tests/fixtures/zorder-golden.json pins both.
 *
 * Why it matters: a single stored key the library cannot handle (e.g. 'a')
 * makes keyBetween() throw on every client, and nobody could create or
 * reorder on the board any more — reachable through the public edit link.
 */
final class ZOrder {
    public const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
    /** Smallest integer part: head '0' followed by 18 zeros. */
    private const SMALLEST = '0000000000000000000';
    private const HALF = 18;

    public static function isValid(string $z): bool {
        // \z, not $: "i0\n" must not pass.
        if (preg_match('/^[0-9a-z]{1,64}\z/', $z) !== 1 || $z === self::SMALLEST) {
            return false;
        }
        $i = strpos(self::DIGITS, $z[0]);
        if ($i === false) {
            return false;
        }
        $n = $i < self::HALF ? self::HALF - $i + 1 : $i - self::HALF + 2;
        if (strlen($z) < $n) {
            return false;
        }
        return !str_ends_with(substr($z, $n), '0');
    }
}
