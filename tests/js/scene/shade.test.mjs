/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Note shadow without canvas shadowBlur (src/scene/nodes/shade.js, SPEC-M1
 * §9.5 WP-S4, WebKit fixes of stage 4), in Node with recording contexts and
 * fake Konva nodes:
 * - the falloff is the Gaussian of a canvas shadow with shadowBlur
 *   SHADOW.blur (sigma = blur / 2, peak SHADOW.opacity, half of it on the
 *   moved outline), Φ accurate to 1e-6
 * - the gradients are built once per context (one linear, one radial) and
 *   carry exactly that falloff at their stops
 * - paintShade: four edge bands and four corner quadrants (8 fillRect, each
 *   under save/transform/restore), offset in screen direction also for a
 *   rotated note, never a shadow property of the context, nothing for an
 *   empty box; everything it paints lies inside the index padding of a note
 *   (SceneModel STICKY_PAD = SHADOW.blur · 1.5 + |SHADOW.y|)
 * - the sticky builder: a Shape below the body paints the shadow at LOD 0
 *   (hidden at LOD 1, toggled by setLod, none with shadows: false); the body
 *   itself has no Konva shadow any more; the shadow follows the body's size
 *   and the group's rotation at draw time
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
	SHADE_EXTENT, SHADE_INSET, SHADE_SIGMA, SHADE_STOPS, paintShade, phi, shadeAlpha, shadeOffset,
} from '../../../src/scene/nodes/shade.js'
import { sticky } from '../../../src/scene/nodes/sticky.js'
import { SHADOW, STICKY_RADIUS } from '../../../src/model/tokens.js'

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/** Recording 2D context: calls in order, gradients with their color stops, property sets. */
function recorder() {
	const calls = []
	const gradients = []
	const ctx = { calls, gradients }
	for (const p of ['fillStyle', 'strokeStyle', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'globalAlpha', 'filter']) {
		let v
		Object.defineProperty(ctx, p, { get: () => v, set: (x) => { v = x; calls.push(['set', p, x]) } })
	}
	const gradient = (kind, args) => {
		const g = { kind, args, stops: [], addColorStop(t, c) { this.stops.push([t, c]) } }
		gradients.push(g)
		return g
	}
	ctx.createLinearGradient = (...a) => gradient('linear', a)
	ctx.createRadialGradient = (...a) => gradient('radial', a)
	for (const m of ['save', 'restore', 'transform', 'fillRect', 'beginPath', 'fill', 'stroke']) {
		ctx[m] = (...a) => calls.push([m, ...a, m === 'fillRect' ? ctx.fillStyle : undefined])
	}
	return ctx
}

/**
 * The rectangles a paint filled, in the note frame: each fillRect mapped by
 * the transform in force (the product of the transforms since the matching save).
 *
 * @param {Array} calls recorded calls
 * @return {Array<{x0:number, y0:number, x1:number, y1:number, style:object}>} axis-aligned boxes
 */
function filledBoxes(calls) {
	const stack = []
	let m = [1, 0, 0, 1, 0, 0]
	const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
	const out = []
	for (const c of calls) {
		if (c[0] === 'save') stack.push(m)
		else if (c[0] === 'restore') m = stack.pop()
		else if (c[0] === 'transform') m = mul(m, c.slice(1, 7))
		else if (c[0] === 'fillRect') {
			const [x, y, w, h] = c.slice(1, 5)
			const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]])
			out.push({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])), style: c[5] })
		}
	}
	assert.equal(stack.length, 0, 'save/restore balanced')
	return out
}

