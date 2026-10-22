/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E01 installation, E02 board CRUD (SPEC-M0 §8.2).
 */
import { APP, listBoards, action, field, until, sleep } from '../lib/harness.mjs'

const LIST = '[data-knorke=board-list]'

async function openList(a) {
	const r = await a.page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await a.page.locator(LIST).first().waitFor({ state: 'attached', timeout: 15000 })
	return r
}

/** Creates a board through the UI (new-board → field=title → confirm); returns its id. */
async function createViaUi(a, title, before) {
	await action(a.page, 'new-board')
	await field(a.page, 'title', title)
	await action(a.page, 'confirm')
	const b = await until(async () => (await listBoards('alice')).find((x) => x.title === title && !before.has(x.id)), { timeout: 10000 })
	if (!b) throw new Error(`Board „${title}“ ist nach confirm nicht in der Liste`)
	return b.id
}

export const E01 = {
	id: 'E01',
	title: 'Installation: /apps/knorke/ mit Navigationseintrag und Board-Liste',
	async run(t, world) {
		const a = await world.actor('alice-E01', { user: 'alice' })
		try {
			const r = await a.page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
			t.check(r && r.status() === 200, 'Status 200', r && r.status())
			const nav = a.page.locator('nav.app-menu, #appmenu, header').getByText('Knorke', { exact: true }).first()
			const navOk = await until(() => nav.isVisible(), { timeout: 10000 })
			t.check(navOk, 'Navigationseintrag „Knorke“ sichtbar')
			const list = await a.page.locator(LIST).first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false)
			t.check(list, '[data-knorke=board-list] vorhanden')
			await sleep(500)
			t.check(a.errors.length === 0, 'keine Seitenfehler', a.errors)
		} finally {
			await world.drop(a)
		}
	},
}

export const E02 = {
	id: 'E02',
	title: 'Board-CRUD: anlegen, umbenennen + neu laden, löschen; bob sieht nichts',
	async run(t, world) {
		const a = await world.actor('alice-E02', { user: 'alice' })
		const b = await world.actor('bob-E02', { user: 'bob' })
		try {
			const before = new Set((await listBoards('alice')).map((x) => x.id))
			await openList(a)
			t.step('anlegen „E2E Board“')
			const id = await createViaUi(a, 'E2E Board', before)
			world.boards.add(id)
			t.check(Number.isInteger(id), 'Board angelegt', id)
			t.step('umbenennen in „E2E Board 2“')
			await openList(a)
			const row = a.page.locator(`[data-knorke-board="${id}"]`).first()
			await row.waitFor({ state: 'visible', timeout: 10000 })
			await action(a.page, 'rename', row)
			await field(a.page, 'title', 'E2E Board 2')
			await action(a.page, 'confirm')
			const renamed = await until(async () => (await listBoards('alice')).find((x) => x.id === id)?.title === 'E2E Board 2', { timeout: 10000 })
			t.check(renamed, 'Server kennt den neuen Titel')
			await a.page.reload({ waitUntil: 'domcontentloaded' })
			const row2 = a.page.locator(`[data-knorke-board="${id}"]`).first()
			await row2.waitFor({ state: 'visible', timeout: 15000 })
			t.check((await row2.textContent()).includes('E2E Board 2'), 'Titel bleibt nach dem Neuladen', await row2.textContent())
			t.step('„Weg damit“ anlegen und löschen')
			const before2 = new Set((await listBoards('alice')).map((x) => x.id))
			await openList(a)
			const gone = await createViaUi(a, 'Weg damit', before2)
			world.boards.add(gone)
			await openList(a)
			const row3 = a.page.locator(`[data-knorke-board="${gone}"]`).first()
			await row3.waitFor({ state: 'visible', timeout: 10000 })
			await action(a.page, 'delete', row3)
			await action(a.page, 'confirm')
			const deleted = await until(async () => !(await listBoards('alice')).some((x) => x.id === gone), { timeout: 10000 })
			t.check(deleted, 'gelöschtes Board fehlt in der API-Liste')
			await a.page.reload({ waitUntil: 'domcontentloaded' })
			await a.page.locator(LIST).first().waitFor({ state: 'attached', timeout: 15000 })
			t.check(await a.page.locator(`[data-knorke-board="${gone}"]`).count() === 0, 'gelöschtes Board fehlt in der Liste')
			t.step('bob öffnet seine Liste')
			await openList(b)
			await sleep(500)
			t.check(await b.page.locator(`[data-knorke-board="${id}"]`).count() === 0, 'bob sieht alices Board nicht (UI)')
			t.check(!(await listBoards('bob')).some((x) => x.id === id), 'bob sieht alices Board nicht (API)')
		} finally {
			await world.drop(a)
			await world.drop(b)
		}
	},
}
