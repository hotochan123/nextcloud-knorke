<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\WriteBudget;
use OCA\Knorke\Tests\Support\EpochStub;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\MemoryCache;
use OCP\IAppConfig;
use PHPUnit\Framework\TestCase;

/**
 * WriteBudget (SPEC-M1 §4.13.6, §5.1, §8.2 (4)): two fixed-window counters
 * per (board, pid) — w: requests with ops, wo: ops plus derived rows —
 * window floor(now / 10000), add(…, 0, 25) + inc; over BUDGET_SYNCS (60) or
 * BUDGET_OPS (2000) → retryMs = (win + 1)·10000 − now + 100; app config
 * budget_syncs/budget_ops override (positive whole numbers only); no Redis
 * → no budget.
 *
 * P7 (SPEC-M1 §33.1 b): the daily byte quota — wd:<b>:<tag> per board and
 * wu:<uh>:<tag> per account (uh = sha256(uid)[0..24], no wu: for guests),
 * tag = floor(now / 86400000), add(…, 0, 90000) + inc(bytes); admit()
 * raises all four counters first and decides afterwards (also busy requests
 * and quota 0 count); retryMs = min((tag + 1)·86400000 − now, 60000) + 100,
 * the larger one when both budgets are over.
 */
final class WriteBudgetTest extends TestCase {
    private const NOW = 1_760_000_003_456;
    private MemoryCache $mem;
    /** @var array<string, mixed> */
    private array $app = [];

    private function budget(bool $redis = true): WriteBudget {
        $this->mem = new MemoryCache();
        $this->mem->available = $redis;
        $limits = new Limits(Fake::of(IAppConfig::class, [
            'getValueInt' => function (string $app, string $key, int $default = 0, ?bool $lazy = false): int {
                $v = $this->app[$key] ?? $default;
                if (!is_int($v)) {
                    throw new \RuntimeException('type conflict');
                }
                return $v;
            },
            'getValueString' => fn (string $app, string $key, string $default = '', ?bool $lazy = false): string => isset($this->app[$key]) ? (string)$this->app[$key] : $default,
        ]));
        return new WriteBudget(new FastCache($this->mem->factory(), (new EpochStub())->epoch()), $limits);
    }

    private static function p(string $pid = '0123456789abcdef', string $uid = 'alice'): Principal {
        return new Principal('u:' . $uid, Role::Owner, ucfirst($uid), $pid, false, $uid, 'owner');
    }

    private static function guestP(string $pid = 'feedfacefeedface'): Principal {
        return new Principal('g:gAAAAAAAAAAA', Role::Edit, 'Gina', $pid, true, null, 'guest');
    }

    /** Key of the account counter of $uid on the day of $now. */
    private static function wu(string $uid, int $now): string {
        return 'wu:' . substr(hash('sha256', $uid), 0, 24) . ':' . intdiv($now, 86400000);
    }

    public function testRetryMsAndWindow(): void {
        $this->assertSame(176000000, WriteBudget::window(self::NOW));
        $this->assertSame(6644, WriteBudget::retryMs(self::NOW), '(win + 1)·10000 − now + 100');
        $this->assertSame(10100, WriteBudget::retryMs(1_760_000_000_000), 'at the start of a window');
        $this->assertSame(101, WriteBudget::retryMs(1_760_000_009_999), 'at its last ms');
    }

    public function testSixtyRequestsPassTheSixtyFirstIsOver(): void {
        $b = $this->budget();
        for ($i = 1; $i <= 60; $i++) {
            $this->assertNull($b->check(self::p(), 7, 1, self::NOW + $i), "request $i");
        }
        $this->assertSame(WriteBudget::retryMs(self::NOW + 61), $b->check(self::p(), 7, 1, self::NOW + 61));
        $win = 176000000;
        $this->assertSame([61, 61], [$this->mem->get('w:7:0123456789abcdef:' . $win), $this->mem->get('wo:7:0123456789abcdef:' . $win)]);
        $this->assertSame([25, 25], [$this->mem->ttl('w:7:0123456789abcdef:' . $win), $this->mem->ttl('wo:7:0123456789abcdef:' . $win)], 'TTL 25 s, never without');
        $this->assertNull($b->check(self::p(), 7, 1, ($win + 1) * 10000), 'the next window starts at 0');
    }

    public function testOpsBudgetCountsOpsAndDerivedRows(): void {
        $b = $this->budget();
        for ($i = 0; $i < 10; $i++) {
            $this->assertNull($b->check(self::p(), 7, 200, self::NOW));
        }
        $this->assertNotNull($b->check(self::p(), 7, 1, self::NOW), 'the 2001st op');
        // charge: derived rows count as ops and make the NEXT request busy.
        $b = $this->budget();
        $this->assertNull($b->check(self::p(), 7, 1, self::NOW));
        $b->charge(self::p(), 7, 1999, self::NOW);
        $this->assertSame(2000, $this->mem->get('wo:7:0123456789abcdef:176000000'));
        $this->assertSame(WriteBudget::retryMs(self::NOW), $b->check(self::p(), 7, 1, self::NOW));
        $this->assertNull($b->check(self::p('fedcba9876543210'), 7, 1, self::NOW), 'another pid is not charged');
        $this->assertNull($b->check(self::p(), 8, 1, self::NOW), 'another board is not charged');
    }

