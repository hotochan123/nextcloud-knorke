/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Host-side self-test of lib/moderation.mjs (SPEC-M1 §8.4 R16/R17, stage 3),
 * no browser:
 *
 * - menuAction against a fake page whose menu behaves like NcActions with
 *   close-after-click: the trigger flips aria-expanded at once, the popover
 *   fades out with its old entries still visible, and a click on a fading
 *   entry hangs until the click timeout (the E33 run of [C] that stopped at
 *   the second "summon" with "locator.click: Timeout 5000ms exceeded").
 *   menuAction never clicks a fading entry and opens the menu through the
 *   trigger. R17 K6 (review finding R-D2): the fast path is taken only for an
 *   entry outside every popover; before the trigger opens a menu, every open
 *   menu is closed with Escape (NcActions closes on it) and the helper waits
 *   for aria-expanded="false" (a follower's page uses the trigger instead,
 *   Escape would end its following; a menu that ignores Escape is closed
 *   through its trigger); a failed click or a missing entry closes the
 *   menus the same way and tries once more; every further try is logged;
 *   every error carries the owner tag "[C] menuAction <name>:" and a click
 *   the entry did not take names document.elementFromPoint at its centre.
 * - entryInPopover / hitAtCentre / hitText (they run in the page) against a
 *   minimal fake DOM.
 * - cullClass / countCullSet: the culled set of SPEC-M1 §6.3 (the cull
 *   rectangle: the stage with its overscan ov, per side at least
 *   CULL_MARGIN; without ov the viewport + CULL_MARGIN; padded index boxes;
 *   ask of [S]; job 034); the constants are tied to the scene's own
 *   (src/scene/KonvaRenderer.js CULL_MARGIN, src/model/tokens.js SHADOW and
 *   src/model/SceneModel.js STICKY_PAD).
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	menuAction, cullClass, countCullSet, CULL_MARGIN, STICKY_PAD_WORLD, MENUS, OPEN_TRIGGERS, entryInPopover, hitAtCentre, hitText,
} from './lib/moderation.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A fake page with one NcActions-like menu.
 * @param {object} o
 * @param {string} [o.menu] which menu root is visible ('moderation' | 'overflow' | null)
 * @param {(name: string, opens: number) => boolean} [o.has] does the menu, opened for the `opens`-th time, render this entry
 * @param {number} [o.fadeMs] how long a closing popover keeps its entries visible
 * @param {boolean} [o.expanded] menu open at the start
 * @param {string[]} [o.fading] entries visible in a popover that is fading out at the start
 * @param {(name: string, n: number) => (string|null)} [o.failClick] error message for the n-th click on an entry (null = it works)
 * @param {string[]} [o.inline] entries rendered outside any popover (inline buttons), always visible
 * @param {boolean} [o.otherOpen] another NcActions menu of the page is open at the start
 * @param {string|null} [o.following] __knorke.state().following of the page
 * @param {boolean} [o.escIgnored] Escape closes nothing
 * @param {object} [o.hit] what hitAtCentre answers for an entry
 */
