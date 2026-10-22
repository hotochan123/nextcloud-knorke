<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCP\Security\Bruteforce\IThrottler;
use OCP\Security\Bruteforce\MaxDelayReached;

/**
 * Miss-only throttle for link tokens (SPEC-M0 §4.9.5), port of Pulse
 * PublicVoteController::codeMissBlocked().
 *
 * Called ONLY after a lookup found no link row at all (a token that was never
 * issued). Hits — active or revoked links — never ask it, so neither a typo
 * nor a rotated link locks the devices behind a workshop NAT out of existing
 * boards. Nextcloud 34 does not sleep any more; it throws once an address has
 * more than 10 attempts in 30 minutes: 10 × 404, the 11th is 429.
 */
final class LinkThrottle {
    public const ACTION = 'knorke_link';

    public function __construct(
        private IThrottler $throttler,
    ) {
    }

    /**
     * An unknown link token from $ip: true = blocked (answer 429). An address
     * that is already blocked gets its 429 WITHOUT another attempt (otherwise
     * a device that keeps polling would keep the block alive); otherwise the
     * miss is recorded and checked once more, so that the 11th miss is the
     * first 429.
     */
    public function missBlocked(string $ip): bool {
        try {
            $this->throttler->sleepDelayOrThrowOnMax($ip, self::ACTION);
            $this->throttler->registerAttempt(self::ACTION, $ip);
            $this->throttler->sleepDelayOrThrowOnMax($ip, self::ACTION);
        } catch (MaxDelayReached) {
            return true;
        }
        return false;
    }
}
