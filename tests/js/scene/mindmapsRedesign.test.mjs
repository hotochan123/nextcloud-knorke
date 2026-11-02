/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 266 (design round 4, M3 and O1): the look of mind maps, org
 * charts and trees.
 * - AK1 the centre and the main pills (layout and paint)
 * - AK3 tapering branches: widths at both ends per depth
 * - AK4 the "+n" badge of a mind map: place, text, hit, hull
 * - AK5 cards in org and tree: role 14 grey, dark border, band top / left
 * - AK6 dark lines with round bends in org and tree
 * - AK7 the badge below a folded card in org
 * - AK8 no "+" covers the text of another node (both, org, tree; 50 %, 100 %, 200 %)
 * - risk: an old board with s, f, m and d loads in every layout
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from './sceneHarness.mjs'
import { MM_TAPER_STEPS, bentLine, mindmap as mindmapSpec, paintMindmap, taperOf, taperOutline } from '../../../src/scene/nodes/mindmap.js'
import {
	MM_BADGE_H, MM_ROLE_FONT, badgeWidth, bucketOf, estimateNodeSize, lightOf, mindmapLayout, nodeAtLayout, textRect,
} from '../../../src/model/mindmap.js'
import { MM_COLORS, PALETTE, STRUCT_PLUS_PX } from '../../../src/model/tokens.js'

const ID = '01JA00000000000000000000M1'
const R = 'n00000000'
const A = 'n10000000'
const B = 'n20000000'
const C = 'n30000000'
const A1 = 'n40000000'
const A2 = 'n50000000'
const A3 = 'n60000000'
const A4 = 'n70000000'
const A5 = 'n80000000'
const A11 = 'n90000000'
const A111 = 'na0000000'

/** [key, node, text] → a mind map item with its box */
function mm(list, style = {}) {
	const nodes = {}
	const texts = {}
	for (const [k, n, t] of list) {
		nodes[bucketOf(k)] = { ...(nodes[bucketOf(k)] ?? {}), [k]: n }
		if (t) texts[bucketOf(k)] = { ...(texts[bucketOf(k)] ?? {}), [k]: t }
	}
	const it = { id: ID, t: 'mindmap', x: 100, y: 100, w: 0, h: 0, r: 0, z: 'a5', parent: null, data: { nodes, texts }, style }
	const l = mindmapLayout(it)
	return { ...it, w: l.w, h: l.h }
}

const base = (style = {}, extra = {}) => mm([
	[R, { o: 'i0' }, 'Thema'], [A, { o: 'i0', p: R, ...(extra.A ?? {}) }, 'Alpha'], [B, { o: 'i1', p: R }, 'Beta'],
	[C, { o: 'i2', p: R, d: 'l' }, 'Links'], [A1, { o: 'i0', p: A }, 'a1'], [A11, { o: 'i0', p: A1 }, 'a11'],
	[A111, { o: 'i0', p: A11 }, 'a111'],
], style)

/** a recording 2D context: every call and every set */
function recorder() {
	const calls = []
	const c = new Proxy({}, {
		get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])),
		set: (t, k, v) => { calls.push(['set:' + String(k), v]); t[k] = v; return true },
	})
	return { c, calls }
}

describe('job 266 AK1: the centre and the main pills', () => {
	test('layout: root roundRect, main branches pills on their light tone, bold, 12 × 8; deeper lines', () => {
		const l = mindmapLayout(base())
		const n = (k) => l.byKey.get(k)
		assert.equal(n(R).shape, 'roundRect')
		assert.equal(n(R).border, '#3d4044', 'the root without c: dark border')
		for (const k of [A, B, C]) {
			assert.deepEqual([n(k).shape, n(k).main, n(k).bold, n(k).padX, n(k).padY, n(k).border], ['pill', true, true, 12, 8, null], k)
			assert.equal(n(k).fill, lightOf(n(k).color))
		}
		assert.equal(lightOf(PALETTE[0].strong), PALETTE[0].light)
		assert.equal(n(A1).shape, 'line')
		assert.equal(n(A1).main, false)
		const own = mindmapLayout(mm([[R, { o: 'i0', c: '#c43e45' }, 'X'], [A, { o: 'i0', p: R, s: 'rect' }, 'Y']]))
		assert.equal(own.byKey.get(R).border, own.byKey.get(R).color, 'a root with c keeps its border')
		assert.deepEqual([own.byKey.get(A).shape, own.byKey.get(A).main, own.byKey.get(A).border], ['rect', false, own.byKey.get(A).color], 'a stored box stays a box')
	})

	test('paint: the root with radius 16 and a dark border, the main pills filled without a stroke', () => {
		const l = mindmapLayout(base())
		const { c, calls } = recorder()
		paintMindmap(c, l, 0)
		const r = l.byKey.get(R)
		// roundRect: the first arcTo of the root's outline has the radius as last argument
		const arcs = calls.filter((x) => x[0] === 'arcTo')
		assert.ok(arcs.some((x) => x[5] === 16 && Math.abs(x[1] - (r.x + r.w - 1)) < 1e-9), 'radius 16')
		const fills = []
		let fill = null
		for (const x of calls) {
			if (x[0] === 'set:fillStyle') fill = x[1]
			if (x[0] === 'fill') fills.push(fill)
		}
		for (const k of [A, B, C]) assert.ok(fills.includes(l.byKey.get(k).fill), 'the light tone of ' + k)
		const strokes = calls.filter((x) => x[0] === 'set:strokeStyle').map((x) => x[1])
		assert.ok(strokes.includes('#3d4044'))
		// a stroke after each fill of a main pill would carry its colour: no stroke in a main colour after its light fill
		let afterPill = false
		for (const x of calls) {
			if (x[0] === 'set:fillStyle') afterPill = [A, B, C].some((k) => l.byKey.get(k).fill === x[1])
			if (x[0] === 'stroke') assert.equal(afterPill, false, 'no border around a main pill')
			if (x[0] === 'beginPath') afterPill = false
		}
	})
})

