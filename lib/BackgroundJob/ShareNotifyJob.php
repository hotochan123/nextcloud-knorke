<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\BackgroundJob;

use OCA\Knorke\Notification\ShareNotifications;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;

/**
 * "Board shared with you" for the members of a new group or team share
 * (SPEC-M1 §11 Q8: throttled): ShareService::save() queues one job per new
 * group/team row, argument {"board": 7, "kind": "group"|"team",
 * "recipient": "<gid or singleId>"}; IJobList adds an equal job only once.
 * The job checks that the row is still there and reads the members only
 * now. Added at runtime (IJobList::add); a QueuedJob runs once.
 */
class ShareNotifyJob extends QueuedJob {
    public function __construct(
        ITimeFactory $time,
        private ShareNotifications $notifications,
    ) {
        parent::__construct($time);
    }

    protected function run($argument): void {
        $this->send($argument);
    }

    /** @return int accounts notified (an invalid argument or a share gone: 0) */
    public function send(mixed $argument): int {
        return $this->notifications->fanOut($argument);
    }
}
