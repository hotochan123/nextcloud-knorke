<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\PrivateWriting;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\SyncHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * Private writing and reveal (factory job 275): the pure rules of
 * PrivateWriting, the covered delivery of snapshot and sync (SyncService),
 * and the write rights of hidden notes (authorize).
 */
final class PrivateWritingTest extends TestCase {
    private const FRAME = '01JA0000000000000000000099';
    private H $h;

    protected function setUp(): void {
        $this->h = new H();
        $this->h->store->addBoard(1, 10);
    }

    private static function id(int $n): string {
        return sprintf('01JA%022d', $n);
    }

    /** meta.private as stored (at = 1000 ms before the harness clock). */
    private function startPrivate(?string $frame = null): void {
        $m = PrivateWriting::startAfter([], $frame, $this->h->now - 1000, 'Alice');
        $this->h->store->metaWrite(1, null, json_encode($m));
    }

    private function reveal(): void {
        $this->h->store->metaWrite(1, null, json_encode(PrivateWriting::revealAfter(json_decode((string)$this->h->store->boards[1]['meta'], true))));
    }

    /** @return array<string, array> items of a decoded answer by id */
    private static function byId(array $answer): array {
        $out = [];
        foreach ($answer['items'] ?? [] as $it) {
            $out[$it['id']] = $it;
        }
        return $out;
    }

    public function testStartAndRevealRules(): void {
        $m = PrivateWriting::startAfter(['x' => 1], null, 500, 'Alice');
        $this->assertSame(['x' => 1, 'private' => ['scope' => 'board', 'at' => 500, 'by' => 'Alice', 'seq' => 1]], $m);
        try {
            PrivateWriting::startAfter($m, null, 600, 'Bob');
            $this->fail('second start');
        } catch (HttpError $e) {
            $this->assertSame([409, 'private_on'], [$e->status, $e->error]);
        }
        $r = PrivateWriting::revealAfter($m);
        $this->assertSame(['x' => 1, 'privateSeq' => 1], $r);
        $this->assertNull(PrivateWriting::revealAfter($r), 'reveal without private writing writes nothing');
        $f = PrivateWriting::startAfter($r, self::FRAME, 700, 'Alice');
        $this->assertSame(['scope' => 'frame', 'frame' => self::FRAME, 'at' => 700, 'by' => 'Alice', 'seq' => 2], $f['private']);
        $this->assertArrayNotHasKey('privateSeq', $f);
        try {
            PrivateWriting::startAfter(['vote' => ['state' => 'open']], null, 1, 'Alice');
            $this->fail('vote open');
        } catch (HttpError $e) {
            $this->assertSame([409, 'vote_open'], [$e->status, $e->error]);
        }
        $this->assertNotNull(PrivateWriting::startAfter(['vote' => ['state' => 'closed']], null, 1, 'Alice')['private']);
    }

    public function testHides(): void {
        $priv = ['scope' => 'board', 'at' => 100, 'by' => 'A', 'seq' => 1];
        $row = ['type' => 'sticky', 'deleted' => 0, 'created_by' => 'u:bob', 'created_at' => 100, 'parent_id' => null];
        $this->assertTrue(PrivateWriting::hides($priv, 'u:alice', $row));
        $this->assertFalse(PrivateWriting::hides($priv, 'u:bob', $row), 'the author');
        $this->assertFalse(PrivateWriting::hides(null, 'u:alice', $row), 'off');
        $this->assertFalse(PrivateWriting::hides($priv, 'u:alice', ['created_at' => 99] + $row), 'before the start');
        $this->assertFalse(PrivateWriting::hides($priv, 'u:alice', ['type' => 'shape'] + $row), 'notes only');
        $this->assertFalse(PrivateWriting::hides($priv, 'u:alice', ['deleted' => 1] + $row), 'tombstone');
        $fr = ['scope' => 'frame', 'frame' => self::FRAME] + $priv;
        $this->assertFalse(PrivateWriting::hides($fr, 'u:alice', $row), 'outside the frame');
        $this->assertTrue(PrivateWriting::hides($fr, 'u:alice', ['parent_id' => self::FRAME] + $row));
        $this->assertTrue(PrivateWriting::hides($priv, 'g:gAAAAAAAAAAA', $row), 'a guest');
    }

