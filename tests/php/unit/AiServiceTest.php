<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\AiNotice;
use OCA\Knorke\Service\AiService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\Config\IUserConfig;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IL10N;
use OCP\L10N\IFactory;
use OCP\Security\ISecureRandom;
use OCP\TaskProcessing\IManager;
use OCP\TaskProcessing\Task;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * "Summarise" and "Cluster by topic" (factory job 267) through AiService on
 * the in-memory rights of AccessHarness: who may (AK1), the daily limit
 * (AK3), the notice (AK4), the result on the board (AK5, AK6) and the risks
 * (ids of another board, a task of another account, rights lost meanwhile).
 */
final class AiServiceTest extends TestCase {
    private const NOW = 1_760_000_000_123;

    private AccessHarness $h;
    private int $b;
    /** @var array<string, string> app config "app/key" */
    private array $app = [];
    /** @var array<string, array<string, string>> user values per uid */
    private array $prefs = [];
    /** @var list<string> task types with a provider */
    private array $types = [AiService::TASK_TYPE];
    /** @var list<Task> scheduled tasks */
    private array $scheduled = [];
    /** @var list<int> cancelled task ids */
    private array $cancelled = [];
    /** @var array<string, array> item rows by id (all on board $b) */
    private array $rows = [];
    /** @var list<list<array>> op batches written */
    private array $written = [];
    /** @var array<string, array<string, string>> (round 2) what this process holds per uid, like OC\Config\UserConfig */
    private array $cache = [];
    private AiService $ai;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'Retro')['id'];
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->h->shareRows->add($this->b, 'user', 'bob', 'view');
        $app = Fake::of(IAppConfig::class, [
            'getValueString' => fn (string $a, string $k, string $d = '', bool $lazy = false): string => $this->app["$a/$k"] ?? $d,
            'setValueString' => function (string $a, string $k, string $v, bool $lazy = false) {
                $this->app["$a/$k"] = $v;
                return true;
            },
            'deleteKey' => function (string $a, string $k): void {
                unset($this->app["$a/$k"]);
            },
        ]);
        $config = Fake::of(IConfig::class, [
            'getUserValue' => function ($u, $a, $k, $d = '') {
                $this->cache[$u] ??= $this->prefs[$u] ?? [];
                return $this->cache[$u][$k] ?? $d;
            },
            'setUserValue' => function ($u, $a, $k, $v, $pre = null): void {
                $this->cache[$u] ??= $this->prefs[$u] ?? [];
                if ($pre !== null && ($this->cache[$u][$k] ?? null) !== $pre) {
                    throw new \OCP\PreConditionNotMetException();
                }
                $this->prefs[$u][$k] = (string)$v;
                $this->cache[$u][$k] = (string)$v;
            },
            'deleteUserValue' => function ($u, $a, $k): void {
                unset($this->prefs[$u][$k], $this->cache[$u][$k]);
            },
            'getUserKeys' => fn ($u, $a) => array_keys($this->prefs[$u] ?? []),
        ]);
        $tasks = Fake::of(IManager::class, [
            'getAvailableTaskTypeIds' => fn (bool $d = false, ?string $u = null): array => $this->types,
            'scheduleTask' => function (Task $t): void {
                $t->setId(100 + count($this->scheduled));
                $t->setStatus(Task::STATUS_SCHEDULED);
                $this->scheduled[] = $t;
            },
            'cancelTask' => function (int $id): void {
                $this->cancelled[] = $id;
            },
            'getUserTask' => function (int $id, ?string $u): Task {
                foreach ($this->scheduled as $t) {
                    if ($t->getId() === $id) {
                        return $t;
                    }
                }
                throw new \OCP\TaskProcessing\Exception\NotFoundException();
            },
        ]);
        $items = $this->createMock(ItemStore::class);
        $items->method('loadItems')->willReturnCallback(fn (int $board, array $ids): array => $board === $this->b ? array_intersect_key($this->rows, array_flip($ids)) : []);
        $items->method('liveChildren')->willReturnCallback(fn (int $board, array $parents): array => array_filter($this->rows,
            static fn (array $r): bool => in_array($r['parent_id'], $parents, true) && (int)$r['deleted'] === 0));
        $items->method('contentZ')->willReturn(['i0']);
        $items->method('sketchBoxes')->willReturnCallback(fn (int $board): array => array_values(array_filter($this->rows,
            static fn (array $r): bool => (int)$r['deleted'] === 0 && $r['type'] !== 'connector')));
        $sync = $this->createMock(SyncService::class);
        $sync->method('applyOps')->willReturnCallback(function (Principal $p, int $board, string $client, array $ops, int $now): array {
            $this->written[] = $ops;
            return [7, array_fill(0, count($ops), $p->role->canEdit() ? 'ok' : 'denied')];
        });
        $l10n = Fake::of(IFactory::class, [
            'getUserLanguage' => fn ($u = null): string => 'en',
            'get' => fn (string $app, ?string $lang = null, ?string $locale = null): IL10N => Fake::of(IL10N::class, ['t' => fn (string $s, $p = []): string => $s]),
            'getLanguages' => fn (): array => ['commonLanguages' => [['code' => 'en', 'name' => 'English']], 'otherLanguages' => []],
        ]);
        $this->ai = new AiService($app, $config, $tasks, $this->h->access, $items, $this->h->meta, $sync, new AiNotice($app, $l10n), $l10n, $this->h->users,
            Fake::of(ISecureRandom::class, ['generate' => fn (int $n, string $chars = ''): string => str_repeat('A', $n)]), Fake::of(LoggerInterface::class),
            Fake::of(IUserConfig::class, ['clearCache' => function (string $u, bool $reload = false): void {
                unset($this->cache[$u]);
            }]));
    }

    private static function id(int $n): string {
        return '01JA' . str_pad((string)$n, 22, '0', STR_PAD_LEFT);
    }

    private function row(int $n, string $type, array $data, array $over = []): void {
        $this->rows[self::id($n)] = $over + ['id' => self::id($n), 'type' => $type, 'parent_id' => null, 'x' => 0, 'y' => 0, 'w' => 200, 'h' => 200,
            'rotation' => 0, 'data' => json_encode($data), 'style' => '{}', 'deleted' => 0, 'group_id' => null, 'locked' => null];
    }

    private function user(string $uid): Principal {
        $this->h->uid = $uid;
        return $this->h->access->forUser($this->b, true)->principal;
    }

    /** [status, code] of a start that must fail */
    private function fails(callable $fn): array {
        try {
            $fn();
        } catch (HttpError $e) {
            return [$e->status, $e->error, $e->extra];
        }
        $this->fail('no error');
    }

    private function notes(int $n): array {
        $ids = [];
        for ($i = 1; $i <= $n; $i++) {
            $this->row($i, 'sticky', ['text' => 'note ' . $i], ['x' => $i * 10]);
            $ids[] = self::id($i);
        }
        return $ids;
    }

    private function start(string $uid, array $body): array {
        return $this->ai->start($this->user($uid), $this->b, $body + ['acceptNotice' => true], self::NOW);
    }

    private function succeed(string $output, int $i = 0): void {
        $t = $this->scheduled[$i];
        $t->setStatus(Task::STATUS_SUCCESSFUL);
        $t->setOutput(['output' => $output]);
        $this->ai->finish($t, self::NOW + 1000);
    }

    public function testWhoMayUseAi(): void {
        // AK1: owner and edit yes; view no; admin switch, provider and board switch each close it
        $ids = $this->notes(2);
        $this->assertSame(['task' => 100], $this->start('alice', ['kind' => 'summarise', 'ids' => $ids]));
        $this->assertSame(['task' => 101], $this->start('carol', ['kind' => 'cluster', 'ids' => $ids]));
        $this->assertSame([403, 'forbidden'], array_slice($this->fails(fn () => $this->start('bob', ['kind' => 'summarise', 'ids' => $ids])), 0, 2));
        $this->assertFalse($this->ai->state($this->user('bob'), $this->b, self::NOW)['available']);
        $this->app['knorke/ai_enabled'] = 'no';
        $this->assertSame([403, 'ai_unavailable', ['reason' => 'ai_disabled']], $this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => $ids])));
        unset($this->app['knorke/ai_enabled']);
        $this->types = [];
        $this->assertSame([403, 'ai_unavailable', ['reason' => 'ai_no_provider']], $this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => $ids])));
        $s = $this->ai->state($this->user('alice'), $this->b, self::NOW);
        $this->assertSame([false, false], [$s['available'], $s['ready']]);
        $this->types = [AiService::TASK_TYPE];
        $this->ai->allow($this->user('alice'), $this->b, false, self::NOW);
        $this->assertSame('off', $this->h->meta->read($this->b)['meta']['ai']);
        $this->assertSame([403, 'ai_unavailable', ['reason' => 'ai_board_off']], $this->fails(fn () => $this->start('carol', ['kind' => 'summarise', 'ids' => $ids])));
        $s = $this->ai->state($this->user('alice'), $this->b, self::NOW);
        $this->assertSame([false, true, false, true], [$s['available'], $s['ready'], $s['allowed'], $s['owner']]);
        $this->assertSame([403, 'forbidden'], array_slice($this->fails(fn () => $this->ai->allow($this->user('carol'), $this->b, true, self::NOW)), 0, 2), 'the switch is the owner\'s');
        $this->ai->allow($this->user('alice'), $this->b, true, self::NOW);
        $this->assertArrayNotHasKey('ai', $this->h->meta->read($this->b)['meta']);
    }

    /** Factory job 275: summarise and cluster read texts, so not during private writing; a prompt diagram may. */
    public function testPrivateWritingRefusesSummaryAndCluster(): void {
        $ids = $this->notes(2);
        $this->h->meta->write($this->b, static fn (array $m): array => \OCA\Knorke\Service\PrivateWriting::startAfter($m, null, self::NOW, 'Alice'), self::NOW);
        $this->assertSame([409, 'private_on'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => $ids])), 0, 2));
        $this->assertSame([409, 'private_on'], array_slice($this->fails(fn () => $this->start('carol', ['kind' => 'cluster', 'ids' => $ids])), 0, 2));
        $this->assertSame(['task' => 100], $this->start('alice', ['kind' => 'diagram', 'shape' => 'mindmap', 'prompt' => 'Retro']));
    }

    public function testTheInputHoldsOnlyTextsAndRespectsTheLimits(): void {
        // AK2: names, reactions and tags stay on the board; ids of another board are not read
        $this->row(1, 'sticky', ['text' => 'Cost too high', 'react' => ['x' => ['e' => '1f44d', 'n' => 'Alice Display']], 'tags' => [self::id(90)]]);
        $this->row(2, 'frame', ['title' => 'Retro'], ['w' => 2000, 'h' => 2000]);
        $this->row(3, 'text', ['text' => 'Inside'], ['parent_id' => self::id(2)]);
        $this->start('alice', ['kind' => 'summarise', 'ids' => [self::id(1), self::id(2), self::id(77)]]);
        $input = $this->scheduled[0]->getInput()['input'];
        $this->assertStringContainsString("<<<BOARD\n- Cost too high\nFrame: Retro\n  - Inside\nBOARD>>>", $input);
        $this->assertStringNotContainsString('Alice', $input);
        $this->assertSame(['knorke', 'alice', 'board:' . $this->b], [$this->scheduled[0]->getAppId(), $this->scheduled[0]->getUserId(), $this->scheduled[0]->getCustomId()]);
        $this->rows = [];
        $this->row(1, 'sticky', ['text' => str_repeat('x', 30001)]);
        $this->assertSame([400, 'ai_too_much'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => [self::id(1)]])), 0, 2));
        $this->assertSame([400, 'ai_empty'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => [self::id(55)]])), 0, 2), 'unknown ids: nothing to send');
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => array_fill(0, 201, self::id(1))])), 0, 2));
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'poem', 'ids' => [self::id(1)]])), 0, 2));
        $this->assertSame([400, 'ai_empty'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'cluster', 'ids' => [self::id(1)]])), 0, 2), 'one note: nothing to cluster');
        $this->assertCount(1, $this->scheduled);
    }

    public function testDailyLimit(): void {
        // AK3: 30 a day by default, the admin's number, a new UTC day starts again
        $ids = $this->notes(1);
        for ($i = 0; $i < 30; $i++) {
            $this->start('carol', ['kind' => 'summarise', 'ids' => $ids]);
        }
        $this->assertSame([429, 'ai_limit', ['max' => 30]], $this->fails(fn () => $this->start('carol', ['kind' => 'summarise', 'ids' => $ids])));
        $this->assertSame(['max' => 30, 'used' => 30], $this->ai->state($this->user('carol'), $this->b, self::NOW)['limit']);
        $this->ai->saveSettings(['dailyLimit' => 5]);
        $this->start('alice', ['kind' => 'summarise', 'ids' => $ids]);
        $this->prefs['alice']['ai_day'] = gmdate('Y-m-d', intdiv(self::NOW, 1000)) . ' 5';
        unset($this->cache['alice']);
        $this->assertSame([429, 'ai_limit', ['max' => 5]], $this->fails(fn () => $this->start('alice', ['kind' => 'summarise', 'ids' => $ids])));
        $this->assertSame(['task' => 131], $this->ai->start($this->user('alice'), $this->b, ['kind' => 'summarise', 'ids' => $ids], self::NOW + 86_400_000));
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->ai->saveSettings(['dailyLimit' => 1001])), 0, 2));
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->ai->saveSettings(['enabled' => 'yes'])), 0, 2));
    }

    public function testNoticeIsConfirmedOnceAndAgainAfterAChange(): void {
        // AK4
        $ids = $this->notes(1);
        $p = $this->user('carol');
        $this->assertSame([409, 'ai_notice'], array_slice($this->fails(fn () => $this->ai->start($p, $this->b, ['kind' => 'summarise', 'ids' => $ids], self::NOW)), 0, 2));
        $this->assertFalse($this->ai->state($p, $this->b, self::NOW)['notice']['confirmed']);
        $this->assertSame(['task' => 100], $this->ai->start($p, $this->b, ['kind' => 'summarise', 'ids' => $ids, 'acceptNotice' => true], self::NOW));
        $this->assertSame(['task' => 101], $this->ai->start($p, $this->b, ['kind' => 'summarise', 'ids' => $ids], self::NOW), 'confirmed once');
        $n = $this->ai->state($p, $this->b, self::NOW)['notice'];
        $this->assertSame([null, '', true], [$n['text'], $n['url'], $n['confirmed']], 'no admin text: the client\'s built-in one');
        $this->ai->saveSettings(['notice' => ['default' => ['text' => 'Our provider is Infomaniak.', 'url' => 'https://example.org/ai']]]);
        $n = $this->ai->state($p, $this->b, self::NOW)['notice'];
        $this->assertSame(['Our provider is Infomaniak.', 'https://example.org/ai', false], [$n['text'], $n['url'], $n['confirmed']]);
        $this->assertSame([409, 'ai_notice'], array_slice($this->fails(fn () => $this->ai->start($p, $this->b, ['kind' => 'summarise', 'ids' => $ids], self::NOW)), 0, 2));
    }

    public function testSummaryLandsAsACardBesideTheSelection(): void {
        // AK5: the listener's call writes one card as the account, the state holds ops and inverse
        $this->row(9, 'frame', ['title' => 'Ideas'], ['x' => 0, 'y' => 0, 'w' => 3000, 'h' => 3000]);
        $this->row(1, 'sticky', ['text' => 'a'], ['parent_id' => self::id(9), 'x' => 100, 'y' => 100]);
        $this->row(2, 'sticky', ['text' => 'b'], ['parent_id' => self::id(9), 'x' => 400, 'y' => 50]);
        $this->start('carol', ['kind' => 'summarise', 'ids' => [self::id(1), self::id(2)]]);
        $this->succeed("# Summary\n- **a** and b");
        $this->assertCount(1, $this->written);
        $put = $this->written[0][0];
        $this->assertSame(['put', 'ai'], [$put['o'], $put['t']]);
        $this->assertSame([640.0, 50.0, self::id(9)], [$put['p']['x'], $put['p']['y'], $put['p']['parent']]);
        $this->assertSame(['md' => "# Summary\n- **a** and b", 'title' => 'Ideas'], $put['p']['data']);
        $this->assertSame('i0i1', $put['p']['z']);
        $this->assertMatchesRegularExpression('/^[0-9A-HJKMNP-TV-Z]{26}$/', $put['id']);
        $t = $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'];
        $this->assertSame([100, 'summarise', 'done'], [$t[0]['task'], $t[0]['kind'], $t[0]['status']]);
        $this->assertSame([['o' => 'remove', 'id' => $put['id']]], $t[0]['inverse']);
        $this->assertEquals(new \stdClass(), $t[0]['ops'][0]['p']['style'], 'an empty style goes out as {}');
        $this->assertSame([$put['id']], $t[0]['select']);
        $this->succeed('again');
        $this->assertCount(1, $this->written, 'a second event writes nothing');
    }

    public function testTheCardSkipsANoteBesideTheSelection(): void {
        // round 1 (UI 1): a note right of the selection inside the frame is not covered
        $this->row(9, 'frame', ['title' => 'Ideas'], ['w' => 3000, 'h' => 3000]);
        $this->row(1, 'sticky', ['text' => 'a'], ['parent_id' => self::id(9), 'x' => 100, 'y' => 100]);
        $this->row(2, 'sticky', ['text' => 'b'], ['parent_id' => self::id(9), 'x' => 340, 'y' => 100]);
        $this->start('carol', ['kind' => 'summarise', 'ids' => [self::id(1)]]);
        $this->succeed('# x');
        $p = $this->written[0][0]['p'];
        $this->assertSame([100.0, 340.0, self::id(9)], [$p['x'], $p['y'], $p['parent']], 'right is taken by note b: below the selection (300 + 40), still in the frame');
    }

    public function testNothingIsWrittenWithoutTheRightToEdit(): void {
        // risk: the share is gone (or AI switched off) between the start and the result
        $ids = $this->notes(2);
        $this->start('carol', ['kind' => 'summarise', 'ids' => $ids]);
        $this->start('carol', ['kind' => 'summarise', 'ids' => $ids]);
        $this->h->shareRows->rows = array_values(array_filter($this->h->shareRows->rows, static fn (array $r): bool => $r['recipient'] !== 'carol'));
        $this->succeed('# x');
        $this->assertSame([], $this->written);
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $this->ai->allow($this->user('alice'), $this->b, false, self::NOW);
        $this->succeed('# x', 1);
        $this->assertSame([], $this->written);
        $this->ai->allow($this->user('alice'), $this->b, true, self::NOW);
        $errors = array_column($this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'], 'error');
        $this->assertSame(['forbidden', 'ai_unavailable'], $errors);
    }

    public function testClusterLandsAndABrokenAnswerFails(): void {
        // AK6
        $ids = $this->notes(7);
        $this->start('alice', ['kind' => 'cluster', 'ids' => $ids]);
        $this->start('alice', ['kind' => 'cluster', 'ids' => $ids]);
        $this->assertStringContainsString("1. note 1\n2. note 2", $this->scheduled[0]->getInput()['input']);
        $this->succeed('{"topics":[{"title":"A","notes":[1,2,3]},{"title":"B","notes":[4,5]},{"title":"C","notes":[6]}]}');
        $ops = $this->written[0];
        $heads = array_values(array_filter($ops, static fn (array $o): bool => $o['o'] === 'put'));
        $this->assertSame(['A', 'B', 'C', 'Other'], array_map(static fn (array $o): string => $o['p']['data']['text'], $heads), 'note 7 left out: "Other"');
        $this->assertCount(7, array_filter($ops, static fn (array $o): bool => $o['o'] === 'patch'));
        $this->succeed('Sorry, I cannot do that.', 1);
        $this->assertCount(1, $this->written);
        $t = $this->ai->state($this->user('alice'), $this->b, self::NOW)['tasks'];
        $this->assertSame(['done', 'failed'], array_column($t, 'status'));
        $this->assertSame('ai_answer', $t[1]['error']);
    }

    public function testNotesChangedMeanwhileStay(): void {
        // risk: a note is deleted, another locked while the AI works
        $ids = $this->notes(4);
        $this->start('alice', ['kind' => 'cluster', 'ids' => $ids]);
        $this->rows[self::id(1)]['deleted'] = 1;
        $this->rows[self::id(2)]['locked'] = 1;
        $this->succeed('{"topics":[{"title":"A","notes":[1,2,3]},{"title":"B","notes":[4]}]}');
        $moved = array_column(array_filter($this->written[0], static fn (array $o): bool => $o['o'] === 'patch'), 'id');
        $this->assertSame([], array_intersect($moved, [self::id(1), self::id(2)]));
    }

    public function testForgetCancelsOnlyOwnTasks(): void {
        $ids = $this->notes(1);
        $this->start('carol', ['kind' => 'summarise', 'ids' => $ids]);
        $this->assertSame([404, 'not_found'], array_slice($this->fails(fn () => $this->ai->forget($this->user('alice'), $this->b, '100')), 0, 2), 'another account\'s task');
        $this->assertSame([404, 'not_found'], array_slice($this->fails(fn () => $this->ai->forget($this->user('carol'), $this->b + 1, '100')), 0, 2), 'another board');
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->ai->forget($this->user('carol'), $this->b, 'x')), 0, 2));
        $this->assertSame(['task' => 100, 'forgotten' => true], $this->ai->forget($this->user('carol'), $this->b, '100'));
        $this->assertSame([100], $this->cancelled);
        $this->assertSame([], $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks']);
        $this->assertSame(1, $this->ai->state($this->user('carol'), $this->b, self::NOW)['limit']['used'], 'a cancelled task counts');
    }

    public function testRunningTaskShowsAndOldStatesGo(): void {
        $ids = $this->notes(1);
        $this->start('carol', ['kind' => 'summarise', 'ids' => $ids]);
        $this->assertSame('running', $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'][0]['status']);
        $this->scheduled[0]->setStatus(Task::STATUS_CANCELLED);
        $this->assertSame('ai_cancelled', $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'][0]['error']);
        $this->assertSame([], $this->ai->state($this->user('carol'), $this->b, self::NOW + AiService::KEEP_MS + 1)['tasks']);
        $this->assertSame(['ai_notice', 'ai_day'], array_keys($this->prefs['carol']), 'the state is gone');
    }

    public function testAWorkerFindsTheStateOfALaterTask(): void {
        // round 2 (fresh 1): the worker process read alice's values before her second task existed
        $ids = $this->notes(2);
        $this->start('alice', ['kind' => 'summarise', 'ids' => $ids]);
        $this->succeed('# one');
        $this->assertCount(1, $this->written);
        // the web request (another process) schedules task 2: the worker's cache does not know it
        $held = $this->cache['alice'];
        $this->start('alice', ['kind' => 'summarise', 'ids' => $ids]);
        $this->cache['alice'] = $held;
        $this->succeed('# two', 1);
        $this->assertCount(2, $this->written, 'the second result lands as well');
    }

    public function testRoute59FinishesATaskWhoseEventWasMissed(): void {
        // round 2 (fresh 1): Nextcloud says successful, the state still runs: route 59 writes it after FINISH_LATE_S
        $ids = $this->notes(2);
        $this->start('carol', ['kind' => 'summarise', 'ids' => $ids]);
        $t = $this->scheduled[0];
        $t->setStatus(Task::STATUS_SUCCESSFUL);
        $t->setOutput(['output' => '# late']);
        $t->setEndedAt(intdiv(self::NOW, 1000));
        $this->assertSame('running', $this->ai->state($this->user('carol'), $this->b, self::NOW + 5000)['tasks'][0]['status'], 'within the grace time the listener may still come');
        $this->assertSame([], $this->written);
        $s = $this->ai->state($this->user('carol'), $this->b, self::NOW + (AiService::FINISH_LATE_S + 1) * 1000);
        $this->assertSame('done', $s['tasks'][0]['status']);
        $this->assertCount(1, $this->written);
    }

    public function testDiagramStartChecksThePromptAndKeepsItOutOfTheState(): void {
        // job 268 AK1: the prompt's limits, the shape, the same gates as 267
        $this->assertSame([400, 'ai_empty'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'diagram', 'shape' => 'mindmap', 'prompt' => "  \n "])), 0, 2));
        $this->assertSame([400, 'ai_too_much'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'diagram', 'shape' => 'mindmap', 'prompt' => str_repeat('ä', 1001)])), 0, 2));
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'diagram', 'shape' => 'flow', 'prompt' => 'x'])), 0, 2));
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->start('alice', ['kind' => 'diagram', 'shape' => 'org', 'prompt' => 5])), 0, 2));
        $this->assertSame([403, 'forbidden'], array_slice($this->fails(fn () => $this->start('bob', ['kind' => 'diagram', 'shape' => 'tree', 'prompt' => 'x'])), 0, 2));
        $p = $this->user('carol');
        $this->assertSame([409, 'ai_notice'], array_slice($this->fails(fn () => $this->ai->start($p, $this->b, ['kind' => 'diagram', 'shape' => 'tree', 'prompt' => 'x'], self::NOW)), 0, 2));
        $this->assertSame([], $this->scheduled);
        $this->assertSame(['task' => 100], $this->start('alice', ['kind' => 'diagram', 'shape' => 'org', 'prompt' => str_repeat('ä', 999) . ' ', 'ids' => [self::id(1)]]));
        $input = $this->scheduled[0]->getInput()['input'];
        $this->assertStringContainsString('org chart', $input);
        $this->assertStringContainsString('at most 50 nodes', $input);
        $this->assertStringContainsString("<<<REQUEST\n" . str_repeat('ä', 999) . "\nREQUEST>>>", $input);
        $st = json_decode($this->prefs['alice']['ai_task_100'], true);
        $this->assertSame(['diagram', 'org', [], null], [$st['k'], $st['sh'], $st['ids'], $st['f']]);
        $this->assertStringNotContainsString('ää', $this->prefs['alice']['ai_task_100'], 'the prompt is not stored');
        $this->ai->allow($this->user('alice'), $this->b, false, self::NOW);
        $this->assertSame([403, 'ai_unavailable', ['reason' => 'ai_board_off']], $this->fails(fn () => $this->start('alice', ['kind' => 'diagram', 'shape' => 'tree', 'prompt' => 'x'])));
        $this->ai->allow($this->user('alice'), $this->b, true, self::NOW);
        $this->prefs['alice']['ai_day'] = gmdate('Y-m-d', intdiv(self::NOW, 1000)) . ' 30';
        unset($this->cache['alice']);
        $this->assertSame([429, 'ai_limit', ['max' => 30]], $this->fails(fn () => $this->start('alice', ['kind' => 'diagram', 'shape' => 'tree', 'prompt' => 'x'])));
    }

    public function testDiagramResultIsATreeAndNothingOnTheBoard(): void {
        // job 268 AK3: done with the cleaned tree, no ops; rights lost or a broken answer: failed
        $this->start('carol', ['kind' => 'diagram', 'shape' => 'mindmap', 'prompt' => 'Holiday']);
        $this->start('carol', ['kind' => 'diagram', 'shape' => 'tree', 'prompt' => 'Holiday']);
        $this->start('carol', ['kind' => 'diagram', 'shape' => 'tree', 'prompt' => 'Holiday']);
        $this->succeed("```json\n{\"text\":\"Holiday\",\"children\":[{\"text\":\"Sea\",\"children\":[{\"text\":\"Swim\"}]},{\"text\":\"<b>Hills</b>\"}]}\n```");
        $this->succeed('I cannot draw.', 1);
        $this->assertSame([], $this->written, 'a diagram writes nothing to the board');
        $t = $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'];
        $this->assertSame(['diagram', 'mindmap', 'done'], [$t[0]['kind'], $t[0]['shape'], $t[0]['status']]);
        $this->assertSame(['text' => 'Holiday', 'children' => [
            ['text' => 'Sea', 'children' => [['text' => 'Swim', 'children' => []]]],
            ['text' => '<b>Hills</b>', 'children' => []],
        ]], $t[0]['tree']);
        $this->assertArrayNotHasKey('ops', $t[0]);
        $this->assertSame(['failed', 'ai_answer', 'tree'], [$t[1]['status'], $t[1]['error'], $t[1]['shape']]);
        $this->assertSame('running', $t[2]['status']);
        $this->h->shareRows->rows = array_values(array_filter($this->h->shareRows->rows, static fn (array $r): bool => $r['recipient'] !== 'carol'));
        $this->succeed('{"text":"a","children":[{"text":"b"}]}', 2);
        $this->h->shareRows->add($this->b, 'user', 'carol', 'edit');
        $t = $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'];
        $this->assertSame(['failed', 'forbidden'], [$t[2]['status'], $t[2]['error']]);
        $this->assertSame(['task' => 100, 'forgotten' => true], $this->ai->forget($this->user('carol'), $this->b, '100'));
    }

    public function testFlowchartStartsAndFinishesWithStepsAndArrows(): void {
        // job 269 AK1, AK3: the prompt names the types and limits; done keeps the flow, nothing on the board
        $this->assertSame(['task' => 100], $this->start('carol', ['kind' => 'diagram', 'shape' => 'flowchart', 'prompt' => 'Order a pizza']));
        $this->start('carol', ['kind' => 'diagram', 'shape' => 'flowchart', 'prompt' => 'Order a pizza']);
        $input = $this->scheduled[0]->getInput()['input'];
        $this->assertStringContainsString('flowchart', $input);
        $this->assertStringContainsString('start, end, step, decision, document, data', $input);
        $this->assertStringContainsString('at most 50 nodes and at most 100 edges', $input);
        $this->assertStringContainsString("<<<REQUEST\nOrder a pizza\nREQUEST>>>", $input);
        $st = json_decode($this->prefs['carol']['ai_task_100'], true);
        $this->assertSame(['diagram', 'flowchart'], [$st['k'], $st['sh']]);
        $this->assertStringNotContainsString('pizza', $this->prefs['carol']['ai_task_100'], 'the prompt is not stored');
        $this->succeed('{"nodes":[{"id":"1","type":"start","text":"Hungry"},{"id":"2","type":"decision","text":"Pizza?"},{"id":"3","type":"end","text":"Eat"}],'
            . '"edges":[{"from":"1","to":"2"},{"from":"2","to":"3","label":"yes"},{"from":"2","to":"1","label":"no"}]}');
        $this->succeed('{"text":"a mind map","children":[{"text":"b"}]}', 1);
        $this->assertSame([], $this->written, 'a flowchart writes nothing to the board');
        $t = $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'];
        $this->assertSame(['diagram', 'flowchart', 'done'], [$t[0]['kind'], $t[0]['shape'], $t[0]['status']]);
        $this->assertSame([
            'nodes' => [['type' => 'start', 'text' => 'Hungry'], ['type' => 'decision', 'text' => 'Pizza?'], ['type' => 'end', 'text' => 'Eat']],
            'edges' => [['from' => 0, 'to' => 1, 'label' => ''], ['from' => 1, 'to' => 2, 'label' => 'yes'], ['from' => 1, 'to' => 0, 'label' => 'no']],
        ], $t[0]['flow']);
        $this->assertArrayNotHasKey('tree', $t[0]);
        $this->assertArrayNotHasKey('ops', $t[0]);
        $this->assertSame(['failed', 'ai_answer', 'flowchart'], [$t[1]['status'], $t[1]['error'], $t[1]['shape']], 'a tree is no flowchart');
    }

    public function testWorkshopStartsAndFinishesWithParts(): void {
        // job 276 AK1, AK3: the prompt names the limit; done keeps the parts, nothing on the board
        $this->assertSame(['task' => 100], $this->start('carol', ['kind' => 'diagram', 'shape' => 'workshop', 'prompt' => 'Retro for 8 people, 60 minutes']));
        $this->start('carol', ['kind' => 'diagram', 'shape' => 'workshop', 'prompt' => 'Retro for 8 people, 60 minutes']);
        $input = $this->scheduled[0]->getInput()['input'];
        $this->assertStringContainsString('workshop', $input);
        $this->assertStringContainsString('at most 12 parts', $input);
        $this->assertStringContainsString("<<<REQUEST\nRetro for 8 people, 60 minutes\nREQUEST>>>", $input);
        $st = json_decode($this->prefs['carol']['ai_task_100'], true);
        $this->assertSame(['diagram', 'workshop'], [$st['k'], $st['sh']]);
        $this->assertStringNotContainsString('Retro', $this->prefs['carol']['ai_task_100'], 'the prompt is not stored');
        $this->succeed('{"parts":[{"title":"Check-in","minutes":5,"question":"How are you?"},{"title":"Wrap-up","minutes":10}]}');
        $this->succeed('{"nodes":[],"edges":[]}', 1);
        $this->assertSame([], $this->written, 'a workshop writes nothing to the board');
        $t = $this->ai->state($this->user('carol'), $this->b, self::NOW)['tasks'];
        $this->assertSame(['diagram', 'workshop', 'done'], [$t[0]['kind'], $t[0]['shape'], $t[0]['status']]);
        $this->assertSame(['parts' => [
            ['title' => 'Check-in', 'minutes' => 5, 'question' => 'How are you?'],
            ['title' => 'Wrap-up', 'minutes' => 10, 'question' => ''],
        ]], $t[0]['workshop']);
        $this->assertArrayNotHasKey('tree', $t[0]);
        $this->assertArrayNotHasKey('flow', $t[0]);
        $this->assertArrayNotHasKey('ops', $t[0]);
        $this->assertSame(['failed', 'ai_answer', 'workshop'], [$t[1]['status'], $t[1]['error'], $t[1]['shape']], 'a flowchart is no workshop');
        $this->assertSame([400, 'bad_request'], array_slice($this->fails(fn () => $this->start('carol', ['kind' => 'diagram', 'shape' => 'agenda', 'prompt' => 'x'])), 0, 2));
    }
}
