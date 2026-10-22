<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\SyncHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * The write budget on the sync path (SPEC-M1 §4.13.6, §4.5, §4.6; C76 in
 * small): over BUDGET_SYNCS or BUDGET_OPS every op of the request answers
 * `busy` (never mixed, R19 T4-18), nothing is applied (no lock, no vote
 * path), acks.rev = null, acks.retryMs = (floor(now/10000) + 1)·10000 − now
 * + 100 with `now` of the same answer; reading, items and presence go on;
 * an empty poll costs nothing; derived rows (keep shift, release of
 * children and connector ends) count on wo: and make the NEXT request busy.
 * The harness clock is fixed ($h->now), so every request falls into the
 * same window — no wall clock.
 */
final class SyncBudgetTest extends TestCase {
    private H $h;

    protected function setUp(): void {
        $this->h = new H();
        $this->h->store->addBoard(1, 42);
        $this->h->now = 1_760_000_003_456;
    }

    private static function id(int $n): string {
        return sprintf('01JD%022d', $n);
    }

    private function op(int $n): array {
        return H::put(self::id($n), H::sticky());
    }

    private function sync(array $ops, int $seq, ?\OCA\Knorke\Service\Principal $p = null, int $pres = 0): array {
        return $this->h->syncDecoded(['since' => 42, 'seq' => $seq, 'ops' => $ops, 'pres' => $pres], $p);
    }

    public function testSixtyFirstRequestWithOpsIsBusy(): void {
        for ($i = 1; $i <= 60; $i++) {
            $d = $this->sync([$this->op($i)], $i);
            $this->assertSame(['ok'], $d['acks']['res'], "request $i");
        }
        $rows = count($this->h->store->items[1]);
        $this->h->log = [];
        $raw = $this->h->syncRaw(['since' => 42, 'seq' => 61, 'ops' => [$this->op(61), $this->op(62)], 'pres' => 1]);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $now = $d['now'];
        $this->assertSame(['seq' => 61, 'rev' => null, 'res' => ['busy', 'busy'], 'retryMs' => (intdiv($now, 10000) + 1) * 10000 - $now + 100], $d['acks']);
        $this->assertSame(6644, $d['acks']['retryMs'], 'now …3456 → 100 ms into the next window');
        $this->assertStringContainsString(',"acks":{"seq":61,"rev":null,"res":["busy","busy"],"retryMs":6644}', $raw, 'key order seq, rev, res, retryMs');
        $this->assertNotContains('lockAndBumpRev', $this->h->log, 'nothing applied: no transaction at all');
        $this->assertCount($rows, $this->h->store->items[1]);
        $this->assertCount(60, $d['items'], 'the read goes on: the page of the 60 earlier puts');
        $this->assertSame([], $d['presence'], 'presence goes on');
        $this->assertSame(102, $d['rev']);
        // The same window: a single op is busy too; the next window is free again.
        $this->assertSame(['busy'], $this->sync([$this->op(63)], 62)['acks']['res']);
        $this->h->now += 10000 - 3456;
        $this->assertSame(['ok'], $this->sync([$this->op(63)], 62)['acks']['res'], 'next window: ok, same seq retried');
    }

    public function testRetryMsUsesTheNowOfTheSameAnswer(): void {
        // C76 (R19): retryMs = (floor(now/10000) + 1)·10000 − now + 100 with
        // `now` of the SAME answer — built later than the request time; here
        // the answer's clock is 1234 ms later (still in the window).
        $this->h->app['budget_syncs'] = 1;
        $this->sync([$this->op(1)], 1);
        $this->h->sync->clock = $this->h->now + 1234;
        $d = $this->sync([$this->op(2)], 2);
        $this->assertSame([$this->h->now + 1234, 6644 - 1234], [$d['now'], $d['acks']['retryMs']]);
        // An answer built in the next window: retryMs counts from that now (never negative).
        $this->h->sync->clock = $this->h->now + 6600;
        $d = $this->sync([$this->op(3)], 3);
        $this->assertSame(['busy'], $d['acks']['res'], 'the request time decides the window of the counters');
        $this->assertSame((intdiv($d['now'], 10000) + 1) * 10000 - $d['now'] + 100, $d['acks']['retryMs']);
        $this->assertSame(10000 - 56 + 100, $d['acks']['retryMs']);
    }

