<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\ModerationService as M;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\VoteHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * Timer and "Bring everyone here" (SPEC-M1 §4.12, §4.12.2, §4.12.3 with the
 * R16 codes and edge cases): every action and wrong state of the timer,
 * ms ranges (400 bad_request), a run-out timer (pause 409, add from now),
 * caps, summon seq and client, DELETE without a summon writing nothing.
 * The writes run through the real MetaService on SQLite.
 */
final class ModerationServiceTest extends TestCase {
    private const NOW = 1_760_000_000_000;

    private static function expectHttp(int $status, string $code, callable $fn): void {
        try {
            $fn();
            self::fail("expected $status $code");
        } catch (HttpError $e) {
            self::assertSame([$status, $code], [$e->status, $e->error], $e->getMessage());
        }
    }

    public function testTimerRules(): void {
        $now = self::NOW;
        $t = M::timerAfter(null, 'start', 60000, $now, 'Alice');
        $this->assertSame(['state' => 'running', 'dur' => 60000, 'end' => $now + 60000, 'left' => null, 'by' => 'Alice', 'seq' => 1], $t);
        $t2 = M::timerAfter($t, 'start', 1000, $now + 5, 'Bob');
        $this->assertSame(['running', 1000, $now + 1005, 'Bob', 2], [$t2['state'], $t2['dur'], $t2['end'], $t2['by'], $t2['seq']], 'start replaces a running one');
        $p = M::timerAfter($t, 'pause', null, $now + 20000, 'Bob');
        $this->assertSame(['state' => 'paused', 'dur' => 60000, 'end' => null, 'left' => 40000, 'by' => 'Alice', 'seq' => 2], $p);
        $r = M::timerAfter($p, 'resume', null, $now + 90000, 'Bob');
        $this->assertSame(['state' => 'running', 'dur' => 60000, 'end' => $now + 130000, 'left' => null, 'by' => 'Alice', 'seq' => 3], $r);
        // add: running end += ms, paused left += ms, dur += ms; the rest never above 99:59.
        $a = M::timerAfter($r, 'add', 60000, $now + 91000, 'Bob');
        $this->assertSame([$now + 190000, 120000, 4], [$a['end'], $a['dur'], $a['seq']]);
        $this->assertSame([100000, 120000], [M::timerAfter($p, 'add', 60000, $now, 'X')['left'], M::timerAfter($p, 'add', 60000, $now, 'X')['dur']]);
        $long = M::timerAfter(null, 'start', Limits::TIMER_MAX_MS, $now, 'A');
        $this->assertSame($now + Limits::TIMER_MAX_MS, M::timerAfter($long, 'add', 3600000, $now, 'A')['end'], 'capped');
        $pl = M::timerAfter($long, 'pause', null, $now, 'A');
        $this->assertSame(Limits::TIMER_MAX_MS, M::timerAfter($pl, 'add', 1000, $now, 'A')['left'], 'capped while paused');
        // Run out (end ≤ now, R16): stays running; pause 409, add from now, stop and start work.
        $out = M::timerAfter(null, 'start', 1000, $now, 'A');
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter($out, 'pause', null, $now + 1000, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter($out, 'pause', null, $now + 5000, 'A'));
        $more = M::timerAfter($out, 'add', 60000, $now + 5000, 'A');
        $this->assertSame(['running', $now + 65000, 61000], [$more['state'], $more['end'], $more['dur']], 'end = now + ms, dur += ms');
        $this->assertNull(M::timerAfter($out, 'stop', null, $now + 5000, 'A'));
        // Wrong states.
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter(null, 'pause', null, $now, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter($p, 'pause', null, $now, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter(null, 'resume', null, $now, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter($t, 'resume', null, $now, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter(null, 'add', 1000, $now, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter(null, 'stop', null, $now, 'A'));
        self::expectHttp(409, 'timer_state', static fn () => M::timerAfter(['state' => 'weird'], 'add', 1000, $now, 'A'));
    }

    public function testMsRanges(): void {
        $this->assertSame(1000, M::msFor('start', 1000));
        $this->assertSame(Limits::TIMER_MAX_MS, M::msFor('start', 5999000.0));
        $this->assertSame(Limits::TIMER_ADD_MAX_MS, M::msFor('add', 3600000));
        foreach ([['start', 0], ['start', 999], ['start', 5999001], ['start', null], ['start', '60000'], ['start', 1500.5], ['add', 3600001], ['add', 999], ['add', true]] as [$a, $ms]) {
            self::expectHttp(400, 'bad_request', static fn () => M::msFor($a, $ms));
        }
        foreach (['pause', 'resume', 'stop'] as $a) {
            $this->assertNull(M::msFor($a, 'whatever'), "$a ignores ms");
        }
    }

    public function testTimerAndSummonThroughTheMetaPath(): void {
        $h = new H();
        $b = $h->board(0);
        $alice = H::user();
        foreach ([null, 7, 'go', ''] as $bad) {
            self::expectHttp(400, 'bad_request', static fn () => $h->moderation->timer($alice, $b, $bad, 60000, self::NOW));
        }
        self::expectHttp(400, 'bad_request', static fn () => $h->moderation->timer($alice, $b, 'start', 0, self::NOW));
        self::expectHttp(409, 'timer_state', static fn () => $h->moderation->timer($alice, $b, 'pause', null, self::NOW));
        $this->assertSame(0, $h->rev($b), 'refusals write nothing');
        $out = $h->moderation->timer($alice, $b, 'start', 60000, self::NOW);
        $this->assertSame(['title' => 'Board', 'meta' => ['timer' => ['state' => 'running', 'dur' => 60000, 'end' => self::NOW + 60000, 'left' => null, 'by' => 'Alice Adler', 'seq' => 1]], 'metaRev' => 1], $out);
        $this->assertSame(['timer'], array_keys($h->meta($b)));
        $this->assertNull($h->moderation->timer($alice, $b, 'stop', 'ignored', self::NOW)['meta']['timer'] ?? null);
        // Summon: {pid, client, name, seq, at}; seq + 1; DELETE removes; DELETE without one writes nothing.
        foreach ([null, '', '1abc', 'c' . str_repeat('x', 16), 'c-1', 7] as $bad) {
            self::expectHttp(400, 'bad_request', static fn () => $h->moderation->summon($alice, $b, $bad, self::NOW));
        }
        $s = $h->moderation->summon($alice, $b, 'cTabA', self::NOW)['meta']['summon'];
        $this->assertSame(['pid' => $alice->pid, 'client' => 'cTabA', 'name' => 'Alice Adler', 'seq' => 1, 'at' => self::NOW], $s);
        $fay = H::user('fay', Role::Edit, true);
        $s = $h->moderation->summon($fay, $b, 'cTabB', self::NOW + 1)['meta']['summon'];
        $this->assertSame([$fay->pid, 'cTabB', 2, self::NOW + 1], [$s['pid'], $s['client'], $s['seq'], $s['at']], 'another moderator takes over');
        $rev = $h->rev($b);
        $out = $h->moderation->endSummon($b, self::NOW + 2);
        $this->assertSame([$rev + 1, []], [$out['metaRev'], $out['meta']]);
        $out = $h->moderation->endSummon($b, self::NOW + 3);
        $this->assertSame([$rev + 1, [], $rev + 1], [$out['metaRev'], $out['meta'], $h->rev($b)], 'idempotent: no write, the stored state');
        // After DELETE seq starts at 1 again (server unchanged, R16 SRV-04: the client keys on (seq, at)).
        $this->assertSame(1, $h->moderation->summon($alice, $b, 'cTabA', self::NOW + 4)['meta']['summon']['seq']);
        $this->assertTrue($h->allOutsideTransactions());
    }
}
