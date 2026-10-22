<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use PHPUnit\Framework\TestCase;

/**
 * Role, Principal and AccessResult in their frozen M1 form (SPEC-M1 §4.9,
 * §9.7): ranks, the one moderation rule, access levels, me.source.
 */
final class PrincipalTest extends TestCase {
    private static function p(Role $role, string $origin, bool $facilitator = false): Principal {
        return new Principal('u:x', $role, 'X', '0123456789abcdef', $origin === 'guest', $origin === 'guest' ? null : 'x', $origin, $facilitator);
    }

    public function testRoles(): void {
        $this->assertSame([1, 2, 3, 4], [Role::View->rank(), Role::Vote->rank(), Role::Edit->rank(), Role::Owner->rank()]);
        $this->assertSame([false, true, true, true], [Role::View->canVote(), Role::Vote->canVote(), Role::Edit->canVote(), Role::Owner->canVote()]);
        $this->assertSame([false, false, true, true], [Role::View->canEdit(), Role::Vote->canEdit(), Role::Edit->canEdit(), Role::Owner->canEdit()]);
        $this->assertSame(Role::Edit, Role::max(Role::Vote, Role::Edit));
        $this->assertSame(Role::Edit, Role::max(Role::Edit, Role::View));
        $this->assertSame(Role::Vote, Role::max(null, Role::Vote));
        $this->assertSame(Role::View, Role::max(Role::View, null));
        $this->assertNull(Role::max(null, null));
        $this->assertSame(['edit', 'vote'], Role::LINK_ROLES);
        $this->assertSame(['moderate', 'edit', 'vote', 'view'], Role::SHARE_ROLES);
        $this->assertNull(Role::tryFrom('moderate'), 'moderate is a share role, not a Role case');
    }

    public function testModerationIsOwnerOrFacilitatorOnly(): void {
        // Q2 / §4.9: edit through a share, a group, a link or as a guest never moderates.
        $this->assertTrue(self::p(Role::Owner, 'owner')->canModerate());
        $this->assertTrue(self::p(Role::Edit, 'share', true)->canModerate());
        $this->assertFalse(self::p(Role::Edit, 'share')->canModerate());
        $this->assertFalse(self::p(Role::Edit, 'link')->canModerate());
        $this->assertFalse(self::p(Role::Edit, 'guest')->canModerate());
        $this->assertFalse(self::p(Role::Vote, 'link')->canModerate());
    }

    public function testAccessLevelsAndSource(): void {
        $cases = [
            [self::p(Role::Owner, 'owner'), 'owner', 'own'],
            [self::p(Role::Edit, 'share', true), 'moderate', 'share'],
            [self::p(Role::Edit, 'share'), 'edit', 'share'],
            [self::p(Role::Edit, 'link'), 'edit', 'link'],
            [self::p(Role::Vote, 'guest'), 'vote', 'guest'],
            [self::p(Role::View, 'share'), 'view', 'share'],
        ];
        foreach ($cases as [$p, $access, $source]) {
            $this->assertSame([$access, $source], [$p->access(), $p->source()], $p->role->value . ' ' . $p->origin);
        }
    }

    public function testFrozenConstructors(): void {
        $names = static fn (string $cls): array => array_map(
            static fn (\ReflectionParameter $p): string => $p->getName() . ($p->isOptional() ? '?' : ''),
            (new \ReflectionMethod($cls, '__construct'))->getParameters(),
        );
        $this->assertSame(['id', 'role', 'displayName', 'pid', 'isGuest', 'uid', 'origin', 'facilitator?'], $names(Principal::class));
        $this->assertSame(['principal', 'dbRev', 'minRev', 'metaRev?'], $names(AccessResult::class));
        $a = new AccessResult(self::p(Role::Owner, 'owner'), 5, 1, 4);
        $this->assertSame(['rev' => 5, 'min_rev' => 1, 'meta_rev' => 4], $a->head());
        $this->assertNull((new AccessResult(self::p(Role::Owner, 'owner'), null, 1))->head(), 'fast path: no head');
        $this->assertNull((new AccessResult(self::p(Role::Owner, 'owner'), 5, 1))->head(), 'no meta_rev: no head');
    }

    public function testShareRoles(): void {
        // SPEC-M1 §4.9, §4.10.2 step 4: view < vote < edit < moderate; moderate = edit + facilitator.
        $this->assertSame([1, 2, 3, 4, 0], array_map(Role::shareRank(...), ['view', 'vote', 'edit', 'moderate', 'owner']));
        $this->assertSame([Role::Edit, true], Role::fromShare('moderate'));
        $this->assertSame([Role::Edit, false], Role::fromShare('edit'));
        $this->assertSame([Role::Vote, false], Role::fromShare('vote'));
        $this->assertSame([Role::View, false], Role::fromShare('view'));
        $this->assertSame([null, false], Role::fromShare('owner'), 'owner is no share role');
        $this->assertSame(['moderate', 'edit', 'vote', 'view'], Role::SHARE_ROLES);
        $this->assertSame(['edit', 'vote'], Role::LINK_ROLES);
    }
}
