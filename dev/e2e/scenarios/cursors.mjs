/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Hide other people's cursors (factory job 147).
 *
 * E53 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own with note N at
 * (0, 0). Bob's mouse keeps moving over empty canvas (world 400, 0), so his
 * presence carries a cursor all along. Steps:
 *   (1) alice sees bob's [data-knorke-cursor];
 *   (2) bob opens the editor of N and types: alice sees the chip
 *       [data-knorke-editing=N];
 *   (3) alice presses C with the canvas focus: bob's cursor is gone (and
 *       stays gone) while presence() still has it, the toast
 *       [data-knorke-toast=cursors] says "… hidden – C shows them again",
 *       the chip stays, localStorage knorke.cursors = '0';
 *   (4) bob ends editing; alice reloads: bob's cursor stays hidden while
 *       his presence arrives, no toast on opening;
 *   (5) alice right-clicks the empty canvas: [data-knorke-menu-item=cursors]
 *       is a menuitemcheckbox with aria-checked "false"; a click on it shows
 *       bob's cursor again, the toast says "… shown", the key is gone;
 *   (6) alice presses C again and follows bob through the presence bar
 *       ([data-knorke-participant]): his cursor is visible although hidden.
 * Own board, no instance setting: before E09, directly after E52@360x780.
 * Flake gate: --only E53 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (editor), [C] shell and session (cursors filter, toast, menu, storage,
 * following), [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, api, put, ulid, seedOps, openBoard, waitReady, until, sleep, centerOf } from '../lib/harness.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Where bob's mouse moves (world, empty canvas). */
const BOB_SPOT = Object.freeze({ x: 400, y: 0 })
/** An empty spot for alice's right click (world). */
const EMPTY = Object.freeze({ x: -300, y: 300 })
const TEXT = Object.freeze({
	hidden: 'Other people\'s cursors hidden – C shows them again',
	shown: 'Other people\'s cursors shown',
})
const TOAST = '[data-knorke-toast=cursors]'
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

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/** The visible cursor elements of a pid on a page. */
const cursorsOf = (page, pid) => page.evaluate((p) => [...document.querySelectorAll('[data-knorke-cursor]')]
	.filter((el) => (el.getAttribute('data-knorke-cursor') || '').startsWith(p + ':'))
	.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' }).length, pid).catch(() => -1)

/** The sampled presence of a pid has a cursor (window.__knorke.presence(), unfiltered). */
const presenceCursor = async (page, pid) => ((await K.presence(page).catch(() => null)) || []).some((x) => x.pid === pid && Array.isArray(x.cursor))

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })

/** Text of the first match, whitespace folded ('' when missing). */
const textOf = (page, sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '')

/** No visible cursor of pid during `ms` (polled every 100 ms). */
async function staysHidden(page, pid, ms) {
	const t0 = Date.now()
	while (Date.now() - t0 < ms) {
		if ((await cursorsOf(page, pid)) !== 0) return false
		await sleep(100)
	}
	return true
}

