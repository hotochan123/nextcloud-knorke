<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\ShapeLibStore;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

/**
 * Own shape libraries (routes 46–54, factory job 203): signed-in accounts
 * only (no PublicPage: guests of links never reach them), CSRF on, the
 * app's error form. The admin routes 52 and 53 carry no NoAdminRequired
 * (Nextcloud's middleware answers 403 to a non-admin) and check it
 * themselves before the body is read, like the template routes. Bodies go
 * through JsonBody (route 47 up to ShapeLibStore::MAX_BODY_BYTES); who sees
 * and changes what is ShapeLibStore's.
 */
final class ShapeLibApiController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private IUserSession $userSession,
        private ShapeLibStore $libs,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 46 `GET /api/v1/shapelibs` → {right, adopted: [{id, name, names}], own: [{id, name, names, pending}]}. */
    #[NoAdminRequired]
    public function index(): Response {
        return $this->run(function (): Response {
            JsonBody::guardRoute($this->request);
            return $this->json($this->libs->listFor($this->user()));
        });
    }

    /** Route 47 `POST /api/v1/shapelibs` {name, entries} → 201 {id}. */
    #[NoAdminRequired]
    public function create(): Response {
        return $this->run(function (): Response {
            $user = $this->user();
            if ($this->libs->rightOf($user) === null) {
                throw new HttpError(403, 'forbidden');
            }
            $body = JsonBody::read($this->request, ['name', 'entries'], ShapeLibStore::MAX_BODY_BYTES);
            return $this->json($this->libs->create($user, $body, self::nowMs()), 201);
        });
    }

    /** Route 48 `GET /api/v1/shapelibs/{id}` → {entries: [{name, img, w, h}]}. */
    #[NoAdminRequired]
    public function show(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            return $this->json(['entries' => $this->libs->content($this->user(), $id)]);
        });
    }

    /** Route 49 `PATCH /api/v1/shapelibs/{id}` {name} → {id, name}. */
    #[NoAdminRequired]
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $user = $this->user();
            $body = JsonBody::read($this->request, ['name']);
            return $this->json($this->libs->rename($user, $id, $body));
        });
    }

    /** Route 50 `DELETE /api/v1/shapelibs/{id}` → {deleted: true}: an own library, an adopted one (admins) or a suggestion (admins: reject). */
    #[NoAdminRequired]
    public function destroy(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            $this->libs->delete($this->user(), $id);
            return $this->json(['deleted' => true]);
        });
    }

    /** Route 51 `POST /api/v1/shapelibs/{id}/suggest` {note?} → {id, state}. */
    #[NoAdminRequired]
    public function suggest(int $id): Response {
        return $this->run(function () use ($id): Response {
            $user = $this->user();
            $body = JsonBody::read($this->request, ['note']);
            return $this->json($this->libs->suggest($user, $id, $body, self::nowMs()));
        });
    }

    /** Route 52 `POST /api/v1/shapelibs/{id}/adopt` {} → {id} (the adopted copy); admins only. */
    public function adopt(int $id): Response {
        return $this->run(function () use ($id): Response {
            $user = $this->admin();
            JsonBody::read($this->request, []);
            return $this->json($this->libs->adopt($user, $id, self::nowMs()));
        });
    }

    /** Route 53 `GET /api/v1/shapelibs/review` → {suggestions: [{id, name, names, note, by, created}], adopted: [{id, name, names, adopted}]}; admins only. */
    public function review(): Response {
        return $this->run(function (): Response {
            $user = $this->admin();
            JsonBody::guardRoute($this->request);
            return $this->json($this->libs->review($user));
        });
    }

    /** Route 54 `DELETE /api/v1/shapelibs/{id}/suggest` → {withdrawn: true}. */
    #[NoAdminRequired]
    public function withdraw(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            $this->libs->withdraw($this->user(), $id);
            return $this->json(['withdrawn' => true]);
        });
    }

    private function user(): IUser {
        return $this->userSession->getUser() ?? throw new HttpError(401, 'not_logged_in', 'Not logged in.');
    }

    /** @throws HttpError 403 forbidden unless the account decides on suggestions (ShapeLibStore::isAdmin) */
    private function admin(): IUser {
        $user = $this->userSession->getUser();
        if ($user === null || !$this->libs->isAdmin($user)) {
            throw new HttpError(403, 'forbidden');
        }
        return $user;
    }
}
