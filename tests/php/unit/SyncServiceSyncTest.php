<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\SyncHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * Read path SyncService::sync (SPEC-M0 §4.5, §4.10.2, §5.2, §5.3; protocol 2:
 * SPEC-M1 §4.5, §4.13.8 — now, board, epoch, head reuse) and the snapshot
 * (SPEC-M1 §4.4) with fakes.
 */
final class SyncServiceSyncTest extends TestCase {
    private H $h;

    protected function setUp(): void {
        $this->h = new H();
        $this->h->store->addBoard(1, 42);
    }

    private static function id(int $n): string {
        return sprintf('01JB%022d', $n);
    }

    private function storeCalls(): array {
        return array_values(array_filter($this->h->log, static fn (string $l): bool => !str_starts_with($l, 'bumpRev')));
    }

    public function testFastPathWithoutStoreCall(): void {
        $this->h->cache->seedRev(1, 42);
        $this->h->log = [];
        $raw = $this->h->syncRaw(['since' => 42, 'pres' => 1]);
        $this->assertSame('{"rev":42,"now":' . $this->h->now . ',"presence":{}}', $raw, 'C19 (SPEC-M1 §4.5: with now) literally, {} never []');
        $this->assertSame([], $this->storeCalls(), 'no app SQL on the fast path (no head, no meta)');
        $this->assertSame('{"rev":42,"now":' . $this->h->now . '}', $this->h->syncRaw(['since' => 42, 'pres' => 0]));
    }

    public function testRevFromAccessResultSkipsRedis(): void {
        $this->h->log = [];
        $this->h->mem->log = [];
        $this->assertSame('{"rev":42,"now":' . $this->h->now . '}', $this->h->syncRaw(['since' => 42, 'pres' => 0], null, 42));
        $this->assertNotContains('get r:1', $this->h->mem->log);
    }

