<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OC\Comments\Comment;
use OCA\Knorke\Controller\CommentApiController;
use OCA\Knorke\Controller\PublicCommentController;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Routes 35–43 (factory job 189, AK2) through both controllers on the
 * in-memory rights of AccessHarness: who reads and who writes (view reads
 * only, guests of both links write), own and foreign comments, moderators,
 * strangers (404), a guest token of another board (401), a comment id of
 * another board (404), the errors of the spec (comment_empty,
 * comment_too_long, thread_resolved, comments_full, slow_down), the guards
 * of the public routes (cross_site, the body gate) and the @ list.
 */
final class CommentRoutesTest extends TestCase {
    private const N = '01JA00000000000000000000N1';

    private AccessHarness $h;
    private int $b;
    private int $other;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'Retro')['id'];
        $this->other = $this->h->service->create('alice', 'Other')['id'];
        $this->h->items->addBoard($this->b);
        $this->h->items->seed($this->b, self::N, ['t' => 'sticky'], 1);
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'erin', 'moderate');
    }

    /** @param array<string, string> $headers */
    private function request(int $board, ?array $body = null, array $query = [], array $headers = []): IRequest {
        $route = ['id' => (string)$board, '_route' => 'x'];
        $params = array_merge($route, $query, $body ?? []);
        $headers = array_change_key_case($headers + ['Content-Length' => '10'], CASE_LOWER);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => $headers[strtolower($name)] ?? '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'getRemoteAddress' => fn (): string => '10.0.0.9',
        ], ['urlParams' => $route]);
    }

    private function api(?string $uid, int $board, ?array $body = null, array $query = []): CommentApiController {
        $this->h->uid = $uid;
        return new CommentApiController($this->request($board, $body, $query), Fake::of(LoggerInterface::class), $this->h->access, $this->h->commentService);
    }

    private function pub(string $token, int $board, ?array $body = null, array $query = [], bool $xhr = true): PublicCommentController {
        $headers = ['X-Knorke-Guest' => $token] + ($xhr ? ['X-Requested-With' => 'XMLHttpRequest'] : []);
        return new PublicCommentController($this->request($board, $body, $query, $headers), Fake::of(LoggerInterface::class), $this->h->access, $this->h->commentService);
    }

    /** @return array{0: int, 1: mixed} */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), json_decode($r->render(), true)];
    }

    /** [status, error code or null] */
    private static function code(Response $r): array {
        [$status, $data] = self::out($r);
        return [$status, $data['error'] ?? null];
    }

    private function post(string $uid, array $body, ?int $board = null): array {
        return self::out($this->api($uid, $board ?? $this->b, $body)->create($board ?? $this->b));
    }

    private function newThread(string $uid, string $text = 'Hello'): string {
        [$status, $data] = $this->post($uid, ['text' => $text, 'x' => 10, 'y' => 20, 'item' => self::N]);
        $this->assertSame(201, $status, json_encode($data));
        return $data['thread']['id'];
    }

    public function testViewReadsButDoesNotWrite(): void {
        $t = $this->newThread('alice');
        [$status, $data] = self::out($this->api('bob', $this->b)->index($this->b));
        $this->assertSame(200, $status);
        $this->assertSame($t, $data['threads'][0]['id']);
        $this->assertSame([403, 'forbidden'], self::code($this->api('bob', $this->b, ['text' => 'x', 'x' => 1, 'y' => 1])->create($this->b)));
        $this->assertSame([403, 'forbidden'], self::code($this->api('bob', $this->b, ['text' => 'x', 'thread' => $t])->create($this->b)));
        $this->assertSame([403, 'forbidden'], self::code($this->api('bob', $this->b, ['comment' => $t, 'resolved' => true])->update($this->b)));
        $this->assertSame([403, 'forbidden'], self::code($this->api('bob', $this->b, null, ['comment' => $t])->destroy($this->b)));
        $this->assertSame([403, 'forbidden'], self::code($this->api('bob', $this->b, null, ['q' => ''])->mentions($this->b)), 'route 39 needs the right to write');
    }

    public function testGuestsOfBothLinksWriteAndReplies(): void {
        $vote = $this->h->token($this->b, 1, 'vote', 'gVOTE0000001');
        [$status, $data] = self::out($this->pub($vote, $this->b, ['text' => 'From the voting link', 'x' => 1, 'y' => 2])->create($this->b));
        $this->assertSame(201, $status);
        $t = $data['thread']['id'];
        $this->assertSame(['From the voting link'], $data['thread']['comments'][0]['parts']);
        $edit = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        [$status, $data] = self::out($this->pub($edit, $this->b, ['text' => 'Reply', 'thread' => $t])->create($this->b));
        $this->assertSame([201, 2], [$status, count($data['thread']['comments'])]);
        [$status, $data] = self::out($this->pub($edit, $this->b)->index($this->b));
        $this->assertSame([200, [false, true]], [$status, array_column($data['threads'][0]['comments'], 'mine')]);
        $this->assertSame([403, 'cross_site'], self::code($this->pub($edit, $this->b, ['text' => 'x', 'thread' => $t], [], false)->create($this->b)), 'refuseCrossSite before anything');
        $this->assertSame([400, 'bad_request'], self::code($this->pub($edit, $this->b, ['text' => 'x', 'thread' => $t, 'pid' => 'x'])->create($this->b)), 'body gate');
    }

    public function testOwnTextOnlyAndDeletingForeignCommentsNeedsModeration(): void {
        $t = $this->newThread('carol', 'Carol wrote this');
        [, $data] = $this->post('alice', ['text' => 'Alice replies', 'thread' => $t]);
        $reply = $data['thread']['comments'][1]['id'];
        $this->assertSame([403, 'forbidden'], self::code($this->api('alice', $this->b, ['comment' => $t, 'text' => 'Not mine'])->update($this->b)), 'foreign text');
        $guest = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        $this->assertSame([403, 'forbidden'], self::code($this->pub($guest, $this->b, ['comment' => $t, 'text' => 'Not mine'])->update($this->b)), 'a guest neither');
        [$status, $data] = self::out($this->api('carol', $this->b, ['comment' => $t, 'text' => 'Carol edited this'])->update($this->b));
        $this->assertSame([200, ['Carol edited this']], [$status, $data['thread']['comments'][0]['parts']]);
        $this->assertIsInt($data['thread']['comments'][0]['edited']);
        $this->assertSame([403, 'forbidden'], self::code($this->api('carol', $this->b, null, ['comment' => $reply])->destroy($this->b)), 'foreign comment without moderation');
        $this->assertSame([403, 'forbidden'], self::code($this->pub($guest, $this->b, null, ['comment' => $reply])->destroy($this->b)), 'a guest neither');
        [$status, $data] = self::out($this->api('erin', $this->b, null, ['comment' => $reply])->destroy($this->b));
        $this->assertSame([200, ['deleted' => [$reply]]], [$status, $data], 'a share with moderate deletes any comment');
        [$status, $data] = self::out($this->api('alice', $this->b, null, ['comment' => $t])->destroy($this->b));
        $this->assertSame([200, ['deleted' => [$t]]], [$status, $data], 'the owner too');
    }

    public function testStrangersAndForeignTokensAndForeignIds(): void {
        $t = $this->newThread('alice');
        $this->assertSame([404, 'not_found'], self::code($this->api('dave', $this->b)->index($this->b)), 'a stranger reads nothing');
        $this->assertSame([404, 'not_found'], self::code($this->api('dave', $this->b, ['text' => 'x', 'x' => 1, 'y' => 1])->create($this->b)));
        $this->assertSame([404, 'not_found'], self::code($this->api('alice', 999)->index(999)), 'unknown board');
        $foreign = $this->h->token($this->other, 1, 'edit', 'gEDIT0000001');
        $this->assertSame([401, 'guest_token'], self::code($this->pub($foreign, $this->b)->index($this->b)), 'a guest token of another board');
        $this->assertSame([401, 'guest_token'], self::code($this->pub($foreign, $this->b, ['text' => 'x', 'x' => 1, 'y' => 1])->create($this->b)));
        $this->assertSame([401, 'guest_token'], self::code($this->pub('nope', $this->b)->index($this->b)));
        // a comment id of another board
        $this->h->items->addBoard($this->other);
        [, $data] = $this->post('alice', ['text' => 'Elsewhere', 'x' => 1, 'y' => 1], $this->other);
        $elsewhere = $data['thread']['id'];
        $this->assertSame([404, 'not_found'], self::code($this->api('alice', $this->b, ['comment' => $elsewhere, 'resolved' => true])->update($this->b)));
        $this->assertSame([404, 'not_found'], self::code($this->api('alice', $this->b, null, ['comment' => $elsewhere])->destroy($this->b)));
        $this->assertSame([404, 'not_found'], self::code($this->api('alice', $this->b, ['text' => 'x', 'thread' => $elsewhere])->create($this->b)));
        $this->assertSame([404, 'not_found'], self::code($this->api('alice', $this->b, null, ['comment' => '99999'])->destroy($this->b)), 'unknown id');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, null, ['comment' => '0x1'])->destroy($this->b)), 'no id');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, null, [])->destroy($this->b)), 'no comment');
        $this->assertSame($t, self::out($this->api('alice', $this->b)->index($this->b))[1]['threads'][0]['id']);
    }

    public function testTheErrorsOfTheSpec(): void {
        $t = $this->newThread('alice');
        $this->assertSame([400, 'comment_empty'], self::code($this->api('alice', $this->b, ['text' => " \n\t ", 'x' => 1, 'y' => 1])->create($this->b)));
        $this->assertSame([400, 'comment_too_long'], self::code($this->api('alice', $this->b, ['text' => str_repeat('ä', 1001), 'x' => 1, 'y' => 1])->create($this->b)), '1001 characters');
        $this->assertSame(201, self::out($this->api('alice', $this->b, ['text' => str_repeat('ä', 1000), 'x' => 1, 'y' => 1])->create($this->b))[0], '1000 characters');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['text' => 'x', 'x' => 1e8, 'y' => 1])->create($this->b)), 'beyond ±10 000 000');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['text' => 'x', 'x' => '1', 'y' => 1])->create($this->b)), 'x as text');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['text' => 'x', 'y' => 1])->create($this->b)), 'x missing');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['text' => 5, 'x' => 1, 'y' => 1])->create($this->b)), 'text no string');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['text' => 'x', 'x' => 1, 'y' => 1, 'item' => 7])->create($this->b)), 'item no string');
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['comment' => $t, 'resolved' => 'yes'])->update($this->b)));
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['comment' => $t, 'resolved' => true, 'text' => 'x'])->update($this->b)), 'one change at a time');
        $this->assertSame(200, self::out($this->api('alice', $this->b, ['comment' => $t, 'resolved' => true])->update($this->b))[0]);
        $this->assertSame([409, 'thread_resolved'], self::code($this->api('carol', $this->b, ['text' => 'late', 'thread' => $t])->create($this->b)), 'a reply into a resolved thread');
        // a free thread has no spot to move
        [, $data] = $this->post('alice', ['text' => 'free', 'x' => 1, 'y' => 1]);
        $this->assertNull($data['thread']['item']);
        $this->assertSame([400, 'bad_request'], self::code($this->api('alice', $this->b, ['comment' => $data['thread']['id'], 'x' => 3, 'y' => 4])->update($this->b)));
    }

    public function testTheThousandAndFirstCommentAndTheThirtyFirstWrite(): void {
        for ($i = 1; $i <= 1000; $i++) {
            $c = (new Comment())->setActor('users', 'alice')->setObject('knorke_board', (string)$this->b)->setVerb('comment')->setMessage('seed ' . $i);
            $c->setMetaData(['knorke' => ['name' => null, 'edited' => null, 'mentions' => [], 'item' => null, 'x' => 0, 'y' => 0, 'resolved' => false]]);
            $this->h->comments->manager()->save($c);
        }
        $this->assertSame([409, 'comments_full'], self::code($this->api('alice', $this->b, ['text' => 'one too many', 'x' => 1, 'y' => 1])->create($this->b)), 'the 1001st comment');
        $this->h->comments->rows = [];
        $this->h->limiterCalls = [];
        for ($i = 1; $i <= 30; $i++) {
            $this->assertSame(201, self::out($this->api('carol', $this->b, ['text' => "w $i", 'x' => 1, 'y' => 1])->create($this->b))[0], "write $i");
        }
        $r = $this->api('carol', $this->b, ['text' => 'w 31', 'x' => 1, 'y' => 1])->create($this->b);
        [$status, $data] = self::out($r);
        $this->assertSame([429, 'slow_down', 2000], [$status, $data['error'], $data['retryMs']], 'the 31st write within 60 s');
        $this->assertSame('knorke-comment 30 60 carol', $this->h->limiterCalls[0], 'per account, 30 per 60 s');
        // guests: per gid and IP
        $g = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        $this->h->limiterCalls = [];
        self::out($this->pub($g, $this->b, ['text' => 'g', 'x' => 1, 'y' => 1])->create($this->b));
        $this->assertSame(['knorke-comment-gEDIT0000001 30 60 10.0.0.9'], $this->h->limiterCalls);
        $this->h->limiterFull = ['knorke-comment-gEDIT0000001'];
        $this->assertSame([429, 'slow_down'], self::code($this->pub($g, $this->b, ['text' => 'g', 'x' => 1, 'y' => 1])->create($this->b)));
    }

    /** Factory job 251 AK1: route 40 throttles each guest (gid and IP), 120 per 60 s; refused tokens and accounts spend nothing. */
    public function testTheGuestCommentListIsThrottledPerGuest(): void {
        $g1 = $this->h->token($this->b, 1, 'edit', 'gEDIT0000001');
        $g2 = $this->h->token($this->b, 1, 'edit', 'gEDIT0000002');
        $this->h->anonLimits = ['knorke-cmt-gEDIT0000001' => 120, 'knorke-cmt-gEDIT0000002' => 120];
        $this->h->limiterCalls = [];
        $this->assertSame([401, 'guest_token'], self::code($this->pub('nope', $this->b)->index($this->b)));
        $this->assertSame([], $this->h->limiterCalls, 'a refused token spends nothing');
        for ($i = 1; $i <= 120; $i++) {
            $this->assertSame(200, self::out($this->pub($g1, $this->b)->index($this->b))[0], "load $i");
        }
        $this->assertSame('knorke-cmt-gEDIT0000001 120 60 10.0.0.9', $this->h->limiterCalls[0]);
        [$status, $data] = self::out($this->pub($g1, $this->b)->index($this->b));
        $this->assertSame([429, 'slow_down', 500], [$status, $data['error'], $data['retryMs']], 'the 121st load within 60 s');
        $this->assertSame(200, self::out($this->pub($g2, $this->b)->index($this->b))[0], 'another guest keeps its budget');
        $this->h->limiterCalls = [];
        $this->assertSame(200, self::out($this->api('alice', $this->b)->index($this->b))[0]);
        $this->assertSame([], $this->h->limiterCalls, 'accounts are not throttled');
    }

    public function testAnItemThatDoesNotLiveGivesAFreeThread(): void {
        [$status, $data] = $this->post('alice', ['text' => 'gone', 'x' => 7, 'y' => 8, 'item' => '01JA00000000000000000000Z9']);
        $this->assertSame([201, null, 7, 8], [$status, $data['thread']['item'], $data['thread']['x'], $data['thread']['y']]);
    }
}
