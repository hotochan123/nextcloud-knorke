/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Show everything clear of the bars (factory job 223, AK5).
 *
 * E90 alice with one board of her own, seeded through /sync with four
 * notes in the corners of a 3200 × 1800 area and a frame in the middle (a
 * wide board: with the old 48 px margin round the whole canvas its left
 * edge lay under the tool bar). alice on Chromium 1280 × 800 (wide layout):
 *   (1) "Show everything" (zoom controls): no item's screen rectangle
 *       overlaps the top bar, the tool bar, the zoom controls or (job 229)
 *       the undo island, and every one lies inside the canvas;
 *   (2) a click on a corner note, then "Zoom to selection" (job 229: in the
 *       zoom menu): that note clear of the bars and inside the canvas;
 *   (3) the zoom menu's "Frames", then the frame there: the frame clear of
 *       the bars;
 *   (4) the comment panel open (top bar "Comments"), Shift+1 on the
 *       canvas (the panel lies over the zoom controls in the wide layout,
 *       so their button is out of reach): no item under the panel, the
 *       other bars as in (1).
 * Own board, no instance setting: after E88, before E09.
 * Flake gate: --only E90 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] the board
 * in the browser, [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { CANVAS, K, openBoard, put, seedOps, ulid, until, zoomToFrame } from '../lib/harness.mjs'
import { ZOOM_MENUS, menuAction } from '../lib/moderation.mjs'

const TITLE = 'E90 Frei von den Leisten'
const VIEW = { width: 1280, height: 800 }
/** The bars the camera keeps clear of (job 223), by what the test can name. */
const BARS = {
	top: '[data-knorke-bar=top]',
	tools: '[data-knorke-toolbar]',
	zoom: '.knorke-zoom',
	undo: '.knorke-undo',
}
const PANEL = '[data-knorke-comments]'
/** Rounding of the screen rectangles (px). */
const TOL = 0.5

/** Bounding box of the first visible match (null when absent). */
const box = (page, sel) => page.locator(sel).first().boundingBox().catch(() => null)

/** Do two rectangles {x, y, w|width, h|height} overlap by more than TOL? */
function overlaps(a, b) {
	const aw = a.w ?? a.width
	const ah = a.h ?? a.height
	const bw = b.w ?? b.width
	const bh = b.h ?? b.height
	return a.x < b.x + bw - TOL && a.x + aw > b.x + TOL && a.y < b.y + bh - TOL && a.y + ah > b.y + TOL
}

/**
 * Where the items and the bars stand now.
 *
 * @param {object} page page
 * @param {string[]} ids items
 * @param {object} bars name → selector
 * @return {Promise<object>} {items: {id: rect}, bars: {name: box}, canvas, hits: [[id, bar]], outside: [id]}
 */
async function layout(page, ids, bars) {
	const canvas = await box(page, CANVAS)
	const items = {}
	for (const id of ids) items[id] = await K.rect(page, id).catch(() => null)
	const found = {}
	for (const [name, sel] of Object.entries(bars)) found[name] = await box(page, sel)
	const hits = []
	const outside = []
	for (const id of ids) {
		const r = items[id]
		if (!r || !canvas) {
			outside.push(id)
			continue
		}
		if (r.x < canvas.x - TOL || r.y < canvas.y - TOL || r.x + r.w > canvas.x + canvas.width + TOL || r.y + r.h > canvas.y + canvas.height + TOL) outside.push(id)
		for (const [name, b] of Object.entries(found)) {
			if (b && overlaps(r, b)) hits.push([id, name])
		}
	}
	return { items, bars: found, canvas, hits, outside }
}

/** Polls until the items stand clear of the bars and inside the canvas (the camera moved and drew); returns the last layout. */
async function clearOf(page, ids, bars) {
	let last = null
	await until(async () => {
		last = await layout(page, ids, bars)
		return last.hits.length === 0 && last.outside.length === 0 && Object.values(last.bars).every(Boolean)
	}, { timeout: 4000 })
	return last
}

export const E90 = {
	id: 'E90',
	title: 'Alles zeigen frei von den Leisten (Job 223): Show everything, Zoom to selection und die Rahmenliste legen den Inhalt neben TopBar, Werkzeugleiste, Zoom-Leiste und ein offenes Seitenpanel',
	async run(t, world) {
		const B = await world.board(TITLE)
		const notes = [ulid(), ulid(), ulid(), ulid()]
		const F = ulid()
		const corners = [[0, 0], [3000, 0], [0, 1600], [3000, 1600]]
		const res = await seedOps('alice', B, [
			...notes.map((id, i) => put.sticky(id, { x: corners[i][0], y: corners[i][1], data: { text: 'E90 ' + i } })),
			put.frame(F, { x: 1200, y: 600, w: 800, h: 600, data: { title: 'E90 Rahmen' } }),
		])
		t.must(res.length === 5 && res.every((r) => r === 'ok'), '[D] Vorbedingung: vier Notizen in den Ecken und ein Rahmen liegen auf dem Board', res)
		const all = [...notes, F]

		const a = await world.actor('alice-fitclear', { user: 'alice', viewport: VIEW })
		const p = a.page
		try {
			await openBoard(a, B)
			t.must(await until(async () => !!(await box(p, BARS.tools)) && !!(await box(p, BARS.zoom)), { timeout: 10000 }), '[D] Vorbedingung: Werkzeugleiste und Zoom-Leiste stehen da (breites Layout, Modus Edit)')

			t.step('(1) Show everything: alles neben den Leisten und in der Leinwand')
			await p.locator('.knorke-zoom button[aria-label="Show everything"]').first().click()
			const l1 = await clearOf(p, all, BARS)
			t.check(l1.hits.length === 0, '[C] (1) kein Objekt unter TopBar, Werkzeugleiste oder Zoom-Leiste', { hits: l1.hits, bars: l1.bars })
			t.check(l1.outside.length === 0, '[C] (1) jedes Objekt liegt in der Leinwand', { outside: l1.outside, canvas: l1.canvas })
			const left = Math.min(...all.map((id) => l1.items[id]?.x ?? Infinity))
			t.check(l1.bars.tools && left >= l1.bars.tools.x + l1.bars.tools.width - TOL, '[C] (1) der linke Rand des Inhalts liegt rechts der Werkzeugleiste', { left, tools: l1.bars.tools })

			t.step('(2) Zoom to selection: die gewählte Notiz neben den Leisten')
			const target = notes[0]
			const c = l1.items[target]
			t.must(!!c, '[D] Vorbedingung: die Notiz links oben hat ein Bildschirmrechteck', l1.items)
			await p.mouse.click(c.x + c.w / 2, c.y + c.h / 2)
			t.must(await until(async () => (await p.evaluate(() => window.__knorke.selection())).join() === target, { timeout: 5000 }), '[D] Vorbedingung: die Notiz ist ausgewählt')
			await menuAction(p, 'zoom-selection', { menus: ZOOM_MENUS })
			const l2 = await clearOf(p, [target], BARS)
			t.check(l2.hits.length === 0 && l2.outside.length === 0, '[C] (2) die Notiz steht nach "Zoom to selection" neben den Leisten in der Leinwand', { rect: l2.items[target], hits: l2.hits, outside: l2.outside })
			t.check((l2.items[target]?.w ?? 0) > (c.w ?? 0) + 1, '[C] (2) die Kamera hat auf die Notiz gezoomt', { before: c, after: l2.items[target] })
			await p.keyboard.press('Escape')

			t.step('(3) Rahmenliste: der Rahmen neben den Leisten')
			await zoomToFrame(p, F)
			const l3 = await clearOf(p, [F], BARS)
			t.check(l3.hits.length === 0 && l3.outside.length === 0, '[C] (3) der Rahmen steht nach dem Sprung aus der Rahmenliste neben den Leisten in der Leinwand', { rect: l3.items[F], hits: l3.hits, outside: l3.outside })

			t.step('(4) Kommentarpanel offen: Shift+1 lässt es frei')
			await p.locator('[data-knorke-action=comments]').first().click()
			t.must(await until(async () => !!(await box(p, PANEL)), { timeout: 5000 }), '[D] Vorbedingung: das Kommentarpanel ist offen')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Shift+Digit1')
			const l4 = await clearOf(p, all, { ...BARS, panel: PANEL })
			t.check(l4.hits.length === 0, '[C] (4) kein Objekt unter dem Kommentarpanel oder einer Leiste', { hits: l4.hits, panel: l4.bars.panel })
			t.check(l4.outside.length === 0, '[C] (4) jedes Objekt liegt in der Leinwand', { outside: l4.outside })
		} finally {
			await world.drop(a)
		}
	},
}
