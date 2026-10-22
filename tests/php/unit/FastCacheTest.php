<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Tests\Support\EpochStub;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\MemoryCache;
use OCP\ICache;
use OCP\ICacheFactory;
use PHPUnit\Framework\TestCase;

/**
 * Redis keys r:/a:/g: (SPEC-M0 §5.1, §5.3; SPEC-M1 §5.1: epoch prefix,
 * 5-element gens, 3-part grants with origin) against an in-memory
 * IMemcacheTTL where cas drops the TTL.
 */
final class FastCacheTest extends TestCase {
    private MemoryCache $mem;
    private FastCache $cache;

    protected function setUp(): void {
        $this->mem = new MemoryCache();
        $this->cache = new FastCache($this->mem->factory(), (new EpochStub())->epoch());
    }

    public function testAvailability(): void {
        $this->assertTrue($this->cache->available());
        $this->mem->available = false;
        $this->assertFalse((new FastCache($this->mem->factory(), (new EpochStub())->epoch()))->available());
        // A distributed cache without TTL support (no Redis) switches the fast path off.
        $plain = Fake::of(ICache::class);
        $factory = Fake::of(ICacheFactory::class, ['createDistributed' => fn ($p = '') => $plain, 'isAvailable' => fn () => true]);
        $off = new FastCache($factory, (new EpochStub())->epoch());
        $this->assertFalse($off->available());
        $this->assertNull($off->getRev(1));
        $off->bumpRev(1, 5);
        $off->setGens(1, 1, 1, 0, true, 1);
        $off->setGrant(1, 'u', 1, 'owner', 'o');
        $this->assertNull($off->getGens(1));
        $this->assertNull($off->getGrant(1, 'u'));
    }

    public function testPrefixCarriesTheEpoch(): void {
        // SPEC-M1 §5.1: createDistributed('knorke/' . $epoch . '/') — keys
        // <global prefix>/knorke/<epoch>/<key>; a missing epoch gives knorke/0/.
        $mem = new MemoryCache();
        new FastCache($mem->factory(), (new EpochStub('k3x9a0b2'))->epoch());
        $this->assertSame(['knorke/k3x9a0b2/'], $mem->prefixes);
        $missing = new EpochStub('');
        new FastCache($mem->factory(), $missing->epoch());
        $this->assertSame('knorke/0/', $mem->prefixes[1], 'no stored epoch → current() = "0"');
    }

    public function testRotatingTheEpochHidesEveryKey(): void {
        // occ knorke:epoch:rotate (SPEC-M1 §5.4): no scan, no delete — the next
        // request builds its caches under the new prefix and misses everything.
        $stores = [];
        $factory = Fake::of(ICacheFactory::class, [
            'createDistributed' => function ($prefix = '') use (&$stores) {
                return ($stores[$prefix] ??= new MemoryCache())->memcache();
            },
            'isAvailable' => fn () => true,
        ]);
        $epoch = new EpochStub('aaaaaaaa');
        $before = new FastCache($factory, $epoch->epoch());
        $before->seedRev(7, 10);
        $before->seedGens(7, 2, 3, 0, true, 4);
        $before->setGrant(7, 'alice', 2, 'owner', 'o');
        $this->assertSame(10, $before->getRev(7));
        $epoch->next = ['bbbbbbbb'];
        $this->assertSame('bbbbbbbb', $epoch->epoch()->rotate());
        $after = new FastCache($factory, $epoch->epoch());
        $this->assertNull($after->getRev(7));
        $this->assertNull($after->getGens(7));
        $this->assertNull($after->getGrant(7, 'alice'));
        $this->assertSame(['knorke/aaaaaaaa/', 'knorke/bbbbbbbb/'], array_keys($stores));
        $this->assertSame(10, $before->getRev(7), 'the old keys still exist (they expire by TTL), only unseen');
    }

