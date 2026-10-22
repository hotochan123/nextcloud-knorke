<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\ItemStore;

/**
 * In-memory ItemStore that records every call into a shared log and keeps
 * transactions honest: begin() snapshots the state, rollBack() restores it.
 * It enforces the primary keys (items: board+id, changes: board+rev+item) —
 * a second change row for the same item and rev throws, like PostgreSQL.
 *
 * itemsSince() runs the REAL paging logic of ItemStore; only its two SELECTs
 * are answered from memory (rows() override), tombstones without payload like
 * the real CASE columns. liveChildren() and groupMembers() answer only the
 * columns the real ones select (id, type, parent_id, x, y, deleted, rev,
 * group_id). Rows carry the
 * derived connector columns start_item/end_item like the real table
 * (insertItem/reviveItem derive them through ItemStore::endItems,
 * updateItem/releaseConnectors write what they are given), and
 * boundConnectors() answers from exactly those columns, like the real index
 * query. The lock (M2, R20) lives in the columns locked, locked_by and
 * locked_name like in the real table (seedLock; updateItem writes them;
 * boardsLockedBy, clearLockerRows and lockers answer from them). The group
 * (M2, R20 Gruppieren) lives in group_id (seed with `group`; insertItem and
 * reviveItem write the put's, updateItem what it is given; a remove leaves
 * it); groupMembers() logs "groupMembers <ids>".
 */
class FakeItemStore extends ItemStore {
    /**
     * Board rows: the head (rev, min_rev, meta_rev), the counters and — for
     * SyncHarness::$boards (BoardStore::meta) — title and meta.
     *
     * @var array<int, array{rev: int, item_count: int, item_bytes: int, min_rev: int, meta_rev: int, title: string, meta: ?string}>
     */
    public array $boards = [];
    /** @var array<int, array<string, array>> board → id → row (DB shape: strings for JSON, floats for numbers) */
    public array $items = [];
    /** @var list<array{board: int, rev: int, item: string, op: string, patch: ?string, actor: string, client: string, ts: int}> */
    public array $changes = [];
    /**
     * Called inside itemsSince() after the page is read, with the board id —
     * e.g. a purge block that commits between the head and the page (SPEC-M1
     * §4.13.8 step 7, T4-05).
     *
     * @var (\Closure(int): void)|null
     */
    public ?\Closure $onItemsSince = null;
    private ?array $saved = null;

    /** @param list<string> $log shared call log */
    public function __construct(public array &$log) {
    }

    public function addBoard(int $id, int $rev = 0, int $minRev = 0, int $metaRev = 0, string $title = 'Board', ?string $meta = null): void {
        $this->boards[$id] = ['rev' => $rev, 'item_count' => 0, 'item_bytes' => 0, 'min_rev' => $minRev,
            'meta_rev' => $metaRev, 'title' => $title, 'meta' => $meta];
        $this->items[$id] ??= [];
    }

    /** A committed meta write (MetaService) as another request made it: rev + 1, meta_rev = rev. */
    public function metaWrite(int $board, ?string $title = null, ?string $meta = null): int {
        $b = &$this->boards[$board];
        $b['rev']++;
        $b['meta_rev'] = $b['rev'];
        $b['title'] = $title ?? $b['title'];
        $b['meta'] = $meta ?? $b['meta'];
        return $b['rev'];
    }

    /** Stores an item row directly (like a write that happened earlier). */
    public function seed(int $board, string $id, array $item, int $rev, bool $deleted = false): void {
        $this->items[$board][$id] = [
            'id' => $id, 'type' => $item['t'], 'parent_id' => $item['parent'] ?? null, 'z' => $item['z'] ?? 'i0',
            'x' => (float)($item['x'] ?? 0), 'y' => (float)($item['y'] ?? 0), 'w' => (float)($item['w'] ?? 200), 'h' => (float)($item['h'] ?? 200),
            'rotation' => (float)($item['r'] ?? 0),
            'data' => ItemStore::obj($item['data'] ?? []), 'style' => ItemStore::obj($item['style'] ?? []),
            'version' => 1, 'deleted' => $deleted ? 1 : 0, 'rev' => $rev, 'group_id' => $item['group'] ?? null,
        ];
        [$this->items[$board][$id]['start_item'], $this->items[$board][$id]['end_item']] = ItemStore::endItems($item + ['data' => []]);
        if (!$deleted) {
            $this->boards[$board]['item_count']++;
            $this->boards[$board]['item_bytes'] += $this->storedBytes($board, $id);
        }
        $this->boards[$board]['rev'] = max($this->boards[$board]['rev'], $rev);
    }

    /** A lock of an existing row (like a lock that happened earlier); $by null = locker unknown. */
    public function seedLock(int $board, string $id, ?string $by, ?string $name = null): void {
        $this->items[$board][$id]['locked'] = 1;
        $this->items[$board][$id]['locked_by'] = $by;
        $this->items[$board][$id]['locked_name'] = $name;
    }

