<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCP\IUser;

/**
 * The Guests app's OCA\Guests\AppWhitelist as GuestsAppWhitelist uses it
 * (jobs 030, 055): logs every isUrlAllowed() as [uid, url] in $calls, then
 * throws $throw or answers $answer (any value, as a changed Guests app
 * might). Both can be switched between two calls.
 */
final class FakeGuestsWhitelist {
    /** @var list<array{0: string, 1: mixed}> */
    public array $calls = [];

    public function __construct(
        public mixed $answer = true,
        public ?\Throwable $throw = null,
    ) {
    }

    /**
     * What a test container hands out for GuestsAppWhitelist::WHITELIST in a
     * case of BoardSearchProviderTest::guestsFailures(): null for (a) (the
     * container then throws NotFoundExceptionInterface), a stdClass for (b),
     * a whitelist that throws for (c), one answering $answer for (d).
     */
    public static function failing(string $kind, mixed $answer): ?object {
        return match ($kind) {
            'missing' => null,
            'stdClass' => new \stdClass(),
            'throws' => new self(true, new \RuntimeException('guests broken')),
            'answer' => new self($answer),
        };
    }

    public function isUrlAllowed(IUser $user, $url): mixed {
        $this->calls[] = [$user->getUID(), $url];
        if ($this->throw !== null) {
            throw $this->throw;
        }
        return $this->answer;
    }
}
