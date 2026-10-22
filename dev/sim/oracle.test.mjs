/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the harness oracle (lib/mirror.mjs, lib/oracle.mjs) with
 * hand-made change logs – no stack needed. Pins the readings of §4.7 the
 * convergence check depends on (release at the end of a batch, tombstone
 * parents, rolled-back batches, placement group, normalisation) and that a
 * wrong log row IS reported. Since stage 4 also the rules of SPEC-M1 §4.13.7
 * "Folgen" for ids the fault purge removed (§8.6 R19, R20 K1): one case per
 * rule, each with a code that differs from "Folgen". Run:
 *   node --test 'dev/sim/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mirror, snapshotKeys, diffKeys, canon, itemKey, setPath, replayChanges, replayKeys } from './lib/mirror.mjs'
import { checkOps, normValue, connectorStats } from './lib/oracle.mjs'

const S = '01KNORKES0000000000000000S'
const C1 = '01KNORKEC1000000000000000C'
const C2 = '01KNORKEC2000000000000000C'
const F = '01KNORKEF0000000000000000F'
const X = '01KNORKEX0000000000000000X'

const item = (t, p = {}) => ({ t, x: 0, y: 0, w: 200, h: 200, r: 0, z: 'i0', parent: null, data: {}, style: {}, ...p })
const put = (id, t, p) => ({ o: 'put', id, t, p: { ...item(t, p) } })
const row = (rev, id, op, patch, client = 'cA') => ({ rev, item_id: id, op, patch: patch === null ? null : JSON.stringify(patch), client })
const batch = (rev, ops, res, seq = rev, client = 'cA') => ({ rev, seq, client, name: client, ops, res })

test('canon drops empty values at every depth, keeps list elements', () => {
	assert.deepEqual(canon({ b: { c: {} }, a: [1, {}], d: null, e: [] }), { a: [1, {}] })
	assert.equal(itemKey('i', { t: 'sticky', data: { x: {} } }), itemKey('i', { t: 'sticky' }))
})

test('setPath: empty value deletes and prunes, root containers stay', () => {
	const it = item('sticky', { data: { a: { b: 1 } } })
	setPath(it, 'data.a.b', null)
	assert.deepEqual(it.data, {})
	setPath(it, 'data.q.r', null)
	assert.deepEqual(it.data, {})
	setPath(it, 'style.fill', '#ffffff')
	assert.deepEqual(it.style, { fill: '#ffffff' })
})

test('mirror applies items/removed, ignores resync answers', () => {
	const m = new Mirror()
	m.load({ rev: 1, items: [{ id: S, ...item('sticky') }] })
	assert.equal(m.apply({ rev: 2, items: [{ id: X, ...item('sticky') }], removed: [S] }), true)
	assert.deepEqual([...m.items.keys()], [X])
	assert.equal(m.apply({ rev: 9, resync: true }), false)
	assert.equal(m.rev, 2)
	const d = diffKeys(m.keys(), snapshotKeys({ items: [{ id: X, ...item('sticky') }] }))
	assert.equal(d.length, 0)
})

test('replay of a log equals the expected state', () => {
	const rows = [
		row(1, S, 'put', item('sticky', { data: { text: 'a' } })),
		row(2, S, 'patch', { 'data.text': 'b', x: 5, y: 6, parent: null }),
		row(3, X, 'put', item('sticky')),
		row(4, X, 'remove', null),
	]
	const rp = replayChanges(rows)
	assert.deepEqual(rp.problems, [])
	assert.deepEqual([...replayKeys(rp).keys()], [S])
	assert.equal(rp.live.get(S).data.text, 'b')
	assert.equal(rp.dead.has(X), true)
})

test('check 3: plain put and patch are in effect', () => {
	const rows = [row(1, S, 'put', item('sticky', { data: { text: 'a' } })), row(2, S, 'patch', { 'data.text': 'b' })]
	const batches = [batch(1, [put(S, 'sticky', { data: { text: 'a' } })], ['ok']), batch(2, [{ o: 'patch', id: S, p: { 'data.text': 'b' } }], ['ok'])]
	assert.deepEqual(checkOps(rows, batches), [])
})

test('check 3: a wrong log value is reported', () => {
	const rows = [row(1, S, 'put', item('sticky')), row(2, S, 'patch', { 'data.text': 'falsch' })]
	const batches = [batch(1, [put(S, 'sticky')], ['ok']), batch(2, [{ o: 'patch', id: S, p: { 'data.text': 'richtig' } }], ['ok'])]
	const d = checkOps(rows, batches)
	assert.equal(d.length, 1)
	assert.match(d[0].problem, /data\.text/)
})

test('check 3: colours are compared lowercase, an uppercase log value is a deviation', () => {
	const base = [row(1, S, 'put', item('sticky'))]
	const op = batch(2, [{ o: 'patch', id: S, p: { 'style.fill': '#FFAA00' } }], ['ok'])
	assert.deepEqual(checkOps([...base, row(2, S, 'patch', { 'style.fill': '#ffaa00' })], [batch(1, [put(S, 'sticky')], ['ok']), op]), [])
	assert.equal(checkOps([...base, row(2, S, 'patch', { 'style.fill': '#FFAA00' })], [batch(1, [put(S, 'sticky')], ['ok']), op]).length, 1)
	assert.equal(normValue('style.fill', '#ABCDEF'), '#abcdef')
	assert.equal(normValue('data.text', 'a\r\nb\u0007'), 'a\nb')
})

test('check 3: container removed at the end of the batch releases children (C17 shape)', () => {
	const rows = [
		row(1, F, 'put', item('frame', { x: 100, y: 100, w: 800, h: 600 })),
		row(2, C1, 'put', item('sticky', { parent: F, x: 10, y: 10 })),
		row(2, C2, 'put', item('sticky', { parent: F, x: 20, y: 20 })),
		row(3, C1, 'patch', { x: 110, y: 110, parent: null }),
		row(3, C2, 'patch', { x: 130, y: 140, parent: null }),
		row(3, F, 'remove', null),
	]
	const batches = [
		batch(1, [put(F, 'frame', { x: 100, y: 100, w: 800, h: 600 })], ['ok']),
		batch(2, [put(C1, 'sticky', { parent: F, x: 10, y: 10 }), put(C2, 'sticky', { parent: F, x: 20, y: 20 })], ['ok', 'ok']),
		batch(3, [{ o: 'patch', id: C2, p: { x: 30, y: 40, parent: F } }, { o: 'remove', id: F }], ['ok', 'ok']),
	]
	assert.deepEqual(checkOps(rows, batches), [])
	// a server that forgot the release would leave C2 inside the removed frame
	const wrong = rows.map((r) => (r.rev === 3 && r.item_id === C2 ? row(3, C2, 'patch', { x: 30, y: 40, parent: F }) : r))
	assert.equal(checkOps(wrong, batches).length, 1)
})

test('check 3: tombstone parent at op time puts the item at the root (§4.7 rule 6)', () => {
	const rows = [
		row(1, F, 'put', item('frame', { x: 300, y: 400 })),
		row(1, S, 'put', item('sticky')),
		row(2, F, 'remove', null),
		row(3, S, 'patch', { x: 305, y: 406, parent: null }),
	]
	const batches = [
		batch(1, [put(F, 'frame', { x: 300, y: 400 }), put(S, 'sticky')], ['ok', 'ok']),
		batch(2, [{ o: 'remove', id: F }], ['ok']),
		batch(3, [{ o: 'patch', id: S, p: { x: 5, y: 6, parent: F } }], ['ok']),
	]
	assert.deepEqual(checkOps(rows, batches), [])
})

test('check 3: remove + revive in one batch, and a rolled-back batch', () => {
	const rows = [
		row(1, S, 'put', item('sticky', { data: { text: 'a' } })),
		row(2, S, 'put', item('sticky', { data: { text: 'b' } })),
	]
	const batches = [
		batch(1, [put(S, 'sticky', { data: { text: 'a' } })], ['ok']),
		batch(2, [{ o: 'remove', id: S }, { ...put(S, 'sticky', { data: { text: 'b' } }), revive: true }], ['ok', 'ok']),
		// rolled back: dup + no-op, acks.rev = observed rev 2
		batch(2, [put(S, 'sticky'), { o: 'patch', id: S, p: { 'data.text': 'b' } }], ['dup', 'ok'], 7, 'cB'),
	]
	assert.deepEqual(checkOps(rows, batches), [])
})

