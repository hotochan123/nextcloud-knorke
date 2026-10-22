<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\Security\ISecureRandom;
use Psr\Log\LoggerInterface;

/**
 * Board administration (SPEC-M0 §4.3, §4.10.4; SPEC-M1 §4.10.4, §4.11):
 * list, create, rename, delete, the two links (edit and vote, one
 * generation each) and joining them as an account, account deletion.
 *
 * Every administration transaction locks the board row FIRST (lockBoard),
 * then checks. Revocations bump acl_gen (grants die) and, for links, the
 * generation of THAT link role (link_gen for edit, vote_link_gen for vote:
 * guest tokens of that role die); after COMMIT setGens() makes them
 * effective at once — if that Redis write fails, within 120 s (TTL of a:).
 *
 * Board object (SPEC-M1 §4.10.4):
 *   {"id": 7, "title": "…", "role": "owner"|"edit"|"vote"|"view", "updatedAt": ms,
 *    "owner": {"uid": "alice", "name": "Alice Adler"}, "viaLink": false,
 *    "linksAllowed": true, "source": "own"|"share"|"link", "mod": bool}
 *
 * Link object (SPEC-M1 §4.4):
 *   {"token", "role": "edit"|"vote", "url", "password": bool, "expiresAt": ms|null,
 *    "expiresOn": "YYYY-MM-DD"|null}   (expiresOn: the day in the OWNER's zone)
 * url (P7, SPEC-M1 §33.1 h): with a valid app config public_url (an origin
 * http(s)://host[:port] with at most one trailing "/") rtrim(public_url,
 * "/") + linkToRoute(…) — the same path linkToRouteAbsolute puts after the
 * origin; unset, empty or invalid → linkToRouteAbsolute (the host of the
 * request; an invalid value logs at most one warning per PHP process).
 * overwrite.cli.url is never used.
 *
 * Link changes (SPEC-M1 §4.11.2, R2/R13): owner only (member 403, stranger
 * 404); creating, renewing and loosening need Nextcloud's permission to
 * share (403 sharing_disabled), tightening and DELETE do not; then
 * links_disabled; then — outside the lock — password policy and hash, the
 * expiry day; under the lock the decision on the CURRENT row: create, renew
 * (rotate or an expired row: old row revoked, its members deleted, the
 * role's generation + 1, password and a future expiry carried over), or
 * change (password set → members of the link deleted, acl + role generation
 * + 1; expiry earlier → acl + role generation + 1; loosening bumps nothing);
 * the enforcement rules apply to the result. A POST without password,
 * expiresAt and rotate on an active row returns it unchanged (SRV-12).
 *
 * Rename runs through the meta write path (MetaService, SPEC-M1 §4.13.4);
 * its answer adds "meta" and "metaRev" of that write (SPEC-M1 §15).
 *
 * Legacy MySQL/MariaDB without 4-byte UTF-8 (mysql.utf8mb4 = false): a
 * title's code points above U+FFFF become U+FFFD (Input::bmp).
 */
class BoardService {
    use TTransactional;

    /** App config key of the public origin of link URLs (P7, SPEC-M1 §33.1 a/h; not a limit). */
    public const KEY_PUBLIC_URL = 'public_url';
    /** http(s)://host[:port] and at most one trailing "/"; host = name, IPv4 or [IPv6] (§33.1 a). */
    private const PUBLIC_URL_RE = '~^(https?)://(\[[0-9A-Fa-f:.]{2,45}\]|[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?)*)(?::([0-9]{1,5}))?/?\z~i';

    /** @var array<string, string> display names of this request */
    private array $names = [];
    /** At most one warning about an invalid public_url per PHP process (§33.1 a). */
    private static bool $publicUrlWarned = false;

