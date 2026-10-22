<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Command\Compact;
use OCA\Knorke\Service\Compactor;
use OCA\Knorke\Tests\Support\CompactorHarness;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\ConsoleSectionOutput;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * `occ knorke:compact [--board=N] [--now=ms]` (SPEC-M1 §4.13.7 (a)–(d), R19
 * T4-07): one JSON line per processed board on stdout with exactly the keys
 * board, blocks, tombstones, changes, minRevBefore, minRev; exit 0; an
 * unknown board → stderr, exit 1; a malformed option → stderr, exit 2;
 * --now only reaches the cuts. Runs the real command against the SQLite
 * Compactor of CompactorHarness.
 */
final class CompactCommandTest extends TestCase {
    private const NOW = 1_760_000_000_000;
    private CompactorHarness $h;
    private BufferedOutput $err;

    protected function setUp(): void {
        $this->h = new CompactorHarness();
    }

    /** @return array{0: int, 1: string, 2: string} [exit code, stdout, stderr] */
    private function exec(array $args, ?Compactor $compactor = null): array {
        $this->err = new BufferedOutput();
        $out = new class($this->err) extends BufferedOutput implements ConsoleOutputInterface {
            public function __construct(private OutputInterface $errOut) {
                parent::__construct();
            }

            public function getErrorOutput(): OutputInterface {
                return $this->errOut;
            }

            public function setErrorOutput(OutputInterface $error): void {
                $this->errOut = $error;
            }

            public function section(): ConsoleSectionOutput {
                throw new \LogicException('no sections');
            }
        };
        $cmd = new Compact($compactor ?? $this->h->compactor);
        $code = $cmd->run(new ArrayInput($args), $out);
        return [$code, $out->fetch(), $this->err->fetch()];
    }

    public function testNameAndOptions(): void {
        $cmd = new Compact($this->h->compactor);
        $this->assertSame('knorke:compact', $cmd->getName());
        $this->assertTrue($cmd->getDefinition()->hasOption('board'));
        $this->assertTrue($cmd->getDefinition()->hasOption('now'));
    }

    public function testOneBoard(): void {
        $b = $this->h->board(10);
        $this->h->items($b, 1, 4, 2, true, self::NOW - 40 * 86400000);
        [$code, $out, $err] = $this->exec(['--board' => (string)$b, '--now' => (string)self::NOW]);
        $this->assertSame([0, ''], [$code, $err]);
        $this->assertSame('{"board":' . $b . ',"blocks":1,"tombstones":4,"changes":0,"minRevBefore":0,"minRev":2}' . "\n", $out, 'exactly one JSON line, keys in this order');
        $this->assertSame([], $this->h->appWrites, 'the cursor stays untouched');
    }

    public function testUnknownBoardAndMalformedOptions(): void {
        [$code, $out, $err] = $this->exec(['--board' => '999']);
        $this->assertSame([1, ''], [$code, $out]);
        $this->assertSame("Board 999 not found.\n", $err);
        foreach ([['--board' => '0'], ['--board' => 'x'], ['--board' => '-3'], ['--now' => 'soon'], ['--now' => '-1'], ['--board' => '1', '--now' => '1.5']] as $bad) {
            [$code, $out, $err] = $this->exec($bad);
            $this->assertSame([2, ''], [$code, $out], json_encode($bad));
            $this->assertNotSame('', $err);
        }
    }

    public function testNowReachesOnlyTheCuts(): void {
        // A tombstone of NOW is due 30 days later: --now moves the cut, the real clock does not.
        $b = $this->h->board(10);
        $this->h->items($b, 1, 1, 1, true, self::NOW);
        [, $out] = $this->exec(['--board' => (string)$b, '--now' => (string)self::NOW]);
        $this->assertSame(0, json_decode($out, true)['tombstones']);
        [, $out] = $this->exec(['--board' => (string)$b, '--now' => (string)(self::NOW + 31 * 86400000)]);
        $this->assertSame(1, json_decode($out, true)['tombstones']);
    }

    public function testWithoutBoardOneLinePerBoard(): void {
        $ids = [$this->h->board(3), $this->h->board(3)];
        $this->h->items($ids[1], 1, 3, 1, true, self::NOW - 40 * 86400000);
        [$code, $out, $err] = $this->exec(['--now' => (string)self::NOW]);
        $this->assertSame([0, ''], [$code, $err]);
        $lines = array_map(static fn (string $l): array => json_decode($l, true, 4, JSON_THROW_ON_ERROR), explode("\n", trim($out)));
        $this->assertSame([
            ['board' => $ids[0], 'blocks' => 0, 'tombstones' => 0, 'changes' => 0, 'minRevBefore' => 0, 'minRev' => 0],
            ['board' => $ids[1], 'blocks' => 1, 'tombstones' => 3, 'changes' => 0, 'minRevBefore' => 0, 'minRev' => 3],
        ], $lines);
        $this->assertSame(['cleanup_cursor=' . $ids[1] . ' lazy'], $this->h->appWrites, 'like a run of CleanupJob');
    }
}
