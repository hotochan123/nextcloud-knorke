<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Command\Orphans;
use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\OrphanReconciler;
use OCA\Knorke\Service\ShapeLibStore;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\ShapeLibHarness;
use OCA\Knorke\Tests\Support\SyncHarness;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;

/**
 * The orphan reconciliation (P7, SPEC-M1 §33.1 e, AUTHZ-1 = OPS-1) on the
 * in-memory services: accounts and groups Nextcloud no longer knows (deleted
 * while Knorke was disabled) are found through user shares, link
 * memberships, board owners and group shares and treated exactly like the
 * listeners (BoardService/VoteService::onUserDeleted,
 * ShareService::onGroupDeleted: boards deleted, rows removed, acl_gen + 1);
 * the five counts are taken before anything is deleted, a dry run changes
 * nothing; (job 023) a locker only in locked_by is found too and cleared
 * like the listener, without a sixth count; occ knorke:orphans prints exactly five lines (plus the dry-run
 * line); the daily job reconciles an id only when a later run finds it
 * missing at least 20 h after the first time (memo orphan_candidates).
 * The vote rows live in a small in-memory VoteStore; VoteService is the
 * real one.
 */
final class OrphanReconcilerTest extends TestCase {
    private const T0 = 1_760_000_000_000;
    private AccessHarness $h;
    /** The item side (locks, job 023): FakeItemStore and SyncService. */
    private SyncHarness $s;
    /** @var array<string, string> app config of the memo */
    private array $app = [];
    /** @var list<string> */
    private array $appWrites = [];
    /** @var array<int, array{id: int, board_id: int, state: string, seq: int}> */
    public array $sessions = [];
    /** @var list<array{sid: int, voter: string, item: string, n: int}> */
    public array $votes = [];
    private OrphanReconciler $r;
    /** @var array<string, int> board name → id */
    private array $id = [];

