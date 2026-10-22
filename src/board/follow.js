/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * FollowController (SPEC-M1 §6.5.6, stage 3): following another participant
 * and "Bring everyone here". Purely client-side over presence v (§5.5): the
 * target is the presence entry '<pid>:<client>' (a pid can have three tabs).
 * No DOM, no texts: the session gives the scene, the presence model, the
 * clock and the sleep, and gets onChange (banner, chip) and onLeft (toast).
 *
 * follow(pid, client = null): without a client the entry of pid whose v this
 * client saw change last (presence.youngestViewKey, CLI-16). On every
 * presence card the target's viewport becomes
 *   scene.followTo(scene.cameraForRect(viewRect, 0), glideMs)
 * (cameraForRect centres the rectangle and fits it: "seitenrichtig
 * eingepasster Mitte"). glideMs = the observed interval between presence
 * cards, clamped to 300–2000 ms (§6.3 "Folgen" (1)); the scene jumps under
 * prefers-reduced-motion. A followTo that resolves false never ends following
 * (R16 CLI-05, S-11): the next card tries again. An unchanged viewport is
 * not sent again unless the last followTo said false.
 *
 * Following ends (stop): the user moves the camera (onUserCamera; in mode
 * vote also the small-target zoom), in mode edit every intent and every
 * activity start except 'press' (own editing), Esc, the target's entry is
 * older than STALE_MS (onLeft: "{name} left."), the target is this client
 * itself. A tap to vote does not end it.
 *
 * "Bring everyone here" (meta.summon): one call is the PAIR (seq, at) (R16
 * SRV-04: after DELETE summon.seq starts at 1 again). A new pair with a pid
 * other than mine → follow(summon.pid, summon.client) with the summon flag
 * (banner "{name} is presenting."). Leaving it ON PURPOSE (why 'user': own
 * camera move, Esc, own editing, the Stop button) remembers the pair: the
 * same pair never pulls this client back, a new pair does. summon gone → a
 * summon follow ends, both memories are forgotten. The chip "{name} is
 * presenting · Follow" shows while a summon is active, this client does not
 * follow, the presenter is not me and a fresh entry '<pid>:<client>' with v
 * exists; a tap (followPresenter) follows again and remembers the pair as
 * "back in".
 * (R22, P7-09) Return: 'left' (the presenter's entry older than STALE_MS,
 * e.g. a hidden presenting tab the browser throttled), 'self' and 'summon'
 * never remember the pair. A client that does not follow anybody and has
 * not left the current pair itself follows the presenter again (with the
 * banner) on the first presence card that brings a fresh entry
 * '<summon.pid>:<summon.client>' with v.
 * (R22, VC-03) A follow() without the summon flag that replaces the summon
 * follow (the PresenceBar) is an own exit too: it remembers the pair.
 *
 * No jumps under the finger (R2): while a vote session is open, jumps are
 * held back during an active 'press' and until HOLD_MS after its end; then
 * the newest held target is applied in one step.
 */

/** Glide duration bounds (§6.3 "Folgen" (1)). */
export const GLIDE_MIN_MS = 300
export const GLIDE_MAX_MS = 2000
/** A target entry older than this has left (§6.5.6). */
export const STALE_MS = 10000
/** Jumps wait this long after the last press ended (§6.5.6, R2). */
export const HOLD_MS = 1500

/**
 * @param {unknown} s meta.summon
 * @return {{pid: string, client: string, name: string, seq: number, at: number}|null}
 */
export function summonOf(s) {
	if (!s || typeof s !== 'object' || typeof s.pid !== 'string' || s.pid === '' || !Number.isInteger(s.seq)) {
		return null
	}
	return {
		pid: s.pid,
		client: typeof s.client === 'string' ? s.client : '',
		name: typeof s.name === 'string' ? s.name : '',
		seq: s.seq,
		at: Number.isFinite(s.at) ? s.at : 0,
	}
}

/**
 * @param {{seq: number, at: number}|null} a call
 * @param {{seq: number, at: number}|null} b call
 * @return {boolean} the same call (pair seq, at)
 */
export function samePair(a, b) {
	return !!a && !!b && a.seq === b.seq && a.at === b.at
}

/**
 * @param {number} ms observed interval
 * @return {number} glide duration in GLIDE_MIN_MS..GLIDE_MAX_MS
 */
export function clampGlide(ms) {
	if (!Number.isFinite(ms)) {
		return GLIDE_MAX_MS
	}
	return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, ms))
}