    public function testSyncCoversForeignNewNotesOnly(): void {
        $bob = H::user('bob', Role::Edit);
        $this->h->store->seed(1, self::id(1), ['t' => 'sticky', 'data' => ['text' => 'Alt'], '_by' => 'u:bob', '_at' => 5], 11);
        $this->startPrivate();
        $this->assertSame(['ok', 'ok'], $this->h->apply([
            H::put(self::id(2), H::sticky(['data' => ['text' => 'Geheim', 'tags' => []], 'style' => ['fill' => '#ff0000']])),
            H::put(self::id(3), H::shape(['data' => ['kind' => 'rect', 'text' => 'Form']]), 'shape'),
        ], $bob)[1]);

        $raw = $this->h->syncRaw(['since' => 0], H::user());
        $this->assertStringNotContainsString('Geheim', $raw);
        $items = self::byId(json_decode($raw, true));
        $this->assertSame(['covered' => true], $items[self::id(2)]['data']);
        $this->assertSame([], $items[self::id(2)]['style']);
        $this->assertSame([100.0, 40.0, 200.0, 200.0], [$items[self::id(2)]['x'], $items[self::id(2)]['y'], $items[self::id(2)]['w'], $items[self::id(2)]['h']]);
        $this->assertSame('Alt', $items[self::id(1)]['data']['text'], 'a note from before the start');
        $this->assertSame('Form', $items[self::id(3)]['data']['text'], 'only notes are covered');

        $own = self::byId($this->h->syncDecoded(['since' => 0], $bob));
        $this->assertSame('Geheim', $own[self::id(2)]['data']['text'], 'the author sees the text');

        $guest = $this->h->syncRaw(['since' => 0], H::guest());
        $this->assertStringNotContainsString('Geheim', $guest);

        $this->reveal();
        $after = self::byId($this->h->syncDecoded(['since' => 0], H::user()));
        $this->assertSame('Geheim', $after[self::id(2)]['data']['text'], 'after the reveal');
    }

    public function testFrameScope(): void {
        $bob = H::user('bob', Role::Edit);
        $this->h->store->seed(1, self::FRAME, ['t' => 'frame', 'data' => ['title' => 'F']], 11);
        $this->startPrivate(self::FRAME);
        $this->h->apply([H::put(self::id(1), H::sticky(['parent' => self::FRAME, 'x' => 1100, 'y' => 600, 'data' => ['text' => 'Drin']])),
            H::put(self::id(2), H::sticky(['data' => ['text' => 'Draussen']]))], $bob);
        $raw = $this->h->syncRaw(['since' => 0], H::user());
        $this->assertStringNotContainsString('Drin', $raw);
        $items = self::byId(json_decode($raw, true));
        $this->assertSame(['covered' => true], $items[self::id(1)]['data']);
        $this->assertSame(self::FRAME, $items[self::id(1)]['parent']);
        $this->assertSame('Draussen', $items[self::id(2)]['data']['text']);
    }

