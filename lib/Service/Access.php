<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Security\ISecureRandom;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;

/**
 * Rights checks with the Redis fast path (SPEC-M0 §5.2, §4.9).
 *
 * Accounts: the grant g:<board>:<uh> = "<aclGen>|<role>|<o>" is valid while
 * its aclGen equals a:<board>[0] and (o ∈ {o, f, s} or links = 1, SPEC-M1
 * §4.13.1): a share grant does not depend on the link policy. o tells the
 * origin of the role (o owner, f share with moderate, s share, l link) and
 * gives the principal its origin and facilitator flag. A miss runs the full
 * check (SPEC-M1 §4.13.1): the board row LEFT JOIN members/links (one
 * query; a membership counts only while its link is valid), then the share
 * rows of the board (ShareService::roleFor); the effective role is the
 * maximum (share before link on a tie). The grant of a link member lives
 * at most until its link expires (TTL ≤ 120 s). No access and no board look
 * the same: 404 (no ownership oracle).
 *
 * Guests: the signed token (GuestToken) in the normative order of §4.9.3:
 * verify → claims.b === board → claims.r a link role → generation of THAT
 * link role (edit: a:<board>[1] / link_gen, vote: a:<board>[4] /
 * vote_link_gen, or the DB) → link policy; 401 guest_token | 403
 * link_revoked | 403 links_disabled | 404.
 *
 * Link policy (§4.9.7, LinkPolicy): while Nextcloud does not allow the board
 * owner to share via link, a membership that came through a link grants
 * nothing (as if the link were off; a share still counts) and guests get
 * 403 links_disabled. The fast path reads the policy from a:<board>[3]: a
 * link grant is only trusted while it is 1, else the full check decides.
 *
 * Guest join (SPEC-M1 §4.11.4): unknown token → miss throttle → 404/429;
 * revoked → 403 link_revoked; expired → 403 link_expired (no failure);
 * link policy → 403 links_disabled; the link password (a guest with a
 * valid old token of this link role and generation skips it; blocked →
 * 429 slow_down reason password; none → 403 password_required; wrong →
 * one failure, 403 password_wrong); the token ends with the link at the
 * latest (exp = min(now + GUEST_TTL, expires_at / 1000)).
 */
class Access {
    /** Grant origin letter (SPEC-M1 §5.1) → Principal::$origin. */
    private const GRANT_ORIGIN = ['o' => 'owner', 'f' => 'share', 's' => 'share', 'l' => 'link'];

    public function __construct(
        private IUserSession $userSession,
        private BoardStore $boards,
        private FastCache $cache,
        private GuestToken $tokens,
        private LinkThrottle $throttle,
        private ILimiter $limiter,
        private ISecureRandom $random,
        private IConfig $config,
        private ITimeFactory $time,
        private LinkPolicy $policy,
        private ShareService $shares,
        private LinkSecrets $secrets,
    ) {
    }

    /** $full: skip the cached grant (snapshot) — the board row is always read. */
    public function forUser(int $board, bool $full = false): AccessResult {
        $user = $this->userSession->getUser();
        if ($user === null) {
            throw new HttpError(401, 'not_logged_in', 'Not logged in.');
        }
        $uid = $user->getUID();
        if (!$full && $this->cache->available()) {
            $gens = $this->cache->getGens($board);
            if ($gens !== null && $gens['gone']) {
                throw new HttpError(404, 'not_found');
            }
            $grant = $gens === null ? null : $this->cache->getGrant($board, $uid);
            if ($grant !== null && $grant['acl'] === $gens['acl']) {
                $role = Role::tryFrom($grant['role']);
                $origin = self::GRANT_ORIGIN[$grant['origin']];
                // Owner role and origin o go together; a link grant needs
                // links allowed for the owner; otherwise the full check decides.
                if ($role !== null && ($role === Role::Owner) === ($origin === 'owner')
                    && ($origin !== 'link' || $gens['links'])) {
                    $p = $this->userPrincipal($board, $uid, $user->getDisplayName(), $role, $origin, $grant['origin'] === 'f');
                    return new AccessResult($p, null, $gens['minRev']);
                }
            }
        }
        return $this->forUserWithRow($board)[0];
    }