export class FollowController {
	/**
	 * @param {object} o wiring
	 * @param {() => object|null} o.scene the scene (followTo, cameraForRect, stopFollow)
	 * @param {object} o.presence PresenceModel (entryView, youngestViewKey)
	 * @param {() => number} o.now monotonic clock (same as the presence model)
	 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} o.sleep sleep (held jumps)
	 * @param {() => {pid: (string|null), client: (string|null)}} o.self this client
	 * @param {() => boolean} [o.sessionOpen] a vote session is open (jumps wait for presses)
	 * @param {(state: object) => void} [o.onChange] following or chip changed
	 * @param {(name: string) => void} [o.onLeft] the target left (toast)
	 */
	constructor({ scene, presence, now, sleep, self, sessionOpen = () => false, onChange = () => {}, onLeft = () => {} }) {
		this.scene = scene
		this.presence = presence
		this.now = now
		this.sleep = sleep
		this.self = self
		this.sessionOpen = sessionOpen
		this.onChange = onChange
		this.onLeft = onLeft
		/** {pid, client, key, name, summon, since, seenAt} or null */
		this.target = null
		/** meta.summon as a call, or null */
		this.summon = null
		/** the call this client left (stays out until a new pair) */
		this.exited = null
		/** the call this client came back to over the chip */
		this.rejoined = null
		this.pressActive = false
		this.pressEndAt = -Infinity
		/** newest held target {cam, ms} */
		this.held = null
		this.holdCtl = null
		this.lastCardAt = null
		this.glideMs = GLIDE_MAX_MS
		/** the viewport last handed to followTo, and whether that followTo said true */
		this.lastView = null
		this.lastOk = true
		/**
		 * generation of the newest followTo: only ITS answer counts. A glide that a
		 * newer followTo replaced resolves false (§6.3 "Folgen" (2)); that false
		 * must not mark the newest call as failed (it would re-send an unchanged
		 * viewport and replace the running glide again on every card).
		 */
		this.goGen = 0
		/** JSON of the chip last reported (no chip at the start) */
		this.lastChip = 'null'
		this.destroyed = false
	}

	/** @return {{pid: string, client: (string|null), name: string, summon: boolean}|null} who this client follows */
	get following() {
		const t = this.target
		return t ? { pid: t.pid, client: t.client, name: t.name, summon: t.summon } : null
	}

	/**
	 * Follows the presence entry '<pid>:<client>' (without client: the
	 * youngest entry of pid with a viewport).
	 *
	 * @param {string} pid participant
	 * @param {string|null} [client] client id of the tab
	 * @param {{summon?: boolean, name?: string}} [o] summon: started by "Bring everyone here"
	 * @return {boolean} following now
	 */
	follow(pid, client = null, { summon = false, name = '' } = {}) {
		if (this.destroyed || typeof pid !== 'string' || pid === '') {
			return false
		}
		const me = this.self()
		if (pid === me?.pid && (client === null || client === me?.client)) {
			// the target is this client itself
			this.stop('self')
			return false
		}
		if (!summon && this.target?.summon && this.summon) {
			// (R22, VC-03) switching away from the summon follow (PresenceBar →
			// followParticipant) is an own exit from the current pair: ending the
			// new follow later must not pull this client back (comeBack); the chip
			// offers the way back
			this.exited = { seq: this.summon.seq, at: this.summon.at }
		}
		const now = this.now()
		const key = typeof client === 'string' && client !== '' ? pid + ':' + client : this.presence.youngestViewKey(pid, now)
		const entry = key ? this.presence.entryView(key, now) : null
		this.target = {
			pid,
			client: key ? key.slice(pid.length + 1) : null,
			key,
			name: entry?.name || name || '',
			summon: !!summon,
			since: now,
			seenAt: entry ? entry.seenAt : now,
		}
		this.lastView = null
		this.lastOk = true
		// answers of followTo calls made for an earlier target no longer count
		this.goGen++
		this.held = null
		this.emit()
		this.step(now)
		return true
	}

