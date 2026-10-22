<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\GuestToken;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

/** Signed guest token (SPEC-M0 §4.9.3). */
final class GuestTokenTest extends TestCase {
    private int $now = 1_760_000_000;

    private function tokens(string $secret = 'test-secret'): GuestToken {
        $config = Fake::of(IConfig::class, ['getSystemValueString' => fn (string $k, string $d = ''): string => $k === 'secret' ? $secret : $d]);
        $time = Fake::of(ITimeFactory::class, ['getTime' => fn (): int => $this->now]);
        return new GuestToken($config, $time);
    }

    private function claims(array $over = []): array {
        return $over + ['v' => 1, 'b' => 7, 'g' => 'gA1b2C3d4E5x', 'r' => 'edit', 'lg' => 3, 'exp' => $this->now + 3600, 'n' => 'Gina'];
    }

    public function testRoundTrip(): void {
        $t = $this->tokens();
        $token = $t->issue($this->claims());
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\z/', $token);
        $this->assertSame($this->claims(), $t->verify($token));
    }

    public function testTamperedSignatureOrClaims(): void {
        $t = $this->tokens();
        $token = $t->issue($this->claims());
        [$payload, $sig] = explode('.', $token);
        $this->assertNull($t->verify($payload . '.' . strrev($sig)));
        $forged = rtrim(strtr(base64_encode(json_encode($this->claims(['b' => 8]))), '+/', '-_'), '=');
        $this->assertNull($t->verify($forged . '.' . $sig), 'other claims, old signature');
        $this->assertNull($this->tokens('other-secret')->verify($token), 'other instance secret');
        $this->assertNull($t->verify($token . '.x'));
        $this->assertNull($t->verify(''));
        $this->assertNull($t->verify('abc'));
    }

    public function testExpiry(): void {
        $t = $this->tokens();
        $token = $t->issue($this->claims(['exp' => $this->now - 1]));
        $this->assertNull($t->verify($token));
        $this->assertSame($this->now - 1, $t->verify($token, true)['exp']);
    }

    public function testClaimTypesAndVersion(): void {
        $t = $this->tokens();
        $this->assertNull($t->verify($t->issue($this->claims(['v' => 2]))));
        $this->assertNull($t->verify($t->issue($this->claims(['b' => '7']))));
        $this->assertNull($t->verify($t->issue($this->claims(['lg' => '3']))));
        $this->assertNull($t->verify($t->issue($this->claims(['g' => 'x']))));
        $claims = $this->claims();
        unset($claims['n']);
        $this->assertNull($t->verify($t->issue($claims)));
    }

    public function testSizeLimit(): void {
        $t = $this->tokens();
        $this->assertNull($t->verify($t->issue($this->claims(['n' => str_repeat('a', 900)]))), '> 1024 bytes');
        // 40 × a 4-byte emoji must be issued AND accepted (JSON_UNESCAPED_UNICODE).
        $token = $t->issue($this->claims(['n' => str_repeat('😀', 40)]));
        $this->assertLessThanOrEqual(1024, strlen($token));
        $this->assertSame(str_repeat('😀', 40), $t->verify($token)['n']);
    }
}
