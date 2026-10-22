<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use Doctrine\DBAL\Platforms\AbstractPlatform;
use Doctrine\DBAL\Platforms\MariaDBPlatform;
use Doctrine\DBAL\Platforms\MySQL80Platform;
use Doctrine\DBAL\Platforms\PostgreSQLPlatform;
use Doctrine\DBAL\Platforms\SqlitePlatform;
use Doctrine\DBAL\Schema\Schema;
use OCA\Knorke\Migration\BackfillItemBytes;
use OCA\Knorke\Migration\Version000100Date20261011000000;
use OCA\Knorke\Migration\Version000200Date20261012000000;
use OCA\Knorke\Migration\Version000300Date20261017000000;
use OCA\Knorke\Tests\Support\Fake;
use OCP\DB\ISchemaWrapper;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use PHPUnit\Framework\TestCase;

/**
 * The schema of SPEC-M0 §3 (Version000100…, unchanged in M1), of SPEC-M1
 * §3.1 (Version000200…) and the M2 data foundation for grouping and locking
 * (Version000300…: knorke_items.group_id/locked_by/locked_name and the index
 * knorke_items_group).
 *
 * Two kinds of schema behind the migrations:
 *  - a recording ISchemaWrapper fake (columns, options, indexes, every call):
 *    NC 35 hands out OCP\DB\Schema\ITable from createTable()/getTable() (and
 *    IColumn from addColumn()), NC 34 the untyped Doctrine table; the fake
 *    follows whichever server runs the tests;
 *  - the REAL objects: a Doctrine Schema, wrapped per table in NC 35's
 *    OC\DB\Schema\Table (the ITable Nextcloud's SchemaWrapper returns) or
 *    handed out raw on NC 34 (what SchemaWrapper returns there). Doctrine
 *    then renders the CREATE TABLE statements per platform — the evidence
 *    that an unsized Types::TEXT becomes LONGTEXT on MySQL/MariaDB (§3.9).
 */
final class MigrationTest extends TestCase {
    /** @var array<string, array{columns: array<string, array>, primary: list<string>, indexes: array<string, array>}> */
    private array $tables = [];
    /** @var list<string> mutating calls on existing or new tables, "table.method(arg)" */
    private array $calls = [];
    /** @var list<array{0: string, 1: string, 2: string, 3: bool}> setValueString calls of the migration */
    private array $appConfigSets = [];

    private const M0_BOARDS = ['id', 'owner', 'title', 'rev', 'min_rev', 'schema_version', 'item_count', 'item_bytes', 'acl_gen', 'link_gen', 'created_at', 'updated_at'];
    private const M0_LINKS = ['id', 'board_id', 'token', 'role', 'created_by', 'created_at', 'revoked_at'];
    private const M0_MEMBERS = ['board_id', 'user_id', 'role', 'link_id', 'created_at'];
    private const M0_ITEMS = ['board_id', 'id', 'type', 'parent_id', 'z', 'x', 'y', 'w', 'h', 'rotation', 'data', 'style', 'version', 'rev', 'deleted',
        'created_by', 'created_at', 'modified_by', 'modified_at'];
    private const M0_CHANGES = ['board_id', 'rev', 'item_id', 'op', 'patch', 'actor', 'client', 'ts'];

    private static function nc35(): bool {
        return interface_exists(\OCP\DB\Schema\ITable::class);
    }

    private function schema(): ISchemaWrapper {
        $nc35 = self::nc35();
        return Fake::of(ISchemaWrapper::class, [
            'hasTable' => fn ($name) => isset($this->tables[$name]),
            'createTable' => function ($name) use ($nc35): object {
                $this->tables[$name] = ['columns' => [], 'primary' => [], 'indexes' => []];
                $this->calls[] = "createTable($name)";
                return $this->table($name, $nc35);
            },
            'getTable' => function ($name) use ($nc35): object {
                if (!isset($this->tables[$name])) {
                    throw new \LogicException("getTable($name) of a missing table");
                }
                return $this->table($name, $nc35);
            },
        ]);
    }

