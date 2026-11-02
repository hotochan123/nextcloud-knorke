<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Teams;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\SharePolicy;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Teams\ITeamResourceProvider;
use OCP\Teams\TeamResource;
use Psr\Container\ContainerInterface;

/**
 * Boards shared with a team (Circles) among that team's resources (factory
 * job 222): Nextcloud's /ocs/v2.php/teams API, which the Contacts app's team
 * view reads. Nextcloud asks no provider while Circles is off
 * (TeamManager::getProviders() = []), and OCP\Teams is part of the core, so
 * the registration loads nothing of Circles.
 *
 * The provider gets no account from Nextcloud, so it answers for the
 * session account U, and lists board B as a resource of team T only when:
 *  1. there is a session account U;
 *  2. Knorke is enabled for U and the Guests app lets U open Knorke (as the
 *     unified search, GuestsAppWhitelist);
 *  3. T is one of U's teams (SharePolicy::teamsOf: team support for U and
 *     the default probe, so no hidden teams: the teams whose shares grant
 *     U access). Nextcloud's GET /teams/resources/{provider}/{id} asks
 *     getSharedWith() for every team U can SEE, open teams U is not a
 *     member of included, so this check is the provider's own;
 *  4. B has a share row of kind team for T;
 *  5. U may open B: B is in U's board list (BoardStore::listForUser) and U
 *     owns it or Access::memberRole() gives a role (a link membership only
 *     while LinkPolicy allows the owner's links), as in
 *     BoardSearchProvider::search() step 7.
 * Cheap first: 1, 2, then the team rows of T (index knorke_shares_rcpt);
 * a team without Knorke boards costs that one query. Read only, as the
 * search: no grants or gens in FastCache.
 *
 * Nextcloud builds the provider only when its team API is called; the
 * constructor still takes only light services, the Knorke services come
 * from the container on first use.
 */
class BoardTeamResourceProvider implements ITeamResourceProvider {
    public const ID = 'knorke';
    /**
     * The glyph of img/app-dark.svg (the same path data, logo L7) in
     * currentColor, so it follows the text colour in the light and the dark theme.
     */
    public const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">'
        . '<path d="M5,14.03L4.58,13.96L4.01,13.72L3.52,13.33L3.14,12.82L2.91,12.24L1.41,6.22L1.34,5.6L1.44,4.98L1.68,4.41L2.07,3.92L2.58,3.54L3.16,3.31L5,2.85Z'
        . ' M9.18,1.81L9.8,1.74L10.42,1.84L10.99,2.08L11.48,2.47L11.86,2.98L12.09,3.56L12.45,5L5,5L5,2.85Z'
        . ' M9.5 6.5H15.5A3 3 0 0 1 18.5 9.5V13H14.5A1.5 1.5 0 0 0 13 14.5V18.5H9.5A3 3 0 0 1 6.5 15.5V9.5A3 3 0 0 1 9.5 6.5Z'
        . ' M14.5 14.5H18.5L14.5 18.5Z"/></svg>';

    private ?BoardStore $boards = null;
    private ?ShareStore $shares = null;
    private ?SharePolicy $policy = null;
    private ?Access $access = null;
    private ?LinkPolicy $linkPolicy = null;

    public function __construct(
        private IL10N $l,
        private IURLGenerator $urls,
        private IAppManager $apps,
        private IUserSession $session,
        private ITimeFactory $time,
        private ContainerInterface $container,
        private GuestsAppWhitelist $guestsApp,
    ) {
    }

    public function getId(): string {
        return self::ID;
    }

    public function getName(): string {
        return $this->l->t('Knorke boards');
    }

    public function getIconSvg(): string {
        return self::ICON_SVG;
    }

    /** @return list<TeamResource> */
    public function getSharedWith(string $teamId): array {
        $out = [];
        foreach ($this->boardsOf($teamId) as $row) {
            $id = (int)$row['id'];
            $out[] = new TeamResource(
                $this,
                (string)$id,
                (string)$row['title'],
                $this->urls->linkToRouteAbsolute('knorke.page.board', ['id' => $id]),
                iconSvg: self::ICON_SVG,
            );
        }
        return $out;
    }

