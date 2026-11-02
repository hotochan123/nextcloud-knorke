/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Note shadows without canvas shadowBlur (src/scene/nodes/shade.js, SPEC-M1
 * §9.5 WP-S4, WebKit fixes of stage 4; job 259: two shadows and the dog
 * ear), in Node with recording contexts and fake Konva nodes:
 * - NOTE_SHADOWS: far 0/5/14 at 9 %, near 0/1/2 at 10 % (job 259 AK1)
 * - the falloff is the Gaussian of a canvas shadow with shadowBlur s.blur
 *   (sigma = blur / 2, peak s.opacity, half of it on the moved outline)
 * - the gradients are built once per context and shadow (2 × 2) and carry
 *   exactly that falloff at their stops
 * - paintShade: per shadow four edge bands and four corner quadrants (8
 *   fillRect, each under save/transform/restore), offset in screen
 *   direction also for a rotated note, never a shadow property of the
 *   context, nothing for an empty box; everything it paints lies inside the
 *   index padding of a note (SceneModel STICKY_PAD = 26)
 * - with a dog ear: no shadow inside the cut corner, the falloff along the
 *   cut edge as along any other edge, the other edges unchanged
 * - the sticky builder: a Shape below the body paints the shadows at LOD 0
 *   (hidden at LOD 1, toggled by setLod, none with shadows: false); the body
 *   has no Konva shadow; the shadow follows the body's size and the group's
 *   rotation at draw time
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
	SHADE_REACH, SHADE_STOPS, paintShade, paintShadeLayer, phi, shadeAlpha, shadeExtent, shadeInset, shadeOffset, shadeSigma,
} from '../../../src/scene/nodes/shade.js'
import { sticky } from '../../../src/scene/nodes/sticky.js'
import { NOTE_SHADOWS, STICKY_RADIUS, noteEar } from '../../../src/model/tokens.js'
import { STICKY_PAD } from '../../../src/model/SceneModel.js'

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const [FAR, NEAR] = NOTE_SHADOWS

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
	for (const m of ['save', 'restore', 'transform', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'fill', 'stroke', 'arcTo']) {
		ctx[m] = (...a) => calls.push([m, ...a, m === 'fillRect' ? ctx.fillStyle : undefined])
	}
	return ctx
}

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
	a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
const apply = (m, [u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]
const invert = (m) => {
	const det = m[0] * m[3] - m[1] * m[2]
	const a = m[3] / det; const b = -m[1] / det; const c = -m[2] / det; const d = m[0] / det
	return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/**
 * The pieces a paint filled, in the note frame: each fillRect with the
 * transform in force (the product of the transforms since the matching
 * save) and the clip polygons in force.
 *
 * @param {Array} calls recorded calls
 * @return {Array<{x0:number, y0:number, x1:number, y1:number, style:object, m:number[], rect:number[], clips:Array}>}
 */
function pieces(calls) {
	const stack = []
	let st = { m: [1, 0, 0, 1, 0, 0], clips: [] }
	let path = []
	const out = []
	for (const c of calls) {
		if (c[0] === 'save') stack.push(st)
		else if (c[0] === 'restore') st = stack.pop()
		else if (c[0] === 'transform') st = { ...st, m: mul(st.m, c.slice(1, 7)) }
		else if (c[0] === 'beginPath') path = []
		else if (c[0] === 'moveTo' || c[0] === 'lineTo') path.push(apply(st.m, c.slice(1, 3)))
		else if (c[0] === 'clip') st = { ...st, clips: [...st.clips, path] }
		else if (c[0] === 'fillRect') {
			const [x, y, w, h] = c.slice(1, 5)
			const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map((q) => apply(st.m, q))
			out.push({
				x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])),
				style: c[5], m: st.m, rect: [x, y, w, h], clips: st.clips,
			})
		}
	}
	assert.equal(stack.length, 0, 'save/restore balanced')
	return out
}

