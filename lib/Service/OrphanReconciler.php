<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Db\VoteStore;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IUserManager;
use Psr\Log\LoggerInterface;

/**
 * Orphan reconciliation (P7, SPEC-M1 §33.1 e; AUTHZ-1 = OPS-1): Knorke
 * cleans up after a deleted account or group when Nextcloud reports the
 * deletion (UserDeletedListener, GroupListener, §4.13.9). A disabled app gets
 * no such report, so an account or group created later with the same id
 * would inherit boards, shares and link memberships. This class finds the
 * ids Nextcloud no longer knows and treats each EXACTLY like the listeners:
 *
 *  - an orphan uid (IUserManager::userExists() === false) from shares with
 *    kind 'user', link memberships, board owners or lockers (M2, R20:
 *    locked_by u:<uid> of a locked item): BoardService::onUserDeleted (its
 *    boards deleted, memberships removed and user shares deleted, acl_gen + 1
 *    and setGens per board), VoteService::onUserDeleted (its vote rows in
 *    open sessions, seq + 1, setVoteSeq) and SyncService::clearLocker (its
 *    name and id leave its locks, the items stay locked; rev + 1 per board,
 *    bumpRev);
 *  - an orphan gid (IGroupManager::groupExists() === false) from shares with
 *    kind 'group': ShareService::onGroupDeleted.
 *
 * The listener rules apply (no exception escapes, one short transaction per
 * board, boards in ascending order). Votes of an orphan are found only
 * through uids of shares, memberships and owners (ED-15: a voter is an HMAC
 * pid). Teams (kind 'team') come with M2.
 *
 * Counts (before anything is deleted, each kind on its own; occ
 * knorke:orphans prints them in this order): user-shares and group-shares
 * (share rows), link-members (member rows), open-votes (vote rows of open
 * sessions), owned-boards (boards). A user share on a board of an orphan
 * owner counts in user-shares AND its board in owned-boards. Locks have no
 * count of their own: an orphan's locks are cleared with it, the output stays
 * five lines (probe OPS-1, smoke.sh).
 *
 * Two ways:
 *  - reconcile() (occ knorke:orphans [--dry-run]): at once; --dry-run only
 *    counts. A real run drops the reconciled ids from the candidate memo.
 *  - daily() (CleanupJob, after the clean-up; ED-14): the two-run rule — an
 *    id missing for the first time is remembered with the job's clock
 *    (app config orphan_candidates, lazy JSON {"u:<uid>": ms, "g:<gid>": ms},
 *    at most MEMO_MAX entries, the rest waits for the next run); it is
 *    reconciled only when a later run finds it still missing at least
 *    GRACE_MS (20 h) after the first time; an id that exists again (or has
 *    no rows any more) leaves the memo. This protects against a user
 *    backend that does not answer for a moment.
 * occ knorke:compact never reconciles; no repair step does (a failing user
 * backend would delete at once).
 */
class OrphanReconciler {
    /** The five kinds, in the order of the output of occ knorke:orphans (§33.1 e). */
    public const KINDS = ['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards'];
    /** App config key of the candidate memo (lazy JSON object, ED-13). */
    public const MEMO_KEY = 'orphan_candidates';
    /** Entries of the memo at most. */
    public const MEMO_MAX = 1000;
    /** A candidate is reconciled by the daily job at least this long after it was first found missing (20 h). */
    public const GRACE_MS = 72000000;

    public function __construct(
        private BoardStore $boards,
        private ShareStore $shares,
        private VoteStore $votes,
        private BoardService $boardService,
        private ShareService $shareService,
        private VoteService $voteService,
        private Access $access,
        private IUserManager $users,
        private IGroupManager $groups,
        private IAppConfig $appConfig,
        private LoggerInterface $logger,
        private ItemStore $items,
        private SyncService $sync,
    ) {
    }

