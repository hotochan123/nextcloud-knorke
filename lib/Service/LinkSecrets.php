<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Config\IUserConfig;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\HintException;
use OCP\IConfig;
use OCP\IDateTimeZone;
use OCP\Security\Bruteforce\IThrottler;
use OCP\Security\Bruteforce\MaxDelayReached;
use OCP\Security\Events\ValidatePasswordPolicyEvent;
use OCP\Security\IHasher;
use OCP\Security\PasswordContext;
use Psr\Container\ContainerInterface;

/**
 * Link passwords and expiry (SPEC-M1 §4.11, §7.5).
 *
 * Passwords: checked against Nextcloud's password policy
 * (ValidatePasswordPolicyEvent, context SHARING; HintException → 400
 * password_policy with its hint) and hashed with IHasher — both OUTSIDE the
 * board lock (argon2 ≥ 100 ms, maybe an outgoing HIBP call). Only the hash
 * is stored; the password is never logged (#[\SensitiveParameter]).
 *
 * Expiry: a calendar day "YYYY-MM-DD" in the OWNER's time zone (R13
 * ownerZone: the owner's stored zone, else the instance default — never the
 * session user's zone, which would be wrong for moderators), stored as the
 * end of that day (23:59:59.999) in ms.
 *
 * Failed passwords: a fixed-window counter per link and NETWORK (IPv4 /32,
 * IPv4-mapped IPv6 → the IPv4 /32, IPv6 /56 or the instance's
 * security.ipv6_normalized_subnet_size clamped to 32–64), FastCache key
 * pwf:<linkId>:<nh>:<floor(now/600000)> with nh = 16 hex of sha256(net);
 * ≥ PW_FAIL_LIMIT failures → blocked until the window ends. Only failures
 * count. Without Redis Nextcloud's IThrottler (action knorke_link_pw)
 * stands in.
 */
class LinkSecrets {
    public const PW_FAIL_LIMIT = 20;
    public const PW_WINDOW_MS = 600000;
    /** TTL of a failure window key: the window plus a minute. */
    public const PW_KEY_TTL = 660;
    public const THROTTLE_ACTION = 'knorke_link_pw';
    /** Longest link password (characters, SPEC-M1 §4.11.2). */
    public const PASSWORD_MAX = 200;
    private const DAY_RE = '/^(\d{4})-(\d{2})-(\d{2})\z/';

    private ?IUserConfig $userConfig = null;
    /** @var array<string, \DateTimeZone> owner uid → zone, this request */
    private array $zones = [];

    public function __construct(
        private IEventDispatcher $events,
        private IHasher $hasher,
        private FastCache $cache,
        private IThrottler $throttler,
        private IConfig $config,
        private IDateTimeZone $dateTimeZone,
        private ContainerInterface $container,
        private BoardStore $boards,
        private ITimeFactory $time,
    ) {
    }

    // ── Passwords ───────────────────────────────────────────────────────────

    /**
     * Password policy, then the hash (SPEC-M1 §4.11.2 step 4). Call OUTSIDE
     * the board lock.
     *
     * @throws HttpError 400 password_policy
     */
    public function hashChecked(#[\SensitiveParameter] string $password): string {
        try {
            $this->events->dispatchTyped(new ValidatePasswordPolicyEvent($password, PasswordContext::SHARING));
        } catch (HintException $e) {
            $hint = $e->getHint();
            throw new HttpError(400, 'password_policy', $hint !== '' ? $hint : $e->getMessage());
        }
        return $this->hasher->hash($password);
    }

    /**
     * Checks $password against the link's hash; on success a rehash
     * (IHasher's $newHash) replaces the stored hash — only while the stored
     * hash is still the one just verified, so a password the owner changed
     * meanwhile is never overwritten.
     *
     * $stored (R14-01, SPEC-M1 §4.11.4): the hash stored after this call —
     * the new one when replaceLinkHash replaced it, else the verified one
     * (also when the replacement lost against an owner's change: a caller
     * comparing it with a fresh row then sees the change). null without a
     * password or after a wrong one.
     *
     * @param array{id: int, password_hash: ?string} $link
     * @param-out ?string $stored
     */
    public function verify(array $link, #[\SensitiveParameter] string $password, #[\SensitiveParameter] ?string &$stored = null): bool {
        $stored = null;
        $hash = $link['password_hash'] ?? null;
        if ($hash === null || $hash === '') {
            return true;
        }
        $newHash = null;
        if (!$this->hasher->verify($password, $hash, $newHash)) {
            return false;
        }
        $stored = $hash;
        if (is_string($newHash) && $newHash !== '' && $newHash !== $hash
            && $this->boards->replaceLinkHash((int)$link['id'], $hash, $newHash)) {
            $stored = $newHash;
        }
        return true;
    }