    public function testTwoThousandOpsThenOneMoreIsBusy(): void {
        for ($i = 0; $i < 10; $i++) {
            $ops = [];
            for ($j = 0; $j < 200; $j++) {
                $ops[] = H::patch(self::id(1), ['data.text' => 't' . ($i * 200 + $j)]);
            }
            if ($i === 0) {
                $ops[0] = $this->op(1);
            }
            $this->assertSame(array_fill(0, 200, 'ok'), $this->sync($ops, $i + 1)['acks']['res'], "batch $i of 200 ops");
        }
        $d = $this->sync([H::patch(self::id(1), ['data.text' => 'last'])], 11);
        $this->assertSame(['seq' => 11, 'rev' => null, 'res' => ['busy']], array_diff_key($d['acks'], ['retryMs' => 1]), 'the 2001st op');
    }

    public function testEmptyPollsAreFreeAndCreateNoKey(): void {
        for ($i = 1; $i <= 61; $i++) {
            $this->sync([$this->op($i)], $i);
        }
        $this->h->mem->log = [];
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 1]);
        $this->assertArrayNotHasKey('acks', $d);
        $this->assertSame(102, $d['rev']);
        $this->assertSame([], array_values(array_filter($this->h->mem->log, static fn (string $l): bool => (bool)preg_match('/ wo?:/', $l))),
            'an empty poll touches no w:/wo: key (C76 (d))');
    }

    public function testBusyIsNeverMixedAndSkipsTheVotePath(): void {
        // T4-18: object and vote ops in one request over the budget → all busy, the vote path never runs.
        $this->h->app['budget_syncs'] = 1;
        $this->sync([$this->op(1)], 1);
        $this->h->log = [];
        $d = $this->sync([$this->op(2), ['o' => 'vote', 's' => 3, 'id' => self::id(1), 'n' => 1], $this->op(3)], 2);
        $this->assertSame(['busy', 'busy', 'busy'], $d['acks']['res']);
        $this->assertNull($d['acks']['rev']);
        $this->assertArrayNotHasKey('votes', $d);
        $this->assertSame([], array_values(array_filter($this->h->log, static fn (string $l): bool => str_starts_with($l, 'votes.apply') || $l === 'lockAndBumpRev')));
        // Under the budget the same request is applied as usual (no busy in it).
        $this->h->now += 10000;
        $d = $this->sync([$this->op(2), ['o' => 'vote', 's' => 3, 'id' => self::id(1), 'n' => 1], $this->op(3)], 2);
        $this->assertSame(['ok', 'closed', 'ok'], $d['acks']['res']);
    }

    public function testBudgetPerBoardAndPid(): void {
        $this->h->app['budget_syncs'] = 2;
        $this->h->store->addBoard(2, 42);
        $this->sync([$this->op(1)], 1);
        $this->sync([$this->op(2)], 2);
        $this->assertSame(['busy'], $this->sync([$this->op(3)], 3)['acks']['res'], 'alice on board 1');
        $bob = H::user('bob', Role::Edit);
        $this->assertSame(['ok'], $this->sync([$this->op(4)], 1, $bob)['acks']['res'], 'another pid: its own budget');
        $guest = H::guest();
        $this->assertSame(['ok'], $this->sync([$this->op(5)], 1, $guest)['acks']['res'], 'a guest counts per gid');
        $d = $this->h->syncDecoded(['since' => 42, 'seq' => 4, 'ops' => [$this->op(6)], 'pres' => 0], null, null, 0, 2);
        $this->assertSame(['ok'], $d['acks']['res'], 'alice on board 2: its own budget');
        $this->assertSame(25, $this->h->mem->ttl('w:1:' . H::user()->pid . ':' . intdiv($this->h->now, 10000)), 'window keys live 25 s');
        $this->assertSame(25, $this->h->mem->ttl('wo:1:' . H::user()->pid . ':' . intdiv($this->h->now, 10000)));
    }

    public function testWithoutRedisThereIsNoBudget(): void {
        $off = new H(false);
        $off->store->addBoard(1, 42);
        $off->app['budget_syncs'] = 1;
        for ($i = 1; $i <= 5; $i++) {
            $d = $off->syncDecoded(['since' => 42, 'seq' => $i, 'ops' => [H::put(self::id($i), H::sticky())], 'pres' => 0]);
            $this->assertSame(['ok'], $d['acks']['res']);
        }
    }

    public function testDerivedRowsOfKeepMakeTheNextRequestBusy(): void {
        // C76 (c) in small: budget_ops 50, a frame with 60 children; the keep
        // patch itself is ok (never refused afterwards), its 60 derived rows
        // go on wo: and the NEXT request of the same principal is busy.
        $this->h->app['budget_ops'] = 50;
        $f = self::id(900);
        $this->h->store->seed(1, $f, ['t' => 'frame', 'x' => 1000, 'y' => 500, 'w' => 4000, 'h' => 4000, 'data' => ['title' => 'F']], 10);
        for ($i = 0; $i < 60; $i++) {
            $this->h->store->seed(1, self::id($i + 1), ['t' => 'sticky', 'parent' => $f, 'x' => 10 + $i, 'y' => 10], 11);
        }
        $d = $this->sync([H::patch($f, ['x' => 900, 'y' => 400, 'parent' => null], true)], 1);
        $this->assertSame(['ok'], $d['acks']['res'], 'the keep patch itself');
        $this->assertCount(61, $this->h->store->changes, 'one change row for the frame, 60 derived ones for its children');
        $this->assertSame(61, $this->h->mem->get('wo:1:' . H::user()->pid . ':' . intdiv($this->h->now, 10000)), '1 op + 60 derived rows');
        $this->assertSame(['busy'], $this->sync([H::patch(self::id(1), ['data.text' => 'n'])], 2)['acks']['res'], 'the next request');
        $this->assertSame(['ok'], $this->sync([H::patch(self::id(1), ['data.text' => 'n'])], 2, H::user('bob', Role::Edit))['acks']['res'], 'another principal is not charged');
    }

    public function testDerivedRowsAreCountedPerKind(): void {
        // applyOpsCounted: rows of items no op changed with `ok`.
        $f = self::id(900);
        $s1 = self::id(1);
        $s2 = self::id(2);
        $k = self::id(3);
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($s1, H::sticky(['parent' => $f, 'x' => 5, 'y' => 5])), H::put($s2, H::sticky(['parent' => $f, 'x' => 9, 'y' => 9]))]);
        [, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::patch($f, ['x' => 1100, 'y' => 500, 'parent' => null], true)], $this->h->now);
        $this->assertSame([['ok'], 2], [$res, $derived], 'keep: two children shifted');
        [, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::patch($f, ['x' => 1200, 'y' => 500, 'parent' => null], true), H::patch($s1, ['data.text' => 'own op'])], $this->h->now);
        $this->assertSame([['ok', 'ok'], 1], [$res, $derived], 'a shifted child with its own ok op is not derived');
        $this->h->apply([H::put($k, H::connector(['item' => $s2], ['x' => 0, 'y' => 0]), 'connector')]);
        [, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::remove($f)], $this->h->now);
        $this->assertSame([['ok'], 2], [$res, $derived], 'remove a frame: two children released to the root');
        [, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::remove($s2)], $this->h->now);
        $this->assertSame([['ok'], 1], [$res, $derived], 'remove a bound item: one connector end released');
        [, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::patch($s1, ['data.text' => 'plain'])], $this->h->now);
        $this->assertSame(0, $derived, 'a plain patch derives nothing');
        [$rev, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::patch(self::id(77), ['data.text' => 'x'])], $this->h->now);
        $this->assertSame([['gone'], 0], [$res, $derived], 'nothing written, nothing derived');
        $this->assertSame([$rev, $res], $this->h->sync->applyOps(H::user(), 1, 'cTest', [H::patch(self::id(77), ['data.text' => 'x'])], $this->h->now), 'applyOps keeps its shape');
    }

    // ---- P7: the daily byte quota on the sync path (SPEC-M1 §33.1 b, C81 in small) ----

    /** A put of a sticky with a text of about $n bytes (the request body is ≈ $n + 150 bytes). */
    private function bigOp(int $id, int $n): array {
        return H::put(self::id($id), H::sticky(['data' => ['text' => str_repeat('x', $n)]]));
    }

    public function testBoardDayQuotaMakesTheWholeRequestBusy(): void {
        $this->h->app['budget_bytes_board_day'] = '4000';
        $this->assertSame(['ok'], $this->sync([$this->bigOp(1, 1400)], 1)['acks']['res']);
        $this->assertSame(['ok'], $this->sync([$this->bigOp(2, 1400)], 2)['acks']['res']);
        $rows = count($this->h->store->items[1]);
        $this->h->log = [];
        $this->h->sync->clock = $this->h->now + 777;
        $raw = $this->h->syncRaw(['since' => 42, 'seq' => 3, 'ops' => [$this->bigOp(3, 1400), ['o' => 'vote', 's' => 3, 'id' => self::id(1), 'n' => 1]], 'pres' => 1]);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $now = $d['now'];
        $this->assertSame($this->h->now + 777, $now);
        $this->assertSame(['seq' => 3, 'rev' => null, 'res' => ['busy', 'busy'], 'retryMs' => min((intdiv($now, 86400000) + 1) * 86400000 - $now, 60000) + 100], $d['acks'],
            'the third request (> 4000 bytes): every op busy, acks.rev null, retryMs of the day with now of this answer');
        $this->assertLessThanOrEqual(60100, $d['acks']['retryMs']);
        $this->assertSame([], array_values(array_filter($this->h->log, static fn (string $l): bool => $l === 'lockAndBumpRev' || str_starts_with($l, 'votes.apply'))), 'nothing applied');
        $this->assertCount($rows, $this->h->store->items[1]);
        $this->assertSame([], $d['presence'], 'presence goes on');
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 1]);
        $this->assertArrayNotHasKey('acks', $d, 'an empty poll gets a normal answer');
        $this->h->store->addBoard(2, 42);
        $d = $this->h->syncDecoded(['since' => 42, 'seq' => 4, 'ops' => [$this->bigOp(4, 1400)], 'pres' => 0], null, null, 0, 2);
        $this->assertSame(['ok'], $d['acks']['res'], 'the same account on another board');
    }

    public function testUserDayQuotaAndTheLargerRetryMs(): void {
        $this->h->app['budget_bytes_user_day'] = '4000';
        $this->h->store->addBoard(2, 42);
        $this->assertSame(['ok'], $this->sync([$this->bigOp(1, 1400)], 1)['acks']['res']);
        $this->assertSame(['ok'], $this->sync([$this->bigOp(2, 1400)], 2)['acks']['res']);
        $d = $this->h->syncDecoded(['since' => 42, 'seq' => 1, 'ops' => [$this->bigOp(3, 1400)], 'pres' => 0], null, null, 0, 2);
        $this->assertSame(['busy'], $d['acks']['res'], 'alice on board 2: over her account quota');
        $bob = H::user('bob', Role::Edit);
        $this->assertSame(['ok'], $this->sync([$this->bigOp(4, 1400)], 1, $bob)['acks']['res'], 'bob: his own account counter');
        // Window budget and day quota over at once: the larger retryMs (here the day's 60100).
        $this->h->app['budget_syncs'] = 1;
        $d = $this->sync([$this->bigOp(5, 10)], 3);
        $this->assertSame(['busy'], $d['acks']['res']);
        $this->assertSame(max((intdiv($d['now'], 10000) + 1) * 10000 - $d['now'] + 100, min((intdiv($d['now'], 86400000) + 1) * 86400000 - $d['now'], 60000) + 100), $d['acks']['retryMs']);
        $this->assertSame(60100, $d['acks']['retryMs']);
    }

    public function testQuotaKeysAndNothingForEmptyPolls(): void {
        $this->h->app['budget_bytes_board_day'] = '0';
        $this->h->app['budget_bytes_user_day'] = '0';
        $body = ['since' => 42, 'seq' => 1, 'ops' => [$this->op(1)], 'pres' => 0, 'proto' => 2, 'client' => 'cTest', 'ep' => H::EPOCH];
        $this->assertSame(['ok'], $this->sync([$this->op(1)], 1)['acks']['res'], 'quota 0 = off');
        $tag = intdiv($this->h->now, 86400000);
        $this->assertSame(strlen(json_encode($body)), $this->h->mem->get('wd:1:' . $tag), 'the body length is counted, also with the quota off');
        $this->assertSame(strlen(json_encode($body)), $this->h->mem->get('wu:' . substr(hash('sha256', 'alice'), 0, 24) . ':' . $tag));
        $this->h->mem->log = [];
        $this->h->syncDecoded(['since' => 42, 'pres' => 1]);
        $this->assertSame([], array_values(array_filter($this->h->mem->log, static fn (string $l): bool => (bool)preg_match('/ w[du]:/', $l))),
            'an empty poll touches no wd:/wu: key');
    }
}
