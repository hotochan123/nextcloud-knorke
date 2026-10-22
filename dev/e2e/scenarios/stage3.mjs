/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M1 stage 3 (SPEC-M1 §8.4, Revisions 16 and 17): moderation in the browser.
 *
 * E31 dot voting: alice selects frame A (shapes only) on the canvas and opens
 *   [data-knorke-dialog=vote-setup] through the moderation menu: scope
 *   "frame", type sticky → [data-knorke-vote-votable=0] and vote-start
 *   disabled; Esc. alice selects frame B (notes), vote-per = 3, starts (one
 *   vote per item). The bar opens at everyone ≤ 3 s. bob (desktop editor, in
 *   mode vote) clicks; scene state over __knorke.scene().voteState: rings =
 *   votable notes in the renderer's culled set (the cull rectangle: the
 *   stage with its overscan, per side at least 10 %; lib/moderation.mjs
 *   countCullSet with __knorke.scene().overscan), outline = frame B, after his vote
 *   rings − 1 and badges + 1. Gina (CDP touch) taps, a double tap counts once, the vote
 *   list adds the third vote, a fourth → [data-knorke-toast=vote-limit]; a
 *   tap outside the scope → [data-knorke-toast=vote-miss] with the frame
 *   title. sentPresence() of bob and Gina is null after the first tick in
 *   mode vote, their entries leave alice's presence() ≤ 12 s, never with a
 *   cursor over a vote. alice sees only "{n} voted". "End voting" asks; the
 *   VotePanel opens once at everyone with the ranking; "Show on board" →
 *   totals > 0 at bob; "Close results" removes bar and badges (voteState
 *   null). "Vote afterwards": alice starts a second session over route 22
 *   and closes her page, the bridge expires it (vote-expire), Gina's tap →
 *   [data-knorke-toast=vote-closed], votes().state closed (path (a)).
 * E32 timer: alice starts 1 min in [data-knorke-dialog=timer], pauses, +1,
 *   resumes; bob reloads; the remaining time of every page, computed from
 *   __knorke.meta().timer and state().clockOffset at the same moment, is
 *   within ±1 s of alice's; data-knorke-timer-left agrees. End: alice stops,
 *   route 24 {start, ms 3000} over the API → within 6 s
 *   data-knorke-timer-state=done and [data-knorke-banner=time_up] at all.
 * E33 following (all contexts reducedMotion 'reduce'): bob follows alice
 *   through her participant button, alice pans → bob's centre = the centre of
 *   alice's view in bob's presence() (±5 % of bob's viewport width) ≤ 3 s;
 *   bob pans → following ends; "Bring everyone here": bob ≤ 3 s, Gina
 *   (tablet) ≤ 5 s; Gina pans away → [data-knorke-follow-chip], a tap
 *   follows again; during a vote alice pans all the time, Gina's touchStart +
 *   forceTick leaves the camera alone, the tap lands on exactly that note,
 *   the held jump comes ≥ 1.5 s after the release; alice switches to "Edit"
 *   ([data-knorke-action=vote-mode]): the frame list and Shift+2 bring the
 *   frame and the selection into view; Gina pans away again, alice "Stop
 *   presenting", then a second "Bring everyone here" fetches Gina again (the
 *   pair seq/at of SRV-04).
 * Viewport passes (SPEC-M1 §8.4 R16, TST-10): E31@390x844, E31@820x1180,
 *   E33@…, and the stage-3 additions of E28 (E28@…) – one board each, only
 *   the touch actor gets the viewport, checks over lib/bars.mjs (§6.6 (5)).
 *   At 390 × 844 E31 checks the bar, the list open at the start, one vote
 *   through [data-knorke-vote-item] (vote-add) and the bars; tapping the
 *   canvas is the standard pass's. R17 K7: "VoteBar at the bottom" (§6.6 (2),
 *   (5)) holds in BOTH viewports; every pass with an open session checks it
 *   with requireVote (E31, E33, and E28 after starting a session on its
 *   voting link through route 22).
 *
 * Every case clears the ILimiter budgets first (World.limiterReset, R16
 * TST-13: knorke-moderate 120 per 600 s) and World.cleanup clears them again.
 * Check labels start with exactly ONE owner of a red check (SPEC-M1 §9.6;
 * stage3.test.mjs refuses two): [C] protocol, state, banners, shell hooks,
 * dialogs, __knorke, following, narrow layout; [S] canvas, hit test, rings,
 * badges, outline, Shift+2; [B] a server answer or stored server state; [D]
 * a harness precondition (bridge, timing of the harness). No
 * page.waitForFunction (Nextcloud's CSP, ENTWICKLUNG trap 9.10).
 */
import {
	K, APP, PHONE, TABLET, api, waitReady, until, sleep, openBoard, action, field, bannerVisible, CANVAS, put, ulid, seedOps, worldAt,
} from '../lib/harness.mjs'
import { bridge } from '../lib/bridge.mjs'
import { collectBars, checkBars } from '../lib/bars.mjs'
import { menuAction, countCullSet } from '../lib/moderation.mjs'

/** §6.11 texts the cases compare (English source strings, locale en-US). */
export const TEXT3 = {
	endVoting: 'End voting now? Votes can\'t be changed afterwards.',
	voteClosed: 'Voting has ended.',
	voteLimit: 'You have no votes left.',
	anonymous: 'Your votes are anonymous.',
	guest: 'Guest',
	scanVote: 'Scan to vote on this board',
	scanJoin: 'Scan to join this board',
	deviceVote: 'On this device you can view and vote. Editing works on a computer.',
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Value of the root's data-knorke-features, or null when absent. */
export async function featuresOf(page) {
	return page.locator('[data-knorke-features]').first().getAttribute('data-knorke-features', { timeout: 5000 }).catch(() => null)
}
export const voting = (f) => typeof f === 'string' && f.split(/\s+/).includes('voting')

/** Turns the edit link of a board on (API as alice); returns its token. */
async function linkToken(board) {
	const r = await api('alice', 'POST', `/api/v1/boards/${board}/link`, { rotate: false })
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${board}: ${r.status} ${r.text.slice(0, 200)}`)
	return r.data.link.token
}

/** A guest joins through /p/<token> with `name` (the name dialog), then the board session runs. */
async function joinAsGuest(actor, token, name) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await field(actor.page, 'guest-name', name)
	await action(actor.page, 'guest-join')
	await waitReady(actor.page, 30000)
}

/** An account opens /p/<token> (becomes a link member) and lands in the board. */
async function joinAsMember(actor, token) {
	await actor.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
	await waitReady(actor.page, 30000)
}

// menuAction (moderation entry through its menu, R16 CLI-09) lives in lib/moderation.mjs: dev/e2e/moderation.test.mjs pins it with fakes

/** Shows the whole board (Shift+1) with the canvas focused. */
async function fitAll(page) {
	await page.locator(CANVAS).first().focus()
	await page.keyboard.press('Shift+Digit1')
	await sleep(300)
}

/** Is the canvas the topmost element at a client point (no bar or dialog over it)? */
function canvasAt(page, x, y) {
	return page.evaluate(([px, py, sel]) => {
		const el = document.elementFromPoint(px, py)
		return !!(el && el.closest && el.closest(sel))
	}, [x, y, CANVAS]).catch(() => false)
}

/**
 * Selects a frame on the canvas by a click into its title band (world
 * (x + 30, y − 8), above the frame, SPEC-M1 §6.3). When a bar lies over that
 * point (the TopBar overlays the canvas), the view is first panned with the
 * wheel so the point comes to the canvas centre.
 * @return {Promise<boolean>} clicked
 */
async function clickFrameTitle(page, fx, fy) {
	for (let i = 0; i < 3; i++) {
		const p = await K.w2s(page, fx + 30, fy - 8)
		if (await canvasAt(page, p.x, p.y)) {
			await page.mouse.click(p.x, p.y)
			return true
		}
		const box = await canvasBox(page)
		await wheelPan(page, p.x - (box.x + box.width / 2), p.y - (box.y + box.height / 2), 3)
	}
	return false
}

/** Checked state of a radio/checkbox hook (aria-checked, the element's or its input's `checked`). */
async function isChecked(locator) {
	return locator.first().evaluate((el) => {
		if (el.getAttribute('aria-checked') === 'true') return true
		if (el.checked === true) return true
		const i = el.querySelector('input')
		return !!(i && i.checked)
	}).catch(() => false)
}

/** Text of a visible element (whitespace collapsed), '' when absent. */
async function textOf(locator) {
	if (!(await locator.isVisible().catch(() => false))) return ''
	return (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}

/** A visible element of the selector appears within `timeout`. */
const appears = (page, sel, timeout = 3000) => until(() => page.locator(sel).first().isVisible().catch(() => false), { timeout })
/** It disappears (or never shows) within `timeout`. */
const vanishes = (page, sel, timeout = 3000) => until(async () => !(await page.locator(sel).first().isVisible().catch(() => false)), { timeout })

/** The open vote bar ([data-knorke-vote-bar] with data-knorke-vote-state=open). */
const OPEN_BAR = '[data-knorke-vote-bar][data-knorke-vote-state=open]'

/** data-knorke-vote-left of the vote bar (string) or null. */
async function barLeft(page) {
	return page.locator('[data-knorke-vote-bar]').first().getAttribute('data-knorke-vote-left', { timeout: 1000 }).catch(() => null)
}

/** CDP session of an actor (touch input, E11 pattern). */
async function cdpOf(actor) {
	if (!actor.cdp) actor.cdp = await actor.ctx.newCDPSession(actor.page)
	return actor.cdp
}
async function touch(actor, type, points) {
	await (await cdpOf(actor)).send('Input.dispatchTouchEvent', { type, touchPoints: points })
}
/** One finger tap at a client point. */
async function tapAt(actor, x, y, hold = 60) {
	await touch(actor, 'touchStart', [{ x, y }])
	await sleep(hold)
	await touch(actor, 'touchEnd', [])
}
/** One finger swipe by (dx, dy) client px in `steps` frames. */
async function swipe(actor, x, y, dx, dy, steps = 10) {
	await touch(actor, 'touchStart', [{ x, y }])
	for (let i = 1; i <= steps; i++) {
		await sleep(16)
		await touch(actor, 'touchMove', [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }])
	}
	await touch(actor, 'touchEnd', [])
	await sleep(200)
}

/** The canvas host's box (client px). */
const canvasBox = (page) => page.locator(CANVAS).first().boundingBox()

/**
 * Screen rect of an item and whether it can be hit: completely inside the
 * canvas, and the canvas is the topmost element at its centre (no bar or
 * panel over it).
 */
async function hitRect(page, id) {
	const r = await K.rect(page, id)
	const box = await canvasBox(page)
	if (!r || !box) return null
	const inside = r.x >= box.x - 1 && r.y >= box.y - 1 && r.x + r.w <= box.x + box.width + 1 && r.y + r.h <= box.y + box.height + 1
	const cx = r.x + r.w / 2
	const cy = r.y + r.h / 2
	const onCanvas = await page.evaluate(([x, y, sel]) => {
		const el = document.elementFromPoint(x, y)
		return !!(el && el.closest && el.closest(sel))
	}, [cx, cy, CANVAS]).catch(() => false)
	return { ...r, cx, cy, inside, onCanvas, ok: inside && onCanvas }
}

/**
 * The notes of `ids` against the renderer's culled set (SPEC-M1 §6.3
 * stats().voteState: the cull rectangle, i.e. the stage with its overscan,
 * per side at least CULL_MARGIN (job 034); padded index boxes; ask of [S]
 * in stage 3, phase 1): {in, edge, out, classes} of lib/moderation.mjs
 * countCullSet, plus the camera scale, the overscan and the canvas box it used.
 */
async function cullSet(page, ids) {
	const box = await canvasBox(page)
	const cam = await K.camera(page)
	const ov = (await K.scene(page))?.overscan ?? null
	const rects = []
	for (const id of ids) rects.push(await K.rect(page, id))
	return { ...countCullSet(rects, box, { scale: cam?.scale, ov }), scale: cam?.scale ?? null, ov, box }
}

/** The scene's vote state (§6.3 stats().voteState). */
const sceneVote = async (page) => (await K.scene(page))?.voteState

/** Centre of the follower's view in world coordinates and its width in world units. */
async function viewCenter(page) {
	const c = await worldAt(page, 0.5, 0.5)
	const box = await canvasBox(page)
	return { x: c.x, y: c.y, w: box.width / c.scale }
}

/**
 * Follows-check of SPEC-M1 §8.4 E33 (R16): the follower's centre lies within
 * 5 % of its viewport width of the centre of the leader's `view` in the
 * follower's presence(), and that view is the leader's current one (its
 * centre within the same tolerance of `leader`, the leader's own centre).
 * @return {Promise<object|null>} the last measurement when it held within `timeout`
 */
async function follows(page, leaderPid, leader, timeout) {
	let last = null
	const ok = await until(async () => {
		const sample = (await K.presence(page)).find((s) => s.pid === leaderPid && Array.isArray(s.view))
		const me = await viewCenter(page)
		if (!sample) { last = { me, sample: null }; return false }
		const [x, y, w, h] = sample.view
		const lc = { x: x + w / 2, y: y + h / 2 }
		const tol = 0.05 * me.w
		last = { me, lead: lc, leader, tol }
		return Math.hypot(lc.x - leader.x, lc.y - leader.y) <= tol && Math.hypot(me.x - lc.x, me.y - lc.y) <= tol
	}, { timeout, every: 100 })
	return ok ? last : (last ? { ...last, failed: true } : null)
}

/** Brings a world point to the canvas centre of a desktop page (wheel pan; the zoom stays). */
async function centerOn(page, wx, wy) {
	for (let i = 0; i < 3; i++) {
		const p = await K.w2s(page, wx, wy)
		const box = await canvasBox(page)
		const dx = p.x - (box.x + box.width / 2)
		const dy = p.y - (box.y + box.height / 2)
		if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return true
		await wheelPan(page, dx, dy, 4)
	}
	return false
}

/** Pans a desktop page with the wheel (no Ctrl = pan, M0 E10) at the canvas centre. */
async function wheelPan(page, dx, dy, steps = 5) {
	const box = await canvasBox(page)
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	for (let i = 0; i < steps; i++) {
		await page.mouse.wheel(dx / steps, dy / steps)
		await sleep(30)
	}
	await sleep(400)
}

/** The bars check of §6.6 (5) on a page: problems (empty = holds) and the raw measurement. */
async function bars(page, o = {}) {
	const snap = await page.evaluate(collectBars).catch(() => null)
	return { problems: checkBars(snap, o), snap }
}

/** Closes an open VotePanel ([data-knorke-action=vote-panel-close]). */
async function closePanel(page) {
	if (!(await page.locator('[data-knorke-vote-panel]').first().isVisible().catch(() => false))) return true
	await page.locator('[data-knorke-action=vote-panel-close]').first().click().catch(() => {})
	return vanishes(page, '[data-knorke-vote-panel]', 3000)
}

/** Opens the VotePanel through the vote bar ([data-knorke-action=vote-panel]). */
async function openPanel(page) {
	if (await page.locator('[data-knorke-vote-panel]').first().isVisible().catch(() => false)) return true
	await page.locator('[data-knorke-vote-bar] [data-knorke-action=vote-panel], [data-knorke-action=vote-panel]').first().click().catch(() => {})
	return appears(page, '[data-knorke-vote-panel]', 3000)
}

/** Adds one vote through the vote list ([data-knorke-vote-item=<id>] → vote-add). */
async function listVote(page, id) {
	const item = page.locator(`[data-knorke-vote-panel] [data-knorke-vote-item="${id}"], [data-knorke-vote-item="${id}"]`).first()
	await item.waitFor({ state: 'visible', timeout: 5000 })
	await item.locator('[data-knorke-action=vote-add]').first().click()
}

/** mine of __knorke.votes() (object) or {} while the hook is missing. */
async function mineOf(page) {
	const v = await K.votes(page)
	return v && v !== 'missing' && v.mine && typeof v.mine === 'object' ? v.mine : {}
}

/** Starts a session over route 22 as alice (setup); returns the answer. */
async function apiStart(board, cfg) {
	return api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null, ...cfg })
}

/** Four notes in a frame plus the frame (seed ops); the frame first. */
function frameWithNotes(F, notes, { x = 0, y = 0, title = 'Notizen' } = {}) {
	return [
		put.frame(F, { x, y, w: 1200, h: 400, data: { title } }),
		...notes.map((id, i) => put.sticky(id, { parent: F, x: 60 + i * 280, y: 120, data: { text: `Notiz ${i + 1}` } })),
	]
}

// ── E31 ──────────────────────────────────────────────────────────────────

export const E31 = {
	id: 'E31',
	title: 'Punkte-Abstimmung (R16): Dialog über die Leinwand-Auswahl (Zähler 0 → Start gesperrt), Start mit 3 Stimmen; bob klickt, Gina tippt (Doppeltipp einmal), Stimmliste, Grenze, Tipp außerhalb; Szenen-Zustand (Ringe, Abzeichen, Umriss); sentPresence null, Einträge verfallen; alice nur „n voted“; Ende mit Rückfrage, Rangliste einmal, „Show on board“, „Close results“; Stimme danach (vote-expire) → vote-closed',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E2E Abstimmung')
		const L = await linkToken(board)
		const [FA, SA1, SA2, FB, NO] = [ulid(), ulid(), ulid(), ulid(), ulid()]
		const N = [ulid(), ulid(), ulid(), ulid()]
		const res = await seedOps('alice', board, [
			put.frame(FA, { x: 0, y: 0, w: 900, h: 400, data: { title: 'Formen' } }),
			put.shape(SA1, { parent: FA, x: 60, y: 120 }),
			put.shape(SA2, { parent: FA, x: 460, y: 120 }),
			...frameWithNotes(FB, N, { y: 600 }),
			put.sticky(NO, { x: 500, y: 1080, data: { text: 'Draußen' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Frame A (Formen), Frame B (vier Notizen), eine Notiz außerhalb', res)
		const a = await world.actor('alice-abstimmung', { user: 'alice' })
		await openBoard(a, board)
		const f = await featuresOf(a.page)
		t.must(voting(f), '[C] FEATURES.voting: Wurzel mit data-knorke-features="voting" (Stufe 3)', f)
		const b = await world.actor('bob-abstimmung', { user: 'bob' })
		await joinAsMember(b, L)
		const g = await world.actor('gina-abstimmung', { touch: true })
		await joinAsGuest(g, L, 'Gina')
		const bobPid = (await K.state(b.page)).pid
		const ginaPid = (await K.state(g.page)).pid
		await fitAll(a.page)
		await fitAll(b.page)

		t.step('alice wählt Frame A auf der Leinwand und öffnet den Dialog: Zähler 0, Start gesperrt')
		t.must(await clickFrameTitle(a.page, 0, 0), '[D] Vorbedingung: das Titelband von Frame A liegt frei (kein Balken darüber)')
		t.check(JSON.stringify(await K.selection(a.page)) === JSON.stringify([FA]), '[S] Klick ins Titelband wählt Frame A', await K.selection(a.page))
		await menuAction(a.page, 'vote-setup')
		const dlg = a.page.locator('[data-knorke-dialog=vote-setup]').first()
		t.must(await dlg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] [data-knorke-dialog=vote-setup] über das Moderationsmenü geöffnet')
		t.check(await isChecked(dlg.locator('[data-knorke-vote-scope-option=frame]')), '[C] Bereich: „Selected frame“ ist bei genau einem ausgewählten Frame die Vorgabe')
		t.check(await isChecked(dlg.locator('[data-knorke-vote-type=sticky]')) && !(await isChecked(dlg.locator('[data-knorke-vote-type=shape]'))), '[C] Typen: sticky (Vorgabe)')
		const zero = await until(async () => (await dlg.locator('[data-knorke-vote-votable]').first().getAttribute('data-knorke-vote-votable').catch(() => null)) === '0', { timeout: 3000 })
		t.check(zero, '[C] Frame A (nur Formen) und Typ sticky → [data-knorke-vote-votable=0]', await dlg.locator('[data-knorke-vote-votable]').first().getAttribute('data-knorke-vote-votable').catch(() => null))
		t.check(await dlg.locator('[data-knorke-action=vote-start]').first().isDisabled().catch(() => false), '[C] „Start voting“ (vote-start) gesperrt bei 0')
		// Esc where the dialog put the focus when it opened (a user does not move it first)
		const focusAt = await a.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()}${e.getAttribute('data-knorke-field') ? '[data-knorke-field=' + e.getAttribute('data-knorke-field') + ']' : ''}` : null })
		await a.page.keyboard.press('Escape')
		const escClosed = await vanishes(a.page, '[data-knorke-dialog=vote-setup]')
		t.check(escClosed, '[C] Esc schließt den Dialog', { focusAt })
		if (!escClosed) {
			// go on with the case: close it through its own close button
			await dlg.locator('button[aria-label="Close"], .modal-container__close').first().click().catch(() => {})
			t.note(`Dialog per Schließen-Knopf zu: ${await vanishes(a.page, '[data-knorke-dialog=vote-setup]')}`)
		}

		t.step('alice wählt Frame B, vote-per = 3, startet')
		t.must(await clickFrameTitle(a.page, 0, 600), '[D] Vorbedingung: das Titelband von Frame B liegt frei')
		t.check(JSON.stringify(await K.selection(a.page)) === JSON.stringify([FB]), '[S] Klick ins Titelband wählt Frame B', await K.selection(a.page))
		await menuAction(a.page, 'vote-setup')
		await dlg.waitFor({ state: 'visible', timeout: 5000 })
		await field(a.page, 'vote-per', '3')
		t.check(await isChecked(dlg.locator('[data-knorke-field=vote-per-item]')), '[C] Schalter „One vote per item“ an (Vorgabe)')
		const four = await until(async () => (await dlg.locator('[data-knorke-vote-votable]').first().getAttribute('data-knorke-vote-votable').catch(() => null)) === '4', { timeout: 3000 })
		t.check(four, '[C] Frame B: [data-knorke-vote-votable=4]', await dlg.locator('[data-knorke-vote-votable]').first().getAttribute('data-knorke-vote-votable').catch(() => null))
		const reqP = a.page.waitForRequest((r) => /\/api\/v1\/boards\/\d+\/vote$/.test(r.url()) && r.method() === 'POST', { timeout: 10000 }).catch(() => null)
		const respP = a.page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/vote$/.test(r.url()) && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null)
		await dlg.locator('[data-knorke-action=vote-start]').first().click()
		const req = await reqP
		let sent = null
		try { sent = req ? req.postDataJSON() : null } catch { sent = null }
		t.check(sent && sent.per === 3 && sent.perItem === 1 && sent.scope === FB && JSON.stringify(sent.types) === '["sticky"]' && sent.minutes === null,
			'[C] Start sendet {per 3, perItem 1, scope Frame B, types [sticky], minutes null}', sent)
		const resp = await respP
		const started = Date.now()
		t.check(resp && resp.status() === 200, '[B] Route 22 → 200', resp && resp.status())
		const bars3 = await Promise.all([a, b, g].map((x) => until(() => x.page.locator(OPEN_BAR).first().isVisible().catch(() => false), { timeout: 3000 })))
		t.check(bars3.every(Boolean), `[C] Leiste [data-knorke-vote-bar] offen bei allen ≤ 3 s (alice, bob, Gina: ${bars3.map(Boolean).join(', ')})`)
		t.note(`Leiste bei allen nach ${Date.now() - started} ms`)
		// alice's presence() from now on (R16 CLI-01): when bob's and Gina's entries are gone, and every cursor of theirs
		const watch = { seen: [], goneAt: null, stop: false }
		const watching = (async () => {
			while (!watch.stop && Date.now() - started < 90000) {
				const list = await K.presence(a.page).catch(() => [])
				const ours = list.filter((x) => x.pid === bobPid || x.pid === ginaPid)
				for (const x of ours) watch.seen.push({ at: Date.now() - started, pid: x.pid, cursor: x.cursor })
				if (ours.length) watch.goneAt = null
				else if (watch.goneAt === null) watch.goneAt = Date.now() - started
				await sleep(250)
			}
		})()

		t.step('bob (Desktop, Modus vote): Ringe und Umriss, dann ein Klick')
		const bs = await until(async () => { const s = await K.state(b.page); return s.uiMode === 'vote' ? s : null }, { timeout: 3000 })
		t.check(bs, '[C] bob: uiMode vote nach dem Start (Bearbeiter am Desktop, Vorgabe vote)', await K.state(b.page))
		// rings count the votable notes without an own vote in the renderer's culled set (its cull
		// rectangle: the stage with its overscan, per side at least CULL_MARGIN; padded boxes; §6.3):
		// a note in that rectangle has a ring, one at its edge may have one
		const cs = await cullSet(b.page, N)
		t.check(cs.in >= 1, '[D] Vorbedingung: Notizen von Frame B liegen bei bob im Culling-Rechteck (Bühne, je Seite mindestens 10 %)', cs)
		const ringsOk = (n) => n >= cs.in && n <= cs.in + cs.edge
		const ringsWant = cs.edge ? `${cs.in}…${cs.in + cs.edge}` : String(cs.in)
		let vs = await until(async () => { const v = await sceneVote(b.page); return v && v.outline === FB && ringsOk(v.rings) ? v : null }, { timeout: 3000 })
		t.check(vs && vs.scope === FB && vs.markVotable === true && vs.badges === 0 && vs.totals === 0, `[S] bob: voteState {scope B, markVotable, rings ${ringsWant} (abstimmbare Notizen im Culling-Rechteck), badges 0, totals 0, outline B}`, { voteState: vs || await sceneVote(b.page), cull: cs.classes })
		const rings0 = vs ? vs.rings : cs.in
		const r0 = await hitRect(b.page, N[0])
		t.must(r0 && r0.ok, '[D] Vorbedingung: Notiz 1 bei bob ganz im Bild und klickbar', r0)
		await b.page.mouse.click(r0.cx, r0.cy)
		t.check(await until(async () => (await mineOf(b.page))[N[0]] === 1, { timeout: 3000 }), '[C] bob: votes().mine {Notiz 1: 1} nach dem Klick', await K.votes(b.page))
		t.check(await until(async () => (await barLeft(b.page)) === '2', { timeout: 3000 }), '[C] bob: Leiste data-knorke-vote-left = 2', await barLeft(b.page))
		vs = await until(async () => { const v = await sceneVote(b.page); return v && v.rings === rings0 - 1 && v.badges === 1 ? v : null }, { timeout: 3000 })
		t.check(vs, '[S] bob: nach der Stimme rings − 1 und badges + 1', await sceneVote(b.page))

		t.step('Gina (Tablet): Tipp, Doppeltipp, Stimmliste, Grenze, Tipp außerhalb')
		t.check(await until(async () => (await K.state(g.page)).uiMode === 'vote', { timeout: 3000 }), '[C] Gina (Touch-Gerät): uiMode vote', await K.state(g.page))
		await sleep(600) // the tablet fits the scope once at the session start (§6.5.5)
		const r1 = await hitRect(g.page, N[1])
		t.must(r1 && r1.ok && Math.min(r1.w, r1.h) >= 44, '[C] Gina: Kamera beim Sitzungsbeginn auf dem Bereich (Notiz 2 ganz im Bild, ≥ 44 px)', r1)
		await tapAt(g, r1.cx, r1.cy)
		t.check(await until(async () => (await mineOf(g.page))[N[1]] === 1, { timeout: 5000 }), '[C] Gina: Tipp auf Notiz 2 → mine {Notiz 2: 1}', await K.votes(g.page))
		const r2 = await hitRect(g.page, N[2])
		t.must(r2 && r2.ok && Math.min(r2.w, r2.h) >= 44, '[C] Gina: Notiz 3 ganz im Bild (≥ 44 px)', r2)
		await tapAt(g, r2.cx, r2.cy, 40)
		await sleep(80)
		await tapAt(g, r2.cx, r2.cy, 40)
		await K.waitIdle(g.page, 15000).catch(() => {})
		const m3 = await mineOf(g.page)
		t.check(m3[N[2]] === 1, '[C] Doppeltipp auf Notiz 3 zählt einmal (repeat < 400 ms ignoriert)', await K.votes(g.page))
		t.check(await openPanel(g.page), '[C] Gina: Stimmliste [data-knorke-vote-panel] geöffnet (vote-panel)')
		await listVote(g.page, N[3])
		t.check(await until(async () => (await mineOf(g.page))[N[3]] === 1, { timeout: 3000 }), '[C] Stimmliste: vote-add auf Notiz 4 → mine {…, Notiz 4: 1}', await K.votes(g.page))
		t.check(await until(async () => (await barLeft(g.page)) === '0', { timeout: 3000 }), '[C] Gina: data-knorke-vote-left = 0', await barLeft(g.page))
		await listVote(g.page, N[0])
		const lim = await appears(g.page, '[data-knorke-toast=vote-limit]', 3000)
		t.check(lim, '[C] vierte Stimme → [data-knorke-toast=vote-limit]')
		if (lim) t.check((await textOf(g.page.locator('[data-knorke-toast=vote-limit]').first())).includes(TEXT3.voteLimit), '[C] Text „You have no votes left.“', await textOf(g.page.locator('[data-knorke-toast=vote-limit]').first()))
		t.check((await mineOf(g.page))[N[0]] === undefined, '[C] die vierte Stimme wird nicht vergeben', await K.votes(g.page))
		t.check(await closePanel(g.page), '[C] vote-panel-close schließt die Stimmliste')
		const ro = await hitRect(g.page, NO)
		t.must(ro && ro.ok, '[C] Gina: die Notiz außerhalb des Bereichs ist im Bild', ro)
		await tapAt(g, ro.cx, ro.cy)
		const miss = await appears(g.page, '[data-knorke-toast=vote-miss]', 3000)
		t.check(miss, '[C] Tipp außerhalb des Bereichs → [data-knorke-toast=vote-miss]')
		if (miss) t.check((await textOf(g.page.locator('[data-knorke-toast=vote-miss]').first())).includes('“Notizen”'), '[C] Hinweis nennt den Frame-Titel („Only items in “Notizen” can get votes.“)', await textOf(g.page.locator('[data-knorke-toast=vote-miss]').first()))

		t.step('Präsenz: sentPresence null, Einträge verschwinden bei alice ≤ 12 s, nie ein Cursor über einer Stimme')
		for (const [who, p] of [['bob', b.page], ['Gina', g.page]]) {
			await K.forceTick(p)
			await K.waitIdle(p, 10000).catch(() => {})
			const sp = await K.sentPresence(p)
			t.check(sp === null, `[C] ${who}: __knorke.sentPresence() = null im Modus vote`, sp)
		}
		await until(() => watch.goneAt !== null, { timeout: Math.max(500, started + 13000 - Date.now()), every: 250 })
		watch.stop = true
		await watching
		const seen = watch.seen
		t.check(watch.goneAt !== null && watch.goneAt <= 12000, `[C] alice: Einträge von bob und Gina fehlen spätestens 12 s nach dem Wechsel in __knorke.presence() (weg ab ${watch.goneAt} ms nach dem Start)`, seen.slice(-3))
		// note 1 of frame B in world coordinates (frame at y 600, note at 60/120 in it, 200 × 200)
		const n1 = { x: 60, y: 720, w: 200, h: 200 }
		const overVote = seen.filter((x) => x.pid === bobPid && Array.isArray(x.cursor) && x.cursor[0] >= n1.x && x.cursor[0] <= n1.x + n1.w && x.cursor[1] >= n1.y && x.cursor[1] <= n1.y + n1.h)
		t.check(overVote.length === 0, '[C] bobs Eintrag bei alice zeigt nie einen Cursor über der Notiz seines Abstimm-Klicks (nur der letzte Stand aus dem Modus edit)', overVote.slice(0, 3))

		t.step('alice sieht nur „n voted“')
		const aliceBar = a.page.locator('[data-knorke-vote-bar]').first()
		t.check(await until(async () => /\b2 voted\b/.test(await textOf(aliceBar)), { timeout: 6000 }), '[C] alice: Leiste zeigt „2 voted“ (bob, Gina)', await textOf(aliceBar))
		const av = await K.votes(a.page)
		t.check(av && av !== 'missing' && av.voters === 2 && av.results === null && av.state === 'open', '[C] alice: votes() {voters 2, results null, state open}', av)
		t.check((await a.page.locator('[data-knorke-vote-results]').count()) === 0, '[C] alice: keine Rangliste ([data-knorke-vote-results]) während der Sitzung')
		const avs = await sceneVote(a.page)
		t.check(!avs || avs.totals === 0, '[S] alice: keine Gesamtzahlen auf dem Board während der Sitzung (totals 0)', avs)

		t.step('alice beendet über „End voting“ (Rückfrage)')
		await a.page.locator('[data-knorke-vote-bar] [data-knorke-action=vote-end], [data-knorke-action=vote-end]').first().click()
		const confirm = a.page.locator('[data-knorke-action=confirm]').first()
		t.check(await confirm.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] „End voting“ fragt nach (Bestätigungsdialog)')
		const ctext = await textOf(a.page.locator('.knorke-dialog, [role=dialog]').filter({ has: confirm }).first())
		t.check(ctext.includes(TEXT3.endVoting), '[C] Text „End voting now? Votes can\'t be changed afterwards.“', ctext.slice(0, 200))
		await confirm.click()
		const panels = await Promise.all([a, b, g].map((x) => until(() => x.page.locator('[data-knorke-vote-panel] [data-knorke-vote-results], [data-knorke-vote-results]').first().isVisible().catch(() => false), { timeout: 6000 })))
		t.check(panels.every(Boolean), `[C] nach dem Ende öffnet sich bei allen das VotePanel mit der Rangliste (${panels.map(Boolean).join(', ')})`)
		const meta = await K.meta(a.page)
		const want = [N[0], N[1], N[2], N[3]].sort().map((id) => [id, 1])
		t.check(meta?.vote?.state === 'closed' && JSON.stringify(meta.vote.results) === JSON.stringify(want) && meta.vote.voters === 2, '[B] meta.vote: closed, results (vier Notizen je 1, nach id), voters 2', meta?.vote)
		for (const x of [b, g]) t.check(await closePanel(x.page), `[C] ${x.name}: vote-panel-close`)
		await sleep(2500)
		for (const x of [b, g]) t.check(!(await x.page.locator('[data-knorke-vote-panel]').first().isVisible().catch(() => false)), `[C] ${x.name}: das VotePanel öffnet sich je sid nur einmal`)

		t.step('„Show on board“, dann „Close results“')
		await openPanel(a.page)
		await a.page.locator('[data-knorke-action=vote-show]').first().click()
		const tot = await until(async () => { const v = await sceneVote(b.page); return v && v.totals > 0 ? v : null }, { timeout: 5000 })
		t.check(tot, '[S] bob: nach „Show on board“ totals > 0', await sceneVote(b.page))
		await a.page.locator('[data-knorke-action=vote-clear]').first().click()
		for (const x of [a, b, g]) {
			t.check(await vanishes(x.page, '[data-knorke-vote-bar]', 5000), `[C] ${x.name}: „Close results“ entfernt die Leiste`)
		}
		for (const x of [a, b, g]) {
			t.check(await until(async () => (await sceneVote(x.page)) === null, { timeout: 5000 }), `[C] ${x.name}: scene().voteState === null nach „Close results“ (keine Abzeichen mehr)`, await sceneVote(x.page))
		}

		t.step('Stimme danach: zweite Sitzung über Route 22, alice schließt ihre Seite, vote-expire, Ginas Tipp')
		const s2 = await apiStart(board, { minutes: 10 })
		t.must(s2.status === 200 && s2.data?.board?.meta?.vote?.state === 'open', '[B] zweite Sitzung über Route 22 (minutes 10) → 200', s2.text.slice(0, 200))
		const sid2 = s2.data.board.meta.vote.sid
		await world.drop(a)
		t.check(await until(async () => { const v = await K.votes(g.page); return v && v !== 'missing' && v.sid === sid2 && v.state === 'open' }, { timeout: 6000 }), '[C] Gina: votes() {sid neu, state open}', await K.votes(g.page))
		t.check(await until(async () => (await K.state(g.page)).uiMode === 'vote', { timeout: 3000 }), '[C] Gina wieder im Modus vote')
		const ve = await bridge('vote-expire', board)
		t.check(ve.sid === sid2, '[D] Brücke vote-expire: die zweite Sitzung ist abgelaufen (noch offen)', ve)
		await sleep(600)
		let target = null
		for (const id of N) {
			const r = await hitRect(g.page, id)
			if (r && r.ok && Math.min(r.w, r.h) >= 44) { target = r; break }
		}
		t.must(target, '[C] Gina: eine abstimmbare Notiz ganz im Bild (≥ 44 px)')
		await tapAt(g, target.cx, target.cy)
		const closedToast = await appears(g.page, '[data-knorke-toast=vote-closed]', 6000)
		t.check(closedToast, '[C] Ginas Tipp nach dem Ablauf → [data-knorke-toast=vote-closed]')
		if (closedToast) t.check((await textOf(g.page.locator('[data-knorke-toast=vote-closed]').first())).includes(TEXT3.voteClosed), '[C] Text „Voting has ended.“')
		t.check(await until(async () => (await K.votes(g.page))?.state === 'closed', { timeout: 6000 }), '[C] Gina: votes().state closed (Weg (a) hat geschlossen)', await K.votes(g.page))
		for (const x of [b, g]) await world.drop(x)
	},
}