describe('job 266 AK3: tapering branches', () => {
	test('each depth starts and ends at its width (± 0.05), filled, never stroked', () => {
		const want = [[6.4, 3.2], [3.6, 1.6], [1.8, 1.2], [1.8, 1.2]]
		for (let d = 1; d <= 4; d++) assert.deepEqual(taperOf(d), want[d - 1], 'depth ' + d)
		const o = taperOutline({ x: 0, y: 0 }, { x: 100, y: 60 }, 6.4, 3.2)
		assert.equal(o.length, 2 * (MM_TAPER_STEPS + 1))
		const w = (i) => Math.hypot(o[i][0] - o[o.length - 1 - i][0], o[i][1] - o[o.length - 1 - i][1])
		assert.ok(Math.abs(w(0) - 6.4) < 0.05 && Math.abs(w(MM_TAPER_STEPS) - 3.2) < 0.05)
		const l = mindmapLayout(base())
		const { c, calls } = recorder()
		paintMindmap(c, l, 0)
		assert.equal(calls.filter((x) => x[0] === 'bezierCurveTo').length, 0)
		// 6 branches, each an outline of moveTo + lineTo × (2 · steps + 1) + closePath
		assert.equal(calls.filter((x) => x[0] === 'closePath').length >= 6, true)
		// the outlines in paint order (moveTo … closePath): their widths at both ends per depth of the layout
		const outlines = []
		let cur = null
		for (const x of calls) {
			if (x[0] === 'moveTo') cur = [[x[1], x[2]]]
			else if (x[0] === 'lineTo' && cur) cur.push([x[1], x[2]])
			else if (x[0] === 'closePath' && cur) {
				if (cur.length === 2 * (MM_TAPER_STEPS + 1)) outlines.push(cur)
				cur = null
			}
		}
		const depths = l.nodes.filter((n) => n.parent !== null).map((n) => n.depth)
		assert.equal(outlines.length, depths.length)
		outlines.forEach((p, i) => {
			const ww = (j) => Math.hypot(p[j][0] - p[p.length - 1 - j][0], p[j][1] - p[p.length - 1 - j][1])
			const [w0, w1] = want[depths[i] - 1]
			assert.ok(Math.abs(ww(0) - w0) < 0.05 && Math.abs(ww(MM_TAPER_STEPS) - w1) < 0.05, `depth ${depths[i]}: ${ww(0)} → ${ww(MM_TAPER_STEPS)}`)
		})
	})
})

