/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 223 (show everything clear of the bars), AK1: components/bars.js
 * chromeInsets turns the screen rectangles of the bars into the px they
 * cover at each edge of the board (the edge each one reaches least deep
 * from), and the risks of the spec: a tall tool bar on a tablet, RTL, a
 * board below Nextcloud's header, the bottom sheets of a phone (with
 * Camera.js freePart: the whole canvas then). Also: every bar and side
 * panel the view measures carries [data-knorke-chrome], and the view hands
 * the measurement to the session as ui.viewInsets.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromeInsets } from '../../../src/components/bars.js'
import { freePart } from '../../../src/scene/Camera.js'

const root = new URL('../../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

/** A 1280 × 800 board below Nextcloud's 50 px header. */
const BOARD = { left: 0, top: 50, right: 1280, bottom: 850 }
const r = (left, top, right, bottom) => ({ left, top, right, bottom })
const NONE = { top: 0, right: 0, bottom: 0, left: 0 }

test('AK1 a top bar over the full width covers only the top, measured from the board\'s top edge', () => {
	assert.deepEqual(chromeInsets(BOARD, [r(8, 58, 1272, 108)]), { ...NONE, top: 58 })
})

test('AK1 a tool bar on the left, vertically centred: left; the same on the right (RTL): right', () => {
	assert.deepEqual(chromeInsets(BOARD, [r(8, 300, 58, 600)]), { ...NONE, left: 58 })
	assert.deepEqual(chromeInsets(BOARD, [r(1222, 300, 1272, 600)]), { ...NONE, right: 58 })
})

test('AK1 the zoom controls in the bottom-right corner cover the bottom with their height, not the right edge', () => {
	assert.deepEqual(chromeInsets(BOARD, [r(1010, 792, 1272, 842)]), { ...NONE, bottom: 58 })
	// the round "?" beside them, a separate rectangle on the same edge
	assert.deepEqual(chromeInsets(BOARD, [r(1010, 792, 1272, 842), r(966, 796, 1004, 842)]), { ...NONE, bottom: 58 })
})

test('AK1 a side panel on the right over the full height covers the right edge with its width', () => {
	assert.deepEqual(chromeInsets(BOARD, [r(912, 118, 1272, 842)]), { ...NONE, right: 368 })
})

test('AK1 two rectangles at one edge: the larger depth; all bars of the wide layout together', () => {
	// the top bar and a banner below it
	assert.deepEqual(chromeInsets(BOARD, [r(8, 58, 1272, 108), r(400, 118, 880, 160)]), { ...NONE, top: 110 })
	const all = [r(8, 58, 1272, 108), r(8, 300, 58, 600), r(1010, 792, 1272, 842), r(912, 118, 1272, 782)]
	assert.deepEqual(chromeInsets(BOARD, all), { top: 58, right: 368, bottom: 58, left: 58 })
})

test('AK1 a rectangle without area or outside the board counts not; a board without area gives zeros', () => {
	assert.deepEqual(chromeInsets(BOARD, [r(8, 58, 8, 108), r(8, 58, 1272, 58)]), NONE)
	// Nextcloud's header above the board, something right of it
	assert.deepEqual(chromeInsets(BOARD, [r(0, 0, 1280, 50), r(1280, 300, 1400, 400)]), NONE)
	assert.deepEqual(chromeInsets(r(0, 0, 0, 800), [r(8, 58, 1272, 108)]), NONE)
	assert.deepEqual(chromeInsets(BOARD, []), NONE)
})

test('risk: a tablet\'s tall tool bar (almost the full height, coarse pointer) still counts on the left', () => {
	const tab = { left: 0, top: 56, right: 1848, bottom: 1036 }
	assert.deepEqual(chromeInsets(tab, [r(8, 70, 66, 1020)]), { ...NONE, left: 66 })
})

test('risk: a phone\'s bottom sheet (vote list, 75 vh) or the full-screen comment sheet leave too little: the whole canvas', () => {
	const phone = { left: 0, top: 50, right: 390, bottom: 844 }
	const sheet = chromeInsets(phone, [r(8, 58, 382, 108), r(0, 211, 390, 844)])
	assert.deepEqual(freePart(390, 794, 48, sheet), { x: 0, y: 0, w: 390, h: 794 })
	const full = chromeInsets(phone, [r(0, 50, 390, 844)])
	assert.deepEqual(freePart(390, 794, 48, full), { x: 0, y: 0, w: 390, h: 794 })
	// the phone's own bars alone still leave enough
	const bars = chromeInsets(phone, [r(8, 58, 382, 108), r(8, 300, 58, 600), r(200, 786, 382, 836)])
	assert.deepEqual(freePart(390, 794, 48, bars), { x: 58, y: 58, w: 332, h: 678 })
})

test('every floating bar and docked side panel carries data-knorke-chrome on its root; the view measures exactly that selector', () => {
	const roots = {
		'src/components/TopBar.vue': /<header class="knorke-topbar"[^>]*data-knorke-chrome/,
		'src/components/Toolbar.vue': /<nav ref="navEl"\s+class="knorke-toolbar"[^>]*data-knorke-chrome/,
		'src/components/ZoomControls.vue': /<div class="knorke-zoom" data-knorke-chrome/,
		// job 229: undo and redo in their own island
		'src/components/UndoBar.vue': /<div class="knorke-undo"[^>]*data-knorke-chrome/,
		// job 233: the session bar holds the vote bar
		'src/components/SessionBar.vue': /<div ref="root"\s+class="knorke-sessionbar"[^>]*data-knorke-chrome/,
		'src/components/VotePanel.vue': /<section class="knorke-votepanel"[^>]*data-knorke-chrome/,
		'src/components/CommentsPanel.vue': /<section class="knorke-comments"[^>]*data-knorke-chrome/,
		'src/components/ShapesPanel.vue': /class="knorke-shapes"[^>]*data-knorke-chrome/,
		'src/views/BoardView.vue': /class="knorke-banners" data-knorke-chrome/,
	}
	for (const [file, re] of Object.entries(roots)) {
		assert.match(read(file), re, file)
	}
	const view = read('src/views/BoardView.vue')
	assert.match(view, /querySelectorAll\('\[data-knorke-chrome\]'\)/)
	assert.match(view, /viewInsets: \(\) => viewInsets\(\)/)
})
