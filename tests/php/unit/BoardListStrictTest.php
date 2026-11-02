<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\SqliteDb;
use OCP\DB\IResult;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;

/**
 * Factory job 251 AK8: the board list compares share recipients as
 * strictly as the access check (ShareService::applies). The SQLite engine
 * gets a case-insensitive `recipient IN (…)` here, like MySQL's default
 * collation, so "Bob" and "Admins" would match bob and admins in SQL.
 */
final class BoardListStrictTest extends TestCase {
    public function testOnlyExactRecipientsGiveARole(): void {
        $sql = new SqliteDb();
        $inner = $sql->connection();
        $db = Fake::of(IDBConnection::class, [
            'executeQuery' => fn (string $q, array $p = [], array $t = []): IResult => $inner->executeQuery(str_replace('recipient IN (', 'recipient COLLATE NOCASE IN (', $q), $p, $t),
            'executeStatement' => fn (string $q, array $p = [], array $t = []): int => $inner->executeStatement($q, $p, $t),
            'inTransaction' => fn (): bool => false,
        ]);
        $boards = [];
        foreach ([['user', 'Bob'], ['group', 'Admins'], ['user', 'bob'], ['group', 'admins'], ['team', 'TeamA'], ['team', 'teama']] as $i => [$kind, $recipient]) {
            $b = $sql->addBoard('alice', 'B' . $i, 0);
            $sql->all('INSERT INTO oc_knorke_shares (board_id, kind, recipient, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, 0)', [$b, $kind, $recipient, 'edit', 'alice']);
            $boards[$kind . ':' . $recipient] = $b;
        }
        $this->assertCount(2, $db->executeQuery("SELECT id FROM oc_knorke_shares WHERE kind = 'user' AND recipient IN (?)", ['bob'])->fetchAll(),
            'the engine of this test matches case-insensitively, as MySQL does');
        $rows = (new BoardStore($db))->listForUser('bob', ['admins'], ['teama'], 0);
        $roles = array_column(array_map(static fn (array $r): array => ['id' => $r['id'], 'roles' => $r['share_roles']], $rows), 'roles', 'id');
        $this->assertSame([], $roles[$boards['user:Bob']] ?? [], '"Bob" gives bob no role');
        $this->assertSame([], $roles[$boards['group:Admins']] ?? [], '"Admins" gives a member of admins no role');
        $this->assertSame([], $roles[$boards['team:TeamA']] ?? []);
        $this->assertSame(['edit'], $roles[$boards['user:bob']]);
        $this->assertSame(['edit'], $roles[$boards['group:admins']]);
        $this->assertSame(['edit'], $roles[$boards['team:teama']]);
    }

    public function testExactRecipients(): void {
        $rows = [['recipient' => 'Bob'], ['recipient' => 'bob'], ['recipient' => '123'], ['recipient' => null]];
        $this->assertSame([['recipient' => 'bob'], ['recipient' => '123']], BoardStore::exactRecipients($rows, ['bob', '123']));
        $this->assertSame([], BoardStore::exactRecipients($rows, []));
    }
}
