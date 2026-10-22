<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\BoardStore;

/**
 * In-memory BoardStore (boards, members, links) with a call log. Like the real
 * one, a membership through a link counts only while that link is active.
 * $onLock runs inside lockBoard() before it returns — what another
 * transaction committed while this one waited for the board row lock.
 * $onFindForUser runs at the start of every findBoardForUser() call (the
 * test disarms it) — what another transaction committed between two reads.
 * Board rows carry the M1 columns (meta_rev, vote_link_gen, item_bytes) and
 * `meta`, which only meta()/writeMeta() read and write (SPEC-M1 §4.13.4).
 * Links carry password_hash and expires_at (SPEC-M1 §3.3); a link that has
 * expired at the asked time grants no membership. $shares (if set) is the
 * share table listForUser() and deleteBoardRows() see.
 */
class FakeBoardStore extends BoardStore {
    /** @var array<int, array> */
    public array $boards = [];
    /** @var array<int, array<string, array{role: string, link_id: ?int}>> board → uid → member */
    public array $members = [];
    /** @var array<int, array{id: int, board_id: int, token: string, role: string, created_by: string, created_at: int, revoked_at: ?int, password_hash: ?string, expires_at: ?int}> */
    public array $links = [];
    public ?FakeShareStore $shares = null;
    /** @var list<string> */
    public array $log = [];
    public ?\Closure $onLock = null;
    /** @var (\Closure(int, string): void)|null */
    public ?\Closure $onFindForUser = null;
    private int $nextBoard = 1;
    private int $nextLink = 1;

    public function __construct() {
    }

    public function addBoard(string $owner, string $title = 'Board', int $rev = 0, int $acl = 1, int $link = 1, int $minRev = 0, int $voteLink = 1): int {
        $id = $this->nextBoard++;
        $this->boards[$id] = ['id' => $id, 'owner' => $owner, 'title' => $title, 'rev' => $rev, 'min_rev' => $minRev, 'meta_rev' => 0,
            'schema_version' => 1, 'item_count' => 0, 'item_bytes' => 0, 'acl_gen' => $acl, 'link_gen' => $link, 'vote_link_gen' => $voteLink,
            'created_at' => 0, 'updated_at' => $id, 'meta' => null];
        return $id;
    }

    /** A board row as the real BOARD_COLS read it: without meta. */
    private function row(int $board): ?array {
        $b = $this->boards[$board] ?? null;
        if ($b !== null) {
            unset($b['meta']);
        }
        return $b;
    }

    public function findBoard(int $board): ?array {
        $this->log[] = 'findBoard';
        return $this->row($board);
    }

    public function pin(): void {
        $this->log[] = 'pin';
    }

    public function findBoardForUser(int $board, string $uid, int $nowMs = 0): ?array {
        $this->log[] = 'findBoardForUser';
        if ($this->onFindForUser !== null) {
            ($this->onFindForUser)($board, $uid);
        }
        $b = $this->row($board);
        if ($b === null) {
            return null;
        }
        return $b + $this->memberCols($board, $uid, $nowMs);
    }

    /** @return array{member_role: ?string, member_link: ?int, member_link_expires: ?int} */
    private function memberCols(int $board, string $uid, int $nowMs): array {
        $m = $this->validMember($board, $uid, $nowMs);
        $l = $m === null || $m['link_id'] === null ? null : $this->links[$m['link_id']];
        return ['member_role' => $m['role'] ?? null, 'member_link' => $m['link_id'] ?? null, 'member_link_expires' => $l['expires_at'] ?? null];
    }

    /** The member row of $uid if it grants access (no link, or a valid link of this board: not revoked, not expired). */
    private function validMember(int $board, string $uid, int $nowMs = 0): ?array {
        $m = $this->members[$board][$uid] ?? null;
        if ($m === null || $m['link_id'] === null) {
            return $m;
        }
        $l = $this->links[$m['link_id']] ?? null;
        return $l !== null && $l['board_id'] === $board && $l['revoked_at'] === null
            && (($l['expires_at'] ?? null) === null || $l['expires_at'] > $nowMs) ? $m : null;
    }

