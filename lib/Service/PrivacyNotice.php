<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Controller\PublicPageController;
use OCA\Knorke\Exception\HttpError;
use OCP\IAppConfig;
use OCP\L10N\IFactory;

/**
 * The privacy notice of guests and of boards open by link (M2): the admin
 * setting, its checks and the fallback chain of a page.
 *
 * Stored as app config knorke/privacy_notice (lazy, a string; read and
 * written with lazy: true), normalised form
 *
 *   {"default": {"text": string, "url": string},
 *    "languages": {"<code>": {"text": string, "url": string}, …}}
 *
 * where '' means "not set", `languages` is sorted by code and always a JSON
 * object ({} when empty). json_encode runs WITHOUT JSON_UNESCAPED_UNICODE:
 * the stored value is pure ASCII, so emoji also fit a MySQL without utf8mb4.
 * Nothing stored (or only empty entries) deletes the key.
 *
 * Reading filters again (a value set by hand through occ never reaches a
 * page unfiltered): texts cleaned like on write and cut to TEXT_MAX, URLs
 * through PublicPageController::httpUrl() (invalid → ''). An unreadable
 * value (exception, broken JSON, wrong types) counts as nothing stored.
 *
 * resolve(): text and URL are resolved independently, the first non-empty
 * value wins: exact language → base language (part before the first "_",
 * de_DE → de) → default → text null (the client shows its built-in text) /
 * theming privacyUrl (through httpUrl, else '').
 */
class PrivacyNotice {
    /** App config key (lazy). */
    public const KEY = 'privacy_notice';
    /** Code points of one notice text. */
    public const TEXT_MAX = 2000;
    /** Language entries (after empty ones were dropped). */
    public const LANGUAGES_MAX = 20;
    /** Keys of one entry (default or a language). */
    private const ENTRY_KEYS = ['text', 'url'];

    public function __construct(
        private IAppConfig $appConfig,
        private IFactory $l10n,
    ) {
    }

    /**
     * The stored setting, filtered again (see above); internal form with
     * `languages` as a PHP array (wire() turns it into a JSON object).
     *
     * @return array{default: array{text: string, url: string}, languages: array<string, array{text: string, url: string}>}
     */
    public function read(): array {
        try {
            $raw = $this->appConfig->getValueString(Application::APP_ID, self::KEY, '', lazy: true);
        } catch (\Throwable) {
            return self::blank();
        }
        return self::fromStored($raw);
    }

    /**
     * Checks and stores a PUT body (route 27, SPEC §3): the body replaces
     * the whole setting. `default` missing = empty, `languages` missing = {}.
     * Order: default, then the languages in the order sent; the first error
     * wins (`at` = "default" or the language code).
     *
     * @param array<string, mixed> $body JsonBody::read($r, ['default', 'languages'])
     * @return array{default: array{text: string, url: string}, languages: array<string, array{text: string, url: string}>} what was stored
     * @throws HttpError 400 bad_request|text_too_long|invalid_url|unknown_language|too_many_languages
     */
    public function save(array $body): array {
        $s = $this->validate($body);
        if (self::isBlank($s)) {
            $this->appConfig->deleteKey(Application::APP_ID, self::KEY);
        } else {
            $this->appConfig->setValueString(Application::APP_ID, self::KEY, self::encode($s), lazy: true);
        }
        return $s;
    }

