/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Tables (factory job 173; job 174: keyboard and spreadsheet paste, E64).
 *
 * E63 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with note N left of
 * where the table goes. Steps:
 *   (1) alice presses B and clicks: a 3 × 3 table T, the editor of its
 *       top-left cell open; she types "Name" and ends with Esc; bob's
 *       __knorke.scene().tables shows T with 3 × 3 at the latest 3 s after
 *       her click;
 *   (2) both write at the same time, alice in cell (2, 2), bob in (3, 3)
 *       (double click, type, Esc): both texts at both and at the server;
 *   (3) alice opens cell (1, 2): bob's double click on it opens no editor,
 *       the chip at that cell offers "Take over";
 *   (4) alice selects T: its "+" right gives 4 columns, its "+" below 4
 *       rows; "Delete column" from the menu on a cell of column 2 gives 3,
 *       Ctrl+Z 4 again with the cell's text;
 *   (5) bob drags the border after column 1 by +60: its width is 220 at both;
 *       the switch "Header row" of the context bar's section "Header" gives
 *       header: false in scene().tables;
 *   (6) alice drags with the connector tool from N to T: the connector's
 *       end is bound to T;
 *   (7) "Export as CSV" from the menu on a cell downloads "E63 Tabellen -
 *       Table.csv" whose first line is the header row (BOM, comma, CRLF).
 * Own board, no instance setting: before E09, directly after E61 (E62 is
 * job 172's). Flake gate: --only E63 --repeat 3.
 *
 * E64 (factory job 174, keyboard and spreadsheet paste) alice (owner) and
 * bob (edit), Chromium 1440 × 900, both at 100 % with the same camera, on a
 * board of their own. Steps:
 *   (1) alice presses B and clicks: a 3 × 3 table T, the editor of its
 *       top-left cell open; a paste event with a DataTransfer arrives in
 *       that editor: Excel-like text/plain (tabs, CRLF) with a <table> in
 *       text/html, (job 185) 5 columns × 5 rows, one quoted cell with a
 *       line break (the only synthetic event: headless Chromium has no
 *       clipboard to paste from); Knorke takes it (preventDefault), no
 *       editor stays open, the table grows to 5 × 5;
 *   (2) bob sees 5 × 5 in scene().tables and the texts in items() within
 *       3 s of the paste;
 *   (3) Ctrl+Z at alice: 3 × 3 again at both;
 *   (4) a double click on the last cell, "x" and Tab: 4 rows at both, the
 *       editor in the left cell of the new row;
 *   (5) "abc" with the caret in the middle: ↑ changes data-knorke-cell to
 *       the cell above at once (job 185); → at the end to the right;
 *   (6) (job 185) in that cell of the third row a text without "\n" that
 *       wraps onto several lines: caret at the end, ↑ stays in the cell
 *       and the caret moves up; caret at 2, ↓ stays; caret at 2, ↑ goes to
 *       the cell above; caret at the end, ↓ to the cell below; Esc leaves
 *       no textarea[data-knorke-editor].
 * Own board, no instance setting: directly after E63, before E09. Flake
 * gate: --only E64 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (tool, editor, handles, chip, border, menu), [C] session and sync (what
 * reaches the other one, undo), [B] the server, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, until, settle, sleep, itemMap, idSet, serverMap, dragPath, canvasFocused } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Where alice clicks with the table tool (world): the table's centre; 480 × 108, so x 60–540, y 96–204. */
const P = Object.freeze({ x: 300, y: 150 })
/** AK8: bob sees the new table at the latest this long after alice's click. */
const SEEN_MS = 3000
const MENU = '[data-knorke-menu=context]'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Columns or rows of a table's data in their order (o like z, then the key). */
function ordered(map) {
	return Object.keys(map ?? {}).sort((a, b) => (map[a].o < map[b].o ? -1 : map[a].o > map[b].o ? 1 : a < b ? -1 : a > b ? 1 : 0))
}

/** The table T as items() of a page has it, or null. */
async function tableOf(page, id) {
	return (await itemMap(page)).get(id) ?? null
}

