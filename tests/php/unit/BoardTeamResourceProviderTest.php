<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Teams\BoardTeamResourceProvider;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use OCP\App\IAppManager;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Teams\ITeamResourceProvider;
use OCP\Teams\TeamResource;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;

/**
 * Boards among a team's resources (factory job 222): the registration, a
 * light constructor, the Knorke glyph, and the rule "the session account
 * sees board B as a resource of team T" (an account, Knorke and the Guests
 * app let it in, T is one of its teams, B has a team row for T, it may open
 * B). Built on AccessHarness (real Access, ShareService and SharePolicy over
 * the fake stores; teams from $teams, team support from $teamSupport and
 * $circlesFor); the IL10N fake translates from l10n/de.json when $german.
 */
final class BoardTeamResourceProviderTest extends TestCase {
    private const BOARD_URL = 'https://cloud.example/index.php/apps/knorke/b/';
    private const T1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
    private const T2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';
    private AccessHarness $h;
    /** @var list<string> every container get() of the provider */
    private array $gets = [];
    private ?string $sessionUid = 'bob';
    private bool $german = false;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->h->teams = [
            self::T1 => ['Team One', ['alice', 'bob']],
            self::T2 => ['Team Two', ['alice']],
        ];
    }

    private function provider(): BoardTeamResourceProvider {
        $h = $this->h;
        $container = Fake::of(ContainerInterface::class, [
            'get' => function (string $id) use ($h): mixed {
                $this->gets[] = $id;
                return match ($id) {
                    BoardStore::class => $h->boards,
                    ShareStore::class => $h->shareRows,
                    SharePolicy::class => $h->sharePolicy,
                    Access::class => $h->access,
                    LinkPolicy::class => $h->policy,
                    default => throw new \LogicException('team provider container: ' . $id),
                };
            },
            'has' => fn (string $id): bool => true,
        ]);
        $de = $this->german
            ? json_decode((string)file_get_contents(dirname(__DIR__, 3) . '/l10n/de.json'), true, 512, JSON_THROW_ON_ERROR)['translations']
            : [];
        $l = Fake::of(IL10N::class, ['t' => fn (string $text, $parameters = []): string => vsprintf($de[$text] ?? $text, (array)$parameters)]);
        $urls = Fake::of(IURLGenerator::class, [
            'linkToRouteAbsolute' => fn (string $route, array $args = []): string => $route === 'knorke.page.board' ? self::BOARD_URL . $args['id'] : 'https://cloud.example/nope',
        ]);
        $time = Fake::of(ITimeFactory::class, [
            'getTime' => fn (): int => $h->time,
            'now' => fn (): \DateTimeImmutable => new \DateTimeImmutable('@' . $h->time),
        ]);
        $session = Fake::of(IUserSession::class, ['getUser' => fn (): ?IUser => $this->sessionUid === null ? null : $h->user($this->sessionUid)]);
        return new BoardTeamResourceProvider($l, $urls, $h->apps, $session, $time, $container, $h->guestsApp);
    }

    /** @return list<array> the resources of $team as JSON, for the session account $uid */
    private function resources(string $team, ?string $uid = 'bob'): array {
        $this->sessionUid = $uid;
        return array_map(static fn (TeamResource $r): array => $r->jsonSerialize(), $this->provider()->getSharedWith($team));
    }

    /** @return list<string> resource ids of $team for $uid */
    private function ids(string $team, ?string $uid = 'bob'): array {
        return array_column($this->resources($team, $uid), 'id');
    }

    /** Board "Retro" of alice, shared with T1 as $role. */
    private function teamBoard(string $role = 'view', string $title = 'Retro'): int {
        $b = $this->h->boards->addBoard('alice', $title);
        $this->h->shareRows->add($b, 'team', self::T1, $role);
        return $b;
    }

    private function clearLogs(): void {
        $this->h->boards->log = [];
        $this->h->shareRows->log = [];
        $this->h->teamCalls = [];
        $this->h->mem->log = [];
        $this->h->mem->data = [];
        $this->gets = [];
        $this->h->sharePolicy->reset();
    }

    public function testApplicationRegistersTheProvider(): void {
        $registered = [];
        $context = Fake::of(IRegistrationContext::class, [
            'registerTeamResourceProvider' => function (string $class) use (&$registered): void {
                $registered[] = $class;
            },
        ]);
        (new \ReflectionClass(Application::class))->newInstanceWithoutConstructor()->register($context);
        $this->assertSame([BoardTeamResourceProvider::class], $registered);
        $this->assertTrue(is_subclass_of(BoardTeamResourceProvider::class, ITeamResourceProvider::class));
        $src = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Teams/BoardTeamResourceProvider.php');
        $this->assertStringNotContainsString('OCA\\Circles', $src, 'no Circles type: a disabled Circles app loads nothing');
    }

    public function testLightConstructorAndProviderDetails(): void {
        $p = $this->provider();
        $this->assertSame('knorke', $p->getId());
        $this->assertSame('Knorke boards', $p->getName());
        $this->assertSame(BoardTeamResourceProvider::ICON_SVG, $p->getIconSvg());
        $this->assertSame([], $this->gets, 'constructor, getId, getName and getIconSvg take nothing from the container');
        $this->german = true;
        $this->assertSame('Knorke-Boards', $this->provider()->getName());
    }

    public function testIconIsTheGlyphOfAppDarkInCurrentColor(): void {
        $svg = BoardTeamResourceProvider::ICON_SVG;
        $this->assertStringStartsWith('<svg ', $svg);
        $this->assertStringEndsWith('</svg>', $svg);
        $this->assertStringContainsString('fill="currentColor"', $svg);
        $this->assertStringContainsString('viewBox="0 0 20 20"', $svg);
        $this->assertStringNotContainsString('<?xml', $svg);
        $this->assertStringNotContainsString('<!--', $svg);
        $paths = static function (string $s): array {
            preg_match_all('/\sd="([^"]+)"/', $s, $m);
            return $m[1];
        };
        $dark = (string)file_get_contents(dirname(__DIR__, 3) . '/img/app-dark.svg');
        $this->assertNotEmpty($paths($dark));
        $this->assertSame($paths($dark), $paths($svg));
    }

    public function testMemberAndOwnerSeeTheBoard(): void {
        $b = $this->teamBoard();
        $res = $this->resources(self::T1, 'bob');
        $this->assertSame([[
            'id' => (string)$b,
            'label' => 'Retro',
            'url' => self::BOARD_URL . $b,
            'iconSvg' => BoardTeamResourceProvider::ICON_SVG,
            'iconURL' => null,
            'iconEmoji' => null,
            'provider' => ['id' => 'knorke', 'name' => 'Knorke boards', 'icon' => BoardTeamResourceProvider::ICON_SVG],
        ]], $res);
        $this->assertSame([(string)$b], $this->ids(self::T1, 'alice'), 'the owner, a member of the team, too');
    }

    public function testReadOnly(): void {
        $this->teamBoard();
        $this->clearLogs();
        $this->assertCount(1, $this->resources(self::T1));
        $this->assertSame(['pin', 'listForUser'], $this->h->boards->log, 'only the board list: no lock, no member write');
        $this->assertSame([], $this->h->mem->data, 'no grants, no gens');
    }

    public function testNonMemberSeesNothingEvenWithAnotherWayIn(): void {
        $b = $this->teamBoard();
        // carol may open the board through her own share, but is not in T1
        $this->h->shareRows->add($b, 'user', 'carol', 'edit');
        $this->assertSame([], $this->ids(self::T1, 'carol'));
        $this->sessionUid = 'carol';
        $p = $this->provider();
        $this->assertFalse($p->isSharedWithTeam(self::T1, (string)$b));
        $this->assertSame([], $p->getTeamsForResource((string)$b));
    }

    public function testATeamOfWhichTheAccountIsNotAMemberShowsNothing(): void {
        // bob is not in T2 (an open team he can see in Nextcloud): no title, no id
        $b = $this->h->boards->addBoard('alice', 'Secret');
        $this->h->shareRows->add($b, 'team', self::T2, 'edit');
        $this->assertSame([], $this->resources(self::T2, 'bob'));
        $this->assertSame([(string)$b], $this->ids(self::T2, 'alice'));
    }

    public function testUnknownStoredRoleGrantsNothing(): void {
        $b = $this->teamBoard('bogus');
        $this->assertSame([], $this->ids(self::T1));
        $this->sessionUid = 'bob';
        $this->assertSame([], $this->provider()->getTeamsForResource((string)$b));
        // a membership of M0 (link_id NULL) lets bob open it: listed
        $this->h->boards->addMember($b, 'bob', 'edit', null, 0);
        $this->assertSame([(string)$b], $this->ids(self::T1));
    }

    public function testNoSessionAccountReadsNothing(): void {
        $this->teamBoard();
        $this->clearLogs();
        $this->assertSame([], $this->resources(self::T1, null));
        $this->assertSame([], $this->gets);
        $this->assertSame([], $this->h->shareRows->log);
    }

    /** @return array<string, array{0: string}> */
    public static function lockedOut(): array {
        return ['Knorke off for bob' => ['knorke'], 'the Guests app says no' => ['guests'], 'Circles off for bob' => ['circles'], 'no team support' => ['teams']];
    }

    #[DataProvider('lockedOut')]
    public function testLockedOutAccountSeesNothing(string $case): void {
        $b = $this->teamBoard();
        match ($case) {
            'knorke' => $this->h->knorkeFor['bob'] = false,
            'guests' => [$this->h->backends['bob'] = 'Guests', $this->h->guests = new FakeGuestsWhitelist(false)],
            'circles' => $this->h->circlesFor['bob'] = false,
            'teams' => $this->h->teamSupport = false,
        };
        $this->clearLogs();
        $this->assertSame([], $this->resources(self::T1));
        $this->assertNotContains('listForUser', $this->h->boards->log, 'no board list read');
        if ($case === 'knorke' || $case === 'guests') {
            $this->assertSame([], $this->h->shareRows->log, 'nothing read before the account is let in');
        }
        $this->sessionUid = 'bob';
        $this->assertSame([], $this->provider()->getTeamsForResource((string)$b));
        $this->assertFalse($this->provider()->isSharedWithTeam(self::T1, (string)$b));
    }

    public function testTeamWithoutKnorkeBoardsCostsOneQuery(): void {
        $this->h->boards->addBoard('alice', 'Not shared');
        $this->clearLogs();
        $this->assertSame([], $this->resources(self::T1));
        $this->assertSame(['sharesFor team'], $this->h->shareRows->log);
        $this->assertSame([], $this->h->boards->log, 'no board list');
        $this->assertSame([], $this->h->teamCalls, 'no Circles call');
    }

    public function testEachBoardOnceInBoardListOrder(): void {
        $old = $this->teamBoard('view', 'Old');
        $this->h->shareRows->add($old, 'user', 'bob', 'edit');
        $this->h->shareRows->add($old, 'group', 'staff', 'view');
        $new = $this->teamBoard('edit', 'New');
        $this->h->boards->addBoard('alice', 'Elsewhere');
        $this->assertSame([(string)$new, (string)$old], $this->ids(self::T1), 'newest change first, each once');
    }

    /** @return array<string, array{0: string}> */
    public static function badIds(): array {
        return ['zero' => ['0'], 'word' => ['abc'], 'trailing newline' => ["1\n"], 'negative' => ['-1'], 'empty' => [''], 'leading zero' => ['01'], 'too long' => ['1234567890123456789']];
    }

    #[DataProvider('badIds')]
    public function testBadResourceIds(string $id): void {
        $this->teamBoard();
        $this->clearLogs();
        $p = $this->provider();
        $this->assertFalse($p->isSharedWithTeam(self::T1, $id));
        $this->assertSame([], $p->getTeamsForResource($id));
        $this->assertSame([], $this->h->shareRows->log);
    }

    public function testIsSharedWithTeam(): void {
        $b = $this->teamBoard();
        $other = $this->h->boards->addBoard('alice', 'Other');
        $p = $this->provider();
        $this->assertTrue($p->isSharedWithTeam(self::T1, (string)$b));
        $this->assertFalse($p->isSharedWithTeam(self::T1, (string)$other));
        $this->assertFalse($p->isSharedWithTeam(self::T2, (string)$b));
        $this->assertFalse($p->isSharedWithTeam(self::T1, '999'));
    }

    public function testTeamsForResourceOnlyTheAccountsTeams(): void {
        $b = $this->teamBoard();
        $this->h->shareRows->add($b, 'team', self::T2, 'view');
        $this->h->shareRows->add($b, 'user', 'carol', 'view');
        $this->sessionUid = 'bob';
        $this->assertSame([self::T1], $this->provider()->getTeamsForResource((string)$b));
        $this->sessionUid = 'alice';
        $this->assertSame([self::T1, self::T2], $this->provider()->getTeamsForResource((string)$b));
        $this->sessionUid = 'carol';
        $this->assertSame([], $this->provider()->getTeamsForResource((string)$b), 'carol may open it, but is in no team');
        // dave is in T1 but the board is not his to open: the same as a board that does not exist
        $this->h->teams[self::T1][1][] = 'dave';
        $foreign = $this->h->boards->addBoard('erin', 'Foreign');
        $this->h->shareRows->add($foreign, 'team', self::T1, 'bogus');
        $this->sessionUid = 'dave';
        $this->assertSame([], $this->provider()->getTeamsForResource((string)$foreign));
        $this->assertSame([], $this->provider()->getTeamsForResource('999'));
    }

    // ── Job 245 ────────────────────────────────────────────────────────────

    public function testABoardOfADisabledOwnerIsNoTeamResource(): void {
        $b = $this->teamBoard();
        $this->assertSame([(string)$b], $this->ids(self::T1));
        $this->h->disabledUsers = ['alice'];
        $this->assertSame([], $this->ids(self::T1), 'the owner is disabled: not listed');
        $this->sessionUid = 'bob';
        $this->assertSame([], $this->provider()->getTeamsForResource((string)$b));
        $this->h->disabledUsers = [];
        $this->assertSame([(string)$b], $this->ids(self::T1), 'enabled again: listed again');
    }
}
