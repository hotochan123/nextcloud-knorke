<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Whoever acts on a board in one request (SPEC-M1 §9.7, §4.9).
 *
 * $id is the principal id stored as actor/created_by: `u:<uid>` for accounts,
 * `g:<gid>` for guests — never shortened. $pid is the opaque per-board
 * participant id (SPEC-M0 §4.9.4); it is the only identity guests ever see of
 * others.
 *
 * $origin is where the effective role came from: owner | share (explicit
 * share to the user, a group or a team; stage 2) | link (account through a
 * link) | guest. $facilitator is true when any share row that applies to the
 * user has the share role `moderate` (stage 2).
 */
final class Principal {
    public const ORIGINS = ['owner', 'share', 'link', 'guest'];

    public function __construct(
        public readonly string $id,
        public readonly Role $role,
        public readonly string $displayName,
        public readonly string $pid,
        public readonly bool $isGuest,
        public readonly ?string $uid,
        public readonly string $origin,
        public readonly bool $facilitator = false,
    ) {
    }

    /**
     * The one place of the moderation rule (SPEC-M1 §4.9, Q2): the owner, or
     * a share with the role `moderate`. Edit through a group, a team, a link
     * or as a guest never moderates.
     */
    public function canModerate(): bool {
        return $this->role === Role::Owner || $this->facilitator;
    }

    /**
     * The access level (SPEC-M1 §4.9): owner | moderate (edit and
     * canModerate()) | edit | vote | view — `role` of the sync request and
     * the board list.
     */
    public function access(): string {
        if ($this->role === Role::Edit && $this->canModerate()) {
            return 'moderate';
        }
        return $this->role->value;
    }

    /**
     * `me.source` of the snapshot (SPEC-M1 §4.4): own | share | link | guest,
     * the origin of the effective role as in the board list.
     */
    public function source(): string {
        return $this->origin === 'owner' ? 'own' : $this->origin;
    }
}
