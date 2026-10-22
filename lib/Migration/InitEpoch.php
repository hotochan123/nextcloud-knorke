<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Migration;

use OCA\Knorke\Service\Epoch;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

/**
 * Repair step (SPEC-M1 §3.1, info.xml <install> and <post-migration>): sets
 * the board epoch `knorke/epoch` (8 characters [a-z0-9] from ISecureRandom)
 * when it is empty. Runs on install and on every upgrade and never changes a
 * set epoch; the value is stored NOT lazy (preloaded set, §5.2), and a set
 * epoch found in the lazy set is moved there with the same value.
 *
 * A failure is reported, never thrown: an upgrade must not stop here, and
 * without an epoch Epoch::current() answers '0' (§5.4).
 */
class InitEpoch implements IRepairStep {
    public function __construct(
        private Epoch $epoch,
    ) {
    }

    public function getName(): string {
        return 'Knorke: set the board epoch';
    }

    public function run(IOutput $output): void {
        try {
            $new = $this->epoch->ensure();
        } catch (\Throwable $e) {
            $output->warning('Knorke: the board epoch could not be set (' . $e->getMessage() . '); run occ knorke:epoch:rotate.');
            return;
        }
        $output->info($new === null ? 'Knorke: board epoch already set.' : 'Knorke: board epoch set.');
    }
}
