/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Locked items (factory job 023, M2 SPEC-M1 §1.2 "(R20) Sperren", §11 Q10).
 *
 * E41 alice's own board, bob through the edit link (an account, link member),
 *   both on the desktop (1440 × 900). Notes A, C (top row), B, D (second
 *   row), E, and a frame F to the right. Steps:
 *   (1) bob selects A and clicks [data-knorke-action=lock]: serverItems()
 *       shows A with lock.by = bob's pid; alice's scene paints a lock
 *       (scene().locks ≥ 1);
 *   (2) bob drags A by 100 px with the mouse: A stays (locally and on the
 *       server); handles() has no transformer handle; a double click opens
 *       no editor;
 *   (3) bob: Ctrl+A selects everything but A; a marquee over A and C
 *       selects only C; a click on A and Shift+click on B select both, Del
 *       deletes only B and [data-knorke-toast=lock-delete] appears;
 *   (4) alice clicks A: [data-knorke-lock-badge=name] holds bob's display
 *       name; a right click on A shows [data-knorke-menu-item=unlock] with
 *       bob's name; alice unlocks through the bar, at bob A is unlocked;
 *   (5) alice: Ctrl+Shift+L locks A, the badge says "Locked by you"; Ctrl+Z
 *       unlocks, Ctrl+Shift+Z locks again;
 *   (6) alice locks frame F; bob drags E into F (parent = F) and out again
 *       (parent = null); a drag on F's title leaves F where it is;
 *   (7) bob moves D, alice locks D; bob's Ctrl+Z leaves D where it is and
 *       [data-knorke-toast=lock-undo] appears;
 *   (8) alice zooms out to LOD 2 (like E36): scene().locks ≥ 1;
 *   (9) (job 044, "Unlock all" for moderators) alice: Shift+1; bob: Esc,
 *       Ctrl+A, Ctrl+Shift+L, so every live item is locked (some by bob);
 *       bob's board menu (right click on the empty canvas) has no
 *       [data-knorke-menu-item=unlock-all]; alice's board menu has it, a
 *       click shows [data-knorke-toast=unlock-all], the server holds every
 *       item unlocked and bob's scene paints no lock (scene().locks = 0);
 *       alice's Ctrl+Z locks the same items again, now in her name;
 *  (10) (job 062) over the API alice unlocks A and C and bob locks them;
 *       alice right-clicks A: [data-knorke-menu-item=unlock-by] names bob,
 *       a click shows [data-knorke-toast=unlock-all], the server holds A
 *       and C unlocked and every other item still locked by alice (F too);
 *       alice right-clicks the free inside of F (world 1300, 400): the board
 *       menu (target "") ends on unlock-frame, unlock-all; unlock-frame
 *       unlocks F on the server, the others alice locked stay locked.
 * E41@390x844 (pass, mechanics of E31/E33): bob's display name is 60
 *   characters long for this pass (provisioning API as admin, put back in
 *   `finally`); bob locks a note of alice's board over the API; alice opens
 *   the board in a 390 × 844 window and selects it: the badge lies wholly in
 *   the viewport and is cut (scrollWidth > clientWidth);
 *   [data-knorke-action=unlock] is at least 44 × 44 CSS px.
 *   Own boards, no instance setting: before E09, directly after E40.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene
 * (selection, drag, marquee, handles, editor, symbol), [C] shell (bar,
 * badge, menu, toasts, keys through the session), [B] stored server state,
 * [D] a harness precondition. Waiting polls from Node with until()
 * (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, BASE, ENV, PHONE, CANVAS, api, put, ulid, seedOps, serverMap, itemMap, openBoard, waitReady, until, sleep, centerOf, selectItem,
	dragItem, dragPath, settle, TRANSFORM_HANDLES,
} from '../lib/harness.mjs'

/** Width of the phone pass's long display name (SPEC job 023 AK13). */
export const E41_NAME_LEN = 60

/** The edit link of a board (route 9 as alice). */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** An account opens /p/<token> (becomes a link member) and lands in the board. */
async function joinAsMember(actor, token) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await waitReady(actor.page, 30000)
}

