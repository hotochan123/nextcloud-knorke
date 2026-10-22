<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCP\AppFramework\Http\JSONResponse;
use PHPUnit\Framework\TestCase;

/** Board administration (SPEC-M0 §4.3, §4.10.4; SPEC-M1 §4.13.4 rename) on the in-memory store. */
final class BoardServiceTest extends TestCase {
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

    public function testCreateAndList(): void {
        $board = $this->h->service->create('alice', '  Retro KW41 ');
        $this->assertSame(['id', 'title', 'role', 'updatedAt', 'owner', 'viaLink', 'linksAllowed', 'source', 'mod'], array_keys($board));
        $this->assertSame(['own', true], [$board['source'], $board['mod']]);
        $this->assertTrue($board['linksAllowed']);
        $this->assertSame(['Retro KW41', 'owner', ['uid' => 'alice', 'name' => 'Alice Display'], false], [$board['title'], $board['role'], $board['owner'], $board['viaLink']]);
        $this->expectHttp(400, 'title_required', fn () => $this->h->service->create('alice', '   '));
        $this->expectHttp(400, 'bad_request', fn () => $this->h->service->create('alice', "a\x07b"));
        $this->expectHttp(400, 'bad_request', fn () => $this->h->service->create('alice', str_repeat('x', 201)));
        $other = $this->h->service->create('bob', 'Bobs');
        $this->h->link($other['id']);
        $this->h->boards->addMember($other['id'], 'alice', 'edit', $this->h->boards->activeLinkOf($other['id'])['id'], 0);
        $list = $this->h->service->listFor('alice');
        $this->assertSame([$other['id'], $board['id']], array_column($list, 'id'), 'updated_at DESC, id DESC');
        $this->assertSame(['edit', true], [$list[0]['role'], $list[0]['viaLink']]);
        $this->assertSame([], $this->h->service->listFor('carol'));
    }

