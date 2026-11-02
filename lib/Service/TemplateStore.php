<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\PrimaryReads;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Notification\TemplateNotifications;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;

/**
 * Template suggestions (factory job 182, routes 28–34, table
 * knorke_templates of Version000400Date20261025000000). Raw portable SQL
 * like VoteStore, every SELECT from the primary (PrimaryReads).
 *
 * A row is `pending` (an account's suggestion: name, note, suggested_by) or
 * `adopted` (belongs to the Nextcloud: no note, no uid). The right of an
 * account (rightOf): an account of the Guests app (backend "Guests",
 * checked first) none (null), an admin (IGroupManager::isAdmin) 'save',
 * every other account 'suggest'.
 *
 *  - Route 28 listFor: {right, templates: every adopted one {id, name,
 *    sketch}, last adopted first, pending: the account's own suggestions
 *    {id, name, note, sketch, created}, newest first}; the Guests app: right
 *    null and two empty lists.
 *  - Route 29 create: an admin writes `adopted` (a note is not kept), any
 *    other account `pending`, at most MAX_PENDING open suggestions each
 *    (counted without a lock: two parallel requests may pass it by one).
 *  - Route 30 content: only of an adopted template, else 404.
 *  - Routes 31 rename, 33 adopt, 34 review: admins only (403).
 *  - Route 32 delete: an own pending row is withdrawn (no notification), a
 *    foreign pending row is rejected by an admin (template_rejected to
 *    whoever suggested it; anyone else gets 404), an adopted one is deleted
 *    by an admin (403 for anyone else).
 *  - Adopting is a conditional UPDATE on state = 'pending': two admins never
 *    adopt the same row twice (the second gets 404).
 *
 * Every check comes before the first write: an error writes nothing. A
 * foreign pending row answers 404 like an unknown id, so nobody learns that
 * it exists. Without supports4ByteText() name, note and content go through
 * Input::bmp. Notifications (TemplateNotifications) go after the write and
 * never change the answer.
 *
 * Limits (src/board/ownTemplates.js holds the same numbers, a node test
 * compares them): MAX_PENDING open suggestions per account; MAX_ITEMS
 * objects and MAX_BYTES of content (UTF-8); a name by Input::title of at
 * most NAME_MAX characters, a note of at most NOTE_MAX ('' → NULL); a sketch
 * of at most SKETCH_MAX entries in a SKETCH_W × SKETCH_H box. The server
 * checks only the envelope and the size of the content: the client checks
 * every item when it inserts one (clipboard.js validatePayload), and the
 * server checks every op at sync.
 *
 * A deleted account (UserDeletedListener → onUserDeleted): its pending
 * suggestions go, their admin notifications are done; adopted templates
 * carry no uid and stay.
 */
class TemplateStore {
    /** Open suggestions per account (admins have no limit, adopted templates none either). */
    public const MAX_PENDING = 10;
    /** Objects of one template (the clipboard's PASTE_MAX). */
    public const MAX_ITEMS = 1000;
    /** Bytes of the content as UTF-8 (the clipboard's CLIP_MAX_BYTES, 2 MiB). */
    public const MAX_BYTES = 2097152;
    /** Characters of a name (Input::title). */
    public const NAME_MAX = 100;
    /** Characters of the note to the admins (Input::title). */
    public const NOTE_MAX = 200;
    /** Entries of a sketch. */
    public const SKETCH_MAX = 40;
    /** The sketch's box: x and w in [0, SKETCH_W], y and h in [0, SKETCH_H]. */
    public const SKETCH_W = 120;
    public const SKETCH_H = 80;
    /** Request body of route 29: twice the content (JSON escapes) plus 64 KiB for the rest. */
    public const MAX_BODY_BYTES = 4194304 + 65536;

    public const PENDING = 'pending';
    public const ADOPTED = 'adopted';

    private const INT = IQueryBuilder::PARAM_INT;
    private const STR = IQueryBuilder::PARAM_STR;
    private const NUL = IQueryBuilder::PARAM_NULL;

    public function __construct(
        private IDBConnection $db,
        private IUserManager $users,
        private IGroupManager $groups,
        private TemplateNotifications $notes,
        private ?PrimaryReads $primary = null,
    ) {
    }

