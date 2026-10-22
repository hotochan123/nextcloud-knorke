<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Exception\NothingWritten;
use OCP\AppFramework\Db\TTransactional;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

/**
 * Dot voting (SPEC-M1 §4.12.1, §4.13.5, §4.13.8 step 9, §7.2).
 *
 * Every write takes the board row lock FIRST (BoardStore::lockBoard), so
 * vote batches, object batches, meta writes and the four ways of closing a
 * session are serialised per board. Under the lock a session is always read
 * again — never from a read before. At most one session per board is open.
 *
 *  start   400 vote_config before the lock; under it: open session → 409
 *          vote_open (an EXPIRED open session is closed first, the close
 *          committed, then 409); scope must be a live frame; INSERT the
 *          session and meta.vote = {sid, state open, cfg, startedAt, endsAt,
 *          by, show false}. vt:<board> = "<sid>:0" after the COMMIT.
 *  update  end | extend | show | hide | clear (§4.12, R16): end closes the
 *          open session (else 409 vote_closed); extend moves ends_at (an
 *          expired open session is closed and committed, then 409
 *          vote_closed); show/hide set meta.vote.show (no meta.vote → 409
 *          vote_closed; same value → nothing written, the stored state);
 *          clear removes a closed meta.vote (open or none → 409).
 *  apply   the vote ops of one sync request (set semantics, never a delta):
 *          closed/expired sessions answer `closed` (an expired one is closed
 *          here, path a); per op gone / bad (type, scope) / authorize /
 *          limit (per item, per person against the state after the earlier
 *          ops of the batch) / ok. Type, scope, perItem and per are checked
 *          only for an increase (R17-K1, R17-K2): n ≤ the voter's current
 *          row on a live item is always ok. Only votes on LIVE items count
 *          (R16): `mine`, `left` and the budget, with no scope filter (rows
 *          on items moved out of the scope frame keep counting, R17-K2);
 *          n = 0 on a deleted item is ok and deletes the row. Nothing
 *          written and nothing closed → rollback, no seq. Vote ops never
 *          raise the board rev.
 *  close   idempotent under the lock: re-read, already closed → nothing;
 *          else results (Σ n per live item), voters, state closed, the vote
 *          rows DELETED (only sums survive, §7.2), meta.vote closed with the
 *          ranking (top VOTE_RESULTS_IN_META by n desc, then id), total,
 *          voters, closedAt — in the same transaction.
 *
 * Meta inside these transactions goes through MetaService::writeLocked (no
 * nested atomic(), no bumpRev inside, R16); r:<board> is bumped after the
 * COMMIT, and an HTTP 409 that follows a committed close is thrown only
 * after that COMMIT (SRV-02). vt:<board> moves only forward
 * (FastCache::setVoteSeq, cas maximum) and only after the COMMIT.
 */
class VoteService {
    use TTransactional;

    /** Defaults of a voting session (SPEC-M1 §4.12.1). */
    public const DEFAULT_PER = 5;
    public const DEFAULT_PER_ITEM = 1;
    public const DEFAULT_TYPES = ['sticky'];
    /** Actions of PATCH …/vote (route 23). */
    public const ACTIONS = ['end', 'extend', 'show', 'hide', 'clear'];

    public function __construct(
        private VoteStore $store,
        private BoardStore $boards,
        private MetaService $meta,
        private FastCache $cache,
        private IDBConnection $db,
        private LoggerInterface $logger,
    ) {
    }

    // ── Sessions (routes 22, 23) ───────────────────────────────────────────

