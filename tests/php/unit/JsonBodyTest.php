<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Tests\Support\Fake;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

/** JsonBody::read (SPEC-M0 §4.1, R2) and JsonBody::query (SPEC-M1 §4.1) against a fake request with urlParams. */
final class JsonBodyTest extends TestCase {
    /**
     * Mimics OC\AppFramework\Http\Request: route parameters first, then the
     * decoded body merged over them.
     */
    private static function request(array $route, ?array $body, ?string $len = '10', ?\JsonException $decodeError = null, array $query = []): IRequest {
        $params = array_merge($query, $route, $body ?? []);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? ($len ?? '') : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'throwDecodingExceptionIfAny' => function () use ($decodeError): void {
                if ($decodeError !== null) {
                    throw $decodeError;
                }
            },
        ], ['urlParams' => $route]);
    }

    private function expectError(int $status, string $code, callable $fn): void {
        try {
            $fn();
            $this->fail("expected $status $code");
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error]);
        }
    }

    public function testReturnsTheBodyWithoutRouteKeys(): void {
        $route = ['id' => '7', '_route' => 'knorke.sync.sync'];
        $body = JsonBody::read(self::request($route, ['proto' => 1, 'client' => 'c1']), ['proto', 'client']);
        $this->assertSame(['proto' => 1, 'client' => 'c1'], $body);
    }

    public function testRouteKeyEqualToTheRouteIsTolerated(): void {
        $route = ['id' => '7', '_route' => 'x'];
        $this->assertSame([], JsonBody::read(self::request($route, ['id' => '7']), []));
    }

    public function testLengthRequired(): void {
        $this->expectError(411, 'length_required', fn () => JsonBody::read(self::request([], ['a' => 1], null), ['a']));
        $this->expectError(411, 'length_required', fn () => JsonBody::read(self::request([], ['a' => 1], 'abc'), ['a']));
        $this->expectError(411, 'length_required', fn () => JsonBody::read(self::request([], ['a' => 1], '-1'), ['a']));
    }

    public function testTooLarge(): void {
        $this->expectError(413, 'too_large', fn () => JsonBody::read(self::request([], [], '1048577'), []));
        $this->expectError(413, 'too_large', fn () => JsonBody::read(self::request([], [], '99999999999999999999999'), []));
        $this->assertSame([], JsonBody::read(self::request([], [], '1048576'), []));
        $this->expectError(413, 'too_large', fn () => JsonBody::read(self::request([], [], '11'), [], 10));
    }

    public function testBrokenJson(): void {
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request([], null, '5', new \JsonException('Syntax error')), []));
    }

    public function testUnknownKey(): void {
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request(['id' => '7'], ['proto' => 1, 'foo' => 1]), ['proto']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request([], ['title' => 'x'], '10', null, ['debug' => '1']), ['title']), );
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request([], [0 => 'x']), ['0']));
    }

    public function testBodyOverridingTheRoute(): void {
        $route = ['id' => '7', '_route' => 'knorke.sync.sync'];
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request($route, ['id' => 8]), ['proto']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request($route, ['id' => 7]), ['proto']), );
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request($route, ['_route' => 'x']), ['proto']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::read(self::request(['token' => str_repeat('a', 24)], ['token' => str_repeat('b', 24)]), ['name']));
    }

    public function testGuardRouteForBodilessRoutes(): void {
        $route = ['id' => '7', '_route' => 'knorke.boardApi.destroy'];
        $this->assertSame($route, JsonBody::guardRoute(self::request($route, null, null)), 'no Content-Length needed');
        $this->expectError(400, 'bad_request', fn () => JsonBody::guardRoute(self::request($route, ['id' => 9], null)));
        $this->assertSame([], JsonBody::guardRoute(Fake::of(IRequest::class, [], ['urlParams' => null])));
    }

    public function testQueryReturnsTheAllowedParameters(): void {
        $route = ['id' => '7', '_route' => 'knorke.shareApi.sharees'];
        $this->assertSame(['q' => 'ali'], JsonBody::query(self::request($route, null, null, null, ['q' => 'ali']), ['q']), 'no Content-Length needed');
        $this->assertSame([], JsonBody::query(self::request($route, null, null), ['q']), 'parameters are optional');
        $this->assertSame(['q' => ''], JsonBody::query(self::request($route, null, null, null, ['q' => '']), ['q']));
        $q = str_repeat('ä', 100);
        $this->assertSame(['q' => $q], JsonBody::query(self::request($route, null, null, null, ['q' => $q]), ['q']), '200 bytes are fine');
    }

    public function testQueryRejects(): void {
        $route = ['id' => '7', '_route' => 'knorke.shareApi.sharees'];
        // Unknown parameter, among them the Circles switch shareType (§4.1).
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, null, null, null, ['shareType' => '7']), ['q']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, null, null, null, ['q' => 'a', 'limit' => '99']), ['q']));
        // Not a string, or longer than 200 bytes.
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, null, null, null, ['q' => ['a', 'b']]), ['q']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, null, null, null, ['q' => str_repeat('a', 201)]), ['q']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, null, null, null, ['q' => str_repeat('ä', 101)]), ['q']));
        // A body sent anyway: its keys count like query parameters, and it may not override the route.
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, ['q' => 5]), ['q']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, ['id' => '8']), ['q']));
        $this->expectError(400, 'bad_request', fn () => JsonBody::query(self::request($route, null, '5', new \JsonException('Syntax error')), ['q']));
        $this->assertSame(200, JsonBody::QUERY_MAX_BYTES);
    }
}
