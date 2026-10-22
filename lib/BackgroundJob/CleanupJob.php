<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\BackgroundJob;

use OCA\Knorke\Service\Compactor;
use OCA\Knorke\Service\OrphanReconciler;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

/**
 * Daily clean-up (SPEC-M0 §3.5, §4.10.4; SPEC-M1 §3.3, §4.13.7): change
 * rows older than 30 days and links revoked OR expired more than 30 days
 * ago (with their member rows), instance-wide; then per board, continuing
 * after the app config cleanup_cursor within a time budget of 60 s, the
 * tombstone purge in blocks (min_rev rises), the changes cap and the
 * board's 30-day cut (Compactor::run). `occ knorke:compact` without
 * --board runs the same. Registered through <background-jobs> in
 * appinfo/info.xml.
 *
 * After the clean-up (P7, SPEC-M1 §33.1 e): the orphan reconciliation with
 * the two-run rule (OrphanReconciler::daily, the job's clock) — an account
 * or group that is missing at least 20 h after it was first found missing
 * is treated like the deletion listeners do. occ knorke:compact never runs
 * this part (ED-14). A failure there is logged, never thrown.
 */
class CleanupJob extends TimedJob {
    public function __construct(
        ITimeFactory $time,
        private Compactor $compactor,
        private OrphanReconciler $orphans,
        private LoggerInterface $logger,
    ) {
        parent::__construct($time);
        $this->setInterval(24 * 60 * 60);
        // Not time-critical: may run batched/delayed.
        $this->setTimeSensitivity(self::TIME_INSENSITIVE);
    }

    protected function run($argument): void {
        $this->prune($this->time->getTime() * 1000);
    }

    /**
     * @return array{changes: int, links: int, boards: list<array>, complete: bool} see Compactor::run
     */
    public function prune(int $nowMs): array {
        $result = $this->compactor->run($nowMs);
        try {
            $this->orphans->daily($nowMs);
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: the daily orphan reconciliation failed', ['exception' => $e, 'app' => 'knorke']);
        }
        return $result;
    }
}
