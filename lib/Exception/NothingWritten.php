<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Exception;

/**
 * Guard exception of the write path (SPEC-M0 §4.7 rule 9, §4.10.1 step 19):
 * a batch that wrote nothing effective under the lock (only dup/gone/locked/
 * limit/no-op) is rolled back instead of leaving a rev jump behind. atomic()
 * rolls back on any exception and rethrows it; SyncService catches exactly
 * this one and answers with the rev observed under the lock.
 */
final class NothingWritten extends \RuntimeException {
    /**
     * @param list<string> $res result code per op
     * @param int $observedRev board rev under the lock before the bump (head.rev − 1)
     */
    public function __construct(
        public readonly array $res,
        public readonly int $observedRev,
    ) {
        parent::__construct('Nothing written');
    }
}
