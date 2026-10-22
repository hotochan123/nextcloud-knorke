<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * Access v2 (SPEC-M1 §4.13.1, §4.11.4): roles from shares and links as a
 * maximum with origin, f/s/l grants and their trust rule, the grant TTL of
 * link members, expired links, and the guest join with password and expiry.
 */
final class AccessSharesTest extends TestCase {
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->boards->addBoard('alice', 'B', 4, 2);
    }

    private function expectHttp(int $status, string $code, callable $fn): HttpError {
        try {
            $fn();
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error], $e->getMessage());
            return $e;
        }
        $this->fail("expected $status $code");
    }

    private function as(string $uid): \OCA\Knorke\Service\Principal {
        $this->h->uid = $uid;
        return $this->h->access->forUser($this->b)->principal;
    }

    public function testShareRolesWithOriginAndGrants(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'moderate');
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'view');
        $p = $this->as('bob');
        $this->assertSame([Role::Edit, 'share', true, true, 'moderate', 'share'], [$p->role, $p->origin, $p->facilitator, $p->canModerate(), $p->access(), $p->source()]);
        $this->assertSame(['acl' => 2, 'role' => 'edit', 'origin' => 'f'], $this->h->cache->getGrant($this->b, 'bob'));
        $this->assertSame(FastCache::GRANT_TTL, $this->h->mem->ttl('g:' . $this->b . ':' . substr(hash('sha256', 'bob'), 0, 24)));
        $p = $this->as('carol');
        $this->assertSame([Role::View, 'share', false, 'view'], [$p->role, $p->origin, $p->canModerate(), $p->access()]);
        $this->assertSame(['acl' => 2, 'role' => 'view', 'origin' => 's'], $this->h->cache->getGrant($this->b, 'carol'));
        $this->h->boards->log = [];
        $this->h->shareRows->log = [];
        $p = $this->as('bob');
        $this->assertSame([[], [], true], [$this->h->boards->log, $this->h->shareRows->log, $p->facilitator], 'fast path: no SQL at all, f → facilitator');
        $this->expectHttp(404, 'not_found', fn () => $this->as('erin'));
    }

    public function testMaximumOverLinkAndShareTieGoesToShare(): void {
        $this->h->link($this->b);
        $linkId = $this->h->boards->activeLinkOf($this->b)['id'];
        $this->h->boards->addMember($this->b, 'bob', 'edit', $linkId, 0);
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $p = $this->as('bob');
        $this->assertSame([Role::Edit, 'link'], [$p->role, $p->origin], 'link edit beats share view');
        $this->assertSame('l', $this->h->cache->getGrant($this->b, 'bob')['origin']);
        // Links switched off for the owner: back to the share (view), the share grant is trusted although links = 0.
        $this->h->linksAllowed['alice'] = false;
        $this->h->mem->data = [];
        $p = $this->as('bob');
        $this->assertSame([Role::View, 'share'], [$p->role, $p->origin]);
        $this->assertSame(['acl' => 2, 'role' => 'view', 'origin' => 's'], $this->h->cache->getGrant($this->b, 'bob'));
        $this->assertFalse($this->h->cache->getGens($this->b)['links']);
        $this->h->boards->log = [];
        $this->as('bob');
        $this->assertSame([], $this->h->boards->log, 'C61/C67: the share grant stays on the fast path with links = 0');
        // A tie (edit via link, edit via share): origin share.
        $this->h->linksAllowed['alice'] = true;
        $this->h->mem->data = [];
        $this->h->shareRows->add($this->b, 'group', 'staff', 'edit');
        $p = $this->as('bob');
        $this->assertSame([Role::Edit, 'share', 's'], [$p->role, $p->origin, $this->h->cache->getGrant($this->b, 'bob')['origin']]);
    }

    public function testLinkMemberGrantEndsWithItsLink(): void {
        $now = $this->h->nowMs();
        $this->h->link($this->b, null, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', null, $now + 3000);
        $this->h->boards->addMember($this->b, 'bob', 'edit', $this->h->boards->activeLinkOf($this->b)['id'], 0);
        $this->as('bob');
        $key = 'g:' . $this->b . ':' . substr(hash('sha256', 'bob'), 0, 24);
        $this->assertSame(3, $this->h->mem->ttl($key), 'TTL = remaining life of the link');
        $this->assertSame(1, Access::linkTtl($now + 1, $now), 'at least 1 s');
        $this->assertSame(120, Access::linkTtl($now + 86_400_000, $now), 'at most 120 s');
        $this->assertSame(2, Access::linkTtl($now + 1001, $now), 'rounded up');
        // Expired: the membership grants nothing any more (full check).
        $this->h->time += 4;
        $this->h->mem->data = [];
        $this->expectHttp(404, 'not_found', fn () => $this->as('bob'));
    }

    public function testFullCheckReadsTeamsOnlyWithTeamRows(): void {
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'edit');
        $this->as('bob');
        $this->assertSame([], $this->h->teamCalls);
        $this->h->teams = ['tN' => ['Nord', ['erin']]];
        $this->h->shareRows->add($this->b, 'team', 'tN', 'vote');
        $p = $this->as('erin');
        $this->assertSame([Role::Vote, 'share'], [$p->role, $p->origin]);
        $this->assertSame(['erin'], $this->h->teamCalls);
    }

    // ── Guest join (SPEC-M1 §4.11.4) ───────────────────────────────────────

    public function testGuestJoinThroughTheVotingLink(): void {
        $tok = $this->h->link($this->b, null, 'Vt3dEf6hIj9kLm2nOp5qRs8t', 'vote');
        $this->h->boards->boards[$this->b]['vote_link_gen'] = 4;
        [$a, $guest] = $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9');
        $this->assertSame([Role::Vote, 'guest', false], [$a->principal->role, $a->principal->origin, $a->principal->canModerate()]);
        $c = $this->h->tokens->verify($guest);
        $this->assertSame(['vote', 4], [$c['r'], $c['lg']], 'lg = vote_link_gen');
    }

    public function testExpiredLinkAndTokenLifetime(): void {
        $now = $this->h->nowMs();
        $tok = $this->h->link($this->b, null, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', null, $now + 3_600_500);
        [, , $exp] = $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9');
        $this->assertSame($this->h->time + 3600, $exp, 'exp = min(now + GUEST_TTL, floor(expires_at / 1000))');
        $this->h->time += 3601;
        $this->expectHttp(403, 'link_expired', fn () => $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9'));
        $this->assertSame([], $this->h->throttleCalls, 'no miss, no failure');
    }

    public function testGuestPassword(): void {
        $tok = $this->h->link($this->b, null, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'h:pw-one');
        $linkId = $this->h->boards->activeLinkOf($this->b)['id'];
        $this->expectHttp(403, 'password_required', fn () => $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9'));
        $this->expectHttp(403, 'password_required', fn () => $this->h->access->joinGuest($tok, '', null, '10.0.0.9'), 'the password before the name');
        $this->expectHttp(403, 'password_wrong', fn () => $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9', 'nope'));
        [$a, $guest] = $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9', 'pw-one');
        $this->assertSame('Gina', $a->principal->displayName);
        // A valid old token of this link role and generation skips the password.
        [$a2] = $this->h->access->joinGuest($tok, 'Gina', $guest, '10.0.0.9');
        $this->assertSame($a->principal->id, $a2->principal->id);
        // After a tightening (link_gen + 1) the old token no longer skips it (R13).
        $this->h->boards->lockBoard($this->b, true, 'edit', 0);
        $this->expectHttp(403, 'password_required', fn () => $this->h->access->joinGuest($tok, 'Gina', $guest, '10.0.0.9'));
        [$a3] = $this->h->access->joinGuest($tok, 'Gina', $guest, '10.0.0.9', 'pw-one');
        $this->assertSame($a->principal->id, $a3->principal->id, 'the identity survives');
        // An expired token does not skip it either.
        $this->h->time += 40 * 86400;
        $this->expectHttp(403, 'password_required', fn () => $this->h->access->joinGuest($tok, 'Gina', $guest, '10.0.0.9'));
        // 20 failures from one network → 429 slow_down {reason: password}, without checking.
        for ($i = 0; $i < 20; $i++) {
            $this->expectHttp(403, 'password_wrong', fn () => $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9', 'nope'));
        }
        $e = $this->expectHttp(429, 'slow_down', fn () => $this->h->access->joinGuest($tok, 'Gina', null, '10.0.0.9', 'pw-one'));
        $this->assertSame(['retryMs', 'reason'], array_keys(array_diff_key($e->payload(), ['error' => 0, 'message' => 0])));
        $this->assertSame('password', $e->payload()['reason']);
        $this->assertNotNull($this->h->secrets->failuresBlocked($linkId, '10.0.0.9'));
        // Another network still gets in.
        $this->assertSame('Gina', $this->h->access->joinGuest($tok, 'Gina', null, '10.0.1.1', 'pw-one')[0]->principal->displayName);
    }

    public function testCheckPasswordOrder(): void {
        $link = ['id' => 77, 'password_hash' => 'h:pw'];
        $this->expectHttp(403, 'password_required', fn () => $this->h->access->checkPassword($link, null, '10.0.0.1'));
        $this->expectHttp(403, 'password_required', fn () => $this->h->access->checkPassword($link, '', '10.0.0.1'));
        $this->assertNull($this->h->secrets->failuresBlocked(77, '10.0.0.1'));
        $this->assertSame(0, $this->h->mem->get($this->h->secrets->failureKey(77, '10.0.0.1', intdiv($this->h->nowMs(), 600000))) ?? 0, 'a missing password is no failure');
        $this->assertSame('h:pw', $this->h->access->checkPassword($link, 'pw', '10.0.0.1'), 'R14-01: the hash stored after the check');
    }
}