describe('job 266 AK4 and AK7: the "+n" badge', () => {
	test('mind map: 20 high, 8 beyond the outer edge (mirrored left), dot in its middle; "+3" at level 0 only; a hit; in the hull', () => {
		const it = base({}, { A: { f: true } })
		const l = mindmapLayout(it)
		const a = l.byKey.get(A)
		assert.equal(a.count, 3)
		assert.equal(a.badge.h, MM_BADGE_H)
		assert.ok(Math.abs(a.badge.x - (a.x + a.w + 8)) < 1e-9)
		assert.ok(Math.abs(a.badge.y + a.badge.h / 2 - (a.y + a.h / 2)) < 1e-9)
		assert.equal(a.badge.w, badgeWidth(3))
		assert.deepEqual(a.dot, { x: a.badge.x + a.badge.w / 2, y: a.badge.y + a.badge.h / 2 })
		assert.deepEqual(nodeAtLayout(l, a.badge.x + a.badge.w - 1, a.dot.y), { key: A, part: 'dot' })
		assert.ok(a.badge.x + a.badge.w <= l.w + 1e-9 && a.badge.y >= -1e-9 && a.badge.y + a.badge.h <= l.h + 1e-9)
		const left = mindmapLayout(mm([[R, { o: 'i0' }, 'R'], [C, { o: 'i0', p: R, d: 'l', f: true }, 'L'], [A1, { o: 'i0', p: C }, 'x']]))
		const lc = left.byKey.get(C)
		assert.ok(Math.abs(lc.badge.x + lc.badge.w - (lc.x - 8)) < 1e-9, 'left: mirrored')
		const { c, calls } = recorder()
		paintMindmap(c, l, 0)
		const t = calls.find((x) => x[0] === 'fillText')
		assert.equal(t[1], '+3')
		assert.ok(calls.some((x) => x[0] === 'set:font' && x[1].startsWith('bold 12px')))
		const lod1 = recorder()
		paintMindmap(lod1.c, l, 1)
		assert.equal(lod1.calls.filter((x) => x[0] === 'fillText').length, 0, 'level 1: no number')
		assert.equal(mindmapLayout(base()).byKey.get(A).badge, null, 'unfolded: no badge')
	})

	test('org: the badge centred below the card, its top 4 below it', () => {
		const l = mindmapLayout(base({ layout: 'org' }, { A: { f: true } }))
		const a = l.byKey.get(A)
		assert.ok(Math.abs(a.badge.x + a.badge.w / 2 - (a.x + a.w / 2)) < 1e-9)
		assert.ok(Math.abs(a.badge.y - (a.y + a.h + 4)) < 1e-9)
		const t = mindmapLayout(base({ layout: 'tree' }, { A: { f: true } })).byKey.get(A)
		assert.ok(Math.abs(t.badge.x - (t.x + t.w + 8)) < 1e-9, 'tree: beside the card')
	})
})

describe('job 266 AK5 and AK6: cards and lines in org and tree', () => {
	class Node {
		constructor(a = {}) { this.attrs = { ...a } }
		setAttrs(a) { Object.assign(this.attrs, a) }
		visible(v) { this.attrs.visible = v }
		transformsEnabled() {}
		add() {}
		moveToTop() {}
		destroy() {}
	}
	const ctx = { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {}, Line: class extends Node {}, shadows: true }

	test('every card has name and role, the role 14 in grey; dark borders; the band on top (org) or left (tree), #191b1d at the root', () => {
		for (const layout of ['org', 'tree']) {
			const it = base({ layout })
			it.data.texts.b0[R] = 'Mira\nLeitung'
			const sizes = []
			const l = mindmapLayout(it, (text, maxW, size, bold) => {
				sizes.push([text, size])
				return estimateNodeSize(text, maxW, size, bold)
			})
			assert.ok(sizes.some((s) => s[0] === 'Leitung' && s[1] === MM_ROLE_FONT), layout + ': role measured at 14')
			assert.ok(l.nodes.every((n) => n.name !== null && n.border === '#3d4044'), layout)
			const e = mindmapSpec.build(ctx, it, { x: 0, y: 0, w: it.w, h: it.h, r: 0 }, 0, false)
			const role = e.parts.texts.get(R + ':r').attrs
			assert.deepEqual([role.text, role.fontSize, role.fill], ['Leitung', 14, '#5c5f63'], layout)
			const { c, calls } = recorder()
			paintMindmap(c, l, 0)
			const bands = []
			let fill = null
			for (const x of calls) {
				if (x[0] === 'set:fillStyle') fill = x[1]
				if (x[0] === 'fillRect') bands.push([fill, ...x.slice(1)])
			}
			assert.equal(bands.length, l.nodes.length, layout + ': a band per card')
			const r = l.byKey.get(R)
			const rb = bands[0]
			assert.equal(rb[0], '#191b1d', layout + ': the root band')
			if (layout === 'org') assert.deepEqual(rb.slice(1), [r.x, r.y, r.w, 7])
			else assert.deepEqual(rb.slice(1), [r.x, r.y, 7, r.h])
			assert.ok(calls.filter((x) => x[0] === 'set:strokeStyle').every((x) => x[1] === '#3d4044'), layout + ': only dark strokes')
		}
	})

	test('lines: #3d4044, 2 wide, an arcTo with radius ≤ 10 at each bend', () => {
		for (const layout of ['org', 'tree']) {
			const l = mindmapLayout(base({ layout }))
			const { c, calls } = recorder()
			paintMindmap(c, l, 0)
			assert.ok(calls.some((x) => x[0] === 'set:lineWidth' && x[1] === 2))
			const branches = l.nodes.length - 1
			// the cards' outlines use arcTo with radius 8; the bends ≤ 10 come in pairs per branch (2 bends)
			const bends = calls.filter((x) => x[0] === 'arcTo' && x[5] <= 10)
			assert.ok(bends.length >= 2 * branches, layout + ': ' + bends.length)
		}
		const r = recorder()
		bentLine(r.c, [0, 0, 0, 30, 100, 30, 100, 40], 10)
		const arcs = r.calls.filter((x) => x[0] === 'arcTo')
		assert.deepEqual(arcs.map((x) => x[5]), [10, 5], 'at most half of the shorter segment')
	})
})

