<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\PrivacyNotice;
use OCA\Knorke\Tests\Support\Fake;
use OCP\IAppConfig;
use OCP\L10N\IFactory;
use PHPUnit\Framework\TestCase;

/**
 * The admin setting of the privacy notice (M2, spec §2–§4): checks and
 * cleaning on write (AK3), the URL filter on write and read (AK4), the
 * fallback chain of resolve() (AK5), the stored form (lazy, ASCII JSON,
 * languages always an object).
 */
final class PrivacyNoticeTest extends TestCase {
    /** @var array<string, string> app config app/key → value */
    private array $config = [];
    /** @var list<string> calls on the app config (set/delete with lazy flag) */
    private array $writes = [];
    private ?\Throwable $readFails = null;

    private const LANGUAGES = [
        'commonLanguages' => [0 => ['code' => 'de', 'name' => 'Deutsch (Persönlich: Du)'], 3 => ['code' => 'en', 'name' => 'English (US)']],
        'otherLanguages' => [['code' => 'de_DE', 'name' => 'Deutsch (Förmlich: Sie)'], ['code' => 'fr', 'name' => 'Français'],
            ['code' => 'pt_BR', 'name' => 'Português Brasileiro'], ['code' => 'nolabel']],
    ];

    private function appConfig(): IAppConfig {
        return Fake::of(IAppConfig::class, [
            'getValueString' => function (string $app, string $key, string $default = '', bool $lazy = false): string {
                if ($app === 'knorke' && $key === PrivacyNotice::KEY) {
                    if ($this->readFails !== null) {
                        throw $this->readFails;
                    }
                    $this->assertTrue($lazy, 'privacy_notice is read lazy');
                }
                return $this->config["$app/$key"] ?? $default;
            },
            'setValueString' => function (string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
                $this->writes[] = "set $app/$key " . ($lazy ? 'lazy' : 'eager');
                $this->config["$app/$key"] = $value;
                return true;
            },
            'deleteKey' => function (string $app, string $key): void {
                $this->writes[] = "delete $app/$key";
                unset($this->config["$app/$key"]);
            },
        ]);
    }

    private function notice(string $lang = 'en', array $languages = self::LANGUAGES): PrivacyNotice {
        return new PrivacyNotice($this->appConfig(), Fake::of(IFactory::class, [
            'getLanguages' => fn (): array => $languages,
            'findLanguage' => fn (?string $appId = null): string => $lang,
        ]));
    }

    /** The HttpError of a save, or null when it went through. */
    private function error(array $body): ?HttpError {
        try {
            $this->notice()->save($body);
            return null;
        } catch (HttpError $e) {
            return $e;
        }
    }

    private function assertError(array $body, string $code, array $extra, string $label): void {
        $before = $this->writes;
        $e = $this->error($body);
        $this->assertNotNull($e, "$label: refused");
        $this->assertSame([400, $code], [$e->status, $e->error], $label);
        $this->assertSame($extra, $e->extra, "$label: extra fields");
        $this->assertSame($before, $this->writes, "$label: nothing written");
    }

    public function testLimits(): void {
        $this->assertSame([2000, 20, 'privacy_notice'], [PrivacyNotice::TEXT_MAX, PrivacyNotice::LANGUAGES_MAX, PrivacyNotice::KEY]);
    }

    public function testCleaningAndNormalisedForm(): void {
        $s = $this->notice()->save(['default' => ['text' => "a\r\nb\x07 ", 'url' => null], 'languages' => [
            'fr' => ['text' => "  Bonjour\n", 'url' => '  https://example.org/fr  '],
            'de' => ['text' => 'Hallo'],
            'en' => ['text' => '', 'url' => ''],
            'pt_BR' => ['text' => null, 'url' => null],
        ]]);
        $this->assertSame(['text' => "a\nb", 'url' => ''], $s['default'], 'CRLF → LF, control characters removed, trimmed');
        $this->assertSame(['de', 'fr'], array_keys($s['languages']), 'empty entries dropped, sorted by code');
        $this->assertSame(['text' => 'Bonjour', 'url' => 'https://example.org/fr'], $s['languages']['fr'], 'text and URL trimmed');
        $this->assertSame(['text' => 'Hallo', 'url' => ''], $s['languages']['de']);
        $this->assertSame(['set knorke/privacy_notice lazy'], $this->writes, 'stored lazy');
        $stored = $this->config['knorke/privacy_notice'];
        $this->assertSame('{"default":{"text":"a\nb","url":""},"languages":{"de":{"text":"Hallo","url":""},"fr":{"text":"Bonjour","url":"https:\/\/example.org\/fr"}}}', $stored);
        $this->assertSame($s, $this->notice()->read(), 'read gives back what was stored');
    }