    public function __construct(
        private BoardStore $boards,
        private FastCache $cache,
        private IUserManager $users,
        private IURLGenerator $urls,
        private ISecureRandom $random,
        private LinkThrottle $throttle,
        private IRequest $request,
        private Limits $limits,
        private ITimeFactory $time,
        private IDBConnection $db,
        private LinkPolicy $policy,
        private MetaService $meta,
        private ShareService $shares,
        private SharePolicy $sharePolicy,
        private LinkSecrets $secrets,
        private Access $access,
        private IAppConfig $appConfig,
        private LoggerInterface $logger,
    ) {
    }

    /**
     * The board list (SPEC-M1 §4.10.4): own boards, valid link memberships
     * (link policy of the owner), shares to the user, its groups and its
     * teams; with the effective role, its source and mod. pin() runs BEFORE
     * the groups and teams are read (a lagging replica must not re-seed a
     * revoked share).
     *
     * @return list<array> board objects, newest first
     */
    public function listFor(string $uid): array {
        $user = $this->users->get($uid);
        $this->boards->pin();
        $rows = $this->boards->listForUser($uid, $user === null ? [] : $this->sharePolicy->groupIdsOf($user),
            $user === null ? [] : $this->sharePolicy->teamsOf($user), $this->nowMs());
        $out = [];
        foreach ($rows as $row) {
            [$role, $origin, $facilitator] = $this->rowRole($row, $uid);
            if ($role !== null) {
                $out[] = $this->boardObject($row, $uid, $role, $origin, $facilitator);
            }
        }
        return $out;
    }

    /** Nextcloud's link policy for the board owner $owner (§4.9.7). */
    public function linksAllowed(string $owner): bool {
        return $this->policy->allows($owner);
    }

    /**
     * Today ("YYYY-MM-DD") in the zone of the board owner $ownerUid (SPEC-M1
     * §4.10.1, R14-04): linkPolicy.today of routes 19/20, the same day
     * enableLink uses for expiry_past, expiry_too_far and the default expiry.
     */
    public function linkToday(string $ownerUid): string {
        return $this->secrets->today($ownerUid, $this->nowMs());
    }

    /** @throws HttpError 400 title_required|bad_request, 429 rate_limited (board limit) */
    public function create(string $uid, string $title): array {
        $title = $this->title($title);
        if ($this->boards->countOwned($uid) >= $this->limits->maxBoardsPerOwner()) {
            throw new HttpError(429, 'rate_limited', 'You have reached the maximum number of boards.');
        }
        $id = $this->boards->createBoard($uid, $title, $this->nowMs());
        $row = $this->boards->findBoardForUser($id, $uid, $this->nowMs()) ?? throw new HttpError(500, 'internal');
        return $this->boardObject($row, $uid, Role::Owner, 'owner', false);
    }

    /**
     * Owner only: member → 403 forbidden, stranger → 404. Through MetaService
     * (lock first, rev + 1, meta_rev = rev, bumpRev after COMMIT): the title
     * changes live for every open client.
     *
     * The answer is the board object plus `meta` and `metaRev` of this write
     * (SPEC-M1 §15, R4; additive). `title`, `meta` and `metaRev` all come
     * from the one MetaService::write, never from the later re-read of the
     * row. `meta` is a JSON object on the wire, also when empty ({}).
     *
     * @return array the board object + {meta: object, metaRev: int}
     */
    public function rename(string $uid, int $board, string $title): array {
        $this->requireOwner($uid, $board);
        $title = $this->title($title);
        $written = $this->meta->write($board, static fn (array $meta): array => $meta, $this->nowMs(), $title);
        $row = $this->boards->findBoardForUser($board, $uid, $this->nowMs()) ?? throw new HttpError(404, 'not_found');
        $out = $this->boardObject($row, $uid, Role::Owner, 'owner', false);
        $out['title'] = $written['title'];
        $out['meta'] = MetaService::object($written['meta']);
        $out['metaRev'] = $written['metaRev'];
        return $out;
    }

