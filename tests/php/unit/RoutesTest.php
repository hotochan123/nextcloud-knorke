<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Route table of SPEC-M1 §4.1 (routes 1–26, frozen from stage 0 on) plus
 * route 27 of the M2 privacy notice (settingsApi#update, appended after them)
 * and routes 28–34 of the template suggestions (factory job 182,
 * templateApi#*, appended after route 27) and routes 35–43 of the comments
 * (factory job 189, commentApi#* and publicComment#*, appended after route
 * 34) and routes 44–45 of the tags (factory job 191, tagApi#update and
 * publicTag#update, appended after route 43) and routes 46–54 of the own
 * shape libraries (factory job 203, shapeLibApi#*, appended after route 45)
 * and routes 55–56 of the board list favorites (factory job 219,
 * boardApi#favorite and boardApi#opened, appended after route 54) and route
 * 57 of the board list sketches (factory job 221, boardApi#sketch, appended
 * after route 56),
 * pinned completely — loaded AND as text in the fixed
 * one-route-per-line format the frontend's shell tests read (frozen contract
 * SPEC-M0 §10.2). Also the fixed lines PROTOCOL = 2 and the 12 initial-state
 * keys.
 */
final class RoutesTest extends TestCase {
    private const ID = ['id' => '\d{1,18}'];
    private const TOK = ['token' => '[A-Za-z0-9]{24}'];

    /** @return list<array{0: string, 1: string, 2: string, 3: ?array}> */
    private static function expected(): array {
        return [
            ['page#index', '/', 'GET', null],
            ['page#board', '/b/{id}', 'GET', self::ID],
            ['page#join', '/join/{token}', 'GET', self::TOK],
            ['publicPage#show', '/p/{token}', 'GET', self::TOK],
            ['boardApi#index', '/api/v1/boards', 'GET', null],
            ['boardApi#create', '/api/v1/boards', 'POST', null],
            ['boardApi#update', '/api/v1/boards/{id}', 'PATCH', self::ID],
            ['boardApi#destroy', '/api/v1/boards/{id}', 'DELETE', self::ID],
            ['boardApi#enableLink', '/api/v1/boards/{id}/link', 'POST', self::ID],
            ['boardApi#disableLink', '/api/v1/boards/{id}/link', 'DELETE', self::ID],
            ['boardApi#joinLink', '/api/v1/links/{token}/join', 'POST', self::TOK],
            ['sync#snapshot', '/api/v1/boards/{id}/snapshot', 'GET', self::ID],
            ['sync#sync', '/api/v1/boards/{id}/sync', 'POST', self::ID],
            ['publicSync#join', '/pub/v1/{token}/join', 'POST', self::TOK],
            ['publicSync#snapshot', '/pub/v1/boards/{id}/snapshot', 'GET', self::ID],
            ['publicSync#sync', '/pub/v1/boards/{id}/sync', 'POST', self::ID],
            ['boardApi#enableVoteLink', '/api/v1/boards/{id}/votelink', 'POST', self::ID],
            ['boardApi#disableVoteLink', '/api/v1/boards/{id}/votelink', 'DELETE', self::ID],
            ['shareApi#index', '/api/v1/boards/{id}/shares', 'GET', self::ID],
            ['shareApi#update', '/api/v1/boards/{id}/shares', 'PUT', self::ID],
            ['shareApi#sharees', '/api/v1/boards/{id}/sharees', 'GET', self::ID],
            ['moderationApi#startVote', '/api/v1/boards/{id}/vote', 'POST', self::ID],
            ['moderationApi#updateVote', '/api/v1/boards/{id}/vote', 'PATCH', self::ID],
            ['moderationApi#timer', '/api/v1/boards/{id}/timer', 'PUT', self::ID],
            ['moderationApi#summon', '/api/v1/boards/{id}/summon', 'POST', self::ID],
            ['moderationApi#endSummon', '/api/v1/boards/{id}/summon', 'DELETE', self::ID],
            ['settingsApi#update', '/api/v1/settings/privacy', 'PUT', null],
            // factory job 182: template suggestions, appended after route 27
            ['templateApi#index', '/api/v1/templates', 'GET', null],
            ['templateApi#create', '/api/v1/templates', 'POST', null],
            ['templateApi#show', '/api/v1/templates/{id}', 'GET', self::ID],
            ['templateApi#update', '/api/v1/templates/{id}', 'PATCH', self::ID],
            ['templateApi#destroy', '/api/v1/templates/{id}', 'DELETE', self::ID],
            ['templateApi#adopt', '/api/v1/templates/{id}/adopt', 'POST', self::ID],
            ['templateApi#review', '/api/v1/templates/review', 'GET', null],
            // factory job 189: comments, appended after route 34
            ['commentApi#index', '/api/v1/boards/{id}/comments', 'GET', self::ID],
            ['commentApi#create', '/api/v1/boards/{id}/comments', 'POST', self::ID],
            ['commentApi#update', '/api/v1/boards/{id}/comments', 'PATCH', self::ID],
            ['commentApi#destroy', '/api/v1/boards/{id}/comments', 'DELETE', self::ID],
            ['commentApi#mentions', '/api/v1/boards/{id}/mentions', 'GET', self::ID],
            ['publicComment#index', '/pub/v1/boards/{id}/comments', 'GET', self::ID],
            ['publicComment#create', '/pub/v1/boards/{id}/comments', 'POST', self::ID],
            ['publicComment#update', '/pub/v1/boards/{id}/comments', 'PATCH', self::ID],
            ['publicComment#destroy', '/pub/v1/boards/{id}/comments', 'DELETE', self::ID],
            // factory job 191: tags, appended after route 43
            ['tagApi#update', '/api/v1/boards/{id}/tags', 'PUT', self::ID],
            ['publicTag#update', '/pub/v1/boards/{id}/tags', 'PUT', self::ID],
            // factory job 203: own shape libraries, appended after route 45
            ['shapeLibApi#index', '/api/v1/shapelibs', 'GET', null],
            ['shapeLibApi#create', '/api/v1/shapelibs', 'POST', null],
            ['shapeLibApi#show', '/api/v1/shapelibs/{id}', 'GET', self::ID],
            ['shapeLibApi#update', '/api/v1/shapelibs/{id}', 'PATCH', self::ID],
            ['shapeLibApi#destroy', '/api/v1/shapelibs/{id}', 'DELETE', self::ID],
            ['shapeLibApi#suggest', '/api/v1/shapelibs/{id}/suggest', 'POST', self::ID],
            ['shapeLibApi#adopt', '/api/v1/shapelibs/{id}/adopt', 'POST', self::ID],
            ['shapeLibApi#review', '/api/v1/shapelibs/review', 'GET', null],
            ['shapeLibApi#withdraw', '/api/v1/shapelibs/{id}/suggest', 'DELETE', self::ID],
            ['boardApi#favorite', '/api/v1/boards/{id}/favorite', 'PUT', self::ID],
            ['boardApi#opened', '/api/v1/boards/{id}/opened', 'POST', self::ID],
            ['boardApi#sketch', '/api/v1/boards/{id}/sketch', 'GET', self::ID],
            ['settingsApi#ai', '/api/v1/settings/ai', 'PUT', null],
            ['aiApi#index', '/api/v1/boards/{id}/ai', 'GET', self::ID],
            ['aiApi#start', '/api/v1/boards/{id}/ai', 'POST', self::ID],
            ['aiApi#cancel', '/api/v1/boards/{id}/ai', 'DELETE', self::ID],
            ['aiApi#allow', '/api/v1/boards/{id}/aiswitch', 'PUT', self::ID],
            ['moderationApi#moveSummon', '/api/v1/boards/{id}/summon', 'PUT', self::ID],
            ['moderationApi#slides', '/api/v1/boards/{id}/slides', 'PUT', self::ID],
            ['moderationApi#privateWriting', '/api/v1/boards/{id}/private', 'PUT', self::ID],
        ];
    }

    private static function file(): string {
        return dirname(__DIR__, 3) . '/appinfo/routes.php';
    }

    public function testLoadedTable(): void {
        $table = require self::file();
        $this->assertSame(['routes'], array_keys($table));
        $this->assertCount(65, $table['routes']);
        $this->assertCount(65, self::expected());
        foreach (self::expected() as $i => [$name, $url, $verb, $req]) {
            $want = ['name' => $name, 'url' => $url, 'verb' => $verb] + ($req === null ? [] : ['requirements' => $req]);
            $this->assertSame($want, $table['routes'][$i], $name);
        }
    }

    public function testFixedTextFormat(): void {
        $re = "/^\\s*\\['name' => '([A-Za-z]+#[A-Za-z]+)', 'url' => '([^']+)', 'verb' => '(GET|POST|PUT|PATCH|DELETE)'(?:, 'requirements' => \\$(id|tok))?\\],$/";
        $parsed = [];
        foreach (file(self::file(), FILE_IGNORE_NEW_LINES) as $line) {
            if (str_contains($line, "'name' =>")) {
                $this->assertMatchesRegularExpression($re, $line, 'one route per line in the fixed key order');
                preg_match($re, $line, $m);
                $parsed[] = [$m[1], $m[2], $m[3], ($m[4] ?? '') === '' ? null : ($m[4] === 'id' ? self::ID : self::TOK)];
            }
        }
        $this->assertSame(self::expected(), $parsed);
        $src = (string)file_get_contents(self::file());
        $this->assertStringContainsString("\$id = ['id' => '\\d{1,18}'];", $src);
        $this->assertStringContainsString("\$tok = ['token' => '[A-Za-z0-9]{24}'];", $src);
    }

    /**
     * M2 privacy notice (AK1): route 27 follows route 26, in the fixed text
     * form; 1–26 stay where they were. Factory job 182 (AK8): routes 28–34
     * follow route 27; factory job 189 (AK9): routes 35–43 follow route 34;
     * factory job 191 (AK8): routes 44–45 follow route 43; factory job 203:
     * routes 46–54 follow route 45; factory job 219: routes 55–56 follow
     * route 54; factory job 221: route 57 follows route 56; factory job 267: routes 58–62 follow
     * route 57; factory job 272: routes 63–64 follow route 62; job 275: route 65 last
     * as the last lines of the array.
     */
    public function testRoute27AndTheTemplateRoutesAreAppended(): void {
        $lines = array_values(array_filter(file(self::file(), FILE_IGNORE_NEW_LINES), static fn (string $l): bool => str_contains($l, "'name' =>")));
        $this->assertCount(65, $lines);
        $this->assertSame("        ['name' => 'settingsApi#update', 'url' => '/api/v1/settings/privacy', 'verb' => 'PUT'],", $lines[26]);
        $this->assertSame("        ['name' => 'moderationApi#endSummon', 'url' => '/api/v1/boards/{id}/summon', 'verb' => 'DELETE', 'requirements' => \$id],", $lines[25]);
        $this->assertSame([
            "        ['name' => 'templateApi#index', 'url' => '/api/v1/templates', 'verb' => 'GET'],",
            "        ['name' => 'templateApi#create', 'url' => '/api/v1/templates', 'verb' => 'POST'],",
            "        ['name' => 'templateApi#show', 'url' => '/api/v1/templates/{id}', 'verb' => 'GET', 'requirements' => \$id],",
            "        ['name' => 'templateApi#update', 'url' => '/api/v1/templates/{id}', 'verb' => 'PATCH', 'requirements' => \$id],",
            "        ['name' => 'templateApi#destroy', 'url' => '/api/v1/templates/{id}', 'verb' => 'DELETE', 'requirements' => \$id],",
            "        ['name' => 'templateApi#adopt', 'url' => '/api/v1/templates/{id}/adopt', 'verb' => 'POST', 'requirements' => \$id],",
            "        ['name' => 'templateApi#review', 'url' => '/api/v1/templates/review', 'verb' => 'GET'],",
        ], array_slice($lines, 27, 7));
        $this->assertSame([
            "        ['name' => 'commentApi#index', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'GET', 'requirements' => \$id],",
            "        ['name' => 'commentApi#create', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'POST', 'requirements' => \$id],",
            "        ['name' => 'commentApi#update', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'PATCH', 'requirements' => \$id],",
            "        ['name' => 'commentApi#destroy', 'url' => '/api/v1/boards/{id}/comments', 'verb' => 'DELETE', 'requirements' => \$id],",
            "        ['name' => 'commentApi#mentions', 'url' => '/api/v1/boards/{id}/mentions', 'verb' => 'GET', 'requirements' => \$id],",
            "        ['name' => 'publicComment#index', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'GET', 'requirements' => \$id],",
            "        ['name' => 'publicComment#create', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'POST', 'requirements' => \$id],",
            "        ['name' => 'publicComment#update', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'PATCH', 'requirements' => \$id],",
            "        ['name' => 'publicComment#destroy', 'url' => '/pub/v1/boards/{id}/comments', 'verb' => 'DELETE', 'requirements' => \$id],",
        ], array_slice($lines, 34, 9), 'routes 35–43 after route 34');
        $this->assertSame([
            "        ['name' => 'tagApi#update', 'url' => '/api/v1/boards/{id}/tags', 'verb' => 'PUT', 'requirements' => \$id],",
            "        ['name' => 'publicTag#update', 'url' => '/pub/v1/boards/{id}/tags', 'verb' => 'PUT', 'requirements' => \$id],",
        ], array_slice($lines, 43, 2), 'routes 44–45 after route 43');
        $this->assertSame([
            "        ['name' => 'shapeLibApi#index', 'url' => '/api/v1/shapelibs', 'verb' => 'GET'],",
            "        ['name' => 'shapeLibApi#create', 'url' => '/api/v1/shapelibs', 'verb' => 'POST'],",
            "        ['name' => 'shapeLibApi#show', 'url' => '/api/v1/shapelibs/{id}', 'verb' => 'GET', 'requirements' => \$id],",
            "        ['name' => 'shapeLibApi#update', 'url' => '/api/v1/shapelibs/{id}', 'verb' => 'PATCH', 'requirements' => \$id],",
            "        ['name' => 'shapeLibApi#destroy', 'url' => '/api/v1/shapelibs/{id}', 'verb' => 'DELETE', 'requirements' => \$id],",
            "        ['name' => 'shapeLibApi#suggest', 'url' => '/api/v1/shapelibs/{id}/suggest', 'verb' => 'POST', 'requirements' => \$id],",
            "        ['name' => 'shapeLibApi#adopt', 'url' => '/api/v1/shapelibs/{id}/adopt', 'verb' => 'POST', 'requirements' => \$id],",
            "        ['name' => 'shapeLibApi#review', 'url' => '/api/v1/shapelibs/review', 'verb' => 'GET'],",
            "        ['name' => 'shapeLibApi#withdraw', 'url' => '/api/v1/shapelibs/{id}/suggest', 'verb' => 'DELETE', 'requirements' => \$id],",
        ], array_slice($lines, 45, 9), 'routes 46–54 after route 45');
        $this->assertSame([
            "        ['name' => 'boardApi#favorite', 'url' => '/api/v1/boards/{id}/favorite', 'verb' => 'PUT', 'requirements' => \$id],",
            "        ['name' => 'boardApi#opened', 'url' => '/api/v1/boards/{id}/opened', 'verb' => 'POST', 'requirements' => \$id],",
        ], array_slice($lines, 54, 2), 'routes 55–56 after route 54');
        $this->assertSame([
            "        ['name' => 'boardApi#sketch', 'url' => '/api/v1/boards/{id}/sketch', 'verb' => 'GET', 'requirements' => \$id],",
        ], array_slice($lines, 56, 1), 'route 57 after route 56');
        $this->assertSame([
            "        ['name' => 'settingsApi#ai', 'url' => '/api/v1/settings/ai', 'verb' => 'PUT'],",
            "        ['name' => 'aiApi#index', 'url' => '/api/v1/boards/{id}/ai', 'verb' => 'GET', 'requirements' => \$id],",
            "        ['name' => 'aiApi#start', 'url' => '/api/v1/boards/{id}/ai', 'verb' => 'POST', 'requirements' => \$id],",
            "        ['name' => 'aiApi#cancel', 'url' => '/api/v1/boards/{id}/ai', 'verb' => 'DELETE', 'requirements' => \$id],",
            "        ['name' => 'aiApi#allow', 'url' => '/api/v1/boards/{id}/aiswitch', 'verb' => 'PUT', 'requirements' => \$id],",
        ], array_slice($lines, 57, 5), 'routes 58–62 after route 57');
        $this->assertSame([
            "        ['name' => 'moderationApi#moveSummon', 'url' => '/api/v1/boards/{id}/summon', 'verb' => 'PUT', 'requirements' => \$id],",
            "        ['name' => 'moderationApi#slides', 'url' => '/api/v1/boards/{id}/slides', 'verb' => 'PUT', 'requirements' => \$id],",
            "        ['name' => 'moderationApi#privateWriting', 'url' => '/api/v1/boards/{id}/private', 'verb' => 'PUT', 'requirements' => \$id],",
        ], array_slice($lines, 62), 'routes 63–65 come last');
    }

    public function testFixedLinesOfOtherFiles(): void {
        $root = dirname(__DIR__, 3);
        $this->assertMatchesRegularExpression('/^    public const PROTOCOL = 2;$/m', (string)file_get_contents($root . '/lib/AppInfo/Application.php'));
        $this->assertMatchesRegularExpression(
            "/^    public const INITIAL_STATE_KEYS = \\['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal', 'linkInfo', 'privacy', 'privacyAdmin'\\];$/m",
            (string)file_get_contents($root . '/lib/Controller/PageController.php'),
        );
    }
}
