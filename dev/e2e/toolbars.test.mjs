/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E94 (the redesigned tool and zoom bars, factory job 229), no
 * browser, no stack:
 * - scenarios/index.mjs: E94 and its passes once each, directly after E93,
 *   before E09 (own board, no instance setting); the flake gate named
 * - E94: real input for each step of AK7 (clicks, a right-click, keys, a
 *   finger held through CDP touch events), the hooks of the bars
 * - (job 239) the first click opens the variants, a click or a finger's tap
 *   on the canvas right after it creates
 * - every check label names exactly one owner (SPEC-M1 §9.6)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/toolbars.mjs')

test('index: E94, E94@820x1180 and E94@360x780 once each, directly after E93, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	for (const id of ['E94', 'E94_TABLET', 'E94_PHONE']) assert.equal(list.filter((x) => x === id).length, 1, id)
	assert.equal(list.indexOf('E94'), list.indexOf('E93') + 1, 'directly after E93')
	assert.deepEqual(list.slice(list.indexOf('E94'), list.indexOf('E94') + 3), ['E94', 'E94_TABLET', 'E94_PHONE'])
	assert.ok(list.indexOf('E94_PHONE') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E94, E94_TABLET, E94_PHONE \} from '\.\/toolbars\.mjs'$/m)
	assert.ok(idx.includes('--only E94 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E94 = \{\n\tid: 'E94',/)
	assert.match(src, /export const E94_TABLET = \{\n\tid: 'E94',\n\tpass: `\$\{TABLET\.width\}x\$\{TABLET\.height\}`/)
	assert.match(src, /export const E94_PHONE = \{\n\tid: 'E94',\n\tpass: `\$\{PHONE\.width\}x\$\{PHONE\.height\}`/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
})

test('E94: real input and the hooks of AK7', () => {
	assert.match(src, /const ORDER = \['select', 'hand', 'sticky', 'shape', 'text', 'connector', 'frame', 'more'\]/)
	assert.match(src, /\[data-knorke-tool=frame\]`\)\.first\(\)\.click\(\{ button: 'right' \}\)/, 'a right-click')
	assert.match(src, /\[data-knorke-tool-variants=sticky\] \[data-knorke-tool-option=pad\]/)
	assert.match(src, /\[data-knorke-tool-variants=connector\] \.knorke-toolpop__group/)
	assert.match(src, /\[data-knorke-more-tools\] \[data-knorke-tool=table\]/)
	assert.match(src, /data-knorke-tool-picked/)
	assert.match(src, /localStorage\.setItem\(k, v\), \['knorke\.shapes'/, 'eight shapes stored before')
	assert.match(src, /\.knorke-shapes__foot/)
	assert.match(src, /keyboard\.press\('s'\)[\s\S]*canvasFocused\(p\)[\s\S]*keyboard\.press\('n'\)/, 'S opens the panel, the canvas keeps the focus, N chooses the note tool')
	assert.match(src, /\$\{UNDO\} \[data-knorke-action=undo\]/)
	// round 1 (fresh review): disabled without history, redo after undo, the popovers over the open panel on a phone
	assert.match(src, /\[data-knorke-action=redo\]`\)\.first\(\)\.isDisabled\(\)/)
	assert.match(src, /await redo\.click\(\)/)
	assert.match(src, /onTop\('\[data-knorke-more-tools\]'\)/)
	assert.match(src, /onTop\('\[data-knorke-tool-variants=sticky\]'\)/)
	assert.match(src, /menuAction\(p, 'zoom-100', \{ menus: ZOOM_MENUS \}\)/)
	assert.match(src, /\[data-knorke-action=zoom-selection\] button'\)\.first\(\)\.isDisabled\(\)/)
	assert.match(src, /await zoomToFrame\(p, F\)/)
	assert.match(src, /menuAction\(p, 'shortcuts', \{ menus: ZOOM_MENUS \}\)/)
	assert.match(src, /Input\.dispatchTouchEvent', \{ type: 'touchStart'[\s\S]*?await sleep\(650\)/, 'a finger held 650 ms')
	assert.match(src, /touch: true, fine: true, viewport: TABLET/)
	assert.match(src, /touch: true, fine: true, viewport: PHONE/)
	// job 239: one click opens the variants, the canvas click or finger tap right after it creates
	assert.match(src, /await note\.click\(\)\n[\s\S]*?shown\(p, '\[data-knorke-tool-variants=sticky\]'\)[\s\S]*?await p\.mouse\.click\(noteAt\.x, noteAt\.y\)/)
	assert.match(src, /dispatchTouchEvent', \{ type: 'touchStart', touchPoints: \[tapAt\] \}/)
	// round 1: Esc after a mouse click leaves the focus on the canvas, a key works then
	assert.match(src, /await note\.click\(\)\n[\s\S]*?keyboard\.press\('Escape'\)\n[\s\S]*?canvasFocused\(p\)[\s\S]*?keyboard\.press\('t'\)/)
	// round 2: the closing (second) click leaves the focus on the canvas, a key works then
	assert.match(src, /der zweite Klick schließt sie'\)[\s\S]*?canvasFocused\(p\)[\s\S]*?keyboard\.press\('l'\)/)
	assert.doesNotMatch(src, /page\.evaluate\([^)]*setTimeout|waitForFunction|waitForTimeout/, 'waits only from Node with until()')
})

test('E94: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 30, `${labels.length} labels`)
	for (const l of labels) {
		assert.match(l, /^\[[SCD]\] /, l)
		assert.doesNotMatch(l.slice(4), /\[[A-Z]\]/, l)
	}
})