/** @return {boolean} p inside the convex polygon (either winding) */
function inPoly(poly, p) {
	let sign = 0
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i]
		const b = poly[(i + 1) % poly.length]
		const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
		if (Math.abs(cr) < 1e-12) continue
		if (sign === 0) sign = Math.sign(cr)
		else if (Math.sign(cr) !== sign) return false
	}
	return true
}

/**
 * Alpha a paint leaves at a point of the note frame (the pieces' alphas
 * added, the gradients read as their falloff: band by the piece frame's y,
 * corner by ρ − STICKY_RADIUS), per shadow from the gradient that painted it.
 */
function alphaAt(c, p) {
	const which = new Map()
	NOTE_SHADOWS.forEach((s, i) => { which.set(c.gradients[2 * i], s); which.set(c.gradients[2 * i + 1], s) })
	let sum = 0
	for (const q of pieces(c.calls)) {
		const [u, v] = apply(invert(q.m), p)
		const [x, y, w, h] = q.rect
		if (u < x || u > x + w || v < y || v > y + h) continue
		if (!q.clips.every((poly) => inPoly(poly, p))) continue
		const s = which.get(q.style)
		const inset = shadeInset(s)
		const ext = shadeExtent(s)
		if (q.style.kind === 'linear') sum += shadeAlpha(Math.max(-inset, Math.min(ext, v)), s)
		else sum += shadeAlpha(Math.min(Math.hypot(u, v), STICKY_RADIUS + ext) - STICKY_RADIUS, s)
	}
	return sum
}

describe('falloff', () => {
	test('job 259 AK1: two shadows, far 0/5/14 at 9 % then near 0/1/2 at 10 %; the index padding is 26', () => {
		assert.deepEqual(NOTE_SHADOWS.map((s) => ({ ...s })), [{ x: 0, y: 5, blur: 14, opacity: 0.09 }, { x: 0, y: 1, blur: 2, opacity: 0.10 }])
		assert.equal(STICKY_PAD, 26)
		assert.equal(SHADE_REACH, 26)
	})

	test('Φ against reference values (1e-6) and symmetric', () => {
		for (const [z, v] of [[0, 0.5], [1, 0.8413447461], [-1, 0.1586552539], [2, 0.9772498681], [-3, 0.0013498980], [0.5, 0.6914624613]]) {
			assert.ok(near(phi(z), v, 1e-6), `Φ(${z}) = ${phi(z)}`)
			assert.ok(near(phi(z) + phi(-z), 1, 1e-7))
		}
	})

	test('a canvas shadow with shadowBlur s.blur: sigma = blur / 2, peak s.opacity, half of it on the outline', () => {
		for (const s of NOTE_SHADOWS) {
			assert.equal(shadeSigma(s), s.blur / 2)
			assert.ok(near(shadeAlpha(0, s), s.opacity / 2, 1e-7))
			assert.ok(near(shadeAlpha(-shadeSigma(s), s), s.opacity * 0.8413447461, 1e-7))
			assert.ok(shadeAlpha(-100, s) <= s.opacity && shadeAlpha(-100, s) > s.opacity * 0.9999)
			assert.ok(shadeAlpha(shadeExtent(s), s) < 0.0004, 'nothing visible left at the outer reach')
			for (let d = -shadeInset(s); d < shadeExtent(s); d += 0.25) assert.ok(shadeAlpha(d, s) > shadeAlpha(d + 0.25, s), `falls at ${d}`)
		}
	})

	test('reach: 3 sigma beyond the moved outline, inside the index padding of a note', () => {
		for (const s of NOTE_SHADOWS) {
			assert.equal(shadeExtent(s), 3 * shadeSigma(s))
			assert.equal(shadeInset(s), Math.hypot(s.x, s.y) + 1)
			assert.ok(shadeExtent(s) + Math.hypot(s.x, s.y) <= STICKY_PAD)
		}
	})

	test('offset in screen direction: (s.x, s.y) unrotated, turned back by the note rotation', () => {
		const s = FAR
		assert.deepEqual(shadeOffset(0, s), { x: s.x, y: s.y })
		const r90 = shadeOffset(90, s)
		assert.ok(near(r90.x, s.y, 1e-12) && near(r90.y, -s.x, 1e-12), JSON.stringify(r90))
		for (const deg of [17, 45, 200, -30]) {
			const o = shadeOffset(deg, s)
			const t = deg * Math.PI / 180
			assert.ok(near(o.x * Math.cos(t) - o.y * Math.sin(t), s.x, 1e-12) && near(o.x * Math.sin(t) + o.y * Math.cos(t), s.y, 1e-12), String(deg))
		}
	})
})

