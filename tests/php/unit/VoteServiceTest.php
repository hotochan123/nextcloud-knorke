<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\BackgroundJob\VoteCloseJob;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\VoteHarness as H;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\TestCase;

/**
 * VoteService and VoteStore on a real SQL engine (SQLite in memory,
 * SPEC-M1 §8.2 (3)): sessions (start, the PATCH actions, codes and no-op
 * rules of R16), the vote path (set semantics, repetition, budgets per
 * person and per item in batch order, scope, types, closed, only live items
 * count — R16 SRV-06; lowering and taking back never fail on type, scope
 * or budget, rows outside the scope keep counting — R17-K1, R17-K2), the
 * close (ranking, cap, voters, vote rows deleted,
 * idempotent over four ways), progress, mine, VoteCloseJob, deleted
 * accounts, and the R16 rule that r:/vt: are written only after the COMMIT
 * (SRV-02: every bumpRev/setVoteSeq outside a transaction).
 */
final class VoteServiceTest extends TestCase {
    private H $h;

    protected function setUp(): void {
        $this->h = new H();
    }

    private function expectHttp(int $status, string $code, callable $fn): void {
        try {
            $fn();
            $this->fail("expected $status $code");
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error], $e->getMessage());
        }
    }

    /** Opens a session on $b; returns its sid. */
    private function start(int $b, array $cfg = [], ?int $at = null): int {
        $out = $this->h->votes->start(H::user(), $b, $cfg, $at ?? $this->h->now);
        return $out['meta']['vote']['sid'];
    }

    private function apply(int $b, array $ops, ?\OCA\Knorke\Service\Principal $p = null, ?int $at = null): array {
        $p ??= H::user('vic', Role::Vote);
        $norm = array_map(static fn (array $op): array => \OCA\Knorke\Service\OpValidator::normalizeVote($p, $op), $ops);
        return $this->h->votes->apply($p, $b, $norm, $at ?? $this->h->now);
    }

    // ── config, start ──────────────────────────────────────────────────────

    public function testConfigDefaultsAndRefusals(): void {
        $this->assertSame(['cfg' => ['per' => 5, 'perItem' => 1, 'scope' => null, 'types' => ['sticky']], 'minutes' => null], VoteService::config([]));
        $this->assertSame(['cfg' => ['per' => 99, 'perItem' => 99, 'scope' => H::ulid(1), 'types' => ['shape', 'text']], 'minutes' => 1440],
            VoteService::config(['per' => 99, 'perItem' => 99, 'scope' => H::ulid(1), 'types' => ['shape', 'text', 'shape'], 'minutes' => 1440]));
        $this->assertSame(3, VoteService::config(['per' => 3.0, 'perItem' => null, 'minutes' => null])['cfg']['per']);
        foreach ([
            ['per' => 0], ['per' => 100], ['per' => '5'], ['per' => 2.5], ['perItem' => 0], ['per' => 2, 'perItem' => 3],
            ['scope' => 'frame'], ['scope' => 7], ['types' => []], ['types' => ['frame']], ['types' => ['connector']], ['types' => ['pen']],
            ['types' => 'sticky'], ['types' => [1]], ['types' => ['a' => 'sticky']], ['minutes' => 0], ['minutes' => 1441], ['minutes' => '10'], ['minutes' => true],
        ] as $body) {
            $this->expectHttp(400, 'vote_config', static fn () => VoteService::config($body));
        }
    }

    public function testStartWritesMetaAndSeedsVt(): void {
        $b = $this->h->board(3);
        $rev = $this->h->rev($b);
        $out = $this->h->votes->start(H::user(), $b, ['per' => 3, 'minutes' => 10], $this->h->now);
        $sid = $out['meta']['vote']['sid'];
        $this->assertSame(['sid' => $sid, 'state' => 'open', 'cfg' => ['per' => 3, 'perItem' => 1, 'scope' => null, 'types' => ['sticky']],
            'startedAt' => $this->h->now, 'endsAt' => $this->h->now + 600000, 'by' => 'Alice Adler', 'show' => false], $out['meta']['vote']);
        $this->assertSame([$rev + 1, 'Board'], [$out['metaRev'], $out['title']], 'meta_rev = new rev');
        $this->assertSame($out['meta'], $this->h->meta($b));
        $row = $this->h->session($sid);
        $this->assertSame(['open', 'u:alice', $this->h->now + 600000, '{"per":3,"perItem":1,"scope":null,"types":["sticky"]}'],
            [$row['state'], $row['started_by'], (int)$row['ends_at'], $row['config']]);
        $this->assertSame(['sid' => $sid, 'seq' => 0], $this->h->cache->getVoteSeq($b), 'vt:<b> = "<sid>:0"');
        $this->assertSame(["bumpRev " . ($rev + 1) . " tx=0", "setVoteSeq $sid:0 tx=0"], $this->h->log);
        // Without minutes: no end.
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->assertNull($this->h->votes->start(H::user(), $b, [], $this->h->now)['meta']['vote']['endsAt']);
    }

    public function testStartConflictsAndScope(): void {
        $b = $this->h->board(4, 2);
        $this->start($b);
        $metaRev = $this->h->rev($b);
        $this->expectHttp(409, 'vote_open', fn () => $this->start($b));
        $this->assertSame($metaRev, $this->h->rev($b), 'nothing written');
        $this->assertSame(1, (int)$this->h->sql->one('SELECT COUNT(*) FROM *PREFIX*knorke_vote_sessions WHERE board_id = ?', [$b]));
        // Scope: a live frame of this board, else vote_config (checked under the lock).
        $b2 = $this->h->board(2, 1);
        $this->expectHttp(400, 'vote_config', fn () => $this->start($b2, ['scope' => H::ulid(1)]));
        $this->expectHttp(400, 'vote_config', fn () => $this->start($b2, ['scope' => H::ulid(99)]));
        $this->h->sql->setDeleted($b2, '01JVFRAME0000000000000000F', true);
        $this->expectHttp(400, 'vote_config', fn () => $this->start($b2, ['scope' => '01JVFRAME0000000000000000F']));
        $this->h->sql->setDeleted($b2, '01JVFRAME0000000000000000F', false);
        $this->assertSame('01JVFRAME0000000000000000F', $this->h->votes->start(H::user(), $b2, ['scope' => '01JVFRAME0000000000000000F'], $this->h->now)['meta']['vote']['cfg']['scope']);
        $this->expectHttp(404, 'not_found', fn () => $this->start(9999));
    }

    public function testStartOnAnExpiredOpenSessionClosesItThenConflicts(): void {
        // R16: close (COMMIT), then 409 vote_open; the results are in meta.
        $b = $this->h->board(3);
        $sid = $this->start($b, ['minutes' => 1]);
        $this->apply($b, [H::vote($sid, 1, 1)]);
        $later = $this->h->now + 60001;
        $this->expectHttp(409, 'vote_open', fn () => $this->start($b, [], $later));
        $this->assertSame('closed', $this->h->session($sid)['state']);
        $this->assertSame([[H::ulid(1), 1]], $this->h->meta($b)['vote']['results']);
        $this->assertSame(0, $this->h->voteRows($sid));
        $this->assertSame($this->h->rev($b), (int)$this->h->sql->one('SELECT meta_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$b]));
        $this->assertTrue($this->h->allOutsideTransactions());
        // Now a new one starts.
        $this->assertNotSame($sid, $this->start($b, [], $later));
    }

    // ── votes ──────────────────────────────────────────────────────────────

    public function testSetSemanticsRepetitionAndShape(): void {
        $b = $this->h->board(3);
        $sid = $this->start($b, ['per' => 5, 'perItem' => 2]);
        $rev = $this->h->rev($b);
        $out = $this->apply($b, [H::vote($sid, 1, 2)]);
        $this->assertSame(['res' => ['ok'], 'sid' => $sid, 'mine' => [H::ulid(1) => 2], 'left' => 3], $out);
        // n: 2 again (a retry of the same seq): same state, counted once, nothing written.
        $this->h->log = [];
        $this->assertSame(['res' => ['ok'], 'sid' => $sid, 'mine' => [H::ulid(1) => 2], 'left' => 3], $this->apply($b, [H::vote($sid, 1, 2)]));
        $this->assertSame([], $this->h->log, 'no seq, no vt: (rolled back)');
        $this->assertSame(1, (int)$this->h->session($sid)['seq']);
        $this->assertSame([H::ulid(1) => 2], $this->h->store->rows($sid, H::user('vic', Role::Vote)->pid));
        // Set to 1, then 0: never a delta.
        $this->assertSame([H::ulid(1) => 1], $this->apply($b, [H::vote($sid, 1, 1)])['mine']);
        $out = $this->apply($b, [H::vote($sid, 1, 0)]);
        $this->assertSame(['ok'], $out['res']);
        $this->assertSame([], $out['mine'], 'mine empty (encoded as {} by the sync answer)');
        $this->assertSame(5, $out['left']);
        $this->assertSame(0, $this->h->voteRows($sid));
        $this->assertSame(3, (int)$this->h->session($sid)['seq'], 'one seq per effective batch');
        $this->assertSame($rev, $this->h->rev($b), 'votes never raise the board rev');
        $this->assertSame(['sid' => $sid, 'seq' => 3], $this->h->cache->getVoteSeq($b));
        $this->assertTrue($this->h->allOutsideTransactions());
    }

    public function testBudgetsInBatchOrderTypesAndScope(): void {
        $b = $this->h->sql->addBoard();
        $frame = '01JVFRAME0000000000000000F';
        $this->h->sql->addItem($b, $frame, 'frame');
        for ($i = 1; $i <= 4; $i++) {
            $this->h->sql->addItem($b, H::ulid($i), 'sticky', $i <= 3 ? $frame : null);
        }
        $this->h->sql->addItem($b, H::ulid(5), 'shape', $frame);
        $this->h->sql->addItem($b, H::ulid(6), 'sticky', null, true);
        $sid = $this->start($b, ['per' => 3, 'perItem' => 2, 'scope' => $frame]);
        $out = $this->apply($b, [
            H::vote($sid, 1, 3),        // > perItem
            H::vote($sid, 1, 2),        // ok (2 of 3)
            H::vote($sid, 2, 2),        // 2 + 2 > 3
            H::vote($sid, 2, 1),        // ok (3 of 3)
            H::vote($sid, 1, 1),        // ok: own item replaced, 1 + 1 = 2
            H::vote($sid, 3, 1),        // ok: 3
            H::vote($sid, 4, 1),        // outside the scope
            H::vote($sid, 5, 1),        // type not in cfg.types
            H::vote($sid, 6, 1),        // deleted
            H::vote($sid, 7, 1),        // never existed
            H::vote($sid, $frame, 1),   // the frame itself: not a sticky
            ['o' => 'vote', 's' => $sid, 'id' => 'nope', 'n' => 1],
        ]);
        $this->assertSame(['limit', 'ok', 'limit', 'ok', 'ok', 'ok', 'bad', 'bad', 'gone', 'gone', 'bad', 'bad'], $out['res']);
        $this->assertSame([H::ulid(1) => 1, H::ulid(2) => 1, H::ulid(3) => 1], $out['mine']);
        $this->assertSame(0, $out['left']);
        $this->assertSame(1, (int)$this->h->session($sid)['seq'], 'one batch, one seq');
        // Under the lock two tabs of the same voter cannot overspend: the budget is per pid.
        $this->assertSame(['limit'], $this->apply($b, [H::vote($sid, 1, 2)])['res']);
        // Another voter has their own budget.
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 1, 2)], H::guest())['res']);
    }

    public function testRolesAndClosedSessions(): void {
        $b = $this->h->board(2);
        $sid = $this->start($b);
        $this->assertSame(['denied'], $this->apply($b, [H::vote($sid, 1, 1)], H::user('val', Role::View))['res'], 'view may not vote');
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 1, 1)], H::user('ed', Role::Edit))['res']);
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 2, 1)], H::user())['res'], 'the owner votes too');
        // Only bad/denied: no transaction at all.
        $this->h->sql->log = [];
        $this->assertSame(['res' => ['bad', 'denied'], 'sid' => null, 'mine' => null, 'left' => null],
            $this->h->votes->apply(H::user(), $b, [['o' => 'bad'], ['o' => 'denied']], $this->h->now));
        $this->assertSame([], $this->h->sql->log);
        // A sid that never existed, of another board, or a closed session: closed (no mine/left).
        $other = $this->h->board(1);
        $sid2 = $this->start($other);
        $out = $this->apply($b, [H::vote(999, 1, 1), H::vote($sid2, 1, 1)]);
        $this->assertSame(['res' => ['closed', 'closed'], 'sid' => null, 'mine' => null, 'left' => null], $out);
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->assertSame(['res' => ['closed'], 'sid' => null, 'mine' => null, 'left' => null], $this->apply($b, [H::vote($sid, 1, 1)]));
        // A batch with a closed and the open session: the open one answers.
        $sid3 = $this->start($b);
        $out = $this->apply($b, [H::vote($sid, 1, 1), H::vote($sid3, 2, 1)]);
        $this->assertSame([['closed', 'ok'], $sid3, [H::ulid(2) => 1]], [$out['res'], $out['sid'], $out['mine']]);
    }

    public function testOnlyLiveItemsCount(): void {
        // R16 SRV-06: an item deleted during the session gives its votes back
        // (left + n, mine without it); n = 0 on it is ok and deletes the row;
        // n ≥ 1 stays gone; revived, its rows count again.
        $b = $this->h->board(3);
        $sid = $this->start($b, ['per' => 3, 'perItem' => 2]);
        $vic = H::user('vic', Role::Vote);
        $this->apply($b, [H::vote($sid, 1, 2), H::vote($sid, 2, 1)]);
        $this->h->sql->setDeleted($b, H::ulid(1), true);
        $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(2) => 1], 'left' => 2], $this->h->votes->mine($b, $vic->pid));
        $out = $this->apply($b, [H::vote($sid, 3, 2)]);
        $this->assertSame([['ok'], [H::ulid(2) => 1, H::ulid(3) => 2], 0], [$out['res'], $out['mine'], $out['left']], 'the deleted item does not block the budget');
        $this->assertSame(['gone'], $this->apply($b, [H::vote($sid, 1, 1)])['res']);
        // Revived (undo): its rows count again; the overdrawn budget is accepted, left never below 0.
        $this->h->sql->setDeleted($b, H::ulid(1), false);
        $this->assertSame(['sid' => $sid, 'mine' => [H::ulid(1) => 2, H::ulid(2) => 1, H::ulid(3) => 2], 'left' => 0], $this->h->votes->mine($b, $vic->pid));
        $this->assertSame(['limit'], $this->apply($b, [H::vote($sid, 2, 2)])['res'], 'new votes check against the valid state');
        $this->h->sql->setDeleted($b, H::ulid(1), true);
        $seq = (int)$this->h->session($sid)['seq'];
        $out = $this->apply($b, [H::vote($sid, 1, 0)]);
        $this->assertSame(['ok'], $out['res']);
        $this->assertArrayNotHasKey(H::ulid(1), $this->h->store->rows($sid, $vic->pid), 'the row on the deleted item is gone');
        $this->assertSame($seq + 1, (int)$this->h->session($sid)['seq'], 'the deleted row was written away');
        // n = 0 again on the deleted item: ok, nothing to write.
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 1, 0)])['res']);
        $this->assertSame($seq + 1, (int)$this->h->session($sid)['seq']);
        // n = 0 on an item that never existed stays gone.
        $this->assertSame(['gone'], $this->apply($b, [H::vote($sid, 77, 0)])['res']);
        // Votes on deleted items count neither in the results nor as a voter.
        $this->apply($b, [H::vote($sid, 2, 1)], H::guest('gDELETED0001'));
        $this->h->sql->setDeleted($b, H::ulid(2), true);
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $vote = $this->h->meta($b)['vote'];
        $this->assertSame([[[H::ulid(3), 2]], 1, 1], [$vote['results'], $vote['total'], $vote['voters']]);
    }

    public function testLoweringNeverFailsWithLimitR17K1(): void {
        // R17-K1 (R-B1): a vote op that does not raise the voter's sum — a
        // reduction or the same value — never fails with limit, also when an
        // undo overdrew `per` ("überschrittenes per wird hingenommen"); only
        // an increase checks perItem and per against the valid state.
        $b = $this->h->board(3);
        $sid = $this->start($b, ['per' => 3, 'perItem' => 2]);
        $vic = H::user('vic', Role::Vote);
        [$a, $bb, $c] = [H::ulid(1), H::ulid(2), H::ulid(3)];
        // Rows {A:2, B:1, C:2}, all live: A deleted meanwhile, C voted, A revived (undo).
        $this->assertSame(['ok', 'ok'], $this->apply($b, [H::vote($sid, 1, 2), H::vote($sid, 2, 1)])['res']);
        $this->h->sql->setDeleted($b, $a, true);
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 3, 2)])['res']);
        $this->h->sql->setDeleted($b, $a, false);
        $this->assertSame(['sid' => $sid, 'mine' => [$a => 2, $bb => 1, $c => 2], 'left' => 0], $this->h->votes->mine($b, $vic->pid), 'overdrawn: 5 of 3');
        // The same value on the overdrawn budget: ok, nothing written.
        $seq = (int)$this->h->session($sid)['seq'];
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 3, 2)])['res']);
        $this->assertSame($seq, (int)$this->h->session($sid)['seq'], 'same value: no write, no seq');
        // Take B back: ok, mine {A:2, C:2}, left 0 (never negative, B1).
        $this->assertSame(['res' => ['ok'], 'sid' => $sid, 'mine' => [$a => 2, $c => 2], 'left' => 0], $this->apply($b, [H::vote($sid, 2, 0)]));
        $this->assertSame([$a => 2, $c => 2], $this->h->store->rows($sid, $vic->pid), 'the row on B is deleted');
        $this->assertSame($seq + 1, (int)$this->h->session($sid)['seq']);
        // B again (an increase): 4 + 1 > 3 → limit, nothing changes.
        $out = $this->apply($b, [H::vote($sid, 2, 1)]);
        $this->assertSame([['limit'], [$a => 2, $c => 2], 0], [$out['res'], $out['mine'], $out['left']]);
        $this->assertSame($seq + 1, (int)$this->h->session($sid)['seq']);
        // Lower A from 2 to 1: ok while still at the limit (3 of 3).
        $out = $this->apply($b, [H::vote($sid, 1, 1)]);
        $this->assertSame([['ok'], [$a => 1, $c => 2], 0], [$out['res'], $out['mine'], $out['left']]);
        // In batch order: an increase first is limit, after a reduction it fits.
        $out = $this->apply($b, [H::vote($sid, 2, 1), H::vote($sid, 3, 1), H::vote($sid, 2, 1), H::vote($sid, 3, 2)]);
        $this->assertSame([['limit', 'ok', 'ok', 'limit'], [$a => 1, $bb => 1, $c => 1], 0], [$out['res'], $out['mine'], $out['left']]);
        // Within one batch a take-back and a raise on the same item: the raise checks against the batch state.
        $out = $this->apply($b, [H::vote($sid, 2, 0), H::vote($sid, 1, 2)]);
        $this->assertSame([['ok', 'ok'], [$a => 2, $c => 1], 0], [$out['res'], $out['mine'], $out['left']]);
    }

    public function testLoweringStaysOkOutsideTheScopeR17K2(): void {
        // R17-K2 (R-O1): an editor moves a voted item N out of the scope frame
        // during the session. Lowering and taking back stay ok on N (type and
        // scope are checked only for an increase); an increase is bad. The
        // rows on N keep counting in mine, left, voters, the tally and the
        // results (no scope filter on counting).
        $frame = '01JVFRAME0000000000000000F';
        $b = $this->h->board(3, 3, $frame);
        $sid = $this->start($b, ['per' => 5, 'perItem' => 3, 'scope' => $frame]);
        $vic = H::user('vic', Role::Vote);
        $gina = H::guest('gGINA0000001');
        $n = H::ulid(1);
        $out = $this->apply($b, [H::vote($sid, 1, 3), H::vote($sid, 2, 1)]);
        $this->assertSame([['ok', 'ok'], 1], [$out['res'], $out['left']]);
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 1, 2)], $gina)['res']);
        // The editor moves N out of the frame: a placement patch through /sync.
        $rev = $this->h->rev($b);
        $d = $this->h->syncDecoded(['seq' => 1, 'since' => $rev, 'ops' => [
            ['o' => 'patch', 'id' => $n, 'p' => ['x' => 900, 'y' => 900, 'parent' => null]],
        ]], H::user('ed', Role::Edit), $b);
        $this->assertSame(['ok'], $d['acks']['res']);
        $this->assertNull($this->h->store->items($b, [$n])[$n]['parent_id'], 'N lies outside the frame now');
        // N keeps counting: mine, left, voters and the tally.
        $this->assertSame(['sid' => $sid, 'mine' => [$n => 3, H::ulid(2) => 1], 'left' => 1], $this->h->votes->mine($b, $vic->pid));
        $this->assertSame([$n => 5, H::ulid(2) => 1], $this->h->store->tally($sid));
        $this->assertSame(2, $this->h->store->voters($sid));
        // An increase on N is bad (scope), also for a voter without a row there.
        $this->assertSame(['bad'], $this->apply($b, [H::vote($sid, 1, 3)], $gina)['res'], 'in the frame 3 would fit perItem and per');
        $this->assertSame(['bad'], $this->apply($b, [H::vote($sid, 1, 1)], H::guest('gNOROW000001'))['res']);
        // The same value and n = 0 without a row: ok (nothing raised).
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 1, 2)], $gina)['res']);
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 1, 0)], H::guest('gNOROW000001'))['res']);
        // A reduction: ok; raising it back afterwards is an increase again → bad.
        $out = $this->apply($b, [H::vote($sid, 1, 1)], $gina);
        $this->assertSame([['ok'], [$n => 1], 4], [$out['res'], $out['mine'], $out['left']]);
        $this->assertSame(['bad'], $this->apply($b, [H::vote($sid, 1, 2)], $gina)['res']);
        // Take back: ok, the row is gone, left grows by the old n (1 → 4).
        $seq = (int)$this->h->session($sid)['seq'];
        $out = $this->apply($b, [H::vote($sid, 1, 0)]);
        $this->assertSame(['res' => ['ok'], 'sid' => $sid, 'mine' => [H::ulid(2) => 1], 'left' => 4], $out);
        $this->assertArrayNotHasKey($n, $this->h->store->rows($sid, $vic->pid));
        $this->assertSame($seq + 1, (int)$this->h->session($sid)['seq']);
        // The freed budget goes to an item in the frame; the results count N (Gina's 1) too.
        $this->assertSame(['ok'], $this->apply($b, [H::vote($sid, 3, 2)])['res']);
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $vote = $this->h->meta($b)['vote'];
        $this->assertSame([[[H::ulid(3), 2], [$n, 1], [H::ulid(2), 1]], 3, 2], [$vote['results'], $vote['total'], $vote['voters']]);
    }

    public function testExpiredSessionClosesOnTheVotePath(): void {
        // Path (a): a vote op sees the end → close, ops closed.
        $b = $this->h->board(2);
        $sid = $this->start($b, ['minutes' => 1]);
        $this->apply($b, [H::vote($sid, 1, 1)]);
        $rev = $this->h->rev($b);
        $this->h->log = [];
        $out = $this->apply($b, [H::vote($sid, 2, 1)], null, $this->h->now + 60000);
        $this->assertSame(['res' => ['closed'], 'sid' => null, 'mine' => null, 'left' => null], $out);
        $this->assertSame('closed', $this->h->session($sid)['state']);
        $this->assertSame($rev + 1, $this->h->rev($b), 'the close is a meta write');
        $this->assertSame(['bumpRev ' . ($rev + 1) . ' tx=0'], $this->h->log, 'after the COMMIT');
        $this->assertSame([[H::ulid(1), 1]], $this->h->meta($b)['vote']['results']);
    }

    // ── close ──────────────────────────────────────────────────────────────

    public function testCloseRankingCapAndAnonymity(): void {
        $b = $this->h->sql->addBoard();
        $n = Limits::VOTE_RESULTS_IN_META + 5;
        for ($i = 1; $i <= $n; $i++) {
            $this->h->sql->addItem($b, H::ulid($i), 'sticky');
        }
        $sid = $this->start($b, ['per' => 99, 'perItem' => 3]);
        // Voter A: 3 on item 5, 2 on 4, 1 on every other item: the budget of 99 ends at item 96.
        $ops = [];
        for ($i = 1; $i <= 99; $i++) {
            $ops[] = H::vote($sid, $i, $i === 5 ? 3 : ($i === 4 ? 2 : 1));
        }
        $this->assertSame(array_merge(array_fill(0, 96, 'ok'), ['limit', 'limit', 'limit']), $this->apply($b, $ops, H::guest('gAAAAAAAAAA1'))['res']);
        // More voters over the rest (1 each), so more than VOTE_RESULTS_IN_META items have votes.
        $k = 97;
        for ($g = 2; $k <= $n; $g++) {
            $ops = [];
            for ($j = 0; $j < 99 && $k <= $n; $j++, $k++) {
                $ops[] = H::vote($sid, $k, 1);
            }
            $this->apply($b, $ops, H::guest(sprintf('gAAAAAAAAA%02d', $g)));
        }
        $this->apply($b, [H::vote($sid, 3, 3)], H::guest('gBBBBBBBBBB1'));
        $rev = $this->h->rev($b);
        $this->h->votes->close($b, $sid, $this->h->now + 5);
        $vote = $this->h->meta($b)['vote'];
        $this->assertSame('closed', $vote['state']);
        $this->assertSame([[H::ulid(3), 4], [H::ulid(5), 3], [H::ulid(4), 2], [H::ulid(1), 1]], array_slice($vote['results'], 0, 4), 'n desc, then id');
        $this->assertCount(Limits::VOTE_RESULTS_IN_META, $vote['results'], 'capped');
        $this->assertSame($n, $vote['total'], 'total counts beyond the cap');
        $this->assertSame([$this->h->now + 5, 7], [$vote['closedAt'], $vote['voters']], 'A, five guests over the rest, B');
        $this->assertSame(['sid', 'state', 'cfg', 'startedAt', 'endsAt', 'by', 'show', 'results', 'total', 'voters', 'closedAt'], array_keys($vote));
        $row = $this->h->session($sid);
        $this->assertSame(['closed', $vote['voters'], $this->h->now + 5], [$row['state'], (int)$row['voters'], (int)$row['closed_at']]);
        $stored = json_decode($row['results'], true);
        $this->assertCount($n, $stored, 'the session row keeps every item');
        $this->assertSame(4, $stored[H::ulid(3)]);
        $this->assertSame(0, $this->h->voteRows($sid), 'only sums survive the close (§7.2)');
        $this->assertSame($rev + 1, $this->h->rev($b));
        $this->assertLessThanOrEqual(Limits::MAX_META_BYTES, strlen((string)$this->h->sql->one('SELECT meta FROM *PREFIX*knorke_boards WHERE id = ?', [$b])));
    }

    public function testFourClosePathsCloseOnce(): void {
        // (a) vote op, (b) moderator progress, (c) end, (d) the job: one
        // result, one meta write; the others see the closed session.
        $b = $this->h->board(2);
        $sid = $this->start($b, ['minutes' => 1]);
        $this->apply($b, [H::vote($sid, 1, 1)]);
        $rev = $this->h->rev($b);
        $late = $this->h->now + 60000;
        $this->assertSame(1, $this->h->votes->closeExpired($late), '(d) closes');
        $meta = $this->h->meta($b);
        $this->assertSame(['closed'], $this->apply($b, [H::vote($sid, 2, 1)], null, $late)['res'], '(a) sees it closed');
        $this->assertNull($this->h->votes->progress(H::user(), $b, 1, $late), '(b) nothing open');
        $this->expectHttp(409, 'vote_closed', fn () => $this->h->votes->update(H::user(), $b, 'end', null, $late));
        $this->h->votes->close($b, $sid, $late);
        $this->assertSame(0, $this->h->votes->closeExpired($late));
        $this->assertSame([$rev + 1, $meta], [$this->h->rev($b), $this->h->meta($b)], 'exactly one close');
        // Each path closes on its own, too.
        foreach (['a', 'b', 'c', 'd'] as $way) {
            $sid = $this->start($b, ['minutes' => 1], $late);
            $this->apply($b, [H::vote($sid, 2, 1)], null, $late);
            $t = $late + 60000;
            match ($way) {
                'a' => $this->assertSame(['closed'], $this->apply($b, [H::vote($sid, 1, 1)], null, $t)['res']),
                'b' => $this->assertNull($this->h->votes->progress(H::user(), $b, 0, $t)),
                'c' => $this->assertSame('closed', $this->h->votes->update(H::user(), $b, 'end', null, $t)['meta']['vote']['state']),
                'd' => $this->assertSame(1, $this->h->votes->closeExpired($t)),
            };
            $this->assertSame([[H::ulid(2), 1]], $this->h->meta($b)['vote']['results'], $way);
            $this->assertSame('closed', $this->h->session($sid)['state'], $way);
            $this->assertSame(0, $this->h->voteRows($sid), $way);
            $late = $t;
        }
        $this->assertTrue($this->h->allOutsideTransactions());
    }

    public function testVoteCloseJobRunsCloseExpired(): void {
        $b = $this->h->board(1);
        $sid = $this->start($b, ['minutes' => 1]);
        $ms = $this->h->now + 60000;
        $time = Fake::of(ITimeFactory::class, ['now' => fn () => (new \DateTimeImmutable())->setTimestamp(intdiv($ms, 1000))->modify('+' . ($ms % 1000) . ' milliseconds')]);
        $job = new VoteCloseJob($time, $this->h->votes);
        (new \ReflectionMethod($job, 'run'))->invoke($job, null);
        $this->assertSame('closed', $this->h->session($sid)['state']);
        // A session row of a board that is gone is closed without meta (no retry forever).
        $this->h->sql->pdo->exec("INSERT INTO oc_knorke_vote_sessions (board_id, state, config, started_by, started_at, ends_at) VALUES (4242, 'open', '{}', 'u:x', 0, 1)");
        $this->assertSame(0, $this->h->votes->closeExpired($ms));
        $this->assertSame(0, (int)$this->h->sql->one("SELECT COUNT(*) FROM *PREFIX*knorke_vote_sessions WHERE state = 'open'"));
    }

    // ── update (route 23) ──────────────────────────────────────────────────

    public function testExtend(): void {
        $b = $this->h->board(1);
        $this->expectHttp(409, 'vote_closed', fn () => $this->h->votes->update(H::user(), $b, 'extend', 5, $this->h->now));
        $sid = $this->start($b, ['minutes' => 10]);
        $out = $this->h->votes->update(H::user(), $b, 'extend', 5, $this->h->now + 1000);
        $this->assertSame($this->h->now + 900000, $out['meta']['vote']['endsAt'], 'max(ends_at, now) + minutes');
        $this->assertSame($this->h->now + 900000, (int)$this->h->session($sid)['ends_at']);
        $out = $this->h->votes->update(H::user(), $b, 'extend', 5, $this->h->now + 2000);
        $this->assertSame($this->h->now + 1200000, $out['meta']['vote']['endsAt'], 'extend acts per call (not idempotent, R16)');
        foreach ([null, 0, 1441] as $m) {
            $this->expectHttp(400, 'vote_config', fn () => $this->h->votes->update(H::user(), $b, 'extend', $m, $this->h->now));
        }
        $this->expectHttp(400, 'bad_request', fn () => $this->h->votes->update(H::user(), $b, 'stop', null, $this->h->now));
        // Unlimited session: from now.
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->start($b);
        $this->assertSame($this->h->now + 3000 + 60000, $this->h->votes->update(H::user(), $b, 'extend', 1, $this->h->now + 3000)['meta']['vote']['endsAt']);
        // Expired: closed and COMMITTED, then 409 vote_closed (R2, R16).
        $sid = (int)$this->h->sql->one("SELECT id FROM *PREFIX*knorke_vote_sessions WHERE board_id = ? AND state = 'open'", [$b]);
        $this->h->log = [];
        $this->expectHttp(409, 'vote_closed', fn () => $this->h->votes->update(H::user(), $b, 'extend', 5, $this->h->now + 3000 + 60000));
        $this->assertSame('closed', $this->h->session($sid)['state']);
        $this->assertSame('closed', $this->h->meta($b)['vote']['state']);
        $this->assertSame(['bumpRev ' . $this->h->rev($b) . ' tx=0'], $this->h->log);
    }

    public function testShowHideClear(): void {
        $b = $this->h->board(1);
        foreach (['show', 'hide', 'clear', 'end'] as $a) {
            $this->expectHttp(409, 'vote_closed', fn () => $this->h->votes->update(H::user(), $b, $a, null, $this->h->now));
        }
        $this->start($b);
        // show/hide act on an open session too; the same value writes nothing (R16).
        $rev = $this->h->rev($b);
        $out = $this->h->votes->update(H::user(), $b, 'hide', null, $this->h->now);
        $this->assertSame([$rev, false], [$out['metaRev'], $out['meta']['vote']['show']], 'no-op: the stored state');
        $this->assertSame($rev, $this->h->rev($b));
        $out = $this->h->votes->update(H::user(), $b, 'show', 99, $this->h->now);
        $this->assertSame([$rev + 1, true], [$out['metaRev'], $out['meta']['vote']['show']], 'minutes ignored');
        $this->assertSame($rev + 1, $this->h->votes->update(H::user(), $b, 'show', null, $this->h->now)['metaRev'], 'idempotent');
        $this->expectHttp(409, 'vote_closed', fn () => $this->h->votes->update(H::user(), $b, 'clear', null, $this->h->now));
        $this->h->votes->update(H::user(), $b, 'end', null, $this->h->now);
        $this->assertTrue($this->h->meta($b)['vote']['show'], 'show survives the close');
        $out = $this->h->votes->update(H::user(), $b, 'hide', null, $this->h->now);
        $this->assertFalse($out['meta']['vote']['show']);
        $out = $this->h->votes->update(H::user(), $b, 'clear', null, $this->h->now);
        $this->assertArrayNotHasKey('vote', $out['meta']);
        $this->assertSame(1, (int)$this->h->sql->one('SELECT COUNT(*) FROM *PREFIX*knorke_vote_sessions WHERE board_id = ?', [$b]), 'the row stays');
        $this->expectHttp(409, 'vote_closed', fn () => $this->h->votes->update(H::user(), $b, 'clear', null, $this->h->now));
        $this->assertTrue($this->h->allOutsideTransactions());
    }

    // ── progress, mine, deleted accounts ───────────────────────────────────

    public function testProgress(): void {
        $b = $this->h->board(2);
        $this->assertNull($this->h->votes->progress(H::user(), $b, 0, $this->h->now));
        $sid = $this->start($b, ['minutes' => 1]);
        $this->apply($b, [H::vote($sid, 1, 1)]);
        $this->apply($b, [H::vote($sid, 2, 1)], H::guest());
        $this->h->mem->data = [];
        $this->assertSame(['sid' => $sid, 'voters' => 2, 'vt' => 2], $this->h->votes->progress(H::user(), $b, 0, $this->h->now));
        $this->assertSame(['sid' => $sid, 'seq' => 2], $this->h->cache->getVoteSeq($b), 'seeded again (TTL, epoch rotation)');
        // Expired: closed (path b), no voters in this answer.
        $this->assertNull($this->h->votes->progress(H::user(), $b, 2, $this->h->now + 60000));
        $this->assertSame('closed', $this->h->session($sid)['state']);
    }

    public function testUserDeletedRemovesTheVotesOfThePid(): void {
        $b1 = $this->h->board(2);
        $b2 = $this->h->board(2);
        $s1 = $this->start($b1);
        $s2 = $this->start($b2);
        $dora = H::user('dora', Role::Edit);
        $pids = [$b1 => 'pid-b1-dora0000', $b2 => 'pid-b2-dora0000'];
        $as = static fn (int $b): \OCA\Knorke\Service\Principal => new \OCA\Knorke\Service\Principal('u:dora', Role::Edit, 'Dora', $pids[$b], false, 'dora', 'share');
        $this->apply($b1, [H::vote($s1, 1, 1)], $as($b1));
        $this->apply($b1, [H::vote($s1, 2, 1)], $dora);
        $this->apply($b2, [H::vote($s2, 1, 1)], H::guest());
        $seq = (int)$this->h->session($s1)['seq'];
        $this->h->log = [];
        $this->h->votes->onUserDeleted('dora', static fn (int $b): string => $pids[$b]);
        $this->assertSame([], $this->h->store->rows($s1, $pids[$b1]));
        $this->assertSame([H::ulid(2) => 1], $this->h->store->rows($s1, $dora->pid), 'another pid stays');
        $this->assertSame($seq + 1, (int)$this->h->session($s1)['seq']);
        $this->assertSame(1, (int)$this->h->session($s2)['seq'], 'a board without her votes is untouched');
        $this->assertSame(['setVoteSeq ' . $s1 . ':' . ($seq + 1) . ' tx=0'], $this->h->log, 'R16: after the COMMIT');
        // A failure is logged, never thrown.
        $this->h->votes->onUserDeleted('dora', static fn (int $b): string => throw new \RuntimeException('boom'));
        $this->assertCount(2, $this->h->warnings);
    }

    public function testDeleteBoardRowsTakesSessionsAndVotes(): void {
        $b = $this->h->board(1);
        $keep = $this->h->board(1);
        $sid = $this->start($b);
        $other = $this->start($keep);
        $this->apply($b, [H::vote($sid, 1, 1)]);
        $this->apply($keep, [H::vote($other, 1, 1)]);
        $this->h->boards->deleteBoardRows($b);
        $this->assertSame([0, 0], [(int)$this->h->sql->one('SELECT COUNT(*) FROM *PREFIX*knorke_vote_sessions WHERE board_id = ?', [$b]), $this->h->voteRows($sid)]);
        $this->assertSame(1, $this->h->voteRows($other));
    }

    public function testMetaWriteNeverInsideATransaction(): void {
        // R16 SRV-02: MetaService::write refuses an open transaction (a nested
        // atomic() is a SAVEPOINT, bumpRev would come before the COMMIT);
        // writeLocked refuses to run without one.
        $b = $this->h->board(0);
        $this->h->db->beginTransaction();
        try {
            $this->h->meta->write($b, static fn (array $m): array => $m, $this->h->now);
            $this->fail('write inside a transaction');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('open transaction', $e->getMessage());
        } finally {
            $this->h->db->rollBack();
        }
        $this->expectException(\LogicException::class);
        $this->h->meta->writeLocked($b, static fn (array $m): array => $m, $this->h->now);
    }

    public function testVotingOnALockedItemWorks(): void {
        // Job 023 (AK3): vote ops go through VoteService and never see the
        // lock; an edit of the same item stays itemlocked.
        $b = $this->h->board(2);
        $sid = $this->start($b, ['per' => 5, 'perItem' => 2]);
        $n = H::ulid(1);
        $ed = H::user('ed', Role::Edit);
        $d = $this->h->syncDecoded(['seq' => 1, 'ops' => [['o' => 'patch', 'id' => $n, 'p' => ['lock' => ['by' => 'x', 'name' => 'y']]]]], $ed, $b);
        $this->assertSame(['ok'], $d['acks']['res']);
        $this->assertSame(1, (int)$this->h->sql->one('SELECT locked FROM *PREFIX*knorke_items WHERE board_id = ? AND id = ?', [$b, $n]));
        $d = $this->h->syncDecoded(['seq' => 1, 'ops' => [H::vote($sid, 1, 2)]], H::user('vic', Role::Vote), $b);
        $this->assertSame(['ok'], $d['acks']['res'], 'a vote on the locked note');
        $this->assertSame([$n => 2], $this->h->store->tally($sid));
        $d = $this->h->syncDecoded(['seq' => 2, 'ops' => [['o' => 'patch', 'id' => $n, 'p' => ['style.fill' => '#ffffff']], H::vote($sid, 1, 1)]], $ed, $b);
        $this->assertSame(['itemlocked', 'ok'], $d['acks']['res'], 'the edit is refused, the vote of the same request counts');
    }
}
