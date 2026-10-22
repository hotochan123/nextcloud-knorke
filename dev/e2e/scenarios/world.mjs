/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shared state of the E2E run: actors (browser contexts), boards created by
 * this run (deleted at the end, after every page went to about:blank – a
 * page still polling a deleted board is the Pulse throttle trap), and the
 * "world" of E03–E11: one board of alice with an edit link, bob as a link
 * member and the guest Gina, all three with the board open.
 *
 * Boards are reused within a run where the spec allows it; a run creates at
 * most MAX_BOARDS_PER_RUN (SPEC-M0 §8.2 said ≤ 20 per account and run, see
 * the constant below).
 *
 * Instance settings a scenario switches through the host bridge (E15
 * legal-links, E16 links-policy; from stage 2 share-policy, group-member,
 * circles – SPEC-M1 §8.4) are put back here as well, after a red or
 * timed-out scenario too: switch() records the call before it is sent, and
 * cleanup() runs the counterparts of lib/switches.mjs (restoreCalls). The
 * stage-0 flags touchedLegal / touchedPolicy still work; touchedPrivacy
 * (M2, E43/E44) puts the privacy notice back to {} through route 27 as admin. Teams (team-create,
 * team-member) have no counterpart here: dev/lib.sh normalise_ns destroys the
 * harness teams before and after every run (lib/switches.mjs).
 *
 * Nextcloud's ILimiter budgets (routes 20/21: shares, new recipients,
 * sharee search; knorke-linkjoin; from stage 4 the snapshot and join
 * throttles of routes 12, 14, 15) live in Redis across runs (SPEC-M1 §8.4
 * R13, SRV-07): run.mjs calls limiterReset() at the start of EVERY case
 * (R19, T4-01; before stage 4 only E27–E33 did), which clears them through
 * the bridge action ratelimit-reset and marks the world, and cleanup()
 * clears them once more at the end.
 *
 * Page errors: pageErrors() covers the open actors AND the actors a scenario
 * dropped before its end (drop() keeps their errors until resetErrors() at
 * the start of the next scenario) – most scenarios drop their actors as their
 * last step, so without this a pageerror never reached the runner.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
	newActor, createBoard, api, openBoard, action, fieldValue, field, waitReady, until, K, APP, setAppConfig, ENV,
} from '../lib/harness.mjs'
import { bridge } from '../lib/bridge.mjs'
import { restoreCalls, SWITCHING, CREATING } from '../lib/switches.mjs'

/**
 * Boards one run may create (all of them are alice's). SPEC-M0 §8.2 asked for
 * ≤ 20 per account and run: M0's create budget was 30 per 10 minutes. The dev
 * stacks run with create_limit = 1000 (dev/up.sh), the sharing cases clear
 * the ILimiter state (ratelimit-reset), and the full M1 suite of stages 0–2
 * needs 28 boards (the stage-2 cases hit the old cap of 20 first): 40 left
 * room for stage 3 (SPEC-M1 stage 2, phase 1). Stage 4 (SPEC-M1 §8.4 R19,
 * T4-24): a full run of stages 0–3 created 37 boards, E34, E35 and E37 add
 * one each – exactly the old cap of 40 – so the cap was 48. With the cases
 * up to E42 a full run created exactly 48; factory job 032 (M2 privacy
 * notice: E43 one board, E44 two) needs 51, so the cap is 56
 * (dev/e2e/stage2.test.mjs pins it, ENTWICKLUNG §5.2 describes it).
 */
export const MAX_BOARDS_PER_RUN = 56

export class World {
	constructor(browser) {
		this.browser = browser
		this.actors = new Set()
		this.dropped = []
		this.boards = new Set()
		this.s = null
		this.setupError = null
		this.touchedConfig = false
		this.touchedPolicy = false
		this.touchedLegal = false
		// M2 privacy notice (E43, E44): cleanup() resets route 27 to {} as admin
		this.touchedPrivacy = false
		// [action, ...args] of every switching bridge call (switch()), for cleanup()
		this.touched = []
		// limiterReset() ran: cleanup() resets the ILimiter state once more
		this.touchedLimiter = false
	}

	/**
	 * Switches an instance setting through the host bridge (SPEC-M1 §8.4) and
	 * records it first, so cleanup() puts it back even when the call times out.
	 */
	async switch(action, ...args) {
		if (!SWITCHING.includes(action) && !CREATING.includes(action)) throw new Error(`World.switch: ${action} schaltet nichts (bridge() direkt)`)
		this.touched.push([action, ...args.map(String)])
		return bridge(action, ...args)
	}

	/**
	 * Clears Nextcloud's ILimiter state (bridge ratelimit-reset, SPEC-M1 §8.4
	 * R13) and marks the world, so cleanup() clears it again at the end.
	 * @return {Promise<{deleted: number}>}
	 */
	async limiterReset() {
		this.touchedLimiter = true
		return bridge('ratelimit-reset')
	}

	/** The bridge calls cleanup() makes to put the switched settings back (lib/switches.mjs). */
	restoreCalls() {
		const touched = [...this.touched]
		if (this.touchedPolicy) touched.push(['links-policy', 'off'])
		if (this.touchedLegal) touched.push(['legal-links', 'set'])
		return restoreCalls(touched, ENV)
	}

	async actor(name, opts = {}) {
		const a = await newActor(this.browser, name, opts)
		this.actors.add(a)
		return a
	}

	async drop(a) {
		if (!a) return
		this.actors.delete(a)
		await a.close()
		// the running scenario still fails on them (pageErrors)
		this.dropped.push(...a.errors.map((e) => `${a.name}: ${e}`))
	}

