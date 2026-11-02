<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Notification;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IUserManager;
use OCP\Notification\IManager;
use Psr\Log\LoggerInterface;

/**
 * The notifications of the comments (factory job 189), sent by
 * CommentService after the COMMIT of its write; Notifier renders them.
 * Accounts only, never guests.
 *
 *  - mentioned(): comment_mention, object comment/<comment id>, to every
 *    uid newly mentioned in a comment (the author never).
 *  - replied(): comment_reply, object comment_thread/<thread id>, to the
 *    accounts that wrote in the thread; one notification per account and
 *    thread: the older one is marked processed first. The subject
 *    parameter `comment` names the reply (the text Notifier shows).
 *  - unmentioned(): a mention removed by an edit marks that account's
 *    comment_mention of the comment processed.
 *  - deleted(): every deleted comment's comment_mention (all accounts),
 *    and with the first comment the thread's comment_reply.
 *
 * Stored are only app, user, object, subject (and the reply's id): text,
 * names, board title and link are read fresh when the notification is
 * shown, and Notifier drops it when the comment, the thread, the board or
 * the account's right is gone. Recipients that do not exist, are disabled
 * or cannot open Knorke (also an account of the Guests app whose whitelist
 * leaves Knorke out, job 251: filtered here, not only by Notifier) get
 * nothing. Nothing here throws: a failure is
 * logged as a warning, the answer of the route stays the same.
 */
class CommentNotifications {
    public const MENTION = 'comment_mention';
    public const REPLY = 'comment_reply';
    public const OBJECT_COMMENT = 'comment';
    public const OBJECT_THREAD = 'comment_thread';

    public function __construct(
        private IUserManager $users,
        private IAppManager $apps,
        private IManager $manager,
        private ITimeFactory $time,
        private LoggerInterface $logger,
        private GuestsAppWhitelist $guestsApp,
    ) {
    }

    /**
     * comment_mention for every uid of $uids (canonical uids, already
     * checked against the board) except the author. Never throws.
     *
     * @param list<string> $uids
     */
    public function mentioned(string $commentId, array $uids, ?string $authorUid): void {
        $this->batch($uids, $authorUid, function (string $uid) use ($commentId): void {
            $this->send($uid, self::OBJECT_COMMENT, $commentId, self::MENTION, []);
        });
    }

    /**
     * comment_reply to every uid of $uids except the author: the account's
     * older notification of the thread is marked processed first. Never throws.
     *
     * @param list<string> $uids
     */
    public function replied(string $threadId, string $replyId, array $uids, ?string $authorUid): void {
        $this->batch($uids, $authorUid, function (string $uid) use ($threadId, $replyId): void {
            $old = $this->manager->createNotification();
            $old->setApp(Application::APP_ID)->setUser($uid)->setObject(self::OBJECT_THREAD, $threadId)->setSubject(self::REPLY);
            $this->manager->markProcessed($old);
            $this->send($uid, self::OBJECT_THREAD, $threadId, self::REPLY, ['comment' => $replyId]);
        });
    }

    /**
     * Mentions an edit removed: their comment_mention of the comment is done.
     * Never throws.
     *
     * @param list<string> $uids
     */
    public function unmentioned(string $commentId, array $uids): void {
        foreach ($uids as $uid) {
            $this->guarded(function () use ($commentId, $uid): void {
                $n = $this->manager->createNotification();
                $n->setApp(Application::APP_ID)->setUser($uid)->setObject(self::OBJECT_COMMENT, $commentId)->setSubject(self::MENTION);
                $this->manager->markProcessed($n);
            });
        }
    }

    /**
     * Deleted comments: their comment_mention for every account (no user
     * set), and with $threadId (the first comment went) the thread's
     * comment_reply. Never throws.
     *
     * @param list<string> $commentIds
     */
    public function deleted(array $commentIds, ?string $threadId): void {
        foreach ($commentIds as $id) {
            $this->guarded(function () use ($id): void {
                $n = $this->manager->createNotification();
                $n->setApp(Application::APP_ID)->setObject(self::OBJECT_COMMENT, $id)->setSubject(self::MENTION);
                $this->manager->markProcessed($n);
            });
        }
        if ($threadId !== null) {
            $this->guarded(function () use ($threadId): void {
                $n = $this->manager->createNotification();
                $n->setApp(Application::APP_ID)->setObject(self::OBJECT_THREAD, $threadId)->setSubject(self::REPLY);
                $this->manager->markProcessed($n);
            });
        }
    }

    /**
     * Runs $send for every recipient that exists, is enabled and may open
     * Knorke (the author skipped), the push messages bundled.
     *
     * @param list<string> $uids
     * @param callable(string): void $send
     */
    private function batch(array $uids, ?string $authorUid, callable $send): void {
        $uids = array_values(array_unique(array_filter($uids, static fn ($u): bool => is_string($u) && $u !== '' && $u !== $authorUid)));
        if ($uids === []) {
            return;
        }
        $deferred = false;
        try {
            $deferred = $this->manager->defer();
            foreach ($uids as $uid) {
                $this->guarded(function () use ($uid, $authorUid, $send): void {
                    $user = $this->users->get($uid);
                    if ($user === null || !$user->isEnabled() || $user->getUID() === $authorUid
                        || !$this->apps->isEnabledForUser(Application::APP_ID, $user) || !$this->guestsApp->allows($user)) {
                        return;
                    }
                    $send($user->getUID());
                });
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: comment notification failed', ['exception' => $e, 'app' => 'knorke']);
        } finally {
            if ($deferred) {
                $this->guarded(fn () => $this->manager->flush());
            }
        }
    }

    /** @param array<string, string> $params */
    private function send(string $uid, string $type, string $id, string $subject, array $params): void {
        $n = $this->manager->createNotification();
        $n->setApp(Application::APP_ID)->setUser($uid)->setObject($type, $id)->setSubject($subject, $params)
            ->setDateTime(new \DateTime('@' . $this->time->getTime()));
        $this->manager->notify($n);
    }

    /** Runs $fn; a failure is logged, never thrown. */
    private function guarded(callable $fn): void {
        try {
            $fn();
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: comment notification failed', ['exception' => $e, 'app' => 'knorke']);
        }
    }
}
