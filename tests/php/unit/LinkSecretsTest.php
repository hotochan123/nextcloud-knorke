<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\LinkSecrets;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * Link passwords, failure counting per link and network, expiry as the
 * owner's calendar day (SPEC-M1 §4.11.2, §4.11.4, §7.5, R13 ownerZone).
 */
final class LinkSecretsTest extends TestCase {
    private AccessHarness $h;
    private LinkSecrets $s;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->s = $this->h->secrets;
    }

    private function expectHttp(int $status, string $code, callable $fn): HttpError {
        try {
            $fn();
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error]);
            return $e;
        }
        $this->fail("expected $status $code");
    }

    private static function policy(array $over = []): array {
        return $over + ['passwordEnforced' => false, 'expireDefaultDays' => null, 'expireEnforced' => false, 'expireMaxDays' => null];
    }

    // ── Networks (R2) ──────────────────────────────────────────────────────

    public function testNetOf(): void {
        $this->assertSame('10.0.0.1/32', $this->s->netOf('10.0.0.1'));
        $this->assertSame('10.0.0.1/32', $this->s->netOf('::ffff:10.0.0.1'), 'IPv4-mapped IPv6 is the IPv4 address');
        $this->assertSame('10.0.0.1/32', $this->s->netOf('::FFFF:10.0.0.1'));
        $a = $this->s->netOf('2001:db8:1:2:3:4:5:6');
        $this->assertSame('2001:db8:1::/56', $a);
        $this->assertSame($a, $this->s->netOf('2001:db8:1:2:ffff::1'), 'same /64, same counter');
        $this->assertSame($a, $this->s->netOf('2001:db8:1:ff:1::1'), 'same /56, same counter');
        $this->assertNotSame($a, $this->s->netOf('2001:db8:1:100::1'), 'another /56');
        $this->assertSame('2001:db8:1::/56', $this->s->netOf('[2001:db8:1:2::1]'));
        $this->assertSame('2001:db8:1::/56', $this->s->netOf('2001:db8:1:2::1%eth0'));
        $this->assertSame('not-an-ip', $this->s->netOf('not-an-ip'));
        $this->h->systemValues['security.ipv6_normalized_subnet_size'] = 48;
        $this->assertSame('2001:db8:1::/48', $this->s->netOf('2001:db8:1:ff00::1'));
        $this->h->systemValues['security.ipv6_normalized_subnet_size'] = 20;
        $this->assertSame('2001:db8::/32', $this->s->netOf('2001:db8:1:ff00::1'), 'clamped to 32');
        $this->h->systemValues['security.ipv6_normalized_subnet_size'] = 100;
        $this->assertSame('2001:db8:1:ff00::/64', $this->s->netOf('2001:db8:1:ff00::1'), 'clamped to 64');
        $this->h->systemValues['security.ipv6_normalized_subnet_size'] = 60;
        $this->assertSame('2001:db8:1:ff0::/60', $this->s->netOf('2001:db8:1:ff7::1'), 'a mask inside a byte');
    }

    public function testFailureWindowPerLinkAndNetwork(): void {
        $this->assertNull($this->s->failuresBlocked(5, '10.0.0.1'));
        for ($i = 0; $i < 19; $i++) {
            $this->s->registerFailure(5, '10.0.0.1');
        }
        $this->assertNull($this->s->failuresBlocked(5, '10.0.0.1'), '19 failures');
        $this->s->registerFailure(5, '::ffff:10.0.0.1');
        $win = intdiv($this->h->nowMs(), 600000);
        $retry = $this->s->failuresBlocked(5, '10.0.0.1');
        $this->assertSame(($win + 1) * 600000 - $this->h->nowMs(), $retry, '20 failures: blocked until the window ends');
        $this->assertNull($this->s->failuresBlocked(6, '10.0.0.1'), 'another link is not blocked');
        $this->assertNull($this->s->failuresBlocked(5, '10.0.0.2'), 'another network is not blocked');
        $key = $this->s->failureKey(5, '10.0.0.1', $win);
        $this->assertMatchesRegularExpression('/^pwf:5:[0-9a-f]{16}:' . $win . '\z/', $key);
        $this->assertSame(substr(hash('sha256', '10.0.0.1/32'), 0, 16), explode(':', $key)[2]);
        $this->assertSame(LinkSecrets::PW_KEY_TTL, $this->h->mem->ttl($key));
        // Two addresses of one /56 share the budget.
        for ($i = 0; $i < 20; $i++) {
            $this->s->registerFailure(9, '2001:db8:1:' . dechex($i) . '::1');
        }
        $this->assertNotNull($this->s->failuresBlocked(9, '2001:db8:1:ff::7'));
        // The next window starts fresh.
        $this->h->time += 600;
        $this->assertNull($this->s->failuresBlocked(5, '10.0.0.1'));
        $this->assertSame([], $this->h->throttleCalls, 'with Redis the IThrottler is never asked');
    }

    public function testWithoutRedisTheThrottlerStandsIn(): void {
        $h = $this->harnessWithoutRedis();
        $this->assertNull($h->secrets->failuresBlocked(1, '10.0.0.1'));
        $h->secrets->registerFailure(1, '10.0.0.1');
        $this->assertSame(['check pw', 'register pw'], $h->throttleCalls);
    }

    private function harnessWithoutRedis(): AccessHarness {
        $h = new AccessHarness();
        $h->mem->available = false;
        // FastCache decides availability once, in its constructor: rebuild the secrets on a new cache.
        $cache = new \OCA\Knorke\Service\FastCache($h->mem->factory(), $h->epoch->epoch());
        $this->assertFalse($cache->available());
        $r = new \ReflectionProperty(LinkSecrets::class, 'cache');
        $r->setValue($h->secrets, $cache);
        return $h;
    }

    // ── Passwords ──────────────────────────────────────────────────────────

    public function testHashCheckedRunsThePolicyFirst(): void {
        $this->assertSame('h:secret1', $this->s->hashChecked('secret1'));
        $this->assertSame(['secret1'], $this->h->policyEvents);
        $this->h->passwordHint = 'Password needs at least 10 characters.';
        $e = $this->expectHttp(400, 'password_policy', fn () => $this->s->hashChecked('short'));
        $this->assertSame('Password needs at least 10 characters.', $e->getMessage(), 'the hint of the HintException');
    }

    public function testVerifyAndRehashOnlyOverTheVerifiedHash(): void {
        $b = $this->h->boards->addBoard('alice');
        $id = $this->h->boards->insertLink($b, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1, 'h:pw1', null);
        $link = $this->h->boards->links[$id];
        $this->assertTrue($this->s->verify($link, 'pw1'));
        $this->assertFalse($this->s->verify($link, 'pw2'));
        $this->assertTrue($this->s->verify(['id' => $id, 'password_hash' => null], 'anything'), 'no password: nothing to check');
        $this->h->rehash = 'h2:pw1';
        $this->h->boards->links[$id]['password_hash'] = 'old:pw1';
        $this->assertTrue($this->s->verify($this->h->boards->links[$id], 'pw1'));
        $this->assertSame('h2:pw1', $this->h->boards->links[$id]['password_hash'], 'rehashed');
        // The owner changed the password between read and rehash: never overwritten.
        $stale = ['id' => $id, 'password_hash' => 'old:pw1'];
        $this->h->boards->links[$id]['password_hash'] = 'h:new';
        $this->assertTrue($this->s->verify($stale, 'pw1'));
        $this->assertSame('h:new', $this->h->boards->links[$id]['password_hash']);
    }

    /** R14-01 (§4.11.4, §9.7): verify reports the hash stored after the call. */
    public function testVerifyReportsTheStoredHashR1401(): void {
        $b = $this->h->boards->addBoard('alice');
        $id = $this->h->boards->insertLink($b, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1, 'h:pw1', null);
        $stored = 'x';
        $this->assertTrue($this->s->verify($this->h->boards->links[$id], 'pw1', $stored));
        $this->assertSame('h:pw1', $stored, 'no rehash: the verified hash');
        $this->assertFalse($this->s->verify($this->h->boards->links[$id], 'pw2', $stored));
        $this->assertNull($stored, 'wrong password: nothing');
        $stored = 'x';
        $this->assertTrue($this->s->verify(['id' => $id, 'password_hash' => null], 'any', $stored));
        $this->assertNull($stored, 'no password: nothing');
        $this->h->rehash = 'h2:pw1';
        $this->h->boards->links[$id]['password_hash'] = 'old:pw1';
        $this->assertTrue($this->s->verify($this->h->boards->links[$id], 'pw1', $stored));
        $this->assertSame(['h2:pw1', 'h2:pw1'], [$stored, $this->h->boards->links[$id]['password_hash']], 'replaced: the new hash');
        // The replacement lost against an owner's change: the verified hash (≠ the fresh row).
        $this->h->boards->links[$id]['password_hash'] = 'h:new';
        $this->assertTrue($this->s->verify(['id' => $id, 'password_hash' => 'old:pw1'], 'pw1', $stored));
        $this->assertSame(['old:pw1', 'h:new'], [$stored, $this->h->boards->links[$id]['password_hash']]);
    }

    // ── Expiry as the owner's calendar day (R13) ───────────────────────────

    public function testOwnerZone(): void {
        $this->assertSame('UTC', $this->s->ownerZone('alice')->getName(), 'no stored zone: the instance default');
        $this->h->zones['bob'] = 'Europe/Berlin';
        $this->assertSame('Europe/Berlin', $this->s->ownerZone('bob')->getName());
        $this->h->zones['carol'] = 'Not/AZone';
        $this->h->defaultZone = 'America/New_York';
        $this->assertSame('America/New_York', $this->s->ownerZone('carol')->getName(), 'an invalid stored zone: the default');
    }

    public function testEndOfDayInTheOwnersZone(): void {
        $this->h->zones['bob'] = 'Europe/Berlin';
        $this->h->zones['kiri'] = 'Pacific/Kiritimati';
        $this->assertSame((new \DateTimeImmutable('2026-10-21 00:00:00', new \DateTimeZone('UTC')))->getTimestamp() * 1000 - 1,
            $this->s->endOfDay('alice', '2026-10-20'));
        $berlin = $this->s->endOfDay('bob', '2026-10-20');
        $this->assertSame((new \DateTimeImmutable('2026-10-21 00:00:00', new \DateTimeZone('Europe/Berlin')))->getTimestamp() * 1000 - 1, $berlin);
        $this->assertSame('2026-10-20', $this->s->dayOf('bob', $berlin));
        $this->assertSame('2026-10-20', $this->s->dayOf('kiri', $this->s->endOfDay('kiri', '2026-10-20')));
        // DST end in Berlin (25 h day): still 23:59:59.999 local.
        $dst = $this->s->endOfDay('bob', '2026-10-25');
        $this->assertSame('2026-10-25 23:59:59', (new \DateTimeImmutable('@' . intdiv($dst, 1000)))->setTimezone(new \DateTimeZone('Europe/Berlin'))->format('Y-m-d H:i:s'));
        $this->assertSame(999, $dst % 1000);
        foreach (['2026-02-30', '2026-1-01', '26-01-01', '2026-01-01T00:00', '1969-12-31', ''] as $bad) {
            $this->assertFalse(LinkSecrets::validDay($bad), $bad);
        }
        $this->assertFalse(LinkSecrets::validDay(1760000000000));
        $this->assertTrue(LinkSecrets::validDay('2028-02-29'));
    }

    public function testNormalizeExpiryAndEnforcement(): void {
        $now = $this->h->nowMs(); // 2025-10-09 08:53:20 UTC
        $today = $this->s->today('alice', $now);
        $this->assertSame('2025-10-09', $today);
        $this->assertSame([null, null], $this->s->normalizeExpiry('alice', null, false, self::policy(), $now));
        $this->assertSame([null, null], $this->s->normalizeExpiry('alice', null, true, self::policy(), $now), 'no default expiry configured');
        [$ms, $day] = $this->s->normalizeExpiry('alice', null, true, self::policy(['expireDefaultDays' => 7]), $now);
        $this->assertSame(['2025-10-16', $this->s->endOfDay('alice', '2025-10-16')], [$day, $ms], 'creating: today + days');
        $this->assertSame('2025-10-09', $this->s->normalizeExpiry('alice', '2025-10-09', false, self::policy(), $now)[1], 'today is allowed');
        $this->expectHttp(400, 'expiry_past', fn () => $this->s->normalizeExpiry('alice', '2025-10-08', false, self::policy(), $now));
        $policy = self::policy(['expireDefaultDays' => 7, 'expireEnforced' => true, 'expireMaxDays' => 7]);
        $this->assertSame('2025-10-16', $this->s->normalizeExpiry('alice', '2025-10-16', false, $policy, $now)[1]);
        $e = $this->expectHttp(400, 'expiry_too_far', fn () => $this->s->normalizeExpiry('alice', '2025-10-17', false, $policy, $now));
        $this->assertSame(7, $e->payload()['maxDays']);
        $this->expectHttp(400, 'bad_request', fn () => $this->s->normalizeExpiry('alice', '2025/10/17', false, self::policy(), $now));
        // "Today" is the owner's: at 23:30 UTC it is already tomorrow in Berlin.
        $this->h->zones['bob'] = 'Europe/Berlin';
        $late = (new \DateTimeImmutable('2025-10-09 23:30:00', new \DateTimeZone('UTC')))->getTimestamp() * 1000;
        $this->expectHttp(400, 'expiry_past', fn () => $this->s->normalizeExpiry('bob', '2025-10-09', false, self::policy(), $late));
        $this->assertSame('2025-10-09', $this->s->normalizeExpiry('alice', '2025-10-09', false, self::policy(), $late)[1]);

        // enforce() on a result.
        $this->s->enforce('alice', false, null, self::policy(), $now);
        $this->expectHttp(400, 'password_enforced', fn () => $this->s->enforce('alice', false, null, self::policy(['passwordEnforced' => true]), $now));
        $this->s->enforce('alice', true, null, self::policy(['passwordEnforced' => true]), $now);
        $this->expectHttp(400, 'expiry_required', fn () => $this->s->enforce('alice', true, null, $policy, $now));
        $this->expectHttp(400, 'expiry_too_far', fn () => $this->s->enforce('alice', true, $this->s->endOfDay('alice', '2025-10-30'), $policy, $now));
        $this->expectHttp(400, 'expiry_past', fn () => $this->s->enforce('alice', true, $this->s->endOfDay('alice', '2025-10-01'), self::policy(), $now));
        $this->expectHttp(400, 'password_enforced', fn () => $this->s->enforce('alice', false, null, ['passwordEnforced' => true] + $policy, $now), 'password first');
    }
}
