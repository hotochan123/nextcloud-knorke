<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\AppInfo;

use OCA\Knorke\Listener\GroupListener;
use OCA\Knorke\Listener\TeamListener;
use OCA\Knorke\Listener\UserDeletedListener;
use OCA\Knorke\Notification\Notifier;
use OCA\Knorke\Search\BoardSearchProvider;
use OCA\Knorke\Settings\Admin;
use OCA\Knorke\Settings\AdminSection;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Group\Events\GroupDeletedEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\Settings\IManager;
use OCP\User\Events\UserDeletedEvent;

final class Application extends App implements IBootstrap {
    public const APP_ID = 'knorke';

    /**
     * Protocol number between server and bundle (SPEC-M0 §4.2, SPEC-M1 §4.3).
     * Every sync request sends it as "proto"; a mismatch answers 409
     * `protocol` and the client reloads once. src/sync/protocol.js holds the
     * same number, a shell test keeps the two equal. Fixed text format: the
     * test reads this line. Protocol 2 is the whole M1 wire contract, frozen
     * in stage 0 (fields of later stages included); changing it needs 3.
     */
    public const PROTOCOL = 2;

    public function __construct(array $urlParams = []) {
        parent::__construct(self::APP_ID, $urlParams);
    }

    public function register(IRegistrationContext $context): void {
        // Everything else is constructor-autowired. register() runs on EVERY
        // Nextcloud request, so it only names the listener classes (no service
        // is built here). Rights invalidation by events (SPEC-M1 §4.13.9):
        // group and team changes bump acl_gen of the affected boards. The
        // Circles events are named by STRING: a disabled Circles app loads
        // nothing, and no Circles type appears anywhere in Knorke.
        $context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);
        $context->registerEventListener(UserRemovedEvent::class, GroupListener::class);
        $context->registerEventListener(GroupDeletedEvent::class, GroupListener::class);
        $context->registerEventListener(TeamListener::MEMBERSHIPS_REMOVED, TeamListener::class);
        $context->registerEventListener(TeamListener::CIRCLE_DESTROYED, TeamListener::class);
        // R14-03: synchronous, also for occ circles:manage:destroy (the event
        // above comes only from Circles' asynchronous result step).
        $context->registerEventListener(TeamListener::DESTROYING_CIRCLE, TeamListener::class);
        // Unified search (M2, SPEC-M1 §1.2): named here, built by Nextcloud's
        // SearchComposer, which builds every provider for the provider list.
        $context->registerSearchProvider(BoardSearchProvider::class);
        // "Board shared with you" (M2, SPEC-M1 §1.2): named here, built by
        // Nextcloud's notification manager whenever it prepares notifications.
        $context->registerNotifierService(Notifier::class);
    }

    public function boot(IBootContext $context): void {
        $context->injectFn([self::class, 'registerSettings']);
    }

    /**
     * The admin section "Knorke" with the privacy notice form (M2), through
     * the public settings API instead of <settings> in appinfo/info.xml:
     * Nextcloud reads info.xml only on an upgrade, and the version must not
     * be bumped for it. For accounts Nextcloud loads every app before the
     * routing, so the settings page sees the registration. Only two class
     * names are added here; nothing is built until the settings page asks.
     */
    public static function registerSettings(IManager $m): void {
        $m->registerSection('admin', AdminSection::class);
        $m->registerSetting('admin', Admin::class);
    }
}
