/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Save as image (PNG) (factory job 178).
 *
 * E67 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900 at
 * 100 % with the same camera, on a board of their own titled "E67 Bild":
 * note N1 at (0, 0) with the reaction 👍 (alice, through the context bar),
 * note N2 at (0, 400), the connector K from N1 to N2, frame F at
 * (400, -100), 500 × 450, titled "E67 Frame", with the note C inside at
 * (450, 0); every note 200 × 200 without text. alice turns the grid on (G),
 * locks N2 (Ctrl+Shift+L) and keeps it selected; bob's cursor lies on the
 * board. The theming legal links are set (host bridge legal-links set,
 * cleared in `finally`). Steps:
 *   (a) "⋯" ([data-knorke-menu=board]) → export-png downloads
 *       "E67 Bild <today>.png" (the page's local day); camera and
 *       selection stay;
 *   (b) the file starts with the PNG signature, IHDR width and height equal
 *       lastExport() and ⌈(bounds + 32) · 2⌉; the bounds hold every item and
 *       the reaction row and reach at most 60 units beyond the items;
 *   (c) the corner pixels are white, the middle of N1 has its colour, the
 *       band of N2's selection frame (4 units above its top edge) is white,
 *       the place of its lock symbol has N2's colour, a row across the
 *       grid's lines between N2 and F is white;
 *   (d) exports at 10 % and at 150 % (stored camera, opened again) are byte-equal
 *       (and equal to (a)); the camera after each export is the one before;
 *   (e) the context menu of F (a right click on its title) lists export-png
 *       right after zoom-selection; it saves a smaller image whose ids are
 *       exactly F and C;
 *   (f) the guest Gina (edit link) finds export-png and the legal links in
 *       "⋯" and saves the image;
 *   (g) carol (shared with "view") at 500 × 800 finds export-png in the
 *       overflow menu [data-knorke-menu=overflow] and saves the image.
 * Own board; the legal links are an instance setting, put back in
 * `finally` (World.cleanup once more): before E09, directly after E66 (job
 * 177's). Flake gate: --only E67 --repeat 3.
 *
 * The board's image of (a) stays next to the report as E67-board.png.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene (the
 * image's pixels, its size), [C] shell and session (menus, file name,
 * lastExport), [B] the server, [D] a harness precondition. Waiting polls
 * from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { K, APP, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, sleep, field, action, itemMap } from '../lib/harness.mjs'
import { bridge, outDir } from '../lib/bridge.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'
import { decodePng, isPng, pixelIs, pngHeader } from '../lib/png.mjs'

/** The camera alice and bob open with: world (0, 0) 300 px right of and 250 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -250, scale: 1 })
const TITLE = 'E67 Bild'
const N1_FILL = '#ffd6a5'
const N2_FILL = '#a2d9fe'
/** (Job 227) tones of the one palette: the export draws what the board draws */
const C_FILL = '#b3e8b3'
const THUMBS = '1f44d'
const PICK = '[data-knorke-reactions=pick]'
const MENU = '[data-knorke-menu=context]'
/** The image's margin (world units per side, scene/exportImage.js EXPORT_MARGIN) and its full scale. */
export const MARGIN = 16
export const SCALE = 2
/** The selection frame lies this far outside a box at 100 % (tokens SELECTION_GAP_PX). */
export const SELECTION_GAP = 4
/** Middle of the lock symbol of a note at 100 %: inset 4 − edge 1 + half of (16 + 2 · 2 + 2 · 1) (nodes/locks.js lockSquare). */
export const LOCK_MID = 14
const IMPRINT = 'https://example.org/knorke-harness/impressum'
const PRIVACY = 'https://example.org/knorke-harness/datenschutz'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
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

/**
 * Opens the board again with this camera: first the board list (the
 * session saves its own camera when it ends), then the stored camera.
 */
async function reopenAt(actor, board, cam) {
	await actor.page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await storeCamera(actor.page, board, cam)
	await openBoard(actor, board)
}

/** The page's local calendar day YYYY-MM-DD (the file name's date). */
const today = (page) => page.evaluate(() => {
	const d = new Date()
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

/** __knorke.lastExport() ('missing' without the hook). */
const lastExport = (page) => page.evaluate(() => (typeof window.__knorke?.lastExport === 'function' ? window.__knorke.lastExport() : 'missing'))

/**
 * Runs `start` and waits for the download it triggers.
 * @return {Promise<{name: string, bytes: Buffer}|null>} null without a download within 15 s
 */
async function download(page, start) {
	const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), start()])
	if (!dl) return null
	const chunks = []
	for await (const c of await dl.createReadStream()) chunks.push(c)
	return { name: dl.suggestedFilename(), bytes: Buffer.concat(chunks) }
}

