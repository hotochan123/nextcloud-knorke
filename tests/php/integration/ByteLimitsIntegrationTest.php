<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Compactor;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Service\WriteBudget;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IAppConfig;
use OCP\Server;

/**
 * The byte limits of P7 (SPEC-M1 §33.1 b/c, INPUT-1) on the real database
 * of the dev stack — every KD_DB kind (PostgreSQL, MariaDB, MySQL, also
 * utf8mb3, SQLite) — and its Redis:
 *
 *  - a tombstone carries no payload: after remove octet_length(data) +
 *    octet_length(style) = 4 (read through the query builder's
 *    octetLength, the function the byte cap uses), type, placement,
 *    parent_id and z unchanged, the put row keeps the payload, a revive
 *    brings it back;
 *  - the byte cap of the change log (changesBytesBoundary: GROUP BY rev,
 *    SUM(octetLength(patch)) newest first, in blocks of PURGE_CHUNK revs;
 *    the DELETEs in blocks through rev): octets, not characters; NULL = 0;
 *    the newest rev always stays;
 *  - the daily byte quota on Redis (wd:/wu: with TTL ≤ 25 h, busy with the
 *    day's retryMs through the real SyncService).
 */
final class ByteLimitsIntegrationTest extends IntegrationCase {
    /** A text of $n code points that fits this database: 4-byte emoji, or 2-byte "ä" without utf8mb4. */
    private function chars(int $n): string {
        return str_repeat($this->db->supports4ByteText() ? '😀' : 'ä', $n);
    }

