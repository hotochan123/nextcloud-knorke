/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The redesigned tool and zoom bars (factory job 229, AK7; docs/redesign/
 * P1, P5, P5b).
 *
 * E94 alice with one board of her own (a frame F), Chromium 1280 × 800,
 * mouse, mode edit:
 *   (a) the tool bar: eight buttons in this order (select, hand | sticky,
 *       shape, text, connector, frame, more); its top edge 8 px (± 1) under
 *       the left island, its left edge 8 px (± 1) from the canvas;
 *   (b) the note tool (job 239): the first click chooses it and opens
 *       [data-knorke-tool-variants=sticky], the canvas has the focus; a click
 *       on the canvas right after it puts a note and closes them; Esc after
 *       a click closes them, the canvas keeps the focus and T chooses the
 *       text tool; then a click opens them, a second closes them (the tool
 *       stays, the canvas has the focus: L chooses the connector, N the note
 *       again), a third opens them again; "Note pad" closes them, the button shows the note
 *       pad picture, a click on the canvas puts a pad;
 *       a right-click on the frame tool opens its variants and chooses the
 *       tool, Esc closes them and the canvas keeps the focus (job 239);
 *       Enter on the frame button opens them with the focus on the chosen
 *       tile, Esc closes them with the focus on the button; the connector's
 *       variants open with one click, have two groups and stay open after
 *       a choice;
 *   (c) "More tools" → "Table": the button is pressed and carries
 *       data-knorke-tool-picked=table;
 *   (d) the shape tool opens the shapes panel (no "Shapes" button):
 *       "Recently used" holds 3 of the 8 shapes stored before, the foot with
 *       "Import shapes…" stays in place while the list scrolls; a second
 *       click closes it and select comes back; the key S opens it with the
 *       canvas keeping the focus, so N then chooses the note tool (without
 *       its variants, job 239);
 *   (e) the undo island at the bottom left (8 px ± 1 from the canvas's
 *       left and bottom edges): both buttons disabled on the fresh board
 *       (checked first), "Undo" takes the pad back, "Redo" (then enabled)
 *       brings it again and is disabled after it;
 *   (f) the zoom bar holds −, the zoom menu, + and "Show everything", no
 *       round "?" button; its menu: "Zoom to 100 %" sets 100 %, "Zoom to
 *       selection" is disabled without a selection, "Frames ▸" lists F and
 *       shows it, "Keyboard shortcuts" opens the overview.
 * E94@820x1180 alice on a tablet with a finger and a fine pointer (touch:
 *   mode edit): a finger held 650 ms on the note tool opens its variants
 *   and they stay open after the finger lifts; (job 239) a short tap opens
 *   them again and a tap on the canvas then puts a pad and closes them; the
 *   tool bar overlaps neither the left island nor the undo island.
 * E94@360x780 alice on a 360 px phone (touch and a fine pointer, narrow
 *   layout, mode edit): the undo island and the zoom bar stand side by
 *   side inside the viewport without overlapping; "Keyboard shortcuts" of
 *   the zoom menu opens the overview; with the shapes panel open, the grid
 *   "More tools" and (N, then a click on Note) the note's variants lie over
 *   the panel (round 1 of the fresh review).
 * Own board, no instance setting: after E93, before E09.
 * Flake gate: --only E94 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, items), [C] shell (bars, popovers, panel, menu, focus), [D] a
 * harness precondition. Waiting polls from Node with until() (Nextcloud's
 * CSP, ENTWICKLUNG trap 9.10).
 */
import { CANVAS, K, canvasFocused, idSet, itemMap, openBoard, put, seedOps, sleep, toolPressed, ulid, until, zoomToFrame } from '../lib/harness.mjs'
import { ZOOM_MENUS, menuAction } from '../lib/moderation.mjs'