test('check 3: a later op of the same batch on the placement group skips the earlier one', () => {
	const rows = [row(1, S, 'put', item('sticky')), row(2, S, 'patch', { x: 2, y: 2, parent: null })]
	const batches = [
		batch(1, [put(S, 'sticky')], ['ok']),
		batch(2, [{ o: 'patch', id: S, p: { x: 1, y: 1, parent: null } }, { o: 'patch', id: S, p: { x: 2, y: 2, parent: null } }], ['ok', 'ok']),
	]
	assert.deepEqual(checkOps(rows, batches), [])
})

test('check 3, fourByte false (utf8mb3, SPEC-M1 §8.6): code points above U+FFFF are compared as U+FFFD at every depth', () => {
	const R = '�'
	assert.equal(normValue('data.text', 'Idee 😀 𝄞 漢', { fourByte: false }), `Idee ${R} ${R} 漢`)
	assert.equal(normValue('data.text', 'Idee 😀', { fourByte: true }), 'Idee 😀', 'default: kept')
	assert.equal(normValue('data.text', 'Idee 😀'), 'Idee 😀', 'no option = 4-byte database')
	assert.deepEqual(normValue('data.foo', { bar: ['😀', { a: 'x𝄞y' }], k: '🦊' }, { fourByte: false }), { bar: [R, { a: `x${R}y` }], k: R })
	assert.equal(normValue('style.fill', '#ABCDEF', { fourByte: false }), '#abcdef', 'other normalisation still applies')
	const rows = [row(1, S, 'put', item('sticky', { data: { text: `a ${R}` } })), row(2, S, 'patch', { 'data.tag': [R, 'b'] })]
	const batches = [
		batch(1, [put(S, 'sticky', { data: { text: 'a 😀' } })], ['ok']),
		batch(2, [{ o: 'patch', id: S, p: { 'data.tag': ['🎯', 'b'] } }], ['ok']),
	]
	assert.deepEqual(checkOps(rows, batches, { fourByte: false }), [], 'utf8mb3 stack: the stored U+FFFD is the expected form')
	assert.equal(checkOps(rows, batches).length, 2, 'a 4-byte stack that stored U+FFFD is two deviations')
	const kept = [row(1, S, 'put', item('sticky', { data: { text: 'a 😀' } })), row(2, S, 'patch', { 'data.tag': ['🎯', 'b'] })]
	assert.equal(checkOps(kept, batches, { fourByte: false }).length, 2, 'a utf8mb3 stack that kept the emoji is two deviations')
})

// ── SPEC-M1 stage 1: typed colour fields and container keep (rule 15) ──

test('check 3: typed colour fields per type are compared lowercase, untyped ones as sent (SPEC-M1 §3.10)', () => {
	assert.equal(normValue('style.stroke', '#ABCDEF', { type: 'shape' }), '#abcdef')
	assert.equal(normValue('style.textColor', '#ABCDEF', { type: 'shape' }), '#abcdef')
	assert.equal(normValue('style.color', '#ABCDEF', { type: 'text' }), '#abcdef')
	assert.equal(normValue('style.stroke', '#ABCDEF', { type: 'connector' }), '#abcdef')
	assert.equal(normValue('style.stroke', '#ABCDEF', { type: 'sticky' }), '#ABCDEF', 'not a typed field of sticky: kept')
	assert.equal(normValue('style.fill', '#ABCDEF', { type: 'frame' }), '#abcdef')
	const shapePut = (style) => put(S, 'shape', { w: 200, h: 120, data: { kind: 'rect' }, style })
	const rows = [row(1, S, 'put', item('shape', { w: 200, h: 120, data: { kind: 'rect' }, style: { fill: '#aabbcc', stroke: '#112233', textColor: '#ddeeff' } }))]
	assert.deepEqual(checkOps(rows, [batch(1, [shapePut({ fill: '#AABBCC', stroke: '#112233', textColor: '#DDEEFF' })], ['ok'])]), [])
	const kept = [row(1, S, 'put', item('shape', { w: 200, h: 120, data: { kind: 'rect' }, style: { fill: '#aabbcc', stroke: '#112233', textColor: '#DDEEFF' } }))]
	assert.equal(checkOps(kept, [batch(1, [shapePut({ fill: '#AABBCC', stroke: '#112233', textColor: '#DDEEFF' })], ['ok'])]).length, 1, 'a server that kept textColor upper case is a deviation')
	const T = '01KNORKET0000000000000000T'
	const tr = [row(1, T, 'put', item('text', { w: 240, h: 31.2, data: { text: 'a' }, style: { color: '#1a1a1a' } })), row(2, T, 'patch', { 'style.color': '#00ff00', h: 62.4, 'data.text': 'a\nb' })]
	const tb = [batch(1, [put(T, 'text', { w: 240, h: 31.2, data: { text: 'a' }, style: { color: '#1A1A1A' } })], ['ok']), batch(2, [{ o: 'patch', id: T, p: { 'style.color': '#00FF00', h: 62.4, 'data.text': 'a\r\nb' } }], ['ok'])]
	assert.deepEqual(checkOps(tr, tb), [], 'text: colour of a patch looked up through the stored type, h a plain number')
})

/** Frame F at (1000, 1000) with DB children C1 (10, 10), C2 (100, 100) and C3 (outside the batch's ops). */
function keepWorld() {
	const base = [
		row(1, F, 'put', item('frame', { x: 1000, y: 1000, w: 800, h: 600 })),
		row(2, C1, 'put', item('sticky', { parent: F, x: 10, y: 10 })),
		row(2, C2, 'put', item('sticky', { parent: F, x: 100, y: 100 })),
		row(2, S, 'put', item('sticky', { parent: F, x: 50, y: 50 })),
	]
	const setup = [
		batch(1, [put(F, 'frame', { x: 1000, y: 1000, w: 800, h: 600 })], ['ok']),
		batch(2, [put(C1, 'sticky', { parent: F, x: 10, y: 10 }), put(C2, 'sticky', { parent: F, x: 100, y: 100 }), put(S, 'sticky', { parent: F, x: 50, y: 50 })], ['ok', 'ok', 'ok']),
	]
	return { base, setup }
}

test('check 3, keep (SPEC-M1 §4.7 rule 15): children keep their absolute position; an op placed before the keep is shifted; a missing shift is reported', () => {
	const { base, setup } = keepWorld()
	// batch 3: C2 moved inside F (relative to the old position), then F moved by (-100, -50) with keep
	const ops3 = [{ o: 'patch', id: C2, p: { x: 200, y: 300, parent: F } }, { o: 'patch', id: F, keep: true, p: { x: 900, y: 950, parent: null, w: 900, h: 650 } }, { o: 'patch', id: S, p: { 'data.text': 'nur Text' } }]
	const good = [...base,
		row(3, F, 'patch', { x: 900, y: 950, parent: null, w: 900, h: 650 }),
		row(3, C1, 'patch', { x: 110, y: 60, parent: F }),
		row(3, C2, 'patch', { x: 300, y: 350, parent: F }),
		row(3, S, 'patch', { 'data.text': 'nur Text', x: 150, y: 100, parent: F }),
	]
	assert.deepEqual(checkOps(good, [...setup, batch(3, ops3, ['ok', 'ok', 'ok'])]), [])
	// a server without keep: the children move with the frame
	const noShift = [...base, row(3, F, 'patch', { x: 900, y: 950, parent: null, w: 900, h: 650 }), row(3, C2, 'patch', { x: 200, y: 300, parent: F }), row(3, S, 'patch', { 'data.text': 'nur Text' })]
	const d = checkOps(noShift, [...setup, batch(3, ops3, ['ok', 'ok', 'ok'])])
	assert.equal(d.length, 3, 'C2 (op expectation) plus C1 and S (derived rows) are deviations')
	assert.ok(d.some((x) => x.id === C2 && /keep/.test(x.problem)) && d.filter((x) => x.o === 'keep').map((x) => x.id).sort().join() === [C1, S].sort().join())
})

