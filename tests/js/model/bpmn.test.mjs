/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 204 (BPMN 2.0), the shape table and what draws it:
 * - AK2 every BPMN kind: outline and inner lines in [0, 1], anchors and text
 *   box in the box; every mark and badge icon parses into finite commands
 *   in its 24 × 24 grid; badgeBox stays in the box from 10 to 20000;
 *   noText exactly for the 10 events and 4 gateways, thick exactly for the
 *   4 end events and the call activity; drawing each kind on a recording
 *   context calls only known methods, the mark filled in style.stroke (also
 *   without a border), a thick border twice as wide
 * - AK3 (part) isTextless; a stored text of an event is still drawn
 * - AK4 the BPMN library (after the flowchart, each kind once, the pool
 *   last), the search, kindChoices per group, the seven tips, flowOf
 * - AK5 (part) the open tips: stroked, never filled; capCut
 * - AK7 the export: a shape's mark is a filled path in the border colour,
 *   the open tips of a message flow stroked paths without fill
 * - shapePreview: mark and thick; the pool entry's preview
 * - round 1: usual task names fit the text box of every task kind at
 *   180 × 120 at their auto-fit size; the text box keeps clear of the badge
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ENUMS } from '../../../src/model/registry.js'
import {
	BADGE_SIZE, BPMN_GROUPS, SHAPES, badgeBox, bpmnGroupOf, isSymbolKind, isTextless, markCommands, markPlace, shapePreview,
} from '../../../src/model/shapes.js'
import { parseSvgPath } from '../../../src/model/svgPath.js'
import { bodyAttrs, shape, shapeTextAttrs, shapeTextBox, traceMark } from '../../../src/scene/nodes/shape.js'
import { LINE_HEIGHT } from '../../../src/model/tokens.js'
import { capCut, drawCap, drawConnector, lineAttrs } from '../../../src/scene/nodes/connector.js'
import { capSize } from '../../../src/model/connectors.js'
import { POOL_KIND, POOL_PREVIEW, SHAPE_LIBS, englishLabel, entryOf, searchEntries } from '../../../src/components/shapeLibs.js'
import { contextSections, flowOf, kindChoices } from '../../../src/components/contextbar.js'
import { VectorContext } from '../../../src/scene/vectorContext.js'
import { svgDocument } from '../../../src/scene/exportSvg.js'

const BPMN = Object.values(BPMN_GROUPS).flat()
const ENDS = ['bpmnEnd', 'bpmnEndMessage', 'bpmnEndError', 'bpmnEndTerminate']

/** A canvas (Konva) context that records its calls; any other method is missing (TypeError). */
function fakeContext() {
	const calls = []
	const rec = (name) => (...a) => calls.push([name, ...a])
	const c = { calls }
	for (const m of ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arcTo', 'arc', 'rect', 'ellipse', 'closePath',
		'fillStrokeShape', 'strokeShape', 'setAttr', 'fill', 'stroke', 'setLineDash', 'drawImage']) c[m] = rec(m)
	return c
}

/** Minimal Konva node classes for shape.build. */
class FakeNode {
	constructor(attrs = {}) {
		this.attrs = { ...attrs }
		this.children = []
	}

	setAttrs(a) { Object.assign(this.attrs, a) }
	getAttr(k) { return this.attrs[k] }
	visible(v) {
		if (v === undefined) return this.attrs.visible !== false
		this.attrs.visible = v
		return this
	}

	width() { return this.attrs.width }
	height() { return this.attrs.height }
	stroke() { return this.attrs.stroke }
	strokeWidth() { return this.attrs.strokeWidth }
	transformsEnabled() {}
	add(...c) { this.children.push(...c) }
	destroy() {}
}
const builder = { Group: class extends FakeNode {}, Rect: class extends FakeNode {}, Text: class extends FakeNode {}, Shape: class extends FakeNode {}, Line: class extends FakeNode {}, shadows: true }