    /**
     * Owner only. In one transaction (board row locked first, acl_gen + 1):
     * changes, items, members, shares and the board go; links are only
     * revoked and stay 30 days, so an old link answers "revoked" instead of
     * counting as a miss. After COMMIT a:<board> is marked gone.
     */
    public function delete(string $uid, int $board): void {
        $this->requireOwner($uid, $board);
        $this->deleteBoard($board, $uid);
    }

    /**
     * Routes 9 and 17 (SPEC-M1 §4.11.2): create, renew or change the link of
     * $role ('edit' | 'vote'); see the class comment for the order.
     * $body: {rotate?: bool, password?: string(1–200)|null, expiresAt?: "YYYY-MM-DD"|null}
     * (absent = unchanged).
     *
     * @return array the link object (§4.4)
     * @throws HttpError 400 bad_request|password_*|expiry_*, 403 forbidden|sharing_disabled|links_disabled, 404
     */
    public function enableLink(string $uid, int $board, string $role, #[\SensitiveParameter] array $body): array {
        if (!in_array($role, Role::LINK_ROLES, true)) {
            throw new \InvalidArgumentException('Knorke: unknown link role ' . $role);
        }
        $this->requireOwner($uid, $board);
        $owner = $this->users->get($uid) ?? throw new HttpError(404, 'not_found');

        // The body: absent = unchanged.
        $rotate = false;
        if (array_key_exists('rotate', $body) && $body['rotate'] !== null) {
            $rotate = Input::flag($body['rotate']) ?? throw new HttpError(400, 'bad_request', 'rotate must be true or false.');
        }
        $hasPassword = array_key_exists('password', $body);
        $password = $body['password'] ?? null;
        if ($hasPassword && $password !== null && (!is_string($password) || $password === '' || !mb_check_encoding($password, 'UTF-8')
            || mb_strlen($password, 'UTF-8') > LinkSecrets::PASSWORD_MAX)) {
            throw new HttpError(400, 'bad_request', 'password must be null or 1–' . LinkSecrets::PASSWORD_MAX . ' characters.');
        }
        $hasExpiry = array_key_exists('expiresAt', $body);
        $day = $body['expiresAt'] ?? null;
        if ($hasExpiry && $day !== null && !LinkSecrets::validDay($day)) {
            throw new HttpError(400, 'bad_request', 'expiresAt must be null or a calendar day YYYY-MM-DD.');
        }

        $now = $this->nowMs();
        $sharing = $this->sharePolicy->forOwner($owner)['sharing'];
        $linksAllowed = $this->policy->allows($uid, $owner);
        $active = $this->boards->activeLinkOf($board, $role);
        $expired = $active !== null && self::expired($active, $now);
        if ($active !== null && !$expired && !$rotate && !$hasPassword && !$hasExpiry) {
            // SRV-12: unchanged, without enforcement and without sharing_disabled (as M0).
            if (!$linksAllowed) {
                throw new HttpError(403, 'links_disabled');
            }
            return $this->linkObject($active, $uid);
        }
        // Step 2: creating, renewing and loosening need the permission to share.
        // R14-02: "loosens" is decided on the UNCHECKED end of the sent day
        // (end of that day in the owner's zone); expiry_past/expiry_too_far
        // are checked only in step 4, after links_disabled.
        $newExpiry = null;
        if ($hasExpiry && $day !== null) {
            $newExpiry = $this->secrets->endOfDay($uid, $day);
        }
        $renews = $active === null || $expired || $rotate;
        if (!$sharing && ($renews || self::loosens($active, $hasPassword, $password, $hasExpiry, $newExpiry))) {
            throw new HttpError(403, 'sharing_disabled');
        }
        // Step 3.
        if (!$linksAllowed) {
            throw new HttpError(403, 'links_disabled');
        }
        // Step 4, outside the lock: password policy and hash (argon2), then the
        // checking normalisation of the day (same value as above, or 400
        // expiry_past/expiry_too_far), with the link policy read here.
        $hash = $hasPassword && is_string($password) ? $this->secrets->hashChecked($password) : null;
        $policy = $this->sharePolicy->linkPolicy();
        if ($hasExpiry && $day !== null) {
            $newExpiry = $this->secrets->normalizeExpiry($uid, $day, false, $policy, $now)[0];
        }
        $token = $this->random->generate(24, ISecureRandom::CHAR_ALPHANUMERIC);

        // Step 5: under the lock, decided on the current row.
        $out = $this->atomic(function () use ($board, $uid, $role, $now, $rotate, $hasPassword, $hasExpiry, $hash, $newExpiry, $token, $policy, $sharing): array {
            $head = $this->boards->lockBoard($board, false, null, $now) ?? throw new HttpError(404, 'not_found');
            if ($head['owner'] !== $uid) {
                throw new HttpError(404, 'not_found');
            }
            $cur = $this->boards->activeLinkOf($board, $role);
            $curExpired = $cur !== null && self::expired($cur, $now);
            if ($cur !== null && !$curExpired && !$rotate && !$hasPassword && !$hasExpiry) {
                return ['row' => $head, 'link' => $cur, 'bump' => false];
            }
            $bump = false;
            if ($cur === null || $curExpired || $rotate) {
                if (!$sharing) {
                    throw new HttpError(403, 'sharing_disabled');
                }
                $renew = $cur !== null;
                $newHash = $hasPassword ? $hash : ($renew ? $cur['password_hash'] : null);
                if ($hasExpiry) {
                    $expiresAt = $newExpiry;
                } elseif ($renew && $cur['expires_at'] !== null && $cur['expires_at'] > $now) {
                    $expiresAt = $cur['expires_at'];
                } else {
                    // Creation defaults (Nextcloud): today + shareApiLinkDefaultExpireDays().
                    $expiresAt = $this->secrets->normalizeExpiry($uid, null, true, $policy, $now)[0];
                }
                $this->secrets->enforce($uid, $newHash !== null, $expiresAt, $policy, $now);
                if ($renew) {
                    $old = $this->boards->revokeLinks($board, $now, $role);
                    $this->boards->deleteMembersByLinks($board, $old);
                    $bump = true;
                }
                $this->boards->insertLink($board, $token, $role, $uid, $now, $newHash, $expiresAt);
            } else {
                if (!$sharing && self::loosens($cur, $hasPassword, $hash, $hasExpiry, $newExpiry)) {
                    throw new HttpError(403, 'sharing_disabled');
                }
                $newHash = $hasPassword ? $hash : $cur['password_hash'];
                $expiresAt = $hasExpiry ? $newExpiry : $cur['expires_at'];
                $this->secrets->enforce($uid, $newHash !== null, $expiresAt, $policy, $now);
                $this->boards->updateLinkSecrets($cur['id'], $newHash, $expiresAt);
                if ($hasPassword && $hash !== null) {
                    // Password set or changed (R13: every string counts): everybody who
                    // joined through this link has to enter it again.
                    $this->boards->deleteMembersByLinks($board, [$cur['id']]);
                    $bump = true;
                } elseif ($hasExpiry && $expiresAt !== null && ($cur['expires_at'] === null || $expiresAt < $cur['expires_at'])) {
                    // Expiry earlier: guest tokens die (they rejoin), members stay.
                    $bump = true;
                }
            }
            if ($bump) {
                $head = $this->boards->lockBoard($board, true, $role, $now) ?? throw new HttpError(404, 'not_found');
            }
            return ['row' => $head, 'link' => $this->boards->activeLinkOf($board, $role), 'bump' => $bump];
        }, $this->db);
        if ($out['bump']) {
            $b = $out['row'];
            $this->cache->setGens($board, $b['acl_gen'], $b['link_gen'], $b['min_rev'], $linksAllowed, $b['vote_link_gen']);
        }
        return $this->linkObject($out['link'] ?? throw new HttpError(500, 'internal'), $uid);
    }

