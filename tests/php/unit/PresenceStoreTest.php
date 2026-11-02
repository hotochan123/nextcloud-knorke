<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\PresenceStore;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\EpochStub;
use OCA\Knorke\Tests\Support\MemoryCache;
use PHPUnit\Framework\TestCase;

/**
 * Presence blob, throttle, caps, TTL and the text lease (SPEC-M0 §5.5,
 * §4.11); the rights rule of SPEC-M1 §5.5 (only editors keep s, d, e, tk).
 */
final class PresenceStoreTest extends TestCase {
    private const N = '01JA2B3C4D5E6F7G8H9J0KMNPQ';
    private const M = '01JB5Q4T0V9W8X7Y6Z5A4B3C2D';
    private MemoryCache $mem;
    private PresenceStore $store;
    private int $now = 1_760_000_000_000;

    protected function setUp(): void {
        $this->mem = new MemoryCache();
        $this->store = new PresenceStore($this->mem->factory(), (new EpochStub())->epoch());
    }

    private static function p(string $pid, bool $guest = false, string $name = 'Name'): Principal {
        return new Principal($guest ? 'g:g' . $pid : 'u:' . $pid, Role::Edit, $name, $pid, $guest, $guest ? null : $pid, $guest ? 'guest' : 'link');
    }

    private function write(string $pid, string $client, array $me, int $at, bool $guest = false): array {
        return $this->store->write(7, "$pid:$client", PresenceStore::entry(self::p($pid, $guest), $me, $at), $at);
    }

    public function testEntryShape(): void {
        $e = PresenceStore::entry(self::p('aaaa', true, 'Gina'), [
            'c' => [12.345, -40], 's' => [self::N, 'bad', self::N, self::M], 'd' => [[self::N, 1.26, 2], ['x', 1, 2], [self::M, 'a', 1]],
            'e' => self::N, 'tk' => 1, 'unknown' => 'ignored',
        ], $this->now);
        $this->assertSame(['n' => 'Gina', 'k' => 'aaaa', 'g' => 1, 'x' => 12.3, 'y' => -40.0, 's' => [self::N, self::M],
            'd' => [[self::N, 1.3, 2.0]], 'e' => self::N, 'tk' => 1, 'v' => null, 'l' => null, 't' => $this->now, 'rk' => 1], $e);
        $e = PresenceStore::entry(self::p('bbbb'), ['c' => null, 'e' => 'nope', 'tk' => 1, 's' => 'x'], $this->now);
        $this->assertNull($e['x']);
        $this->assertNull($e['e']);
        $this->assertSame(0, $e['tk'], 'tk only together with e');
        $this->assertSame([], $e['s']);
        $many = array_fill(0, 30, self::N);
        $ids = [];
        for ($i = 0; $i < 30; $i++) {
            $ids[] = substr(self::N, 0, 24) . sprintf('%02d', $i);
        }
        $this->assertCount(20, PresenceStore::entry(self::p('c'), ['s' => $ids], $this->now)['s']);
        $this->assertCount(1, PresenceStore::entry(self::p('c'), ['s' => $many], $this->now)['s']);
    }

    public function testWriteReadAndPublic(): void {
        [$st, $map] = $this->write('aaaa', 'c1', ['c' => [1, 2]], $this->now);
        $this->assertSame('ok', $st);
        $this->assertArrayHasKey('aaaa:c1', $map);
        $this->assertArrayNotHasKey('tk', $map['aaaa:c1'], 'tk is input only');
        $this->write('bbbb', 'c2', ['c' => [3, 4], 'e' => self::N], $this->now + 1);
        $pub = PresenceStore::public($this->store->read(7, $this->now + 2), 'aaaa:c1', $this->now + 2);
        $this->assertSame(['bbbb:c2'], array_keys($pub), 'self excluded');
        $this->assertSame(['n' => 'Name', 'k' => 'bbbb', 'g' => 0, 'x' => 3.0, 'y' => 4.0, 's' => [], 'd' => [], 'e' => self::N, 'h' => 1, 'v' => null], $pub['bbbb:c2']);
        $this->assertSame([], PresenceStore::public([], 'x', $this->now));
    }

    public function testTtlRenewedAfterEveryCas(): void {
        $this->write('aaaa', 'c1', [], $this->now);
        $this->assertSame(60, $this->mem->ttl('p:7'), 'add with 60 s');
        $this->mem->now += 40;
        $this->write('aaaa', 'c1', ['c' => [1, 1]], $this->now + 1000);
        $this->assertSame(60, $this->mem->ttl('p:7'), 'cas dropped the TTL, setTTL renewed it');
        $this->assertContains('setTTL p:7', $this->mem->log);
    }

    public function testThrottle250ms(): void {
        $this->assertSame('ok', $this->write('aaaa', 'c1', ['c' => [1, 1]], $this->now)[0]);
        $this->assertSame('skip', $this->write('aaaa', 'c1', ['c' => [2, 2]], $this->now + 100)[0]);
        $this->assertSame(1.0, $this->store->read(7, $this->now + 100)['aaaa:c1']['x']);
        $this->assertSame('ok', $this->write('aaaa', 'c1', ['c' => [2, 2], 'e' => self::N], $this->now + 120)[0], 'e change is never throttled');
        $this->assertSame('ok', $this->write('aaaa', 'c1', ['c' => [2, 2], 'e' => self::N, 'tk' => 1], $this->now + 140)[0], 'tk is never throttled');
        $this->assertSame('ok', $this->write('aaaa', 'c1', ['c' => [3, 3], 'e' => self::N], $this->now + 400)[0]);
    }

    public function testStaleEntriesDropAfterTenSeconds(): void {
        $this->write('aaaa', 'c1', [], $this->now);
        $this->assertCount(1, $this->store->read(7, $this->now + 9999));
        $this->assertCount(0, $this->store->read(7, $this->now + 10000));
        [, $map] = $this->write('bbbb', 'c2', [], $this->now + 10000);
        $this->assertSame(['bbbb:c2'], array_keys($map), 'pruned on write too');
    }

    public function testAtMostThreeEntriesPerPid(): void {
        foreach (['c1', 'c2', 'c3'] as $i => $c) {
            $this->write('aaaa', $c, [], $this->now + $i);
        }
        $this->write('bbbb', 'x', [], $this->now + 5);
        [, $map] = $this->write('aaaa', 'c4', [], $this->now + 10);
        $this->assertSame(['aaaa:c2', 'aaaa:c3', 'bbbb:x', 'aaaa:c4'], array_keys($map), 'the oldest of the SAME pid goes, never another pid');
    }

    public function testAtMostTwoHundredEntries(): void {
        $map = [];
        for ($i = 0; $i < 200; $i++) {
            $map[sprintf('p%03d:c', $i)] = ['n' => 'x', 'k' => sprintf('p%03d', $i), 'g' => 0, 'x' => null, 'y' => null, 's' => [], 'd' => [], 'e' => null, 't' => $this->now + $i, 'es' => null];
        }
        $this->mem->set('p:7', json_encode($map), 60);
        [, $out] = $this->write('zzzz', 'c', [], $this->now + 500);
        $this->assertCount(200, $out);
        $this->assertArrayNotHasKey('p000:c', $out);
        $this->assertArrayHasKey('zzzz:c', $out);
    }