    public function testEmptyLanguagesEncodeAsObject(): void {
        $s = $this->notice()->save(['default' => ['text' => 'T0']]);
        $this->assertSame([], $s['languages']);
        $this->assertSame('{"default":{"text":"T0","url":""},"languages":{}}', $this->config['knorke/privacy_notice']);
        $this->assertSame('{"default":{"text":"T0","url":""},"languages":{}}', json_encode(PrivacyNotice::wire($s)), 'answer and initial state: {} never []');
        $s = $this->notice()->save(['default' => ['text' => 'T1'], 'languages' => ['de' => ['text' => '', 'url' => '']]]);
        $this->assertSame('{"default":{"text":"T1","url":""},"languages":{}}', json_encode(PrivacyNotice::wire($s)), 'only empty entries → {}');
    }

    public function testEmptySettingDeletesTheKey(): void {
        $this->notice()->save(['default' => ['text' => 'T0']]);
        $this->writes = [];
        $s = $this->notice()->save([]);
        $this->assertSame(PrivacyNotice::blank(), $s);
        $this->assertSame(['delete knorke/privacy_notice'], $this->writes, 'PUT {} removes the key (nothing stored)');
        $this->assertArrayNotHasKey('knorke/privacy_notice', $this->config);
        $this->notice()->save(['languages' => []]);
        $this->assertSame(['delete knorke/privacy_notice', 'delete knorke/privacy_notice'], $this->writes, 'an empty [] counts as empty');
    }

    public function testTextLengthInCodePoints(): void {
        $emoji = "\u{1F600}";
        $s = $this->notice()->save(['default' => ['text' => str_repeat($emoji, 2000)]]);
        $this->assertSame(2000, mb_strlen($s['default']['text'], 'UTF-8'), 'exactly 2000 code points (an emoji counts as one) → ok');
        $this->assertDoesNotMatchRegularExpression('/[\x80-\xFF]/', $this->config['knorke/privacy_notice'], 'stored value is pure ASCII (no byte ≥ 0x80)');
        $this->assertStringContainsString(trim(json_encode($emoji), '"'), $this->config['knorke/privacy_notice'], 'emoji as \\u escapes');
        $this->assertSame(str_repeat($emoji, 2000), $this->notice()->read()['default']['text'], 'read back unchanged');
        $this->assertError(['default' => ['text' => str_repeat($emoji, 2001)]], 'text_too_long', ['at' => 'default', 'max' => 2000], '2001 code points');
        $this->assertError(['languages' => ['de' => ['text' => str_repeat('x', 2001)]]], 'text_too_long', ['at' => 'de', 'max' => 2000], 'language text too long');
        $this->assertNull($this->error(['default' => ['text' => str_repeat('x', 2000) . "  \n"]]), 'white space trimmed before the count');
    }

    public function testShapeErrors(): void {
        $this->assertError(['default' => ['text' => 5]], 'bad_request', ['at' => 'default'], 'text not a string');
        $this->assertError(['default' => ['text' => ['x']]], 'bad_request', ['at' => 'default'], 'text a list');
        $this->assertError(['default' => ['url' => true]], 'bad_request', ['at' => 'default'], 'url not a string');
        $this->assertError(['default' => ['text' => 'x', 'html' => 'y']], 'bad_request', ['at' => 'default'], 'unknown key in the entry');
        $this->assertError(['default' => 'x'], 'bad_request', ['at' => 'default'], 'entry not an object');
        $this->assertError(['default' => null], 'bad_request', ['at' => 'default'], 'entry null');
        $this->assertError(['default' => ['a', 'b']], 'bad_request', ['at' => 'default'], 'entry a list');
        $this->assertError(['languages' => ['de' => 7]], 'bad_request', ['at' => 'de'], 'language entry not an object');
        $this->assertError(['languages' => ['de' => ['text' => 'x', 'link' => 'y']]], 'bad_request', ['at' => 'de'], 'unknown key in a language entry');
        $this->assertError(['languages' => 'de'], 'bad_request', [], 'languages not an object');
        $this->assertError(['languages' => [['text' => 'x']]], 'bad_request', [], 'languages a list');
        $this->assertNull($this->error(['default' => [], 'languages' => []]), 'empty objects are fine');
    }

    public function testFirstErrorWins(): void {
        $this->assertError(['default' => ['url' => 'javascript:x'], 'languages' => ['xx' => ['text' => 'a']]], 'invalid_url', ['at' => 'default'], 'default before languages');
        $this->assertError(['languages' => ['fr' => ['url' => 'ftp://x'], 'de' => ['text' => 5]]], 'invalid_url', ['at' => 'fr'], 'languages in the order sent');
        $this->assertError(['languages' => ['de' => ['text' => 5], 'fr' => ['url' => 'ftp://x']]], 'bad_request', ['at' => 'de'], 'languages in the order sent (2)');
    }

