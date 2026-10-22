<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\PresenceStore;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SyncService;
use OCP\ICacheFactory;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IMemcacheTTL;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Server;
use PHPUnit\Framework\TestCase;

/**
 * Base of the integration tests (SPEC-M0 §9.2): real services from the
 * server container, the real database (PostgreSQL, MariaDB, MySQL or SQLite,
 * whatever the dev stack runs: KD_DB) and Redis of the dev stack. Every test
 * works with its own Nextcloud account knorke-it-<random> (a real one: the
 * link policy asks the share manager about the owner) and removes all rows
 * of its boards (links included), their Redis keys and the account in
 * tearDown (votes and voting sessions too). $redis is the raw distributed
 * cache under the same prefix as FastCache and PresenceStore:
 * 'knorke/<epoch>/' (SPEC-M1 §5.1).
 */
abstract class IntegrationCase extends TestCase {
    protected string $uid;
    protected IDBConnection $db;
    protected ItemStore $items;
    protected BoardStore $boards;
    protected FastCache $cache;
    protected PresenceStore $presence;
    protected SyncService $sync;
    protected Access $access;
    protected IMemcacheTTL $redis;
    /** @var list<int> */
    protected array $created = [];
    private ?IUser $account = null;

    protected function setUp(): void {
        $this->uid = 'knorke-it-' . bin2hex(random_bytes(4));
        $this->account = Server::get(IUserManager::class)->createUser($this->uid, 'Kt1!' . bin2hex(random_bytes(12))) ?: null;
        $this->assertNotNull($this->account, 'test account created');
        $this->db = Server::get(IDBConnection::class);
        $this->items = Server::get(ItemStore::class);
        $this->boards = Server::get(BoardStore::class);
        $this->cache = Server::get(FastCache::class);
        $this->presence = Server::get(PresenceStore::class);
        $this->sync = Server::get(SyncService::class);
        $this->access = Server::get(Access::class);
        $redis = Server::get(ICacheFactory::class)->createDistributed('knorke/' . Server::get(Epoch::class)->current() . '/');
        $this->assertInstanceOf(IMemcacheTTL::class, $redis, 'the dev stack runs Redis');
        $this->redis = $redis;
        $this->assertTrue($this->cache->available());
    }

    protected function tearDown(): void {
        foreach ($this->created as $b) {
            $this->db->executeStatement('DELETE FROM *PREFIX*knorke_votes WHERE session_id IN (SELECT id FROM *PREFIX*knorke_vote_sessions WHERE board_id = ?)', [$b]);
            foreach (['knorke_changes', 'knorke_items', 'knorke_members', 'knorke_links', 'knorke_shares', 'knorke_vote_sessions'] as $t) {
                $this->db->executeStatement('DELETE FROM *PREFIX*' . $t . ' WHERE board_id = ?', [$b]);
            }
            $this->db->executeStatement('DELETE FROM *PREFIX*knorke_boards WHERE id = ?', [$b]);
            foreach (['r:', 'a:', 'p:', 'vt:'] as $k) {
                $this->redis->remove($k . $b);
            }
        }
        $this->created = [];
        $this->account?->delete();
        $this->account = null;
    }

    protected function board(?string $owner = null, string $title = 'IT'): int {
        $id = $this->boards->createBoard($owner ?? $this->uid, $title, self::nowMs());
        $this->created[] = $id;
        return $id;
    }

    protected function owner(int $board, ?string $uid = null): Principal {
        $uid ??= $this->uid;
        return new Principal('u:' . $uid, Role::Owner, $uid, $this->access->pid($board, 'u:' . $uid), false, $uid, 'owner');
    }

    protected function guest(int $board, string $gid = 'gITGUEST0001', string $name = 'Gina'): Principal {
        return new Principal('g:' . $gid, Role::Edit, $name, $this->access->pid($board, 'g:' . $gid), true, null, 'guest');
    }

    protected static function nowMs(): int {
        return (int)floor(microtime(true) * 1000);
    }

    protected static function ulid(int $n): string {
        return sprintf('01JZ%022d', $n);
    }

    /** Board rev straight from the database. */
    protected function dbRev(int $board): int {
        return (int)$this->db->executeQuery('SELECT rev FROM *PREFIX*knorke_boards WHERE id = ?', [$board])->fetchOne();
    }

    protected static function config(): IConfig {
        return Server::get(IConfig::class);
    }