    public function listForUser(string $uid, array $gids = [], array $teamIds = [], int $nowMs = 0): array {
        $this->log[] = 'listForUser';
        $out = [];
        foreach (array_keys($this->boards) as $id) {
            $b = $this->row($id);
            $m = $this->memberCols($id, $uid, $nowMs);
            $roles = [];
            foreach ($this->shares?->rows ?? [] as $r) {
                if ($r['board_id'] === $id && (($r['kind'] === 'user' && $r['recipient'] === $uid)
                    || ($r['kind'] === 'group' && in_array($r['recipient'], $gids, true))
                    || ($r['kind'] === 'team' && in_array($r['recipient'], $teamIds, true)))) {
                    $roles[] = $r['role'];
                }
            }
            if ($b['owner'] === $uid || $m['member_role'] !== null || $roles !== []) {
                $out[] = $b + $m + ['share_roles' => $roles];
            }
        }
        usort($out, static fn (array $a, array $b): int => [$b['updated_at'], $b['id']] <=> [$a['updated_at'], $a['id']]);
        return $out;
    }

    public function createBoard(string $owner, string $title, int $nowMs): int {
        $id = $this->addBoard($owner, $title);
        $this->boards[$id]['created_at'] = $this->boards[$id]['updated_at'] = $nowMs;
        return $id;
    }

    public function meta(int $board): ?array {
        $this->log[] = 'meta';
        $b = $this->boards[$board] ?? null;
        return $b === null ? null : ['title' => $b['title'], 'meta' => $b['meta'], 'meta_rev' => $b['meta_rev']];
    }

    /** Like the real one: meta_rev = rev + 1, rev = rev + 1 in one step; 0 = no such board. */
    public function writeMeta(int $board, ?string $title, ?string $meta, int $nowMs): int {
        $this->log[] = 'writeMeta' . ($title === null ? '' : ' title');
        if (!isset($this->boards[$board])) {
            return 0;
        }
        $b = &$this->boards[$board];
        $b['meta_rev'] = $b['rev'] + 1;
        $b['rev']++;
        $b['meta'] = $meta;
        $b['title'] = $title ?? $b['title'];
        $b['updated_at'] = $nowMs;
        return $b['rev'];
    }

    public function lockBoard(int $board, bool $bumpAcl, ?string $bumpLinkRole, int $nowMs): ?array {
        $this->log[] = 'lockBoard ' . ($bumpAcl ? 'acl' : '-') . ($bumpLinkRole ?? '-');
        if ($this->onLock !== null) {
            $hook = $this->onLock;
            $this->onLock = null;
            $hook($board);
        }
        if (!isset($this->boards[$board])) {
            return null;
        }
        $this->boards[$board]['acl_gen'] += $bumpAcl ? 1 : 0;
        $this->boards[$board]['link_gen'] += $bumpLinkRole === 'edit' ? 1 : 0;
        $this->boards[$board]['vote_link_gen'] += $bumpLinkRole === 'vote' ? 1 : 0;
        return $this->row($board);
    }

    public function deleteBoardRows(int $board): void {
        $this->log[] = 'deleteBoardRows';
        unset($this->boards[$board], $this->members[$board]);
        foreach ($this->shares?->rows ?? [] as $id => $r) {
            if ($r['board_id'] === $board) {
                unset($this->shares->rows[$id]);
            }
        }
    }

    public function countOwned(string $uid): int {
        return count(array_filter($this->boards, static fn (array $b): bool => $b['owner'] === $uid));
    }

    public function findLinkByToken(#[\SensitiveParameter] string $token): ?array {
        $this->log[] = 'findLinkByToken';
        foreach ($this->links as $l) {
            if (hash_equals($l['token'], $token)) {
                return $l + ['board' => $this->row($l['board_id'])];
            }
        }
        return null;
    }

    public function activeLinkOf(int $board, string $role = 'edit'): ?array {
        foreach (array_reverse($this->links) as $l) {
            if ($l['board_id'] === $board && $l['role'] === $role && $l['revoked_at'] === null) {
                $out = $l;
                unset($out['board_id']);
                return $out;
            }
        }
        return null;
    }

    public function linkOpenSince(int $board, int $nowMs): ?int {
        $since = null;
        foreach ($this->links as $l) {
            if ($l['board_id'] === $board && in_array($l['role'], ['edit', 'vote'], true) && $l['revoked_at'] === null
                && (($l['expires_at'] ?? null) === null || $l['expires_at'] > $nowMs)) {
                $since = max($since ?? $l['created_at'], $l['created_at']);
            }
        }
        return $since;
    }

