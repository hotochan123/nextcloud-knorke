<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\VoteHarness;
use OCP\DB\IResult;
use OCP\DB\QueryBuilder\IExpressionBuilder;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;

/**
 * ItemStore::itemsSince paging (SPEC-M0 §4.10.2) against canned query
 * results, and the JSON forms of itemJson/obj/num.
 */
final class ItemStoreSqlTest extends TestCase {
    /** @var list<array{0: string, 1: array}> */
    public array $queries = [];

    /** @param list<array> $rows all item rows of the board (any order) */
    private function store(array $rows): ItemStore {
        $test = $this;
        return new class(Fake::of(IDBConnection::class), $rows, $test) extends ItemStore {
            public function __construct(IDBConnection $db, private array $all, private ItemStoreSqlTest $test) {
                parent::__construct($db);
            }

            protected function rows(string $sql, array $params, array $types): array {
                $this->test->queries[] = [$sql, $params];
                $rows = $this->all;
                usort($rows, static fn (array $a, array $b): int => [$a['rev'], $a['id']] <=> [$b['rev'], $b['id']]);
                if (preg_match('/WHERE board_id = \? AND rev > \? AND rev <= \? ORDER BY rev, id LIMIT (\d+)$/', $sql, $m) === 1) {
                    return array_slice(array_values(array_filter($rows, static fn ($r) => $r['rev'] > $params[1] && $r['rev'] <= $params[2])), 0, (int)$m[1]);
                }
                if (preg_match('/WHERE board_id = \? AND rev = \? ORDER BY id$/', $sql) === 1) {
                    return array_values(array_filter($rows, static fn ($r) => $r['rev'] === $params[1]));
                }
                throw new \LogicException($sql);
            }
        };
    }

