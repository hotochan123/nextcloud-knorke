<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Route table of SPEC-M1 §4.1 (routes 1–26, frozen from stage 0 on) plus
 * route 27 of the M2 privacy notice (settingsApi#update, appended as the last
 * line), pinned completely — loaded AND as text in the fixed
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
        ];
    }

    private static function file(): string {
        return dirname(__DIR__, 3) . '/appinfo/routes.php';
    }

    public function testLoadedTable(): void {
        $table = require self::file();
        $this->assertSame(['routes'], array_keys($table));
        $this->assertCount(27, $table['routes']);
        $this->assertCount(27, self::expected());
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

    /** M2 privacy notice (AK1): route 27 is the last line of the array, in the fixed text form; 1–26 stay where they were. */
    public function testRoute27IsTheLastLine(): void {
        $lines = array_values(array_filter(file(self::file(), FILE_IGNORE_NEW_LINES), static fn (string $l): bool => str_contains($l, "'name' =>")));
        $this->assertCount(27, $lines);
        $this->assertSame("        ['name' => 'settingsApi#update', 'url' => '/api/v1/settings/privacy', 'verb' => 'PUT'],", $lines[26]);
        $this->assertSame("        ['name' => 'moderationApi#endSummon', 'url' => '/api/v1/boards/{id}/summon', 'verb' => 'DELETE', 'requirements' => \$id],", $lines[25]);
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