    /**
     * The checks of save() without storing.
     *
     * @param array<string, mixed> $body
     * @return array{default: array{text: string, url: string}, languages: array<string, array{text: string, url: string}>}
     * @throws HttpError 400
     */
    public function validate(array $body): array {
        $default = array_key_exists('default', $body) ? self::entry($body['default'], 'default') : ['text' => '', 'url' => ''];
        $sent = array_key_exists('languages', $body) ? $body['languages'] : [];
        // JSON {} and [] both decode to []; a non-empty list is no object
        if (!is_array($sent) || ($sent !== [] && array_is_list($sent))) {
            throw new HttpError(400, 'bad_request', 'languages must be an object.');
        }
        $known = null;
        $languages = [];
        foreach ($sent as $code => $v) {
            $code = (string)$code;
            $known ??= array_column($this->languages(), 'code', 'code');
            if (!isset($known[$code])) {
                throw new HttpError(400, 'unknown_language', '', ['at' => $code]);
            }
            $e = self::entry($v, $code);
            if ($e['text'] !== '' || $e['url'] !== '') {
                $languages[$code] = $e;
            }
        }
        if (count($languages) > self::LANGUAGES_MAX) {
            throw new HttpError(400, 'too_many_languages', '', ['max' => self::LANGUAGES_MAX]);
        }
        ksort($languages, SORT_STRING);
        return ['default' => $default, 'languages' => $languages];
    }

    /**
     * Text and URL of a page in language $lang (SPEC §4), each resolved on
     * its own: exact → base → default → null / theming privacyUrl.
     *
     * @return array{text: ?string, url: string}
     */
    public function resolve(string $lang): array {
        $s = $this->read();
        $chain = [$s['languages'][$lang] ?? null];
        $cut = strpos($lang, '_');
        if ($cut !== false) {
            $chain[] = $s['languages'][substr($lang, 0, $cut)] ?? null;
        }
        $chain[] = $s['default'];
        $text = null;
        $url = '';
        foreach ($chain as $e) {
            if ($e === null) {
                continue;
            }
            if ($text === null && $e['text'] !== '') {
                $text = $e['text'];
            }
            if ($url === '' && $e['url'] !== '') {
                $url = $e['url'];
            }
        }
        if ($url === '') {
            $url = PublicPageController::legalLinks($this->appConfig)['privacyUrl'];
        }
        return ['text' => $text, 'url' => $url];
    }

    /**
     * Initial state `privacy` of a page: resolve() in Nextcloud's language
     * of this request (IFactory::findLanguage() without an app id: the
     * account's language or force_language for accounts, Accept-Language,
     * default_language or en on the public page).
     *
     * @return array{text: ?string, url: string}
     */
    public function forPage(): array {
        try {
            $lang = $this->l10n->findLanguage();
        } catch (\Throwable) {
            $lang = 'en';
        }
        return $this->resolve($lang);
    }

    /**
     * Initial state `privacyAdmin` of the admin page (SPEC §5).
     *
     * @return array{settings: array, languages: list<array{code: string, name: string}>, themingUrl: string, textMax: int, languagesMax: int}
     */
    public function adminState(): array {
        return [
            'settings' => self::wire($this->read()),
            'languages' => $this->languages(),
            'themingUrl' => PublicPageController::legalLinks($this->appConfig)['privacyUrl'],
            'textMax' => self::TEXT_MAX,
            'languagesMax' => self::LANGUAGES_MAX,
        ];
    }

    /**
     * Nextcloud's languages (IFactory::getLanguages(): the common ones, then
     * the others, in Nextcloud's order).
     *
     * @return list<array{code: string, name: string}>
     */
    public function languages(): array {
        try {
            $all = $this->l10n->getLanguages();
        } catch (\Throwable) {
            return [];
        }
        $out = [];
        foreach (['commonLanguages', 'otherLanguages'] as $group) {
            $list = $all[$group] ?? [];
            if (!is_array($list)) {
                continue;
            }
            foreach ($list as $l) {
                $code = is_array($l) ? ($l['code'] ?? null) : null;
                if (!is_string($code) || $code === '') {
                    continue;
                }
                $name = $l['name'] ?? null;
                $out[] = ['code' => $code, 'name' => is_string($name) && $name !== '' ? $name : $code];
            }
        }
        return $out;
    }

    /**
     * The normalised form for JSON (answer, initial state, storage):
     * `languages` as an object, {} when empty, never [].
     *
     * @param array{default: array, languages: array} $s internal form
     * @return array{default: array{text: string, url: string}, languages: object}
     */
    public static function wire(array $s): array {
        return ['default' => $s['default'], 'languages' => (object)$s['languages']];
    }