const item = (kind, o = {}) => ({ id: 'S', t: 'shape', x: 0, y: 0, w: 180, h: 120, r: 0, data: { kind, text: '' }, style: { fill: '#ffffff', stroke: '#c43e45', strokeWidth: 2 }, ...o })

/**
 * @param {object} it WireItem
 * @param {object} ctx recording context
 * @return {object} the body node, after its sceneFunc drew into ctx
 */
function draw(it, ctx) {
	const e = shape.build(builder, it, { x: it.x, y: it.y, w: it.w, h: it.h, r: 0 }, 0)
	e.parts.body.attrs.sceneFunc(ctx, e.parts.body)
	return e.parts.body
}

describe('job 204 AK2: the BPMN kinds of the shape table', () => {
	test('28 kinds in four groups, after image in the registry; outlines, lines, anchors and text boxes in the box', () => {
		assert.equal(BPMN.length, 28)
		assert.deepEqual([...ENUMS.shapeKinds].slice(ENUMS.shapeKinds.indexOf('image') + 1), BPMN)
		for (const k of BPMN) {
			const s = SHAPES[k]
			for (const v of Array.isArray(s.outline) ? s.outline : []) assert.ok(v >= 0 && v <= 1, k)
			for (const l of s.lines ?? []) for (const v of l) assert.ok(v >= 0 && v <= 1, k)
			for (const [ax, ay] of s.anchors) assert.ok(ax >= 0 && ax <= 1 && ay >= 0 && ay <= 1, k)
			const [x, y, w, h] = s.text
			assert.ok(x >= 0 && y >= 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9, k)
			assert.equal(isSymbolKind(k), false, k)
			assert.equal(bpmnGroupOf(k).includes(k), true, k)
		}
		assert.equal(bpmnGroupOf('rect'), null)
	})

	test('every mark and badge parses into finite commands in its 24 × 24 grid', () => {
		let marked = 0
		for (const k of BPMN) {
			const s = SHAPES[k]
			const icon = s.mark?.icon ?? s.badge?.icon
			if (!icon) {
				assert.equal(markCommands(k), null, k)
				continue
			}
			marked++
			const cmds = parseSvgPath(icon)
			assert.ok(cmds && cmds.length > 0, k)
			for (const c of cmds) {
				for (const v of c.slice(1)) assert.ok(Number.isFinite(v) && v >= -0.01 && v <= 24.01, `${k}: ${c}`)
			}
			assert.deepEqual(markCommands(k), cmds, k)
			if (s.mark) assert.ok(s.mark.share > 0 && s.mark.share <= 1, k)
			if (s.badge) assert.ok(['tl', 'bottom'].includes(s.badge.at), k)
		}
		assert.equal(marked, 20, 'every BPMN kind but plain start, intermediate and end event, task, call activity, event gateway, data object and store')
	})

	test('badgeBox: at most BADGE_SIZE, inside the box for every size from 10 to 20000; markPlace centres a mark', () => {
		for (const k of ['bpmnUserTask', 'bpmnSubprocess', 'bpmnDataInput']) {
			for (const [w, h] of [[10, 10], [12, 10], [10, 20000], [20000, 10], [180, 120], [20000, 20000], [37, 913]]) {
				const b = badgeBox(k, w, h)
				assert.ok(b.s > 0 && b.s <= BADGE_SIZE, `${k} ${w}×${h}`)
				assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.s <= w + 1e-9 && b.y + b.s <= h + 1e-9, `${k} ${w}×${h}: ${JSON.stringify(b)}`)
			}
		}
		assert.deepEqual(badgeBox('bpmnUserTask', 180, 120), { x: 6, y: 6, s: 20 })
		assert.deepEqual(badgeBox('bpmnSubprocess', 180, 120), { x: 80, y: 94, s: 20 })
		assert.equal(badgeBox('bpmnTask', 180, 120), null)
		assert.equal(badgeBox('rect', 180, 120), null)
		const m = markPlace('bpmnExclusive', 80, 80)
		assert.deepEqual([m.x, m.y, m.s], [22, 22, 36])
		assert.equal(markPlace('bpmnStart', 64, 64), null)
	})

	test('noText exactly for the events and gateways, thick exactly for the end events and the call activity', () => {
		for (const k of ENUMS.shapeKinds) {
			const s = SHAPES[k]
			const textless = BPMN_GROUPS.events.includes(k) || BPMN_GROUPS.gateways.includes(k)
			assert.equal(s.noText === true, textless, k)
			assert.equal(s.thick === true, ENDS.includes(k) || k === 'bpmnCallActivity', k)
			assert.equal(isTextless(k), textless || isSymbolKind(k), k)
		}
		// job 260: BPMN kinds keep the black border of 0.4.0
		const B = { stroke: '#191b1d' }
		assert.deepEqual([SHAPES.bpmnStart.create, SHAPES.bpmnTask.create, SHAPES.bpmnExclusive.create, SHAPES.bpmnDataObject.create, SHAPES.bpmnDataStore.create],
			[{ w: 64, h: 64, style: B }, { w: 180, h: 120, style: B }, { w: 80, h: 80, style: B }, { w: 80, h: 100, style: B }, { w: 120, h: 120, style: B }])
	})

	test('drawing every BPMN kind uses known canvas calls only; the mark is filled in the border colour, also without a border', () => {
		for (const k of BPMN) {
			const c = fakeContext()
			draw(item(k), c)
			const names = c.calls.map((x) => x[0])
			assert.equal(names[0], 'beginPath', k)
			assert.ok(names.includes('fillStrokeShape'), k)
			const fills = c.calls.filter((x) => x[0] === 'setAttr' && x[1] === 'fillStyle')
			assert.equal(fills.length, markCommands(k) ? 1 : 0, k)
			if (fills.length) {
				assert.equal(fills[0][2], '#c43e45', k)
				assert.equal(names.at(-1), 'fill', k)
			}
		}
		const c = fakeContext()
		draw(item('bpmnEndError', { style: { stroke: '#307d37', strokeWidth: 0 } }), c)
		assert.deepEqual(c.calls.filter((x) => x[0] === 'setAttr'), [['setAttr', 'fillStyle', '#307d37']], 'no border, still the mark')
		assert.equal(traceMark(fakeContext(), 'bpmnTask', 10, 10, '#000000'), false)
	})

	test('a thick kind draws its border twice as wide, its dashes too; a stored text of an event is still drawn', () => {
		const end = bodyAttrs(item('bpmnEnd', { style: { strokeWidth: 3, dash: 'dashed' } }), { w: 64, h: 64 })
		assert.deepEqual([end.strokeWidth, end.dash], [6, [24, 18]])
		assert.equal(bodyAttrs(item('bpmnCallActivity'), { w: 180, h: 120 }).strokeWidth, 4)
		assert.equal(bodyAttrs(item('bpmnStart'), { w: 64, h: 64 }).strokeWidth, 2)
		assert.equal(bodyAttrs(item('bpmnEnd', { style: { strokeWidth: 0 } }), { w: 64, h: 64 }).strokeEnabled, false)
		assert.equal(bodyAttrs(item('bpmnEnd'), { w: 64, h: 64 }).markColor, '#c43e45')
		assert.equal(shapeTextAttrs(item('bpmnStart', { data: { kind: 'bpmnStart', text: 'pasted' } }), { w: 64, h: 64 }).text, 'pasted')
	})
})

