<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\ApiResponses;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * The error codes of SPEC-M1 §4.2 (frozen from stage 0 on) and the extra
 * body fields some of them carry (`at`, `max`, `maxDays`, `retryMs`,
 * `proto`), plus Retry-After for slow_down.
 */
final class HttpErrorTest extends TestCase {
    /** Every code of SPEC-M0 §4.2 and SPEC-M1 §4.2, plus the codes of route 27 (M2). */
    private const CODES = [
        'bad_request', 'too_many_ops', 'name_required', 'title_required', 'guest_token', 'forbidden', 'link_revoked',
        'links_disabled', 'cross_site', 'not_found', 'protocol', 'length_required', 'too_large', 'rate_limited', 'internal',
        'not_implemented',
        'password_enforced', 'password_policy', 'expiry_required', 'expiry_too_far', 'expiry_past', 'group_sharing_disabled',
        'teams_unavailable', 'group_members_only', 'recipient_not_found', 'self_share', 'too_many_shares', 'too_many_new_shares',
        'vote_config', 'meta_too_large', 'sharing_disabled', 'password_required', 'password_wrong', 'link_expired', 'vote_open',
        'vote_closed', 'timer_state', 'slow_down',
        // M2 privacy notice (route 27)
        'text_too_long', 'invalid_url', 'unknown_language', 'too_many_languages',
    ];

    public function testEveryCodeHasAnEnglishMessage(): void {
        foreach (self::CODES as $code) {
            $m = HttpError::messageFor($code);
            $this->assertNotNull($m, $code);
            $this->assertMatchesRegularExpression('/^[A-Z][\x20-\x7E]*\.$/', $m, "$code: one plain English sentence");
            $this->assertSame($m, (new HttpError(400, $code))->getMessage());
        }
        $this->assertNull(HttpError::messageFor('nope'));
        $this->assertSame('nope', (new HttpError(400, 'nope'))->getMessage(), 'unknown code: the code itself');
    }

    public function testPayloadWithExtraFields(): void {
        $this->assertSame(['error' => 'bad_request', 'message' => 'Bad request.'], (new HttpError(400, 'bad_request'))->payload());
        $e = new HttpError(400, 'too_many_new_shares', '', ['at' => 20, 'max' => 20]);
        $this->assertSame(['error' => 'too_many_new_shares', 'message' => 'Too many new recipients at once.', 'at' => 20, 'max' => 20], $e->payload());
        $e = new HttpError(409, 'protocol', '', ['proto' => 2]);
        $this->assertSame(['error' => 'protocol', 'message' => 'Outdated client, please reload.', 'proto' => 2], $e->payload());
        $e = new HttpError(400, 'expiry_too_far', 'Too far.', ['maxDays' => 7, 'error' => 'x', 'message' => 'y']);
        $this->assertSame(['error' => 'expiry_too_far', 'message' => 'Too far.', 'maxDays' => 7], $e->payload(), 'extra never replaces error/message');
    }

    public function testRetryAfter(): void {
        $this->assertNull((new HttpError(429, 'rate_limited'))->retryAfterSeconds());
        $this->assertSame(2, (new HttpError(429, 'slow_down', '', ['retryMs' => 2000]))->retryAfterSeconds());
        $this->assertSame(3, (new HttpError(429, 'slow_down', '', ['retryMs' => 2001]))->retryAfterSeconds(), 'rounded up');
        $this->assertSame(1, (new HttpError(429, 'slow_down', '', ['retryMs' => 1]))->retryAfterSeconds());
        $this->assertNull((new HttpError(429, 'slow_down', '', ['retryMs' => -5]))->retryAfterSeconds());

        $c = new class() {
            use ApiResponses;

            public mixed $request = null;
            public mixed $logger = null;

            public function answer(HttpError $e): Response {
                return $this->errorResponse($e);
            }
        };
        $c->request = Fake::of(IRequest::class);
        $c->logger = Fake::of(LoggerInterface::class);
        // Response::getHeaders() needs a running server; the headers set on the response itself:
        $headers = static fn (Response $r): array => (new \ReflectionProperty(Response::class, 'headers'))->getValue($r);
        $r = $c->answer(new HttpError(429, 'slow_down', '', ['retryMs' => 2000]));
        $this->assertSame(429, $r->getStatus());
        $this->assertSame('2', $headers($r)['Retry-After'] ?? null);
        $this->assertSame(['error' => 'slow_down', 'message' => 'Too many requests, please wait a moment.', 'retryMs' => 2000], $r->getData());
        $r = $c->answer(new HttpError(404, 'not_found'));
        $this->assertArrayNotHasKey('Retry-After', $headers($r));
    }
}
