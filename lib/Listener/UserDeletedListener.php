<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Listener;

use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Service\VoteService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserDeletedEvent;
use Psr\Log\LoggerInterface;

/**
 * A deleted account takes its boards with it, leaves the boards it joined
 * and loses its user shares, each affected board with acl_gen + 1
 * (BoardService::onUserDeleted, SPEC-M0 §4.10.4, SPEC-M1 §4.13.9). Its votes
 * in open sessions go too (VoteService::onUserDeleted, R2/R16): otherwise an
 * account created later with the same uid — the same pid — would inherit
 * them and their spent budget. Its name and id leave its locks (M2, R20,
 * SyncService::clearLocker): the items stay locked ("locked, locker
 * unknown", only moderators unlock), so a later account with the same uid
 * does not own them. Nothing may escape from here: an exception would abort
 * Nextcloud's own clean-up of the account; each part runs on its own.
 *
 * @template-implements IEventListener<UserDeletedEvent>
 */
class UserDeletedListener implements IEventListener {
    public function __construct(
        private BoardService $boards,
        private VoteService $votes,
        private Access $access,
        private LoggerInterface $logger,
        private SyncService $sync,
    ) {
    }

    public function handle(Event $event): void {
        if (!($event instanceof UserDeletedEvent)) {
            return;
        }
        $uid = $event->getUser()->getUID();
        try {
            $this->boards->onUserDeleted($uid);
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: cleaning up a deleted account failed', ['exception' => $e, 'app' => 'knorke']);
        }
        try {
            $this->votes->onUserDeleted($uid, fn (int $board): string => $this->access->pid($board, 'u:' . $uid));
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: removing the votes of a deleted account failed', ['exception' => $e, 'app' => 'knorke']);
        }
        try {
            $this->sync->clearLocker('u:' . $uid, (int)floor(microtime(true) * 1000));
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: removing a deleted account from its locks failed', ['exception' => $e, 'app' => 'knorke']);
        }
    }
}
