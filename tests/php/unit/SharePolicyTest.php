<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\GroupInterface;
use OCP\IGroupManager;
use OCP\IUser;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;

/**
 * Nextcloud's sharing policy (SPEC-M1 §7.4, §4.10.1, §4.10.2 step 4) through
 * the IManager getters of a fake share manager: one assertion block per
 * row of the §7.4 table, the R13 linkPolicy mapping and team support.
 */
final class SharePolicyTest extends TestCase {
    private AccessHarness $h;

    protected function setUp(): void {
        $this->h = new AccessHarness();
    }

    private function owner(string $uid = 'alice'): \OCP\IUser {
        return $this->h->user($uid);
    }

    public function testForOwnerReadsEveryGetter(): void {
        $p = $this->h->sharePolicy;
        $this->assertSame(['sharing' => true, 'groups' => true, 'teams' => true, 'groupMembersOnly' => false], $p->forOwner($this->owner()));
        $h = new AccessHarness();
        $h->share = ['shareApiEnabled' => false] + $h->share;
        $this->assertFalse($h->sharePolicy->forOwner($h->user('alice'))['sharing'], 'shareapi_enabled = no');
        $h = new AccessHarness();
        $h->share['sharingDisabledFor'] = ['alice'];
        $this->assertFalse($h->sharePolicy->forOwner($h->user('alice'))['sharing'], 'exclusion group of the owner');
        $this->assertTrue($h->sharePolicy->forOwner($h->user('bob'))['sharing'], 'per owner');
        $h = new AccessHarness();
        $h->share['allowGroupSharing'] = false;
        $h->share['groupMembersOnly'] = true;
        $this->assertSame([false, true], array_values(array_intersect_key($h->sharePolicy->forOwner($h->user('alice')), ['groups' => 0, 'groupMembersOnly' => 0])));
        $h = new AccessHarness();
        $h->teamSupport = false;
        $this->assertFalse($h->sharePolicy->forOwner($h->user('alice'))['teams'], 'no Circles');
        $h = new AccessHarness();
        $h->circlesFor['alice'] = false;
        $this->assertFalse($h->sharePolicy->forOwner($h->user('alice'))['teams'], 'Circles not enabled for the owner');
    }

    public function testCheckNewRulesInOrder(): void {
        $p = $this->h->sharePolicy;
        $alice = $this->owner();
        $this->assertNull($p->checkNew($alice, 'user', 'bob'));
        $this->assertNull($p->checkNew($alice, 'user', 'BOB'), 'Nextcloud resolves case-insensitively; canonical() stores bob');
        $this->assertSame('self_share', $p->checkNew($alice, 'user', 'alice'));
        $this->h->deletedUsers = ['ghost'];
        $this->assertSame('recipient_not_found', $p->checkNew($alice, 'user', 'ghost'));
        $this->h->disabledUsers = ['dora'];
        $this->assertSame('recipient_not_found', $p->checkNew($alice, 'user', 'dora'), 'a disabled account is not a recipient');
        $this->assertNull($p->checkNew($alice, 'group', 'knorke-e2e'));
        $this->assertSame('recipient_not_found', $p->checkNew($alice, 'group', 'nope'));
        $this->assertSame('recipient_not_found', $p->checkNew($alice, 'team', 'aTeamOfAlice'), 'the owner is no member of it');
        $this->h->teams = ['aTeamOfAlice' => ['Nord', ['alice', 'bob']]];
        $p->reset();
        $this->assertNull($p->checkNew($alice, 'team', 'aTeamOfAlice'));
    }

    public function testGroupMembersOnly(): void {
        $this->h->share['groupMembersOnly'] = true;
        $p = $this->h->sharePolicy;
        $alice = $this->owner();
        // alice ∈ staff = {alice, bob}; carol only in knorke-e2e.
        $this->assertNull($p->checkNew($alice, 'user', 'bob'), 'common group staff');
        $this->assertSame('group_members_only', $p->checkNew($alice, 'user', 'carol'));
        $this->assertNull($p->checkNew($alice, 'group', 'staff'), 'the owner is in the group');
        $this->assertSame('group_members_only', $p->checkNew($alice, 'group', 'knorke-e2e'), 'never getUsers(): inGroup(owner)');
        $this->h->share['excludeGroups'] = ['staff'];
        $p->reset();
        $this->assertSame('group_members_only', $p->checkNew($alice, 'user', 'bob'), 'the only common group is excluded');
        $this->assertSame('group_members_only', $p->checkNew($alice, 'group', 'staff'), 'an excluded group');
    }

