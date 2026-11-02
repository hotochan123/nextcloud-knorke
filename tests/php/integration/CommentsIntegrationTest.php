<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Db\CommentMentionStore;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\CommentService;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\Comments\ICommentsManager;
use OCP\Server;

/**
 * Comments (factory job 189) on the real database of the dev stack, through
 * Nextcloud's own comment manager: the rows in oc_comments (object, verb,
 * actor, parent, meta_data under `knorke`), meta.comments and meta_rev in
 * the board's transaction, 4-byte text on this database kind, deleting a
 * thread row by row and the comments going with the board.
 */
final class CommentsIntegrationTest extends IntegrationCase {
    private CommentService $comments;

    protected function setUp(): void {
        parent::setUp();
        $this->comments = Server::get(CommentService::class);
    }

    protected function tearDown(): void {
        foreach ($this->created as $b) {
            $this->db->executeStatement('DELETE FROM *PREFIX*comments WHERE object_type = ? AND object_id = ?', ['knorke_board', (string)$b]);
        }
        parent::tearDown();
    }

    /** @return list<array<string, mixed>> the comment rows of a board, by id */
    private function rows(int $b): array {
        return $this->db->executeQuery('SELECT id, parent_id, topmost_parent_id, actor_type, actor_id, verb, message, meta_data FROM *PREFIX*comments'
            . ' WHERE object_type = ? AND object_id = ? ORDER BY id', ['knorke_board', (string)$b])->fetchAllAssociative();
    }

    /** @return array{0: array, 1: int} [meta, meta_rev] of the board row */
    private function meta(int $b): array {
        $r = $this->db->executeQuery('SELECT meta, meta_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$b])->fetchAssociative();
        return [MetaService::decode($r['meta'] === null ? null : (string)$r['meta']), (int)$r['meta_rev']];
    }

    public function testThreadsLiveInNextcloudsCommentTableAndCountInMeta(): void {
        $b = $this->board();
        $owner = $this->owner($b);
        [, $rev0] = $this->meta($b);
        $t = $this->comments->create($owner, $b, ['text' => 'Erster 👍', 'x' => 10.5, 'y' => -3, 'item' => null], '127.0.0.1', self::nowMs())['thread'];
        $this->comments->create($this->guest($b), $b, ['text' => 'Antwort', 'thread' => $t['id']], '127.0.0.1', self::nowMs());
        $rows = $this->rows($b);
        $this->assertCount(2, $rows);
        $this->assertSame(['0', 'users', $this->uid, 'comment'], [(string)$rows[0]['parent_id'], $rows[0]['actor_type'], $rows[0]['actor_id'], $rows[0]['verb']]);
        $this->assertSame([(string)$rows[0]['id'], 'knorke_guests', 'gITGUEST0001'], [(string)$rows[1]['parent_id'], $rows[1]['actor_type'], $rows[1]['actor_id']]);
        $k = json_decode((string)$rows[0]['meta_data'], true)['knorke'] ?? null;
        $this->assertSame(['item' => null, 'resolved' => false], ['item' => $k['item'], 'resolved' => $k['resolved']]);
        $this->assertSame('Gina', json_decode((string)$rows[1]['meta_data'], true)['knorke']['name'] ?? null);
        $want = $this->db->supports4ByteText() ? 'Erster 👍' : "Erster \u{FFFD}";
        $this->assertSame($want, $rows[0]['message'], self::dbKind() . ': 4-byte text or its replacement');
        [$meta, $rev] = $this->meta($b);
        $this->assertSame([2, $rev0 + 2], [$meta['comments'] ?? null, $rev], 'meta.comments and meta_rev + 1 per write');
        $this->assertSame($rev, $this->cache->getRev($b), 'bumpRev after the COMMIT');
        // resolving twice writes once
        $this->comments->update($owner, $b, ['comment' => $t['id'], 'resolved' => true], '127.0.0.1', self::nowMs());
        $this->comments->update($owner, $b, ['comment' => $t['id'], 'resolved' => true], '127.0.0.1', self::nowMs());
        $this->assertSame([3, $rev + 1], [$this->meta($b)[0]['comments'], $this->meta($b)[1]]);
        $read = $this->comments->threads($this->guest($b), $b)['threads'];
        $this->assertSame([true, 2], [$read[0]['resolved'], count($read[0]['comments'])]);
        // the first comment takes its replies with it
        $out = $this->comments->delete($owner, $b, $t['id'], '127.0.0.1', self::nowMs());
        $this->assertCount(2, $out['deleted']);
        $this->assertSame([], $this->rows($b));
    }

    public function testTheCommentsGoWithTheBoard(): void {
        $b = $this->board();
        $this->comments->create($this->owner($b), $b, ['text' => 'Bleibt nicht', 'x' => 0, 'y' => 0], '127.0.0.1', self::nowMs());
        $this->assertCount(1, $this->rows($b));
        Server::get(BoardService::class)->delete($this->uid, $b);
        $this->assertSame([], $this->rows($b), 'deleteCommentsAtObject in the delete transaction');
    }

    /** A stored comment on $b with the knorke meta mentions $uids (no checks: the store is the subject). */
    private function seed(int $b, string $message, array $uids): string {
        $m = Server::get(ICommentsManager::class);
        $c = $m->create('users', $this->uid, 'knorke_board', (string)$b);
        $c->setVerb('comment');
        $c->setParentId('0');
        $c->setMessage($message, 0);
        $c->setCreationDateTime(new \DateTime());
        $c->setMetaData(['knorke' => ['name' => null, 'edited' => null, 'mentions' => $uids]]);
        $m->save($c);
        return $c->getId();
    }

    public function testTheMentionsOfADeletedAccountAreFoundAndRewrittenOnThisDatabase(): void {
        // factory job 249, AK4: a LIKE wildcard (_) and . @ in the uid (Nextcloud's uid characters)
        $b = $this->board();
        $odd = 'it_a.b@c';
        $hit = $this->seed($b, 'For @"' . $odd . '" and @"itbob"', [$odd, 'itbob']);
        $near = $this->seed($b, 'For @"itxa.b@c"', ['itxa.b@c']);
        $plain = $this->seed($b, 'it_a.b@c as text', []);
        $found = Server::get(CommentMentionStore::class)->mentioning($odd);
        $this->assertSame([$b => [$hit]], array_intersect_key($found, [$b => true]), self::dbKind() . ': only the comment that stores the uid');
        $this->assertSame([], array_intersect_key(Server::get(CommentMentionStore::class)->mentioning('it_a'), [$b => true]), 'a prefix is not the uid');
        [, $rev] = $this->meta($b);
        $this->assertSame(1, $this->comments->onUserDeleted($odd));
        $rows = array_column($this->rows($b), null, 'id');
        $this->assertSame('For @"deleted_users" and @"itbob"', $rows[$hit]['message']);
        $this->assertSame(['itbob'], json_decode((string)$rows[$hit]['meta_data'], true)['knorke']['mentions']);
        $this->assertSame(['For @"itxa.b@c"', 'it_a.b@c as text'], [$rows[$near]['message'], $rows[$plain]['message']]);
        [, $rev2] = $this->meta($b);
        $this->assertSame([$rev + 1, $rev2], [$rev2, $this->cache->getRev($b)], 'meta_rev + 1, bumpRev after the COMMIT');
        $this->assertSame(0, $this->comments->onUserDeleted($odd));
    }
}
