<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\BackgroundJob\VoteCloseJob;
use OCA\Knorke\Command\EpochRotate;
use OCA\Knorke\Migration\InitEpoch;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\PresenceStore;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\VoteHarness;
use OCA\Knorke\Tests\Support\MemoryCache;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\Migration\IOutput;
use OCP\Security\ISecureRandom;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;

/**
 * The board epoch (SPEC-M1 §5.4, §9.7): an injected service, current() reads
 * the preloaded (non-lazy) app config only, missing → '0' with one warning
 * per process, rotate() and InitEpoch write NOT lazy, InitEpoch never
 * changes a set epoch; occ knorke:epoch:rotate prints the new one. Also the
 * VoteCloseJob class and interval (§3, R2; its run() since stage 3).
 */
final class EpochTest extends TestCase {
    /** @var array<string, array{value: string, lazy: bool}> knorke app config */
    private array $config = [];
    /** @var list<string> */
    private array $warnings = [];
    /** @var list<string> values the fake random generator hands out, in order */
    private array $randoms = [];

    protected function setUp(): void {
        Epoch::resetWarning();
    }

    protected function tearDown(): void {
        Epoch::resetWarning();
    }

    private function epoch(): Epoch {
        $appConfig = Fake::of(IAppConfig::class, [
            // Like OC\AppConfig: lazy = false only sees the preloaded set, lazy = true sees both.
            'getValueString' => function (string $app, string $key, string $default = '', bool $lazy = false): string {
                $this->assertSame('knorke', $app);
                $e = $this->config[$key] ?? null;
                return $e === null || ($e['lazy'] && !$lazy) ? $default : $e['value'];
            },
            'setValueString' => function (string $app, string $key, string $value, bool $lazy = false): bool {
                $this->assertSame('knorke', $app);
                $this->config[$key] = ['value' => $value, 'lazy' => $lazy];
                return true;
            },
            'isLazy' => fn (string $app, string $key): bool => $this->config[$key]['lazy'] ?? throw new \LogicException('unknown key'),
        ]);
        $random = Fake::of(ISecureRandom::class, [
            'generate' => function (int $length, string $chars = ''): string {
                $this->assertSame(Epoch::LENGTH, $length);
                $this->assertSame('abcdefghijklmnopqrstuvwxyz0123456789', $chars, 'lower case and digits');
                return array_shift($this->randoms) ?? throw new \LogicException('no random value left');
            },
        ]);
        $logger = Fake::of(LoggerInterface::class, ['warning' => function ($message, array $context = []): void {
            $this->warnings[] = (string)$message;
        }]);
        return new Epoch($appConfig, $random, $logger);
    }

    public function testCurrent(): void {
        $this->config['epoch'] = ['value' => 'k3x9a0b2', 'lazy' => false];
        $this->assertSame('k3x9a0b2', $this->epoch()->current());
        $this->assertSame([], $this->warnings);
    }

    public function testMissingIsZeroWithOneWarningPerProcess(): void {
        $e = $this->epoch();
        $this->assertSame('0', $e->current());
        $this->assertSame('0', $e->current());
        $this->assertSame('0', $this->epoch()->current());
        $this->assertCount(1, $this->warnings, 'one warning per process');
        // Invalid values and a value in the lazy set count as missing.
        foreach (['ABCDEFGH', 'abc', str_repeat('a', 17), 'k3x9/a0b'] as $bad) {
            $this->config['epoch'] = ['value' => $bad, 'lazy' => false];
            $this->assertSame('0', $this->epoch()->current(), $bad);
        }
        $this->config['epoch'] = ['value' => 'k3x9a0b2', 'lazy' => true];
        $this->assertSame('0', $this->epoch()->current(), 'lazy: not in the preloaded set');
        $this->assertCount(1, $this->warnings);
    }

    public function testRotateWritesNotLazyAndNeverTheSameValue(): void {
        $this->config['epoch'] = ['value' => 'aaaaaaaa', 'lazy' => false];
        $this->randoms = ['aaaaaaaa', 'bbbbbbbb'];
        $this->assertSame('bbbbbbbb', $this->epoch()->rotate());
        $this->assertSame(['value' => 'bbbbbbbb', 'lazy' => false], $this->config['epoch']);
        $this->assertSame('bbbbbbbb', $this->epoch()->current());
        // From a lazy epoch: written into the preloaded set.
        $this->config['epoch'] = ['value' => 'cccccccc', 'lazy' => true];
        $this->randoms = ['dddddddd'];
        $this->assertSame('dddddddd', $this->epoch()->rotate());
        $this->assertFalse($this->config['epoch']['lazy']);
    }