    public function testRevIsMonotonicAndRenewsTtlAfterCas(): void {
        $this->cache->seedRev(7, 10);
        $this->assertSame(10, $this->cache->getRev(7));
        $this->assertSame(30, $this->mem->ttl('r:7'));
        $this->cache->seedRev(7, 3);
        $this->assertSame(10, $this->cache->getRev(7), 'seed never overwrites');

        $this->mem->now += 20;
        $this->cache->bumpRev(7, 12);
        $this->assertSame(12, $this->cache->getRev(7));
        $this->assertSame(30, $this->mem->ttl('r:7'), 'cas dropped the TTL, bumpRev set it again');

        $this->cache->bumpRev(7, 11);
        $this->assertSame(12, $this->cache->getRev(7), 'never lowered');
        $this->assertSame(['get r:7'], array_slice($this->mem->log, -1), 'a lower bump only reads');
    }

    public function testBumpOnMissingKeyAdds(): void {
        $this->cache->bumpRev(3, 4);
        $this->assertSame(4, $this->cache->getRev(3));
        $this->assertSame(30, $this->mem->ttl('r:3'));
    }

    public function testBumpGivesUpWithRemove(): void {
        $this->cache->seedRev(7, 10);
        $this->mem->casFailures = 6;
        $this->cache->bumpRev(7, 11);
        $this->assertNull($this->cache->getRev(7), 'unsettled → removed: the next sync asks the DB');
        $this->assertContains('remove r:7', $this->mem->log);
    }

    public function testRevExpiresAfterThirtySeconds(): void {
        $this->cache->seedRev(7, 10);
        $this->mem->now += 30;
        $this->assertNull($this->cache->getRev(7));
    }

    public function testGensAddVersusSet(): void {
        $this->cache->seedGens(7, 2, 3, 0, true, 5);
        $this->assertSame(['acl' => 2, 'link' => 3, 'minRev' => 0, 'links' => true, 'voteLink' => 5, 'gone' => false], $this->cache->getGens(7));
        $this->assertSame([2, 3, 0, 1, 5], $this->mem->get('a:7'), 'stored as [aclGen, linkGen, minRev, links, voteLinkGen]');
        $this->assertSame(120, $this->mem->ttl('a:7'));
        $this->cache->setGens(7, 3, 4, 0, false, 6);
        $this->cache->seedGens(7, 2, 3, 0, true, 5);
        $this->assertSame(['acl' => 3, 'link' => 4, 'minRev' => 0, 'links' => false, 'voteLink' => 6, 'gone' => false], $this->cache->getGens(7), 'a late seeder never overwrites a revocation');
        $this->cache->markGone(7);
        $this->assertSame(['acl' => -1, 'link' => -1, 'minRev' => -1, 'links' => false, 'voteLink' => -1, 'gone' => true], $this->cache->getGens(7));
        $this->assertSame([-1, -1, -1], $this->mem->get('a:7'), 'gone stays [-1,-1,-1]');
        $this->assertSame(300, $this->mem->ttl('a:7'));
    }

    public function testGrantValidOnlyWithMatchingAcl(): void {
        $this->cache->setGrant(7, 'alice', 2, 'edit', 'l');
        $this->assertSame(['acl' => 2, 'role' => 'edit', 'origin' => 'l'], $this->cache->getGrant(7, 'alice'));
        $this->assertSame('2|edit|l', $this->mem->get('g:7:' . substr(hash('sha256', 'alice'), 0, 24)), 'stored as "<aclGen>|<role>|<o>"');
        $this->assertNull($this->cache->getGrant(7, 'bob'));
        $this->assertNull($this->cache->getGrant(8, 'alice'));
        $this->assertSame(120, $this->mem->ttl('g:7:' . substr(hash('sha256', 'alice'), 0, 24)));
        // The key never contains the uid itself.
        foreach (array_keys($this->mem->data) as $k) {
            $this->assertStringNotContainsString('alice', $k);
        }
    }