    private function table(string $name, bool $nc35): object {
        $self = null;
        $methods = [
            'hasColumn' => fn ($col): bool => isset($this->tables[$name]['columns'][$col]),
            'hasIndex' => fn ($index): bool => isset($this->tables[$name]['indexes'][$index]),
            'addColumn' => function ($col, $type, array $options = []) use ($name, $nc35) {
                if (isset($this->tables[$name]['columns'][$col])) {
                    throw new \LogicException("$name.$col added twice");
                }
                $this->tables[$name]['columns'][$col] = ['type' => is_string($type) ? $type : $type->value, 'options' => $options];
                $this->calls[] = "$name.addColumn($col)";
                return $nc35 ? Fake::of(\OCP\DB\Schema\IColumn::class) : null;
            },
            'setPrimaryKey' => function (array $cols, $indexName = false) use ($name, &$self) {
                $this->tables[$name]['primary'] = $cols;
                $this->calls[] = "$name.setPrimaryKey";
                return $self;
            },
            'addIndex' => function (array $cols, $indexName = null, array $flags = [], array $options = []) use ($name, &$self) {
                $this->tables[$name]['indexes'][(string)$indexName] = ['cols' => $cols, 'unique' => false];
                $this->calls[] = "$name.addIndex($indexName)";
                return $self;
            },
            'addUniqueIndex' => function (array $cols, $indexName = null, array $options = []) use ($name, &$self) {
                $this->tables[$name]['indexes'][(string)$indexName] = ['cols' => $cols, 'unique' => true];
                $this->calls[] = "$name.addUniqueIndex($indexName)";
                return $self;
            },
        ];
        if ($nc35) {
            $self = Fake::of(\OCP\DB\Schema\ITable::class, $methods);
        } else {
            $self = new class($methods) {
                public function __construct(private array $m) {
                }
                public function __call(string $n, array $a): mixed {
                    return ($this->m[$n] ?? throw new \LogicException("unexpected $n"))(...$a);
                }
            };
        }
        return $self;
    }

    private function m1(): Version000200Date20261012000000 {
        return new Version000200Date20261012000000(Fake::of(IAppConfig::class, [
            'setValueString' => function (string $app, string $key, string $value, bool $lazy = false) {
                $this->appConfigSets[] = [$app, $key, $value, $lazy];
                return true;
            },
        ]));
    }

    /** Runs the migrations like Nextcloud's executeStep: changeSchema, then postSchemaChange (M1, M2). */
    private function migrate(bool $m0 = true, bool $m1 = true, bool $m2 = false, ?ISchemaWrapper $schema = null): ISchemaWrapper {
        $schema ??= $this->schema();
        $output = Fake::of(IOutput::class);
        if ($m0) {
            $this->assertSame($schema, (new Version000100Date20261011000000())->changeSchema($output, fn () => $schema, []));
        }
        if ($m1) {
            $m = $this->m1();
            $this->assertSame($schema, $m->changeSchema($output, fn () => $schema, []));
            $m->postSchemaChange($output, fn () => $schema, []);
        }
        if ($m2) {
            $m = new Version000300Date20261017000000();
            $this->assertSame($schema, $m->changeSchema($output, fn () => $schema, []));
            $m->postSchemaChange($output, fn () => $schema, []);
        }
        return $schema;
    }

    /** @return list<string> */
    private function cols(string $t): array {
        return array_keys($this->tables[$t]['columns']);
    }

    // ---- M0 (unchanged) -----------------------------------------------------

