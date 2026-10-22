<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCP\IUser;
use Psr\Container\ContainerInterface;

/**
 * May an account of the Guests app (backend "Guests") use Knorke? One check
 * for the three places that show Knorke outside its own pages (jobs 030,
 * 055): the search (BoardSearchProvider::search), the provider list and its
 * "Places" menu (BoardSearchProvider::getOrder) and the bell, push and mail
 * digest (Notifier::prepare).
 *
 * The Guests app's whitelist works by URL, and search, notifications and
 * the provider list are core's or another app's pages, so the Guests app
 * never stops them for Knorke. This class asks it the way its "forbidden
 * for guests" page and its navigation filter do:
 * AppWhitelist::isUrlAllowed() for the fixed path /apps/knorke/ (not a
 * board URL: behind a webroot that one would read as core and pass).
 *
 *  - other accounts: true at once, without touching the container
 *  - an account of the Guests app: only a strict true lets it in; a missing
 *    class, any other answer or any error is false, without a log (a guest
 *    types a search term key by key)
 *  - the whitelist object is kept once found, a failed get() is not; the
 *    answer is never kept: every call asks again
 *
 * Knorke does not depend on the Guests app: the class is named by a string
 * only (no use, no ::class). The constructor takes nothing else and does
 * nothing: Nextcloud builds this with the notifier and the search provider,
 * for every notification shown and every provider list.
 */
class GuestsAppWhitelist {
    /** IUser::getBackendClassName() of the accounts of the Guests app. */
    public const BACKEND = 'Guests';
    /** The Guests app's whitelist, by name only (no ::class): Knorke does not depend on that app. */
    public const WHITELIST = 'OCA\Guests\AppWhitelist';

    /** OCA\Guests\AppWhitelist, fetched only for accounts of the Guests app. */
    private ?object $whitelist = null;

    public function __construct(
        private ContainerInterface $container,
    ) {
    }

    public function allows(IUser $user): bool {
        if ($user->getBackendClassName() !== self::BACKEND) {
            return true;
        }
        try {
            $this->whitelist ??= $this->container->get(self::WHITELIST);
            $ok = $this->whitelist->isUrlAllowed($user, '/apps/' . Application::APP_ID . '/');
        } catch (\Throwable) {
            return false;
        }
        return $ok === true;
    }
}