describe('job 266 AK8: no "+" covers the text of another node', () => {
	let h = null
	afterEach(() => {
		h?.restore()
		h = null
	})

	test('five siblings, every node in focus, at 50 %, 100 % and 200 %, in both, org and tree', () => {
		for (const layout of ['both', 'org', 'tree']) {
			const it = mm([
				[R, { o: 'i0' }, 'Thema'], [A, { o: 'i0', p: R }, 'Alpha'], [B, { o: 'i1', p: R }, 'Beta'],
				[A1, { o: 'i0', p: A }, 'Erster'], [A2, { o: 'i1', p: A }, 'Zweiter'], [A3, { o: 'i2', p: A }, 'Dritter'],
				[A4, { o: 'i3', p: A }, 'Vierter'], [A5, { o: 'i4', p: A }, 'Fünfter'], [C, { o: 'i0', p: B, f: true }, 'zu'],
				[A11, { o: 'i0', p: C }, 'weg'],
			], { layout })
			h = setupScene([it])
			h.frame()
			for (const scale of [0.5, 1, 2]) {
				h.scene.setCamera({ x: 0, y: 0, scale })
				h.frame()
				const st = () => h.scene.stats().mindmaps[0]
				const l = mindmapLayout(it)
				const rects = l.nodes.map((n) => ({ key: n.key, ...textRect(n) })).map((b) => ({ ...b, x: b.x + it.x, y: b.y + it.y }))
				for (const key of [R, A, B, A1, A2, A3, A4, A5]) {
					const n = st().nodes.find((x) => x.key === key)
					h.pointer('pointerdown', (n.x + n.w / 2) * scale, (n.y + n.h / 2) * scale)
					h.pointer('pointerup', (n.x + n.w / 2) * scale, (n.y + n.h / 2) * scale)
					h.frame()
					assert.equal(st().focus, key, `${layout} focus ${key} at ${scale}`)
					const r = STRUCT_PLUS_PX / 2 / scale
					const plus = h.scene.handles().filter((x) => x.name.startsWith('mm-'))
					assert.ok(plus.length > 0, 'a "+" at ' + key)
					for (const p of plus) {
						const px = p.x / scale
						const py = p.y / scale
						for (const b of rects) {
							if (b.w === 0 || b.h === 0) continue
							const cx = Math.max(b.x, Math.min(px, b.x + b.w))
							const cy = Math.max(b.y, Math.min(py, b.y + b.h))
							assert.ok(Math.hypot(px - cx, py - cy) >= r - 1e-6, `${layout} ${p.name} of ${key} at ${scale} covers the text of ${b.key}`)
						}
					}
				}
				h.key?.('Escape')
			}
			h.restore()
			h = null
		}
	})
})

describe('job 266 risk: old boards', () => {
	test('a map with s, f, m and d lays out, paints and builds in every layout', () => {
		for (const layout of ['both', 'right', 'org', 'tree']) {
			const it = mm([
				[R, { o: 'i0', s: 'pill', c: '#1864ab' }, 'Alt'], [A, { o: 'i0', p: R, s: 'pill', m: [300, -200] }, 'frei'],
				[B, { o: 'i1', p: R, d: 'l', f: true }, 'zu'], [A1, { o: 'i0', p: B, s: 'line' }, 'x'], [C, { o: 'i2', p: R, s: 'rect', c: MM_COLORS[3] }, 'Kasten'],
				[A2, { o: 'i0', p: A }, 'unter frei'],
			], { layout })
			const l = mindmapLayout(it)
			assert.ok(l.w > 0 && l.h > 0 && l.nodes.length === 5, layout)
			const { c } = recorder()
			assert.doesNotThrow(() => paintMindmap(c, l, 0))
			h = setupScene([it])
			assert.doesNotThrow(() => h.frame())
			h.restore()
			h = null
		}
	})
	let h = null
})
