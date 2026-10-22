<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCP\AppFramework\Db\TTransactional;
use OCP\IDBConnection;

/**
 * The meta write path (SPEC-M1 §4.13.4, §3.11, §4.7 rule 17): board title
 * and the board metadata `meta` (timer, vote, summon) change live for every
 * open client through the rev space.
 *
 *   atomic():
 *     lockBoard (FIRST statement, no bump) → 404 when the board is gone
 *     BoardStore::meta() — read AFTER the lock (lockBoard never reads meta)
 *     $mutate(meta) — may throw HttpError (409 …); the result must be a map
 *     strlen(stored JSON) > MAX_META_BYTES → 400 meta_too_large
 *     UPDATE … [title,] meta, meta_rev = rev + 1, rev = rev + 1 (one statement)
 *   after COMMIT: FastCache::bumpRev — every poller leaves the fast path once
 *
 * No change row is written (activity log: M2). Pollers get `board` on the
 * slow path as long as their cursor is below meta_rev (SyncService).
 *
 * Never inside an open transaction (SPEC-M1 §4.13.4, R16): a nested
 * atomic() is only a SAVEPOINT in Nextcloud 34/35, so bumpRev would run
 * before the outer COMMIT and a poller could move its cursor past a meta
 * change it cannot see yet. write() therefore refuses to run inside a
 * transaction. A caller with its own transaction (VoteService: closing a
 * session, update) uses writeLocked() — same checks and statement, no
 * atomic(), no bumpRev — after its own lockBoard, and calls
 * FastCache::bumpRev itself after its COMMIT.
 *
 * A mutation that returns null changes nothing (SPEC-M1 §4.12, R16: actions
 * without effect): write() then writes nothing, bumps nothing and answers
 * the state stored under the lock (same metaRev).
 *
 * Legacy MySQL/MariaDB without 4-byte UTF-8 (mysql.utf8mb4 = false, SPEC-M1
 * §3.9): every string in meta (timer/moderator names) and the title get the
 * U+FFFD replacement of Input::bmp here, in the one write path, instead of a
 * 500 from the database.
 *
 * The answer is {title, meta, metaRev}: the stored title (the new one or the
 * one kept), the stored meta (an empty map is stored as NULL = {}), and the
 * new rev. Encode `meta` with MetaService::json() (text) or hand it to a
 * JSONResponse through MetaService::object(): an empty PHP array would
 * otherwise become [] instead of {}.
 */
class MetaService {
    use TTransactional;

    /** Same encoding as data/style (SPEC-M0 §4.8): no \u escapes, no JSON_HEX_TAG. */
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;

    public function __construct(
        private BoardStore $boards,
        private FastCache $cache,
        private IDBConnection $db,
    ) {
    }

    /**
     * @param callable(array): ?array $mutate gets the current meta map, returns the new one (null = no change)
     * @param string|null $title a new title (already checked by the caller), null = keep
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 404 not_found | 400 meta_too_large | whatever $mutate throws
     * @throws \LogicException inside an open transaction (R16)
     */
    public function write(int $board, callable $mutate, int $nowMs, ?string $title = null): array {
        if ($this->db->inTransaction()) {
            throw new \LogicException('Knorke: MetaService::write inside an open transaction (use writeLocked)');
        }
        $out = $this->atomic(function () use ($board, $mutate, $nowMs, $title): array {
            $this->boards->lockBoard($board, false, null, $nowMs) ?? throw new HttpError(404, 'not_found');
            return $this->writeLocked($board, $mutate, $nowMs, $title);
        }, $this->db);
        // After COMMIT, never before: a poller would look for a rev it cannot see yet.
        if ($out['written']) {
            $this->cache->bumpRev($board, $out['metaRev']);
        }
        unset($out['written']);
        return $out;
    }

