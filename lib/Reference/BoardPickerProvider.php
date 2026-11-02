<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Reference;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Search\BoardSearchProvider;
use OCP\Collaboration\Reference\ISearchableReferenceProvider;

/**
 * "Knorke boards" in the Smart Picker (M2, SPEC-M1 §1.2): the link
 * previews of BoardReferenceProvider plus a picker entry that searches with
 * the unified search provider "knorke" (BoardSearchProvider) and inserts the
 * absolute board address of the chosen hit. Only BoardReferenceProvider::
 * create() builds it, for a session account that "Limit to groups" and the
 * Guests app let in; it cannot extend ADiscoverableReferenceProvider, so
 * jsonSerialize() has that class's shape.
 */
final class BoardPickerProvider extends BoardReferenceProvider implements ISearchableReferenceProvider, \JsonSerializable {
    /** Place among the picker's entries. */
    public const ORDER = 10;
    /** The picker inverts its icons in the dark theme, so the black glyph. */
    public const ICON = 'app-dark.svg';

    public function getId(): string {
        return Application::APP_ID;
    }

    public function getTitle(): string {
        return $this->l->t('Knorke boards');
    }

    public function getOrder(): int {
        return self::ORDER;
    }

    public function getIconUrl(): string {
        return $this->urls->getAbsoluteURL($this->urls->imagePath(Application::APP_ID, self::ICON));
    }

    /** @return list<string> */
    public function getSupportedSearchProviderIds(): array {
        return [BoardSearchProvider::ID];
    }

    /** As ADiscoverableReferenceProvider::jsonSerialize() for an ISearchableReferenceProvider. */
    public function jsonSerialize(): array {
        return [
            'id' => $this->getId(),
            'title' => $this->getTitle(),
            'icon_url' => $this->getIconUrl(),
            'order' => $this->getOrder(),
            'search_providers_ids' => $this->getSupportedSearchProviderIds(),
        ];
    }
}
