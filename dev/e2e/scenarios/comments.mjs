/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Comments (factory job 189).
 *
 * E73 alice (owner), the guest Gina (edit link) and bob (shared with "view"),
 * Chromium 1440 × 900 at 100 % with the same camera, on a board of their own
 * with note N at (0, 0), 200 × 200. Steps:
 *   (1) alice selects N, "Comment" in the context bar opens the editor at
 *       N's corner; she types "@bo", picks "Bob Berg" from the @ list and
 *       sends with Enter; the server keeps @"bob" with the mention; Gina
 *       sees the bubble "1" within 5 s;
 *   (2) Gina clicks the bubble and replies; alice sees "2" and
 *       "Gina (guest)" in her thread;
 *   (3) bob's OCS list holds the mention with the link
 *       …/b/<board>?comment=<thread>; the link opens the thread and leaves
 *       the address; bob has neither "New comment" nor a reply field;
 *   (4) alice drags N: the bubble follows during the drag; she deletes N:
 *       the bubble stays at the corner (the server got x/y); Ctrl+Z brings N
 *       back and the bubble hangs on it again (it follows the next drag);
 *   (5) a click on the bubble opens the thread in the comment panel (job
 *       233); "Resolve": the bubble is gone for alice and Gina, the thread stands
 *       under "Resolved (1)"; "Reopen" there brings the bubble back;
 *   (6) a "c" in the reply field hides no cursors;
 *   (7) deleting the first comment asks ([data-knorke-dialog=comment-delete])
 *       and removes the thread for everyone; "Show bubbles" off stays off
 *       after a reload (no bubble for a new thread).
 * E73@820x1180 (AK8): the tablet guest Tina (touch, voting link, a vote
 * runs, so the device only views): the "Comments" button is there; "New
 * comment" closes the list that would cover its hint, whose "Cancel" lies
 * free and ends it (review round 1), and Esc ends it too (review round 2:
 * the canvas takes the focus of the vanished button); "New comment" and a tap on N create a
 * thread, the field keeps the focus after that tap (review round 1, trap
 * 9.46); a tap on its bubble opens it and her votes stay the same. In (2)
 * the popover and its "Send" lie inside the board (review round 1).
 * Own boards, no instance setting: before E09, directly after E72. Flake
 * gate: --only E73 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell and
 * session (bar, panel, thread, bubbles, list), [B] server (stored comments,
 * notifications), [D] a harness precondition. Waiting polls from Node with
 * until() (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import { APP, BASE, CANVAS, K, TABLET, action, api, field, openBoard, passOf, put, seedOps, sleep, ulid, until, waitReady } from '../lib/harness.mjs'

/** The camera of the desktop actors: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** Tina's camera (tablet 820 × 1180): N in view at 100 %. */
const TCAM = Object.freeze({ x: -110, y: -300, scale: 1 })
export const TITLE = 'E73 Kommentare'
const NEW = '[data-knorke-thread="new"]'
const PANEL = '[data-knorke-comments]'

/** Shares a board (route 20 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Turns a link of a board on (API as alice); returns its token. */
async function linkToken(board, kind = 'link') {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/${kind}`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** A guest joins through /p/<token> with `name`, with the camera stored first. */
async function joinAsGuest(actor, token, name, board, cam = CAM) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await storeCamera(actor.page, board, cam)
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

/** __knorke.comments() of a page (null while the hook is missing). */
const comments = (p) => p.evaluate(() => (typeof window.__knorke?.comments === 'function' ? window.__knorke.comments() : null)).catch(() => null)
/** The bubble of a thread on a page ({id, n, x, y}, container px) or null. */
const bubbleOf = async (p, id) => (await comments(p))?.places?.find((b) => b.id === id) ?? null
/** Route 35 as `user`: the threads. */
const serverThreads = async (user, board) => (await api(user, 'GET', `/api/v1/boards/${board}/comments`)).data?.threads ?? null
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const appears = (page, sel, timeout = 5000) => until(() => visible(page, sel), { timeout })
const gone = (page, sel, timeout = 5000) => until(async () => !(await visible(page, sel)), { timeout })
const near = (a, b, tol = 2) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol

/** The Knorke notifications about comments in `user`'s OCS list ({subject, object_type, object_id, link}); null when the list fails. */
async function notificationsOf(user) {
	const r = await fetch(`${BASE}/ocs/v2.php/apps/notifications/api/v2/notifications?format=json`, {
		headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${passOf(user)}`).toString('base64'), 'OCS-APIRequest': 'true', Accept: 'application/json' },
	})
	const text = await r.text()
	let data = null
	try { data = JSON.parse(text) } catch { /* not JSON */ }
	return r.status === 200 && Array.isArray(data?.ocs?.data)
		? data.ocs.data.filter((n) => n.app === 'knorke' && String(n.object_type).startsWith('comment')).map((n) => ({ subject: n.subject, message: n.message, object_type: n.object_type, object_id: String(n.object_id), link: n.link }))
		: null
}