test('check 3, keep: only the literal true, only on a container, only when the position changes', () => {
	const { base, setup } = keepWorld()
	// keep: 1 on the frame → no keep: the child placed in the batch keeps its relative coordinates
	const ops3 = [{ o: 'patch', id: C2, p: { x: 200, y: 300, parent: F } }, { o: 'patch', id: F, keep: 1, p: { x: 900, y: 950, parent: null } }]
	const rows3 = [...base, row(3, F, 'patch', { x: 900, y: 950, parent: null }), row(3, C2, 'patch', { x: 200, y: 300, parent: F })]
	assert.deepEqual(checkOps(rows3, [...setup, batch(3, ops3, ['ok', 'ok'])]), [])
	// keep on a note: ignored
	const rows4 = [...base, row(3, C1, 'patch', { x: 5, y: 5, parent: null })]
	assert.deepEqual(checkOps(rows4, [...setup, batch(3, [{ o: 'patch', id: C1, keep: true, p: { x: 5, y: 5, parent: null } }], ['ok'])]), [])
	// keep with only w/h: no shift
	const rows5 = [...base, row(3, F, 'patch', { w: 1000, h: 700 })]
	assert.deepEqual(checkOps(rows5, [...setup, batch(3, [{ o: 'patch', id: F, keep: true, p: { w: 1000, h: 700 } }], ['ok'])]), [])
	// keep, then the inverse keep in the next batch (undo, §6.5.2): back to the start
	const rows6 = [...base,
		row(3, F, 'patch', { x: 900, y: 950, parent: null }), row(3, C1, 'patch', { x: 110, y: 60, parent: F }), row(3, C2, 'patch', { x: 200, y: 150, parent: F }), row(3, S, 'patch', { x: 150, y: 100, parent: F }),
		row(4, F, 'patch', { x: 1000, y: 1000, parent: null }), row(4, C1, 'patch', { x: 10, y: 10, parent: F }), row(4, C2, 'patch', { x: 100, y: 100, parent: F }), row(4, S, 'patch', { x: 50, y: 50, parent: F }),
	]
	const b3 = batch(3, [{ o: 'patch', id: F, keep: true, p: { x: 900, y: 950, parent: null } }], ['ok'])
	const b4 = batch(4, [{ o: 'patch', id: F, keep: true, p: { x: 1000, y: 1000, parent: null } }], ['ok'])
	assert.deepEqual(checkOps(rows6, [...setup, b3, b4]), [])
	const rp = replayChanges(rows6)
	assert.deepEqual([C1, C2, S].map((id) => [rp.live.get(id).x, rp.live.get(id).y]), [[10, 10], [100, 100], [50, 50]])
})

// ── keep at the time of the op (SPEC-M1 §4.7 rule 15, Revision 9) ──

/** keepWorld plus the root note X at (1050, 1100) (inside F, not its child). */
function keepWorldX() {
	const { base, setup } = keepWorld()
	return {
		base: [...base, row(2, X, 'put', item('sticky', { x: 1050, y: 1100 }))],
		setup: [setup[0], { ...setup[1], ops: [...setup[1].ops, put(X, 'sticky', { x: 1050, y: 1100 })], res: [...setup[1].res, 'ok'] }],
	}
}

test('check 3, keep at op time (R9): child moved before the keep → shifted; object adopted after the keep → as sent; a later op on a child wins; a child removed later stays removed', () => {
	const { base, setup } = keepWorldX()
	// the order transformItems sends (§6.5.2): keep patch first, then the membership patches relative to the NEW frame position
	const ops3 = [
		{ o: 'patch', id: C2, p: { x: 200, y: 300, parent: F } }, // before the keep: shifted by (+100, +50)
		{ o: 'patch', id: F, keep: true, p: { x: 900, y: 950, parent: null, w: 900, h: 650 } }, // dx −100, dy −50
		{ o: 'patch', id: X, p: { x: 150, y: 150, parent: F } }, // adopted after the keep: as sent
		{ o: 'patch', id: C1, p: { x: 5, y: 6, parent: F } }, // a later op on a shifted child's placement wins
		{ o: 'remove', id: S }, // a shifted child removed later: removed
	]
	const b3 = batch(3, ops3, ops3.map(() => 'ok'))
	const good = [...base,
		row(3, F, 'patch', { x: 900, y: 950, parent: null, w: 900, h: 650 }),
		row(3, C2, 'patch', { x: 300, y: 350, parent: F }),
		row(3, X, 'patch', { x: 150, y: 150, parent: F }),
		row(3, C1, 'patch', { x: 5, y: 6, parent: F }),
		row(3, S, 'remove', null),
	]
	assert.deepEqual(checkOps(good, [...setup, b3]), [])
	// the old reading (shift of the children at the END of the batch): X and C1 shifted as well
	const atEnd = good.map((r) => (r.rev !== 3 ? r : r.item_id === X ? row(3, X, 'patch', { x: 250, y: 200, parent: F }) : r.item_id === C1 ? row(3, C1, 'patch', { x: 105, y: 56, parent: F }) : r))
	const d = checkOps(atEnd, [...setup, b3])
	assert.deepEqual(d.map((x) => [x.id, x.op]).sort(), [[C1, 3], [X, 2]].sort(), 'adopted X and the later C1 op are deviations')
	// a server that did not shift the child moved before the keep
	const d2 = checkOps(good.map((r) => (r.rev === 3 && r.item_id === C2 ? row(3, C2, 'patch', { x: 200, y: 300, parent: F }) : r)), [...setup, b3])
	assert.equal(d2.length, 1)
	assert.ok(d2[0].id === C2 && d2[0].op === 0 && /keep-Verschiebung/.test(d2[0].problem), d2[0].problem)
	// a server that wrote the removed child as shifted instead of removing it
	const d3 = checkOps(good.map((r) => (r.rev === 3 && r.item_id === S ? row(3, S, 'patch', { x: 150, y: 100, parent: F }) : r)), [...setup, b3])
	assert.ok(d3.length === 1 && d3[0].id === S && d3[0].o === 'remove', JSON.stringify(d3))
})

test('check 3, keep at op time (R9): two keeps in one batch – stored children take both shifts, an object placed between them only the second', () => {
	const { base, setup } = keepWorldX()
	const ops3 = [
		{ o: 'patch', id: F, keep: true, p: { x: 900, y: 950, parent: null } }, // dx −100, dy −50
		{ o: 'patch', id: X, p: { x: 10, y: 20, parent: F } },
		{ o: 'patch', id: F, keep: true, p: { x: 1000, y: 900, parent: null } }, // dx +100, dy −50
	]
	const b3 = batch(3, ops3, ['ok', 'ok', 'ok'])
	const good = [...base,
		row(3, F, 'patch', { x: 1000, y: 900, parent: null }),
		row(3, C1, 'patch', { x: 10, y: 110, parent: F }),
		row(3, C2, 'patch', { x: 100, y: 200, parent: F }),
		row(3, S, 'patch', { x: 50, y: 150, parent: F }),
		row(3, X, 'patch', { x: -90, y: 70, parent: F }),
	]
	assert.deepEqual(checkOps(good, [...setup, b3]), [])
	const both = good.map((r) => (r.rev === 3 && r.item_id === X ? row(3, X, 'patch', { x: 10, y: 120, parent: F }) : r))
	const d = checkOps(both, [...setup, b3])
	assert.ok(d.length === 1 && d[0].id === X && d[0].op === 1, JSON.stringify(d))
	// a stored child with only the first shift
	const once = good.map((r) => (r.rev === 3 && r.item_id === C1 ? row(3, C1, 'patch', { x: 110, y: 60, parent: F }) : r))
	const d2 = checkOps(once, [...setup, b3])
	assert.ok(d2.length === 1 && d2[0].id === C1 && d2[0].o === 'keep', JSON.stringify(d2))
})