/**
 * P7-11 (SPEC-M1 §33.1 i, k, Revision 22): where an item lies after the row
 * tap "Show on the board" – its screen centre inside the viewport and outside
 * [data-knorke-bar=vote] and every visible [data-knorke-vote-panel].
 * @return {Promise<{ok: boolean, centre?: number[], hit?: object[]}>}
 */
async function focusPlace(page, id) {
	const r = await K.rect(page, id)
	if (!r) return { ok: false, rect: null }
	return page.evaluate(([cx, cy]) => {
		const vw = document.documentElement.clientWidth || window.innerWidth
		const vh = document.documentElement.clientHeight || window.innerHeight
		const boxes = [...document.querySelectorAll('[data-knorke-bar=vote], [data-knorke-vote-panel]')].filter((el) => {
			const st = getComputedStyle(el)
			const b = el.getBoundingClientRect()
			return st.display !== 'none' && st.visibility !== 'hidden' && b.width > 0 && b.height > 0
		}).map((el) => {
			const b = el.getBoundingClientRect()
			return { name: el.matches('[data-knorke-bar=vote]') ? 'bar' : 'panel', l: b.left, t: b.top, r: b.right, b: b.bottom }
		})
		const hit = boxes.filter((b) => cx >= b.l && cx <= b.r && cy >= b.t && cy <= b.b)
		return { ok: cx >= 0 && cx <= vw && cy >= 0 && cy <= vh && hit.length === 0, centre: [cx, cy], vw, vh, hit }
	}, [r.x + r.w / 2, r.y + r.h / 2]).catch(() => ({ ok: false }))
}