describe('job 204 round 1: the text of a task fits', () => {
	/** Lines of text broken at words, each character estimated at k · fs wide. */
	const lines = (text, fs, aw, k = 0.6) => {
		let n = 1
		let cur = 0
		for (const word of text.split(/\s+/)) {
			const ww = word.length * k * fs
			if (cur === 0) cur = ww
			else if (cur + k * fs + ww <= aw) cur += k * fs + ww
			else {
				n++
				cur = ww
			}
		}
		return n
	}
	const NAMES = ['Check order', 'Ship goods', 'Approve purchase order', 'Calculate shipping costs', 'Rechnung versenden', 'Notify customer']

	test('at 180 × 120 the auto-fit size of usual names fits the text box of every task kind, in full lines', () => {
		for (const kind of BPMN_GROUPS.tasks) {
			for (const name of NAMES) {
				const b = shapeTextBox(item(kind, { data: { kind, text: name } }), { w: 180, h: 120 })
				const n = lines(name, b.fontSize, b.w - 2 * b.pad)
				assert.ok(n * b.fontSize * LINE_HEIGHT <= b.h - 2 * b.pad, `${kind} "${name}": ${n} lines of ${b.fontSize} in ${b.h - 2 * b.pad}`)
			}
		}
	})

	test('the text box stays clear of the badge (beside it at the top left, above it at the bottom)', () => {
		for (const kind of BPMN_GROUPS.tasks) {
			const b = badgeBox(kind, 180, 120)
			if (!b) continue
			const [tx, ty, tw, th] = SHAPES[kind].text
			const t = { x: tx * 180, y: ty * 120, w: tw * 180, h: th * 120 }
			const apart = t.x >= b.x + b.s || t.x + t.w <= b.x || t.y >= b.y + b.s || t.y + t.h <= b.y
			assert.ok(apart, `${kind}: ${JSON.stringify(t)} ${JSON.stringify(b)}`)
		}
	})
})

