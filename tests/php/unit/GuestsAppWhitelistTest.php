<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Search\BoardSearchProvider;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeGuestsWhitelist;
use OCP\IUser;
use PHPUnit\Framework\Attributes\DataProviderExternal;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;

/**
 * The one check of jobs 030 and 055 (search, provider list, bell): an
 * account of the Guests app (backend "Guests") may use Knorke only while
 * that app's AppWhitelist::isUrlAllowed() answers a strict true for
 * /apps/knorke/; every other account passes without the container. A
 * missing class or any error is false without a log, a failed get() is not
 * kept, a found whitelist is, an answer never. Knorke names the Guests
 * class by a string only.
 */
final class GuestsAppWhitelistTest extends TestCase {
    /** @var list<string> every container get()/has() of the helper */
    private array $gets = [];
    /**
     * What the container hands out for GuestsAppWhitelist::WHITELIST; null:
     * NotFoundExceptionInterface, as without the Guests app.
     */
    private ?object $guests = null;

    private function helper(): GuestsAppWhitelist {
        $container = Fake::of(ContainerInterface::class, [
            'get' => function (string $id): mixed {
                $this->gets[] = $id;
                return match ($id) {
                    GuestsAppWhitelist::WHITELIST => $this->guests ?? throw new class('no ' . $id) extends \RuntimeException implements NotFoundExceptionInterface {
                    },
                    default => throw new \LogicException('helper container: ' . $id),
                };
            },
            'has' => function (string $id): bool {
                $this->gets[] = 'has ' . $id;
                return true;
            },
        ]);
        return new GuestsAppWhitelist($container);
    }

    /** An account with the backend name $backend; null: the fake's neutral value (null on NC 34, '' on NC 35). */
    private static function account(string $uid, ?string $backend): IUser {
        $methods = ['getUID' => fn (): string => $uid];
        if ($backend !== null) {
            $methods['getBackendClassName'] = fn (): string => $backend;
        }
        return Fake::of(IUser::class, $methods);
    }

    /** "Gast": an account of the Guests app. */
    private static function gast(): IUser {
        return self::account('gast', 'Guests');
    }

    /** The source without comments, tokenized as in BoardSearchProviderTest::code(). */
    private static function code(string $src): string {
        $code = '';
        foreach (token_get_all($src) as $t) {
            if (!is_array($t) || ($t[0] !== T_COMMENT && $t[0] !== T_DOC_COMMENT)) {
                $code .= is_array($t) ? $t[1] : $t;
            }
        }
        return $code;
    }

    // ── AK1: other accounts never ask ──────────────────────────────────────

    public function testOtherAccountsPassWithoutAsking(): void {
        $this->guests = new FakeGuestsWhitelist(false);
        $helper = $this->helper();
        $this->assertSame([], $this->gets, 'the constructor touches nothing');
        $neutral = self::account('alice', null);
        $this->assertContains($neutral->getBackendClassName(), [null, ''], 'precondition: the fake has no backend name');
        $accounts = [
            'fake default (null or \'\')' => $neutral,
            "''" => self::account('alice', ''),
            'Database' => self::account('alice', 'Database'),
            'guests' => self::account('alice', 'guests'),
            'OCA\Guests\UserBackend' => self::account('alice', 'OCA\Guests\UserBackend'),
        ];
        foreach ($accounts as $label => $user) {
            $this->assertTrue($helper->allows($user), $label);
            $this->assertSame([], $this->gets, "$label: no container access");
            $this->assertSame([], $this->guests->calls, $label);
        }
    }

    // ── AK2: a guest is asked, only a strict true lets it in ───────────────

    public function testAGuestIsAskedForTheFixedPath(): void {
        $this->guests = new FakeGuestsWhitelist(true);
        $this->assertTrue($this->helper()->allows(self::gast()));
        $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
        $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets);

        $this->gets = [];
        $this->guests = new FakeGuestsWhitelist(false);
        $this->assertFalse($this->helper()->allows(self::gast()));
        $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
        $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets);
    }

    #[DataProviderExternal(BoardSearchProviderTest::class, 'guestsFailures')]
    public function testAGuestFailsClosed(string $kind, mixed $answer): void {
        $this->guests = FakeGuestsWhitelist::failing($kind, $answer);
        $this->assertFalse($this->helper()->allows(self::gast()));
        $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets, 'nothing else fetched: no logger');
        if ($this->guests instanceof FakeGuestsWhitelist) {
            $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
        }
    }

    public function testTheWhitelistIsKeptTheAnswerIsNot(): void {
        $this->guests = new FakeGuestsWhitelist(true);
        $helper = $this->helper();
        $this->assertTrue($helper->allows(self::gast()));
        $this->assertTrue($helper->allows(self::gast()));
        $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets, 'fetched once');
        $this->assertCount(2, $this->guests->calls, 'asked twice');

        $this->guests->answer = false;
        $this->assertFalse($helper->allows(self::gast()), 'a changed whitelist counts at the next call');
        $this->assertCount(3, $this->guests->calls);
        $this->assertSame([GuestsAppWhitelist::WHITELIST], $this->gets);
    }

    public function testAFailedLookupIsNotKept(): void {
        $helper = $this->helper();
        $this->assertFalse($helper->allows(self::gast()), 'without the Guests app');
        $this->guests = new FakeGuestsWhitelist(true);
        $this->assertTrue($helper->allows(self::gast()));
        $this->assertSame([GuestsAppWhitelist::WHITELIST, GuestsAppWhitelist::WHITELIST], $this->gets, 'get() again');
        $this->assertSame([['gast', '/apps/knorke/']], $this->guests->calls);
    }

    // ── AK3: no dependency on the Guests app ───────────────────────────────

    public function testNoDependencyOnTheGuestsApp(): void {
        $this->assertSame('OCA\\Guests\\AppWhitelist', GuestsAppWhitelist::WHITELIST);
        $this->assertSame('Guests', GuestsAppWhitelist::BACKEND);
        $this->assertSame(GuestsAppWhitelist::WHITELIST, BoardSearchProvider::GUESTS_WHITELIST);
        $this->assertSame(GuestsAppWhitelist::BACKEND, BoardSearchProvider::GUESTS_BACKEND);

        $root = dirname(__DIR__, 3);
        $helper = self::code((string)file_get_contents($root . '/lib/Service/GuestsAppWhitelist.php'));
        $this->assertStringContainsString('->isUrlAllowed(', $helper);
        $this->assertStringContainsString('->getBackendClassName()', $helper);
        foreach (['lib/Search/BoardSearchProvider.php', 'lib/Notification/Notifier.php'] as $path) {
            $this->assertStringNotContainsString('->isUrlAllowed(', self::code((string)file_get_contents($root . '/' . $path)), "$path: only through the helper");
        }

        $files = 0;
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root . '/lib', \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->getExtension() !== 'php') {
                continue;
            }
            $files++;
            $code = self::code((string)file_get_contents($f->getPathname()));
            $this->assertStringNotContainsString('use OCA\Guests', $code, $f->getPathname());
            $this->assertStringNotContainsString('Guests\AppWhitelist::class', $code, $f->getPathname());
        }
        $this->assertGreaterThan(50, $files, 'precondition: lib/ was read');
        $this->assertFalse(class_exists('OCA\\Guests\\AppWhitelist', false), 'these cases run without the Guests app');
    }
}