/**
 * A viewport pass of E31 (§8.4 R16): bar, list (open at the start in the
 * narrow layout), one vote through the list, bars. P7-C (SPEC-M1 §33.1 k,
 * ED-27): in the phone pass (≤ 600 px) a tap on the row text
 * ([data-knorke-vote-item=<id>] [data-knorke-action=vote-focus]) closes the
 * sheet within 3 s and brings the item into the free part of the screen.
 */
function e31Pass(vp) {
	return {
		id: 'E31',
		pass: `${vp.width}x${vp.height}`,
		title: `Punkte-Abstimmung bei ${vp.width} × ${vp.height} (R16/R17): Leiste unten, Liste${vp.width <= 600 ? ' beim Start offen' : ''}, eine Stimme über die Liste (vote-add), Bars ohne Überlappung, VoteBar unten (§6.6 (5), K7)`,
		async run(t, world) {
			await world.limiterReset()
			const narrow = vp.width <= 600
			const board = await world.board(`E2E Abstimmung ${vp.width}`)
			const L = await linkToken(board)
			const [F, ...N] = [ulid(), ulid(), ulid(), ulid(), ulid()]
			const res = await seedOps('alice', board, frameWithNotes(F, N))
			t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: Frame mit vier Notizen', res)
			const g = await world.actor(`gina-${vp.width}`, { touch: true, viewport: vp })
			await joinAsGuest(g, L, 'Gina')
			t.must(voting(await featuresOf(g.page)), '[C] FEATURES.voting (Stufe 3)')
			const s = await apiStart(board, { scope: F })
			t.must(s.status === 200, '[B] Start über Route 22 → 200', s.text.slice(0, 200))
			t.check(await appears(g.page, OPEN_BAR, 3000), '[C] Leiste [data-knorke-vote-bar] offen ≤ 3 s')
			let panelOpen = null
			if (narrow) {
				panelOpen = !!(await appears(g.page, '[data-knorke-vote-panel]', 3000))
				t.check(panelOpen, '[C] Schmal-Layout: das VotePanel ist beim Sitzungsbeginn offen (R16 (4))')
			} else {
				t.check(await openPanel(g.page), '[C] Stimmliste über vote-panel geöffnet')
			}
			await listVote(g.page, N[0])
			t.check(await until(async () => (await mineOf(g.page))[N[0]] === 1, { timeout: 3000 }), '[C] vote-add → mine {Notiz 1: 1}', await K.votes(g.page))
			t.check(await until(async () => (await barLeft(g.page)) === '2', { timeout: 5000 }), '[C] data-knorke-vote-left = 2', await barLeft(g.page))
			if (narrow) {
				// P7-11: "Show on the board" in the narrow layout closes the sheet first, then zoomToItem
				const focus = g.page.locator(`[data-knorke-vote-item="${N[0]}"] [data-knorke-action=vote-focus]`).first()
				const tapped = await focus.tap({ timeout: 3000 }).then(() => true, () => false)
				t.check(tapped, '[C] Zeilentipp (P7-11): [data-knorke-vote-item=<Notiz 1>] [data-knorke-action=vote-focus] da und getippt')
				t.check(await vanishes(g.page, '[data-knorke-vote-panel]', 3000), '[C] Zeilentipp: [data-knorke-vote-panel] binnen 3 s nicht mehr sichtbar (Schmal-Layout schließt das Sheet zuerst)')
				const placed = await until(async () => { const m = await focusPlace(g.page, N[0]); return m.ok ? m : null }, { timeout: 3000 })
				t.check(!!placed, '[C] Zeilentipp: Bildschirmmitte von Notiz 1 im Viewport, außerhalb von [data-knorke-bar=vote] und jedem sichtbaren [data-knorke-vote-panel]', placed || await focusPlace(g.page, N[0]))
			}
			t.check(await closePanel(g.page), '[C] vote-panel-close schließt die Liste')
			const m = await bars(g.page, { panelOpenAtStart: panelOpen, requireVote: true })
			t.check(m.problems.length === 0, `[C] Bars bei ${vp.width} × ${vp.height}: keine Überlappung, alles im Viewport, VoteBar unten (R17 K7)${narrow ? ', höchstens ein Banner' : ''}`, { problems: m.problems, bars: m.snap?.bars?.filter((x) => x.visible) })
			t.check(m.snap?.bars?.some((x) => x.name === 'vote' && x.visible), '[C] [data-knorke-bar=vote] sichtbar', m.snap?.bars)
			await world.drop(g)
		},
	}
}
export const E31_PHONE = e31Pass(PHONE)
export const E31_TABLET = e31Pass(TABLET)