const TITLE = 'E94 Werkzeug- und Zoomleiste'
const VIEW = Object.freeze({ width: 1280, height: 800 })
const TABLET = Object.freeze({ width: 820, height: 1180 })
const PHONE = Object.freeze({ width: 360, height: 780 })
const BAR = '[data-knorke-toolbar]'
const PANEL = '[data-knorke-shapes]'
const UNDO = '.knorke-undo'
const ZOOM = '.knorke-zoom'
const DIALOG = '[data-knorke-dialog="shortcuts"]'
/** The eight buttons of the bar, in order (src/components/toolbar.js TOOL_GROUPS). */
const ORDER = ['select', 'hand', 'sticky', 'shape', 'text', 'connector', 'frame', 'more']
/** Eight shapes "used" before (localStorage knorke.shapes): the panel keeps the newest three. */
const STORED = ['basic.rect', 'basic.roundRect', 'basic.ellipse', 'basic.diamond', 'basic.triangle', 'basic.arrowRight', 'flowchart.process', 'flowchart.decision']
/** Rounding of positions (px). */
const TOL = 1

/** The bounding box of the first match, or null. */
const box = (page, sel) => page.locator(sel).first().boundingBox({ timeout: 2000 }).catch(() => null)
const shown = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const near = (a, b, tol = TOL) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
/** Two boxes share an area. */
const overlaps = (a, b) => !!a && !!b && a.x + 0.5 < b.x + b.width && b.x + 0.5 < a.x + a.width && a.y + 0.5 < b.y + b.height && b.y + 0.5 < a.y + a.height
/** The path data of a tool button's icon. */
const iconOf = (page, tool) => page.locator(`${BAR} [data-knorke-tool=${tool}] svg path`).first().getAttribute('d', { timeout: 2000 }).catch(() => null)

/** The board of E94, seeded once per world. */
const boards = new WeakMap()

/** @return {Promise<{board: number, F: string}>} */
async function toolbarBoard(t, world) {
	if (!boards.has(world)) {
		boards.set(world, (async () => {
			const board = await world.board(TITLE)
			const F = ulid()
			const res = await seedOps('alice', board, [put.frame(F, { x: 0, y: 0, w: 400, h: 300, data: { title: 'E94 Rahmen' } })])
			if (!res.every((x) => x === 'ok')) throw new Error('E94 seed: ' + JSON.stringify(res))
			return { board, F }
		})())
	}
	const b = await boards.get(world)
	t.must(!!b.board, '[D] Vorbedingung: Board mit dem Rahmen F', b)
	return b
}

/** A free point of the canvas (no item, no bar on top) near the given fractions of the canvas box. */
async function freePoint(page, fx, fy) {
	const c = await box(page, CANVAS)
	const pt = { x: c.x + c.width * fx, y: c.y + c.height * fy }
	const free = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.knorke-canvas'), [pt.x, pt.y])
	return free ? pt : null
}

