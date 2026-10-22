<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Brings raw client values (body fields and the values inside them) into the
 * shape the caller expects — without a PHP warning and without a TypeError.
 * Port of Pulse's lib/Service/Input.php plus the Knorke text rules.
 *
 * Any field can arrive as a list or an object: `(string)` on it writes
 * "Array to string conversion" to the log, a typed parameter throws a
 * TypeError (500), and `(int)` on 1e100 warns. Rule: whatever does not fit
 * counts as not sent (null or $default); the caller decides whether that is a
 * default or a 400.
 */
final class Input {
    /**
     * Invisible and format characters a name must not hide behind (Pulse
     * TallyService::cleanText list): soft hyphen, Arabic letter mark, Hangul
     * fillers, Mongolian vowel separator, zero width space, LRM/RLM, bidi
     * embeddings and isolates, word joiner and friends, blank Braille pattern,
     * BOM, annotation characters, shorthand format controls and the unassigned
     * default-ignorable code points of the tag/selector plane.
     */
    private const INVISIBLE = '/[\x{00AD}\x{061C}\x{115F}\x{1160}\x{180E}\x{200B}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{2800}\x{3164}\x{FEFF}\x{FFA0}\x{FFF0}-\x{FFFB}\x{1BCA0}-\x{1BCA3}\x{E0000}-\x{E001F}\x{E0080}-\x{E00FF}\x{E01F0}-\x{E0FFF}]/u';

    /**
     * Scalar as text. Lists/objects, null, infinity/NAN and broken UTF-8
     * (PostgreSQL rejects it → 500) yield $default; NUL bytes are dropped.
     */
    public static function str(mixed $v, string $default = ''): string {
        return str_replace("\0", '', self::rawStr($v, $default));
    }

    /** Like str(), but NUL bytes are kept. */
    public static function rawStr(mixed $v, string $default = ''): string {
        if (!is_scalar($v) || (is_float($v) && !is_finite($v))) {
            return $default;
        }
        $s = (string)$v;
        return mb_check_encoding($s, 'UTF-8') ? $s : $default;
    }

    /**
     * Finite number from an int, a float or numeric text. INF/NAN (JSON
     * 1e999 decodes to INF), bool, lists and objects: null.
     */
    public static function number(mixed $v): int|float|null {
        if (is_string($v) && is_numeric($v)) {
            $v = $v + 0;
        }
        if (is_int($v)) {
            return $v;
        }
        return is_float($v) && is_finite($v) ? $v : null;
    }

    /**
     * A strict whole number of a JSON body (SPEC-M1 stage 3: vote ops,
     * routes 22–24): an int, or a finite float without fraction within
     * ±1e15 (JSON 2.0); text, bool, null, lists and fractions → null.
     */
    public static function whole(mixed $v): ?int {
        if (is_int($v)) {
            return $v;
        }
        if (is_float($v) && is_finite($v) && abs($v) <= 1e15 && floor($v) === $v) {
            return (int)$v;
        }
        return null;
    }

    /** Integer (decimals truncated) from a finite number within ±1e18, else null. */
    public static function int(mixed $v): ?int {
        $n = self::number($v);
        if (is_float($n)) {
            return $n > -1e18 && $n < 1e18 ? (int)$n : null;
        }
        return $n;
    }

