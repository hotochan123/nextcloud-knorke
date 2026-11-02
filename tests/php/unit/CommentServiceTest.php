<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\CommentService;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use PHPUnit\Framework\TestCase;

/**
 * Comments in Nextcloud's comment store (factory job 189) through
 * CommentService over a fake ICommentsManager (FakeComments: Nextcloud's
 * own OC\Comments\Comment, rows in memory): what is stored (AK1), the
 * meta.comments counter and metaRev (AK3), deleting a thread (AK4),
 * mentions and the notifications they send (AK5), the @ list of route 39,
 * the parts of a text and what a guest reads.
 */
final class CommentServiceTest extends TestCase {
    private const NOW = 1_760_000_000_123;
    private const IP = '10.0.0.7';
    private const N = '01JA00000000000000000000N1';
    private const C = '01JA00000000000000000000C1';
    private const D = '01JA00000000000000000000D1';
    private const F = '01JA00000000000000000000F1';
    private const M = '01JA00000000000000000000M1';
    private const MR = 'n00000000';
    private const MA = 'n10000000';

    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'Retro')['id'];
        $this->h->items->addBoard($this->b);
        $this->h->items->seed($this->b, self::N, ['t' => 'sticky'], 1);
        $this->h->items->seed($this->b, self::F, ['t' => 'frame', 'w' => 800, 'h' => 600], 1);
        $this->h->items->seed($this->b, self::C, ['t' => 'connector', 'data' => ['start' => ['item' => self::N], 'end' => ['item' => self::F]]], 1);
        $this->h->items->seed($this->b, self::D, ['t' => 'sticky'], 1, true);
        $this->h->items->seed($this->b, self::M, ['t' => 'mindmap', 'data' => ['nodes' => [
            'b0' => [self::MR => ['o' => 'i0']], 'b1' => [self::MA => ['o' => 'i0', 'p' => self::MR]],
        ]]], 1);
    }

    private function user(string $uid): Principal {
        $this->h->uid = $uid;
        return $this->h->access->forUser($this->b, true)->principal;
    }

    private function guest(string $role = 'edit', string $gid = 'gAAAAAAAAAAA'): Principal {
        return $this->h->access->forGuest($this->h->token($this->b, 1, $role, $gid), $this->b, true)->principal;
    }

    private function svc(): CommentService {
        return $this->h->commentService;
    }

    private function thread(Principal $p, string $text, array $more = []): array {
        return $this->svc()->create($p, $this->b, $more + ['text' => $text, 'x' => 100.5, 'y' => -20, 'item' => self::N], self::IP, self::NOW)['thread'];
    }

    private function reply(Principal $p, string $thread, string $text): array {
        return $this->svc()->create($p, $this->b, ['text' => $text, 'thread' => $thread], self::IP, self::NOW + 1000)['thread'];
    }

    /** @return array{0: array, 1: int} [meta, metaRev] as stored */
    private function meta(): array {
        $row = $this->h->boards->boards[$this->b];
        return [MetaService::decode($row['meta']), $row['meta_rev']];
    }

    /** "<verb> <user> <object type> <object id> <subject>" of the comment notifications (markProcessed without a user: "-"). */
    private function notes(): array {
        $out = [];
        foreach ($this->h->notifyLog as $line) {
            if (preg_match('/^(notify|markProcessed) (\S*) (comment\S*) (\S+) (comment_\w+)/', $line, $m) === 1) {
                $out[] = $m[1] . ' ' . ($m[2] === '' ? '-' : $m[2]) . ' ' . $m[3] . ' ' . $m[4] . ' ' . $m[5];
            }
        }
        return $out;
    }

    private function assertError(int $status, string $code, callable $fn, string $label = ''): void {
        try {
            $fn();
            $this->fail("HttpError $status $code expected $label");
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error], $label);
        }
    }

    // ── AK1: the store ──────────────────────────────────────────────────────

    public function testANewThreadIsStoredInNextcloudsCommentStoreWithTheKnorkeMetaData(): void {
        $t = $this->thread($this->user('alice'), "  Hello\r\nworld  ");
        $row = $this->h->comments->rows[$t['id']];
        $this->assertSame(['knorke_board', (string)$this->b, 'comment', 'users', 'alice', '0'],
            [$row->getObjectType(), $row->getObjectId(), $row->getVerb(), $row->getActorType(), $row->getActorId(), $row->getParentId()]);
        $this->assertSame("Hello\nworld", $row->getMessage());
        $this->assertSame(['knorke' => ['name' => null, 'edited' => null, 'mentions' => [], 'item' => self::N, 'x' => 100.5, 'y' => -20, 'resolved' => false]],
            $row->getMetaData(), 'meta_data only under the key knorke (Nextcloud json_encodes it: -20.0 reads back as -20)');
        $this->assertSame(self::N, $t['item']);
        $this->assertSame([100.5, -20.0, false], [$t['x'], (float)$t['y'], $t['resolved']]);
        $c = $t['comments'][0];
        $this->assertSame(['Alice Display', false, true, ["Hello\nworld"], 1_760_000_000_000, null, "Hello\nworld"],
            [$c['name'], $c['guest'], $c['mine'], $c['parts'], $c['at'], $c['edited'], $c['raw']]);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $c['pid']);
        $this->assertEquals(new \stdClass(), $c['mentions']);
        $this->assertSame([], array_values(array_diff(array_keys($this->h->comments->rows), [$t['id']])), 'one row');
    }

    public function testTheParentOfAReplyIsTheFirstComment(): void {
        $t = $this->thread($this->user('alice'), 'First');
        $this->reply($this->user('alice'), $t['id'], 'Second');
        $after = $this->reply($this->user('alice'), $t['id'], 'Third');
        $this->assertCount(3, $after['comments']);
        foreach (array_slice($after['comments'], 1) as $c) {
            $this->assertSame($t['id'], $this->h->comments->rows[$c['id']]->getParentId(), 'every reply hangs on the first comment');
            $this->assertSame(['name' => null, 'edited' => null, 'mentions' => []], $this->h->comments->knorke($c['id']), 'a reply has no spot');
        }
        $this->assertSame(['First', 'Second', 'Third'], array_map(static fn (array $c): string => $c['parts'][0], $after['comments']), 'ascending');
        $this->assertError(404, 'not_found', fn () => $this->reply($this->user('alice'), $after['comments'][1]['id'], 'reply to a reply'));
    }

    public function testAGuestStoresItsGidAndName(): void {
        $t = $this->thread($this->guest('vote', 'gGINA0000001'), 'From a guest');
        $row = $this->h->comments->rows[$t['id']];
        $this->assertSame(['knorke_guests', 'gGINA0000001'], [$row->getActorType(), $row->getActorId()]);
        $this->assertSame('Gina', $this->h->comments->knorke($t['id'])['name']);
        $c = $t['comments'][0];
        $this->assertSame(['Gina', true, true], [$c['name'], $c['guest'], $c['mine']]);
        $this->assertArrayNotHasKey('raw', $c, 'raw and mentions only for an account');
        $this->assertArrayNotHasKey('mentions', $c);
    }

    public function testAnItemThatIsNoLiveItemOfTheFiveTypesGivesAFreeThread(): void {
        $p = $this->user('alice');
        foreach ([self::D => 'deleted', self::C => 'connector', '01JA00000000000000000000Z9' => 'unknown', 'not-an-id' => 'no ULID'] as $item => $why) {
            $t = $this->thread($p, $why, ['item' => $item]);
            $this->assertNull($t['item'], $why);
            $this->assertSame([100.5, -20.0], [$t['x'], (float)$t['y']], "$why: free at x/y");
        }
        $this->assertSame(self::F, $this->thread($p, 'frame', ['item' => self::F])['item'], 'a frame carries a thread');
        $this->assertNull($this->svc()->create($p, $this->b, ['text' => 'no item', 'x' => 1, 'y' => 2], self::IP, self::NOW)['thread']['item']);
    }

    public function testAThreadOnAMindMapNodeKeepsTheNode(): void {
        // Job 195 (AK2): node is stored when the item is a live mind map with that node; else null
        $p = $this->user('alice');
        $t = $this->thread($p, 'on A', ['item' => self::M, 'node' => self::MA]);
        $this->assertSame([self::M, self::MA], [$t['item'], $t['node']]);
        $this->assertSame(self::MA, $this->h->comments->knorke($t['id'])['node']);
        $this->assertNull($this->thread($p, 'unknown node', ['item' => self::M, 'node' => 'n20000000'])['node']);
        $this->assertNull($this->thread($p, 'no node form', ['item' => self::M, 'node' => 'root'])['node']);
        $sticky = $this->thread($p, 'a note', ['item' => self::N, 'node' => self::MA]);
        $this->assertSame([self::N, null], [$sticky['item'], $sticky['node']], 'only a mind map has nodes');
        $this->assertArrayNotHasKey('node', $this->h->comments->knorke($sticky['id']));
        $this->assertSame([self::M, null], [$this->thread($p, 'the whole map', ['item' => self::M])['item'], $this->thread($p, 'x', ['item' => self::M])['node']]);
        $this->assertNull($this->thread($p, 'plain')['node'], 'every other thread names no node');
        $this->assertError(400, 'bad_request', fn () => $this->thread($p, 'bad', ['item' => self::M, 'node' => 5]), 'node no string');
        $this->assertError(400, 'bad_request', fn () => $this->svc()->create($p, $this->b, ['text' => 'r', 'thread' => $t['id'], 'node' => self::MA], self::IP, self::NOW), 'a reply with node');
        // the reload keeps it
        $this->assertSame(self::MA, $this->svc()->thread($p, $this->b, $t['id'])['node']);
    }

    // ── AK3: meta.comments and metaRev ──────────────────────────────────────

    public function testEveryEffectiveWriteRaisesMetaCommentsAndMetaRevByOne(): void {
        [$meta, $rev0] = $this->meta();
        $this->assertArrayNotHasKey('comments', $meta, 'missing while there were never comments');
        $p = $this->user('alice');
        $t = $this->thread($p, 'One');
        [$meta, $rev] = $this->meta();
        $this->assertSame([1, $rev0 + 1], [$meta['comments'], $rev]);
        $this->assertSame($rev, $this->h->cache->getRev($this->b), 'bumpRev after the COMMIT');
        $id = $t['id'];
        $writes = [
            'reply' => fn () => $this->reply($p, $id, 'Two'),
            'edit' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'text' => 'One!'], self::IP, self::NOW),
            'resolve' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'resolved' => true], self::IP, self::NOW),
            'spot' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'x' => 5, 'y' => 6], self::IP, self::NOW),
            'reopen' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'resolved' => false], self::IP, self::NOW),
        ];
        $n = 1;
        foreach ($writes as $what => $fn) {
            $fn();
            [$meta, $now] = $this->meta();
            $this->assertSame([++$n, $rev + 1], [$meta['comments'], $now], $what);
            $rev = $now;
        }
        $this->h->tx = [];
        $none = [
            'resolve twice' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'resolved' => false], self::IP, self::NOW),
            'same text' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'text' => 'One!'], self::IP, self::NOW),
            'same spot' => fn () => $this->svc()->update($p, $this->b, ['comment' => $id, 'x' => 5.0, 'y' => 6], self::IP, self::NOW),
        ];
        foreach ($none as $what => $fn) {
            $saves = count($this->h->comments->log);
            $answer = $fn();
            $this->assertSame([$n, $rev], [$this->meta()[0]['comments'], $this->meta()[1]], "$what: no write, metaRev stays");
            $this->assertSame($saves, count($this->h->comments->log), "$what: nothing saved");
            $this->assertSame($id, $answer['thread']['id'], "$what: the stored thread is the answer");
        }
        $this->assertSame(['begin', 'commit', 'begin', 'commit', 'begin', 'commit'], $this->h->tx, 'one transaction each');
        $this->svc()->delete($p, $this->b, $id, self::IP, self::NOW);
        [$meta, $now] = $this->meta();
        $this->assertSame([$n + 1, $rev + 1], [$meta['comments'], $now], 'delete');
    }

    public function testTheBoardIsLockedFirstAndAGoneBoardIs404(): void {
        $p = $this->user('alice');
        $this->h->boards->log = [];
        $this->thread($p, 'x');
        $this->assertSame('lockBoard --', $this->h->boards->log[0], 'lockBoard is the first statement of the write');
        $this->h->boards->onLock = function (int $b): void {
            unset($this->h->boards->boards[$b]);
        };
        $this->assertError(404, 'not_found', fn () => $this->thread($p, 'y'), 'deleted while waiting for the lock');
    }

    // ── AK4: deleting ───────────────────────────────────────────────────────

    public function testDeletingTheFirstCommentRemovesEveryCommentOfTheThreadRepliesFirst(): void {
        $p = $this->user('alice');
        $t = $this->thread($p, 'Root');
        $r1 = $this->reply($p, $t['id'], 'R1')['comments'][1]['id'];
        $r2 = $this->reply($p, $t['id'], 'R2')['comments'][2]['id'];
        $other = $this->thread($p, 'Other')['id'];
        $this->h->comments->log = [];
        $this->h->notifyLog = [];
        $out = $this->svc()->delete($p, $this->b, $t['id'], self::IP, self::NOW);
        $this->assertSame(['deleted' => [$r1, $r2, $t['id']]], $out);
        $this->assertSame(["delete $r1", "delete $r2", 'delete ' . $t['id']], $this->h->comments->log, 'one row at a time, the replies first');
        $this->assertSame([$other], array_map('strval', array_keys($this->h->comments->rows)));
        $this->assertSame([
            "markProcessed - comment $r1 comment_mention", "markProcessed - comment $r2 comment_mention", 'markProcessed - comment ' . $t['id'] . ' comment_mention',
            'markProcessed - comment_thread ' . $t['id'] . ' comment_reply',
        ], $this->notes());
        // a reply alone
        $o = $this->reply($p, $other, 'Reply')['comments'][1]['id'];
        $this->assertSame(['deleted' => [$o]], $this->svc()->delete($p, $this->b, $o, self::IP, self::NOW));
        $this->assertSame([$other], array_map('strval', array_keys($this->h->comments->rows)));
    }

    public function testBoardDeleteAndAccountDeletionDeleteTheCommentsAtTheObject(): void {
        $this->thread($this->user('alice'), 'Bye');
        $this->h->service->delete('alice', $this->b);
        $this->assertContains("deleteCommentsAtObject knorke_board {$this->b}", $this->h->comments->log);
        $this->assertSame([], $this->h->comments->rows);
        $this->assertSame('commit', end($this->h->tx), 'inside the delete transaction');
        // account deletion: every board of the account goes the same way
        $b2 = $this->h->service->create('alice', 'Second')['id'];
        $b3 = $this->h->service->create('alice', 'Third')['id'];
        $this->h->comments->log = [];
        $this->h->service->onUserDeleted('alice');
        $this->assertSame(["deleteCommentsAtObject knorke_board $b2", "deleteCommentsAtObject knorke_board $b3"], $this->h->comments->log);
    }

    // ── AK5: mentions and notifications ─────────────────────────────────────

    public function testAMentionOfAnAccountThatSeesTheBoardIsStoredAndNotified(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $t = $this->thread($this->user('alice'), 'Hi @"bob" and @"carol" and @alice');
        $id = $t['id'];
        $this->assertSame(['bob', 'alice'], $this->h->comments->knorke($id)['mentions'], 'carol has no access: not stored');
        $this->assertSame('Hi @"bob" and @"carol" and @"alice"', $this->h->comments->rows[$id]->getMessage(), 'a stored mention is written @"uid", the rest stays text');
        $this->assertSame(["notify bob comment $id comment_mention"], $this->notes(), 'bob only: carol is no candidate, alice is the author');
        $c = $t['comments'][0];
        $this->assertSame(['Hi ', ['m' => 'Bob Display'], ' and @"carol" and ', ['m' => 'Alice Display']], $c['parts']);
        $this->assertEquals(['bob' => 'Bob Display', 'alice' => 'Alice Display'], $c['mentions']);
        $this->assertSame('Hi @"bob" and @"carol" and @"alice"', $c['raw']);
    }

    public function testMentionsAreCheckedAgainstTheBoardAndCappedAtTwenty(): void {
        $this->h->groups['crowd'] = array_map(static fn (int $i): string => sprintf('u%02d', $i), range(1, 25));
        $this->h->shareRows->add($this->b, 'group', 'crowd', 'view');
        $this->h->shareRows->add($this->b, 'user', 'dave', 'edit');
        $this->h->disabledUsers = ['u01'];
        $this->h->knorkeFor = ['u02' => false];
        $text = implode(' ', array_map(static fn (string $u): string => '@"' . $u . '"', $this->h->groups['crowd']));
        $t = $this->thread($this->user('alice'), $text . ' @dave @"knorke-nope-x"');
        $stored = $this->h->comments->knorke($t['id'])['mentions'];
        $this->assertCount(20, $stored, 'at most 20 uids');
        $this->assertSame(array_map(static fn (int $i): string => sprintf('u%02d', $i), range(3, 22)), $stored, 'in order, without the disabled one and the one without app access');
    }

    public function testAGuestNeverMentions(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $t = $this->thread($this->guest(), 'Hey @"bob"');
        $this->assertSame([], $this->h->comments->knorke($t['id'])['mentions']);
        $this->assertSame([], $this->notes());
        $this->assertSame(['Hey @"bob"'], $t['comments'][0]['parts'], 'just text');
    }

    public function testAReplyNotifiesEarlierWritersButNotTheAuthorOrTheMentioned(): void {
        foreach (['bob', 'carol', 'dave'] as $u) {
            $this->h->shareRows->add($this->b, 'user', $u, 'edit');
        }
        $t = $this->thread($this->user('bob'), 'Root by bob');
        $this->reply($this->guest(), $t['id'], 'A guest');
        $this->reply($this->user('carol'), $t['id'], 'Carol');
        $this->h->notifyLog = [];
        $after = $this->reply($this->user('dave'), $t['id'], 'Dave asks @"carol"');
        $reply = $after['comments'][3]['id'];
        $this->assertSame([
            "notify carol comment $reply comment_mention",
            "markProcessed bob comment_thread {$t['id']} comment_reply",
            "notify bob comment_thread {$t['id']} comment_reply",
        ], $this->notes(), 'bob wrote before; carol gets the mention instead; dave is the author; guests get nothing');
        $this->assertSame(['comment' => $reply], $this->sent('bob', 'comment_reply')->getSubjectParameters());
        $this->h->notifyLog = [];
        $second = $this->reply($this->user('alice'), $t['id'], 'Alice')['comments'][4]['id'];
        $this->assertSame([
            "markProcessed bob comment_thread {$t['id']} comment_reply", "notify bob comment_thread {$t['id']} comment_reply",
            "markProcessed carol comment_thread {$t['id']} comment_reply", "notify carol comment_thread {$t['id']} comment_reply",
            "markProcessed dave comment_thread {$t['id']} comment_reply", "notify dave comment_thread {$t['id']} comment_reply",
        ], $this->notes(), 'the second reply replaces the first one per account and thread');
        $this->assertSame(['comment' => $second], $this->sent('bob', 'comment_reply')->getSubjectParameters());
    }

    /** Job 251 AK9: an account of the Guests app whose whitelist leaves Knorke out gets no comment notification (filtered before notify). */
    public function testAGuestsAppAccountOutsideTheWhitelistIsNotNotified(): void {
        foreach (['bob', 'carol', 'dave'] as $u) {
            $this->h->shareRows->add($this->b, 'user', $u, 'edit');
        }
        $this->h->backends['bob'] = 'Guests';
        $this->h->guests = $whitelist = new FakeGuestsWhitelist(true);
        $t = $this->thread($this->user('bob'), 'Root by bob');
        $this->reply($this->user('carol'), $t['id'], 'Carol');
        $whitelist->answer = false;
        $this->h->notifyLog = [];
        $this->reply($this->user('dave'), $t['id'], 'Dave');
        $this->assertSame([
            "markProcessed carol comment_thread {$t['id']} comment_reply",
            "notify carol comment_thread {$t['id']} comment_reply",
        ], $this->notes(), 'carol is notified, bob (Guests app, Knorke not on the whitelist) is not');
    }

    public function testAnEditNotifiesNewMentionsAndMarksRemovedOnesProcessed(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->shareRows->add($this->b, 'user', 'dave', 'view');
        $p = $this->user('alice');
        $id = $this->thread($p, 'Hi @"bob"')['id'];
        $this->h->notifyLog = [];
        $t = $this->svc()->update($p, $this->b, ['comment' => $id, 'text' => 'Hi @"dave"'], self::IP, self::NOW + 5000)['thread'];
        $this->assertSame(["notify dave comment $id comment_mention", "markProcessed bob comment $id comment_mention"], $this->notes());
        $this->assertSame(self::NOW + 5000, $t['comments'][0]['edited']);
        $this->assertSame(['dave'], $this->h->comments->knorke($id)['mentions']);
        $this->assertError(403, 'forbidden', fn () => $this->svc()->update($this->user('dave'), $this->b, ['comment' => $id, 'text' => 'mine?'], self::IP, self::NOW),
            'view may not write');
    }

    /** @return \OCP\Notification\INotification the last notification of $subject sent to $uid */
    private function sent(string $uid, string $subject): \OCP\Notification\INotification {
        foreach (array_reverse($this->h->sent) as $n) {
            if ($n->getUser() === $uid && $n->getSubject() === $subject) {
                return $n;
            }
        }
        $this->fail("no $subject for $uid");
    }

    // ── Route 39: the @ list ────────────────────────────────────────────────

    public function testTheAtListOffersAccountsThatSeeTheBoard(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->shareRows->add($this->b, 'user', 'eve', 'edit');
        $this->h->groups['big'] = array_map(static fn (int $i): string => sprintf('m%02d', $i), range(1, 14));
        $this->h->shareRows->add($this->b, 'group', 'big', 'vote');
        $this->h->teams = ['T' => ['Team T', ['alice', 'tina']]];
        $this->h->shareRows->add($this->b, 'team', 'T', 'view');
        $link = $this->h->boards->insertLink($this->b, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $this->h->boards->addMember($this->b, 'lena', 'edit', $link, 1);
        $this->h->disabledUsers = ['m14'];
        $this->h->knorkeFor = ['m13' => false];
        $eve = $this->user('eve');
        $all = $this->svc()->mentionable($eve, $this->b, '');
        $this->assertCount(10, $all['accounts'], 'at most 10');
        $this->assertSame(['alice', 'bob', 'lena', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07'], array_column($all['accounts'], 'id'), 'by name, without the asker');
        $this->assertSame(['id' => 'bob', 'name' => 'Bob Display'], $all['accounts'][1]);
        $this->assertSame(['tina'], array_column($this->svc()->mentionable($eve, $this->b, 'TIN')['accounts'], 'id'), 'q matches the uid, case-insensitive; team members count');
        $this->assertSame(['bob'], array_column($this->svc()->mentionable($eve, $this->b, 'bob disp')['accounts'], 'id'), 'q matches the display name');
        $this->assertSame([], $this->svc()->mentionable($eve, $this->b, 'carol')['accounts'], 'carol has no access');
        $this->assertSame([], $this->svc()->mentionable($eve, $this->b, 'm13')['accounts'], 'no app access');
        $this->assertSame([], $this->svc()->mentionable($eve, $this->b, 'm14')['accounts'], 'disabled');
        $this->assertSame([], $this->svc()->mentionable($eve, $this->b, 'eve')['accounts'], 'never the asker');
        $this->assertError(403, 'forbidden', fn () => $this->svc()->mentionable($this->user('bob'), $this->b, ''), 'view');
        $this->assertError(403, 'forbidden', fn () => $this->svc()->mentionable($this->guest(), $this->b, ''), 'guests');
        $this->assertSame(['lena'], array_column($this->svc()->mentionable($eve, $this->b, 'lena')['accounts'], 'id'), 'a valid link member');
        $this->h->linksAllowed = ['alice' => false];
        $this->assertSame([], $this->svc()->mentionable($eve, $this->b, 'lena')['accounts'], 'link members only while links count');
        $this->assertError(400, 'bad_request', fn () => $this->svc()->mentionable($eve, $this->b, str_repeat('x', 65)), 'q longer than 64');
    }

    // ── What a guest reads ──────────────────────────────────────────────────

    public function testAGuestReadsNoUid(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $t = $this->thread($this->user('alice'), 'For @"bob"');
        $this->reply($this->guest(), $t['id'], 'Me too');
        $json = json_encode($this->svc()->threads($this->guest(), $this->b), JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('"alice"', $json);
        $this->assertStringNotContainsString('"bob"', $json);
        $this->assertStringNotContainsString('\\"bob\\"', $json, 'the mention is a name, never @"uid"');
        $this->assertStringNotContainsString('"raw"', $json);
        $this->assertStringNotContainsString('"mentions"', $json);
        $read = $this->svc()->threads($this->guest(), $this->b)['threads'][0];
        $this->assertSame(['For ', ['m' => 'Bob Display']], $read['comments'][0]['parts']);
        $this->assertSame([false, true], [$read['comments'][0]['mine'], $read['comments'][1]['mine']]);
        $this->assertSame([false, true], [$this->svc()->threads($this->guest('edit', 'gOTHER000001'), $this->b)['threads'][0]['comments'][1]['mine'], $read['comments'][1]['mine']], 'another gid is not mine');
    }

    public function testADeletedAccountIsShownAsDeletedUser(): void {
        $t = $this->thread($this->user('alice'), 'Old');
        $this->h->deletedUsers = ['alice'];
        $c = $this->svc()->threads($this->guest(), $this->b)['threads'][0]['comments'][0];
        $this->assertSame('Deleted user', $c['name']);
        // Nextcloud's deleteReferencesOfActor
        $this->h->comments->rows[$t['id']]->setActor('deleted_users', 'deleted_users');
        $c = $this->svc()->threads($this->guest(), $this->b)['threads'][0]['comments'][0];
        $this->assertSame(['Deleted user', null, false], [$c['name'], $c['pid'], $c['guest']]);
    }

    // ── Job 249: mentions of deleted accounts ───────────────────────────────

    public function testADeletedAccountsMentionsBecomeDeletedUserAndALaterAccountNeverShowsUp(): void {
        // AK1, AK2, AK5
        $this->h->shareRows->add($this->b, 'user', 'bob', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'alice2', 'edit');
        $bob = $this->user('bob');
        $t = $this->thread($bob, 'Hi @"alice" and @alice2 and alice');
        $id = $t['id'];
        $this->assertSame(['alice', 'alice2'], $this->h->comments->knorke($id)['mentions']);
        $other = $this->reply($this->user('alice2'), $id, 'Only @"alice2" here, no alice')['comments'][1]['id'];
        $guest = $this->reply($this->guest('edit', 'gGUEST000001'), $id, 'I am a guest')['comments'][2]['id'];
        // a guest named like the account: its meta matches the pre-filter, not the mentions
        $this->h->comments->rows[$guest]->setMetaData(['knorke' => ['name' => 'alice', 'edited' => null, 'mentions' => []]]);
        $rows = array_map(static fn ($c) => clone $c, $this->h->comments->rows);
        [$meta, $rev] = $this->meta();
        $this->h->comments->log = [];

        $this->assertSame(1, $this->svc()->onUserDeleted('alice'));
        $this->assertSame(['alice'], $this->h->mentionStore->calls);
        $this->assertSame('Hi @"deleted_users" and @"alice2" and alice', $this->h->comments->rows[$id]->getMessage());
        $k = $this->h->comments->knorke($id);
        $this->assertSame([['alice2'], null], [$k['mentions'], $k['edited']], 'alice leaves the mentions, edited stays');
        $this->assertSame(["save $id"], $this->h->comments->log, 'only the comment that mentions alice is written');
        $this->assertEquals($rows[$other], $this->h->comments->rows[$other], 'alice2 and the word alice are not alice');
        $this->assertEquals($rows[$guest], $this->h->comments->rows[$guest]);
        [$meta2, $rev2] = $this->meta();
        $this->assertSame([$meta['comments'], $rev + 1], [$meta2['comments'], $rev2], 'meta_rev + 1, meta.comments unchanged');

        // the uid alice exists (again) in the harness: never its name
        $c = $this->svc()->threads($bob, $this->b)['threads'][0]['comments'][0];
        $this->assertSame(['Hi ', ['m' => 'Deleted user', 'gone' => true], ' and ', ['m' => 'Alice2 Display'], ' and alice'], $c['parts']);
        $this->assertEquals(['alice2' => 'Alice2 Display', 'deleted_users' => 'Deleted user'], $c['mentions'], 'the own map carries the marker for editing');
        $this->assertStringNotContainsString('Alice Display', json_encode($this->svc()->threads($this->guest(), $this->b), JSON_THROW_ON_ERROR));

        // editing with the text unchanged writes nothing
        $this->h->comments->log = [];
        $this->svc()->update($bob, $this->b, ['comment' => $id, 'text' => 'Hi @"deleted_users" and @"alice2" and alice'], self::IP, self::NOW + 5000);
        $this->assertSame([], $this->h->comments->log, 'no change: the marker stays text, alice2 stays a mention');

        $this->assertSame(0, $this->svc()->onUserDeleted('alice'), 'a second run finds nothing');
        $this->assertSame($rev2, $this->meta()[1], 'and bumps nothing');
        $this->assertSame(0, $this->svc()->onUserDeleted('nobody'));
    }

    public function testRewritingSkipsAGoneBoardAndKeepsGoingAfterAFailure(): void {
        // AK1 (risks: a failing board never stops the rest)
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $t = $this->thread($this->user('alice'), 'For @"bob"');
        $this->h->mentionStore->failWith = new \RuntimeException('db gone');
        try {
            $this->svc()->onUserDeleted('bob');
            $this->fail('the finder\'s failure reaches the listener, which logs it');
        } catch (\RuntimeException) {
        }
        $this->h->mentionStore->failWith = null;
        unset($this->h->boards->boards[$this->b]);
        $this->assertSame(0, $this->svc()->onUserDeleted('bob'), 'a gone board is skipped');
        $this->assertSame('For @"bob"', $this->h->comments->rows[$t['id']]->getMessage());
    }

    public function testPartsShowTheDeletedMarkerOnlyQuotedAndNotForAStoredAccountOfThatId(): void {
        $name = static fn (string $uid): string => strtoupper($uid);
        $this->assertSame(['a ', ['m' => 'Deleted user', 'gone' => true], ' b'], CommentService::parts('a @"deleted_users" b', [], $name));
        $this->assertSame(['a @deleted_users'], CommentService::parts('a @deleted_users', [], $name), 'only the quoted marker');
        $this->assertSame([['m' => 'DELETED_USERS']], CommentService::parts('@"deleted_users"', ['deleted_users'], $name), 'a real account of that id stays itself');
        $this->assertSame('Hi @Deleted user', CommentService::plainText('Hi @"deleted_users"', [], $name));
    }

    // ── Job 249: the @ list under Nextcloud's search rules ───────────────────

    public function testTheAtListFollowsNextcloudsSearchRulesOnlyWhenRestricted(): void {
        // AK6
        foreach (['bob', 'dave', 'eve'] as $u) {
            $this->h->shareRows->add($this->b, 'user', $u, $u === 'eve' ? 'edit' : 'view');
        }
        $eve = $this->user('eve');
        $ids = fn (string $q = ''): array => array_column($this->svc()->mentionable($eve, $this->b, $q)['accounts'], 'id');
        $this->assertSame(['alice', 'bob', 'dave'], $ids());
        $this->assertSame([], $this->h->searchCalls, 'without a restriction Nextcloud\'s search is never asked');
        $this->h->search = [['exact' => ['users' => [['label' => 'A', 'value' => ['shareType' => 0, 'shareWith' => 'alice']]]],
            'users' => [['label' => 'B', 'value' => ['shareType' => 0, 'shareWith' => 'bob']], ['label' => 'C', 'value' => ['shareType' => 0, 'shareWith' => 'carol']]]], false];
        foreach (['enumeration' => false, 'enumerationGroups' => true, 'enumerationPhone' => true, 'groupMembersOnly' => true] as $key => $on) {
            $saved = $this->h->share;
            $this->h->share[$key] = $on;
            $this->h->searchCalls = [];
            $this->assertSame(['alice', 'bob'], $ids('a'), "$key: only board candidates the search finds (carol has no access, dave is not found)");
            $this->assertSame([['q' => 'a', 'types' => [0], 'lookup' => false, 'limit' => 200, 'offset' => 0]], $this->h->searchCalls);
            $this->h->share = $saved;
        }
        $this->h->share['enumerationGroups'] = true;
        $this->h->searchFailWith = new \RuntimeException('search down');
        $this->assertSame([], $ids('bo'), 'a failing search shows nobody');
        $this->h->searchFailWith = null;
        $this->h->systemValues['sharing.minSearchStringLength'] = 3;
        $this->h->searchCalls = [];
        $this->assertSame([], $ids('bo'), 'below the minimum length nobody');
        $this->assertSame([], $this->h->searchCalls);
        $this->assertSame(['bob'], $ids('bob'));
    }

    public function testPartsCutAtStoredMentionsOnly(): void {
        $name = static fn (string $uid): string => strtoupper($uid);
        $this->assertSame(['a ', ['m' => 'BOB'], ' b @"x" ', ['m' => 'BOB'], '!'], CommentService::parts('a @"bob" b @"x" @bob!', ['bob'], $name));
        $this->assertSame(['<b>@"bob"</b>'], CommentService::parts('<b>@"bob"</b>', [], $name), 'without stored mentions: one string');
        $this->assertSame([['m' => 'BOB']], CommentService::parts('@"bob"', ['bob'], $name));
        $this->assertSame('Hi @BOB', CommentService::plainText('Hi @"bob"', ['bob'], $name));
    }

    public function testWithoutFourByteTextEmojiBecomeTheReplacementCharacter(): void {
        $this->h->fourByte = false;
        $t = $this->thread($this->guest('edit', 'gEMOJI000001'), 'Yes 👍');
        $this->assertSame("Yes \u{FFFD}", $this->h->comments->rows[$t['id']]->getMessage());
    }
}
