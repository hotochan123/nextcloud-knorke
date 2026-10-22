<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Search\BoardSearchProvider;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeBoardStore;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Search\ISearchQuery;
use OCP\Search\SearchResult;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;

/**
 * "Knorke boards" in Nextcloud's unified search (M2, SPEC-M1 §1.2, §11 Q8):
 * a light constructor, candidates from the board list (own, shares, valid
 * link memberships), Access::memberRole() per foreign hit, the owner's link
 * policy only for link memberships, only the title searched, the keyset
 * cursor, invalid input that reads nothing, the German texts. Built on
 * AccessHarness (real Access, ShareService and SharePolicy over the fake
 * stores, LinkPolicy from $linksAllowed); the IL10N fake translates from
 * l10n/de.json with vsprintf, like Nextcloud's L10N.
 */
final class BoardSearchProviderTest extends TestCase {
    private AccessHarness $h;
    /** @var list<string> every container get()/has() of the provider */
    private array $gets = [];
    private bool $appEnabled = true;
    /** @var list<string> app ids asked through IAppManager::isEnabledForUser */
    private array $appCalls = [];
    /** @var list<?IUser> the account argument of each isEnabledForUser call, as passed (job 070) */
    private array $appUsers = [];
    /** @var list<array{0: string, 1: array}> linkToRoute calls */
    private array $routes = [];
    /** @var list<string> uids asked through IUserManager::getDisplayName */
    private array $names = [];
    /** Hand the provider a SharePolicy that logs groupIdsOf/teamsOf into the board log. */
    private bool $policyProbe = false;
    /**
     * What the container hands out for BoardSearchProvider::GUESTS_WHITELIST
     * (usually a whitelist() fake); null: NotFoundExceptionInterface, as
     * without the Guests app.
     */
    private ?object $guests = null;
    /** What the provider's IUserSession answers for getUser() (getOrder, job 055). */
    private ?IUser $sessionUser = null;
    /** @var array<string, string> */
    private static array $de = [];

    public static function setUpBeforeClass(): void {
        self::$de = json_decode((string)file_get_contents(dirname(__DIR__, 3) . '/l10n/de.json'), true, 512, JSON_THROW_ON_ERROR)['translations'];
    }

    protected function setUp(): void {
        $this->h = new AccessHarness();
    }

    private function provider(): BoardSearchProvider {
        $h = $this->h;
        $policy = !$this->policyProbe ? $h->sharePolicy : new class($h->sharePolicy, $h->boards) extends SharePolicy {
            public function __construct(private SharePolicy $inner, private FakeBoardStore $boards) {
            }

            public function groupIdsOf(IUser $user): array {
                $this->boards->log[] = 'groupIdsOf';
                return $this->inner->groupIdsOf($user);
            }

            public function teamsOf(IUser $user): array {
                $this->boards->log[] = 'teamsOf';
                return $this->inner->teamsOf($user);
            }
        };
        $container = Fake::of(ContainerInterface::class, [
            'get' => function (string $id) use ($h, $policy): mixed {
                $this->gets[] = $id;
                return match ($id) {
                    BoardStore::class => $h->boards,
                    SharePolicy::class => $policy,
                    Access::class => $h->access,
                    LinkPolicy::class => $h->policy,
                    BoardSearchProvider::GUESTS_WHITELIST => $this->guests ?? throw new class('no ' . $id) extends \RuntimeException implements NotFoundExceptionInterface {
                    },
                    default => throw new \LogicException('search container: ' . $id),
                };
            },
            'has' => function (string $id): bool {
                $this->gets[] = 'has ' . $id;
                return true;
            },
        ]);
        $l = Fake::of(IL10N::class, ['t' => fn (string $text, $parameters = []): string => vsprintf(self::$de[$text] ?? $text, (array)$parameters)]);
        $urls = Fake::of(IURLGenerator::class, [
            'linkToRoute' => function (string $route, array $args = []): string {
                $this->routes[] = [$route, $args];
                return $route === 'knorke.page.board' ? '/index.php/apps/knorke/b/' . $args['id'] : '/index.php/nope';
            },
            'imagePath' => fn (string $app, string $file): string => '/custom_apps/' . $app . '/img/' . $file,
        ]);
        $apps = Fake::of(IAppManager::class, ['isEnabledForUser' => function ($app, $user = null): bool {
            $this->appCalls[] = (string)$app;
            $this->appUsers[] = $user;
            return $app === 'knorke' && $this->appEnabled;
        }]);
        $users = Fake::of(IUserManager::class, ['getDisplayName' => function (string $uid) use ($h): ?string {
            $this->names[] = $uid;
            return $h->users->getDisplayName($uid);
        }]);
        $time = Fake::of(ITimeFactory::class, [
            'getTime' => fn (): int => $h->time,
            'now' => fn (): \DateTimeImmutable => new \DateTimeImmutable('@' . $h->time),
        ]);
        $session = Fake::of(IUserSession::class, ['getUser' => fn (): ?IUser => $this->sessionUser]);
        return new BoardSearchProvider($l, $urls, $apps, $users, $time, $container, $session, new GuestsAppWhitelist($container));
    }

    private function query(string $term, mixed $cursor = null, int $limit = 25): ISearchQuery {
        return Fake::of(ISearchQuery::class, [
            'getTerm' => fn (): string => $term,
            'getCursor' => fn (): mixed => $cursor,
            'getLimit' => fn (): int => $limit,
        ]);
    }

    private function search(string $term, mixed $cursor = null, int $limit = 25, string $uid = 'alice'): SearchResult {
        return $this->provider()->search($this->user($uid), $this->query($term, $cursor, $limit));
    }

    private function user(string $uid): IUser {
        return $this->h->user($uid) ?? throw new \LogicException($uid);
    }

    /** @return list<int> board ids of the entries (from resourceUrl) */
    private static function ids(SearchResult $r): array {
        return array_map(static fn ($e): int => (int)substr($e->jsonSerialize()['resourceUrl'], strlen('/index.php/apps/knorke/b/')), $r->jsonSerialize()['entries']);
    }

    /** @return list<string> titles of the entries */
    private static function titles(SearchResult $r): array {
        return array_map(static fn ($e): string => $e->jsonSerialize()['title'], $r->jsonSerialize()['entries']);
    }

    /** @return list<int> boards whose share rows were read (= roleFor calls) */
    private function roleChecks(): array {
        return array_map(static fn (string $l): int => (int)substr($l, strlen('forBoard ')),
            array_values(array_filter($this->h->shareRows->log, static fn (string $l): bool => str_starts_with($l, 'forBoard '))));
    }

    /** Forget what the setup logged and left in the cache (gens of enableLink/disableLink). */
    private function clearLogs(): void {
        $this->h->boards->log = [];
        $this->h->shareRows->log = [];
        $this->h->mem->log = [];
        $this->h->mem->data = [];
        $this->h->mem->expires = [];
        $this->h->policyCalls = [];
        $this->gets = [];
    }

    /** A search after clearLogs() and a fresh share policy memo, checked to be read only (AK7). */
    private function cleanSearch(string $term, mixed $cursor = null, int $limit = 25, string $uid = 'alice'): SearchResult {
        $this->clearLogs();
        $this->h->sharePolicy->reset();
        $r = $this->search($term, $cursor, $limit, $uid);
        $this->assertReadOnly();
        return $r;
    }

    private function assertReadOnly(): void {
        $this->assertSame(['pin', 'listForUser'], $this->h->boards->log, 'only the list: no findBoardForUser, no lock, no member write');
        $this->assertSame([], $this->h->mem->data, 'no grants, no gens: the search only reads');
        $this->assertSame([], $this->h->mem->log);
    }

