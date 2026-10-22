<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCP\IAppConfig;

/**
 * The one place for the limits of SPEC-M0 §4.8 (and SPEC-M1 §4.8).
 *
 * Constants are fixed. The ones marked "*" in the spec can be changed per
 * instance through the app config, for example
 *
 *   occ config:app:set knorke create_limit --value 1000
 *
 * Only a positive whole number overrides a default; anything else (unset, 0,
 * text, a value stored with another type) keeps it, so a typo never means
 * "unlimited" (Pulse rule).
 *
 * P7 (SPEC-M1 §33.1 a): the three byte keys budget_bytes_board_day,
 * budget_bytes_user_day and changes_bytes_cap count only as a stored text of
 * exactly 1–18 digits, where "0" switches the limit off (readBytes); the
 * link throttle link_limit follows the rule above (0 is not "off").
 */
class Limits {
    /** Operations per sync request (more → 400 too_many_ops). */
    public const MAX_OPS = 200;
    /** Paths per patch op (more → bad). */
    public const MAX_PATCH_PATHS = 50;
    /**
     * strlen(obj(data)) + strlen(obj(style)) after applying an op. Must stay
     * ≥ 4 × MAX_TEXT + 4 × MAX_TITLE + 8 KiB (4 UTF-8 bytes per code point,
     * obj() writes no \uXXXX escapes and no JSON_HEX_TAG).
     */
    public const MAX_ITEM_BYTES = 65536;
    /** Code points of data.text (mb_strlen). */
    public const MAX_TEXT = 6000;
    /** Board title and frame data.title. */
    public const MAX_TITLE = 200;
    /** Code points of a connector label data.label (SPEC-M1 §3.10). */
    public const MAX_LABEL = 200;
    /** Any other string value (generic check). */
    public const MAX_STRING = 6000;
    /** Request body; bigger → 413, missing Content-Length → 411. */
    public const MAX_BODY_BYTES = 1048576;
    /** Items per sync page. */
    public const PAGE = 500;
    /** |x| and |y| of an item. */
    public const NUM_ABS_MAX = 1e7;
    /** Ids in presence `s` and `d`. */
    public const PRESENCE_IDS = 20;
    /** Presence entries per pid (tabs); the oldest of the same pid goes. */
    public const PRESENCE_PER_PID = 3;
    /** Guest name after cleaning. */
    public const NAME_MAX = 40;
    /** Bytes of a guest token. */
    public const GUEST_TOKEN_MAX = 1024;
    /** Guest token lifetime in seconds (extended on every re-join). */
    public const GUEST_TTL = 30 * 24 * 3600;
    /** Age in ms after which CleanupJob deletes change rows and revoked links. */
    public const CHANGES_RETENTION_MS = 30 * 24 * 3600 * 1000;
    /** A presence entry is fresh (also for the text lease) for this many ms. */
    public const LEASE_FRESH_MS = 10000;
    /** strlen of the stored boards.meta JSON (SPEC-M1 §3.11); more → 400 meta_too_large. */
    public const MAX_META_BYTES = 262144;
    /** Shares per board (SPEC-M1 §4.8): a PUT with more → 400 too_many_shares {at, max}. */
    public const MAX_SHARES = 200;
    /** New recipients per PUT shares (SPEC-M1 §4.8, R2): more → 400 too_many_new_shares {at, max}. */
    public const MAX_NEW_SHARES = 20;
    /** Votes per person in a voting session (`per`), and the largest `n` of a vote op (SPEC-M1 §4.6, §4.8). */
    public const VOTE_PER_MAX = 99;
    /** Entries of meta.vote.results after the close (SPEC-M1 §3.11, §4.8). */
    public const VOTE_RESULTS_IN_META = 500;
    /** Minutes of a voting session or of one extension (SPEC-M1 §4.8, §4.12.1). */
    public const VOTE_MINUTES_MAX = 1440;
    /** Timer: shortest start/add (SPEC-M1 §4.12, R16), longest remaining time (99:59), largest add. */
    public const TIMER_MIN_MS = 1000;
    public const TIMER_MAX_MS = 5999000;
    public const TIMER_ADD_MAX_MS = 3600000;

    /**
     * Snapshot throttle (SPEC-M1 §4.1 routes 12, 14, 15, §4.8, §7.6): per
     * account (`knorke-snap`) or per gid and IP (`knorke-snap-<gid>`) 30 per
     * 60 s; per (board, IP) over all gids (`knorke-snapip-<board>`, routes 14
     * and 15) 300 per 60 s. Not overridable.
     */
    public const SNAPSHOT_LIMIT = 30;
    public const SNAPSHOT_PERIOD = 60;
    public const SNAPSHOT_IP_LIMIT = 300;
    public const SNAPSHOT_IP_PERIOD = 60;
    /** Write budget (SPEC-M1 §4.13.6): fixed windows of 10 s, counters live 25 s. */
    public const BUDGET_WINDOW_MS = 10000;
    public const BUDGET_TTL = 25;
    /**
     * Time budget of one run of CleanupJob (or occ knorke:compact without
     * --board, SPEC-M1 §4.13.7); the block size is ItemStore::PURGE_CHUNK.
     */
    public const CLEANUP_BUDGET_MS = 60000;

