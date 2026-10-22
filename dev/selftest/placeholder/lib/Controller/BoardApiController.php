<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * Placeholder controller for the dev stack self-test (SPEC-M0 §8.1). Signed-in
 * users get an empty list; anonymous requests never get here, Nextcloud's
 * SecurityMiddleware answers them with 401 – which is what dev/up.sh probes.
 */
final class BoardApiController extends Controller {
    public function __construct(IRequest $request) {
        parent::__construct('knorke', $request);
    }

    #[NoAdminRequired]
    public function index(): JSONResponse {
        return new JSONResponse([]);
    }
}
