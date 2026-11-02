<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\VoteHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * The vote path of /sync and the snapshot on the real SyncService and
 * VoteService (SQLite, SPEC-M1 §4.5, §4.6, §4.13.8 step 1b and step 9 in
 * the R16 wording): vote ops after the object ops, results by position,
 * acks.rev from the object part only, no board rev for votes; the exact
 * `votes` block (sid always, mine an object — {} never [] —, left; voters
 * and vt only for moderators sending vt; nothing when every vote op hit a
 * closed session); step 9 (i) without any SQL, (ii) with a re-seed, path (b)
 * of the automatic close; `votes` in the snapshot only while meta.vote is
 * open and the principal may vote.
 */
final class SyncVotePathTest extends TestCase {
    private H $h;

    protected function setUp(): void {
        $this->h = new H();
    }

    private function start(int $b, array $cfg = []): int {
        return $this->h->votes->start(H::user(), $b, $cfg, $this->h->now)['meta']['vote']['sid'];
    }

    public function testMixedBatchByPositionWithoutRevForVotes(): void {
        $b = $this->h->board(2);
        $sid = $this->start($b);
        $rev = $this->h->rev($b);
        $new = '01JVNEW0000000000000000001';
        $put = ['o' => 'put', 'id' => $new, 't' => 'sticky', 'p' => ['x' => 1, 'y' => 2, 'w' => 200, 'h' => 200, 'z' => 'i5']];
        $d = $this->h->syncDecoded(['seq' => 4, 'since' => $rev, 'ops' => [
            H::vote($sid, 1, 1), $put, ['o' => 'vote', 's' => $sid, 'id' => 'x', 'n' => 1], ['o' => 'patch', 'id' => $new, 'p' => ['data.text' => 'hi']], H::vote($sid, $new, 1),
        ]], H::user(), $b);
        $this->assertSame(['seq' => 4, 'rev' => $rev + 1, 'res' => ['ok', 'ok', 'bad', 'ok', 'ok']], $d['acks'], 'positions kept; acks.rev from the objects');
        $this->assertSame($rev + 1, $this->h->rev($b), 'the votes added no rev');
        $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(1) => 1, $new => 1], 'left' => 3], $d['votes'], 'the item put in the same request is votable');
        $this->assertSame(['rev', 'now', 'items', 'acks', 'votes', 'presence'], array_keys($d));
        // Only votes: acks.rev null, no rev, the other pollers stay on the fast path.
        $d = $this->h->syncDecoded(['seq' => 5, 'since' => $rev + 1, 'ops' => [H::vote($sid, 1, 0)]], H::user(), $b);
        $this->assertSame(['seq' => 5, 'rev' => null, 'res' => ['ok']], $d['acks']);
        $this->assertSame($rev + 1, $d['rev']);
        $this->assertSame($rev + 1, $this->h->rev($b), "still no rev for the votes");
    }

    public function testVotesBlockShape(): void {
        $b = $this->h->board(2);
        $sid = $this->start($b);
        $vic = H::user('vic', Role::Vote);
        $raw = $this->h->syncRaw(['seq' => 1, 'ops' => [H::vote($sid, 1, 1)]], $vic, $b);
        $this->assertStringContainsString(',"votes":{"sid":' . $sid . ',"mine":{"' . H::ulid(1) . '":1},"left":4},', $raw);
        $raw = $this->h->syncRaw(['seq' => 2, 'ops' => [H::vote($sid, 1, 0)]], $vic, $b);
        $this->assertStringContainsString(',"votes":{"sid":' . $sid . ',"mine":{},"left":5},', $raw, 'mine empty as {}, never []');
        // Limit and bad still deliver mine/left of the open session (the client corrects its state).
        $d = $this->h->syncDecoded(['seq' => 3, 'ops' => [H::vote($sid, 1, 2)]], $vic, $b);
        $this->assertSame([['limit'], ['sid' => $sid, 'mine' => [], 'left' => 5]], [$d['acks']['res'], $d['votes']]);
        // A non-moderator never gets voters/vt, also with vt.
        $d = $this->h->syncDecoded(['vt' => 0, 'seq' => 4, 'ops' => [H::vote($sid, 2, 1)]], $vic, $b);
        $this->assertSame(['sid', 'mine', 'left'], array_keys($d['votes']));
        // Every vote op on a closed session: no votes block.
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $d = $this->h->syncDecoded(['seq' => 5, 'ops' => [H::vote($sid, 1, 1)]], $vic, $b);
        $this->assertSame(['closed'], $d['acks']['res']);
        $this->assertArrayNotHasKey('votes', $d);
        // view: denied before the lock, no votes block, no transaction.
        $this->h->sql->log = [];
        $d = $this->h->syncDecoded(['seq' => 6, 'ops' => [H::vote($sid, 1, 1)]], H::user('val', Role::View), $b);
        $this->assertSame(['denied'], $d['acks']['res']);
        $this->assertArrayNotHasKey('votes', $d);
        $this->assertSame([], $this->h->sql->log);
        // No tally, no foreign pid anywhere (§7.2): after the close only sums in meta.
        $this->assertStringNotContainsString('tally', $this->h->syncRaw(['since' => 0], H::user(), $b));
    }

    public function testStaleBaseThroughSyncJob216(): void {
        // Two tabs (two clients) of the same account start from the same
        // state: the second op answers stale, its block names the state.
        $b = $this->h->board(2);
        $sid = $this->start($b, ['per' => 5, 'perItem' => 3]);
        $vic = H::user('vic', Role::Vote);
        $tab = static fn (string $client, int $seq, int $n, int $base): array => ['client' => $client, 'seq' => $seq, 'ops' => [H::vote($sid, 1, $n) + ['b' => $base]]];
        $d = $this->h->syncDecoded($tab('tabA', 1, 2, 0), $vic, $b);
        $this->assertSame([['ok'], ['sid' => $sid, 'mine' => [H::ulid(1) => 2], 'left' => 3]], [$d['acks']['res'], $d['votes']]);
        $d = $this->h->syncDecoded($tab('tabB', 1, 1, 0), $vic, $b);
        $this->assertSame([['stale'], ['sid' => $sid, 'mine' => [H::ulid(1) => 2], 'left' => 3]], [$d['acks']['res'], $d['votes']]);
        $this->assertNull($d['acks']['rev']);
        $d = $this->h->syncDecoded($tab('tabB', 2, 3, 2), $vic, $b);
        $this->assertSame([['ok'], ['sid' => $sid, 'mine' => [H::ulid(1) => 3], 'left' => 2]], [$d['acks']['res'], $d['votes']]);
    }

    public function testStep9ForModerators(): void {
        $b = $this->h->board(3);
        $sid = $this->start($b);
        $rev = $this->h->rev($b);
        $owner = H::user();
        // (i) vt:<b> = "<sid>:0" matches vt 0: no votes and not a single statement (fast path).
        $before = count($this->h->sql->statements);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 0], $owner, $b);
        $this->assertArrayNotHasKey('votes', $d);
        $this->assertSame($before, count($this->h->sql->statements), 'step 9 (i): no app SQL');
        // (ii) A vote moved seq: the moderator sees the number of voters, never a distribution.
        $this->h->syncDecoded(['seq' => 1, 'ops' => [H::vote($sid, 1, 1)]], H::user('vic', Role::Vote), $b);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 0], $owner, $b);
        $this->assertSame(['sid' => $sid, 'voters' => 1, 'vt' => 1], $d['votes']);
        // vt:<b> lost (TTL, epoch rotation): the DB answers and seeds it again.
        $this->h->mem->remove('vt:' . $b);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 1], $owner, $b);
        $this->assertSame(['sid' => $sid, 'voters' => 1, 'vt' => 1], $d['votes']);
        $this->assertSame(['sid' => $sid, 'seq' => 1], $this->h->cache->getVoteSeq($b));
        $before = count($this->h->sql->statements);
        $this->assertArrayNotHasKey('votes', $this->h->syncDecoded(['since' => $rev, 'vt' => 1], $owner, $b));
        $this->assertSame($before, count($this->h->sql->statements));
        // A share with moderate (facilitator) moderates; edit through a share does not.
        $this->assertSame(1, $this->h->syncDecoded(['since' => $rev, 'vt' => 0], H::user('fay', Role::Edit, true), $b)['votes']['voters']);
        $this->assertArrayNotHasKey('votes', $this->h->syncDecoded(['since' => $rev, 'vt' => 0], H::user('ed', Role::Edit), $b));
        // (a) and (b) in one answer: same sid, keys in order.
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 0, 'seq' => 9, 'ops' => [H::vote($sid, 2, 1)]], $owner, $b);
        $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(2) => 1], 'left' => 4, 'voters' => 2, 'vt' => 2], $d['votes']);
        // A new session: the moderator still sends the old vt (≥ 1) → voters of the new one (C71, R16).
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $sid2 = $this->start($b);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 2], $owner, $b);
        $this->assertSame(['sid' => $sid2, 'voters' => 0, 'vt' => 0], $d['votes']);
    }

    public function testLiveTallyOnlyForModeratorsJob149(): void {
        $b = $this->h->board(4);
        $sid = $this->start($b, ['live' => true]);
        $rev = $this->h->rev($b);
        $owner = H::user();
        $votesSql = fn (int $from): array => array_values(array_filter(array_slice($this->h->sql->statements, $from), static fn (string $s): bool => str_contains($s, 'knorke_vote')));
        // No votes yet: vt:<b> = "<sid>:0" matches vt 0 → nothing; without the key the tally is [].
        $before = count($this->h->sql->statements);
        $this->assertArrayNotHasKey('votes', $this->h->syncDecoded(['since' => $rev, 'vt' => 0], $owner, $b));
        $this->assertSame($before, count($this->h->sql->statements), 'step 9 (i): no SQL in a live session either');
        $this->h->mem->remove('vt:' . $b);
        $raw = $this->h->syncRaw(['since' => $rev, 'vt' => 0], $owner, $b);
        $this->assertStringContainsString(',"votes":{"sid":' . $sid . ',"voters":0,"vt":0,"tally":[]}', $raw);
        // vic: 1 and 2, Gina: 1, ed: 3 → 1:2, 2:1, 3:1 (n descending, then id).
        $vic = H::user('vic', Role::Vote);
        $ed = H::user('ed', Role::Edit);
        $this->h->syncDecoded(['seq' => 1, 'ops' => [H::vote($sid, 2, 1), H::vote($sid, 1, 1)]], $vic, $b);
        $this->h->syncDecoded(['seq' => 1, 'ops' => [H::vote($sid, 1, 1)]], H::guest(), $b);
        // A non-moderator with vt and a vote op: {sid, mine, left}, never a tally.
        $raw = $this->h->syncRaw(['vt' => 0, 'seq' => 1, 'ops' => [H::vote($sid, 3, 1)]], $ed, $b);
        $this->assertSame(['sid', 'mine', 'left'], array_keys(json_decode($raw, true)['votes']));
        $this->assertStringNotContainsString('"tally"', $raw);
        $this->assertStringNotContainsString('"tally"', $this->h->syncRaw(['since' => 0, 'vt' => 0], $vic, $b), 'voter with vt');
        // The moderator with a vt that differs: {sid, voters, vt, tally}.
        $before = count($this->h->sql->statements);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 0], $owner, $b);
        $this->assertSame(['sid' => $sid, 'voters' => 3, 'vt' => 3, 'tally' => [[H::ulid(1), 2], [H::ulid(2), 1], [H::ulid(3), 1]]], $d['votes']);
        $this->assertSame(['sid', 'voters', 'vt', 'tally'], array_keys($d['votes']));
        $liveSql = $votesSql($before);
        $this->assertCount(3, $liveSql, 'open, voters, tally');
        $this->assertStringContainsString('GROUP BY', $liveSql[2]);
        // A facilitator (share with moderate) gets it too; an editor through a share with vt does not.
        $this->assertSame([[H::ulid(1), 2], [H::ulid(2), 1], [H::ulid(3), 1]], $this->h->syncDecoded(['since' => $rev, 'vt' => 0], H::user('fay', Role::Edit, true), $b)['votes']['tally']);
        $this->assertArrayNotHasKey('votes', $this->h->syncDecoded(['since' => $rev, 'vt' => 0], $ed, $b));
        // vt matches: no block and no SQL.
        $before = count($this->h->sql->statements);
        $this->assertArrayNotHasKey('votes', $this->h->syncDecoded(['since' => $rev, 'vt' => 3], $owner, $b));
        $this->assertSame($before, count($this->h->sql->statements));
        // A deleted item leaves the tally (it counts again with the next seq or a lost vt: key).
        $this->h->sql->setDeleted($b, H::ulid(3), true);
        $this->h->mem->remove('vt:' . $b);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 3], $owner, $b);
        $this->assertSame(['sid' => $sid, 'voters' => 2, 'vt' => 3, 'tally' => [[H::ulid(1), 2], [H::ulid(2), 1]]], $d['votes']);
        // Snapshot and join never carry it, for the moderator neither.
        $snap = fn ($p, ?array $guest = null): string => $this->h->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => $p->role->value], $guest, $this->h->now);
        $this->assertStringContainsString('"votes":{"sid":' . $sid . ',"mine":{},"left":5}', $snap($owner));
        $this->assertStringNotContainsString('"tally"', $snap($owner));
        $this->assertStringNotContainsString('"tally"', $snap(H::guest(), ['token' => 'gTok', 'exp' => $this->h->now + 60000]), 'join');
        // After the end: no tally anywhere (the results in meta are the only sums).
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->h->mem->remove('vt:' . $b);
        $raw = $this->h->syncRaw(['since' => 0, 'vt' => 3], $owner, $b);
        $this->assertStringNotContainsString('"tally"', $raw);
        $this->assertSame([[H::ulid(1), 2], [H::ulid(2), 1]], json_decode($raw, true)['board']['meta']['vote']['results']);
        $this->assertStringNotContainsString('"tally"', $snap($owner));
        // Without live: the block as before, with the same statements (no GROUP BY).
        $b2 = $this->h->board(2);
        $sid2 = $this->start($b2);
        $this->h->syncDecoded(['seq' => 1, 'ops' => [H::vote($sid2, 1, 1)]], $vic, $b2);
        $before = count($this->h->sql->statements);
        $d = $this->h->syncDecoded(['since' => $this->h->rev($b2), 'vt' => 0], $owner, $b2);
        $this->assertSame(['sid' => $sid2, 'voters' => 1, 'vt' => 1], $d['votes']);
        $plainSql = $votesSql($before);
        $this->assertCount(2, $plainSql, 'open and voters only');
        $this->assertSame(array_slice($liveSql, 0, 2), $plainSql, 'the same statements as before, the tally query is the only extra one');
        $this->assertSame([], array_filter($plainSql, static fn (string $s): bool => str_contains($s, 'GROUP BY')));
    }

    public function testStep9ClosesAnExpiredSessionPathB(): void {
        $b = $this->h->board(2);
        $sid = $this->start($b, ['minutes' => 10]);
        $this->h->syncDecoded(['seq' => 1, 'ops' => [H::vote($sid, 1, 1)]], H::user('vic', Role::Vote), $b);
        // vote-expire (§8.4, R16): ends_at in the past, meta and revs unchanged, vt: deleted.
        $this->h->sql->pdo->exec('UPDATE oc_knorke_vote_sessions SET ends_at = ' . ($this->h->now - 1) . ' WHERE id = ' . $sid);
        $this->h->mem->remove('vt:' . $b);
        $rev = $this->h->rev($b);
        $d = $this->h->syncDecoded(['since' => $rev, 'vt' => 0], H::user(), $b);
        $this->assertArrayNotHasKey('votes', $d, 'this answer carries no voters');
        $this->assertSame('closed', $this->h->session($sid)['state']);
        $d = $this->h->syncDecoded(['since' => $rev], H::user(), $b);
        $this->assertSame(['closed', [[H::ulid(1), 1]], 1], [$d['board']['meta']['vote']['state'], $d['board']['meta']['vote']['results'], $d['board']['meta']['vote']['voters']]);
        $this->assertTrue($this->h->allOutsideTransactions());
        // No session at all: a moderator sending vt anyway gets nothing.
        $this->h->votes->update(H::user(), $b, 'clear', null, $this->h->now);
        $this->assertArrayNotHasKey('votes', $this->h->syncDecoded(['since' => 0, 'vt' => 0], H::user(), $b));
    }

    public function testFastPathWithoutVtStaysWithoutSql(): void {
        // E06 (unchanged, R16): an owner without vt (no open session in the
        // client) costs no statement on the fast path, even with a session open.
        $b = $this->h->board(1);
        $this->start($b);
        $rev = $this->h->rev($b);
        $before = count($this->h->sql->statements);
        for ($i = 0; $i < 5; $i++) {
            $this->assertSame(['rev', 'now', 'presence'], array_keys($this->h->syncDecoded(['since' => $rev], H::user(), $b)));
        }
        $this->assertSame($before, count($this->h->sql->statements));
    }

    public function testSnapshotVotes(): void {
        $b = $this->h->board(2);
        $snap = fn ($p): string => $this->h->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => $p->role->value], null, $this->h->now);
        $vic = H::user('vic', Role::Vote);
        // No session: no votes key and no vote query.
        $before = count($this->h->sql->statements);
        $this->assertStringNotContainsString('"votes"', $snap($vic));
        $this->assertSame([], array_filter(array_slice($this->h->sql->statements, $before), static fn (string $s): bool => str_contains($s, 'knorke_vote')));
        $sid = $this->start($b, ['per' => 3, 'perItem' => 2]);
        $this->assertStringContainsString(',"votes":{"sid":' . $sid . ',"mine":{},"left":3},"items":[', $snap($vic), 'between me and items, mine {}');
        $this->h->votes->apply($vic, $b, [['o' => 'vote', 's' => $sid, 'id' => H::ulid(2), 'n' => 2]], $this->h->now);
        $d = json_decode($snap($vic), true);
        $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(2) => 2], 'left' => 1], $d['votes']);
        $this->assertSame(['proto', 'epoch', 'now', 'rev', 'minRev', 'schema', 'board', 'me', 'votes', 'items'], array_keys($d));
        // view never gets it; a guest of the voting link does.
        $this->assertStringNotContainsString('"votes"', $snap(H::user('val', Role::View)));
        $this->assertStringContainsString('"votes":{"sid":' . $sid, $snap(H::guest()));
        // Closed: none.
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->assertStringNotContainsString('"votes"', $snap($vic));
    }

    public function testAccountsOnlyThroughSyncSnapshotAndJoinJob175(): void {
        $b = $this->h->board(3);
        $sid = $this->start($b, ['accountsOnly' => true]);
        $rev = $this->h->rev($b);
        $snap = fn ($p, ?array $guest = null): string => $this->h->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => $p->role->value], $guest, $this->h->now);
        $guests = ['edit link' => H::guest('gEDIT0000000', Role::Edit), 'vote link' => H::guest('gVOTE0000000', Role::Vote)];
        // Guests of both links: denied, no row, no seq, no votes block; the board rev stays.
        foreach ($guests as $what => $g) {
            $raw = $this->h->syncRaw(['seq' => 1, 'since' => $rev, 'ops' => [H::vote($sid, 1, 1)]], $g, $b);
            $d = json_decode($raw, true);
            $this->assertSame(['seq' => 1, 'rev' => null, 'res' => ['denied']], $d['acks'], $what);
            $this->assertStringNotContainsString('"votes"', $raw, $what);
            // Snapshot and join of the guest: no votes block while the session is open.
            $this->assertStringNotContainsString('"votes"', $snap($g), $what . ' snapshot');
            $this->assertStringNotContainsString('"votes"', $snap($g, ['token' => 'gTok', 'exp' => $this->h->now + 60000]), $what . ' join');
        }
        $this->assertSame(0, $this->h->voteRows($sid));
        $this->assertSame(0, (int)$this->h->session($sid)['seq']);
        $this->assertSame($rev, $this->h->rev($b));
        // Accounts vote: owner, share, account through the link; their snapshot carries the block.
        $n = 0;
        foreach (['owner' => H::user(), 'share' => H::user('ed', Role::Edit), 'link' => H::user('lin', Role::Vote, false, 'link')] as $what => $acc) {
            $d = $this->h->syncDecoded(['seq' => 2, 'since' => $rev, 'ops' => [H::vote($sid, 1, 1)]], $acc, $b);
            $this->assertSame(['ok'], $d['acks']['res'], $what);
            $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(1) => 1], 'left' => 4], $d['votes'], $what);
            $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(1) => 1], 'left' => 4], json_decode($snap($acc), true)['votes'], $what . ' snapshot');
            $this->assertSame(++$n, (int)$this->h->session($sid)['seq']);
        }
        // The moderator poll counts only the accounts.
        $this->h->mem->remove('vt:' . $b);
        $this->assertSame(['sid' => $sid, 'voters' => 3, 'vt' => 3], $this->h->syncDecoded(['since' => $rev, 'vt' => 0], H::user(), $b)['votes']);
        // Closed: the same op of a guest gets closed.
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->assertSame(['closed'], $this->h->syncDecoded(['seq' => 3, 'ops' => [H::vote($sid, 1, 1)]], $guests['vote link'], $b)['acks']['res']);
        // Without the option guests vote as before (ok, block present, also in snapshot and join).
        $sid2 = $this->start($b);
        foreach ($guests as $what => $g) {
            $d = $this->h->syncDecoded(['seq' => 4, 'ops' => [H::vote($sid2, 2, 1)]], $g, $b);
            $this->assertSame(['ok'], $d['acks']['res'], $what);
            $this->assertSame(['sid' => $sid2, 'mine' => [H::ulid(2) => 1], 'left' => 4], $d['votes'], $what);
            $this->assertStringContainsString('"votes":{"sid":' . $sid2 . ',"mine":{"' . H::ulid(2) . '":1},"left":4}', $snap($g), $what . ' snapshot');
            $this->assertStringContainsString('"votes":{"sid":' . $sid2, $snap($g, ['token' => 'gTok', 'exp' => $this->h->now + 60000]), $what . ' join');
        }
    }

    public function testPresenceViewportThroughSync(): void {
        $b = $this->h->board(0);
        $this->h->syncDecoded(['since' => 0, 'me' => ['v' => [-10, -20.04, 800, 600]]], H::user(), $b);
        $d = $this->h->syncDecoded(['since' => 0, 'pres' => 1], H::user('bob', Role::Edit), $b);
        $entry = array_values($d['presence'])[0];
        $this->assertSame([[-10.0, -20.0, 800.0, 600.0], null, null], [$entry['v'], $entry['x'], $entry['y']], '{v} alone: a viewport without a cursor');
        // view writes nothing.
        $this->h->syncDecoded(['since' => 0, 'me' => ['v' => [0, 0, 1, 1]]], H::user('val', Role::View), $b);
        $this->assertCount(1, $this->h->syncDecoded(['since' => 0], H::user('bob', Role::Edit), $b)['presence']);
    }
}
