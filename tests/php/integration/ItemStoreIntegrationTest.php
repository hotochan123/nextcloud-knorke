<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\Server;

/** ItemStore against the dev stack's database (SPEC-M0 §9.2; PostgreSQL, MariaDB, MySQL or SQLite). */
final class ItemStoreIntegrationTest extends IntegrationCase {
    /**
     * The stored text of the fixtures: with an emoji, except on a database
     * without 4-byte UTF-8 (mysql.utf8mb4 = false), where the validator
     * stores U+FFFD instead (SyncFlowIntegrationTest checks that path) and a
     * raw emoji is refused by the database itself.
     */
    private function text(int $n): string {
        return "item $n 漢" . ($this->db->supports4ByteText() ? '😀' : "\u{FFFD}");
    }

    private function item(int $n, string $t = 'sticky'): array {
        return ['t' => $t, 'x' => $n * 1.5, 'y' => -$n / 3, 'w' => 200.0, 'h' => 200.0, 'r' => 0.0, 'z' => 'i0', 'parent' => null,
            'data' => ['text' => $this->text($n)], 'style' => ['fill' => '#a8d8f8']];
    }

    /** One batch with $n new items, written with the store methods in ONE transaction. */
    private function batch(int $board, int $from, int $n): int {
        $this->db->beginTransaction();
        try {
            $head = $this->items->lockAndBumpRev($board, self::nowMs());
            for ($i = $from; $i < $from + $n; $i++) {
                $this->items->insertItem($board, self::ulid($i), $this->item($i), $head['rev'], 'u:' . $this->uid, self::nowMs());
            }
            $this->items->addItemCount($board, $n);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
        return $head['rev'];
    }

    public function testLockAndBumpRevSerializesWriters(): void {
        // pgsql/mysql: the board ROW is locked; sqlite: the whole database
        // file (one writer at a time) — either way the second writer waits.
        $b = $this->board();
        [$pdo, $timedOut] = self::lockWaitingPdo();
        $table = self::config()->getSystemValueString('dbtableprefix', 'oc_') . 'knorke_boards';

        $this->db->beginTransaction();
        try {
            $head = $this->items->lockAndBumpRev($b, self::nowMs());
            $this->assertSame(1, $head['rev']);
            $t0 = microtime(true);
            try {
                $pdo->exec("UPDATE $table SET rev = rev + 1 WHERE id = $b");
                $this->fail('the second writer must wait for the board row lock');
            } catch (\PDOException $e) {
                $this->assertTrue($timedOut($e), self::dbKind() . ': lock wait timed out, got ' . $e->getCode() . ' ' . $e->getMessage());
                $this->assertGreaterThan(0.9, microtime(true) - $t0);
            }
        } finally {
            $this->db->rollBack();
        }
        $this->assertSame(1, $pdo->exec("UPDATE $table SET rev = rev + 1 WHERE id = $b"), 'free after the rollback');
        $this->assertSame(1, $this->dbRev($b));
        $this->assertNull($this->items->lockAndBumpRev(PHP_INT_MAX >> 1, self::nowMs()), 'no such board');
    }

    public function testItemsSinceOverThreePages(): void {
        $b = $this->board();
        $revs = [];
        for ($k = 0; $k < 6; $k++) {
            $revs[] = $this->batch($b, $k * 200, 200);
        }
        $cursor = 0;
        $pages = [];
        $seen = [];
        do {
            [$rows, $upTo, $more] = $this->items->itemsSince($b, $cursor, $revs[5], 500);
            $pages[] = [count($rows), $upTo, $more];
            foreach ($rows as $r) {
                $seen[(string)$r['id']] = true;
            }
            $cursor = $upTo;
        } while ($more);
        $this->assertSame([[400, $revs[1], true], [400, $revs[3], true], [400, $revs[5], false]], $pages);
        $this->assertCount(1200, $seen);
    }

    public function testOneRevWithTwelveHundredItems(): void {
        $b = $this->board();
        $big = $this->batch($b, 0, 1200);
        $next = $this->batch($b, 5000, 3);
        [$rows, $upTo, $more] = $this->items->itemsSince($b, 0, $next, 500);
        $this->assertSame([1200, $big, true], [count($rows), $upTo, $more], 'the whole rev, cursor = that rev, more');
        [$rows, $upTo, $more] = $this->items->itemsSince($b, $upTo, $next, 500);
        $this->assertSame([3, $next, false], [count($rows), $upTo, $more]);
        $this->assertSame(1203, (int)$this->db->executeQuery('SELECT item_count FROM *PREFIX*knorke_boards WHERE id = ?', [$b])->fetchOne());
    }

    public function testSnapshotReadsRevBeforeItemsAndRoundTripsFloats(): void {
        $b = $this->board();
        $this->batch($b, 0, 5);
        $snap = json_decode($this->sync->snapshotJson(new AccessResult($this->owner($b), null, 0), $b, ['id' => $b, 'title' => 'IT', 'role' => 'owner']), true);
        $this->assertSame($this->dbRev($b), $snap['rev']);
        $this->assertCount(5, $snap['items']);
        $this->assertSame(array_map([self::class, 'ulid'], range(0, 4)), array_column($snap['items'], 'id'), 'ORDER BY id');
        $this->assertSame(4 * 1.5, $snap['items'][4]['x']);
        $this->assertSame(-4 / 3, $snap['items'][4]['y'], 'full float precision through the database (' . self::dbKind() . ')');
        $this->assertSame($this->text(4), $snap['items'][4]['data']['text']);
    }

    public function testItemsSinceSendsNoTombstonePayload(): void {
        // T1: a tombstone only sends its id; its data/style stay in the database.
        $b = $this->board();
        $rev = $this->batch($b, 0, 2);
        $this->items->updateItem($b, self::ulid(0), ['deleted' => 1], $rev + 1, 'u:x', self::nowMs());
        [$rows, $upTo] = $this->items->itemsSince($b, 0, $rev + 1, 500);
        $this->assertSame($rev + 1, $upTo);
        $byId = array_column($rows, null, 'id');
        $this->assertSame([1, null, null], [(int)$byId[self::ulid(0)]['deleted'], $byId[self::ulid(0)]['data'], $byId[self::ulid(0)]['style']]);
        $this->assertSame('{"text":"' . $this->text(1) . '"}', $byId[self::ulid(1)]['data']);
        $this->assertNotNull($this->items->loadItems($b, [self::ulid(0)])[self::ulid(0)]['data'], 'updateItem writes only the given columns (the remove path of SyncService sets data and style to {} itself, P7: ByteLimitsIntegrationTest)');
    }

    public function testUpdateReviveChangesAndPrune(): void {
        $b = $this->board();
        $rev = $this->batch($b, 0, 1);
        $id = self::ulid(0);
        $this->items->updateItem($b, $id, ['x' => 1.25, 'parent_id' => null, 'data' => '{"text":"u"}', 'deleted' => 1], $rev + 1, 'u:x', self::nowMs());
        $rows = $this->items->loadItems($b, [$id, self::ulid(99)]);
        $this->assertSame([$id], array_keys($rows));
        $this->assertSame([1.25, 1, 2], [(float)$rows[$id]['x'], (int)$rows[$id]['deleted'], (int)$rows[$id]['version']]);
        $this->items->reviveItem($b, $id, $this->item(7), $rev + 2, 'u:x', self::nowMs());
        $row = $this->items->loadItems($b, [$id])[$id];
        $this->assertSame([0, 3, $rev + 2, 10.5], [(int)$row['deleted'], (int)$row['version'], (int)$row['rev'], (float)$row['x']]);
        $this->items->insertChange($b, $rev + 2, $id, 'put', '{"t":"sticky"}', 'u:x', 'c1', 1000);
        $this->assertGreaterThanOrEqual(1, $this->items->pruneChanges(2000));
        $this->assertSame([], $this->items->liveChildren($b, [$id]));
    }

    /**
     * M2 data foundation on every database kind: group_id (26 characters),
     * locked, locked_by (also 80 characters) and locked_name (64 characters
     * of the BMP, so they fit under utf8mb3 too) set by SQL come back from
     * snapshotItems and itemsSince as group and lock, lock.by as the pid
     * (Access::pid), never the principal id; an untouched item carries
     * group null and lock null.
     */
    public function testGroupAndLockColumnsOnTheWire(): void {
        $b = $this->board();
        $rev = $this->batch($b, 0, 3);
        $group = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';
        $longBy = 'u:' . str_repeat('k', 78);
        $longName = str_repeat('Ä漢', 32);
        $this->assertSame([26, 80, 64], [strlen($group), strlen($longBy), mb_strlen($longName)]);
        $set = 'UPDATE *PREFIX*knorke_items SET group_id = ?, locked = ?, locked_by = ?, locked_name = ? WHERE board_id = ? AND id = ?';
        $this->db->executeStatement($set, [$group, 1, 'u:' . $this->uid, 'Alice Adler', $b, self::ulid(0)]);
        $this->db->executeStatement($set, [$group, 1, $longBy, $longName, $b, self::ulid(1)]);
        $secret = self::config()->getSystemValueString('secret');
        $pidOf = static fn (string $id): string => Access::derivePid($secret, $b, $id);

        $want = [
            self::ulid(0) => [$group, ['by' => $this->access->pid($b, 'u:' . $this->uid), 'name' => 'Alice Adler']],
            self::ulid(1) => [$group, ['by' => $this->access->pid($b, $longBy), 'name' => $longName]],
            self::ulid(2) => [null, null],
        ];
        $fromSnapshot = [];
        foreach ($this->items->snapshotItems($b, $pidOf) as $json) {
            $this->assertStringNotContainsString('"u:', $json, 'no principal id on the wire');
            $it = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            $fromSnapshot[$it['id']] = [$it['group'], $it['lock']];
        }
        $this->assertSame($want, $fromSnapshot, 'snapshotItems (' . self::dbKind() . ($this->db->supports4ByteText() ? '' : ' utf8mb3') . ')');
        [$rows] = $this->items->itemsSince($b, 0, $rev, 500);
        $fromSince = [];
        foreach ($rows as $row) {
            $it = json_decode(ItemStore::itemJson($row, $pidOf), true, 512, JSON_THROW_ON_ERROR);
            $fromSince[$it['id']] = [$it['group'], $it['lock']];
        }
        ksort($fromSince);
        $this->assertSame($want, $fromSince, 'itemsSince');
        // through SyncService: snapshot (guest join path) and the slow sync path
        $snap = json_decode($this->sync->snapshotJson(new AccessResult($this->guest($b), null, 0), $b, ['id' => $b, 'role' => 'edit'], ['token' => 'a.b', 'exp' => 5]), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($want, array_map(static fn (array $it): array => [$it['group'], $it['lock']], array_column($snap['items'], null, 'id')));
        $r = SyncRequest::fromBody(['proto' => Application::PROTOCOL, 'client' => 'cIt', 'since' => 0, 'ep' => Server::get(Epoch::class)->current()]);
        $raw = $this->sync->sync(new AccessResult($this->guest($b), null, 0), $b, $r, self::nowMs());
        $this->assertStringNotContainsString('"u:', $raw);
        $d = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($want, array_map(static fn (array $it): array => [$it['group'], $it['lock']], array_column($d['items'], null, 'id')), 'slow sync path');
    }
}