export const E53 = {
	id: 'E53',
	title: 'Cursor der anderen ausblenden (Job 147): alice sieht bobs Cursor; C blendet ihn aus (Meldung cursors, bobs „editing“-Chip bleibt); nach dem Neuladen bleibt er weg, im Board-Menü ist „Show other people\'s cursors“ nicht angehakt, ein Klick zeigt ihn wieder; ausgeblendet und bob gefolgt ist sein Cursor sichtbar',
	async run(t, world) {
		const board = await world.board('E53 Cursor ausblenden')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N gesät', res)
		const a = await world.actor('alice-cursor', { user: 'alice' })
		const b = await world.actor('bob-cursor', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		let wiggling = false
		let wiggle = null
		let spot = null
		// bob's mouse moves over empty canvas, so his presence keeps a cursor
		const startWiggle = () => {
			wiggling = true
			wiggle = (async () => {
				for (let i = 0; wiggling; i++) {
					await pb.mouse.move(spot.x + (i % 2 ? 12 : -12), spot.y + (i % 3) * 6).catch(() => {})
					await sleep(250)
				}
			})()
		}
		const stopWiggle = async () => {
			wiggling = false
			await wiggle
		}
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}
			const bobPid = (await K.state(pb)).pid
			t.must(typeof bobPid === 'string' && bobPid !== '', '[D] Vorbedingung: bobs pid', await K.state(pb))
			spot = await K.w2s(pb, BOB_SPOT.x, BOB_SPOT.y)
			t.must(await canvasAt(pb, spot.x, spot.y), '[D] Vorbedingung: bobs Mausstelle liegt frei auf der Leinwand', spot)
			startWiggle()

			t.step('(1) alice sieht bobs Cursor')
			t.must(await until(async () => (await cursorsOf(pa, bobPid)) > 0, { timeout: 8000 }), '[C] (1) bei alice erscheint bobs [data-knorke-cursor]', await K.presence(pa))

			t.step('(2) bob schreibt in N: alice sieht den Chip')
			await stopWiggle()
			const cn = await centerOf(pb, N)
			await pb.mouse.dblclick(cn.x, cn.y)
			const ed = pb.locator('textarea[data-knorke-editor]')
			t.must(await ed.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[S] (2) bob: der Editor von N ist offen')
			await pb.keyboard.press('End')
			await pb.keyboard.type(' von Bob')
			startWiggle()
			const CHIP = `[data-knorke-editing="${N}"]`
			t.must(await appears(pa, CHIP, 5000), '[C] (2) alice: der Chip [data-knorke-editing=N] ist sichtbar')
			t.must(await until(async () => (await cursorsOf(pa, bobPid)) > 0, { timeout: 5000 }), '[D] (2) Vorbedingung: bobs Cursor ist bei alice sichtbar')

			t.step('(3) alice drückt C')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('c')
			t.check(await until(async () => (await cursorsOf(pa, bobPid)) === 0, { timeout: 2000 }), '[C] (3) bobs Cursor verschwindet bei alice (≤ 2 s)', await cursorsOf(pa, bobPid))
			t.check(await appears(pa, TOAST, 2000), '[C] (3) die Meldung [data-knorke-toast=cursors] erscheint')
			t.check((await textOf(pa, TOAST)) === TEXT.hidden, `[C] (3) ihr Text: „${TEXT.hidden}“`, await textOf(pa, TOAST))
			t.check(await staysHidden(pa, bobPid, 1500), '[C] (3) bobs Cursor bleibt weg, während er die Maus bewegt (1,5 s)')
			t.check(await presenceCursor(pa, bobPid), '[C] (3) presence() hat bobs Cursor weiter (nur die Anzeige blendet ihn aus)', await K.presence(pa))
			t.check(await pa.locator(CHIP).first().isVisible().catch(() => false), '[C] (3) bobs Chip [data-knorke-editing=N] bleibt sichtbar')
			t.check((await pa.evaluate(() => localStorage.getItem('knorke.cursors'))) === '0', '[C] (3) localStorage knorke.cursors = "0"')

			t.step('(4) bob beendet den Editor; alice lädt neu')
			await pb.keyboard.press('Escape')
			await pa.reload({ waitUntil: 'domcontentloaded' })
			await waitReady(pa)
			t.must(await until(() => presenceCursor(pa, bobPid), { timeout: 8000 }), '[D] (4) Vorbedingung: bobs Präsenz mit Cursor ist bei alice angekommen', await K.presence(pa))
			t.check(await staysHidden(pa, bobPid, 2000), '[C] (4) nach dem Neuladen ist bobs Cursor bei alice weiterhin nicht da (2 s)', await cursorsOf(pa, bobPid))
			t.check((await pa.locator(TOAST).count()) === 0, '[C] (4) beim Öffnen keine Meldung cursors')

			// job 230: the board menu no longer lists the cursors switch; the key C shows them again
			t.step('(5) Board-Menü ohne Eintrag cursors; die Taste C zeigt bobs Cursor')
			const pe = await K.w2s(pa, EMPTY.x, EMPTY.y)
			t.must(await canvasAt(pa, pe.x, pe.y), '[D] (5) Vorbedingung: freie Stelle für den Rechtsklick', pe)
			await pa.mouse.move(pe.x, pe.y)
			await pa.mouse.click(pe.x, pe.y, { button: 'right' })
			t.must(await until(() => pa.locator(MENU).first().isVisible().catch(() => false), { timeout: 3000 }), '[C] (5) das Board-Menü ist offen')
			t.check((await pa.locator(`${MENU} [data-knorke-menu-item="cursors"]`).count()) === 0, '[C] (5) das Board-Menü hat keinen Eintrag cursors (Job 230)')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await pa.locator(MENU).count()) === 0, { timeout: 2000 }), '[C] (5) Esc schließt das Menü')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('c')
			t.check(await until(async () => (await cursorsOf(pa, bobPid)) > 0, { timeout: 3000 }), '[C] (5) bobs Cursor ist wieder sichtbar (≤ 3 s)', await cursorsOf(pa, bobPid))
			t.check(await until(async () => (await textOf(pa, TOAST)) === TEXT.shown, { timeout: 2000 }), `[C] (5) die Meldung sagt „${TEXT.shown}“`, await textOf(pa, TOAST))
			t.check((await pa.evaluate(() => localStorage.getItem('knorke.cursors'))) === null, '[C] (5) der Schlüssel knorke.cursors ist entfernt')

			t.step('(6) ausgeblendet folgt alice bob: sein Cursor ist sichtbar')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('c')
			t.must(await until(async () => (await cursorsOf(pa, bobPid)) === 0, { timeout: 2000 }), '[C] (6) Vorbedingung: wieder ausgeblendet')
			const pbtn = pa.locator(`[data-knorke-participant="${bobPid}"]`).first()
			t.must(await pbtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false), '[C] (6) alice: Teilnehmer-Knopf von bob')
			await pbtn.click()
			t.must(await until(async () => (await K.state(pa)).following === bobPid, { timeout: 4000 }), '[C] (6) alice folgt bob (state().following)', await K.state(pa))
			t.check(await until(async () => (await cursorsOf(pa, bobPid)) > 0, { timeout: 4000 }), '[C] (6) bobs Cursor ist bei alice sichtbar, obwohl ausgeblendet', { cursors: await cursorsOf(pa, bobPid), key: await pa.evaluate(() => localStorage.getItem('knorke.cursors')) })
			t.check((await pa.evaluate(() => localStorage.getItem('knorke.cursors'))) === '0', '[C] (6) die Einstellung bleibt „ausgeblendet“')
		} finally {
			await stopWiggle()
			await world.drop(b)
			await world.drop(a)
		}
	},
}
