<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Reference;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardSketch;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\LinkPolicy;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Collaboration\Reference\IPublicReferenceProvider;
use OCP\Collaboration\Reference\IReference;
use OCP\Collaboration\Reference\Reference;
use OCP\IDateTimeFormatter;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use Psr\Container\ContainerInterface;

/**
 * Link previews of boards (M2, SPEC-M1 §1.2): a board address pasted in
 * Talk, Text, Mail or Deck becomes a card with the title, the owner, the
 * item count and the last change, for accounts that may open the board.
 *
 *  - matchReference(): every http(s) address whose path contains
 *    /apps/knorke/, on any host, so Nextcloud never fetches an OpenGraph
 *    preview of a Knorke address itself (no anonymous request to /p/…
 *    that would count against the link throttle of the server's IP, no
 *    title of a link page in a card)
 *  - a card only for a board address of the base Nextcloud builds for this
 *    request: B/apps/knorke/b/{id} or B/index.php/apps/knorke/b/{id},
 *    nothing after the id; edit, vote and join links never get one
 *  - the checks of the search, read only: a session account, "Limit to
 *    groups", the Guests app, then BoardStore::findBoardForUser() and, for
 *    a foreign board, Access::memberRole() (the owner's link policy only
 *    for a link membership); no grants or gens in FastCache, no throttle.
 *    A foreign and a missing board both give null (no rights oracle)
 *  - the picture (factory job 236): only after those checks, the board's
 *    sketch of the board list (BoardSketch::ofBoard(), numbers and colours
 *    only) as an SVG inside the card (a data: URL, so it has the card's
 *    rights and cache, no route of its own); an empty board keeps IMAGE
 *  - cached by Nextcloud for 3600 s per account and minute (getCacheKey),
 *    so rights, title, count, time and sketch are at most about a minute old
 *  - public pages (Talk guests, public Text shares) get no card at all
 *
 * Nextcloud builds every reference provider whenever it resolves any link
 * and on every page with the Smart Picker, so the constructor takes only
 * light services; BoardStore, Access, LinkPolicy, the date formatter and
 * BoardSketch come from the container on the first board address that gets
 * that far.
 * Application::register() names this class and a factory for it (create()),
 * which hands an admitted account the picker version BoardPickerProvider.
 */
class BoardReferenceProvider implements IPublicReferenceProvider {
    /** The image of an empty board's card: app-dark.svg's glyph in #808080, centred in a 2 : 1 picture. */
    public const IMAGE = 'board-card.svg';
    /** Board ids as in the routes and the search cursor: 1 … 18 digits, no leading zero. */
    private const ID = '[1-9][0-9]{0,17}';

    private ?BoardStore $boards = null;
    private ?Access $access = null;
    private ?LinkPolicy $linkPolicy = null;
    private ?IDateTimeFormatter $formatter = null;
    private ?BoardSketch $sketches = null;

    public function __construct(
        protected IL10N $l,
        protected IURLGenerator $urls,
        protected IAppManager $apps,
        protected IUserManager $users,
        protected ITimeFactory $time,
        protected IUserSession $session,
        protected GuestsAppWhitelist $guestsApp,
        protected ContainerInterface $container,
    ) {
    }

    /**
     * The factory Application::register() registers for this class name:
     * the core knows no per-account filter of picker entries, so an account
     * the search would serve gets BoardPickerProvider ("Knorke boards" in the
     * Smart Picker), everyone else this class without a picker entry. Both
     * recognise and resolve addresses alike. Asks only "Limit to groups"
     * and, for an account of the Guests app, that app.
     */
    public static function create(ContainerInterface $c): self {
        $args = [
            $c->get(IL10N::class),
            $c->get(IURLGenerator::class),
            $c->get(IAppManager::class),
            $c->get(IUserManager::class),
            $c->get(ITimeFactory::class),
            $c->get(IUserSession::class),
            $c->get(GuestsAppWhitelist::class),
            $c,
        ];
        $user = $args[5]->getUser();
        return self::admits($user, $args[2], $args[6]) ? new BoardPickerProvider(...$args) : new self(...$args);
    }

    /** Steps 2–4: a session account that "Limit to groups" and the Guests app let in (as the search). */
    private static function admits(?IUser $user, IAppManager $apps, GuestsAppWhitelist $guestsApp): bool {
        return $user instanceof IUser && $apps->isEnabledForUser(Application::APP_ID, $user) && $guestsApp->allows($user);
    }