    /** The stored text: ASCII JSON (no JSON_UNESCAPED_UNICODE). */
    public static function encode(array $s): string {
        return json_encode(self::wire($s), JSON_THROW_ON_ERROR);
    }

    /**
     * A stored value, filtered (see the class comment); anything unreadable
     * counts as nothing stored.
     *
     * @return array{default: array{text: string, url: string}, languages: array<string, array{text: string, url: string}>}
     */
    public static function fromStored(string $raw): array {
        if ($raw === '') {
            return self::blank();
        }
        try {
            $d = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::blank();
        }
        if (!is_array($d)) {
            return self::blank();
        }
        $default = self::storedEntry($d['default'] ?? []);
        $stored = $d['languages'] ?? [];
        if ($default === null || !is_array($stored)) {
            return self::blank();
        }
        $languages = [];
        foreach ($stored as $code => $v) {
            $e = self::storedEntry($v);
            if (!is_string($code) || $e === null) {
                return self::blank();
            }
            if ($e['text'] !== '' || $e['url'] !== '') {
                $languages[$code] = $e;
            }
        }
        ksort($languages, SORT_STRING);
        return ['default' => $default, 'languages' => $languages];
    }

    /** @return array{default: array{text: string, url: string}, languages: array{}} */
    public static function blank(): array {
        return ['default' => ['text' => '', 'url' => ''], 'languages' => []];
    }

    private static function isBlank(array $s): bool {
        return $s['default']['text'] === '' && $s['default']['url'] === '' && $s['languages'] === [];
    }

    /**
     * One entry of a PUT body: an object with at most `text` and `url`, each
     * a string or null.
     *
     * @return array{text: string, url: string}
     * @throws HttpError 400 bad_request|text_too_long|invalid_url (with at)
     */
    private static function entry(mixed $v, string $at): array {
        if (!is_array($v) || ($v !== [] && array_is_list($v))) {
            throw new HttpError(400, 'bad_request', 'An entry must be an object.', ['at' => $at]);
        }
        foreach ($v as $k => $x) {
            if (!in_array($k, self::ENTRY_KEYS, true) || ($x !== null && !is_string($x))) {
                throw new HttpError(400, 'bad_request', 'An entry has only text and url, each a string.', ['at' => $at]);
            }
        }
        $text = self::cleanText($v['text'] ?? '');
        if ($text === null) {
            throw new HttpError(400, 'bad_request', 'The text is not valid UTF-8.', ['at' => $at]);
        }
        if (mb_strlen($text, 'UTF-8') > self::TEXT_MAX) {
            throw new HttpError(400, 'text_too_long', '', ['at' => $at, 'max' => self::TEXT_MAX]);
        }
        $url = trim($v['url'] ?? '');
        if ($url !== '' && PublicPageController::httpUrl($url) === '') {
            throw new HttpError(400, 'invalid_url', '', ['at' => $at]);
        }
        return ['text' => $text, 'url' => $url];
    }

    /**
     * One entry of a stored value, filtered; null = wrong types.
     *
     * @return array{text: string, url: string}|null
     */
    private static function storedEntry(mixed $v): ?array {
        if (!is_array($v)) {
            return null;
        }
        $text = $v['text'] ?? '';
        $url = $v['url'] ?? '';
        if (!is_string($text) || !is_string($url)) {
            return null;
        }
        return [
            'text' => mb_substr(self::cleanText($text) ?? '', 0, self::TEXT_MAX, 'UTF-8'),
            'url' => PublicPageController::httpUrl($url),
        ];
    }

    /**
     * Input::text without its length limit (CRLF → LF, C0 controls except
     * "\t" and "\n" removed), then trimmed; null for broken UTF-8. No HTML is
     * removed: the client shows the text only through Vue interpolation.
     */
    private static function cleanText(string $v): ?string {
        $t = Input::text($v, PHP_INT_MAX);
        return $t === null ? null : trim($t);
    }
}
