/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Build-time feature switches (SPEC-M1 §6.6, cross-contract `FEATURES` of
 * stage 2). There is no runtime or server switch for these; the E2E bridge
 * cannot flip them either (§8.4).
 *
 * voting: true since stage 3 (SPEC-M1 §9.4 WP-C3). While it was false (stage 2) the shell
 * hides the vote-link section in ShareLinks/LinkSettings, the role
 * "Can vote" in SharePeople, the vote-link intro and optional name in
 * GuestNameDialog, "Can vote" as the access label of a board-list row
 * (R14-12: such a row says "Can view", components/share.js accessLabel; the
 * owner's share dialog still shows a stored vote row as "Can vote"), and the
 * banners vote_ready/device_vote (board/mode.js
 * bannerFor gets votingEnabled = FEATURES.voting, §6.5.4, R13: without it the
 * vote role shows view_role and an editor on a touch device the M0 viewonly
 * strip). The roots of App.vue and PublicApp.vue carry
 * data-knorke-features="voting" or "" (R13), so E cases can tell the stages
 * apart. The server already knows the vote role and the vote link from
 * stage 2.
 */
export const FEATURES = Object.freeze({ voting: true })