// ── E32 ──────────────────────────────────────────────────────────────────

/** Remaining time of the page's timer: from meta().timer and state().clockOffset at this moment (R16 TST-09). */
function leftOf(page) {
	return page.evaluate(() => {
		const k = window.__knorke
		const m = typeof k?.meta === 'function' ? k.meta()?.timer : null
		if (!m) return null
		const off = k.state().clockOffset || 0
		return { state: m.state, left: m.state === 'running' ? m.end - (Date.now() + off) : m.left, seq: m.seq }
	}).catch(() => null)
}

/** The timer hook [data-knorke-timer]: {state, left} of its attributes. */
async function timerHook(page) {
	const el = page.locator('[data-knorke-timer]').first()
	if (!(await el.isVisible().catch(() => false))) return null
	return { state: await el.getAttribute('data-knorke-timer-state').catch(() => null), left: Number(await el.getAttribute('data-knorke-timer-left').catch(() => NaN)) }
}

/**
 * Runs a timer action in [data-knorke-dialog=timer] (opened through the menu
 * entry timer-open) and waits for the PUT …/timer it sends (route 24).
 * @return {Promise<{status: number, body: object|null}|null>} null when no request went out within 5 s
 */
async function timerAction(page, name) {
	const dlg = page.locator('[data-knorke-dialog=timer]').first()
	// a dialog that is closing (start and stop may close it) must not take the click
	await sleep(400)
	if (!(await dlg.isVisible().catch(() => false))) {
		await menuAction(page, 'timer-open')
		await dlg.waitFor({ state: 'visible', timeout: 5000 })
	}
	const resp = page.waitForResponse((r) => /\/api\/v1\/boards\/\d+\/timer$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 5000 }).catch(() => null)
	await dlg.locator(`[data-knorke-action=${name}]`).first().click({ timeout: 5000 })
	const r = await resp
	if (!r) return null
	let body = null
	try { body = r.request().postDataJSON() } catch { body = null }
	return { status: r.status(), body }
}