function fakePage({
	menu = 'moderation', has = () => true, fadeMs = 150, expanded = false, fading = [], failClick = () => null,
	inline = [], otherOpen = false, following = null, escIgnored = false, hit = { x: 10, y: 20, hit: 'div.v-popper__popper--hidden', self: false },
} = {}) {
	const st = {
		expanded,
		otherOpen,
		opens: expanded ? 1 : 0,
		fadeUntil: fading.length ? Date.now() + fadeMs : 0,
		fadeEntries: new Set(fading),
		log: [],
		keys: [],
		asked: [],
		clicksOnFading: 0,
		entryClicks: new Map(),
	}
	const fadingNow = () => Date.now() < st.fadeUntil
	const rendered = (name) => inline.includes(name) || (st.expanded && has(name, st.opens)) || (fadingNow() && st.fadeEntries.has(name))
	const closeMenu = () => {
		st.fadeEntries = new Set(['share', 'vote-setup', 'timer-open', 'summon', 'summon-end'].filter((n) => has(n, st.opens)))
		st.expanded = false
		st.fadeUntil = Date.now() + fadeMs
	}
	const timeoutError = (t) => new Error(`locator.click: Timeout ${t}ms exceeded.\nCall log: …`)
	const trigger = {
		getAttribute: async (a) => (a === 'aria-expanded' ? String(st.expanded) : null),
		click: async () => {
			st.log.push(st.expanded ? 'trigger:close' : 'trigger:open')
			if (st.expanded) closeMenu()
			else {
				st.expanded = true
				st.opens++
			}
		},
		first() { return this },
	}
	const openTriggers = {
		count: async () => (st.expanded ? 1 : 0) + (st.otherOpen ? 1 : 0),
		first() {
			return {
				click: async () => {
					if (st.expanded) return trigger.click()
					if (st.otherOpen) {
						st.otherOpen = false
						st.log.push('other:close')
					}
				},
			}
		},
	}
	const entryLoc = (name) => ({
		first() { return this },
		isVisible: async () => rendered(name),
		evaluate: async (fn) => {
			st.asked.push(fn === entryInPopover ? `inPopover:${name}` : fn === hitAtCentre ? `hit:${name}` : 'unknown')
			if (!rendered(name)) throw new Error('locator.evaluate: Timeout 1000ms exceeded.')
			if (fn === entryInPopover) return !inline.includes(name)
			if (fn === hitAtCentre) return hit
			throw new Error('unexpected page function')
		},
		click: async ({ timeout = 5000 } = {}) => {
			const n = (st.entryClicks.get(name) || 0) + 1
			if (inline.includes(name)) {
				st.entryClicks.set(name, n)
				const fail = failClick(name, n)
				if (fail) throw new Error(fail)
				st.log.push(`click:${name}`)
				return
			}
			if (!st.expanded || !has(name, st.opens)) {
				// a fading (or absent) entry: Playwright retries until its timeout
				if (fadingNow() && st.fadeEntries.has(name)) st.clicksOnFading++
				await pause(Math.min(timeout, 60))
				throw timeoutError(timeout)
			}
			st.entryClicks.set(name, n)
			const fail = failClick(name, n)
			if (fail) {
				await pause(10)
				throw new Error(fail)
			}
			st.log.push(`click:${name}`)
			closeMenu() // close-after-click
		},
	})
	const root = (sel) => ({
		first() { return this },
		isVisible: async () => sel === `[data-knorke-menu=${menu}]`,
		locator: (inner) => {
			assert.equal(inner, 'button[aria-haspopup]')
			return trigger
		},
	})
	return {
		st,
		keyboard: {
			press: async (k) => {
				st.keys.push(k)
				// NcActions closes an open menu on Escape (its listener on document.body)
				if (k !== 'Escape' || escIgnored) return
				if (st.expanded) {
					st.log.push('esc:close')
					closeMenu()
				}
				if (st.otherOpen) {
					st.log.push('esc:other')
					st.otherOpen = false
				}
			},
		},
		evaluate: async () => following,
		locator(sel) {
			const m = /^\[data-knorke-action=([a-z0-9-]+)\]:visible$/.exec(sel)
			if (m) return entryLoc(m[1])
			if (MENUS.includes(sel)) return root(sel)
			if (sel === OPEN_TRIGGERS) return openTriggers
			throw new Error(`unexpected selector ${sel}`)
		},
	}
}

const fast = { timeout: 200, settle: 500, every: 5, log: () => {} }

test('menuAction: a fading entry of the closed menu is never clicked; the trigger opens the menu, the entry is clicked once (second "summon" of E33)', async () => {
	// the previous click ("summon-end") closed the menu; its popover still fades with "summon" visible
	const page = fakePage({ fading: ['summon'], fadeMs: 120 })
	const lines = []
	const r = await menuAction(page, 'summon', { ...fast, log: (l) => lines.push(l) })
	assert.deepEqual(lines, [], 'no retry needed')
	assert.deepEqual(r, { menu: '[data-knorke-menu=moderation]', attempt: 1 })
	assert.equal(page.st.clicksOnFading, 0, 'no click on the fading entry')
	assert.ok(page.st.asked.includes('inPopover:summon'), 'the fading entry was asked whether it sits in a popover (it does: no fast path)')
	assert.deepEqual(page.st.log, ['trigger:open', 'click:summon'])
	assert.deepEqual(page.st.keys, [], 'no open menu, so no key pressed')
})