    public function testInitEpochSetsOnlyWhenEmpty(): void {
        $infos = [];
        $output = Fake::of(IOutput::class, ['info' => function (string $m) use (&$infos): void {
            $infos[] = $m;
        }]);
        $this->randoms = ['k3x9a0b2'];
        $step = new InitEpoch($this->epoch());
        $this->assertNotSame('', $step->getName());
        $step->run($output);
        $this->assertSame(['value' => 'k3x9a0b2', 'lazy' => false], $this->config['epoch'], 'set, not lazy');
        $step->run($output);
        $this->assertSame(['value' => 'k3x9a0b2', 'lazy' => false], $this->config['epoch'], 'never changed once set');
        $this->assertSame(['Knorke: board epoch set.', 'Knorke: board epoch already set.'], $infos);
        // A set epoch in the lazy set moves to the preloaded set with the same value.
        $this->config['epoch'] = ['value' => 'zzzzzzzz', 'lazy' => true];
        $step->run($output);
        $this->assertSame(['value' => 'zzzzzzzz', 'lazy' => false], $this->config['epoch']);
        $this->assertSame([], $this->randoms);
        $this->assertSame([], $this->warnings);
    }

    public function testInitEpochReportsInsteadOfThrowing(): void {
        $warned = [];
        $output = Fake::of(IOutput::class, ['warning' => function (string $m) use (&$warned): void {
            $warned[] = $m;
        }]);
        $broken = new Epoch(
            Fake::of(IAppConfig::class, ['getValueString' => fn () => throw new \RuntimeException('type conflict')]),
            Fake::of(ISecureRandom::class),
            Fake::of(LoggerInterface::class),
        );
        (new InitEpoch($broken))->run($output);
        $this->assertCount(1, $warned);
        $this->assertStringContainsString('occ knorke:epoch:rotate', $warned[0]);
    }

    public function testEpochIsInjectedNotStatic(): void {
        $rc = new \ReflectionClass(Epoch::class);
        foreach (['current', 'rotate'] as $m) {
            $this->assertFalse($rc->getMethod($m)->isStatic(), "Epoch::$m is an instance method (§9.7)");
            $this->assertSame('string', (string)$rc->getMethod($m)->getReturnType());
        }
        $this->assertSame(Epoch::class, (string)(new \ReflectionMethod(EpochRotate::class, '__construct'))->getParameters()[0]->getType());
        $this->assertSame(Epoch::class, (string)(new \ReflectionMethod(InitEpoch::class, '__construct'))->getParameters()[0]->getType());
    }

    public function testRotateChangesThePrefixOfBothCaches(): void {
        // SPEC-M1 §5.1/§5.4: FastCache and PresenceStore build their cache under
        // 'knorke/' . current() . '/'; after rotate() the next request (new
        // instances) uses the new prefix, a missing epoch the prefix knorke/0/.
        $this->config['epoch'] = ['value' => 'aaaaaaaa', 'lazy' => false];
        $mem = new MemoryCache();
        new FastCache($mem->factory(), $this->epoch());
        new PresenceStore($mem->factory(), $this->epoch());
        $this->randoms = ['bbbbbbbb'];
        $this->epoch()->rotate();
        new FastCache($mem->factory(), $this->epoch());
        new PresenceStore($mem->factory(), $this->epoch());
        unset($this->config['epoch']);
        new FastCache($mem->factory(), $this->epoch());
        $this->assertSame(['knorke/aaaaaaaa/', 'knorke/aaaaaaaa/', 'knorke/bbbbbbbb/', 'knorke/bbbbbbbb/', 'knorke/0/'], $mem->prefixes);
        $this->assertCount(1, $this->warnings, 'the missing epoch warned once');
    }

    public function testRotateCommand(): void {
        $this->config['epoch'] = ['value' => 'aaaaaaaa', 'lazy' => false];
        $this->randoms = ['m1n2b3v4'];
        $cmd = new EpochRotate($this->epoch());
        $this->assertSame('knorke:epoch:rotate', $cmd->getName());
        $out = new BufferedOutput();
        $this->assertSame(0, $cmd->run(new ArrayInput([]), $out));
        $this->assertSame("m1n2b3v4\n", $out->fetch());
        $this->assertSame('m1n2b3v4', $this->config['epoch']['value']);
    }

    public function testVoteCloseJobRunsEvery300Seconds(): void {
        // The class exists since stage 0 (info.xml registers it once); stage 3
        // fills run() with VoteService::closeExpired (VoteServiceTest covers it).
        $job = new VoteCloseJob(Fake::of(ITimeFactory::class, ['getTime' => fn () => 1_760_000_000]), (new VoteHarness())->votes);
        $this->assertSame(300, VoteCloseJob::INTERVAL);
        $interval = (new \ReflectionClass($job))->getProperty('interval');
        $this->assertSame(300, $interval->getValue($job));
        $this->assertSame([\OCP\AppFramework\Utility\ITimeFactory::class, \OCA\Knorke\Service\VoteService::class], array_map(
            static fn (\ReflectionParameter $p): string => (string)$p->getType(),
            (new \ReflectionMethod(VoteCloseJob::class, '__construct'))->getParameters(),
        ));
    }
}