    public function testSharingAndGroupAndTeamSwitches(): void {
        $alice = $this->owner();
        $this->h->share['allowGroupSharing'] = false;
        $this->assertSame('group_sharing_disabled', $this->h->sharePolicy->checkNew($alice, 'group', 'staff'));
        $this->assertSame('group_sharing_disabled', $this->h->sharePolicy->checkRaise($alice, 'group'), 'R13: raising a group share');
        $this->assertNull($this->h->sharePolicy->checkRaise($alice, 'user'));
        $this->assertNull($this->h->sharePolicy->checkRaise($alice, 'team'));
        $h = new AccessHarness();
        $h->teamSupport = false;
        $this->assertSame('teams_unavailable', $h->sharePolicy->checkNew($h->user('alice'), 'team', 'x'));
        $this->assertNull($h->sharePolicy->checkRaise($h->user('alice'), 'team'), 'R13: teams_unavailable only for new entries');
        $h = new AccessHarness();
        $h->share['shareApiEnabled'] = false;
        foreach (['user', 'group', 'team'] as $kind) {
            $this->assertSame('sharing_disabled', $h->sharePolicy->checkNew($h->user('alice'), $kind, 'bob'), $kind);
            $this->assertSame('sharing_disabled', $h->sharePolicy->checkRaise($h->user('alice'), $kind), $kind);
        }
        $h = new AccessHarness();
        $h->share['groupMembersOnly'] = true;
        $this->assertNull($h->sharePolicy->checkRaise($h->user('alice'), 'user'), 'R13: group_members_only only for new entries');
    }

    public function testCanonicalIds(): void {
        $p = $this->h->sharePolicy;
        $alice = $this->owner();
        $this->assertSame('bob', $p->canonical($alice, 'user', 'bob'));
        $this->assertSame('Knorke-E2E', $this->h->user('Knorke-E2E')->getUID(), 'the fake user manager keeps the spelling');
        $this->assertSame('knorke-e2e', $p->canonical($alice, 'group', 'KNORKE-E2E'), 'getGID(), not the typed spelling');
        $this->assertNull($p->canonical($alice, 'group', 'nope'));
        $this->h->teams = ['sId' => ['Nord', ['alice']]];
        $p->reset();
        $this->assertSame('sId', $p->canonical($alice, 'team', 'sId'));
        $this->assertNull($p->canonical($alice, 'team', 'SID'), 'singleIds are exact');
        $this->assertSame(['sId' => 'Nord'], $p->teams($alice));
        $this->assertSame('Nord', $p->displayName($alice, 'team', 'sId'));
        $this->assertSame('Bob Display', $p->displayName($alice, 'user', 'bob'));
        $this->assertSame('Staff', $p->displayName($alice, 'group', 'staff'));
    }

    public function testLinkPolicyMappingR13(): void {
        $p = $this->h->sharePolicy;
        $this->assertSame(['passwordEnforced' => false, 'expireDefaultDays' => null, 'expireEnforced' => false, 'expireMaxDays' => null], $p->linkPolicy(),
            'no default expiry: days (7 by default) are NOT handed out');
        $this->h->share['expireDefault'] = true;
        $this->h->share['expireDays'] = 14;
        $this->assertSame(['passwordEnforced' => false, 'expireDefaultDays' => 14, 'expireEnforced' => false, 'expireMaxDays' => null], $p->linkPolicy());
        $this->h->share['expireEnforced'] = true;
        $this->h->share['linkPassword'] = true;
        $this->assertSame(['passwordEnforced' => true, 'expireDefaultDays' => 14, 'expireEnforced' => true, 'expireMaxDays' => 14], $p->linkPolicy());
        $this->h->share['expireDefault'] = false;
        $this->assertSame(['passwordEnforced' => true, 'expireDefaultDays' => null, 'expireEnforced' => false, 'expireMaxDays' => null], $p->linkPolicy(),
            'Nextcloud: enforced only together with the default');
    }

    public function testTeamsOnlyWithSupportAndPerRequest(): void {
        $this->h->teams = ['t1' => ['One', ['bob']], 't2' => ['Two', ['carol']]];
        $bob = $this->h->user('bob');
        $this->assertSame(['t1'], $this->h->sharePolicy->teamsOf($bob));
        $this->assertSame(['t1'], $this->h->sharePolicy->teamsOf($bob));
        $this->assertSame(['bob'], $this->h->teamCalls, 'getTeamsForUser once per request');
        $h = new AccessHarness();
        $h->teams = $this->h->teams;
        $h->circlesFor['bob'] = false;
        $this->assertSame([], $h->sharePolicy->teamsOf($h->user('bob')));
        $this->assertSame([], $h->teamCalls, 'never asked without support');
        $this->assertSame(['knorke-e2e', 'staff'], $h->sharePolicy->groupIdsOf($h->user('bob')));
    }