    public function testSnapshotCoversAndRace(): void {
        $bob = H::user('bob', Role::Edit);
        $this->startPrivate();
        $this->h->apply([H::put(self::id(1), H::sticky(['data' => ['text' => 'Geheim']]))], $bob);
        $rev = $this->h->store->boards[1]['rev'];
        $json = $this->h->sync->snapshotJson(new AccessResult(H::user(), $rev, 0), 1, ['id' => 1, 'role' => 'owner'], null, $this->h->now);
        $this->assertStringNotContainsString('Geheim', $json);
        $d = json_decode($json, true);
        $this->assertSame(['covered' => true], self::byId($d)[self::id(1)]['data']);
        $this->assertSame(1, $d['board']['meta']['private']['seq']);
        $own = json_decode($this->h->sync->snapshotJson(new AccessResult($bob, $rev, 0), 1, ['id' => 1, 'role' => 'edit'], null, $this->h->now), true);
        $this->assertSame('Geheim', self::byId($own)[self::id(1)]['data']['text']);

        // Without private writing: a foreign note above the snapshot rev is covered (written during the stream).
        $h = new H();
        $h->store->addBoard(1, 10);
        $h->apply([H::put(self::id(1), H::sticky(['data' => ['text' => 'Alt']]))], $bob);
        $h->apply([H::put(self::id(2), H::sticky(['data' => ['text' => 'Neu']])), H::put(self::id(3), H::sticky(['data' => ['text' => 'Meins']], 'i2'))], $bob);
        $snap = json_decode($h->sync->snapshotJson(new AccessResult(H::user(), 11, 0), 1, ['id' => 1, 'role' => 'owner'], null, $h->now), true);
        $items = self::byId($snap);
        $this->assertSame('Alt', $items[self::id(1)]['data']['text']);
        $this->assertSame(['covered' => true], $items[self::id(2)]['data']);
        $mine = self::byId(json_decode($h->sync->snapshotJson(new AccessResult($bob, 11, 0), 1, ['id' => 1, 'role' => 'edit'], null, $h->now), true));
        $this->assertSame('Neu', $mine[self::id(2)]['data']['text'], 'own notes never covered');
        // The next sync from the snapshot rev sends it again, uncovered.
        $this->assertSame('Neu', self::byId($h->syncDecoded(['since' => 11], H::user()))[self::id(2)]['data']['text']);
    }