    /**
     * The full check of an account; also returns the board row (snapshot
     * needs the title).
     *
     * @return array{0: AccessResult, 1: array} [result, board row + member_role]
     */
    public function forUserWithRow(int $board): array {
        $user = $this->userSession->getUser();
        if ($user === null) {
            throw new HttpError(401, 'not_logged_in', 'Not logged in.');
        }
        $uid = $user->getUID();
        $now = $this->nowMs();
        // Reads the primary (pin() in the store) BEFORE the user's groups and
        // teams are looked up (SPEC-M1 §4.13.1, R2).
        $row = $this->boards->findBoardForUser($board, $uid, $now);
        if ($row === null) {
            throw new HttpError(404, 'not_found');
        }
        $links = $this->policy->allows($row['owner'], $user);
        $facilitator = false;
        $ttl = FastCache::GRANT_TTL;
        if ($row['owner'] === $uid) {
            $role = Role::Owner;
            $origin = 'owner';
        } else {
            [$role, $origin, $facilitator] = $this->memberRole($board, $row, $user, $links);
            if ($role === null) {
                throw new HttpError(404, 'not_found');
            }
            if ($origin === 'link' && $row['member_link_expires'] !== null) {
                // The grant of a link member ends with its link (SPEC-M1 §4.11.4, R2).
                $ttl = self::linkTtl($row['member_link_expires'], $now);
            }
        }
        $this->cache->seedGens($board, $row['acl_gen'], $row['link_gen'], $row['min_rev'], $links, $row['vote_link_gen']);
        $this->cache->setGrant($board, $uid, $row['acl_gen'], $role->value, self::grantOrigin($origin, $facilitator), $ttl);
        $p = $this->userPrincipal($board, $uid, $user->getDisplayName(), $role, $origin, $facilitator);
        return [new AccessResult($p, $row['rev'], $row['min_rev'], $row['meta_rev']), $row];
    }

    /**
     * The role of a non-owner (SPEC-M1 §4.13.1): the link role (only while
     * links are allowed for the owner; a link_id NULL row of M0 always
     * counts) and the share role (ShareService::roleFor); the effective role
     * is the maximum, the origin that of the higher source, share before link
     * on a tie. facilitator: any applying share row has the role moderate.
     * $user null (an account Nextcloud does not know): link role only.
     *
     * @param array $row findBoardForUser row
     * @return array{0: ?Role, 1: string, 2: bool} [role, origin share|link, facilitator]
     */
    public function memberRole(int $board, array $row, ?IUser $user, bool $linksAllowed): array {
        $linkRole = $row['member_role'] === null ? null : Role::tryFrom((string)$row['member_role']);
        if ($linkRole !== null && $row['member_link'] !== null && !$linksAllowed) {
            $linkRole = null;
        }
        [$shareRole, $facilitator] = $user === null ? [null, false] : $this->shares->roleFor($board, $user);
        $role = Role::max($linkRole, $shareRole);
        $origin = $shareRole !== null && ($linkRole === null || $shareRole->rank() >= $linkRole->rank()) ? 'share' : 'link';
        return [$role, $origin, $facilitator && $origin === 'share'];
    }

    /** Grant TTL of a link member: max(1, min(120, ceil((expires_at − now) / 1000))) s. */
    public static function linkTtl(int $expiresAt, int $nowMs): int {
        return max(1, min(FastCache::GRANT_TTL, (int)ceil(($expiresAt - $nowMs) / 1000)));
    }

    /**
     * Prüfreihenfolge §4.9.3: verify → b === $board → r ∈ link roles → lg →
     * link policy (§4.9.7); 401 guest_token | 403 link_revoked | 403
     * links_disabled | 404. $full: always read the board row (guest
     * snapshot), never the cached gens.
     */
    public function forGuest(#[\SensitiveParameter] string $token, int $board, bool $full = false): AccessResult {
        return $this->guestCheck($token, $board, $full)[0];
    }

    /**
     * Like forGuest(…, full: true), plus the board row.
     *
     * @return array{0: AccessResult, 1: array}
     */
    public function forGuestWithRow(#[\SensitiveParameter] string $token, int $board): array {
        [$a, $row] = $this->guestCheck($token, $board, true);
        return [$a, $row ?? throw new HttpError(404, 'not_found')];
    }