    /** The right of an account: null (Guests app), 'save' (admin) or 'suggest'. */
    public function rightOf(IUser $user): ?string {
        if ($user->getBackendClassName() === GuestsAppWhitelist::BACKEND) {
            return null;
        }
        return $this->groups->isAdmin($user->getUID()) ? 'save' : 'suggest';
    }

    /** Does the account decide on suggestions (rightOf 'save')? */
    public function isAdmin(IUser $user): bool {
        return $this->rightOf($user) === 'save';
    }

    /**
     * Route 28.
     *
     * @return array{right: ?string, templates: list<array<string, mixed>>, pending: list<array<string, mixed>>}
     */
    public function listFor(IUser $user): array {
        $right = $this->rightOf($user);
        if ($right === null) {
            return ['right' => null, 'templates' => [], 'pending' => []];
        }
        $templates = array_map(static fn (array $r): array => ['id' => (int)$r['id'], 'name' => (string)$r['name'], 'sketch' => self::storedSketch($r['sketch'])],
            $this->select('SELECT id, name, sketch FROM *PREFIX*knorke_templates WHERE state = ? ORDER BY adopted_at DESC, id DESC', [self::ADOPTED], [self::STR]));
        $pending = array_map(static fn (array $r): array => ['id' => (int)$r['id'], 'name' => (string)$r['name'], 'note' => $r['note'] === null ? null : (string)$r['note'],
            'sketch' => self::storedSketch($r['sketch']), 'created' => (int)$r['created_at']],
            $this->select('SELECT id, name, note, sketch, created_at FROM *PREFIX*knorke_templates WHERE state = ? AND suggested_by = ? ORDER BY created_at DESC, id DESC',
                [self::PENDING, $user->getUID()], [self::STR, self::STR]));
        return ['right' => $right, 'templates' => $templates, 'pending' => $pending];
    }

    /**
     * Route 29: an admin saves an adopted template, every other account
     * suggests one. Every check comes before the write.
     *
     * @param array<string, mixed> $body {name, note?, content, sketch} (JsonBody)
     * @return array{id: int, state: string}
     * @throws HttpError 400 name_required|bad_request, 403 forbidden, 409 suggestion_limit {max}, 413 too_large
     */
    public function create(IUser $user, array $body, int $nowMs): array {
        $right = $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $name = self::checkName($body['name'] ?? null);
        $note = self::checkNote($body['note'] ?? null);
        $content = self::checkContent($body['content'] ?? null);
        $sketch = self::sketchOf($body['sketch'] ?? null) ?? throw new HttpError(400, 'bad_request', 'Invalid sketch.');
        $uid = $user->getUID();
        $adopt = $right === 'save';
        if (!$adopt && $this->pendingCount($uid) >= self::MAX_PENDING) {
            throw new HttpError(409, 'suggestion_limit', '', ['max' => self::MAX_PENDING]);
        }
        if (!$this->db->supports4ByteText()) {
            $name = Input::bmp($name);
            $note = $note === null ? null : Input::bmp($note);
            $content = Input::bmp($content);
        }
        if ($adopt) {
            $note = null;
        }
        $this->exec(
            'INSERT INTO *PREFIX*knorke_templates (state, name, note, content, sketch, suggested_by, created_at, adopted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$adopt ? self::ADOPTED : self::PENDING, $name, $note, $content, self::encode($sketch), $adopt ? null : $uid, $nowMs, $adopt ? $nowMs : null],
            [self::STR, self::STR, $note === null ? self::NUL : self::STR, self::STR, self::STR, $adopt ? self::NUL : self::STR, self::INT, $adopt ? self::INT : self::NUL],
        );
        $id = $this->db->lastInsertId('*PREFIX*knorke_templates');
        if (!$adopt) {
            $this->notes->suggested($id);
        }
        return ['id' => $id, 'state' => $adopt ? self::ADOPTED : self::PENDING];
    }

    /**
     * Route 30: the content of an adopted template, verbatim.
     *
     * @throws HttpError 403 forbidden (Guests app), 404 not_found
     */
    public function content(IUser $user, int $id): string {
        if ($this->rightOf($user) === null) {
            throw new HttpError(403, 'forbidden');
        }
        $row = $this->select('SELECT content FROM *PREFIX*knorke_templates WHERE id = ? AND state = ?', [$id, self::ADOPTED], [self::INT, self::STR])[0] ?? null;
        if ($row === null || !is_string($row['content'])) {
            throw new HttpError(404, 'not_found');
        }
        return $row['content'];
    }

