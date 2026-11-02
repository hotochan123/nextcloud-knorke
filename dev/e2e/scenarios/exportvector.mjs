/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Save as SVG and PDF (factory job 200).
 *
 * E81 alice (owner), Chromium 1440 × 900 at 100 %, on a board of her own
 * titled "E81 Vektor": note N1 at (0, 0) with the text "E81 Grüße" and the
 * reaction 👍 (alice, through the context bar), note N2 at (0, 400), the
 * connector K from N1 to N2, frame F at (400, -100), 500 × 450, titled
 * "E81 Frame", with the note C inside at (450, 0); every note 200 × 200;
 * the ellipse S "Form" at (400, 420), 260 × 140, and the text item T
 * "E81 Text" at (680, 440). carol is shared with "view". Steps:
 *   (a) "⋯" → export-png, then export-svg: "E81 Vektor <today>.svg"; root
 *       with width, height and viewBox = the PNG's frame (lastExport bounds
 *       + 16 per side), "E81 Grüße" as <text>, one group per item; the
 *       browser draws the SVG at the PNG's size: corners white, N1, N2 and
 *       C in their colours, and at most 2 % of the pixels differ from the
 *       PNG by more than 64 in a channel;
 *   (b) "⋯" → export-pdf: "E81 Vektor <today>.pdf"; header, xref, trailer
 *       valid, one page, MediaBox = frame · 0.75; Helvetica; the inflated
 *       content shows "E81 Grüße", "Form" and "E81 Text" in WinAnsi;
 *       the 👍 is an image with a soft
 *       mask; lastExport() names the page;
 *   (c) both at 10 % and at 150 % (stored camera, opened again) byte-equal
 *       with (a) and (b); camera and selection stay;
 *   (d) the context menu of F (a right click on its title) lists export-svg
 *       and export-pdf right after export-png; their files hold exactly F
 *       and C (lastExport ids, the SVG's groups);
 *   (e) carol (view) at 500 × 800 finds both in the overflow menu
 *       [data-knorke-menu=overflow] and saves them;
 *   (f) (job 207) "Save as PDF…" opens [data-knorke-dialog=export-pdf]
 *       with "Size of the content" checked (every PDF of (b)–(e) goes
 *       through it, Save); alice picks A4: the board, wider than high, is
 *       an A4 landscape page (841.89 × 595.276 pt), lastExport().page a4;
 *       opened again, the dialog has A4 checked; Esc closes it without a
 *       file.
 * Own board, no instance setting: directly after E80, before E09. Flake
 * gate: --only E81 --repeat 3.
 *
 * The files of (a) and (b) stay next to the report as E81-board.svg and
 * E81-board.pdf.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene (the
 * files' drawing, their size), [C] shell and session (menus, file names,
 * lastExport), [B] the server, [D] a harness precondition. Waiting polls
 * from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { K, APP, CANVAS, api, put, ulid, seedOps, openBoard, until, sleep, itemMap } from '../lib/harness.mjs'
import { outDir } from '../lib/bridge.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'
import { isPng, pngHeader } from '../lib/png.mjs'
import { fontsOf, imagesOf, isPdf, readPdf, shownStrings } from '../lib/pdf.mjs'

/** The camera alice opens with: world (0, 0) 300 px right of and 250 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -250, scale: 1 })
const TITLE = 'E81 Vektor'
const TEXT = 'E81 Grüße'
const N1_FILL = '#ffd6a5'
/** (Job 227) tones of the one palette: the export draws what the board draws */
const N2_FILL = '#a2d9fe'
const C_FILL = '#b3e8b3'
const THUMBS = '1f44d'
const PICK = '[data-knorke-reactions=pick]'
const MENU = '[data-knorke-menu=context]'
/** The frame's margin (world units per side, scene/exportImage.js EXPORT_MARGIN), the PNG's scale, pt per unit. */
export const MARGIN = 16
export const SCALE = 2
export const PT = 0.75
/** At most this share of the pixels may differ by more than DIFF_LEVEL in a channel between the SVG and the PNG. */
export const DIFF_SHARE = 0.02
export const DIFF_LEVEL = 64

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

/** Opens the board again with this camera: first the board list (the session saves its camera when it ends). */
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
 * @return {Promise<{name: string, bytes: Buffer}|null>} null without a download within 20 s
 */
async function download(page, start) {
	const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), start()])
	if (!dl) return null
	const chunks = []
	for await (const c of await dl.createReadStream()) chunks.push(c)
	return { name: dl.suggestedFilename(), bytes: Buffer.concat(chunks) }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps

