<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\Input;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Service\SyncService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Guests without an account (routes 14–16, SPEC-M0 §4.9): join through an
 * edit link with a name, then snapshot and sync with the signed guest token
 * in the `X-Knorke-Guest` header. #[NoCSRFRequired] switches Nextcloud's CSRF
 * check off, so every POST runs refuseCrossSite() first (§4.2).
 *
 * Join (14) and sync (16) answer end states (guest_token, link_revoked,
 * link_expired, links_disabled) with 200 {"end", "message"} to a client that
 * sends `X-Knorke-End-State: 1` (ApiResponses, SPEC-M1 §1.2 (R23)); the
 * snapshot (15) keeps its 401/403.
 */
final class PublicSyncController extends Controller {
    use ApiResponses;

    public const GUEST_HEADER = 'X-Knorke-Guest';

    public function __construct(
        IRequest $request,
        private Access $access,
        private SyncService $sync,
        private LoggerInterface $logger,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * Route 14 `POST /pub/v1/{token}/join` {"client", "name", "guest", "password"} → snapshot + guest
     * token (SPEC-M0 §4.9.2, SPEC-M1 §4.11.4): edit or voting link; `password` when the link has one.
     */
    #[PublicPage]
    #[NoCSRFRequired]
    public function join(#[\SensitiveParameter] string $token): Response {
        return $this->run(function () use ($token): Response {
            $this->refuseCrossSite();
            $body = JsonBody::read($this->request, ['client', 'name', 'guest', 'password']);
            $client = $body['client'] ?? null;
            if ($client !== null && (!is_string($client) || preg_match(SyncRequest::CLIENT_RE, $client) !== 1)) {
                throw new HttpError(400, 'bad_request', 'Invalid client id.');
            }
            $existing = $body['guest'] ?? null;
            $existing = is_string($existing) ? $existing : null;
            $password = $body['password'] ?? null;
            if ($password !== null && !is_string($password)) {
                throw new HttpError(400, 'bad_request', 'password must be text.');
            }
            [$a, $guestToken, $exp, $row] = $this->access->joinGuest(
                $token,
                Input::str($body['name'] ?? null),
                $existing,
                $this->request->getRemoteAddress(),
                $password,
            );
            $meta = ['id' => $row['id'], 'role' => $a->principal->role->value, 'schema' => $row['schema_version']];
            return $this->raw($this->sync->snapshotJson($a, $row['id'], $meta, ['token' => $guestToken, 'exp' => $exp], self::nowMs()));
        }, endStates: true);
    }

    /**
     * Route 15 `GET /pub/v1/boards/{id}/snapshot` with `X-Knorke-Guest` (§4.4, §4.9.3).
     * After the token check the snapshot throttle (stage 4, SPEC-M1 §4.1):
     * `knorke-snap-<gid>` 30 per 60 s and IP, then `knorke-snapip-<board>`
     * 300 per 60 s and IP → 429 slow_down. The join (route 14) counts in the
     * same budgets (Access::joinGuest, §4.11.4 step 6).
     */
    #[PublicPage]
    #[NoCSRFRequired]
    public function snapshot(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            [$a, $row] = $this->access->forGuestWithRow($this->request->getHeader(self::GUEST_HEADER), $id);
            $this->access->throttleGuestSnapshot($a->principal, $id, $this->request->getRemoteAddress());
            $meta = ['id' => $id, 'role' => $a->principal->role->value, 'schema' => $row['schema_version']];
            return $this->raw($this->sync->snapshotJson($a, $id, $meta, null, self::nowMs()));
        });
    }

    /** Route 16 `POST /pub/v1/boards/{id}/sync` with `X-Knorke-Guest` (§4.5). */
    #[PublicPage]
    #[NoCSRFRequired]
    public function sync(int $id): Response {
        return $this->run(function () use ($id): Response {
            $this->refuseCrossSite();
            $r = SyncRequest::fromRequest($this->request);
            $a = $this->access->forGuest($this->request->getHeader(self::GUEST_HEADER), $id);
            return $this->raw($this->sync->sync($a, $id, $r, self::nowMs()));
        }, endStates: true);
    }
}
