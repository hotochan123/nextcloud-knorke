/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 201 (shapes panel), the new shape kinds:
 * - AK1 ENUMS.shapeKinds = the six of M1, the ten flowchart kinds, the 20
 *   symbols, in this order (the golden and the PHP test check the rest)
 * - AK2 every new kind: outline points in [0, 1], anchors and text box in
 *   the box; inner lines only for database and subprocess; every symbol's
 *   icon parses into finite commands within its 24 × 24 grid; tracing a
 *   symbol uses only path calls of a canvas context; an unknown kind stays rect
 * - svgPath.js: relative commands, H/V, S and T, arcs as cubics, implicit
 *   repeats, compact arc flags; unreadable data gives null
 * - shapePreview: a symbol is its icon, filled; any other kind its outline
 *   (and inner lines) inside the 24 × 24 grid, stroked
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ENUMS } from '../../../src/model/registry.js'
import {
	BASIC_KINDS, BPMN_GROUPS, CURVE_STEPS, FLOWCHART_KINDS, SHAPES, iconCommands, isSymbolKind, outlinePoints, shapeOf, shapePreview,
} from '../../../src/model/shapes.js'
import { parseSvgPath, traceCommands } from '../../../src/model/svgPath.js'
import { traceLines, traceOutline } from '../../../src/scene/nodes/shape.js'
import { pointInPolygon } from '../../../src/model/geometry.js'

const FLOW_NEW = ['terminal', 'parallelogram', 'document', 'database', 'subprocess', 'hexagon', 'manualInput', 'trapezoid', 'delay', 'offPage']
const SYMBOLS = [
	'iconPerson', 'iconPeople', 'iconPlace', 'iconClock', 'iconWarning', 'iconInfo', 'iconQuestion', 'iconDone', 'iconError', 'iconStar',
	'iconHeart', 'iconIdea', 'iconFlag', 'iconCalendar', 'iconMail', 'iconPhone', 'iconHome', 'iconSettings', 'iconLock', 'iconCloud',
]

/** A canvas context that records its calls; any other method is missing (TypeError). */
function fakeContext() {
	const calls = []
	const rec = (name) => (...a) => calls.push([name, ...a])
	return {
		calls,
		beginPath: rec('beginPath'),
		moveTo: rec('moveTo'),
		lineTo: rec('lineTo'),
		bezierCurveTo: rec('bezierCurveTo'),
		quadraticCurveTo: rec('quadraticCurveTo'),
		arcTo: rec('arcTo'),
		rect: rec('rect'),
		ellipse: rec('ellipse'),
		closePath: rec('closePath'),
	}
}

describe('job 201 AK1: the registry kinds', () => {
	test('ENUMS.shapeKinds: the six of M1, then the flowchart kinds, then the symbols; the table has one entry each', () => {
		// job 203: the own shape (its picture in data.img), (job 204) then the BPMN kinds
		assert.deepEqual([...ENUMS.shapeKinds], [...BASIC_KINDS, ...FLOW_NEW, ...SYMBOLS, 'image', ...Object.values(BPMN_GROUPS).flat()])
		assert.deepEqual(Object.keys(SHAPES), [...ENUMS.shapeKinds])
		assert.deepEqual([...FLOWCHART_KINDS], ['rect', 'diamond', ...FLOW_NEW])
	})
})

