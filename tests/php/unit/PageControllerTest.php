<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\PrivacyNotice;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IRequest;
use OCP\L10N\IFactory;
use PHPUnit\Framework\TestCase;

/**
 * Initial state of every page (SPEC-M0 §6.6; SPEC-M1 §4.11.3: 10 keys with
 * linkInfo; §4.8: limits with maxItems/maxLabel; M2 privacy notice: 12 keys
 * with privacy and privacyAdmin).
 */
final class PageControllerTest extends TestCase {
    /** Limits over an app config with the given int values (unset = default). */
    public static function limits(array $app = []): Limits {
        return new Limits(Fake::of(IAppConfig::class, [
            'getValueInt' => fn (string $a, string $k, int $d = 0, ?bool $lazy = false): int => $app[$k] ?? $d,
        ]));
    }

    private static function config(bool $dev): IConfig {
        return Fake::of(IConfig::class, ['getSystemValueBool' => fn (string $k, bool $d = false): bool => $k === 'knorke_dev' ? $dev : $d]);
    }

    public function testAllKeysOnEveryPage(): void {
        foreach ([[], ['boardId' => 7], ['joinToken' => str_repeat('a', 24)], ['page' => 'public', 'linkToken' => str_repeat('b', 24), 'linkState' => 'revoked', 'boardId' => null]] as $values) {
            $s = PageController::initialStateFor(self::config(true), self::limits(), $values);
            $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($s));
            foreach ($values as $k => $v) {
                $this->assertSame($v, $s[$k]);
            }
        }
        $s = PageController::initialStateFor(self::config(false), self::limits(), ['boardId' => 7]);
        $this->assertSame(['user', 7, null, null, null, false, 2, null], [$s['page'], $s['boardId'], $s['joinToken'], $s['linkToken'], $s['linkState'], $s['debug'], $s['protocol'], $s['linkInfo']]);
        $this->assertSame(['maxText' => 6000, 'maxTitle' => 200, 'maxOps' => 200, 'nameMax' => 40, 'maxItemBytes' => 65536, 'maxItems' => 5000, 'maxLabel' => 200], $s['limits']);
        $this->expectException(\InvalidArgumentException::class);
        PageController::initialStateFor(self::config(false), self::limits(), ['linkValid' => true]);
    }

    public function testLimitsReadTheOverriddenItemLimit(): void {
        // SPEC-M1 §4.8 (R2): forClient() is an instance method; maxItems is the
        // effective MAX_ITEMS_PER_BOARD (app config max_items_per_board).
        $s = PageController::initialStateFor(self::config(false), self::limits(['max_items_per_board' => 1234]), []);
        $this->assertSame(1234, $s['limits']['maxItems']);
        $this->assertSame(200, $s['limits']['maxLabel']);
        foreach ([0, -5] as $bad) {
            $this->assertSame(5000, PageController::initialStateFor(self::config(false), self::limits(['max_items_per_board' => $bad]), [])['limits']['maxItems'], "override $bad keeps the default");
        }
    }

    public function testTwelveKeysWithPrivacyLast(): void {
        $this->assertSame(['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal', 'linkInfo', 'privacy', 'privacyAdmin'], PageController::INITIAL_STATE_KEYS);
        $s = PageController::initialStateFor(self::config(false), self::limits(), ['page' => 'admin', 'privacyAdmin' => ['textMax' => 2000]]);
        $this->assertSame(['admin', null, ['textMax' => 2000]], [$s['page'], $s['privacy'], $s['privacyAdmin']], 'admin page: privacy null');
        $s = PageController::initialStateFor(self::config(false), self::limits(), ['boardId' => 3, 'privacy' => ['text' => null, 'url' => '']]);
        $this->assertSame([['text' => null, 'url' => ''], null], [$s['privacy'], $s['privacyAdmin']], 'other pages: privacyAdmin null');
        // linkInfo: null on every page until stage 2; a page may set it (public page, linkState ok).
        $info = ['role' => 'vote', 'password' => true];
        $s = PageController::initialStateFor(self::config(false), self::limits(), ['page' => 'public', 'linkState' => 'ok', 'linkInfo' => $info]);
        $this->assertSame($info, $s['linkInfo']);
        foreach ([[], ['boardId' => 3], ['page' => 'public', 'linkState' => 'expired']] as $values) {
            $this->assertNull(PageController::initialStateFor(self::config(false), self::limits(), $values)['linkInfo']);
        }
    }

    public function testNullSurvivesInitialStateService(): void {
        $got = [];
        $state = Fake::of(IInitialState::class, ['provideInitialState' => function (string $key, $data) use (&$got): void {
            // Same acceptance rule as OC\InitialStateService (NC 34/35): a plain null is dropped.
            if (is_scalar($data) || is_array($data) || $data instanceof \JsonSerializable) {
                $got[$key] = json_encode($data);
            }
        }]);
        PageController::provideState($state, PageController::initialStateFor(self::config(false), self::limits(), ['page' => 'public', 'linkState' => 'invalid']));
        $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($got));
        $this->assertSame(['"public"', 'null', '"invalid"', 'false', 'null'], [$got['page'], $got['boardId'], $got['linkState'], $got['debug'], $got['linkInfo']]);
    }

    /**
     * A PrivacyNotice over a stored setting and a mocked findLanguage()
     * (M2 privacy notice, AK6).
     *
     * @param list<?string> $asked app ids findLanguage() was asked with
     */
    public static function privacy(string $lang, array $stored, string $theming = '', array &$asked = []): PrivacyNotice {
        $appConfig = Fake::of(IAppConfig::class, ['getValueString' => fn (string $app, string $key, string $default = '', bool $lazy = false): string => match ("$app/$key") {
            'knorke/privacy_notice' => $stored === [] ? '' : PrivacyNotice::encode($stored),
            'theming/privacyUrl' => $theming,
            default => $default,
        }]);
        return new PrivacyNotice($appConfig, Fake::of(IFactory::class, ['findLanguage' => function (?string $appId = null) use ($lang, &$asked): string {
            $asked[] = $appId;
            return $lang;
        }]));
    }

    public function testRoutes1To3CarryPrivacyInTheAccountsLanguage(): void {
        $stored = ['default' => ['text' => "T0\nline 2", 'url' => ''], 'languages' => ['de' => ['text' => 'Tde', 'url' => 'https://example.org/ude']]];
        foreach ([['de', 'Tde', 'https://example.org/ude'], ['de_DE', 'Tde', 'https://example.org/ude'], ['fr', "T0\nline 2", 'https://example.org/theming']] as [$lang, $text, $url]) {
            $asked = [];
            $got = [];
            $state = Fake::of(IInitialState::class, ['provideInitialState' => function (string $key, $data) use (&$got): void {
                $got[$key] = json_encode($data);
            }]);
            $c = new PageController(Fake::of(IRequest::class), $state, self::config(false), self::limits(), self::privacy($lang, $stored, 'https://example.org/theming', $asked));
            foreach (['index' => [], 'board' => [7], 'join' => [str_repeat('a', 24)]] as $route => $args) {
                $got = [];
                $r = $c->$route(...$args);
                $this->assertInstanceOf(TemplateResponse::class, $r);
                $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($got), "$route: every key");
                $this->assertSame(['text' => $text, 'url' => $url], json_decode($got['privacy'], true), "$lang $route: privacy");
                $this->assertSame(['null', 'null', '"user"'], [$got['privacyAdmin'], $got['legal'], $got['page']], "$route: no admin data, legal stays null");
            }
            $this->assertSame([null, null, null], $asked, 'IFactory::findLanguage() without an app id, once per page');
        }
        $c = new PageController(Fake::of(IRequest::class), Fake::of(IInitialState::class, ['provideInitialState' => function (string $key, $data) use (&$got): void {
            $got[$key] = json_encode($data);
        }]), self::config(false), self::limits(), self::privacy('de', []));
        $got = [];
        $c->index();
        $this->assertSame('{"text":null,"url":""}', $got['privacy'], 'nothing set: text null (built-in text), url ""');
    }
}