    /** Defaults of the overridable limits. */
    public const DEFAULT_MAX_ITEMS_PER_BOARD = 5000;
    /**
     * Σ strlen(data) + strlen(style) of the live items of a board (8 MiB).
     * MAX_ITEMS_PER_BOARD × MAX_ITEM_BYTES alone would allow ≈ 320 MiB, and
     * snapshot and sync build a board's JSON in PHP memory.
     */
    public const DEFAULT_MAX_BOARD_BYTES = 8388608;
    public const DEFAULT_MAX_BOARDS_PER_OWNER = 500;
    public const DEFAULT_CREATE_PER_10MIN = 30;
    /** Requests WITH ops per (board, pid) and 10-s window (SPEC-M1 §4.8 BUDGET_SYNCS). */
    public const DEFAULT_BUDGET_SYNCS = 60;
    /** Ops (plus derived rows) per (board, pid) and 10-s window (SPEC-M1 §4.8 BUDGET_OPS). */
    public const DEFAULT_BUDGET_OPS = 2000;
    /** Days a tombstone stays before the purge (SPEC-M1 §4.8 TOMBSTONE_RETENTION_DAYS). */
    public const DEFAULT_TOMBSTONE_DAYS = 30;
    /** Tombstones per board (SPEC-M1 §4.8 TOMBSTONE_CAP). */
    public const DEFAULT_TOMBSTONE_CAP = 10000;
    /** Change rows per board (SPEC-M1 §4.8 CHANGES_CAP). */
    public const DEFAULT_CHANGES_CAP = 100000;
    /**
     * P7 (SPEC-M1 §33.1 a/b): bytes of /sync requests with ops per board and
     * UTC day (256 MiB), per account over all boards (512 MiB); 0 = off.
     */
    public const DEFAULT_BUDGET_BYTES_BOARD_DAY = 268435456;
    public const DEFAULT_BUDGET_BYTES_USER_DAY = 536870912;
    /** P7 (§33.1 a/c): Σ octet_length(patch) of a board's change rows after the clean-up (64 MiB); 0 = off. */
    public const DEFAULT_CHANGES_BYTES_CAP = 67108864;
    /** P7 (§33.1 a/d): writing link calls (routes 9, 10, 17, 18) per account and LINK_PERIOD s. */
    public const DEFAULT_LINK_LIMIT = 20;
    public const LINK_PERIOD = 600;
    /** Fixed window of the daily byte quota (one UTC day) and the TTL of its counters (25 h). */
    public const BYTES_DAY_MS = 86400000;
    public const BYTES_DAY_TTL = 90000;
    /** The longest wait a busy answer of the daily quota asks for (then + 100 ms). */
    public const BYTES_RETRY_MAX_MS = 60000;

    /** App config keys of the overridable limits. */
    public const KEY_MAX_ITEMS_PER_BOARD = 'max_items_per_board';
    public const KEY_MAX_BOARD_BYTES = 'max_board_bytes';
    public const KEY_MAX_BOARDS_PER_OWNER = 'max_boards_per_owner';
    public const KEY_CREATE_PER_10MIN = 'create_limit';
    /**
     * Stage 4 (SPEC-M1 §4.8, §8.1): the keys the harness switches
     * (HARNESS_APP_CONFIG in dev/lib.sh and dev/sim/contract.mjs).
     */
    public const KEY_BUDGET_SYNCS = 'budget_syncs';
    public const KEY_BUDGET_OPS = 'budget_ops';
    public const KEY_TOMBSTONE_DAYS = 'tombstone_days';
    public const KEY_TOMBSTONE_CAP = 'tombstone_cap';
    public const KEY_CHANGES_CAP = 'changes_cap';
    /** P7 (SPEC-M1 §33.1 a): the byte keys (bytesOrDefault) and link_limit (read). */
    public const KEY_BUDGET_BYTES_BOARD_DAY = 'budget_bytes_board_day';
    public const KEY_BUDGET_BYTES_USER_DAY = 'budget_bytes_user_day';
    public const KEY_CHANGES_BYTES_CAP = 'changes_bytes_cap';
    public const KEY_LINK_LIMIT = 'link_limit';
    /** A byte key counts only as exactly this text (no sign, space or decimal point; §33.1 a, ED-01). */
    private const BYTES_RE = '/^[0-9]{1,18}\z/';

    public function __construct(
        private IAppConfig $appConfig,
    ) {
    }

    /** Live items per board (item_count); exceeding it answers `limit`. */
    public function maxItemsPerBoard(): int {
        return $this->read(self::KEY_MAX_ITEMS_PER_BOARD, self::DEFAULT_MAX_ITEMS_PER_BOARD);
    }

    /**
     * Byte budget of a board (boards.item_bytes): an op that grows the board
     * beyond it answers `limit`; ops that shrink it are always allowed.
     */
    public function maxBoardBytes(): int {
        return $this->read(self::KEY_MAX_BOARD_BYTES, self::DEFAULT_MAX_BOARD_BYTES);
    }

