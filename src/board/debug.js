/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Debug hook window.__knorke (SPEC-M0 §6.7). Installed only when the initial
 * state says debug === true (system config knorke_dev, dev stacks only). The
 * E2E harness [D] drives and checks the UI through it; the shapes below are a
 * frozen contract (§10.2).
 *
 * items()/confirmed()/serverItems() use itemKey() from src/model/paths.js, so
 * the three are comparable string for string.
 *
 * SPEC-M1 §6.7 (additive, stage 0): state() also reports uiMode (stage 2:
 * modeFor of me.role and the device, board/mode.js; `viewOnly` is "no
 * editing" by role or device, unchanged by a final status; the M0 field
 * `mode` stays 'user'|'guest',
 * dev/e2e/scenarios/world.mjs checks it), role, mod, source, epoch, metaRev,
 * following (null until stage 3) and clockOffset; meta() returns a copy of
 * the last applied board.meta; debug.setEpoch(ep) forces an epoch (C51/E
 * cases). The (R2) own-presence variant of presence() comes with stage 3.
 *
 * Stage 1 (SPEC-M1 §6.7): selection() → the selected ids; handles() → the
 * transformer's handle centers [{name, x, y}] in client coordinates (the
 * scene reports them in container coordinates); connector(id) → {start,
 * end, kind} of a routed connector in world coordinates (null until the
 * model routes connectors, round 1b).
 *
 * Stage 3 (SPEC-M1 §6.7, R16): state().name = the own display name (E28: an
 * empty name in the guest dialog → 'Guest'), state().following = the pid
 * this tab follows or null; votes() → {sid, state, open, left, mine (plain
 * object, n ≥ 1), results ([id, n][] after the close), voters (moderators
 * only)}, without a session {sid: null, state: null, open: false, left:
 * null, mine: {}, results: null, voters: null}; presence() keeps its M0
 * meaning (the sampled others, now with view); sentPresence() = a copy of
 * the me candidate of the last /sync request that went out, null when
 * there was none (mode vote/view, open vote panel, before the first
 * request); scene().voteState comes from the scene's stats().
 *
 * M2 (SPEC-M1 §1.2 "(R20) Sperren"): scene().locks = the lock symbols the
 * last painting drew (the scene's stats().locks; 0 without a locked item in
 * view); items() and serverItems() carry each item's lock as {by, name}.
 *
 * M2 (SPEC-M1 §1.2 "(R20) Gruppieren"): scene().groupOutlines = the outlines
 * of fully selected groups the renderer holds (the scene's
 * stats().groupOutlines; 0 without one); items() and serverItems() carry
 * each item's group.
 */
import { itemKey } from '../model/paths.js'

/* global appVersion */
export const VERSION = typeof appVersion === 'string' ? appVersion : 'dev'

/**
 * @param {object[]} items WireItems
 * @return {string[]} itemKey per item, sorted by id
 */
export function canonicalList(items) {
	return [...items]
		.filter((it) => it && typeof it.id === 'string')
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map((it) => itemKey(it))
}

/**
 * @param {number} ms delay
 * @return {Promise<void>}
 */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Builds the debug API of a session (testable without a window).
 *
 * @param {import('./BoardSession.js').BoardSession} s session
 * @return {object} the window.__knorke object
 */
