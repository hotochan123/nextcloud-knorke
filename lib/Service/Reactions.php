<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Emoji reactions of sticky notes (factory job 172), pure and static; the
 * client mirror is src/model/reactions.js, tests/fixtures/reactions-golden.json
 * pins both.
 *
 * A note keeps its reactions in data.react: a map from the key p<pid> (the
 * per-board participant id, 16 hex characters) to {"e": <emoji>, "n":
 * <name>}. e is the emoji as its code points in hex, lower case, without
 * leading zeros, joined by '-' (👍 1f44d, ❤️ 2764-fe0f): ASCII only, so it
 * survives a database without 4-byte UTF-8 unchanged. n is the display name
 * when reacting (a guest's guest name), built like locked_name:
 * Input::displayName(…, 64), plus Input::bmp without 4-byte text.
 *
 * The op (OpValidator, before the lock): a patch whose ONLY path is
 * data.react.<key> (opKey). It needs the role owner, edit or vote, the key
 * must be the principal's own (both `denied` otherwise); its value is null,
 * {} or [] (take it back) or an object with a valid e (isEmoji; anything
 * else is `bad`). Only e is read: the server writes n itself. Every other
 * patch that touches data.react or a path below it is `bad` (touches).
 * SyncService applies it under the lock (`gone`, `bad` for another type than
 * sticky, `limit`, else like a patch; locks and text leases do not stop it).
 *
 * A put without revive drops data.react; a put with revive keeps, for a
 * sticky note, the valid entries (key p + 16 hex, a valid e, n a string,
 * cut like a written name) and drops the rest; for every other type all
 * (filterPut).
 */
final class Reactions {
    /** data key of the reactions. */
    public const FIELD = 'react';
    /** Prefix of a reaction path. */
    public const PREFIX = 'data.react.';
    /** Key of one person's reaction: p + their pid. */
    public const KEY_RE = '/^p[0-9a-f]{16}\z/';
    /** Most characters of a stored name (like locked_name). */
    public const NAME_MAX = 64;
    /** Most code points of one emoji. */
    public const MAX_POINTS = 10;

    private const HEX_RE = '/^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6}){0,9}\z/';
    /** Keycap bases: #, * and 0–9. */
    private const KEYCAP = [0x23, 0x2A, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39];
    /** Single code points of the allowed set. */
    private const SINGLE = [0xA9, 0xAE, 0x200D, 0x203C, 0x2049, 0x20E3, 0x3030, 0x303D, 0x3297, 0x3299, 0xFE0F];
    /** Ranges of the allowed set (inclusive). */
    private const RANGES = [[0x2100, 0x2BFF], [0x1F000, 0x1FAFF], [0xE0020, 0xE007F]];

    /**
     * A valid emoji in hex form: 1–10 code points of the allowed set; #, *
     * and 0–9 only as the first code point of a keycap ending with 20e3.
     */
    public static function isEmoji(mixed $e): bool {
        if (!is_string($e) || preg_match(self::HEX_RE, $e) !== 1) {
            return false;
        }
        $parts = explode('-', $e);
        $count = count($parts);
        if ($count > self::MAX_POINTS) {
            return false;
        }
        foreach ($parts as $i => $h) {
            if ($h[0] === '0') {
                return false;
            }
            $cp = (int)hexdec($h);
            if (in_array($cp, self::KEYCAP, true)) {
                if ($i !== 0 || $count < 2 || $parts[$count - 1] !== '20e3') {
                    return false;
                }
                continue;
            }
            if (!self::allowed($cp)) {
                return false;
            }
        }
        return true;
    }

    private static function allowed(int $cp): bool {
        if (in_array($cp, self::SINGLE, true)) {
            return true;
        }
        foreach (self::RANGES as [$a, $b]) {
            if ($cp >= $a && $cp <= $b) {
                return true;
            }
        }
        return false;
    }

    /** The reaction key of a pid: p + pid. */
    public static function keyOf(string $pid): string {
        return 'p' . $pid;
    }

    /**
     * The key of a reaction op: the patch payload has exactly one path and it
     * is data.react.<key> with one key level (no further dot). null for every
     * other payload.
     */
    public static function opKey(mixed $p): ?string {
        if (!PathOps::isMap($p) || count($p) !== 1) {
            return null;
        }
        $path = (string)array_key_first($p);
        if (!str_starts_with($path, self::PREFIX)) {
            return null;
        }
        $key = substr($path, strlen(self::PREFIX));
        return $key === '' || str_contains($key, '.') ? null : $key;
    }

    /** Does a patch path touch the reactions (data.react or a path below it)? */
    public static function touches(string $path): bool {
        return $path === 'data.' . self::FIELD || str_starts_with($path, self::PREFIX);
    }

    /** The stored name of a reaction: Input::displayName(…, 64), without 4-byte text also Input::bmp. */
    public static function name(mixed $displayName, bool $fourByte): string {
        $name = Input::displayName($displayName, self::NAME_MAX);
        return $fourByte ? $name : Input::bmp($name);
    }

    /**
     * The reactions a put keeps (see the class comment). $item is the item
     * of OpValidator::cleanPut (data already a cleaned map).
     *
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    public static function filterPut(array $item, bool $revive, bool $fourByte): array {
        $data = $item['data'] ?? [];
        if (!is_array($data) || !array_key_exists(self::FIELD, $data)) {
            return $item;
        }
        $kept = [];
        $map = $data[self::FIELD];
        if ($revive && ($item['t'] ?? null) === 'sticky' && PathOps::isMap($map)) {
            foreach ($map as $key => $v) {
                if (is_string($key) && preg_match(self::KEY_RE, $key) === 1 && PathOps::isMap($v)
                    && self::isEmoji($v['e'] ?? null) && is_string($v['n'] ?? null)) {
                    $kept[$key] = ['e' => $v['e'], 'n' => self::name($v['n'], $fourByte)];
                }
            }
        }
        if ($kept === []) {
            unset($data[self::FIELD]);
        } else {
            $data[self::FIELD] = $kept;
        }
        $item['data'] = $data;
        return $item;
    }
}
