<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * SQL of the voting sessions and votes (SPEC-M1 §3.6, §3.7, §4.13.5).
 * Plain portable statements, explicit ORDER BY on every list, no foreign
 * keys. Every write runs under the board row lock of the caller
 * (VoteService): at most one open session per board and the votes of a
 * voter are changed by one writer at a time, so the primary key
 * (session_id, voter, item_id) is never violated and no UNIQUE error has
 * to be caught (PostgreSQL would abort the transaction).
 *
 * Every SELECT reads the primary (PrimaryReads, SPEC-M1 §4.13.1 R2).
 *
 * Votes live only while their session is open: closing freezes `results`
 * and `voters` and deletes the vote rows in the same transaction (§7.2).
 * A voter is the pid (SPEC-M0 §4.9.4), never a uid or gid.
 *
 * Only votes on LIVE items count (SPEC-M1 §4.13.5, R16): mine(), tally()
 * and voters() join knorke_items with deleted = 0; rows() is the voter's
 * raw rows (also on deleted items), so a vote op with n = 0 can remove
 * one. A revived item's rows count again.
 *
 * Session rows come back as
 *   {id, board_id, state, config: {per, perItem, scope, types}, seq, voters,
 *    started_by, started_at, ends_at: ?int, closed_at: ?int}
 * with int columns cast and the config decoded.
 */
class VoteStore {
    /** IN lists in blocks (SQLite ≤ 999 parameters, SPEC-M1 §3.9). */
    public const IN_CHUNK = 500;
    private const SESSION_COLS = 'id, board_id, state, config, seq, voters, started_by, started_at, ends_at, closed_at';
    private const INT = IQueryBuilder::PARAM_INT;
    private const STR = IQueryBuilder::PARAM_STR;
    private const NUL = IQueryBuilder::PARAM_NULL;
    /** config/results: ASCII only (ULIDs, type names), like data/style otherwise. */
    private const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    public function __construct(
        protected IDBConnection $db,
        protected ?PrimaryReads $primary = null,
    ) {
    }

    /** The open session of a board, or null (at most one exists, board lock). */
    public function open(int $board): ?array {
        $row = $this->select(
            'SELECT ' . self::SESSION_COLS . ' FROM *PREFIX*knorke_vote_sessions WHERE board_id = ? AND state = ? ORDER BY id DESC',
            [$board, 'open'], [self::INT, self::STR],
        )[0] ?? null;
        return $row === null ? null : self::session($row);
    }

    /** Session $sid of the board (open or closed), or null. */
    public function find(int $board, int $sid): ?array {
        $row = $this->select(
            'SELECT ' . self::SESSION_COLS . ' FROM *PREFIX*knorke_vote_sessions WHERE id = ? AND board_id = ?',
            [$sid, $board], [self::INT, self::INT],
        )[0] ?? null;
        return $row === null ? null : self::session($row);
    }

    /**
     * A new open session; returns its id (the sid).
     *
     * @param array{per: int, perItem: int, scope: ?string, types: list<string>} $cfg
     */
    public function insert(int $board, array $cfg, string $by, int $nowMs, ?int $endsAt): int {
        $this->exec(
            'INSERT INTO *PREFIX*knorke_vote_sessions (board_id, state, config, seq, voters, results, started_by, started_at, ends_at, closed_at)'
            . ' VALUES (?, ?, ?, 0, 0, NULL, ?, ?, ?, NULL)',
            [$board, 'open', self::configJson($cfg), $by, $nowMs, $endsAt],
            [self::INT, self::STR, self::STR, self::STR, self::INT, $endsAt === null ? self::NUL : self::INT],
        );
        return $this->db->lastInsertId('*PREFIX*knorke_vote_sessions');
    }

    /** New end of an open session (extend, SPEC-M1 §4.12.1). */
    public function setEndsAt(int $sid, ?int $endsAt): void {
        $this->exec(
            'UPDATE *PREFIX*knorke_vote_sessions SET ends_at = ? WHERE id = ?',
            [$endsAt, $sid], [$endsAt === null ? self::NUL : self::INT, self::INT],
        );
    }

    /**
     * The voter's votes on LIVE items of the session (item id → n ≥ 1),
     * ORDER BY item id (SPEC-M1 §4.13.5, R16).
     *
     * @return array<string, int>
     */
    public function mine(int $sid, string $pid): array {
        $out = [];
        foreach ($this->select(
            'SELECT v.item_id, v.n FROM *PREFIX*knorke_votes v'
            . ' JOIN *PREFIX*knorke_vote_sessions s ON s.id = v.session_id'
            . ' JOIN *PREFIX*knorke_items i ON i.board_id = s.board_id AND i.id = v.item_id'
            . ' WHERE v.session_id = ? AND v.voter = ? AND i.deleted = 0 ORDER BY v.item_id',
            [$sid, $pid], [self::INT, self::STR],
        ) as $r) {
            $out[(string)$r['item_id']] = (int)$r['n'];
        }
        return $out;
    }

