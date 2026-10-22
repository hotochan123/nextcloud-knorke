<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Http;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;

/**
 * A JSON body that is already a string (snapshot and sync splice the stored
 * item JSON in verbatim). It extends JSONResponse on purpose: Nextcloud's
 * CompressionMiddleware gzips only JSONResponse/TemplateResponse/OCS bodies
 * (SPEC-M0 §4.2), so every 200 answer is compressed when the client accepts
 * gzip — no gzencode of our own.
 */
final class RawJsonResponse extends JSONResponse {
    public function __construct(
        private string $body,
        int $status = Http::STATUS_OK,
    ) {
        parent::__construct([], $status);
    }

    public function render(): string {
        return $this->body;
    }
}