    /**
     * The orphan ids now: uids from user shares, link memberships, board
     * owners and lockers (locked_by u:<uid>, M2) that Nextcloud does not
     * know, gids from group shares likewise.
     * Each list sorted and without duplicates.
     *
     * @return array{users: list<string>, groups: list<string>}
     */
    public function scan(): array {
        $lockers = array_map(static fn (string $id): string => substr($id, 2), $this->items->lockers('u:'));
        $uids = array_merge($this->shares->recipients('user'), $this->boards->memberUids(), $this->boards->ownerUids(), $lockers);
        $uids = array_values(array_unique(array_map('strval', $uids)));
        sort($uids, SORT_STRING);
        $gids = array_values(array_unique(array_map('strval', $this->shares->recipients('group'))));
        sort($gids, SORT_STRING);
        return [
            'users' => array_values(array_filter($uids, fn (string $u): bool => !$this->users->userExists($u))),
            'groups' => array_values(array_filter($gids, fn (string $g): bool => !$this->groups->groupExists($g))),
        ];
    }

    /**
     * The five counts of the given orphan ids (§33.1 e), read before any
     * deletion.
     *
     * @param list<string> $uids
     * @param list<string> $gids
     * @return array<string, int> kind → count, in the order of KINDS
     */
    public function count(array $uids, array $gids): array {
        $out = array_fill_keys(self::KINDS, 0);
        foreach ($uids as $uid) {
            $out['user-shares'] += $this->shares->countRecipient('user', $uid);
            $out['link-members'] += $this->boards->countMembershipsOf($uid);
            $out['owned-boards'] += count($this->boards->boardsOwnedBy($uid));
        }
        foreach ($gids as $gid) {
            $out['group-shares'] += $this->shares->countRecipient('group', $gid);
        }
        if ($uids !== []) {
            foreach ($this->votes->openSessions() as $s) {
                foreach ($uids as $uid) {
                    $out['open-votes'] += count($this->votes->rows($s['id'], $this->access->pid($s['board_id'], 'u:' . $uid)));
                }
            }
        }
        return $out;
    }

    /**
     * occ knorke:orphans: counts and — unless $dryRun — reconciles every
     * orphan id at once, then drops the reconciled ids from the memo.
     * --dry-run changes nothing and neither reads nor writes the memo.
     *
     * @return array{counts: array<string, int>, failed: int} failed = ids that could not be reconciled
     */
    public function reconcile(bool $dryRun): array {
        $found = $this->scan();
        $counts = $this->count($found['users'], $found['groups']);
        if ($dryRun) {
            return ['counts' => $counts, 'failed' => 0];
        }
        $failed = $this->apply($found['users'], $found['groups']);
        $memo = $this->memo();
        $changed = false;
        foreach ([['u:', $found['users']], ['g:', $found['groups']]] as [$prefix, $ids]) {
            foreach ($ids as $id) {
                if (!isset($failed[$prefix . $id]) && isset($memo[$prefix . $id])) {
                    unset($memo[$prefix . $id]);
                    $changed = true;
                }
            }
        }
        if ($changed) {
            $this->saveMemo($memo);
        }
        return ['counts' => $counts, 'failed' => count($failed)];
    }

    /**
     * CleanupJob (after Compactor::run): the two-run rule with the job's
     * clock $nowMs. Never throws for a single id (logged).
     *
     * @return array{reconciled: int, failed: int, candidates: int} ids reconciled now, ids that failed, ids remembered for a later run
     */
    public function daily(int $nowMs): array {
        $found = $this->scan();
        $missing = [];
        foreach ($found['users'] as $u) {
            $missing['u:' . $u] = true;
        }
        foreach ($found['groups'] as $g) {
            $missing['g:' . $g] = true;
        }
        $memo = $this->memo();
        $next = [];
        $due = ['u' => [], 'g' => []];
        // Remembered ids that are still missing keep their first time; those
        // found at least GRACE_MS ago are due now.
        foreach ($memo as $id => $first) {
            if (!isset($missing[$id])) {
                continue;
            }
            if ($nowMs - $first >= self::GRACE_MS) {
                $due[$id[0]][] = substr($id, 2);
            }
            $next[$id] = $first;
        }
        $failed = $this->apply($due['u'], $due['g']);
        $reconciled = 0;
        foreach ($due as $kind => $ids) {
            foreach ($ids as $id) {
                $key = $kind . ':' . $id;
                unset($missing[$key]);
                if (!isset($failed[$key])) {
                    // Done; a failed id stays with its first time for the next run.
                    unset($next[$key]);
                    $reconciled++;
                }
            }
        }
        // New candidates (first time missing) up to MEMO_MAX, accounts first, each list sorted.
        foreach (array_keys($missing) as $id) {
            $id = (string)$id;
            if (!isset($next[$id]) && count($next) < self::MEMO_MAX) {
                $next[$id] = $nowMs;
            }
        }
        if ($next !== $memo) {
            $this->saveMemo($next);
        }
        return ['reconciled' => $reconciled, 'failed' => count($failed), 'candidates' => count($next)];
    }