    public function isSharedWithTeam(string $teamId, string $resourceId): bool {
        $board = self::boardId($resourceId);
        if ($board === null) {
            return false;
        }
        foreach ($this->boardsOf($teamId) as $row) {
            if ((int)$row['id'] === $board) {
                return true;
            }
        }
        return false;
    }

    /**
     * The teams of U among the team rows of the board, ascending, and only
     * while U may open it (rules 1, 2, 5); [] for a board U may not open,
     * the same as for a board that does not exist.
     *
     * @return list<string>
     */
    public function getTeamsForResource(string $resourceId): array {
        $board = self::boardId($resourceId);
        $user = $board === null ? null : $this->user();
        if ($user === null) {
            return [];
        }
        $this->shares ??= $this->container->get(ShareStore::class);
        $teams = [];
        foreach ($this->shares->forBoard($board) as $r) {
            if ($r['kind'] === 'team') {
                $teams[(string)$r['recipient']] = true;
            }
        }
        if ($teams === []) {
            return [];
        }
        $this->policy ??= $this->container->get(SharePolicy::class);
        $teams = array_values(array_intersect(array_keys($teams), $this->policy->teamsOf($user)));
        if ($teams === [] || $this->openable($user, [$board]) === []) {
            return [];
        }
        sort($teams, SORT_STRING);
        return $teams;
    }

    /**
     * The board rows of team $teamId that the session account may see as
     * its resources (rules 1–5), in the order of its board list.
     *
     * @return list<array>
     */
    private function boardsOf(string $teamId): array {
        $user = $this->user();
        if ($user === null) {
            return [];
        }
        $this->shares ??= $this->container->get(ShareStore::class);
        $ids = $this->shares->boardsFor('team', [$teamId]);
        if ($ids === []) {
            return [];
        }
        $this->policy ??= $this->container->get(SharePolicy::class);
        if (!in_array($teamId, $this->policy->teamsOf($user), true)) {
            return [];
        }
        return $this->openable($user, $ids);
    }

    /**
     * The rows of $user's board list among $ids that $user may open: owner,
     * or a role from Access::memberRole() (rule 5).
     *
     * @param list<int> $ids
     * @return list<array>
     */
    private function openable(IUser $user, array $ids): array {
        $uid = $user->getUID();
        $this->boards ??= $this->container->get(BoardStore::class);
        $this->boards->pin();
        $rows = $this->boards->listForUser($uid, $this->policy->groupIdsOf($user), $this->policy->teamsOf($user), $this->nowMs());
        $wanted = array_fill_keys($ids, true);
        $out = [];
        foreach ($rows as $row) {
            $id = (int)$row['id'];
            if (!isset($wanted[$id])) {
                continue;
            }
            unset($wanted[$id]);
            if ($row['owner'] !== $uid) {
                $this->access ??= $this->container->get(Access::class);
                // As BoardSearchProvider: the link policy matters only for a link membership.
                $linksAllowed = true;
                if ($row['member_role'] !== null && $row['member_link'] !== null) {
                    $this->linkPolicy ??= $this->container->get(LinkPolicy::class);
                    $linksAllowed = $this->linkPolicy->allows((string)$row['owner']);
                }
                [$role] = $this->access->memberRole($id, $row, $user, $linksAllowed);
                if ($role === null) {
                    continue;
                }
            }
            $out[] = $row;
        }
        return $out;
    }

    /** The session account while Knorke and the Guests app let it open boards (rules 1, 2), else null. */
    private function user(): ?IUser {
        $user = $this->session->getUser();
        if (!$user instanceof IUser
            || !$this->apps->isEnabledForUser(Application::APP_ID, $user)
            || !$this->guestsApp->allows($user)) {
            return null;
        }
        return $user;
    }

    /** A board id ≥ 1 from a resource id, else null. */
    private static function boardId(string $resourceId): ?int {
        // D: `$` must not match before a trailing newline ("7\n").
        return preg_match('/^[1-9][0-9]{0,17}$/D', $resourceId) === 1 ? (int)$resourceId : null;
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
