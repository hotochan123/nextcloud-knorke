<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Listener\UserEnabledListener;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\ShareService;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCP\EventDispatcher\Event;
use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IManager;
use OCP\User\Events\UserChangedEvent;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Factory job 245 (audit G1): while Nextcloud hides the shares of disabled
 * accounts (files_sharing hide_disabled_user_shares, default yes), nobody
 * reaches the boards of a disabled owner — guests get links_disabled,
 * accounts not_found — and enabling the account opens everything again.
 */
final class DisabledOwnerTest extends TestCase {
    private AccessHarness $h;

    protected function setUp(): void {
        $this->h = new AccessHarness();
    }

    private function expectHttp(int $status, string $code, callable $fn): void {
        try {
            $fn();
            $this->fail("expected $status $code");
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error]);
        }
    }

    // ── LinkPolicy (AK1) ───────────────────────────────────────────────────

    /**
     * @param array<string, bool> $enabled uid → isEnabled (missing: no such account)
     * @param list<string> $configReads
     */
    private function policy(array $enabled, ?string $setting, array &$configReads): LinkPolicy {
        $users = Fake::of(IUserManager::class, ['get' => fn (string $uid): ?IUser => !array_key_exists($uid, $enabled) ? null
            : Fake::of(IUser::class, ['getUID' => fn (): string => $uid, 'isEnabled' => fn (): bool => $enabled[$uid]])]);
        $config = Fake::of(IConfig::class, ['getAppValue' => function (string $app, string $key, string $default = '') use ($setting, &$configReads): string {
            $configReads[] = "$app $key $default";
            return $setting ?? $default;
        }]);
        $manager = Fake::of(IManager::class, ['shareApiAllowLinks' => fn (?IUser $u = null): bool => true]);
        $container = Fake::of(ContainerInterface::class, ['get' => fn (string $id): mixed => match ($id) {
            IManager::class => $manager,
            IConfig::class => $config,
        }]);
        return new LinkPolicy($container, $users);
    }

    public function testOwnerHiddenFollowsNextcloudsSetting(): void {
        $reads = [];
        $p = $this->policy(['on' => true, 'off' => false], null, $reads);
        $this->assertFalse($p->ownerHidden('on'));
        $this->assertTrue($p->allows('on'));
        $this->assertSame([], $reads, 'the setting is read only for a disabled owner');
        $this->assertFalse($p->ownerHidden('gone'), 'an unknown owner is not hidden');
        $this->assertFalse($p->allows('gone'));
        $this->assertTrue($p->ownerHidden('off'), 'unset = yes');
        $this->assertFalse($p->allows('off'));
        $this->assertTrue($p->ownerHidden('off'));
        $this->assertSame(['files_sharing hide_disabled_user_shares yes'], $reads, 'once per owner and request');

        foreach (['no' => false, 'yes' => true, 'false' => false, '0' => false, '' => false] as $value => $hidden) {
            $reads = [];
            $p = $this->policy(['off' => false], (string)$value, $reads);
            $this->assertSame($hidden, $p->ownerHidden('off'), "setting '$value'");
            $this->assertSame(!$hidden, $p->allows('off'), "setting '$value'");
        }
    }

    public function testResetForgetsTheAnswersOfAnAccount(): void {
        $state = ['alice' => true];
        $users = Fake::of(IUserManager::class, ['get' => function (string $uid) use (&$state): ?IUser {
            return Fake::of(IUser::class, ['getUID' => fn (): string => $uid, 'isEnabled' => function () use (&$state, $uid): bool {
                return $state[$uid] ?? true;
            }]);
        }]);
        $config = Fake::of(IConfig::class, ['getAppValue' => fn (string $a, string $k, string $d = ''): string => $d]);
        $manager = Fake::of(IManager::class, ['shareApiAllowLinks' => fn (?IUser $u = null): bool => true]);
        $p = new LinkPolicy(Fake::of(ContainerInterface::class, ['get' => fn (string $id): mixed => $id === IConfig::class ? $config : $manager]), $users);
        $this->assertTrue($p->allows('alice'));
        $state['alice'] = false;
        $this->assertTrue($p->allows('alice'), 'kept for the request');
        $p->reset('bob');
        $this->assertTrue($p->allows('alice'));
        $p->reset('alice');
        $this->assertFalse($p->allows('alice'));
        $this->assertTrue($p->ownerHidden('alice'));
        $state['alice'] = true;
        $p->reset();
        $this->assertTrue($p->allows('alice'));
        $this->assertFalse($p->ownerHidden('alice'));
    }

    // ── Access (AK2, AK3) ──────────────────────────────────────────────────

    public function testNobodyButTheOwnerReachesTheBoardAndAllComesBack(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 4, 1, 1);
        $token = $this->h->link($b);
        $this->h->boards->addMember($b, 'bob', 'edit', $this->h->boards->activeLinkOf($b)['id'], 0);
        $this->h->shareRows->add($b, 'user', 'carol', 'moderate');
        $guest = $this->h->token($b, 1);
        foreach (['bob', 'carol'] as $uid) {
            $this->h->uid = $uid;
            $this->assertNotNull($this->h->access->forUser($b)->principal);
        }
        $this->h->disabledUsers = ['alice'];
        $this->h->mem->data = [];

        foreach (['bob', 'carol'] as $uid) {
            $this->h->uid = $uid;
            $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
            $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUserWithRow($b));
        }
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->forGuestWithRow($guest, $b));
        $this->assertFalse($this->h->cache->getGens($b)['links']);
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->forGuest($guest, $b), 'fast path');
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->joinGuest($token, 'Gina', null, '10.0.0.9'));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->joinGuest($token, 'Gina', $guest, '10.0.0.9'));
        $this->assertSame([], $this->h->service->listFor('bob'));
        $this->assertSame([], $this->h->service->listFor('carol'));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->service->joinLinkAsUser('dave', $token));

        // Nextcloud's setting off: the shares count again (links too).
        $this->h->hideDisabled = false;
        $this->h->mem->data = [];
        $this->h->uid = 'carol';
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role);
        $this->h->hideDisabled = true;

        // Enabled again: nothing was revoked.
        $this->h->disabledUsers = [];
        $this->h->mem->data = [];
        $this->assertSame(Role::Edit, $this->h->access->forGuest($guest, $b)->principal->role, 'the old guest token works again');
        $this->h->uid = 'bob';
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role);
        $this->assertSame([$b], array_column($this->h->service->listFor('carol'), 'id'));
    }

    public function testTheBumpClosesTheFastPathAtOnce(): void {
        $b = $this->h->boards->addBoard('alice', 'B', 4, 1, 1);
        $this->h->link($b);
        $this->h->shareRows->add($b, 'user', 'carol', 'edit');
        $guest = $this->h->token($b, 1);
        $this->h->uid = 'carol';
        $this->h->access->forUser($b);
        $this->h->access->forGuest($guest, $b);
        // Disabled: the cached grant and gens would still let both in …
        $this->h->disabledUsers = ['alice'];
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role, 'without the listener: cached up to 120 s');
        // … until the listener's bump (acl_gen + 1, links = 0).
        $this->h->shares->bumpBoards([$b]);
        $this->expectHttp(404, 'not_found', fn () => $this->h->access->forUser($b));
        $this->expectHttp(403, 'links_disabled', fn () => $this->h->access->forGuest($guest, $b));
        $this->assertSame(1, $this->h->boards->boards[$b]['link_gen'], 'no link generation raised');
        // Enabled again, bumped again: links = 1 at once, old guest token valid.
        $this->h->disabledUsers = [];
        $this->h->shares->bumpBoards([$b]);
        $this->assertTrue($this->h->cache->getGens($b)['links']);
        $this->assertSame(Role::Edit, $this->h->access->forGuest($guest, $b)->principal->role);
        $this->assertSame(Role::Edit, $this->h->access->forUser($b)->principal->role);
    }

    // ── Listener (AK5) ─────────────────────────────────────────────────────

    /** @param list<string> $gets */
    private function listener(array &$gets, array &$bumped, ?\Throwable $fail = null, array &$warnings = []): UserEnabledListener {
        $policy = $this->h->policy;
        $boards = new class extends BoardStore {
            public function __construct() {
            }

            public function boardsOwnedBy(string $uid): array {
                return $uid === 'alice' ? [3, 7] : [];
            }
        };
        $shares = new class($bumped, $fail) extends ShareService {
            public function __construct(private array &$bumped, private ?\Throwable $fail) {
            }

            public function bumpBoards(array $boardIds): void {
                if ($this->fail !== null) {
                    throw $this->fail;
                }
                $this->bumped[] = $boardIds;
            }
        };
        $container = Fake::of(ContainerInterface::class, ['get' => function (string $id) use (&$gets, $policy, $boards, $shares): mixed {
            $gets[] = $id;
            return match ($id) {
                LinkPolicy::class => $policy,
                BoardStore::class => $boards,
                ShareService::class => $shares,
            };
        }]);
        $logger = Fake::of(LoggerInterface::class, ['warning' => function ($m, array $c = []) use (&$warnings): void {
            $warnings[] = (string)$m;
        }]);
        return new UserEnabledListener($container, $logger);
    }

    public function testListenerBumpsTheOwnersBoardsOnEnabledOnly(): void {
        $gets = [];
        $bumped = [];
        $alice = $this->h->user('alice');
        $l = $this->listener($gets, $bumped);
        $l->handle(new UserChangedEvent($alice, 'displayName', 'A', 'B'));
        $l->handle(new UserChangedEvent($alice, 'eMailAddress', 'a@x', null));
        $l->handle(new Event());
        $this->assertSame([[], []], [$gets, $bumped], 'any other field: nothing built, nothing read');

        $l->handle(new UserChangedEvent($alice, 'enabled', false, true));
        $l->handle(new UserChangedEvent($alice, 'enabled', true, false));
        $this->assertSame([[3, 7], [3, 7]], $bumped, 'disabling and enabling bump the owned boards');
        $l->handle(new UserChangedEvent($this->h->user('bob'), 'enabled', false, true));
        $this->assertSame([[3, 7], [3, 7]], $bumped, 'no boards: no bump');
    }

    public function testListenerNeverThrows(): void {
        $gets = [];
        $bumped = [];
        $warnings = [];
        $l = $this->listener($gets, $bumped, new \RuntimeException('db down'), $warnings);
        $l->handle(new UserChangedEvent($this->h->user('alice'), 'enabled', false, true));
        $this->assertCount(1, $warnings);
    }
}
