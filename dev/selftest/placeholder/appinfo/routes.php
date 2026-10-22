<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

// The one route of the placeholder app (SPEC-M0 §8.1): the same URL as route 5
// of the real app, so the 401 probe of dev/up.sh works for both.
return [
    'routes' => [
        ['name' => 'boardApi#index', 'url' => '/api/v1/boards', 'verb' => 'GET'],
    ],
];
