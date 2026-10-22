/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * board/mode.js (SPEC-M1 §6.5.4, stage 2): modeFor, bannerFor with its five
 * rules (R13, CLI-04), accessOf and the toast of a live role change (R13,
 * CLI-09).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACCESS, MODES, ROLES, accessOf, bannerFor, canEdit, canVote, modeFor, roleToastFor } from '../../../src/board/mode.js'
import { roleBannerFor, roleToastText } from '../../../src/components/banner.js'
import { FEATURES } from '../../../src/util/features.js'

/** The frozen formula of §6.5.4, written out independently. */
function expectedMode(role, device, open, prefer) {
	const edit = role === 'owner' || role === 'edit'
	const vote = edit || role === 'vote'
	if (edit && !device && !(open && prefer)) {
		return 'edit'
	}
	if (vote && open && (device || role === 'vote' || prefer)) {
		return 'vote'
	}
	return 'view'
}

test('mode: canEdit/canVote follow Role (owner|edit edit, owner|edit|vote vote)', () => {
	assert.deepEqual(ROLES, ['owner', 'edit', 'vote', 'view'])
	assert.deepEqual(ACCESS, ['owner', 'moderate', 'edit', 'vote', 'view'])
	assert.deepEqual(MODES, ['edit', 'vote', 'view'])
	assert.deepEqual(ROLES.map(canEdit), [true, true, false, false])
	assert.deepEqual(ROLES.map(canVote), [true, true, true, false])
	assert.equal(canEdit('moderate'), false, 'moderate is an access level, never me.role')
	assert.equal(canEdit(null), false)
	assert.equal(canVote(undefined), false)
})

test('modeFor: the whole matrix (4 roles × device × session × preferVote) equals the §6.5.4 formula', () => {
	let n = 0
	for (const role of [...ROLES, null, 'bogus']) {
		for (const device of [false, true]) {
			for (const open of [false, true]) {
				for (const prefer of [false, true]) {
					assert.equal(modeFor(role, device, { sessionOpen: open, preferVote: prefer }), expectedMode(role, device, open, prefer), JSON.stringify({ role, device, open, prefer }))
					n++
				}
			}
		}
	}
	assert.equal(n, 48)
})

test('modeFor: the stage-2 cases (no session): editor desktop edit, editor tablet view, vote and view roles view', () => {
	assert.equal(modeFor('owner', false), 'edit')
	assert.equal(modeFor('edit', false), 'edit')
	assert.equal(modeFor('edit', true), 'view', 'a tablet looks only (M0), no session to vote in')
	assert.equal(modeFor('vote', false), 'view', 'E27 carol: uiMode view')
	assert.equal(modeFor('vote', true), 'view')
	assert.equal(modeFor('view', false), 'view')
	assert.equal(modeFor('vote', false, { sessionOpen: true }), 'vote', 'stage 3: the vote role votes as soon as a session is open')
	assert.equal(modeFor('edit', false, { sessionOpen: true, preferVote: true }), 'vote')
	assert.equal(modeFor('edit', false, { sessionOpen: true, preferVote: false }), 'edit')
	assert.equal(modeFor('view', true, { sessionOpen: true, preferVote: true }), 'view', 'view never votes')
})

test('bannerFor (R13): the five rules in order, with and without voting', () => {
	for (const voting of [false, true]) {
		for (const device of [false, true]) {
			for (const open of [false, true]) {
				const o = { sessionOpen: open, votingEnabled: voting }
				assert.equal(bannerFor('view', device, o), 'view_role', 'rule 1')
				assert.equal(bannerFor('vote', device, o), !voting ? 'view_role' : !open ? 'vote_ready' : null, 'rules 2, 3, 5 ' + JSON.stringify(o))
				for (const r of ['owner', 'edit']) {
					assert.equal(bannerFor(r, device, o), device ? (voting ? 'device_vote' : 'viewonly') : null, 'rules 4, 5 ' + r + JSON.stringify({ device, ...o }))
				}
			}
		}
	}
	assert.equal(bannerFor(null, true, { votingEnabled: false }), null, 'unknown role: no banner')
	assert.equal(bannerFor('moderate', true, { votingEnabled: false }), null, 'role is me.role, never moderate')
})

