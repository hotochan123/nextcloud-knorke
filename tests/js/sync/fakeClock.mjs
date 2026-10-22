/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Fake time for SyncClient tests (helper, not a test file): now() and an
 * abortable sleep() that only advance through advance()/runUntil().
 */
import { PROTOCOL } from '../../../src/sync/protocol.js'

/** @return {Promise<void>} lets pending promise chains run */
export function flush() {
	return new Promise((resolve) => setImmediate(resolve))
}

export class FakeClock {
	constructor(start = 0) {
		this.t = start
		this.timers = []
		this.now = () => this.t
		this.sleep = (ms, signal) => new Promise((resolve) => {
			const timer = { at: this.t + Math.max(0, ms), resolve }
			if (signal?.aborted) {
				resolve()
				return
			}
			this.timers.push(timer)
			signal?.addEventListener?.('abort', () => {
				this.timers = this.timers.filter((x) => x !== timer)
				resolve()
			}, { once: true })
		})
	}

	/** Runs pending promise chains a few rounds. */
	async settle(rounds = 8) {
		for (let i = 0; i < rounds; i++) {
			await flush()
		}
	}

	/**
	 * Advances time, firing timers in order.
	 *
	 * @param {number} ms how far
	 */
	async advance(ms) {
		const end = this.t + ms
		await this.settle()
		for (;;) {
			this.timers.sort((a, b) => a.at - b.at)
			const next = this.timers[0]
			if (!next || next.at > end) {
				break
			}
			this.timers.shift()
			this.t = Math.max(this.t, next.at)
			next.resolve()
			await this.settle()
		}
		this.t = end
		await this.settle()
	}
}

/**
 * Transport fake: every sync() call is recorded with its time; the answer
 * comes from `handler(body, call)` (value, thrown error, or promise).
 *
 * @param {FakeClock} clock clock for the call times
 * @param {(body: object, call: object) => any} handler answer
 * @param {string} [kind] 'user' or 'guest'
 * @return {object} transport
 */
export function fakeTransport(clock, handler, kind = 'user') {
	const tr = {
		kind,
		calls: [],
		joins: 0,
		joinHandler: async () => ({ proto: PROTOCOL, guest: { token: 'tok2' } }),
		keepalive: [],
		snapshots: 0,
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				tr.keepalive.push(body)
				return {}
			}
			const call = { at: clock.now(), body: structuredClone(body) }
			tr.calls.push(call)
			return handler(body, call)
		},
		async join() {
			tr.joins++
			return tr.joinHandler()
		},
		async snapshot() {
			tr.snapshots++
			return { proto: PROTOCOL, rev: 0, items: [] }
		},
	}
	return tr
}
