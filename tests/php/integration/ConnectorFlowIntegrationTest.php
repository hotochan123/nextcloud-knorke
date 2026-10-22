<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Connectors;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Tests\Support\IntegrationCase;

/**
 * Stage-1 write path on the real database (SPEC-M1 §4.7 rules 12–15,
 * §4.13.2; any KD_DB kind): connector ends under the lock, the derived
 * columns start_item/end_item, the release of bound connectors through the
 * indexes knorke_items_start/_end, keep — with the timing gates of WP-B1
 * (§9.2): releasing 300 connectors of one item in one batch < 500 ms under
 * the board lock, keep with 600 children < 1 s.
 */
final class ConnectorFlowIntegrationTest extends IntegrationCase {
    private function apply(int $b, Principal $p, array $ops): array {
        return $this->sync->applyOps($p, $b, 'cIt', $ops, self::nowMs(), null);
    }

    private static function sticky(array $p = []): array {
        return $p + ['x' => 100, 'y' => 40, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null, 'data' => ['text' => 'S'], 'style' => ['fill' => '#a8d8f8']];
    }

    private static function connector(array $start, array $end, string $z = 'i2'): array {
        return ['z' => $z, 'data' => ['start' => $start, 'end' => $end, 'route' => 'elbow'], 'style' => ['stroke' => '#1a1a1a', 'strokeWidth' => 2, 'endCap' => 'arrow']];
    }

    /** id → [type, data (decoded), start_item, end_item, deleted, rev, parent_id, x, y] straight from the table. */
    private function rows(int $b): array {
        $out = [];
        $res = $this->db->executeQuery('SELECT id, type, data, start_item, end_item, deleted, rev, parent_id, x, y FROM *PREFIX*knorke_items WHERE board_id = ?', [$b]);
        while (($r = $res->fetchAssociative()) !== false) {
            $out[$r['id']] = [$r['type'], json_decode((string)$r['data'], true), $r['start_item'], $r['end_item'], (int)$r['deleted'], (int)$r['rev'], $r['parent_id'], (float)$r['x'], (float)$r['y']];
        }
        $res->closeCursor();
        return $out;
    }

    /** item id → list of [op, patch] of the change rows at $rev. */
    private function changesAt(int $b, int $rev): array {
        $out = [];
        $res = $this->db->executeQuery('SELECT item_id, op, patch FROM *PREFIX*knorke_changes WHERE board_id = ? AND rev = ?', [$b, $rev]);
        while (($r = $res->fetchAssociative()) !== false) {
            $out[$r['item_id']][] = [$r['op'], $r['patch']];
        }
        $res->closeCursor();
        return $out;
    }

