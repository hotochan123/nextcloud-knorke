<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * The notice an account confirms before its first AI task (factory job 267):
 * the same admin setting as the privacy notice of guests (PrivacyNotice: a
 * default and texts per language, each with an optional link, the same
 * checks, the same fallback chain), stored under its own app config key
 * knorke/ai_notice. Without a link in any entry there is none (no theming
 * fallback); a text null means the client shows its built-in text.
 */
class AiNotice extends PrivacyNotice {
    /** App config key (lazy). */
    public const KEY = 'ai_notice';

    protected function fallbackUrl(): string {
        return '';
    }
}
