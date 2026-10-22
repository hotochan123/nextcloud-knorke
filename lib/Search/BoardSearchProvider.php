<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Search;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\SharePolicy;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Search\IProvider;
use OCP\Search\ISearchQuery;
use OCP\Search\SearchResult;
use OCP\Search\SearchResultEntry;
use Psr\Container\ContainerInterface;

/**
 * "Knorke boards" in Nextcloud's unified search (M2, SPEC-M1 §1.2, §11 Q8):
 * boards whose TITLE contains the term, among those the account may open
 * through ownership, a share (user, group, team) or a valid edit or voting
 * link membership: the boards of its board list. Board content (objects,
 * labels, frame titles, the board meta) is never read: private frames and
 * objects of M2 cannot leak through here.
 *
 *  - candidates as BoardService::listFor (pin first, then groups and teams,
 *    SPEC-M1 §4.10.4 (R2)); listForUser sets member_role only for a
 *    membership valid at now (its link neither revoked nor expired, or
 *    link_id NULL); the term is matched in PHP (mb_stripos), never in SQL
 *  - every foreign board passes Access::memberRole() right before it is
 *    listed: the link role of the row (only while LinkPolicy allows links
 *    for the owner; a link_id NULL row of M0 always counts) and the share
 *    role, read fresh through ShareService::roleFor(): a share removed
 *    meanwhile hides it; at most limit + 1 such checks unless checks fail
 *  - order id DESC with a keyset cursor (id < cursor): stable while
 *    updated_at moves, no duplicates or gaps across pages
 *  - read only: of Access only memberRole() (no forUser*, no grants or
 *    gens in FastCache, no throttles); no BoardStore read beyond the list
 *  - an account of the Guests app (backend "Guests") gets hits only while
 *    that app lets it open /apps/knorke/ (GuestsAppWhitelist, shared with
 *    the notifier; the search endpoint is core's, so the Guests app never
 *    stops it itself). While it does not, or while Knorke's "Limit to
 *    groups" keeps the session account out (asked first, as in search()),
 *    getOrder() returns null and Nextcloud leaves "Knorke boards" out of
 *    the provider list and the "Places" menu; without a session account
 *    the order stays. search() checks on its own, as the search endpoint
 *    does not look at getOrder(). Other accounts never ask the Guests app
 *
 * SearchComposer builds EVERY registered provider whenever the provider
 * list is read or another provider is searched, so the constructor takes
 * only light services; the Knorke services come from the container on the
 * first search that gets past the input checks, Access on the first
 * foreign candidate, LinkPolicy on the first link membership, the Guests
 * app's whitelist (through GuestsAppWhitelist) on the first search or
 * provider list of one of its accounts.
 */
class BoardSearchProvider implements IProvider {
    public const ID = 'knorke';
    /** Entries per page: Nextcloud's default unified_search_max_results_per_request. */
    public const MAX_RESULTS = 25;
    /** Order of the section: first on Knorke's own pages, else after the core apps. */
    public const ORDER_OWN = -5;
    public const ORDER_OTHER = 20;
    /** Aliases of GuestsAppWhitelist::BACKEND and ::WHITELIST (job 030). */
    public const GUESTS_BACKEND = GuestsAppWhitelist::BACKEND;
    public const GUESTS_WHITELIST = GuestsAppWhitelist::WHITELIST;
    /**
     * The icon of a hit: app-dark.svg's glyph in a mid grey (#808080). NC 34
     * shows the icon URL as a background-image without any filter, NC 35 as
     * <img class="result-item__icon-img"> with filter:
     * var(--background-invert-if-dark). The legacy search, which NC 34 and 35
     * load instead while the system config sets unified_search.enabled to
     * true or enable_non-accessible_features to false, shows it as a
     * background-image without any filter on NC 35 too, so black would fail
     * there as well. A mid grey therefore stays at 3 : 1 or more in both
     * themes on both versions (black: 1.17 : 1 on NC 34's dark background).
     * Notifier and AdminSection keep app-dark.svg: core inverts it there
     * itself.
     */
    public const ICON = 'app-neutral.svg';

    private ?BoardStore $boards = null;
    private ?SharePolicy $policy = null;
    private ?Access $access = null;
    private ?LinkPolicy $linkPolicy = null;

    public function __construct(
        private IL10N $l,
        private IURLGenerator $urls,
        private IAppManager $apps,
        private IUserManager $users,
        private ITimeFactory $time,
        private ContainerInterface $container,
        private IUserSession $session,
        private GuestsAppWhitelist $guestsApp,
    ) {
    }

