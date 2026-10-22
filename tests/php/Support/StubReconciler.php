<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Service\OrphanReconciler;

/**
 * An OrphanReconciler without dependencies for the CleanupJob tests (P7,
 * SPEC-M1 §33.1 e): records every call of daily() and reconcile() in $calls
 * ("daily <nowMs>", "reconcile dry|real"); $throw makes daily() throw.
 */
final class StubReconciler extends OrphanReconciler {
    /** @var list<string> */
    public array $calls = [];
    public ?\Throwable $throw = null;

    public function __construct() {
    }

    public function daily(int $nowMs): array {
        $this->calls[] = 'daily ' . $nowMs;
        if ($this->throw !== null) {
            throw $this->throw;
        }
        return ['reconciled' => 0, 'failed' => 0, 'candidates' => 0];
    }

    public function reconcile(bool $dryRun): array {
        $this->calls[] = 'reconcile ' . ($dryRun ? 'dry' : 'real');
        return ['counts' => array_fill_keys(self::KINDS, 0), 'failed' => 0];
    }
}