    /**
     * The meta write inside the CALLER's transaction (SPEC-M1 §4.13.4, R16):
     * precondition lockBoard($board) as the first statement of the open
     * transaction. Reads meta after the lock, applies $mutate, writes title,
     * meta, meta_rev = rev + 1, rev + 1 in one statement. No atomic(), no
     * bumpRev: the caller bumps r:<board> to metaRev after its COMMIT (only
     * when written is true). A mutation returning null writes nothing.
     *
     * @param callable(array): ?array $mutate
     * @return array{title: string, meta: array, metaRev: int, written: bool}
     * @throws HttpError 404 not_found | 400 meta_too_large | whatever $mutate throws
     * @throws \LogicException outside a transaction
     */
    public function writeLocked(int $board, callable $mutate, int $nowMs, ?string $title = null): array {
        if (!$this->db->inTransaction()) {
            throw new \LogicException('Knorke: MetaService::writeLocked needs the transaction and board lock of its caller');
        }
        $cur = $this->boards->meta($board) ?? throw new HttpError(404, 'not_found');
        $meta = $mutate(self::decode($cur['meta']));
        if ($meta === null && $title === null) {
            return ['title' => $cur['title'], 'meta' => self::decode($cur['meta']), 'metaRev' => $cur['meta_rev'], 'written' => false];
        }
        $meta ??= self::decode($cur['meta']);
        if (!is_array($meta) || ($meta !== [] && array_is_list($meta))) {
            throw new \LogicException('Knorke: a meta mutation must return a map');
        }
        if (!$this->db->supports4ByteText()) {
            $meta = self::bmp($meta);
            $title = $title === null ? null : Input::bmp($title);
        }
        $json = $meta === [] ? null : json_encode($meta, self::JSON_FLAGS);
        if ($json !== null && strlen($json) > Limits::MAX_META_BYTES) {
            throw new HttpError(400, 'meta_too_large');
        }
        $rev = $this->boards->writeMeta($board, $title, $json, $nowMs);
        if ($rev === 0) {
            throw new HttpError(404, 'not_found');
        }
        return ['title' => $title ?? $cur['title'], 'meta' => $meta, 'metaRev' => $rev, 'written' => true];
    }

    /**
     * Title, meta and meta_rev as stored, or null for an unknown board.
     *
     * @return array{title: string, meta: array, metaRev: int}|null
     */
    public function read(int $board): ?array {
        $cur = $this->boards->meta($board);
        if ($cur === null) {
            return null;
        }
        return ['title' => $cur['title'], 'meta' => self::decode($cur['meta']), 'metaRev' => $cur['meta_rev']];
    }

    /**
     * A meta map as a value for JSONResponse (array data, json_encode'd by
     * Nextcloud): an empty map becomes an empty stdClass so it encodes as {}
     * instead of []; a non-empty map is never a list (write() and decode()
     * refuse lists) and encodes as an object as it is.
     */
    public static function object(array $meta): array|\stdClass {
        return $meta === [] ? new \stdClass() : $meta;
    }

    /** JSON object text of a meta map: "{}" when empty, never "[]". */
    public static function json(array $meta): string {
        return $meta === [] ? '{}' : json_encode($meta, self::JSON_FLAGS | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    /**
     * Wire form of the STORED meta JSON (snapshot, sync `board`): the stored
     * text verbatim when it is a JSON object (write() stored it with the
     * JSON_FLAGS, so {} stays {} at every depth), "{}" for NULL and anything
     * else.
     */
    public static function wire(?string $stored): string {
        return self::decode($stored) === [] ? '{}' : (string)$stored;
    }

    /** Input::bmp on every string (keys included) of a meta map. */
    private static function bmp(array $map): array {
        $out = [];
        foreach ($map as $k => $v) {
            $out[is_string($k) ? Input::bmp($k) : $k] = is_array($v) ? self::bmp($v) : (is_string($v) ? Input::bmp($v) : $v);
        }
        return $out;
    }

    /**
     * The stored meta JSON as a map: NULL, '' and anything that is not a JSON
     * object (corrupt, a list) count as {}.
     */
    public static function decode(?string $stored): array {
        if ($stored === null || $stored === '') {
            return [];
        }
        $meta = json_decode($stored, true);
        return is_array($meta) && ($meta === [] || !array_is_list($meta)) ? $meta : [];
    }
}