export const E94 = {
	id: 'E94',
	title: 'Werkzeug- und Zoomleiste (Job 229): acht Knöpfe oben links unter der linken Insel, Varianten per erstem Klick (Job 239) oder Rechtsklick, „Mehr Werkzeuge“, das Form-Werkzeug öffnet das Formen-Panel, Rückgängig-Insel unten links, Zoom-Menü mit 100 %, Auswahl, Frames und Tastenkürzel',
	async run(t, world) {
		const { board, F } = await toolbarBoard(t, world)
		const a = await world.actor('alice-leisten', { user: 'alice', viewport: VIEW })
		const p = a.page
		try {
			await p.evaluate(([k, v]) => localStorage.setItem(k, v), ['knorke.shapes', JSON.stringify({ hidden: [], folded: [], recent: STORED })])
			await openBoard(a, board)
			await K.waitIdle(p)
			t.must((await K.state(p)).uiMode === 'edit', '[D] Vorbedingung: alice ist im Modus edit')
			// round 1 (fresh review): without history both buttons of the undo island are disabled
			t.check(await p.locator(`${UNDO} [data-knorke-action=undo]`).first().isDisabled() && await p.locator(`${UNDO} [data-knorke-action=redo]`).first().isDisabled(), '[C] ohne Verlauf sind Rückgängig und Wiederholen ausgegraut')

			t.step('(a) acht Knöpfe oben links unter der linken Insel')
			const order = await p.locator(`${BAR} [data-knorke-tool]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-tool')))
			t.check(JSON.stringify(order) === JSON.stringify(ORDER), '[C] (a) die Knöpfe Auswählen, Schwenken | Notiz, Form, Text, Verbinder, Frame, Mehr Werkzeuge', order)
			const bar = await box(p, BAR)
			const island = await box(p, '[data-knorke-island=left]')
			const canvas = await box(p, CANVAS)
			t.check(!!bar && !!island && near(bar.y, island.y + island.height + 8), '[C] (a) die Leiste beginnt 8 px (± 1) unter der linken Insel', { bar, island })
			t.check(!!bar && !!canvas && near(bar.x, canvas.x + 8), '[C] (a) die Leiste steht 8 px (± 1) vom linken Rand', { bar, canvas })
			t.check((await p.locator('[data-knorke-action=shapes]').count()) === 0 && (await p.locator('[data-knorke-tool-options]').count()) === 0, '[C] (a) kein eigener „Shapes“-Knopf, keine Pfeil-Menüs')

			t.step('(b) Notiz: der erste Klick wählt und zeigt die Varianten, ein Klick auf die Leinwand legt sofort an (Job 239)')
			const note = p.locator(`${BAR} [data-knorke-tool=sticky]`).first()
			await note.click()
			t.check(await until(async () => (await toolPressed(p, 'sticky')) === 'true', { timeout: 2000 }), '[S] (b) der erste Klick wählt das Notizwerkzeug')
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=sticky]'), { timeout: 2000 }), '[C] (b) der erste Klick öffnet die Varianten der Notiz')
			t.check((await note.getAttribute('aria-expanded')) === 'true', '[C] (b) der Knopf meldet aria-expanded="true"')
			t.check(await canvasFocused(p), '[C] (b) nach dem Mausklick hat die Leinwand den Fokus')
			const noteAt = await freePoint(p, 0.7, 0.35)
			t.must(!!noteAt, '[D] (b) ein freier Punkt der Leinwand für die Notiz')
			const before0 = await idSet(p)
			await p.mouse.click(noteAt.x, noteAt.y)
			const made = await until(async () => [...(await itemMap(p))].find(([id]) => !before0.has(id))?.[1] ?? null, { timeout: 5000 })
			t.check(made?.t === 'sticky', '[S] (b) der Klick auf die Leinwand legt sofort eine Notiz an', made)
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) und schließt die Varianten')
			await p.keyboard.press('Escape')
			await p.keyboard.press('Escape')
			// round 1: Esc after a mouse click closes them and leaves the focus on the canvas, so the keys work
			await note.click()
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=sticky]'), { timeout: 2000 }), '[D] (b) die Varianten der Notiz sind offen')
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) Esc nach dem Mausklick schließt die Varianten')
			t.check(await canvasFocused(p), '[C] (b) die Leinwand behält danach den Fokus')
			await p.keyboard.press('t')
			t.check(await until(async () => (await toolPressed(p, 'text')) === 'true', { timeout: 2000 }), '[S] (b) die Taste T wählt danach das Textwerkzeug')
			await note.click()
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=sticky]'), { timeout: 2000 }), '[C] (b) ein Klick öffnet die Varianten wieder')
			await note.click()
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) der zweite Klick schließt sie')
			t.check((await toolPressed(p, 'sticky')) === 'true' && (await note.getAttribute('aria-expanded')) === 'false', '[S] (b) das Notizwerkzeug bleibt gewählt')
			// round 2 (fresh review): the closing click gives the canvas the focus too, the keys go on
			t.check(await until(() => canvasFocused(p), { timeout: 2000 }), '[C] (b) nach dem zweiten Klick hat die Leinwand den Fokus')
			await p.keyboard.press('l')
			t.check(await until(async () => (await toolPressed(p, 'connector')) === 'true', { timeout: 2000 }), '[S] (b) die Taste L wählt danach den Verbinder')
			await p.keyboard.press('n')
			t.must(await until(async () => (await toolPressed(p, 'sticky')) === 'true', { timeout: 2000 }) && !(await shown(p, '[data-knorke-tool-variants]')), '[D] (b) N wählt die Notiz wieder, ohne Varianten')
			await note.click()
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=sticky]'), { timeout: 2000 }), '[C] (b) der dritte Klick öffnet sie wieder')
			const padPicture = await p.locator('[data-knorke-tool-variants=sticky] [data-knorke-tool-option=pad] svg path').first().getAttribute('d')
			const noteIcon = await iconOf(p, 'sticky')
			await p.locator('[data-knorke-tool-variants=sticky] [data-knorke-tool-option=pad]').first().click()
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) „Note pad“ schließt das Popover')
			t.check(!!padPicture && padPicture !== noteIcon && await until(async () => (await iconOf(p, 'sticky')) === padPicture, { timeout: 2000 }), '[C] (b) der Knopf zeigt das Bild des Notizblocks (wie seine Kachel)')
			const padAt = await freePoint(p, 0.7, 0.6)
			t.must(!!padAt, '[D] (b) ein freier Punkt der Leinwand')
			const before = await idSet(p)
			await p.mouse.click(padAt.x, padAt.y)
			const pad = await until(async () => [...(await itemMap(p))].find(([id, it]) => !before.has(id) && it.t === 'pad')?.[0] ?? null, { timeout: 5000 })
			t.check(!!pad, '[S] (b) ein Klick auf die Leinwand legt einen Notizblock an')
			await p.keyboard.press('Escape')
			await p.keyboard.press('Escape')

			t.step('(b) Rechtsklick auf Frame, Esc; Verbinder mit zwei Gruppen')
			await p.locator(`${BAR} [data-knorke-tool=frame]`).first().click({ button: 'right' })
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=frame]'), { timeout: 2000 }), '[C] (b) ein Rechtsklick auf Frame öffnet dessen Varianten')
			t.check(await until(async () => (await toolPressed(p, 'frame')) === 'true', { timeout: 2000 }), '[S] (b) und wählt das Frame-Werkzeug')
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) Esc schließt die Varianten')
			t.check(await canvasFocused(p), '[C] (b) nach dem Rechtsklick behält die Leinwand den Fokus (Job 239)')
			// from the keyboard the focus goes into the variants and with Esc back to the button
			await p.locator(`${BAR} [data-knorke-tool=frame]`).first().focus()
			await p.keyboard.press('Enter')
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=frame]'), { timeout: 2000 }), '[C] (b) Enter auf dem Frame-Knopf öffnet die Varianten')
			t.check(await until(() => p.evaluate(() => document.activeElement?.closest?.('[data-knorke-tool-variants=frame]') !== null && document.activeElement?.getAttribute?.('aria-pressed') === 'true'), { timeout: 2000 }), '[C] (b) der Fokus steht auf der gewählten Kachel')
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) Esc schließt sie')
			t.check(await p.evaluate(() => document.activeElement?.getAttribute?.('data-knorke-tool') === 'frame'), '[C] (b) danach hat der Frame-Knopf den Fokus')
			await p.locator(`${BAR} [data-knorke-tool=connector]`).first().click()
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=connector]'), { timeout: 2000 }), '[C] (b) ein Klick öffnet die Varianten des Verbinders')
			t.check((await p.locator('[data-knorke-tool-variants=connector] .knorke-toolpop__group').count()) === 2, '[C] (b) zwei Gruppen: Route und Spitze')
			await p.locator('[data-knorke-tool-variants=connector] [data-knorke-tool-option=curved]').first().click()
			await sleep(300)
			t.check(await shown(p, '[data-knorke-tool-variants=connector]'), '[C] (b) nach der Wahl der Route bleibt das Popover offen')
			t.check((await p.locator('[data-knorke-tool-variants=connector] [data-knorke-tool-option=curved]').first().getAttribute('aria-pressed')) === 'true', '[C] (b) „Curved“ ist gewählt')
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] (b) Esc schließt die Varianten des Verbinders')

			t.step('(c) Mehr Werkzeuge → Tabelle')
			await p.locator(`${BAR} [data-knorke-tool=more]`).first().click()
			t.must(await until(() => shown(p, '[data-knorke-more-tools]'), { timeout: 2000 }), '[C] (c) „Mehr Werkzeuge“ öffnet das kleine Raster')
			const more = await p.locator('[data-knorke-more-tools] [data-knorke-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-tool')))
			const tableIcon = await p.locator('[data-knorke-more-tools] [data-knorke-tool=table] svg path').first().getAttribute('d')
			t.check(JSON.stringify(more) === '["table","mindmap","laser"]', '[C] (c) darin Tabelle, Mindmap, Laserpointer', more)
			await p.locator('[data-knorke-more-tools] [data-knorke-tool=table]').first().click()
			t.check(await until(async () => !(await shown(p, '[data-knorke-more-tools]')), { timeout: 2000 }), '[C] (c) die Wahl schließt das Raster')
			const mb = p.locator(`${BAR} [data-knorke-tool=more]`).first()
			t.check(await until(async () => (await mb.getAttribute('data-knorke-tool-picked')) === 'table' && (await mb.getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (c) „Mehr Werkzeuge“ ist gedrückt und zeigt die Tabelle')
			t.check(!!tableIcon && (await iconOf(p, 'more')) === tableIcon, '[C] (c) mit dem Icon der Tabelle')

			t.step('(d) das Form-Werkzeug öffnet das Formen-Panel')
			await p.locator(`${BAR} [data-knorke-tool=shape]`).first().click()
			t.must(await until(() => shown(p, PANEL), { timeout: 3000 }), '[C] (d) ein Klick auf Form öffnet das Panel')
			t.check(await until(async () => (await toolPressed(p, 'shape')) === 'true', { timeout: 2000 }), '[S] (d) das Formwerkzeug ist gewählt')
			const recent = await p.locator(`${PANEL} [data-knorke-shape-lib=recent] [data-knorke-shape]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-shape')))
			t.check(JSON.stringify(recent) === JSON.stringify(STORED.slice(0, 3)), '[C] (d) „Recently used“ zeigt die drei neuesten der acht gespeicherten Formen', recent)
			const foot0 = await box(p, `${PANEL} .knorke-shapes__foot`)
			t.check(!!foot0 && await shown(p, `${PANEL} [data-knorke-action=shapes-import]`), '[C] (d) der Fuß zeigt „Import shapes…“', foot0)
			await p.locator(`${PANEL} .knorke-shapes__body`).first().evaluate((el) => { el.scrollTop = el.scrollHeight })
			await sleep(200)
			const scrolled = await p.locator(`${PANEL} .knorke-shapes__body`).first().evaluate((el) => el.scrollTop)
			const foot1 = await box(p, `${PANEL} .knorke-shapes__foot`)
			t.check(scrolled > 0 && !!foot1 && near(foot1.y, foot0.y) && near(foot1.x, foot0.x), '[C] (d) die Liste scrollt, der Fuß bleibt an seiner Stelle', { scrolled, foot0, foot1 })
			await p.locator(`${BAR} [data-knorke-tool=shape]`).first().click()
			t.check(await until(async () => !(await shown(p, PANEL)), { timeout: 2000 }), '[C] (d) ein zweiter Klick auf Form schließt das Panel')
			t.check(await until(async () => (await toolPressed(p, 'select')) === 'true', { timeout: 2000 }), '[S] (d) danach ist wieder Auswählen gewählt')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('s')
			t.check(await until(() => shown(p, PANEL), { timeout: 2000 }), '[C] (d) die Taste S öffnet das Panel')
			t.check(await canvasFocused(p), '[C] (d) die Leinwand behält den Fokus')
			await p.keyboard.press('n')
			t.check(await until(async () => (await toolPressed(p, 'sticky')) === 'true', { timeout: 2000 }), '[S] (d) N danach wählt das Notizwerkzeug (nichts landet in der Suche)')
			t.check((await p.locator('[data-knorke-shapes-search]').first().inputValue().catch(() => null)) === '', '[C] (d) die Suche bleibt leer')
			t.check(!(await shown(p, '[data-knorke-tool-variants]')), '[C] (d) die Taste N öffnet keine Varianten')
			await p.locator(`${PANEL} [data-knorke-action=shapes-close]`).first().click()
			t.check(await until(async () => !(await shown(p, PANEL)), { timeout: 2000 }), '[C] (d) × schließt das Panel')
			await p.locator(`${BAR} [data-knorke-tool=select]`).first().click()

			t.step('(e) die Rückgängig-Insel unten links')
			const undo = await box(p, UNDO)
			t.check(!!undo && near(undo.x, canvas.x + 8) && near(undo.y + undo.height, canvas.y + canvas.height - 8), '[C] (e) die Insel steht 8 px (± 1) von links und unten', { undo, canvas })
			t.check(!overlaps(undo, await box(p, BAR)) && !overlaps(undo, await box(p, ZOOM)), '[C] (e) sie überlappt weder Werkzeug- noch Zoomleiste')
			await p.locator(`${UNDO} [data-knorke-action=undo]`).first().click()
			t.check(await until(async () => !(await itemMap(p)).has(pad), { timeout: 5000 }), '[S] (e) „Undo“ nimmt den Notizblock zurück')
			// round 1 (fresh review): redo comes alive and brings the pad back, then has nothing left
			const redo = p.locator(`${UNDO} [data-knorke-action=redo]`).first()
			t.check(await until(async () => !(await redo.isDisabled()), { timeout: 3000 }), '[C] (e) danach ist „Redo“ aktiv')
			await redo.click()
			t.check(await until(async () => (await itemMap(p)).has(pad), { timeout: 5000 }), '[S] (e) „Redo“ bringt den Notizblock zurück')
			t.check(await until(() => redo.isDisabled(), { timeout: 3000 }), '[C] (e) danach ist „Redo“ wieder ausgegraut')

			t.step('(f) die Zoomleiste und ihr Menü')
			const parts = await p.locator(`${ZOOM} > *`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-action') ?? e.getAttribute('data-knorke-menu')))
			t.check(JSON.stringify(parts) === '["zoom-out","zoom","zoom-in","zoom-fit"]', '[C] (f) die Zoomleiste hält −, das Menü, + und „Alles zeigen“', parts)
			t.check((await p.locator('.knorke-zoom__shortcuts').count()) === 0, '[C] (f) kein runder „?“-Knopf')
			await menuAction(p, 'zoom-100', { menus: ZOOM_MENUS })
			t.check(await until(async () => Math.abs(((await K.camera(p))?.scale ?? 0) - 1) < 1e-6, { timeout: 3000 }), '[S] (f) „Zoom to 100 %“ setzt 100 %', await K.camera(p))
			t.check(await until(async () => (await p.locator(`${ZOOM} [data-knorke-menu=zoom] .action-item__menutoggle`).first().textContent())?.includes('100 %'), { timeout: 3000 }), '[C] (f) der Auslöser zeigt „100 %“')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Escape')
			t.must(await until(async () => ((await K.selection(p)) || []).length === 0, { timeout: 2000 }), '[D] (f) nichts ist ausgewählt', await K.selection(p))
			await p.locator(`${ZOOM} [data-knorke-menu=zoom] .action-item__menutoggle`).first().click()
			t.must(await until(() => shown(p, '#knorke-menus [data-knorke-action=zoom-selection]'), { timeout: 3000 }), '[D] (f) das Zoom-Menü ist offen')
			t.check(await until(() => p.locator('#knorke-menus [data-knorke-action=zoom-selection] button').first().isDisabled().catch(() => false), { timeout: 2000 }), '[C] (f) „Zoom to selection“ ist ohne Auswahl ausgegraut')
			await p.keyboard.press('Escape')
			await until(async () => !(await shown(p, '#knorke-menus [data-knorke-action=zoom-selection]')), { timeout: 3000 })
			await zoomToFrame(p, F)
			const fr = await until(async () => {
				const r = await K.rect(p, F)
				const c = await box(p, CANVAS)
				return r && c && r.x >= c.x && r.y >= c.y && r.x + r.w <= c.x + c.width && r.y + r.h <= c.y + c.height ? r : null
			}, { timeout: 4000 })
			t.check(!!fr, '[S] (f) Frames ▸ „E94 Rahmen“ zeigt den Rahmen ganz', fr)
			await menuAction(p, 'shortcuts', { menus: ZOOM_MENUS })
			t.check(await until(() => shown(p, DIALOG), { timeout: 3000 }), '[C] (f) „Keyboard shortcuts“ öffnet die Übersicht')
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await shown(p, DIALOG)), { timeout: 3000 }), '[C] (f) Esc schließt sie')
		} finally {
			await world.drop(a)
		}
	},
}