test('bannerFor: votingEnabled defaults to FEATURES.voting (stage 3: true → device_vote on touch devices (E11, §12.3), vote_ready for the vote role)', () => {
	assert.equal(FEATURES.voting, true)
	assert.equal(bannerFor('edit', true), 'device_vote', 'M0 E11 sees device_vote from stage 3 on (CLI-04)')
	assert.equal(bannerFor('vote', false), 'vote_ready', 'E27/E28 stage 3')
	assert.equal(bannerFor('vote', false, { sessionOpen: true }), null, 'an open session: no banner, the vote bar takes over')
	assert.equal(bannerFor('view', false), 'view_role')
	assert.equal(bannerFor('owner', false), null)
	// the stage-2 behaviour stays reachable with the explicit switch
	assert.equal(bannerFor('edit', true, { votingEnabled: false }), 'viewonly')
	assert.equal(bannerFor('vote', false, { votingEnabled: false }), 'view_role')
})

test('role banner texts (§6.11): view_role, vote_ready, device_vote, viewonly; anything else none', () => {
	assert.deepEqual(roleBannerFor('view_role'), { kind: 'view_role', text: 'View only' })
	assert.deepEqual(roleBannerFor('vote_ready'), { kind: 'vote_ready', text: 'You can vote here when voting starts.' })
	assert.deepEqual(roleBannerFor('device_vote'), { kind: 'device_vote', text: 'On this device you can view and vote. Editing works on a computer.' })
	assert.deepEqual(roleBannerFor('viewonly'), { kind: 'viewonly', text: 'View only on this device' })
	assert.deepEqual(roleBannerFor(null), { kind: null, text: '' })
	assert.deepEqual(roleBannerFor('gone'), { kind: null, text: '' }, 'status kinds are not role banners')
})

test('accessOf: edit + mod → moderate; the roles pass; anything else null', () => {
	assert.equal(accessOf('edit', true), 'moderate')
	assert.equal(accessOf('edit', false), 'edit')
	assert.equal(accessOf('owner', true), 'owner', 'the owner stays owner')
	assert.equal(accessOf('vote', true), 'vote', 'only edit becomes moderate')
	assert.equal(accessOf('view', undefined), 'view')
	assert.equal(accessOf('moderate', false), null)
	assert.equal(accessOf(undefined, true), null)
})

test('roleToastFor (R13, CLI-09): names the NEW access level, only on a change, never owner; vote reads like view without voting', () => {
	const cases = [
		['edit', 'moderate', false, 'facilitate'],
		['view', 'edit', false, 'edit'],
		['moderate', 'edit', false, 'edit'],
		['edit', 'vote', true, 'vote'],
		['edit', 'vote', false, 'view'],
		['view', 'vote', false, 'view'],
		['edit', 'view', false, 'view'],
		['moderate', 'view', true, 'view'],
		['edit', 'edit', false, null],
		['moderate', 'moderate', true, null],
		['edit', 'owner', false, null],
		[null, 'edit', false, 'edit'],
		['edit', null, false, null],
	]
	for (const [before, after, voting, want] of cases) {
		assert.equal(roleToastFor(before, after, voting), want, JSON.stringify({ before, after, voting }))
	}
	assert.equal(roleToastText('facilitate'), 'You can now facilitate this board.')
	assert.equal(roleToastText('edit'), 'You can now edit this board.')
	assert.equal(roleToastText('vote'), 'You can now view and vote on this board.')
	assert.equal(roleToastText('view'), 'You can now only view this board.')
	assert.equal(roleToastText(null), null)
})

test('shell wiring (R13, stage 3): ConnectionBanner shows exactly the one role banner, never while frozen; BoardView feeds bannerFor(me.role, device, {sessionOpen, FEATURES.voting}) and gates the bars on uiMode', async () => {
	const { readFileSync } = await import('node:fs')
	const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
	const cb = read('src/components/ConnectionBanner.vue')
	assert.match(cb, /<div v-if="role\.kind && !frozen && showRole"[\s\S]*?:data-knorke-banner="role\.kind"/)
	assert.doesNotMatch(cb, /data-knorke-banner="viewonly"/, 'the M0 strip comes only from rule 4 now')
	assert.equal((cb.slice(0, cb.indexOf('<script')).match(/data-knorke-banner=/g) ?? []).length, 2, 'the status banner and the one role banner')
	assert.equal((cb.slice(0, cb.indexOf('<script')).match(/data-knorke-bar="banner"/g) ?? []).length, 2, 'both are banner strips (R16 (5))')
	const view = read('src/views/BoardView.vue')
	assert.match(view, /roleBannerFor\(me\.value\.role, deviceViewOnly, \{ sessionOpen: !!votes\.value\?\.open, votingEnabled: FEATURES\.voting \}\)/)
	assert.match(view, /:role-banner="roleBanner"/)
	assert.match(view, /<Toolbar v-if="ready && uiMode === 'edit' && !frozen"/)
	assert.match(view, /<ContextBar v-if="ready && uiMode === 'edit' && !frozen && selection\.count > 0"/)
	assert.match(view, /onMode: \(x\) => \{ uiMode\.value = x \}/)
})