    public function testNothingForEmptyRequestsAndZeroCharges(): void {
        $b = $this->budget();
        $this->assertNull($b->check(self::p(), 7, 0, self::NOW));
        $b->charge(self::p(), 7, 0, self::NOW);
        $b->charge(self::p(), 7, -3, self::NOW);
        $this->assertSame([], $this->mem->log, 'no key touched (an empty poll costs nothing)');
    }

    public function testAppConfigOverridesAndIgnoresGarbage(): void {
        $this->app = ['budget_syncs' => 2, 'budget_ops' => 5];
        $b = $this->budget();
        $this->assertNull($b->check(self::p(), 7, 2, self::NOW));
        $this->assertNull($b->check(self::p(), 7, 3, self::NOW));
        $this->assertNotNull($b->check(self::p(), 7, 1, self::NOW), 'third request over budget_syncs 2');
        $b = $this->budget();
        $this->assertNotNull($b->check(self::p(), 7, 6, self::NOW), 'six ops over budget_ops 5');
        foreach ([0, -1, 'x'] as $garbage) {
            $this->app = ['budget_syncs' => $garbage, 'budget_ops' => $garbage];
            $b = $this->budget();
            for ($i = 1; $i <= 60; $i++) {
                $this->assertNull($b->check(self::p(), 7, 1, self::NOW));
            }
            $this->assertNotNull($b->check(self::p(), 7, 1, self::NOW), 'garbage keeps the default 60: ' . var_export($garbage, true));
        }
    }

    public function testDayRetryMs(): void {
        $day = 20370 * 86400000;
        $this->assertSame(20370, WriteBudget::day($day + 5));
        $this->assertSame(60100, WriteBudget::dayRetryMs($day), 'a whole day left: capped at 60 s + 100');
        $this->assertSame(60100, WriteBudget::dayRetryMs($day + 86400000 - 60000), 'exactly 60 s left');
        $this->assertSame(30100, WriteBudget::dayRetryMs($day + 86400000 - 30000), 'the rest of the day + 100');
        $this->assertSame(101, WriteBudget::dayRetryMs($day + 86400000 - 1), 'the last ms of the day');
        $this->assertSame(0, WriteBudget::busyRetryMs(0, $day));
        $this->assertSame(WriteBudget::retryMs($day + 3456), WriteBudget::busyRetryMs(WriteBudget::OVER_WINDOW, $day + 3456));
        $this->assertSame(60100, WriteBudget::busyRetryMs(WriteBudget::OVER_DAY, $day + 3456));
        $this->assertSame(60100, WriteBudget::busyRetryMs(WriteBudget::OVER_WINDOW | WriteBudget::OVER_DAY, $day + 3456), 'both over: the larger one');
        $late = $day + 86400000 - 2000;
        $this->assertSame(WriteBudget::retryMs($late), WriteBudget::busyRetryMs(WriteBudget::OVER_WINDOW | WriteBudget::OVER_DAY, $late),
            'near midnight the window wait (8100) is larger than the day wait (2100)');
        $this->assertSame(2100, WriteBudget::dayRetryMs($late));
    }