	resetErrors() {
		for (const a of this.actors) a.errors.length = 0
		this.dropped.length = 0
	}

	/** Screenshot of every open page (debugging a red scenario); returns the file names. */
	async screenshots(dir, id) {
		const out = []
		fs.mkdirSync(dir, { recursive: true })
		for (const a of this.actors) {
			const f = path.join(dir, `${id}-${a.name}.png`)
			const ok = await a.page.screenshot({ path: f, timeout: 5000 }).then(() => true, () => false)
			if (ok) out.push(path.basename(f))
		}
		return out
	}

	pageErrors() {
		return [...this.dropped, ...[...this.actors].flatMap((a) => a.errors.map((e) => `${a.name}: ${e}`))]
	}

	async board(title, user = 'alice') {
		if (this.boards.size >= MAX_BOARDS_PER_RUN) throw new Error(`mehr als ${MAX_BOARDS_PER_RUN} Boards in einem Lauf`)
		const id = await createBoard(user, title)
		this.boards.add(id)
		return id
	}

	/**
	 * The shared world. The first call builds it and records the steps as
	 * checks of the calling scenario (E03); later calls reuse it or repeat
	 * the setup error.
	 */
	async shared(t) {
		if (this.s) return this.s
		if (this.setupError) throw new Error(`Welt-Aufbau ist schon gescheitert: ${this.setupError}`)
		try {
			this.s = await this.build(t)
			return this.s
		} catch (e) {
			this.setupError = String(e?.message || e).split('\n')[0]
			throw e
		}
	}

	async build(t) {
		const s = {}
		t.step('alice legt das Board an und öffnet es')
		s.board = await this.board('E2E Konvergenz')
		s.alice = await this.actor('alice', { user: 'alice' })
		await openBoard(s.alice, s.board)
		t.step('alice schaltet den Link an (share → link-toggle → link-url)')
		await action(s.alice.page, 'share')
		await action(s.alice.page, 'link-toggle')
		const url = await until(async () => {
			const v = await fieldValue(s.alice.page, 'link-url').catch(() => '')
			return /\/p\/[A-Za-z0-9]{24}$/.test(v) ? v : null
		}, { timeout: 10000 })
		t.must(url, 'Link-URL im Feld link-url', url)
		s.linkUrl = url
		s.token = url.match(/\/p\/([A-Za-z0-9]{24})$/)[1]
		await s.alice.page.keyboard.press('Escape')
		t.step('bob öffnet den Link (wird Mitglied)')
		s.bob = await this.actor('bob', { user: 'bob' })
		await s.bob.page.goto(`${APP}/p/${s.token}`, { waitUntil: 'domcontentloaded' })
		await waitReady(s.bob.page, 30000)
		const bs = await K.state(s.bob.page)
		t.check(bs.boardId === s.board && bs.mode === 'user', 'bob landet über den Link im Board', bs)
		const bobList = await api('bob', 'GET', '/api/v1/boards')
		t.check((bobList.data?.boards || []).some((b) => b.id === s.board && b.viaLink === true), 'Board steht in bobs Liste (viaLink)', bobList.data)
		t.step('Gina öffnet den Link und tritt mit Namen bei')
		s.gina = await this.actor('gina')
		await s.gina.page.goto(`${APP}/p/${s.token}`, { waitUntil: 'domcontentloaded' })
		await field(s.gina.page, 'guest-name', 'Gina')
		await action(s.gina.page, 'guest-join')
		await waitReady(s.gina.page, 30000)
		const gs = await K.state(s.gina.page)
		t.check(gs.boardId === s.board && gs.mode === 'guest' && typeof gs.pid === 'string', 'Gina ist als Gast im Board', gs)
		s.pages = [s.alice.page, s.bob.page, s.gina.page]
		s.notes = {}
		return s
	}

	async cleanup() {
		for (const a of this.actors) {
			// waitIdle before leaving (§8.2 R3): unacknowledged ops set a
			// beforeunload prompt, Playwright dismisses it and the navigation fails
			await a.page.evaluate(() => (window.__knorke ? window.__knorke.waitIdle(5000).then(() => true, () => false) : true)).catch(() => {})
			await a.page.goto('about:blank').catch(() => {})
		}
		let n = 0
		for (const id of this.boards) {
			const r = await api('alice', 'DELETE', `/api/v1/boards/${id}`).catch(() => null)
			if (r && (r.status === 200 || r.status === 404)) n++
		}
		if (this.touchedConfig) await setAppConfig('knorke', 'public_template', 'public').catch(() => {})
		if (this.touchedPrivacy) {
			const r = await api(ENV.admin.user, 'PUT', '/api/v1/settings/privacy', {}).catch((e) => ({ status: 0, text: e.message }))
			if (r.status !== 200) console.log(`Aufräumen privacy_notice: ${r.status} ${String(r.text).slice(0, 120)}`)
		}
		for (const call of this.restoreCalls()) {
			await bridge(...call).catch((e) => console.log(`Aufräumen ${call.join(' ')}: ${e.message}`))
		}
		if (this.touchedLimiter) await bridge('ratelimit-reset').catch((e) => console.log(`Aufräumen ratelimit-reset: ${e.message}`))
		this.touchedLimiter = false
		this.touched = []
		this.touchedPolicy = false
		this.touchedLegal = false
		this.touchedPrivacy = false
		for (const a of [...this.actors]) await a.close()
		this.actors.clear()
		if (this.boards.size) console.log(`Aufräumen: ${n}/${this.boards.size} Boards gelöscht`)
	}
}