    public function testM0TablesColumnsAndIndexes(): void {
        $this->migrate(m1: false);
        $this->assertSame(['knorke_boards', 'knorke_links', 'knorke_members', 'knorke_items', 'knorke_changes'], array_keys($this->tables));
        $this->assertSame(self::M0_BOARDS, $this->cols('knorke_boards'));
        $this->assertSame(self::M0_LINKS, $this->cols('knorke_links'));
        $this->assertSame(self::M0_MEMBERS, $this->cols('knorke_members'));
        $this->assertSame(self::M0_ITEMS, $this->cols('knorke_items'));
        $this->assertSame(self::M0_CHANGES, $this->cols('knorke_changes'));

        $this->assertSame(['id'], $this->tables['knorke_boards']['primary']);
        $this->assertSame(['board_id', 'user_id'], $this->tables['knorke_members']['primary']);
        $this->assertSame(['board_id', 'id'], $this->tables['knorke_items']['primary']);
        $this->assertSame(['board_id', 'rev', 'item_id'], $this->tables['knorke_changes']['primary']);
        $this->assertSame(['cols' => ['board_id', 'rev'], 'unique' => false], $this->tables['knorke_items']['indexes']['knorke_items_rev']);
        $this->assertSame(['cols' => ['token'], 'unique' => true], $this->tables['knorke_links']['indexes']['knorke_links_token']);

        $c = $this->tables['knorke_links']['columns']['revoked_at'];
        $this->assertFalse($c['options']['notnull'], 'links.revoked_at is nullable');
        $this->assertSame('bigint', $c['type']);
        $this->assertSame(64, $this->tables['knorke_items']['columns']['z']['options']['length']);
        $this->assertSame(80, $this->tables['knorke_items']['columns']['created_by']['options']['length']);
        $this->assertSame('text', $this->tables['knorke_items']['columns']['data']['type']);
        $this->assertSame('float', $this->tables['knorke_items']['columns']['x']['type']);
        $c = $this->tables['knorke_boards']['columns']['item_bytes'];
        $this->assertSame(['bigint', true, 0], [$c['type'], $c['options']['notnull'], $c['options']['default']], 'boards.item_bytes BIGINT NOT NULL DEFAULT 0');
    }

    // ---- M1 (§3.1) ------------------------------------------------------------

    public function testM1ColumnsTablesAndIndexes(): void {
        $this->migrate();
        $this->assertSame(['knorke_boards', 'knorke_links', 'knorke_members', 'knorke_items', 'knorke_changes',
            'knorke_shares', 'knorke_vote_sessions', 'knorke_votes'], array_keys($this->tables));
        $this->assertSame([...self::M0_BOARDS, 'meta', 'meta_rev', 'vote_link_gen'], $this->cols('knorke_boards'));
        $this->assertSame([...self::M0_LINKS, 'password_hash', 'expires_at'], $this->cols('knorke_links'));
        $this->assertSame(self::M0_MEMBERS, $this->cols('knorke_members'));
        $this->assertSame([...self::M0_ITEMS, 'start_item', 'end_item', 'locked'], $this->cols('knorke_items'));
        $this->assertSame(self::M0_CHANGES, $this->cols('knorke_changes'));
        $this->assertSame(['id', 'board_id', 'kind', 'recipient', 'role', 'display_name', 'created_by', 'created_at'], $this->cols('knorke_shares'));
        $this->assertSame(['id', 'board_id', 'state', 'config', 'seq', 'voters', 'results', 'started_by', 'started_at', 'ends_at', 'closed_at'],
            $this->cols('knorke_vote_sessions'));
        $this->assertSame(['session_id', 'voter', 'item_id', 'n', 'ts'], $this->cols('knorke_votes'));

        $this->assertSame(['id'], $this->tables['knorke_shares']['primary']);
        $this->assertSame(['id'], $this->tables['knorke_vote_sessions']['primary']);
        $this->assertSame(['session_id', 'voter', 'item_id'], $this->tables['knorke_votes']['primary']);
        $idx = fn (string $t, string $n): array => $this->tables[$t]['indexes'][$n] ?? [];
        $this->assertSame(['cols' => ['board_id', 'start_item'], 'unique' => false], $idx('knorke_items', 'knorke_items_start'));
        $this->assertSame(['cols' => ['board_id', 'end_item'], 'unique' => false], $idx('knorke_items', 'knorke_items_end'));
        $this->assertSame(['cols' => ['board_id', 'kind', 'recipient'], 'unique' => true], $idx('knorke_shares', 'knorke_shares_target'));
        $this->assertSame(['cols' => ['kind', 'recipient'], 'unique' => false], $idx('knorke_shares', 'knorke_shares_rcpt'));
        $this->assertSame(['cols' => ['board_id', 'state'], 'unique' => false], $idx('knorke_vote_sessions', 'knorke_vsess_board'));
        $this->assertSame(['cols' => ['session_id', 'item_id'], 'unique' => false], $idx('knorke_votes', 'knorke_votes_item'));
        $this->assertSame(['knorke_items_rev', 'knorke_items_parent', 'knorke_items_start', 'knorke_items_end'], array_keys($this->tables['knorke_items']['indexes']));
        $this->assertSame([], $this->appConfigSets, 'item_bytes existed: no backfill flag');
    }

