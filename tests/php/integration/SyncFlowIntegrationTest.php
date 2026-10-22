<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OC\AppFramework\Http\Request;
use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\IRequestId;
use OCP\Server;

/**
 * applyOps + sync over the real services (SPEC-M0 §9.2): fault injection on
 * the Redis keys, convergence of independent mirrors, JsonBody on a real
 * Nextcloud request.
 */
final class SyncFlowIntegrationTest extends IntegrationCase {
    /**
     * Decoded sync answer WITHOUT `now`: every answer must carry it (SPEC-M1
     * §4.5), checked here once against the clock, then dropped so the M0
     * literals of the tests below stay comparable.
     *
     * @return array<string, mixed>
     */
    private function sync(int $b, Principal $p, int $since, array $extra = [], ?int $dbRev = null, string $client = 'cIt'): array {
        $r = SyncRequest::fromBody(['proto' => Application::PROTOCOL, 'client' => $client, 'since' => $since, 'ep' => Server::get(Epoch::class)->current()] + $extra);
        $t0 = self::nowMs();
        $d = json_decode($this->sync->sync(new AccessResult($p, $dbRev, 0), $b, $r, $t0), true, 512, JSON_THROW_ON_ERROR);
        $this->assertIsInt($d['now'] ?? null, 'now in every answer');
        $this->assertGreaterThanOrEqual($t0, $d['now']);
        $this->assertLessThanOrEqual(self::nowMs(), $d['now']);
        unset($d['now']);
        return $d;
    }

    private static function sticky(array $p = []): array {
        return $p + ['x' => 10, 'y' => 20, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null, 'data' => ['text' => ''], 'style' => ['fill' => '#a8d8f8']];
    }

    private function snapshotItems(int $b): array {
        $snap = json_decode($this->sync->snapshotJson(new AccessResult($this->owner($b), null, 0), $b, ['id' => $b, 'title' => 'IT', 'role' => 'owner']), true);
        $out = [];
        foreach ($snap['items'] as $it) {
            $out[$it['id']] = $it;
        }
        ksort($out);
        return $out;
    }

