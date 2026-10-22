/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Review round P7 (SPEC-M1 §33.1 i, R22) in the shell:
 * - P7-08 (CLIENT-5, CLIENT-7): the vote stepper is clamped into the board
 *   container (centre ≥ half its width + 8 px from each side, top and
 *   bottom ≥ 8 px inside), every button ≥ 44 × 44 px, the new hook
 *   [data-knorke-action=vote-stepper-close]; the stepper shows only in mode
 *   vote while this person may vote and the board is not frozen; the vote
 *   setup dialog needs canModerate like the timer dialog.
 * - P7-11 (CLIENT-4): "Show on the board" closes the bottom sheet first in
 *   the narrow layout; with the side panel the covered canvas part is kept
 *   free (left in RTL); the hook [data-knorke-action=vote-focus] on every
 *   row text of the list and the ranking.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { STEPPER_MARGIN_PX, focusPlan, panelReserve, stepperCentre } from '../../../src/components/voteLayout.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const VoteStepper = (await import('../../../src/components/VoteStepper.vue')).default
const VotePanel = (await import('../../../src/components/VotePanel.vue')).default

/** Stepper size with three 44 px buttons (6 px padding, 8 px gaps, 1 px border, "0 / 3" in 3em). */
const STEPPER = { w: 215, h: 58 }

/**
 * @param {{x: number, y: number}} c centre
 * @param {{w: number, h: number}} own stepper size
 * @return {{l: number, r: number, t: number, b: number}} the stepper's box
 */
const box = (c, own = STEPPER) => ({ l: c.x - own.w / 2, r: c.x + own.w / 2, t: c.y - own.h / 2, b: c.y + own.h / 2 })

/**
 * @param {string} f repo path
 * @return {object} template AST
 */
