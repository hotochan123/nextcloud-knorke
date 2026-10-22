<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\BackgroundJob\CleanupJob;
use OCA\Knorke\Listener\UserDeletedListener;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\CompactorHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeItemStore;
use OCA\Knorke\Tests\Support\StubReconciler;
use OCA\Knorke\Tests\Support\SyncHarness;
use OCA\Knorke\Tests\Support\VoteHarness;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\Event;
use OCP\IUser;
use OCP\User\Events\UserDeletedEvent;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * UserDeletedListener never lets an exception escape (boards, votes and, job
 * 023, the locks each on their own); CleanupJob prunes > 30 days.
 */
final class ListenerAndJobTest extends TestCase {
    public function testListenerDelegatesAndSwallows(): void {
        $h = new AccessHarness();
        $b = $h->service->create('dora', 'D')['id'];
        $errors = [];
        $logger = Fake::of(LoggerInterface::class, ['error' => function ($m, array $c = []) use (&$errors): void {
            $errors[] = $m;
        }]);
        $user = Fake::of(IUser::class, ['getUID' => fn () => 'dora']);
        $votes = (new VoteHarness())->votes;
        $sync = (new SyncHarness())->sync;
        (new UserDeletedListener($h->service, $votes, $h->access, $logger, $sync))->handle(new UserDeletedEvent($user));
        $this->assertArrayNotHasKey($b, $h->boards->boards);
        (new UserDeletedListener($h->service, $votes, $h->access, $logger, $sync))->handle(new Event());
        $broken = (new \ReflectionClass(BoardService::class))->newInstanceWithoutConstructor();
        (new UserDeletedListener($broken, $votes, $h->access, $logger, $sync))->handle(new UserDeletedEvent($user));
        $this->assertCount(1, $errors, 'logged, not thrown');
        // A broken vote clean-up is logged on its own and does not stop the board clean-up.
        $b2 = $h->service->create('dora', 'D2')['id'];
        $brokenVotes = (new \ReflectionClass(VoteService::class))->newInstanceWithoutConstructor();
        (new UserDeletedListener($h->service, $brokenVotes, $h->access, $logger, $sync))->handle(new UserDeletedEvent($user));
        $this->assertArrayNotHasKey($b2, $h->boards->boards);
        $this->assertCount(2, $errors);
        $this->assertSame('Knorke: removing the votes of a deleted account failed', $errors[1]);
    }

    public function testCleanupJobPrunesChangesAndRevokedLinks(): void {
        $log = [];
        $items = new FakeItemStore($log);
        $now = 100 * 24 * 3600 * 1000;
        $items->changes = [
            ['board' => 1, 'rev' => 1, 'item' => 'a', 'op' => 'put', 'patch' => null, 'actor' => 'u:a', 'client' => 'c', 'ts' => $now - Limits::CHANGES_RETENTION_MS - 1],
            ['board' => 1, 'rev' => 2, 'item' => 'a', 'op' => 'put', 'patch' => null, 'actor' => 'u:a', 'client' => 'c', 'ts' => $now - 1000],
        ];
        $h = new AccessHarness();
        $b = $h->boards->addBoard('a');
        $h->link($b, $now - Limits::CHANGES_RETENTION_MS - 1, 'Old3Ef6hIj9kLm2nOp5qRs8t');
        $h->link($b, $now - 1000, 'New3Ef6hIj9kLm2nOp5qRs8t');
        $h->link($b, null, 'Act3Ef6hIj9kLm2nOp5qRs8t');
        $orphans = new StubReconciler();
        $job = new CleanupJob(Fake::of(ITimeFactory::class, ['getTime' => fn () => 0]), CompactorHarness::over($items, $h->boards)->compactor, $orphans, Fake::of(LoggerInterface::class));
        $this->assertSame(['changes' => 1, 'links' => 1, 'boards' => [], 'complete' => true], $job->prune($now), 'instance-wide as before; the board has no item rows here');
        $this->assertSame(['daily ' . $now], $orphans->calls, 'P7: the orphan reconciliation runs after the clean-up, with the job clock');
        // A failing reconciliation is logged, never thrown; the clean-up result stands.
        $errors = [];
        $orphans->throw = new \RuntimeException('user backend down');
        $job = new CleanupJob(Fake::of(ITimeFactory::class, ['getTime' => fn () => 0]), CompactorHarness::over($items, $h->boards)->compactor, $orphans,
            Fake::of(LoggerInterface::class, ['error' => function ($m, array $c = []) use (&$errors): void {
                $errors[] = (string)$m;
            }]));
        $this->assertSame(['changes' => 0, 'links' => 0, 'boards' => [], 'complete' => true], $job->prune($now));
        $this->assertSame(['Knorke: the daily orphan reconciliation failed'], $errors);
        $this->assertCount(1, $items->changes);
        $this->assertSame(['New3Ef6hIj9kLm2nOp5qRs8t', 'Act3Ef6hIj9kLm2nOp5qRs8t'], array_values(array_column($h->boards->links, 'token')));
    }

