/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E03 convergence, E04 presence, E04b text lease, E05 reload (SPEC-M0 §8.2).
 * All run on the shared world (alice, bob via link, guest Gina).
 *
 * World layout (world units = CSS px at 100 %; an empty board opens with
 * (0,0) in the middle of the canvas, §6.3 fit; a new note is centred on the
 * click). At 1440×900 the canvas shows about x ∈ [-650, 700] and y ∈ [-270,
 * 410] without the top bar, the context bar and the tool bar on top of it:
 *   notes      3 × 3, centres x -540/-310/-80, rows alice -160, bob 60, gina 280
 *   frame      (80,-270) – (690,130); targets inside (200,-60), (420,-60), (620,-60)
 *   free root  below the frame, centres y 290 at x 190 and 560
 */
import {
	K, settle, itemMap, createSticky, createFrame, dragItem, editText, selectItem, centerOf, until, sleep, sameList, firstDiff, waitReady,
} from '../lib/harness.mjs'
import { traceMarkdown } from '../lib/cli.mjs'

const COLS = [-540, -310, -80]
const ROWS = { alice: -160, bob: 60, gina: 280 }
export const SPOTS = { bobMove: { x: 190, y: 290 }, e06: { x: 560, y: 290 }, e07: { x: 620, y: -60 } }

/** All three items() equal → time, else null. */
async function allEqual(pages) {
	const lists = await Promise.all(pages.map((p) => K.items(p)))
	return lists.every((l) => sameList(l, lists[0])) ? lists : null
}

async function converge(t, s, tLast, label) {
	const lists = await until(() => allEqual(s.pages), { timeout: 15000, every: 100 })
	const tConv = Date.now()
	t.check(lists, `${label}: items() auf allen drei Seiten gleich`)
	if (!lists) {
		const [a, b, g] = await Promise.all(s.pages.map((p) => K.items(p)))
		t.note(`alice↔bob ${JSON.stringify(firstDiff(a, b))}; alice↔Gina ${JSON.stringify(firstDiff(a, g))}`)
		return false
	}
	await settle(s.pages)
	const after = await Promise.all(s.pages.map((p) => K.items(p)))
	const server = await K.serverItems(s.alice.page)
	t.check(after.every((l) => sameList(l, server)), `${label}: nach waitIdle gleich serverItems()`, firstDiff(after[0], server))
	return tConv - tLast
}