function template(f) {
	const src = readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
	return parse(src.match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
}

/**
 * @param {object} node AST node
 * @param {(e: object) => boolean} pred element test
 * @param {object[]} [out] result
 * @return {object[]} matching elements
 */
function findAll(node, pred, out = []) {
	for (const c of node.children ?? []) {
		if (c.type === 1 && pred(c)) {
			out.push(c)
		}
		findAll(c, pred, out)
	}
	return out
}

/**
 * @param {object} el element
 * @param {string} name directive name (if, on …)
 * @param {string} [arg] argument (click …)
 * @return {string|undefined} the directive's expression
 */
function directive(el, name, arg = undefined) {
	return el.props.find((p) => p.type === 7 && p.name === name && (arg === undefined || p.arg?.content === arg))?.exp?.content
}

test('R22 P7-08 stepperCentre: at the item while unmeasured; clamped into the board container once measured (right, left, top, bottom edge)', () => {
	const rect = { x: 210, y: 292, w: 310, h: 310 }
	assert.deepEqual(stepperCentre(rect, null), { x: 365, y: 352 }, 'unmeasured: middle of the item, 60 px down (half of at most 120)')
	assert.equal(stepperCentre(null, null), null, 'no rect, nothing measured: CSS centre')
	// phone 390 × 844 (CLIENT-5 repro: the item half outside on the right)
	const phone = { ...STEPPER, bw: 390, bh: 844 }
	const c = stepperCentre(rect, phone)
	const b = box(c)
	assert.ok(b.r <= 390 - STEPPER_MARGIN_PX, 'right edge at least 8 px inside: ' + JSON.stringify(b))
	assert.ok(390 - c.x >= STEPPER.w / 2 + STEPPER_MARGIN_PX, 'the centre at least half the width + 8 px from the edge (whole px, rounded inwards)')
	assert.equal(c.x, Math.floor(390 - STEPPER.w / 2 - STEPPER_MARGIN_PX))
	assert.equal(c.y, 352, 'y needs no clamping')
	// desktop 1440 × 900: the item at the right border (stepper up to x = 1501 before)
	const d = stepperCentre({ x: 1298, y: 402, w: 300, h: 300 }, { ...STEPPER, bw: 1440, bh: 900 })
	assert.ok(box(d).r <= 1440 - 8)
	// left and top edge
	const lt = stepperCentre({ x: -250, y: -400, w: 300, h: 300 }, { ...STEPPER, bw: 1280, bh: 800 })
	assert.ok(box(lt).l >= 8 && box(lt).t >= 8, JSON.stringify(box(lt)))
	// bottom edge
	const bt = stepperCentre({ x: 600, y: 790, w: 100, h: 100 }, { ...STEPPER, bw: 1280, bh: 800 })
	assert.ok(box(bt).b <= 800 - 8)
	// the 1280 × 800 click-through case (board 1264 px wide): never 7.5 px from the edge
	const e = stepperCentre({ x: 1100, y: 260, w: 300, h: 300 }, { ...STEPPER, bw: 1264, bh: 742 })
	assert.ok(1264 - box(e).r >= 8, 'right margin ≥ 8 px: ' + (1264 - box(e).r))
	// an item in the middle stays where it is
	assert.deepEqual(stepperCentre({ x: 500, y: 300, w: 200, h: 80 }, { ...STEPPER, bw: 1280, bh: 800 }), { x: 600, y: 340 })
	// a container too small for the stepper: its middle
	assert.deepEqual(stepperCentre(rect, { ...STEPPER, bw: 200, bh: 60 }), { x: 100, y: 30 })
	// no rect but measured: the container's middle
	assert.deepEqual(stepperCentre(null, { ...STEPPER, bw: 1000, bh: 600 }), { x: 500, y: 300 })
})

test('R22 P7-08 E38 geometry: an item whose screen centre is ≤ 20 px from the right edge of a 1280 px container gets a stepper whose + and × lie fully inside', () => {
	const bw = 1280
	const bh = 800 - 50
	const item = { x: bw - 20 - 150, y: 300, w: 300, h: 300 }
	const c = stepperCentre(item, { ...STEPPER, bw, bh })
	const b = box(c)
	// + is the second 44 px button, × the third, from the left: padding 6 + border 1
	const plusL = b.l + 1 + 6 + 44 + 8 + (STEPPER.w - 2 - 12 - 3 * 44 - 3 * 8) + 8
	const closeR = b.r - 1 - 6
	assert.ok(b.l >= 8 && b.r <= bw - 8)
	assert.ok(plusL >= 0 && plusL + 44 <= bw)
	assert.ok(closeR <= bw && closeR - 44 >= 0)
})

test('R22 P7-08 VoteStepper: × carries [data-knorke-action=vote-stepper-close]; the style follows stepperCentre once measured; every button ≥ 44 × 44 px (CSS)', async () => {
	const props = { id: 'A', rect: { x: 1260, y: 300, w: 300, h: 300 }, mine: 0, perItem: 3, left: 9, text: 'Idea' }
	const html = await renderToString(createSSRApp(VoteStepper, props))
	assert.match(html, /<button[^>]*class="knorke-votestepper__close"[^>]*data-knorke-action="vote-stepper-close"/)
	assert.match(html, /data-knorke-action="vote-add"/)
	assert.match(html, /data-knorke-action="vote-remove"/)
	assert.match(html, /data-knorke-vote-stepper="A"/)
	const { bindings } = setupOf(VoteStepper, props)
	assert.deepEqual(bindings.style.value, { left: '1410px', top: '360px' }, 'before measuring: at the item')
	bindings.measured.value = { ...STEPPER, bw: 1280, bh: 750 }
	assert.deepEqual(bindings.style.value, { left: Math.floor(1280 - STEPPER.w / 2 - 8) + 'px', top: '360px' }, 'measured: clamped')
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /button\.knorke-votestepper__close \{[^}]*width: var\(--knorke-touch\) !important;[^}]*height: var\(--knorke-touch\) !important;/, '× is 44 × 44 px')
	assert.match(css, /button\.knorke-votepanel__step,\s*button\.knorke-votestepper__step \{[^}]*width: var\(--knorke-touch\) !important;[^}]*height: var\(--knorke-touch\) !important;/, '− and + are 44 × 44 px')
	assert.match(css, /\.knorke-votestepper \{[^}]*width: max-content;/, 'the measured width does not depend on where it stands')
	assert.match(css, /--knorke-touch: 44px;/)
	const src = readFileSync(new URL('../../../src/components/VoteStepper.vue', import.meta.url), 'utf8')
	assert.match(src, /onMounted\(\(\) => \{\s*measure\(\)/, 'measured right after mounting')
	assert.match(src, /watch\(\(\) => props\.rect, \(\) => nextTick\(measure\)\)/, 'and again for a new rect')
})

test('R22 P7-08 board view: the stepper only in mode vote while this person may vote and not frozen, its close tells the session; the vote setup needs canModerate and closes when it goes', () => {
	const ast = template('src/views/BoardView.vue')
	const st = findAll(ast, (e) => e.tag === 'VoteStepper')[0]
	const cond = directive(st, 'if')
	for (const part of ['stepper', 'votes.open', 'votes.canVote', 'uiMode === \'vote\'', '!frozen']) {
		assert.ok(cond.includes(part), 'VoteStepper v-if has ' + part + ': ' + cond)
	}
	assert.equal(directive(st, 'on', 'close'), 'closeStepper')
	const setup = findAll(ast, (e) => e.tag === 'VoteSetupDialog')[0]
	assert.match(directive(setup, 'if'), /^setupOpen && canModerate$/)
	assert.match(directive(findAll(ast, (e) => e.tag === 'TimerDialog')[0], 'if'), /^timerOpen && canModerate$/, 'like the timer dialog')
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(src, /function closeStepper\(\) \{\s*stepper\.value = null\s*session\.value\?\.closeStepper\(\)\s*\}/)
	assert.match(src, /watch\(canModerate, \(may\) => \{\s*if \(!may\) \{\s*setupOpen\.value = false\s*\}\s*\}\)/)
})

