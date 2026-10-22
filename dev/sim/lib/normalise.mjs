/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pure planners of normalise() in dev/sim/contract.mjs (SPEC-M1 §8.1, §24
 * R13): what has to change so that the harness groups of env.json hold
 * exactly their harness accounts again and no harness team (knorke-e2e-…) is
 * left behind by an interrupted run of C60–C68. The rules are the same as
 * dev/lib.sh normalise_groups / normalise_teams (bridge group-member and
 * team-create); dev/selftest/normalise.test.mjs pins both. No I/O here: the
 * caller reads `occ group:list --output=json` and
 * `occ circles:manage:list --output=json` and runs the returned calls.
 * P7-C (SPEC-M1 §33.1 j): harnessProfile (prod, ipad or dev from env.json)
 * and appConfigFixes (every HARNESS_APP_CONFIG key to its baseline – the
 * profile value in the dev profile, else not set), the rules of dev/lib.sh
 * harness_profile / harness_baseline / normalise_ns.
 */

/** Teams the harness creates are named <prefix><word> (KD_HARNESS_TEAM_PREFIX in dev/lib.sh). */
export const HARNESS_TEAM_PREFIX = 'knorke-e2e-'

/** Harness accounts and groups: the same patterns as dev/lib.sh harness_users / harness_groups. */
const USER_RE = /^[a-z][a-z0-9]{1,15}$/
const GROUP_RE = /^[a-z][a-z0-9-]{0,31}$/

/**
 * occ calls that put the harness groups back to env.json .groups: a missing
 * group is added, a harness account is added where it belongs and removed
 * where it does not; accounts that are no harness account (admin …) stay.
 *
 * @param {{users?: object, groups?: Record<string, string[]>}} env env.json
 * @param {Record<string, string[]>|null} current `occ group:list --output=json` (gid → members)
 * @return {string[][]} occ argument lists, e.g. ['group:adduser', 'knorke-e2e', 'carol']
 */
export function groupFixes(env, current) {
	const users = Object.keys(env?.users || {}).filter((u) => USER_RE.test(u))
	const groups = Object.keys(env?.groups || {}).filter((g) => GROUP_RE.test(g))
	const cur = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
	const calls = []
	for (const g of groups) {
		const want = new Set(Array.isArray(env.groups[g]) ? env.groups[g] : [])
		const exists = Object.prototype.hasOwnProperty.call(cur, g)
		const have = new Set(exists && Array.isArray(cur[g]) ? cur[g] : [])
		if (!exists) calls.push(['group:add', g])
		for (const u of users) {
			if (want.has(u) && !have.has(u)) calls.push(['group:adduser', g, u])
			else if (!want.has(u) && have.has(u)) calls.push(['group:removeuser', g, u])
		}
	}
	return calls
}

/**
 * The harness teams of a `occ circles:manage:list --output=json` list: name
 * starts with the prefix and the id is a Circles singleId (31 characters).
 * Teams of any other name stay.
 *
 * @param {Array<{id?: string, name?: string}>|null} list
 * @param {string} [prefix]
 * @return {Array<{id: string, name: string}>}
 */
export function harnessTeams(list, prefix = HARNESS_TEAM_PREFIX) {
	if (!Array.isArray(list)) return []
	return list
		.filter((t) => t && typeof t.name === 'string' && t.name.startsWith(prefix) && /^[A-Za-z0-9]{31}$/.test(String(t.id ?? '')))
		.map((t) => ({ id: t.id, name: t.name }))
}

/**
 * First JSON value of an occ output (some occ commands print notices before
 * it), or null.
 *
 * @param {string} out occ stdout
 * @return {any}
 */
export function occJson(out) {
	const s = String(out ?? '')
	const i = s.search(/^[[{]/m)
	if (i < 0) return null
	try {
		return JSON.parse(s.slice(i))
	} catch {
		return null
	}
}

/**
 * The profile of a namespace from its env.json (SPEC-M1 §33.1 j, ED-22): prod
 * when .load.profile is "prod", ipad when .ipad.profile is true, else dev –
 * the same rule as dev/lib.sh harness_profile.
 *
 * @param {object} env env.json
 * @return {'prod'|'ipad'|'dev'}
 */
export function harnessProfile(env) {
	if (env?.load?.profile === 'prod') return 'prod'
	if (env?.ipad?.profile === true) return 'ipad'
	return 'dev'
}

/**
 * occ calls that bring every Knorke app config key of the harness to its
 * baseline ("Grundstand", SPEC-M1 §33.1 j): the profile value in the dev
 * profile – set when it is missing or different –, else not set – deleted
 * when set. The same rule as dev/lib.sh normalise_ns (harness_baseline).
 *
 * @param {string[]} keys HARNESS_APP_CONFIG
 * @param {Record<string, string>} profileValues HARNESS_APP_PROFILE (the dev profile's values)
 * @param {string} profile harnessProfile(env)
 * @param {Record<string, string>} current key → stored value ('' or missing = not set)
 * @return {Array<{key: string, from: string, to: string|null, call: string[]}>}
 */
export function appConfigFixes(keys, profileValues, profile, current) {
	const out = []
	for (const key of keys) {
		const v = String(current?.[key] ?? '')
		const want = profile === 'dev' && Object.prototype.hasOwnProperty.call(profileValues, key) ? String(profileValues[key]) : null
		if (want !== null) {
			if (v !== want) out.push({ key, from: v, to: want, call: ['config:app:set', 'knorke', key, `--value=${want}`] })
		} else if (v !== '') {
			out.push({ key, from: v, to: null, call: ['config:app:delete', 'knorke', key] })
		}
	}
	return out
}