describe('job 204: shapePreview', () => {
	test('the mark in the preview grid, thick for end events; the pool entry has its own preview', () => {
		const p = shapePreview('bpmnEndMessage')
		assert.deepEqual([p.filled, p.thick, p.mark.d], [false, true, SHAPES.bpmnEndMessage.mark.icon])
		assert.ok(p.mark.x >= 2 && p.mark.y >= 2 && p.mark.x + p.mark.s <= 22 && p.mark.y + p.mark.s <= 22)
		const u = shapePreview('bpmnUserTask')
		assert.equal(u.thick, false)
		// the task's box in the grid: 20 × 13.33 from (2, 5.33); its badge larger than on the board, inside it
		assert.ok(u.mark.s > 6 && u.mark.s < 8, 'a badge readable in the preview')
		assert.ok(u.mark.x >= 2 && u.mark.y >= 5.33 && u.mark.x + u.mark.s <= 22 && u.mark.y + u.mark.s <= 18.67, JSON.stringify(u.mark))
		const sub = shapePreview('bpmnSubprocess').mark
		assert.ok(Math.abs(sub.x + sub.s / 2 - 12) < 0.01 && sub.y + sub.s <= 18.67, 'centred at the bottom')
		assert.deepEqual(shapePreview('bpmnTask').mark, null)
		assert.equal(shapePreview('rect').mark, null)
		assert.equal(POOL_PREVIEW.filled, false)
		assert.ok(parseSvgPath(POOL_PREVIEW.d))
	})
})

