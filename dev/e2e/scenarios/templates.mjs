/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Board templates (factory job 180).
 *
 * E69 alice (owner) and bob (shared with "view"), Chromium 1440 × 900 at
 * 100 %, on an empty board of their own titled "E69 Vorlagen". E68 is job
 * 179's (built at the same time), so this case takes the next number.
 * Steps (job 232: the start tiles instead of the button):
 *   (a) alice in mode edit sees the start tiles [data-knorke=start-templates]
 *       under "Start with a template": retro, swot, kanban, brainstorm and
 *       blank (own adopted tiles of other cases between them are left out),
 *       native buttons inside the view, at least 44 px high, and a press
 *       beside them in the layer reaches the canvas; the tile Kanban gives
 *       3 frames "To do", "Doing", "Done",
 *       each with one note and (job 188) one note pad, 9 items; exactly
 *       these frames are selected and lie with
 *       their title band inside the canvas, the bands free (the canvas is
 *       the topmost element there: neither the top bar nor the context bar
 *       covers a title); the tiles are gone and the canvas has the focus;
 *       Ctrl+Z empties the board and the tiles are back;
 *   (b) bob (mode view) has neither the tiles nor the menu entry
 *       insert-template in "⋯", but sees the inserted items by sync (and
 *       sees them go with the undo);
 *   (c) the context menu of the empty canvas lists insert-template right
 *       after note-here and (job 188) pad-here; "Insert template…" opens the dialog with 4 tiles,
 *       the first one focused; (job 237) none picked, "Insert" disabled,
 *       Enter inserts nothing; Esc closes it and no item comes;
 *   (d) "⋯" → "Insert template…" opens the dialog; (job 237) a click on
 *       Kanban only picks it (marked, the dialog stays, no item), the arrow
 *       key left picks the second tile (SWOT), Enter ("Insert") inserts 4
 *       frames; Ctrl+Z takes them away;
 *   (e) at 390 × 844 (narrow layout, still a mouse, so mode edit) the
 *       start tiles lie inside the view, two a row, none under the tool
 *       bar (job 232 round 2); "Blank" hides them, no
 *       item comes and the canvas has the focus.
 * In (c) every tile of the dialog is at least 200 px wide (the grid's
 * minmax(200px, 1fr)): Nextcloud's core CSS gives every native button
 * without .button-vue width: 130px (round 1).
 * Own board, no instance setting: before E09, after E67 (job 178's).
 * Flake gate: --only E69 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (camera, what lies where), [C] shell and session (button, dialog, menus,
 * items, selection, focus), [B] the server, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap
 * 9.10).
 */
import { K, CANVAS, api, itemMap, serverMap, openBoard, until, sleep, canvasFocused } from '../lib/harness.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'

