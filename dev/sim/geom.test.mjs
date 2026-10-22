/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the harness's connector geometry (lib/geom.mjs) against the
 * frozen golden files of SPEC-M1 §9.2 – no stack needed. The harness keeps
 * its own copy of q/anchorPoint/endpoint (it is the oracle of C55, C56 and
 * the convergence run); this test makes sure the copy says what the frozen
 * contract says, including the (R7) rule "never -0". Run:
 *   node --test 'dev/sim/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { q, anchorPoint, endpointOf, endpointKind, endsEqual } from './lib/geom.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const golden = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures', f), 'utf8'))

test('q: half boundaries of §4.7 / §8.2 (R2) and never -0 (R7)', () => {
	const table = [
		[51.945, 100, 51.95], [-0.005, 100, -0.01], [0, 100, 0], [1.005, 100, 1], [2.675, 100, 2.68],
		[-2.675, 100, -2.68], [0.123456, 10000, 0.1235], [0.99995, 10000, 1], [0.00015, 10000, 0.0001],
	]
	for (const [v, k, want] of table) assert.equal(q(v, k), want, `q(${v}, ${k})`)
	for (const v of [-0.001, -0.004, -0.0049999, -0, -1e-9]) {
		const r = q(v, 100)
		assert.ok(Object.is(r, 0), `q(${v}, 100) is +0, got ${Object.is(r, -0) ? '-0' : r}`)
	}
	assert.equal(JSON.stringify(q(-0.001, 100)), '0')
})

test('anchorPoint = every case of connector-golden.json (box relative to parent, R8)', () => {
	const g = golden('connector-golden.json')
	assert.ok(g.cases.length >= 20, `${g.cases.length} cases`)
	for (const c of g.cases) {
		const got = anchorPoint(c.box, c.parent, c.ep)
		assert.deepEqual(got, c.expect, c.name)
		for (const v of got) assert.ok(!Object.is(v, -0), `${c.name}: no -0`)
	}
})

test('endpointOf = every endpoint value of registry-golden.json (form, ULID, range before q, key order, -0)', () => {
	const g = golden('registry-golden.json')
	const eps = g.values.filter((v) => v.type === 'connector' && (v.path === 'data.start' || v.path === 'data.end'))
	assert.ok(eps.length >= 20, `${eps.length} endpoint values`)
	for (const v of eps) {
		const got = endpointOf(v.value)
		const label = `${v.path} ${JSON.stringify(v.value)}`
		if (!v.ok) {
			assert.equal(got, null, label)
			continue
		}
		assert.deepEqual(got, v.norm, label)
		assert.equal(JSON.stringify(got), JSON.stringify(v.norm), `${label}: key order`)
		for (const x of Object.values(got)) assert.ok(!Object.is(x, -0), `${label}: no -0`)
	}
	assert.deepEqual(endpointOf({ x: -0, y: -0 }), { x: 0, y: 0 })
	assert.ok(Object.is(endpointOf({ x: -0, y: 1 }).x, 0))
})

test('endpointKind and endsEqual (exact unrotated, ±0.01 rotated)', () => {
	assert.equal(endpointKind({ item: 'X' }), 'auto')
	assert.equal(endpointKind({ item: 'X', ax: 0, ay: 1 }), 'anchor')
	assert.equal(endpointKind({ x: 1, y: 2 }), 'free')
	assert.equal(endpointKind(null), null)
	assert.ok(endsEqual({ x: 1.25, y: -3 }, { x: 1.25, y: -3 }, false))
	assert.ok(!endsEqual({ x: 1.26, y: -3 }, { x: 1.25, y: -3 }, false))
	assert.ok(endsEqual({ x: 1.26, y: -3 }, { x: 1.25, y: -3 }, true))
	assert.ok(!endsEqual({ x: 1.27, y: -3 }, { x: 1.25, y: -3 }, true))
	assert.ok(!endsEqual({ y: -3, x: 1.25 }, { x: 1.25, y: -3 }, false), 'key order x, y')
	assert.ok(!endsEqual({ x: -0, y: 0 }, { x: 0, y: 0 }, false), '-0 is a deviation')
	assert.ok(!endsEqual({ item: 'X' }, { x: 0, y: 0 }, false))
})