    public function getId(): string {
        return self::ID;
    }

    public function getName(): string {
        return $this->l->t('Knorke boards');
    }

    public function getOrder(string $route, array $routeParameters): ?int {
        // An account that Knorke's "Limit to groups" or the Guests app keeps
        // out: null, and SearchComposer::getProviders() leaves the provider
        // out. The group limit first, as in search() and Notifier::prepare().
        // Without a session account nothing is asked: isEnabledForUser()
        // without an account would answer false for an app limited to groups.
        $user = $this->session->getUser();
        if ($user instanceof IUser
            && (!$this->apps->isEnabledForUser(Application::APP_ID, $user) || !$this->guestsApp->allows($user))) {
            return null;
        }
        return str_starts_with($route, Application::APP_ID . '.') ? self::ORDER_OWN : self::ORDER_OTHER;
    }

    public function search(IUser $user, ISearchQuery $query): SearchResult {
        $name = $this->getName();
        $none = SearchResult::complete($name, []);
        // 1. A term longer than any title cannot match one.
        $term = trim($query->getTerm());
        if ($term === '' || mb_strlen($term) > Limits::MAX_TITLE) {
            return $none;
        }
        // 2. Without access to the app no board page opens.
        if (!$this->apps->isEnabledForUser(Application::APP_ID, $user)) {
            return $none;
        }
        // 3. The cursor: the id of the last entry of the previous page.
        $after = self::cursor($query->getCursor());
        if ($after === false) {
            return $none;
        }
        // 4. The page size. Nothing was read so far.
        $limit = max(1, min($query->getLimit(), self::MAX_RESULTS));
        // 5. An account of the Guests app: that app decides, once per search
        // (fails closed and without a log, see GuestsAppWhitelist).
        if (!$this->guestsApp->allows($user)) {
            return $none;
        }

        // 6. Candidates, in the order of the board list (R2): pin before groups and teams.
        $uid = $user->getUID();
        $boards = $this->boards ??= $this->container->get(BoardStore::class);
        $policy = $this->policy ??= $this->container->get(SharePolicy::class);
        $boards->pin();
        $rows = $boards->listForUser($uid, $policy->groupIdsOf($user), $policy->teamsOf($user), $this->nowMs());
        $hits = [];
        foreach ($rows as $row) {
            $id = (int)$row['id'];
            if (($row['owner'] === $uid || ($row['share_roles'] ?? []) !== [] || $row['member_role'] !== null)
                && ($after === null || $id < $after)
                && mb_stripos((string)$row['title'], $term) !== false) {
                $hits[] = $row;
            }
        }
        usort($hits, static fn (array $a, array $b): int => (int)$b['id'] <=> (int)$a['id']);

        // 7. The rights check per hit, right before it is listed; 8. the answer.
        $entries = [];
        $owners = [];
        $icon = null;
        $last = 0;
        $more = false;
        foreach ($hits as $row) {
            $id = (int)$row['id'];
            if ($row['owner'] !== $uid) {
                $this->access ??= $this->container->get(Access::class);
                // Shares and the link_id NULL rows of M0 do not depend on the
                // link policy (as Access and BoardService::rowRole); memberRole()
                // reads $linksAllowed only for a link membership.
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
            if (count($entries) === $limit) {
                $more = true;
                break;
            }
            $owner = (string)$row['owner'];
            $owners[$owner] ??= $this->users->getDisplayName($owner) ?? $owner;
            $icon ??= $this->urls->imagePath(Application::APP_ID, self::ICON);
            $entries[] = new SearchResultEntry(
                '',
                (string)$row['title'],
                $this->l->t('by %s', [$owners[$owner]]),
                $this->urls->linkToRoute('knorke.page.board', ['id' => $id]),
                $icon,
                false,
            );
            $last = $id;
        }
        return $more ? SearchResult::paginated($name, $entries, $last) : SearchResult::complete($name, $entries);
    }

    /**
     * The keyset cursor: null = from the start, a board id ≥ 1, or false for
     * anything else (the core passes it through unchecked).
     */
    private static function cursor(mixed $c): int|false|null {
        if ($c === null || $c === '') {
            return null;
        }
        if (is_int($c)) {
            return $c >= 1 ? $c : false;
        }
        // D: `$` must not match before a trailing newline ("5\n").
        if (is_string($c) && preg_match('/^[1-9][0-9]{0,17}$/D', $c) === 1) {
            return (int)$c;
        }
        return false;
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
