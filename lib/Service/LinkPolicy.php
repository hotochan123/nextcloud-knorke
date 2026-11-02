<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IManager;
use Psr\Container\ContainerInterface;

/**
 * Nextcloud's link-sharing policy for a board OWNER (SPEC-M0 §4.9.7, review
 * finding NC-5): IManager::shareApiAllowLinks($owner) — the admin switch
 * "Allow users to share via link" plus its group exclusion. An edit link is
 * a public link of its owner, so the owner's policy decides for everybody
 * who comes through it:
 *
 *  - not allowed → enableLink/rotate 403 links_disabled, guest join/snapshot/
 *    sync and the account join 403 links_disabled, link memberships grant
 *    nothing (as if the link were off)
 *  - the link row stays active: allowing links again restores it
 *
 * Disabled owner (factory job 245, audit G1): while Nextcloud hides the
 * shares of disabled accounts (files_sharing hide_disabled_user_shares,
 * default yes, as Share20\Manager::isHiddenDisabledUserShare), the boards
 * of a disabled owner are closed to everybody: allows() is false (links
 * and link memberships) and ownerHidden() keeps shares from granting a
 * role (Access::memberRole, BoardService::rowRole, the notifications).
 * Nothing is revoked: enabling the account opens everything again.
 * UserEnabledListener calls reset() and bumps the owner's boards, so it
 * takes effect at once.
 *
 * The answers are kept per owner for the request. The Redis gens a:<board>
 * carry allows() to the fast path (FastCache), so a policy change reaches
 * guests and members within the gens TTL (120 s).
 *
 * The share manager and the config are resolved lazily: building the
 * manager costs ≈ 1.6 ms, and the fast path of /sync never asks this class.
 */
class LinkPolicy {
    /** @var array<string, bool> owner uid → allowed, this request */
    private array $memo = [];
    /** @var array<string, bool> owner uid → hidden (disabled owner), this request */
    private array $hiddenMemo = [];
    private ?IManager $manager = null;

    public function __construct(
        private ContainerInterface $container,
        private IUserManager $users,
    ) {
    }

    /**
     * May the owner $ownerUid share via link? $known: the owner's IUser when
     * the caller has it (the session user), saves the lookup. An owner that
     * no longer exists (its boards are being deleted) → false: never fall
     * back to the session user, which shareApiAllowLinks(null) would do. A
     * hidden owner (ownerHidden) → false.
     */
    public function allows(string $ownerUid, ?IUser $known = null): bool {
        if (array_key_exists($ownerUid, $this->memo)) {
            return $this->memo[$ownerUid];
        }
        $user = $this->owner($ownerUid, $known);
        return $this->memo[$ownerUid] = $user !== null && !$this->hidden($ownerUid, $user)
            && $this->manager()->shareApiAllowLinks($user);
    }

    /**
     * Are the boards of $ownerUid hidden because the account is disabled
     * (class comment)? An owner that does not exist is not hidden (its
     * boards are being deleted, and allows() is false for it anyway). The
     * app setting is read only for a disabled owner.
     */
    public function ownerHidden(string $ownerUid, ?IUser $known = null): bool {
        if (array_key_exists($ownerUid, $this->hiddenMemo)) {
            return $this->hiddenMemo[$ownerUid];
        }
        $user = $this->owner($ownerUid, $known);
        return $user !== null && $this->hidden($ownerUid, $user);
    }

    /** Forgets the answers of this request, all or those of $uid (the account was enabled or disabled). */
    public function reset(?string $uid = null): void {
        if ($uid === null) {
            $this->memo = [];
            $this->hiddenMemo = [];
            return;
        }
        unset($this->memo[$uid], $this->hiddenMemo[$uid]);
    }

    private function owner(string $ownerUid, ?IUser $known): ?IUser {
        return $known !== null && $known->getUID() === $ownerUid ? $known : $this->users->get($ownerUid);
    }

    /** Exactly yes (or unset) hides, as Nextcloud's own check. */
    private function hidden(string $ownerUid, IUser $user): bool {
        return $this->hiddenMemo[$ownerUid] ??= !$user->isEnabled()
            && $this->container->get(IConfig::class)->getAppValue('files_sharing', 'hide_disabled_user_shares', 'yes') === 'yes';
    }

    private function manager(): IManager {
        return $this->manager ??= $this->container->get(IManager::class);
    }
}
