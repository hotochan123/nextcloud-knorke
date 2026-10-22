<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IManager;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;

/**
 * Nextcloud's link-sharing policy for the board owner (SPEC-M0 §4.9.7,
 * review finding NC-5): IManager::shareApiAllowLinks($owner) decides for
 * the link, its guests and its members; nothing is revoked.
 */
final class LinkPolicyTest extends TestCase {
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

    // ── LinkPolicy itself ──────────────────────────────────────────────────

    public function testAsksTheShareManagerForTheOwnerOncePerRequest(): void {
        $asked = [];
        $resolved = 0;
        $looked = [];
        $user = static fn (string $uid): IUser => Fake::of(IUser::class, ['getUID' => fn (): string => $uid]);
        $manager = Fake::of(IManager::class, ['shareApiAllowLinks' => function (?IUser $u = null) use (&$asked): bool {
            $asked[] = $u?->getUID();
            return $u?->getUID() !== 'excluded';
        }]);
        $container = Fake::of(ContainerInterface::class, ['get' => function (string $id) use (&$resolved, $manager): mixed {
            $this->assertSame(IManager::class, $id);
            $resolved++;
            return $manager;
        }]);
        $users = Fake::of(IUserManager::class, ['get' => function (string $uid) use (&$looked, $user): ?IUser {
            $looked[] = $uid;
            return $uid === 'gone' ? null : $user($uid);
        }]);
        $policy = new LinkPolicy($container, $users);
        $this->assertSame(0, $resolved, 'the share manager is resolved lazily (fast path never builds it)');

        $this->assertTrue($policy->allows('alice'));
        $this->assertFalse($policy->allows('excluded'), 'group exclusion of the OWNER decides');
        $this->assertTrue($policy->allows('alice'));
        $this->assertSame(['alice', 'excluded'], $asked, 'never with null (= the session user), once per owner');
        $this->assertSame(['alice', 'excluded'], $looked);
        $this->assertSame(1, $resolved);

        $this->assertTrue($policy->allows('bob', $user('bob')), 'a known IUser saves the lookup');
        $this->assertSame(['alice', 'excluded'], $looked);
        $policy->allows('carol', $user('alice'));
        $this->assertSame(['alice', 'excluded', 'carol'], $looked, 'a known IUser of somebody else is not used');
        $this->assertSame('carol', $asked[count($asked) - 1]);

        $this->assertFalse($policy->allows('gone'), 'an owner that no longer exists: no links');
        $this->assertNotContains(null, $asked);
    }

    // ── Access ─────────────────────────────────────────────────────────────

    public function testMembersAndGuestsLoseAccessAndGetItBack(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 4, 1, 1);
        $token = $this->h->link($b);
        $linkId = $this->h->boards->activeLinkOf($b)['id'];
        $this->h->boards->addMember($b, 'bob', 'edit', $linkId, 0);
        $this->h->boards->addMember($b, 'carol', 'edit', null, 0);
        $guest = $this->h->token($b, 1);
        $this->h->linksAllowed['alice'] = false;

        // Owner: unaffected; the gens carry the policy (links = false).
        $this->assertSame(Role::Owner, $this->h->access->forUser($b)->principal->role);
        $this->assertSame(['acl' => 1, 'link' => 1, 'minRev' => 0, 'links' => false, 'voteLink' => 1, 'gone' => false], $this->h->cache->getGens($b));
        $this->assertSame(Role::Owner, $this->h->access->forUser($b)->principal->role, 'owner fast path');

