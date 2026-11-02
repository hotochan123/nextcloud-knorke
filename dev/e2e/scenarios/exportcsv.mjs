/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Save as CSV (factory job 179).
 *
 * E68 alice (owner, language en) and bob (shared with "view"), Chromium
 * 1440 × 900 at 100 %, on a board of their own titled "E68 Liste": frame F
 * at (0, 0), 400 × 600, titled "E68 Frame", with the notes N1 "E68 oben"
 * (light yellow) at (100, 60) and N2 "E68 unten" (light blue) at
 * (100, 320) inside, one below the other; N1 gets the reaction 👍 from
 * alice (through the context bar); right of the frame the loose note X
 * "=1+1" (light orange) at (600, 60). Steps:
 *   (a) "⋯" ([data-knorke-menu=board]) → export-csv downloads
 *       "E68 Liste <today>.csv" (the page's local day): the bytes start with
 *       the UTF-8 BOM, then the header Type,Text,Color,Frame,Reactions,Votes,Tags,
 *       N1 with "E68 Frame" and "👍 1", N2, X as '=1+1, each row ending in
 *       CRLF; no op goes out;
 *   (b) the context menu of F (a right click on its title) lists export-csv
 *       right after export-png (job 200: after export-svg and export-pdf);
 *       it downloads a file with exactly N1 and N2;
 *   (c) bob (view) finds export-png (job 200: and export-svg, export-pdf)
 *       but no export-csv in "⋯", and at
 *       500 × 800 neither in the overflow menu [data-knorke-menu=overflow].
 * Own board, no instance setting: before E09, directly after E67 (job
 * 178's). Flake gate: --only E68 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell and
 * session (menus, file name, file content), [B] the server, [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, until, sleep } from '../lib/harness.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'

/** The camera alice and bob open with: world (0, 0) 300 px right of and 250 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -250, scale: 1 })
const TITLE = 'E68 Liste'
const FRAME = 'E68 Frame'
const THUMBS = '1f44d'
const PICK = '[data-knorke-reactions=pick]'
const MENU = '[data-knorke-menu=context]'
/** The file's first row (alice and bob have the language en: "," as the separator). */
export const HEADER = 'Type,Text,Color,Frame,Reactions,Votes,Tags'
/** The rows of the whole board, in order. */
export const ROWS = Object.freeze([
	'Note,E68 oben,Yellow,E68 Frame,👍 1,,',
	'Note,E68 unten,Light blue,E68 Frame,,,',
	"Note,'=1+1,Orange,,,,",
])

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

/** The page's local calendar day YYYY-MM-DD (the file name's date). */
const today = (page) => page.evaluate(() => {
	const d = new Date()
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

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

/** @param {Buffer} bytes the file @return {boolean} it starts with the UTF-8 BOM */
const hasBom = (bytes) => bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf

/** @param {Buffer} bytes the file @return {string[]|null} its rows without the BOM (null when a row does not end in CRLF) */
function rowsOf(bytes) {
	const text = bytes.subarray(hasBom(bytes) ? 3 : 0).toString('utf8')
	if (!text.endsWith('\r\n')) return null
	const rows = text.slice(0, -2).split('\r\n')
	return rows.some((r) => r.includes('\n') || r.includes('\r')) ? null : rows
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The visible export entries of a page (data-knorke-action export-…), in document order. */
const visibleExports = (page) => page.locator('[data-knorke-action^="export-"]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-action')))

/**
 * Opens a board menu ([data-knorke-menu=board] or the overflow menu) by its trigger
 * and (job 228) its submenu "Export".
 * @return {Promise<string[]>} the visible export entries, in order
 */
async function exportEntries(page, menu) {
	await page.locator(`${menu} button[aria-haspopup]`).first().click()
	await until(async () => (await page.locator('[data-knorke-submenu=export]:visible').count()) === 1, { timeout: 5000 })
	await page.locator('[data-knorke-submenu=export]:visible').first().click()
	await until(async () => (await page.locator('[data-knorke-action=export-png]:visible').count()) === 1, { timeout: 5000 })
	const keys = await visibleExports(page)
	await page.keyboard.press('Escape')
	return keys
}

export const E68 = {
	id: 'E68',
	title: 'Board als CSV speichern (Job 179): „⋯“ → „Save as CSV“ lädt „<Titel> <heute>.csv“ mit BOM, Kopfzeile Type,Text,Color,Frame,Reactions,Votes,Tags, den Frame-Notizen (oben mit „E68 Frame“ und „👍 1“, unten) und der losen Notiz als \'=1+1, CRLF; Kontextmenü des Frames lädt genau die zwei Frame-Notizen; bob (Ansehen) hat kein export-csv, auch nicht bei 500 px im Überlaufmenü',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'view' }])
		const F = ulid()
		const N1 = ulid()
		const N2 = ulid()
		const X = ulid()
		const res = await seedOps('alice', board, [
			put.frame(F, { x: 0, y: 0, w: 400, h: 600, data: { title: FRAME } }),
			put.sticky(N1, { x: 100, y: 60, parent: F, data: { text: 'E68 oben' }, style: { fill: '#fff6b6' } }),
			put.sticky(N2, { x: 100, y: 320, parent: F, data: { text: 'E68 unten' }, style: { fill: '#a8d8f8' } }),
			put.sticky(X, { x: 600, y: 60, data: { text: '=1+1' }, style: { fill: '#ffb27a' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: F mit N1 und N2, die lose Notiz X gesät', res)
		const a = await world.actor('alice-csv', { user: 'alice' })
		const pa = a.page
		const others = []
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			t.must(Math.abs((await K.camera(pa)).scale - 1) < 1e-9, '[D] Vorbedingung: alice öffnet mit 100 %', await K.camera(pa))

			// the reaction on N1 (alice, through the context bar)
			const c1 = await K.w2s(pa, 200, 160)
			t.must(await canvasAt(pa, c1), '[D] Vorbedingung: die Mitte von N1 liegt frei auf der Leinwand', c1)
			await pa.mouse.click(c1.x, c1.y)
			t.must(await until(async () => same(await K.selection(pa), [N1]), { timeout: 3000 }), '[D] Vorbedingung: N1 gewählt', await K.selection(pa))
			const react = pa.locator('[data-knorke-action=react]').first()
			t.must(await react.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[D] Vorbedingung: die Leiste zeigt „Add reaction“')
			await react.click()
			t.must(await until(() => pa.locator(PICK).first().isVisible().catch(() => false), { timeout: 3000 }), '[D] Vorbedingung: die Schnellreihe ist offen')
			await pa.locator(`${PICK} [data-knorke-react="${THUMBS}"]`).first().click()
			t.must(await until(async () => ((await K.scene(pa))?.reactions ?? []).some((r) => r.id === N1 && same(r.shown.map(([e, c]) => [e, c]), [[THUMBS, 1]])), { timeout: 5000 }),
				'[D] Vorbedingung: N1 zeigt 👍 1', (await K.scene(pa))?.reactions)
			await pa.keyboard.press('Escape')
			t.must(await K.waitIdle(pa, 8000).then(() => true, () => false), '[D] Vorbedingung: die Reaktion ist gesendet (nichts mehr offen)', await K.state(pa))

			t.step('(a) „⋯“ → „Save as CSV“')
			const cam0 = await K.camera(pa)
			const day = await today(pa)
			const fa = await download(pa, () => menuAction(pa, 'export-csv', { menus: BOARD_MENUS }))
			t.must(!!fa, '[C] (a) „⋯“ → export-csv lädt eine Datei')
			t.check(fa.name === `${TITLE} ${day}.csv`, '[C] (a) Dateiname „<Titel> <heute>.csv“', { name: fa.name, want: `${TITLE} ${day}.csv` })
			t.check(hasBom(fa.bytes), '[C] (a) die Datei beginnt mit dem UTF-8-BOM', fa.bytes.subarray(0, 4).toString('hex'))
			const ra = rowsOf(fa.bytes)
			t.must(Array.isArray(ra), '[C] (a) jede Zeile endet auf CRLF', fa.bytes.toString('utf8').slice(0, 300))
			t.check(ra[0] === HEADER, '[C] (a) die Kopfzeile Type,Text,Color,Frame,Reactions,Votes,Tags', ra[0])
			t.check(same(ra.slice(1), ROWS), '[C] (a) oben mit „E68 Frame“ und „👍 1“, dann unten, dann die lose Notiz als \'=1+1', ra)
			t.check(same(await K.camera(pa), cam0), '[C] (a) die Kamera bleibt', { before: cam0, after: await K.camera(pa) })
			const st = await K.state(pa)
			t.check(st.pending === 0 && st.inflight === false, '[C] (a) kein Op geht hinaus (nichts offen, nichts unterwegs)', { pending: st.pending, inflight: st.inflight })

			t.step('(b) Kontextmenü des Frames: genau die zwei Frame-Notizen')
			const title = await K.w2s(pa, 30, -8)
			t.must(await canvasAt(pa, title), '[D] (b) Vorbedingung: der Titel von F liegt frei auf der Leinwand', title)
			await pa.mouse.click(title.x, title.y, { button: 'right' })
			t.must(await until(() => pa.locator(MENU).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (b) das Kontextmenü öffnet sich auf F')
			t.check(same(await K.selection(pa), [F]), '[C] (b) der Rechtsklick wählt F', await K.selection(pa))
			const entries = await pa.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			// job 200: export-svg and export-pdf stand between them; job 205: export-bpmn too
			t.check(entries[entries.indexOf('export-png') + 4] === 'export-csv', '[C] (b) export-csv nach export-png, export-svg, export-pdf und export-bpmn', entries)
			const fb = await download(pa, () => pa.locator(`${MENU} [data-knorke-menu-item=export-csv]`).first().click())
			t.must(!!fb, '[C] (b) export-csv aus dem Kontextmenü lädt eine Datei')
			const rb = rowsOf(fb.bytes)
			t.check(hasBom(fb.bytes) && Array.isArray(rb) && same(rb, [HEADER, ...ROWS.slice(0, 2)]), '[C] (b) die Datei hat genau die zwei Frame-Notizen', rb)
			t.check(fb.name === fa.name, '[C] (b) auch die Auswahl heißt nach dem Board', fb.name)

			t.step('(c) bob (Ansehen): kein export-csv in „⋯“, auch nicht bei 500 px im Überlaufmenü')
			const b = await world.actor('bob-csv', { user: 'bob' })
			others.push(b)
			await storeCamera(b.page, board, CAM)
			await openBoard(b, board)
			const pb = b.page
			t.must((await K.state(pb)).uiMode === 'view', '[D] (c) Vorbedingung: bob im Modus view', await K.state(pb))
			t.must(await pb.locator('[data-knorke-menu=board]').first().isVisible().catch(() => false), '[C] (c) bob sieht „⋯“ [data-knorke-menu=board]')
			const wide = await exportEntries(pb, '[data-knorke-menu=board]')
			t.check(same(wide, ['export-png', 'export-svg', 'export-pdf', 'export-bpmn']), '[C] (c) in „⋯“ › „Export“ stehen export-png, export-svg, export-pdf und export-bpmn, kein export-csv', wide)
			const n = await world.actor('bob-csv-500', { user: 'bob', viewport: { width: 500, height: 800 } })
			others.push(n)
			await storeCamera(n.page, board, CAM)
			await openBoard(n, board)
			const pn = n.page
			t.must(await pn.locator('[data-knorke-menu=overflow]').first().isVisible().catch(() => false), '[C] (c) bei 500 px zeigt sich das Überlaufmenü [data-knorke-menu=overflow]')
			const narrow = await exportEntries(pn, '[data-knorke-menu=overflow]')
			t.check(same(narrow, ['export-png', 'export-svg', 'export-pdf', 'export-bpmn']), '[C] (c) im Überlaufmenü › „Export“ stehen export-png, export-svg, export-pdf und export-bpmn, kein export-csv', narrow)
			t.check((await pn.locator('[data-knorke-action=export-csv]').count()) === 0, '[C] (c) kein [data-knorke-action=export-csv] auf der Seite')
			await sleep(200)
		} finally {
			for (const x of others) await world.drop(x)
			await world.drop(a)
		}
	},
}
