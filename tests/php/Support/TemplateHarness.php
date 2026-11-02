<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OC\Notification\Notification;
use OC\RichObjectStrings\RichTextFormatter;
use OC\RichObjectStrings\Validator;
use OCA\Knorke\Controller\TemplateApiController;
use OCA\Knorke\Notification\Notifier;
use OCA\Knorke\Notification\TemplateNotifications;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\ShapeLibStore;
use OCA\Knorke\Service\TemplateStore;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IGroup;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\L10N\IFactory;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use OCP\RichObjectStrings\Definitions;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;
use Psr\Log\LoggerInterface;

/**
 * Template suggestions (factory job 182) over a real SQLite database
 * (SqliteDb) and Nextcloud fakes, all switchable per test:
 *  - accounts $names (uid → display name); $deleted are gone, $disabled
 *    disabled, $noApp without access to Knorke, $backends (uid → backend
 *    name, e.g. 'Guests' for an account of the Guests app)
 *  - $admins: the members of the group "admin" (IGroup::searchUsers) and
 *    whom IGroupManager::isAdmin says yes to
 *  - the notification manager: a "bell" in memory ($bell: what each account
 *    has, [user, type, id, subject, params]); notify() adds one,
 *    markProcessed() removes every one matching its app, object, subject
 *    and – when set – user; $log records defer, flush, notify and
 *    markProcessed; $notifyFail makes notify() throw
 *  - the logger: $warnings and $infos (messages)
 *  - call(): one request through TemplateApiController as an account
 *  - notifier(): Notifier with this store and group manager in its
 *    container, English and German (l10n/de.json) texts, URLs under
 *    https://cloud.example
 */
final class TemplateHarness {
    public const BASE = 'https://cloud.example/index.php';

    public SqliteDb $sql;
    public TemplateStore $store;
    public TemplateNotifications $notes;
    /** @var array<string, string> uid → display name */
    public array $names = ['alice' => 'Alice Adler', 'bob' => 'Bob Berg', 'admin' => 'Ada Admin', 'root' => 'Root Admin', 'gast' => 'Gast Gruen',
        'dis' => 'Dis Abled', 'noapp' => 'No App'];
    /** @var list<string> members of the group admin */
    public array $admins = ['admin', 'root'];
    /** @var list<string> */
    public array $deleted = [];
    /** @var list<string> */
    public array $disabled = [];
    /** @var list<string> */
    public array $noApp = [];
    /** @var array<string, string> */
    public array $backends = ['gast' => GuestsAppWhitelist::BACKEND];
    /** @var list<array{0: string, 1: string, 2: string, 3: string, 4: array}> */
    public array $bell = [];
    /** @var list<string> */
    public array $log = [];
    public ?\Throwable $notifyFail = null;
    /** (job 203) ShapeLibHarness puts its store here for notifier() */
    public ?ShapeLibStore $shapeLibs = null;
    /** @var list<string> */
    public array $warnings = [];
    /** @var list<string> */
    public array $infos = [];
    public int $time = 1_760_000_000;
    public IUserManager $users;
    public IGroupManager $groups;
    public IAppManager $apps;
    public IManager $manager;
    public LoggerInterface $logger;
    /** @var array<string, string> German translations of l10n/de.json */
    private static array $de = [];

    public function __construct() {
        $this->sql = new SqliteDb();
        $this->users = Fake::of(IUserManager::class, [
            'get' => fn (string $uid): ?IUser => $this->user($uid),
            'getDisplayName' => fn (string $uid): ?string => $this->user($uid) === null ? null : $this->names[$uid],
            'userExists' => fn (string $uid): bool => $this->user($uid) !== null,
        ]);
        $admin = Fake::of(IGroup::class, [
            'getGID' => fn (): string => 'admin',
            'searchUsers' => fn (string $search, ?int $limit = null, ?int $offset = null): array => array_slice(
                array_values(array_filter(array_map(fn (string $uid): ?IUser => $this->user($uid), $this->admins))), 0, $limit ?? null),
        ]);
        $this->groups = Fake::of(IGroupManager::class, [
            'isAdmin' => fn (string $uid): bool => $this->user($uid) !== null && in_array($uid, $this->admins, true),
            'get' => fn (string $gid): ?IGroup => $gid === 'admin' ? $admin : null,
        ]);
        $this->apps = Fake::of(IAppManager::class, [
            'isEnabledForUser' => fn (string $app, ?IUser $u = null): bool => $app === 'knorke' && $u !== null && !in_array($u->getUID(), $this->noApp, true),
        ]);
        $this->manager = Fake::of(IManager::class, [
            'createNotification' => fn (): INotification => new Notification(new Validator(new Definitions()), new RichTextFormatter()),
            'defer' => function (): bool {
                $this->log[] = 'defer';
                return true;
            },
            'flush' => function (): void {
                $this->log[] = 'flush';
            },
            'notify' => function (INotification $n): void {
                $this->log[] = 'notify ' . $n->getUser() . ' ' . $n->getSubject() . ' ' . $n->getObjectId();
                if ($this->notifyFail !== null) {
                    throw $this->notifyFail;
                }
                $this->bell[] = [$n->getUser(), $n->getObjectType(), $n->getObjectId(), $n->getSubject(), $n->getSubjectParameters()];
            },
            'markProcessed' => function (INotification $n): void {
                $this->log[] = 'markProcessed ' . ($n->getUser() === '' ? '*' : $n->getUser()) . ' ' . $n->getSubject() . ' ' . $n->getObjectId();
                $this->bell = array_values(array_filter($this->bell, static fn (array $b): bool => !($b[1] === $n->getObjectType() && $b[2] === $n->getObjectId()
                    && $b[3] === $n->getSubject() && ($n->getUser() === '' || $b[0] === $n->getUser()))));
            },
        ]);
        $this->logger = Fake::of(LoggerInterface::class, [
            'warning' => function ($m, array $c = []): void {
                $this->warnings[] = (string)$m;
            },
            'error' => function ($m, array $c = []): void {
                $this->warnings[] = 'error: ' . $m;
            },
            'info' => function ($m, array $c = []): void {
                $this->infos[] = (string)$m;
            },
        ]);
        $time = Fake::of(ITimeFactory::class, ['getTime' => fn (): int => $this->time]);
        $this->notes = new TemplateNotifications($this->users, $this->groups, $this->apps, $this->manager, $time, $this->logger);
        $this->store = new TemplateStore($this->sql->connection(), $this->users, $this->groups, $this->notes);
    }

