<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Reference\BoardPickerProvider;
use OCA\Knorke\Reference\BoardReferenceProvider;
use OCA\Knorke\Search\BoardSearchProvider;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardSketch;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use OCP\App\IAppManager;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Collaboration\Reference\IDiscoverableReferenceProvider;
use OCP\Collaboration\Reference\IPublicReferenceProvider;
use OCP\Collaboration\Reference\IReference;
use OCP\Collaboration\Reference\IReferenceProvider;
use OCP\Collaboration\Reference\ISearchableReferenceProvider;
use OCP\IDateTimeFormatter;
use OCP\IDBConnection;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;

/**
 * Link previews and the Smart Picker of boards (job 157, M2, SPEC-M1 §1.2):
 * BoardReferenceProvider (recognise, resolve, cache keys, public pages) and
 * the factory Application::register() registers for it, which hands an
 * admitted account BoardPickerProvider. Every provider here comes from that
 * registered factory. Built on AccessHarness (real Access, ShareService and
 * SharePolicy over the fake stores, LinkPolicy from $linksAllowed, Knorke
 * per account from $knorkeFor, the Guests app from $guests); the IL10N fake
 * translates like Nextcloud's L10N (plural key _s_::_p_, %n, vsprintf),
 * English or from l10n/de.json.
 */
final class BoardReferenceProviderTest extends TestCase {
    /** The base Nextcloud builds for the request (scheme, host, webroot). */
    private const ORIGIN = 'https://cloud.example';
    /** updated_at of board 42 in ms: 2026-10-24 14:05:00.999 UTC. */
    private const UPDATED = 1_792_850_700_999;
    private const LINK = 'Rt3dEf6hIj9kLm2nOp5qRs8t';
    /** The light constructor: what the factory takes from the container. */
    private const LIGHT = [IL10N::class, IURLGenerator::class, IAppManager::class, IUserManager::class, ITimeFactory::class, IUserSession::class,
        GuestsAppWhitelist::class];

    private AccessHarness $h;
    private string $webroot = '';
    private string $lang = 'en';
    private ?IUser $sessionUser = null;
    /** @var list<string> every container get() */
    private array $gets = [];
    /** @var list<string> uids asked through IAppManager::isEnabledForUser */
    private array $appCalls = [];
    /** @var list<array{0: mixed, 1: string, 2: string}> formatDateTime(timestamp, date, time) calls */
    private array $formats = [];
    /** @var list<array{0: string, 1: array}> linkToRouteAbsolute calls */
    private array $routes = [];
    /** @var array<string, string> */
    private static array $de = [];
    /**
     * The items of the sketch (job 236): sketchBoxes() gives $boxes, stylesOf()
     * the asked ids of $styles; every call is logged in $reads.
     */
    private ItemStore $items;

