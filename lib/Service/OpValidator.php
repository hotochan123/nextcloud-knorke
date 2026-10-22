<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Generic validation of client ops (SPEC-M0 §4.6, §4.8), pure and static. It
 * runs BEFORE the write transaction so the board row lock stays short:
 * format, role, numbers, z key, placement group, value rules, string
 * cleaning. What needs the stored row (the type of a patched item, the
 * parent, the lease) is checked under the lock in SyncService.
 *
 * $fourByte = false (IDBConnection::supports4ByteText() false: legacy
 * MySQL/MariaDB with utf8mb3 tables): every string value inside data/style
 * has its code points above U+FFFF replaced by U+FFFD (Input::bmp), so an
 * emoji is stored as U+FFFD instead of failing the batch with a 500. The
 * writer gets the stored item back in the same answer (§4.5).
 *
 * Result of normalize():
 *   ['o' => 'bad'] | ['o' => 'denied']
 *   ['o' => 'put', 'id' => ulid, 'item' => normalized item, 'revive' => bool]
 *   ['o' => 'patch', 'id' => ulid, 'p' => [path => cleaned value], 'keep' => bool]
 *   ['o' => 'lock', 'id' => ulid, 'on' => bool]
 *   ['o' => 'remove', 'id' => ulid]
 *
 * Groups (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): a put may carry p.group, a
 * patch the root path `group` (its own LWW register like z, also beside
 * other paths). The value is null (no group) or a group id that matches
 * ULID_RE (isGroupId); anything else ("", a lower-case or 25/27-character
 * id, a number, true, {}, []) is `bad`: ItemStore::itemJson encodes
 * group_id without error flags, so only such ids may reach the column.
 * `group.<k>` is no path, and `group` beside `lock` is `bad` (the lock op
 * stands alone). The normalized put item carries `group` (string or null).
 * Which types may be grouped is ItemRegistry's (isGroupable), and losing
 * members is SyncService's (dissolve at the end of the batch).
 *
 * Lock and unlock (M2, SPEC-M1 §1.2 "(R20) Sperren") travel as a patch whose
 * ONLY path is `lock`: {"lock": {…}} (a non-empty JSON object that meets the
 * value rules; its content is neither read nor stored, the locker is always
 * the principal) locks, {"lock": null | {} | []} unlocks (rule 3: empty =
 * absent). Any other value, or `lock` next to another path, is `bad`; keep
 * is ignored. The role comes first: vote and view are `denied` here too. The
 * rights on the stored lock (only the locker or a moderator unlocks, nothing
 * else touches a locked item) are SyncService::authorize()'s, under the lock.
 *
 * keep (SPEC-M1 §4.6, §4.7 rule 15) is true only for the literal true; it
 * acts on containers only and is ignored everywhere else (like every other
 * unknown op key, M0 leniency).
 */
final class OpValidator {
    public const ULID_RE = '/^[0-9A-HJKMNP-TV-Z]{26}\z/';
    /** Placement group (§4.7 rule 2a): a patch writes all three or none. */
    public const PLACEMENT = ['x', 'y', 'parent'];
    private const NUMBERS = ['x', 'y', 'w', 'h', 'r'];
    private const BAD = ['o' => 'bad'];
    private const DENIED = ['o' => 'denied'];

    /** @return array<string, mixed> */
    public static function normalize(Principal $p, mixed $op, bool $fourByte = true): array {
        if (!PathOps::isMap($op) || $op === []) {
            return self::BAD;
        }
        $o = $op['o'] ?? null;
        $id = $op['id'] ?? null;
        if (!in_array($o, ['put', 'patch', 'remove'], true) || !is_string($id) || preg_match(self::ULID_RE, $id) !== 1) {
            return self::BAD;
        }
        // Role rights per op live here, before the lock (M1: vote/view rules).
        // Rights that need the stored row go to SyncService::authorize().
        if (!$p->role->canEdit()) {
            return self::DENIED;
        }
        if ($o === 'remove') {
            return ['o' => 'remove', 'id' => $id];
        }
        if ($o === 'put') {
            $t = $op['t'] ?? null;
            if (!is_string($t) || !ItemRegistry::has($t)) {
                return self::BAD;
            }
            $item = self::cleanPut($t, $op['p'] ?? null, $fourByte);
            if ($item === null) {
                return self::BAD;
            }
            return ['o' => 'put', 'id' => $id, 'item' => $item, 'revive' => ($op['revive'] ?? false) === true];
        }
        $p = $op['p'] ?? null;
        if (PathOps::isMap($p) && array_key_exists('lock', $p)) {
            return self::lockOp($id, $p, $fourByte);
        }
        $patch = self::cleanPatch($p, $fourByte);
        return $patch === null ? self::BAD : ['o' => 'patch', 'id' => $id, 'p' => $patch, 'keep' => ($op['keep'] ?? false) === true];
    }

