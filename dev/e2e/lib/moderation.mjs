/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Stage-3 helpers of the browser cases that need no stack (SPEC-M1 §8.4,
 * Revisions 16 and 17), so dev/e2e/moderation.test.mjs pins them with fakes.
 * This module imports nothing that reads env.json.
 *
 * - menuAction(page, name): clicks [data-knorke-action=<name>] in the
 *   moderation menu ([data-knorke-menu=moderation]) or in the overflow menu
 *   of the narrow layout ([data-knorke-menu=overflow]; §6.8 R16 CLI-09). The
 *   entries close the menu after a click (close-after-click, [C]), and the
 *   entries change with the state (summon ↔ summon-end). The trigger
 *   (button[aria-haspopup]) says aria-expanded="false" at once, while the
 *   popover still fades out with its old entries visible; a click on such an
 *   entry hangs until Playwright's timeout (stage 3, phase 1: one E33 run of
 *   [C] stopped at the second "summon" with "locator.click: Timeout 5000ms
 *   exceeded"). So (R17 K6, review finding R-D2):
 *   1. Fast path only for an entry that is NOT inside a popover
 *      (.v-popper__popper or [role=menu]; an inline button such as Share in
 *      the wide top bar): it is clicked directly.
 *   2. An entry inside a popover is clicked only while the menu's trigger
 *      says aria-expanded="true".
 *   3. Otherwise every open menu is closed first (any
 *      button[aria-haspopup][aria-expanded="true"]: Escape, then wait for
 *      aria-expanded="false"), the closing menu's entry has to go, the
 *      trigger opens the menu, and the entry is clicked once it shows.
 *   Escape is safe there: while an NcActions menu is open, NcActions handles
 *   Escape on document.body and calls preventDefault, and the canvas's
 *   window listener ignores a prevented key, so the selection the setup
 *   dialog reads stays. The session's own document listener would still end
 *   a follower's following, so on a page that follows someone the open
 *   menu is closed through its trigger instead. Closing falls back to the
 *   trigger when Escape did not close the menu.
 *   A failed click, or an entry missing in the open menu (the state that
 *   shows it lags behind), closes the menus the same way and tries again,
 *   `attempts` times in all; every further try is logged with its reason
 *   (run log), so a flake gate does not hide it. Every failure is an Error
 *   tagged with its owner, "[C] menuAction <name>: …" (the menu is [C]'s
 *   shell, §9.6), and a click that the entry did not take names the topmost
 *   element at the entry's centre (document.elementFromPoint), so a remaining
 *   timeout says whether something lay over the entry.
 * - cullClass / countCullSet: the renderer's culled set of SPEC-M1 §6.3
 *   (stats().voteState counts the rings among the items it draws nodes
 *   for): its cull rectangle, the stage with its overscan (job 034,
 *   __knorke.scene().overscan {l, r, t, b} in screen px), per side at least
 *   CULL_MARGIN of the viewport's width or height; without an overscan the
 *   viewport + CULL_MARGIN. It is intersected with the PADDED index boxes (a note by its
 *   shadow, STICKY_PAD_WORLD world units; src/model/SceneModel.js). A note
 *   whose plain screen rect overlaps that area by more than 1 px is 'in'; one
 *   whose padded rect does not reach it is 'out'; anything between is
 *   'edge' (the ring may or may not be drawn). E31 expects rings in
 *   [in, in + edge] (ask of [S] in stage 3, phase 1).
 */

/** The menus of a moderation entry (§6.8 R16), in this order. */
export const MENUS = Object.freeze(['[data-knorke-menu=moderation]', '[data-knorke-menu=overflow]'])
/** Every open menu trigger of the page (NcActions: aria-haspopup with aria-expanded="true"; R17 K6). */
export const OPEN_TRIGGERS = 'button[aria-haspopup][aria-expanded="true"]'
/** Culled set: viewport + this fraction of its width/height on every side (src/scene/KonvaRenderer.js CULL_MARGIN). */
export const CULL_MARGIN = 0.1
/** rbush padding of a note in world units: SHADOW.blur · 1.5 + |SHADOW.y| (src/model/SceneModel.js STICKY_PAD). */
export const STICKY_PAD_WORLD = 11

const pause = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const firstLine = (e) => String(e?.message || e).split('\n')[0]

