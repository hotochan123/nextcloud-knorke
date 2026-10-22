<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OC\Notification\Notification;
use OC\RichObjectStrings\RichTextFormatter;
use OC\RichObjectStrings\Validator;
use OCA\Knorke\Notification\ShareNotifications;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\FastCache;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\GuestToken;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\LinkSecrets;
use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Service\MetaService;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Collaboration\Collaborators\ISearch;
use OCP\Config\IUserConfig;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\GroupInterface;
use OCP\HintException;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IDateTimeZone;
use OCP\IDBConnection;
use OCP\IGroup;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Notification\IManager as INotificationManager;
use OCP\Notification\INotification;
use OCP\RichObjectStrings\Definitions;
use OCP\Security\Bruteforce\IThrottler;
use OCP\Security\Bruteforce\MaxDelayReached;
use OCP\Security\Events\ValidatePasswordPolicyEvent;
use OCP\Security\IHasher;
use OCP\Security\ISecureRandom;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use OCP\Share\IManager;
use OCP\Teams\ITeamManager;
use OCP\Teams\Team;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;
use Psr\Log\LoggerInterface;

/**
 * Access, BoardService and ShareService (SPEC-M1 stage 2) wired to in-memory
 * fakes. Nextcloud's link policy (LinkPolicy) answers from $linksAllowed
 * (owner uid → bool, default true) and logs every question in
 * $policyCalls; the database supports 4-byte UTF-8 unless $fourByte is
 * false. The fake connection logs begin/commit/rollBack into $tx.
 *
 * Nextcloud around the share code (all switchable per test):
 *  - accounts: every uid exists and is enabled, except $deletedUsers,
 *    $disabledUsers and the made-up ids knorke-nope-*; display name
 *    ucfirst(uid) . ' Display'; backend name from $backends (e.g. 'Guests'
 *    for an account of the Guests app), else the fake's neutral value
 *  - groups: $groups gid → list of member uids ($groupNames for names),
 *    read live by IGroupManager::getUserGroupIds and by the one group
 *    backend of getBackends() (GroupInterface::getUserGroups); every read
 *    in $groupReads ("getUserGroupIds <uid>", "getUserGroups <uid>");
 *    $groupCache: getUserGroupIds keeps its first answer per uid for the
 *    harness's lifetime, like Nextcloud's per-process cache in a worker;
 *    $groupsFailWith: the backend's getUserGroups throws it
 *  - teams: $teams singleId → [name, member uids]; $teamSupport, $circlesFor
 *  - share manager settings: $share (shareApiEnabled, sharingDisabledFor,
 *    allowGroupSharing, groupMembersOnly, excludeGroups, linkPassword,
 *    expireDefault, expireEnforced, expireDays)
 *  - $search: what ISearch::search answers ([result, more]); $searchCalls
 *  - $systemValues: IConfig system values (sharing.*, ipv6 subnet size)
 *  - password policy: $passwordHint (non-null → HintException); IHasher
 *    hashes as 'h:' . password, $rehash = a new hash verify() hands back
 *  - user time zones $zones (uid → stored zone), default zone $defaultZone
 *  - Knorke app config $appValues (key → stored text, e.g. public_url, P7;
 *    read through getValueString/getValueInt), IURLGenerator answering
 *    https://cloud.example/index.php/apps/knorke/p/<token> (absolute) and
 *    /index.php/apps/knorke/p/<token> (linkToRoute)
 *  - $users / $groupManager: the IUserManager (userExists follows
 *    user()) and IGroupManager fakes, public for OrphanReconciler tests
 *  - group members through IGroup::searchUsers (calls in $groupSearches),
 *    team members through ITeamManager::getMembersOfTeam (uid → display
 *    name from $teams; calls in $memberCalls, $membersFailWith throws)
 *  - $apps (IAppManager): circles per $circlesFor, knorke per $knorkeFor
 *    (uid → bool, default true), every other app false
 *  - the Guests app (job 079, ShareService::appAccess): the container hands
 *    out $apps for IAppManager, $guestsApp (the real GuestsAppWhitelist over
 *    this container) and, for GuestsAppWhitelist::WHITELIST, $guests (e.g. a
 *    FakeGuestsWhitelist whose answer and throw a case switches); null:
 *    NotFoundExceptionInterface, as without the Guests app
 *  - share notifications (M2): $notifications (ShareNotifications, also
 *    from the container unless $notificationsFailWith is set) over a
 *    recording INotificationManager: $notifyLog gets defer, flush,
 *    "markProcessed|notify <user> <objectType> <objectId> <subject>
 *    <timestamp>", $sent the notifications handed to notify(), $notifyFail
 *    (uid → Throwable) makes notify() throw for a uid, $txAtFirstNote is $tx
 *    at the manager's first call; createNotification() is Nextcloud's own
 *    Notification with the real Validator and RichTextFormatter
 *  - logger: $warnings (warning, error) and $infos ([message, context])
 */
