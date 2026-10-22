<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\ModerationService;
use OCA\Knorke\Service\PresenceStore;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Service\WriteBudget;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IDBConnection;
use Psr\Log\LoggerInterface;

/**
 * The stage-3 server (VoteService, ModerationService, MetaService,
 * SyncService) on a REAL SQL engine (SqliteDb, in memory) and the
 * in-memory Redis (MemoryCache). Stores run their production SQL; only the
 * three query-builder reads of ItemStore are replaced by the same SELECTs
 * in raw SQL (the object write path needs them in mixed batches).
 *
 * $log (shared with the cache) records "bumpRev <rev> tx=<0|1>" and
 * "setVoteSeq <sid>:<seq> tx=<0|1>": tx is IDBConnection::inTransaction()
 * at that moment — the R16 rule "bumpRev only after the COMMIT, never
 * inside a transaction" is checked on it. $warnings collects logger
 * warnings.
 */
final class VoteHarness {
    public const EPOCH = 'k3x9a0b2';

    public SqliteDb $sql;
    public IDBConnection $db;
    public MemoryCache $mem;
    public FastCache $cache;
    public PresenceStore $presence;
    public BoardStore $boards;
    public ItemStore $items;
    public VoteStore $store;
    public MetaService $meta;
    public VoteService $votes;
    public ModerationService $moderation;
    public SyncService $sync;
    /** @var list<string> */
    public array $log = [];
    /** @var list<string> */
    public array $warnings = [];
    public int $now = 1_760_000_000_000;

    public function __construct() {
        $this->sql = new SqliteDb();
        $this->db = $this->sql->connection();
        $this->mem = new MemoryCache();
        $epoch = (new EpochStub(self::EPOCH))->epoch();
        $sql = $this->sql;
        $log = &$this->log;
        $this->cache = new class($this->mem->factory(), $epoch, $log, $sql) extends FastCache {
            /** @param list<string> $log */
            public function __construct(\OCP\ICacheFactory $f, Epoch $e, private array &$log, private SqliteDb $sql) {
                parent::__construct($f, $e);
            }

            public function bumpRev(int $b, int $rev): void {
                $this->log[] = "bumpRev $rev tx=" . ($this->sql->depth > 0 ? 1 : 0);
                parent::bumpRev($b, $rev);
            }

            public function setVoteSeq(int $b, int $sid, int $seq): void {
                $this->log[] = "setVoteSeq $sid:$seq tx=" . ($this->sql->depth > 0 ? 1 : 0);
                parent::setVoteSeq($b, $sid, $seq);
            }
        };
        $this->presence = new PresenceStore($this->mem->factory(), $epoch);
        $this->boards = new BoardStore($this->db);
        $this->items = new SqlItemStore($this->db);
        $this->store = new VoteStore($this->db);
        $this->meta = new MetaService($this->boards, $this->cache, $this->db);
        $logger = Fake::of(LoggerInterface::class, [
            'warning' => function ($m, array $c = []): void {
                $this->warnings[] = (string)$m . (isset($c['exception']) ? ': ' . $c['exception']->getMessage() : '');
            },
        ]);
        $this->votes = new VoteService($this->store, $this->boards, $this->meta, $this->cache, $this->db, $logger);
        $this->moderation = new ModerationService($this->meta);
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $app, string $key, int $default = 0, ?bool $lazy = false): int => $default,
        ]);
        $config = Fake::of(IConfig::class, [
            'getSystemValueBool' => fn (string $key, bool $default = false): bool => $default,
            'getSystemValue' => fn (string $key, $default = '') => $default,
        ]);
        $limits = new Limits($appConfig);
        $this->sync = new SyncService($this->items, $this->cache, $this->presence, $this->db, $limits, $config, $epoch,
            $this->boards, $this->votes, new WriteBudget($this->cache, $limits));
    }

    /** An account principal; pid derived from the uid (stable per test). */
    public static function user(string $uid = 'alice', Role $role = Role::Owner, bool $facilitator = false, string $origin = ''): Principal {
        return new Principal('u:' . $uid, $role, ucfirst($uid) . ' Adler', substr(hash('sha256', 'pid|' . $uid), 0, 16), false, $uid,
            $origin !== '' ? $origin : ($role === Role::Owner ? 'owner' : 'share'), $facilitator);
    }

    public static function guest(string $gid = 'gAAAAAAAAAAA', Role $role = Role::Vote): Principal {
        return new Principal('g:' . $gid, $role, 'Gina', substr(hash('sha256', 'pid|' . $gid), 0, 16), true, null, 'guest');
    }

    public static function ulid(int $n): string {
        return sprintf('01JV%022d', $n);
    }

    /** A board with $n live stickies 01JV…1..n (and optionally a frame holding the first $inFrame of them). */
    public function board(int $n = 5, int $inFrame = 0, string $frameId = '01JVFRAME0000000000000000F'): int {
        $b = $this->sql->addBoard();
        if ($inFrame > 0) {
            $this->sql->addItem($b, $frameId, 'frame');
        }
        for ($i = 1; $i <= $n; $i++) {
            $this->sql->addItem($b, self::ulid($i), 'sticky', $i <= $inFrame ? $frameId : null);
        }
        return $b;
    }

    public static function vote(int $sid, int|string $item, int $n): array {
        return ['o' => 'vote', 's' => $sid, 'id' => is_int($item) ? self::ulid($item) : $item, 'n' => $n];
    }

    /** Decoded /sync answer of $p (raw body keys as the client sends them). */
    public function syncDecoded(array $body, Principal $p, int $board): array {
        return json_decode($this->syncRaw($body, $p, $board), true, 512, JSON_THROW_ON_ERROR);
    }

    public function syncRaw(array $body, Principal $p, int $board): string {
        $r = SyncRequest::fromBody($body + ['proto' => Application::PROTOCOL, 'client' => 'cTest', 'ep' => self::EPOCH, 'since' => 0]);
        return $this->sync->sync(new AccessResult($p, null, 0), $board, $r, $this->now);
    }

    /** Open session row of a board (raw). */
    public function session(int $sid): array {
        return $this->sql->all('SELECT * FROM *PREFIX*knorke_vote_sessions WHERE id = ?', [$sid])[0];
    }

    /** Stored meta of a board, decoded. */
    public function meta(int $board): array {
        return MetaService::decode($this->sql->one('SELECT meta FROM *PREFIX*knorke_boards WHERE id = ?', [$board]));
    }

    public function rev(int $board): int {
        return (int)$this->sql->one('SELECT rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board]);
    }

    public function voteRows(int $sid): int {
        return (int)$this->sql->one('SELECT COUNT(*) FROM *PREFIX*knorke_votes WHERE session_id = ?', [$sid]);
    }

    /** Every bumpRev/setVoteSeq of the log ran outside a transaction. */
    public function allOutsideTransactions(): bool {
        foreach ($this->log as $l) {
            if (str_ends_with($l, 'tx=1')) {
                return false;
            }
        }
        return true;
    }
}