test('menuAction: two entries in a row (summon-end, then summon) both go through the trigger', async () => {
	const page = fakePage({ fadeMs: 80 })
	await menuAction(page, 'summon-end', fast)
	await menuAction(page, 'summon', fast)
	assert.deepEqual(page.st.log, ['trigger:open', 'click:summon-end', 'trigger:open', 'click:summon'])
	assert.equal(page.st.clicksOnFading, 0)
})

test('menuAction: an open menu (aria-expanded="true") with the entry is clicked directly', async () => {
	const page = fakePage({ expanded: true })
	const r = await menuAction(page, 'vote-setup', fast)
	assert.equal(r.attempt, 1)
	assert.deepEqual(page.st.log, ['click:vote-setup'])
	assert.deepEqual(page.st.keys, [])
})

test('menuAction (R17 K6): fast path only for an entry outside every popover – clicked directly, no trigger, no key, even without a visible menu', async () => {
	const page = fakePage({ menu: null, inline: ['share'] })
	const r = await menuAction(page, 'share', fast)
	assert.deepEqual(r, { menu: null, attempt: 1 })
	assert.deepEqual(page.st.log, ['click:share'])
	assert.deepEqual(page.st.keys, [])
	assert.deepEqual(page.st.asked, ['inPopover:share'])
})

test('menuAction (R17 K6): another open menu is closed with Escape before the trigger opens the moderation menu', async () => {
	const page = fakePage({ otherOpen: true })
	const r = await menuAction(page, 'timer-open', fast)
	assert.deepEqual(r, { menu: '[data-knorke-menu=moderation]', attempt: 1 })
	assert.deepEqual(page.st.keys, ['Escape'])
	assert.deepEqual(page.st.log, ['esc:other', 'trigger:open', 'click:timer-open'], 'Escape first, the trigger after aria-expanded="false"')
})

test('menuAction (R17 K6): on a page that follows someone the open menu is closed through its trigger, never with Escape (it would end the following)', async () => {
	const page = fakePage({ expanded: true, has: (name, opens) => name !== 'summon' || opens >= 2, following: 'p01', fadeMs: 40 })
	const r = await menuAction(page, 'summon', fast)
	assert.equal(r.attempt, 1, 'the open menu without the entry is closed and opened afresh in the same try')
	assert.deepEqual(page.st.keys, [])
	assert.deepEqual(page.st.log, ['trigger:close', 'trigger:open', 'click:summon'])
})

test('menuAction (R17 K6): a menu that ignores Escape is closed through its trigger', async () => {
	const page = fakePage({ otherOpen: true, escIgnored: true })
	await menuAction(page, 'summon', fast)
	assert.deepEqual(page.st.keys, ['Escape'])
	assert.deepEqual(page.st.log, ['other:close', 'trigger:open', 'click:summon'])
})

test('menuAction: an entry missing in the opened menu (state lags) → Escape closes it, the second opening has it', async () => {
	const page = fakePage({ has: (name, opens) => name !== 'summon' || opens >= 2, fadeMs: 40 })
	const lines = []
	const r = await menuAction(page, 'summon', { ...fast, log: (l) => lines.push(l) })
	assert.deepEqual(lines, ['  … menuAction summon: Versuch 2 von 2 ([data-knorke-menu=moderation]: kein Eintrag [data-knorke-action=summon] im Menü)'], 'the retry shows in the run log')
	assert.deepEqual(r, { menu: '[data-knorke-menu=moderation]', attempt: 2 })
	assert.deepEqual(page.st.log, ['trigger:open', 'esc:close', 'trigger:open', 'click:summon'])
	assert.deepEqual(page.st.keys, ['Escape'])
})