    public function testM1ColumnTypes(): void {
        $this->migrate();
        $want = [
            // table.column => [type, notnull, default, length, autoincrement]
            'knorke_boards.meta' => ['text', false, null, null, null],
            'knorke_boards.meta_rev' => ['bigint', true, 0, null, null],
            'knorke_boards.vote_link_gen' => ['integer', true, 1, null, null],
            'knorke_links.password_hash' => ['string', false, null, 255, null],
            'knorke_links.expires_at' => ['bigint', false, null, null, null],
            'knorke_items.start_item' => ['string', false, null, 26, null],
            'knorke_items.end_item' => ['string', false, null, 26, null],
            'knorke_items.locked' => ['smallint', false, null, null, null],
            'knorke_shares.id' => ['bigint', true, null, null, true],
            'knorke_shares.board_id' => ['bigint', true, null, null, null],
            'knorke_shares.kind' => ['string', true, null, 8, null],
            'knorke_shares.recipient' => ['string', true, null, 64, null],
            'knorke_shares.role' => ['string', true, null, 16, null],
            'knorke_shares.display_name' => ['string', false, null, 255, null],
            'knorke_shares.created_by' => ['string', true, null, 64, null],
            'knorke_shares.created_at' => ['bigint', true, 0, null, null],
            'knorke_vote_sessions.id' => ['bigint', true, null, null, true],
            'knorke_vote_sessions.board_id' => ['bigint', true, null, null, null],
            'knorke_vote_sessions.state' => ['string', true, null, 8, null],
            'knorke_vote_sessions.config' => ['text', false, null, null, null],
            'knorke_vote_sessions.seq' => ['bigint', true, 0, null, null],
            'knorke_vote_sessions.voters' => ['integer', true, 0, null, null],
            'knorke_vote_sessions.results' => ['text', false, null, null, null],
            'knorke_vote_sessions.started_by' => ['string', true, null, 80, null],
            'knorke_vote_sessions.started_at' => ['bigint', true, 0, null, null],
            'knorke_vote_sessions.ends_at' => ['bigint', false, null, null, null],
            'knorke_vote_sessions.closed_at' => ['bigint', false, null, null, null],
            'knorke_votes.session_id' => ['bigint', true, null, null, null],
            'knorke_votes.voter' => ['string', true, null, 16, null],
            'knorke_votes.item_id' => ['string', true, null, 26, null],
            'knorke_votes.n' => ['smallint', true, 0, null, null],
            'knorke_votes.ts' => ['bigint', true, 0, null, null],
        ];
        foreach ($want as $key => [$type, $notnull, $default, $length, $auto]) {
            [$t, $col] = explode('.', $key);
            $c = $this->tables[$t]['columns'][$col] ?? null;
            $this->assertNotNull($c, $key);
            $o = $c['options'];
            $this->assertSame([$type, $notnull, $default, $length, $auto],
                [$c['type'], $o['notnull'], $o['default'] ?? null, $o['length'] ?? null, $o['autoincrement'] ?? null], $key);
        }
    }

