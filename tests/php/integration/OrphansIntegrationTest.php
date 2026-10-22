<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\Db\VoteStore;
use OCA\Knorke\Service\OrphanReconciler;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\IAppConfig;
use OCP\Server;

/**
 * The orphan reconciliation (P7, SPEC-M1 §33.1 e, AUTHZ-1 = OPS-1) on the
 * real database of the dev stack — every KD_DB kind — with Nextcloud's
 * real user and group managers. "Deleted while Knorke was disabled" is
 * played with ids that never existed (knorke-it-ghost-*): no listener ever
 * saw them. Rows of such ids — a user share, a group share, a link
 * membership, a vote in an open session and an owned board — are counted,
 * then treated like the listeners (boards deleted, rows gone, acl_gen + 1,
 * seq + 1); rows of existing accounts and groups stay. The reconciliation
 * covers the whole instance: assertions use the counts of the test's own
 * ids (count()), and that a dry run and the real run report the same
 * numbers. Also: occ knorke:orphans (its <commands> entry, the output form)
 * and the daily two-run rule with the lazy app config orphan_candidates
 * (saved and restored).
 */
final class OrphansIntegrationTest extends IntegrationCase {
    private OrphanReconciler $r;
    private string $ghost;
    private string $ghostGroup;
    /** @var array<string, int> */
    private array $id = [];

    protected function setUp(): void {
        parent::setUp();
        $this->r = Server::get(OrphanReconciler::class);
        $this->ghost = 'knorke-it-ghost-' . bin2hex(random_bytes(4));
        $this->ghostGroup = 'knorke-it-ghostgrp-' . bin2hex(random_bytes(4));
    }

    /** U (shared to the ghost and to bob, link members ghost and alice, an open session with votes), G (group shares), O (owned by the ghost). */
    private function world(): void {
        $now = self::nowMs();
        $this->id['U'] = $this->board();
        $this->id['G'] = $this->board();
        $this->id['O'] = $this->board($this->ghost, 'Ghost board');
        $share = 'INSERT INTO *PREFIX*knorke_shares (board_id, kind, recipient, role, display_name, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)';
        $this->db->executeStatement($share, [$this->id['U'], 'user', $this->ghost, 'edit', $this->uid, $now]);
        $this->db->executeStatement($share, [$this->id['U'], 'user', 'bob', 'edit', $this->uid, $now]);
        $this->db->executeStatement($share, [$this->id['G'], 'group', $this->ghostGroup, 'moderate', $this->uid, $now]);
        $this->db->executeStatement($share, [$this->id['G'], 'group', 'knorke-e2e', 'view', $this->uid, $now]);
        $this->boards->addMember($this->id['U'], $this->ghost, 'edit', null, $now);
        $this->boards->addMember($this->id['U'], 'alice', 'edit', null, $now);
        $votes = Server::get(VoteStore::class);
        $this->id['S'] = $votes->insert($this->id['U'], ['per' => 5, 'perItem' => 1, 'scope' => null, 'types' => ['sticky']], 'u:' . $this->uid, $now, null);
        $vote = 'INSERT INTO *PREFIX*knorke_votes (session_id, voter, item_id, n, ts) VALUES (?, ?, ?, ?, ?)';
        $this->db->executeStatement($vote, [$this->id['S'], $this->access->pid($this->id['U'], 'u:' . $this->ghost), self::ulid(1), 1, $now]);
        $this->db->executeStatement($vote, [$this->id['S'], $this->access->pid($this->id['U'], 'u:alice'), self::ulid(1), 1, $now]);
    }

    private function one(string $sql, array $params): int {
        return (int)$this->db->executeQuery($sql, $params)->fetchOne();
    }

    /** @return array<string, int> */
    private function mine(): array {
        return $this->r->count([$this->ghost], [$this->ghostGroup]);
    }

    private function acl(int $b): int {
        return $this->one('SELECT acl_gen FROM *PREFIX*knorke_boards WHERE id = ?', [$b]);
    }

