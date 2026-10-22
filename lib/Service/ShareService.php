<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\BackgroundJob\AclBumpJob;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Notification\ShareNotifications;
use OCP\App\IAppManager;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Collaboration\Collaborators\ISearch;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use OCP\Share\IShare;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Explicit shares of a board (SPEC-M1 §4.9, §4.10, §4.13.1, §4.13.9).
 *
 *  - roleFor(): the share role of a user on a board — the maximum over the
 *    rows for the user, its groups and its teams (moderate → edit plus the
 *    facilitator flag). The ONE rights check later providers reuse (§1.2).
 *  - list()/save(): the share dialog of the owner (§4.10.1/§4.10.2): save
 *    takes the complete wanted list, counts and charges new recipients
 *    BEFORE resolving them (R13 order (a)–(e)), resolves and canonicalises
 *    outside the board lock, writes a diff under it, acl_gen + 1 on every
 *    change, setGens after COMMIT.
 *  - sharees(): the recipient search through Nextcloud's ISearch (its
 *    enumeration rules), users/groups/teams only (§4.10.3).
 *  - list() and sharees() mark an account that cannot open Knorke with
 *    appAccess: false (job 079): the checks of Notifier::prepare(), so
 *    exactly the accounts whose share notification would be dropped. A
 *    hint only: saving stays allowed, nothing else changes.
 *  - on*(): the event side (§4.13.9): never throw (warnings are logged),
 *    one short transaction per board in ascending id order, more than 50
 *    boards go to AclBumpJob (board-id lists of ≤ 500).
 */
class ShareService {
    use TTransactional;

    /** Share kinds in the order of the share list (§4.10.1). */
    private const KIND_ORDER = ['user' => 0, 'group' => 1, 'team' => 2];
    /** More affected boards than this → AclBumpJob (§4.13.9). */
    public const INLINE_BUMPS = 50;
    /** Board ids per AclBumpJob argument. */
    public const JOB_CHUNK = 500;
    /** knorke-share-new: new recipients per owner and 600 s (§4.1 route 20). */
    public const SHARE_NEW_LIMIT = 60;
    public const SHARE_NEW_PERIOD = 600;
    /** Recipients per search (§4.10.3 step 5). */
    public const SEARCH_LIMIT = 25;

    private ?ISearch $search = null;
    private ?ShareNotifications $notifications = null;
    private ?IAppManager $apps = null;
    private ?GuestsAppWhitelist $guestsApp = null;

    public function __construct(
        private ShareStore $store,
        private BoardStore $boards,
        private SharePolicy $policy,
        private LinkPolicy $linkPolicy,
        private FastCache $cache,
        private IUserManager $users,
        private IDBConnection $db,
        private ILimiter $limiter,
        private IConfig $config,
        private IJobList $jobs,
        private ContainerInterface $container,
        private ITimeFactory $time,
        private LoggerInterface $logger,
    ) {
    }

    // ── Rights ─────────────────────────────────────────────────────────────

    /**
     * [share role, facilitator] of $user on $board (SPEC-M1 §4.13.1, §9.7):
     * one query on the board's share rows (primary); the user's groups only
     * when there are group rows, its teams only when there are team rows
     * and team support (getTeamsForUser may write the user's single circle).
     * Unknown stored roles grant nothing. Roles from shares are not checked
     * against the current sharing policy (as Nextcloud's file shares).
     *
     * @return array{0: ?Role, 1: bool}
     */
    public function roleFor(int $board, IUser $user): array {
        $rows = $this->store->forBoard($board);
        if ($rows === []) {
            return [null, false];
        }
        return self::bestOf(array_column(array_filter($rows, fn (array $r): bool => $this->applies($r, $user)), 'role'));
    }

    /**
     * [highest role, any moderate] of a list of share roles.
     *
     * @param list<string> $shareRoles
     * @return array{0: ?Role, 1: bool}
     */
    public static function bestOf(array $shareRoles): array {
        $best = null;
        $facilitator = false;
        foreach ($shareRoles as $r) {
            [$role, $f] = Role::fromShare((string)$r);
            if ($role === null) {
                continue;
            }
            $best = Role::max($best, $role);
            $facilitator = $facilitator || $f;
        }
        return [$best, $facilitator];
    }