    public function matchReference(string $referenceText): bool {
        $parts = parse_url($referenceText);
        if (!is_array($parts)) {
            return false;
        }
        $scheme = strtolower((string)($parts['scheme'] ?? ''));
        return ($scheme === 'http' || $scheme === 'https')
            && (string)($parts['host'] ?? '') !== ''
            && str_contains((string)($parts['path'] ?? ''), '/apps/' . Application::APP_ID . '/');
    }

    public function resolveReference(string $referenceText): ?IReference {
        // 1. A board address of this instance's base.
        $id = $this->boardId($referenceText);
        if ($id === null) {
            return null;
        }
        // 2.–4. A session account that may use Knorke.
        $user = $this->session->getUser();
        if (!self::admits($user, $this->apps, $this->guestsApp)) {
            return null;
        }
        // 5. The rights, read only (as the search, BoardSearchProvider).
        $uid = $user->getUID();
        $boards = $this->boards ??= $this->container->get(BoardStore::class);
        $boards->pin();
        $row = $boards->findBoardForUser($id, $uid, $this->nowMs());
        if ($row === null) {
            return null;
        }
        if ($row['owner'] !== $uid) {
            $this->access ??= $this->container->get(Access::class);
            // memberRole() reads $linksAllowed only for a link membership.
            $linksAllowed = true;
            if ($row['member_role'] !== null && $row['member_link'] !== null) {
                $this->linkPolicy ??= $this->container->get(LinkPolicy::class);
                $linksAllowed = $this->linkPolicy->allows((string)$row['owner']);
            }
            [$role] = $this->access->memberRole($id, $row, $user, $linksAllowed);
            if ($role === null) {
                return null;
            }
        }
        // 6. The card: Nextcloud's own open-graph widget.
        $owner = (string)$row['owner'];
        $this->formatter ??= $this->container->get(IDateTimeFormatter::class);
        $changed = $this->formatter->formatDateTime((int)floor((int)$row['updated_at'] / 1000), 'medium', 'short');
        $reference = new Reference($referenceText);
        $reference->setTitle((string)$row['title']);
        $reference->setDescription(implode(' · ', [
            $this->l->t('by %s', [$this->users->getDisplayName($owner) ?? $owner]),
            $this->l->n('%n item', '%n items', (int)$row['item_count']),
            $this->l->t('Changed %s', [$changed]),
        ]));
        // The board's sketch as the picture (job 236), the Knorke symbol for an empty board.
        $this->sketches ??= $this->container->get(BoardSketch::class);
        $sketch = $this->sketches->ofBoard($id);
        $reference->setImageUrl($sketch === []
            ? $this->urls->getAbsoluteURL($this->urls->imagePath(Application::APP_ID, self::IMAGE))
            : 'data:image/svg+xml;base64,' . base64_encode(BoardSketch::svg($sketch)));
        $reference->setUrl($this->urls->linkToRouteAbsolute('knorke.page.board', ['id' => $id]));
        return $reference;
    }

    public function getCachePrefix(string $referenceId): string {
        $id = $this->boardId($referenceId);
        return $id === null ? Application::APP_ID : Application::APP_ID . ':' . $id;
    }

    /** Per account and minute: no account sees another's card, none is older than about a minute. */
    public function getCacheKey(string $referenceId): ?string {
        $user = $this->session->getUser();
        return $user === null ? null : $user->getUID() . ':' . intdiv($this->time->getTime(), 60);
    }

    public function resolveReferencePublic(string $referenceText, #[\SensitiveParameter] string $sharingToken): ?IReference {
        return null;
    }

    public function getCacheKeyPublic(string $referenceId, #[\SensitiveParameter] string $sharingToken): ?string {
        return null;
    }

    /**
     * The board id of a board address: B/apps/knorke/b/{id} or
     * B/index.php/apps/knorke/b/{id} with B the base of this request
     * (scheme, host, port and webroot, as Nextcloud builds absolute
     * URLs) and nothing after the id; else null.
     */
    private function boardId(string $referenceText): ?int {
        $base = rtrim($this->urls->getAbsoluteURL('/'), '/');
        if (!str_starts_with($referenceText, $base . '/')) {
            return null;
        }
        // D: `$` must not match before a trailing newline.
        $ok = preg_match('#^(?:index\.php/)?apps/' . Application::APP_ID . '/b/(' . self::ID . ')$#D', substr($referenceText, strlen($base) + 1), $m);
        return $ok === 1 ? (int)$m[1] : null;
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
