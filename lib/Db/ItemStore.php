<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * SQL of the hot path: items, the change log and the board rev (SPEC-M0
 * §3.4, §3.5, §4.10). Plain portable statements; *PREFIX* is replaced by
 * IDBConnection. Every list has an explicit ORDER BY. z is never ordered by
 * the database (clients compare keys bytewise, never by a collation).
 *
 * The stored data/style JSON is spliced into responses verbatim (itemJson):
 * decoding and re-encoding it would cost CPU on the hottest path and could
 * turn "{}" into "[]".
 *
 * Every SELECT reads the primary database (PrimaryReads, §3.7): the rev
 * from Redis bounds itemsSince, and a lagging replica would answer an empty
 * page for a rev the client then stores as its cursor.
 *
 * Floats are bound as their shortest round-trip text (num()): PHP's own
 * float-to-string conversion uses `precision` (14 digits) and would store a
 * different number than the change log carries.
 */
class ItemStore {
    /** Encoding of data/style and of change-log payloads (§4.8): no JSON_HEX_TAG, no \u escapes. */
    public const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;
    /** Columns of the wire form (itemJson), group and lock (M2 data foundation) included. */
    private const ITEM_COLS = 'id, type, parent_id, z, x, y, w, h, rotation, data, style, deleted, rev, group_id, locked, locked_by, locked_name';
    /** itemsSince: a tombstone only sends its id, so its payload stays in the database. */
    private const SINCE_COLS = 'id, type, parent_id, z, x, y, w, h, rotation,'
        . ' CASE WHEN deleted = 0 THEN data END AS data, CASE WHEN deleted = 0 THEN style END AS style, deleted, rev,'
        . ' group_id, locked, locked_by, locked_name';
    /** Rows per statement of releaseMany()/shiftChildren() (5 parameters per row in the UPDATE, 8 in the INSERT). */
    public const RELEASE_CHUNK = 500;
    /**
     * Rows per statement of releaseConnectors() (7 parameters per row in the
     * UPDATE, 8 in the INSERT). A connector's data may carry generic fields up
     * to MAX_ITEM_BYTES, so a chunk is also cut at CONNECTOR_CHUNK_BYTES of
     * data (MariaDB's default max_allowed_packet is 16 MiB).
     */
    public const CONNECTOR_CHUNK = 200;
    public const CONNECTOR_CHUNK_BYTES = 2097152;
    /**
     * Tombstone purge and changes cap (SPEC-M1 §4.13.7): at most this many
     * rows per block (plus the rows that share the boundary rev), so a block
     * holds the board lock briefly (target < 200 ms, gate < 1 s).
     */
    public const PURGE_CHUNK = 5000;
    /** The tombstone cap never purges tombstones younger than this (§4.13.7 X2). */
    public const TOMBSTONE_CAP_GRACE_MS = 24 * 3600 * 1000;
    /** Columns of a full item row (loadItems, boundConnectors), the group and the lock (M2, R20) included. */
    private const LOAD_COLS = ['id', 'type', 'parent_id', 'z', 'x', 'y', 'w', 'h', 'rotation', 'data', 'style', 'version', 'deleted', 'rev',
        'group_id', 'locked', 'locked_by', 'locked_name'];
    /** Columns of a partial row (liveChildren, groupMembers): what a release or a dissolve needs, never data or style. */
    private const PARTIAL_COLS = ['id', 'type', 'parent_id', 'x', 'y', 'deleted', 'rev', 'group_id'];
    /**
     * Columns updateItem() may write (SPEC-M1 §4.13.2 step 17). The lock
     * (M2, R20: locked 1 or NULL, locked_by, locked_name) comes from a lock
     * or unlock op of SyncService; group_id (M2, R20 Gruppieren) from the
     * patch path `group` and from the dissolve at the end of a batch (NULL
     * for no group). insertItem writes no lock and reviveItem clears it: new
     * and revived items are unlocked; both write group_id from the put.
     */
    private const UPDATE_COLS = ['x', 'y', 'w', 'h', 'rotation', 'z', 'parent_id', 'data', 'style', 'deleted', 'start_item', 'end_item',
        'group_id', 'locked', 'locked_by', 'locked_name'];
    /** Integer columns of updateItem() (bound as integers, not as number text). */
    private const UPDATE_INT_COLS = ['deleted', 'locked'];
    private const INT = IQueryBuilder::PARAM_INT;
    private const STR = IQueryBuilder::PARAM_STR;
    private const NUL = IQueryBuilder::PARAM_NULL;

    public function __construct(
        protected IDBConnection $db,
        protected ?PrimaryReads $primary = null,
    ) {
    }