    /**
     * [stored item_bytes, Σ strlen(data) + strlen(style) over the live rows
     * computed here in PHP] — the board byte budget's invariant.
     *
     * @return array{0: int, 1: int}
     */
    protected function bytes(int $board): array {
        $stored = (int)$this->db->executeQuery('SELECT item_bytes FROM *PREFIX*knorke_boards WHERE id = ?', [$board])->fetchOne();
        $res = $this->db->executeQuery('SELECT data, style FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0', [$board]);
        $sum = 0;
        while (($r = $res->fetchAssociative()) !== false) {
            $sum += strlen((string)$r['data']) + strlen((string)$r['style']);
        }
        $res->closeCursor();
        return [$stored, $sum];
    }

    protected function itemCount(int $board): int {
        return (int)$this->db->executeQuery('SELECT item_count FROM *PREFIX*knorke_boards WHERE id = ?', [$board])->fetchOne();
    }

    /**
     * The database kind of the stack: pgsql | mysql (MySQL and MariaDB) |
     * sqlite. Tests that depend on it say so explicitly (skip with a reason,
     * never silently).
     */
    protected static function dbKind(): string {
        return match (Server::get(IDBConnection::class)->getDatabaseProvider()) {
            IDBConnection::PLATFORM_POSTGRES => 'pgsql',
            IDBConnection::PLATFORM_MYSQL, IDBConnection::PLATFORM_MARIADB => 'mysql',
            IDBConnection::PLATFORM_SQLITE => 'sqlite',
            default => 'other',
        };
    }

    /**
     * A second, raw PDO connection's parameters (config.php): PHP shares one
     * IDBConnection per process, lock tests need another session. pgsql and
     * mysql over TCP (dbhost[:port]); sqlite the file datadirectory/dbname.db
     * like Nextcloud's ConnectionFactory; mysql with the charset Nextcloud
     * uses (utf8mb4, or utf8 with mysql.utf8mb4 = false).
     *
     * @return array{0: string, 1: string, 2: string, 3: string} [dsn, user, password, table prefix]
     */
    protected static function pdoParams(): array {
        $c = self::config();
        $prefix = $c->getSystemValueString('dbtableprefix', 'oc_');
        $name = $c->getSystemValueString('dbname', 'owncloud');
        $kind = self::dbKind();
        if ($kind === 'sqlite') {
            return ['sqlite:' . $c->getSystemValueString('datadirectory', \OC::$SERVERROOT . '/data') . '/' . $name . '.db', '', '', $prefix];
        }
        $host = $c->getSystemValueString('dbhost');
        $port = $kind === 'mysql' ? '3306' : '5432';
        if (str_contains($host, ':')) {
            [$host, $port] = explode(':', $host, 2);
        }
        $dsn = match ($kind) {
            'pgsql' => 'pgsql:host=' . $host . ';port=' . $port . ';dbname=' . $name,
            'mysql' => 'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $name . ';charset=' . ($c->getSystemValueBool('mysql.utf8mb4', false) ? 'utf8mb4' : 'utf8'),
            default => self::markTestSkipped('no raw PDO connection for database kind ' . $kind),
        };
        return [$dsn, $c->getSystemValueString('dbuser'), $c->getSystemValueString('dbpassword'), $prefix];
    }

    /**
     * A second session that gives up waiting for a lock after about one
     * second, and how its "lock wait timed out" looks:
     *  - pgsql: lock_timeout 1 s → SQLSTATE 55P03
     *  - mysql/mariadb: innodb_lock_wait_timeout 1 → driver error 1205
     *  - sqlite: busy timeout 1 s → SQLITE_BUSY (5, "database is locked");
     *    SQLite locks the whole database file, not a row
     *
     * @return array{0: \PDO, 1: \Closure(\PDOException): bool}
     */
    protected static function lockWaitingPdo(): array {
        [$dsn, $user, $pass] = self::pdoParams();
        $pdo = new \PDO($dsn, $user, $pass, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_TIMEOUT => 1]);
        switch (self::dbKind()) {
            case 'pgsql':
                $pdo->exec("SET lock_timeout = '1s'");
                return [$pdo, static fn (\PDOException $e): bool => $e->getCode() === '55P03'];
            case 'mysql':
                $pdo->exec('SET SESSION innodb_lock_wait_timeout = 1');
                return [$pdo, static fn (\PDOException $e): bool => (int)($e->errorInfo[1] ?? 0) === 1205];
            default:
                return [$pdo, static fn (\PDOException $e): bool => (int)($e->errorInfo[1] ?? 0) === 5];
        }
    }
}
