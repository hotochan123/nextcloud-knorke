<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * Rights checks, grants and guests (SPEC-M0 §4.9, §5.2; SPEC-M1 §4.13.1:
 * 3-part grants with origin, 5-element gens, role generations of guests).
 * Stage 4 (SPEC-M1 §4.1, §4.11.4 step 6, R19 T4-01): the snapshot throttle
 * of routes 12 and 15 and of the guest join, in the order guest budget →
 * knorke-snap-<gid> → knorke-snapip-<board>.
 */
final class AccessTest extends TestCase {
    private AccessHarness $h;

    protected function setUp(): void {
        $this->h = new AccessHarness();
    }

    private function expectHttp(int $status, string $code, callable $fn): void {
        try {
            $fn();
            $this->fail("expected $status $code");
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error]);
        }
    }

    public function testUnknownBoardAndStrangerAre404(): void {
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser(99));
        $b = $this->h->boards->addBoard('bob');
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b), );
        $this->h->uid = null;
        $this->expectHttp(401, 'not_logged_in', fn () => $this->h->access->forUser($b));
    }

    public function testOwnerAndMember(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 7, 2, 3, 1);
        $a = $this->h->access->forUser($b);
        $this->assertSame(Role::Owner, $a->principal->role);
        $this->assertSame([7, 1, 0], [$a->dbRev, $a->minRev, $a->metaRev]);
        $this->assertSame(['rev' => 7, 'min_rev' => 1, 'meta_rev' => 0], $a->head(), 'the full check carries the board head');
        $this->assertSame(['owner', false, true, 'own'], [$a->principal->origin, $a->principal->facilitator, $a->principal->canModerate(), $a->principal->source()]);
        $this->assertSame('u:alice', $a->principal->id);
        $this->assertSame('Alice Display', $a->principal->displayName);
        $this->assertFalse($a->principal->isGuest);
        $this->assertSame(['acl' => 2, 'link' => 3, 'minRev' => 1, 'links' => true, 'voteLink' => 1, 'gone' => false], $this->h->cache->getGens($b));
        $this->assertSame(['acl' => 2, 'role' => 'owner', 'origin' => 'o'], $this->h->cache->getGrant($b, 'alice'));
        $this->h->link($b);
        $this->h->boards->addMember($b, 'bob', 'edit', $this->h->boards->activeLinkOf($b)['id'], 0);
        $this->h->uid = 'bob';
        $m = $this->h->access->forUser($b)->principal;
        $this->assertSame([Role::Edit, 'link', false, 'edit', 'link'], [$m->role, $m->origin, $m->canModerate(), $m->access(), $m->source()], 'a link member never moderates');
        $this->assertSame(['acl' => 2, 'role' => 'edit', 'origin' => 'l'], $this->h->cache->getGrant($b, 'bob'));
        $m = $this->h->access->forUser($b)->principal;
        $this->assertSame([Role::Edit, 'link', false], [$m->role, $m->origin, $m->facilitator], 'the same from the grant');
    }

    public function testGrantFastPath(): void {
        $b = $this->h->boards->addBoard('alice');
        $this->h->access->forUser($b);
        $this->h->boards->log = [];
        $a = $this->h->access->forUser($b);
        $this->assertSame([], $this->h->boards->log, 'no SQL with a valid grant');
        $this->assertNull($a->dbRev);
        $this->assertNull($a->head(), 'no head on the fast path');
        $this->assertSame([Role::Owner, 'owner'], [$a->principal->role, $a->principal->origin]);
        $this->h->access->forUser($b, true);
        $this->assertSame(['findBoardForUser'], $this->h->boards->log, 'full = always the DB (snapshot)');
    }

    public function testRevocationInvalidatesTheGrant(): void {
        $b = $this->h->boards->addBoard('alice');
        $this->h->link($b);
        $this->h->boards->addMember($b, 'bob', 'edit', $this->h->boards->activeLinkOf($b)['id'], 0);
        $this->h->uid = 'bob';
        $this->h->access->forUser($b);
        // Link rotated: member removed, acl_gen + 1, setGens.
        unset($this->h->boards->members[$b]['bob']);
        $row = $this->h->boards->lockBoard($b, true, 'edit', 0);
        $this->h->cache->setGens($b, $row['acl_gen'], $row['link_gen'], 0, true, $row['vote_link_gen']);
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
    }

    public function testGoneBoardOnTheFastPath(): void {
        $b = $this->h->boards->addBoard('alice');
        $this->h->access->forUser($b);
        $this->h->cache->markGone($b);
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
    }

    public function testGuestFastAndFullPath(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 5, 1, 2);
        $tok = $this->h->token($b, 2);
        $a = $this->h->access->forGuest($tok, $b);
        $this->assertSame([5, 'g:gAAAAAAAAAAA', Role::Edit, true, 'Gina', null], [$a->dbRev, $a->principal->id, $a->principal->role, $a->principal->isGuest, $a->principal->displayName, $a->principal->uid]);
        $this->assertSame(['guest', 'guest', false], [$a->principal->origin, $a->principal->source(), $a->principal->canModerate()], 'guests never moderate');
        $this->h->boards->log = [];
        $a = $this->h->access->forGuest($tok, $b);
        $this->assertNull($a->dbRev, 'fast path via a:');
        $this->assertSame([], $this->h->boards->log);
    }

    public function testTokenOfBoardABoundToA(): void {
        $a = $this->h->boards->addBoard('alice');
        $b = $this->h->boards->addBoard('bob');
        $tok = $this->h->token($a, 1);
        // Full path (nothing cached for B).
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest($tok, $b));
        // Fast path (gens of B cached, lg 1 == link_gen 1).
        $this->h->cache->seedGens($b, 1, 1, 0, true, 1);
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest($tok, $b));
        // Snapshot path.
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuestWithRow($tok, $b));
    }

    public function testGuestTokenChecks(): void {
        $b = $this->h->boards->addBoard('alice');
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest('', $b));
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest('x.y', $b));
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest($this->h->token($b, 1, 'owner'), $b));
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest($this->h->token($b, 1, 'view'), $b), );
        $this->expectHttp(401, 'guest_token', fn () => $this->h->access->forGuest($this->h->token($b, 1, 'edit', 'gAAAAAAAAAAA', $this->h->time - 1), $b));
    }

    public function testLinkRevokedAndGone(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 0, 1, 2);
        $old = $this->h->token($b, 1);
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuest($old, $b), );
        $this->h->cache->setGens($b, 1, 2, 0, true, 1);
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuest($old, $b));
        $tok = $this->h->token($b, 2);
        $this->h->cache->markGone($b);
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forGuest($tok, $b));
        unset($this->h->boards->boards[$b]);
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forGuestWithRow($tok, $b));
    }

    public function testJoinGuestNewIdentityAndRejoin(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 3, 1, 1);
        $link = $this->h->link($b);
        [$a, $tok, $exp, $row] = $this->h->access->joinGuest($link, '  Gina  ', null, '10.0.0.9');
        $linkId = $this->h->boards->activeLinkOf($b)['id'];
        $snapIp = 'knorke-snapip-' . $b . ' 300 60 10.0.0.9';
        $this->assertSame(['knorke-guest-' . $b . '-' . $linkId . ' 300 600 10.0.0.9', $snapIp], $this->h->limiterCalls,
            'guest budget per board AND link (T11), then (stage 4) the (board, IP) snapshot throttle');
        $this->assertSame('Gina', $a->principal->displayName);
        $this->assertSame($this->h->time + 30 * 24 * 3600, $exp);
        $this->assertSame($b, $row['id']);
        $this->assertSame(3, $a->dbRev);
        $claims = $this->h->tokens->verify($tok);
        $this->assertSame([1, $b, 'edit', 1, 'Gina'], [$claims['v'], $claims['b'], $claims['r'], $claims['lg'], $claims['n']]);
        $gid = $claims['g'];
        $this->assertSame('g:' . $gid, $a->principal->id);

        // Re-join with the old token (even expired): same identity, no guest
        // budget; (stage 4) the snapshot throttle of the gid, then (board, IP).
        $this->h->time += 40 * 24 * 3600;
        [$a2] = $this->h->access->joinGuest($link, 'Gina 2', $tok, '10.0.0.9');
        $this->assertSame('g:' . $gid, $a2->principal->id);
        $this->assertSame($a->principal->pid, $a2->principal->pid, 'pid stable across re-join');
        $this->assertSame(['knorke-snap-' . $gid . ' 30 60 10.0.0.9', $snapIp], array_slice($this->h->limiterCalls, 2));

        // Rotated link (lg differs): the identity survives with the new link.
        $this->h->boards->revokeLinks($b, 1);
        $this->h->boards->lockBoard($b, true, 'edit', 1);
        $new = $this->h->link($b, null, 'Zz3dEf6hIj9kLm2nOp5qRs8t');
        [$a3, $tok3] = $this->h->access->joinGuest($new, 'Gina', $tok, '10.0.0.9');
        $this->assertSame('g:' . $gid, $a3->principal->id);
        $this->assertSame(2, $this->h->tokens->verify($tok3)['lg']);

        // A token of another board never transfers the identity.
        $other = $this->h->boards->addBoard('bob');
        [$a4] = $this->h->access->joinGuest($new, 'Gina', $this->h->token($other, 1, 'edit', $gid), '10.0.0.9');
        $this->assertNotSame('g:' . $gid, $a4->principal->id);
        $guestBudgets = array_values(array_filter($this->h->limiterCalls, static fn (string $c): bool => str_starts_with($c, 'knorke-guest-')));
        $this->assertCount(2, $guestBudgets, 'the guest budget only for the two new identities');
        $this->assertCount(4, array_keys($this->h->limiterCalls, $snapIp, true), 'every join counts in knorke-snapip-<board>');
    }

    public function testJoinGuestErrors(): void {
        $b = $this->h->boards->addBoard('alice');
        $link = $this->h->link($b);
        $this->expectHttp(400, 'name_required', fn () => $this->h->access->joinGuest($link, " \u{200B} ", null, 'ip'));
        $revoked = $this->h->link($b, 5, 'Rv3dEf6hIj9kLm2nOp5qRs8t');
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->joinGuest($revoked, 'Gina', null, 'ip'));
        $this->assertSame([], $this->h->throttleCalls, 'hits never ask the throttle');
        for ($i = 1; $i <= 10; $i++) {
            $this->expectHttp(404, 'not_found', fn () => $this->h->access->joinGuest('Nn3dEf6hIj9kLm2nOp5qRs8t', 'Gina', null, 'ip'));
        }
        $this->expectHttp(429, 'rate_limited', fn () => $this->h->access->joinGuest('Nn3dEf6hIj9kLm2nOp5qRs8t', 'Gina', null, 'ip'));
        // A blocked address still reaches existing links.
        $this->assertSame('Gina', $this->h->access->joinGuest($link, 'Gina', null, 'ip')[0]->principal->displayName);
        $this->h->limiterMax = 0;
        $this->expectHttp(429, 'rate_limited', fn () => $this->h->access->joinGuest($link, 'New', null, 'ip'));
    }

    public function testGuestBudgetIsPerLink(): void {
        // T11: one link holder filling the budget of a shared IP must not
        // outlast a rotation; the new link starts with a fresh budget.
        $b = $this->h->boards->addBoard('alice');
        $old = $this->h->link($b);
        $oldKey = 'knorke-guest-' . $b . '-' . $this->h->boards->activeLinkOf($b)['id'];
        $this->h->limiterFull = [$oldKey];
        $this->expectHttp(429, 'rate_limited', fn () => $this->h->access->joinGuest($old, 'New', null, '10.0.0.9'));
        $this->h->boards->revokeLinks($b, 1);
        $this->h->boards->lockBoard($b, true, 'edit', 1);
        $new = $this->h->link($b, null, 'Zz3dEf6hIj9kLm2nOp5qRs8t');
        $newKey = 'knorke-guest-' . $b . '-' . $this->h->boards->activeLinkOf($b)['id'];
        $this->assertNotSame($oldKey, $newKey);
        $this->assertSame('New', $this->h->access->joinGuest($new, 'New', null, '10.0.0.9')[0]->principal->displayName, 'the old key is full, the new one is not');
        $this->assertSame([$newKey . ' 300 600 10.0.0.9', 'knorke-snapip-' . $b . ' 300 60 10.0.0.9'], array_slice($this->h->limiterCalls, -2));
        $this->h->limiterFull[] = $newKey;
        $this->expectHttp(429, 'rate_limited', fn () => $this->h->access->joinGuest($new, 'Other', null, '10.0.0.9'));
    }

    public function testGrantTrustRuleByOrigin(): void {
        // SPEC-M1 §4.13.1: a grant counts while acl matches and (o ∈ {o, f, s}
        // or links = 1); f makes the principal a facilitator. Share grants are
        // seeded from stage 2 on; here they are planted like a full check would.
        $b = $this->h->boards->addBoard('alice', 'B', 3, 2);
        $this->h->cache->seedGens($b, 2, 1, 0, false, 1);
        $this->h->uid = 'bob';
        foreach ([['s', 'edit', 'share', false, 'edit'], ['f', 'edit', 'share', true, 'moderate'], ['s', 'view', 'share', false, 'view']] as [$o, $role, $origin, $fac, $access]) {
            $this->h->cache->setGrant($b, 'bob', 2, $role, $o);
            $this->h->boards->log = [];
            $p = $this->h->access->forUser($b)->principal;
            $this->assertSame([], $this->h->boards->log, "grant $o trusted although links = 0");
            $this->assertSame([$role, $origin, $fac, $fac, $access], [$p->role->value, $p->origin, $p->facilitator, $p->canModerate(), $p->access()]);
        }
        // A link grant is not trusted while links = 0: the full check decides (bob has no row → 404).
        $this->h->cache->setGrant($b, 'bob', 2, 'edit', 'l');
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
        // Owner role and origin o go together, else the full check decides.
        $this->h->cache->setGrant($b, 'bob', 2, 'owner', 's');
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
        $this->h->uid = 'alice';
        $this->h->cache->setGrant($b, 'alice', 2, 'edit', 'o');
        $this->h->boards->log = [];
        $this->assertSame(Role::Owner, $this->h->access->forUser($b)->principal->role);
        $this->assertSame(['findBoardForUser'], $this->h->boards->log, 'o with a non-owner role is no grant');
        // A grant of another acl generation is ignored.
        $this->h->cache->setGrant($b, 'alice', 1, 'owner', 'o');
        $this->h->boards->log = [];
        $this->h->access->forUser($b);
        $this->assertSame(['findBoardForUser'], $this->h->boards->log);
    }

    public function testM0FormsInRedisAreMisses(): void {
        // After the upgrade (same prefix only if the epoch was set by hand):
        // a 4-element a: and a 2-part g: are misses → the full check reseeds.
        $b = $this->h->boards->addBoard('alice', 'B', 3, 2);
        $this->h->mem->set('a:' . $b, [2, 1, 0, 1], 120);
        $this->h->mem->set('g:' . $b . ':' . substr(hash('sha256', 'alice'), 0, 24), '2|owner', 120);
        $this->h->boards->log = [];
        $this->assertSame(3, $this->h->access->forUser($b)->dbRev, 'full check');
        $this->assertSame(['findBoardForUser'], $this->h->boards->log);
        $this->assertSame(['acl' => 2, 'role' => 'owner', 'origin' => 'o'], $this->h->cache->getGrant($b, 'alice'));
    }

    public function testGuestRoleGenerations(): void {
        // SPEC-M1 §4.13.1: lg of an edit token against a[1] (link_gen), of a
        // vote token against a[4] (vote_link_gen) — rotating one link role
        // never touches the other.
        $b = $this->h->boards->addBoard('alice', 'B', 5, 1, 3, 0, 7);
        $edit = $this->h->token($b, 3, 'edit');
        $vote = $this->h->token($b, 7, 'vote', 'gBBBBBBBBBBB');
        // Full path (nothing cached), then fast path (gens seeded by it).
        foreach (['full', 'fast'] as $path) {
            $this->assertSame(Role::Edit, $this->h->access->forGuest($edit, $b)->principal->role, $path);
            $a = $this->h->access->forGuest($vote, $b);
            $this->assertSame([Role::Vote, 'guest', false], [$a->principal->role, $a->principal->origin, $a->principal->role->canEdit()], $path);
        }
        $this->assertSame(7, $this->h->cache->getGens($b)['voteLink']);
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuest($this->h->token($b, 3, 'vote'), $b));
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuest($this->h->token($b, 7, 'edit'), $b));
        // The voting link rotates (vote_link_gen + 1, setGens): vote tokens die, edit tokens live.
        $row = $this->h->boards->lockBoard($b, true, 'vote', 1);
        $this->assertSame([3, 8], [$row['link_gen'], $row['vote_link_gen']]);
        $this->h->cache->setGens($b, $row['acl_gen'], $row['link_gen'], 0, true, $row['vote_link_gen']);
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuest($vote, $b));
        $this->assertSame(Role::Edit, $this->h->access->forGuest($edit, $b)->principal->role);
        $this->h->mem->data = [];
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuestWithRow($vote, $b));
        $this->assertSame(Role::Edit, $this->h->access->forGuestWithRow($edit, $b)[0]->principal->role);
    }

    public function testJoinThrottleOrder(): void {
        // SPEC-M1 §4.11.4 step 6 (R19, T4-01): guest budget (new identity,
        // rate_limited) → knorke-snap-<gid> (returning gid) → knorke-snapip-
        // <board> (every join); a refusing throttle keeps the later ones from
        // counting. ILimiter budgets: retryMs = ceil(period · 1000 / limit).
        $b = $this->h->boards->addBoard('alice');
        $link = $this->h->link($b);
        $guestKey = 'knorke-guest-' . $b . '-' . $this->h->boards->activeLinkOf($b)['id'];
        $snapIp = 'knorke-snapip-' . $b;

        // New identity, guest budget used up → rate_limited, no snapshot budget touched.
        $this->h->limiterFull = [$guestKey];
        $this->expectHttp(429, 'rate_limited', fn () => $this->h->access->joinGuest($link, 'New', null, '10.0.0.9'));
        $this->assertSame([$guestKey . ' 300 600 10.0.0.9'], $this->h->limiterCalls);

        // New identity, (board, IP) used up → slow_down {retryMs: 200}.
        $this->h->limiterCalls = [];
        $this->h->limiterFull = [$snapIp];
        try {
            $this->h->access->joinGuest($link, 'New', null, '10.0.0.9');
            $this->fail('expected 429 slow_down');
        } catch (HttpError $e) {
            $this->assertSame([429, 'slow_down', ['retryMs' => 200], 1], [$e->status, $e->error, $e->extra, $e->retryAfterSeconds()]);
        }
        $this->assertSame([$guestKey . ' 300 600 10.0.0.9', $snapIp . ' 300 60 10.0.0.9'], $this->h->limiterCalls);

        // Returning gid (also with an EXPIRED token), its budget used up →
        // slow_down {retryMs: 2000}; neither the guest budget nor (board, IP) counts.
        $this->h->limiterFull = [];
        $this->h->limiterCalls = [];
        $tok = $this->h->token($b, 1, 'edit', 'gReturning01', $this->h->time - 10);
        $this->h->limiterFull = ['knorke-snap-gReturning01'];
        try {
            $this->h->access->joinGuest($link, 'Back', $tok, '10.0.0.9');
            $this->fail('expected 429 slow_down');
        } catch (HttpError $e) {
            $this->assertSame([429, 'slow_down', ['retryMs' => 2000], 2], [$e->status, $e->error, $e->extra, $e->retryAfterSeconds()]);
        }
        $this->assertSame(['knorke-snap-gReturning01 30 60 10.0.0.9'], $this->h->limiterCalls);

        // Returning gid within its budget: snap-<gid>, then (board, IP); same identity.
        $this->h->limiterFull = [];
        $this->h->limiterCalls = [];
        [$a] = $this->h->access->joinGuest($link, 'Back', $tok, '10.0.0.9');
        $this->assertSame('g:gReturning01', $a->principal->id);
        $this->assertSame(['knorke-snap-gReturning01 30 60 10.0.0.9', $snapIp . ' 300 60 10.0.0.9'], $this->h->limiterCalls);
    }

    public function testSnapshotThrottles(): void {
        // Route 12: knorke-snap 30 per 60 s per account → slow_down {retryMs: 2000}.
        for ($i = 1; $i <= 30; $i++) {
            $this->h->access->throttleSnapshot();
        }
        try {
            $this->h->access->throttleSnapshot();
            $this->fail('the 31st snapshot is throttled');
        } catch (HttpError $e) {
            $this->assertSame([429, 'slow_down', ['retryMs' => 2000], 2], [$e->status, $e->error, $e->extra, $e->retryAfterSeconds()]);
        }
        $this->assertSame(array_fill(0, 31, 'knorke-snap 30 60 alice'), $this->h->limiterCalls);
        $this->h->uid = null;
        $this->expectHttp(401, 'not_logged_in', fn () => $this->h->access->throttleSnapshot());

        // Route 15: knorke-snap-<gid> (30/60 s, IP), then knorke-snapip-<board> (300/60 s, IP).
        $this->h->limiterCalls = [];
        $g = new \OCA\Knorke\Service\Principal('g:gAbcdEfgh123', Role::Edit, 'Gina', '0123456789abcdef', true, null, 'guest');
        $this->h->access->throttleGuestSnapshot($g, 7, '10.0.0.9');
        $this->assertSame(['knorke-snap-gAbcdEfgh123 30 60 10.0.0.9', 'knorke-snapip-7 300 60 10.0.0.9'], $this->h->limiterCalls);
        $this->h->limiterCalls = [];
        $this->h->limiterFull = ['knorke-snap-gAbcdEfgh123'];
        $this->expectHttp(429, 'slow_down', fn () => $this->h->access->throttleGuestSnapshot($g, 7, '10.0.0.9'));
        $this->assertSame(['knorke-snap-gAbcdEfgh123 30 60 10.0.0.9'], $this->h->limiterCalls, 'a refused gid budget keeps (board, IP) from counting');
        $this->h->limiterFull = ['knorke-snapip-7'];
        $this->expectHttp(429, 'slow_down', fn () => $this->h->access->throttleGuestSnapshot($g, 7, '10.0.0.9'));
    }

    public function testPid(): void {
        $p1 = $this->h->access->pid(1, 'u:alice');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}\z/', $p1);
        $this->assertSame($p1, $this->h->access->pid(1, 'u:alice'));
        $this->assertNotSame($p1, $this->h->access->pid(2, 'u:alice'), 'per board');
        $this->assertNotSame($p1, $this->h->access->pid(1, 'u:bob'));
        $this->assertStringNotContainsString('alice', $p1);
    }

    /**
     * M2 data foundation: the formula moved into the static
     * Access::derivePid (lock.by maps many principal ids with one read of
     * the secret); every pid stays what it was (pinned with the old formula
     * and the harness secret 'unit-secret').
     */
    public function testPidIsDerivePidWithTheSystemSecretAndUnchanged(): void {
        foreach ([[1, 'u:alice', '25c01df6a17136a8'], [2, 'u:alice', 'c253a38e8cfd1866'], [7, 'g:gAbcdEfgh123', '5fd22d2824a240ad']] as [$b, $id, $want]) {
            $this->assertSame($want, $this->h->access->pid($b, $id), "$b $id: the pid stays the same");
            $this->assertSame($this->h->access->pid($b, $id), Access::derivePid('unit-secret', $b, $id));
        }
        $this->assertNotSame(Access::derivePid('unit-secret', 1, 'u:alice'), Access::derivePid('other-secret', 1, 'u:alice'), 'the key is the secret');
    }
}
