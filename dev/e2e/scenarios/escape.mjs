/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Esc clears the selection for a signed-in user (factory job 018, SPEC-M1
 * §6.10).
 *
 * E40 Nextcloud's header menus (NcHeaderMenu from @nextcloud/vue, e.g. the
 *   notifications) listen on the window and call preventDefault on every Esc
 *   outside text fields (useHotKey('Escape', …, { prevent: true })); they
 *   are registered before the scene, whose own window listener used to skip
 *   every cancelled key. So for alice Esc with the canvas focus cleared
 *   nothing; holding Esc did, by accident, through the auto-repeat (the
 *   header menus skip repeated keys). Now the scene lets an Esc on the canvas
 *   host pass (InputController). Steps, alice on her own board with notes A
 *   and B:
 *   (1) pressed once: a click selects A and focuses the canvas, Esc → the
 *       selection is empty and the context bar gone; precondition [D]: at the
 *       end of the window phase that Esc was defaultPrevented (a listener
 *       before the scene cancelled it, as the header menus do), else E40
 *       would not test what it guards;
 *   (2) held: A and Shift+click B, Esc down and kept down (keyboard.down
 *       again = auto-repeat, repeat: true), released → already the first
 *       keydown (not a repeat) empties the selection, and it stays empty with
 *       the focus on the canvas.
 *   Own board, no instance setting: before E09, directly after E39.
 *   Red before job 018 round 2 at (1) and at the first keydown of (2).
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene keys
 * and selection, [C] shell (context bar), [B] stored server state, [D] a
 * harness or instance precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, openBoard, until, sleep, centerOf, selectItem, canvasFocused, sameList } from '../lib/harness.mjs'

/** Auto-repeats sent while Esc is held in step (2). */
export const E40_REPEATS = 4

/**
 * Records every Esc keydown at the END of the window phase (a listener added
 * after the scene's): repeat, defaultPrevented, target the canvas host.
 *
 * @param {import('playwright').Page} page board page
 */
async function recordEsc(page) {
	await page.evaluate((sel) => {
		window.__kdEsc = []
		if (window.__kdEscOn) return
		window.__kdEscOn = true
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') window.__kdEsc.push({ repeat: e.repeat, prevented: e.defaultPrevented, canvas: !!e.target?.matches?.(sel) })
		})
	}, CANVAS)
}

const escLog = (page) => page.evaluate(() => window.__kdEsc ?? []).catch(() => [])
const selection = async (page) => (await K.selection(page)) || []
const barVisible = (page) => page.locator('.knorke-contextbar').first().isVisible().catch(() => false)

export const E40 = {
	id: 'E40',
	title: 'Esc leert die Auswahl als angemeldeter Nutzer, auch nach dem preventDefault eines Kopfzeilen-Menüs von Nextcloud (NcHeaderMenu): einmal gedrückt, einmal gehalten',
	async run(t, world) {
		const board = await world.board('E40 Esc')
		const [A, B] = [ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 100, y: 100, data: { text: 'A' } }),
			put.sticky(B, { x: 400, y: 100, data: { text: 'B' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Notizen A und B angelegt', res)
		const a = await world.actor('alice-esc', { user: 'alice' })
		const p = a.page
		await openBoard(a, board)
		await p.locator(CANVAS).first().focus()
		await p.keyboard.press('Shift+Digit1')
		await K.waitIdle(p)
		const menus = await p.evaluate(() => document.querySelectorAll('.header-menu').length).catch(() => 0)
		t.note(`Kopfzeilen-Menüs von Nextcloud (.header-menu): ${menus}`)
		await recordEsc(p)

		t.step('(1) einmal gedrückt: A per Klick auswählen (Leinwand-Fokus), Esc')
		await selectItem(p, A)
		t.must(sameList(await selection(p), [A]) && await canvasFocused(p), '[S] (1) Klick wählt A und fokussiert die Leinwand', { auswahl: await selection(p), leinwand: await canvasFocused(p) })
		t.must(await until(() => barVisible(p), { timeout: 3000 }), '[C] (1) die Kontextleiste ist sichtbar')
		await p.keyboard.press('Escape')
		const cleared = await until(async () => (await selection(p)).length === 0, { timeout: 2000 })
		const log1 = await escLog(p)
		t.check(log1.length === 1 && log1[0].canvas && log1[0].prevented === true,
			'[D] (1) Vorbedingung: das Esc auf der Leinwand war am Ende der window-Phase defaultPrevented (ein Listener vor der Szene, wie die Kopfzeilen-Menüs von Nextcloud)', { esc: log1, kopfzeilenMenüs: menus })
		t.check(cleared, '[S] (1) ein Esc mit Leinwand-Fokus leert die Auswahl', { auswahl: await selection(p), esc: log1 })
		t.check(await until(async () => !(await barVisible(p)), { timeout: 2000 }), '[C] (1) danach ist die Kontextleiste weg')

		t.step(`(2) gehalten: A und Umschalt+Klick B, Esc drücken und halten (${E40_REPEATS} Wiederholungen), loslassen`)
		await selectItem(p, A)
		const cB = await centerOf(p, B)
		await p.keyboard.down('Shift')
		await p.mouse.click(cB.x, cB.y)
		await p.keyboard.up('Shift')
		const sel2 = await selection(p)
		t.must(sel2.length === 2 && sel2.includes(A) && sel2.includes(B) && await canvasFocused(p), '[S] (2) Auswahl [A, B], Leinwand-Fokus', { auswahl: sel2, leinwand: await canvasFocused(p) })
		await recordEsc(p)
		await p.keyboard.down('Escape')
		const first = await until(async () => (await selection(p)).length === 0, { timeout: 1500 })
		const atFirst = await escLog(p)
		for (let i = 0; i < E40_REPEATS; i++) {
			await sleep(40)
			await p.keyboard.down('Escape')
		}
		await sleep(100)
		await p.keyboard.up('Escape')
		const log2 = await escLog(p)
		t.check(log2.length === 1 + E40_REPEATS && log2[0].repeat === false && log2.slice(1).every((x) => x.repeat === true),
			`[D] (2) gehalten: ein keydown, dann ${E40_REPEATS} Wiederholungen (repeat: true)`, log2)
		t.check(first && atFirst.length === 1, '[S] (2) schon der erste keydown (keine Wiederholung) leert die Auswahl', { auswahl: await selection(p), esc: atFirst })
		t.check((await selection(p)).length === 0 && await canvasFocused(p), '[S] (2) nach dem Loslassen bleibt die Auswahl leer, der Fokus auf der Leinwand', { auswahl: await selection(p), leinwand: await canvasFocused(p) })
		t.check(!(await barVisible(p)), '[C] (2) die Kontextleiste ist weg')
		await world.drop(a)
	},
}