    /**
     * Does a change of an active link loosen it (SPEC-M1 §4.11.2)? Password
     * removed, or the expiry removed or moved later.
     */
    private static function loosens(?array $link, bool $hasPassword, mixed $password, bool $hasExpiry, ?int $newExpiry): bool {
        if ($link === null) {
            return false;
        }
        if ($hasPassword && $password === null && $link['password_hash'] !== null) {
            return true;
        }
        if ($hasExpiry && $link['expires_at'] !== null && ($newExpiry === null || $newExpiry > $link['expires_at'])) {
            return true;
        }
        return false;
    }

    /** Has an unrevoked link run out at $nowMs (SPEC-M1 §3.3)? */
    public static function expired(array $link, int $nowMs): bool {
        return $link['expires_at'] !== null && $link['expires_at'] <= $nowMs;
    }

    /**
     * Routes 10 and 18: owner only; DELETE needs no permission to share.
     * Revokes the unrevoked link of $role (also an expired one), deletes its
     * members, acl + role generation + 1. No link → nothing.
     */
    public function disableLink(string $uid, int $board, string $role): void {
        if (!in_array($role, Role::LINK_ROLES, true)) {
            throw new \InvalidArgumentException('Knorke: unknown link role ' . $role);
        }
        $this->requireOwner($uid, $board);
        if ($this->boards->activeLinkOf($board, $role) === null) {
            return;
        }
        $now = $this->nowMs();
        $row = $this->atomic(function () use ($board, $uid, $now, $role): array {
            $row = $this->boards->lockBoard($board, true, $role, $now) ?? throw new HttpError(404, 'not_found');
            if ($row['owner'] !== $uid) {
                throw new HttpError(404, 'not_found');
            }
            $old = $this->boards->revokeLinks($board, $now, $role);
            $this->boards->deleteMembersByLinks($board, $old);
            return $row;
        }, $this->db);
        $this->cache->setGens($board, $row['acl_gen'], $row['link_gen'], $row['min_rev'], $this->policy->allows($uid), $row['vote_link_gen']);
    }

