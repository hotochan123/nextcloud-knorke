<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Mind maps (factory job 195): the form of a mind map's data, checked on the
 * stored result of every put (revive too) and patch of a mind map under the
 * board lock (SyncService), and the nodes whose text a patch changes (the
 * lease per node). The client mirror is src/model/mindmap.js;
 * tests/fixtures/mindmap-golden.json pins both.
 *
 *   data.nodes  {"b<z>": {"n<8>": {o, p?, c?, s?, f?, d?, m?}}}, 1–500 nodes
 *   data.texts  {"b<z>": {"n<8>": text}}, optional; a text is a string of
 *               1–1000 code points after the cleaning of data.text, on a
 *               node that exists
 *
 * A node key is "n" plus 8 of [0-9a-z]; its pot is "b" plus its second
 * character. In a node: o a z key, p the key of another node (exactly one
 * node, the root, has none), c a colour #rrggbb in lower case, s one of
 * SHAPES, f true, d 'l', (job 196) m the free place [u, v] of a node with p:
 * two finite numbers of at most PLACE_MAX by amount. Every p chain ends at
 * the root (no cycle). No other
 * key at any level of data (style is the registry's). The check walks the
 * chains with a loop and a memo, never by recursion.
 */
final class Mindmaps {
    public const MAX_NODES = 500;
    public const TEXT_MAX = 1000;
    public const NODE_RE = '/^n[0-9a-z]{8}\z/';
    public const BUCKET_RE = '/^b[0-9a-z]\z/';
    public const SHAPES = ['line', 'rect', 'roundRect', 'pill'];
    private const COLOR_RE = '/^#[0-9a-f]{6}\z/';
    private const DATA_KEYS = ['nodes', 'texts'];
    public const PLACE_MAX = 20000;
    private const NODE_FIELDS = ['o', 'p', 'c', 's', 'f', 'd', 'm'];

    /** The pot of a node key: "b" plus its second character. */
    public static function bucketOf(string $key): string {
        return 'b' . substr($key, 1, 1);
    }

    /** Does the data of a mind map have the form above? */
    public static function check(mixed $data): bool {
        if (!PathOps::isMap($data)) {
            return false;
        }
        foreach (array_keys($data) as $k) {
            if (!in_array((string)$k, self::DATA_KEYS, true)) {
                return false;
            }
        }
        $nodes = self::nodes($data);
        if ($nodes === null || count($nodes) < 1 || count($nodes) > self::MAX_NODES) {
            return false;
        }
        $roots = 0;
        foreach ($nodes as $key => $n) {
            if (!array_key_exists('p', $n)) {
                $roots++;
            } elseif (!array_key_exists($n['p'], $nodes)) {
                return false;
            }
        }
        if ($roots !== 1) {
            return false;
        }
        // every chain reaches the root: walk up, remembering the keys known to reach it
        $ok = [];
        foreach (array_keys($nodes) as $key) {
            $path = [];
            $k = (string)$key;
            while (!isset($ok[$k])) {
                if (!array_key_exists('p', $nodes[$k])) {
                    break;
                }
                $path[] = $k;
                if (count($path) > count($nodes)) {
                    return false;
                }
                $k = $nodes[$k]['p'];
            }
            foreach ($path as $x) {
                $ok[$x] = true;
            }
            $ok[$k] = true;
        }
        if (!array_key_exists('texts', $data)) {
            return true;
        }
        $texts = $data['texts'];
        if (!PathOps::isMap($texts)) {
            return false;
        }
        foreach ($texts as $b => $pot) {
            if (preg_match(self::BUCKET_RE, (string)$b) !== 1 || !PathOps::isMap($pot) || $pot === []) {
                return false;
            }
            foreach ($pot as $key => $text) {
                $key = (string)$key;
                if (self::bucketOf($key) !== (string)$b || !array_key_exists($key, $nodes)) {
                    return false;
                }
                $s = Input::text($text, self::TEXT_MAX);
                if ($s === null || $s === '') {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * The nodes of data.nodes by key, null when a pot or a node breaks the form.
     *
     * @param array<string, mixed> $data data of a mind map
     * @return array<string, array<string, mixed>>|null
     */
    private static function nodes(array $data): ?array {
        $pots = $data['nodes'] ?? null;
        if (!PathOps::isMap($pots)) {
            return null;
        }
        $out = [];
        foreach ($pots as $b => $pot) {
            $b = (string)$b;
            if (preg_match(self::BUCKET_RE, $b) !== 1 || !PathOps::isMap($pot) || $pot === [] || count($pot) > 100) {
                return null;
            }
            foreach ($pot as $key => $n) {
                $key = (string)$key;
                if (preg_match(self::NODE_RE, $key) !== 1 || self::bucketOf($key) !== $b || !PathOps::isMap($n)) {
                    return null;
                }
                foreach (array_keys($n) as $f) {
                    if (!in_array((string)$f, self::NODE_FIELDS, true)) {
                        return null;
                    }
                }
                if (!is_string($n['o'] ?? null) || !ZOrder::isValid($n['o'])) {
                    return null;
                }
                if (array_key_exists('p', $n) && (!is_string($n['p']) || preg_match(self::NODE_RE, $n['p']) !== 1 || $n['p'] === $key)) {
                    return null;
                }
                if (array_key_exists('c', $n) && (!is_string($n['c']) || preg_match(self::COLOR_RE, $n['c']) !== 1)) {
                    return null;
                }
                if (array_key_exists('s', $n) && !in_array($n['s'], self::SHAPES, true)) {
                    return null;
                }
                if (array_key_exists('f', $n) && $n['f'] !== true) {
                    return null;
                }
                if (array_key_exists('d', $n) && $n['d'] !== 'l') {
                    return null;
                }
                if (array_key_exists('m', $n) && (!array_key_exists('p', $n) || !self::isPlace($n['m']))) {
                    return null;
                }
                $out[$key] = $n;
            }
        }
        return $out;
    }

    /** (Job 196) Is m a free place: a list of two finite numbers of at most PLACE_MAX by amount? */
    private static function isPlace(mixed $m): bool {
        if (!is_array($m) || !array_is_list($m) || count($m) !== 2) {
            return false;
        }
        foreach ($m as $v) {
            if (!(is_int($v) || is_float($v)) || !is_finite((float)$v) || abs($v) > self::PLACE_MAX) {
                return false;
            }
        }
        return true;
    }

    /**
     * The nodes whose text differs between two states of a mind map and
     * that exist afterwards (deleting a node with its text changes none):
     * what the lease per node guards.
     *
     * @param array<string, mixed> $before data before
     * @param array<string, mixed> $after data after
     * @return list<string> node keys
     */
    public static function changedTexts(array $before, array $after): array {
        $a = self::textMap($after);
        $b = self::textMap($before);
        $live = [];
        foreach (PathOps::isMap($after['nodes'] ?? null) ? $after['nodes'] : [] as $pot) {
            foreach (PathOps::isMap($pot) ? array_keys($pot) : [] as $key) {
                $live[(string)$key] = true;
            }
        }
        $out = [];
        foreach (array_unique(array_merge(array_keys($a), array_keys($b))) as $key) {
            $key = (string)$key;
            if (isset($live[$key]) && ($a[$key] ?? null) !== ($b[$key] ?? null)) {
                $out[] = $key;
            }
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $data data of a mind map
     * @return array<string, mixed> key → text of data.texts
     */
    private static function textMap(array $data): array {
        $out = [];
        foreach (PathOps::isMap($data['texts'] ?? null) ? $data['texts'] : [] as $pot) {
            foreach (PathOps::isMap($pot) ? $pot : [] as $key => $text) {
                $out[(string)$key] = $text;
            }
        }
        return $out;
    }
}
