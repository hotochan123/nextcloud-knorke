/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The board as an outline (factory job 274).
 *
 * E100 alice (owner, Chromium 1440 × 900, keyboard and mouse) on a board of
 * her own: frame F "Ideen" at (0, 0) with notes A "Kaffee" and B "Kuchen",
 * a loose note C "Tee" at (2000, 1500). Steps:
 *   (1) "Board | Outline" [data-knorke-view-switch] stands in the top bar;
 *   (2) "Outline" shows [data-knorke-outline]: the heading "Ideen" with two
 *       points (A, B) and "Not in a frame" with one (C); the tool bar is
 *       hidden;
 *   (3) a change from elsewhere (the server: A's text becomes "Kaffee
 *       schwarz") shows in the list within 2 s;
 *   (4) "Download as Markdown" downloads a .md file with "## Ideen" and
 *       "- Kaffee schwarz";
 *   (5) a click on C's point: the board shows again, the search frame
 *       (__knorke.searchHit()) lies on C, the camera moved, the selection
 *       stays empty and the items are unchanged (no op);
 *   (6) "Outline" again, Esc: the board shows, the canvas has the focus.
 * Own board, no instance setting: before E09, after E99.
 * Flake gate: --only E100 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (camera, frame, selection), [U] the shell, [D] a harness precondition,
 * [B] a server answer. Waiting polls from Node with until() (CSP, trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, openBoard, until, canvasFocused } from '../lib/harness.mjs'

const VIEW = '[data-knorke-outline]'

/** @return {Promise<string|null>} the item the search frame lies on */
const hitOf = (page) => page.evaluate(() => window.__knorke.searchHit?.() ?? null).catch(() => undefined)
/** @return {Promise<string[]>} the ids of the outline's points in order */
const pointsOf = (page, frame) => page.evaluate((f) => {
	const sec = f === null
		? document.querySelector('[data-knorke-outline-loose]')?.closest('section')
		: document.querySelector(`[data-knorke-outline-frame="${f}"]`)?.closest('section')
	return sec ? [...sec.querySelectorAll('[data-knorke-outline-item]')].map((b) => b.getAttribute('data-knorke-outline-item')) : []
}, frame).catch(() => [])
/** @return {Promise<string>} the text of one point */
const textOf = (page, id) => page.locator(`[data-knorke-outline-item="${id}"]`).first().textContent({ timeout: 1000 }).then((s) => s.trim()).catch(() => '')

/**
 * Runs `start` and waits for the download it triggers.
 * @return {Promise<{name: string, text: string}|null>} null without a download within 15 s
 */
async function download(page, start) {
	const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), start()])
	if (!dl) return null
	const chunks = []
	for await (const c of await dl.createReadStream()) chunks.push(c)
	return { name: dl.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') }
}