    public function testColdCacheReadsDbAndSeeds(): void {
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0]);
        $this->assertSame(['rev' => 42, 'now' => $this->h->now], $d);
        $this->assertSame(['readHead'], $this->storeCalls(), 'one head read, no meta (since = meta_rev … rev)');
        $this->assertSame(42, $this->h->cache->getRev(1));
        $this->assertSame(30, $this->h->mem->ttl('r:1'));
    }

    public function testMissingBoardIs404(): void {
        $this->expectException(HttpError::class);
        $this->h->syncDecoded(['since' => 0], null, null, 0, 99);
    }

    public function testCompactedItemsAndRemoved(): void {
        $a = self::id(1);
        $b = self::id(2);
        $this->h->apply([H::put($a, H::sticky()), H::put($b, H::sticky())]);
        $this->h->apply([H::patch($a, ['data.text' => '1'])]);
        $this->h->apply([H::patch($a, ['data.text' => '2'])]);
        $this->h->apply([H::patch($a, ['data.text' => '3']), H::remove($b)]);
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0]);
        $this->assertSame(46, $d['rev']);
        $this->assertCount(1, $d['items'], 'C20: one entry per item, latest state');
        $this->assertSame('3', $d['items'][0]['data']['text']);
        $this->assertSame([$b], $d['removed']);
        $this->assertArrayNotHasKey('more', $d);
        $this->assertSame(['id', 't', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style', 'group', 'lock'], array_keys($d['items'][0]));
    }

    public function testOwnWriteIsCoveredByTheCursor(): void {
        $this->h->cache->seedRev(1, 42);
        $this->h->system = ['knorke_dev' => true, 'knorke_dev_skip_bump' => 1.0];
        $d = $this->h->syncDecoded(['since' => 42, 'seq' => 3, 'ops' => [H::put(self::id(1), H::sticky())], 'pres' => 0]);
        $this->assertSame(['seq' => 3, 'rev' => 43, 'res' => ['ok']], $d['acks']);
        $this->assertSame(43, $d['rev'], 'C22: max(A, cached) even when the bump was lost');
        $this->assertSame(self::id(1), $d['items'][0]['id'], 'own objects in the same answer');
    }

    public function testAcksWithoutTransaction(): void {
        $d = $this->h->syncDecoded(['since' => 42, 'seq' => 1, 'ops' => [['o' => 'x']], 'pres' => 0]);
        $this->assertSame(['seq' => 1, 'rev' => null, 'res' => ['bad']], $d['acks']);
        $this->assertSame(42, $d['rev']);
        $raw = $this->h->syncRaw(['since' => 42, 'seq' => 1, 'ops' => [['o' => 'x']], 'pres' => 0]);
        $this->assertStringContainsString('"acks":{"seq":1,"rev":null,"res":["bad"]}', $raw);
    }

    public function testSinceAheadOfCacheReadsDbAndBumps(): void {
        $this->h->cache->seedRev(1, 40);
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0]);
        $this->assertSame(['rev' => 42, 'now' => $this->h->now], $d, 'safety net (b): Redis lagged provably');
        $this->assertContains('readHead', $this->h->log);
        $this->assertSame(42, $this->h->cache->getRev(1));
    }

    public function testClientFromTheFutureResyncs(): void {
        $this->h->cache->seedRev(1, 42);
        $d = $this->h->syncDecoded(['since' => 47, 'pres' => 0]);
        $this->assertTrue($d['resync']);
        $this->assertSame(42, $d['rev']);
        $this->assertArrayNotHasKey('items', $d);
    }

    public function testBelowMinRevResyncs(): void {
        $this->h->store->boards[1]['min_rev'] = 43;
        $this->h->store->boards[1]['rev'] = 43;
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0], null, 43, 43);
        $this->assertTrue($d['resync']);
        $d = $this->h->syncDecoded(['since' => 43, 'pres' => 0], null, 43, 43);
        $this->assertSame(['rev' => 43, 'now' => $this->h->now], $d, 'C26: with the snapshot rev no resync');
    }

    public function testPagingNeverCutsARev(): void {
        $this->h->app['max_items_per_board'] = 5000;
        for ($b = 0; $b < 3; $b++) {
            $ops = [];
            for ($i = 0; $i < 200; $i++) {
                $ops[] = H::put(self::id($b * 1000 + $i), H::sticky());
            }
            $this->h->apply($ops);
        }
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0]);
        $this->assertCount(400, $d['items'], 'C21: two whole revs');
        $this->assertTrue($d['more']);
        $this->assertSame(44, $d['rev']);
        $d = $this->h->syncDecoded(['since' => 44, 'pres' => 0]);
        $this->assertCount(200, $d['items']);
        $this->assertSame(45, $d['rev']);
        $this->assertArrayNotHasKey('more', $d);
    }

    public function testPresenceWrittenBeforeTheOps(): void {
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky())]);
        $alice = H::user('alice');
        $bob = H::user('bob', Role::Edit);
        $this->h->syncDecoded(['since' => 43, 'me' => ['e' => $n]], $alice);
        $d = $this->h->syncDecoded(['since' => 43, 'seq' => 1, 'ops' => [H::patch($n, ['data.text' => 'B'])]], $bob);
        $this->assertSame(['locked'], $d['acks']['res'], 'lease read from Redis although bob sent no me');
        $this->h->now += 300;
        $d = $this->h->syncDecoded(['since' => 43, 'seq' => 2, 'me' => ['e' => $n, 'tk' => 1], 'ops' => [H::patch($n, ['data.text' => 'B'])]], $bob);
        $this->assertSame(['ok'], $d['acks']['res'], 'C36: tk in the same request counts for its ops');
        $this->h->now += 300;
        $d = $this->h->syncDecoded(['since' => 44, 'seq' => 3, 'me' => ['e' => $n], 'ops' => [H::patch($n, ['data.text' => 'A'])]], $alice);
        $this->assertSame(['locked'], $d['acks']['res']);
        $this->assertSame(1, $d['presence'][$bob->pid . ':cTest']['h']);
    }

    public function testPresenceMapIsReused(): void {
        $this->h->cache->seedRev(1, 42);
        $this->h->mem->log = [];
        $d = $this->h->syncDecoded(['since' => 42, 'me' => ['c' => [1, 2]]]);
        $this->assertSame([], $d['presence'], 'self excluded');
        $gets = array_filter($this->h->mem->log, static fn (string $l): bool => $l === 'get p:1');
        $this->assertCount(1, $gets, 'the written map serves the read');
    }

    public function testPresenceOfOthers(): void {
        $this->h->cache->seedRev(1, 42);
        $g = H::guest();
        $this->h->syncDecoded(['since' => 42, 'me' => ['c' => [5, 6], 's' => [self::id(1)]]], $g);
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 1]);
        $this->assertSame([$g->pid . ':cTest'], array_keys($d['presence']));
        $this->assertSame(['n' => 'Gina', 'k' => $g->pid, 'g' => 1, 'x' => 5.0, 'y' => 6.0, 's' => [self::id(1)], 'd' => [], 'e' => null, 'h' => 0, 'v' => null], $d['presence'][$g->pid . ':cTest']);
        $this->h->now += 10000;
        $this->assertSame([], $this->h->syncDecoded(['since' => 42, 'pres' => 1])['presence'], 'gone after 10 s');
    }

    public function testVotePrincipalNeverLocksEditorsText(): void {
        // T12: vote may send me (cursor) but cannot hold the text lease.
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky())]);
        $vic = H::user('vic', Role::Vote);
        $d = $this->h->syncDecoded(['since' => 43, 'me' => ['c' => [3, 4], 'e' => $n, 'tk' => 1]], $vic);
        $this->assertSame(43, $d['rev']);
        $bob = H::user('bob', Role::Edit);
        $d = $this->h->syncDecoded(['since' => 43, 'seq' => 1, 'ops' => [H::patch($n, ['data.text' => 'B'])]], $bob);
        $this->assertSame(['ok'], $d['acks']['res'], 'an editor\'s text is not locked by a vote principal');
        $this->assertSame(['x' => 3.0, 'y' => 4.0, 'e' => null, 'h' => 0], array_intersect_key($d['presence'][$vic->pid . ':cTest'], array_flip(['x', 'y', 'e', 'h'])), 'cursor stays, e does not');
    }

    public function testViewRoleMeIsIgnored(): void {
        $this->h->cache->seedRev(1, 42);
        $viewer = H::user('vic', Role::View);
        $this->h->syncDecoded(['since' => 42, 'me' => ['c' => [1, 1]]], $viewer);
        $this->assertSame([], $this->h->presence->read(1, $this->h->now));
    }

    public function testWithoutRedis(): void {
        $off = new H(false);
        $off->store->addBoard(1, 42);
        $this->assertFalse($off->cache->available());
        $this->assertSame('{"rev":42,"now":' . $off->now . ',"presence":{}}', $off->syncRaw(['since' => 42, 'me' => ['c' => [1, 1]], 'pres' => 1]), 'SQL path, presence {} (§10.2: always with pres = 1)');
        $this->assertContains('readHead', $off->log);
        $n = self::id(1);
        $d = $off->syncDecoded(['since' => 42, 'seq' => 1, 'me' => ['e' => $n], 'ops' => [H::put($n, H::sticky()), H::patch($n, ['data.text' => 'x'])]]);
        $this->assertSame(['ok', 'ok'], $d['acks']['res'], 'no lease without Redis');
        $this->assertSame(43, $d['rev']);
        $this->assertSame([], $d['presence'], 'pres defaults to 1 → presence also on a write answer');
    }

    /**
     * Regression (Phase-2 known fix): with Redis unavailable the presence key
     * used to be OMITTED. Frozen contract §10.2 + §5.1: with pres = 1 the
     * answer ALWAYS carries presence, {} when presence is off; with pres = 0
     * never. Literal JSON, so {} can never turn into [] or vanish.
     */
    public function testWithoutRedisPresenceIsAlwaysAnObjectWithPres1(): void {
        $off = new H(false);
        $off->store->addBoard(1, 42);
        $this->assertFalse($off->presence->available());
        $n = self::id(1);
        $off->apply([H::put($n, H::sticky())]);

        $t = ',"now":' . $off->now;
        $this->assertSame('{"rev":43' . $t . ',"presence":{}}', $off->syncRaw(['since' => 43, 'pres' => 1]), 'empty sync, pres = 1');
        $this->assertSame('{"rev":43' . $t . ',"presence":{}}', $off->syncRaw(['since' => 43]), 'empty sync, pres omitted (= 1)');
        $this->assertSame('{"rev":43' . $t . '}', $off->syncRaw(['since' => 43, 'pres' => 0]), 'pres = 0 → no presence key');
        $this->assertSame('{"rev":43' . $t . ',"presence":{}}', $off->syncRaw(['since' => 43, 'me' => ['e' => $n, 'c' => [1, 2]]], H::guest()), 'guest with me');
        $this->assertSame('{"rev":43' . $t . ',"presence":{}}', $off->syncRaw(['since' => 43, 'me' => ['c' => [1, 2]]], H::user('vic', Role::View)), 'view role (me ignored)');

        $d = $off->syncDecoded(['since' => 42, 'pres' => 1]);
        $this->assertSame(['rev', 'now', 'items', 'presence'], array_keys($d), 'item page + presence');
        $this->assertSame([], $d['presence']);

        $d = $off->syncDecoded(['since' => 99, 'pres' => 1]);
        $this->assertSame(['rev' => 43, 'now' => $off->now, 'presence' => [], 'resync' => true], $d, 'resync answer carries presence too (§4.5: acks and presence still count)');
        $this->assertSame('{"rev":43' . $t . ',"resync":true}', $off->syncRaw(['since' => 99, 'pres' => 0]));

        $raw = $off->syncRaw(['since' => 43, 'seq' => 1, 'me' => ['e' => $n], 'ops' => [H::patch($n, ['data.text' => 'x'])], 'pres' => 1]);
        $this->assertStringEndsWith(',"presence":{}}', $raw, 'write answer: acks, items, then presence {}');
        $this->assertSame([], $off->mem->log, 'presence off touches no cache at all');
    }

    public function testSnapshotJson(): void {
        // SPEC-M1 §4.4: proto, epoch, now, rev, minRev, schema, board (title,
        // metaRev, meta from ONE read after the rev), me (mod, source), items.
        $this->h->apply([H::put(self::id(2), H::sticky()), H::put(self::id(1), H::frame(), 'frame')]);
        $this->h->apply([H::remove(self::id(2))]);
        $this->h->store->boards[1]['title'] = 'T </script>';
        $links = ['edit' => ['token' => 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'role' => 'edit', 'url' => 'https://x/p/Ab3dEf6hIj9kLm2nOp5qRs8t'], 'vote' => null];
        $json = $this->h->sync->snapshotJson(new AccessResult(H::user(), 44, 0, 0), 1,
            ['id' => 1, 'title' => 'stale', 'role' => 'owner', 'links' => $links, 'linksAllowed' => true, 'schema' => 1], null, $this->h->now);
        $d = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['proto', 'epoch', 'now', 'rev', 'minRev', 'schema', 'board', 'me', 'items'], array_keys($d));
        $this->assertSame([Application::PROTOCOL, H::EPOCH, $this->h->now, 44, 0, 1], [$d['proto'], $d['epoch'], $d['now'], $d['rev'], $d['minRev'], $d['schema']]);
        $this->assertSame(['id' => 1, 'title' => 'T </script>', 'role' => 'owner', 'metaRev' => 0, 'meta' => [], 'links' => $links, 'linksAllowed' => true], $d['board'], 'the stored title wins');
        $this->assertStringContainsString('"metaRev":0,"meta":{},"links":{"edit":{', $json, 'meta {} when empty, links an object');
        $this->assertStringContainsString('"vote":null}', $json);
        $this->assertSame(['pid', 'name', 'role', 'guest', 'mod', 'source'], array_keys($d['me']));
        $this->assertSame([false, true, 'own'], [$d['me']['guest'], $d['me']['mod'], $d['me']['source']]);
        $this->assertSame([self::id(1)], array_column($d['items'], 'id'), 'live items only');
        $this->assertStringContainsString('"style":{"fill":"#ffffff"}', $json);
        $this->assertStringNotContainsString('"link":', $json, 'board.link of M0 is gone');

        $g = json_decode($this->h->sync->snapshotJson(new AccessResult(H::guest(), null, 0), 1, ['id' => 1, 'role' => 'edit'], ['token' => 'a.b', 'exp' => 5], $this->h->now), true);
        $this->assertSame(['token' => 'a.b', 'exp' => 5], $g['guest']);
        $this->assertSame(44, $g['rev'], 'rev read from the DB when the access check did not');
        $this->assertSame([true, false, 'guest', 'edit'], [$g['me']['guest'], $g['me']['mod'], $g['me']['source'], $g['me']['role']]);
        $this->assertSame(['id', 'title', 'role', 'metaRev', 'meta'], array_keys($g['board']), 'guests get no links, linksAllowed or linkPolicy');

        $m = json_decode($this->h->sync->snapshotJson(new AccessResult(H::user('bob', Role::Edit), 44, 0, 0), 1, ['id' => 1, 'role' => 'edit']), true);
        $this->assertSame([false, 'link', 'edit'], [$m['me']['mod'], $m['me']['source'], $m['me']['role']], 'a link member: no moderation, source link');
        $this->assertSame(['id', 'title', 'role', 'metaRev', 'meta'], array_keys($m['board']));
    }

    public function testSnapshotCarriesStoredMetaVerbatim(): void {
        // A meta written by MetaService: spliced as stored ({} stays {} at any
        // depth), metaRev as stored; corrupt or list values count as {}.
        $meta = '{"timer":{"state":"paused","left":123000,"by":"Alice Adler","seq":3},"x":{}}';
        $this->h->store->metaWrite(1, 'Retro', $meta);
        $json = $this->h->sync->snapshotJson(new AccessResult(H::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']);
        $this->assertStringContainsString('"metaRev":43,"meta":' . $meta . '}', $json);
        $this->assertSame([43, 'Retro'], [json_decode($json, true)['rev'], json_decode($json, true)['board']['title']]);
        foreach (['[1,2]', 'not json', '[]', '"x"'] as $bad) {
            $this->h->store->boards[1]['meta'] = $bad;
            $this->assertStringContainsString('"meta":{}', $this->h->sync->snapshotJson(new AccessResult(H::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']), $bad);
        }
    }

    public function testSnapshotReadsRevThenMetaThenItems(): void {
        // A meta read BEFORE the rev could hand out an old title together with
        // a cursor past its change; after the rev it is always as new.
        $this->h->log = [];
        $this->h->sync->snapshotJson(new AccessResult(H::guest(), null, 0), 1, ['id' => 1, 'role' => 'edit']);
        $this->assertSame(['readRev', 'meta', 'snapshotItems'], $this->storeCalls());
        $this->h->log = [];
        $this->h->sync->snapshotJson(new AccessResult(H::user(), 42, 0, 0), 1, ['id' => 1, 'role' => 'owner']);
        $this->assertSame(['meta', 'snapshotItems'], $this->storeCalls(), 'the full check read the rev');
    }

    public function testSnapshotNowIsTheServerClock(): void {
        // now = max(request time, clock while building) — never before the request.
        $this->h->sync->clock = $this->h->now + 250;
        $d = json_decode($this->h->sync->snapshotJson(new AccessResult(H::user(), 42, 0, 0), 1, ['id' => 1, 'role' => 'owner'], null, $this->h->now), true);
        $this->assertSame($this->h->now + 250, $d['now']);
        $this->h->sync->clock = 0;
        $this->assertSame($this->h->now, $this->h->syncDecoded(['since' => 42, 'pres' => 0], null, 42, 0, 1, 0)['now']);
    }

    public function testBoardOnlyWhileTheCursorIsBelowMetaRev(): void {
        // SPEC-M1 §4.13.8 step 7: `board` on the slow path when since <
        // meta_rev, as {title, meta, metaRev}; repeated while the cursor stays
        // below (harmless); never on the fast path; the board rows are read
        // after the head.
        $this->h->cache->seedRev(1, 42);
        $this->h->store->metaWrite(1, 'Live', '{"summon":{"pid":"p","client":"c","name":"A","seq":1,"at":5}}');
        $this->h->cache->bumpRev(1, 43);
        $this->h->log = [];
        $raw = $this->h->syncRaw(['since' => 42, 'pres' => 0]);
        $this->assertSame('{"rev":43,"now":' . $this->h->now . ',"board":{"title":"Live","meta":{"summon":{"pid":"p","client":"c","name":"A","seq":1,"at":5}},"metaRev":43}}', $raw);
        $this->assertSame(['readHead', 'itemsSince 42 43', 'readMinRev', 'meta'], $this->storeCalls(), 'head, page, min_rev again (R19), then the meta row');
        $this->h->log = [];
        $this->assertSame('{"rev":43,"now":' . $this->h->now . '}', $this->h->syncRaw(['since' => 43, 'pres' => 0]), 'fast path: no board');
        $this->assertSame([], $this->storeCalls());

        // An item write after the meta change: a client between both still gets board.
        $this->h->apply([H::put(self::id(1), H::sticky())]);
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0]);
        $this->assertSame([44, 'Live', 43], [$d['rev'], $d['board']['title'], $d['board']['metaRev']]);
        $this->assertSame(['rev', 'now', 'board', 'items'], array_keys($d), 'board before items (§4.5)');
        $d = $this->h->syncDecoded(['since' => 43, 'pres' => 0]);
        $this->assertArrayNotHasKey('board', $d, 'since = meta_rev: nothing new');
        $this->assertSame([self::id(1)], array_column($d['items'], 'id'));
    }

    public function testRenameWithEmptyMetaSendsAnEmptyObject(): void {
        $this->h->cache->seedRev(1, 42);
        $this->h->store->metaWrite(1, 'Renamed');
        $this->h->cache->bumpRev(1, 43);
        $raw = $this->h->syncRaw(['since' => 40, 'pres' => 0]);
        $this->assertStringContainsString(',"board":{"title":"Renamed","meta":{},"metaRev":43}', $raw, 'NULL meta → {}');
    }

    public function testHeadOfTheFullCheckIsReused(): void {
        // §4.13.8 step 7: a full check read rev, min_rev and meta_rev in one
        // row — reused when its rev is the answered rev (no second read).
        $this->h->store->metaWrite(1, 'T');
        $this->h->log = [];
        $d = $this->h->syncDecoded(['since' => 40, 'pres' => 0], null, 43, 0, 1, 43);
        $this->assertSame([43, 43], [$d['rev'], $d['board']['metaRev']]);
        $this->assertSame(['itemsSince 40 43', 'readMinRev', 'meta'], $this->storeCalls(), 'no readHead; min_rev after the page (R19)');
        // Without meta_rev (an AccessResult of a check that did not read it) the head is read.
        $this->h->log = [];
        $this->h->syncDecoded(['since' => 40, 'pres' => 0], null, 43, 0, 1, null);
        $this->assertSame(['readHead', 'itemsSince 40 43', 'readMinRev', 'meta'], $this->storeCalls());
    }

    public function testOwnWriteNeverReusesAStaleHead(): void {
        // Regression (race found while implementing §4.13.8): the full check
        // read the head at rev 42 (meta_rev 0); before this request's write
        // took the lock, a rename committed (rev 43 = meta_rev). The own write
        // is rev 44. Reusing the stale head (meta_rev 0) would answer rev 44
        // WITHOUT board — the client's cursor would pass the rename forever.
        $a = new AccessResult(H::user(), 42, 0, 0);
        $this->h->store->metaWrite(1, 'Renamed meanwhile');
        $r = \OCA\Knorke\Service\SyncRequest::fromBody(['proto' => Application::PROTOCOL, 'client' => 'cTest', 'ep' => H::EPOCH,
            'since' => 42, 'seq' => 1, 'ops' => [H::put(self::id(1), H::sticky())], 'pres' => 0]);
        $d = json_decode($this->h->sync->sync($a, 1, $r, $this->h->now), true);
        $this->assertSame(['seq' => 1, 'rev' => 44, 'res' => ['ok']], $d['acks']);
        $this->assertSame([44, 'Renamed meanwhile', 43], [$d['rev'], $d['board']['title'], $d['board']['metaRev']]);
        $this->assertContains('readHead', $this->h->log, 'the head is read again after the own write');
    }

    public function testMinRevOfTheHeadResyncs(): void {
        // The cleanup raised min_rev after the gens were cached (§4.13.7
        // window): the slow path reads min_rev from the DB and resyncs.
        $this->h->cache->seedRev(1, 42);
        $this->h->cache->seedGens(1, 1, 1, 0, true, 1);
        $this->h->store->boards[1]['min_rev'] = 41;
        $d = $this->h->syncDecoded(['since' => 40, 'pres' => 0], null, null, 0);
        $this->assertSame(['rev' => 42, 'now' => $this->h->now, 'resync' => true], $d);
        $this->assertSame(['readHead'], $this->storeCalls(), 'no page, no meta');
    }

    public function testForeignEpochResyncsButStillAppliesTheOps(): void {
        // SPEC-M1 §4.5, §5.4: ep ≠ current epoch → resync: true; the ops of the
        // request are applied (LWW, like every resync). Fast path: still no SQL.
        $this->h->cache->seedRev(1, 42);
        $this->h->log = [];
        $raw = $this->h->syncRaw(['since' => 42, 'pres' => 1, 'ep' => 'oldepoch']);
        $this->assertSame('{"rev":42,"now":' . $this->h->now . ',"presence":{},"resync":true}', $raw);
        $this->assertSame([], $this->storeCalls(), 'an epoch check costs no SQL');
        $d = $this->h->syncDecoded(['since' => 40, 'ep' => 'oldepoch', 'seq' => 4, 'ops' => [H::put(self::id(1), H::sticky())], 'pres' => 0]);
        $this->assertSame(['seq' => 4, 'rev' => 43, 'res' => ['ok']], $d['acks']);
        $this->assertTrue($d['resync']);
        $this->assertArrayNotHasKey('items', $d);
        $this->assertArrayNotHasKey('board', $d);
        $this->assertNotNull($this->h->store->live(1, self::id(1)));
        // After a rotation the old epoch of the client is the foreign one.
        $this->h->epoch->value = 'n3w3p0ch';
        $this->assertTrue($this->h->syncDecoded(['since' => 43, 'pres' => 0])['resync'], 'ep = the epoch before the rotation');
        $this->assertArrayNotHasKey('resync', $this->h->syncDecoded(['since' => 43, 'pres' => 0, 'ep' => 'n3w3p0ch']));
    }

    public function testGoneBoardOnTheSlowPathIs404(): void {
        $this->h->cache->seedRev(1, 43);
        unset($this->h->store->boards[1]);
        $this->expectException(HttpError::class);
        $this->h->syncDecoded(['since' => 40, 'pres' => 0]);
    }

    public function testSyncPageAndTombstones(): void {
        // T1: items appended while the rows are consumed; a tombstone carries only its id.
        $ids = [];
        for ($i = 1; $i <= 5; $i++) {
            $ids[] = self::id($i);
        }
        $this->h->apply(array_map(static fn (string $id): array => H::put($id, H::sticky(['data' => ['text' => $id]])), $ids));
        $this->h->apply([H::remove($ids[1]), H::remove($ids[3])]);
        $raw = $this->h->syncRaw(['since' => 42, 'pres' => 0]);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame([$ids[0], $ids[2], $ids[4]], array_column($d['items'], 'id'));
        $this->assertSame([$ids[1], $ids[3]], $d['removed']);
        $this->assertSame($ids[2], $d['items'][1]['data']['text']);
        $this->assertStringNotContainsString($ids[1] . '"}', $raw, 'no payload of a tombstone');
        $this->h->apply([H::remove($ids[0]), H::remove($ids[2]), H::remove($ids[4])]);
        $this->assertSame('{"rev":45,"now":' . $this->h->now . ',"removed":["' . implode('","', [$ids[1], $ids[3], $ids[0], $ids[2], $ids[4]]) . '"]}', $this->h->syncRaw(['since' => 42, 'pres' => 0]), 'no "items" key without live items');
    }

    public function testMeWhenTheAccessLevelDiffersStage2(): void {
        // SPEC-M1 §4.5, §4.13.8 step 8: role = the access level the client knows;
        // a different one answers me: {role, mod} (role = the Role, mod = canModerate()).
        $this->h->cache->seedRev(1, 42);
        $moderator = H::user('bob', Role::Edit, 'share', true);
        $this->assertSame('{"rev":42,"now":' . $this->h->now . '}', $this->h->syncRaw(['since' => 42, 'pres' => 0, 'role' => 'moderate'], $moderator), 'same level: no me');
        $this->assertSame('{"rev":42,"now":' . $this->h->now . ',"me":{"role":"edit","mod":true},"presence":{}}',
            $this->h->syncRaw(['since' => 42, 'pres' => 1, 'role' => 'edit'], $moderator), 'edit → moderate on the fast path: me before presence');
        $this->assertSame(['role' => 'edit', 'mod' => false], $this->h->syncDecoded(['since' => 42, 'pres' => 0, 'role' => 'moderate'], H::user('bob', Role::Edit, 'share'))['me'], 'demoted to edit');
        $this->assertSame(['role' => 'view', 'mod' => false], $this->h->syncDecoded(['since' => 42, 'pres' => 0, 'role' => 'edit'], H::user('bob', Role::View, 'share'))['me']);
        $this->assertSame(['role' => 'vote', 'mod' => false], $this->h->syncDecoded(['since' => 42, 'pres' => 0, 'role' => 'edit'], H::guest('gAAAAAAAAAAA', 'Gina', Role::Vote))['me']);
        $this->assertSame(['role' => 'owner', 'mod' => true], $this->h->syncDecoded(['since' => 42, 'pres' => 0, 'role' => 'view'])['me']);
        $this->assertArrayNotHasKey('me', $this->h->syncDecoded(['since' => 42, 'pres' => 0]), 'no role sent: no me');
        $this->assertArrayNotHasKey('me', $this->h->syncDecoded(['since' => 42, 'pres' => 0, 'role' => 'owner']));
        // Slow path: after board, before items.
        $a = self::id(1);
        $this->h->apply([H::put($a, H::sticky())]);
        $raw = $this->h->syncRaw(['since' => 42, 'pres' => 0, 'role' => 'view']);
        $this->assertStringStartsWith('{"rev":43,"now":' . $this->h->now . ',"me":{"role":"owner","mod":true},"items":[', $raw);
    }

    public function testPurgeBetweenHeadAndPageDropsThePage(): void {
        // SPEC-M1 §4.13.8 step 7 (R19, T4-05): a purge block commits between
        // readHead and itemsSince and raises min_rev above since. The page
        // then lacks the purged tombstones; min_rev read AFTER the page
        // drops it: resync, no items/removed/more.
        $a = self::id(1);
        $b = self::id(2);
        $this->h->apply([H::put($a, H::sticky()), H::put($b, H::sticky())]);
        $this->h->apply([H::remove($b)]);
        $this->h->store->onItemsSince = function (int $board): void {
            unset($this->h->store->items[$board][self::id(2)]);
            $this->h->store->boards[$board]['min_rev'] = 44;
        };
        $this->h->log = [];
        $d = $this->h->syncDecoded(['since' => 42, 'pres' => 0]);
        $this->assertSame(['rev' => 44, 'now' => $this->h->now, 'resync' => true], $d, 'the page is dropped, resync');
        $this->assertSame(['readHead', 'itemsSince 42 44', 'readMinRev'], $this->storeCalls(), 'min_rev read once more after the page; no meta read');
    }

    public function testMinRevAfterThePageAtOrBelowSinceKeepsThePage(): void {
        // A purge that commits during the page but stays at or below since
        // takes nothing the client still needs: the page is delivered.
        $a = self::id(1);
        $this->h->apply([H::put($a, H::sticky())]);
        $this->h->apply([H::patch($a, ['data.text' => 'x'])]);
        $this->h->store->onItemsSince = function (int $board): void {
            $this->h->store->boards[$board]['min_rev'] = 43;
        };
        $d = $this->h->syncDecoded(['since' => 43, 'pres' => 0]);
        $this->assertSame([44, [$a]], [$d['rev'], array_column($d['items'], 'id')]);
        $this->assertArrayNotHasKey('resync', $d);
        // The fast path still reads nothing (rev == since): no min_rev read.
        $this->h->cache->seedRev(1, 44);
        $this->h->log = [];
        $this->h->syncRaw(['since' => 44, 'pres' => 0]);
        $this->assertSame([], $this->storeCalls());
    }

    /**
     * M2 data foundation: every role gets the same items, each with group and
     * lock; lock.by is the pid (Access::derivePid with the system secret),
     * never the stored principal id; the slow sync path sends the same object.
     */
    public function testGroupAndLockForEveryRole(): void {
        $a = self::id(1);
        $b = self::id(2);
        $this->h->apply([H::put($a, H::sticky()), H::put($b, H::sticky([], 'i2'))]);
        $this->h->store->items[1][$a] = ['group_id' => '01JF5Q4T0V9W8X7Y6Z5A4B3C2D', 'locked' => 1, 'locked_by' => 'u:alice', 'locked_name' => 'Alice Adler'] + $this->h->store->items[1][$a];
        $pid = Access::derivePid(H::SECRET, 1, 'u:alice');
        $roles = [
            'owner' => H::user(),
            'edit with moderation' => H::user('bob', Role::Edit, 'share', true),
            'edit' => H::user('bob', Role::Edit, 'share'),
            'vote' => H::user('carol', Role::Vote, 'share'),
            'view' => H::user('dave', Role::View, 'share'),
            'guest' => H::guest(),
        ];
        $items = null;
        foreach ($roles as $label => $p) {
            $this->h->secretReads = 0;
            $json = $this->h->sync->snapshotJson(new AccessResult($p, null, 0), 1, ['id' => 1, 'role' => $p->role->value],
                $p->isGuest ? ['token' => 'a.b', 'exp' => 5] : null, $this->h->now);
            $this->assertStringNotContainsString('u:alice', $json, "$label: no principal id in the answer");
            $d = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            $items ??= $d['items'];
            $this->assertSame($items, $d['items'], "$label: identical items");
            $this->assertSame(1, $this->h->secretReads, "$label: the secret read once for the answer");
        }
        $byId = array_column($items, null, 'id');
        $this->assertSame(['01JF5Q4T0V9W8X7Y6Z5A4B3C2D', ['by' => $pid, 'name' => 'Alice Adler']], [$byId[$a]['group'], $byId[$a]['lock']]);
        $this->assertSame([null, null], [$byId[$b]['group'], $byId[$b]['lock']]);
        foreach ($items as $it) {
            $this->assertSame(['id', 't', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style', 'group', 'lock'], array_keys($it));
        }

        // the slow path (itemsSince) delivers the same objects
        $this->h->secretReads = 0;
        $raw = $this->h->syncRaw(['since' => 42, 'pres' => 0], H::guest());
        $this->assertStringNotContainsString('u:alice', $raw);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($items, $d['items'], 'slow path = snapshot');
        $this->assertSame(1, $this->h->secretReads);
    }

    public function testTheSecretIsOnlyReadForALockedRow(): void {
        $this->h->apply([H::put(self::id(1), H::sticky())]);
        $this->h->store->items[1][self::id(1)] += ['locked_by' => 'u:alice', 'locked_name' => 'Alice'];
        $this->h->secretReads = 0;
        $snap = $this->h->sync->snapshotJson(new AccessResult(H::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']);
        $this->assertStringEndsWith(',"group":null,"lock":null}]}', $snap, 'locked_by without locked: not locked');
        $this->h->syncRaw(['since' => 42, 'pres' => 0]);
        $this->assertSame(0, $this->h->secretReads, 'no locked row: the secret is never read');
        // locked, locker unknown: no pid to derive either
        $this->h->store->items[1][self::id(1)] = ['locked' => 1, 'locked_by' => null, 'locked_name' => null] + $this->h->store->items[1][self::id(1)];
        $this->assertStringEndsWith(',"lock":{"by":null,"name":null}}]}', $this->h->sync->snapshotJson(new AccessResult(H::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']));
        $this->assertSame(0, $this->h->secretReads);
        // two locked rows of the same answer: one read
        $this->h->apply([H::put(self::id(2), H::sticky([], 'i2'))]);
        foreach ([1 => 'u:alice', 2 => 'g:gAAAAAAAAAAA'] as $n => $who) {
            $this->h->store->items[1][self::id($n)] = ['locked' => 1, 'locked_by' => $who] + $this->h->store->items[1][self::id($n)];
        }
        $d = json_decode($this->h->sync->snapshotJson(new AccessResult(H::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']), true);
        $this->assertSame([Access::derivePid(H::SECRET, 1, 'u:alice'), Access::derivePid(H::SECRET, 1, 'g:gAAAAAAAAAAA')], array_column(array_column($d['items'], 'lock'), 'by'));
        $this->assertSame(1, $this->h->secretReads);
    }

    /**
     * Job 023 (M2 R20): a lock op through /sync answers ok and the writer's
     * own answer carries the item with lock {by: pid, name} (the principal,
     * never the value sent); a later sync of any role (owner, guest) gets
     * the same lock through itemsSince; itemlocked travels per op.
     */
    public function testLockThroughSyncReachesEveryRole(): void {
        $a = self::id(1);
        $this->h->apply([H::put($a, H::sticky())]);
        $bob = H::user('bob', Role::Edit, 'share');
        $d = $this->h->syncDecoded(['since' => 43, 'seq' => 1, 'pres' => 0, 'ops' => [['o' => 'patch', 'id' => $a, 'p' => ['lock' => ['by' => 'forged', 'name' => 'Mallory']]]]], $bob);
        $this->assertSame(['ok'], $d['acks']['res']);
        $pid = Access::derivePid(H::SECRET, 1, 'u:bob');
        $this->assertSame(['by' => $pid, 'name' => 'Bob'], $d['items'][0]['lock'], 'the principal is the locker');
        foreach ([H::user(), H::guest()] as $p) {
            $seen = $this->h->syncDecoded(['since' => 43, 'pres' => 0], $p);
            $this->assertSame(['by' => $pid, 'name' => 'Bob'], array_column($seen['items'], 'lock', 'id')[$a], $p->id);
        }
        $d = $this->h->syncDecoded(['since' => 44, 'seq' => 2, 'pres' => 0, 'ops' => [H::patch($a, ['style.fill' => '#ffffff']), ['o' => 'patch', 'id' => $a, 'p' => ['lock' => null]]]], H::guest());
        $this->assertSame(['itemlocked', 'itemlocked'], $d['acks']['res'], 'per op: the edit and the foreign unlock');
    }
}