    /**
     * Route 31 (admins): renames an adopted template.
     *
     * @param array<string, mixed> $body {name} (JsonBody)
     * @return array{id: int, name: string}
     * @throws HttpError 400 name_required|bad_request, 403 forbidden, 404 not_found
     */
    public function rename(IUser $user, int $id, array $body): array {
        $this->requireAdmin($user);
        $name = self::checkName($body['name'] ?? null);
        if (!$this->db->supports4ByteText()) {
            $name = Input::bmp($name);
        }
        $this->requireRow($id, self::ADOPTED);
        $this->exec('UPDATE *PREFIX*knorke_templates SET name = ? WHERE id = ? AND state = ?', [$name, $id, self::ADOPTED], [self::STR, self::INT, self::STR]);
        return ['id' => $id, 'name' => $name];
    }

    /**
     * Route 32: withdraws an own suggestion, rejects a foreign one (admins),
     * deletes an adopted template (admins).
     *
     * @throws HttpError 403 forbidden, 404 not_found
     */
    public function delete(IUser $user, int $id): void {
        $right = $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $row = $this->find($id) ?? throw new HttpError(404, 'not_found');
        if ($row['state'] === self::ADOPTED) {
            if ($right !== 'save') {
                throw new HttpError(403, 'forbidden');
            }
            $this->exec('DELETE FROM *PREFIX*knorke_templates WHERE id = ? AND state = ?', [$id, self::ADOPTED], [self::INT, self::STR]);
            return;
        }
        $own = $row['suggested_by'] === $user->getUID();
        if (!$own && $right !== 'save') {
            throw new HttpError(404, 'not_found');
        }
        if ($this->exec('DELETE FROM *PREFIX*knorke_templates WHERE id = ? AND state = ?', [$id, self::PENDING], [self::INT, self::STR]) === 0) {
            // adopted meanwhile by another admin
            throw new HttpError(404, 'not_found');
        }
        $this->notes->processed($id);
        if (!$own && $row['suggested_by'] !== null) {
            $this->notes->decided($id, $row['suggested_by'], false, $row['name']);
        }
    }

    /**
     * Route 33 (admins): a pending suggestion becomes an adopted template;
     * a conditional UPDATE, so only one admin wins.
     *
     * @return array{id: int}
     * @throws HttpError 403 forbidden, 404 not_found
     */
    public function adopt(IUser $user, int $id, int $nowMs): array {
        $this->requireAdmin($user);
        $row = $this->requireRow($id, self::PENDING);
        $n = $this->exec(
            'UPDATE *PREFIX*knorke_templates SET state = ?, adopted_at = ?, note = NULL, suggested_by = NULL WHERE id = ? AND state = ?',
            [self::ADOPTED, $nowMs, $id, self::PENDING], [self::STR, self::INT, self::INT, self::STR],
        );
        if ($n === 0) {
            throw new HttpError(404, 'not_found');
        }
        $this->notes->processed($id);
        if ($row['suggested_by'] !== null) {
            $this->notes->decided($id, $row['suggested_by'], true, $row['name']);
        }
        return ['id' => $id];
    }

    /**
     * Route 34 (admins): the open suggestions, oldest first, with who made
     * them (display name, else the uid), and the adopted templates, last
     * adopted first.
     *
     * @return array{suggestions: list<array<string, mixed>>, templates: list<array<string, mixed>>}
     * @throws HttpError 403 forbidden
     */
    public function review(IUser $user): array {
        $this->requireAdmin($user);
        $names = [];
        $suggestions = [];
        foreach ($this->select('SELECT id, name, note, sketch, suggested_by, created_at FROM *PREFIX*knorke_templates WHERE state = ? ORDER BY created_at ASC, id ASC',
            [self::PENDING], [self::STR]) as $r) {
            $by = (string)$r['suggested_by'];
            $names[$by] ??= $this->users->getDisplayName($by) ?? $by;
            $suggestions[] = ['id' => (int)$r['id'], 'name' => (string)$r['name'], 'note' => $r['note'] === null ? null : (string)$r['note'],
                'sketch' => self::storedSketch($r['sketch']), 'by' => $names[$by], 'created' => (int)$r['created_at']];
        }
        $templates = array_map(static fn (array $r): array => ['id' => (int)$r['id'], 'name' => (string)$r['name'], 'sketch' => self::storedSketch($r['sketch']),
            'adopted' => (int)$r['adopted_at']],
            $this->select('SELECT id, name, sketch, adopted_at FROM *PREFIX*knorke_templates WHERE state = ? ORDER BY adopted_at DESC, id DESC', [self::ADOPTED], [self::STR]));
        return ['suggestions' => $suggestions, 'templates' => $templates];
    }

