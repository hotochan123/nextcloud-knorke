<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IMemcacheTTL;

/**
 * Presence of everybody on a board as ONE JSON blob in Redis (SPEC-M0 §5.1,
 * §5.5, §4.11): p:<board> = {"<pid>:<client>": entry, …}. The public cache
 * API has no hashes, so the blob is updated with a get/modify/cas loop. The
 * cache prefix carries the board epoch like FastCache (SPEC-M1 §5.1): after
 * occ knorke:epoch:rotate presence starts empty.
 *
 * Stored entry: {n, k (pid), g (1 = guest), x, y, s, d, e, v, l, t (ms), es
 * (lease rank, ms)}. v (stage 3, SPEC-M1 §5.5) is the sender's viewport
 * [x, y, w, h] in world coordinates, each rounded with q(…, 10), or null.
 * l (job 171) is the sender's laser trail or null (entry(), laser()). The key carries the server-computed pid, so nobody can write
 * somebody else's cursor. Entries older than 10 s are dropped on every write
 * and read. cas() drops the key's TTL (plain SET in Nextcloud's Lua), so the
 * TTL of 60 s is renewed after EVERY successful cas — otherwise the last
 * writer would leave a blob without TTL behind (a leak per board and prefix).
 *
 * Text lease (§4.11): `e` is the item an entry is editing. When `e` changes
 * the server sets es = now; while it stays, es stays; `tk` (take over) sets
 * es = min(es of the other fresh entries with the same e) − 1. The holder of
 * an item is the fresh entry with that `e` and the smallest es (tie: the
 * smaller key).
 *
 * Cells (job 173): `ec` = "<col>.<row>" (Tables::CELL_RE) names the cell of
 * the table `e` an entry is editing; null without a valid e, for a role that
 * may not edit and for any other form (and for notes: there nothing
 * changes). The lease key is (e, ec): es starts anew when e or ec changes, a
 * change of ec is never throttled, tk, the holder rule and the cap act per
 * key, and h of public() is per (e, ec). The stored entry and public() carry
 * ec only when it is set. (Job 195) ec may also be a node key "n<8>"
 * (Mindmaps::NODE_RE): the node of the mind map e; the same rules.
 *
 * Cap (P7, SPEC-M1 §33.1 f): every stored entry carries the internal rank
 * `rk` (0 = not an editor, i.e. role vote; 1 = editor; 2 = canModerate(),
 * owner and "may moderate"; an entry without rk counts as 1). public() never
 * sends it. After every write: (1) at most PRESENCE_PER_PID entries per pid,
 * (2) at most MAX_VOTE_ENTRIES entries with rk 0 (the oldest go), (3) at
 * most MAX_ENTRIES entries overall. Steps 1 and 3 evict by class, first
 * evicted first: rk 0; rk 1 without e and v; rk 1 without e, with v; rk 1
 * with e but not the holder of its item; rk 1 holding its item's lease;
 * rk 2 (the key of meta.summon is always one: only moderators start "Bring
 * everyone here", route 25). Within a class the oldest goes first (t, then
 * key). The key of the writing request is never evicted.
 *
 * Size limits (job 246, SPEC-M1 §5.5, §8): entry() cuts an entry whose JSON
 * exceeds Limits::PRESENCE_ENTRY_BYTES (fit(): first the oldest laser
 * points, then d from the end, then s from the end). cap() also keeps at
 * most MAX_GUEST_ENTRIES entries with g = 1 and the whole blob within
 * Limits::PRESENCE_BLOB_BYTES. Every eviction by class puts guests before
 * accounts: rk 0 (guests, then accounts); guests of classes 2–4; accounts
 * of classes 2–4; lease holders (class 5, guest or account as before); rk 2.
 * The byte step takes every guest entry before any account entry.
 */
