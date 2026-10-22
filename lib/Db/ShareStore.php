<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * SQL for knorke_shares (SPEC-M1 §3.5, §4.10, §4.13.9): the explicit shares
 * of a board to users, groups and teams. One row per (board, kind,
 * recipient) — UNIQUE knorke_shares_target — with the canonical recipient
 * id (IUser::getUID(), IGroup::getGID(), a team's singleId) and the share
 * role moderate | edit | vote | view.
 *
 * Rows are written only under the board row lock and by diff (apply()):
 * a UNIQUE violation is never caught inside a PostgreSQL transaction
 * (SPEC-M1 §3.9). Every read pins the primary first (PrimaryReads, SPEC-M1
 * §4.13.1): a lagging replica must not seed a grant with a revoked role.
 *
 * Share rows come back as
 *   {id: int, board_id: int, kind, recipient, role, display_name: ?string, created_by, created_at: int}
 */
class ShareStore {
    public const KINDS = ['user', 'group', 'team'];
    /** IN lists in chunks of this size (SQLite: at most 999 parameters, SPEC-M1 §3.9). */
    public const CHUNK = 500;
    private const COLS = 'id, board_id, kind, recipient, role, display_name, created_by, created_at';
    private const INT = IQueryBuilder::PARAM_INT;
    private const STR = IQueryBuilder::PARAM_STR;

    public function __construct(
        protected IDBConnection $db,
        protected ?PrimaryReads $primary = null,
    ) {
    }

    /**
     * Every share row of a board, ORDER BY id (one query; the rights check
     * of SPEC-M1 §4.13.1 and the share dialog).
     *
     * @return list<array>
     */
    public function forBoard(int $board): array {
        return array_map(self::row(...), $this->rows(
            'SELECT ' . self::COLS . ' FROM *PREFIX*knorke_shares WHERE board_id = ? ORDER BY id',
            [$board], [self::INT],
        ));
    }

    /**
     * Board ids with a share row of $kind for any of $recipients, ascending
     * and distinct (event listeners, SPEC-M1 §4.13.9).
     *
     * @param list<string> $recipients
     * @return list<int>
     */
    public function boardsFor(string $kind, array $recipients): array {
        $ids = [];
        foreach ($this->sharesFor($kind, $recipients) as $r) {
            $ids[$r['board_id']] = true;
        }
        $ids = array_keys($ids);
        sort($ids);
        return $ids;
    }

    /**
     * The share rows of $kind for any of $recipients (board list, SPEC-M1
     * §4.13.3), in chunks of CHUNK.
     *
     * @param list<string> $recipients
     * @return list<array{board_id: int, kind: string, recipient: string, role: string}>
     */
    public function sharesFor(string $kind, array $recipients): array {
        $recipients = array_values(array_unique(array_map('strval', $recipients)));
        $out = [];
        foreach (array_chunk($recipients, self::CHUNK) as $chunk) {
            $marks = implode(', ', array_fill(0, count($chunk), '?'));
            foreach ($this->rows(
                'SELECT board_id, kind, recipient, role FROM *PREFIX*knorke_shares WHERE kind = ? AND recipient IN (' . $marks . ') ORDER BY board_id, id',
                [$kind, ...$chunk], [self::STR, ...array_fill(0, count($chunk), self::STR)],
            ) as $r) {
                $out[] = ['board_id' => (int)$r['board_id'], 'kind' => (string)$r['kind'], 'recipient' => (string)$r['recipient'], 'role' => (string)$r['role']];
            }
        }
        return $out;
    }

    /**
     * Writes a diff under the board row lock (SPEC-M1 §4.10.2 step 5):
     * DELETE the removed rows, UPDATE the role of changed rows, INSERT the
     * new ones. Deletes run first, so a recipient removed and added again in
     * one diff never meets the UNIQUE index.
     *
     * @param list<array{kind: string, recipient: string, role: string, display_name: ?string}> $insert
     * @param list<array{id: int, role: string}> $update
     * @param list<int> $delete row ids
     */
    public function apply(int $board, array $insert, array $update, array $delete, string $by, int $nowMs): void {
        foreach (array_chunk(array_values($delete), self::CHUNK) as $chunk) {
            $marks = implode(', ', array_fill(0, count($chunk), '?'));
            $this->exec(
                'DELETE FROM *PREFIX*knorke_shares WHERE board_id = ? AND id IN (' . $marks . ')',
                [$board, ...$chunk], [self::INT, ...array_fill(0, count($chunk), self::INT)],
            );
        }
        foreach ($update as $u) {
            $this->exec('UPDATE *PREFIX*knorke_shares SET role = ? WHERE board_id = ? AND id = ?', [$u['role'], $board, $u['id']], [self::STR, self::INT, self::INT]);
        }
        foreach ($insert as $i) {
            $qb = $this->db->getQueryBuilder();
            $qb->insert('knorke_shares')->values([
                'board_id' => $qb->createNamedParameter($board, self::INT),
                'kind' => $qb->createNamedParameter($i['kind']),
                'recipient' => $qb->createNamedParameter($i['recipient']),
                'role' => $qb->createNamedParameter($i['role']),
                'display_name' => $qb->createNamedParameter($i['display_name'], $i['display_name'] === null ? IQueryBuilder::PARAM_NULL : self::STR),
                'created_by' => $qb->createNamedParameter($by),
                'created_at' => $qb->createNamedParameter($nowMs, self::INT),
            ])->executeStatement();
        }
    }

    /**
     * Deletes every row of one recipient (a deleted group, a destroyed team,
     * a deleted user; SPEC-M1 §4.13.9 rule (c)) and returns the board ids
     * it had rows on, ascending — read first, then deleted.
     *
     * @return list<int>
     */
    public function deleteRecipient(string $kind, string $recipient): array {
        $ids = $this->boardsFor($kind, [$recipient]);
        if ($ids !== []) {
            $this->exec('DELETE FROM *PREFIX*knorke_shares WHERE kind = ? AND recipient = ?', [$kind, $recipient], [self::STR, self::STR]);
        }
        return $ids;
    }

    /**
     * Every distinct recipient of $kind, ascending (OrphanReconciler, P7,
     * SPEC-M1 §33.1 e).
     *
     * @return list<string>
     */
    public function recipients(string $kind): array {
        return array_map(
            static fn (array $r): string => (string)$r['recipient'],
            $this->rows('SELECT DISTINCT recipient FROM *PREFIX*knorke_shares WHERE kind = ? ORDER BY recipient', [$kind], [self::STR]),
        );
    }

    /** Share rows of one recipient of $kind (OrphanReconciler counts). */
    public function countRecipient(string $kind, string $recipient): int {
        return (int)($this->rows(
            'SELECT COUNT(*) AS n FROM *PREFIX*knorke_shares WHERE kind = ? AND recipient = ?',
            [$kind, $recipient], [self::STR, self::STR],
        )[0]['n'] ?? 0);
    }

    private static function row(array $r): array {
        return [
            'id' => (int)$r['id'],
            'board_id' => (int)$r['board_id'],
            'kind' => (string)$r['kind'],
            'recipient' => (string)$r['recipient'],
            'role' => (string)$r['role'],
            'display_name' => $r['display_name'] === null ? null : (string)$r['display_name'],
            'created_by' => (string)$r['created_by'],
            'created_at' => (int)$r['created_at'],
        ];
    }

    /** @return list<array<string, mixed>> */
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

    protected function exec(string $sql, array $params, array $types): int {
        return $this->db->executeStatement($sql, $params, $types);
    }
}
