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
 * Template suggestions (factory job 182, app version 0.4.0): the table
 * knorke_templates. The migrations 0001–0003 stay unchanged.
 *
 *  - id: BIGINT autoincrement, primary key
 *  - state: 'pending' (a suggestion of an account, waiting for an admin) or
 *    'adopted' (belongs to the Nextcloud, every account inserts it)
 *  - name: at most 100 characters (Input::title), STRING 255 like the other
 *    display texts
 *  - note: the sentence to the admins, only while pending; NULL = none
 *  - content: the board file verbatim (≤ 2 MiB; unsized TEXT, LONGTEXT on
 *    MySQL/MariaDB)
 *  - sketch: the tile's rectangles as JSON
 *  - suggested_by: the uid of whoever suggested it, only while pending (an
 *    adopted template carries no uid)
 *  - created_at, adopted_at: ms
 *  - index knorke_tpl_state (state, suggested_by): the adopted list, the
 *    pending ones of one account and their count
 *
 * Rules (SPEC-M0 §3, SPEC-M1 §3): only behind hasTable(); only Types::*, no
 * foreign keys, no BOOLEAN, no JSON type, index names ≤ 63 characters
 * including oc_ and unique in the schema. No postSchemaChange, no
 * constructor dependencies. NC 34 hands out the Doctrine table, NC 35
 * OCP\DB\Schema\ITable; both have the methods used here.
 */
class Version000400Date20261025000000 extends SimpleMigrationStep {
    /**
     * @param Closure(): ISchemaWrapper $schemaClosure
     */
    public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
        /** @var ISchemaWrapper $schema */
        $schema = $schemaClosure();

        if (!$schema->hasTable('knorke_templates')) {
            $t = $schema->createTable('knorke_templates');
            $t->addColumn('id', Types::BIGINT, ['notnull' => true, 'autoincrement' => true]);
            $t->addColumn('state', Types::STRING, ['notnull' => true, 'length' => 8]);
            $t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
            $t->addColumn('note', Types::STRING, ['notnull' => false, 'length' => 255]);
            $t->addColumn('content', Types::TEXT, ['notnull' => false]);
            $t->addColumn('sketch', Types::TEXT, ['notnull' => false]);
            $t->addColumn('suggested_by', Types::STRING, ['notnull' => false, 'length' => 64]);
            $t->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'default' => 0]);
            $t->addColumn('adopted_at', Types::BIGINT, ['notnull' => false]);
            $t->setPrimaryKey(['id']);
            $t->addIndex(['state', 'suggested_by'], 'knorke_tpl_state');
        }

        return $schema;
    }
}
