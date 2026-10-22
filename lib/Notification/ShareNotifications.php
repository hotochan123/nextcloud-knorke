<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Notification;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\BackgroundJob\ShareNotifyJob;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Service\SharePolicy;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IManager;
use OCP\Teams\ITeamManager;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * "Board shared with you" (M2, SPEC-M1 §1.2, §11 Q8): sends the Nextcloud
 * notification to the recipients of NEW share rows.
 *
 *  - sharesAdded(): ShareService::save() calls it after COMMIT with the
 *    inserted rows; accounts are notified at once (≤ 20 per PUT, one
 *    defer/flush), groups and teams go to ShareNotifyJob (Q8: throttled,
 *    the next cron run; IJobList merges equal jobs)
 *  - fanOut(): the job's side — the members of the group (searchUsers,
 *    at most FANOUT_MAX + 1 loaded) or the team (getMembersOfTeam from the
 *    owner's point of view); more than FANOUT_MAX members → nobody, one
 *    info line; the owner and members with an own user row are skipped
 *  - notifyUser(): one notification per (recipient, board): the earlier
 *    one is marked processed first. Stored are only app, user, object and
 *    subject — no title, no names, no link; Notifier fills them in when
 *    the notification is shown and drops it when the right is gone.
 *
 * Nothing here throws: a failing recipient is logged and skipped.
 */
class ShareNotifications {
    public const SUBJECT = 'board_shared';
    public const OBJECT_TYPE = 'board';
    /** Members of one group or team at most; a bigger one gets no notification. */
    public const FANOUT_MAX = 500;

    private ?ITeamManager $teams = null;

    public function __construct(
        private BoardStore $boards,
        private ShareStore $shares,
        private SharePolicy $policy,
        private IUserManager $users,
        private IGroupManager $groups,
        private IAppManager $apps,
        private IManager $manager,
        private IJobList $jobs,
        private ITimeFactory $time,
        private ContainerInterface $container,
        private LoggerInterface $logger,
    ) {
    }

    /**
     * New share rows of $board (in the order of the insert): user rows are
     * notified now, group and team rows queued for ShareNotifyJob. Never throws.
     *
     * @param list<array{kind: string, recipient: string}> $inserted
     */
    public function sharesAdded(int $board, string $ownerUid, array $inserted): void {
        $users = $queued = [];
        foreach ($inserted as $row) {
            $kind = is_array($row) ? ($row['kind'] ?? null) : null;
            $recipient = is_array($row) ? ($row['recipient'] ?? null) : null;
            if (!is_string($recipient)) {
                continue;
            }
            if ($kind === 'user') {
                $users[] = $recipient;
            } elseif ($kind === 'group' || $kind === 'team') {
                $queued[] = [$kind, $recipient];
            }
        }
        // 1. Accounts now, the push messages bundled.
        if ($users !== []) {
            $deferred = false;
            try {
                $deferred = $this->manager->defer();
                foreach ($users as $uid) {
                    $this->guarded($board, fn (): bool => $this->notifyUser($board, $ownerUid, $uid));
                }
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: share notification failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
            } finally {
                if ($deferred) {
                    $this->guarded($board, fn () => $this->manager->flush());
                }
            }
        }
        // 2. Groups and teams on the next cron run (Q8); an equal job is not added twice.
        foreach ($queued as [$kind, $recipient]) {
            $this->guarded($board, fn () => $this->jobs->add(ShareNotifyJob::class, ['board' => $board, 'kind' => $kind, 'recipient' => $recipient]));
        }
    }

    /**
     * Notifies one account about $board, replacing an earlier notification
     * of the same board. false = not sent (the owner, unknown, disabled, no
     * access to the app).
     */
    public function notifyUser(int $board, string $ownerUid, string $uid): bool {
        if ($uid === $ownerUid) {
            return false;
        }
        $user = $this->users->get($uid);
        if ($user === null || !$user->isEnabled()) {
            return false;
        }
        // The canonical uid: the notifications app lists by IUser::getUID().
        $uid = $user->getUID();
        if ($uid === $ownerUid || !$this->apps->isEnabledForUser(Application::APP_ID, $user)) {
            return false;
        }
        // Without a date the notifications app matches app, user, object and subject only.
        $old = $this->manager->createNotification();
        $old->setApp(Application::APP_ID)->setUser($uid)->setObject(self::OBJECT_TYPE, (string)$board)->setSubject(self::SUBJECT);
        $this->manager->markProcessed($old);
        $n = $this->manager->createNotification();
        $n->setApp(Application::APP_ID)->setUser($uid)->setObject(self::OBJECT_TYPE, (string)$board)->setSubject(self::SUBJECT)
            ->setDateTime(new \DateTime('@' . $this->time->getTime()));
        $this->manager->notify($n);
        return true;
    }

    /**
     * ShareNotifyJob: notifies the members of a group or team share that is
     * still there. Returns the number notified; never throws.
     */
    public function fanOut(mixed $argument): int {
        $arg = self::argument($argument);
        if ($arg === null) {
            return 0;
        }
        [$board, $kind, $recipient] = $arg;
        $sent = 0;
        try {
            // Cron is a long-running process; the notifier may run in it, too.
            $this->policy->reset();
            $head = $this->boards->findBoard($board);
            if ($head === null) {
                return 0;
            }
            $found = false;
            $direct = [];
            foreach ($this->shares->forBoard($board) as $r) {
                if ($r['kind'] === $kind && $r['recipient'] === $recipient) {
                    $found = true;
                }
                if ($r['kind'] === 'user') {
                    $direct[(string)$r['recipient']] = true;
                }
            }
            if (!$found) {
                // Removed before cron ran.
                return 0;
            }
            $ownerUid = (string)$head['owner'];
            $owner = $this->users->get($ownerUid);
            if ($owner === null) {
                return 0;
            }
            $members = $kind === 'group' ? $this->groupMembers($recipient) : $this->teamMembers($owner, $recipient);
            $members = array_values(array_unique($members));
            sort($members, SORT_STRING);
            if (count($members) > self::FANOUT_MAX) {
                $this->logger->info('Knorke: share notification skipped, too many members', ['app' => 'knorke', 'board' => $board, 'kind' => $kind, 'count' => count($members)]);
                return 0;
            }
            // Members with an own user row were notified through it.
            $members = array_values(array_filter($members, static fn (string $uid): bool => $uid !== $ownerUid && !isset($direct[$uid])));
            if ($members === []) {
                return 0;
            }
            $deferred = $this->manager->defer();
            try {
                foreach ($members as $uid) {
                    if ($this->guarded($board, fn (): bool => $this->notifyUser($board, $ownerUid, $uid)) === true) {
                        $sent++;
                    }
                }
            } finally {
                if ($deferred) {
                    $this->manager->flush();
                }
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: share notification fan-out failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
        }
        return $sent;
    }

    /**
     * The job argument {board, kind, recipient}: board an int ≥ 1, kind group
     * or team, recipient 1–255 bytes. null = not one.
     *
     * @return array{0: int, 1: string, 2: string}|null
     */
    private static function argument(mixed $a): ?array {
        if (!is_array($a)) {
            return null;
        }
        $board = $a['board'] ?? null;
        $kind = $a['kind'] ?? null;
        $recipient = $a['recipient'] ?? null;
        if (!is_int($board) || $board < 1 || !in_array($kind, ['group', 'team'], true)
            || !is_string($recipient) || $recipient === '' || strlen($recipient) > 255) {
            return null;
        }
        return [$board, $kind, $recipient];
    }

    /** @return list<string> uids of the group (at most FANOUT_MAX + 1); [] when it is gone */
    private function groupMembers(string $gid): array {
        $group = $this->groups->get($gid);
        if ($group === null) {
            return [];
        }
        return array_values(array_map(static fn (IUser $u): string => $u->getUID(), $group->searchUsers('', self::FANOUT_MAX + 1)));
    }

    /** @return list<string> uids of the team as the owner sees it; [] without team support */
    private function teamMembers(IUser $owner, string $singleId): array {
        if (!$this->policy->teamSupport($owner)) {
            return [];
        }
        $this->teams ??= $this->container->get(ITeamManager::class);
        return array_map('strval', array_keys($this->teams->getMembersOfTeam($singleId, $owner->getUID())));
    }

    /** Runs $fn for one recipient; a failure is logged, null returned. */
    private function guarded(int $board, callable $fn): mixed {
        try {
            return $fn();
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: share notification failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
            return null;
        }
    }
}