    /** @return list<int> ids of $uid's board list whose title contains $needle (case-insensitive), ascending */
    private function listed(string $needle, string $uid = 'alice'): array {
        $ids = [];
        foreach ($this->h->service->listFor($uid) as $b) {
            if (mb_stripos($b['title'], $needle) !== false) {
                $ids[] = $b['id'];
            }
        }
        sort($ids);
        return $ids;
    }

    /** @return array<int, array{0: string, 1: string}> board id → [source, role] in $uid's board list */
    private function listSources(string $uid = 'alice'): array {
        $out = [];
        foreach ($this->h->service->listFor($uid) as $b) {
            $out[$b['id']] = [$b['source'], $b['role']];
        }
        return $out;
    }

    /** @param list<int> $ids @return list<int> */
    private static function sorted(array $ids): array {
        sort($ids);
        return $ids;
    }

    /**
     * bob's "Retro Edit" with an edit link and carol's "Retro Vote" with a
     * voting link, alice joined both through BoardService (AK2).
     *
     * @return array{0: int, 1: int} [$e, $v]
     */
    private function joined(): array {
        $e = $this->h->service->create('bob', 'Retro Edit')['id'];
        $edit = $this->h->service->enableLink('bob', $e, 'edit', [])['token'];
        $v = $this->h->service->create('carol', 'Retro Vote')['id'];
        $vote = $this->h->service->enableLink('carol', $v, 'vote', [])['token'];
        $this->assertSame($e, $this->h->service->joinLinkAsUser('alice', $edit));
        $this->assertSame($v, $this->h->service->joinLinkAsUser('alice', $vote));
        $this->clearLogs();
        return [$e, $v];
    }

    /** A board of $owner alice reaches only through a valid edit link; $expiresAt in ms (null: none). */
    private function linkBoard(string $title, ?int $expiresAt = null, string $owner = 'bob'): int {
        $id = $this->h->boards->addBoard($owner, $title);
        $link = $this->h->boards->insertLink($id, sprintf('Lk%022d', $id), 'edit', $owner, 1, null, $expiresAt);
        $this->h->boards->addMember($id, 'alice', 'edit', $link, 1);
        return $id;
    }

