<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\TemplateStore;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

/**
 * Template suggestions (routes 28–34, factory job 182): signed-in accounts
 * only (no PublicPage: guests of links never reach them), CSRF on, the
 * app's error form. Routes 28, 29, 30 and 32 carry NoAdminRequired; the
 * admin routes 31, 33 and 34 do not (Nextcloud's middleware answers 403 to
 * a non-admin) and check it themselves before the body is read, like route
 * 27. Bodies go through JsonBody (route 29 up to
 * TemplateStore::MAX_BODY_BYTES); who sees and changes what is
 * TemplateStore's.
 */
final class TemplateApiController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private IUserSession $userSession,
        private TemplateStore $templates,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /** Route 28 `GET /api/v1/templates` → {right, templates: [{id, name, sketch}], pending: [{id, name, note, sketch, created}]}. */
    #[NoAdminRequired]
    public function index(): Response {
        return $this->run(function (): Response {
            JsonBody::guardRoute($this->request);
            return $this->json($this->templates->listFor($this->user()));
        });
    }

    /** Route 29 `POST /api/v1/templates` {name, note?, content, sketch} → 201 {id, state}. */
    #[NoAdminRequired]
    public function create(): Response {
        return $this->run(function (): Response {
            $user = $this->user();
            if ($this->templates->rightOf($user) === null) {
                throw new HttpError(403, 'forbidden');
            }
            $body = JsonBody::read($this->request, ['name', 'note', 'content', 'sketch'], TemplateStore::MAX_BODY_BYTES);
            return $this->json($this->templates->create($user, $body, self::nowMs()), 201);
        });
    }

    /** Route 30 `GET /api/v1/templates/{id}` → {content}; adopted templates only. */
    #[NoAdminRequired]
    public function show(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            return $this->json(['content' => $this->templates->content($this->user(), $id)]);
        });
    }

    /** Route 31 `PATCH /api/v1/templates/{id}` {name} → {id, name}; admins only, adopted templates only. */
    public function update(int $id): Response {
        return $this->run(function () use ($id): Response {
            $user = $this->admin();
            $body = JsonBody::read($this->request, ['name']);
            return $this->json($this->templates->rename($user, $id, $body));
        });
    }

    /** Route 32 `DELETE /api/v1/templates/{id}` → {deleted: true}: withdraw, reject (admins) or delete (admins). */
    #[NoAdminRequired]
    public function destroy(int $id): Response {
        return $this->run(function () use ($id): Response {
            JsonBody::guardRoute($this->request);
            $this->templates->delete($this->user(), $id);
            return $this->json(['deleted' => true]);
        });
    }

    /** Route 33 `POST /api/v1/templates/{id}/adopt` {} → {id}; admins only. */
    public function adopt(int $id): Response {
        return $this->run(function () use ($id): Response {
            $user = $this->admin();
            JsonBody::read($this->request, []);
            return $this->json($this->templates->adopt($user, $id, self::nowMs()));
        });
    }

    /** Route 34 `GET /api/v1/templates/review` → {suggestions: [{id, name, note, sketch, by, created}], templates: [{id, name, sketch, adopted}]}; admins only. */
    public function review(): Response {
        return $this->run(function (): Response {
            $user = $this->admin();
            JsonBody::guardRoute($this->request);
            return $this->json($this->templates->review($user));
        });
    }

    private function user(): IUser {
        return $this->userSession->getUser() ?? throw new HttpError(401, 'not_logged_in', 'Not logged in.');
    }

    /** @throws HttpError 403 forbidden unless the account decides on suggestions (TemplateStore::isAdmin) */
    private function admin(): IUser {
        $user = $this->userSession->getUser();
        if ($user === null || !$this->templates->isAdmin($user)) {
            throw new HttpError(403, 'forbidden');
        }
        return $user;
    }
}