/** IHDR of a file, null when it is no PNG. */
const headerOf = (bytes) => {
	try { return pngHeader(bytes) } catch (e) { return null }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** A guest joins through /p/<token> with `name`, with the camera stored first. */
async function joinAsGuest(actor, token, name, board) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await storeCamera(actor.page, board, CAM)
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

export const E67 = {
	id: 'E67',
	title: 'Board als Bild speichern (Job 178): „⋯“ → „Save as image (PNG)“ lädt „<Titel> <heute>.png“; PNG-Signatur, Größe = lastExport() = ⌈(Grenzen + 32) · 2⌉; weiße Ecken, Notizfarbe in der Mitte, weißes Band statt Auswahlrahmen, Notizfarbe statt Schloss, kein Raster; 10 % und 150 % byte-gleich, Kamera bleibt; Kontextmenü des Frames speichert Frame und Kind; Gast über „⋯“ mit Rechtslinks; Betrachter bei 500 px im Überlaufmenü',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }, { kind: 'user', id: 'carol', role: 'view' }])
		const L = await linkToken(board)
		const N1 = ulid()
		const N2 = ulid()
		const F = ulid()
		const C = ulid()
		const KC = ulid()
		const res = await seedOps('alice', board, [
			put.frame(F, { x: 400, y: -100, w: 500, h: 450, data: { title: 'E67 Frame' } }),
			put.sticky(N1, { x: 0, y: 0, style: { fill: N1_FILL } }),
			put.sticky(N2, { x: 0, y: 400, style: { fill: N2_FILL } }),
			put.sticky(C, { x: 50, y: 100, parent: F, style: { fill: C_FILL } }),
			put.connector(KC, { item: N1 }, { item: N2 }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: N1, N2, F mit C und der Verbinder N1 → N2 gesät', res)
		world.touchedLegal = true
		const a = await world.actor('alice-png', { user: 'alice' })
		const b = await world.actor('bob-png', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		const others = []
		try {
			const set = await bridge('legal-links', 'set')
			t.must(set.imprintUrl === IMPRINT && set.privacyUrl === PRIVACY, '[D] Vorbedingung: theming imprintUrl/privacyUrl gesetzt (Brücke)', set)
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must(Math.abs((await K.camera(pa)).scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', await K.camera(pa))

			// the reaction on N1 (alice, through the context bar)
			const c1 = await K.w2s(pa, 100, 100)
			t.must(await canvasAt(pa, c1), '[D] Vorbedingung: die Mitte von N1 liegt frei auf der Leinwand', c1)
			await pa.mouse.click(c1.x, c1.y)
			const react = pa.locator('[data-knorke-action=react]').first()
			t.must(await react.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[D] Vorbedingung: die Leiste zeigt „Add reaction“')
			await react.click()
			t.must(await until(() => pa.locator(PICK).first().isVisible().catch(() => false), { timeout: 3000 }), '[D] Vorbedingung: die Schnellreihe ist offen')
			await pa.locator(`${PICK} [data-knorke-react="${THUMBS}"]`).first().click()
			t.must(await until(async () => ((await K.scene(pa))?.reactions ?? []).some((r) => r.id === N1 && same(r.shown.map(([e, n]) => [e, n]), [[THUMBS, 1]])), { timeout: 5000 }),
				'[D] Vorbedingung: N1 zeigt 👍 1', (await K.scene(pa))?.reactions)
			await pa.keyboard.press('Escape')
			// the grid on (G with the canvas focus), N2 locked and selected
			const c2 = await K.w2s(pa, 100, 500)
			t.must(await canvasAt(pa, c2), '[D] Vorbedingung: die Mitte von N2 liegt frei auf der Leinwand', c2)
			await pa.mouse.click(c2.x, c2.y)
			t.must(await until(async () => same(await K.selection(pa), [N2]), { timeout: 3000 }), '[D] Vorbedingung: N2 gewählt', await K.selection(pa))
			await pa.keyboard.press('g')
			t.must(await until(async () => (await K.scene(pa))?.grid === true, { timeout: 3000 }), '[D] Vorbedingung: das Raster ist an (G)', (await K.scene(pa))?.grid)
			await pa.keyboard.press('Control+Shift+L')
			t.must(await until(async () => !!(await itemMap(pa)).get(N2)?.lock, { timeout: 3000 }), '[D] Vorbedingung: N2 gesperrt (Strg+Umschalt+L)', (await itemMap(pa)).get(N2)?.lock)
			t.must(same(await K.selection(pa), [N2]), '[D] Vorbedingung: N2 bleibt gewählt', await K.selection(pa))
			t.must(await until(async () => ((await K.scene(pa))?.locks ?? 0) >= 1, { timeout: 3000 }), '[D] Vorbedingung: alice sieht das Schloss von N2', (await K.scene(pa))?.locks)
			// bob's cursor on the board
			const bc = await K.w2s(pb, 300, 450)
			await pb.mouse.move(bc.x, bc.y)
			await pb.mouse.move(bc.x + 30, bc.y + 10, { steps: 5 })
			t.must(await until(async () => ((await K.scene(pa))?.cursors ?? 0) >= 1, { timeout: 5000 }), '[D] Vorbedingung: alice sieht bobs Cursor auf dem Board', (await K.scene(pa))?.cursors)

			t.step('(a) „⋯“ → „Save as image (PNG)“')
			const cam0 = await K.camera(pa)
			const day = await today(pa)
			const fa = await download(pa, () => menuAction(pa, 'export-png', { menus: BOARD_MENUS }))
			t.must(!!fa, '[C] (a) „⋯“ → export-png lädt eine Datei')
			// kept for a look at the picture (next to report.md)
			fs.writeFileSync(path.join(outDir(), 'E67-board.png'), fa.bytes)
			t.check(fa.name === `${TITLE} ${day}.png`, '[C] (a) Dateiname „<Titel> <heute>.png“', { name: fa.name, want: `${TITLE} ${day}.png` })
			t.check(same(await K.camera(pa), cam0), '[S] (a) die Kamera bleibt', { before: cam0, after: await K.camera(pa) })
			t.check(same(await K.selection(pa), [N2]), '[C] (a) die Auswahl bleibt', await K.selection(pa))
			t.check((await K.scene(pa))?.grid === true, '[S] (a) das Raster bleibt an', (await K.scene(pa))?.grid)

			t.step('(b) PNG-Signatur, Größe aus IHDR = lastExport() = ⌈(Grenzen + 32) · 2⌉')
			const la = await lastExport(pa)
			t.must(la && la !== 'missing' && la.bounds, '[C] (b) __knorke.lastExport() beschreibt das Bild', la)
			t.check(isPng(fa.bytes), '[S] (b) die Datei beginnt mit der PNG-Signatur', fa.bytes.subarray(0, 8).toString('hex'))
			const ha = headerOf(fa.bytes)
			t.must(!!ha, '[S] (b) IHDR lesbar')
			t.check(ha.width === la.width && ha.height === la.height, '[C] (b) Breite und Höhe aus IHDR = lastExport()', { ihdr: ha, last: la })
			const wantW = Math.ceil((la.bounds.w + 2 * MARGIN) * SCALE)
			const wantH = Math.ceil((la.bounds.h + 2 * MARGIN) * SCALE)
			t.check(ha.width === wantW && ha.height === wantH, '[S] (b) Breite und Höhe = ⌈(Grenzen + 32) · 2⌉', { ihdr: [ha.width, ha.height], want: [wantW, wantH] })
			t.check(la.scale === SCALE && la.scaled === false && la.name === fa.name, '[C] (b) lastExport(): s = 2, nicht verkleinert, derselbe Name', la)
			t.check(same([...la.ids].sort(), [N1, N2, F, C, KC].sort()), '[C] (b) lastExport().ids = alle fünf Objekte', la.ids)
			const bb = la.bounds
			const inside = bb.x <= 0 && bb.y <= -100 && bb.x + bb.w >= 900 && bb.y + bb.h >= 600 && bb.y + bb.h >= 200 + 8 + 24
			const close = bb.x >= -60 && bb.y >= -160 && bb.x + bb.w <= 960 && bb.y + bb.h <= 660
			t.check(inside && close, '[S] (b) die Grenzen halten alle Objekte und die Reaktionszeile, höchstens 60 Einheiten darüber hinaus', bb)

			t.step('(c) Pixel: weiße Ecken, Notizfarbe, kein Auswahlrahmen, kein Schloss, kein Raster')
			const img = decodePng(fa.bytes)
			const fx = bb.x - MARGIN
			const fy = bb.y - MARGIN
			const at = (wx, wy) => img.pixel((wx - fx) * SCALE, (wy - fy) * SCALE)
			const corners = [img.pixel(0, 0), img.pixel(img.width - 1, 0), img.pixel(0, img.height - 1), img.pixel(img.width - 1, img.height - 1)]
			t.check(corners.every((p) => pixelIs(p, '#ffffff')), '[S] (c) die vier Eckpixel sind weiß', corners)
			t.check(pixelIs(at(100, 100), N1_FILL), '[S] (c) die Mitte von N1 hat die Notizfarbe', { got: at(100, 100), want: N1_FILL })
			t.check(pixelIs(at(550, 100), C_FILL), '[S] (c) die Mitte von C (im Frame) hat seine Farbe', { got: at(550, 100), want: C_FILL })
			const band = [at(160, 400 - SELECTION_GAP), at(160, 400 - SELECTION_GAP - 0.5), at(30, 400 - SELECTION_GAP)]
			t.check(band.every((p) => p[0] >= 245 && p[1] >= 245 && p[2] >= 245), '[S] (c) das Band des Auswahlrahmens von N2 ist weiß (kein Rahmen)', band)
			t.check(pixelIs(at(LOCK_MID, 400 + LOCK_MID), N2_FILL), '[S] (c) die Stelle des Schlosses von N2 hat die Notizfarbe', { got: at(LOCK_MID, 400 + LOCK_MID), want: N2_FILL })
			const row = []
			for (let wx = 240; wx <= 360; wx += 0.5) row.push(at(wx, 520))
			t.check(row.every((p) => pixelIs(p, '#ffffff')), '[S] (c) eine Zeile über die Rasterlinien zwischen N2 und F ist weiß (kein Raster)', row.filter((p) => !pixelIs(p, '#ffffff')).slice(0, 5))

			t.step('(d) 10 % und 150 %: byte-gleich, die Kamera bleibt')
			const bytesAt = []
			for (const scale of [0.1, 1.5]) {
				await reopenAt(a, board, { x: -300, y: -250, scale })
				const before = await K.camera(pa)
				t.must(Math.abs(before.scale - scale) < 1e-9, `[D] (d) Vorbedingung: alice bei ${scale * 100} %`, before)
				const f = await download(pa, () => menuAction(pa, 'export-png', { menus: BOARD_MENUS }))
				t.must(!!f, `[C] (d) bei ${scale * 100} % lädt eine Datei`)
				t.check(same(await K.camera(pa), before), `[S] (d) die Kamera bei ${scale * 100} % bleibt`, { before, after: await K.camera(pa) })
				bytesAt.push(f.bytes)
			}
			t.check(bytesAt[0].equals(bytesAt[1]), '[S] (d) die Bilder bei 10 % und 150 % sind byte-gleich', { a: bytesAt[0].length, b: bytesAt[1].length })
			t.check(bytesAt[0].equals(fa.bytes), '[S] (d) und gleich dem Bild aus (a) (Auswahl und Raster ändern nichts)', { a: fa.bytes.length, d: bytesAt[0].length })
			await reopenAt(a, board, CAM)

			t.step('(e) Kontextmenü des Frames: ein kleineres Bild mit genau F und C')
			const title = await K.w2s(pa, 430, -108)
			t.must(await canvasAt(pa, title), '[D] (e) Vorbedingung: der Titel von F liegt frei auf der Leinwand', title)
			await pa.mouse.click(title.x, title.y, { button: 'right' })
			t.must(await until(() => pa.locator(MENU).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (e) das Kontextmenü öffnet sich auf F')
			t.check(same(await K.selection(pa), [F]), '[C] (e) der Rechtsklick wählt F', await K.selection(pa))
			const entries = await pa.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			// job 230: the exports of the selection stand before "Delete", the last entry
			t.check(entries.slice(entries.indexOf('export-png'), entries.indexOf('export-png') + 5).join() === 'export-png,export-svg,export-pdf,export-bpmn,export-csv' && entries.at(-1) === 'delete', '[C] (e) export-png zuerst der Exporte, „Delete“ zuletzt', entries)
			const fe = await download(pa, () => pa.locator(`${MENU} [data-knorke-menu-item=export-png]`).first().click())
			t.must(!!fe, '[C] (e) export-png aus dem Kontextmenü lädt eine Datei')
			const le = await lastExport(pa)
			t.check(same([...le.ids].sort(), [F, C].sort()), '[C] (e) lastExport().ids sind genau F und C', le.ids)
			const he = headerOf(fe.bytes)
			t.check(!!he && he.width < ha.width && he.height <= ha.height && he.width === le.width && he.height === le.height, '[S] (e) das Bild ist kleiner als das des Boards', { frame: he, board: ha })
			t.check(fe.name === fa.name, '[C] (e) auch die Auswahl heißt nach dem Board', fe.name)

			t.step('(f) Gina (Gast über den Link): „⋯“ mit den Rechtslinks, das Bild')
			const g = await world.actor('gina-png')
			others.push(g)
			await joinAsGuest(g, L, 'Gina', board)
			const pg = g.page
			const boardMenu = pg.locator('[data-knorke-menu=board]').first()
			t.must(await boardMenu.isVisible().catch(() => false), '[C] (f) Gina sieht „⋯“ [data-knorke-menu=board]')
			await boardMenu.locator('button[aria-haspopup]').first().click()
			// job 228: the root of "More" holds the submenus "Export" first and "Legal" last; the links stand in "Legal"
			t.check(await until(async () => (await pg.locator('[data-knorke-submenu=legal]:visible').count()) === 1, { timeout: 5000 }), '[C] (f) im Menü steht „Legal ▸“')
			const subs = await pg.locator('[data-knorke-submenu]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-submenu')))
			t.check(subs[0] === 'export' && subs.at(-1) === 'legal', '[C] (f) „Export ▸“ zuerst, „Legal ▸“ zuletzt', subs)
			await pg.locator('[data-knorke-submenu=legal]:visible').first().click()
			t.check(await until(async () => (await pg.locator('[data-knorke-legal]:visible').count()) === 2, { timeout: 5000 }), '[C] (f) im Untermenü „Legal“ stehen Impressum und Datenschutz')
			const keys = await pg.locator('[data-knorke-legal]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-legal')))
			t.check(same(keys, ['imprint', 'privacy']), '[C] (f) erst das Impressum, dann der Datenschutz', keys)
			await pg.keyboard.press('Escape')
			const fg = await download(pg, () => menuAction(pg, 'export-png', { menus: BOARD_MENUS }))
			t.check(!!fg && fg.name === `${TITLE} ${await today(pg)}.png` && isPng(fg.bytes), '[C] (f) Gina lädt „<Titel> <heute>.png“ (PNG)', fg ? { name: fg.name, png: isPng(fg.bytes) } : null)

			t.step('(g) carol (Ansehen) bei 500 px Breite: export-png im Überlaufmenü')
			const c = await world.actor('carol-png', { user: 'carol', viewport: { width: 500, height: 800 } })
			others.push(c)
			await storeCamera(c.page, board, CAM)
			await openBoard(c, board)
			const pc = c.page
			t.must((await K.state(pc)).uiMode === 'view', '[D] (g) Vorbedingung: carol im Modus view', await K.state(pc))
			t.check(await pc.locator('[data-knorke-menu=overflow]').first().isVisible().catch(() => false), '[C] (g) das Überlaufmenü [data-knorke-menu=overflow] zeigt sich für die Betrachterin')
			t.check((await pc.locator('[data-knorke-menu=board]').count()) === 0, '[C] (g) schmal kein zweites Menü [data-knorke-menu=board]')
			let used = null
			const fc = await download(pc, async () => { used = await menuAction(pc, 'export-png', { menus: BOARD_MENUS }) })
			t.check(used?.menu === '[data-knorke-menu=overflow]', '[C] (g) export-png liegt im Überlaufmenü', used)
			t.check(!!fc && fc.name === `${TITLE} ${await today(pc)}.png` && isPng(fc.bytes), '[C] (g) carol lädt „<Titel> <heute>.png“ (PNG)', fc ? { name: fc.name, png: isPng(fc.bytes) } : null)
			await sleep(200)
		} finally {
			for (const x of others) await world.drop(x)
			await world.drop(b)
			await world.drop(a)
			await bridge('legal-links', 'clear').catch(() => {})
		}
	},
}
