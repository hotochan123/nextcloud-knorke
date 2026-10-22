<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Migration;

use Closure;
use OCA\Knorke\AppInfo\Application;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The whole M1 schema (SPEC-M1 §3.1), delivered in stage 0; columns and
 * tables of later stages stay unused until then. The M0 migration
 * (Version000100Date20261011000000) stays unchanged.
 *
 *  - knorke_boards: + meta (JSON object of the board metadata, §3.11; NULL =
 *    {}), + meta_rev (rev of the last title/meta change, same rev space as
 *    rev), + vote_link_gen (generation of the voting link), + item_bytes only
 *    when missing (stacks installed before M0-R5).
 *  - knorke_links: + password_hash (IHasher::hash of the link password; the
 *    name avoids the literal SourceGuard forbids), + expires_at (ms, end of
 *    the chosen calendar day in the owner's time zone).
 *  - knorke_items: + start_item/end_item (derived by the server from a
 *    connector's data.start.item/data.end.item), + locked (reserved for
 *    locking in M2; M1 never reads or writes it), + two indexes to find the
 *    connectors bound to an item.
 *  - new: knorke_shares (§3.5), knorke_vote_sessions (§3.6), knorke_votes
 *    (§3.7).
 *
 * Rules (SPEC-M0 §3, SPEC-M1 §3): every new table behind hasTable(), every
 * addition to an existing table behind hasColumn()/hasIndex(); new columns of
 * existing tables are nullable or NOT NULL with a numeric default; only
 * Types::*, no foreign keys, JSON as TEXT (Doctrine makes an unsized TEXT a
 * LONGTEXT on MySQL/MariaDB), index names ≤ 63 characters including oc_, no
 * NOT NULL column with '' as default, no BOOLEAN NOT NULL.
 *
 * NC 34 hands out the Doctrine table, NC 35 OCP\DB\Schema\ITable from
 * getTable()/createTable(). Both have hasColumn, addColumn, hasIndex,
 * addIndex, addUniqueIndex and setPrimaryKey with the signatures used here
 * (checked in nextcloud:35.0.1-apache, lib/public/DB/Schema/ITable.php), so
 * the code needs no branch; the return values are never used.
 *
 * item_bytes: the column is added only where it is missing; the flag
 * `knorke/backfill_item_bytes = 1` for the repair step BackfillItemBytes is
 * set in postSchemaChange — after the ALTER went through, never in
 * changeSchema — and only when this run added the column.
 */
class Version000200Date20261012000000 extends SimpleMigrationStep {
    /** Set by changeSchema when it added boards.item_bytes in this run. */
    private bool $addedItemBytes = false;

    public function __construct(
        private IAppConfig $appConfig,
    ) {
    }

    /**
     * @param Closure(): ISchemaWrapper $schemaClosure
     */
    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();
        $this->addedItemBytes = false;

        if ($schema->hasTable('knorke_boards')) {
            $t = $schema->getTable('knorke_boards');
            if (!$t->hasColumn('meta')) {
                // JSON object (§3.11); NULL = {}.
                $t->addColumn('meta', Types::TEXT, ['notnull' => false]);
            }
            if (!$t->hasColumn('meta_rev')) {
                // meta_rev = rev of the last title/meta write, set together with rev.
                $t->addColumn('meta_rev', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            }
            if (!$t->hasColumn('vote_link_gen')) {
                // Generation of the voting link; the edit link keeps link_gen.
                $t->addColumn('vote_link_gen', Types::INTEGER, ['notnull' => true, 'default' => 1]);
            }
            if (!$t->hasColumn('item_bytes')) {
                $t->addColumn('item_bytes', Types::BIGINT, ['notnull' => true, 'default' => 0]);
                $this->addedItemBytes = true;
            }
        }

        if ($schema->hasTable('knorke_links')) {
            $t = $schema->getTable('knorke_links');
            if (!$t->hasColumn('password_hash')) {
                // IHasher::hash() of the link password; NULL = no password.
                $t->addColumn('password_hash', Types::STRING, ['notnull' => false, 'length' => 255]);
            }
            if (!$t->hasColumn('expires_at')) {
                // ms, end (23:59:59.999) of the chosen day in the owner's time zone; NULL = no expiry.
                $t->addColumn('expires_at', Types::BIGINT, ['notnull' => false]);
            }
        }

        if ($schema->hasTable('knorke_items')) {
            $t = $schema->getTable('knorke_items');
            if (!$t->hasColumn('start_item')) {
                // Derived by the server from a connector's data.start.item, never sent by a client.
                $t->addColumn('start_item', Types::STRING, ['notnull' => false, 'length' => 26]);
            }
            if (!$t->hasColumn('end_item')) {
                $t->addColumn('end_item', Types::STRING, ['notnull' => false, 'length' => 26]);
            }
            if (!$t->hasColumn('locked')) {
                // Reserved for locking in M2; M1 never reads or writes it.
                $t->addColumn('locked', Types::SMALLINT, ['notnull' => false]);
            }
            if (!$t->hasIndex('knorke_items_start')) {
                $t->addIndex(['board_id', 'start_item'], 'knorke_items_start');
            }
            if (!$t->hasIndex('knorke_items_end')) {
                $t->addIndex(['board_id', 'end_item'], 'knorke_items_end');
            }
        }

        if (!$schema->hasTable('knorke_shares')) {
            $t = $schema->createTable('knorke_shares');
            $t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
            $t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
            // user | group | team
            $t->addColumn('kind', Types::STRING, ['notnull' => true, 'length' => 8]);
            // Canonical uid, gid or Circles singleId, never the typed spelling.
            $t->addColumn('recipient', Types::STRING, ['notnull' => true, 'length' => 64]);
            // moderate | edit | vote | view
            $t->addColumn('role', Types::STRING, ['notnull' => true, 'length' => 16]);
            // Cached name for "not available" (deleted group, Circles switched off).
            $t->addColumn('display_name', Types::STRING, ['notnull' => false, 'length' => 255]);
            $t->addColumn('created_by', Types::STRING, ['notnull' => true, 'length' => 64]);
            $t->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->setPrimaryKey(['id']);
            $t->addUniqueIndex(['board_id', 'kind', 'recipient'], 'knorke_shares_target');
            $t->addIndex(['kind', 'recipient'], 'knorke_shares_rcpt');
        }

        if (!$schema->hasTable('knorke_vote_sessions')) {
            $t = $schema->createTable('knorke_vote_sessions');
            $t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
            $t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
            // open | closed; at most one open session per board (board lock).
            $t->addColumn('state', Types::STRING, ['notnull' => true, 'length' => 8]);
            // JSON {"per","perItem","scope","types"}.
            $t->addColumn('config', Types::TEXT, ['notnull' => false]);
            // +1 per effective vote batch.
            $t->addColumn('seq', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            // Frozen on close.
            $t->addColumn('voters', Types::INTEGER, ['notnull' => true, 'default' => 0]);
            // JSON {"<item ULID>": n, …}, frozen on close.
            $t->addColumn('results', Types::TEXT, ['notnull' => false]);
            // Principal id of the moderator.
            $t->addColumn('started_by', Types::STRING, ['notnull' => true, 'length' => 80]);
            $t->addColumn('started_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            // ms server time; NULL = no time limit.
            $t->addColumn('ends_at', Types::BIGINT, ['notnull' => false]);
            $t->addColumn('closed_at', Types::BIGINT, ['notnull' => false]);
            $t->setPrimaryKey(['id']);
            $t->addIndex(['board_id', 'state'], 'knorke_vsess_board');
        }

        if (!$schema->hasTable('knorke_votes')) {
            $t = $schema->createTable('knorke_votes');
            $t->addColumn('session_id', Types::BIGINT, ['notnull' => true]);
            // pid (SPEC-M0 §4.9.4), never a uid or gid.
            $t->addColumn('voter', Types::STRING, ['notnull' => true, 'length' => 16]);
            $t->addColumn('item_id', Types::STRING, ['notnull' => true, 'length' => 26]);
            // Votes of this voter on this item, stored only for n ≥ 1.
            $t->addColumn('n', Types::SMALLINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('ts', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->setPrimaryKey(['session_id', 'voter', 'item_id']);
            $t->addIndex(['session_id', 'item_id'], 'knorke_votes_item');
        }

        return $schema;
    }

    /**
     * Sets the flag of the repair step BackfillItemBytes when changeSchema
     * added boards.item_bytes — only here, after the schema change went
     * through (SPEC-M1 §3.1, R2). Not called in Nextcloud's schema-only
     * install path, where the M0 migration creates item_bytes anyway.
     *
     * @param Closure(): ISchemaWrapper $schemaClosure
     */
    public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
        if (!$this->addedItemBytes) {
            return;
        }
        $this->appConfig->setValueString(Application::APP_ID, BackfillItemBytes::FLAG, '1', lazy: true);
        $this->addedItemBytes = false;
        $output->info('Knorke: knorke_boards.item_bytes added; the repair step recomputes it.');
    }
}