test('check 3, keep then removing the container in the same batch: children are shifted, then released at its end position (rule 15 + rule 6); untouched children are derived rows', () => {
	const { base, setup } = keepWorld()
	const ops3 = [
		{ o: 'patch', id: C2, p: { x: 200, y: 300, parent: F } }, // before the keep: shifted, then released
		{ o: 'patch', id: F, keep: true, p: { x: 900, y: 950, parent: null } },
		{ o: 'remove', id: F },
	]
	const b3 = batch(3, ops3, ['ok', 'ok', 'ok'])
	// absolute positions stay: C1 (1010, 1010), S (1050, 1050), C2 (1200, 1300) = the intent of op 0
	const good = [...base,
		row(3, C1, 'patch', { x: 1010, y: 1010, parent: null }),
		row(3, C2, 'patch', { x: 1200, y: 1300, parent: null }),
		row(3, S, 'patch', { x: 1050, y: 1050, parent: null }),
		row(3, F, 'remove', null),
	]
	assert.deepEqual(checkOps(good, [...setup, b3]), [])
	// released without the keep shift: x/y + the frame's end position only
	const noShift = [...base,
		row(3, C1, 'patch', { x: 910, y: 960, parent: null }),
		row(3, C2, 'patch', { x: 1100, y: 1250, parent: null }),
		row(3, S, 'patch', { x: 950, y: 1000, parent: null }),
		row(3, F, 'remove', null),
	]
	const d = checkOps(noShift, [...setup, b3])
	assert.deepEqual(d.map((x) => [x.id, x.o]).sort(), [[C1, 'release'], [C2, 'patch'], [S, 'release']].sort(), JSON.stringify(d))
	// an untouched child left inside the removed frame (no release row) is a deviation, also without keep (M0)
	const m0 = batch(3, [{ o: 'remove', id: F }], ['ok'])
	const kept = [...base, row(3, C2, 'patch', { x: 1100, y: 1100, parent: null }), row(3, S, 'patch', { x: 1050, y: 1050, parent: null }), row(3, F, 'remove', null)]
	const d2 = checkOps(kept, [...setup, m0])
	assert.ok(d2.length === 1 && d2[0].id === C1 && d2[0].o === 'release' && /nicht freigegeben/.test(d2[0].problem), JSON.stringify(d2))
})

// ── SPEC-M1 stage 1: connector ends (rule 14) ──
// Ids here are real ULIDs (no I, L, O, U): connector ends are checked against ULID_RE.

const A = '01KN0RKEA0000000000000000A'
const K = '01KN0RKEK0000000000000000K'
const K2 = '01KN0RKEK2000000000000000K'
const conn = (start, end, extra = {}) => item('connector', { w: 0, h: 0, data: { route: 'straight', start, end }, style: { stroke: '#1a1a1a' }, ...extra })

test('check 3, connector ends: stored form with q(v, 10000) for ax/ay; a raw value is a deviation', () => {
	const base = [row(1, A, 'put', item('shape', { x: 100, y: 40, w: 200, h: 120, data: { kind: 'rect' } }))]
	const b1 = batch(1, [put(A, 'shape', { x: 100, y: 40, w: 200, h: 120, data: { kind: 'rect' } })], ['ok'])
	const op = batch(2, [put(K, 'connector', conn({ item: A, ax: 0.123456, ay: 1 }, { x: 5, y: 6 }))], ['ok'])
	const good = [...base, row(2, K, 'put', conn({ item: A, ax: 0.1235, ay: 1 }, { x: 5, y: 6 }))]
	assert.deepEqual(checkOps(good, [b1, op]), [])
	const raw = [...base, row(2, K, 'put', conn({ item: A, ax: 0.123456, ay: 1 }, { x: 5, y: 6 }))]
	const d = checkOps(raw, [b1, op])
	assert.equal(d.length, 1)
	assert.match(d[0].problem, /data\.start/)
})

/** Shape A rotated 30° with connectors K (start anchored at (1, 0.5)) and K2 (end auto). */
function connWorld() {
	const a = { x: 100, y: 40, w: 200, h: 120, r: 30, data: { kind: 'rect' } }
	return {
		rows: [row(1, A, 'put', item('shape', a)), row(2, K, 'put', conn({ item: A, ax: 1, ay: 0.5 }, { x: 0, y: 0 })), row(2, K2, 'put', conn({ x: 10, y: 10 }, { item: A }))],
		batches: [batch(1, [put(A, 'shape', a)], ['ok']), batch(2, [put(K, 'connector', conn({ item: A, ax: 1, ay: 0.5 }, { x: 0, y: 0 })), put(K2, 'connector', conn({ x: 10, y: 10 }, { item: A }))], ['ok', 'ok'])],
	}
}

test('check 3, connector release: removing the target frees bound ends at the anchor (rotated ±0.01, auto exact); a missing release is reported', () => {
	const { rows, batches } = connWorld()
	const rm = batch(3, [{ o: 'remove', id: A }], ['ok'])
	// anchor (1, 0.5) of the box rotated 30°: (286.6, 150); the centre (200, 100)
	const good = [...rows, row(3, A, 'remove', null), row(3, K, 'patch', { 'data.start': { x: 286.6, y: 150 } }), row(3, K2, 'patch', { 'data.end': { x: 200, y: 100 } })]
	assert.deepEqual(checkOps(good, [...batches, rm]), [])
	const near = [...rows, row(3, A, 'remove', null), row(3, K, 'patch', { 'data.start': { x: 286.609, y: 149.995 } }), row(3, K2, 'patch', { 'data.end': { x: 200, y: 100 } })]
	assert.deepEqual(checkOps(near, [...batches, rm]), [], 'rotated target: within ±0.01')
	const off = [...rows, row(3, A, 'remove', null), row(3, K, 'patch', { 'data.start': { x: 286.62, y: 150 } }), row(3, K2, 'patch', { 'data.end': { x: 200.01, y: 100 } })]
	assert.equal(checkOps(off, [...batches, rm]).length, 2, 'beyond ±0.01 (rotated) and any difference (auto, exact)')
	const none = [...rows, row(3, A, 'remove', null)]
	const d = checkOps(none, [...batches, rm])
	assert.equal(d.length, 2, 'no release rows: both connectors still bound to a removed item')
	assert.ok(d.every((x) => x.o === 'release'))
})

test('check 3, connector ends: end on an item removed earlier in the batch, client release before the remove, remove + revive keeps the binding', () => {
	const { rows, batches } = connWorld()
	const C = '01KN0RKEC3000000000000000C'
	const K3 = '01KN0RKEK3000000000000000K'
	const r3 = [...rows, row(3, C, 'put', item('shape', { x: 900, y: -300, w: 80, h: 60 })), row(3, K3, 'put', conn({ x: 1, y: 1 }, { x: 2, y: 2 }))]
	const b3 = batch(3, [put(C, 'shape', { x: 900, y: -300, w: 80, h: 60 }), put(K3, 'connector', conn({ x: 1, y: 1 }, { x: 2, y: 2 }))], ['ok', 'ok'])
	// remove C, then K3.end onto C in the same batch → free point at C's anchor (0, 0) = (900, -300)
	const b4 = batch(4, [{ o: 'remove', id: C }, { o: 'patch', id: K3, p: { 'data.end': { item: C, ax: 0, ay: 0 } } }], ['ok', 'ok'])
	const r4 = [...r3, row(4, C, 'remove', null), row(4, K3, 'patch', { 'data.end': { x: 900, y: -300 } })]
	assert.deepEqual(checkOps(r4, [...batches, b3, b4]), [])
	assert.equal(checkOps([...r3, row(4, C, 'remove', null), row(4, K3, 'patch', { 'data.end': { item: C, ax: 0, ay: 0 } })], [...batches, b3, b4]).length, 1, 'a bound end on a removed item is a deviation')
	// client release before the remove: the client's point, no anchor
	const b5 = batch(5, [{ o: 'patch', id: K, p: { 'data.start': { x: 7.5, y: 8.5 } } }, { o: 'remove', id: A }], ['ok', 'ok'])
	const r5 = [...r4, row(5, K, 'patch', { 'data.start': { x: 7.5, y: 8.5 } }), row(5, A, 'remove', null), row(5, K2, 'patch', { 'data.end': { x: 200, y: 100 } })]
	assert.deepEqual(checkOps(r5, [...batches, b3, b4, b5]), [])
	// remove + revive of the target in one batch: the end stays bound, nothing released
	const { rows: rw, batches: bw } = connWorld()
	const rv = { ...put(A, 'shape', { x: 100, y: 40, w: 200, h: 120, r: 30, data: { kind: 'rect' } }), revive: true }
	const b6 = batch(3, [{ o: 'remove', id: A }, rv], ['ok', 'ok'])
	assert.deepEqual(checkOps([...rw, row(3, A, 'put', item('shape', { x: 100, y: 40, w: 200, h: 120, r: 30, data: { kind: 'rect' } }))], [...bw, b6]), [])
	assert.equal(checkOps([...rw, row(3, A, 'put', item('shape', { x: 100, y: 40, w: 200, h: 120, r: 30, data: { kind: 'rect' } })), row(3, K2, 'patch', { 'data.end': { x: 200, y: 100 } })], [...bw, b6]).length, 1, 'a release despite the revive is a deviation')
	// a connector removed together with its target is not released
	const b7 = batch(3, [{ o: 'remove', id: K2 }, { o: 'remove', id: A }], ['ok', 'ok'])
	assert.deepEqual(checkOps([...rw, row(3, K2, 'remove', null), row(3, A, 'remove', null), row(3, K, 'patch', { 'data.start': { x: 286.6, y: 150 } })], [...bw, b7]), [])
})

