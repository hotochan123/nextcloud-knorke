<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Http\GuestPageResponse;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\LinkThrottle;
use OCA\Knorke\Service\PrivacyNotice;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Http\TooManyRequestsResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

/**
 * The page behind an edit or voting link, /p/{token} (route 4, SPEC-M0
 * §4.9.1, SPEC-M1 §4.11.3).
 *
 *  - signed in → redirect to page#join (the app joins and opens the board)
 *  - guest, in the order of Pulse codeMissBlocked (only a miss asks the
 *    throttle):
 *      active link    → public page, linkState 'ok', boardId, linkInfo
 *                       {role: edit|vote, password: bool}
 *      revoked link   → same page, linkState 'revoked' — no throttle, no miss
 *      expired link   → same page, linkState 'expired' — no throttle, no miss
 *      never issued   → LinkThrottle::missBlocked(ip): blocked → 429,
 *                       else the page with linkState 'invalid'
 *    linkInfo is null except for 'ok'; it tells only holders of the token
 *    that a password is needed (SPEC-M1 §7.5).
 *
 * Render mode RENDER_AS_PUBLIC; app config public_template = base switches to
 * RENDER_AS_BASE (measurement E12 only). The page itself writes nothing.
 *
 * The guest page links no web app manifest (job 131): the app manifest's
 * start_url is /apps/knorke/, for a guest Nextcloud's login page, so an
 * installed app lost the guest link. GuestPageResponse removes the
 * <link rel="manifest"> of Nextcloud's public layout from the rendered HTML;
 * a home screen shortcut then starts at the guest link itself.
 *
 * The guest page hides Nextcloud's public footer (§6.6), which is where
 * theming puts the instance's legal links. Every variant of the page
 * therefore carries them as initial state `legal` = {imprintUrl, privacyUrl}
 * (theming's imprintUrl/privacyUrl; '' = not configured or not an http(s)
 * URL), and the app shows them itself (review finding NC-4).
 *
 * M2 privacy notice: every variant also carries `privacy` = {text, url}
 * (PrivacyNotice::forPage(), the guest's language from Nextcloud's
 * detection on the public page), and `legal.privacyUrl` is that effective
 * URL: a privacy policy URL the admin set for the language also replaces
 * theming's in the guest menu and the empty states. Without one it stays
 * theming's privacyUrl.
 */
final class PublicPageController extends Controller {
    public function __construct(
        IRequest $request,
        private IUserSession $userSession,
        private IURLGenerator $urls,
        private BoardStore $boards,
        private LinkThrottle $throttle,
        private IInitialState $initialState,
        private IConfig $config,
        private IAppConfig $appConfig,
        private Limits $limits,
        private ITimeFactory $time,
        private PrivacyNotice $privacy,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 4 `GET /p/{token}`. */
    #[PublicPage]
    #[NoCSRFRequired]
    public function show(#[\SensitiveParameter] string $token): Response {
        if ($this->userSession->isLoggedIn()) {
            return new RedirectResponse($this->urls->linkToRoute('knorke.page.join', ['token' => $token]));
        }
        $link = $this->boards->findLinkByToken($token);
        if ($link === null) {
            if ($this->throttle->missBlocked($this->request->getRemoteAddress())) {
                return new TooManyRequestsResponse();
            }
            return $this->page(['linkToken' => $token, 'linkState' => 'invalid', 'boardId' => null]);
        }
        if ($link['revoked_at'] !== null || $link['board'] === null) {
            return $this->page(['linkToken' => $token, 'linkState' => 'revoked', 'boardId' => null]);
        }
        $nowMs = (int)floor((float)$this->time->now()->format('U.u') * 1000);
        if ($link['expires_at'] !== null && $link['expires_at'] <= $nowMs) {
            return $this->page(['linkToken' => $token, 'linkState' => 'expired', 'boardId' => null]);
        }
        return $this->page(['linkToken' => $token, 'linkState' => 'ok', 'boardId' => $link['board']['id'],
            'linkInfo' => ['role' => $link['role'], 'password' => $link['password_hash'] !== null]]);
    }

    /** @param array<string, mixed> $values */
    private function page(array $values): TemplateResponse {
        $privacy = $this->privacy->forPage();
        $legal = ['imprintUrl' => self::legalLinks($this->appConfig)['imprintUrl'], 'privacyUrl' => $privacy['url']];
        $values = ['page' => 'public', 'legal' => $legal, 'privacy' => $privacy] + $values;
        PageController::provideState($this->initialState, PageController::initialStateFor($this->config, $this->limits, $values));
        $mode = $this->publicTemplate() === 'base' ? TemplateResponse::RENDER_AS_BASE : TemplateResponse::RENDER_AS_PUBLIC;
        $response = new GuestPageResponse(Application::APP_ID, 'guest', [], $mode);
        $response->setContentSecurityPolicy(new ContentSecurityPolicy());
        return $response;
    }

    /**
     * The instance's legal links from theming (what NC's public footer shows),
     * each an absolute http(s) URL or ''.
     *
     * @return array{imprintUrl: string, privacyUrl: string}
     */
    public static function legalLinks(IAppConfig $appConfig): array {
        $read = static function (string $key) use ($appConfig): string {
            try {
                return self::httpUrl($appConfig->getValueString('theming', $key, ''));
            } catch (\Throwable) {
                return '';
            }
        };
        return ['imprintUrl' => $read('imprintUrl'), 'privacyUrl' => $read('privacyUrl')];
    }

    /**
     * $url if it is an absolute http(s) URL with a host and without white
     * space or control characters (≤ 2048 bytes), else '' — a javascript:,
     * data: or relative value never reaches an href.
     */
    public static function httpUrl(string $url): string {
        $url = trim($url);
        if ($url === '' || strlen($url) > 2048 || preg_match('/[\x00-\x20\x7F]/', $url) === 1) {
            return '';
        }
        $parts = parse_url($url);
        if (!is_array($parts) || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) || ($parts['host'] ?? '') === '') {
            return '';
        }
        return $url;
    }

    private function publicTemplate(): string {
        try {
            return $this->appConfig->getValueString(Application::APP_ID, 'public_template', 'public');
        } catch (\Throwable) {
            return 'public';
        }
    }
}
