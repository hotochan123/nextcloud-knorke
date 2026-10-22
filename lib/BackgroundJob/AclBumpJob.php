<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\BackgroundJob;

use OCA\Knorke\Service\ShareService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;

/**
 * acl_gen + 1 for a list of boards (SPEC-M1 §4.13.9, R2): an event that
 * touches more than 50 boards (a big group deleted, a team destroyed)
 * queues its board ids here instead of bumping inside the admin's request.
 * Argument {"boards": [7, 12, …]} with at most 500 ids — the ids, not
 * {kind, recipient}: after GroupDeletedEvent/CircleDestroyedEvent the share
 * rows are gone already. Added at runtime (IJobList::add); a QueuedJob runs
 * once. Until it runs, the grant TTL (120 s) bounds the delay.
 */
class AclBumpJob extends QueuedJob {
    public const MAX_BOARDS = 500;

    public function __construct(
        ITimeFactory $time,
        private ShareService $shares,
    ) {
        parent::__construct($time);
    }

    protected function run($argument): void {
        $this->bump($argument);
    }

    /** @return int boards bumped (ids that are no int or no board are skipped) */
    public function bump(mixed $argument): int {
        $ids = is_array($argument) && is_array($argument['boards'] ?? null) ? $argument['boards'] : [];
        $ids = array_slice(array_values(array_filter($ids, static fn (mixed $v): bool => is_int($v) && $v > 0)), 0, self::MAX_BOARDS);
        return $ids === [] ? 0 : $this->shares->bumpNow($ids);
    }
}