test('R22 P7-11 panelReserve and focusPlan: narrow closes the sheet and keeps nothing free; the side panel keeps its covered part free (right; left in RTL)', () => {
	const board = { left: 0, right: 820, width: 820 }
	const right = { left: 452, right: 812, width: 360 }
	assert.deepEqual(panelReserve(board, right), { left: 0, right: 368 })
	assert.deepEqual(panelReserve(board, { left: 8, right: 368, width: 360 }), { left: 368, right: 0 }, 'RTL: docked left')
	assert.deepEqual(panelReserve({ left: 100, right: 1280, width: 1180 }, { left: 912, right: 1272, width: 360 }), { left: 0, right: 368 }, 'board offset on the page')
	assert.deepEqual(panelReserve(board, null), { left: 0, right: 0 })
	assert.deepEqual(panelReserve(board, { left: 900, right: 1000, width: 100 }), { left: 0, right: 0 }, 'outside the board')
	assert.deepEqual(panelReserve(null, right), { left: 0, right: 0 })
	assert.deepEqual(focusPlan(true, { left: 0, right: 390, width: 390 }, { left: 0, right: 390, width: 390 }), { closeSheet: true, reserve: { left: 0, right: 0 } }, 'phone: close the sheet, the whole canvas')
	assert.deepEqual(focusPlan(false, board, right), { closeSheet: false, reserve: { left: 0, right: 368 } }, 'tablet: the panel stays')
	assert.deepEqual(focusPlan(false, board, null), { closeSheet: false, reserve: { left: 0, right: 0 } })
})

test('R22 P7-11 board view: a row text ("Show on the board") goes through focusItem: focusPlan, closePanel in the narrow layout, then zoomToItem with the reserve', () => {
	const ast = template('src/views/BoardView.vue')
	const panel = findAll(ast, (e) => e.tag === 'VotePanel')[0]
	assert.equal(directive(panel, 'on', 'focus'), 'focusItem')
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	const fn = src.match(/function focusItem\(id\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
	assert.match(fn, /const plan = focusPlan\(narrow\.value, board, panel\)/)
	assert.match(fn, /querySelector\?\.\('\[data-knorke-vote-panel\]'\)/)
	assert.match(fn, /if \(plan\.closeSheet\) \{\s*closePanel\(\)\s*\}\s*s\.zoomToItem\(id, plan\.reserve\)/, 'the sheet closes BEFORE the zoom')
	assert.match(src, /import \{ focusPlan \} from '\.\.\/components\/voteLayout\.js'/)
})

test('R22 P7-11 VotePanel: every row text of the list and of the ranking carries [data-knorke-action=vote-focus] and emits focus with its id', async () => {
	const votes = { sid: 1, state: 'open', open: true, left: 3, per: 3, perItem: 1, mine: {}, canVote: true, mod: false, results: null, show: false }
	const items = [{ id: 'A', text: 'Idea A', mine: 0 }, { id: 'B', text: 'Idea B', mine: 1 }]
	const html = await renderToString(createSSRApp(VotePanel, { votes, items }))
	const rows = html.match(/<li[^>]*data-knorke-vote-item="[AB]"[\s\S]*?<\/li>/g) ?? []
	assert.equal(rows.length, 2)
	for (const r of rows) {
		assert.equal((r.match(/data-knorke-action="vote-focus"/g) ?? []).length, 1, r)
	}
	const closed = { ...votes, state: 'closed', open: false, results: [['A', 2], ['B', 1]] }
	const html2 = await renderToString(createSSRApp(VotePanel, { votes: closed, lookup: () => ({ text: 'x', exists: true }) }))
	assert.equal((html2.match(/data-knorke-action="vote-focus"/g) ?? []).length, 2, 'the ranking rows too')
	const ast = template('src/components/VotePanel.vue')
	for (const b of findAll(ast, (e) => e.props.some((p) => p.type === 6 && p.name === 'data-knorke-action' && p.value?.content === 'vote-focus'))) {
		assert.match(directive(b, 'on', 'click'), /^\$emit\('focus', (it|r)\.id\)$/)
	}
})
