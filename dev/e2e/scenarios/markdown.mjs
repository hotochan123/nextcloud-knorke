/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Markdown in notes (factory job 279).
 *
 * E101 alice (owner, Chromium 1440 × 900, keyboard and mouse) on a board of
 * her own: note M "**fett** https://example.org" at (0, 0) and note P
 * "eins zwei" at (400, 0). Steps:
 *   (1) M is drawn formatted: __knorke.drawnText(M) is the rich text, "fett"
 *       bold, the address a link, no run with "**";
 *   (2) a click on M selects it, the context bar shows "Open link"
 *       [data-knorke-action=open-link];
 *   (3) a double click on P opens its editor; the context bar shows B, I, S
 *       and the list button [data-knorke-format]; Ctrl+A in the editor and a
 *       click on B: the editor holds "**eins zwei**" and stays open;
 *   (4) Ctrl+I in the editor: "***eins zwei***";
 *   (5) Esc: P's stored text is "***eins zwei***", drawn as the rich text
 *       with "eins zwei" bold and italic.
 * Own board, no instance setting: before E09, after E100.
 * Flake gate: --only E101 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene,
 * [U] the shell, [D] a harness precondition, [B] a server answer.
 */
import { K, put, ulid, seedOps, openBoard, until, centerOf, itemMap } from '../lib/harness.mjs'

const EDITOR = 'textarea[data-knorke-editor]'

/** @return {boolean} the drawn runs read "eins zwei" (on one line or two), all bold and italic */
const boldItalic = (d) => d?.rich === true && d.runs.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim() === 'eins zwei' && d.runs.every((r) => r.b && r.i)

/** @return {Promise<object|null>} __knorke.drawnText(id) */
const drawn = (page, id) => page.evaluate((i) => window.__knorke.drawnText?.(i) ?? null, id).catch(() => null)

export const E101 = {
	id: 'E101',
	title: 'Markdown in Notizen (Job 279): fett und Link gezeichnet ohne Zeichen, „Open link“ in der Kontextleiste, B/I/S/Liste im offenen Editor, B und Strg+I setzen die Zeichen, gespeichert als Text',
	async run(t, world) {
		const board = await world.board('E101 Markdown')
		const M = ulid()
		const P = ulid()
		const res = await seedOps('alice', board, [
			put.sticky(M, { x: 0, y: 0, data: { text: '**fett** https://example.org' } }),
			put.sticky(P, { x: 400, y: 0, data: { text: 'eins zwei' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: zwei Notizen gesät', res)
		const a = await world.actor('alice-markdown', { user: 'alice' })
		const pa = a.page
		try {
			await openBoard(a, board)

			t.step('(1) M ist formatiert gezeichnet')
			t.check(await until(async () => (await drawn(pa, M))?.rich === true, { timeout: 5000 }), '[S] (1) M ist der Rich-Text', await drawn(pa, M))
			const d = await drawn(pa, M)
			const runs = d?.runs ?? []
			t.check(runs.some((r) => r.text === 'fett' && r.b), '[S] (1) „fett“ fett', runs)
			t.check(runs.some((r) => r.href === 'https://example.org'), '[S] (1) die Adresse ist ein Link', runs)
			t.check(!runs.some((r) => r.text.includes('**')), '[S] (1) kein „**“ gezeichnet', runs)

			t.step('(2) Klick auf M: „Open link“')
			const cm = await centerOf(pa, M)
			await pa.mouse.click(cm.x, cm.y)
			t.check(await until(() => pa.locator('[data-knorke-action=open-link]').first().isVisible().catch(() => false), { timeout: 3000 }), '[U] (2) „Open link“ in der Kontextleiste')

			t.step('(3) Doppelklick auf P, Strg+A, B')
			const cp = await centerOf(pa, P)
			await pa.mouse.dblclick(cp.x, cp.y)
			await pa.locator(EDITOR).first().waitFor({ state: 'visible', timeout: 5000 })
			t.check(await until(() => pa.locator('[data-knorke-format=bold]').first().isVisible().catch(() => false), { timeout: 3000 }), '[U] (3) B in der Kontextleiste')
			for (const f of ['italic', 'strike', 'list']) {
				t.check(await pa.locator(`[data-knorke-format=${f}]`).first().isVisible().catch(() => false), `[U] (3) ${f} in der Kontextleiste`)
			}
			await pa.keyboard.press('ControlOrMeta+a')
			await pa.locator('[data-knorke-format=bold]').first().click()
			t.check(await until(async () => (await pa.locator(EDITOR).first().inputValue().catch(() => '')) === '**eins zwei**', { timeout: 2000 }), '[U] (3) der Editor hält „**eins zwei**“', await pa.locator(EDITOR).first().inputValue().catch(() => ''))
			t.check(await pa.locator(EDITOR).first().isVisible().catch(() => false), '[U] (3) der Editor bleibt offen')

			t.step('(4) Strg+I')
			await pa.keyboard.press('ControlOrMeta+i')
			t.check(await until(async () => (await pa.locator(EDITOR).first().inputValue().catch(() => '')) === '***eins zwei***', { timeout: 2000 }), '[U] (4) „***eins zwei***“', await pa.locator(EDITOR).first().inputValue().catch(() => ''))

			t.step('(5) Esc: gespeichert und formatiert')
			await pa.keyboard.press('Escape')
			t.check(await until(async () => (await itemMap(pa)).get(P)?.data?.text === '***eins zwei***', { timeout: 5000 }), '[S] (5) P speichert den Text mit den Zeichen', (await itemMap(pa)).get(P)?.data)
			t.check(await until(async () => boldItalic(await drawn(pa, P)), { timeout: 3000 }), '[S] (5) „eins zwei“ fett und kursiv gezeichnet', await drawn(pa, P))
			await K.waitIdle(pa, 10000)
		} finally {
			await world.drop(a)
		}
	},
}