test('menuAction: a failed click (element not stable) closes the menu and tries again; the reason names elementFromPoint', async () => {
	const page = fakePage({ failClick: (name, n) => (n === 1 ? 'locator.click: element is not stable' : null), fadeMs: 40 })
	const lines = []
	const r = await menuAction(page, 'timer-open', { ...fast, log: (l) => lines.push(l) })
	assert.equal(r.attempt, 2)
	assert.equal(lines.length, 1)
	assert.match(lines[0], /^  … menuAction timer-open: Versuch 2 von 2 \(\[data-knorke-menu=moderation\]: Eintrag timer-open nicht klickbar \(locator\.click: element is not stable; elementFromPoint\(10, 20\) = div\.v-popper__popper--hidden \(nicht der Eintrag\)\)\)$/)
	assert.deepEqual(page.st.log, ['trigger:open', 'esc:close', 'trigger:open', 'click:timer-open'])
})

test('menuAction: the overflow menu of the narrow layout is used when the moderation menu is not visible', async () => {
	const page = fakePage({ menu: 'overflow' })
	const r = await menuAction(page, 'share', fast)
	assert.equal(r.menu, '[data-knorke-menu=overflow]')
	assert.deepEqual(page.st.log, ['trigger:open', 'click:share'])
})

test('menuAction: every error carries the owner tag [C] and names the step – no menu, entry missing in every try, click failing in every try (with elementFromPoint), fast-path click failing', async () => {
	await assert.rejects(menuAction(fakePage({ menu: null }), 'summon', fast), /^Error: \[C\] menuAction summon: kein Moderationsmenü sichtbar \(\[data-knorke-menu=moderation\|overflow\]\)$/)
	await assert.rejects(menuAction(fakePage({ has: (n) => n !== 'summon', fadeMs: 20 }), 'summon', fast),
		/^Error: \[C\] menuAction summon: \[data-knorke-menu=moderation\]: kein Eintrag \[data-knorke-action=summon\] im Menü \(nach 2 Versuchen\)$/)
	await assert.rejects(menuAction(fakePage({ failClick: () => 'locator.click: element is detached', fadeMs: 20 }), 'summon', fast),
		/^Error: \[C\] menuAction summon: \[data-knorke-menu=moderation\]: Eintrag summon nicht klickbar \(locator\.click: element is detached; elementFromPoint\(10, 20\) = div\.v-popper__popper--hidden \(nicht der Eintrag\)\) \(nach 2 Versuchen\)$/)
	const over = { x: 300, y: 12, hit: 'div[data-knorke-dialog=timer].modal-mask', self: false }
	await assert.rejects(menuAction(fakePage({ menu: null, inline: ['share'], failClick: () => 'locator.click: Timeout 200ms exceeded.', hit: over }), 'share', fast),
		/^Error: \[C\] menuAction share: außerhalb eines Menüs: Eintrag share nicht klickbar \(locator\.click: Timeout 200ms exceeded\.; elementFromPoint\(300, 12\) = div\[data-knorke-dialog=timer\]\.modal-mask \(nicht der Eintrag\)\) \(nach 2 Versuchen\)$/)
})

