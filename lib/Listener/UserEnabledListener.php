<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Listener;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\ShareService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserChangedEvent;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * An account was disabled or enabled (factory job 245, audit G1): while
 * Nextcloud hides the shares of disabled accounts, the boards it owns close
 * or open again (LinkPolicy::ownerHidden). The policy forgets its answers
 * for the account, then each of its boards gets acl_gen + 1 and its gens
 * the new links flag (ShareService::bumpBoards; more than 50 boards through
 * AclBumpJob), so grants and guest tokens on the fast path follow at once,
 * also on boards open right now. Nothing is revoked: the link generations
 * stay, so the old guest tokens work again once the account is enabled.
 *
 * UserChangedEvent comes for every changed account field (display name,
 * e-mail, quota, an LDAP sync sends thousands): anything but `enabled`
 * returns before a service is built. Never throws (an exception would land
 * in the admin's action); failures are logged as warnings.
 *
 * @template-implements IEventListener<Event>
 */
class UserEnabledListener implements IEventListener {
    public function __construct(
        private ContainerInterface $container,
        private LoggerInterface $logger,
    ) {
    }

    public function handle(Event $event): void {
        if (!($event instanceof UserChangedEvent) || $event->getFeature() !== 'enabled') {
            return;
        }
        try {
            $user = $event->getUser();
            $uid = $user->getUID();
            $policy = $this->container->get(LinkPolicy::class);
            $policy->reset($uid);
            // Answer once with the event's account, so the bumps below write
            // the new links flag even if the user manager held an older copy.
            $policy->allows($uid, $user);
            $policy->ownerHidden($uid, $user);
            $boards = $this->container->get(BoardStore::class)->boardsOwnedBy($uid);
            if ($boards !== []) {
                $this->container->get(ShareService::class)->bumpBoards($boards);
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: closing or opening the boards of a disabled or enabled account failed', ['exception' => $e, 'app' => 'knorke']);
        }
    }
}