class PresenceStore {
    public const TTL = 60;
    /** At most one write per key every 250 ms (except when e changes or tk is set). */
    public const MIN_GAP_MS = 250;
    public const MAX_ENTRIES = 200;
    /** Entries with rk 0 (not editors: the voting link) at most (§33.1 f; a constant, no app config). */
    public const MAX_VOTE_ENTRIES = 50;
    /** Entries of guests (g = 1) at most (job 246: half of MAX_ENTRIES). */
    public const MAX_GUEST_ENTRIES = 100;
    /** `rk` of an entry (§33.1 f). */
    public const RANK_VOTE = 0;
    public const RANK_EDIT = 1;
    public const RANK_MODERATE = 2;
    private const CAS_TRIES = 6;
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE;

    /** @var IMemcacheTTL|null null = presence off (no Redis) */
    private ?ICache $cache = null;
    private Epoch $epoch;

    /** The prefix line is the literal form of SPEC-M1 §5.1 (see FastCache). */
    public function __construct(ICacheFactory $cacheFactory, Epoch $epochService) {
        $this->epoch = $epochService;
        $epoch = $this->epoch->current();
        $this->cache = $cacheFactory->createDistributed('knorke/' . $epoch . '/');
        if (!$this->cache instanceof IMemcacheTTL || !$cacheFactory->isAvailable()) {
            $this->cache = null;
        }
    }

    public function available(): bool {
        return $this->cache !== null;
    }

    /**
     * Stores one entry (from entry()) under $key = "<pid>:<client>".
     *
     * @return array{0: string, 1: ?array} [ok|retry|skip|lost|off, the map as
     *   written (skip: as found); null for lost/off]
     */
    public function write(int $b, string $key, array $entry, int $nowMs): array {
        if ($this->cache === null) {
            return ['off', null];
        }
        $ck = 'p:' . $b;
        for ($i = 0; $i < self::CAS_TRIES; $i++) {
            $raw = $this->cache->get($ck);
            if ($raw !== null && !is_string($raw)) {
                // Not ours (or corrupt): start over with an empty blob.
                $this->cache->remove($ck);
                continue;
            }
            $map = self::prune(self::decode($raw), $nowMs);
            $prev = $map[$key] ?? null;
            $e = $entry['e'] ?? null;
            $ec = $entry['ec'] ?? null;
            $tk = ($entry['tk'] ?? 0) === 1 && $e !== null;
            if ($prev !== null && $nowMs - $prev['t'] < self::MIN_GAP_MS && ($prev['e'] ?? null) === $e && ($prev['ec'] ?? null) === $ec && !$tk) {
                return ['skip', $map];
            }
            unset($entry['tk']);
            $entry['t'] = $nowMs;
            $entry['es'] = self::leaseRank($map, $key, $prev, $e, $tk, $nowMs, $ec);
            $map[$key] = $entry;
            $map = self::cap($map, $key, (string)($entry['k'] ?? ''), $nowMs);
            $new = json_encode($map, self::JSON_FLAGS);
            if ($new === false) {
                return ['lost', null];
            }
            if ($raw === null) {
                $done = $this->cache->add($ck, $new, self::TTL);
            } else {
                $done = $this->cache->cas($ck, $raw, $new);
                if ($done) {
                    $this->cache->setTTL($ck, self::TTL);
                }
            }
            if ($done) {
                return [$i === 0 ? 'ok' : 'retry', $map];
            }
        }
        return ['lost', null];
    }

    /** The fresh entries of a board ([] when off or empty). */
    public function read(int $b, int $nowMs): array {
        if ($this->cache === null) {
            return [];
        }
        $raw = $this->cache->get('p:' . $b);
        return self::prune(self::decode(is_string($raw) ? $raw : null), $nowMs);
    }

