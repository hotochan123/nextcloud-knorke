<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IMemcacheTTL;

/**
 * Board state in Redis through PUBLIC Nextcloud API only (SPEC-M0 §5.1,
 * SPEC-M1 §5.1). The distributed cache carries the board epoch in its prefix
 * (`'knorke/' . $epoch . '/'`, the literal form of SPEC-M1 §5.1), so the
 * keys are <global prefix>/knorke/<epoch>/<key>: rotating the epoch
 * (occ knorke:epoch:rotate, SPEC-M1 §5.4) makes every key invisible at once.
 * No raw Redis commands, no hashes, no MGET, no Lua of our own.
 *
 *  r:<board>        int rev; seedRev add(…, 30); bumpRev get/add/cas loop,
 *                   setTTL 30 after every successful cas, remove on failure.
 *                   Raised ONLY after the DB commit, monotonic. TTL 30 s is
 *                   safety net (a): a quiet board re-reads the DB at least
 *                   every 30 s, which heals a lost bump.
 *  a:<board>        [aclGen, linkGen, minRev, links, voteLinkGen] (5 ints);
 *                   deleted = [-1,-1,-1]. links = 1 while Nextcloud's
 *                   link-sharing policy allows links for the board owner
 *                   (LinkPolicy), else 0: guests and link members are refused
 *                   on the fast path too. linkGen is the generation of the
 *                   edit link, voteLinkGen the one of the voting link.
 *                   Readers seed with add(…, 120), administration writes
 *                   with set(…, 120), so a late seeder never overwrites a
 *                   fresh revocation; markGone set(…, 300). Any other shape
 *                   (also the 4-element value of M0) is a miss.
 *  g:<board>:<uh>   "<aclGen>|<role>|<o>" after a full check, 120 s (or
 *                   shorter, $ttl); o = origin of the role: o owner, f share
 *                   with `moderate`, s share, l link. Valid only while aclGen
 *                   equals a:<board>[0]; uh = sha256(uid)[0..24]. A 2-part
 *                   value of M0 is a miss.
 *  vt:<board>       "<sid>:<seq>" of the open voting session (stage 3), a
 *                   string; cas maximum (sid, then seq), 120 s, written after
 *                   every effective vote batch, at the start of a session,
 *                   by a moderator poll that read the database, and after
 *                   UserDeletedEvent removed votes (SPEC-M1 §5.1).
 *
 *  w:/wo:/wd:/wu:  fixed-window counters of the write budget and of the
 *                   daily byte quota (P7, SPEC-M1 §33.1 b): windowInc();
 *                   the key forms are WriteBudget's.
 *
 * Nextcloud's Redis decodeValue() turns every numeric string into an int —
 * a float would be truncated. Nothing here ever stores a float.
 *
 * The fast path is on only when the distributed cache supports TTLs
 * (IMemcacheTTL, i.e. Redis) and the factory reports it available; otherwise
 * every method is a no-op/miss and all paths fall back to the database.
 */
class FastCache {
    public const REV_TTL = 30;
    public const GENS_TTL = 120;
    public const GONE_TTL = 300;
    public const GRANT_TTL = 120;
    /** Grant origins (SPEC-M1 §5.1): owner, share with moderate, share, link. */
    public const GRANT_ORIGINS = ['o', 'f', 's', 'l'];
    private const GRANT_RE = '/^(-?\d{1,18})\|([a-z]{1,16})\|([ofsl])\z/';
    private const CAS_TRIES = 6;
    private const GONE = [-1, -1, -1];
    /** vt:<board> (SPEC-M1 §5.1): "<sid>:<seq>", 120 s, cas maximum with at most 3 attempts (§4.13.5). */
    public const VOTE_SEQ_TTL = 120;
    private const VOTE_SEQ_TRIES = 3;
    private const VOTE_SEQ_RE = '/^(\d{1,18}):(\d{1,18})\z/';