	/**
	 * Ends following.
	 *
	 * @param {'user'|'left'|'summon'|'self'|'stop'} [why] reason: 'user' = own camera move, Esc,
	 *   own editing or the Stop button; only 'user' remembers the pair of a summon (R22, P7-09)
	 */
	stop(why = 'stop') {
		const t = this.target
		if (!t) {
			return
		}
		this.target = null
		this.held = null
		this.holdCtl?.abort()
		this.holdCtl = null
		if (t.summon && this.summon && why === 'user') {
			this.exited = { seq: this.summon.seq, at: this.summon.at }
		}
		try {
			this.scene()?.stopFollow?.()
		} catch (e) {
			// the scene is gone
		}
		this.emit()
	}

	/** Own camera move (scene onUserCamera): following ends. */
	onUserCamera() {
		this.stop('user')
	}

	/** Esc (the session's own keydown listener). */
	onEsc() {
		this.stop('user')
	}

	/**
	 * An intent of the scene: in mode edit every intent ends following (own
	 * editing); in mode vote a tap to vote does not.
	 *
	 * @param {object} i intent
	 * @param {'edit'|'vote'|'view'} mode client mode
	 */
	onIntent(i, mode) {
		if (mode === 'edit' && i && typeof i.type === 'string') {
			this.stop('user')
		}
	}

	/**
	 * Scene activity: 'press' holds jumps back (only while a session is
	 * open); any other start in mode edit ends following.
	 *
	 * @param {{kind: string, active: boolean}} a activity
	 * @param {'edit'|'vote'|'view'} mode client mode
	 */
	onActivity(a, mode) {
		if (!a || typeof a.kind !== 'string') {
			return
		}
		if (a.kind === 'press') {
			if (a.active) {
				this.pressActive = true
			} else if (this.pressActive) {
				this.pressActive = false
				this.pressEndAt = this.now()
				this.scheduleRelease()
			}
			return
		}
		if (a.active && mode === 'edit') {
			this.stop('user')
		}
	}

	/**
	 * After a presence update (SyncClient onPresence): the observed card
	 * interval, staleness of the target and the next camera step; the chip.
	 */
	onPresence() {
		if (this.destroyed) {
			return
		}
		const now = this.now()
		if (this.lastCardAt !== null && now > this.lastCardAt) {
			this.glideMs = clampGlide(now - this.lastCardAt)
		}
		this.lastCardAt = now
		this.step(now)
		if (this.comeBack()) {
			return
		}
		this.emitChip()
	}

	/**
	 * (R22, P7-09) Back to the presenter: no target, a summon of somebody
	 * else, its pair not left by this client on purpose, and its entry fresh
	 * with v (exactly when the chip would show).
	 *
	 * @return {boolean} following the presenter again
	 */
	comeBack() {
		const s = this.summon
		if (this.target || !s || samePair(this.exited, s) || this.chip() === null) {
			return false
		}
		return this.follow(s.pid, s.client, { summon: true, name: s.name })
	}

	/**
	 * meta.summon changed (or the board opened with one).
	 *
	 * @param {unknown} raw meta.summon (undefined: none)
	 */
	onSummon(raw) {
		const s = summonOf(raw)
		const prev = this.summon
		this.summon = s
		if (s === null) {
			this.exited = null
			this.rejoined = null
			if (this.target?.summon) {
				this.stop('summon')
			} else {
				this.emitChip()
			}
			return
		}
		const me = this.self()
		const isNew = !samePair(prev, s)
		if (isNew && this.exited && !samePair(this.exited, s)) {
			this.exited = null
		}
		if (isNew && this.rejoined && !samePair(this.rejoined, s)) {
			this.rejoined = null
		}
		if (s.pid === me?.pid) {
			// my own call (this tab or another of mine): nobody to follow
			if (this.target?.summon) {
				this.stop('summon')
			}
			this.emitChip()
			return
		}
		if (isNew && !samePair(this.exited, s)) {
			const wasTarget = this.target && this.target.pid === s.pid && this.target.client === s.client
			if (!wasTarget || !this.target.summon) {
				this.follow(s.pid, s.client || null, { summon: true, name: s.name })
			}
			if (this.target) {
				this.target.summon = true
				this.target.name = this.target.name || s.name
				this.emit()
			}
			return
		}
		this.emitChip()
	}

	/** The chip "{name} is presenting · Follow": follow the presenter again. */
	followPresenter() {
		const s = this.summon
		if (!s || s.pid === this.self()?.pid) {
			return false
		}
		this.exited = null
		this.rejoined = { seq: s.seq, at: s.at }
		return this.follow(s.pid, s.client || null, { summon: true, name: s.name })
	}