describe('job 201 AK2: the outlines', () => {
	test('every new kind: outline points in [0, 1], anchors and text box inside the box', () => {
		for (const k of [...FLOW_NEW, ...SYMBOLS]) {
			const s = SHAPES[k]
			for (const v of Array.isArray(s.outline) ? s.outline : []) assert.ok(v >= 0 && v <= 1, k)
			for (const [ax, ay] of s.anchors) assert.ok(ax >= 0 && ax <= 1 && ay >= 0 && ay <= 1, k)
			const [x, y, w, h] = s.text
			assert.ok(x >= 0 && y >= 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9, k)
		}
	})

	test('curves: CURVE_STEPS segments per curve on the 1e-4 grid; the wave and the caps where the spec puts them', () => {
		assert.equal(CURVE_STEPS, 16)
		// document: top edge (2 points) and the wave (17 points)
		assert.equal(SHAPES.document.outline.length, 2 * (2 + CURVE_STEPS + 1))
		for (const v of SHAPES.database.outline) assert.equal(Math.round(v * 10000) / 10000, v)
		const doc = outlinePoints('document', 1, 1)
		// the wave's lowest point at x = 0.25, its highest at x = 0.75
		const at = (x) => doc[doc.findIndex((v, i) => i % 2 === 0 && i > 2 && Math.abs(v - x) < 1e-9) + 1]
		assert.ok(Math.abs(at(0.25) - 0.975) < 1e-4 && Math.abs(at(0.75) - 0.775) < 1e-4 && Math.abs(at(0.5) - 0.875) < 1e-9)
		// a press in the box but below the wave on the left misses, above it hits
		assert.equal(pointInPolygon(0.25, 0.99, doc), false)
		assert.equal(pointInPolygon(0.25, 0.9, doc), true)
		// database: the top cap reaches 0 at the middle, the bottom one 1; the corners of the box miss
		const db = outlinePoints('database', 1, 1)
		assert.equal(pointInPolygon(0.01, 0.01, db), false)
		assert.equal(pointInPolygon(0.5, 0.5, db), true)
		assert.deepEqual(SHAPES.database.create, { w: 160, h: 200 })
		assert.deepEqual(SHAPES.offPage.create, { w: 120, h: 120 })
	})

	test('inner lines only for database (the front of the top cap) and subprocess (two bars)', () => {
		// job 204: the BPMN kinds have their own (bpmnShapes.test.mjs)
		for (const k of ENUMS.shapeKinds.filter((x) => !x.startsWith('bpmn'))) assert.equal(Array.isArray(SHAPES[k].lines), k === 'database' || k === 'subprocess', k)
		assert.deepEqual(SHAPES.subprocess.lines, [[0.1, 0, 0.1, 1], [0.9, 0, 0.9, 1]])
		const front = SHAPES.database.lines[0]
		assert.deepEqual([front[0], front[1], front.at(-2), front.at(-1)], [0, 0.1, 1, 0.1])
		assert.equal(front[CURVE_STEPS + 1], 0.2, 'its lowest point in the middle')
		const c = fakeContext()
		assert.equal(traceLines(c, 'subprocess', 200, 100), true)
		assert.deepEqual(c.calls, [['beginPath'], ['moveTo', 20, 0], ['lineTo', 20, 100], ['moveTo', 180, 0], ['lineTo', 180, 100]])
		assert.equal(traceLines(fakeContext(), 'rect', 10, 10), false)
	})

	test('symbols: box hit, box outline, side anchors, 96 × 96 in the text colour without border; isSymbolKind', () => {
		for (const k of SYMBOLS) {
			const s = SHAPES[k]
			assert.deepEqual([s.hit, s.outline, typeof s.icon], ['box', null, 'string'], k)
			assert.deepEqual(s.create, { w: 96, h: 96, style: { fill: '#191b1d', strokeWidth: 0 } }, k)
			assert.equal(isSymbolKind(k), true, k)
		}
		for (const k of [...BASIC_KINDS, ...FLOW_NEW, 'nope', null, undefined]) assert.equal(isSymbolKind(k), false, String(k))
		assert.equal(shapeOf('heptagon'), SHAPES.rect)
	})

	test('every icon parses into finite commands within its 24 × 24 grid', () => {
		for (const k of SYMBOLS) {
			const cmds = iconCommands(k)
			assert.ok(Array.isArray(cmds) && cmds.length > 2, k)
			assert.equal(cmds[0][0], 'M', k)
			for (const c of cmds) {
				assert.ok(['M', 'L', 'C', 'Q', 'Z'].includes(c[0]), k)
				for (const v of c.slice(1)) assert.ok(Number.isFinite(v) && v >= -0.5 && v <= 24.5, `${k}: ${c}`)
			}
		}
		assert.equal(iconCommands('rect'), null)
		assert.equal(iconCommands('iconStar'), iconCommands('iconStar'), 'parsed once')
	})

	test('tracing a symbol: only path calls, the points scaled from the grid to the box', () => {
		const c = fakeContext()
		traceOutline(c, 'iconHome', 48, 96)
		assert.equal(c.calls[0][0], 'beginPath')
		// job 244: Phosphor house, M20.56 10.189 on the 24 grid → (20.56 × 2, 10.189 × 4)
		assert.equal(c.calls[1][0], 'moveTo')
		assert.ok(Math.abs(c.calls[1][1] - 41.12) < 1e-9 && Math.abs(c.calls[1][2] - 40.756) < 1e-9, String(c.calls[1]))
		for (const call of c.calls) assert.ok(['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath'].includes(call[0]))
		for (const k of SYMBOLS) traceOutline(fakeContext(), k, 100, 100)
		// a flowchart outline stays a polygon
		const p = fakeContext()
		traceOutline(p, 'hexagon', 100, 50)
		assert.deepEqual(p.calls.map((x) => x[0]), ['beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'])
		const r = fakeContext()
		traceOutline(r, 'terminal', 200, 100)
		assert.deepEqual(r.calls[1], ['moveTo', 50, 0], 'a stadium: the radius is half the height')
	})
})