/** All pages within ±1 s of the first (alice), measured at the same moment. */
async function sameLeft(pages, timeout = 4000) {
	let last = null
	const ok = await until(async () => {
		const ls = await Promise.all(pages.map(leftOf))
		last = ls
		if (ls.some((x) => !x || !Number.isFinite(x.left))) return false
		return ls.every((x) => x.state === ls[0].state && Math.abs(x.left - ls[0].left) <= 1000)
	}, { timeout, every: 200 })
	return { ok: !!ok, last }
}

export const E32 = {
	id: 'E32',
	title: 'Timer (R16): Start 1 min, Pause, +1, Weiter, bob lädt neu – Restzeit aus meta().timer und clockOffset bei allen ±1 s, data-knorke-timer-left passt; Ende über Route 24 (3 s) → timer-state done und Banner time_up bei allen ≤ 6 s',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E2E Timer')
		const L = await linkToken(board)
		const a = await world.actor('alice-timer', { user: 'alice' })
		await openBoard(a, board)
		t.must(voting(await featuresOf(a.page)), '[C] FEATURES.voting (Stufe 3)')
		const b = await world.actor('bob-timer', { user: 'bob' })
		await joinAsMember(b, L)
		const g = await world.actor('gina-timer')
		await joinAsGuest(g, L, 'Gina')
		const pages = [a.page, b.page, g.page]

		t.step('alice startet 1 min im Timer-Dialog')
		await menuAction(a.page, 'timer-open')
		const dlg = a.page.locator('[data-knorke-dialog=timer]').first()
		t.must(await dlg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] [data-knorke-dialog=timer] über das Moderationsmenü (timer-open)')
		await field(a.page, 'timer-minutes', '1')
		await dlg.locator('[data-knorke-action=timer-start]').first().click()
		let r = await sameLeft(pages)
		t.check(r.ok && r.last[0].state === 'running' && r.last[0].left > 50000 && r.last[0].left <= 60000, '[C] laufend: Restzeit bei bob und Gina ±1 s zu alices (meta().timer + clockOffset)', r.last)
		for (const [who, p] of [['alice', a.page], ['bob', b.page], ['Gina', g.page]]) {
			const [h, l] = [await timerHook(p), await leftOf(p)]
			t.check(h && h.state === 'running' && l && h.left >= l.left - 1000 && h.left <= l.left + 2000 && h.left % 1000 === 0, `[C] ${who}: [data-knorke-timer] running, data-knorke-timer-left = angezeigte Restzeit (ganze Sekunden)`, { h, l })
		}

		t.step('Pause, +1, Weiter')
		let put = await timerAction(a.page, 'timer-pause')
		t.check(put && put.status === 200 && put.body?.action === 'pause', '[C] timer-pause sendet PUT …/timer {action: pause} → 200', put)
		r = await sameLeft(pages)
		t.check(r.ok && r.last[0].state === 'paused', '[C] pausiert: alle gleich (±1 s)', r.last)
		const paused = r.last?.[0]?.left ?? 0
		put = await timerAction(a.page, 'timer-add1')
		t.check(put && put.status === 200 && put.body?.action === 'add' && put.body?.ms === 60000, '[C] timer-add1 sendet {action: add, ms: 60000} → 200', put)
		r = await sameLeft(pages)
		t.check(r.ok && r.last[0].state === 'paused' && Math.abs(r.last[0].left - (paused + 60000)) <= 1000, '[C] +1: Restzeit + 60 s bei allen', r.last)
		put = await timerAction(a.page, 'timer-resume')
		t.check(put && put.status === 200 && put.body?.action === 'resume', '[C] timer-resume sendet {action: resume} → 200', put)
		r = await sameLeft(pages)
		t.check(r.ok && r.last[0].state === 'running', '[C] weiter: laufend, alle gleich (±1 s)', r.last)
		for (const p of pages) t.check((await timerHook(p))?.state === 'running', '[C] [data-knorke-timer-state=running]')

		t.step('bob lädt neu')
		await b.page.reload({ waitUntil: 'domcontentloaded' })
		await waitReady(b.page, 30000)
		r = await sameLeft(pages)
		t.check(r.ok && r.last[1].state === 'running', '[C] nach dem Neuladen: bobs Restzeit ±1 s zu alices', r.last)

		t.step('Ende: stop, dann Route 24 {start, ms 3000}')
		put = await timerAction(a.page, 'timer-stop')
		t.check(put && put.status === 200 && put.body?.action === 'stop', '[C] timer-stop sendet {action: stop} → 200', put)
		t.check(await until(async () => (await Promise.all(pages.map(leftOf))).every((x) => x === null), { timeout: 4000 }), '[C] stop: kein Timer mehr bei allen')
		await a.page.keyboard.press('Escape').catch(() => {})
		const st = await api('alice', 'PUT', `/api/v1/boards/${board}/timer`, { action: 'start', ms: 3000 })
		t.check(st.status === 200 && st.data?.board?.meta?.timer?.state === 'running' && st.data.board.meta.timer.dur === 3000, '[B] Route 24 {start, ms 3000} → 200, timer running', st.text.slice(0, 200))
		const t0 = Date.now()
		const done = await Promise.all(pages.map((p) => until(async () => (await timerHook(p))?.state === 'done' && await bannerVisible(p, 'time_up'), { timeout: 6000 })))
		t.check(done.every(Boolean), `[C] binnen 6 s bei allen data-knorke-timer-state=done und [data-knorke-banner=time_up] (${done.map(Boolean).join(', ')}, ${Date.now() - t0} ms)`)
		for (const x of [a, b, g]) await world.drop(x)
	},
}