    public function testRenameAndDeleteOwnerOnly(): void {
        $b = $this->h->service->create('alice', 'A')['id'];
        $this->h->boards->addMember($b, 'bob', 'edit', null, 0);
        $this->expectHttp(403, 'forbidden', fn () => $this->h->service->rename('bob', $b, 'X'));
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->rename('carol', $b, 'X'));
        $this->assertSame('B', $this->h->service->rename('alice', $b, 'B')['title']);
        $this->expectHttp(403, 'forbidden', fn () => $this->h->service->delete('bob', $b));
        $token = $this->h->service->enableLink('alice', $b, 'edit', [])['token'];
        $this->h->service->delete('alice', $b);
        $this->assertArrayNotHasKey($b, $this->h->boards->boards);
        $this->assertTrue($this->h->cache->getGens($b)['gone'], 'markGone after COMMIT');
        $link = $this->h->boards->findLinkByToken($token);
        $this->assertNotNull($link['revoked_at'], 'links stay, revoked');
        $this->assertNull($link['board']);
        $this->assertContains('lockBoard acl-', $this->h->boards->log, 'lock first, acl + 1');
    }

    public function testLinkLifecycle(): void {
        $b = $this->h->service->create('alice', 'A')['id'];
        $l1 = $this->h->service->enableLink('alice', $b, 'edit', []);
        $this->assertSame(['token', 'role', 'url', 'password', 'expiresAt', 'expiresOn'], array_keys($l1));
        $this->assertSame([false, null, null], [$l1['password'], $l1['expiresAt'], $l1['expiresOn']]);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9]{24}\z/', $l1['token']);
        $this->assertSame('https://cloud.example/index.php/apps/knorke/p/' . $l1['token'], $l1['url']);
        $this->assertSame($l1, $this->h->service->enableLink('alice', $b, 'edit', []), 'existing link returned');
        $this->assertSame(1, $this->h->boards->boards[$b]['link_gen'], 'creating bumps nothing');

        // bob joins through the link.
        $this->assertSame($b, $this->h->service->joinLinkAsUser('bob', $l1['token']));
        $this->assertSame(['role' => 'edit', 'link_id' => 1], $this->h->boards->members[$b]['bob']);
        $this->assertSame($b, $this->h->service->joinLinkAsUser('bob', $l1['token']), 'already a member: no change');
        $this->assertSame($b, $this->h->service->joinLinkAsUser('alice', $l1['token']), 'owner: no change');
        $this->assertArrayNotHasKey('alice', $this->h->boards->members[$b]);

        $l2 = $this->h->service->enableLink('alice', $b, 'edit', ['rotate' => true]);
        $this->assertNotSame($l1['token'], $l2['token']);
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$b], 'link members lose access');
        $this->assertSame(['acl' => 2, 'link' => 2, 'minRev' => 0, 'links' => true, 'voteLink' => 1, 'gone' => false], $this->h->cache->getGens($b), 'setGens after COMMIT');
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->service->joinLinkAsUser('bob', $l1['token']));
        $this->assertSame([], $this->h->throttleCalls, 'a revoked token is no miss');

        $this->h->service->disableLink('alice', $b, 'edit');
        $this->assertNull($this->h->boards->activeLinkOf($b));
        $this->assertSame(['acl' => 3, 'link' => 3, 'minRev' => 0, 'links' => true, 'voteLink' => 1, 'gone' => false], $this->h->cache->getGens($b));
        $this->assertSame(1, $this->h->boards->boards[$b]['vote_link_gen'], 'the edit link never bumps the voting link');
        $this->h->service->disableLink('alice', $b, 'edit');
        $this->assertSame(3, $this->h->boards->boards[$b]['acl_gen'], 'no link → nothing to revoke');
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->joinLinkAsUser('bob', 'Nn3dEf6hIj9kLm2nOp5qRs8t'));
        $this->assertSame(['check', 'register', 'check'], $this->h->throttleCalls);
    }

    public function testJoinTakesTheBoardLockAndRereadsTheLink(): void {
        // T4: the membership is written under the board row lock, after the
        // link was read again under it.
        $b = $this->h->service->create('alice', 'A')['id'];
        $l1 = $this->h->service->enableLink('alice', $b, 'edit', []);
        $this->h->boards->log = [];
        $this->assertSame($b, $this->h->service->joinLinkAsUser('bob', $l1['token']));
        $this->assertSame(['findLinkByToken', 'lockBoard --', 'findLinkByToken', 'findBoardForUser', 'deleteMember bob', 'addMember bob'], $this->h->boards->log);
        $this->h->boards->log = [];
        $this->assertSame($b, $this->h->service->joinLinkAsUser('bob', $l1['token']));
        $this->assertSame(['findLinkByToken', 'lockBoard --', 'findLinkByToken', 'findBoardForUser'], $this->h->boards->log, 'a re-join writes nothing');

        // A rotation commits while carol's join waits for the lock: 403, no row.
        $this->h->boards->onLock = function () use ($b): void {
            $this->h->service->enableLink('alice', $b, 'edit', ['rotate' => true]);
        };
        $this->expectHttp(403, 'link_revoked', fn () => $this->h->service->joinLinkAsUser('carol', $l1['token']));
        $this->assertArrayNotHasKey('carol', $this->h->boards->members[$b] ?? [], 'no member row on a revoked link');
        $this->assertArrayNotHasKey('bob', $this->h->boards->members[$b] ?? [], 'the rotation removed bob');
        $this->assertSame([], $this->h->service->listFor('carol'));

        // A row left on a revoked link grants nothing, and joining the active link replaces it.
        $l2 = $this->h->boards->activeLinkOf($b);
        $this->h->boards->members[$b]['dave'] = ['role' => 'edit', 'link_id' => 1];
        $this->assertNull($this->h->boards->findBoardForUser($b, 'dave')['member_role']);
        $this->assertSame([], $this->h->service->listFor('dave'));
        $this->assertSame($b, $this->h->service->joinLinkAsUser('dave', $l2['token']));
        $this->assertSame(['role' => 'edit', 'link_id' => $l2['id']], $this->h->boards->members[$b]['dave']);
        $this->assertSame([[$b, 'edit', true]], array_map(static fn ($x) => [$x['id'], $x['role'], $x['viaLink']], $this->h->service->listFor('dave')));

        // The owner never becomes a member; a board deleted meanwhile is 404.
        $this->assertSame($b, $this->h->service->joinLinkAsUser('alice', $l2['token']));
        $this->assertArrayNotHasKey('alice', $this->h->boards->members[$b]);
        $this->h->boards->onLock = function (int $board): void {
            unset($this->h->boards->boards[$board]);
        };
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->joinLinkAsUser('erin', $l2['token']));
    }

    public function testRenameRunsThroughTheMetaWritePath(): void {
        // SPEC-M1 §4.13.4 (fixes M0 F7, rename without rev): lock first, rev + 1,
        // meta_rev = the new rev, bumpRev after COMMIT — open clients see the
        // title in their next tick. Owner check before, meta untouched.
        $b = $this->h->service->create('alice', 'A')['id'];
        $this->h->boards->boards[$b]['rev'] = 41;
        $this->h->boards->boards[$b]['meta'] = '{"timer":{"state":"paused"}}';
        $this->h->cache->seedRev($b, 41);
        $this->h->boards->log = [];
        $this->h->tx = [];
        $board = $this->h->service->rename('alice', $b, '  Retro KW41 ');
        $this->assertSame(['Retro KW41', 'owner'], [$board['title'], $board['role']], 'the M0 board object (route 7)');
        $this->assertSame(['findBoardForUser', 'lockBoard --', 'meta', 'writeMeta title', 'findBoardForUser'], $this->h->boards->log, 'owner check, then lock FIRST in the transaction');
        $this->assertSame(['begin', 'commit'], $this->h->tx);
        $row = $this->h->boards->boards[$b];
        $this->assertSame([42, 42, 'Retro KW41', '{"timer":{"state":"paused"}}'], [$row['rev'], $row['meta_rev'], $row['title'], $row['meta']]);
        $this->assertSame(42, $this->h->cache->getRev($b), 'bumpRev after COMMIT');
        $this->assertSame(1, $row['acl_gen'], 'no generation bump');
        // Strangers 404, members 403, nothing written.
        $this->h->boards->addMember($b, 'bob', 'edit', null, 0);
        $this->expectHttp(403, 'forbidden', fn () => $this->h->service->rename('bob', $b, 'X'));
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->rename('carol', $b, 'X'));
        $this->expectHttp(400, 'title_required', fn () => $this->h->service->rename('alice', $b, ' '));
        $this->assertSame(42, $this->h->boards->boards[$b]['rev']);
        // The board vanishes while the rename waits for the lock: 404, nothing bumped.
        $this->h->boards->onLock = function (int $board): void {
            unset($this->h->boards->boards[$board]);
        };
        $this->expectHttp(404, 'not_found', fn () => $this->h->service->rename('alice', $b, 'Y'));
        $this->assertSame(42, $this->h->cache->getRev($b));
    }

    public function testRenameAnswerCarriesMetaAndMetaRev(): void {
        // SPEC-M1 §15 (R4): the rename answer (route 7) is the board object plus
        // meta and metaRev of the meta write, additive — every key of the M0
        // board object stays — so the renaming tab takes the onMeta path at once.
        $b = $this->h->service->create('alice', 'A')['id'];
        $this->h->boards->boards[$b]['rev'] = 41;
        $board = $this->h->service->rename('alice', $b, 'B');
        $this->assertSame(['id', 'title', 'role', 'updatedAt', 'owner', 'viaLink', 'linksAllowed', 'source', 'mod', 'meta', 'metaRev'], array_keys($board));
        $row = $this->h->boards->boards[$b];
        $this->assertSame([42, 42, null], [$row['rev'], $row['meta_rev'], $row['meta']], 'rev + 1 = meta_rev; an empty map is stored as NULL');
        $this->assertSame(42, $board['metaRev'], 'metaRev = the new rev');
        $this->assertSame(['B', 'owner', ['uid' => 'alice', 'name' => 'Alice Display'], false, true, $b], [$board['title'], $board['role'], $board['owner'], $board['viaLink'], $board['linksAllowed'], $board['id']]);
        $this->assertEquals(new \stdClass(), $board['meta']);
        // On the wire (route 7 answers through JSONResponse): an empty map is {}, never [].
        $json = (new JSONResponse(['board' => $board]))->render();
        $this->assertStringEndsWith(',"meta":{},"metaRev":42}}', $json);
        $this->assertSame(['title' => 'B', 'metaRev' => 42], array_intersect_key(json_decode($json, true)['board'], ['title' => 0, 'metaRev' => 0]));

        // A stored map comes back as stored (rename leaves meta alone).
        $this->h->boards->boards[$b]['meta'] = '{"timer":{"state":"paused","ms":60000}}';
        $board = $this->h->service->rename('alice', $b, 'C');
        $this->assertSame([['timer' => ['state' => 'paused', 'ms' => 60000]], 43], [$board['meta'], $board['metaRev']]);
        $this->assertSame('{"timer":{"state":"paused","ms":60000}}', $this->h->boards->boards[$b]['meta']);
        $this->assertStringEndsWith(',"meta":{"timer":{"state":"paused","ms":60000}},"metaRev":43}}', (new JSONResponse(['board' => $board]))->render());
    }

    public function testRenameAnswerPairsTitleAndMetaRevOfItsOwnWrite(): void {
        // Another rename commits between this write and the re-read of the row
        // for the board object: title, meta and metaRev of the answer still come
        // from THIS write (one consistent triple, like sync's `board`), never the
        // newer title with this write's rev.
        $b = $this->h->service->create('alice', 'A')['id'];
        $this->h->boards->boards[$b]['rev'] = 41;
        $this->h->boards->log = [];
        $this->h->boards->onFindForUser = function (int $board): void {
            if (in_array('writeMeta title', $this->h->boards->log, true)) {
                $this->h->boards->onFindForUser = null;
                $this->h->boards->writeMeta($board, 'Other', '{"summon":{"x":1}}', 0);
            }
        };
        $board = $this->h->service->rename('alice', $b, 'Mine');
        $this->assertSame(['findBoardForUser', 'lockBoard --', 'meta', 'writeMeta title', 'findBoardForUser', 'writeMeta title'], $this->h->boards->log, 'the other rename landed between write and re-read');
        $this->assertSame([43, 'Other'], [$this->h->boards->boards[$b]['meta_rev'], $this->h->boards->boards[$b]['title']]);
        $this->assertSame(['Mine', 42], [$board['title'], $board['metaRev']]);
        $this->assertEquals(new \stdClass(), $board['meta'], 'meta of this write, not the later one');
    }

    public function testUserDeleted(): void {
        $own = $this->h->service->create('alice', 'Mine')['id'];
        $theirs = $this->h->service->create('bob', 'Bobs')['id'];
        $this->h->boards->addMember($theirs, 'alice', 'edit', null, 0);
        $this->h->service->onUserDeleted('alice');
        $this->assertArrayNotHasKey($own, $this->h->boards->boards);
        $this->assertTrue($this->h->cache->getGens($own)['gone']);
        $this->assertArrayNotHasKey('alice', $this->h->boards->members[$theirs] ?? []);
        $this->assertSame(2, $this->h->boards->boards[$theirs]['acl_gen']);
        $this->assertSame(2, $this->h->cache->getGens($theirs)['acl']);
    }
}
