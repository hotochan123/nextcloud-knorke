<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OC\Notification\Notification;
use OC\RichObjectStrings\RichTextFormatter;
use OC\RichObjectStrings\Validator;
use OCA\Knorke\BackgroundJob\ShareNotifyJob;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Notification\Notifier;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\INotification;
use OCP\Notification\UnknownNotificationException;
use OCP\RichObjectStrings\Definitions;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\DataProviderExternal;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;
use Psr\Log\LoggerInterface;

/**
 * "Board shared with you" (M2, SPEC-M1 §1.2), the showing side: a light
 * notifier (no container access before a Knorke notification passed the
 * cheap checks), roleFor() decides at every show, a gone right, board or
 * app access deletes the notification (AlreadyProcessedException), a read
 * failure keeps it (UnknownNotificationException); texts in English and
 * German checked by Nextcloud's real Validator. Notifications come from
 * the real sending path (AccessHarness, ShareService::save, the job).
 * PHPUnit runs as CLI, so notifier() resets SharePolicy before roleFor()
 * like a cron or background-job:worker process; notifier(web: true) keeps
 * the request's answers like the bell.
 */
final class NotifierTest extends TestCase {
    private const BOARD_URL = 'https://cloud.example/index.php/apps/knorke/b/';
    private const ICON = 'https://cloud.example/custom_apps/knorke/img/app-dark.svg';

    private AccessHarness $h;
    private int $b;
    /** @var list<string> every container get()/has() of the notifier */
    private array $gets = [];
    /** @var array<string, \Throwable> container ids whose get() throws */
    private array $getFails = [];
    /** @var list<array{0: string, 1: ?string}> IFactory::get calls [app, lang] */
    private array $langs = [];
    /**
     * What the container hands out for GuestsAppWhitelist::WHITELIST (usually
     * a FakeGuestsWhitelist); null: NotFoundExceptionInterface, as without
     * the Guests app.
     */
    private ?object $guests = null;
    /** @var array<string, string> */
    private static array $de = [];