    public static function setUpBeforeClass(): void {
        self::$de = json_decode((string)file_get_contents(dirname(__DIR__, 3) . '/l10n/de.json'), true, 512, JSON_THROW_ON_ERROR)['translations'];
    }

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->items = new class(Fake::of(IDBConnection::class)) extends ItemStore {
            /** @var list<string> */
            public array $reads = [];
            /** @var list<array<string, mixed>> */
            public array $boxes = [];
            /** @var array<string, ?string> */
            public array $styles = [];

            public function sketchBoxes(int $board): array {
                $this->reads[] = "boxes $board";
                return $this->boxes;
            }

            public function stylesOf(int $board, array $ids): array {
                $this->reads[] = "styles $board";
                return array_intersect_key($this->styles, array_flip($ids));
            }
        };
        // Board 42 has a frame and a note in it unless a test empties it.
        $this->items->boxes = [
            ['id' => '01F', 'type' => 'frame', 'parent_id' => null, 'x' => 0, 'y' => 0, 'w' => 1000, 'h' => 500],
            ['id' => '01N', 'type' => 'sticky', 'parent_id' => '01F', 'x' => 100, 'y' => 100, 'w' => 200, 'h' => 200],
        ];
        $this->items->styles = ['01N' => '{"fill":"#FFEB3B"}'];
    }

    /** The picture of a card with the sketch of $this->items, as the provider builds it. */
    private function sketchImage(): string {
        $sketch = BoardSketch::of($this->items->boxes, fn (array $ids): array => array_intersect_key($this->items->styles, array_flip($ids)));
        $this->assertNotSame([], $sketch, 'precondition: a sketch');
        return 'data:image/svg+xml;base64,' . base64_encode(BoardSketch::svg($sketch));
    }

    // ── fakes ───────────────────────────────────────────────────────────────

    private function base(): string {
        return self::ORIGIN . $this->webroot;
    }

    private function urls(): IURLGenerator {
        $abs = function (string $url): string {
            // As OC\URLGenerator: a webroot already in front is not repeated.
            if ($this->webroot !== '' && str_starts_with($url, $this->webroot)) {
                $url = substr($url, strlen($this->webroot));
            }
            return $this->base() . (str_starts_with($url, '/') ? '' : '/') . $url;
        };
        return Fake::of(IURLGenerator::class, [
            'getAbsoluteURL' => $abs,
            'imagePath' => fn (string $app, string $file): string => $this->webroot . '/custom_apps/' . $app . '/img/' . $file,
            'linkToRouteAbsolute' => function (string $route, array $args = []) use ($abs): string {
                $this->routes[] = [$route, $args];
                return $route === 'knorke.page.board' ? $abs('/index.php/apps/knorke/b/' . $args['id']) : $abs('/index.php/nope');
            },
            'linkToRoute' => fn (string $route, array $args = []): string => throw new \LogicException('relative link: ' . $route),
        ]);
    }

    private function l10n(): IL10N {
        return Fake::of(IL10N::class, [
            't' => fn (string $text, $parameters = []): string => vsprintf($this->lang === 'de' ? (self::$de[$text] ?? $text) : $text, (array)$parameters),
            'n' => function (string $singular, string $plural, int $count, array $parameters = []): string {
                $forms = $this->lang === 'de' ? (self::$de["_{$singular}_::_{$plural}_"] ?? [$singular, $plural]) : [$singular, $plural];
                return vsprintf(str_replace('%n', (string)$count, $forms[$count === 1 ? 0 : 1]), $parameters);
            },
        ]);
    }

    /** The container of the app as the factory and the provider see it; every get() is logged. */
    private function container(): ContainerInterface {
        $h = $this->h;
        $l = $this->l10n();
        $urls = $this->urls();
        $apps = Fake::of(IAppManager::class, ['isEnabledForUser' => function (string $app, ?IUser $user = null) use ($h): bool {
            $this->appCalls[] = $app . ' ' . ($user?->getUID() ?? '-');
            return $h->apps->isEnabledForUser($app, $user);
        }]);
        $users = Fake::of(IUserManager::class, ['getDisplayName' => fn (string $uid): ?string => match (true) {
            $uid === 'alice' => 'Alice Adler',
            default => $h->users->getDisplayName($uid),
        }]);
        $time = Fake::of(ITimeFactory::class, [
            'getTime' => fn (): int => $h->time,
            'now' => fn (): \DateTimeImmutable => new \DateTimeImmutable('@' . $h->time),
        ]);
        $session = Fake::of(IUserSession::class, ['getUser' => fn (): ?IUser => $this->sessionUser]);
        $formatter = Fake::of(IDateTimeFormatter::class, [
            'formatDateTime' => function ($timestamp, $formatDate = 'long', $formatTime = 'medium', $timeZone = null, $l = null): string {
                $this->formats[] = [$timestamp, $formatDate, $formatTime];
                return $this->lang === 'de' ? '24.10.2026, 14:05' : 'Oct 24, 2026, 2:05 PM';
            },
        ]);
        $c = null;
        $guestsApp = null;
        $c = Fake::of(ContainerInterface::class, [
            'get' => function (string $id) use (&$c, &$guestsApp, $h, $l, $urls, $apps, $users, $time, $session, $formatter): mixed {
                if ($id === GuestsAppWhitelist::WHITELIST) {
                    // The Guests app (FakeGuestsWhitelist), not logged in $gets; null: as without that app.
                    return $h->guests ?? throw new class('no ' . $id) extends \RuntimeException implements NotFoundExceptionInterface {
                    };
                }
                $this->gets[] = $id;
                return match ($id) {
                    IL10N::class => $l,
                    IURLGenerator::class => $urls,
                    IAppManager::class => $apps,
                    IUserManager::class => $users,
                    ITimeFactory::class => $time,
                    IUserSession::class => $session,
                    GuestsAppWhitelist::class => $guestsApp ??= new GuestsAppWhitelist($c),
                    BoardStore::class => $h->boards,
                    Access::class => $h->access,
                    LinkPolicy::class => $h->policy,
                    IDateTimeFormatter::class => $formatter,
                    BoardSketch::class => $h->sketches($this->items),
                    default => throw new \LogicException('reference container: ' . $id),
                };
            },
            'has' => fn (string $id): bool => true,
        ]);
        return $c;
    }

    /** The factory Application::register() registers for BoardReferenceProvider. */
    private function factory(): \Closure {
        $factories = [];
        $context = Fake::of(IRegistrationContext::class, [
            'registerService' => function (string $name, callable $factory, bool $shared = true) use (&$factories): void {
                $factories[$name] = $factory;
            },
        ]);
        (new \ReflectionClass(Application::class))->newInstanceWithoutConstructor()->register($context);
        $this->assertArrayHasKey(BoardReferenceProvider::class, $factories);
        return \Closure::fromCallable($factories[BoardReferenceProvider::class]);
    }

    /** A provider built by the registered factory for the session account $uid (null: none). */
    private function provider(?string $uid = 'alice'): BoardReferenceProvider {
        $this->sessionUser = $uid === null ? null : $this->user($uid);
        $p = ($this->factory())($this->container());
        $this->assertInstanceOf(BoardReferenceProvider::class, $p);
        return $p;
    }

    private function user(string $uid): IUser {
        return $this->h->user($uid) ?? throw new \LogicException($uid);
    }

    /** The board address as "Copy board link" gives it (with /index.php) or the pretty one. */
    private function url(int $id = 42, bool $index = true): string {
        return $this->base() . ($index ? '/index.php' : '') . '/apps/knorke/b/' . $id;
    }

    /** Board 42 of $owner ("Retro", $items items, changed at UPDATED). */
    private function board42(string $owner = 'alice', int $items = 42): int {
        $b = $this->h->boards;
        $id = $b->addBoard($owner, 'Retro');
        $row = $b->boards[$id];
        unset($b->boards[$id]);
        $b->boards[42] = ['id' => 42, 'item_count' => $items, 'updated_at' => self::UPDATED] + $row;
        return 42;
    }

    /**
     * Board 42 of alice, shared with bob ("Can view"), carol a member through
     * a valid edit link; returns the link id.
     */
    private function sharedBoard(): int {
        $this->board42();
        $this->h->shareRows->add(42, 'user', 'bob', 'view');
        $link = $this->h->boards->insertLink(42, self::LINK, 'edit', 'alice', 1);
        $this->h->boards->addMember(42, 'carol', 'edit', $link, 1);
        return $link;
    }

    private function clearLogs(): void {
        $this->h->boards->log = [];
        $this->h->shareRows->log = [];
        $this->h->mem->log = [];
        $this->h->mem->data = [];
        $this->h->policyCalls = [];
        $this->h->tx = [];
        $this->h->sharePolicy->reset();
        $this->gets = [];
        $this->appCalls = [];
        $this->formats = [];
        $this->routes = [];
        $this->items->reads = [];
    }

    /**
     * resolveReference() as $uid on a fresh provider, after clearLogs(); the
     * factory's gets are dropped. No card: no item read, no BoardSketch built.
     */
    private function resolve(string $text, ?string $uid = 'alice'): ?IReference {
        $this->clearLogs();
        $p = $this->provider($uid);
        $this->gets = [];
        $this->appCalls = [];
        $r = $p->resolveReference($text);
        $this->assertNoWrite();
        if ($r === null) {
            $this->assertSame([], $this->items->reads, 'no card: no item read');
            $this->assertNotContains(BoardSketch::class, $this->gets, 'no card: the sketch never asked');
        }
        return $r;
    }

    /** BoardStore and FastCache saw no writing call (nor any cache access at all). */
    private function assertNoWrite(): void {
        foreach ($this->h->boards->log as $call) {
            $this->assertContains($call, ['pin', 'findBoardForUser'], 'only reads of the board store');
        }
        $this->assertSame([], $this->h->mem->data, 'no grants, no gens in FastCache');
        $this->assertSame([], $this->h->mem->log, 'FastCache not even read');
        $this->assertSame([], $this->h->tx, 'no transaction');
    }

    // ── AK1: recognising ────────────────────────────────────────────────────

    /** @return array<string, array{0: string, 1: bool}> address (B = the base) → matches */
    public static function addresses(): array {
        return [
            'board' => ['B/apps/knorke/b/42', true],
            'board with index.php' => ['B/index.php/apps/knorke/b/42', true],
            'edit or vote link' => ['B/apps/knorke/p/Ab3dEf6hIj9kLm2nOp5qRs8t', true],
            'join link' => ['B/apps/knorke/join/Ab3dEf6hIj9kLm2nOp5qRs8t', true],
            'board list' => ['B/apps/knorke/', true],
            'a link of another instance' => ['https://andere.example/apps/knorke/p/x', true],
            'http, upper-case scheme' => ['HTTP://cloud.example/index.php/apps/knorke/b/42', true],
            'board with a slash' => ['B/apps/knorke/b/42/', true],
            'board with a query' => ['B/apps/knorke/b/42?x', true],
            'deck' => ['B/apps/deck/board/1', false],
            'files' => ['B/index.php/apps/files/', false],
            'knorke without the slash' => ['B/apps/knorkex/b/42', false],
            'text without an address' => ['see /apps/knorke/b/42 for the retro', false],
            'another scheme' => ['ftp://cloud.example/apps/knorke/b/42', false],
            'no host' => ['https:///apps/knorke/b/42', false],
            'empty' => ['', false],
        ];
    }

    #[DataProvider('addresses')]
    public function testMatchReference(string $address, bool $match): void {
        $p = $this->provider();
        $this->gets = [];
        $this->appCalls = [];
        $this->assertSame($match, $p->matchReference(str_replace('B/', $this->base() . '/', $address)));
        $this->assertSame([], $this->gets, 'matching builds nothing');
        $this->assertSame([], $this->appCalls);
        $this->assertSame([], $this->h->boards->log);
    }

    // ── AK2: the card ───────────────────────────────────────────────────────

    /** @return array<string, array{0: string, 1: list<string>}> session account → container gets of resolve */
    public static function readers(): array {
        return [
            'the owner' => ['alice', [BoardStore::class, IDateTimeFormatter::class, BoardSketch::class]],
            'a share "Can view"' => ['bob', [BoardStore::class, Access::class, IDateTimeFormatter::class, BoardSketch::class]],
            'a member through a valid link' => ['carol', [BoardStore::class, Access::class, LinkPolicy::class, IDateTimeFormatter::class,
                BoardSketch::class]],
        ];
    }

    /** @param list<string> $gets */
    #[DataProvider('readers')]
    public function testTheCard(string $uid, array $gets): void {
        $this->sharedBoard();
        foreach ([true, false] as $index) {
            $url = $this->url(42, $index);
            $r = $this->resolve($url, $uid);
            $this->assertInstanceOf(IReference::class, $r, "$uid, " . ($index ? 'index.php' : 'pretty'));
            $this->assertSame($url, $r->getId());
            $this->assertSame('Retro', $r->getTitle());
            $this->assertSame('by Alice Adler · 42 items · Changed Oct 24, 2026, 2:05 PM', $r->getDescription());
            // Job 236: the board's sketch as an SVG inside the card.
            $this->assertSame($this->sketchImage(), $r->getImageUrl());
            $this->assertStringStartsWith('data:image/svg+xml;base64,', $r->getImageUrl());
            $this->assertSame('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="-20 0 160 80">'
                . '<rect x="-20" y="0" width="160" height="80" fill="#f3f2f0"/>'
                . '<rect x="4" y="12" width="112" height="56" fill="#ffffff" stroke="#7f8790" stroke-width="0.6"/>'
                . '<rect x="15.2" y="23.2" width="22.4" height="22.4" fill="#ffeb3b" stroke="#000000" stroke-opacity="0.25" stroke-width="0.4"/>'
                . '</svg>', base64_decode(substr($r->getImageUrl(), strlen('data:image/svg+xml;base64,')), true),
                'the frame white with its outline, the note at its absolute place in its colour');
            $this->assertSame(['boxes 42', 'styles 42'], $this->items->reads, 'the sketch of board 42, read after the rights');
            $this->assertSame('https://cloud.example/index.php/apps/knorke/b/42', $r->getUrl(), 'linkToRouteAbsolute of the board, also for the pretty address');
            $this->assertSame([['knorke.page.board', ['id' => 42]]], $this->routes);
            $this->assertSame('open-graph', $r->getRichObjectType(), 'Nextcloud\'s default widget');
            $this->assertSame(['id' => $url, 'name' => 'Retro', 'description' => $r->getDescription(), 'thumb' => $r->getImageUrl(),
                'link' => $r->getUrl()], $r->jsonSerialize()['openGraphObject']);
            $this->assertTrue($r->getAccessible());
            $this->assertSame([[1_792_850_700, 'medium', 'short']], $this->formats, 'floor(updated_at / 1000), medium date, short time');
            $this->assertSame(['pin', 'findBoardForUser'], $this->h->boards->log, 'pin first, then the one read');
            $this->assertSame($gets, $this->gets, 'heavy services only now, each once');
            $this->assertSame(['knorke ' . $uid], $this->appCalls, '"Limit to groups" for the session account');
            $this->assertSame($uid === 'carol' ? ['alice'] : [], $this->h->policyCalls, 'the owner\'s link policy only for the link membership');
        }
    }

    /**
     * No boxes: no items, or connectors only (sketchBoxes() leaves them out,
     * BoardSketchTest testJob236Ak2ConnectorsOnlyIsEmptyOfBoardReadsNoRights).
     */
    public function testAnEmptyBoardKeepsTheSymbol(): void {
        $this->sharedBoard();
        $this->items->boxes = [];
        $this->items->styles = [];
        foreach (['alice', 'bob', 'carol'] as $uid) {
            $r = $this->resolve($this->url(), $uid);
            $this->assertSame('Retro', $r?->getTitle());
            $this->assertSame('https://cloud.example/custom_apps/knorke/img/board-card.svg', $r?->getImageUrl(), "$uid: the Knorke symbol");
            $this->assertSame(['boxes 42'], $this->items->reads, 'one read, no styles');
        }
        // a text item of no size is still an item: its sketch, not the symbol
        $this->items->boxes = [['id' => '01T', 'type' => 'text', 'parent_id' => null, 'x' => 5, 'y' => 5, 'w' => 0, 'h' => 0]];
        $this->assertSame($this->sketchImage(), $this->resolve($this->url())?->getImageUrl());
    }

    public function testOneItemAndTheOwnerOfAForeignBoard(): void {
        $this->board42('bob', 1);
        $this->h->shareRows->add(42, 'user', 'alice', 'edit');
        $r = $this->resolve($this->url());
        $this->assertSame('by Bob Display · 1 item · Changed Oct 24, 2026, 2:05 PM', $r?->getDescription());
        $this->h->boards->boards[42]['owner'] = 'knorke-nope-zed';
        $this->assertSame('by knorke-nope-zed · 1 item · Changed Oct 24, 2026, 2:05 PM', $this->resolve($this->url())?->getDescription(),
            'an owner the user manager does not know: the uid');
    }

    public function testGermanCard(): void {
        $this->board42();
        $this->lang = 'de';
        $this->assertSame('von Alice Adler · 42 Objekte · Geändert am 24.10.2026, 14:05', $this->resolve($this->url())?->getDescription());
        $this->h->boards->boards[42]['item_count'] = 1;
        $this->assertSame('von Alice Adler · 1 Objekt · Geändert am 24.10.2026, 14:05', $this->resolve($this->url())?->getDescription());
        $this->assertSame('Geändert am %s', self::$de['Changed %s'] ?? null);
        $this->assertSame(['%n Objekt', '%n Objekte'], self::$de['_%n item_::_%n items_'] ?? null);
        // vsprintf: one %s and nothing else, or the translation throws a ValueError.
        $this->assertSame(1, substr_count(self::$de['Changed %s'], '%'));
    }

    public function testAWebrootIsPartOfTheBase(): void {
        $this->board42();
        $this->webroot = '/nc';
        $this->items->boxes = [];
        $r = $this->resolve('https://cloud.example/nc/apps/knorke/b/42');
        $this->assertSame('https://cloud.example/nc/index.php/apps/knorke/b/42', $r?->getUrl());
        $this->assertSame('https://cloud.example/nc/custom_apps/knorke/img/board-card.svg', $r?->getImageUrl(), 'an empty board');
        $this->assertNull($this->resolve('https://cloud.example/apps/knorke/b/42'), 'without the webroot: not this instance\'s address');
        $this->assertSame([], $this->h->boards->log);
    }

    // ── AK3: no card ────────────────────────────────────────────────────────

    public function testAnUnknownBoardAndAnAccountWithoutARole(): void {
        $this->sharedBoard();
        $this->assertNull($this->resolve($this->url(43)), 'no board 43');
        $this->assertSame(['pin', 'findBoardForUser'], $this->h->boards->log);
        $this->assertSame([BoardStore::class], $this->gets);
        $this->assertNull($this->resolve($this->url(), 'dave'), 'dave has no share and no membership');
        $this->assertSame(['pin', 'findBoardForUser'], $this->h->boards->log);
        $this->assertSame([BoardStore::class, Access::class], $this->gets, 'no formatter: no card');
        $this->assertSame(['forBoard 42'], $this->h->shareRows->log, 'roleFor() asked');
        $this->assertSame([], $this->formats);
    }

    public function testARemovedShare(): void {
        $this->sharedBoard();
        $this->assertNotNull($this->resolve($this->url(), 'bob'));
        $this->h->shares->save('alice', 42, []);
        $this->assertSame([], $this->h->shareRows->of(42), 'precondition: roleFor finds no row');
        $this->assertNull($this->resolve($this->url(), 'bob'));
    }

    /** @return array<string, array{0: string}> */
    public static function deadLinks(): array {
        return [
            'revoked' => ['revoked'],
            'expired' => ['expired'],
            'link policy off for the owner' => ['policy'],
        ];
    }

    #[DataProvider('deadLinks')]
    public function testALinkMembershipThatNoLongerCounts(string $how): void {
        $link = $this->sharedBoard();
        $this->assertNotNull($this->resolve($this->url(), 'carol'));
        match ($how) {
            'revoked' => $this->h->boards->links[$link]['revoked_at'] = $this->h->nowMs(),
            'expired' => $this->h->boards->links[$link]['expires_at'] = $this->h->nowMs() - 1,
            'policy' => $this->h->linksAllowed['alice'] = false,
        };
        $this->assertArrayHasKey('carol', $this->h->boards->members[42], 'the member row stays');
        $this->assertNull($this->resolve($this->url(), 'carol'));
        $this->assertSame($how === 'policy' ? ['alice'] : [], $this->h->policyCalls, 'the policy only while the membership is valid');
        $this->assertNotNull($this->resolve($this->url(), 'bob'), 'the share of bob does not depend on the link');
    }

    public function testNoAccount(): void {
        $this->board42();
        $this->assertNull($this->resolve($this->url(), null));
        $this->assertSame([], $this->h->boards->log, 'nothing read');
        $this->assertSame([], $this->gets);
        $this->assertSame([], $this->appCalls, 'without an account isEnabledForUser() is not asked');
    }

    public function testAnAccountOutsideTheGroupLimit(): void {
        $this->board42();
        $this->h->knorkeFor['alice'] = false;
        $this->h->backends['alice'] = 'Guests';
        $this->h->guests = new FakeGuestsWhitelist(true);
        $this->assertNull($this->resolve($this->url()));
        $this->assertSame(['knorke alice'], $this->appCalls);
        $this->assertSame([], $this->h->guests->calls, 'the group limit first: the Guests app is not asked');
        $this->assertSame([], $this->h->boards->log);
        $this->assertSame([], $this->gets);
    }

    public function testAGuestsAccount(): void {
        $this->board42();
        $this->h->shareRows->add(42, 'user', 'gast', 'view');
        $this->h->backends['gast'] = 'Guests';
        $this->h->guests = new FakeGuestsWhitelist(false);
        $this->assertNull($this->resolve($this->url(), 'gast'), 'Knorke not on the whitelist');
        $this->assertSame([['gast', '/apps/knorke/'], ['gast', '/apps/knorke/']], $this->h->guests->calls,
            'asked by the factory (picker entry) and by resolveReference(), for the fixed path');
        $this->assertSame([], $this->h->boards->log);
        $this->h->guests->answer = true;
        $this->assertSame('Retro', $this->resolve($this->url(), 'gast')?->getTitle(), 'let in: the card as for anyone with a share');
        $this->h->guests = null;
        $this->assertNull($this->resolve($this->url(), 'gast'), 'without the Guests app: closed');
    }

    /** @return array<string, array{0: string}> */
    public static function noCard(): array {
        return [
            'edit or vote link' => ['B/index.php/apps/knorke/p/' . self::LINK],
            'join link' => ['B/index.php/apps/knorke/join/' . self::LINK],
            'board list' => ['B/apps/knorke/'],
            'board list with index.php' => ['B/index.php/apps/knorke/'],
            'a slash after the id' => ['B/apps/knorke/b/42/'],
            'a query' => ['B/apps/knorke/b/42?x'],
            'a fragment' => ['B/apps/knorke/b/42#x'],
            'a trailing newline' => ["B/apps/knorke/b/42\n"],
            'a leading zero' => ['B/apps/knorke/b/042'],
            'id 0' => ['B/apps/knorke/b/0'],
            'an id of 19 digits' => ['B/apps/knorke/b/1234567890123456789'],
            'another host' => ['https://andere.example/apps/knorke/b/42'],
            'another host, same name in the path' => ['https://andere.example/cloud.example/apps/knorke/b/42'],
            'another scheme of the same host' => ['http://cloud.example/apps/knorke/b/42'],
            'another port' => ['https://cloud.example:8443/apps/knorke/b/42'],
            'credentials before the host' => ['https://x@cloud.example/apps/knorke/b/42'],
            'a sub-path' => ['B/apps/knorke/b/42/snapshot'],
            'twice index.php' => ['B/index.php/index.php/apps/knorke/b/42'],
        ];
    }

    #[DataProvider('noCard')]
    public function testNoCardForOtherAddresses(string $address): void {
        $this->sharedBoard();
        $text = str_replace('B/', $this->base() . '/', $address);
        $this->assertNull($this->resolve($text));
        $this->assertSame([], $this->h->boards->log, 'nothing read');
        $this->assertSame([], $this->gets);
        $this->assertSame([], $this->appCalls, 'not even the account is asked');
    }

    #[DataProvider('addresses')]
    public function testPublicPagesNeverGetACard(string $address, bool $match): void {
        $this->sharedBoard();
        $text = str_replace('B/', $this->base() . '/', $address);
        foreach (['alice', null] as $uid) {
            $this->clearLogs();
            $p = $this->provider($uid);
            $this->gets = [];
            $this->assertInstanceOf(IPublicReferenceProvider::class, $p, 'public lookups stop here, no OpenGraph fetch');
            $this->assertNull($p->resolveReferencePublic($text, 'shareToken123'));
            $this->assertNull($p->getCacheKeyPublic($text, 'shareToken123'));
            $this->assertSame([], $this->h->boards->log);
            $this->assertSame([], $this->gets);
            $this->assertNoWrite();
        }
    }

    // ── AK4: cache ──────────────────────────────────────────────────────────

    public function testCachePrefixAndKey(): void {
        $p = $this->provider();
        $this->assertSame('knorke:42', $p->getCachePrefix($this->url()));
        $this->assertSame('knorke:42', $p->getCachePrefix($this->url(42, false)));
        $this->assertSame('knorke:7', $p->getCachePrefix($this->url(7)));
        $minute = intdiv($this->h->time, 60);
        $this->assertSame('alice:' . $minute, $p->getCacheKey($this->url()));
        $this->h->time += 60;
        $this->assertSame('alice:' . ($minute + 1), $p->getCacheKey($this->url()), 'a new key after 60 s');
        $this->h->time = $minute * 60 + 59;
        $this->assertSame('alice:' . $minute, $p->getCacheKey($this->url()), 'the same key within the minute');
        $this->assertNull($p->getCacheKeyPublic($this->url(), 'shareToken123'));
        $alice = $p->getCacheKey($this->url());
        $bob = $this->provider('bob')->getCacheKey($this->url());
        $this->assertSame('bob:' . $minute, $bob, 'per account');
        $this->assertNotSame($alice, $bob);
        $this->assertSame('knorke', $p->getCachePrefix($this->base() . '/apps/knorke/p/' . self::LINK), 'other Knorke addresses: never cached anyway');
        $this->assertSame([], $this->h->boards->log);
    }

    // ── AK5: the picker ─────────────────────────────────────────────────────

    public function testThePickerForAnAdmittedAccount(): void {
        $this->clearLogs();
        $p = $this->provider();
        $this->assertInstanceOf(BoardPickerProvider::class, $p);
        $this->assertInstanceOf(ISearchableReferenceProvider::class, $p);
        $this->assertInstanceOf(IPublicReferenceProvider::class, $p);
        $this->assertSame(self::LIGHT, $this->gets, 'the factory takes light services only');
        $this->assertSame(['knorke alice'], $this->appCalls);
        $this->gets = [];
        $want = [
            'id' => 'knorke',
            'title' => 'Knorke boards',
            'icon_url' => 'https://cloud.example/custom_apps/knorke/img/app-dark.svg',
            'order' => 10,
            'search_providers_ids' => ['knorke'],
        ];
        $this->assertSame($want, $p->jsonSerialize());
        $this->assertSame(json_encode($want), json_encode($p), 'JsonSerializable as ADiscoverableReferenceProvider');
        $this->assertSame([BoardSearchProvider::ID], $p->getSupportedSearchProviderIds(), 'the unified search provider of Knorke');
        $this->assertSame([], $this->gets, 'the entry needs nothing more');
        $this->assertSame([], $this->h->boards->log);
        $this->lang = 'de';
        $this->assertSame('Knorke-Boards', $this->provider()->getTitle());
    }

    /** @return array<string, array{0: string}> */
    public static function keptOut(): array {
        return [
            'no account' => ['none'],
            '"Limit to groups"' => ['group'],
            'a Guests account Knorke is not let in' => ['guest'],
            'a Guests account, the Guests app broken' => ['broken'],
        ];
    }

    #[DataProvider('keptOut')]
    public function testNoPickerEntryForAnAccountKeptOut(string $how): void {
        $this->sharedBoard();
        $uid = match ($how) {
            'none' => null,
            'group' => 'alice',
            'guest', 'broken' => 'gast',
        };
        if ($how === 'group') {
            $this->h->knorkeFor['alice'] = false;
        }
        if ($uid === 'gast') {
            $this->h->backends['gast'] = 'Guests';
            $this->h->guests = $how === 'guest' ? new FakeGuestsWhitelist(false) : new FakeGuestsWhitelist(true, new \RuntimeException('guests broken'));
        }
        $this->clearLogs();
        $p = $this->provider($uid);
        $this->assertNotInstanceOf(IDiscoverableReferenceProvider::class, $p, 'no picker entry');
        $this->assertSame(BoardReferenceProvider::class, $p::class);
        $this->assertInstanceOf(IReferenceProvider::class, $p);
        $this->assertTrue($p->matchReference($this->url()), 'board addresses are still recognised: no OpenGraph fetch');
        $this->assertTrue($p->matchReference($this->base() . '/apps/knorke/p/' . self::LINK));
        $this->assertNull($p->resolveReference($this->url()));
        $this->assertSame(self::LIGHT, $this->gets, 'nothing beyond the light services');
        $this->assertSame([], $this->h->boards->log);
        $this->assertSame($uid === null ? [] : ['knorke ' . $uid, 'knorke ' . $uid], $this->appCalls, 'factory and resolve ask, without an account neither');
    }

    public function testEveryBuildAsksAgain(): void {
        $f = $this->factory();
        $this->sessionUser = $this->user('alice');
        $c = $this->container();
        $this->assertInstanceOf(BoardPickerProvider::class, $f($c));
        $this->h->knorkeFor['alice'] = false;
        $this->assertNotInstanceOf(IDiscoverableReferenceProvider::class, $f($c), 'the limit changed: the next build follows');
        $this->h->knorkeFor['alice'] = true;
        $this->sessionUser = null;
        $this->assertNotInstanceOf(IDiscoverableReferenceProvider::class, $f($c));
    }

    public function testTheSourceStaysReadOnly(): void {
        $code = '';
        foreach (['BoardReferenceProvider', 'BoardPickerProvider'] as $class) {
            foreach (token_get_all((string)file_get_contents(dirname(__DIR__, 3) . "/lib/Reference/$class.php")) as $t) {
                if (!is_array($t) || ($t[0] !== T_COMMENT && $t[0] !== T_DOC_COMMENT)) {
                    $code .= is_array($t) ? $t[1] : $t;
                }
            }
        }
        $this->assertStringContainsString('->memberRole(', $code, 'the rights path of a foreign board, as the search');
        $this->assertStringContainsString('->ofBoard(', $code, 'the sketch (job 236) without a rights check of its own, after the provider\'s');
        foreach (['->forUser', '->forGuest', '->joinGuest', '->throttle', 'FastCache', 'ItemStore', '->meta(', '->lockBoard(', 'getQueryBuilder',
            'executeQuery', '->isUrlAllowed('] as $needle) {
            $this->assertStringNotContainsString($needle, $code, "$needle: read only, no rights seeding, the Guests app only through the helper");
        }
    }

    // ── Job 245 ────────────────────────────────────────────────────────────

    public function testNoPreviewOfABoardOfADisabledOwner(): void {
        $this->sharedBoard();
        $this->h->disabledUsers = ['alice'];
        foreach (['bob', 'carol'] as $uid) {
            $this->assertNull($this->resolve($this->url(), $uid), "$uid: share and link member see nothing");
        }
        $this->h->disabledUsers = [];
        $this->assertSame('Retro', $this->resolve($this->url(), 'bob')?->getTitle(), 'enabled again');
    }
}
