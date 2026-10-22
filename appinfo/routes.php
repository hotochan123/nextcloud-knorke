<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

// Route table of SPEC-M1 §4.1 (routes 1–16 as in SPEC-M0 §4.1, 17–26 new in
// M1; all 26 frozen from stage 0 on, the actions of 17–26 answer 501 until
// their stage). Route 27 (M2, privacy notice): the admin setting, appended
// as the last line so routes 1–26 stay unchanged. Plain controller routes, no
// OCS: /sync is the hottest request of the app and the OCS envelope would
// only add bytes.
//
// Fixed text format (frozen contract, SPEC-M0 §4.1/§10.2): the shell tests of
// the frontend read this file as text. Exactly one route per line, keys in the
// order name, url, verb(, requirements), requirements only as $id or $tok, and
// no comments inside the 'routes' array.
//
// APCu route cache: a route added here answers 404 until the Nextcloud
// container restarts (dev/restart.sh). 404 = cache, 401 = route exists.
$id = ['id' => '\d{1,18}'];
$tok = ['token' => '[A-Za-z0-9]{24}'];

return [
    'routes' => [
        ['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
        ['name' => 'page#board', 'url' => '/b/{id}', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'page#join', 'url' => '/join/{token}', 'verb' => 'GET', 'requirements' => $tok],
        ['name' => 'publicPage#show', 'url' => '/p/{token}', 'verb' => 'GET', 'requirements' => $tok],
        ['name' => 'boardApi#index', 'url' => '/api/v1/boards', 'verb' => 'GET'],
        ['name' => 'boardApi#create', 'url' => '/api/v1/boards', 'verb' => 'POST'],
        ['name' => 'boardApi#update', 'url' => '/api/v1/boards/{id}', 'verb' => 'PATCH', 'requirements' => $id],
        ['name' => 'boardApi#destroy', 'url' => '/api/v1/boards/{id}', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'boardApi#enableLink', 'url' => '/api/v1/boards/{id}/link', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'boardApi#disableLink', 'url' => '/api/v1/boards/{id}/link', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'boardApi#joinLink', 'url' => '/api/v1/links/{token}/join', 'verb' => 'POST', 'requirements' => $tok],
        ['name' => 'sync#snapshot', 'url' => '/api/v1/boards/{id}/snapshot', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'sync#sync', 'url' => '/api/v1/boards/{id}/sync', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'publicSync#join', 'url' => '/pub/v1/{token}/join', 'verb' => 'POST', 'requirements' => $tok],
        ['name' => 'publicSync#snapshot', 'url' => '/pub/v1/boards/{id}/snapshot', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'publicSync#sync', 'url' => '/pub/v1/boards/{id}/sync', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'boardApi#enableVoteLink', 'url' => '/api/v1/boards/{id}/votelink', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'boardApi#disableVoteLink', 'url' => '/api/v1/boards/{id}/votelink', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'shareApi#index', 'url' => '/api/v1/boards/{id}/shares', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'shareApi#update', 'url' => '/api/v1/boards/{id}/shares', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'shareApi#sharees', 'url' => '/api/v1/boards/{id}/sharees', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'moderationApi#startVote', 'url' => '/api/v1/boards/{id}/vote', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'moderationApi#updateVote', 'url' => '/api/v1/boards/{id}/vote', 'verb' => 'PATCH', 'requirements' => $id],
        ['name' => 'moderationApi#timer', 'url' => '/api/v1/boards/{id}/timer', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'moderationApi#summon', 'url' => '/api/v1/boards/{id}/summon', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'moderationApi#endSummon', 'url' => '/api/v1/boards/{id}/summon', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'settingsApi#update', 'url' => '/api/v1/settings/privacy', 'verb' => 'PUT'],
    ],
];
