/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/paths.js against tests/fixtures/paths-golden.json (owned by the
 * backend package, mirrored by lib/Service/PathOps.php) plus the client-only
 * helpers: canon, itemKey, diffPatch (placement group), itemFromPut,
 * isPatchPath. Key order matters on the wire, so results are compared as JSON
 * strings in addition to deepStrictEqual (which ignores key order).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	TOP_FIELDS, PLACEMENT, KEY_RE,
	getPath, setPath, applyPatch, isWireValue, isPatchPath,
	diffPatch, canon, itemKey, itemFromPut,
} from '../../../src/model/paths.js'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/paths-golden.json', import.meta.url), 'utf8'))

const clone = (v) => JSON.parse(JSON.stringify(v))

/** Deterministic PRNG (mulberry32) for the round-trip property tests. */
function prng(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

describe('golden fixture', () => {
	test('has the frozen shape and enough cases', () => {
		assert.deepEqual(Object.keys(golden), ['paths', 'values'])
		assert.ok(golden.paths.length >= 35, 'at least 35 path cases (§9.1)')
		for (const c of golden.paths) {
			assert.deepEqual(Object.keys(c).sort(), ['expect', 'item', 'name', 'path', 'value'], c.name)
		}
		for (const c of golden.values) {
			assert.deepEqual(Object.keys(c).sort(), ['name', 'ok', 'value'], c.name)
			assert.equal(typeof c.ok, 'boolean', c.name)
		}
		const names = golden.paths.map((c) => c.name).concat(golden.values.map((c) => c.name))
		assert.equal(new Set(names).size, names.length, 'case names are unique')
	})
})

describe('setPath (paths-golden)', () => {
	for (const c of golden.paths) {
		test(c.name, () => {
			const item = clone(c.item)
			const value = clone(c.value)
			const ret = setPath(item, c.path, value)
			assert.equal(ret, item, 'returns the same item')
			assert.deepStrictEqual(item, c.expect)
			assert.equal(JSON.stringify(item), JSON.stringify(c.expect), 'key order')
			// The input value is never mutated or stored by reference.
			assert.equal(JSON.stringify(value), JSON.stringify(c.value), 'value untouched')
			if (value !== null && typeof value === 'object') {
				assert.notEqual(getPath(item, c.path), value, 'stored as a copy')
			}
			// What getPath reads back is the value under "empty = absent".
			assert.deepStrictEqual(canon(getPath(item, c.path)), canon(c.value))
		})
	}

	test('applyPatch with one path equals setPath for every case', () => {
		for (const c of golden.paths) {
			const item = applyPatch(clone(c.item), { [c.path]: clone(c.value) })
			assert.equal(JSON.stringify(item), JSON.stringify(c.expect), c.name)
		}
	})

	test('every case is idempotent (patches are safe to repeat, §4.6)', () => {
		for (const c of golden.paths) {
			const item = setPath(setPath(clone(c.item), c.path, clone(c.value)), c.path, clone(c.value))
			assert.equal(JSON.stringify(item), JSON.stringify(c.expect), c.name)
		}
	})

	test('every golden patch value is a wire value', () => {
		for (const c of golden.paths) {
			assert.equal(isWireValue(c.value), true, c.name)
		}
	})
})

describe('isWireValue (paths-golden values)', () => {
	for (const c of golden.values) {
		test(`${c.name} → ${c.ok}`, () => {
			assert.equal(isWireValue(clone(c.value)), c.ok)
		})
	}

	test('JS-only values are rejected', () => {
		assert.equal(isWireValue(undefined), false)
		assert.equal(isWireValue(NaN), false)
		assert.equal(isWireValue(Infinity), false)
		assert.equal(isWireValue(-Infinity), false)
		assert.equal(isWireValue(10n), false)
		assert.equal(isWireValue(() => 1), false)
		assert.equal(isWireValue(Symbol('x')), false)
		assert.equal(isWireValue(new Date(0)), false)
		assert.equal(isWireValue(new Map()), false)
		assert.equal(isWireValue({ a: undefined }), false)
		assert.equal(isWireValue([1, undefined]), false)
		assert.equal(isWireValue({ a: { b: NaN } }), false)
	})

	test('null-prototype objects count as plain objects', () => {
		const o = Object.create(null)
		o.a = 1
		assert.equal(isWireValue(o), true)
	})

	test('depth parameter counts enclosing containers', () => {
		assert.equal(isWireValue([1], 5), true)
		assert.equal(isWireValue([1], 6), false)
		assert.equal(isWireValue({ a: 1 }, 6), false)
		assert.equal(isWireValue('s', 6), true)
	})

	test('limits are checked on the raw value, also for empty containers', () => {
		const deepEmpty = { a: { b: { c: { d: { e: { f: {} } } } } } }
		assert.equal(isWireValue(deepEmpty), false, '{} on level 7')
		const many = {}
		for (let i = 0; i < 101; i++) many['k' + i] = null
		assert.equal(isWireValue(many), false, '101 keys, all null')
		assert.equal(isWireValue({ '9a': null }), false, 'invalid key next to null')
	})

	test('strings are not length-checked here (OpValidator does that)', () => {
		assert.equal(isWireValue('x'.repeat(10000)), true)
	})
})

describe('getPath', () => {
	const item = {
		id: '01JA2B3C4D5E6F7G8H9J0KMNPQ', t: 'sticky', x: 1, y: 2, w: 3, h: 4, r: 0, z: 'i0', parent: null,
		data: { text: 'Hallo', meta: { a: { b: 1 } }, tags: ['x'] }, style: {},
	}

	test('root fields and nested values', () => {
		assert.equal(getPath(item, 'x'), 1)
		assert.equal(getPath(item, 'z'), 'i0')
		assert.equal(getPath(item, 'data.text'), 'Hallo')
		assert.equal(getPath(item, 'data.meta.a.b'), 1)
		assert.deepEqual(getPath(item, 'data.meta'), { a: { b: 1 } })
	})

	test('absent paths are null', () => {
		assert.equal(getPath(item, 'parent'), null)
		assert.equal(getPath(item, 'data.missing'), null)
		assert.equal(getPath(item, 'data.text.length'), null, 'through a string')
		assert.equal(getPath(item, 'data.tags.0'), null, 'through a list')
		assert.equal(getPath(item, 'style.fill'), null)
		assert.equal(getPath(item, 'nope.x'), null)
		assert.equal(getPath({ t: 'sticky' }, 'data.text'), null)
	})

	test('own properties only', () => {
		assert.equal(getPath(item, 'data.constructor'), null)
		assert.equal(getPath(item, 'data.toString'), null)
		assert.equal(getPath(item, 'data.__proto__'), null)
		assert.equal(getPath(item, 'data.meta.hasOwnProperty'), null)
	})
})

describe('setPath beyond the fixture', () => {
	test('a "__proto__" key becomes an own property, never a prototype', () => {
		const item = { data: {} }
		setPath(item, 'data.__proto__', { polluted: true })
		assert.equal(Object.getPrototypeOf(item.data), Object.prototype)
		assert.equal(({}).polluted, undefined)
		assert.deepEqual(Object.keys(item.data), ['__proto__'])
		assert.deepEqual(getPath(item, 'data.__proto__'), { polluted: true })
		setPath(item, 'data.__proto__', null)
		assert.deepEqual(Object.keys(item.data), [])
	})

	test('cleaning keeps a "__proto__" key as an own property', () => {
		const value = JSON.parse('{"__proto__": {"x": 1}, "a": 1}')
		const item = { data: {} }
		setPath(item, 'data.o', value)
		assert.equal(Object.getPrototypeOf(item.data.o), Object.prototype)
		assert.deepEqual(Object.keys(item.data.o), ['__proto__', 'a'])
	})

	test('whole root container keeps the map invariant', () => {
		const item = { data: { text: 'a' } }
		setPath(item, 'data', null)
		assert.deepEqual(item.data, {})
		setPath(item, 'style', { fill: '#ffffff', e: {} })
		assert.deepEqual(item.style, { fill: '#ffffff' })
	})

	test('a root container that is not a map is replaced on set, kept on delete', () => {
		const item = { data: null, style: ['x'] }
		setPath(item, 'data.text', null)
		assert.equal(item.data, null)
		setPath(item, 'data.text', 'hi')
		setPath(item, 'style.fill', '#000000')
		assert.deepEqual(item, { data: { text: 'hi' }, style: { fill: '#000000' } })
	})

	test('root fields are set as given', () => {
		const item = { x: 1, parent: 'P' }
		setPath(item, 'parent', null)
		setPath(item, 'x', 5)
		assert.deepEqual(item, { x: 5, parent: null })
	})

	test('applyPatch applies paths in object order (ancestor, then descendant)', () => {
		const item = { data: {} }
		applyPatch(item, { 'data.start': { item: 'A', side: 'left' }, 'data.start.item': 'B' })
		assert.deepEqual(item.data, { start: { item: 'B', side: 'left' } })
		applyPatch(item, { 'data.start.item': 'C', 'data.start': { side: 'right' } })
		assert.deepEqual(item.data, { start: { side: 'right' } })
	})
})

describe('constants', () => {
	test('TOP_FIELDS, PLACEMENT, KEY_RE', () => {
		assert.deepEqual(TOP_FIELDS, ['t', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style', 'group', 'lock'])
		assert.deepEqual(PLACEMENT, ['x', 'y', 'parent'])
		assert.ok(KEY_RE.test('a'))
		assert.ok(KEY_RE.test('A_b-9'))
		assert.ok(KEY_RE.test('a' + 'b'.repeat(39)))
		assert.ok(!KEY_RE.test('a' + 'b'.repeat(40)))
		for (const bad of ['', '9', '_a', '-a', 'a.b', 'a b', 'ä', '__proto__', '0']) {
			assert.ok(!KEY_RE.test(bad), bad)
		}
	})
})

describe('isPatchPath', () => {
	test('root fields', () => {
		for (const p of ['x', 'y', 'w', 'h', 'r', 'z', 'parent']) assert.equal(isPatchPath(p), true, p)
		for (const p of ['t', 'id', 'data', 'style', 'rotation', '']) assert.equal(isPatchPath(p), false, p)
	})

	test('job 026 (AK5): group is a root path of a patch (its own register); group.<k> and lock are none', () => {
		assert.equal(isPatchPath('group'), true)
		assert.equal(isPatchPath('group.a'), false)
		assert.equal(isPatchPath('lock'), false, 'the lock op is a patch of its own (Replica isLockPatch)')
	})

	test('1-4 keys below data/style, each matching KEY_RE', () => {
		assert.equal(isPatchPath('data.text'), true)
		assert.equal(isPatchPath('style.fill'), true)
		assert.equal(isPatchPath('data.a.b.c.d'), true)
		assert.equal(isPatchPath('data.a.b.c.d.e'), false, '5 keys')
		assert.equal(isPatchPath('data.'), false)
		assert.equal(isPatchPath('data..a'), false)
		assert.equal(isPatchPath('data.0'), false)
		assert.equal(isPatchPath('data.__proto__'), false)
		assert.equal(isPatchPath('meta.a'), false)
		assert.equal(isPatchPath('x.a'), false)
		assert.equal(isPatchPath(null), false)
		assert.equal(isPatchPath(['data', 'text']), false)
	})

	test('every golden path is a patch path', () => {
		for (const c of golden.paths) {
			assert.equal(isPatchPath(c.path), true, c.name)
		}
	})
})

describe('canon and itemKey', () => {
	test('canon sorts keys and drops null and empty objects/lists', () => {
		const v = { b: 1, a: { d: null, c: [], e: {} }, f: [{ z: 1, y: null }, 2], g: null }
		assert.equal(JSON.stringify(canon(v)), '{"b":1,"f":[{"z":1},2]}')
	})

	test('absent values canonicalize to null', () => {
		assert.equal(canon(null), null)
		assert.equal(canon(undefined), null)
		assert.equal(canon({}), null)
		assert.equal(canon([]), null)
		assert.equal(canon({ a: { b: {} } }), null)
		assert.equal(canon(0), 0)
		assert.equal(canon(''), '')
		assert.equal(canon(false), false)
	})

	test('canon does not mutate its input', () => {
		const v = { b: { y: null, x: 1 }, a: [] }
		const before = JSON.stringify(v)
		canon(v)
		assert.equal(JSON.stringify(v), before)
	})

	test('itemKey is independent of key order and of empty containers', () => {
		const a = { id: 'A', t: 'sticky', x: 1, y: 2, w: 3, h: 4, r: 0, z: 'i0', parent: null, data: { text: 'x', o: { b: 2, a: 1 } }, style: {} }
		const b = { style: { e: {} }, data: { o: { a: 1, b: 2 }, text: 'x', gone: null }, parent: null, z: 'i0', r: 0, h: 4, w: 3, y: 2, x: 1, t: 'sticky', id: 'A' }
		assert.equal(itemKey(a), itemKey(b))
		assert.equal(itemKey(a),
			'{"id":"A","t":"sticky","x":1,"y":2,"w":3,"h":4,"r":0,"z":"i0","parent":null,"data":{"o":{"a":1,"b":2},"text":"x"},"style":{},"group":null,"lock":null}')
	})

	test('itemKey sees every real difference', () => {
		const base = { id: 'A', t: 'sticky', x: 1, y: 2, w: 3, h: 4, r: 0, z: 'i0', parent: null, data: { text: 'x' }, style: {} }
		const key = itemKey(base)
		for (const [path, value] of [['x', 2], ['z', 'i1'], ['parent', 'P'], ['data.text', 'y'], ['style.fill', '#000000'], ['t', 'frame'], ['id', 'B']]) {
			const other = clone(base)
			setPath(other, path, value)
			assert.notEqual(itemKey(other), key, path)
		}
		assert.notEqual(itemKey({ ...base, data: {} }), key, 'text removed')
		assert.notEqual(itemKey({ ...base, r: undefined }), key, 'missing field is null, not 0')
	})

	test('M2 data foundation: group and lock count, missing = null, lock goes in as it is', () => {
		const base = { id: 'A', t: 'sticky', x: 1, y: 2, w: 3, h: 4, r: 0, z: 'i0', parent: null, data: { text: 'x' }, style: {} }
		const key = itemKey(base)
		assert.equal(itemKey({ ...base, group: null, lock: null }), key, 'missing group/lock = null')
		assert.notEqual(itemKey({ ...base, group: 'G' }), key, 'group G ≠ null')
		assert.notEqual(itemKey({ ...base, lock: { by: null, name: null } }), key, 'locked (locker unknown) ≠ not locked')
		assert.notEqual(itemKey({ ...base, lock: { by: 'p1', name: 'Alice' } }), itemKey({ ...base, lock: { by: 'p2', name: 'Alice' } }), 'lock.by counts')
		assert.ok(itemKey({ ...base, lock: { by: 'p1', name: 'Alice' } }).endsWith(',"style":{},"group":null,"lock":{"by":"p1","name":"Alice"}}'), 'lock unchanged, after group')
	})
})

describe('diffPatch', () => {
	const before = {
		id: 'A', t: 'sticky', x: 10, y: 20, w: 200, h: 200, r: 0, z: 'i0', parent: null,
		data: { text: 'Hallo', meta: { a: 1, b: 2 } }, style: { fill: '#a8d8f8' },
	}

	test('equal items give {}', () => {
		assert.deepEqual(diffPatch(before, clone(before)), {})
	})

	test('placement group travels together (§4.7 rule 2a)', () => {
		assert.deepEqual(diffPatch(before, { ...clone(before), x: 11 }), { x: 11, y: 20, parent: null })
		assert.deepEqual(diffPatch(before, { ...clone(before), y: 0 }), { x: 10, y: 0, parent: null })
		assert.deepEqual(diffPatch(before, { ...clone(before), parent: 'F' }), { x: 10, y: 20, parent: 'F' })
		const patch = diffPatch({ ...clone(before), parent: 'F' }, { ...clone(before), parent: null })
		assert.deepEqual(patch, { x: 10, y: 20, parent: null })
		assert.deepEqual(diffPatch(before, { ...clone(before), x: 1, w: 5 }), { x: 1, y: 20, parent: null, w: 5 })
	})

	test('w, h, r, z on their own', () => {
		assert.deepEqual(diffPatch(before, { ...clone(before), w: 300 }), { w: 300 })
		assert.deepEqual(diffPatch(before, { ...clone(before), r: 15 }), { r: 15 })
		assert.deepEqual(diffPatch(before, { ...clone(before), z: 'i1' }), { z: 'i1' })
		assert.deepEqual(diffPatch(before, { ...clone(before), z: undefined }), {}, 'z is never deleted')
	})

	test('type is never patched', () => {
		assert.deepEqual(diffPatch(before, { ...clone(before), t: 'frame' }), {})
	})

	test('job 026 (AK5): group when it differs (missing = null), alone or beside other paths', () => {
		assert.deepEqual(diffPatch(before, { ...clone(before), group: 'G' }), { group: 'G' })
		assert.deepEqual(diffPatch({ ...clone(before), group: 'G' }, clone(before)), { group: null })
		assert.deepEqual(diffPatch({ ...clone(before), group: 'G' }, { ...clone(before), group: 'H', w: 300 }), { w: 300, group: 'H' })
		assert.deepEqual(diffPatch({ ...clone(before), group: null }, clone(before)), {}, 'null = missing')
		assert.deepEqual(diffPatch({ ...clone(before), group: 'G' }, { ...clone(before), group: 'G' }), {})
	})

	test('data/style per key on level 1 with whole values', () => {
		const after = clone(before)
		after.data.meta.b = 3
		after.data.tag = 'idea'
		delete after.style.fill
		assert.deepEqual(diffPatch(before, after), {
			'data.meta': { a: 1, b: 3 },
			'data.tag': 'idea',
			'style.fill': null,
		})
	})

	test('empty = absent, and key order inside values does not count', () => {
		const after = clone(before)
		after.data.meta = { b: 2, a: 1 }
		after.data.empty = {}
		after.data.none = null
		after.style.list = []
		assert.deepEqual(diffPatch(before, after), {})
		const removed = clone(before)
		removed.data.meta = {}
		assert.deepEqual(diffPatch(before, removed), { 'data.meta': null })
	})

	test('patch values are cleaned copies', () => {
		const after = clone(before)
		after.data.o = { a: null, b: { c: 1 } }
		const patch = diffPatch(before, after)
		assert.deepEqual(patch, { 'data.o': { b: { c: 1 } } })
		patch['data.o'].b.c = 2
		assert.equal(after.data.o.b.c, 1)
	})

	test('missing fields are treated like the server defaults', () => {
		assert.deepEqual(diffPatch({ t: 'sticky' }, { t: 'sticky', x: 0, y: 0, parent: null, data: {}, style: {} }), {})
	})

	test('round trip: applying diffPatch(a, b) to a gives b (seeded random items)', () => {
		const rnd = prng(41)
		const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
		const vals = [null, {}, [], 'a', 'b', 0, 1, 2.5, true, false, ['x', 1], { k: 1 }, { k: { j: 2 } }, { k: null }]
		const keys = ['text', 'title', 'fill', 'tag', 'meta']
		const randomItem = () => {
			const it = {
				id: 'A', t: 'sticky', x: pick([0, 10, -5.5]), y: pick([0, 20]), w: pick([200, 300]), h: 200,
				r: pick([0, 15]), z: pick(['i0', 'i1', 'hz']), parent: pick([null, 'F', 'G']), data: {}, style: {},
			}
			for (const k of keys) if (rnd() < 0.5) it.data[k] = clone(pick(vals))
			for (const k of keys) if (rnd() < 0.3) it.style[k] = clone(pick(vals))
			return it
		}
		for (let i = 0; i < 500; i++) {
			const a = randomItem()
			const b = randomItem()
			const patch = diffPatch(a, b)
			for (const path of Object.keys(patch)) {
				assert.ok(isPatchPath(path), path)
				assert.ok(isWireValue(patch[path]), path)
			}
			const has = PLACEMENT.filter((k) => k in patch)
			assert.ok(has.length === 0 || has.length === 3, 'placement group')
			const result = applyPatch(clone(a), patch)
			assert.equal(itemKey(result), itemKey(b), `round ${i}`)
			assert.deepEqual(diffPatch(result, b), {}, `fixpoint ${i}`)
		}
	})
})

describe('itemFromPut', () => {
	test('applies the server defaults of §4.6', () => {
		const item = itemFromPut({ o: 'put', id: '01JA2B3C4D5E6F7G8H9J0KMNPQ', t: 'sticky', p: { z: 'i1' } })
		assert.equal(JSON.stringify(item),
			'{"id":"01JA2B3C4D5E6F7G8H9J0KMNPQ","t":"sticky","x":0,"y":0,"w":0,"h":0,"r":0,"z":"i1","parent":null,"data":{},"style":{},"group":null,"lock":null}')
	})

	test('keeps given values, cleans data/style and shares nothing with the op', () => {
		const op = {
			o: 'put', id: 'B', t: 'frame',
			p: { x: 100, y: 40, w: 800, h: 600, r: 0, z: 'hz', parent: null, data: { title: 'T', e: {}, n: null }, style: { fill: '#ffffff' } },
		}
		const item = itemFromPut(op)
		assert.deepEqual(item, {
			id: 'B', t: 'frame', x: 100, y: 40, w: 800, h: 600, r: 0, z: 'hz', parent: null,
			data: { title: 'T' }, style: { fill: '#ffffff' }, group: null, lock: null,
		})
		assert.deepEqual(Object.keys(item), ['id', ...TOP_FIELDS])
		item.style.fill = '#000000'
		assert.equal(op.p.style.fill, '#ffffff')
	})

	test('missing z stays visible as null; empty data/style become {}', () => {
		const item = itemFromPut({ o: 'put', id: 'C', t: 'sticky', p: { data: { a: {} }, style: [] } })
		assert.equal(item.z, null)
		assert.deepEqual(item.data, {})
		assert.deepEqual(item.style, {})
		assert.deepEqual(itemFromPut({ o: 'put', id: 'D', t: 'sticky' }).data, {})
	})

	test('M2 data foundation (followed up by job 026): lock is null also when the op names it; group comes from p.group as a string, else null', () => {
		const item = itemFromPut({ o: 'put', id: 'G', t: 'sticky', p: { z: 'i0', group: 'G1', lock: { by: 'x', name: 'y' } } })
		assert.deepEqual([item.group, item.lock], ['G1', null], 'a put never sets the lock (the server answers bad); the group is taken')
		assert.deepEqual(Object.keys(item), ['id', ...TOP_FIELDS])
	})

	test('job 026 (AK5): itemFromPut takes p.group when it is a string, otherwise null', () => {
		const g = '01JA2B3C4D5E6F7G8H9J0KMNPQ'
		assert.equal(itemFromPut({ o: 'put', id: 'A', t: 'sticky', p: { z: 'i0', group: g } }).group, g)
		for (const v of [undefined, null, 5, true, {}, [], ['x']]) {
			assert.equal(itemFromPut({ o: 'put', id: 'A', t: 'sticky', p: { z: 'i0', group: v } }).group, null, JSON.stringify(v))
		}
	})

	test('an item from a put equals the put applied as patches', () => {
		const op = { o: 'put', id: 'E', t: 'sticky', p: { x: 5, y: 6, w: 200, h: 200, r: 0, z: 'i0', parent: 'F', data: { text: 'Hi' }, style: { fill: '#a8d8f8' } } }
		const empty = itemFromPut({ o: 'put', id: 'E', t: 'sticky', p: {} })
		const patched = applyPatch(empty, diffPatch(empty, itemFromPut(op)))
		assert.equal(itemKey(patched), itemKey(itemFromPut(op)))
	})
})
