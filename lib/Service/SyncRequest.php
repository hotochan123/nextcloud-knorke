<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCP\IRequest;

/**
 * A checked POST …/sync request (SPEC-M0 §4.5, protocol 2: SPEC-M1 §4.5):
 *
 *   {"proto": 2, "client": "cK3j9aZp2Q", "since": 42, "ep": "k3x9a0b2", "role": "edit",
 *    "seq": 17, "ops": […], "me": {"c": [x, y], "s": […], "d": […], "e": ulid|null, "v": […]},
 *    "pres": 1, "vt": 31}
 *
 * Order of the checks (SPEC-M1 §4.3, R2): `proto` FIRST — a protocol-1 tab
 * in the upgrade window sends no `ep` and must get 409 (reload), not 400
 * (which it would treat as "drop the batch and resync", losing changes).
 * Only then is a missing `ep` a 400. The 409 body carries the server's
 * protocol: {"error": "protocol", "message", "proto": 2} — the client keeps
 * it as its reload marker (one automatic reload per server version, §4.3).
 *
 * `role` (the access level the client last knew) and `vt` (moderators: the
 * last seen count state) are accepted from stage 0 on; the server acts on
 * them from stage 2 (`me` in the answer) and stage 3. The ops themselves are
 * validated one by one later (OpValidator): a broken op answers `bad` in
 * acks, it never fails the request.
 */
final class SyncRequest {
    public const CLIENT_RE = '/^[A-Za-z][A-Za-z0-9]{0,15}\z/';
    /** The board epoch as the client got it from snapshot or join (SPEC-M1 §4.5, §5.4). */
    public const EPOCH_RE = '/^[a-z0-9]{1,16}\z/';
    public const ALLOWED = ['proto', 'client', 'since', 'ep', 'role', 'seq', 'ops', 'me', 'pres', 'vt'];
    /** Access levels a client may send as `role` (SPEC-M1 §4.5; moderate = edit + canModerate()). */
    public const ACCESS_LEVELS = ['owner', 'moderate', 'edit', 'vote', 'view'];

    /**
     * @param list<mixed> $ops raw ops (0–200)
     * @param array<string, mixed>|null $me raw presence of the sender
     * @param string $epoch `ep`: the epoch the client knows
     * @param string|null $role `role`: the access level the client last knew, null = not sent
     * @param int|null $voteTally `vt`: last seen count state of the current voting session, null = not sent
     */
    public function __construct(
        public readonly string $client,
        public readonly int $since,
        public readonly ?int $seq,
        public readonly array $ops,
        public readonly ?array $me,
        public readonly bool $wantPresence,
        public readonly string $epoch,
        public readonly ?string $role,
        public readonly ?int $voteTally,
    ) {
    }

    /**
     * Byte length of the request body (P7, SPEC-M1 §33.1 b: the daily byte
     * quota counts it for a request with ops); 0 when built from a decoded
     * body alone. Not a constructor parameter: the constructor's signature
     * is frozen (§9.7).
     */
    private int $bodyBytes = 0;

    /** @throws HttpError 400|409|411|413 */
    public static function fromRequest(IRequest $r): self {
        $body = JsonBody::read($r, self::ALLOWED);
        // The byte length of the raw body: the Content-Length JsonBody has just
        // checked (digits only, at most MAX_BODY_BYTES). The server reads
        // exactly that many bytes, so it is strlen() of the raw text.
        return self::fromBody($body, (int)$r->getHeader('Content-Length'));
    }

    /** The byte length of the request body (see $bodyBytes). */
    public function bodyBytes(): int {
        return $this->bodyBytes;
    }

    /**
     * @param array<string, mixed> $body
     * @param int $bodyBytes the byte length of the raw body (bodyBytes())
     * @throws HttpError 400|409
     */
    public static function fromBody(array $body, int $bodyBytes = 0): self {
        // 1. proto before anything else (SPEC-M1 §4.3).
        if (!is_int($body['proto'] ?? null) || $body['proto'] !== Application::PROTOCOL) {
            throw new HttpError(409, 'protocol', '', ['proto' => Application::PROTOCOL]);
        }
        // 2. then the epoch: required from protocol 2 on.
        $ep = $body['ep'] ?? null;
        if (!is_string($ep) || preg_match(self::EPOCH_RE, $ep) !== 1) {
            throw new HttpError(400, 'bad_request', 'Invalid or missing ep.');
        }
        $client = $body['client'] ?? null;
        if (!is_string($client) || preg_match(self::CLIENT_RE, $client) !== 1) {
            throw new HttpError(400, 'bad_request', 'Invalid client id.');
        }
        $since = Input::int($body['since'] ?? null);
        if ($since === null || $since < 0) {
            throw new HttpError(400, 'bad_request', 'Invalid since.');
        }
        $ops = $body['ops'] ?? null;
        if ($ops === null) {
            $ops = [];
        }
        if (!is_array($ops) || !array_is_list($ops)) {
            throw new HttpError(400, 'bad_request', 'ops must be a list.');
        }
        if (count($ops) > Limits::MAX_OPS) {
            throw new HttpError(400, 'too_many_ops');
        }
        $seq = null;
        if ($ops !== []) {
            $seq = Input::int($body['seq'] ?? null);
            if ($seq === null || $seq < 1) {
                throw new HttpError(400, 'bad_request', 'seq (≥ 1) is required with ops.');
            }
        }
        $me = $body['me'] ?? null;
        if ($me !== null && !PathOps::isMap($me)) {
            throw new HttpError(400, 'bad_request', 'me must be an object.');
        }
        $pres = array_key_exists('pres', $body) && $body['pres'] !== null ? Input::flag($body['pres']) : true;
        if ($pres === null) {
            throw new HttpError(400, 'bad_request', 'pres must be 0 or 1.');
        }
        $role = $body['role'] ?? null;
        if ($role !== null && (!is_string($role) || !in_array($role, self::ACCESS_LEVELS, true))) {
            throw new HttpError(400, 'bad_request', 'Invalid role.');
        }
        $vt = null;
        if (array_key_exists('vt', $body) && $body['vt'] !== null) {
            $vt = Input::int($body['vt']);
            if ($vt === null || $vt < 0) {
                throw new HttpError(400, 'bad_request', 'Invalid vt.');
            }
        }
        $r = new self($client, $since, $seq, $ops, $me, $pres, $ep, $role, $vt);
        $r->bodyBytes = max(0, $bodyBytes);
        return $r;
    }
}