    /**
     * The row Notifier shows a template_suggested for: {name, suggested_by}
     * of a pending suggestion, null when it is gone or adopted.
     *
     * @return array{name: string, suggested_by: string}|null
     */
    public function pendingRow(int $id): ?array {
        $row = $this->find($id);
        if ($row === null || $row['state'] !== self::PENDING || $row['suggested_by'] === null) {
            return null;
        }
        return ['name' => $row['name'], 'suggested_by' => $row['suggested_by']];
    }

    /**
     * A deleted account (UserDeletedListener): its pending suggestions go,
     * their admin notifications are done. Adopted templates stay.
     */
    public function onUserDeleted(string $uid): void {
        $ids = array_map(static fn (array $r): int => (int)$r['id'],
            $this->select('SELECT id FROM *PREFIX*knorke_templates WHERE state = ? AND suggested_by = ? ORDER BY id', [self::PENDING, $uid], [self::STR, self::STR]));
        if ($ids === []) {
            return;
        }
        $this->exec('DELETE FROM *PREFIX*knorke_templates WHERE state = ? AND suggested_by = ?', [self::PENDING, $uid], [self::STR, self::STR]);
        foreach ($ids as $id) {
            $this->notes->processed($id);
        }
    }

    /** @throws HttpError 403 forbidden */
    private function requireAdmin(IUser $user): void {
        if (!$this->isAdmin($user)) {
            throw new HttpError(403, 'forbidden');
        }
    }

    /**
     * @return array{state: string, name: string, suggested_by: ?string}
     * @throws HttpError 404 not_found unless the row has $state
     */
    private function requireRow(int $id, string $state): array {
        $row = $this->find($id);
        if ($row === null || $row['state'] !== $state) {
            throw new HttpError(404, 'not_found');
        }
        return $row;
    }

    /** @return array{state: string, name: string, suggested_by: ?string}|null */
    private function find(int $id): ?array {
        $row = $this->select('SELECT state, name, suggested_by FROM *PREFIX*knorke_templates WHERE id = ?', [$id], [self::INT])[0] ?? null;
        if ($row === null) {
            return null;
        }
        return ['state' => (string)$row['state'], 'name' => (string)$row['name'], 'suggested_by' => $row['suggested_by'] === null ? null : (string)$row['suggested_by']];
    }

    /** @return list<string> the accounts with a pending suggestion (job 247, OrphanReconciler) */
    public function pendingUids(): array {
        return array_values(array_map(static fn (array $r): string => (string)$r['suggested_by'],
            $this->select('SELECT DISTINCT suggested_by FROM *PREFIX*knorke_templates WHERE state = ? AND suggested_by IS NOT NULL', [self::PENDING], [self::STR])));
    }

    /** Pending suggestions of $uid (also OrphanReconciler, job 247). */
    public function pendingCount(string $uid): int {
        $row = $this->select('SELECT COUNT(*) AS n FROM *PREFIX*knorke_templates WHERE state = ? AND suggested_by = ?', [self::PENDING, $uid], [self::STR, self::STR])[0] ?? null;
        return (int)($row['n'] ?? 0);
    }

    /**
     * Rows of a raw SELECT (column names lower case), from the primary.
     *
     * @return list<array<string, mixed>>
     */
    private function select(string $sql, array $params, array $types): array {
        $this->primary?->pin();
        $res = $this->db->executeQuery($sql, $params, $types);
        $out = [];
        while (($r = $res->fetchAssociative()) !== false) {
            $out[] = array_change_key_case($r, CASE_LOWER);
        }
        $res->closeCursor();
        return $out;
    }