    /** n rows at rev $rev */
    private static function rev(int $rev, int $n, int $offset = 0): array {
        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $out[] = ['id' => sprintf('01JC%010d%012d', $rev, $offset + $i), 'rev' => $rev];
        }
        return $out;
    }

    public function testFitsInOnePage(): void {
        [$rows, $upTo, $more] = $this->store(array_merge(self::rev(5, 3), self::rev(6, 2)))->itemsSince(1, 4, 9, 500);
        $this->assertSame([5, 9, false], [count($rows), $upTo, $more], 'cursor = upTo, not the last row rev');
        $this->assertSame('SELECT id, type, parent_id, z, x, y, w, h, rotation, CASE WHEN deleted = 0 THEN data END AS data, CASE WHEN deleted = 0 THEN style END AS style, deleted, rev,'
            . ' group_id, locked, locked_by, locked_name'
            . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND rev > ? AND rev <= ? ORDER BY rev, id LIMIT 501', $this->queries[0][0], 'tombstones without payload (T1)');
        $this->assertSame([1, 4, 9], $this->queries[0][1]);
    }

    public function testPageEndsOnARevBoundary(): void {
        $all = array_merge(self::rev(1, 200), self::rev(2, 200), self::rev(3, 200));
        [$rows, $upTo, $more] = $this->store($all)->itemsSince(1, 0, 3, 500);
        $this->assertSame([400, 2, true], [count($rows), $upTo, $more], 'C21: rev 3 is cut → dropped from this page');
        [$rows, $upTo, $more] = $this->store($all)->itemsSince(1, 2, 3, 500);
        $this->assertSame([200, 3, false], [count($rows), $upTo, $more]);
    }

    public function testExactlyLimitRowsIsNotMore(): void {
        [$rows, $upTo, $more] = $this->store(self::rev(1, 500))->itemsSince(1, 0, 1, 500);
        $this->assertSame([500, 1, false], [count($rows), $upTo, $more]);
    }

    public function testOneRevLargerThanThePage(): void {
        $all = array_merge(self::rev(1, 1200), self::rev(2, 3));
        [$rows, $upTo, $more] = $this->store($all)->itemsSince(1, 0, 2, 500);
        $this->assertSame([1200, 1, true], [count($rows), $upTo, $more], 'the whole rev without LIMIT (spike defect §2.8)');
        $this->assertCount(2, $this->queries);
        $this->assertStringEndsWith('AND rev = ? ORDER BY id', $this->queries[1][0]);
        $this->assertSame([1, 1], $this->queries[1][1]);
        [$rows, $upTo, $more] = $this->store(self::rev(1, 1200))->itemsSince(1, 0, 1, 500);
        $this->assertSame([1200, 1, false], [count($rows), $upTo, $more], 'last == upTo → no more');
        [$rows] = $this->store($all)->itemsSince(1, 1, 2, 500);
        $this->assertCount(3, $rows);
    }

    public function testItemJson(): void {
        $row = ['id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 'type' => 'sticky', 'x' => '120', 'y' => '80.5', 'w' => '200', 'h' => '200',
            'rotation' => '0', 'z' => 'i0', 'parent_id' => null, 'data' => '{"text":"Hallo <b>"}', 'style' => '{}'];
        $this->assertSame('{"id":"01JA2B3C4D5E6F7G8H9J0KMNPQ","t":"sticky","x":120.0,"y":80.5,"w":200.0,"h":200.0,"r":0.0,"z":"i0","parent":null,"data":{"text":"Hallo <b>"},"style":{},"group":null,"lock":null}', ItemStore::itemJson($row));
        $row['data'] = null;
        $row['style'] = '[]';
        $row['parent_id'] = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';
        $d = json_decode(ItemStore::itemJson($row), true);
        $this->assertSame('01JF5Q4T0V9W8X7Y6Z5A4B3C2D', $d['parent']);
        $this->assertStringContainsString('"data":{},"style":{}', ItemStore::itemJson($row), 'never []');
    }

    /** M2 data foundation: group and lock after style, for every role; lock.by is the pid, never the principal id. */
    public function testItemJsonGroupAndLock(): void {
        $row = ['id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 'type' => 'sticky', 'x' => '1', 'y' => '2', 'w' => '200', 'h' => '200',
            'rotation' => '0', 'z' => 'i0', 'parent_id' => null, 'data' => '{}', 'style' => '{}',
            'group_id' => null, 'locked' => null, 'locked_by' => null, 'locked_name' => null];
        $tail = static fn (array $r, ?\Closure $pidOf = null): string => substr(ItemStore::itemJson($r, $pidOf), strlen('{"id":"01JA2B3C4D5E6F7G8H9J0KMNPQ","t":"sticky","x":1.0,"y":2.0,"w":200.0,"h":200.0,"r":0.0,"z":"i0","parent":null,"data":{}'));
        $this->assertSame(',"style":{},"group":null,"lock":null}', $tail($row), 'NULL columns');
        $this->assertSame($tail($row), $tail(array_diff_key($row, array_flip(['group_id', 'locked', 'locked_by', 'locked_name']))), 'missing columns = NULL');
        $this->assertSame(',"style":{},"group":null,"lock":null}', $tail(['group_id' => ''] + $row), "'' = no group");
        $this->assertSame(',"style":{},"group":"01JF5Q4T0V9W8X7Y6Z5A4B3C2D","lock":null}', $tail(['group_id' => '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'] + $row));

        $calls = [];
        $pidOf = static function (string $id) use (&$calls): string {
            $calls[] = $id;
            return 'pid-of-' . substr($id, 2);
        };
        $locked = ['locked' => '1', 'locked_by' => 'u:alice', 'locked_name' => 'Alice Adler'] + $row;
        $json = ItemStore::itemJson($locked, $pidOf);
        $this->assertStringEndsWith(',"style":{},"group":null,"lock":{"by":"pid-of-alice","name":"Alice Adler"}}', $json);
        $this->assertStringNotContainsString('u:alice', $json, 'the stored principal id never leaves the server');
        $this->assertSame(['u:alice'], $calls);
        $this->assertStringEndsWith(',"lock":{"by":null,"name":"Alice Adler"}}', ItemStore::itemJson($locked), 'no mapping → by null');
        $this->assertStringEndsWith(',"lock":{"by":null,"name":"Alice Adler"}}', ItemStore::itemJson(['locked_by' => null] + $locked, $pidOf), 'locked_by NULL');
        $this->assertStringEndsWith(',"lock":{"by":null,"name":"Alice Adler"}}', ItemStore::itemJson(['locked_by' => ''] + $locked, $pidOf), "locked_by ''");
        $this->assertStringEndsWith(',"lock":{"by":"pid-of-alice","name":null}}', ItemStore::itemJson(['locked_name' => null] + $locked, $pidOf), 'locked_name NULL');
        $this->assertStringEndsWith(',"lock":{"by":"pid-of-alice","name":null}}', ItemStore::itemJson(['locked_name' => ''] + $locked, $pidOf), "locked_name ''");
        $this->assertStringEndsWith(',"lock":{"by":null,"name":null}}', ItemStore::itemJson(['locked' => 1, 'locked_by' => null, 'locked_name' => null] + $row, $pidOf), 'locked, locker unknown');
        $this->assertStringEndsWith(',"lock":{"by":"pid-of-alice","name":"Ärger 漢字 </b> \"x\""}}', ItemStore::itemJson(['locked_name' => 'Ärger 漢字 </b> "x"'] + $locked, $pidOf), 'unescaped like the title');
        $this->assertStringEndsWith(',"lock":{"by":"pid-of-alice","name":"a' . "\u{FFFD}" . 'b"}}', ItemStore::itemJson(['locked_name' => "a\xC3b"] + $locked, $pidOf), 'invalid UTF-8 → U+FFFD');
        $calls = [];
        foreach ([0, '0', null] as $off) {
            $this->assertStringEndsWith(',"style":{},"group":null,"lock":null}', ItemStore::itemJson(['locked' => $off] + $locked, $pidOf), 'locked ' . var_export($off, true) . ' → lock null, also with locked_by/locked_name set');
        }
        $this->assertSame([], $calls, 'no pid derived for a row that is not locked');
        $d = json_decode(ItemStore::itemJson(['group_id' => '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'] + $locked, $pidOf), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['id', 't', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style', 'group', 'lock'], array_keys($d));
        $this->assertSame(['by', 'name'], array_keys($d['lock']));
    }

    public function testObjAndNum(): void {
        $this->assertSame('{}', ItemStore::obj([]));
        $this->assertSame('{"t":"漢😀</b>","u":"a/b","f":1.0}', ItemStore::obj(['t' => '漢😀</b>', 'u' => 'a/b', 'f' => 1.0]), 'no \u escapes, no HEX_TAG, zero fraction kept');
        $this->assertSame('123.45678901234567', ItemStore::num(123.45678901234567), 'shortest round trip, not 14 digits');
        $this->assertSame('100.0', ItemStore::num(100.0));
        $this->assertSame('-0.5', ItemStore::num(-0.5));
        $this->assertSame(strlen(ItemStore::obj(['text' => str_repeat('😀', 6000)])), 4 * 6000 + strlen('{"text":""}'));
    }

    public function testSnapshotReadsGroupAndLockAndPassesThePidMapping(): void {
        $test = $this;
        $store = new class(Fake::of(IDBConnection::class), $test) extends ItemStore {
            public function __construct(IDBConnection $db, private ItemStoreSqlTest $test) {
                parent::__construct($db);
            }

            protected function each(string $sql, array $params, array $types): \Generator {
                $this->test->queries[] = [$sql, $params];
                yield ['id' => '01JC0000000000000000000001', 'type' => 'sticky', 'x' => 1, 'y' => 2, 'w' => 3, 'h' => 4, 'rotation' => 0, 'z' => 'i0', 'parent_id' => null,
                    'data' => '{}', 'style' => '{}', 'group_id' => '01JF5Q4T0V9W8X7Y6Z5A4B3C2D', 'locked' => 1, 'locked_by' => 'g:gAAAAAAAAAAA', 'locked_name' => 'Gina'];
            }
        };
        $items = iterator_to_array($store->snapshotItems(7, static fn (string $id): string => 'pid:' . $id), false);
        $this->assertStringEndsWith(',"group":"01JF5Q4T0V9W8X7Y6Z5A4B3C2D","lock":{"by":"pid:g:gAAAAAAAAAAA","name":"Gina"}}', $items[0]);
        $this->assertSame('SELECT id, type, parent_id, z, x, y, w, h, rotation, data, style, deleted, rev, group_id, locked, locked_by, locked_name'
            . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0 ORDER BY id', $this->queries[0][0]);
        $this->assertStringEndsWith(',"lock":{"by":null,"name":"Gina"}}', iterator_to_array($store->snapshotItems(7), false)[0], 'without a mapping: by null');
    }

    public function testSnapshotStreamsAndReleaseManyIsChunked(): void {
        // T1: snapshotItems yields one fragment per row while it reads.
        // T8: releaseMany writes 500 children per statement pair; every
        // placeholder has its parameter.
        $test = $this;
        $store = new class(Fake::of(IDBConnection::class), $test) extends ItemStore {
            public array $exec = [];
            public int $pulled = 0;

            public function __construct(IDBConnection $db, private ItemStoreSqlTest $test) {
                parent::__construct($db);
            }

            protected function each(string $sql, array $params, array $types): \Generator {
                $this->test->queries[] = [$sql, $params];
                for ($i = 0; $i < 3; $i++) {
                    $this->pulled++;
                    yield ['id' => sprintf('01JC%022d', $i), 'type' => 'sticky', 'x' => 1, 'y' => 2, 'w' => 3, 'h' => 4, 'rotation' => 0, 'z' => 'i0', 'parent_id' => null, 'data' => '{"text":"t"}', 'style' => '{}'];
                }
            }

            protected function exec(string $sql, array $params, array $types): int {
                $this->exec[] = [$sql, $params, $types];
                return 1;
            }
        };
        $gen = $store->snapshotItems(7);
        $this->assertSame(0, $store->pulled, 'lazy');
        $first = null;
        $pulledAt = [];
        foreach ($gen as $json) {
            $first ??= $json;
            $pulledAt[] = $store->pulled;
        }
        $this->assertSame([1, 2, 3], $pulledAt, 'one row read per fragment handed out');
        $this->assertSame('{"id":"01JC0000000000000000000000","t":"sticky","x":1.0,"y":2.0,"w":3.0,"h":4.0,"r":0.0,"z":"i0","parent":null,"data":{"text":"t"},"style":{},"group":null,"lock":null}', $first);
        $this->assertStringEndsWith('WHERE board_id = ? AND deleted = 0 ORDER BY id', $this->queries[0][0]);

        $moves = [];
        for ($i = 0; $i < 1001; $i++) {
            $moves[] = [sprintf('01JD%022d', $i), 1000.0 + $i, 0.1 + 0.2, '{"x":1.0,"y":2.0,"parent":null}'];
        }
        $store->releaseMany(7, $moves, 12, 'u:alice', 'cTest', 99);
        $this->assertCount(6, $store->exec, '3 chunks × (UPDATE + INSERT)');
        foreach ($store->exec as [$sql, $params, $types]) {
            $this->assertSame(substr_count($sql, '?'), count($params), 'placeholders = parameters');
            $this->assertSame(count($params), count($types));
        }
        [$upd, $params] = $store->exec[0];
        $this->assertStringStartsWith('UPDATE *PREFIX*knorke_items SET x = CASE id WHEN ? THEN ? ', $upd);
        $this->assertStringContainsString(' ELSE x END, y = CASE id WHEN ? THEN ? ', $upd);
        $this->assertStringContainsString(' ELSE y END, parent_id = NULL, version = version + 1, rev = ?, modified_by = ?, modified_at = ? WHERE board_id = ? AND id IN (?', $upd);
        $this->assertSame([sprintf('01JD%022d', 0), '1000.0'], array_slice($params, 0, 2));
        $this->assertSame([sprintf('01JD%022d', 0), '0.30000000000000004'], array_slice($params, 1000, 2), 'y as its shortest round trip');
        $this->assertSame([12, 'u:alice', 99, 7], array_slice($params, 2000, 4));
        $this->assertSame(500, count($params) - 2004);
        [$ins, $params] = $store->exec[1];
        $this->assertSame(500 * 8, count($params));
        $this->assertStringStartsWith('INSERT INTO *PREFIX*knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (', $ins);
        $this->assertSame([7, 12, sprintf('01JD%022d', 0), 'patch', '{"x":1.0,"y":2.0,"parent":null}', 'u:alice', 'cTest', 99], array_slice($params, 0, 8));
        $this->assertSame(1 * 8, count($store->exec[5][1]), 'the last chunk holds the 1001st child');
    }

    /** A store that records every statement of exec(). */
    private static function recorder(): ItemStore {
        return new class(Fake::of(IDBConnection::class)) extends ItemStore {
            public array $exec = [];

            protected function exec(string $sql, array $params, array $types): int {
                $this->exec[] = [$sql, $params, $types];
                return 1;
            }
        };
    }

    public function testShiftChildrenKeepsTheParent(): void {
        // SPEC-M1 §4.7 rule 15: the bulk path of keep — like releaseMany, but parent_id stays.
        $store = self::recorder();
        $moves = [];
        for ($i = 0; $i < 600; $i++) {
            $moves[] = [sprintf('01JE%022d', $i), 10.0 + $i, -0.5, '{"x":1.0,"y":-0.5,"parent":"01JF5Q4T0V9W8X7Y6Z5A4B3C2D"}'];
        }
        $store->shiftChildren(7, $moves, 12, 'u:alice', 'cTest', 99);
        $this->assertCount(4, $store->exec, '2 chunks × (UPDATE + INSERT)');
        foreach ($store->exec as [$sql, $params, $types]) {
            $this->assertSame(substr_count($sql, '?'), count($params));
            $this->assertSame(count($params), count($types));
        }
        [$upd, $params] = $store->exec[0];
        $this->assertStringContainsString(' ELSE y END, version = version + 1, rev = ?', $upd);
        $this->assertStringNotContainsString('parent_id', $upd);
        $this->assertSame([sprintf('01JE%022d', 0), '10.0'], array_slice($params, 0, 2));
        $this->assertSame([7, 12, sprintf('01JE%022d', 0), 'patch', '{"x":1.0,"y":-0.5,"parent":"01JF5Q4T0V9W8X7Y6Z5A4B3C2D"}', 'u:alice', 'cTest', 99], array_slice($store->exec[1][1], 0, 8));
        $this->assertSame(100 * 8, count($store->exec[3][1]));
    }

    public function testReleaseConnectorsWritesDataAndDerivedColumns(): void {
        // SPEC-M1 §4.7 rule 14: released ends in multi-row statements, chunked
        // by rows (200) and by data bytes; NULL derived items typed as NULL.
        $store = self::recorder();
        $rows = [];
        for ($i = 0; $i < 300; $i++) {
            $rows[] = [sprintf('01JE%022d', $i), '{"start":{"x":1.0,"y":2.0},"end":{"item":"01JF5Q4T0V9W8X7Y6Z5A4B3C2D"}}', null, '01JF5Q4T0V9W8X7Y6Z5A4B3C2D', '{"data.start":{"x":1.0,"y":2.0}}'];
        }
        $store->releaseConnectors(7, $rows, 12, 'u:alice', 'cTest', 99);
        $this->assertCount(4, $store->exec, '300 rows → 200 + 100');
        foreach ($store->exec as [$sql, $params, $types]) {
            $this->assertSame(substr_count($sql, '?'), count($params));
            $this->assertSame(count($params), count($types));
        }
        [$upd, $params, $types] = $store->exec[0];
        $this->assertStringStartsWith('UPDATE *PREFIX*knorke_items SET data = CASE id WHEN ? THEN ? ', $upd);
        $this->assertStringContainsString(' ELSE data END, start_item = CASE id WHEN ? THEN ? ', $upd);
        $this->assertStringContainsString(' ELSE start_item END, end_item = CASE id WHEN ? THEN ? ', $upd);
        $this->assertStringContainsString(' ELSE end_item END, version = version + 1, rev = ?, modified_by = ?, modified_at = ? WHERE board_id = ? AND id IN (?', $upd);
        $this->assertSame([sprintf('01JE%022d', 0), null], array_slice($params, 400, 2), 'start_item NULL');
        $this->assertSame([\OCP\DB\QueryBuilder\IQueryBuilder::PARAM_STR, \OCP\DB\QueryBuilder\IQueryBuilder::PARAM_NULL], array_slice($types, 400, 2));
        $this->assertSame([sprintf('01JE%022d', 0), '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'], array_slice($params, 800, 2));
        $this->assertSame(200 * 8, count($store->exec[1][1]));
        $this->assertSame(100 * 8, count($store->exec[3][1]));

        // Big data: cut by bytes (CONNECTOR_CHUNK_BYTES), never one huge statement.
        $store = self::recorder();
        $big = '{"start":{"x":1.0,"y":2.0},"end":{"x":3.0,"y":4.0},"blob":"' . str_repeat('b', 60000) . '"}';
        $store->releaseConnectors(7, array_fill(0, 80, ['01JE0000000000000000000001', $big, null, null, '{}']), 12, 'u:alice', 'cTest', 99);
        $updates = array_values(array_filter($store->exec, static fn (array $e): bool => str_starts_with($e[0], 'UPDATE')));
        $this->assertGreaterThan(1, count($updates));
        foreach ($updates as [, $params]) {
            $this->assertLessThanOrEqual(ItemStore::CONNECTOR_CHUNK_BYTES, count(array_keys($params, $big, true)) * strlen($big), 'data of one statement ≤ the byte cap');
        }
        $this->assertSame(80, array_sum(array_map(static fn (array $u): int => count(array_keys($u[1], $big, true)), $updates)), 'every row written once');
    }

    public function testEndItemsAreDerivedFromConnectorEnds(): void {
        $u = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';
        $this->assertSame([$u, null], ItemStore::endItems(['t' => 'connector', 'data' => ['start' => ['item' => $u, 'ax' => 0.5, 'ay' => 0.0], 'end' => ['x' => 1.0, 'y' => 2.0]]]));
        $this->assertSame([null, $u], ItemStore::endItems(['t' => 'connector', 'data' => ['start' => ['x' => 1.0, 'y' => 2.0], 'end' => ['item' => $u]]]));
        $this->assertSame([null, null], ItemStore::endItems(['t' => 'sticky', 'data' => ['start' => ['item' => $u]]]), 'other types: NULL');
        $this->assertSame([null, null], ItemStore::endItems(['t' => 'connector', 'data' => []]));
    }

    /**
     * Job 023 (AK4) on a real engine (SqliteDb with the production SQL): a
     * lock through /sync writes locked = 1, locked_by and locked_name;
     * lockers() and boardsLockedBy() find the lockers; clearLocker() empties
     * bob's locks board by board (rows and board rev + 1, bumpRev outside
     * the transaction), the others stay; the item stays locked and only a
     * moderator unlocks it.
     */
    public function testLocksOnSqlite(): void {
        $h = new VoteHarness();
        $b1 = $h->sql->addBoard('alice', 'B1', 10);
        $b2 = $h->sql->addBoard('alice', 'B2', 20);
        $b3 = $h->sql->addBoard('alice', 'B3', 30);
        [$a, $b, $c, $d] = [VoteHarness::ulid(1), VoteHarness::ulid(2), VoteHarness::ulid(3), VoteHarness::ulid(4)];
        $h->sql->addItem($b1, $a, 'sticky', null, false, 5);
        $h->sql->addItem($b1, $b, 'sticky', null, false, 6);
        $h->sql->addItem($b2, $c, 'sticky', null, false, 7);
        $h->sql->addItem($b3, $d, 'sticky', null, false, 8);
        $bob = VoteHarness::user('bob', Role::Edit);
        $lock = static fn (string $id): array => ['o' => 'patch', 'id' => $id, 'p' => ['lock' => ['by' => 'x', 'name' => 'y']]];
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 1, 'ops' => [$lock($a)]], $bob, $b1)['acks']['res']);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 2, 'ops' => [$lock($c)]], $bob, $b2)['acks']['res']);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 1, 'ops' => [$lock($b)]], VoteHarness::user('carol', Role::Edit), $b1)['acks']['res']);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 1, 'ops' => [$lock($d)]], VoteHarness::guest('gAbcdefghijk', Role::Edit), $b3)['acks']['res']);
        $row = static fn (int $board, string $id): array => $h->sql->all('SELECT locked, locked_by, locked_name, rev FROM *PREFIX*knorke_items WHERE board_id = ? AND id = ?', [$board, $id])[0];
        $this->assertSame(['locked' => 1, 'locked_by' => 'u:bob', 'locked_name' => 'Bob Adler', 'rev' => 11], $row($b1, $a));
        $this->assertSame(['u:bob', 'u:carol'], $h->items->lockers('u:'));
        $this->assertSame(['g:gAbcdefghijk'], $h->items->lockers('g:'));
        $this->assertSame([$b1, $b2], $h->items->boardsLockedBy('u:bob'));
        $revs = [$h->rev($b1), $h->rev($b2), $h->rev($b3)];
        $carol = $row($b1, $b);
        $guest = $row($b3, $d);
        $h->log = [];
        $this->assertSame(2, $h->sync->clearLocker('u:bob', $h->now));
        $this->assertSame([$revs[0] + 1, $revs[1] + 1, $revs[2]], [$h->rev($b1), $h->rev($b2), $h->rev($b3)]);
        $this->assertSame(['locked' => 1, 'locked_by' => null, 'locked_name' => null, 'rev' => $revs[0] + 1], $row($b1, $a));
        $this->assertSame(['locked' => 1, 'locked_by' => null, 'locked_name' => null, 'rev' => $revs[1] + 1], $row($b2, $c));
        $this->assertSame([$carol, $guest], [$row($b1, $b), $row($b3, $d)]);
        $this->assertSame(['bumpRev ' . ($revs[0] + 1) . ' tx=0', 'bumpRev ' . ($revs[1] + 1) . ' tx=0'], $h->log, 'after COMMIT');
        $this->assertSame(['u:carol'], $h->items->lockers('u:'));
        $item = json_decode($h->syncRaw(['since' => $revs[0]], VoteHarness::user(), $b1), true)['items'][0];
        $this->assertSame([$a, ['by' => null, 'name' => null]], [$item['id'], $item['lock']]);
        $unlock = ['o' => 'patch', 'id' => $a, 'p' => ['lock' => null]];
        $this->assertSame(['itemlocked'], $h->syncDecoded(['seq' => 3, 'ops' => [$unlock]], $bob, $b1)['acks']['res']);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 1, 'ops' => [$unlock]], VoteHarness::user(), $b1)['acks']['res']);
        $this->assertSame(['locked' => null, 'locked_by' => null, 'locked_name' => null], array_slice($row($b1, $a), 0, 3));
    }

    /**
     * Job 023 review round 1 (B1) on the production SQL (SqliteDb): bob locks
     * X, the owner sends [unlock X, remove X] in one batch → the tombstone has
     * locked, locked_by and locked_name NULL; the revive is unlocked (the
     * sync sends "lock":null) and bob may edit it. reviveItem itself clears a
     * lock a tombstone still carried (a row written before this fix).
     */
    public function testATombstoneNeverKeepsALockOnSqlite(): void {
        $h = new VoteHarness();
        $b = $h->sql->addBoard('alice', 'B', 10);
        [$x, $y] = [VoteHarness::ulid(1), VoteHarness::ulid(2)];
        $h->sql->addItem($b, $x, 'sticky', null, false, 5);
        $h->sql->addItem($b, $y, 'sticky', null, true, 6);
        $bob = VoteHarness::user('bob', Role::Edit);
        $owner = VoteHarness::user();
        $lock = static fn (string $id): string => json_encode($h->sql->all('SELECT deleted, locked, locked_by, locked_name FROM *PREFIX*knorke_items WHERE board_id = ? AND id = ?', [$b, $id])[0] ?? null);
        $put = static fn (string $id): array => ['o' => 'put', 'id' => $id, 't' => 'sticky', 'revive' => true,
            'p' => ['x' => 0, 'y' => 0, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null, 'data' => ['text' => 'back'], 'style' => ['fill' => '#a8d8f8']]];
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 1, 'ops' => [['o' => 'patch', 'id' => $x, 'p' => ['lock' => ['by' => 'x', 'name' => 'y']]]]], $bob, $b)['acks']['res']);
        $this->assertSame('{"deleted":0,"locked":1,"locked_by":"u:bob","locked_name":"Bob Adler"}', $lock($x));
        $this->assertSame(['ok', 'ok'], $h->syncDecoded(['seq' => 1, 'ops' => [['o' => 'patch', 'id' => $x, 'p' => ['lock' => null]], ['o' => 'remove', 'id' => $x]]], $owner, $b)['acks']['res']);
        $this->assertSame('{"deleted":1,"locked":null,"locked_by":null,"locked_name":null}', $lock($x), 'the tombstone carries no lock');
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 2, 'ops' => [$put($x)]], $owner, $b)['acks']['res'], 'undo of the delete');
        $this->assertSame('{"deleted":0,"locked":null,"locked_by":null,"locked_name":null}', $lock($x));
        $item = array_column(json_decode($h->syncRaw(['since' => 0], $owner, $b), true)['items'], null, 'id')[$x];
        $this->assertNull($item['lock'], 'the sync sends "lock":null');
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 2, 'ops' => [['o' => 'patch', 'id' => $x, 'p' => ['w' => 250]]]], $bob, $b)['acks']['res'], 'bob edits the revived item');
        // a tombstone that still carries a lock (written before the fix): reviveItem clears it
        $h->sql->pdo->prepare('UPDATE oc_knorke_items SET locked = 1, locked_by = ?, locked_name = ? WHERE board_id = ? AND id = ?')->execute(['u:carol', 'Carol', $b, $y]);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 3, 'ops' => [$put($y)]], $owner, $b)['acks']['res']);
        $this->assertSame('{"deleted":0,"locked":null,"locked_by":null,"locked_name":null}', $lock($y));
    }

    /**
     * Job 026 (AK2) on the production SQL (SqliteDb): insertItem and
     * reviveItem write group_id (the put's, NULL without one, also over a
     * tombstone's), liveChildren delivers group_id, groupMembers (its raw
     * SQL twin) only the live rows of the named groups of this board, and
     * the dissolve of SyncService runs on it.
     */
    public function testGroupsOnSqlite(): void {
        $h = new VoteHarness();
        $b = $h->sql->addBoard('alice', 'B', 10);
        $b2 = $h->sql->addBoard('alice', 'B2', 20);
        [$g, $g2] = ['01JF5Q4T0V9W8X7Y6Z5A4B3C2D', '01JF5Q4T0V9W8X7Y6Z5A4B3C2E'];
        [$f, $x, $y, $z, $w, $o] = [VoteHarness::ulid(1), VoteHarness::ulid(2), VoteHarness::ulid(3), VoteHarness::ulid(4), VoteHarness::ulid(5), VoteHarness::ulid(6)];
        $owner = VoteHarness::user();
        $put = static fn (string $id, array $p = [], bool $revive = false): array => ['o' => 'put', 'id' => $id, 't' => 'sticky',
            'p' => $p + ['x' => 0, 'y' => 0, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null, 'data' => ['text' => 't'], 'style' => []]] + ($revive ? ['revive' => true] : []);
        $frame = ['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 0, 'y' => 0, 'w' => 800, 'h' => 600, 'r' => 0, 'z' => 'hz', 'parent' => null]];
        $res = $h->syncDecoded(['seq' => 1, 'ops' => [$frame, $put($x, ['parent' => $f, 'group' => $g]), $put($y, ['parent' => $f, 'group' => $g]),
            $put($z, ['group' => $g2]), $put($w, ['group' => $g])]], $owner, $b)['acks']['res'];
        $this->assertSame(['ok', 'ok', 'ok', 'ok', 'ok'], $res);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 1, 'ops' => [$put($o, ['group' => $g])]], $owner, $b2)['acks']['res'], 'the same group id on another board');
        $groupOf = static fn (int $board, string $id): ?string => $h->sql->one('SELECT group_id FROM *PREFIX*knorke_items WHERE board_id = ? AND id = ?', [$board, $id]);
        $this->assertSame([$g, $g, $g2, $g], [$groupOf($b, $x), $groupOf($b, $y), $groupOf($b, $z), $groupOf($b, $w)], 'insertItem writes group_id');
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 2, 'ops' => [['o' => 'remove', 'id' => $w]]], $owner, $b)['acks']['res']);
        $this->assertSame($g, $groupOf($b, $w), 'the tombstone keeps group_id');
        $kids = $h->items->liveChildren($b, [$f]);
        $this->assertSame([$x, $y], array_keys($kids));
        $this->assertSame([$g, $g], array_column($kids, 'group_id'), 'liveChildren delivers group_id');
        $this->assertSame([$x, $y], array_keys($h->items->groupMembers($b, [$g])), 'live rows of G on this board only (no tombstone, not B2)');
        $this->assertSame([$x, $y, $z], array_keys($h->items->groupMembers($b, [$g, $g2])));
        $this->assertSame([], $h->items->groupMembers($b, []));
        $this->assertSame(['id', 'type', 'parent_id', 'x', 'y', 'deleted', 'rev', 'group_id'], array_keys($h->items->groupMembers($b, [$g2])[$z]));
        // reviveItem: the put's group, NULL without one (also over a tombstone's group)
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 3, 'ops' => [$put($w, ['group' => $g2], true)]], $owner, $b)['acks']['res']);
        $this->assertSame($g2, $groupOf($b, $w));
        $this->assertSame(['ok', 'ok'], $h->syncDecoded(['seq' => 4, 'ops' => [['o' => 'remove', 'id' => $w], $put($w, [], true)]], $owner, $b)['acks']['res']);
        $this->assertNull($groupOf($b, $w));
        // the dissolve on SQLite: x goes, y is the last member of G
        $rev = $h->rev($b);
        $this->assertSame(['ok'], $h->syncDecoded(['seq' => 5, 'ops' => [['o' => 'remove', 'id' => $x]]], $owner, $b)['acks']['res']);
        $this->assertNull($groupOf($b, $y));
        $this->assertSame('{"group":null}', $h->sql->one('SELECT patch FROM *PREFIX*knorke_changes WHERE board_id = ? AND item_id = ? AND rev = ?', [$b, $y, $rev + 1]));
        $this->assertSame($g, $groupOf($b2, $o), 'the other board is untouched');
    }

    /** Job 026: the query-builder reads of groupMembers and liveChildren (partial rows with group_id). */
    public function testGroupMembersQuery(): void {
        $calls = [];
        $expr = Fake::of(IExpressionBuilder::class, [
            'eq' => function ($x, $y, $type = null) use (&$calls): string {
                $calls[] = "eq $x";
                return "$x = ?";
            },
            'in' => function ($x, $y, $type = null) use (&$calls): string {
                $calls[] = "in $x";
                return "$x IN (?)";
            },
        ]);
        $result = Fake::of(IResult::class, ['fetchAssociative' => fn (): array|false => false, 'closeCursor' => fn (): bool => true]);
        $qb = null;
        $self = static function () use (&$qb) {
            return $qb;
        };
        $qb = Fake::of(IQueryBuilder::class, [
            'select' => function (...$cols) use (&$calls, &$qb) {
                $calls[] = 'select ' . implode(',', $cols);
                return $qb;
            },
            'from' => function ($t, $alias = null) use (&$calls, &$qb) {
                $calls[] = "from $t";
                return $qb;
            },
            'where' => $self,
            'andWhere' => $self,
            'orderBy' => function ($s, $o = null) use (&$calls, &$qb) {
                $calls[] = "orderBy $s";
                return $qb;
            },
            'expr' => fn () => $expr,
            'createNamedParameter' => fn ($v, $t = IQueryBuilder::PARAM_STR, $p = null): string => '?',
            'executeQuery' => fn (?IDBConnection $c = null): IResult => $result,
        ]);
        $store = new ItemStore(Fake::of(IDBConnection::class, ['getQueryBuilder' => fn (): IQueryBuilder => $qb]));
        $this->assertSame([], $store->groupMembers(1, []));
        $this->assertSame([], $calls, 'no query without a group');
        $store->groupMembers(1, ['01JF5Q4T0V9W8X7Y6Z5A4B3C2D']);
        $this->assertSame(['select id,type,parent_id,x,y,deleted,rev,group_id', 'from knorke_items', 'eq board_id', 'in group_id', 'eq deleted', 'orderBy id'], $calls);
        $calls = [];
        $store->liveChildren(1, ['01JF5Q4T0V9W8X7Y6Z5A4B3C2D']);
        $this->assertSame(['select id,type,parent_id,x,y,deleted,rev,group_id', 'from knorke_items', 'eq board_id', 'in parent_id', 'eq deleted', 'orderBy id'], $calls);
    }
}
