<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * The two links of a board (SPEC-M1 §4.11): one generation per role,
 * password and expiry as the owner's calendar day, renewing carries
 * password and a future expiry, an expired link renews on every POST,
 * sharing_disabled for creating/renewing/loosening only, the two kinds of
 * tightening, the enforcement rules on the result, SRV-12, account joins
 * with password and the rank rule of step 5.
 */
final class LinkLifecycleTest extends TestCase {
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'A')['id'];
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

    private function on(string $role = 'edit', array $body = []): array {
        return $this->h->service->enableLink('alice', $this->b, $role, $body);
    }

    private function row(string $role = 'edit'): ?array {
        return $this->h->boards->activeLinkOf($this->b, $role);
    }

    private function gens(): array {
        $b = $this->h->boards->boards[$this->b];
        return [$b['acl_gen'], $b['link_gen'], $b['vote_link_gen']];
    }

    public function testTwoLinksWithOneGenerationEach(): void {
        $edit = $this->on('edit');
        $vote = $this->on('vote');
        $this->assertSame(['edit', 'vote'], [$edit['role'], $vote['role']]);
        $this->assertNotSame($edit['token'], $vote['token']);
        $this->assertSame(['edit' => $edit, 'vote' => $vote], $this->h->service->links($this->b, 'alice'));
        $this->assertSame([1, 1, 1], $this->gens(), 'creating bumps nothing');
        $this->h->service->joinLinkAsUser('bob', $edit['token']);
        $this->h->service->joinLinkAsUser('carol', $vote['token']);
        $this->assertSame(['bob' => 'edit', 'carol' => 'vote'], array_map(static fn (array $m): string => $m['role'], $this->h->boards->members[$this->b]));
        // Renewing the voting link: vote_link_gen + 1, only its members go (finding D5).
        $vote2 = $this->on('vote', ['rotate' => true]);
        $this->assertNotSame($vote['token'], $vote2['token']);
        $this->assertSame([2, 1, 2], $this->gens());
        $this->assertSame(['bob'], array_keys($this->h->boards->members[$this->b]));
        $this->assertSame($edit['token'], $this->row('edit')['token'], 'the edit link is untouched');
        $this->assertSame(['acl' => 2, 'link' => 1, 'minRev' => 0, 'links' => true, 'voteLink' => 2, 'gone' => false], $this->h->cache->getGens($this->b));
        // Switching the edit link off: link_gen only.
        $this->h->service->disableLink('alice', $this->b, 'edit');
        $this->assertSame([3, 2, 2], $this->gens());
        $this->assertNull($this->row('edit'));
        $this->assertSame($vote2['token'], $this->row('vote')['token']);
        $this->h->service->disableLink('alice', $this->b, 'vote');
        $this->assertSame([], $this->h->boards->members[$this->b] ?? []);
        $this->assertSame(['edit' => null, 'vote' => null], $this->h->service->links($this->b, 'alice'));
    }

    public function testPasswordAndExpiryOnTheLinkObject(): void {
        $this->h->zones['alice'] = 'Europe/Berlin';
        $l = $this->on('edit', ['password' => 'secret-1', 'expiresAt' => '2025-10-20']);
        $this->assertSame(['token', 'role', 'url', 'password', 'expiresAt', 'expiresOn'], array_keys($l));
        $this->assertTrue($l['password']);
        $this->assertSame('2025-10-20', $l['expiresOn']);
        $this->assertSame((new \DateTimeImmutable('2025-10-21 00:00:00', new \DateTimeZone('Europe/Berlin')))->getTimestamp() * 1000 - 1, $l['expiresAt']);
        $this->assertSame('h:secret-1', $this->row()['password_hash'], 'only the hash is stored');
        $this->assertSame(['secret-1'], $this->h->policyEvents, 'password policy before the hash');
        // A moderator reads expiresOn in the OWNER's zone, never its own.
        $this->h->zones['bob'] = 'Pacific/Kiritimati';
        $this->assertSame('2025-10-20', $this->h->service->links($this->b, 'alice')['edit']['expiresOn']);
        foreach ([['expiresAt' => 1760900000000], ['expiresAt' => '20.10.2025'], ['password' => ''], ['password' => 5], ['password' => str_repeat('x', 201)], ['rotate' => 'maybe']] as $bad) {
            $this->expectHttp(400, 'bad_request', fn () => $this->on('edit', $bad));
        }
        $this->h->passwordHint = 'Too short.';
        $e = $this->expectHttp(400, 'password_policy', fn () => $this->on('edit', ['password' => 'x']));
        $this->assertSame('Too short.', $e->getMessage());
        $this->assertSame('h:secret-1', $this->row()['password_hash'], 'nothing changed');
    }

    public function testRenewCarriesPasswordAndAFutureExpiry(): void {
        $l1 = $this->on('edit', ['password' => 'pw-one', 'expiresAt' => '2025-10-20']);
        $l2 = $this->on('edit', ['rotate' => true]);
        $this->assertNotSame($l1['token'], $l2['token']);
        $this->assertSame([true, $l1['expiresAt'], '2025-10-20'], [$l2['password'], $l2['expiresAt'], $l2['expiresOn']], 'R2: a renewed link never loses its password');
        $this->assertSame('h:pw-one', $this->row()['password_hash']);
        // Body values win over the carried ones.
        $l3 = $this->on('edit', ['rotate' => true, 'password' => null, 'expiresAt' => null]);
        $this->assertSame([false, null], [$l3['password'], $l3['expiresAt']]);
    }

    public function testAnExpiredLinkRenewsOnEveryPost(): void {
        $l1 = $this->on('edit', ['expiresAt' => '2025-10-10']);
        $this->h->service->joinLinkAsUser('bob', $l1['token']);
        $this->h->time += 2 * 86400; // 2025-10-11: expired
        $this->expectHttp(403, 'link_expired', fn () => $this->h->service->joinLinkAsUser('carol', $l1['token']));
        $this->assertSame([], $this->h->throttleCalls, 'an expired link is no miss');
        $this->assertSame($l1['token'], $this->h->service->links($this->b, 'alice')['edit']['token'], 'the owner still sees it, with its date');
        $this->assertSame([], $this->h->service->listFor('bob'), 'its members lost access');
        $l2 = $this->on('edit');
        $this->assertNotSame($l1['token'], $l2['token'], 'POST without rotate on an expired link = renew');
        $this->assertNull($l2['expiresAt'], 'creation defaults, not the expired date');
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$this->b] ?? [], 'old members deleted');
        $this->assertSame([2, 2, 1], $this->gens());
        // With a default expiry the renewed link gets today + days, never an expired one.
        $this->h->share['expireDefault'] = true;
        $this->h->share['expireDays'] = 3;
        $this->h->time += 3 * 86400;
        $this->h->boards->links[$this->row()['id']]['expires_at'] = $this->h->nowMs() - 1;
        $l3 = $this->on('edit');
        $this->assertSame('2025-10-17', $l3['expiresOn']);
    }

    public function testSharingDisabledBlocksCreatingRenewingLooseningOnly(): void {
        $l1 = $this->on('edit', ['password' => 'pw-one', 'expiresAt' => '2025-10-20']);
        $this->h->share['shareApiEnabled'] = false;
        $this->h->sharePolicy->reset();
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('vote'));
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('edit', ['rotate' => true]));
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('edit', ['password' => null]));
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('edit', ['expiresAt' => null]));
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('edit', ['expiresAt' => '2025-10-25']));
        $this->assertSame($l1, $this->on('edit'), 'SRV-12: unchanged, no sharing check');
        $tight = $this->on('edit', ['password' => 'pw-two', 'expiresAt' => '2025-10-15']);
        $this->assertSame([$l1['token'], '2025-10-15'], [$tight['token'], $tight['expiresOn']], 'tightening stays allowed');
        $this->h->service->disableLink('alice', $this->b, 'edit');
        $this->assertNull($this->row(), 'DELETE stays allowed');
    }

    public function testTwoKindsOfTightening(): void {
        $l = $this->on('edit');
        $this->h->service->joinLinkAsUser('bob', $l['token']);
        $before = $this->gens();
        // Password set: members of the link deleted, acl + link_gen + 1, same token.
        $this->assertSame($l['token'], $this->on('edit', ['password' => 'pw-one'])['token']);
        $this->assertSame([$before[0] + 1, $before[1] + 1, $before[2]], $this->gens());
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$this->b] ?? []);
        // Every string counts as a change (R13), even the same password.
        $this->h->service->joinLinkAsUser('bob', $l['token'], 'pw-one');
        $this->on('edit', ['password' => 'pw-one']);
        $this->assertSame([$before[0] + 2, $before[1] + 2, $before[2]], $this->gens());
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$this->b] ?? []);
        // Expiry earlier (null → a day counts as earlier): gens + 1, members stay.
        $this->h->service->joinLinkAsUser('bob', $l['token'], 'pw-one');
        $this->on('edit', ['expiresAt' => '2025-10-20']);
        $this->assertSame([$before[0] + 3, $before[1] + 3, $before[2]], $this->gens());
        $this->assertArrayHasKey('bob', $this->h->boards->members[$this->b]);
        $this->on('edit', ['expiresAt' => '2025-10-15']);
        $this->assertSame([$before[0] + 4, $before[1] + 4, $before[2]], $this->gens());
        // Loosening changes no generation.
        $this->on('edit', ['expiresAt' => '2025-10-25']);
        $this->on('edit', ['expiresAt' => null]);
        $this->on('edit', ['password' => null]);
        $this->assertSame([$before[0] + 4, $before[1] + 4, $before[2]], $this->gens());
        $this->assertSame([false, null], [$this->on('edit')['password'], $this->on('edit')['expiresAt']]);
        $this->assertArrayHasKey('bob', $this->h->boards->members[$this->b]);
        $this->assertSame(['acl' => $before[0] + 4, 'link' => $before[1] + 4, 'minRev' => 0, 'links' => true, 'voteLink' => 1, 'gone' => false],
            $this->h->cache->getGens($this->b), 'setGens after every bump');
    }

    public function testEnforcementOnTheResultAndSrv12(): void {
        $old = $this->on('edit');
        $this->h->share['linkPassword'] = true;
        $this->h->share['expireDefault'] = true;
        $this->h->share['expireEnforced'] = true;
        $this->h->share['expireDays'] = 7;
        // Not retroactive: the old link stays usable and a no-op POST returns it (SRV-12),
        // without the board lock (as M0).
        $this->h->tx = [];
        $this->h->boards->log = [];
        $this->assertSame($old, $this->on('edit'));
        $this->assertSame([], $this->h->tx, 'no transaction');
        $this->assertNotContains('lockBoard --', $this->h->boards->log);
        $this->expectHttp(400, 'password_enforced', fn () => $this->on('vote'));
        $this->expectHttp(400, 'password_enforced', fn () => $this->on('vote', ['expiresAt' => '2025-10-12']));
        $v = $this->on('vote', ['password' => 'pw-v']);
        $this->assertSame('2025-10-16', $v['expiresOn'], 'creating without a date: today + 7 (shareApiLinkDefaultExpireDays)');
        $this->expectHttp(400, 'expiry_required', fn () => $this->on('vote', ['expiresAt' => null]));
        $e = $this->expectHttp(400, 'expiry_too_far', fn () => $this->on('vote', ['expiresAt' => '2025-10-17']));
        $this->assertSame(7, $e->payload()['maxDays']);
        $this->expectHttp(400, 'expiry_past', fn () => $this->on('vote', ['expiresAt' => '2025-10-08']));
        $this->expectHttp(400, 'password_enforced', fn () => $this->on('vote', ['password' => null]));
        // Changing the old link applies the rules to the result.
        $this->expectHttp(400, 'password_enforced', fn () => $this->on('edit', ['expiresAt' => '2025-10-12']));
        $this->expectHttp(400, 'expiry_required', fn () => $this->on('edit', ['password' => 'pw-e']));
        $fixed = $this->on('edit', ['password' => 'pw-e', 'expiresAt' => '2025-10-12']);
        $this->assertSame([$old['token'], true, '2025-10-12'], [$fixed['token'], $fixed['password'], $fixed['expiresOn']]);
        // Renewing with a carried expiry beyond the maximum: too far (rules on the result).
        $this->h->share['expireDays'] = 2;
        $this->expectHttp(400, 'expiry_too_far', fn () => $this->on('edit', ['rotate' => true]));
        $this->assertSame($old['token'], $this->row()['token'], 'nothing renewed');
    }

    public function testLinksDisabledComesAfterSharingDisabled(): void {
        $this->h->linksAllowed['alice'] = false;
        $this->expectHttp(403, 'links_disabled', fn () => $this->on('vote'));
        $this->h->share['shareApiEnabled'] = false;
        $this->h->sharePolicy->reset();
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('vote'));
    }

    /**
     * R14-02 (§4.11.2): the checking normalisation of the day (expiry_past,
     * expiry_too_far) runs after steps 2 and 3; step 2 decides "loosens" on
     * the unchecked end of the sent day only.
     */
    public function testExpiryIsCheckedOnlyAfterSteps2And3R1402(): void {
        // 2025-10-09 is today on the harness clock.
        $l = $this->on('edit', ['expiresAt' => '2025-10-12']);
        // Links not allowed + yesterday → links_disabled (step 3), never expiry_past.
        $this->h->linksAllowed['alice'] = false;
        $this->expectHttp(403, 'links_disabled', fn () => $this->on('vote', ['expiresAt' => '2025-10-08']));
        $this->expectHttp(403, 'links_disabled', fn () => $this->on('edit', ['expiresAt' => '2025-10-08']), 'also on an active link');
        $this->h->linksAllowed['alice'] = true;
        // Sharing disabled + expiry enforced 7 days + today + 30 → sharing_disabled (step 2), never expiry_too_far.
        $this->h->share['shareApiEnabled'] = false;
        $this->h->share['expireDefault'] = true;
        $this->h->share['expireEnforced'] = true;
        $this->h->share['expireDays'] = 7;
        $this->h->sharePolicy->reset();
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('vote', ['expiresAt' => '2025-11-08']), 'creating');
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->on('edit', ['expiresAt' => '2025-11-08']), 'loosening an active link: later than its expiry');
        $this->assertSame([$l['token'], '2025-10-12'], [$this->row()['token'], $this->h->service->links($this->b, 'alice')['edit']['expiresOn']], 'nothing changed');
        // Tightening stays allowed while sharing is off; then the checks of step 4 apply.
        $this->expectHttp(400, 'expiry_past', fn () => $this->on('edit', ['expiresAt' => '2025-10-08']));
        $this->assertSame('2025-10-10', $this->on('edit', ['expiresAt' => '2025-10-10'])['expiresOn']);
        // Sharing allowed again: the enforced maximum is checked (step 4).
        $this->h->share['shareApiEnabled'] = true;
        $this->h->sharePolicy->reset();
        $e = $this->expectHttp(400, 'expiry_too_far', fn () => $this->on('edit', ['expiresAt' => '2025-11-08']));
        $this->assertSame(7, $e->payload()['maxDays']);
    }

    public function testOwnerOnlyMember403Stranger404(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'moderate');
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'view');
        foreach ([fn () => $this->h->service->enableLink('bob', $this->b, 'vote', []), fn () => $this->h->service->disableLink('bob', $this->b, 'edit'),
            fn () => $this->h->service->rename('bob', $this->b, 'X'), fn () => $this->h->service->delete('carol', $this->b)] as $call) {
            $this->expectHttp(403, 'forbidden', $call);
        }
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->enableLink('erin', $this->b, 'vote', []));
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->delete('erin', $this->b));
    }

    // ── Account joins (SPEC-M1 §4.11.4) ────────────────────────────────────

    public function testAccountJoinWithPassword(): void {
        $l = $this->on('edit', ['password' => 'pw-one']);
        $this->expectHttp(403, 'password_required', fn () => $this->h->service->joinLinkAsUser('bob', $l['token']));
        $this->expectHttp(403, 'password_wrong', fn () => $this->h->service->joinLinkAsUser('bob', $l['token'], 'nope'));
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('bob', $l['token'], 'pw-one'));
        $this->assertSame('edit', $this->h->boards->members[$this->b]['bob']['role']);
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('bob', $l['token']), 'a valid member of THIS link skips the password');
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('alice', $l['token']), 'the owner never needs it');
        // A share of at least the link role skips it and writes no member row.
        $this->h->shareRows->add($this->b, 'user', 'carol', 'moderate');
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('carol', $l['token']));
        $this->assertArrayNotHasKey('carol', $this->h->boards->members[$this->b]);
        $this->h->shareRows->add($this->b, 'user', 'dave', 'view');
        $this->expectHttp(403, 'password_required', fn () => $this->h->service->joinLinkAsUser('dave', $l['token']), 'a lower share does not');
        // 20 failures of one network: slow_down with reason password, without a check.
        for ($i = 0; $i < 19; $i++) {
            $this->expectHttp(403, 'password_wrong', fn () => $this->h->service->joinLinkAsUser('erin', $l['token'], 'nope'));
        }
        $e = $this->expectHttp(429, 'slow_down', fn () => $this->h->service->joinLinkAsUser('erin', $l['token'], 'pw-one'));
        $this->assertSame('password', $e->payload()['reason'], 'R13 (CLI-08)');
        $this->assertGreaterThan(0, $e->payload()['retryMs']);
        $this->assertArrayNotHasKey('erin', $this->h->boards->members[$this->b]);
    }

    public function testRankRuleOfStep5(): void {
        $edit = $this->on('edit');
        $vote = $this->on('vote');
        $this->h->service->joinLinkAsUser('bob', $vote['token']);
        $voteLinkId = $this->row('vote')['id'];
        $this->assertSame(['role' => 'vote', 'link_id' => $voteLinkId], $this->h->boards->members[$this->b]['bob']);
        $this->h->service->joinLinkAsUser('bob', $edit['token']);
        $this->assertSame(['role' => 'edit', 'link_id' => $this->row('edit')['id']], $this->h->boards->members[$this->b]['bob'], 'a vote member becomes an editor (R2)');
        $this->h->boards->log = [];
        $this->h->service->joinLinkAsUser('bob', $vote['token']);
        $this->assertSame('edit', $this->h->boards->members[$this->b]['bob']['role'], 'an editor stays an editor');
        $this->assertNotContains('addMember bob', $this->h->boards->log);
        // An editor via the edit link with a password: the vote member needs it.
        $this->h->service->joinLinkAsUser('carol', $vote['token']);
        $this->on('edit', ['password' => 'pw-e']);
        $this->expectHttp(403, 'password_required', fn () => $this->h->service->joinLinkAsUser('carol', $edit['token']));
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('carol', $edit['token'], 'pw-e'));
        $this->assertSame('edit', $this->h->boards->members[$this->b]['carol']['role']);
    }

    /**
     * R14-01 (§4.11.4): IHasher hands back a new hash on the account join;
     * the rehash replaces the stored hash, and the join compares the fresh
     * row under the lock with the hash stored AFTER the check — the own
     * rehash is no password change: 200 and the member row is written.
     */
    public function testAccountJoinAfterARehashR1401(): void {
        $l = $this->on('edit', ['password' => 'pw-one']);
        $id = $this->row()['id'];
        $this->h->boards->links[$id]['password_hash'] = 'old:pw-one'; // a hash IHasher wants to renew
        $this->h->rehash = 'h:pw-one'; // the current hash form, which verify() accepts later
        $this->h->boards->log = [];
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('bob', $l['token'], 'pw-one'), 'the correct password joins (200)');
        $this->assertSame(['role' => 'edit', 'link_id' => $id], $this->h->boards->members[$this->b]['bob'] ?? null, 'the member row is written');
        $this->assertSame('h:pw-one', $this->row()['password_hash'], 'rehashed');
        $this->assertContains('replaceLinkHash ' . $id, $this->h->boards->log);
        // A second account: the stored hash is current now, nothing to renew.
        $this->assertSame($this->b, $this->h->service->joinLinkAsUser('carol', $l['token'], 'pw-one'));
        $this->assertSame('edit', $this->h->boards->members[$this->b]['carol']['role']);
    }

    /**
     * R14-01: the rehash loses against an owner's password change made
     * between the read and the replacement: verify reports the verified
     * hash, the fresh row differs → 403 password_required, nothing written,
     * the owner's hash stays.
     */
    public function testRehashLosingAgainstAnOwnerChangeAsksAgain(): void {
        $l = $this->on('edit', ['password' => 'pw-one']);
        $id = $this->row()['id'];
        $this->h->boards->links[$id]['password_hash'] = 'old:pw-one';
        $this->h->rehash = 'h:pw-one'; // the current hash form, which verify() accepts later
        $this->h->boards->onFindForUser = function () use ($id): void {
            $this->h->boards->onFindForUser = null;
            $this->h->boards->links[$id]['password_hash'] = 'h:pw-two'; // the owner, after the link was read
        };
        $this->expectHttp(403, 'password_required', fn () => $this->h->service->joinLinkAsUser('bob', $l['token'], 'pw-one'));
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$this->b] ?? []);
        $this->assertSame('h:pw-two', $this->row()['password_hash'], 'the owner\'s password is never overwritten');
    }

    public function testJoinRacingAPasswordChange(): void {
        $l = $this->on('edit', ['password' => 'pw-one']);
        $this->h->boards->onLock = function (int $b) use ($l): void {
            $id = $this->h->boards->activeLinkOf($b, 'edit')['id'];
            $this->h->boards->links[$id]['password_hash'] = 'h:pw-two';
        };
        $this->expectHttp(403, 'password_required', fn () => $this->h->service->joinLinkAsUser('bob', $l['token'], 'pw-one'));
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$this->b] ?? []);
    }

    // ── Board list v2 (SPEC-M1 §4.10.4) ────────────────────────────────────

    public function testBoardListWithSourceRoleAndMod(): void {
        $l = $this->on('edit');
        $mine = $this->h->service->create('bob', 'Bobs')['id'];
        $this->h->service->joinLinkAsUser('bob', $l['token']);
        $this->h->shareRows->add($this->b, 'group', 'staff', 'view');
        $c = $this->h->boards->addBoard('carol', 'Carols');
        $this->h->shareRows->add($c, 'user', 'bob', 'moderate');
        $d = $this->h->boards->addBoard('carol', 'Team board');
        $this->h->teams = ['tN' => ['Nord', ['bob']]];
        $this->h->shareRows->add($d, 'team', 'tN', 'vote');
        $e = $this->h->boards->addBoard('carol', 'Not for bob');
        $this->h->shareRows->add($e, 'group', 'other', 'edit');
        $rows = [];
        foreach ($this->h->service->listFor('bob') as $x) {
            $rows[$x['id']] = [$x['role'], $x['source'], $x['mod'], $x['viaLink']];
        }
        ksort($rows);
        $this->assertSame([
            $this->b => ['edit', 'link', false, true],
            $mine => ['owner', 'own', true, false],
            $c => ['edit', 'share', true, false],
            $d => ['vote', 'share', false, false],
        ], $rows, 'link edit beats share view; moderate = edit + mod');
        $this->assertSame('pin', $this->h->boards->log[array_search('listForUser', $this->h->boards->log, true) - 1], 'pin() before the groups and teams');
        // Links off for alice: bob keeps the board through the group share (view, source share).
        $this->h->linksAllowed['alice'] = false;
        $x = array_values(array_filter($this->h->service->listFor('bob'), fn (array $r): bool => $r['id'] === $this->b))[0];
        $this->assertSame(['view', 'share', false, false], [$x['role'], $x['source'], $x['mod'], $x['viaLink']]);
    }

    public function testUserDeletedTakesItsSharesAlong(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'edit');
        $other = $this->h->boards->addBoard('carol');
        $this->h->shareRows->add($other, 'user', 'bob', 'view');
        $this->h->shareRows->add($other, 'user', 'dave', 'view');
        $this->h->service->onUserDeleted('bob');
        $this->assertSame([], $this->h->shareRows->of($this->b));
        $this->assertSame(['user:dave=view'], $this->h->shareRows->of($other));
        $this->assertSame([2, 2], [$this->h->boards->boards[$this->b]['acl_gen'], $this->h->boards->boards[$other]['acl_gen']]);
        // Deleting a board deletes its shares.
        $this->h->service->delete('carol', $other);
        $this->assertSame([], $this->h->shareRows->of($other));
    }
}
