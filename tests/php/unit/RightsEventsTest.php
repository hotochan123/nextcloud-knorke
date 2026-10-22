<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Circles\Events\CircleDestroyedEvent;
use OCA\Circles\Events\DestroyingCircleEvent;
use OCA\Circles\Events\MembershipsRemovedEvent;
use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\BackgroundJob\AclBumpJob;
use OCA\Knorke\BackgroundJob\CleanupJob;
use OCA\Knorke\Listener\GroupListener;
use OCA\Knorke\Listener\TeamListener;
use OCA\Knorke\Listener\UserDeletedListener;
use OCA\Knorke\Notification\Notifier;
use OCA\Knorke\Search\BoardSearchProvider;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\ShareService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeItemStore;
use OCA\Knorke\Tests\Support\SyncHarness;
use OCA\Knorke\Tests\Support\VoteHarness;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\Event;
use OCP\Group\Events\GroupDeletedEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\IGroup;
use OCP\IUser;
use OCP\User\Events\UserDeletedEvent;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

require_once __DIR__ . '/../Support/CirclesEventStubs.php';

/**
 * Rights invalidation by events (SPEC-M1 §4.13.9): the group and team
 * listeners bump acl_gen of exactly the affected boards (ascending, one
 * transaction each), delete the rows of deleted groups/teams first, never
 * throw; more than 50 boards go to AclBumpJob with board-id lists; the
 * Circles listener works by class-name string and method_exists (R13).
 */
final class RightsEventsTest extends TestCase {
    private AccessHarness $h;
    /** @var list<string> */
    private array $warnings = [];

    protected function setUp(): void {
        $this->h = new AccessHarness();
    }

    private function logger(): LoggerInterface {
        return Fake::of(LoggerInterface::class, ['warning' => function ($m, array $c = []): void {
            $this->warnings[] = (string)$m;
        }]);
    }

    private function group(string $gid): IGroup {
        return Fake::of(IGroup::class, ['getGID' => fn (): string => $gid]);
    }

    private function acl(int $b): int {
        return $this->h->boards->boards[$b]['acl_gen'];
    }

    public function testRegistration(): void {
        $seen = [];
        $search = [];
        $notifiers = [];
        $order = [];
        $context = Fake::of(IRegistrationContext::class, [
            'registerEventListener' => function (string $event, string $listener, int $priority = 0) use (&$seen, &$order): void {
                $seen[] = [$event, $listener];
                $order[] = 'listener';
            },
            'registerSearchProvider' => function (string $class) use (&$search, &$order): void {
                $search[] = $class;
                $order[] = 'search';
            },
            'registerNotifierService' => function (string $class) use (&$notifiers, &$order): void {
                $notifiers[] = $class;
                $order[] = 'notifier';
            },
        ]);
        // App::__construct needs the server; register() only names classes.
        (new \ReflectionClass(Application::class))->newInstanceWithoutConstructor()->register($context);
        $this->assertSame([
            [UserDeletedEvent::class, UserDeletedListener::class],
            [UserRemovedEvent::class, GroupListener::class],
            [GroupDeletedEvent::class, GroupListener::class],
            ['OCA\Circles\Events\MembershipsRemovedEvent', TeamListener::class],
            ['OCA\Circles\Events\CircleDestroyedEvent', TeamListener::class],
            ['OCA\Circles\Events\DestroyingCircleEvent', TeamListener::class],
        ], $seen);
        $this->assertSame([BoardSearchProvider::class], $search, 'unified search (M2): exactly one provider, by class name');
        $this->assertSame('OCA\Knorke\Search\BoardSearchProvider', BoardSearchProvider::class);
        $this->assertSame([Notifier::class], $notifiers, 'share notifications (M2): exactly one notifier, by class name');
        $this->assertSame('OCA\Knorke\Notification\Notifier', Notifier::class);
        $this->assertSame(['listener', 'listener', 'listener', 'listener', 'listener', 'listener', 'search', 'notifier'], $order, 'the notifier after the search provider');
        $this->assertSame('OCA\Circles\Events\DestroyingCircleEvent', TeamListener::DESTROYING_CIRCLE, 'R14-03: by class-name string');
        $src = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Listener/TeamListener.php');
        $this->assertStringNotContainsString('use OCA\Circles', $src, 'no Circles import: a disabled Circles app loads nothing');
    }

