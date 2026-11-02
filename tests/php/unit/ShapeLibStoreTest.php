<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Notification\ShapeLibNotifications;
use OCA\Knorke\Service\ShapeImage;
use OCA\Knorke\Service\ShapeLibStore;
use OCA\Knorke\Tests\Support\ShapeLibHarness;
use PHPUnit\Framework\TestCase;

/**
 * Own shape libraries (factory job 203, routes 46–54) through
 * ShapeLibApiController and ShapeLibStore over an app data folder in memory
 * (Support/ShapeLibHarness):
 * - AK3 rights: an account of the Guests app gets 403 and an empty list,
 *   bob 403 on the admin routes; limits (21st library, 301 entries, a bad
 *   picture, 11th suggestion, a body over 4 MiB) refused without a write;
 *   suggest, withdraw, reject, adopt (twice: 404) with the bell; a foreign
 *   own library answers 404, also to admins; a deleted account
 * - the risks: the folder of an account is a hash, never a path from its
 *   uid; an SVG with a script is no picture
 */
final class ShapeLibStoreTest extends TestCase {
    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    private const NOW = 1_760_000_000_000;

    private ShapeLibHarness $h;

    protected function setUp(): void {
        $this->h = new ShapeLibHarness();
    }

    /** @return array<string, mixed> a body of route 47 with $n entries */
    private static function body(string $name = 'AWS', int $n = 2): array {
        $entries = [];
        for ($i = 0; $i < $n; $i++) {
            $entries[] = ['name' => 'Icon ' . $i, 'img' => self::PNG, 'w' => 64, 'h' => 32.5];
        }
        return ['name' => $name, 'entries' => $entries];
    }

    /** Creates a library as $uid through the store; returns its id. */
    private function seed(string $uid, string $name = 'AWS'): int {
        return $this->h->store->create($this->h->user($uid), self::body($name), self::NOW)['id'];
    }

    /** @return array<string, mixed> route 46 for $uid */
    private function list(string $uid): array {
        [$status, $data] = $this->h->call($uid, 'index');
        $this->assertSame(200, $status);
        return $data;
    }

    public function testCreateListAndShowOwnLibraries(): void {
        [$status, $data] = $this->h->call('bob', 'create', self::body('AWS ☁️'));
        $this->assertSame(201, $status);
        $id = $data['id'];
        $this->assertMatchesRegularExpression('/^[1-9][0-9]{14}$/', (string)$id);
        $this->assertSame(['right' => 'suggest', 'adopted' => [], 'own' => [['id' => $id, 'name' => 'AWS ☁️', 'names' => ['Icon 0', 'Icon 1'], 'pending' => false]]], $this->list('bob'));
        $this->assertSame(['right' => 'suggest', 'adopted' => [], 'own' => []], $this->list('alice'), 'alice does not see it');
        [$status, $data] = $this->h->call('bob', 'show', [], $id);
        $this->assertSame([200, ['entries' => [['name' => 'Icon 0', 'img' => self::PNG, 'w' => 64, 'h' => 32.5], ['name' => 'Icon 1', 'img' => self::PNG, 'w' => 64, 'h' => 32.5]]]], [$status, $data]);
        $this->assertSame(404, $this->h->call('alice', 'show', [], $id)[0], 'a foreign own library is unknown');
        $this->assertSame(404, $this->h->call('admin', 'show', [], $id)[0], 'also to admins while it is not suggested');
        $this->assertSame(404, $this->h->call('alice', 'update', ['name' => 'X'], $id)[0]);
        $this->assertSame(404, $this->h->call('alice', 'destroy', [], $id)[0]);
        $this->assertSame(404, $this->h->call('alice', 'suggest', [], $id)[0]);
        $this->assertSame(404, $this->h->call('admin', 'destroy', [], $id)[0], 'an admin cannot delete a foreign own library');
        $this->assertSame(404, $this->h->call('bob', 'show', [], 12)[0], 'an id of the wrong form');
        // the folder is a hash of the uid
        $this->assertArrayHasKey('shapelibs_u_' . hash('sha256', 'bob'), $this->h->files);
        foreach (array_keys($this->h->files) as $folder) {
            $this->assertMatchesRegularExpression('/^shapelibs_(u_[0-9a-f]{64}|adopted|pending)$/', $folder);
        }
    }

