/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * M01 (factory job 214): a measurement, no test. It runs only when --only
 * names it (measure: true, lib/cli.mjs selectScenarios), so a full E2E run
 * never seeds 3000 notes or waits on a throttled phone.
 *
 * alice seeds a board with 3000 notes in 20 frames (lib/votelist.mjs
 * boardOps, /sync in batches of 200, `busy` waited out), turns on its vote
 * link and starts a vote (5 votes, 1 per note, notes only). Mira joins the
 * vote link as a guest on a phone: 390 × 844, device scale factor 3, touch,
 * isMobile, and a 4× CPU throttle over CDP (as G14's throttled first
 * render). Three times, each after a reload, with the vote list closed:
 *   V1 a tap on the list button of the vote bar until all 3000 rows are in
 *      the DOM and one frame later (plus the longest long task in between)
 *   V2 the list scrolled from top to bottom in 120 frames (scrollTop per
 *      frame, on the main thread like the cautious reading of a finger),
 *      fps and % missed against the idle rAF interval
 *   V3 a tap on "+" of a row in the middle of the list until that row shows
 *      the own vote
 * The report gets the values of every repetition, the medians and the
 * verdicts of the vote list thresholds (lib/votelist.mjs judge); a failed
 * threshold leaves the case green (a measurement), a broken flow makes it red.
 */
import { randomBytes } from 'node:crypto'
import { APP, PHONE, api, field, action, waitReady, until, sleep, ulid } from '../lib/harness.mjs'
import { BATCH, NOTES, REPS, SCROLL_FRAMES, boardOps, frameSummary, judge, medians, reportMarkdown } from '../lib/votelist.mjs'

const BAR = '[data-knorke-vote-bar][data-knorke-vote-state=open]'
const PANEL = '[data-knorke-vote-panel]'
const OPEN_BUTTON = '[data-knorke-action=vote-panel]:visible'
const ROWS = '[data-knorke-vote-panel] [data-knorke-vote-item]'

/**
 * Writes ops through /sync in batches as alice; `busy` is waited out with the same seq.
 * @return {Promise<number>} the last rev
 */
async function seedBatches(board, ops) {
	const s = await api('alice', 'GET', `/api/v1/boards/${board}/snapshot`)
	if (s.status !== 200) throw new Error(`Snapshot ${board}: ${s.status} ${s.text.slice(0, 200)}`)
	const client = 'cMess' + randomBytes(4).toString('hex').slice(0, 6)
	let rev = s.data.rev
	let seq = 0
	for (let i = 0; i < ops.length; i += BATCH) {
		seq++
		for (let attempt = 0; ; attempt++) {
			const r = await api('alice', 'POST', `/api/v1/boards/${board}/sync`, { proto: 2, client, since: rev, ep: s.data.epoch, pres: 0, seq, ops: ops.slice(i, i + BATCH) })
			const a = r.data?.acks
			if (r.status === 200 && a?.res?.includes('busy') && attempt < 10) {
				await sleep(Math.min(Math.max(Number(a.retryMs) || 1000, 100), 11000))
				continue
			}
			if (r.status !== 200 || !a?.res?.every((x) => x === 'ok')) throw new Error(`Stapel ${seq}: ${r.status} ${r.text.slice(0, 300)}`)
			rev = a.rev ?? rev
			break
		}
	}
	return rev
}

/** Closes the vote list when it is open (narrow layout: it opens at the start of a session). */
async function closeList(page) {
	if (!(await page.locator(PANEL).first().isVisible().catch(() => false))) return true
	await page.locator('[data-knorke-action=vote-panel-close]').first().tap().catch(() => {})
	return until(async () => !(await page.locator(PANEL).first().isVisible().catch(() => false)), { timeout: 10000 })
}

/**
 * In the page: arms the clock of one measurement. t0 = the first pointer or
 * touch event of the coming tap (captured on window); done = a promise that
 * resolves with the time one frame after `ready()` first holds; long tasks
 * are collected from now on.
 */
