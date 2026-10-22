<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Listener;

use OCA\Knorke\Service\ShareService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\GroupDeletedEvent;
use OCP\Group\Events\UserRemovedEvent;
use Psr\Log\LoggerInterface;

/**
 * Group events (SPEC-M1 §4.13.9): a user leaves a group → the boards shared
 * with that group get acl_gen + 1 (the next request of the user runs the
 * full check); a group is deleted → its share rows go, their boards get
 * acl_gen + 1 (Nextcloud sends no UserRemovedEvent per member then).
 * Adding to a group needs nothing (there is no negative cache).
 *
 * Never throws (rule (a)): an exception would land in the admin's group
 * action; failures are logged as warnings.
 *
 * @template-implements IEventListener<Event>
 */
class GroupListener implements IEventListener {
    public function __construct(
        private ShareService $shares,
        private LoggerInterface $logger,
    ) {
    }

    public function handle(Event $event): void {
        try {
            if ($event instanceof UserRemovedEvent) {
                $this->shares->onUserRemovedFromGroup($event->getGroup()->getGID());
            } elseif ($event instanceof GroupDeletedEvent) {
                $this->shares->onGroupDeleted($event->getGroup()->getGID());
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: handling a group event failed', ['exception' => $e, 'app' => 'knorke']);
        }
    }
}
