<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\BackgroundJob\VoteCloseJob;
use OCA\Knorke\Controller\ModerationApiController;
use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Listener\UserDeletedListener;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\VoteService;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Server;
use OCP\User\Events\UserDeletedEvent;

/**
 * The vote path on the dev stack's real database (any KD_DB kind) and Redis
 * (SPEC-M1 §8.2 PHP integration, stage 3): the SQL of VoteStore (joins on
 * live items, SUM/COUNT DISTINCT, LONGTEXT results), the board lock that
 * serialises voters across connections (second PHP processes with their
 * own connection), closing under load (results = the sum of what every
 * voter last saw, no vote row left, closed stays closed), the four ways of
 * closing at once (exactly one close, one meta write), UserDeletedEvent,
 * and the services built by the server container.
 */
final class VoteFlowIntegrationTest extends IntegrationCase {
    private VoteService $votes;

    protected function setUp(): void {
        parent::setUp();
        $this->votes = Server::get(VoteService::class);
    }

    private function stickies(int $b, int $n, int $from = 1): array {
        $ops = [];
        for ($i = $from; $i < $from + $n; $i++) {
            $ops[] = ['o' => 'put', 'id' => self::ulid($i), 't' => 'sticky', 'p' => ['x' => $i, 'y' => 0, 'w' => 200, 'h' => 200, 'z' => 'i1']];
        }
        $this->sync->applyOps($this->owner($b), $b, 'cIT', $ops, self::nowMs());
        return array_map(static fn (array $o): string => $o['id'], $ops);
    }

    private static function voter(string $pid): Principal {
        return new Principal('u:' . $pid, Role::Vote, 'Voter', substr($pid, 0, 16), false, $pid, 'share');
    }

    private static function op(int $sid, string $item, int $n): array {
        return ['o' => 'vote', 's' => $sid, 'id' => $item, 'n' => $n];
    }

    /**
     * One row of a query, the cursor closed: an open statement keeps an
     * SQLite (WAL) read snapshot alive, and a poll on it never sees the
     * commits of the other processes.
     */
    private function one(string $sql, array $params): array|false {
        $res = $this->db->executeQuery($sql, $params);
        $row = $res->fetchAssociative();
        $res->closeCursor();
        return $row;
    }

    private function session(int $sid): array {
        return $this->one('SELECT state, seq, voters, results, closed_at FROM *PREFIX*knorke_vote_sessions WHERE id = ?', [$sid]);
    }

    private function voteRows(int $sid): int {
        return (int)$this->one('SELECT COUNT(*) AS n FROM *PREFIX*knorke_votes WHERE session_id = ?', [$sid])['n'];
    }

    private function meta(int $b): array {
        return MetaService::decode($this->one('SELECT meta FROM *PREFIX*knorke_boards WHERE id = ?', [$b])['meta'] ?? null);
    }