    /** §3: a new column of an EXISTING table is nullable or NOT NULL with a numeric default. */
    public function testM1AdditionsToExistingTables(): void {
        $this->migrate(m1: false);
        $before = array_map(fn (array $t): array => array_keys($t['columns']), $this->tables);
        $this->migrate(m0: false);
        foreach ($before as $t => $cols) {
            foreach (array_diff(array_keys($this->tables[$t]['columns']), $cols) as $col) {
                $o = $this->tables[$t]['columns'][$col]['options'];
                $this->assertTrue($o['notnull'] === false || is_int($o['default'] ?? null), "$t.$col: nullable or NOT NULL with a number default");
            }
        }
    }

    public function testRulesForBothMigrations(): void {
        $this->migrate();
        $names = $this->assertSchemaRules();
        foreach (['knorke_shares_target', 'knorke_shares_rcpt', 'knorke_vsess_board', 'knorke_votes_item', 'knorke_items_start', 'knorke_items_end'] as $n) {
            $this->assertArrayHasKey($n, $names);
        }
    }

    /**
     * SPEC-M0 §3 / SPEC-M1 §3 on the recorded schema: names ≤ 63 incl. oc_,
     * index names unique across the schema, every column states notnull, no
     * NOT NULL with '' default, no JSON, no BOOLEAN.
     *
     * @return array<string, true> every index name
     */
    private function assertSchemaRules(): array {
        $names = [];
        foreach ($this->tables as $t => $def) {
            $this->assertLessThanOrEqual(63, strlen('oc_' . $t), "table name $t");
            foreach ($def['indexes'] as $name => $_) {
                $this->assertLessThanOrEqual(63, strlen('oc_' . $name), "index name $name ≤ 63 incl. oc_");
                $this->assertStringStartsWith('knorke_', $name, "index name of $t");
                $this->assertArrayNotHasKey($name, $names, "index name $name unique across the schema (MigrationService::ensureUniqueNamesConstraints)");
                $names[$name] = true;
            }
            foreach ($def['columns'] as $col => $c) {
                $this->assertArrayHasKey('notnull', $c['options'], "$t.$col states notnull");
                if ($c['options']['notnull'] === true) {
                    $this->assertNotSame('', $c['options']['default'] ?? null, "$t.$col: NOT NULL with '' default");
                }
                $this->assertNotSame('json', $c['type'], "$t.$col: no Types::JSON");
                $this->assertNotSame('boolean', $c['type'], "$t.$col: no BOOLEAN");
                $this->assertLessThanOrEqual(63, strlen($col), "$t.$col");
            }
        }
        return $names;
    }

    public function testIdempotentBehindHasTableHasColumnHasIndex(): void {
        $this->migrate();
        $before = $this->tables;
        $this->calls = [];
        $this->migrate();
        $this->assertSame($before, $this->tables, 'every table behind hasTable(), every addition behind hasColumn()/hasIndex()');
        $this->assertSame([], $this->calls, 'a second run changes nothing');
        $this->assertSame([], $this->appConfigSets);
    }

