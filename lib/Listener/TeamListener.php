<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Listener;

use OCA\Knorke\Service\ShareService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use Psr\Log\LoggerInterface;

/**
 * Circles (team) events (SPEC-M1 §4.13.9, R13), registered by class-name
 * STRING in Application::register: no Circles type appears in a signature
 * or an import, so a disabled Circles app loads nothing.
 *
 *  - OCA\Circles\Events\MembershipsRemovedEvent: getMemberships(), each
 *    getCircleId() — the team's singleId, the id space of Team::getId() and
 *    knorke_shares.recipient (never getSingleId(): that is the member) —
 *    de-duplicated; the boards with team rows of those ids get acl_gen + 1,
 *    each board once.
 *  - OCA\Circles\Events\DestroyingCircleEvent (R14-03): synchronous, sent
 *    by CircleDestroy::manage() — also for occ circles:manage:destroy, where
 *    Circles deletes its own file shares on it: getCircle()->getSingleId() →
 *    the team's rows go, their boards get acl_gen + 1.
 *  - OCA\Circles\Events\CircleDestroyedEvent: the same; Circles sends it only
 *    from its asynchronous result step (never for the occ command), so it is
 *    the idempotent second path (rows already gone → nothing to bump).
 *
 * Every event method is checked with method_exists; a missing one is logged
 * as a warning. Never throws (rule (a)).
 *
 * @template-implements IEventListener<Event>
 */
class TeamListener implements IEventListener {
    public const MEMBERSHIPS_REMOVED = 'OCA\Circles\Events\MembershipsRemovedEvent';
    public const CIRCLE_DESTROYED = 'OCA\Circles\Events\CircleDestroyedEvent';
    public const DESTROYING_CIRCLE = 'OCA\Circles\Events\DestroyingCircleEvent';

    public function __construct(
        private ShareService $shares,
        private LoggerInterface $logger,
    ) {
    }

    public function handle(Event $event): void {
        try {
            if (is_a($event, self::MEMBERSHIPS_REMOVED)) {
                $this->membershipsRemoved($event);
            } elseif (is_a($event, self::DESTROYING_CIRCLE) || is_a($event, self::CIRCLE_DESTROYED)) {
                $this->circleDestroyed($event);
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: handling a team event failed', ['exception' => $e, 'app' => 'knorke']);
        }
    }

    private function membershipsRemoved(Event $event): void {
        if (!method_exists($event, 'getMemberships')) {
            $this->missing(get_class($event) . '::getMemberships');
            return;
        }
        $ids = [];
        foreach ((array)$event->getMemberships() as $m) {
            if (!is_object($m) || !method_exists($m, 'getCircleId')) {
                $this->missing('Membership::getCircleId');
                continue;
            }
            $id = $m->getCircleId();
            if (is_string($id) && $id !== '') {
                $ids[$id] = true;
            }
        }
        if ($ids !== []) {
            $this->shares->onTeamsChanged(array_map('strval', array_keys($ids)));
        }
    }

    private function circleDestroyed(Event $event): void {
        if (!method_exists($event, 'getCircle')) {
            $this->missing(get_class($event) . '::getCircle');
            return;
        }
        $circle = $event->getCircle();
        if (!is_object($circle) || !method_exists($circle, 'getSingleId')) {
            $this->missing('Circle::getSingleId');
            return;
        }
        $id = $circle->getSingleId();
        if (is_string($id) && $id !== '') {
            $this->shares->onTeamChanged($id, true);
        }
    }

    private function missing(string $method): void {
        $this->logger->warning('Knorke: team event without ' . $method . ', team shares are revoked only by the grant TTL', ['app' => 'knorke']);
    }
}