final class AccessHarness {
    public FakeBoardStore $boards;
    public FakeShareStore $shareRows;
    /** @var array<string, bool> */
    public array $linksAllowed = [];
    /** @var list<string> */
    public array $policyCalls = [];
    public bool $fourByte = true;
    public LinkPolicy $policy;
    public MemoryCache $mem;
    public FastCache $cache;
    public EpochStub $epoch;
    public MetaService $meta;
    /** @var list<string> begin/commit/rollBack of the fake connection */
    public array $tx = [];
    public GuestToken $tokens;
    public Access $access;
    public BoardService $service;
    public ShareService $shares;
    public SharePolicy $sharePolicy;
    public LinkSecrets $secrets;
    public ?string $uid = 'alice';
    public int $time = 1_760_000_000;
    /** @var list<string> */
    public array $limiterCalls = [];
    public int $limiterMax = 1000;
    /** @var list<string> limiter identifiers whose budget is used up */
    public array $limiterFull = [];
    /** @var array<string, int> identifier → calls before it is used up (user limiter) */
    public array $userLimits = [];
    public int $misses = 0;
    /** @var list<string> */
    public array $throttleCalls = [];
    /** @var list<string> */
    public array $deletedUsers = [];
    /** @var list<string> */
    public array $disabledUsers = [];
    /** @var array<string, string> uid → IUser::getBackendClassName() (unset: the fake's neutral value) */
    public array $backends = [];
    /** @var array<string, list<string>> gid → member uids */
    public array $groups = ['knorke-e2e' => ['bob', 'carol'], 'staff' => ['alice', 'bob']];
    /** @var array<string, string> */
    public array $groupNames = [];
    /** getUserGroupIds keeps its first answer per uid (OC\Group\Manager::$cachedUserGroups, never cleared in a worker). */
    public bool $groupCache = false;
    /** @var list<string> "getUserGroupIds <uid>" (manager, cache hits too) and "getUserGroups <uid>" (backend) */
    public array $groupReads = [];
    /** The group backend's getUserGroups() throws this. */
    public ?\Throwable $groupsFailWith = null;
    /** @var array<string, array{0: string, 1: list<string>}> singleId → [name, member uids] */
    public array $teams = [];
    public bool $teamSupport = true;
    /** @var array<string, bool> uid → circles enabled for the user (default true) */
    public array $circlesFor = [];
    /** @var array<string, mixed> share manager settings */
    public array $share = [
        'shareApiEnabled' => true, 'sharingDisabledFor' => [], 'allowGroupSharing' => true, 'groupMembersOnly' => false,
        'excludeGroups' => [], 'linkPassword' => false, 'expireDefault' => false, 'expireEnforced' => false, 'expireDays' => 7,
    ];
    /** @var array{0: array, 1: bool} */
    public array $search = [[], false];
    /** @var list<array> */
    public array $searchCalls = [];
    /** @var array<string, mixed> */
    public array $systemValues = [];
    public ?string $passwordHint = null;
    /** @var list<string> passwords seen by the policy event */
    public array $policyEvents = [];
    public ?string $rehash = null;
    /** @var array<string, string> uid → stored time zone */
    public array $zones = [];
    public string $defaultZone = 'UTC';
    /** @var list<array> jobs added to IJobList */
    public array $jobs = [];
    /** @var list<string> warnings logged */
    public array $warnings = [];
    /** @var list<string> */
    public array $teamCalls = [];
    /** @var array<string, string> Knorke app config (stored texts) */
    public array $appValues = [];
    /** @var array<string, bool> uid → Knorke enabled for the user (default true) */
    public array $knorkeFor = [];
    /** What the container hands out for GuestsAppWhitelist::WHITELIST; null: NotFoundExceptionInterface. */
    public ?object $guests = null;
    public GuestsAppWhitelist $guestsApp;
    /** @var list<string> IGroup::searchUsers calls "gid|search|limit|offset" */
    public array $groupSearches = [];
    /** @var list<string> ITeamManager::getMembersOfTeam calls "teamId userId" */
    public array $memberCalls = [];
    public ?\Throwable $membersFailWith = null;
    /** @var list<array{0: string, 1: array}> info lines [message, context] */
    public array $infos = [];
    /** @var list<string> calls of the notification manager */
    public array $notifyLog = [];
    /** @var list<INotification> */
    public array $sent = [];
    /** @var array<string, \Throwable> uid → what notify() throws */
    public array $notifyFail = [];
    /** @var list<string>|null $tx when the notification manager saw its first call */
    public ?array $txAtFirstNote = null;
    /** The container throws this for ShareNotifications. */
    public ?\Throwable $notificationsFailWith = null;
    public ShareNotifications $notifications;
    public INotificationManager $notificationManager;
    public IUserManager $users;
    public IGroupManager $groupManager;
    public IAppManager $apps;
    public LoggerInterface $logger;
    private int $rnd = 0;
    /** @var array<string, list<string>> uid → the manager's cached group ids ($groupCache) */
    private array $cachedUserGroups = [];