    /**
     * All rows of the voter (item id → n), also on deleted or purged items:
     * what apply() diffs against.
     *
     * @return array<string, int>
     */
    public function rows(int $sid, string $pid): array {
        $out = [];
        foreach ($this->select(
            'SELECT item_id, n FROM *PREFIX*knorke_votes WHERE session_id = ? AND voter = ? ORDER BY item_id',
            [$sid, $pid], [self::INT, self::STR],
        ) as $r) {
            $out[(string)$r['item_id']] = (int)$r['n'];
        }
        return $out;
    }

    /**
     * What the vote path needs of the items (SPEC-M1 §4.13.5): type,
     * parent_id and deleted — never data or style. Unknown ids are missing.
     *
     * @param list<string> $ids
     * @return array<string, array{type: string, parent_id: ?string, deleted: bool}>
     */
    public function items(int $board, array $ids): array {
        $out = [];
        foreach (array_chunk(array_values(array_unique($ids)), self::IN_CHUNK) as $chunk) {
            $marks = implode(', ', array_fill(0, count($chunk), '?'));
            foreach ($this->select(
                'SELECT id, type, parent_id, deleted FROM *PREFIX*knorke_items WHERE board_id = ? AND id IN (' . $marks . ') ORDER BY id',
                [$board, ...$chunk], [self::INT, ...array_fill(0, count($chunk), self::STR)],
            ) as $r) {
                $parent = $r['parent_id'];
                $out[(string)$r['id']] = [
                    'type' => (string)$r['type'],
                    'parent_id' => $parent === null || $parent === '' ? null : (string)$parent,
                    'deleted' => (int)$r['deleted'] === 1,
                ];
            }
        }
        return $out;
    }

    /**
     * Writes the differences of one voter: item id → n (0 = delete the row,
     * ≥ 1 = insert or update). $existing are the voter's rows before (rows()),
     * so every statement hits a known state: DELETE, UPDATE or INSERT.
     *
     * @param array<string, int> $changes
     * @param array<string, int> $existing
     */
    public function write(int $sid, string $pid, array $changes, int $nowMs, array $existing = []): void {
        foreach ($changes as $item => $n) {
            $item = (string)$item;
            if ($n <= 0) {
                $this->exec(
                    'DELETE FROM *PREFIX*knorke_votes WHERE session_id = ? AND voter = ? AND item_id = ?',
                    [$sid, $pid, $item], [self::INT, self::STR, self::STR],
                );
            } elseif (array_key_exists($item, $existing)) {
                $this->exec(
                    'UPDATE *PREFIX*knorke_votes SET n = ?, ts = ? WHERE session_id = ? AND voter = ? AND item_id = ?',
                    [$n, $nowMs, $sid, $pid, $item], [self::INT, self::INT, self::INT, self::STR, self::STR],
                );
            } else {
                $this->exec(
                    'INSERT INTO *PREFIX*knorke_votes (session_id, voter, item_id, n, ts) VALUES (?, ?, ?, ?, ?)',
                    [$sid, $pid, $item, $n, $nowMs], [self::INT, self::STR, self::STR, self::INT, self::INT],
                );
            }
        }
    }

    /**
     * Σ n per LIVE item of the session (item id → n > 0), ORDER BY item id:
     * the results frozen on close (SPEC-M1 §3.6, §4.13.5).
     *
     * @return array<string, int>
     */
    public function tally(int $sid): array {
        $out = [];
        foreach ($this->select(
            'SELECT v.item_id, SUM(v.n) AS total FROM *PREFIX*knorke_votes v'
            . ' JOIN *PREFIX*knorke_vote_sessions s ON s.id = v.session_id'
            . ' JOIN *PREFIX*knorke_items i ON i.board_id = s.board_id AND i.id = v.item_id'
            . ' WHERE v.session_id = ? AND i.deleted = 0 GROUP BY v.item_id ORDER BY v.item_id',
            [$sid], [self::INT],
        ) as $r) {
            if ((int)$r['total'] > 0) {
                $out[(string)$r['item_id']] = (int)$r['total'];
            }
        }
        return $out;
    }

    /** Distinct voters with at least one vote on a live item (moderators see only this number, §7.2). */
    public function voters(int $sid): int {
        return (int)($this->select(
            'SELECT COUNT(DISTINCT v.voter) AS c FROM *PREFIX*knorke_votes v'
            . ' JOIN *PREFIX*knorke_vote_sessions s ON s.id = v.session_id'
            . ' JOIN *PREFIX*knorke_items i ON i.board_id = s.board_id AND i.id = v.item_id'
            . ' WHERE v.session_id = ? AND i.deleted = 0',
            [$sid], [self::INT],
        )[0]['c'] ?? 0);
    }