    /** @return array{0: ?int, 1: ?string, 2: ?string} [locked, locked_by, locked_name] of a stored row */
    public function lockOf(int $board, string $id): array {
        $r = $this->items[$board][$id];
        return [$r['locked'] ?? null, $r['locked_by'] ?? null, $r['locked_name'] ?? null];
    }

    public function begin(): void {
        $this->saved = [$this->boards, $this->items, $this->changes];
    }

    public function commit(): void {
        $this->saved = null;
    }

    public function rollBack(): void {
        if ($this->saved !== null) {
            [$this->boards, $this->items, $this->changes] = $this->saved;
            $this->saved = null;
        }
    }

    /** Live item in wire form (decoded data/style) or null. */
    public function live(int $board, string $id): ?array {
        $r = $this->items[$board][$id] ?? null;
        if ($r === null || $r['deleted'] === 1) {
            return null;
        }
        return json_decode(ItemStore::itemJson($r), true);
    }

    /** strlen(data) + strlen(style) of a stored row. */
    public function storedBytes(int $board, string $id): int {
        $r = $this->items[$board][$id];
        return strlen((string)($r['data'] ?? '')) + strlen((string)($r['style'] ?? ''));
    }

    /** Σ storedBytes over the live rows: what item_bytes must equal. */
    public function liveBytes(int $board): int {
        $n = 0;
        foreach ($this->items[$board] ?? [] as $id => $r) {
            $n += $r['deleted'] === 0 ? $this->storedBytes($board, (string)$id) : 0;
        }
        return $n;
    }

    /** @return list<array> change rows of an item */
    public function changesOf(string $id): array {
        return array_values(array_filter($this->changes, static fn (array $c): bool => $c['item'] === $id));
    }

    public function lockAndBumpRev(int $board, int $nowMs): ?array {
        $this->log[] = 'lockAndBumpRev';
        if (!isset($this->boards[$board])) {
            return null;
        }
        $this->boards[$board]['rev']++;
        return $this->boards[$board];
    }

    public function addItemCount(int $board, int $delta, int $bytes = 0): void {
        $this->log[] = "addItemCount $delta $bytes";
        $this->boards[$board]['item_count'] += $delta;
        $this->boards[$board]['item_bytes'] += $bytes;
    }

    public function readRev(int $board): ?array {
        $this->log[] = 'readRev';
        return isset($this->boards[$board]) ? ['rev' => $this->boards[$board]['rev'], 'min_rev' => $this->boards[$board]['min_rev']] : null;
    }

    public function readHead(int $board): ?array {
        $this->log[] = 'readHead';
        $b = $this->boards[$board] ?? null;
        return $b === null ? null : ['rev' => $b['rev'], 'min_rev' => $b['min_rev'], 'meta_rev' => $b['meta_rev']];
    }

    public function snapshotItems(int $board, ?\Closure $pidOf = null): iterable {
        $this->log[] = 'snapshotItems';
        $rows = array_filter($this->items[$board] ?? [], static fn (array $r): bool => $r['deleted'] === 0);
        ksort($rows, SORT_STRING);
        return array_values(array_map(static fn (array $r): string => ItemStore::itemJson($r, $pidOf), $rows));
    }

    public function itemsSince(int $board, int $since, int $upTo, int $limit): array {
        $this->log[] = "itemsSince $since $upTo";
        $page = parent::itemsSince($board, $since, $upTo, $limit);
        if ($this->onItemsSince !== null) {
            ($this->onItemsSince)($board);
        }
        return $page;
    }

    public function readMinRev(int $board): ?int {
        $this->log[] = 'readMinRev';
        return isset($this->boards[$board]) ? $this->boards[$board]['min_rev'] : null;
    }

    protected function rows(string $sql, array $params, array $types): array {
        $rows = array_values($this->items[$params[0]] ?? []);
        usort($rows, static fn (array $a, array $b): int => [$a['rev'], $a['id']] <=> [$b['rev'], $b['id']]);
        if (str_contains($sql, 'CASE WHEN deleted = 0 THEN data END AS data')) {
            $rows = array_map(static fn (array $r): array => $r['deleted'] === 1 ? ['data' => null, 'style' => null] + $r : $r, $rows);
        }
        if (preg_match('/rev > \? AND rev <= \? ORDER BY rev, id LIMIT (\d+)/', $sql, $m) === 1) {
            $out = array_values(array_filter($rows, static fn (array $r): bool => $r['rev'] > $params[1] && $r['rev'] <= $params[2]));
            return array_slice($out, 0, (int)$m[1]);
        }
        if (str_contains($sql, 'AND rev = ? ORDER BY id')) {
            $this->log[] = 'itemsSince:reload';
            return array_values(array_filter($rows, static fn (array $r): bool => $r['rev'] === $params[1]));
        }
        throw new \LogicException('FakeItemStore: unexpected SQL ' . $sql);
    }