    /**
     * The stored entry of a principal from the client's `me` (§4.5, §5.5).
     * Malformed parts are dropped, never an error: presence is best effort.
     *
     * Rights rule (SPEC-M1 §5.5, §4.9): only a role that may edit keeps a
     * selection `s`, drag previews `d` and the text lease (`e`, `tk`). For
     * any other role (vote; view never gets here, sync() ignores its `me`)
     * `s` and `d` are [], `e` is null and `tk` 0, always: a holder of the
     * widely shared voting link can neither lock an editor's text nor send
     * drag previews of arbitrary items (which would also keep every editor
     * on the fast tick). Only the cursor `c` and the viewport `v` stay.
     *
     * `v` (SPEC-M1 §4.5, §5.5): exactly four finite numbers [x, y, w, h],
     * |x|, |y| ≤ NUM_ABS_MAX and 0 < w, h ≤ NUM_ABS_MAX, each stored as
     * q(…, 10) (Connectors::q, never -0); anything else drops `v` alone
     * (null), never the rest of the entry. A presenter outside mode edit
     * sends {v} only (§6.4): its entry then has no cursor (x = y = null).
     *
     * `l` (job 171, the laser trail): only a role that may edit keeps it, and
     * only a valid one (laser()); anything else is null, the rest of the
     * entry stays.
     */
    public static function entry(Principal $p, array $me, int $nowMs): array {
        $edit = $p->role->canEdit();
        $x = $y = null;
        $c = $me['c'] ?? null;
        if (is_array($c) && array_is_list($c) && count($c) === 2) {
            $cx = self::coord($c[0]);
            $cy = self::coord($c[1]);
            if ($cx !== null && $cy !== null) {
                [$x, $y] = [$cx, $cy];
            }
        }
        $s = [];
        foreach ($edit && is_array($me['s'] ?? null) ? $me['s'] : [] as $id) {
            if (count($s) >= Limits::PRESENCE_IDS) {
                break;
            }
            if (is_string($id) && preg_match(OpValidator::ULID_RE, $id) === 1 && !in_array($id, $s, true)) {
                $s[] = $id;
            }
        }
        $d = [];
        foreach ($edit && is_array($me['d'] ?? null) ? $me['d'] : [] as $row) {
            if (count($d) >= Limits::PRESENCE_IDS) {
                break;
            }
            if (!is_array($row) || !array_is_list($row) || count($row) !== 3
                || !is_string($row[0]) || preg_match(OpValidator::ULID_RE, $row[0]) !== 1) {
                continue;
            }
            $dx = self::coord($row[1]);
            $dy = self::coord($row[2]);
            if ($dx !== null && $dy !== null) {
                $d[] = [$row[0], $dx, $dy];
            }
        }
        $e = $me['e'] ?? null;
        $e = $edit && is_string($e) && preg_match(OpValidator::ULID_RE, $e) === 1 ? $e : null;
        $tk = $me['tk'] ?? 0;
        $entry = [
            'n' => $p->displayName, 'k' => $p->pid, 'g' => $p->isGuest ? 1 : 0,
            'x' => $x, 'y' => $y, 's' => $s, 'd' => $d, 'e' => $e,
            'tk' => $e !== null && ($tk === 1 || $tk === true) ? 1 : 0,
            'v' => self::view($me['v'] ?? null),
            'l' => $edit ? self::laser($me['l'] ?? null) : null,
            't' => $nowMs,
            'rk' => $p->canModerate() ? self::RANK_MODERATE : ($edit ? self::RANK_EDIT : self::RANK_VOTE),
        ];
        // job 173: the cell of the table e (only with e, so only for editors); job 195: or the node of a mind map
        $ec = $me['ec'] ?? null;
        if ($e !== null && self::isSubKey($ec)) {
            $entry['ec'] = $ec;
        }
        return self::fit($entry);
    }

