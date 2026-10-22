<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Db\PrimaryReads;
use OCA\Knorke\Tests\Support\Fake;
use OCP\DB\IResult;
use OCP\DB\QueryBuilder\IExpressionBuilder;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IConfig;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;

/**
 * Read replicas (SPEC-M0 §3.7, review finding NC-1): with `dbreplica` set,
 * the first Knorke SELECT of a request is preceded by one empty transaction
 * (BEGIN/COMMIT connects the primary, which then serves every later read);
 * without replicas nothing happens. Every read method of the stores pins.
 */
final class PrimaryReadsTest extends TestCase {
    /** @var list<string> */
    private array $log = [];
    private bool $inTx = false;

    private function db(): IDBConnection {
        $result = Fake::of(IResult::class, ['fetchAssociative' => fn (): array|false => false, 'closeCursor' => fn (): bool => true]);
        $expr = Fake::of(IExpressionBuilder::class, [
            'eq' => fn ($x, $y, $type = null): string => "$x = ?",
            'in' => fn ($x, $y, $type = null): string => "$x IN (?)",
        ]);
        $qb = null;
        $self = static function () use (&$qb) {
            return $qb;
        };
        $qb = Fake::of(IQueryBuilder::class, [
            'select' => $self,
            'from' => $self,
            'where' => $self,
            'andWhere' => $self,
            'orderBy' => $self,
            'expr' => fn () => $expr,
            'createNamedParameter' => fn ($v, $t = IQueryBuilder::PARAM_STR, $p = null): string => '?',
            'executeQuery' => function (?IDBConnection $c = null) use ($result): IResult {
                $this->log[] = 'select';
                return $result;
            },
        ]);
        return Fake::of(IDBConnection::class, [
            'inTransaction' => fn (): bool => $this->inTx,
            'beginTransaction' => function (): void {
                $this->log[] = 'begin';
            },
            'commit' => function (): void {
                $this->log[] = 'commit';
            },
            'executeQuery' => function (string $sql, array $params = [], array $types = []) use ($result): IResult {
                $this->log[] = 'select';
                return $result;
            },
            'getQueryBuilder' => fn (): IQueryBuilder => $qb,
        ]);
    }

    private static function config(mixed $replica): IConfig {
        return Fake::of(IConfig::class, ['getSystemValue' => fn (string $k, $d = '') => $k === 'dbreplica' ? $replica : $d]);
    }

    public function testNoReplicaCostsNothing(): void {
        $db = $this->db();
        $pin = new PrimaryReads($db, self::config([]));
        $store = new ItemStore($db, $pin);
        $store->readRev(1);
        $store->itemsSince(1, 0, 5, 500);
        $this->assertSame(['select', 'select'], $this->log);
    }

    public function testReplicaPinsOncePerRequestBeforeTheFirstRead(): void {
        $db = $this->db();
        $pin = new PrimaryReads($db, self::config([['host' => 'replica', 'user' => 'nc', 'password' => 'x']]));
        $boards = new BoardStore($db, $pin);
        $items = new ItemStore($db, $pin);
        $boards->findBoardForUser(1, 'alice', 0);
        $items->itemsSince(1, 0, 5, 500);
        $boards->findLinkByToken('Ab3dEf6hIj9kLm2nOp5qRs8t');
        $this->assertSame(['begin', 'commit', 'select', 'select', 'select'], $this->log, 'one empty transaction, then every read');
    }

    public function testInsideATransactionTheConnectionIsThePrimaryAlready(): void {
        $db = $this->db();
        $pin = new PrimaryReads($db, self::config([['host' => 'replica']]));
        $this->inTx = true;
        (new ItemStore($db, $pin))->readRev(1);
        $this->inTx = false;
        (new ItemStore($db, $pin))->readRev(1);
        $this->assertSame(['select', 'select'], $this->log);
    }

    public function testEveryReadMethodOfTheStoresPins(): void {
        $calls = [
            [BoardStore::class, fn (BoardStore $s) => $s->findBoard(1)],
            [BoardStore::class, fn (BoardStore $s) => $s->findBoardForUser(1, 'alice', 0)],
            [BoardStore::class, fn (BoardStore $s) => $s->listForUser('alice', ['staff'], ['aTeam'], 0)],
            [BoardStore::class, fn (BoardStore $s) => $s->countOwned('alice')],
            [BoardStore::class, fn (BoardStore $s) => $s->findLinkByToken('Ab3dEf6hIj9kLm2nOp5qRs8t')],
            [BoardStore::class, fn (BoardStore $s) => $s->activeLinkOf(1, 'edit')],
            [BoardStore::class, fn (BoardStore $s) => $s->activeLinkOf(1, 'vote')],
            [BoardStore::class, fn (BoardStore $s) => $s->pin()],
            [BoardStore::class, fn (BoardStore $s) => $s->pruneLinks(5)],
            [ShareStore::class, fn (ShareStore $s) => $s->forBoard(1)],
            [ShareStore::class, fn (ShareStore $s) => $s->sharesFor('group', ['staff'])],
            [ShareStore::class, fn (ShareStore $s) => $s->boardsFor('team', ['aTeam'])],
            [ShareStore::class, fn (ShareStore $s) => $s->deleteRecipient('user', 'bob')],
            [BoardStore::class, fn (BoardStore $s) => $s->boardsOwnedBy('alice')],
            [ItemStore::class, fn (ItemStore $s) => $s->readRev(1)],
            [ItemStore::class, fn (ItemStore $s) => $s->itemsSince(1, 0, 5, 500)],
            [ItemStore::class, fn (ItemStore $s) => iterator_to_array($s->snapshotItems(1))],
            [ItemStore::class, fn (ItemStore $s) => $s->loadItems(1, ['01JA0000000000000000000001'])],
            [ItemStore::class, fn (ItemStore $s) => $s->liveChildren(1, ['01JA0000000000000000000001'])],
            [ItemStore::class, fn (ItemStore $s) => $s->groupMembers(1, ['01JA0000000000000000000001'])],
        ];
        foreach ($calls as $i => [$class, $call]) {
            $this->log = [];
            $db = $this->db();
            $call(new $class($db, new PrimaryReads($db, self::config([['host' => 'replica']]))));
            if ($this->log === ['begin', 'commit']) {
                continue; // pin() alone
            }
            $this->assertSame(['begin', 'commit', 'select'], array_slice($this->log, 0, 3), "read $i of $class pins first");
            $this->assertSame(['select'], array_values(array_unique(array_slice($this->log, 2))), "read $i of $class: one pin per request");
        }
    }
}