    public function testGrantOriginsAndTtl(): void {
        foreach (['o' => 'owner', 'f' => 'edit', 's' => 'view', 'l' => 'vote'] as $o => $role) {
            $this->cache->setGrant(7, 'u' . $o, 3, $role, $o);
            $this->assertSame(['acl' => 3, 'role' => $role, 'origin' => $o], $this->cache->getGrant(7, 'u' . $o));
        }
        // A link member's grant ends with its link (SPEC-M1 §4.11.4): ttl clamped to 1–120.
        $key = static fn (string $uid): string => 'g:7:' . substr(hash('sha256', $uid), 0, 24);
        $this->cache->setGrant(7, 'short', 3, 'edit', 'l', 7);
        $this->assertSame(7, $this->mem->ttl($key('short')));
        $this->cache->setGrant(7, 'zero', 3, 'edit', 'l', 0);
        $this->assertSame(1, $this->mem->ttl($key('zero')));
        $this->cache->setGrant(7, 'long', 3, 'edit', 'l', 9999);
        $this->assertSame(120, $this->mem->ttl($key('long')));
        $this->expectException(\InvalidArgumentException::class);
        $this->cache->setGrant(7, 'x', 3, 'edit', 'x');
    }

    public function testNoFloatIsEverStored(): void {
        $this->cache->seedRev(1, 5);
        $this->cache->bumpRev(1, 6);
        $this->cache->seedGens(1, 1, 1, 0, true, 1);
        $this->cache->setGens(1, 2, 2, 3, true, 4);
        $this->cache->markGone(2);
        $this->cache->setGrant(1, 'u', 2, 'owner', 'o');
        $this->assertSame(0, $this->mem->floats);
        $this->assertSame(['acl' => 2, 'link' => 2, 'minRev' => 3, 'links' => true, 'voteLink' => 4, 'gone' => false], $this->cache->getGens(1));
    }

    public function testGarbageAndOldFormsAreAMiss(): void {
        $this->mem->set('r:1', 'x', 30);
        $this->mem->set('a:1', [1, 2], 30);
        $this->mem->set('g:1:' . substr(hash('sha256', 'u'), 0, 24), ['x'], 30);
        $this->assertNull($this->cache->getRev(1));
        $this->assertNull($this->cache->getGens(1));
        // The 4-element value of M0 and the 3-element value before it, a links
        // flag other than 0/1, text, a map, a sixth element: misses.
        foreach ([[1, 2, 0, 1], [1, 2, 0], [1, 2, 0, 2, 1], [1, 2, 0, true, 1], ['1', 2, 0, 1, 1], [1, 2, 0, 1, '1'], [1, 2, 0, 1, 1, 1], ['a' => 1, 1, 0, 1, 1]] as $v) {
            $this->mem->set('a:1', $v, 30);
            $this->assertNull($this->cache->getGens(1), json_encode($v));
        }
        $this->assertNull($this->cache->getGrant(1, 'u'));
        // The 2-part grant of M0, an unknown origin, a fourth part: misses.
        foreach (['2|owner', '2|owner|x', '2|owner|o|o', '2|Owner|o', '|owner|o', "2|owner|o\n"] as $v) {
            $this->mem->set('g:1:' . substr(hash('sha256', 'u'), 0, 24), $v, 30);
            $this->assertNull($this->cache->getGrant(1, 'u'), json_encode($v));
        }
    }

    public function testWindowCounter(): void {
        // SPEC-M1 §9.7: add(key, 0, ttl) once, inc(key, step); step 0 only reads; null without Redis.
        $this->assertSame(0, $this->cache->windowInc('pwf:1:abc:7', 660, 0));
        $this->assertSame(1, $this->cache->windowInc('pwf:1:abc:7', 660, 1));
        $this->assertSame(3, $this->cache->windowInc('pwf:1:abc:7', 660, 2));
        $this->assertSame(3, $this->cache->windowInc('pwf:1:abc:7', 660, 0));
        $this->assertSame(660, $this->mem->ttl('pwf:1:abc:7'), 'the TTL of the first add stays');
        $this->mem->now += 661;
        $this->assertSame(1, $this->cache->windowInc('pwf:1:abc:7', 660, 1), 'a new window after the TTL');
        $this->assertSame(0, $this->mem->floats);
        $this->mem->available = false;
        $this->assertNull((new FastCache($this->mem->factory(), (new EpochStub())->epoch()))->windowInc('pwf:1:abc:7', 660, 1));
    }

