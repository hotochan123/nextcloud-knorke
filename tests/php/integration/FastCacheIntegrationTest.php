<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Tests\Support\IntegrationCase;

/**
 * a:<board> on the dev stack's real Redis: Nextcloud's Lua cas compares the
 * stored string with the json_encode of the list FastCache read, and drops
 * the TTL, which setGens and raiseMinRev renew. The board id is one no board
 * has; tearDown removes its keys.
 */
final class FastCacheIntegrationTest extends IntegrationCase {
    public function testGensAreACasMaximumOnRedis(): void {
        $b = 2_000_000_000 + random_int(0, 99_999_999);
        $this->created[] = $b;
        $key = 'a:' . $b;
        // Committed A (acl 5, link 4) before B (acl 6, link 3); B writes first.
        $this->cache->setGens($b, 6, 3, 0, true, 2);
        $this->cache->setGens($b, 5, 4, 1, true, 1);
        $this->assertSame(['acl' => 6, 'link' => 4, 'minRev' => 1, 'links' => true, 'voteLink' => 2, 'gone' => false], $this->cache->getGens($b));
        $ttl = $this->redis->getTTL($key);
        $this->assertTrue(is_int($ttl) && $ttl > 0 && $ttl <= 120, 'TTL renewed after the cas: ' . var_export($ttl, true));

        $this->cache->raiseMinRev($b, 9);
        $this->assertSame([6, 4, 9, 1, 2], $this->redis->get($key), 'the cleanup raises only minRev');
        $this->assertNotFalse($this->redis->getTTL($key));
        $this->cache->raiseMinRev($b, 3);
        $this->assertSame([6, 4, 9, 1, 2], $this->redis->get($key));

        // Another shape is replaced.
        $this->redis->set($key, [1, 2, 0, 1], 30);
        $this->cache->setGens($b, 2, 3, 0, false, 4);
        $this->assertSame([2, 3, 0, 0, 4], $this->redis->get($key));
        $this->assertNotFalse($this->redis->getTTL($key));

        // The deleted mark stays.
        $this->cache->markGone($b);
        $this->cache->setGens($b, 7, 7, 7, true, 7);
        $this->cache->raiseMinRev($b, 50);
        $this->assertTrue($this->cache->getGens($b)['gone']);
    }
}
