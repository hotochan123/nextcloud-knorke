/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Protocol number between bundle and server (SPEC-M0 §4.2, SPEC-M1 §4.3).
 * Every sync request sends it as "proto"; a mismatch answers 409 `protocol`
 * and the client reloads once. lib/AppInfo/Application.php holds the same
 * number; a shell test keeps the two equal.
 *
 * Protocol 2 is the whole M1 wire contract, frozen from stage 0 on (also the
 * fields later stages fill). A stage that has to change it needs a spec
 * revision and PROTOCOL = 3.
 */
export const PROTOCOL = 2