    public function __construct() {
        $this->boards = new FakeBoardStore();
        $this->shareRows = new FakeShareStore();
        $this->boards->shares = $this->shareRows;
        $this->mem = new MemoryCache();
        $this->epoch = new EpochStub();
        $this->cache = new FastCache($this->mem->factory(), $this->epoch->epoch());
        $config = Fake::of(IConfig::class, [
            'getSystemValueString' => fn (string $k, string $d = ''): string => $k === 'secret' ? 'unit-secret' : (string)($this->systemValues[$k] ?? $d),
            'getSystemValueInt' => fn (string $k, int $d = 0): int => (int)($this->systemValues[$k] ?? $d),
        ]);
        $time = Fake::of(ITimeFactory::class, [
            'getTime' => fn (): int => $this->time,
            'now' => fn (): \DateTimeImmutable => new \DateTimeImmutable('@' . $this->time),
        ]);
        $this->tokens = new GuestToken($config, $time);
        $throttler = Fake::of(IThrottler::class, [
            'sleepDelayOrThrowOnMax' => function (string $ip, string $action = ''): int {
                $this->throttleCalls[] = 'check' . ($action === LinkSecrets::THROTTLE_ACTION ? ' pw' : '');
                if ($action === LinkThrottle::ACTION && $this->misses > 10) {
                    throw new MaxDelayReached();
                }
                return 0;
            },
            'registerAttempt' => function (string $action, string $ip, array $m = []): void {
                $this->throttleCalls[] = 'register' . ($action === LinkSecrets::THROTTLE_ACTION ? ' pw' : '');
                if ($action === LinkThrottle::ACTION) {
                    $this->misses++;
                }
            },
        ]);
        $throttle = new LinkThrottle($throttler);
        $limited = static fn () => new class('limited') extends \RuntimeException implements IRateLimitExceededException {
        };
        $limiter = Fake::of(ILimiter::class, [
            'registerAnonRequest' => function (string $id, int $limit, int $period, string $ip) use ($limited): void {
                $this->limiterCalls[] = "$id $limit $period $ip";
                if (count($this->limiterCalls) > $this->limiterMax || in_array($id, $this->limiterFull, true)) {
                    throw $limited();
                }
            },
            'registerUserRequest' => function (string $id, int $limit, int $period, IUser $user) use ($limited): void {
                $this->limiterCalls[] = "$id $limit $period " . $user->getUID();
                $used = count(array_filter($this->limiterCalls, static fn (string $c): bool => str_starts_with($c, "$id ")));
                if (in_array($id, $this->limiterFull, true) || $used > ($this->userLimits[$id] ?? $limit)) {
                    throw $limited();
                }
            },
        ]);
        $random = Fake::of(ISecureRandom::class, [
            'generate' => fn (int $length, string $chars = '') => substr(str_repeat(sprintf('R%05d', ++$this->rnd), 10), 0, $length),
        ]);
        $session = Fake::of(IUserSession::class, [
            'getUser' => fn () => $this->uid === null ? null : $this->user($this->uid),
            'isLoggedIn' => fn () => $this->uid !== null,
        ]);
        $this->policy = new class($this) extends LinkPolicy {
            public function __construct(private AccessHarness $h) {
            }

            public function allows(string $ownerUid, ?IUser $known = null): bool {
                $this->h->policyCalls[] = $ownerUid;
                return $this->h->linksAllowed[$ownerUid] ?? true;
            }
        };
        $users = Fake::of(IUserManager::class, [
            'getDisplayName' => fn (string $uid): ?string => $this->user($uid) === null ? null : ucfirst($uid) . ' Display',
            'get' => fn (string $uid): ?IUser => $this->user($uid),
            'userExists' => fn (string $uid): bool => $this->user($uid) !== null,
        ]);
        $this->users = $users;
        $groupBackend = Fake::of(GroupInterface::class, [
            'getUserGroups' => function ($uid): array {
                $this->groupReads[] = 'getUserGroups ' . $uid;
                if ($this->groupsFailWith !== null) {
                    throw $this->groupsFailWith;
                }
                return $this->groupsOf((string)$uid);
            },
        ]);
        $groupManager = Fake::of(IGroupManager::class, [
            'get' => fn (string $gid): ?IGroup => $this->group($gid),
            'groupExists' => fn (string $gid): bool => $this->canonicalGid($gid) !== null,
            'getUserGroupIds' => function (IUser $u): array {
                $uid = $u->getUID();
                $this->groupReads[] = 'getUserGroupIds ' . $uid;
                if (!$this->groupCache) {
                    return $this->groupsOf($uid);
                }
                return $this->cachedUserGroups[$uid] ??= $this->groupsOf($uid);
            },
            'getBackends' => fn (): array => [$groupBackend],
        ]);
        $this->groupManager = $groupManager;
        $manager = Fake::of(IManager::class, [
            'shareApiEnabled' => fn (): bool => $this->share['shareApiEnabled'],
            'sharingDisabledForUser' => fn (?string $uid): bool => in_array($uid, $this->share['sharingDisabledFor'], true),
            'allowGroupSharing' => fn (): bool => $this->share['allowGroupSharing'],
            'shareWithGroupMembersOnly' => fn (): bool => $this->share['groupMembersOnly'],
            'shareWithGroupMembersOnlyExcludeGroupsList' => fn (): array => $this->share['excludeGroups'],
            'shareApiLinkEnforcePassword' => fn (bool $check = true): bool => $this->share['linkPassword'],
            'shareApiLinkDefaultExpireDate' => fn (): bool => $this->share['expireDefault'],
            'shareApiLinkDefaultExpireDateEnforced' => fn (): bool => $this->share['expireDefault'] && $this->share['expireEnforced'],
            'shareApiLinkDefaultExpireDays' => fn (): int => $this->share['expireDays'],
        ]);
        $teamManager = Fake::of(ITeamManager::class, [
            'hasTeamSupport' => fn (): bool => $this->teamSupport,
            'getTeamsForUser' => function (string $uid): array {
                $this->teamCalls[] = $uid;
                $out = [];
                foreach ($this->teams as $id => [$name, $members]) {
                    if (in_array($uid, $members, true)) {
                        $out[] = new Team($id, $name, null);
                    }
                }
                return $out;
            },
            'getMembersOfTeam' => function (string $teamId, string $userId): array {
                $this->memberCalls[] = "$teamId $userId";
                if ($this->membersFailWith !== null) {
                    throw $this->membersFailWith;
                }
                $out = [];
                foreach ($this->teams[$teamId][1] ?? [] as $uid) {
                    $out[$uid] = ucfirst((string)$uid) . ' Display';
                }
                return $out;
            },
        ]);
        $search = Fake::of(ISearch::class, ['search' => function ($q, array $types, $lookup, $limit, $offset): array {
            $this->searchCalls[] = ['q' => $q, 'types' => $types, 'lookup' => $lookup, 'limit' => $limit, 'offset' => $offset];
            return $this->search;
        }]);
        $userConfig = Fake::of(IUserConfig::class, [
            'getValueString' => fn (string $uid, string $app, string $key, string $default = '', bool $lazy = false): string => $app === 'core' && $key === 'timezone' ? ($this->zones[$uid] ?? $default) : $default,
        ]);
        $container = Fake::of(ContainerInterface::class, ['get' => fn (string $id): mixed => match ($id) {
            IManager::class => $manager,
            ITeamManager::class => $teamManager,
            ISearch::class => $search,
            IUserConfig::class => $userConfig,
            ShareNotifications::class => $this->notificationsFailWith === null ? $this->notifications : throw $this->notificationsFailWith,
            IAppManager::class => $this->apps,
            GuestsAppWhitelist::class => $this->guestsApp,
            GuestsAppWhitelist::WHITELIST => $this->guests ?? throw new class('no ' . $id) extends \RuntimeException implements NotFoundExceptionInterface {
            },
            default => throw new \LogicException('harness container: ' . $id),
        }, 'has' => fn (string $id): bool => true]);
        $this->guestsApp = new GuestsAppWhitelist($container);
        $apps = Fake::of(IAppManager::class, ['isEnabledForUser' => fn (string $app, ?IUser $u = null): bool => match ($app) {
            'circles' => $this->circlesFor[$u?->getUID() ?? ''] ?? true,
            'knorke' => $this->knorkeFor[$u?->getUID() ?? ''] ?? true,
            default => false,
        }]);
        $this->apps = $apps;
        $logger = Fake::of(LoggerInterface::class, [
            'warning' => function ($m, array $c = []): void {
                $this->warnings[] = (string)$m;
            },
            'error' => function ($m, array $c = []): void {
                $this->warnings[] = 'error: ' . $m;
            },
            'info' => function ($m, array $c = []): void {
                $this->infos[] = [(string)$m, $c];
            },
        ]);
        $this->logger = $logger;
        // inTransaction() follows begin/commit/rollBack (MetaService::write refuses an open
        // transaction, writeLocked needs one; SPEC-M1 §4.13.4, R16).
        $depth = 0;
        $db = Fake::of(IDBConnection::class, [
            'supports4ByteText' => fn (): bool => $this->fourByte,
            'beginTransaction' => function () use (&$depth): void {
                $depth++;
                $this->tx[] = 'begin';
            },
            'commit' => function () use (&$depth): void {
                $depth--;
                $this->tx[] = 'commit';
            },
            'rollBack' => function () use (&$depth): void {
                $depth--;
                $this->tx[] = 'rollBack';
            },
            'inTransaction' => function () use (&$depth): bool {
                return $depth > 0;
            },
        ]);
        $events = Fake::of(IEventDispatcher::class, ['dispatchTyped' => function ($event): void {
            if ($event instanceof ValidatePasswordPolicyEvent) {
                $this->policyEvents[] = $event->getPassword();
                if ($this->passwordHint !== null) {
                    throw new HintException('policy', $this->passwordHint);
                }
            }
        }]);
        // Not a Fake: verify() hands $newHash back by reference (Fake passes copies).
        $hasher = new class($this) implements IHasher {
            public function __construct(private AccessHarness $h) {
            }

            public function hash(string $message): string {
                return 'h:' . $message;
            }

            public function verify(string $message, string $hash, &$newHash = null): bool {
                $ok = $hash === 'h:' . $message || ($this->h->rehash !== null && $hash === 'old:' . $message);
                if ($ok && $this->h->rehash !== null && $hash === 'old:' . $message) {
                    $newHash = $this->h->rehash;
                }
                return $ok;
            }

            public function validate(string $prefixedHash): bool {
                return true;
            }
        };
        $jobList = Fake::of(IJobList::class, ['add' => function ($job, $argument = null): void {
            $this->jobs[] = ['job' => is_string($job) ? $job : get_class($job), 'argument' => $argument];
        }]);
        $dtz = Fake::of(IDateTimeZone::class, ['getDefaultTimeZone' => fn (): \DateTimeZone => new \DateTimeZone($this->defaultZone)]);

        $this->sharePolicy = new SharePolicy($container, $users, $groupManager, $apps, $logger);
        $this->secrets = new LinkSecrets($events, $hasher, $this->cache, $throttler, $config, $dtz, $container, $this->boards, $time);
        $this->shares = new ShareService($this->shareRows, $this->boards, $this->sharePolicy, $this->policy, $this->cache, $users, $db,
            $limiter, $config, $jobList, $container, $time, $logger);
        $this->access = new Access($session, $this->boards, $this->cache, $this->tokens, $throttle, $limiter, $random, $config, $time,
            $this->policy, $this->shares, $this->secrets);

        // Share notifications (M2): a recording manager around Nextcloud's own Notification.
        $note = function (string $entry): void {
            $this->txAtFirstNote ??= $this->tx;
            $this->notifyLog[] = $entry;
        };
        $describe = static fn (INotification $n): string => implode(' ', [$n->getUser(), $n->getObjectType(), $n->getObjectId(), $n->getSubject(), $n->getDateTime()->getTimestamp()]);
        $this->notificationManager = Fake::of(INotificationManager::class, [
            'createNotification' => fn (): INotification => new Notification(new Validator(new Definitions()), new RichTextFormatter()),
            'defer' => function () use ($note): bool {
                $note('defer');
                return true;
            },
            'flush' => function () use ($note): void {
                $note('flush');
            },
            'markProcessed' => function (INotification $n) use ($note, $describe): void {
                $note('markProcessed ' . $describe($n));
            },
            'notify' => function (INotification $n) use ($note, $describe): void {
                $note('notify ' . $describe($n));
                if (isset($this->notifyFail[$n->getUser()])) {
                    throw $this->notifyFail[$n->getUser()];
                }
                $this->sent[] = $n;
            },
        ]);
        $this->notifications = new ShareNotifications($this->boards, $this->shareRows, $this->sharePolicy, $users, $groupManager, $apps,
            $this->notificationManager, $jobList, $time, $container, $logger);

        $urls = Fake::of(IURLGenerator::class, [
            'linkToRouteAbsolute' => fn (string $route, array $args = []): string => 'https://cloud.example/index.php/apps/knorke/p/' . $args['token'],
            'linkToRoute' => fn (string $route, array $args = []): string => '/index.php/apps/knorke/p/' . $args['token'],
        ]);
        $request = Fake::of(IRequest::class, ['getRemoteAddress' => fn (): string => '10.0.0.1']);
        $appConfig = Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $app, string $key, int $default = 0, ?bool $lazy = false): int => isset($this->appValues[$key]) ? (int)$this->appValues[$key] : $default,
            'getValueString' => fn (string $app, string $key, string $default = '', ?bool $lazy = false): string => $this->appValues[$key] ?? $default,
        ]);
        $this->meta = new MetaService($this->boards, $this->cache, $db);
        $this->service = new BoardService($this->boards, $this->cache, $users, $urls, $random, $throttle, $request, new Limits($appConfig), $time,
            $db, $this->policy, $this->meta, $this->shares, $this->sharePolicy, $this->secrets, $this->access, $appConfig, $logger);
    }

    public function user(string $uid): ?IUser {
        if (in_array($uid, $this->deletedUsers, true) || str_starts_with($uid, 'knorke-nope')) {
            return null;
        }
        $methods = [
            'getUID' => fn () => $uid,
            'getDisplayName' => fn () => ucfirst($uid) . ' Display',
            'isEnabled' => fn (): bool => !in_array($uid, $this->disabledUsers, true),
        ];
        if (isset($this->backends[$uid])) {
            $backend = $this->backends[$uid];
            $methods['getBackendClassName'] = fn () => $backend;
        }
        return Fake::of(IUser::class, $methods);
    }

    /** Case-insensitive lookup like Nextcloud's database group backend; the canonical gid or null. */
    private function canonicalGid(string $gid): ?string {
        foreach (array_keys($this->groups) as $g) {
            if (strcasecmp((string)$g, $gid) === 0) {
                return (string)$g;
            }
        }
        return null;
    }

    private function group(string $gid): ?IGroup {
        $g = $this->canonicalGid($gid);
        if ($g === null) {
            return null;
        }
        return Fake::of(IGroup::class, [
            'getGID' => fn (): string => $g,
            'getDisplayName' => fn (): string => $this->groupNames[$g] ?? ucfirst($g),
            'inGroup' => fn (IUser $u): bool => in_array($u->getUID(), $this->groups[$g] ?? [], true),
            // Like Nextcloud: accounts only (also disabled ones), '' matches every member.
            'searchUsers' => function (string $search, ?int $limit = null, ?int $offset = null) use ($g): array {
                $this->groupSearches[] = "$g|$search|" . ($limit ?? 'null') . '|' . ($offset ?? 'null');
                $out = [];
                foreach ($this->groups[$g] ?? [] as $uid) {
                    $u = $this->user((string)$uid);
                    if ($u !== null && ($search === '' || stripos((string)$uid, $search) !== false)) {
                        $out[] = $u;
                    }
                }
                return array_slice($out, $offset ?? 0, $limit);
            },
        ]);
    }

    /** @return list<string> */
    private function groupsOf(string $uid): array {
        $out = [];
        foreach ($this->groups as $g => $members) {
            if (in_array($uid, $members, true)) {
                $out[] = (string)$g;
            }
        }
        return $out;
    }

    /** A guest token as joinGuest would issue it. */
    public function token(int $board, int $lg = 1, string $role = 'edit', string $gid = 'gAAAAAAAAAAA', ?int $exp = null): string {
        return $this->tokens->issue(['v' => 1, 'b' => $board, 'g' => $gid, 'r' => $role, 'lg' => $lg, 'exp' => $exp ?? $this->time + 3600, 'n' => 'Gina']);
    }

    public function link(int $board, ?int $revokedAt = null, string $token = 'Ab3dEf6hIj9kLm2nOp5qRs8t', string $role = 'edit', ?string $hash = null, ?int $expiresAt = null): string {
        $id = $this->boards->insertLink($board, $token, $role, 'alice', 1, $hash, $expiresAt);
        $this->boards->links[$id]['revoked_at'] = $revokedAt;
        return $token;
    }

    /** Now in ms (the harness clock). */
    public function nowMs(): int {
        return $this->time * 1000;
    }
}
