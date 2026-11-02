/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BPMN 2.0 (factory job 204).
 *
 * E84 alice (owner), Chromium 1440 × 900 at 100 %, on a board of her own
 * with one shape of every BPMN kind and a sequence and a message flow
 * seeded far below the view (for the picture of a process). Steps:
 *   (1) the shape tool (job 229) opens the panel; the section bpmn stands after flowchart;
 *   (2) the tile bpmn.userTask dragged onto the board (real mouse): a shape
 *       of kind bpmnUserTask 180 × 120 whose centre is the release point
 *       (± 2 world px); Esc;
 *   (3) a click on the tile bpmn.exclusive, then a click on the board: a
 *       bpmnExclusive of 80 × 80 centred there (± 2), no editor; Esc;
 *   (4) the tile bpmn.pool dragged onto the board: a frame whose
 *       scene().lanes has 3 lanes, centred at the release point (± 2); Esc;
 *   (5) a click on the user task, Shift and a click on the gateway,
 *       "Connect" in the context bar: a new connector, selected; "Tips",
 *       then "Message flow": its line dashed, its tips circleOpen and
 *       triangleOpen, the button pressed, the server holds it so; Ctrl+Z:
 *       the connector looks as before (no dash, end tip arrow);
 *   (6) pictures (no check): the BPMN section in the light theme and, for a
 *       second page of alice, in the dark one (prefers-color-scheme), and
 *       the seeded process on the board in both, as E84-*.png in the
 *       output's shots/ (the job copies them into its folder).
 * Own board, no instance setting: before E09, directly after E83 (job
 * 203's). Flake gate: --only E84 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, editor, the panel), [C] session and sync (what is created and
 * changed), [B] the server, [D] a harness precondition. Waiting polls from
 * Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { K, CANVAS, put, ulid, seedOps, openBoard, until, settle, itemMap, idSet, serverMap, barMore } from '../lib/harness.mjs'
import { outDir } from '../lib/bridge.mjs'

/** The camera alice opens with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Where the seeded process lies (world), far below the first view. */
const SEED_Y = 4000
/** The camera of the pictures of the process. */
const PROCESS_CAM = Object.freeze({ x: -80, y: SEED_Y - 100, scale: 0.75 })
const BPMN = [
	'bpmnStart', 'bpmnStartMessage', 'bpmnStartTimer', 'bpmnIntermediate', 'bpmnIntermediateMessage', 'bpmnIntermediateTimer',
	'bpmnEnd', 'bpmnEndMessage', 'bpmnEndError', 'bpmnEndTerminate',
	'bpmnTask', 'bpmnUserTask', 'bpmnServiceTask', 'bpmnManualTask', 'bpmnScriptTask', 'bpmnRuleTask', 'bpmnSendTask',
	'bpmnReceiveTask', 'bpmnSubprocess', 'bpmnCallActivity',
	'bpmnExclusive', 'bpmnParallel', 'bpmnInclusive', 'bpmnEventGateway',
	'bpmnDataObject', 'bpmnDataInput', 'bpmnDataOutput', 'bpmnDataStore',
]
const SIZE = (k) => (/Task$|Subprocess|CallActivity/.test(k) ? [180, 120] : /^bpmn(Exclusive|Parallel|Inclusive|EventGateway)$/.test(k) ? [80, 80]
	: /^bpmnData(Object|Input|Output)$/.test(k) ? [80, 100] : k === 'bpmnDataStore' ? [120, 120] : [64, 64])
const PANEL = '[data-knorke-shapes]'
const TILE = (id) => `${PANEL} [data-knorke-shape="${id}"]`
const EDITOR = 'textarea[data-knorke-editor]'

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Opens the panel with the tool bar's shape tool (real click; job 229) and waits for it. */
async function openPanel(page) {
	await page.locator('[data-knorke-tool=shape]').first().click({ timeout: 3000 })
	return until(async () => (await page.locator(PANEL).count()) > 0, { timeout: 3000 })
}

/** Centre of the first element of a selector in client px (scrolled into the panel's view first), or null. */
async function centre(page, sel) {
	await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => null)
	const b = await page.locator(sel).first().boundingBox({ timeout: 3000 }).catch(() => null)
	return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
}

/** A drag with the real mouse from a to b. */
async function drag(page, a, b) {
	await page.mouse.move(a.x, a.y)
	await page.mouse.down()
	await page.mouse.move(a.x + 10, a.y, { steps: 3 })
	await page.mouse.move(b.x, b.y, { steps: 16 })
	await page.mouse.up()
}

/** The one item that is not in before, or null. */
async function newItem(page, before) {
	for (const [k, it] of await itemMap(page)) if (!before.has(k)) return it
	return null
}

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

/** Saves a picture of an element (or the page) as E84-<name>.png in shots/; false when it fails. */
async function picture(page, name, sel = null) {
	const dir = path.join(outDir(), 'shots')
	fs.mkdirSync(dir, { recursive: true })
	const file = path.join(dir, `E84-${name}.png`)
	const target = sel ? page.locator(sel).first() : page
	return target.screenshot({ path: file, timeout: 5000 }).then(() => true, () => false)
}