describe('falloff', () => {
	test('Φ against reference values (1e-6) and symmetric', () => {
		for (const [z, v] of [[0, 0.5], [1, 0.8413447461], [-1, 0.1586552539], [2, 0.9772498681], [-3, 0.0013498980], [0.5, 0.6914624613]]) {
			assert.ok(near(phi(z), v, 1e-6), `Φ(${z}) = ${phi(z)}`)
			assert.ok(near(phi(z) + phi(-z), 1, 1e-7))
		}
	})

	test('a canvas shadow with shadowBlur SHADOW.blur: sigma = blur / 2, peak SHADOW.opacity, half of it on the outline', () => {
		assert.equal(SHADE_SIGMA, SHADOW.blur / 2)
		assert.ok(near(shadeAlpha(0), SHADOW.opacity / 2, 1e-7))
		assert.ok(near(shadeAlpha(-SHADE_SIGMA), SHADOW.opacity * 0.8413447461, 1e-7))
		assert.ok(shadeAlpha(-100) <= SHADOW.opacity && shadeAlpha(-100) > SHADOW.opacity * 0.9999)
		assert.ok(shadeAlpha(SHADE_EXTENT) < 0.0004, 'nothing visible left at the outer reach')
		for (let d = -SHADE_INSET; d < SHADE_EXTENT; d += 0.25) assert.ok(shadeAlpha(d) > shadeAlpha(d + 0.25), `falls at ${d}`)
	})

	test('reach: 3 sigma beyond the moved outline, inside the index padding of a note', () => {
		assert.equal(SHADE_EXTENT, 3 * SHADE_SIGMA)
		assert.equal(SHADE_INSET, Math.hypot(SHADOW.x, SHADOW.y) + 1)
		const pad = SHADOW.blur * 1.5 + Math.abs(SHADOW.y) // SceneModel STICKY_PAD
		assert.ok(SHADE_EXTENT + Math.hypot(SHADOW.x, SHADOW.y) <= pad)
	})

	test('offset in screen direction: (SHADOW.x, SHADOW.y) unrotated, turned back by the note rotation', () => {
		assert.deepEqual(shadeOffset(0), { x: SHADOW.x, y: SHADOW.y })
		const r90 = shadeOffset(90)
		assert.ok(near(r90.x, SHADOW.y, 1e-12) && near(r90.y, -SHADOW.x, 1e-12), JSON.stringify(r90))
		const r180 = shadeOffset(180)
		assert.ok(near(r180.x, -SHADOW.x, 1e-12) && near(r180.y, -SHADOW.y, 1e-12))
		// screen = R(θ) · local: turning the local offset by the rotation gives the screen offset back
		for (const deg of [17, 45, 200, -30]) {
			const o = shadeOffset(deg)
			const t = deg * Math.PI / 180
			assert.ok(near(o.x * Math.cos(t) - o.y * Math.sin(t), SHADOW.x, 1e-12) && near(o.x * Math.sin(t) + o.y * Math.cos(t), SHADOW.y, 1e-12), String(deg))
		}
	})
})

