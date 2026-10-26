<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Write budget per (board, pid) (SPEC-M1 §4.13.6, §5.1): two fixed-window
 * counters in the distributed cache, window = floor(now / 10000):
 *
 *   w:<board>:<pid>:<win>    requests WITH ops     (BUDGET_SYNCS, app config budget_syncs)
 *   wo:<board>:<pid>:<win>   ops + derived rows    (BUDGET_OPS, app config budget_ops)
 *
 * each add(key, 0, 25) + inc(key, n) (FastCache::windowInc: atomic, O(1),
 * 2–4 round trips). check() runs in sync() after the presence write and
 * before any op, only for a request that carries ops (an empty poll costs
 * nothing and creates no key); over either budget → retryMs, and sync()
 * answers `busy` for EVERY op of the request (never mixed, §4.5/§4.6),
 * applies nothing, acks.rev = null; reading, presence and `now` go on.
 * charge() adds the rows the server derived after applyOps (children
 * shifted by keep, released children, released connector ends) to wo: —
 * the NEXT request of that principal pays for them; the running one is
 * never refused afterwards.
 *
 * Without Redis (no distributed cache with TTL) there is no write budget
 * (docs/ADMIN.md, §5.6). Guests count per gid, accounts per pid (all tabs of an
 * account share one budget). No ILimiter here: it costs three round trips
 * with a JSON list of all time stamps and is not atomic (§4.13.6).
 *
 * Daily byte quota (P7, SPEC-M1 §33.1 b): two more fixed-window counters,
 * window = one UTC day, tag = floor(now / 86400000), TTL 25 h:
 *
 *   wd:<board>:<tag>   bytes of every principal on the board   (budget_bytes_board_day)
 *   wu:<uh>:<tag>      bytes of an account over all boards     (budget_bytes_user_day)
 *
 * uh = the 24 hex characters of sha256(uid) as in g:<board>:<uh>; guests
 * have no wu: counter. A request counts the byte length of its body
 * (SyncRequest::bodyBytes()). admit() raises all four counters of a request
 * with ops FIRST and decides afterwards (ED-05): also a request that is
 * answered busy counts, and a quota of 0 (off) keeps counting (ED-07).
 * Over a quota → busy like the window budget, retryMs = min((tag + 1) ·
 * 86400000 − now, 60000) + 100; both over → the larger retryMs.
 */
class WriteBudget {
    /** Bits of admit(): the 10-s window budget (w:/wo:) and the daily byte quota (wd:/wu:). */
    public const OVER_WINDOW = 1;
    public const OVER_DAY = 2;

    public function __construct(
        private FastCache $cache,
        private Limits $limits,
    ) {
    }

    /**
     * One request with ops (SPEC-M1 §4.13.6, §33.1 b): raises w:, wo:, wd:
     * and wu: first, then decides. 0 = go on; else a bit set of OVER_WINDOW
     * and OVER_DAY, and sync() answers busy for every op with
     * busyRetryMs(bits, now of that answer). Nothing without ops, nothing
     * without Redis.
     */
    public function admit(Principal $p, int $board, int $opCount, int $bodyBytes, int $nowMs): int {
        if ($opCount <= 0) {
            return 0;
        }
        $over = $this->check($p, $board, $opCount, $nowMs) !== null ? self::OVER_WINDOW : 0;
        if ($this->dayOver($p, $board, $bodyBytes, $nowMs)) {
            $over |= self::OVER_DAY;
        }
        return $over;
    }