    /**
     * An account opens a link (SPEC-M1 §4.11.4, route 11): a never-issued
     * token → miss-only throttle → 404 (429 when blocked); revoked → 403
     * link_revoked; expired → 403 link_expired (neither counts as a miss);
     * links not allowed for the owner → 403 links_disabled (the owner itself
     * still gets its board); the link password unless the account is a
     * valid member of THIS link or has a share of at least the link's role.
     *
     * Under the board lock, after reading the link again: owner, or a share
     * of rank ≥ the link role → nothing written; a valid membership of rank ≥
     * the link role → nothing written; otherwise the membership is (re)placed
     * with this link and its role (a vote member becomes an editor through
     * the edit link, R2).
     */
    public function joinLinkAsUser(string $uid, #[\SensitiveParameter] string $token, #[\SensitiveParameter] ?string $password = null): int {
        $link = $this->boards->findLinkByToken($token);
        if ($link === null) {
            if ($this->throttle->missBlocked($this->request->getRemoteAddress())) {
                throw new HttpError(429, 'rate_limited');
            }
            throw new HttpError(404, 'not_found');
        }
        if ($link['revoked_at'] !== null || $link['board'] === null) {
            throw new HttpError(403, 'link_revoked');
        }
        $now = $this->nowMs();
        if (self::expired($link, $now)) {
            throw new HttpError(403, 'link_expired');
        }
        $ownerUid = (string)$link['board']['owner'];
        if ($ownerUid !== $uid && !$this->policy->allows($ownerUid)) {
            throw new HttpError(403, 'links_disabled');
        }
        $board = $link['board']['id'];
        $isOwner = $ownerUid === $uid;
        $user = $isOwner ? null : $this->users->get($uid);
        $linkRank = (Role::tryFrom($link['role']) ?? Role::Edit)->rank();
        $checked = false;
        // R14-01: the hash stored after the check (a rehash of IHasher may
        // have replaced the verified one); the lock compares the fresh row with it.
        $checkedHash = null;
        if (!$isOwner && $link['password_hash'] !== null) {
            $row = $this->boards->findBoardForUser($board, $uid, $now);
            [$shareRole] = $user === null ? [null] : $this->shares->roleFor($board, $user);
            $memberOfThis = $row !== null && $row['member_link'] === $link['id'];
            if (!$memberOfThis && ($shareRole === null || $shareRole->rank() < $linkRank)) {
                $checkedHash = $this->access->checkPassword($link, $password, $this->request->getRemoteAddress());
                $checked = true;
            }
        }
        return $this->atomic(function () use ($uid, $user, $isOwner, $token, $board, $now, $linkRank, $checked, $checkedHash): int {
            $row = $this->boards->lockBoard($board, false, null, $now) ?? throw new HttpError(404, 'not_found');
            $fresh = $this->boards->findLinkByToken($token);
            if ($fresh === null || $fresh['revoked_at'] !== null || $fresh['board_id'] !== $board) {
                throw new HttpError(403, 'link_revoked');
            }
            if (self::expired($fresh, $now)) {
                throw new HttpError(403, 'link_expired');
            }
            if ($row['owner'] === $uid || $isOwner) {
                return $board;
            }
            [$shareRole] = $user === null ? [null] : $this->shares->roleFor($board, $user);
            if ($shareRole !== null && $shareRole->rank() >= $linkRank) {
                return $board;
            }
            if ($checked && $fresh['password_hash'] !== $checkedHash) {
                // The owner changed the password while this join was checked: ask
                // again. Compared with the hash stored AFTER the check (R14-01),
                // so the check's own rehash is no change.
                throw new HttpError(403, 'password_required');
            }
            $member = $this->boards->findBoardForUser($board, $uid, $now);
            $memberRole = $member === null || $member['member_role'] === null ? null : Role::tryFrom($member['member_role']);
            if ($memberRole !== null && $memberRole->rank() >= $linkRank) {
                // Already a member with at least this role (re-join on every page load): nothing to write.
                return $board;
            }
            if ($fresh['password_hash'] !== null && !$checked && ($member === null || $member['member_link'] !== $fresh['id'])) {
                throw new HttpError(403, 'password_required');
            }
            // No row, a row whose link is gone (it grants nothing), or a lower role: replace it.
            $this->boards->deleteMember($board, $uid);
            $this->boards->addMember($board, $uid, $fresh['role'], $fresh['id'], $now);
            return $board;
        }, $this->db);
    }

