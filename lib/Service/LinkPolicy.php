<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

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
 * The answer is kept per owner for the request. The Redis gens a:<board>
 * carry it to the fast path (FastCache), so a policy change reaches
 * guests and members within the gens TTL (120 s).
 *
 * The share manager is resolved lazily: building it costs ≈ 1.6 ms, and the
 * fast path of /sync never asks this class.
 */
class LinkPolicy {
    /** @var array<string, bool> owner uid → allowed, this request */
    private array $memo = [];
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
     * back to the session user, which shareApiAllowLinks(null) would do.
     */
    public function allows(string $ownerUid, ?IUser $known = null): bool {
        if (array_key_exists($ownerUid, $this->memo)) {
            return $this->memo[$ownerUid];
        }
        $user = $known !== null && $known->getUID() === $ownerUid ? $known : $this->users->get($ownerUid);
        return $this->memo[$ownerUid] = $user !== null && $this->manager()->shareApiAllowLinks($user);
    }

    private function manager(): IManager {
        return $this->manager ??= $this->container->get(IManager::class);
    }
}