    /**
     * Treats the ids like the listeners do; afterwards each id is checked:
     * rows left over (a guarded path logged a failure) count as failed.
     *
     * @param list<string> $uids
     * @param list<string> $gids
     * @return array<string, true> failed ids ("u:<uid>", "g:<gid>")
     */
    private function apply(array $uids, array $gids): array {
        $failed = [];
        foreach ($uids as $uid) {
            $ok = true;
            try {
                $this->boardService->onUserDeleted($uid);
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing account failed (boards, memberships, shares)', ['exception' => $e, 'app' => Application::APP_ID, 'uid' => $uid]);
            }
            try {
                $this->voteService->onUserDeleted($uid, fn (int $board): string => $this->access->pid($board, 'u:' . $uid));
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing account failed (votes)', ['exception' => $e, 'app' => Application::APP_ID, 'uid' => $uid]);
            }
            try {
                $this->sync->clearLocker('u:' . $uid, (int)floor(microtime(true) * 1000));
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing account failed (locks)', ['exception' => $e, 'app' => Application::APP_ID, 'uid' => $uid]);
            }
            if (!$ok || $this->leftOver([$uid], []) !== 0) {
                $failed['u:' . $uid] = true;
            }
        }
        foreach ($gids as $gid) {
            $ok = true;
            try {
                $this->shareService->onGroupDeleted($gid);
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing group failed', ['exception' => $e, 'app' => Application::APP_ID, 'gid' => $gid]);
            }
            if (!$ok || $this->leftOver([], [$gid]) !== 0) {
                $failed['g:' . $gid] = true;
            }
        }
        return $failed;
    }

    /**
     * Rows of the ids that are still there.
     *
     * @param list<string> $uids
     * @param list<string> $gids
     */
    private function leftOver(array $uids, array $gids): int {
        try {
            return array_sum($this->count($uids, $gids));
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: checking a reconciled id failed', ['exception' => $e, 'app' => Application::APP_ID]);
            return 1;
        }
    }

    /**
     * The candidate memo: id → first time missing (ms). Anything malformed
     * is dropped (an empty memo only delays a deletion by one run).
     *
     * @return array<string, int>
     */
    private function memo(): array {
        try {
            $raw = $this->appConfig->getValueString(Application::APP_ID, self::MEMO_KEY, '', lazy: true);
        } catch (\Throwable) {
            return [];
        }
        $map = $raw === '' ? null : json_decode($raw, true);
        if (!is_array($map)) {
            return [];
        }
        $out = [];
        foreach ($map as $id => $first) {
            if (is_string($id) && preg_match('/^[ug]:./s', $id) === 1 && is_int($first) && $first >= 0 && count($out) < self::MEMO_MAX) {
                $out[$id] = $first;
            }
        }
        return $out;
    }

    /** @param array<string, int> $memo */
    private function saveMemo(array $memo): void {
        if ($memo === []) {
            $this->appConfig->deleteKey(Application::APP_ID, self::MEMO_KEY);
            return;
        }
        $json = json_encode((object)$memo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        try {
            $this->appConfig->setValueString(Application::APP_ID, self::MEMO_KEY, $json, lazy: true);
        } catch (\Throwable) {
            // Stored with another type (or not lazy) by hand: replace it.
            $this->appConfig->deleteKey(Application::APP_ID, self::MEMO_KEY);
            $this->appConfig->setValueString(Application::APP_ID, self::MEMO_KEY, $json, lazy: true);
        }
    }
}