    public function testDryRunThenReconcileLikeTheListeners(): void {
        $this->world();
        $found = $this->r->scan();
        $this->assertContains($this->ghost, $found['users']);
        $this->assertContains($this->ghostGroup, $found['groups']);
        $this->assertNotContains($this->uid, $found['users'], 'an existing account is no orphan');
        $this->assertNotContains('knorke-e2e', $found['groups']);
        $this->assertSame(['user-shares' => 1, 'group-shares' => 1, 'link-members' => 1, 'open-votes' => 1, 'owned-boards' => 1], $this->mine(), self::dbKind());
        $acl = [$this->acl($this->id['U']), $this->acl($this->id['G'])];
        $dry = $this->r->reconcile(true);
        $this->assertSame(0, $dry['failed']);
        $this->assertSame(['user-shares' => 1, 'group-shares' => 1, 'link-members' => 1, 'open-votes' => 1, 'owned-boards' => 1], $this->mine(), 'the dry run changed nothing');
        foreach ($dry['counts'] as $kind => $n) {
            $this->assertGreaterThanOrEqual(1, $n, "$kind includes the test's own orphan");
        }
        $real = $this->r->reconcile(false);
        $this->assertSame([$dry['counts'], 0], [$real['counts'], $real['failed']], 'the real run reports the numbers of the dry run');
        $this->assertSame(['user-shares' => 0, 'group-shares' => 0, 'link-members' => 0, 'open-votes' => 0, 'owned-boards' => 0], $this->mine());
        $this->assertSame(0, $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_boards WHERE id = ?', [$this->id['O']]), 'the ghost\'s board is deleted');
        $this->assertSame([1, 1, 1], [
            $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_shares WHERE board_id = ? AND recipient = ?', [$this->id['U'], 'bob']),
            $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_shares WHERE board_id = ? AND recipient = ?', [$this->id['G'], 'knorke-e2e']),
            $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_members WHERE board_id = ? AND user_id = ?', [$this->id['U'], 'alice']),
        ], 'rows of existing accounts and groups stay');
        $this->assertSame(1, $this->one('SELECT COUNT(*) FROM *PREFIX*knorke_votes WHERE session_id = ?', [$this->id['S']]), 'only alice\'s vote row stays');
        $this->assertSame(1, $this->one('SELECT seq FROM *PREFIX*knorke_vote_sessions WHERE id = ?', [$this->id['S']]), 'seq + 1 like the listener');
        $this->assertGreaterThan($acl[0], $this->acl($this->id['U']), 'U: acl_gen + 1');
        $this->assertGreaterThan($acl[1], $this->acl($this->id['G']), 'G: acl_gen + 1');
        $gens = $this->cache->getGens($this->id['U']);
        $this->assertSame($this->acl($this->id['U']), $gens['acl'] ?? null, 'setGens after the COMMIT');
        $this->assertSame(['counts' => array_fill_keys(OrphanReconciler::KINDS, 0), 'failed' => 0], $this->r->reconcile(false), 'nothing left on the instance');
    }

    public function testOccKnorkeOrphans(): void {
        $this->world();
        [$code, $out, $err] = $this->occ(['knorke:orphans', '--dry-run']);
        $this->assertSame(0, $code, $out . $err);
        $lines = explode("\n", rtrim($out, "\n"));
        $this->assertCount(6, $lines, $out);
        foreach (OrphanReconciler::KINDS as $i => $kind) {
            $this->assertMatchesRegularExpression('/^' . $kind . ': [1-9][0-9]*$/', $lines[$i], 'the line of ' . $kind . ' (at least the test\'s own orphan)');
        }
        $this->assertSame('Dry run: nothing was changed.', $lines[5]);
        $this->assertSame(1, $this->mine()['owned-boards'], 'unchanged');
        [$code, $out2] = $this->occ(['knorke:orphans']);
        $this->assertSame([0, implode("\n", array_slice($lines, 0, 5)) . "\n"], [$code, $out2], 'the same five lines without the dry-run line');
        [$code, $out3] = $this->occ(['knorke:orphans']);
        $this->assertSame([0, "user-shares: 0\ngroup-shares: 0\nlink-members: 0\nopen-votes: 0\nowned-boards: 0\n"], [$code, $out3]);
        [$code] = $this->occ(['knorke:orphans', '--nope']);
        $this->assertNotSame(0, $code, 'unknown option: Symfony refuses');
        [$code, $out] = $this->occ(['list', 'knorke']);
        $this->assertStringContainsString('knorke:orphans', $out, 'registered through <commands> (info.xml)');
    }

    public function testDailyTwoRunRuleWithTheRealAppConfig(): void {
        $config = Server::get(IAppConfig::class);
        $had = $config->hasKey('knorke', OrphanReconciler::MEMO_KEY, true) ? $config->getValueString('knorke', OrphanReconciler::MEMO_KEY, '', true) : null;
        $this->world();
        $t0 = self::nowMs();
        try {
            $config->deleteKey('knorke', OrphanReconciler::MEMO_KEY);
            $this->r->daily($t0);
            $memo = json_decode($config->getValueString('knorke', OrphanReconciler::MEMO_KEY, '', true), true);
            $this->assertSame([$t0, $t0], [$memo['u:' . $this->ghost] ?? null, $memo['g:' . $this->ghostGroup] ?? null], 'first run: remembered');
            $this->assertTrue($config->isLazy('knorke', OrphanReconciler::MEMO_KEY), 'a lazy key');
            $this->assertSame(1, $this->mine()['owned-boards'], 'nothing deleted yet');
            $this->r->daily($t0 + OrphanReconciler::GRACE_MS - 1);
            $this->assertSame(1, $this->mine()['user-shares'], 'still within 20 h');
            $this->r->daily($t0 + OrphanReconciler::GRACE_MS);
            $this->assertSame(array_fill_keys(OrphanReconciler::KINDS, 0), $this->mine(), '20 h later: reconciled');
            $memo = json_decode($config->getValueString('knorke', OrphanReconciler::MEMO_KEY, '{}', true), true) ?? [];
            $this->assertArrayNotHasKey('u:' . $this->ghost, $memo);
            $this->assertArrayNotHasKey('g:' . $this->ghostGroup, $memo);
        } finally {
            $config->deleteKey('knorke', OrphanReconciler::MEMO_KEY);
            if ($had !== null) {
                $config->setValueString('knorke', OrphanReconciler::MEMO_KEY, $had, true);
            }
        }
    }

    /** occ in a child process (www-data, same instance); [exit code, stdout, stderr]. */
    private function occ(array $args): array {
        $proc = proc_open([PHP_BINARY, \OC::$SERVERROOT . '/occ', ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, \OC::$SERVERROOT, getenv());
        $this->assertIsResource($proc);
        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return [proc_close($proc), (string)$out, (string)$err];
    }
}
