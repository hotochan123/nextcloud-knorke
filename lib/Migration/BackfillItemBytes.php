<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Migration;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCP\AppFramework\Db\TTransactional;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

/**
 * Repair step (SPEC-M1 §3.1, info.xml <post-migration> and <install>):
 * recomputes boards.item_bytes, but only when the migration
 * Version000200Date20261012000000 had to add that column in this run (stacks
 * installed before M0-R5, where the column came into the M0 migration
 * without a version bump). The migration then set the app-config flag
 * `knorke/backfill_item_bytes = 1` in postSchemaChange — never in
 * changeSchema, so a failed ALTER never triggers this step.
 *
 * Per board, in its own transaction under the board row lock (lockBoard,
 * no bump): item_bytes = Σ strlen(data) + strlen(style) over the STORED
 * strings of the live rows (the M0-R5 invariant of the byte budget; never a
 * re-encoded obj(decode(…)); NULL counts 0). The flag is deleted after the
 * last board; a run that fails half way leaves it set and the next repair
 * run starts over (the step is idempotent). Without the flag: nothing.
 */
class BackfillItemBytes implements IRepairStep {
    use TTransactional;

    public const FLAG = 'backfill_item_bytes';

    public function __construct(
        private IAppConfig $appConfig,
        private IDBConnection $db,
        private BoardStore $boards,
        private ItemStore $items,
    ) {
    }

    public function getName(): string {
        return 'Knorke: recompute the item bytes of every board';
    }

    public function run(IOutput $output): void {
        if ($this->appConfig->getValueString(Application::APP_ID, self::FLAG, '', lazy: true) !== '1') {
            return;
        }
        $n = $this->backfill();
        $this->appConfig->deleteKey(Application::APP_ID, self::FLAG);
        $output->info('Knorke: item bytes recomputed for ' . $n . ' board(s).');
    }

    /** @return int boards updated */
    public function backfill(): int {
        $now = (int)floor(microtime(true) * 1000);
        $n = 0;
        foreach ($this->boards->boardIds() as $board) {
            $done = $this->atomic(function () use ($board, $now): bool {
                if ($this->boards->lockBoard($board, false, null, $now) === null) {
                    return false;
                }
                $this->items->setItemBytes($board, $this->items->liveBytes($board));
                return true;
            }, $this->db);
            $n += $done ? 1 : 0;
        }
        return $n;
    }
}