    /** Stacks installed before M0-R5: boards without item_bytes. */
    public function testItemBytesOnlyWhenMissingAndFlagOnlyAfterTheChange(): void {
        $this->migrate(m1: false);
        unset($this->tables['knorke_boards']['columns']['item_bytes']);
        $schema = $this->schema();
        $m = $this->m1();
        $m->changeSchema(Fake::of(IOutput::class), fn () => $schema, []);
        $c = $this->tables['knorke_boards']['columns']['item_bytes'] ?? null;
        $this->assertSame(['bigint', true, 0], [$c['type'] ?? null, $c['options']['notnull'] ?? null, $c['options']['default'] ?? null]);
        $this->assertSame([], $this->appConfigSets, 'never in changeSchema: a failed ALTER must not trigger the backfill');
        $m->postSchemaChange(Fake::of(IOutput::class), fn () => $schema, []);
        $this->assertSame([['knorke', BackfillItemBytes::FLAG, '1', true]], $this->appConfigSets);
        $this->assertSame('backfill_item_bytes', BackfillItemBytes::FLAG);
        // Called again (same instance) or a later run: no second flag.
        $m->postSchemaChange(Fake::of(IOutput::class), fn () => $schema, []);
        $this->migrate(m0: false);
        $this->assertCount(1, $this->appConfigSets);
    }

    /**
     * NC 35 finding (SPEC-M1 §3, §12.1): getTable()/createTable() return
     * OCP\DB\Schema\ITable, which has every method the migration calls with a
     * compatible signature; NC 34 has no OCP\DB\Schema at all and returns the
     * Doctrine table, which has them too. So no method_exists branch.
     */
    public function testSchemaApiOfBothServers(): void {
        $used = ['hasColumn' => 1, 'addColumn' => 3, 'hasIndex' => 1, 'addIndex' => 2, 'addUniqueIndex' => 2, 'setPrimaryKey' => 1];
        $class = self::nc35() ? \OCP\DB\Schema\ITable::class : \Doctrine\DBAL\Schema\Table::class;
        foreach ($used as $method => $args) {
            $this->assertTrue(method_exists($class, $method), "$class::$method");
            $rm = new \ReflectionMethod($class, $method);
            $this->assertGreaterThanOrEqual($args, $rm->getNumberOfParameters(), "$class::$method takes the arguments the migration passes");
            $this->assertLessThanOrEqual($args, $rm->getNumberOfRequiredParameters(), "$class::$method needs no more than the migration passes");
        }
        $wrapper = new \ReflectionMethod(ISchemaWrapper::class, 'getTable');
        if (self::nc35()) {
            $this->assertSame(\OCP\DB\Schema\ITable::class, (string)$wrapper->getReturnType(), 'NC 35: getTable(): ITable');
            $this->assertTrue(class_exists(\OC\DB\Schema\Table::class), 'NC 35: OC\DB\Schema\Table implements ITable');
        } else {
            $this->assertFalse($wrapper->hasReturnType(), 'NC 34: getTable() untyped (Doctrine table)');
        }
    }

    // ---- real Doctrine schema --------------------------------------------------

    /**
     * An ISchemaWrapper over a real Doctrine Schema (prefix oc_) that hands
     * out what Nextcloud's SchemaWrapper hands out: NC 35 wraps each table in
     * OC\DB\Schema\Table, NC 34 returns the Doctrine table.
     */
    private static function realSchema(Schema $s): ISchemaWrapper {
        $wrap = static fn (\Doctrine\DBAL\Schema\Table $t): object => self::nc35() ? new \OC\DB\Schema\Table($t) : $t;
        return Fake::of(ISchemaWrapper::class, [
            'hasTable' => fn ($name): bool => $s->hasTable('oc_' . $name),
            'createTable' => fn ($name): object => $wrap($s->createTable('oc_' . $name)),
            'getTable' => fn ($name): object => $wrap($s->getTable('oc_' . $name)),
        ]);
    }

