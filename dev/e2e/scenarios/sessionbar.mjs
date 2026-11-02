/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E98 (factory job 233, redesign docs/redesign/ P7, P11, V10): the session
 * bar in the browser. Two notes N (0, 0) and M (400, 0), 200 × 200; alice
 * (owner, moderator) on a desktop of 1024 × 768 with the mouse, then on a
 * phone (390 × 844, touch).
 *   (1) a timer (route 24) and a vote (route 22) start: the session bar
 *       [data-knorke-bar=session] shows the segments timer and vote in this
 *       order; the top bar has no [data-knorke-timer]; the bar overlaps
 *       neither the zoom bar, the undo island nor the tool bar
 *   (2) "List" of the bar opens the vote list: 296 px wide, on the right
 *   (3) mode vote: a click 11 px right and 11 px above N's badge centre
 *       (outside N) gives N a vote (the badge's 32 px target)
 *   (4) a thread on M: its bubble stands right of M, top aligned; a click
 *       opens the comment panel with that thread inside
 *   (5) the moderation menu shows "Running now"; × "End timer" in the bar
 *       ends the timer: meta.timer gone, the timer segment too
 *   (6) "Bring everyone here": the bar shows "You're presenting"; at 700 px
 *       (round 3) one line does not fit: the bar turns into two lines over
 *       the board's width, nothing cut off, the zoom bar above it; back at
 *       1024 px one line again; its "End" ends the presentation
 *   (7) the phone, with a timer running again (round 5): the bar spans the
 *       width at the viewport's bottom with two lines, the timer in them is
 *       text (no button), every button ≥ 44 px, the bars check holds (zoom
 *       controls above it); "Timer …" of the menu opens the timer dialog
 * Own board, no instance setting: before E09, directly after E97 (job 232's;
 * E97 until the merge with job 232).
 * Flake gate: --only E98 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] shell,
 * session and __knorke, [S] scene, [B] a server answer or stored server
 * state, [D] a harness precondition. Waiting polls from Node with until().
 */
import { CANVAS, K, PHONE, api, openBoard, put, seedOps, sleep, ulid, until } from '../lib/harness.mjs'
import { checkBars, collectBars } from '../lib/bars.mjs'
import { menuAction } from '../lib/moderation.mjs'

const TITLE = 'E98 Sitzungsleiste'
const VIEW = { width: 1024, height: 768 }
const BAR = '[data-knorke-bar=session]'

