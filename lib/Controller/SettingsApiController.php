<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Controller;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Http\JsonBody;
use OCA\Knorke\Service\PrivacyNotice;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Response;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

/**
 * The admin setting of the privacy notice (route 27, M2). Admins only, and
 * twice: the action carries no NoAdminRequired (Nextcloud's middleware
 * answers 401 without a login and 403 to a logged-in non-admin; only then
 * comes its CSRF check, 412) and checks IGroupManager::isAdmin itself.
 * CSRF stays on; the body goes through JsonBody like on every other route.
 * No throttle (admins only).
 */
final class SettingsApiController extends Controller {
    use ApiResponses;

    public function __construct(
        IRequest $request,
        private LoggerInterface $logger,
        private IUserSession $userSession,
        private IGroupManager $groups,
        private PrivacyNotice $privacy,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    /**
     * Route 27 `PUT /api/v1/settings/privacy` {"default": {text, url},
     * "languages": {"<code>": {text, url}, …}} → 200 {"privacy": <normalised
     * form>}; the body replaces the whole setting (PrivacyNotice::save). A
     * non-admin gets 403 forbidden before the body is read; nothing is
     * written.
     */
    public function update(): Response {
        return $this->run(function (): Response {
            $uid = $this->userSession->getUser()?->getUID();
            if ($uid === null || !$this->groups->isAdmin($uid)) {
                throw new HttpError(403, 'forbidden');
            }
            $body = JsonBody::read($this->request, ['default', 'languages']);
            return $this->json(['privacy' => PrivacyNotice::wire($this->privacy->save($body))]);
        });
    }
}
