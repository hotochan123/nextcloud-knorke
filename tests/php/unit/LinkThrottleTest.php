<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Tests\Support\Fake;
use OCP\Security\Bruteforce\IThrottler;
use OCP\Security\Bruteforce\MaxDelayReached;
use PHPUnit\Framework\TestCase;

/** Miss-only throttle (SPEC-M0 §4.9.5) with a fake IThrottler counting like NC 34 (> 10 attempts → throw). */
final class LinkThrottleTest extends TestCase {
    /** @var list<string> */
    private array $calls = [];
    private int $attempts = 0;

    private function throttle(): LinkThrottle {
        $t = Fake::of(IThrottler::class, [
            'sleepDelayOrThrowOnMax' => function (string $ip, string $action = ''): int {
                $this->calls[] = "check $ip $action";
                if ($this->attempts > 10) {
                    throw new MaxDelayReached('blocked');
                }
                return 0;
            },
            'registerAttempt' => function (string $action, string $ip, array $metadata = []): void {
                $this->calls[] = "register $action $ip";
                $this->attempts++;
            },
        ]);
        return new LinkThrottle($t);
    }

    public function testOrderCheckRegisterCheck(): void {
        $this->assertFalse($this->throttle()->missBlocked('10.0.0.1'));
        $this->assertSame(['check 10.0.0.1 knorke_link', 'register knorke_link 10.0.0.1', 'check 10.0.0.1 knorke_link'], $this->calls);
    }

    public function testEleventhMissIsTheFirst429(): void {
        $lt = $this->throttle();
        for ($i = 1; $i <= 10; $i++) {
            $this->assertFalse($lt->missBlocked('10.0.0.1'), "miss $i");
        }
        $this->assertTrue($lt->missBlocked('10.0.0.1'), 'miss 11');
    }

    public function testBlockedAddressRegistersNothingMore(): void {
        $lt = $this->throttle();
        $this->attempts = 11;
        $this->calls = [];
        $this->assertTrue($lt->missBlocked('10.0.0.1'));
        $this->assertSame(['check 10.0.0.1 knorke_link'], $this->calls, 'no registerAttempt once blocked');
        $this->assertSame(11, $this->attempts);
    }
}
