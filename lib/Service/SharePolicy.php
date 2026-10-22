<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCP\App\IAppManager;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IManager;
use OCP\Teams\ITeamManager;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Nextcloud's sharing policy for explicit shares and links (SPEC-M1 §7.4,
 * §4.10, §4.11.2), read through the IManager getters only (typed lexicon
 * values with their defaults, never raw IAppConfig).
 *
 *  - forOwner(): may the board owner share at all (shareapi_enabled and
 *    the exclusion groups), with groups, with teams; "group members only"
 *  - checkNew(): the rules of SPEC-M1 §4.10.2 step 4 for a NEW recipient,
 *    first violation wins; checkRaise(): the two rules of a role raise
 *    (R13): sharing_disabled, and for groups group_sharing_disabled
 *  - canonical(): the canonical recipient id (getUID(), getGID(), a team's
 *    singleId) or null (= recipient_not_found)
 *  - linkPolicy(): passwordEnforced/expire* for links (R13 mapping,
 *    SPEC-M1 §4.10.1) — the session user is the owner (only the owner
 *    creates and changes links), as Nextcloud's own getters assume
 *  - teamsOf(): singleIds of the teams the user is a member of (Circles'
 *    default probe: no hidden, backend or system circles), per request
 *  - groupIdsOf(): the user's group ids, per request; in CLI processes
 *    straight from the group backends, past Nextcloud's per-process cache
 *
 * The share manager and the team manager are resolved lazily: the /sync
 * fast path never builds them, and the full rights check only asks for
 * teams when a board has team rows.
 */
class SharePolicy {
    private ?IManager $manager = null;
    private ?ITeamManager $teams = null;
    /** @var array<string, array{sharing: bool, groups: bool, teams: bool, groupMembersOnly: bool}> */
    private array $owners = [];
    /** @var array<string, array<string, string>> uid → team singleId → display name */
    private array $teamMemo = [];
    /** @var array<string, list<string>> uid → group ids */
    private array $groupMemo = [];
    /** @var array<string, bool> uid → team support */
    private array $teamSupport = [];

    public function __construct(
        private ContainerInterface $container,
        private IUserManager $users,
        private IGroupManager $groups,
        private IAppManager $apps,
        private LoggerInterface $logger,
    ) {
    }

    /**
     * policy of SPEC-M1 §4.10.1 for the owner.
     *
     * @return array{sharing: bool, groups: bool, teams: bool, groupMembersOnly: bool}
     */
    public function forOwner(IUser $owner): array {
        $uid = $owner->getUID();
        if (isset($this->owners[$uid])) {
            return $this->owners[$uid];
        }
        $m = $this->manager();
        return $this->owners[$uid] = [
            'sharing' => $m->shareApiEnabled() && !$m->sharingDisabledForUser($uid),
            'groups' => $m->allowGroupSharing(),
            'teams' => $this->teamSupport($owner),
            'groupMembersOnly' => $m->shareWithGroupMembersOnly(),
        ];
    }

    /**
     * The rules for a NEW share (SPEC-M1 §4.10.2 step 4), in this order;
     * the first violation is returned as its error code (§4.2), null = ok.
     * $recipient as sent; canonical() gives the id to store.
     */
    public function checkNew(IUser $owner, string $kind, string $recipient): ?string {
        $policy = $this->forOwner($owner);
        if (!$policy['sharing']) {
            return 'sharing_disabled';
        }
        $m = $this->manager();
        switch ($kind) {
            case 'user':
                $user = $this->users->get($recipient);
                if ($user === null || !$user->isEnabled()) {
                    return 'recipient_not_found';
                }
                if ($user->getUID() === $owner->getUID()) {
                    return 'self_share';
                }
                if ($policy['groupMembersOnly']) {
                    $common = array_diff(
                        array_intersect($this->groupIdsOf($owner), $this->groupIdsOf($user)),
                        $m->shareWithGroupMembersOnlyExcludeGroupsList(),
                    );
                    if ($common === []) {
                        return 'group_members_only';
                    }
                }
                return null;
            case 'group':
                if (!$policy['groups']) {
                    return 'group_sharing_disabled';
                }
                $group = $this->groups->get($recipient);
                if ($group === null) {
                    return 'recipient_not_found';
                }
                if ($policy['groupMembersOnly']
                    && (in_array($group->getGID(), $m->shareWithGroupMembersOnlyExcludeGroupsList(), true) || !$group->inGroup($owner))) {
                    return 'group_members_only';
                }
                return null;
            case 'team':
                if (!$policy['teams']) {
                    return 'teams_unavailable';
                }
                return in_array($recipient, $this->teamsOf($owner), true) ? null : 'recipient_not_found';
            default:
                return 'bad_request';
        }
    }

    /**
     * The rules for RAISING the role of an existing share (SPEC-M1 §4.10.2
     * step 4, R13): sharing_disabled for every kind, group_sharing_disabled
     * for groups. Existence, self_share, group_members_only and
     * teams_unavailable are checked for new entries only.
     */
    public function checkRaise(IUser $owner, string $kind): ?string {
        $policy = $this->forOwner($owner);
        if (!$policy['sharing']) {
            return 'sharing_disabled';
        }
        if ($kind === 'group' && !$policy['groups']) {
            return 'group_sharing_disabled';
        }
        return null;
    }

