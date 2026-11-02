<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Swimlanes (factory job 199): a frame with data.lanes is divided into
 * lanes. The form of data.lanes is checked on the stored result of every put
 * (revive too) and patch of a frame that has the field, under the board lock
 * (SyncService). The client mirror is src/model/lanes.js;
 * tests/fixtures/lanes-golden.json pins both.
 *
 *   data.lanes    {"l<8>": {"o": z key, "h": 60–100000, "t"?: name, "g"?: group}}, 1–30 entries
 *   data.cols     {"c<8>": {"o": z key, "w": 100–100000, "t"?: name, "g"?: group}}, 1–30 entries (job 208)
 *   data.lgroups  {"g<8>": name}, 1–30 entries (job 225)
 *   data.cgroups  {"h<8>": name}, 1–30 entries (job 225)
 *
 * A name is a string of 1–200 code points after the cleaning of data.title
 * (empty: absent); a group's name has 0–200 ('' none: an empty map would be
 * absent on the wire). No other key in a lane or column; its g names a key
 * of data.lgroups (data.cgroups). Lanes and columns are ordered by o in byte
 * order like z, then by their key. That the heights (widths) add up to the
 * frame's room, and that a group's lanes are neighbours, is not checked: the
 * client draws them in proportion to it, and each run of a group as a cell.
 */
final class Lanes {
    public const MAX_LANES = 30;
    public const MIN_H = 60;
    public const MAX_H = 100000;
    public const TITLE_MAX = 200;
    public const KEY_RE = '/^l[0-9a-z]{8}\z/';
    /** Job 208: the columns. */
    public const MAX_COLS = 30;
    public const MIN_W = 100;
    public const MAX_W = 100000;
    public const COL_KEY_RE = '/^c[0-9a-z]{8}\z/';
    /** Job 225: the groups of lanes and of columns. */
    public const MAX_GROUPS = 30;
    public const LGROUP_KEY_RE = '/^g[0-9a-z]{8}\z/';
    public const CGROUP_KEY_RE = '/^h[0-9a-z]{8}\z/';

    /** Does data.lanes of a frame have the form above (job 225: g naming a key of $groups, data.lgroups)? */
    public static function check(mixed $lanes, mixed $groups = null): bool {
        if ($groups !== null && !self::checkGroups($groups, self::LGROUP_KEY_RE)) {
            return false;
        }
        return self::checkMap($lanes, self::KEY_RE, 'h', self::MIN_H, self::MAX_H, self::MAX_LANES, $groups);
    }

    /** Job 208: does data.cols of a frame have the form above (job 225: g naming a key of $groups, data.cgroups)? */
    public static function checkCols(mixed $cols, mixed $groups = null): bool {
        if ($groups !== null && !self::checkGroups($groups, self::CGROUP_KEY_RE)) {
            return false;
        }
        return self::checkMap($cols, self::COL_KEY_RE, 'w', self::MIN_W, self::MAX_W, self::MAX_COLS, $groups);
    }

    /** Job 225: does data.lgroups (data.cgroups: CGROUP_KEY_RE) have the form above? */
    public static function checkGroups(mixed $groups, string $re = self::LGROUP_KEY_RE): bool {
        if (!PathOps::isMap($groups) || count($groups) < 1 || count($groups) > self::MAX_GROUPS) {
            return false;
        }
        foreach ($groups as $k => $name) {
            if (preg_match($re, (string)$k) !== 1 || Input::text($name, self::TITLE_MAX) === null) {
                return false;
            }
        }
        return true;
    }

    /**
     * Job 225: the lanes, columns and groups of a frame's data, each when present
     * (SyncService on every put and patch of a frame).
     *
     * @param array<string, mixed> $data the frame's data
     */
    public static function checkFrame(array $data): bool {
        $lg = $data['lgroups'] ?? null;
        $cg = $data['cgroups'] ?? null;
        if (array_key_exists('lanes', $data) && !self::check($data['lanes'], $lg)) {
            return false;
        }
        if (array_key_exists('cols', $data) && !self::checkCols($data['cols'], $cg)) {
            return false;
        }
        if (array_key_exists('lgroups', $data) && !self::checkGroups($lg, self::LGROUP_KEY_RE)) {
            return false;
        }
        return !array_key_exists('cgroups', $data) || self::checkGroups($cg, self::CGROUP_KEY_RE);
    }

    private static function checkMap(mixed $map, string $re, string $size, int $min, int $max, int $most, mixed $groups): bool {
        if (!PathOps::isMap($map) || count($map) < 1 || count($map) > $most) {
            return false;
        }
        foreach ($map as $k => $entry) {
            if (preg_match($re, (string)$k) !== 1 || !PathOps::isMap($entry)
                || array_diff(array_map('strval', array_keys($entry)), ['o', $size, 't', 'g']) !== []) {
                return false;
            }
            $o = $entry['o'] ?? null;
            if (!is_string($o) || !ZOrder::isValid($o)) {
                return false;
            }
            $n = $entry[$size] ?? null;
            if ((!is_int($n) && !is_float($n)) || !is_finite((float)$n) || $n < $min || $n > $max) {
                return false;
            }
            if (array_key_exists('t', $entry)) {
                $s = Input::text($entry['t'], self::TITLE_MAX);
                if ($s === null || $s === '') {
                    return false;
                }
            }
            if (array_key_exists('g', $entry)
                && (!is_string($entry['g']) || !is_array($groups) || !array_key_exists($entry['g'], $groups))) {
                return false;
            }
        }
        return true;
    }

    /**
     * The keys of the lanes (or columns) in order: o in byte order, then the key.
     *
     * @param array<string, mixed> $lanes data.lanes or data.cols (checked)
     * @return list<string>
     */
    public static function ordered(array $lanes): array {
        $keys = array_map('strval', array_keys($lanes));
        usort($keys, static function (string $a, string $b) use ($lanes): int {
            $c = strcmp((string)($lanes[$a]['o'] ?? ''), (string)($lanes[$b]['o'] ?? ''));
            return $c !== 0 ? $c : strcmp($a, $b);
        });
        return $keys;
    }
}
