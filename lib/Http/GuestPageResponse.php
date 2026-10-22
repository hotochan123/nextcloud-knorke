<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Http;

use OCP\AppFramework\Http\TemplateResponse;

/**
 * The guest page /p/{token} without a web app manifest (job 131).
 *
 * Nextcloud's public layout always links the app's manifest, whose
 * start_url is /apps/knorke/ — for a guest that is Nextcloud's login page.
 * A browser offered "Install app" for the guest link, and the installed app
 * then opened the login page without an address bar. Without the manifest a
 * home screen shortcut starts at the current URL, the guest link.
 *
 * The tag is removed from the rendered HTML on the server, so it never
 * reaches the browser (no race with a script, no CSP report). It stays a
 * TemplateResponse: CompressionMiddleware gzips the output of render().
 */
final class GuestPageResponse extends TemplateResponse {
    /** A <link …> tag with its own rel attribute of exactly "manifest" (any case, either quote). */
    public const MANIFEST_LINK = '/<link\b[^>]*\srel\s*=\s*(["\'])manifest\1[^>]*>/i';

    public function render(): string {
        return self::withoutManifest((string)parent::render());
    }

    /**
     * $html without any manifest link tag (only the tag, the white space
     * around it stays). Without a match, or on a PCRE error, $html comes
     * back unchanged: the page then fails open, as before job 131.
     */
    public static function withoutManifest(string $html): string {
        return preg_replace(self::MANIFEST_LINK, '', $html) ?? $html;
    }
}
