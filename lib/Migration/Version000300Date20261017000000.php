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
 * The M2 data foundation for grouping and locking (app version 0.3.0). The
 * migrations Version000100Date20261011000000 (M0) and
 * Version000200Date20261012000000 (M1) stay unchanged; the flag `locked` of
 * the M1 migration stays as it is.
 *
 *  - knorke_items: + group_id (the item's group, a ULID like parent_id; NULL =
 *    no group), + locked_by (principal id of whoever locked it, u:<uid> or
 *    g:<gid>, as long as created_by; NULL = nobody), + locked_name (display
 *    name of whoever locked it, remembered when locking, so an offline locker
 *    or a gone guest identity still shows with a name; NULL = unknown),
 *    + index knorke_items_group (board_id, group_id) to find the members of
 *    a group under the board lock, like knorke_items_parent/_start/_end.
 *
 * Nothing writes the new columns yet (the lock and group jobs will); every
 * existing row gets NULL — no group, not locked. No backfill, no
 * postSchemaChange, no constructor dependencies. Write rule for locked_name
 * (binding for the lock job): cleaned like a guest name with
 * Input::displayName($name, 64), plus Input::bmp without
 * IDBConnection::supports4ByteText() (like ShareService::storedName); '' is
 * stored as NULL.
 *
 * Rules (SPEC-M0 §3, SPEC-M1 §3): only behind hasTable(knorke_items), every
 * addition behind hasColumn()/hasIndex(); the new columns are nullable; only
 * Types::*, no foreign keys, no BOOLEAN, index names ≤ 63 characters
 * including oc_ and unique in the schema.
 *
 * NC 34 hands out the Doctrine table, NC 35 OCP\DB\Schema\ITable from
 * getTable(). Both have hasColumn, addColumn, hasIndex and addIndex with the
 * signatures used here, so the code needs no branch (like the M1 migration);
 * the return values are never used.
 */
class Version000300Date20261017000000 extends SimpleMigrationStep {
    /**
     * @param Closure(): ISchemaWrapper $schemaClosure
     */
    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        if ($schema->hasTable('knorke_items')) {
            $t = $schema->getTable('knorke_items');
            if (!$t->hasColumn('group_id')) {
                // The item's group (ULID); NULL = no group.
                $t->addColumn('group_id', Types::STRING, ['notnull' => false, 'length' => 26]);
            }
            if (!$t->hasColumn('locked_by')) {
                // Principal id of the locker (u:<uid> | g:<gid>); NULL = nobody. Sent as its pid only.
                $t->addColumn('locked_by', Types::STRING, ['notnull' => false, 'length' => 80]);
            }
            if (!$t->hasColumn('locked_name')) {
                // Display name of the locker at lock time; NULL = unknown.
                $t->addColumn('locked_name', Types::STRING, ['notnull' => false, 'length' => 64]);
            }
            if (!$t->hasIndex('knorke_items_group')) {
                $t->addIndex(['board_id', 'group_id'], 'knorke_items_group');
            }
        }

        return $schema;
    }
}