describe('paintShade', () => {
	test('gradients once per context and shadow, with the falloff at every stop; a second context builds its own', () => {
		const c = recorder()
		paintShade(c, 200, 100, 0)
		paintShade(c, 300, 300, 0, 26)
		assert.equal(c.gradients.length, 4, 'per shadow one linear + one radial gradient for any number of notes')
		const alphaOf = (x) => Number(/^rgba\(0,0,0,([0-9.]+)\)$/.exec(x)[1])
		NOTE_SHADOWS.forEach((s, i) => {
			const [band, corner] = c.gradients.slice(2 * i, 2 * i + 2)
			assert.deepEqual([band.kind, band.args], ['linear', [0, -shadeInset(s), 0, shadeExtent(s)]])
			assert.deepEqual([corner.kind, corner.args], ['radial', [0, 0, 0, 0, 0, STICKY_RADIUS + shadeExtent(s)]])
			assert.equal(band.stops.length, SHADE_STOPS)
			band.stops.forEach(([t, x], k) => {
				assert.ok(near(t, k / (SHADE_STOPS - 1)))
				assert.ok(near(alphaOf(x), shadeAlpha(-shadeInset(s) + t * (shadeInset(s) + shadeExtent(s)), s), 5e-5), `band stop ${k}`)
			})
			corner.stops.forEach(([t, x], k) => {
				assert.ok(near(alphaOf(x), shadeAlpha(t * (STICKY_RADIUS + shadeExtent(s)) - STICKY_RADIUS, s), 5e-5), `corner stop ${k}`)
			})
		})
		const other = recorder()
		paintShade(other, 200, 100, 0)
		assert.equal(other.gradients.length, 4)
	})

	test('per shadow eight fillRects: four bands along the moved outline, four corner quadrants; no shadow property, no path', () => {
		const c = recorder()
		const w = 200
		const h = 100
		paintShade(c, w, h, 0)
		assert.ok(!c.calls.some((x) => x[0] === 'set' && /^shadow|^filter$|^globalAlpha$/.test(x[1])), 'never a canvas shadow')
		assert.ok(!c.calls.some((x) => ['beginPath', 'fill', 'stroke', 'clip'].includes(x[0])), 'fillRect only')
		const all = pieces(c.calls)
		assert.equal(all.length, 16)
		const R = STICKY_RADIUS
		const round = (b) => [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v * 1e9) / 1e9)
		NOTE_SHADOWS.forEach((s, i) => {
			const boxes = all.slice(8 * i, 8 * i + 8)
			const [ox, oy, E, I] = [s.x, s.y, shadeExtent(s), shadeInset(s)]
			assert.deepEqual(boxes.slice(0, 4).map(round), [
				[ox + R, oy + h - I, ox + w - R, oy + h + E],
				[ox + R, oy - E, ox + w - R, oy + I],
				[ox + w - I, oy + R, ox + w + E, oy + h - R],
				[ox - E, oy + R, ox + I, oy + h - R],
			])
			assert.ok(boxes.slice(0, 4).every((b) => b.style === c.gradients[2 * i]))
			assert.ok(boxes.slice(4).every((b) => b.style === c.gradients[2 * i + 1]))
		})
	})

	test('everything painted lies inside the index padding of the note, rotated or not, with or without an ear', () => {
		for (const [w, h, rot] of [[200, 100, 0], [300, 300, 90], [50, 120, 33], [20, 20, 180], [200, 200, 30]]) {
			for (const ear of [0, noteEar(w, h)]) {
				const c = recorder()
				paintShade(c, w, h, rot, ear)
				for (const b of pieces(c.calls)) {
					// a clipped band may reach further than its clip: the clip keeps it inside
					const box = b.clips.length ? clipBox(b) : b
					assert.ok(box.x0 >= -STICKY_PAD - 1e-9 && box.y0 >= -STICKY_PAD - 1e-9 && box.x1 <= w + STICKY_PAD + 1e-9 && box.y1 <= h + STICKY_PAD + 1e-9, `${w}×${h}@${rot} ear ${ear}: ${JSON.stringify(box)}`)
				}
			}
		}
	})

	test('rotated note: the bands follow the offset turned into the note frame', () => {
		const c = recorder()
		paintShade(c, 200, 100, 90)
		const o = shadeOffset(90, FAR)
		const first = c.calls.find((x) => x[0] === 'transform')
		assert.ok(near(first[5], o.x + STICKY_RADIUS, 1e-12) && near(first[6], o.y + 100, 1e-12), JSON.stringify(first))
	})

	test('an empty or invalid box paints nothing; a box smaller than two radii keeps its corners', () => {
		for (const [w, h] of [[0, 100], [100, 0], [-5, 10], [Number.NaN, 10]]) {
			const c = recorder()
			paintShade(c, w, h, 0, 26)
			assert.equal(c.calls.length, 0, `${w}×${h}`)
		}
		const c = recorder()
		paintShade(c, 4, 4, 0)
		assert.equal(pieces(c.calls).length, 8, 'corners only: no straight edge left')
	})
})