export function debugApi(s) {
	const rectOfContainer = () => {
		try {
			return s.container?.getBoundingClientRect?.() ?? { left: 0, top: 0 }
		} catch (e) {
			return { left: 0, top: 0 }
		}
	}
	return {
		version: VERSION,
		state() {
			return {
				boardId: s.boardId,
				mode: s.mode,
				cursor: s.sync ? s.sync.cursor : null,
				status: s.status,
				pid: s.me?.pid ?? null,
				role: s.me?.role ?? null,
				viewOnly: s.viewOnly,
				pending: s.replica.pendingCount(),
				inflight: s.replica.hasInflight(),
				uiMode: s.uiMode(),
				mod: s.me?.mod === true,
				source: s.me?.source ?? null,
				epoch: s.epoch,
				metaRev: s.metaRev,
				following: s.follower?.following?.pid ?? null,
				clockOffset: s.clock.offset,
				name: typeof s.me?.name === 'string' ? s.me.name : null,
			}
		},
		votes() {
			return structuredClone(s.votesDebug())
		},
		sentPresence() {
			const me = s.sync ? s.sync.sentMe : null
			return me ? structuredClone(me) : null
		},
		meta() {
			const m = s.board?.meta
			return m && typeof m === 'object' ? structuredClone(m) : {}
		},
		items() {
			const out = []
			for (const id of s.replica.allIds()) {
				const v = s.replica.visible(id)
				if (v) {
					out.push(v)
				}
			}
			return canonicalList(out)
		},
		confirmed() {
			return canonicalList(s.replica.confirmedItems())
		},
		async serverItems() {
			const snap = await s.transport.snapshot({ count: false })
			return canonicalList(Array.isArray(snap?.items) ? snap.items : [])
		},
		scene() {
			return s.scene ? s.scene.stats() : null
		},
		camera() {
			return s.scene ? s.scene.getCamera() : null
		},
		presence() {
			return s.presence.sample(s.now())
		},
		selection() {
			return [...s.selection]
		},
		handles() {
			let list = []
			try {
				list = s.scene && typeof s.scene.handles === 'function' ? s.scene.handles() ?? [] : []
			} catch (e) {
				list = []
			}
			const b = rectOfContainer()
			return list.map((h) => ({ name: h.name, x: h.x + b.left, y: h.y + b.top }))
		},
		connector(id) {
			const g = s.model && typeof s.model.geometryOf === 'function' ? s.model.geometryOf(id) : null
			if (!g || !g.start || !g.end) {
				return null
			}
			return { start: { x: g.start.x, y: g.start.y }, end: { x: g.end.x, y: g.end.y }, kind: g.kind }
		},
		itemScreenRect(id) {
			const r = s.scene ? s.scene.itemScreenRect(id) : null
			if (!r) {
				return null
			}
			const b = rectOfContainer()
			return { x: r.x + b.left, y: r.y + b.top, w: r.w, h: r.h }
		},
		worldToScreen(x, y) {
			if (!s.scene) {
				return null
			}
			const p = s.scene.worldToScreen(x, y)
			const b = rectOfContainer()
			return { x: p.x + b.left, y: p.y + b.top }
		},
		/**
		 * Resolves when no op is pending, nothing is in flight, and one full
		 * tick has completed after that.
		 *
		 * @param {number} [timeoutMs] give up after this long
		 * @return {Promise<true>}
		 */
		async waitIdle(timeoutMs = 10000) {
			const deadline = Date.now() + timeoutMs
			const check = () => {
				if (!s.sync || !s.sync.running) {
					throw new Error('waitIdle: sync stopped (' + s.status + ')')
				}
				if (Date.now() > deadline) {
					throw new Error('waitIdle: timeout')
				}
			}
			// Force a tick only while no request is open: forcing during a request
			// chains the next one onto its answer, and the loop would never look idle.
			while (s.replica.pendingCount() > 0 || s.sync?.busy) {
				check()
				if (!s.sync.busy) {
					s.sync.forceTick()
				}
				await pause(25)
			}
			check()
			const n = s.sync.ticks
			s.sync.forceTick()
			while (s.sync.ticks <= n || s.sync.busy || s.replica.pendingCount() > 0 || s.replica.waitingCount() > 0) {
				check()
				if (!s.sync.busy && s.sync.ticks <= n) {
					s.sync.forceTick()
				}
				await pause(25)
			}
			return true
		},
		debug: {
			setCursor(n) {
				s.sync?.setCursor(n)
			},
			forceTick() {
				s.sync?.forceTick()
			},
			/** @param {string} ep epoch the next requests send as `ep` (until the next snapshot) */
			setEpoch(ep) {
				if (typeof ep === 'string') {
					s.epoch = ep
				}
			},
		},
		counters() {
			return { ...s.counters }
		},
	}
}

/**
 * Installs window.__knorke for a session.
 *
 * @param {import('./BoardSession.js').BoardSession} s session
 * @return {() => void} uninstall
 */
export function installDebug(s) {
	const w = typeof window !== 'undefined' ? window : null
	if (!w) {
		return () => {}
	}
	const api = debugApi(s)
	w.__knorke = api
	return () => {
		if (w.__knorke === api) {
			delete w.__knorke
		}
	}
}
