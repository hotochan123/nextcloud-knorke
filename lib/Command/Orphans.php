<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Command;

use OCA\Knorke\Service\OrphanReconciler;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * `occ knorke:orphans [--dry-run]` (P7, SPEC-M1 §33.1 e): removes what
 * accounts and groups that Nextcloud no longer knows left behind in Knorke
 * (shares, link memberships, votes in open sessions, owned boards) exactly
 * like the deletion listeners — for deletions Knorke missed while it was
 * disabled. Run it after every `occ app:enable knorke` and after Nextcloud
 * major upgrades.
 *
 * stdout: exactly five lines in this order, each "<kind>: <n>" (the orphans
 * of that kind, counted before anything is deleted):
 *
 *   user-shares: <n>
 *   group-shares: <n>
 *   link-members: <n>
 *   open-votes: <n>
 *   owned-boards: <n>
 *
 * --dry-run prints the same numbers, changes nothing and adds the sixth line
 * "Dry run: nothing was changed.". Exit 0 = reconciled (also when every
 * number is 0); 1 = at least one id could not be reconciled (a message on
 * stderr, details in the Nextcloud log; the other ids are done) or the run
 * could not start. Registered through <commands> in appinfo/info.xml; like
 * knorke:compact not available in maintenance mode.
 */
class Orphans extends Command {
    public function __construct(
        private OrphanReconciler $reconciler,
    ) {
        parent::__construct();
    }

    protected function configure(): void {
        $this->setName('knorke:orphans')
            ->setDescription('Remove Knorke shares, link memberships, open votes and boards of accounts and groups that no longer exist.')
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Only count, change nothing.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int {
        $err = $output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output;
        $dryRun = (bool)$input->getOption('dry-run');
        try {
            $result = $this->reconciler->reconcile($dryRun);
        } catch (\Throwable $e) {
            $err->writeln('The orphan check could not run: ' . $e->getMessage());
            return 1;
        }
        foreach (OrphanReconciler::KINDS as $kind) {
            $output->writeln($kind . ': ' . (int)($result['counts'][$kind] ?? 0));
        }
        if ($dryRun) {
            $output->writeln('Dry run: nothing was changed.');
        }
        if ($result['failed'] > 0) {
            $err->writeln(sprintf('%d account(s) or group(s) could not be cleaned up completely; see the Nextcloud log.', $result['failed']));
            return 1;
        }
        return 0;
    }
}