    public function loadItems(int $board, array $ids): array {
        $this->log[] = 'loadItems ' . implode(',', $ids);
        $out = [];
        foreach ($ids as $id) {
            if (isset($this->items[$board][$id])) {
                $out[$id] = $this->items[$board][$id];
            }
        }
        return $out;
    }

    public function liveChildren(int $board, array $parentIds): array {
        $this->log[] = 'liveChildren ' . implode(',', $parentIds);
        $out = [];
        foreach ($this->items[$board] ?? [] as $id => $r) {
            if ($r['deleted'] === 0 && in_array($r['parent_id'], $parentIds, true)) {
                $out[$id] = self::partial($r);
            }
        }
        ksort($out, SORT_STRING);
        return $out;
    }

    public function groupMembers(int $board, array $groupIds): array {
        $this->log[] = 'groupMembers ' . implode(',', $groupIds);
        $out = [];
        foreach ($this->items[$board] ?? [] as $id => $r) {
            if ($r['deleted'] === 0 && in_array($r['group_id'] ?? null, $groupIds, true)) {
                $out[$id] = self::partial($r);
            }
        }
        ksort($out, SORT_STRING);
        return $out;
    }

    /** The columns of liveChildren()/groupMembers() (a NULL group_id stays a key). */
    private static function partial(array $r): array {
        return array_intersect_key($r + ['group_id' => null], array_flip(['id', 'type', 'parent_id', 'x', 'y', 'deleted', 'rev', 'group_id']));
    }

    public function boundConnectors(int $board, array $itemIds): array {
        $this->log[] = 'boundConnectors ' . implode(',', $itemIds);
        $out = [];
        foreach ($this->items[$board] ?? [] as $id => $r) {
            if ($r['deleted'] === 0 && $r['type'] === 'connector'
                && (in_array($r['start_item'] ?? null, $itemIds, true) || in_array($r['end_item'] ?? null, $itemIds, true))) {
                $out[$id] = $r;
            }
        }
        ksort($out, SORT_STRING);
        return $out;
    }

    public function insertItem(int $board, string $id, array $item, int $rev, string $actor, int $nowMs): void {
        $this->log[] = "insertItem $id";
        if (isset($this->items[$board][$id])) {
            throw new \RuntimeException("PK violation: item $id exists");
        }
        $this->items[$board][$id] = $this->row($id, $item, $rev, 1);
    }

    public function updateItem(int $board, string $id, array $cols, int $rev, string $actor, int $nowMs): void {
        $this->log[] = "updateItem $id " . implode(',', array_keys($cols));
        $r = $this->items[$board][$id] ?? throw new \RuntimeException("no item $id");
        foreach (array_keys($cols) as $c) {
            if (!in_array($c, ['x', 'y', 'w', 'h', 'rotation', 'z', 'parent_id', 'data', 'style', 'deleted', 'start_item', 'end_item',
                'group_id', 'locked', 'locked_by', 'locked_name'], true)) {
                throw new \InvalidArgumentException('Unknown item column ' . $c);
            }
        }
        foreach ($cols as $c => $v) {
            $r[$c] = in_array($c, ['x', 'y', 'w', 'h', 'rotation'], true) ? (float)$v : $v;
        }
        $r['version']++;
        $r['rev'] = $rev;
        $this->items[$board][$id] = $r;
    }

    public function reviveItem(int $board, string $id, array $item, int $rev, string $actor, int $nowMs): void {
        $this->log[] = "reviveItem $id";
        $old = $this->items[$board][$id] ?? throw new \RuntimeException("no item $id");
        $this->items[$board][$id] = $this->row($id, $item, $rev, $old['version'] + 1);
    }

    public function insertChange(int $board, int $rev, string $itemId, string $op, ?string $patch, string $actor, string $client, int $nowMs): void {
        $this->log[] = "insertChange $itemId $op";
        foreach ($this->changes as $c) {
            if ($c['board'] === $board && $c['rev'] === $rev && $c['item'] === $itemId) {
                throw new \RuntimeException("PK violation: second change row for $itemId at rev $rev");
            }
        }
        $this->changes[] = ['board' => $board, 'rev' => $rev, 'item' => $itemId, 'op' => $op, 'patch' => $patch, 'actor' => $actor, 'client' => $client, 'ts' => $nowMs];
    }

    public function releaseMany(int $board, array $moves, int $rev, string $actor, string $client, int $nowMs): void {
        $this->log[] = 'releaseMany ' . count($moves);
        $this->move($board, $moves, true, $rev, $actor, $client, $nowMs);
    }