// ── E33 ──────────────────────────────────────────────────────────────────

export const E33 = {
	id: 'E33',
	title: 'Folgen (R16, reducedMotion): bob folgt alice (Teilnehmer-Knopf) ≤ 3 s, eigenes Schwenken beendet; „Bring everyone here“: bob ≤ 3 s, Gina (Tablet) ≤ 5 s; Gina schwenkt weg → Chip, Tipp folgt wieder; Tipp unter dem Finger während einer Abstimmung; „Edit“: Frame-Liste und Umschalt+2; Stop; zweites „Bring everyone here“ holt Gina wieder',
	async run(t, world) {
		await world.limiterReset()
		const board = await world.board('E2E Folgen')
		const L = await linkToken(board)
		const [F, NF] = [ulid(), ulid()]
		const N = Array.from({ length: 8 }, () => ulid())
		const res = await seedOps('alice', board, [
			...N.map((id, i) => put.sticky(id, { x: (i % 4) * 300, y: Math.floor(i / 4) * 300, w: 200, h: 200, data: { text: `F${i + 1}` } })),
			put.frame(F, { x: 2400, y: 1600, w: 800, h: 500, data: { title: 'Phase 2' } }),
			put.sticky(NF, { parent: F, x: 300, y: 150, w: 200, h: 200, data: { text: 'Im Frame' } }),
		])
		t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: acht Notizen (200 × 200), ein Frame mit einer Notiz', res)
		const a = await world.actor('alice-folgen', { user: 'alice', reducedMotion: 'reduce' })
		await openBoard(a, board)
		t.must(voting(await featuresOf(a.page)), '[C] FEATURES.voting (Stufe 3)')
		const b = await world.actor('bob-folgen', { user: 'bob', reducedMotion: 'reduce' })
		await joinAsMember(b, L)
		const g = await world.actor('gina-folgen', { touch: true, reducedMotion: 'reduce' })
		await joinAsGuest(g, L, 'Gina')
		const alicePid = (await K.state(a.page)).pid
		// alice at 100 % over the notes: on Gina's tablet they stay ≥ 44 px (R16 CLI-06)
		await a.page.locator(CANVAS).first().focus()
		await a.page.keyboard.press('Shift+Digit0')
		await sleep(300)

		t.step('bob folgt alice über ihren Teilnehmer-Knopf; alice schwenkt')
		const pb = b.page.locator(`[data-knorke-participant="${alicePid}"]`).first()
		t.must(await pb.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false), '[C] bob: Teilnehmer-Knopf [data-knorke-participant=<alice>]')
		await pb.click()
		t.check(await until(async () => (await K.state(b.page)).following === alicePid, { timeout: 3000 }), '[C] bob: state().following = alices pid', await K.state(b.page))
		t.check((await pb.getAttribute('aria-pressed').catch(() => null)) === 'true', '[C] Teilnehmer-Knopf aria-pressed="true"')
		await wheelPan(a.page, 0, 600)
		let lead = await viewCenter(a.page)
		let fb = await follows(b.page, alicePid, lead, 3000)
		t.check(fb && !fb.failed, '[C] bobs Kamera-Mitte folgt alices view (±5 % der Viewport-Breite) ≤ 3 s nach dem Schwenk', fb)

		t.step('bob schwenkt selbst: Folgen endet')
		await wheelPan(b.page, 0, -300)
		t.check(await until(async () => (await K.state(b.page)).following === null, { timeout: 2000 }), '[C] bob: eigenes Schwenken beendet das Folgen', await K.state(b.page))

		t.step('alice „Bring everyone here“: bob und Gina folgen')
		await menuAction(a.page, 'summon')
		const both = await Promise.all([b, g].map((x) => until(async () => (await K.state(x.page)).following === alicePid, { timeout: 5000 })))
		t.check(both.every(Boolean), `[C] bob und Gina folgen alice (state().following, ${both.map(Boolean).join(', ')})`)
		t.check(await appears(b.page, '[data-knorke-banner=following]', 3000), '[C] bob: [data-knorke-banner=following]')
		await wheelPan(a.page, 600, 0)
		lead = await viewCenter(a.page)
		fb = await follows(b.page, alicePid, lead, 3000)
		t.check(fb && !fb.failed, '[C] Desktop (bob) folgt ≤ 3 s', fb)
		const fg = await follows(g.page, alicePid, lead, 5000)
		t.check(fg && !fg.failed, '[C] Tablet (Gina) folgt ≤ 5 s (Sprünge im 2-s-Takt)', fg)

		t.step('Gina schwenkt weg und tippt auf den Chip')
		let gbox = await canvasBox(g.page)
		await swipe(g, gbox.x + gbox.width / 2, gbox.y + gbox.height / 2, -150, 0)
		t.check(await until(async () => (await K.state(g.page)).following === null, { timeout: 2000 }), '[C] Gina: Wegschwenken beendet das Folgen', await K.state(g.page))
		const chip = g.page.locator('[data-knorke-follow-chip]').first()
		t.check(await chip.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] Gina: [data-knorke-follow-chip] erscheint')
		const cb = await chip.boundingBox().catch(() => null)
		t.check(cb && cb.height >= 44, '[C] Chip-Ziel ≥ 44 px', cb)
		await chip.tap().catch(async () => { if (cb) await tapAt(g, cb.x + cb.width / 2, cb.y + cb.height / 2) })
		t.check(await until(async () => (await K.state(g.page)).following === alicePid, { timeout: 3000 }), '[C] Tipp auf den Chip → Gina folgt wieder', await K.state(g.page))

		t.step('Abstimmung während „Alle zu mir“: alice schwenkt fortlaufend, Gina tippt')
		// alice's view back over the notes (at 100 % they are ≥ 44 px on Gina's tablet, R16 CLI-06)
		t.check(await centerOn(a.page, 550, 250), '[D] Vorbedingung: alices Ansicht über den Notizen (100 %)')
		const vs = await apiStart(board, {})
		t.must(vs.status === 200, '[B] Start über Route 22 → 200', vs.text.slice(0, 200))
		t.check(await until(async () => (await K.state(g.page)).uiMode === 'vote', { timeout: 5000 }), '[C] Gina im Modus vote', await K.state(g.page))
		t.check((await K.state(g.page)).following === alicePid, '[C] Gina folgt weiter (eine offene Sitzung beendet das Folgen nicht)', await K.state(g.page))
		let panning = true
		const abox = await canvasBox(a.page)
		await a.page.mouse.move(abox.x + abox.width / 2, abox.y + abox.height / 2)
		const loop = (async () => {
			let i = 0
			while (panning) {
				await a.page.mouse.wheel(0, i % 30 < 15 ? 30 : -30).catch(() => {})
				i++
				await sleep(120)
			}
		})()
		try {
			await sleep(2500)
			let target = null
			let tid = null
			for (const id of N) {
				const r = await hitRect(g.page, id)
				if (r && r.ok && Math.min(r.w, r.h) >= 44) { target = r; tid = id; break }
			}
			t.must(target, '[C] Gina: eine Notiz ganz im Bild, ≥ 44 px (Notizgröße, R16 CLI-06)')
			const cam0 = await K.camera(g.page)
			const t0 = Date.now()
			await touch(g, 'touchStart', [{ x: target.cx, y: target.cy }])
			const resp = g.page.waitForResponse((r) => /\/sync$/.test(r.url()), { timeout: 300 }).catch(() => null)
			await K.forceTick(g.page).catch(() => {})
			await resp
			const cam1 = await K.camera(g.page)
			await sleep(Math.max(0, 120 - (Date.now() - t0)))
			await touch(g, 'touchEnd', [])
			const held = Date.now() - t0
			const tRel = Date.now()
			t.check(held <= 450, '[D] Tipp-Dauer ≤ 450 ms (touchStart → forceTick → Antwort → touchEnd)', held)
			t.check(JSON.stringify(cam1) === JSON.stringify(cam0), '[C] zwischen pointerdown und Tipp springt die Kamera nicht (Sprung zurückgehalten)', { cam0, cam1 })
			const camRel = await K.camera(g.page)
			let moved = null
			while (Date.now() - tRel < 1400) {
				const c = await K.camera(g.page)
				if (JSON.stringify(c) !== JSON.stringify(camRel)) { moved = Date.now() - tRel; break }
				await sleep(100)
			}
			t.check(moved === null, '[C] der zurückgehaltene Sprung kommt frühestens 1,5 s nach dem Loslassen', moved)
			const mine = await until(async () => { const m = await mineOf(g.page); return m[tid] === 1 ? m : null }, { timeout: 5000 })
			t.check(mine && Object.keys(mine).length === 1, '[C] die Stimme liegt auf genau der getippten Notiz', await K.votes(g.page))
			const later = await until(async () => JSON.stringify(await K.camera(g.page)) !== JSON.stringify(camRel), { timeout: 6000 })
			t.check(later, '[C] danach folgt Gina wieder (die Kamera springt)')
		} finally {
			panning = false
			await loop
		}

		t.step('alice schaltet auf „Edit“: Frame-Liste und Umschalt+2')
		await a.page.locator('[data-knorke-action=vote-mode]').first().click()
		t.check(await until(async () => (await K.state(a.page)).uiMode === 'edit', { timeout: 3000 }), '[C] alice: vote-mode → uiMode edit', await K.state(a.page))
		await a.page.locator('[data-knorke-action=frames]').first().click()
		const fl = a.page.locator('[data-knorke-frame-list]').first()
		t.check(await fl.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] [data-knorke-frame-list] geöffnet (Knopf „Frames“)')
		await fl.locator(`[data-knorke-frame="${F}"]`).first().click()
		const fr = await until(async () => { const r = await hitRect(a.page, F); return r && r.inside ? r : null }, { timeout: 3000 })
		t.check(fr, '[C] Frame-Liste bringt den Frame ins Bild', await hitRect(a.page, F))
		const nf = await hitRect(a.page, NF)
		t.must(nf && nf.ok, '[C] die Notiz im Frame ist sichtbar', nf)
		await a.page.mouse.click(nf.cx, nf.cy)
		t.check(JSON.stringify(await K.selection(a.page)) === JSON.stringify([NF]), '[S] Klick wählt die Notiz', await K.selection(a.page))
		await wheelPan(a.page, 0, 900)
		await a.page.locator(CANVAS).first().focus()
		await a.page.keyboard.press('Shift+Digit2')
		const sel = await until(async () => { const r = await hitRect(a.page, NF); return r && r.inside && r.w > nf.w ? r : null }, { timeout: 3000 })
		t.check(sel, '[S] Umschalt+2 bringt die Auswahl ins Bild (größer als vorher)', { before: nf, after: await hitRect(a.page, NF) })

		t.step('Gina schwenkt erneut weg; alice „Stop presenting“; zweites „Bring everyone here“')
		gbox = await canvasBox(g.page)
		await swipe(g, gbox.x + gbox.width / 2, gbox.y + gbox.height / 2, 150, 0)
		t.check(await until(async () => (await K.state(g.page)).following === null, { timeout: 2000 }), '[C] Gina steigt aus dieser Präsentation aus', await K.state(g.page))
		await menuAction(a.page, 'summon-end')
		t.check(await until(async () => (await K.state(b.page)).following === null, { timeout: 3000 }), '[C] „Stop presenting“ beendet das Folgen bei bob', await K.state(b.page))
		t.check(await vanishes(b.page, '[data-knorke-banner=following]', 3000), '[C] bob: Banner following weg')
		await menuAction(a.page, 'summon')
		t.check(await until(async () => (await K.state(g.page)).following === alicePid, { timeout: 5000 }), '[C] zweites „Bring everyone here“: Gina folgt wieder (neues Paar seq/at, R16)', await K.state(g.page))
		t.check(await until(async () => (await K.state(b.page)).following === alicePid, { timeout: 5000 }), '[C] … und bob', await K.state(b.page))
		await menuAction(a.page, 'summon-end').catch(() => {})
		for (const x of [a, b, g]) await world.drop(x)
	},
}