export const E94_TABLET = {
	id: 'E94',
	pass: `${TABLET.width}x${TABLET.height}`,
	title: `Werkzeugleiste auf einem Tablet mit ${TABLET.width} × ${TABLET.height} (Finger, Job 229): langes Drücken auf Notiz öffnet die Varianten und sie bleiben offen; ein Tipp auf die Leinwand legt dann an (Job 239); die Leiste überlappt keine Insel`,
	async run(t, world) {
		const { board } = await toolbarBoard(t, world)
		const a = await world.actor(`alice-leisten-${TABLET.width}`, { user: 'alice', touch: true, fine: true, viewport: TABLET })
		const p = a.page
		try {
			await openBoard(a, board)
			await K.waitIdle(p)
			t.must((await K.state(p)).uiMode === 'edit', '[D] Vorbedingung: das Tablet mit feinem Zeiger ist im Modus edit')
			const bar = await box(p, BAR)
			t.check(!!bar && !overlaps(bar, await box(p, '[data-knorke-island=left]')) && !overlaps(bar, await box(p, UNDO)), '[C] die Leiste überlappt weder die linke Insel noch die Rückgängig-Insel', { bar, island: await box(p, '[data-knorke-island=left]'), undo: await box(p, UNDO) })
			const b = await box(p, `${BAR} [data-knorke-tool=sticky]`)
			t.must(!!b, '[D] der Notiz-Knopf ist sichtbar')
			const cdp = await a.ctx.newCDPSession(p)
			const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] })
			await sleep(650)
			t.check(await shown(p, '[data-knorke-tool-variants=sticky]'), '[C] ein Finger, 650 ms auf Notiz gehalten, öffnet die Varianten')
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			await sleep(400)
			t.check(await shown(p, '[data-knorke-tool-variants=sticky]'), '[C] nach dem Loslassen bleiben sie offen (der Klick des langen Drucks zählt nicht)')
			t.check((await toolPressed(p, 'sticky')) === 'true', '[S] der lange Druck wählt das Notizwerkzeug')
			await p.locator('[data-knorke-tool-variants=sticky] [data-knorke-tool-option=pad]').first().tap()
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] ein Tipp auf „Note pad“ schließt sie')
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] })
			await sleep(80)
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			await sleep(400)
			t.check(await shown(p, '[data-knorke-tool-variants=sticky]'), '[C] ein kurzer Tipp auf die gewählte Notiz öffnet sie wieder')
			// job 239: a finger's tap on the canvas puts the pad (its last variant) at once and closes them
			const tapAt = await freePoint(p, 0.6, 0.6)
			t.must(!!tapAt, '[D] ein freier Punkt der Leinwand für den Tipp')
			const before = await idSet(p)
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tapAt] })
			await sleep(60)
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			const made = await until(async () => [...(await itemMap(p))].find(([id]) => !before.has(id))?.[1] ?? null, { timeout: 5000 })
			t.check(made?.t === 'pad', '[S] ein Tipp auf die Leinwand legt sofort einen Notizblock an', made)
			t.check(await until(async () => !(await shown(p, '[data-knorke-tool-variants]')), { timeout: 2000 }), '[C] und schließt die Varianten')
		} finally {
			await world.drop(a)
		}
	},
}