/** The camera alice and bob open with: world (0, 0) in the middle of the canvas, 100 %. */
const CAM = Object.freeze({ x: 0, y: 0, scale: 1 })
const TITLE = 'E69 Vorlagen'
const START = '[data-knorke=start-templates]'
const DIALOG = '[data-knorke-dialog=templates]'
const TILE = '[data-knorke-template]'
const MENU = '[data-knorke-menu=context]'
/** The title band above a frame in world units (src/model/tokens.js FRAME_TITLE_BAND). */
export const TITLE_BAND = 40
export const KEYS = Object.freeze(['retro', 'swot', 'kanban', 'brainstorm'])

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, p) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [p.x, p.y, CANVAS]).catch(() => false)
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const count = (page, sel) => page.locator(sel).count().catch(() => -1)
/** The tiles of the open dialog, in order. */
const tiles = (page) => page.locator(`${DIALOG} ${TILE}`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-template'))).catch(() => [])
/** data-knorke-template of the focused tile (job 237: of the label around the focused radio; null: none). */
const focusedTile = (page) => page.evaluate(() => document.activeElement?.closest?.('[data-knorke-template]')?.getAttribute('data-knorke-template') ?? null).catch(() => null)
/** (job 237) The picked tiles of the open dialog. */
const pickedTiles = (page) => page.locator(`${DIALOG} ${TILE}[data-knorke-picked=true]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-template'))).catch(() => null)
/** (job 237) Is the dialog's "Insert" disabled? */
const insertOff = (page) => page.locator(`${DIALOG} [data-knorke-action=confirm]`).first().isDisabled().catch(() => null)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** (job 232) The start tiles (built-in and blank): key, box, native button, inside the view. */
const startTiles = (page) => page.locator(`${START} ${TILE}`).evaluateAll((els) => els.map((el) => {
	const r = el.getBoundingClientRect()
	return { key: el.getAttribute('data-knorke-template'), button: el.tagName === 'BUTTON', top: Math.round(r.top), h: Math.round(r.height),
		inView: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight }
})).catch(() => [])
/** (job 232) The point at the start layer's top left corner (beside the centred heading): the canvas is there. */
const layerCorner = (page) => page.locator(START).first().evaluate((el) => {
	const r = el.getBoundingClientRect()
	return { x: Math.round(r.left + 2), y: Math.round(r.top + 2) }
}).catch(() => null)
/** The tiles of the open dialog: width and whether each lies inside the view. */
const tileShapes = (page) => page.locator(`${DIALOG} ${TILE}`).evaluateAll((els) => els.map((el) => {
	const r = el.getBoundingClientRect()
	return { width: Math.round(r.width), inView: r.left >= 0 && r.right <= window.innerWidth }
})).catch(() => [])
/** Every tile fills its cell: at least 200 px (minmax(200px, 1fr)), all equally wide, inside the view. */
const tilesFill = (l) => l.length === 4 && l.every((x) => x.width >= 200 && x.inView && Math.abs(x.width - l[0].width) <= 1)

/** Frames and notes of the page's items: {frames: [{id, title, x, y, w, h}], notes: [{id, parent, text}]}. */
async function layout(page) {
	const m = await itemMap(page)
	const all = [...m.values()]
	return {
		size: m.size,
		frames: all.filter((it) => it.t === 'frame').map((f) => ({ id: f.id, title: f.data?.title ?? '', x: f.x, y: f.y, w: f.w, h: f.h })).sort((a, b) => a.x - b.x || a.y - b.y),
		notes: all.filter((it) => it.t === 'sticky').map((n) => ({ id: n.id, parent: n.parent, text: n.data?.text ?? '' })),
		// job 188: a note pad beside each note
		pads: all.filter((it) => it.t === 'pad').map((p) => ({ id: p.id, parent: p.parent })),
	}
}

/** Every frame with one note and (job 188) one note pad, the frame titles in order. */
function framesWithNotes(l, titles) {
	return same(l.frames.map((f) => f.title), titles) && l.notes.length === titles.length && l.pads.length === titles.length
		&& l.frames.every((f) => l.notes.filter((n) => n.parent === f.id).length === 1 && l.pads.filter((p) => p.parent === f.id).length === 1)
}

export const E69 = {
	id: 'E69',
	title: 'Vorlagen (Job 180, Job 232): Startkacheln auf dem leeren Board → Kanban mit 3 Frames und je einer Notiz und einem Notizblock, ausgewählt und samt Titel sichtbar, Strg+Z leert, die Kacheln kommen wieder; bob (view) ohne Kacheln und Menüeintrag sieht die Vorlage per Sync; Kontextmenü → Dialog mit 4 Kacheln, Esc ohne Objekt; ein Klick wählt nur, Pfeiltaste und Enter („Insert“) fügen ein (Job 237)',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'view' }])
		const a = await world.actor('alice-tpl', { user: 'alice' })
		const b = await world.actor('bob-tpl', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must((await K.state(pa)).uiMode === 'edit', '[D] Vorbedingung: alice im Modus edit', await K.state(pa))
			t.must((await K.state(pb)).uiMode === 'view', '[D] Vorbedingung: bob im Modus view', await K.state(pb))
			t.must((await itemMap(pa)).size === 0, '[D] Vorbedingung: das Board ist leer')

			t.step('(a) Startkacheln „Start with a template“ → Kanban, Auswahl und Kamera, Strg+Z')
			t.check(await until(() => visible(pa, START), { timeout: 5000 }), '[C] (a) alice sieht die Startkacheln auf dem leeren Board')
			t.check((await pa.locator(`${START} h2`).first().innerText().catch(() => '')).trim() === 'Start with a template', '[C] (a) die Überschrift heißt „Start with a template“')
			const st = await startTiles(pa)
			t.check(same(st.map((x) => x.key), [...KEYS, 'blank']), '[C] (a) Kacheln retro, swot, kanban, brainstorm, blank (Job 232)', st)
			t.check(st.every((x) => x.button && x.inView && x.h >= 44), '[C] (a) native Knöpfe, ≥ 44 px hoch, im sichtbaren Bereich', st)
			const corner = await layerCorner(pa)
			t.check(!!corner && await canvasAt(pa, corner), '[C] (a) neben den Kacheln erreicht ein Druck die Leinwand (die Ebene lässt durch)', corner)
			await pa.locator(`${START} [data-knorke-template=kanban]`).first().click()
			const ok = await until(async () => framesWithNotes(await layout(pa), ['To do', 'Doing', 'Done']), { timeout: 5000 })
			const la = await layout(pa)
			t.must(ok, '[C] (a) Kanban: 3 Frames „To do“, „Doing“, „Done“ mit je einer Notiz und (Job 188) einem Notizblock', la)
			t.check(la.size === 9, '[C] (a) genau 9 neue Objekte (Job 188: 3 Frames, 3 Notizen, 3 Blöcke)', la.size)
			const ids = la.frames.map((f) => f.id)
			t.check(same([...(await K.selection(pa))].sort(), [...ids].sort()), '[C] (a) genau die 3 Frames sind ausgewählt', { selection: await K.selection(pa), frames: ids })
			const cam = await K.camera(pa)
			const box = await pa.locator(CANVAS).first().boundingBox()
			const rects = []
			for (const id of ids) rects.push(await K.rect(pa, id))
			const inside = box && rects.every((r) => r && r.x >= box.x - 0.5 && r.y - TITLE_BAND * cam.scale >= box.y - 0.5
				&& r.x + r.w <= box.x + box.width + 0.5 && r.y + r.h <= box.y + box.height + 0.5)
			t.check(inside, '[S] (a) die Frames liegen samt Titelband im sichtbaren Bereich der Leinwand', { canvas: box, rects, scale: cam.scale })
			const bar = await pa.locator('[data-knorke-bar=top]').first().boundingBox().catch(() => null)
			if (bar && rects[0]) t.note(`(a) Titelband oben bei ${Math.round(rects[0].y - TITLE_BAND * cam.scale)} px, Kopfleiste unten bei ${Math.round(bar.y + bar.height)} px, Maßstab ${cam.scale.toFixed(3)}`)
			// the context bar of the new selection settles after the camera move
			await sleep(800)
			const bands = rects.filter(Boolean).flatMap((r) => [0.25, 0.75].map((f) => ({ x: Math.round(r.x + 12), y: Math.round(r.y - TITLE_BAND * cam.scale * f) })).concat([{ x: Math.round(r.x + r.w / 2), y: Math.round(r.y - TITLE_BAND * cam.scale / 2) }]))
			const covered = []
			for (const q of bands) if (!(await canvasAt(pa, q))) covered.push(q)
			t.check(bands.length === 9 && covered.length === 0, '[C] (a) die Titelbänder liegen frei: weder Kopfleiste noch Kontextleiste verdecken einen Titel', { covered, bands })
			t.check(await until(async () => (await count(pa, START)) === 0, { timeout: 3000 }), '[C] (a) die Startkacheln sind weg')
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[C] (a) die Zeichenfläche hat den Fokus')
			t.check(await until(async () => (await serverMap('alice', board)).size === 9, { timeout: 8000 }), '[B] (a) der Server hat die 9 Objekte')

			t.step('(b) bob (view): keine Startkacheln, kein Menüeintrag, die Vorlage per Sync')
			t.check(await until(async () => framesWithNotes(await layout(pb), ['To do', 'Doing', 'Done']), { timeout: 8000 }), '[C] (b) bob sieht die 3 Frames mit je einer Notiz und einem Block per Sync', await layout(pb))
			const boardMenu = pb.locator('[data-knorke-menu=board]').first()
			t.must(await boardMenu.isVisible().catch(() => false), '[D] (b) Vorbedingung: bob hat „⋯“ [data-knorke-menu=board]')
			await boardMenu.locator('button[aria-haspopup]').first().click()
			// job 228: insert-template stands in the submenu "Insert"
			t.must(await until(() => visible(pb, '[data-knorke-submenu=export]'), { timeout: 5000 }), '[D] (b) Vorbedingung: bobs Menü ist offen („Export ▸“)')
			t.check((await count(pb, '[data-knorke-submenu=insert]')) === 0 && (await count(pb, '[data-knorke-action=insert-template]')) === 0, '[C] (b) bobs „⋯“ hat kein „Insert ▸“ und keinen Eintrag insert-template')
			await pb.keyboard.press('Escape')

			// (a) continued: Ctrl+Z empties the board, the tiles are back
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).size === 0, { timeout: 5000 }), '[C] (a) Strg+Z leert das Board', (await layout(pa)).size)
			t.check(await until(() => visible(pa, START), { timeout: 5000 }), '[C] (a) die Startkacheln sind wieder da')
			t.check(await until(async () => (await itemMap(pb)).size === 0, { timeout: 8000 }), '[C] (b) bob sieht das Board wieder leer')
			await sleep(500)
			t.check((await count(pb, START)) === 0, '[C] (b) bob hat auf dem leeren Board keine Startkacheln')

			t.step('(c) Kontextmenü der leeren Fläche → „Insert template…“, Esc ohne Objekt')
			// job 232: left of the start tiles, which lie in the middle of the empty board
			const p = box ? { x: Math.round(box.x + 160), y: Math.round(box.y + box.height / 2) } : null
			t.must(p && await canvasAt(pa, p), '[D] (c) Vorbedingung: der Punkt liegt frei auf der Leinwand', p)
			await pa.mouse.click(p.x, p.y, { button: 'right' })
			t.must(await until(() => visible(pa, MENU), { timeout: 3000 }), '[C] (c) das Kontextmenü öffnet sich auf der leeren Fläche')
			const entries = await pa.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			// job 230: the menu of the empty canvas no longer lists it; "Mehr" › "Insert" › "Template…" (job 228) opens the dialog
			t.check(!entries.includes('insert-template'), '[C] (c) das Kontextmenü der leeren Fläche hat kein insert-template (Job 230)', entries)
			await pa.keyboard.press('Escape')
			const usedC = await menuAction(pa, 'insert-template', { menus: BOARD_MENUS })
			t.check(usedC?.menu === '[data-knorke-menu=board]', '[C] (c) insert-template steht in alices „⋯“', usedC)
			t.must(await until(() => visible(pa, DIALOG), { timeout: 5000 }), '[C] (c) der Eintrag öffnet den Dialog')
			t.check(same(await until(async () => { const l = await tiles(pa); return l.length === 4 ? l : null }, { timeout: 3000 }), KEYS), '[C] (c) der Dialog zeigt 4 Kacheln: retro, swot, kanban, brainstorm (kein „Blank“)', await tiles(pa))
			t.check(tilesFill(await tileShapes(pa)), '[C] (c) die Kacheln füllen ihre Zellen (je ≥ 200 px, gleich breit)', await tileShapes(pa))
			t.check(await until(async () => (await focusedTile(pa)) === 'retro', { timeout: 3000 }), '[C] (c) die erste Kachel hat den Fokus', await focusedTile(pa))
			// job 237: two steps, nothing picked when it opens
			t.check(same(await pickedTiles(pa), []), '[C] (c) keine Kachel ist gewählt (Job 237)', await pickedTiles(pa))
			t.check((await insertOff(pa)) === true, '[C] (c) „Insert“ ist deaktiviert (Job 237)', await insertOff(pa))
			await pa.keyboard.press('Enter')
			await sleep(800)
			t.check(await visible(pa, DIALOG) && (await itemMap(pa)).size === 0, '[C] (c) Enter ohne gewählte Kachel fügt nichts ein, der Dialog bleibt (Job 237)', (await layout(pa)).size)
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await count(pa, DIALOG)) === 0, { timeout: 5000 }), '[C] (c) Esc schließt den Dialog')
			await sleep(800)
			t.check((await itemMap(pa)).size === 0, '[C] (c) kein Objekt entsteht', (await layout(pa)).size)
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[C] (c) danach hat die Zeichenfläche den Fokus')

			t.step('(d) „⋯“ → „Insert template…“, Klick wählt nur, Pfeiltaste wählt SWOT, Enter fügt ein')
			const used = await menuAction(pa, 'insert-template', { menus: BOARD_MENUS })
			t.check(used?.menu === '[data-knorke-menu=board]', '[C] (d) insert-template steht in alices „⋯“', used)
			t.must(await until(() => visible(pa, DIALOG), { timeout: 5000 }), '[C] (d) der Eintrag öffnet den Dialog')
			t.must(await until(async () => (await focusedTile(pa)) === 'retro', { timeout: 3000 }), '[C] (d) die erste Kachel hat den Fokus', await focusedTile(pa))
			// job 237: a click only picks
			await pa.locator(`${DIALOG} [data-knorke-template=kanban]`).first().click()
			t.check(await until(async () => same(await pickedTiles(pa), ['kanban']), { timeout: 2000 }), '[C] (d) ein Klick wählt Kanban und markiert die Kachel (Job 237)', await pickedTiles(pa))
			await sleep(800)
			t.check(await visible(pa, DIALOG) && (await itemMap(pa)).size === 0, '[C] (d) der Klick fügt nichts ein, der Dialog bleibt offen (Job 237)', (await layout(pa)).size)
			t.check((await insertOff(pa)) === false, '[C] (d) „Insert“ ist aktiv (Job 237)', await insertOff(pa))
			await pa.keyboard.press('ArrowLeft')
			t.check(await until(async () => same(await pickedTiles(pa), ['swot']) && (await focusedTile(pa)) === 'swot', { timeout: 2000 }), '[C] (d) die Pfeiltaste wählt die zweite Kachel (SWOT)', { picked: await pickedTiles(pa), focus: await focusedTile(pa) })
			t.check((await itemMap(pa)).size === 0, '[C] (d) auch die Pfeiltaste fügt nichts ein (Job 237)', (await layout(pa)).size)
			await pa.keyboard.press('Enter')
			t.check(await until(async () => (await count(pa, DIALOG)) === 0, { timeout: 5000 }), '[C] (d) Enter („Insert“) schließt den Dialog')
			const swot = await until(async () => { const l = await layout(pa); return l.frames.length === 4 && l.notes.length === 4 ? l : null }, { timeout: 5000 })
			t.check(!!swot && same([...swot.frames.map((f) => f.title)].sort(), ['Opportunities', 'Strengths', 'Threats', 'Weaknesses']), '[C] (d) Enter fügt SWOT ein: 4 Frames mit je einer Notiz', swot ?? await layout(pa))
			t.check(same([...(await K.selection(pa))].sort(), [...(swot?.frames ?? []).map((f) => f.id)].sort()), '[C] (d) die 4 Frames sind ausgewählt', await K.selection(pa))
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[C] (d) die Zeichenfläche hat den Fokus')
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).size === 0, { timeout: 5000 }), '[C] (d) Strg+Z nimmt SWOT wieder weg')

			t.step('(e) 390 × 844: die Startkacheln im Bild, zwei je Reihe; „Blank“ blendet sie aus')
			await pa.setViewportSize({ width: 390, height: 844 })
			t.must(await until(() => visible(pa, '.knorke-board--narrow'), { timeout: 5000 }), '[D] (e) Vorbedingung: das schmale Layout gilt')
			t.must((await K.state(pa)).uiMode === 'edit', '[D] (e) Vorbedingung: alice bleibt im Modus edit (Maus)', await K.state(pa))
			t.check(await until(() => visible(pa, START), { timeout: 5000 }), '[C] (e) die Startkacheln stehen auf dem leeren Board')
			const sn = await until(async () => { const l = await startTiles(pa); return l.length === 5 && l.every((x) => x.inView) ? l : null }, { timeout: 3000 })
			t.check(!!sn, '[C] (e) alle fünf Kacheln liegen im sichtbaren Bereich', await startTiles(pa))
			t.check(!!sn && sn[0].top === sn[1].top && sn[2].top === sn[3].top && sn[1].top < sn[2].top, '[C] (e) zwei Kacheln je Reihe', sn)
			const under = await pa.evaluate(([sel, tile]) => {
				const bar = document.querySelector('.knorke-toolbar')?.getBoundingClientRect()
				if (!bar) return null
				return [...document.querySelectorAll(`${sel} ${tile}`)].filter((el) => {
					const r = el.getBoundingClientRect()
					return r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top
				}).map((el) => el.getAttribute('data-knorke-template'))
			}, [START, TILE]).catch(() => null)
			t.check(Array.isArray(under) && under.length === 0, '[C] (e) keine Kachel liegt unter der Werkzeugleiste (Job 232 Runde 2)', under)
			await pa.locator(`${START} [data-knorke-template=blank]`).first().click()
			t.check(await until(async () => (await count(pa, START)) === 0, { timeout: 3000 }), '[C] (e) „Blank“ blendet die Startkacheln aus')
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[C] (e) danach hat die Zeichenfläche den Fokus')
			await sleep(500)
			t.check((await itemMap(pa)).size === 0, '[C] (e) kein Objekt entsteht', (await layout(pa)).size)
			await sleep(200)
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