    /**
     * The body of route 22 (§4.12.1): per 1–VOTE_PER_MAX (default 5),
     * perItem 1–per (default 1), scope null or a ULID, types a non-empty
     * list of votable types (default ["sticky"], duplicates dropped),
     * minutes null or 1–VOTE_MINUTES_MAX. A missing key or null takes the
     * default. Whether scope names a live frame is checked under the lock.
     *
     * @return array{cfg: array{per: int, perItem: int, scope: ?string, types: list<string>}, minutes: ?int}
     * @throws HttpError 400 vote_config
     */
    public static function config(array $body): array {
        $bad = static fn (): HttpError => new HttpError(400, 'vote_config');
        $per = ($body['per'] ?? null) === null ? self::DEFAULT_PER : Input::whole($body['per']);
        if ($per === null || $per < 1 || $per > Limits::VOTE_PER_MAX) {
            throw $bad();
        }
        $perItem = ($body['perItem'] ?? null) === null ? self::DEFAULT_PER_ITEM : Input::whole($body['perItem']);
        if ($perItem === null || $perItem < 1 || $perItem > $per) {
            throw $bad();
        }
        $scope = $body['scope'] ?? null;
        if ($scope !== null && (!is_string($scope) || preg_match(OpValidator::ULID_RE, $scope) !== 1)) {
            throw $bad();
        }
        $types = $body['types'] ?? null;
        if ($types === null) {
            $types = self::DEFAULT_TYPES;
        }
        if (!is_array($types) || $types === [] || !array_is_list($types)) {
            throw $bad();
        }
        $out = [];
        foreach ($types as $t) {
            if (!is_string($t) || !ItemRegistry::has($t) || !ItemRegistry::isVotable($t)) {
                throw $bad();
            }
            if (!in_array($t, $out, true)) {
                $out[] = $t;
            }
        }
        $minutes = null;
        if (($body['minutes'] ?? null) !== null) {
            $minutes = Input::whole($body['minutes']);
            if ($minutes === null || $minutes < 1 || $minutes > Limits::VOTE_MINUTES_MAX) {
                throw $bad();
            }
        }
        return ['cfg' => ['per' => $per, 'perItem' => $perItem, 'scope' => $scope, 'types' => $out], 'minutes' => $minutes];
    }

    /**
     * Route 22: opens a session (§4.12.1).
     *
     * @param array $cfg the raw body {per?, perItem?, scope?, types?, minutes?}
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 400 vote_config | 404 | 409 vote_open
     */
    public function start(Principal $p, int $board, array $cfg, int $nowMs): array {
        ['cfg' => $c, 'minutes' => $minutes] = self::config($cfg);
        $out = $this->atomic(function () use ($p, $board, $c, $minutes, $nowMs): array {
            $this->boards->lockBoard($board, false, null, $nowMs) ?? throw new HttpError(404, 'not_found');
            $open = $this->store->open($board);
            if ($open !== null) {
                if (!self::expired($open, $nowMs)) {
                    throw new HttpError(409, 'vote_open');
                }
                // Expired, closed by nobody yet: close it and COMMIT that, then 409 (R16).
                return ['conflict' => 'vote_open', 'write' => $this->closeLocked($board, $open['id'], $nowMs)];
            }
            if ($c['scope'] !== null) {
                $frame = $this->store->items($board, [$c['scope']])[$c['scope']] ?? null;
                if ($frame === null || $frame['deleted'] || $frame['type'] !== 'frame') {
                    throw new HttpError(400, 'vote_config');
                }
            }
            $endsAt = $minutes === null ? null : $nowMs + $minutes * 60000;
            $sid = $this->store->insert($board, $c, $p->id, $nowMs, $endsAt);
            $vote = self::voteMeta($sid, $c, $nowMs, $endsAt, $p->displayName);
            $write = $this->meta->writeLocked($board, static function (array $m) use ($vote): array {
                $m['vote'] = $vote;
                return $m;
            }, $nowMs);
            return ['conflict' => null, 'write' => $write, 'sid' => $sid];
        }, $this->db);
        $this->afterCommit($board, $out['write']);
        if ($out['conflict'] !== null) {
            throw new HttpError(409, $out['conflict']);
        }
        // A fresh session has no votes: a moderator poll with vt 0 stays without SQL (§4.13.8 step 9 (i)).
        $this->cache->setVoteSeq($board, $out['sid'], 0);
        return self::answer($out['write']);
    }