    /** @var IMemcacheTTL|null null = no fast path (no Redis) */
    private ?ICache $cache = null;
    private Epoch $epoch;

    /**
     * The epoch is read once per request (one FastCache per request); the
     * prefix line is the literal form of SPEC-M1 §5.1, which the drift test
     * dev/selftest/docs.test.mjs and SourceGuardTest check.
     */
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

    // ── Board rev ──────────────────────────────────────────────────────────

    public function getRev(int $b): ?int {
        $v = $this->cache?->get('r:' . $b);
        return is_int($v) ? $v : null;
    }

    /** After a DB read: fills a missing key only (never lowers a newer value). */
    public function seedRev(int $b, int $rev): void {
        $this->cache?->add('r:' . $b, $rev, self::REV_TTL);
    }

    /**
     * Raises r:<board> to $rev unless it is already as high (monotonic
     * maximum; two writers may arrive in either order). cas() drops the TTL
     * (plain SET in Nextcloud's Lua), so the TTL is renewed after every
     * successful cas. If the loop cannot settle, the key is removed: a missing
     * key means "ask the DB", a too-low key could hide a committed rev.
     */
    public function bumpRev(int $b, int $rev): void {
        if ($this->cache === null) {
            return;
        }
        $key = 'r:' . $b;
        for ($i = 0; $i < self::CAS_TRIES; $i++) {
            $cur = $this->cache->get($key);
            if (!is_int($cur)) {
                if ($this->cache->add($key, $rev, self::REV_TTL)) {
                    return;
                }
                continue;
            }
            if ($cur >= $rev) {
                return;
            }
            if ($this->cache->cas($key, $cur, $rev)) {
                $this->cache->setTTL($key, self::REV_TTL);
                return;
            }
        }
        $this->cache->remove($key);
    }

    // ── Generations ────────────────────────────────────────────────────────

    /** @return array{acl: int, link: int, minRev: int, links: bool, voteLink: int, gone: bool}|null */
    public function getGens(int $b): ?array {
        $v = $this->cache?->get('a:' . $b);
        if ($v === self::GONE) {
            return ['acl' => -1, 'link' => -1, 'minRev' => -1, 'links' => false, 'voteLink' => -1, 'gone' => true];
        }
        if (!is_array($v) || count($v) !== 5 || !array_is_list($v)
            || !is_int($v[0]) || !is_int($v[1]) || !is_int($v[2]) || ($v[3] !== 0 && $v[3] !== 1) || !is_int($v[4])) {
            return null;
        }
        return ['acl' => $v[0], 'link' => $v[1], 'minRev' => $v[2], 'links' => $v[3] === 1, 'voteLink' => $v[4], 'gone' => false];
    }

    /**
     * Reader after a DB read: add only, a late seeder never overwrites a
     * revocation. $links: LinkPolicy::allows() for the board owner.
     */
    public function seedGens(int $b, int $acl, int $link, int $minRev, bool $links, int $voteLink): void {
        $this->cache?->add('a:' . $b, [$acl, $link, $minRev, $links ? 1 : 0, $voteLink], self::GENS_TTL);
    }

    /** Administration after a revocation (link rotated/off, member removed): set wins. */
    public function setGens(int $b, int $acl, int $link, int $minRev, bool $links, int $voteLink): void {
        $this->cache?->set('a:' . $b, [$acl, $link, $minRev, $links ? 1 : 0, $voteLink], self::GENS_TTL);
    }

    /** Board deleted: every fast path answers 404 for 300 s, then the DB does. */
    public function markGone(int $b): void {
        $this->cache?->set('a:' . $b, self::GONE, self::GONE_TTL);
    }

    // ── Grants ─────────────────────────────────────────────────────────────

    /** @return array{acl: int, role: string, origin: string}|null */
    public function getGrant(int $b, string $uid): ?array {
        $v = $this->cache?->get(self::grantKey($b, $uid));
        if (!is_string($v) || preg_match(self::GRANT_RE, $v, $m) !== 1) {
            return null;
        }
        return ['acl' => (int)$m[1], 'role' => $m[2], 'origin' => $m[3]];
    }