    /** @return array{0: AccessResult, 1: ?array} */
    private function guestCheck(#[\SensitiveParameter] string $token, int $board, bool $full): array {
        $c = $this->tokens->verify($token);
        if ($c === null) {
            throw new HttpError(401, 'guest_token');
        }
        // Without this binding a token of board A (lg 1) fits every board B
        // with link_gen 1, private boards included — board ids are sequential.
        if ($c['b'] !== $board) {
            throw new HttpError(401, 'guest_token');
        }
        if (!in_array($c['r'], Role::LINK_ROLES, true)) {
            throw new HttpError(401, 'guest_token');
        }
        $p = new Principal('g:' . $c['g'], Role::from($c['r']), $c['n'], $this->pid($board, 'g:' . $c['g']), true, null, 'guest');
        if (!$full && $this->cache->available()) {
            $gens = $this->cache->getGens($board);
            if ($gens !== null) {
                if ($gens['gone']) {
                    throw new HttpError(404, 'not_found');
                }
                if ($c['lg'] !== ($c['r'] === 'vote' ? $gens['voteLink'] : $gens['link'])) {
                    throw new HttpError(403, 'link_revoked');
                }
                if (!$gens['links']) {
                    throw new HttpError(403, 'links_disabled');
                }
                return [new AccessResult($p, null, $gens['minRev']), null];
            }
        }
        $row = $this->boards->findBoard($board);
        if ($row === null) {
            throw new HttpError(404, 'not_found');
        }
        $links = $this->policy->allows($row['owner']);
        $this->cache->seedGens($board, $row['acl_gen'], $row['link_gen'], $row['min_rev'], $links, $row['vote_link_gen']);
        if ($c['lg'] !== self::linkGen($row, $c['r'])) {
            throw new HttpError(403, 'link_revoked');
        }
        if (!$links) {
            throw new HttpError(403, 'links_disabled');
        }
        return [new AccessResult($p, $row['rev'], $row['min_rev'], $row['meta_rev']), $row];
    }

