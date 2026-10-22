<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * SQL for boards, members and links (SPEC-M0 §3.1–§3.3, §4.10.4). Plain
 * statements, explicit ORDER BY on every list, no foreign keys (a link row of
 * a deleted board stays 30 days and points into the void).
 *
 * Every SELECT reads the primary database (PrimaryReads, §3.7): with read
 * replicas a lagging replica would answer 404 for a board, link or
 * membership created a moment ago.
 *
 * Board rows come back with int columns cast:
 *   {id, owner, title, rev, min_rev, meta_rev, schema_version, item_count,
 *    item_bytes, acl_gen, link_gen, vote_link_gen, created_at, updated_at}
 *
 * `meta` (up to 256 KiB, SPEC-M1 §3.11) is NOT among them: lockBoard and
 * findBoardForUser are hot read paths. The only reader of meta is meta()
 * (snapshot, slow sync path, MetaService); the only writer writeMeta().
 */
class BoardStore {
    public const BOARD_COLS = 'b.id, b.owner, b.title, b.rev, b.min_rev, b.meta_rev, b.schema_version, b.item_count, b.item_bytes,'
        . ' b.acl_gen, b.link_gen, b.vote_link_gen, b.created_at, b.updated_at';
    private const COLS = ['id', 'owner', 'title', 'rev', 'min_rev', 'meta_rev', 'schema_version', 'item_count', 'item_bytes',
        'acl_gen', 'link_gen', 'vote_link_gen', 'created_at', 'updated_at'];
    private const INT_COLS = ['id', 'rev', 'min_rev', 'meta_rev', 'schema_version', 'item_count', 'item_bytes',
        'acl_gen', 'link_gen', 'vote_link_gen', 'created_at', 'updated_at'];
    /** Generation column bumped per link role (SPEC-M1 §3.2). */
    private const LINK_GEN_COLS = ['edit' => 'link_gen', 'vote' => 'vote_link_gen'];
    /** Membership of one uid (first parameter) and the state of the link it came through. */
    private const MEMBER_JOIN = ' LEFT JOIN *PREFIX*knorke_members m ON m.board_id = b.id AND m.user_id = ?'
        . ' LEFT JOIN *PREFIX*knorke_links l ON l.id = m.link_id AND l.board_id = m.board_id';
    private const MEMBER_COLS = 'm.role AS member_role, m.link_id AS member_link, l.id AS member_link_row, l.revoked_at AS member_link_revoked,'
        . ' l.expires_at AS member_link_expires';
    /** Columns of a link row (SPEC-M1 §3.3). */
    private const LINK_COLS = 'id, token, role, created_by, created_at, revoked_at, password_hash, expires_at';
    private const INT = IQueryBuilder::PARAM_INT;
    private const STR = IQueryBuilder::PARAM_STR;
    private const NUL = IQueryBuilder::PARAM_NULL;

    public function __construct(
        protected IDBConnection $db,
        protected ?PrimaryReads $primary = null,
    ) {
    }

    public function db(): IDBConnection {
        return $this->db;
    }

    /**
     * Connects the primary for the rest of the request (PrimaryReads),
     * before anything else is read: the board list pins BEFORE it asks for
     * the user's groups and teams (SPEC-M1 §4.10.4, R2).
     */
    public function pin(): void {
        $this->primary?->pin();
    }

    public function findBoard(int $board): ?array {
        $row = $this->rows('SELECT ' . self::BOARD_COLS . ' FROM *PREFIX*knorke_boards b WHERE b.id = ?', [$board], [self::INT])[0] ?? null;
        return $row === null ? null : self::board($row);
    }

