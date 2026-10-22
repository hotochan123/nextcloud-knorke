<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\PrivacyNotice;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IConfig;
use OCP\IRequest;

/**
 * The pages of signed-in users (routes 1–3, SPEC-M0 §4.1): the board list,
 * one board and the landing page of an edit link. All three render the same
 * single-page app (template main); the initial state tells it what to show.
 * The page itself checks nothing: the app asks the API, which answers 404
 * for a board the user may not see.
 */
final class PageController extends Controller {
    /**
     * Every initial-state key of every page (SPEC-M0 §6.6, SPEC-M1 §4.11.3:
     * 12 keys since the M2 privacy notice), the only list.
     * PublicPageController and the admin form (Settings\Admin) use it as
     * well. Fixed text format (frozen contract, §4.1): one line, single
     * quotes — a shell test reads it as text.
     *
     * linkInfo = {"role": "edit"|"vote", "password": bool} on /p/{token} with
     * linkState 'ok', else null; always null until stage 2.
     *
     * privacy = {"text": string|null, "url": string} on every page of routes
     * 1–4 (PrivacyNotice::forPage(): the admin's text and privacy policy URL
     * in the page's language, text null = the client's built-in text); null
     * on the admin page. privacyAdmin = the admin form's data
     * (PrivacyNotice::adminState()) on the admin page only, else null.
     * page: 'user' | 'public' | 'admin'.
     */
    public const INITIAL_STATE_KEYS = ['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal', 'linkInfo', 'privacy', 'privacyAdmin'];

    public function __construct(
        IRequest $request,
        private IInitialState $initialState,
        private IConfig $config,
        private Limits $limits,
        private PrivacyNotice $privacy,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 1 `GET /`: the board list. */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function index(): TemplateResponse {
        return $this->render([]);
    }

    /** Route 2 `GET /b/{id}`: one board. */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function board(int $id): TemplateResponse {
        return $this->render(['boardId' => $id]);
    }

    /**
     * Route 3 `GET /join/{token}`: a signed-in user opened an edit link
     * (/p/{token} redirects here). The app calls POST /api/v1/links/{token}/join
     * and then moves on to /b/{id}.
     */
    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function join(#[\SensitiveParameter] string $token): TemplateResponse {
        return $this->render(['joinToken' => $token]);
    }

    /**
     * The complete initial state of a page: every key of INITIAL_STATE_KEYS;
     * keys that do not apply to the page are null. `limits` comes from
     * Limits::forClient() (an instance: it reads the overridable app config,
     * SPEC-M1 §4.8).
     *
     * @param array<string, mixed> $values page-specific values, keys from INITIAL_STATE_KEYS
     * @return array<string, mixed> keyed and ordered like INITIAL_STATE_KEYS
     */
    public static function initialStateFor(IConfig $config, Limits $limits, array $values): array {
        $defaults = [
            'page' => 'user',
            'debug' => $config->getSystemValueBool('knorke_dev', false),
            'protocol' => Application::PROTOCOL,
            'limits' => $limits->forClient(),
        ];
        $state = [];
        foreach (self::INITIAL_STATE_KEYS as $key) {
            $state[$key] = array_key_exists($key, $values) ? $values[$key] : ($defaults[$key] ?? null);
        }
        $unknown = array_diff(array_keys($values), self::INITIAL_STATE_KEYS);
        if ($unknown !== []) {
            throw new \InvalidArgumentException('Unknown initial state key: ' . implode(', ', $unknown));
        }
        return $state;
    }

    /**
     * Hands a complete state (initialStateFor()) to Nextcloud.
     *
     * Nextcloud drops a plain null with a warning (InitialStateService accepts
     * only scalars, arrays and JsonSerializable; is_scalar(null) is false), and
     * the app's loadState() would then throw for the missing key. A
     * JsonSerializable that encodes as null keeps every key on every page.
     *
     * @param array<string, mixed> $state
     */
    public static function provideState(IInitialState $initialState, array $state): void {
        foreach (self::INITIAL_STATE_KEYS as $key) {
            $value = $state[$key] ?? null;
            $initialState->provideInitialState($key, $value ?? new class() implements \JsonSerializable {
                public function jsonSerialize(): mixed {
                    return null;
                }
            });
        }
    }

    /** @param array<string, mixed> $values */
    private function render(array $values): TemplateResponse {
        $values['privacy'] = $this->privacy->forPage();
        self::provideState($this->initialState, self::initialStateFor($this->config, $this->limits, $values));
        $response = new TemplateResponse(Application::APP_ID, 'main');
        // The default policy is enough: the app talks same-origin only and
        // loads no third-party scripts, styles or images.
        $response->setContentSecurityPolicy(new ContentSecurityPolicy());
        return $response;
    }
}