export const E94_PHONE = {
	id: 'E94',
	pass: `${PHONE.width}x${PHONE.height}`,
	title: `Rückgängig-Insel und Zoomleiste auf einem Handy mit ${PHONE.width} × ${PHONE.height} (Job 229): nebeneinander im Bild, ohne Überlappung; das Zoom-Menü öffnet die Tastenkürzel`,
	async run(t, world) {
		const { board } = await toolbarBoard(t, world)
		const a = await world.actor(`alice-leisten-${PHONE.width}`, { user: 'alice', touch: true, fine: true, viewport: PHONE })
		const p = a.page
		try {
			await openBoard(a, board)
			await K.waitIdle(p)
			t.must((await K.state(p)).uiMode === 'edit', '[D] Vorbedingung: das Handy mit feinem Zeiger ist im Modus edit')
			const undo = await box(p, UNDO)
			const zoom = await box(p, ZOOM)
			const inView = (r) => !!r && r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= PHONE.width + 0.5 && r.y + r.height <= PHONE.height + 0.5
			t.check(inView(undo) && inView(zoom), '[C] Rückgängig-Insel und Zoomleiste liegen ganz im Bild', { undo, zoom })
			t.check(!overlaps(undo, zoom) && near(undo.y + undo.height, zoom.y + zoom.height), '[C] sie stehen nebeneinander, ohne Überlappung, auf derselben Unterkante (± 1)', { undo, zoom })
			t.check(!overlaps(await box(p, BAR), undo), '[C] die Werkzeugleiste reicht nicht in die Rückgängig-Insel')
			await menuAction(p, 'shortcuts', { menus: ZOOM_MENUS })
			t.check(await until(() => shown(p, DIALOG), { timeout: 3000 }), '[C] „Keyboard shortcuts“ im Zoom-Menü öffnet die Übersicht')
			await p.keyboard.press('Escape')
			t.check(await until(async () => !(await shown(p, DIALOG)), { timeout: 3000 }), '[C] Esc schließt sie')
			// round 1 (fresh review): with the shapes panel open, "More tools" and a tool's variants lie over it
			await p.locator(`${BAR} [data-knorke-tool=shape]`).first().click()
			t.must(await until(() => shown(p, PANEL), { timeout: 3000 }), '[D] das Formen-Panel ist offen')
			const onTop = (sel) => p.evaluate((s) => {
				const el = document.querySelector(s)
				const r = el?.getBoundingClientRect()
				if (!r) return false
				return [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]].every(([fx, fy]) => el.contains(document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy)))
			}, sel)
			await p.locator(`${BAR} [data-knorke-tool=more]`).first().click()
			t.must(await until(() => shown(p, '[data-knorke-more-tools]'), { timeout: 2000 }), '[D] „Mehr Werkzeuge“ ist offen')
			t.check(await onTop('[data-knorke-more-tools]'), '[C] das Raster „Mehr Werkzeuge“ liegt über dem offenen Formen-Panel')
			await p.locator('[data-knorke-more-tools] [data-knorke-tool=table]').first().click()
			t.check(await until(async () => (await p.locator(`${BAR} [data-knorke-tool=more]`).first().getAttribute('data-knorke-tool-picked')) === 'table', { timeout: 2000 }), '[S] Tabelle ist gewählt')
			await p.locator(`${BAR} [data-knorke-tool=shape]`).first().click()
			t.must(await until(() => shown(p, PANEL), { timeout: 3000 }), '[D] das Formen-Panel ist wieder offen')
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('n')
			t.must(await until(async () => (await toolPressed(p, 'sticky')) === 'true', { timeout: 2000 }) && await shown(p, PANEL), '[D] N wählt die Notiz, das Panel bleibt offen')
			await p.locator(`${BAR} [data-knorke-tool=sticky]`).first().click()
			t.must(await until(() => shown(p, '[data-knorke-tool-variants=sticky]'), { timeout: 2000 }), '[D] die Varianten der Notiz sind offen')
			t.check(await onTop('[data-knorke-tool-variants=sticky]'), '[C] die Varianten liegen über dem Formen-Panel')
			await p.keyboard.press('Escape')
		} finally {
			await world.drop(a)
		}
	},
}