test('check 3, connector ends: an ok end on a frame, a connector, itself or a never existing item is reported', () => {
	const { rows, batches } = connWorld()
	const F2 = '01KN0RKEF2000000000000000F'
	const r3 = [...rows, row(3, F2, 'put', item('frame', { w: 800, h: 600 }))]
	const b3 = batch(3, [put(F2, 'frame', { w: 800, h: 600 })], ['ok'])
	for (const target of [F2, K2, K, '01KN0RKEXX000000000000000X']) {
		const b4 = batch(4, [{ o: 'patch', id: K, p: { 'data.end': { item: target } } }], ['ok'])
		const d = checkOps([...r3, row(4, K, 'patch', { 'data.end': { item: target } })], [...batches, b3, b4])
		assert.ok(d.some((x) => /nicht bindbarem Ziel/.test(x.problem)), `target ${target}`)
	}
})

test('check 3, connector ends (R9): a target created and removed in the same batch counts as removed in the batch (free point at its anchor)', () => {
	const T = '01KN0RKET0000000000000000T'
	const K4 = '01KN0RKEK4000000000000000K'
	const K5 = '01KN0RKEK5000000000000000K'
	const t0 = { x: 100, y: 40, w: 200, h: 120, data: { kind: 'rect' } }
	// end written onto the target after its removal: free point at the anchor (0, 0) = (100, 40)
	const b1 = batch(1, [put(T, 'shape', t0), { o: 'remove', id: T }, put(K4, 'connector', conn({ item: T, ax: 0, ay: 0 }, { x: 1, y: 1 }))], ['ok', 'ok', 'ok'])
	assert.deepEqual(checkOps([row(1, K4, 'put', conn({ x: 100, y: 40 }, { x: 1, y: 1 }))], [b1]), [])
	assert.equal(checkOps([row(1, K4, 'put', conn({ item: T, ax: 0, ay: 0 }, { x: 1, y: 1 }))], [b1]).length, 1, 'still bound to the never stored target')
	// bound while the target lived, the target removed later in the batch: released at the end (auto → centre (200, 100))
	const b2 = batch(1, [put(T, 'shape', t0), put(K5, 'connector', conn({ x: 1, y: 1 }, { item: T })), { o: 'remove', id: T }], ['ok', 'ok', 'ok'])
	assert.deepEqual(checkOps([row(1, K5, 'put', conn({ x: 1, y: 1 }, { x: 200, y: 100 }))], [b2]), [])
	assert.equal(checkOps([row(1, K5, 'put', conn({ x: 1, y: 1 }, { item: T }))], [b2]).length, 1, 'a bound end on the removed target is a deviation')
})

test('check 3, connector release (R9): the anchor comes from the working copies at the END of the batch – a container moved after the target\'s removal counts with its end position', () => {
	const FR = '01KN0RKEFR000000000000000F'
	const T = '01KN0RKET0000000000000000T'
	const K6 = '01KN0RKEK6000000000000000K'
	const rows = [
		row(1, FR, 'put', item('frame', { x: 1000, y: 1000, w: 800, h: 600 })),
		row(1, T, 'put', item('shape', { parent: FR, x: 10, y: 20, w: 200, h: 100, data: { kind: 'rect' } })),
		row(1, K6, 'put', conn({ x: 0, y: 0 }, { item: T })),
	]
	const b1 = batch(1, [put(FR, 'frame', { x: 1000, y: 1000, w: 800, h: 600 }), put(T, 'shape', { parent: FR, x: 10, y: 20, w: 200, h: 100, data: { kind: 'rect' } }), put(K6, 'connector', conn({ x: 0, y: 0 }, { item: T }))], ['ok', 'ok', 'ok'])
	const b2 = batch(2, [{ o: 'remove', id: T }, { o: 'patch', id: FR, p: { x: 1500, y: 1000, parent: null } }], ['ok', 'ok'])
	// centre of T with the frame at its end position (1500, 1000): (1610, 1070)
	const good = [...rows, row(2, T, 'remove', null), row(2, FR, 'patch', { x: 1500, y: 1000, parent: null }), row(2, K6, 'patch', { 'data.end': { x: 1610, y: 1070 } })]
	assert.deepEqual(checkOps(good, [b1, b2]), [])
	// the frame's position at the time of the removal (1000, 1000): no longer a reading of the spec
	const atRemoval = [...rows, row(2, T, 'remove', null), row(2, FR, 'patch', { x: 1500, y: 1000, parent: null }), row(2, K6, 'patch', { 'data.end': { x: 1110, y: 1070 } })]
	const d = checkOps(atRemoval, [b1, b2])
	assert.ok(d.length === 1 && d[0].id === K6 && d[0].o === 'release', JSON.stringify(d))
})

// ── round 1b: connectors at full strength in the workload (SPEC-M1 §8.6) ──

/** Frame FR at (1000, 1000) with child T (10, 20, 200 × 100) and connector K7 (start free, end auto on T). */
function keepConnWorld() {
	const FR = '01KN0RKEFR000000000000000F'
	const T = '01KN0RKET0000000000000000T'
	const K7 = '01KN0RKEK7000000000000000K'
	const fr = { x: 1000, y: 1000, w: 800, h: 600 }
	const t = { parent: FR, x: 10, y: 20, w: 200, h: 100, data: { kind: 'rect' } }
	return {
		FR, T, K7,
		rows: [row(1, FR, 'put', item('frame', fr)), row(1, T, 'put', item('shape', t)), row(1, K7, 'put', conn({ x: 0, y: 0 }, { item: T }))],
		batches: [batch(1, [put(FR, 'frame', fr), put(T, 'shape', t), put(K7, 'connector', conn({ x: 0, y: 0 }, { item: T }))], ['ok', 'ok', 'ok'])],
	}
}

test('check 3, keep with connectors (rules 14 + 15, R9): keep patch first, then the child removed – the release anchor is the shifted child plus the frame\'s end position (the point stays)', () => {
	const { FR, T, K7, rows, batches } = keepConnWorld()
	const keep = { o: 'patch', id: FR, p: { x: 900, y: 950, parent: null, w: 900, h: 650 }, keep: true }
	const b2 = batch(2, [keep, { o: 'remove', id: T }], ['ok', 'ok'])
	// T shifted to (110, 70) relative to (900, 950): centre (1110, 1070), the same absolute point as before
	const good = [...rows, row(2, FR, 'patch', { x: 900, y: 950, w: 900, h: 650 }), row(2, T, 'remove', null), row(2, K7, 'patch', { 'data.end': { x: 1110, y: 1070 } })]
	assert.deepEqual(checkOps(good, [...batches, b2]), [])
	// unshifted child with the frame's end position: (1010, 1020) is the other order's reading, a deviation here
	const d = checkOps([...rows, row(2, FR, 'patch', { x: 900, y: 950, w: 900, h: 650 }), row(2, T, 'remove', null), row(2, K7, 'patch', { 'data.end': { x: 1010, y: 1020 } })], [...batches, b2])
	assert.ok(d.length === 1 && d[0].id === K7 && d[0].o === 'release', JSON.stringify(d))
})