    public function testHiddenNotesAreWritableByTheAuthorOnly(): void {
        $bob = H::user('bob', Role::Edit);
        $alice = H::user();
        $this->h->store->seed(1, self::FRAME, ['t' => 'frame', 'data' => ['title' => 'F']], 11);
        $this->startPrivate(self::FRAME);
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky(['parent' => self::FRAME, 'x' => 1100, 'y' => 600, 'data' => ['text' => 'Geheim']]))], $bob);
        $react = ['o' => 'patch', 'id' => $n, 'p' => ['data.react.p' . $alice->pid => ['e' => '1f44d']]];
        $this->assertSame(['denied', 'denied', 'denied', 'denied'], $this->h->apply([
            H::patch($n, ['data.text' => 'X']), H::patch($n, ['z' => 'i9']), H::patch($n, ['lock' => ['by' => 'x']]), $react,
        ], $alice)[1], 'the owner (a moderator) too');
        $this->assertSame(['denied'], $this->h->apply([H::remove($n)], $alice)[1]);
        $this->assertSame(['denied'], $this->h->apply([H::remove(self::FRAME)], $alice)[1], 'the frame of private writing');
        $this->assertSame('Geheim', json_decode($this->h->store->items[1][$n]['data'], true)['text']);
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'Neu'])], $bob)[1], 'the author');
        // A move of the frame carries its notes along (relative placement): allowed.
        $this->assertSame(['ok'], $this->h->apply([H::patch(self::FRAME, ['x' => 1010, 'y' => 500, 'parent' => null])], $alice)[1]);
        $this->assertSame(1010.0, $this->h->store->live(1, self::FRAME)['x']);
        $this->assertSame(1100.0, $this->h->store->live(1, $n)['x'], 'the note keeps its place in the frame');

        $this->reveal();
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['data.text' => 'Alice'])], $alice)[1], 'after the reveal');
        $this->assertSame(['ok'], $this->h->apply([H::remove(self::FRAME)], $alice)[1]);
    }

    /** Job 286 (AK1, AK2, AK6): others may move and resize a hidden note, nothing else; it stays in the frame. */
    public function testPlacementOfAHiddenNoteIsAllowed(): void {
        $bob = H::user('bob', Role::Edit);
        $alice = H::user();
        $this->h->store->seed(1, self::FRAME, ['t' => 'frame', 'w' => 2000, 'h' => 1000, 'data' => ['title' => 'F']], 11);
        $this->startPrivate(self::FRAME);
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky(['parent' => self::FRAME, 'x' => 100, 'y' => 60, 'data' => ['text' => 'Geheim']]))], $bob);
        $this->assertSame(['ok', 'ok'], $this->h->apply([
            H::patch($n, ['x' => 300, 'y' => 460, 'parent' => self::FRAME]), H::patch($n, ['w' => 240, 'h' => 220]),
        ], $alice)[1]);
        $row = $this->h->store->live(1, $n);
        $this->assertSame([300.0, 460.0, 240.0, 220.0, self::FRAME], [$row['x'], $row['y'], $row['w'], $row['h'], $row['parent']]);
        $this->assertSame('Geheim', $row['data']['text']);
        $this->assertSame('#a8d8f8', $row['style']['fill']);

        $react = ['o' => 'patch', 'id' => $n, 'p' => ['data.react.p' . $alice->pid => ['e' => '1f44d']]];
        $this->assertSame(array_fill(0, 9, 'denied'), $this->h->apply([
            H::patch($n, ['data.text' => 'X']),
            H::patch($n, ['style.fill' => '#ffffff']),
            H::patch($n, ['x' => 310, 'y' => 470, 'parent' => self::FRAME, 'data.text' => 'X']),
            H::patch($n, ['w' => 250, 'style.fill' => '#ffffff']),
            H::patch($n, ['z' => 'i9']),
            H::patch($n, ['lock' => ['by' => 'x']]),
            $react,
            H::remove($n),
            H::patch($n, ['x' => 1300, 'y' => 600, 'parent' => null]),
        ], $alice)[1], 'content, order, lock, reactions, removal and leaving the frame (it would show)');
        $row = $this->h->store->live(1, $n);
        $this->assertSame([300.0, 460.0, 240.0, self::FRAME], [$row['x'], $row['y'], $row['w'], $row['parent']]);
        $this->assertSame('Geheim', $row['data']['text']);

        $rev = $this->h->store->boards[1]['rev'];
        $json = $this->h->sync->snapshotJson(new AccessResult($alice, $rev, 0), 1, ['id' => 1, 'role' => 'owner'], null, $this->h->now);
        $this->assertStringNotContainsString('Geheim', $json);
        $this->assertSame(['covered' => true], self::byId(json_decode($json, true))[$n]['data']);
        $this->assertStringNotContainsString('Geheim', json_encode($this->h->syncDecoded(['since' => 0], $alice)));
    }

    /** Job 286 (AK3, AK4): board scope, a hidden note may leave a frame and come back; a locked one stays locked. */
    public function testHiddenNoteChangesFrameInBoardScope(): void {
        $bob = H::user('bob', Role::Edit);
        $alice = H::user();
        $this->h->store->seed(1, self::FRAME, ['t' => 'frame', 'x' => 1000, 'y' => 500, 'w' => 2000, 'h' => 1000, 'data' => ['title' => 'F']], 11);
        $this->startPrivate();
        $n = self::id(1);
        $m = self::id(2);
        $this->h->apply([
            H::put($n, H::sticky(['parent' => self::FRAME, 'x' => 100, 'y' => 60, 'data' => ['text' => 'Geheim']])),
            H::put($m, H::sticky(['parent' => self::FRAME, 'x' => 400, 'y' => 60, 'data' => ['text' => 'Zu']], 'i2')),
        ], $bob);
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['x' => 1100, 'y' => 560, 'parent' => null])], $alice)[1], 'freed (frame deleted)');
        $this->assertNull($this->h->store->live(1, $n)['parent']);
        $this->assertSame(['ok'], $this->h->apply([H::patch($n, ['x' => 100, 'y' => 60, 'parent' => self::FRAME])], $alice)[1], 'hung back (undo)');
        $this->assertSame(self::FRAME, $this->h->store->live(1, $n)['parent']);

        $this->h->store->seedLock(1, $m, 'bob', 'Bob');
        $this->assertSame(['itemlocked'], $this->h->apply([H::patch($m, ['x' => 410, 'y' => 70, 'parent' => self::FRAME])], $alice)[1]);
        $this->assertSame(400.0, $this->h->store->live(1, $m)['x']);
    }

    /** Job 286 (AK5): a lane swap carries the hidden note into its new band; after the reveal it lies there, undo too. */
    public function testLaneSwapCarriesAHiddenNote(): void {
        $bob = H::user('bob', Role::Edit);
        $alice = H::user();
        $lanes = ['l00000001' => ['o' => 'i0', 'h' => 400, 't' => 'A'], 'l00000002' => ['o' => 'i1', 'h' => 400, 't' => 'B']];
        $this->h->store->seed(1, self::FRAME, ['t' => 'frame', 'w' => 1600, 'h' => 800, 'data' => ['title' => 'F', 'lanes' => $lanes]], 11);
        $this->startPrivate(self::FRAME);
        $n = self::id(1);
        $this->h->apply([H::put($n, H::sticky(['parent' => self::FRAME, 'x' => 200, 'y' => 100, 'data' => ['text' => 'Geheim']]))], $bob);
        $swapped = ['l00000001' => ['o' => 'i1', 'h' => 400, 't' => 'A'], 'l00000002' => ['o' => 'i0', 'h' => 400, 't' => 'B']];
        $do = [H::patch(self::FRAME, ['data.lanes' => $swapped]), H::patch($n, ['x' => 200, 'y' => 500, 'parent' => self::FRAME])];
        $undo = [H::patch(self::FRAME, ['data.lanes' => $lanes]), H::patch($n, ['x' => 200, 'y' => 100, 'parent' => self::FRAME])];
        $this->assertSame(['ok', 'ok'], $this->h->apply($do, $alice)[1]);
        $this->assertSame(['ok', 'ok'], $this->h->apply($undo, $alice)[1], 'undo');
        $this->assertSame(['ok', 'ok'], $this->h->apply($do, $alice)[1], 'redo');

        $this->reveal();
        $it = self::byId($this->h->syncDecoded(['since' => 0], $alice))[$n];
        $this->assertSame('Geheim', $it['data']['text']);
        $this->assertSame(500, (int)$it['y']);
    }

    /** Job 286: the pure rule. */
    public function testPlacementStaysHiddenRule(): void {
        $frame = PrivateWriting::startAfter([], self::FRAME, 500, 'A')['private'];
        $board = PrivateWriting::startAfter([], null, 500, 'A')['private'];
        $row = ['type' => 'sticky', 'created_by' => 'bob', 'created_at' => 600, 'parent_id' => self::FRAME, 'deleted' => 0];
        $this->assertTrue(PrivateWriting::placementStaysHidden($frame, 'alice', $row, ['x' => 1, 'y' => 2, 'parent' => self::FRAME]));
        $this->assertTrue(PrivateWriting::placementStaysHidden($frame, 'alice', $row, ['w' => 220, 'h' => 220]));
        $this->assertFalse(PrivateWriting::placementStaysHidden($frame, 'alice', $row, ['x' => 1, 'y' => 2, 'parent' => null]));
        $this->assertFalse(PrivateWriting::placementStaysHidden($frame, 'alice', $row, ['x' => 1, 'y' => 2, 'parent' => self::id(7)]));
        $this->assertFalse(PrivateWriting::placementStaysHidden($frame, 'alice', $row, ['x' => 1, 'y' => 2, 'parent' => self::FRAME, 'r' => 5]));
        $this->assertFalse(PrivateWriting::placementStaysHidden($frame, 'alice', $row, []));
        $this->assertTrue(PrivateWriting::placementStaysHidden($board, 'alice', $row, ['x' => 1, 'y' => 2, 'parent' => null]));
        $this->assertFalse(PrivateWriting::placementStaysHidden($board, 'bob', $row, ['x' => 1, 'y' => 2, 'parent' => null]), 'not hidden from its author');
    }

    /** Round 2: data.covered is the server's mark; a client never stores it (put, patch, a whole data map). */
    public function testClientsCannotStoreTheCoveredMark(): void {
        $g = H::guest();
        $this->assertSame(['bad'], $this->h->apply([H::put(self::id(1), H::sticky(['data' => ['covered' => true]]))], $g)[1]);
        $this->assertArrayNotHasKey(self::id(1), $this->h->store->items[1]);
        $this->assertSame(['ok'], $this->h->apply([H::put(self::id(2), H::sticky(['data' => ['text' => 'A']]))], $g)[1]);
        $this->assertSame(['bad', 'bad'], $this->h->apply([H::patch(self::id(2), ['data.covered' => true]), H::patch(self::id(2), ['data' => ['covered' => true]])], H::user())[1]);
        $this->assertSame('{"text":"A"}', $this->h->store->items[1][self::id(2)]['data']);
    }
}