    /**
     * Account deleted (UserDeletedListener): its boards are deleted, its
     * memberships removed with acl_gen + 1 per board; its share rows go
     * (ShareService::onUserDeleted, SPEC-M1 §4.13.9).
     */
    public function onUserDeleted(string $uid): void {
        foreach ($this->boards->boardsOwnedBy($uid) as $board) {
            $this->deleteBoard($board, null);
        }
        foreach ($this->boards->deleteMembershipsOf($uid) as $board) {
            $now = $this->nowMs();
            $row = $this->atomic(fn (): ?array => $this->boards->lockBoard($board, true, null, $now), $this->db);
            if ($row !== null) {
                $this->cache->setGens($board, $row['acl_gen'], $row['link_gen'], $row['min_rev'], $this->policy->allows($row['owner']), $row['vote_link_gen']);
            }
        }
        $this->shares->onUserDeleted($uid);
    }

    /**
     * The links of a board for the owner and moderators (snapshot
     * board.links, route 19): {edit: Link|null, vote: Link|null}; an expired
     * unrevoked link is shown with its date in the past.
     *
     * @return array{edit: ?array, vote: ?array}
     */
    public function links(int $board, string $ownerUid): array {
        $out = [];
        foreach (Role::LINK_ROLES as $role) {
            $l = $this->boards->activeLinkOf($board, $role);
            $out[$role] = $l === null ? null : $this->linkObject($l, $ownerUid);
        }
        return $out;
    }