    /**
     * (Job 246) An entry within Limits::PRESENCE_ENTRY_BYTES: while its JSON
     * is longer, drop the oldest element of l (a stroke break left in front
     * goes with it; an empty trail is null), then the last row of d, then the
     * last id of s. Name, cursor, e/tk/ec, v and rk always stay; without l, d
     * and s an entry is far below the limit. An entry that fits is unchanged.
     */
    private static function fit(array $entry): array {
        $size = static fn (array $e): int => strlen((string)json_encode($e, self::JSON_FLAGS));
        if ($size($entry) <= Limits::PRESENCE_ENTRY_BYTES) {
            return $entry;
        }
        while (is_array($entry['l']) && $size($entry) > Limits::PRESENCE_ENTRY_BYTES) {
            $l = array_slice($entry['l'], 1);
            while ($l !== [] && $l[0] === null) {
                $l = array_slice($l, 1);
            }
            $entry['l'] = $l === [] ? null : $l;
        }
        while ($entry['d'] !== [] && $size($entry) > Limits::PRESENCE_ENTRY_BYTES) {
            array_pop($entry['d']);
        }
        while ($entry['s'] !== [] && $size($entry) > Limits::PRESENCE_ENTRY_BYTES) {
            array_pop($entry['s']);
        }
        return $entry;
    }

    /**
     * What the others see (§4.5): every fresh entry except $selfKey, without
     * t/es, with h = 1 when the entry holds the lease of its e and v (the
     * viewport, SPEC-M1 §5.5; null when the entry has none). Always an
     * array; the caller encodes it as a JSON object (also when empty).
     * (Job 171) An entry with a laser trail also carries `l`, as the last key
     * after v, every d raised by the entry's age (nowMs − t), so it counts
     * from this answer; without one the ten fields stay as they were.
     * (Job 173) An entry that names a cell carries `ec` after v, before l.
     *
     * @return array<string, array>
     */
    public static function public(array $map, string $selfKey, int $nowMs): array {
        $map = self::prune($map, $nowMs);
        $out = [];
        foreach ($map as $k => $e) {
            $k = (string)$k;
            if ($k === $selfKey) {
                continue;
            }
            $item = $e['e'] ?? null;
            $cell = self::cellOf($e);
            $out[$k] = [
                'n' => $e['n'] ?? '', 'k' => $e['k'] ?? '', 'g' => ($e['g'] ?? 0) === 1 ? 1 : 0,
                'x' => $e['x'] ?? null, 'y' => $e['y'] ?? null,
                's' => is_array($e['s'] ?? null) ? $e['s'] : [], 'd' => is_array($e['d'] ?? null) ? $e['d'] : [],
                'e' => $item,
                'h' => is_string($item) && self::holderKey($map, $item, $nowMs, $cell) === $k ? 1 : 0,
                'v' => self::view($e['v'] ?? null),
            ];
            if (is_string($item) && $cell !== null) {
                // job 173: the cell, only when set (before l, which stays the last key)
                $out[$k]['ec'] = $cell;
            }
            $l = self::laser($e['l'] ?? null);
            if ($l !== null) {
                // fresh() keeps only entries with an integer t
                $age = max(0, $nowMs - $e['t']);
                $out[$k]['l'] = array_map(static fn (?array $pt): ?array => $pt === null ? null : [$pt[0], $pt[1], $pt[2] + $age], $l);
            }
        }
        return $out;
    }

    /**
     * pid of the lease holder of $itemId, or null (no map, nobody editing it);
     * (job 173) with $cell the holder of that cell of the table $itemId.
     */
    public static function leaseHolder(?array $map, string $itemId, int $nowMs, ?string $cell = null): ?string {
        if ($map === null) {
            return null;
        }
        $key = self::holderKey($map, $itemId, $nowMs, $cell);
        if ($key === null) {
            return null;
        }
        $pid = $map[$key]['k'] ?? null;
        return is_string($pid) ? $pid : null;
    }

    /** Key of the fresh entry with e == $itemId (and ec == $cell, job 173) and the smallest es (tie: smaller key). */
    private static function holderKey(array $map, string $itemId, int $nowMs, ?string $cell = null): ?string {
        $best = null;
        $bestEs = null;
        foreach ($map as $k => $e) {
            $k = (string)$k;
            if (!self::fresh($e, $nowMs) || ($e['e'] ?? null) !== $itemId || self::cellOf($e) !== $cell) {
                continue;
            }
            $es = is_int($e['es'] ?? null) ? $e['es'] : PHP_INT_MAX;
            if ($best === null || $es < $bestEs || ($es === $bestEs && strcmp($k, $best) < 0)) {
                $best = $k;
                $bestEs = $es;
            }
        }
        return $best;
    }