        // A link member: 404 like a stranger; an explicit member (M1) keeps access.
        $this->h->uid = 'bob';
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUserWithRow($b));
        $this->h->uid = 'carol';
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role);

        // Guests: fast path (gens cached) and full path.
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->forGuest($guest, $b));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->forGuestWithRow($guest, $b));
        $this->h->mem->data = [];
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->forGuest($guest, $b));
        $this->assertFalse($this->h->cache->getGens($b)['links'], 'the full path seeds links = 0');
        // A rotated link wins over the policy (permanent beats temporary).
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->access->forGuest($this->h->token($b, 0), $b));

        // Joining: 403 before a name, a limiter slot or a token.
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->joinGuest($token, '', null, '10.0.0.9'));
        $this->assertSame([], $this->h->limiterCalls);
        $this->assertSame([], $this->h->throttleCalls, 'a known link is never a miss');

        // Allowed again: nothing was revoked, the next full check restores everything.
        $this->h->linksAllowed['alice'] = true;
        $this->h->mem->data = [];
        $this->assertSame(Role::Edit, $this->h->access->forGuest($guest, $b)->principal->role, 'the old guest token works again');
        $this->h->uid = 'bob';
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role, 'the link member is back');
        $this->assertSame('Gina', $this->h->access->joinGuest($token, 'Gina', null, '10.0.0.9')[0]->principal->displayName);
    }

    public function testFastPathTrustsAMemberGrantOnlyWhileLinksAreAllowed(): void {
        $b = $this->h->boards->addBoard('alice');
        $this->h->link($b);
        $this->h->boards->addMember($b, 'bob', 'edit', $this->h->boards->activeLinkOf($b)['id'], 0);
        $this->h->uid = 'bob';
        $this->h->access->forUser($b);
        $this->h->boards->log = [];
        $this->h->access->forUser($b);
        $this->assertSame([], $this->h->boards->log, 'fast path while allowed');

        // The admin forbids links. The cached gens (links = 1) lag up to their
        // TTL (120 s): until then the grant still counts.
        $this->h->linksAllowed['alice'] = false;
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role);
        // Gens renewed (expired, or any revocation's setGens): links = 0 → full check → 404.
        $gens = $this->h->cache->getGens($b);
        $this->h->cache->setGens($b, $gens['acl'], $gens['link'], $gens['minRev'], false, $gens['voteLink']);
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
        $this->assertContains('findBoardForUser', $this->h->boards->log, 'the member grant was not trusted');
        $this->h->uid = 'alice';
        $this->h->boards->log = [];
        $this->h->access->forUser($b);
        $this->h->access->forUser($b);
        $this->assertSame(['findBoardForUser'], $this->h->boards->log, 'the owner grant stays on the fast path');
    }

    // ── BoardService ───────────────────────────────────────────────────────

    public function testBoardServiceRefusesLinksButRevokesNothing(): void {
        $b = $this->h->service->create('alice', 'A')['id'];
        $l1 = $this->h->service->enableLink('alice', $b, 'edit', []);
        $this->assertSame($b, $this->h->service->joinLinkAsUser('bob', $l1['token']));
        $this->h->linksAllowed['alice'] = false;

        $this->expectHttp(403, 'links_disabled', fn () => $this->h->service->enableLink('alice', $b, 'edit', []));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->service->enableLink('alice', $b, 'edit', ['rotate' => true]));
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->enableLink('carol', $b, 'edit', []));
        // A link member is a stranger now (404, not 403 forbidden).
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->enableLink('bob', $b, 'edit', []));
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->rename('bob', $b, 'X'));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->service->joinLinkAsUser('dave', $l1['token']));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->service->joinLinkAsUser('bob', $l1['token']));
        $this->assertSame($b, $this->h->service->joinLinkAsUser('alice', $l1['token']), 'the owner still reaches its board');
        $this->assertArrayNotHasKey('dave', $this->h->boards->members[$b], 'no member row');

        $this->assertSame([], $this->h->service->listFor('bob'), 'the board leaves the member list');
        $mine = $this->h->service->listFor('alice');
        $this->assertSame([[$b, false]], array_map(static fn (array $x): array => [$x['id'], $x['linksAllowed']], $mine));
        $this->assertFalse($this->h->service->linksAllowed('alice'));

        $this->assertNull($this->h->boards->links[1]['revoked_at'], 'the link row stays active');
        $this->assertSame('bob', array_key_first($this->h->boards->members[$b]), 'the member row stays');
        $this->assertSame(1, $this->h->boards->boards[$b]['link_gen'], 'guest tokens stay valid for later');

        // Switching the link off still works, and the gens say links = 0.
        $this->h->service->disableLink('alice', $b, 'edit');
        $this->assertFalse($this->h->cache->getGens($b)['links']);
        $this->assertNotNull($this->h->boards->links[1]['revoked_at']);
    }

    public function testAllowedAgainRestoresLinkAndMembers(): void {
        $b = $this->h->service->create('alice', 'A')['id'];
        $l1 = $this->h->service->enableLink('alice', $b, 'edit', []);
        $this->h->service->joinLinkAsUser('bob', $l1['token']);
        $this->h->linksAllowed['alice'] = false;
        $this->assertSame([], $this->h->service->listFor('bob'));
        $this->h->linksAllowed['alice'] = true;
        $this->assertSame([[$b, true, true]], array_map(static fn (array $x): array => [$x['id'], $x['viaLink'], $x['linksAllowed']], $this->h->service->listFor('bob')));
        $this->assertSame($l1, $this->h->service->enableLink('alice', $b, 'edit', []), 'the same link again');
        $this->assertSame($b, $this->h->service->joinLinkAsUser('carol', $l1['token']));
    }
}
