<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Command;

use OCA\Knorke\Service\Compactor;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * `occ knorke:compact [--board=N] [--now=ms]` (SPEC-M1 §4.13.7, R19 T4-07):
 *
 *  (a) without --board: one run of CleanupJob — instance-wide pruning of
 *      change rows and links older than 30 days, then per board (after the
 *      app config cleanup_cursor, 60-s budget) tombstones, changes cap and
 *      the 30-day cut;
 *  (b) --board=N: only board N, every block to the end, no budget; the
 *      cursor, the links and other boards stay untouched;
 *  (c) --now=<ms> replaces the clock for the cuts of this run only
 *      (tombstone retention, 24-h grace of the cap, 30 days), never for
 *      written values; the harness does not use it;
 *  (d) stdout: one JSON line per processed board,
 *      {"board","blocks","tombstones","changes","minRevBefore","minRev"}
 *      (blocks = tombstone blocks under the board lock); exit 0. An
 *      unknown board: a message on stderr, exit 1. A malformed option
 *      value: a message on stderr, exit 2.
 *
 * Registered through <commands> in appinfo/info.xml.
 */
class Compact extends Command {
    private const BOARD_RE = '/^[1-9][0-9]{0,17}\z/';
    private const NOW_RE = '/^[0-9]{1,16}\z/';

    public function __construct(
        private Compactor $compactor,
    ) {
        parent::__construct();
    }

    protected function configure(): void {
        $this->setName('knorke:compact')
            ->setDescription('Purge old Knorke tombstones and cap the change log (what the daily background job does); one JSON line per board.')
            ->addOption('board', null, InputOption::VALUE_REQUIRED, 'Only this board: every block, no time budget, cursor and links untouched.')
            ->addOption('now', null, InputOption::VALUE_REQUIRED, 'Clock in ms for the cuts of this run only (retention, 24-h grace, 30 days).');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int {
        $err = $output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output;
        $board = $input->getOption('board');
        $now = $input->getOption('now');
        if ($board !== null && (!is_string($board) || preg_match(self::BOARD_RE, $board) !== 1)) {
            $err->writeln('--board must be a board id (a positive whole number).');
            return 2;
        }
        if ($now !== null && (!is_string($now) || preg_match(self::NOW_RE, $now) !== 1)) {
            $err->writeln('--now must be a time in milliseconds since 1970 (a whole number).');
            return 2;
        }
        $nowMs = $now === null ? (int)floor(microtime(true) * 1000) : (int)$now;
        $line = static fn (array $l): string => json_encode($l, JSON_THROW_ON_ERROR);
        if ($board !== null) {
            $result = $this->compactor->board((int)$board, $nowMs);
            if ($result === null) {
                $err->writeln('Board ' . $board . ' not found.');
                return 1;
            }
            $output->writeln($line($result));
            return 0;
        }
        $summary = $this->compactor->run($nowMs, static function (array $l) use ($output, $line): void {
            $output->writeln($line($l));
        });
        if ($output->isVerbose()) {
            $err->writeln(sprintf('Instance-wide: %d change rows and %d links older than 30 days deleted; %d boards processed%s.',
                $summary['changes'], $summary['links'], count($summary['boards']), $summary['complete'] ? '' : ' (time budget used up, the next run continues)'));
        }
        return 0;
    }
}