export const E73 = {
	id: 'E73',
	title: 'Kommentare (Job 189): alice kommentiert eine Notiz über „Comment“ mit @bob aus der Liste, Gina sieht die Blase „1“ in ≤ 5 s und antwortet, alice sieht „2“ und „(guest)“; bobs OCS-Liste hat die Erwähnung, ihr Link öffnet den Thread, bob kann nur lesen; die Blase folgt dem Ziehen, bleibt beim Löschen an der Ecke und hängt nach Strg+Z wieder an der Notiz; Resolve und Reopen; ein „c“ im Feld blendet keine Cursor aus; der Thread geht mit Rückfrage, „Show bubbles“ aus bleibt nach dem Neuladen aus',
	async run(t, world) {
		const board = await world.board(TITLE)
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'view' }])
		const L = await linkToken(board)
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: 'E73 Notiz' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N gesät', res)
		const a = await world.actor('alice-cmt', { user: 'alice' })
		const g = await world.actor('gina-cmt')
		const b = await world.actor('bob-cmt', { user: 'bob' })
		const pa = a.page
		const pg = g.page
		const pb = b.page
		try {
			await storeCamera(pa, board, CAM)
			await openBoard(a, board)
			await joinAsGuest(g, L, 'Gina', board)
			const modes = await Promise.all([pa, pg].map((p) => K.state(p).then((s) => s.uiMode ?? null).catch(() => null)))
			t.must(modes[0] === 'edit' && modes[1] === 'edit', '[D] Vorbedingung: alice und Gina im Modus edit', modes)

			t.step('(1) alice: N wählen, „Comment“ in der Leiste, @bob aus der Liste, Enter')
			const n0 = await K.w2s(pa, 100, 100)
			await pa.mouse.click(n0.x, n0.y)
			const bar = pa.locator('[data-knorke-action=comment]').first()
			t.must(await bar.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (1) die Leiste zeigt „Comment“ [data-knorke-action=comment]')
			await bar.click()
			t.must(await appears(pa, NEW), '[C] (1) das Schreibfeld eines neuen Threads [data-knorke-thread=new] ist offen')
			const box = await pa.locator(NEW).first().boundingBox()
			const corner = await K.w2s(pa, 200, 0)
			t.check(!!box && box.x >= corner.x && box.x <= corner.x + 40, '[C] (1) es steht rechts neben Ns oberer rechter Ecke', { box, corner })
			const fieldA = pa.locator(`${NEW} [data-knorke-field=comment]`).first()
			await fieldA.click()
			await pa.keyboard.type('Look @bo', { delay: 20 })
			const pick = pa.locator('[data-knorke-mention-list] [data-knorke-mention="bob"]').first()
			t.must(await pick.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (1) die @-Liste bietet bob an')
			t.check((await pick.innerText()).trim() === 'Bob Berg', '[C] (1) mit seinem Anzeigenamen', await pick.innerText())
			await pick.click()
			t.check((await fieldA.inputValue()) === 'Look @Bob Berg ', '[C] (1) im Feld steht „@Bob Berg “', await fieldA.inputValue())
			await pa.keyboard.type('please check', { delay: 10 })
			await pa.keyboard.press('Enter')
			const T = await until(async () => (await comments(pa))?.threads?.[0]?.id ?? null, { timeout: 8000 })
			t.must(typeof T === 'string', '[C] (1) Enter sendet: alice hat einen Thread', await comments(pa))
			t.check(await appears(pa, `[data-knorke-thread="${T}"]`), '[C] (1) das Feld wird zum Thread an der Blase')
			const st = await serverThreads('alice', board)
			const first = st?.[0]?.comments?.[0]
			t.check(st?.length === 1 && st[0].item === N && first?.raw === 'Look @"bob" please check' && first?.mentions?.bob === 'Bob Berg', '[B] (1) gespeichert: an N, @"bob" mit der Erwähnung', st)
			t.check(JSON.stringify(first?.parts) === JSON.stringify(['Look ', { m: 'Bob Berg' }, ' please check']), '[B] (1) die Teile mit {m: "Bob Berg"}', first?.parts)
			t.check(await until(async () => (await bubbleOf(pg, T))?.n === 1, { timeout: 5000 }), '[C] (1) Gina sieht die Blase „1“ in ≤ 5 s', await comments(pg))
			t.check((await pg.locator(`[data-knorke-bubble="${T}"]`).first().innerText().catch(() => '')).trim() === '1', '[C] (1) Ginas Blase zeigt „1“')

			t.step('(2) Gina antwortet über die Blase; alice sieht „2“ und „(guest)“')
			await pg.locator(`[data-knorke-bubble="${T}"]`).first().click()
			t.must(await appears(pg, `[data-knorke-thread="${T}"]`), '[C] (2) Ginas Klick öffnet den Thread')
			t.check((await pg.locator(`[data-knorke-thread="${T}"] [data-knorke-comment-mention]`).first().innerText().catch(() => '')).trim() === '@Bob Berg', '[C] (2) die Erwähnung steht als „@Bob Berg“ da')
			const fieldG = pg.locator(`[data-knorke-thread="${T}"] [data-knorke-field=comment]`).first()
			await fieldG.click()
			await pg.keyboard.type('Agreed', { delay: 10 })
			await pg.keyboard.press('Enter')
			t.check(await until(async () => (await bubbleOf(pa, T))?.n === 2, { timeout: 5000 }), '[C] (2) alice sieht „2“ in ≤ 5 s', await comments(pa))
			t.check(await until(async () => (await pa.locator(`[data-knorke-thread="${T}"]`).first().innerText().catch(() => '')).includes('Gina (guest)'), { timeout: 3000 }), '[C] (2) alice sieht „Gina (guest)“ in ihrem Thread')
			const popBox = await pa.locator(`[data-knorke-thread="${T}"]`).first().boundingBox()
			const sendBox = await pa.locator(`[data-knorke-thread="${T}"] [data-knorke-action=comment-send]`).first().boundingBox()
			const canvasBox = await pa.locator(CANVAS).first().boundingBox()
			t.check(!!popBox && !!sendBox && !!canvasBox && popBox.y + popBox.height <= canvasBox.y + canvasBox.height && sendBox.y + sendBox.height <= canvasBox.y + canvasBox.height,
				'[C] (2, Runde 1) das Popover und „Send“ liegen ganz im Board', { popBox, sendBox, canvasBox })
			t.check(((await serverThreads('bob', board)) ?? []).every((th) => th.comments.every((c) => c.raw === undefined && !JSON.stringify(c).includes('"bob"'))), '[B] (2) bob (ein anderes Konto) liest keine uid')

			t.step('(3) bob: die Erwähnung in der OCS-Liste, ihr Link öffnet den Thread, bob liest nur')
			const note = await until(async () => (await notificationsOf('bob'))?.find((x) => x.object_type === 'comment') ?? null, { timeout: 8000 })
			t.check(note?.subject === `Alice Adler mentioned you in a comment on ${TITLE}`, '[B] (3) bobs OCS-Liste enthält die Erwähnung', note)
			t.check(note?.message === 'Look @Bob Berg please check', '[B] (3) mit dem Text und @Name', note?.message)
			t.must(typeof note?.link === 'string' && note.link.endsWith(`/b/${board}?comment=${T}`), '[B] (3) der Link geht auf das Board mit ?comment=<thread>', note?.link)
			const link = note.link.replace(/^https?:\/\/[^/]+/, BASE)
			await storeCamera(pb, board, CAM).catch(() => {})
			await pb.goto(link, { waitUntil: 'domcontentloaded' })
			await waitReady(pb)
			t.check(await appears(pb, `[data-knorke-thread="${T}"]`, 8000), '[C] (3) bobs Link öffnet den Thread')
			t.check(await until(() => !pb.url().includes('comment='), { timeout: 3000 }), '[C] (3) danach steht ?comment nicht mehr in der Adresse', pb.url())
			t.check((await pb.locator(`[data-knorke-thread="${T}"] [data-knorke-comment-field]`).count()) === 0, '[C] (3) bob hat kein Antwortfeld')
			await action(pb, 'comments')
			t.must(await appears(pb, PANEL), '[C] (3) bob öffnet die Liste über „Comments“')
			t.check(!(await visible(pb, '[data-knorke-action=comment-new]')), '[C] (3) bob hat kein „New comment“')

			t.step('(4) alice: N ziehen, die Blase folgt; N löschen, die Blase bleibt; Strg+Z, die Blase hängt wieder an N')
			await pa.locator(`[data-knorke-thread="${T}"] [data-knorke-action=comment-close]`).first().click()
			const b0 = await bubbleOf(pa, T)
			const c0 = await K.w2s(pa, 100, 100)
			await pa.mouse.move(c0.x, c0.y)
			await pa.mouse.down()
			for (let i = 1; i <= 10; i++) {
				await pa.mouse.move(c0.x + 15 * i, c0.y)
				await sleep(16)
			}
			const mid = await until(async () => {
				const x = await bubbleOf(pa, T)
				return near(x, { x: b0.x + 150, y: b0.y }) ? x : null
			}, { timeout: 2000 })
			t.check(!!mid, '[C] (4) während des Ziehens folgt die Blase (150 px)', { before: b0, now: await bubbleOf(pa, T) })
			await pa.mouse.up()
			t.must(await until(async () => (await K.items(pa)).some((s) => JSON.parse(s).id === N && JSON.parse(s).x === 150), { timeout: 3000 }), '[D] (4) N steht bei x 150')
			await sleep(400)
			const b1 = await bubbleOf(pa, T)
			await pa.locator(CANVAS).first().focus()
			const n1 = await K.w2s(pa, 250, 100)
			await pa.mouse.click(n1.x, n1.y)
			await pa.keyboard.press('Delete')
			t.must(await until(async () => !(await K.items(pa)).some((s) => JSON.parse(s).id === N), { timeout: 3000 }), '[C] (4) N ist gelöscht')
			await sleep(500)
			t.check(near(await bubbleOf(pa, T), b1), '[C] (4) die Blase bleibt an Ns letzter Ecke', { was: b1, now: await bubbleOf(pa, T) })
			t.check(await until(async () => {
				const th = (await serverThreads('alice', board))?.[0]
				return th && th.x === 350 && th.y === 0 && th.item === N
			}, { timeout: 5000 }), '[B] (4) der Server hat x 350, y 0 bekommen, item bleibt N', await serverThreads('alice', board))
			t.check(await until(async () => near(await bubbleOf(pg, T), b1, 4) || (await bubbleOf(pg, T)) !== null, { timeout: 5000 }), '[C] (4) Gina sieht die Blase weiter', await bubbleOf(pg, T))
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('Control+z')
			t.must(await until(async () => (await K.items(pa)).some((s) => JSON.parse(s).id === N), { timeout: 3000 }), '[C] (4) Strg+Z bringt N zurück')
			const c2 = await K.w2s(pa, 250, 100)
			await pa.mouse.move(c2.x, c2.y)
			await pa.mouse.down()
			for (let i = 1; i <= 10; i++) {
				await pa.mouse.move(c2.x - 15 * i, c2.y)
				await sleep(16)
			}
			await pa.mouse.up()
			t.check(await until(async () => near(await bubbleOf(pa, T), b0), { timeout: 3000 }), '[C] (4) die Blase hängt wieder an N: sie folgt dem nächsten Ziehen', { want: b0, now: await bubbleOf(pa, T) })

			t.step('(5) Resolve: die Blase ist bei beiden weg und steht unter „Resolved (1)“; Reopen bringt sie zurück')
			await pa.locator(`[data-knorke-bubble="${T}"]`).first().click()
			t.must(await appears(pa, `${PANEL} [data-knorke-thread="${T}"]`), '[C] (5) die Blase öffnet den Thread im Kommentar-Panel (Job 233)')
			await pa.locator(`[data-knorke-thread="${T}"] [data-knorke-action=comment-resolve]`).first().click()
			t.check(await until(async () => (await bubbleOf(pa, T)) === null && (await bubbleOf(pg, T)) === null, { timeout: 5000 }), '[C] (5) die Blase ist bei alice und Gina weg', { alice: await comments(pa), gina: await comments(pg) })
			t.must(await appears(pa, PANEL), '[C] (5) die Liste bleibt offen')
			// job 233: the thread stays in the panel (resolved); "Back to the list" goes back to the list
			await pa.locator(`${PANEL} [data-knorke-thread="${T}"] [data-knorke-action=comment-back]`).first().click()
			t.check(await gone(pa, `${PANEL} [data-knorke-thread="${T}"]`), '[C] (5) „Back to the list“ führt im Panel zurück zur Liste')
			const tab = pa.locator(`${PANEL} [data-knorke-comments-tab=resolved]`).first()
			t.check((await tab.innerText()).trim() === 'Resolved (1)', '[C] (5) der Reiter heißt „Resolved (1)“', await tab.innerText())
			t.check((await pa.locator(`${PANEL} [data-knorke-comments-tab=open]`).first().innerText()).trim() === 'Open (0)', '[C] (5) und „Open (0)“')
			await tab.click()
			await pa.locator(`${PANEL} [data-knorke-comment-entry="${T}"]`).first().click()
			t.must(await appears(pa, `${PANEL} [data-knorke-thread="${T}"]`), '[C] (5) der erledigte Thread öffnet sich in der Liste')
			await pa.locator(`${PANEL} [data-knorke-thread="${T}"] [data-knorke-action=comment-resolve]`).first().click()
			t.check(await until(async () => (await bubbleOf(pa, T)) !== null && (await bubbleOf(pg, T)) !== null, { timeout: 5000 }), '[C] (5) Reopen bringt die Blase bei beiden zurück')

			t.step('(6) ein „c“ im Antwortfeld blendet keine Cursor aus')
			const reply = pa.locator(`${PANEL} [data-knorke-thread="${T}"] [data-knorke-field=comment]`).first()
			t.must(await reply.isVisible().catch(() => false), '[C] (6) der wieder offene Thread hat ein Antwortfeld')
			await reply.click()
			await pa.keyboard.type('c')
			await sleep(800)
			t.check((await reply.inputValue()) === 'c', '[C] (6) das „c“ steht im Feld', await reply.inputValue())
			t.check((await pa.evaluate(() => localStorage.getItem('knorke.cursors'))) === null && !(await visible(pa, '[data-knorke-toast=cursors]')), '[C] (6) die Cursor bleiben an (kein knorke.cursors, kein Toast)')
			await pa.keyboard.press('Backspace')

			t.step('(7) den Thread mit Rückfrage löschen; „Show bubbles“ aus bleibt nach dem Neuladen aus')
			await pa.locator(`${PANEL} [data-knorke-thread="${T}"] [data-knorke-comment="${T}"] [data-knorke-action=comment-delete]`).first().click()
			t.must(await appears(pa, '[data-knorke-dialog=comment-delete]'), '[C] (7) Löschen des ersten Kommentars fragt nach [data-knorke-dialog=comment-delete]')
			await pa.locator('[data-knorke-dialog=comment-delete] [data-knorke-action=confirm]').first().click()
			t.check(await until(async () => (await comments(pa))?.threads?.length === 0 && (await comments(pg))?.threads?.length === 0, { timeout: 5000 }), '[C] (7) der Thread ist bei alice und Gina weg')
			t.check(((await serverThreads('alice', board)) ?? [null]).length === 0, '[B] (7) und auf dem Server')
			const sw = pa.locator(`${PANEL} [data-knorke-comments-bubbles]`).first()
			t.must(await sw.isVisible().catch(() => false), '[C] (7) die Liste zeigt den Schalter „Show bubbles“')
			await sw.uncheck()
			t.check((await pa.evaluate(() => localStorage.getItem('knorke.bubbles'))) === '0', '[C] (7) „Show bubbles“ aus: knorke.bubbles = 0')
			const again = await api('alice', 'POST', `/api/v1/boards/${board}/comments`, { text: 'E73 frei', x: -300, y: -100 })
			t.must(again.status === 201, '[B] (7) Vorbedingung: ein neuer freier Thread (Route 36)', `${again.status} ${again.text.slice(0, 160)}`)
			await openBoard(a, board)
			t.check(await until(async () => (await comments(pa))?.threads?.length === 1, { timeout: 8000 }), '[C] (7) nach dem Neuladen ist der neue Thread geladen', await comments(pa))
			t.check((await pa.locator('[data-knorke-bubble]').count()) === 0 && (await comments(pa))?.bubbles === false, '[C] (7) und hat keine Blase')
			await action(pa, 'comments')
			t.must(await appears(pa, PANEL), '[C] (7) die Liste öffnet')
			t.check(!(await pa.locator(`${PANEL} [data-knorke-comments-bubbles]`).first().isChecked()), '[C] (7) „Show bubbles“ ist weiter aus')
		} finally {
			for (const x of [b, g, a]) await world.drop(x)
		}
	},
}

