/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Static self-test of the stage-1 browser scenarios (SPEC-M1 §8.4, rounds 1a and 1b)
 * – no browser, no stack (the scenario modules read env.json on import, so
 * they are checked as text): the order in scenarios/index.mjs, no
 * page.waitForFunction (Nextcloud's CSP, ENTWICKLUNG trap 9.10), and every
 * check label of scenarios/stage1.mjs names exactly ONE owner of a red result
 * (SPEC-M1 §9.6: a red test goes to one owner) as its prefix – [S], [C] or
 * [B], never two like [C/S]. Round 1b, phase 2 (R11): end and "+" handles
 * by their frozen names (§6.7), a selected connector with exactly 'start'
 * and 'end', the pasted anchored start at the anchor point; the pure helpers
 * of lib/geom.mjs (anchor formula pinned to the golden file and to the HTTP
 * harness's copy, handle names, pickHandle). Run:
 *   node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '../..')
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')

test('index: E21–E26 (E23 since round 1b) run after E20 and before E09, in id order', () => {
	const list = read('scenarios/index.mjs').match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	const at = (id) => list.indexOf(id)
	const ids = ['E21', 'E22', 'E23', 'E24', 'E25', 'E26']
	for (const id of ids) {
		assert.ok(at(id) > at('E20') && at(id) < at('E09'), `${id} between E20 and E09 (own boards, no instance setting)`)
	}
	assert.deepEqual(ids.map(at), [...ids.map(at)].sort((a, b) => a - b), 'in id order')
	assert.match(read('scenarios/index.mjs'), /import \{ E21, E22, E23, E24, E25, E26 \} from '\.\/stage1\.mjs'/)
})

test('stage1.mjs, round 1b: E23 covers the connector acceptance, E24 the copied connector, E26 "Connect" and N right after opening (R10)', () => {
	const src = read('scenarios/stage1.mjs')
	const part = (a, b) => src.slice(src.indexOf(a), src.indexOf(b))
	const e23 = part('export const E23 = {', '// ── E24')
	assert.ok(e23.length > 1000, 'E23 found')
	for (const [re, what] of [
		[/press\('l'\)/, 'tool L with the canvas focused'],
		[/toolPressed\(p, 'connector'\)/, 'aria-pressed of the connector tool'],
		[/K\.connector\(b\.page, KC\)/, 'bob\'s route'],
		[/live fremd/, 'the remote drag preview'],
		[/press\('Delete'\)/, 'deleting B'],
		[/nearPt\(it\.data\.end, dock, 2\)/, 'free end at the last docking point ±2'],
		[/press\('Control\+z'\)[\s\S]*end\?\.item === B/, 'undo binds again'],
		[/styleButton\(p, 'data\.route', 'elbow'\)/, 'route elbow'],
		[/dblclick/, 'label by double click'],
		[/editorKind\(p\)\) === 'label'/, 'editor kind label'],
		[/checkEndHandles\(t, p, KC, /, 'R11: a selected connector shows exactly start and end'],
		[/pickHandle\(hsR, 'end', endAt\)/, 'the end handle by its frozen name (position only as the fallback)'],
		[/pickHandle\(hsA, 'plus-b', /, 'the lower "+" handle by its frozen name'],
		[/sameList\(plusNames\(hsA\), ALL_PLUS\)/, 'the four "+" handles by name'],
		[/by === 'position'\) t\.note\(/, 'the position fallback leaves a note'],
	]) assert.match(e23, re, what)
	assert.doesNotMatch(e23, /nearestHandle\(/, 'no pick by position outside pickHandle')
	const ceh = part('async function checkEndHandles(', 'export const E23 = {')
	assert.match(ceh, /sameList\(names, \[\.\.\.END_HANDLES\]\.sort\(\)\)/, 'exactly the names start and end (no transformer, no "+" handle)')
	assert.match(ceh, /<= 12/, 'each end handle at its end of the route')
	const e24 = part('export const E24 = {', 'async function webkitPart(')
	assert.match(src, /put\.connector\(ids\.KC, \{ item: ids\.N1, ax: 1, ay: 0\.5 \}, \{ item: ids\.N2 \}/, 'the source has a connector between the notes')
	assert.match(e24, /d\.start\?\.item === n1\[0\][^\n]*d\.end\?\.item === n2\[0\]/, 'the pasted connector is bound to the copies')
	assert.match(e24, /anchorPoint\(n1\[1\], fr\[1\], d\.start\)/, 'R11: the anchor point from the new note box in the new frame and the stored ax/ay')
	assert.match(e24, /near\(g\.start\.x, anc\[0\], 0\.01\) && near\(g\.start\.y, anc\[1\], 0\.01\)/, 'R11: the route start exactly at the anchor, ±0.01')
	assert.match(src, /import \{ anchorPoint \} from '\.\.\/lib\/geom\.mjs'/, 'anchorPoint from the pure helper module')
	const e26 = src.slice(src.indexOf('export const E26 = {'))
	const open = e26.indexOf('await openBoard(a, board)')
	const n = e26.indexOf("await p.keyboard.press('n')")
	const fit = e26.indexOf('await fitAll(p)')
	assert.ok(open > 0 && n > open && fit > n, 'N right after openBoard, before anything focuses the canvas')
	assert.doesNotMatch(e26.slice(open, n), /click|focus\(|fitAll|focusCanvas/, 'no click and no focus between opening and N')
	assert.match(e26, /\[data-knorke-action=connect\]/, 'Connect')
	assert.match(e26, /connectBtn\.focus\(\)\n\t{3}await p\.keyboard\.press\('Enter'\)/, 'Connect from the keyboard')
})

test('stage1.mjs (018): E26 "Align items" – one Tab into the panel, the first Esc closes only the panel, the second Esc is a hard [S] check (no note instead)', () => {
	const src = read('scenarios/stage1.mjs')
	const e26 = src.slice(src.indexOf('export const E26 = {'))
	const step = e26.slice(e26.indexOf("t.step('„Align items“"), e26.indexOf("t.step('Fokus in der TopBar"))
	assert.ok(step.length > 1000, 'the Align items step of E26')
	assert.match(step, /alignBtn\.focus\(\)\n\t{2}await p\.keyboard\.press\('Enter'\)/, 'Enter on the toggle')
	assert.match(step, /afterTab\.align === 'left'/, 'one Tab leads to "Align left edges"')
	assert.match(step, /await leftBtn\.click\(\)/, 'a mouse click on a command')
	const esc = [...step.matchAll(/await p\.keyboard\.press\('Escape'\)/g)]
	assert.equal(esc.length, 2, 'two Esc')
	assert.match(step.slice(esc[1].index), /t\.check\(cleared, '\[S\] das zweite Esc leert die Auswahl/, 'the second Esc: a hard check')
	assert.doesNotMatch(step, /t\.note\(/, 'no note in place of a check')
})

test('stage1.mjs, round 1b phase 2: E23 checks C-1b-02 (a canvas press closes the open context-bar panel) before the double click', () => {
	const src = read('scenarios/stage1.mjs')
	const part = (a, b) => src.slice(src.indexOf(a), src.indexOf(b))
	const e23 = part('export const E23 = {', '// ── E24')
	const dismiss = e23.indexOf('await checkPanelDismiss(t, p, KC)')
	const styled = e23.indexOf("styleButton(p, 'style.dash', 'dashed')")
	const dbl = e23.indexOf('p.mouse.dblclick(')
	assert.ok(styled > 0 && dismiss > styled && dbl > dismiss, 'after the style choice (panel open), before the double click on the line')
	assert.ok(e23.indexOf('closeContextPanels(p)') > dismiss, 'closing by the toggle only as the fallback after the check')
	const fn = part('async function checkPanelDismiss(', '/**\n * R11 (§8.4 E23, §6.7)')
	assert.match(fn, /openSections\(page\)/, 'counts the open sections before and after')
	assert.match(fn, /if \(open === 0\) \{\n\t\tt\.note\(/, 'no open panel: a note, never a green check without a statement')
	assert.match(fn, /canvasPointOnLine\(page, id\)/, 'presses the selected connector\'s line where the canvas is hit')
	assert.match(fn, /'\[S\] ein Klick auf die Linie des ausgewählten Verbinders lässt ihn ausgewählt'/, 'selection kept (else the bar unmounts and the check says nothing)')
	assert.match(fn, /if \(sel\) \{[\s\S]*=== 0, \{ timeout: 2000 \}\)[\s\S]*t\.check\(shut === true, '\[C\] pointerdown auf der Leinwand schließt/, 'the [C] check only with the selection kept (one owner per red)')
	assert.match(fn, /await sleep\(600\)/, 'the press stays apart from the double click')
	const pt = part('async function canvasPointOnLine(', 'async function checkPanelDismiss(')
	assert.match(pt, /elementFromPoint\(x, y\)[\s\S]*closest\('\.knorke-canvas'\)/, 'only points where .knorke-canvas is hit (not the panel or a bar)')
	assert.doesNotMatch(pt, /0\.5\b/, 'never the middle of the line (the label sits there)')
})

test('stage1.mjs: no page.waitForFunction, every check label starts with exactly one owner [S], [C] or [B] (§9.6)', () => {
	const src = read('scenarios/stage1.mjs')
	assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ''), /waitForFunction/, 'CSP: poll from Node with until()')
	// every t.check/t.must call carries a label literal that starts with the owner (a call
	// whose line ends with a comma continues on the next line)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 60, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B)\] /.test(l)).map((l) => l.trim().slice(0, 120))
	assert.deepEqual(bad, [], 'checks without a label that starts with exactly one owner')
	// two owners must not come back anywhere in the file (labels, notes, comments)
	const dual = lines.flatMap((l, i) => (/\[(S|C|B)\s*[/,&+|]\s*(S|C|B)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners (SPEC-M1 §9.6: one owner per red check)')
})

test('stage1.mjs (R11): E21, E22 and E25 compare only the transformer handles and count the "+" handles by name', () => {
	const src = read('scenarios/stage1.mjs')
	const part = (a, b) => src.slice(src.indexOf(a), src.indexOf(b))
	assert.match(src, /const transformNames = \(hs\) => handleNames\(hs, TRANSFORM_HANDLES\)/)
	assert.match(src, /const plusNames = \(hs\) => handleNames\(hs, PLUS_HANDLES\)/)
	const e21 = part('export const E21 = {', '// ── E22')
	assert.match(e21, /sameList\(transformNames\(hs\), \['b', 'bl', 'br', 'l', 'r', 'rot', 't', 'tl', 'tr'\]\)/, 'E21 one shape: 8 + rot')
	assert.match(e21, /sameList\(plusNames\(hs\), ALL_PLUS\)/, 'E21 one shape: 4 "+"')
	assert.match(e21, /sameList\(transformNames\(hs2\), \['bl', 'br', 'tl', 'tr'\]\)/, 'E21 multi-selection: 4 corners')
	assert.match(e21, /plusNames\(hs2\)\.length === 0/, 'E21 multi-selection: 0 "+"')
	const e22 = part('export const E22 = {', '// ── E23')
	assert.match(e22, /sameList\(plusNames\(hsT\), ALL_PLUS\)/, 'E22 text: 4 "+"')
	const e25 = part('export const E25 = {', '// ── E26')
	assert.match(e25, /sameList\(transformNames\(hs\), \['b', 'bl', 'br', 'l', 'r', 't', 'tl', 'tr'\]\)/, 'E25 frame: 8, no rot')
	assert.match(e25, /plusNames\(hs\)\.length === 0/, 'E25 frame: 0 "+"')
})

test('lib/geom.mjs: anchorPoint = every case of connector-golden.json and = the HTTP harness copy (dev/sim/lib/geom.mjs)', async () => {
	const geo = await import('./lib/geom.mjs')
	const sim = await import('../sim/lib/geom.mjs')
	const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/connector-golden.json'), 'utf8'))
	assert.ok(golden.cases.length >= 20, `${golden.cases.length} cases`)
	for (const c of golden.cases) {
		const got = geo.anchorPoint(c.box, c.parent, c.ep)
		assert.deepEqual(got, c.expect, c.name)
		for (const v of got) assert.ok(!Object.is(v, -0), `${c.name}: no -0`)
	}
	// a deterministic sweep (LCG): both copies give the same numbers, bit for bit
	let seed = 12345
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
	for (let i = 0; i < 2000; i++) {
		const box = { x: Math.round(rnd() * 4000 - 2000), y: Math.round(rnd() * 4000 - 2000), w: Math.round(rnd() * 600 + 20), h: Math.round(rnd() * 600 + 20), r: i % 3 === 0 ? 0 : Math.round(rnd() * 720 - 360) }
		const parent = i % 2 ? { x: Math.round(rnd() * 1000), y: Math.round(rnd() * 1000) } : null
		const ep = i % 5 === 0 ? { item: 'X' } : { item: 'X', ax: Math.round(rnd() * 10000) / 10000, ay: Math.round(rnd() * 10000) / 10000 }
		assert.deepEqual(geo.anchorPoint(box, parent, ep), sim.anchorPoint(box, parent, ep), JSON.stringify({ box, parent, ep }))
	}
	assert.ok(Object.is(geo.q(-0.001, 100), 0), 'q never -0 (R7)')
	// the E24 case: right side midpoint of a 160 × 160 note at (40, 60) in a frame at (-350, -200)
	assert.deepEqual(geo.anchorPoint({ x: 40, y: 60, w: 160, h: 160, r: 0 }, { x: -350, y: -200 }, { item: 'N', ax: 1, ay: 0.5 }), [-150, -60])
})

test('lib/geom.mjs: frozen handle names (SPEC-M1 §6.7, R11) and pickHandle by name with the position fallback', async () => {
	const geo = await import('./lib/geom.mjs')
	const { ANCHORS } = await import('../../src/model/transform.js')
	assert.deepEqual([...geo.TRANSFORM_HANDLES], [...ANCHORS], 'transformer names = transform.ANCHORS (§6.2)')
	assert.deepEqual([...geo.END_HANDLES], ['start', 'end'])
	assert.deepEqual([...geo.PLUS_HANDLES], ['plus-t', 'plus-r', 'plus-b', 'plus-l'])
	const hs = [{ name: 'tl', x: 0, y: 0 }, { name: 'rot', x: 50, y: -28 }, { name: 'plus-b', x: 50, y: 130 }, { name: 'plus-r', x: 130, y: 50 }, { name: 'plus-t', x: 50, y: -30 }, { name: 'plus-l', x: -30, y: 50 }]
	assert.deepEqual(geo.handleNames(hs, geo.PLUS_HANDLES), ['plus-b', 'plus-l', 'plus-r', 'plus-t'])
	assert.deepEqual(geo.handleNames(hs, geo.TRANSFORM_HANDLES), ['rot', 'tl'])
	assert.equal(geo.handleNames(null, geo.PLUS_HANDLES), null)
	// by name, even when another handle lies nearer to the point
	const byName = geo.pickHandle(hs, 'plus-b', { x: 130, y: 52 })
	assert.equal(byName.name, 'plus-b')
	assert.equal(byName.by, 'name')
	assert.ok(Math.abs(byName.dist - Math.hypot(80, 78)) < 1e-9)
	assert.equal(geo.pickHandle(hs, 'plus-b').dist, Infinity, 'no point: dist Infinity')
	// name missing: nearest non-transformer handle, never a transformer handle
	const anon = [{ name: 'tl', x: 100, y: 100 }, { name: 'h0', x: 0, y: 0 }, { name: 'h1', x: 300, y: 50 }]
	const fb = geo.pickHandle(anon, 'end', { x: 101, y: 101 })
	assert.equal(fb.name, 'h0')
	assert.equal(fb.by, 'position')
	assert.equal(geo.pickHandle(anon, 'end', null), null, 'no name and no point: null')
	assert.equal(geo.pickHandle([{ name: 'tl', x: 0, y: 0 }], 'end', { x: 0, y: 0 }), null, 'only transformer handles: null')
	// a connector's handle list
	const conn = [{ name: 'start', x: 10, y: 10 }, { name: 'end', x: 400, y: 10 }]
	assert.deepEqual(conn.map((h) => h.name).sort(), [...geo.END_HANDLES].sort())
	assert.equal(geo.pickHandle(conn, 'end', { x: 0, y: 0 }).x, 400)
})