    private static function leaseRank(array $map, string $key, ?array $prev, ?string $e, bool $tk, int $nowMs, ?string $ec = null): ?int {
        if ($e === null) {
            return null;
        }
        // (job 173) per lease key (e, ec): another cell is another lease
        $kept = $prev !== null && ($prev['e'] ?? null) === $e && self::cellOf($prev) === $ec && is_int($prev['es'] ?? null) ? $prev['es'] : null;
        if ($tk) {
            $min = null;
            foreach ($map as $k => $other) {
                if ((string)$k === $key || ($other['e'] ?? null) !== $e || self::cellOf($other) !== $ec || !is_int($other['es'] ?? null)) {
                    continue;
                }
                $min = $min === null ? $other['es'] : min($min, $other['es']);
            }
            if ($min !== null) {
                return $min - 1;
            }
        }
        return $kept ?? $nowMs;
    }

    /**
     * The cap after a write (§33.1 f): (1) at most PRESENCE_PER_PID entries
     * of $pid, (2) at most MAX_VOTE_ENTRIES entries with rk 0, (3, job 246)
     * at most MAX_GUEST_ENTRIES entries with g = 1, (4) at most MAX_ENTRIES
     * overall, (5, job 246) at most Limits::PRESENCE_BLOB_BYTES of JSON;
     * never $key. Steps 1, 3, 4 and 5 evict by class (evictionClass), step 2
     * the oldest.
     */
    private static function cap(array $map, string $key, string $pid, int $nowMs): array {
        $samePid = array_filter($map, static fn (array $e): bool => ($e['k'] ?? null) === $pid);
        $map = self::evict($map, array_keys($samePid), count($samePid) - Limits::PRESENCE_PER_PID, $key, $nowMs, true);
        $votes = array_filter($map, static fn (array $e): bool => self::rank($e) === self::RANK_VOTE);
        $map = self::evict($map, array_keys($votes), count($votes) - self::MAX_VOTE_ENTRIES, $key, $nowMs, false);
        $guests = array_filter($map, static fn (array $e): bool => self::isGuest($e));
        $map = self::evict($map, array_keys($guests), count($guests) - self::MAX_GUEST_ENTRIES, $key, $nowMs, true);
        $map = self::evict($map, array_keys($map), count($map) - self::MAX_ENTRIES, $key, $nowMs, true);
        return self::fitBlob($map, $key, $nowMs);
    }

    /**
     * (Job 246) Evicts until json_encode($map) fits
     * Limits::PRESENCE_BLOB_BYTES; never $keep. Every guest entry goes
     * before every account entry (each by class, then age): a guest who
     * invents its own e per key holds a "lease" of its own and would else
     * outlive the editors without one. The length is summed from
     * the encoded keys and entries ("{", "key":entry joined by ",", "}"),
     * exactly the length json_encode gives the map.
     */
    private static function fitBlob(array $map, string $keep, int $nowMs): array {
        $sizes = [];
        $total = 1;
        foreach ($map as $k => $e) {
            $k = (string)$k;
            $sizes[$k] = strlen((string)json_encode($k, self::JSON_FLAGS)) + 1 + strlen((string)json_encode($e, self::JSON_FLAGS));
            $total += $sizes[$k] + 1;
        }
        if ($total <= Limits::PRESENCE_BLOB_BYTES) {
            return $map;
        }
        foreach (self::evictionOrder($map, array_keys($map), $keep, $nowMs, true, true) as $k) {
            unset($map[$k]);
            $total -= $sizes[$k] + 1;
            if ($total <= Limits::PRESENCE_BLOB_BYTES) {
                break;
            }
        }
        return $map;
    }