    public function testGroupListener(): void {
        $b1 = $this->h->boards->addBoard('alice');
        $b2 = $this->h->boards->addBoard('bob');
        $b3 = $this->h->boards->addBoard('carol');
        $this->h->shareRows->add($b2, 'group', 'staff', 'edit');
        $this->h->shareRows->add($b1, 'group', 'staff', 'view');
        $this->h->shareRows->add($b3, 'group', 'other', 'view');
        $l = new GroupListener($this->h->shares, $this->logger());
        $user = Fake::of(IUser::class, ['getUID' => fn (): string => 'bob']);
        $this->h->boards->log = [];
        $l->handle(new UserRemovedEvent($this->group('staff'), $user));
        $this->assertSame([2, 2, 1], [$this->acl($b1), $this->acl($b2), $this->acl($b3)]);
        $this->assertSame(['lockBoard acl-', 'lockBoard acl-'], $this->h->boards->log, 'one short transaction per board');
        $this->assertSame(['begin', 'commit', 'begin', 'commit'], $this->h->tx);
        $this->assertSame(2, $this->h->cache->getGens($b1)['acl'], 'setGens after COMMIT');
        $this->assertSame(['group:staff=view'], $this->h->shareRows->of($b1), 'a removed member deletes nothing');
        $l->handle(new GroupDeletedEvent($this->group('staff')));
        $this->assertSame([[], []], [$this->h->shareRows->of($b1), $this->h->shareRows->of($b2)]);
        $this->assertSame(['group:other=view'], $this->h->shareRows->of($b3));
        $this->assertSame([3, 3, 1], [$this->acl($b1), $this->acl($b2), $this->acl($b3)]);
        $l->handle(new Event());
        $this->assertSame([], $this->warnings);
    }

    public function testListenersNeverThrow(): void {
        $this->h->shareRows->failWith = new \RuntimeException('database gone');
        $logger = $this->logger();
        (new GroupListener($this->h->shares, $logger))->handle(new GroupDeletedEvent($this->group('staff')));
        (new TeamListener($this->h->shares, $logger))->handle(new CircleDestroyedEvent(new class() {
            public function getSingleId(): string {
                return 'tN';
            }
        }));
        $this->assertCount(2, $this->h->warnings, 'logged as warnings by ShareService');
        // A broken service: the listener itself catches.
        $broken = (new \ReflectionClass(ShareService::class))->newInstanceWithoutConstructor();
        (new GroupListener($broken, $logger))->handle(new UserRemovedEvent($this->group('staff'), Fake::of(IUser::class)));
        (new TeamListener($broken, $logger))->handle(new MembershipsRemovedEvent([new class() {
            public function getCircleId(): string {
                return 'tN';
            }
        }]));
        $this->assertCount(2, $this->warnings, 'the listeners logged, nothing escaped');
    }

    public function testTeamListenerOneBumpPerBoardR13(): void {
        $b1 = $this->h->boards->addBoard('alice');
        $b2 = $this->h->boards->addBoard('alice');
        $b3 = $this->h->boards->addBoard('alice');
        $this->h->shareRows->add($b1, 'team', 'tN', 'edit');
        $this->h->shareRows->add($b2, 'team', 'tN', 'view');
        $this->h->shareRows->add($b2, 'team', 'tS', 'view');
        $this->h->shareRows->add($b3, 'team', 'tOther', 'view');
        $membership = static fn (string $circle, string $member) => new class($circle, $member) {
            public function __construct(private string $circle, private string $member) {
            }

            public function getCircleId(): string {
                return $this->circle;
            }

            public function getSingleId(): string {
                return $this->member;
            }
        };
        $l = new TeamListener($this->h->shares, $this->logger());
        // Two entries of the same circle (and the member's own singleId, which must never be used).
        $l->handle(new MembershipsRemovedEvent([$membership('tN', 'memberBob'), $membership('tN', 'memberBob'), $membership('tS', 'tOther')]));
        $this->assertSame([2, 2, 1], [$this->acl($b1), $this->acl($b2), $this->acl($b3)], 'exactly one bump per board; getSingleId() (the member) ignored');
        $this->assertSame(['team:tN=edit'], $this->h->shareRows->of($b1), 'rows stay');
        // Destroyed: the rows of the team go, its boards are bumped.
        $l->handle(new CircleDestroyedEvent(new class() {
            public function getSingleId(): string {
                return 'tN';
            }
        }));
        $this->assertSame([[], ['team:tS=view']], [$this->h->shareRows->of($b1), $this->h->shareRows->of($b2)]);
        $this->assertSame([3, 3, 1], [$this->acl($b1), $this->acl($b2), $this->acl($b3)]);
        $this->assertSame([], $this->warnings);
    }