/** @return {Promise<{x:number, y:number, w:number, h:number}|null>} the box of the first visible match */
const boxOf = (page, sel) => page.locator(sel).first().boundingBox({ timeout: 1000 }).then((b) => (b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null), () => null)
/** @return {Promise<string[]>} the segments of the session bar, in order */
const segments = (page) => page.locator(`${BAR} [data-knorke-session]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-session'))).catch(() => [])
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const overlaps = (a, b) => !!a && !!b && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5

export const E98 = {
	id: 'E98',
	title: 'Sitzungsleiste (Job 233): Timer und Abstimmung unten mittig statt in der Kopfzeile, ohne Überlappung; „Liste“ 296 px rechts; Stimme über das Abzeichen außerhalb der Notiz; Kommentarblase rechts öffnet das Panel; „Läuft gerade“; × beendet den Timer; „Du präsentierst · Beenden“; Telefon zweizeilig, Knöpfe ≥ 44 px',
	async run(t, world) {
		const B = await world.board(TITLE)
		const [N, M] = [ulid(), ulid()]
		const res = await seedOps('alice', B, [
			put.sticky(N, { x: 0, y: 0, data: { text: 'N' } }),
			put.sticky(M, { x: 400, y: 0, data: { text: 'M' } }),
		])
		t.must(res.every((r) => r === 'ok'), '[D] Vorbedingung: zwei Notizen', res)

		const a = await world.actor('alice-sessionbar', { user: 'alice', viewport: VIEW })
		const p = a.page
		try {
			await openBoard(a, B)
			await p.locator(CANVAS).first().focus()
			await p.keyboard.press('Shift+Digit1')
			await K.waitIdle(p)
			t.check(!(await visible(p, BAR)), '[C] (1) ohne Timer, Abstimmung und Präsentation keine Sitzungsleiste')

			t.step('(1) Timer und Abstimmung starten: eine Leiste unten mittig, Segmente Timer, Abstimmung; kein Timer in der Kopfzeile')
			const tm = await api('alice', 'PUT', `/api/v1/boards/${B}/timer`, { action: 'start', ms: 300000 })
			t.must(tm.status === 200, '[B] (1) Timer über Route 24 → 200', tm.text.slice(0, 200))
			const vs = await api('alice', 'POST', `/api/v1/boards/${B}/vote`, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: 10 })
			t.must(vs.status === 200, '[B] (1) Abstimmung über Route 22 → 200', vs.text.slice(0, 200))
			t.must(await until(async () => (await segments(p)).join() === 'timer,vote', { timeout: 5000 }), '[C] (1) Segmente timer, vote', await segments(p))
			t.check((await p.locator('[data-knorke-bar=top] [data-knorke-timer]').count()) === 0, '[C] (1) kein Timer in der Kopfzeile')
			const text = (await p.locator(BAR).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
			t.check(/Timer/.test(text) && /3 of 3 votes left/.test(text), '[C] (1) „Timer …“ und „3 of 3 votes left“ in der Leiste', text)
			await sleep(400)
			const bar = await boxOf(p, BAR)
			const others = { zoom: await boxOf(p, '.knorke-zoom'), undo: await boxOf(p, '.knorke-undo'), tools: await boxOf(p, '.knorke-toolbar') }
			const hits = Object.entries(others).filter(([, b]) => overlaps(bar, b)).map(([k]) => k)
			t.check(!!bar && hits.length === 0, '[C] (1) 1024 × 768: die Leiste überlappt weder Zoomleiste noch Rückgängig-Insel noch Werkzeugleiste', { bar, ...others, hits })
			t.check(!!bar && Math.abs(bar.x + bar.w / 2 - VIEW.width / 2) < 120, '[C] (1) die Leiste steht unten mittig', bar)

			t.step('(2) „Liste“ öffnet die Abstimmungsliste rechts, 296 px breit')
			await p.locator(`${BAR} [data-knorke-action=vote-panel]`).first().click()
			t.must(await until(() => visible(p, '[data-knorke-vote-panel]'), { timeout: 3000 }), '[C] (2) [data-knorke-vote-panel] offen')
			const panel = await boxOf(p, '[data-knorke-vote-panel]')
			const board = await boxOf(p, '.knorke-board')
			t.check(!!panel && Math.abs(panel.w - 296) <= 1, '[C] (2) die Liste ist 296 px breit', panel)
			t.check(!!panel && !!board && Math.abs(board.x + board.w - 8 - (panel.x + panel.w)) <= 1, '[C] (2) die Liste steht rechts (8 px Rand)', { panel, board })
			t.check(!!panel && !!bar && panel.y + panel.h <= bar.y, '[C] (2) die Liste endet über der Leiste', { panel, bar })
			await p.locator('[data-knorke-action=vote-panel-close]').first().click().catch(() => {})
			await until(async () => !(await visible(p, '[data-knorke-vote-panel]')), { timeout: 3000 })

			t.step('(3) Modus vote: ein Klick neben die Ecke von N, außerhalb der Notiz, trifft ihr Abzeichen')
			if ((await K.state(p)).uiMode !== 'vote') await p.locator(`${BAR} [data-knorke-action=vote-mode]`).first().click().catch(() => {})
			t.must(await until(async () => (await K.state(p)).uiMode === 'vote', { timeout: 3000 }), '[C] (3) alice ist im Modus vote', (await K.state(p)).uiMode)
			await K.waitIdle(p)
			const scale = (await K.camera(p)).scale
			const d = Math.max(0, 11 - 16 * scale)
			const corner = await K.w2s(p, 200, 0)
			const at = { x: corner.x + d + 11, y: corner.y - d - 11 }
			const rn = await K.rect(p, N)
			t.check(!!rn && (at.x > rn.x + rn.w || at.y < rn.y), '[D] (3) der Klickpunkt liegt außerhalb von N', { at, rn })
			await p.mouse.click(at.x, at.y)
			t.check(await until(async () => ((await K.votes(p))?.mine ?? {})[N] === 1, { timeout: 3000 }), '[C] (3) N hat eine Stimme von alice', (await K.votes(p))?.mine)
			t.check(((await K.votes(p))?.mine ?? {})[M] === undefined, '[C] (3) M hat keine Stimme', (await K.votes(p))?.mine)

			t.step('(4) eine Kommentarblase steht rechts neben M und öffnet das Panel mit ihrem Thread')
			const th = await api('alice', 'POST', `/api/v1/boards/${B}/comments`, { text: 'E98 Blase', item: M, x: 500, y: 100 })
			const T = th.data?.thread?.id ?? null
			t.must(th.status === 201 && T, '[B] (4) Thread an M über Route 36 → 201', th.text.slice(0, 200))
			const bubbleSel = `[data-knorke-bubble="${T}"]`
			t.must(await until(() => visible(p, bubbleSel), { timeout: 8000 }), '[C] (4) die Blase des Threads ist da')
			const bubble = await boxOf(p, bubbleSel)
			const rm = await K.rect(p, M)
			t.check(!!bubble && !!rm && bubble.x >= rm.x + rm.w + 2 && Math.abs(bubble.y - rm.y - 18) <= 3, '[C] (4) die Blase steht rechts neben M, 18 px unter der Oberkante (frei vom Abzeichen)', { bubble, rm })
			const badge = { x: rm.x + rm.w - 14, y: rm.y - 14 - Math.max(0, 11 - 16 * (await K.camera(p)).scale) }
			t.check(!!bubble && bubble.y >= badge.y + 28 + 0.5, '[C] (4) die Blase liegt unter dem Abzeichen-Kreis an Ms Ecke', { bubble, badge })
			await p.locator(bubbleSel).first().click()
			t.check(await until(() => visible(p, `[data-knorke-comments] [data-knorke-thread="${T}"]`), { timeout: 3000 }), '[C] (4) das Kommentar-Panel ist offen, mit dem Thread darin')
			await p.keyboard.press('Escape').catch(() => {})
			await p.locator('[data-knorke-action=comments]').first().click().catch(() => {})
			await until(async () => !(await visible(p, '[data-knorke-comments]')), { timeout: 3000 })

			t.step('(5) „Läuft gerade“ im Menü; × „Timer beenden“ in der Leiste beendet den Timer')
			await p.locator('[data-knorke-menu=moderation] button').first().click().catch(() => {})
			t.check(await until(() => visible(p, '[data-knorke-menu-caption=running]'), { timeout: 3000 }), '[C] (5) das Menü hat den Abschnitt „Running now“')
			t.check(await visible(p, '[data-knorke-menus] [data-knorke-action=vote-end], .knorke-menus [data-knorke-action=vote-end]'), '[C] (5) „End voting“ unter „Running now“')
			await p.keyboard.press('Escape').catch(() => {})
			await sleep(300)
			await p.locator(`${BAR} [data-knorke-action=timer-end]`).first().click()
			t.check(await until(async () => (await K.meta(p))?.timer == null, { timeout: 4000 }), '[B] (5) meta.timer ist weg', (await K.meta(p))?.timer)
			t.check(await until(async () => (await segments(p)).join() === 'vote', { timeout: 3000 }), '[C] (5) nur noch das Segment vote', await segments(p))

			t.step('(6) „Alle hierher holen“: „You\'re presenting“ mit „End“, das die Präsentation beendet')
			await menuAction(p, 'summon')
			t.must(await until(async () => (await segments(p)).join() === 'vote,present', { timeout: 4000 }), '[C] (6) Segmente vote, present', await segments(p))
			t.check(/You.re presenting/.test(await p.locator(`${BAR} [data-knorke-session=present]`).first().innerText().catch(() => '')), '[C] (6) „You\'re presenting“')
			await p.setViewportSize({ width: 700, height: 768 })
			t.check(await until(() => visible(p, `${BAR}.knorke-sessionbar--compact`), { timeout: 3000 }), '[C] (6) 700 px: eine Zeile passt nicht, die Leiste wird zweizeilig')
			const cut = await p.locator(`${BAR}`).first().evaluate((el) => [el, ...el.querySelectorAll('.knorke-sessionbar__line1, .knorke-sessionbar__line2, .knorke-votebar__text')].filter((x) => x.scrollWidth > x.clientWidth + 2).map((x) => x.className)).catch(() => ['?'])
			t.check(cut.length === 0, '[C] (6) 700 px: nichts abgeschnitten', cut)
			t.check(/You.re presenting/.test(await p.locator(BAR).first().innerText().catch(() => '')), '[C] (6) 700 px: „You\'re presenting“ in den Zeilen')
			const cb = await boxOf(p, BAR)
			const cz = await boxOf(p, '.knorke-zoom')
			t.check(!!cb && !!cz && cz.y + cz.h <= cb.y + 0.5, '[C] (6) 700 px: die Zoomleiste steht über der zweizeiligen Leiste', { cb, cz })
			await p.setViewportSize(VIEW)
			t.check(await until(async () => !(await visible(p, `${BAR}.knorke-sessionbar--compact`)) && (await segments(p)).join() === 'vote,present', { timeout: 3000 }), '[C] (6) zurück bei 1024 px: wieder eine Zeile', await segments(p))
			await p.locator(`${BAR} [data-knorke-action=present-end]`).first().click()
			t.check(await until(async () => (await K.meta(p))?.summon == null, { timeout: 4000 }), '[B] (6) meta.summon ist weg', (await K.meta(p))?.summon)
			t.check(await until(async () => (await segments(p)).join() === 'vote', { timeout: 3000 }), '[C] (6) das Segment present ist weg', await segments(p))
		} finally {
			await world.drop(a)
		}

		t.step('(7) Telefon mit laufendem Timer: die Leiste über die volle Breite am unteren Rand, zwei Zeilen, der Timer nur Text, Knöpfe ≥ 44 px')
		const tm2 = await api('alice', 'PUT', `/api/v1/boards/${B}/timer`, { action: 'start', ms: 300000 })
		t.must(tm2.status === 200, '[B] (7) wieder ein Timer über Route 24 → 200', tm2.text.slice(0, 200))
		const ph = await world.actor('alice-sessionbar-phone', { user: 'alice', touch: true, viewport: PHONE })
		const q = ph.page
		try {
			await openBoard(ph, B)
			await K.waitIdle(q)
			if (await visible(q, '[data-knorke-vote-panel]')) {
				await q.locator('[data-knorke-action=vote-panel-close]').first().click().catch(() => {})
				await until(async () => !(await visible(q, '[data-knorke-vote-panel]')), { timeout: 3000 })
			}
			t.must(await until(() => visible(q, `${BAR}.knorke-sessionbar--narrow`), { timeout: 5000 }), '[C] (7) die schmale Leiste ist da')
			const nb = await boxOf(q, BAR)
			t.check(!!nb && nb.x <= 0.5 && nb.w >= PHONE.width - 1 && nb.y + nb.h >= PHONE.height - 1, '[C] (7) volle Breite am unteren Rand', nb)
			t.check(await visible(q, `${BAR} .knorke-sessionbar__line1`) && await visible(q, `${BAR} .knorke-sessionbar__line2`), '[C] (7) zwei Zeilen')
			t.must(await until(() => visible(q, `${BAR} [data-knorke-timer]`), { timeout: 5000 }), '[C] (7) der Timer steht in den Zeilen')
			t.check((await q.locator(`${BAR} button[data-knorke-timer]`).count()) === 0, '[C] (7) der Timer der Zeilen ist kein Knopf (Runde 5)')
			const small = await q.locator(`${BAR} button`).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
				const r = e.getBoundingClientRect()
				return { a: e.getAttribute('data-knorke-action') || e.getAttribute('aria-label') || e.textContent.trim(), w: r.width, h: r.height }
			}).filter((x) => x.w < 43.5 || x.h < 43.5)).catch(() => null)
			t.check(Array.isArray(small) && small.length === 0, '[C] (7) jeder Knopf der Leiste ≥ 44 × 44 px', small)
			const snap = await q.evaluate(collectBars).catch(() => null)
			const problems = checkBars(snap, { requireVote: true })
			t.check(problems.length === 0, '[C] (7) Bars-Prüfung bei 390 × 844: keine Überlappung, alles im Viewport, Leiste unten', problems)
			const zoom = await boxOf(q, '.knorke-zoom')
			t.check(!!zoom && !!nb && zoom.y + zoom.h <= nb.y + 0.5, '[C] (7) die Zoomleiste steht über der Leiste', { zoom, nb })
			await menuAction(q, 'timer-open')
			t.check(await until(() => visible(q, '[data-knorke-dialog=timer]'), { timeout: 3000 }), '[C] (7) „Timer …“ im Menü öffnet den Timer-Dialog')
		} finally {
			await world.drop(ph)
		}
	},
}