function arm([kind, arg]) {
	const st = { t0: null, longs: [] }
	window.__m01 = st
	try {
		st.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longs.push([e.startTime, e.duration]) })
		st.po.observe({ type: 'longtask' })
	} catch (e) { st.po = null }
	const first = () => { if (st.t0 === null) st.t0 = performance.now() }
	for (const type of ['touchstart', 'pointerdown', 'mousedown', 'click']) window.addEventListener(type, first, { capture: true, once: true })
	const ready = kind === 'open'
		? () => document.querySelectorAll('[data-knorke-vote-panel] [data-knorke-vote-item]').length >= arg
		: () => {
			const row = document.querySelector(`[data-knorke-vote-panel] [data-knorke-vote-item="${arg}"]`)
			const n = row && row.querySelector('.knorke-votepanel__count > [aria-hidden]')
			return !!n && n.textContent.trim() === '1'
		}
	st.done = new Promise((resolve) => {
		const tick = () => {
			if (ready()) requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0))
			else requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	})
}

/** In the page: the result of the armed measurement (after the tap). */
async function finish() {
	const st = window.__m01
	const t1 = await Promise.race([st.done, new Promise((resolve) => setTimeout(() => resolve(null), 60000))])
	await new Promise((resolve) => setTimeout(resolve, 100))
	st.po?.disconnect()
	if (t1 === null || st.t0 === null) return { ms: null, longest: null, longTasks: null, t0: st.t0 }
	const inside = st.longs.filter(([s, d]) => s + d >= st.t0 && s <= t1)
	return {
		ms: Math.round((t1 - st.t0) * 10) / 10,
		longest: st.po ? Math.round(Math.max(0, ...inside.map(([, d]) => d)) * 10) / 10 : null,
		longTasks: st.po ? inside.length : null,
		rows: document.querySelectorAll('[data-knorke-vote-panel] [data-knorke-vote-item]').length,
	}
}

/** In the page: the idle rAF interval, then the list scrolled top to bottom in `frames` frames. */
async function scrollList(frames) {
	const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
	const row = document.querySelector('[data-knorke-vote-panel] [data-knorke-vote-item]')
	let el = row
	while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement
	if (!el) return { error: 'no scrolling element' }
	el.scrollTop = 0
	const idle = []
	let last = await frame()
	for (let i = 0; i < 30; i++) {
		const t = await frame()
		idle.push(t - last)
		last = t
	}
	idle.sort((a, b) => a - b)
	const refreshMs = idle[Math.floor(idle.length / 2)]
	const longs = []
	let po = null
	try {
		po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration) })
		po.observe({ type: 'longtask' })
	} catch (e) { po = null }
	const range = el.scrollHeight - el.clientHeight
	const deltas = []
	last = await frame()
	for (let i = 1; i <= frames; i++) {
		el.scrollTop = Math.round((range * i) / frames)
		const t = await frame()
		deltas.push(t - last)
		last = t
	}
	await new Promise((resolve) => setTimeout(resolve, 100))
	po?.disconnect()
	const reached = Math.abs(el.scrollTop - range) <= 2
	el.scrollTop = 0
	return { refreshMs, deltas, range, reached, longest: po ? Math.round(Math.max(0, ...longs) * 10) / 10 : null, cls: el.className }
}

