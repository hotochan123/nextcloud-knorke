<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Db;

use OCP\IConfig;
use OCP\IDBConnection;

/**
 * Knorke reads from the PRIMARY database (SPEC-M0 §3.7, review finding
 * NC-1).
 *
 * With read replicas (system config `dbreplica`) Nextcloud sends every query
 * outside a transaction to a replica, unless the same request wrote that
 * table in the last 3 s. A replica lags. Knorke combines its reads with
 * state that is newer than any replica: the rev in Redis (bumped after the
 * PRIMARY commit) bounds itemsSince, and a client opens a board, a link or
 * a membership right after creating it. A lagging replica would then answer
 * an empty page for a rev the client stores as its cursor (a change it
 * never receives), or 404 for a board that exists.
 *
 * OCP has no "force primary". What it has: a transaction always runs on the
 * primary, and Doctrine's PrimaryReadReplicaConnection (keepReplica off,
 * as Nextcloud configures it) puts the primary into the replica slot as
 * soon as it connects to the primary — every later read of the request goes
 * there. pin() therefore opens and commits one empty transaction before the
 * first Knorke read of a request: two round trips (BEGIN, COMMIT), once per
 * request, and only when a replica is configured. Without `dbreplica`
 * primary and replica are one connection and pin() costs nothing. The /sync
 * fast path (no SQL) never calls it.
 *
 * Shared per request (the DI container keeps one instance); the stores call
 * pin() in front of every SELECT.
 */
class PrimaryReads {
    private ?bool $replica = null;
    private bool $pinned = false;

    public function __construct(
        private IDBConnection $db,
        private IConfig $config,
    ) {
    }

    /** Before a read: connects the primary for the rest of the request (with replicas only). */
    public function pin(): void {
        if ($this->pinned) {
            return;
        }
        $this->replica ??= $this->config->getSystemValue('dbreplica', []) !== [];
        if (!$this->replica) {
            $this->pinned = true;
            return;
        }
        if (!$this->db->inTransaction()) {
            // BEGIN connects the primary (Doctrine: ensureConnectedToPrimary)
            // and, keepReplica being off, makes it the replica connection too.
            $this->db->beginTransaction();
            $this->db->commit();
        }
        $this->pinned = true;
    }
}
