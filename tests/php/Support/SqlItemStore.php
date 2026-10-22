<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\ItemStore;

/**
 * ItemStore whose query-builder reads (loadItems, liveChildren,
 * groupMembers, boundConnectors, the two block-boundary SELECTs of the purge
 * and the changes cap, SPEC-M1 §4.13.7, and the per-rev byte sums of the
 * byte cap, P7) are the same SELECTs in raw SQL, for SqliteDb.
 */
final class SqlItemStore extends ItemStore {
    private const LOAD = 'id, type, parent_id, z, x, y, w, h, rotation, data, style, version, deleted, rev, group_id, locked, locked_by, locked_name';
    private const PARTIAL = 'id, type, parent_id, x, y, deleted, rev, group_id';

    public function loadItems(int $board, array $ids): array {
        return $this->keyed('SELECT ' . self::LOAD . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND id IN (%s) ORDER BY id', $board, $ids);
    }

    public function liveChildren(int $board, array $parentIds): array {
        return $this->keyed('SELECT ' . self::PARTIAL . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND parent_id IN (%s) AND deleted = 0 ORDER BY id', $board, $parentIds);
    }

    public function groupMembers(int $board, array $groupIds): array {
        return $this->keyed('SELECT ' . self::PARTIAL . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND group_id IN (%s) AND deleted = 0 ORDER BY id', $board, $groupIds);
    }

    public function boundConnectors(int $board, array $itemIds): array {
        if ($itemIds === []) {
            return [];
        }
        $marks = implode(', ', array_fill(0, count($itemIds), '?'));
        $out = [];
        foreach ($this->rows('SELECT ' . self::LOAD . " FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0 AND type = 'connector'"
            . " AND (start_item IN ($marks) OR end_item IN ($marks)) ORDER BY id", [$board, ...array_values($itemIds), ...array_values($itemIds)], []) as $r) {
            $out[(string)$r['id']] = $r;
        }
        return $out;
    }

    protected function nthTombstoneRev(int $board, ?int $maxRev, int $offset): ?int {
        $row = $this->rows('SELECT rev FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 1' . ($maxRev === null ? '' : ' AND rev <= ?')
            . ' ORDER BY rev ASC LIMIT 1 OFFSET ' . max(0, $offset), $maxRev === null ? [$board] : [$board, $maxRev], [])[0] ?? null;
        return $row === null ? null : (int)$row['rev'];
    }

    protected function nthChangeRev(int $board, bool $newestFirst, ?int $belowRev, ?int $tsBefore, int $offset): ?int {
        $sql = 'SELECT rev FROM *PREFIX*knorke_changes WHERE board_id = ?';
        $params = [$board];
        if ($belowRev !== null) {
            $sql .= ' AND rev < ?';
            $params[] = $belowRev;
        }
        if ($tsBefore !== null) {
            $sql .= ' AND ts < ?';
            $params[] = $tsBefore;
        }
        $row = $this->rows($sql . ' ORDER BY rev ' . ($newestFirst ? 'DESC' : 'ASC') . ' LIMIT 1 OFFSET ' . max(0, $offset), $params, [])[0] ?? null;
        return $row === null ? null : (int)$row['rev'];
    }

    /** changesBytesBoundary's block read (P7): the same GROUP BY with SQLite's octet length. */
    protected function changeRevBytes(int $board, ?int $belowRev, int $limit): array {
        $sql = 'SELECT rev, SUM(LENGTH(CAST(patch AS BLOB))) AS nbytes FROM *PREFIX*knorke_changes WHERE board_id = ?';
        $params = [$board];
        if ($belowRev !== null) {
            $sql .= ' AND rev < ?';
            $params[] = $belowRev;
        }
        return array_map(static fn (array $r): array => [(int)$r['rev'], (int)($r['nbytes'] ?? 0)],
            $this->rows($sql . ' GROUP BY rev ORDER BY rev DESC LIMIT ' . max(1, $limit), $params, []));
    }

    /** @return array<string, array> */
    private function keyed(string $sql, int $board, array $ids): array {
        if ($ids === []) {
            return [];
        }
        $out = [];
        foreach ($this->rows(sprintf($sql, implode(', ', array_fill(0, count($ids), '?'))), [$board, ...array_values($ids)], []) as $r) {
            $out[(string)$r['id']] = $r;
        }
        return $out;
    }
}
