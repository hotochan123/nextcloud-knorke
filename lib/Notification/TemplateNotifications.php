<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Notification;

use OCA\Knorke\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IManager;
use Psr\Log\LoggerInterface;

/**
 * The notifications of template suggestions (factory job 182), sent by
 * TemplateStore after its write; Notifier renders them. Object
 * template/<id> each.
 *
 *  - suggested(): template_suggested to every enabled member of the group
 *    "admin" with access to the app (searchUsers, at most FANOUT_MAX + 1
 *    loaded); more than ShareNotifications::FANOUT_MAX members → nobody, one
 *    info line. Stored are only app, user, object and subject: the name and
 *    who suggested it are read fresh when it is shown.
 *  - decided(): template_adopted or template_rejected to whoever suggested
 *    it, with the name as subject parameter (the row may be gone by then).
 *  - processed(): marks the template_suggested of a template processed for
 *    every admin at once (no user set): adopted, rejected, withdrawn or its
 *    account deleted.
 *
 * Nothing here throws: a failure is logged as a warning and the answer of
 * the route stays the same. (Job 203) The constants are read through
 * static:: so ShapeLibNotifications sends the same with its own object type
 * and subjects.
 */
class TemplateNotifications {
    public const OBJECT_TYPE = 'template';
    public const SUGGESTED = 'template_suggested';
    public const ADOPTED = 'template_adopted';
    public const REJECTED = 'template_rejected';
    /** The group whose members decide (IGroupManager::isAdmin). */
    public const ADMIN_GROUP = 'admin';

    public function __construct(
        private IUserManager $users,
        private IGroupManager $groups,
        private IAppManager $apps,
        private IManager $manager,
        private ITimeFactory $time,
        private LoggerInterface $logger,
    ) {
    }

    /** A new suggestion: every admin with access to the app is told. Never throws. */
    public function suggested(int $id): void {
        $deferred = false;
        try {
            $group = $this->groups->get(self::ADMIN_GROUP);
            if ($group === null) {
                return;
            }
            $admins = $group->searchUsers('', ShareNotifications::FANOUT_MAX + 1);
            if (count($admins) > ShareNotifications::FANOUT_MAX) {
                $this->logger->info('Knorke: ' . static::OBJECT_TYPE . ' notification skipped, too many admins', ['app' => 'knorke', static::OBJECT_TYPE => $id, 'count' => count($admins)]);
                return;
            }
            $deferred = $this->manager->defer();
            foreach ($admins as $user) {
                $this->guarded($id, function () use ($id, $user): void {
                    if ($user instanceof IUser && $user->isEnabled() && $this->apps->isEnabledForUser(Application::APP_ID, $user)) {
                        $this->send($user->getUID(), $id, static::SUGGESTED, []);
                    }
                });
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: ' . static::OBJECT_TYPE . ' notification failed', ['exception' => $e, 'app' => 'knorke', static::OBJECT_TYPE => $id]);
        } finally {
            if ($deferred) {
                $this->guarded($id, fn () => $this->manager->flush());
            }
        }
    }

    /** Adopted or rejected: whoever suggested it is told, with the name. Never throws. */
    public function decided(int $id, string $uid, bool $adopted, string $name): void {
        $this->guarded($id, function () use ($id, $uid, $adopted, $name): void {
            $user = $this->users->get($uid);
            if ($user !== null && $user->isEnabled()) {
                $this->send($user->getUID(), $id, $adopted ? static::ADOPTED : static::REJECTED, ['name' => $name]);
            }
        });
    }

    /** The admins' template_suggested of $id is done (no user: all of them at once). Never throws. */
    public function processed(int $id): void {
        $this->guarded($id, function () use ($id): void {
            $n = $this->manager->createNotification();
            $n->setApp(Application::APP_ID)->setObject(static::OBJECT_TYPE, (string)$id)->setSubject(static::SUGGESTED);
            $this->manager->markProcessed($n);
        });
    }

    /** @param array<string, string> $params */
    private function send(string $uid, int $id, string $subject, array $params): void {
        $n = $this->manager->createNotification();
        $n->setApp(Application::APP_ID)->setUser($uid)->setObject(static::OBJECT_TYPE, (string)$id)->setSubject($subject, $params)
            ->setDateTime(new \DateTime('@' . $this->time->getTime()));
        $this->manager->notify($n);
    }

    /** Runs $fn; a failure is logged, never thrown. */
    private function guarded(int $id, callable $fn): void {
        try {
            $fn();
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: ' . static::OBJECT_TYPE . ' notification failed', ['exception' => $e, 'app' => 'knorke', static::OBJECT_TYPE => $id]);
        }
    }
}