    public function testUnknownLanguage(): void {
        $this->assertError(['languages' => ['xx' => ['text' => 'a']]], 'unknown_language', ['at' => 'xx'], 'not a Nextcloud language');
        $this->assertError(['languages' => ['de' => ['text' => 'a'], 'de_AT' => ['text' => 'b']]], 'unknown_language', ['at' => 'de_AT'], 'only codes of getLanguages()');
        $this->assertNull($this->error(['languages' => ['nolabel' => ['text' => 'a'], 'pt_BR' => ['text' => 'b']]]), 'common and other languages');
    }

    public function testTooManyLanguages(): void {
        $codes = [];
        for ($i = 0; $i < 21; $i++) {
            $codes[] = ['code' => 'l' . $i, 'name' => 'L' . $i];
        }
        $languages = ['commonLanguages' => [], 'otherLanguages' => $codes];
        $body = [];
        foreach ($codes as $c) {
            $body[$c['code']] = ['text' => 'T ' . $c['code']];
        }
        try {
            $this->notice('en', $languages)->save(['languages' => $body]);
            $this->fail('21 languages saved');
        } catch (HttpError $e) {
            $this->assertSame([400, 'too_many_languages', ['max' => 20]], [$e->status, $e->error, $e->extra]);
        }
        $this->assertSame([], $this->writes);
        $body['l20'] = ['text' => '', 'url' => ''];
        $s = $this->notice('en', $languages)->save(['languages' => $body]);
        $this->assertCount(20, $s['languages'], '20 non-empty entries plus an empty one are fine (empty ones are dropped first)');
    }

    public function testUrlFilterOnWrite(): void {
        $bad = ['javascript:alert(1)', 'data:text/html,x', '/relativ', 'relativ/x', '//example.org/x', 'mailto:a@example.org', 'ftp://example.org/x',
            'https://#x', 'https://exa mple.org/x', 'https://example.org/' . str_repeat('x', 2048)];
        foreach ($bad as $url) {
            $this->assertError(['default' => ['url' => $url]], 'invalid_url', ['at' => 'default'], var_export(substr($url, 0, 40), true));
            $this->assertError(['languages' => ['fr' => ['url' => $url]]], 'invalid_url', ['at' => 'fr'], 'fr ' . var_export(substr($url, 0, 40), true));
        }
        $s = $this->notice()->save(['default' => ['url' => 'http://example.org/datenschutz/x?y=1#z'], 'languages' => ['de' => ['url' => '  https://example.org/de  ']]]);
        $this->assertSame('http://example.org/datenschutz/x?y=1#z', $s['default']['url']);
        $this->assertSame('https://example.org/de', $s['languages']['de']['url'], 'trimmed');
    }

    public function testReadFiltersAgain(): void {
        $this->config['knorke/privacy_notice'] = json_encode([
            'default' => ['text' => "  x\r\ny\x01  " . str_repeat('z', 2500), 'url' => 'javascript:alert(1)'],
            'languages' => ['de' => ['text' => 'Hallo', 'url' => '//evil.example/x'], 'fr' => ['text' => '', 'url' => 'data:x'], 'en' => ['text' => 'Hi', 'url' => ' https://example.org/en ']],
        ]);
        $s = $this->notice()->read();
        $this->assertSame(2000, mb_strlen($s['default']['text']), 'cut to TEXT_MAX');
        $this->assertStringStartsWith("x\ny  zz", $s['default']['text'], 'cleaned like on write');
        $this->assertSame('', $s['default']['url'], 'a hand-set javascript: URL becomes ""');
        $this->assertSame(['text' => 'Hallo', 'url' => ''], $s['languages']['de']);
        $this->assertSame(['de', 'en'], array_keys($s['languages']), 'an entry left empty by the filter is dropped');
        $this->assertSame('https://example.org/en', $s['languages']['en']['url']);
    }

    public function testUnreadableValueIsNothing(): void {
        foreach (['{broken', '"text"', '[1,2]', '{"default":"x"}', '{"default":{"text":5}}', '{"languages":"de"}', '{"languages":{"de":{"text":[1]}}}', '{"languages":[{"text":"x"}]}'] as $raw) {
            $this->config['knorke/privacy_notice'] = $raw;
            $this->assertSame(PrivacyNotice::blank(), $this->notice()->read(), $raw);
        }
        $this->readFails = new \RuntimeException('type conflict');
        $this->assertSame(PrivacyNotice::blank(), $this->notice()->read(), 'an exception counts as nothing stored');
        $this->assertSame(['text' => null, 'url' => ''], $this->notice()->resolve('de'));
    }

