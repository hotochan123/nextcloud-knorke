<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\PresenceStore;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\SyncHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * Write path SyncService::applyOps (SPEC-M0 §4.10.1, §4.7; SPEC-M1 §4.7 rules
 * 12–15, 18, 19, §4.13.2) with an in-memory store that records every call and
 * enforces the primary keys.
 */
final class SyncServiceApplyTest extends TestCase {
    private H $h;

    protected function setUp(): void {
        $this->h = new H();
        $this->h->store->addBoard(1, 10);
    }

    private static function id(int $n): string {
        return sprintf('01JA%022d', $n);
    }

    public function testPutWritesItemAndPutRowAndBumpsAfterCommit(): void {
        [$rev, $res] = $this->h->apply([H::put(self::id(1), H::sticky(['data' => ['text' => 'Hallo']]))]);
        $this->assertSame([11, ['ok']], [$rev, $res]);
        $this->assertSame(['begin', 'lockAndBumpRev'], array_slice($this->h->log, 0, 2), 'lockAndBumpRev is the FIRST statement');
        $this->assertGreaterThan($this->h->pos('commit'), $this->h->pos('bumpRev'), 'bumpRev only after COMMIT');
        $this->assertSame('bumpRev 11', $this->h->log[count($this->h->log) - 1]);
        $item = $this->h->store->live(1, self::id(1));
        $this->assertSame('Hallo', $item['data']['text']);
        $this->assertSame(11, $this->h->store->items[1][self::id(1)]['rev']);
        $ch = $this->h->store->changesOf(self::id(1));
        $this->assertCount(1, $ch);
        $this->assertSame('put', $ch[0]['op']);
        $this->assertSame('{"t":"sticky","x":100.0,"y":40.0,"w":200.0,"h":200.0,"r":0.0,"z":"i1","parent":null,"data":{"text":"Hallo"},"style":{"fill":"#a8d8f8"}}', $ch[0]['patch']);
        $this->assertSame('u:alice', $ch[0]['actor']);
        $this->assertSame('cTest', $ch[0]['client']);
        $this->assertSame(1, $this->h->store->boards[1]['item_count']);
        $this->assertSame(11, $this->h->cache->getRev(1));
    }