test('check 3, keep with connectors (rules 14 + 15, R9): child removed first, then the keep patch – the removed child is no live child at the keep op and the anchor moves with the frame', () => {
	const { FR, T, K7, rows, batches } = keepConnWorld()
	const keep = { o: 'patch', id: FR, p: { x: 900, y: 950, parent: null, w: 900, h: 650 }, keep: true }
	const b2 = batch(2, [{ o: 'remove', id: T }, keep], ['ok', 'ok'])
	const good = [...rows, row(2, T, 'remove', null), row(2, FR, 'patch', { x: 900, y: 950, w: 900, h: 650 }), row(2, K7, 'patch', { 'data.end': { x: 1010, y: 1020 } })]
	assert.deepEqual(checkOps(good, [...batches, b2]), [])
	const d = checkOps([...rows, row(2, T, 'remove', null), row(2, FR, 'patch', { x: 900, y: 950, w: 900, h: 650 }), row(2, K7, 'patch', { 'data.end': { x: 1110, y: 1070 } })], [...batches, b2])
	assert.ok(d.length === 1 && d[0].id === K7 && d[0].o === 'release', JSON.stringify(d))
})

test('check 3, connector put bound to a frame child in the same batch as the keep patch and the child\'s removal: released at the end of the batch', () => {
	const { FR, T, rows, batches } = keepConnWorld()
	const K8 = '01KN0RKEK8000000000000000K'
	const keep = { o: 'patch', id: FR, p: { x: 1100, y: 1000, parent: null, w: 700, h: 600 }, keep: true }
	const b2 = batch(2, [put(K8, 'connector', conn({ item: T, ax: 1, ay: 0 }, { x: 5, y: 5 })), keep, { o: 'remove', id: T }], ['ok', 'ok', 'ok'])
	// anchor (1, 0) of T: shifted by −100 to x −90, plus the frame's (1100, 1000) → (1210, 1020) = where it stood
	const good = [...rows, row(2, K8, 'put', conn({ x: 1210, y: 1020 }, { x: 5, y: 5 })), row(2, FR, 'patch', { x: 1100, w: 700 }), row(2, T, 'remove', null), row(2, '01KN0RKEK7000000000000000K', 'patch', { 'data.end': { x: 1110, y: 1070 } })]
	assert.deepEqual(checkOps(good, [...batches, b2]), [])
	assert.equal(checkOps([...rows, row(2, K8, 'put', conn({ item: T, ax: 1, ay: 0 }, { x: 5, y: 5 })), row(2, FR, 'patch', { x: 1100, w: 700 }), row(2, T, 'remove', null), row(2, '01KN0RKEK7000000000000000K', 'patch', { 'data.end': { x: 1110, y: 1070 } })], [...batches, b2]).length, 1, 'the new connector still bound to the removed child')
})

test('check 3, concurrent removal: an end onto an item another client removed in an earlier batch becomes the free point at the tombstone\'s anchor, with its container\'s current position', () => {
	const { FR, T, K7, rows, batches } = keepConnWorld()
	// cB removes T, then moves the frame (T stays a tombstone child of FR); cA, unaware, binds K7.start to T
	const b2 = batch(2, [{ o: 'remove', id: T }], ['ok'], 1, 'cB')
	const b3 = batch(3, [{ o: 'patch', id: FR, p: { x: 2000, y: 1000, parent: null } }], ['ok'], 2, 'cB')
	const b4 = batch(4, [{ o: 'patch', id: K7, p: { 'data.start': { item: T, ax: 0, ay: 0 } } }], ['ok'], 2, 'cA')
	const base = [...rows, row(2, T, 'remove', null, 'cB'), row(2, K7, 'patch', { 'data.end': { x: 1110, y: 1070 } }, 'cB'), row(3, FR, 'patch', { x: 2000 }, 'cB')]
	// anchor (0, 0) of T relative to FR at (2000, 1000): (2010, 1020)
	assert.deepEqual(checkOps([...base, row(4, K7, 'patch', { 'data.start': { x: 2010, y: 1020 } })], [...batches, b2, b3, b4]), [])
	assert.equal(checkOps([...base, row(4, K7, 'patch', { 'data.start': { x: 1010, y: 1020 } })], [...batches, b2, b3, b4]).length, 1, 'the container position at the removal is no reading')
	assert.equal(checkOps([...base, row(4, K7, 'patch', { 'data.start': { item: T, ax: 0, ay: 0 } })], [...batches, b2, b3, b4]).length, 1, 'bound to a tombstone')
})

test('connectorStats (K0 of the convergence run, round 1b): every kind is counted from the batches and their own log rows', () => {
	const { FR, T, K7, rows, batches } = keepConnWorld()
	const U = '01KN0RKEY0000000000000000Y'
	const V = '01KN0RKEV0000000000000000V'
	const K9 = '01KN0RKEK9000000000000000K'
	const bU = batch(2, [put(U, 'shape', { x: 0, y: 0, w: 50, h: 50 }), put(V, 'shape', { x: 300, y: 0, w: 50, h: 50 })], ['ok', 'ok'], 2, 'cB')
	// cB removes U (K7 untouched in that batch? no: K7 is bound to T, not U)
	const b3 = batch(3, [{ o: 'remove', id: U }], ['ok'], 3, 'cB')
	// cA: K7.start onto the tombstone U (taken from its live mirror: stale), K9 put bound to V, then V removed
	// later in the batch (released in batch), K7.end onto T after T's removal (onto removed in batch)
	const stale = { item: U }
	const b4 = batch(4, [put(K9, 'connector', conn({ item: V }, { x: 1, y: 1 })), { o: 'remove', id: V }, { o: 'remove', id: T }, { o: 'patch', id: K7, p: { 'data.start': stale, 'data.end': { item: T } } }], ['ok', 'ok', 'ok', 'ok'], 4, 'cA')
	const all = [...rows,
		row(2, U, 'put', item('shape', { x: 0, y: 0, w: 50, h: 50 }), 'cB'), row(2, V, 'put', item('shape', { x: 300, y: 0, w: 50, h: 50 }), 'cB'),
		row(3, U, 'remove', null, 'cB'),
		row(4, K9, 'put', conn({ x: 325, y: 25 }, { x: 1, y: 1 }), 'cA'), row(4, V, 'remove', null, 'cA'), row(4, T, 'remove', null, 'cA'),
		row(4, K7, 'patch', { 'data.start': { x: 25, y: 25 }, 'data.end': { x: 1110, y: 1070 } }, 'cA')]
	const bs = [...batches, bU, b3, b4]
	assert.deepEqual(checkOps(all, bs), [], 'the hand-made log itself is right')
	const s = connectorStats(all, bs, { sourceOf: (op, side) => (op.p?.['data.' + side] === stale ? 'live' : null) })
	assert.deepEqual(s, { puts: 2, retargets: 1, boundEnds: 4, ontoRemovedInBatch: 1, releasedInBatch: 1, ontoTombstone: 1, ontoTombstoneForeign: 1, ontoTombstoneStale: 1, releasedDerived: 0 })
	// a remove of a bound item in a batch that does not touch the connector: one derived release row
	const W = '01KN0RKEW0000000000000000W'
	const K10 = '01KN0RKEKA000000000000000K'
	const b5 = batch(5, [put(W, 'sticky', { x: 0, y: 0 }), put(K10, 'connector', conn({ item: W }, { x: 9, y: 9 }))], ['ok', 'ok'], 5, 'cA')
	const b6 = batch(6, [{ o: 'remove', id: W }], ['ok'], 6, 'cB')
	const more = [...all, row(5, W, 'put', item('sticky', { x: 0, y: 0 }), 'cA'), row(5, K10, 'put', conn({ item: W }, { x: 9, y: 9 }), 'cA'), row(6, W, 'remove', null, 'cB'), row(6, K10, 'patch', { 'data.start': { x: 100, y: 100 } }, 'cB')]
	assert.deepEqual(checkOps(more, [...bs, b5, b6]), [])
	const s2 = connectorStats(more, [...bs, b5, b6])
	assert.equal(s2.releasedDerived, 1)
	assert.equal(s2.puts, 3)
	assert.equal(s2.ontoTombstoneStale, 0, 'without sourceOf nothing is stale')
	// a rolled-back batch (no rows of its own at its rev) counts nothing
	assert.deepEqual(connectorStats(more, [batch(6, [{ o: 'remove', id: W }], ['ok'], 7, 'cC')]), { puts: 0, retargets: 0, boundEnds: 0, ontoRemovedInBatch: 0, releasedInBatch: 0, ontoTombstone: 0, ontoTombstoneForeign: 0, ontoTombstoneStale: 0, releasedDerived: 0 })
})