export const E03 = {
	id: 'E03',
	title: 'Konvergenz: drei Akteure, Notizen, Frame, Verschieben, Text, Löschen, gleichzeitiges Ziehen',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob, gina } = s
		t.step('jeder legt 3 Notizen an und tippt Text (Esc = Commit)')
		const make = async (actor, who) => {
			const ids = []
			for (let i = 0; i < 3; i++) {
				try {
					ids.push(await createSticky(actor.page, COLS[i], ROWS[who], `${who} ${i + 1}`))
				} catch (e) {
					throw new Error(`${who}, Notiz ${i + 1}: ${e.message}`)
				}
			}
			return ids
		}
		const [an, bn, gn] = await Promise.all([make(alice, 'alice'), make(bob, 'bob'), make(gina, 'gina')])
		s.notes = { alice: an, bob: bn, gina: gn }
		t.check(new Set([...an, ...bn, ...gn]).size === 9, '9 Notizen angelegt', { an, bn, gn })
		t.step('alice legt einen Frame an und zieht 2 Notizen hinein')
		const F = await createFrame(alice.page, { x: 80, y: -270 }, { x: 690, y: 130 })
		s.frame = F
		for (const [id, wx] of [[an[0], 200], [an[1], 420]]) {
			const p = await K.w2s(alice.page, wx, -60)
			await dragItem(alice.page, id, { to: p })
			await sleep(150)
		}
		t.step('bob verschiebt eine Notiz von alice')
		await until(async () => (await itemMap(bob.page)).has(an[2]), { timeout: 5000 })
		await dragItem(bob.page, an[2], { to: await K.w2s(bob.page, SPOTS.bobMove.x, SPOTS.bobMove.y) })
		t.step('Gina ändert bobs Text')
		await until(async () => (await itemMap(gina.page)).has(bn[0]), { timeout: 5000 })
		await editText(gina.page, bn[0], 'von Gina geändert')
		t.step('alice löscht eine Notiz von Gina')
		await until(async () => (await itemMap(alice.page)).has(gn[0]), { timeout: 5000 })
		await selectItem(alice.page, gn[0])
		await alice.page.keyboard.press('Delete')
		t.step('alice und bob ziehen gleichzeitig dieselbe Notiz')
		await settle(s.pages)
		await Promise.all([
			dragItem(alice.page, bn[1], { dx: 60, dy: 40 }),
			dragItem(bob.page, bn[1], { dx: -50, dy: 70 }),
		])
		const tLast = Date.now()
		const ms = await converge(t, s, tLast, 'E03')
		if (ms !== false) {
			t.check(ms <= 3000, 'Konvergenz ≤ 3 s nach der letzten Aktion', ms)
			t.note(`Konvergenz nach ${ms} ms`)
		}
		const m = await itemMap(alice.page)
		t.check(m.get(an[0])?.parent === F && m.get(an[1])?.parent === F, 'die 2 Notizen haben parent = Frame', [m.get(an[0]), m.get(an[1])])
		t.check(m.get(bn[0])?.data?.text === 'von Gina geändert', 'Ginas Text an bobs Notiz', m.get(bn[0])?.data)
		t.check(!m.has(gn[0]), 'Ginas Notiz gelöscht')
		t.check(m.get(an[2])?.parent === null, 'von bob verschobene Notiz liegt an der Wurzel', m.get(an[2]))
	},
}

/** Waits until page's presence() shows `name` editing `id` as the lease holder. */
async function holderSeen(page, id, name, timeout = 5000) {
	return until(async () => (await K.presence(page) || []).some((x) => x.name === name && x.editing === id && x.editingHolder === true), { timeout })
}

/** Client position of the remote cursor whose name label contains `name`. */
function cursorOf(page, name) {
	return page.evaluate((n) => {
		for (const el of document.querySelectorAll('[data-knorke-cursor]')) {
			const label = el.querySelector('.knorke-cursor-name')
			if (label && label.textContent.includes(n)) {
				const r = el.getBoundingClientRect()
				return { x: r.left, y: r.top, key: el.getAttribute('data-knorke-cursor') }
			}
		}
		return null
	}, name)
}