    /**
     * After a full check. $origin: o | f | s | l (GRANT_ORIGINS); $ttl at
     * most GRANT_TTL, at least 1 (a link member's grant ends with its link,
     * SPEC-M1 §4.11.4).
     */
    public function setGrant(int $b, string $uid, int $acl, string $role, string $origin, int $ttl = self::GRANT_TTL): void {
        if (!in_array($origin, self::GRANT_ORIGINS, true)) {
            throw new \InvalidArgumentException('Knorke: unknown grant origin ' . $origin);
        }
        $ttl = max(1, min(self::GRANT_TTL, $ttl));
        $this->cache?->set(self::grantKey($b, $uid), $acl . '|' . $role . '|' . $origin, $ttl);
    }

    // ── Voting count state ─────────────────────────────────────────────────

    /**
     * vt:<board> = "<sid>:<seq>" (SPEC-M1 §5.1): the voting session a
     * moderator poll compares its `vt` with (§4.13.8 step 9). Any other
     * shape is a miss.
     *
     * @return array{sid: int, seq: int}|null
     */
    public function getVoteSeq(int $b): ?array {
        $v = $this->cache?->get('vt:' . $b);
        if (!is_string($v) || preg_match(self::VOTE_SEQ_RE, $v, $m) !== 1) {
            return null;
        }
        return ['sid' => (int)$m[1], 'seq' => (int)$m[2]];
    }

    /**
     * Raises vt:<board> to ($sid, $seq) unless it already stands at or above
     * it (cas maximum, SPEC-M1 §4.13.5, R2): sid first, then seq. Two vote
     * batches may commit in one order and call this in the other; a plain
     * set would leave the older state for up to VOTE_SEQ_TTL. The value is a
     * string (never a number or a list). At most VOTE_SEQ_TRIES attempts,
     * then it gives up: a moderator poll with a vt the key does not match
     * reads the database (§4.13.8 step 9 (ii)). cas() drops the TTL, so it
     * is renewed after a successful cas.
     */
    public function setVoteSeq(int $b, int $sid, int $seq): void {
        if ($this->cache === null) {
            return;
        }
        $key = 'vt:' . $b;
        $new = $sid . ':' . $seq;
        for ($i = 0; $i < self::VOTE_SEQ_TRIES; $i++) {
            $cur = $this->cache->get($key);
            if ($cur === null) {
                if ($this->cache->add($key, $new, self::VOTE_SEQ_TTL)) {
                    return;
                }
                continue;
            }
            if (is_string($cur) && preg_match(self::VOTE_SEQ_RE, $cur, $m) === 1
                && [(int)$m[1], (int)$m[2]] >= [$sid, $seq]) {
                return;
            }
            if ($this->cache->cas($key, $cur, $new)) {
                $this->cache->setTTL($key, self::VOTE_SEQ_TTL);
                return;
            }
        }
    }

    // ── Fixed-window counters ──────────────────────────────────────────────

    /**
     * Fixed-window counter (SPEC-M1 §9.7; link password failures
     * pwf:<linkId>:<nh>:<win>, §4.11.4): add($key, 0, $ttl) creates the
     * window with its TTL once, inc($key, $step) counts atomically. $step 0
     * only reads. Returns the count, or null without Redis (callers fall
     * back, e.g. to IThrottler).
     */
    public function windowInc(string $key, int $ttl, int $step): ?int {
        if ($this->cache === null) {
            return null;
        }
        $this->cache->add($key, 0, $ttl);
        if ($step === 0) {
            $v = $this->cache->get($key);
            return is_int($v) ? $v : 0;
        }
        $v = $this->cache->inc($key, $step);
        return is_int($v) ? $v : null;
    }

    private static function grantKey(int $b, string $uid): string {
        return 'g:' . $b . ':' . substr(hash('sha256', $uid), 0, 24);
    }
}
