<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Epoch;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Tests\Support\EpochStub;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeBoardStore;
use OCA\Knorke\Tests\Support\MemoryCache;
use OCP\ICacheFactory;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;

/**
 * The meta write path (SPEC-M1 §4.13.4): the board row lock is the FIRST
 * statement, meta is read after it, meta_rev = the new rev, the size cap,
 * no change row, bumpRev only after COMMIT; read() and the wire forms.
 */
final class MetaServiceTest extends TestCase {
    private FakeBoardStore $boards;
    private MemoryCache $mem;
    private FastCache $cache;
    private MetaService $meta;
    private int $b;
    private bool $fourByte = true;
    /** Open transactions of the fake connection (inTransaction()). */
    private int $depth = 0;

    protected function setUp(): void {
        $this->boards = new FakeBoardStore();
        $this->mem = new MemoryCache();
        $log = &$this->boards->log;
        $this->cache = new class($this->mem->factory(), (new EpochStub())->epoch(), $log) extends FastCache {
            /** @param list<string> $log */
            public function __construct(ICacheFactory $f, Epoch $e, private array &$log) {
                parent::__construct($f, $e);
            }

            public function bumpRev(int $b, int $rev): void {
                $this->log[] = "bumpRev $rev";
                parent::bumpRev($b, $rev);
            }
        };
        $db = Fake::of(IDBConnection::class, [
            'supports4ByteText' => fn (): bool => $this->fourByte,
            'beginTransaction' => function (): void {
                $this->depth++;
                $this->boards->log[] = 'begin';
            },
            'commit' => function (): void {
                $this->depth--;
                $this->boards->log[] = 'commit';
            },
            'rollBack' => function (): void {
                $this->depth--;
                $this->boards->log[] = 'rollBack';
            },
            'inTransaction' => fn (): bool => $this->depth > 0,
        ]);
        $this->meta = new MetaService($this->boards, $this->cache, $db);
        $this->b = $this->boards->addBoard('alice', 'Retro', 10);
        $this->boards->log = [];
    }