/** A viewport pass of E33 (§8.4 R16): Gina follows the presenter during a vote; the bars hold. */
function e33Pass(vp) {
	return {
		id: 'E33',
		pass: `${vp.width}x${vp.height}`,
		title: `Folgen bei ${vp.width} × ${vp.height} (R16/R17): „Bring everyone here“ während einer Abstimmung, Gina folgt, Bars ohne Überlappung, VoteBar unten (§6.6 (5), K7)`,
		async run(t, world) {
			await world.limiterReset()
			const narrow = vp.width <= 600
			const board = await world.board(`E2E Folgen ${vp.width}`)
			const L = await linkToken(board)
			const N = [ulid(), ulid(), ulid(), ulid()]
			const res = await seedOps('alice', board, N.map((id, i) => put.sticky(id, { x: i * 300, y: 0, data: { text: `F${i + 1}` } })))
			t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: vier Notizen', res)
			const a = await world.actor(`alice-folgen-${vp.width}`, { user: 'alice', reducedMotion: 'reduce' })
			await openBoard(a, board)
			const g = await world.actor(`gina-folgen-${vp.width}`, { touch: true, viewport: vp, reducedMotion: 'reduce' })
			await joinAsGuest(g, L, 'Gina')
			t.must(voting(await featuresOf(g.page)), '[C] FEATURES.voting (Stufe 3)')
			const alicePid = (await K.state(a.page)).pid
			const s = await apiStart(board, {})
			t.must(s.status === 200, '[B] Start über Route 22 → 200', s.text.slice(0, 200))
			let panelOpen = null
			if (narrow) panelOpen = !!(await appears(g.page, '[data-knorke-vote-panel]', 3000))
			await closePanel(g.page)
			await menuAction(a.page, 'summon')
			t.check(await until(async () => (await K.state(g.page)).following === alicePid, { timeout: 5000 }), '[C] Gina folgt alice', await K.state(g.page))
			t.check(await appears(g.page, '[data-knorke-banner=following]', 3000), '[C] Banner following sichtbar')
			const m = await bars(g.page, { panelOpenAtStart: panelOpen, requireVote: true })
			t.check(m.problems.length === 0, `[C] Bars bei ${vp.width} × ${vp.height} (FollowBanner und VoteBar): keine Überlappung, alles im Viewport, VoteBar unten (R17 K7)${narrow ? ', höchstens ein Banner, Liste beim Start offen' : ''}`, { problems: m.problems, bars: m.snap?.bars?.filter((x) => x.visible) })
			await menuAction(a.page, 'summon-end').catch(() => {})
			for (const x of [a, g]) await world.drop(x)
		},
	}
}
export const E33_PHONE = e33Pass(PHONE)
export const E33_TABLET = e33Pass(TABLET)

