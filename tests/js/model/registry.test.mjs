/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/registry.js v2 (SPEC-M1 §4.8, §6.2, §3.10) and src/model/tokens.js:
 * - types, enums and the typed field checks against tests/fixtures/registry-golden.json
 *   (owned by [B]; the PHP ItemRegistryTest reads the same file)
 * - the client-only keys of §6.2 (defaults, hit, pad, resize, keepRatio, editor)
 * - fieldDefault against the §3.10 table, fieldValue with rule 18
 * - unknown types as placeholder (own keys only), container rules, text paths,
 *   frozen tables, and the token values the spec fixes
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	TYPES, PLACEHOLDER, ENUMS, isKnownType, typeInfo, layerRank, canBeChildOf, textPathOf, allTextPaths,
	isBindable, isVotable, fieldRule, checkField, checkRule, fieldDefault, fieldValue,
} from '../../../src/model/registry.js'
import * as tokens from '../../../src/model/tokens.js'
import { isPatchPath, isWireValue, KEY_RE } from '../../../src/model/paths.js'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/registry-golden.json', import.meta.url), 'utf8'))

/** The keys of a type the golden file pins (§9.2 golden format). */
const GOLDEN_KEYS = ['layer', 'container', 'childOf', 'rotatable', 'size', 'textPath', 'bindable', 'votable', 'placement', 'required', 'fields']

/**
 * @param {unknown} v JSON value
 * @return {string} short label for messages
 */
const show = (v) => {
	const s = String(JSON.stringify(v))
	return s.length > 70 ? s.slice(0, 67) + '…' : s
}

describe('registry v2 against registry-golden.json', () => {
	test('the golden file has the frozen format and ≥ 60 values covering every rule kind', () => {
		assert.deepEqual(Object.keys(golden).sort(), ['enums', 'types', 'values'])
		assert.ok(golden.values.length >= 60, String(golden.values.length))
		const kinds = new Set()
		for (const v of golden.values) {
			assert.deepEqual(Object.keys(v).sort(), ['norm', 'ok', 'path', 'type', 'value'])
			kinds.add(golden.types[v.type].fields[v.path][0])
			if (!v.ok) assert.equal(v.norm, null)
		}
		assert.deepEqual([...kinds].sort(), ['color', 'endpoint', 'enum', 'int', 'text'])
	})

	test('known types are exactly the five golden types, in golden order', () => {
		assert.deepEqual(Object.keys(TYPES), Object.keys(golden.types))
		assert.deepEqual(Object.keys(TYPES), ['sticky', 'frame', 'shape', 'text', 'connector'])
		for (const t of Object.keys(TYPES)) assert.equal(isKnownType(t), true, t)
	})

	for (const t of Object.keys(golden.types)) {
		test(`type rules of ${t} equal the golden (layer … fields)`, () => {
			const info = TYPES[t]
			const mine = Object.fromEntries(GOLDEN_KEYS.map((k) => [k, k === 'required' ? (info.required ?? []) : info[k]]))
			assert.deepStrictEqual(mine, golden.types[t])
		})
	}

	test('enums equal the golden (= PHP constants)', () => {
		assert.deepStrictEqual(ENUMS, golden.enums)
		assert.deepEqual(Object.keys(ENUMS), ['shapeKinds', 'dashes', 'aligns', 'valigns', 'routes', 'caps'])
	})

	test('checkField: every golden value gives exactly {ok, norm}', () => {
		const failures = []
		golden.values.forEach((c, i) => {
			const got = checkField(c.type, c.path, c.value)
			try {
				assert.deepStrictEqual(got, { ok: c.ok, norm: c.norm })
			} catch {
				failures.push(`#${i} ${c.type} ${c.path} ${show(c.value)}: want ${show({ ok: c.ok, norm: c.norm })}, got ${show(got)}`)
			}
		})
		assert.deepEqual(failures, [])
	})

	test('checkField of each golden value equals checkRule(fieldRule(…)) and fieldRule = golden rule', () => {
		for (const c of golden.values) {
			assert.deepStrictEqual(fieldRule(c.type, c.path), golden.types[c.type].fields[c.path])
			assert.deepStrictEqual(checkField(c.type, c.path, c.value), checkRule(fieldRule(c.type, c.path), c.value))
		}
	})
})

