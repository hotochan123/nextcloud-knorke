<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Controller\PublicPageController;
use OCA\Knorke\Http\GuestPageResponse;
use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\FakeBoardStore;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Security\Bruteforce\IThrottler;
use PHPUnit\Framework\TestCase;

/**
 * The guest page /p/{token} hides Nextcloud's footer, so it carries the
 * instance's legal links as initial state `legal` (SPEC-M0 §6.6, review
 * finding NC-4): theming's imprintUrl/privacyUrl, only http(s), else ''.
 */
final class PublicPageControllerTest extends TestCase {
    /** @var array<string, mixed> theming app config */
    private array $theming = [];
    /** @var array<string, string> provided initial state, JSON-encoded */
    private array $state = [];
    /** Language of findLanguage() and the stored privacy notice (M2). */
    private string $lang = 'en';
    private array $notice = [];
    /** Knorke app config public_template (null = not set). */
    private ?string $publicTemplate = null;

    private function appConfig(): IAppConfig {
        return Fake::of(IAppConfig::class, ['getValueString' => function (string $app, string $key, string $default = '', ?bool $lazy = false): string {
            if ($app === 'knorke' && $key === 'public_template' && $this->publicTemplate !== null) {
                return $this->publicTemplate;
            }
            if ($app === 'theming' && array_key_exists($key, $this->theming)) {
                $v = $this->theming[$key];
                if ($v instanceof \Throwable) {
                    throw $v;
                }
                return $v;
            }
            return $default;
        }]);
    }

    private function controller(FakeBoardStore $boards): PublicPageController {
        $state = Fake::of(IInitialState::class, ['provideInitialState' => function (string $key, $data): void {
            $this->state[$key] = json_encode($data);
        }]);
        return new PublicPageController(
            Fake::of(IRequest::class, ['getRemoteAddress' => fn (): string => '10.0.0.1']),
            Fake::of(IUserSession::class, ['isLoggedIn' => fn (): bool => false]),
            Fake::of(IURLGenerator::class),
            $boards,
            new LinkThrottle(Fake::of(IThrottler::class)),
            $state,
            Fake::of(IConfig::class),
            $this->appConfig(),
            PageControllerTest::limits(),
            Fake::of(ITimeFactory::class, ['now' => fn (): \DateTimeImmutable => new \DateTimeImmutable('@1760000000')]),
            PageControllerTest::privacy($this->lang, $this->notice, $this->theming['privacyUrl'] ?? ''),
        );
    }

    public function testHttpUrlOnly(): void {
        foreach (['https://example.org/impressum', 'http://example.org', 'HTTPS://Example.org/Datenschutz?x=1#y', 'https://bücher.example/impressum'] as $ok) {
            $this->assertSame($ok, PublicPageController::httpUrl($ok), $ok);
        }
        $this->assertSame('https://example.org/i', PublicPageController::httpUrl("  https://example.org/i\n"), 'trimmed');
        foreach (['', 'javascript:alert(1)', 'JaVaScRiPt://example.org/%0Aalert(1)', 'data:text/html,x', '//example.org/impressum', '/impressum',
            'example.org/impressum', 'https://', 'https:///impressum', 'ftp://example.org/x', 'mailto:legal@example.org',
            "https://example.org/a b", "https://example.org/\u{0000}x", 'https://example.org/' . str_repeat('x', 2048)] as $bad) {
            $this->assertSame('', PublicPageController::httpUrl($bad), var_export($bad, true));
        }
    }

    public function testLegalLinksFromTheming(): void {
        $this->assertSame(['imprintUrl' => '', 'privacyUrl' => ''], PublicPageController::legalLinks($this->appConfig()), 'not configured');
        $this->theming = ['imprintUrl' => 'https://example.org/impressum', 'privacyUrl' => 'javascript:alert(1)'];
        $this->assertSame(['imprintUrl' => 'https://example.org/impressum', 'privacyUrl' => ''], PublicPageController::legalLinks($this->appConfig()));
        $this->theming = ['imprintUrl' => new \RuntimeException('type conflict'), 'privacyUrl' => 'https://example.org/datenschutz'];
        $this->assertSame(['imprintUrl' => '', 'privacyUrl' => 'https://example.org/datenschutz'], PublicPageController::legalLinks($this->appConfig()), 'an unreadable key is ""');
    }

