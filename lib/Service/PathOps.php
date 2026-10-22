<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Working-copy path operations of the write path (SPEC-M0 §4.7 rule 3,
 * §4.10.1), mirror of src/model/paths.js; tests/fixtures/paths-golden.json
 * pins both. All functions are pure: items go in and new items come out.
 *
 * An item is ['t'?, 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data' => map,
 * 'style' => map]. Values come from json_decode(…, true), so PHP cannot tell
 * {} from []; the rules make that harmless ("empty = absent"):
 *
 *  (a) root fields are set as given; parent = null keeps the key with null
 *  (b) null, {} and [] — and object values that clean to empty — delete the
 *      path; empty parent maps are pruned, the root containers data/style stay
 *  (c) deleting an absent path is a strict no-op (also through a scalar or a
 *      list, and a missing root container is not created)
 *  (d) setting through a scalar or a list replaces it with a map; a missing
 *      root container is created (appended)
 *  (e) object values are cleaned recursively (inside lists too), key order kept
 *  (f) only own keys count (there is no prototype in PHP anyway)
 *  (g) isWireValue(): the value rules (depth ≤ 6, lists ≤ 1000 elements
 *      without null/{}/[] elements, objects ≤ 100 keys matching KEY_RE)
 */
final class PathOps {
    public const KEY_RE = '/^[A-Za-z][A-Za-z0-9_-]{0,39}\z/';
    /** Root fields of an item that are not containers. */
    public const ROOT_FIELDS = ['x', 'y', 'w', 'h', 'r', 'z', 'parent'];
    /** Root containers addressed with data.<k>… / style.<k>…. */
    public const CONTAINERS = ['data', 'style'];
    public const MAX_DEPTH = 6;
    public const MAX_LIST = 1000;
    public const MAX_KEYS = 100;

    /** A map (JSON object) as decoded by PHP: [] or a non-list array. */
    public static function isMap(mixed $v): bool {
        return is_array($v) && ($v === [] || !array_is_list($v));
    }

    /**
     * Empty = absent, recursively: null, [] and maps that clean to nothing
     * are absent; lists keep their (cleaned) elements.
     *
     * @return array{0: bool, 1: mixed} [present, cleaned value]
     */
    public static function clean(mixed $v): array {
        if ($v === null || $v === []) {
            return [false, null];
        }
        if (!is_array($v)) {
            return [true, $v];
        }
        if (array_is_list($v)) {
            return [true, array_map(static fn (mixed $e): mixed => self::clean($e)[1], $v)];
        }
        $out = [];
        foreach ($v as $k => $e) {
            [$present, $c] = self::clean($e);
            if ($present) {
                $out[$k] = $c;
            }
        }
        return $out === [] ? [false, null] : [true, $out];
    }

    /** Value at a dotted path, or null when absent (or below a non-map). */
    public static function getPath(array $item, string $path): mixed {
        $node = $item;
        foreach (explode('.', $path) as $k) {
            if (!self::isMap($node) || !array_key_exists($k, $node)) {
                return null;
            }
            $node = $node[$k];
        }
        return $node;
    }

    /** Sets (or with an empty value: deletes) one path; returns the new item. */
    public static function setPath(array $item, string $path, mixed $value): array {
        [$present, $v] = self::clean($value);
        $keys = explode('.', $path);
        if (count($keys) === 1) {
            $item[$path] = $present ? $v : null;
            return $item;
        }
        $root = array_shift($keys);
        if (!$present) {
            if (self::getPath($item, $path) === null) {
                return $item;
            }
            $item[$root] = self::deleteIn($item[$root], $keys);
            return $item;
        }
        $item[$root] = self::setIn(self::isMap($item[$root] ?? null) ? $item[$root] : [], $keys, $v);
        return $item;
    }

    /**
     * Sets $v at $keys inside $map, creating (or replacing non-map nodes with)
     * maps on the way. $v must be present (non-empty).
     *
     * @param list<string> $keys
     */
    public static function setIn(array $map, array $keys, mixed $v): array {
        $k = array_shift($keys);
        if ($keys === []) {
            $map[$k] = $v;
            return $map;
        }
        $map[$k] = self::setIn(array_key_exists($k, $map) && self::isMap($map[$k]) ? $map[$k] : [], $keys, $v);
        return $map;
    }

    /**
     * Removes the existing path $keys from $map and prunes maps that became
     * empty (the caller guarantees the path exists).
     *
     * @param list<string> $keys
     */
    private static function deleteIn(array $map, array $keys): array {
        $k = array_shift($keys);
        if ($keys === []) {
            unset($map[$k]);
            return $map;
        }
        $sub = self::deleteIn($map[$k], $keys);
        if ($sub === []) {
            unset($map[$k]);
        } else {
            $map[$k] = $sub;
        }
        return $map;
    }

    /**
     * Value rules of §4.7 rule 3. Top-level null/{}/[] are allowed (= delete).
     * $depth counts the containers above $v (the value itself is level 1).
     */
    public static function isWireValue(mixed $v, int $depth = 0): bool {
        if ($v === null || is_string($v) || is_bool($v) || is_int($v)) {
            return true;
        }
        if (is_float($v)) {
            return is_finite($v);
        }
        if (!is_array($v) || $depth >= self::MAX_DEPTH) {
            return false;
        }
        if ($v === []) {
            return true;
        }
        if (array_is_list($v)) {
            if (count($v) > self::MAX_LIST) {
                return false;
            }
            foreach ($v as $e) {
                if (!self::isWireValue($e, $depth + 1) || !self::clean($e)[0]) {
                    return false;
                }
            }
            return true;
        }
        if (count($v) > self::MAX_KEYS) {
            return false;
        }
        foreach ($v as $k => $e) {
            if (!is_string($k) || preg_match(self::KEY_RE, $k) !== 1 || !self::isWireValue($e, $depth + 1)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Deep equality for no-op detection: maps by key set (order-insensitive),
     * lists element-wise, numbers by value (1 and 1.0 are equal), everything
     * else strictly.
     */
    public static function same(mixed $a, mixed $b): bool {
        if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) {
            return (float)$a === (float)$b;
        }
        if (!is_array($a) || !is_array($b)) {
            return $a === $b;
        }
        if (count($a) !== count($b) || self::isMap($a) !== self::isMap($b)) {
            return false;
        }
        foreach ($a as $k => $v) {
            if (!array_key_exists($k, $b) || !self::same($v, $b[$k])) {
                return false;
            }
        }
        return true;
    }
}