    /**
     * A patch with the path `lock` (see the class comment): `lock` must be
     * its only key; null, {} or [] unlocks, a non-empty JSON object that
     * passes the value rules (PathOps::isWireValue, strings through
     * cleanValue) locks; every other value is `bad`.
     *
     * @param array<string, mixed> $p patch payload with the key `lock`
     * @return array{o: string, id?: string, on?: bool}
     */
    private static function lockOp(string $id, array $p, bool $fourByte): array {
        if (count($p) !== 1) {
            return self::BAD;
        }
        $v = $p['lock'];
        if ($v === null || $v === []) {
            return ['o' => 'lock', 'id' => $id, 'on' => false];
        }
        if (!PathOps::isMap($v) || !self::cleanValue($v, $fourByte)[0]) {
            return self::BAD;
        }
        return ['o' => 'lock', 'id' => $id, 'on' => true];
    }

    /** Is the raw op a vote op (SPEC-M1 §4.6)? Those go to VoteService::apply, never to applyOps. */
    public static function isVote(mixed $op): bool {
        return is_array($op) && ($op['o'] ?? null) === 'vote';
    }

    /**
     * The vote op {"o":"vote","s":12,"id":"<ULID>","n":2} (SPEC-M1 §4.6,
     * §4.13.2 step 2), checked BEFORE the lock: `s` an integer ≥ 1, `id` a
     * ULID, `n` an integer 0–VOTE_PER_MAX (a JSON number with a zero
     * fraction counts as an integer, like checkField); otherwise `bad`. Then
     * the role: canVote() (owner, edit, vote), otherwise `denied`. Other keys
     * are ignored. Set semantics: n is the voter's number on the item, never
     * a delta.
     *
     * @return array{o: string, s?: int, id?: string, n?: int} ['o' => 'vote', 's', 'id', 'n'] | bad | denied
     */
    public static function normalizeVote(Principal $p, mixed $op): array {
        if (!self::isVote($op)) {
            return self::BAD;
        }
        $s = Input::whole($op['s'] ?? null);
        $n = Input::whole($op['n'] ?? null);
        $id = $op['id'] ?? null;
        if ($s === null || $s < 1 || $n === null || $n < 0 || $n > Limits::VOTE_PER_MAX
            || !is_string($id) || preg_match(self::ULID_RE, $id) !== 1) {
            return self::BAD;
        }
        if (!$p->role->canVote()) {
            return self::DENIED;
        }
        return ['o' => 'vote', 's' => $s, 'id' => $id, 'n' => $n];
    }