// ── SPEC-M1 stage 4: the fault purge of the convergence run (§8.6 R19, T4-14; R20 K1) ──
// §4.13.7 "Folgen": put (+ revive) of a purged id = creation `ok`, patch or remove → `gone`, a
// parent or a connector end on a purged id → `bad`. A deviation about a purged id is not counted
// only when the server's code is the one of "Folgen"; a code that contradicts it is a deviation of
// its own. Valid ULIDs (connector ends are checked against ULID_RE).

const PS = '01KN0RKEPS000000000000000S' // sticky, purged
const PF = '01KN0RKEPF000000000000000F' // frame, purged
const PA = '01KN0RKEPA000000000000000A' // shape, purged (bindable)
const B = '01KN0RKEB0000000000000000B' // shape, alive
const KC = '01KN0RKEKC000000000000000K' // connector, alive (B → a free point)
const KN = '01KN0RKEKN000000000000000K' // connector put after the purge
const N1 = '01KN0RKEN1000000000000000N'
const N2 = '01KN0RKEN2000000000000000N'

/**
 * rev 1: PS, PF, PA, B and KC; rev 2: PS, PF, PA removed; the purge (board rev 2 – a purge
 * raises no rev) removes PS, PF and PA for good. Every later batch puts N1 first, so it commits.
 */
function purgeWorld() {
	const p = {
		[PS]: ['sticky', {}],
		[PF]: ['frame', { x: 1000, y: 500, w: 400, h: 300 }],
		[PA]: ['shape', { x: 100, y: 40, w: 200, h: 120, data: { kind: 'rect' } }],
		[B]: ['shape', { x: 600, y: 40, w: 100, h: 100, data: { kind: 'rect' } }],
		[KC]: ['connector', conn({ item: B }, { x: 5, y: 6 })],
	}
	const rows = Object.entries(p).map(([id, [t, q]]) => row(1, id, 'put', t === 'connector' ? q : item(t, q)))
	const b1 = batch(1, Object.entries(p).map(([id, [t, q]]) => (t === 'connector' ? { o: 'put', id, t, p: q } : put(id, t, q))), ['ok', 'ok', 'ok', 'ok', 'ok'])
	rows.push(row(2, PS, 'remove', null), row(2, PF, 'remove', null), row(2, PA, 'remove', null))
	const b2 = batch(2, [{ o: 'remove', id: PS }, { o: 'remove', id: PF }, { o: 'remove', id: PA }], ['ok', 'ok', 'ok'])
	return { rows: [...rows, row(3, N1, 'put', item('sticky'))], batches: [b1, b2], purges: [{ rev: 2, ids: [PS, PF, PA] }] }
}
/** checkOps with the purges, collecting onPurged and onFolgen. */
function judge(rows, batches, purges) {
	const accepted = []
	const folgen = []
	const d = checkOps(rows, batches, { purges, onPurged: (x) => accepted.push(x), onFolgen: (x) => folgen.push(`${x.o} ${x.id.slice(8, 10)} ${x.code}`) })
	return { d, accepted, folgen }
}

test('R20 K1, purgedBefore: purges before the batch, the latest one of an id; an id with a row after its purge that the batch saw is an ordinary item again', async () => {
	const { purgedBefore, touchesPurged } = await import('./lib/oracle.mjs')
	const purges = [{ rev: 2, ids: [PS, PF] }]
	assert.deepEqual([...purgedBefore({ rev: 3 }, purges)], [PS, PF])
	assert.deepEqual([...purgedBefore({ rev: 2 }, purges)], [], 'a batch at the purge rev or before it is not affected')
	const revs = new Map([[PS, [1, 2, 3]], [PF, [1, 2]]])
	assert.deepEqual([...purgedBefore({ rev: 3 }, purges, revs)], [PS, PF], 'the writer of rev 3 does not see its own row')
	assert.deepEqual([...purgedBefore({ rev: 3 }, purges, revs, false)], [PF], 'a batch checked after rev 3 sees the creation of PS')
	assert.deepEqual([...purgedBefore({ rev: 4 }, purges, revs)], [PF], 'PS was created anew at rev 3')
	// PS created anew at 3, removed at 4 and purged again (board rev 4): purged again for rev 5
	const again = [...purges, { rev: 4, ids: [PS] }]
	assert.deepEqual([...purgedBefore({ rev: 5 }, again, new Map([[PS, [1, 2, 3, 4]]]))].sort(), [PF, PS].sort())
	assert.equal(touchesPurged({ id: N1, parent: PS }, new Set([PS])), true, 'a parent counts')
	assert.equal(touchesPurged({ id: N1, target: PS }, new Set([PS])), true, 'a connector end counts')
	assert.equal(touchesPurged({ id: N1 }, new Set([PS])), false)
})

test('R20 K1, folgenCode and contradictsFolgen: the rules of §4.13.7 "Folgen" in the order of the server', async () => {
	const { folgenCode, contradictsFolgen } = await import('./lib/oracle.mjs')
	const purged = (id) => [PS, PF, PA].includes(id)
	const typeOf = (id) => ({ [KC]: 'connector', [B]: 'shape' })[id]
	assert.equal(folgenCode({ ...put(PS, 'sticky'), revive: true }, purged), 'ok', 'put + revive = creation')
	assert.equal(folgenCode(put(PS, 'sticky'), purged), 'ok', 'a put without revive creates "none" the same way')
	assert.equal(folgenCode({ o: 'patch', id: PS, p: { 'data.text': 'x' } }, purged), 'gone')
	assert.equal(folgenCode({ o: 'remove', id: PS }, purged), 'gone')
	assert.equal(folgenCode({ o: 'patch', id: PS, p: { parent: PF } }, purged), 'gone', 'the own id first: gone before bad')
	assert.equal(folgenCode(put(N1, 'sticky', { parent: PF }), purged), 'bad', 'parent on a purged frame')
	assert.equal(folgenCode({ o: 'patch', id: N1, p: { x: 0, y: 0, parent: PF } }, purged), 'bad')
	assert.equal(folgenCode({ ...put(PS, 'sticky', { parent: PF }), revive: true }, purged), 'bad', 'a creation under a purged parent')
	assert.equal(folgenCode({ o: 'put', id: KN, t: 'connector', p: conn({ item: PA }, { x: 5, y: 6 }) }, purged), 'bad', 'connector end on a purged item')
	assert.equal(folgenCode({ o: 'patch', id: KC, p: { 'data.end': { item: PA, ax: 0, ay: 1 } } }, purged, typeOf), 'bad')
	assert.equal(folgenCode({ o: 'patch', id: B, p: { 'data.end': { item: PA } } }, purged, typeOf), null, 'ends count only on a connector')
	assert.equal(folgenCode({ o: 'patch', id: N1, p: { 'data.text': 'x' } }, purged), null, 'no purged id: no rule')
	assert.equal(folgenCode({ o: 'vote', id: PS }, purged), null)
	for (const [w, g, c] of [['gone', 'ok', true], ['gone', 'gone', false], ['gone', 'bad', false], ['gone', 'denied', false], ['bad', 'ok', true], ['bad', 'dup', false], ['bad', 'gone', false],
		['ok', 'gone', true], ['ok', 'dup', true], ['ok', 'ok', false], ['ok', 'limit', false], ['ok', 'bad', false], [null, 'ok', false]]) {
		assert.equal(contradictsFolgen(w, g), c, `${w} / ${g}`)
	}
})

