/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Regressions of two R4 review fixes (SPEC-M0 §15), not in the §8.2 table:
 *
 * E13 (T3, [D] optional in §15): leaving a board inside the app (the Back
 *   button, browser Back = popstate) with unsaved work asks first. Offline,
 *   prepareLeave answers false at once, so the dialog
 *   [data-knorke-dialog=leave] must appear; "Stay" keeps the board and its
 *   session (the URL goes back to the board after a popstate), and once
 *   online the note reaches the server. With nothing pending, Back goes
 *   straight to the list; "Leave" ([data-knorke-action=confirm]) leaves.
 *
 * E14 (T5): reloading or closing the page with the text editor still open
 *   (no Esc, no blur) keeps what was typed: the page commits the editor
 *   (flushEditor) before beforeunload/pagehide decide what is pending.
 *
 * Own boards and own contexts: the shared world of E03–E09 is not touched.
 */
import {
	K, APP, api, centerOf, createSticky, itemMap, openBoard, until, waitReady, bannerVisible, sleep,
} from '../lib/harness.mjs'

const onBoard = (page, id) => new RegExp(`/apps/knorke/b/${id}/?$`).test(new URL(page.url()).pathname)
const onList = (page) => /\/apps\/knorke\/?$/.test(new URL(page.url()).pathname)

/** The item as the server has it (snapshot through the API), or null. */
async function serverItem(board, id) {
	const r = await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)
	return (r.data?.items || []).find((x) => x.id === id) || null
}

/** Waits for the leave dialog; on a miss, tells a missing hook from a missing dialog. */
async function leaveDialog(t, p, label) {
	const dlg = p.locator('[data-knorke-dialog=leave]').first()
	const shown = await dlg.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)
	if (!shown) {
		const withText = await p.getByRole('dialog').filter({ hasText: 'Some changes have not been saved yet' }).count().catch(() => -1)
		t.check(false, `${label}: [data-knorke-dialog=leave] sichtbar`, { dialogsWithText: withText, url: p.url() })
	}
	return shown ? dlg : null
}

async function stay(p) {
	await p.getByRole('button', { name: 'Stay', exact: true }).click()
	await p.locator('[data-knorke-dialog=leave]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
}

export const E13 = {
	id: 'E13',
	title: 'Verlassen-Sperre (T3): offline → Zurück → Dialog, Stay hält das Board; Browser-Zurück ebenso; online kommt die Notiz an; Leave verlässt',
	async run(t, world) {
		const board = await world.board('E2E Verlassen')
		const a = await world.actor('alice-leave', { user: 'alice' })
		const p = a.page
		// a beforeunload prompt must never block the cleanup
		p.on('dialog', (d) => d.accept().catch(() => {}))
		const back = () => p.locator('[data-knorke-action=back]').first().click()
		try {
			t.step('Liste → Board per Klick (In-App-Navigation: Browser-Zurück bleibt in der App)')
			await p.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
			await p.locator(`[data-knorke-board="${board}"]`).first().click()
			await waitReady(p)
			t.must(onBoard(p, board), 'Board über den Router geöffnet', p.url())
			await createSticky(p, 0, 0, 'vor offline')
			await K.waitIdle(p, 10000)

			t.step('offline: Notiz anlegen, Zurück-Knopf')
			await a.ctx.setOffline(true)
			t.check(await until(() => bannerVisible(p, 'offline'), { timeout: 4000 }), 'Offline-Banner')
			const n = await createSticky(p, 300, 0, 'offline notiert')
			const t0 = Date.now()
			await back()
			const dlg = await leaveDialog(t, p, 'Zurück offline')
			t.must(dlg, 'Rückfrage beim Verlassen mit Ausstehendem')
			t.check(Date.now() - t0 <= 4000, 'Dialog ≤ 4 s (offline antwortet prepareLeave sofort)', Date.now() - t0)
			t.check((await dlg.locator('[data-knorke-action=confirm]').count()) === 1, '„Leave“ ist [data-knorke-action=confirm] im Dialog')
			await stay(p)
			let st = await K.state(p)
			t.check(st.boardId === board && onBoard(p, board), 'Stay: Board und URL bleiben', { boardId: st.boardId, url: p.url() })
			t.check((await itemMap(p)).has(n), 'Stay: die Offline-Notiz ist noch im Modell')

			t.step('Browser-Zurück (popstate)')
			await p.evaluate(() => window.history.back())
			const dlg2 = await leaveDialog(t, p, 'Browser-Zurück offline')
			if (dlg2) await stay(p)
			const urlBack = await until(() => onBoard(p, board), { timeout: 3000 })
			st = await K.state(p)
			t.check(urlBack && st.boardId === board, 'Browser-Zurück + Stay: URL wieder auf dem Board, Sitzung läuft', { url: p.url(), boardId: st.boardId, status: st.status })

			t.step('wieder online: die Notiz kommt an')
			await a.ctx.setOffline(false)
			await until(async () => (await K.state(p)).status === 'online', { timeout: 10000 })
			await K.waitIdle(p, 15000)
			const it = await until(() => serverItem(board, n), { timeout: 5000 })
			t.check(it?.data?.text === 'offline notiert', 'der Server hat die Offline-Notiz', it)

			t.step('Zurück ohne Ausstehendes')
			await back()
			const list = await p.locator('[data-knorke=board-list]').first().waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)
			t.check(list && onList(p), 'ohne Ausstehendes: direkt zur Liste', p.url())
			t.check(!(await p.locator('[data-knorke-dialog=leave]').first().isVisible().catch(() => false)), 'dabei kein Dialog')

			t.step('Leave verlässt trotz Ausstehendem')
			await p.locator(`[data-knorke-board="${board}"]`).first().click()
			await waitReady(p)
			await a.ctx.setOffline(true)
			await until(() => bannerVisible(p, 'offline'), { timeout: 4000 })
			await createSticky(p, 600, 0, 'verworfen')
			await back()
			const dlg3 = await leaveDialog(t, p, 'Zurück offline (2)')
			if (dlg3) await p.locator('[data-knorke-action=confirm]:visible').first().click()
			const list2 = await p.locator('[data-knorke=board-list]').first().waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)
			t.check(list2 && onList(p), 'Leave: Liste angezeigt', p.url())
		} finally {
			await a.ctx.setOffline(false).catch(() => {})
		}
	},
}

