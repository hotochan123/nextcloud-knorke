/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BPMN files (factory job 205).
 *
 * E85 alice (owner) and bob (shared with "view"), Chromium 1440 × 900 at
 * 100 %, on a board of their own titled "E85 BPMN" with N = 7 items: a start
 * event, a task "E85 Prüfen", an end event, the text item "E85 Ende" below
 * it, a note "E85 Notiz" and two sequence flows. Steps:
 *   (a) alice "⋯" ([data-knorke-menu=board]) → export-bpmn downloads
 *       "E85 BPMN <today>.bpmn": BPMN 2.0 XML with the start event, the task
 *       with its name, the end event named "E85 Ende", two sequence flows
 *       and their DI, without the note; no op goes out;
 *   (b) bob (mode view) finds export-bpmn in "⋯", but no insert-bpmn-file;
 *   (c) alice "⋯" → insert-bpmn-file opens the file picker, the Camunda
 *       fixture dev/e2e/fixtures/order-camunda.bpmn → 21 new items (2
 *       frames with lanes, 8 shapes, 1 text item (job 211: names are labels), 10 connectors), the
 *       frames and connectors selected, the toast bpmn-file-skipped; the
 *       server and bob see N + 21; pictures (no check) of the inserted
 *       process in the light theme and, for a second page of alice, in the
 *       dark one, as E85-*.png in the output's shots/ (the job copies them
 *       into its folder);
 *   (d) Ctrl+Z → N again, also for bob;
 *   (e) a file holding "{}" → the toast [data-knorke-toast=bpmn-file-invalid],
 *       still N items.
 * Own board, no instance setting: before E09, directly after E84 (job
 * 204's). Flake gate: --only E85 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell and
 * session (menus, file, items, selection, toast), [B] the server, [D] a
 * harness precondition. Waiting polls from Node with until() (Nextcloud's
 * CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { K, CANVAS, api, put, ulid, seedOps, openBoard, itemMap, serverMap, until, sleep, settle } from '../lib/harness.mjs'
import { outDir } from '../lib/bridge.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'

/** The camera alice and bob open with: world (0, 0) 300 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -300, scale: 1 })
const TITLE = 'E85 BPMN'
/** Items on the board. */
export const N = 7
/** What the fixture brings: 2 frames, 8 shapes (5 with their name as label, job 211), 1 text item, 10 connectors; 2 elements left out. */
export const INSERTED = 21
const FIXTURE = fileURLToPath(new URL('../fixtures/order-camunda.bpmn', import.meta.url))
const SKIPPED = '[data-knorke-toast=bpmn-file-skipped]'
const INVALID = '[data-knorke-toast=bpmn-file-invalid]'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
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

/** Saves a picture of the canvas as E85-<name>.png in shots/; false when it fails. */
async function picture(page, name) {
	const dir = path.join(outDir(), 'shots')
	fs.mkdirSync(dir, { recursive: true })
	return page.locator(CANVAS).first().screenshot({ path: path.join(dir, `E85-${name}.png`), timeout: 5000 }).then(() => true, () => false)
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const count = (page, sel) => page.locator(sel).count().catch(() => -1)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const tally = (list) => Object.fromEntries(Object.entries(list.reduce((o, it) => ({ ...o, [it.t]: (o[it.t] ?? 0) + 1 }), {})).sort())

export const E85 = {
	id: 'E85',
	title: 'BPMN-Dateien (Job 205): „⋯“ → „Save as BPMN“ lädt „E85 BPMN <heute>.bpmn“ mit Start, Aufgabe, benanntem Ende und zwei Sequenzflüssen, ohne die Notiz; bob (view) hat „Save as BPMN“, aber kein „Insert BPMN file…“; alice fügt die Camunda-Datei ein: 21 Objekte, Rahmen und Verbinder gewählt, Toast bpmn-file-skipped, bob sieht sie, Bilder hell und dunkel; Strg+Z nimmt sie weg; „{}“ ergibt den Toast bpmn-file-invalid',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'view' }])
		const S = ulid()
		const T = ulid()
		const E = ulid()
		const res = await seedOps('alice', board, [
			put.shape(S, { x: 0, y: 28, w: 64, h: 64, data: { kind: 'bpmnStart', text: '' } }),
			put.shape(T, { x: 160, y: 0, w: 180, h: 120, data: { kind: 'bpmnTask', text: 'E85 Prüfen' } }),
			put.shape(E, { x: 440, y: 28, w: 64, h: 64, data: { kind: 'bpmnEnd', text: '' } }),
			put.text(ulid(), { x: 422, y: 100, w: 100, h: 24, data: { text: 'E85 Ende' }, style: { fontSize: 16, color: '#1a1a1a', align: 'center' } }),
			put.sticky(ulid(), { x: 0, y: 300, data: { text: 'E85 Notiz' } }),
			put.connector(ulid(), { item: S }, { item: T }, { style: { endCap: 'triangle' } }),
			put.connector(ulid(), { item: T }, { item: E }, { style: { endCap: 'triangle' } }),
		])
		t.must(res.length === N && res.every((x) => x === 'ok'), '[B] Vorbedingung: Start, Aufgabe, Ende, Text, Notiz und zwei Flüsse gesät', res)
		const a = await world.actor('alice-bpmnfile', { user: 'alice' })
		const b = await world.actor('bob-bpmnfile', { user: 'bob' })
		const views = []
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must((await K.state(pa)).uiMode === 'edit', '[D] Vorbedingung: alice im Modus edit', await K.state(pa))
			t.must((await K.state(pb)).uiMode === 'view', '[D] Vorbedingung: bob im Modus view', await K.state(pb))
			t.must((await itemMap(pa)).size === N, '[D] Vorbedingung: alice sieht 7 Objekte', (await itemMap(pa)).size)
			const old = new Set((await itemMap(pa)).keys())

			t.step('(a) alice „⋯“ → „Save as BPMN“')
			const fa = await download(pa, () => menuAction(pa, 'export-bpmn', { menus: BOARD_MENUS }))
			t.must(!!fa, '[C] (a) „⋯“ → export-bpmn lädt eine Datei')
			const day = await today(pa)
			t.check(fa.name === `${TITLE} ${day}.bpmn`, '[C] (a) die Datei heißt „E85 BPMN <heute>.bpmn“', { name: fa.name, day })
			const xml = fa.bytes.toString('utf8')
			fs.writeFileSync(path.join(outDir(), 'E85-board.bpmn'), fa.bytes)
			t.check(xml.startsWith('<?xml') && xml.includes('<bpmn:definitions ') && xml.includes('targetNamespace="http://bpmn.io/schema/bpmn"'), '[C] (a) BPMN-2.0-XML mit definitions', xml.slice(0, 200))
			t.check(xml.includes(`<bpmn:startEvent id="Event_${S}">`), '[C] (a) das Startereignis')
			t.check(xml.includes(`<bpmn:task id="Activity_${T}" name="E85 Prüfen">`), '[C] (a) die Aufgabe mit ihrem Namen')
			t.check(xml.includes(`<bpmn:endEvent id="Event_${E}" name="E85 Ende">`), '[C] (a) das Ende heißt nach dem Text darunter')
			t.check((xml.match(/<bpmn:sequenceFlow /g) ?? []).length === 2 && (xml.match(/<bpmndi:BPMNEdge /g) ?? []).length === 2, '[C] (a) zwei Sequenzflüsse mit ihrer Linie')
			t.check((xml.match(/<bpmndi:BPMNShape /g) ?? []).length === 3, '[C] (a) drei Formen im Diagramm')
			t.check(!xml.includes('E85 Notiz'), '[C] (a) die Notiz fehlt')
			const st = await K.state(pa)
			t.check(st.pending === 0 && st.inflight === false, '[C] (a) kein Op geht hinaus', { pending: st.pending, inflight: st.inflight })

			t.step('(b) bob (Ansehen): export-bpmn ja, insert-bpmn-file nein')
			const boardMenu = pb.locator('[data-knorke-menu=board]').first()
			t.must(await boardMenu.isVisible().catch(() => false), '[D] (b) Vorbedingung: bob hat „⋯“ [data-knorke-menu=board]')
			await boardMenu.locator('button[aria-haspopup]').first().click()
			// job 228: the entries stand in the submenus "Export" and "Insert"
			t.check(await until(() => visible(pb, '[data-knorke-submenu=export]'), { timeout: 5000 }), '[C] (b) bobs „⋯“ hat „Export ▸“')
			t.check((await count(pb, '[data-knorke-submenu=insert]')) === 0, '[C] (b) bobs „⋯“ hat kein „Insert ▸“ (also kein „BPMN file…“)')
			await pb.locator('[data-knorke-submenu=export]:visible').first().click()
			t.check(await until(() => visible(pb, '[data-knorke-action=export-bpmn]'), { timeout: 5000 }), '[C] (b) unter „Export“: „As BPMN“')
			t.check((await count(pb, '[data-knorke-action=insert-bpmn-file]')) === 0, '[C] (b) nirgends „BPMN file…“')
			await pb.keyboard.press('Escape')

			t.step('(c) alice „⋯“ → „Insert BPMN file…“ mit der Camunda-Datei')
			const picked = await pick(pa, () => menuAction(pa, 'insert-bpmn-file', { menus: BOARD_MENUS }), FIXTURE)
			t.must(picked, '[C] (c) insert-bpmn-file öffnet die Dateiauswahl')
			t.check(await until(async () => (await itemMap(pa)).size === N + INSERTED, { timeout: 8000 }), '[C] (c) das Board hat 28 Objekte', (await itemMap(pa)).size)
			const all = await itemMap(pa)
			const fresh = [...all.keys()].filter((id) => !old.has(id)).map((id) => all.get(id))
			t.check(same(tally(fresh), { connector: 10, frame: 2, shape: 8, text: 1 }), '[C] (c) 2 Rahmen, 8 Formen, 1 Text, 10 Verbinder', tally(fresh))
			const titles = fresh.filter((it) => it.t === 'frame').map((it) => it.data?.title).sort()
			t.check(same(titles, ['Bestellung', 'Kunde']) && fresh.filter((it) => it.t === 'frame').every((it) => it.data?.lanes && typeof it.data.lanes === 'object'), '[C] (c) die Pools sind Rahmen mit Bahnen', titles)
			t.check(fresh.some((it) => it.t === 'shape' && it.data?.kind === 'bpmnUserTask' && it.data?.text === 'Bestellung prüfen'), '[C] (c) die Benutzeraufgabe mit ihrem Namen')
			const roots = fresh.filter((it) => it.t === 'connector' || it.parent === null).map((it) => it.id).sort()
			t.check(same([...(await K.selection(pa))].sort(), roots), '[C] (c) die neuen Rahmen und Verbinder sind ausgewählt', { selection: (await K.selection(pa)).length, roots: roots.length })
			t.check(await until(() => visible(pa, SKIPPED), { timeout: 5000 }), '[C] (c) der Toast [data-knorke-toast=bpmn-file-skipped] nennt die ausgelassenen')
			t.check(await until(async () => (await serverMap('alice', board)).size === N + INSERTED, { timeout: 8000 }), '[B] (c) der Server hat 28 Objekte')
			t.check(await until(async () => (await itemMap(pb)).size === N + INSERTED, { timeout: 8000 }), '[C] (c) bob sieht die 28 Objekte per Sync', (await itemMap(pb)).size)
			await pa.keyboard.press('Escape')
			await settle([pa])
			await picture(pa, 'light-inserted')
			// a fresh page in the dark theme, its camera on the inserted pools
			const order = fresh.find((it) => it.t === 'frame' && it.data?.title === 'Bestellung')
			const v = await world.actor('alice-bpmnfile-dark', { user: 'alice', colorScheme: 'dark' })
			views.push(v)
			await storeCamera(v.page, board, { x: order.x - 120, y: order.y - 120, scale: 1 })
			await openBoard(v, board)
			await settle([v.page])
			await picture(v.page, 'dark-inserted')

			t.step('(d) Strg+Z nimmt alles wieder weg')
			await pa.locator(CANVAS).first().focus().catch(() => null)
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).size === N, { timeout: 5000 }), '[C] (d) Strg+Z: wieder 7 Objekte', (await itemMap(pa)).size)
			t.check(same([...(await itemMap(pa)).keys()].sort(), [...old].sort()), '[C] (d) es bleiben genau die alten Objekte')
			t.check(await until(async () => (await itemMap(pb)).size === N, { timeout: 8000 }), '[C] (d) bob sieht wieder 7 Objekte', (await itemMap(pb)).size)

			t.step('(e) eine Datei „{}“: Toast bpmn-file-invalid, nichts kommt dazu')
			const pickedEmpty = await pick(pa, () => menuAction(pa, 'insert-bpmn-file', { menus: BOARD_MENUS }), { name: 'leer.bpmn', mimeType: 'application/octet-stream', buffer: Buffer.from('{}') })
			t.must(pickedEmpty, '[C] (e) die Dateiauswahl öffnet sich noch einmal')
			t.check(await until(() => visible(pa, INVALID), { timeout: 5000 }), '[C] (e) der Toast [data-knorke-toast=bpmn-file-invalid] erscheint')
			await sleep(800)
			t.check((await itemMap(pa)).size === N, '[C] (e) weiter 7 Objekte', (await itemMap(pa)).size)
			t.check((await serverMap('alice', board)).size === N, '[B] (e) der Server hat weiter 7 Objekte')
		} finally {
			for (const x of views) await world.drop(x)
			await world.drop(b)
			await world.drop(a)
		}
	},
}
