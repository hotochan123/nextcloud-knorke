/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Template suggestions (factory job 182).
 *
 * E72 bob (his own board "E72 Bob": a frame with a child note and a note N),
 * alice (an empty board "E72 Vorlagen" of the world, its edit link for the
 * guest Gina) and the admin (a board of their own with one note; bob's and
 * the admin's boards are deleted by them at the end), Chromium 1440 × 900 at
 * 100 %. Steps:
 *   (a) bob suggests his board through "⋯" → save-template ("Suggest as
 *       template…", the name field prefilled with the board title) as A with
 *       a note to the admins (the info template-suggested, the canvas
 *       focused) and through the context menu of N (save-template right
 *       after export-csv) the note as B (Enter sends); the server keeps both
 *       pending, A with its note;
 *   (b) bob's "Insert template…": the 4 built-in tiles, then A and B as
 *       cards with "Waiting for approval", no buttons, a click inserts
 *       nothing; route 30 on A is 404; the withdraw button of B asks first
 *       ([data-knorke-dialog=template-withdraw], the insert dialog gone),
 *       then the insert dialog comes back without B;
 *   (c) the admin's OCS notification list holds "Bob Berg suggested the
 *       template E72 A"; /settings/admin/knorke shows A with the note and
 *       "by Bob Berg"; "Adopt" moves A to "Adopted templates" (the focus on
 *       the heading of the suggestions), the admin's notification of A is
 *       gone and bob's OCS list says it was adopted;
 *   (d) alice's dialog shows A after the 4 tiles; a click picks it (job
 *       237: marked, no item yet), "Insert" inserts its 3 items selected,
 *       the canvas focused; Ctrl+Z takes them away;
 *   (e) the admin's "⋯" says "Save as template…" (template-save, no note
 *       field) and saves the admin board as C at once (the info
 *       template-saved); alice sees C right away; in the settings the admin
 *       renames A to A2 (Enter) and deletes C after the question; alice
 *       sees A2 and no C;
 *   (f) the admin rejects bob's suggestion D after the question; D is gone
 *       for bob and bob's OCS list says it was not adopted;
 *   (g) Gina (edit link) has no save-template and exactly the 4 built-in
 *       tiles, without a load state.
 * Templates belong to the instance: the case deletes every template and
 * suggestion (route 34 and 32 as the admin) before it starts and in its
 * `finally`. Own boards, no instance setting: before E09, directly after
 * E71 (job 184's). Flake gate: --only E72 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell and
 * session (menus, dialogs, tiles, the admin section, items, selection,
 * focus, toasts), [B] the server (routes, notifications), [D] a harness
 * precondition. Waiting polls from Node with until() (Nextcloud's CSP,
 * ENTWICKLUNG trap 9.10).
 */
import { BASE, ENV, K, action, api, centerOf, createBoard, field, itemMap, openBoard, passOf, put, seedOps, serverMap, ulid, until, sleep, waitReady, APP, canvasFocused, openAdminSection } from '../lib/harness.mjs'
import { BOARD_MENUS, menuAction } from '../lib/moderation.mjs'

/** The camera the actors open with: world (0, 0) 300 px right of and 250 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -300, y: -250, scale: 1 })
export const TITLE = 'E72 Vorlagen'
export const BOB_TITLE = 'E72 Bob'
export const NAME_A = 'E72 A'
export const NAME_A2 = 'E72 A2'
export const NAME_B = 'E72 B'
export const NAME_C = 'E72 C'
export const NAME_D = 'E72 D'
export const NOTE_A = 'E72 Gut für Retros'
/** Items of bob's board: the frame, its child and N. */
export const N_ITEMS = 3
const DIALOG = '[data-knorke-dialog=templates]'
const SUGGEST = '[data-knorke-dialog=template-suggest]'
const SAVE = '[data-knorke-dialog=template-save]'
const WITHDRAW = '[data-knorke-dialog=template-withdraw]'
const MENU = '[data-knorke-menu=context]'
const BUILTIN = '[data-knorke-template]'
const OWN = '[data-knorke-own-template]'
const PENDING = '[data-knorke-pending-template]'
const ADMIN = '[data-knorke-admin=templates]'

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** Route 28 as `user` (null when the call fails). */
async function listOf(user) {
	const r = await api(user, 'GET', '/api/v1/templates')
	return r.status === 200 && r.data ? r.data : null
}

/** The adopted template named `name` that `user` sees, null without one. */
async function adoptedOf(user, name) {
	return (await listOf(user))?.templates?.find((e) => e.name === name) ?? null
}

/** The own open suggestion named `name` of `user`, null without one. */
async function pendingOf(user, name) {
	return (await listOf(user))?.pending?.find((e) => e.name === name) ?? null
}

/** Deletes every template and suggestion of the instance (routes 34 and 32 as the admin). */
async function cleanup() {
	const r = await api(ENV.admin.user, 'GET', '/api/v1/templates/review')
	for (const e of [...(r.data?.suggestions ?? []), ...(r.data?.templates ?? [])]) {
		await api(ENV.admin.user, 'DELETE', `/api/v1/templates/${e.id}`).catch(() => null)
	}
}

/** The Knorke notifications about templates in `user`'s OCS list ({subject, object_id, link}); null when the list fails. */
async function notificationsOf(user) {
	const r = await fetch(`${BASE}/ocs/v2.php/apps/notifications/api/v2/notifications?format=json`, {
		headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${passOf(user)}`).toString('base64'), 'OCS-APIRequest': 'true', Accept: 'application/json' },
	})
	const text = await r.text()
	let data = null
	try { data = JSON.parse(text) } catch { /* not JSON */ }
	return r.status === 200 && Array.isArray(data?.ocs?.data)
		? data.ocs.data.filter((n) => n.app === 'knorke' && n.object_type === 'template').map((n) => ({ subject: n.subject, object_id: String(n.object_id), link: n.link }))
		: null
}

/** The notification of `user` about template `id`, null without one. */
async function noteOf(user, id) {
	return (await notificationsOf(user))?.find((n) => n.object_id === String(id)) ?? null
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const count = (page, sel) => page.locator(sel).count().catch(() => -1)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const textOf = (page, sel) => page.locator(sel).first().innerText().then((s) => s.trim()).catch(() => null)
/** The tiles of the open template dialog in order: the built-in keys, "own:<id>" and "pending:<id>". */
const tiles = (page) => page.locator(`${DIALOG} ${BUILTIN}, ${DIALOG} ${OWN}, ${DIALOG} ${PENDING}`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-template')
	?? (e.hasAttribute('data-knorke-own-template') ? 'own:' + e.getAttribute('data-knorke-own-template') : 'pending:' + e.getAttribute('data-knorke-pending-template')))).catch(() => [])
/** data-knorke-templates-state of the open dialog (null: none). */
const stateOf = (page) => page.locator(DIALOG).first().getAttribute('data-knorke-templates-state').catch(() => 'missing')

/** Opens the template dialog through "⋯" and waits for its list (accounts). */
async function openTemplates(page, { own = true } = {}) {
	await menuAction(page, 'insert-template', { menus: BOARD_MENUS })
	if (!(await until(() => visible(page, DIALOG), { timeout: 5000 }))) return false
	return own ? (await until(async () => (await stateOf(page)) === 'ready', { timeout: 8000 })) === true : true
}

/** Closes an open template dialog with Esc. */
async function closeTemplates(page) {
	await page.keyboard.press('Escape')
	await until(async () => !(await visible(page, DIALOG)), { timeout: 3000 })
}

/** Opens (or reloads) the Knorke admin section and waits for its lists; (job 281) opens the section "Templates". */
async function openAdmin(page) {
	await page.goto(`${BASE}/index.php/settings/admin/knorke`, { waitUntil: 'domcontentloaded' })
	const ready = (await until(async () => (await page.locator(ADMIN).first().getAttribute('data-knorke-admin-templates-state').catch(() => null)) === 'ready', { timeout: 20000 })) === true
	return ready && openAdminSection(page, 'templates')
}

export const E72 = {
	id: 'E72',
	title: 'Vorlagen vorschlagen (Job 182): bob schlägt über „⋯“ sein Board als A mit Satz vor und über das Kontextmenü eine Notiz als B; beide warten auf Freigabe, B zieht er zurück; der Admin wird benachrichtigt, übernimmt A in den Einstellungen, bob erfährt es; alice fügt A ein und nimmt es mit Strg+Z zurück; der Admin speichert C direkt, benennt A um, löscht C und lehnt D ab; Gina sieht genau 4 Kacheln',
	async run(t, world) {
		await cleanup()
		const board = await world.board(TITLE)
		// bob's and the admin's own boards: created and deleted here by their owners (the world deletes as alice)
		const own = await createBoard('bob', BOB_TITLE)
		const adminBoard = await createBoard(ENV.admin.user, 'E72 Admin')
		const token = await linkToken(board)
		const F = ulid()
		const C = ulid()
		const N = ulid()
		const res = await seedOps('bob', own, [
			put.frame(F, { x: 0, y: 0, w: 400, h: 300, data: { title: 'E72 Rahmen' } }),
			put.sticky(C, { x: 40, y: 60, parent: F, data: { text: 'E72 Kind' } }),
			put.sticky(N, { x: 600, y: 0, data: { text: 'E72 Notiz' }, style: { fill: '#a8d8f8' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Frame mit Kind und Notiz N auf bobs Board gesät', res)
		const resAdmin = await seedOps(ENV.admin.user, adminBoard, [put.sticky(ulid(), { x: 0, y: 0, data: { text: 'E72 Admin-Notiz' } })])
		t.must(resAdmin.every((x) => x === 'ok'), '[B] Vorbedingung: eine Notiz auf dem Board des Admins', resAdmin)
		const a = await world.actor('alice-tpl', { user: 'alice' })
		const b = await world.actor('bob-tpl', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		let g = null
		let ad = null
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			await storeCamera(pb, own, CAM)
			await openBoard(b, own)
			t.must((await K.state(pa)).uiMode === 'edit' && (await itemMap(pa)).size === 0, '[D] Vorbedingung: alice im Modus edit auf ihrem leeren Board', await K.state(pa))
			t.must((await K.state(pb)).uiMode === 'edit' && (await itemMap(pb)).size === N_ITEMS, '[D] Vorbedingung: bob im Modus edit, 3 Objekte', (await itemMap(pb)).size)

			t.step('(a) bob schlägt das Board als A mit Satz vor und die Notiz N als B')
			await menuAction(pb, 'save-template', { menus: BOARD_MENUS })
			t.must(await until(() => visible(pb, SUGGEST), { timeout: 5000 }), '[C] (a) „⋯“ → save-template öffnet [data-knorke-dialog=template-suggest]')
			const prefill = await pb.locator(`${SUGGEST} [data-knorke-template-name]`).first().inputValue().catch(() => null)
			t.check(prefill === BOB_TITLE, '[C] (a) das Namensfeld trägt den Boardtitel', prefill)
			t.check((await count(pb, `${SUGGEST} [data-knorke-template-note]`)) === 1, '[C] (a) das Feld für den Satz an die Admins ist da')
			await pb.locator(`${SUGGEST} [data-knorke-template-name]`).first().fill(NAME_A)
			await pb.locator(`${SUGGEST} [data-knorke-template-note]`).first().fill(NOTE_A)
			t.check((await textOf(pb, `${SUGGEST} [data-knorke-action=template-save]`)) === 'Suggest', '[C] (a) der Knopf heißt „Suggest“', await textOf(pb, `${SUGGEST} [data-knorke-action=template-save]`))
			await pb.locator(`${SUGGEST} [data-knorke-action=template-save]`).first().click()
			t.check(await until(async () => !(await visible(pb, SUGGEST)), { timeout: 8000 }), '[C] (a) „Suggest“ schließt den Dialog')
			t.check(await until(() => visible(pb, '[data-knorke-toast=template-suggested]'), { timeout: 5000 }), '[C] (a) die Info template-suggested erscheint')
			t.check(await until(() => canvasFocused(pb), { timeout: 3000 }), '[C] (a) die Zeichenfläche hat den Fokus')
			const eA = await until(() => pendingOf('bob', NAME_A), { timeout: 5000 })
			t.must(!!eA && eA.note === NOTE_A, '[B] (a) A wartet bei bob, mit dem Satz', eA)

			const pN = await centerOf(pb, N)
			await pb.mouse.click(pN.x, pN.y, { button: 'right' })
			t.must(await until(() => visible(pb, MENU), { timeout: 3000 }), '[C] (a) das Kontextmenü öffnet sich auf N')
			const entries = await pb.locator(`${MENU} [data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			t.check(entries[entries.indexOf('export-csv') + 1] === 'save-template', '[C] (a) save-template direkt nach export-csv', entries)
			t.check(((await textOf(pb, `${MENU} [data-knorke-menu-item=save-template]`)) ?? '').includes('Suggest as template…'), '[C] (a) der Eintrag heißt „Suggest as template…“')
			await pb.locator(`${MENU} [data-knorke-menu-item=save-template]`).first().click()
			t.must(await until(() => visible(pb, SUGGEST), { timeout: 5000 }), '[C] (a) save-template im Kontextmenü öffnet den Dialog')
			const nameB = pb.locator(`${SUGGEST} [data-knorke-template-name]`).first()
			await nameB.fill(NAME_B)
			await nameB.press('Enter')
			t.check(await until(async () => !(await visible(pb, SUGGEST)), { timeout: 8000 }), '[C] (a) Enter sendet und schließt den Dialog')
			const eB = await until(() => pendingOf('bob', NAME_B), { timeout: 5000 })
			t.must(!!eB && eB.note === null, '[B] (a) B wartet bei bob, ohne Satz', eB)

			t.step('(b) bob: 4 eingebaute Kacheln, dann A und B als wartende Karten; B zurückziehen')
			t.must(await openTemplates(pb), '[C] (b) bobs Dialog lädt (data-knorke-templates-state=ready)')
			const list = await tiles(pb)
			t.check(same(list, ['retro', 'swot', 'kanban', 'brainstorm', 'pending:' + eB.id, 'pending:' + eA.id]), '[C] (b) die 4 eingebauten Kacheln, dann B und A (neueste zuerst)', list)
			t.check(((await textOf(pb, `${DIALOG} [data-knorke-pending-template="${eA.id}"]`)) ?? '').includes('Waiting for approval'), '[C] (b) A zeigt „Waiting for approval“')
			const tags = await pb.locator(`${DIALOG} ${PENDING}`).evaluateAll((els) => els.map((e) => [e.tagName, e.getAttribute('tabindex')]))
			t.check(tags.length === 2 && tags.every(([tag, ti]) => tag === 'DIV' && ti === null), '[C] (b) die Karten sind keine Knöpfe und nicht fokussierbar', tags)
			await pb.locator(`${DIALOG} [data-knorke-pending-template="${eA.id}"]`).first().click()
			await sleep(400)
			t.check((await visible(pb, DIALOG)) && (await itemMap(pb)).size === N_ITEMS, '[C] (b) ein Klick auf A fügt nichts ein, der Dialog bleibt', (await itemMap(pb)).size)
			t.check((await api('bob', 'GET', `/api/v1/templates/${eA.id}`)).status === 404, '[B] (b) Route 30 auf A: 404')
			const wb = pb.locator(`${DIALOG} [data-knorke-template-withdraw="${eB.id}"]`).first()
			const box = await wb.boundingBox().catch(() => null)
			t.check(!!box && box.width >= 44 && box.height >= 44, '[C] (b) der Zurückziehen-Knopf ist mindestens 44 × 44 px', box)
			t.check((await wb.getAttribute('aria-label').catch(() => null)) === `Withdraw suggestion “${NAME_B}”`, '[C] (b) sein Name nennt B', await wb.getAttribute('aria-label').catch(() => null))
			await wb.click()
			t.must(await until(() => visible(pb, WITHDRAW), { timeout: 5000 }), '[C] (b) der Knopf fragt nach [data-knorke-dialog=template-withdraw]')
			t.check(!(await visible(pb, DIALOG)), '[C] (b) der Einfüge-Dialog ist weg (nie zwei Dialoge)')
			await pb.locator(`${WITHDRAW} [data-knorke-action=confirm]`).first().click()
			t.check(await until(async () => (await visible(pb, DIALOG)) && (await stateOf(pb)) === 'ready' && same(await tiles(pb), ['retro', 'swot', 'kanban', 'brainstorm', 'pending:' + eA.id]), { timeout: 8000 }),
				'[C] (b) der Einfüge-Dialog kommt ohne B zurück', await tiles(pb))
			t.check((await pendingOf('bob', NAME_B)) === null, '[B] (b) B ist zurückgezogen')
			await closeTemplates(pb)

			t.step('(c) der Admin wird benachrichtigt und übernimmt A in den Einstellungen; bob erfährt es')
			const nA = await until(() => noteOf(ENV.admin.user, eA.id), { timeout: 8000 })
			t.check(nA?.subject === `Bob Berg suggested the template ${NAME_A}`, '[B] (c) die OCS-Liste des Admins enthält A', nA)
			t.check(typeof nA?.link === 'string' && nA.link.endsWith('/settings/admin/knorke'), '[B] (c) der Link führt in den Abschnitt Knorke', nA?.link)
			ad = await world.actor('admin-tpl', { user: ENV.admin.user })
			const pd = ad.page
			t.must(await openAdmin(pd), '[C] (c) /settings/admin/knorke: [data-knorke-admin=templates] geladen')
			const rowA = `${ADMIN} [data-knorke-suggestion="${eA.id}"]`
			const textA = (await textOf(pd, rowA)) ?? ''
			t.check(textA.includes(NAME_A) && textA.includes(NOTE_A) && textA.includes('by Bob Berg'), '[C] (c) A steht mit Satz und „by Bob Berg“ bei den Vorschlägen', textA)
			await pd.locator(`${rowA} [data-knorke-action=template-adopt]`).first().click()
			t.check(await until(async () => (await count(pd, rowA)) === 0 && (await count(pd, `${ADMIN} [data-knorke-adopted="${eA.id}"]`)) === 1, { timeout: 8000 }), '[C] (c) „Adopt“ verschiebt A zu den übernommenen Vorlagen')
			t.check(await until(() => pd.evaluate(() => document.activeElement?.getAttribute('data-knorke-admin-heading')).then((h) => h === 'suggestions').catch(() => false), { timeout: 3000 }), '[C] (c) der Fokus steht auf der Überschrift der Vorschläge')
			t.check(await until(async () => (await noteOf(ENV.admin.user, eA.id)) === null, { timeout: 8000 }), '[B] (c) die Benachrichtigung des Admins zu A ist erledigt')
			const nBob = await until(() => noteOf('bob', eA.id), { timeout: 8000 })
			t.check(nBob?.subject === `Your template ${NAME_A} was adopted. Everyone can now insert it.`, '[B] (c) bobs OCS-Liste meldet die Übernahme', nBob)

			t.step('(d) alice sieht A nach den 4 Kacheln, fügt es ausgewählt ein, Strg+Z')
			t.must(await openTemplates(pa), '[C] (d) alices Dialog lädt')
			const la = await tiles(pa)
			t.check(same(la, ['retro', 'swot', 'kanban', 'brainstorm', 'own:' + eA.id]), '[C] (d) A folgt den 4 eingebauten Kacheln', la)
			t.check((await textOf(pa, `${DIALOG} [data-knorke-own-template="${eA.id}"]`)) === NAME_A, '[C] (d) die Kachel trägt nur den Namen, kein „by“', await textOf(pa, `${DIALOG} [data-knorke-own-template="${eA.id}"]`))
			await pa.locator(`${DIALOG} [data-knorke-own-template="${eA.id}"]`).first().click()
			// job 237: the click only picks, "Insert" inserts
			t.check(await until(async () => (await pa.locator(`${DIALOG} [data-knorke-own-template="${eA.id}"]`).first().getAttribute('data-knorke-picked').catch(() => null)) === 'true', { timeout: 3000 }), '[C] (d) der Klick wählt A (Job 237)')
			await sleep(800)
			t.check(await visible(pa, DIALOG) && (await itemMap(pa)).size === 0, '[C] (d) der Klick fügt nichts ein, der Dialog bleibt offen (Job 237)', (await itemMap(pa)).size)
			await pa.locator(`${DIALOG} [data-knorke-action=confirm]`).first().click()
			t.check(await until(async () => !(await visible(pa, DIALOG)), { timeout: 5000 }), '[C] (d) „Insert“ schließt den Dialog')
			t.check(await until(async () => (await itemMap(pa)).size === N_ITEMS, { timeout: 8000 }), '[C] (d) alices Board hat 3 neue Objekte', (await itemMap(pa)).size)
			const got = await itemMap(pa)
			const roots = [...got.values()].filter((it) => it.parent === null).map((it) => it.id).sort()
			t.check(same([...(await K.selection(pa))].sort(), roots), '[C] (d) die neuen Wurzeln sind ausgewählt', { selection: await K.selection(pa), roots })
			const texts = [...got.values()].map((it) => it.data?.text ?? it.data?.title ?? '').sort()
			t.check(same(texts, ['E72 Kind', 'E72 Notiz', 'E72 Rahmen']), '[C] (d) die Texte und der Titel', texts)
			t.check(await until(() => canvasFocused(pa), { timeout: 3000 }), '[C] (d) die Zeichenfläche hat den Fokus')
			t.check(await until(async () => (await serverMap('alice', board)).size === N_ITEMS, { timeout: 8000 }), '[B] (d) der Server hat die 3 Objekte')
			await pa.keyboard.press('Control+z')
			t.check(await until(async () => (await itemMap(pa)).size === 0, { timeout: 5000 }), '[C] (d) Strg+Z: das Board ist wieder leer', (await itemMap(pa)).size)
			t.check(await until(async () => (await serverMap('alice', board)).size === 0, { timeout: 8000 }), '[B] (d) auch auf dem Server')

			t.step('(e) der Admin speichert C direkt; alice sieht C; der Admin benennt A um und löscht C')
			await storeCamera(pd, adminBoard, CAM)
			await openBoard(ad, adminBoard)
			await menuAction(pd, 'save-template', { menus: BOARD_MENUS })
			t.must(await until(() => visible(pd, SAVE), { timeout: 5000 }), '[C] (e) „⋯“ des Admins öffnet [data-knorke-dialog=template-save]')
			t.check((await count(pd, `${SAVE} [data-knorke-template-note]`)) === 0, '[C] (e) kein Feld für einen Satz')
			t.check((await textOf(pd, `${SAVE} [data-knorke-action=template-save]`)) === 'Save', '[C] (e) der Knopf heißt „Save“')
			await pd.locator(`${SAVE} [data-knorke-template-name]`).first().fill(NAME_C)
			await pd.locator(`${SAVE} [data-knorke-action=template-save]`).first().click()
			t.check(await until(() => visible(pd, '[data-knorke-toast=template-saved]'), { timeout: 8000 }), '[C] (e) die Info template-saved erscheint')
			const eC = await until(() => adoptedOf('alice', NAME_C), { timeout: 5000 })
			t.must(!!eC, '[B] (e) C ist sofort übernommen', eC)
			t.must(await openTemplates(pa), '[C] (e) alices Dialog lädt neu')
			t.check((await tiles(pa)).includes('own:' + eC.id), '[C] (e) alice sieht C sofort', await tiles(pa))
			await closeTemplates(pa)
			t.must(await openAdmin(pd), '[C] (e) die Einstellungen des Admins laden neu')
			await pd.locator(`${ADMIN} [data-knorke-adopted="${eA.id}"] [data-knorke-action=template-rename]`).first().click()
			const nameField = pd.locator(`${ADMIN} [data-knorke-adopted="${eA.id}"] [data-knorke-field=template-name]`).first()
			t.must(await until(() => nameField.isVisible().catch(() => false), { timeout: 3000 }), '[C] (e) „Rename“ macht den Namen zum Feld')
			await nameField.fill(NAME_A2)
			await nameField.press('Enter')
			t.check(await until(async () => (await count(pd, `${ADMIN} [data-knorke-field=template-name]`)) === 0 && (await textOf(pd, `${ADMIN} [data-knorke-adopted="${eA.id}"] .knorke-admin-templates__name`)) === NAME_A2, { timeout: 8000 }),
				'[C] (e) Enter speichert den neuen Namen', await textOf(pd, `${ADMIN} [data-knorke-adopted="${eA.id}"]`))
			await pd.locator(`${ADMIN} [data-knorke-adopted="${eC.id}"] [data-knorke-action=template-delete]`).first().click()
			t.must(await until(() => visible(pd, '[data-knorke-dialog=template-delete]'), { timeout: 5000 }), '[C] (e) „Delete“ fragt nach [data-knorke-dialog=template-delete]')
			await pd.locator('[data-knorke-dialog=template-delete] [data-knorke-action=confirm]').first().click()
			t.check(await until(async () => (await count(pd, `${ADMIN} [data-knorke-adopted="${eC.id}"]`)) === 0, { timeout: 8000 }), '[C] (e) C ist aus der Liste verschwunden')
			const la2 = await listOf('alice')
			t.check(same(la2?.templates?.map((e) => e.name), [NAME_A2]), '[B] (e) alice sieht A2 und kein C', la2?.templates)
			t.must(await openTemplates(pa), '[C] (e) alices Dialog lädt neu')
			t.check(same(await tiles(pa), ['retro', 'swot', 'kanban', 'brainstorm', 'own:' + eA.id]) && (await textOf(pa, `${DIALOG} [data-knorke-own-template="${eA.id}"]`)) === NAME_A2, '[C] (e) in alices Dialog A2 und kein C', await tiles(pa))
			await closeTemplates(pa)

			t.step('(f) der Admin lehnt bobs Vorschlag D ab; D fehlt danach bei bob')
			const rD = await api('bob', 'POST', '/api/v1/templates', { name: NAME_D, content: JSON.stringify({ knorke: 1, kind: 'board', title: '', origin: [0, 0], items: [{ id: ulid(), t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, parent: null, data: { text: 'E72 D' }, style: {} }] }), sketch: [[4, 4, 112, 72, '#fff6b6']] })
			t.must(rD.status === 201 && rD.data?.state === 'pending', '[B] (f) Vorbedingung: bob schlägt D vor', { status: rD.status, data: rD.data })
			const idD = rD.data.id
			t.must(await openAdmin(pd), '[C] (f) die Einstellungen laden neu')
			await pd.locator(`${ADMIN} [data-knorke-suggestion="${idD}"] [data-knorke-action=template-reject]`).first().click()
			t.must(await until(() => visible(pd, '[data-knorke-dialog=template-reject]'), { timeout: 5000 }), '[C] (f) „Reject“ fragt nach [data-knorke-dialog=template-reject]')
			await pd.locator('[data-knorke-dialog=template-reject] [data-knorke-action=confirm]').first().click()
			t.check(await until(async () => (await count(pd, `${ADMIN} [data-knorke-suggestion="${idD}"]`)) === 0, { timeout: 8000 }), '[C] (f) D ist aus den Vorschlägen verschwunden')
			t.check((await pendingOf('bob', NAME_D)) === null, '[B] (f) D fehlt bei bob')
			const nD = await until(() => noteOf('bob', idD), { timeout: 8000 })
			t.check(nD?.subject === `Your template suggestion ${NAME_D} was not adopted.`, '[B] (f) bobs OCS-Liste meldet die Ablehnung', nD)

			t.step('(g) Gina (Bearbeiten-Link): kein Eintrag, genau 4 Kacheln')
			g = await world.actor('gina-tpl')
			await g.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
			await storeCamera(g.page, board, CAM)
			await field(g.page, 'guest-name', 'Gina')
			await action(g.page, 'guest-join')
			await waitReady(g.page, 30000)
			const pg = g.page
			t.must((await K.state(pg)).uiMode === 'edit', '[D] (g) Vorbedingung: Gina im Modus edit', await K.state(pg))
			const ginaMenu = pg.locator('[data-knorke-menu=board]').first()
			await ginaMenu.locator('button[aria-haspopup]').first().click()
			// job 228: insert-template stands in the submenu "Insert", save-template would stand on the root
			t.check(await until(() => visible(pg, '[data-knorke-submenu=insert]'), { timeout: 5000 }), '[D] (g) Vorbedingung: Ginas „⋯“ ist offen („Insert ▸“)')
			t.check((await count(pg, '[data-knorke-action=save-template]')) === 0, '[C] (g) Ginas „⋯“ hat kein save-template')
			await pg.keyboard.press('Escape')
			t.must(await openTemplates(pg, { own: false }), '[C] (g) Ginas Vorlagendialog öffnet sich')
			await sleep(800)
			t.check((await count(pg, `${DIALOG} ${BUILTIN}`)) === 4 && (await count(pg, `${DIALOG} ${OWN}`)) === 0 && (await count(pg, `${DIALOG} ${PENDING}`)) === 0,
				'[C] (g) genau die 4 eingebauten Kacheln', { builtin: await count(pg, `${DIALOG} ${BUILTIN}`), own: await count(pg, `${DIALOG} ${OWN}`) })
			t.check((await stateOf(pg)) === null, '[C] (g) für Gäste lädt nichts (kein data-knorke-templates-state)', await stateOf(pg))
			await closeTemplates(pg)
			await sleep(200)
		} finally {
			await cleanup()
			await api('bob', 'DELETE', `/api/v1/boards/${own}`).catch(() => null)
			await api(ENV.admin.user, 'DELETE', `/api/v1/boards/${adminBoard}`).catch(() => null)
			if (ad) await world.drop(ad)
			if (g) await world.drop(g)
			await world.drop(b)
			await world.drop(a)
		}
	},
}
