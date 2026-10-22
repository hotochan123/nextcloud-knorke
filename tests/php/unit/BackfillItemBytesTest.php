<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Migration\BackfillItemBytes;
use OCA\Knorke\Tests\Support\Fake;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use PHPUnit\Framework\TestCase;

/**
 * Repair step BackfillItemBytes (SPEC-M1 §3.1): only with the flag
 * `knorke/backfill_item_bytes = 1`; per board one transaction, board row lock
 * first, item_bytes = Σ strlen of the STORED data/style strings of the live
 * rows (NULL = 0, tombstones excluded); flag deleted at the end, kept when a
 * board fails. The real SQL of BoardStore::boardIds, ItemStore::liveBytes
 * and ItemStore::setItemBytes is checked against canned rows.
 */
final class BackfillItemBytesTest extends TestCase {
    /** @var list<string> */
    public array $log = [];
    /** @var array<string, string> knorke app config */
    private array $config = [];
    /** @var array<int, list<array{data: ?string, style: ?string, deleted: int}>> board → item rows */
    public array $items = [];
    /** @var array<int, int> board → item_bytes as written */
    public array $written = [];
    public ?int $failOn = null;

    private function step(): BackfillItemBytes {
        $test = $this;
        $db = Fake::of(IDBConnection::class, [
            'beginTransaction' => function () use ($test): void {
                $test->log[] = 'begin';
            },
            'commit' => function () use ($test): void {
                $test->log[] = 'commit';
            },
            'rollBack' => function () use ($test): void {
                $test->log[] = 'rollBack';
            },
        ]);
        $boards = new class($db, $test) extends BoardStore {
            public function __construct(IDBConnection $db, private BackfillItemBytesTest $test) {
                parent::__construct($db);
            }

            protected function rows(string $sql, array $params, array $types): array {
                if ($sql !== 'SELECT id FROM *PREFIX*knorke_boards ORDER BY id' || $params !== []) {
                    throw new \LogicException($sql);
                }
                $this->test->log[] = 'boardIds';
                return array_map(static fn (int $id): array => ['id' => (string)$id], array_keys($this->test->items));
            }

            public function lockBoard(int $board, bool $bumpAcl, ?string $bumpLinkRole, int $nowMs): ?array {
                $this->test->log[] = "lock $board " . ($bumpAcl || $bumpLinkRole !== null ? 'bump' : 'no-bump');
                return $board === 404 ? null : ['id' => $board];
            }
        };
        $items = new class($db, $test) extends ItemStore {
            public function __construct(IDBConnection $db, private BackfillItemBytesTest $test) {
                parent::__construct($db);
            }

            protected function each(string $sql, array $params, array $types): \Generator {
                if ($sql !== 'SELECT data, style FROM *PREFIX*knorke_items WHERE board_id = ? AND deleted = 0') {
                    throw new \LogicException($sql);
                }
                $this->test->log[] = 'liveBytes ' . $params[0];
                if ($params[0] === $this->test->failOn) {
                    throw new \RuntimeException('connection lost');
                }
                foreach ($this->test->items[$params[0]] ?? [] as $r) {
                    if ($r['deleted'] === 0) {
                        yield ['data' => $r['data'], 'style' => $r['style']];
                    }
                }
            }

            protected function exec(string $sql, array $params, array $types): int {
                if ($sql !== 'UPDATE *PREFIX*knorke_boards SET item_bytes = ? WHERE id = ?') {
                    throw new \LogicException($sql);
                }
                $this->test->log[] = "setItemBytes {$params[1]} {$params[0]}";
                $this->test->written[$params[1]] = $params[0];
                return 1;
            }
        };
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueString' => fn (string $app, string $key, string $default = '', bool $lazy = false): string => $app === 'knorke' && $lazy ? ($this->config[$key] ?? $default) : $default,
            'deleteKey' => function (string $app, string $key): void {
                $this->log[] = "deleteKey $app/$key";
                unset($this->config[$key]);
            },
        ]);
        return new BackfillItemBytes($appConfig, $db, $boards, $items);
    }

    private static function out(): IOutput {
        return Fake::of(IOutput::class);
    }

    public function testNothingWithoutTheFlag(): void {
        $this->items = [1 => [['data' => '{"text":"x"}', 'style' => '{}', 'deleted' => 0]]];
        $this->step()->run(self::out());
        $this->assertSame([], $this->log);
        $this->config['backfill_item_bytes'] = '0';
        $this->step()->run(self::out());
        $this->assertSame([], $this->log);
    }

    public function testRecomputesFromTheStoredStrings(): void {
        $this->config['backfill_item_bytes'] = '1';
        $this->items = [
            3 => [
                ['data' => '{"text":"Grüße"}', 'style' => '{"fill":"#a8d8f8"}', 'deleted' => 0],
                ['data' => '{"text":"weg"}', 'style' => '{}', 'deleted' => 1],
                ['data' => null, 'style' => null, 'deleted' => 0],
                // Stored spelling counts, not a re-encoding (here: escaped slash, spaces).
                ['data' => '{"text": "a\/b"}', 'style' => null, 'deleted' => 0],
            ],
            7 => [],
        ];
        $want3 = strlen('{"text":"Grüße"}') + strlen('{"fill":"#a8d8f8"}') + strlen('{"text": "a\/b"}');
        $this->step()->run(self::out());
        $this->assertSame([3 => $want3, 7 => 0], $this->written);
        $this->assertSame(52, $want3, 'bytes, not characters (ü, ß: 2 bytes each)');
        $this->assertSame([
            'boardIds',
            'begin', 'lock 3 no-bump', 'liveBytes 3', "setItemBytes 3 $want3", 'commit',
            'begin', 'lock 7 no-bump', 'liveBytes 7', 'setItemBytes 7 0', 'commit',
            'deleteKey knorke/backfill_item_bytes',
        ], $this->log, 'lock first, one transaction per board, flag deleted last');
        $this->assertArrayNotHasKey('backfill_item_bytes', $this->config);
    }

    public function testVanishedBoardIsSkipped(): void {
        $this->config['backfill_item_bytes'] = '1';
        $this->items = [404 => [['data' => '{}', 'style' => '{}', 'deleted' => 0]]];
        $this->assertSame(0, $this->step()->backfill());
        $this->assertSame(['boardIds', 'begin', 'lock 404 no-bump', 'commit'], $this->log);
        $this->assertSame([], $this->written);
    }

    public function testFailureRollsBackAndKeepsTheFlag(): void {
        $this->config['backfill_item_bytes'] = '1';
        $this->items = [1 => [], 2 => [['data' => '{}', 'style' => '{}', 'deleted' => 0]], 3 => []];
        $this->failOn = 2;
        try {
            $this->step()->run(self::out());
            $this->fail('the failure propagates (repair run reports it, next run starts over)');
        } catch (\RuntimeException $e) {
            $this->assertSame('connection lost', $e->getMessage());
        }
        $this->assertSame(['boardIds', 'begin', 'lock 1 no-bump', 'liveBytes 1', 'setItemBytes 1 0', 'commit',
            'begin', 'lock 2 no-bump', 'liveBytes 2', 'rollBack'], $this->log);
        $this->assertSame('1', $this->config['backfill_item_bytes'], 'flag kept: the step is idempotent and runs again');
    }
}
