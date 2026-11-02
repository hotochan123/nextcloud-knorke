<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\BoardApiController;
use OCA\Knorke\Service\BoardMarks;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Factory job 219: favorites and "last opened" of the board list, per
 * account in Nextcloud's user preferences (BoardMarks), routes 55–56 and the
 * two fields of route 5.
 */
final class BoardMarksTest extends TestCase {
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'A')['id'];
    }

    private function request(array $route, ?array $body = null): IRequest {
        $params = array_merge($route, $body ?? []);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? '10' : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'getRemoteAddress' => fn (): string => '10.0.0.1',
        ], ['urlParams' => $route]);
    }

    private function api(int $id, ?array $body): BoardApiController {
        $session = Fake::of(IUserSession::class, ['getUser' => fn () => $this->h->uid === null ? null : $this->h->user($this->h->uid)]);
        return new BoardApiController($this->request(['id' => (string)$id], $body), $this->h->service, $session, Fake::of(ILimiter::class),
            PageControllerTest::limits(), Fake::of(LoggerInterface::class), $this->h->sketches());
    }

    /** @return array{0: int, 1: mixed} [status, data] */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), $r->getData()];
    }

    /** @return list<string> the writing IUserConfig calls so far */
    private function writes(): array {
        return array_values(array_filter($this->h->prefCalls, static fn (string $c): bool => !str_starts_with($c, 'getValues ')));
    }

    private function row(string $uid, int $board): array {
        foreach ($this->h->service->listFor($uid) as $x) {
            if ($x['id'] === $board) {
                return $x;
            }
        }
        $this->fail("board $board not in the list of $uid");
    }

    public function testAk1StarsBelongToEachAccountAndAreLazy(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->assertSame([false, null], [$this->row('alice', $this->b)['favorite'], $this->row('alice', $this->b)['openedAt']], 'nothing stored yet');
        [$status, $data] = self::out($this->api($this->b, ['favorite' => true])->favorite($this->b));
        $this->assertSame([200, ['favorite' => true]], [$status, $data]);
        $this->assertSame(["setValueBool alice knorke fav_{$this->b} true lazy"], $this->writes(), 'one key per board, lazy');
        $this->assertTrue($this->row('alice', $this->b)['favorite']);
        $this->assertFalse($this->row('bob', $this->b)['favorite'], 'stars belong to each account');
        // A viewer may star too.
        $this->h->uid = 'bob';
        $this->assertSame([200, ['favorite' => true]], self::out($this->api($this->b, ['favorite' => true])->favorite($this->b)));
        $this->assertTrue($this->row('bob', $this->b)['favorite']);
        // Unstarring deletes the key.
        $this->h->uid = 'alice';
        $this->assertSame([200, ['favorite' => false]], self::out($this->api($this->b, ['favorite' => false])->favorite($this->b)));
        $this->assertArrayNotHasKey("fav_{$this->b}", $this->h->prefs['alice'] ?? []);
        $this->assertSame("deleteUserConfig alice knorke fav_{$this->b}", $this->writes()[2]);
        $this->assertFalse($this->row('alice', $this->b)['favorite']);
        $this->assertTrue($this->row('bob', $this->b)['favorite']);
    }

    public function testAk1TwoBoardsStarredAtOnceBothStay(): void {
        $c = $this->h->service->create('alice', 'C')['id'];
        // Two devices: each request writes only its own key, no list is read and rewritten.
        $this->h->service->setFavorite('alice', $this->b, true);
        $this->h->service->setFavorite('alice', $c, true);
        $this->assertSame([], array_values(array_filter($this->h->prefCalls, static fn (string $s): bool => str_starts_with($s, 'getValues '))), 'starring reads nothing');
        $this->assertSame([true, true], [$this->row('alice', $this->b)['favorite'], $this->row('alice', $c)['favorite']]);
    }

    public function testAk2NoAccessIsAnUnknownBoardAndWritesNothing(): void {
        $this->h->uid = 'erin';
        [$status, $stranger] = self::out($this->api($this->b, ['favorite' => true])->favorite($this->b));
        [$status2, $unknown] = self::out($this->api(999, ['favorite' => true])->favorite(999));
        $this->assertSame([404, 404, 'not_found'], [$status, $status2, $stranger['error']]);
        $this->assertSame($unknown, $stranger, 'same body: no hint that the board exists');
        [$s3, $o1] = self::out($this->api($this->b, [])->opened($this->b));
        [$s4, $o2] = self::out($this->api(999, [])->opened(999));
        $this->assertSame([404, 404], [$s3, $s4]);
        $this->assertSame($o2, $o1);
        $this->assertSame([], $this->writes(), 'nothing written');
        // Bad bodies.
        $this->h->uid = 'alice';
        $this->assertSame(400, self::out($this->api($this->b, ['favorite' => 'yes'])->favorite($this->b))[0]);
        $this->assertSame(400, self::out($this->api($this->b, [])->favorite($this->b))[0], 'favorite is required');
        $this->assertSame(400, self::out($this->api($this->b, ['favorite' => true, 'x' => 1])->favorite($this->b))[0]);
        $this->assertSame(400, self::out($this->api($this->b, ['at' => 5])->opened($this->b))[0]);
        $this->assertSame([], $this->writes());
        // Not signed in.
        $this->h->uid = null;
        $this->assertSame(401, self::out($this->api($this->b, ['favorite' => true])->favorite($this->b))[0]);
        $this->assertSame(401, self::out($this->api($this->b, [])->opened($this->b))[0]);
        $this->assertSame([], $this->writes());
    }

    public function testAk3OpenedKeepsTheNewest200AndTheListReadsOnce(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->uid = 'bob';
        [$status, $data] = self::out($this->api($this->b, [])->opened($this->b));
        $this->assertSame([200, ['openedAt' => $this->h->nowMs()]], [$status, $data], 'server time in ms');
        $this->assertContains("setValueInt bob knorke opened_{$this->b} {$this->h->nowMs()} lazy", $this->h->prefCalls);
        $this->assertSame($this->h->nowMs(), $this->row('bob', $this->b)['openedAt']);
        $this->assertNull($this->row('alice', $this->b)['openedAt'], 'per account');
        // 200 older openings stored: the next one drops the oldest.
        for ($i = 1; $i <= BoardMarks::MAX_OPENED; $i++) {
            $this->h->prefs['carol']['opened_' . (5000 + $i)] = [1000 + $i, true];
        }
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->uid = 'carol';
        $this->h->time += 60;
        $this->h->service->markOpened('carol', $this->b);
        $keys = array_keys(array_filter($this->h->prefs['carol'], static fn (string $k): bool => str_starts_with($k, 'opened_'), ARRAY_FILTER_USE_KEY));
        $this->assertCount(200, $keys);
        $this->assertNotContains('opened_5001', $keys, 'the oldest went');
        $this->assertContains('opened_5002', $keys);
        $this->assertContains("opened_{$this->b}", $keys, 'the new one stays');
        // One read of the preferences per list, however many boards.
        for ($i = 0; $i < 5; $i++) {
            $this->h->service->create('alice', 'More ' . $i);
        }
        $this->h->prefCalls = [];
        $this->assertCount(6, $this->h->service->listFor('alice'));
        $this->assertSame(['getValues alice knorke '], $this->h->prefCalls);
    }

    public function testAk4ADeletedBoardTakesItsMarksAlong(): void {
        $this->h->shareRows->add($this->b, 'user', 'bob', 'edit');
        $this->h->service->setFavorite('alice', $this->b, true);
        $this->h->service->markOpened('alice', $this->b);
        $this->h->uid = 'bob';
        $this->h->service->setFavorite('bob', $this->b, true);
        $this->h->uid = 'alice';
        $this->h->service->delete('alice', $this->b);
        $this->assertContains("deleteKey knorke fav_{$this->b}", $this->h->prefCalls);
        $this->assertContains("deleteKey knorke opened_{$this->b}", $this->h->prefCalls);
        $this->assertSame([], $this->h->prefs['bob'], 'of every account');
        $this->assertSame([], $this->h->prefs['alice']);
        // Deleting an account deletes its boards and their marks.
        $c = $this->h->service->create('alice', 'C')['id'];
        $this->h->prefCalls = [];
        $this->h->service->onUserDeleted('alice');
        $this->assertSame(["deleteKey knorke fav_$c", "deleteKey knorke opened_$c"], $this->h->prefCalls);
    }
}