export const M01 = {
	id: 'M01',
	measure: true,
	timeoutMs: 1200000,
	title: 'Messung (Job 214, nur mit --only): Stimmliste im Schmal-Layout am Handy mit 3000 Notizen (390 × 844, Faktor 3, Touch, 4× CPU-Drossel) – Öffnen, Scrollen, Abstimmen, je 3 Läufe, gegen die nächsten M1-Schwellen',
	async run(t, world) {
		const board = await world.board('E2E Messung Stimmliste 3000')
		t.step(`alice legt ${NOTES} Notizen in 20 Frames an`)
		await seedBatches(board, boardOps(() => ulid()))
		const vl = await api('alice', 'POST', `/api/v1/boards/${board}/votelink`, {})
		t.must(vl.status === 200 && vl.data?.link?.token, '[B] Abstimm-Link → 200', vl.text.slice(0, 200))
		const s = await api('alice', 'POST', `/api/v1/boards/${board}/vote`, { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: null })
		t.must(s.status === 200, '[B] Abstimmung gestartet (5 Stimmen, 1 je Notiz, Notizen)', s.text.slice(0, 200))

		t.step('Mira tritt am Handy über den Abstimm-Link bei')
		const g = await world.actor('mira-handy', { touch: true, viewport: PHONE, deviceScaleFactor: 3, timeout: 60000 })
		await g.page.goto(`${APP}/p/${vl.data.link.token}`, { waitUntil: 'domcontentloaded' })
		await field(g.page, 'guest-name', 'Mira')
		await action(g.page, 'guest-join')
		await waitReady(g.page, 60000)
		const cdp = await g.ctx.newCDPSession(g.page)
		const reps = []
		try {
			for (let rep = 1; rep <= REPS; rep++) {
				if (rep > 1) {
					await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
					await g.page.reload({ waitUntil: 'domcontentloaded' })
					await waitReady(g.page, 60000)
				}
				t.must(await until(() => g.page.locator(BAR).first().isVisible().catch(() => false), { timeout: 30000 }), `[C] Lauf ${rep}: Abstimm-Leiste offen`)
				t.must(await closeList(g.page), `[C] Lauf ${rep}: Stimmliste vor der Messung zu`)
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
				await sleep(2000)

				await g.page.evaluate(arm, ['open', NOTES])
				await g.page.locator(OPEN_BUTTON).first().tap()
				const open = await g.page.evaluate(finish)
				t.check(open.ms !== null && open.rows === NOTES, `[C] Lauf ${rep}: Liste mit ${NOTES} Zeilen geöffnet`, open)
				await sleep(1000)

				const sc = await g.page.evaluate(scrollList, SCROLL_FRAMES)
				t.check(!sc.error && sc.reached, `[C] Lauf ${rep}: Liste bis unten gescrollt`, { ...sc, deltas: undefined })
				const fs = frameSummary(sc.deltas ?? [], sc.refreshMs)
				await sleep(1000)

				const id = await g.page.evaluate(([sel, k]) => {
					const rows = document.querySelectorAll(sel)
					const row = rows[k]
					row?.scrollIntoView({ block: 'center' })
					return row?.getAttribute('data-knorke-vote-item') ?? null
				}, [ROWS, Math.floor(NOTES / 2) + rep * 7])
				t.must(id, `[C] Lauf ${rep}: Zeile in der Mitte der Liste`)
				await sleep(500)
				await g.page.evaluate(arm, ['tap', id])
				await g.page.locator(`[data-knorke-vote-panel] [data-knorke-vote-item="${id}"] [data-knorke-action=vote-add]`).first().tap()
				const tap = await g.page.evaluate(finish)
				t.check(tap.ms !== null, `[C] Lauf ${rep}: die Zeile zeigt die eigene Stimme`, tap)

				const r = {
					openMs: open.ms, openLongest: open.longest, rows: open.rows, scrollFps: fs.fps, scrollMissed: fs.pctMissed,
					scrollLongest: sc.longest, refreshMs: sc.refreshMs, tapMs: tap.ms,
				}
				reps.push(r)
				t.note(`Lauf ${rep}: Öffnen ${r.openMs} ms (längster Long Task ${r.openLongest} ms), Scrollen ${r.scrollFps} fps / ${r.scrollMissed} % verpasst, Abstimmen ${r.tapMs} ms`)
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
				await closeList(g.page)
			}
		} finally {
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {})
			await cdp.detach().catch(() => {})
		}
		const verdicts = judge(medians(reps))
		t.note(`Schwellen (Median): ${verdicts.map((v) => `${v.id} ${v.ok ? 'PASS' : 'FAIL'}`).join(', ')}`)
		t.report(reportMarkdown(reps, `Chromium ${PHONE.width} × ${PHONE.height}, Faktor 3, Touch, isMobile, 4× CPU-Drossel (CDP); ${NOTES} Notizen in 20 Frames, Abstimmung 5 Stimmen / 1 je Notiz; ${REPS} Läufe nach je einem Neuladen`))
		await world.drop(g)
	},
}