describe('job 201: svgPath.js', () => {
	test('absolute and relative lines, H and V, Z back to the start', () => {
		assert.deepEqual(parseSvgPath('M1 2L3 4h2v-1H0V0z'), [['M', 1, 2], ['L', 3, 4], ['L', 5, 4], ['L', 5, 3], ['L', 0, 3], ['L', 0, 0], ['Z']])
		assert.deepEqual(parseSvgPath('m1,1 2,0 0,2'), [['M', 1, 1], ['L', 3, 1], ['L', 3, 3]], 'pairs after m are relative lines')
		assert.deepEqual(parseSvgPath('M0 0 5 5'), [['M', 0, 0], ['L', 5, 5]])
		assert.deepEqual(parseSvgPath('M1-2L.5.5'), [['M', 1, -2], ['L', 0.5, 0.5]], 'numbers without separators')
	})

	test('curves: S reflects the last C control point, T the last Q one; c is relative', () => {
		assert.deepEqual(parseSvgPath('M0 0C1 1 2 1 3 0S5 -1 6 0'), [['M', 0, 0], ['C', 1, 1, 2, 1, 3, 0], ['C', 4, -1, 5, -1, 6, 0]])
		assert.deepEqual(parseSvgPath('M0 0Q1 1 2 0T4 0'), [['M', 0, 0], ['Q', 1, 1, 2, 0], ['Q', 3, -1, 4, 0]])
		assert.deepEqual(parseSvgPath('M1 1c1 1 2 1 3 0'), [['M', 1, 1], ['C', 2, 2, 3, 2, 4, 1]])
		assert.deepEqual(parseSvgPath('M0 0S1 1 2 0'), [['M', 0, 0], ['C', 0, 0, 1, 1, 2, 0]], 'S without a C before: the current point')
	})

	test('arcs: a half circle is two cubics ending on the end point and staying on the circle; compact flags', () => {
		const half = parseSvgPath('M0,10A10,10 0 0,1 20,10')
		assert.equal(half.length, 3)
		assert.deepEqual(half[2].slice(-2), [20, 10])
		const mid = half[1].slice(-2)
		assert.ok(Math.abs(mid[0] - 10) < 1e-9 && Math.abs(mid[1]) < 1e-9, 'sweep 1 goes over the top (y down)')
		assert.deepEqual(parseSvgPath('M0 10a10 10 0 0120 0'), half, 'flags written as "01"')
		assert.deepEqual(parseSvgPath('M0 0A0 5 0 0 1 4 4'), [['M', 0, 0], ['L', 4, 4]], 'a zero radius is a line')
	})

	test('unreadable data gives null; traceCommands maps the points', () => {
		for (const d of [null, '', 'L1 1', 'M1', 'M1 2 3', 'M1 1X2', 'M a b']) assert.equal(parseSvgPath(d), null, String(d))
		const c = fakeContext()
		traceCommands(c, [['M', 1, 2], ['Q', 1, 1, 2, 2], ['C', 0, 0, 1, 1, 2, 2], ['Z']], 2, 3, 10, 20)
		assert.deepEqual(c.calls, [['moveTo', 12, 26], ['quadraticCurveTo', 12, 23, 14, 26], ['bezierCurveTo', 10, 20, 12, 23, 14, 26], ['closePath']])
	})
})

describe('job 201: shapePreview', () => {
	test('a symbol is its icon, filled; other kinds a stroked outline inside the grid, in the proportions of a new shape', () => {
		// job 244: and the light layer of its Duotone weight
		assert.deepEqual(shapePreview('iconStar'), { d: SHAPES.iconStar.icon, duo: SHAPES.iconStar.duo, filled: true, mark: null, thick: false })
		for (const k of [...BASIC_KINDS, ...FLOW_NEW]) {
			const p = shapePreview(k)
			assert.equal(p.filled, false, k)
			assert.equal(p.duo, null, k)
			assert.ok(parseSvgPath(p.d) !== null, k)
			for (const c of parseSvgPath(p.d)) {
				for (const v of c.slice(1)) assert.ok(v >= 1.9 && v <= 22.1, `${k}: ${c}`)
			}
		}
		// job 260: the fixed corner 4 scaled like the box (200 → 20: 0.4)
		assert.equal(shapePreview('rect').d, 'M2.4 6H21.6A0.4 0.4 0 0 1 22 6.4V17.6A0.4 0.4 0 0 1 21.6 18H2.4A0.4 0.4 0 0 1 2 17.6V6.4A0.4 0.4 0 0 1 2.4 6Z', '200 × 120 → 20 × 12, centred')
		assert.match(shapePreview('roundRect').d, /^M3\.6 6H20\.4A1\.6 1\.6 /, 'roundRect: 16 → 1.6')
		assert.equal(shapePreview('subprocess').d.split('M').length - 1, 3, 'outline and two bars')
		assert.equal(shapePreview('nope').d, shapePreview('rect').d)
	})
})
