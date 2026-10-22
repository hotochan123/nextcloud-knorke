<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\SyncRequest;
use OCA\Knorke\Service\SyncService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Snapshot and sync for signed-in users (routes 12–13, SPEC-M1 §4.4, §4.5).
 * CSRF stays on. The sync body is read through SyncRequest (JsonBody) only.
 */
final class SyncController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private Access $access,
        private SyncService $sync,
        private BoardService $boards,
        private LoggerInterface $logger,
        private SharePolicy $policy,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * Route 12 `GET /api/v1/boards/{id}/snapshot` → snapshot (SPEC-M1 §4.4).
     * Always the full rights check; it renews the grant. Then the snapshot
     * throttle (stage 4, §4.1: `knorke-snap` 30 per 60 s per account →
     * 429 slow_down, retryMs 2000, Retry-After 2): a refused caller (404)
     * spends nothing, a throttled one costs no snapshot.
     *
     * `board.links` = {edit: Link|null, vote: Link|null} for moderators
     * (owner; shares with `moderate`), read only for non-owners;
     * `linksAllowed` and `linkPolicy` (SPEC-M1 §4.10.1) for the owner only.
     * Members without moderation and guests get none of them.
     *
     * `linkOpenSince` (M2 privacy notice, additive, no protocol change) for
     * EVERY role: created_at (ms) of the newest active edit or vote link,
     * null without one. It tells members THAT and SINCE WHEN the board is
     * open by link; token, password and expiry stay with moderators. The
     * guest snapshot (route 15) does not carry it.
     */
    #[NoAdminRequired]
    public function snapshot(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            [$a, $row] = $this->access->forUserWithRow($id);
            $this->access->throttleSnapshot();
            $p = $a->principal;
            $meta = ['id' => $id, 'role' => $p->role->value, 'schema' => $row['schema_version']];
            if ($p->canModerate()) {
                // The share dialog's state (§4.4): the active link (also while
                // Nextcloud's policy forbids links — it is kept, not revoked).
                $meta['links'] = $this->boards->links($id, (string)$row['owner']);
            }
            if ($p->role === Role::Owner) {
                // Whether the owner may share via link (SPEC-M0 §4.9.7) and how
                // Nextcloud constrains links (password, expiry; SPEC-M1 §4.10.1).
                $meta['linksAllowed'] = $this->boards->linksAllowed((string)$row['owner']);
                $meta['linkPolicy'] = $this->policy->linkPolicy();
            }
            // M2 privacy notice, every role: since when a link is active (null: none)
            $meta['linkOpenSince'] = $this->boards->linkOpenSince($id);
            return $this->raw($this->sync->snapshotJson($a, $id, $meta, null, self::nowMs()));
        });
    }

    /**
     * Route 13 `POST /api/v1/boards/{id}/sync` → one request per tick (§4.5).
     * With `X-Knorke-End-State: 1` the app's own 401 not_logged_in answers
     * 200 {"end", "message"} (ApiResponses, SPEC-M1 §1.2 (R23)); Nextcloud's
     * 401 for a gone session and its 412 come before the app and stay.
     */
    #[NoAdminRequired]
    public function sync(int $id): Response {
        return $this->run(function () use ($id): Response {
            // The body first: it also refuses a body key that overrides {id}.
            $r = SyncRequest::fromRequest($this->request);
            $a = $this->access->forUser($id);
            return $this->raw($this->sync->sync($a, $id, $r, self::nowMs()));
        }, endStates: true);
    }
}