    public function testNewestFirstRenameAndDelete(): void {
        $a = $this->h->store->create($this->h->user('bob'), self::body('A'), self::NOW)['id'];
        $b = $this->h->store->create($this->h->user('bob'), self::body('B'), self::NOW + 5)['id'];
        $this->assertSame(['B', 'A'], array_column($this->list('bob')['own'], 'name'));
        $this->assertSame([200, ['id' => $a, 'name' => 'Neu']], $this->h->call('bob', 'update', ['name' => '  Neu '], $a));
        $this->assertSame(400, $this->h->call('bob', 'update', ['name' => ' '], $a)[0]);
        $this->assertSame([200, ['deleted' => true]], $this->h->call('bob', 'destroy', [], $b));
        $this->assertSame(['Neu'], array_column($this->list('bob')['own'], 'name'));
        $this->assertSame(404, $this->h->call('bob', 'show', [], $b)[0]);
    }

    public function testRefusedCreatesWriteNothing(): void {
        $bad = [
            ['name' => '', 'entries' => self::body()['entries']],
            ['name' => str_repeat('x', 101), 'entries' => self::body()['entries']],
            ['name' => 'A', 'entries' => []],
            self::body('A', 301),
            ['name' => 'A', 'entries' => [['name' => 'x', 'img' => 'data:image/bmp;base64,AAAA', 'w' => 1, 'h' => 1]]],
            ['name' => 'A', 'entries' => [['name' => 'x', 'img' => 'data:image/svg+xml;base64,' . base64_encode('<svg><script>alert(1)</script></svg>'), 'w' => 1, 'h' => 1]]],
            ['name' => 'A', 'entries' => [['name' => 'x', 'img' => self::PNG, 'w' => 0, 'h' => 1]]],
            ['name' => 'A', 'entries' => [['name' => 'x', 'img' => self::PNG, 'w' => 1, 'h' => 4001]]],
            ['name' => 'A', 'entries' => [['name' => '', 'img' => self::PNG, 'w' => 1, 'h' => 1]]],
            ['name' => 'A', 'entries' => [['name' => 'x', 'img' => self::PNG, 'w' => '1', 'h' => 1]]],
            ['name' => 'A', 'entries' => ['x' => ['name' => 'x', 'img' => self::PNG, 'w' => 1, 'h' => 1]]],
        ];
        foreach ($bad as $i => $body) {
            [$status, $data] = $this->h->call('bob', 'create', $body);
            $this->assertSame(400, $status, "#$i");
            $this->assertContains($data['error'], ['bad_request', 'name_required'], "#$i");
        }
        $this->assertSame(413, $this->h->call('bob', 'create', self::body(), null, ShapeLibStore::MAX_BODY_BYTES + 1)[0], 'over 4 MiB');
        $this->assertSame(403, $this->h->call('gast', 'create', self::body())[0], 'Guests app');
        $this->assertSame(0, $this->h->writes, 'nothing written');
        for ($i = 0; $i < ShapeLibStore::OWN_MAX; $i++) {
            $this->seed('bob', 'L' . $i);
        }
        $writes = $this->h->writes;
        $this->assertSame([409, ['error' => 'library_limit', 'message' => 'You have reached the most shape libraries an account may have.', 'max' => 20]], $this->h->call('bob', 'create', self::body()));
        $this->assertSame($writes, $this->h->writes, 'the 21st writes nothing');
        $this->assertSame(201, $this->h->call('alice', 'create', self::body())[0], 'per account');
    }

    public function testGuestsAppAndAdminRoutes(): void {
        $this->assertSame(['right' => null, 'adopted' => [], 'own' => []], $this->list('gast'));
        foreach (['show', 'update', 'destroy', 'suggest', 'withdraw'] as $action) {
            $this->assertSame(403, $this->h->call('gast', $action, $action === 'update' ? ['name' => 'x'] : [], 123456789012345)[0], $action);
        }
        $this->assertSame(403, $this->h->call('bob', 'review')[0]);
        $this->assertSame(403, $this->h->call('bob', 'adopt', [], 123456789012345)[0]);
        $this->assertSame('save', $this->list('admin')['right']);
    }