    /** seq + 1 (one effective vote batch, SPEC-M1 §3.6); returns the new seq. */
    public function bumpSeq(int $sid): int {
        $this->exec('UPDATE *PREFIX*knorke_vote_sessions SET seq = seq + 1 WHERE id = ?', [$sid], [self::INT]);
        return (int)($this->select('SELECT seq FROM *PREFIX*knorke_vote_sessions WHERE id = ?', [$sid], [self::INT])[0]['seq'] ?? 0);
    }

    /**
     * Freezes the session (state closed, results, voters, closed_at).
     *
     * @param array<string, int> $results item id → n (live items, n > 0)
     */
    public function close(int $sid, array $results, int $voters, int $nowMs): void {
        $this->exec(
            'UPDATE *PREFIX*knorke_vote_sessions SET state = ?, results = ?, voters = ?, closed_at = ? WHERE id = ?',
            ['closed', $results === [] ? '{}' : json_encode($results, self::JSON_FLAGS), $voters, $nowMs, $sid],
            [self::STR, self::STR, self::INT, self::INT, self::INT],
        );
    }

    /** Deletes the vote rows of a session (anonymity: only sums survive the close, §7.2). */
    public function deleteVotes(int $sid): void {
        $this->exec('DELETE FROM *PREFIX*knorke_votes WHERE session_id = ?', [$sid], [self::INT]);
    }

    /** Deletes the rows of one voter in a session (UserDeletedEvent, §4.13.9); returns the rows deleted. */
    public function deleteVoter(int $sid, string $pid): int {
        return $this->exec('DELETE FROM *PREFIX*knorke_votes WHERE session_id = ? AND voter = ?', [$sid, $pid], [self::INT, self::STR]);
    }

    /**
     * Open sessions whose end has passed (ends_at ≤ now), ORDER BY board,
     * id: the work of VoteCloseJob (SPEC-M1 §4.12.1 path d).
     *
     * @return list<array{id: int, board_id: int}>
     */
    public function expiredOpen(int $nowMs): array {
        return array_map(static fn (array $r): array => ['id' => (int)$r['id'], 'board_id' => (int)$r['board_id']], $this->select(
            'SELECT id, board_id FROM *PREFIX*knorke_vote_sessions WHERE state = ? AND ends_at IS NOT NULL AND ends_at <= ? ORDER BY board_id, id',
            ['open', $nowMs], [self::STR, self::INT],
        ));
    }

    /**
     * All open sessions, ORDER BY board, id (UserDeletedEvent, §4.13.9).
     *
     * @return list<array{id: int, board_id: int}>
     */
    public function openSessions(): array {
        return array_map(static fn (array $r): array => ['id' => (int)$r['id'], 'board_id' => (int)$r['board_id']], $this->select(
            'SELECT id, board_id FROM *PREFIX*knorke_vote_sessions WHERE state = ? ORDER BY board_id, id',
            ['open'], [self::STR],
        ));
    }

    /** The stored config JSON: {"per","perItem","scope","types"} in this order (ASCII). */
    public static function configJson(array $cfg): string {
        return json_encode([
            'per' => (int)$cfg['per'], 'perItem' => (int)$cfg['perItem'],
            'scope' => $cfg['scope'] ?? null, 'types' => array_values($cfg['types']),
        ], self::JSON_FLAGS);
    }

    private static function session(array $r): array {
        $cfg = json_decode((string)($r['config'] ?? ''), true);
        $cfg = is_array($cfg) ? $cfg : [];
        return [
            'id' => (int)$r['id'],
            'board_id' => (int)$r['board_id'],
            'state' => (string)$r['state'],
            'config' => [
                'per' => (int)($cfg['per'] ?? 5),
                'perItem' => (int)($cfg['perItem'] ?? 1),
                'scope' => is_string($cfg['scope'] ?? null) ? $cfg['scope'] : null,
                'types' => is_array($cfg['types'] ?? null) ? array_values(array_filter($cfg['types'], 'is_string')) : ['sticky'],
            ],
            'seq' => (int)$r['seq'],
            'voters' => (int)$r['voters'],
            'started_by' => (string)$r['started_by'],
            'started_at' => (int)$r['started_at'],
            'ends_at' => $r['ends_at'] === null ? null : (int)$r['ends_at'],
            'closed_at' => $r['closed_at'] === null ? null : (int)$r['closed_at'],
        ];
    }

    /**
     * Rows of a raw SELECT (column names lower case), from the primary.
     * The one place every query goes through — tests override it.
     *
     * @return list<array<string, mixed>>
     */
    protected function select(string $sql, array $params, array $types): array {
        $this->primary?->pin();
        $res = $this->db->executeQuery($sql, $params, $types);
        $out = [];
        while (($r = $res->fetchAssociative()) !== false) {
            $out[] = array_change_key_case($r, CASE_LOWER);
        }
        $res->closeCursor();
        return $out;
    }

    protected function exec(string $sql, array $params, array $types): int {
        return $this->db->executeStatement($sql, $params, $types);
    }
}