/** Is the canvas the element at this client point (no bar over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/** The client point of a world point. */
const screenOf = (page, x, y) => K.w2s(page, x, y)

/** The lock of an item in the client's visible state (items()), undefined when the item is missing. */
async function lockIn(page, id) {
	const it = (await itemMap(page)).get(id)
	return it ? it.lock : undefined
}

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })

/** Display name of an account through the provisioning API as admin (OCS v2). */
async function setDisplayName(uid, name) {
	const r = await fetch(`${BASE}/ocs/v2.php/cloud/users/${encodeURIComponent(uid)}`, {
		method: 'PUT',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${ENV.admin.user}:${ENV.admin.pass}`).toString('base64'),
			'OCS-APIRequest': 'true',
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ key: 'displayname', value: name }),
	})
	return { status: r.status, text: (await r.text()).slice(0, 300) }
}

/** The lock op as the client sends it ({by, name} of the sender; the server takes the principal). */
const lockOp = (id) => ({ o: 'patch', id, p: { lock: { by: 'e41', name: 'E41' } } })

export const E41 = {
	id: 'E41',
	title: 'Sperren (Job 023): bob sperrt über die Leiste, Ziehen/Griffe/Editor gesperrt, Strg+A und Rahmen lassen gesperrte aus, Entf löscht nur Freies (lock-delete), alice sieht Etikett und Menü mit bobs Namen und entsperrt, Strg+Umschalt+L mit Undo/Redo, gesperrter Frame bleibt fest mit freiem Inhalt, Undo überspringt (lock-undo), Schloss in LOD 2, „Unlock all“ nur für alice (Job 044) mit Undo in ihrem Namen, „Unlock all locked by …“ hebt nur bobs Sperren auf und das Board-Menü im Inneren von F bietet „Unlock all in this frame“ (Job 062)',
	async run(t, world) {
		const board = await world.board('E41 Sperren')
		const [A, B, C, D, E, F] = [ulid(), ulid(), ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.sticky(A, { x: 0, y: 0, data: { text: 'A' } }), put.sticky(C, { x: 300, y: 0, data: { text: 'C' } }),
			put.sticky(B, { x: 0, y: 300, data: { text: 'B' } }), put.sticky(D, { x: 300, y: 300, data: { text: 'D' } }),
			put.sticky(E, { x: 600, y: 0, data: { text: 'E' } }), put.frame(F, { x: 1000, y: 200, w: 600, h: 400, data: { title: 'F' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notizen A–E und Frame F', res)
		const L = await linkToken(board)
		const alice = await world.actor('alice-sperren', { user: 'alice' })
		const bob = await world.actor('bob-sperren', { user: 'bob' })
		const pa = alice.page
		const pb = bob.page
		await openBoard(alice, board)
		await joinAsMember(bob, L)
		for (const p of [pa, pb]) {
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Shift+Digit1')
		}
		await settle([pa, pb])
		const bobState = await K.state(pb)
		t.must(bobState.role === 'edit' && typeof bobState.pid === 'string', '[D] bob ist über den Bearbeitungslink im Board (edit)', bobState)
		const bobName = bobState.name

		t.step('(1) bob wählt A und klickt Lock')
		await selectItem(pb, A)
		t.must(await appears(pb, '[data-knorke-action=lock]'), '[C] (1) Lock ist in der Kontextleiste sichtbar')
		await pb.locator('[data-knorke-action=lock]').first().click()
		await settle([pa, pb])
		const s1 = await serverMap('alice', board)
		t.check(s1.get(A)?.lock?.by === bobState.pid && s1.get(A)?.lock?.name === bobName, '[B] (1) serverItems: A trägt lock.by = bobs pid und seinen Namen', s1.get(A)?.lock)
		const fromServer = JSON.parse((await K.serverItems(pb)).find((s) => s.includes(A)) || 'null')
		t.check(fromServer?.lock?.by === bobState.pid, '[C] (1) __knorke.serverItems() bei bob zeigt dieselbe Sperre', fromServer?.lock)
		t.check(await until(async () => ((await K.scene(pa))?.locks ?? 0) >= 1, { timeout: 5000 }), '[S] (1) bei alice malt die Szene ein Schloss (scene().locks ≥ 1)', await K.scene(pa))

		t.step('(2) bob zieht A um 100 px, prüft Griffe und Doppelklick')
		const a0 = await K.rect(pb, A)
		await dragItem(pb, A, { dx: 100, dy: 0 })
		await settle([pa, pb])
		const a1 = await K.rect(pb, A)
		const s2 = await serverMap('alice', board)
		t.check(a0 && a1 && Math.abs(a1.x - a0.x) < 1 && Math.abs(a1.y - a0.y) < 1, '[S] (2) A bleibt lokal an seiner Stelle', { vorher: a0, nachher: a1 })
		t.check(s2.get(A)?.x === s1.get(A)?.x && s2.get(A)?.y === s1.get(A)?.y, '[B] (2) A bleibt beim Server an seiner Stelle', { vorher: [s1.get(A)?.x, s1.get(A)?.y], nachher: [s2.get(A)?.x, s2.get(A)?.y] })
		const hs = (await K.handles(pb)) || []
		t.check(Array.isArray(await K.handles(pb)) && !hs.some((h) => TRANSFORM_HANDLES.includes(h.name)), '[S] (2) handles() enthält keinen Transformer-Griff', hs.map((h) => h.name))
		const ca = await centerOf(pb, A)
		await pb.mouse.dblclick(ca.x, ca.y)
		await sleep(400)
		t.check(!(await pb.locator('textarea[data-knorke-editor]').isVisible().catch(() => false)), '[S] (2) ein Doppelklick auf A öffnet keinen Editor')
		await pb.keyboard.press('Escape')

		t.step('(3) bob: Strg+A, Rahmen über A und C, Umschalt+Klick A und B, Entf')
		await pb.locator(CANVAS).first().focus()
		await pb.keyboard.press('Control+a')
		const sel3 = (await K.selection(pb)) || []
		t.check(!sel3.includes(A) && [B, C, D, E, F].every((x) => sel3.includes(x)), '[S] (3) Strg+A wählt alles außer A', sel3)
		await pb.keyboard.press('Escape')
		const from = await screenOf(pb, 560, 250)
		const to = await screenOf(pb, 100, 100)
		t.must(await canvasAt(pb, from.x, from.y), '[D] (3) der Startpunkt des Rahmens liegt frei auf der Leinwand', from)
		await dragPath(pb, from, to)
		const sel3b = (await K.selection(pb)) || []
		t.check(sel3b.length === 1 && sel3b[0] === C, '[S] (3) ein Rahmen über A und C wählt nur C', sel3b)
		await selectItem(pb, A)
		const cb = await centerOf(pb, B)
		await pb.keyboard.down('Shift')
		await pb.mouse.click(cb.x, cb.y)
		await pb.keyboard.up('Shift')
		const sel3c = (await K.selection(pb)) || []
		t.check(sel3c.length === 2 && sel3c.includes(A) && sel3c.includes(B), '[S] (3) Klick auf A und Umschalt+Klick auf B wählen beide', sel3c)
		await pb.keyboard.press('Delete')
		t.check(await appears(pb, '[data-knorke-toast=lock-delete]', 3000), '[C] (3) der Toast [data-knorke-toast=lock-delete] erscheint')
		await settle([pa, pb])
		const s3 = await serverMap('alice', board)
		t.check(!s3.has(B) && s3.has(A), '[B] (3) Entf löscht nur B, A bleibt', { A: s3.has(A), B: s3.has(B) })
		t.check(sameIds((await K.selection(pb)) || [], [A]), '[S] (3) A bleibt gewählt', await K.selection(pb))

		t.step('(4) alice klickt A: Etikett und Menü nennen bob; Entsperren über die Leiste')
		await selectItem(pa, A)
		t.check(await appears(pa, '[data-knorke-lock-badge=name]', 3000), '[C] (4) das Etikett [data-knorke-lock-badge=name] ist sichtbar')
		const badge = (await pa.locator('[data-knorke-lock-badge=name]').first().innerText().catch(() => '')).trim()
		t.check(badge.includes(bobName), `[C] (4) das Etikett enthält bobs Anzeigenamen (${bobName})`, badge)
		const c4 = await centerOf(pa, A)
		await pa.mouse.click(c4.x, c4.y, { button: 'right' })
		t.check(await appears(pa, '[data-knorke-menu-item=unlock]', 3000), '[C] (4) der Rechtsklick zeigt [data-knorke-menu-item=unlock]')
		const entry = (await pa.locator('[data-knorke-menu-item=unlock]').first().innerText().catch(() => '')).trim()
		t.check(entry.includes(bobName), '[C] (4) der Eintrag nennt bob', entry)
		await pa.keyboard.press('Escape')
		await until(async () => !(await pa.locator('[data-knorke-menu=context]').first().isVisible().catch(() => false)), { timeout: 2000 })
		t.must(await appears(pa, '[data-knorke-action=unlock]'), '[C] (4) Unlock ist in alices Leiste sichtbar')
		await pa.locator('[data-knorke-action=unlock]').first().click()
		await settle([pa, pb])
		t.check(await until(async () => (await lockIn(pb, A)) === null, { timeout: 5000 }), '[C] (4) bei bob ist A danach entsperrt', await lockIn(pb, A))

		t.step('(5) alice: Strg+Umschalt+L, Strg+Z, Strg+Umschalt+Z')
		await pa.locator(CANVAS).first().focus()
		await pa.keyboard.press('Control+Shift+L')
		t.check(await until(async () => (await lockIn(pa, A))?.by === (await K.state(pa)).pid, { timeout: 3000 }), '[C] (5) Strg+Umschalt+L sperrt A', await lockIn(pa, A))
		t.check(await appears(pa, '[data-knorke-lock-badge=mine]', 3000), '[C] (5) das Etikett zeigt die eigene Sperre')
		const mine = (await pa.locator('[data-knorke-lock-badge=mine]').first().innerText().catch(() => '')).trim()
		t.check(mine === 'Locked by you', '[C] (5) Text „Locked by you“', mine)
		await pa.keyboard.press('Control+z')
		t.check(await until(async () => (await lockIn(pa, A)) === null, { timeout: 3000 }), '[C] (5) Strg+Z entsperrt A', await lockIn(pa, A))
		await pa.keyboard.press('Control+Shift+z')
		t.check(await until(async () => (await lockIn(pa, A)) !== null && (await lockIn(pa, A)) !== undefined, { timeout: 3000 }), '[C] (5) Strg+Umschalt+Z sperrt A wieder', await lockIn(pa, A))
		await settle([pa, pb])
		t.check((await serverMap('alice', board)).get(A)?.lock !== null, '[B] (5) beim Server ist A gesperrt')

		t.step('(6) alice sperrt den Frame F; bob zieht E hinein und hinaus; ein Ziehen am Titel von F')
		const title = await screenOf(pa, 1030, 192)
		t.must(await canvasAt(pa, title.x, title.y), '[D] (6) der Titel von F liegt frei auf der Leinwand', title)
		await pa.mouse.click(title.x, title.y)
		t.check(sameIds((await K.selection(pa)) || [], [F]), '[S] (6) ein Klick auf den Titel wählt F', await K.selection(pa))
		await pa.locator('[data-knorke-action=lock]').first().click()
		await settle([pa, pb])
		t.check(await until(async () => (await lockIn(pb, F)) !== null && (await lockIn(pb, F)) !== undefined, { timeout: 5000 }), '[C] (6) bei bob ist F gesperrt', await lockIn(pb, F))
		await pb.keyboard.press('Escape')
		await dragItem(pb, E, { to: await screenOf(pb, 1300, 400) })
		await settle([pa, pb])
		t.check((await serverMap('alice', board)).get(E)?.parent === F, '[B] (6) bob zieht E in den gesperrten Frame: parent = F', (await serverMap('alice', board)).get(E)?.parent)
		await dragItem(pb, E, { to: await screenOf(pb, 700, 100) })
		await settle([pa, pb])
		t.check((await serverMap('alice', board)).get(E)?.parent === null, '[B] (6) und wieder hinaus: parent = null', (await serverMap('alice', board)).get(E)?.parent)
		const f0 = (await serverMap('alice', board)).get(F)
		const tb = await screenOf(pb, 1030, 192)
		await dragPath(pb, tb, { x: tb.x + 100, y: tb.y + 60 })
		await settle([pa, pb])
		const f1 = (await serverMap('alice', board)).get(F)
		t.check(f1 && f0 && f1.x === f0.x && f1.y === f0.y, '[B] (6) ein Ziehen am Titel von F lässt F an seiner Stelle', { vorher: [f0?.x, f0?.y], nachher: [f1?.x, f1?.y] })
		const fr = await K.rect(pb, F)
		t.check(fr && Math.abs(fr.x - (await screenOf(pb, 1000, 200)).x) < 2, '[S] (6) F steht auch lokal bei bob an seiner Stelle', fr)

		t.step('(7) bob verschiebt D, alice sperrt D, bob drückt Strg+Z')
		await pb.keyboard.press('Escape')
		const dStart = (await serverMap('alice', board)).get(D)
		await dragItem(pb, D, { dx: 80, dy: 0 })
		await settle([pa, pb])
		const d0 = (await serverMap('alice', board)).get(D)
		t.must(d0 && dStart && d0.x !== dStart.x, '[B] (7) Vorbedingung: bobs Verschieben von D ist beim Server angekommen', { vorher: dStart?.x, nachher: d0?.x })
		await selectItem(pa, D)
		await pa.locator('[data-knorke-action=lock]').first().click()
		await settle([pa, pb])
		t.must(await until(async () => (await lockIn(pb, D)) !== null && (await lockIn(pb, D)) !== undefined, { timeout: 5000 }), '[C] (7) bei bob ist D gesperrt', await lockIn(pb, D))
		await pb.locator(CANVAS).first().focus()
		await pb.keyboard.press('Control+z')
		t.check(await appears(pb, '[data-knorke-toast=lock-undo]', 3000), '[C] (7) der Toast [data-knorke-toast=lock-undo] erscheint')
		await settle([pa, pb])
		const d1 = (await serverMap('alice', board)).get(D)
		t.check(d1?.x === d0.x && d1?.y === d0.y, '[B] (7) bobs Strg+Z lässt D stehen', { verschoben: [d0.x, d0.y], jetzt: [d1?.x, d1?.y] })

		t.step('(8) alice zoomt heraus bis LOD 2')
		await pa.keyboard.press('Escape')
		await pa.locator(CANVAS).first().focus()
		for (let i = 0; i < 20; i++) {
			const s = await K.scene(pa)
			if (s && s.lod === 2) break
			await pa.keyboard.press('Minus')
			await sleep(150)
		}
		const s8 = await until(async () => { const s = await K.scene(pa); return s && s.lod === 2 ? s : null }, { timeout: 5000 })
		t.must(s8, '[D] (8) alice ist in LOD 2', await K.scene(pa))
		t.check(await until(async () => ((await K.scene(pa))?.locks ?? 0) >= 1, { timeout: 3000 }), '[S] (8) auch in LOD 2 malt die Szene Schlösser (scene().locks ≥ 1)', await K.scene(pa))

		t.step('(9) bob sperrt alles mit Strg+A und Strg+Umschalt+L; nur alice hat „Unlock all“ im Board-Menü, Strg+Z sperrt in ihrem Namen')
		await pa.locator(CANVAS).first().focus()
		await pa.keyboard.press('Shift+Digit1')
		await pb.locator(CANVAS).first().focus()
		await pb.keyboard.press('Escape')
		await pb.keyboard.press('Control+a')
		await pb.keyboard.press('Control+Shift+L')
		await settle([pa, pb])
		const allLocked = (s) => s.size > 0 && [...s.values()].every((i) => i.lock !== null && typeof i.lock === 'object')
		let s9 = await serverMap('alice', board)
		await until(async () => allLocked(s9 = await serverMap('alice', board)), { timeout: 5000 })
		const live9 = [...s9.keys()]
		t.check(allLocked(s9) && [...s9.values()].some((i) => i.lock?.by === bobState.pid), '[B] (9) jedes lebende Objekt ist gesperrt, mindestens eines von bob', [...s9.values()].map((i) => [i.id.slice(-4), i.lock?.by ?? null]))
		const empty = { x: 800, y: 420 }
		const eb = await screenOf(pb, empty.x, empty.y)
		t.must(await canvasAt(pb, eb.x, eb.y), '[D] (9) bobs Punkt auf der leeren Fläche liegt frei auf der Leinwand', eb)
		await pb.mouse.move(eb.x, eb.y)
		await pb.mouse.click(eb.x, eb.y, { button: 'right' })
		t.must(await appears(pb, '[data-knorke-menu=context]', 3000), '[D] (9) bobs Board-Menü ist offen')
		t.must((await pb.locator('[data-knorke-menu=context]').first().getAttribute('data-knorke-menu-target')) === '', '[D] (9) bobs Menü ist das Board-Menü (kein Ziel)')
		t.check(await pb.locator('[data-knorke-menu-item=unlock-all]').count() === 0, '[C] (9) bobs Board-Menü hat kein [data-knorke-menu-item=unlock-all]')
		await pb.keyboard.press('Escape')
		await until(async () => !(await pb.locator('[data-knorke-menu=context]').first().isVisible().catch(() => false)), { timeout: 2000 })
		const ea = await screenOf(pa, empty.x, empty.y)
		t.must(await canvasAt(pa, ea.x, ea.y), '[D] (9) alices Punkt auf der leeren Fläche liegt frei auf der Leinwand', ea)
		await pa.mouse.move(ea.x, ea.y)
		await pa.mouse.click(ea.x, ea.y, { button: 'right' })
		t.must(await appears(pa, '[data-knorke-menu-item=unlock-all]', 3000), '[C] (9) alices Board-Menü zeigt [data-knorke-menu-item=unlock-all]')
		await pa.locator('[data-knorke-menu-item=unlock-all]').first().click()
		t.check(await appears(pa, '[data-knorke-toast=unlock-all]', 3000), '[C] (9) der Toast [data-knorke-toast=unlock-all] erscheint')
		await settle([pa, pb])
		let s9b = await serverMap('alice', board)
		await until(async () => [...(s9b = await serverMap('alice', board)).values()].every((i) => i.lock === null), { timeout: 5000 })
		t.check(s9b.size === live9.length && [...s9b.values()].every((i) => i.lock === null), '[B] (9) beim Server sind alle Objekte entsperrt (lock = null)', [...s9b.values()].map((i) => [i.id.slice(-4), i.lock]))
		t.check(await until(async () => ((await K.scene(pb))?.locks ?? -1) === 0, { timeout: 5000 }), '[S] (9) bobs Szene malt kein Schloss mehr (scene().locks = 0)', await K.scene(pb))
		const alicePid = (await K.state(pa)).pid
		await pa.locator(CANVAS).first().focus()
		await pa.keyboard.press('Control+z')
		await settle([pa, pb])
		let s9c = await serverMap('alice', board)
		await until(async () => [...(s9c = await serverMap('alice', board)).values()].every((i) => i.lock?.by === alicePid), { timeout: 5000 })
		t.check(sameIds([...s9c.keys()], live9) && [...s9c.values()].every((i) => i.lock?.by === alicePid), '[B] (9) nach Strg+Z sind dieselben Objekte gesperrt, jetzt mit lock.by = alices pid', [...s9c.values()].map((i) => [i.id.slice(-4), i.lock?.by ?? null]))

		t.step('(10) alice: „Unlock all locked by …“ auf A hebt nur bobs Sperren auf; im Inneren von F bietet das Board-Menü „Unlock all in this frame“')
		const locks10 = (s) => [...s.values()].map((i) => [i.id.slice(-4), i.lock?.by ?? null])
		/** every live item but `except` carries alice's lock */
		const restAlice = (s, except) => [...s.values()].filter((i) => !except.includes(i.id)).every((i) => i.lock?.by === alicePid)
		const r10a = await seedOps('alice', board, [A, C].map((id) => ({ o: 'patch', id, p: { lock: null } })))
		t.must(r10a.every((x) => x === 'ok'), '[B] (10) Vorbedingung: alice entsperrt A und C über die API', r10a)
		const r10b = await seedOps('bob', board, [lockOp(A), lockOp(C)])
		t.must(r10b.every((x) => x === 'ok'), '[B] (10) Vorbedingung: bob sperrt A und C über die API', r10b)
		const s10 = await serverMap('alice', board)
		t.must([A, C].every((id) => s10.get(id)?.lock?.by === bobState.pid), '[B] (10) A und C tragen lock.by = bobs pid', locks10(s10))
		t.must(s10.get(F)?.lock?.by === alicePid && restAlice(s10, [A, C]), '[B] (10) F und die übrigen lebenden Objekte tragen lock.by = alices pid', locks10(s10))
		t.must(await until(async () => (await lockIn(pa, A))?.by === bobState.pid && (await lockIn(pa, C))?.by === bobState.pid, { timeout: 8000 }), '[D] (10) alices Client kennt bobs Sperren auf A und C', [await lockIn(pa, A), await lockIn(pa, C)])
		await pa.locator(CANVAS).first().focus()
		await pa.keyboard.press('Escape')
		// the toast of (9) carries the same hook: wait until it has gone
		t.must(await until(async () => (await pa.locator('[data-knorke-toast=unlock-all]').count()) === 0, { timeout: 8000 }), '[D] (10) der Toast unlock-all aus (9) ist verschwunden')
		const c10 = await centerOf(pa, A)
		await pa.mouse.move(c10.x, c10.y)
		await pa.mouse.click(c10.x, c10.y, { button: 'right' })
		t.must(await appears(pa, '[data-knorke-menu=context]', 3000), '[D] (10) alices Menü ist offen')
		t.must((await pa.locator('[data-knorke-menu=context]').first().getAttribute('data-knorke-menu-target')) === A, '[D] (10) das Menü hat das Ziel A', await pa.locator('[data-knorke-menu=context]').first().getAttribute('data-knorke-menu-target'))
		t.must(await appears(pa, '[data-knorke-menu-item=unlock-by]', 3000), '[C] (10) [data-knorke-menu-item=unlock-by] ist sichtbar')
		const byText = (await pa.locator('[data-knorke-menu-item=unlock-by]').first().innerText().catch(() => '')).trim()
		t.check(byText.includes(bobName), `[C] (10) der Eintrag nennt bobs Anzeigenamen (${bobName})`, byText)
		await pa.locator('[data-knorke-menu-item=unlock-by]').first().click()
		t.check(await appears(pa, '[data-knorke-toast=unlock-all]', 3000), '[C] (10) der Toast [data-knorke-toast=unlock-all] erscheint')
		await settle([pa, pb])
		let s10b = await serverMap('alice', board)
		await until(async () => {
			s10b = await serverMap('alice', board)
			return [A, C].every((id) => s10b.get(id)?.lock === null)
		}, { timeout: 5000 })
		t.check([A, C].every((id) => s10b.get(id)?.lock === null) && s10b.get(F)?.lock?.by === alicePid && restAlice(s10b, [A, C]),
			'[B] (10) A und C sind entsperrt, jedes andere Objekt trägt weiter alices pid, F eingeschlossen', locks10(s10b))
		const inF = await screenOf(pa, 1300, 400)
		t.must(await canvasAt(pa, inF.x, inF.y), '[D] (10) der Punkt im Inneren von F liegt frei auf der Leinwand', inF)
		await pa.mouse.move(inF.x, inF.y)
		await pa.mouse.click(inF.x, inF.y, { button: 'right' })
		t.must(await appears(pa, '[data-knorke-menu=context]', 3000), '[D] (10) alices Board-Menü ist offen')
		t.must((await pa.locator('[data-knorke-menu=context]').first().getAttribute('data-knorke-menu-target')) === '', '[D] (10) das Menü im Inneren von F ist das Board-Menü (kein Ziel)')
		const names10 = await pa.locator('[data-knorke-menu=context] [data-knorke-menu-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
		t.must(names10.slice(-2).join(',') === 'unlock-frame,unlock-all', '[C] (10) die letzten beiden Einträge sind unlock-frame und unlock-all, in dieser Reihenfolge', names10)
		await pa.locator('[data-knorke-menu-item=unlock-frame]').first().click()
		await settle([pa, pb])
		let s10c = await serverMap('alice', board)
		await until(async () => (s10c = await serverMap('alice', board)).get(F)?.lock === null, { timeout: 5000 })
		t.check(s10c.get(F)?.lock === null, '[B] (10) F ist entsperrt (lock = null)', s10c.get(F)?.lock)
		const kept = [...s10c.values()].filter((i) => ![A, C, F].includes(i.id))
		t.check(kept.length > 0 && kept.every((i) => i.lock?.by === alicePid), '[B] (10) jedes andere Objekt, das alice gesperrt hatte, bleibt gesperrt', locks10(s10c))
		await world.drop(bob)
		await world.drop(alice)
	},
}

/** Same ids, any order. */
function sameIds(a, b) {
	return a.length === b.length && b.every((x) => a.includes(x))
}

/**
 * The phone pass of E41: a long locker name in the badge, cut and in the
 * viewport; Unlock finger-sized.
 */
export const E41_PHONE = {
	id: 'E41',
	pass: `${PHONE.width}x${PHONE.height}`,
	title: `Sperren bei ${PHONE.width} × ${PHONE.height}: ein Sperrender mit ${E41_NAME_LEN} Zeichen langem Namen – das Etikett liegt im Viewport und ist gekürzt, Unlock ist mindestens 44 × 44 px`,
	async run(t, world) {
		const board = await world.board('E41 Sperren Handy')
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, data: { text: 'N' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N', res)
		const L = await linkToken(board)
		const jr = await api('bob', 'POST', `/api/v1/links/${L}/join`)
		t.must(jr.status === 200, '[D] bob tritt über den Bearbeitungslink bei (API)', { status: jr.status, body: jr.text.slice(0, 200) })
		const snap = await api('bob', 'GET', `/api/v1/boards/${board}/snapshot`)
		const before = snap.data?.me?.name
		t.must(typeof before === 'string' && before !== '', '[D] bobs Anzeigename vorher', before)
		const long = ('Bartholomew Benedikt Bernhardsson-Brandenburger von Berg und Bach').slice(0, E41_NAME_LEN).padEnd(E41_NAME_LEN, 'x')
		try {
			const set = await setDisplayName('bob', long)
			t.must(set.status === 200, `[D] bobs Anzeigename ist ${E41_NAME_LEN} Zeichen lang (Provisioning-API)`, set)
			const lr = await seedOps('bob', board, [lockOp(N)])
			t.must(lr[0] === 'ok', '[B] bob sperrt N über die API', lr)
			const s = await serverMap('alice', board)
			t.check(s.get(N)?.lock?.name === long, `[B] lock.name ist der ${E41_NAME_LEN} Zeichen lange Name`, s.get(N)?.lock)
		} finally {
			const back = await setDisplayName('bob', before)
			t.check(back.status === 200, '[D] bobs Anzeigename ist wieder der alte', back)
		}
		const a = await world.actor(`alice-sperren-${PHONE.width}`, { user: 'alice', viewport: PHONE })
		const p = a.page
		await openBoard(a, board)
		await p.locator(CANVAS).first().focus()
		await p.keyboard.press('Shift+Digit1')
		await K.waitIdle(p)
		await selectItem(p, N)
		t.must(await appears(p, '[data-knorke-lock-badge=name]', 3000), '[C] das Etikett [data-knorke-lock-badge=name] ist sichtbar')
		const m = await p.locator('[data-knorke-lock-badge=name]').first().evaluate((el) => {
			const r = el.getBoundingClientRect()
			return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
				scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, title: el.getAttribute('title'), text: el.textContent }
		})
		t.check(m.left >= 0 && m.top >= 0 && m.right <= m.vw && m.bottom <= m.vh, '[C] das Etikett liegt ganz im Viewport', m)
		t.check(m.scrollWidth > m.clientWidth, '[C] das Etikett ist gekürzt (scrollWidth > clientWidth)', { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth })
		t.check(typeof m.title === 'string' && m.title.includes(long), '[C] der volle Text steht im title', m.title)
		const ub = await p.locator('[data-knorke-action=unlock]').first().boundingBox()
		t.check(ub && ub.width >= 44 && ub.height >= 44, '[C] [data-knorke-action=unlock] ist mindestens 44 × 44 CSS-px groß', ub)
		await world.drop(a)
	},
}
