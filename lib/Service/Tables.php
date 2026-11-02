<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Tables (factory job 173): the form of a table's data, checked on the
 * stored result of every put (revive too) and patch of a table under the
 * board lock (SyncService), and the cells whose text a patch changes (the
 * lease per cell). The client mirror is src/model/table.js;
 * tests/fixtures/table-golden.json pins both.
 *
 *   data.cols   {"c<8>": {"o": z key, "w": 40–1000}}, 1–20 entries
 *   data.rows   {"r<8>": {"o": z key}}, 1–50 entries
 *   data.cells  {"<col>": {"<row>": text}}, optional; a text is a string of
 *               1–1000 code points after the cleaning of data.text, in a
 *               column and a row that exist
 *
 * No other key at any level of data (style is the registry's). Columns and
 * rows are ordered by o in byte order like z, then by their key.
 */
final class Tables {
    public const MAX_ROWS = 50;
    public const MAX_COLS = 20;
    public const COL_MIN = 40;
    public const COL_MAX = 1000;
    public const CELL_MAX = 1000;
    public const COL_RE = '/^c[0-9a-z]{8}\z/';
    public const ROW_RE = '/^r[0-9a-z]{8}\z/';
    /** A cell as presence names it (me.ec): "<col>.<row>". */
    public const CELL_RE = '/^c[0-9a-z]{8}\.r[0-9a-z]{8}\z/';
    private const DATA_KEYS = ['cols', 'rows', 'cells'];

    /** Does the data of a table have the form above? */
    public static function check(mixed $data): bool {
        if (!PathOps::isMap($data)) {
            return false;
        }
        foreach (array_keys($data) as $k) {
            if (!in_array((string)$k, self::DATA_KEYS, true)) {
                return false;
            }
        }
        $cols = $data['cols'] ?? null;
        $rows = $data['rows'] ?? null;
        if (!PathOps::isMap($cols) || !PathOps::isMap($rows)) {
            return false;
        }
        if (count($cols) < 1 || count($cols) > self::MAX_COLS || count($rows) < 1 || count($rows) > self::MAX_ROWS) {
            return false;
        }
        foreach ($cols as $k => $c) {
            if (preg_match(self::COL_RE, (string)$k) !== 1 || !PathOps::isMap($c) || !self::validOrder($c['o'] ?? null)) {
                return false;
            }
            $w = $c['w'] ?? null;
            if ((!is_int($w) && !is_float($w)) || !is_finite((float)$w) || $w < self::COL_MIN || $w > self::COL_MAX
                || array_diff(array_map('strval', array_keys($c)), ['o', 'w']) !== []) {
                return false;
            }
        }
        foreach ($rows as $k => $r) {
            if (preg_match(self::ROW_RE, (string)$k) !== 1 || !PathOps::isMap($r) || !self::validOrder($r['o'] ?? null)
                || array_diff(array_map('strval', array_keys($r)), ['o']) !== []) {
                return false;
            }
        }
        if (!array_key_exists('cells', $data)) {
            return true;
        }
        $cells = $data['cells'];
        if (!PathOps::isMap($cells)) {
            return false;
        }
        foreach ($cells as $c => $col) {
            if (!array_key_exists((string)$c, $cols) || !PathOps::isMap($col) || $col === []) {
                return false;
            }
            foreach ($col as $r => $text) {
                if (!array_key_exists((string)$r, $rows)) {
                    return false;
                }
                $s = Input::text($text, self::CELL_MAX);
                if ($s === null || $s === '') {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * The keys of the columns (or rows) in order: o in byte order, then the key.
     *
     * @param array<string, mixed> $map data.cols or data.rows (checked)
     * @return list<string>
     */
    public static function ordered(array $map): array {
        $keys = array_map('strval', array_keys($map));
        usort($keys, static function (string $a, string $b) use ($map): int {
            $c = strcmp((string)($map[$a]['o'] ?? ''), (string)($map[$b]['o'] ?? ''));
            return $c !== 0 ? $c : strcmp($a, $b);
        });
        return $keys;
    }

    /**
     * The x of every column in order and the table's width (the sum of the widths).
     *
     * @param array<string, mixed> $data checked data of a table
     * @return array{0: list<float>, 1: float}
     */
    public static function colX(array $data): array {
        $x = 0.0;
        $out = [];
        foreach (self::ordered($data['cols']) as $k) {
            $out[] = $x;
            $x += (float)$data['cols'][$k]['w'];
        }
        return [$out, $x];
    }

    /**
     * The cells whose text differs between two states of a table and whose
     * column and row exist afterwards (deleting a row or column with its
     * cells changes none): what the lease per cell guards.
     *
     * @param array<string, mixed> $before data before
     * @param array<string, mixed> $after data after
     * @return list<string> "<col>.<row>"
     */
    public static function changedCells(array $before, array $after): array {
        $a = PathOps::isMap($after['cells'] ?? null) ? $after['cells'] : [];
        $b = PathOps::isMap($before['cells'] ?? null) ? $before['cells'] : [];
        $cols = PathOps::isMap($after['cols'] ?? null) ? $after['cols'] : [];
        $rows = PathOps::isMap($after['rows'] ?? null) ? $after['rows'] : [];
        $out = [];
        foreach (array_unique(array_merge(array_map('strval', array_keys($a)), array_map('strval', array_keys($b)))) as $c) {
            if (!array_key_exists($c, $cols)) {
                continue;
            }
            $ac = PathOps::isMap($a[$c] ?? null) ? $a[$c] : [];
            $bc = PathOps::isMap($b[$c] ?? null) ? $b[$c] : [];
            foreach (array_unique(array_merge(array_map('strval', array_keys($ac)), array_map('strval', array_keys($bc)))) as $r) {
                if (array_key_exists($r, $rows) && ($ac[$r] ?? null) !== ($bc[$r] ?? null)) {
                    $out[] = $c . '.' . $r;
                }
            }
        }
        return $out;
    }

    private static function validOrder(mixed $o): bool {
        return is_string($o) && ZOrder::isValid($o);
    }
}