    /** @return array<string, array{0: string, 1: array, 2: array{text: ?string, url: string}, 3?: string}> */
    public static function chain(): array {
        $full = [
            'default' => ['text' => 'T0', 'url' => 'https://example.org/u0'],
            'languages' => [
                'de' => ['text' => 'Tde', 'url' => 'https://example.org/ude'],
                'de_DE' => ['text' => 'TdeDE', 'url' => 'https://example.org/udeDE'],
                'pt' => ['text' => '', 'url' => 'https://example.org/upt'],
            ],
        ];
        $onlyBase = ['default' => $full['default'], 'languages' => ['de' => $full['languages']['de']]];
        $onlyRegion = ['default' => $full['default'], 'languages' => ['de_DE' => $full['languages']['de_DE']]];
        return [
            'de_DE with its own entry' => ['de_DE', $full, ['text' => 'TdeDE', 'url' => 'https://example.org/udeDE']],
            'de_DE without, with de' => ['de_DE', $onlyBase, ['text' => 'Tde', 'url' => 'https://example.org/ude']],
            'de with only de_DE → default' => ['de', $onlyRegion, ['text' => 'T0', 'url' => 'https://example.org/u0']],
            'fr → default' => ['fr', $full, ['text' => 'T0', 'url' => 'https://example.org/u0']],
            'fr without default text → null' => ['fr', ['default' => ['text' => '', 'url' => 'https://example.org/u0'], 'languages' => []], ['text' => null, 'url' => 'https://example.org/u0']],
            'URL only: text from the default' => ['pt', $full, ['text' => 'T0', 'url' => 'https://example.org/upt']],
            'pt_BR: URL from pt, text from the default' => ['pt_BR', $full, ['text' => 'T0', 'url' => 'https://example.org/upt']],
            'nothing stored: theming privacyUrl' => ['de', PrivacyNoticeTest::blankForm(), ['text' => null, 'url' => 'https://example.org/theming']],
            'theming invalid → ""' => ['de', PrivacyNoticeTest::blankForm(), ['text' => null, 'url' => ''], 'javascript:alert(1)'],
            'text only: URL from theming' => ['de', ['default' => ['text' => 'T0', 'url' => ''], 'languages' => ['de' => ['text' => 'Tde', 'url' => '']]], ['text' => 'Tde', 'url' => 'https://example.org/theming']],
        ];
    }

    public static function blankForm(): array {
        return ['default' => ['text' => '', 'url' => ''], 'languages' => []];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('chain')]
    public function testResolveFallbackChain(string $lang, array $stored, array $want, string $theming = 'https://example.org/theming'): void {
        $this->config['theming/privacyUrl'] = $theming;
        if ($stored !== self::blankForm()) {
            $this->config['knorke/privacy_notice'] = PrivacyNotice::encode($stored);
        }
        $this->assertSame($want, $this->notice()->resolve($lang));
    }

    public function testResolveBrokenJsonIsEmpty(): void {
        $this->config['knorke/privacy_notice'] = '{"default":';
        $this->config['theming/privacyUrl'] = 'https://example.org/theming';
        $this->assertSame(['text' => null, 'url' => 'https://example.org/theming'], $this->notice()->resolve('de_DE'));
    }

    public function testForPageUsesNextcloudsLanguage(): void {
        $this->config['knorke/privacy_notice'] = PrivacyNotice::encode(['default' => ['text' => 'T0', 'url' => ''], 'languages' => ['de' => ['text' => 'Tde', 'url' => 'https://example.org/ude']]]);
        $asked = [];
        $n = new PrivacyNotice($this->appConfig(), Fake::of(IFactory::class, ['findLanguage' => function (?string $appId = null) use (&$asked): string {
            $asked[] = $appId;
            return 'de_DE';
        }]));
        $this->assertSame(['text' => 'Tde', 'url' => 'https://example.org/ude'], $n->forPage());
        $this->assertSame([null], $asked, 'findLanguage() without an app id');
    }

    public function testAdminState(): void {
        $this->config['theming/privacyUrl'] = 'https://example.org/theming';
        $this->notice()->save(['default' => ['text' => 'T0'], 'languages' => ['de' => ['text' => 'Tde']]]);
        $a = $this->notice()->adminState();
        $this->assertSame(['settings', 'languages', 'themingUrl', 'textMax', 'languagesMax'], array_keys($a));
        $this->assertSame('{"default":{"text":"T0","url":""},"languages":{"de":{"text":"Tde","url":""}}}', json_encode($a['settings']));
        $this->assertSame(['de', 'en', 'de_DE', 'fr', 'pt_BR', 'nolabel'], array_column($a['languages'], 'code'), 'common first in Nextcloud\'s order, then the others');
        $this->assertSame('nolabel', $a['languages'][5]['name'], 'a language without a name shows its code');
        $this->assertSame(['https://example.org/theming', 2000, 20], [$a['themingUrl'], $a['textMax'], $a['languagesMax']]);
        $this->assertTrue(array_is_list($a['languages']));
    }
}
