<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use OCP\Share\IShare;
use PHPUnit\Framework\TestCase;

/**
 * Explicit shares (SPEC-M1 §4.9, §4.10, §4.13.1): roleFor as the maximum
 * over user, group and team rows, the PUT order (a)–(e) of R13 with
 * counting and charging BEFORE resolution, canonical recipients, the rules
 * for new entries and for raises (R13), the diff under the board lock, the
 * share list and the recipient search, both marking accounts that cannot
 * open Knorke with appAccess: false (job 079).
 */
final class ShareServiceTest extends TestCase {
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->boards->addBoard('alice', 'B', 5, 3);
    }

    private function expectHttp(int $status, string $code, callable $fn, ?int $at = null): HttpError {
        try {
            $fn();
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error], $e->getMessage());
            if ($at !== null) {
                $this->assertSame($at, $e->payload()['at'] ?? null, 'at');
            }
            return $e;
        }
        $this->fail("expected $status $code");
    }

    private function save(array $shares): array {
        return $this->h->shares->save('alice', $this->b, $shares);
    }

    private static function e(string $kind, string $id, string $role = 'edit'): array {
        return ['kind' => $kind, 'id' => $id, 'role' => $role];
    }

    /** @return list<string> knorke-share-new charges so far */
    private function charges(): array {
        return array_values(array_filter($this->h->limiterCalls, static fn (string $c): bool => str_starts_with($c, 'knorke-share-new ')));
    }

    // ── roleFor ────────────────────────────────────────────────────────────

    public function testRoleForIsTheMaximumOverUserGroupsAndTeams(): void {
        $bob = $this->h->user('bob');
        $this->assertSame([null, false], $this->h->shares->roleFor($this->b, $bob));
        $this->h->shareRows->add($this->b, 'group', 'knorke-e2e', 'view');
        $this->assertSame([Role::View, false], $this->h->shares->roleFor($this->b, $bob));
        $this->assertSame([], $this->h->teamCalls, 'no team rows: getTeamsForUser is never called');
        $this->h->shareRows->add($this->b, 'user', 'bob', 'vote');
        $this->assertSame([Role::Vote, false], $this->h->shares->roleFor($this->b, $bob));
        $this->h->teams = ['tN' => ['Nord', ['bob']]];
        $this->h->shareRows->add($this->b, 'team', 'tN', 'moderate');
        $this->assertSame([Role::Edit, true], $this->h->shares->roleFor($this->b, $bob), 'moderate = edit + facilitator');
        $this->assertSame(['bob'], $this->h->teamCalls);
        $this->assertSame([Role::View, false], $this->h->shares->roleFor($this->b, $this->h->user('carol')), 'carol only through knorke-e2e');
        $this->assertSame([null, false], $this->h->shares->roleFor($this->b, $this->h->user('erin')));
        // Unknown stored roles (a later version) grant nothing.
        $other = $this->h->boards->addBoard('alice');
        $this->h->shareRows->add($other, 'user', 'bob', 'superuser');
        $this->assertSame([null, false], $this->h->shares->roleFor($other, $bob));
    }

    public function testTeamRowsGrantNothingWithoutTeamSupport(): void {
        $h = new AccessHarness();
        $b = $h->boards->addBoard('alice');
        $h->teamSupport = false;
        $h->teams = ['tN' => ['Nord', ['bob']]];
        $h->shareRows->add($b, 'team', 'tN', 'edit');
        $this->assertSame([null, false], $h->shares->roleFor($b, $h->user('bob')));
        $this->assertSame([], $h->teamCalls);
    }

    public function testBestOf(): void {
        $this->assertSame([null, false], \OCA\Knorke\Service\ShareService::bestOf([]));
        $this->assertSame([Role::Edit, true], \OCA\Knorke\Service\ShareService::bestOf(['view', 'moderate', 'vote']));
        $this->assertSame([Role::Vote, false], \OCA\Knorke\Service\ShareService::bestOf(['view', 'vote', 'nonsense']));
    }

    // ── save: form ──────────────────────────────────────────────────────────

    public function testFormErrorsCarryAt(): void {
        foreach ([
            [[self::e('user', 'bob'), ['kind' => 'user', 'id' => 'carol']], 1],
            [[self::e('user', 'bob'), self::e('user', 'carol') + ['x' => 1]], 1],
            [[self::e('mail', 'bob')], 0],
            [[self::e('user', 'bob', 'owner')], 0],
            [[self::e('user', '')], 0],
            [[self::e('user', str_repeat('b', 65))], 0],
            [[self::e('user', "bo\x07b")], 0],
            [[self::e('user', "\xff")], 0],
            [[['kind' => 'user', 'id' => 5, 'role' => 'edit']], 0],
            [['bob'], 0],
            [[self::e('user', 'bob'), self::e('user', 'carol'), self::e('user', 'bob', 'view')], 2],
        ] as [$shares, $at]) {
            $this->expectHttp(400, 'bad_request', fn () => $this->save($shares), $at);
        }
        $this->expectHttp(400, 'bad_request', fn () => $this->save(['a' => self::e('user', 'bob')]));
        $this->assertSame([], $this->h->shareRows->of($this->b), 'nothing stored');
        $this->save([self::e('user', str_repeat('ü', 64))]);
        $this->assertSame(['user:' . str_repeat('ü', 64) . '=edit'], $this->h->shareRows->of($this->b), '64 characters, not bytes');
    }

    public function testTooManySharesCarriesMax(): void {
        $shares = [];
        for ($i = 0; $i < 201; $i++) {
            $shares[] = self::e('user', 'u' . $i);
        }
        $e = $this->expectHttp(400, 'too_many_shares', fn () => $this->save($shares), 200);
        $this->assertSame(200, $e->payload()['max'], 'CLI-11: max for the client text');
        $this->assertSame([], $this->charges());
    }

    public function testFourByteIdOnUtf8mb3IsNotFoundBeforeAnyQuery(): void {
        $this->h->fourByte = false;
        $this->expectHttp(400, 'recipient_not_found', fn () => $this->save([self::e('user', 'bob'), self::e('group', "team\u{1F600}")]), 1);
        $this->assertSame([], $this->charges(), 'never charged, never resolved');
        $this->assertSame([], $this->h->shareRows->log, 'no query at all');
    }

    // ── save: R13 order (a)–(e) ─────────────────────────────────────────────

    public function testCanonicalisationAndDuplicatesAfterIt(): void {
        $out = $this->save([self::e('user', 'bob'), self::e('group', 'KNORKE-E2E', 'view')]);
        $this->assertSame(['group:knorke-e2e=view', 'user:bob=edit'], $this->h->shareRows->of($this->b), 'getGID(), never the typed spelling');
        $this->assertSame(['shares', 'policy'], array_keys($out));
        // KNORKE-E2E again is provisionally NEW (byte-exact) and canonicalises onto the stored row: one row.
        $this->save([self::e('user', 'bob'), self::e('group', 'KNORKE-E2E', 'edit')]);
        $this->assertSame(['group:knorke-e2e=edit', 'user:bob=edit'], $this->h->shareRows->of($this->b));
        $this->assertCount(3, $this->charges(), 'bob, KNORKE-E2E, then KNORKE-E2E again (byte-exact new against stored knorke-e2e)');
        // Both spellings at once → 400 after canonicalisation, nothing written.
        $before = $this->h->shareRows->of($this->b);
        $this->expectHttp(400, 'bad_request', fn () => $this->save([self::e('group', 'knorke-e2e'), self::e('group', 'Knorke-E2E')]), 1);
        $this->assertSame($before, $this->h->shareRows->of($this->b));
    }

    public function testTooManyNewSharesBeforeAnythingIsChargedOrResolved(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $shares = [self::e('user', 'bob', 'view')];
        for ($i = 0; $i < 21; $i++) {
            $shares[] = self::e('user', 'knorke-nope-' . $i);
        }
        $e = $this->expectHttp(400, 'too_many_new_shares', fn () => $this->save($shares), 21);
        $this->assertSame(20, $e->payload()['max']);
        $this->assertSame([], $this->charges(), 'nothing charged');
        // 20 new: each charged BEFORE resolution, the first unknown one fails, charges stay.
        array_pop($shares);
        $this->expectHttp(400, 'recipient_not_found', fn () => $this->save($shares), 1);
        $this->assertCount(20, $this->charges(), 'R13 (d): every provisionally new entry is charged first');
        $this->assertSame('knorke-share-new 60 600 alice', $this->charges()[0]);
    }

    public function testTheSixtyFirstNewRecipientIsSlowDown(): void {
        $this->h->userLimits['knorke-share-new'] = 60;
        for ($round = 0; $round < 3; $round++) {
            $shares = [];
            for ($i = 0; $i < 20; $i++) {
                $shares[] = self::e('user', 'knorke-nope-' . ($round * 20 + $i));
            }
            $this->expectHttp(400, 'recipient_not_found', fn () => $this->save($shares), 0);
        }
        $this->assertCount(60, $this->charges());
        $e = $this->expectHttp(429, 'slow_down', fn () => $this->save([self::e('user', 'bob')]));
        $this->assertSame(10000, $e->payload()['retryMs']);
        $this->assertSame(10, $e->retryAfterSeconds());
        $this->assertSame([], $this->h->shareRows->of($this->b), 'nothing saved');
        // Existing rows cost nothing: a role change of a stored entry still works.
        $this->h->shareRows->add($this->b, 'user', 'carol', 'view');
        $this->save([self::e('user', 'carol', 'vote')]);
        $this->assertSame(['user:carol=vote'], $this->h->shareRows->of($this->b));
    }

    public function testRulesForNewEntries(): void {
        $this->expectHttp(400, 'self_share', fn () => $this->save([self::e('user', 'bob'), self::e('user', 'alice')]), 1);
        $this->h->disabledUsers = ['dora'];
        $this->expectHttp(400, 'recipient_not_found', fn () => $this->save([self::e('user', 'dora')]), 0);
        $this->expectHttp(400, 'recipient_not_found', fn () => $this->save([self::e('group', 'nope')]), 0);
        $this->expectHttp(400, 'recipient_not_found', fn () => $this->save([self::e('team', 'notMine')]), 0);
        $h = new AccessHarness();
        $b = $h->boards->addBoard('alice');
        $h->teamSupport = false;
        $this->expectHttpOn($h, $b, [self::e('team', 'x')], 400, 'teams_unavailable', 0);
        $h = new AccessHarness();
        $b = $h->boards->addBoard('alice');
        $h->share['allowGroupSharing'] = false;
        $this->expectHttpOn($h, $b, [self::e('user', 'bob'), self::e('group', 'staff')], 400, 'group_sharing_disabled', 1);
        $h = new AccessHarness();
        $b = $h->boards->addBoard('alice');
        $h->share['groupMembersOnly'] = true;
        $this->expectHttpOn($h, $b, [self::e('user', 'carol')], 400, 'group_members_only', 0);
        $this->expectHttpOn($h, $b, [self::e('group', 'knorke-e2e')], 400, 'group_members_only', 0);
        $h->shares->save('alice', $b, [self::e('user', 'bob'), self::e('group', 'staff')]);
        $this->assertSame(['group:staff=edit', 'user:bob=edit'], $h->shareRows->of($b));
        $this->assertSame([], $this->h->shareRows->of($this->b), 'nothing of the failed PUTs was stored');
    }

    private function expectHttpOn(AccessHarness $h, int $b, array $shares, int $status, string $code, int $at): void {
        $this->expectHttp($status, $code, fn () => $h->shares->save('alice', $b, $shares), $at);
    }

    public function testSharingDisabledForNewAndRaisedButNotForRemovingOrLowering(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'edit');
        $this->h->shareRows->add($this->b, 'group', 'staff', 'view');
        $this->h->share['shareApiEnabled'] = false;
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->save([self::e('user', 'bob'), self::e('group', 'staff', 'view'), self::e('user', 'carol')]), 2);
        $this->expectHttp(403, 'sharing_disabled', fn () => $this->save([self::e('user', 'bob', 'moderate'), self::e('group', 'staff', 'view')]), 0);
        $this->save([self::e('user', 'bob', 'view')]);
        $this->assertSame(['user:bob=view'], $this->h->shareRows->of($this->b), 'lowered and removed while sharing is disabled');
    }

    public function testRaisingChecksOnlySharingAndGroupSharingR13(): void {
        $this->h->shareRows->add($this->b, 'group', 'staff', 'view');
        $this->h->shareRows->add($this->b, 'user', 'carol', 'view');
        $this->h->share['allowGroupSharing'] = false;
        $this->h->share['groupMembersOnly'] = true;
        $this->h->tx = [];
        $this->expectHttp(400, 'group_sharing_disabled', fn () => $this->save([self::e('group', 'staff', 'vote'), self::e('user', 'carol', 'view')]), 0);
        $this->assertSame([], $this->h->tx, 'R13 (e): the rules run before the board lock (no transaction)');
        // carol shares no group with alice: a raise is still fine (group_members_only is for new entries).
        $out = $this->save([self::e('group', 'staff', 'view'), self::e('user', 'carol', 'moderate')]);
        $this->assertSame(['group:staff=view', 'user:carol=moderate'], $this->h->shareRows->of($this->b));
        $this->assertSame([], $this->charges(), 'no new recipients, no charges');
        $this->assertSame([['user', 'carol', 'moderate'], ['group', 'staff', 'view']], array_map(static fn (array $s): array => [$s['kind'], $s['id'], $s['role']], $out['shares']));
        // Lowering a group share stays allowed.
        $this->save([self::e('group', 'staff', 'view'), self::e('user', 'carol', 'view')]);
        $this->assertSame(['group:staff=view', 'user:carol=view'], $this->h->shareRows->of($this->b));
    }

    // ── save: under the lock ───────────────────────────────────────────────

    public function testEveryChangeBumpsAclGenInOneLockedTransaction(): void {
        $this->h->boards->log = [];
        $this->h->tx = [];
        $this->save([self::e('user', 'bob', 'moderate')]);
        $this->assertSame(['lockBoard --', 'lockBoard acl-'], $this->h->boards->log, 'lock first; acl_gen + 1 after the diff');
        $this->assertSame(['begin', 'commit'], $this->h->tx);
        $this->assertSame(4, $this->h->boards->boards[$this->b]['acl_gen']);
        $this->assertSame(4, $this->h->cache->getGens($this->b)['acl'], 'setGens after COMMIT');
        $this->assertSame('Bob Display', array_values($this->h->shareRows->rows)[0]['display_name']);
        $this->assertSame('alice', array_values($this->h->shareRows->rows)[0]['created_by']);
        // The same list again: no diff, no bump, no setGens.
        $this->h->boards->log = [];
        $this->h->mem->log = [];
        $this->save([self::e('user', 'bob', 'moderate')]);
        $this->assertSame(['lockBoard --'], $this->h->boards->log);
        $this->assertSame(4, $this->h->boards->boards[$this->b]['acl_gen']);
        $this->assertNotContains('set a:' . $this->b, $this->h->mem->log);
        // Removing everything: one more bump.
        $this->save([]);
        $this->assertSame([], $this->h->shareRows->of($this->b));
        $this->assertSame(5, $this->h->boards->boards[$this->b]['acl_gen']);
    }

    public function testARowGoneMeanwhileIsCheckedAsNewUnderTheLock(): void {
        // bob is stored when the PUT reads; a second tab removes him before the lock.
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->disabledUsers = ['bob'];
        $reads = 0;
        $this->h->shareRows->onRead = function () use (&$reads): void {
            if (++$reads === 2) {
                foreach ($this->h->shareRows->rows as $id => $r) {
                    unset($this->h->shareRows->rows[$id]);
                }
            }
        };
        $this->expectHttp(400, 'recipient_not_found', fn () => $this->save([self::e('user', 'bob', 'view')]), 0);
        $this->assertContains('rollBack', $this->h->tx);
        $this->assertSame([], $this->h->shareRows->of($this->b));
    }

    public function testOnlyTheOwnerOfTheBoardUnderTheLock(): void {
        $this->expectHttp(404, 'not_found', fn () => $this->h->shares->save('alice', 999, [self::e('user', 'bob')]));
        $this->h->boards->onLock = function (int $b): void {
            $this->h->boards->boards[$b]['owner'] = 'mallory';
        };
        $this->expectHttp(404, 'not_found', fn () => $this->save([self::e('user', 'bob')]));
    }

    // ── list ───────────────────────────────────────────────────────────────

    public function testListSortsNamesAndAvailability(): void {
        $this->h->teams = ['tN' => ['Team Nord', ['alice']]];
        $this->h->shareRows->add($this->b, 'team', 'tN', 'vote', 'Old team name');
        $this->h->shareRows->add($this->b, 'group', 'gone', 'view', 'Deleted Group');
        $this->h->shareRows->add($this->b, 'user', 'zoe', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'bob', 'moderate');
        $this->h->shareRows->add($this->b, 'group', 'staff', 'edit');
        $out = $this->h->shares->list('alice', $this->b);
        $this->assertSame([
            ['kind' => 'user', 'id' => 'bob', 'name' => 'Bob Display', 'role' => 'moderate', 'available' => true],
            ['kind' => 'user', 'id' => 'zoe', 'name' => 'Zoe Display', 'role' => 'edit', 'available' => true],
            ['kind' => 'group', 'id' => 'gone', 'name' => 'Deleted Group', 'role' => 'view', 'available' => false],
            ['kind' => 'group', 'id' => 'staff', 'name' => 'Staff', 'role' => 'edit', 'available' => true],
            ['kind' => 'team', 'id' => 'tN', 'name' => 'Team Nord', 'role' => 'vote', 'available' => true],
        ], $out['shares']);
        $this->assertSame(['sharing' => true, 'groups' => true, 'teams' => true, 'groupMembersOnly' => false], $out['policy']);
        // The owner left the team: still available, stored name (SPEC-M1 §4.10.1).
        $h = new AccessHarness();
        $b = $h->boards->addBoard('alice');
        $h->shareRows->add($b, 'team', 'tX', 'vote', 'Former team');
        $this->assertSame(['Former team', true], [$h->shares->list('alice', $b)['shares'][0]['name'], $h->shares->list('alice', $b)['shares'][0]['available']]);
        $h->teamSupport = false;
        $h->sharePolicy->reset();
        $this->assertFalse($h->shares->list('alice', $b)['shares'][0]['available'], 'no team support: grants nothing');
    }

    // ── sharees ────────────────────────────────────────────────────────────

    public function testShareesFiltersAndTypes(): void {
        $this->h->teams = ['tMine' => ['Nord', ['alice']]];
        $this->h->disabledUsers = ['dora'];
        $this->h->search = [[
            'exact' => ['users' => [['label' => 'Bob Berg', 'shareWithDisplayNameUnique' => 'bob@example.org', 'value' => ['shareType' => 0, 'shareWith' => 'bob']]],
                'groups' => [], 'circles' => []],
            'users' => [
                ['label' => 'Alice', 'value' => ['shareWith' => 'alice']],
                ['label' => 'Dora', 'value' => ['shareWith' => 'dora']],
                ['label' => 'Bob again', 'value' => ['shareWith' => 'bob']],
                ['label' => 'No value'],
                ['label' => 'Carol', 'value' => ['shareWith' => 'carol']],
            ],
            'groups' => [['label' => 'Workshop', 'value' => ['shareType' => 1, 'shareWith' => 'knorke-e2e']]],
            'circles' => [
                ['label' => 'Nord', 'value' => ['shareType' => 7, 'shareWith' => 'tMine', 'circle' => new \stdClass()]],
                ['label' => 'Hidden', 'value' => ['shareType' => 7, 'shareWith' => 'tHidden', 'circle' => new \stdClass()]],
            ],
            'emails' => [['label' => 'x@example.org', 'value' => ['shareWith' => 'x@example.org']]],
        ], true];
        $out = $this->h->shares->sharees('alice', $this->b, 'bo');
        $this->assertSame([
            ['kind' => 'user', 'id' => 'bob', 'name' => 'Bob Berg', 'sub' => 'bob@example.org'],
            ['kind' => 'user', 'id' => 'carol', 'name' => 'Carol', 'sub' => 'carol'],
            ['kind' => 'group', 'id' => 'knorke-e2e', 'name' => 'Workshop'],
            ['kind' => 'team', 'id' => 'tMine', 'name' => 'Nord'],
        ], $out['sharees'], 'exact first; no owner, no disabled user, no entry without shareWith, no hidden team (R13), no Circle object');
        $this->assertTrue($out['more']);
        $this->assertSame([['q' => 'bo', 'types' => [IShare::TYPE_USER, IShare::TYPE_GROUP, IShare::TYPE_CIRCLE], 'lookup' => false, 'limit' => 25, 'offset' => 0]], $this->h->searchCalls);
        $this->assertStringNotContainsString('circle"', json_encode($out));
    }

    public function testShareesPolicyAndLimits(): void {
        $this->h->search = [['users' => [['label' => 'Bob', 'value' => ['shareWith' => 'bob']]]], false];
        $this->h->systemValues['sharing.maxAutocompleteResults'] = 10;
        $this->h->shares->sharees('alice', $this->b, 'bob');
        $this->assertSame(10, $this->h->searchCalls[0]['limit']);
        $this->h->systemValues['sharing.maxAutocompleteResults'] = 0;
        $this->h->shares->sharees('alice', $this->b, 'bob');
        $this->assertSame(25, $this->h->searchCalls[1]['limit'], 'SRV-09: ≤ 0 means "no cap" → 25');
        $this->h->systemValues['sharing.maxAutocompleteResults'] = -5;
        $this->h->shares->sharees('alice', $this->b, 'bob');
        $this->assertSame(25, $this->h->searchCalls[2]['limit']);
        $this->h->systemValues['sharing.maxAutocompleteResults'] = 100;
        $this->h->shares->sharees('alice', $this->b, 'bob');
        $this->assertSame(25, $this->h->searchCalls[3]['limit']);
        $this->h->systemValues['sharing.minSearchStringLength'] = 3;
        $this->assertSame(['sharees' => [], 'more' => false], $this->h->shares->sharees('alice', $this->b, ' bo '));
        $this->assertCount(4, $this->h->searchCalls, 'below the minimum: no search');
        $this->h->systemValues['sharing.minSearchStringLength'] = 0;
        $this->h->fourByte = false;
        $this->assertSame(['sharees' => [], 'more' => false], $this->h->shares->sharees('alice', $this->b, "bo\u{1F600}"));
        $this->assertCount(4, $this->h->searchCalls, 'utf8mb3 and a 4-byte character: no search');
        $this->h->fourByte = true;
        $this->h->share['allowGroupSharing'] = false;
        $this->h->teamSupport = false;
        $this->h->sharePolicy->reset();
        $this->h->shares->sharees('alice', $this->b, 'bob');
        $this->assertSame([IShare::TYPE_USER], $this->h->searchCalls[4]['types'], 'never mail or remote; groups and teams only when allowed');
        $this->h->share['shareApiEnabled'] = false;
        $this->h->sharePolicy->reset();
        $this->assertSame(['sharees' => [], 'more' => false], $this->h->shares->sharees('alice', $this->b, 'bob'));
        $this->assertCount(5, $this->h->searchCalls, 'sharing disabled: empty without a search');
    }

    // ── accounts that cannot open Knorke (job 079) ──────────────────────────

    /** AK1: an account outside Knorke's "Limit to groups" is marked, nothing else is. */
    public function testShareesMarkAnAccountOutsideTheGroups(): void {
        $this->h->knorkeFor['carol'] = false;
        $this->h->teams = ['tMine' => ['Nord', ['alice']]];
        $this->h->search = [[
            'users' => [
                ['label' => 'Bob Berg', 'shareWithDisplayNameUnique' => 'bob@example.org', 'value' => ['shareWith' => 'bob']],
                ['label' => 'Carol', 'value' => ['shareWith' => 'carol']],
            ],
            'groups' => [['label' => 'Workshop', 'value' => ['shareWith' => 'knorke-e2e']]],
            'circles' => [['label' => 'Nord', 'value' => ['shareWith' => 'tMine']]],
        ], false];
        $this->assertSame([
            ['kind' => 'user', 'id' => 'bob', 'name' => 'Bob Berg', 'sub' => 'bob@example.org'],
            ['kind' => 'user', 'id' => 'carol', 'name' => 'Carol', 'sub' => 'carol', 'appAccess' => false],
            ['kind' => 'group', 'id' => 'knorke-e2e', 'name' => 'Workshop'],
            ['kind' => 'team', 'id' => 'tMine', 'name' => 'Nord'],
        ], $this->h->shares->sharees('alice', $this->b, 'x')['sharees']);
    }

    /**
     * The one hit of sharees() for the user $uid, in a fresh harness where
     * gast is an account of the Guests app and $guests its whitelist.
     *
     * @param array<string, bool> $knorkeFor
     */
    private function hitWith(?object $guests, string $uid = 'gast', array $knorkeFor = []): array {
        $this->h = new AccessHarness();
        $this->b = $this->h->boards->addBoard('alice', 'B', 5, 3);
        $this->h->backends['gast'] = 'Guests';
        $this->h->knorkeFor = $knorkeFor;
        $this->h->guests = $guests;
        $this->h->search = [['users' => [['label' => ucfirst($uid), 'value' => ['shareWith' => $uid]]]], false];
        $sharees = $this->h->shares->sharees('alice', $this->b, 'x')['sharees'];
        $this->assertCount(1, $sharees);
        return $sharees[0];
    }

    /** AK2: an account of the Guests app follows that app's whitelist, fails closed, is asked only after app access. */
    public function testShareesFollowTheGuestsAppWhitelist(): void {
        $marked = ['kind' => 'user', 'id' => 'gast', 'name' => 'Gast', 'sub' => 'gast', 'appAccess' => false];
        $wl = new FakeGuestsWhitelist(false);
        $this->assertSame($marked, $this->hitWith($wl));
        $this->assertSame([['gast', '/apps/knorke/']], $wl->calls, 'asked once, for /apps/knorke/');

        $wl = new FakeGuestsWhitelist(true);
        $this->assertSame(['kind' => 'user', 'id' => 'gast', 'name' => 'Gast', 'sub' => 'gast'], $this->hitWith($wl), 'on the whitelist: no key');

        $wl = new FakeGuestsWhitelist(true);
        $wl->throw = new \RuntimeException('guests broken');
        $this->assertSame($marked, $this->hitWith($wl), 'a failing Guests app marks (fails closed)');
        $this->assertSame([], $this->h->warnings);
        $this->assertSame($marked, $this->hitWith(null), 'without the Guests app (no class): marked');
        $this->assertSame([], $this->h->warnings);

        $wl = new FakeGuestsWhitelist(true);
        $this->assertSame($marked, $this->hitWith($wl, 'gast', ['gast' => false]), 'no app access: marked');
        $this->assertSame([], $wl->calls, 'without app access the whitelist is not asked');

        $wl = new FakeGuestsWhitelist(false);
        $this->assertSame(['kind' => 'user', 'id' => 'bob', 'name' => 'Bob', 'sub' => 'bob'], $this->hitWith($wl, 'bob'));
        $this->assertSame([], $wl->calls, 'not an account of the Guests app: never asked');
    }

    /** AK3: stored account rows are marked (last key), group and team rows never; asked on every call. */
    public function testListMarksStoredAccountsButNeverGroupsOrTeams(): void {
        $this->h->teams = ['tN' => ['Team Nord', ['alice']]];
        $this->h->knorkeFor['carol'] = false;
        $this->h->backends['gast'] = 'Guests';
        $this->h->guests = $wl = new FakeGuestsWhitelist(false);
        $this->h->shareRows->add($this->b, 'team', 'tN', 'view');
        $this->h->shareRows->add($this->b, 'user', 'gast', 'view');
        $this->h->shareRows->add($this->b, 'group', 'staff', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'bob', 'moderate');
        $this->assertSame([
            ['kind' => 'user', 'id' => 'bob', 'name' => 'Bob Display', 'role' => 'moderate', 'available' => true],
            ['kind' => 'user', 'id' => 'carol', 'name' => 'Carol Display', 'role' => 'edit', 'available' => true, 'appAccess' => false],
            ['kind' => 'user', 'id' => 'gast', 'name' => 'Gast Display', 'role' => 'view', 'available' => true, 'appAccess' => false],
            ['kind' => 'group', 'id' => 'staff', 'name' => 'Staff', 'role' => 'edit', 'available' => true],
            ['kind' => 'team', 'id' => 'tN', 'name' => 'Team Nord', 'role' => 'view', 'available' => true],
        ], $this->h->shares->list('alice', $this->b)['shares']);
        $this->assertSame([['gast', '/apps/knorke/']], $wl->calls);

        $wl->answer = true;
        $shares = $this->h->shares->list('alice', $this->b)['shares'];
        $this->assertSame(['kind' => 'user', 'id' => 'gast', 'name' => 'Gast Display', 'role' => 'view', 'available' => true], $shares[2], 'asked again: never kept');
        $this->assertSame(['carol', false], [$shares[1]['id'], $shares[1]['appAccess'] ?? null]);
        $this->assertCount(2, $wl->calls);

        // An account that is gone: the row stays as it was (no lookup of a null account).
        $h = new AccessHarness();
        $b = $h->boards->addBoard('alice');
        $h->deletedUsers = ['dave'];
        $h->knorkeFor['dave'] = false;
        $h->shareRows->add($b, 'user', 'dave', 'edit', 'Dave Old');
        $this->assertSame([['kind' => 'user', 'id' => 'dave', 'name' => 'Dave Old', 'role' => 'edit', 'available' => true]], $h->shares->list('alice', $b)['shares']);
    }

    /** AK4: saving a marked account stays allowed; the answer marks it; no notification for it. */
    public function testSavingAMarkedAccountStaysAllowedAndTheAnswerMarksIt(): void {
        $this->h->knorkeFor['carol'] = false;
        $out = $this->save([self::e('user', 'carol')]);
        $this->assertSame(['user:carol=edit'], $this->h->shareRows->of($this->b));
        $this->assertSame([['kind' => 'user', 'id' => 'carol', 'name' => 'Carol Display', 'role' => 'edit', 'available' => true, 'appAccess' => false]], $out['shares']);
        $this->assertSame([], $this->h->sent, 'carol gets no notification (ShareNotifications::notifyUser, as before)');
        // Control: an account with access added next to her is notified and not marked.
        $out = $this->save([self::e('user', 'carol'), self::e('user', 'bob')]);
        $this->assertSame([['bob', false], ['carol', true]], array_map(static fn (array $s): array => [$s['id'], array_key_exists('appAccess', $s)], $out['shares']));
        $this->assertSame(['bob'], array_map(static fn ($n): string => $n->getUser(), $this->h->sent));
    }

    // ── events ─────────────────────────────────────────────────────────────

    public function testEventsBumpAscendingAndNeverThrow(): void {
        $b2 = $this->h->boards->addBoard('bob');
        $b3 = $this->h->boards->addBoard('carol');
        $this->h->shareRows->add($b3, 'group', 'staff', 'edit');
        $this->h->shareRows->add($this->b, 'group', 'staff', 'view');
        $this->h->shareRows->add($b2, 'team', 'tN', 'view');
        $this->h->boards->log = [];
        $this->h->shares->onUserRemovedFromGroup('staff');
        $this->assertSame(['lockBoard acl-', 'lockBoard acl-'], $this->h->boards->log);
        $this->assertSame([4, 1, 2], [$this->h->boards->boards[$this->b]['acl_gen'], $this->h->boards->boards[$b2]['acl_gen'], $this->h->boards->boards[$b3]['acl_gen']]);
        $this->assertSame(4, $this->h->cache->getGens($this->b)['acl']);
        $this->h->shares->onGroupDeleted('staff');
        $this->assertSame([], array_merge($this->h->shareRows->of($this->b), $this->h->shareRows->of($b3)), 'rows deleted first');
        $this->assertSame(5, $this->h->boards->boards[$this->b]['acl_gen']);
        $this->h->shares->onTeamsChanged(['tN', 'tN']);
        $this->assertSame(2, $this->h->boards->boards[$b2]['acl_gen'], 'one bump per board');
        $this->h->shares->onTeamChanged('tN', true);
        $this->assertSame([], $this->h->shareRows->of($b2));
        $this->assertSame(3, $this->h->boards->boards[$b2]['acl_gen']);
        $this->h->shareRows->failWith = new \RuntimeException('db down');
        $this->h->shares->onGroupDeleted('staff');
        $this->h->shares->onUserDeleted('bob');
        $this->assertCount(2, $this->h->warnings, 'logged, not thrown');
    }

    public function testManyBoardsGoToTheJob(): void {
        $ids = [];
        for ($i = 0; $i < 1100; $i++) {
            $ids[] = $this->h->boards->addBoard('o' . $i);
        }
        rsort($ids);
        $this->h->boards->log = [];
        $this->h->shares->bumpBoards($ids);
        $this->assertSame([], $this->h->boards->log, 'nothing inline above 50 boards');
        $this->assertSame([500, 500, 100], array_map(static fn (array $j): int => count($j['argument']['boards']), $this->h->jobs));
        $this->assertSame(\OCA\Knorke\BackgroundJob\AclBumpJob::class, $this->h->jobs[0]['job']);
        $first = $this->h->jobs[0]['argument']['boards'];
        $this->assertSame($first, array_values(array_unique($first)));
        $sorted = $first;
        sort($sorted);
        $this->assertSame($sorted, $first, 'ascending ids');
        $this->h->shares->bumpBoards(array_slice($ids, 0, 50));
        $this->assertCount(50, $this->h->boards->log, '50 boards: inline');
    }
}