    /**
     * The board row plus the membership of $uid in ONE query (§5.2 full check):
     * member_role / member_link / member_link_expires are null when $uid is
     * no member.
     *
     * A membership that came through a link counts only while that link is
     * VALID (SPEC-M1 §3.3: not revoked and not expired at $nowMs): a member
     * row that points at a revoked, expired or pruned link — left behind by a
     * join racing a rotation, or a link that ran out — grants nothing.
     * Memberships with link_id NULL (M0 never wrote one) always count.
     */
    public function findBoardForUser(int $board, string $uid, int $nowMs): ?array {
        $row = $this->rows(
            'SELECT ' . self::BOARD_COLS . ', ' . self::MEMBER_COLS . ' FROM *PREFIX*knorke_boards b' . self::MEMBER_JOIN . ' WHERE b.id = ?',
            [$uid, $board], [self::STR, self::INT],
        )[0] ?? null;
        return $row === null ? null : self::board($row) + self::membership($row, $nowMs);
    }

    /**
     * The board list of $uid (SPEC-M1 §4.10.4, §4.13.3): own boards, boards
     * with a valid link membership, and boards shared with the user, one of
     * $gids (its groups) or one of $teamIds (its teams' singleIds). ORDER BY
     * updated_at DESC, id DESC. Not a hot path: up to three statements, IN
     * lists in chunks of ShareStore::CHUNK.
     *
     * Each row: the board row + member_role/member_link/member_link_expires
     * (as findBoardForUser) + `share_roles` = the share roles of the rows
     * that apply to the user (list of strings, maybe empty). Whether a link
     * membership counts under Nextcloud's link policy decides the caller.
     *
     * @param list<string> $gids
     * @param list<string> $teamIds
     * @return list<array>
     */
    public function listForUser(string $uid, array $gids, array $teamIds, int $nowMs): array {
        $out = [];
        foreach ($this->rows(
            'SELECT ' . self::BOARD_COLS . ', ' . self::MEMBER_COLS . ' FROM *PREFIX*knorke_boards b' . self::MEMBER_JOIN
            . ' WHERE b.owner = ? OR m.user_id IS NOT NULL',
            [$uid, $uid], [self::STR, self::STR],
        ) as $row) {
            $b = self::board($row) + self::membership($row, $nowMs) + ['share_roles' => []];
            if ($b['owner'] === $uid || $b['member_role'] !== null) {
                $out[$b['id']] = $b;
            }
        }
        $shared = [];
        foreach ([['user', [$uid]], ['group', $gids], ['team', $teamIds]] as [$kind, $recipients]) {
            $recipients = array_values(array_unique(array_map('strval', $recipients)));
            foreach (array_chunk($recipients, ShareStore::CHUNK) as $chunk) {
                $marks = implode(', ', array_fill(0, count($chunk), '?'));
                foreach ($this->rows(
                    'SELECT board_id, role FROM *PREFIX*knorke_shares WHERE kind = ? AND recipient IN (' . $marks . ') ORDER BY board_id, id',
                    [$kind, ...$chunk], [self::STR, ...array_fill(0, count($chunk), self::STR)],
                ) as $r) {
                    $shared[(int)$r['board_id']][] = (string)$r['role'];
                }
            }
        }
        $missing = array_values(array_diff(array_keys($shared), array_keys($out)));
        foreach (array_chunk($missing, ShareStore::CHUNK) as $chunk) {
            $marks = implode(', ', array_fill(0, count($chunk), '?'));
            foreach ($this->rows(
                'SELECT ' . self::BOARD_COLS . ', ' . self::MEMBER_COLS . ' FROM *PREFIX*knorke_boards b' . self::MEMBER_JOIN . ' WHERE b.id IN (' . $marks . ')',
                [$uid, ...$chunk], [self::STR, ...array_fill(0, count($chunk), self::INT)],
            ) as $row) {
                $b = self::board($row) + self::membership($row, $nowMs) + ['share_roles' => []];
                $out[$b['id']] = $b;
            }
        }
        foreach ($shared as $id => $roles) {
            if (isset($out[$id])) {
                $out[$id]['share_roles'] = $roles;
            }
        }
        $out = array_values($out);
        usort($out, static fn (array $a, array $b): int => [$b['updated_at'], $b['id']] <=> [$a['updated_at'], $a['id']]);
        return $out;
    }

