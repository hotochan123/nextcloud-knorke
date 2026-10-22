/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Scenario list in EXECUTION order (SPEC-M0 §8.2). E09 rotates the link and
 * ends the shared world, so it runs last; the report is sorted by id.
 * E09b (app 429 on /sync, R3) is not in the §8.2 table: it guards the
 * frozen banner hook rate_limited on its own board. E13/E14 (R4, §15) guard
 * the review fixes T3 (leave guard) and T5 (editor flushed before unload),
 * each on its own board. E15–E17 (round 2, §15) guard U9/U10 (legal links on
 * the guest page), U11/U12 (Nextcloud's link policy) and U15 (status reload
 * freezes the board). E16 runs after E09: while the admin has link sharing
 * off, every link member and guest of the instance loses access, the shared
 * world's included.
 * SPEC-M1 §8.4 (stage 0): E18 (U8 in the browser), E19 (live title) and E20
 * (protocol jump) use their own boards and change no instance setting, so they
 * run before E09; cases of later stages that switch instance settings go
 * after E16.
 * SPEC-M1 §8.4 (stage 1): E21 (shapes, transformer), E22 (text items, serial
 * input), E23 (connectors, round 1b), E24 (copy/paste with the connector part
 * of 1b; Chromium, WebKit, Firefox as a report), E25 (frame resize with keep)
 * and E26 (keyboard and focus with "Connect" of 1b) use their own boards and
 * change no instance setting either: before E09, in id order.
 * SPEC-M1 §8.4 (stage 2, Revision 13): E27 (sharing), E28 (vote link, stage-2
 * part), E29 (link password), E30 (policy in the dialog) and E36 (LOD 2)
 * switch instance settings, share boards and change links, so they run after
 * E16, in id order; E36 changes no setting but §8.4 lists it there.
 * SPEC-M1 §8.4 (stage 3, Revision 16): E31 (voting), E32 (timer) and E33
 * (following) use their own boards and change no instance setting: before
 * E09, after E26, in id order. Their viewport passes (E31@390x844,
 * E31@820x1180, E33@…) follow their case; the passes of E28 (stage-3
 * additions) follow E28. A pass reports as "<id>@<pass>" and --only <id>
 * selects the case with all its passes (lib/cli.mjs reportId).
 * SPEC-M1 §8.4 (stage 4, Revision 19): E34 (write budget in the client) and
 * E37 (context menu, own board) change no instance setting: before E09,
 * after the passes of E33, in id order; E35 (purge during a session, bridge
 * purge-tombstones) goes with the cases after E16, in id order (before E36).
 * E12 keeps its place (the shared world; R19 adds the vote link page).
 * P7-C (SPEC-M1 §33.1 k, Revision 22): E09c (proxy 403/404 without an app
 * body on /sync, own board and own context, ctx.route) directly after E09b in
 * throttle.mjs, E38 (vote stepper, own board) directly after E37 in
 * stage4.mjs – both change no instance setting, so both run before E09; the
 * row tap of E31@390x844 lives in that pass (stage3.mjs).
 * MAX_BOARDS_PER_RUN stays 48 (scenarios/world.mjs).
 * Flake gate (P7-C, SPEC-M1 §33.1 l): --only E34,E35,E37,E38 --repeat 8.
 * Hotfix H1 (SPEC-M1 §35, Revision 24): E39 (touch editing on a phone that
 * reports a fine pointer, own board, no instance setting) directly after
 * E38, before E09; its flake gate is --only E39 --repeat 8.
 * Factory job 018: E40 (Esc clears the selection for a signed-in user after
 * the preventDefault of Nextcloud's header menus, pressed once and held; own
 * board, no instance setting) directly after E39, before E09; its flake gate
 * is --only E40 --repeat 8.
 * Factory job 023: E41 (lock items, own board, no instance setting; its pass
 * E41@390x844 follows it) directly after E40, before E09; its flake gate is
 * --only E41 --repeat 3.
 * Factory job 026: E42 (group items, own board, no instance setting; its pass
 * E42@390x844 follows it) directly after E41@390x844, before E09; its flake
 * gate is --only E42 --repeat 3.
 * Factory job 032 (M2 privacy notice): E43 (guests: name dialog, card once
 * per tab session, languages) and E44 (accounts: badge and one-time info;
 * the admin section) directly after E42@390x844, before E09. Both switch an
 * instance setting (theming URLs through the bridge, the notice through
 * route 27 as admin) and put it back in their `finally` (World.cleanup
 * once more).
 * Factory job 049: E45 (the board page after a final status on opening:
 * a stale list with a link, a bookmark, a deleted board on a phone with
 * touch; own boards, no instance setting) directly after E44, before E09;
 * its flake gate is --only E45 --repeat 3.
 */
import { E01, E02 } from './basic.mjs'
import { E03, E04, E04b, E05 } from './collab.mjs'
import { E06, E07, E08, E09 } from './infra.mjs'
import { E10, E11 } from './canvas.mjs'
import { E12 } from './coldstart.mjs'
import { E09b, E09c } from './throttle.mjs'
import { E13, E14 } from './leave.mjs'
import { E15, E16, E17 } from './round2.mjs'
import { E18, E19, E20 } from './stage0.mjs'
import { E21, E22, E23, E24, E25, E26 } from './stage1.mjs'
import { E27, E28, E29, E30, E36 } from './stage2.mjs'
import { E31, E31_PHONE, E31_TABLET, E32, E33, E33_PHONE, E33_TABLET, E28_PHONE, E28_TABLET } from './stage3.mjs'
import { E34, E35, E37, E38 } from './stage4.mjs'
import { E39 } from './touch.mjs'
import { E40 } from './escape.mjs'
import { E41, E41_PHONE } from './locks.mjs'
import { E42, E42_PHONE } from './groups.mjs'
import { E43, E44 } from './privacy.mjs'
import { E45 } from './final.mjs'

export const SCENARIOS = [E01, E02, E03, E04, E04b, E05, E06, E07, E08, E10, E11, E12, E09b, E09c, E13, E14, E15, E17, E18, E19, E20, E21, E22, E23, E24, E25, E26, E31, E31_PHONE, E31_TABLET, E32, E33, E33_PHONE, E33_TABLET, E34, E37, E38, E39, E40, E41, E41_PHONE, E42, E42_PHONE, E43, E44, E45, E09, E16, E27, E28, E28_PHONE, E28_TABLET, E29, E30, E35, E36]
