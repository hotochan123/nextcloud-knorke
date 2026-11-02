/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Own shape libraries (factory job 203).
 *
 * E83 alice (her board of the world, its edit link for the guest Gina),
 * the admin and bob (a board of his own, deleted by him at the end),
 * Chromium 1440 × 900 at 100 %. Steps:
 *   (a) alice opens the shapes panel (job 229: the shape tool) and picks an SVG file and a draw.io library at
 *       once (built here like tests/fixtures/shapes: server.svg, aws.xml;
 *       the runner sees only dev/e2e) through the file input
 *       [data-knorke-shapes-file]: the import dialog
 *       [data-knorke-dialog=shapelib-import] says "6 shapes found" and "2
 *       skipped"; she names it E83 Netz and imports; route 46 lists it with 6
 *       names and the panel shows its section; (job 210) route 48 holds the
 *       library's noise PNG of 320 × 320 (far over 48 KB) drawn smaller: a
 *       PNG within 49152 characters, its long side 32–1024, w 60 and h 30 as
 *       in the library;
 *   (b) Enter on its first tile puts an own shape (kind image, data.img
 *       whose pieces join to the SVG's picture, 96 wide) in the middle of
 *       the view, without editor; the server holds it; after a reload it is
 *       still there;
 *   (c) (round 2) alice drags the second tile onto the board with the
 *       mouse: the preview follows the pointer and an own shape lies centred
 *       at the release point; then she suggests the library through its menu
 *       with a note: "Waiting for approval";
 *   (d) the admin finds it in /settings/admin/knorke under "Shape
 *       libraries" with the note and adopts it: it moves to "Adopted
 *       libraries";
 *   (e) bob's route 46 lists the adopted copy, his panel shows its section;
 *   (f) Gina, a guest of alice's edit link, sees the own shape with its
 *       picture data; her panel shows only the three built-in libraries and
 *       no "Import shapes…".
 * Libraries belong to accounts and the instance: the case deletes alice's
 * libraries and every adopted one named E83 before it starts and in its
 * `finally`. Own boards, no instance setting: before E09, directly after
 * E82 (job 201's). Flake gate: --only E83 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene, [C]
 * shell and session (panel, dialogs, the admin section, items), [B] the
 * server (routes), [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { deflateRawSync, deflateSync } from 'node:zlib'
import { APP, BASE, ENV, K, action, api, createBoard, field, itemMap, openBoard, serverMap, settle, until, waitReady, openAdminSection } from '../lib/harness.mjs'

/** The camera the actors open with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
const NAME = 'E83 Netz'
const PANEL = '[data-knorke-shapes]'
const CANVAS_SEL = '.knorke-canvas'
const IMPORT = '[data-knorke-dialog=shapelib-import]'
const SUGGEST = '[data-knorke-dialog=shapelib-suggest]'
const ADMIN = '[data-knorke-admin=shapelibs]'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
/** The SVG file: 48 × 24 by its viewBox. */
const SVG_TEXT = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><rect x="2" y="2" width="44" height="20" rx="3" fill="#2c7be5"/></svg>\n'

/**
 * (Job 210) A PNG of side × side pixels of noise (8-bit RGB, a fixed seed):
 * deflate gains nothing, so it is far over 48 KB.
 *
 * @param {number} side pixels
 * @return {Buffer}
 */
function noisePng(side) {
	const table = Array.from({ length: 256 }, (_, n) => {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		return c >>> 0
	})
	const crc = (buf) => {
		let c = 0xffffffff
		for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
		return (c ^ 0xffffffff) >>> 0
	}
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
		const out = Buffer.alloc(12 + data.length)
		out.writeUInt32BE(data.length, 0)
		body.copy(out, 4)
		out.writeUInt32BE(crc(body), 8 + data.length)
		return out
	}
	const head = Buffer.alloc(13)
	head.writeUInt32BE(side, 0)
	head.writeUInt32BE(side, 4)
	head[8] = 8
	head[9] = 2
	const row = 1 + side * 3
	const raw = Buffer.alloc(side * row)
	let seed = 210
	for (let y = 0; y < side; y++) {
		for (let i = 1; i < row; i++) {
			seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
			raw[y * row + i] = seed >>> 24
		}
	}
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** @return {string} a draw.io library: 4 pictures (data, compressed xml, plain xml, an SVG as text), one of shapes, one too large (no picture), one large PNG (job 210) */
function drawio() {
	const icon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>').toString('base64')
	const graph = (img) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="" style="shape=image;aspect=fixed;image=${img};" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>`
	const shapes = '<mxGraphModel><root><mxCell id="0"/><mxCell id="2" style="rounded=1;" vertex="1"/><mxCell id="3" style="ellipse;" vertex="1"/></root></mxGraphModel>'
	const list = [
		{ data: 'data:image/png;base64,' + PNG, w: 78, h: 78, title: 'EC2' },
		{ xml: deflateRawSync(Buffer.from(encodeURIComponent(graph('data:image/svg+xml,' + icon)))).toString('base64'), w: 80, h: 40, title: 'Load balancer' },
		{ xml: graph('data:image/png,' + PNG), w: 50, h: 50, title: '' },
		{ xml: shapes, w: 120, h: 60, title: 'Two boxes' },
		{ data: 'data:image/png;base64,' + 'A'.repeat(50000), w: 10, h: 10, title: 'Too large' },
		{ data: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>'), w: 4, h: 4, title: 'Plain SVG' },
		{ data: 'data:image/png;base64,' + noisePng(320).toString('base64'), w: 60, h: 30, title: 'Big PNG' },
	]
	const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
	return `<mxlibrary>${esc(JSON.stringify(list))}</mxlibrary>\n`
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const textOf = (page, sel) => page.locator(sel).first().innerText().then((s) => s.trim()).catch(() => null)

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Opens the panel with the tool bar's shape tool (job 229) and waits for it. */
async function openPanel(page) {
	await page.locator('[data-knorke-tool=shape]').first().click({ timeout: 3000 })
	return until(async () => (await page.locator(PANEL).count()) > 0, { timeout: 3000 })
}

/** @return {Promise<string[]>} the section keys of the open panel */
async function sections(page) {
	return page.locator(`${PANEL} [data-knorke-shape-lib]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-shape-lib')))
}

/** @return {Promise<object>} route 46 as user */
async function libsOf(user) {
	const r = await api(user, 'GET', '/api/v1/shapelibs')
	return r.status === 200 ? r.data : { right: null, adopted: [], own: [] }
}

/** Deletes alice's libraries and every adopted library of this case. */
async function cleanup() {
	for (const l of (await libsOf('alice')).own) await api('alice', 'DELETE', `/api/v1/shapelibs/${l.id}`).catch(() => null)
	for (const l of (await libsOf(ENV.admin.user)).adopted) {
		if (String(l.name).startsWith('E83')) await api(ENV.admin.user, 'DELETE', `/api/v1/shapelibs/${l.id}`).catch(() => null)
	}
}

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** The colour [r, g, b] the board's static layer shows at a client point, or null. */
function pixelAt(page, at) {
	return page.evaluate(([x, y]) => {
		const c = document.querySelector('.knorke-canvas .konvajs-content canvas')
		const r = c?.getBoundingClientRect()
		if (!c || !r || !r.width || !r.height) return null
		const d = c.getContext('2d').getImageData(Math.floor((x - r.left) * c.width / r.width), Math.floor((y - r.top) * c.height / r.height), 1, 1).data
		return [d[0], d[1], d[2]]
	}, [at.x, at.y]).catch(() => null)
}

/** The one item that is not in before, or null. */
async function newItem(page, before) {
	for (const [k, it] of await itemMap(page)) if (!before.has(k)) return it
	return null
}

export const E83 = {
	id: 'E83',
	title: 'Eigene Formbibliotheken (Job 203): alice importiert eine SVG und eine draw.io-Bibliothek (6 gefunden, ein großes PNG verkleinert (Job 210), 2 übersprungen) als „E83 Netz“, legt per Enter eine eigene Form als Bild ab (bleibt nach Neuladen), schlägt die Bibliothek vor; der Admin übernimmt sie in den Einstellungen; bob sieht sie in seiner Leiste; Gast Gina sieht die Form, aber nur die eingebauten Bibliotheken und keinen Import',
	async run(t, world) {
		await cleanup()
		const board = await world.board('E83 Formbibliotheken')
		const own = await createBoard('bob', 'E83 Bob')
		const token = await linkToken(board)
		const a = await world.actor('alice-libs', { user: 'alice' })
		const pa = a.page
		let ad = null
		let b = null
		let g = null
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			t.must((await K.state(pa)).uiMode === 'edit', '[D] Vorbedingung: alice im Modus edit', await K.state(pa))

			t.step('(a) alice importiert eine SVG und eine draw.io-Bibliothek')
			t.must(await openPanel(pa), '[C] (a) die Leiste ist offen')
			t.must(await until(() => visible(pa, '[data-knorke-action=shapes-import]'), { timeout: 5000 }), '[C] (a) „Import shapes…“ steht im Fuß')
			await pa.locator('[data-knorke-shapes-file]').first().setInputFiles([
				{ name: 'server.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG_TEXT) },
				{ name: 'aws.xml', mimeType: 'text/xml', buffer: Buffer.from(drawio()) },
			])
			t.must(await until(() => visible(pa, IMPORT), { timeout: 8000 }), '[C] (a) der Import-Dialog öffnet sich')
			t.check((await textOf(pa, `${IMPORT} [data-knorke-shapelib-found]`)) === '6 shapes found', '[C] (a) „6 shapes found“ (Job 210: das große PNG verkleinert)', await textOf(pa, `${IMPORT} [data-knorke-shapelib-found]`))
			t.check(((await textOf(pa, `${IMPORT} [data-knorke-shapelib-skipped]`)) ?? '').startsWith('2 skipped'), '[C] (a) „2 skipped …“', await textOf(pa, `${IMPORT} [data-knorke-shapelib-skipped]`))
			await pa.locator(`${IMPORT} [data-knorke-shapelib-name]`).first().fill(NAME)
			await pa.locator(`${IMPORT} [data-knorke-action=shapelib-ok]`).first().click()
			t.check(await until(async () => !(await visible(pa, IMPORT)), { timeout: 8000 }), '[C] (a) „Import“ schließt den Dialog')
			const lib = await until(async () => (await libsOf('alice')).own.find((l) => l.name === NAME) ?? null, { timeout: 5000 })
			t.must(!!lib && lib.names.length === 6, '[B] (a) route 46 kennt „E83 Netz“ mit 6 Namen', lib)
			t.check(await until(async () => (await sections(pa)).includes(`lib:${lib.id}`), { timeout: 5000 }), '[C] (a) die Leiste zeigt ihren Abschnitt', await sections(pa))
			// job 210: the noise PNG of 320 × 320 came in drawn smaller, as a PNG within 48 KB
			const content = await api('alice', 'GET', `/api/v1/shapelibs/${lib.id}`)
			const bigPng = content.data?.entries?.[5] ?? null
			const bigImg = typeof bigPng?.img === 'string' ? bigPng.img : ''
			const bytes = bigImg.startsWith('data:image/png;base64,') ? Buffer.from(bigImg.slice(22), 'base64') : Buffer.alloc(0)
			const px = bytes.length >= 24 && bytes.toString('ascii', 12, 16) === 'IHDR' ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null
			t.check(content.status === 200 && bigPng?.name === 'Big PNG' && bigPng.w === 60 && bigPng.h === 30 && bigImg.length <= 49152 && !!px && Math.max(...px) >= 32 && Math.max(...px) < 320,
				'[C] (a) route 48: das große PNG ist verkleinert (PNG, ≤ 49152 Zeichen, lange Seite 32 … < 320, w 60, h 30)', { status: content.status, name: bigPng?.name, w: bigPng?.w, h: bigPng?.h, chars: bigImg.length, px })

			t.step('(b) Enter auf der ersten Kachel legt eine eigene Form an')
			const tile = pa.locator(`${PANEL} [data-knorke-shape="lib:${lib.id}.0"]`).first()
			t.must(await until(async () => (await pa.locator(`${PANEL} [data-knorke-shape="lib:${lib.id}.0"] img`).count()) > 0, { timeout: 5000 }), '[C] (b) die Kachel zeigt ihr Bild')
			const before = new Set((await itemMap(pa)).keys())
			await tile.focus()
			await pa.keyboard.press('Enter')
			const shape = await until(() => newItem(pa, before), { timeout: 5000 })
			t.must(shape, '[C] (b) Enter legt eine Form an')
			const img = Array.isArray(shape.data?.img) ? shape.data.img.join('') : ''
			const svg = 'data:image/svg+xml;base64,' + Buffer.from(SVG_TEXT).toString('base64')
			t.check(shape.t === 'shape' && shape.data?.kind === 'image' && img === svg, '[C] (b) Art image, data.img ist das Bild der SVG', { kind: shape.data?.kind, pieces: shape.data?.img?.length })
			t.check(shape.w === 96 && shape.h === 48, '[C] (b) 96 × 48 wie die SVG (48 × 24)', { w: shape.w, h: shape.h })
			await settle([pa])
			t.check((await pa.locator('textarea[data-knorke-editor]').count()) === 0, '[S] (b) kein Texteditor')
			// the SVG's blue box (#2c7be5) fills the middle of the shape once the picture is decoded
			const mid = await K.w2s(pa, shape.x + shape.w / 2, shape.y + shape.h / 2)
			const blue = await until(async () => {
				const c = await pixelAt(pa, mid)
				return c && Math.abs(c[0] - 44) <= 8 && Math.abs(c[1] - 123) <= 8 && Math.abs(c[2] - 229) <= 8 ? c : null
			}, { timeout: 5000 })
			t.check(!!blue, '[S] (b) die Szene zeichnet das Bild (Mitte im Blau der SVG)', await pixelAt(pa, mid))
			// the PNG export reads its canvas back: an SVG picture drawn on it must not taint it
			const read = await pa.evaluate((uri) => new Promise((resolve) => {
				const img = new Image()
				img.onload = () => {
					const c = document.createElement('canvas')
					c.width = 8
					c.height = 8
					c.getContext('2d').drawImage(img, 0, 0, 8, 8)
					try {
						resolve(c.toDataURL('image/png').startsWith('data:image/png'))
					} catch (e) {
						resolve(String(e))
					}
				}
				img.onerror = () => resolve('not decoded')
				img.src = uri
			}), svg)
			t.check(read === true, '[S] (b) ein Canvas mit dem SVG-Bild bleibt lesbar (PNG-Export)', read)
			const srv = await serverMap('alice', board)
			t.check(srv.get(shape.id)?.data?.img?.join('') === svg, '[B] (b) der Server hält die Form mit ihrem Bild')
			await openBoard(a, board)
			t.check((await itemMap(pa)).get(shape.id)?.data?.kind === 'image', '[C] (b) nach dem Neuladen ist sie noch da')

			t.step('(c) alice schlägt die Bibliothek vor')
			t.must(await openPanel(pa), '[C] (c) die Leiste ist wieder offen')
			// round 2: the picture of the tile must not start the browser's own image drag
			const t2 = pa.locator(`${PANEL} [data-knorke-shape-lib="lib:${lib.id}"] [data-knorke-shape="lib:${lib.id}.1"]`).first()
			await t2.locator('img').waitFor({ timeout: 5000 })
			await t2.scrollIntoViewIfNeeded()
			const tb = await t2.boundingBox()
			const W = { x: 300, y: 60 }
			const to = await K.w2s(pa, W.x, W.y)
			const beforeDrag = new Set((await itemMap(pa)).keys())
			await pa.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
			await pa.mouse.down()
			await pa.mouse.move(tb.x + tb.width / 2 + 10, tb.y + tb.height / 2, { steps: 3 })
			await pa.mouse.move(to.x, to.y, { steps: 16 })
			const ghost = await pa.locator('[data-knorke-shape-ghost] img').first().boundingBox({ timeout: 1000 }).catch(() => null)
			await pa.mouse.up()
			t.check(!!ghost && Math.abs(ghost.x + ghost.width / 2 - to.x) <= 3 && Math.abs(ghost.y + ghost.height / 2 - to.y) <= 3, '[C] (c) die Vorschau mit dem Bild folgt dem Zeiger', { ghost, to })
			const dropped = await until(() => newItem(pa, beforeDrag), { timeout: 5000 })
			t.check(!!dropped && dropped.data?.kind === 'image' && Math.abs(dropped.x + dropped.w / 2 - W.x) <= 2 && Math.abs(dropped.y + dropped.h / 2 - W.y) <= 2,
				'[C] (c) das Ziehen legt eine eigene Form am Ablegepunkt ab', dropped && { kind: dropped.data?.kind, x: dropped.x, y: dropped.y, w: dropped.w, h: dropped.h })
			await pa.locator(CANVAS_SEL).first().focus()
			await pa.keyboard.press('Escape')
			await pa.locator(`${PANEL} [data-knorke-shape-lib-menu="lib:${lib.id}"] button`).first().click({ timeout: 3000 })
			await pa.locator('[data-knorke-shape-lib-action=suggest]').first().click({ timeout: 3000 })
			t.must(await until(() => visible(pa, SUGGEST), { timeout: 5000 }), '[C] (c) der Dialog „Suggest to admins“ öffnet sich')
			await pa.locator(`${SUGGEST} [data-knorke-shapelib-note]`).first().fill('Für alle Workshops')
			await pa.locator(`${SUGGEST} [data-knorke-action=shapelib-ok]`).first().click()
			t.check(await until(async () => !(await visible(pa, SUGGEST)), { timeout: 8000 }), '[C] (c) „Suggest“ schließt den Dialog')
			t.check(await until(() => visible(pa, `${PANEL} [data-knorke-shape-lib="lib:${lib.id}"] [data-knorke-shape-lib-pending]`), { timeout: 5000 }), '[C] (c) „Waiting for approval“ steht am Abschnitt')

			t.step('(d) der Admin übernimmt sie in den Einstellungen')
			ad = await world.actor('admin-libs', { user: ENV.admin.user })
			await ad.page.goto(`${BASE}/index.php/settings/admin/knorke`, { waitUntil: 'domcontentloaded' })
			t.must(await until(async () => (await ad.page.locator(ADMIN).first().getAttribute('data-knorke-admin-shapelibs-state').catch(() => null)) === 'ready', { timeout: 20000 }),
				'[C] (d) der Abschnitt „Shape libraries“ lädt')
			// job 281 (design A3): the section opens by itself when it is the first with suggestions; else a click
			t.must(await openAdminSection(ad.page, 'shapelibs'), '[C] (d) der Bereich „Shape libraries“ ist aufgeklappt')
			const row = `${ADMIN} [data-knorke-shapelib="${lib.id}"]`
			t.check(((await textOf(ad.page, row)) ?? '').includes('Für alle Workshops'), '[C] (d) der Vorschlag mit seinem Satz', await textOf(ad.page, row))
			await ad.page.locator(`${row} [data-knorke-action=shapelib-adopt]`).first().click({ timeout: 3000 })
			const adopted = await until(async () => (await libsOf(ENV.admin.user)).adopted.find((l) => l.name === NAME) ?? null, { timeout: 8000 })
			t.must(!!adopted, '[B] (d) die Bibliothek ist übernommen', adopted)
			t.check(await until(() => visible(ad.page, `${ADMIN} [data-knorke-shapelib="${adopted.id}"] [data-knorke-action=shapelib-rename]`), { timeout: 5000 }), '[C] (d) sie steht unter „Adopted libraries“')

			t.step('(e) bob sieht sie in seiner Leiste')
			t.check((await libsOf('bob')).adopted.some((l) => l.id === adopted.id), '[B] (e) route 46 von bob listet sie')
			b = await world.actor('bob-libs', { user: 'bob' })
			await storeCamera(b.page, own, CAM)
			await openBoard(b, own)
			t.must(await openPanel(b.page), '[C] (e) bobs Leiste ist offen')
			t.check(await until(async () => (await sections(b.page)).includes(`lib:${adopted.id}`), { timeout: 5000 }), '[C] (e) mit dem Abschnitt der übernommenen Bibliothek', await sections(b.page))

			t.step('(f) Gina, Gast des Bearbeiten-Links')
			g = await world.actor('gina-libs')
			await g.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await storeCamera(g.page, board, CAM)
			await field(g.page, 'guest-name', 'Gina')
			await action(g.page, 'guest-join')
			await waitReady(g.page, 30000)
			const sg = await K.state(g.page)
			t.must(sg.mode === 'guest' && sg.uiMode === 'edit', '[D] Vorbedingung: Gina ist Gast im Modus edit', sg)
			t.check((await itemMap(g.page)).get(shape.id)?.data?.img?.join('') === svg, '[C] (f) Gina hat die eigene Form mit ihrem Bild')
			t.must(await openPanel(g.page), '[C] (f) Ginas Leiste ist offen')
			await settle([g.page])
			t.check(JSON.stringify(await sections(g.page)) === '["basic","flowchart","bpmn","symbols"]', '[C] (f) nur die vier eingebauten Bibliotheken (Job 204: BPMN)', await sections(g.page))
			t.check((await g.page.locator('[data-knorke-action=shapes-import]').count()) === 0, '[C] (f) kein „Import shapes…“')
		} finally {
			await world.drop(g)
			await world.drop(b)
			await world.drop(ad)
			await world.drop(a)
			await api('bob', 'DELETE', `/api/v1/boards/${own}`).catch(() => null)
			await cleanup()
		}
	},
}