    /**
     * member_role / member_link / member_link_expires of a MEMBER_COLS row:
     * null unless the row exists and its link (if any) is valid at $nowMs
     * (not revoked, not expired, SPEC-M1 §3.3).
     *
     * @return array{member_role: ?string, member_link: ?int, member_link_expires: ?int}
     */
    private static function membership(array $row, int $nowMs): array {
        $expires = $row['member_link_expires'] === null ? null : (int)$row['member_link_expires'];
        $valid = $row['member_role'] !== null
            && ($row['member_link'] === null
                || ($row['member_link_row'] !== null && $row['member_link_revoked'] === null && ($expires === null || $expires > $nowMs)));
        return [
            'member_role' => $valid ? (string)$row['member_role'] : null,
            'member_link' => $valid && $row['member_link'] !== null ? (int)$row['member_link'] : null,
            'member_link_expires' => $valid ? $expires : null,
        ];
    }

    public function createBoard(string $owner, string $title, int $nowMs): int {
        $qb = $this->db->getQueryBuilder();
        $qb->insert('knorke_boards')->values([
            'owner' => $qb->createNamedParameter($owner),
            'title' => $qb->createNamedParameter($title),
            'rev' => $qb->createNamedParameter(0, self::INT),
            'min_rev' => $qb->createNamedParameter(0, self::INT),
            'schema_version' => $qb->createNamedParameter(1, self::INT),
            'item_count' => $qb->createNamedParameter(0, self::INT),
            'acl_gen' => $qb->createNamedParameter(1, self::INT),
            'link_gen' => $qb->createNamedParameter(1, self::INT),
            'created_at' => $qb->createNamedParameter($nowMs, self::INT),
            'updated_at' => $qb->createNamedParameter($nowMs, self::INT),
        ])->executeStatement();
        return $qb->getLastInsertId();
    }