    /**
     * R14-03 (§4.13.9): DestroyingCircleEvent — synchronous, also for occ
     * circles:manage:destroy — deletes the team's rows and bumps their
     * boards; the later CircleDestroyedEvent (async result) finds nothing
     * left: idempotent, no second bump, no warning.
     */
    public function testDestroyingCircleEventDeletesTheTeamRowsR1403(): void {
        $b1 = $this->h->boards->addBoard('alice');
        $b2 = $this->h->boards->addBoard('alice');
        $b3 = $this->h->boards->addBoard('alice');
        $this->h->shareRows->add($b2, 'team', 'tN', 'edit');
        $this->h->shareRows->add($b1, 'team', 'tN', 'view');
        $this->h->shareRows->add($b1, 'user', 'bob', 'edit');
        $this->h->shareRows->add($b3, 'team', 'tS', 'view');
        $circle = new class() {
            public function getSingleId(): string {
                return 'tN';
            }
        };
        $l = new TeamListener($this->h->shares, $this->logger());
        $this->h->boards->log = [];
        $l->handle(new DestroyingCircleEvent($circle));
        $this->assertSame([['user:bob=edit'], [], ['team:tS=view']], [$this->h->shareRows->of($b1), $this->h->shareRows->of($b2), $this->h->shareRows->of($b3)],
            'only the rows of the destroyed team go');
        $this->assertSame([2, 2, 1], [$this->acl($b1), $this->acl($b2), $this->acl($b3)]);
        $this->assertSame(['lockBoard acl-', 'lockBoard acl-'], $this->h->boards->log, 'one short transaction per board');
        $this->assertSame(2, $this->h->cache->getGens($b2)['acl'], 'setGens after COMMIT');
        // The second path afterwards: nothing left, nothing bumped.
        $l->handle(new CircleDestroyedEvent($circle));
        $this->assertSame([2, 2, 1], [$this->acl($b1), $this->acl($b2), $this->acl($b3)], 'CircleDestroyedEvent after it: idempotent');
        $this->assertSame([], $this->warnings);
    }

    public function testTeamListenerChecksMethods(): void {
        $l = new TeamListener($this->h->shares, $this->logger());
        $l->handle(new MembershipsRemovedEvent([new \stdClass()]));
        $l->handle(new CircleDestroyedEvent(new \stdClass()));
        $l->handle(new DestroyingCircleEvent(new \stdClass()));
        $this->assertCount(3, $this->warnings);
        $this->assertStringContainsString('getCircleId', $this->warnings[0]);
        $this->assertStringContainsString('getSingleId', $this->warnings[1]);
        $this->assertStringContainsString('getSingleId', $this->warnings[2]);
    }

    public function testUserDeletedListenerRemovesUserShares(): void {
        $b = $this->h->boards->addBoard('carol');
        $this->h->shareRows->add($b, 'user', 'dora', 'edit');
        $this->h->shareRows->add($b, 'group', 'dora', 'edit');
        (new UserDeletedListener($this->h->service, (new VoteHarness())->votes, $this->h->access, $this->logger(), (new SyncHarness())->sync))->handle(new UserDeletedEvent(Fake::of(IUser::class, ['getUID' => fn () => 'dora'])));
        $this->assertSame(['group:dora=edit'], $this->h->shareRows->of($b), 'only kind user');
        $this->assertSame(2, $this->acl($b));
    }

    public function testAclBumpJobTakesBoardIds(): void {
        $ids = [];
        for ($i = 0; $i < 3; $i++) {
            $ids[] = $this->h->boards->addBoard('alice');
        }
        $job = new AclBumpJob(Fake::of(ITimeFactory::class), $this->h->shares);
        $this->assertSame(3, $job->bump(['boards' => [$ids[2], $ids[0], $ids[1], 999, 'x', -1]]));
        $this->assertSame([2, 2, 2], array_map(fn (int $b): int => $this->acl($b), $ids));
        $this->assertSame(0, $job->bump(null));
        $this->assertSame(0, $job->bump(['kind' => 'group', 'recipient' => 'staff']), 'only board ids (R2)');
        $this->assertSame(3, $job->bump(['boards' => array_merge($ids, range(10_000, 11_000))]), 'at most 500 ids per job');
    }

    public function testCleanupJobPrunesExpiredLinks(): void {
        $log = [];
        $items = new FakeItemStore($log);
        $now = 100 * 24 * 3600 * 1000;
        $old = $now - Limits::CHANGES_RETENTION_MS - 1;
        $b = $this->h->boards->addBoard('a');
        $this->h->link($b, null, 'Exp3Ef6hIj9kLm2nOp5qRs8t', 'edit', null, $old);
        $expiredId = $this->h->boards->activeLinkOf($b, 'edit')['id'];
        $this->h->boards->addMember($b, 'bob', 'edit', $expiredId, 0);
        $this->h->link($b, null, 'Rec3Ef6hIj9kLm2nOp5qRs8t', 'vote', null, $now - 1000);
        $this->h->link($b, $old, 'Rev3Ef6hIj9kLm2nOp5qRs8t');
        $job = new CleanupJob(Fake::of(ITimeFactory::class, ['getTime' => fn () => 0]), \OCA\Knorke\Tests\Support\CompactorHarness::over($items, $this->h->boards)->compactor,
            new \OCA\Knorke\Tests\Support\StubReconciler(), Fake::of(\Psr\Log\LoggerInterface::class));
        $this->assertSame(['changes' => 0, 'links' => 2, 'boards' => [], 'complete' => true], $job->prune($now));
        $this->assertSame(['Rec3Ef6hIj9kLm2nOp5qRs8t'], array_values(array_column($this->h->boards->links, 'token')), 'expired 30+ days and revoked 30+ days go, a recent expiry stays');
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$b], 'the member rows of a pruned link go along');
    }
}
