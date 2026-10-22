<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\ShareStore;

/**
 * In-memory ShareStore (knorke_shares) with a call log. Like the real one:
 * rows ordered by id, apply() deletes before it inserts, a second row for
 * the same (board, kind, recipient) is a UNIQUE violation (thrown, so a
 * test sees a diff that would break the index). $onApply runs before
 * apply() writes — what another transaction did meanwhile is simulated by
 * the tests through $onRead (runs at the start of every forBoard()).
 */
class FakeShareStore extends ShareStore {
    /** @var array<int, array> id → row */
    public array $rows = [];
    /** @var list<string> */
    public array $log = [];
    /** @var (\Closure(int): void)|null runs at the start of forBoard() (the test disarms it) */
    public ?\Closure $onRead = null;
    public ?\Throwable $failWith = null;
    private int $next = 1;

    public function __construct() {
    }

    /** A stored row as a test sets it up. */
    public function add(int $board, string $kind, string $recipient, string $role, ?string $displayName = null): int {
        $id = $this->next++;
        $this->rows[$id] = ['id' => $id, 'board_id' => $board, 'kind' => $kind, 'recipient' => $recipient, 'role' => $role,
            'display_name' => $displayName, 'created_by' => 'test', 'created_at' => 0];
        return $id;
    }

    public function forBoard(int $board): array {
        $this->log[] = 'forBoard ' . $board;
        if ($this->failWith !== null) {
            throw $this->failWith;
        }
        if ($this->onRead !== null) {
            ($this->onRead)($board);
        }
        $out = array_values(array_filter($this->rows, static fn (array $r): bool => $r['board_id'] === $board));
        usort($out, static fn (array $a, array $b): int => $a['id'] <=> $b['id']);
        return $out;
    }

    public function sharesFor(string $kind, array $recipients): array {
        $this->log[] = 'sharesFor ' . $kind;
        if ($this->failWith !== null) {
            throw $this->failWith;
        }
        $out = [];
        foreach ($this->rows as $r) {
            if ($r['kind'] === $kind && in_array($r['recipient'], $recipients, true)) {
                $out[] = ['board_id' => $r['board_id'], 'kind' => $r['kind'], 'recipient' => $r['recipient'], 'role' => $r['role']];
            }
        }
        usort($out, static fn (array $a, array $b): int => $a['board_id'] <=> $b['board_id']);
        return $out;
    }

    public function apply(int $board, array $insert, array $update, array $delete, string $by, int $nowMs): void {
        $this->log[] = 'apply ' . count($insert) . '/' . count($update) . '/' . count($delete);
        foreach ($delete as $id) {
            unset($this->rows[$id]);
        }
        foreach ($update as $u) {
            $this->rows[$u['id']]['role'] = $u['role'];
        }
        foreach ($insert as $i) {
            foreach ($this->rows as $r) {
                if ($r['board_id'] === $board && $r['kind'] === $i['kind'] && $r['recipient'] === $i['recipient']) {
                    throw new \LogicException('UNIQUE knorke_shares_target violated by ' . $i['kind'] . ' ' . $i['recipient']);
                }
            }
            $id = $this->next++;
            $this->rows[$id] = ['id' => $id, 'board_id' => $board, 'kind' => $i['kind'], 'recipient' => $i['recipient'], 'role' => $i['role'],
                'display_name' => $i['display_name'], 'created_by' => $by, 'created_at' => $nowMs];
        }
    }

    public function deleteRecipient(string $kind, string $recipient): array {
        $this->log[] = 'deleteRecipient ' . $kind . ' ' . $recipient;
        if ($this->failWith !== null) {
            throw $this->failWith;
        }
        $ids = $this->boardsFor($kind, [$recipient]);
        foreach ($this->rows as $id => $r) {
            if ($r['kind'] === $kind && $r['recipient'] === $recipient) {
                unset($this->rows[$id]);
            }
        }
        return $ids;
    }

    /** OrphanReconciler (P7): distinct recipients of $kind, ascending. */
    public function recipients(string $kind): array {
        $out = [];
        foreach ($this->rows as $r) {
            if ($r['kind'] === $kind) {
                $out[$r['recipient']] = true;
            }
        }
        $out = array_map('strval', array_keys($out));
        sort($out, SORT_STRING);
        return $out;
    }

    public function countRecipient(string $kind, string $recipient): int {
        return count(array_filter($this->rows, static fn (array $r): bool => $r['kind'] === $kind && $r['recipient'] === $recipient));
    }

    /** Rows of a board as "kind:recipient=role", sorted (assertions). */
    public function of(int $board): array {
        $out = [];
        foreach ($this->rows as $r) {
            if ($r['board_id'] === $board) {
                $out[] = $r['kind'] . ':' . $r['recipient'] . '=' . $r['role'];
            }
        }
        sort($out);
        return $out;
    }
}
