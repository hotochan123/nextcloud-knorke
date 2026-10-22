<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Limits;
use OCA\Knorke\Tests\Support\Fake;
use OCP\IAppConfig;
use PHPUnit\Framework\TestCase;

/**
 * Limits (SPEC-M0 §4.8, SPEC-M1 §4.8): forClient() is an instance method
 * (R2) and reads the overridable app config; only a positive whole number
 * overrides a default.
 */
final class LimitsTest extends TestCase {
    /** @param array<string, mixed> $app app config values; a Throwable is thrown by getValueInt */
    private static function limits(array $app): Limits {
        return new Limits(Fake::of(IAppConfig::class, [
            'getValueInt' => function (string $a, string $k, int $d = 0, ?bool $lazy = false) use ($app): int {
                $v = $app[$k] ?? $d;
                if ($v instanceof \Throwable) {
                    throw $v;
                }
                return $v;
            },
        ]));
    }

    /**
     * Limits over Nextcloud's typed app config as occ config:app:set leaves
     * it (P7): a value stored as text (mixed); getValueInt casts text like
     * (int) does (so "abc" would read as 0), getValueString returns the
     * text; a Throwable stands for a type conflict.
     *
     * @param array<string, string|\Throwable> $stored
     */
    private static function stored(array $stored): Limits {
        $get = static function (string $k) use ($stored): ?string {
            $v = $stored[$k] ?? null;
            if ($v instanceof \Throwable) {
                throw $v;
            }
            return $v;
        };
        return new Limits(Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $a, string $k, int $d = 0, ?bool $lazy = false): int => ($v = $get($k)) === null ? $d : (int)$v,
            'getValueString' => fn (string $a, string $k, string $d = '', ?bool $lazy = false): string => $get($k) ?? $d,
        ]));
    }

    public function testByteKeysCountOnlyAsDigitText(): void {
        // P7 (SPEC-M1 §33.1 a, ED-01): "0" = off, digits = bytes, anything else = the default.
        $read = static fn (Limits $l): array => [$l->budgetBytesBoardDay(), $l->budgetBytesUserDay(), $l->changesBytesCap()];
        $this->assertSame([268435456, 536870912, 67108864], $read(self::stored([])), 'defaults: 256 MiB, 512 MiB, 64 MiB');
        $this->assertSame([268435456, 536870912, 67108864], [Limits::DEFAULT_BUDGET_BYTES_BOARD_DAY, Limits::DEFAULT_BUDGET_BYTES_USER_DAY, Limits::DEFAULT_CHANGES_BYTES_CAP]);
        $this->assertSame([0, 0, 0], $read(self::stored(['budget_bytes_board_day' => '0', 'budget_bytes_user_day' => '0', 'changes_bytes_cap' => '0'])), '0 switches off');
        $this->assertSame([4000, 1, 20000], $read(self::stored(['budget_bytes_board_day' => '4000', 'budget_bytes_user_day' => '1', 'changes_bytes_cap' => '20000'])));
        $this->assertSame(999999999999999999, self::stored(['changes_bytes_cap' => '999999999999999999'])->changesBytesCap(), '18 digits');
        foreach (['', 'abc', '-1', '+5', '1.5', '1e3', ' 5', '5 ', "5\n", '0x10', '1000000000000000000', '４'] as $bad) {
            $this->assertSame([268435456, 536870912, 67108864],
                $read(self::stored(['budget_bytes_board_day' => $bad, 'budget_bytes_user_day' => $bad, 'changes_bytes_cap' => $bad])),
                'a typo is never "off": ' . json_encode($bad));
        }
        $conflict = new \RuntimeException('conflict with value type from database');
        $this->assertSame([268435456, 536870912, 67108864],
            $read(self::stored(['budget_bytes_board_day' => $conflict, 'budget_bytes_user_day' => $conflict, 'changes_bytes_cap' => $conflict])), 'type conflict → default');
        $this->assertSame(['budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap', 'link_limit'],
            [Limits::KEY_BUDGET_BYTES_BOARD_DAY, Limits::KEY_BUDGET_BYTES_USER_DAY, Limits::KEY_CHANGES_BYTES_CAP, Limits::KEY_LINK_LIMIT]);
    }

    public function testLinkLimitFollowsTheRuleOfRead(): void {
        // P7 (§33.1 a/d, ED-02): only a positive whole number overrides 20; 0 is not "off".
        $this->assertSame(20, self::stored([])->linkLimit());
        $this->assertSame(1000, self::stored(['link_limit' => '1000'])->linkLimit());
        $this->assertSame(3, self::limits(['link_limit' => 3])->linkLimit());
        foreach (['0', '-4', 'abc', ''] as $bad) {
            $this->assertSame(20, self::stored(['link_limit' => $bad])->linkLimit(), 'link_limit ' . json_encode($bad));
        }
        $this->assertSame(20, self::stored(['link_limit' => new \RuntimeException('typed')])->linkLimit());
        $this->assertSame([20, 600], [Limits::DEFAULT_LINK_LIMIT, Limits::LINK_PERIOD]);
    }

    public function testForClientIsAnInstanceMethod(): void {
        $this->assertFalse((new \ReflectionMethod(Limits::class, 'forClient'))->isStatic());
    }

    public function testForClientDefaults(): void {
        $this->assertSame(
            ['maxText' => 6000, 'maxTitle' => 200, 'maxOps' => 200, 'nameMax' => 40, 'maxItemBytes' => 65536, 'maxItems' => 5000, 'maxLabel' => 200],
            self::limits([])->forClient(),
        );
        $this->assertSame(200, Limits::MAX_LABEL);
    }

    public function testForClientReadsOverriddenValues(): void {
        $this->assertSame(3000, self::limits(['max_items_per_board' => 3000])->forClient()['maxItems']);
        $this->assertSame(3000, self::limits(['max_items_per_board' => 3000])->maxItemsPerBoard(), 'the same value the write path uses');
        foreach ([0, -1] as $bad) {
            $this->assertSame(5000, self::limits(['max_items_per_board' => $bad])->forClient()['maxItems'], "override $bad");
        }
        $this->assertSame(5000, self::limits(['max_items_per_board' => new \RuntimeException('typed as string')])->forClient()['maxItems'], 'unreadable → default');
    }

    public function testStageFourKeysOfTheHarness(): void {
        // SPEC-M1 §4.8 / §8.1: HARNESS_APP_CONFIG = budget_syncs budget_ops
        // tombstone_days tombstone_cap changes_cap, positive whole numbers.
        $read = static fn (Limits $l): array => [$l->budgetSyncs(), $l->budgetOps(), $l->tombstoneDays(), $l->tombstoneCap(), $l->changesCap(), $l->tombstoneRetentionMs()];
        $this->assertSame([60, 2000, 30, 10000, 100000, 30 * 86400000], $read(self::limits([])));
        $this->assertSame([3, 40, 2, 7, 50, 2 * 86400000], $read(self::limits(['budget_syncs' => 3, 'budget_ops' => 40, 'tombstone_days' => 2, 'tombstone_cap' => 7, 'changes_cap' => 50])));
        $this->assertSame([60, 2000, 30, 10000, 100000, 30 * 86400000],
            $read(self::limits(['budget_syncs' => 0, 'budget_ops' => -5, 'tombstone_days' => new \RuntimeException('string'), 'tombstone_cap' => 0, 'changes_cap' => -1])), 'garbage keeps the defaults');
        $this->assertSame(['budget_syncs', 'budget_ops', 'tombstone_days', 'tombstone_cap', 'changes_cap'],
            [Limits::KEY_BUDGET_SYNCS, Limits::KEY_BUDGET_OPS, Limits::KEY_TOMBSTONE_DAYS, Limits::KEY_TOMBSTONE_CAP, Limits::KEY_CHANGES_CAP]);
        $this->assertSame([30, 60, 300, 60], [Limits::SNAPSHOT_LIMIT, Limits::SNAPSHOT_PERIOD, Limits::SNAPSHOT_IP_LIMIT, Limits::SNAPSHOT_IP_PERIOD]);
    }
}