    private function expectHttp(int $status, string $code, callable $fn): void {
        try {
            $fn();
            $this->fail("expected $status $code");
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error]);
        }
    }

    public function testLockFirstMetaRevIsTheNewRevBumpAfterCommit(): void {
        $timer = ['state' => 'running', 'dur' => 300000, 'end' => 1760100300000, 'left' => null, 'by' => 'Alice Adler', 'seq' => 1];
        $seen = null;
        $out = $this->meta->write($this->b, function (array $m) use (&$seen, $timer): array {
            $seen = $m;
            $this->boards->log[] = 'mutate';
            return $m + ['timer' => $timer];
        }, 1760100000000);
        $this->assertSame([], $seen, 'NULL meta = {}');
        $this->assertSame(['begin', 'lockBoard --', 'meta', 'mutate', 'writeMeta', 'commit', 'bumpRev 11'], $this->boards->log,
            'lock FIRST (no bump), meta read after it, one write, bumpRev only after COMMIT');
        $this->assertSame(['title' => 'Retro', 'meta' => ['timer' => $timer], 'metaRev' => 11], $out);
        $row = $this->boards->boards[$this->b];
        $this->assertSame([11, 11, 1760100000000], [$row['rev'], $row['meta_rev'], $row['updated_at']], 'meta_rev = rev');
        $this->assertSame('{"timer":{"state":"running","dur":300000,"end":1760100300000,"left":null,"by":"Alice Adler","seq":1}}', $row['meta']);
        $this->assertSame([1, 1, 1], [$row['acl_gen'], $row['link_gen'], $row['vote_link_gen']], 'no generation moves');
        $this->assertSame(11, $this->cache->getRev($this->b));

        // The next write sees the stored meta; a title is written with it.
        $out = $this->meta->write($this->b, function (array $m): array {
            $m['timer']['seq']++;
            return $m;
        }, 1760100001000, 'Retro KW41');
        $this->assertSame(['Retro KW41', 2, 12], [$out['title'], $out['meta']['timer']['seq'], $out['metaRev']]);
        $this->assertSame([12, 12, 'Retro KW41'], [$this->boards->boards[$this->b]['rev'], $this->boards->boards[$this->b]['meta_rev'], $this->boards->boards[$this->b]['title']]);
    }

    public function testEmptyMetaIsStoredAsNullAndKeepsTheTitle(): void {
        $this->boards->boards[$this->b]['meta'] = '{"summon":{"pid":"p","client":"c","name":"A","seq":1,"at":5}}';
        $out = $this->meta->write($this->b, static function (array $m): array {
            unset($m['summon']);
            return $m;
        }, 5);
        $this->assertSame(['title' => 'Retro', 'meta' => [], 'metaRev' => 11], $out);
        $this->assertNull($this->boards->boards[$this->b]['meta']);
        $this->assertContains('writeMeta', $this->boards->log, 'no title in the UPDATE');
        $this->assertSame('{}', MetaService::json($out['meta']), 'never []');
    }

    public function testMutationErrorRollsBackWithoutBump(): void {
        $this->expectHttp(409, 'timer_state', fn () => $this->meta->write($this->b, static fn (array $m): array => throw new HttpError(409, 'timer_state'), 5));
        $this->assertSame(['begin', 'lockBoard --', 'meta', 'rollBack'], $this->boards->log);
        $this->assertSame([10, 0], [$this->boards->boards[$this->b]['rev'], $this->boards->boards[$this->b]['meta_rev']]);
        $this->assertNull($this->cache->getRev($this->b), 'no bump');
        $this->expectException(\LogicException::class);
        $this->meta->write($this->b, static fn (array $m): array => [1, 2], 5);
    }

    public function testSizeCap(): void {
        // strlen of the stored JSON ≤ MAX_META_BYTES (262144); one byte more → 400.
        $fill = static fn (int $total): array => ['x' => str_repeat('a', $total - strlen('{"x":""}'))];
        $out = $this->meta->write($this->b, static fn (array $m): array => $fill(Limits::MAX_META_BYTES), 5);
        $this->assertSame(Limits::MAX_META_BYTES, strlen((string)$this->boards->boards[$this->b]['meta']));
        $this->assertSame(11, $out['metaRev']);
        $this->boards->log = [];
        $this->expectHttp(400, 'meta_too_large', fn () => $this->meta->write($this->b, static fn (array $m): array => $fill(Limits::MAX_META_BYTES + 1), 6));
        $this->assertSame(['begin', 'lockBoard --', 'meta', 'rollBack'], $this->boards->log, 'nothing written');
        $this->assertSame(11, $this->boards->boards[$this->b]['rev']);
    }

    public function testUnknownOrVanishedBoardIs404(): void {
        $this->expectHttp(404, 'not_found', fn () => $this->meta->write(999, static fn (array $m): array => $m, 5));
        $this->boards->onLock = function (int $board): void {
            unset($this->boards->boards[$board]);
        };
        $this->expectHttp(404, 'not_found', fn () => $this->meta->write($this->b, static fn (array $m): array => $m, 5));
        $this->assertNotContains('writeMeta', $this->boards->log);
        $this->assertNull($this->meta->read($this->b));
    }

    public function testReadAndWireForms(): void {
        $this->assertSame(['title' => 'Retro', 'meta' => [], 'metaRev' => 0], $this->meta->read($this->b));
        $this->boards->boards[$this->b]['meta'] = '{"vote":{"sid":12,"state":"open"}}';
        $this->boards->boards[$this->b]['meta_rev'] = 9;
        $this->assertSame(['title' => 'Retro', 'meta' => ['vote' => ['sid' => 12, 'state' => 'open']], 'metaRev' => 9], $this->meta->read($this->b));
        $this->assertSame('{"vote":{"sid":12,"state":"open"}}', MetaService::wire('{"vote":{"sid":12,"state":"open"}}'), 'verbatim');
        $this->assertSame('{"a":{}}', MetaService::wire('{"a":{}}'), 'an empty inner object stays {}');
        foreach ([null, '', '[]', '[1]', 'x', '"s"', '{"a":'] as $bad) {
            $this->assertSame('{}', MetaService::wire($bad), var_export($bad, true));
            $this->assertSame([], MetaService::decode($bad), var_export($bad, true));
        }
    }

    public function testObjectFormForJsonResponses(): void {
        // MetaService::object (rename answer, SPEC-M1 §15): {} for an empty map
        // through json_encode — the flags of JSONResponse::render — never [].
        $flags = JSON_HEX_TAG | JSON_THROW_ON_ERROR;
        $this->assertSame('{"meta":{}}', json_encode(['meta' => MetaService::object([])], $flags));
        $map = ['timer' => ['state' => 'running', 'endsAt' => 1760000060000], 'vote' => ['sid' => 3]];
        $this->assertSame($map, MetaService::object($map), 'a non-empty map unchanged');
        $this->assertSame('{"meta":{"timer":{"state":"running","endsAt":1760000060000},"vote":{"sid":3}}}', json_encode(['meta' => MetaService::object($map)], $flags));
        // What write() answers for a board without meta encodes as {} too.
        $out = $this->meta->write($this->b, static fn (array $m): array => $m, 1, null);
        $this->assertSame('{}', json_encode(MetaService::object($out['meta']), $flags));
    }

    public function testFourByteTextOnLegacyMysql(): void {
        // SPEC-M1 §3.9: without 4-byte UTF-8 every meta string (keys too) and
        // the title get U+FFFD instead of a 500; with it they stay as sent.
        $mutate = static fn (array $m): array => ['timer' => ['by' => 'Ada 👍', 'seq' => 1], 'k🔥' => ['x', '😀']];
        $out = $this->meta->write($this->b, $mutate, 5, 'Retro 🎯');
        $this->assertSame(['Ada 👍', 'Retro 🎯'], [$out['meta']['timer']['by'], $out['title']]);
        $this->fourByte = false;
        $out = $this->meta->write($this->b, $mutate, 6, 'Retro 🎯');
        $this->assertSame(['timer' => ['by' => "Ada \u{FFFD}", 'seq' => 1], "k\u{FFFD}" => ['x', "\u{FFFD}"]], $out['meta']);
        $this->assertSame("Retro \u{FFFD}", $out['title']);
        $this->assertSame($out['meta'], MetaService::decode($this->boards->boards[$this->b]['meta']), 'stored as answered');
        $this->assertSame("Retro \u{FFFD}", $this->boards->boards[$this->b]['title']);
    }

    public function testWritesNoChangeRow(): void {
        // Meta changes write no `changes` row (activity log: M2): the service
        // has no access to the item store at all.
        $types = array_map(
            static fn (\ReflectionParameter $p): string => (string)$p->getType(),
            (new \ReflectionMethod(MetaService::class, '__construct'))->getParameters(),
        );
        $this->assertSame([BoardStore::class, FastCache::class, IDBConnection::class], $types);
        $cols = array_map('trim', explode(',', BoardStore::BOARD_COLS));
        $this->assertNotContains('b.meta', $cols, 'lockBoard/findBoardForUser never read meta (§4.13.4)');
        foreach (['b.meta_rev', 'b.vote_link_gen', 'b.item_bytes'] as $c) {
            $this->assertContains($c, $cols);
        }
    }
}