    public function shiftChildren(int $board, array $moves, int $rev, string $actor, string $client, int $nowMs): void {
        $this->log[] = 'shiftChildren ' . count($moves);
        $this->move($board, $moves, false, $rev, $actor, $client, $nowMs);
    }

    public function releaseConnectors(int $board, array $rows, int $rev, string $actor, string $client, int $nowMs): void {
        $this->log[] = 'releaseConnectors ' . count($rows);
        foreach ($rows as [$id, $data, $start, $end, $patch]) {
            $r = $this->items[$board][$id] ?? throw new \RuntimeException("no item $id");
            $r['data'] = $data;
            $r['start_item'] = $start;
            $r['end_item'] = $end;
            $r['version']++;
            $r['rev'] = $rev;
            $this->items[$board][$id] = $r;
            $this->change($board, $rev, $id, $patch, $actor, $client, $nowMs);
        }
    }

    /** @param list<array{0: string, 1: float, 2: float, 3: string}> $moves */
    private function move(int $board, array $moves, bool $toRoot, int $rev, string $actor, string $client, int $nowMs): void {
        foreach ($moves as [$id, $x, $y, $patch]) {
            $r = $this->items[$board][$id] ?? throw new \RuntimeException("no item $id");
            $r['x'] = (float)ItemStore::num($x);
            $r['y'] = (float)ItemStore::num($y);
            if ($toRoot) {
                $r['parent_id'] = null;
            }
            $r['version']++;
            $r['rev'] = $rev;
            $this->items[$board][$id] = $r;
            $this->change($board, $rev, $id, $patch, $actor, $client, $nowMs);
        }
    }

    /** A patch change row of a multi-row write, with the primary-key check. */
    private function change(int $board, int $rev, string $id, string $patch, string $actor, string $client, int $nowMs): void {
        $this->log[] = "insertChange $id patch";
        foreach ($this->changes as $c) {
            if ($c['board'] === $board && $c['rev'] === $rev && $c['item'] === $id) {
                throw new \RuntimeException("PK violation: second change row for $id at rev $rev");
            }
        }
        $this->changes[] = ['board' => $board, 'rev' => $rev, 'item' => $id, 'op' => 'patch', 'patch' => $patch, 'actor' => $actor, 'client' => $client, 'ts' => $nowMs];
    }

    public function boardsLockedBy(string $principalId): array {
        $this->log[] = "boardsLockedBy $principalId";
        $out = [];
        foreach ($this->items as $board => $rows) {
            foreach ($rows as $r) {
                if (($r['locked_by'] ?? null) === $principalId) {
                    $out[] = (int)$board;
                    break;
                }
            }
        }
        sort($out);
        return $out;
    }

    public function clearLockerRows(int $board, string $principalId, int $rev): int {
        $this->log[] = "clearLockerRows $board $principalId";
        $n = 0;
        foreach ($this->items[$board] ?? [] as $id => $r) {
            if (($r['locked_by'] ?? null) === $principalId) {
                $r['locked_by'] = null;
                $r['locked_name'] = null;
                $r['version']++;
                $r['rev'] = $rev;
                $this->items[$board][$id] = $r;
                $n++;
            }
        }
        return $n;
    }

    public function lockers(string $prefix): array {
        $out = [];
        foreach ($this->items as $rows) {
            foreach ($rows as $r) {
                $by = $r['locked_by'] ?? null;
                if ((int)($r['locked'] ?? 0) === 1 && is_string($by) && str_starts_with($by, $prefix)) {
                    $out[$by] = true;
                }
            }
        }
        $out = array_map('strval', array_keys($out));
        sort($out, SORT_STRING);
        return $out;
    }

    public function pruneChanges(int $olderThanMs): int {
        $before = count($this->changes);
        $this->changes = array_values(array_filter($this->changes, static fn (array $c): bool => $c['ts'] >= $olderThanMs));
        return $before - count($this->changes);
    }

    private function row(string $id, array $item, int $rev, int $version): array {
        [$start, $end] = ItemStore::endItems($item);
        return [
            'id' => $id, 'type' => $item['t'], 'parent_id' => $item['parent'], 'z' => $item['z'],
            'x' => (float)$item['x'], 'y' => (float)$item['y'], 'w' => (float)$item['w'], 'h' => (float)$item['h'], 'rotation' => (float)$item['r'],
            'data' => ItemStore::obj($item['data']), 'style' => ItemStore::obj($item['style']),
            'version' => $version, 'deleted' => 0, 'rev' => $rev, 'start_item' => $start, 'end_item' => $end,
            // the put's group, also over a tombstone's (ItemStore::insertItem/reviveItem, job 026)
            'group_id' => $item['group'] ?? null,
            // a new row has no lock, and a revive clears it, like ItemStore::reviveItem (job 023)
            'locked' => null, 'locked_by' => null, 'locked_name' => null,
        ];
    }
}
