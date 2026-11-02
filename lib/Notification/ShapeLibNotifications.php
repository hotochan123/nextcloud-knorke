<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Notification;

/**
 * The notifications of shape library suggestions (factory job 203), sent by
 * ShapeLibStore after its write; Notifier renders them. The same rules as
 * the template suggestions (TemplateNotifications), object shapelib/<id of
 * the account's own library>:
 *  - suggested(): shapelib_suggested to every enabled admin with access to
 *    the app (no more than ShareNotifications::FANOUT_MAX);
 *  - decided(): shapelib_adopted or shapelib_rejected to the account, with
 *    the name as subject parameter;
 *  - processed(): the admins' shapelib_suggested is done.
 * Nothing here throws.
 */
class ShapeLibNotifications extends TemplateNotifications {
    public const OBJECT_TYPE = 'shapelib';
    public const SUGGESTED = 'shapelib_suggested';
    public const ADOPTED = 'shapelib_adopted';
    public const REJECTED = 'shapelib_rejected';
}
