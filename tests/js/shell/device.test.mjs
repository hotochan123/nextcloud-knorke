/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Device class (src/util/device.js isViewOnlyDevice, SPEC-M0 §6.6, SPEC-M1
 * §6.5.4), pinned with Hotfix H1 (SPEC-M1 §35): ONE fine pointer anywhere
 * on the device ((any-pointer: fine)) means "can edit", also on a phone or
 * tablet with a touchscreen. Such a device lands in mode edit, and since H1
 * a finger creates there like the mouse. A device with touch only stays
 * view/vote. The class itself is unchanged by H1.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isViewOnlyDevice } from '../../../src/util/device.js'
import { modeFor } from '../../../src/board/mode.js'

/** A window whose matchMedia answers the media features in `on` with true. */
function win(on) {
	const asked = []
	return {
		asked,
		matchMedia(q) {
			asked.push(q)
			const m = /\(\s*([a-z-]+)\s*:\s*([a-z]+)\s*\)/.exec(q)
			return { matches: !!m && on.includes(`${m[1]}: ${m[2]}`), media: q }
		},
	}
}

test('touch only (any-pointer: coarse, no fine pointer): view only', () => {
	const w = win(['any-pointer: coarse', 'pointer: coarse'])
	assert.equal(isViewOnlyDevice(w), true)
	assert.deepEqual(w.asked, ['(any-pointer: fine)'], 'only (any-pointer: fine) decides')
})

test('touchscreen plus a fine pointer (pen, touchpad, a driver that reports one): can edit', () => {
	assert.equal(isViewOnlyDevice(win(['any-pointer: coarse', 'any-pointer: fine', 'pointer: coarse'])), false)
})

test('desktop with a mouse: can edit', () => {
	assert.equal(isViewOnlyDevice(win(['any-pointer: fine', 'pointer: fine'])), false)
})

test('no window, no matchMedia or a throwing matchMedia: not view only (no lock-out)', () => {
	assert.equal(isViewOnlyDevice(undefined), false)
	assert.equal(isViewOnlyDevice({}), false)
	assert.equal(isViewOnlyDevice({ matchMedia() { throw new Error('blocked') } }), false)
})

test('H1 precondition: an editor on a touch device with a fine pointer gets mode edit, on a touch-only device view or vote', () => {
	const fine = isViewOnlyDevice(win(['any-pointer: coarse', 'any-pointer: fine']))
	const touchOnly = isViewOnlyDevice(win(['any-pointer: coarse']))
	assert.equal(modeFor('edit', fine, { sessionOpen: false, preferVote: false }), 'edit')
	assert.equal(modeFor('edit', touchOnly, { sessionOpen: false, preferVote: false }), 'view')
	assert.equal(modeFor('edit', touchOnly, { sessionOpen: true, preferVote: false }), 'vote')
})