    // ── Failed attempts per link and network ────────────────────────────────

    /**
     * The normalised network of an address (SPEC-M1 §4.11.4, R2): IPv4 →
     * "a.b.c.d/32"; IPv4-mapped IPv6 (::ffff:a.b.c.d) → the IPv4 /32; IPv6
     * → its /N prefix with N = security.ipv6_normalized_subnet_size
     * (default 56) clamped to 32–64. Anything else comes back unchanged.
     */
    public function netOf(string $ip): string {
        $ip = trim($ip);
        if (str_starts_with($ip, '[') && str_ends_with($ip, ']')) {
            $ip = substr($ip, 1, -1);
        }
        $pos = strpos($ip, '%');
        if ($pos !== false) {
            $ip = substr($ip, 0, $pos);
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return $ip . '/32';
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            return $ip;
        }
        $bin = inet_pton($ip);
        if ($bin === false || strlen($bin) !== 16) {
            return $ip;
        }
        if (substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
            return inet_ntop(substr($bin, 12)) . '/32';
        }
        $bits = min(64, max(32, $this->config->getSystemValueInt('security.ipv6_normalized_subnet_size', 56)));
        $mask = str_repeat("\xff", intdiv($bits, 8));
        if ($bits % 8 !== 0) {
            $mask .= chr((0xff << (8 - $bits % 8)) & 0xff);
        }
        $mask = str_pad($mask, 16, "\0");
        return inet_ntop($bin & $mask) . '/' . $bits;
    }

    /**
     * Blocked? retryMs until the window ends (≥ 1), or null (SPEC-M1 §4.11.4
     * step 4). Reads only, counts nothing.
     */
    public function failuresBlocked(int $linkId, string $ip): ?int {
        $now = $this->nowMs();
        $win = intdiv($now, self::PW_WINDOW_MS);
        $n = $this->cache->windowInc($this->failureKey($linkId, $ip, $win), self::PW_KEY_TTL, 0);
        if ($n === null) {
            try {
                $this->throttler->sleepDelayOrThrowOnMax($ip, self::THROTTLE_ACTION);
            } catch (MaxDelayReached) {
                return self::PW_WINDOW_MS;
            }
            return null;
        }
        return $n >= self::PW_FAIL_LIMIT ? max(1, ($win + 1) * self::PW_WINDOW_MS - $now) : null;
    }

    /** One failed password for the link from this address's network. */
    public function registerFailure(int $linkId, string $ip): void {
        $win = intdiv($this->nowMs(), self::PW_WINDOW_MS);
        if ($this->cache->windowInc($this->failureKey($linkId, $ip, $win), self::PW_KEY_TTL, 1) === null) {
            $this->throttler->registerAttempt(self::THROTTLE_ACTION, $ip);
        }
    }

    /** pwf:<linkId>:<nh>:<win>, nh = 16 hex of sha256 of the normalised network. */
    public function failureKey(int $linkId, string $ip, int $win): string {
        return 'pwf:' . $linkId . ':' . substr(hash('sha256', $this->netOf($ip)), 0, 16) . ':' . $win;
    }

    // ── Expiry as a calendar day of the owner ───────────────────────────────

    /**
     * The owner's time zone (SPEC-M1 §4.11.2, R13): the zone stored for the
     * owner (core/timezone) if it is a valid zone, else the instance default
     * (IDateTimeZone::getDefaultTimeZone). Never IDateTimeZone::getTimeZone():
     * it falls back to the session user's zone or browser offset.
     */
    public function ownerZone(string $ownerUid): \DateTimeZone {
        if (isset($this->zones[$ownerUid])) {
            return $this->zones[$ownerUid];
        }
        $name = '';
        try {
            $name = $this->userConfig()->getValueString($ownerUid, 'core', 'timezone', '');
        } catch (\Throwable) {
            $name = '';
        }
        $zone = null;
        if ($name !== '') {
            try {
                $zone = new \DateTimeZone($name);
            } catch (\Throwable) {
                $zone = null;
            }
        }
        return $this->zones[$ownerUid] = $zone ?? $this->dateTimeZone->getDefaultTimeZone();
    }