    /**
     * The serialisation point of every write batch, and its FIRST statement:
     * row lock on the board until COMMIT, rev + 1, updated_at.
     *
     * @return array{rev: int, item_count: int, item_bytes: int, min_rev: int}|null null = no such board
     */
    public function lockAndBumpRev(int $board, int $nowMs): ?array {
        $n = $this->exec(
            'UPDATE *PREFIX*knorke_boards SET rev = rev + 1, updated_at = ? WHERE id = ?',
            [$nowMs, $board], [self::INT, self::INT],
        );
        if ($n !== 1) {
            return null;
        }
        $row = $this->rows('SELECT rev, item_count, item_bytes, min_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT])[0] ?? null;
        return $row === null ? null : [
            'rev' => (int)$row['rev'], 'item_count' => (int)$row['item_count'],
            'item_bytes' => (int)$row['item_bytes'], 'min_rev' => (int)$row['min_rev'],
        ];
    }

    /**
     * Live-item count and byte total (Σ strlen(data) + strlen(style) of the
     * live rows) of a board, in ONE statement under the board row lock.
     */
    public function addItemCount(int $board, int $delta, int $bytes = 0): void {
        $this->exec(
            'UPDATE *PREFIX*knorke_boards SET item_count = item_count + ?, item_bytes = item_bytes + ? WHERE id = ?',
            [$delta, $bytes, $board], [self::INT, self::INT, self::INT],
        );
    }

    /**
     * Σ strlen(data) + strlen(style) over the STORED strings of the live rows
     * of a board (the invariant item_bytes keeps; NULL counts 0), one row at
     * a time. Computed in PHP: the byte length of a TEXT value is spelled
     * differently on every database (LENGTH counts characters on PostgreSQL
     * and SQLite). Repair step BackfillItemBytes, under the board row lock.
     */
    public function liveBytes(int $board): int {
        $n = 0;
        foreach ($this->each('SELECT data, style FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0', [$board], [self::INT]) as $r) {
            $n += strlen((string)($r['data'] ?? '')) + strlen((string)($r['style'] ?? ''));
        }
        return $n;
    }

    /** Sets boards.item_bytes (repair step BackfillItemBytes, under the board row lock). */
    public function setItemBytes(int $board, int $bytes): void {
        $this->exec('UPDATE *PREFIX*knorke_boards SET item_bytes = ? WHERE id = ?', [$bytes, $board], [self::INT, self::INT]);
    }

    /** @return array{rev: int, min_rev: int}|null */
    public function readRev(int $board): ?array {
        $row = $this->rows('SELECT rev, min_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT])[0] ?? null;
        return $row === null ? null : ['rev' => (int)$row['rev'], 'min_rev' => (int)$row['min_rev']];
    }

    /**
     * The board head of the slow sync path (SPEC-M1 §4.13.8 step 7): rev,
     * min_rev and meta_rev in ONE read from the primary (pin()). meta_rev is
     * read from the database, never from Redis (§5.3: a poller could
     * otherwise move its cursor past a meta change it never received).
     *
     * @return array{rev: int, min_rev: int, meta_rev: int}|null
     */
    public function readHead(int $board): ?array {
        $row = $this->rows('SELECT rev, min_rev, meta_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT])[0] ?? null;
        return $row === null ? null : ['rev' => (int)$row['rev'], 'min_rev' => (int)$row['min_rev'], 'meta_rev' => (int)$row['meta_rev']];
    }

    /**
     * min_rev alone (SPEC-M1 §4.13.8 step 7, R19): the slow sync path reads
     * it once more AFTER the item page — a purge block that committed between
     * the head and the page shows up here (min_rev only rises).
     */
    public function readMinRev(int $board): ?int {
        $row = $this->rows('SELECT min_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT])[0] ?? null;
        return $row === null ? null : (int)$row['min_rev'];
    }

    /**
     * Live items as JSON fragments, ORDER BY id, one row at a time: the
     * caller appends each fragment to its answer, so neither the rows nor
     * the fragments ever sit in an array (measured: peak ≈ 2 × the answer
     * from string growth, where rows + fragments + implode took ≈ 3 ×).
     * The caller reads the rev BEFORE this (a write committing in between
     * then shows up here AND in the next sync — applying it twice is
     * harmless, missing it is not).
     *
     * @param (\Closure(string): string)|null $pidOf principal id → pid of this board (lock.by, itemJson)
     * @return iterable<string>
     */
    public function snapshotItems(int $board, ?\Closure $pidOf = null): iterable {
        foreach ($this->each('SELECT ' . self::ITEM_COLS . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0 ORDER BY id', [$board], [self::INT]) as $r) {
            yield self::itemJson($r, $pidOf);
        }
    }

    /**
     * Current state of every item with since < rev ≤ upTo, one row per item
     * (compaction by construction: an item row holds its latest state),
     * ORDER BY rev, id, tombstones included. A page never cuts a rev in half
     * (a client storing a half rev as cursor would miss the rest forever):
     *
     *  - ≤ limit rows → (rows, upTo, false)
     *  - else last = rev of row number `limit`; keep rows with rev < last:
     *     - kept not empty → (kept, max rev in kept, true)
     *     - kept empty (ONE rev has more than `limit` items: the release of a
     *       frame's children, in M2 server-side batches): that whole rev
     *       without LIMIT → (rows of last, last, last < upTo). The board byte
     *       budget (Limits::maxBoardBytes) bounds it.
     *
     * Tombstones come back with data = style = null (only their id is sent).
     *
     * @return array{0: list<array>, 1: int, 2: bool} rows, cursor the client may store, more?
     */
    public function itemsSince(int $board, int $since, int $upTo, int $limit): array {
        $rows = $this->rows(
            'SELECT ' . self::SINCE_COLS . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND rev > ? AND rev <= ? ORDER BY rev, id LIMIT ' . ($limit + 1),
            [$board, $since, $upTo], [self::INT, self::INT, self::INT],
        );
        if (count($rows) <= $limit) {
            return [$rows, $upTo, false];
        }
        $last = (int)$rows[$limit - 1]['rev'];
        $kept = [];
        foreach (array_slice($rows, 0, $limit) as $r) {
            if ((int)$r['rev'] < $last) {
                $kept[] = $r;
            }
        }
        if ($kept !== []) {
            return [$kept, (int)$kept[count($kept) - 1]['rev'], true];
        }
        unset($rows);
        $all = $this->rows(
            'SELECT ' . self::SINCE_COLS . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND rev = ? ORDER BY id',
            [$board, $last], [self::INT, self::INT],
        );
        return [$all, $last, $last < $upTo];
    }

    /**
     * Rows of the given items, tombstones included, keyed by id. Safe without
     * FOR UPDATE: the caller holds the board row lock.
     *
     * @param list<string> $ids
     * @return array<string, array>
     */
    public function loadItems(int $board, array $ids): array {
        if ($ids === []) {
            return [];
        }
        $qb = $this->db->getQueryBuilder();
        $qb->select(...self::LOAD_COLS)
            ->from('knorke_items')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)))
            ->andWhere($qb->expr()->in('id', $qb->createNamedParameter(array_values($ids), IQueryBuilder::PARAM_STR_ARRAY)))
            ->orderBy('id');
        $out = [];
        foreach ($this->qbRows($qb) as $r) {
            $out[(string)$r['id']] = $r;
        }
        return $out;
    }

    /**
     * Live children of the given containers, keyed by id — only what the
     * release needs (id, type, parent_id, x, y, deleted, rev, and group_id
     * for the dissolve of SyncService, M2 R20): no data or style, which may
     * be up to MAX_ITEM_BYTES each.
     *
     * @param list<string> $parentIds
     * @return array<string, array>
     */
    public function liveChildren(int $board, array $parentIds): array {
        if ($parentIds === []) {
            return [];
        }
        $qb = $this->db->getQueryBuilder();
        $qb->select(...self::PARTIAL_COLS)
            ->from('knorke_items')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)))
            ->andWhere($qb->expr()->in('parent_id', $qb->createNamedParameter(array_values($parentIds), IQueryBuilder::PARAM_STR_ARRAY)))
            ->andWhere($qb->expr()->eq('deleted', $qb->createNamedParameter(0, self::INT)))
            ->orderBy('id');
        $out = [];
        foreach ($this->qbRows($qb) as $r) {
            $out[(string)$r['id']] = $r;
        }
        return $out;
    }

    /**
     * Live members of the given groups (M2, SPEC-M1 §1.2 "(R20)
     * Gruppieren"; SyncService, dissolve at the end of a batch), keyed by
     * id, ORDER BY id: the columns of liveChildren (id, type, parent_id, x,
     * y, deleted, rev, group_id), never data or style. Through the index
     * knorke_items_group (board_id, group_id) of 0.3.0; the caller holds the
     * board row lock.
     *
     * @param list<string> $groupIds
     * @return array<string, array>
     */
    public function groupMembers(int $board, array $groupIds): array {
        if ($groupIds === []) {
            return [];
        }
        $qb = $this->db->getQueryBuilder();
        $qb->select(...self::PARTIAL_COLS)
            ->from('knorke_items')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)))
            ->andWhere($qb->expr()->in('group_id', $qb->createNamedParameter(array_values($groupIds), IQueryBuilder::PARAM_STR_ARRAY)))
            ->andWhere($qb->expr()->eq('deleted', $qb->createNamedParameter(0, self::INT)))
            ->orderBy('id');
        $out = [];
        foreach ($this->qbRows($qb) as $r) {
            $out[(string)$r['id']] = $r;
        }
        return $out;
    }

    /**
     * Live connectors with an end bound to one of the given items (SPEC-M1
     * §4.7 rule 14, release at the end of a batch), full rows keyed by id,
     * ORDER BY id. Found through the derived columns start_item/end_item and
     * their indexes knorke_items_start/_end; the caller holds the board row
     * lock and decides from data.start/data.end which end to release.
     *
     * @param list<string> $itemIds
     * @return array<string, array>
     */
    public function boundConnectors(int $board, array $itemIds): array {
        if ($itemIds === []) {
            return [];
        }
        $qb = $this->db->getQueryBuilder();
        $ids = array_values($itemIds);
        $qb->select(...self::LOAD_COLS)
            ->from('knorke_items')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)))
            ->andWhere($qb->expr()->eq('deleted', $qb->createNamedParameter(0, self::INT)))
            ->andWhere($qb->expr()->eq('type', $qb->createNamedParameter('connector', self::STR)))
            ->andWhere($qb->expr()->orX(
                $qb->expr()->in('start_item', $qb->createNamedParameter($ids, IQueryBuilder::PARAM_STR_ARRAY)),
                $qb->expr()->in('end_item', $qb->createNamedParameter($ids, IQueryBuilder::PARAM_STR_ARRAY)),
            ))
            ->orderBy('id');
        $out = [];
        foreach ($this->qbRows($qb) as $r) {
            $out[(string)$r['id']] = $r;
        }
        return $out;
    }

    /**
     * The boards that hold a lock of $principalId (M2, R20;
     * SyncService::clearLocker), ascending. No index on locked_by: a full
     * read of knorke_items, once per account deletion and per orphan.
     *
     * @param string $principalId u:<uid> or g:<gid>
     * @return list<int>
     */
    public function boardsLockedBy(string $principalId): array {
        $rows = $this->rows(
            'SELECT DISTINCT board_id FROM *PREFIX*knorke_items WHERE locked_by = ? ORDER BY board_id',
            [$principalId], [self::STR],
        );
        return array_map(static fn (array $r): int => (int)$r['board_id'], $rows);
    }

    /**
     * Empties the locker of the locks of $principalId on one board (M2,
     * R20): locked_by and locked_name NULL, `locked` stays, the rows get
     * $rev. The caller holds the board row lock (lockAndBumpRev first);
     * no change rows.
     *
     * @return int rows changed
     */
    public function clearLockerRows(int $board, string $principalId, int $rev): int {
        return $this->exec(
            'UPDATE *PREFIX*knorke_items SET locked_by = NULL, locked_name = NULL, version = version + 1, rev = ? WHERE board_id = ? AND locked_by = ?',
            [$rev, $board, $principalId], [self::INT, self::INT, self::STR],
        );
    }

    /**
     * The principal ids of every locker whose id starts with $prefix (M2,
     * R20; occ knorke:orphans with 'u:'), sorted, without duplicates.
     *
     * @return list<string>
     */
    public function lockers(string $prefix): array {
        $rows = $this->rows(
            'SELECT DISTINCT locked_by FROM *PREFIX*knorke_items WHERE locked = 1 AND locked_by LIKE ? ORDER BY locked_by',
            [$prefix . '%'], [self::STR],
        );
        return array_map(static fn (array $r): string => (string)$r['locked_by'], $rows);
    }

    /**
     * The derived columns start_item/end_item of an item (SPEC-M1 §3.4,
     * §4.7 rule 14): for a connector the item of data.start/data.end (NULL
     * for a free end), for every other type NULL.
     *
     * @return array{0: ?string, 1: ?string}
     */
    public static function endItems(array $item): array {
        if (($item['t'] ?? null) !== 'connector') {
            return [null, null];
        }
        $of = static function (mixed $ep): ?string {
            $id = is_array($ep) ? ($ep['item'] ?? null) : null;
            return is_string($id) && strlen($id) === 26 ? $id : null;
        };
        $data = is_array($item['data'] ?? null) ? $item['data'] : [];
        return [$of($data['start'] ?? null), $of($data['end'] ?? null)];
    }

    /**
     * A new item row; group_id from the put's group (M2, R20 Gruppieren;
     * NULL without one), no lock.
     *
     * @param array{t: string, x: float, y: float, w: float, h: float, r: float, z: string, parent: ?string, data: array, style: array, group?: ?string} $item
     */
    public function insertItem(int $board, string $id, array $item, int $rev, string $actor, int $nowMs): void {
        [$start, $end] = self::endItems($item);
        $group = $item['group'] ?? null;
        $this->exec(
            'INSERT INTO *PREFIX*knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, start_item, end_item, group_id, version, rev, deleted, created_by, created_at, modified_by, modified_at)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?)',
            [$board, $id, $item['t'], $item['parent'], $item['z'],
                self::num($item['x']), self::num($item['y']), self::num($item['w']), self::num($item['h']), self::num($item['r']),
                self::obj($item['data']), self::obj($item['style']), $start, $end, $group, $rev, $actor, $nowMs, $actor, $nowMs],
            [self::INT, self::STR, self::STR, $item['parent'] === null ? self::NUL : self::STR, self::STR,
                self::STR, self::STR, self::STR, self::STR, self::STR,
                self::STR, self::STR, $start === null ? self::NUL : self::STR, $end === null ? self::NUL : self::STR,
                $group === null ? self::NUL : self::STR,
                self::INT, self::STR, self::INT, self::STR, self::INT],
        );
    }

    /**
     * Writes only the changed columns (+ version, rev, modified_*). A
     * connector's data comes with its derived start_item/end_item (the
     * caller adds them, SPEC-M1 §4.13.2 step 17).
     *
     * @param array<string, mixed> $cols column → value (x/y/w/h/rotation float, z, parent_id, data/style JSON, deleted int,
     *   start_item/end_item ?string, group_id ?string, locked ?int, locked_by/locked_name ?string)
     */
    public function updateItem(int $board, string $id, array $cols, int $rev, string $actor, int $nowMs): void {
        $set = ['version = version + 1', 'rev = ?', 'modified_by = ?', 'modified_at = ?'];
        $params = [$rev, $actor, $nowMs];
        $types = [self::INT, self::STR, self::INT];
        foreach ($cols as $col => $val) {
            if (!in_array($col, self::UPDATE_COLS, true)) {
                throw new \InvalidArgumentException('Unknown item column ' . $col);
            }
            $set[] = $col . ' = ?';
            if ($val === null) {
                $params[] = null;
                $types[] = self::NUL;
            } elseif (is_int($val) && in_array($col, self::UPDATE_INT_COLS, true)) {
                $params[] = $val;
                $types[] = self::INT;
            } elseif (is_int($val) || is_float($val)) {
                $params[] = self::num((float)$val);
                $types[] = self::STR;
            } else {
                $params[] = (string)$val;
                $types[] = self::STR;
            }
        }
        $params[] = $board;
        $params[] = $id;
        $types[] = self::INT;
        $types[] = self::STR;
        $this->exec('UPDATE *PREFIX*knorke_items SET ' . implode(', ', $set) . ' WHERE board_id = ? AND id = ?', $params, $types);
    }

    /**
     * A tombstone comes back to life: every column rewritten (start_item/end_item
     * derived), deleted = 0, group_id from the put (M2, R20 Gruppieren: NULL
     * without one, whatever the tombstone still carried), and the lock
     * cleared (M2, R20: a revived item is unlocked, also a tombstone that
     * still carried a lock).
     */
    public function reviveItem(int $board, string $id, array $item, int $rev, string $actor, int $nowMs): void {
        [$start, $end] = self::endItems($item);
        $group = $item['group'] ?? null;
        $this->exec(
            'UPDATE *PREFIX*knorke_items SET type = ?, parent_id = ?, z = ?, x = ?, y = ?, w = ?, h = ?, rotation = ?, data = ?, style = ?,'
            . ' start_item = ?, end_item = ?, group_id = ?, locked = NULL, locked_by = NULL, locked_name = NULL,'
            . ' version = version + 1, rev = ?, deleted = 0, modified_by = ?, modified_at = ? WHERE board_id = ? AND id = ?',
            [$item['t'], $item['parent'], $item['z'],
                self::num($item['x']), self::num($item['y']), self::num($item['w']), self::num($item['h']), self::num($item['r']),
                self::obj($item['data']), self::obj($item['style']), $start, $end, $group, $rev, $actor, $nowMs, $board, $id],
            [self::STR, $item['parent'] === null ? self::NUL : self::STR, self::STR,
                self::STR, self::STR, self::STR, self::STR, self::STR,
                self::STR, self::STR, $start === null ? self::NUL : self::STR, $end === null ? self::NUL : self::STR,
                $group === null ? self::NUL : self::STR,
                self::INT, self::STR, self::INT, self::INT, self::STR],
        );
    }

    /** One change row; exactly one per item and rev (PK board_id, rev, item_id). */
    public function insertChange(int $board, int $rev, string $itemId, string $op, ?string $patch, string $actor, string $client, int $nowMs): void {
        $this->exec(
            'INSERT INTO *PREFIX*knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$board, $rev, $itemId, $op, $patch, $actor, $client, $nowMs],
            [self::INT, self::INT, self::STR, self::STR, $patch === null ? self::NUL : self::STR, self::STR, self::STR, self::INT],
        );
    }

    /**
     * Children released by a container removal whose only effective paths
     * are the placement group (§4.7 rule 6): the item rows (x, y computed in
     * PHP, parent_id NULL) and their change rows (`patch` with the effective
     * paths) in chunked multi-row statements instead of two statements per
     * child — the board row lock stays short for big frames.
     *
     * @param list<array{0: string, 1: float, 2: float, 3: string}> $moves [id, x, y, change-row patch JSON]
     */
    public function releaseMany(int $board, array $moves, int $rev, string $actor, string $client, int $nowMs): void {
        $this->moveMany($board, $moves, true, $rev, $actor, $client, $nowMs);
    }

    /**
     * Children of a container patched with keep (SPEC-M1 §4.7 rule 15) whose
     * only effective paths are the placement group: x, y computed in PHP,
     * parent_id unchanged, one change row each (`patch` {x, y, parent}) —
     * the same chunked multi-row statements as releaseMany().
     *
     * @param list<array{0: string, 1: float, 2: float, 3: string}> $moves [id, x, y, change-row patch JSON]
     */
    public function shiftChildren(int $board, array $moves, int $rev, string $actor, string $client, int $nowMs): void {
        $this->moveMany($board, $moves, false, $rev, $actor, $client, $nowMs);
    }

    /**
     * Connectors whose only effective paths are ends released by the server
     * (SPEC-M1 §4.7 rule 14, release at the end of a batch): data (computed
     * in PHP) with its derived start_item/end_item, and one change row each
     * (`patch` {"data.start": {x, y}} and/or "data.end"), in chunked
     * multi-row statements — 300 connectors of one removed item cost two
     * statements per chunk instead of 600.
     *
     * `ELSE start_item` / `ELSE end_item` never apply (the IN list holds
     * exactly the CASE ids); they give the CASE the column's type, so
     * PostgreSQL types an untyped NULL parameter like the column.
     *
     * @param list<array{0: string, 1: string, 2: ?string, 3: ?string, 4: string}> $rows [id, data JSON, start_item, end_item, change-row patch JSON]
     */
    public function releaseConnectors(int $board, array $rows, int $rev, string $actor, string $client, int $nowMs): void {
        $chunks = [];
        $chunk = [];
        $bytes = 0;
        foreach ($rows as $r) {
            if ($chunk !== [] && (count($chunk) >= self::CONNECTOR_CHUNK || $bytes + strlen($r[1]) > self::CONNECTOR_CHUNK_BYTES)) {
                $chunks[] = $chunk;
                $chunk = [];
                $bytes = 0;
            }
            $chunk[] = $r;
            $bytes += strlen($r[1]);
        }
        if ($chunk !== []) {
            $chunks[] = $chunk;
        }
        foreach ($chunks as $chunk) {
            $dCase = $sCase = $eCase = $dParams = $sParams = $eParams = $dTypes = $sTypes = $eTypes = $idParams = [];
            foreach ($chunk as [$id, $data, $start, $end]) {
                $dCase[] = 'WHEN ? THEN ?';
                $sCase[] = 'WHEN ? THEN ?';
                $eCase[] = 'WHEN ? THEN ?';
                array_push($dParams, $id, $data);
                array_push($sParams, $id, $start);
                array_push($eParams, $id, $end);
                array_push($dTypes, self::STR, self::STR);
                array_push($sTypes, self::STR, $start === null ? self::NUL : self::STR);
                array_push($eTypes, self::STR, $end === null ? self::NUL : self::STR);
                $idParams[] = $id;
            }
            $n = count($chunk);
            $this->exec(
                'UPDATE *PREFIX*knorke_items SET data = CASE id ' . implode(' ', $dCase) . ' ELSE data END,'
                . ' start_item = CASE id ' . implode(' ', $sCase) . ' ELSE start_item END,'
                . ' end_item = CASE id ' . implode(' ', $eCase) . ' ELSE end_item END,'
                . ' version = version + 1, rev = ?, modified_by = ?, modified_at = ?'
                . ' WHERE board_id = ? AND id IN (' . implode(', ', array_fill(0, $n, '?')) . ')',
                [...$dParams, ...$sParams, ...$eParams, $rev, $actor, $nowMs, $board, ...$idParams],
                [...$dTypes, ...$sTypes, ...$eTypes, self::INT, self::STR, self::INT, self::INT, ...array_fill(0, $n, self::STR)],
            );
            $this->insertChanges($board, $rev, array_map(static fn (array $r): array => [$r[0], $r[4]], $chunk), $actor, $client, $nowMs);
        }
    }

    /**
     * releaseMany()/shiftChildren(): x, y per row (and parent_id = NULL when
     * $toRoot) in chunked multi-row UPDATEs, plus the change rows.
     *
     * `ELSE x` / `ELSE y` never apply (the IN list holds exactly the CASE
     * ids); they give the CASE the column's type, so PostgreSQL converts the
     * untyped parameters to double precision like in `x = ?`.
     *
     * @param list<array{0: string, 1: float, 2: float, 3: string}> $moves [id, x, y, change-row patch JSON]
     */
    private function moveMany(int $board, array $moves, bool $toRoot, int $rev, string $actor, string $client, int $nowMs): void {
        foreach (array_chunk($moves, self::RELEASE_CHUNK) as $chunk) {
            $xCase = $yCase = $xParams = $yParams = $idParams = [];
            foreach ($chunk as [$id, $x, $y]) {
                $xCase[] = 'WHEN ? THEN ?';
                $yCase[] = 'WHEN ? THEN ?';
                array_push($xParams, $id, self::num($x));
                array_push($yParams, $id, self::num($y));
                $idParams[] = $id;
            }
            $n = count($chunk);
            $params = [...$xParams, ...$yParams, $rev, $actor, $nowMs, $board, ...$idParams];
            $types = [...array_fill(0, 4 * $n, self::STR), self::INT, self::STR, self::INT, self::INT, ...array_fill(0, $n, self::STR)];
            $this->exec(
                'UPDATE *PREFIX*knorke_items SET x = CASE id ' . implode(' ', $xCase) . ' ELSE x END,'
                . ' y = CASE id ' . implode(' ', $yCase) . ' ELSE y END,'
                . ($toRoot ? ' parent_id = NULL,' : '')
                . ' version = version + 1, rev = ?, modified_by = ?, modified_at = ?'
                . ' WHERE board_id = ? AND id IN (' . implode(', ', array_fill(0, $n, '?')) . ')',
                $params, $types,
            );
            $this->insertChanges($board, $rev, array_map(static fn (array $m): array => [$m[0], $m[3]], $chunk), $actor, $client, $nowMs);
        }
    }

    /**
     * One multi-row INSERT of `patch` change rows (one per item, same rev).
     *
     * @param list<array{0: string, 1: string}> $rows [item id, patch JSON]
     */
    private function insertChanges(int $board, int $rev, array $rows, string $actor, string $client, int $nowMs): void {
        $params = $types = [];
        foreach ($rows as [$id, $patch]) {
            array_push($params, $board, $rev, $id, 'patch', $patch, $actor, $client, $nowMs);
            array_push($types, self::INT, self::INT, self::STR, self::STR, self::STR, self::STR, self::STR, self::INT);
        }
        $this->exec(
            'INSERT INTO *PREFIX*knorke_changes (board_id, rev, item_id, op, patch, actor, client, ts) VALUES '
            . implode(', ', array_fill(0, count($rows), '(?, ?, ?, ?, ?, ?, ?, ?)')),
            $params, $types,
        );
    }

    /** CleanupJob: change rows older than $olderThanMs. */
    public function pruneChanges(int $olderThanMs): int {
        return $this->exec('DELETE FROM *PREFIX*knorke_changes WHERE ts < ?', [$olderThanMs], [self::INT]);
    }

    /**
     * ONE block of the tombstone purge (SPEC-M1 §4.13.7). The caller holds
     * the board row lock (BoardStore::lockBoard first in the same
     * transaction) and calls FastCache::setGens with the new min_rev after
     * COMMIT. With $olderThanMs = now − retention and $graceMs = now − 24 h:
     *
     *   X1 = MAX(rev) of the tombstones with modified_at < $olderThanMs
     *   cnt = number of tombstones
     *   X2 = cnt > $cap ? min(rev of the (cnt − cap)-oldest tombstone by rev,
     *                         MAX(rev) of the tombstones with modified_at < $graceMs)
     *                   : null           (no tombstone older than 24 h → null)
     *   Xz = max(X1, X2); null → nothing to do (null)
     *   X  = rev of the PURGE_CHUNK-oldest tombstone with rev ≤ Xz; fewer → Xz
     *   DELETE the tombstones with rev ≤ X (at most PURGE_CHUNK + the rows that
     *   share rev X); min_rev = max(min_rev, X)
     *
     * Block boundaries only through rev: SELECTs with LIMIT/OFFSET through
     * the query builder, then a plain DELETE … rev <= ? — never DELETE with
     * LIMIT or ORDER BY, never an IN subquery with LIMIT (portable to
     * PostgreSQL, MySQL/MariaDB and SQLite).
     *
     * @param int $olderThanMs tombstones modified before this time are due (now − retention)
     * @param int $cap tombstones the board keeps at most beyond the retention
     * @param int $nowMs the clock of the cuts (24-h grace of the cap)
     * @param int|null $deleted set to the number of deleted rows
     * @return int|null X (the new lower bound of the history), null = nothing due
     */
    public function purgeTombstones(int $board, int $olderThanMs, int $cap, int $nowMs, ?int &$deleted = null): ?int {
        $deleted = 0;
        $graceMs = $nowMs - self::TOMBSTONE_CAP_GRACE_MS;
        $s = $this->rows(
            'SELECT COUNT(*) AS n, MAX(CASE WHEN modified_at < ? THEN rev END) AS x1, MAX(CASE WHEN modified_at < ? THEN rev END) AS grace'
            . ' FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 1',
            [$olderThanMs, $graceMs, $board], [self::INT, self::INT, self::INT],
        )[0] ?? null;
        $cnt = (int)($s['n'] ?? 0);
        if ($cnt === 0) {
            return null;
        }
        $x1 = $s['x1'] === null ? null : (int)$s['x1'];
        $x2 = null;
        if ($cnt > $cap && $s['grace'] !== null) {
            $over = $this->nthTombstoneRev($board, null, $cnt - $cap - 1);
            $x2 = $over === null ? null : min($over, (int)$s['grace']);
        }
        $xz = $x1 === null ? $x2 : ($x2 === null ? $x1 : max($x1, $x2));
        if ($xz === null) {
            return null;
        }
        $x = $this->nthTombstoneRev($board, $xz, self::PURGE_CHUNK - 1) ?? $xz;
        $deleted = $this->exec(
            'DELETE FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 1 AND rev <= ?',
            [$board, $x], [self::INT, self::INT],
        );
        $this->exec(
            'UPDATE *PREFIX*knorke_boards SET min_rev = CASE WHEN min_rev < ? THEN ? ELSE min_rev END WHERE id = ?',
            [$x, $x, $board], [self::INT, self::INT, self::INT],
        );
        return $x;
    }

    /**
     * ONE block of the changes cap (SPEC-M1 §4.13.7, R19 T4-06), in its own
     * short transaction WITHOUT the board lock: R = rev of the $cap-newest
     * change row; the rows with rev < R go, at most PURGE_CHUNK per block
     * (up to the rev of the PURGE_CHUNK-oldest of them; a block may be larger
     * by the rows of that rev). So at least $cap rows stay (all rows of rev
     * R), exactly $cap with one row per rev; nothing goes while there are at
     * most $cap rows.
     *
     * @return int deleted rows (0 = the cap holds)
     */
    public function pruneChangesCap(int $board, int $cap): int {
        $r = $this->nthChangeRev($board, true, null, null, $cap - 1);
        if ($r === null) {
            return 0;
        }
        return $this->pruneChangesBelow($board, $r);
    }

    /**
     * ONE block of deleting a board's change rows with rev < $rev (the row
     * cap above, the byte cap of changesBytesBoundary): at most PURGE_CHUNK
     * rows (up to the rev of the PURGE_CHUNK-oldest of them; a block may be
     * larger by the rows of that rev). Own short transaction of the caller,
     * no board lock; block boundary only through rev, never DELETE … LIMIT.
     *
     * @return int deleted rows (0 = nothing below $rev)
     */
    public function pruneChangesBelow(int $board, int $rev): int {
        $b = $this->nthChangeRev($board, false, $rev, null, self::PURGE_CHUNK - 1);
        return $b === null
            ? $this->exec('DELETE FROM *PREFIX*knorke_changes WHERE board_id = ? AND rev < ?', [$board, $rev], [self::INT, self::INT])
            : $this->exec('DELETE FROM *PREFIX*knorke_changes WHERE board_id = ? AND rev < ? AND rev <= ?', [$board, $rev, $b], [self::INT, self::INT, self::INT]);
    }

    /**
     * R_bytes of the byte cap (P7, SPEC-M1 §33.1 c, ED-09): bytes of a row =
     * octet_length(patch) (NULL = 0), summed per rev; going from the newest
     * rev down, R_bytes is the smallest rev whose rows together with all
     * newer ones hold at most $cap bytes — the newest rev always stays, even
     * alone over the cap. null = nothing to delete (all rows together ≤ the
     * cap, or no rows, or $cap ≤ 0 = off). The caller deletes rev < R_bytes
     * (pruneChangesBelow) in blocks.
     *
     * Read in blocks of PURGE_CHUNK revs, newest first, only rev and length,
     * never the payload (changeRevBytes, query builder octetLength:
     * PostgreSQL/MySQL/MariaDB OCTET_LENGTH, SQLite LENGTH(CAST(… AS BLOB))).
     */
    public function changesBytesBoundary(int $board, int $cap): ?int {
        if ($cap <= 0) {
            return null;
        }
        $sum = 0;
        $keep = null;
        $below = null;
        while (true) {
            $block = $this->changeRevBytes($board, $below, self::PURGE_CHUNK);
            if ($block === []) {
                return null;
            }
            foreach ($block as [$rev, $bytes]) {
                if ($keep !== null && $sum + $bytes > $cap) {
                    return $keep;
                }
                $sum += $bytes;
                $keep = $rev;
            }
            if (count($block) < self::PURGE_CHUNK) {
                return null;
            }
            $below = $keep;
        }
    }

    /**
     * ONE block of the 30-day cut of ONE board (SPEC-M1 §4.13.7, R19 T4-07
     * (b)): change rows with ts < $olderThanMs, at most PURGE_CHUNK per block
     * (boundary through rev like pruneChangesCap), own short transaction,
     * no board lock.
     *
     * @return int deleted rows (0 = nothing older)
     */
    public function pruneBoardChanges(int $board, int $olderThanMs): int {
        $b = $this->nthChangeRev($board, false, null, $olderThanMs, self::PURGE_CHUNK - 1);
        return $b === null
            ? $this->exec('DELETE FROM *PREFIX*knorke_changes WHERE board_id = ? AND ts < ?', [$board, $olderThanMs], [self::INT, self::INT])
            : $this->exec('DELETE FROM *PREFIX*knorke_changes WHERE board_id = ? AND ts < ? AND rev <= ?', [$board, $olderThanMs, $b], [self::INT, self::INT, self::INT]);
    }

    /**
     * rev of the tombstone number $offset + 1 by rev ascending (only
     * tombstones with rev ≤ $maxRev when given), or null when there are not
     * that many. A SELECT with LIMIT/OFFSET through the query builder
     * (portable; the purge's block boundary, §4.13.7).
     */
    protected function nthTombstoneRev(int $board, ?int $maxRev, int $offset): ?int {
        $qb = $this->db->getQueryBuilder();
        $qb->select('rev')
            ->from('knorke_items')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)))
            ->andWhere($qb->expr()->eq('deleted', $qb->createNamedParameter(1, self::INT)));
        if ($maxRev !== null) {
            $qb->andWhere($qb->expr()->lte('rev', $qb->createNamedParameter($maxRev, self::INT)));
        }
        $qb->orderBy('rev', 'ASC')->setFirstResult(max(0, $offset))->setMaxResults(1);
        $row = $this->qbRows($qb)[0] ?? null;
        return $row === null ? null : (int)$row['rev'];
    }

    /**
     * rev of the change row number $offset + 1 of a board — newest first
     * ($newestFirst) or oldest first — optionally only rows with rev <
     * $belowRev and/or ts < $tsBefore; null when there are not that many.
     * Query builder with LIMIT/OFFSET (§4.13.7 block boundaries).
     */
    protected function nthChangeRev(int $board, bool $newestFirst, ?int $belowRev, ?int $tsBefore, int $offset): ?int {
        $qb = $this->db->getQueryBuilder();
        $qb->select('rev')
            ->from('knorke_changes')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)));
        if ($belowRev !== null) {
            $qb->andWhere($qb->expr()->lt('rev', $qb->createNamedParameter($belowRev, self::INT)));
        }
        if ($tsBefore !== null) {
            $qb->andWhere($qb->expr()->lt('ts', $qb->createNamedParameter($tsBefore, self::INT)));
        }
        $qb->orderBy('rev', $newestFirst ? 'DESC' : 'ASC')->setFirstResult(max(0, $offset))->setMaxResults(1);
        $row = $this->qbRows($qb)[0] ?? null;
        return $row === null ? null : (int)$row['rev'];
    }

    /**
     * [rev, Σ octet_length(patch) of its rows] of a board's change rows, at
     * most $limit revs, newest first, only revs below $belowRev when given
     * (changesBytesBoundary). Query builder: GROUP BY rev, SUM and
     * octetLength are mapped per database kind by Nextcloud (ED-10).
     *
     * @return list<array{0: int, 1: int}>
     */
    protected function changeRevBytes(int $board, ?int $belowRev, int $limit): array {
        $qb = $this->db->getQueryBuilder();
        $qb->select('rev')
            ->selectAlias($qb->func()->sum($qb->func()->octetLength('patch')), 'nbytes')
            ->from('knorke_changes')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)));
        if ($belowRev !== null) {
            $qb->andWhere($qb->expr()->lt('rev', $qb->createNamedParameter($belowRev, self::INT)));
        }
        $qb->groupBy('rev')->orderBy('rev', 'DESC')->setMaxResults($limit);
        return array_map(static fn (array $r): array => [(int)$r['rev'], (int)($r['nbytes'] ?? 0)], $this->qbRows($qb));
    }

    /**
     * Wire form of an item row (§4.4); data/style spliced verbatim, empty → {}.
     * Then group and lock (M2 data foundation), in this order, for every role:
     *
     *  - group: null for a NULL or '' group_id, else the stored string
     *  - lock: null while `locked` is NULL or 0, else {"by", "name"}, both
     *    keys always, in this order: by = $pidOf(locked_by), never the stored
     *    principal id, or null (locked_by NULL/'' or no $pidOf); name =
     *    locked_name as stored, or null (NULL/''). {"by":null,"name":null}
     *    (locked, locker unknown) is not null (not locked).
     *
     * A row without these columns (old test rows) counts as NULL.
     *
     * @param (\Closure(string): string)|null $pidOf principal id → pid of this board
     */
    public static function itemJson(array $row, ?\Closure $pidOf = null): string {
        $data = (string)($row['data'] ?? '');
        $style = (string)($row['style'] ?? '');
        $group = (string)($row['group_id'] ?? '');
        return '{"id":' . json_encode((string)$row['id'])
            . ',"t":' . json_encode((string)$row['type'], self::JSON_FLAGS)
            . ',"x":' . self::num((float)$row['x'])
            . ',"y":' . self::num((float)$row['y'])
            . ',"w":' . self::num((float)$row['w'])
            . ',"h":' . self::num((float)$row['h'])
            . ',"r":' . self::num((float)$row['rotation'])
            . ',"z":' . json_encode((string)$row['z'])
            . ',"parent":' . ($row['parent_id'] === null || $row['parent_id'] === '' ? 'null' : json_encode((string)$row['parent_id']))
            . ',"data":' . ($data === '' || $data === '[]' ? '{}' : $data)
            . ',"style":' . ($style === '' || $style === '[]' ? '{}' : $style)
            . ',"group":' . ($group === '' ? 'null' : json_encode($group))
            . ',"lock":' . self::lockJson($row, $pidOf)
            . '}';
    }

    /**
     * The `lock` of itemJson. $pidOf is called only for a locked row with a
     * locker, so an answer without such a row never derives a pid. The name
     * is encoded like the board title of the snapshot (invalid UTF-8 → U+FFFD).
     *
     * @param (\Closure(string): string)|null $pidOf
     */
    private static function lockJson(array $row, ?\Closure $pidOf): string {
        if ((int)($row['locked'] ?? 0) === 0) {
            return 'null';
        }
        $by = (string)($row['locked_by'] ?? '');
        $name = (string)($row['locked_name'] ?? '');
        return '{"by":' . ($by === '' || $pidOf === null ? 'null' : json_encode((string)$pidOf($by)))
            . ',"name":' . ($name === '' ? 'null' : json_encode($name, self::JSON_FLAGS | JSON_INVALID_UTF8_SUBSTITUTE))
            . '}';
    }

    /** JSON object text of a data/style map: "{}" when empty, never "[]" (§4.8). */
    public static function obj(array $map): string {
        return $map === [] ? '{}' : json_encode($map, self::JSON_FLAGS);
    }

    /** Shortest round-trip text of a finite float, always with a fraction or exponent ("12.0"). */
    public static function num(float $f): string {
        return json_encode($f, JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
    }

    /**
     * Rows of a raw SELECT (column names as the DB returns them, lower case).
     * The one place every raw query goes through — tests override it.
     *
     * @return list<array<string, mixed>>
     */
    protected function rows(string $sql, array $params, array $types): array {
        $this->primary?->pin();
        $res = $this->db->executeQuery($sql, $params, $types);
        $out = [];
        while (($r = $res->fetchAssociative()) !== false) {
            $out[] = $r;
        }
        $res->closeCursor();
        return $out;
    }

    /**
     * Rows of a raw SELECT one at a time (a big result never sits in a PHP
     * array). The cursor is closed when the generator ends or is dropped.
     *
     * @return \Generator<int, array<string, mixed>>
     */
    protected function each(string $sql, array $params, array $types): \Generator {
        $this->primary?->pin();
        $res = $this->db->executeQuery($sql, $params, $types);
        try {
            while (($r = $res->fetchAssociative()) !== false) {
                yield $r;
            }
        } finally {
            $res->closeCursor();
        }
    }

    /** @return list<array<string, mixed>> */
    protected function qbRows(IQueryBuilder $qb): array {
        $this->primary?->pin();
        $res = $qb->executeQuery();
        $out = [];
        while (($r = $res->fetchAssociative()) !== false) {
            $out[] = $r;
        }
        $res->closeCursor();
        return $out;
    }

    protected function exec(string $sql, array $params, array $types): int {
        return $this->db->executeStatement($sql, $params, $types);
    }
}
