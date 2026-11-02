<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

// Route table of SPEC-M1 §4.1 (routes 1–16 as in SPEC-M0 §4.1, 17–26 new in
// M1; all 26 frozen from stage 0 on, the actions of 17–26 answer 501 until
// their stage). Route 27 (M2, privacy notice): the admin setting, appended
// as the last line so routes 1–26 stay unchanged; routes 28–34 (factory job
// 182, template suggestions) follow it the same way, routes 35–43 (factory
// job 189, comments) follow those, routes 44–45 (factory job 191, tags)
// after them, routes 46–54 (factory job 203, own shape libraries) after
// those, routes 55–56 (factory job 219, board list favorites) after them,
// route 57 (factory job 221, board list sketches) after them, and routes
// 58–62 (factory job 267, AI: the admin setting and a board's AI tasks)
// come last. Plain
// controller routes, no
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
        ['name' => 'templateApi#index', 'url' => '/api/v1/templates', 'verb' => 'GET'],
        ['name' => 'templateApi#create', 'url' => '/api/v1/templates', 'verb' => 'POST'],
        ['name' => 'templateApi#show', 'url' => '/api/v1/templates/{id}', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'templateApi#update', 'url' => '/api/v1/templates/{id}', 'verb' => 'PATCH', 'requirements' => $id],
        ['name' => 'templateApi#destroy', 'url' => '/api/v1/templates/{id}', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'templateApi#adopt', 'url' => '/api/v1/templates/{id}/adopt', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'templateApi#review', 'url' => '/api/v1/templates/review', 'verb' => 'GET'],
        ['name' => 'commentApi#index', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'commentApi#create', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'commentApi#update', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'PATCH', 'requirements' => $id],
        ['name' => 'commentApi#destroy', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'commentApi#mentions', 'url' => '/api/v1/boards/{id}/mentions', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'publicComment#index', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'publicComment#create', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'publicComment#update', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'PATCH', 'requirements' => $id],
        ['name' => 'publicComment#destroy', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'tagApi#update', 'url' => '/api/v1/boards/{id}/tags', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'publicTag#update', 'url' => '/pub/v1/boards/{id}/tags', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'shapeLibApi#index', 'url' => '/api/v1/shapelibs', 'verb' => 'GET'],
        ['name' => 'shapeLibApi#create', 'url' => '/api/v1/shapelibs', 'verb' => 'POST'],
        ['name' => 'shapeLibApi#show', 'url' => '/api/v1/shapelibs/{id}', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'shapeLibApi#update', 'url' => '/api/v1/shapelibs/{id}', 'verb' => 'PATCH', 'requirements' => $id],
        ['name' => 'shapeLibApi#destroy', 'url' => '/api/v1/shapelibs/{id}', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'shapeLibApi#suggest', 'url' => '/api/v1/shapelibs/{id}/suggest', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'shapeLibApi#adopt', 'url' => '/api/v1/shapelibs/{id}/adopt', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'shapeLibApi#review', 'url' => '/api/v1/shapelibs/review', 'verb' => 'GET'],
        ['name' => 'shapeLibApi#withdraw', 'url' => '/api/v1/shapelibs/{id}/suggest', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'boardApi#favorite', 'url' => '/api/v1/boards/{id}/favorite', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'boardApi#opened', 'url' => '/api/v1/boards/{id}/opened', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'boardApi#sketch', 'url' => '/api/v1/boards/{id}/sketch', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'settingsApi#ai', 'url' => '/api/v1/settings/ai', 'verb' => 'PUT'],
        ['name' => 'aiApi#index', 'url' => '/api/v1/boards/{id}/ai', 'verb' => 'GET', 'requirements' => $id],
        ['name' => 'aiApi#start', 'url' => '/api/v1/boards/{id}/ai', 'verb' => 'POST', 'requirements' => $id],
        ['name' => 'aiApi#cancel', 'url' => '/api/v1/boards/{id}/ai', 'verb' => 'DELETE', 'requirements' => $id],
        ['name' => 'aiApi#allow', 'url' => '/api/v1/boards/{id}/aiswitch', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'moderationApi#moveSummon', 'url' => '/api/v1/boards/{id}/summon', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'moderationApi#slides', 'url' => '/api/v1/boards/{id}/slides', 'verb' => 'PUT', 'requirements' => $id],
        ['name' => 'moderationApi#privateWriting', 'url' => '/api/v1/boards/{id}/private', 'verb' => 'PUT', 'requirements' => $id],
    ],
];
