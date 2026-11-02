/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Board as a file (factory job 181).
 *
 * E70 alice (owner) and bob (shared with "view"), Chromium 1440 × 900 at
 * 100 %, on a board of their own titled "E70 Datei" with N = 5 items, all
 * roots: a frame F, the notes A (with alice's reaction 👍) and B, the shape
 * S (locked by alice) and a connector K from A to S. Steps:
 *   (a) alice "⋯" ([data-knorke-menu=board]) → download-board downloads
 *       "E70 Datei.knorke": JSON with kind "board", the title and N items,
 *       without alice's name or pid, without react and lock; no op goes out;
 *   (b) bob (mode view) finds download-board in "⋯", but no
 *       insert-board-file;
 *   (c) alice "⋯" → insert-board-file opens the file picker (Playwright's
 *       filechooser: click() on input[data-knorke-board-file] inside the
 *       click), the file of (a) → the board has 2N items, exactly the N new
 *       ones are selected, the canvas has the focus, the server and bob see
 *       2N; Ctrl+Z → N again, also for bob;
 *   (d) a file holding "{}" → the toast [data-knorke-toast=board-file-invalid],
 *       still N items.
 * Own board, no instance setting: before E09, directly after E69 (job
 * 180's). Flake gate: --only E70 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell and
 * session (menus, file, items, selection, focus, toast), [B] the server, [D]
 * a harness precondition. Waiting polls from Node with until() (Nextcloud's
 * CSP, ENTWICKLUNG trap 9.10).
 */
import { K, api, put, ulid, seedOps, openBoard, itemMap, serverMap, until, sleep, canvasFocused } from '../lib/harness.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'

/** The camera alice and bob open with: world (0, 0) 300 px right of and 250 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -250, scale: 1 })
const TITLE = 'E70 Datei'
/** Items on the board (all roots, so all of them are selected after an insert). */
export const N = 5
/** The file name of the download (src/board/boardFile.js boardFileName). */
export const FILE = 'E70 Datei.knorke'
const THUMBS = '1f44d'
const INVALID = '[data-knorke-toast=board-file-invalid]'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

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

/**
 * Runs `start` and answers the file picker it opens with one file.
 * @return {Promise<boolean>} a picker opened within 10 s and took the file
 */
async function pick(page, start, file) {
	const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null), start()])
	if (!chooser) return false
	await chooser.setFiles(file)
	return true
}