    /**
     * Route 23 (§4.12, §4.12.1, R16). $minutes is the whole number of the
     * body (null: missing or not a whole number); only extend reads it.
     *
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 400 bad_request | 400 vote_config | 404 | 409 vote_closed
     */
    public function update(Principal $p, int $board, string $action, ?int $minutes, int $nowMs): array {
        if (!in_array($action, self::ACTIONS, true)) {
            throw new HttpError(400, 'bad_request', 'Unknown action.');
        }
        if ($action === 'extend' && ($minutes === null || $minutes < 1 || $minutes > Limits::VOTE_MINUTES_MAX)) {
            throw new HttpError(400, 'vote_config');
        }
        $out = $this->atomic(function () use ($board, $action, $minutes, $nowMs): array {
            $this->boards->lockBoard($board, false, null, $nowMs) ?? throw new HttpError(404, 'not_found');
            return match ($action) {
                'end' => $this->endLocked($board, $nowMs),
                'extend' => $this->extendLocked($board, (int)$minutes, $nowMs),
                'show', 'hide' => ['conflict' => null, 'write' => $this->meta->writeLocked($board, static function (array $m) use ($action): ?array {
                    if (!is_array($m['vote'] ?? null)) {
                        throw new HttpError(409, 'vote_closed');
                    }
                    $want = $action === 'show';
                    if (($m['vote']['show'] ?? false) === $want) {
                        return null;
                    }
                    $m['vote']['show'] = $want;
                    return $m;
                }, $nowMs)],
                'clear' => ['conflict' => null, 'write' => $this->meta->writeLocked($board, static function (array $m): array {
                    if (!is_array($m['vote'] ?? null) || ($m['vote']['state'] ?? null) !== 'closed') {
                        throw new HttpError(409, 'vote_closed');
                    }
                    unset($m['vote']);
                    return $m;
                }, $nowMs)],
            };
        }, $this->db);
        $this->afterCommit($board, $out['write']);
        if ($out['conflict'] !== null) {
            throw new HttpError(409, $out['conflict']);
        }
        return self::answer($out['write']);
    }

    /** @return array{conflict: ?string, write: ?array} */
    private function endLocked(int $board, int $nowMs): array {
        $open = $this->store->open($board) ?? throw new HttpError(409, 'vote_closed');
        return ['conflict' => null, 'write' => $this->closeLocked($board, $open['id'], $nowMs)];
    }

    /** @return array{conflict: ?string, write: ?array} */
    private function extendLocked(int $board, int $minutes, int $nowMs): array {
        $open = $this->store->open($board) ?? throw new HttpError(409, 'vote_closed');
        if (self::expired($open, $nowMs)) {
            // Expired, closed by nobody yet: close and COMMIT, then 409 (R2, R16).
            return ['conflict' => 'vote_closed', 'write' => $this->closeLocked($board, $open['id'], $nowMs)];
        }
        $endsAt = max($open['ends_at'] ?? $nowMs, $nowMs) + $minutes * 60000;
        $this->store->setEndsAt($open['id'], $endsAt);
        $write = $this->meta->writeLocked($board, static function (array $m) use ($open, $endsAt, $nowMs): array {
            $vote = is_array($m['vote'] ?? null) && ($m['vote']['sid'] ?? null) === $open['id']
                ? $m['vote'] : self::voteMeta($open['id'], $open['config'], $open['started_at'], $open['ends_at'], '');
            $vote['endsAt'] = $endsAt;
            $m['vote'] = $vote;
            return $m;
        }, $nowMs);
        return ['conflict' => null, 'write' => $write];
    }

    // ── Votes (sync, §4.13.5) ──────────────────────────────────────────────

    /**
     * The vote ops of one sync request, positionally (§4.6, §4.13.5).
     *
     * @param list<array> $voteOps normalized ops (OpValidator::normalizeVote): vote | bad | denied
     * @param (callable(Principal, array, ?array, ?array): ?string)|null $authorize the rights hook
     *   of SyncService (§4.13.2 step 9; M1: never refuses); it gets the op and the item
     *   ({type, parent_id, deleted}) as working copy and row
     * @return array{res: list<string>, sid: ?int, mine: ?array<string, int>, left: ?int}
     *   sid/mine/left of the session the ops reached when it is open after the batch, else null
     */
    public function apply(Principal $p, int $board, array $voteOps, int $nowMs, ?callable $authorize = null): array {
        $ops = array_values($voteOps);
        $res = array_map(static fn (array $o): ?string => $o['o'] === 'vote' ? null : (string)$o['o'], $ops);
        if (!in_array(null, $res, true)) {
            // Only bad/denied: no transaction, no lock.
            return ['res' => $res, 'sid' => null, 'mine' => null, 'left' => null];
        }
        $result = null;
        try {
            $result = $this->atomic(function () use ($p, $board, $ops, $res, $nowMs, $authorize, &$result): array {
                $result = $this->applyLocked($p, $board, $ops, $res, $nowMs, $authorize);
                if ($result['seq'] === null && $result['closed'] === []) {
                    // Nothing effective: roll back (no seq, no rev; SPEC-M1 §4.13.5).
                    throw new NothingWritten($result['res'], 0);
                }
                return $result;
            }, $this->db);
        } catch (NothingWritten) {
            // $result was set before the throw.
        }
        foreach ($result['closed'] as $write) {
            $this->afterCommit($board, $write);
        }
        if ($result['seq'] !== null) {
            $this->cache->setVoteSeq($board, $result['sid'], $result['seq']);
        }
        return ['res' => $result['res'], 'sid' => $result['sid'], 'mine' => $result['mine'], 'left' => $result['left']];
    }

