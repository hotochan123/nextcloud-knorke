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
use OCP\IUser;
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
 *    locked_by u:<uid> of a locked item, job 152 also of a remembered lock
 *    after an unlock): BoardService::onUserDeleted (its boards deleted,
 *    memberships removed and user shares deleted, acl_gen + 1 and setGens
 *    per board), VoteService::onUserDeleted (its vote rows in open
 *    sessions, seq + 1, setVoteSeq) and SyncService::clearLocker (its name
 *    and id leave its locks, the items stay locked; rev + 1 per board,
 *    bumpRev);
 *  - an orphan gid (IGroupManager::groupExists() === false) from shares with
 *    kind 'group': ShareService::onGroupDeleted.
 *  - (job 247) an orphan uid also from pending template suggestions
 *    (TemplateStore::pendingUids), owner files of shape library folders and
 *    open shape library suggestions (ShapeLibStore::userFolders, markerUids);
 *    besides the above TemplateStore::onUserDeleted and
 *    ShapeLibStore::onUserDeleted (like UserDeletedListener);
 *  - (job 249) for every orphan uid also CommentService::onUserDeleted (its
 *    @-mentions in comments become "Deleted user"; no count, like locks);
 *  - (job 247) an orphan folder: a shape library folder without owner file
 *    (made before job 247) whose hash matches no account Nextcloud knows
 *    (IUserManager::callForAllUsers, only while such folders exist): the
 *    folder is deleted. If the listing throws or finds no account at all,
 *    no folder counts as orphan (a failing user backend never deletes the
 *    libraries of living accounts). A folder without owner file whose hash
 *    matches an account gets its owner file in a real run (never in a dry
 *    run).
 *
 * The listener rules apply (no exception escapes, one short transaction per
 * board, boards in ascending order). Votes of an orphan are found only
 * through uids of shares, memberships and owners (ED-15: a voter is an HMAC
 * pid). Teams (kind 'team') come with M2.
 *
 * Counts (before anything is deleted, each kind on its own; occ
 * knorke:orphans prints them in this order): user-shares and group-shares
 * (share rows), link-members (member rows), open-votes (vote rows of open
 * sessions), owned-boards (boards), shape-libraries (own libraries of
 * orphan uids and in orphan folders) and template-suggestions (pending rows;
 * both job 247). A user share on a board of an orphan
 * owner counts in user-shares AND its board in owned-boards. Locks have no
 * count: an orphan's locks are cleared with it (open shape library
 * suggestions likewise, with their library).
 *
 * Two ways:
 *  - reconcile() (occ knorke:orphans [--dry-run]): at once; --dry-run only
 *    counts. A real run drops the reconciled ids from the candidate memo.
 *  - daily() (CleanupJob, after the clean-up; ED-14): the two-run rule — an
 *    id missing for the first time is remembered with the job's clock
 *    (app config orphan_candidates, lazy JSON {"u:<uid>": ms, "g:<gid>": ms,
 *    "f:<folder hash>": ms},
 *    at most MEMO_MAX entries, the rest waits for the next run); it is
 *    reconciled only when a later run finds it still missing at least
 *    GRACE_MS (20 h) after the first time; an id that exists again (or has
 *    no rows any more) leaves the memo. This protects against a user
 *    backend that does not answer for a moment.
 * occ knorke:compact never reconciles; no repair step does (a failing user
 * backend would delete at once).
 */
