<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCP\DB\IResult;
use OCP\IDBConnection;

/**
 * A real SQL database for unit tests: IDBConnection (Fake) over an
 * in-memory SQLite PDO with the Knorke tables the vote path touches
 * (boards with meta, items, changes, vote sessions, votes, links; columns as in
 * the migrations). The stores' raw SQL runs unchanged (*PREFIX* → oc_), so
 * VoteStore, BoardStore::lockBoard/meta/writeMeta and the ItemStore write
 * path are tested against a real engine, not a hand-written imitation.
 *
 * Transactions nest like Nextcloud's connection (SAVEPOINT inside a
 * transaction); inTransaction() follows them. $log records begin, commit
 * and rollBack (and $statements every SQL text) for order checks. Only the
 * query builder is missing: a store method that needs it is overridden
 * with raw SQL in the harness (SqlItemStore).
 */
final class SqliteDb {
    public \PDO $pdo;
    public int $depth = 0;
    /** @var list<string> */
    public array $log = [];
    /** @var list<string> */
    public array $statements = [];
    /** IDBConnection::supports4ByteText() */
    public bool $fourByte = true;
    /** Called before every statement with its SQL (fault injection, observation). */
    public ?\Closure $onStatement = null;

    private const SCHEMA = [
        'CREATE TABLE oc_knorke_boards (id INTEGER PRIMARY KEY AUTOINCREMENT, owner VARCHAR(64) NOT NULL, title VARCHAR(200) NOT NULL,'
        . ' rev BIGINT NOT NULL DEFAULT 0, min_rev BIGINT NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1,'
        . ' item_count INTEGER NOT NULL DEFAULT 0, item_bytes BIGINT NOT NULL DEFAULT 0, acl_gen INTEGER NOT NULL DEFAULT 1,'
        . ' link_gen INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0,'
        . ' meta CLOB NULL, meta_rev BIGINT NOT NULL DEFAULT 0, vote_link_gen INTEGER NOT NULL DEFAULT 1)',
        'CREATE TABLE oc_knorke_items (board_id BIGINT NOT NULL, id VARCHAR(26) NOT NULL, type VARCHAR(24) NOT NULL, parent_id VARCHAR(26) NULL,'
        . ' z VARCHAR(64) NOT NULL, x DOUBLE PRECISION NOT NULL DEFAULT 0, y DOUBLE PRECISION NOT NULL DEFAULT 0,'
        . ' w DOUBLE PRECISION NOT NULL DEFAULT 0, h DOUBLE PRECISION NOT NULL DEFAULT 0, rotation DOUBLE PRECISION NOT NULL DEFAULT 0,'
        . ' data CLOB NULL, style CLOB NULL, version INTEGER NOT NULL DEFAULT 1, rev BIGINT NOT NULL DEFAULT 0,'
        . ' deleted SMALLINT NOT NULL DEFAULT 0, created_by VARCHAR(80) NOT NULL, created_at BIGINT NOT NULL DEFAULT 0,'
        . ' modified_by VARCHAR(80) NOT NULL, modified_at BIGINT NOT NULL DEFAULT 0, start_item VARCHAR(26) NULL,'
        . ' end_item VARCHAR(26) NULL, locked SMALLINT NULL, group_id VARCHAR(26) NULL, locked_by VARCHAR(80) NULL,'
        . ' locked_name VARCHAR(64) NULL, PRIMARY KEY (board_id, id))',
        'CREATE TABLE oc_knorke_changes (board_id BIGINT NOT NULL, rev BIGINT NOT NULL, item_id VARCHAR(26) NOT NULL, op VARCHAR(8) NOT NULL,'
        . ' patch CLOB NULL, actor VARCHAR(80) NOT NULL, client VARCHAR(16) NOT NULL, ts BIGINT NOT NULL DEFAULT 0,'
        . ' PRIMARY KEY (board_id, rev, item_id))',
        'CREATE TABLE oc_knorke_members (board_id BIGINT NOT NULL, user_id VARCHAR(64) NOT NULL, role VARCHAR(16) NOT NULL,'
        . ' link_id BIGINT NULL, created_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (board_id, user_id))',
        'CREATE TABLE oc_knorke_shares (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id BIGINT NOT NULL, kind VARCHAR(8) NOT NULL,'
        . ' recipient VARCHAR(64) NOT NULL, role VARCHAR(16) NOT NULL, display_name VARCHAR(255) NULL, created_by VARCHAR(64) NOT NULL,'
        . ' created_at BIGINT NOT NULL DEFAULT 0)',
        'CREATE TABLE oc_knorke_vote_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id BIGINT NOT NULL, state VARCHAR(8) NOT NULL,'
        . ' config CLOB NULL, seq BIGINT NOT NULL DEFAULT 0, voters INTEGER NOT NULL DEFAULT 0, results CLOB NULL,'
        . ' started_by VARCHAR(80) NOT NULL, started_at BIGINT NOT NULL DEFAULT 0, ends_at BIGINT NULL, closed_at BIGINT NULL)',
        'CREATE INDEX knorke_vsess_board ON oc_knorke_vote_sessions (board_id, state)',
        'CREATE TABLE oc_knorke_votes (session_id BIGINT NOT NULL, voter VARCHAR(16) NOT NULL, item_id VARCHAR(26) NOT NULL,'
        . ' n SMALLINT NOT NULL DEFAULT 0, ts BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (session_id, voter, item_id))',
        'CREATE INDEX knorke_votes_item ON oc_knorke_votes (session_id, item_id)',
        'CREATE TABLE oc_knorke_links (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id BIGINT NOT NULL, token VARCHAR(32) NOT NULL,'
        . ' role VARCHAR(16) NOT NULL, created_by VARCHAR(64) NOT NULL, created_at BIGINT NOT NULL DEFAULT 0, revoked_at BIGINT NULL,'
        . ' password_hash VARCHAR(255) NULL, expires_at BIGINT NULL)',
    ];

