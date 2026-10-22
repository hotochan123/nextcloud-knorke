<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The whole M0 schema (SPEC-M0 §3), five tables with the prefix knorke_.
 *
 *  - knorke_boards.rev is THE cursor of a board. Every write batch first runs
 *    `UPDATE … SET rev = rev + 1` in its transaction; the row lock serialises
 *    all writers of one board, so commit order == rev order.
 *  - knorke_items holds the current state, one row per object (tombstoned via
 *    `deleted`), with its own `rev` of the last change: the sync reads the
 *    items, not the change log (index knorke_items_rev).
 *  - knorke_changes is the audit log, exactly one row per object and rev.
 *  - knorke_links keeps revoked links for 30 days (revoked_at), so an old
 *    link answers "revoked" instead of counting as a failed attempt.
 *
 * Rules (§3): every table behind hasTable(); only createTable, addColumn with
 * Types::*, setPrimaryKey, addIndex, addUniqueIndex — no Doctrine type hints,
 * because NC 35 hands out ITable instead of the Doctrine table; no foreign
 * keys; JSON as TEXT (Types::JSON is deprecated since NC 33); index names
 * ≤ 63 characters including the oc_ prefix; no NOT NULL column with '' as
 * default (columns that may be empty are nullable).
 */
class Version000100Date20261011000000 extends SimpleMigrationStep {

    /**
     * @param Closure(): ISchemaWrapper $schemaClosure
     */
    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        if (!$schema->hasTable('knorke_boards')) {
            $t = $schema->createTable('knorke_boards');
            $t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
            $t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
            $t->addColumn('title', Types::STRING, ['notnull' => true, 'length' => 200]);
            $t->addColumn('rev', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('min_rev', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('schema_version', Types::INTEGER, ['notnull' => true, 'default' => 1]);
            $t->addColumn('item_count', Types::INTEGER, ['notnull' => true, 'default' => 0]);
            // Σ strlen(data) + strlen(style) of the live items, kept with
            // item_count under the board row lock (byte budget, Limits).
            $t->addColumn('item_bytes', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('acl_gen', Types::INTEGER, ['notnull' => true, 'default' => 1]);
            $t->addColumn('link_gen', Types::INTEGER, ['notnull' => true, 'default' => 1]);
            $t->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->setPrimaryKey(['id']);
            $t->addIndex(['owner', 'updated_at'], 'knorke_boards_owner');
        }

        if (!$schema->hasTable('knorke_links')) {
            $t = $schema->createTable('knorke_links');
            $t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
            $t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
            // 24 characters [A-Za-z0-9] from ISecureRandom (≈ 143 bit).
            $t->addColumn('token', Types::STRING, ['notnull' => true, 'length' => 32]);
            // M0 only 'edit'; M1 'vote' / 'view'.
            $t->addColumn('role', Types::STRING, ['notnull' => true, 'length' => 16]);
            $t->addColumn('created_by', Types::STRING, ['notnull' => true, 'length' => 64]);
            $t->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            // ms; NULL = active. Rotating, switching off and deleting the board
            // set it instead of deleting the row; CleanupJob removes rows older
            // than 30 days.
            $t->addColumn('revoked_at', Types::BIGINT, ['notnull' => false]);
            $t->setPrimaryKey(['id']);
            $t->addUniqueIndex(['token'], 'knorke_links_token');
            $t->addIndex(['board_id'], 'knorke_links_board');
        }

        if (!$schema->hasTable('knorke_members')) {
            $t = $schema->createTable('knorke_members');
            $t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
            $t->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
            $t->addColumn('role', Types::STRING, ['notnull' => true, 'length' => 16]);
            // Set = joined through this link; NULL = shared explicitly (M1).
            $t->addColumn('link_id', Types::BIGINT, ['notnull' => false]);
            $t->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->setPrimaryKey(['board_id', 'user_id']);
            $t->addIndex(['user_id'], 'knorke_members_user');
        }

        if (!$schema->hasTable('knorke_items')) {
            $t = $schema->createTable('knorke_items');
            $t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
            // Client ULID ^[0-9A-HJKMNP-TV-Z]{26}$.
            $t->addColumn('id', Types::STRING, ['notnull' => true, 'length' => 26]);
            $t->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 24]);
            $t->addColumn('parent_id', Types::STRING, ['notnull' => false, 'length' => 26]);
            // fractional-indexing key, alphabet 0-9a-z, compared bytewise in
            // PHP and JS (never by DB collation); only keys ZOrder::isValid accepts.
            $t->addColumn('z', Types::STRING, ['notnull' => true, 'length' => 64]);
            // 1 unit = 1 CSS px at 100 %; x/y = top left of the unrotated box,
            // relative to the parent container; rotation in degrees, clockwise.
            $t->addColumn('x', Types::FLOAT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('y', Types::FLOAT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('w', Types::FLOAT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('h', Types::FLOAT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('rotation', Types::FLOAT, ['notnull' => true, 'default' => 0]);
            // JSON objects (never "[]").
            $t->addColumn('data', Types::TEXT, ['notnull' => false]);
            $t->addColumn('style', Types::TEXT, ['notnull' => false]);
            $t->addColumn('version', Types::INTEGER, ['notnull' => true, 'default' => 1]);
            $t->addColumn('rev', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('deleted', Types::SMALLINT, ['notnull' => true, 'default' => 0]);
            // Principal id: u:<uid> (up to 66) or g:<gid> (14), never shortened.
            $t->addColumn('created_by', Types::STRING, ['notnull' => true, 'length' => 80]);
            $t->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('modified_by', Types::STRING, ['notnull' => true, 'length' => 80]);
            $t->addColumn('modified_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->setPrimaryKey(['board_id', 'id']);
            $t->addIndex(['board_id', 'rev'], 'knorke_items_rev');
            $t->addIndex(['board_id', 'parent_id'], 'knorke_items_parent');
        }

        if (!$schema->hasTable('knorke_changes')) {
            $t = $schema->createTable('knorke_changes');
            $t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
            $t->addColumn('rev', Types::BIGINT, ['notnull' => true]);
            $t->addColumn('item_id', Types::STRING, ['notnull' => true, 'length' => 26]);
            // put | patch | remove
            $t->addColumn('op', Types::STRING, ['notnull' => true, 'length' => 8]);
            // put: full object without id; patch: effective paths only; remove: NULL.
            $t->addColumn('patch', Types::TEXT, ['notnull' => false]);
            $t->addColumn('actor', Types::STRING, ['notnull' => true, 'length' => 80]);
            $t->addColumn('client', Types::STRING, ['notnull' => true, 'length' => 16]);
            $t->addColumn('ts', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->setPrimaryKey(['board_id', 'rev', 'item_id']);
            $t->addIndex(['ts'], 'knorke_changes_ts');
        }

        return $schema;
    }
}
