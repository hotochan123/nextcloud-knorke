<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Exception\HttpError;
use OCP\IDBConnection;
use OCP\IUserManager;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;

/**
 * The tag list of a board (factory job 191, routes 44 and 45): meta.tags, a
 * list [{id, name, color}] of at most TAGS_PER_BOARD entries in the order
 * they were added. id has ULID form and comes from the client; name has
 * 1–TAG_NAME_MAX characters (Input::title) and is unique per board without
 * regard to case (mb_strtolower); color is #rrggbb, stored in lower case.
 * The tags of a note are its data.tags (ItemRegistry rule `tags`); only the
 * ids of meta.tags count, the ids of deleted tags stay in the notes until
 * their tags are written again (the client drops them then).
 *
 * write(): the right first (Role::canEdit(): owner, edit, guests of the edit
 * link → else 403 forbidden), then the budget knorke-tags (TAG_WRITE_LIMIT
 * per TAG_WRITE_PERIOD s and account; guests per IP) → 429 slow_down, then
 * the body (400 bad_request), then MetaService::write:
 *
 *   {action: 'add', tags: [{id, name, color}, …]}  1–TAGS_PER_BOARD entries;
 *       an entry whose id or name (also one added before in the same list)
 *       is taken is skipped; more than TAGS_PER_BOARD tags afterwards →
 *       409 tag_limit, nothing written
 *   {action: 'update', tag, name?, color?}  at least one of name and color;
 *       an unknown tag → 409 tag_gone, a name another tag has → 409 tag_exists
 *   {action: 'delete', tag}  an unknown tag writes nothing
 *
 * The tag id of update and delete is the body key `tag`: a body key `id`
 * would override the route's board id (JsonBody refuses it). A write
 * without effect (nothing added, the same name and colour, an unknown tag
 * deleted) writes nothing and answers the stored state with the same
 * metaRev. Answer: MetaService's {title, meta, metaRev}.
 *
 * Without 4-byte UTF-8 (IDBConnection::supports4ByteText() false: legacy
 * MySQL/MariaDB) every name of add and update goes through Input::bmp
 * BEFORE the uniqueness check: MetaService would store "🔥" and "💡" both as
 * U+FFFD, so two different names sent would become one stored name twice
 * (listOf keeps only the first, the other tag would vanish).
 */
class TagService {
    public const BUDGET = 'knorke-tags';
    public const ACTIONS = ['add', 'update', 'delete'];
    private const COLOR_RE = '/^#[0-9a-fA-F]{6}\z/';
    /** Body keys per action (besides `action`). */
    private const KEYS = ['add' => ['tags'], 'update' => ['tag', 'name', 'color'], 'delete' => ['tag']];

    public function __construct(
        private MetaService $meta,
        private ILimiter $limiter,
        private IUserManager $users,
        private IDBConnection $db,
    ) {
    }

    /**
     * @param array<string, mixed> $body the JsonBody of route 44 or 45
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 400 bad_request, 403 forbidden, 404 not_found, 409 tag_limit|tag_exists|tag_gone, 429 slow_down
     */
    public function write(Principal $p, int $board, array $body, string $ip, int $nowMs): array {
        if (!$p->role->canEdit()) {
            throw new HttpError(403, 'forbidden');
        }
        $this->budget($p, $ip);
        $action = $body['action'] ?? null;
        if (!is_string($action) || !in_array($action, self::ACTIONS, true)) {
            throw new HttpError(400, 'bad_request', 'Unknown action.');
        }
        foreach (array_keys($body) as $k) {
            if ($k !== 'action' && !in_array($k, self::KEYS[$action], true)) {
                throw new HttpError(400, 'bad_request', 'Unknown field for this action.');
            }
        }
        // the names as the database stores them (see the class comment)
        $bmp = !$this->db->supports4ByteText();
        $mutate = match ($action) {
            'add' => $this->adder(self::entries($body['tags'] ?? null, $bmp)),
            'update' => $this->updater(self::id($body['tag'] ?? null), $body, $bmp),
            'delete' => $this->deleter(self::id($body['tag'] ?? null)),
        };
        return $this->meta->write($board, $mutate, $nowMs);
    }

    /**
     * The stored tag list of a meta map, cleaned: every entry with a ULID,
     * a name and a colour, each id and name (case-insensitive) once, at most
     * TAGS_PER_BOARD; anything else is left out.
     *
     * @return list<array{id: string, name: string, color: string}>
     */
    public static function listOf(array $meta): array {
        $raw = $meta['tags'] ?? null;
        if (!is_array($raw) || !array_is_list($raw)) {
            return [];
        }
        $out = [];
        $ids = [];
        $names = [];
        foreach ($raw as $e) {
            if (!is_array($e) || !is_string($e['id'] ?? null) || preg_match(OpValidator::ULID_RE, $e['id']) !== 1
                || !is_string($e['name'] ?? null) || !is_string($e['color'] ?? null) || preg_match(self::COLOR_RE, $e['color']) !== 1) {
                continue;
            }
            $key = self::key($e['name']);
            if ($e['name'] === '' || isset($ids[$e['id']]) || isset($names[$key])) {
                continue;
            }
            $ids[$e['id']] = true;
            $names[$key] = true;
            $out[] = ['id' => $e['id'], 'name' => $e['name'], 'color' => strtolower($e['color'])];
            if (count($out) >= Limits::TAGS_PER_BOARD) {
                break;
            }
        }
        return $out;
    }