    /**
     * Inside the transaction: lock, sessions, the ops in order, the writes.
     *
     * @param list<array> $ops
     * @param list<?string> $res null where the op still has to be decided
     * @return array{res: list<string>, sid: ?int, mine: ?array, left: ?int, seq: ?int, closed: list<array>}
     */
    private function applyLocked(Principal $p, int $board, array $ops, array $res, int $nowMs, ?callable $authorize): array {
        $this->boards->lockBoard($board, false, null, $nowMs) ?? throw new HttpError(404, 'not_found');
        // The sessions of the ops, read under the lock.
        $open = null;
        $closed = [];
        $state = [];
        foreach ($ops as $i => $op) {
            if ($res[$i] !== null || array_key_exists($op['s'], $state)) {
                continue;
            }
            $s = $this->store->find($board, $op['s']);
            if ($s === null || $s['state'] !== 'open') {
                $state[$op['s']] = false;
            } elseif (self::expired($s, $nowMs)) {
                // Path (a) of the automatic close (§4.12.1).
                $w = $this->closeLocked($board, $s['id'], $nowMs);
                if ($w !== null) {
                    $closed[] = $w;
                }
                $state[$op['s']] = false;
            } else {
                $state[$op['s']] = true;
                $open = $s;
            }
        }
        foreach ($ops as $i => $op) {
            if ($res[$i] === null && !$state[$op['s']]) {
                $res[$i] = 'closed';
            }
        }
        if ($open === null) {
            return ['res' => $res, 'sid' => null, 'mine' => null, 'left' => null, 'seq' => null, 'closed' => $closed];
        }

        $sid = $open['id'];
        $cfg = $open['config'];
        $rows = $this->store->rows($sid, $p->pid);
        $ids = array_keys($rows);
        foreach ($ops as $i => $op) {
            if ($res[$i] === null) {
                $ids[] = $op['id'];
            }
        }
        $items = $this->store->items($board, array_map('strval', $ids));
        $live = static fn (string $id): bool => isset($items[$id]) && !$items[$id]['deleted'];
        $cur = $rows;
        foreach ($ops as $i => $op) {
            if ($res[$i] !== null) {
                continue;
            }
            $id = $op['id'];
            $n = $op['n'];
            $item = $items[$id] ?? null;
            if ($n === 0 && $item !== null && $item['deleted']) {
                // R16: taking a vote back from a deleted item is ok and deletes the row.
                unset($cur[$id]);
                $res[$i] = 'ok';
                continue;
            }
            if ($item === null || $item['deleted']) {
                $res[$i] = 'gone';
                continue;
            }
            // R17-K2: only an increase (n above the voter's current row on this
            // live item, earlier ops of the batch included) checks type and
            // scope. Lowering or taking back a vote is always possible, also
            // after an editor moved the item out of the scope frame.
            $raise = $n > ($cur[$id] ?? 0);
            if ($raise && (!in_array($item['type'], $cfg['types'], true) || ($cfg['scope'] !== null && $item['parent_id'] !== $cfg['scope']))) {
                $res[$i] = 'bad';
                continue;
            }
            $deny = $authorize === null ? null : $authorize($p, $op, $item, $item);
            if ($deny !== null) {
                $res[$i] = $deny;
                continue;
            }
            // R17-K1: a reduction or an unchanged value never raises the
            // voter's sum, so it never fails with limit ("überschrittenes per
            // wird hingenommen"); only an increase checks perItem and per.
            if ($raise && $n > $cfg['perItem']) {
                $res[$i] = 'limit';
                continue;
            }
            if ($raise) {
                $others = 0;
                foreach ($cur as $other => $m) {
                    $other = (string)$other;
                    if ($other !== $id && $live($other)) {
                        $others += $m;
                    }
                }
                if ($others + $n > $cfg['per']) {
                    $res[$i] = 'limit';
                    continue;
                }
            }
            if ($n === 0) {
                unset($cur[$id]);
            } else {
                $cur[$id] = $n;
            }
            $res[$i] = 'ok';
        }

        $changes = [];
        foreach ($rows as $item => $n) {
            if (!array_key_exists($item, $cur)) {
                $changes[(string)$item] = 0;
            }
        }
        foreach ($cur as $item => $n) {
            if (($rows[$item] ?? null) !== $n) {
                $changes[(string)$item] = $n;
            }
        }
        $seq = null;
        if ($changes !== []) {
            $this->store->write($sid, $p->pid, $changes, $nowMs, $rows);
            $seq = $this->store->bumpSeq($sid);
        }
        $mine = [];
        foreach ($cur as $item => $n) {
            if ($live((string)$item)) {
                $mine[(string)$item] = $n;
            }
        }
        ksort($mine, SORT_STRING);
        return ['res' => $res, 'sid' => $sid, 'mine' => $mine, 'left' => self::left($cfg, $mine), 'seq' => $seq, 'closed' => $closed];
    }

