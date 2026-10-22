<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Service\PresenceStore;

/**
 * The real PresenceStore over the in-memory cache, with every read() logged
 * and an optional canned answer: $readMap set → read() returns it (the map
 * "in Redis" at the moment the write path re-reads it under the lock),
 * independent of what sync() wrote or read before.
 */
class FakePresenceStore extends PresenceStore {
    /** @var list<int> nowMs of every read() */
    public array $reads = [];
    public ?array $readMap = null;

    public function read(int $b, int $nowMs): array {
        $this->reads[] = $nowMs;
        return $this->readMap ?? parent::read($b, $nowMs);
    }
}