/** @param {Buffer} bytes the file @return {object|null} its JSON, null when it is none */
function jsonOf(bytes) {
	try {
		return JSON.parse(bytes.toString('utf8'))
	} catch (e) {
		return null
	}
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const count = (page, sel) => page.locator(sel).count().catch(() => -1)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export const E70 = {
	id: 'E70',
	title: 'Board als Datei (Job 181): „⋯“ → „Download board“ lädt „E70 Datei.knorke“ mit 5 Objekten ohne Namen; bob (view) hat den Download, aber kein „Insert board file…“; alice fügt die Datei über die Dateiauswahl ein: 10 Objekte, die 5 neuen ausgewählt, bob sieht sie, Strg+Z nimmt sie weg; eine Datei „{}“ ergibt den Toast board-file-invalid',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'view' }])
		const snap = await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)
		const me = snap.data?.me ?? {}
		t.must(typeof me.pid === 'string' && typeof me.name === 'string' && me.name !== '', '[D] Vorbedingung: alices pid und Name aus dem Snapshot', me)
		const F = ulid()
		const A = ulid()
		const B = ulid()
		const S = ulid()
		const KC = ulid()
		const res = await seedOps('alice', board, [
			put.frame(F, { x: 0, y: 0, w: 400, h: 300, data: { title: 'E70 Rahmen' } }),
			put.sticky(A, { x: 500, y: 0, data: { text: 'E70 Notiz A' } }),
			put.sticky(B, { x: 500, y: 260, data: { text: 'E70 Notiz B' }, style: { fill: '#a8d8f8' } }),
			put.shape(S, { x: 800, y: 40, data: { kind: 'rect', text: 'E70 Form' } }),
			put.connector(KC, { item: A }, { item: S }),
			{ o: 'patch', id: A, p: { [`data.react.p${me.pid}`]: { e: THUMBS, n: me.name } } },
			{ o: 'patch', id: S, p: { lock: { by: me.pid, name: me.name } } },
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Frame, zwei Notizen, Form und Verbinder gesät, A mit 👍, S gesperrt', res)
		const seeded = await serverMap('alice', board)
		t.must(seeded.size === N && !!seeded.get(A)?.data?.react && !!seeded.get(S)?.lock, '[D] Vorbedingung: der Server hat 5 Objekte, A trägt eine Reaktion, S eine Sperre', { size: seeded.size, react: seeded.get(A)?.data?.react, lock: seeded.get(S)?.lock })
		const a = await world.actor('alice-file', { user: 'alice' })
		const b = await world.actor('bob-file', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must((await K.state(pa)).uiMode === 'edit', '[D] Vorbedingung: alice im Modus edit', await K.state(pa))
			t.must((await K.state(pb)).uiMode === 'view', '[D] Vorbedingung: bob im Modus view', await K.state(pb))
			t.must((await itemMap(pa)).size === N, '[D] Vorbedingung: alice sieht 5 Objekte', (await itemMap(pa)).size)
			const old = new Set((await itemMap(pa)).keys())

			t.step('(a) alice „⋯“ → „Download board“')
			const fa = await download(pa, () => menuAction(pa, 'download-board', { menus: BOARD_MENUS }))
			t.must(!!fa, '[C] (a) „⋯“ → download-board lädt eine Datei')
			t.check(fa.name === FILE, '[C] (a) die Datei heißt „E70 Datei.knorke“', fa.name)
			const text = fa.bytes.toString('utf8')
			const f = jsonOf(fa.bytes)
			t.check(!!f && f.knorke === 1 && f.kind === 'board' && f.title === TITLE, '[C] (a) knorke 1, kind board und der Titel', f && { knorke: f.knorke, kind: f.kind, title: f.title })
			t.check(Array.isArray(f?.items) && f.items.length === N, '[C] (a) die Datei hat 5 Objekte', f?.items?.length)
			const leaks = [me.name, me.pid, '"react"', '"lock"', '"board":'].filter((w) => text.includes(w))
			t.check(leaks.length === 0, '[C] (a) weder alices Name noch ihre pid, keine Reaktion, keine Sperre, kein board-Schlüssel', leaks)
			const st = await K.state(pa)
			t.check(st.pending === 0 && st.inflight === false, '[C] (a) kein Op geht hinaus (nichts offen, nichts unterwegs)', { pending: st.pending, inflight: st.inflight })
			t.check((await serverMap('alice', board)).size === N, '[B] (a) der Server hat weiter 5 Objekte')

			t.step('(b) bob (Ansehen): download-board ja, insert-board-file nein')
			const boardMenu = pb.locator('[data-knorke-menu=board]').first()
			t.must(await boardMenu.isVisible().catch(() => false), '[D] (b) Vorbedingung: bob hat „⋯“ [data-knorke-menu=board]')
			await boardMenu.locator('button[aria-haspopup]').first().click()
			// job 228: the entries stand in the submenus "Export" and "Insert"
			t.check(await until(() => visible(pb, '[data-knorke-submenu=export]'), { timeout: 5000 }), '[C] (b) bobs „⋯“ hat „Export ▸“')
			t.check((await count(pb, '[data-knorke-submenu=insert]')) === 0, '[C] (b) bobs „⋯“ hat kein „Insert ▸“ (also kein „Board file…“)')
			await pb.locator('[data-knorke-submenu=export]:visible').first().click()
			t.check(await until(() => visible(pb, '[data-knorke-action=download-board]'), { timeout: 5000 }), '[C] (b) unter „Export“: „Download board file“')
			t.check((await count(pb, '[data-knorke-action=insert-board-file]')) === 0, '[C] (b) nirgends „Board file…“')
			await pb.keyboard.press('Escape')

			t.step('(c) alice „⋯“ → „Insert board file…“ mit der Datei aus (a), Strg+Z')
			const picked = await pick(pa, () => menuAction(pa, 'insert-board-file', { menus: BOARD_MENUS }), { name: fa.name, mimeType: 'application/octet-stream', buffer: fa.bytes })
			t.must(picked, '[C] (c) insert-board-file öffnet die Dateiauswahl')
			t.check(await until(async () => (await itemMap(pa)).size === 2 * N, { timeout: 8000 }), '[C] (c) das Board hat 10 Objekte', (await itemMap(pa)).size)
			const all = await itemMap(pa)
			const fresh = [...all.keys()].filter((id) => !old.has(id))
			t.check(fresh.length === N, '[C] (c) 5 neue Objekte mit neuen IDs', fresh.length)
			t.check(same([...(await K.selection(pa))].sort(), [...fresh].sort()), '[C] (c) genau die 5 neuen Objekte sind ausgewählt', { selection: await K.selection(pa), fresh })
			const texts = fresh.map((id) => all.get(id)?.data?.text ?? all.get(id)?.data?.title ?? '').filter(Boolean).sort()
			t.check(same(texts, ['E70 Form', 'E70 Notiz A', 'E70 Notiz B', 'E70 Rahmen']), '[C] (c) die neuen Objekte tragen die Texte und den Titel', texts)
			const nc = fresh.map((id) => all.get(id)).find((it) => it?.t === 'connector')
			t.check(!!nc && fresh.includes(nc.data?.start?.item) && fresh.includes(nc.data?.end?.item), '[C] (c) der neue Verbinder hängt an den neuen Objekten', nc?.data)
			t.check(fresh.every((id) => !all.get(id)?.data?.react && !all.get(id)?.lock), '[C] (c) keine Reaktion, keine Sperre an den neuen Objekten')
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[C] (c) die Zeichenfläche hat den Fokus')
			t.check(await until(async () => (await serverMap('alice', board)).size === 2 * N, { timeout: 8000 }), '[B] (c) der Server hat 10 Objekte')
			t.check(await until(async () => (await itemMap(pb)).size === 2 * N, { timeout: 8000 }), '[C] (c) bob sieht die 10 Objekte per Sync', (await itemMap(pb)).size)
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).size === N, { timeout: 5000 }), '[C] (c) Strg+Z: wieder 5 Objekte', (await itemMap(pa)).size)
			t.check(same([...(await itemMap(pa)).keys()].sort(), [...old].sort()), '[C] (c) es bleiben genau die alten Objekte')
			t.check(await until(async () => (await itemMap(pb)).size === N, { timeout: 8000 }), '[C] (c) bob sieht wieder 5 Objekte', (await itemMap(pb)).size)

			t.step('(d) eine Datei „{}“: Toast board-file-invalid, nichts kommt dazu')
			const pickedEmpty = await pick(pa, () => menuAction(pa, 'insert-board-file', { menus: BOARD_MENUS }), { name: 'leer.knorke', mimeType: 'application/octet-stream', buffer: Buffer.from('{}') })
			t.must(pickedEmpty, '[C] (d) die Dateiauswahl öffnet sich noch einmal')
			t.check(await until(() => visible(pa, INVALID), { timeout: 5000 }), '[C] (d) der Toast [data-knorke-toast=board-file-invalid] erscheint')
			await sleep(800)
			t.check((await itemMap(pa)).size === N, '[C] (d) weiter 5 Objekte', (await itemMap(pa)).size)
			t.check((await serverMap('alice', board)).size === N, '[B] (d) der Server hat weiter 5 Objekte')
			await sleep(200)
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
