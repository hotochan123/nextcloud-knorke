<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Settings;

use OCA\Knorke\AppInfo\Application;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

/**
 * The admin settings section "Knorke" (M2, privacy notice). Registered in
 * Application::boot() through IManager::registerSection (appinfo/info.xml
 * stays unchanged: Nextcloud reads it only on an upgrade).
 */
final class AdminSection implements IIconSection {
    public function __construct(
        private IURLGenerator $urls,
    ) {
    }

    public function getID(): string {
        return Application::APP_ID;
    }

    /** The product name, not translated. */
    public function getName(): string {
        return 'Knorke';
    }

    public function getPriority(): int {
        return 80;
    }

    public function getIcon(): string {
        return $this->urls->imagePath(Application::APP_ID, 'app-dark.svg');
    }
}