    /** [octet_length(data) + octet_length(style), type, x, y, w, h, rotation, parent_id, z, deleted] of a row, through the query builder. */
    private function itemRow(int $b, string $id): array {
        $qb = $this->db->getQueryBuilder();
        $qb->select('type', 'x', 'y', 'w', 'h', 'rotation', 'parent_id', 'z', 'deleted')
            ->selectAlias($qb->func()->octetLength('data'), 'dlen')
            ->selectAlias($qb->func()->octetLength('style'), 'slen')
            ->from('knorke_items')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($b, IQueryBuilder::PARAM_INT)))
            ->andWhere($qb->expr()->eq('id', $qb->createNamedParameter($id)));
        $r = $qb->executeQuery()->fetchAssociative();
        $this->assertIsArray($r);
        return [(int)$r['dlen'] + (int)$r['slen'], (string)$r['type'], (float)$r['x'], (float)$r['y'], (float)$r['w'], (float)$r['h'], (float)$r['rotation'],
            $r['parent_id'] === null ? null : (string)$r['parent_id'], (string)$r['z'], (int)$r['deleted']];
    }

    private function patchBytes(int $b, string $id, int $rev): int {
        $qb = $this->db->getQueryBuilder();
        $qb->selectAlias($qb->func()->octetLength('patch'), 'n')->from('knorke_changes')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($b, IQueryBuilder::PARAM_INT)))
            ->andWhere($qb->expr()->eq('item_id', $qb->createNamedParameter($id)))
            ->andWhere($qb->expr()->eq('rev', $qb->createNamedParameter($rev, IQueryBuilder::PARAM_INT)));
        return (int)$qb->executeQuery()->fetchOne();
    }

    public function testTombstoneWithoutPayload(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $id = self::ulid(41);
        $frame = self::ulid(40);
        $item = ['x' => 12.5, 'y' => -7.25, 'w' => 210, 'h' => 190, 'r' => 15, 'z' => 'i7', 'parent' => $frame,
            'data' => ['text' => $this->chars(6000)], 'style' => ['fill' => '#a8d8f8', 'zz1' => str_repeat('s', 6000), 'zz2' => str_repeat('t', 6000), 'zz3' => str_repeat('u', 6000)]];
        $now = self::nowMs();
        [, $res] = $this->sync->applyOps($p, $b, 'cIt', [['o' => 'put', 'id' => $frame, 't' => 'frame', 'p' => ['x' => 1000, 'y' => 500, 'w' => 800, 'h' => 600, 'r' => 0, 'z' => 'h0', 'parent' => null, 'data' => ['title' => 'F'], 'style' => ['fill' => '#ffffff']]]], $now);
        $this->assertSame(['ok'], $res);
        [$putRev, $res] = $this->sync->applyOps($p, $b, 'cIt', [['o' => 'put', 'id' => $id, 't' => 'sticky', 'p' => $item]], $now);
        $this->assertSame(['ok'], $res);
        $before = $this->itemRow($b, $id);
        $this->assertGreaterThanOrEqual(30000, $before[0]);
        [$rev, $res] = $this->sync->applyOps($p, $b, 'cIt', [['o' => 'remove', 'id' => $id]], $now + 1);
        $this->assertSame(['ok'], $res);
        $after = $this->itemRow($b, $id);
        $this->assertSame(4, $after[0], self::dbKind() . ': octet_length(data) + octet_length(style) of the tombstone');
        $this->assertSame(array_slice($before, 1, 8), array_slice($after, 1, 8), 'type, placement, parent_id and z unchanged');
        $this->assertSame(1, $after[9]);
        $this->assertGreaterThanOrEqual($before[0], $this->patchBytes($b, $id, $putRev), 'the put row of the change log keeps the payload');
        $this->assertSame(0, $this->patchBytes($b, $id, $rev), 'the remove row has none (NULL)');
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored, 'item_bytes = live rows (a tombstone does not count)');
        // Revive with the full object: every column again.
        [, $res] = $this->sync->applyOps($p, $b, 'cIt', [['o' => 'put', 'id' => $id, 't' => 'sticky', 'revive' => true, 'p' => $item]], $now + 2);
        $this->assertSame(['ok'], $res);
        $this->assertSame($before, $this->itemRow($b, $id), 'data complete again');
        $snap = json_decode($this->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => 'owner']), true);
        $mine = array_values(array_filter($snap['items'], static fn (array $i): bool => $i['id'] === $id));
        $this->assertSame($this->chars(6000), $mine[0]['data']['text']);
    }

    /** One change row per entry: rev => list of patch texts (null = a remove row). */
    private function changes(int $b, array $patches, int $ts): void {
        $values = [];
        $params = [];
        $flush = function () use (&$values, &$params): void {
            if ($values !== []) {
                $this->db->executeStatement('INSERT INTO *PREFIX*knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES ' . implode(', ', $values), $params);
            }
            $values = [];
            $params = [];
        };
        foreach ($patches as $rev => $list) {
            foreach (array_values($list) as $i => $patch) {
                $values[] = '(?, ?, ?, ?, ?, ?, ?, ?)';
                array_push($params, $b, $rev, sprintf('01JX%022d', $i), $patch === null ? 'remove' : 'patch', $patch, 'u:it', 'cIt', $ts);
                if (count($values) === 500) {
                    $flush();
                }
            }
        }
        $flush();
    }

    /** A patch text of exactly $bytes bytes made of $char (padded with "x"). */
    private static function patchOf(int $bytes, string $char = 'x'): string {
        $head = '{"data.text":"';
        $room = $bytes - strlen($head) - 2;
        $n = intdiv($room, strlen($char));
        return $head . str_repeat($char, $n) . str_repeat('x', $room - $n * strlen($char)) . '"}';
    }

    /** @return list<int> */
    private function changeRevs(int $b): array {
        return array_map('intval', $this->db->executeQuery('SELECT rev FROM *PREFIX*knorke_changes WHERE board_id = ? ORDER BY rev, item_id', [$b])->fetchFirstColumn());
    }

    private function compactor(int $bytesCap): Compactor {
        $limits = new class(Server::get(IAppConfig::class), $bytesCap) extends Limits {
            public function __construct(IAppConfig $c, private int $cap) {
                parent::__construct($c);
            }

            public function changesBytesCap(): int {
                return $this->cap;
            }
        };
        return new Compactor($this->items, $this->boards, $this->cache, Server::get(LinkPolicy::class), $limits, $this->db, Server::get(IAppConfig::class));
    }

    public function testByteCapOnThisDatabase(): void {
        $now = self::nowMs();
        // Octets, not characters: 10 revs of 1000 bytes in 2-byte "ä" (≈ 500 characters), cap 5500 → 5 stay.
        $b = $this->board();
        $this->changes($b, array_fill_keys(range(1, 10), [self::patchOf(1000, 'ä')]), $now);
        $this->assertSame(6, $this->items->changesBytesBoundary($b, 5500), self::dbKind() . ': R_bytes');
        $this->assertSame(5, $this->compactor(5500)->board($b, $now)['changes']);
        $this->assertSame(range(6, 10), $this->changeRevs($b));
        // Sums per rev, NULL = 0, the newest rev always stays.
        $c = $this->board();
        $this->changes($c, [1 => [self::patchOf(500)], 2 => [self::patchOf(1000), self::patchOf(1000)], 3 => [null, null, null], 4 => [self::patchOf(1000), null], 5 => [self::patchOf(900)]], $now);
        $this->assertSame(3, $this->compactor(3000)->board($c, $now)['changes']);
        $this->assertSame([3, 3, 3, 4, 4, 5], $this->changeRevs($c));
        $this->assertSame(5, $this->compactor(10)->board($c, $now)['changes'], 'cap below the newest rev (900 bytes): everything older goes, rev 5 stays');
        $this->assertSame([5], $this->changeRevs($c));
        $this->assertNull($this->items->changesBytesBoundary($c, 10), 'one rev left: nothing to delete');
        $this->assertNull($this->items->changesBytesBoundary($c, 0), '0 = off');
        // Blocks: 6000 revs of 10 bytes, cap 55 000 → the boundary read needs a
        // second block of 5000 revs; 500 rows go.
        $d = $this->board();
        $this->changes($d, array_fill_keys(range(1, 6000), ['{"x":"12"}']), $now);
        $t0 = microtime(true);
        $this->assertSame(500, $this->compactor(55000)->board($d, $now)['changes']);
        $ms = (microtime(true) - $t0) * 1000;
        $revs = $this->changeRevs($d);
        $this->assertSame([5500, 501, 6000], [count($revs), $revs[0], $revs[5499]]);
        fwrite(STDERR, sprintf("\n[P7-01] %s: byte cap over 6000 revs (two boundary blocks, 500 rows deleted): %.0f ms\n", self::dbKind(), $ms));
    }

    public function testDailyByteQuotaThroughTheSyncPath(): void {
        $config = Server::get(IAppConfig::class);
        $had = [];
        foreach ([Limits::KEY_BUDGET_BYTES_BOARD_DAY, Limits::KEY_BUDGET_BYTES_USER_DAY] as $k) {
            $had[$k] = $config->hasKey('knorke', $k) ? $config->getValueString('knorke', $k, '') : null;
        }
        $b = $this->board();
        $p = $this->owner($b);
        $now = self::nowMs();
        $tag = intdiv($now, 86400000);
        $wd = 'wd:' . $b . ':' . $tag;
        $wu = 'wu:' . WriteBudget::userHash($this->uid) . ':' . $tag;
        $keys = [$wd, $wu, 'w:' . $b . ':' . $p->pid . ':' . intdiv($now, 10000), 'wo:' . $b . ':' . $p->pid . ':' . intdiv($now, 10000)];
        $sync = function (int $seq) use ($b, $p, $now): array {
            $body = ['proto' => 2, 'ep' => Server::get(Epoch::class)->current(), 'client' => 'cIt', 'since' => 0, 'seq' => $seq, 'pres' => 0,
                'ops' => [['o' => 'put', 'id' => self::ulid(7000 + $seq), 't' => 'sticky', 'p' => ['x' => 0, 'y' => 0, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null, 'data' => ['text' => str_repeat('q', 1300)], 'style' => []]]]];
            $r = SyncRequest::fromBody($body, strlen(json_encode($body)));
            return json_decode($this->sync->sync(new AccessResult($p, null, 0), $b, $r, $now), true, 512, JSON_THROW_ON_ERROR);
        };
        try {
            $config->setValueString('knorke', Limits::KEY_BUDGET_BYTES_BOARD_DAY, '4000');
            $config->deleteKey('knorke', Limits::KEY_BUDGET_BYTES_USER_DAY);
            foreach ($keys as $k) {
                $this->redis->remove($k);
            }
            $this->assertSame(['ok'], $sync(1)['acks']['res']);
            $this->assertSame(['ok'], $sync(2)['acks']['res']);
            $rev = $this->dbRev($b);
            $d = $sync(3);
            $this->assertSame(['seq' => 3, 'rev' => null, 'res' => ['busy'], 'retryMs' => min(($tag + 1) * 86400000 - $d['now'], 60000) + 100], $d['acks']);
            $this->assertSame($rev, $this->dbRev($b), 'nothing applied');
            $counted = $this->redis->get($wd);
            $this->assertTrue(is_int($counted) && $counted > 4000 && $counted < 5000, 'three bodies of ≈1450 bytes on wd:, got ' . var_export($counted, true));
            $this->assertSame($counted, $this->redis->get($wu), 'and on the account counter');
            foreach ([$wd, $wu] as $k) {
                $ttl = $this->redis->getTTL($k);
                $this->assertTrue(is_int($ttl) && $ttl > 86000 && $ttl <= 90000, "$k has the 25-h TTL, got " . var_export($ttl, true));
            }
        } finally {
            foreach ($had as $k => $v) {
                $config->deleteKey('knorke', $k);
                if ($v !== null) {
                    $config->setValueString('knorke', $k, $v);
                }
            }
            foreach ($keys as $k) {
                $this->redis->remove($k);
            }
        }
    }
}
