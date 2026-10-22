<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Settings;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\PrivacyNotice;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IConfig;
use OCP\Settings\ISettings;

/**
 * The form of the admin section "Knorke" (M2): the privacy notice text and
 * privacy policy URL, as a default and per language. The page carries the
 * 12 initial-state keys like every Knorke page (page 'admin', privacyAdmin;
 * privacy null) and the same bundle; src/main.js mounts AdminSettings.vue.
 */
final class Admin implements ISettings {
    public function __construct(
        private IInitialState $initialState,
        private IConfig $config,
        private Limits $limits,
        private PrivacyNotice $privacy,
    ) {
    }

    public function getForm(): TemplateResponse {
        PageController::provideState($this->initialState, PageController::initialStateFor($this->config, $this->limits, [
            'page' => 'admin',
            'privacyAdmin' => $this->privacy->adminState(),
        ]));
        return new TemplateResponse(Application::APP_ID, 'admin', [], '');
    }

    public function getSection(): string {
        return Application::APP_ID;
    }

    public function getPriority(): int {
        return 10;
    }
}
