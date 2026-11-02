<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCP\Config\IUserConfig;

/**
 * Favorites and "last opened" of the board list (factory job 219), per
 * account, in Nextcloud's user preferences of the app (no own table, so no
 * migration). One key per board, so two devices that star two boards at the
 * same moment never overwrite each other (no read-modify-write of a list):
 *
 *   fav_<boardId>     true (setValueBool); unstarring deletes the key
 *   opened_<boardId>  server time in ms of the last opening (setValueInt);
 *                     at most MAX_OPENED keys per account, the oldest go
 *
 * Every value is lazy: Nextcloud does not load them with each request of the
 * account, only when the board list reads them (one getValues per list).
 * The caller checks the account's access first. A deleted board takes its
 * keys of every account along (forgetBoard); Nextcloud drops all
 * preferences of a deleted account itself. A star of a board the account
 * lost access to stays stored, unseen, and shows again when access returns.
 */
class BoardMarks {
    /** Most opened_ keys kept per account. */
    public const MAX_OPENED = 200;
    private const FAV = 'fav_';
    private const OPENED = 'opened_';

    public function __construct(
        private IUserConfig $config,
    ) {
    }

    /**
     * Both marks of $uid with one read.
     *
     * @return array{0: array<int, true>, 1: array<int, int>} [favorites, openedAt in ms] by board id
     */
    public function of(string $uid): array {
        $fav = [];
        $opened = [];
        foreach ($this->config->getValues($uid, Application::APP_ID) as $key => $value) {
            $key = (string)$key;
            if (str_starts_with($key, self::FAV) && $value) {
                $fav[(int)substr($key, strlen(self::FAV))] = true;
            } elseif (str_starts_with($key, self::OPENED)) {
                $opened[(int)substr($key, strlen(self::OPENED))] = (int)$value;
            }
        }
        return [$fav, $opened];
    }

    public function setFavorite(string $uid, int $board, bool $favorite): void {
        if ($favorite) {
            $this->config->setValueBool($uid, Application::APP_ID, self::FAV . $board, true, true);
        } else {
            $this->config->deleteUserConfig($uid, Application::APP_ID, self::FAV . $board);
        }
    }

    /** Stores $nowMs as the last opening of $board by $uid; beyond MAX_OPENED the oldest keys go. */
    public function markOpened(string $uid, int $board, int $nowMs): int {
        $this->config->setValueInt($uid, Application::APP_ID, self::OPENED . $board, $nowMs, true);
        $all = $this->config->getValues($uid, Application::APP_ID, self::OPENED);
        if (count($all) > self::MAX_OPENED) {
            $all = array_map('intval', $all);
            asort($all);
            foreach (array_slice(array_keys($all), 0, count($all) - self::MAX_OPENED) as $key) {
                $this->config->deleteUserConfig($uid, Application::APP_ID, (string)$key);
            }
        }
        return $nowMs;
    }

    /** $board is gone: its marks of every account go too. */
    public function forgetBoard(int $board): void {
        $this->config->deleteKey(Application::APP_ID, self::FAV . $board);
        $this->config->deleteKey(Application::APP_ID, self::OPENED . $board);
    }
}