    /**
     * Removes $n of $candidates (never $keep): by class first when $byClass
     * (evictionClass, lowest first), then the oldest (t, then key).
     *
     * @param list<int|string> $candidates
     */
    private static function evict(array $map, array $candidates, int $n, string $keep, int $nowMs, bool $byClass): array {
        if ($n <= 0) {
            return $map;
        }
        foreach (array_slice(self::evictionOrder($map, $candidates, $keep, $nowMs, $byClass), 0, $n) as $k) {
            unset($map[$k]);
        }
        return $map;
    }

    /**
     * $candidates without $keep, the first to evict first: with $guestsFirst
     * every guest before every account (job 246, the byte step), then by
     * class when $byClass (evictionClass, lowest first), then the oldest (t,
     * then key).
     *
     * @param list<int|string> $candidates
     * @return list<string>
     */
    private static function evictionOrder(array $map, array $candidates, string $keep, int $nowMs, bool $byClass, bool $guestsFirst = false): array {
        $candidates = array_values(array_filter(array_map('strval', $candidates), static fn (string $k): bool => $k !== $keep));
        $holders = $byClass ? self::holderKeys($map, $nowMs) : [];
        $order = [];
        foreach ($candidates as $k) {
            $order[$k] = [$guestsFirst && !self::isGuest($map[$k]) ? 1 : 0, $byClass ? self::evictionClass($map[$k], isset($holders[$k])) : 0, is_int($map[$k]['t'] ?? null) ? $map[$k]['t'] : 0, $k];
        }
        uasort($order, static fn (array $a, array $b): int => $a <=> $b);
        return array_map('strval', array_keys($order));
    }

    /**
     * Eviction class of an entry (§33.1 f; job 246: guests before accounts),
     * evicted first = 1: rk 0 → 1 (guest) or 2 (account); rk 1 without e and
     * v → 3 (guest) or 6 (account); without e, with v → 4 or 7; with e, not
     * holding its lease → 5 or 8; holding it → 9 (guest or account); rk 2 → 10.
     */
    private static function evictionClass(array $e, bool $holder): int {
        $rank = self::rank($e);
        if ($rank === self::RANK_VOTE) {
            return self::isGuest($e) ? 1 : 2;
        }
        if ($rank === self::RANK_MODERATE) {
            return 10;
        }
        if (is_string($e['e'] ?? null) && $holder) {
            return 9;
        }
        $class = !is_string($e['e'] ?? null) ? (($e['v'] ?? null) === null ? 0 : 1) : 2;
        return (self::isGuest($e) ? 3 : 6) + $class;
    }

    /** (Job 246) g of a stored entry: 1 = guest; an entry without it counts as an account. */
    private static function isGuest(array $e): bool {
        return ($e['g'] ?? 0) === 1;
    }

    /** rk of a stored entry; an entry without it (written before P7-C, at most 10 s old) counts as an editor. */
    private static function rank(array $e): int {
        $rk = $e['rk'] ?? self::RANK_EDIT;
        return in_array($rk, [self::RANK_VOTE, self::RANK_EDIT, self::RANK_MODERATE], true) ? $rk : self::RANK_EDIT;
    }

    /**
     * Keys of the lease holders in $map, one per item, in one pass: the rule
     * of holderKey (fresh, smallest es, tie: the smaller key).
     *
     * @return array<string, true>
     */
    private static function holderKeys(array $map, int $nowMs): array {
        $best = [];
        foreach ($map as $k => $e) {
            $k = (string)$k;
            if (!self::fresh($e, $nowMs) || !is_string($e['e'] ?? null)) {
                continue;
            }
            // (job 173) one holder per lease key (e, ec)
            $item = $e['e'] . '|' . (self::cellOf($e) ?? '');
            $es = is_int($e['es'] ?? null) ? $e['es'] : PHP_INT_MAX;
            if (!isset($best[$item]) || $es < $best[$item][0] || ($es === $best[$item][0] && strcmp($k, $best[$item][1]) < 0)) {
                $best[$item] = [$es, $k];
            }
        }
        $out = [];
        foreach ($best as [, $k]) {
            $out[$k] = true;
        }
        return $out;
    }

