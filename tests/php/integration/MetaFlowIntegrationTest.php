<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\IAppConfig;
use OCP\ICacheFactory;
use OCP\Server;

/**
 * Stage 0 of SPEC-M1 on the real database and Redis of the dev stack: the
 * meta write path (§4.13.4: lock first, meta_rev = rev in one UPDATE on
 * every database kind, LONGTEXT), `board` and `now` in /sync (§4.13.8), the
 * snapshot v2 (§4.4) and the epoch prefix (§5.1, §5.4).
 */
final class MetaFlowIntegrationTest extends IntegrationCase {
    private MetaService $meta;

    protected function setUp(): void {
        parent::setUp();
        $this->meta = Server::get(MetaService::class);
    }

    /** @return array{rev: int, meta_rev: int, title: string, meta: ?string} */
    private function row(int $b): array {
        $r = $this->db->executeQuery('SELECT rev, meta_rev, title, meta FROM *PREFIX*knorke_boards WHERE id = ?', [$b])->fetchAssociative();
        return ['rev' => (int)$r['rev'], 'meta_rev' => (int)$r['meta_rev'], 'title' => (string)$r['title'], 'meta' => $r['meta'] === null ? null : (string)$r['meta']];
    }

    private function syncAnswer(int $b, Principal $p, int $since, array $extra = []): array {
        $r = SyncRequest::fromBody(['proto' => Application::PROTOCOL, 'client' => 'cMeta', 'since' => $since, 'pres' => 0, 'ep' => Server::get(Epoch::class)->current()] + $extra);
        return json_decode($this->sync->sync(new AccessResult($p, null, 0), $b, $r, self::nowMs()), true, 512, JSON_THROW_ON_ERROR);
    }

    public function testMetaRevIsTheNewRevOnThisDatabase(): void {
        // §3.2: "meta_rev = rev + 1, rev = rev + 1" in ONE statement gives
        // meta_rev = the new rev whether the database assigns left to right
        // with new values (MySQL/MariaDB) or from the old row (PG, SQLite).
        $b = $this->board();
        $p = $this->owner($b);
        $this->sync->applyOps($p, $b, 'c1', [['o' => 'put', 'id' => self::ulid(1), 't' => 'sticky', 'p' => ['x' => 1, 'y' => 2, 'w' => 200, 'h' => 200, 'z' => 'i1', 'data' => ['text' => 'a']]]], self::nowMs());
        $this->assertSame(['rev' => 1, 'meta_rev' => 0], array_intersect_key($this->row($b), ['rev' => 1, 'meta_rev' => 1]));
        $out = $this->meta->write($b, static fn (array $m): array => $m + ['timer' => ['state' => 'paused', 'left' => 5000, 'by' => 'Ädä 👍', 'seq' => 1]], self::nowMs(), 'Titel 2');
        $row = $this->row($b);
        $this->assertSame([2, 2, 'Titel 2', 2], [$row['rev'], $row['meta_rev'], $row['title'], $out['metaRev']], self::dbKind());
        $this->assertSame($out['meta'], MetaService::decode($row['meta']));
        $this->assertSame(2, $this->cache->getRev($b), 'bumpRev after COMMIT');
        $this->assertSame(0, (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_changes WHERE board_id = ? AND rev = 2', [$b])->fetchOne(), 'no change row');
        // A big meta (> 64 KiB: TEXT would cut it on MySQL/MariaDB, LONGTEXT does not).
        $big = str_repeat('x', 200000);
        $this->meta->write($b, static fn (array $m): array => ['blob' => $big], self::nowMs());
        $this->assertSame($big, MetaService::decode($this->row($b)['meta'])['blob'] ?? null, 'LONGTEXT round trip');
        // Back to empty: stored as NULL, title kept.
        $out = $this->meta->write($b, static fn (array $m): array => [], self::nowMs());
        $this->assertSame([4, 4, null, 'Titel 2'], [$this->row($b)['rev'], $this->row($b)['meta_rev'], $this->row($b)['meta'], $out['title']]);
    }

    public function testMetaWriteTakesTheBoardLockFirst(): void {
        // While the mutation runs (inside the transaction, after lockBoard)
        // another session cannot write the board row: the lock is held.
        $b = $this->board();
        [$pdo, $isLockTimeout] = self::lockWaitingPdo();
        [, , , $prefix] = self::pdoParams();
        $blocked = null;
        $this->meta->write($b, function (array $m) use ($pdo, $prefix, $b, $isLockTimeout, &$blocked): array {
            try {
                $pdo->exec('UPDATE ' . $prefix . 'knorke_boards SET rev = rev WHERE id = ' . $b);
                $blocked = false;
            } catch (\PDOException $e) {
                $blocked = $isLockTimeout($e);
                if (!$blocked) {
                    throw $e;
                }
            }
            return $m + ['summon' => ['pid' => 'p', 'client' => 'c', 'name' => 'A', 'seq' => 1, 'at' => 1]];
        }, self::nowMs());
        $this->assertTrue($blocked, self::dbKind() . ': the board row was locked during the mutation');
        $this->assertSame(1, $this->row($b)['meta_rev']);
    }

    public function testInterleavedMetaAndObjectWrites(): void {
        // 100 meta writes against object batches: rev and meta_rev rise
        // strictly, meta_rev = rev after every meta write, the last title
        // stays, and a client that saw none of it gets the latest title once.
        $b = $this->board();
        $p = $this->owner($b);
        $lastRev = 0;
        $lastMeta = 0;
        for ($i = 1; $i <= 100; $i++) {
            if ($i % 3 === 0) {
                [$rev] = $this->sync->applyOps($p, $b, 'c1', [['o' => 'put', 'id' => self::ulid($i), 't' => 'sticky', 'p' => ['x' => $i, 'y' => 0, 'w' => 200, 'h' => 200, 'z' => 'i1']]], self::nowMs());
                $this->assertGreaterThan($lastRev, $rev);
                $lastRev = $rev;
                continue;
            }
            $out = $this->meta->write($b, static function (array $m) use ($i): array {
                $m['timer'] = ['state' => 'running', 'dur' => 1000 * $i, 'end' => 0, 'left' => null, 'by' => 'A', 'seq' => $i];
                return $m;
            }, self::nowMs(), $i % 10 === 0 ? 'T' . $i : null);
            $this->assertGreaterThan($lastRev, $out['metaRev']);
            $this->assertGreaterThan($lastMeta, $out['metaRev']);
            $row = $this->row($b);
            $this->assertSame($row['rev'], $row['meta_rev']);
            $lastRev = $lastMeta = $out['metaRev'];
        }
        $row = $this->row($b);
        $this->assertSame(['T100', 100], [$row['title'], MetaService::decode($row['meta'])['timer']['seq']]);
        $d = $this->syncAnswer($b, $p, 0);
        $this->assertSame(['title' => 'T100', 'metaRev' => $lastMeta], ['title' => $d['board']['title'], 'metaRev' => $d['board']['metaRev']]);
        $this->assertSame(100, $d['board']['meta']['timer']['seq']);
        $this->assertCount(33, $d['items']);
        $d = $this->syncAnswer($b, $p, $d['rev']);
        $this->assertArrayNotHasKey('board', $d, 'cursor past meta_rev: no board');
    }

    public function testRenameReachesSyncAndSnapshot(): void {
        // Live title (§1.4): BoardService::rename → the next sync of a client
        // below meta_rev carries board.title; the snapshot carries epoch, now,
        // board.meta/metaRev, me.mod/source.
        $service = Server::get(BoardService::class);
        $board = $service->create($this->uid, 'Alt');
        $b = $board['id'];
        $this->created[] = $b;
        $p = $this->owner($b);
        $this->assertSame(['rev' => 0], array_diff_key($this->syncAnswer($b, $p, 0), ['now' => 1]));
        $this->assertSame('Neu', $service->rename($this->uid, $b, 'Neu')['title']);
        $d = $this->syncAnswer($b, $p, 0);
        $this->assertSame(['rev' => 1, 'board' => ['title' => 'Neu', 'meta' => [], 'metaRev' => 1]], array_diff_key($d, ['now' => 1]));
        $this->assertIsInt($d['now']);
        $raw = $this->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => 'owner', 'links' => ['edit' => null, 'vote' => null], 'linksAllowed' => true], null, self::nowMs());
        $s = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame([2, Server::get(Epoch::class)->current(), 1], [$s['proto'], $s['epoch'], $s['rev']]);
        $this->assertSame(['id' => $b, 'title' => 'Neu', 'role' => 'owner', 'metaRev' => 1, 'meta' => [], 'links' => ['edit' => null, 'vote' => null], 'linksAllowed' => true], $s['board']);
        $this->assertStringContainsString('"meta":{}', $raw);
        $this->assertSame([true, 'own'], [$s['me']['mod'], $s['me']['source']]);
    }

