/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Search on the board (factory job 271).
 *
 * E99 alice (owner, Chromium 1440 × 900, keyboard and mouse) on a board of
 * her own with three notes: A "Coffee break" at (0, 0), B "tea" at (600,
 * 0), C "more coffee" at (0, 1500). Steps:
 *   (1) the magnifier [data-knorke-action=search] stands in the top bar;
 *   (2) with the canvas focus Ctrl+F opens the search panel
 *       [data-knorke-search] and its field takes the focus (the browser
 *       search stays shut: the page keeps the key);
 *   (3) typing "coffee" lists two hits (A, C) and counts "2 results";
 *   (4) Enter shows A: the frame (__knorke.searchHit()) on A, "1 of 2";
 *       a second Enter moves the camera and frames C, "2 of 2"; the
 *       selection stays empty and no op is sent (the items are unchanged);
 *   (5) Esc closes the panel; the frame goes.
 * Own board, no instance setting: before E09, after E98.
 * Flake gate: --only E99 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (camera, frame, selection), [U] the shell, [D] a harness precondition,
 * [B] a server answer. Waiting polls from Node with until() (CSP, trap 9.10).
 */
import { K, CANVAS, put, ulid, seedOps, openBoard, until } from '../lib/harness.mjs'

const PANEL = '[data-knorke-search]'
const FIELD = '[data-knorke-field=search]'
const COUNT = '[data-knorke-search-count]'

/** @return {Promise<string|null>} the item the search frames */
const hitOf = (page) => page.evaluate(() => window.__knorke.searchHit?.() ?? null).catch(() => undefined)
/** @return {Promise<string>} the counter's text */
const countOf = (page) => page.locator(COUNT).first().textContent({ timeout: 1000 }).then((s) => s.trim()).catch(() => '')

export const E99 = {
	id: 'E99',
	title: 'Suche auf dem Board (Job 271): Lupe in der Kopfleiste, Strg+F öffnet das Suchfeld, „coffee“ findet zwei Notizen, Enter springt von Treffer zu Treffer mit Rahmen, Auswahl und Elemente bleiben, Esc schließt',
	async run(t, world) {
		const board = await world.board('E99 Suche')
		const A = ulid()
		const B = ulid()
		const C = ulid()
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 0, y: 0, data: { text: 'Coffee break' } }),
			put.sticky(B, { x: 600, y: 0, data: { text: 'tea' } }),
			put.sticky(C, { x: 0, y: 1500, data: { text: 'more coffee' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: drei Notizen gesät', res)
		const a = await world.actor('alice-search', { user: 'alice' })
		const pa = a.page
		try {
			await openBoard(a, board)
			const items0 = JSON.stringify(await K.items(pa))

			t.step('(1) die Lupe steht in der Kopfleiste')
			t.check(await pa.locator('[data-knorke-action=search]').first().isVisible().catch(() => false), '[U] (1) Lupe sichtbar')

			t.step('(2) Strg+F mit Fokus auf der Leinwand öffnet die Suche')
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+f')
			t.check(await until(() => pa.locator(PANEL).first().isVisible().catch(() => false), { timeout: 5000 }), '[U] (2) das Suchfeld ist offen')
			t.check(await until(() => pa.evaluate((sel) => document.activeElement?.matches?.(sel) === true, FIELD).catch(() => false), { timeout: 3000 }), '[U] (2) das Feld hat den Fokus')

			t.step('(3) „coffee“ tippen: zwei Treffer')
			await pa.keyboard.type('coffee')
			t.check(await until(async () => (await pa.locator('[data-knorke-search-hit]').count()) === 2, { timeout: 3000 }), '[U] (3) zwei Zeilen in der Liste', await pa.locator('[data-knorke-search-hit]').count())
			t.check(await until(async () => /^2\b/.test(await countOf(pa)), { timeout: 2000 }), '[U] (3) Zähler „2 results“', await countOf(pa))

			t.step('(4) Enter springt zu A, dann zu C')
			await pa.keyboard.press('Enter')
			t.check(await until(async () => (await hitOf(pa)) === A, { timeout: 3000 }), '[S] (4) Rahmen auf A', await hitOf(pa))
			t.check(/^1\D+2$/.test(await countOf(pa)), '[U] (4) Zähler „1 of 2“', await countOf(pa))
			const cam1 = await K.camera(pa)
			await pa.keyboard.press('Enter')
			t.check(await until(async () => (await hitOf(pa)) === C, { timeout: 3000 }), '[S] (4) zweites Enter: Rahmen auf C', await hitOf(pa))
			const cam2 = await K.camera(pa)
			t.check(Math.abs(cam2.y - cam1.y) > 100, '[S] (4) die Kamera ist zu C gesprungen', { cam1, cam2 })
			t.check(/^2\D+2$/.test(await countOf(pa)), '[U] (4) Zähler „2 of 2“', await countOf(pa))
			t.check(JSON.stringify(await K.selection(pa)) === '[]', '[S] (4) die Auswahl bleibt leer', await K.selection(pa))
			t.check(JSON.stringify(await K.items(pa)) === items0, '[S] (4) die Elemente sind unverändert (kein Op)')

			t.step('(5) Esc schließt')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await pa.locator(PANEL).count()) === 0, { timeout: 3000 }), '[U] (5) die Suche ist zu')
			t.check((await hitOf(pa)) === null, '[S] (5) kein Rahmen mehr', await hitOf(pa))
		} finally {
			await world.drop(a)
		}
	},
}