export const E100 = {
	id: 'E100',
	title: 'Board als Gliederung (Job 274): Umschalter „Board | Outline“, Frame-Überschrift mit ihren Notizen, lose Notiz am Ende, Änderung von außen erscheint, Markdown-Download, Klick springt aufs Board ohne Op, Esc schaltet zurück',
	async run(t, world) {
		const board = await world.board('E100 Gliederung')
		const F = ulid()
		const A = ulid()
		const B = ulid()
		const C = ulid()
		const res = await seedOps('alice', board, [
			put.frame(F, { x: 0, y: 0, w: 800, h: 600, data: { title: 'Ideen' } }),
			put.sticky(A, { x: 40, y: 80, parent: F, data: { text: 'Kaffee' } }),
			put.sticky(B, { x: 400, y: 80, parent: F, data: { text: 'Kuchen' } }),
			put.sticky(C, { x: 2000, y: 1500, data: { text: 'Tee' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Frame und drei Notizen gesät', res)
		const a = await world.actor('alice-outline', { user: 'alice' })
		const pa = a.page
		try {
			await openBoard(a, board)

			t.step('(1) der Umschalter steht in der Kopfleiste')
			t.check(await pa.locator('[data-knorke-view-switch]').first().isVisible().catch(() => false), '[U] (1) „Board | Outline“ sichtbar')

			t.step('(2) „Outline“ zeigt die Gliederung')
			await pa.locator('[data-knorke-view=outline]').first().click()
			t.check(await until(() => pa.locator(VIEW).first().isVisible().catch(() => false), { timeout: 5000 }), '[U] (2) die Gliederung ist offen')
			t.check((await pa.locator(`[data-knorke-outline-frame="${F}"]`).first().textContent().catch(() => '')).trim() === 'Ideen', '[U] (2) Überschrift „Ideen“')
			t.check(JSON.stringify(await pointsOf(pa, F)) === JSON.stringify([A, B]), '[U] (2) zwei Punkte unter „Ideen“', await pointsOf(pa, F))
			t.check(JSON.stringify(await pointsOf(pa, null)) === JSON.stringify([C]), '[U] (2) ein Punkt unter „Not in a frame“', await pointsOf(pa, null))
			t.check(!(await pa.locator('.knorke-toolbar').first().isVisible().catch(() => false)), '[U] (2) die Werkzeugleiste ist ausgeblendet')
			const items0 = JSON.stringify(await K.items(pa))

			t.step('(3) eine Änderung von außen erscheint in der Liste')
			const res2 = await seedOps('alice', board, [{ o: 'patch', id: A, p: { 'data.text': 'Kaffee schwarz' } }])
			t.must(res2.every((x) => x === 'ok'), '[B] (3) Text von A geändert', res2)
			t.check(await until(async () => (await textOf(pa, A)) === 'Kaffee schwarz', { timeout: 2500 }), '[U] (3) der neue Text steht in der Liste', await textOf(pa, A))
			const items1 = JSON.stringify(await K.items(pa))

			t.step('(4) „Download as Markdown“')
			const file = await download(pa, () => pa.locator('[data-knorke-action=outline-download]').first().click())
			t.check(file !== null && /\.md$/.test(file.name), '[U] (4) eine .md-Datei', file && file.name)
			t.check(file !== null && file.text.includes('## Ideen\n\n- Kaffee schwarz\n- Kuchen\n'), '[U] (4) „## Ideen“ mit den Punkten', file && file.text)

			t.step('(5) Klick auf C springt aufs Board')
			const cam0 = await K.camera(pa)
			await pa.locator(`[data-knorke-outline-item="${C}"]`).first().click()
			t.check(await until(async () => (await pa.locator(VIEW).count()) === 0, { timeout: 3000 }), '[U] (5) die Gliederung ist zu')
			t.check(await until(async () => (await hitOf(pa)) === C, { timeout: 3000 }), '[S] (5) Rahmen auf C', await hitOf(pa))
			const cam1 = await K.camera(pa)
			t.check(Math.abs(cam1.x - cam0.x) > 50 || Math.abs(cam1.y - cam0.y) > 50 || Math.abs((cam1.zoom ?? cam1.scale ?? 1) - (cam0.zoom ?? cam0.scale ?? 1)) > 0.01, '[S] (5) die Kamera ist zu C gesprungen', { cam0, cam1 })
			t.check(JSON.stringify(await K.selection(pa)) === '[]', '[S] (5) die Auswahl bleibt leer', await K.selection(pa))
			t.check(JSON.stringify(await K.items(pa)) === items1 && items1 !== items0, '[S] (5) die Elemente sind unverändert (kein Op)')

			t.step('(6) Outline, dann Esc')
			await pa.locator('[data-knorke-view=outline]').first().click()
			t.check(await until(() => pa.locator(VIEW).first().isVisible().catch(() => false), { timeout: 5000 }), '[U] (6) die Gliederung ist wieder offen')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await pa.locator(VIEW).count()) === 0, { timeout: 3000 }), '[U] (6) Esc schließt die Gliederung')
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[U] (6) die Leinwand hat den Fokus')
			t.check(await pa.locator(CANVAS).first().isVisible().catch(() => false), '[U] (6) die Leinwand ist sichtbar')
		} finally {
			await world.drop(a)
		}
	},
}