    private function exec(string $sql, array $params, array $types): int {
        return $this->db->executeStatement($sql, $params, $types);
    }

    /** @param list<array> $sketch */
    private static function encode(array $sketch): string {
        return json_encode($sketch, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * A stored sketch in its wire form; one that does not read back in the
     * form route 29 accepts is empty.
     *
     * @return list<array>
     */
    private static function storedSketch(mixed $v): array {
        if (!is_string($v)) {
            return [];
        }
        try {
            return self::sketchOf(json_decode($v, true, 8, JSON_THROW_ON_ERROR)) ?? [];
        } catch (\JsonException) {
            return [];
        }
    }

    /** @throws HttpError 400 name_required (empty) | bad_request (no text, control characters, too long) */
    private static function checkName(mixed $v): string {
        $name = Input::title($v, self::NAME_MAX);
        if ($name === '') {
            throw new HttpError(400, 'name_required');
        }
        if ($name === null) {
            throw new HttpError(400, 'bad_request', 'Invalid template name.');
        }
        return $name;
    }

    /**
     * The note to the admins: trimmed, at most NOTE_MAX characters, no
     * control characters (line breaks included); empty or missing → null.
     *
     * @throws HttpError 400 bad_request
     */
    private static function checkNote(mixed $v): ?string {
        $note = Input::title($v, self::NOTE_MAX);
        if ($note === null) {
            throw new HttpError(400, 'bad_request', 'Invalid note.');
        }
        return $note === '' ? null : $note;
    }

    /**
     * The content's envelope and size: a string of at most MAX_BYTES whose
     * JSON is an object with knorke === 1, kind === 'board', a string title
     * and 1–MAX_ITEMS items.
     *
     * @throws HttpError 400 bad_request, 413 too_large
     */
    private static function checkContent(mixed $v): string {
        if (!is_string($v)) {
            throw new HttpError(400, 'bad_request', 'content must be text.');
        }
        if (strlen($v) > self::MAX_BYTES) {
            throw new HttpError(413, 'too_large', 'The template is too large.');
        }
        try {
            $doc = json_decode($v, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpError(400, 'bad_request', 'content is not valid JSON.');
        }
        if (!$doc instanceof \stdClass || ($doc->knorke ?? null) !== 1 || ($doc->kind ?? null) !== 'board'
            || !is_string($doc->title ?? null) || !is_array($doc->items ?? null) || !array_is_list($doc->items)) {
            throw new HttpError(400, 'bad_request', 'content is not a board file.');
        }
        if (count($doc->items) > self::MAX_ITEMS) {
            throw new HttpError(413, 'too_large', 'The template has too many items.');
        }
        if ($doc->items === []) {
            throw new HttpError(400, 'bad_request', 'The template has no items.');
        }
        return $v;
    }

    /**
     * A sketch: a list of at most SKETCH_MAX entries [x, y, w, h, fill] with
     * x, w ∈ [0, SKETCH_W], y, h ∈ [0, SKETCH_H] and fill '' or #rrggbb
     * (kept in lower case). Anything else: null.
     *
     * @return list<array{0: int|float, 1: int|float, 2: int|float, 3: int|float, 4: string}>|null
     */
    private static function sketchOf(mixed $v): ?array {
        if (!is_array($v) || !array_is_list($v) || count($v) > self::SKETCH_MAX) {
            return null;
        }
        $out = [];
        foreach ($v as $e) {
            if (!is_array($e) || !array_is_list($e) || count($e) !== 5) {
                return null;
            }
            [$x, $y, $w, $h, $fill] = $e;
            if (!self::within($x, self::SKETCH_W) || !self::within($y, self::SKETCH_H) || !self::within($w, self::SKETCH_W) || !self::within($h, self::SKETCH_H)
                || !is_string($fill) || ($fill !== '' && preg_match('/^#[0-9a-fA-F]{6}$/D', $fill) !== 1)) {
                return null;
            }
            $out[] = [$x, $y, $w, $h, strtolower($fill)];
        }
        return $out;
    }

    private static function within(mixed $v, int $max): bool {
        return (is_int($v) || (is_float($v) && is_finite($v))) && $v >= 0 && $v <= $max;
    }
}
