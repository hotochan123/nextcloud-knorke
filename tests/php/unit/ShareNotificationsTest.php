<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OC\Notification\Notification;
use OCA\Knorke\BackgroundJob\ShareNotifyJob;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Notification\ShareNotifications;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\TestCase;

/**
 * "Board shared with you" (M2, SPEC-M1 §1.2, §11 Q8), the sending side:
 * ShareService::save() notifies only for inserted rows and only after
 * COMMIT, accounts at once (defer/flush, markProcessed before notify),
 * groups and teams through ShareNotifyJob; the job fans out to at most
 * 500 members, without the owner and members with an own user row; no
 * failure here breaks a PUT or escapes the job. Built on AccessHarness
 * (real ShareService, SharePolicy and ShareNotifications over the fake
 * stores) with Nextcloud's own Notification, Validator and formatter.
 */
final class ShareNotificationsTest extends TestCase {
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->boards->addBoard('alice', 'Workshop Beta');
    }

    private function save(array $shares, ?int $board = null): array {
        return $this->h->shares->save('alice', $board ?? $this->b, $shares);
    }

    private static function e(string $kind, string $id, string $role = 'edit'): array {
        return ['kind' => $kind, 'id' => $id, 'role' => $role];
    }

    private function job(): ShareNotifyJob {
        return new ShareNotifyJob(Fake::of(ITimeFactory::class), $this->h->notifications);
    }

    private function send(string $kind, string $recipient, ?int $board = null): int {
        return $this->job()->send(['board' => $board ?? $this->b, 'kind' => $kind, 'recipient' => $recipient]);
    }

    /** "notify <user> board <b> board_shared <time>" */
    private function notifyLine(string $uid, ?int $board = null): string {
        return 'notify ' . $uid . ' board ' . ($board ?? $this->b) . ' board_shared ' . $this->h->time;
    }

    /** "markProcessed <user> board <b> board_shared 0" (no date: matched by app, user, object, subject) */
    private function processedLine(string $uid, ?int $board = null): string {
        return 'markProcessed ' . $uid . ' board ' . ($board ?? $this->b) . ' board_shared 0';
    }

    /** @return list<string> uids handed to notify(), in order */
    private function notified(): array {
        return array_values(array_map(static fn (string $l): string => explode(' ', $l)[1],
            array_filter($this->h->notifyLog, static fn (string $l): bool => str_starts_with($l, 'notify '))));
    }

    /** @return list<array> the ShareNotifyJob entries of IJobList */
    private function notifyJobs(): array {
        return array_values(array_filter($this->h->jobs, static fn (array $j): bool => $j['job'] === ShareNotifyJob::class));
    }

    private function clearLogs(): void {
        $this->h->notifyLog = [];
        $this->h->sent = [];
        $this->h->jobs = [];
        $this->h->warnings = [];
        $this->h->txAtFirstNote = null;
    }

    // ── AK3: a direct share ────────────────────────────────────────────────

    public function testADirectShareNotifiesOnceAfterCommit(): void {
        $this->h->tx = [];
        $this->save([self::e('user', 'bob', 'edit')]);
        $this->assertSame(['defer', $this->processedLine('bob'), $this->notifyLine('bob'), 'flush'], $this->h->notifyLog);
        $this->assertSame(['begin', 'commit'], $this->h->txAtFirstNote, 'the manager sees its first call after COMMIT');
        $this->assertSame(['begin', 'commit'], $this->h->tx);
        $this->assertCount(1, $this->h->sent);
        $n = $this->h->sent[0];
        $this->assertInstanceOf(Notification::class, $n, "Nextcloud's own notification");
        $this->assertSame('knorke', $n->getApp());
        $this->assertSame(['bob', 'board', (string)$this->b, 'board_shared'], [$n->getUser(), $n->getObjectType(), $n->getObjectId(), $n->getSubject()]);
        $this->assertTrue($n->isValid());
        // Stored is only that: no title, no names, no link.
        $this->assertSame([], $n->getSubjectParameters());
        $this->assertSame('', $n->getRichSubject());
        $this->assertSame('', $n->getLink());
        $this->assertSame('', $n->getMessage());
        $this->assertSame([], $this->h->jobs);
        $this->assertSame([], $this->h->warnings);
        $this->assertSame(['board_shared', 'board', 500], [ShareNotifications::SUBJECT, ShareNotifications::OBJECT_TYPE, ShareNotifications::FANOUT_MAX]);
    }

    public function testAGoneRowStoredBeforeIsNewAfterAllAndNotifies(): void {
        // bob is stored when the PUT reads; a second tab removes him before the lock (§4.10.2 step 3).
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $reads = 0;
        $this->h->shareRows->onRead = function () use (&$reads): void {
            if (++$reads === 2) {
                $this->h->shareRows->rows = [];
            }
        };
        $this->save([self::e('user', 'bob', 'view')]);
        $this->assertSame(['user:bob=view'], $this->h->shareRows->of($this->b));
        $this->assertSame(['bob'], $this->notified(), 'inserted under the lock: a new share after all');
    }

    // ── AK4: nothing where nothing belongs ─────────────────────────────────

    public function testNoNotificationForChangesRemovalsRejectedPutsAndLinks(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'edit');
        // The container is never asked for ShareNotifications without an insert (warning otherwise).
        $this->h->notificationsFailWith = new \LogicException('ShareNotifications must not be built');
        // (c) the same list again
        $this->save([self::e('user', 'bob', 'edit')]);
        // (a) a role change
        $this->save([self::e('user', 'bob', 'view')]);
        $this->assertSame(['user:bob=view'], $this->h->shareRows->of($this->b));
        // (b) removed
        $this->save([]);
        $this->assertSame([], $this->h->shareRows->of($this->b));
        // (d) 21 new entries
        $many = array_map(static fn (int $i): array => self::e('user', 'u' . $i), range(1, 21));
        try {
            $this->save($many);
            $this->fail('too_many_new_shares expected');
        } catch (HttpError $e) {
            $this->assertSame('too_many_new_shares', $e->error);
        }
        // (e) an unknown recipient
        try {
            $this->save([self::e('user', 'carol'), self::e('user', 'knorke-nope-x')]);
            $this->fail('recipient_not_found expected');
        } catch (HttpError $e) {
            $this->assertSame('recipient_not_found', $e->error);
        }
        $this->assertSame([], $this->h->shareRows->of($this->b), 'nothing stored');
        // (f) links, edit and vote
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->h->service->enableLink('alice', $this->b, 'vote', []);
        $this->assertSame([], $this->h->notifyLog, 'no defer, markProcessed or notify');
        $this->assertSame([], $this->notifyJobs());
        $this->assertSame([], $this->h->warnings, 'the container was not asked');
    }

    public function testNotTheOwnerNotUnknownDisabledOrWithoutTheApp(): void {
        // (g)
        $this->h->disabledUsers = ['dave'];
        $this->h->knorkeFor = ['erin' => false];
        $this->h->notifications->sharesAdded($this->b, 'alice', [
            ['kind' => 'user', 'recipient' => 'alice'],
            ['kind' => 'user', 'recipient' => 'knorke-nope-x'],
            ['kind' => 'user', 'recipient' => 'dave'],
            ['kind' => 'user', 'recipient' => 'erin'],
        ]);
        $this->assertSame(['defer', 'flush'], $this->h->notifyLog, 'no markProcessed, no notify');
        $this->assertSame([], $this->h->jobs);
        $this->assertSame([], $this->h->warnings);
        foreach (['alice', 'knorke-nope-x', 'dave', 'erin'] as $uid) {
            $this->assertFalse($this->h->notifications->notifyUser($this->b, 'alice', $uid), $uid);
        }
        $this->assertTrue($this->h->notifications->notifyUser($this->b, 'alice', 'bob'));
    }

    // ── AK5: groups and teams only through the job ─────────────────────────

    public function testGroupsAndTeamsGoToTheJob(): void {
        $this->h->teams = ['T' => ['Team T', ['alice', 'bob']]];
        $this->save([self::e('group', 'staff', 'view'), self::e('team', 'T', 'edit')]);
        $this->assertSame([], $this->notified());
        $this->assertSame([], $this->h->notifyLog, 'nothing fanned out in the request');
        $this->assertSame([
            ['job' => ShareNotifyJob::class, 'argument' => ['board' => $this->b, 'kind' => 'group', 'recipient' => 'staff']],
            ['job' => ShareNotifyJob::class, 'argument' => ['board' => $this->b, 'kind' => 'team', 'recipient' => 'T']],
        ], $this->h->jobs);
        foreach ($this->h->jobs as $j) {
            $this->assertSame(['board', 'kind', 'recipient'], array_keys($j['argument']), 'exactly these keys in this order');
        }
        $this->assertSame('OCA\Knorke\BackgroundJob\ShareNotifyJob', ShareNotifyJob::class);

        // Mixed: the account now, the group later.
        $b2 = $this->h->boards->addBoard('alice', 'Mixed');
        $this->clearLogs();
        $this->save([self::e('user', 'carol', 'edit'), self::e('group', 'knorke-e2e', 'view')], $b2);
        $this->assertSame(['defer', $this->processedLine('carol', $b2), $this->notifyLine('carol', $b2), 'flush'], $this->h->notifyLog);
        $this->assertSame([['job' => ShareNotifyJob::class, 'argument' => ['board' => $b2, 'kind' => 'group', 'recipient' => 'knorke-e2e']]], $this->h->jobs);
    }

    public function testTheJobArgumentKeepsTheInsertOrder(): void {
        $this->h->teams = ['T' => ['Team T', ['alice']]];
        $this->save([self::e('team', 'T', 'view'), self::e('group', 'staff', 'view')]);
        $this->assertSame([['team', 'T'], ['group', 'staff']], array_map(static fn (array $j): array => [$j['argument']['kind'], $j['argument']['recipient']], $this->h->jobs));
    }

    // ── AK6: the fan-out ───────────────────────────────────────────────────

    public function testGroupFanOutSkipsOwnerDisabledNoAppAndOwnUserRows(): void {
        $this->h->groups['big'] = ['frank', 'carol', 'erin', 'alice', 'dave', 'bob'];
        $this->h->disabledUsers = ['dave'];
        $this->h->knorkeFor = ['erin' => false];
        $this->h->shareRows->add($this->b, 'group', 'big', 'view');
        $this->h->shareRows->add($this->b, 'user', 'frank', 'edit');
        $this->assertSame(2, $this->send('group', 'big'));
        $this->assertSame([
            'defer',
            $this->processedLine('bob'), $this->notifyLine('bob'),
            $this->processedLine('carol'), $this->notifyLine('carol'),
            'flush',
        ], $this->h->notifyLog, 'ascending uids between defer and flush');
        $this->assertSame(['big||501|null'], $this->h->groupSearches, 'searchUsers("", 501): never more than 501 accounts loaded');
        $this->assertSame([], $this->h->warnings);
    }

    public function testTeamFanOutFromTheOwnersPointOfView(): void {
        $this->h->teams = ['T' => ['Team T', ['alice', 'bob', 'mail@example.com']]];
        $this->h->deletedUsers = ['mail@example.com'];
        $this->h->shareRows->add($this->b, 'team', 'T', 'edit');
        $this->assertSame(1, $this->send('team', 'T'));
        $this->assertSame(['bob'], $this->notified());
        $this->assertSame(['T alice'], $this->h->memberCalls);
    }

    public function testTeamMemberKeysBecomeStrings(): void {
        // A numeric uid is an int key of getMembersOfTeam's array.
        $this->h->teams = ['T' => ['Team T', ['bob', '1234']]];
        $this->h->shareRows->add($this->b, 'team', 'T', 'view');
        $this->assertSame(2, $this->send('team', 'T'));
        $this->assertSame(['1234', 'bob'], $this->notified(), 'sorted as strings');
        $this->assertSame([], $this->h->warnings);
    }

    public function testTheJobForgetsRememberedPolicyAnswers(): void {
        $this->h->teams = ['T' => ['Team T', ['alice', 'bob']]];
        $this->h->shareRows->add($this->b, 'team', 'T', 'edit');
        $this->assertTrue($this->h->sharePolicy->teamSupport($this->h->user('alice')), 'remembered as true');
        $this->h->teamSupport = false;
        $this->assertSame(0, $this->send('team', 'T'));
        $this->assertSame([], $this->h->memberCalls, 'SharePolicy::reset() ran: no Circles call without team support');
        $this->assertSame([], $this->h->notifyLog);
    }

    // ── AK7: nothing to do ─────────────────────────────────────────────────

    public function testTheJobDoesNothingWhenTheShareOrBoardOrGroupIsGone(): void {
        // Removed before cron ran.
        $this->save([self::e('group', 'staff', 'view')]);
        $this->assertCount(1, $this->notifyJobs());
        $this->save([]);
        $this->assertSame(0, $this->job()->send($this->notifyJobs()[0]['argument']));
        // Board deleted.
        $b2 = $this->h->boards->addBoard('alice', 'Gone');
        $this->h->shareRows->add($b2, 'group', 'staff', 'view');
        $this->h->service->delete('alice', $b2);
        $this->assertSame(0, $this->send('group', 'staff', $b2));
        // Group no longer there.
        $this->h->shareRows->add($this->b, 'group', 'vanished', 'view');
        $this->assertSame(0, $this->send('group', 'vanished'));
        // Another recipient than the row (byte-exact).
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'view');
        $this->assertSame(0, $this->send('group', 'KNORKE-E2E'));
        $this->assertSame([], $this->notified());
        $this->assertSame([], $this->h->warnings);
    }

    public function testInvalidArgumentsReadNothing(): void {
        $this->h->shareRows->add($this->b, 'group', 'staff', 'view');
        $ok = ['board' => $this->b, 'kind' => 'group', 'recipient' => 'staff'];
        $this->h->boards->log = [];
        $this->h->shareRows->log = [];
        foreach ([
            null, [], 'staff', 7,
            ['board' => (string)$this->b] + $ok, ['board' => 0] + $ok, ['board' => -1] + $ok, ['board' => 1.0] + $ok,
            ['kind' => 'user'] + $ok, ['kind' => 'link'] + $ok, ['kind' => null] + $ok,
            ['recipient' => ''] + $ok, ['recipient' => 7] + $ok, ['recipient' => str_repeat('a', 256)] + $ok,
            ['board' => $this->b, 'kind' => 'group'],
        ] as $i => $arg) {
            $this->assertSame(0, $this->job()->send($arg), "argument $i");
        }
        $this->assertSame([], $this->h->boards->log, 'no store read');
        $this->assertSame([], $this->h->shareRows->log, 'no store read');
        $this->assertSame([], $this->h->notifyLog);
        // 255 bytes is still a recipient (no such row → 0, but the stores are read).
        $this->assertSame(0, $this->job()->send(['recipient' => str_repeat('a', 255)] + $ok));
        $this->assertSame(['forBoard ' . $this->b], $this->h->shareRows->log);
        // The valid one.
        $this->assertSame(1, $this->job()->send($ok), 'bob (staff = alice, bob)');
    }

    public function testMoreThan500MembersGetNothingAndOneInfoLine(): void {
        $this->h->groups['huge'] = array_map(static fn (int $i): string => sprintf('u%03d', $i), range(0, 500));
        $this->h->shareRows->add($this->b, 'group', 'huge', 'view');
        $this->assertSame(0, $this->send('group', 'huge'));
        $this->assertSame([], $this->h->notifyLog, 'no notify, not even defer');
        $this->assertSame([['Knorke: share notification skipped, too many members', ['app' => 'knorke', 'board' => $this->b, 'kind' => 'group', 'count' => 501]]], $this->h->infos);
        // A bigger group: still only 501 loaded.
        $this->h->infos = [];
        $this->h->groups['huge'] = array_map(static fn (int $i): string => sprintf('u%03d', $i), range(0, 799));
        $this->assertSame(0, $this->send('group', 'huge'));
        $this->assertSame(501, $this->h->infos[0][1]['count']);
        // 500 members: all of them.
        $this->h->infos = [];
        $this->h->groups['huge'] = array_map(static fn (int $i): string => sprintf('u%03d', $i), range(0, 499));
        $this->assertSame(500, $this->send('group', 'huge'));
        $this->assertCount(500, $this->notified());
        $this->assertSame([], $this->h->infos);
    }

    // ── AK8: failures break nothing ────────────────────────────────────────

    public function testAFailingNotifyDoesNotBreakThePut(): void {
        $this->h->notifyFail['bob'] = new \RuntimeException('push proxy down');
        $out = $this->save([self::e('user', 'bob'), self::e('user', 'carol')]);
        $this->assertSame(['bob', 'carol'], array_column($out['shares'], 'id'), 'answered like GET');
        $this->assertSame(['user:bob=edit', 'user:carol=edit'], $this->h->shareRows->of($this->b));
        $this->assertSame(['carol'], array_map(static fn ($n): string => $n->getUser(), $this->h->sent), 'carol notified anyway');
        $this->assertSame('flush', end($this->h->notifyLog));
        $this->assertContains('Knorke: share notification failed', $this->h->warnings);
    }

    public function testAFailingContainerDoesNotBreakThePut(): void {
        $this->h->notificationsFailWith = new \RuntimeException('cannot build');
        $out = $this->save([self::e('user', 'bob')]);
        $this->assertSame(['bob'], array_column($out['shares'], 'id'));
        $this->assertSame(['user:bob=edit'], $this->h->shareRows->of($this->b));
        $this->assertSame([], $this->h->notifyLog);
        $this->assertSame(['Knorke: share notification failed'], $this->h->warnings);
    }

    public function testTheJobNeverThrows(): void {
        // Circles fails.
        $this->h->teams = ['T' => ['Team T', ['alice', 'bob']]];
        $this->h->shareRows->add($this->b, 'team', 'T', 'edit');
        $this->h->membersFailWith = new \RuntimeException('circles down');
        $this->assertSame(0, $this->send('team', 'T'));
        $this->assertSame(['Knorke: share notification fan-out failed'], $this->h->warnings);
        // notify fails for one member: the others still get theirs.
        $this->clearLogs();
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'view');
        $this->h->notifyFail['bob'] = new \RuntimeException('push proxy down');
        $this->assertSame(1, $this->send('group', 'knorke-e2e'));
        $this->assertSame(['carol'], array_map(static fn ($n): string => $n->getUser(), $this->h->sent));
        $this->assertSame('flush', end($this->h->notifyLog));
        $this->assertSame(['Knorke: share notification failed'], $this->h->warnings);
        // A store that fails.
        $this->clearLogs();
        $this->h->shareRows->failWith = new \RuntimeException('database gone');
        $this->assertSame(0, $this->send('group', 'knorke-e2e'));
        $this->assertSame(['Knorke: share notification fan-out failed'], $this->h->warnings);
    }
}
