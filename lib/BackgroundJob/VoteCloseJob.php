<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\BackgroundJob;

use OCA\Knorke\Service\VoteService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/**
 * Closes expired voting sessions (SPEC-M1 §4.12.1, path (d) of the
 * automatic close): every 300 s, every open session with ends_at ≤ now goes
 * through the one VoteService::close (board lock, re-read, idempotent), so
 * the results appear in meta.vote even when nobody votes or moderates any
 * more. The other three ways (a vote op, a moderator poll with vt, the
 * moderator's client calling `end`) close the same way.
 *
 * Shipped as a no-op TimedJob from stage 0 on (SPEC-M1 §3, R2): Nextcloud
 * registers <background-jobs> only on install or upgrade
 * (AppManager::upgradeApp, Installer), and the first cron run deletes every
 * registered job whose class is missing (JobList::buildJob). Stage 3 fills
 * only this body; no version bump. The job list builds it through the
 * server container (constructor autowiring).
 */
class VoteCloseJob extends TimedJob {
    public const INTERVAL = 300;

    public function __construct(
        ITimeFactory $time,
        private VoteService $votes,
    ) {
        parent::__construct($time);
        $this->setInterval(self::INTERVAL);
    }

    protected function run($argument): void {
        $this->votes->closeExpired((int)floor((float)$this->time->now()->format('U.u') * 1000));
    }
}