    /**
     * Step 9 (ii) of the sync read path (§4.13.8, R16) for a moderator whose
     * `vt` the key vt:<board> did not confirm: no open session → null; an
     * expired one is closed (path b) → null (the closed meta.vote comes with
     * the next tick); else vt:<board> is seeded again (also after its TTL or
     * an epoch rotation) and {sid, voters, vt = seq} returned. No tally:
     * moderators see only the number of voters (§7.2).
     *
     * @return array{sid: int, voters: int, vt: int}|null
     */
    public function progress(Principal $p, int $board, int $seenSeq, int $nowMs): ?array {
        $open = $this->store->open($board);
        if ($open === null) {
            return null;
        }
        if (self::expired($open, $nowMs)) {
            $this->closeTx($board, $open['id'], $nowMs);
            return null;
        }
        // seq first, then voters: the number is never older than the seq it is sent with.
        $this->cache->setVoteSeq($board, $open['id'], $open['seq']);
        return ['sid' => $open['id'], 'voters' => $this->store->voters($open['id']), 'vt' => $open['seq']];
    }

    /**
     * The own votes for snapshot and join (§4.4, R16): {sid, mine, left} of
     * the open session (live items only), or null without one. The caller
     * asks only for a principal that may vote.
     *
     * @return array{sid: int, mine: array<string, int>, left: int}|null
     */
    public function mine(int $board, string $pid): ?array {
        $open = $this->store->open($board);
        if ($open === null) {
            return null;
        }
        $mine = $this->store->mine($open['id'], $pid);
        return ['sid' => $open['id'], 'mine' => $mine, 'left' => self::left($open['config'], $mine)];
    }

    // ── Closing (§4.12.1: four ways, one close) ───────────────────────────

    /** Closes session $sid of the board (idempotent; its own transaction under the board lock). */
    public function close(int $board, int $sid, int $nowMs): void {
        $this->closeTx($board, $sid, $nowMs);
    }

    /**
     * VoteCloseJob (path d): every open session whose end has passed, one
     * transaction each; a failing board is logged and skipped.
     *
     * @return int sessions closed by this call
     */
    public function closeExpired(int $nowMs): int {
        $n = 0;
        foreach ($this->store->expiredOpen($nowMs) as $s) {
            try {
                if ($this->closeTx($s['board_id'], $s['id'], $nowMs)) {
                    $n++;
                }
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: closing an expired voting session failed', ['exception' => $e, 'app' => 'knorke', 'board' => $s['board_id']]);
            }
        }
        return $n;
    }

    /** @return bool true when THIS call closed the session */
    private function closeTx(int $board, int $sid, int $nowMs): bool {
        $write = $this->atomic(function () use ($board, $sid, $nowMs): ?array {
            if ($this->boards->lockBoard($board, false, null, $nowMs) === null) {
                // The board is gone (a row left behind): close the session row, keep nothing.
                $s = $this->store->find($board, $sid);
                if ($s !== null && $s['state'] === 'open') {
                    $this->store->close($sid, [], 0, $nowMs);
                    $this->store->deleteVotes($sid);
                }
                return null;
            }
            return $this->closeLocked($board, $sid, $nowMs);
        }, $this->db);
        $this->afterCommit($board, $write);
        return $write !== null;
    }