test('R20 K1, rule put + revive → ok: the creation is no deviation; gone is one, and so is an ok without the creation in the log', () => {
	const { rows, batches, purges } = purgeWorld()
	const revive = { ...put(PS, 'sticky', { data: { text: 'again' } }), revive: true }
	const good = [...rows, row(3, PS, 'put', item('sticky', { data: { text: 'again' } }))]
	let j = judge(good, [...batches, batch(3, [put(N1, 'sticky'), revive], ['ok', 'ok'])], purges)
	assert.deepEqual(j.d, [])
	assert.deepEqual(j.folgen, ['put PS ok'])
	// the server still knew the tombstone: gone instead of the creation
	j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), revive], ['ok', 'gone'])], purges)
	assert.equal(j.d.length, 1, JSON.stringify(j.d))
	assert.match(j.d[0].problem, /^Code gone statt ok nach §4\.13\.7 „Folgen“/)
	assert.deepEqual([j.d[0].id, j.d[0].op, j.d[0].want, j.d[0].got], [PS, 1, 'ok', 'gone'])
	// ok, but no creation in the log: the deviation stays (marked), nothing goes to onPurged
	j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), revive], ['ok', 'ok'])], purges)
	assert.equal(j.d.length, 1, JSON.stringify(j.d))
	assert.match(j.d[0].problem, /fehlt aber im Log-Zustand/)
	assert.deepEqual(j.d[0].purged, { want: 'ok', got: 'ok' })
	assert.deepEqual(j.accepted, [])
	// the code of "Folgen" and the item created anew: a deviation about it is taken, through onPurged (§8.6 R20)
	const other = [...rows, row(3, PS, 'put', item('sticky', { data: { text: 'other' } }))]
	j = judge(other, [...batches, batch(3, [put(N1, 'sticky'), revive], ['ok', 'ok'])], purges)
	assert.deepEqual(j.d, [])
	assert.equal(j.accepted.length, 1)
	assert.match(j.accepted[0].problem, /Pfad data\.text weicht ab/)
	assert.equal(checkOps(other, [...batches, batch(3, [put(N1, 'sticky'), revive], ['ok', 'ok'])]).length, 1, 'without the purges it counts')
})

test('R20 K1, rule patch or remove → gone: no deviation; an ok stays a deviation (the code differs from "Folgen")', () => {
	const { rows, batches, purges } = purgeWorld()
	const patch = { o: 'patch', id: PS, p: { 'style.fill': '#ffaa00' } }
	const rm = { o: 'remove', id: PF }
	let j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), patch, rm], ['ok', 'gone', 'gone'])], purges)
	assert.deepEqual(j.d, [])
	assert.deepEqual(j.folgen, ['patch PS gone', 'remove PF gone'])
	// patch answered ok: verifyBatch reports it (PS is no item in the log) – it is NOT taken
	j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), patch], ['ok', 'ok'])], purges)
	assert.equal(j.d.length, 1, JSON.stringify(j.d))
	assert.match(j.d[0].problem, /fehlt aber im Log-Zustand/)
	assert.deepEqual(j.d[0].purged, { want: 'gone', got: 'ok' })
	assert.deepEqual(j.accepted, [], 'a deviation with the wrong code never goes to onPurged')
	// remove answered ok: the log shows a tombstone either way, only the code tells
	j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), rm], ['ok', 'ok'])], purges)
	assert.equal(j.d.length, 1, JSON.stringify(j.d))
	assert.match(j.d[0].problem, /^Code ok statt gone/)
	assert.deepEqual(checkOps(rows, [...batches, batch(3, [put(N1, 'sticky'), rm], ['ok', 'ok'])]), [], 'without the purges nothing to see')
})

test('R20 K1, rule parent on a purged frame → bad: no deviation; an ok with the tombstone release is one', () => {
	const { rows, batches, purges } = purgeWorld()
	const child = put(N2, 'sticky', { x: 10, y: 20, parent: PF })
	let j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), child, { o: 'patch', id: N1, p: { x: 1, y: 2, parent: PF } }], ['ok', 'bad', 'bad'])], purges)
	assert.deepEqual(j.d, [])
	assert.deepEqual(j.folgen, ['put N2 bad', 'patch N1 bad'])
	// ok and released at the frame's last position, as for a tombstone (§4.7 rule 6)
	const released = [...rows, row(3, N2, 'put', item('sticky', { x: 1010, y: 520, parent: null }))]
	const bs = [...batches, batch(3, [put(N1, 'sticky'), child], ['ok', 'ok'])]
	assert.deepEqual(checkOps(released, bs), [], 'the replayed log alone cannot tell: PF is a tombstone there')
	j = judge(released, bs, purges)
	assert.equal(j.d.length, 1, JSON.stringify(j.d))
	assert.match(j.d[0].problem, /^Code ok statt bad nach §4\.13\.7 „Folgen“/)
	assert.deepEqual([j.d[0].id, j.d[0].want, j.d[0].got], [N2, 'bad', 'ok'])
})

test('R20 K1, rule connector end on a purged item → bad (put and patch): no deviation; an ok with the free point is one', () => {
	const { rows, batches, purges } = purgeWorld()
	const kn = { o: 'put', id: KN, t: 'connector', p: conn({ item: PA }, { x: 5, y: 6 }) }
	const retarget = { o: 'patch', id: KC, p: { 'data.end': { item: PA } } }
	let j = judge(rows, [...batches, batch(3, [put(N1, 'sticky'), kn, retarget], ['ok', 'bad', 'bad'])], purges)
	assert.deepEqual(j.d, [])
	assert.deepEqual(j.folgen, ['put KN bad', 'patch KC bad'])
	// ok with the free point at PA's centre (200, 100), as for a tombstone (§4.7 rule 14)
	const freed = [...rows, row(3, KN, 'put', conn({ x: 200, y: 100 }, { x: 5, y: 6 })), row(3, KC, 'patch', { 'data.end': { x: 200, y: 100 } })]
	const bs = [...batches, batch(3, [put(N1, 'sticky'), kn, retarget], ['ok', 'ok', 'ok'])]
	assert.deepEqual(checkOps(freed, bs), [], 'the replayed log alone cannot tell')
	j = judge(freed, bs, purges)
	assert.deepEqual(j.d.map((d) => [d.id, d.problem.slice(0, 20)]), [[KN, 'Code ok statt bad na'], [KC, 'Code ok statt bad na']])
})

test('R20 K1: an id created anew – in an earlier batch or earlier in the same batch – is an ordinary item again; a deviation about it counts', () => {
	const { rows, batches, purges } = purgeWorld()
	const revive = { ...put(PS, 'sticky'), revive: true }
	const fill = { o: 'patch', id: PS, p: { 'style.fill': '#ffaa00' } }
	const base = [...rows, row(3, PS, 'put', item('sticky'))]
	const bs = [...batches, batch(3, [put(N1, 'sticky'), revive], ['ok', 'ok']), batch(4, [fill], ['ok'])]
	let j = judge([...base, row(4, PS, 'patch', { 'style.fill': '#ffaa00' })], bs, purges)
	assert.deepEqual(j.d, [], 'the patch of the new PS is ok, no "gone" expected')
	j = judge([...base, row(4, PS, 'patch', { 'style.fill': '#000000' })], bs, purges)
	assert.equal(j.d.length, 1, 'a wrong value on the new PS is a deviation, never taken')
	assert.match(j.d[0].problem, /Pfad style\.fill weicht ab/)
	assert.equal(j.d[0].purged, undefined)
	assert.deepEqual(j.accepted, [])
	// the same batch: creation, then a patch of PS (one row per item and rev: the end state)
	j = judge([...rows, row(3, PS, 'put', item('sticky', { style: { fill: '#ffaa00' } }))], [...batches, batch(3, [put(N1, 'sticky'), revive, fill], ['ok', 'ok', 'ok'])], purges)
	assert.deepEqual(j.d, [])
	assert.deepEqual(j.folgen, ['put PS ok'], 'only the creation is judged by "Folgen"')
})
