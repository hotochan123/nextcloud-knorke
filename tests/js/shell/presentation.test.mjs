/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 272 (frames as slides): the wiring of PresentationLayer.vue
 * (template level): the slide list with its grips (pointer drag and
 * Alt+arrow keys), the presenter's and the viewer's buttons, the catcher
 * that keeps the board from input, the window key listener; the moderation
 * menu entry and the board view's hooks.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
const template = (f) => parse(read(f).match(/<template>([\s\S]*)<\/template>\s*<script/)[1])

function findAll(node, pred, out = []) {
	for (const c of node.children ?? []) {
		if (c.type === 1 && pred(c)) {
			out.push(c)
		}
		findAll(c, pred, out)
	}
	return out
}

const attr = (el, name) => el.props.some((p) => (p.type === 6 && p.name === name) || (p.type === 7 && p.arg?.content === name))
const on = (el, ev) => el.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === ev)
const action = (ast, key) => findAll(ast, (e) => e.props.some((p) => p.type === 6 && p.name === 'data-knorke-action' && p.value?.content === key))

test('AK7: the slide list (data-knorke-slides) has a grip per slide that drags with any pointer and moves with Alt+arrow keys, and a button per slide that jumps', () => {
	const ast = template('src/components/PresentationLayer.vue')
	const list = findAll(ast, (e) => attr(e, 'data-knorke-slides'))
	assert.equal(list.length, 1)
	const grips = findAll(list[0], (e) => attr(e, 'data-knorke-slide-grip'))
	assert.equal(grips.length, 1, 'one grip in the v-for row')
	for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown']) {
		assert.ok(on(grips[0], ev), 'grip ' + ev)
	}
	assert.equal(grips[0].tag, 'button')
	const jump = findAll(list[0], (e) => e.tag === 'button' && on(e, 'click') && attr(e, 'aria-current'))
	assert.equal(jump.length, 1)
	assert.ok(attr(jump[0], 'aria-current'))
	const src = read('src/components/PresentationLayer.vue')
	assert.match(src, /e\.key === 'ArrowUp' \? -1 : 1/)
	assert.match(src, /emit\('move', d\.id, d\.to\)/)
})

test('presenter and viewer controls; the catcher takes every pointer; keys are caught on the window in the capture phase', () => {
	const ast = template('src/components/PresentationLayer.vue')
	for (const k of ['slide-prev', 'slide-next', 'slides-panel', 'slides-end', 'look-around']) {
		assert.equal(action(ast, k).length, 1, k)
	}
	const catcher = findAll(ast, (e) => attr(e, 'data-knorke-present-catch'))[0]
	for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) {
		assert.ok(on(catcher, ev), 'catcher ' + ev)
	}
	const src = read('src/components/PresentationLayer.vue')
	assert.match(src, /window\.addEventListener\('keydown', onKey, true\)/)
	assert.match(src, /window\.removeEventListener\('keydown', onKey, true\)/)
	assert.match(src, /if \(!e\.repeat\) \{\s+emit\('step', STEP_KEYS\[e\.key\]\)/, 'a held key moves one slide')
	assert.match(src, /closest\('input, textarea, select, \[contenteditable=""\], \[contenteditable=true\], \[role=dialog\]'\) !== null\)\) \{\s+\/\/[^\n]*\n\s+return/, 'round 1: fields and dialogs keep their keys')
	assert.match(src, /emit\('insets', \{ right, bottom \}\)/, 'round 1: the bar and the list report what they cover')
	assert.equal(action(ast, 'slides-close').length, 1, 'round 2: the list closes by itself')
	const nav = findAll(ast, (e) => attr(e, 'data-knorke-slides'))[0]
	assert.match(nav.props.find((p) => p.type === 7 && p.arg?.content === 'style').exp.content, /bottom: barCover/, 'round 2: the list ends above the bar')
	assert.match(src, /const right = open && !overlay\.value \?/, 'round 2: no inset when the list lies over the slide')
})

test('"Present frames" in the moderation menu (only with frames), passed on by the top bar, started by the board view', () => {
	const mm = template('src/components/ModerationMenu.vue')
	const entry = action(mm, 'present')
	assert.equal(entry.length, 1)
	assert.match(entry[0].props.find((p) => p.name === 'if').exp.content, /canPresent/)
	const bar = read('src/components/TopBar.vue')
	assert.equal([...bar.matchAll(/@present="\$emit\('present'\)"/g)].length, 2, 'both moderation menus')
	const view = read('src/views/BoardView.vue')
	assert.match(view, /@present="startSlides"/)
	assert.match(view, /<PresentationLayer v-if="slides && ready"/)
	assert.match(view, /'knorke-board--presenting': !!slides/)
})