describe('paintShade', () => {
	test('gradients once per context, with the falloff at every stop; a second context builds its own', () => {
		const c = recorder()
		paintShade(c, 200, 100, 0)
		paintShade(c, 300, 300, 0)
		assert.equal(c.gradients.length, 2, 'one linear + one radial gradient for any number of notes')
		const [band, corner] = c.gradients
		assert.deepEqual([band.kind, band.args], ['linear', [0, -SHADE_INSET, 0, SHADE_EXTENT]])
		assert.deepEqual([corner.kind, corner.args], ['radial', [0, 0, 0, 0, 0, STICKY_RADIUS + SHADE_EXTENT]])
		assert.equal(band.stops.length, SHADE_STOPS)
		assert.equal(corner.stops.length, SHADE_STOPS)
		const alphaOf = (s) => Number(/^rgba\(0,0,0,([0-9.]+)\)$/.exec(s)[1])
		band.stops.forEach(([t, s], i) => {
			assert.ok(near(t, i / (SHADE_STOPS - 1)))
			assert.ok(near(alphaOf(s), shadeAlpha(-SHADE_INSET + t * (SHADE_INSET + SHADE_EXTENT)), 5e-5), `band stop ${i}`)
		})
		corner.stops.forEach(([t, s], i) => {
			assert.ok(near(alphaOf(s), shadeAlpha(t * (STICKY_RADIUS + SHADE_EXTENT) - STICKY_RADIUS), 5e-5), `corner stop ${i}`)
		})
		const other = recorder()
		paintShade(other, 200, 100, 0)
		assert.equal(other.gradients.length, 2)
	})

	test('eight fillRects: four bands along the moved outline, four corner quadrants; no shadow property, no path', () => {
		const c = recorder()
		const w = 200
		const h = 100
		paintShade(c, w, h, 0)
		const R = STICKY_RADIUS
		const ox = SHADOW.x
		const oy = SHADOW.y
		const E = SHADE_EXTENT
		const I = SHADE_INSET
		assert.ok(!c.calls.some((x) => x[0] === 'set' && /^shadow|^filter$|^globalAlpha$/.test(x[1])), 'never a canvas shadow')
		assert.ok(!c.calls.some((x) => ['beginPath', 'fill', 'stroke'].includes(x[0])), 'fillRect only')
		const boxes = filledBoxes(c.calls)
		assert.equal(boxes.length, 8)
		const [band, corner] = c.gradients
		const round = (b) => [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v * 1e9) / 1e9)
		assert.deepEqual(boxes.slice(0, 4).map(round), [
			[ox + R, oy + h - I, ox + w - R, oy + h + E], // bottom
			[ox + R, oy - E, ox + w - R, oy + I], // top
			[ox + w - I, oy + R, ox + w + E, oy + h - R], // right
			[ox - E, oy + R, ox + I, oy + h - R], // left
		])
		assert.ok(boxes.slice(0, 4).every((b) => b.style === band))
		assert.deepEqual(boxes.slice(4).map(round), [
			[ox + R - R - E, oy + R - R - E, ox + R, oy + R],
			[ox + w - R, oy - E, ox + w + E, oy + R],
			[ox + w - R, oy + h - R, ox + w + E, oy + h + E],
			[ox - E, oy + h - R, ox + R, oy + h + E],
		])
		assert.ok(boxes.slice(4).every((b) => b.style === corner))
		// the bands run outward: the gradient's +y is the outward normal of each edge
		const tr = c.calls.filter((x) => x[0] === 'transform').map((x) => x.slice(1, 5))
		assert.deepEqual(tr.slice(0, 4), [[1, 0, 0, 1], [1, 0, 0, -1], [0, 1, 1, 0], [0, 1, -1, 0]])
		assert.deepEqual(tr.slice(4), [[-1, 0, 0, -1], [1, 0, 0, -1], [1, 0, 0, 1], [-1, 0, 0, 1]])
	})

	test('everything painted lies inside the index padding of the note, rotated or not', () => {
		const pad = SHADOW.blur * 1.5 + Math.abs(SHADOW.y)
		for (const [w, h, rot] of [[200, 100, 0], [300, 300, 90], [50, 120, 33], [10, 10, 180]]) {
			const c = recorder()
			paintShade(c, w, h, rot)
			const boxes = filledBoxes(c.calls)
			assert.equal(boxes.length, 8)
			for (const b of boxes) {
				assert.ok(b.x0 >= -pad - 1e-9 && b.y0 >= -pad - 1e-9 && b.x1 <= w + pad + 1e-9 && b.y1 <= h + pad + 1e-9, `${w}×${h}@${rot}: ${JSON.stringify(b)}`)
			}
		}
	})

	test('rotated note: the bands follow the offset turned into the note frame', () => {
		const c = recorder()
		paintShade(c, 200, 100, 90)
		const o = shadeOffset(90)
		const first = c.calls.find((x) => x[0] === 'transform')
		assert.ok(near(first[5], o.x + STICKY_RADIUS, 1e-12) && near(first[6], o.y + 100, 1e-12), JSON.stringify(first))
	})

	test('an empty or invalid box paints nothing; a box smaller than two radii keeps its corners', () => {
		for (const [w, h] of [[0, 100], [100, 0], [-5, 10], [Number.NaN, 10]]) {
			const c = recorder()
			paintShade(c, w, h, 0)
			assert.equal(c.calls.length, 0, `${w}×${h}`)
		}
		const c = recorder()
		paintShade(c, 4, 4, 0)
		assert.equal(filledBoxes(c.calls).length, 4, 'corners only: no straight edge left')
	})
})

