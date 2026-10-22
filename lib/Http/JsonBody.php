<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Http;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Limits;
use OCP\IRequest;

/**
 * The only way a controller reads a request body (SPEC-M0 §4.1, R2). Values
 * are raw here; the caller passes each through Input::*.
 *
 *  1. Content-Length missing or not numeric → 411 length_required (a chunked
 *     body would dodge the size check); larger than $maxBytes → 413 too_large.
 *  2. Broken JSON → 400 bad_request.
 *  3. Nextcloud merges the JSON body AFTER the route parameters into
 *     getParams(): a body key `id` or `token` would override the route value,
 *     even in the controller's method argument. Every key of $r->urlParams
 *     (including `_route`) must therefore still have its route value → 400.
 *  4. Body = getParams() without the route keys; any key outside $allowed
 *     (query parameters included) → 400.
 *
 * query() is the same gate for the GET parameters of a route without a body
 * (SPEC-M1 §4.1, route 21 `?q=`): steps 2 and 3 apply, every parameter
 * outside $allowed → 400, values only strings of at most QUERY_MAX_BYTES.
 */
final class JsonBody {
    /** Longest accepted value of a query parameter (bytes, SPEC-M1 §4.1). */
    public const QUERY_MAX_BYTES = 200;

    /**
     * @param list<string> $allowed
     * @return array<string, mixed>
     * @throws HttpError 400|411|413
     */
    public static function read(IRequest $r, array $allowed, int $maxBytes = Limits::MAX_BODY_BYTES): array {
        $len = $r->getHeader('Content-Length');
        if ($len === '' || !ctype_digit($len)) {
            throw new HttpError(411, 'length_required');
        }
        if (strlen(ltrim($len, '0')) > 15 || (int)$len > $maxBytes) {
            throw new HttpError(413, 'too_large');
        }
        $params = $r->getParams();
        try {
            $r->throwDecodingExceptionIfAny();
        } catch (\JsonException) {
            throw new HttpError(400, 'bad_request', 'The request body is not valid JSON.');
        }
        $route = self::guardRoute($r);
        $body = array_diff_key($params, $route);
        foreach (array_keys($body) as $k) {
            if (!is_string($k) || !in_array($k, $allowed, true)) {
                throw new HttpError(400, 'bad_request', 'Unknown field in the request body.');
            }
        }
        return $body;
    }

    /**
     * The GET parameters of a request (SPEC-M1 §4.1, JsonBody::query): the
     * route parameters may not be overridden (step 3), any other parameter —
     * from the query string or a body sent anyway — must be in $allowed and a
     * string of at most QUERY_MAX_BYTES bytes. No Content-Length is needed.
     *
     * Name parameters for what they are and never `shareType`: the Circles
     * search plugin reads that request parameter itself and switches to its
     * expensive search over foreign open teams (SPEC-M1 §4.1).
     *
     * @param list<string> $allowed
     * @return array<string, string>
     * @throws HttpError 400
     */
    public static function query(IRequest $r, array $allowed): array {
        $params = $r->getParams();
        try {
            $r->throwDecodingExceptionIfAny();
        } catch (\JsonException) {
            throw new HttpError(400, 'bad_request', 'The request body is not valid JSON.');
        }
        $route = self::guardRoute($r);
        $query = array_diff_key($params, $route);
        foreach ($query as $k => $v) {
            if (!is_string($k) || !in_array($k, $allowed, true)) {
                throw new HttpError(400, 'bad_request', 'Unknown query parameter.');
            }
            if (!is_string($v) || strlen($v) > self::QUERY_MAX_BYTES) {
                throw new HttpError(400, 'bad_request', 'Invalid query parameter.');
            }
        }
        return $query;
    }

    /**
     * Step 3 alone, for routes without a body (DELETE, GET snapshot): a JSON
     * body sent anyway must not replace {id}/{token} in the method argument.
     *
     * @return array<string, mixed> the route parameters
     * @throws HttpError 400
     */
    public static function guardRoute(IRequest $r): array {
        // Magic property of OC\AppFramework\Http\Request (route match incl. _route).
        $route = $r->urlParams;
        if (!is_array($route)) {
            return [];
        }
        foreach ($route as $k => $v) {
            if ($r->getParam((string)$k) !== $v) {
                throw new HttpError(400, 'bad_request', 'The body must not override route parameters.');
            }
        }
        return $route;
    }
}