const PDF_DIALOG = '[data-knorke-dialog=export-pdf]'

/** (Job 207) The page size checked in the open PDF dialog (null: no dialog within 5 s). */
async function pdfChecked(page) {
	const dlg = page.locator(PDF_DIALOG).first()
	if (!(await dlg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false))) return null
	return dlg.locator('input[type=radio]:checked').first().evaluate((e) => e.closest('[data-knorke-pdf-page]')?.getAttribute('data-knorke-pdf-page') ?? '?').catch(() => '?')
}

/**
 * (Job 207) Opens the PDF dialog with `open`, picks `choose` (a4, a3, content; null: as it is) and clicks Save.
 * @return {Promise<string|null>} the page size checked when it opened, null without a dialog
 */
async function savePdf(page, open, choose = null) {
	await open()
	const checked = await pdfChecked(page)
	if (checked === null) return null
	if (choose) await page.locator(`${PDF_DIALOG} [data-knorke-pdf-page=${choose}]`).first().click()
	await page.locator(`${PDF_DIALOG} [data-knorke-action=export-pdf-save]`).first().click()
	return checked
}

/** The PDF read back, null when it does not read. */
const pdfOf = (bytes) => {
	try { return readPdf(bytes) } catch (e) { return { error: String(e.message || e) } }
}

/**
 * Draws the SVG and the PNG into canvases of the PNG's size in a blank page
 * of the same browser (no CSP there) and compares them.
 *
 * @param {object} page a blank page
 * @param {string} svg the SVG text
 * @param {Buffer} png the PNG bytes
 * @param {{x:number, y:number}} origin the frame's top-left corner (world)
 * @param {number[][]} points world points to sample
 * @return {Promise<{w: number, h: number, share: number, samples: number[][], corners: number[][]}>}
 */
function compareInBrowser(page, svg, png, origin, points) {
	return page.evaluate(async ([svgB64, pngB64, ox, oy, scale, pts, level]) => {
		const load = async (src) => {
			const img = new Image()
			img.src = src
			await img.decode()
			return img
		}
		const p = await load('data:image/png;base64,' + pngB64)
		const s = await load('data:image/svg+xml;base64,' + svgB64)
		const w = p.naturalWidth
		const h = p.naturalHeight
		const draw = (img) => {
			const c = document.createElement('canvas')
			c.width = w
			c.height = h
			const g = c.getContext('2d')
			g.drawImage(img, 0, 0, w, h)
			return g.getImageData(0, 0, w, h).data
		}
		const a = draw(p)
		const b = draw(s)
		let diff = 0
		for (let i = 0; i < a.length; i += 4) {
			if (Math.abs(a[i] - b[i]) > level || Math.abs(a[i + 1] - b[i + 1]) > level || Math.abs(a[i + 2] - b[i + 2]) > level) diff++
		}
		const px = (x, y) => {
			const i = 4 * (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x))))
			return [b[i], b[i + 1], b[i + 2]]
		}
		return {
			w,
			h,
			share: diff / (w * h),
			samples: pts.map(([x, y]) => px((x - ox) * scale, (y - oy) * scale)),
			corners: [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)],
		}
	}, [Buffer.from(svg, 'utf8').toString('base64'), png.toString('base64'), origin.x, origin.y, SCALE, points, DIFF_LEVEL])
}

/** @param {number[]} p [r, g, b] @param {string} hex #rrggbb @return {boolean} within 3 per channel */
function colourIs(p, hex) {
	const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
	return Array.isArray(p) && p.every((v, i) => Math.abs(v - want[i]) <= 3)
}