    public function user(string $uid): ?IUser {
        if (!isset($this->names[$uid]) || in_array($uid, $this->deleted, true)) {
            return null;
        }
        $methods = [
            'getUID' => fn (): string => $uid,
            'getDisplayName' => fn (): string => $this->names[$uid],
            'isEnabled' => fn (): bool => !in_array($uid, $this->disabled, true),
        ];
        if (isset($this->backends[$uid])) {
            $backend = $this->backends[$uid];
            $methods['getBackendClassName'] = fn (): string => $backend;
        }
        return Fake::of(IUser::class, $methods);
    }

    /**
     * One request through TemplateApiController as $uid (the route parameter
     * id as text, like Nextcloud's router passes it).
     *
     * @return array{0: int, 1: mixed} status and data
     */
    public function call(string $uid, string $action, array $body = [], ?int $id = null): array {
        $url = ['_route' => 'knorke.templateApi.' . $action] + ($id === null ? [] : ['id' => (string)$id]);
        $params = array_merge($body, $url);
        $request = Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? '42' : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
        ], ['urlParams' => $url]);
        $user = $this->user($uid);
        $c = new TemplateApiController($request, $this->logger, Fake::of(IUserSession::class, ['getUser' => fn (): ?IUser => $user]), $this->store);
        $r = match ($action) {
            'index' => $c->index(),
            'create' => $c->create(),
            'show' => $c->show((int)$id),
            'update' => $c->update((int)$id),
            'destroy' => $c->destroy((int)$id),
            'adopt' => $c->adopt((int)$id),
            'review' => $c->review(),
        };
        return [$r->getStatus(), $r->getData()];
    }

    /** @return list<array<string, mixed>> every row of the table, by id */
    public function rows(): array {
        return $this->sql->all('SELECT * FROM *PREFIX*knorke_templates ORDER BY id');
    }

    /** @return list<string> "<user> <subject> <id>" of the bell, in order */
    public function bellOf(?string $user = null): array {
        $out = [];
        foreach ($this->bell as [$u, , $id, $subject]) {
            if ($user === null || $u === $user) {
                $out[] = "$u $subject $id";
            }
        }
        return $out;
    }

    /** The notification stored for $user and template $id with $subject, as Nextcloud keeps it (a fresh copy). */
    public function stored(string $user, int $id, string $subject): INotification {
        foreach ($this->bell as [$u, $type, $oid, $s, $params]) {
            if ($u === $user && $oid === (string)$id && $s === $subject) {
                $n = new Notification(new Validator(new Definitions()), new RichTextFormatter());
                return $n->setApp('knorke')->setUser($u)->setObject($type, $oid)->setSubject($s, $params)->setDateTime(new \DateTime('@' . $this->time));
            }
        }
        throw new \LogicException("no $subject for $user and template $id");
    }

    /** The Notifier as Nextcloud builds it, with this harness behind its container. */
    public function notifier(): Notifier {
        self::$de = self::$de ?: json_decode((string)file_get_contents(dirname(__DIR__, 3) . '/l10n/de.json'), true, 512, JSON_THROW_ON_ERROR)['translations'];
        $container = Fake::of(ContainerInterface::class, [
            'get' => fn (string $id): mixed => match ($id) {
                TemplateStore::class => $this->store,
                // job 203: the shape library store of a ShapeLibHarness that holds this harness
                ShapeLibStore::class => $this->shapeLibs ?? throw new \LogicException('no shape library store'),
                IGroupManager::class => $this->groups,
                LoggerInterface::class => $this->logger,
                default => throw new class('no ' . $id) extends \RuntimeException implements NotFoundExceptionInterface {
                },
            },
            'has' => fn (string $id): bool => true,
        ]);
        $l10n = Fake::of(IFactory::class, ['get' => fn ($app, $lang = null, $locale = null): IL10N => Fake::of(IL10N::class, [
            't' => fn (string $text, $parameters = []): string => vsprintf($lang === 'de' ? (self::$de[$text] ?? $text) : $text, (array)$parameters),
        ])]);
        $urls = Fake::of(IURLGenerator::class, [
            'linkToRouteAbsolute' => fn (string $route, array $args = []): string => match (true) {
                $route === 'settings.AdminSettings.index' && $args === ['section' => 'knorke'] => self::BASE . '/settings/admin/knorke',
                $route === 'knorke.page.index' && $args === [] => self::BASE . '/apps/knorke/',
                default => self::BASE . '/nope',
            },
            'imagePath' => fn (string $app, string $file): string => '/custom_apps/' . $app . '/img/' . $file,
            'getAbsoluteURL' => fn (string $url): string => 'https://cloud.example' . $url,
        ]);
        return new Notifier($l10n, $urls, $this->users, $this->apps, $container, new GuestsAppWhitelist($container));
    }
}
