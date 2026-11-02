<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * The Markdown of notes, shapes, text items and table cells (factory job
 * 279), server side: only plain(), the text without its marks for the AI,
 * with the rules of src/model/richText.js plainText (both read the vectors
 * of tests/fixtures/rich-plain.json in their tests).
 *
 * Line by line: "- " and "N. " at the start (after at most 3 spaces) stay
 * as typed; **bold**, *italic*, ~~strike~~ and `code` lose their marks
 * (an opening mark needs a non-space after it, a closing one before it,
 * never across a line); a backslash before * ~ ` [ ] \ gives the
 * character; [text](address) with http, https or mailto becomes
 * "text (address)" (only the text when both are the same), a bare
 * http(s):// address stays. Works on bytes: every mark is ASCII, and no
 * byte of a multi-byte UTF-8 character is one.
 */
final class RichText {
    private const ESCAPABLE = '*~`[]\\';

    /** The text without its Markdown marks. */
    public static function plain(string $text): string {
        if (preg_match('/[*~`[\\\\]|https?:\/\/|^ {0,3}(?:-|\d{1,3}\.) /im', $text) !== 1) {
            return $text;
        }
        $lines = explode("\n", str_replace(["\r\n", "\r"], "\n", $text));
        $out = [];
        foreach ($lines as $line) {
            $prefix = '';
            if (preg_match('/^ {0,3}(?:(-)|(\d{1,3})\.) (.*)$/s', $line, $m) === 1) {
                $prefix = $m[1] === '-' ? '- ' : $m[2] . '. ';
                $line = $m[3];
            }
            $runs = [];
            $n = 0;
            self::inline($line, false, false, false, null, -1, $n, $runs);
            $s = $prefix;
            $count = count($runs);
            for ($k = 0; $k < $count; $k++) {
                $r = $runs[$k];
                $s .= $r['text'];
                if ($r['lk'] >= 0 && ($runs[$k + 1]['lk'] ?? -2) !== $r['lk']) {
                    $t = '';
                    for ($j = $k; $j >= 0 && $runs[$j]['lk'] === $r['lk']; $j--) {
                        $t = $runs[$j]['text'] . $t;
                    }
                    if ($t !== $r['href']) {
                        $s .= ' (' . $r['href'] . ')';
                    }
                }
            }
            $out[] = $s;
        }
        return implode("\n", $out);
    }

    private static function allowed(string $url): bool {
        return preg_match('/^(?:https?:\/\/|mailto:)/i', $url) === 1 && preg_match('/[\s<>"]/', $url) !== 1;
    }

    /**
     * @param list<array{text: string, lk: int, href: ?string}> $out
     */
    private static function inline(string $s, bool $b, bool $i, bool $st, ?string $href, int $lk, int &$n, array &$out): void {
        $push = static function (string $t, int $lk, ?string $href) use (&$out): void {
            if ($t === '') {
                return;
            }
            $last = count($out) - 1;
            if ($last >= 0 && $out[$last]['lk'] === $lk) {
                $out[$last]['text'] .= $t;
            } else {
                $out[] = ['text' => $t, 'lk' => $lk, 'href' => $href];
            }
        };
        $len = strlen($s);
        // per mark the first opening position from which no partner was found (closing)
        $memo = [];
        $k = 0;
        while ($k < $len) {
            $ch = $s[$k];
            if ($ch === '\\' && $k + 1 < $len && str_contains(self::ESCAPABLE, $s[$k + 1])) {
                $push($s[$k + 1], $lk, $href);
                $k += 2;
                continue;
            }
            if ($ch === '`') {
                $end = strpos($s, '`', $k + 1);
                if ($end !== false && $end > $k + 1) {
                    $push(substr($s, $k + 1, $end - $k - 1), $lk, $href);
                    $k = $end + 1;
                    continue;
                }
            }
            if ($ch === '[' && $href === null && preg_match('/^\[([^\]\n]+)\]\(([^()\s]+)\)/', substr($s, $k), $m) === 1 && self::allowed($m[2])) {
                $l = $n++;
                self::inline($m[1], $b, $i, $st, $m[2], $l, $n, $out);
                $k += strlen($m[0]);
                continue;
            }
            if (($ch === 'h' || $ch === 'H') && $href === null && !($k > 0 && preg_match('/[\p{L}\p{N}]$/u', substr($s, 0, $k)) === 1)
                && preg_match('/^https?:\/\/[^\s<>"]+/i', substr($s, $k), $m) === 1) {
                $url = rtrim($m[0], '.,;:!?)');
                if (preg_match('/^https?:\/\/[^\/]/i', $url) === 1) {
                    $push($url, $n, $url);
                    $n++;
                    $k += strlen($url);
                    continue;
                }
            }
            $two = substr($s, $k, 2);
            if (($two === '**' && !$b) || ($two === '~~' && !$st)) {
                $end = self::closing($s, $k + 2, $two, $memo);
                if ($end > 0) {
                    self::inline(substr($s, $k + 2, $end - $k - 2), $b || $two === '**', $i, $st || $two === '~~', $href, $lk, $n, $out);
                    $k = $end + 2;
                    continue;
                }
            }
            if ($ch === '*' && $two !== '**' && !$i) {
                $end = self::closing($s, $k + 1, '*', $memo);
                if ($end > 0) {
                    self::inline(substr($s, $k + 1, $end - $k - 1), $b, true, $st, $href, $lk, $n, $out);
                    $k = $end + 1;
                    continue;
                }
            }
            $push($ch, $lk, $href);
            $k++;
        }
    }

    private static function space(string $c): bool {
        return $c === ' ' || $c === "\t" || $c === "\n" || $c === "\r" || $c === "\f" || $c === "\v";
    }

    /**
     * The closing mark of an opening one that ends at $from (see richText.js
     * closing): linear per mark and line, a search without a partner is
     * remembered in $memo and every later opening of that mark gives up.
     *
     * @param array<string, int> $memo
     */
    private static function closing(string $s, int $from, string $mark, array &$memo): int {
        $len = strlen($s);
        if ($from >= $len || self::space($s[$from])) {
            return -1;
        }
        if ($from >= ($memo[$mark] ?? PHP_INT_MAX)) {
            return -1;
        }
        for ($j = $from + 1; $j < $len; $j++) {
            $c = $s[$j];
            if ($c === '\\') {
                $j++;
                continue;
            }
            if ($c === '`') {
                $end = strpos($s, '`', $j + 1);
                if ($end !== false && $end > $j + 1) {
                    $j = $end;
                    continue;
                }
            }
            if ($mark === '*') {
                if ($c === '*') {
                    if (($s[$j + 1] ?? '') === '*') {
                        // a ** inside: pass over its two stars
                        $j++;
                        continue;
                    }
                    if (!self::space($s[$j - 1])) {
                        return $j;
                    }
                }
            } elseif (substr($s, $j, strlen($mark)) === $mark && !self::space($s[$j - 1])) {
                while ($mark === '**' && ($s[$j + 2] ?? '') === '*') {
                    $j++;
                }
                return $j;
            }
        }
        $memo[$mark] = min($memo[$mark] ?? PHP_INT_MAX, $from);
        return -1;
    }
}