    // ---- P7: the cap by rank and class (SPEC-M1 §33.1 f, SYNC-1; C82 in small) ----

    private static function principal(string $pid, Role $role, bool $facilitator = false, bool $guest = false): Principal {
        return new Principal(($guest ? 'g:g' : 'u:') . $pid, $role, 'N' . $pid, $pid, $guest, $guest ? null : $pid, $guest ? 'guest' : ($role === Role::Owner ? 'owner' : 'share'), $facilitator);
    }

    private function writeAs(Principal $p, string $client, array $me, int $at): array {
        return $this->store->write(7, $p->pid . ':' . $client, PresenceStore::entry($p, $me, $at), $at);
    }

    public function testRankFieldIsInternal(): void {
        $this->assertSame(0, PresenceStore::entry(self::principal('vvvv', Role::Vote, false, true), [], $this->now)['rk'], 'vote: 0');
        $this->assertSame(1, PresenceStore::entry(self::principal('eeee', Role::Edit), [], $this->now)['rk'], 'edit: 1');
        $this->assertSame(2, PresenceStore::entry(self::principal('ffff', Role::Edit, true), [], $this->now)['rk'], 'may moderate: 2');
        $this->assertSame(2, PresenceStore::entry(self::principal('oooo', Role::Owner), [], $this->now)['rk'], 'owner: 2');
        [, $map] = $this->writeAs(self::principal('oooo', Role::Owner), 'c1', ['c' => [1, 1]], $this->now);
        $this->assertSame(2, $map['oooo:c1']['rk'], 'stored');
        $pub = PresenceStore::public($map, 'x', $this->now);
        $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v'], array_keys($pub['oooo:c1']), 'public() never sends rk');
        $this->assertSame([PresenceStore::MAX_ENTRIES, PresenceStore::MAX_VOTE_ENTRIES], [200, 50]);
    }

    public function testVoteFloodKeepsTheLeaseHolderAndThePresenter(): void {
        // SYNC-1: alice (owner) holds the text lease on N with client A1 and
        // presents ("Bring everyone here", {v}) with client A2; then 70 guests
        // of the voting link write 210 cursors (3 clients each) within 10 s.
        $alice = self::principal('a11ce000a11ce000', Role::Owner);
        $this->writeAs($alice, 'A1', ['e' => self::N], $this->now);
        $this->writeAs($alice, 'A2', ['v' => [0, 0, 1600, 900]], $this->now + 1);
        $t = $this->now + 10;
        for ($g = 0; $g < 70; $g++) {
            for ($c = 0; $c < 3; $c++) {
                [$st, $map] = $this->writeAs(self::principal(sprintf('g%015d', $g), Role::Vote, false, true), 'c' . $c, ['c' => [$g, $c]], $t++);
                $this->assertSame('ok', $st);
                $this->assertLessThanOrEqual(PresenceStore::MAX_VOTE_ENTRIES, count(array_filter($map, static fn (array $e): bool => ($e['rk'] ?? 1) === 0)), 'at most 50 vote entries at any time');
            }
        }
        $map = $this->store->read(7, $t);
        $this->assertArrayHasKey('a11ce000a11ce000:A1', $map, 'the lease holder stays');
        $this->assertArrayHasKey('a11ce000a11ce000:A2', $map, 'the presenter (meta.summon key) stays');
        $this->assertSame('a11ce000a11ce000', PresenceStore::leaseHolder($map, self::N, $t), 'bob\'s text patch would still be locked');
        $guests = array_filter($map, static fn (array $e): bool => $e['g'] === 1);
        $this->assertCount(50, $guests, '50 guest entries, the newest');
        $this->assertArrayHasKey(sprintf('g%015d', 69) . ':c2', $map, 'the newest writer is always kept');
        $this->assertArrayNotHasKey(sprintf('g%015d', 0) . ':c0', $map, 'the oldest vote entries went first');
    }

    public function testTheCapEvictsByClass(): void {
        // 200 entries: 1 vote, 1 editor without e/v, 1 with v, 1 with e but not
        // the holder, 1 holder, 1 moderator, then 194 moderators (class 6).
        // Each new writer forces one eviction: the classes go in order 1–4,
        // the holder (5) and moderators (6) only after them.
        $map = [];
        $entry = fn (string $k, int $rk, ?string $e, ?array $v, int $t, int $es = 0): array => ['n' => 'x', 'k' => explode(':', $k)[0], 'g' => 0, 'x' => null, 'y' => null,
            's' => [], 'd' => [], 'e' => $e, 'v' => $v, 't' => $t, 'es' => $e === null ? null : $es, 'rk' => $rk];
        $map['c1vote0000000000:c'] = $entry('c1vote0000000000:c', 0, null, null, $this->now + 50);
        $map['c2plain000000000:c'] = $entry('c2plain000000000:c', 1, null, null, $this->now + 40);
        $map['c3view0000000000:c'] = $entry('c3view0000000000:c', 1, null, [0, 0, 10, 10], $this->now + 30);
        $map['c4second00000000:c'] = $entry('c4second00000000:c', 1, self::N, null, $this->now + 20, 900);
        $map['c5holder00000000:c'] = $entry('c5holder00000000:c', 1, self::N, null, $this->now + 1, 100);
        for ($i = 0; $i < 195; $i++) {
            $k = sprintf('m%015d:c', $i);
            $map[$k] = $entry($k, 2, null, null, $this->now + $i);
        }
        $this->assertCount(200, $map);
        $this->mem->set('p:7', json_encode($map), 60);
        $order = [];
        for ($w = 0; $w < 6; $w++) {
            [, $out] = $this->writeAs(self::principal(sprintf('n%015d', $w), Role::Owner), 'c', [], $this->now + 1000 + $w);
            $this->assertCount(200, $out, 'the hard bound');
            $gone = array_values(array_diff(array_keys($map), array_keys($out)));
            $this->assertCount(1, $gone);
            $order[] = $gone[0];
            $map = $out;
        }
        $this->assertSame(['c1vote0000000000:c', 'c2plain000000000:c', 'c3view0000000000:c', 'c4second00000000:c', 'c5holder00000000:c', 'm000000000000000:c'], $order,
            'rk 0; rk 1 without e/v; without e with v; with e not holding; the holder; then the oldest moderator');
    }

    public function testPerPidCapByClassAndOwnKeyNeverEvicted(): void {
        // An editor's tabs: the one with v (class 3) and the lease holder (5)
        // outlive older tabs with neither (class 2).
        $ed = self::principal('eeee', Role::Edit);
        $this->writeAs($ed, 'holder', ['e' => self::N], $this->now);
        $this->writeAs($ed, 'view', ['v' => [0, 0, 5, 5]], $this->now + 1);
        $this->writeAs($ed, 'plain1', ['c' => [1, 1]], $this->now + 2);
        [, $map] = $this->writeAs($ed, 'plain2', ['c' => [2, 2]], $this->now + 3);
        $this->assertSame(['eeee:holder', 'eeee:view', 'eeee:plain2'], array_keys($map), 'class 2 goes first (plain1), never the writing key');
        [, $map] = $this->writeAs($ed, 'plain3', ['c' => [3, 3]], $this->now + 4);
        $this->assertSame(['eeee:holder', 'eeee:view', 'eeee:plain3'], array_keys($map));
        // An entry without rk (stored before P7-C) counts as an editor (rk 1).
        $legacy = ['legacy0000000000:c' => ['n' => 'L', 'k' => 'legacy0000000000', 'g' => 0, 'x' => 1.0, 'y' => 1.0, 's' => [], 'd' => [], 'e' => null, 'v' => null, 't' => $this->now + 5, 'es' => null]];
        $this->mem->set('p:7', json_encode($legacy + $map), 60);
        $t = $this->now + 10;
        for ($g = 0; $g < 60; $g++) {
            $this->writeAs(self::principal(sprintf('v%015d', $g), Role::Vote, false, true), 'c', ['c' => [0, 0]], $t++);
        }
        $map = $this->store->read(7, $t);
        $this->assertArrayHasKey('legacy0000000000:c', $map, 'the vote sub-limit never touches an entry without rk');
        $this->assertCount(50, array_filter($map, static fn (array $e): bool => ($e['rk'] ?? 1) === 0));
    }

