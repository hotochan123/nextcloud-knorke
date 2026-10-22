/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Focus after bar clicks (SPEC-M1 §6.5.1, R2): a pointer click gives the
 * focus back to the canvas, a keyboard activation keeps it on the button.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { POINTER_RECENT_MS, isPointerActivation, notePointerDown, pointerRecently, refocusAfter } from '../../../src/components/focus.js'

test('pointer: click with detail > 0 or a pointerType; keyboard: detail 0', () => {
	assert.equal(isPointerActivation({ detail: 1 }, 0), true)
	assert.equal(isPointerActivation({ detail: 0, pointerType: 'mouse' }, 0), true)
	assert.equal(isPointerActivation({ detail: 0, pointerType: '' }, 0), false)
	assert.equal(isPointerActivation({ detail: 0 }, 0), false, 'Enter/Space on a button')
})

test('an event without pointer data (menu radio change) counts as pointer right after a pointerdown', () => {
	notePointerDown(1000)
	assert.equal(pointerRecently(1000 + POINTER_RECENT_MS), true)
	assert.equal(isPointerActivation(null, 1200), true)
	assert.equal(isPointerActivation({ type: 'change' }, 1200), true)
	assert.equal(isPointerActivation(null, 1001 + POINTER_RECENT_MS), false)
})

test('refocusAfter calls session.focusCanvas only for pointer activations', () => {
	const calls = []
	const session = { focusCanvas: () => calls.push(1) }
	assert.equal(refocusAfter({ detail: 1 }, session), true)
	assert.equal(refocusAfter({ detail: 0 }, session), false)
	assert.equal(refocusAfter({ detail: 1 }, null), false)
	assert.deepEqual(calls, [1])
})
