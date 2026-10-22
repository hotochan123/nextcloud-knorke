<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCP\ICacheFactory;
use OCP\IMemcacheTTL;

/**
 * In-memory stand-in for Nextcloud's Redis memcache (OC\Memcache\Redis):
 *
 *  - values are stored ENCODED like Redis does it (int → "42", everything
 *    else json_encode) and decoded like decodeValue() (is_numeric → (int),
 *    else json_decode) — so the float trap is real here too: a stored float
 *    comes back truncated, and $floats counts every float that went in
 *  - set/add with ttl 0 get the default TTL of a day; cas() drops the TTL
 *    (plain SET in Nextcloud's Lua script), exactly like the original
 *  - a manual clock ($now, seconds) drives expiry
 *
 * memcache() returns the object FastCache/PresenceStore see (IMemcacheTTL),
 * factory() the ICacheFactory that hands it out — for EVERY prefix the same
 * store (keys here carry no prefix); $prefixes records the prefix of every
 * createDistributed() call (SPEC-M1 §5.1: 'knorke/<epoch>/').
 */
final class MemoryCache {
    /** @var array<string, string> */
    public array $data = [];
    /** @var array<string, int> absolute expiry (seconds) */
    public array $expires = [];
    public int $now = 1_000_000;
    public int $floats = 0;
    /** @var list<string> call log "op key" */
    public array $log = [];
    /** Force cas() to fail this many times (collision simulation). */
    public int $casFailures = 0;
    public bool $available = true;
    /** @var list<string> prefix of every createDistributed() call */
    public array $prefixes = [];

    public function memcache(): IMemcacheTTL {
        return Fake::of(IMemcacheTTL::class, [
            'get' => fn ($k) => $this->get((string)$k),
            'set' => fn ($k, $v, $ttl = 0) => $this->set((string)$k, $v, (int)$ttl),
            'add' => fn ($k, $v, $ttl = 0) => $this->add((string)$k, $v, (int)$ttl),
            'hasKey' => fn ($k) => $this->get((string)$k) !== null,
            'remove' => fn ($k) => $this->remove((string)$k),
            'cas' => fn ($k, $old, $new) => $this->cas((string)$k, $old, $new),
            'inc' => fn ($k, $step = 1) => $this->inc((string)$k, (int)$step),
            'setTTL' => fn ($k, $ttl) => $this->setTTL((string)$k, (int)$ttl),
            'getTTL' => fn ($k) => $this->ttl((string)$k) ?? false,
            'clear' => function ($prefix = ''): bool {
                $this->data = [];
                $this->expires = [];
                return true;
            },
        ]);
    }

    public function factory(): ICacheFactory {
        $mc = $this->memcache();
        return Fake::of(ICacheFactory::class, [
            'createDistributed' => function ($prefix = '') use ($mc) {
                $this->prefixes[] = (string)$prefix;
                return $mc;
            },
            'isAvailable' => fn () => $this->available,
        ]);
    }

    public function get(string $k): mixed {
        $this->log[] = 'get ' . $k;
        $this->expire($k);
        if (!array_key_exists($k, $this->data)) {
            return null;
        }
        return self::decode($this->data[$k]);
    }

    public function set(string $k, mixed $v, int $ttl): bool {
        $this->log[] = 'set ' . $k;
        $this->data[$k] = $this->encode($v);
        $this->expires[$k] = $this->now + ($ttl === 0 ? 86400 : $ttl);
        return true;
    }

    public function add(string $k, mixed $v, int $ttl): bool {
        $this->log[] = 'add ' . $k;
        $this->expire($k);
        if (array_key_exists($k, $this->data)) {
            return false;
        }
        return $this->set($k, $v, $ttl);
    }

    /** Redis INCRBY on an integer value (keeps the TTL); a missing key starts at 0 without TTL. */
    public function inc(string $k, int $step): int|false {
        $this->log[] = 'inc ' . $k;
        $this->expire($k);
        $cur = array_key_exists($k, $this->data) ? self::decode($this->data[$k]) : 0;
        if (!is_int($cur)) {
            return false;
        }
        $this->data[$k] = $this->encode($cur + $step);
        return $cur + $step;
    }

    public function remove(string $k): bool {
        $this->log[] = 'remove ' . $k;
        unset($this->data[$k], $this->expires[$k]);
        return true;
    }

    public function cas(string $k, mixed $old, mixed $new): bool {
        $this->log[] = 'cas ' . $k;
        $this->expire($k);
        if ($this->casFailures > 0) {
            $this->casFailures--;
            return false;
        }
        if (!array_key_exists($k, $this->data) || $this->data[$k] !== $this->encode($old)) {
            return false;
        }
        $this->data[$k] = $this->encode($new);
        unset($this->expires[$k]); // Nextcloud's Lua cas is a plain SET: the TTL is gone
        return true;
    }

    public function setTTL(string $k, int $ttl): void {
        $this->log[] = 'setTTL ' . $k;
        if (array_key_exists($k, $this->data)) {
            $this->expires[$k] = $this->now + $ttl;
        }
    }

    /** Remaining TTL in seconds; null = no key; -1 = key without TTL. */
    public function ttl(string $k): ?int {
        $this->expire($k);
        if (!array_key_exists($k, $this->data)) {
            return null;
        }
        return isset($this->expires[$k]) ? $this->expires[$k] - $this->now : -1;
    }

    /** Raw stored string (as Redis holds it). */
    public function raw(string $k): ?string {
        return $this->data[$k] ?? null;
    }

    private function expire(string $k): void {
        if (isset($this->expires[$k]) && $this->expires[$k] <= $this->now) {
            unset($this->data[$k], $this->expires[$k]);
        }
    }

    private function encode(mixed $v): string {
        $this->countFloats($v);
        return is_int($v) ? (string)$v : json_encode($v);
    }

    private function countFloats(mixed $v): void {
        if (is_float($v)) {
            $this->floats++;
        } elseif (is_array($v)) {
            array_walk_recursive($v, function ($e): void {
                if (is_float($e)) {
                    $this->floats++;
                }
            });
        }
    }

    private static function decode(string $v): mixed {
        return is_numeric($v) ? (int)$v : json_decode($v, true);
    }
}