    /**
     * Guest join through an edit or voting link (SPEC-M1 §4.11.4, after
     * refuseCrossSite and JsonBody in the controller).
     *
     * @return array{0: AccessResult, 1: string, 2: int, 3: array} [result, guest token, exp, board row]
     * @throws HttpError 400 name_required | 403 link_revoked|link_expired|links_disabled|password_required|password_wrong
     *   | 404 not_found | 429 rate_limited|slow_down
     */
    public function joinGuest(
        #[\SensitiveParameter] string $linkToken,
        #[\SensitiveParameter] string $name,
        #[\SensitiveParameter] ?string $existing,
        string $ip,
        #[\SensitiveParameter] ?string $password = null,
    ): array {
        $link = $this->boards->findLinkByToken($linkToken);
        if ($link === null) {
            if ($this->throttle->missBlocked($ip)) {
                throw new HttpError(429, 'rate_limited');
            }
            throw new HttpError(404, 'not_found');
        }
        if ($link['revoked_at'] !== null) {
            throw new HttpError(403, 'link_revoked');
        }
        $board = $link['board'];
        if ($board === null) {
            // Active link without a board cannot happen (delete revokes in the
            // same transaction); a known token never counts as a miss.
            throw new HttpError(403, 'link_revoked');
        }
        $now = $this->nowMs();
        // An expired link is known: no miss, no failure (SPEC-M1 §4.11.4 step 2).
        if ($link['expires_at'] !== null && $link['expires_at'] <= $now) {
            throw new HttpError(403, 'link_expired');
        }
        // Nextcloud's link policy of the owner, before anything is issued (§4.9.7).
        if (!$this->policy->allows($board['owner'])) {
            throw new HttpError(403, 'links_disabled');
        }
        if ($link['password_hash'] !== null) {
            $old = $existing === null || $existing === '' ? null : $this->tokens->verify($existing);
            $skip = $old !== null && $old['b'] === $board['id'] && $old['r'] === $link['role'] && $old['lg'] === self::linkGen($board, $link['role']);
            if (!$skip) {
                $this->checkPassword($link, $password, $ip);
            }
        }
        $name = Input::displayName($name);
        if ($name === '') {
            throw new HttpError(400, 'name_required');
        }
        $gid = null;
        if ($existing !== null && $existing !== '') {
            // The identity survives reloads and a rotated link (lg may differ),
            // never a different board.
            $old = $this->tokens->verify($existing, true);
            if ($old !== null && $old['b'] === $board['id']) {
                $gid = $old['g'];
            }
        }
        // The throttles of a join, in this order (SPEC-M1 §4.11.4 step 6,
        // R19 T4-01); one that refuses keeps the later ones from counting
        // (Nextcloud's ILimiter does not count a refused attempt):
        //  1. a NEW identity: the guest budget per board, link and IP (M0) → 429 rate_limited
        //  2. a gid from an old (also expired) token: knorke-snap-<gid>  → 429 slow_down
        //  3. every join: knorke-snapip-<board> → 429 slow_down
        // The join hands out the same full snapshot as route 15, so it shares
        // that route's snapshot throttle (stage 4).
        if ($gid === null) {
            // New identities per board AND link and IP: one link holder can
            // still fill the budget of a shared address (venue Wi-Fi), but
            // rotating the link — which also cuts that holder off — gives
            // the new link a fresh budget.
            try {
                $this->limiter->registerAnonRequest('knorke-guest-' . $board['id'] . '-' . $link['id'], 300, 600, $ip);
            } catch (IRateLimitExceededException) {
                throw new HttpError(429, 'rate_limited');
            }
            $gid = 'g' . $this->random->generate(11, ISecureRandom::CHAR_ALPHANUMERIC);
        } else {
            $this->snapshotThrottle('knorke-snap-' . $gid, Limits::SNAPSHOT_LIMIT, Limits::SNAPSHOT_PERIOD, $ip);
        }
        $this->snapshotThrottle('knorke-snapip-' . $board['id'], Limits::SNAPSHOT_IP_LIMIT, Limits::SNAPSHOT_IP_PERIOD, $ip);
        $exp = $this->time->getTime() + Limits::GUEST_TTL;
        if ($link['expires_at'] !== null) {
            // The token ends with the link at the latest (SPEC-M1 §4.11.4 step 7).
            $exp = min($exp, intdiv($link['expires_at'], 1000));
        }
        $guestToken = $this->tokens->issue([
            'v' => GuestToken::VERSION, 'b' => $board['id'], 'g' => $gid, 'r' => $link['role'],
            'lg' => self::linkGen($board, $link['role']), 'exp' => $exp, 'n' => $name,
        ]);
        $this->cache->seedGens($board['id'], $board['acl_gen'], $board['link_gen'], $board['min_rev'], true, $board['vote_link_gen']);
        $role = Role::tryFrom($link['role']) ?? Role::View;
        $p = new Principal('g:' . $gid, $role, $name, $this->pid($board['id'], 'g:' . $gid), true, null, 'guest');
        return [new AccessResult($p, $board['rev'], $board['min_rev'], $board['meta_rev']), $guestToken, $exp, $board];
    }

    /**
     * Snapshot throttle of an account (route 12, SPEC-M1 §4.1, §7.6):
     * `knorke-snap` 30 per 60 s per account over all boards → 429 slow_down
     * with retryMs 2000 (Retry-After 2). Called after the full rights check
     * (a refused caller spends nothing) and before the snapshot is built.
     *
     * @throws HttpError 401|429
     */
    public function throttleSnapshot(): void {
        $user = $this->userSession->getUser();
        if ($user === null) {
            throw new HttpError(401, 'not_logged_in', 'Not logged in.');
        }
        try {
            $this->limiter->registerUserRequest('knorke-snap', Limits::SNAPSHOT_LIMIT, Limits::SNAPSHOT_PERIOD, $user);
        } catch (IRateLimitExceededException) {
            throw self::slowDown(Limits::SNAPSHOT_LIMIT, Limits::SNAPSHOT_PERIOD);
        }
    }