class OrphanReconciler {
    /** The kinds, in the order of the output of occ knorke:orphans (§33.1 e; the last two job 247). */
    public const KINDS = ['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards', 'shape-libraries', 'template-suggestions'];
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
        private TemplateStore $templates,
        private ShapeLibStore $shapeLibs,
        private ?CommentService $comments = null,
    ) {
    }

    /**
     * The orphan ids now: uids from user shares, link memberships, board
     * owners, lockers (locked_by u:<uid>, M2), pending template suggestions
     * and shape libraries (owner files, open suggestions; job 247) that
     * Nextcloud does not know, gids from group shares likewise; folders =
     * hash parts of shape library folders without owner whose account is
     * gone, claims = uid of each folder without owner whose account exists
     * (folder hash → uid, for claim()).
     * Each list sorted and without duplicates.
     *
     * @return array{users: list<string>, groups: list<string>, folders: list<string>, claims: array<string, string>}
     */
    public function scan(): array {
        $lockers = array_map(static fn (string $id): string => substr($id, 2), $this->items->lockers('u:'));
        $libs = $this->shapeLibs->userFolders();
        $uids = array_merge($this->shares->recipients('user'), $this->boards->memberUids(), $this->boards->ownerUids(), $lockers,
            $this->templates->pendingUids(), $libs['owned'], $this->shapeLibs->markerUids());
        $uids = array_values(array_unique(array_map('strval', $uids)));
        sort($uids, SORT_STRING);
        $gids = array_values(array_unique(array_map('strval', $this->shares->recipients('group'))));
        sort($gids, SORT_STRING);
        $orphans = array_values(array_filter($uids, fn (string $u): bool => !$this->users->userExists($u)));
        // A folder without owner of an orphan uid found another way is that
        // uid's (counted, deleted and checked with it), never a second orphan.
        $ofOrphans = array_flip(array_map(static fn (string $u): string => ShapeLibStore::folderHash($u), $orphans));
        [$folders, $claims] = $this->unowned(array_values(array_filter($libs['unowned'], static fn (string $h): bool => !isset($ofOrphans[$h]))));
        return [
            'users' => $orphans,
            'groups' => array_values(array_filter($gids, fn (string $g): bool => !$this->groups->groupExists($g))),
            'folders' => $folders,
            'claims' => $claims,
        ];
    }

    /**
     * Folders without owner (job 247): those whose hash matches an account
     * Nextcloud lists (claims: hash → uid) and the rest (orphans, sorted).
     * A listing that throws or finds no account makes no orphan.
     *
     * @param list<string> $hashes
     * @return array{0: list<string>, 1: array<string, string>}
     */
    private function unowned(array $hashes): array {
        if ($hashes === []) {
            return [[], []];
        }
        $want = array_flip($hashes);
        $claims = [];
        $seen = 0;
        try {
            $this->users->callForAllUsers(function (IUser $u) use ($want, &$claims, &$seen): void {
                $seen++;
                $uid = $u->getUID();
                $hash = ShapeLibStore::folderHash($uid);
                if (isset($want[$hash])) {
                    $claims[$hash] = $uid;
                }
            });
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: listing the accounts for shape library folders without owner failed; none is treated as orphan', ['exception' => $e, 'app' => Application::APP_ID]);
            return [[], []];
        }
        if ($seen === 0) {
            $this->logger->warning('Knorke: listing the accounts found none; no shape library folder is treated as orphan', ['app' => Application::APP_ID]);
            return [[], []];
        }
        $orphans = array_values(array_filter($hashes, static fn (string $h): bool => !isset($claims[$h])));
        sort($orphans, SORT_STRING);
        return [$orphans, $claims];
    }

    /**
     * Writes the owner file into each folder without owner whose account
     * exists (job 247, real runs only). Never throws.
     *
     * @param array<string, string> $claims folder hash → uid
     */
    private function claim(array $claims): void {
        foreach ($claims as $uid) {
            try {
                $this->shapeLibs->claimFolder($uid);
            } catch (\Throwable $e) {
                $this->logger->error('Knorke: writing the owner of a shape library folder failed', ['exception' => $e, 'app' => Application::APP_ID]);
            }
        }
    }

    /**
     * The counts of the given orphan ids and folders (§33.1 e), read before
     * any deletion.
     *
     * @param list<string> $uids
     * @param list<string> $gids
     * @param list<string> $folders hash parts of orphan folders without owner (job 247)
     * @return array<string, int> kind → count, in the order of KINDS
     */
    public function count(array $uids, array $gids, array $folders = []): array {
        $out = array_fill_keys(self::KINDS, 0);
        foreach ($uids as $uid) {
            $out['user-shares'] += $this->shares->countRecipient('user', $uid);
            $out['link-members'] += $this->boards->countMembershipsOf($uid);
            $out['owned-boards'] += count($this->boards->boardsOwnedBy($uid));
            $out['shape-libraries'] += $this->shapeLibs->countOf($uid);
            $out['template-suggestions'] += $this->templates->pendingCount($uid);
        }
        foreach ($folders as $hash) {
            $out['shape-libraries'] += $this->shapeLibs->countFolder($hash);
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
        $counts = $this->count($found['users'], $found['groups'], $found['folders']);
        if ($dryRun) {
            return ['counts' => $counts, 'failed' => 0];
        }
        $this->claim($found['claims']);
        $failed = $this->apply($found['users'], $found['groups'], $found['folders']);
        $memo = $this->memo();
        $changed = false;
        foreach ([['u:', $found['users']], ['g:', $found['groups']], ['f:', $found['folders']]] as [$prefix, $ids]) {
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
        $this->claim($found['claims']);
        $missing = [];
        foreach ($found['users'] as $u) {
            $missing['u:' . $u] = true;
        }
        foreach ($found['groups'] as $g) {
            $missing['g:' . $g] = true;
        }
        foreach ($found['folders'] as $f) {
            $missing['f:' . $f] = true;
        }
        $memo = $this->memo();
        $next = [];
        $due = ['u' => [], 'g' => [], 'f' => []];
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
        $failed = $this->apply($due['u'], $due['g'], $due['f']);
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
     * @param list<string> $folders hash parts of orphan folders without owner (job 247)
     * @return array<string, true> failed ids ("u:<uid>", "g:<gid>", "f:<hash>")
     */
    private function apply(array $uids, array $gids, array $folders = []): array {
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
            try {
                $this->templates->onUserDeleted($uid);
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing account failed (template suggestions)', ['exception' => $e, 'app' => Application::APP_ID, 'uid' => $uid]);
            }
            try {
                $this->shapeLibs->onUserDeleted($uid);
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing account failed (shape libraries)', ['exception' => $e, 'app' => Application::APP_ID, 'uid' => $uid]);
            }
            try {
                $this->comments?->onUserDeleted($uid);
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: reconciling a missing account failed (comment mentions)', ['exception' => $e, 'app' => Application::APP_ID, 'uid' => $uid]);
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
        foreach ($folders as $hash) {
            $ok = true;
            try {
                $this->shapeLibs->deleteFolder($hash);
            } catch (\Throwable $e) {
                $ok = false;
                $this->logger->error('Knorke: deleting a shape library folder of a missing account failed', ['exception' => $e, 'app' => Application::APP_ID]);
            }
            if (!$ok || $this->leftOver([], [], [$hash]) !== 0) {
                $failed['f:' . $hash] = true;
            }
        }
        return $failed;
    }

    /**
     * Rows of the ids that are still there (job 247: also open shape library
     * suggestions and folders of the uids and the orphan folders themselves).
     *
     * @param list<string> $uids
     * @param list<string> $gids
     * @param list<string> $folders
     */
    private function leftOver(array $uids, array $gids, array $folders = []): int {
        try {
            $n = array_sum($this->count($uids, $gids, $folders));
            foreach ($uids as $uid) {
                $n += $this->shapeLibs->markerCount($uid) + ($this->shapeLibs->folderExists(ShapeLibStore::folderHash($uid)) ? 1 : 0);
            }
            foreach ($folders as $hash) {
                $n += $this->shapeLibs->folderExists($hash) ? 1 : 0;
            }
            return $n;
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
            if (is_string($id) && preg_match('/^[ugf]:./s', $id) === 1 && is_int($first) && $first >= 0 && count($out) < self::MEMO_MAX) {
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
