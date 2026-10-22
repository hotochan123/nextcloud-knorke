/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Client mode from role and device (SPEC-M1 §6.5.4, stage 2). Pure: no DOM,
 * no texts (the banner and toast texts live in components/banner.js), so the
 * rules can be checked in Node.
 *
 * `role` is always me.role (owner | edit | vote | view, never 'moderate');
 * the moderation right travels separately as me.mod. The access level
 * (Zugangsstufe, §4.9) combines both: owner | moderate | edit | vote | view.
 *
 * modeFor (frozen formula of §6.5.4):
 *   edit: canEdit(role) && !deviceViewOnly && !(sessionOpen && preferVote)
 *   vote: canVote(role) && sessionOpen && (deviceViewOnly || role === 'vote' || preferVote)
 *   view: otherwise
 *
 * bannerFor (R13, the first matching rule wins):
 *   1. role === 'view'                    → 'view_role'
 *   2. role === 'vote' && !votingEnabled  → 'view_role'
 *   3. role === 'vote' && !sessionOpen    → 'vote_ready'
 *   4. canEdit(role) && deviceViewOnly    → votingEnabled ? 'device_vote' : 'viewonly'
 *   5. otherwise null
 * votingEnabled is FEATURES.voting (false until stage 3). ConnectionBanner
 * shows exactly this one result next to the status banner, none while the
 * board is frozen.
 *
 * roleToastFor (R13, CLI-09): the toast after a live role change names the
 * NEW access level, only when it changed; never for 'owner'. Without voting
 * the vote level reads like view ("You can now only view this board.").
 */
import { FEATURES } from '../util/features.js'

/** Roles of me.role (SPEC-M1 §4.9). */
export const ROLES = Object.freeze(['owner', 'edit', 'vote', 'view'])
/** Access levels (Zugangsstufen, §4.9): the request field `role` and the board list. */
export const ACCESS = Object.freeze(['owner', 'moderate', 'edit', 'vote', 'view'])
/** Client modes (state().uiMode, scene.setMode). */
export const MODES = Object.freeze(['edit', 'vote', 'view'])

/**
 * @param {string|null|undefined} role me.role
 * @return {boolean} owner or edit (Role::canEdit)
 */
export function canEdit(role) {
	return role === 'owner' || role === 'edit'
}

/**
 * @param {string|null|undefined} role me.role
 * @return {boolean} owner, edit or vote (Role::canVote)
 */
export function canVote(role) {
	return role === 'owner' || role === 'edit' || role === 'vote'
}

/**
 * Client mode (SPEC-M1 §6.5.4).
 *
 * @param {string|null|undefined} role me.role
 * @param {boolean} deviceViewOnly the device has no fine pointer (util/device.js)
 * @param {{sessionOpen?: boolean, preferVote?: boolean}} [o] an open vote
 *   session (stage 3) and the desktop switch "Vote"/"Edit"
 * @return {'edit'|'vote'|'view'}
 */
export function modeFor(role, deviceViewOnly, { sessionOpen = false, preferVote = false } = {}) {
	const device = !!deviceViewOnly
	const open = !!sessionOpen
	const prefer = !!preferVote
	if (canEdit(role) && !device && !(open && prefer)) {
		return 'edit'
	}
	if (canVote(role) && open && (device || role === 'vote' || prefer)) {
		return 'vote'
	}
	return 'view'
}

/**
 * The one role/device banner next to the status banner (SPEC-M1 §6.5.4, R13).
 *
 * @param {string|null|undefined} role me.role (never 'moderate')
 * @param {boolean} deviceViewOnly the device has no fine pointer
 * @param {{sessionOpen?: boolean, votingEnabled?: boolean}} [o] an open vote
 *   session; votingEnabled defaults to FEATURES.voting
 * @return {'view_role'|'vote_ready'|'device_vote'|'viewonly'|null}
 */
export function bannerFor(role, deviceViewOnly, { sessionOpen = false, votingEnabled = FEATURES.voting } = {}) {
	if (role === 'view') {
		return 'view_role'
	}
	if (role === 'vote' && !votingEnabled) {
		return 'view_role'
	}
	if (role === 'vote' && !sessionOpen) {
		return 'vote_ready'
	}
	if (canEdit(role) && deviceViewOnly) {
		return votingEnabled ? 'device_vote' : 'viewonly'
	}
	return null
}

/**
 * Access level (Zugangsstufe, §4.9) of me.role and me.mod.
 *
 * @param {string|null|undefined} role me.role
 * @param {boolean|undefined} mod me.mod (canModerate)
 * @return {'owner'|'moderate'|'edit'|'vote'|'view'|null} null: unknown role
 */
export function accessOf(role, mod) {
	if (role === 'edit' && mod === true) {
		return 'moderate'
	}
	return typeof role === 'string' && ROLES.includes(role) ? role : null
}

/**
 * Which toast a live role change shows (SPEC-M1 §6.5.4, R13).
 *
 * @param {string|null} before access level before the change
 * @param {string|null} after access level after the change
 * @param {boolean} [votingEnabled] FEATURES.voting
 * @return {'facilitate'|'edit'|'vote'|'view'|null} null: no toast
 */
export function roleToastFor(before, after, votingEnabled = FEATURES.voting) {
	if (after === before || after === null || after === 'owner') {
		return null
	}
	switch (after) {
	case 'moderate':
		return 'facilitate'
	case 'edit':
		return 'edit'
	case 'vote':
		return votingEnabled ? 'vote' : 'view'
	case 'view':
		return 'view'
	default:
		return null
	}
}