    /**
     * Does any patch of the raw batch set a text path (§4.10.2)? Then the
     * lease check needs the presence map even when the request carried no `me`.
     */
    public static function touchesTextPath(array $ops): bool {
        $paths = ItemRegistry::allTextPaths();
        foreach ($ops as $op) {
            if (!is_array($op) || ($op['o'] ?? null) !== 'patch' || !is_array($op['p'] ?? null)) {
                continue;
            }
            foreach ($paths as $path) {
                if (array_key_exists($path, $op['p'])) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * put payload → full item with defaults (missing numbers 0, data/style {},
     * parent null, group null), typed check by the registry. z is mandatory;
     * group is null (or missing) or a ULID (isGroupId); lock must be absent
     * or null and never enters the item.
     */
    public static function cleanPut(string $t, mixed $p, bool $fourByte = true): ?array {
        if (!PathOps::isMap($p)) {
            return null;
        }
        // A lock is never set by a put (only through the patch path `lock`,
        // lockOp): any value but null is `bad` ("", {}, false and 0 too); null
        // or a missing key sets nothing (a new or revived item is unlocked).
        // A group is null (or missing) or a ULID, any other value is `bad`.
        $group = $p['group'] ?? null;
        if (($p['lock'] ?? null) !== null || !self::isGroupId($group)) {
            return null;
        }
        $item = ['t' => $t, 'x' => 0.0, 'y' => 0.0, 'w' => 0.0, 'h' => 0.0, 'r' => 0.0, 'z' => '', 'parent' => null, 'data' => [], 'style' => [],
            'group' => $group];
        foreach (self::NUMBERS as $k) {
            if (array_key_exists($k, $p)) {
                $n = self::cleanNumber($k, $p[$k]);
                if ($n === null) {
                    return null;
                }
                $item[$k] = $n;
            }
        }
        if (!is_string($p['z'] ?? null) || !ZOrder::isValid($p['z'])) {
            return null;
        }
        $item['z'] = $p['z'];
        if (array_key_exists('parent', $p)) {
            if ($p['parent'] !== null && (!is_string($p['parent']) || preg_match(self::ULID_RE, $p['parent']) !== 1)) {
                return null;
            }
            $item['parent'] = $p['parent'];
        }
        foreach (PathOps::CONTAINERS as $root) {
            $m = $p[$root] ?? null;
            if ($m === null) {
                continue;
            }
            if (!PathOps::isMap($m) || count($m) > PathOps::MAX_KEYS) {
                return null;
            }
            $out = [];
            foreach ($m as $k => $v) {
                if (!is_string($k) || preg_match(PathOps::KEY_RE, $k) !== 1) {
                    return null;
                }
                [$ok, $v] = self::cleanValue($v, $fourByte);
                if (!$ok) {
                    return null;
                }
                [$present, $c] = PathOps::clean($v);
                if ($present) {
                    $out[$k] = $c;
                }
            }
            $item[$root] = $out;
        }
        return ItemRegistry::checkItem($item);
    }

    /**
     * patch payload → [path => value] with generic checks, or null (`bad`).
     *
     * @return array<string, mixed>|null
     */
    public static function cleanPatch(mixed $p, bool $fourByte = true): ?array {
        if (!PathOps::isMap($p) || $p === [] || count($p) > Limits::MAX_PATCH_PATHS) {
            return null;
        }
        $out = [];
        foreach ($p as $path => $v) {
            $path = (string)$path;
            if (in_array($path, self::NUMBERS, true)) {
                $n = self::cleanNumber($path, $v);
                if ($n === null) {
                    return null;
                }
                $out[$path] = $n;
            } elseif ($path === 'z') {
                if (!is_string($v) || !ZOrder::isValid($v)) {
                    return null;
                }
                $out[$path] = $v;
            } elseif ($path === 'parent') {
                if ($v !== null && (!is_string($v) || preg_match(self::ULID_RE, $v) !== 1)) {
                    return null;
                }
                $out[$path] = $v;
            } elseif ($path === 'group') {
                // an id like parent, never a data map: {} and [] are bad too
                if (!self::isGroupId($v)) {
                    return null;
                }
                $out[$path] = $v;
            } else {
                if (!self::validPath($path)) {
                    return null;
                }
                [$ok, $v] = self::cleanValue($v, $fourByte);
                if (!$ok) {
                    return null;
                }
                $out[$path] = $v;
            }
        }
        $placement = count(array_intersect(self::PLACEMENT, array_keys($out)));
        if ($placement !== 0 && $placement !== count(self::PLACEMENT)) {
            return null;
        }
        return $out;
    }

    /**
     * A group value of a put or patch (M2, R20 Gruppieren): null (no group)
     * or a string that matches ULID_RE. Every other value is `bad`.
     */
    public static function isGroupId(mixed $v): bool {
        return $v === null || (is_string($v) && preg_match(self::ULID_RE, $v) === 1);
    }

    /** data.<k>[.<k>…] or style.<k>[.<k>…], 1–4 keys matching KEY_RE. */
    public static function validPath(string $path): bool {
        $keys = explode('.', $path);
        $root = array_shift($keys);
        if (!in_array($root, PathOps::CONTAINERS, true) || $keys === [] || count($keys) > 4) {
            return false;
        }
        foreach ($keys as $k) {
            if (preg_match(PathOps::KEY_RE, $k) !== 1) {
                return false;
            }
        }
        return true;
    }

    /**
     * x/y: |v| ≤ 1e7; w/h: 0 ≤ v ≤ 1e7; r: −360 … 360. Only JSON numbers
     * (no numeric strings, no bool), finite. Stored as float.
     */
    public static function cleanNumber(string $k, mixed $v): ?float {
        if (!is_int($v) && !is_float($v)) {
            return null;
        }
        $f = (float)$v;
        if (!is_finite($f) || abs($f) > Limits::NUM_ABS_MAX) {
            return null;
        }
        if (($k === 'w' || $k === 'h') && $f < 0) {
            return null;
        }
        if ($k === 'r' && ($f < -360 || $f > 360)) {
            return null;
        }
        return $f;
    }

    /**
     * Generic value check: value rules (PathOps::isWireValue) and every string
     * inside cleaned (Input::text, ≤ MAX_STRING; without $fourByte also
     * Input::bmp).
     *
     * @return array{0: bool, 1: mixed} [ok, cleaned value]; ok false = `bad`
     */
    public static function cleanValue(mixed $v, bool $fourByte = true): array {
        if (!PathOps::isWireValue($v)) {
            return [false, null];
        }
        return self::cleanStrings($v, $fourByte);
    }

    /** @return array{0: bool, 1: mixed} */
    private static function cleanStrings(mixed $v, bool $fourByte): array {
        if (is_string($v)) {
            $s = Input::text($v, Limits::MAX_STRING);
            if ($s !== null && !$fourByte) {
                $s = Input::bmp($s);
            }
            return [$s !== null, $s];
        }
        if (!is_array($v)) {
            return [true, $v];
        }
        foreach ($v as $k => $e) {
            [$ok, $c] = self::cleanStrings($e, $fourByte);
            if (!$ok) {
                return [false, null];
            }
            $v[$k] = $c;
        }
        return [true, $v];
    }
}