    /**
     * AK4 (job 023): the deleted account's name and id leave its locks on
     * every board, in one short transaction per board (lockAndBumpRev first,
     * the rows get the new rev, bumpRev after COMMIT); other lockers and
     * boards stay; the item stays locked (locker unknown, only moderators
     * unlock) and reaches open clients through itemsSince.
     */
    public function testListenerClearsTheLocksOfTheDeletedAccount(): void {
        $s = new SyncHarness();
        $st = $s->store;
        $id = static fn (int $n): string => sprintf('01JM%022d', $n);
        foreach ([1, 2, 3] as $b) {
            $st->addBoard($b, 10);
        }
        $note = ['t' => 'sticky', 'x' => 0, 'y' => 0, 'z' => 'i1', 'data' => ['text' => 'n'], 'style' => ['fill' => '#a8d8f8']];
        $st->seed(1, $id(1), $note, 5);
        $st->seedLock(1, $id(1), 'u:bob', 'Bob');
        $st->seed(1, $id(2), $note, 6);
        $st->seedLock(1, $id(2), 'u:carol', 'Carol');
        $st->seed(2, $id(3), $note, 7);
        $st->seedLock(2, $id(3), 'u:bob', 'Bob');
        $st->seed(3, $id(4), $note, 8);
        $st->seedLock(3, $id(4), 'g:gAbcdefghijk', 'Gina');
        $before = [$st->items[1][$id(2)], $st->items[3][$id(4)]];
        $errors = [];
        $logger = Fake::of(LoggerInterface::class, ['error' => function ($m, array $c = []) use (&$errors): void {
            $errors[] = (string)$m;
        }]);
        $h = new AccessHarness();
        $user = Fake::of(IUser::class, ['getUID' => fn () => 'bob']);
        $s->log = [];
        (new UserDeletedListener($h->service, (new VoteHarness())->votes, $h->access, $logger, $s->sync))->handle(new UserDeletedEvent($user));
        $this->assertSame([], $errors);
        $this->assertSame([1, null, null], $st->lockOf(1, $id(1)), 'still locked, locker unknown');
        $this->assertSame([1, null, null], $st->lockOf(2, $id(3)));
        $this->assertSame([11, 11, 10], [$st->boards[1]['rev'], $st->boards[2]['rev'], $st->boards[3]['rev']], 'rev + 1 per affected board only');
        $this->assertSame([11, 11], [$st->items[1][$id(1)]['rev'], $st->items[2][$id(3)]['rev']], 'the rows carry the new rev');
        $this->assertSame($before, [$st->items[1][$id(2)], $st->items[3][$id(4)]], 'carol\'s and the guest\'s locks stay');
        $this->assertSame([], $st->changes, 'no change rows');
        $this->assertSame(['boardsLockedBy u:bob', 'begin', 'lockAndBumpRev', 'clearLockerRows 1 u:bob', 'commit', 'bumpRev 11',
            'begin', 'lockAndBumpRev', 'clearLockerRows 2 u:bob', 'commit', 'bumpRev 11'], $s->log, 'board by board, bumpRev after COMMIT');
        $snap = json_decode($s->sync->snapshotJson(new AccessResult(SyncHarness::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']), true);
        $this->assertSame(['by' => null, 'name' => null], array_column($snap['items'], 'lock', 'id')[$id(1)]);
        $d = $s->syncDecoded(['since' => 10, 'pres' => 0]);
        $this->assertSame([$id(1)], array_column($d['items'], 'id'), 'an open client gets the item through itemsSince');
        $this->assertSame(['by' => null, 'name' => null], $d['items'][0]['lock']);
        $unlock = ['o' => 'patch', 'id' => $id(1), 'p' => ['lock' => null]];
        $this->assertSame(['itemlocked'], $s->apply([$unlock], SyncHarness::user('dan', Role::Edit, 'share'))[1], 'nobody owns the lock now');
        $this->assertSame(['itemlocked'], $s->apply([$unlock], SyncHarness::user('bob', Role::Edit, 'share'))[1], 'not even a new account with the same uid');
        $this->assertSame(['ok'], $s->apply([$unlock], SyncHarness::user('alice'))[1], 'the owner lifts it');
        // A second deletion finds nothing: no transaction, no rev jump.
        $s->log = [];
        $this->assertSame(0, $s->sync->clearLocker('u:bob', $s->now));
        $this->assertSame(['boardsLockedBy u:bob'], $s->log);
    }

    public function testAFailingLockCleanUpIsLoggedAndTheOtherPartsRun(): void {
        $h = new AccessHarness();
        $b = $h->service->create('dora', 'D')['id'];
        $errors = [];
        $logger = Fake::of(LoggerInterface::class, ['error' => function ($m, array $c = []) use (&$errors): void {
            $errors[] = (string)$m;
        }]);
        $user = Fake::of(IUser::class, ['getUID' => fn () => 'dora']);
        $votes = new class() extends VoteService {
            public array $calls = [];

            public function __construct() {
            }

            public function onUserDeleted(string $uid, \Closure $pidOf): void {
                $this->calls[] = $uid;
            }
        };
        $broken = new class() extends SyncService {
            public function __construct() {
            }

            public function clearLocker(string $principalId, int $nowMs): int {
                throw new \RuntimeException('database gone');
            }
        };
        (new UserDeletedListener($h->service, $votes, $h->access, $logger, $broken))->handle(new UserDeletedEvent($user));
        $this->assertArrayNotHasKey($b, $h->boards->boards, 'the boards block ran');
        $this->assertSame(['dora'], $votes->calls, 'the votes block ran');
        $this->assertSame(['Knorke: removing a deleted account from its locks failed'], $errors, 'logged, not thrown');
    }
}