export const E04 = {
	id: 'E04',
	title: 'Präsenz: Cursor mit Namen, Ziehvorschau, „bearbeitet“-Chip',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob, gina } = s
		const P = { x: 420, y: 330 }
		t.step('alice bewegt die Maus an Weltpunkt P')
		const sp = await K.w2s(alice.page, P.x, P.y)
		await alice.page.mouse.move(sp.x - 20, sp.y - 20)
		await alice.page.mouse.move(sp.x, sp.y, { steps: 4 })
		for (const [who, page] of [['bob', bob.page], ['Gina', gina.page]]) {
			const t0 = Date.now()
			const hit = await until(async () => {
				const c = await cursorOf(page, 'Alice Adler')
				if (!c) return null
				const want = await K.w2s(page, P.x, P.y)
				return Math.abs(c.x - want.x) <= 30 && Math.abs(c.y - want.y) <= 30 ? { c, want } : null
			}, { timeout: 2500, every: 50 })
			t.check(hit && Date.now() - t0 <= 2500, `${who}: Cursor „Alice Adler“ ±30 px um worldToScreen(P) in ≤ 2 s`, hit || await cursorOf(page, 'Alice Adler'))
		}
		t.step('alice zieht eine Notiz und hält')
		const N = s.notes.alice?.[2]
		t.must(N, 'Notiz aus E03 vorhanden')
		const c = await centerOf(alice.page, N)
		const c0 = (await itemMap(alice.page)).get(N)
		await alice.page.mouse.move(c.x, c.y)
		await alice.page.mouse.down()
		const samples = []
		let active = 0
		for (let i = 1; i <= 25; i++) {
			await alice.page.mouse.move(c.x + i * 4, c.y + i * 2)
			await sleep(80)
			if (i % 5 === 0) {
				const st = await K.scene(bob.page)
				active = Math.max(active, st?.activeChildren ?? 0)
				const pr = await K.presence(bob.page)
				const d = (pr || []).find((x) => x.name === 'Alice Adler' && x.drag?.length)
				if (d) samples.push(JSON.stringify(d.drag[0]))
			}
		}
		t.check(active >= 1, 'bob: scene().activeChildren ≥ 1 während des Ziehens', active)
		t.check(new Set(samples).size >= 2, 'bob: Vorschauposition ändert sich', samples)
		await alice.page.mouse.up()
		await settle(s.pages)
		let fa = null
		let fb = null
		const same = await until(async () => {
			fa = (await itemMap(alice.page)).get(N)
			fb = (await itemMap(bob.page)).get(N)
			return fa && fb && fa.x === fb.x && fa.y === fb.y && fa.parent === fb.parent && fa.x !== c0.x
		}, { timeout: 5000 })
		t.check(same, 'nach dem Loslassen gilt die Endposition auch bei bob', { fa, fb })
		t.step('alice öffnet den Text-Editor')
		const c2 = await centerOf(alice.page, N)
		await alice.page.mouse.dblclick(c2.x, c2.y)
		await alice.page.locator('textarea[data-knorke-editor]').waitFor({ state: 'visible', timeout: 5000 })
		const chip = await until(() => bob.page.locator(`[data-knorke-editing="${N}"]`).first().isVisible(), { timeout: 2500, every: 50 })
		t.check(chip, 'bob: [data-knorke-editing=<id>] ≤ 2 s')
		await alice.page.keyboard.press('Escape')
	},
}