    public function testRealSchemaAndLongtextOnMysql(): void {
        $s = new Schema();
        $schema = self::realSchema($s);
        $this->migrate(schema: $schema);
        // Idempotent on the real objects, too.
        $this->migrate(schema: $schema);
        if (self::nc35()) {
            $this->assertInstanceOf(\OCP\DB\Schema\ITable::class, $schema->getTable('knorke_boards'));
        }
        $this->assertSame(['oc_knorke_boards', 'oc_knorke_links', 'oc_knorke_members', 'oc_knorke_items', 'oc_knorke_changes',
            'oc_knorke_shares', 'oc_knorke_vote_sessions', 'oc_knorke_votes'],
            array_values(array_map(static fn ($t): string => $t->getName(), $s->getTables())));
        $boards = $s->getTable('oc_knorke_boards');
        $this->assertSame([...self::M0_BOARDS, 'meta', 'meta_rev', 'vote_link_gen'], array_map(static fn ($c): string => $c->getName(), array_values($boards->getColumns())));

        $sql = static function (AbstractPlatform $p, string $table) use ($s): string {
            return implode(";\n", $p->getCreateTableSQL($s->getTable($table)));
        };
        foreach ([new MySQL80Platform(), new MariaDBPlatform()] as $p) {
            $boardsSql = $sql($p, 'oc_knorke_boards');
            $sessionsSql = $sql($p, 'oc_knorke_vote_sessions');
            $this->assertStringContainsString('meta LONGTEXT DEFAULT NULL', $boardsSql, get_class($p));
            $this->assertStringContainsString('config LONGTEXT DEFAULT NULL', $sessionsSql, get_class($p));
            $this->assertStringContainsString('results LONGTEXT DEFAULT NULL', $sessionsSql, get_class($p));
            $this->assertStringContainsString('data LONGTEXT DEFAULT NULL', $sql($p, 'oc_knorke_items'), get_class($p));
            $this->assertStringContainsString('meta_rev BIGINT DEFAULT 0 NOT NULL', $boardsSql, get_class($p));
            $this->assertStringContainsString('locked SMALLINT DEFAULT NULL', $sql($p, 'oc_knorke_items'), get_class($p));
            $this->assertStringContainsString('UNIQUE INDEX knorke_shares_target (board_id, kind, recipient)', $sql($p, 'oc_knorke_shares'), get_class($p));
        }
        $this->assertStringContainsString('meta TEXT DEFAULT NULL', $sql(new PostgreSQLPlatform(), 'oc_knorke_boards'));
        $this->assertStringContainsString('meta CLOB DEFAULT NULL', $sql(new SqlitePlatform(), 'oc_knorke_boards'));
    }

    // ---- M2 data foundation (Version000300…, app 0.3.0) -------------------------

    private const M2_ITEM_COLS = ['group_id', 'locked_by', 'locked_name'];

    public function testM2ItemColumnsAndIndexes(): void {
        $this->migrate(m2: true);
        $this->assertSame([...self::M0_ITEMS, 'start_item', 'end_item', 'locked', ...self::M2_ITEM_COLS], $this->cols('knorke_items'));
        $this->assertSame(['knorke_items_rev', 'knorke_items_parent', 'knorke_items_start', 'knorke_items_end', 'knorke_items_group'],
            array_keys($this->tables['knorke_items']['indexes']));
        $this->assertSame(['cols' => ['board_id', 'group_id'], 'unique' => false], $this->tables['knorke_items']['indexes']['knorke_items_group']);
        $this->assertSame(['knorke_boards', 'knorke_links', 'knorke_members', 'knorke_items', 'knorke_changes',
            'knorke_shares', 'knorke_vote_sessions', 'knorke_votes'], array_keys($this->tables), 'no new table');
    }

    public function testM2ColumnTypes(): void {
        $this->migrate(m2: true);
        $want = [
            // column => [type, notnull, default, length, autoincrement]
            'group_id' => ['string', false, null, 26, null],
            'locked_by' => ['string', false, null, 80, null],
            'locked_name' => ['string', false, null, 64, null],
            // the M1 flag stays as it is
            'locked' => ['smallint', false, null, null, null],
        ];
        foreach ($want as $col => $w) {
            $c = $this->tables['knorke_items']['columns'][$col] ?? null;
            $this->assertNotNull($c, $col);
            $o = $c['options'];
            $this->assertSame($w, [$c['type'], $o['notnull'], $o['default'] ?? null, $o['length'] ?? null, $o['autoincrement'] ?? null], "knorke_items.$col");
        }
    }