    /**
     * Starts child processes (tests/php/Support/vote-child.php), waits until
     * every one is ready, releases them at once and returns their results.
     *
     * @param list<array> $cmds
     * @param \Closure|null $whileRunning runs in this process after the release
     * @param \Closure|null $beforeRelease runs when every child is ready, before the release
     *   (SQLite locks the whole file: a lock taken earlier would block the children's bootstrap)
     * @return list<array>
     */
    private function children(array $cmds, ?\Closure $whileRunning = null, ?\Closure $beforeRelease = null): array {
        $procs = [];
        foreach ($cmds as $cmd) {
            $env = getenv() + ['KT_NC' => \OC::$SERVERROOT, 'KT_CMD' => json_encode($cmd)];
            $proc = proc_open([PHP_BINARY, dirname(__DIR__) . '/Support/vote-child.php'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
            $this->assertIsResource($proc);
            $procs[] = [$proc, $pipes];
        }
        foreach ($procs as [$proc, $pipes]) {
            $line = fgets($pipes[1]);
            if ($line !== "ready\n") {
                $this->fail('child not ready: ' . var_export($line, true) . ' ' . stream_get_contents($pipes[2]));
            }
        }
        if ($beforeRelease !== null) {
            $beforeRelease();
        }
        foreach ($procs as [$proc, $pipes]) {
            fwrite($pipes[0], "go\n");
            fflush($pipes[0]);
        }
        if ($whileRunning !== null) {
            $whileRunning();
        }
        $out = [];
        foreach ($procs as [$proc, $pipes]) {
            $line = (string)fgets($pipes[1]);
            $err = stream_get_contents($pipes[2]);
            foreach ($pipes as $p) {
                fclose($p);
            }
            proc_close($proc);
            $d = json_decode($line, true);
            if (!is_array($d)) {
                $this->fail('child failed: ' . var_export($line, true) . ' ' . $err);
            }
            $out[] = $d;
        }
        return $out;
    }

    public function testVoteSqlOnThisDatabase(): void {
        $b = $this->board();
        $items = $this->stickies($b, 3);
        $p = $this->owner($b);
        $out = $this->votes->start($p, $b, ['per' => 4, 'perItem' => 2, 'minutes' => 30], self::nowMs());
        $sid = $out['meta']['vote']['sid'];
        $this->assertSame(['sid' => $sid, 'seq' => 0], $this->cache->getVoteSeq($b));
        $this->assertSame((int)$this->one('SELECT meta_rev FROM *PREFIX*knorke_boards WHERE id = ?', [$b])['meta_rev'], $this->dbRev($b), 'meta_rev = rev');
        $rev = $this->dbRev($b);
        $a = $this->votes->apply(self::voter('kt-voter-a00001'), $b, [self::op($sid, $items[0], 2), self::op($sid, $items[1], 2), self::op($sid, $items[2], 1)], self::nowMs());
        $this->assertSame([['ok', 'ok', 'limit'], [$items[0] => 2, $items[1] => 2], 0], [$a['res'], $a['mine'], $a['left']]);
        $this->votes->apply(self::voter('kt-voter-b00001'), $b, [self::op($sid, $items[1], 1)], self::nowMs());
        $this->assertSame($rev, $this->dbRev($b), 'votes never raise the board rev');
        $this->assertSame(['sid' => $sid, 'seq' => 2], $this->cache->getVoteSeq($b));
        // Only live items count (R16): remove item 0 through the object path.
        $this->sync->applyOps($p, $b, 'cIT', [['o' => 'remove', 'id' => $items[0]]], self::nowMs());
        $this->assertSame(['sid' => $sid, 'mine' => [$items[1] => 2], 'left' => 2], $this->votes->mine($b, 'kt-voter-a00001'));
        $this->assertSame(['sid' => $sid, 'voters' => 2, 'vt' => 2], $this->votes->progress($p, $b, 0, self::nowMs()));
        $ok = $this->votes->apply(self::voter('kt-voter-a00001'), $b, [self::op($sid, $items[0], 0)], self::nowMs());
        $this->assertSame(['ok'], $ok['res'], 'n = 0 on the deleted item');
        $closed = $this->votes->update($p, $b, 'end', null, self::nowMs());
        $vote = $closed['meta']['vote'];
        $this->assertSame(['closed', [[$items[1], 3]], 1, 2], [$vote['state'], $vote['results'], $vote['total'], $vote['voters']]);
        $s = $this->session($sid);
        $this->assertSame(['closed', 2, [$items[1] => 3]], [$s['state'], (int)$s['voters'], json_decode($s['results'], true)]);
        $this->assertSame(0, $this->voteRows($sid));
        $this->assertSame($this->dbRev($b), $closed['metaRev']);
        $this->assertSame($closed['metaRev'], $this->cache->getRev($b), 'bumped after the COMMIT');
    }

    public function testVotersAreSerialisedByTheBoardLock(): void {
        // While another connection holds the board row lock, a vote batch of
        // a second process waits for it (lockBoard is its first statement).
        $b = $this->board();
        $items = $this->stickies($b, 2);
        $sid = $this->votes->start($this->owner($b), $b, ['per' => 1], self::nowMs())['meta']['vote']['sid'];
        try {
            $res = $this->children([['cmd' => 'apply', 'board' => $b, 'sid' => $sid, 'pid' => 'kt-lock-voter01', 'ops' => [[$items[0], 1]]]],
                function (): void {
                    usleep(1500000);
                    $this->db->commit();
                }, function () use ($b): void {
                    $this->db->beginTransaction();
                    $this->boards->lockBoard($b, false, null, self::nowMs());
                });
        } finally {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
        }
        // The child finished only after the commit: it read its answer after the release.
        $this->assertSame(['ok'], $res[0]['res']);
        $this->assertGreaterThan(1000, $res[0]['ms'], self::dbKind() . ': the vote waited for the board row lock');
        fwrite(STDERR, sprintf("\n[WP-B3] a vote batch of a second process waited %d ms for the board row lock held 1500 ms (%s)\n", $res[0]['ms'], self::dbKind()));
        // Two tabs of one voter spend the last vote at the same moment: exactly one wins.
        for ($round = 0; $round < 4; $round++) {
            $pid = sprintf('kt-race-%07d', $round);
            $res = $this->children([
                ['cmd' => 'apply', 'board' => $b, 'sid' => $sid, 'pid' => $pid, 'ops' => [[$items[0], 1]]],
                ['cmd' => 'apply', 'board' => $b, 'sid' => $sid, 'pid' => $pid, 'ops' => [[$items[1], 1]]],
            ]);
            $codes = [$res[0]['res'][0], $res[1]['res'][0]];
            sort($codes);
            $this->assertSame(['limit', 'ok'], $codes, "round $round: the budget is checked under the lock");
            $this->assertSame(1, (int)$this->one('SELECT COUNT(*) AS n FROM *PREFIX*knorke_votes WHERE session_id = ? AND voter = ?', [$sid, $pid])['n']);
        }
    }

    public function testClosingUnderLoad(): void {
        // Six voters keep voting (one batch, then 10 ms, like hurried people;
        // without a pause SQLite finishes before its busy handler lets the
        // closer in) while the moderator ends the session. Every
        // batch before the close counts, every batch after it is `closed`;
        // the frozen results are exactly what the voters last saw.
        $b = $this->board();
        $items = $this->stickies($b, 12);
        $sid = $this->votes->start($this->owner($b), $b, ['per' => 99], self::nowMs())['meta']['vote']['sid'];
        $cmds = [];
        for ($v = 0; $v < 6; $v++) {
            $cmds[] = ['cmd' => 'loop', 'board' => $b, 'sid' => $sid, 'pid' => sprintf('kt-load-%07d', $v), 'items' => $items, 'rounds' => 200, 'seed' => $v, 'gapUs' => 10000];
        }
        $closedAt = null;
        $timing = [];
        $res = $this->children($cmds, function () use ($b, $sid, &$closedAt, &$timing): void {
            // Close once the load is under way (200 effective batches), whatever the speed of the database.
            $t0 = microtime(true);
            $deadline = $t0 + 20;
            while (($seq = (int)$this->session($sid)['seq']) < 200 && microtime(true) < $deadline) {
                usleep(5000);
            }
            $timing = ['seenSeq' => $seq, 'closeStartMs' => (int)((microtime(true) - $t0) * 1000)];
            $closedAt = $this->votes->update($this->owner($b), $b, 'end', null, self::nowMs())['meta']['vote'];
            $timing['closeEndMs'] = (int)((microtime(true) - $t0) * 1000);
        });
        $sum = [];
        $voters = 0;
        $sawBoth = 0;
        foreach ($res as $i => $r) {
            $first = array_search('closed', $r['res'], true);
            if ($first !== false) {
                $this->assertSame([], array_values(array_diff(array_slice($r['res'], $first), ['closed'])), "voter $i: closed stays closed");
                $sawBoth += $first > 0 ? 1 : 0;
            }
            $this->assertSame([], array_values(array_diff($r['res'], ['ok', 'closed'])), "voter $i: only ok or closed");
            foreach ($r['last'] ?? [] as $item => $n) {
                $sum[$item] = ($sum[$item] ?? 0) + $n;
            }
            $voters += ($r['last'] ?? []) === [] ? 0 : 1;
        }
        $this->assertGreaterThan(0, $sawBoth, 'the close fell into the load (some voter saw ok, then closed): '
            . json_encode(array_map(static fn (array $r): array => array_count_values($r['res']) + ['ms' => $r['ms']], $res)) . ' ' . json_encode($timing));
        ksort($sum);
        $s = $this->session($sid);
        $results = json_decode($s['results'], true);
        ksort($results);
        $this->assertSame(['closed', $sum, $voters], [$s['state'], $results, (int)$s['voters']]);
        $this->assertSame(0, $this->voteRows($sid));
        $this->assertSame($closedAt['voters'], $voters);
        $this->assertSame(count($sum), $closedAt['total']);
        $all = array_merge(...array_map(static fn (array $r): array => $r['res'], $res));
        fwrite(STDERR, sprintf("\n[WP-B3] close under load: 6 voters × 200 batches (10 ms apart), %d ok before / %d closed after the close (closed at seq %d after %d ms, the close took %d ms), %d voters saw both, results %d items = Σ last mine, voters %d (%s)\n",
            count(array_keys($all, 'ok', true)), count(array_keys($all, 'closed', true)), $timing['seenSeq'], $timing['closeStartMs'],
            $timing['closeEndMs'] - $timing['closeStartMs'], $sawBoth, count($sum), $voters, self::dbKind()));
    }

    public function testFourWaysOfClosingAtOnce(): void {
        // (a) a vote op, (b) a moderator poll, (c) `end`, (d) the job, all
        // against one expired session at the same moment: one close, one
        // meta write, one result (§4.12.1, R2).
        $b = $this->board();
        $items = $this->stickies($b, 2);
        for ($round = 0; $round < 3; $round++) {
            $sid = $this->votes->start($this->owner($b), $b, ['minutes' => 5], self::nowMs())['meta']['vote']['sid'];
            $this->votes->apply(self::voter('kt-four-voter01'), $b, [self::op($sid, $items[$round % 2], 1)], self::nowMs());
            // vote-expire (§8.4, R16): ends_at in the past, meta and revs unchanged, vt: gone.
            $this->db->executeStatement('UPDATE *PREFIX*knorke_vote_sessions SET ends_at = ? WHERE id = ?', [self::nowMs() - 1, $sid]);
            $this->redis->remove('vt:' . $b);
            $rev = $this->dbRev($b);
            $res = $this->children([
                ['cmd' => 'apply', 'board' => $b, 'sid' => $sid, 'pid' => 'kt-four-voter02', 'ops' => [[$items[0], 1]]],
                ['cmd' => 'progress', 'board' => $b],
                ['cmd' => 'end', 'board' => $b],
                ['cmd' => 'job'],
            ]);
            $this->assertSame(['closed'], $res[0]['res'], "round $round (a)");
            $this->assertNull($res[1]['progress'], "round $round (b)");
            $this->assertContains($res[2]['status'], [200, 409], "round $round (c)");
            $this->assertContains($res[3]['closed'], [0, 1], "round $round (d)");
            $this->assertSame($rev + 1, $this->dbRev($b), "round $round: exactly one meta write");
            $vote = $this->meta($b)['vote'];
            $this->assertSame(['closed', [[$items[$round % 2], 1]], 1], [$vote['state'], $vote['results'], $vote['voters']], "round $round");
            $this->assertSame(0, $this->voteRows($sid));
        }
    }

    public function testUserDeletedTakesTheVotesOfThePid(): void {
        $b = $this->board();
        $items = $this->stickies($b, 2);
        $sid = $this->votes->start($this->owner($b), $b, [], self::nowMs())['meta']['vote']['sid'];
        $uid = $this->uid . '-v';
        $account = Server::get(IUserManager::class)->createUser($uid, 'Kt1!' . bin2hex(random_bytes(12)));
        $this->assertInstanceOf(IUser::class, $account);
        try {
            $pid = $this->access->pid($b, 'u:' . $uid);
            $p = new Principal('u:' . $uid, Role::Vote, $uid, $pid, false, $uid, 'link');
            $this->assertSame(['ok'], $this->votes->apply($p, $b, [self::op($sid, $items[0], 1)], self::nowMs())['res']);
            $this->votes->apply(self::voter('kt-other-vote01'), $b, [self::op($sid, $items[1], 1)], self::nowMs());
            $seq = (int)$this->session($sid)['seq'];
            Server::get(UserDeletedListener::class)->handle(new UserDeletedEvent($account));
            $this->assertSame(0, (int)$this->one('SELECT COUNT(*) AS n FROM *PREFIX*knorke_votes WHERE session_id = ? AND voter = ?', [$sid, $pid])['n']);
            $this->assertSame(1, $this->voteRows($sid), 'the others stay');
            $this->assertSame($seq + 1, (int)$this->session($sid)['seq']);
            $this->assertSame(['sid' => $sid, 'seq' => $seq + 1], $this->cache->getVoteSeq($b), 'R16: vt: after the COMMIT');
        } finally {
            $account->delete();
        }
    }

    public function testFourByteNamesInMeta(): void {
        // Moderator names land in meta (vote.by, timer.by, summon.name): on a
        // database without 4-byte UTF-8 (mysql.utf8mb4 = false) they are
        // stored with U+FFFD (MetaService, SPEC-M1 §3.9), never a 500.
        $b = $this->board();
        $want = $this->db->supports4ByteText() ? 'Mod 👍' : "Mod \u{FFFD}";
        $p = new Principal('u:' . $this->uid, Role::Owner, 'Mod 👍', $this->access->pid($b, 'u:' . $this->uid), false, $this->uid, 'owner');
        $this->assertSame($want, $this->votes->start($p, $b, [], self::nowMs())['meta']['vote']['by']);
        $moderation = Server::get(\OCA\Knorke\Service\ModerationService::class);
        $this->assertSame($want, $moderation->timer($p, $b, 'start', 60000, self::nowMs())['meta']['timer']['by']);
        $this->assertSame($want, $moderation->summon($p, $b, 'cTabA', self::nowMs())['meta']['summon']['name']);
        $meta = $this->meta($b);
        $this->assertSame([$want, $want, $want], [$meta['vote']['by'], $meta['timer']['by'], $meta['summon']['name']], self::dbKind() . ': as stored');
        $this->assertSame('closed', $this->votes->update($p, $b, 'end', null, self::nowMs())['meta']['vote']['state']);
    }

    public function testServicesFromTheServerContainer(): void {
        // Constructor autowiring: the controller of routes 22–26, the job and the listener.
        $this->assertInstanceOf(ModerationApiController::class, Server::get(ModerationApiController::class));
        $this->assertInstanceOf(VoteStore::class, Server::get(VoteStore::class));
        $b = $this->board();
        $sid = $this->votes->start($this->owner($b), $b, ['minutes' => 1], self::nowMs())['meta']['vote']['sid'];
        $this->db->executeStatement('UPDATE *PREFIX*knorke_vote_sessions SET ends_at = ? WHERE id = ?', [self::nowMs() - 1, $sid]);
        $job = Server::get(VoteCloseJob::class);
        (new \ReflectionMethod($job, 'run'))->invoke($job, null);
        $this->assertSame('closed', $this->session($sid)['state']);
        $this->assertSame('closed', $this->meta($b)['vote']['state']);
    }
}