    public function testVoteSeqIsACasMaximum(): void {
        // SPEC-M1 §4.13.5 (R2), §5.1: vt:<b> = "<sid>:<seq>" as a string, cas
        // maximum (sid first, then seq), 120 s; an older state never wins.
        $this->assertNull($this->cache->getVoteSeq(7));
        $this->cache->setVoteSeq(7, 12, 0);
        $this->assertSame(['sid' => 12, 'seq' => 0], $this->cache->getVoteSeq(7));
        $this->assertSame('"12:0"', $this->mem->raw('vt:7'), 'a JSON string in Redis, never a number or a list');
        $this->assertSame(120, $this->mem->ttl('vt:7'));
        $this->cache->setVoteSeq(7, 12, 5);
        $this->assertSame(['sid' => 12, 'seq' => 5], $this->cache->getVoteSeq(7));
        $this->assertSame(120, $this->mem->ttl('vt:7'), 'cas drops the TTL: renewed');
        // Two batches commit 5 then 4, set 5 then 4: the older 4 never wins.
        $this->cache->setVoteSeq(7, 12, 4);
        $this->assertSame(5, $this->cache->getVoteSeq(7)['seq']);
        $this->cache->setVoteSeq(7, 12, 5);
        $this->assertSame(5, $this->cache->getVoteSeq(7)['seq']);
        // An older session never overwrites a newer one; a newer one wins with any seq.
        $this->cache->setVoteSeq(7, 11, 99);
        $this->assertSame(['sid' => 12, 'seq' => 5], $this->cache->getVoteSeq(7));
        $this->cache->setVoteSeq(7, 13, 0);
        $this->assertSame(['sid' => 13, 'seq' => 0], $this->cache->getVoteSeq(7));
        // At most 3 attempts against colliding writers, then give up (no exception, value unchanged).
        $this->mem->casFailures = 10;
        $this->mem->log = [];
        $this->cache->setVoteSeq(7, 13, 1);
        $this->assertCount(3, array_filter($this->mem->log, static fn (string $l): bool => $l === 'cas vt:7'));
        $this->assertSame(0, $this->cache->getVoteSeq(7)['seq']);
        $this->mem->casFailures = 0;
        // Expired → added again.
        $this->mem->now += 121;
        $this->assertNull($this->cache->getVoteSeq(7));
        $this->cache->setVoteSeq(7, 13, 2);
        $this->assertSame(['sid' => 13, 'seq' => 2], $this->cache->getVoteSeq(7));
        $this->assertSame(0, $this->mem->floats);
    }

    public function testVoteSeqOtherShapesAreMisses(): void {
        foreach ([12, '12', '12:', ':3', '12:3:4', '-1:3', '12:3
', [12, 3], 'a:b'] as $v) {
            $this->mem->set('vt:7', $v, 30);
            $this->assertNull($this->cache->getVoteSeq(7), json_encode($v));
        }
        // A malformed value is replaced by the next setVoteSeq.
        $this->cache->setVoteSeq(7, 1, 1);
        $this->assertSame(['sid' => 1, 'seq' => 1], $this->cache->getVoteSeq(7));
        // Without Redis: nothing stored, always a miss.
        $this->mem->available = false;
        $off = new FastCache($this->mem->factory(), (new EpochStub())->epoch());
        $off->setVoteSeq(8, 1, 1);
        $this->assertNull($off->getVoteSeq(8));
    }
}