/** The scene's entry of T in stats().tables, or null. */
async function sceneTable(page, id) {
	const s = await K.scene(page).catch(() => null)
	return (s?.tables ?? []).find((x) => x.id === id) ?? null
}

/** Client point of the centre of cell (col, row) (0-based) of T, from the layout the scene draws. */
async function cellPoint(page, id, col, row) {
	const it = await tableOf(page, id)
	const st = await sceneTable(page, id)
	if (!it || !st) return null
	const x = it.x + st.cols.slice(0, col).reduce((a, b) => a + b, 0) + st.cols[col] / 2
	const y = it.y + st.rows.slice(0, row).reduce((a, b) => a + b, 0) + st.rows[row] / 2
	return K.w2s(page, x, y)
}

/** Text of a cell (col, row) in the data of T. */
function textAt(it, col, row) {
	const c = ordered(it?.data?.cols)[col]
	const r = ordered(it?.data?.rows)[row]
	return it?.data?.cells?.[c]?.[r] ?? ''
}

/** The open cell editor of a page: {cell} or null. */
const cellEditor = (page) => page.evaluate(() => {
	const ta = document.querySelector('textarea[data-knorke-editor][data-knorke-editor-kind="cell"]')
	return ta ? { cell: ta.getAttribute('data-knorke-cell'), value: ta.value } : null
}).catch(() => null)

/** Is any text editor open in a page? */
const anyEditor = (page) => page.evaluate(() => !!document.querySelector('textarea[data-knorke-editor]')).catch(() => false)

/** Clicks a menu entry. */
async function menuItem(page, name) {
	await page.locator(`${MENU} button[role="menuitem"][data-knorke-menu-item="${name}"]`).first().click({ timeout: 3000 })
}

/** Right click (real input) at a client point and wait for the menu. */
async function menuAt(page, pt) {
	await page.mouse.move(pt.x, pt.y)
	await page.mouse.click(pt.x, pt.y, { button: 'right' })
	return until(async () => (await page.locator(MENU).count()) > 0, { timeout: 3000 })
}