    public function testDupGoneAndRevive(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky())]);
        $this->assertSame(['dup'], $this->h->apply([H::put($id, H::sticky(['x' => 5]))])[1]);
        $this->assertSame(['ok'], $this->h->apply([H::remove($id)])[1]);
        $this->assertNull($this->h->store->live(1, $id));
        $this->assertSame(['gone', 'gone', 'gone'], $this->h->apply([H::patch($id, ['style.fill' => '#000000']), H::remove($id), H::put($id, H::sticky())])[1], 'C14');
        [, $res] = $this->h->apply([H::put($id, H::sticky(['x' => 7]), 'sticky', true)]);
        $this->assertSame(['ok'], $res, 'C15 revive');
        $this->assertSame(7.0, $this->h->store->live(1, $id)['x']);
        $this->assertSame('put', $this->h->store->changesOf($id)[2]['op']);
        $this->assertSame(1, $this->h->store->boards[1]['item_count']);
    }

    public function testPutThenRemoveInOneBatchWritesNothing(): void {
        [$rev, $res] = $this->h->apply([H::put(self::id(1), H::sticky()), H::remove(self::id(1))]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertSame(10, $rev, 'nothing written → rollback, acks.rev = observed rev');
        $this->assertContains('rollBack', $this->h->log);
        $this->assertSame(-1, $this->h->pos('bumpRev'));
        $this->assertSame(10, $this->h->store->boards[1]['rev']);
        $this->assertArrayNotHasKey(self::id(1), $this->h->store->items[1]);
    }

    public function testRemoveThenReviveInOneBatchIsOnePutRow(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky(['data' => ['text' => 'keep']]))]);
        [$rev, $res] = $this->h->apply([H::remove($id), H::put($id, H::sticky(['data' => ['text' => 'keep'], 'x' => 9]), 'sticky', true)]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertSame(12, $rev);
        $this->assertSame(9.0, $this->h->store->live(1, $id)['x'], 'the object lives (delete + undo in one tick)');
        $rows = array_values(array_filter($this->h->store->changesOf($id), static fn ($c) => $c['rev'] === 12));
        $this->assertCount(1, $rows);
        $this->assertSame('put', $rows[0]['op']);
        $this->assertContains("reviveItem $id", $this->h->log);
        $this->assertSame(1, $this->h->store->boards[1]['item_count']);
    }

    public function testNoOpPatchWritesNothingAndRollsBack(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky(['data' => ['text' => 'same']]))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::patch($id, ['data.text' => 'same', 'style.fill' => '#A8D8F8'])]);
        $this->assertSame([11, ['ok']], [$rev, $res], 'C13: ok, acks.rev = board rev');
        $this->assertSame(['begin', 'lockAndBumpRev', 'loadItems ' . $id, 'rollBack'], $this->h->log, 'no write, no bumpRev');
        $this->assertCount(1, $this->h->store->changes);
        $this->assertSame(11, $this->h->store->boards[1]['rev']);
    }

    public function testOnlyBadBatchOpensNoTransaction(): void {
        [$rev, $res] = $this->h->apply([['o' => 'nope'], H::put(self::id(1), H::sticky(), 'pen'), H::patch(self::id(2), ['x' => 1])]);
        $this->assertSame([null, ['bad', 'bad', 'bad']], [$rev, $res], 'C18');
        $this->assertSame([], $this->h->log, 'no atomic(), no SQL');
        [$rev, $res] = $this->h->apply([H::put(self::id(1), H::sticky())], H::user('viewer', Role::View));
        $this->assertSame([null, ['denied']], [$rev, $res]);
        $this->assertSame([], $this->h->log);
    }

    public function testIneffectiveBatchRollsBack(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky())]);
        $this->h->apply([H::remove(self::id(1))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::remove($id), H::patch($id, ['style.fill' => '#000000']), ['o' => 'bad']]);
        $this->assertSame([12, ['gone', 'gone', 'bad']], [$rev, $res], 'C40: rev = observed rev');
        $this->assertContains('rollBack', $this->h->log);
        $this->assertNotContains('commit', $this->h->log);
        $this->assertSame(-1, $this->h->pos('bumpRev'));
        $this->assertSame(12, $this->h->store->boards[1]['rev']);
    }

    public function testMixedBatchKeepsOrderAndCodes(): void {
        $a = self::id(1);
        $b = self::id(2);
        [$rev, $res] = $this->h->apply([
            H::put($a, H::sticky()), H::patch($a, ['data.text' => 'x']), H::put($a, H::sticky()),
            H::patch($b, ['style.fill' => '#000000']), ['o' => 'remove', 'id' => 'bad'], H::remove($a), H::put($b, H::sticky(), 'sticky', true),
        ]);
        $this->assertSame(['ok', 'ok', 'dup', 'gone', 'bad', 'ok', 'ok'], $res);
        $this->assertSame(11, $rev);
        $this->assertNull($this->h->store->live(1, $a));
        $this->assertNotNull($this->h->store->live(1, $b), 'put revive of a never-existing id is a plain put');
        $this->assertSame([], $this->h->store->changesOf($a), 'put + patch + remove of a new id writes nothing');
    }

    public function testPatchWritesOnlyEffectivePathsAndColumns(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky(['data' => ['text' => 'a', 'tag' => 'x']]))]);
        $this->h->log = [];
        $this->h->apply([H::patch($id, ['data.text' => 'b', 'data.tag' => 'x', 'z' => 'i2', 'style.fill' => '#a8d8f8'])]);
        $this->assertContains("updateItem $id data,z", $this->h->log);
        $ch = $this->h->store->changesOf($id)[1];
        $this->assertSame('patch', $ch['op']);
        $this->assertSame('{"data.text":"b","z":"i2"}', $ch['patch']);
        $this->assertSame(2, $this->h->store->items[1][$id]['version']);
    }

    public function testLwwSamePathAndDifferentPaths(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky())]);
        $this->h->apply([H::patch($id, ['data.text' => 'A'])], H::user('alice'));
        $this->h->apply([H::patch($id, ['data.text' => 'B'])], H::user('bob', Role::Edit));
        $this->assertSame('B', $this->h->store->live(1, $id)['data']['text'], 'C11: the later rev wins');
        $this->h->apply([H::patch($id, ['data.text' => 'T'])], H::user('alice'));
        $this->h->apply([H::patch($id, ['style.fill' => '#000000'])], H::user('bob', Role::Edit));
        $item = $this->h->store->live(1, $id);
        $this->assertSame(['T', '#000000'], [$item['data']['text'], $item['style']['fill']], 'C12: both survive');
    }

    public function testEmptyValuesAreAbsent(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky())]);
        $res = $this->h->apply([H::patch($id, ['data.x' => [], 'data.y' => [], 'data.e' => ['k' => []], 'data.o' => json_decode('{"0":"a"}', true)])])[1];
        $this->assertSame(['ok'], $res);
        $data = $this->h->store->live(1, $id)['data'];
        $this->assertSame(['text' => '', 'o' => ['a']], $data, 'C35');
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['data.l' => [1, null]])])[1]);
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['data.n' => ['a' => ['1' => 'x']]])])[1]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['data.foo.bar' => [1, ['a' => 2]]])])[1], 'C08');
        $this->assertSame([1, ['a' => 2]], $this->h->store->live(1, $id)['data']['foo']['bar']);
    }

    public function testParentRules(): void {
        $f = self::id(1);
        $s = self::id(2);
        $s2 = self::id(3);
        $f2 = self::id(4);
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($s, H::sticky()), H::put($f2, H::frame(['x' => 0]), 'frame')]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($s, ['x' => 10, 'y' => 20, 'parent' => $f])])[1]);
        $this->assertSame($f, $this->h->store->live(1, $s)['parent']);
        $this->assertSame(['bad'], $this->h->apply([H::put($s2, H::sticky(['parent' => $s]))])[1], 'sticky → sticky');
        $this->assertSame(['bad'], $this->h->apply([H::patch($f2, ['x' => 0, 'y' => 0, 'parent' => $f])])[1], 'frame → frame');
        $this->assertSame(['bad'], $this->h->apply([H::put($s2, H::sticky(['parent' => self::id(99)]))])[1], 'never existing parent');
        $this->assertSame(['bad'], $this->h->apply([H::patch($s, ['x' => 0, 'y' => 0, 'parent' => $s])])[1], 'self as parent');
        // Parent created earlier in the same batch.
        $f3 = self::id(5);
        $res = $this->h->apply([H::put($f3, H::frame(['x' => 5]), 'frame'), H::put($s2, H::sticky(['parent' => $f3]))])[1];
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertSame($f3, $this->h->store->live(1, $s2)['parent']);
    }

    public function testTombstoneParentReleases(): void {
        $f = self::id(1);
        $s = self::id(2);
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($s, H::sticky())]);
        $this->h->apply([H::remove($f)]);
        $res = $this->h->apply([H::patch($s, ['x' => 50, 'y' => 60, 'parent' => $f])])[1];
        $this->assertSame(['ok'], $res, 'C16/C33: tombstone parent → release, not bad');
        $item = $this->h->store->live(1, $s);
        $this->assertSame([null, 1050.0, 560.0], [$item['parent'], $item['x'], $item['y']]);
        $new = self::id(3);
        $this->assertSame(['ok'], $this->h->apply([H::put($new, H::sticky(['x' => 1, 'y' => 2, 'parent' => $f]))])[1]);
        $this->assertSame([null, 1001.0, 502.0], [$this->h->store->live(1, $new)['parent'], $this->h->store->live(1, $new)['x'], $this->h->store->live(1, $new)['y']]);
        // A sticky (no container) as tombstone parent stays a type error.
        $t = self::id(4);
        $this->h->apply([H::put($t, H::sticky()), H::remove($t)]);
        $this->h->apply([H::put($t, H::sticky())]);
        $this->h->apply([H::remove($t)]);
        $this->assertSame(['bad'], $this->h->apply([H::patch($s, ['x' => 0, 'y' => 0, 'parent' => $t])])[1]);
    }

    public function testRemovedInSameBatchParentReleases(): void {
        $f = self::id(1);
        $s = self::id(2);
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($s, H::sticky())]);
        $res = $this->h->apply([H::remove($f), H::patch($s, ['x' => 50, 'y' => 60, 'parent' => $f])])[1];
        $this->assertSame(['ok', 'ok'], $res);
        $item = $this->h->store->live(1, $s);
        $this->assertSame([null, 1050.0, 560.0], [$item['parent'], $item['x'], $item['y']]);
    }

    public function testFrameRemovalReleasesChildrenWithOneChangeRowEach(): void {
        $f = self::id(1);
        $dbChild = self::id(2);
        $movedChild = self::id(3);
        $this->h->apply([
            H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'),
            H::put($dbChild, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f])),
            H::put($movedChild, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f])),
        ]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([
            H::patch($movedChild, ['x' => 35, 'y' => 45, 'parent' => $f, 'style.fill' => '#000000']),
            H::remove($f),
        ]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('liveChildren ' . $f, $this->h->log);
        $a = $this->h->store->live(1, $dbChild);
        $b = $this->h->store->live(1, $movedChild);
        $this->assertSame([null, 1010.0, 520.0], [$a['parent'], $a['x'], $a['y']], 'C17: absolute position kept');
        $this->assertSame([null, 1035.0, 545.0, '#000000'], [$b['parent'], $b['x'], $b['y'], $b['style']['fill']]);
        foreach ([$dbChild, $movedChild] as $c) {
            $rows = array_values(array_filter($this->h->store->changesOf($c), static fn ($ch) => $ch['rev'] === $rev));
            $this->assertCount(1, $rows, 'exactly one change row per object and rev');
            $this->assertSame('patch', $rows[0]['op']);
        }
        $this->assertSame('{"x":1010.0,"y":520.0,"parent":null}', array_values(array_filter($this->h->store->changesOf($dbChild), static fn ($ch) => $ch['rev'] === $rev))[0]['patch']);
        $this->assertSame(2, $this->h->store->boards[1]['item_count']);
    }

    public function testRemoveAndReviveOfAContainerReleasesNothing(): void {
        $f = self::id(1);
        $c = self::id(2);
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($c, H::sticky(['parent' => $f]))]);
        $this->h->apply([H::remove($f), H::put($f, H::frame(), 'frame', true)]);
        $this->assertSame($f, $this->h->store->live(1, $c)['parent']);
        $this->assertNotNull($this->h->store->live(1, $f));
    }

    public function testNewContainerRemovedInBatchReleasesBatchChildren(): void {
        $f = self::id(1);
        $c = self::id(2);
        [, $res] = $this->h->apply([H::put($f, H::frame(['x' => 100, 'y' => 200]), 'frame'), H::put($c, H::sticky(['x' => 1, 'y' => 2, 'parent' => $f])), H::remove($f)]);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        $item = $this->h->store->live(1, $c);
        $this->assertSame([null, 101.0, 202.0], [$item['parent'], $item['x'], $item['y']], 'no dangling parent');
        $this->assertArrayNotHasKey($f, $this->h->store->items[1]);
    }

    public function testConcurrentReparentingIsOneWritersTriple(): void {
        $f = self::id(1);
        $s = self::id(2);
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($s, H::sticky())]);
        $this->h->apply([H::patch($s, ['x' => 100, 'y' => 100, 'parent' => $f])], H::user('alice'));
        $this->h->apply([H::patch($s, ['x' => 2000, 'y' => 500, 'parent' => null])], H::user('bob', Role::Edit));
        $item = $this->h->store->live(1, $s);
        $this->assertSame([2000.0, 500.0, null], [$item['x'], $item['y'], $item['parent']], 'C32: exactly B\'s triple');
        $this->assertSame(['bad'], $this->h->apply([H::patch($s, ['x' => 1])])[1], 'C31');
    }

    public function testLimit(): void {
        $this->h->app['max_items_per_board'] = 2;
        [, $res] = $this->h->apply([H::put(self::id(1), H::sticky()), H::put(self::id(2), H::sticky()), H::put(self::id(3), H::sticky())]);
        $this->assertSame(['ok', 'ok', 'limit'], $res);
        $this->assertSame(['limit'], $this->h->apply([H::put(self::id(4), H::sticky())])[1]);
        [, $res] = $this->h->apply([H::remove(self::id(1)), H::put(self::id(4), H::sticky())]);
        $this->assertSame(['ok', 'ok'], $res, 'the running count frees a slot within the batch');
        $this->assertSame(2, $this->h->store->boards[1]['item_count']);
    }

    public function testItemCountDelta(): void {
        $this->h->apply([H::put(self::id(1), H::sticky()), H::put(self::id(2), H::sticky()), H::put(self::id(3), H::sticky())]);
        $this->assertNotSame(-1, $this->h->pos('addItemCount 3'));
        $this->h->log = [];
        $this->h->apply([H::remove(self::id(1)), H::put(self::id(4), H::sticky()), H::remove(self::id(4)), H::remove(self::id(2)), H::put(self::id(2), H::sticky(), 'sticky', true)]);
        $this->assertNotSame(-1, $this->h->pos('addItemCount -1'));
        $this->assertSame(2, $this->h->store->boards[1]['item_count']);
    }

    public function testTextLease(): void {
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky())]);
        $alice = H::user('alice');
        $bob = H::user('bob', Role::Edit);
        $map = [$alice->pid . ':c1' => ['k' => $alice->pid, 'e' => $n, 't' => $this->h->now, 'es' => $this->h->now]];
        // The write path re-reads presence under the lock (T7): "Redis" holds the same map.
        $this->h->presence->readMap = $map;
        $this->assertSame(['locked'], $this->h->apply([H::patch($n, ['data.text' => 'B'])], $bob, $map)[1], 'C36');
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['style.fill' => '#000000'])], $bob, $map)[1], 'other paths stay free');
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'A'])], $alice, $map)[1], 'the holder itself');
        $alice2 = new \OCA\Knorke\Service\Principal('u:alice', Role::Owner, 'Alice', $alice->pid, false, 'alice', 'owner');
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'A2'])], $alice2, $map)[1], 'same pid in a second tab is never locked');
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'B'])], $bob, null)[1], 'no presence (Redis off) → plain LWW');
        $stale = [$alice->pid . ':c1' => ['k' => $alice->pid, 'e' => $n, 't' => $this->h->now - 10001, 'es' => 1]];
        $this->h->presence->readMap = $stale;
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'C'])], $bob, $stale)[1], 'stale lease is no lease');
        $this->assertSame('C', $this->h->store->live(1, $n)['data']['text']);
        $this->assertSame($alice->pid, PresenceStore::leaseHolder($map, $n, $this->h->now));
    }

    public function testUnknownStoredTypeGenericRules(): void {
        $id = self::id(1);
        $this->h->store->seed(1, $id, ['t' => 'mindmap', 'w' => 10, 'h' => 10, 'data' => ['k' => 1]], 5);
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['data.k' => 2, 'w' => 500000])])[1]);
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['w' => 2000000])])[1]);
        $f = self::id(2);
        $this->h->apply([H::put($f, H::frame(), 'frame')]);
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['x' => 0, 'y' => 0, 'parent' => $f])])[1], 'unknown types: parent null only');
        $this->assertSame(['ok'], $this->h->apply([H::remove($id)])[1]);
    }

    public function testItemBytesUnderTheLock(): void {
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky(['data' => ['text' => str_repeat('😀', 6000)]]))]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['data.a' => str_repeat('😀', 6000), 'data.b' => str_repeat('😀', 2000)])])[1]);
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['data.c' => str_repeat('😀', 6000)])])[1], 'beyond MAX_ITEM_BYTES after applying');
    }

    public function testFloatPrecisionSurvives(): void {
        $id = self::id(1);
        $x = 123.45678901234567;
        $this->h->apply([H::put($id, H::sticky(['x' => $x]))]);
        $this->h->apply([H::patch($id, ['x' => $x + 1, 'y' => 0.1 + 0.2, 'parent' => null])]);
        $this->assertSame($x + 1, $this->h->store->live(1, $id)['x']);
        $this->assertSame(0.1 + 0.2, $this->h->store->live(1, $id)['y']);
    }

    public function testMissingBoardIs404AndRollsBack(): void {
        try {
            $this->h->apply([H::put(self::id(1), H::sticky())], null, null, 99);
            $this->fail('404 expected');
        } catch (HttpError $e) {
            $this->assertSame([404, 'not_found'], [$e->status, $e->error]);
        }
        $this->assertContains('rollBack', $this->h->log);
    }

    public function testTooManyOps(): void {
        $this->expectException(HttpError::class);
        $this->h->apply(array_fill(0, 201, H::remove(self::id(1))));
    }

    public function testDevSkipBumpHook(): void {
        $this->h->system = ['knorke_dev' => true, 'knorke_dev_skip_bump' => 1.0];
        $this->h->apply([H::put(self::id(1), H::sticky())]);
        $this->assertSame(-1, $this->h->pos('bumpRev'), 'p = 1 skips every bump');
        $this->h->system = ['knorke_dev' => false, 'knorke_dev_skip_bump' => 1.0];
        $this->h->apply([H::put(self::id(2), H::sticky())]);
        $this->assertNotSame(-1, $this->h->pos('bumpRev'), 'inert without knorke_dev');
    }


    /** item_bytes equals Σ strlen(data) + strlen(style) of the live rows. */
    public function testTombstoneCarriesNoPayloadP7(): void {
        // P7 (SPEC-M1 §33.1 c, INPUT-1, C81 (a) in small): remove sets data
        // and style to '{}' in the same write; type, placement, parent and z
        // stay; the put row of the change log keeps the payload; a revive
        // brings the full object back.
        $f = self::id(9);
        $id = self::id(1);
        $big = H::sticky(['x' => 12.5, 'y' => -7.25, 'w' => 210, 'h' => 190, 'r' => 15, 'z' => 'i7', 'parent' => $f,
            'data' => ['text' => str_repeat('😀', 6000)], 'style' => ['fill' => '#a8d8f8', 'unknownA' => str_repeat('s', 5000)]]);
        $this->h->apply([H::put($f, H::frame(), 'frame')]);
        [$putRev, $res] = $this->h->apply([H::put($id, $big)]);
        $this->assertSame(['ok'], $res);
        $before = $this->h->store->items[1][$id];
        $this->assertGreaterThanOrEqual(29000, strlen((string)$before['data']) + strlen((string)$before['style']));
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::remove($id)]);
        $this->assertSame(['ok'], $res);
        $this->assertContains("updateItem $id deleted,data,style,locked,locked_by,locked_name", $this->h->log, 'one write: deleted with the empty payload and no lock (job 023)');
        $row = $this->h->store->items[1][$id];
        $this->assertSame([1, '{}', '{}'], [$row['deleted'], $row['data'], $row['style']]);
        $this->assertSame(4, strlen($row['data']) + strlen($row['style']), 'octet length 4');
        foreach (['type', 'x', 'y', 'w', 'h', 'rotation', 'parent_id', 'z'] as $col) {
            $this->assertSame($before[$col], $row[$col], "$col unchanged");
        }
        $this->assertSame(['remove', null], [$this->rowsAt($id, $rev)[0]['op'], $this->rowsAt($id, $rev)[0]['patch']], 'remove row without payload as before');
        $put = $this->rowsAt($id, $putRev)[0];
        $this->assertSame('put', $put['op']);
        $this->assertGreaterThanOrEqual(29000, strlen((string)$put['patch']), 'the payload stays in the change log');
        $this->assertSame(str_repeat('😀', 6000), json_decode((string)$put['patch'], true)['data']['text']);
        $this->assertBytesInvariant('after the remove (a tombstone does not count)');
        // Revive with the full object (undo): ok, every column written again.
        [, $res] = $this->h->apply([H::put($id, $big, 'sticky', true)]);
        $this->assertSame(['ok'], $res);
        $row = $this->h->store->items[1][$id];
        $this->assertSame([0, $before['data'], $before['style']], [$row['deleted'], $row['data'], $row['style']], 'data complete again');
        $this->assertBytesInvariant('after the revive');
        // A patch on a tombstone stays gone.
        $this->h->apply([H::remove($id)]);
        $this->assertSame(['gone'], $this->h->apply([H::patch($id, ['data.text' => 'x'])])[1]);
    }

    private function assertBytesInvariant(string $msg = ''): void {
        $this->assertSame($this->h->store->liveBytes(1), $this->h->store->boards[1]['item_bytes'], 'item_bytes = live rows ' . $msg);
    }

    /** T1: a sticky whose data.text has $n ASCII characters (stored size known from the formula). */
    private static function note(int $n, array $p = []): array {
        return H::sticky(['data' => ['text' => str_repeat('x', $n)]] + $p);
    }

    public function testBoardByteBudget(): void {
        // T1: the per-board byte budget (boards.item_bytes) under the lock.
        $a = self::id(1);
        $b = self::id(2);
        $c = self::id(3);
        $size = strlen('{"text":"' . str_repeat('x', 400) . '"}') + strlen('{"fill":"#a8d8f8"}');
        $this->h->app['max_board_bytes'] = 2 * $size + 100;
        [, $res] = $this->h->apply([H::put($a, self::note(400)), H::put($b, self::note(400)), H::put($c, self::note(400))]);
        $this->assertSame(['ok', 'ok', 'limit'], $res, 'a put over the budget → limit');
        $this->assertSame(2 * $size, $this->h->store->boards[1]['item_bytes']);
        $this->assertArrayNotHasKey($c, $this->h->store->items[1], 'not applied');
        $this->assertBytesInvariant();

        // A growing patch → limit, the working copy untouched (a later op of the batch still sees the old state).
        [, $res] = $this->h->apply([H::patch($a, ['data.more' => str_repeat('y', 200)]), H::patch($a, ['style.fill' => '#000000'])]);
        $this->assertSame(['limit', 'ok'], $res);
        $this->assertArrayNotHasKey('more', $this->h->store->live(1, $a)['data']);
        $this->assertBytesInvariant('after a refused patch');

        // remove frees bytes, also for a put later in the same batch.
        [, $res] = $this->h->apply([H::remove($b), H::put($c, self::note(400))]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertBytesInvariant('after remove + put');

        // The budget is lowered below the board: shrinking and neutral ops pass, growing ones do not.
        $this->h->app['max_board_bytes'] = 100;
        $this->assertSame(['ok'], $this->h->apply([H::patch($a, ['data.text' => 'short'])])[1], 'a shrinking patch on an over-budget board');
        $this->assertSame(['ok'], $this->h->apply([H::patch($a, ['x' => 1, 'y' => 2, 'parent' => null])])[1], 'placement does not count');
        $this->assertSame(['limit'], $this->h->apply([H::patch($a, ['data.text' => 'longer'])])[1], 'a growing patch on an over-budget board');
        $this->assertSame(['limit'], $this->h->apply([H::put(self::id(9), H::sticky(['data' => []]))])[1], 'every put grows');
        $this->assertBytesInvariant('over budget');

        // put + revive counts against the budget, also right after its own remove.
        [, $res] = $this->h->apply([H::remove($c), H::put($c, self::note(400), 'sticky', true)]);
        $this->assertSame(['ok', 'limit'], $res);
        $this->assertNull($this->h->store->live(1, $c));
        $this->h->app['max_board_bytes'] = 100000;
        $this->assertSame(['ok'], $this->h->apply([H::put($c, self::note(400), 'sticky', true)])[1]);
        $this->assertBytesInvariant('after revive');
        $this->assertSame($this->h->store->liveBytes(1), $this->h->store->boards[1]['item_bytes']);
    }

    public function testItemBytesFollowTheStoredStrings(): void {
        // T1: item_bytes moves by what is really written, also for no-op
        // patches whose working copy differs from the stored text (1 vs 1.0).
        $a = self::id(1);
        $f = self::id(2);
        $this->h->apply([H::put($a, H::sticky(['data' => ['text' => 'a', 'v' => 1.0]])), H::put($f, H::frame(), 'frame')]);
        $this->assertBytesInvariant('after put');
        for ($k = 0; $k < 3; $k++) {
            $this->h->apply([H::patch($a, ['data.v' => 1])]);
        }
        $this->assertBytesInvariant('no drift from no-op patches');
        $this->h->apply([H::patch($a, ['data.text' => 'ab', 'style.fill' => '#000000', 'style.extra' => 'e']), H::patch($f, ['data.title' => 'Frame title'])]);
        $this->assertBytesInvariant('after patches');
        $this->h->apply([H::put(self::id(3), H::sticky(['x' => 1, 'y' => 2, 'parent' => $f])), H::remove($f)]);
        $this->assertBytesInvariant('after a frame removal with a released child');
        $this->h->apply([H::remove($a), H::put($a, H::sticky(['data' => ['text' => 'revived and longer']]), 'sticky', true)]);
        $this->assertBytesInvariant('after remove + revive');
    }

    public function testLeaseIsReadAgainUnderTheLock(): void {
        // T7: sync() read presence before the lock; B took over and committed
        // since. Under the lock the write path reads it again.
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky())]);
        $alice = H::user('alice');
        $bob = H::user('bob', Role::Edit);
        $aliceHolds = [$alice->pid . ':c1' => ['k' => $alice->pid, 'e' => $n, 't' => $this->h->now, 'es' => $this->h->now]];
        $bobTookOver = $aliceHolds + [$bob->pid . ':c2' => ['k' => $bob->pid, 'e' => $n, 't' => $this->h->now, 'es' => $this->h->now - 1]];
        $this->h->presence->readMap = $bobTookOver;
        $this->h->presence->reads = [];
        [, $res] = $this->h->apply([H::patch($n, ['data.text' => 'A-late']), H::patch($n, ['style.fill' => '#000000']), H::patch($n, ['data.text' => 'A2'])], $alice, $aliceHolds);
        $this->assertSame(['locked', 'ok', 'locked'], $res, 'stale map says alice, the map under the lock says bob');
        $this->assertSame([$this->h->now], $this->h->presence->reads, 'read once per batch');
        $this->assertSame('', $this->h->store->live(1, $n)['data']['text']);

        $this->h->presence->readMap = $aliceHolds;
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'A'])], $alice, $aliceHolds)[1], 'read() names alice → ok');

        $this->h->presence->reads = [];
        $this->h->presence->readMap = $bobTookOver;
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'X'])], $alice, null)[1], 'presence null (no Redis) → plain LWW');
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['style.fill' => '#111111'])], $alice, $aliceHolds)[1]);
        $this->assertSame([], $this->h->presence->reads, 'never read without presence or without a text patch');

        $this->h->sync->clock = $this->h->now + 20000;
        $this->h->presence->readMap = null;
        $this->h->apply([H::patch($n, ['data.text' => 'Y'])], $alice, $aliceHolds);
        $this->assertSame([$this->h->now + 20000], $this->h->presence->reads, 'read with the current time, not the request start');
    }

    public function testFrameRemovalWritesReleasedChildrenInOneBatch(): void {
        // T8: children loaded without data/style, written with releaseMany;
        // a child the batch also patches keeps one merged change row.
        $f = self::id(1);
        $ops = [H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame')];
        for ($i = 2; $i <= 6; $i++) {
            $ops[] = H::put(self::id($i), H::sticky(['x' => $i, 'y' => 10 * $i, 'parent' => $f, 'data' => ['text' => "c$i"]]));
        }
        $this->h->apply($ops);
        $bytes = $this->h->store->boards[1]['item_bytes'];
        $frameBytes = $this->h->store->storedBytes(1, $f);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::patch(self::id(2), ['data.text' => 'merged']), H::remove($f)]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('releaseMany 4', $this->h->log, 'four children only released: one batch');
        $this->assertNotSame(-1, $this->h->pos('updateItem ' . self::id(2)), 'the patched child: own row');
        for ($i = 2; $i <= 6; $i++) {
            $c = $this->h->store->live(1, self::id($i));
            $this->assertSame([null, 1000.0 + $i, 500.0 + 10 * $i], [$c['parent'], $c['x'], $c['y']]);
            $this->assertSame($i === 2 ? 'merged' : "c$i", $c['data']['text'], 'data untouched by the release');
            $rows = array_values(array_filter($this->h->store->changesOf(self::id($i)), static fn ($ch) => $ch['rev'] === $rev));
            $this->assertCount(1, $rows);
            $this->assertSame($i === 2 ? ['data.text', 'x', 'y', 'parent'] : ['x', 'y', 'parent'], array_keys(json_decode($rows[0]['patch'], true)));
        }
        $this->assertSame('{"x":1003.0,"y":530.0,"parent":null}', array_values(array_filter($this->h->store->changesOf(self::id(3)), static fn ($ch) => $ch['rev'] === $rev))[0]['patch']);
        $this->assertSame($bytes - $frameBytes + strlen('merged') - strlen('c2'), $this->h->store->boards[1]['item_bytes'], 'only the frame and the patched text count');
        $this->assertSame(5, $this->h->store->boards[1]['item_count']);
        $this->assertBytesInvariant();
    }

    public function testReviveCannotChangeTheType(): void {
        // T9: a frame removed and revived as a sticky would keep its children.
        $f = self::id(1);
        $s1 = self::id(2);
        $s2 = self::id(3);
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($s1, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f])), H::put($s2, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f]))]);
        [, $res] = $this->h->apply([H::remove($f), H::put($f, H::sticky(), 'sticky', true)]);
        $this->assertSame(['ok', 'bad'], $res);
        $this->assertNull($this->h->store->live(1, $f));
        $this->assertSame(['frame', 1], [$this->h->store->items[1][$f]['type'], $this->h->store->items[1][$f]['deleted']], 'F is a frame tombstone');
        $this->assertSame([null, 1010.0, 520.0], [$this->h->store->live(1, $s1)['parent'], $this->h->store->live(1, $s1)['x'], $this->h->store->live(1, $s1)['y']], 'children released');
        $this->assertSame([null, 1030.0, 540.0], [$this->h->store->live(1, $s2)['parent'], $this->h->store->live(1, $s2)['x'], $this->h->store->live(1, $s2)['y']]);

        $g = self::id(4);
        $c = self::id(5);
        $this->h->apply([H::put($g, H::frame(), 'frame'), H::put($c, H::sticky(['parent' => $g]))]);
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::remove($g), H::put($g, H::frame(), 'frame', true)])[1]);
        $this->assertSame($g, $this->h->store->live(1, $c)['parent'], 'same type: the children stay');

        $t = self::id(6);
        $this->h->apply([H::put($t, H::sticky())]);
        $this->h->apply([H::remove($t)]);
        $this->assertSame(['bad'], $this->h->apply([H::put($t, H::frame(), 'frame', true)])[1], 'a sticky tombstone revived as a frame');
        $this->assertSame(['ok'], $this->h->apply([H::put($t, H::sticky(), 'sticky', true)])[1]);

        // An id created and removed in the same batch keeps its type, too.
        $h = self::id(7);
        $k = self::id(8);
        [, $res] = $this->h->apply([H::put($h, H::frame(['x' => 5, 'y' => 6]), 'frame'), H::put($k, H::sticky(['x' => 1, 'y' => 2, 'parent' => $h])), H::remove($h), H::put($h, H::sticky())]);
        $this->assertSame(['ok', 'ok', 'ok', 'bad'], $res);
        $this->assertSame([null, 6.0, 8.0], [$this->h->store->live(1, $k)['parent'], $this->h->store->live(1, $k)['x'], $this->h->store->live(1, $k)['y']]);
    }

    public function testPatchedStateStaysPuttable(): void {
        // T10: patches may not build a stored state that put (undo of delete) refuses.
        $id = self::id(1);
        $this->h->apply([H::put($id, H::sticky())]);
        $keys = static fn (int $from, int $to): array => array_combine(array_map(static fn ($k) => "data.k$k", range($from, $to)), array_fill(0, $to - $from + 1, 1));
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::patch($id, $keys(0, 49)), H::patch($id, $keys(50, 98))])[1], '100 root keys (text + 99)');
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['data.k99' => 1])])[1], 'a 101st data root key');
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['data.k0' => null, 'data.k99' => 1])])[1], 'delete one, add one');
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['style.w.x.y.z' => ['a' => ['b' => ['c' => ['d' => ['e' => ['f' => 1]]]]]]])])[1], 'style.w.x.y.z with a 6-level value');
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['style.w.x' => ['a' => ['b' => ['c' => ['d' => ['e' => ['f' => 1]]]]]]])])[1], 'style.w.x with a 6-level value (7 levels)');
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['style.w.x' => ['a' => ['b' => ['c' => ['d' => 1]]]]])])[1], 'style.w.x with a 4-level value');
        $many = [];
        for ($k = 0; $k < 50; $k++) {
            $many["style.m.k$k"] = 1;
        }
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::patch($id, $many), H::patch($id, array_combine(array_map(static fn ($k) => "style.m.j$k", range(0, 49)), array_fill(0, 50, 1)))])[1], '100 keys in a nested object');
        $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['style.m.x' => 1])])[1], '101 keys in a nested object');
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['x' => 5, 'y' => 6, 'parent' => null])])[1]);

        // The stored state re-puts with revive.
        $item = $this->h->store->live(1, $id);
        $p = $item;
        unset($p['id'], $p['t']);
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::remove($id), H::put($id, $p, 'sticky', true)])[1], 'undo of delete works');
        $this->assertSame($item, $this->h->store->live(1, $id));
    }
    public function testAuthorizeHookRunsUnderTheLock(): void {
        $h = $this->h;
        $ref = new \ReflectionMethod(\OCA\Knorke\Service\SyncService::class, 'authorize');
        $this->assertTrue($ref->isProtected());
        $this->assertSame(['p', 'op', 'cur', 'row'], array_map(static fn (\ReflectionParameter $x): string => $x->getName(), $ref->getParameters()), 'SPEC-M1 §9.7: authorize($p, $op, $cur, $row)');
        $this->assertNull($ref->invoke($h->sync, H::user(), ['o' => 'remove', 'id' => self::id(1)], null, null));
        $refHook = new \ReflectionMethod(\OCA\Knorke\Service\SyncService::class, 'authorizeRef');
        $this->assertTrue($refHook->isProtected());
        $this->assertSame(['p', 'refId', 'refCur'], array_map(static fn (\ReflectionParameter $x): string => $x->getName(), $refHook->getParameters()));
        $this->assertTrue($refHook->invoke($h->sync, H::user(), self::id(1), null), 'M1: always true');
    }

    // ---- Stage 1 (SPEC-M1 §4.7 rules 12–15, 18, 19; §4.13.2) ---------------

    /** Decoded data of a stored item row (also of a tombstone). */
    private function data(string $id): array {
        return json_decode((string)$this->h->store->items[1][$id]['data'], true);
    }

    /** The change rows of $id at $rev. */
    private function rowsAt(string $id, int $rev): array {
        return array_values(array_filter($this->h->store->changesOf($id), static fn (array $c): bool => $c['rev'] === $rev));
    }

    /** [start_item, end_item] of a stored row (derived columns, §3.4). */
    private function ends(string $id): array {
        $r = $this->h->store->items[1][$id];
        return [$r['start_item'], $r['end_item']];
    }

    public function testShapesAndTextFollowTheirRules(): void {
        // C53/C54: every shape kind, the enum and int rules, text with its h.
        $ops = [];
        foreach (['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight'] as $i => $kind) {
            $ops[] = H::put(self::id(10 + $i), H::shape(['data' => ['kind' => $kind, 'text' => $kind], 'style' => ['dash' => 'dashed', 'align' => 'left', 'valign' => 'bottom', 'fillOpacity' => 0, 'strokeWidth' => 0, 'fontSize' => 8.0, 'textColor' => '#ABCDEF']]), 'shape');
        }
        $this->assertSame(array_fill(0, 6, 'ok'), $this->h->apply($ops)[1]);
        $this->assertSame(['kind' => 'ellipse', 'text' => 'ellipse'], $this->h->store->live(1, self::id(12))['data']);
        $this->assertSame(['dash' => 'dashed', 'align' => 'left', 'valign' => 'bottom', 'fillOpacity' => 0, 'strokeWidth' => 0, 'fontSize' => 8, 'textColor' => '#abcdef'], $this->h->store->live(1, self::id(12))['style']);
        $bad = [
            'kind star' => H::shape(['data' => ['kind' => 'star']]),
            'kind true (strict enum)' => H::shape(['data' => ['kind' => true]]),
            'kind Rect' => H::shape(['data' => ['kind' => 'Rect']]),
            'fillOpacity 101' => H::shape(['style' => ['fillOpacity' => 101]]),
            'strokeWidth 25' => H::shape(['style' => ['strokeWidth' => 25]]),
            'dash wavy' => H::shape(['style' => ['dash' => 'wavy']]),
            'valign center' => H::shape(['style' => ['valign' => 'center']]),
            'w 9' => H::shape(['w' => 9]),
            'h 20001' => H::shape(['h' => 20001]),
            'text fontSize 401' => H::text(['style' => ['fontSize' => 401]]),
            'text w 3' => H::text(['w' => 3]),
            'text align justify' => H::text(['style' => ['align' => 'justify']]),
        ];
        foreach ($bad as $name => $p) {
            $this->assertSame(['bad'], $this->h->apply([H::put(self::id(30), $p, str_starts_with($name, 'text') ? 'text' : 'shape')])[1], $name);
        }
        $f = self::id(40);
        $t = self::id(41);
        $res = $this->h->apply([
            H::put($f, H::frame(), 'frame'),
            H::put(self::id(42), H::shape(['r' => 45, 'parent' => $f]), 'shape'),
            H::put($t, H::text(['style' => ['fontSize' => 400]]), 'text'),
            H::patch($t, ['data.text' => "one\ntwo\nthree", 'h' => 93.6]),
            H::patch(self::id(12), ['data.kind' => 'diamond', 'style.valign' => 'top']),
        ])[1];
        $this->assertSame(['ok', 'ok', 'ok', 'ok', 'ok'], $res, 'rotated shape in a frame, text 400, patch {data.text, h}');
        $this->assertSame([93.6, "one\ntwo\nthree"], [$this->h->store->live(1, $t)['h'], $this->h->store->live(1, $t)['data']['text']]);
        $this->assertSame(['bad'], $this->h->apply([H::patch(self::id(12), ['style.dash' => 'wavy'])])[1]);
        $this->assertSame(['bad'], $this->h->apply([H::patch($t, ['style.fontSize' => 401])])[1]);
        $this->assertBytesInvariant();
    }

    public function testUnknownStoredEnumValueIsKept(): void {
        // Rule 18: a value of a later version stays; other paths are patchable;
        // putting it (revive) is bad, like any unknown value.
        $id = self::id(1);
        $this->h->store->seed(1, $id, ['t' => 'shape', 'w' => 200, 'h' => 120, 'z' => 'i1', 'data' => ['kind' => 'star', 'text' => 'S']], 5);
        $this->assertSame(['ok'], $this->h->apply([H::patch($id, ['style.fill' => '#000000', 'data.text' => 'T'])])[1]);
        $this->assertSame(['kind' => 'star', 'text' => 'T'], $this->h->store->live(1, $id)['data']);
        $item = $this->h->store->live(1, $id);
        unset($item['id'], $item['t']);
        $this->assertSame(['ok', 'bad'], $this->h->apply([H::remove($id), H::put($id, $item, 'shape', true)])[1]);
    }

    public function testConnectorPlacementNoneAndRequiredEnds(): void {
        // Rules 12 and 19 (C55): position always 0, parent null, both ends required.
        $a = self::id(1);
        $b = self::id(2);
        $f = self::id(3);
        $this->h->apply([H::put($a, H::sticky()), H::put($b, H::sticky(['x' => 600])), H::put($f, H::frame(), 'frame')]);
        $ends = [['item' => $a], ['item' => $b]];
        foreach (['x 5' => ['x' => 5], 'y -1' => ['y' => -1], 'w 1' => ['w' => 1], 'h 0.5' => ['h' => 0.5], 'r 10' => ['r' => 10], 'parent' => ['parent' => $f]] as $name => $p) {
            $this->assertSame(['bad'], $this->h->apply([H::put(self::id(9), H::connector(...$ends) + $p, 'connector')])[1], "put with $name");
        }
        $noEnd = H::connector(...$ends);
        unset($noEnd['data']['end']);
        $emptyEnd = H::connector($ends[0], []);
        $nullEnd = H::connector($ends[0], ['item' => null]);
        foreach (['without data.end' => $noEnd, 'data.end {}' => $emptyEnd, 'data.end {item: null}' => $nullEnd] as $name => $p) {
            $this->assertSame(['bad'], $this->h->apply([H::put(self::id(9), $p, 'connector')])[1], $name);
        }
        $k = self::id(10);
        $this->assertSame(['ok'], $this->h->apply([H::put($k, H::connector(...$ends) + ['x' => -0.0, 'y' => 0, 'w' => 0.0, 'r' => -0.0], 'connector')])[1]);
        $row = $this->h->store->items[1][$k];
        $this->assertSame(['0.0', '0.0', '0.0', '0.0', '0.0', null], [\OCA\Knorke\Db\ItemStore::num($row['x']), \OCA\Knorke\Db\ItemStore::num($row['y']), \OCA\Knorke\Db\ItemStore::num($row['w']),
            \OCA\Knorke\Db\ItemStore::num($row['h']), \OCA\Knorke\Db\ItemStore::num($row['rotation']), $row['parent_id']], 'stored as +0.0, never -0.0');
        $this->assertSame([$a, $b], $this->ends($k), 'derived columns from the put');
        foreach ([
            'placement group' => ['x' => 0, 'y' => 0, 'parent' => null],
            'w' => ['w' => 0], 'h' => ['h' => 0], 'r 0' => ['r' => 0],
            'data.start null' => ['data.start' => null], 'data.end []' => ['data.end' => []],
            'data.start.item (an end is ONE register)' => ['data.start.item' => $b],
            'data.end.ax' => ['data.end.ax' => 0.5],
            'route zigzag' => ['data.route' => 'zigzag'],
            'endCap star' => ['style.endCap' => 'star'],
            'strokeWidth 0' => ['style.strokeWidth' => 0],
            'label 201' => ['data.label' => str_repeat('l', 201)],
        ] as $name => $p) {
            $this->assertSame(['bad'], $this->h->apply([H::patch($k, $p)])[1], "patch $name");
        }
        $this->assertSame(['ok'], $this->h->apply([H::patch($k, ['z' => 'i9', 'data.label' => 'ja', 'data.route' => 'curved', 'style.startCap' => 'diamond', 'style.endCap' => null], true)])[1], 'keep on a non-container is ignored');
        $item = $this->h->store->live(1, $k);
        $this->assertSame(['i9', ['start' => ['item' => $a], 'end' => ['item' => $b], 'route' => 'curved', 'label' => 'ja'], ['stroke' => '#1a1a1a', 'strokeWidth' => 2, 'startCap' => 'diamond']],
            [$item['z'], $item['data'], $item['style']]);
        $this->assertSame([$a, $b], $this->ends($k), 'unchanged ends keep their columns');
    }

    public function testConnectorEndsAreCheckedUnderTheLock(): void {
        // Rule 14 against the working copies of the batch (C55, C56).
        $s = self::id(1);
        $f = self::id(2);
        $k0 = self::id(3);
        $t = self::id(4);
        $m = self::id(5);
        $this->h->apply([H::put($s, H::sticky()), H::put($f, H::frame(), 'frame'), H::put($t, H::sticky(['x' => 100, 'y' => 40]))]);
        $this->assertSame(['ok'], $this->h->apply([H::put($k0, H::connector(['item' => $s], ['item' => $t]), 'connector')])[1]);
        $this->h->store->seed(1, $m, ['t' => 'mindmap', 'w' => 10, 'h' => 10, 'z' => 'i5'], 9);
        $this->h->apply([H::remove($t)]);
        $n = 20;
        foreach (['a frame' => $f, 'a connector' => $k0, 'a never existing id' => self::id(99), 'an unknown stored type' => $m] as $name => $target) {
            $this->assertSame(['bad'], $this->h->apply([H::put(self::id($n++), H::connector(['item' => $s], ['item' => $target]), 'connector')])[1], "end at $name");
        }
        $self = self::id($n++);
        $this->assertSame(['bad'], $this->h->apply([H::put($self, H::connector(['item' => $self], ['item' => $s]), 'connector')])[1], 'end at itself');
        $this->assertSame(['bad'], $this->h->apply([H::patch($k0, ['data.end' => ['item' => $k0]])])[1], 'patched end at itself');
        $this->assertSame(['bad'], $this->h->apply([H::patch($k0, ['data.end' => ['item' => $f]])])[1], 'patched end at a frame');

        // A tombstone → free point at its anchor (golden formula), ok.
        $k1 = self::id(40);
        $this->assertSame(['ok'], $this->h->apply([H::put($k1, H::connector(['item' => $s, 'ax' => 0.123456, 'ay' => 1], ['item' => $t, 'ax' => 1, 'ay' => 0.5]), 'connector')])[1]);
        $this->assertSame(['start' => ['item' => $s, 'ax' => 0.1235, 'ay' => 1.0], 'end' => ['x' => 300.0, 'y' => 140.0], 'route' => 'straight'], $this->data($k1), 'ax/ay normalized with q(v, 10000); tombstone end = anchor point');
        $this->assertSame([$s, null], $this->ends($k1), 'a free end has no derived item');
        $this->assertSame(['ok'], $this->h->apply([H::patch($k1, ['data.start' => ['item' => $t]])])[1], 'patch to a tombstone: auto anchor = centre');
        $this->assertSame([['x' => 200.0, 'y' => 140.0], [null, null]], [$this->data($k1)['start'], $this->ends($k1)]);

        // Removed earlier in the same batch, and created + removed in it.
        $r = self::id(41);
        $c = self::id(42);
        $k2 = self::id(43);
        $k3 = self::id(44);
        $this->h->apply([H::put($r, H::sticky(['x' => -50, 'y' => -50, 'w' => 100, 'h' => 100]))]);
        [, $res] = $this->h->apply([
            H::remove($r),
            H::put($k2, H::connector(['item' => $r, 'ax' => 0, 'ay' => 0], ['item' => $s]), 'connector'),
            H::put($c, H::sticky(['x' => 1000, 'y' => 0, 'w' => 20, 'h' => 20])),
            H::remove($c),
            H::put($k3, H::connector(['item' => $s], ['item' => $c]), 'connector'),
        ]);
        $this->assertSame(['ok', 'ok', 'ok', 'ok', 'ok'], $res);
        $this->assertSame([['x' => -50.0, 'y' => -50.0], ['item' => $s]], [$this->data($k2)['start'], $this->data($k2)['end']], 'removed in the batch → free point');
        $this->assertSame(['x' => 1010.0, 'y' => 10.0], $this->data($k3)['end'], 'created and removed in the batch → free point');
        $this->assertArrayNotHasKey($c, $this->h->store->items[1]);
        $this->assertSame([[null, $s], [$s, null]], [$this->ends($k2), $this->ends($k3)]);
        $this->assertBytesInvariant();
    }

    public function testEndsAreRegisters(): void {
        // C57: two writers on the two ends both win; the same end: the later one.
        $a = self::id(1);
        $b = self::id(2);
        $c = self::id(3);
        $k = self::id(4);
        $this->h->apply([H::put($a, H::sticky()), H::put($b, H::sticky(['x' => 500])), H::put($c, H::sticky(['x' => 900])), H::put($k, H::connector(['item' => $a], ['item' => $b]), 'connector')]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($k, ['data.start' => ['item' => $c, 'ax' => 0, 'ay' => 0.5]])], H::user('alice'))[1]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($k, ['data.end' => ['x' => 5, 'y' => 6.5]])], H::user('bob', Role::Edit))[1]);
        $this->assertSame([['item' => $c, 'ax' => 0.0, 'ay' => 0.5], ['x' => 5.0, 'y' => 6.5]], [$this->data($k)['start'], $this->data($k)['end']]);
        $this->assertSame([$c, null], $this->ends($k));
        $this->h->apply([H::patch($k, ['data.end' => ['item' => $a]])], H::user('bob', Role::Edit));
        $this->h->apply([H::patch($k, ['data.end' => ['item' => $b]])], H::user('alice'));
        $this->assertSame(['item' => $b], $this->data($k)['end'], 'the later write wins');
        $this->assertSame([$c, $b], $this->ends($k));
    }

    public function testRemoveReleasesBoundConnectorsWithOneChangeRowEach(): void {
        // C56: the ends at a removed item become free points at its anchor,
        // one merged change row per connector, released in one multi-row write.
        $e = self::id(1);
        $o = self::id(2);
        [$k1, $k2, $k3, $k4] = [self::id(3), self::id(4), self::id(5), self::id(6)];
        $this->h->apply([
            H::put($e, H::sticky(['x' => 100, 'y' => 40])), H::put($o, H::sticky(['x' => 1000])),
            H::put($k1, H::connector(['item' => $e, 'ax' => 1, 'ay' => 0.5], ['item' => $o]), 'connector'),
            H::put($k2, H::connector(['item' => $o], ['item' => $e]), 'connector'),
            H::put($k3, H::connector(['item' => $e, 'ax' => 0, 'ay' => 0], ['item' => $e, 'ax' => 1, 'ay' => 1]), 'connector'),
            H::put($k4, H::connector(['item' => $o], ['x' => 1, 'y' => 2]), 'connector'),
        ]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::patch($k2, ['data.label' => 'merged']), H::remove($e)]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('boundConnectors ' . $e, $this->h->log, 'stored connectors through start_item/end_item');
        $this->assertContains('releaseConnectors 2', $this->h->log, 'k1 and k3 in one multi-row write');
        $this->assertNotSame(-1, $this->h->pos('updateItem ' . $k2), 'k2 also has its own patch: one merged row');
        $this->assertSame([['x' => 300.0, 'y' => 140.0], ['item' => $o]], [$this->data($k1)['start'], $this->data($k1)['end']]);
        $this->assertSame(['x' => 200.0, 'y' => 140.0], $this->data($k2)['end'], 'auto end → centre');
        $this->assertSame([['x' => 100.0, 'y' => 40.0], ['x' => 300.0, 'y' => 240.0]], [$this->data($k3)['start'], $this->data($k3)['end']]);
        $this->assertSame([[null, $o], [$o, null], [null, null], [$o, null]], [$this->ends($k1), $this->ends($k2), $this->ends($k3), $this->ends($k4)]);
        foreach ([$k1, $k2, $k3] as $k) {
            $this->assertCount(1, $this->rowsAt($k, $rev), "one change row for $k");
            $this->assertSame($rev, $this->h->store->items[1][$k]['rev']);
        }
        $this->assertSame('{"data.start":{"x":300.0,"y":140.0}}', $this->rowsAt($k1, $rev)[0]['patch']);
        $this->assertSame('{"data.label":"merged","data.end":{"x":200.0,"y":140.0}}', $this->rowsAt($k2, $rev)[0]['patch']);
        $this->assertSame('{"data.start":{"x":100.0,"y":40.0},"data.end":{"x":300.0,"y":240.0}}', $this->rowsAt($k3, $rev)[0]['patch']);
        $this->assertSame([], $this->rowsAt($k4, $rev), 'a connector not bound to it is untouched');
        $this->assertSame(5, $this->h->store->boards[1]['item_count']);
        $this->assertBytesInvariant('released connectors count their real size change');
    }

    public function testReleaseAnchorsAtTheRotatedChildOfAFrame(): void {
        // The anchor needs the container of the gone item; no op touched it,
        // so the write path loads it (golden case "frame parent: rotated 30°").
        $f = self::id(1);
        $e = self::id(2);
        $k = self::id(3);
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => -500]), 'frame'), H::put($e, H::sticky(['x' => 20, 'y' => 30, 'r' => 30, 'parent' => $f])),
            H::put($k, H::connector(['item' => $e, 'ax' => 1, 'ay' => 0], ['x' => 0, 'y' => 0]), 'connector')]);
        $this->h->log = [];
        $this->assertSame(['ok'], $this->h->apply([H::remove($e)])[1]);
        $this->assertContains('loadItems ' . $f, $this->h->log, 'the container, loaded once');
        $this->assertSame(['x' => 1256.6, 'y' => -406.6], $this->data($k)['start']);
        // The same through the op path: an end sent at the tombstone.
        $k2 = self::id(4);
        $this->assertSame(['ok'], $this->h->apply([H::put($k2, H::connector(['x' => 1, 'y' => 1], ['item' => $e, 'ax' => 1, 'ay' => 0]), 'connector')])[1]);
        $this->assertSame(['x' => 1256.6, 'y' => -406.6], $this->data($k2)['end']);
    }

    public function testClientSolutionBeforeTheRemoveLeavesNothingToRelease(): void {
        // §4.7 rule 14: the client frees its ends before the removes (undo
        // re-binds); the server then has nothing to release.
        $e = self::id(1);
        $k = self::id(2);
        $this->h->apply([H::put($e, H::sticky()), H::put(self::id(3), H::sticky(['x' => 800])), H::put($k, H::connector(['item' => $e], ['item' => self::id(3)]), 'connector')]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::patch($k, ['data.start' => ['x' => 210.5, 'y' => 140]]), H::remove($e)]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertNotContains('releaseConnectors 1', $this->h->log);
        $this->assertSame(['x' => 210.5, 'y' => 140.0], $this->data($k)['start'], 'the client\'s point, not the centre');
        $this->assertSame('{"data.start":{"x":210.5,"y":140.0}}', $this->rowsAt($k, $rev)[0]['patch']);
        // Undo: re-bind + revive in one batch → bound again.
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::put($e, H::sticky(), 'sticky', true), H::patch($k, ['data.start' => ['item' => $e]])])[1]);
        $this->assertSame([['item' => $e], [$e, self::id(3)]], [$this->data($k)['start'], $this->ends($k)]);
    }

    public function testConnectorOfTheBatchAndRevivedTargets(): void {
        // A connector created in the batch, bound to an item removed later in
        // it: inserted with the free point (one put row). An item removed and
        // revived in one batch keeps its connectors bound.
        $e = self::id(1);
        $k = self::id(2);
        [$rev, $res] = $this->h->apply([H::put($e, H::sticky(['x' => 0, 'y' => 0, 'w' => 50, 'h' => 50])), H::put($k, H::connector(['item' => $e], ['x' => 9, 'y' => 9]), 'connector'), H::remove($e)]);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        $this->assertSame(['x' => 25.0, 'y' => 25.0], $this->data($k)['start']);
        $this->assertSame([null, null], $this->ends($k));
        $this->assertSame(['put'], array_column($this->rowsAt($k, $rev), 'op'));
        $this->assertBytesInvariant('size of the inserted connector after the release');

        $g = self::id(3);
        $k2 = self::id(4);
        $this->h->apply([H::put($g, H::sticky()), H::put($k2, H::connector(['item' => $g], ['item' => $g, 'ax' => 0, 'ay' => 1]), 'connector')]);
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::remove($g), H::put($g, H::sticky(), 'sticky', true)])[1]);
        $this->assertSame([['item' => $g], [$g, $g]], [$this->data($k2)['start'], $this->ends($k2)], 'end state live: nothing released');
        // A connector removed in the same batch as its target: not released
        // (not live) — its tombstone keeps the bound ends as columns; data and
        // style are '{}' (P7, SPEC-M1 §33.1 c: a tombstone carries no payload).
        [$rev, ] = $this->h->apply([H::remove($k2), H::remove($g)]);
        $this->assertSame([[], [$g, $g]], [$this->data($k2), $this->ends($k2)]);
        $this->assertSame(['{}', '{}'], [$this->h->store->items[1][$k2]['data'], $this->h->store->items[1][$k2]['style']]);
        $this->assertSame(['remove'], array_column($this->rowsAt($k2, $rev), 'op'));
    }

    public function testKeepLeavesTheChildrenWhereTheyAre(): void {
        // Rule 15 (C58): 3 stored children and one moved earlier in the batch;
        // the frame grows to the top left with keep → absolute positions stay.
        $f = self::id(1);
        [$c1, $c2, $c3, $c4] = [self::id(2), self::id(3), self::id(4), self::id(5)];
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'),
            H::put($c1, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f])), H::put($c2, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f])),
            H::put($c3, H::sticky(['x' => 50.5, 'y' => 60.25, 'parent' => $f])), H::put($c4, H::sticky(['x' => 0, 'y' => 0, 'parent' => $f]))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([
            H::patch($c4, ['x' => 70, 'y' => 80, 'parent' => $f, 'data.text' => 'moved']),
            H::patch($f, ['x' => 900, 'y' => 450, 'parent' => null, 'w' => 900, 'h' => 650], true),
        ]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('liveChildren ' . $f, $this->h->log);
        $this->assertContains('shiftChildren 3', $this->h->log, 'the untouched children in one multi-row write');
        $this->assertNotSame(-1, $this->h->pos('updateItem ' . $c4), 'the moved child: one merged row');
        $abs = function (string $id): array {
            $c = $this->h->store->live(1, $id);
            return [$c['parent'], 900 + $c['x'], 450 + $c['y']];
        };
        $this->assertSame([[$f, 1010.0, 520.0], [$f, 1030.0, 540.0], [$f, 1050.5, 560.25], [$f, 1070.0, 580.0]], [$abs($c1), $abs($c2), $abs($c3), $abs($c4)]);
        foreach ([$c1, $c2, $c3, $c4] as $c) {
            $this->assertCount(1, $this->rowsAt($c, $rev), 'one change row per child');
        }
        $this->assertSame('{"x":110.0,"y":70.0,"parent":"' . $f . '"}', $this->rowsAt($c1, $rev)[0]['patch'], 'the whole placement group, parent unchanged');
        $this->assertSame('{"x":170.0,"y":130.0,"parent":"' . $f . '","data.text":"moved"}', $this->rowsAt($c4, $rev)[0]['patch']);
        $this->assertSame('{"x":900.0,"y":450.0,"w":900.0,"h":650.0}', $this->rowsAt($f, $rev)[0]['patch']);
        $this->assertSame(5, $this->h->store->boards[1]['item_count']);
        $this->assertBytesInvariant();

        // Without keep the children move with the frame (M0).
        $this->h->log = [];
        [$rev, ] = $this->h->apply([H::patch($f, ['x' => 800, 'y' => 450, 'parent' => null])]);
        $this->assertSame([], $this->rowsAt($c1, $rev));
        $this->assertSame([$f, 910.0, 520.0], [$this->h->store->live(1, $c1)['parent'], 800 + $this->h->store->live(1, $c1)['x'], 450 + $this->h->store->live(1, $c1)['y']]);
        $this->assertNotContains('liveChildren ' . $f, $this->h->log);
        // keep with a size change only (dx = dy = 0): nothing else moves.
        [$rev, ] = $this->h->apply([H::patch($f, ['w' => 1000], true)]);
        $this->assertSame([], $this->rowsAt($c1, $rev));
    }

    public function testKeepLaterOpsOfTheBatchWin(): void {
        // Rule 15 + LWW in op order: membership patches AFTER the transform
        // (the client's order, §6.5.2) are relative to the new frame position
        // and are kept as sent; a child removed later is not written.
        $f = self::id(1);
        [$c1, $c2, $c3, $c4, $out] = [self::id(2), self::id(3), self::id(4), self::id(5), self::id(6)];
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'),
            H::put($c1, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f])), H::put($c2, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f])),
            H::put($c3, H::sticky(['x' => 50, 'y' => 60, 'parent' => $f])), H::put($c4, H::sticky(['x' => 70, 'y' => 80, 'parent' => $f])),
            H::put($out, H::sticky(['x' => 950, 'y' => 470]))]);
        [$rev, $res] = $this->h->apply([
            H::patch($f, ['x' => 900, 'y' => 450, 'parent' => null, 'w' => 900, 'h' => 650], true),
            H::patch($c1, ['x' => 5, 'y' => 6, 'parent' => $f]),
            H::patch($c2, ['x' => 2000, 'y' => 2100, 'parent' => null]),
            H::patch($out, ['x' => 50, 'y' => 20, 'parent' => $f]),
            H::remove($c4),
        ]);
        $this->assertSame(['ok', 'ok', 'ok', 'ok', 'ok'], $res);
        $pos = fn (string $id): array => [$this->h->store->live(1, $id)['parent'], $this->h->store->live(1, $id)['x'], $this->h->store->live(1, $id)['y']];
        $this->assertSame([$f, 5.0, 6.0], $pos($c1), 'a later placement wins over the shift');
        $this->assertSame([null, 2000.0, 2100.0], $pos($c2), 'moved out after the transform');
        $this->assertSame([$f, 150.0, 110.0], $pos($c3), 'shifted');
        $this->assertSame([$f, 50.0, 20.0], $pos($out), 'adopted after the transform: as sent, not shifted');
        $this->assertNull($this->h->store->live(1, $c4));
        $this->assertSame(['remove'], array_column($this->rowsAt($c4, $rev), 'op'));

        // A frame created in the batch: its batch children are shifted before the insert.
        $g = self::id(7);
        $k = self::id(8);
        $this->assertSame(['ok', 'ok', 'ok'], $this->h->apply([H::put($g, H::frame(['x' => 0, 'y' => 0]), 'frame'), H::put($k, H::sticky(['x' => 10, 'y' => 10, 'parent' => $g])),
            H::patch($g, ['x' => -100, 'y' => 0, 'parent' => null, 'w' => 900], true)])[1]);
        $this->assertSame([$g, 110.0, 10.0], $pos($k));
    }

    public function testKeepThenRemoveReleasesAtTheUnchangedPosition(): void {
        // Shift (rule 15) and release (rule 6) in one batch: the child ends at
        // the root where it was before the batch, with one change row.
        $f = self::id(1);
        $c = self::id(2);
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($c, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f]))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::patch($f, ['x' => 900, 'y' => 450, 'parent' => null, 'w' => 900, 'h' => 650], true), H::remove($f)]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('releaseMany 1', $this->h->log);
        $this->assertSame([null, 1010.0, 520.0], [$this->h->store->live(1, $c)['parent'], $this->h->store->live(1, $c)['x'], $this->h->store->live(1, $c)['y']]);
        $this->assertSame('{"x":1010.0,"y":520.0,"parent":null}', $this->rowsAt($c, $rev)[0]['patch']);
    }

    /** [parent, x, y] of the stored row of $id (null: not live). */
    private function placement(string $id): ?array {
        $c = $this->h->store->live(1, $id);
        return $c === null ? null : [$c['parent'], $c['x'], $c['y']];
    }

    public function testKeepThenReparentWritesTheNewParent(): void {
        // Rule 15 (R9) + rule 2a (finding K3/C58-QK): a child shifted by the
        // keep patch of its frame and moved into ANOTHER frame by a later op
        // of the same batch is stored with the new parent — the stored row
        // equals its one change row — and removing the new frame releases it.
        $f = self::id(1);
        $f2 = self::id(2);
        [$k, $c, $k2] = [self::id(3), self::id(4), self::id(5)];
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($f2, H::frame(['x' => 14000, 'y' => 100]), 'frame'),
            H::put($k, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f])), H::put($c, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f])),
            H::put($k2, H::sticky(['x' => 70, 'y' => 80, 'parent' => $f]))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([
            H::patch($f, ['x' => 900, 'y' => 450, 'parent' => null, 'w' => 900, 'h' => 650], true),
            H::patch($k, ['x' => 50, 'y' => 60, 'parent' => $f2]),
            // Back at its old relative position, only the parent differs.
            H::patch($k2, ['x' => 70, 'y' => 80, 'parent' => $f2]),
        ]);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        $this->assertSame([$f2, 50.0, 60.0], $this->placement($k), 'the later op wins: new frame, values as sent');
        $this->assertSame([$f2, 70.0, 80.0], $this->placement($k2), 'parent-only effect: new frame');
        $this->assertSame([$f, 130.0, 90.0], $this->placement($c), 'the untouched child is shifted');
        $this->assertContains('shiftChildren 1', $this->h->log, 'only the untouched child in the multi-row write');
        $this->assertContains('updateItem ' . $k . ' x,y,parent_id', $this->h->log, 're-parented: written with parent_id');
        $this->assertContains('updateItem ' . $k2 . ' parent_id', $this->h->log);
        $this->assertSame(['{"x":50.0,"y":60.0,"parent":"' . $f2 . '"}'], array_column($this->rowsAt($k, $rev), 'patch'), 'one change row = the stored row');
        $this->assertSame(['{"parent":"' . $f2 . '"}'], array_column($this->rowsAt($k2, $rev), 'patch'), 'unchanged x/y dropped (no-op paths)');
        $this->assertSame(['{"x":130.0,"y":90.0,"parent":"' . $f . '"}'], array_column($this->rowsAt($c, $rev), 'patch'));
        $this->assertBytesInvariant();

        // Rule 6: removing the new frame releases both to the root.
        [$rev, $res] = $this->h->apply([H::remove($f2)]);
        $this->assertSame(['ok'], $res);
        $this->assertSame([null, 14050.0, 160.0], $this->placement($k));
        $this->assertSame([null, 14070.0, 180.0], $this->placement($k2));
        $this->assertSame(['{"x":14050.0,"y":160.0,"parent":null}'], array_column($this->rowsAt($k, $rev), 'patch'));
        $this->assertSame([$f, 130.0, 90.0], $this->placement($c), 'the old frame keeps its child');
        $this->assertSame([], $this->rowsAt($c, $rev));
        $this->assertBytesInvariant();
    }

    public function testKeepAfterAdoptionWritesTheNewParent(): void {
        // Rule 15 (R9): a child that joined C (or moved from another frame
        // into C) EARLIER in the batch is a child at the time of the keep op
        // and is shifted; its stored row carries the new parent, too.
        $f = self::id(1);
        $f2 = self::id(2);
        [$a, $m] = [self::id(3), self::id(4)];
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($f2, H::frame(['x' => 14000, 'y' => 0]), 'frame'),
            H::put($a, H::sticky(['x' => 5000, 'y' => 5000])), H::put($m, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f2]))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([
            H::patch($a, ['x' => 10, 'y' => 20, 'parent' => $f]),
            H::patch($m, ['x' => 30, 'y' => 40, 'parent' => $f]),
            H::patch($f, ['x' => 900, 'y' => 450, 'parent' => null, 'w' => 900, 'h' => 650], true),
        ]);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        $this->assertSame([$f, 110.0, 70.0], $this->placement($a), 'adopted from the root, then shifted');
        $this->assertSame([$f, 130.0, 90.0], $this->placement($m), 'moved over from F2, then shifted');
        $this->assertSame(['{"x":110.0,"y":70.0,"parent":"' . $f . '"}'], array_column($this->rowsAt($a, $rev), 'patch'));
        $this->assertSame(['{"x":130.0,"y":90.0,"parent":"' . $f . '"}'], array_column($this->rowsAt($m, $rev), 'patch'));
        $this->assertNotContains('shiftChildren 1', $this->h->log);
        $this->assertBytesInvariant();

        // Rule 6: removing F releases both; removing F2 releases nothing.
        [$rev, ] = $this->h->apply([H::remove($f2)]);
        $this->assertSame([], $this->rowsAt($m, $rev));
        $this->h->apply([H::remove($f)]);
        $this->assertSame([null, 1010.0, 520.0], $this->placement($a));
        $this->assertSame([null, 1030.0, 540.0], $this->placement($m));
    }

    public function testAuthorizeSeesTheWorkingCopy(): void {
        // §4.13.2 step 9 (finding D6): the working copy of an item created
        // earlier in the batch, and the stored row.
        $a = self::id(1);
        $b = self::id(2);
        $this->h->apply([H::put($b, H::sticky(['x' => 7]))]);
        $seen = [];
        $this->h->sync->onAuthorize = function ($p, array $op, ?array $cur, ?array $row) use (&$seen): ?string {
            $seen[] = [$op['o'], $op['id'], $cur['x'] ?? null, $row === null ? null : (float)$row['x']];
            return $op['o'] === 'remove' && $op['id'] === self::id(2) ? 'denied' : null;
        };
        [, $res] = $this->h->apply([H::put($a, H::sticky(['x' => 100])), H::patch($a, ['x' => 5, 'y' => 6, 'parent' => null]), H::patch($b, ['x' => 8, 'y' => 0, 'parent' => null]), H::remove($b), H::remove($a), H::patch($a, ['x' => 1, 'y' => 1, 'parent' => null])]);
        $this->assertSame(['ok', 'ok', 'ok', 'denied', 'ok', 'gone'], $res);
        $this->assertSame([['put', $a, null, null], ['patch', $a, 100.0, null], ['patch', $b, 7.0, 7.0], ['remove', $b, 8.0, 7.0], ['remove', $a, 5.0, null], ['patch', $a, null, null]], $seen);
        $this->assertNotNull($this->h->store->live(1, $b), 'denied: not removed');
    }

    public function testAuthorizeRefGuardsEveryReference(): void {
        // §4.13.2 step 9 (R2): parent, connector ends and the server-side
        // release ask authorizeRef; false → denied, a release keeps the end.
        $f = self::id(1);
        $s = self::id(2);
        $blocked = self::id(3);
        $k = self::id(4);
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($s, H::sticky()), H::put($blocked, H::sticky(['x' => 700])),
            H::put($k, H::connector(['item' => $s], ['item' => $blocked]), 'connector')]);
        $refs = [];
        $this->h->sync->onAuthorizeRef = function ($p, string $id, ?array $cur) use (&$refs, $blocked): bool {
            $refs[] = [$id, $cur['t'] ?? null];
            return $id !== $blocked;
        };
        $this->assertSame(['ok'], $this->h->apply([H::put(self::id(5), H::sticky(['parent' => $f]))])[1]);
        $this->assertSame([[$f, 'frame']], $refs, 'parent');
        $refs = [];
        $this->assertSame(['ok'], $this->h->apply([H::put(self::id(6), H::connector(['item' => $s], ['x' => 1, 'y' => 1]), 'connector')])[1]);
        $this->assertSame([[$s, 'sticky']], $refs, 'a bound end; a free end references nothing');
        $this->assertSame(['denied'], $this->h->apply([H::put(self::id(7), H::connector(['item' => $s], ['item' => $blocked]), 'connector')])[1]);
        $this->assertSame(['denied'], $this->h->apply([H::patch(self::id(6), ['data.end' => ['item' => $blocked]])])[1]);
        $this->assertSame(['ok'], $this->h->apply([H::remove($s)])[1]);
        $this->assertSame(['ok'], $this->h->apply([H::remove($blocked)])[1]);
        $this->assertSame([['x' => 200.0, 'y' => 140.0], ['item' => $blocked]], [$this->data($k)['start'], $this->data($k)['end']], 'release asks too: refused → the end stays');
        $this->assertContains([$blocked, null], $refs);
    }

    public function testOnlyBindableRemovalsLookForBoundConnectors(): void {
        // Rule 14 binds only to bindable items: removing a connector or a
        // frame costs no boundConnectors query; a sticky does.
        $f = self::id(1);
        $s = self::id(2);
        $k = self::id(3);
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($s, H::sticky()), H::put($k, H::connector(['item' => $s], ['x' => 1, 'y' => 1]), 'connector')]);
        $this->h->log = [];
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::remove($k), H::remove($f)])[1]);
        $this->assertSame(-1, $this->h->pos('boundConnectors'));
        $this->assertSame(['ok'], $this->h->apply([H::remove($s)])[1]);
        $this->assertNotSame(-1, $this->h->pos('boundConnectors'));
    }

    /**
     * M2 data foundation, followed up by job 026 (AK2): [put A with group G,
     * put B, patch B {group: G}] is ok three times, the answer carries A and
     * B with group G (lock null), the lock columns stay NULL; with an invalid
     * group the same batch is [bad, ok, bad] (result per op): no C, D without
     * a group, its change row without one.
     */
    public function testGroupAndLockOpsAreBadPerOp(): void {
        $a = self::id(1);
        $b = self::id(2);
        $raw = $this->h->syncRaw(['since' => 10, 'seq' => 1, 'pres' => 0, 'ops' => [
            H::put($a, H::sticky(['group' => self::G])),
            H::put($b, H::sticky()),
            H::patch($b, ['group' => self::G]),
        ]]);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['seq' => 1, 'rev' => 11, 'res' => ['ok', 'ok', 'ok']], $d['acks']);
        $this->assertSame([[$a, self::G, null], [$b, self::G, null]], array_map(static fn (array $it): array => [$it['id'], $it['group'], $it['lock']], $d['items']));
        $this->assertStringContainsString(',"style":{"fill":"#a8d8f8"},"group":"' . self::G . '","lock":null}', $raw);
        foreach ([$a, $b] as $id) {
            $row = $this->h->store->items[1][$id];
            $this->assertSame(self::G, $row['group_id']);
            foreach (['locked', 'locked_by', 'locked_name'] as $col) {
                $this->assertNull($row[$col] ?? null, "$col never written");
            }
        }
        [$c, $dd] = [self::id(3), self::id(4)];
        $raw = $this->h->syncRaw(['since' => 11, 'seq' => 2, 'pres' => 0, 'ops' => [
            H::put($c, H::sticky(['group' => strtolower(self::G)], 'i3')),
            H::put($dd, H::sticky([], 'i4')),
            H::patch($dd, ['group' => '']),
        ]]);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['bad', 'ok', 'bad'], $d['acks']['res']);
        $this->assertSame([[$dd, null]], array_map(static fn (array $it): array => [$it['id'], $it['group']], $d['items']), 'D without a group, C never written');
        $this->assertNull($this->h->store->live(1, $c));
        $this->assertNull($this->h->store->items[1][$dd]['group_id']);
        $this->assertStringNotContainsString('group', (string)$this->h->store->changesOf($dd)[0]['patch'], 'the change row has no group');
        // a put with group: null and lock: null is an ordinary put
        $this->assertSame(['ok'], $this->h->apply([H::put(self::id(5), H::sticky(['group' => null, 'lock' => null], 'i5'))])[1]);
    }

    // ---- Job 026: group items (M2, SPEC-M1 §1.2 "(R20) Gruppieren") --------

    private const G = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';
    private const H = '01JF5Q4T0V9W8X7Y6Z5A4B3C2E';

    /** group_id of the stored row of $id (tombstones too). */
    private function groupOf(string $id): ?string {
        return $this->h->store->items[1][$id]['group_id'] ?? null;
    }

    public function testGroupIsWrittenAndRead(): void {
        // AK2: put with a group (sticky, shape) → group_id and the put row; every role reads it;
        // patch {group: H} and {group: null} write group_id and their change rows.
        [$a, $b, $c] = [self::id(1), self::id(2), self::id(3)];
        [$rev, $res] = $this->h->apply([H::put($a, H::sticky(['group' => self::G])), H::put($b, H::shape(['group' => self::G]), 'shape'),
            H::put($c, H::text(['group' => self::G]), 'text')]);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        foreach ([H::user(), H::user('bob', Role::Edit, 'share'), H::guest(), H::user('val', Role::View, 'share')] as $p) {
            $items = $this->snapItems($p);
            $this->assertSame([self::G, self::G, self::G], [$items[$a]['group'], $items[$b]['group'], $items[$c]['group']], 'every role reads the group: ' . $p->id);
        }
        $this->assertStringEndsWith(',"style":{"fill":"#a8d8f8"},"group":"' . self::G . '"}', $this->rowsAt($a, $rev)[0]['patch'], 'the put row carries the group');
        [$rev, $res] = $this->h->apply([H::patch($a, ['group' => self::H])]);
        $this->assertSame(['ok'], $res);
        $this->assertSame(self::H, $this->groupOf($a));
        $this->assertSame('{"group":"' . self::H . '"}', $this->rowsAt($a, $rev)[0]['patch']);
        $this->assertContains('updateItem ' . $a . ' group_id', $this->h->log);
        [$rev, $res] = $this->h->apply([H::patch($a, ['group' => null])]);
        $this->assertSame(['ok'], $res);
        $this->assertNull($this->groupOf($a));
        $this->assertSame('{"group":null}', $this->rowsAt($a, $rev)[0]['patch']);
        $this->assertNull($this->snapItems(H::user())[$a]['group']);
        // beside other paths: its own register
        [$rev, $res] = $this->h->apply([H::patch($a, ['group' => self::G, 'z' => 'i9', 'style.fill' => '#ffffff'])]);
        $this->assertSame(['ok'], $res);
        $this->assertSame('{"group":"' . self::G . '","z":"i9","style.fill":"#ffffff"}', $this->rowsAt($a, $rev)[0]['patch']);
        $this->assertSame(self::G, $this->groupOf($a));
        $this->assertBytesInvariant();
    }

    public function testGroupTypeRulesAndLock(): void {
        // AK2: only sticky, shape and text take a group; null on every type; a locked item is itemlocked.
        [$f, $s, $k, $u, $l] = [self::id(1), self::id(2), self::id(3), self::id(4), self::id(5)];
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($s, H::sticky()), H::put($l, H::sticky([], 'i7'))]);
        $this->h->apply([H::put($k, H::connector(['item' => $s], ['x' => 1, 'y' => 1]), 'connector')]);
        $this->h->store->seed(1, $u, ['t' => 'mindmap', 'w' => 10, 'h' => 10], 5);
        $this->assertSame(['bad', 'bad'], $this->h->apply([H::put(self::id(6), H::frame(['group' => self::G]), 'frame'),
            H::put(self::id(7), H::connector(['item' => $s], ['x' => 1, 'y' => 1], ['group' => self::G]), 'connector')])[1], 'put of a frame or a connector with a group');
        foreach ([$f, $k, $u] as $id) {
            $this->assertSame(['bad'], $this->h->apply([H::patch($id, ['group' => self::G])])[1], 'patch group on ' . $this->h->store->items[1][$id]['type']);
        }
        $this->assertTrue(\OCA\Knorke\Service\ItemRegistry::isGroupable('sticky'));
        $this->assertFalse(\OCA\Knorke\Service\ItemRegistry::isGroupable('frame'));
        $this->assertFalse(\OCA\Knorke\Service\ItemRegistry::isGroupable('mindmap'));
        // group null on a frame: ok, nothing to write (rolled back, no rev jump)
        $rev = $this->h->store->boards[1]['rev'];
        $frame = $this->h->store->items[1][$f];
        $this->assertSame([$rev, ['ok']], $this->h->apply([H::patch($f, ['group' => null])]));
        $this->assertSame($rev, $this->h->store->boards[1]['rev']);
        $this->assertSame($frame, $this->h->store->items[1][$f]);
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::patch($k, ['group' => null]), H::patch($u, ['group' => null])])[1]);
        // a locked item: itemlocked, the row stays
        $this->h->apply([H::patch($l, ['lock' => ['by' => 'x', 'name' => 'y']])], H::user('bob', Role::Edit, 'share'));
        $row = $this->h->store->items[1][$l];
        $this->assertSame(['itemlocked', 'itemlocked'], $this->h->apply([H::patch($l, ['group' => self::G]), H::patch($l, ['group' => null])])[1]);
        $this->assertSame($row, $this->h->store->items[1][$l]);
    }

    public function testReviveWritesThePutsGroupAndBytesStay(): void {
        // AK2: put with revive and group G on a tombstone → group_id G; without a group → NULL,
        // also when the tombstone still carried one; item_bytes is the same before and after grouping.
        [$a, $b] = [self::id(1), self::id(2)];
        $this->h->apply([H::put($a, H::sticky()), H::put($b, H::sticky([], 'i2'))]);
        $bytes = $this->h->store->boards[1]['item_bytes'];
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::patch($a, ['group' => self::G]), H::patch($b, ['group' => self::G])])[1]);
        $this->assertSame($bytes, $this->h->store->boards[1]['item_bytes'], 'grouping costs no bytes');
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::remove($a), H::remove($b)])[1]);
        $this->assertSame([self::G, self::G], [$this->groupOf($a), $this->groupOf($b)], 'the tombstones keep group_id');
        $this->assertSame(['ok'], $this->h->apply([H::put($a, H::sticky(['group' => self::H]), 'sticky', true)])[1]);
        $this->assertSame(self::H, $this->groupOf($a));
        $this->assertSame(['ok'], $this->h->apply([H::put($b, H::sticky([], 'i2'), 'sticky', true)])[1]);
        $this->assertNull($this->groupOf($b), 'a revive without a group writes NULL over the tombstone\'s');
        $this->assertBytesInvariant();
    }

    public function testDissolveWhenOneMemberIsLeft(): void {
        // AK3: G = {A, B, C}; remove A → B, C stay; remove B → C loses G in the same rev, one
        // derived row {"group":null}; only losing groups are counted (groupMembers).
        [$a, $b, $c] = [self::id(1), self::id(2), self::id(3)];
        $this->h->apply([H::put($a, H::sticky(['group' => self::G])), H::put($b, H::sticky(['group' => self::G], 'i2')),
            H::put($c, H::sticky(['group' => self::G], 'i3'))]);
        $this->assertSame(-1, $this->h->pos('groupMembers'), 'a group that only gains members is never counted');
        $this->h->log = [];
        $this->assertSame(['ok'], $this->h->apply([H::remove($a)])[1]);
        $this->assertContains('groupMembers ' . self::G, $this->h->log);
        $this->assertSame([self::G, self::G], [$this->groupOf($b), $this->groupOf($c)]);
        $rev0 = $this->h->store->items[1][$c]['rev'];
        [$rev, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::remove($b)], $this->h->now);
        $this->assertSame(['ok'], $res);
        $this->assertNull($this->groupOf($c));
        $this->assertSame($rev, $this->h->store->items[1][$c]['rev'], 'C in the same rev');
        $this->assertNotSame($rev0, $rev);
        $this->assertSame('{"group":null}', $this->rowsAt($c, $rev)[0]['patch']);
        $this->assertSame(1, $derived, 'one derived row');
        $this->assertNull($this->snapItems(H::user())[$c]['group']);
    }

    public function testDissolveInOneBatchAndNothingWhenAllGo(): void {
        // AK3: [remove A, remove B] dissolves C; [remove A, remove B, remove C] writes no extra row.
        [$a, $b, $c] = [self::id(1), self::id(2), self::id(3)];
        $put = fn (): array => $this->h->apply([H::put($a, H::sticky(['group' => self::G]), 'sticky', true), H::put($b, H::sticky(['group' => self::G], 'i2'), 'sticky', true),
            H::put($c, H::sticky(['group' => self::G], 'i3'), 'sticky', true)]);
        $put();
        [$rev, $res] = $this->h->apply([H::remove($a), H::remove($b)]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertNull($this->groupOf($c));
        $this->assertSame('{"group":null}', $this->rowsAt($c, $rev)[0]['patch']);
        $this->h->apply([H::remove($c)]);
        $put();
        $this->assertSame([self::G, self::G, self::G], [$this->groupOf($a), $this->groupOf($b), $this->groupOf($c)]);
        $before = count($this->h->store->changes);
        [$rev, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::remove($a), H::remove($b), H::remove($c)], $this->h->now);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        $this->assertSame($before + 3, count($this->h->store->changes), 'three remove rows, nothing else');
        $this->assertSame(0, $derived);
    }

    public function testDissolveALockedLastMemberAndAMove(): void {
        // AK3: G = {A, B}, B locked by bob: alice removes A → B loses the group and stays locked;
        // G = {C, D}: patch C {group: H} → D loses G, H = {C} is not counted.
        [$a, $b, $c, $d] = [self::id(1), self::id(2), self::id(3), self::id(4)];
        $this->h->apply([H::put($a, H::sticky(['group' => self::G])), H::put($b, H::sticky(['group' => self::G], 'i2'))]);
        $this->h->apply([H::patch($b, ['lock' => ['by' => 'x', 'name' => 'y']])], H::user('bob', Role::Edit, 'share'));
        [$rev, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::remove($a)], $this->h->now);
        $this->assertSame(['ok'], $res);
        $this->assertNull($this->groupOf($b));
        $this->assertSame([1, 'u:bob', 'Bob'], $this->h->store->lockOf(1, $b), 'B stays locked');
        $this->assertSame('{"group":null}', $this->rowsAt($b, $rev)[0]['patch']);
        $this->assertSame(1, $derived);
        $this->h->apply([H::put($c, H::sticky(['group' => self::G], 'i3')), H::put($d, H::sticky(['group' => self::G], 'i4'))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::patch($c, ['group' => self::H])]);
        $this->assertSame(['ok'], $res);
        $this->assertSame([self::H, null], [$this->groupOf($c), $this->groupOf($d)]);
        $this->assertSame('{"group":null}', $this->rowsAt($d, $rev)[0]['patch']);
        $this->assertSame(['groupMembers ' . self::G], array_values(array_filter($this->h->log, static fn (string $l): bool => str_starts_with($l, 'groupMembers'))), 'H only gains: not counted');
    }

    public function testDissolveAReleasedPartialChild(): void {
        // AK3: G = {A, B} in frame F: [remove F, remove A] → B goes to the root and loses G in ONE
        // change row with placement and group; B came only from liveChildren (no LogicException).
        [$f, $a, $b] = [self::id(1), self::id(2), self::id(3)];
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'),
            H::put($a, H::sticky(['x' => 10, 'y' => 20, 'parent' => $f, 'group' => self::G])),
            H::put($b, H::sticky(['x' => 30, 'y' => 40, 'parent' => $f, 'group' => self::G], 'i2'))]);
        $this->h->log = [];
        [$rev, $res, $derived] = $this->h->sync->applyOpsCounted(H::user(), 1, 'cTest', [H::remove($f), H::remove($a)], $this->h->now);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('liveChildren ' . $f, $this->h->log);
        $this->assertSame([null, 1030.0, 540.0], $this->placement($b));
        $this->assertNull($this->groupOf($b));
        $this->assertSame('{"x":1030.0,"y":540.0,"parent":null,"group":null}', $this->rowsAt($b, $rev)[0]['patch']);
        $this->assertCount(1, $this->rowsAt($b, $rev));
        $this->assertSame(1, $derived);
        $this->assertBytesInvariant();
        // a partial copy is still never written beyond its placement and group
        $ref = new \ReflectionClassConstant(\OCA\Knorke\Service\SyncService::class, 'PARTIAL_PATHS');
        $this->assertSame(['x', 'y', 'parent', 'group'], $ref->getValue());
    }

    public function testDissolveAMemberLoadedOnlyForTheCount(): void {
        // AK3: the last member comes only from groupMembers (a partial row): it writes only
        // group_id; a member that left the group in the same batch is not counted.
        [$a, $b, $c] = [self::id(1), self::id(2), self::id(3)];
        $this->h->apply([H::put($a, H::sticky(['group' => self::G])), H::put($b, H::sticky(['group' => self::G], 'i2')),
            H::put($c, H::sticky(['group' => self::G], 'i3'))]);
        $this->h->log = [];
        [$rev, $res] = $this->h->apply([H::remove($a), H::patch($b, ['group' => self::H])]);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertContains('updateItem ' . $c . ' group_id', $this->h->log, 'C writes group_id only');
        $this->assertSame([self::H, null], [$this->groupOf($b), $this->groupOf($c)]);
        $this->assertSame('{"group":null}', $this->rowsAt($c, $rev)[0]['patch']);
    }

    // ---- Job 023: locked items (M2, SPEC-M1 §1.2 "(R20) Sperren") ----------

    /** The lock op as a client sends it (the content is never read). */
    private static function lock(string $id): array {
        return H::patch($id, ['lock' => ['by' => 'not-read', 'name' => 'not read']]);
    }

    private static function unlock(string $id): array {
        return H::patch($id, ['lock' => null]);
    }

    /** owner alice, carol with "Darf moderieren", bob with edit, guest Gina of the edit link. */
    private static function cast(): array {
        return [
            'owner' => H::user('alice'),
            'mod' => H::user('carol', Role::Edit, 'share', true),
            'edit' => H::user('bob', Role::Edit, 'share'),
            'guest' => H::guest('gAbcdefghijk', 'Gina'),
        ];
    }

    /** @return array<string, array> snapshot items of $p by id */
    private function snapItems(Principal $p): array {
        $d = json_decode($this->h->sync->snapshotJson(new AccessResult($p, null, 0), 1, ['id' => 1, 'role' => $p->role->value]), true);
        return array_column($d['items'], null, 'id');
    }

    public function testLockAndUnlockRules(): void {
        // AK2: locking writes the principal (never the value sent); a second
        // lock is a no-op; only the locker, the owner or a moderator unlocks.
        $c = self::cast();
        $x = self::id(1);
        $this->h->apply([H::put($x, H::sticky())]);
        $bob = $c['edit'];
        [$rev, $res] = $this->h->apply([self::lock($x)], $bob);
        $this->assertSame(['ok'], $res);
        $this->assertSame([1, 'u:bob', 'Bob'], $this->h->store->lockOf(1, $x));
        $pid = Access::derivePid(H::SECRET, 1, 'u:bob');
        foreach ([$c['owner'], $c['guest'], H::user('vic', Role::Vote, 'share'), H::user('val', Role::View, 'share')] as $p) {
            $this->assertSame(['by' => $pid, 'name' => 'Bob'], $this->snapItems($p)[$x]['lock'], 'every role sees the lock: ' . $p->id);
        }
        // A second lock (bob again, or alice): ok, nothing written, bob stays.
        foreach ([$bob, $c['owner']] as $p) {
            $this->assertSame([$rev, ['ok']], $this->h->apply([self::lock($x)], $p), 'no-op: acks.rev = the observed rev');
            $this->assertSame([1, 'u:bob', 'Bob'], $this->h->store->lockOf(1, $x));
        }
        // Someone else's lock without the moderation right.
        foreach ([H::user('dan', Role::Edit, 'share'), $c['guest']] as $p) {
            $this->assertSame(['itemlocked'], $this->h->apply([self::unlock($x)], $p)[1], $p->id);
            $this->assertSame([1, 'u:bob', 'Bob'], $this->h->store->lockOf(1, $x));
        }
        // The locker unlocks: all three columns NULL.
        $this->assertSame(['ok'], $this->h->apply([self::unlock($x)], $bob)[1]);
        $this->assertSame([null, null, null], $this->h->store->lockOf(1, $x));
        // Unlocking an unlocked item: ok, nothing written.
        $seen = $this->h->store->boards[1]['rev'];
        $this->assertSame([$seen, ['ok']], $this->h->apply([self::unlock($x)], $c['edit']));
        // The owner and a moderator lift a foreign lock.
        foreach (['owner', 'mod'] as $k) {
            $this->h->apply([self::lock($x)], $bob);
            $this->assertSame(['ok'], $this->h->apply([self::unlock($x)], $c[$k])[1], $k);
            $this->assertSame([null, null, null], $this->h->store->lockOf(1, $x), $k);
        }
        // A guest's own lock.
        $this->assertSame(['ok', 'ok'], $this->h->apply([self::lock($x), self::unlock($x)], $c['guest'])[1]);
        $this->h->apply([self::lock($x)], $c['guest']);
        $this->assertSame([1, 'g:gAbcdefghijk', 'Gina'], $this->h->store->lockOf(1, $x));
        $this->assertSame(['ok'], $this->h->apply([self::unlock($x)], $c['guest'])[1]);
        // A tombstone or an id the board never had: gone.
        $this->h->apply([H::remove($x)]);
        $this->assertSame(['gone', 'gone'], $this->h->apply([self::lock($x), self::unlock($x)], $c['owner'])[1]);
        $this->assertSame(['gone', 'gone'], $this->h->apply([self::lock(self::id(9)), self::unlock(self::id(9))], $c['owner'])[1]);
        // The hook itself (SPEC-M1 §9.7 signature unchanged; a vote op never sees the lock).
        $ref = new \ReflectionMethod(\OCA\Knorke\Service\SyncService::class, 'authorize');
        $locked = ['t' => 'sticky', 'lock' => ['by' => 'u:bob', 'name' => 'Bob']];
        $this->assertNull($ref->invoke($this->h->sync, $c['edit'], ['o' => 'vote', 's' => 1, 'id' => $x, 'n' => 1], $locked, null));
        $this->assertNull($ref->invoke($this->h->sync, $c['edit'], ['o' => 'put', 'id' => $x], $locked, null));
        $this->assertSame('itemlocked', $ref->invoke($this->h->sync, $c['owner'], ['o' => 'remove', 'id' => $x], $locked, null));
    }

    public function testEveryEditOfALockedItemIsItemlocked(): void {
        // AK2: placement, size, rotation, z, style, text (also under a foreign
        // lease: itemlocked, never locked), title, label, a connector end,
        // keep, remove — for the locker, the owner, a moderator and a guest;
        // the row stays as it is (rev, data, style). put is dup.
        $c = self::cast();
        [$n, $s, $f, $k, $a] = [self::id(1), self::id(2), self::id(3), self::id(4), self::id(5)];
        $this->h->apply([H::put($f, H::frame(), 'frame'), H::put($n, H::sticky(['data' => ['text' => 'T']])), H::put($s, H::shape(), 'shape'),
            H::put($a, H::sticky(['x' => 700])), H::put($k, H::connector(['item' => $n], ['item' => $a]), 'connector')]);
        $bob = $c['edit'];
        $this->assertSame(['ok', 'ok', 'ok', 'ok'], $this->h->apply([self::lock($n), self::lock($s), self::lock($f), self::lock($k)], $bob)[1]);
        $bytes = $this->h->store->boards[1]['item_bytes'];
        $ops = [
            [$n, H::patch($n, ['x' => 5, 'y' => 5, 'parent' => null])], [$n, H::patch($n, ['w' => 300])], [$n, H::patch($n, ['h' => 300])],
            [$s, H::patch($s, ['r' => 45])], [$n, H::patch($n, ['z' => 'i9'])], [$n, H::patch($n, ['style.fill' => '#ffffff'])],
            [$n, H::patch($n, ['data.text' => 'X'])], [$f, H::patch($f, ['data.title' => 'New'])],
            [$f, H::patch($f, ['x' => 10, 'y' => 10, 'parent' => null], true)],
            [$k, H::patch($k, ['data.label' => 'L'])], [$k, H::patch($k, ['data.end' => ['x' => 1, 'y' => 2]])],
            [$n, H::remove($n)], [$f, H::remove($f)], [$k, H::remove($k)],
        ];
        foreach ([$bob, $c['owner'], $c['mod'], $c['guest']] as $p) {
            foreach ($ops as [$id, $op]) {
                $before = $this->h->store->items[1][$id];
                $this->assertSame(['itemlocked'], $this->h->apply([$op], $p)[1], $p->id . ' ' . json_encode($op));
                $this->assertSame($before, $this->h->store->items[1][$id]);
            }
        }
        // A fresh text lease of someone else on the locked note: itemlocked, not locked.
        $alice = $c['owner'];
        $map = [$alice->pid . ':c1' => ['k' => $alice->pid, 'e' => $n, 't' => $this->h->now, 'es' => $this->h->now]];
        $this->h->presence->readMap = $map;
        $this->assertSame(['itemlocked'], $this->h->apply([H::patch($n, ['data.text' => 'B'])], $bob, $map)[1]);
        // put with and without revive on a live locked item: dup.
        $this->assertSame(['dup', 'dup'], $this->h->apply([H::put($n, H::sticky()), H::put($n, H::sticky(), 'sticky', true)])[1]);
        $this->assertSame($bytes, $this->h->store->boards[1]['item_bytes']);
        $this->assertSame('T', $this->h->store->live(1, $n)['data']['text']);
    }

    public function testLockOpsInABatchAndTheChangeRow(): void {
        // AK2: the working copy decides (op order); one change row per item
        // and rev with "lock": true / null, never the locker; item_bytes stays.
        $bob = self::cast()['edit'];
        $x = self::id(1);
        $f = self::id(4);
        $this->h->apply([H::put($x, H::sticky()), H::put($f, H::frame(['x' => 0, 'y' => 0]), 'frame')]);
        $bytes = $this->h->store->boards[1]['item_bytes'];
        $move = H::patch($x, ['x' => 10, 'y' => 20, 'parent' => $f]);
        [$rev, $res] = $this->h->apply([$move, self::lock($x)], $bob);
        $this->assertSame(['ok', 'ok'], $res);
        $rows = $this->rowsAt($x, $rev);
        $this->assertCount(1, $rows);
        $this->assertSame('{"x":10.0,"y":20.0,"parent":"' . $f . '","lock":true}', $rows[0]['patch']);
        $this->assertSame('u:bob', $rows[0]['actor']);
        $this->assertSame(['ok', 'itemlocked'], $this->h->apply([self::lock($x), H::patch($x, ['w' => 1])], $bob)[1], 'a lock earlier in the batch counts');
        [$rev, $res] = $this->h->apply([self::unlock($x), H::patch($x, ['w' => 250])], $bob);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertSame('{"lock":null,"w":250.0}', $this->rowsAt($x, $rev)[0]['patch']);
        [$rev, ] = $this->h->apply([self::lock($x)], $bob);
        $this->assertSame('{"lock":true}', $this->rowsAt($x, $rev)[0]['patch']);
        [$rev, ] = $this->h->apply([self::unlock($x)], $bob);
        $this->assertSame('{"lock":null}', $this->rowsAt($x, $rev)[0]['patch']);
        foreach ($this->h->store->changesOf($x) as $ch) {
            $this->assertStringNotContainsString('bob', (string)$ch['patch']);
            $this->assertStringNotContainsString('Bob', (string)$ch['patch']);
        }
        $this->assertSame($bytes, $this->h->store->boards[1]['item_bytes'], 'locking costs no bytes');
        $this->assertBytesInvariant();
        // Created and locked in one batch: the lock reaches the row, the put row ends with "lock":true.
        $y = self::id(2);
        [$rev, $res] = $this->h->apply([H::put($y, H::sticky()), self::lock($y)], $bob);
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertSame([1, 'u:bob', 'Bob'], $this->h->store->lockOf(1, $y));
        $this->assertStringEndsWith(',"lock":true}', $this->rowsAt($y, $rev)[0]['patch']);
        $this->assertSame(['itemlocked'], $this->h->apply([H::remove($y)], $bob)[1]);
        // Locked and unlocked in one batch: nothing written.
        $z = self::id(3);
        $this->h->apply([H::put($z, H::sticky())]);
        $seen = $this->h->store->boards[1]['rev'];
        $this->assertSame([$seen, ['ok', 'ok']], $this->h->apply([self::lock($z), self::unlock($z)], $bob));
    }

    public function testLockerName(): void {
        // AK2: Input::displayName(…, 64), Input::bmp without 4-byte UTF-8, '' → NULL.
        $next = 10;
        $name = function (string $display, bool $fourByte = true) use (&$next): array {
            $this->h->fourByte = $fourByte;
            $id = self::id($next++);
            $this->h->apply([H::put($id, H::sticky())]);
            $p = new Principal('u:bob', Role::Edit, $display, 'bobpid0000000001', false, 'bob', 'share');
            $this->assertSame(['ok'], $this->h->apply([self::lock($id)], $p)[1]);
            $raw = $this->h->sync->snapshotJson(new AccessResult(H::user(), null, 0), 1, ['id' => 1, 'role' => 'owner']);
            $item = array_column(json_decode($raw, true)['items'], null, 'id')[$id];
            return [$this->h->store->lockOf(1, $id)[2], $item['lock']['name']];
        };
        $this->assertSame(['Bob Berg', 'Bob Berg'], $name("  Bob\u{0000}\n  Berg  "));
        $long = str_repeat('abcdefghij', 7);
        $this->assertSame([substr($long, 0, 64), substr($long, 0, 64)], $name($long));
        $this->assertSame(["\u{FFFD}Bob", "\u{FFFD}Bob"], $name('😀Bob', false));
        $this->assertSame(['😀Bob', '😀Bob'], $name('😀Bob', true));
        $this->assertSame([null, null], $name(''));
    }

    public function testWhatStaysFreeAroundLocks(): void {
        // AK3: a locked frame is a parent, a locked item a connector end;
        // derived writes (rules 6, 14, 15) move locked items.
        $bob = self::cast()['edit'];
        [$f, $n, $free, $k] = [self::id(1), self::id(2), self::id(3), self::id(4)];
        $this->h->apply([H::put($f, H::frame(['x' => 1000, 'y' => 500]), 'frame'), H::put($n, H::sticky(['x' => 0, 'y' => 0])),
            H::put($free, H::sticky(['x' => 300, 'y' => 0]))]);
        $this->h->apply([self::lock($f), self::lock($n)], $bob);
        $frame = $this->h->store->items[1][$f];
        $this->assertSame(['ok'], $this->h->apply([H::put(self::id(6), H::sticky(['x' => 10, 'y' => 10, 'parent' => $f]))])[1], 'a note created in the locked frame');
        $this->assertSame(['ok'], $this->h->apply([H::patch($free, ['x' => 20, 'y' => 20, 'parent' => $f])])[1], 'into the locked frame');
        $this->assertSame($f, $this->h->store->live(1, $free)['parent']);
        $this->assertSame(['ok'], $this->h->apply([H::patch($free, ['data.text' => 'edited inside'])])[1]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($free, ['x' => 300, 'y' => 0, 'parent' => null])])[1], 'and out again');
        $this->assertSame($frame, $this->h->store->items[1][$f], 'the frame row is unchanged');
        $this->assertSame(['ok'], $this->h->apply([H::put($k, H::connector(['item' => $n], ['x' => 900, 'y' => 900]), 'connector')])[1], 'a connector bound to the locked note');
        $c2 = self::id(7);
        $this->h->apply([H::put($c2, H::connector(['x' => 0, 'y' => 0], ['x' => 1, 'y' => 1]), 'connector')]);
        $this->assertSame(['ok'], $this->h->apply([H::patch($c2, ['data.end' => ['item' => $n]])])[1], 'an end re-bound to the locked note');

        // Rule 6: a free frame with a locked child is removed → the child goes to the root, stays locked.
        $g2 = self::id(8);
        $kid = self::id(9);
        $this->h->apply([H::put($g2, H::frame(['x' => 2000, 'y' => 100]), 'frame'), H::put($kid, H::sticky(['x' => 30, 'y' => 40, 'parent' => $g2]))]);
        $this->h->apply([self::lock($kid)], $bob);
        $this->assertSame(['ok'], $this->h->apply([H::remove($g2)])[1]);
        $this->assertSame([null, 2030.0, 140.0], $this->placement($kid));
        $this->assertSame(1, $this->h->store->lockOf(1, $kid)[0]);

        // Rule 15: keep on a free frame shifts a locked child (absolute place stays).
        $g3 = self::id(10);
        $kid3 = self::id(11);
        $this->h->apply([H::put($g3, H::frame(['x' => 3000, 'y' => 100]), 'frame'), H::put($kid3, H::sticky(['x' => 30, 'y' => 40, 'parent' => $g3]))]);
        $this->h->apply([self::lock($kid3)], $bob);
        $this->assertSame(['ok'], $this->h->apply([H::patch($g3, ['x' => 2900, 'y' => 50, 'parent' => null], true)])[1]);
        $c = $this->h->store->live(1, $kid3);
        $this->assertSame([$g3, 3030.0, 140.0], [$c['parent'], 2900 + $c['x'], 50 + $c['y']]);
        $this->assertSame(1, $this->h->store->lockOf(1, $kid3)[0]);
        // Without keep the locked child moves with its frame (relative coordinates, its row untouched).
        $row = $this->h->store->items[1][$kid3];
        $this->assertSame(['ok'], $this->h->apply([H::patch($g3, ['x' => 2800, 'y' => 50, 'parent' => null])])[1]);
        $this->assertSame($row, $this->h->store->items[1][$kid3]);

        // Rule 14: the target of a locked connector is removed → its end becomes a free point, the connector stays locked.
        $t = self::id(12);
        $lc = self::id(13);
        $this->h->apply([H::put($t, H::sticky(['x' => 100, 'y' => 1000])), H::put($lc, H::connector(['x' => 0, 'y' => 0], ['item' => $t]), 'connector')]);
        $this->h->apply([self::lock($lc)], $bob);
        $this->assertSame(['ok'], $this->h->apply([H::remove($t)])[1]);
        $end = json_decode((string)$this->h->store->items[1][$lc]['data'], true)['end'];
        $this->assertArrayNotHasKey('item', $end, 'a free point now');
        $this->assertSame(1, $this->h->store->lockOf(1, $lc)[0]);
        $this->assertSame([null, null], $this->ends($lc));
        $this->assertBytesInvariant();
    }

    public function testATombstoneNeverKeepsALock(): void {
        // Job 023 review round 1 (B1): [unlock X, remove X] in one batch
        // leaves no lock in the tombstone, and a revive brings none back
        // (also in one batch with the unlock and the remove); a revive with a
        // lock later in its batch still locks.
        $c = self::cast();
        $dan = H::user('dan', Role::Edit, 'share');
        $x = self::id(1);
        $this->h->apply([H::put($x, H::sticky())]);
        $this->h->apply([self::lock($x)], $c['edit']);
        $this->assertSame(['ok', 'ok'], $this->h->apply([self::unlock($x), H::remove($x)], $c['owner'])[1]);
        $this->assertSame(1, $this->h->store->items[1][$x]['deleted']);
        $this->assertSame([null, null, null], $this->h->store->lockOf(1, $x), 'the tombstone carries no lock');
        $this->assertSame(['ok'], $this->h->apply([H::put($x, H::sticky(), 'sticky', true)], $c['owner'])[1], 'undo of the delete');
        $this->assertSame([null, null, null], $this->h->store->lockOf(1, $x));
        $this->assertNull($this->snapItems($c['owner'])[$x]['lock']);
        $this->assertSame(['ok'], $this->h->apply([H::patch($x, ['w' => 250])], $dan)[1], 'another editor may edit it');
        $y = self::id(2);
        $this->h->apply([H::put($y, H::sticky())]);
        $this->h->apply([self::lock($y)], $c['edit']);
        $this->assertSame(['ok', 'ok', 'ok'], $this->h->apply([self::unlock($y), H::remove($y), H::put($y, H::sticky(), 'sticky', true)], $c['owner'])[1]);
        $this->assertSame([null, null, null], $this->h->store->lockOf(1, $y), 'unlock, remove and revive in one batch: not locked');
        $this->assertSame(['ok'], $this->h->apply([H::patch($y, ['w' => 250])], $dan)[1]);
        $this->h->apply([H::remove($y)]);
        $this->assertSame(['ok', 'ok'], $this->h->apply([H::put($y, H::sticky(), 'sticky', true), self::lock($y)], $c['edit'])[1]);
        $this->assertSame([1, 'u:bob', 'Bob'], $this->h->store->lockOf(1, $y), '[revive, lock] in one batch locks');
    }
}
