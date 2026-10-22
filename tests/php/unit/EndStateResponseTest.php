<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\PublicSyncController;
use OCA\Knorke\Controller\SyncController;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\RawJsonResponse;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\AccessResult;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Service\SyncService;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * End states with HTTP 200 (SPEC-M1 §1.2 (R23), §34 D8; factory job 028).
 * Routes 13 (sync#sync), 14 (publicSync#join) and 16 (publicSync#sync): a
 * request with `X-Knorke-End-State: 1` whose handler ends in an HttpError
 * with status 401/403 and a code of {guest_token, not_logged_in,
 * link_revoked, link_expired, links_disabled} answers 200 {"end", "message"}
 * — exactly these two keys, no Retry-After. Without the header, with any
 * other value, with another code (password_required/_wrong, cross_site,
 * not_found, protocol …) or on another route: the error form as before.
 * The checks before Access (refuseCrossSite, the body with 409 protocol
 * first) keep their order: Access is not reached.
 */
final class EndStateResponseTest extends TestCase {
    private const LINK = 'Ab3dEf6hIj9kLm2nOp5qRs8t';
    private const SYNC_BODY = ['proto' => 2, 'client' => 'cK3j9aZp2Q', 'since' => 0, 'ep' => 'k3x9a0b2'];
    private const JOIN_BODY = ['client' => 'cK3j9aZp2Q', 'name' => 'Gina', 'guest' => null];
    /** The end states of the app on these routes, with the status they had before. */
    private const END = [[401, 'guest_token'], [403, 'link_revoked'], [403, 'link_expired'], [403, 'links_disabled']];

    /** @var list<string> calls of the Access stand-in */
    public array $calls = [];
    /** What the Access stand-in throws (null: it lets the request through). */
    public ?\Throwable $refuse = null;

    /** @internal called by the Access stand-in */
    public function accessCall(string $call): void {
        $this->calls[] = $call;
        if ($this->refuse !== null) {
            throw $this->refuse;
        }
    }

    /** A header set on the response itself (Response::getHeaders() needs a running server). */
    private static function header(Response $r, string $name): ?string {
        $p = new \ReflectionProperty(Response::class, 'headers');
        return $p->getValue($r)[$name] ?? null;
    }

    private function access(): Access {
        return new class($this) extends Access {
            public function __construct(private EndStateResponseTest $test) {
            }

            public function forGuest(#[\SensitiveParameter] string $token, int $board, bool $full = false): AccessResult {
                $this->test->accessCall('forGuest');
                return new AccessResult(new Principal('g:gAbcdEfgh123', Role::Edit, 'Gina', '0123456789abcdef', true, null, 'guest'), 3, 0, 2);
            }

            public function forGuestWithRow(#[\SensitiveParameter] string $token, int $board): array {
                $this->test->accessCall('forGuestWithRow');
                return [new AccessResult(new Principal('g:gAbcdEfgh123', Role::Edit, 'Gina', '0123456789abcdef', true, null, 'guest'), 3, 0, 2), ['id' => 7, 'schema_version' => 1]];
            }

            public function forUser(int $board, bool $full = false): AccessResult {
                $this->test->accessCall('forUser');
                return new AccessResult(new Principal('u:alice', Role::Owner, 'Alice', '0123456789abcdef', false, 'alice', 'owner'), 3, 0, 2);
            }

            public function forUserWithRow(int $board): array {
                $this->test->accessCall('forUserWithRow');
                return [new AccessResult(new Principal('u:alice', Role::Owner, 'Alice', '0123456789abcdef', false, 'alice', 'owner'), 3, 0, 2), ['id' => 7, 'owner' => 'alice', 'schema_version' => 1]];
            }

            public function joinGuest(
                #[\SensitiveParameter] string $linkToken,
                #[\SensitiveParameter] string $name,
                #[\SensitiveParameter] ?string $existing,
                string $ip,
                #[\SensitiveParameter] ?string $password = null,
            ): array {
                $this->test->accessCall('joinGuest');
                $p = new Principal('g:gAbcdEfgh123', Role::Edit, 'Gina', '0123456789abcdef', true, null, 'guest');
                return [new AccessResult($p, 3, 0, 2), 'guest.token', 1700000000, ['id' => 7, 'schema_version' => 1]];
            }
        };
    }

    private static function sync(): SyncService {
        return new class() extends SyncService {
            public function __construct() {
            }

            public function sync(AccessResult $a, int $board, SyncRequest $r, int $nowMs): string {
                return '{"rev":3}';
            }

            public function snapshotJson(AccessResult $a, int $board, array $boardMeta, ?array $guest = null, ?int $nowMs = null): string {
                return '{"proto":2,"guest":' . json_encode($guest) . '}';
            }
        };
    }

    /**
     * The request as OC\AppFramework\Http\Request gives it: route parameters,
     * the decoded body merged over them, headers case-insensitive.
     *
     * @param array<string, string> $headers
     * @param array<string, mixed> $body
     * @param array<string, string> $route
     */
    private static function request(array $headers, array $body, array $route): IRequest {
        $params = array_merge($route, $body);
        $h = array_change_key_case($headers + ['Content-Length' => (string)strlen((string)json_encode($body))], CASE_LOWER);
        return Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => $h[strtolower($name)] ?? '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
            'getRemoteAddress' => fn (): string => '10.1.2.3',
        ], ['urlParams' => $route]);
    }

    /**
     * @param array<string, string|null> $headers header => value, null leaves a default out
     * @return array<string, string>
     */
    private static function guestHeaders(array $headers): array {
        return array_filter($headers + ['X-Requested-With' => 'XMLHttpRequest', PublicSyncController::GUEST_HEADER => 'tok'], static fn ($v) => $v !== null);
    }

    /** Route 16 with these headers and body. */
    private function guestSync(array $headers, array $body = self::SYNC_BODY): Response {
        $req = self::request(self::guestHeaders($headers), $body, ['id' => '7', '_route' => 'knorke.publicSync.sync']);
        return (new PublicSyncController($req, $this->access(), self::sync(), Fake::of(LoggerInterface::class)))->sync(7);
    }

    /** Route 14 with these headers. */
    private function guestJoin(array $headers): Response {
        $req = self::request(self::guestHeaders($headers + [PublicSyncController::GUEST_HEADER => null]), self::JOIN_BODY, ['token' => self::LINK, '_route' => 'knorke.publicSync.join']);
        return (new PublicSyncController($req, $this->access(), self::sync(), Fake::of(LoggerInterface::class)))->join(self::LINK);
    }

    /** Route 15 with these headers. */
    private function guestSnapshot(array $headers): Response {
        $req = self::request(self::guestHeaders($headers), [], ['id' => '7', '_route' => 'knorke.publicSync.snapshot']);
        return (new PublicSyncController($req, $this->access(), self::sync(), Fake::of(LoggerInterface::class)))->snapshot(7);
    }

    private function userController(array $headers, array $body, string $route): SyncController {
        $req = self::request($headers + ['requesttoken' => 'csrf'], $body, ['id' => '7', '_route' => 'knorke.sync.' . $route]);
        $boards = new class() extends BoardService {
            public function __construct() {
            }
        };
        $policy = new class() extends SharePolicy {
            public function __construct() {
            }
        };
        return new SyncController($req, $this->access(), self::sync(), $boards, Fake::of(LoggerInterface::class), $policy);
    }

    /** The end answer: 200, JSON, exactly {end, message}, no Retry-After. */
    private function assertEnd(Response $r, string $code, string $message, string $label): void {
        $this->assertInstanceOf(JSONResponse::class, $r, $label);
        $this->assertSame(200, $r->getStatus(), $label);
        $this->assertSame(['end' => $code, 'message' => $message], $r->getData(), $label . ': exactly end and message, in this order');
        $this->assertStringStartsWith('application/json', (string)self::header($r, 'Content-Type'), $label);
        $this->assertNull(self::header($r, 'Retry-After'), $label);
    }

    /** The error form as before. */
    private function assertError(Response $r, int $status, string $code, string $label): void {
        $this->assertSame($status, $r->getStatus(), $label);
        $this->assertInstanceOf(JSONResponse::class, $r, $label);
        $data = $r->getData();
        $this->assertSame($code, $data['error'] ?? null, $label);
        $this->assertIsString($data['message'] ?? null, $label);
        $this->assertArrayNotHasKey('end', $data, $label);
    }

    public function testRoute16EndStatesWithTheHeaderAnswer200(): void {
        foreach (self::END as [$status, $code]) {
            $this->refuse = new HttpError($status, $code);
            $this->assertEnd($this->guestSync([PublicSyncController::END_STATE_HEADER => '1']), $code, (string)HttpError::messageFor($code), "route 16 $status $code");
        }
        $this->assertSame(array_fill(0, 4, 'forGuest'), $this->calls, 'the same checks as before: the guest token check ran');
    }

    public function testRoute16WithoutTheHeaderOrAnotherValueAnswersAsBefore(): void {
        foreach ([null, '0', 'true', '', ' 1', '01', 'yes'] as $value) {
            foreach (self::END as [$status, $code]) {
                $this->refuse = new HttpError($status, $code);
                $headers = $value === null ? [] : [PublicSyncController::END_STATE_HEADER => $value];
                $r = $this->guestSync($headers);
                $label = "route 16 $status $code, header " . var_export($value, true);
                $this->assertError($r, $status, $code, $label);
                $this->assertSame(['error' => $code, 'message' => HttpError::messageFor($code)], $r->getData(), $label);
            }
        }
    }

    public function testRoute16OtherAnswersStayWithTheHeader(): void {
        $h = [PublicSyncController::END_STATE_HEADER => '1'];
        $this->refuse = new HttpError(404, 'not_found');
        $r = $this->guestSync($h);
        $this->assertSame(['error' => 'not_found', 'message' => 'Not found.'], $r->getData());
        $this->assertSame(404, $r->getStatus());
        $this->calls = [];
        $this->refuse = new HttpError(403, 'link_revoked');
        $r = $this->guestSync($h, ['proto' => 1] + self::SYNC_BODY);
        $this->assertSame(409, $r->getStatus(), 'an old protocol still gets 409 first');
        $this->assertSame(['error' => 'protocol', 'message' => 'Outdated client, please reload.', 'proto' => 2], $r->getData());
        $r = $this->guestSync($h + ['X-Requested-With' => null]);
        $this->assertError($r, 403, 'cross_site', 'no X-Requested-With');
        $r = $this->guestSync($h + ['X-Requested-With' => null, 'Sec-Fetch-Site' => 'cross-site']);
        $this->assertError($r, 403, 'cross_site', 'Sec-Fetch-Site cross-site');
        $this->assertSame([], $this->calls, 'Access is not called after 409 or cross_site');
        // an end code with another status is no end state; an unexpected error stays 500
        $this->refuse = new HttpError(404, 'link_revoked');
        $this->assertError($this->guestSync($h), 404, 'link_revoked', '404 with an end code');
        $this->refuse = new \RuntimeException('boom');
        $this->assertError($this->guestSync($h), 500, 'internal', 'unexpected error');
        // and a normal answer is the normal answer
        $this->refuse = null;
        $r = $this->guestSync($h);
        $this->assertInstanceOf(RawJsonResponse::class, $r);
        $this->assertSame(200, $r->getStatus());
    }

    public function testRoute14EndStatesWithTheHeader(): void {
        $h = [PublicSyncController::END_STATE_HEADER => '1'];
        foreach (['link_revoked', 'link_expired', 'links_disabled'] as $code) {
            $this->refuse = new HttpError(403, $code);
            $this->assertEnd($this->guestJoin($h), $code, (string)HttpError::messageFor($code), "route 14 403 $code");
        }
        foreach (['password_required', 'password_wrong'] as $code) {
            $this->refuse = new HttpError(403, $code);
            $r = $this->guestJoin($h);
            $this->assertError($r, 403, $code, "route 14 $code stays 403 (password guessing stays visible to the edge)");
            $this->assertSame(['error' => $code, 'message' => HttpError::messageFor($code)], $r->getData());
        }
        $this->refuse = new HttpError(429, 'slow_down', '', ['retryMs' => 600000, 'reason' => 'password']);
        $r = $this->guestJoin($h);
        $this->assertSame(429, $r->getStatus());
        $this->assertSame(['error' => 'slow_down', 'message' => 'Too many requests, please wait a moment.', 'retryMs' => 600000, 'reason' => 'password'], $r->getData());
        $this->assertSame('600', self::header($r, 'Retry-After'));
        $this->refuse = new HttpError(404, 'not_found');
        $this->assertError($this->guestJoin($h), 404, 'not_found', 'route 14 404');
        $this->refuse = new HttpError(400, 'name_required');
        $this->assertError($this->guestJoin($h), 400, 'name_required', 'route 14 400');
        $this->assertSame(array_fill(0, 8, 'joinGuest'), $this->calls);
        // the cross-site guard comes first, also with the header
        $this->calls = [];
        $this->refuse = new HttpError(403, 'link_revoked');
        $this->assertError($this->guestJoin($h + ['X-Requested-With' => null, 'Sec-Fetch-Site' => 'cross-site']), 403, 'cross_site', 'route 14 cross-site');
        $this->assertSame([], $this->calls);
        // a join that works answers the snapshot with the guest token, as without the header
        $this->refuse = null;
        $with = $this->guestJoin($h);
        $without = $this->guestJoin([]);
        $this->assertInstanceOf(RawJsonResponse::class, $with);
        $this->assertSame([200, 200], [$with->getStatus(), $without->getStatus()]);
        $this->assertSame($without->render(), $with->render());
        $this->assertStringContainsString('"token":"guest.token"', $with->render());
    }

    public function testRoute14WithoutTheHeaderAnswersAsBefore(): void {
        foreach ([null, '0', 'true'] as $value) {
            $headers = $value === null ? [] : [PublicSyncController::END_STATE_HEADER => $value];
            foreach ([[403, 'link_revoked'], [403, 'link_expired'], [403, 'links_disabled'], [403, 'password_required'], [403, 'password_wrong'], [404, 'not_found'], [400, 'name_required']] as [$status, $code]) {
                $this->refuse = new HttpError($status, $code);
                $r = $this->guestJoin($headers);
                $label = "route 14 $status $code, header " . var_export($value, true);
                $this->assertError($r, $status, $code, $label);
                $this->assertSame(['error' => $code, 'message' => HttpError::messageFor($code)], $r->getData(), $label);
            }
            $this->refuse = new HttpError(429, 'slow_down', '', ['retryMs' => 600000, 'reason' => 'password']);
            $r = $this->guestJoin($headers);
            $this->assertSame([429, '600', 'password'], [$r->getStatus(), self::header($r, 'Retry-After'), $r->getData()['reason'] ?? null]);
        }
    }

    public function testRoute13NotLoggedInWithTheHeader(): void {
        $h = [PublicSyncController::END_STATE_HEADER => '1'];
        $this->refuse = new HttpError(401, 'not_logged_in', 'Not logged in.');
        $this->assertEnd($this->userController($h, self::SYNC_BODY, 'sync')->sync(7), 'not_logged_in', 'Not logged in.', 'route 13 401 not_logged_in');
        $this->refuse = new HttpError(404, 'not_found');
        $r = $this->userController($h, self::SYNC_BODY, 'sync')->sync(7);
        $this->assertSame([404, ['error' => 'not_found', 'message' => 'Not found.']], [$r->getStatus(), $r->getData()]);
        foreach ([[], [PublicSyncController::END_STATE_HEADER => '0'], [PublicSyncController::END_STATE_HEADER => 'true']] as $headers) {
            $this->refuse = new HttpError(401, 'not_logged_in', 'Not logged in.');
            $r = $this->userController($headers, self::SYNC_BODY, 'sync')->sync(7);
            $this->assertSame([401, ['error' => 'not_logged_in', 'message' => 'Not logged in.']], [$r->getStatus(), $r->getData()], 'without the header as before');
        }
        $this->refuse = null;
        $r = $this->userController($h, self::SYNC_BODY, 'sync')->sync(7);
        $this->assertSame([200, '{"rev":3}'], [$r->getStatus(), $r->render()]);
        $this->assertSame(['forUser', 'forUser', 'forUser', 'forUser', 'forUser', 'forUser'], $this->calls);
    }

    public function testSnapshotRoutesKeepTheirErrorsWithTheHeader(): void {
        $h = [PublicSyncController::END_STATE_HEADER => '1'];
        $this->refuse = new HttpError(403, 'link_revoked');
        $this->assertError($this->guestSnapshot($h), 403, 'link_revoked', 'route 15');
        $this->refuse = new HttpError(401, 'guest_token');
        $this->assertError($this->guestSnapshot($h), 401, 'guest_token', 'route 15');
        $this->refuse = new HttpError(401, 'not_logged_in', 'Not logged in.');
        $this->assertError($this->userController($h, [], 'snapshot')->snapshot(7), 401, 'not_logged_in', 'route 12');
    }
}
