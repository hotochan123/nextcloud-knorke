/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Counterparts of the switching host-bridge actions (SPEC-M1 §8.4: "Jede
 * schaltende Aktion hat ihr Gegenstück im World.cleanup und in normalise_ns").
 * Pure – no bridge, no env.json on import – so dev/e2e/switches.test.mjs can
 * pin the pairing without a stack.
 *
 * A scenario switches through World.switch(action, …args), which records the
 * call first (a timed-out call may still have switched on the host);
 * World.cleanup() runs restoreCalls(recorded, env) through the bridge, also
 * after a red or timed-out scenario. dev/lib.sh normalise_ns does the same on
 * the host before and after every run.
 *
 *   links-policy on|off            → links-policy on              (key deleted)
 *   legal-links set|clear          → legal-links clear
 *   share-policy <key> <value>     → share-policy <key> default   (key deleted), once per key
 *   group-member add|remove <u> <g>→ group-member add|remove <u> <g> back to env.json .groups
 *   circles on|off                 → circles on
 *   app-config <key> <value>       → app-config <key> default     (the key's baseline), once per key
 *                                    (stage 4, SPEC-M1 §8.4 R19; P7-C, §33.1 j: "default"
 *                                    is the baseline – the profile value of
 *                                    HARNESS_APP_PROFILE in the dev profile, else the key
 *                                    deleted; normalise_ns puts HARNESS_APP_CONFIG back
 *                                    to the baseline as well)
 * No counterpart (RESETTING): bruteforce-reset, ratelimit-reset clear counters
 * (ratelimit-reset from P7-C also the daily byte counters wd:/wu:, §33.1 j).
 * No counterpart (CREATING, not switching):
 *   team-create, team-member       teams named knorke-e2e-…: team-create replaces
 *                                  a team of the same name, normalise_ns destroys
 *                                  them all (before and after every run)
 *   link-expire, seed-board        change only a board of the run, which
 *                                  World.cleanup deletes
 *   vote-expire                    (stage 3, SPEC-M1 §8.4 R16: "Ein Gegenstück
 *                                  ist nicht nötig") expires the open session
 *                                  of a board of the run; it closes on the
 *                                  next vote op or poll, and the board goes
 *   purge-tombstones               (stage 4, SPEC-M1 §8.4 R19: "kein Gegenstück")
 *                                  backdates and compacts the tombstones of a
 *                                  board of the run, which World.cleanup deletes
 */

/** Every action of hostbridge.sh that switches an instance setting. */
export const SWITCHING = Object.freeze(['links-policy', 'legal-links', 'share-policy', 'group-member', 'circles', 'app-config'])

/**
 * Actions that reset a counter or a cache and leave no setting behind (no
 * counterpart needed). ratelimit-reset (SPEC-M1 §8.4 R13) clears Nextcloud's
 * ILimiter state; World.limiterReset() calls it at the start of every scenario
 * that changes shares or searches recipients (E27, E28, E30) and
 * World.cleanup() once more when such a scenario ran.
 */
export const RESETTING = Object.freeze(['bruteforce-reset', 'ratelimit-reset'])

/**
 * Nextcloud booleans as occ and the provisioning API read them back (SPEC-M1
 * §24, R13): a key typed in Nextcloud's config lexicon reads 'true'/'false'
 * or '1'/'0', an untyped one 'yes'/'no' – NC 35 types more keys than NC 34.
 * The E cases and the bridge self-test compare tolerantly through these two.
 */
export const NC_TRUE = Object.freeze(['yes', 'true', '1'])
export const NC_FALSE = Object.freeze(['no', 'false', '0'])
export const ncTrue = (v) => v === true || v === 1 || (typeof v === 'string' && NC_TRUE.includes(v.trim().toLowerCase()))
export const ncFalse = (v) => v === false || v === 0 || (typeof v === 'string' && NC_FALSE.includes(v.trim().toLowerCase()))

/** Actions with a lasting effect but no counterpart in World.cleanup (see above). */
export const CREATING = Object.freeze(['team-create', 'team-member', 'link-expire', 'seed-board', 'vote-expire', 'purge-tombstones'])

/** Is user u a member of group g by default (env.json .groups, written by up.sh)? */
export function memberByDefault(env, user, group) {
	const list = env?.groups?.[group]
	return Array.isArray(list) && list.includes(user)
}

/**
 * The bridge calls that put back what `touched` switched, in a fixed order
 * (policy and theming first, then the Knorke app config, group members,
 * Circles last), each at most once.
 * touched: [[action, ...args], …] as recorded by World.switch (strings).
 */
export function restoreCalls(touched, env) {
	const policyKeys = []
	const appKeys = []
	const members = new Map()
	let links = false
	let legal = false
	let circles = false
	for (const [action, ...args] of touched) {
		if (action === 'links-policy') links = true
		else if (action === 'legal-links') legal = true
		else if (action === 'share-policy') {
			if (!policyKeys.includes(args[0])) policyKeys.push(args[0])
		} else if (action === 'group-member') {
			const [, user, group] = args
			members.set(`${user}\u0000${group}`, [user, group])
		} else if (action === 'app-config') {
			if (!appKeys.includes(args[0])) appKeys.push(args[0])
		} else if (action === 'circles') circles = true
		else if (!CREATING.includes(action)) throw new Error(`Brücken-Aktion ${action} hat kein Gegenstück (lib/switches.mjs)`)
	}
	const calls = []
	if (links) calls.push(['links-policy', 'on'])
	if (legal) calls.push(['legal-links', 'clear'])
	for (const key of policyKeys) calls.push(['share-policy', key, 'default'])
	for (const key of appKeys) calls.push(['app-config', key, 'default'])
	for (const [user, group] of members.values()) {
		calls.push(['group-member', memberByDefault(env, user, group) ? 'add' : 'remove', user, group])
	}
	if (circles) calls.push(['circles', 'on'])
	return calls
}

/**
 * Profile values of the dev profile (SPEC-M1 §33.1 j, ED-22): the same values
 * as HARNESS_APP_PROFILE in dev/lib.sh and dev/sim/contract.mjs
 * (dev/e2e/switches.test.mjs compares them). The prod profile
 * (KD_LOAD_PROFILE=prod) and the iPad profile have none.
 */
export const HARNESS_APP_PROFILE = Object.freeze({ budget_bytes_board_day: '0', budget_bytes_user_day: '0', link_limit: '1000' })

/**
 * The profile of a namespace from its env.json (SPEC-M1 §33.1 j): prod when
 * .load.profile is "prod", ipad when .ipad.profile is true, else dev – the
 * same rule as dev/lib.sh harness_profile.
 * @param {object} env env.json
 * @return {'prod'|'ipad'|'dev'}
 */
export function harnessProfile(env) {
	if (env?.load?.profile === 'prod') return 'prod'
	if (env?.ipad?.profile === true) return 'ipad'
	return 'dev'
}

/**
 * The baseline ("Grundstand", SPEC-M1 §33.1 j) of a HARNESS_APP_CONFIG key:
 * the profile value in the dev profile, else null (not set) – what
 * app-config <key> default stores (dev/lib.sh harness_baseline).
 * @param {object} env env.json
 * @param {string} key
 * @return {string|null}
 */
export function baselineOf(env, key) {
	return harnessProfile(env) === 'dev' && Object.prototype.hasOwnProperty.call(HARNESS_APP_PROFILE, key) ? HARNESS_APP_PROFILE[key] : null
}
