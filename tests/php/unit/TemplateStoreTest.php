<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Listener\UserDeletedListener;
use OCA\Knorke\Notification\TemplateNotifications;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\TemplateStore;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\SyncHarness;
use OCA\Knorke\Tests\Support\TemplateHarness;
use OCA\Knorke\Tests\Support\VoteHarness;
use OCP\IUser;
use OCP\User\Events\UserDeletedEvent;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Template suggestions (factory job 182, routes 28–34) through
 * TemplateApiController and TemplateStore over a real SQLite table
 * (Support/TemplateHarness):
 * - AK3 rights and lists: bob suggests, alice does not see it, nobody
 *   inserts it; the admin saves an adopted one everyone sees; an account of
 *   the Guests app gets right null and 403; bob gets 403 on the admin
 *   routes; the orders of Verhalten 4
 * - AK4 every refused create writes nothing; at most 10 open suggestions
 *   (admins: no limit); without 4-byte text an emoji becomes U+FFFD
 * - AK5 adopt, rename, reject, withdraw, foreign rows (with the bell of the
 *   fake notification manager)
 * - AK7 a deleted account through UserDeletedListener
 */
final class TemplateStoreTest extends TestCase {
    private const SKETCH = [[4, 10.5, 50, 30, ''], [10, 20, 12.25, 12.25, '#fff6b6']];

    private TemplateHarness $h;
    /** @var list<string> errors the listener logged */
    private array $errors = [];

    protected function setUp(): void {
        $this->h = new TemplateHarness();
    }