    /**
     * board.linkOpenSince of the snapshot (M2 privacy notice, every role):
     * created_at (ms) of the newest link that is neither revoked nor expired
     * now, null without one (BoardStore::linkOpenSince).
     */
    public function linkOpenSince(int $board): ?int {
        return $this->boards->linkOpenSince($board, $this->nowMs());
    }

    private function deleteBoard(int $board, ?string $owner): void {
        $now = $this->nowMs();
        $this->atomic(function () use ($board, $owner, $now): void {
            $row = $this->boards->lockBoard($board, true, null, $now) ?? throw new HttpError(404, 'not_found');
            if ($owner !== null && $row['owner'] !== $owner) {
                throw new HttpError(404, 'not_found');
            }
            foreach (Role::LINK_ROLES as $role) {
                $this->boards->revokeLinks($board, $now, $role);
            }
            $this->boards->deleteBoardRows($board);
        }, $this->db);
        $this->cache->markGone($board);
    }

    /**
     * Step 1 of every link change (SPEC-M1 §4.11.2) on its own: the link
     * throttle of routes 9, 10, 17 and 18 (P7, §33.1 d) counts right after
     * it, before enableLink/disableLink (which check it again): a member
     * (403 forbidden), a stranger or an unknown board (404) spends nothing.
     *
     * @throws HttpError 403 forbidden, 404 not_found
     */
    public function requireLinkOwner(string $uid, int $board): void {
        $this->requireOwner($uid, $board);
    }

    /**
     * 404 for strangers (no ownership oracle), 403 forbidden for anybody
     * with a role on the board (link member while links are allowed, a
     * share to the user, its groups or teams).
     */
    private function requireOwner(string $uid, int $board): array {
        $row = $this->boards->findBoardForUser($board, $uid, $this->nowMs());
        if ($row === null) {
            throw new HttpError(404, 'not_found');
        }
        if ($row['owner'] === $uid) {
            return $row;
        }
        $user = $this->users->get($uid);
        if ($this->access->memberRole($board, $row, $user, $this->policy->allows((string)$row['owner']))[0] === null) {
            throw new HttpError(404, 'not_found');
        }
        throw new HttpError(403, 'forbidden');
    }

    /**
     * Effective role of a board-list row (SPEC-M1 §4.13.3): owner; else the
     * maximum of the link role (while links are allowed for the owner) and
     * the share roles of the row, share before link on a tie.
     *
     * @return array{0: ?Role, 1: string, 2: bool} [role, origin, facilitator]
     */
    private function rowRole(array $row, string $uid): array {
        if ($row['owner'] === $uid) {
            return [Role::Owner, 'owner', false];
        }
        $linkRole = $row['member_role'] === null ? null : Role::tryFrom((string)$row['member_role']);
        if ($linkRole !== null && $row['member_link'] !== null && !$this->policy->allows((string)$row['owner'])) {
            $linkRole = null;
        }
        [$shareRole, $facilitator] = ShareService::bestOf($row['share_roles'] ?? []);
        $role = Role::max($linkRole, $shareRole);
        $origin = $shareRole !== null && ($linkRole === null || $shareRole->rank() >= $linkRole->rank()) ? 'share' : 'link';
        return [$role, $origin, $facilitator && $origin === 'share'];
    }

    private function title(string $raw): string {
        $title = Input::title($raw, Limits::MAX_TITLE);
        if ($title !== null && !$this->db->supports4ByteText()) {
            $title = Input::bmp($title);
        }
        if ($title === null) {
            throw new HttpError(400, 'bad_request', 'The title must have 1–' . Limits::MAX_TITLE . ' characters and no control characters.');
        }
        if ($title === '') {
            throw new HttpError(400, 'title_required');
        }
        return $title;
    }

