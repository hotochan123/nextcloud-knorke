<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;

/**
 * Signed, stateless guest token (SPEC-M0 §4.9.3). Verifying it is CPU only.
 *
 *   claims = {"v":1,"b":7,"g":"gA1b2C3d4E5","r":"edit","lg":3,"exp":1762700000,"n":"Gina"}
 *   token  = b64url(json(claims)) . '.' . b64url(hmac_sha256(b64url(json(claims)), key))
 *   key    = sha256('knorke-guest|' . system secret)
 *
 * The claims are JSON-encoded without \u escapes: a name of 40 × "😀" would
 * otherwise produce a token over the 1024-byte limit that is issued but never
 * accepted. verify() knows nothing about boards; the board binding (b) and
 * the link generation (lg) are checked by Access::forGuest().
 */
final class GuestToken {
    public const VERSION = 1;
    public const GID_RE = '/^g[A-Za-z0-9]{11}\z/';

    public function __construct(
        private IConfig $config,
        private ITimeFactory $time,
    ) {
    }

    public function issue(array $claims): string {
        $payload = self::b64(json_encode($claims, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        return $payload . '.' . self::b64(hash_hmac('sha256', $payload, $this->key(), true));
    }

    /**
     * @return array{v: int, b: int, g: string, r: string, lg: int, exp: int, n: string}|null
     */
    public function verify(#[\SensitiveParameter] string $t, bool $allowExpired = false): ?array {
        if ($t === '' || strlen($t) > Limits::GUEST_TOKEN_MAX) {
            return null;
        }
        $parts = explode('.', $t);
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return null;
        }
        $sig = self::b64(hash_hmac('sha256', $parts[0], $this->key(), true));
        if (!hash_equals($sig, $parts[1])) {
            return null;
        }
        $json = base64_decode(strtr($parts[0], '-_', '+/'), true);
        if ($json === false) {
            return null;
        }
        try {
            $c = json_decode($json, true, 4, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        if (!is_array($c)
            || ($c['v'] ?? null) !== self::VERSION
            || !is_int($c['b'] ?? null) || $c['b'] < 1
            || !is_string($c['g'] ?? null) || preg_match(self::GID_RE, $c['g']) !== 1
            || !is_string($c['r'] ?? null)
            || !is_int($c['lg'] ?? null)
            || !is_int($c['exp'] ?? null)
            || !is_string($c['n'] ?? null)) {
            return null;
        }
        if (!$allowExpired && $c['exp'] < $this->time->getTime()) {
            return null;
        }
        return ['v' => $c['v'], 'b' => $c['b'], 'g' => $c['g'], 'r' => $c['r'], 'lg' => $c['lg'], 'exp' => $c['exp'], 'n' => $c['n']];
    }

    private function key(): string {
        return hash('sha256', 'knorke-guest|' . $this->config->getSystemValueString('secret'), true);
    }

    private static function b64(string $s): string {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }
}