    /** On an M1 schema (an upgrade from 0.2.0) the M2 migration adds exactly three nullable columns and one index. */
    public function testM2AloneOnAnM1Schema(): void {
        $this->migrate();
        $before = $this->tables;
        $this->calls = [];
        $this->migrate(m0: false, m1: false, m2: true);
        $this->assertSame(['knorke_items.addColumn(group_id)', 'knorke_items.addColumn(locked_by)', 'knorke_items.addColumn(locked_name)',
            'knorke_items.addIndex(knorke_items_group)'], $this->calls);
        foreach (self::M2_ITEM_COLS as $col) {
            $this->assertFalse($this->tables['knorke_items']['columns'][$col]['options']['notnull'], "knorke_items.$col is nullable (existing rows get NULL)");
        }
        $after = $this->tables;
        foreach (self::M2_ITEM_COLS as $col) {
            unset($after['knorke_items']['columns'][$col]);
        }
        unset($after['knorke_items']['indexes']['knorke_items_group']);
        $this->assertSame($before, $after, 'nothing else changes');
        $this->assertSame([], $this->appConfigSets, 'no backfill, no app config');
    }

    public function testM2WithoutTheItemsTableDoesNothing(): void {
        $this->migrate(m0: false, m1: false, m2: true);
        $this->assertSame([], $this->tables);
        $this->assertSame([], $this->calls);
    }

    public function testM2IdempotentAndRulesForAllThreeMigrations(): void {
        $this->migrate(m2: true);
        $before = $this->tables;
        $this->calls = [];
        $this->migrate(m2: true);
        $this->assertSame($before, $this->tables, 'every addition behind hasColumn()/hasIndex()');
        $this->assertSame([], $this->calls, 'a second run of all three migrations changes nothing');
        $this->assertSame([], $this->appConfigSets);
        $names = $this->assertSchemaRules();
        $this->assertArrayHasKey('knorke_items_group', $names);
        $this->assertLessThanOrEqual(63, strlen('oc_knorke_items_group'));
    }

    public function testM2RealSchemaOnEveryPlatform(): void {
        $s = new Schema();
        $schema = self::realSchema($s);
        $this->migrate(m2: true, schema: $schema);
        $this->migrate(m2: true, schema: $schema);
        $items = $s->getTable('oc_knorke_items');
        $this->assertSame([...self::M0_ITEMS, 'start_item', 'end_item', 'locked', ...self::M2_ITEM_COLS],
            array_map(static fn ($c): string => $c->getName(), array_values($items->getColumns())));
        $sql = static fn (AbstractPlatform $p): string => implode(";\n", $p->getCreateTableSQL($items));
        foreach ([new MySQL80Platform(), new MariaDBPlatform()] as $p) {
            $q = $sql($p);
            foreach (['group_id VARCHAR(26) DEFAULT NULL', 'locked_by VARCHAR(80) DEFAULT NULL', 'locked_name VARCHAR(64) DEFAULT NULL',
                'INDEX knorke_items_group (board_id, group_id)'] as $want) {
                $this->assertStringContainsString($want, $q, get_class($p));
            }
        }
        // PostgreSQL and SQLite: the same column forms, the index as its own statement.
        foreach ([new PostgreSQLPlatform(), new SqlitePlatform()] as $p) {
            $q = $sql($p);
            foreach (['group_id VARCHAR(26) DEFAULT NULL', 'locked_by VARCHAR(80) DEFAULT NULL', 'locked_name VARCHAR(64) DEFAULT NULL',
                'CREATE INDEX knorke_items_group ON oc_knorke_items (board_id, group_id)'] as $want) {
                $this->assertStringContainsString($want, $q, get_class($p));
            }
        }
    }
}