    /** A board file of n notes (title "", as session.templateDraft builds it). */
    private static function content(int $n = 1, string $text = 'Notiz'): string {
        $items = [];
        for ($i = 0; $i < $n; $i++) {
            $items[] = ['id' => sprintf('01JT%022d', $i + 1), 't' => 'sticky', 'x' => $i * 250, 'y' => 0, 'w' => 200, 'h' => 200, 'r' => 0,
                'parent' => null, 'data' => ['text' => $text . ' ' . $i], 'style' => ['fill' => '#fff6b6'], 'group' => null];
        }
        return json_encode(['knorke' => 1, 'kind' => 'board', 'title' => '', 'origin' => [0, 0], 'items' => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** @return array<string, mixed> a valid body of route 29 */
    private static function body(string $name = 'Retro', ?string $note = null): array {
        return ['name' => $name, 'content' => self::content(), 'sketch' => self::SKETCH] + ($note === null ? [] : ['note' => $note]);
    }

    /** @return array{0: int, 1: mixed} status and data of one request as $uid (TemplateHarness::call) */
    private function call(string $uid, string $action, array $body = [], ?int $id = null): array {
        return $this->h->call($uid, $action, $body, $id);
    }

    /** Creates a template as $uid at $now (ms) through the store; returns its id. */
    private function seed(string $uid, string $name, int $now, ?string $note = null): int {
        return $this->h->store->create($this->h->user($uid), self::body($name, $note), $now)['id'];
    }

    /** @return array<string, mixed> route 28 for $uid */
    private function list(string $uid): array {
        [$status, $data] = $this->call($uid, 'index');
        $this->assertSame(200, $status);
        return $data;
    }

    private function rowCount(): int {
        return (int)$this->h->sql->one('SELECT COUNT(*) FROM *PREFIX*knorke_templates');
    }

    /** @return array<string, mixed>|null the row of $id */
    private function row(int $id): ?array {
        return $this->h->sql->all('SELECT * FROM *PREFIX*knorke_templates WHERE id = ?', [$id])[0] ?? null;
    }

    // ---- AK3 ----------------------------------------------------------------------

    public function testAk3BobSuggestsAliceSeesNothingNobodyInsertsIt(): void {
        [$status, $data] = $this->call('bob', 'create', self::body('A', '  Gut für Retros '));
        $this->assertSame(201, $status);
        $this->assertSame(['id', 'state'], array_keys($data));
        $this->assertSame('pending', $data['state']);
        $a = $data['id'];
        $row = $this->row($a);
        $this->assertSame(['pending', 'A', 'Gut für Retros', 'bob', self::content()], [$row['state'], $row['name'], $row['note'], $row['suggested_by'], $row['content']], 'the content verbatim');
        $this->assertNull($row['adopted_at']);

        $bob = $this->list('bob');
        $this->assertSame('suggest', $bob['right']);
        $this->assertSame([], $bob['templates']);
        $this->assertSame([['id' => $a, 'name' => 'A', 'note' => 'Gut für Retros', 'sketch' => self::SKETCH, 'created' => (int)$row['created_at']]], $bob['pending']);
        $this->assertSame(['right' => 'suggest', 'templates' => [], 'pending' => []], $this->list('alice'), 'A is missing for alice');
        foreach (['bob', 'alice', 'admin'] as $uid) {
            [$status, $d] = $this->call($uid, 'show', [], $a);
            $this->assertSame([404, 'not_found'], [$status, $d['error']], "route 30 on a pending suggestion for $uid");
        }
        $this->assertSame(404, $this->call('bob', 'show', [], 424242)[0], 'an unknown id is the same 404');
    }

    public function testAk3TheAdminSavesAnAdoptedTemplateEveryoneSees(): void {
        [$status, $data] = $this->call('admin', 'create', self::body('C', 'kein Satz für Admins'));
        $this->assertSame([201, 'adopted'], [$status, $data['state']]);
        $c = $data['id'];
        $row = $this->row($c);
        $this->assertSame(['adopted', null, null], [$row['state'], $row['note'], $row['suggested_by']], 'an admin keeps no note and no uid');
        $this->assertSame((int)$row['created_at'], (int)$row['adopted_at']);
        $alice = $this->list('alice');
        $this->assertSame([['id' => $c, 'name' => 'C', 'sketch' => self::SKETCH]], $alice['templates'], 'exactly id, name and sketch');
        $this->assertSame([], $alice['pending']);
        $this->assertSame('save', $this->list('admin')['right']);
        [$status, $d] = $this->call('alice', 'show', [], $c);
        $this->assertSame([200, ['content' => self::content()]], [$status, $d]);
        $this->assertSame([], $this->h->bell, 'saving directly notifies nobody');
    }

    public function testAk3AnAccountOfTheGuestsAppHasNoRightAndGets403(): void {
        $c = $this->seed('admin', 'C', 1000);
        $a = $this->seed('bob', 'A', 2000);
        $before = $this->h->rows();
        $this->assertSame(['right' => null, 'templates' => [], 'pending' => []], $this->list('gast'));
        foreach ([['create', self::body('G'), null], ['show', [], $c], ['destroy', [], $c], ['destroy', [], $a]] as [$action, $body, $id]) {
            [$status, $d] = $this->call('gast', $action, $body, $id);
            $this->assertSame([403, 'forbidden'], [$status, $d['error']], "gast $action");
        }
        $this->assertSame($before, $this->h->rows(), 'the table is unchanged');
    }

    public function testAk3BobGets403OnTheAdminRoutes(): void {
        $c = $this->seed('admin', 'C', 1000);
        $a = $this->seed('bob', 'A', 2000);
        $before = $this->h->rows();
        foreach ([['update', ['name' => 'X'], $c], ['adopt', [], $a], ['review', [], null]] as [$action, $body, $id]) {
            [$status, $d] = $this->call('bob', $action, $body, $id);
            $this->assertSame([403, 'forbidden'], [$status, $d['error']], "bob $action");
        }
        $this->assertSame(403, $this->call('gast', 'review')[0]);
        $this->assertSame($before, $this->h->rows());
    }

    public function testAk3TheOrders(): void {
        $a = $this->seed('bob', 'A', 1000, 'erster');
        $b = $this->seed('bob', 'B', 3000);
        $x = $this->seed('alice', 'X', 2000);
        $c = $this->seed('admin', 'C', 1500);
        $d = $this->seed('admin', 'D', 2500);
        $this->assertSame([$b, $a], array_column($this->list('bob')['pending'], 'id'), 'own suggestions newest first');
        $this->assertSame([$d, $c], array_column($this->list('bob')['templates'], 'id'), 'adopted ones last adopted first');
        $review = $this->call('admin', 'review')[1];
        $this->assertSame([$a, $x, $b], array_column($review['suggestions'], 'id'), 'route 34: suggestions oldest first');
        $this->assertSame(['id' => $a, 'name' => 'A', 'note' => 'erster', 'sketch' => self::SKETCH, 'by' => 'Bob Berg', 'created' => 1000], $review['suggestions'][0]);
        $this->assertSame([$d, $c], array_column($review['templates'], 'id'));
        $this->assertSame(['id' => $d, 'name' => 'D', 'sketch' => self::SKETCH, 'adopted' => 2500], $review['templates'][0]);
        // adopting now puts A first (last adopted)
        $this->assertSame(200, $this->call('admin', 'adopt', [], $a)[0]);
        $this->assertSame([$a, $d, $c], array_column($this->list('alice')['templates'], 'id'));
        // `by` falls back to the uid of a gone account
        $this->h->deleted = ['alice'];
        $this->assertSame('alice', $this->call('admin', 'review')[1]['suggestions'][0]['by']);
    }

    // ---- AK4 ----------------------------------------------------------------------

    public function testAk4EveryRefusedCreateWritesNothing(): void {
        $this->seed('bob', 'Vorhanden', 1);
        $before = $this->rowCount();
        $long = json_encode(['knorke' => 1, 'kind' => 'board', 'title' => str_repeat('x', TemplateStore::MAX_BYTES), 'origin' => [0, 0], 'items' => [['t' => 'sticky']]]);
        $many = json_encode(['knorke' => 1, 'kind' => 'board', 'title' => '', 'origin' => [0, 0], 'items' => array_fill(0, 1001, ['t' => 'sticky'])]);
        $doc = static fn (array $o): string => json_encode($o + ['knorke' => 1, 'kind' => 'board', 'title' => '', 'origin' => [0, 0], 'items' => [['t' => 'sticky']]]);
        $cases = [
            'empty name' => [['name' => ''], 400, 'name_required'],
            'only spaces' => [['name' => "   \u{00A0} "], 400, 'name_required'],
            'no name' => [['name' => null], 400, 'name_required'],
            '101 characters' => [['name' => str_repeat('ä', 101)], 400, 'bad_request'],
            'a control character' => [['name' => "Re\u{0007}tro"], 400, 'bad_request'],
            'a name that is no text' => [['name' => ['Retro']], 400, 'bad_request'],
            'a note of 201 characters' => [['note' => str_repeat('ö', 201)], 400, 'bad_request'],
            'a note with a line break' => [['note' => "zwei\nZeilen"], 400, 'bad_request'],
            'a note that is no text' => [['note' => 5], 400, 'bad_request'],
            'a foreign body key' => [['owner' => 'bob'], 400, 'bad_request'],
            'the old key scope' => [['scope' => 'shared'], 400, 'bad_request'],
            'content no string' => [['content' => ['knorke' => 1]], 400, 'bad_request'],
            'content no JSON' => [['content' => '{"knorke": 1,'], 400, 'bad_request'],
            'content a list' => [['content' => '[1]'], 400, 'bad_request'],
            'knorke 2' => [['content' => $doc(['knorke' => 2])], 400, 'bad_request'],
            "kind 'x'" => [['content' => $doc(['kind' => 'x'])], 400, 'bad_request'],
            'title no string' => [['content' => $doc(['title' => 5])], 400, 'bad_request'],
            'empty items' => [['content' => $doc(['items' => []])], 400, 'bad_request'],
            'items an object' => [['content' => $doc(['items' => ['a' => 1]])], 400, 'bad_request'],
            'more than 2 MiB' => [['content' => $long], 413, 'too_large'],
            '1001 items' => [['content' => $many], 413, 'too_large'],
            '41 sketch entries' => [['sketch' => array_fill(0, 41, [1, 1, 1, 1, ''])], 400, 'bad_request'],
            'x 121' => [['sketch' => [[121, 0, 1, 1, '']]], 400, 'bad_request'],
            'y 81' => [['sketch' => [[0, 81, 1, 1, '']]], 400, 'bad_request'],
            'w -1' => [['sketch' => [[0, 0, -1, 1, '']]], 400, 'bad_request'],
            "fill 'red'" => [['sketch' => [[0, 0, 1, 1, 'red']]], 400, 'bad_request'],
            'an entry of 4' => [['sketch' => [[0, 0, 1, 1]]], 400, 'bad_request'],
            'a number as text' => [['sketch' => [['1', 0, 1, 1, '']]], 400, 'bad_request'],
            'no sketch' => [['sketch' => null], 400, 'bad_request'],
        ];
        $this->assertGreaterThan(TemplateStore::MAX_BYTES, strlen($long));
        foreach (['bob', 'admin'] as $uid) {
            foreach ($cases as $label => [$change, $status, $code]) {
                $body = array_filter(array_merge(self::body('Retro', 'Satz'), $change), static fn ($v): bool => $v !== null);
                [$s, $d] = $this->call($uid, 'create', $body);
                $this->assertSame([$status, $code], [$s, $d['error'] ?? null], "$uid: $label");
                $this->assertSame($before, $this->rowCount(), "$uid, $label: no new row");
            }
        }
        $this->assertCount(2, $this->h->bell, 'only the seed notified (two admins)');
    }

    public function testAk4TheEleventhOpenSuggestionIs409(): void {
        for ($i = 0; $i < 10; $i++) {
            $this->assertSame(201, $this->call('bob', 'create', self::body('B' . $i))[0]);
        }
        $this->seed('alice', 'Alices', 1);
        $before = $this->h->rows();
        [$status, $data] = $this->call('bob', 'create', self::body('B10'));
        $this->assertSame(409, $status);
        $this->assertSame(['error' => 'suggestion_limit', 'message' => 'You have reached the most open template suggestions an account may have.', 'max' => 10], $data);
        $this->assertSame($before, $this->h->rows(), 'nothing written');
        $this->assertSame(201, $this->call('alice', 'create', self::body('A2'))[0], 'another account still suggests');
        // withdrawing one makes room
        $first = $this->list('bob')['pending'][9]['id'];
        $this->assertSame(200, $this->call('bob', 'destroy', [], $first)[0]);
        $this->assertSame(201, $this->call('bob', 'create', self::body('B10'))[0], 'after a withdrawal the next goes through');
        $this->assertSame(409, $this->call('bob', 'create', self::body('B11'))[0]);
        // an adopted suggestion no longer counts
        $this->assertSame(200, $this->call('admin', 'adopt', [], $this->list('bob')['pending'][0]['id'])[0]);
        $this->assertSame(201, $this->call('bob', 'create', self::body('B12'))[0]);
        // admins have no limit
        for ($i = 0; $i < 12; $i++) {
            [$status, $data] = $this->call('admin', 'create', self::body('C' . $i));
            $this->assertSame([201, 'adopted'], [$status, $data['state']]);
        }
        $this->assertCount(13, $this->list('alice')['templates']);
    }

    public function testAk4WithoutFourByteTextAnEmojiBecomesTheReplacementCharacter(): void {
        $this->h->sql->fourByte = false;
        $content = self::content(1, 'Hallo 😀');
        [$status, $data] = $this->call('bob', 'create', ['name' => 'Retro 😀', 'note' => 'Satz 🎉', 'content' => $content, 'sketch' => self::SKETCH]);
        $this->assertSame(201, $status);
        $row = $this->row($data['id']);
        $this->assertSame(["Retro \u{FFFD}", "Satz \u{FFFD}"], [$row['name'], $row['note']]);
        $this->assertSame(str_replace('😀', "\u{FFFD}", $content), $row['content']);
        $this->assertStringNotContainsString('😀', $row['content']);
        $c = $this->call('admin', 'create', self::body('C'))[1]['id'];
        $this->assertSame([200, ['id' => $c, 'name' => "C \u{FFFD}"]], $this->call('admin', 'update', ['name' => 'C 🎉'], $c), 'renaming too');
        $this->h->sql->fourByte = true;
        $d = $this->call('bob', 'create', ['name' => 'Retro 😀', 'content' => $content, 'sketch' => self::SKETCH])[1]['id'];
        $this->assertSame('Retro 😀', $this->row($d)['name'], 'with 4-byte text it stays');
        $this->assertNull($this->row($d)['note'], 'no note: NULL');
    }

    // ---- AK5 ----------------------------------------------------------------------

    public function testAk5AdoptAndRename(): void {
        $a = $this->seed('bob', 'A', 1000, 'Für Retros');
        $this->assertSame(['admin template_suggested ' . $a, 'root template_suggested ' . $a], $this->h->bellOf());
        [$status, $data] = $this->call('admin', 'adopt', [], $a);
        $this->assertSame([200, ['id' => $a]], [$status, $data]);
        $row = $this->row($a);
        $this->assertSame(['adopted', 'A', null, null], [$row['state'], $row['name'], $row['note'], $row['suggested_by']]);
        $this->assertGreaterThan(1000, (int)$row['adopted_at']);
        $this->assertSame(['bob template_adopted ' . $a], $this->h->bellOf(), 'the admins\' notifications are done, bob is told');
        $this->assertSame(['name' => 'A'], $this->h->bell[0][4]);
        $this->assertSame([404, 'not_found'], [$this->call('admin', 'adopt', [], $a)[0], $this->call('root', 'adopt', [], $a)[1]['error']], 'a second adopt');
        $this->assertSame(1, count($this->h->bellOf('bob')), 'no second notification');
        $this->assertSame(['id' => $a, 'name' => 'A', 'sketch' => self::SKETCH], $this->list('alice')['templates'][0]);
        $this->assertSame([], $this->list('bob')['pending']);

        // rename
        $this->assertSame([200, ['id' => $a, 'name' => 'A neu']], $this->call('admin', 'update', ['name' => '  A neu '], $a));
        $this->assertSame('A neu', $this->list('alice')['templates'][0]['name']);
        $b = $this->seed('bob', 'B', 2000);
        $this->assertSame([404, 'not_found'], [$this->call('admin', 'update', ['name' => 'X'], $b)[0], $this->call('admin', 'update', ['name' => 'X'], $b)[1]['error']], 'a pending one is not renamed');
        $this->assertSame('B', $this->row($b)['name']);
        foreach ([[[], 'name_required'], [['name' => ''], 'name_required'], [['name' => str_repeat('x', 101)], 'bad_request'], [['name' => 'X', 'note' => 'y'], 'bad_request']] as [$body, $code]) {
            $this->assertSame([400, $code], [$this->call('admin', 'update', $body, $a)[0], $this->call('admin', 'update', $body, $a)[1]['error']], json_encode($body));
        }
        $this->assertSame('A neu', $this->row($a)['name']);
    }

    public function testAk5RejectAndWithdraw(): void {
        $b = $this->seed('bob', 'B', 1000);
        $w = $this->seed('bob', 'W', 2000);
        $this->assertSame([200, ['deleted' => true]], $this->call('admin', 'destroy', [], $b), 'an admin rejects');
        $this->assertNull($this->row($b), 'B is deleted');
        $this->assertSame(['bob template_rejected ' . $b], $this->h->bellOf('bob'));
        $this->assertSame(['name' => 'B'], $this->h->stored('bob', $b, TemplateNotifications::REJECTED)->getSubjectParameters());
        $this->assertSame(['admin template_suggested ' . $w, 'root template_suggested ' . $w], array_values(array_filter($this->h->bellOf(), static fn (string $x): bool => str_contains($x, 'suggested'))));

        $this->assertSame([200, ['deleted' => true]], $this->call('bob', 'destroy', [], $w), 'bob withdraws');
        $this->assertNull($this->row($w));
        $this->assertSame(['bob template_rejected ' . $b], $this->h->bellOf(), 'withdrawing notifies nobody, the admins\' notifications are done');
        $this->assertSame(404, $this->call('bob', 'destroy', [], $w)[0], 'gone');
    }

    public function testAk5ForeignRows(): void {
        $x = $this->seed('alice', 'X', 1000);
        $c = $this->seed('admin', 'C', 2000);
        [$status, $d] = $this->call('bob', 'destroy', [], $x);
        $this->assertSame([404, 'not_found'], [$status, $d['error']], 'a foreign suggestion is 404 (nobody learns it exists)');
        [$status, $d] = $this->call('bob', 'destroy', [], $c);
        $this->assertSame([403, 'forbidden'], [$status, $d['error']], 'an adopted template is 403 for a non-admin');
        $this->assertNotNull($this->row($x));
        $this->assertNotNull($this->row($c));
        $this->assertSame([200, ['deleted' => true]], $this->call('root', 'destroy', [], $c), 'an admin deletes an adopted one');
        $this->assertNull($this->row($c));
        $this->assertSame(['id' => $x], $this->call('root', 'adopt', [], $x)[1], 'any admin decides');
    }

    // ---- AK7 ----------------------------------------------------------------------

    public function testAk7ADeletedAccountThroughTheListener(): void {
        $kept = $this->seed('bob', 'Übernommen', 1000);
        $this->call('admin', 'adopt', [], $kept);
        $p1 = $this->seed('bob', 'P1', 2000);
        $p2 = $this->seed('bob', 'P2', 3000);
        $x = $this->seed('alice', 'X', 4000);
        $adopted = $this->row($kept);
        $this->listener()->handle(new UserDeletedEvent($this->h->user('bob')));
        $this->assertSame([], $this->errors);
        $this->assertNull($this->row($p1));
        $this->assertNull($this->row($p2));
        $this->assertSame($adopted, $this->row($kept), 'the adopted template stays unchanged');
        $this->assertNotNull($this->row($x), 'alice\'s suggestion stays');
        $this->assertSame(['bob template_adopted ' . $kept, 'admin template_suggested ' . $x, 'root template_suggested ' . $x], $this->h->bellOf(), 'the admins\' notifications of P1 and P2 are done');
        // a new account bob
        $this->assertSame([], $this->list('bob')['pending']);
        $this->assertSame([$kept], array_column($this->list('bob')['templates'], 'id'));
    }

    public function testAk7TheTemplatePartAndTheOtherPartsDoNotStopEachOther(): void {
        $this->h->names['dora'] = 'Dora Dach';
        $p = $this->seed('dora', 'Dora', 1000);
        // the template part throws: the boards are cleaned up all the same
        $h = new AccessHarness();
        $board = $h->service->create('dora', 'D')['id'];
        $broken = (new \ReflectionClass(TemplateStore::class))->newInstanceWithoutConstructor();
        $this->listener($h, $broken)->handle(new UserDeletedEvent(Fake::of(IUser::class, ['getUID' => fn () => 'dora'])));
        $this->assertArrayNotHasKey($board, $h->boards->boards, 'the boards went');
        $this->assertSame(['Knorke: cleaning up the templates of a deleted account failed'], $this->errors, 'logged, not thrown');
        $this->assertNotNull($this->row($p));
        // the board part throws: the templates are cleaned up all the same
        $brokenBoards = (new \ReflectionClass(BoardService::class))->newInstanceWithoutConstructor();
        $this->errors = [];
        $this->listener(null, null, $brokenBoards)->handle(new UserDeletedEvent(Fake::of(IUser::class, ['getUID' => fn () => 'dora'])));
        $this->assertSame(['Knorke: cleaning up a deleted account failed'], $this->errors);
        $this->assertNull($this->row($p), 'dora\'s suggestion went');
    }

    /** The listener over this test's templates; its errors go to $this->errors. */
    private function listener(?AccessHarness $h = null, ?TemplateStore $templates = null, ?BoardService $boards = null): UserDeletedListener {
        $h ??= new AccessHarness();
        $logger = Fake::of(LoggerInterface::class, ['error' => function ($m, array $c = []): void {
            $this->errors[] = (string)$m;
        }]);
        return new UserDeletedListener($boards ?? $h->service, (new VoteHarness())->votes, $h->access, $logger, (new SyncHarness())->sync, $templates ?? $this->h->store);
    }
}