    /**
     * The daily byte quota alone: raises wd:<board>:<tag> and (accounts only)
     * wu:<uh>:<tag> by $bytes, then true when either is over its quota (a
     * quota of 0 is off, the counter still counts). False without Redis.
     */
    public function dayOver(Principal $p, int $board, int $bytes, int $nowMs): bool {
        $tag = self::day($nowMs);
        $bytes = max(0, $bytes);
        $boardBytes = $this->cache->windowInc('wd:' . $board . ':' . $tag, Limits::BYTES_DAY_TTL, $bytes);
        if ($boardBytes === null) {
            return false;
        }
        $userBytes = null;
        if (!$p->isGuest && $p->uid !== null) {
            $userBytes = $this->cache->windowInc('wu:' . self::userHash($p->uid) . ':' . $tag, Limits::BYTES_DAY_TTL, $bytes);
        }
        $boardQuota = $this->limits->budgetBytesBoardDay();
        $userQuota = $this->limits->budgetBytesUserDay();
        return ($boardQuota > 0 && $boardBytes > $boardQuota)
            || ($userQuota > 0 && $userBytes !== null && $userBytes > $userQuota);
    }

    /**
     * Counts one request with $opCount ops in the current window.
     *
     * @return int|null retryMs (the request is over the budget: busy) or null (go on)
     */
    public function check(Principal $p, int $board, int $opCount, int $nowMs): ?int {
        if ($opCount <= 0) {
            return null;
        }
        $win = self::window($nowMs);
        $syncs = $this->cache->windowInc(self::key('w', $board, $p, $win), Limits::BUDGET_TTL, 1);
        if ($syncs === null) {
            return null;
        }
        $ops = $this->cache->windowInc(self::key('wo', $board, $p, $win), Limits::BUDGET_TTL, $opCount);
        if ($syncs > $this->limits->budgetSyncs() || ($ops !== null && $ops > $this->limits->budgetOps())) {
            return self::retryMs($nowMs);
        }
        return null;
    }

    /** Rows the server derived from the ops of a request (written after COMMIT) count as ops. */
    public function charge(Principal $p, int $board, int $derivedRows, int $nowMs): void {
        if ($derivedRows <= 0) {
            return;
        }
        $this->cache->windowInc(self::key('wo', $board, $p, self::window($nowMs)), Limits::BUDGET_TTL, $derivedRows);
    }

    /** Index of the 10-s window of $nowMs. */
    public static function window(int $nowMs): int {
        return intdiv($nowMs, Limits::BUDGET_WINDOW_MS);
    }

    /**
     * acks.retryMs of a busy answer (SPEC-M1 §4.13.6): (win + 1)·10000 −
     * now + 100, i.e. 100 ms into the next window, with `now` of the same
     * answer (C76).
     */
    public static function retryMs(int $nowMs): int {
        return (self::window($nowMs) + 1) * Limits::BUDGET_WINDOW_MS - $nowMs + 100;
    }

    /** Index of the UTC day of $nowMs (the window of the daily byte quota). */
    public static function day(int $nowMs): int {
        return intdiv($nowMs, Limits::BYTES_DAY_MS);
    }

    /**
     * acks.retryMs of a busy answer of the daily quota (SPEC-M1 §33.1 b):
     * min((tag + 1)·86400000 − now, 60000) + 100, i.e. 100–60100 ms, with
     * `now` of the same answer.
     */
    public static function dayRetryMs(int $nowMs): int {
        return min((self::day($nowMs) + 1) * Limits::BYTES_DAY_MS - $nowMs, Limits::BYTES_RETRY_MAX_MS) + 100;
    }

    /** acks.retryMs for the bits of admit(): the larger of the two when both are over (ED-05). */
    public static function busyRetryMs(int $over, int $nowMs): int {
        $ms = 0;
        if (($over & self::OVER_WINDOW) !== 0) {
            $ms = self::retryMs($nowMs);
        }
        if (($over & self::OVER_DAY) !== 0) {
            $ms = max($ms, self::dayRetryMs($nowMs));
        }
        return $ms;
    }

    /** The 24 hex characters of sha256(uid), as in g:<board>:<uh> (SPEC-M1 §5.1, ED-06). */
    public static function userHash(string $uid): string {
        return substr(hash('sha256', $uid), 0, 24);
    }

    private static function key(string $kind, int $board, Principal $p, int $win): string {
        return $kind . ':' . $board . ':' . $p->pid . ':' . $win;
    }
}