    public function testEndsDerivedColumnsAndRuleFourteen(): void {
        $b = $this->board();
        $p = $this->owner($b);
        [$s, $t, $f, $k] = [self::ulid(1), self::ulid(2), self::ulid(3), self::ulid(4)];
        $this->assertSame(['ok', 'ok', 'ok', 'ok'], $this->apply($b, $p, [
            ['o' => 'put', 'id' => $s, 't' => 'sticky', 'p' => self::sticky()],
            ['o' => 'put', 'id' => $t, 't' => 'shape', 'p' => ['x' => 600, 'y' => 40, 'w' => 200, 'h' => 120, 'z' => 'i3', 'data' => ['kind' => 'ellipse']]],
            ['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 2000, 'y' => 0, 'w' => 800, 'h' => 600, 'z' => 'hz']],
            ['o' => 'put', 'id' => $k, 't' => 'connector', 'p' => self::connector(['item' => $s, 'ax' => 1, 'ay' => 0.5], ['item' => $t])],
        ])[1]);
        $rows = $this->rows($b);
        $this->assertSame(['connector', $s, $t, null, 0.0, 0.0], [$rows[$k][0], $rows[$k][2], $rows[$k][3], $rows[$k][6], $rows[$k][7], $rows[$k][8]], 'derived columns; placement none');
        $this->assertSame([null, null], [$rows[$s][2], $rows[$s][3]], 'other types: NULL');
        $this->assertSame(['bad', 'bad', 'bad', 'bad'], $this->apply($b, $p, [
            ['o' => 'patch', 'id' => $k, 'p' => ['data.end' => ['item' => $f]]],
            ['o' => 'patch', 'id' => $k, 'p' => ['data.end' => ['item' => $k]]],
            ['o' => 'patch', 'id' => $k, 'p' => ['data.end.item' => $s]],
            ['o' => 'patch', 'id' => $k, 'p' => ['x' => 5, 'y' => 0, 'parent' => null]],
        ])[1]);
        // The target goes; the end at it becomes the anchor point (golden formula, auto = centre).
        $this->assertSame(['ok'], $this->apply($b, $p, [['o' => 'remove', 'id' => $t]])[1]);
        $rows = $this->rows($b);
        $this->assertSame([['x' => 700.0, 'y' => 100.0], $s, null], [$rows[$k][1]['end'], $rows[$k][2], $rows[$k][3]]);
        // An end sent at the tombstone: ok, free point.
        $this->assertSame(['ok'], $this->apply($b, $p, [['o' => 'patch', 'id' => $k, 'p' => ['data.start' => ['item' => $t, 'ax' => 0, 'ay' => 0]]]])[1]);
        $rows = $this->rows($b);
        $this->assertSame([['x' => 600.0, 'y' => 40.0], null, null], [$rows[$k][1]['start'], $rows[$k][2], $rows[$k][3]]);
        $this->assertSame(['ok'], $this->apply($b, $p, [['o' => 'patch', 'id' => $k, 'p' => ['data.start' => ['item' => $s], 'data.end' => ['item' => $s, 'ax' => 0.123456, 'ay' => 1]]]])[1]);
        $rows = $this->rows($b);
        $this->assertSame([['item' => $s, 'ax' => 0.1235, 'ay' => 1.0], $s, $s], [$rows[$k][1]['end'], $rows[$k][2], $rows[$k][3]]);
        // The snapshot carries the connector like every item (position 0).
        $snap = json_decode($this->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => 'owner']), true, 512, JSON_THROW_ON_ERROR);
        $item = array_values(array_filter($snap['items'], static fn (array $i): bool => $i['id'] === $k))[0];
        $this->assertSame(['connector', 0.0, 0.0, 0.0, 0.0, 0.0, null, ['item' => $s]], [$item['t'], $item['x'], $item['y'], $item['w'], $item['h'], $item['r'], $item['parent'], $item['data']['start']]);
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
    }

    public function testReleaseOfThreeHundredConnectorsHoldsTheLockBriefly(): void {
        // WP-B1 gate: one item with 300 bound connectors removed in one batch:
        // < 500 ms under the board lock, every end a free point, ONE change
        // row per connector, start_item/end_item follow.
        $b = $this->board();
        $p = $this->owner($b);
        $e = self::ulid(1);
        $o = self::ulid(2);
        $this->apply($b, $p, [['o' => 'put', 'id' => $e, 't' => 'sticky', 'p' => self::sticky(['x' => 100.25, 'y' => 40.5])], ['o' => 'put', 'id' => $o, 't' => 'sticky', 'p' => self::sticky(['x' => 3000])]]);
        $ids = [];
        for ($chunk = 0; $chunk < 2; $chunk++) {
            $ops = [];
            for ($k = 0; $k < 150; $k++) {
                $i = $chunk * 150 + $k;
                $id = self::ulid(100 + $i);
                $ids[] = $id;
                // Half bound at the start (anchor), half at the end (auto); the other end at $o or free.
                $ops[] = ['o' => 'put', 'id' => $id, 't' => 'connector', 'p' => $i % 2 === 0
                    ? self::connector(['item' => $e, 'ax' => ($i % 11) / 10, 'ay' => ($i % 7) / 6], ['item' => $o])
                    : self::connector(['x' => $i, 'y' => -$i], ['item' => $e])];
            }
            $this->assertSame(array_fill(0, 150, 'ok'), $this->apply($b, $p, $ops)[1]);
        }
        $merged = $ids[3];
        $count = (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_items WHERE board_id = ? AND (start_item = ? OR end_item = ?)', [$b, $e, $e])->fetchOne();
        $this->assertSame(300, $count, 'all 300 bound through the derived columns');

        $t0 = microtime(true);
        [$rev, $res] = $this->apply($b, $p, [['o' => 'patch', 'id' => $merged, 'p' => ['data.label' => 'merged']], ['o' => 'remove', 'id' => $e]]);
        $ms = (microtime(true) - $t0) * 1000;
        fwrite(STDERR, sprintf("\n[WP-B1] remove(E) releasing 300 bound connectors (+ one merged label patch): %.0f ms under the board lock (%s)\n", $ms, self::dbKind()));
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertLessThan(500, $ms, 'board row lock held < 500 ms');

        $rows = $this->rows($b);
        $changes = $this->changesAt($b, $rev);
        $this->assertSame([['remove', null]], $changes[$e]);
        foreach ($ids as $i => $id) {
            $this->assertCount(1, $changes[$id] ?? [], "one change row for connector $i");
            $patch = json_decode($changes[$id][0][1], true);
            if ($i % 2 === 0) {
                $ep = Connectors::endpoint(['item' => $e, 'ax' => ($i % 11) / 10, 'ay' => ($i % 7) / 6]);
                [$x, $y] = Connectors::anchorPoint(['x' => 100.25, 'y' => 40.5, 'w' => 200, 'h' => 200, 'r' => 0], null, $ep);
                $this->assertSame([null, $o], [$rows[$id][2], $rows[$id][3]], "connector $i: start released");
                $this->assertSame(['x' => $x, 'y' => $y], $rows[$id][1]['start'], "connector $i: anchor point (exact, r = 0)");
                $this->assertSame(['data.start'], array_keys($patch));
                $this->assertSame($rows[$id][1]['start'], $patch['data.start'], 'change row = item row');
            } else {
                $this->assertSame([null, null], [$rows[$id][2], $rows[$id][3]], "connector $i: end released");
                $this->assertSame(['x' => 200.25, 'y' => 140.5], $rows[$id][1]['end'], 'auto end → centre');
                $this->assertSame($id === $merged ? ['data.label', 'data.end'] : ['data.end'], array_keys($patch));
            }
            $this->assertSame($rev, $rows[$id][5]);
        }
        $this->assertSame('merged', $rows[$merged][1]['label']);
        $this->assertSame(0, (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0 AND (start_item = ? OR end_item = ?)', [$b, $e, $e])->fetchOne());
        $this->assertSame(301, $this->itemCount($b));
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored, 'item_bytes follows the real size change of the released connectors');
    }

    public function testKeepWithSixHundredChildrenStaysUnderOneSecond(): void {
        // WP-B1 gate: a keep patch on a frame with 600 children < 1 s, every
        // child at its old absolute position with ONE change row {x, y, parent}.
        $b = $this->board();
        $p = $this->owner($b);
        $f = self::ulid(1);
        $this->apply($b, $p, [['o' => 'put', 'id' => $f, 't' => 'frame', 'p' => ['x' => 1000.5, 'y' => 500.25, 'w' => 4000, 'h' => 4000, 'z' => 'hz', 'data' => ['title' => 'Keep']]]]);
        $pos = static fn (int $i): array => [($i % 30) * 120 + 0.1, intdiv($i, 30) * 120 + 0.3];
        for ($chunk = 0; $chunk < 3; $chunk++) {
            $ops = [];
            for ($k = 0; $k < 200; $k++) {
                $i = $chunk * 200 + $k;
                [$x, $y] = $pos($i);
                $ops[] = ['o' => 'put', 'id' => self::ulid(10 + $i), 't' => $i % 3 === 0 ? 'shape' : 'sticky',
                    'p' => self::sticky(['x' => $x, 'y' => $y, 'parent' => $f, 'data' => $i % 3 === 0 ? ['kind' => 'diamond'] : ['text' => "c$i"]])];
            }
            $this->assertSame(array_fill(0, 200, 'ok'), $this->apply($b, $p, $ops)[1]);
        }
        $c0 = self::ulid(10);
        $t0 = microtime(true);
        [$rev, $res] = $this->apply($b, $p, [
            ['o' => 'patch', 'id' => $f, 'p' => ['x' => 900.5, 'y' => 450.25, 'parent' => null, 'w' => 4100, 'h' => 4050], 'keep' => true],
            ['o' => 'patch', 'id' => $c0, 'p' => ['data.text' => 'merged']],
        ]);
        $ms = (microtime(true) - $t0) * 1000;
        fwrite(STDERR, sprintf("\n[WP-B1] keep patch on a frame with 600 children (+ one merged text patch): %.0f ms under the board lock (%s)\n", $ms, self::dbKind()));
        $this->assertSame(['ok', 'ok'], $res);
        $this->assertLessThan(1000, $ms, 'keep with 600 children < 1 s');

        $rows = $this->rows($b);
        $changes = $this->changesAt($b, $rev);
        $this->assertCount(601, $changes, 'the frame and every child, one row each');
        for ($i = 0; $i < 600; $i++) {
            $id = self::ulid(10 + $i);
            [$x, $y] = $pos($i);
            $this->assertSame($f, $rows[$id][6], "child $i stays a child");
            $this->assertEqualsWithDelta(1000.5 + $x, 900.5 + $rows[$id][7], 1e-9, "child $i: absolute x unchanged");
            $this->assertEqualsWithDelta(500.25 + $y, 450.25 + $rows[$id][8], 1e-9, "child $i: absolute y unchanged");
            $this->assertCount(1, $changes[$id], "child $i: one change row");
            $patch = json_decode($changes[$id][0][1], true);
            $this->assertSame($i === 0 ? ['x', 'y', 'parent', 'data.text'] : ['x', 'y', 'parent'], array_keys($patch), 'the whole placement group (paths in op order: the shift, then the text)');
            $this->assertSame([$rows[$id][7], $rows[$id][8], $f], [$patch['x'], $patch['y'], $patch['parent']], 'change row = item row');
        }
        $this->assertSame(601, $this->itemCount($b));
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
    }

    public function testKeepWithReparentedChildrenStoresTheNewParent(): void {
        // Rule 15 (R9) + rule 2a on the real database (finding K3, contract
        // C58 sub-case QK): in one batch the keep patch of Q shifts its
        // children; a LATER op moves K into Q2 and an EARLIER op moved A
        // from the root into Q. parent_id of both rows equals their one
        // change row (the multi-row shiftChildren write covers only children
        // still in their stored parent), the snapshot agrees, and removing
        // Q2 releases K to the root (rule 6).
        $b = $this->board();
        $p = $this->owner($b);
        [$q, $q2, $k, $c, $a] = [self::ulid(1), self::ulid(2), self::ulid(3), self::ulid(4), self::ulid(5)];
        $this->assertSame(['ok', 'ok', 'ok', 'ok', 'ok'], $this->apply($b, $p, [
            ['o' => 'put', 'id' => $q, 't' => 'frame', 'p' => ['x' => 12000, 'y' => 0, 'w' => 800, 'h' => 600, 'z' => 'hz', 'data' => ['title' => 'Q']]],
            ['o' => 'put', 'id' => $q2, 't' => 'frame', 'p' => ['x' => 14000, 'y' => 100, 'w' => 800, 'h' => 600, 'z' => 'hy', 'data' => ['title' => 'Q2']]],
            ['o' => 'put', 'id' => $k, 't' => 'sticky', 'p' => self::sticky(['x' => 10, 'y' => 20, 'parent' => $q])],
            ['o' => 'put', 'id' => $c, 't' => 'sticky', 'p' => self::sticky(['x' => 30, 'y' => 40, 'parent' => $q])],
            ['o' => 'put', 'id' => $a, 't' => 'sticky', 'p' => self::sticky(['x' => 5000, 'y' => 5000])],
        ])[1]);
        [$rev, $res] = $this->apply($b, $p, [
            ['o' => 'patch', 'id' => $a, 'p' => ['x' => 70, 'y' => 80, 'parent' => $q]],
            ['o' => 'patch', 'id' => $q, 'p' => ['x' => 11900, 'y' => -50, 'parent' => null, 'w' => 900, 'h' => 650], 'keep' => true],
            ['o' => 'patch', 'id' => $k, 'p' => ['x' => 50, 'y' => 60, 'parent' => $q2]],
        ]);
        $this->assertSame(['ok', 'ok', 'ok'], $res);
        $rows = $this->rows($b);
        $changes = $this->changesAt($b, $rev);
        $want = [$k => [$q2, 50.0, 60.0], $a => [$q, 170.0, 130.0], $c => [$q, 130.0, 90.0]];
        foreach ($want as $id => [$parent, $x, $y]) {
            $this->assertSame([$parent, $x, $y], [$rows[$id][6], $rows[$id][7], $rows[$id][8]], "stored placement of $id");
            $this->assertCount(1, $changes[$id], "$id: one change row");
            $this->assertSame(['patch', ['x' => $x, 'y' => $y, 'parent' => $parent]], [$changes[$id][0][0], json_decode($changes[$id][0][1], true)], "$id: change row = item row");
        }
        $snap = json_decode($this->sync->snapshotJson(new AccessResult($p, null, 0), $b, ['id' => $b, 'role' => 'owner']), true, 512, JSON_THROW_ON_ERROR);
        $byId = array_column($snap['items'], null, 'id');
        foreach ($want as $id => [$parent, $x, $y]) {
            $this->assertSame([$parent, $x, $y], [$byId[$id]['parent'], (float)$byId[$id]['x'], (float)$byId[$id]['y']], "snapshot of $id");
        }

        // Rule 6: removing Q2 releases K at Q2 + (50, 60); Q keeps C and A.
        [$rev, $res] = $this->apply($b, $p, [['o' => 'remove', 'id' => $q2]]);
        $this->assertSame(['ok'], $res);
        $rows = $this->rows($b);
        $changes = $this->changesAt($b, $rev);
        $this->assertSame([null, 14050.0, 160.0], [$rows[$k][6], $rows[$k][7], $rows[$k][8]], 'released to the root');
        $this->assertSame(['patch', ['x' => 14050.0, 'y' => 160.0, 'parent' => null]], [$changes[$k][0][0], json_decode($changes[$k][0][1], true)]);
        $written = array_map('strval', array_keys($changes));
        sort($written);
        $expect = [$q2, $k];
        sort($expect);
        $this->assertSame($expect, $written, 'only Q2 and K are written');
        $this->assertSame([$q, $q], [$rows[$c][6], $rows[$a][6]]);
        $this->assertSame(4, $this->itemCount($b));
        [$stored, $sum] = $this->bytes($b);
        $this->assertSame($sum, $stored);
    }
}