/** Polls fn (errors count as false) until it is truthy or `timeout` ms passed. */
async function poll(fn, timeout, every) {
	const t0 = Date.now()
	for (;;) {
		let v = false
		try { v = await fn() } catch { v = false }
		if (v) return true
		if (Date.now() - t0 >= timeout) return false
		await pause(every)
	}
}

const isVisible = (loc) => loc.isVisible().then((v) => v === true, () => false)
const expandedOf = (trigger) => trigger.getAttribute('aria-expanded').then((v) => v, () => null)
const countOf = (loc) => loc.count().then((n) => (Number.isInteger(n) ? n : 0), () => 0)

/**
 * Runs in the page (locator.evaluate): is the entry inside a popover? Self-contained.
 * @param {Element} el the entry
 * @return {boolean}
 */
export function entryInPopover(el) {
	return !!(el && el.closest && el.closest('.v-popper__popper, [role=menu]'))
}

/**
 * Runs in the page (locator.evaluate): the topmost element at the entry's
 * centre (document.elementFromPoint), described as tag, hooks and classes.
 * Self-contained.
 * @param {Element} el the entry
 * @return {{x: number, y: number, hit: string, self: boolean}} self: the hit is the entry or inside it
 */
export function hitAtCentre(el) {
	const r = el.getBoundingClientRect()
	const x = Math.round(r.left + r.width / 2)
	const y = Math.round(r.top + r.height / 2)
	const hit = document.elementFromPoint(x, y)
	const desc = (n) => {
		if (!n) return 'nichts'
		const attrs = ['data-knorke-action', 'data-knorke-menu', 'data-knorke-bar', 'data-knorke-dialog', 'role']
			.map((k) => (n.getAttribute && n.getAttribute(k) ? `[${k}=${n.getAttribute(k)}]` : '')).join('')
		const cls = typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
		return `${String(n.tagName || n.nodeName || '?').toLowerCase()}${attrs}${cls}`
	}
	return { x, y, hit: desc(hit), self: !!hit && (hit === el || (typeof el.contains === 'function' && el.contains(hit))) }
}

/** One line for an error message: what lies at the entry's centre. */
export function hitText(h) {
	if (!h || typeof h !== 'object') return 'elementFromPoint nicht messbar'
	return `elementFromPoint(${h.x}, ${h.y}) = ${h.hit} (${h.self ? 'der Eintrag' : 'nicht der Eintrag'})`
}

/**
 * Clicks a moderation entry (see the header).
 * @param {object} page Playwright page (or a fake with locator/first/isVisible/click/count/evaluate/getAttribute, keyboard.press, evaluate)
 * @param {string} name value of data-knorke-action
 * @param {{attempts?: number, timeout?: number, settle?: number, every?: number, log?: (line: string) => void}} [o]
 *   attempts: tries in all (2); timeout: per click and wait in ms (5000);
 *   settle: how long a closing menu may take in ms (2000); every: poll step in ms (50);
 *   log: gets one line per further try with the reason (default console.log, so a retry
 *   shows in the run log and a flake gate does not hide it)
 * @return {Promise<{menu: string|null, attempt: number}>} the menu (null: fast path outside a popover) and the try that clicked
 */