    public static function setUpBeforeClass(): void {
        self::$de = json_decode((string)file_get_contents(dirname(__DIR__, 3) . '/l10n/de.json'), true, 512, JSON_THROW_ON_ERROR)['translations'];
    }

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->boards->addBoard('alice', 'Workshop Beta');
    }

    /** $web: a notifier as in a web request (freshRights() false: no SharePolicy reset). */
    private function notifier(bool $web = false): Notifier {
        $h = $this->h;
        $container = Fake::of(ContainerInterface::class, [
            'get' => function (string $id) use ($h): mixed {
                $this->gets[] = $id;
                if (isset($this->getFails[$id])) {
                    throw $this->getFails[$id];
                }
                return match ($id) {
                    BoardStore::class => $h->boards,
                    SharePolicy::class => $h->sharePolicy,
                    ShareService::class => $h->shares,
                    LoggerInterface::class => $h->logger,
                    GuestsAppWhitelist::WHITELIST => $this->guests ?? throw new class('no ' . $id) extends \RuntimeException implements NotFoundExceptionInterface {
                    },
                    default => throw new \LogicException('notifier container: ' . $id),
                };
            },
            'has' => function (string $id): bool {
                $this->gets[] = 'has ' . $id;
                return true;
            },
        ]);
        $l10n = Fake::of(IFactory::class, ['get' => function ($app, $lang = null, $locale = null): IL10N {
            $this->langs[] = [(string)$app, $lang];
            return Fake::of(IL10N::class, ['t' => fn (string $text, $parameters = []): string => vsprintf($lang === 'de' ? (self::$de[$text] ?? $text) : $text, (array)$parameters)]);
        }]);
        $urls = Fake::of(IURLGenerator::class, [
            'linkToRouteAbsolute' => fn (string $route, array $args = []): string => $route === 'knorke.page.board' && array_keys($args) === ['id']
                ? self::BOARD_URL . $args['id'] : 'https://cloud.example/index.php/nope',
            'imagePath' => fn (string $app, string $file): string => '/custom_apps/' . $app . '/img/' . $file,
            'getAbsoluteURL' => fn (string $url): string => 'https://cloud.example' . $url,
        ]);
        $args = [$l10n, $urls, $h->users, $h->apps, $container, new GuestsAppWhitelist($container)];
        return $web
            ? new class(...$args) extends Notifier {
                protected function freshRights(): bool {
                    return false;
                }
            }
            : new Notifier(...$args);
    }

    private static function e(string $kind, string $id, string $role = 'edit'): array {
        return ['kind' => $kind, 'id' => $id, 'role' => $role];
    }

    /** The notification ShareService::save() sent to $uid (as stored: a fresh copy). */
    private function sentTo(string $uid): INotification {
        foreach (array_reverse($this->h->sent) as $n) {
            if ($n->getUser() === $uid) {
                return clone $n;
            }
        }
        $this->fail("no notification for $uid");
    }

    private function job(): ShareNotifyJob {
        return new ShareNotifyJob(Fake::of(ITimeFactory::class), $this->h->notifications);
    }

    /** A notification as another app or a later version could store it. */
    private static function raw(string $app, string $user, string $type, string $id, string $subject): INotification {
        $n = new Notification(new Validator(new Definitions()), new RichTextFormatter());
        return $n->setApp($app)->setUser($user)->setObject($type, $id)->setSubject($subject)->setDateTime(new \DateTime('@1760000000'));
    }

    private function assertDropped(INotification $n, string $why, ?Notifier $notifier = null): void {
        try {
            ($notifier ?? $this->notifier())->prepare($n, 'en');
            $this->fail("AlreadyProcessedException expected: $why");
        } catch (AlreadyProcessedException) {
            $this->addToAssertionCount(1);
        }
    }

    private function assertShownFor(INotification $n, string $title = 'Workshop Beta', string $owner = 'alice', string $ownerName = 'Alice Display', ?int $board = null, ?Notifier $notifier = null): void {
        $board ??= $this->b;
        $url = self::BOARD_URL . $board;
        $en = ($notifier ?? $this->notifier())->prepare(clone $n, 'en');
        $this->assertSame('{owner} shared the board {title} with you', $en->getRichSubject());
        $this->assertSame([
            'owner' => ['type' => 'user', 'id' => $owner, 'name' => $ownerName],
            'title' => ['type' => 'highlight', 'id' => (string)$board, 'name' => $title],
        ], $en->getRichSubjectParameters(), 'no link in a parameter (review UI/UX round 1)');
        $this->assertSame("$ownerName shared the board $title with you", $en->getParsedSubject());
        $this->assertSame($url, $en->getLink());
        $this->assertStringNotContainsString('/p/', $en->getLink(), 'the board page, never a link with token');
        $this->assertSame(self::ICON, $en->getIcon());
        $this->assertSame('', $en->getParsedMessage());
        $this->assertSame([], $en->getParsedActions());
        $this->assertTrue($en->isValidParsed(), "Nextcloud's validator accepts the English text");
        $de = ($notifier ?? $this->notifier())->prepare(clone $n, 'de');
        $this->assertSame('{owner} hat das Board {title} mit dir geteilt', $de->getRichSubject());
        $this->assertSame($en->getRichSubjectParameters(), $de->getRichSubjectParameters());
        $this->assertSame("$ownerName hat das Board $title mit dir geteilt", $de->getParsedSubject());
        $this->assertTrue($de->isValidParsed(), "Nextcloud's validator accepts the German text");
    }

    // ── AK2 ────────────────────────────────────────────────────────────────

    public function testIdentityAndALightConstructor(): void {
        $notifier = $this->notifier();
        $this->assertSame('knorke', $notifier->getID());
        $this->assertSame('Knorke', $notifier->getName());
        try {
            $notifier->prepare(self::raw('files', 'bob', 'board', (string)$this->b, 'board_shared'), 'en');
            $this->fail('UnknownNotificationException expected');
        } catch (UnknownNotificationException) {
        }
        $this->assertSame([], $this->gets, 'no container access for constructor, getID, getName and a foreign app');
        $this->assertSame([], $this->langs);
    }

    // ── AK9: text, link, icon ──────────────────────────────────────────────

    public function testTextLinkAndIconForADirectShare(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->h->shareRows->log = [];
        $this->assertShownFor($n);
        $this->assertContains('forBoard ' . $this->b, $this->h->shareRows->log, 'roleFor ran');
        $this->assertSame([['knorke', 'en'], ['knorke', 'de']], $this->langs, "the recipient's language");
        $this->assertSame([BoardStore::class, SharePolicy::class, ShareService::class], array_values(array_unique($this->gets)), 'CLI: SharePolicy before roleFor (job 040)');
    }

    public function testTheWholeEntryLinksToTheBoardNoParameterCarriesALink(): void {
        // The notifications app (7.x NotificationItem useLink, 8.x the same) makes the
        // whole entry a link to getLink() in the same tab only when NO subject parameter
        // has a `link`; otherwise only that parameter is clickable, rendered as an
        // external link (target _blank, "↗"), and the row itself does nothing.
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        foreach (['en', 'de'] as $lang) {
            $n = $this->notifier()->prepare($this->sentTo('bob'), $lang);
            foreach ($n->getRichSubjectParameters() as $key => $parameter) {
                $this->assertArrayNotHasKey('link', $parameter, "$lang: parameter $key");
            }
            $this->assertSame([], $n->getRichMessageParameters());
            $this->assertSame(self::BOARD_URL . $this->b, $n->getLink(), "$lang: the entry's link is the board page");
            $this->assertTrue($n->isValidParsed(), "$lang: highlight needs only id and name");
        }
    }

    public function testTheSameThroughAGroupAndATeam(): void {
        $this->h->teams = ['T' => ['Team T', ['alice', 'dave']]];
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view'), self::e('team', 'T', 'vote')]);
        foreach ($this->h->jobs as $j) {
            $this->job()->send($j['argument']);
        }
        $this->assertShownFor($this->sentTo('carol'));
        $this->assertShownFor($this->sentTo('dave'));
    }

    public function testTitleAndOwnerNameAreReadFresh(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->h->service->rename('alice', $this->b, 'Retro {owner} Q3');
        $this->assertShownFor($n, 'Retro {owner} Q3');
        // An owner Nextcloud no longer knows: the uid as name.
        $orphan = $this->h->boards->addBoard('knorke-nope-owner', 'Orphan');
        $this->h->shareRows->add($orphan, 'user', 'bob', 'view');
        $this->assertTrue($this->h->notifications->notifyUser($orphan, 'knorke-nope-owner', 'bob'));
        $this->assertShownFor($this->sentTo('bob'), 'Orphan', 'knorke-nope-owner', 'knorke-nope-owner', $orphan);
    }

    // ── AK10: delete, keep, leave ──────────────────────────────────────────

    public function testDroppedWhenTheShareIsRemoved(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->h->shares->save('alice', $this->b, []);
        $this->assertDropped($n, 'share removed');
    }

    public function testDroppedWhenTheGroupIsLeft(): void {
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $bob = $this->sentTo('bob');
        $carol = $this->sentTo('carol');
        $this->h->groups['knorke-e2e'] = ['carol'];
        $this->h->sharePolicy->reset();
        $this->assertDropped($bob, 'bob left the group');
        $this->assertShownFor($carol);
    }

    public function testDroppedWhenTheTeamRowIsGone(): void {
        $this->h->teams = ['T' => ['Team T', ['alice', 'bob']]];
        $this->h->shares->save('alice', $this->b, [self::e('team', 'T', 'edit')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $n = $this->sentTo('bob');
        $this->assertShownFor($n);
        $this->h->shares->onTeamChanged('T', true);
        $this->assertSame([], $this->h->shareRows->of($this->b));
        $this->assertDropped($n, 'team row deleted');
    }

    public function testDroppedWhenTheBoardIsDeleted(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->h->service->delete('alice', $this->b);
        $this->assertDropped($n, 'board deleted');
        $this->assertSame([BoardStore::class], array_values(array_unique($this->gets)), 'no SharePolicy reset without roleFor()');
    }

    public function testDroppedForTheOwnerWithoutTheAppAndForUnknownAccounts(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'edit');
        $this->assertDropped(self::raw('knorke', 'alice', 'board', (string)$this->b, 'board_shared'), 'the owner herself');
        $this->h->knorkeFor = ['bob' => false];
        $this->assertDropped(self::raw('knorke', 'bob', 'board', (string)$this->b, 'board_shared'), 'bob without access to the app');
        $this->assertDropped(self::raw('knorke', 'knorke-nope-x', 'board', (string)$this->b, 'board_shared'), 'unknown account');
        $this->assertSame([BoardStore::class], array_values(array_unique($this->gets)), 'only the owner case reads the board; no SharePolicy reset without roleFor()');
    }

    /** @return iterable<string, array{0: string}> */
    public static function badObjectIds(): iterable {
        foreach (['0', 'abc', '007', '1e3', '1234567890123456789', '-1', "5\n", ' 5'] as $id) {
            yield json_encode($id) => [$id];
        }
    }

    #[DataProvider('badObjectIds')]
    public function testDroppedForObjectIdsThatAreNoBoardId(string $id): void {
        $this->assertDropped(self::raw('knorke', 'bob', 'board', $id, 'board_shared'), "object id $id");
        $this->assertSame([], $this->gets, 'nothing read');
    }

    public function testKeptAfterARoleChange(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob', 'edit')]);
        $n = $this->sentTo('bob');
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob', 'view')]);
        $this->assertShownFor($n);
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob', 'vote')]);
        $this->assertShownFor($n);
        $this->assertSame([], $this->h->warnings);
    }

    public function testLeftInPlaceWhenReadingFails(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->h->shareRows->failWith = new \RuntimeException('database gone');
        try {
            $this->notifier()->prepare($n, 'en');
            $this->fail('UnknownNotificationException expected');
        } catch (UnknownNotificationException) {
        }
        $this->assertSame(['Knorke: preparing a share notification failed'], $this->h->warnings);
        $this->assertSame('', $n->getParsedSubject(), 'nothing filled in');
    }

    public function testUnknownSubjectOrObjectTypeIsNotOurs(): void {
        foreach ([['board', 'other'], ['item', 'board_shared']] as [$type, $subject]) {
            try {
                $this->notifier()->prepare(self::raw('knorke', 'bob', $type, (string)$this->b, $subject), 'en');
                $this->fail("UnknownNotificationException expected for $type/$subject");
            } catch (UnknownNotificationException) {
            }
        }
        $this->assertSame([], $this->gets);
    }

    // ── Job 040: fresh rights in long-running CLI processes ────────────────
    // One AccessHarness = one process: the same SharePolicy throughout, and
    // the test never calls $h->sharePolicy->reset() between two prepare().

    public function testCliGroupLeftBetweenTwoPrepares(): void {
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $n = $this->sentTo('bob');
        $notifier = $this->notifier();
        $this->assertSame('Alice Display shared the board Workshop Beta with you', $notifier->prepare(clone $n, 'en')->getParsedSubject());
        $this->h->groups['knorke-e2e'] = ['carol'];
        $this->assertDropped(clone $n, 'bob left the group while the worker runs', $notifier);
        $this->assertShownFor($this->sentTo('carol'), notifier: $notifier);
    }

    public function testCliTeamLeftBetweenTwoPrepares(): void {
        $this->h->teams = ['T' => ['Team T', ['alice', 'bob']]];
        $this->h->shares->save('alice', $this->b, [self::e('team', 'T', 'edit')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $n = $this->sentTo('bob');
        $notifier = $this->notifier();
        $this->assertSame('Alice Display shared the board Workshop Beta with you', $notifier->prepare(clone $n, 'en')->getParsedSubject());
        $this->h->teams['T'][1] = ['alice'];
        $this->assertSame(['team:T=edit'], $this->h->shareRows->of($this->b), 'the team row is still there: only the membership ended');
        $this->h->teamCalls = [];
        $this->assertDropped(clone $n, 'bob left the team while the worker runs', $notifier);
        $this->assertSame(['bob'], $this->h->teamCalls, 'the teams were read again');
    }

    public function testCliGroupJoinedAfterADroppedNotification(): void {
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $notifier = $this->notifier();
        $this->assertDropped(self::raw('knorke', 'dave', 'board', (string)$this->b, 'board_shared'), 'dave is no member', $notifier);
        $this->h->groups['knorke-e2e'][] = 'dave';
        $this->assertShownFor(self::raw('knorke', 'dave', 'board', (string)$this->b, 'board_shared'), notifier: $notifier);
    }

    public function testWebKeepsTheAnswersOfTheRequest(): void {
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $n = $this->sentTo('bob');
        $notifier = $this->notifier(web: true);
        $text = 'Alice Display shared the board Workshop Beta with you';
        $this->assertSame($text, $notifier->prepare(clone $n, 'en')->getParsedSubject());
        $this->h->groups['knorke-e2e'] = ['carol'];
        $this->assertSame($text, $notifier->prepare(clone $n, 'en')->getParsedSubject(), 'same request: the remembered groups stay');
        $this->assertSame([BoardStore::class, ShareService::class], array_values(array_unique($this->gets)), 'web: SharePolicy never fetched');
        $this->h->sharePolicy->reset(); // a new request
        $this->assertDropped(clone $n, 'bob left the group, next request', $notifier);
    }

    public function testCliKeptWhenSharePolicyCannotBeFetched(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->getFails[SharePolicy::class] = new \RuntimeException('container broken');
        try {
            $this->notifier()->prepare($n, 'en');
            $this->fail('UnknownNotificationException expected');
        } catch (UnknownNotificationException) {
        }
        $this->assertSame(['Knorke: preparing a share notification failed'], $this->h->warnings);
        $this->assertSame('', $n->getParsedSubject(), 'nothing filled in');
        $this->assertNotContains(ShareService::class, $this->gets, 'roleFor() not reached');
    }

    // ── Job 055: accounts of the Guests app follow its app whitelist ───────

    /**
     * gast, an account of the Guests app, with a view share on the board:
     * the notification ShareService::save() sent it and the same one as
     * stored by hand.
     *
     * @return array<string, INotification>
     */
    private function gastShared(): array {
        $this->h->backends['gast'] = 'Guests';
        $this->h->shares->save('alice', $this->b, [self::e('user', 'gast', 'view')]);
        $this->assertSame(['user:gast=view'], $this->h->shareRows->of($this->b));
        return [
            'sent by ShareService::save' => $this->sentTo('gast'),
            'raw' => self::raw('knorke', 'gast', 'board', (string)$this->b, 'board_shared'),
        ];
    }

    public function testAGuestKeptOutGetsNothingAndNothingIsRead(): void {
        foreach ($this->gastShared() as $label => $n) {
            $this->guests = new FakeGuestsWhitelist(false);
            $this->gets = [];
            $this->assertDropped($n, $label);
            $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls, "$label: asked once, for the fixed path");
            $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets, "$label: no BoardStore, nothing of Knorke");
            $this->assertSame([], $this->h->warnings, $label);
            $this->assertSame([], $this->langs, "$label: no text built");
        }
    }

    #[DataProviderExternal(BoardSearchProviderTest::class, 'guestsFailures')]
    public function testTheBellFailsClosedForAGuest(string $kind, mixed $answer): void {
        foreach ($this->gastShared() as $label => $n) {
            $this->guests = FakeGuestsWhitelist::failing($kind, $answer);
            $this->gets = [];
            $this->assertDropped($n, $label);
            if ($this->guests instanceof FakeGuestsWhitelist) {
                $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls, $label);
            }
            $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets, "$label: no BoardStore, no logger");
            $this->assertSame([], $this->h->warnings, "$label: no log");
            $this->assertSame([], $this->langs, $label);
        }
    }

    public function testAGuestLetInSeesItLikeAnyAccount(): void {
        foreach ($this->gastShared() as $label => $n) {
            $this->guests = new FakeGuestsWhitelist(true);
            $this->gets = [];
            $notifier = $this->notifier();
            $this->assertShownFor($n, notifier: $notifier);
            $this->assertSame([['gast', '/apps/knorke/'], ['gast', '/apps/knorke/']], $this->guests->calls, "$label: asked for English and for German");
            $this->assertSame([GuestsAppWhitelist::WHITELIST, BoardStore::class, SharePolicy::class, ShareService::class], $this->gets,
                "$label: the whitelist fetched once, then as for any account");
            $this->guests->answer = false;
            $this->assertDropped(clone $n, "$label: the answer is not kept", $notifier);
            $this->assertCount(3, $this->guests->calls, $label);
        }
    }

    public function testAFailedLookupOfTheWhitelistIsNotKept(): void {
        $n = $this->gastShared()['sent by ShareService::save'];
        $notifier = $this->notifier();
        $this->assertDropped(clone $n, 'without the Guests app', $notifier);
        $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets);
        $this->guests = new FakeGuestsWhitelist(true);
        $this->assertShownFor($n, notifier: $notifier);
        $this->assertSame([GuestsAppWhitelist::WHITELIST, GuestsAppWhitelist::WHITELIST, BoardStore::class, SharePolicy::class, ShareService::class], $this->gets,
            'the same notifier asks the container again');
        $this->assertCount(2, $this->guests->calls);
    }

    public function testOtherAccountsNeverAskTheGuestsApp(): void {
        $this->h->shares->save('alice', $this->b, [self::e('user', 'bob')]);
        $n = $this->sentTo('bob');
        $this->guests = new FakeGuestsWhitelist(false);
        $this->assertContains($this->h->user('bob')?->getBackendClassName(), [null, ''], 'precondition: no backend name without an entry');
        foreach ([null, '', 'Database', 'guests', 'OCA\Guests\UserBackend'] as $backend) {
            $label = var_export($backend, true);
            if ($backend === null) {
                unset($this->h->backends['bob']);
            } else {
                $this->h->backends['bob'] = $backend;
            }
            $this->gets = [];
            $this->assertShownFor($n);
            $this->assertSame([], $this->guests->calls, $label);
            $this->assertNotContains(GuestsAppWhitelist::WHITELIST, $this->gets, $label);
        }
    }

    public function testTheCheapChecksComeBeforeTheGuestsApp(): void {
        $this->h->backends['gast'] = 'Guests';
        $this->h->shareRows->add($this->b, 'user', 'gast', 'view');
        $this->guests = new FakeGuestsWhitelist(false);
        foreach ([['files', 'board', 'board_shared'], ['knorke', 'board', 'other'], ['knorke', 'item', 'board_shared']] as [$app, $type, $subject]) {
            try {
                $this->notifier()->prepare(self::raw($app, 'gast', $type, (string)$this->b, $subject), 'en');
                $this->fail("UnknownNotificationException expected for $app/$type/$subject");
            } catch (UnknownNotificationException) {
            }
        }
        $this->assertDropped(self::raw('knorke', 'gast', 'board', 'abc', 'board_shared'), 'object id abc');
        $this->h->knorkeFor['gast'] = false;
        $this->assertDropped(self::raw('knorke', 'gast', 'board', (string)$this->b, 'board_shared'), 'gast without access to the app');
        $this->assertDropped(self::raw('knorke', 'knorke-nope-gast', 'board', (string)$this->b, 'board_shared'), 'unknown account');
        $this->assertSame([], $this->guests->calls, 'the Guests app was never asked');
        $this->assertSame([], $this->gets, 'nothing from the container');
    }

    // ── Job 058: fresh groups past Nextcloud's per-process group cache ─────
    // $h->groupCache: the group manager keeps its first answer per uid, as
    // OC\Group\Manager does in a worker that never clears it. Still one
    // AccessHarness = one process, no reset() by the test.

    public function testCliGroupLeftPastNextcloudsGroupCache(): void {
        $this->h->groupCache = true;
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $n = $this->sentTo('bob');
        $notifier = $this->notifier();
        $this->assertSame('Alice Display shared the board Workshop Beta with you', $notifier->prepare(clone $n, 'en')->getParsedSubject());
        $bob = $this->h->user('bob');
        $this->assertContains('knorke-e2e', $this->h->groupManager->getUserGroupIds($bob), 'an earlier job of the worker filled the cache');
        $this->h->groups['knorke-e2e'] = ['carol'];
        $this->assertContains('knorke-e2e', $this->h->groupManager->getUserGroupIds($bob), "precondition: Nextcloud's cache still has bob in the group");
        $this->assertDropped(clone $n, 'bob left the group, past the cache', $notifier);
        $this->assertShownFor($this->sentTo('carol'), notifier: $notifier);
    }

    public function testCliGroupJoinedPastNextcloudsGroupCache(): void {
        $this->h->groupCache = true;
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $dave = $this->h->user('dave');
        $this->assertSame([], $this->h->groupManager->getUserGroupIds($dave), 'an earlier job of the worker filled the cache');
        $notifier = $this->notifier();
        $this->assertDropped(self::raw('knorke', 'dave', 'board', (string)$this->b, 'board_shared'), 'dave is no member', $notifier);
        $this->h->groups['knorke-e2e'][] = 'dave';
        $this->assertSame([], $this->h->groupManager->getUserGroupIds($dave), "precondition: Nextcloud's cache still has no group for dave");
        $this->assertShownFor(self::raw('knorke', 'dave', 'board', (string)$this->b, 'board_shared'), notifier: $notifier);
    }

    public function testCliKeptWhenAGroupBackendFails(): void {
        $this->h->shares->save('alice', $this->b, [self::e('group', 'knorke-e2e', 'view')]);
        $this->job()->send($this->h->jobs[0]['argument']);
        $n = $this->sentTo('bob');
        $this->h->groupsFailWith = new \RuntimeException('backend down');
        try {
            $this->notifier()->prepare($n, 'en');
            $this->fail('UnknownNotificationException expected');
        } catch (UnknownNotificationException) {
        }
        $this->assertSame(['Knorke: preparing a share notification failed'], $this->h->warnings);
        $this->assertSame('', $n->getParsedSubject(), 'nothing filled in');
        $this->assertContains('getUserGroups bob', $this->h->groupReads, 'the backend was asked');
    }
}