export const E63 = {
	id: 'E63',
	title: 'Tabellen (Job 173): alice legt mit B eine 3 × 3-Tabelle an und schreibt „Name“, bob sieht sie ≤ 3 s; beide schreiben zugleich in zwei Zellen; bobs Doppelklick auf alices offene Zelle zeigt „Take over“; „+“ rechts/unten, „Delete column“ und Strg+Z; bob zieht eine Spaltengrenze und schaltet die Kopfzeile ab; ein Verbinder von einer Notiz bindet an die Tabelle; „Export as CSV“ lädt eine .csv',
	async run(t, world) {
		const board = await world.board('E63 Tabellen')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: -400, y: 50, w: 200, h: 200, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[D] Vorbedingung: Notiz N gesät', res)
		const a = await world.actor('alice-tabelle', { user: 'alice' })
		const b = await world.actor('bob-tabelle', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			t.must(await until(async () => (await itemMap(pb)).has(N), { timeout: 8000 }), '[D] Vorbedingung: beide sehen N')

			t.step('(1) alice drückt B, klickt und schreibt „Name“ oben links')
			const empty = await K.w2s(pa, 300, 450)
			await pa.mouse.click(empty.x, empty.y)
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('b')
			t.must(await until(async () => (await pa.locator('[data-knorke-tool=more][data-knorke-tool-picked=table]').first().getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (1) B wählt das Werkzeug Tabelle (aria-pressed; Job 229: „Mehr Werkzeuge“ zeigt sie)')
			const before = await idSet(pa)
			const at = await K.w2s(pa, P.x, P.y)
			await pa.mouse.click(at.x, at.y)
			const clicked = Date.now()
			const T = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before.has(k) && it.t === 'table') return k
				return null
			}, { timeout: 5000 })
			t.must(T, '[S] (1) ein Klick legt eine Tabelle an')
			const ed = await until(() => cellEditor(pa), { timeout: 3000 })
			const t0 = await tableOf(pa, T)
			const firstCell = ordered(t0.data.cols)[0] + '.' + ordered(t0.data.rows)[0]
			t.check(ed?.cell === firstCell, '[S] (1) der Editor der Zelle oben links ist offen', { ed, firstCell })
			t.check(ordered(t0.data.cols).length === 3 && ordered(t0.data.rows).length === 3 && t0.w === 480 && t0.h === 108, '[C] (1) 3 × 3, 480 × 108', { w: t0.w, h: t0.h })
			await pa.keyboard.type('Name')
			const seen = await until(async () => {
				const st = await sceneTable(pb, T)
				return st && st.cols.length === 3 && st.rows.length === 3 ? Date.now() : null
			}, { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - clicked <= SEEN_MS, `[C] (1) bob sieht T in scene().tables mit 3 × 3 spätestens ${SEEN_MS} ms nach alices Klick`, seen === null ? null : seen - clicked)
			await pa.keyboard.press('Escape')
			await settle([pa, pb])
			t.check(textAt(await tableOf(pa, T), 0, 0) === 'Name' && textAt(await tableOf(pb, T), 0, 0) === 'Name', '[C] (1) „Name“ steht oben links bei beiden')
			t.check((await K.scene(pa)).tool === 'select', '[S] (1) das Werkzeug springt auf Auswahl', (await K.scene(pa)).tool)

			t.step('(2) beide schreiben zugleich in zwei Zellen')
			const pA = await cellPoint(pa, T, 1, 1)
			const pB = await cellPoint(pb, T, 2, 2)
			await Promise.all([pa.mouse.dblclick(pA.x, pA.y), pb.mouse.dblclick(pB.x, pB.y)])
			t.must(await until(async () => (await cellEditor(pa)) !== null && (await cellEditor(pb)) !== null, { timeout: 3000 }), '[S] (2) beide Zelleditoren sind offen', { a: await cellEditor(pa), b: await cellEditor(pb) })
			await Promise.all([pa.keyboard.type('Alpha', { delay: 40 }), pb.keyboard.type('Beta', { delay: 40 })])
			await Promise.all([pa.keyboard.press('Escape'), pb.keyboard.press('Escape')])
			await settle([pa, pb])
			for (const [who, page] of [['alice', pa], ['bob', pb]]) {
				const it = await tableOf(page, T)
				t.check(textAt(it, 1, 1) === 'Alpha' && textAt(it, 2, 2) === 'Beta', `[C] (2) bei ${who} stehen beide Texte`, it?.data?.cells)
			}
			const srv = (await serverMap('alice', board)).get(T)
			t.check(textAt(srv, 1, 1) === 'Alpha' && textAt(srv, 2, 2) === 'Beta', '[B] (2) beim Server stehen beide Texte', srv?.data?.cells)

			t.step('(3) bobs Doppelklick auf alices offene Zelle zeigt „Take over“')
			const p12 = await cellPoint(pa, T, 0, 1)
			await pa.mouse.dblclick(p12.x, p12.y)
			const held = await until(() => cellEditor(pa), { timeout: 3000 })
			t.must(held !== null, '[S] (3) alices Editor ist offen', held)
			const chipSel = `[data-knorke-editing="${T}"][data-knorke-cell="${held.cell}"]`
			t.check(await until(async () => (await pb.locator(chipSel).count()) > 0, { timeout: 6000 }), '[S] (3) bob sieht „… is editing…“ an dieser Zelle')
			const q12 = await cellPoint(pb, T, 0, 1)
			await pb.mouse.dblclick(q12.x, q12.y)
			t.check(await until(async () => (await pb.locator(`${chipSel} [data-knorke-action=take-over]`).count()) > 0, { timeout: 2000 }), '[S] (3) der Chip bietet „Take over“')
			t.check(!(await anyEditor(pb)), '[S] (3) bei bob öffnet sich kein Editor')
			await pa.keyboard.press('Escape')
			await settle([pa, pb])

			t.step('(4) „+“ rechts und unten, „Delete column“, Strg+Z')
			const sel = await cellPoint(pa, T, 0, 2)
			await pa.mouse.click(sel.x, sel.y)
			t.must(await until(async () => ((await K.handles(pa)) || []).some((h) => h.name === 'table-col'), { timeout: 3000 }), '[S] (4) die gewählte Tabelle zeigt ihr „+“ rechts und unten', await K.handles(pa))
			const hs = await K.handles(pa)
			t.check(!hs.some((h) => h.name.startsWith('plus-')), '[S] (4) keine Verbinder-„+“ an der Tabelle', hs.map((h) => h.name))
			const col = hs.find((h) => h.name === 'table-col')
			await pa.mouse.click(col.x, col.y)
			t.check(await until(async () => ordered((await tableOf(pb, T))?.data?.cols).length === 4, { timeout: 5000 }), '[C] (4) „+“ rechts: 4 Spalten, auch bei bob')
			const row = ((await K.handles(pa)) || []).find((h) => h.name === 'table-row')
			t.must(row, '[S] (4) „+“ unten', await K.handles(pa))
			await pa.mouse.click(row.x, row.y)
			t.check(await until(async () => ordered((await tableOf(pb, T))?.data?.rows).length === 4, { timeout: 5000 }), '[C] (4) „+“ unten: 4 Zeilen, auch bei bob')
			t.check((await tableOf(pa, T)).w === 640, '[C] (4) w misst neu: 640', (await tableOf(pa, T)).w)
			await settle([pa, pb])
			const c2 = await cellPoint(pa, T, 1, 0)
			t.must(await menuAt(pa, c2), '[S] (4) das Kontextmenü öffnet sich auf der Zelle')
			const names = await pa.locator(`${MENU} button[data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			const tableEntries = ['row-above', 'row-below', 'col-left', 'col-right', 'row-delete', 'col-delete', 'table-csv']
			t.check(JSON.stringify(names.filter((x) => tableEntries.includes(x))) === JSON.stringify(tableEntries), '[S] (4) das Menü hat die Tabelleneinträge in Ordnung', names)
			await menuItem(pa, 'col-delete')
			t.check(await until(async () => ordered((await tableOf(pb, T))?.data?.cols).length === 3, { timeout: 5000 }), '[C] (4) „Delete column“: 3 Spalten, auch bei bob')
			t.check(textAt(await tableOf(pa, T), 1, 1) !== 'Alpha', '[C] (4) „Alpha“ ging mit der Spalte')
			await settle([pa, pb])
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => ordered((await tableOf(pb, T))?.data?.cols).length === 4, { timeout: 5000 }), '[C] (4) Strg+Z: wieder 4 Spalten, auch bei bob')
			await settle([pa, pb])
			t.check(textAt(await tableOf(pa, T), 1, 1) === 'Alpha' && textAt(await tableOf(pb, T), 1, 1) === 'Alpha', '[C] (4) mit „Alpha“ in ihrer Zelle')
			t.check(textAt((await serverMap('alice', board)).get(T), 1, 1) === 'Alpha', '[B] (4) beim Server auch')

			t.step('(5) bob zieht eine Spaltengrenze und schaltet die Kopfzeile ab')
			const bsel = await cellPoint(pb, T, 0, 2)
			await pb.mouse.click(bsel.x, bsel.y)
			t.must(await until(async () => ((await K.selection(pb)) || []).includes(T), { timeout: 3000 }), '[S] (5) bob hat T gewählt')
			const tb = await tableOf(pb, T)
			const stb = await sceneTable(pb, T)
			const from = await K.w2s(pb, tb.x + stb.cols[0], tb.y + 10)
			await dragPath(pb, from, { x: from.x + 60, y: from.y }, { steps: 12 })
			t.check(await until(async () => (await sceneTable(pb, T))?.cols[0] === 220, { timeout: 3000 }), '[S] (5) die gezogene Grenze: Spalte 1 ist 220 breit (scene().tables)', await sceneTable(pb, T))
			t.check(await until(async () => (await tableOf(pa, T))?.data?.cols[ordered(tb.data.cols)[0]]?.w === 220, { timeout: 5000 }), '[C] (5) alice sieht die Breite 220')
			await settle([pa, pb])
			await pb.locator('[data-knorke-section=header]').first().click({ timeout: 3000 })
			await pb.locator('[data-knorke-style="style.header"]').first().click({ timeout: 3000 })
			t.check(await until(async () => (await sceneTable(pb, T))?.header === false, { timeout: 3000 }), '[S] (5) „Header row“ aus: header false (scene().tables)', await sceneTable(pb, T))
			t.check(await until(async () => (await sceneTable(pa, T))?.header === false, { timeout: 5000 }), '[C] (5) auch bei alice')
			await settle([pa, pb])

			t.step('(6) ein Verbinder von N bindet an die Tabelle')
			await pa.mouse.click(empty.x, empty.y)
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('l')
			const beforeC = await idSet(pa)
			const nRect = await K.rect(pa, N)
			const target = await cellPoint(pa, T, 1, 1)
			await dragPath(pa, { x: nRect.x + nRect.w / 2, y: nRect.y + nRect.h / 2 }, target, { steps: 16 })
			const KC = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!beforeC.has(k) && it.t === 'connector') return k
				return null
			}, { timeout: 5000 })
			t.must(KC, '[S] (6) ein Verbinder entsteht')
			await settle([pa, pb])
			const kc = (await itemMap(pb)).get(KC)
			t.check(kc?.data?.start?.item === N && kc?.data?.end?.item === T, '[C] (6) start an N, end an T (auch bei bob)', kc?.data)
			const kcs = (await serverMap('alice', board)).get(KC)
			t.check(kcs?.data?.end?.item === T, '[B] (6) beim Server an T gebunden', kcs?.data)
			await pa.keyboard.press('v')
			// the new connector is selected: its context bar may lie over the table; Esc clears the selection
			await pa.keyboard.press('Escape')
			t.must(await until(async () => ((await K.selection(pa)) || []).length === 0, { timeout: 2000 }), '[D] (6) Vorbedingung: nichts gewählt')

			t.step('(7) „Export as CSV“')
			const e7 = await cellPoint(pa, T, 0, 0)
			t.must(await menuAt(pa, e7), '[S] (7) das Kontextmenü öffnet sich auf der Zelle')
			const [download] = await Promise.all([pa.waitForEvent('download', { timeout: 5000 }), menuItem(pa, 'table-csv')])
			t.check(download.suggestedFilename() === 'E63 Tabellen - Table.csv', '[C] (7) Dateiname „<Board> - Table.csv“', download.suggestedFilename())
			const chunks = []
			for await (const c of await download.createReadStream()) chunks.push(c)
			const csv = Buffer.concat(chunks).toString('utf8')
			const it7 = await tableOf(pa, T)
			const first = '﻿' + ordered(it7.data.cols).map((_, i) => textAt(it7, i, 0)).join(',') + '\r\n'
			t.check(csv.startsWith(first), '[C] (7) die erste Zeile ist die Kopfzeile (BOM, Komma, CRLF)', JSON.stringify(csv.slice(0, 40)))
			t.check(csv.split('\r\n').length - 1 === ordered(it7.data.rows).length, '[C] (7) eine Zeile je Tabellenzeile', csv.split('\r\n').length - 1)
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}

/** E64: Excel's clipboard for a range of 5 columns × 5 rows (job 185: wider than the table); one cell with a line break is quoted. */
const EXCEL_ROWS = [
	['Name', 'Role', 'Note', 'Team', 'Room'],
	['Ann', 'Lead', 'two\nlines', 'A', '101'],
	['Bob', 'Dev', 'ok', 'B', '102'],
	['Cid', 'QA', 'fine', 'A', '103'],
	['Dan', 'UX', 'end', 'C', '104'],
]
/** E64 (6): a text without a line break that wraps onto several lines in a column of 160. */
const WRAPPED = 'This text is long enough to wrap in a cell'
const EXCEL_TEXT = EXCEL_ROWS.map((r) => r.map((c) => (c.includes('\n') ? '"' + c + '"' : c)).join('\t') + '\r\n').join('')
const EXCEL_HTML = '<html><body><table>' + EXCEL_ROWS.map((r) => '<tr>' + r.map((c) => '<td>' + c.replace('\n', '<br>') + '</td>').join('') + '</tr>').join('') + '</table></body></html>'

/** Sizes of T in scene().tables: [columns, rows], or null. */
async function sizeOf(page, id) {
	const st = await sceneTable(page, id)
	return st ? [st.cols.length, st.rows.length] : null
}

const CELL_EDITOR = 'textarea[data-knorke-editor][data-knorke-editor-kind="cell"]'

/** (job 185) The open cell editor's cell and caret: {cell, pos, len} or null. */
const caretOf = (page) => page.evaluate((sel) => {
	const ta = document.querySelector(sel)
	return ta ? { cell: ta.getAttribute('data-knorke-cell'), pos: ta.selectionStart, len: ta.value.length } : null
}, CELL_EDITOR).catch(() => null)

/** (job 185) Puts the caret of the open cell editor at pos (−1: the end); then like caretOf. */
const caretTo = (page, pos) => page.evaluate(([sel, p]) => {
	const ta = document.querySelector(sel)
	if (!ta) return null
	const at = p < 0 ? ta.value.length : p
	ta.setSelectionRange(at, at)
	return { cell: ta.getAttribute('data-knorke-cell'), pos: ta.selectionStart, len: ta.value.length }
}, [CELL_EDITOR, pos]).catch(() => null)

/** (job 185) The lines the open cell editor shows: the height of its text / its line height. */
const linesOf = (page) => page.evaluate((sel) => {
	const ta = document.querySelector(sel)
	if (!ta) return 0
	const cs = getComputedStyle(ta)
	return Math.round((ta.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight))
}, CELL_EDITOR).catch(() => 0)

export const E64 = {
	id: 'E64',
	title: 'Tabellen-Tasten und Einfügen (Jobs 174, 185): alice fügt in die offene Zelle ein Excel-Raster 5 × 5 ein (eine zitierte Zelle mit Zeilenumbruch), bob sieht 5 × 5 mit den Texten ≤ 3 s; Strg+Z gibt bei beiden 3 × 3; „x“ und Tab in der letzten Zelle hängen eine Zeile an und öffnen ihre linke Zelle; ↑ aus der Mitte einer Zeile und → wechseln die Zelle; in umbrochenem Text gehen ↑/↓ erst im Text, aus der ersten/letzten Zeile in die Nachbarzelle; Esc schließt',
	async run(t, world) {
		const board = await world.board('E64 Tabellen-Tasten')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const a = await world.actor('alice-tasten', { user: 'alice' })
		const b = await world.actor('bob-tasten', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}

			t.step('(1) alice drückt B, klickt und fügt in die offene Zelle ein Excel-Raster ein')
			const empty = await K.w2s(pa, 300, 450)
			await pa.mouse.click(empty.x, empty.y)
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('b')
			t.must(await until(async () => (await pa.locator('[data-knorke-tool=more][data-knorke-tool-picked=table]').first().getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (1) B wählt das Werkzeug Tabelle (aria-pressed; Job 229: „Mehr Werkzeuge“ zeigt sie)')
			const before = await idSet(pa)
			const at = await K.w2s(pa, P.x, P.y)
			await pa.mouse.click(at.x, at.y)
			const T = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before.has(k) && it.t === 'table') return k
				return null
			}, { timeout: 5000 })
			t.must(T, '[S] (1) ein Klick legt eine Tabelle an')
			const ed = await until(() => cellEditor(pa), { timeout: 3000 })
			const t0 = await tableOf(pa, T)
			t.must(ed?.cell === ordered(t0.data.cols)[0] + '.' + ordered(t0.data.rows)[0], '[S] (1) der Editor der Zelle oben links ist offen', ed)
			t.must(await until(async () => JSON.stringify(await sizeOf(pb, T)) === '[3,3]', { timeout: 8000 }), '[D] (1) Vorbedingung: bob sieht T mit 3 × 3', await sizeOf(pb, T))
			const pasted = await pa.evaluate(([text, html]) => {
				const ta = document.querySelector('textarea[data-knorke-editor][data-knorke-editor-kind="cell"]')
				if (!ta) return { error: 'kein Zelleditor' }
				const dt = new DataTransfer()
				dt.setData('text/plain', text)
				dt.setData('text/html', html)
				const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
				ta.dispatchEvent(e)
				return { prevented: e.defaultPrevented }
			}, [EXCEL_TEXT, EXCEL_HTML])
			const pastedAt = Date.now()
			t.check(pasted?.prevented === true, '[S] (1) Knorke nimmt das paste im Zelleditor (preventDefault)', pasted)
			t.check(await until(async () => !(await anyEditor(pa)), { timeout: 2000 }), '[S] (1) danach ist kein Editor offen')
			t.check(await until(async () => JSON.stringify(await sizeOf(pa, T)) === '[5,5]', { timeout: 3000 }), '[C] (1) bei alice 5 × 5 (die Spalten kommen dazu)', await sizeOf(pa, T))

			t.step('(2) bob sieht 5 × 5 mit den Texten binnen 3 s')
			const texts = (it) => EXCEL_ROWS.map((r, ri) => r.map((_, ci) => textAt(it, ci, ri)))
			const seen = await until(async () => {
				const sz = await sizeOf(pb, T)
				const it = await tableOf(pb, T)
				return JSON.stringify(sz) === '[5,5]' && JSON.stringify(texts(it)) === JSON.stringify(EXCEL_ROWS) ? Date.now() : null
			}, { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - pastedAt <= SEEN_MS, `[C] (2) bob sieht 5 × 5 in scene().tables und die Texte in items() spätestens ${SEEN_MS} ms nach dem Einfügen`, seen === null ? { size: await sizeOf(pb, T), texts: texts(await tableOf(pb, T)) } : seen - pastedAt)
			t.check(textAt(await tableOf(pb, T), 2, 1) === 'two\nlines', '[C] (2) die zitierte Zelle trägt ihren Zeilenumbruch', textAt(await tableOf(pb, T), 2, 1))
			await settle([pa, pb])
			t.check(JSON.stringify(texts((await serverMap('alice', board)).get(T))) === JSON.stringify(EXCEL_ROWS), '[B] (2) beim Server stehen die Texte')

			t.step('(3) Strg+Z bei alice')
			t.check(await canvasFocused(pa), '[S] (3) nach dem Einfügen liegt der Fokus auf der Fläche')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			for (const [who, page] of [['alice', pa], ['bob', pb]]) {
				t.check(await until(async () => JSON.stringify(await sizeOf(page, T)) === '[3,3]', { timeout: 5000 }), `[C] (3) Strg+Z: bei ${who} wieder 3 × 3`, await sizeOf(page, T))
			}
			await settle([pa, pb])
			t.check(textAt(await tableOf(pb, T), 0, 0) === '', '[C] (3) ohne die Texte', (await tableOf(pb, T))?.data?.cells)

			t.step('(4) Doppelklick auf die letzte Zelle, „x“ und Tab')
			const last = await cellPoint(pa, T, 2, 2)
			await pa.mouse.dblclick(last.x, last.y)
			const t3 = await tableOf(pa, T)
			t.must(await until(async () => (await cellEditor(pa))?.cell === ordered(t3.data.cols)[2] + '.' + ordered(t3.data.rows)[2], { timeout: 3000 }), '[S] (4) der Editor der letzten Zelle ist offen', await cellEditor(pa))
			await pa.keyboard.type('x')
			await pa.keyboard.press('Tab')
			for (const [who, page] of [['alice', pa], ['bob', pb]]) {
				t.check(await until(async () => JSON.stringify(await sizeOf(page, T)) === '[3,4]', { timeout: 5000 }), `[C] (4) bei ${who} 4 Zeilen`, await sizeOf(page, T))
			}
			const t4 = await tableOf(pa, T)
			const left = ordered(t4.data.cols)[0] + '.' + ordered(t4.data.rows)[3]
			t.check(await until(async () => (await cellEditor(pa))?.cell === left, { timeout: 3000 }), '[S] (4) der Editor steht links in der neuen Zeile', { ed: await cellEditor(pa), left })
			await settle([pa, pb])
			t.check(textAt(await tableOf(pb, T), 2, 2) === 'x', '[C] (4) „x“ steht in der letzten Zelle der dritten Zeile, auch bei bob')

			t.step('(5) „abc“, Cursor in der Mitte: ↑ wechselt sofort die Zelle, → am Ende auch')
			const cellAt = (c, r) => ordered(t4.data.cols)[c] + '.' + ordered(t4.data.rows)[r]
			await pa.keyboard.type('abc')
			t.must((await caretTo(pa, 1))?.pos === 1, '[D] (5) Vorbedingung: der Cursor steht bei 1 in „abc“', await caretOf(pa))
			await pa.keyboard.press('ArrowUp')
			t.check(await until(async () => (await cellEditor(pa))?.cell === cellAt(0, 2), { timeout: 2000 }), '[S] (5) ↑ aus der Mitte einer einzeiligen Zelle: die Zelle darüber', await cellEditor(pa))
			await pa.keyboard.press('ArrowRight')
			t.check(await until(async () => (await cellEditor(pa))?.cell === cellAt(1, 2), { timeout: 2000 }), '[S] (5) → am Textende: die Zelle rechts', await cellEditor(pa))

			t.step('(6) umbrochener Text: ↑/↓ erst im Text, aus der ersten/letzten Zeile in die Nachbarzelle; Esc schließt')
			await pa.keyboard.type(WRAPPED)
			t.must(await until(async () => (await linesOf(pa)) >= 2, { timeout: 2000 }), '[D] (6) Vorbedingung: der Text bricht in der Spalte auf mindestens zwei Zeilen um', await linesOf(pa))
			const end = await caretTo(pa, -1)
			await pa.keyboard.press('ArrowUp')
			await sleep(300)
			const afterUp = await caretOf(pa)
			t.check(afterUp?.cell === cellAt(1, 2) && afterUp.pos < end.pos, '[S] (6) Cursor am Ende, ↑: dieselbe Zelle, der Cursor geht nach oben', { end, afterUp })
			await caretTo(pa, 2)
			await pa.keyboard.press('ArrowDown')
			await sleep(300)
			const afterDown = await caretOf(pa)
			t.check(afterDown?.cell === cellAt(1, 2), '[S] (6) Cursor bei 2, ↓: dieselbe Zelle', afterDown)
			await caretTo(pa, 2)
			await pa.keyboard.press('ArrowUp')
			t.check(await until(async () => (await cellEditor(pa))?.cell === cellAt(1, 1), { timeout: 2000 }), '[S] (6) Cursor bei 2 (erste Zeile), ↑: die Zelle darüber', await cellEditor(pa))
			await pa.keyboard.press('ArrowDown')
			t.must(await until(async () => (await cellEditor(pa))?.value === WRAPPED, { timeout: 2000 }), '[S] (6) ↓ aus der leeren Zelle: zurück in die Zelle mit dem Text', await cellEditor(pa))
			await caretTo(pa, -1)
			await pa.keyboard.press('ArrowDown')
			t.check(await until(async () => (await cellEditor(pa))?.cell === cellAt(1, 3), { timeout: 2000 }), '[S] (6) Cursor am Ende (letzte Zeile), ↓: die Zelle darunter', await cellEditor(pa))
			await pa.keyboard.press('Escape')
			t.check(await until(async () => !(await anyEditor(pa)), { timeout: 2000 }), '[S] (6) Esc: kein textarea[data-knorke-editor] mehr')
			t.check(((await K.selection(pa)) || []).includes(T), '[S] (6) die Tabelle bleibt gewählt', await K.selection(pa))
			await settle([pa, pb])
			t.check(textAt(await tableOf(pb, T), 1, 2) === WRAPPED, '[C] (6) der umbrochene Text steht ganz in seiner Zelle, auch bei bob', textAt(await tableOf(pb, T), 1, 2))
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