test('entryInPopover / hitAtCentre / hitText run against a minimal DOM and are self-contained (page.evaluate serialises them)', () => {
	const el = (tag, attrs = {}, cls = '', parent = null) => ({
		tagName: tag.toUpperCase(),
		className: cls,
		parent,
		getAttribute: (k) => attrs[k] ?? null,
		closest(sel) {
			for (let n = this; n; n = n.parent) if (n.matches(sel)) return n
			return null
		},
		matches(sel) { return sel.split(',').map((s) => s.trim()).some((s) => (s === '.v-popper__popper' && /\bv-popper__popper\b/.test(this.className)) || (s === '[role=menu]' && attrs.role === 'menu')) },
		contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false },
		getBoundingClientRect: () => ({ left: 100, top: 40, width: 120, height: 31 }),
	})
	const pop = el('div', {}, 'v-popper__popper v-popper__popper--shown')
	const inMenu = el('button', { 'data-knorke-action': 'summon' }, 'action-button', el('ul', { role: 'menu' }, '', pop))
	const inline = el('button', { 'data-knorke-action': 'share' }, 'button-vue', el('div', {}, 'knorke-topbar'))
	assert.equal(entryInPopover(inMenu), true)
	assert.equal(entryInPopover(inline), false)
	assert.equal(entryInPopover(el('li', { role: 'menu' })), true, '[role=menu] alone counts')
	const prev = globalThis.document
	try {
		const span = el('span', {}, 'action-button__text', inMenu)
		globalThis.document = { elementFromPoint: (x, y) => (x === 160 && y === 56 ? span : null) }
		assert.deepEqual(hitAtCentre(inMenu), { x: 160, y: 56, hit: 'span.action-button__text', self: true })
		const mask = el('div', { 'data-knorke-dialog': 'timer', role: 'dialog' }, 'modal-mask')
		globalThis.document = { elementFromPoint: () => mask }
		assert.deepEqual(hitAtCentre(inline), { x: 160, y: 56, hit: 'div[data-knorke-dialog=timer][role=dialog].modal-mask', self: false })
		globalThis.document = { elementFromPoint: () => null }
		assert.equal(hitAtCentre(inline).hit, 'nichts')
	} finally {
		if (prev === undefined) delete globalThis.document
		else globalThis.document = prev
	}
	assert.equal(hitText({ x: 1, y: 2, hit: 'button', self: true }), 'elementFromPoint(1, 2) = button (der Eintrag)')
	assert.equal(hitText(null), 'elementFromPoint nicht messbar')
	for (const fn of [entryInPopover, hitAtCentre]) {
		assert.doesNotMatch(fn.toString(), /\b(MENUS|OPEN_TRIGGERS|hitText|poll|pause|firstLine)\b/, `${fn.name}: no closure over module values`)
	}
	assert.equal(OPEN_TRIGGERS, 'button[aria-haspopup][aria-expanded="true"]')
})

test('stage3.mjs uses the library helper (no local menuAction that clicks a visible entry directly)', () => {
	const src = read('dev/e2e/scenarios/stage3.mjs')
	assert.match(src, /import \{ menuAction, countCullSet \} from '\.\.\/lib\/moderation\.mjs'/)
	assert.doesNotMatch(src, /async function menuAction/)
})

// ── culled set ───────────────────────────────────────────────────────────

const box = { x: 0, y: 100, width: 1000, height: 800 } // area with 10 %: x −100…1100, y 20…980
const rect = (x, y, w = 50, h = 50) => ({ x, y, w, h })

test('cullClass: inside the viewport and inside the 10-% margin → in; beyond margin + padding → out; in the padding band → edge', () => {
	assert.equal(cullClass(rect(100, 200), box), 'in')
	assert.equal(cullClass(rect(1040, 200), box), 'in', 'in the right margin (1000…1100)')
	assert.equal(cullClass(rect(200, 30, 50, 50), box), 'in', 'in the top margin (20…100)')
	assert.equal(cullClass(rect(1200, 200), box), 'out')
	assert.equal(cullClass(rect(1105, 200), box, { scale: 1 }), 'edge', 'padded by 11 px + 1 reaches 1100')
	assert.equal(cullClass(rect(1113, 200), box, { scale: 1 }), 'out', 'padded rect starts at 1101')
	assert.equal(cullClass(rect(1101, 200), box, { scale: 0.05 }), 'edge', 'at 5 % the padding is 0.55 px + 1')
	assert.equal(cullClass(rect(1102, 200), box, { scale: 0.05 }), 'out')
	assert.equal(cullClass(rect(1099.5, 200), box), 'edge', 'overlap ≤ 1 px is not certain')
	assert.equal(cullClass(null, box), 'out')
	assert.equal(cullClass(rect(Number.NaN, 0), box), 'out')
})