describe('registry v2: client keys and helpers (§6.2)', () => {
	test('client-only keys of every type are as in §6.2', () => {
		const pick = (info) => ({
			defaults: info.defaults, hit: info.hit, pad: info.pad, resize: info.resize, keepRatio: info.keepRatio, editor: info.editor,
		})
		assert.deepEqual(pick(TYPES.sticky), {
			defaults: { w: 200, h: 200, data: { text: '' }, style: { fill: tokens.DEFAULT_STICKY_FILL } },
			hit: 'box', pad: 'shadow', resize: 'box', keepRatio: true, editor: 'note',
		})
		assert.deepEqual(pick(TYPES.frame), {
			defaults: { w: 800, h: 600, data: { title: '' }, style: { fill: '#ffffff' } },
			hit: 'frameEdge', pad: 'title', resize: 'box', keepRatio: false, editor: 'title',
		})
		assert.deepEqual(pick(TYPES.shape), {
			defaults: { w: 200, h: 120, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 } },
			hit: 'shape', pad: 'stroke', resize: 'box', keepRatio: false, editor: 'shape',
		})
		assert.deepEqual(pick(TYPES.text), {
			defaults: { w: 240, h: 31, data: { text: '' }, style: { fontSize: 24, color: '#1a1a1a', align: 'left' } },
			hit: 'box', pad: 'none', resize: 'text', keepRatio: false, editor: 'text',
		})
		assert.deepEqual(pick(TYPES.connector), {
			defaults: { w: 0, h: 0, data: { route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' } },
			hit: 'line', pad: 'line', resize: 'none', keepRatio: false, editor: 'label',
		})
	})

	test('PLACEHOLDER = the server GENERIC plus client keys', () => {
		assert.deepEqual(PLACEHOLDER, {
			layer: 'content', container: false, childOf: [], rotatable: true, size: [0, 1000000], hit: 'box', textPath: null,
			pad: 'none', bindable: false, votable: false, placement: 'box', resize: 'none', keepRatio: false, editor: null,
			required: [], fields: {},
		})
	})

	test('unknown types fall back to PLACEHOLDER, inherited names included (M0 tripwire: pen, not shape)', () => {
		for (const t of ['pen', 'image', 'Sticky', 'Shape', '', undefined, null, 1, 'constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
			assert.equal(isKnownType(t), false, String(t))
			assert.equal(typeInfo(t), PLACEHOLDER, String(t))
		}
		for (const t of Object.keys(TYPES)) assert.equal(typeInfo(t), TYPES[t])
	})

	test('layerRank: frames behind content, unknown types are content', () => {
		assert.equal(layerRank('frame'), 0)
		for (const t of ['sticky', 'shape', 'text', 'connector', 'mystery', 'constructor']) assert.equal(layerRank(t), 1, t)
	})

	test('canBeChildOf follows container + childOf', () => {
		for (const t of ['sticky', 'shape', 'text']) assert.equal(canBeChildOf(t, 'frame'), true, t)
		assert.equal(canBeChildOf('connector', 'frame'), false, 'connectors are never children')
		assert.equal(canBeChildOf('frame', 'frame'), false, 'containers have no parents')
		assert.equal(canBeChildOf('sticky', 'shape'), false, 'a shape is no container')
		assert.equal(canBeChildOf('sticky', 'sticky'), false)
		assert.equal(canBeChildOf('mystery', 'frame'), false, 'unknown types only at the root')
		assert.equal(canBeChildOf('sticky', 'mystery'), false)
		assert.equal(canBeChildOf('sticky', 'constructor'), false)
		assert.equal(canBeChildOf('sticky', undefined), false)
	})

	test('text paths: textPathOf and allTextPaths (data.label is new)', () => {
		assert.equal(textPathOf('sticky'), 'data.text')
		assert.equal(textPathOf('frame'), 'data.title')
		assert.equal(textPathOf('shape'), 'data.text')
		assert.equal(textPathOf('text'), 'data.text')
		assert.equal(textPathOf('connector'), 'data.label')
		assert.equal(textPathOf('mystery'), null)
		assert.equal(textPathOf('constructor'), null)
		assert.deepEqual(allTextPaths(), ['data.text', 'data.title', 'data.label'])
	})

	test('isBindable / isVotable', () => {
		const expect = { sticky: [true, true], frame: [false, false], shape: [true, true], text: [true, true], connector: [false, false] }
		for (const [t, [b, v]] of Object.entries(expect)) {
			assert.equal(isBindable(t), b, t)
			assert.equal(isVotable(t), v, t)
		}
		for (const t of ['pen', 'constructor', null]) {
			assert.equal(isBindable(t), false)
			assert.equal(isVotable(t), false)
		}
	})

	test('fieldRule: typed rule or null', () => {
		assert.deepEqual(fieldRule('shape', 'data.kind'), ['enum', ENUMS.shapeKinds])
		assert.deepEqual(fieldRule('connector', 'data.start'), ['endpoint'])
		assert.equal(fieldRule('sticky', 'style.stroke'), null)
		assert.equal(fieldRule('connector', 'data.waypoints'), null, 'reserved, generic in M1')
		assert.equal(fieldRule('pen', 'data.points'), null)
		assert.equal(fieldRule('shape', 'constructor'), null)
		assert.equal(fieldRule('shape', undefined), null)
	})
})

describe('checkField beyond the golden', () => {
	const ok = (norm) => ({ ok: true, norm })
	const BAD = { ok: false, norm: null }

	test('empty values are not ok under a rule (empty = absent is the caller’s business, as on the server)', () => {
		for (const [t, path] of [['sticky', 'data.text'], ['shape', 'style.fill'], ['shape', 'style.strokeWidth'], ['shape', 'data.kind'], ['connector', 'data.start']]) {
			for (const v of [null, undefined, {}, []]) assert.deepStrictEqual(checkField(t, path, v), BAD, `${t} ${path} ${show(v)}`)
		}
	})

	test('a path below a typed field is never ok (a typed leaf is never a map, rule 14)', () => {
		assert.deepStrictEqual(checkField('connector', 'data.start.item', '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'), BAD)
		assert.deepStrictEqual(checkField('connector', 'data.end.ax', 0.5), BAD)
		assert.deepStrictEqual(checkField('sticky', 'data.text.x', 'a'), BAD)
	})

	test('a path without a rule is only checked generically: ok, value unchanged', () => {
		const v = { a: [1, 2] }
		assert.deepStrictEqual(checkField('sticky', 'data.extra', v), ok(v))
		assert.deepStrictEqual(checkField('connector', 'data.waypoints', [[1, 2]]), ok([[1, 2]]))
		assert.deepStrictEqual(checkField('pen', 'data.points', 5), ok(5))
	})

	test('text: lone surrogates are invalid (the server cannot decode them), pairs count as one code point', () => {
		assert.deepStrictEqual(checkField('connector', 'data.label', 'a\uD800b'), BAD)
		assert.deepStrictEqual(checkField('connector', 'data.label', 'a\uDC00'), BAD)
		assert.deepStrictEqual(checkField('connector', 'data.label', '\uD83D'), BAD)
		assert.deepStrictEqual(checkField('connector', 'data.label', '😀'.repeat(200)), ok('😀'.repeat(200)))
		assert.deepStrictEqual(checkField('connector', 'data.label', 'x\u007f\u0085 '), ok('x\u007f\u0085 '), 'only C0 controls go')
		assert.deepStrictEqual(checkField('sticky', 'data.text', '\r\n\r'), ok('\n'))
		assert.deepStrictEqual(checkField('sticky', 'data.text', ''), ok(''), 'the empty string is a value')
	})

	test('int: whole numbers only, -0 becomes +0, NaN and Infinity are not ok', () => {
		const r = checkField('shape', 'style.strokeWidth', -0)
		assert.equal(r.ok, true)
		assert.ok(Object.is(r.norm, 0), 'norm is +0')
		for (const v of [NaN, Infinity, -Infinity, 1e300, 2.5, '2', true, 2n]) {
			assert.deepStrictEqual(checkField('shape', 'style.strokeWidth', v), BAD, String(v))
		}
		assert.deepStrictEqual(checkField('text', 'style.fontSize', 12.0), ok(12))
	})

	test('endpoint: NaN/Infinity and non-plain values are not ok; ax/ay on the 1e-4 grid, never -0', () => {
		const U = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'
		for (const v of [{ item: U, ax: NaN, ay: 0.5 }, { item: U, ax: 0.5, ay: Infinity }, { x: -Infinity, y: 0 }, { x: 0, y: NaN },
			{ item: U, ax: undefined, ay: 0.5 }, new Map([['item', U]]), [U], U]) {
			assert.deepStrictEqual(checkField('connector', 'data.start', v), BAD, show(v))
		}
		const r = checkField('connector', 'data.end', { item: U, ax: -0, ay: 0.123456 })
		assert.deepStrictEqual(r, ok({ item: U, ax: 0, ay: 0.1235 }))
		assert.ok(Object.is(r.norm.ax, 0))
		const f = checkField('connector', 'data.end', { x: -0, y: -0 })
		assert.ok(Object.is(f.norm.x, 0) && Object.is(f.norm.y, 0), 'a free end is never -0')
	})

	test('checkRule: a rule without a checker rejects every value (reserved kinds of M1)', () => {
		for (const rule of [['points', 100], ['bool'], ['number'], ['nope'], [], null]) {
			for (const v of [1, true, 'a', [[1, 2]]]) assert.deepStrictEqual(checkRule(rule, v), BAD, show(rule))
		}
	})

	test('the returned objects are fresh (callers may keep them)', () => {
		const a = checkField('shape', 'style.fill', 'red')
		const b = checkField('shape', 'style.fill', 'red')
		assert.notEqual(a, b)
	})
})

describe('fieldDefault (§3.10 table) and fieldValue (rule 18)', () => {
	test('every entry of the §3.10 table', () => {
		const table = {
			shape: {
				'data.kind': 'rect', 'data.text': '', 'style.fill': '#ffffff', 'style.fillOpacity': 100, 'style.stroke': '#1a1a1a',
				'style.strokeWidth': 2, 'style.dash': 'solid', 'style.textColor': '#1a1a1a', 'style.fontSize': null,
				'style.align': 'center', 'style.valign': 'middle',
			},
			text: { 'data.text': '', 'style.fontSize': 24, 'style.color': '#1a1a1a', 'style.align': 'left' },
			connector: {
				'data.route': 'straight', 'data.label': null, 'style.stroke': '#1a1a1a', 'style.strokeWidth': 2, 'style.dash': 'solid',
				'style.startCap': 'none', 'style.endCap': 'none',
			},
			// "wie M0": the fallbacks of the M0 nodes (fillOf, str, noteFontSize: auto-fit)
			sticky: { 'data.text': '', 'style.fill': tokens.DEFAULT_STICKY_FILL, 'style.fontSize': null },
			frame: { 'data.title': '', 'style.fill': tokens.FRAME_FILL },
		}
		for (const [t, rows] of Object.entries(table)) {
			for (const [path, want] of Object.entries(rows)) assert.equal(fieldDefault(t, path), want, `${t} ${path}`)
		}
	})

	test('every display default passes its own field rule (null = computed or nothing)', () => {
		for (const t of Object.keys(TYPES)) {
			for (const path of Object.keys(TYPES[t].fields)) {
				const d = fieldDefault(t, path)
				if (d === undefined || d === null) continue
				assert.equal(checkField(t, path, d).ok, true, `${t} ${path}`)
			}
		}
	})

	test('the connector end cap default differs from its create default (arrow is stored on create)', () => {
		assert.equal(fieldDefault('connector', 'style.endCap'), 'none')
		assert.equal(TYPES.connector.defaults.style.endCap, 'arrow')
	})

	test('undefined for unknown types, untyped paths and the required ends', () => {
		assert.equal(fieldDefault('pen', 'style.stroke'), undefined)
		assert.equal(fieldDefault('constructor', 'data.text'), undefined)
		assert.equal(fieldDefault('shape', 'style.shadow'), undefined)
		assert.equal(fieldDefault('shape', 'constructor'), undefined)
		assert.equal(fieldDefault('connector', 'data.start'), undefined)
		assert.equal(fieldDefault('connector', 'data.end'), undefined)
	})

	test('fieldValue: stored value, else the default; an unknown stored enum value counts as missing (rule 18)', () => {
		const shape = { t: 'shape', data: { kind: 'hexagon', text: 'Hi' }, style: { dash: 'dashdot', fill: '#ABCDEF', strokeWidth: 0, align: 'right' } }
		assert.equal(fieldValue(shape, 'data.kind'), 'rect', 'a later shape kind is drawn as rect')
		assert.equal(fieldValue(shape, 'style.dash'), 'solid')
		assert.equal(fieldValue(shape, 'style.align'), 'right')
		assert.equal(fieldValue(shape, 'style.fill'), '#abcdef')
		assert.equal(fieldValue(shape, 'style.strokeWidth'), 0, '0 is a value (no border), not missing')
		assert.equal(fieldValue(shape, 'style.valign'), 'middle')
		assert.equal(fieldValue(shape, 'style.fontSize'), null, 'auto-fit')
		assert.equal(fieldValue(shape, 'data.text'), 'Hi')
		const conn = { t: 'connector', data: { route: 'zigzag', start: { x: 1, y: 2 }, end: {} }, style: { startCap: 'star', endCap: 'arrow' } }
		assert.equal(fieldValue(conn, 'data.route'), 'straight')
		assert.equal(fieldValue(conn, 'style.startCap'), 'none', 'an unknown cap is drawn as none')
		assert.equal(fieldValue(conn, 'style.endCap'), 'arrow')
		assert.equal(fieldValue(conn, 'data.label'), null)
		assert.deepEqual(fieldValue(conn, 'data.start'), { x: 1, y: 2 })
		assert.equal(fieldValue(conn, 'data.end'), undefined, 'empty = absent, no display default')
		assert.equal(fieldValue({ t: 'sticky', data: { text: 5 }, style: { fill: 'red', fontSize: 300 } }, 'style.fill'), tokens.DEFAULT_STICKY_FILL)
		assert.equal(fieldValue({ t: 'sticky', data: { text: 5 }, style: { fontSize: 300 } }, 'style.fontSize'), null)
		assert.equal(fieldValue({ t: 'sticky', data: { text: 5 }, style: {} }, 'data.text'), '')
		assert.deepEqual(fieldValue({ t: 'pen', data: { points: [[1, 2]] } }, 'data.points'), [[1, 2]], 'untyped fields as stored')
		assert.equal(fieldValue({ t: 'pen', data: {} }, 'style.stroke'), undefined)
	})
})

describe('registry v2: defaults and tables', () => {
	test('defaults and text paths are valid on the wire and pass the field rules', () => {
		for (const [name, info] of Object.entries(TYPES)) {
			assert.ok(isPatchPath(info.textPath), name)
			for (const root of ['data', 'style']) {
				for (const k of Object.keys(info.defaults[root])) assert.match(k, KEY_RE)
				assert.ok(isWireValue(info.defaults[root]), name + '.' + root)
				for (const [k, v] of Object.entries(info.defaults[root])) {
					assert.deepStrictEqual(checkField(name, `${root}.${k}`, v), { ok: true, norm: v }, `${name} ${root}.${k}`)
				}
			}
			const [min, max] = info.size
			assert.ok(min <= info.defaults.w && info.defaults.w <= max, name + ' w')
			assert.ok(min <= info.defaults.h && info.defaults.h <= max, name + ' h')
		}
	})

	test('placement none (connector): size [0, 0], not rotatable, no parent, required ends without defaults', () => {
		const c = TYPES.connector
		assert.deepEqual([c.size, c.rotatable, c.childOf, c.placement], [[0, 0], false, [], 'none'])
		for (const path of c.required) {
			assert.equal(fieldRule('connector', path)[0], 'endpoint')
			const [root, key] = path.split('.')
			assert.equal(Object.prototype.hasOwnProperty.call(c.defaults[root], key), false, path)
		}
	})

	test('tables are frozen (clone defaults before use)', () => {
		assert.throws(() => { TYPES.sticky.defaults.w = 1 }, TypeError)
		assert.throws(() => { TYPES.sticky.defaults.style.fill = '#000000' }, TypeError)
		assert.throws(() => { TYPES.frame.childOf.push('x') }, TypeError)
		assert.throws(() => { TYPES.pen = {} }, TypeError)
		assert.throws(() => { TYPES.shape.fields['data.kind'][1].push('hexagon') }, TypeError)
		assert.throws(() => { ENUMS.caps.push('star') }, TypeError)
		assert.throws(() => { PLACEHOLDER.container = true }, TypeError)
		assert.throws(() => { TYPES.connector.required.pop() }, TypeError)
		const copy = structuredClone(TYPES.sticky.defaults)
		copy.data.text = 'x'
		assert.equal(TYPES.sticky.defaults.data.text, '')
	})
})

describe('tokens', () => {
	test('sticky palette: 14 distinct lowercase colors, default not yellow', () => {
		assert.equal(tokens.STICKY_COLORS.length, 14)
		assert.equal(new Set(tokens.STICKY_COLORS).size, 14)
		for (const c of tokens.STICKY_COLORS) assert.match(c, /^#[0-9a-f]{6}$/)
		assert.equal(tokens.DEFAULT_STICKY_FILL, '#a8d8f8')
		assert.ok(tokens.STICKY_COLORS.includes(tokens.DEFAULT_STICKY_FILL))
	})

	test('scales fixed by the spec', () => {
		assert.equal(tokens.MIN_SCALE, 0.05)
		assert.equal(tokens.MAX_SCALE, 4)
		assert.equal(tokens.LOD_TEXT_SCALE, 0.3)
		assert.equal(tokens.LOD_COARSE_SCALE, 0.1)
		assert.equal(tokens.LOD2_ENTER, 0.095)
		assert.equal(tokens.LOD2_LEAVE, 0.105)
		assert.equal(tokens.TEXT_MIN_PX, 6)
	})

	test('transformer and keyboard constants fixed by SPEC-M1 §6.2', () => {
		assert.deepEqual(
			[tokens.HANDLE_PX, tokens.HANDLE_TOUCH_PX, tokens.ROT_HANDLE_OFFSET_PX, tokens.SNAP_PX, tokens.TRANSFORM_LIVE_MAX, tokens.NUDGE, tokens.NUDGE_BIG],
			[8, 22, 28, 16, 50, 1, 10])
	})

	test('(M2, R12) snapping to objects: 8 px per axis, a 1-px dashed magenta guide; SNAP_PX of the connector ends stays 16', () => {
		assert.equal(tokens.OBJECT_SNAP_PX, 8)
		assert.equal(tokens.SNAP_GUIDE_STROKE_PX, 1)
		assert.equal(tokens.SNAP_GUIDE_COLOR, '#e0218a')
		assert.match(tokens.SNAP_GUIDE_COLOR, /^#[0-9a-f]{6}$/)
		assert.notEqual(tokens.SNAP_GUIDE_COLOR, tokens.SELECTION_COLOR)
		// dashed: 4 px dash, 4 px gap (screen px), frozen like MULTI_FRAME_DASH
		assert.deepEqual([...tokens.SNAP_GUIDE_DASH], [4, 4])
		assert.ok(Object.isFrozen(tokens.SNAP_GUIDE_DASH))
		assert.equal(tokens.SNAP_GUIDE_DASH.length % 2, 0)
		for (const d of tokens.SNAP_GUIDE_DASH) assert.ok(Number.isFinite(d) && d > 0, `dash entry ${d}`)
		assert.equal(tokens.SNAP_PX, 16)
	})

	test('(M2, R12) equal gaps: cross ticks of 8 px at both ends of a marker; threshold, guide color, width and dash unchanged', () => {
		assert.equal(tokens.GAP_MARKER_TICK_PX, 8)
		assert.equal(tokens.OBJECT_SNAP_PX, 8)
		assert.equal(tokens.SNAP_GUIDE_COLOR, '#e0218a')
		assert.equal(tokens.SNAP_GUIDE_STROKE_PX, 1)
		assert.deepEqual([...tokens.SNAP_GUIDE_DASH], [4, 4])
		assert.equal(tokens.SNAP_PX, 16)
	})

	test('frame title band = FRAME_TITLE_SIZE * 1.5, edge band 8 px', () => {
		assert.equal(tokens.FRAME_TITLE_BAND, tokens.FRAME_TITLE_SIZE * 1.5)
		assert.equal(tokens.FRAME_EDGE_HIT_PX, 8)
		assert.equal(tokens.FRAME_FILL, TYPES.frame.defaults.style.fill)
	})

	test('font steps ascend; text and layout constants are present', () => {
		for (let i = 1; i < tokens.FONT_STEPS.length; i++) {
			assert.ok(tokens.FONT_STEPS[i - 1] < tokens.FONT_STEPS[i])
		}
		for (const k of ['FONT_FAMILY', 'LINE_HEIGHT', 'STICKY_PADDING', 'STICKY_RADIUS', 'SHADOW', 'BOARD_BACKGROUND',
			'TEXT_COLOR', 'FRAME_STROKE', 'FRAME_TITLE_COLOR', 'PLACEHOLDER_STROKE']) {
			assert.ok(tokens[k] !== undefined, k)
		}
	})

	test('shared arrays and objects are frozen', () => {
		assert.ok(Object.isFrozen(tokens.STICKY_COLORS))
		assert.ok(Object.isFrozen(tokens.FONT_STEPS))
		assert.ok(Object.isFrozen(tokens.SHADOW))
		assert.ok(Object.isFrozen(tokens.PLACEHOLDER_DASH))
	})
})