    /** Job 251 AK7: a new id skips the id of another account's open suggestion (markers are global by id). */
    public function testANewIdSkipsAForeignSuggestion(): void {
        $this->h->store->idSource = static fn (): int => 111111111111111;
        $bobs = $this->seed('bob', 'Netz');
        $this->assertSame(111111111111111, $bobs);
        $this->assertSame(200, $this->h->call('bob', 'suggest', [], $bobs)[0]);
        $ids = [111111111111111, 222222222222222];
        $this->h->store->idSource = static function () use (&$ids): int {
            return array_shift($ids);
        };
        $alices = $this->seed('alice', 'Eigene');
        $this->assertSame(222222222222222, $alices, 'the id of bob\'s suggestion is taken');
        $this->assertSame([], $ids);
        $this->assertTrue($this->list('bob')['own'][0]['pending']);
        $this->assertFalse($this->list('alice')['own'][0]['pending'], 'alice\'s library is not shown as suggested');
    }

    public function testSuggestRejectWithdrawAdopt(): void {
        $id = $this->seed('bob', 'Netz');
        [$status, $data] = $this->h->call('bob', 'suggest', ['note' => 'Für alle'], $id);
        $this->assertSame([200, ['id' => $id, 'state' => 'pending']], [$status, $data]);
        $this->assertTrue($this->list('bob')['own'][0]['pending']);
        $this->assertSame(["admin shapelib_suggested $id", "root shapelib_suggested $id"], $this->h->t->bellOf());
        $this->assertSame([200, ['id' => $id, 'state' => 'pending']], $this->h->call('bob', 'suggest', [], $id), 'twice: the first stays');
        $this->assertCount(2, $this->h->t->bellOf(), 'no second notification');
        // the admins see it and its pictures
        [$status, $review] = $this->h->call('admin', 'review');
        $this->assertSame(200, $status);
        $this->assertGreaterThan(0, $review['suggestions'][0]['created'] ?? 0, 'when it was suggested (now)');
        unset($review['suggestions'][0]['created']);
        $this->assertSame([['id' => $id, 'name' => 'Netz', 'names' => ['Icon 0', 'Icon 1'], 'note' => 'Für alle', 'by' => 'Bob Berg']], $review['suggestions']);
        $this->assertSame(200, $this->h->call('admin', 'show', [], $id)[0]);
        $this->assertSame(404, $this->h->call('alice', 'show', [], $id)[0]);
        $this->assertSame(['name' => 'Netz', 'suggested_by' => 'bob'], $this->h->store->pendingRow($id));
        // withdraw: only bob
        $this->assertSame(404, $this->h->call('alice', 'withdraw', [], $id)[0]);
        $this->assertSame([200, ['withdrawn' => true]], $this->h->call('bob', 'withdraw', [], $id));
        $this->assertSame([], $this->h->t->bellOf(), 'the admins\' notification is done');
        $this->assertFalse($this->list('bob')['own'][0]['pending']);
        $this->assertSame(404, $this->h->call('bob', 'withdraw', [], $id)[0]);
        // reject: the library stays with bob
        $this->h->call('bob', 'suggest', [], $id);
        $this->assertSame([200, ['deleted' => true]], $this->h->call('admin', 'destroy', [], $id));
        $this->assertSame(["bob shapelib_rejected $id"], $this->h->t->bellOf());
        $this->assertSame(['Netz'], array_column($this->list('bob')['own'], 'name'));
        $this->assertSame(404, $this->h->call('admin', 'adopt', [], $id)[0], 'no suggestion any more');
        // adopt: a copy for everyone, bob keeps his own
        $this->h->call('bob', 'suggest', [], $id);
        [$status, $data] = $this->h->call('admin', 'adopt', [], $id);
        $this->assertSame(200, $status);
        $copy = $data['id'];
        $this->assertNotSame($id, $copy);
        $this->assertSame(404, $this->h->call('root', 'adopt', [], $id)[0], 'the second admin is too late');
        $this->assertContains("bob shapelib_adopted $id", $this->h->t->bellOf());
        $this->assertNotContains("admin shapelib_suggested $id", $this->h->t->bellOf());
        $alice = $this->list('alice');
        $this->assertSame([['id' => $copy, 'name' => 'Netz', 'names' => ['Icon 0', 'Icon 1']]], $alice['adopted']);
        $this->assertSame(200, $this->h->call('alice', 'show', [], $copy)[0]);
        $this->assertSame(['Netz'], array_column($this->list('bob')['own'], 'name'));
        $this->assertNull($this->h->store->pendingRow($id));
        // only admins rename and delete an adopted one
        $this->assertSame(403, $this->h->call('alice', 'update', ['name' => 'X'], $copy)[0]);
        $this->assertSame(403, $this->h->call('alice', 'destroy', [], $copy)[0]);
        $this->assertSame(200, $this->h->call('root', 'update', ['name' => 'Netzwerk'], $copy)[0]);
        $this->assertSame('Netzwerk', $this->list('bob')['adopted'][0]['name']);
        $this->assertSame(200, $this->h->call('root', 'destroy', [], $copy)[0]);
        $this->assertSame([], $this->list('alice')['adopted']);
    }