    /**
     * Board ids shared with the user directly, through a group or a team.
     *
     * @return list<int>
     */
    public function boardIdsFor(IUser $user): array {
        $ids = array_merge(
            $this->store->boardsFor('user', [$user->getUID()]),
            $this->store->boardsFor('group', $this->policy->groupIdsOf($user)),
            $this->store->boardsFor('team', $this->policy->teamsOf($user)),
        );
        $ids = array_values(array_unique($ids));
        sort($ids);
        return $ids;
    }

    private function applies(array $row, IUser $user): bool {
        return match ($row['kind']) {
            'user' => $row['recipient'] === $user->getUID(),
            'group' => in_array($row['recipient'], $this->policy->groupIdsOf($user), true),
            'team' => in_array($row['recipient'], $this->policy->teamsOf($user), true),
            default => false,
        };
    }

    // ── Share dialog (owner) ────────────────────────────────────────────────

    /**
     * {shares, policy} of SPEC-M1 §4.10.1; the controller adds links,
     * linksAllowed and linkPolicy. Names live (user/group display name, team
     * name among the owner's teams), else the stored display_name.
     * available: false only when the share surely grants nothing (group
     * gone; teams without team support). appAccess: false (the last key,
     * only then) on the row of an existing account that cannot open Knorke
     * (appAccess()); group and team rows never carry it. Asked on every
     * call, never kept.
     *
     * @return array{shares: list<array{kind: string, id: string, name: string, role: string, available: bool, appAccess?: false}>,
     *   policy: array{sharing: bool, groups: bool, teams: bool, groupMembersOnly: bool}}
     */
    public function list(string $ownerUid, int $board): array {
        $owner = $this->users->get($ownerUid) ?? throw new HttpError(404, 'not_found');
        $policy = $this->policy->forOwner($owner);
        $out = [];
        foreach ($this->store->forBoard($board) as $r) {
            $live = $this->policy->displayName($owner, $r['kind'], $r['recipient']);
            $available = match ($r['kind']) {
                'group' => $this->policy->groupExists($r['recipient']),
                'team' => $policy['teams'],
                default => true,
            };
            $row = [
                'kind' => $r['kind'],
                'id' => $r['recipient'],
                'name' => $live ?? $r['display_name'] ?? $r['recipient'],
                'role' => $r['role'],
                'available' => $available,
            ];
            if ($r['kind'] === 'user') {
                $user = $this->users->get($r['recipient']);
                if ($user !== null && !$this->appAccess($user)) {
                    $row['appAccess'] = false;
                }
            }
            $out[] = $row;
        }
        usort($out, static fn (array $a, array $b): int => [self::KIND_ORDER[$a['kind']] ?? 9, mb_strtolower($a['name']), $a['id']]
            <=> [self::KIND_ORDER[$b['kind']] ?? 9, mb_strtolower($b['name']), $b['id']]);
        return ['shares' => $out, 'policy' => $policy];
    }

