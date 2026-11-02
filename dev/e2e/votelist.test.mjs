/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Host-side self-test of the pure part of measurement M01 (job 214,
 * lib/votelist.mjs): the board of 3000 notes in 20 frames (valid z keys in
 * order, every note inside its frame, no two notes on one place), the frame
 * statistics of the scroll, medians, and the vote list thresholds (equal to
 * the limit passes, a hair beyond or missing fails). No browser, no stack.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { NOTES, VOTE_LIST_THRESHOLDS, boardOps, frameSummary, judge, median, medians, reportMarkdown, zKey } from './lib/votelist.mjs'

test('z keys strictly increase over the whole board', () => {
	const keys = Array.from({ length: 5000 }, (_, i) => zKey(i))
	for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i], `${keys[i - 1]} < ${keys[i]}`)
	assert.equal(new Set(keys).size, keys.length)
	assert.throws(() => zKey(-1))
})

test('the board: 20 frames, 3000 notes inside their frames, each place once', () => {
	let n = 0
	const ops = boardOps(() => `ID${String(n++).padStart(24, '0')}`)
	const frames = ops.filter((o) => o.t === 'frame')
	const notes = ops.filter((o) => o.t === 'sticky')
	assert.equal(frames.length, 20)
	assert.equal(notes.length, NOTES)
	const byId = new Map(frames.map((f) => [f.id, f]))
	const places = new Set()
	for (const o of notes) {
		const f = byId.get(o.p.parent)
		assert.ok(f, o.id)
		assert.ok(o.p.x >= 0 && o.p.y >= 0 && o.p.x + o.p.w <= f.p.w && o.p.y + o.p.h <= f.p.h, o.id)
		places.add(`${o.p.parent} ${o.p.x} ${o.p.y}`)
		assert.ok(o.p.data.text.length > 0)
	}
	assert.equal(places.size, NOTES)
	assert.ok(ops.every((o, i) => i === 0 || ops[i - 1].p.z < o.p.z))
})

test('frame statistics like the lab: fps over the wall time, missed = interval > 1.5 × idle', () => {
	assert.deepEqual(frameSummary(Array(60).fill(1000 / 60), 1000 / 60), { frames: 60, fps: 60, pctMissed: 0 })
	assert.deepEqual(frameSummary([16.7, 16.7, 50, 16.7], 16.7), { frames: 4, fps: 40, pctMissed: 25 })
	assert.deepEqual(frameSummary([], 16.7), { frames: 0, fps: null, pctMissed: null })
})

test('median of the repetitions', () => {
	assert.equal(median([300, 100, 200]), 200)
	assert.equal(median([1, 2]), 1.5)
	assert.equal(median([null]), null)
	assert.deepEqual(medians([{ openMs: 1, tapMs: 9 }, { openMs: 3, tapMs: null }, { openMs: 2, tapMs: 7 }]), { openMs: 2, tapMs: 8 })
})

test('vote list thresholds: the nearest M1 numbers; equal passes, beyond or missing fails', () => {
	assert.deepEqual(VOTE_LIST_THRESHOLDS.flatMap((t) => t.checks.map((c) => `${t.id} ${c.key} ${c.op} ${c.limit}`)),
		['V1 openMs <= 250', 'V2 scrollFps >= 45', 'V2 scrollMissed <= 25', 'V3 tapMs <= 250'])
	assert.deepEqual(judge({ openMs: 250, scrollFps: 45, scrollMissed: 25, tapMs: 250 }).map((v) => v.ok), [true, true, true])
	assert.deepEqual(judge({ openMs: 250.1, scrollFps: 44.9, scrollMissed: 25, tapMs: 251 }).map((v) => v.ok), [false, false, false])
	assert.deepEqual(judge({ openMs: 10, scrollFps: 60, scrollMissed: 25.1, tapMs: 10 }).map((v) => v.ok), [true, false, true])
	assert.deepEqual(judge({}).map((v) => v.ok), [false, false, false])
	const md = reportMarkdown([{ openMs: 900, scrollFps: 50, scrollMissed: 3, tapMs: 120, rows: 3000 }], 'Aufbau')
	assert.match(md, /\| Median \| 900 \|/)
	assert.match(md, /\| V1 Liste öffnen \| S1 \| ms 900 \(≤ 250\) \| \*\*FAIL\*\* \|/)
	assert.match(md, /\| V3 Abstimmen \(Tipp auf \+\) \| S1 \| ms 120 \(≤ 250\) \| PASS \|/)
})
