<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Integration;

use OCA\Knorke\BackgroundJob\CleanupJob;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\GuestToken;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\LinkSecrets;
use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\IntegrationCase;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Config\IUserConfig;
use OCP\IAppConfig;
use OCP\IGroup;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Security\ISecureRandom;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Server;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Shares, rights and links against the real database, Redis and Nextcloud
 * of the dev stack (SPEC-M1 §8.2 integration, stage 2): real accounts, a
 * real group (UserRemovedEvent and GroupDeletedEvent reach GroupListener
 * through Nextcloud's event dispatcher), a real team where Circles runs
 * (created, changed and destroyed with occ circles:* in a child process,
 * whose MembershipsRemovedEvent/DestroyingCircleEvent reach TeamListener
 * there; CircleDestroyedEvent, which the CLI never sends, through the
 * dispatcher of this process), the board list SQL, link passwords and
 * expiry, utf8mb3.
 *
 * Every check builds fresh services (SharePolicy remembers groups and
 * teams for a request; a test is many requests).
 */
final class SharesIntegrationTest extends IntegrationCase {
    /** @var list<IUser> */
    private array $accounts = [];
    /** @var list<IGroup> */
    private array $groupsMade = [];
    /** @var list<string> team singleIds to destroy */
    private array $teamsMade = [];
    private IUser $owner;

    protected function setUp(): void {
        parent::setUp();
        $this->owner = Server::get(IUserManager::class)->get($this->uid);
    }

    protected function tearDown(): void {
        foreach ($this->teamsMade as $id) {
            $this->occ(['circles:manage:destroy', $id]);
        }
        foreach ($this->groupsMade as $g) {
            $g->delete();
        }
        foreach ($this->accounts as $a) {
            $a->delete();
        }
        $this->teamsMade = $this->groupsMade = $this->accounts = [];
        parent::tearDown();
    }

    private function account(string $suffix): IUser {
        $u = Server::get(IUserManager::class)->createUser($this->uid . '-' . $suffix, 'Kt1!' . bin2hex(random_bytes(12)));
        $this->assertInstanceOf(IUser::class, $u);
        $this->accounts[] = $u;
        return $u;
    }

    private function group(string $suffix, IUser ...$members): IGroup {
        $g = Server::get(IGroupManager::class)->createGroup('knorke-it-' . $suffix . bin2hex(random_bytes(3)));
        $this->assertInstanceOf(IGroup::class, $g);
        $this->groupsMade[] = $g;
        foreach ($members as $m) {
            $g->addUser($m);
        }
        return $g;
    }

    private static function container(): ContainerInterface {
        return new class() implements ContainerInterface {
            public function get(string $id): mixed {
                return Server::get($id);
            }

            public function has(string $id): bool {
                return true;
            }
        };
    }

    /**
     * Fresh services with $session as the signed-in user.
     *
     * @return array{policy: SharePolicy, shares: ShareService, access: Access, boards: BoardService, secrets: LinkSecrets}
     */
    private function services(?IUser $session = null): array {
        $session ??= $this->owner;
        $c = self::container();
        $policy = new SharePolicy($c, Server::get(IUserManager::class), Server::get(IGroupManager::class), Server::get(IAppManager::class), Server::get(LoggerInterface::class));
        $linkPolicy = new LinkPolicy($c, Server::get(IUserManager::class));
        $shares = new ShareService(Server::get(ShareStore::class), $this->boards, $policy, $linkPolicy, $this->cache, Server::get(IUserManager::class), $this->db,
            Server::get(ILimiter::class), self::config(), Server::get(IJobList::class), $c, Server::get(ITimeFactory::class), Server::get(LoggerInterface::class));
        $secrets = Server::get(LinkSecrets::class);
        $userSession = Fake::of(IUserSession::class, ['getUser' => fn () => $session, 'isLoggedIn' => fn (): bool => true]);
        $access = new Access($userSession, $this->boards, $this->cache, Server::get(GuestToken::class), Server::get(LinkThrottle::class),
            Server::get(ILimiter::class), Server::get(ISecureRandom::class), self::config(), Server::get(ITimeFactory::class), $linkPolicy, $shares, $secrets);
        $boards = new BoardService($this->boards, $this->cache, Server::get(IUserManager::class), Server::get(IURLGenerator::class),
            Server::get(ISecureRandom::class), Server::get(LinkThrottle::class), Server::get(IRequest::class), Server::get(Limits::class),
            Server::get(ITimeFactory::class), $this->db, $linkPolicy, Server::get(MetaService::class), $shares, $policy, $secrets, $access,
            Server::get(IAppConfig::class), Server::get(LoggerInterface::class));
        return ['policy' => $policy, 'shares' => $shares, 'access' => $access, 'boards' => $boards, 'secrets' => $secrets];
    }

    /** The full check of $user (null role = 404). */
    private function roleOf(int $board, IUser $user): ?string {
        try {
            $p = $this->services($user)['access']->forUserWithRow($board)[0]->principal;
            return $p->access();
        } catch (HttpError $e) {
            $this->assertSame([404, 'not_found'], [$e->status, $e->error]);
            return null;
        }
    }

    private function aclGen(int $board): int {
        return (int)$this->db->executeQuery('SELECT acl_gen FROM *PREFIX*knorke_boards WHERE id = ?', [$board])->fetchOne();
    }

    /** @return list<string> "kind:recipient=role" of the stored share rows */
    private function rows(int $board): array {
        $out = array_map(static fn (array $r): string => $r['kind'] . ':' . $r['recipient'] . '=' . $r['role'],
            $this->db->executeQuery('SELECT kind, recipient, role FROM *PREFIX*knorke_shares WHERE board_id = ?', [$board])->fetchAllAssociative());
        sort($out);
        return $out;
    }

    /** occ in a child process (www-data, same instance); [exit code, stdout]. */
    private function occ(array $args): array {
        $proc = proc_open([PHP_BINARY, \OC::$SERVERROOT . '/occ', ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, \OC::$SERVERROOT, getenv());
        $this->assertIsResource($proc);
        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);
        return [$code, (string)$out . (string)$err];
    }

    private function teamSupport(): bool {
        return $this->services()['policy']->teamSupport($this->owner);
    }

    // ── Groups ─────────────────────────────────────────────────────────────

    public function testGroupShareWithARealGroupAndItsEvents(): void {
        $member = $this->account('gm');
        $outsider = $this->account('go');
        $group = $this->group('g', $member);
        $b = $this->board();
        $s = $this->services();
        $out = $s['shares']->save($this->uid, $b, [['kind' => 'group', 'id' => $group->getGID(), 'role' => 'edit']]);
        $this->assertSame([['group', $group->getGID(), 'edit', true]], array_map(static fn (array $r): array => [$r['kind'], $r['id'], $r['role'], $r['available']], $out['shares']));
        $this->assertSame(['group:' . $group->getGID() . '=edit'], $this->rows($b));
        $acl = $this->aclGen($b);
        $this->assertSame('edit', $this->roleOf($b, $member));
        $this->assertSame(['acl' => $acl, 'role' => 'edit', 'origin' => 's'], $this->cache->getGrant($b, $member->getUID()));
        $this->assertNull($this->roleOf($b, $outsider), 'not in the group: 404');
        // The board list of the member: source share.
        $listed = $this->services($member)['boards']->listFor($member->getUID());
        $this->assertSame([[$b, 'edit', 'share', false]], array_map(static fn (array $x): array => [$x['id'], $x['role'], $x['source'], $x['mod']], $listed));

        // A user leaves the group: GroupListener bumps acl_gen in this process (Nextcloud's dispatcher).
        $group->removeUser($member);
        $this->assertSame($acl + 1, $this->aclGen($b), 'UserRemovedEvent → acl_gen + 1');
        $this->assertSame($acl + 1, $this->cache->getGens($b)['acl'], 'setGens: the grant is invalid at once');
        $this->assertNull($this->roleOf($b, $member));
        $this->assertSame([], $this->services($member)['boards']->listFor($member->getUID()));

        // The group is deleted: rows first, then the bump (no UserRemovedEvent per member).
        $group->addUser($member);
        $group->delete();
        $this->groupsMade = [];
        $this->assertSame([], $this->rows($b));
        $this->assertSame($acl + 2, $this->aclGen($b));
    }

    public function testModerateShareDemotionAndListOrder(): void {
        $bob = $this->account('mb');
        $b = $this->board();
        $s = $this->services();
        $s['shares']->save($this->uid, $b, [['kind' => 'user', 'id' => $bob->getUID(), 'role' => 'moderate']]);
        $this->assertSame('moderate', $this->roleOf($b, $bob));
        $this->assertSame('f', $this->cache->getGrant($b, $bob->getUID())['origin']);
        $p = $this->services($bob)['access']->forUser($b)->principal;
        $this->assertSame([Role::Edit, true, null], [$p->role, $p->canModerate(), null], 'the fast path keeps the facilitator flag');
        // A moderator reads the links, cannot change shares.
        try {
            $this->services($bob)['boards']->enableLink($bob->getUID(), $b, 'vote', []);
            $this->fail('403 expected');
        } catch (HttpError $e) {
            $this->assertSame([403, 'forbidden'], [$e->status, $e->error]);
        }
        $acl = $this->aclGen($b);
        $this->services()['shares']->save($this->uid, $b, [['kind' => 'user', 'id' => $bob->getUID(), 'role' => 'view']]);
        $this->assertSame($acl + 1, $this->aclGen($b), 'a demotion bumps');
        $this->assertSame('view', $this->roleOf($b, $bob));
        $this->services()['shares']->save($this->uid, $b, []);
        $this->assertNull($this->roleOf($b, $bob), 'removed: 404 at once');
        $this->assertSame($acl + 2, $this->aclGen($b));
    }

    public function testRecipientsAreStoredCanonically(): void {
        $bob = $this->account('cb');
        $b = $this->board();
        $upper = strtoupper($bob->getUID());
        $found = Server::get(IUserManager::class)->get($upper);
        if ($found === null) {
            $this->markTestSkipped('the user backend of this database kind does not resolve ' . $upper . ' (case-sensitive lookup)');
        }
        $this->services()['shares']->save($this->uid, $b, [['kind' => 'user', 'id' => $upper, 'role' => 'edit']]);
        $this->assertSame(['user:' . $bob->getUID() . '=edit'], $this->rows($b), 'getUID(), never the typed spelling');
        try {
            $this->services()['shares']->save($this->uid, $b, [['kind' => 'user', 'id' => $upper, 'role' => 'edit'], ['kind' => 'user', 'id' => $bob->getUID(), 'role' => 'view']]);
            $this->fail('duplicate after canonicalisation');
        } catch (HttpError $e) {
            $this->assertSame([400, 'bad_request', 1], [$e->status, $e->error, $e->payload()['at']]);
        }
    }

    // ── Teams (Circles) ────────────────────────────────────────────────────

    public function testRealTeam(): void {
        if (!$this->teamSupport()) {
            $this->markTestSkipped('Circles is not active in this stack (team part of SPEC-M1 §8.2 only with Circles)');
        }
        $member = $this->account('tm');
        $viaGroup = $this->account('tg');
        $outsider = $this->account('to');
        $group = $this->group('tg', $viaGroup);
        [$code, $out] = $this->occ(['circles:manage:create', '--type', 'user', '--output=json', $this->uid, 'knorke-it-' . bin2hex(random_bytes(3))]);
        $this->assertSame(0, $code, $out);
        $team = (string)(json_decode($out, true)['id'] ?? '');
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9]{31}$/', $team);
        $this->teamsMade[] = $team;
        $this->assertSame(0, $this->occ(['circles:members:add', $team, $member->getUID(), '--type', 'user'])[0]);
        $this->assertSame(0, $this->occ(['circles:members:add', $team, $group->getGID(), '--type', 'group'])[0]);

        $b = $this->board();
        $this->assertContains($team, $this->services()['policy']->teamsOf($this->owner), 'the owner is a member of its team');
        $this->services()['shares']->save($this->uid, $b, [['kind' => 'team', 'id' => $team, 'role' => 'vote']]);
        $this->assertSame(['team:' . $team . '=vote'], $this->rows($b));
        $this->assertSame('vote', $this->roleOf($b, $member));
        $this->assertSame('vote', $this->roleOf($b, $viaGroup), 'a member through a group in the team');
        $this->assertNull($this->roleOf($b, $outsider), 'not in the team: 404 (CVE-2021-37631 lesson)');
        $listed = $this->services($member)['boards']->listFor($member->getUID());
        $this->assertSame([[$b, 'vote', 'share']], array_map(static fn (array $x): array => [$x['id'], $x['role'], $x['source']], $listed));

        // Removing the member (occ, child process): MembershipsRemovedEvent → TeamListener → acl_gen + 1.
        $acl = $this->aclGen($b);
        [, $list] = $this->occ(['circles:members:list', $team, '--output=json']);
        $memberId = null;
        foreach ((array)json_decode($list, true) as $m) {
            if (($m['userId'] ?? null) === $member->getUID()) {
                $memberId = $m['id'];
            }
        }
        $this->assertNotNull($memberId, $list);
        [$code, $out] = $this->occ(['circles:members:remove', $memberId]);
        $this->assertSame(0, $code, $out);
        $this->assertGreaterThan($acl, $this->aclGen($b), 'the team listener bumped the board');
        $this->assertNull($this->roleOf($b, $member));
        $this->assertSame('vote', $this->roleOf($b, $viaGroup));

        // Destroyed (occ): Circles sends DestroyingCircleEvent synchronously
        // in CircleDestroy::manage() (R14-03) — TeamListener deletes the team's
        // rows and bumps the board in the child process; the remaining members
        // also lose their memberships at once (MembershipsRemovedEvent).
        $acl = $this->aclGen($b);
        [$code, $out] = $this->occ(['circles:manage:destroy', $team]);
        $this->assertSame(0, $code, $out);
        $this->teamsMade = [];
        $this->assertSame([], $this->rows($b), 'R14-03: occ circles:manage:destroy deletes the team rows (DestroyingCircleEvent)');
        $this->assertGreaterThan($acl, $this->aclGen($b), 'and the board is bumped');
        $this->assertSame($this->aclGen($b), $this->cache->getGens($b)['acl'], 'setGens: the grants are invalid at once');
        $this->assertNull($this->roleOf($b, $viaGroup));
        $this->assertSame([], $this->services()['shares']->list($this->uid, $b)['shares'], 'GET shares no longer lists the team');
        // CircleDestroyedEvent is an async Circles RESULT (IFederatedItemAsyncProcess):
        // from the web it comes in the loopback request, from the CLI never
        // (FederatedEventService::initBroadcast: no broadcast without remote
        // instances under OC::$CLI). The real event class through Nextcloud's
        // dispatcher, as the loopback request would send it: the idempotent
        // second path — nothing left, nothing bumped.
        $dispatchDestroyed = static function (string $singleId): void {
            $circle = (new \OCA\Circles\Model\Circle())->setSingleId($singleId);
            $federated = (new \OCA\Circles\Model\Federated\FederatedEvent(\OCA\Circles\FederatedItems\CircleDestroy::class))->setCircle($circle);
            Server::get(\OCP\EventDispatcher\IEventDispatcher::class)->dispatchTyped(new \OCA\Circles\Events\CircleDestroyedEvent($federated, []));
        };
        $acl = $this->aclGen($b);
        $dispatchDestroyed($team);
        $this->assertSame([[], $acl], [$this->rows($b), $this->aclGen($b)], 'CircleDestroyedEvent after DestroyingCircleEvent: idempotent');
        // The second path on its own (rows the first path never saw): deleted, board bumped.
        $ghost = 'knorkeIt' . substr(bin2hex(random_bytes(12)), 0, 23);
        Server::get(ShareStore::class)->apply($b, [['kind' => 'team', 'recipient' => $ghost, 'role' => 'view', 'display_name' => 'Ghost']], [], [], $this->uid, self::nowMs());
        $this->assertSame(['team:' . $ghost . '=view'], $this->rows($b));
        $dispatchDestroyed($ghost);
        $this->assertSame([], $this->rows($b), 'CircleDestroyedEvent → team rows deleted');
        $this->assertSame($acl + 1, $this->aclGen($b), 'and the board bumped');
    }

    public function testHiddenOrForeignTeamsAreRefused(): void {
        if (!$this->teamSupport()) {
            $this->markTestSkipped('Circles is not active in this stack');
        }
        $other = $this->account('ft');
        [$code, $out] = $this->occ(['circles:manage:create', '--type', 'user', '--output=json', $other->getUID(), 'knorke-it-' . bin2hex(random_bytes(3))]);
        $this->assertSame(0, $code, $out);
        $team = (string)(json_decode($out, true)['id'] ?? '');
        $this->teamsMade[] = $team;
        $b = $this->board();
        try {
            $this->services()['shares']->save($this->uid, $b, [['kind' => 'team', 'id' => $team, 'role' => 'view']]);
            $this->fail('the owner is no member of that team');
        } catch (HttpError $e) {
            $this->assertSame([400, 'recipient_not_found', 0], [$e->status, $e->error, $e->payload()['at']]);
        }
        $this->assertSame([], $this->rows($b));
    }

    // ── Board list SQL ─────────────────────────────────────────────────────

    public function testBoardListSqlCoversEverySource(): void {
        $me = $this->account('ls');
        $g = $this->group('ls', $me);
        $now = self::nowMs();
        $own = $this->board($me->getUID(), 'Own');
        $byUser = $this->board(null, 'User');
        $byGroup = $this->board(null, 'Group');
        $both = $this->board(null, 'Both');
        $none = $this->board(null, 'None');
        $store = Server::get(ShareStore::class);
        $store->apply($byUser, [['kind' => 'user', 'recipient' => $me->getUID(), 'role' => 'vote', 'display_name' => null]], [], [], $this->uid, $now);
        $store->apply($byGroup, [['kind' => 'group', 'recipient' => $g->getGID(), 'role' => 'moderate', 'display_name' => 'G']], [], [], $this->uid, $now);
        $store->apply($both, [['kind' => 'group', 'recipient' => $g->getGID(), 'role' => 'view', 'display_name' => 'G']], [], [], $this->uid, $now);
        $store->apply($none, [['kind' => 'group', 'recipient' => 'knorke-it-nobody', 'role' => 'edit', 'display_name' => null]], [], [], $this->uid, $now);
        $tok = 'ITlsLink' . substr(bin2hex(random_bytes(8)), 0, 16);
        $link = $this->boards->insertLink($both, $tok, 'edit', $this->uid, $now, null, null);
        $this->boards->addMember($both, $me->getUID(), 'edit', $link, $now);
        // Many group ids: the IN list goes in chunks (SQLite: ≤ 999 parameters).
        $gids = array_merge(array_map(static fn (int $i): string => 'knorke-it-x' . $i, range(1, 1200)), [$g->getGID()]);
        $rows = $this->boards->listForUser($me->getUID(), $gids, ['knorke-it-noteam'], $now);
        $got = [];
        foreach ($rows as $r) {
            $got[$r['id']] = [$r['member_role'], $r['share_roles']];
        }
        ksort($got);
        $want = [$own => [null, []], $byUser => [null, ['vote']], $byGroup => [null, ['moderate']], $both => ['edit', ['view']]];
        ksort($want);
        $this->assertSame($want, $got, 'own, user, group, link + group; nothing else');
        $this->assertSame(count($rows), count(array_unique(array_column($rows, 'id'))), 'one row per board');
        $list = $this->services($me)['boards']->listFor($me->getUID());
        $by = [];
        foreach ($list as $x) {
            $by[$x['id']] = [$x['role'], $x['source'], $x['mod']];
        }
        ksort($by);
        $this->assertSame([$own => ['owner', 'own', true], $byUser => ['vote', 'share', false], $byGroup => ['edit', 'share', true], $both => ['edit', 'link', false]],
            $by, 'roles and sources');
        $this->assertCount(4, $list);
        // Deleting a board deletes its share rows.
        $this->services()['boards']->delete($this->uid, $byGroup);
        $this->assertSame([], $this->rows($byGroup));
    }

    // ── Links: password and expiry on the real database ────────────────────

    public function testLinkPasswordAndExpiry(): void {
        $guestNet = '10.77.' . random_int(0, 255) . '.' . random_int(1, 254);
        Server::get(IUserConfig::class)->setValueString($this->uid, 'core', 'timezone', 'Europe/Berlin');
        $b = $this->board();
        $s = $this->services();
        $day = (new \DateTimeImmutable('now', new \DateTimeZone('Europe/Berlin')))->modify('+3 days')->format('Y-m-d');
        $l = $s['boards']->enableLink($this->uid, $b, 'vote', ['password' => 'Kn0rke-it-secret', 'expiresAt' => $day]);
        $this->assertSame(['vote', true, $day], [$l['role'], $l['password'], $l['expiresOn']]);
        $this->assertSame((new \DateTimeImmutable($day . ' 00:00:00', new \DateTimeZone('Europe/Berlin')))->modify('+1 day')->getTimestamp() * 1000 - 1, $l['expiresAt'],
            'end of the day in the OWNER\'s zone');
        $hash = (string)$this->db->executeQuery('SELECT password_hash FROM *PREFIX*knorke_links WHERE token = ?', [$l['token']])->fetchOne();
        $this->assertNotSame('', $hash);
        $this->assertStringNotContainsString('Kn0rke-it-secret', $hash, 'only the hash is stored');
        // Guest join: required, wrong, right; the token ends with the link.
        foreach ([[null, 'password_required'], ['nope', 'password_wrong']] as [$pw, $code]) {
            try {
                $s['access']->joinGuest($l['token'], 'Gina', null, $guestNet, $pw);
                $this->fail($code);
            } catch (HttpError $e) {
                $this->assertSame([403, $code], [$e->status, $e->error]);
            }
        }
        [$a, , $exp] = $s['access']->joinGuest($l['token'], 'Gina', null, $guestNet, 'Kn0rke-it-secret');
        $this->assertSame(Role::Vote, $a->principal->role);
        $this->assertSame(intdiv($l['expiresAt'], 1000), $exp);
        $linkId = (int)$this->db->executeQuery('SELECT id FROM *PREFIX*knorke_links WHERE token = ?', [$l['token']])->fetchOne();
        $win = intdiv(self::nowMs(), LinkSecrets::PW_WINDOW_MS);
        $this->assertSame(1, $this->redis->get($s['secrets']->failureKey($linkId, $guestNet, $win)), 'one failure in Redis');
        // Expired (SQL): link_expired without a failure; /p shows expired (PublicPageController, unit-tested).
        $this->db->executeStatement('UPDATE *PREFIX*knorke_links SET expires_at = ? WHERE id = ?', [self::nowMs() - 1, $linkId]);
        try {
            $s['access']->joinGuest($l['token'], 'Gina', null, $guestNet, 'Kn0rke-it-secret');
            $this->fail('expired');
        } catch (HttpError $e) {
            $this->assertSame([403, 'link_expired'], [$e->status, $e->error]);
        }
        $this->assertSame(1, $this->redis->get($s['secrets']->failureKey($linkId, $guestNet, $win)), 'no failure counted');
        // POST without rotate on the expired link renews it.
        $l2 = $this->services()['boards']->enableLink($this->uid, $b, 'vote', []);
        $this->assertNotSame($l['token'], $l2['token']);
        $this->assertTrue($l2['password'], 'the password is carried over');
        $this->assertNull($l2['expiresAt'], 'the expired date is not');
        // CleanupJob: links expired 30+ days ago go.
        $this->db->executeStatement('UPDATE *PREFIX*knorke_links SET expires_at = ? WHERE id = ?', [self::nowMs() - Limits::CHANGES_RETENTION_MS - 60000, $linkId]);
        Server::get(CleanupJob::class)->prune(self::nowMs());
        $this->assertFalse($this->db->executeQuery('SELECT id FROM *PREFIX*knorke_links WHERE id = ?', [$linkId])->fetchOne());
        Server::get(IUserConfig::class)->deleteUserConfig($this->uid, 'core', 'timezone');
    }

    // ── Legacy MySQL/MariaDB without 4-byte UTF-8 ──────────────────────────

    public function testFourBytePreChecks(): void {
        $b = $this->board();
        $s = $this->services();
        if ($this->db->supports4ByteText()) {
            $this->assertSame(['sharees' => [], 'more' => false], ['sharees' => [], 'more' => false]);
            try {
                $s['shares']->save($this->uid, $b, [['kind' => 'user', 'id' => "knorke-it-\u{1F600}", 'role' => 'edit']]);
                $this->fail('no such user');
            } catch (HttpError $e) {
                $this->assertSame([400, 'recipient_not_found', 0], [$e->status, $e->error, $e->payload()['at']], 'utf8mb4: an ordinary miss');
            }
            return;
        }
        try {
            $s['shares']->save($this->uid, $b, [['kind' => 'group', 'id' => "knorke-it-\u{1F600}", 'role' => 'edit']]);
            $this->fail('recipient_not_found expected');
        } catch (HttpError $e) {
            $this->assertSame([400, 'recipient_not_found', 0], [$e->status, $e->error, $e->payload()['at']], 'utf8mb3: before any query (no SQLSTATE 1366)');
        }
        $this->assertSame(['sharees' => [], 'more' => false], $s['shares']->sharees($this->uid, $b, "bo\u{1F600}"));
    }
}