    /**
     * The close itself (§4.13.5), inside the caller's transaction after its
     * lockBoard: re-read; not open → null (idempotent); else results,
     * voters, state closed, vote rows deleted, meta.vote closed with the
     * ranking — meta through MetaService::writeLocked, the caller bumps the
     * rev after its COMMIT.
     *
     * @return array{title: string, meta: array, metaRev: int, written: bool}|null
     */
    private function closeLocked(int $board, int $sid, int $nowMs): ?array {
        $s = $this->store->find($board, $sid);
        if ($s === null || $s['state'] !== 'open') {
            return null;
        }
        $tally = $this->store->tally($sid);
        $voters = $this->store->voters($sid);
        $this->store->close($sid, $tally, $voters, $nowMs);
        $this->store->deleteVotes($sid);
        $ranked = [];
        foreach ($tally as $id => $n) {
            $ranked[] = [(string)$id, $n];
        }
        usort($ranked, static fn (array $a, array $b): int => [$b[1], $a[0]] <=> [$a[1], $b[0]]);
        $top = array_slice($ranked, 0, Limits::VOTE_RESULTS_IN_META);
        $total = count($ranked);
        return $this->meta->writeLocked($board, static function (array $m) use ($s, $top, $total, $voters, $nowMs): array {
            $vote = is_array($m['vote'] ?? null) && ($m['vote']['sid'] ?? null) === $s['id']
                ? $m['vote'] : self::voteMeta($s['id'], $s['config'], $s['started_at'], $s['ends_at'], '');
            $vote['state'] = 'closed';
            $vote['results'] = $top;
            $vote['total'] = $total;
            $vote['voters'] = $voters;
            $vote['closedAt'] = $nowMs;
            $m['vote'] = $vote;
            return $m;
        }, $nowMs);
    }

    // ── Deleted accounts (§4.13.9) ─────────────────────────────────────────

    /**
     * UserDeletedEvent: on every board with an open session the votes of
     * the deleted account's pid go (else an account created later with the
     * same uid would inherit them and their spent budget); seq + 1 and,
     * after the COMMIT, vt:<board> (R16). One short transaction per board,
     * ascending board ids, never throws (failures are logged).
     *
     * @param \Closure(int): string $pidOf the pid of the account on a board (Access::pid)
     */
    public function onUserDeleted(string $uid, \Closure $pidOf): void {
        foreach ($this->store->openSessions() as $s) {
            try {
                $pid = $pidOf($s['board_id']);
                if ($this->store->rows($s['id'], $pid) === []) {
                    continue;
                }
                $now = self::nowMs();
                $seq = $this->atomic(function () use ($s, $pid, $now): ?int {
                    if ($this->boards->lockBoard($s['board_id'], false, null, $now) === null) {
                        return null;
                    }
                    $cur = $this->store->find($s['board_id'], $s['id']);
                    if ($cur === null || $cur['state'] !== 'open' || $this->store->deleteVoter($s['id'], $pid) === 0) {
                        return null;
                    }
                    return $this->store->bumpSeq($s['id']);
                }, $this->db);
                if ($seq !== null) {
                    $this->cache->setVoteSeq($s['board_id'], $s['id'], $seq);
                }
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: removing the votes of a deleted account failed', ['exception' => $e, 'app' => 'knorke', 'board' => $s['board_id']]);
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /** An open session whose end has passed (ends_at ≤ now; NULL = no time limit). */
    public static function expired(array $session, int $nowMs): bool {
        return $session['ends_at'] !== null && $session['ends_at'] <= $nowMs;
    }

    /** meta.vote of an open session (§3.11), keys in the order of the spec. */
    private static function voteMeta(int $sid, array $cfg, int $startedAt, ?int $endsAt, string $by): array {
        return [
            'sid' => $sid, 'state' => 'open',
            'cfg' => ['per' => $cfg['per'], 'perItem' => $cfg['perItem'], 'scope' => $cfg['scope'], 'types' => array_values($cfg['types'])],
            'startedAt' => $startedAt, 'endsAt' => $endsAt, 'by' => $by, 'show' => false,
        ];
    }

    /** Remaining votes: per − Σ mine (live items), never below 0 (a revived item may overdraw it, R16). */
    private static function left(array $cfg, array $mine): int {
        return max(0, $cfg['per'] - array_sum($mine));
    }

    /** After the COMMIT: the meta write becomes visible to the pollers (never before, §4.13.4). */
    private function afterCommit(int $board, ?array $write): void {
        if ($write !== null && ($write['written'] ?? true)) {
            $this->cache->bumpRev($board, $write['metaRev']);
        }
    }

    /** {title, meta, metaRev} of a meta write (the answer of routes 22–26). */
    private static function answer(?array $write): array {
        if ($write === null) {
            throw new \LogicException('Knorke: no meta state to answer with');
        }
        return ['title' => $write['title'], 'meta' => $write['meta'], 'metaRev' => $write['metaRev']];
    }

    private static function nowMs(): int {
        return (int)floor(microtime(true) * 1000);
    }
}
