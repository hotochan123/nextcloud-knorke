<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

// Stand-ins for the three Circles events the TeamListener reacts to (SPEC-M1
// §4.13.9, R14), for the unit tests only: the unit run has no Circles app.
// Same class names and the methods of Circles 34/35 (MembershipsRemovedEvent::
// getMemberships() → Membership::getCircleId()/getSingleId();
// CircleDestroyedEvent::getCircle() and DestroyingCircleEvent::getCircle()
// → Circle::getSingleId()). Declared only when the real classes are absent;
// required by the tests that need them.

namespace OCA\Circles\Events;

if (!class_exists(MembershipsRemovedEvent::class, false)) {
    class MembershipsRemovedEvent extends \OCP\EventDispatcher\Event {
        /** @param list<object> $memberships */
        public function __construct(private array $memberships) {
            parent::__construct();
        }

        /** @return list<object> */
        public function getMemberships(): array {
            return $this->memberships;
        }
    }
}

if (!class_exists(DestroyingCircleEvent::class, false)) {
    class DestroyingCircleEvent extends \OCP\EventDispatcher\Event {
        public function __construct(private object $circle) {
            parent::__construct();
        }

        public function getCircle(): object {
            return $this->circle;
        }
    }
}

if (!class_exists(CircleDestroyedEvent::class, false)) {
    class CircleDestroyedEvent extends \OCP\EventDispatcher\Event {
        public function __construct(private object $circle) {
            parent::__construct();
        }

        public function getCircle(): object {
            return $this->circle;
        }
    }
}