    // ---- P7-D (VC-04): the writing key is never evicted, also when it is first in line ----
    //
    // write() stamps the writer with t = nowMs, so with stored entries in
    // ascending t it is always the newest and never first in line. It IS
    // first in line (a) when its class goes first, and (b) when it is the
    // oldest of its class: nowMs is taken when a request starts, and a
    // faster concurrent request may have stored a newer t before this one
    // gets through the cas loop. Each test reaches the guard in exactly one
    // step of cap() — (i) per pid, (ii) the vote sub-limit, (iii) overall —
    // and one way, with stored entries in descending or mixed t.

    /** A stored entry as write() leaves it (§33.1 f); $k = "<pid>:<client>". */
    private static function stored(string $k, int $rk, ?string $e, ?array $v, int $t, ?int $es = null): array {
        return ['n' => 'x', 'k' => explode(':', $k)[0], 'g' => $rk === PresenceStore::RANK_VOTE ? 1 : 0, 'x' => null, 'y' => null,
            's' => [], 'd' => [], 'e' => $e, 'v' => $v, 't' => $t, 'es' => $e === null ? null : ($es ?? $t), 'rk' => $rk];
    }

    /**
     * Seeds the blob with $stored, lets $writer write $client at $this->now,
     * checks that the writing key is kept (returned and stored) and returns
     * the keys the write evicted.
     *
     * @return list<string>
     */
    private function evictedBy(array $stored, Principal $writer, string $client): array {
        $this->mem->set('p:7', json_encode($stored), 60);
        $key = $writer->pid . ':' . $client;
        [$st, $out] = $this->writeAs($writer, $client, ['c' => [1, 1]], $this->now);
        $this->assertSame('ok', $st);
        $this->assertArrayHasKey($key, $out, 'the writing key is never evicted');
        $this->assertArrayHasKey($key, $this->store->read(7, $this->now), 'the writing key is stored');
        return array_values(array_diff(array_keys($stored), array_keys($out)));
    }

    public function testOwnKeyKeptByTheOverallCapWhenItsClassGoesFirst(): void {
        // (iii) by class: 200 editors (class 2) stored newest first, then a
        // guest of the voting link (class 1) writes the 201st key.
        $stored = [];
        for ($i = 0; $i < PresenceStore::MAX_ENTRIES; $i++) {
            $k = sprintf('e%015d:c', $i);
            $stored[$k] = self::stored($k, PresenceStore::RANK_EDIT, null, null, $this->now - 1 - $i);
        }
        $gone = $this->evictedBy($stored, self::principal('vguest0000000001', Role::Vote, false, true), 'c');
        $this->assertSame(['e000000000000199:c'], $gone, 'the oldest editor goes instead: the LAST key of the map (by t, not by position)');
    }

    public function testOwnKeyKeptByThePerPidCapWhenItsClassGoesFirst(): void {
        // (i) by class: the editor's other tabs are two with a viewport
        // (class 3) and a lease holder (class 5), stored newest first; the
        // fourth tab writes without e and v (class 2).
        $n = $this->now;
        $stored = [
            'eeee:view1' => self::stored('eeee:view1', PresenceStore::RANK_EDIT, null, [0, 0, 5, 5], $n - 10),
            'eeee:view2' => self::stored('eeee:view2', PresenceStore::RANK_EDIT, null, [0, 0, 5, 5], $n - 20),
            'eeee:hold' => self::stored('eeee:hold', PresenceStore::RANK_EDIT, self::N, null, $n - 30),
        ];
        $gone = $this->evictedBy($stored, self::principal('eeee', Role::Edit), 'plain');
        $this->assertSame(['eeee:view2'], $gone, 'the older viewport tab (class 3) goes, never the lease holder (class 5)');
    }

    public function testOwnKeyKeptByThePerPidCapWhenItIsTheOldest(): void {
        // (i) by age: the editor's other three tabs (class 2, like the writer)
        // carry newer t in mixed order.
        $n = $this->now;
        $stored = [
            'eeee:a' => self::stored('eeee:a', PresenceStore::RANK_EDIT, null, null, $n + 30),
            'eeee:b' => self::stored('eeee:b', PresenceStore::RANK_EDIT, null, null, $n + 10),
            'eeee:c' => self::stored('eeee:c', PresenceStore::RANK_EDIT, null, null, $n + 20),
        ];
        $gone = $this->evictedBy($stored, self::principal('eeee', Role::Edit), 'w');
        $this->assertSame(['eeee:b'], $gone, 'the oldest of the other tabs goes');
    }

    public function testOwnKeyKeptByTheVoteSubLimitWhenItIsTheOldest(): void {
        // (ii) by age: 50 vote entries with newer t in mixed order
        // (now + 1 … now + 50, a permutation); a 51st guest writes.
        $stored = [];
        for ($i = 0; $i < PresenceStore::MAX_VOTE_ENTRIES; $i++) {
            $k = sprintf('g%015d:c', $i);
            $stored[$k] = self::stored($k, PresenceStore::RANK_VOTE, null, null, $this->now + 1 + (($i * 7 + 3) % 50));
        }
        $this->assertSame($this->now + 1, $stored['g000000000000021:c']['t'], 'the oldest stored vote entry sits in the middle of the map');
        $gone = $this->evictedBy($stored, self::principal('vguest0000000001', Role::Vote, false, true), 'c');
        $this->assertSame(['g000000000000021:c'], $gone);
    }

    public function testOwnKeyKeptByTheOverallCapWhenItIsTheOldestOfItsClass(): void {
        // (iii) by age: 200 editors (class 2, like the writer) with newer t in
        // mixed order (now + 1 … now + 200, a permutation); a 201st editor writes.
        $stored = [];
        for ($i = 0; $i < PresenceStore::MAX_ENTRIES; $i++) {
            $k = sprintf('e%015d:c', $i);
            $stored[$k] = self::stored($k, PresenceStore::RANK_EDIT, null, null, $this->now + 1 + (($i * 7 + 3) % 200));
        }
        $this->assertSame($this->now + 1, $stored['e000000000000171:c']['t'], 'the oldest stored editor sits in the middle of the map');
        $gone = $this->evictedBy($stored, self::principal('wwww', Role::Edit), 'c');
        $this->assertSame(['e000000000000171:c'], $gone);
    }