    public function testAdminMakesAvailableAtOnceAndSuggestionLimit(): void {
        $id = $this->seed('admin', 'Büro');
        [$status, $data] = $this->h->call('admin', 'suggest', ['note' => 'egal'], $id);
        $this->assertSame(200, $status);
        $this->assertSame('adopted', $data['state']);
        $this->assertSame([], $this->h->t->bellOf(), 'nobody to ask');
        $this->assertSame(['Büro'], array_column($this->list('bob')['adopted'], 'name'));
        for ($i = 0; $i < ShapeLibStore::PENDING_MAX; $i++) {
            $this->assertSame(200, $this->h->call('bob', 'suggest', [], $this->seed('bob', 'S' . $i))[0]);
        }
        $writes = $this->h->writes;
        $this->assertSame([409, ['error' => 'suggestion_limit', 'message' => 'You have reached the most open shape library suggestions an account may have.', 'max' => 10]],
            $this->h->call('bob', 'suggest', [], $this->seed('bob', 'S10')));
        $this->assertSame($writes + 2, $this->h->writes, 'only the seed wrote');
        $this->assertSame(400, $this->h->call('bob', 'suggest', ['note' => str_repeat('n', 201)], $this->seed('alice'))[0], 'the note is checked first');
    }

    public function testDeletingASuggestedLibraryAndADeletedAccount(): void {
        $id = $this->seed('bob');
        $this->h->call('bob', 'suggest', [], $id);
        $this->assertSame(200, $this->h->call('bob', 'destroy', [], $id)[0]);
        $this->assertSame([], $this->h->t->bellOf(), 'deleting ends the suggestion');
        $this->assertSame([], $this->h->call('admin', 'review')[1]['suggestions']);
        $keep = $this->seed('bob', 'Keep');
        $this->h->call('bob', 'suggest', [], $keep);
        $adopted = $this->h->store->suggest($this->h->user('admin'), $this->seed('admin', 'Shared'), [], self::NOW)['id'];
        $this->h->store->onUserDeleted('bob');
        $this->assertArrayNotHasKey('shapelibs_u_' . hash('sha256', 'bob'), $this->h->files);
        $this->assertSame([], $this->h->t->bellOf());
        $this->assertSame([], $this->h->call('admin', 'review')[1]['suggestions']);
        $this->assertSame([$adopted], array_column($this->list('alice')['adopted'], 'id'), 'adopted libraries stay');
    }