    public function insertLink(int $board, #[\SensitiveParameter] string $token, string $role, string $by, int $nowMs,
        #[\SensitiveParameter] ?string $hash = null, ?int $expiresAt = null): int {
        $this->log[] = "insertLink $role";
        $id = $this->nextLink++;
        $this->links[$id] = ['id' => $id, 'board_id' => $board, 'token' => $token, 'role' => $role, 'created_by' => $by, 'created_at' => $nowMs,
            'revoked_at' => null, 'password_hash' => $hash, 'expires_at' => $expiresAt];
        return $id;
    }

    public function updateLinkSecrets(int $linkId, #[\SensitiveParameter] ?string $hash, ?int $expiresAt): void {
        $this->log[] = "updateLinkSecrets $linkId";
        $this->links[$linkId]['password_hash'] = $hash;
        $this->links[$linkId]['expires_at'] = $expiresAt;
    }

    public function replaceLinkHash(int $linkId, #[\SensitiveParameter] string $old, #[\SensitiveParameter] string $new): bool {
        $this->log[] = "replaceLinkHash $linkId";
        if (($this->links[$linkId]['password_hash'] ?? null) !== $old) {
            return false;
        }
        $this->links[$linkId]['password_hash'] = $new;
        return true;
    }

    public function revokeLinks(int $board, int $nowMs, string $role = 'edit'): array {
        $this->log[] = "revokeLinks $role";
        $ids = [];
        foreach ($this->links as $id => $l) {
            if ($l['board_id'] === $board && $l['role'] === $role && $l['revoked_at'] === null) {
                $this->links[$id]['revoked_at'] = $nowMs;
                $ids[] = $id;
            }
        }
        return $ids;
    }

    public function pruneLinks(int $olderThanMs): int {
        $n = 0;
        foreach ($this->links as $id => $l) {
            if (($l['revoked_at'] !== null && $l['revoked_at'] < $olderThanMs) || (($l['expires_at'] ?? null) !== null && $l['expires_at'] < $olderThanMs)) {
                unset($this->links[$id]);
                foreach ($this->members as $b => $ms) {
                    foreach ($ms as $uid => $m) {
                        if ($m['link_id'] === $id) {
                            unset($this->members[$b][$uid]);
                        }
                    }
                }
                $n++;
            }
        }
        return $n;
    }

    public function addMember(int $board, string $uid, string $role, ?int $linkId, int $nowMs): bool {
        $this->log[] = "addMember $uid";
        if (isset($this->members[$board][$uid])) {
            return false;
        }
        $this->members[$board][$uid] = ['role' => $role, 'link_id' => $linkId];
        return true;
    }

    public function deleteMember(int $board, string $uid): int {
        $this->log[] = "deleteMember $uid";
        $n = isset($this->members[$board][$uid]) ? 1 : 0;
        unset($this->members[$board][$uid]);
        return $n;
    }

    public function deleteMembersByLinks(int $board, array $linkIds): int {
        $n = 0;
        foreach ($this->members[$board] ?? [] as $uid => $m) {
            if ($m['link_id'] !== null && in_array($m['link_id'], $linkIds, true)) {
                unset($this->members[$board][$uid]);
                $n++;
            }
        }
        return $n;
    }

    public function deleteMembershipsOf(string $uid): array {
        $ids = [];
        foreach ($this->members as $board => $ms) {
            if (isset($ms[$uid])) {
                unset($this->members[$board][$uid]);
                $ids[] = $board;
            }
        }
        sort($ids);
        return $ids;
    }

    /** Every board id, ascending (Compactor::run, BackfillItemBytes). */
    public function boardIds(): array {
        $ids = array_keys($this->boards);
        sort($ids);
        return $ids;
    }

    public function boardsOwnedBy(string $uid): array {
        return array_values(array_map(static fn (array $b): int => $b['id'], array_filter($this->boards, static fn (array $b): bool => $b['owner'] === $uid)));
    }

    /** OrphanReconciler (P7): distinct member uids, ascending. */
    public function memberUids(): array {
        $out = [];
        foreach ($this->members as $ms) {
            foreach (array_keys($ms) as $uid) {
                $out[(string)$uid] = true;
            }
        }
        $out = array_keys($out);
        sort($out, SORT_STRING);
        return array_map('strval', $out);
    }

    public function countMembershipsOf(string $uid): int {
        $n = 0;
        foreach ($this->members as $ms) {
            $n += isset($ms[$uid]) ? 1 : 0;
        }
        return $n;
    }

    /** OrphanReconciler (P7): distinct owners, ascending. */
    public function ownerUids(): array {
        $out = array_values(array_unique(array_map(static fn (array $b): string => (string)$b['owner'], $this->boards)));
        sort($out, SORT_STRING);
        return $out;
    }
}