export async function menuAction(page, name, { attempts = 2, timeout = 5000, settle = 2000, every = 50, log = (line) => console.log(line) } = {}) {
	const entry = page.locator(`[data-knorke-action=${name}]:visible`).first()
	const open = page.locator(OPEN_TRIGGERS)
	let last = null
	const inPopover = () => entry.evaluate(entryInPopover, null, { timeout: 1000 }).then((v) => v === true, () => null)
	const hit = () => entry.evaluate(hitAtCentre, null, { timeout: 1000 }).then(hitText, () => 'elementFromPoint nicht messbar (Eintrag weg)')
	/** Clicks the entry; on a failure it remembers why, with the topmost element at the entry's centre. */
	const click = async (where) => {
		try {
			await entry.click({ timeout })
			return true
		} catch (e) {
			last = `${where}: Eintrag ${name} nicht klickbar (${firstLine(e)}; ${await hit()})`
			return false
		}
	}
	/** Closes every open menu (see the header): Escape, for a follower the trigger; the trigger when Escape did not close it. */
	const closeMenus = async () => {
		if ((await countOf(open)) === 0) return
		const following = await page.evaluate(() => window.__knorke?.state?.()?.following ?? null).catch(() => null)
		if (following === null || following === undefined) await page.keyboard.press('Escape').catch(() => {})
		else await open.first().click({ timeout }).catch(() => {})
		if (await poll(async () => (await countOf(open)) === 0, settle, every)) return
		await open.first().click({ timeout }).catch(() => {})
		await poll(async () => (await countOf(open)) === 0, settle, every)
	}
	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (attempt > 1) log(`  … menuAction ${name}: Versuch ${attempt} von ${attempts} (${last})`)
		// 1. fast path: a visible entry outside every popover
		if ((await isVisible(entry)) && (await inPopover()) === false) {
			if (await click('außerhalb eines Menüs')) return { menu: null, attempt }
			continue
		}
		let menu = null
		for (const sel of MENUS) {
			if (await isVisible(page.locator(sel).first())) { menu = sel; break }
		}
		if (!menu) throw new Error(`[C] menuAction ${name}: kein Moderationsmenü sichtbar ([data-knorke-menu=moderation|overflow])`)
		const trigger = page.locator(menu).first().locator('button[aria-haspopup]').first()
		// 2. the menu is open and shows the entry
		if ((await expandedOf(trigger)) === 'true' && (await isVisible(entry))) {
			if (await click(menu)) return { menu, attempt }
			await closeMenus()
			continue
		}
		// 3. closed, closing or open without the entry: close every open menu, let the
		// fading popover's entry go, then the trigger opens the menu
		await closeMenus()
		await poll(async () => !(await isVisible(entry)), settle, every)
		try {
			await trigger.click({ timeout })
		} catch (e) {
			last = `${menu}: Auslöser nicht klickbar (${firstLine(e)})`
			continue
		}
		if (!(await poll(() => isVisible(entry), timeout, every))) {
			last = `${menu}: kein Eintrag [data-knorke-action=${name}] im Menü`
			await closeMenus()
			continue
		}
		if (await click(menu)) return { menu, attempt }
		await closeMenus()
	}
	throw new Error(`[C] menuAction ${name}: ${last} (nach ${attempts} Versuchen)`)
}

/**
 * Class of one item against the renderer's culled set (see the header).
 * @param {{x: number, y: number, w: number, h: number}|null} r screen rect of the item (itemScreenRect)
 * @param {{x: number, y: number, width: number, height: number}} box the canvas host's box (the viewport)
 * @param {{scale?: number, margin?: number, pad?: number, ov?: ({l?: number, r?: number, t?: number, b?: number}|null)}} [o]
 *   scale: camera scale; margin: CULL_MARGIN; pad: index padding in world units; ov: the stage's overscan per
 *   side in screen px (__knorke.scene().overscan; missing sides and a missing ov count as 0)
 * @return {'in'|'edge'|'out'}
 */
export function cullClass(r, box, { scale = 1, margin = CULL_MARGIN, pad = STICKY_PAD_WORLD, ov = null } = {}) {
	if (!r || !box || ![r.x, r.y, r.w, r.h, box.x, box.y, box.width, box.height].every(Number.isFinite)) return 'out'
	const side = (k) => (Number.isFinite(ov?.[k]) && ov[k] > 0 ? ov[k] : 0)
	const mx = box.width * margin
	const my = box.height * margin
	const a = {
		x0: box.x - Math.max(side('l'), mx), y0: box.y - Math.max(side('t'), my),
		x1: box.x + box.width + Math.max(side('r'), mx), y1: box.y + box.height + Math.max(side('b'), my),
	}
	const overlap = (q, grow) => ({
		x: Math.min(q.x + q.w + grow, a.x1) - Math.max(q.x - grow, a.x0),
		y: Math.min(q.y + q.h + grow, a.y1) - Math.max(q.y - grow, a.y0),
	})
	const plain = overlap(r, 0)
	if (plain.x > 1 && plain.y > 1) return 'in'
	const p = overlap(r, Math.max(0, pad) * (Number.isFinite(scale) && scale > 0 ? scale : 1) + 1)
	return p.x >= 0 && p.y >= 0 ? 'edge' : 'out'
}

/**
 * Counts items per class of the culled set.
 * @param {Array<object|null>} rects screen rects
 * @param {object} box canvas box
 * @param {object} [o] options of cullClass, passed on as they are (also ov, the overscan)
 * @return {{in: number, edge: number, out: number, classes: string[]}}
 */
export function countCullSet(rects, box, o = {}) {
	const classes = rects.map((r) => cullClass(r, box, o))
	const n = (c) => classes.filter((x) => x === c).length
	return { in: n('in'), edge: n('edge'), out: n('out'), classes }
}