    public function testEveryVariantOfTheGuestPageCarriesThem(): void {
        $this->theming = ['imprintUrl' => 'https://example.org/impressum', 'privacyUrl' => 'https://example.org/datenschutz'];
        $boards = new FakeBoardStore();
        $b = $boards->addBoard('alice');
        $boards->insertLink($b, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $revoked = $boards->insertLink($b, 'Rv3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $boards->links[$revoked]['revoked_at'] = 5;
        $want = '{"imprintUrl":"https:\/\/example.org\/impressum","privacyUrl":"https:\/\/example.org\/datenschutz"}';
        foreach (['Ab3dEf6hIj9kLm2nOp5qRs8t' => '"ok"', 'Rv3dEf6hIj9kLm2nOp5qRs8t' => '"revoked"', 'Nn3dEf6hIj9kLm2nOp5qRs8t' => '"invalid"'] as $token => $linkState) {
            $this->state = [];
            $response = $this->controller($boards)->show($token);
            $this->assertInstanceOf(TemplateResponse::class, $response);
            $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($this->state), 'every key, in order');
            $this->assertSame([$linkState, $want, '"public"'], [$this->state['linkState'], $this->state['legal'], $this->state['page']]);
        }
    }

    /**
     * Job 131: every variant of the guest page, in both render modes, is a
     * GuestPageResponse (renders without the web app manifest link) with the
     * template, mode and CSP of before.
     */
    public function testEveryVariantIsAGuestPageResponse(): void {
        $boards = new FakeBoardStore();
        $b = $boards->addBoard('alice');
        $boards->insertLink($b, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $expired = $boards->insertLink($b, 'Ex3dEf6hIj9kLm2nOp5qRs8t', 'vote', 'alice', 1);
        $boards->links[$expired]['expires_at'] = 5;
        $revoked = $boards->insertLink($b, 'Rv3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $boards->links[$revoked]['revoked_at'] = 5;
        $tokens = ['Ab3dEf6hIj9kLm2nOp5qRs8t' => '"ok"', 'Ex3dEf6hIj9kLm2nOp5qRs8t' => '"expired"', 'Rv3dEf6hIj9kLm2nOp5qRs8t' => '"revoked"', 'Nn3dEf6hIj9kLm2nOp5qRs8t' => '"invalid"'];
        foreach ([[null, TemplateResponse::RENDER_AS_PUBLIC], ['base', TemplateResponse::RENDER_AS_BASE]] as [$setting, $mode]) {
            $this->publicTemplate = $setting;
            foreach ($tokens as $token => $linkState) {
                $this->state = [];
                $response = $this->controller($boards)->show($token);
                $what = ($setting ?? 'default') . " $linkState";
                $this->assertSame($linkState, $this->state['linkState'], $what);
                $this->assertInstanceOf(GuestPageResponse::class, $response, $what);
                $this->assertSame('guest', $response->getTemplateName(), $what);
                $this->assertSame($mode, $response->getRenderAs(), $what);
                $this->assertInstanceOf(ContentSecurityPolicy::class, $response->getContentSecurityPolicy(), $what);
            }
        }
    }

    public function testUserPagesHaveNoLegalLinks(): void {
        $s = PageController::initialStateFor(Fake::of(IConfig::class), PageControllerTest::limits(), ['boardId' => 7]);
        $this->assertSame('legal', PageController::INITIAL_STATE_KEYS[8], 'appended as the 9th key');
        $this->assertNull($s['legal'], 'logged-in pages keep Nextcloud\'s own footer/menu');
    }

    /**
     * M2 privacy notice (AK6): every variant of the guest page carries
     * privacy = {text, url} in the guest's language, privacyAdmin null, and
     * legal.privacyUrl === privacy.url – also with a URL of the language.
     */
    public function testPrivacyOnEveryVariantAndTheEffectiveUrl(): void {
        $this->theming = ['imprintUrl' => 'https://example.org/impressum', 'privacyUrl' => 'https://example.org/datenschutz'];
        $this->notice = ['default' => ['text' => 'T0', 'url' => ''], 'languages' => ['de' => ['text' => 'Tde', 'url' => 'https://example.org/ude']]];
        $boards = new FakeBoardStore();
        $b = $boards->addBoard('alice');
        $boards->insertLink($b, 'Ab3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $expired = $boards->insertLink($b, 'Ex3dEf6hIj9kLm2nOp5qRs8t', 'vote', 'alice', 1);
        $boards->links[$expired]['expires_at'] = 5;
        $revoked = $boards->insertLink($b, 'Rv3dEf6hIj9kLm2nOp5qRs8t', 'edit', 'alice', 1);
        $boards->links[$revoked]['revoked_at'] = 5;
        $tokens = ['Ab3dEf6hIj9kLm2nOp5qRs8t' => '"ok"', 'Ex3dEf6hIj9kLm2nOp5qRs8t' => '"expired"', 'Rv3dEf6hIj9kLm2nOp5qRs8t' => '"revoked"', 'Nn3dEf6hIj9kLm2nOp5qRs8t' => '"invalid"'];
        foreach ([['de_DE', 'Tde', 'https://example.org/ude'], ['fr', 'T0', 'https://example.org/datenschutz']] as [$lang, $text, $url]) {
            $this->lang = $lang;
            foreach ($tokens as $token => $linkState) {
                $this->state = [];
                $this->controller($boards)->show($token);
                $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($this->state), 'the 12 keys');
                $this->assertSame($linkState, $this->state['linkState']);
                $privacy = json_decode($this->state['privacy'], true);
                $legal = json_decode($this->state['legal'], true);
                $this->assertSame(['text' => $text, 'url' => $url], $privacy, "$lang $linkState");
                $this->assertSame($privacy['url'], $legal['privacyUrl'], "$lang $linkState: legal.privacyUrl = privacy.url");
                $this->assertSame('https://example.org/impressum', $legal['imprintUrl']);
                $this->assertSame('null', $this->state['privacyAdmin']);
            }
        }
        $this->notice = [];
        $this->theming = [];
        $this->state = [];
        $this->controller($boards)->show('Ab3dEf6hIj9kLm2nOp5qRs8t');
        $this->assertSame(['{"text":null,"url":""}', '{"imprintUrl":"","privacyUrl":""}'], [$this->state['privacy'], $this->state['legal']], 'nothing set (C47)');
    }
}