    public function testBoardQuotaCountsEveryRequestWithOpsFirst(): void {
        // C81 (b) in small: 4000 bytes per board and day, ≈1500 per request.
        $this->app = ['budget_bytes_board_day' => '4000', 'budget_bytes_user_day' => '0'];
        $b = $this->budget();
        $tag = intdiv(self::NOW, 86400000);
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 1500, self::NOW));
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 1500, self::NOW + 1));
        $this->assertSame(WriteBudget::OVER_DAY, $b->admit(self::p(), 7, 1, 1500, self::NOW + 2), 'the third: 4500 > 4000');
        $this->assertSame(WriteBudget::OVER_DAY, $b->admit(self::p(), 7, 1, 10, self::NOW + 3), 'and every later one that day');
        $this->assertSame(4510, $this->mem->get('wd:7:' . $tag), 'busy requests count too (ED-05)');
        $this->assertSame(90000, $this->mem->ttl('wd:7:' . $tag), 'TTL 25 h');
        $this->assertSame(4, $this->mem->get('w:7:0123456789abcdef:176000000'), 'the window counters were raised as well');
        $this->assertSame(0, $b->admit(self::p(), 8, 1, 1500, self::NOW + 4), 'another board of the same account: ok');
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 1500, ($tag + 1) * 86400000), 'the next UTC day starts at 0');
        $this->assertSame(0, $b->admit(self::p(), 7, 0, 99999, self::NOW + 5), 'no ops: nothing counted');
        $this->assertSame(4510, $this->mem->get('wd:7:' . $tag));
    }

    public function testUserQuotaOverAllBoardsGuestsOnlyPerBoard(): void {
        // C81 (c) in small: 4000 bytes per account and day over all boards.
        $this->app = ['budget_bytes_user_day' => '4000'];
        $b = $this->budget();
        $this->assertSame(0, $b->admit(self::p(), 1, 1, 1500, self::NOW));
        $this->assertSame(0, $b->admit(self::p('fedcba9876543210'), 1, 1, 1500, self::NOW), 'another tab (pid) of alice: same account');
        $this->assertSame(WriteBudget::OVER_DAY, $b->admit(self::p(), 2, 1, 1500, self::NOW), 'alice on another board: over 4000');
        $this->assertSame(4500, $this->mem->get(self::wu('alice', self::NOW)));
        $this->assertSame(90000, $this->mem->ttl(self::wu('alice', self::NOW)));
        $this->assertSame(0, $b->admit(self::p('1111111111111111', 'bob'), 3, 1, 1500, self::NOW), 'bob has his own counter');
        $this->assertSame(0, $b->admit(self::guestP(), 1, 1, 3900, self::NOW), 'guests count only per board (board quota at its default)');
        $wu = array_values(array_filter(array_keys($this->mem->data), static fn (string $k): bool => str_contains($k, 'wu:')));
        sort($wu);
        $want = [self::wu('alice', self::NOW), self::wu('bob', self::NOW)];
        sort($want);
        $this->assertCount(2, $wu, 'wu: only for alice and bob, none for the guest');
        foreach ($want as $i => $k) {
            $this->assertStringEndsWith($k, $wu[$i]);
        }
        $tag = intdiv(self::NOW, 86400000);
        $this->assertSame([6900, 1500, 1500], [$this->mem->get('wd:1:' . $tag), $this->mem->get('wd:2:' . $tag), $this->mem->get('wd:3:' . $tag)],
            'per board: both alice tabs and the guest on board 1');
    }

    public function testQuotaZeroIsOffButCounts(): void {
        $this->app = ['budget_bytes_board_day' => '0', 'budget_bytes_user_day' => '0'];
        $b = $this->budget();
        for ($i = 0; $i < 5; $i++) {
            $this->assertSame(0, $b->admit(self::p(), 7, 1, 1000000, self::NOW + $i));
        }
        $this->assertSame(5000000, $this->mem->get('wd:7:' . intdiv(self::NOW, 86400000)), 'the counter keeps counting (ED-07)');
        $this->assertSame(5000000, $this->mem->get(self::wu('alice', self::NOW)));
        // A typo is never off: "abc" keeps the default 256 MiB, so 1 MB passes and is counted.
        $this->app = ['budget_bytes_board_day' => 'abc'];
        $b = $this->budget();
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 1000000, self::NOW));
        $this->app = ['budget_bytes_board_day' => '999999'];
        $b = $this->budget();
        $this->assertSame(WriteBudget::OVER_DAY, $b->admit(self::p(), 7, 1, 1000000, self::NOW), 'exactly over by one byte');
    }

    public function testWindowAndDayTogether(): void {
        $this->app = ['budget_syncs' => 1, 'budget_bytes_board_day' => '100'];
        $b = $this->budget();
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 100, self::NOW));
        $this->assertSame(WriteBudget::OVER_WINDOW | WriteBudget::OVER_DAY, $b->admit(self::p(), 7, 1, 1, self::NOW + 1));
        $this->app = ['budget_syncs' => 1];
        $b = $this->budget();
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 1, self::NOW));
        $this->assertSame(WriteBudget::OVER_WINDOW, $b->admit(self::p(), 7, 1, 1, self::NOW + 1));
        $tag = intdiv(self::NOW, 86400000);
        $this->assertSame(2, $this->mem->get('wd:7:' . $tag), 'the day counter counts the window-busy request too');
    }

    public function testWithoutRedisNoBudget(): void {
        $b = $this->budget(false);
        for ($i = 0; $i < 100; $i++) {
            $this->assertNull($b->check(self::p(), 7, 200, self::NOW));
        }
        $b->charge(self::p(), 7, 5000, self::NOW);
        $this->assertNull($b->check(self::p(), 7, 1, self::NOW));
        $this->app = ['budget_bytes_board_day' => '1', 'budget_bytes_user_day' => '1'];
        $this->assertSame(0, $b->admit(self::p(), 7, 1, 1000000, self::NOW), 'no Redis: no daily quota either');
        $this->assertFalse($b->dayOver(self::p(), 7, 1000000, self::NOW));
        $this->assertSame([], $this->mem->data);
    }
}