test('countCullSet: counts per class in order', () => {
	const r = countCullSet([rect(100, 200), rect(1040, 200), rect(1105, 200), rect(3000, 200), null], box, { scale: 1 })
	assert.deepEqual(r, { in: 2, edge: 1, out: 2, classes: ['in', 'in', 'edge', 'out', 'out'] })
})

// the stage's overscan (job 034): per side the larger of ov and the 10-% margin
const OV = { l: 384, r: 384, t: 384, b: 384 } // area x −384…1384, y −284…1284

test('cullClass with an overscan: the stage counts, never less than the 10-% margin', () => {
	assert.equal(cullClass(rect(1300, 200), box, { ov: OV }), 'in', 'inside the right overscan (1000…1384)')
	assert.equal(cullClass(rect(1390, 200), box, { ov: OV }), 'edge', 'in the padding band: padded by 11 px + 1 reaches 1384')
	assert.equal(cullClass(rect(1500, 200), box, { ov: OV }), 'out')
	assert.equal(cullClass(rect(-420, 200), box, { ov: OV }), 'in', 'left overscan')
	assert.equal(cullClass(rect(200, 1230), box, { ov: OV }), 'in', 'bottom overscan (900…1284)')
	assert.equal(cullClass(rect(1040, 200), box, { ov: { l: 50, r: 50, t: 50, b: 50 } }), 'in', 'ov 50 < 10 %: the margin of 100 stays')
	assert.equal(cullClass(rect(1105, 200), box, { ov: { l: 50, r: 50, t: 50, b: 50 } }), 'edge')
	// every side on its own; a missing side or a missing ov counts as 0
	assert.equal(cullClass(rect(1300, 200), box, { ov: { l: 384 } }), 'out', 'only the left side has an overscan')
	assert.equal(cullClass(rect(-420, 200), box, { ov: { l: 384 } }), 'in')
	assert.equal(cullClass(rect(1040, 200), box, { ov: null }), 'in')
	assert.equal(cullClass(rect(1200, 200), box, { ov: null }), 'out')
})

test('countCullSet passes the overscan on', () => {
	const rects = [rect(100, 200), rect(1300, 200), rect(1390, 200), rect(1500, 200)]
	assert.deepEqual(countCullSet(rects, box, { scale: 1, ov: OV }), { in: 2, edge: 1, out: 1, classes: ['in', 'in', 'edge', 'out'] })
	assert.deepEqual(countCullSet(rects, box, { scale: 1 }), { in: 1, edge: 0, out: 3, classes: ['in', 'out', 'out', 'out'] })
})

test('stage3.mjs hands __knorke.scene().overscan to countCullSet', () => {
	const src = read('dev/e2e/scenarios/stage3.mjs')
	assert.match(src, /const ov = \(await K\.scene\(page\)\)\?\.overscan \?\? null[\s\S]{0,200}countCullSet\(rects, box, \{ scale: cam\?\.scale, ov \}\)/)
	assert.doesNotMatch(src, /Viewport \+ 10 %/)
})

test('constants match the scene: CULL_MARGIN of KonvaRenderer.js, STICKY_PAD of SceneModel.js from SHADOW in tokens.js', () => {
	const m = read('src/scene/KonvaRenderer.js').match(/^export const CULL_MARGIN = ([0-9.]+)$/m)
	assert.ok(m, 'KonvaRenderer.js exports CULL_MARGIN')
	assert.equal(CULL_MARGIN, Number(m[1]))
	assert.match(read('src/model/SceneModel.js'), /^const STICKY_PAD = SHADOW\.blur \* 1\.5 \+ Math\.abs\(SHADOW\.y\)$/m)
	const sh = read('src/model/tokens.js').match(/^export const SHADOW = Object\.freeze\(\{ x: (-?[0-9.]+), y: (-?[0-9.]+), blur: ([0-9.]+),/m)
	assert.ok(sh, 'tokens.js SHADOW')
	assert.equal(STICKY_PAD_WORLD, Number(sh[3]) * 1.5 + Math.abs(Number(sh[2])))
})