export const E73_TABLET = {
	id: 'E73',
	pass: `${TABLET.width}x${TABLET.height}`,
	title: 'Kommentare auf dem Tablet (Job 189, AK8): Tina (Abstimm-Link, Touch, Abstimmung läuft) sieht „Comments“, legt mit „New comment“ und einem Tipp auf die Notiz einen Thread an, ein Tipp auf die Blase öffnet ihn, ihre Stimmen bleiben gleich',
	async run(t, world) {
		const board = await world.board('E73 Tablet')
		const N = ulid()
		const res = await seedOps('alice', board, [put.sticky(N, { x: 0, y: 0, w: 200, h: 200, data: { text: 'E73 Tablet' } })])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Notiz N gesät', res)
		const V = await linkToken(board, 'votelink')
		const vs = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
		t.must(vs.status === 200 && vs.data?.board?.meta?.vote?.state === 'open', '[B] Vorbedingung: alice startet eine Abstimmung über Notizen (Route 22)', `${vs.status} ${vs.text.slice(0, 160)}`)
		const tina = await world.actor('tina-cmt', { touch: true })
		const pt = tina.page
		try {
			await joinAsGuest(tina, V, 'Tina', board, TCAM)
			t.must(await until(async () => (await K.state(pt)).uiMode === 'vote', { timeout: 5000 }), '[D] Vorbedingung: Tina ist im Modus vote', await K.state(pt))
			// the tablet fits the voting area once at the start: wait until its camera rests
			let cam = null
			await until(async () => {
				const c = await K.camera(pt)
				const still = cam !== null && JSON.stringify(c) === JSON.stringify(cam)
				cam = c
				return still
			}, { timeout: 5000, every: 250 })
			t.check(await visible(pt, '[data-knorke-action=comments]'), '[C] der Knopf „Comments“ ist sichtbar')
			const votes0 = await K.votes(pt)
			await pt.locator('[data-knorke-action=comments]').first().tap()
			t.must(await appears(pt, PANEL), '[C] ein Tipp öffnet die Liste')
			await pt.locator('[data-knorke-action=comment-new]').first().tap()
			t.must(await appears(pt, '[data-knorke-banner=comment-place]'), '[C] „New comment“ zeigt den Hinweis mit „Cancel“')
			t.check(await gone(pt, PANEL, 2000), '[C] (Runde 1) die Liste deckte den Hinweis: sie geht zu')
			const cancel = pt.locator('[data-knorke-action=comment-pick-cancel]').first()
			const cb = await cancel.boundingBox()
			const onTop = cb ? await pt.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest?.('[data-knorke-action=comment-pick-cancel]') !== null, [cb.x + cb.width / 2, cb.y + cb.height / 2]) : false
			t.check(onTop, '[C] (Runde 1) „Cancel“ liegt frei und nimmt den Tipp', cb)
			await cancel.tap()
			t.check(await gone(pt, '[data-knorke-banner=comment-place]', 2000) && (await comments(pt))?.picking === false, '[C] „Cancel“ beendet „New comment“')
			await pt.locator('[data-knorke-action=comments]').first().tap()
			t.must(await appears(pt, PANEL), '[C] die Liste öffnet wieder')
			await pt.locator('[data-knorke-action=comment-new]').first().tap()
			t.must(await appears(pt, '[data-knorke-banner=comment-place]') && await gone(pt, PANEL, 2000), '[D] „New comment“ noch einmal, die Liste geht zu')
			await pt.keyboard.press('Escape')
			t.check(await gone(pt, '[data-knorke-banner=comment-place]', 2000) && (await comments(pt))?.picking === false,
				'[C] (Runde 2) Esc beendet „New comment“ auch, wenn die Liste mit ihrem Knopf zuging (der Fokus liegt auf dem Board)',
				await pt.evaluate(() => document.activeElement?.className ?? null))
			await pt.locator('[data-knorke-action=comments]').first().tap()
			t.must(await appears(pt, PANEL), '[C] die Liste öffnet wieder')
			await pt.locator('[data-knorke-action=comment-new]').first().tap()
			t.must(await appears(pt, '[data-knorke-banner=comment-place]'), '[C] „New comment“ noch einmal')
			const p = await K.w2s(pt, 30, 100)
			await pt.touchscreen.tap(p.x, p.y)
			t.must(await appears(pt, NEW), '[C] ein Tipp auf N öffnet das Schreibfeld')
			t.check(!(await visible(pt, '[data-knorke-banner=comment-place]')), '[C] der Hinweis ist weg')
			const focused = await until(() => pt.evaluate((sel) => document.activeElement?.matches?.(sel) === true, `${NEW} [data-knorke-field=comment]`), { timeout: 2000 })
			t.check(focused, '[C] (Runde 1, Falle 9.46) das Schreibfeld behält nach dem Tipp den Fokus', await pt.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120) ?? null))
			if (!focused) await pt.locator(`${NEW} [data-knorke-field=comment]`).first().tap()
			await pt.keyboard.type('Vom Tablet', { delay: 10 })
			await pt.locator(`${NEW} [data-knorke-action=comment-send]`).first().tap()
			const T = await until(async () => (await comments(pt))?.threads?.[0]?.id ?? null, { timeout: 8000 })
			t.must(typeof T === 'string', '[C] „Send“ legt den Thread an', await comments(pt))
			const st = await serverThreads('alice', board)
			t.check(st?.[0]?.item === N && st?.[0]?.comments?.[0]?.name === 'Tina' && st?.[0]?.comments?.[0]?.guest === true, '[B] der Thread hängt an N, von der Gästin Tina', st)
			t.check(JSON.stringify((await K.votes(pt))?.mine) === JSON.stringify(votes0?.mine), '[C] der Tipp auf N war keine Stimme', { before: votes0, now: await K.votes(pt) })
			await pt.locator(`[data-knorke-thread="${T}"] [data-knorke-action=comment-close]`).first().tap()
			t.must(!(await visible(pt, PANEL)), '[D] die Liste ist zu')
			const bub = pt.locator(`[data-knorke-bubble="${T}"]`).first()
			t.must(await bub.isVisible().catch(() => false), '[C] die Blase ist da', await comments(pt))
			await bub.tap()
			t.check(await appears(pt, `[data-knorke-thread="${T}"]`), '[C] ein Tipp auf die Blase öffnet den Thread')
			await sleep(1000)
			const votes1 = await K.votes(pt)
			t.check(JSON.stringify(votes1?.mine) === JSON.stringify(votes0?.mine) && votes1?.left === votes0?.left, '[C] die Zahl der Stimmen bleibt gleich', { before: votes0, after: votes1 })
		} finally {
			await world.drop(tina)
		}
	},
}
