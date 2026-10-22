<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\RawJsonResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;

/**
 * Shared answer helpers of the API controllers (SPEC-M0 §4.2).
 *
 * run(): HttpError → the app's error form {"error": code, "message": text}
 * with its status; any other \Throwable is logged (never with tokens: the
 * token parameters carry #[\SensitiveParameter]) and answers 500 `internal`.
 *
 * End states with HTTP 200 (SPEC-M1 §1.2 (R23), §34 D8; only routes 13, 14
 * and 16 ask for it with run(…, endStates: true)): a client that sends
 * `X-Knorke-End-State: 1` gets the end of its session — an HttpError with
 * status 401 or 403 and a code of END_STATES — as 200 {"end": code,
 * "message": text}. Edge ban rules (CrowdSec http-generic-403-bf/-401-bf,
 * fail2ban, a WAF) count 401/403, and after a revoked link every open guest
 * tab sent two of them (sync, re-join). The answer is chosen after the
 * handler ended: the checks, their order and their side effects stay the
 * same. Without the header (old bundles, a proxy that drops it) or with any
 * other value: the error form as before. password_required and
 * password_wrong are no end states on purpose: guessing a link password
 * stays a 403 the edge can throttle.
 *
 * The using class provides $this->request (Controller) and $this->logger.
 */
trait ApiResponses {
    /** Request header of a client that reads end states in a 200 body (value exactly "1"). */
    public const END_STATE_HEADER = 'X-Knorke-End-State';

    /** Codes answered as end state (only with status 401 or 403). */
    private const END_STATES = ['guest_token', 'not_logged_in', 'link_revoked', 'link_expired', 'links_disabled'];

    /**
     * @param callable(): Response $fn
     * @param bool $endStates the route answers end states with 200 when the request asks for it (see above)
     */
    protected function run(callable $fn, bool $endStates = false): Response {
        try {
            return $fn();
        } catch (HttpError $e) {
            return ($endStates ? $this->endStateResponse($e) : null) ?? $this->errorResponse($e);
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: unexpected error in ' . static::class, ['exception' => $e, 'app' => 'knorke']);
            return $this->errorResponse(new HttpError(500, 'internal'));
        }
    }

    /**
     * Guard of every public POST, before any lookup (§4.2, Pulse port):
     * #[NoCSRFRequired] switched Nextcloud's CSRF check off, so the request
     * must prove it comes from a script of this origin — `X-Requested-With:
     * XMLHttpRequest` (a form cannot set it, a cross-origin fetch needs a
     * preflight Nextcloud does not grant) or `Sec-Fetch-Site` same-origin/none.
     *
     * @throws HttpError 403 cross_site
     */
    protected function refuseCrossSite(): void {
        $request = $this->request;
        if (!$request instanceof IRequest) {
            throw new HttpError(403, 'cross_site');
        }
        if (strcasecmp($request->getHeader('X-Requested-With'), 'XMLHttpRequest') === 0) {
            return;
        }
        $site = strtolower($request->getHeader('Sec-Fetch-Site'));
        if ($site === 'same-origin' || $site === 'none') {
            return;
        }
        throw new HttpError(403, 'cross_site');
    }

    protected function json(array $data, int $status = 200): JSONResponse {
        return new JSONResponse($data, $status);
    }

    protected function raw(string $json, int $status = 200): RawJsonResponse {
        return new RawJsonResponse($json, $status);
    }

    /**
     * 200 {"end": code, "message": text} for an end state (status 401 or 403,
     * code in END_STATES) when the request carries `X-Knorke-End-State: 1`;
     * null otherwise (the caller answers the error form). Exactly these two
     * keys, no extra fields, no Retry-After.
     */
    protected function endStateResponse(HttpError $e): ?JSONResponse {
        if (($e->status !== 401 && $e->status !== 403) || !in_array($e->error, self::END_STATES, true)) {
            return null;
        }
        $request = $this->request;
        if (!$request instanceof IRequest || $request->getHeader(self::END_STATE_HEADER) !== '1') {
            return null;
        }
        return new JSONResponse(['end' => $e->error, 'message' => $e->getMessage()], 200);
    }

    /** The error form with its status; an error with retryMs (slow_down) also sets Retry-After (SPEC-M1 §4.2). */
    protected function errorResponse(HttpError $e): JSONResponse {
        $response = new JSONResponse($e->payload(), $e->status);
        $retry = $e->retryAfterSeconds();
        if ($retry !== null) {
            $response->addHeader('Retry-After', (string)$retry);
        }
        return $response;
    }

    /** Milliseconds since the epoch. */
    protected static function nowMs(): int {
        return (int)floor(microtime(true) * 1000);
    }
}
