/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shapes panel (factory job 201).
 *
 * E82 alice (owner), Chromium 1440 × 900 at 100 %, on a board of her own
 * with one shape of every new kind seeded far below the view (for the
 * picture of the board). Steps:
 *   (1) the shape tool of the tool bar ([data-knorke-tool=shape], job 229:
 *       no "Shapes" button of its own) opens the panel [data-knorke-shapes]
 *       with the three libraries (job 204: and BPMN before the symbols),
 *       aria-expanded true; it covers no button of the tool bar (round 2: the
 *       frame tool below the shape tool still takes a click);
 *   (2) the search "database" shows the one tile flowchart.database;
 *   (3) alice drags that tile onto the board (real mouse): while she drags,
 *       the preview's centre is at the pointer (± 2 px, round 2); a shape of
 *       kind database whose centre is the release point (± 2 world px),
 *       selected, its editor open; Esc;
 *   (4) a click on the tile symbols.person, then a click on the board just
 *       beside the panel: an iconPerson of 96 × 96 centred there (± 2), no
 *       editor; its context bar lies over the panel, "Fill" takes a click
 *       (round 3); Esc;
 *   (5) the tile symbols.star dragged and released over the panel: nothing
 *       new on the board;
 *   (6) "Libraries" → "Symbols" off; the page loaded again and the panel
 *       opened: no section symbols, "Recently used" shows person before
 *       database; the server holds both shapes with their kinds;
 *   (7) pictures (no check): each library section in the light theme and,
 *       for a second page of alice in the dark one (prefers-color-scheme),
 *       and the seeded shapes on the board, as E82-*.png in the output's
 *       shots/ (the job copies them into its folder);
 *   (8) round 5: gina, a guest of the edit link, opens the panel: the end of
 *       its list ("Libraries", job 229: no foot without the right to
 *       import) lies inside the panel, and "Zoom in" takes a click (the
 *       guest page of Nextcloud pins every <footer> to the window's bottom,
 *       #body-public footer).
 * Own board, no instance setting: before E09, directly after E81 (job
 * 200's). Flake gate: --only E82 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, editor, the panel), [C] session and sync (what is created, what the
 * browser keeps), [B] the server, [D] a harness precondition. Waiting polls
 * from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { K, APP, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, settle, itemMap, idSet, serverMap, field, action } from '../lib/harness.mjs'
import { outDir } from '../lib/bridge.mjs'

/** The camera alice opens with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Where the seeded shapes lie (world), far below the first view. */
const SEED_Y = 3000
const FLOW = ['terminal', 'parallelogram', 'document', 'database', 'subprocess', 'hexagon', 'manualInput', 'trapezoid', 'delay', 'offPage']
const SYMBOLS = [
	'iconPerson', 'iconPeople', 'iconPlace', 'iconClock', 'iconWarning', 'iconInfo', 'iconQuestion', 'iconDone', 'iconError', 'iconStar',
	'iconHeart', 'iconIdea', 'iconFlag', 'iconCalendar', 'iconMail', 'iconPhone', 'iconHome', 'iconSettings', 'iconLock', 'iconCloud',
]
const PANEL = '[data-knorke-shapes]'
const TILE = (id) => `${PANEL} [data-knorke-shape="${id}"]`
const EDITOR = 'textarea[data-knorke-editor]'

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** A guest joins through /p/<token> with `name`, with the camera stored first. */
async function joinAsGuest(actor, token, name, board) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await storeCamera(actor.page, board, CAM)
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

/** Opens the panel with the tool bar's shape tool (real click; job 229) and waits for it. */
async function openPanel(page) {
	await page.locator('[data-knorke-tool=shape]').first().click({ timeout: 3000 })
	return until(async () => (await page.locator(PANEL).count()) > 0, { timeout: 3000 })
}

/** Centre of the first element of a selector in client px, or null. */
async function centre(page, sel) {
	const b = await page.locator(sel).first().boundingBox({ timeout: 3000 }).catch(() => null)
	return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
}

/**
 * A drag with the real mouse from a to b.
 *
 * @return {Promise<{x: number, y: number}|null>} the centre of the drag preview just before the release (client px)
 */
async function drag(page, a, b) {
	await page.mouse.move(a.x, a.y)
	await page.mouse.down()
	await page.mouse.move(a.x + 10, a.y, { steps: 3 })
	await page.mouse.move(b.x, b.y, { steps: 16 })
	const g = await page.locator('[data-knorke-shape-ghost]').first().boundingBox({ timeout: 1000 }).catch(() => null)
	await page.mouse.up()
	return g ? { x: g.x + g.width / 2, y: g.y + g.height / 2 } : null
}

/** The one item that is not in before, or null. */
async function newItem(page, before) {
	for (const [k, it] of await itemMap(page)) if (!before.has(k)) return it
	return null
}

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

/** Saves a picture of an element (or the page) as E82-<name>.png in shots/; false when it fails. */
async function picture(page, name, sel = null) {
	const dir = path.join(outDir(), 'shots')
	fs.mkdirSync(dir, { recursive: true })
	const file = path.join(dir, `E82-${name}.png`)
	const target = sel ? page.locator(sel).first() : page
	return target.screenshot({ path: file, timeout: 5000 }).then(() => true, () => false)
}

export const E82 = {
	id: 'E82',
	title: 'Formen-Seitenleiste (Job 201): „Shapes“ öffnet die Leiste; Suche „database“; Kachel aufs Board gezogen legt eine Datenbank am Ablegepunkt an (Editor offen); Klick auf „Person“, dann aufs Board legt ein Symbol 96 × 96 ohne Editor an; Ablegen auf der Leiste legt nichts an; „Symbols“ aus, neu geladen: Abschnitt fehlt, „Recently used“ Person vor Datenbank; Bilder hell und dunkel',
	async run(t, world) {
		const board = await world.board('E82 Formen')
		const seed = [...FLOW, ...SYMBOLS].map((kind, i) => put.shape(ulid(), {
			x: (i % 10) * 220, y: SEED_Y + Math.floor(i / 10) * 220, w: kind.startsWith('icon') ? 96 : 160, h: kind.startsWith('icon') ? 96 : 120,
			data: { kind, text: kind.startsWith('icon') ? '' : kind },
			style: kind.startsWith('icon') ? { fill: '#1a1a1a', strokeWidth: 0 } : { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 },
		}))
		const res = await seedOps('alice', board, seed)
		t.must(res.length === 30 && res.every((x) => x === 'ok'), '[D] Vorbedingung: je eine Form jeder neuen Art gesät (der Server nimmt die Arten an)', res)
		const a = await world.actor('alice-formen', { user: 'alice' })
		const pa = a.page
		let d = null
		let g = null
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)

			t.step('(1) „Shapes“ öffnet die Leiste mit den drei Bibliotheken')
			t.must(await openPanel(pa), '[S] (1) die Leiste ist offen')
			t.check(await pa.locator('[data-knorke-tool=shape]').first().getAttribute('aria-expanded') === 'true', '[S] (1) das Formwerkzeug meldet aria-expanded="true"')
			const libs = await pa.locator(`${PANEL} [data-knorke-shape-lib]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-shape-lib')))
			t.check(JSON.stringify(libs) === JSON.stringify(['basic', 'flowchart', 'bpmn', 'symbols']), '[S] (1) die Abschnitte basic, flowchart, bpmn (Job 204), symbols', libs)
			const arrow = await pa.locator('[data-knorke-tool=frame]').first().click({ trial: true, timeout: 2000 }).then(() => true, (e) => e.message.split('\n')[0])
			t.check(arrow === true, '[S] (1) die Leiste verdeckt das Frame-Werkzeug unter dem Formwerkzeug nicht', arrow)
			const tbar = await pa.locator('[data-knorke-toolbar]').first().boundingBox()
			const pbox = await pa.locator(PANEL).first().boundingBox()
			t.check(!!tbar && !!pbox && pbox.x >= tbar.x + tbar.width, '[S] (1) die Leiste beginnt rechts der Werkzeugleiste', { toolbar: tbar, panel: pbox })

			t.step('(2) die Suche „database“')
			await pa.locator('[data-knorke-shapes-search]').first().fill('database')
			const hits = await until(async () => {
				const ids = await pa.locator(`${PANEL} [data-knorke-shape]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-shape')))
				return ids.length === 1 ? ids : null
			}, { timeout: 3000 })
			t.check(JSON.stringify(hits) === '["flowchart.database"]', '[S] (2) genau die Kachel flowchart.database', hits)

			t.step('(3) die Kachel aufs Board gezogen')
			const W3 = { x: 100, y: 50 }
			const before3 = await idSet(pa)
			const to3 = await K.w2s(pa, W3.x, W3.y)
			const ghost = await drag(pa, await centre(pa, TILE('flowchart.database')), to3)
			t.check(!!ghost && near(ghost.x, to3.x) && near(ghost.y, to3.y), '[S] (3) die Vorschau sitzt beim Ziehen am Zeiger (± 2 px)', { ghost, pointer: to3 })
			const db = await until(() => newItem(pa, before3), { timeout: 5000 })
			t.must(db, '[S] (3) das Ablegen legt eine Form an')
			t.check(db.t === 'shape' && db.data?.kind === 'database' && db.w === 160 && db.h === 200, '[C] (3) eine Datenbank 160 × 200', { t: db.t, kind: db.data?.kind, w: db.w, h: db.h })
			t.check(near(db.x + db.w / 2, W3.x) && near(db.y + db.h / 2, W3.y), '[C] (3) ihre Mitte liegt am Ablegepunkt (± 2)', { x: db.x + db.w / 2, y: db.y + db.h / 2 })
			t.check(((await K.selection(pa)) || []).includes(db.id), '[S] (3) sie ist gewählt')
			t.check(await until(async () => (await pa.locator(EDITOR).count()) > 0, { timeout: 3000 }), '[S] (3) ihr Texteditor ist offen')
			await pa.keyboard.press('Escape')
			await settle([pa])

			t.step('(4) Klick auf „Person“, dann Klick aufs Board')
			await pa.locator('[data-knorke-shapes-search]').first().fill('')
			// just right of the panel: the context bar, centred on the symbol, reaches over the panel
			const W4 = { x: -160, y: 50 }
			await pa.locator(TILE('symbols.person')).first().click({ timeout: 3000 })
			t.check(await until(async () => (await pa.locator('[data-knorke-tool=shape]').first().getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (4) der Klick wählt das Formwerkzeug')
			const before4 = await idSet(pa)
			const at4 = await K.w2s(pa, W4.x, W4.y)
			await pa.mouse.click(at4.x, at4.y)
			const person = await until(() => newItem(pa, before4), { timeout: 5000 })
			t.must(person, '[S] (4) der Klick aufs Board legt eine Form an')
			t.check(person.data?.kind === 'iconPerson' && person.w === 96 && person.h === 96 && person.style?.fill === '#191b1d' && person.style?.strokeWidth === 0,
				'[C] (4) ein Symbol Person 96 × 96, dunkel gefüllt, ohne Rand', { kind: person.data?.kind, w: person.w, h: person.h, style: person.style })
			t.check(near(person.x + 48, W4.x) && near(person.y + 48, W4.y), '[C] (4) mittig am Klickpunkt (± 2)', { x: person.x, y: person.y })
			await settle([pa])
			t.check((await pa.locator(EDITOR).count()) === 0, '[S] (4) kein Texteditor am Symbol')
			const pbox4 = await pa.locator(PANEL).first().boundingBox()
			const fill4 = await pa.locator('[data-knorke-section=color]').first().boundingBox({ timeout: 3000 }).catch(() => null)
			t.must(!!pbox4 && !!fill4, '[D] (4) Panel und Farbpunkt der Kontextleiste stehen da', { panel: pbox4, fill: fill4 })
			// job 230: the bar is shorter now; where it still reaches over the panel, its dot stays clickable there
			if (fill4.x < pbox4.x + pbox4.width) {
				const fillHit = await pa.locator('[data-knorke-section=color]').first().click({ trial: true, timeout: 2000 }).then(() => true, (e) => e.message.split('\n')[0])
				t.check(fillHit === true, '[S] (4) der Farbpunkt der Kontextleiste ist über der Leiste klickbar', fillHit)
			} else {
				t.note('(4) die kürzere Kontextleiste (Job 230) reicht nicht mehr über das Formen-Panel')
			}
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Escape')
			await settle([pa])

			t.step('(5) „Star“ auf der Leiste losgelassen')
			const before5 = await idSet(pa)
			// job 204: BPMN stands before the symbols, the tile may lie below the panel's fold
			await pa.locator(TILE('symbols.star')).first().scrollIntoViewIfNeeded({ timeout: 3000 })
			await drag(pa, await centre(pa, TILE('symbols.star')), await centre(pa, '[data-knorke-shapes-search]'))
			await settle([pa])
			t.check((await idSet(pa)).size === before5.size, '[S] (5) nichts Neues auf dem Board')

			t.step('(6) „Symbols“ ausgeblendet, neu geladen')
			await pa.locator('[data-knorke-action=shapes-libs]').first().click({ timeout: 3000 })
			await pa.locator('[data-knorke-shape-lib-toggle=symbols]').first().uncheck({ timeout: 3000 })
			t.check(await until(async () => (await pa.locator(`${PANEL} [data-knorke-shape-lib=symbols]`).count()) === 0, { timeout: 2000 }), '[S] (6) der Abschnitt Symbols ist weg')
			await openBoard(a, board)
			t.must(await openPanel(pa), '[S] (6) nach dem Neuladen wieder offen')
			t.check((await pa.locator(`${PANEL} [data-knorke-shape-lib=symbols]`).count()) === 0, '[C] (6) Symbols bleibt ausgeblendet (der Browser merkt es sich)')
			const recent = await pa.locator(`${PANEL} [data-knorke-shape-lib=recent] [data-knorke-shape]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-shape')))
			t.check(JSON.stringify(recent) === '["symbols.person","flowchart.database"]', '[C] (6) „Recently used“: Person vor Datenbank', recent)
			const srv = await serverMap('alice', board)
			t.check(srv.get(db.id)?.data?.kind === 'database' && srv.get(person.id)?.data?.kind === 'iconPerson', '[B] (6) der Server hat beide Formen mit ihrer Art',
				{ db: srv.get(db.id)?.data, person: srv.get(person.id)?.data })

			t.step('(7) Bilder der Bibliotheken (hell, dunkel) und der gesäten Formen')
			await pa.locator('[data-knorke-action=shapes-libs]').first().click({ timeout: 3000 })
			await pa.locator('[data-knorke-shape-lib-toggle=symbols]').first().check({ timeout: 3000 })
			for (const lib of ['basic', 'flowchart', 'symbols']) await picture(pa, `light-${lib}`, `${PANEL} [data-knorke-shape-lib=${lib}]`)
			await picture(pa, 'light-panel', PANEL)
			d = await world.actor('alice-formen-dunkel', { user: 'alice', colorScheme: 'dark' })
			await openBoard(d, board)
			await openPanel(d.page)
			for (const lib of ['basic', 'flowchart', 'symbols']) await picture(d.page, `dark-${lib}`, `${PANEL} [data-knorke-shape-lib=${lib}]`)
			await d.page.locator(`${PANEL} [data-knorke-action=shapes-close]`).first().click({ timeout: 3000 })
			await d.page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify({ x: -40, y: SEED_Y - 100, scale: 0.6 })])
			await openBoard(d, board)
			await settle([d.page])
			await picture(d.page, 'board-seeded', CANVAS)

			t.step('(8) Gina, Gast des Bearbeiten-Links, öffnet die Leiste')
			g = await world.actor('gina-formen')
			await joinAsGuest(g, await linkToken(board), 'Gina', board)
			const sg = await K.state(g.page)
			t.must(sg.mode === 'guest' && sg.role === 'edit' && sg.uiMode === 'edit', '[D] Vorbedingung: Gina ist Gast des Bearbeiten-Links im Modus edit', sg)
			t.must(await openPanel(g.page), '[S] (8) die Leiste ist bei Gina offen')
			const pbox8 = await g.page.locator(PANEL).first().boundingBox({ timeout: 3000 }).catch(() => null)
			// job 229: a guest has no right to import, so no foot; "Libraries" ends the list
			t.check((await g.page.locator(`${PANEL} .knorke-shapes__foot`).count()) === 0, '[S] (8) ohne Import-Recht kein Fuß')
			await g.page.locator(`${PANEL} [data-knorke-action=shapes-libs]`).first().scrollIntoViewIfNeeded({ timeout: 3000 })
			const foot8 = await g.page.locator(`${PANEL} [data-knorke-action=shapes-libs]`).first().boundingBox({ timeout: 3000 }).catch(() => null)
			t.check(!!pbox8 && !!foot8 && foot8.x >= pbox8.x - 1 && foot8.x + foot8.width <= pbox8.x + pbox8.width + 1 && foot8.y + foot8.height <= pbox8.y + pbox8.height + 1,
				'[S] (8) „Libraries“ am Ende der Liste liegt in der Leiste', { panel: pbox8, foot: foot8 })
			const zoomHit = await g.page.locator('.knorke-zoom button[aria-label="Zoom in"]').first().click({ trial: true, timeout: 2000 }).then(() => true, (e) => e.message.split('\n')[0])
			t.check(zoomHit === true, '[S] (8) „Zoom in“ ist bei offener Leiste klickbar', zoomHit)
			await picture(g.page, 'guest-open')
		} finally {
			await world.drop(g)
			await world.drop(d)
			await world.drop(a)
		}
	},
}