// ── E28 (stage-3 additions, viewport passes) ─────────────────────────────

/**
 * A viewport pass of E28 (§8.4 R13/R16/R17): the vote link with an empty
 * name → "Guest", vote_ready, bars; then (R17 K7) alice starts a session
 * through route 22 and the bars check runs again with the VoteBar, which
 * must dock at the bottom in this viewport too.
 */
function e28Pass(vp) {
	return {
		id: 'E28',
		pass: `${vp.width}x${vp.height}`,
		title: `Abstimm-Link bei ${vp.width} × ${vp.height} (R13/R16/R17): „Your votes are anonymous.“, leerer Name → Guest, vote_ready, Bars ohne Überlappung; mit offener Sitzung VoteBar unten (§6.6 (5), K7)`,
		async run(t, world) {
			await world.limiterReset()
			const board = await world.board(`E2E Abstimm-Link ${vp.width}`)
			await linkToken(board)
			const res = await seedOps('alice', board, [put.sticky(ulid(), { x: 0, y: 0, data: { text: 'Idee' } })])
			t.must(res.every((x) => x === 'ok'), '[B] Vorbedingung: eine Notiz', res)
			const vl = await api('alice', 'POST', `/api/v1/boards/${board}/votelink`, {})
			t.must(vl.status === 200 && /^[A-Za-z0-9]{24}$/.test(vl.data?.link?.token || ''), '[B] Abstimm-Link über Route 17 → 200', vl.text.slice(0, 200))
			const g = await world.actor(`gina-link-${vp.width}`, { touch: true, viewport: vp })
			await g.page.goto(`${APP}/p/${vl.data.link.token}`, { waitUntil: 'domcontentloaded' })
			const dlg = g.page.locator('[data-knorke-dialog=guest-name], .knorke-dialog').filter({ has: g.page.locator('[data-knorke-field=guest-name]') }).first()
			await dlg.waitFor({ state: 'visible', timeout: 15000 })
			t.must(voting(await featuresOf(g.page)), '[C] FEATURES.voting (Stufe 3)')
			t.check((await textOf(dlg)).includes(TEXT3.anonymous), '[C] Namensdialog des Abstimm-Links: „Your votes are anonymous.“', await textOf(dlg))
			await field(g.page, 'guest-name', '')
			await action(g.page, 'guest-join')
			await waitReady(g.page, 30000)
			const st = await K.state(g.page)
			t.check(st.name === TEXT3.guest && st.role === 'vote' && st.uiMode === 'view', '[C] leerer Name → state().name „Guest“, role vote, uiMode view', st)
			t.check(await until(() => bannerVisible(g.page, 'vote_ready'), { timeout: 5000 }), '[C] Banner [data-knorke-banner=vote_ready]')
			const m = await bars(g.page)
			t.check(m.problems.length === 0, `[C] Bars bei ${vp.width} × ${vp.height}: keine Überlappung, alles im Viewport${vp.width <= 600 ? ', höchstens ein Banner' : ''}`, { problems: m.problems, bars: m.snap?.bars?.filter((x) => x.visible) })
			// R17 K7: with an open session the VoteBar docks at the bottom in this viewport too (§6.6 (2), (5))
			const narrow = vp.width <= 600
			const s = await apiStart(board, {})
			t.must(s.status === 200, '[B] Start über Route 22 → 200', s.text.slice(0, 200))
			t.check(await appears(g.page, OPEN_BAR, 3000), '[C] Abstimm-Link: Leiste [data-knorke-vote-bar] offen ≤ 3 s')
			let panelOpen = null
			if (narrow) panelOpen = !!(await appears(g.page, '[data-knorke-vote-panel]', 3000))
			t.check(await closePanel(g.page), '[C] vote-panel-close schließt die Liste (falls offen)')
			const mv = await bars(g.page, { panelOpenAtStart: panelOpen, requireVote: true })
			t.check(mv.problems.length === 0, `[C] Bars bei ${vp.width} × ${vp.height} mit offener Sitzung: VoteBar unten (R17 K7), keine Überlappung, alles im Viewport${narrow ? ', höchstens ein Banner, Liste beim Start offen' : ''}`, { problems: mv.problems, bars: mv.snap?.bars?.filter((x) => x.visible) })
			await world.drop(g)
		},
	}
}
export const E28_PHONE = e28Pass(PHONE)
export const E28_TABLET = e28Pass(TABLET)
