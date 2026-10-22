<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Command;

use OCA\Knorke\Service\Epoch;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * `occ knorke:epoch:rotate` (SPEC-M1 §5.4): stores 8 new random characters as
 * the board epoch and prints them. Every Redis key of the app (r:, a:, g:,
 * p:, vt:, w:, pwf:) becomes invisible at once; every open tab resyncs once.
 *
 * Runbook after a database restore (SPEC-M1 §5.4, R19): occ
 * maintenance:mode --on → restore → occ config:app:set knorke epoch
 * --value=<8 characters [a-z0-9]> (in maintenance mode Nextcloud loads no
 * app commands, so this command is not there) → occ maintenance:mode --off.
 * This command turns the epoch without maintenance mode. Other PHP
 * processes may see the old epoch for up to 3 s (Nextcloud's local
 * app-config cache).
 * Registered through <commands> in appinfo/info.xml.
 */
class EpochRotate extends Command {
    public function __construct(
        private Epoch $epoch,
    ) {
        parent::__construct();
    }

    protected function configure(): void {
        $this->setName('knorke:epoch:rotate')
            ->setDescription('Turn the Knorke board epoch (after a database restore): all Knorke Redis keys become invisible, open boards resync once.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int {
        $output->writeln($this->epoch->rotate());
        return 0;
    }
}