    public function testWriteThenReadWithAcksAndCompaction(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $f = self::ulid(1);
        $s = self::ulid(2);
        $d = $this->sync($b, $p, 0, ['seq' => 1, 'ops' => [
            ['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 1000, 'y' => 500, 'w' => 800, 'h' => 600, 'z' => 'hz', 'data' => ['title' => 'F']]],
            ['o' => 'put', 'id' => $s, 't' => 'sticky', 'p' => self::sticky()],
            ['o' => 'patch', 'id' => $s, 'p' => ['x' => 5, 'y' => 6, 'parent' => $f]],
        ]]);
        $this->assertSame(['seq' => 1, 'rev' => 1, 'res' => ['ok', 'ok', 'ok']], $d['acks']);
        $this->assertSame(1, $d['rev']);
        $this->assertSame([$f, $s], array_column($d['items'], 'id'));
        $this->assertSame([], $d['presence']);
        $this->assertSame(1, $this->cache->getRev($b), 'bumped after COMMIT');

        // A batch that writes nothing rolls back: no rev jump, acks.rev = observed rev.
        $d = $this->sync($b, $p, 1, ['seq' => 2, 'ops' => [['o' => 'patch', 'id' => $s, 'p' => ['data.text' => '']], ['o' => 'remove', 'id' => self::ulid(99)]]]);
        $this->assertSame(['seq' => 2, 'rev' => 1, 'res' => ['ok', 'gone']], $d['acks']);
        $this->assertSame(1, $this->dbRev($b));

        // Frame removal releases the child: one change row, absolute position kept.
        $d = $this->sync($b, $p, 1, ['seq' => 3, 'ops' => [['o' => 'remove', 'id' => $f]]]);
        $this->assertSame([$f], $d['removed']);
        $this->assertSame([null, 1005.0, 506.0], [$d['items'][0]['parent'], $d['items'][0]['x'], $d['items'][0]['y']]);
        $n = (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_changes WHERE board_id = ? AND rev = 2', [$b])->fetchOne();
        $this->assertSame(2, $n, 'one row for F (remove), one for S (patch)');
        $this->assertSame(1, (int)$this->db->executeQuery('SELECT item_count FROM *PREFIX*knorke_boards WHERE id = ?', [$b])->fetchOne());
    }

    public function testFourByteTextNeverFailsTheBatch(): void {
        // U7 (NC-3): on a database without 4-byte UTF-8 (mysql.utf8mb4 =
        // false, utf8mb3 tables) an emoji used to fail the whole batch with
        // SQLSTATE 22007 / 1366 → 500, and the client resent it forever. Now
        // it is stored as U+FFFD and the writer gets the stored item back in
        // the same answer; with 4-byte support it is stored as sent.
        $b = $this->board();
        $p = $this->owner($b);
        $four = $this->db->supports4ByteText();
        $emoji = static fn (string $s): string => $four ? $s : preg_replace('/[\x{10000}-\x{10FFFF}]/u', "\u{FFFD}", $s);
        $a = self::ulid(1);
        $plain = self::ulid(2);
        $f = self::ulid(3);
        $d = $this->sync($b, $p, 0, ['seq' => 1, 'ops' => [
            ['o' => 'put', 'id' => $a, 't' => 'sticky', 'p' => self::sticky(['data' => ['text' => 'great idea 👍', 'tags' => ['🔥', 'ok']]])],
            ['o' => 'put', 'id' => $plain, 't' => 'sticky', 'p' => self::sticky(['data' => ['text' => '€ ü 中']])],
            ['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 0, 'y' => 0, 'w' => 800, 'h' => 600, 'z' => 'hz', 'data' => ['title' => str_repeat('🗂', 200)]]],
            ['o' => 'patch', 'id' => $a, 'p' => ['style.label' => 'Ziel 🎯']],
        ]]);
        $this->assertSame(['seq' => 1, 'rev' => 1, 'res' => ['ok', 'ok', 'ok', 'ok']], $d['acks'], self::dbKind() . ($four ? '' : ' utf8mb3') . ': the whole batch is written');
        $byId = array_column($d['items'], null, 'id');
        $this->assertSame([$emoji('great idea 👍'), [$emoji('🔥'), 'ok'], $emoji('Ziel 🎯')], [$byId[$a]['data']['text'], $byId[$a]['data']['tags'], $byId[$a]['style']['label']], 'the writer gets the stored values in the same answer');
        $this->assertSame('€ ü 中', $byId[$plain]['data']['text']);
        $this->assertSame($emoji(str_repeat('🗂', 200)), $byId[$f]['data']['title']);
        $this->assertSame($byId, array_intersect_key($this->snapshotItems($b), $byId), 'answer = snapshot');
        $patch = (string)$this->db->executeQuery('SELECT patch FROM *PREFIX*knorke_changes WHERE board_id = ? AND item_id = ?', [$b, $a])->fetchOne();
        $this->assertStringContainsString($emoji('great idea 👍'), $patch, 'the change log row too');
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
        $d = $this->sync($b, $p, 1, ['seq' => 2, 'ops' => [['o' => 'patch', 'id' => $plain, 'p' => ['data.text' => '😀 later']]]]);
        $this->assertSame(['ok'], $d['acks']['res']);
        $this->assertSame($emoji('😀 later'), $d['items'][0]['data']['text']);
    }

    public function testFaultInjectionOnRev(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $this->sync($b, $p, 0, ['seq' => 1, 'ops' => [['o' => 'put', 'id' => self::ulid(1), 't' => 'sticky', 'p' => self::sticky()]]]);
        $this->sync($b, $p, 1, ['seq' => 2, 'ops' => [['o' => 'put', 'id' => self::ulid(2), 't' => 'sticky', 'p' => self::sticky()]]]);
        $this->assertSame(2, $this->cache->getRev($b));

        // 1) r: removed → the next sync reads the DB and seeds again.
        $this->redis->remove('r:' . $b);
        $this->assertSame(['rev' => 2], $this->sync($b, $p, 2, ['pres' => 0]));
        $this->assertSame(2, $this->cache->getRev($b));
        $this->assertSame(30, $this->redis->getTTL('r:' . $b));

        // 2) r: lowered → since > cached: immediate DB check + bump.
        $this->redis->set('r:' . $b, 1, 30);
        $this->assertSame(['rev' => 2], $this->sync($b, $p, 2, ['pres' => 0]));
        $this->assertSame(2, $this->cache->getRev($b));

        // 3) a write whose bump was lost (r: lower WITH a TTL) shows up once the TTL ran out.
        $this->db->executeStatement('UPDATE *PREFIX*knorke_boards SET rev = rev + 1 WHERE id = ?', [$b]);
        $this->db->executeStatement('UPDATE *PREFIX*knorke_items SET rev = 3, data = ? WHERE board_id = ? AND id = ?', ['{"text":"silent"}', $b, self::ulid(1)]);
        $this->redis->set('r:' . $b, 2, 1);
        $this->assertSame(['rev' => 2], $this->sync($b, $p, 2, ['pres' => 0]), 'Redis lags, not provably');
        sleep(2);
        $d = $this->sync($b, $p, 2, ['pres' => 0]);
        $this->assertSame(3, $d['rev'], 'safety net (a): TTL 30 s heals a lost bump');
        $this->assertSame('silent', $d['items'][0]['data']['text']);

        // 4) r: ahead of the DB (DB restore): the client storing the too-high rev resyncs.
        $this->redis->set('r:' . $b, 8, 1);
        $this->assertSame(8, $this->sync($b, $p, 3, ['pres' => 0])['rev']);
        sleep(2);
        $d = $this->sync($b, $p, 8, ['pres' => 0]);
        $this->assertTrue($d['resync'] ?? false, 'client from the future → resync');
    }

    public function testPresenceBlobDeletedAndLease(): void {
        $b = $this->board();
        $alice = $this->owner($b);
        $guest = $this->guest($b);
        $n = self::ulid(1);
        $this->sync($b, $alice, 0, ['seq' => 1, 'ops' => [['o' => 'put', 'id' => $n, 't' => 'sticky', 'p' => self::sticky()]], 'me' => ['c' => [1, 2], 'e' => $n]], null, 'cA');
        $d = $this->sync($b, $guest, 1, ['seq' => 1, 'me' => ['c' => [3, 4]], 'ops' => [['o' => 'patch', 'id' => $n, 'p' => ['data.text' => 'G']]]], null, 'cG');
        $this->assertSame(['locked'], $d['acks']['res']);
        $this->assertSame(1, $d['presence'][$alice->pid . ':cA']['h']);
        $this->assertSame($this->uid, $d['presence'][$alice->pid . ':cA']['n']);
        $this->assertGreaterThan(54, $this->redis->getTTL('p:' . $b));
        $this->redis->remove('p:' . $b);
        $d = $this->sync($b, $guest, 1, ['seq' => 2, 'me' => ['c' => [3, 5]], 'ops' => [['o' => 'patch', 'id' => $n, 'p' => ['data.text' => 'G']]]], null, 'cG');
        $this->assertSame(['ok'], $d['acks']['res'], 'blob gone → no lease → LWW');
        $this->assertSame([], $d['presence']);
        $d = $this->sync($b, $alice, 2, ['pres' => 1], null, 'cA');
        $this->assertSame(1, $d['presence'][$guest->pid . ':cG']['g']);
    }

    public function testConvergenceOfMirrors(): void {
        $b = $this->board();
        $actors = [[$this->owner($b), 'cA'], [$this->guest($b, 'gITGUEST0001'), 'cG'], [$this->guest($b, 'gITGUEST0002', 'Hugo'), 'cH']];
        $mirrors = [[], [], []];
        $cursors = [0, 0, 0];
        $seq = [0, 0, 0];
        mt_srand(4711);
        $ids = array_map([self::class, 'ulid'], range(1, 12));
        $frames = [self::ulid(100), self::ulid(101)];
        $ops = function () use ($ids, $frames): array {
            $out = [];
            for ($k = 0, $n = mt_rand(1, 4); $k < $n; $k++) {
                $id = $ids[mt_rand(0, count($ids) - 1)];
                $out[] = match (mt_rand(0, 6)) {
                    0 => ['o' => 'put', 'id' => $id, 't' => 'sticky', 'p' => self::sticky(['x' => mt_rand(0, 900), 'y' => mt_rand(0, 900)])],
                    1 => ['o' => 'patch', 'id' => $id, 'p' => ['data.text' => 't' . mt_rand(0, 99)]],
                    2 => ['o' => 'patch', 'id' => $id, 'p' => ['x' => mt_rand(0, 50), 'y' => mt_rand(0, 50), 'parent' => mt_rand(0, 1) ? $frames[mt_rand(0, 1)] : null]],
                    3 => ['o' => 'remove', 'id' => $id],
                    4 => ['o' => 'put', 'id' => $id, 't' => 'sticky', 'p' => self::sticky(), 'revive' => true],
                    5 => ['o' => 'put', 'id' => $frames[mt_rand(0, 1)], 't' => 'frame', 'p' => ['x' => mt_rand(0, 3000), 'y' => 0, 'w' => 800, 'h' => 600, 'z' => 'hz'], 'revive' => true],
                    default => ['o' => 'remove', 'id' => $frames[mt_rand(0, 1)]],
                };
            }
            return $out;
        };
        $apply = function (int $i, array $d) use (&$mirrors, &$cursors): void {
            if ($d['resync'] ?? false) {
                $this->fail('unexpected resync');
            }
            foreach ($d['items'] ?? [] as $it) {
                $mirrors[$i][$it['id']] = $it;
            }
            foreach ($d['removed'] ?? [] as $id) {
                unset($mirrors[$i][$id]);
            }
            $cursors[$i] = $d['rev'];
        };
        for ($round = 0; $round < 60; $round++) {
            $i = mt_rand(0, 2);
            [$p, $client] = $actors[$i];
            $extra = ['pres' => 0];
            if (mt_rand(0, 1) === 1) {
                $extra += ['seq' => ++$seq[$i], 'ops' => $ops()];
            }
            if ($round % 15 === 7) {
                $this->redis->remove('r:' . $b);
            }
            if ($round % 20 === 11) {
                $this->redis->remove('p:' . $b);
            }
            $apply($i, $this->sync($b, $p, $cursors[$i], $extra, null, $client));
        }
        foreach ($actors as $i => [$p, $client]) {
            do {
                $d = $this->sync($b, $p, $cursors[$i], ['pres' => 0], null, $client);
                $apply($i, $d);
            } while ($d['more'] ?? false);
            ksort($mirrors[$i]);
        }
        $snap = $this->snapshotItems($b);
        $this->assertNotEmpty($this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_changes WHERE board_id = ?', [$b])->fetchOne());
        foreach ($mirrors as $i => $m) {
            $this->assertSame($snap, $m, "mirror $i equals the snapshot");
        }
        // Parent invariant: every parent is a live frame.
        foreach ($snap as $it) {
            if ($it['parent'] !== null) {
                $this->assertSame('frame', $snap[$it['parent']]['t'] ?? null);
            }
        }
        $live = (int)$this->db->executeQuery('SELECT item_count FROM *PREFIX*knorke_boards WHERE id = ?', [$b])->fetchOne();
        $this->assertSame(count($snap), $live, 'item_count matches the live items');
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored, 'item_bytes matches the live items');
    }

    /** @return array{0: ?int, 1: list<string>} */
    private function apply(int $b, Principal $p, array $ops, ?array $presence = null, string $client = 'cIt'): array {
        return $this->sync->applyOps($p, $b, $client, $ops, self::nowMs(), $presence);
    }

    public function testItemBytesEqualTheLiveRowsAfterRandomBatches(): void {
        // T1: item_bytes is kept in the same lock as item_count and always
        // equals Σ strlen(data) + strlen(style) of the live rows.
        $b = $this->board();
        $p = $this->owner($b);
        mt_srand(815);
        $ids = array_map([self::class, 'ulid'], range(1, 15));
        $frames = [self::ulid(100), self::ulid(101)];
        $text = static fn (): string => str_repeat(mt_rand(0, 1) ? 'ä' : 'x', mt_rand(0, 300));
        for ($round = 0; $round < 120; $round++) {
            $ops = [];
            for ($k = 0, $n = mt_rand(1, 6); $k < $n; $k++) {
                $id = $ids[mt_rand(0, count($ids) - 1)];
                $f = $frames[mt_rand(0, 1)];
                $ops[] = match (mt_rand(0, 10)) {
                    0 => ['o' => 'put', 'id' => $id, 't' => 'sticky', 'p' => self::sticky(['data' => ['text' => $text(), 'extra' => ['n' => mt_rand(0, 9)]]])],
                    1 => ['o' => 'patch', 'id' => $id, 'p' => ['data.text' => $text()]],
                    2 => ['o' => 'patch', 'id' => $id, 'p' => ['data.extra.n' => mt_rand(0, 2) ? mt_rand(0, 99999) : null, 'data.v' => mt_rand(0, 1) ? 1 : 1.0]],
                    3 => ['o' => 'patch', 'id' => $id, 'p' => ['style.fill' => sprintf('#%06x', mt_rand(0, 0xffffff)), 'style.fontSize' => mt_rand(8, 200)]],
                    4 => ['o' => 'patch', 'id' => $id, 'p' => ['x' => mt_rand(0, 50), 'y' => mt_rand(0, 50), 'parent' => mt_rand(0, 1) ? $f : null]],
                    5 => ['o' => 'remove', 'id' => $id],
                    6 => ['o' => 'put', 'id' => $id, 't' => 'sticky', 'p' => self::sticky(['data' => ['text' => $text()]]), 'revive' => true],
                    7 => ['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => mt_rand(0, 3000), 'y' => 0, 'w' => 800, 'h' => 600, 'z' => 'hz', 'data' => ['title' => 'F' . mt_rand(0, 9)]], 'revive' => true],
                    8 => ['o' => 'patch', 'id' => $f, 'p' => ['data.title' => str_repeat('T', mt_rand(0, 200))]],
                    9 => ['o' => 'remove', 'id' => $f],
                    default => ['o' => 'patch', 'id' => $id, 'p' => ['data.extra' => null, 'data.text' => '']],
                };
            }
            $this->apply($b, $p, $ops);
            [$stored, $sum] = $this->bytes($b);
            $this->assertSame($sum, $stored, "round $round: item_bytes = live rows");
        }
        $this->assertGreaterThan(0, $this->bytes($b)[0]);
        $snap = $this->snapshotItems($b);
        $this->assertSame(count($snap), $this->itemCount($b));
    }

    public function testFullBoardFrameRemovalStaysWithinMemory(): void {
        // T1: a board filled to the byte budget with ~6 KB of generic data per
        // item, all children of one frame. Removing the frame puts every child
        // into ONE rev; the writer, the sync of that rev and the snapshot stay
        // far below PHP's memory limit.
        $b = $this->board();
        $p = $this->owner($b);
        $f = self::ulid(1);
        $this->assertSame(['ok'], $this->apply($b, $p, [['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 1000, 'y' => 500, 'w' => 800, 'h' => 600, 'z' => 'hz']]])[1]);
        $n = 0;
        $limited = false;
        while (!$limited && $n < 5000) {
            $ops = [];
            for ($k = 0; $k < 200; $k++, $n++) {
                $ops[] = ['o' => 'put', 'id' => self::ulid(10 + $n), 't' => 'sticky',
                    'p' => self::sticky(['x' => $n % 50, 'y' => intdiv($n, 50), 'parent' => $f, 'data' => ['text' => '', 'blob' => str_repeat(chr(97 + $n % 26), 6000)]])];
            }
            $limited = in_array('limit', $this->apply($b, $p, $ops)[1], true);
        }
        $this->assertTrue($limited, 'the byte budget stops the fill');
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
        $this->assertLessThanOrEqual(Limits::DEFAULT_MAX_BOARD_BYTES, $stored);
        $this->assertGreaterThan(Limits::DEFAULT_MAX_BOARD_BYTES - 6100, $stored, 'filled to the budget');
        $children = $this->itemCount($b) - 1;
        $this->assertGreaterThan(Limits::PAGE, $children, 'more children than a page');

        $t0 = microtime(true);
        [$rev, $res] = $this->apply($b, $p, [['o' => 'remove', 'id' => $f]]);
        $this->assertSame(['ok'], $res);
        $removeMs = (microtime(true) - $t0) * 1000;

        gc_collect_cycles();
        $base = memory_get_usage();
        memory_reset_peak_usage();
        $json = $this->sync->sync(new AccessResult($p, null, 0), $b, SyncRequest::fromBody(['proto' => Application::PROTOCOL, 'client' => 'cIt', 'since' => $rev - 1, 'pres' => 0, 'ep' => Server::get(Epoch::class)->current()]), self::nowMs());
        $syncPeak = memory_get_peak_usage() - $base;
        $d = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame([$rev, $children, [$f], false], [$d['rev'], count($d['items']), $d['removed'], $d['more'] ?? false], 'the whole rev in one page');
        $this->assertNull($d['items'][0]['parent']);
        unset($json, $d);

        gc_collect_cycles();
        $base = memory_get_usage();
        memory_reset_peak_usage();
        $json = $this->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'title' => 'IT', 'role' => 'owner']);
        $snapPeak = memory_get_peak_usage() - $base;
        $this->assertCount($children, json_decode($json, true, 512, JSON_THROW_ON_ERROR)['items']);
        fwrite(STDERR, sprintf("\n[T1] %d children, %d bytes: remove(F) %.0f ms, sync peak +%.1f MiB, snapshot peak +%.1f MiB (answer %.1f MiB)\n",
            $children, $stored, $removeMs, $syncPeak / 1048576, $snapPeak / 1048576, strlen($json) / 1048576));
        $this->assertLessThan(128 * 1048576, $syncPeak);
        $this->assertLessThan(128 * 1048576, $snapPeak);
        $this->assertLessThan(2.5 * strlen($json), $snapPeak, 'built once while streaming (string growth ≤ 2×), not rows + fragments + implode (≈ 3×)');
    }

    public function testBigFrameRemovalHoldsTheLockBriefly(): void {
        // T8: 4900 children, released with chunked multi-row statements.
        $b = $this->board();
        $p = $this->owner($b);
        $f = self::ulid(1);
        $this->apply($b, $p, [['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 1000.5, 'y' => 500.25, 'w' => 800, 'h' => 600, 'z' => 'hz', 'data' => ['title' => 'Big']]]]);
        $pos = static fn (int $i): array => [($i % 70) * 10 + 0.1, intdiv($i, 70) * 10 + 0.3];
        for ($chunk = 0; $chunk < 25; $chunk++) {
            $ops = [];
            for ($k = 0; $k < 196; $k++) {
                $i = $chunk * 196 + $k;
                [$x, $y] = $pos($i);
                $ops[] = ['o' => 'put', 'id' => self::ulid(10 + $i), 't' => 'sticky', 'p' => self::sticky(['x' => $x, 'y' => $y, 'parent' => $f, 'data' => ['text' => "c$i"]])];
            }
            $this->assertSame(array_fill(0, 196, 'ok'), $this->apply($b, $p, $ops)[1]);
        }
        $this->assertSame(4901, $this->itemCount($b));
        [$bytesBefore] = $this->bytes($b);
        $frameBytes = strlen('{"title":"Big"}') + strlen('{}');
        $c0 = self::ulid(10);

        $t0 = microtime(true);
        [$rev, $res] = $this->apply($b, $p, [['o' => 'patch', 'id' => $c0, 'p' => ['data.text' => 'merged']], ['o' => 'remove', 'id' => $f]]);
        $ms = (microtime(true) - $t0) * 1000;
        fwrite(STDERR, sprintf("\n[T8] remove(F) with 4900 children (+ one merged text patch): %.0f ms under the board lock\n", $ms));
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertLessThan(1000, $ms, 'board row lock held < 1 s');

        $items = [];
        foreach ($this->db->executeQuery('SELECT id, x, y, parent_id, rev FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0', [$b])->fetchAllAssociative() as $r) {
            $items[$r['id']] = $r;
        }
        $changes = [];
        foreach ($this->db->executeQuery('SELECT item_id, op, patch FROM *PREFIX*knorke_changes WHERE board_id = ? AND rev = ?', [$b, $rev])->fetchAllAssociative() as $r) {
            $this->assertArrayNotHasKey($r['item_id'], $changes, 'one change row per item');
            $changes[$r['item_id']] = $r;
        }
        $this->assertCount(4901, $changes);
        $this->assertSame(['remove', null], [$changes[$f]['op'], $changes[$f]['patch']]);
        for ($i = 0; $i < 4900; $i++) {
            $id = self::ulid(10 + $i);
            [$x, $y] = $pos($i);
            $r = $items[$id];
            $this->assertSame([null, 1000.5 + $x, 500.25 + $y, $rev], [$r['parent_id'], (float)$r['x'], (float)$r['y'], (int)$r['rev']], "child $i released at its absolute position");
            $patch = json_decode($changes[$id]['patch'], true);
            $this->assertSame('patch', $changes[$id]['op']);
            $this->assertSame($i === 0 ? ['data.text', 'x', 'y', 'parent'] : ['x', 'y', 'parent'], array_keys($patch), 'exactly the effective paths');
            $this->assertSame([1000.5 + $x, 500.25 + $y, null], [$patch['x'], $patch['y'], $patch['parent']], 'change row = item row');
        }
        $this->assertSame(4900, $this->itemCount($b), 'only the frame left the count');
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
        $this->assertSame($bytesBefore - $frameBytes + strlen('merged') - strlen('c0'), $stored, 'only the frame and the merged text changed the bytes');
    }

    public function testStoredStateAlwaysRevives(): void {
        // T10: whatever patches built, remove + put revive of the stored
        // state (undo of delete) answers ok.
        $b = $this->board();
        $p = $this->owner($b);
        mt_srand(4242);
        $ids = array_map([self::class, 'ulid'], range(1, 4));
        $this->apply($b, $p, array_map(static fn (string $id): array => ['o' => 'put', 'id' => $id, 't' => 'sticky', 'p' => self::sticky(['data' => ['text' => 'keep ' . $id]])], $ids));
        $value = function (int $depth) use (&$value): mixed {
            if ($depth <= 0 || mt_rand(0, 3) === 0) {
                return mt_rand(0, 1) ? 'v' . mt_rand(0, 99) : mt_rand(-5, 5);
            }
            if (mt_rand(0, 4) === 0) {
                return [mt_rand(0, 9), 'w'];
            }
            $m = [];
            for ($i = 0, $n = mt_rand(1, 3); $i < $n; $i++) {
                $m['n' . $i] = $value($depth - 1);
            }
            return $m;
        };
        $codes = [];
        for ($round = 0; $round < 80; $round++) {
            $ops = [];
            for ($k = 0, $n = mt_rand(1, 3); $k < $n; $k++) {
                $patch = [];
                for ($j = 0, $m = mt_rand(1, 50); $j < $m; $j++) {
                    $keys = ['k' . mt_rand(0, 130)];
                    for ($d = 0, $extra = mt_rand(0, 3); $d < $extra; $d++) {
                        $keys[] = chr(97 + mt_rand(0, 2));
                    }
                    $patch[(mt_rand(0, 3) ? 'data.' : 'style.') . implode('.', $keys)] = $value(mt_rand(0, 7));
                }
                $ops[] = ['o' => 'patch', 'id' => $ids[mt_rand(0, 3)], 'p' => $patch];
            }
            foreach ($this->apply($b, $p, $ops)[1] as $c) {
                $codes[$c] = ($codes[$c] ?? 0) + 1;
            }
        }
        $this->assertGreaterThan(0, $codes['ok'] ?? 0, json_encode($codes));
        foreach ($this->snapshotItems($b) as $id => $item) {
            $put = $item;
            unset($put['id'], $put['t']);
            $res = $this->apply($b, $p, [['o' => 'remove', 'id' => $id], ['o' => 'put', 'id' => $id, 't' => $item['t'], 'p' => $put, 'revive' => true]])[1];
            $this->assertSame(['ok', 'ok'], $res, "undo of delete of $id (" . count($item['data']) . ' data keys)');
            $this->assertSame($item, $this->snapshotItems($b)[$id], 'restored exactly');
        }
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
    }

    public function testLeaseTakeOverBetweenPresenceAndLock(): void {
        // T7: alice's request read presence (alice holds) before bob's
        // take-over and text committed; under the lock it must see bob.
        $b = $this->board();
        $alice = $this->owner($b);
        $bob = $this->guest($b);
        $n = self::ulid(1);
        $this->sync($b, $alice, 0, ['seq' => 1, 'ops' => [['o' => 'put', 'id' => $n, 't' => 'sticky', 'p' => self::sticky()]], 'me' => ['e' => $n]], null, 'cA');
        $stale = $this->presence->read($b, self::nowMs());
        $this->assertSame($alice->pid, \OCA\Knorke\Service\PresenceStore::leaseHolder($stale, $n, self::nowMs()));
        $d = $this->sync($b, $bob, 1, ['seq' => 1, 'me' => ['e' => $n, 'tk' => 1], 'ops' => [['o' => 'patch', 'id' => $n, 'p' => ['data.text' => 'B-took-over']]]], null, 'cB');
        $this->assertSame(['ok'], $d['acks']['res']);
        $res = $this->apply($b, $alice, [['o' => 'patch', 'id' => $n, 'p' => ['data.text' => 'A-late']], ['o' => 'patch', 'id' => $n, 'p' => ['style.fill' => '#000000']]], $stale, 'cA')[1];
        $this->assertSame(['locked', 'ok'], $res);
        $this->assertSame(['B-took-over', '#000000'], [$this->snapshotItems($b)[$n]['data']['text'], $this->snapshotItems($b)[$n]['style']['fill']]);
    }

    public function testJsonBodyAgainstARealRequest(): void {
        $file = tempnam(sys_get_temp_dir(), 'knorke-it');
        try {
            $body = '{"proto":1,"id":8}';
            file_put_contents($file, $body);
            $request = new Request([
                'urlParams' => ['id' => '7', '_route' => 'knorke.sync.sync'],
                'server' => ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string)strlen($body), 'REQUEST_METHOD' => 'POST'],
                'method' => 'POST',
            ], Server::get(IRequestId::class), self::config(), null, $file);
            try {
                JsonBody::read($request, ['proto']);
                $this->fail('body id overrides the route → 400');
            } catch (HttpError $e) {
                $this->assertSame([400, 'bad_request'], [$e->status, $e->error]);
            }
            $this->assertSame(8, $request->getParam('id'), 'Nextcloud really lets the body win');

            $body = '{"proto":1,"client":"c1"}';
            file_put_contents($file, $body);
            $ok = new Request([
                'urlParams' => ['id' => '7', '_route' => 'knorke.sync.sync'],
                'server' => ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string)strlen($body), 'REQUEST_METHOD' => 'POST'],
                'method' => 'POST',
            ], Server::get(IRequestId::class), self::config(), null, $file);
            $this->assertSame(['proto' => 1, 'client' => 'c1'], JsonBody::read($ok, ['proto', 'client']));

            file_put_contents($file, '{"proto":');
            $broken = new Request(['server' => ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => '9'], 'method' => 'POST'], Server::get(IRequestId::class), self::config(), null, $file);
            try {
                JsonBody::read($broken, ['proto']);
                $this->fail('broken JSON → 400');
            } catch (HttpError $e) {
                $this->assertSame([400, 'bad_request'], [$e->status, $e->error]);
            }
        } finally {
            unlink($file);
        }
    }

    /**
     * M2 data foundation, followed up by job 026 (group items): a put with
     * a group (a ULID) and a patch of the path `group` are written to
     * group_id; an invalid group and a put with a lock are bad, the other
     * ops of the batch are written; the lock columns stay NULL, and other
     * spellings of the columns are unknown keys.
     */
    public function testGroupOrLockPutIsBadAndNothingWritesTheColumns(): void {
        $b = $this->board();
        $p = $this->owner($b);
        $g = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';
        [$a, $s, $l, $x] = [self::ulid(1), self::ulid(2), self::ulid(3), self::ulid(4)];
        $d = $this->sync($b, $p, 0, ['seq' => 1, 'ops' => [
            ['o' => 'put', 'id' => $a, 't' => 'sticky', 'p' => self::sticky(['group' => $g])],
            ['o' => 'put', 'id' => $s, 't' => 'sticky', 'p' => self::sticky(['group' => null, 'lock' => null, 'locked' => 1, 'locked_by' => 'u:' . $this->uid, 'group_id' => 'X'])],
            ['o' => 'put', 'id' => $l, 't' => 'sticky', 'p' => self::sticky(['lock' => ['by' => 'x', 'name' => 'y']])],
            ['o' => 'patch', 'id' => $s, 'p' => ['group' => $g]],
            ['o' => 'put', 'id' => $x, 't' => 'sticky', 'p' => self::sticky(['group' => strtolower($g)])],
        ]]);
        $this->assertSame(['seq' => 1, 'rev' => 1, 'res' => ['ok', 'ok', 'bad', 'ok', 'bad']], $d['acks']);
        $this->assertSame([[$a, $g, null], [$s, $g, null]], array_map(static fn (array $it): array => [$it['id'], $it['group'], $it['lock']], $d['items']));
        $count = fn (string $where): int => (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_items WHERE board_id = ? AND ' . $where, [$b])->fetchOne();
        $this->assertSame(2, $count('1 = 1'), 'only A and S were written');
        $this->assertSame(2, $count("group_id = '$g' AND locked IS NULL AND locked_by IS NULL AND locked_name IS NULL"), self::dbKind() . ': group_id written, the lock columns stay NULL');
        $this->assertSame([$a, $s], array_keys($this->snapshotItems($b)));
    }
}