    /**
     * PUT shares (SPEC-M1 §4.10.2): $shares is the complete wanted list.
     * The caller checked the owner and charged knorke-share.
     *
     * Order (R13): 1 form (incl. utf8mb3 pre-check); 2 (a) pin + stored
     * rows, (b) provisionally new = (kind, id) byte-exactly missing,
     * (c) > MAX_NEW_SHARES → too_many_new_shares, (d) knorke-share-new per
     * provisionally new entry BEFORE any resolution (stays charged),
     * (e) policy, resolve + canonicalise new entries and raises, the rules
     * of step 4 (first violation wins), duplicates after canonicalisation;
     * 3 under the board lock the stored rows again, the final diff (a late
     * new entry or raise is checked here), write, acl_gen + 1; setGens
     * after COMMIT, then the notifications for the inserted rows (M2,
     * ShareNotifications; a failure there is only logged). Answer like GET
     * (list()).
     *
     * @param array $shares raw `shares` of the body
     * @throws HttpError 400 bad_request|too_many_shares|too_many_new_shares|<rule> (at), 403 sharing_disabled (at), 429 slow_down
     */
    public function save(string $ownerUid, int $board, array $shares): array {
        $owner = $this->users->get($ownerUid) ?? throw new HttpError(404, 'not_found');
        // 1. Form.
        if (!array_is_list($shares)) {
            throw new HttpError(400, 'bad_request', 'shares must be a list.');
        }
        if (count($shares) > Limits::MAX_SHARES) {
            throw new HttpError(400, 'too_many_shares', '', ['at' => Limits::MAX_SHARES, 'max' => Limits::MAX_SHARES]);
        }
        $fourByte = $this->db->supports4ByteText();
        $sent = [];
        $seen = [];
        foreach ($shares as $i => $e) {
            $entry = self::entry($e);
            if ($entry === null) {
                throw new HttpError(400, 'bad_request', 'Each share needs exactly kind, id and role.', ['at' => $i]);
            }
            $key = $entry['kind'] . "\0" . $entry['id'];
            if (isset($seen[$key])) {
                throw new HttpError(400, 'bad_request', 'A recipient is listed twice.', ['at' => $i]);
            }
            $seen[$key] = true;
            if (!$fourByte && preg_match('/[\xF0-\xF4]/', $entry['id']) === 1) {
                // SPEC-M1 §3.9 (R2): never reaches Nextcloud's user/group queries (SQLSTATE 1366).
                throw new HttpError(400, 'recipient_not_found', '', ['at' => $i]);
            }
            $sent[] = $entry + ['at' => $i];
        }

        // 2 (a) the stored rows, from the primary.
        $stored = self::byKey($this->store->forBoard($board));
        // 2 (b) provisionally new: byte-exactly missing, before any canonicalisation.
        $new = [];
        foreach ($sent as $j => $e) {
            if (!isset($stored[$e['kind'] . "\0" . $e['id']])) {
                $new[] = $j;
            }
        }
        // 2 (c) the cap, before anything is resolved or charged.
        if (count($new) > Limits::MAX_NEW_SHARES) {
            throw new HttpError(400, 'too_many_new_shares', '', ['at' => $sent[$new[Limits::MAX_NEW_SHARES]]['at'], 'max' => Limits::MAX_NEW_SHARES]);
        }
        // 2 (d) one charge per provisionally new entry, in list order, before any resolution.
        foreach ($new as $_) {
            try {
                $this->limiter->registerUserRequest('knorke-share-new', self::SHARE_NEW_LIMIT, self::SHARE_NEW_PERIOD, $owner);
            } catch (IRateLimitExceededException) {
                throw new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil(self::SHARE_NEW_PERIOD * 1000 / self::SHARE_NEW_LIMIT)]);
            }
        }
        // 2 (e) policy, resolve and canonicalise, rules, duplicates after canonicalisation.
        $isNew = array_fill_keys($new, true);
        $desired = [];
        foreach ($sent as $j => $e) {
            if (isset($isNew[$j])) {
                self::fail($this->policy->checkNew($owner, $e['kind'], $e['id']), $e['at']);
                $canon = $this->policy->canonical($owner, $e['kind'], $e['id']) ?? throw new HttpError(400, 'recipient_not_found', '', ['at' => $e['at']]);
                $name = $this->policy->displayName($owner, $e['kind'], $canon);
            } else {
                $row = $stored[$e['kind'] . "\0" . $e['id']];
                if (Role::shareRank($e['role']) > Role::shareRank($row['role'])) {
                    self::fail($this->policy->checkRaise($owner, $e['kind']), $e['at']);
                }
                $canon = $row['recipient'];
                $name = $row['display_name'];
            }
            $key = $e['kind'] . "\0" . $canon;
            if (isset($desired[$key])) {
                throw new HttpError(400, 'bad_request', 'A recipient is listed twice.', ['at' => $e['at']]);
            }
            $desired[$key] = ['kind' => $e['kind'], 'recipient' => $canon, 'role' => $e['role'],
                'display_name' => self::storedName($name, $fourByte), 'at' => $e['at'], 'checkedNew' => isset($isNew[$j])];
        }

        // 3. Under the board lock: the final diff against the rows as they are now.
        $now = $this->nowMs();
        $inserted = [];
        $row = $this->atomic(function () use ($board, $ownerUid, $owner, $desired, $now, $fourByte, &$inserted): ?array {
            $head = $this->boards->lockBoard($board, false, null, $now) ?? throw new HttpError(404, 'not_found');
            if ($head['owner'] !== $ownerUid) {
                throw new HttpError(404, 'not_found');
            }
            $current = self::byKey($this->store->forBoard($board));
            $insert = $update = $delete = [];
            foreach ($desired as $key => $d) {
                $cur = $current[$key] ?? null;
                if ($cur === null) {
                    if (!$d['checkedNew']) {
                        // Stored before, gone now (a second tab of the owner): new after all.
                        self::fail($this->policy->checkNew($owner, $d['kind'], $d['recipient']), $d['at']);
                        $d['display_name'] ??= self::storedName($this->policy->displayName($owner, $d['kind'], $d['recipient']), $fourByte);
                    }
                    $insert[] = ['kind' => $d['kind'], 'recipient' => $d['recipient'], 'role' => $d['role'], 'display_name' => $d['display_name']];
                } elseif ($cur['role'] !== $d['role']) {
                    if (!$d['checkedNew'] && Role::shareRank($d['role']) > Role::shareRank($cur['role'])) {
                        self::fail($this->policy->checkRaise($owner, $d['kind']), $d['at']);
                    }
                    $update[] = ['id' => $cur['id'], 'role' => $d['role']];
                }
            }
            foreach ($current as $key => $cur) {
                if (!isset($desired[$key])) {
                    $delete[] = $cur['id'];
                }
            }
            if ($insert === [] && $update === [] && $delete === []) {
                return null;
            }
            $this->store->apply($board, $insert, $update, $delete, $ownerUid, $now);
            $inserted = array_map(static fn (array $i): array => ['kind' => $i['kind'], 'recipient' => $i['recipient']], $insert);
            // Every change bumps acl_gen (adding and raising included: effective at once, §4.10.2 step 5).
            return $this->boards->lockBoard($board, true, null, $now);
        }, $this->db);
        if ($row !== null) {
            $this->cache->setGens($board, $row['acl_gen'], $row['link_gen'], $row['min_rev'], $this->linkPolicy->allows($ownerUid, $owner), $row['vote_link_gen']);
            if ($inserted !== []) {
                // "Board shared with you" (M2): new rows only, after COMMIT; never fails the PUT.
                try {
                    $this->notifications()->sharesAdded($board, $ownerUid, $inserted);
                } catch (\Throwable $e) {
                    $this->logger->warning('Knorke: share notification failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
                }
            }
        }
        return $this->list($ownerUid, $board);
    }

    /**
     * One sent share entry: exactly kind, id, role; kind a known kind, id
     * 1–64 characters of valid UTF-8 without control characters, role a
     * share role. null = malformed.
     *
     * @return array{kind: string, id: string, role: string}|null
     */
    private static function entry(mixed $e): ?array {
        if (!is_array($e) || count($e) !== 3 || array_is_list($e)) {
            return null;
        }
        $keys = array_keys($e);
        sort($keys);
        if ($keys !== ['id', 'kind', 'role']) {
            return null;
        }
        [$kind, $id, $role] = [$e['kind'], $e['id'], $e['role']];
        if (!is_string($kind) || !in_array($kind, ShareStore::KINDS, true) || !is_string($role) || !in_array($role, Role::SHARE_ROLES, true)) {
            return null;
        }
        if (!is_string($id) || $id === '' || !mb_check_encoding($id, 'UTF-8') || mb_strlen($id, 'UTF-8') > 64
            || strlen($id) > 255 || preg_match('/\p{Cc}/u', $id) === 1) {
            return null;
        }
        return ['kind' => $kind, 'id' => $id, 'role' => $role];
    }

    /** @throws HttpError the rule's code with `at` (sharing_disabled 403, else 400) */
    private static function fail(?string $code, int $at): void {
        if ($code !== null) {
            throw new HttpError($code === 'sharing_disabled' ? 403 : 400, $code, '', ['at' => $at]);
        }
    }

    /** display_name as stored: ≤ 255 characters, U+FFFD for 4-byte characters on utf8mb3 (§3.9). */
    private static function storedName(?string $name, bool $fourByte): ?string {
        if ($name === null || $name === '' || !mb_check_encoding($name, 'UTF-8')) {
            return null;
        }
        $name = mb_substr($name, 0, 255, 'UTF-8');
        return $fourByte ? $name : Input::bmp($name);
    }

    /** @return array<string, array> "kind\0recipient" → row */
    private static function byKey(array $rows): array {
        $out = [];
        foreach ($rows as $r) {
            $out[$r['kind'] . "\0" . $r['recipient']] = $r;
        }
        return $out;
    }

    // ── Recipient search (owner) ────────────────────────────────────────────

    /**
     * GET sharees (SPEC-M1 §4.10.3, steps 2–7): Nextcloud's ISearch with
     * users, groups (if allowed) and teams (with team support) — never mail,
     * remote or remote groups — and its enumeration rules. exact before
     * wide; without the owner, disabled users, entries without
     * value.shareWith, and teams the owner is not a member of (R13: hidden
     * circles); never a Circle object. A user hit that cannot open Knorke
     * (appAccess()) carries appAccess: false after sub, only then.
     *
     * @return array{sharees: list<array{kind: string, id: string, name: string, sub?: string, appAccess?: false}>, more: bool}
     */
    public function sharees(string $ownerUid, int $board, string $q): array {
        $empty = ['sharees' => [], 'more' => false];
        $owner = $this->users->get($ownerUid);
        if ($owner === null) {
            return $empty;
        }
        $policy = $this->policy->forOwner($owner);
        if (!$policy['sharing']) {
            return $empty;
        }
        if (!mb_check_encoding($q, 'UTF-8')
            || mb_strlen(trim($q), 'UTF-8') < $this->config->getSystemValueInt('sharing.minSearchStringLength', 0)) {
            return $empty;
        }
        if (!$this->db->supports4ByteText() && preg_match('/[\xF0-\xF4]/', $q) === 1) {
            return $empty;
        }
        $types = [IShare::TYPE_USER];
        if ($policy['groups']) {
            $types[] = IShare::TYPE_GROUP;
        }
        if ($policy['teams']) {
            $types[] = IShare::TYPE_CIRCLE;
        }
        $max = $this->config->getSystemValueInt('sharing.maxAutocompleteResults', self::SEARCH_LIMIT);
        $limit = $max > 0 ? min(self::SEARCH_LIMIT, $max) : self::SEARCH_LIMIT;
        [$result, $more] = $this->search()->search($q, $types, false, $limit, 0);
        $teams = $policy['teams'] ? $this->policy->teamsOf($owner) : [];
        $out = [];
        $seen = [];
        foreach (['users' => 'user', 'groups' => 'group', 'circles' => 'team'] as $label => $kind) {
            foreach ([$result['exact'][$label] ?? [], $result[$label] ?? []] as $set) {
                foreach (is_array($set) ? $set : [] as $hit) {
                    $id = $hit['value']['shareWith'] ?? null;
                    if (!is_string($id) || $id === '' || isset($seen[$kind . "\0" . $id])) {
                        continue;
                    }
                    if ($kind === 'user') {
                        $user = $this->users->get($id);
                        if ($user === null || !$user->isEnabled() || $user->getUID() === $ownerUid) {
                            continue;
                        }
                    }
                    if ($kind === 'team' && !in_array($id, $teams, true)) {
                        continue;
                    }
                    $seen[$kind . "\0" . $id] = true;
                    $name = is_string($hit['label'] ?? null) && $hit['label'] !== '' ? $hit['label'] : $id;
                    $entry = ['kind' => $kind, 'id' => $id, 'name' => $name];
                    if ($kind === 'user') {
                        $sub = $hit['shareWithDisplayNameUnique'] ?? null;
                        $entry['sub'] = is_string($sub) && $sub !== '' ? $sub : $id;
                        if (!$this->appAccess($user)) {
                            $entry['appAccess'] = false;
                        }
                    }
                    $out[] = $entry;
                }
            }
        }
        return ['sharees' => $out, 'more' => (bool)$more];
    }

    private function search(): ISearch {
        return $this->search ??= $this->container->get(ISearch::class);
    }

    /** Lazily: the /sync path builds ShareService through Access and never needs it. */
    private function notifications(): ShareNotifications {
        return $this->notifications ??= $this->container->get(ShareNotifications::class);
    }

    /**
     * Can $user open Knorke? The checks of Notifier::prepare() in its order:
     * app access (Knorke's "Limit to groups"), then the Guests app's
     * whitelist, asked only when the first passes. Fails closed like there:
     * a missing or failing Guests app is false. Both services come lazily
     * from the container (never on the /sync path) and are kept; the answer
     * never is.
     */
    private function appAccess(IUser $user): bool {
        return ($this->apps ??= $this->container->get(IAppManager::class))->isEnabledForUser(Application::APP_ID, $user)
            && ($this->guestsApp ??= $this->container->get(GuestsAppWhitelist::class))->allows($user);
    }

    // ── Events (§4.13.9) ────────────────────────────────────────────────────

    /** GroupDeletedEvent: delete the group's rows, then bump their boards. Never throws. */
    public function onGroupDeleted(string $gid): void {
        $this->guarded('group deleted', fn () => $this->bumpBoards($this->store->deleteRecipient('group', $gid)));
    }

    /** UserRemovedEvent: bump the boards shared with the group. Never throws. */
    public function onUserRemovedFromGroup(string $gid): void {
        $this->guarded('user removed from group', fn () => $this->bumpBoards($this->store->boardsFor('group', [$gid])));
    }

    /**
     * Circles: a membership of the team $singleId ended (bump its boards),
     * or the team was destroyed (delete its rows first). Never throws.
     */
    public function onTeamChanged(string $singleId, bool $destroyed): void {
        if ($destroyed) {
            $this->guarded('team destroyed', fn () => $this->bumpBoards($this->store->deleteRecipient('team', $singleId)));
            return;
        }
        $this->onTeamsChanged([$singleId]);
    }

    /**
     * Memberships of several teams ended (one MembershipsRemovedEvent): the
     * boards of all of them, each bumped once. Never throws.
     *
     * @param list<string> $singleIds
     */
    public function onTeamsChanged(array $singleIds): void {
        $this->guarded('team memberships removed', fn () => $this->bumpBoards($this->store->boardsFor('team', array_values(array_unique($singleIds)))));
    }

    /** UserDeletedEvent: the user's share rows go, their boards are bumped. Never throws. */
    public function onUserDeleted(string $uid): void {
        $this->guarded('user deleted', fn () => $this->bumpBoards($this->store->deleteRecipient('user', $uid)));
    }

    /**
     * acl_gen + 1 per board (SPEC-M1 §4.13.9 rule (b)): one short
     * transaction each, ascending ids, setGens after each COMMIT. More than
     * INLINE_BUMPS boards → AclBumpJob with lists of ≤ JOB_CHUNK ids. A
     * failing board is logged and skipped.
     *
     * @param list<int> $boardIds
     */
    public function bumpBoards(array $boardIds): void {
        $ids = array_values(array_unique(array_map('intval', $boardIds)));
        sort($ids);
        if (count($ids) > self::INLINE_BUMPS) {
            foreach (array_chunk($ids, self::JOB_CHUNK) as $chunk) {
                $this->jobs->add(AclBumpJob::class, ['boards' => $chunk]);
            }
            return;
        }
        $this->bumpNow($ids);
    }

    /**
     * The bumps themselves (AclBumpJob calls this, too).
     *
     * @param list<int> $boardIds
     */
    public function bumpNow(array $boardIds): int {
        $ids = array_values(array_unique(array_map('intval', $boardIds)));
        sort($ids);
        $n = 0;
        foreach ($ids as $b) {
            try {
                $now = $this->nowMs();
                $row = $this->atomic(fn (): ?array => $this->boards->lockBoard($b, true, null, $now), $this->db);
                if ($row !== null) {
                    $this->cache->setGens($b, $row['acl_gen'], $row['link_gen'], $row['min_rev'], $this->linkPolicy->allows((string)$row['owner']), $row['vote_link_gen']);
                    $n++;
                }
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: acl bump of a board failed', ['exception' => $e, 'app' => 'knorke', 'board' => $b]);
            }
        }
        return $n;
    }

    private function guarded(string $what, callable $fn): void {
        try {
            $fn();
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: ' . $what . ': rights invalidation failed', ['exception' => $e, 'app' => 'knorke']);
        }
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