    /** @throws HttpError 429 slow_down */
    private function budget(Principal $p, string $ip): void {
        try {
            if ($p->isGuest) {
                $this->limiter->registerAnonRequest(self::BUDGET, Limits::TAG_WRITE_LIMIT, Limits::TAG_WRITE_PERIOD, $ip);
            } else {
                $user = $this->users->get((string)$p->uid) ?? throw new HttpError(404, 'not_found');
                $this->limiter->registerUserRequest(self::BUDGET, Limits::TAG_WRITE_LIMIT, Limits::TAG_WRITE_PERIOD, $user);
            }
        } catch (IRateLimitExceededException) {
            throw new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil(Limits::TAG_WRITE_PERIOD * 1000 / Limits::TAG_WRITE_LIMIT)]);
        }
    }

    /**
     * @param list<array{id: string, name: string, color: string}> $add
     * @return callable(array): ?array
     */
    private function adder(array $add): callable {
        return static function (array $meta) use ($add): ?array {
            $list = self::listOf($meta);
            $ids = array_fill_keys(array_column($list, 'id'), true);
            $names = array_fill_keys(array_map(self::key(...), array_column($list, 'name')), true);
            $added = 0;
            foreach ($add as $e) {
                $key = self::key($e['name']);
                if (isset($ids[$e['id']]) || isset($names[$key])) {
                    continue;
                }
                $ids[$e['id']] = true;
                $names[$key] = true;
                $list[] = $e;
                $added++;
            }
            if (count($list) > Limits::TAGS_PER_BOARD) {
                throw new HttpError(409, 'tag_limit', '', ['max' => Limits::TAGS_PER_BOARD]);
            }
            if ($added === 0) {
                return null;
            }
            $meta['tags'] = $list;
            return $meta;
        };
    }

    /** @return callable(array): ?array */
    private function updater(string $id, array $body, bool $bmp): callable {
        $hasName = array_key_exists('name', $body);
        $hasColor = array_key_exists('color', $body);
        if (!$hasName && !$hasColor) {
            throw new HttpError(400, 'bad_request', 'Nothing to change.');
        }
        $name = $hasName ? self::name($body['name'], $bmp) : null;
        $color = $hasColor ? self::color($body['color']) : null;
        return static function (array $meta) use ($id, $name, $color): ?array {
            $list = self::listOf($meta);
            $at = array_search($id, array_column($list, 'id'), true);
            if ($at === false) {
                throw new HttpError(409, 'tag_gone');
            }
            foreach ($list as $i => $e) {
                if ($i !== $at && $name !== null && self::key($e['name']) === self::key($name)) {
                    throw new HttpError(409, 'tag_exists');
                }
            }
            $next = ['id' => $id, 'name' => $name ?? $list[$at]['name'], 'color' => $color ?? $list[$at]['color']];
            if ($next === $list[$at]) {
                return null;
            }
            $list[$at] = $next;
            $meta['tags'] = $list;
            return $meta;
        };
    }

    /** @return callable(array): ?array */
    private function deleter(string $id): callable {
        return static function (array $meta) use ($id): ?array {
            $list = self::listOf($meta);
            $left = array_values(array_filter($list, static fn (array $e): bool => $e['id'] !== $id));
            if (count($left) === count($list)) {
                return null;
            }
            if ($left === []) {
                unset($meta['tags']);
            } else {
                $meta['tags'] = $left;
            }
            return $meta;
        };
    }

    /**
     * The entries of an add: a list of 1–TAGS_PER_BOARD maps of exactly id,
     * name and color, each valid.
     *
     * @param bool $bmp the database has no 4-byte UTF-8: names through Input::bmp
     * @return list<array{id: string, name: string, color: string}>
     * @throws HttpError 400 bad_request
     */
    private static function entries(mixed $v, bool $bmp): array {
        if (!is_array($v) || $v === [] || !array_is_list($v) || count($v) > Limits::TAGS_PER_BOARD) {
            throw new HttpError(400, 'bad_request', 'tags must be a list of 1–' . Limits::TAGS_PER_BOARD . ' tags.');
        }
        $out = [];
        foreach ($v as $e) {
            if (!is_array($e) || array_is_list($e)) {
                throw new HttpError(400, 'bad_request', 'A tag is {id, name, color}.');
            }
            $keys = array_keys($e);
            sort($keys);
            if ($keys !== ['color', 'id', 'name']) {
                throw new HttpError(400, 'bad_request', 'A tag is {id, name, color}.');
            }
            $out[] = ['id' => self::id($e['id']), 'name' => self::name($e['name'], $bmp), 'color' => self::color($e['color'])];
        }
        return $out;
    }

    /** @throws HttpError 400 bad_request */
    private static function id(mixed $v): string {
        if (!is_string($v) || preg_match(OpValidator::ULID_RE, $v) !== 1) {
            throw new HttpError(400, 'bad_request', 'A tag id is a ULID.');
        }
        return $v;
    }

    /**
     * A tag name: Input::title of at most TAG_NAME_MAX characters, not empty;
     * with $bmp through Input::bmp (the same number of code points).
     *
     * @throws HttpError 400 bad_request
     */
    private static function name(mixed $v, bool $bmp): string {
        $s = Input::title($v, Limits::TAG_NAME_MAX);
        if ($v === null || $s === null || $s === '') {
            throw new HttpError(400, 'bad_request', 'A tag name has 1–' . Limits::TAG_NAME_MAX . ' characters.');
        }
        return $bmp ? Input::bmp($s) : $s;
    }

    /** @throws HttpError 400 bad_request */
    private static function color(mixed $v): string {
        if (!is_string($v) || preg_match(self::COLOR_RE, $v) !== 1) {
            throw new HttpError(400, 'bad_request', 'A tag colour is #rrggbb.');
        }
        return strtolower($v);
    }

    /** The comparison form of a name: unique without regard to case. */
    private static function key(string $name): string {
        return mb_strtolower($name, 'UTF-8');
    }
}
