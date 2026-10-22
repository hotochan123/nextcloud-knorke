<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\BackgroundJob\CleanupJob;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Listener\UserDeletedListener;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\GuestToken;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\LinkSecrets;
use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Security\ISecureRandom;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Server;
use OCP\User\Events\UserDeletedEvent;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/** Administration flows against the dev stack (SPEC-M0 §4.10.4, §9.2). */
final class BoardServiceIntegrationTest extends IntegrationCase {
    private BoardService $service;

    protected function setUp(): void {
        parent::setUp();
        $this->service = Server::get(BoardService::class);
    }

    private function linkRow(string $token): ?array {
        $r = $this->db->executeQuery('SELECT board_id, revoked_at FROM *PREFIX*knorke_links WHERE token = ?', [$token])->fetchAssociative();
        return $r === false ? null : $r;
    }

    private function memberCount(int $b): int {
        return (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_members WHERE board_id = ?', [$b])->fetchOne();
    }

    /** @return list<string> "uid|link_id" of the member rows of a board */
    private function memberRows(int $b): array {
        return array_map(static fn (array $r): string => $r['user_id'] . '|' . $r['link_id'],
            $this->db->executeQuery('SELECT user_id, link_id FROM *PREFIX*knorke_members WHERE board_id = ? ORDER BY user_id', [$b])->fetchAllAssociative());
    }

    /** Access with the real stores and caches, signed in as $uid. */
    private function accessAs(string $uid, ?LinkPolicy $policy = null): Access {
        $user = Fake::of(IUser::class, ['getUID' => fn (): string => $uid, 'getDisplayName' => fn (): string => $uid]);
        $session = Fake::of(IUserSession::class, ['getUser' => fn () => $user, 'isLoggedIn' => fn (): bool => true]);
        return new Access($session, $this->boards, $this->cache, Server::get(GuestToken::class), Server::get(LinkThrottle::class),
            Server::get(ILimiter::class), Server::get(ISecureRandom::class), self::config(), Server::get(ITimeFactory::class),
            $policy ?? Server::get(LinkPolicy::class), Server::get(ShareService::class), Server::get(LinkSecrets::class));
    }

    /** A LinkPolicy without the request memo of the shared one (the test flips the policy). */
    private static function freshPolicy(): LinkPolicy {
        $container = new class() implements ContainerInterface {
            public function get(string $id): mixed {
                return Server::get($id);
            }

            public function has(string $id): bool {
                return true;
            }
        };
        return new LinkPolicy($container, Server::get(IUserManager::class));
    }

    private function serviceWith(LinkPolicy $policy): BoardService {
        return new BoardService($this->boards, $this->cache, Server::get(IUserManager::class), Server::get(IURLGenerator::class),
            Server::get(ISecureRandom::class), Server::get(LinkThrottle::class), Server::get(IRequest::class), Server::get(Limits::class),
            Server::get(ITimeFactory::class), $this->db, $policy, Server::get(MetaService::class), Server::get(ShareService::class),
            Server::get(SharePolicy::class), Server::get(LinkSecrets::class), $this->accessAs($this->uid, $policy),
            Server::get(IAppConfig::class), Server::get(LoggerInterface::class));
    }

    /** Runs $fn with core app config $key = $value and restores the previous state. */
    private static function withCoreConfig(string $key, string $value, callable $fn): void {
        $config = Server::get(IConfig::class);
        $had = in_array($key, $config->getAppKeys('core'), true);
        $old = $config->getAppValue('core', $key);
        $config->setAppValue('core', $key, $value);
        try {
            $fn();
        } finally {
            if ($had) {
                $config->setAppValue('core', $key, $old);
            } else {
                $config->deleteAppValue('core', $key);
            }
        }
    }

    public function testNextcloudLinkPolicyOfTheOwner(): void {
        // U11 (NC-5): "Allow users to share via link" off → no link, no
        // guests, link members out; nothing revoked, on again → all back.
        $board = $this->service->create($this->uid, 'Policy');
        $b = $board['id'];
        $this->created[] = $b;
        $this->assertTrue($board['linksAllowed']);
        $l1 = $this->service->enableLink($this->uid, $b, 'edit', []);
        $member = $this->uid . '-pm';
        $this->assertSame($b, $this->service->joinLinkAsUser($member, $l1['token']));
        [, $guestToken] = $this->access->joinGuest($l1['token'], 'Gina', null, '10.9.9.9');

        self::withCoreConfig('shareapi_allow_links', 'no', function () use ($b, $l1, $member, $guestToken): void {
            $policy = self::freshPolicy();
            $service = $this->serviceWith($policy);
            $this->assertFalse($policy->allows($this->uid));
            foreach ([fn () => $service->enableLink($this->uid, $b, 'edit', []), fn () => $service->enableLink($this->uid, $b, 'edit', ['rotate' => true]),
                fn () => $service->joinLinkAsUser($this->uid . '-new', $l1['token']), fn () => $this->accessAs('x', $policy)->joinGuest($l1['token'], 'G', null, '10.9.9.9')] as $call) {
                try {
                    $call();
                    $this->fail('links_disabled expected');
                } catch (HttpError $e) {
                    $this->assertSame([403, 'links_disabled'], [$e->status, $e->error]);
                }
            }
            $this->redis->remove('a:' . $b);
            try {
                $this->accessAs($member, $policy)->forUserWithRow($b);
                $this->fail('a link member has no access while links are not allowed');
            } catch (HttpError $e) {
                $this->assertSame([404, 'not_found'], [$e->status, $e->error]);
            }
            try {
                $this->accessAs('x', $policy)->forGuest($guestToken, $b);
                $this->fail('guest refused');
            } catch (HttpError $e) {
                $this->assertSame([403, 'links_disabled'], [$e->status, $e->error]);
            }
            $this->assertFalse($this->cache->getGens($b)['links'], 'the fast path learns it from a:');
            $this->assertSame([], $service->listFor($member));
            $this->assertSame([[$b, false]], array_map(static fn ($x) => [$x['id'], $x['linksAllowed']], $service->listFor($this->uid)));
            $this->assertNull($this->linkRow($l1['token'])['revoked_at'], 'the link is not revoked');
            $this->assertSame(1, $this->memberCount($b), 'the member row stays');
        });

        $this->redis->remove('a:' . $b);
        $policy = self::freshPolicy();
        $this->assertTrue($policy->allows($this->uid));
        $this->assertSame('edit', $this->accessAs($member, $policy)->forUserWithRow($b)[0]->principal->role->value, 'the member is back');
        $this->assertSame('Gina', $this->accessAs('x', $policy)->forGuest($guestToken, $b)->principal->displayName, 'the guest token works again');
        $this->assertSame($l1, $this->serviceWith($policy)->enableLink($this->uid, $b, 'edit', []), 'the same link');
    }

    public function testLinkPolicyGroupExclusionAppliesToTheOwner(): void {
        // shareapi_allow_links_exclude_groups: the OWNER's groups decide,
        // never the visitor's.
        $groups = Server::get(IGroupManager::class);
        $gid = 'knorke-it-g' . bin2hex(random_bytes(3));
        $group = $groups->createGroup($gid);
        $this->assertNotNull($group);
        $other = Server::get(IUserManager::class)->createUser($this->uid . 'o', 'Kt1!' . bin2hex(random_bytes(12)));
        $this->assertNotFalse($other);
        try {
            $group->addUser(Server::get(IUserManager::class)->get($this->uid));
            self::withCoreConfig('shareapi_allow_links_exclude_groups', json_encode([$gid]), function () use ($other): void {
                $policy = self::freshPolicy();
                $this->assertFalse($policy->allows($this->uid), 'owner in an excluded group');
                $this->assertTrue($policy->allows($other->getUID()), 'owner outside it');
                $mine = $this->serviceWith($policy)->create($this->uid, 'Excluded');
                $this->created[] = $mine['id'];
                $this->assertFalse($mine['linksAllowed']);
                try {
                    $this->serviceWith($policy)->enableLink($this->uid, $mine['id'], 'edit', []);
                    $this->fail('links_disabled expected');
                } catch (HttpError $e) {
                    $this->assertSame([403, 'links_disabled'], [$e->status, $e->error]);
                }
                $theirs = $this->serviceWith($policy)->create($other->getUID(), 'Allowed');
                $this->created[] = $theirs['id'];
                $link = $this->serviceWith($policy)->enableLink($other->getUID(), $theirs['id'], 'edit', []);
                $this->assertSame($theirs['id'], $this->serviceWith($policy)->joinLinkAsUser($this->uid, $link['token']), 'an excluded VISITOR may join an allowed owner\'s link');
            });
        } finally {
            $group->delete();
            $other->delete();
        }
    }

    public function testPublicUrlOnTheRealUrlGenerator(): void {
        // P7-16 (SPEC-M1 §33.1 h, C83 in small): with public_url the link url
        // is that origin + the path linkToRouteAbsolute puts after the
        // request's origin (webroot, /index.php as the instance has it).
        $board = $this->service->create($this->uid, 'Public url');
        $b = $board['id'];
        $this->created[] = $b;
        $config = Server::get(IAppConfig::class);
        $had = $config->hasKey('knorke', BoardService::KEY_PUBLIC_URL) ? $config->getValueString('knorke', BoardService::KEY_PUBLIC_URL, '') : null;
        try {
            $config->deleteKey('knorke', BoardService::KEY_PUBLIC_URL);
            $plain = $this->service->enableLink($this->uid, $b, 'edit', []);
            $path = (string)parse_url($plain['url'], PHP_URL_PATH);
            $this->assertStringEndsWith('/apps/knorke/p/' . $plain['token'], $path);
            $this->assertSame(Server::get(IURLGenerator::class)->linkToRouteAbsolute('knorke.publicPage.show', ['token' => $plain['token']]), $plain['url'], 'without the key: as before');
            $config->setValueString('knorke', BoardService::KEY_PUBLIC_URL, 'https://knorke-harness.example.org/');
            $this->assertSame('https://knorke-harness.example.org' . $path, $this->service->enableLink($this->uid, $b, 'edit', [])['url']);
            $this->assertSame('https://knorke-harness.example.org' . $path, $this->service->links($b, $this->uid)['edit']['url'], 'route 19 / board.links');
            $config->setValueString('knorke', BoardService::KEY_PUBLIC_URL, 'https://knorke-harness.example.org/x');
            $this->assertSame($plain['url'], $this->service->links($b, $this->uid)['edit']['url'], 'invalid → the request host');
        } finally {
            $config->deleteKey('knorke', BoardService::KEY_PUBLIC_URL);
            if ($had !== null) {
                $config->setValueString('knorke', BoardService::KEY_PUBLIC_URL, $had);
            }
        }
    }

    public function testFourByteTitle(): void {
        // U7 (NC-3): never a 500; utf8mb4 keeps the emoji, utf8mb3 stores U+FFFD.
        $board = $this->service->create($this->uid, 'Retro 👍');
        $this->created[] = $board['id'];
        $want = $this->db->supports4ByteText() ? 'Retro 👍' : "Retro \u{FFFD}";
        $this->assertSame($want, $board['title'], 'the answer is the stored title');
        $this->assertSame($want, $this->boards->findBoard($board['id'])['title']);
        $this->assertSame($want, $this->service->rename($this->uid, $board['id'], 'Retro 👍')['title']);
    }

    public function testJoinWaitsForARotationInFlight(): void {
        // T4: another session rotates the link (lock, revoke, delete members)
        // and has not committed yet. The join must wait for the board row
        // lock and then see the link revoked — never insert a member row for
        // a link the rotation just revoked.
        $board = $this->service->create($this->uid, 'Race');
        $b = $board['id'];
        $this->created[] = $b;
        $l1 = $this->service->enableLink($this->uid, $b, 'edit', []);
        $member = $this->uid . '-r';
        [$dsn, $user, $pass, $prefix] = self::pdoParams();
        $code = <<<'CHILD'
            $pdo = new PDO(getenv('KT_DSN'), getenv('KT_USER'), getenv('KT_PASS'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $p = getenv('KT_PREFIX');
            $b = (int)getenv('KT_BOARD');
            $pdo->beginTransaction();
            $pdo->exec("UPDATE {$p}knorke_boards SET acl_gen = acl_gen + 1, link_gen = link_gen + 1 WHERE id = $b");
            $ids = $pdo->query("SELECT id FROM {$p}knorke_links WHERE board_id = $b AND revoked_at IS NULL ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
            $pdo->exec("UPDATE {$p}knorke_links SET revoked_at = 1 WHERE board_id = $b AND revoked_at IS NULL");
            if ($ids) {
                $pdo->exec("DELETE FROM {$p}knorke_members WHERE board_id = $b AND link_id IN (" . implode(',', array_map('intval', $ids)) . ')');
            }
            fwrite(STDOUT, "locked\n");
            fflush(STDOUT);
            usleep((int)getenv('KT_HOLD_US'));
            $pdo->commit();
            fwrite(STDOUT, "committed\n");
            CHILD;
        // The parent's environment too: the image's php.ini reads ${PHP_MEMORY_LIMIT} from it.
        $env = getenv() + ['KT_DSN' => $dsn, 'KT_USER' => $user, 'KT_PASS' => $pass, 'KT_PREFIX' => $prefix, 'KT_BOARD' => (string)$b, 'KT_HOLD_US' => '1500000'];
        $proc = proc_open([PHP_BINARY, '-r', $code], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        $this->assertIsResource($proc);
        try {
            $line = fgets($pipes[1]);
            if ($line !== "locked\n") {
                // stderr only now: reading it waits for the child to exit.
                $this->fail('rotation not in flight: ' . var_export($line, true) . ' ' . stream_get_contents($pipes[2]));
            }
            $t0 = microtime(true);
            try {
                $this->service->joinLinkAsUser($member, $l1['token']);
                $this->fail('the join must wait for the rotation and see the link revoked');
            } catch (HttpError $e) {
                $this->assertSame([403, 'link_revoked'], [$e->status, $e->error]);
            }
            $this->assertGreaterThan(1.0, microtime(true) - $t0, 'the join waited for the board row lock');
            $this->assertSame("committed\n", fgets($pipes[1]));
        } finally {
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
        }
        $this->assertSame([], $this->memberRows($b), 'no member row on the revoked link');
        $this->assertNull($this->boards->findBoardForUser($b, $member, self::nowMs())['member_role']);
    }

    public function testJoinBeforeTheRotationIsRemovedByIt(): void {
        // T4, reverse order: the join commits first, the rotation deletes it.
        $board = $this->service->create($this->uid, 'Order');
        $b = $board['id'];
        $this->created[] = $b;
        $l1 = $this->service->enableLink($this->uid, $b, 'edit', []);
        $member = $this->uid . '-o';
        $this->assertSame($b, $this->service->joinLinkAsUser($member, $l1['token']));
        $this->assertSame([$member . '|' . $this->boards->activeLinkOf($b, 'edit')['id']], $this->memberRows($b));
        $this->service->enableLink($this->uid, $b, 'edit', ['rotate' => true]);
        $this->assertSame([], $this->memberRows($b));
        $this->assertSame([], $this->service->listFor($member));
    }

    public function testMemberOfARevokedLinkGrantsNothing(): void {
        // T4 backstop: a member row on a revoked (or pruned) link — what a
        // racing join used to leave behind — gives no access and no list
        // entry; joining through the active link replaces it.
        $b = $this->board();
        $now = self::nowMs();
        $old = $this->boards->insertLink($b, 'ITrevLink' . substr(bin2hex(random_bytes(8)), 0, 15), 'edit', $this->uid, $now, null, null);
        $this->db->executeStatement('UPDATE *PREFIX*knorke_links SET revoked_at = ? WHERE id = ?', [$now, $old]);
        $activeToken = 'ITactLink' . substr(bin2hex(random_bytes(8)), 0, 15);
        $active = $this->boards->insertLink($b, $activeToken, 'edit', $this->uid, $now, null, null);
        $stale = $this->uid . '-s';
        $this->boards->addMember($b, $stale, 'edit', $old, $now);
        $this->boards->addMember($b, $this->uid . '-x', 'edit', null, $now);
        $this->boards->addMember($b, $this->uid . '-y', 'edit', $active, $now);
        $this->boards->addMember($b, $this->uid . '-z', 'edit', $old + 1000000, $now);

        $row = $this->boards->findBoardForUser($b, $stale, $now);
        $this->assertSame([null, null], [$row['member_role'], $row['member_link']], 'revoked link → no membership');
        $this->assertSame([], $this->boards->listForUser($stale, [], [], $now));
        $this->assertSame([null, null], [$this->boards->findBoardForUser($b, $this->uid . '-z', $now)['member_role'], $this->boards->listForUser($this->uid . '-z', [], [], $now)[0] ?? null], 'pruned link → no membership');
        $this->assertSame(['edit', null], [$this->boards->findBoardForUser($b, $this->uid . '-x', $now)['member_role'], $this->boards->findBoardForUser($b, $this->uid . '-x', $now)['member_link']], 'explicit member (M1)');
        $this->assertSame(['edit', $active], [$this->boards->findBoardForUser($b, $this->uid . '-y', $now)['member_role'], $this->boards->findBoardForUser($b, $this->uid . '-y', $now)['member_link']], 'active link member');
        $this->assertSame([$b], array_column($this->boards->listForUser($this->uid . '-y', [], [], $now), 'id'));

        $access = $this->accessAs($stale);
        foreach ([fn () => $access->forUserWithRow($b), fn () => $access->forUser($b)] as $check) {
            try {
                $check();
                $this->fail('the full access check must refuse');
            } catch (HttpError $e) {
                $this->assertSame([404, 'not_found'], [$e->status, $e->error]);
            }
        }
        $this->assertSame('edit', $this->accessAs($this->uid . '-y')->forUser($b)->principal->role->value);

        $this->assertSame($b, $this->service->joinLinkAsUser($stale, $activeToken));
        $this->assertSame(['edit', $active], [$this->boards->findBoardForUser($b, $stale, $now)['member_role'], $this->boards->findBoardForUser($b, $stale, $now)['member_link']], 'the join replaced the stale row');
        $this->assertSame('edit', $this->accessAs($stale)->forUser($b)->principal->role->value);
    }

    public function testLinkRotateDisableAndDelete(): void {
        $board = $this->service->create($this->uid, 'Workshop');
        $b = $board['id'];
        $this->created[] = $b;
        $l1 = $this->service->enableLink($this->uid, $b, 'edit', []);
        $this->assertStringEndsWith('/apps/knorke/p/' . $l1['token'], $l1['url']);
        $member = $this->uid . '-m';
        $this->assertSame($b, $this->service->joinLinkAsUser($member, $l1['token']));
        $this->assertSame($b, $this->service->joinLinkAsUser($member, $l1['token']), 'already a member');
        $this->assertSame(1, $this->memberCount($b));
        $listed = $this->service->listFor($member);
        $this->assertSame([[$b, 'edit', true]], array_map(static fn ($x) => [$x['id'], $x['role'], $x['viaLink']], $listed));

        $l2 = $this->service->enableLink($this->uid, $b, 'edit', ['rotate' => true]);
        $this->assertNotNull($this->linkRow($l1['token'])['revoked_at'], 'old link kept with revoked_at');
        $this->assertNull($this->linkRow($l2['token'])['revoked_at']);
        $this->assertSame(0, $this->memberCount($b), 'link members removed');
        $this->assertSame(['acl' => 2, 'link' => 2, 'minRev' => 0, 'links' => true, 'voteLink' => 1, 'gone' => false], $this->cache->getGens($b), 'Redis updated at once');
        try {
            $this->service->joinLinkAsUser($member, $l1['token']);
            $this->fail('revoked');
        } catch (HttpError $e) {
            $this->assertSame([403, 'link_revoked'], [$e->status, $e->error]);
        }

        $this->service->disableLink($this->uid, $b, 'edit');
        $this->assertNotNull($this->linkRow($l2['token'])['revoked_at']);
        $this->assertSame(3, $this->cache->getGens($b)['link']);

        $this->service->enableLink($this->uid, $b, 'edit', []);
        $this->service->delete($this->uid, $b);
        $this->assertFalse($this->db->executeQuery('SELECT id FROM *PREFIX*knorke_boards WHERE id = ?', [$b])->fetchOne());
        $this->assertSame(3, (int)$this->db->executeQuery('SELECT COUNT(*) FROM *PREFIX*knorke_links WHERE board_id = ? AND revoked_at IS NOT NULL', [$b])->fetchOne(), 'links of a deleted board stay revoked');
        $this->assertTrue($this->cache->getGens($b)['gone']);
    }

    public function testUserDeletedThroughTheListener(): void {
        $own = $this->board($this->uid, 'Mine');
        $other = $this->board($this->uid . '-o', 'Theirs');
        $this->boards->addMember($other, $this->uid, 'edit', null, self::nowMs());
        $this->cache->seedGens($other, 1, 1, 0, true, 1);
        $user = $this->createMock(IUser::class);
        $user->method('getUID')->willReturn($this->uid);
        Server::get(UserDeletedListener::class)->handle(new UserDeletedEvent($user));
        $this->assertFalse($this->db->executeQuery('SELECT id FROM *PREFIX*knorke_boards WHERE id = ?', [$own])->fetchOne());
        $this->assertTrue($this->cache->getGens($own)['gone']);
        $this->assertSame(0, $this->memberCount($other));
        $this->assertSame(2, (int)$this->db->executeQuery('SELECT acl_gen FROM *PREFIX*knorke_boards WHERE id = ?', [$other])->fetchOne());
        $this->assertSame(2, $this->cache->getGens($other)['acl'], 'set, not add: the revocation wins over the seeded value');
    }

    public function testCleanupJobDeletesOnlyOldRevokedLinks(): void {
        $b = $this->board();
        $now = self::nowMs();
        $old = 'IToldLink' . substr(bin2hex(random_bytes(8)), 0, 15);
        $recent = 'ITnewLink' . substr(bin2hex(random_bytes(8)), 0, 15);
        $active = 'ITactLink' . substr(bin2hex(random_bytes(8)), 0, 15);
        foreach ([[$old, $now - Limits::CHANGES_RETENTION_MS - 60000], [$recent, $now - 60000], [$active, null]] as [$tok, $rev]) {
            $id = $this->boards->insertLink($b, $tok, 'edit', $this->uid, $now, null, null);
            if ($rev !== null) {
                $this->db->executeStatement('UPDATE *PREFIX*knorke_links SET revoked_at = ? WHERE id = ?', [$rev, $id]);
            }
        }
        $this->items->insertChange($b, 1, self::ulid(1), 'put', '{}', 'u:x', 'c', $now - Limits::CHANGES_RETENTION_MS - 60000);
        $this->items->insertChange($b, 2, self::ulid(1), 'put', '{}', 'u:x', 'c', $now);
        $result = Server::get(CleanupJob::class)->prune($now);
        $this->assertGreaterThanOrEqual(1, $result['links']);
        $this->assertGreaterThanOrEqual(1, $result['changes']);
        $this->assertNull($this->linkRow($old));
        $this->assertNotNull($this->linkRow($recent));
        $this->assertNotNull($this->linkRow($active));
        $this->assertSame([2], array_map('intval', $this->db->executeQuery('SELECT rev FROM *PREFIX*knorke_changes WHERE board_id = ?', [$b])->fetchAll(\PDO::FETCH_COLUMN)));
    }
}
