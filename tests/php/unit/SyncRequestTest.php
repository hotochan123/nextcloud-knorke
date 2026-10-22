<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Tests\Support\Fake;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

/**
 * SyncRequest of protocol 2 (SPEC-M1 §4.3, §4.5, §9.7): the allowed keys,
 * `ep` required, `proto` checked FIRST (a protocol-1 tab without `ep` gets
 * 409, not 400), `role` and `vt` accepted from stage 0 on.
 */
final class SyncRequestTest extends TestCase {
    private const EP = 'k3x9a0b2';

    /** @return array<string, mixed> a valid minimal protocol-2 body plus $extra */
    private static function body(array $extra = []): array {
        return $extra + ['proto' => Application::PROTOCOL, 'client' => 'c1', 'since' => 0, 'ep' => self::EP];
    }

    private function expectError(int $status, string $code, array $body): void {
        try {
            SyncRequest::fromBody($body);
            $this->fail('expected ' . $status . ' ' . $code . ' for ' . json_encode($body));
        } catch (HttpError $e) {
            $this->assertSame([$status, $code], [$e->status, $e->error], json_encode($body));
        }
    }

    public function testProtocolTwoAndAllowedKeys(): void {
        $this->assertSame(2, Application::PROTOCOL);
        $this->assertSame(['proto', 'client', 'since', 'ep', 'role', 'seq', 'ops', 'me', 'pres', 'vt'], SyncRequest::ALLOWED);
        $this->assertSame(['owner', 'moderate', 'edit', 'vote', 'view'], SyncRequest::ACCESS_LEVELS);
    }

    public function testProtoIsCheckedBeforeEp(): void {
        // A protocol-1 tab of M0 in the upgrade window: no ep → 409 (reload), never 400.
        $this->expectError(409, 'protocol', ['proto' => 1, 'client' => 'c1', 'since' => 0]);
        $this->expectError(409, 'protocol', ['proto' => 1, 'client' => '1bad', 'since' => -1]);
        $this->expectError(409, 'protocol', ['client' => 'c1', 'since' => 0]);
        $this->expectError(409, 'protocol', ['proto' => '2', 'client' => 'c1', 'since' => 0, 'ep' => self::EP]);
        $this->expectError(409, 'protocol', ['proto' => 3, 'client' => 'c1', 'since' => 0, 'ep' => self::EP]);
        // Protocol 2 without ep → 400.
        $this->expectError(400, 'bad_request', ['proto' => 2, 'client' => 'c1', 'since' => 0]);
        $this->expectError(400, 'bad_request', ['proto' => 2, 'client' => '1bad', 'since' => 0]);
    }

    public function testProtocolErrorCarriesTheServerVersion(): void {
        // SPEC-M1 §4.2/§4.3 (deviation from M0): the 409 body has "proto" — the
        // client keeps it as its reload marker (one reload per server version).
        try {
            SyncRequest::fromBody(['proto' => 1, 'client' => 'c1', 'since' => 0]);
            $this->fail('409 expected');
        } catch (HttpError $e) {
            $this->assertSame([409, ['error' => 'protocol', 'message' => 'Outdated client, please reload.', 'proto' => 2]], [$e->status, $e->payload()]);
            $this->assertNull($e->retryAfterSeconds());
        }
    }

    public function testEpFormat(): void {
        foreach (['', 'K3X9', 'k3x9-a0', str_repeat('a', 17), 12345678, null, ['a']] as $ep) {
            $this->expectError(400, 'bad_request', self::body(['ep' => $ep]));
        }
        foreach (['0', 'k3x9a0b2', str_repeat('z', 16)] as $ep) {
            $this->assertSame($ep, SyncRequest::fromBody(self::body(['ep' => $ep]))->epoch);
        }
    }

    public function testM0RulesStay(): void {
        $cases = [
            [['client' => '1abc'], 400, 'bad_request'],
            [['client' => str_repeat('c', 17)], 400, 'bad_request'],
            [['since' => -1], 400, 'bad_request'],
            [['ops' => ['o' => 'x']], 400, 'bad_request'],
            [['ops' => [['o' => 'remove']]], 400, 'bad_request'],
            [['ops' => array_fill(0, 201, [])], 400, 'too_many_ops'],
            [['me' => 'x'], 400, 'bad_request'],
            [['pres' => 'maybe'], 400, 'bad_request'],
        ];
        foreach ($cases as [$extra, $status, $code]) {
            $this->expectError($status, $code, self::body($extra));
        }
        $body = self::body();
        unset($body['since']);
        $this->expectError(400, 'bad_request', $body);
    }