    /**
     * Switch: bool, int and the words filter_var knows ("true", "off", "yes"
     * …; '' = false). Anything else (list, decimal, "maybe", 2) → null.
     */
    public static function flag(mixed $v): ?bool {
        if (is_bool($v)) {
            return $v;
        }
        if (!is_int($v) && !is_string($v)) {
            return null;
        }
        return filter_var($v, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    }

    /**
     * Raw client text cut to $max characters BEFORE the Unicode regexes run
     * over it (their cost grows with the input). Longer broken UTF-8 → ''.
     */
    public static function clip(string $s, int $max): string {
        if (strlen($s) <= $max) {
            return $s;
        }
        return mb_check_encoding($s, 'UTF-8') ? mb_substr($s, 0, $max, 'UTF-8') : '';
    }

    /**
     * A string value of an item (SPEC-M0 §4.8 generic string rule): valid
     * UTF-8, "\r\n" becomes "\n", NUL and every other C0 control character
     * except "\t" and "\n" is removed (so is a lone "\r"). Longer than $max
     * code points after cleaning → null (`bad`, never shortened). Not a
     * string → null.
     */
    public static function text(mixed $v, int $max): ?string {
        if (!is_string($v) || !mb_check_encoding($v, 'UTF-8')) {
            return null;
        }
        $v = str_replace("\r\n", "\n", $v);
        $v = preg_replace('/[\x00-\x08\x0B-\x1F]/', '', $v) ?? '';
        return mb_strlen($v, 'UTF-8') <= $max ? $v : null;
    }

    /**
     * Every code point above U+FFFF (emoji and the other supplementary
     * planes) replaced by U+FFFD (SPEC-M0 §4.8, review finding NC-3). For
     * databases without 4-byte UTF-8 — IDBConnection::supports4ByteText()
     * false: MySQL/MariaDB with mysql.utf8mb4 = false, utf8mb3 tables —
     * which would refuse the whole statement (SQLSTATE 22007, error 1366).
     * Valid UTF-8 in; the same number of code points out, so length limits
     * checked before still hold. Only 4-byte sequences start with F0–F4.
     */
    public static function bmp(string $s): string {
        if (preg_match('/[\xF0-\xF4]/', $s) !== 1) {
            return $s;
        }
        return preg_replace('/[\x{10000}-\x{10FFFF}]/u', "\u{FFFD}", $s) ?? '';
    }

    /**
     * Board title (SPEC-M0 §4.3): trimmed, at most $max characters, no
     * control characters. '' = empty (caller: 400 title_required); null =
     * unusable (not text, control characters or too long; caller: 400
     * bad_request).
     */
    public static function title(mixed $v, int $max): ?string {
        if ($v === null) {
            return '';
        }
        if (!is_string($v) || !mb_check_encoding($v, 'UTF-8')) {
            return null;
        }
        $v = preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $v) ?? '';
        if ($v === '') {
            return '';
        }
        if (preg_match('/\p{Cc}/u', $v) === 1 || mb_strlen($v, 'UTF-8') > $max) {
            return null;
        }
        return $v;
    }

    /**
     * Guest display name (SPEC-M0 §4.9.2 step 3, Pulse cleanText pattern):
     * NFC, line breaks and other white space become one space, control and
     * invisible characters are removed, white space is collapsed and trimmed,
     * then the name is cut to $max characters. '' = nothing usable.
     */
    public static function displayName(mixed $v, int $max = Limits::NAME_MAX): string {
        $s = self::clip(self::str($v), $max * 10);
        if ($s === '') {
            return '';
        }
        if (class_exists(\Normalizer::class)) {
            $s = \Normalizer::normalize($s, \Normalizer::FORM_C) ?: $s;
        }
        $s = preg_replace('/[\s\p{Z}]/u', ' ', $s) ?? '';
        $s = preg_replace('/\p{Cc}/u', '', $s) ?? '';
        $s = preg_replace(self::INVISIBLE, '', $s) ?? '';
        // Tag characters only survive inside a regional flag sequence.
        $s = preg_replace_callback(
            '/(\x{1F3F4}[\x{E0020}-\x{E007E}]+\x{E007F})|[\x{E0020}-\x{E007F}]/u',
            static fn (array $m): string => $m[1] ?? '',
            $s,
        ) ?? '';
        $s = trim(preg_replace('/ {2,}/', ' ', $s) ?? '');
        return trim(mb_substr($s, 0, $max, 'UTF-8'));
    }
}