export const E84 = {
	id: 'E84',
	title: 'BPMN (Job 204): Abschnitt BPMN nach Flowchart; „User task“ aufs Board gezogen legt sie am Ablegepunkt an; Klick „Exclusive gateway“, dann aufs Board: 80 × 80 ohne Editor; „Pool with lanes“ gezogen: Rahmen mit 3 Bahnen; zwei Formen verbunden, „Message flow“ macht den Verbinder gestrichelt mit offenen Spitzen, Strg+Z zurück; Bilder hell und dunkel',
	async run(t, world) {
		const board = await world.board('E84 BPMN')
		const ids = BPMN.map(() => ulid())
		const seed = BPMN.map((kind, i) => {
			const [w, h] = SIZE(kind)
			return put.shape(ids[i], {
				x: (i % 7) * 240, y: SEED_Y + Math.floor(i / 7) * 220, w, h,
				data: { kind, text: /Task$|Subprocess|CallActivity|Data/.test(kind) ? kind.replace(/^bpmn/, '') : '' },
			})
		})
		seed.push(put.connector(ulid(), { item: ids[0] }, { item: ids[11] }, { data: { route: 'elbow' }, style: { endCap: 'triangle' } }))
		seed.push(put.connector(ulid(), { item: ids[16] }, { item: ids[17] }, { style: { dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' } }))
		const res = await seedOps('alice', board, seed)
		t.must(res.length === 30 && res.every((x) => x === 'ok'), '[D] Vorbedingung: je eine Form jeder BPMN-Art und zwei Flüsse gesät (der Server nimmt Arten und Spitzen an)', res)
		const a = await world.actor('alice-bpmn', { user: 'alice' })
		const pa = a.page
		const views = []
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)

			t.step('(1) „Shapes“ öffnet die Leiste mit dem Abschnitt BPMN')
			t.must(await openPanel(pa), '[S] (1) die Leiste ist offen')
			const libs = await pa.locator(`${PANEL} [data-knorke-shape-lib]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-shape-lib')))
			t.check(libs.indexOf('bpmn') === libs.indexOf('flowchart') + 1 && libs.indexOf('bpmn') > 0, '[S] (1) der Abschnitt bpmn steht nach flowchart', libs)

			t.step('(2) „User task“ aufs Board gezogen')
			const W2 = { x: 120, y: 60 }
			const before2 = await idSet(pa)
			const to2 = await K.w2s(pa, W2.x, W2.y)
			await drag(pa, await centre(pa, TILE('bpmn.userTask')), to2)
			const task = await until(() => newItem(pa, before2), { timeout: 5000 })
			t.must(task, '[S] (2) das Ablegen legt eine Form an')
			t.check(task.t === 'shape' && task.data?.kind === 'bpmnUserTask' && task.w === 180 && task.h === 120, '[C] (2) eine Benutzeraufgabe 180 × 120', { t: task.t, kind: task.data?.kind, w: task.w, h: task.h })
			t.check(near(task.x + task.w / 2, W2.x) && near(task.y + task.h / 2, W2.y), '[C] (2) ihre Mitte liegt am Ablegepunkt (± 2)', { x: task.x + task.w / 2, y: task.y + task.h / 2 })
			await pa.keyboard.press('Escape')
			await settle([pa])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Escape')
			await settle([pa])

			t.step('(3) Klick auf „Exclusive gateway“, dann Klick aufs Board')
			const W3 = { x: 420, y: 60 }
			await pa.locator(TILE('bpmn.exclusive')).first().click({ timeout: 3000 })
			const before3 = await idSet(pa)
			const at3 = await K.w2s(pa, W3.x, W3.y)
			await pa.mouse.click(at3.x, at3.y)
			const gw = await until(() => newItem(pa, before3), { timeout: 5000 })
			t.must(gw, '[S] (3) der Klick aufs Board legt eine Form an')
			t.check(gw.data?.kind === 'bpmnExclusive' && gw.w === 80 && gw.h === 80, '[C] (3) ein exklusives Gateway 80 × 80', { kind: gw.data?.kind, w: gw.w, h: gw.h })
			t.check(near(gw.x + 40, W3.x) && near(gw.y + 40, W3.y), '[C] (3) mittig am Klickpunkt (± 2)', { x: gw.x, y: gw.y })
			await settle([pa])
			t.check((await pa.locator(EDITOR).count()) === 0, '[S] (3) kein Texteditor am Gateway')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Escape')
			await settle([pa])

			t.step('(4) „Pool with lanes“ aufs Board gezogen')
			const W4 = { x: 450, y: 420 }
			const before4 = await idSet(pa)
			const to4 = await K.w2s(pa, W4.x, W4.y)
			await drag(pa, await centre(pa, TILE('bpmn.pool')), to4)
			const pool = await until(() => newItem(pa, before4), { timeout: 5000 })
			t.must(pool, '[S] (4) das Ablegen legt einen Rahmen an')
			t.check(pool.t === 'frame' && Object.keys(pool.data?.lanes ?? {}).length === 3, '[C] (4) ein Rahmen mit drei Bahnen', { t: pool.t, lanes: pool.data?.lanes })
			t.check(near(pool.x + pool.w / 2, W4.x) && near(pool.y + pool.h / 2, W4.y), '[C] (4) seine Mitte liegt am Ablegepunkt (± 2)', { x: pool.x, y: pool.y, w: pool.w, h: pool.h })
			const lanes = await until(async () => ((await K.scene(pa))?.lanes ?? []).find((x) => x.id === pool.id), { timeout: 3000 })
			t.check(lanes?.lanes?.length === 3, '[S] (4) scene().lanes zeigt 3 Bahnen', lanes)
			await pa.keyboard.press('Escape')
			await settle([pa])
			await pa.locator(`${PANEL} [data-knorke-action=shapes-close]`).first().click({ timeout: 3000 })
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Escape')
			await settle([pa])

			t.step('(5) Aufgabe und Gateway verbunden, „Message flow“, Strg+Z')
			const c1 = await K.w2s(pa, W2.x + 40, W2.y + 30)
			const c2 = await K.w2s(pa, W3.x, W3.y)
			await pa.mouse.click(c1.x, c1.y)
			await pa.keyboard.down('Shift')
			await pa.mouse.click(c2.x, c2.y)
			await pa.keyboard.up('Shift')
			const both = await until(async () => {
				const s = (await K.selection(pa)) || []
				return s.includes(task.id) && s.includes(gw.id) ? s : null
			}, { timeout: 3000 })
			t.must(both, '[D] (5) Aufgabe und Gateway sind gewählt', await K.selection(pa))
			const before5 = await idSet(pa)
			await (await barMore(pa, 'connect', { timeout: 3000 })).click({ timeout: 3000 })
			const conn = await until(() => newItem(pa, before5), { timeout: 5000 })
			t.must(conn?.t === 'connector', '[C] (5) „Connect“ legt einen Verbinder an', conn)
			t.check(await until(async () => JSON.stringify((await K.selection(pa)) || []) === JSON.stringify([conn.id]), { timeout: 3000 }), '[S] (5) der Verbinder ist gewählt')
			await pa.locator('[data-knorke-section=caps]:visible').first().click({ timeout: 3000 })
			await pa.locator('[data-knorke-action=flow-message]:visible').first().click({ timeout: 3000 })
			const look = (it) => ({ dash: it?.style?.dash ?? null, startCap: it?.style?.startCap ?? null, endCap: it?.style?.endCap ?? null })
			const flowed = await until(async () => {
				const it = (await itemMap(pa)).get(conn.id)
				return it?.style?.endCap === 'triangleOpen' ? it : null
			}, { timeout: 3000 })
			t.check(JSON.stringify(look(flowed)) === JSON.stringify({ dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' }), '[C] (5) gestrichelt, offener Kreis, offenes Dreieck', look(flowed))
			const pressed = await pa.locator('[data-knorke-action=flow-message]:visible').first().getAttribute('aria-pressed')
			t.check(pressed === 'true', '[S] (5) „Message flow“ ist gedrückt', pressed)
			await K.waitIdle(pa)
			const srv5 = await serverMap('alice', board)
			t.check(JSON.stringify(look(srv5.get(conn.id))) === JSON.stringify(look(flowed)), '[B] (5) der Server hat den Nachrichtenfluss', look(srv5.get(conn.id)))
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			const undone = await until(async () => {
				const it = (await itemMap(pa)).get(conn.id)
				return it && it.style?.endCap !== 'triangleOpen' ? it : null
			}, { timeout: 3000 })
			t.check(JSON.stringify(look(undone)) === JSON.stringify(look(conn)), '[C] (5) Strg+Z stellt den Verbinder zurück', { before: look(conn), after: look(undone) })

			t.step('(6) Bilder der Bibliothek und des gesäten Prozesses (hell, dunkel)')
			await openPanel(pa)
			await picture(pa, 'light-bpmn', `${PANEL} [data-knorke-shape-lib=bpmn]`)
			// a page that leaves the board stores its own camera (pagehide): the pictures of the process come
			// from fresh pages that open the board at it
			for (const [name, scheme] of [['light', 'light'], ['dark', 'dark']]) {
				const v = await world.actor(`alice-bpmn-${name}`, { user: 'alice', colorScheme: scheme })
				views.push(v)
				await storeCamera(v.page, board, PROCESS_CAM)
				await openBoard(v, board)
				await settle([v.page])
				await picture(v.page, `${name}-process`, CANVAS)
				if (scheme === 'dark') {
					await openPanel(v.page)
					await picture(v.page, 'dark-bpmn', `${PANEL} [data-knorke-shape-lib=bpmn]`)
				}
			}
		} finally {
			for (const v of views) await world.drop(v)
			await world.drop(a)
		}
	},
}