// ---------------------------------------------------------------- the sticky builder
class FakeNode {
	constructor(attrs = {}) {
		this.attrs = { ...attrs }
		this.children = []
		this.kind = this.constructor.name
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
	rotation() { return this.attrs.rotation ?? 0 }
	transformsEnabled(v) { this.attrs.transformsEnabled = v }
	add(...c) { this.children.push(...c) }
	destroy() {}
}
class Group extends FakeNode {}
class Rect extends FakeNode {}
class Text extends FakeNode {}
class Shape extends FakeNode {}
class Line extends FakeNode {}
const note = (o = {}) => ({ id: '01JS' + '0'.repeat(22), t: 'sticky', x: 10, y: 20, w: 200, h: 100, r: 0, data: { text: 'Idee' }, style: { fill: '#a8d8f8' }, ...o })
const absOf = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: it.r })

describe('sticky node with the shadow Shape', () => {
	const ctx = { Group, Rect, Text, Shape, Line, shadows: true }

	test('LOD 0: shade (Shape) below the body, then the text; the body has no Konva shadow', () => {
		const it = note()
		const e = sticky.build(ctx, it, absOf(it), 0)
		assert.deepEqual(e.root.children.map((n) => n.kind), ['Shape', 'Rect', 'Text'])
		assert.equal(e.parts.shade, e.root.children[0])
		assert.equal(e.parts.body, e.root.children[1])
		assert.equal(e.parts.shade.visible(), true)
		assert.equal(e.parts.shade.attrs.listening, false)
		assert.equal(e.parts.shade.attrs.perfectDrawEnabled, false)
		assert.equal(e.parts.shade.attrs.transformsEnabled, 'position')
		for (const k of ['shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'shadowOpacity', 'shadowEnabled']) {
			assert.equal(k in e.parts.body.attrs, false, k)
		}
	})

	test('LOD 1 builds the shade hidden; setLod toggles it with the text', () => {
		const it = note()
		const e = sticky.build(ctx, it, absOf(it), 1)
		assert.equal(e.parts.shade.visible(), false)
		sticky.setLod(ctx, e, it, absOf(it), 0)
		assert.equal(e.parts.shade.visible(), true)
		sticky.setLod(ctx, e, it, absOf(it), 1)
		assert.equal(e.parts.shade.visible(), false)
	})

	test('shadows: false → no shade at all (and setLod copes)', () => {
		const it = note()
		const off = { ...ctx, shadows: false }
		const e = sticky.build(off, it, absOf(it), 0)
		assert.equal(e.parts.shade, null)
		assert.deepEqual(e.root.children.map((n) => n.kind), ['Rect', 'Text'])
		sticky.setLod(off, e, it, absOf(it), 1)
		sticky.setLod(off, e, it, absOf(it), 0)
	})

	test('the sceneFunc paints with the body size and the group rotation of the moment', () => {
		const it = note()
		const e = sticky.build(ctx, it, absOf(it), 0)
		const paint = () => {
			const c = recorder()
			e.parts.shade.attrs.sceneFunc(c, e.parts.shade)
			return filledBoxes(c.calls)
		}
		const bottom = (b) => [b[0].x1 - b[0].x0, b[0].y1]
		assert.deepEqual(bottom(paint()), [200 - 2 * STICKY_RADIUS, SHADOW.y + 100 + SHADE_EXTENT])
		sticky.update(ctx, e, { ...it, w: 300, h: 150 }, { ...absOf(it), w: 300, h: 150 }, new Set(['geom']))
		assert.deepEqual(bottom(paint()), [300 - 2 * STICKY_RADIUS, SHADOW.y + 150 + SHADE_EXTENT])
		e.root.setAttrs({ rotation: 90 })
		const c = recorder()
		e.parts.shade.attrs.sceneFunc(c, e.parts.shade)
		const first = c.calls.find((x) => x[0] === 'transform')
		assert.ok(near(first[5], shadeOffset(90).x + STICKY_RADIUS, 1e-12), 'offset turned with the group')
	})
})