export const E14 = {
	id: 'E14',
	title: 'Editor offen beim Neuladen/Schließen (T5): Getipptes ohne Esc/Blur kommt an',
	async run(t, world) {
		const board = await world.board('E2E Editor-Flush')
		const a = await world.actor('alice-flush', { user: 'alice' })
		let prompts = 0
		const accept = (d) => { prompts++; d.accept().catch(() => {}) }
		a.page.on('dialog', accept)

		/**
		 * Opens the editor of `id` and replaces the text, leaving the editor OPEN.
		 * The first character goes alone (the editor commits it at once, the
		 * leading edge of its 1 Hz commits); the rest follows in one input event,
		 * and the caller unloads right after it, well inside the 1 s window: only
		 * flushEditor can bring the rest to the server, whatever the typing speed.
		 */
		async function typeOpen(p, id, text) {
			const c = await centerOf(p, id)
			await p.mouse.dblclick(c.x, c.y)
			const ed = p.locator('textarea[data-knorke-editor]')
			await ed.waitFor({ state: 'visible', timeout: 5000 })
			await p.keyboard.press('Control+A')
			await p.keyboard.type(text.slice(0, 1))
			await sleep(150)
			await p.keyboard.insertText(text.slice(1))
		}

		await openBoard(a, board)
		const n = await createSticky(a.page, 0, 0, 'start')
		await K.waitIdle(a.page, 10000)

		t.step('Editor offen, tippen, sofort neu laden')
		const typed1 = 'neu geladen ' + Date.now().toString(36)
		await typeOpen(a.page, n, typed1)
		await a.page.reload({ waitUntil: 'domcontentloaded' })
		await waitReady(a.page)
		const after = await until(async () => ((await itemMap(a.page)).get(n)?.data?.text === typed1 ? true : null), { timeout: 5000 })
		t.check(after, 'nach dem Neuladen: der getippte Text ist da (Modell)', (await itemMap(a.page)).get(n)?.data?.text)
		t.check((await serverItem(board, n))?.data?.text === typed1, 'nach dem Neuladen: der Server hat den Text')

		t.step('Editor offen, tippen, Seite schließen')
		await K.waitIdle(a.page, 10000)
		const p2 = await a.ctx.newPage()
		p2.on('dialog', accept)
		await p2.goto(`${APP}/b/${board}`, { waitUntil: 'domcontentloaded' })
		await waitReady(p2)
		const typed2 = 'geschlossen ' + Date.now().toString(36)
		await typeOpen(p2, n, typed2)
		await p2.close({ runBeforeUnload: true })
		const landed = await until(async () => ((await serverItem(board, n))?.data?.text === typed2 ? true : null), { timeout: 5000 })
		t.check(landed, 'nach dem Schließen: der Server hat den Text', (await serverItem(board, n))?.data?.text)
		t.note(`beforeunload-Rückfragen: ${prompts}`)
	},
}