    /** True when $day is a real calendar day "YYYY-MM-DD" (years 1970–9999). */
    public static function validDay(mixed $day): bool {
        return is_string($day) && preg_match(self::DAY_RE, $day, $m) === 1
            && (int)$m[1] >= 1970 && checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
    }

    /** End of $day (23:59:59.999) in the owner's zone, in ms. */
    public function endOfDay(string $ownerUid, string $day): int {
        $start = \DateTimeImmutable::createFromFormat('!Y-m-d', $day, $this->ownerZone($ownerUid));
        if ($start === false || !self::validDay($day)) {
            throw new HttpError(400, 'bad_request', 'expiresAt must be a calendar day YYYY-MM-DD.');
        }
        return $start->modify('+1 day')->getTimestamp() * 1000 - 1;
    }

    /** The calendar day of $ms in the owner's zone ("YYYY-MM-DD"). */
    public function dayOf(string $ownerUid, int $ms): string {
        return (new \DateTimeImmutable('@' . (int)floor($ms / 1000)))->setTimezone($this->ownerZone($ownerUid))->format('Y-m-d');
    }

    /** "Today" + $days in the owner's zone. */
    public function today(string $ownerUid, int $nowMs, int $days = 0): string {
        $d = (new \DateTimeImmutable('@' . (int)floor($nowMs / 1000)))->setTimezone($this->ownerZone($ownerUid));
        if ($days !== 0) {
            $d = $d->modify(($days > 0 ? '+' : '') . $days . ' days');
        }
        return $d->format('Y-m-d');
    }

    /**
     * A sent expiry day → [expires_at ms, day] (SPEC-M1 §9.7). $day null:
     * no expiry — unless $creating and Nextcloud has a default expiry, then
     * today + shareApiLinkDefaultExpireDays() (R13). A day before today →
     * expiry_past; enforced and after today + max → expiry_too_far (maxDays).
     *
     * @param array{passwordEnforced: bool, expireDefaultDays: ?int, expireEnforced: bool, expireMaxDays: ?int} $policy
     * @return array{0: ?int, 1: ?string}
     * @throws HttpError 400 bad_request|expiry_past|expiry_too_far
     */
    public function normalizeExpiry(string $ownerUid, ?string $day, bool $creating, array $policy, int $nowMs): array {
        if ($day === null) {
            if (!$creating || $policy['expireDefaultDays'] === null) {
                return [null, null];
            }
            $day = $this->today($ownerUid, $nowMs, $policy['expireDefaultDays']);
        }
        if (!self::validDay($day)) {
            throw new HttpError(400, 'bad_request', 'expiresAt must be a calendar day YYYY-MM-DD.');
        }
        $this->checkDay($ownerUid, $day, $policy, $nowMs);
        return [$this->endOfDay($ownerUid, $day), $day];
    }

    /**
     * The enforcement rules on the RESULT of a link change (SPEC-M1 §4.11.2):
     * password enforced and none → password_enforced; expiry enforced and
     * none → expiry_required; a day before today → expiry_past; enforced and
     * after today + max → expiry_too_far (maxDays).
     *
     * @param array{passwordEnforced: bool, expireDefaultDays: ?int, expireEnforced: bool, expireMaxDays: ?int} $policy
     * @throws HttpError 400
     */
    public function enforce(string $ownerUid, bool $hasPassword, ?int $expiresAt, array $policy, int $nowMs): void {
        if ($policy['passwordEnforced'] && !$hasPassword) {
            throw new HttpError(400, 'password_enforced');
        }
        if ($expiresAt === null) {
            if ($policy['expireEnforced']) {
                throw new HttpError(400, 'expiry_required');
            }
            return;
        }
        $this->checkDay($ownerUid, $this->dayOf($ownerUid, $expiresAt), $policy, $nowMs);
    }

    /** @throws HttpError 400 expiry_past|expiry_too_far */
    private function checkDay(string $ownerUid, string $day, array $policy, int $nowMs): void {
        if (strcmp($day, $this->today($ownerUid, $nowMs)) < 0) {
            throw new HttpError(400, 'expiry_past');
        }
        if ($policy['expireEnforced'] && $policy['expireMaxDays'] !== null
            && strcmp($day, $this->today($ownerUid, $nowMs, $policy['expireMaxDays'])) > 0) {
            throw new HttpError(400, 'expiry_too_far', '', ['maxDays' => $policy['expireMaxDays']]);
        }
    }

    private function userConfig(): IUserConfig {
        return $this->userConfig ??= $this->container->get(IUserConfig::class);
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