/** The item ids of an SVG's groups, in order ("overlay" left out). */
const svgGroups = (svg) => [...svg.matchAll(/<g id="item-([^"]+)">/g)].map((m) => m[1]).filter((x) => x !== 'overlay')

export const E81 = {
	id: 'E81',
	title: 'Board als SVG und PDF speichern (Job 200): „⋯“ → „Save as SVG“ lädt „<Titel> <heute>.svg“ mit viewBox = Rahmen des PNG, Text als <text>, im Browser gezeichnet wie das PNG; „Save as PDF“ lädt ein gültiges PDF (xref, eine Seite, MediaBox = Rahmen · 0,75, Helvetica, „E81 Grüße“, 👍 als Bild); 10 % und 150 % byte-gleich; Kontextmenü des Frames mit genau F und C; Betrachterin bei 500 px im Überlaufmenü; (Job 207) „Save as PDF…“ fragt nach der Seitengröße: A4 quer, im Browser gemerkt, Esc ohne Datei',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'carol', role: 'view' }])
		const N1 = ulid()
		const N2 = ulid()
		const F = ulid()
		const C = ulid()
		const KC = ulid()
		const S = ulid()
		const T = ulid()
		const ALL = [N1, N2, F, C, KC, S, T]
		const res = await seedOps('alice', board, [
			put.frame(F, { x: 400, y: -100, w: 500, h: 450, data: { title: 'E81 Frame' } }),
			put.sticky(N1, { x: 0, y: 0, data: { text: TEXT }, style: { fill: N1_FILL } }),
			put.sticky(N2, { x: 0, y: 400, style: { fill: N2_FILL } }),
			put.sticky(C, { x: 50, y: 100, parent: F, style: { fill: C_FILL } }),
			put.connector(KC, { item: N1 }, { item: N2 }),
			put.shape(S, { x: 400, y: 420, w: 260, h: 140, data: { kind: 'ellipse', text: 'Form' } }),
			put.text(T, { x: 680, y: 440, data: { text: 'E81 Text' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: N1 mit Text, N2, F mit C, der Verbinder N1 → N2, die Ellipse S und das Textobjekt T gesät', res)
		const a = await world.actor('alice-vec', { user: 'alice' })
		const pa = a.page
		const others = []
		let blank = null
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			t.must(Math.abs((await K.camera(pa)).scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', await K.camera(pa))
			t.must((await itemMap(pa)).get(N1)?.data?.text === TEXT, '[D] Vorbedingung: N1 trägt „E81 Grüße“', (await itemMap(pa)).get(N1)?.data)

			// the reaction on N1 (alice, through the context bar), then nothing selected
			const c1 = await K.w2s(pa, 100, 170)
			t.must(await canvasAt(pa, c1), '[D] Vorbedingung: N1 liegt frei auf der Leinwand', c1)
			await pa.mouse.click(c1.x, c1.y)
			const react = pa.locator('[data-knorke-action=react]').first()
			t.must(await react.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[D] Vorbedingung: die Leiste zeigt „Add reaction“')
			await react.click()
			t.must(await until(() => pa.locator(PICK).first().isVisible().catch(() => false), { timeout: 3000 }), '[D] Vorbedingung: die Schnellreihe ist offen')
			await pa.locator(`${PICK} [data-knorke-react="${THUMBS}"]`).first().click()
			t.must(await until(async () => ((await K.scene(pa))?.reactions ?? []).some((r) => r.id === N1 && same(r.shown.map(([e, n]) => [e, n]), [[THUMBS, 1]])), { timeout: 5000 }),
				'[D] Vorbedingung: N1 zeigt 👍 1', (await K.scene(pa))?.reactions)
			await pa.keyboard.press('Escape')
			await pa.keyboard.press('Escape')

			t.step('(a) „⋯“ → export-png, dann export-svg')
			const day = await today(pa)
			const fp = await download(pa, () => menuAction(pa, 'export-png', { menus: BOARD_MENUS }))
			t.must(!!fp && isPng(fp.bytes), '[C] (a) Vorbedingung: das PNG zum Vergleich lädt', fp?.name)
			const lp = await lastExport(pa)
			t.must(lp && lp !== 'missing' && lp.bounds, '[C] (a) Vorbedingung: lastExport() des PNG', lp)
			const cam0 = await K.camera(pa)
			const sel0 = await K.selection(pa)
			const fs1 = await download(pa, () => menuAction(pa, 'export-svg', { menus: BOARD_MENUS }))
			t.must(!!fs1, '[C] (a) „⋯“ → export-svg lädt eine Datei')
			fs.writeFileSync(path.join(outDir(), 'E81-board.svg'), fs1.bytes)
			t.check(fs1.name === `${TITLE} ${day}.svg`, '[C] (a) Dateiname „<Titel> <heute>.svg“', { name: fs1.name, want: `${TITLE} ${day}.svg` })
			t.check(same(await K.camera(pa), cam0) && same(await K.selection(pa), sel0), '[C] (a) Kamera und Auswahl bleiben', { cam: await K.camera(pa), sel: await K.selection(pa) })
			const ls = await lastExport(pa)
			const frame = { x: lp.bounds.x - MARGIN, y: lp.bounds.y - MARGIN, w: lp.bounds.w + 2 * MARGIN, h: lp.bounds.h + 2 * MARGIN }
			t.check(ls?.format === 'svg' && ls.name === fs1.name && near(ls.width, frame.w) && near(ls.height, frame.h) && ls.scale === 1 && ls.scaled === false,
				'[C] (a) lastExport(): svg, Breite und Höhe = Rahmen des PNG, nicht verkleinert', { last: ls, frame })
			t.check(same([...ls.ids].sort(), [...ALL].sort()), '[C] (a) lastExport().ids = alle sieben Objekte', ls?.ids)
			const svg = fs1.bytes.toString('utf8')
			const root = /<svg [^>]*width="([^"]+)" height="([^"]+)" viewBox="([^"]+)"/.exec(svg)
			const vb = root ? root[3].split(' ').map(Number) : []
			t.check(!!root && near(Number(root[1]), frame.w) && near(Number(root[2]), frame.h) && near(vb[0], frame.x) && near(vb[1], frame.y) && near(vb[2], frame.w) && near(vb[3], frame.h),
				'[S] (a) width, height und viewBox = Rahmen des PNG (Grenzen + 16 je Seite)', { root: root?.slice(1), frame })
			t.check(/<text xml:space="preserve"[^>]*>[^<]*E81 Grüße[^<]*<\/text>/.test(svg) || /<text xml:space="preserve"[^>]*>E81<\/text>[\s\S]*Grüße/.test(svg), '[S] (a) „E81 Grüße“ steht als <text> im SVG', svg.match(/<text[^>]*>[^<]*<\/text>/g)?.slice(0, 4))
			t.check(same(svgGroups(svg).sort(), [...ALL].sort()), '[S] (a) eine Gruppe je Objekt', svgGroups(svg))
			t.check(/>Form<\/text>/.test(svg) && />E81 Text<\/text>/.test(svg), '[S] (a) der Text der Ellipse und des Textobjekts als <text>', svg.match(/<text[^>]*>[^<]*<\/text>/g)?.map((x) => x.replace(/<[^>]*>/g, '')))
			t.check(/<path d="M[^"]*C[^"]*" fill="#ffffff" stroke="#191b1d"/.test(svg), '[S] (a) die Ellipse als ein Pfad aus Bézierkurven mit Füllung und Rand (job 227: der alte Rand #1a1a1a als Schwarz)')
			t.check(!/<script|<foreignObject|\son[a-z]+="/i.test(svg), '[S] (a) kein Skript, kein foreignObject, kein Event-Attribut')
			blank = await pa.context().newPage()
			await blank.goto('about:blank')
			const cmp = await compareInBrowser(blank, svg, fp.bytes, frame, [[100, 185], [100, 585], [550, 100]])
			const ph = pngHeader(fp.bytes)
			t.check(cmp.w === ph.width && cmp.h === ph.height, '[S] (a) gezeichnet in der Größe des PNG', { cmp: [cmp.w, cmp.h], png: [ph.width, ph.height] })
			t.check(cmp.corners.every((p) => colourIs(p, '#ffffff')), '[S] (a) die vier Ecken des gezeichneten SVG sind weiß', cmp.corners)
			t.check(colourIs(cmp.samples[0], N1_FILL) && colourIs(cmp.samples[1], N2_FILL) && colourIs(cmp.samples[2], C_FILL), '[S] (a) N1, N2 und C in ihren Farben', cmp.samples)
			t.check(cmp.share <= DIFF_SHARE, `[S] (a) höchstens ${DIFF_SHARE * 100} % der Pixel weichen vom PNG um mehr als ${DIFF_LEVEL} ab`, { share: cmp.share })

			t.step('(b) „⋯“ → export-pdf')
			let opened = null
			const fd = await download(pa, async () => { opened = await savePdf(pa, () => menuAction(pa, 'export-pdf', { menus: BOARD_MENUS })) })
			t.must(opened !== null, '[C] (b) „⋯“ → export-pdf öffnet den Dialog [data-knorke-dialog=export-pdf]', opened)
			t.check(opened === 'content', '[C] (b) beim ersten Mal ist „Size of the content“ gewählt', opened)
			t.must(!!fd, '[C] (b) „⋯“ → export-pdf → Save lädt eine Datei')
			fs.writeFileSync(path.join(outDir(), 'E81-board.pdf'), fd.bytes)
			t.check(fd.name === `${TITLE} ${day}.pdf`, '[C] (b) Dateiname „<Titel> <heute>.pdf“', fd.name)
			t.check(isPdf(fd.bytes), '[S] (b) die Datei beginnt mit %PDF-', fd.bytes.subarray(0, 8).toString('latin1'))
			const pdf = pdfOf(fd.bytes)
			t.must(!pdf.error, '[S] (b) Kopf, xref, Trailer und Seitenbaum lesen sich', pdf.error)
			t.check(pdf.version === '1.4' && pdf.pages === 1, '[S] (b) PDF 1.4 mit genau einer Seite', { version: pdf.version, pages: pdf.pages })
			t.check(near(pdf.mediaBox[2], frame.w * PT) && near(pdf.mediaBox[3], frame.h * PT) && pdf.mediaBox[0] === 0 && pdf.mediaBox[1] === 0, '[S] (b) MediaBox = Rahmen · 0,75 pt', { box: pdf.mediaBox, want: [frame.w * PT, frame.h * PT] })
			const lf = await lastExport(pa)
			t.check(lf?.format === 'pdf' && near(lf.width, pdf.mediaBox[2]) && near(lf.height, pdf.mediaBox[3]) && lf.scale === PT && lf.page === 'content', '[C] (b) lastExport() nennt die Seite in pt und page content', lf)
			t.check(fontsOf(pdf).includes('Helvetica'), '[S] (b) der Text steht in Helvetica', fontsOf(pdf))
			const shown = shownStrings(pdf.content).join('')
			t.check(shown.includes('E81 Gr\xfc\xdfe') || (shown.includes('E81') && shown.includes('Gr\xfc\xdfe')), '[S] (b) „E81 Grüße“ steht WinAnsi-kodiert im Inhalt', shown.slice(0, 120))
			t.check(shown.includes('Form') && shown.includes('E81 Text'), '[S] (b) „Form“ und „E81 Text“ stehen im Inhalt', shown.slice(0, 200))
			t.check(imagesOf(pdf).some((x) => x.mask), '[S] (b) das 👍 ist ein Bild mit weicher Maske', imagesOf(pdf))

			t.step('(c) 10 % und 150 %: byte-gleich, die Kamera bleibt')
			for (const scale of [0.1, 1.5]) {
				await reopenAt(a, board, { x: -300, y: -250, scale })
				const before = await K.camera(pa)
				t.must(Math.abs(before.scale - scale) < 1e-9, `[D] (c) Vorbedingung: alice bei ${scale * 100} %`, before)
				const s = await download(pa, () => menuAction(pa, 'export-svg', { menus: BOARD_MENUS }))
				const d = await download(pa, () => savePdf(pa, () => menuAction(pa, 'export-pdf', { menus: BOARD_MENUS })))
				t.check(!!s && s.bytes.equals(fs1.bytes), `[S] (c) das SVG bei ${scale * 100} % ist byte-gleich mit (a)`, { a: fs1.bytes.length, c: s?.bytes.length })
				t.check(!!d && d.bytes.equals(fd.bytes), `[S] (c) das PDF bei ${scale * 100} % ist byte-gleich mit (b)`, { b: fd.bytes.length, c: d?.bytes.length })
				t.check(same(await K.camera(pa), before), `[S] (c) die Kamera bei ${scale * 100} % bleibt`, { before, after: await K.camera(pa) })
			}
			await reopenAt(a, board, CAM)

			t.step('(d) Kontextmenü des Frames: export-svg und export-pdf nach export-png, genau F und C')
			for (const key of ['export-svg', 'export-pdf']) {
				const title = await K.w2s(pa, 430, -108)
				t.must(await canvasAt(pa, title), '[D] (d) Vorbedingung: der Titel von F liegt frei auf der Leinwand', title)
				await pa.mouse.click(title.x, title.y, { button: 'right' })
				t.must(await until(() => pa.locator(MENU).first().isVisible().catch(() => false), { timeout: 3000 }), `[C] (d) das Kontextmenü öffnet sich auf F (${key})`)
				t.check(same(await K.selection(pa), [F]), '[C] (d) der Rechtsklick wählt F', await K.selection(pa))
				const entries = await pa.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
				const at = entries.indexOf('export-png')
				t.check(same(entries.slice(at, at + 5), ['export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv']), '[C] (d) export-svg und export-pdf direkt nach export-png, vor export-bpmn (Job 205) und export-csv', entries)
				const pick = () => pa.locator(`${MENU} [data-knorke-menu-item=${key}]`).first().click()
				const f = await download(pa, () => (key === 'export-pdf' ? savePdf(pa, pick) : pick()))
				t.must(!!f, `[C] (d) ${key} aus dem Kontextmenü lädt eine Datei`)
				const le = await lastExport(pa)
				t.check(same([...le.ids].sort(), [F, C].sort()), `[C] (d) ${key}: lastExport().ids sind genau F und C`, le.ids)
				t.check(f.name === `${TITLE} ${day}.${key.slice(7)}`, `[C] (d) ${key}: auch die Auswahl heißt nach dem Board`, f.name)
				if (key === 'export-svg') {
					t.check(same(svgGroups(f.bytes.toString('utf8')).sort(), [F, C].sort()), '[S] (d) das SVG hat genau die Gruppen von F und C', svgGroups(f.bytes.toString('utf8')))
				} else {
					const p = pdfOf(f.bytes)
					t.check(!p.error && p.mediaBox[2] < pdf.mediaBox[2], '[S] (d) das PDF liest sich und ist schmaler als das des Boards', { error: p.error, box: p.mediaBox })
				}
				await pa.keyboard.press('Escape')
			}

			t.step('(e) carol (Ansehen) bei 500 px Breite: export-svg und export-pdf im Überlaufmenü')
			const c = await world.actor('carol-vec', { user: 'carol', viewport: { width: 500, height: 800 } })
			others.push(c)
			await storeCamera(c.page, board, CAM)
			await openBoard(c, board)
			const pc = c.page
			t.must((await K.state(pc)).uiMode === 'view', '[D] (e) Vorbedingung: carol im Modus view', await K.state(pc))
			for (const key of ['export-svg', 'export-pdf']) {
				let used = null
				const start = async () => { used = await menuAction(pc, key, { menus: BOARD_MENUS }) }
				const f = await download(pc, () => (key === 'export-pdf' ? savePdf(pc, start) : start()))
				t.check(used?.menu === '[data-knorke-menu=overflow]', `[C] (e) ${key} liegt im Überlaufmenü`, used)
				const ext = key.slice(7)
				const ok = !!f && f.name === `${TITLE} ${await today(pc)}.${ext}` && (ext === 'pdf' ? isPdf(f.bytes) : f.bytes.toString('utf8', 0, 5) === '<?xml')
				t.check(ok, `[C] (e) carol lädt „<Titel> <heute>.${ext}“`, f ? { name: f.name, head: f.bytes.toString('latin1', 0, 8) } : null)
			}
			// the dialog on 500 px with a finger's rows (opened once more, then Esc)
			await menuAction(pc, 'export-pdf', { menus: BOARD_MENUS })
			t.must((await pdfChecked(pc)) !== null, '[C] (e) carol: der PDF-Dialog öffnet sich')
			const geo = await pc.locator(PDF_DIALOG).first().evaluate((d) => {
				const r = (e) => e.getBoundingClientRect()
				const rows = [...d.querySelectorAll('[data-knorke-pdf-page]')].map((e) => Math.round(r(e).height))
				const save = d.querySelector('[data-knorke-action=export-pdf-save]')
				const s = save ? r(save) : null
				return { rows, save: s ? [s.left, s.right, s.bottom] : null, vw: innerWidth, vh: innerHeight }
			})
			t.check(geo.rows.length === 3 && geo.rows.every((h) => h >= 44), '[C] (e) drei Seitengrößen, jede Zeile mindestens 44 px hoch', geo.rows)
			t.check(!!geo.save && geo.save[0] >= 0 && geo.save[1] <= geo.vw && geo.save[2] <= geo.vh, '[C] (e) Save liegt bei 500 × 800 ganz im Bild', geo)
			await pc.keyboard.press('Escape')

			t.step('(f) Seitengröße A4: quer, gemerkt; Esc speichert nichts')
			const a4 = await download(pa, () => savePdf(pa, () => menuAction(pa, 'export-pdf', { menus: BOARD_MENUS }), 'a4'))
			t.must(!!a4, '[C] (f) A4 → Save lädt eine Datei')
			fs.writeFileSync(path.join(outDir(), 'E81-board-a4.pdf'), a4.bytes)
			const pa4 = pdfOf(a4.bytes)
			t.must(!pa4.error, '[S] (f) das A4-PDF liest sich', pa4.error)
			t.check(frame.w > frame.h && pa4.pages === 1 && near(pa4.mediaBox[2], 841.89) && near(pa4.mediaBox[3], 595.276), '[S] (f) eine A4-Seite quer (841,89 × 595,276 pt), der Inhalt ist breiter als hoch', { box: pa4.mediaBox, frame })
			const shown4 = shownStrings(pa4.content).join('')
			t.check(shown4.includes('Form') && shown4.includes('E81 Text'), '[S] (f) der Text steht auch im A4-PDF', shown4.slice(0, 120))
			const la4 = await lastExport(pa)
			t.check(la4?.page === 'a4' && near(la4.width, 841.89) && near(la4.height, 595.276) && la4.scale > 0 && la4.scale < PT, '[C] (f) lastExport(): page a4, die Seite in pt, verkleinert', la4)
			await reopenAt(a, board, CAM)
			const quiet = pa.waitForEvent('download', { timeout: 3000 }).then((d) => d.suggestedFilename(), () => null)
			await menuAction(pa, 'export-pdf', { menus: BOARD_MENUS })
			const none = await pdfChecked(pa)
			await pa.keyboard.press('Escape')
			t.check(none === 'a4', '[C] (f) nach dem Neuladen ist A4 vorgewählt', none)
			t.check((await quiet) === null, '[C] (f) Esc schließt den Dialog ohne Datei', await quiet)
			t.check(!(await pa.locator(PDF_DIALOG).first().isVisible().catch(() => false)), '[C] (f) der Dialog ist zu')
			await sleep(200)
		} finally {
			await blank?.close().catch(() => {})
			for (const x of others) await world.drop(x)
			await world.drop(a)
		}
	},
}
