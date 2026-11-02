<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Exception\HttpError;

/**
 * Private writing and reveal (factory job 275, the M2 item "private mode",
 * SPEC-M1 §1.2), pure rules.
 *
 * meta.private = {scope: "board"|"frame", frame?: ULID, at: ms, by: name,
 * seq: n} while it runs; reveal removes it and keeps meta.privateSeq = its
 * seq (the next start counts on). Nothing in it is a text.
 *
 * A live item row is HIDDEN from principal p while meta.private is set when
 * it is a sticky note, created by someone else (created_by ≠ p->id), at or
 * after `at` (created_at), and the scope is the board or its parent is the
 * frame. Moderators and the owner see such notes covered as well. A hidden
 * row is sent with data {"covered":true} and style {} (no text, tags,
 * reactions or colour); id, type, placement, z, parent, group and lock stay.
 * created_by and created_at never leave the server.
 */
final class PrivateWriting {
    public const ACTIONS = ['start', 'reveal'];

    /** meta.private when it is set and well formed, else null. */
    public static function state(array $meta): ?array {
        $p = $meta['private'] ?? null;
        if (!is_array($p) || !is_int($p['at'] ?? null) || !in_array($p['scope'] ?? null, ['board', 'frame'], true)) {
            return null;
        }
        if ($p['scope'] === 'frame' && !is_string($p['frame'] ?? null)) {
            return null;
        }
        return $p;
    }

    /**
     * Is the row hidden from the principal id $who?
     *
     * @param array|null $priv state()
     * @param array $row a stored row with type, parent_id, created_by, created_at (deleted rows are never hidden)
     */
    public static function hides(?array $priv, string $who, array $row): bool {
        if ($priv === null || (string)($row['type'] ?? '') !== 'sticky' || (int)($row['deleted'] ?? 0) === 1) {
            return false;
        }
        $by = (string)($row['created_by'] ?? '');
        if ($by === '' || $by === $who || (int)($row['created_at'] ?? 0) < $priv['at']) {
            return false;
        }
        return $priv['scope'] === 'board' || (string)($row['parent_id'] ?? '') === $priv['frame'];
    }

    /** Paths someone else may patch on a hidden note (job 286): its placement and size. */
    public const PLACEMENT_PATHS = ['x', 'y', 'w', 'h', 'parent'];

    /**
     * May someone else patch the hidden note $row with $patch (job 286)?
     * Only when every path is one of PLACEMENT_PATHS and the note stays
     * hidden from $who with the new parent (frame scope: it stays in the
     * frame of private writing; board scope: any parent). Lane, column and
     * frame operations then carry covered children along; nothing of the
     * note but its place is written.
     *
     * @param array|null $priv state()
     * @param array $row the stored row
     * @param array $patch normalized patch, path => value
     */
    public static function placementStaysHidden(?array $priv, string $who, array $row, array $patch): bool {
        if ($patch === [] || array_diff(array_map('strval', array_keys($patch)), self::PLACEMENT_PATHS) !== []) {
            return false;
        }
        if (array_key_exists('parent', $patch)) {
            $row['parent_id'] = $patch['parent'];
        }
        return self::hides($priv, $who, $row);
    }

    /**
     * A put's data that carries `covered` (job 275): the covered form is the
     * server's, so a client may never store it (OpValidator: `bad`).
     */
    public static function claimsCover(mixed $data): bool {
        return is_array($data) && array_key_exists('covered', $data);
    }

    /** A patch path that writes data.covered (itself, below it, or a whole data map with it). */
    public static function coverPath(string $path, mixed $value): bool {
        return $path === 'data.covered' || str_starts_with($path, 'data.covered.') || ($path === 'data' && self::claimsCover($value));
    }

    /** The covered form of a row: data {"covered":true}, style {} (ItemStore::itemJson). */
    public static function coveredJson(array $row, ?\Closure $pidOf = null): string {
        $row['data'] = '{"covered":true}';
        $row['style'] = '{}';
        return ItemStore::itemJson($row, $pidOf);
    }

    /**
     * meta after `start` (null scope frame id = whole board).
     *
     * @throws HttpError 409 private_on | 409 vote_open
     */
    public static function startAfter(array $m, ?string $frame, int $nowMs, string $by): array {
        if (self::state($m) !== null) {
            throw new HttpError(409, 'private_on');
        }
        if (is_array($m['vote'] ?? null) && ($m['vote']['state'] ?? null) === 'open') {
            throw new HttpError(409, 'vote_open');
        }
        $seq = (is_int($m['privateSeq'] ?? null) ? $m['privateSeq'] : 0) + 1;
        $m['private'] = $frame === null
            ? ['scope' => 'board', 'at' => $nowMs, 'by' => $by, 'seq' => $seq]
            : ['scope' => 'frame', 'frame' => $frame, 'at' => $nowMs, 'by' => $by, 'seq' => $seq];
        unset($m['privateSeq']);
        return $m;
    }

    /** meta after `reveal`, null = nothing to reveal (nothing written). */
    public static function revealAfter(array $m): ?array {
        if (!array_key_exists('private', $m)) {
            return null;
        }
        $seq = is_array($m['private']) && is_int($m['private']['seq'] ?? null) ? $m['private']['seq'] : null;
        unset($m['private']);
        if ($seq !== null) {
            $m['privateSeq'] = $seq;
        }
        return $m;
    }
}