    /** (job 247) shape libraries and template suggestions */
    private ShapeLibHarness $L;
    /** @var list<string> (job 247) the accounts callForAllUsers lists */
    private array $accounts = ['alice', 'bob', 'carol', 'admin'];
    private ?\Throwable $listFail = null;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->L = new ShapeLibHarness();
        // Nextcloud's AppData keeps a deleted folder in its cache within one process (seen live, job 247).
        $this->L->staleCache = true;
        $this->s = new SyncHarness();
        $this->r = $this->reconciler();
        // alice: U shared to dave (deleted) and bob, G shared to group
        // ghostgrp (deleted) and staff; carol and mem are link members of U;
        // owen (deleted) owns O; an open session on U with a vote of mem
        // (deleted) and one of carol.
        $h = $this->h;
        $this->id['U'] = $h->boards->addBoard('alice', 'U');
        $this->id['G'] = $h->boards->addBoard('alice', 'G');
        $this->id['O'] = $h->boards->addBoard('owen', 'O');
        $this->id['K'] = $h->boards->addBoard('alice', 'K');
        $h->shareRows->add($this->id['U'], 'user', 'dave', 'edit');
        $h->shareRows->add($this->id['U'], 'user', 'bob', 'edit');
        $h->shareRows->add($this->id['G'], 'group', 'ghostgrp', 'edit');
        $h->shareRows->add($this->id['G'], 'group', 'staff', 'view');
        $h->boards->addMember($this->id['U'], 'carol', 'edit', null, 0);
        $h->boards->addMember($this->id['U'], 'mem', 'edit', null, 0);
        $this->sessions[7] = ['id' => 7, 'board_id' => $this->id['U'], 'state' => 'open', 'seq' => 3];
        $this->votes[] = ['sid' => 7, 'voter' => $h->access->pid($this->id['U'], 'u:mem'), 'item' => '01JZ0000000000000000000001', 'n' => 1];
        $this->votes[] = ['sid' => 7, 'voter' => $h->access->pid($this->id['U'], 'u:carol'), 'item' => '01JZ0000000000000000000001', 'n' => 2];
        $h->deletedUsers = ['dave', 'owen', 'mem'];
    }

    private function reconciler(): OrphanReconciler {
        $t = $this;
        $store = new class($t) extends VoteStore {
            public function __construct(private OrphanReconcilerTest $t) {
            }

            public function openSessions(): array {
                return array_values(array_map(static fn (array $s): array => ['id' => $s['id'], 'board_id' => $s['board_id']],
                    array_filter($this->t->sessions, static fn (array $s): bool => $s['state'] === 'open')));
            }

            public function rows(int $sid, string $pid): array {
                $out = [];
                foreach ($this->t->votes as $v) {
                    if ($v['sid'] === $sid && $v['voter'] === $pid) {
                        $out[$v['item']] = $v['n'];
                    }
                }
                return $out;
            }

            public function find(int $board, int $sid): ?array {
                $s = $this->t->sessions[$sid] ?? null;
                return $s !== null && $s['board_id'] === $board ? $s : null;
            }

            public function deleteVoter(int $sid, string $pid): int {
                $before = count($this->t->votes);
                $this->t->votes = array_values(array_filter($this->t->votes, static fn (array $v): bool => !($v['sid'] === $sid && $v['voter'] === $pid)));
                return $before - count($this->t->votes);
            }

            public function bumpSeq(int $sid): int {
                return ++$this->t->sessions[$sid]['seq'];
            }
        };
        $db = Fake::of(IDBConnection::class);
        // (job 247) userExists as AccessHarness; callForAllUsers lists $accounts (or throws $listFail).
        $users = Fake::of(IUserManager::class, [
            'userExists' => fn (string $uid): bool => $this->h->users->userExists($uid),
            'callForAllUsers' => function (\Closure $cb, $search = ''): void {
                if ($this->listFail !== null) {
                    throw $this->listFail;
                }
                foreach ($this->accounts as $uid) {
                    $cb(Fake::of(IUser::class, ['getUID' => fn (): string => $uid]));
                }
            },
        ]);
        $votes = new VoteService($store, $this->h->boards, $this->h->meta, $this->h->cache, $db, $this->h->logger);
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueString' => fn (string $a, string $k, string $d = '', ?bool $lazy = false): string => $this->app[$k] ?? $d,
            'setValueString' => function (string $a, string $k, string $v, ?bool $lazy = false, bool $sensitive = false): bool {
                $this->app[$k] = $v;
                $this->appWrites[] = $k . ($lazy ? ' lazy' : '');
                return true;
            },
            'deleteKey' => function (string $a, string $k): void {
                unset($this->app[$k]);
                $this->appWrites[] = 'delete ' . $k;
            },
        ]);
        return new OrphanReconciler($this->h->boards, $this->h->shareRows, $store, $this->h->service, $this->h->shares, $votes,
            $this->h->access, $users, $this->h->groupManager, $appConfig, $this->h->logger, $this->s->store, $this->s->sync,
            $this->L->t->store, $this->L->store, $this->h->commentService);
    }

    /** @return array<string, mixed> what the reconciliation may change */
    private function state(): array {
        $h = $this->h;
        return [
            'shares' => array_values(array_map(static fn (array $r): string => $r['board_id'] . ':' . $r['kind'] . ':' . $r['recipient'], $h->shareRows->rows)),
            'members' => $h->boards->members,
            'boards' => array_keys($h->boards->boards),
            'acl' => array_map(static fn (array $b): int => $b['acl_gen'], $h->boards->boards),
            'votes' => $this->votes,
        ];
    }

    private const ONES = ['user-shares' => 1, 'group-shares' => 1, 'link-members' => 1, 'open-votes' => 1, 'owned-boards' => 1, 'shape-libraries' => 0, 'template-suggestions' => 0];
    private const ZEROS = ['user-shares' => 0, 'group-shares' => 0, 'link-members' => 0, 'open-votes' => 0, 'owned-boards' => 0, 'shape-libraries' => 0, 'template-suggestions' => 0];

    public function testScanFindsExactlyTheMissingIds(): void {
        $this->assertSame(['users' => ['dave', 'mem', 'owen'], 'groups' => ['ghostgrp'], 'folders' => [], 'claims' => []], $this->r->scan());
        $this->assertSame(self::ONES, $this->r->count(['dave', 'mem', 'owen'], ['ghostgrp']));
        $this->assertSame(['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards', 'shape-libraries', 'template-suggestions'], OrphanReconciler::KINDS);
    }

    public function testDryRunChangesNothingAndCountsLikeTheRealRun(): void {
        $before = $this->state();
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(true));
        $this->assertSame($before, $this->state(), 'nothing changed');
        $this->assertSame([], $this->appWrites, 'the memo is neither read for a decision nor written');
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(false), 'the same numbers on the same state');
        $after = $this->state();
        $this->assertSame([$this->id['U'] . ':user:bob', $this->id['G'] . ':group:staff'], $after['shares'], 'the shares of dave and ghostgrp are gone, the others stay');
        $this->assertSame(['carol'], array_keys($after['members'][$this->id['U']]), 'mem\'s membership is gone, carol\'s stays');
        $this->assertNotContains($this->id['O'], $after['boards'], 'owen\'s board is deleted');
        $this->assertContains($this->id['K'], $after['boards']);
        $this->assertSame([$this->h->access->pid($this->id['U'], 'u:carol')], array_column($after['votes'], 'voter'), 'mem\'s vote row is gone');
        $this->assertSame(4, $this->sessions[7]['seq'], 'seq + 1 like the listener');
        $this->assertGreaterThan($before['acl'][$this->id['U']], $after['acl'][$this->id['U']], 'U: acl_gen + 1 (rights die at once)');
        $this->assertGreaterThan($before['acl'][$this->id['G']], $after['acl'][$this->id['G']], 'G: acl_gen + 1');
        $this->assertSame($before['acl'][$this->id['K']], $after['acl'][$this->id['K']], 'an untouched board keeps its generation');
        $this->assertSame(['counts' => self::ZEROS, 'failed' => 0], $this->r->reconcile(false), 'a second run finds nothing');
    }

    public function testEachKindCountsOnItsOwn(): void {
        // A share on the board of a missing owner counts in user-shares AND its board in owned-boards.
        $this->h->shareRows->add($this->id['O'], 'user', 'dave', 'view');
        $this->h->shareRows->add($this->id['O'], 'user', 'bob', 'edit');
        $this->h->boards->addMember($this->id['O'], 'mem', 'vote', null, 0);
        $this->assertSame(['user-shares' => 2, 'group-shares' => 1, 'link-members' => 2, 'open-votes' => 1, 'owned-boards' => 1, 'shape-libraries' => 0, 'template-suggestions' => 0], $this->r->reconcile(true)['counts']);
        $this->assertSame(['user-shares' => 2, 'group-shares' => 1, 'link-members' => 2, 'open-votes' => 1, 'owned-boards' => 1, 'shape-libraries' => 0, 'template-suggestions' => 0], $this->r->reconcile(false)['counts']);
        $this->assertSame(self::ZEROS, $this->r->reconcile(true)['counts']);
    }

    public function testDailyTwoRunRule(): void {
        $before = $this->state();
        $this->assertSame(['reconciled' => 0, 'failed' => 0, 'candidates' => 4], $this->r->daily(self::T0), 'first run: only remembered');
        $this->assertSame($before, $this->state());
        $this->assertSame(['u:dave' => self::T0, 'u:mem' => self::T0, 'u:owen' => self::T0, 'g:ghostgrp' => self::T0],
            json_decode($this->app['orphan_candidates'], true), 'accounts first, then groups, each sorted');
        $this->assertSame(['orphan_candidates lazy'], $this->appWrites, 'lazy app config');
        // owen comes back (the user backend answered again) before the 20 h are over.
        $this->h->deletedUsers = ['dave', 'mem'];
        $this->assertSame(['reconciled' => 0, 'failed' => 0, 'candidates' => 3], $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS - 1), '19:59:59.999 later: still waiting');
        $this->assertSame($before, $this->state());
        $this->assertArrayNotHasKey('u:owen', json_decode($this->app['orphan_candidates'], true), 'an id that exists again leaves the memo');
        $this->h->deletedUsers = ['dave', 'mem', 'owen'];
        $this->assertSame(['reconciled' => 3, 'failed' => 0, 'candidates' => 1], $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS),
            '20 h after the first time: dave, mem and ghostgrp; owen counts from his new first time');
        $this->assertSame(['u:owen' => self::T0 + OrphanReconciler::GRACE_MS], json_decode($this->app['orphan_candidates'], true));
        $after = $this->state();
        $this->assertSame([$this->id['U'] . ':user:bob', $this->id['G'] . ':group:staff'], $after['shares']);
        $this->assertContains($this->id['O'], $after['boards'], 'owen\'s board waits for its own 20 h');
        // occ handles at once and clears the memo of what it reconciled.
        $this->assertSame(['user-shares' => 0, 'group-shares' => 0, 'link-members' => 0, 'open-votes' => 0, 'owned-boards' => 1, 'shape-libraries' => 0, 'template-suggestions' => 0], $this->r->reconcile(false)['counts']);
        $this->assertArrayNotHasKey('orphan_candidates', $this->app, 'empty memo: the key is deleted');
    }

    public function testMemoHoldsAtMostAThousandIds(): void {
        for ($i = 0; $i < 1005; $i++) {
            $this->h->shareRows->add($this->id['K'], 'user', sprintf('gone%04d', $i), 'view');
            $this->h->deletedUsers[] = sprintf('gone%04d', $i);
        }
        // 1009 orphan ids (dave, gone0000–gone1004, mem, owen; ghostgrp): the memo takes 1000.
        $this->assertSame(1000, $this->r->daily(self::T0)['candidates']);
        $memo = json_decode($this->app['orphan_candidates'], true);
        $this->assertCount(1000, $memo);
        $this->assertSame(['u:dave', 'u:gone0000'], array_slice(array_keys($memo), 0, 2));
        $this->assertSame('u:gone0998', array_key_last($memo), 'accounts sorted; the rest waits');
        $this->assertSame(1000, $this->r->daily(self::T0 + 1000)['candidates'], 'still full; known ids keep their first time');
        $this->assertSame(self::T0, json_decode($this->app['orphan_candidates'], true)['u:gone0998']);
        $r = $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS);
        $this->assertSame([1000, 0, 9], [$r['reconciled'], $r['failed'], $r['candidates']],
            'the 1000 remembered ones go; the 9 that waited (gone0999–gone1004, mem, owen, ghostgrp) are remembered now');
        $this->assertSame(self::T0 + OrphanReconciler::GRACE_MS, json_decode($this->app['orphan_candidates'], true)['g:ghostgrp']);
    }

    public function testAFailingIdIsReportedAndStaysInTheMemo(): void {
        $this->r->daily(self::T0);
        $this->h->shareRows->failWith = new \RuntimeException('database gone');
        $r = $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS);
        $this->assertGreaterThan(0, $r['failed']);
        $memo = json_decode($this->app['orphan_candidates'], true);
        $this->assertArrayHasKey('g:ghostgrp', $memo, 'the failed group stays for the next run with its first time');
        $this->assertSame(self::T0, $memo['g:ghostgrp']);
        $this->h->shareRows->failWith = null;
        $this->assertSame(0, $this->r->reconcile(false)['failed']);
    }

    public function testOccOutputAndExitCodes(): void {
        $run = function (array $args, ?OrphanReconciler $r = null): array {
            $cmd = new Orphans($r ?? $this->r);
            $out = new BufferedOutput();
            $code = $cmd->run(new ArrayInput($args), $out);
            return [$code, $out->fetch()];
        };
        $cmd = new Orphans($this->r);
        $this->assertSame('knorke:orphans', $cmd->getName());
        $this->assertTrue($cmd->getDefinition()->hasOption('dry-run'));
        $this->assertFalse($cmd->getDefinition()->getOption('dry-run')->acceptValue(), '--dry-run takes no value');
        $this->assertSame([], $cmd->getDefinition()->getArguments());
        [$code, $text] = $run(['--dry-run' => true]);
        $this->assertSame([0, "user-shares: 1\ngroup-shares: 1\nlink-members: 1\nopen-votes: 1\nowned-boards: 1\nshape-libraries: 0\ntemplate-suggestions: 0\nDry run: nothing was changed.\n"], [$code, $text]);
        [$code, $text] = $run([]);
        $this->assertSame([0, "user-shares: 1\ngroup-shares: 1\nlink-members: 1\nopen-votes: 1\nowned-boards: 1\nshape-libraries: 0\ntemplate-suggestions: 0\n"], [$code, $text]);
        [$code, $text] = $run([]);
        $this->assertSame([0, "user-shares: 0\ngroup-shares: 0\nlink-members: 0\nopen-votes: 0\nowned-boards: 0\nshape-libraries: 0\ntemplate-suggestions: 0\n"], [$code, $text], 'exit 0 also with all 0');
        // A failing id → exit 1 (message on stderr; BufferedOutput is not a console output, so it lands here).
        $this->h->shareRows->add($this->id['K'], 'group', 'ghost2', 'view');
        $this->h->shareRows->failWith = new \RuntimeException('database gone');
        [$code, $text] = $run([]);
        $this->assertSame(1, $code);
        $this->assertStringContainsString("group-shares: 1\n", $text);
        $this->assertStringContainsString('could not be cleaned up completely', $text);
        // The run cannot start → exit 1.
        $broken = new class() extends OrphanReconciler {
            public function __construct() {
            }

            public function reconcile(bool $dryRun): array {
                throw new \RuntimeException('no database');
            }
        };
        [$code, $text] = $run([], $broken);
        $this->assertSame(1, $code);
        $this->assertStringContainsString('could not run', $text);
    }

    /** A board of the lock harness with ghost's lock and a guest's and bob's (job 023, AK5). */
    private function seedLocks(): string {
        $st = $this->s->store;
        $st->addBoard(1, 10);
        $note = ['t' => 'sticky', 'x' => 0, 'y' => 0, 'z' => 'i1', 'data' => ['text' => 'n'], 'style' => ['fill' => '#a8d8f8']];
        foreach ([1 => 'u:ghost', 2 => 'g:gAbcdefghijk', 3 => 'u:bob'] as $n => $by) {
            $id = sprintf('01JM%022d', $n);
            $st->seed(1, $id, $note, 5);
            $st->seedLock(1, $id, $by, ucfirst(substr($by, 2)));
        }
        $this->h->deletedUsers[] = 'ghost';
        return sprintf('01JM%022d', 1);
    }

    public function testTheMentionsOfAMissingAccountBecomeDeletedUserOnlyInARealRun(): void {
        // factory job 249, AK3: dave (an orphan through his share on U) is
        // mentioned in a comment on U; no count of its own.
        $c = $this->h->comments->manager()->create('users', 'bob', 'knorke_board', (string)$this->id['U']);
        $c->setVerb('comment');
        $c->setParentId('0');
        $c->setMessage('Ask @"dave" and @"bob"', 0);
        $c->setMetaData(['knorke' => ['name' => null, 'edited' => null, 'mentions' => ['dave', 'bob']]]);
        $this->h->comments->manager()->save($c);
        $id = $c->getId();
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(true));
        $this->assertSame('Ask @"dave" and @"bob"', $this->h->comments->rows[$id]->getMessage(), 'the dry run changes no comment');
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(false), 'the same numbers');
        $this->assertSame('Ask @"deleted_users" and @"bob"', $this->h->comments->rows[$id]->getMessage());
        $this->assertSame(['bob'], $this->h->comments->knorke($id)['mentions']);
    }

    public function testLockersAreScannedAndClearedWithoutACountOfTheirOwn(): void {
        // AK5: ghost only holds a lock; scan finds ghost (no guest, no existing
        // account), the five counts stay those without the lock, a dry run
        // changes nothing, a real run empties ghost's locker (still locked).
        $ghostItem = $this->seedLocks();
        $this->assertSame(['users' => ['dave', 'ghost', 'mem', 'owen'], 'groups' => ['ghostgrp'], 'folders' => [], 'claims' => []], $this->r->scan());
        $lockRows = $this->s->store->items;
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(true));
        $this->assertSame($lockRows, $this->s->store->items, 'the dry run changes no lock');
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(false), 'the same five numbers');
        $this->assertSame([1, null, null], $this->s->store->lockOf(1, $ghostItem));
        $this->assertSame(11, $this->s->store->boards[1]['rev']);
        $this->assertSame([1, 'g:gAbcdefghijk', 'GAbcdefghijk'], $this->s->store->lockOf(1, sprintf('01JM%022d', 2)));
        $this->assertSame([1, 'u:bob', 'Bob'], $this->s->store->lockOf(1, sprintf('01JM%022d', 3)));
        $this->assertSame(['users' => [], 'groups' => [], 'folders' => [], 'claims' => []], $this->r->scan(), 'nothing left');
    }

    public function testARememberedLockOfAMissingAccountIsFoundAndCleared(): void {
        // Job 152 AK5: ghost only holds a remembered lock (locked 0, after an
        // unlock); scan finds ghost, the five counts stay, a real run empties
        // locked_by and locked_name (locked stays 0); a restore with ghost's
        // pid then leaves the item free.
        $st = $this->s->store;
        $st->addBoard(1, 10);
        $id = sprintf('01JM%022d', 7);
        $st->seed(1, $id, ['t' => 'sticky', 'x' => 0, 'y' => 0, 'z' => 'i1', 'data' => ['text' => 'n'], 'style' => ['fill' => '#a8d8f8']], 5);
        $st->seedLock(1, $id, 'u:ghost', 'Ghost', 0);
        $this->h->deletedUsers[] = 'ghost';
        $this->assertSame(['users' => ['dave', 'ghost', 'mem', 'owen'], 'groups' => ['ghostgrp'], 'folders' => [], 'claims' => []], $this->r->scan());
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(true));
        $this->assertSame([0, 'u:ghost', 'Ghost'], $st->lockOf(1, $id), 'the dry run changes nothing');
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(false), 'the same five numbers');
        $this->assertSame([0, null, null], $st->lockOf(1, $id), 'the name of the missing account is gone, the item stays free');
        $this->assertSame(['users' => [], 'groups' => [], 'folders' => [], 'claims' => []], $this->r->scan(), 'nothing left');
        $restore = ['o' => 'patch', 'id' => $id, 'p' => ['lock' => ['by' => Access::derivePid(SyncHarness::SECRET, 1, 'u:ghost'), 'name' => 'Ghost']], 'restore' => true];
        $this->assertSame(['ok'], $this->s->apply([$restore], SyncHarness::user())[1]);
        $this->assertSame([0, null, null], $st->lockOf(1, $id), 'a restore with ghost\'s pid finds nobody: free');
    }

    public function testDailyClearsALockerOnlyInTheSecondRun(): void {
        $ghostItem = $this->seedLocks();
        $this->r->daily(self::T0);
        $this->assertSame([1, 'u:ghost', 'Ghost'], $this->s->store->lockOf(1, $ghostItem), 'first run: only remembered');
        $this->assertArrayHasKey('u:ghost', json_decode($this->app['orphan_candidates'], true));
        $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS - 1);
        $this->assertSame([1, 'u:ghost', 'Ghost'], $this->s->store->lockOf(1, $ghostItem), 'still waiting');
        $r = $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS);
        $this->assertSame(0, $r['failed']);
        $this->assertSame([1, null, null], $this->s->store->lockOf(1, $ghostItem), '20 h after the first time');
        $this->assertArrayNotHasKey('u:ghost', json_decode($this->app['orphan_candidates'] ?? '{}', true) ?? []);
    }

    // --- Job 247: shape libraries and template suggestions -------------------

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    /** An own library of $uid (an account of the ShapeLibHarness, added if new); returns its id. */
    private function lib(string $uid, string $name = 'Logos'): int {
        $this->L->t->names[$uid] ??= ucfirst($uid);
        return $this->L->store->create($this->L->t->user($uid), ['name' => $name, 'entries' => [['name' => 'Geheimlogo', 'img' => self::PNG, 'w' => 64, 'h' => 32]]], self::T0)['id'];
    }

    /** A pending template suggestion of $uid; returns its id. */
    private function suggestion(string $uid): int {
        $this->L->t->names[$uid] ??= ucfirst($uid);
        $board = json_encode(['knorke' => 1, 'kind' => 'board', 'title' => '', 'origin' => [0, 0], 'items' => [['id' => sprintf('01JT%022d', 1), 't' => 'sticky',
            'x' => 0, 'y' => 0, 'w' => 200, 'h' => 200, 'r' => 0, 'parent' => null, 'data' => ['text' => 'n'], 'style' => ['fill' => '#fff6b6'], 'group' => null]]], JSON_THROW_ON_ERROR);
        return $this->L->t->store->create($this->L->t->user($uid), ['name' => 'Retro', 'note' => 'Private Notiz an Admins', 'content' => $board,
            'sketch' => [[4, 10.5, 50, 30, '']]], self::T0)['id'];
    }

    /** Removes the owner file of $uid's folder (a folder from before job 247); returns the folder's hash part. */
    private function unown(string $uid): string {
        unset($this->L->files[ShapeLibStore::userFolder($uid)][ShapeLibStore::OWNER]);
        return ShapeLibStore::folderHash($uid);
    }

    /** @param array<string, int> $extra */
    private static function ones(array $extra): array {
        return array_replace(self::ONES, $extra);
    }

    public function testLibrariesAndSuggestionsOfAMissingAccountGoLikeTheListener(): void {
        // AK1: zoe has a library (suggested to the admins) and a template
        // suggestion; she is deleted without the listener.
        $lib = $this->lib('zoe');
        $this->assertSame('pending', $this->L->store->suggest($this->L->t->user('zoe'), $lib, [], self::T0)['state']);
        $this->suggestion('zoe');
        $this->h->deletedUsers[] = 'zoe';
        $files = $this->L->files;
        $this->assertSame(['dave', 'mem', 'owen', 'zoe'], $this->r->scan()['users']);
        $this->assertSame(['counts' => self::ones(['shape-libraries' => 1, 'template-suggestions' => 1]), 'failed' => 0], $this->r->reconcile(true));
        $this->assertSame($files, $this->L->files, 'the dry run changes no file');
        $this->assertCount(1, $this->L->t->rows(), 'nor a row');
        $this->assertSame(['counts' => self::ones(['shape-libraries' => 1, 'template-suggestions' => 1]), 'failed' => 0], $this->r->reconcile(false));
        $this->assertArrayNotHasKey(ShapeLibStore::userFolder('zoe'), $this->L->files, 'her folder is gone');
        $this->assertSame([], $this->L->files[ShapeLibStore::FOLDER_PENDING] ?? [], 'her open suggestion is gone');
        $this->assertSame([], $this->L->t->rows(), 'her template suggestion is gone');
        // A new account zoe (another person) finds nothing.
        $this->assertSame([], $this->L->store->listFor($this->L->t->user('zoe'))['own']);
        $this->assertSame([], $this->L->t->store->listFor($this->L->t->user('zoe'))['pending']);
        $this->assertSame(['counts' => self::ZEROS, 'failed' => 0], $this->r->reconcile(false), 'a second run finds nothing');
    }

    public function testAnOpenSuggestionAloneFindsItsMissingAccount(): void {
        // The folder is gone already, the marker still names zoe: removed, no count.
        $lib = $this->lib('zoe');
        $this->L->store->suggest($this->L->t->user('zoe'), $lib, [], self::T0);
        unset($this->L->files[ShapeLibStore::userFolder('zoe')]);
        $this->h->deletedUsers[] = 'zoe';
        $this->assertContains('zoe', $this->r->scan()['users']);
        $this->assertSame(['counts' => self::ONES, 'failed' => 0], $this->r->reconcile(false));
        $this->assertSame([], $this->L->files[ShapeLibStore::FOLDER_PENDING]);
    }

    public function testAFolderWithoutOwnerGoesOnlyWhenNoAccountMatchesIt(): void {
        // AK2: bob's and ghost2's folders lost their owner file (made before
        // job 247); bob is listed by Nextcloud, ghost2 is not.
        $this->lib('bob');
        $this->lib('ghost2');
        $this->lib('ghost2', 'Fotos');
        $bob = $this->unown('bob');
        $ghost = $this->unown('ghost2');
        $this->assertSame(['users' => ['dave', 'mem', 'owen'], 'groups' => ['ghostgrp'], 'folders' => [$ghost], 'claims' => [$bob => 'bob']], $this->r->scan());
        $this->assertSame(['counts' => self::ones(['shape-libraries' => 2]), 'failed' => 0], $this->r->reconcile(true));
        $this->assertArrayNotHasKey(ShapeLibStore::OWNER, $this->L->files[ShapeLibStore::userFolder('bob')], 'the dry run writes no owner file');
        $this->assertArrayHasKey(ShapeLibStore::userFolder('ghost2'), $this->L->files);
        $this->assertSame(['counts' => self::ones(['shape-libraries' => 2]), 'failed' => 0], $this->r->reconcile(false));
        $this->assertArrayNotHasKey(ShapeLibStore::userFolder('ghost2'), $this->L->files, 'the orphan folder is gone');
        $this->assertSame('{"uid":"bob"}', $this->L->files[ShapeLibStore::userFolder('bob')][ShapeLibStore::OWNER], 'bob\'s folder has its owner now');
        $this->assertCount(1, $this->L->store->listFor($this->L->t->user('bob'))['own'], 'bob keeps his library');
        $this->assertSame(['users' => [], 'groups' => [], 'folders' => [], 'claims' => []], $this->r->scan());
    }

    public function testAFailingOrEmptyAccountListingDeletesNoFolder(): void {
        // AK3 (risk: a user backend that answers only partly or not at all).
        $this->lib('ghost2');
        $this->unown('ghost2');
        $files = $this->L->files;
        $this->listFail = new \RuntimeException('LDAP gone');
        $this->assertSame([], $this->r->scan()['folders']);
        $this->assertSame(0, $this->r->reconcile(false)['counts']['shape-libraries']);
        $this->assertSame($files, $this->L->files, 'listing throws: the folder stays');
        $this->listFail = null;
        $this->accounts = [];
        $this->assertSame(['users' => [], 'groups' => [], 'folders' => [], 'claims' => []], $this->r->scan());
        $this->r->reconcile(false);
        $this->r->daily(self::T0);
        $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS);
        $this->assertSame($files, $this->L->files, 'no account listed: the folder stays');
    }

    public function testDailyRemovesFoldersAndSuggestionsOnlyInTheSecondRun(): void {
        // AK5: zoe only has a template suggestion; ghost2's folder has no owner.
        $this->suggestion('zoe');
        $this->h->deletedUsers[] = 'zoe';
        $this->lib('ghost2');
        $ghost = $this->unown('ghost2');
        $this->r->daily(self::T0);
        $memo = json_decode($this->app['orphan_candidates'], true);
        $this->assertSame(self::T0, $memo['u:zoe']);
        $this->assertSame(self::T0, $memo['f:' . $ghost]);
        $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS - 1);
        $this->assertCount(1, $this->L->t->rows(), 'still waiting');
        $this->assertArrayHasKey(ShapeLibStore::userFolder('ghost2'), $this->L->files);
        $r = $this->r->daily(self::T0 + OrphanReconciler::GRACE_MS);
        $this->assertSame(0, $r['failed']);
        $this->assertSame([], $this->L->t->rows());
        $this->assertArrayNotHasKey(ShapeLibStore::userFolder('ghost2'), $this->L->files);
        $memo = json_decode($this->app['orphan_candidates'] ?? '{}', true);
        $this->assertArrayNotHasKey('u:zoe', $memo);
        $this->assertArrayNotHasKey('f:' . $ghost, $memo);
    }

    public function testOccPrintsSevenLinesAndAFailingFolderExitsOne(): void {
        // AK6
        $this->lib('ghost2');
        $this->unown('ghost2');
        $this->suggestion('zoe');
        $this->h->deletedUsers[] = 'zoe';
        $out = new BufferedOutput();
        $this->assertSame(0, (new Orphans($this->r))->run(new ArrayInput(['--dry-run' => true]), $out));
        $this->assertSame("user-shares: 1\ngroup-shares: 1\nlink-members: 1\nopen-votes: 1\nowned-boards: 1\nshape-libraries: 1\ntemplate-suggestions: 1\nDry run: nothing was changed.\n", $out->fetch());
        $this->L->deleteFail = new \RuntimeException('storage gone');
        $out = new BufferedOutput();
        $this->assertSame(1, (new Orphans($this->r))->run(new ArrayInput([]), $out));
        $this->assertStringContainsString('could not be cleaned up completely', $out->fetch());
        $this->assertArrayHasKey(ShapeLibStore::userFolder('ghost2'), $this->L->files);
        $this->L->deleteFail = null;
        $this->assertSame(0, $this->r->reconcile(false)['failed'], 'the next run finishes it');
        $this->assertArrayNotHasKey(ShapeLibStore::userFolder('ghost2'), $this->L->files);
    }

    public function testAFolderWithoutOwnerOfAnAccountFoundAnotherWayCountsOnce(): void {
        // Fresh review round 1: dave (deleted, has a share) owns a folder from
        // before job 247 with one library; it belongs to dave, never a second orphan.
        $this->lib('dave');
        $hash = $this->unown('dave');
        $found = $this->r->scan();
        $this->assertContains('dave', $found['users']);
        $this->assertSame([], $found['folders'], 'not counted twice');
        $this->assertSame(['counts' => self::ones(['shape-libraries' => 1]), 'failed' => 0], $this->r->reconcile(true));
        $out = new BufferedOutput();
        $this->assertSame(0, (new Orphans($this->r))->run(new ArrayInput([]), $out), $out->fetch());
        $this->assertFalse($this->L->store->folderExists($hash), 'deleted with dave');
        // The same with an open suggestion as the only other trace.
        $lib = $this->lib('zoe');
        $this->L->store->suggest($this->L->t->user('zoe'), $lib, [], self::T0);
        $this->unown('zoe');
        $this->h->deletedUsers[] = 'zoe';
        $this->assertSame(1, $this->r->reconcile(true)['counts']['shape-libraries']);
        $this->assertSame(0, $this->r->reconcile(false)['failed']);
        $this->assertArrayNotHasKey(ShapeLibStore::userFolder('zoe'), $this->L->files);
    }
}
