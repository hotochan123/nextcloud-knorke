/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 251 AK2: the guest's comment list is throttled (route 40,
 * 429 slow_down). CommentFeed then loads again after slowDownDelay (at least
 * 2 s, doubling on every further slow_down), a success resets the doubling,
 * close() and a new meta.comments value drop the waiting repeat, and any
 * other failure is not repeated.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CommentFeed } from '../../../src/board/comments.js'
import { HttpError } from '../../../src/sync/http.js'

const slow = () => new HttpError(429, 'slow_down', '', 2, true, { error: 'slow_down', retryMs: 500 })
const tick = () => new Promise((r) => setTimeout(r, 0))

function feed(answers) {
	const timers = new Map()
	let next = 1
	const errors = []
	const f = new CommentFeed({
		load: () => {
			const a = answers.shift()
			return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
		},
		onError: (e) => errors.push(e),
		setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id },
		clearTimer: (id) => { timers.delete(id) },
		rand: () => 0,
	})
	const fire = () => {
		const [[id, t]] = timers
		timers.delete(id)
		t.fn()
	}
	return { f, timers, errors, fire }
}

test('AK2 a slow_down is loaded again after slowDownDelay, doubling, and a success resets it', async () => {
	const h = feed([slow(), slow(), { threads: [] }, slow()])
	h.f.meta(1)
	await tick()
	assert.equal(h.f.loads, 1)
	assert.deepEqual([...h.timers.values()].map((t) => t.ms), [2000], 'at least 2 s')
	assert.deepEqual(h.errors, [], 'not reported as a failure')
	h.fire()
	await tick()
	assert.equal(h.f.loads, 2)
	assert.deepEqual([...h.timers.values()].map((t) => t.ms), [4000], 'doubled')
	h.fire()
	await tick()
	assert.equal(h.f.loads, 3)
	assert.equal(h.f.loaded, true)
	assert.equal(h.timers.size, 0)
	h.f.meta(2)
	await tick()
	assert.deepEqual([...h.timers.values()].map((t) => t.ms), [2000], 'the success reset the doubling')
})

test('AK2 a new meta value loads at once and drops the wait; close() drops it too', async () => {
	const h = feed([slow(), { threads: [] }, slow()])
	h.f.meta(1)
	await tick()
	assert.equal(h.timers.size, 1)
	h.f.meta(2)
	assert.equal(h.timers.size, 0, 'the waiting repeat is gone')
	assert.equal(h.f.loads, 2, 'loaded at once')
	await tick()
	h.f.meta(3)
	await tick()
	assert.equal(h.timers.size, 1)
	h.f.close()
	assert.equal(h.timers.size, 0)
})

test('AK2 any other failure is reported and not repeated', async () => {
	const h = feed([new HttpError(500, 'http_500'), new HttpError(429, 'http_429')])
	h.f.meta(1)
	await tick()
	h.f.meta(2)
	await tick()
	assert.equal(h.errors.length, 2)
	assert.equal(h.timers.size, 0)
	assert.equal(h.f.loads, 2)
})