    /**
     * Canonical recipient id (SPEC-M1 §3.5, R2): getUID() / getGID() / the
     * team's singleId (it must be one of the owner's teams), null when the
     * recipient does not exist (recipient_not_found).
     */
    public function canonical(IUser $owner, string $kind, string $id): ?string {
        return match ($kind) {
            'user' => $this->users->get($id)?->getUID(),
            'group' => $this->groups->get($id)?->getGID(),
            'team' => in_array($id, $this->teamsOf($owner), true) ? $id : null,
            default => null,
        };
    }

    /**
     * Display name of a recipient for display_name and the share list:
     * live (user display name, group display name, team name among the
     * owner's teams), null when it cannot be resolved.
     */
    public function displayName(IUser $owner, string $kind, string $id): ?string {
        try {
            return match ($kind) {
                'user' => $this->users->getDisplayName($id),
                'group' => $this->groups->get($id)?->getDisplayName(),
                'team' => $this->teams($owner)[$id] ?? null,
                default => null,
            };
        } catch (\Throwable) {
            return null;
        }
    }

    /** Does the group still exist (share list `available`, SPEC-M1 §4.10.1)? */
    public function groupExists(string $gid): bool {
        try {
            return $this->groups->groupExists($gid);
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * linkPolicy of SPEC-M1 §4.10.1 (R13 mapping): expireDefaultDays only
     * when a default expiry is configured, expireMaxDays only when it is
     * enforced, both from shareApiLinkDefaultExpireDays() (never
     * core/link_defaultExpDays). The session user is the owner.
     *
     * @return array{passwordEnforced: bool, expireDefaultDays: ?int, expireEnforced: bool, expireMaxDays: ?int}
     */
    public function linkPolicy(): array {
        $m = $this->manager();
        $days = max(1, $m->shareApiLinkDefaultExpireDays());
        $enforced = $m->shareApiLinkDefaultExpireDateEnforced();
        return [
            'passwordEnforced' => $m->shareApiLinkEnforcePassword(),
            'expireDefaultDays' => $m->shareApiLinkDefaultExpireDate() ? $days : null,
            'expireEnforced' => $enforced,
            'expireMaxDays' => $enforced ? $days : null,
        ];
    }

    /**
     * Team support for this user (SPEC-M1 §4.13.1): Nextcloud has Circles
     * (ITeamManager::hasTeamSupport) and the app is enabled for the user.
     */
    public function teamSupport(IUser $user): bool {
        $uid = $user->getUID();
        if (isset($this->teamSupport[$uid])) {
            return $this->teamSupport[$uid];
        }
        try {
            $ok = $this->teamManager()->hasTeamSupport() && $this->apps->isEnabledForUser('circles', $user);
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: team support check failed', ['exception' => $e, 'app' => 'knorke']);
            $ok = false;
        }
        return $this->teamSupport[$uid] = $ok;
    }

    /**
     * singleIds of the user's teams (ITeamManager::getTeamsForUser, the
     * default probe), [] without team support; per request.
     *
     * @return list<string>
     */
    public function teamsOf(IUser $user): array {
        return array_map('strval', array_keys($this->teams($user)));
    }

    /**
     * The user's teams as singleId → display name; [] without team support
     * or when Circles fails (fails closed: team shares then grant nothing).
     *
     * @return array<string, string>
     */
    public function teams(IUser $user): array {
        $uid = $user->getUID();
        if (isset($this->teamMemo[$uid])) {
            return $this->teamMemo[$uid];
        }
        $out = [];
        if ($this->teamSupport($user)) {
            try {
                foreach ($this->teamManager()->getTeamsForUser($uid) as $team) {
                    $out[(string)$team->getId()] = (string)$team->getDisplayName();
                }
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: reading the teams of a user failed', ['exception' => $e, 'app' => 'knorke']);
                $out = [];
            }
        }
        return $this->teamMemo[$uid] = $out;
    }

    /**
     * Group ids of a user, per request. In CLI processes straight from the
     * group backends, merged as IGroupManager::getUserGroupIds() does
     * (Nextcloud keeps a user's groups for the whole process, and a worker
     * never forgets them); in a web request through getUserGroupIds().
     * A backend's exception is not caught, as in getUserGroupIds().
     *
     * @return list<string>
     */
    public function groupIdsOf(IUser $user): array {
        $uid = $user->getUID();
        if (isset($this->groupMemo[$uid])) {
            return $this->groupMemo[$uid];
        }
        if ($this->freshGroups()) {
            $ids = [];
            foreach ($this->groups->getBackends() as $backend) {
                if ($found = $backend->getUserGroups($uid)) {
                    $ids = array_merge($ids, $found);
                }
            }
        } else {
            $ids = $this->groups->getUserGroupIds($user);
        }
        return $this->groupMemo[$uid] = array_values(array_map('strval', $ids));
    }

    /** Long-running CLI processes (cron.php, occ background-job:worker) read groups past Nextcloud's per-process cache; a web request is a fresh process. */
    protected function freshGroups(): bool {
        return PHP_SAPI === 'cli';
    }

    /** Forgets the per-request answers (long-running processes: listeners, jobs, tests). */
    public function reset(): void {
        $this->owners = $this->teamMemo = $this->groupMemo = $this->teamSupport = [];
    }

    private function manager(): IManager {
        return $this->manager ??= $this->container->get(IManager::class);
    }

    private function teamManager(): ITeamManager {
        return $this->teams ??= $this->container->get(ITeamManager::class);
    }
}