describe('job 204 AK4: the BPMN library and the context bar', () => {
	const bpmn = SHAPE_LIBS.find((l) => l.id === 'bpmn')

	test('after the flowchart; every BPMN kind once, in group order, then the pool', () => {
		assert.equal(SHAPE_LIBS.findIndex((l) => l.id === 'bpmn'), SHAPE_LIBS.findIndex((l) => l.id === 'flowchart') + 1)
		assert.deepEqual(bpmn.entries.map((e) => e.kind), [...BPMN, POOL_KIND])
		assert.equal(bpmn.entries.at(-1).id, 'bpmn.pool')
		assert.equal(new Set(bpmn.entries.map((e) => e.id)).size, bpmn.entries.length)
		assert.equal(ENUMS.shapeKinds.includes(POOL_KIND), false, 'the pool is no shape kind')
		assert.equal(englishLabel(entryOf('bpmn.ruleTask')), 'Business rule task')
		assert.equal(englishLabel(entryOf('bpmn.pool')), 'Pool with lanes')
	})

	test('search: "gateway" gives the four gateways, the German "Bahnen" the pool', () => {
		assert.deepEqual(searchEntries('gateway').map((e) => e.id), ['bpmn.exclusive', 'bpmn.parallel', 'bpmn.inclusive', 'bpmn.eventGateway'])
		const german = (e) => (e.id === 'bpmn.pool' ? 'Pool mit Bahnen' : englishLabel(e))
		assert.deepEqual(searchEntries('bahnen', german).map((e) => e.id), ['bpmn.pool'])
		assert.deepEqual(searchEntries('pool').map((e) => e.id), ['bpmn.pool'])
	})

	test('kindChoices: the kinds of the group; mixed kinds the six of M1', () => {
		for (const list of Object.values(BPMN_GROUPS)) {
			for (const k of list) assert.deepEqual(kindChoices({ kind: k, mixed: [] }), [...list], k)
		}
		assert.equal(kindChoices({ kind: 'bpmnStart', mixed: ['data.kind'] }).length, 6)
		assert.equal(kindChoices({ kind: 'iconStar', mixed: [] }), null)
	})

	test('the bar offers the seven tips; flowOf names the flow of the selected connectors, null for any other or a mixed look', () => {
		const sel = (o) => ({ types: new Set(['connector']), fields: ['style.dash', 'style.startCap', 'style.endCap', 'style.stroke'], count: 2, mixed: [], ...o })
		const s = contextSections(sel({}))
		assert.deepEqual(s.endCap, ['none', 'arrow', 'triangle', 'dot', 'diamond', 'circleOpen', 'triangleOpen'])
		assert.deepEqual(s.startCap, s.endCap)
		assert.equal(flowOf(sel({ dash: 'solid', startCap: 'none', endCap: 'triangle' })), 'sequence')
		assert.equal(flowOf(sel({ dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' })), 'message')
		assert.equal(flowOf(sel({ dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen', mixed: ['style.dash'] })), null)
		assert.equal(flowOf(sel({ dash: 'dotted', startCap: 'none', endCap: 'triangle' })), null)
		assert.equal(flowOf({ ...sel({ dash: 'solid', startCap: 'none', endCap: 'triangle' }), types: new Set(['connector', 'shape']) }), null)
		assert.equal(flowOf(null), null)
	})
})

describe('job 204 AK5: the open tips', () => {
	test('circleOpen and triangleOpen are stroked, never filled; the line ends at their back (job 261)', () => {
		for (const cap of ['circleOpen', 'triangleOpen']) {
			const c = fakeContext()
			drawCap(c, cap, 100, 50, 0, 10, 2, '#1971c2')
			const names = c.calls.map((x) => x[0])
			assert.equal(names.at(-1), 'stroke', cap)
			assert.equal(names.includes('fill'), false, cap)
			assert.ok(c.calls.some((x) => x[0] === 'setAttr' && x[1] === 'strokeStyle' && x[2] === '#1971c2'), cap)
		}
		const circle = fakeContext()
		drawCap(circle, 'circleOpen', 100, 50, 0, 10, 2, '#000000')
		const arc = circle.calls.find((x) => x[0] === 'arc')
		assert.deepEqual(arc.slice(1, 4), [95, 50, 3.75], 'job 261: centred L/2 behind the tip, radius 0.375·L')
		assert.equal(capCut('circleOpen', 10, 2), 8.75)
		assert.equal(capCut('triangleOpen', 10, 2), 10)
	})
})

describe('job 204 AK7: the export', () => {
	/**
	 * @param {VectorContext} vc recording context
	 * @return {object} the parts of a Konva context the nodes call, drawing into vc
	 */
	function konvaOn(vc) {
		const k = {}
		for (const m of ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arcTo', 'arc', 'rect', 'ellipse', 'closePath', 'fill', 'stroke', 'setLineDash']) {
			k[m] = (...a) => vc[m](...a)
		}
		k.setAttr = (name, v) => { vc[name] = v }
		const strokeOf = (s) => {
			vc.strokeStyle = s.getAttr('stroke')
			vc.lineWidth = s.getAttr('strokeWidth')
			vc.setLineDash(s.getAttr('dashEnabled') ? s.getAttr('dash') : [])
			vc.stroke()
		}
		k.strokeShape = strokeOf
		k.fillStrokeShape = (s) => {
			if (s.getAttr('fillEnabled') !== false) {
				vc.fillStyle = s.getAttr('fill')
				vc.fill()
			}
			if (s.getAttr('strokeEnabled') !== false) strokeOf(s)
		}
		return k
	}

	test('SVG: the marks of an end event and a user task are filled paths in the border colour; the open tips are stroked paths', () => {
		const vc = new VectorContext()
		vc.beginGroup('E')
		draw(item('bpmnEndMessage', { w: 64, h: 64, style: { fill: '#ffffff', stroke: '#c43e45', strokeWidth: 2 } }), konvaOn(vc))
		vc.endGroup()
		vc.beginGroup('T')
		draw(item('bpmnUserTask', { style: { fill: '#ffffff', stroke: '#1971c2', strokeWidth: 2 } }), konvaOn(vc))
		vc.endGroup()
		const conn = { id: 'K', t: 'connector', data: { start: { x: 0, y: 200 }, end: { x: 300, y: 200 } }, style: { stroke: '#307d37', strokeWidth: 2, dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' } }
		const line = new FakeNode(lineAttrs(conn, { geom: { kind: 'poly', points: [0, 200, 300, 200], start: { angle: Math.PI }, end: { angle: 0 } } }))
		vc.beginGroup('K')
		drawConnector(konvaOn(vc), line)
		vc.endGroup()
		const svg = svgDocument(vc.ops, { x: -10, y: -10, w: 400, h: 300 })
		const groups = Object.fromEntries([...svg.matchAll(/<g id="item-(\w)">\n([\s\S]*?)<\/g>/g)].map((m) => [m[1], m[2]]))
		const marks = (g, color) => (groups[g].match(new RegExp(`<path d="[^"]+" fill="${color}"(?! stroke)`, 'g')) ?? []).length
		assert.equal(marks('E', '#c43e45'), 1, 'the envelope of the end event')
		assert.equal(marks('T', '#1971c2'), 1, 'the person of the user task')
		assert.match(groups.E, /stroke-width="4"/, 'the thick border')
		const paths = groups.K.match(/<path [^>]*>/g)
		assert.equal(paths.length, 3, 'line, circle, triangle')
		for (const p of paths) {
			assert.match(p, /stroke="#307d37"/)
			assert.doesNotMatch(p, /fill="#/, 'nothing filled')
		}
		assert.match(paths[0], /stroke-dasharray/, 'the line dashed')
		assert.doesNotMatch(paths[1] + paths[2], /stroke-dasharray/, 'the tips solid')
		assert.equal(capSize(2), 6 + 4 * Math.SQRT2)
	})

	test('job 261 AK9: an elbow connector exports with rounded bends and its filled triangle', () => {
		const vc = new VectorContext()
		const conn = { id: 'K', t: 'connector', data: { start: { x: 0, y: 0 }, end: { x: 200, y: 100 }, route: 'elbow' }, style: { stroke: '#3d4044', strokeWidth: 2, endCap: 'triangle' } }
		const line = new FakeNode(lineAttrs(conn, { geom: { kind: 'poly', points: [0, 0, 100, 0, 100, 100, 200, 100], start: { angle: Math.PI }, end: { angle: 0 } } }))
		vc.beginGroup('K')
		drawConnector(konvaOn(vc), line)
		vc.endGroup()
		const svg = svgDocument(vc.ops, { x: -10, y: -10, w: 300, h: 200 })
		const paths = svg.match(/<path [^>]*>/g)
		assert.equal(paths.length, 2, 'line and tip')
		assert.match(paths[0], / d="M[^"]*[AC][^"]*"/, 'the bends are arcs or curves')
		assert.match(paths[0], /fill="none"|stroke="#3d4044"/)
		assert.match(paths[1], /fill="#3d4044"/, 'the tip filled')
	})
})