    public function testRoleAndVt(): void {
        foreach (SyncRequest::ACCESS_LEVELS as $role) {
            $this->assertSame($role, SyncRequest::fromBody(self::body(['role' => $role]))->role);
        }
        foreach (['admin', 'Edit', '', 3, ['edit']] as $role) {
            $this->expectError(400, 'bad_request', self::body(['role' => $role]));
        }
        foreach ([-1, 'x', true, [1], 1e19] as $vt) {
            $this->expectError(400, 'bad_request', self::body(['vt' => $vt]));
        }
        // Like since/seq (Input::int, M0): decimals truncated, numeric text accepted.
        $this->assertSame([1, 31], [SyncRequest::fromBody(self::body(['vt' => 1.5]))->voteTally, SyncRequest::fromBody(self::body(['vt' => '31']))->voteTally]);
        $r = SyncRequest::fromBody(self::body(['vt' => 31, 'role' => 'moderate']));
        $this->assertSame([31, 'moderate'], [$r->voteTally, $r->role]);
        $r = SyncRequest::fromBody(self::body(['vt' => null, 'role' => null]));
        $this->assertSame([null, null], [$r->voteTally, $r->role]);
        $this->assertSame(0, SyncRequest::fromBody(self::body(['vt' => 0]))->voteTally);
    }

    public function testParsedRequest(): void {
        $r = SyncRequest::fromBody(['proto' => 2, 'client' => 'cK3j9aZp2Q', 'since' => 5, 'pres' => 0, 'seq' => 9, 'ep' => self::EP]);
        $this->assertSame(['cK3j9aZp2Q', 5, null, [], null, false, self::EP, null, null],
            [$r->client, $r->since, $r->seq, $r->ops, $r->me, $r->wantPresence, $r->epoch, $r->role, $r->voteTally]);
        $this->assertTrue(SyncRequest::fromBody(self::body())->wantPresence, 'pres defaults to 1');
        $r = SyncRequest::fromBody(self::body(['seq' => 3, 'ops' => [['o' => 'remove', 'id' => 'x']], 'me' => ['c' => [1, 2], 'v' => [0, 0, 10, 10]]]));
        $this->assertSame([3, 1, ['c' => [1, 2], 'v' => [0, 0, 10, 10]]], [$r->seq, count($r->ops), $r->me]);
    }

    /**
     * The request SyncController (route 13) passes to fromRequest, as
     * OC\AppFramework\Http\Request gives it: route parameters, the decoded
     * body merged over them, the raw Content-Length header.
     */
    private static function request(string $raw, ?string $len): IRequest {
        $route = ['id' => '7', '_route' => 'knorke.sync.sync'];
        $params = array_merge($route, json_decode($raw, true, 512, JSON_THROW_ON_ERROR));
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? ($len ?? '') : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
        ], ['urlParams' => $route]);
    }

    public function testFromRequestCarriesTheCheckedContentLength(): void {
        // P7-D (VC-05; P7-01, SPEC-M1 §33.1 b): the daily byte quota counts the
        // raw body through bodyBytes(). fromRequest passes the Content-Length
        // JsonBody has just checked — the bytes as sent (pretty-printed,
        // multi-byte text), not a re-encoding of the decoded body.
        $raw = json_encode(self::body(['seq' => 4, 'ops' => [['o' => 'patch', 'id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 'set' => ['data.text' => 'Grüße – ✓']]], 'me' => ['c' => [1, 2]]]),
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $this->assertNotSame(strlen($raw), strlen(json_encode(json_decode($raw, true))), 'the raw text differs in length from a re-encoding');
        $r = SyncRequest::fromRequest(self::request($raw, (string)strlen($raw)));
        $this->assertSame([strlen($raw), 4, 1], [$r->bodyBytes(), $r->seq, count($r->ops)]);
        $r = SyncRequest::fromRequest(self::request($raw, (string)Limits::MAX_BODY_BYTES));
        $this->assertSame(Limits::MAX_BODY_BYTES, $r->bodyBytes(), 'the header value, up to the largest accepted body');
        // The length is the CHECKED one: JsonBody refuses before fromBody runs.
        foreach ([[null, 411, 'length_required'], ['12a', 411, 'length_required'], [(string)(Limits::MAX_BODY_BYTES + 1), 413, 'too_large']] as [$len, $status, $code]) {
            try {
                SyncRequest::fromRequest(self::request($raw, $len));
                $this->fail("expected $status $code for Content-Length " . var_export($len, true));
            } catch (HttpError $e) {
                $this->assertSame([$status, $code], [$e->status, $e->error]);
            }
        }
        // fromBody alone knows no body: 0, and never negative.
        $this->assertSame(0, SyncRequest::fromBody(self::body())->bodyBytes());
        $this->assertSame(123, SyncRequest::fromBody(self::body(), 123)->bodyBytes());
        $this->assertSame(0, SyncRequest::fromBody(self::body(), -5)->bodyBytes());
    }

    public function testConstructorSignature(): void {
        // §9.7: the frozen order of the promoted properties.
        $names = array_map(static fn (\ReflectionParameter $p): string => $p->getName(), (new \ReflectionMethod(SyncRequest::class, '__construct'))->getParameters());
        $this->assertSame(['client', 'since', 'seq', 'ops', 'me', 'wantPresence', 'epoch', 'role', 'voteTally'], $names);
    }
}
