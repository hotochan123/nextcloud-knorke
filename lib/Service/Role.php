<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * Role of a principal on one board (SPEC-M0 §4.9.6, SPEC-M1 §4.9), rank
 * ascending: view (1) < vote (2) < edit (3) < owner (4).
 *
 *  - owner: boards.owner — everything, including rename/delete/links
 *  - edit:  share, link member or guest through the edit link — all ops
 *  - vote:  (stage 2/3, voting link or share) — vote ops, presence c/v only
 *  - view:  (stage 2, share) — no ops (`denied`), presence read only
 *
 * The share role `moderate` (SHARE_ROLES) is not a case of its own: it gives
 * the principal role edit plus the moderation right (Principal::$facilitator).
 */
enum Role: string {
    case Owner = 'owner';
    case Edit = 'edit';
    case View = 'view';
    case Vote = 'vote';

    /**
     * Roles a link may carry (and a guest token may claim), SPEC-M1 §9.7. A
     * guest token is checked against the generation of ITS link role (edit:
     * link_gen, vote: vote_link_gen, §4.13.1). Voting links are created from
     * stage 2 on; until then no token of role vote is ever issued.
     */
    public const LINK_ROLES = ['edit', 'vote'];

    /** Roles of an explicit share (stage 2); moderate = edit + facilitator. */
    public const SHARE_ROLES = ['moderate', 'edit', 'vote', 'view'];

    /**
     * Rank of a share role for "is this a raise?" (SPEC-M1 §4.10.2 step 4):
     * view 1 < vote 2 < edit 3 < moderate 4; an unknown string 0.
     */
    public static function shareRank(string $shareRole): int {
        return match ($shareRole) {
            'view' => 1,
            'vote' => 2,
            'edit' => 3,
            'moderate' => 4,
            default => 0,
        };
    }

    /**
     * Principal role and facilitator flag of a share role (SPEC-M1 §4.9):
     * moderate → [Edit, true], edit/vote/view → [that role, false]; an
     * unknown stored value (a later version) → [null, false], it grants
     * nothing.
     *
     * @return array{0: ?Role, 1: bool}
     */
    public static function fromShare(string $shareRole): array {
        return match ($shareRole) {
            'moderate' => [self::Edit, true],
            'edit' => [self::Edit, false],
            'vote' => [self::Vote, false],
            'view' => [self::View, false],
            default => [null, false],
        };
    }

    /** May this role send put/patch/remove ops? */
    public function canEdit(): bool {
        return $this === self::Owner || $this === self::Edit;
    }

    /** May this role send vote ops? edit includes vote, vote includes view. */
    public function canVote(): bool {
        return $this !== self::View;
    }

    /** Rank for comparisons: view 1, vote 2, edit 3, owner 4. */
    public function rank(): int {
        return match ($this) {
            self::View => 1,
            self::Vote => 2,
            self::Edit => 3,
            self::Owner => 4,
        };
    }

    /** The higher of two roles; null only when both are null. */
    public static function max(?Role $a, ?Role $b): ?Role {
        if ($a === null) {
            return $b;
        }
        if ($b === null) {
            return $a;
        }
        return $b->rank() > $a->rank() ? $b : $a;
    }
}
