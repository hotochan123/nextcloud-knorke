<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Outcome of a rights check (SPEC-M0 §5.2, SPEC-M1 §9.7): the principal, the
 * board rev if the check read the board row from the database (null on the
 * Redis fast path), the board's min_rev (from the row or from the cached
 * gens) and its meta_rev (from the row; null on the fast path).
 *
 * dbRev, minRev and metaRev of a full check come from ONE row read: together
 * they are the board head the slow sync path may reuse (SPEC-M1 §4.13.8
 * step 7) instead of reading it again.
 */
final class AccessResult {
    public function __construct(
        public readonly Principal $principal,
        public readonly ?int $dbRev,
        public readonly int $minRev,
        public readonly ?int $metaRev = null,
    ) {
    }

    /**
     * The board head read by the full check, or null (fast path, or a
     * check that did not read meta_rev).
     *
     * @return array{rev: int, min_rev: int, meta_rev: int}|null
     */
    public function head(): ?array {
        if ($this->dbRev === null || $this->metaRev === null) {
            return null;
        }
        return ['rev' => $this->dbRev, 'min_rev' => $this->minRev, 'meta_rev' => $this->metaRev];
    }
}
