<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Pure connector math (SPEC-M1 §3.10, §4.7 rule 14, §9.7), bit-identical to
 * src/model/connectors.js and src/model/geometry.js (q). Pinned by
 * tests/fixtures/connector-golden.json (anchorPoint) and the endpoint cases
 * of tests/fixtures/registry-golden.json (endpoint).
 *
 * No state, no database: the write path (SyncService, rule 14) decides which
 * end to check or to release, this class only says what a valid end looks
 * like and where an anchor lies.
 */
final class Connectors {
    /** Grid of the stored anchor coordinates ax/ay (§3.10). */
    public const ANCHOR_GRID = 10000;
    /** Grid of anchor points in world coordinates (§4.7 rule 14). */
    public const POINT_GRID = 100;

    /**
     * The rounding formula of §4.7, literally:
     *   q(v, k) = (v < 0 ? -1 : 1) * floor(abs(v) * k + 0.5) / k
     * Never PHP round(): round() and the JS mirror disagree on ≈ 7 % of the
     * values of a 0.01 grid (round(1.005, 2) = 1.01, but 1.005 * 100 is
     * 100.49999999999999). (R7) The result is never -0: for -0.005 < v < 0
     * the formula yields -0.0, which json_encode writes as "-0" while
     * JSON.stringify writes "0"; adding +0.0 turns -0.0 into +0.0 and leaves
     * every other value unchanged.
     */
    public static function q(float $v, int $k): float {
        $r = ($v < 0 ? -1 : 1) * floor(abs($v) * $k + 0.5) / $k;
        return $r + 0.0;
    }

    /**
     * A connector end (§3.10), exactly one of three forms, no other key:
     *   {item}            bound, side chosen when routing ("auto")
     *   {item, ax, ay}    bound to an anchor of the UNROTATED box, ax and ay
     *                     each a number in [0, 1] (checked on the value as
     *                     sent), stored as q(v, 10000)
     *   {x, y}            free end in world coordinates, |v| ≤ NUM_ABS_MAX
     * item is a ULID (OpValidator::ULID_RE: 26 Crockford base32 characters,
     * upper case), like id and parent; whether it names a live, bindable item
     * is decided in the board lock (rule 14), not here. Numbers are JSON numbers
     * (int or float, never bool or numeric text) and finite. The result has a
     * fixed key order (item, ax, ay / x, y) and float coordinates, never -0.
     *
     * @return array{item: string}|array{item: string, ax: float, ay: float}|array{x: float, y: float}|null
     *         the normalized end, or null (`bad`)
     */
    public static function endpoint(mixed $v): ?array {
        if (!is_array($v)) {
            return null;
        }
        $n = count($v);
        if ($n === 1 && array_key_exists('item', $v)) {
            return self::validItem($v['item']) ? ['item' => $v['item']] : null;
        }
        if ($n === 3 && array_key_exists('item', $v) && array_key_exists('ax', $v) && array_key_exists('ay', $v)) {
            if (!self::validItem($v['item'])) {
                return null;
            }
            $ax = self::finite($v['ax']);
            $ay = self::finite($v['ay']);
            if ($ax === null || $ay === null || $ax < 0 || $ax > 1 || $ay < 0 || $ay > 1) {
                return null;
            }
            return ['item' => $v['item'], 'ax' => self::q($ax, self::ANCHOR_GRID), 'ay' => self::q($ay, self::ANCHOR_GRID)];
        }
        if ($n === 2 && array_key_exists('x', $v) && array_key_exists('y', $v)) {
            $x = self::finite($v['x']);
            $y = self::finite($v['y']);
            if ($x === null || $y === null || abs($x) > Limits::NUM_ABS_MAX || abs($y) > Limits::NUM_ABS_MAX) {
                return null;
            }
            // + 0.0: a free end is stored as given, but never as -0 (same reason as q).
            return ['x' => $x + 0.0, 'y' => $y + 0.0];
        }
        return null;
    }

    /**
     * The anchor point of an end bound to $row (§4.7 rule 14), in world
     * coordinates on the 0.01 grid. Box (X, Y, w, h, r) with X = x + parent.x,
     * Y = y + parent.y (containers are roots, so the parent's own position is
     * absolute); cx = X + w/2, cy = Y + h/2. Without ax/ay ("auto") the centre,
     * otherwise dx = (ax − 0.5)·w, dy = (ay − 0.5)·h, θ = r·π/180,
     * px = cx + dx·cos θ − dy·sin θ, py = cy + dx·sin θ + dy·cos θ. The order
     * of the operations is the one of the spec, in both languages; for r = 0
     * the result is bit-identical to JS (cos 0 = 1, sin 0 = 0 exactly), for
     * r ≠ 0 sin/cos of libm and V8 may differ in the last bit.
     *
     * @param array{x: int|float, y: int|float, w: int|float, h: int|float, r: int|float} $row the bound item
     * @param array{x: int|float, y: int|float}|null $parent its container, or null at the root
     * @param array{item: string, ax?: int|float, ay?: int|float} $ep the (normalized) end
     * @return array{0: float, 1: float} [q(px, 100), q(py, 100)]
     */
    public static function anchorPoint(array $row, ?array $parent, array $ep): array {
        $x = (float)$row['x'];
        $y = (float)$row['y'];
        if ($parent !== null) {
            $x = $x + (float)$parent['x'];
            $y = $y + (float)$parent['y'];
        }
        $w = (float)$row['w'];
        $h = (float)$row['h'];
        $cx = $x + $w / 2;
        $cy = $y + $h / 2;
        if (!array_key_exists('ax', $ep) || !array_key_exists('ay', $ep)) {
            return [self::q($cx, self::POINT_GRID), self::q($cy, self::POINT_GRID)];
        }
        $dx = ((float)$ep['ax'] - 0.5) * $w;
        $dy = ((float)$ep['ay'] - 0.5) * $h;
        $t = (float)$row['r'] * M_PI / 180;
        $cos = cos($t);
        $sin = sin($t);
        $px = $cx + $dx * $cos - $dy * $sin;
        $py = $cy + $dx * $sin + $dy * $cos;
        return [self::q($px, self::POINT_GRID), self::q($py, self::POINT_GRID)];
    }

    /** A ULID (as OpValidator checks id and parent); is_string first, preg_match would throw on an array. */
    private static function validItem(mixed $item): bool {
        return is_string($item) && preg_match(OpValidator::ULID_RE, $item) === 1;
    }

    /** A JSON number (int or float, not bool, not text) that is finite, as float; else null. */
    private static function finite(mixed $v): ?float {
        if (!is_int($v) && !is_float($v)) {
            return null;
        }
        $f = (float)$v;
        return is_finite($f) ? $f : null;
    }
}