export const E04b = {
	id: 'E04b',
	title: 'Text-Lease: kein zweiter Editor, Übernehmen sperrt den ersten',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob } = s
		const N = s.notes.bob?.[2]
		t.must(N, 'Notiz aus E03 vorhanden')
		// trace window of this scenario (onRed writes it into the report)
		s.e04b = { since: Date.now(), N, takeOversBefore: bob.takeOvers }
		const mark = (a, label) => a.event(label)
		const edA = alice.page.locator('textarea[data-knorke-editor]')
		const edB = bob.page.locator('textarea[data-knorke-editor]')
		let typing = true
		const typeLoop = async (page, prefix) => {
			let i = 0
			while (typing) {
				await page.keyboard.type(String.fromCharCode(97 + (i++ % 26)))
				await sleep(200)
			}
			return prefix
		}
		t.step('alice öffnet den Editor und tippt weiter (1 Zeichen je 200 ms)')
		await K.waitIdle(alice.page, 15000)
		let c = await centerOf(alice.page, N)
		await alice.page.mouse.dblclick(c.x, c.y)
		await edA.waitFor({ state: 'visible', timeout: 5000 })
		mark(alice, 'alice: Editor offen, tippt (Teil 1)')
		await alice.page.keyboard.press('End')
		const loop1 = typeLoop(alice.page)
		await sleep(1200)
		// bob must see alice as the holder before he double-clicks (presence travels with the tick)
		t.check(await holderSeen(bob.page, N, 'Alice Adler'), 'bob sieht alice als Halter (editingHolder)')
		t.step('bob doppelklickt N')
		c = await centerOf(bob.page, N)
		mark(bob, 'bob: Doppelklick (Teil 1)')
		await bob.page.mouse.dblclick(c.x, c.y)
		await sleep(800)
		t.check(!(await edB.isVisible().catch(() => false)), 'bei bob öffnet sich kein Editor')
		const chip = bob.page.locator(`[data-knorke-editing="${N}"]`).first()
		t.check(await chip.isVisible().catch(() => false), 'bob: Chip [data-knorke-editing=N] sichtbar')
		t.check(await chip.locator('[data-knorke-action=take-over]').first().isVisible().catch(() => false)
			|| await bob.page.locator('[data-knorke-action=take-over]').first().isVisible().catch(() => false), 'bob: Aktion take-over sichtbar')
		typing = false
		await loop1
		const aliceText = await edA.inputValue()
		mark(alice, 'alice: Esc (Teil 1)')
		await alice.page.keyboard.press('Escape')
		await settle(s.pages)
		const texts = await Promise.all(s.pages.map(async (p) => (await itemMap(p)).get(N)?.data?.text))
		t.check(texts.every((x) => x === aliceText), 'nach alices Esc: alices voller Text auf allen Seiten', { aliceText, texts })

		t.step('alice tippt wieder, bob übernimmt')
		c = await centerOf(alice.page, N)
		await alice.page.mouse.dblclick(c.x, c.y)
		await edA.waitFor({ state: 'visible', timeout: 5000 })
		mark(alice, 'alice: Editor offen, tippt (Teil 2)')
		await alice.page.keyboard.press('End')
		typing = true
		const loop2 = typeLoop(alice.page)
		await sleep(1200)
		// bob must see alice as the holder before he double-clicks (presence travels with the tick)
		t.check(await holderSeen(bob.page, N, 'Alice Adler'), 'bob sieht alice als Halter (editingHolder)')
		c = await centerOf(bob.page, N)
		mark(bob, 'bob: Doppelklick (Teil 2)')
		await bob.page.mouse.dblclick(c.x, c.y)
		await sleep(300)
		t.check(!(await edB.isVisible().catch(() => false)), 'bob: auch beim zweiten Doppelklick kein Editor')
		const take = bob.page.locator('[data-knorke-action=take-over]').first()
		await take.waitFor({ state: 'visible', timeout: 5000 })
		mark(bob, 'bob: „Übernehmen“ geklickt')
		await take.click()
		await edB.waitFor({ state: 'visible', timeout: 5000 })
		mark(bob, 'bob: Editor offen')
		const focused = await bob.page.evaluate(() => !!document.activeElement?.hasAttribute?.('data-knorke-editor'))
		t.note(`bob: Editor nach „Übernehmen“ fokussiert: ${focused}`)
		await bob.page.keyboard.press('Control+A')
		await bob.page.keyboard.type('Bob hat übernommen', { delay: 10 })
		const typed = await edB.inputValue().catch(() => '<Editor zu>')
		t.check(typed === 'Bob hat übernommen', 'bobs Editor enthält den getippten Text', typed)
		mark(bob, 'bob: Esc')
		await bob.page.keyboard.press('Escape')
		const locked = await until(async () => (await edA.getAttribute('data-knorke-editor-state').catch(() => null)) === 'locked', { timeout: 5000 })
		mark(alice, locked ? 'alice: Editor locked' : 'alice: Editor NICHT locked (5 s)')
		typing = false
		await loop2
		t.check(locked, 'alices Editor: data-knorke-editor-state=locked')
		const aliceKept = await edA.inputValue().catch(() => '')
		t.check(aliceKept.length > aliceText.length, 'alices getippter Text bleibt im Editor', { aliceKept, aliceText })
		await K.waitIdle(bob.page, 15000)
		const has = await until(async () => (await itemMap(alice.page)).get(N)?.data?.text === 'Bob hat übernommen', { timeout: 5000 })
		t.check(has, 'items() enthält bobs Text')
		t.note(`bob hat me.tk ${bob.takeOvers - s.e04b.takeOversBefore}× gesendet; letztes me: ${bob.lastMe}`)
		mark(alice, 'alice: Esc (gesperrter Editor)')
		await alice.page.keyboard.press('Escape')
		const closed = await edA.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false)
		t.check(closed, 'alices gesperrter Editor schließt mit Esc')
		await settle(s.pages)
		const final = await Promise.all(s.pages.map(async (p) => (await itemMap(p)).get(N)?.data?.text))
		t.check(final.every((x) => x === 'Bob hat übernommen'), 'nach alices Schließen bleibt bobs Text überall', final)
	},
	/**
	 * Red (any failed check, abort or time-out): the /sync trace of alice and
	 * bob since the start of E04b goes into the report as its own section, with
	 * the scenario's steps between the rows and the end state of both pages.
	 */
	async onRed(t, world, { rep = 1 } = {}) {
		const s = world.s
		if (!s?.alice || !s?.bob) return
		const w = s.e04b || { since: 0, N: null, takeOversBefore: 0 }
		const facts = [`Notiz N = ${w.N ?? '?'} (in der Spur: letzte 6 Zeichen von e)`, `bob: me.tk in ${s.bob.takeOvers - w.takeOversBefore} Anfrage(n) gesendet`]
		for (const a of [s.alice, s.bob]) {
			const st = await K.state(a.page).catch((e) => ({ error: String(e?.message || e).slice(0, 120) }))
			const ed = await a.page.locator('textarea[data-knorke-editor]').first().evaluate((el) => ({ open: true, state: el.getAttribute('data-knorke-editor-state'), len: el.value.length })).catch(() => ({ open: false }))
			const text = w.N ? (await itemMap(a.page).catch(() => new Map())).get(w.N)?.data?.text : undefined
			facts.push(`${a.name}: status ${st?.status ?? st?.error}, Editor ${ed.open ? `offen (${ed.state ?? 'normal'}, ${ed.len} Zeichen)` : 'zu'}, items() Text von N = ${JSON.stringify(text)}`)
		}
		const hold = w.N ? (await K.presence(s.bob.page).catch(() => []) || []).filter((x) => x.editing === w.N).map((x) => `${x.name}${x.editingHolder ? ' (Halter)' : ''}`) : []
		facts.push(`bob sieht als Bearbeiter von N: ${hold.length ? hold.join(', ') : 'niemanden'}`)
		t.report(traceMarkdown(`E04b rot (Durchlauf ${rep}) – /sync-Spur alice + bob`, [s.alice, s.bob], { since: w.since, facts }))
		t.note(`/sync-Spur im Bericht (Abschnitt „E04b rot, Durchlauf ${rep}“)`)
	},
}