    /**
     * Title, meta JSON (null = {}) and meta_rev of a board (SPEC-M1 §4.13.4,
     * §9.7): the ONLY reader of `meta`. Reads the primary (pin()).
     *
     * @return array{title: string, meta: ?string, meta_rev: int}|null
     */
    public function meta(int $board): ?array {
        $row = $this->rows('SELECT title, meta, meta_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT])[0] ?? null;
        if ($row === null) {
            return null;
        }
        $meta = $row['meta'];
        return [
            'title' => (string)$row['title'],
            'meta' => $meta === null || $meta === '' ? null : (string)$meta,
            'meta_rev' => (int)$row['meta_rev'],
        ];
    }

    /**
     * The meta write of MetaService (SPEC-M1 §4.13.4), under the board row
     * lock: title (unless null), meta (null = {}), and rev + 1 with
     * meta_rev = the new rev in ONE statement. meta_rev is assigned BEFORE
     * rev: MySQL/MariaDB assign left to right with the new values, PostgreSQL
     * and SQLite from the old row — both give meta_rev = old rev + 1 = new
     * rev. Writes no change row.
     *
     * @return int the new rev; 0 = no such board
     */
    public function writeMeta(int $board, ?string $title, ?string $meta, int $nowMs): int {
        $set = $title === null ? '' : 'title = ?, ';
        $params = $title === null ? [] : [$title];
        $types = $title === null ? [] : [self::STR];
        $n = $this->exec(
            'UPDATE *PREFIX*knorke_boards SET ' . $set . 'meta = ?, meta_rev = rev + 1, rev = rev + 1, updated_at = ? WHERE id = ?',
            [...$params, $meta, $nowMs, $board],
            [...$types, $meta === null ? self::NUL : self::STR, self::INT, self::INT],
        );
        if ($n !== 1) {
            return 0;
        }
        return (int)($this->rows('SELECT rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT])[0]['rev'] ?? 0);
    }

    /**
     * FIRST statement of an administration transaction (§4.10.4): takes the
     * board row lock and optionally bumps the generations (acl_gen: any
     * revocation; the generation of $bumpLinkRole — link_gen for 'edit',
     * vote_link_gen for 'vote' — guest tokens of that link role die), then
     * reads the row back. Without a bump the row is only locked.
     *
     * @param string|null $bumpLinkRole null | 'edit' | 'vote'
     * @return array|null the board row after the update; null = no such board
     */
    public function lockBoard(int $board, bool $bumpAcl, ?string $bumpLinkRole, int $nowMs): ?array {
        if ($bumpLinkRole !== null && !isset(self::LINK_GEN_COLS[$bumpLinkRole])) {
            throw new \InvalidArgumentException('Knorke: unknown link role ' . $bumpLinkRole);
        }
        $edit = $bumpLinkRole === 'edit' ? 1 : 0;
        $vote = $bumpLinkRole === 'vote' ? 1 : 0;
        $bump = $bumpAcl || $bumpLinkRole !== null;
        $n = $this->exec(
            'UPDATE *PREFIX*knorke_boards SET acl_gen = acl_gen + ?, link_gen = link_gen + ?, vote_link_gen = vote_link_gen + ?'
            . ($bump ? ', updated_at = ?' : '') . ' WHERE id = ?',
            $bump ? [$bumpAcl ? 1 : 0, $edit, $vote, $nowMs, $board] : [0, 0, 0, $board],
            $bump ? [self::INT, self::INT, self::INT, self::INT, self::INT] : [self::INT, self::INT, self::INT, self::INT],
        );
        return $n === 1 ? $this->findBoard($board) : null;
    }

    /**
     * Board delete (§4.10.4, R2; SPEC-M1 §3.9): changes, items, members,
     * shares, votes (through the session ids) and voting sessions, the
     * board — links are only revoked by the caller. No foreign keys, no
     * cascade: every table is named here.
     */
    public function deleteBoardRows(int $board): void {
        $this->exec('DELETE FROM *PREFIX*knorke_changes WHERE board_id = ?', [$board], [self::INT]);
        $this->exec('DELETE FROM *PREFIX*knorke_items WHERE board_id = ?', [$board], [self::INT]);
        $this->exec('DELETE FROM *PREFIX*knorke_members WHERE board_id = ?', [$board], [self::INT]);
        $this->exec('DELETE FROM *PREFIX*knorke_shares WHERE board_id = ?', [$board], [self::INT]);
        $this->exec('DELETE FROM *PREFIX*knorke_votes WHERE session_id IN (SELECT id FROM *PREFIX*knorke_vote_sessions WHERE board_id = ?)',
            [$board], [self::INT]);
        $this->exec('DELETE FROM *PREFIX*knorke_vote_sessions WHERE board_id = ?', [$board], [self::INT]);
        $this->exec('DELETE FROM *PREFIX*knorke_boards WHERE id = ?', [$board], [self::INT]);
    }

    public function countOwned(string $uid): int {
        return (int)($this->rows('SELECT COUNT(*) AS n FROM *PREFIX*knorke_boards WHERE owner = ?', [$uid], [self::STR])[0]['n'] ?? 0);
    }

    /**
     * The link row of a token (active or revoked) with the generations of its
     * board (LEFT JOIN: the board may be gone). The token is compared once
     * more in constant time, so a case-insensitive collation (MySQL) cannot
     * turn a different token into a hit.
     *
     * Since stage 2 also password_hash (IHasher hash or null) and expires_at
     * (ms or null, SPEC-M1 §3.3). Whether an unrevoked link has expired the
     * caller decides with its own clock.
     *
     * @return array{id: int, board_id: int, token: string, role: string, created_by: string, created_at: int,
     *   revoked_at: ?int, password_hash: ?string, expires_at: ?int, board: ?array}|null
     */
    public function findLinkByToken(#[\SensitiveParameter] string $token): ?array {
        $row = $this->rows(
            'SELECT l.id AS link_id, l.board_id AS link_board, l.token, l.role AS link_role, l.created_by AS link_by,'
            . ' l.created_at AS link_created, l.revoked_at, l.password_hash AS link_hash, l.expires_at AS link_expires, ' . self::BOARD_COLS
            . ' FROM *PREFIX*knorke_links l LEFT JOIN *PREFIX*knorke_boards b ON b.id = l.board_id WHERE l.token = ?',
            [$token], [self::STR],
        )[0] ?? null;
        if ($row === null || !hash_equals((string)$row['token'], $token)) {
            return null;
        }
        return [
            'id' => (int)$row['link_id'],
            'board_id' => (int)$row['link_board'],
            'token' => (string)$row['token'],
            'role' => (string)$row['link_role'],
            'created_by' => (string)$row['link_by'],
            'created_at' => (int)$row['link_created'],
            'revoked_at' => $row['revoked_at'] === null ? null : (int)$row['revoked_at'],
            'password_hash' => $row['link_hash'] === null || $row['link_hash'] === '' ? null : (string)$row['link_hash'],
            'expires_at' => $row['link_expires'] === null ? null : (int)$row['link_expires'],
            'board' => $row['id'] === null ? null : self::board($row),
        ];
    }

    /**
     * The unrevoked link of one role (SPEC-M1 §4.11.1, R2): revoked_at IS
     * NULL, ALSO when it has expired — the owner sees it with its date, and
     * enableLink renews it. At most one per board and role (enforced under
     * the board lock); the newest wins should there ever be two.
     *
     * @return array{id: int, token: string, role: string, created_by: string, created_at: int, revoked_at: null,
     *   password_hash: ?string, expires_at: ?int}|null
     */
    public function activeLinkOf(int $board, string $role): ?array {
        $row = $this->rows(
            'SELECT ' . self::LINK_COLS . ' FROM *PREFIX*knorke_links WHERE board_id = ? AND role = ? AND revoked_at IS NULL ORDER BY id DESC',
            [$board, $role], [self::INT, self::STR],
        )[0] ?? null;
        return $row === null ? null : self::link($row);
    }

    /**
     * Since when the board is open by link (M2 privacy notice, snapshot
     * board.linkOpenSince): MAX(created_at) in ms of its links that are
     * neither revoked nor expired at $nowMs, of both link roles (edit and
     * vote); null without such a link. Nextcloud's link policy plays no part
     * (a link the admin switched off counts: the notice rather says too much
     * than too little).
     */
    public function linkOpenSince(int $board, int $nowMs): ?int {
        $v = $this->rows(
            'SELECT MAX(created_at) AS since FROM *PREFIX*knorke_links WHERE board_id = ? AND role IN (?, ?) AND revoked_at IS NULL'
            . ' AND (expires_at IS NULL OR expires_at > ?)',
            [$board, 'edit', 'vote', $nowMs], [self::INT, self::STR, self::STR, self::INT],
        )[0]['since'] ?? null;
        return $v === null ? null : (int)$v;
    }

    /** $hash: IHasher hash or null (no password); $expiresAt: ms or null (no expiry). */
    public function insertLink(int $board, #[\SensitiveParameter] string $token, string $role, string $by, int $nowMs,
        #[\SensitiveParameter] ?string $hash, ?int $expiresAt): int {
        $qb = $this->db->getQueryBuilder();
        $qb->insert('knorke_links')->values([
            'board_id' => $qb->createNamedParameter($board, self::INT),
            'token' => $qb->createNamedParameter($token),
            'role' => $qb->createNamedParameter($role),
            'created_by' => $qb->createNamedParameter($by),
            'created_at' => $qb->createNamedParameter($nowMs, self::INT),
            'revoked_at' => $qb->createNamedParameter(null, self::NUL),
            'password_hash' => $qb->createNamedParameter($hash, $hash === null ? self::NUL : self::STR),
            'expires_at' => $qb->createNamedParameter($expiresAt, $expiresAt === null ? self::NUL : self::INT),
        ])->executeStatement();
        return $qb->getLastInsertId();
    }

    /** Password hash and expiry of one link (change of an active link, rehash after verify). */
    public function updateLinkSecrets(int $linkId, #[\SensitiveParameter] ?string $hash, ?int $expiresAt): void {
        $this->exec(
            'UPDATE *PREFIX*knorke_links SET password_hash = ?, expires_at = ? WHERE id = ?',
            [$hash, $expiresAt, $linkId],
            [$hash === null ? self::NUL : self::STR, $expiresAt === null ? self::NUL : self::INT, self::INT],
        );
    }

    /**
     * Rehash after a successful verify (LinkSecrets::verify): only while the
     * stored hash is still $old — a password the owner changed meanwhile is
     * never overwritten. false = nothing replaced.
     */
    public function replaceLinkHash(int $linkId, #[\SensitiveParameter] string $old, #[\SensitiveParameter] string $new): bool {
        return $this->exec(
            'UPDATE *PREFIX*knorke_links SET password_hash = ? WHERE id = ? AND password_hash = ?',
            [$new, $linkId, $old], [self::STR, self::INT, self::STR],
        ) === 1;
    }

    /**
     * Revokes the unrevoked links of ONE role (SPEC-M1 §4.11.1, finding D5:
     * renewing one link never touches the other); rows stay, revoked_at set.
     *
     * @return list<int> the revoked link ids
     */
    public function revokeLinks(int $board, int $nowMs, string $role): array {
        $ids = array_map(
            static fn (array $r): int => (int)$r['id'],
            $this->rows('SELECT id FROM *PREFIX*knorke_links WHERE board_id = ? AND role = ? AND revoked_at IS NULL ORDER BY id', [$board, $role], [self::INT, self::STR]),
        );
        if ($ids !== []) {
            $this->exec(
                'UPDATE *PREFIX*knorke_links SET revoked_at = ? WHERE board_id = ? AND role = ? AND revoked_at IS NULL',
                [$nowMs, $board, $role], [self::INT, self::INT, self::STR],
            );
        }
        return $ids;
    }

    /**
     * CleanupJob (SPEC-M1 §3.3): links revoked before $olderThanMs OR
     * expired before it. Their member rows go with them (a member row of a
     * missing link grants nothing anyway).
     */
    public function pruneLinks(int $olderThanMs): int {
        $ids = array_map(
            static fn (array $r): int => (int)$r['id'],
            $this->rows(
                'SELECT id FROM *PREFIX*knorke_links WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR (expires_at IS NOT NULL AND expires_at < ?) ORDER BY id',
                [$olderThanMs, $olderThanMs], [self::INT, self::INT],
            ),
        );
        $n = 0;
        foreach (array_chunk($ids, ShareStore::CHUNK) as $chunk) {
            $qb = $this->db->getQueryBuilder();
            $qb->delete('knorke_members')
                ->where($qb->expr()->in('link_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
            $qb->executeStatement();
            $qb = $this->db->getQueryBuilder();
            $qb->delete('knorke_links')
                ->where($qb->expr()->in('id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
            $n += $qb->executeStatement();
        }
        return $n;
    }

    /** @return array{id: int, token: string, role: string, created_by: string, created_at: int, revoked_at: ?int, password_hash: ?string, expires_at: ?int} */
    private static function link(array $r): array {
        return [
            'id' => (int)$r['id'],
            'token' => (string)$r['token'],
            'role' => (string)$r['role'],
            'created_by' => (string)$r['created_by'],
            'created_at' => (int)$r['created_at'],
            'revoked_at' => $r['revoked_at'] === null ? null : (int)$r['revoked_at'],
            'password_hash' => $r['password_hash'] === null || $r['password_hash'] === '' ? null : (string)$r['password_hash'],
            'expires_at' => $r['expires_at'] === null ? null : (int)$r['expires_at'],
        ];
    }

    /**
     * Adds a member; false = the row existed already. INSERT … ON CONFLICT DO
     * NOTHING (insertIgnoreConflict): no unique violation is ever raised, so
     * this is safe inside and outside a transaction.
     */
    public function addMember(int $board, string $uid, string $role, ?int $linkId, int $nowMs): bool {
        return $this->db->insertIgnoreConflict('knorke_members', [
            'board_id' => $board,
            'user_id' => $uid,
            'role' => $role,
            'link_id' => $linkId,
            'created_at' => $nowMs,
        ]) > 0;
    }

    /** One membership (the joining account's stale row, see BoardService::joinLinkAsUser). */
    public function deleteMember(int $board, string $uid): int {
        return $this->exec('DELETE FROM *PREFIX*knorke_members WHERE board_id = ? AND user_id = ?', [$board, $uid], [self::INT, self::STR]);
    }

    /** @param list<int> $linkIds */
    public function deleteMembersByLinks(int $board, array $linkIds): int {
        if ($linkIds === []) {
            return 0;
        }
        $qb = $this->db->getQueryBuilder();
        $qb->delete('knorke_members')
            ->where($qb->expr()->eq('board_id', $qb->createNamedParameter($board, self::INT)))
            ->andWhere($qb->expr()->in('link_id', $qb->createNamedParameter(array_values($linkIds), IQueryBuilder::PARAM_INT_ARRAY)));
        return $qb->executeStatement();
    }

    /** @return list<int> board ids of the deleted memberships */
    public function deleteMembershipsOf(string $uid): array {
        $ids = array_map(
            static fn (array $r): int => (int)$r['board_id'],
            $this->rows('SELECT board_id FROM *PREFIX*knorke_members WHERE user_id = ? ORDER BY board_id', [$uid], [self::STR]),
        );
        if ($ids !== []) {
            $this->exec('DELETE FROM *PREFIX*knorke_members WHERE user_id = ?', [$uid], [self::STR]);
        }
        return $ids;
    }

    /**
     * Every board id, ascending (repair step BackfillItemBytes, SPEC-M1 §3.1).
     *
     * @return list<int>
     */
    public function boardIds(): array {
        return array_map(
            static fn (array $r): int => (int)$r['id'],
            $this->rows('SELECT id FROM *PREFIX*knorke_boards ORDER BY id', [], []),
        );
    }

    /**
     * Every distinct account with a link membership, ascending
     * (OrphanReconciler, P7, SPEC-M1 §33.1 e).
     *
     * @return list<string>
     */
    public function memberUids(): array {
        return array_map(
            static fn (array $r): string => (string)$r['user_id'],
            $this->rows('SELECT DISTINCT user_id FROM *PREFIX*knorke_members ORDER BY user_id', [], []),
        );
    }

    /** Link memberships of one account (OrphanReconciler counts). */
    public function countMembershipsOf(string $uid): int {
        return (int)($this->rows('SELECT COUNT(*) AS n FROM *PREFIX*knorke_members WHERE user_id = ?', [$uid], [self::STR])[0]['n'] ?? 0);
    }

    /**
     * Every distinct board owner, ascending (OrphanReconciler).
     *
     * @return list<string>
     */
    public function ownerUids(): array {
        return array_map(
            static fn (array $r): string => (string)$r['owner'],
            $this->rows('SELECT DISTINCT owner FROM *PREFIX*knorke_boards ORDER BY owner', [], []),
        );
    }

    /** @return list<int> */
    public function boardsOwnedBy(string $uid): array {
        return array_map(
            static fn (array $r): int => (int)$r['id'],
            $this->rows('SELECT id FROM *PREFIX*knorke_boards WHERE owner = ? ORDER BY id', [$uid], [self::STR]),
        );
    }

    private static function board(array $row): array {
        $out = [];
        foreach (self::COLS as $c) {
            $out[$c] = in_array($c, self::INT_COLS, true) ? (int)$row[$c] : (string)$row[$c];
        }
        return $out;
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