    /** Boards one account may own; creating more answers 429 rate_limited. */
    public function maxBoardsPerOwner(): int {
        return $this->read(self::KEY_MAX_BOARDS_PER_OWNER, self::DEFAULT_MAX_BOARDS_PER_OWNER);
    }

    /** Requests per 600 s of the `knorke-create` user limiter. */
    public function createPer10Min(): int {
        return $this->read(self::KEY_CREATE_PER_10MIN, self::DEFAULT_CREATE_PER_10MIN);
    }

    /** Write budget: requests with ops per (board, pid) and window (app config budget_syncs). */
    public function budgetSyncs(): int {
        return $this->read(self::KEY_BUDGET_SYNCS, self::DEFAULT_BUDGET_SYNCS);
    }

    /** Write budget: ops plus derived rows per (board, pid) and window (app config budget_ops). */
    public function budgetOps(): int {
        return $this->read(self::KEY_BUDGET_OPS, self::DEFAULT_BUDGET_OPS);
    }

    /** Tombstones older than this many days are purged (app config tombstone_days). */
    public function tombstoneDays(): int {
        return $this->read(self::KEY_TOMBSTONE_DAYS, self::DEFAULT_TOMBSTONE_DAYS);
    }

    /** The retention of tombstones in ms (tombstoneDays() × 86 400 000). */
    public function tombstoneRetentionMs(): int {
        return $this->tombstoneDays() * 86400000;
    }

    /** Tombstones kept per board beyond the retention (app config tombstone_cap). */
    public function tombstoneCap(): int {
        return $this->read(self::KEY_TOMBSTONE_CAP, self::DEFAULT_TOMBSTONE_CAP);
    }

    /** Change rows kept per board at least (app config changes_cap). */
    public function changesCap(): int {
        return $this->read(self::KEY_CHANGES_CAP, self::DEFAULT_CHANGES_CAP);
    }

    /** Bytes of /sync requests with ops per board and UTC day (app config budget_bytes_board_day); 0 = off. */
    public function budgetBytesBoardDay(): int {
        return $this->readBytes(self::KEY_BUDGET_BYTES_BOARD_DAY, self::DEFAULT_BUDGET_BYTES_BOARD_DAY);
    }

    /** Bytes of /sync requests with ops per account and UTC day over all boards (budget_bytes_user_day); 0 = off. */
    public function budgetBytesUserDay(): int {
        return $this->readBytes(self::KEY_BUDGET_BYTES_USER_DAY, self::DEFAULT_BUDGET_BYTES_USER_DAY);
    }

    /** Σ octet_length(patch) of a board's change rows the clean-up keeps at most (changes_bytes_cap); 0 = off. */
    public function changesBytesCap(): int {
        return $this->readBytes(self::KEY_CHANGES_BYTES_CAP, self::DEFAULT_CHANGES_BYTES_CAP);
    }

    /**
     * Writing link calls per account and LINK_PERIOD seconds (app config
     * link_limit, ILimiter key knorke-link). The rule of read(): 0 is not
     * "off" (ED-02).
     */
    public function linkLimit(): int {
        return $this->read(self::KEY_LINK_LIMIT, self::DEFAULT_LINK_LIMIT);
    }

    /**
     * The limits the client needs, as initial state `limits` (SPEC-M0 §6.6,
     * SPEC-M1 §4.8): an instance method, because maxItems is the EFFECTIVE
     * MAX_ITEMS_PER_BOARD (app config max_items_per_board overrides it) —
     * the client pre-checks a paste against it. maxLabel is the length of a
     * connector label.
     *
     * @return array{maxText: int, maxTitle: int, maxOps: int, nameMax: int, maxItemBytes: int, maxItems: int, maxLabel: int}
     */
    public function forClient(): array {
        return [
            'maxText' => self::MAX_TEXT,
            'maxTitle' => self::MAX_TITLE,
            'maxOps' => self::MAX_OPS,
            'nameMax' => self::NAME_MAX,
            'maxItemBytes' => self::MAX_ITEM_BYTES,
            'maxItems' => $this->maxItemsPerBoard(),
            'maxLabel' => self::MAX_LABEL,
        ];
    }

    private function read(string $key, int $default): int {
        try {
            $value = $this->appConfig->getValueInt(Application::APP_ID, $key, $default);
        } catch (\Throwable) {
            // Stored with an explicit non-integer type, or the config is not
            // readable right now: the default is always a safe answer.
            return $default;
        }
        return $value > 0 ? $value : $default;
    }

    /**
     * A byte key (SPEC-M1 §33.1 a, ED-01): only a stored text of exactly
     * 1–18 digits counts — "0" switches the limit off, any other digit
     * string is the limit in bytes. Anything else (unset, empty, text, a
     * sign, a decimal point, white space, unreadable, a type conflict) is the
     * default, so a typo never means "off". Not getValueInt alone: it turns
     * text into 0.
     */
    private function readBytes(string $key, int $default): int {
        try {
            $value = $this->appConfig->getValueString(Application::APP_ID, $key, '');
        } catch (\Throwable) {
            return $default;
        }
        return preg_match(self::BYTES_RE, $value) === 1 ? (int)$value : $default;
    }
}