    public function __construct() {
        $this->pdo = new \PDO('sqlite::memory:', null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        foreach (self::SCHEMA as $sql) {
            $this->pdo->exec($sql);
        }
    }

    public function connection(): IDBConnection {
        return Fake::of(IDBConnection::class, [
            'executeQuery' => fn (string $sql, array $params = [], array $types = []): IResult => $this->query($sql, $params),
            'executeStatement' => fn (string $sql, array $params = [], array $types = []): int => $this->exec($sql, $params),
            'beginTransaction' => function (): void {
                $this->pdo->exec($this->depth === 0 ? 'BEGIN' : 'SAVEPOINT sp' . $this->depth);
                $this->depth++;
                $this->log[] = 'begin';
            },
            'commit' => function (): void {
                $this->depth--;
                $this->pdo->exec($this->depth === 0 ? 'COMMIT' : 'RELEASE SAVEPOINT sp' . $this->depth);
                $this->log[] = 'commit';
            },
            'rollBack' => function (): void {
                $this->depth--;
                $this->pdo->exec($this->depth === 0 ? 'ROLLBACK' : 'ROLLBACK TO SAVEPOINT sp' . $this->depth);
                $this->log[] = 'rollBack';
            },
            'inTransaction' => fn (): bool => $this->depth > 0,
            'lastInsertId' => fn (string $table): int => (int)$this->pdo->lastInsertId(),
            'supports4ByteText' => fn (): bool => $this->fourByte,
            'getDatabaseProvider' => fn (bool $strict = false): string => IDBConnection::PLATFORM_SQLITE,
        ]);
    }

    /** One value of a query (tests). */
    public function one(string $sql, array $params = []): mixed {
        $st = $this->pdo->prepare(self::sql($sql));
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    /** @return list<array<string, mixed>> all rows of a query (tests) */
    public function all(string $sql, array $params = []): array {
        $st = $this->pdo->prepare(self::sql($sql));
        $st->execute($params);
        return $st->fetchAll(\PDO::FETCH_ASSOC);
    }

    /** A board row (raw INSERT; BoardStore::createBoard needs the query builder). */
    public function addBoard(string $owner = 'alice', string $title = 'Board', int $rev = 0, ?string $meta = null): int {
        $this->pdo->prepare('INSERT INTO oc_knorke_boards (owner, title, rev, meta, meta_rev) VALUES (?, ?, ?, ?, 0)')->execute([$owner, $title, $rev, $meta]);
        return (int)$this->pdo->lastInsertId();
    }

    /** A link row (raw INSERT; BoardStore::insertLink needs the query builder). */
    public function addLink(int $board, string $role, int $createdAt, ?int $revokedAt = null, ?int $expiresAt = null): int {
        $this->pdo->prepare('INSERT INTO oc_knorke_links (board_id, token, role, created_by, created_at, revoked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$board, bin2hex(random_bytes(12)), $role, 'alice', $createdAt, $revokedAt, $expiresAt]);
        return (int)$this->pdo->lastInsertId();
    }

    /** An item row (type, parent, deleted); data/style minimal. */
    public function addItem(int $board, string $id, string $type = 'sticky', ?string $parent = null, bool $deleted = false, int $rev = 1): void {
        $this->pdo->prepare('INSERT INTO oc_knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, version, rev, deleted, created_by, created_at, modified_by, modified_at)'
            . ' VALUES (?, ?, ?, ?, ?, 0, 0, 200, 200, 0, ?, ?, 1, ?, ?, ?, 0, ?, 0)')
            ->execute([$board, $id, $type, $parent, 'i1', '{}', '{}', $rev, $deleted ? 1 : 0, 'u:alice', 'u:alice']);
    }

    public function setDeleted(int $board, string $id, bool $deleted): void {
        $this->pdo->prepare('UPDATE oc_knorke_items SET deleted = ? WHERE board_id = ? AND id = ?')->execute([$deleted ? 1 : 0, $board, $id]);
    }

    private function query(string $sql, array $params): IResult {
        $st = $this->run($sql, $params);
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC);
        $st->closeCursor();
        $i = 0;
        return Fake::of(IResult::class, [
            'fetchAssociative' => function () use (&$rows, &$i): array|false {
                return $rows[$i++] ?? false;
            },
            'fetchOne' => function () use (&$rows, &$i): mixed {
                $r = $rows[$i++] ?? null;
                return $r === null ? false : reset($r);
            },
            'fetchAll' => fn (int $mode = \PDO::FETCH_ASSOC): array => $rows,
            'closeCursor' => fn (): bool => true,
            'rowCount' => fn (): int => count($rows),
        ]);
    }

    private function exec(string $sql, array $params): int {
        return $this->run($sql, $params)->rowCount();
    }

    private function run(string $sql, array $params): \PDOStatement {
        $sql = self::sql($sql);
        $this->statements[] = $sql;
        if ($this->onStatement !== null) {
            ($this->onStatement)($sql);
        }
        $st = $this->pdo->prepare($sql);
        $i = 1;
        foreach (array_values($params) as $v) {
            $st->bindValue($i++, $v, match (true) {
                $v === null => \PDO::PARAM_NULL,
                is_int($v) => \PDO::PARAM_INT,
                is_bool($v) => \PDO::PARAM_BOOL,
                default => \PDO::PARAM_STR,
            });
        }
        $st->execute();
        return $st;
    }

    private static function sql(string $sql): string {
        return str_replace('*PREFIX*', 'oc_', $sql);
    }
}
