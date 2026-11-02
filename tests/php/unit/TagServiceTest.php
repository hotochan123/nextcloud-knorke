<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\TagService;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * The tag list of a board (factory job 191, AK1) through TagService on the
 * in-memory rights of AccessHarness: add (new ids and names only, skipped
 * otherwise, tag_limit without writing), update (tag_gone, tag_exists),
 * delete (an unknown tag writes nothing), a write without effect keeps
 * metaRev, the strict body (400), the rights (owner, edit, the guest of the
 * edit link; vote and view 403) and the budget knorke-tags (429).
 */
final class TagServiceTest extends TestCase {
    private const NOW = 1_760_000_000_123;
    private const IP = '10.0.0.7';

    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'Retro')['id'];
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'vic', 'vote');
    }

    private static function tid(int $n): string {
        return '01JA' . str_pad((string)$n, 22, '0', STR_PAD_LEFT);
    }

    private static function tag(int $n, string $name, string $color = '#F5D76E'): array {
        return ['id' => self::tid($n), 'name' => $name, 'color' => $color];
    }

    private function user(string $uid): Principal {
        $this->h->uid = $uid;
        return $this->h->access->forUser($this->b, true)->principal;
    }

    private function guest(string $role = 'edit', string $gid = 'gAAAAAAAAAAA'): Principal {
        return $this->h->access->forGuest($this->h->token($this->b, 1, $role, $gid), $this->b, true)->principal;
    }

    private function write(Principal $p, array $body): array {
        return $this->h->tagService->write($p, $this->b, $body, self::IP, self::NOW);
    }

    /** @return array{0: array, 1: int} [meta, metaRev] as stored */
    private function stored(): array {
        $row = $this->h->boards->boards[$this->b];
        return [MetaService::decode($row['meta']), $row['meta_rev']];
    }

    /** [status, code] of a write that must fail */
    private function fails(Principal $p, array $body): array {
        try {
            $this->write($p, $body);
        } catch (HttpError $e) {
            return [$e->status, $e->error];
        }
        $this->fail('no error for ' . json_encode($body));
    }

    public function testAddAppendsNewTagsInOrderAndLowerCasesTheColour(): void {
        $out = $this->write($this->user('alice'), ['action' => 'add', 'tags' => [self::tag(1, 'Kosten'), self::tag(2, '  Zeit ', '#A8D8F8')]]);
        [$meta, $rev] = $this->stored();
        $this->assertSame([['id' => self::tid(1), 'name' => 'Kosten', 'color' => '#f5d76e'], ['id' => self::tid(2), 'name' => 'Zeit', 'color' => '#a8d8f8']], $meta['tags']);
        $this->assertSame(['title' => 'Retro', 'meta' => $meta, 'metaRev' => $rev], $out);
        $this->assertGreaterThan(0, $rev);
    }

    public function testAddSkipsTakenIdsAndNamesAndWritesNothingWithoutANewTag(): void {
        $alice = $this->user('alice');
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, 'Kosten')]]);
        [, $rev] = $this->stored();
        $out = $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, 'Other'), self::tag(2, 'KOSTEN'), self::tag(3, 'Neu'), self::tag(4, 'neu')]]);
        [$meta, $rev2] = $this->stored();
        $this->assertSame([self::tid(1), self::tid(3)], array_column($meta['tags'], 'id'), 'the same id, the same name (any case, also one added in the same list) are skipped');
        $this->assertSame(['Kosten', 'Neu'], array_column($meta['tags'], 'name'));
        $this->assertSame($rev + 1, $rev2);
        $this->assertSame($rev2, $out['metaRev']);
        $out = $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, 'Kosten'), self::tag(9, 'kosten')]]);
        $this->assertSame($rev2, $this->stored()[1], 'nothing new: nothing written');
        $this->assertSame($rev2, $out['metaRev'], 'the stored state with the same metaRev');
        $this->assertSame($meta, $out['meta']);
    }

    public function testTheHundredAndFirstTagIsTagLimitAndWritesNothing(): void {
        $alice = $this->user('alice');
        $tags = [];
        for ($i = 1; $i <= 99; $i++) {
            $tags[] = self::tag($i, 'Tag ' . $i);
        }
        $this->write($alice, ['action' => 'add', 'tags' => $tags]);
        [$meta, $rev] = $this->stored();
        $this->assertCount(99, $meta['tags']);
        $this->assertSame([409, 'tag_limit'], $this->fails($alice, ['action' => 'add', 'tags' => [self::tag(200, 'A'), self::tag(201, 'B')]]));
        $this->assertSame([$meta, $rev], $this->stored(), 'nothing written');
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(200, 'A'), self::tag(5, 'Skipped id')]]);
        $this->assertCount(Limits::TAGS_PER_BOARD, $this->stored()[0]['tags'], 'the hundredth fits; a skipped entry does not count');
        $this->assertSame([409, 'tag_limit'], $this->fails($alice, ['action' => 'add', 'tags' => [self::tag(202, 'C')]]));
    }

    public function testUpdateRenamesAndRecoloursWithTagGoneAndTagExists(): void {
        $alice = $this->user('alice');
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, 'Kosten'), self::tag(2, 'Zeit')]]);
        $this->write($alice, ['action' => 'update', 'tag' => self::tid(1), 'name' => 'Budget']);
        $this->write($alice, ['action' => 'update', 'tag' => self::tid(1), 'color' => '#E0218A']);
        [$meta, $rev] = $this->stored();
        $this->assertSame(['id' => self::tid(1), 'name' => 'Budget', 'color' => '#e0218a'], $meta['tags'][0]);
        $this->assertSame([409, 'tag_exists'], $this->fails($alice, ['action' => 'update', 'tag' => self::tid(1), 'name' => 'zeit']));
        $this->assertSame([409, 'tag_gone'], $this->fails($alice, ['action' => 'update', 'tag' => self::tid(7), 'name' => 'zeit']), 'an unknown tag first');
        $this->assertSame([409, 'tag_gone'], $this->fails($alice, ['action' => 'update', 'tag' => self::tid(7), 'color' => '#000000']));
        $this->assertSame($rev, $this->stored()[1]);
        $out = $this->write($alice, ['action' => 'update', 'tag' => self::tid(1), 'name' => 'Budget', 'color' => '#e0218a']);
        $this->assertSame($rev, $out['metaRev'], 'the same values: nothing written');
        $this->assertSame($rev, $this->stored()[1]);
        $this->write($alice, ['action' => 'update', 'tag' => self::tid(1), 'name' => 'BUDGET']);
        $this->assertSame('BUDGET', $this->stored()[0]['tags'][0]['name'], 'the own name in another case');
        $this->assertSame([400, 'bad_request'], $this->fails($alice, ['action' => 'update', 'tag' => self::tid(1)]), 'neither name nor colour');
    }

    public function testDeleteRemovesTheEntryAndAnUnknownTagWritesNothing(): void {
        $alice = $this->user('alice');
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, 'Kosten'), self::tag(2, 'Zeit')]]);
        $this->write($alice, ['action' => 'delete', 'tag' => self::tid(1)]);
        [$meta, $rev] = $this->stored();
        $this->assertSame([self::tid(2)], array_column($meta['tags'], 'id'));
        $out = $this->write($alice, ['action' => 'delete', 'tag' => self::tid(1)]);
        $this->assertSame([$rev, $rev], [$out['metaRev'], $this->stored()[1]], 'unknown: nothing written');
        $this->write($alice, ['action' => 'delete', 'tag' => self::tid(2)]);
        $this->assertArrayNotHasKey('tags', $this->stored()[0], 'the last tag takes the key along');
    }

    public function testTheBodyIsStrict(): void {
        $alice = $this->user('alice');
        $bad = [
            ['action' => 'rename', 'tag' => self::tid(1)],
            ['tags' => [self::tag(1, 'A')]],
            ['action' => 'add'],
            ['action' => 'add', 'tags' => []],
            ['action' => 'add', 'tags' => self::tag(1, 'A')],
            ['action' => 'add', 'tags' => [self::tag(1, 'A') + ['extra' => 1]]],
            ['action' => 'add', 'tags' => [['id' => self::tid(1), 'name' => 'A']]],
            ['action' => 'add', 'tags' => [self::tag(1, '')]],
            ['action' => 'add', 'tags' => [self::tag(1, '   ')]],
            ['action' => 'add', 'tags' => [self::tag(1, str_repeat('ä', 31))]],
            ['action' => 'add', 'tags' => [self::tag(1, "a\u{0007}b")]],
            ['action' => 'add', 'tags' => [self::tag(1, 'A', 'red')]],
            ['action' => 'add', 'tags' => [['id' => '01ja000000000000000000000l', 'name' => 'A', 'color' => '#ffffff']]],
            ['action' => 'add', 'tags' => [['id' => 5, 'name' => 'A', 'color' => '#ffffff']]],
            ['action' => 'add', 'tags' => [self::tag(1, 'A')], 'tag' => self::tid(1)],
            ['action' => 'update', 'tag' => 'x', 'name' => 'A'],
            ['action' => 'update', 'tag' => self::tid(1), 'name' => null],
            ['action' => 'update', 'tag' => self::tid(1), 'tags' => []],
            ['action' => 'delete'],
            ['action' => 'delete', 'tag' => self::tid(1), 'name' => 'A'],
        ];
        foreach ($bad as $i => $body) {
            $this->assertSame([400, 'bad_request'], $this->fails($alice, $body), "#$i " . json_encode($body));
        }
        $tooMany = [];
        for ($i = 1; $i <= 101; $i++) {
            $tooMany[] = self::tag($i, 'T' . $i);
        }
        $this->assertSame([400, 'bad_request'], $this->fails($alice, ['action' => 'add', 'tags' => $tooMany]), '101 entries');
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, str_repeat('ä', 30))]]);
        $this->assertSame(str_repeat('ä', 30), $this->stored()[0]['tags'][0]['name'], '30 characters');
    }

    public function testOwnerEditAndTheGuestOfTheEditLinkWriteVoteAndViewDoNot(): void {
        $this->write($this->user('alice'), ['action' => 'add', 'tags' => [self::tag(1, 'Owner')]]);
        $this->write($this->user('carol'), ['action' => 'add', 'tags' => [self::tag(2, 'Edit share')]]);
        $this->write($this->guest('edit'), ['action' => 'add', 'tags' => [self::tag(3, 'Edit guest')]]);
        $this->assertSame(['Owner', 'Edit share', 'Edit guest'], array_column($this->stored()[0]['tags'], 'name'));
        [, $rev] = $this->stored();
        $this->assertSame([403, 'forbidden'], $this->fails($this->user('bob'), ['action' => 'add', 'tags' => [self::tag(4, 'View')]]));
        $this->assertSame([403, 'forbidden'], $this->fails($this->user('vic'), ['action' => 'delete', 'tag' => self::tid(1)]));
        $this->assertSame([403, 'forbidden'], $this->fails($this->guest('vote', 'gVOTE0000001'), ['action' => 'add', 'tags' => [self::tag(5, 'Vote guest')]]));
        $this->assertSame($rev, $this->stored()[1]);
    }

    public function testTheBudgetPerAccountAndPerGuestIp(): void {
        $this->h->limiterCalls = [];
        $this->write($this->user('carol'), ['action' => 'add', 'tags' => [self::tag(1, 'A')]]);
        $this->assertSame(['knorke-tags 60 60 carol'], $this->h->limiterCalls, 'per account, 60 per 60 s');
        $this->h->limiterCalls = [];
        $this->write($this->guest('edit'), ['action' => 'add', 'tags' => [self::tag(2, 'B')]]);
        $this->assertSame(['knorke-tags 60 60 ' . self::IP], $this->h->limiterCalls, 'a guest per IP');
        $this->h->limiterFull = ['knorke-tags'];
        [, $rev] = $this->stored();
        try {
            $this->write($this->user('alice'), ['action' => 'add', 'tags' => [self::tag(3, 'C')]]);
            $this->fail('no 429');
        } catch (HttpError $e) {
            $this->assertSame([429, 'slow_down', 1000], [$e->status, $e->error, $e->extra['retryMs'] ?? null]);
        }
        $this->assertSame([403, 'forbidden'], $this->fails($this->user('bob'), ['action' => 'add', 'tags' => [self::tag(4, 'D')]]), 'the right before the budget');
        $this->assertSame($rev, $this->stored()[1]);
    }

    public function testWithoutFourByteTextNamesAreComparedAsStored(): void {
        // review round 1: on MySQL/MariaDB without utf8mb4 MetaService stores 4-byte characters as U+FFFD;
        // the uniqueness check must compare the names in that form, or a tag vanishes
        $this->h->fourByte = false;
        $r = "\u{FFFD}";
        $alice = $this->user('alice');
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(1, '🔥 Hot'), self::tag(2, '💡 Hot'), self::tag(3, 'Kosten')]]);
        [$meta, $rev] = $this->stored();
        $this->assertSame([self::tid(1), self::tid(3)], array_column($meta['tags'], 'id'), '"💡 Hot" is "' . $r . ' Hot" as well: skipped in the same list');
        $this->assertSame($r . ' Hot', $meta['tags'][0]['name'], 'stored with U+FFFD');
        $out = $this->write($alice, ['action' => 'add', 'tags' => [self::tag(4, '🎯 Hot')]]);
        $this->assertSame([$rev, $rev], [$out['metaRev'], $this->stored()[1]], 'a later add of the same stored name writes nothing');
        $this->assertSame([409, 'tag_exists'], $this->fails($alice, ['action' => 'update', 'tag' => self::tid(3), 'name' => '🚀 Hot']), 'renaming onto the stored name');
        $this->assertSame([self::tid(1), self::tid(3)], array_column($this->stored()[0]['tags'], 'id'), 'no tag lost');
        $this->write($alice, ['action' => 'update', 'tag' => self::tid(3), 'name' => '💡']);
        $this->assertSame([$r . ' Hot', $r], array_column($this->stored()[0]['tags'], 'name'), 'another name is stored in its U+FFFD form');
        [, $rev2] = $this->stored();
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(5, '🔥')]]);
        $this->assertSame([$rev2, 2], [$this->stored()[1], count($this->stored()[0]['tags'])], '"🔥" is the stored "' . $r . '": skipped, nothing written');
        $this->h->fourByte = true;
        $this->write($alice, ['action' => 'add', 'tags' => [self::tag(6, '🔥')]]);
        $this->assertSame('🔥', $this->stored()[0]['tags'][2]['name'], 'with 4-byte support the emoji stays');
    }

    public function testListOfCleansAStoredList(): void {
        $meta = ['tags' => [
            ['id' => self::tid(1), 'name' => 'A', 'color' => '#ABCDEF'],
            ['id' => self::tid(1), 'name' => 'B', 'color' => '#000000'],
            ['id' => self::tid(2), 'name' => 'a', 'color' => '#000000'],
            ['id' => 'nope', 'name' => 'C', 'color' => '#000000'],
            ['id' => self::tid(3), 'name' => 'D', 'color' => 'red'],
            'x',
            ['id' => self::tid(4), 'name' => 'E', 'color' => '#111111'],
        ]];
        $this->assertSame([['id' => self::tid(1), 'name' => 'A', 'color' => '#abcdef'], ['id' => self::tid(4), 'name' => 'E', 'color' => '#111111']], TagService::listOf($meta));
        $this->assertSame([], TagService::listOf(['tags' => 'x']));
        $this->assertSame([], TagService::listOf([]));
    }
}