    private function boardObject(array $row, string $uid, Role $role, string $origin, bool $facilitator): array {
        $owner = (string)$row['owner'];
        // source and mod exactly as Principal::source()/canModerate() (§4.9).
        $source = $origin === 'owner' ? 'own' : $origin;
        return [
            'id' => (int)$row['id'],
            'title' => (string)$row['title'],
            'role' => $role->value,
            'updatedAt' => (int)$row['updated_at'],
            'owner' => ['uid' => $owner, 'name' => $this->displayName($owner)],
            'viaLink' => $source === 'link',
            'linksAllowed' => $this->policy->allows($owner),
            'source' => $source,
            'mod' => $role === Role::Owner || $facilitator,
        ];
    }

    /**
     * The link object (§4.4): expiresOn is the day of expires_at in the
     * OWNER's zone (R13 ownerZone, also when a moderator reads it).
     *
     * @param array{token: string, role: string, password_hash?: ?string, expires_at?: ?int} $link
     * @return array{token: string, role: string, url: string, password: bool, expiresAt: ?int, expiresOn: ?string}
     */
    public function linkObject(array $link, string $ownerUid): array {
        $expiresAt = $link['expires_at'] ?? null;
        return [
            'token' => $link['token'],
            'role' => $link['role'],
            'url' => $this->linkUrl($link['token']),
            'password' => ($link['password_hash'] ?? null) !== null,
            'expiresAt' => $expiresAt,
            'expiresOn' => $expiresAt === null ? null : $this->secrets->dayOf($ownerUid, $expiresAt),
        ];
    }

    /**
     * The url of a link (SPEC-M1 §33.1 h): the public origin of the app
     * config public_url plus the route path, or the request's host.
     */
    private function linkUrl(#[\SensitiveParameter] string $token): string {
        $origin = $this->publicOrigin();
        if ($origin === null) {
            return $this->urls->linkToRouteAbsolute('knorke.publicPage.show', ['token' => $token]);
        }
        return $origin . '/' . ltrim($this->urls->linkToRoute('knorke.publicPage.show', ['token' => $token]), '/');
    }

    /**
     * The valid public_url without its trailing "/", or null (unset, empty,
     * unreadable or invalid: the host of the request). An invalid value
     * logs at most one warning per PHP process, never an error of the
     * request.
     */
    private function publicOrigin(): ?string {
        try {
            $value = $this->appConfig->getValueString(Application::APP_ID, self::KEY_PUBLIC_URL, '');
        } catch (\Throwable) {
            return null;
        }
        if ($value === '') {
            return null;
        }
        if (!self::validPublicUrl($value)) {
            if (!self::$publicUrlWarned) {
                self::$publicUrlWarned = true;
                $this->logger->warning('Knorke: the app config public_url is not an origin like https://cloud.example.org and is ignored; links use the host of the request.', ['app' => Application::APP_ID]);
            }
            return null;
        }
        return rtrim($value, '/');
    }

    /**
     * An absolute origin (§33.1 a): scheme http or https, a host (name, IPv4
     * or IPv6 in brackets), optionally :port (1–65535), optionally exactly
     * one trailing "/"; no path, query, fragment or credentials.
     */
    public static function validPublicUrl(string $value): bool {
        if (strlen($value) > 2048 || preg_match(self::PUBLIC_URL_RE, $value, $m) !== 1) {
            return false;
        }
        if ($m[2][0] === '[' && filter_var(substr($m[2], 1, -1), FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            return false;
        }
        if (isset($m[3]) && $m[3] !== '' && ((int)$m[3] < 1 || (int)$m[3] > 65535)) {
            return false;
        }
        return true;
    }

    private function displayName(string $uid): string {
        return $this->names[$uid] ??= ($this->users->getDisplayName($uid) ?? $uid);
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