export const E05 = {
	id: 'E05',
	title: 'Neuladen: bob gleiche items() und Kamera; Gina ohne Namensdialog mit gleicher pid',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob, gina } = s
		await settle(s.pages)
		const before = await K.items(bob.page)
		const camBefore = await K.camera(bob.page)
		await sleep(1500) // camera is saved throttled (1 s)
		t.step('bob lädt neu')
		await bob.page.reload({ waitUntil: 'domcontentloaded' })
		await waitReady(bob.page, 30000)
		await K.waitIdle(bob.page, 15000)
		const after = await K.items(bob.page)
		t.check(sameList(before, after), 'bob: items() vorher = nachher', firstDiff(before, after))
		const camAfter = await K.camera(bob.page)
		t.check(camBefore && camAfter && Math.abs(camBefore.x - camAfter.x) <= 1 && Math.abs(camBefore.y - camAfter.y) <= 1 && Math.abs(camBefore.scale - camAfter.scale) < 0.001,
			'bob: Kamera wiederhergestellt', { camBefore, camAfter })
		t.step('Gina lädt neu')
		const pidBefore = (await K.state(gina.page)).pid
		await gina.page.reload({ waitUntil: 'domcontentloaded' })
		const sawDialog = await until(() => gina.page.locator('[data-knorke-field=guest-name]').first().isVisible().catch(() => false), { timeout: 1500 })
		await waitReady(gina.page, 30000)
		t.check(!sawDialog, 'Gina: kein Namensdialog')
		const pidAfter = (await K.state(gina.page)).pid
		t.check(pidBefore && pidAfter === pidBefore, 'Gina: gleiche state().pid', { pidBefore, pidAfter })
		const named = await until(async () => (await K.presence(alice.page) || []).find((x) => x.pid === pidAfter && x.guest), { timeout: 6000 })
		t.check(named && named.name === 'Gina', 'Gina: gleicher Name (Präsenz bei alice)', named)
	},
}