    // ── Job 058: fresh groups in long-running CLI processes ────────────────
    // PHPUnit runs as CLI: $h->sharePolicy reads the group backends.

    public function testCliReadsGroupsPastNextcloudsCache(): void {
        $h = $this->h;
        $h->groupCache = true;
        $bob = $h->user('bob');
        $this->assertSame(['knorke-e2e', 'staff'], $h->groupManager->getUserGroupIds($bob), 'an earlier job filled the cache');
        $h->groups['knorke-e2e'] = ['carol'];
        $this->assertSame(['knorke-e2e', 'staff'], $h->groupManager->getUserGroupIds($bob), 'precondition: the fake manager really caches');
        $h->sharePolicy->reset();
        $before = count($h->groupReads);
        $this->assertSame(['staff'], $h->sharePolicy->groupIdsOf($bob), 'bob left knorke-e2e: the backend says so');
        $this->assertSame(['staff'], $h->sharePolicy->groupIdsOf($bob));
        $this->assertSame(['getUserGroups bob'], array_slice($h->groupReads, $before), 'once per request, never getUserGroupIds');
        // The other way round: dave joined after the cache said "no groups".
        $dave = $h->user('dave');
        $this->assertSame([], $h->groupManager->getUserGroupIds($dave));
        $h->groups['knorke-e2e'][] = 'dave';
        $h->sharePolicy->reset();
        $before = count($h->groupReads);
        $this->assertSame(['knorke-e2e'], $h->sharePolicy->groupIdsOf($dave));
        $this->assertSame(['getUserGroups dave'], array_slice($h->groupReads, $before));
        $this->assertSame([], $h->groupManager->getUserGroupIds($dave), "Nextcloud's cache still has the old answer");
    }

    public function testCliMergesTheBackendsLikeNextcloud(): void {
        $h = $this->h;
        // The middle backend answers null: without a closure (the fake's neutral
        // value, so its call cannot be counted) and with a counting closure; and [].
        foreach (['no closure' => false, 'null' => null, '[]' => []] as $label => $middle) {
            $asked = [];
            $backend = static function (string $name, array|null|false $answer) use (&$asked): GroupInterface {
                return Fake::of(GroupInterface::class, $answer === false ? [] : ['getUserGroups' => function ($uid) use (&$asked, $name, $answer): ?array {
                    $asked[] = "$name $uid";
                    return $answer;
                }]);
            };
            $groups = Fake::of(IGroupManager::class, [
                'getBackends' => fn (): array => [$backend('b1', ['g1', 'g2']), $backend('b2', $middle), $backend('b3', ['g3'])],
                'getUserGroupIds' => fn (IUser $u): array => throw new \LogicException('getUserGroupIds in a CLI process'),
            ]);
            $policy = new SharePolicy(Fake::of(ContainerInterface::class), $h->users, $groups, $h->apps, $h->logger);
            $this->assertSame(['g1', 'g2', 'g3'], $policy->groupIdsOf($h->user('bob')), "$label: in the order of getBackends(), the empty one skipped");
            $this->assertSame($middle === false ? ['b1 bob', 'b3 bob'] : ['b1 bob', 'b2 bob', 'b3 bob'], $asked, "$label: every backend asked once, with the uid");
        }
    }

    public function testWebKeepsNextcloudsGroupCache(): void {
        $h = $this->h;
        $h->groupCache = true;
        $policy = new class(Fake::of(ContainerInterface::class), $h->users, $h->groupManager, $h->apps, $h->logger) extends SharePolicy {
            protected function freshGroups(): bool {
                return false;
            }
        };
        $bob = $h->user('bob');
        $this->assertSame(['knorke-e2e', 'staff'], $policy->groupIdsOf($bob));
        $this->assertSame(['knorke-e2e', 'staff'], $policy->groupIdsOf($bob));
        $this->assertSame(['getUserGroupIds bob'], $h->groupReads, 'web: getUserGroupIds once per request, as before');
        $h->groups['knorke-e2e'] = ['carol'];
        $policy->reset();
        $this->assertSame(['knorke-e2e', 'staff'], $policy->groupIdsOf($bob), "Nextcloud's cache of the request");
        $this->assertSame(['getUserGroupIds bob', 'getUserGroupIds bob'], $h->groupReads, 'never a group backend');
    }
}