/** The box of a clipped piece: its rectangle's corners and its clips' corners, sampled on a grid inside both. */
function clipBox(b) {
	let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
	const inv = invert(b.m)
	const [x, y, w, h] = b.rect
	for (let i = 0; i <= 60; i++) {
		for (let j = 0; j <= 60; j++) {
			const p = apply(b.m, [x + w * i / 60, y + h * j / 60])
			if (!b.clips.every((poly) => inPoly(poly, p))) continue
			void inv
			x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1])
		}
	}
	return { x0, y0, x1, y1 }
}

describe('job 259: the dog ear', () => {
	const W = 200
	const E = 26

	test('no corner quadrant at the bottom right; a band along the cut, clipped at the bisectors', () => {
		const c = recorder()
		paintShadeLayer(c, W, W, 0, FAR, E)
		const all = pieces(c.calls)
		assert.equal(all.length, 8, 'four bands, the cut band, three corners')
		assert.equal(all.filter((p) => p.clips.length > 0).length, 3, 'bottom, right and cut band clipped')
		assert.ok(!c.calls.some((x) => x[0] === 'set' && /^shadow/.test(x[1])))
	})

	test('AK1: in the cut corner no shadow of the full corner; along the cut the falloff of any edge', () => {
		const plain = recorder()
		paintShade(plain, W, W, 0)
		const ear = recorder()
		paintShade(ear, W, W, 0, E)
		// deep in the cut corner: the full corner would leave its inner band there
		assert.ok(alphaAt(plain, [199, 199]) > 0.05, 'without the ear the corner is shaded')
		assert.ok(alphaAt(ear, [199, 199]) < 0.01, `with the ear: ${alphaAt(ear, [199, 199])}`)
		// 3 units outside the middle of the cut edge (x + y = 374): each shadow by its moved line
		const d = 3
		const p = [187 + d * Math.SQRT1_2, 187 + d * Math.SQRT1_2]
		const want = NOTE_SHADOWS.reduce((a, s) => a + shadeAlpha(d - (s.x + s.y) * Math.SQRT1_2, s), 0)
		assert.ok(near(alphaAt(ear, p), want, 1e-9), `${alphaAt(ear, p)} vs ${want}`)
		// the other edges as without the ear
		for (const q of [[100, 205], [205, 100], [-3, 100], [100, -3], [160, 203]]) {
			assert.ok(near(alphaAt(ear, q), alphaAt(plain, q), 1e-9), `${q}: ${alphaAt(ear, q)} vs ${alphaAt(plain, q)}`)
		}
		// beyond the ends of the cut the shadow goes on, no gap, no doubling
		for (const q of [[176, 208], [208, 176], [180, 206], [206, 180]]) {
			const a = alphaAt(ear, q)
			assert.ok(a > 0 && a <= FAR.opacity + NEAR.opacity, `${q}: ${a}`)
		}
		// no seam where the bands meet: small steps change the alpha only a little
		for (const line of [(t) => [t, 203], (t) => [203, t], (t) => [t, 210], (t) => [210, t]]) {
			let prev = alphaAt(ear, line(150))
			for (let t = 150.5; t <= 215; t += 0.5) {
				const a = alphaAt(ear, line(t))
				assert.ok(Math.abs(a - prev) < 0.006, `${line(t)}: ${prev} → ${a}`)
				prev = a
			}
		}
	})

	test('a 20 × 20 note keeps a valid ear (5), a rotated one too', () => {
		assert.equal(noteEar(20, 20), 5)
		assert.equal(noteEar(60, 200), 15)
		assert.equal(noteEar(200, 200), 26)
		assert.equal(noteEar(0, 200), 0)
		for (const rot of [0, 30]) {
			const c = recorder()
			paintShade(c, 20, 20, rot, 5)
			assert.ok(pieces(c.calls).length > 0)
		}
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

	test('LOD 0: shade below the body, the flap, then the text; the body has no Konva shadow', () => {
		const it = note()
		const e = sticky.build(ctx, it, absOf(it), 0)
		assert.deepEqual(e.root.children.map((n) => n.kind), ['Shape', 'Shape', 'Shape', 'Text'])
		assert.equal(e.parts.shade, e.root.children[0])
		assert.equal(e.parts.body, e.root.children[1])
		assert.equal(e.parts.ear, e.root.children[2])
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
		assert.deepEqual(e.root.children.map((n) => n.kind), ['Shape', 'Shape', 'Text'])
		sticky.setLod(off, e, it, absOf(it), 1)
		sticky.setLod(off, e, it, absOf(it), 0)
	})

	test('the sceneFunc paints with the body size, its ear and the group rotation of the moment', () => {
		const it = note()
		const e = sticky.build(ctx, it, absOf(it), 0)
		const paint = () => {
			const c = recorder()
			e.parts.shade.attrs.sceneFunc(c, e.parts.shade)
			return pieces(c.calls)
		}
		const R = STICKY_RADIUS
		const across = shadeInset(FAR) + shadeExtent(FAR)
		// the far shadow's bottom band runs to the cut (ear 25 of a 200 × 100 note) and on into its clip
		const bottom = (b) => [b[0].x1 - b[0].x0, b[0].y1]
		assert.deepEqual(bottom(paint()), [200 - noteEar(200, 100) - R + across, FAR.y + 100 + shadeExtent(FAR)])
		sticky.update(ctx, e, { ...it, w: 300, h: 150 }, { ...absOf(it), w: 300, h: 150 }, new Set(['geom']))
		assert.deepEqual(bottom(paint()), [300 - noteEar(300, 150) - R + across, FAR.y + 150 + shadeExtent(FAR)])
		e.root.setAttrs({ rotation: 90 })
		const c = recorder()
		e.parts.shade.attrs.sceneFunc(c, e.parts.shade)
		const first = c.calls.find((x) => x[0] === 'transform')
		assert.ok(near(first[5], shadeOffset(90, FAR).x + STICKY_RADIUS, 1e-12), 'offset turned with the group')
	})
})
