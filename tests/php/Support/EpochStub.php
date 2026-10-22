<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Service\Epoch;
use OCP\IAppConfig;
use OCP\Security\ISecureRandom;
use Psr\Log\LoggerInterface;

/**
 * A real Epoch (final class, SPEC-M1 §9.7) over an in-memory app config that
 * holds one non-lazy value: $value is what current() answers; rotate()
 * stores the next of $next (or a counter value) in it.
 */
final class EpochStub {
    /** @var list<string> values rotate() hands out, in order */
    public array $next = [];
    private int $n = 0;

    public function __construct(public string $value = SyncHarness::EPOCH) {
    }

    public function epoch(): Epoch {
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueString' => fn (string $app, string $key, string $default = '', bool $lazy = false): string => $key === Epoch::KEY ? $this->value : $default,
            'setValueString' => function (string $app, string $key, string $value, bool $lazy = false): bool {
                if ($key === Epoch::KEY) {
                    $this->value = $value;
                }
                return true;
            },
            'isLazy' => fn (string $app, string $key): bool => false,
        ]);
        $random = Fake::of(ISecureRandom::class, [
            'generate' => fn (int $length, string $chars = ''): string => array_shift($this->next) ?? sprintf('e%07d', ++$this->n),
        ]);
        return new Epoch($appConfig, $random, Fake::of(LoggerInterface::class));
    }
}