    /**
     * Snapshot throttle of a guest (route 15, SPEC-M1 §4.1, §7.6), after the
     * token check: `knorke-snap-<gid>` 30 per 60 s and IP, then
     * `knorke-snapip-<board>` 300 per 60 s and IP over all gids (the same
     * order as the join, §4.11.4 step 6) → 429 slow_down.
     *
     * @throws HttpError 429
     */
    public function throttleGuestSnapshot(Principal $p, int $board, string $ip): void {
        $this->snapshotThrottle('knorke-snap-' . substr($p->id, 2), Limits::SNAPSHOT_LIMIT, Limits::SNAPSHOT_PERIOD, $ip);
        $this->snapshotThrottle('knorke-snapip-' . $board, Limits::SNAPSHOT_IP_LIMIT, Limits::SNAPSHOT_IP_PERIOD, $ip);
    }

    /** One anonymous ILimiter budget of the snapshot throttle → 429 slow_down. */
    private function snapshotThrottle(string $identifier, int $limit, int $period, string $ip): void {
        try {
            $this->limiter->registerAnonRequest($identifier, $limit, $period, $ip);
        } catch (IRateLimitExceededException) {
            throw self::slowDown($limit, $period);
        }
    }

    /** 429 slow_down of an ILimiter budget: retryMs = ceil(period · 1000 / limit) (SPEC-M1 §4.2). */
    private static function slowDown(int $limit, int $period): HttpError {
        return new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil($period * 1000 / $limit)]);
    }

    /**
     * The link password of SPEC-M1 §4.11.4 step 4 (callers decide who skips
     * it): blocked → 429 slow_down {retryMs, reason: password} without a
     * check; none → 403 password_required (no failure); wrong → one failure
     * for the link and the sender's network, 403 password_wrong.
     *
     * Returns the hash stored after the check (R14-01, LinkSecrets::verify):
     * the rehash when it replaced the verified hash, else the verified one.
     * The account join compares the row it reads again under the lock with
     * it, so its own rehash never looks like an owner's password change.
     *
     * @param array{id: int, password_hash: ?string} $link
     * @throws HttpError 403|429
     */
    public function checkPassword(array $link, #[\SensitiveParameter] ?string $password, string $ip): ?string {
        $retry = $this->secrets->failuresBlocked($link['id'], $ip);
        if ($retry !== null) {
            throw new HttpError(429, 'slow_down', '', ['retryMs' => $retry, 'reason' => 'password']);
        }
        if ($password === null || $password === '') {
            throw new HttpError(403, 'password_required');
        }
        $stored = null;
        if (!$this->secrets->verify($link, $password, $stored)) {
            $this->secrets->registerFailure($link['id'], $ip);
            throw new HttpError(403, 'password_wrong');
        }
        return $stored;
    }

    /**
     * Opaque participant id, stable per board and person (§4.9.4); presence
     * key and colour, in M1 also the vote key. Uids never reach guests.
     */
    public function pid(int $board, string $principalId): string {
        return self::derivePid($this->config->getSystemValueString('secret'), $board, $principalId);
    }

    /**
     * The one formula of the pid (§4.9.4): HMAC over board and principal id
     * with a key derived from the system secret `secret`. Static for callers
     * that map many principal ids with one read of the secret (lock.by in
     * snapshots and syncs, SyncService).
     */
    public static function derivePid(#[\SensitiveParameter] string $secret, int $board, string $principalId): string {
        $key = hash('sha256', 'knorke-pid|' . $secret, true);
        return substr(hash_hmac('sha256', 'knorke-pid|' . $board . '|' . $principalId, $key), 0, 16);
    }

    /** Grant origin letter of a principal origin: o owner, f share with moderate, s share, l link. */
    private static function grantOrigin(string $origin, bool $facilitator): string {
        return match ($origin) {
            'owner' => 'o',
            'share' => $facilitator ? 'f' : 's',
            'link' => 'l',
            default => throw new \LogicException('Knorke: no grant for origin ' . $origin),
        };
    }

    /** Generation of a link role in a board row (SPEC-M1 §3.2): edit → link_gen, vote → vote_link_gen. */
    private static function linkGen(array $row, string $role): int {
        return $role === 'vote' ? (int)$row['vote_link_gen'] : (int)$row['link_gen'];
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }

    private function userPrincipal(int $board, string $uid, string $displayName, Role $role, string $origin, bool $facilitator): Principal {
        return new Principal('u:' . $uid, $role, $displayName, $this->pid($board, 'u:' . $uid), false, $uid, $origin, $facilitator);
    }
}