    /** (Job 173) The cell of a stored entry (ec; job 195: or a mind map's node), null when it has none or another form. */
    private static function cellOf(array $e): ?string {
        $ec = $e['ec'] ?? null;
        return self::isSubKey($ec) ? $ec : null;
    }

    /** (Job 195) A value of ec: a table's cell "<col>.<row>" or a mind map's node "n<8>". */
    private static function isSubKey(mixed $ec): bool {
        return is_string($ec) && (preg_match(Tables::CELL_RE, $ec) === 1 || preg_match(Mindmaps::NODE_RE, $ec) === 1);
    }

    private static function decode(?string $raw): array {
        if ($raw === null || $raw === '') {
            return [];
        }
        $map = json_decode($raw, true);
        return is_array($map) && !array_is_list($map) ? $map : [];
    }

    private static function prune(array $map, int $nowMs): array {
        foreach ($map as $k => $e) {
            if (!self::fresh($e, $nowMs)) {
                unset($map[$k]);
            }
        }
        return $map;
    }

    private static function fresh(mixed $e, int $nowMs): bool {
        return is_array($e) && is_int($e['t'] ?? null) && $nowMs - $e['t'] < Limits::LEASE_FRESH_MS;
    }

    /**
     * A viewport [x, y, w, h] (SPEC-M1 §4.5 me.v): four finite numbers,
     * |x|, |y| ≤ NUM_ABS_MAX, 0 < w, h ≤ NUM_ABS_MAX, rounded with q(…, 10)
     * (bit-identical to the client, never -0); a width or height that rounds
     * to 0 is refused too. Anything else → null.
     *
     * @return list<float>|null
     */
    public static function view(mixed $v): ?array {
        if (!is_array($v) || !array_is_list($v) || count($v) !== 4) {
            return null;
        }
        $out = [];
        foreach ($v as $i => $n) {
            if (!is_int($n) && !is_float($n)) {
                return null;
            }
            $f = (float)$n;
            if (!is_finite($f) || abs($f) > Limits::NUM_ABS_MAX) {
                return null;
            }
            $f = Connectors::q($f, 10);
            // w and h: > 0 after rounding (which also refuses 0 and negatives).
            if ($i >= 2 && $f <= 0.0) {
                return null;
            }
            $out[] = $f;
        }
        return $out;
    }

    /**
     * A laser trail `l` (job 171, me.l): a list of 1–PRESENCE_LASER elements,
     * each null (a break between two strokes: never first, never last, never
     * two in a row) or a point [x, y, d]: x and y finite with |x|, |y| ≤
     * NUM_ABS_MAX, stored like coord(); d an integer from 0 to
     * PRESENCE_LASER_AGE_MS (ms from the point to the building of `me`) that
     * never rises along the list (the oldest point first). Anything else → null.
     *
     * @return list<list<float|int>|null>|null
     */
    public static function laser(mixed $l): ?array {
        if (!is_array($l) || !array_is_list($l) || $l === [] || count($l) > Limits::PRESENCE_LASER) {
            return null;
        }
        $out = [];
        $prevD = null;
        $last = count($l) - 1;
        foreach ($l as $i => $pt) {
            if ($pt === null) {
                if ($i === 0 || $i === $last || $out[$i - 1] === null) {
                    return null;
                }
                $out[] = null;
                continue;
            }
            if (!is_array($pt) || !array_is_list($pt) || count($pt) !== 3) {
                return null;
            }
            $x = self::coord($pt[0]);
            $y = self::coord($pt[1]);
            $d = $pt[2];
            if ($x === null || $y === null || !is_int($d) || $d < 0 || $d > Limits::PRESENCE_LASER_AGE_MS
                || ($prevD !== null && $d > $prevD)) {
                return null;
            }
            $prevD = $d;
            $out[] = [$x, $y, $d];
        }
        return $out;
    }

    private static function coord(mixed $v): ?float {
        if (!is_int($v) && !is_float($v)) {
            return null;
        }
        $f = (float)$v;
        return is_finite($f) && abs($f) <= Limits::NUM_ABS_MAX ? round($f, 1) : null;
    }
}