    /**
     * The boards of AK3, all titled "Workshop …": A own, B user share,
     * C group share (staff), D team share, E no share, F only a link
     * membership, G a group alice is not in.
     *
     * @return array{A: int, B: int, C: int, D: int, E: int, F: int, G: int}
     */
    private function rights(): array {
        $b = $this->h->boards;
        $s = $this->h->shareRows;
        $ids = [];
        $ids['A'] = $b->addBoard('alice', 'Workshop Alpha');
        $ids['B'] = $b->addBoard('bob', 'Workshop Beta');
        $s->add($ids['B'], 'user', 'alice', 'view');
        $ids['C'] = $b->addBoard('carol', 'Workshop Gamma');
        $s->add($ids['C'], 'group', 'staff', 'edit');
        $ids['D'] = $b->addBoard('bob', 'Workshop Delta');
        $this->h->teams = ['tWerk' => ['Werkstatt', ['alice', 'dave']]];
        $s->add($ids['D'], 'team', 'tWerk', 'view');
        $ids['E'] = $b->addBoard('bob', 'Workshop Epsilon');
        $ids['F'] = $b->addBoard('bob', 'Workshop Zeta');
        $link = $b->insertLink($ids['F'], 'Zt3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'bob', 1);
        $b->addMember($ids['F'], 'alice', 'edit', $link, 1);
        $ids['G'] = $b->addBoard('bob', 'Workshop Eta');
        $s->add($ids['G'], 'group', 'knorke-e2e', 'view');
        $this->clearLogs();
        return $ids;
    }

    // ── AK2: id, name, order, light constructor ────────────────────────────

    public function testIdNameOrderAndALightConstructor(): void {
        $p = $this->provider();
        $this->assertSame('knorke', BoardSearchProvider::ID);
        $this->assertSame(BoardSearchProvider::ID, $p->getId());
        $this->assertSame('Knorke-Boards', $p->getName(), 'the translation of "Knorke boards"');
        $this->assertSame(-5, $p->getOrder('knorke.page.board', ['id' => '7']));
        $this->assertSame(-5, $p->getOrder('knorke.page.index', []));
        $this->assertSame(20, $p->getOrder('files.view.index', []));
        $this->assertSame(20, $p->getOrder('knorkex.page.index', []), 'only the app id itself plus a dot');
        $this->assertSame([], $this->gets, 'constructor, getId, getName, getOrder never touch the container');
        $this->assertSame([], $this->h->boards->log);
        $this->assertSame([], $this->h->shareRows->log);
        $this->assertSame([], $this->appCalls);
    }

    // ── AK3: rights ─────────────────────────────────────────────────────────

    public function testOwnSharedAndLinkMemberBoards(): void {
        $ids = $this->rights();
        $r = $this->search('workshop');
        $this->assertSame([$ids['F'], $ids['D'], $ids['C'], $ids['B'], $ids['A']], self::ids($r), 'link, own, user, group, team; ids descending');
        $this->assertSame(['Workshop Zeta', 'Workshop Delta', 'Workshop Gamma', 'Workshop Beta', 'Workshop Alpha'], self::titles($r));
        $this->assertFalse($r->jsonSerialize()['isPaginated']);
        $this->assertSame([$ids['F'], $ids['D'], $ids['C'], $ids['B']], $this->roleChecks(), 'memberRole/roleFor for every foreign hit, never for the own board');
        $this->assertSame(['bob'], $this->h->policyCalls, 'the link policy only for F, the one link membership');
        $this->assertSame(['pin', 'listForUser'], $this->h->boards->log, 'pin before the list; no findBoardForUser, no lock, no write');
        $this->assertSame([], $this->h->mem->data, 'no grants, no gens: the search only reads');
        $this->assertSame([], $this->h->mem->log);
        $this->assertSame([BoardStore::class, SharePolicy::class, Access::class, LinkPolicy::class], $this->gets, 'each service once, nothing else');
        $this->assertSame(['knorke'], $this->appCalls);

        $f = $r->jsonSerialize()['entries'][0]->jsonSerialize();
        $this->assertSame('Workshop Zeta', $f['title']);
        $this->assertSame('von Bob Display', $f['subline']);
        $this->assertStringEndsWith('/apps/knorke/b/' . $ids['F'], $f['resourceUrl']);

        // The same boards as the board list ("Shared with me" included).
        $this->assertSame($this->listed('workshop'), self::sorted(self::ids($r)));
        $this->assertSame(['link', 'edit'], $this->listSources()[$ids['F']]);
    }

    public function testTeamSharesNeedTeamSupport(): void {
        $ids = $this->rights();
        $this->h->teamSupport = false;
        $this->assertSame([$ids['F'], $ids['C'], $ids['B'], $ids['A']], self::ids($this->search('workshop')));
        $this->assertSame([$ids['F'], $ids['C'], $ids['B']], $this->roleChecks());
    }

    public function testPinComesBeforeGroupsAndTeams(): void {
        $this->rights();
        $this->policyProbe = true;
        $this->search('workshop');
        $this->assertSame(['pin', 'groupIdsOf', 'teamsOf', 'listForUser'], $this->h->boards->log, 'SPEC-M1 §4.10.4 (R2)');
        $this->assertSame(['alice'], $this->h->teamCalls, 'teams read once per request (memo shared with roleFor)');
    }

    // ── AK4: roleFor() decides ──────────────────────────────────────────────

    /** @return array<string, array{0: int, 1: list<string>, 2: bool}> */
    public static function lateRemoval(): array {
        return [
            'no cap' => [25, ['F', 'D', 'B', 'A'], false],
            'limit 3 refills the page' => [3, ['F', 'D', 'B'], true],
        ];
    }

    /** @param list<string> $want */
    #[DataProvider('lateRemoval')]
    public function testRoleForDecidesAfterTheList(int $limit, array $want, bool $paginated): void {
        $ids = $this->rights();
        $c = $ids['C'];
        // C's share row goes after listForUser listed C, before its rights check.
        $this->h->shareRows->onRead = function (int $board) use ($c): void {
            if ($board === $c) {
                foreach ($this->h->shareRows->rows as $id => $r) {
                    if ($r['board_id'] === $c) {
                        unset($this->h->shareRows->rows[$id]);
                    }
                }
            }
        };
        $r = $this->search('workshop', null, $limit);
        $this->assertSame(array_map(static fn (string $k): int => $ids[$k], $want), self::ids($r));
        $this->assertSame($paginated, $r->jsonSerialize()['isPaginated']);
        if ($paginated) {
            $this->assertSame($ids['B'], $r->jsonSerialize()['cursor']);
        }
        $this->assertSame([$ids['F'], $ids['D'], $ids['C'], $ids['B']], $this->roleChecks(), 'the failed check costs one extra call');
    }

    // ── AK5: removed share, removed membership, deleted board ──────────────

    public function testARemovedShareHidesTheBoard(): void {
        $ids = $this->rights();
        $this->assertContains($ids['B'], self::ids($this->search('workshop')));
        $this->h->shares->save('bob', $ids['B'], []);
        $this->h->sharePolicy->reset();
        $this->assertSame([$ids['F'], $ids['D'], $ids['C'], $ids['A']], self::ids($this->search('workshop')));
    }

    public function testARemovedGroupMembershipHidesTheBoard(): void {
        $ids = $this->rights();
        $this->assertContains($ids['C'], self::ids($this->search('workshop')));
        $this->h->groups['staff'] = ['bob'];
        $this->h->sharePolicy->reset();
        $this->assertSame([$ids['F'], $ids['D'], $ids['B'], $ids['A']], self::ids($this->search('workshop')));
    }

    public function testADeletedBoardIsGoneAlsoOnALaterPage(): void {
        $ids = $this->rights();
        $first = $this->search('workshop', null, 3);
        $this->assertSame([$ids['F'], $ids['D'], $ids['C']], self::ids($first));
        $this->assertTrue($first->jsonSerialize()['isPaginated']);
        $cursor = $first->jsonSerialize()['cursor'];
        $this->assertSame($ids['C'], $cursor);

        $this->h->service->delete('bob', $ids['B']);
        $this->h->sharePolicy->reset();
        $next = $this->search('workshop', $cursor, 3);
        $this->assertSame([$ids['A']], self::ids($next), 'the deleted board is not on the next page, nothing shifts');
        $this->assertFalse($next->jsonSerialize()['isPaginated']);
        $this->h->sharePolicy->reset();
        $this->assertSame([$ids['F'], $ids['D'], $ids['C'], $ids['A']], self::ids($this->search('workshop')));

        $this->h->service->delete('bob', $ids['F']);
        $this->h->sharePolicy->reset();
        $this->assertSame([$ids['D'], $ids['C'], $ids['A']], self::ids($this->search('workshop')), 'a deleted board of a link membership');

        $this->h->service->delete('alice', $ids['A']);
        $this->h->sharePolicy->reset();
        $this->assertSame([$ids['D'], $ids['C']], self::ids($this->search('workshop')), 'an own deleted board, too');
    }

    // ── Job 029: link memberships ───────────────────────────────────────────

    public function testMembersOfAnEditAndAVotingLinkFindTheBoards(): void {
        [$e, $v] = $this->joined();
        $this->assertSame([$v, $e], self::ids($this->cleanSearch('retro')));
        $this->assertSame(['carol', 'bob'], $this->h->policyCalls, 'the link policy of each owner');
        $this->assertSame([$v, $e], $this->roleChecks());
        $this->assertSame([BoardStore::class, SharePolicy::class, Access::class, LinkPolicy::class], $this->gets);
        $sources = $this->listSources();
        $this->assertSame(['link', 'edit'], $sources[$e]);
        $this->assertSame(['link', 'vote'], $sources[$v], '"Can vote" in Shared with me');
        $this->assertSame($this->listed('retro'), self::sorted([$v, $e]));

        $this->assertSame([$e], self::ids($this->cleanSearch('retro', null, 25, 'bob')), 'bob: only his own board, not carol\'s');
        $this->assertSame([BoardStore::class, SharePolicy::class], $this->gets, 'own boards only: no Access, no LinkPolicy');
    }

    public function testADisabledLinkHidesTheBoard(): void {
        [$e, $v] = $this->joined();
        $this->assertSame([$v, $e], self::ids($this->cleanSearch('retro')));
        $this->h->service->disableLink('bob', $e, 'edit');
        $this->assertSame([$v], self::ids($this->cleanSearch('retro')), 'the next search no longer shows it');
        $this->assertSame([$v], $this->roleChecks(), 'its members are gone: no candidate');
        $this->assertSame([$v], $this->listed('retro'));
    }

    public function testARotatedLinkHidesTheBoardUntilTheMemberJoinsAgain(): void {
        [$e, $v] = $this->joined();
        $this->assertSame([$v, $e], self::ids($this->cleanSearch('retro')));
        $token = $this->h->service->enableLink('bob', $e, 'edit', ['rotate' => true])['token'];
        $this->assertSame([$v], self::ids($this->cleanSearch('retro')));
        $this->assertSame([$v], $this->listed('retro'));
        $this->assertSame($e, $this->h->service->joinLinkAsUser('alice', $token));
        $this->assertSame([$v, $e], self::ids($this->cleanSearch('retro')), 'back after joining the new link');
        $this->assertSame(['link', 'edit'], $this->listSources()[$e]);
    }

    public function testAMembershipOfARevokedLinkIsNoCandidate(): void {
        [$e, $v] = $this->joined();
        $this->assertSame([$v, $e], self::ids($this->cleanSearch('retro')));
        // A join that raced the renewal: the member row stays, only its link is revoked.
        $link = $this->h->boards->members[$e]['alice']['link_id'];
        $this->h->boards->links[$link]['revoked_at'] = $this->h->nowMs();
        $this->assertArrayHasKey('alice', $this->h->boards->members[$e]);
        $this->assertSame([$v], self::ids($this->cleanSearch('retro')));
        $this->assertNotContains($e, $this->roleChecks(), 'member_role null: no check at all');
        $this->assertSame([$v], $this->roleChecks());
        $this->assertSame([$v], $this->listed('retro'));
    }

    public function testAnExpiredLinkHidesTheBoard(): void {
        $id = $this->linkBoard('Workshop Expiring', $this->h->nowMs() + 1000);
        $this->assertSame([$id], self::ids($this->cleanSearch('workshop')));
        $this->assertSame([$id], $this->listed('workshop'));
        $this->h->time += 2;
        $this->assertSame([], self::ids($this->cleanSearch('workshop')), 'expired at now: member_role null');
        $this->assertSame([], $this->roleChecks());
        $this->assertSame([], $this->listed('workshop'));
    }

    public function testARemovedMembershipHidesTheBoard(): void {
        $id = $this->linkBoard('Workshop Member');
        $this->assertSame([$id], self::ids($this->cleanSearch('workshop')));
        // As onUserDeleted and occ knorke:orphans remove it.
        $this->h->boards->deleteMember($id, 'alice');
        $this->assertSame([], self::ids($this->cleanSearch('workshop')));
        $this->assertSame([], $this->listed('workshop'));
    }

    public function testMembershipAndShareListTheBoardOnce(): void {
        $id = $this->h->service->create('bob', 'Workshop Both')['id'];
        $token = $this->h->service->enableLink('bob', $id, 'edit', [])['token'];
        $this->h->service->joinLinkAsUser('alice', $token);
        $this->h->shareRows->add($id, 'user', 'alice', 'view');
        $this->assertSame([$id], self::ids($this->cleanSearch('workshop')), 'once, not per source');
        $this->assertSame([$id], $this->roleChecks());
        $this->assertSame(['link', 'edit'], $this->listSources()[$id], 'the higher role: the link');

        $this->h->service->disableLink('bob', $id, 'edit');
        $this->assertSame([$id], self::ids($this->cleanSearch('workshop')), 'the share still carries it');
        $this->assertSame([$id], $this->roleChecks());
        $this->assertSame([], $this->h->policyCalls, 'no link membership left: the policy is not asked');
        $this->assertSame(['share', 'view'], $this->listSources()[$id]);
    }

    public function testTheLinkPolicyDecidesLinkMembershipsOnly(): void {
        $ids = $this->rights();
        $x = $this->linkBoard('Workshop Iota');
        $this->h->shareRows->add($x, 'user', 'alice', 'view');
        $y = $this->h->boards->addBoard('bob', 'Workshop Kappa');
        $this->h->boards->addMember($y, 'alice', 'edit', null, 1);
        $all = [$y, $x, $ids['F'], $ids['D'], $ids['C'], $ids['B'], $ids['A']];
        $this->assertSame($all, self::ids($this->cleanSearch('workshop')));

        $this->h->linksAllowed['bob'] = false;
        $r = $this->cleanSearch('workshop');
        $this->assertSame([$y, $x, $ids['D'], $ids['C'], $ids['B'], $ids['A']], self::ids($r),
            'F (link only) goes; X stays through its share, Y (M0 member, link_id NULL) always counts');
        $this->assertSame(['bob', 'bob'], $this->h->policyCalls, 'asked for X and F only, not for Y or the shares');
        $this->assertSame($this->listed('workshop'), self::sorted(self::ids($r)));
        $this->assertSame(['share', 'view'], $this->listSources()[$x]);

        $this->assertSame([$ids['B']], self::ids($this->cleanSearch('beta')));
        $this->assertSame([], $this->h->policyCalls, 'a share only: no link policy');
        $this->assertSame([BoardStore::class, SharePolicy::class, Access::class], $this->gets, 'LinkPolicy not even built');
    }

    public function testPagingWithLinkMembers(): void {
        $ids = [];
        for ($i = 1; $i <= 10; $i++) {
            $this->h->boards->addBoard('carol', 'Retro hidden ' . $i);
            $ids[] = $this->linkBoard('Retro ' . $i);
        }
        $all = array_reverse($ids);
        $r1 = $this->cleanSearch('retro', null, 3);
        $p1 = $r1->jsonSerialize();
        $this->assertSame(array_slice($all, 0, 3), self::ids($r1));
        $this->assertTrue($p1['isPaginated']);
        $this->assertSame($all[2], $p1['cursor'], 'cursor = id of the 3rd entry, as int');
        $this->assertCount(4, $this->roleChecks(), 'limit + 1 checks');

        $seen = self::ids($r1);
        $sizes = [];
        $cursor = $p1['cursor'];
        while ($cursor !== null) {
            $r = $this->cleanSearch('retro', $cursor, 3);
            $this->assertLessThanOrEqual(4, count($this->roleChecks()));
            $sizes[] = count(self::ids($r));
            $seen = array_merge($seen, self::ids($r));
            $cursor = $r->jsonSerialize()['isPaginated'] ? $r->jsonSerialize()['cursor'] : null;
        }
        $this->assertSame([3, 3, 1], $sizes);
        $this->assertFalse($r->jsonSerialize()['isPaginated'], 'the last page is complete');
        $this->assertSame($all, $seen, 'all 10 ids descending: no duplicates, no gaps');

        $r = $this->cleanSearch('retro', null, 10)->jsonSerialize();
        $this->assertFalse($r['isPaginated']);
        $this->assertCount(10, $r['entries']);
        $this->assertCount(10, $this->roleChecks());
    }

    // ── AK6: only the title ─────────────────────────────────────────────────

    public function testOnlyTheTitleIsSearched(): void {
        $alpha = $this->h->boards->addBoard('alice', 'Workshop Alpha');
        $retro = $this->h->boards->addBoard('alice', 'Ärger-Retro');
        $plan = $this->h->boards->addBoard('alice', 'Plan');
        $this->h->boards->boards[$plan]['meta'] = '{"frames":{"f1":{"title":"Zebra"}},"note":"Zebra"}';
        foreach (['ALPHA', 'alpha', '  alpha  ', "\talpha\n", 'shop al'] as $term) {
            $this->assertSame([$alpha], self::ids($this->search($term)), json_encode($term));
        }
        $this->assertSame([$retro], self::ids($this->search('ä')), 'Unicode case folding');
        $this->assertSame([$retro], self::ids($this->search('RETRO')));
        $this->assertSame([], self::ids($this->search('Alpha Workshop')), 'the term is not split into words');
        $this->clearLogs();
        $this->assertSame([], self::ids($this->search('Zebra')), 'meta is never searched');
        $this->assertSame(['pin', 'listForUser'], $this->h->boards->log, 'meta() is never read');
        $this->assertSame([BoardStore::class, SharePolicy::class], $this->gets, 'nothing but the board list: no item store');
        $this->assertSame([$plan], self::ids($this->search('plan')));
    }

    public function testTheSourceNeverTouchesBoardContent(): void {
        $src = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Search/BoardSearchProvider.php');
        foreach (['ItemStore', '->meta(', 'knorke_items', 'knorke_changes'] as $needle) {
            $this->assertStringNotContainsString($needle, $src, $needle);
        }
        $code = '';
        foreach (token_get_all($src) as $t) {
            if (!is_array($t) || ($t[0] !== T_COMMENT && $t[0] !== T_DOC_COMMENT)) {
                $code .= is_array($t) ? $t[1] : $t;
            }
        }
        $this->assertStringContainsString('->memberRole(', $code, 'the one rights path of a foreign board');
        foreach (['->forUser', '->forGuest', '->joinGuest', '->checkPassword', '->throttle', '->pid(', 'findBoardForUser', 'FastCache',
            'getQueryBuilder', 'executeQuery'] as $needle) {
            $this->assertStringNotContainsString($needle, $code, "$needle: read only, no rights seeding, no own SQL");
        }
    }

    // ── AK7: the shape of an entry ──────────────────────────────────────────

    public function testTheShapeOfAnEntry(): void {
        $ids = $this->rights();
        $ghost = $this->h->boards->addBoard('knorke-nope-zed', 'Workshop Ghost');
        $this->h->shareRows->add($ghost, 'user', 'alice', 'view');
        $bob2 = $this->h->boards->addBoard('bob', 'Workshop Bob Two');
        $this->h->shareRows->add($bob2, 'user', 'alice', 'edit');
        $this->clearLogs();
        $p = $this->provider();
        $r = $p->search($this->user('alice'), $this->query('workshop'));
        $json = $r->jsonSerialize();
        $this->assertSame($p->getName(), $json['name']);
        $this->assertSame('Knorke-Boards', $json['name']);
        $byId = [];
        foreach ($json['entries'] as $e) {
            $e = $e->jsonSerialize();
            $byId[(int)substr($e['resourceUrl'], strlen('/index.php/apps/knorke/b/'))] = $e;
        }
        $this->assertSame([
            'thumbnailUrl' => '',
            'title' => 'Workshop Beta',
            'subline' => 'von Bob Display',
            'resourceUrl' => '/index.php/apps/knorke/b/' . $ids['B'],
            'icon' => '/custom_apps/knorke/img/app-neutral.svg',
            'rounded' => false,
            'attributes' => [],
        ], $byId[$ids['B']]);
        $this->assertStringEndsWith('/apps/knorke/b/' . $ids['B'], $byId[$ids['B']]['resourceUrl']);
        $this->assertContains(['knorke.page.board', ['id' => $ids['B']]], $this->routes);
        $this->assertSame('von knorke-nope-zed', $byId[$ghost]['subline'], 'an owner the user manager does not know: the uid');
        $this->assertSame('von Alice Display', $byId[$ids['A']]['subline'], 'the owner line also on own boards');
        $this->assertSame('von Carol Display', $byId[$ids['C']]['subline']);
        $this->assertSame(['bob', 'knorke-nope-zed', 'carol', 'alice'], $this->names, 'one display-name lookup per owner (bob owns four hits)');
    }

    // ── AK8: paging ─────────────────────────────────────────────────────────

    /** 7 matching boards for alice (own and shared alternately) and noise; ids ascending. */
    private function seven(): array {
        $ids = [];
        for ($i = 1; $i <= 7; $i++) {
            $this->h->boards->addBoard('carol', 'Unrelated ' . $i);
            if ($i % 2 === 0) {
                $id = $this->h->boards->addBoard('bob', 'Sprint review ' . $i);
                $this->h->shareRows->add($id, 'user', 'alice', 'view');
            } else {
                $id = $this->h->boards->addBoard('alice', 'Sprint planning ' . $i);
            }
            $ids[] = $id;
        }
        $this->clearLogs();
        return $ids;
    }

    public function testCursorPagesWithoutDuplicatesOrGaps(): void {
        $all = array_reverse($this->seven());
        $r1 = $this->search('sprint', null, 3);
        $p1 = $r1->jsonSerialize();
        $this->assertSame(array_slice($all, 0, 3), self::ids($r1));
        $this->assertTrue($p1['isPaginated']);
        $this->assertSame($all[2], $p1['cursor'], 'cursor = id of the last entry, as int');
        $this->assertLessThanOrEqual(4, count($this->roleChecks()), 'at most limit + 1 foreign checks per search');

        // A matching board created after page 1 has a higher id: on no later page.
        $late = $this->h->boards->addBoard('alice', 'Sprint late');

        foreach ([$p1['cursor'], (string)$p1['cursor']] as $cursor) {
            $this->clearLogs();
            $this->h->sharePolicy->reset();
            $p2 = $this->search('sprint', $cursor, 3);
            $this->assertSame(array_slice($all, 3, 3), self::ids($p2), 'cursor as ' . get_debug_type($cursor));
            $this->assertTrue($p2->jsonSerialize()['isPaginated']);
            $this->assertSame($all[5], $p2->jsonSerialize()['cursor']);
            $this->assertLessThanOrEqual(4, count($this->roleChecks()));
        }
        $this->clearLogs();
        $p3 = $this->search('sprint', $all[5], 3);
        $this->assertSame([$all[6]], self::ids($p3));
        $this->assertFalse($p3->jsonSerialize()['isPaginated']);
        $this->assertNull($p3->jsonSerialize()['cursor']);
        $this->assertLessThanOrEqual(4, count($this->roleChecks()));

        $seen = array_merge(self::ids($r1), self::ids($p2), self::ids($p3));
        $this->assertSame($all, $seen, 'no duplicates, no gaps');
        $this->assertNotContains($late, $seen);
        $this->assertSame($late, self::ids($this->search('sprint', null, 3))[0], 'a fresh search shows it first');
    }

    public function testIdOrderHoldsWhileUpdatedAtMoves(): void {
        // The real listForUser orders by updated_at DESC; the fake's addBoard sets
        // updated_at = id, which would hide a missing id sort. Here an old board
        // is in a running workshop: the store lists it first.
        $all = array_reverse($this->seven());
        $this->h->boards->boards[$all[5]]['updated_at'] = PHP_INT_MAX;
        $storeOrder = array_column($this->h->boards->listForUser('alice', ['staff'], [], 0), 'id');
        $this->assertSame($all[5], $storeOrder[0], 'precondition: store order differs from id order');
        $this->clearLogs();

        // (a) Without a cursor the order is strictly id DESC.
        $this->assertSame($all, self::ids($this->search('sprint')));

        // (b) updated_at moves between the pages: still no duplicates, no gaps.
        $this->h->sharePolicy->reset();
        $r1 = $this->search('sprint', null, 3);
        $this->assertSame(array_slice($all, 0, 3), self::ids($r1));
        $this->h->boards->boards[$all[4]]['updated_at'] = PHP_INT_MAX - 1;
        $this->h->boards->boards[$all[1]]['updated_at'] = PHP_INT_MAX - 2;
        $this->h->boards->boards[$all[5]]['updated_at'] = 0;
        $this->h->sharePolicy->reset();
        $r2 = $this->search('sprint', $r1->jsonSerialize()['cursor'], 3);
        $this->assertSame(array_slice($all, 3, 3), self::ids($r2));
        $this->h->boards->boards[$all[6]]['updated_at'] = PHP_INT_MAX;
        $this->h->sharePolicy->reset();
        $r3 = $this->search('sprint', $r2->jsonSerialize()['cursor'], 3);
        $this->assertSame([$all[6]], self::ids($r3));
        $this->assertFalse($r3->jsonSerialize()['isPaginated']);
        $this->assertSame($all, array_merge(self::ids($r1), self::ids($r2), self::ids($r3)), 'no duplicates, no gaps');
    }

    public function testRoleChecksPerPageStayWithinLimitPlusOne(): void {
        // Only foreign boards: every hit costs a check, the page stops at limit + 1.
        for ($i = 1; $i <= 10; $i++) {
            $id = $this->h->boards->addBoard('bob', 'Retro ' . $i);
            $this->h->shareRows->add($id, 'user', 'alice', 'view');
        }
        foreach ([1, 3, 9] as $limit) {
            $this->clearLogs();
            $r = $this->search('retro', null, $limit);
            $this->assertCount($limit, $r->jsonSerialize()['entries']);
            $this->assertTrue($r->jsonSerialize()['isPaginated']);
            $this->assertCount($limit + 1, $this->roleChecks(), "limit $limit");
        }
        $this->clearLogs();
        $r = $this->search('retro', null, 10);
        $this->assertCount(10, $r->jsonSerialize()['entries']);
        $this->assertFalse($r->jsonSerialize()['isPaginated']);
        $this->assertCount(10, $this->roleChecks());
    }

    public function testExactlyLimitHitsAreComplete(): void {
        foreach (['alice', 'alice', 'bob'] as $i => $owner) {
            $id = $this->h->boards->addBoard($owner, 'Retro ' . $i);
            if ($owner !== 'alice') {
                $this->h->shareRows->add($id, 'user', 'alice', 'view');
            }
        }
        $r = $this->search('retro', null, 3)->jsonSerialize();
        $this->assertCount(3, $r['entries']);
        $this->assertFalse($r['isPaginated']);
        $this->assertNull($r['cursor']);
    }

    public function testTheLimitIsCapped(): void {
        for ($i = 1; $i <= 30; $i++) {
            $id = $this->h->boards->addBoard('bob', 'Retro ' . $i);
            $this->h->shareRows->add($id, 'user', 'alice', 'view');
        }
        $this->clearLogs();
        $r = $this->search('retro', null, 100)->jsonSerialize();
        $this->assertCount(BoardSearchProvider::MAX_RESULTS, $r['entries']);
        $this->assertSame(25, BoardSearchProvider::MAX_RESULTS);
        $this->assertTrue($r['isPaginated']);
        $this->assertCount(26, $this->roleChecks(), 'limit + 1 checks at the cap');
        foreach ([0, -5] as $limit) {
            $this->clearLogs();
            $this->h->sharePolicy->reset();
            $r = $this->search('retro', null, $limit)->jsonSerialize();
            $this->assertCount(1, $r['entries'], "limit $limit");
            $this->assertTrue($r['isPaginated']);
            $this->assertSame(30, $r['cursor']);
            $this->assertCount(2, $this->roleChecks());
        }
    }

    // ── AK9: invalid input reads nothing ────────────────────────────────────

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function invalidInput(): array {
        return [
            'empty term' => ['', null],
            'blank term' => ['   ', null],
            'term of 201 characters' => [str_repeat('w', 201), null],
            'cursor abc' => ['workshop', 'abc'],
            'cursor 0' => ['workshop', '0'],
            'cursor -1' => ['workshop', '-1'],
            'cursor 1e3' => ['workshop', '1e3'],
            'cursor 007' => ['workshop', '007'],
            'cursor of 19 digits' => ['workshop', '1234567890123456789'],
            'cursor with a space' => ['workshop', ' 5'],
            'cursor with a trailing newline' => ['workshop', "5\n"],
            'cursor int 0' => ['workshop', 0],
            'cursor int -3' => ['workshop', -3],
            'cursor float' => ['workshop', 1.5],
            'cursor array' => ['workshop', ['1']],
            'cursor bool' => ['workshop', true],
        ];
    }

    #[DataProvider('invalidInput')]
    public function testInvalidInputReadsNothing(string $term, mixed $cursor): void {
        $this->rights();
        $r = $this->search($term, $cursor);
        $this->assertSame(['name' => 'Knorke-Boards', 'isPaginated' => false, 'entries' => [], 'cursor' => null], $r->jsonSerialize());
        $this->assertSame([], $this->h->boards->log);
        $this->assertSame([], $this->h->shareRows->log);
        $this->assertSame([], $this->gets, 'no service was even built');
    }

    public function testAnAccountWithoutTheAppGetsNothing(): void {
        $this->rights();
        $this->appEnabled = false;
        $r = $this->search('workshop');
        $this->assertSame(['name' => 'Knorke-Boards', 'isPaginated' => false, 'entries' => [], 'cursor' => null], $r->jsonSerialize());
        $this->assertSame(['knorke'], $this->appCalls);
        $this->assertSame([], $this->h->boards->log);
        $this->assertSame([], $this->h->shareRows->log);
        $this->assertSame([], $this->gets);
    }

    public function testValidEdgesDoRead(): void {
        $ids = $this->rights();
        // 200 characters (multibyte: mb_strlen, not strlen) is still a term.
        $this->assertSame([], self::ids($this->search(str_repeat('ä', 200))));
        $this->assertSame(['pin', 'listForUser'], $this->h->boards->log);
        foreach ([null, '', '123456789012345678', PHP_INT_MAX, (string)($ids['C'])] as $cursor) {
            $this->clearLogs();
            $this->h->sharePolicy->reset();
            $r = $this->search('workshop', $cursor);
            $this->assertSame(['pin', 'listForUser'], $this->h->boards->log, var_export($cursor, true));
            $want = $cursor === (string)$ids['C'] ? [$ids['B'], $ids['A']] : [$ids['F'], $ids['D'], $ids['C'], $ids['B'], $ids['A']];
            $this->assertSame($want, self::ids($r), var_export($cursor, true));
        }
    }

    // ── AK10: texts ─────────────────────────────────────────────────────────

    public function testGermanTexts(): void {
        $this->assertSame('Knorke-Boards', self::$de['Knorke boards'] ?? null);
        $this->assertSame('von %s', self::$de['by %s'] ?? null);
        // PHP translates with vsprintf: a second placeholder would throw a ValueError and break the search.
        $this->assertSame(1, substr_count(self::$de['by %s'], '%s'));
        $this->assertSame(1, substr_count(self::$de['by %s'], '%'), 'no other format directive');
        $this->assertSame('von Bob Display', vsprintf(self::$de['by %s'], ['Bob Display']));
    }

    // ── Job 030: accounts of the Guests app follow its app whitelist ───────

    /** An account like the harness's, but with the backend name $backend. */
    private function account(string $uid, string $backend): IUser {
        return Fake::of(IUser::class, [
            'getUID' => fn (): string => $uid,
            'getDisplayName' => fn (): string => ucfirst($uid) . ' Display',
            'isEnabled' => fn (): bool => true,
            'getBackendClassName' => fn (): string => $backend,
        ]);
    }

    /** "Gast": an account of the Guests app (backend "Guests"). */
    private function gast(): IUser {
        return $this->account('gast', 'Guests');
    }

    /**
     * The Guests app's AppWhitelist: logs every isUrlAllowed() as [uid, url]
     * in $calls, then throws $throw or answers $answer (any value, as a
     * changed Guests app might).
     */
    private function whitelist(mixed $answer = true, ?\Throwable $throw = null): FakeGuestsWhitelist {
        return new FakeGuestsWhitelist($answer, $throw);
    }

    /**
     * rights() (A–G, none of them visible to gast) and three boards of gast:
     * P bob's, shared with user:gast (view), Q gast's own, R bob's with gast
     * a member through a valid edit link. All titled "Workshop …".
     *
     * @return array<string, int>
     */
    private function guestBoards(): array {
        $ids = $this->rights();
        $b = $this->h->boards;
        $ids['P'] = $b->addBoard('bob', 'Workshop Gast');
        $this->h->shareRows->add($ids['P'], 'user', 'gast', 'view');
        $ids['Q'] = $b->addBoard('gast', 'Workshop Eigen');
        $ids['R'] = $b->addBoard('bob', 'Workshop Gast-Link');
        $link = $b->insertLink($ids['R'], 'Gs3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'bob', 1);
        $b->addMember($ids['R'], 'gast', 'edit', $link, 1);
        $this->clearLogs();
        return $ids;
    }

    /** A search of $user after clearLogs(), a fresh share policy memo and no app calls; on $p if given. */
    private function searchAs(IUser $user, string $term, mixed $cursor = null, int $limit = 25, ?BoardSearchProvider $p = null): SearchResult {
        $this->clearLogs();
        $this->h->sharePolicy->reset();
        $this->appCalls = [];
        return ($p ?? $this->provider())->search($user, $this->query($term, $cursor, $limit));
    }

    private function assertNothingRead(string $message = ''): void {
        $this->assertSame([], $this->h->boards->log, $message);
        $this->assertSame([], $this->h->shareRows->log, $message);
    }

    private function assertNone(SearchResult $r, string $message = ''): void {
        $this->assertSame(['name' => 'Knorke-Boards', 'isPaginated' => false, 'entries' => [], 'cursor' => null], $r->jsonSerialize(), $message);
    }

    /** The source without comments, tokenized as in testTheSourceNeverTouchesBoardContent. */
    private static function code(string $src): string {
        $code = '';
        foreach (token_get_all($src) as $t) {
            if (!is_array($t) || ($t[0] !== T_COMMENT && $t[0] !== T_DOC_COMMENT)) {
                $code .= is_array($t) ? $t[1] : $t;
            }
        }
        return $code;
    }

    public function testKnorkeNotOnTheWhitelistGivesAGuestNothingAndReadsNothing(): void {
        $this->guestBoards();
        $this->guests = $this->whitelist(false);
        $r = $this->searchAs($this->gast(), 'workshop');
        $this->assertNone($r);
        $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls, 'asked once, for the fixed path');
        $this->assertSame(['knorke'], $this->appCalls);
        $this->assertNothingRead();
        $this->assertSame([BoardSearchProvider::GUESTS_WHITELIST], $this->gets, 'no Knorke service was built');
    }

    public function testKnorkeAllowedGivesAGuestTheBoardsOfItsBoardList(): void {
        $ids = $this->guestBoards();
        $this->guests = $this->whitelist(true);
        $gast = $this->gast();
        $r = $this->searchAs($gast, 'workshop');
        $this->assertSame([$ids['R'], $ids['Q'], $ids['P']], self::ids($r), 'link, own, share; ids descending; A–G not');
        $this->assertSame([BoardSearchProvider::GUESTS_WHITELIST, BoardStore::class, SharePolicy::class, Access::class, LinkPolicy::class], $this->gets);
        $this->assertReadOnly();
        $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
        $this->assertSame($this->listed('workshop', 'gast'), self::sorted(self::ids($r)), 'the same boards as the board list');

        // Paging: every page is a search of its own and asks again, also on the same provider.
        $this->guests->calls = [];
        $p = $this->provider();
        $r1 = $this->searchAs($gast, 'workshop', null, 2, $p);
        $this->assertSame([$ids['R'], $ids['Q']], self::ids($r1));
        $this->assertTrue($r1->jsonSerialize()['isPaginated']);
        $this->assertSame($ids['Q'], $r1->jsonSerialize()['cursor']);
        $r2 = $this->searchAs($gast, 'workshop', $r1->jsonSerialize()['cursor'], 2, $p);
        $this->assertSame([$ids['P']], self::ids($r2));
        $this->assertFalse($r2->jsonSerialize()['isPaginated']);
        $this->assertSame([['gast', '/apps/knorke/'], ['gast', '/apps/knorke/']], $this->guests->calls, 'two pages, two questions');
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function guestsFailures(): array {
        return [
            '(a) no Guests app: NotFoundExceptionInterface' => ['missing', null],
            '(b) an object without isUrlAllowed()' => ['stdClass', null],
            '(c) isUrlAllowed() throws' => ['throws', null],
            '(d) answer null' => ['answer', null],
            '(d) answer 1' => ['answer', 1],
            "(d) answer 'yes'" => ['answer', 'yes'],
            "(d) answer '1'" => ['answer', '1'],
            '(d) answer []' => ['answer', []],
        ];
    }

    #[DataProvider('guestsFailures')]
    public function testTheSearchFailsClosedForAGuest(string $kind, mixed $answer): void {
        $this->guestBoards();
        $this->guests = match ($kind) {
            'missing' => null,
            'stdClass' => new \stdClass(),
            'throws' => $this->whitelist(true, new \RuntimeException('guests broken')),
            'answer' => $this->whitelist($answer),
        };
        $r = $this->searchAs($this->gast(), 'workshop');
        $this->assertNone($r);
        $this->assertNothingRead();
        $this->assertSame([BoardSearchProvider::GUESTS_WHITELIST], $this->gets, 'neither BoardStore nor SharePolicy');
        if ($kind === 'throws' || $kind === 'answer') {
            $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
        }
    }

    public function testAFailedLookupOfTheWhitelistIsNotKept(): void {
        $ids = $this->guestBoards();
        $p = $this->provider();
        $this->assertNone($this->searchAs($this->gast(), 'workshop', null, 25, $p), 'without the Guests app');
        $this->assertSame([BoardSearchProvider::GUESTS_WHITELIST], $this->gets);

        $this->guests = $this->whitelist(true);
        $r = $this->searchAs($this->gast(), 'workshop', null, 25, $p);
        $this->assertSame([$ids['R'], $ids['Q'], $ids['P']], self::ids($r));
        $this->assertSame([BoardSearchProvider::GUESTS_WHITELIST, BoardStore::class, SharePolicy::class, Access::class, LinkPolicy::class], $this->gets,
            'the same provider asks the container again');
        $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
    }

    public function testOtherAccountsNeverAskTheGuestsApp(): void {
        $ids = $this->rights();
        $this->guests = $this->whitelist(false);
        $harness = $this->user('alice');
        // The fake's neutral value: null on NC 34 (no return type), '' on NC 35 (string).
        $this->assertContains($harness->getBackendClassName(), [null, ''], 'precondition: the harness account has no backend name');
        $accounts = [
            'harness (null or \'\')' => $harness,
            "''" => $this->account('alice', ''),
            'Database' => $this->account('alice', 'Database'),
            'guests' => $this->account('alice', 'guests'),
            'OCA\Guests\UserBackend' => $this->account('alice', 'OCA\Guests\UserBackend'),
        ];
        foreach ($accounts as $label => $alice) {
            $r = $this->searchAs($alice, 'workshop');
            $this->assertSame([$ids['F'], $ids['D'], $ids['C'], $ids['B'], $ids['A']], self::ids($r), $label);
            $this->assertSame([], $this->guests->calls, $label);
            $this->assertNotContains(BoardSearchProvider::GUESTS_WHITELIST, $this->gets, $label);
            $this->assertSame([BoardStore::class, SharePolicy::class, Access::class, LinkPolicy::class], $this->gets, $label);
        }
    }

    #[DataProvider('invalidInput')]
    public function testInvalidInputOfAGuestAsksNothing(string $term, mixed $cursor): void {
        $this->guestBoards();
        $this->guests = $this->whitelist(true);
        $this->assertNone($this->searchAs($this->gast(), $term, $cursor));
        $this->assertSame([], $this->guests->calls);
        $this->assertSame([], $this->gets);
        $this->assertNothingRead();
    }

    public function testAGuestWithoutTheAppAsksNothing(): void {
        $this->guestBoards();
        $this->guests = $this->whitelist(true);
        $this->appEnabled = false;
        $this->assertNone($this->searchAs($this->gast(), 'workshop'));
        $this->assertSame([], $this->guests->calls);
        $this->assertSame([], $this->gets);
        $this->assertSame(['knorke'], $this->appCalls);
        $this->assertNothingRead();
    }

    public function testNoDependencyOnTheGuestsApp(): void {
        $this->assertSame('OCA\\Guests\\AppWhitelist', BoardSearchProvider::GUESTS_WHITELIST);
        $this->assertSame('Guests', BoardSearchProvider::GUESTS_BACKEND);
        $code = self::code((string)file_get_contents(dirname(__DIR__, 3) . '/lib/Search/BoardSearchProvider.php'));
        $helper = self::code((string)file_get_contents(dirname(__DIR__, 3) . '/lib/Service/GuestsAppWhitelist.php'));
        $this->assertStringContainsString('->isUrlAllowed(', $helper);
        $this->assertStringContainsString('->getBackendClassName()', $helper);
        $this->assertStringNotContainsString('use OCA\Guests', $code);
        $this->assertStringNotContainsString('Guests\AppWhitelist::class', $code);
        $this->assertFalse(class_exists('OCA\\Guests\\AppWhitelist', false), 'these cases run without the Guests app');
    }

    // ── Job 055: the provider list ("Places") follows the whitelist too ────

    public function testAGuestKeptOutDoesNotSeeTheProvider(): void {
        $this->guestBoards();
        $this->sessionUser = $this->gast();
        $this->guests = $this->whitelist(false);
        $p = $this->provider();
        $this->assertNull($p->getOrder('files.view.index', []), 'SearchComposer::getProviders() skips null');
        $this->assertNull($p->getOrder('knorke.page.board', ['id' => '7']), 'also on Knorke\'s own pages');
        $this->assertSame([['gast', '/apps/knorke/'], ['gast', '/apps/knorke/']], $this->guests->calls, 'asked per provider list, for the fixed path');
        $this->assertSame([BoardSearchProvider::GUESTS_WHITELIST], $this->gets, 'the whitelist fetched once, no Knorke service');
        $this->assertSame(['knorke', 'knorke'], $this->appCalls, 'the group limit first (job 070), then the Guests app');
        $this->assertNothingRead();

        // Let in: the order as before, on a fresh provider and on the same one (no answer kept).
        $this->guests->answer = true;
        $this->guests->calls = [];
        $this->assertSame(20, $this->provider()->getOrder('files.view.index', []));
        $this->assertSame(-5, $this->provider()->getOrder('knorke.page.board', ['id' => '7']));
        $this->assertSame(20, $p->getOrder('files.view.index', []));
        $this->assertSame(-5, $p->getOrder('knorke.page.board', ['id' => '7']));
        $this->assertCount(4, $this->guests->calls);
        $this->guests->answer = false;
        $this->assertNull($p->getOrder('files.view.index', []), 'the whitelist changed: the next list follows');
        $this->assertSame(array_fill(0, 7, 'knorke'), $this->appCalls, 'one isEnabledForUser per getOrder() of this case');
        $this->assertNothingRead();
    }

    #[DataProvider('guestsFailures')]
    public function testTheProviderListFailsClosedForAGuest(string $kind, mixed $answer): void {
        $this->guestBoards();
        $this->sessionUser = $this->gast();
        $this->guests = FakeGuestsWhitelist::failing($kind, $answer);
        $p = $this->provider();
        $this->assertNull($p->getOrder('files.view.index', []));
        $this->assertNull($p->getOrder('knorke.page.board', ['id' => '7']));
        $this->assertSame($kind === 'missing' ? [BoardSearchProvider::GUESTS_WHITELIST, BoardSearchProvider::GUESTS_WHITELIST] : [BoardSearchProvider::GUESTS_WHITELIST],
            $this->gets, 'a failed get() is not kept, a found object is');
        if ($this->guests instanceof FakeGuestsWhitelist) {
            $this->assertSame([['gast', '/apps/knorke/'], ['gast', '/apps/knorke/']], $this->guests->calls);
        }
        $this->assertSame(['knorke', 'knorke'], $this->appCalls);
        $this->assertNothingRead();
    }

    public function testEveryOtherAccountSeesTheProviderAsBefore(): void {
        $this->rights();
        $this->guests = $this->whitelist(false);
        $harness = $this->user('alice');
        $this->assertContains($harness->getBackendClassName(), [null, ''], 'precondition: the harness account has no backend name');
        $sessions = [
            'no account' => null,
            'harness (null or \'\')' => $harness,
            "''" => $this->account('alice', ''),
            'Database' => $this->account('alice', 'Database'),
            'guests' => $this->account('alice', 'guests'),
            'OCA\Guests\UserBackend' => $this->account('alice', 'OCA\Guests\UserBackend'),
        ];
        foreach ($sessions as $label => $user) {
            $this->sessionUser = $user;
            $this->clearLogs();
            $this->appCalls = [];
            $p = $this->provider();
            $this->assertSame(-5, $p->getOrder('knorke.page.board', ['id' => '7']), $label);
            $this->assertSame(-5, $p->getOrder('knorke.page.index', []), $label);
            $this->assertSame(20, $p->getOrder('files.view.index', []), $label);
            $this->assertSame(20, $p->getOrder('knorkex.page.index', []), $label);
            $this->assertSame([], $this->guests->calls, $label);
            $this->assertSame([], $this->gets, "$label: nothing from the container");
            $this->assertSame($user === null ? [] : ['knorke', 'knorke', 'knorke', 'knorke'], $this->appCalls, $label);
            $this->assertNothingRead($label);
        }
    }

    // ── Job 070: the provider list ("Places") follows "Limit to groups" ────

    public function testAnAccountOutsideTheGroupLimitDoesNotSeeTheProvider(): void {
        $this->rights();
        $this->guests = $this->whitelist(true);
        $this->appEnabled = false;
        $sessions = [
            'harness' => $this->user('alice'),
            'Database' => $this->account('alice', 'Database'),
        ];
        foreach ($sessions as $label => $user) {
            $this->sessionUser = $user;
            $this->appEnabled = false;
            $this->clearLogs();
            $this->appCalls = [];
            $this->appUsers = [];
            $p = $this->provider();
            $this->assertNull($p->getOrder('knorke.page.board', ['id' => '7']), "$label: SearchComposer::getProviders() skips null");
            $this->assertNull($p->getOrder('knorke.page.index', []), "$label: also on Knorke's own pages");
            $this->assertNull($p->getOrder('files.view.index', []), $label);
            $this->assertNull($p->getOrder('knorkex.page.index', []), $label);
            $this->assertSame(['knorke', 'knorke', 'knorke', 'knorke'], $this->appCalls, "$label: one question per getOrder()");
            $this->assertCount(4, $this->appUsers, $label);
            foreach ($this->appUsers as $asked) {
                $this->assertSame($user, $asked, "$label: asked for the session account, never without one");
            }
            $this->assertSame([], $this->guests->calls, "$label: the Guests app is not asked");
            $this->assertSame([], $this->gets, "$label: nothing from the container");
            $this->assertNothingRead($label);

            // The limit changes: the same provider follows, no answer is kept.
            $this->appEnabled = true;
            $this->assertSame(-5, $p->getOrder('knorke.page.board', ['id' => '7']), $label);
            $this->assertSame(-5, $p->getOrder('knorke.page.index', []), $label);
            $this->assertSame(20, $p->getOrder('files.view.index', []), $label);
            $this->assertSame(20, $p->getOrder('knorkex.page.index', []), $label);
            $this->appEnabled = false;
            $this->assertNull($p->getOrder('files.view.index', []), "$label: kept out again");
            $this->assertSame([], $this->guests->calls, $label);
            $this->assertSame([], $this->gets, $label);
            $this->assertNothingRead($label);
        }
    }

    public function testAGuestOutsideTheGroupLimitDoesNotAskTheGuestsApp(): void {
        $this->guestBoards();
        $gast = $this->gast();
        $this->sessionUser = $gast;
        $this->guests = $this->whitelist(true);
        $this->appEnabled = false;
        $p = $this->provider();
        $this->assertNull($p->getOrder('files.view.index', []));
        $this->assertNull($p->getOrder('knorke.page.board', ['id' => '7']));
        $this->assertSame([], $this->guests->calls, 'no isUrlAllowed(), so no "Blocking access" notice of the Guests app');
        $this->assertSame([], $this->gets, 'the whitelist is not even fetched');
        $this->assertSame(['knorke', 'knorke'], $this->appCalls);
        $this->assertSame([$gast, $gast], $this->appUsers);
        $this->assertNothingRead();
    }

    public function testWithoutASessionAccountTheOrderStaysAlsoForAnAppLimitedToGroups(): void {
        $this->rights();
        $this->sessionUser = null;
        $this->appEnabled = false;
        $this->guests = $this->whitelist(false);
        $p = $this->provider();
        $this->assertSame(-5, $p->getOrder('knorke.page.board', ['id' => '7']));
        $this->assertSame(-5, $p->getOrder('knorke.page.index', []));
        $this->assertSame(20, $p->getOrder('files.view.index', []));
        $this->assertSame(20, $p->getOrder('knorkex.page.index', []));
        $this->assertSame([], $this->appCalls, 'not asked: without an account it would answer false for an app limited to groups');
        $this->assertSame([], $this->gets);
        $this->assertSame([], $this->guests->calls);
        $this->assertNothingRead();
    }
}