    public function testEpochPrefixAndRotation(): void {
        // §5.1/§5.4 on real Redis: the keys live under knorke/<epoch>/, a
        // FastCache built after a rotation sees none of them, and a client
        // sending the old epoch resyncs. The epoch is restored afterwards.
        $epoch = Server::get(Epoch::class);
        $old = $epoch->current();
        $this->assertMatchesRegularExpression('/^[a-z0-9]{6,16}$/', $old, 'InitEpoch ran (non-lazy)');
        $b = $this->board();
        $p = $this->owner($b);
        $this->sync->applyOps($p, $b, 'c1', [['o' => 'put', 'id' => self::ulid(1), 't' => 'sticky', 'p' => ['x' => 1, 'y' => 2, 'w' => 200, 'h' => 200, 'z' => 'i1']]], self::nowMs());
        $this->assertSame(1, $this->redis->get('r:' . $b), 'r: under knorke/<epoch>/');
        $this->assertNull(Server::get(ICacheFactory::class)->createDistributed('knorke/')->get('r:' . $b), 'nothing under the M0 prefix');
        try {
            $new = $epoch->rotate();
            $this->assertNotSame($old, $new);
            $this->assertSame($new, $epoch->current());
            $fresh = new FastCache(Server::get(ICacheFactory::class), $epoch);
            $this->assertNull($fresh->getRev($b), 'invisible after the rotation');
            $this->assertSame(1, $this->cache->getRev($b), 'the old key still exists (expires by TTL)');
            $r = SyncRequest::fromBody(['proto' => Application::PROTOCOL, 'client' => 'cOld', 'since' => 1, 'pres' => 0, 'ep' => $old]);
            $d = json_decode($this->sync->sync(new AccessResult($p, null, 0), $b, $r, self::nowMs()), true);
            $this->assertTrue($d['resync'] ?? false, 'old epoch → resync');
        } finally {
            Server::get(IAppConfig::class)->setValueString(Application::APP_ID, Epoch::KEY, $old, lazy: false);
        }
        $this->assertSame($old, $epoch->current());
    }
}