    public function testNotifierTexts(): void {
        $id = $this->seed('bob', 'Netz');
        $this->h->call('bob', 'suggest', [], $id);
        $n = $this->h->t->notifier();
        $shown = $n->prepare($this->h->t->stored('admin', $id, ShapeLibNotifications::SUGGESTED), 'de');
        $this->assertSame('Bob Berg hat die Formbibliothek Netz vorgeschlagen', $shown->getParsedSubject());
        $this->assertStringEndsWith('/settings/admin/knorke', $shown->getLink());
        $this->h->call('admin', 'adopt', [], $id);
        $shown = $n->prepare($this->h->t->stored('bob', $id, ShapeLibNotifications::ADOPTED), 'en');
        $this->assertSame('Your shape library Netz was adopted. Everyone can now use it.', $shown->getParsedSubject());
        $this->h->call('bob', 'suggest', [], $id);
        $this->h->call('root', 'destroy', [], $id);
        $shown = $n->prepare($this->h->t->stored('bob', $id, ShapeLibNotifications::REJECTED), 'de');
        $this->assertSame('Dein Vorschlag der Formbibliothek Netz wurde nicht übernommen.', $shown->getParsedSubject());
    }

    public function testPictureRule(): void {
        $svg = static fn (string $t): string => 'data:image/svg+xml;base64,' . base64_encode($t);
        $this->assertTrue(ShapeImage::isUri(self::PNG));
        $this->assertTrue(ShapeImage::isUri($svg('<svg xmlns="http://www.w3.org/2000/svg"/>')));
        $this->assertFalse(ShapeImage::isUri($svg('<svg><SCRIPT/></svg>')));
        $this->assertFalse(ShapeImage::isUri($svg('<svg xmlns:x="http://www.w3.org/2000/svg"><x:script/></svg>')), 'with a prefix');
        $this->assertFalse(ShapeImage::isUri($svg('<svg><foreignObject/></svg>')));
        $this->assertFalse(ShapeImage::isUri($svg('<html/>')));
        $this->assertFalse(ShapeImage::isUri('data:image/png;base64,AAA'));
        $this->assertFalse(ShapeImage::isUri('data:image/png;base64,' . str_repeat('A', ShapeImage::MAX)));
        $this->assertSame(self::PNG, ShapeImage::join([substr(self::PNG, 0, 10), substr(self::PNG, 10)]));
        $this->assertNull(ShapeImage::join(['a' => self::PNG]));
        $this->assertSame(ShapeImage::CHUNKS, (int)ceil(ShapeImage::MAX / ShapeImage::CHUNK));
        $this->assertSame(ShapeLibNotifications::OBJECT_TYPE, 'shapelib');
    }

    public function testCreateWritesTheOwnerFileThatOnlyCountsForItsOwnFolder(): void {
        // Job 247 AK4: the owner file names the account; it is no library;
        // one naming another account (the hash does not match) is no owner.
        $a = $this->seed('bob');
        $folder = ShapeLibStore::userFolder('bob');
        $this->assertSame('{"uid":"bob"}', $this->h->files[$folder][ShapeLibStore::OWNER]);
        $this->assertSame(['owned' => ['bob'], 'unowned' => []], $this->h->store->userFolders());
        $this->assertSame([$a], array_column($this->list('bob')['own'], 'id'), 'the owner file is no library');
        $this->assertSame(1, $this->h->store->countOf('bob'));
        $this->h->files[$folder][ShapeLibStore::OWNER] = '{"uid":"alice"}';
        $this->assertSame(['owned' => [], 'unowned' => [ShapeLibStore::folderHash('bob')]], $this->h->store->userFolders(), 'a foreign uid is never taken');
        $this->h->files[$folder][ShapeLibStore::OWNER] = 'kaputt';
        $this->assertSame(['owned' => [], 'unowned' => [ShapeLibStore::folderHash('bob')]], $this->h->store->userFolders());
        $this->seed('bob', 'Zwei');
        $this->assertSame('{"uid":"bob"}', $this->h->files[$folder][ShapeLibStore::OWNER], 'the next create repairs it');
        $this->h->files[$folder][ShapeLibStore::OWNER] = '{"uid":"alice"}';
        $this->h->store->claimFolder('bob');
        $this->assertSame('{"uid":"bob"}', $this->h->files[$folder][ShapeLibStore::OWNER], 'claimFolder writes the right owner');
        $this->assertSame([], $this->h->store->userFolders()['unowned']);
        $this->assertSame(0, $this->h->store->countFolder('zz'), 'no hash: nothing');
        $this->assertFalse($this->h->store->folderExists('../x'));
    }
}