    public function testCasCollisionsAndLost(): void {
        $this->write('aaaa', 'c1', [], $this->now);
        $this->mem->casFailures = 2;
        $this->assertSame('retry', $this->write('bbbb', 'c2', [], $this->now + 1)[0]);
        $this->mem->casFailures = 6;
        $this->assertSame(['lost', null], $this->write('cccc', 'c3', [], $this->now + 2));
    }

    public function testOff(): void {
        $this->mem->available = false;
        $store = new PresenceStore($this->mem->factory(), (new EpochStub())->epoch());
        $this->assertFalse($store->available());
        $this->assertSame(['off', null], $store->write(7, 'a:b', PresenceStore::entry(self::p('a'), [], 1), 1));
        $this->assertSame([], $store->read(7, 1));
    }

    public function testLeaseFirstHolds(): void {
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N], $this->now + 50);
        $map = $this->store->read(7, $this->now + 60);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($map, self::N, $this->now + 60));
        $this->assertNull(PresenceStore::leaseHolder($map, self::M, $this->now + 60));
        $this->assertNull(PresenceStore::leaseHolder(null, self::N, $this->now + 60));
        $pub = PresenceStore::public($map, 'nobody', $this->now + 60);
        $this->assertSame(1, $pub['aaaa:c1']['h']);
        $this->assertSame(0, $pub['bbbb:c2']['h']);
        $this->assertArrayNotHasKey('es', $pub['aaaa:c1']);
        $this->assertArrayNotHasKey('t', $pub['aaaa:c1']);
    }

    public function testLeaseRankStaysWhileEUnchanged(): void {
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N], $this->now + 50);
        $this->write('aaaa', 'c1', ['e' => self::N, 'c' => [1, 1]], $this->now + 400);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($this->store->read(7, $this->now + 500), self::N, $this->now + 500));
    }

    public function testTakeOver(): void {
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N, 'tk' => 1], $this->now + 50);
        $this->assertSame('bbbb', PresenceStore::leaseHolder($this->store->read(7, $this->now + 60), self::N, $this->now + 60));
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now + 400);
        $this->assertSame('bbbb', PresenceStore::leaseHolder($this->store->read(7, $this->now + 410), self::N, $this->now + 410), 'staying does not win it back');
        $this->write('aaaa', 'c1', ['e' => self::N, 'tk' => 1], $this->now + 800);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($this->store->read(7, $this->now + 810), self::N, $this->now + 810), 'taking over again');
    }

    public function testLeaseExpiresAndReturnerQueuesBehind(): void {
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N], $this->now + 5000);
        // a goes quiet: after 10 s its entry is stale, b holds.
        $this->write('bbbb', 'c2', ['e' => self::N], $this->now + 10500);
        $this->assertSame('bbbb', PresenceStore::leaseHolder($this->store->read(7, $this->now + 10600), self::N, $this->now + 10600));
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now + 11000);
        $this->assertSame('bbbb', PresenceStore::leaseHolder($this->store->read(7, $this->now + 11100), self::N, $this->now + 11100), 'the returner queues behind');
    }

    public function testTieBreakSmallerKey(): void {
        $map = [
            'bbbb:c' => ['k' => 'bbbb', 'e' => self::N, 't' => $this->now, 'es' => 5],
            'aaaa:c' => ['k' => 'aaaa', 'e' => self::N, 't' => $this->now, 'es' => 5],
        ];
        $this->assertSame('aaaa', PresenceStore::leaseHolder($map, self::N, $this->now));
    }

    public function testPrefixCarriesTheEpoch(): void {
        // SPEC-M1 §5.1: createDistributed('knorke/' . $epoch . '/').
        $mem = new MemoryCache();
        new PresenceStore($mem->factory(), (new EpochStub('m1n2b3v4'))->epoch());
        $this->assertSame(['knorke/m1n2b3v4/'], $mem->prefixes);
    }

    public function testNonEditorsKeepOnlyTheCursor(): void {
        // SPEC-M1 §5.5 (R2, deviation from M0 L138–152): a principal that may
        // not edit (vote; view never writes presence) sends s, d, e and tk —
        // the entry has s: [], d: [], e: null, tk: 0; c stays. A guest of the
        // voting link can neither show drag previews of arbitrary items nor
        // keep editors on the fast tick.
        $me = ['c' => [1, 2], 's' => [self::N, self::M], 'd' => [[self::N, 5, 6]], 'e' => self::N, 'tk' => 1];
        foreach ([
            new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link'),
            new Principal('g:gVote', Role::Vote, 'Gast', 'gggg', true, null, 'guest'),
            new Principal('u:val', Role::View, 'Val', 'wwww', false, 'val', 'share'),
        ] as $p) {
            $e = PresenceStore::entry($p, $me, $this->now);
            $this->assertSame([1.0, 2.0, [], [], null, 0], [$e['x'], $e['y'], $e['s'], $e['d'], $e['e'], $e['tk']], $p->role->value . ' ' . $p->origin);
        }
        foreach ([Role::Edit, Role::Owner] as $role) {
            $p = new Principal('u:ed', $role, 'Ed', 'eeee', false, 'ed', $role === Role::Owner ? 'owner' : 'link');
            $e = PresenceStore::entry($p, $me, $this->now);
            $this->assertSame([[self::N, self::M], [[self::N, 5.0, 6.0]], self::N, 1], [$e['s'], $e['d'], $e['e'], $e['tk']], $role->value . ' keeps everything');
        }
        // Written that way, the others see a bare cursor.
        $vote = new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link');
        [, $map] = $this->store->write(7, 'vvvv:c1', PresenceStore::entry($vote, $me, $this->now), $this->now);
        $pub = PresenceStore::public($map, 'other:c', $this->now);
        $this->assertSame(['s' => [], 'd' => [], 'e' => null, 'h' => 0], array_intersect_key($pub['vvvv:c1'], array_flip(['s', 'd', 'e', 'h'])));
    }

    public function testOnlyEditorsCanHoldTheLease(): void {
        // T12: a role that may not edit (vote) keeps its cursor but never
        // e/tk, so it can never lock an editor's text.
        $vote = new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link');
        $me = ['c' => [1, 2], 's' => [self::N], 'e' => self::N, 'tk' => 1];
        $e = PresenceStore::entry($vote, $me, $this->now);
        $this->assertNull($e['e']);
        $this->assertSame(0, $e['tk'] ?? 0, 'no take-over');
        $this->assertSame([1.0, 2.0, []], [$e['x'], $e['y'], $e['s']], 'cursor stays, selection goes (SPEC-M1 §5.5)');
        [, $map] = $this->store->write(7, 'vvvv:c1', $e, $this->now);
        $this->assertNull(PresenceStore::leaseHolder($map, self::N, $this->now), 'written that way it holds nothing');
        $edit = PresenceStore::entry(self::p('aaaa'), $me, $this->now);
        $this->assertSame([self::N, 1], [$edit['e'], $edit['tk']], 'an editor keeps e and tk');
        $this->write('aaaa', 'c1', ['e' => self::N], $this->now + 10);
        $this->store->write(7, 'vvvv:c1', PresenceStore::entry($vote, $me, $this->now + 300), $this->now + 300);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($this->store->read(7, $this->now + 310), self::N, $this->now + 310), 'a vote tk takes nothing over');
    }

    public function testViewportV(): void {
        // SPEC-M1 §4.5 me.v, §5.5, C75 (R16): four numbers rounded with
        // q(…, 10) (never -0); an invalid v becomes null, the rest of the
        // entry stays.
        $e = PresenceStore::entry(self::p('aaaa'), ['c' => [1, 2], 's' => [self::N], 'v' => [-200.04, -150.05, 1600, 900.123]], $this->now);
        $this->assertSame([-200.0, -150.1, 1600.0, 900.1], $e['v']);
        $this->assertSame([1.0, 2.0, [self::N]], [$e['x'], $e['y'], $e['s']]);
        $this->assertSame('[0.0,0.0,1.0,1.0]', json_encode(PresenceStore::view([-0.04, -0.0, 1, 1]), JSON_PRESERVE_ZERO_FRACTION), 'never -0');
        $this->assertSame([1e7, -1e7, 1e7, 0.1], PresenceStore::view([1e7, -1e7, 1e7, 0.06]), 'bounds inclusive');
        foreach ([
            'w = 0' => [0, 0, 0, 100],
            'h < 0' => [0, 0, 100, -1],
            'w rounds to 0' => [0, 0, 0.04, 100],
            'five elements' => [0, 0, 100, 100, 1],
            'three elements' => [0, 0, 100],
            'null element (NaN over JSON)' => [0, null, 100, 100],
            'string element' => [0, '0', 100, 100],
            '|x| > 1e7' => [1e7 + 1, 0, 100, 100],
            'w > 1e7' => [0, 0, 1e7 + 1, 100],
            'INF' => [INF, 0, 100, 100],
            'object' => ['x' => 0, 'y' => 0, 'w' => 1, 'h' => 1],
            'not a list' => '[0,0,1,1]',
            'bool' => [true, 0, 1, 1],
        ] as $case => $v) {
            $e = PresenceStore::entry(self::p('aaaa'), ['c' => [3, 4], 'v' => $v], $this->now);
            $this->assertNull($e['v'], $case);
            $this->assertSame([3.0, 4.0], [$e['x'], $e['y']], "$case: the rest of the entry stays");
        }
        // Stored and handed out: v in public() (after h), null without one.
        $this->write('aaaa', 'c1', ['v' => [10, 20, 300, 400]], $this->now);
        $this->write('bbbb', 'c2', ['c' => [1, 1]], $this->now);
        $pub = PresenceStore::public($this->store->read(7, $this->now + 1), 'x:y', $this->now + 1);
        $this->assertSame([10.0, 20.0, 300.0, 400.0], $pub['aaaa:c1']['v']);
        $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v'], array_keys($pub['aaaa:c1']));
        $this->assertSame([null, null], [$pub['aaaa:c1']['x'], $pub['aaaa:c1']['y']], '{v} alone (a presenter outside edit): no cursor');
        $this->assertNull($pub['bbbb:c2']['v']);
        // A role that may not edit keeps c and v only (R2): vote with s, d, e.
        $vote = new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link');
        $e = PresenceStore::entry($vote, ['c' => [1, 2], 's' => [self::N], 'd' => [[self::N, 1, 1]], 'e' => self::N, 'v' => [0, 0, 10, 10]], $this->now);
        $this->assertSame([1.0, 2.0, [], [], null, [0.0, 0.0, 10.0, 10.0]], [$e['x'], $e['y'], $e['s'], $e['d'], $e['e'], $e['v']]);
        // A stored entry from before stage 3 (no v key) reads as v null.
        $this->assertNull(PresenceStore::public(['o:c' => ['n' => 'O', 'k' => 'o', 't' => $this->now]], 'x', $this->now)['o:c']['v']);
    }

    // ---- job 171: the laser trail l (AK6) ----

    public function testLaserTrailIsTakenRoundedFromEditorsOnly(): void {
        $me = ['c' => [3, 4], 's' => [self::N], 'v' => [0, 0, 100, 100]];
        $l = [[10.04, -20.06, 900], [11, -21, 860], null, [12.5, -22.56, 400], [13, 1e7, 400], [-1e7, 0, 0]];
        $e = PresenceStore::entry(self::p('aaaa'), $me + ['l' => $l], $this->now);
        $this->assertSame([[10.0, -20.1, 900], [11.0, -21.0, 860], null, [12.5, -22.6, 400], [13.0, 1e7, 400], [-1e7, 0.0, 0]], $e['l'], 'valid: taken, x and y on 0.1');
        $rest = static fn (array $x): array => array_diff_key($x, ['l' => 1]);
        $base = PresenceStore::entry(self::p('aaaa'), $me, $this->now);
        $this->assertNull($base['l'], 'no l: null');
        $this->assertSame($rest($base), $rest($e), 'the rest of the entry does not depend on l');
        $this->assertCount(100, PresenceStore::entry(self::p('aaaa'), ['l' => array_fill(0, 100, [1, 2, 5])], $this->now)['l'], '100 elements are fine');
        $this->assertSame([[1.0, 2.0, 10000]], PresenceStore::entry(self::p('aaaa'), ['l' => [[1, 2, 10000]]], $this->now)['l'], 'd = 10000 is fine');
        foreach ([
            '101 elements' => array_fill(0, 101, [1, 2, 5]),
            'd = 10001' => [[1, 2, 10001]],
            'd < 0' => [[1, 2, -1]],
            'd rises' => [[1, 2, 100], [3, 4, 101]],
            'd rises across a break' => [[1, 2, 100], null, [3, 4, 200]],
            'd is a float' => [[1, 2, 5.0]],
            'null first' => [null, [1, 2, 5]],
            'null last' => [[1, 2, 5], null],
            'null twice' => [[1, 2, 9], null, null, [3, 4, 5]],
            'only null' => [null],
            'empty' => [],
            'a string' => '[[1,2,3]]',
            'a string element' => [[1, 2, 3], 'x'],
            '[x, y]' => [[1, 2]],
            '[x, y, d, more]' => [[1, 2, 3, 4]],
            'x a string' => [['1', 2, 3]],
            'y null' => [[1, null, 3]],
            '|x| > 1e7' => [[1e7 + 1, 0, 3]],
            'INF' => [[INF, 0, 3]],
            'an object' => ['a' => [1, 2, 3]],
            'a point as an object' => [['x' => 1, 'y' => 2, 'd' => 3]],
        ] as $case => $bad) {
            $x = PresenceStore::entry(self::p('aaaa'), $me + ['l' => $bad], $this->now);
            $this->assertNull($x['l'], $case);
            $this->assertSame($rest($base), $rest($x), "$case: the rest of the entry stays");
        }
        $vote = new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link');
        $x = PresenceStore::entry($vote, ['c' => [1, 2], 'l' => $l], $this->now);
        $this->assertNull($x['l'], 'role vote: no l');
        $this->assertSame([1.0, 2.0], [$x['x'], $x['y']], 'role vote: the cursor stays');
    }

    public function testLaserTrailInPublicLastWithItsAge(): void {
        $this->write('aaaa', 'c1', ['c' => [1, 1], 'v' => [0, 0, 10, 10], 'l' => [[5, 6, 300], null, [7, 8, 20]]], $this->now);
        $this->write('bbbb', 'c2', ['c' => [2, 2]], $this->now);
        $pub = PresenceStore::public($this->store->read(7, $this->now + 150), 'x:y', $this->now + 150);
        $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v', 'l'], array_keys($pub['aaaa:c1']), 'l is the last key, after v');
        $this->assertSame([[5.0, 6.0, 450], null, [7.0, 8.0, 170]], $pub['aaaa:c1']['l'], 'every d + (nowMs − t)');
        $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v'], array_keys($pub['bbbb:c2']), 'without l: exactly the ten fields');
        // the next write without l (the trail left the window): the ten fields again
        $this->write('aaaa', 'c1', ['c' => [1, 1]], $this->now + 400);
        $pub = PresenceStore::public($this->store->read(7, $this->now + 410), 'x:y', $this->now + 410);
        $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v'], array_keys($pub['aaaa:c1']));
        // a vote entry never hands one out
        $vote = new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link');
        [, $map] = $this->store->write(7, 'vvvv:c1', PresenceStore::entry($vote, ['c' => [1, 2], 'l' => [[1, 2, 3]]], $this->now + 500), $this->now + 500);
        $this->assertArrayNotHasKey('l', PresenceStore::public($map, 'x:y', $this->now + 500)['vvvv:c1']);
    }

    // ── Job 173: the cell of a table (me.ec) ─────────────────────────────

    private const CA = 'c00000001.r00000001';
    private const CB = 'c00000002.r00000001';

    public function testCellOnlyWithEAndForEditors(): void {
        $e = PresenceStore::entry(self::p('aaaa'), ['e' => self::N, 'ec' => self::CA], $this->now);
        $this->assertSame(self::CA, $e['ec']);
        $this->assertArrayNotHasKey('ec', PresenceStore::entry(self::p('aaaa'), ['ec' => self::CA], $this->now), 'no e: no ec');
        $this->assertArrayNotHasKey('ec', PresenceStore::entry(self::p('aaaa'), ['e' => 'nope', 'ec' => self::CA], $this->now), 'an invalid e: no ec');
        foreach (['C00000001.r00000001', 'c00000001', 'c00000001.r0000001', self::CA . ' ', 5, ['c'], true] as $bad) {
            $this->assertArrayNotHasKey('ec', PresenceStore::entry(self::p('aaaa'), ['e' => self::N, 'ec' => $bad], $this->now), json_encode($bad));
        }
        $vote = new Principal('u:vic', Role::Vote, 'Vic', 'vvvv', false, 'vic', 'link');
        $this->assertArrayNotHasKey('ec', PresenceStore::entry($vote, ['e' => self::N, 'ec' => self::CA], $this->now), 'role vote: no ec');
        // a note: nothing changes (the entry of testEntryShape has no ec)
        $this->assertArrayNotHasKey('ec', PresenceStore::entry(self::p('aaaa'), ['e' => self::N], $this->now));
    }

    public function testANodeOfAMindMapIsACellToo(): void {
        // Job 195 (AK2): ec takes a node key n<8> with the same rules; any other form is null
        $e = PresenceStore::entry(self::p('aaaa'), ['e' => self::N, 'ec' => 'n1abcdefg'], $this->now);
        $this->assertSame('n1abcdefg', $e['ec']);
        foreach (['N1abcdefg', 'n1abcdef', 'n1abcdefgh', 'n1abcdefg ', 'b1.n1abcdefg'] as $bad) {
            $this->assertArrayNotHasKey('ec', PresenceStore::entry(self::p('aaaa'), ['e' => self::N, 'ec' => $bad], $this->now), $bad);
        }
        $this->write('aaaa', 'c1', ['e' => self::N, 'ec' => 'n1abcdefg'], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N, 'ec' => 'n2abcdefg'], $this->now + 50);
        $map = $this->store->read(7, $this->now + 70);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($map, self::N, $this->now + 70, 'n1abcdefg'));
        $this->assertSame('bbbb', PresenceStore::leaseHolder($map, self::N, $this->now + 70, 'n2abcdefg'), 'another node, another holder');
        $pub = PresenceStore::public($map, 'x:y', $this->now + 70);
        $this->assertSame(['n1abcdefg', 1], [$pub['aaaa:c1']['ec'], $pub['aaaa:c1']['h']]);
    }

    public function testLeasePerCell(): void {
        $this->write('aaaa', 'c1', ['e' => self::N, 'ec' => self::CA], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N, 'ec' => self::CB], $this->now + 50);
        $this->write('cccc', 'c3', ['e' => self::N, 'ec' => self::CA], $this->now + 60);
        $map = $this->store->read(7, $this->now + 70);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($map, self::N, $this->now + 70, self::CA));
        $this->assertSame('bbbb', PresenceStore::leaseHolder($map, self::N, $this->now + 70, self::CB), 'another cell, another holder');
        $this->assertNull(PresenceStore::leaseHolder($map, self::N, $this->now + 70), 'nobody holds the table without a cell');
        $this->assertNull(PresenceStore::leaseHolder($map, self::N, $this->now + 70, 'c00000003.r00000001'));
        $pub = PresenceStore::public($map, 'x:y', $this->now + 70);
        $this->assertSame([1, 1, 0], [$pub['aaaa:c1']['h'], $pub['bbbb:c2']['h'], $pub['cccc:c3']['h']], 'h per (e, ec)');
        $this->assertSame([self::CA, self::CB, self::CA], [$pub['aaaa:c1']['ec'], $pub['bbbb:c2']['ec'], $pub['cccc:c3']['ec']]);
        $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v', 'ec'], array_keys($pub['aaaa:c1']), 'ec after v');
    }

    public function testRankStartsAnewWithTheCellAndIsNotThrottled(): void {
        $this->write('aaaa', 'c1', ['e' => self::N, 'ec' => self::CA], $this->now);
        $this->write('bbbb', 'c2', ['e' => self::N, 'ec' => self::CB], $this->now + 50);
        // a moves to b's cell 100 ms later: never throttled, and it queues behind b there
        $this->assertSame('ok', $this->write('aaaa', 'c1', ['e' => self::N, 'ec' => self::CB], $this->now + 100)[0], 'a change of ec is never throttled');
        $map = $this->store->read(7, $this->now + 110);
        $this->assertSame($this->now + 100, $map['aaaa:c1']['es'], 'es starts anew');
        $this->assertSame('bbbb', PresenceStore::leaseHolder($map, self::N, $this->now + 110, self::CB));
        $this->assertNull(PresenceStore::leaseHolder($map, self::N, $this->now + 110, self::CA), 'a left CA');
        // the same cell again within 250 ms: throttled
        $this->assertSame('skip', $this->write('aaaa', 'c1', ['e' => self::N, 'ec' => self::CB, 'c' => [1, 1]], $this->now + 200)[0]);
        // tk per cell: a takes CB over; bbbb holding CA elsewhere is untouched
        $this->write('bbbb', 'c3', ['e' => self::N, 'ec' => self::CA], $this->now + 300);
        $this->write('aaaa', 'c1', ['e' => self::N, 'ec' => self::CB, 'tk' => 1], $this->now + 400);
        $map = $this->store->read(7, $this->now + 410);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($map, self::N, $this->now + 410, self::CB), 'taken over');
        $this->assertSame('bbbb', PresenceStore::leaseHolder($map, self::N, $this->now + 410, self::CA), 'the other cell stays');
    }

    public function testPublicWithoutCellHasExactlyTenFields(): void {
        $this->write('aaaa', 'c1', ['c' => [1, 1], 'e' => self::N], $this->now);
        $this->write('bbbb', 'c2', ['c' => [2, 2]], $this->now);
        $pub = PresenceStore::public($this->store->read(7, $this->now + 10), 'x:y', $this->now + 10);
        foreach (['aaaa:c1', 'bbbb:c2'] as $k) {
            $this->assertSame(['n', 'k', 'g', 'x', 'y', 's', 'd', 'e', 'h', 'v'], array_keys($pub[$k]), $k);
        }
    }

    // ---- job 246: size limits (2 KiB per entry, 150 KiB per blob, guests at most 100) ----

    private static function ids(int $n, string $prefix = ''): array {
        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $out[] = substr(self::N, 0, 22) . $prefix . sprintf('%04d', $i);
        }
        return array_map(static fn (string $id): string => substr($id, 0, 26), $out);
    }

    /** $n laser points [x, y, d], oldest first (d falls), at ±$abs. */
    private static function trail(int $n, float $abs, int $from = 2490): array {
        $l = [];
        for ($i = 0; $i < $n; $i++) {
            $l[] = [($i % 2 ? -1 : 1) * $abs, -$abs + $i / 10, $from - intdiv($i * $from, $n)];
        }
        return $l;
    }

    /** The largest me of audit S1: cursor, 20 s, 20 d, an invented e, v, 100 laser points, all at ±1e7. */
    private static function floodMe(?string $e = null): array {
        return ['c' => [-9999999.9, -9999999.9], 's' => self::ids(20),
            'd' => array_map(static fn (string $id): array => [$id, -9999999.9, -9999999.9], self::ids(20, 'D')),
            'e' => $e ?? self::M, 'v' => [-9999999.9, -9999999.9, 9999999.9, 9999999.9],
            'l' => array_map(static fn (int $i): array => [-9999999.9, -9999999.9, 10000 - $i], range(0, 99))];
    }

    private static function bytes(array $v): int {
        return strlen((string)json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE));
    }

    public function testAFloodEntryIsCutToTwoKibKeepingTheNewestLaserPoint(): void {
        $me = self::floodMe();
        $e = PresenceStore::entry(self::p('aaaa', true, str_repeat('G', 40)), $me, $this->now);
        $this->assertLessThanOrEqual(2048, self::bytes($e));
        $this->assertNotNull($e['l'], 'l is cut, not dropped, while points fit');
        $this->assertLessThan(100, count($e['l']));
        $this->assertSame([-9999999.9, -9999999.9, 9901], end($e['l']), 'the newest point stays');
        $this->assertSame($e['l'], PresenceStore::laser($e['l']), 'still a valid trail');
        $this->assertSame([20, 20], [count($e['s']), count($e['d'])], 'l alone was enough');
        $this->assertSame([self::M, 1, 2048 >= self::bytes($e)], [$e['e'], $e['rk'], true]);
    }

    public function testCutOrderLaserThenDragThenSelection(): void {
        // (a) too big only through l: d and s stay whole
        $e = PresenceStore::entry(self::p('aaaa'), ['s' => self::ids(5), 'd' => [[self::N, 1, 2], [self::M, 3, 4]], 'l' => self::trail(100, 9999999.9)], $this->now);
        $this->assertSame([5, 2], [count($e['s']), count($e['d'])]);
        $this->assertLessThan(100, count($e['l']));
        // (b) too big without l: d loses rows from the end, s stays whole
        $me = self::floodMe();
        unset($me['l']);
        $long = self::p('bbbb', false, str_repeat('😀', 120));
        $e = PresenceStore::entry($long, $me, $this->now);
        $this->assertLessThanOrEqual(2048, self::bytes($e));
        $this->assertNull($e['l']);
        $this->assertCount(20, $e['s']);
        $this->assertGreaterThan(0, count($e['d']));
        $this->assertLessThan(20, count($e['d']));
        $this->assertSame(array_slice($me['d'], 0, count($e['d']))[0][0], $e['d'][0][0], 'the first rows stay');
        // (c) s is cut only once d is empty
        $huge = self::p('cccc', false, str_repeat('n', 1500));
        $e = PresenceStore::entry($huge, $me, $this->now);
        $this->assertLessThanOrEqual(2048, self::bytes($e));
        $this->assertSame([], $e['d']);
        $this->assertGreaterThan(0, count($e['s']));
        $this->assertLessThan(20, count($e['s']));
        $this->assertSame(array_slice(self::ids(20), 0, count($e['s'])), $e['s'], 's loses ids from the end');
        $this->assertSame(str_repeat('n', 1500), $e['n'], 'the name stays');
    }

    public function testCutTrailNeverStartsWithAStrokeBreak(): void {
        // two strokes; the cut ends right behind the break: the break goes with it
        $first = self::trail(20, 9999999.9, 2490);
        $second = self::trail(79, 9999999.9, 120);
        $l = array_merge($first, [null], $second);
        $this->assertNotNull(PresenceStore::laser($l), 'valid input');
        $e = PresenceStore::entry(self::p('aaaa'), ['l' => $l], $this->now);
        $this->assertLessThanOrEqual(2048, self::bytes($e));
        $this->assertLessThan(79, count($e['l']), 'the cut reached into the second stroke');
        $this->assertIsArray($e['l'][0], 'no break in front');
        $this->assertSame($e['l'], PresenceStore::laser($e['l']));
        $this->assertSame(PresenceStore::laser($second)[78], end($e['l']));
    }

    public function testNormalLaserEntryIsUnchanged(): void {
        $me = ['c' => [812.3, -455.1], 'v' => [-1200, -800, 2400, 1600], 'l' => self::trail(80, 999.9)];
        $e = PresenceStore::entry(self::p('aaaaaaaaaaaaaaaa', false, str_repeat('N', 40)), $me, $this->now);
        $this->assertLessThanOrEqual(2048, self::bytes($e));
        $this->assertSame(PresenceStore::laser($me['l']), $e['l'], 'all 80 points');
        $me = ['c' => [1, 2], 's' => self::ids(5), 'd' => array_map(static fn (string $id): array => [$id, 1234.5, -2345.6], self::ids(3, 'D')), 'e' => self::N];
        $e = PresenceStore::entry(self::p('aaaaaaaaaaaaaaaa', false, str_repeat('N', 40)), $me, $this->now);
        $this->assertSame([5, 3], [count($e['s']), count($e['d'])], 'a normal selection and drag stay whole');
    }

    public function testCuttingKeepsTheLease(): void {
        $this->write('bbbb', 'c', ['e' => self::N], $this->now);
        [, $map] = $this->write('aaaa', 'c', ['e' => self::N, 'tk' => 1, 'l' => self::trail(100, 9999999.9)], $this->now + 10);
        $this->assertSame('aaaa', PresenceStore::leaseHolder($map, self::N, $this->now + 10), 'take-over works with a cut entry');
        $this->assertSame($map['bbbb:c']['es'] - 1, $map['aaaa:c']['es']);
    }

    public function testAtMostOneHundredGuestEntries(): void {
        $t = $this->now;
        for ($i = 0; $i < 30; $i++) {
            $this->writeAs(self::principal(sprintf('a%015d', $i), Role::Edit), 'c', ['c' => [1, 1]], $t++);
        }
        for ($i = 0; $i < 120; $i++) {
            [, $map] = $this->writeAs(self::principal(sprintf('g%015d', $i), Role::Edit, false, true), 'c', ['c' => [1, 1]], $t++);
            $this->assertLessThanOrEqual(PresenceStore::MAX_GUEST_ENTRIES, count(array_filter($map, static fn (array $e): bool => $e['g'] === 1)));
        }
        $map = $this->store->read(7, $t);
        $this->assertCount(100, array_filter($map, static fn (array $e): bool => $e['g'] === 1));
        $this->assertCount(30, array_filter($map, static fn (array $e): bool => $e['g'] === 0), 'all accounts stay');
        $this->assertArrayHasKey(sprintf('g%015d', 119) . ':c', $map);
        $this->assertArrayNotHasKey(sprintf('g%015d', 0) . ':c', $map, 'the oldest guests went');
    }

    public function testGuestsGoBeforeAccountsHoldersAndModeratorsAsBefore(): void {
        // 150 accounts and 50 younger guests, all class 3 (with v): a new account evicts a guest
        $stored = [];
        for ($i = 0; $i < 150; $i++) {
            $k = sprintf('a%015d:c', $i);
            $stored[$k] = ['g' => 0] + self::stored($k, 1, null, [0, 0, 1, 1], $this->now - 5000 + $i);
        }
        for ($i = 0; $i < 50; $i++) {
            $k = sprintf('g%015d:c', $i);
            $stored[$k] = array_merge(self::stored($k, 1, null, [0, 0, 1, 1], $this->now - 1000 + $i), ['g' => 1]);
        }
        $gone = $this->evictedBy($stored, self::principal('newaccount000000', Role::Edit), 'c');
        $this->assertSame(['g000000000000000:c'], $gone, 'the oldest guest, not the oldest account');
        // holders (class 5) by age as before, guest or account; moderators last; guests of class 2–4 before account holders
        $stored = [];
        $stored['hacc000000000000:c'] = self::stored('hacc000000000000:c', 1, self::N, null, $this->now - 3000, 10);
        $stored['hgst000000000000:c'] = array_merge(self::stored('hgst000000000000:c', 1, self::M, null, $this->now - 4000, 10), ['g' => 1]);
        $stored['plgst00000000000:c'] = array_merge(self::stored('plgst00000000000:c', 1, null, null, $this->now - 100), ['g' => 1]);
        $stored['placc00000000000:c'] = self::stored('placc00000000000:c', 1, null, null, $this->now - 9000);
        for ($i = 0; $i < 196; $i++) {
            $k = sprintf('m%015d:c', $i);
            $stored[$k] = self::stored($k, 2, null, null, $this->now - 9500 + $i);
        }
        $order = [];
        $map = $stored;
        for ($w = 0; $w < 5; $w++) {
            $this->mem->set('p:7', json_encode($map), 60);
            [, $out] = $this->writeAs(self::principal(sprintf('w%015d', $w), Role::Owner), 'c', [], $this->now + $w);
            $order[] = array_values(array_diff(array_keys($map), array_keys($out)))[0];
            $map = $out;
        }
        $this->assertSame(['plgst00000000000:c', 'placc00000000000:c', 'hgst000000000000:c', 'hacc000000000000:c', 'm000000000000000:c'], $order,
            'guest without e; account without e; the holders by age (guest first only because older); then the oldest moderator');
    }

    public function testTheBlobStaysWithin150Kib(): void {
        $stored = [];
        for ($i = 0; $i < 199; $i++) {
            $k = sprintf('a%015d:c', $i);
            $stored[$k] = PresenceStore::entry(self::principal(sprintf('a%015d', $i), Role::Edit), ['c' => [1, 1], 'l' => self::trail(100, 9999999.9)], $this->now - 2000 + $i)
                + ['es' => null];
        }
        $this->assertGreaterThan(153600, self::bytes($stored));
        $gone = $this->evictedBy($stored, self::principal('writer0000000000', Role::Edit), 'c');
        $out = $this->store->read(7, $this->now);
        $this->assertLessThanOrEqual(153600, strlen((string)$this->mem->get('p:7')), 'the stored blob');
        $this->assertGreaterThan(153600 - 2100, strlen((string)$this->mem->get('p:7')), 'no more evicted than needed');
        $this->assertSame(array_slice(array_keys($stored), 0, count($gone)), $gone, 'the oldest first');
        $this->assertArrayHasKey('writer0000000000:c', $out);
    }

    public function testTheBlobSumMatchesJsonWithMultibyteNames(): void {
        $stored = [];
        for ($i = 0; $i < 199; $i++) {
            $k = sprintf('e%015d:c', $i);
            $p = new Principal('u:e' . $i, Role::Edit, str_repeat('😀', 40), sprintf('e%015d', $i), false, 'e' . $i, 'share');
            $stored[$k] = PresenceStore::entry($p, ['c' => [1, 1], 's' => self::ids(20), 'l' => self::trail(60, 99999.9)], $this->now - 2000 + $i) + ['es' => null];
        }
        $this->evictedBy($stored, self::principal('writer0000000000', Role::Edit), 'c');
        $raw = (string)$this->mem->get('p:7');
        $this->assertLessThanOrEqual(153600, strlen($raw));
        $this->assertGreaterThan(153600 - 2100, strlen($raw));
    }

    public function testTheFloodOfAuditS1InSmall(): void {
        // 67 guests × 3 clients with the largest me, in turns; three accounts
        // keep writing: the owner (rk 2), an editor without e, an editor holding a lease
        $owner = self::principal('owner00000000000', Role::Owner);
        $bob = self::principal('bob0000000000000', Role::Edit);
        $carol = self::principal('carol00000000000', Role::Edit);
        $t = $this->now;
        for ($round = 0; $round < 2; $round++) {
            for ($g = 0; $g < 67; $g++) {
                if ($g % 10 === 0) {
                    $this->writeAs($owner, 'o', ['c' => [1, 1], 'v' => [0, 0, 10, 10]], $t++);
                    $this->writeAs($bob, 'b', ['c' => [1, 1], 'v' => [0, 0, 10, 10]], $t++);
                    $this->writeAs($carol, 'c', ['c' => [1, 1], 'v' => [0, 0, 10, 10], 'e' => self::N], $t++);
                }
                foreach (['a1', 'a2', 'a3'] as $i => $c) {
                    // each key invents its own e (audit S1): every guest entry "holds" a lease
                    $own = substr(self::M, 0, 20) . sprintf('%04d%02d', $g, $i);
                    $this->writeAs(self::principal(sprintf('x%015d', $g), Role::Edit, false, true), $c, self::floodMe($own), $t);
                    $t += 7;
                    $raw = (string)$this->mem->get('p:7');
                    $this->assertLessThanOrEqual(153600, strlen($raw));
                    if ($round === 1) {
                        $stored = json_decode($raw, true);
                        foreach (['owner00000000000:o', 'bob0000000000000:b', 'carol00000000000:c'] as $k) {
                            $this->assertArrayHasKey($k, $stored, $k . ' survives a guest write');
                        }
                    }
                }
            }
        }
        $map = $this->store->read(7, $t);
        $this->assertLessThanOrEqual(101, count(array_filter($map, static fn (array $e): bool => $e['g'] === 1)));
        $pub = PresenceStore::public($map, 'nobody:x', $t);
        foreach (['owner00000000000:o', 'bob0000000000000:b', 'carol00000000000:c'] as $k) {
            $this->assertArrayHasKey($k, $pub, $k . ' stays visible');
        }
    }
}