	/**
	 * @return {{pid: string, client: string, name: string}|null} the chip: a summon is active, this
	 *   client does not follow, the presenter is somebody else with a fresh entry carrying v
	 */
	chip() {
		const s = this.summon
		if (!s || this.target || s.pid === this.self()?.pid || !s.client) {
			return null
		}
		const e = this.presence.entryView(s.pid + ':' + s.client, this.now())
		if (!e || e.view === null || this.now() - e.seenAt > STALE_MS) {
			return null
		}
		return { pid: s.pid, client: s.client, name: e.name || s.name }
	}

	/**
	 * One camera step towards the target (or staleness).
	 *
	 * @param {number} now current time
	 */
	step(now) {
		const t = this.target
		if (!t) {
			return
		}
		if (t.key === null) {
			t.key = this.presence.youngestViewKey(t.pid, now)
			if (t.key !== null) {
				t.client = t.key.slice(t.pid.length + 1)
			}
		}
		const e = t.key ? this.presence.entryView(t.key, now) : null
		if (e) {
			t.seenAt = e.seenAt
			if (e.name && e.name !== t.name) {
				t.name = e.name
				this.emit()
			}
		}
		if (now - t.seenAt > STALE_MS) {
			const name = t.name
			this.stop('left')
			this.onLeft(name)
			return
		}
		if (!e || e.view === null) {
			return
		}
		const view = e.view
		if (this.lastOk && this.lastView && view.every((v, i) => v === this.lastView[i]) && !this.held) {
			return
		}
		const scene = this.scene()
		if (!scene || typeof scene.cameraForRect !== 'function' || typeof scene.followTo !== 'function') {
			return
		}
		const cam = scene.cameraForRect({ x: view[0], y: view[1], w: view[2], h: view[3] }, 0)
		this.lastView = view
		if (this.holding(now)) {
			this.held = { cam, ms: this.glideMs }
			this.scheduleRelease()
			return
		}
		this.go(cam, this.glideMs)
	}

	/**
	 * @param {number} now current time
	 * @return {boolean} jumps wait (a session is open and a press is down or ended < HOLD_MS ago)
	 */
	holding(now) {
		return this.sessionOpen() && (this.pressActive || now - this.pressEndAt < HOLD_MS)
	}

	/**
	 * @param {object} cam camera
	 * @param {number} ms glide duration
	 */
	go(cam, ms) {
		this.held = null
		let p
		try {
			p = this.scene()?.followTo(cam, clampGlide(ms))
		} catch (e) {
			p = null
		}
		this.lastOk = true
		const gen = ++this.goGen
		if (p && typeof p.then === 'function') {
			p.then((ok) => {
				if (ok === false && gen === this.goGen) {
					// never the end of following (R16 CLI-05): the next card tries again
					this.lastOk = false
				}
			}, () => {
				if (gen === this.goGen) {
					this.lastOk = false
				}
			})
		}
	}

	/** After the press hold: the newest held target in one step. */
	scheduleRelease() {
		if (this.holdCtl || !this.held) {
			return
		}
		const ctl = typeof AbortController === 'function' ? new AbortController() : null
		this.holdCtl = ctl
		const wait = () => {
			const left = this.pressActive ? HOLD_MS : HOLD_MS - (this.now() - this.pressEndAt)
			return this.sleep(Math.max(0, left), ctl?.signal)
		}
		const loop = async () => {
			for (;;) {
				await wait()
				if (this.destroyed || (ctl && ctl.signal.aborted) || this.holdCtl !== ctl) {
					return
				}
				if (!this.holding(this.now())) {
					break
				}
			}
			this.holdCtl = null
			const h = this.held
			if (h && this.target) {
				this.go(h.cam, h.ms)
			}
		}
		loop().catch(() => {})
	}

	emit() {
		this.onChange({ following: this.following, chip: this.chip() })
		this.lastChip = JSON.stringify(this.chip())
	}

	emitChip() {
		const c = JSON.stringify(this.chip())
		if (c !== this.lastChip) {
			this.emit()
		}
	}

	destroy() {
		this.destroyed = true
		this.holdCtl?.abort()
		this.holdCtl = null
		this.target = null
	}
}
