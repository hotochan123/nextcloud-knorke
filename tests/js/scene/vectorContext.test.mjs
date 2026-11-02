/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 200 (AK3): the recording 2D context of "Save as SVG" and
 * "Save as PDF" (src/scene/vectorContext.js):
 * - paths in device space under nested save/restore transforms; a later
 *   setTransform changes only the stroke (Konva's strokeScaleEnabled false)
 * - arc, arcTo, ellipse and roundRect as Béziers (points on the curve within
 *   0.01 units)
 * - clip chains, dashes, globalAlpha, colour parsing, invalid values ignored
 * - gradients keep their stops and the matrix at fill time
 * - text at its left alphabetic baseline (textAlign, textBaseline)
 * - the real painting of note shadows, reaction rows and vote badges runs
 *   into it; patterns, image data and Path2D throw, there is no drawImage
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VectorContext, parseColor, parseFont, multiply, invert } from '../../../src/scene/vectorContext.js'
import { paintShade } from '../../../src/scene/nodes/shade.js'
import { paintReactions } from '../../../src/scene/nodes/reactions.js'
import { paintBadges } from '../../../src/scene/nodes/badges.js'

/** A measure: 10 units per character, textBaseline middle shifts down by 7. */
const measure = (font, text, baseline = 'alphabetic') => ({ width: 10 * [...text].length, shift: baseline === 'middle' ? 7 : baseline === 'top' ? 18 : 0 })
const ctx = () => new VectorContext({ measure })
const paths = (c) => c.ops.filter((o) => o.op === 'path')
/** (job 203) a 1 × 1 PNG */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * @param {Array} seg a cubic ['C', …] from p0
 * @param {number[]} p0 start
 * @param {number} t parameter
 * @return {number[]} the point at t
 */
function bez(p0, seg, t) {
	const [x1, y1, x2, y2, x, y] = seg.slice(1)
	const u = 1 - t
	return [
		u * u * u * p0[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
		u * u * u * p0[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
	]
}

/**
 * Every Bézier point of a path at t = 0, ¼, ½, ¾, 1, with the point before it.
 *
 * @param {Array} d path
 * @return {number[][]} the points
 */
function samples(d) {
	const out = []
	let cur = null
	for (const s of d) {
		if (s[0] === 'M' || s[0] === 'L') cur = [s[1], s[2]]
		else if (s[0] === 'C') {
			for (const t of [0.25, 0.5, 0.75]) out.push(bez(cur, s, t))
			cur = [s[5], s[6]]
		}
	}
	return out
}

test('AK3 paths in device space: nested save/restore, transform, translate, scale, rotate', () => {
	const c = ctx()
	c.save()
	c.translate(100, 50)
	c.scale(2, 2)
	c.beginPath()
	c.moveTo(0, 0)
	c.lineTo(10, 0)
	c.save()
	c.rotate(Math.PI / 2)
	c.lineTo(10, 0)
	c.restore()
	c.lineTo(10, 10)
	c.closePath()
	c.fillStyle = '#ff0000'
	c.fill()
	c.restore()
	assert.deepEqual(c.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 'restored')
	const [p] = paths(c)
	const round = (s) => s.map((v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))
	assert.deepEqual(p.d.map(round), [['M', 100, 50], ['L', 120, 50], ['L', 100, 70], ['L', 120, 70], ['Z']])
	assert.deepEqual(p.fill, { kind: 'color', rgb: [255, 0, 0], a: 1 })
	assert.equal(p.stroke, null)
	assert.deepEqual(p.clip, [])
	assert.deepEqual(multiply([2, 0, 0, 2, 5, 5], invert([2, 0, 0, 2, 5, 5])), [1, 0, 0, 1, 0, 0])
	assert.equal(invert([0, 0, 0, 0, 1, 1]), null)
})

test('AK3 a stroke after setTransform (strokeScaleEnabled false) keeps the path, its width follows the transform at stroke time', () => {
	const c = ctx()
	c.scale(4, 4)
	c.beginPath()
	c.rect(0, 0, 10, 10)
	c.save()
	c.setTransform(1, 0, 0, 1, 0, 0)
	c.lineWidth = 2
	c.setLineDash([3])
	c.strokeStyle = '#000'
	c.stroke()
	c.restore()
	c.lineWidth = 2
	c.stroke()
	const [a, b] = paths(c)
	assert.deepEqual(a.d.slice(0, 3), [['M', 0, 0], ['L', 40, 0], ['L', 40, 40]], 'the path stays where it was built')
	assert.equal(a.stroke.width, 2, 'width at identity')
	assert.deepEqual(a.stroke.dash, [3, 3], 'an odd dash list is doubled')
	assert.equal(b.stroke.width, 8, 'width under scale 4')
	assert.deepEqual(b.stroke.dash, [], 'the dash came back with restore')
	assert.equal(a.d.at(-1)[0], 'Z', 'no moveTo nothing is drawn from')
})

test('AK3 arc, arcTo, ellipse and roundRect are Béziers whose points lie on the curve (< 0.01)', () => {
	const c = ctx()
	c.fillStyle = '#000'
	c.beginPath()
	c.arc(50, 60, 40, 0.3, 4.2)
	c.fill()
	const [arc] = paths(c)
	assert.equal(arc.d[0][0], 'M')
	assert.ok(arc.d.filter((s) => s[0] === 'C').length >= 3, 'pieces of at most 90°')
	for (const [x, y] of samples(arc.d)) assert.ok(Math.abs(Math.hypot(x - 50, y - 60) - 40) < 0.01, `${x},${y}`)
	const end = arc.d.at(-1)
	assert.ok(Math.abs(end[5] - (50 + 40 * Math.cos(4.2))) < 1e-9 && Math.abs(end[6] - (60 + 40 * Math.sin(4.2))) < 1e-9)

	c.beginPath()
	c.arc(0, 0, 10, 0, Math.PI / 2, true)
	c.fill()
	const ccw = paths(c)[1]
	const last = ccw.d.at(-1)
	assert.ok(Math.abs(last[5]) < 1e-9 && Math.abs(last[6] - 10) < 1e-9, 'anticlockwise ends at 90°')
	assert.equal(ccw.d.filter((s) => s[0] === 'C').length, 3, '270° anticlockwise: three pieces')

	c.beginPath()
	c.moveTo(0, 0)
	c.arcTo(100, 0, 100, 100, 20)
	c.lineTo(100, 100)
	c.fill()
	const to = paths(c)[2]
	assert.deepEqual(to.d[1].map((v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)), ['L', 80, 0], 'a line to the tangent point')
	for (const [x, y] of samples(to.d)) assert.ok(Math.abs(Math.hypot(x - 80, y - 20) - 20) < 0.01)

	c.beginPath()
	c.ellipse(10, 20, 30, 10, Math.PI / 6, 0, 2 * Math.PI)
	c.fill()
	const el = paths(c)[3]
	const cos = Math.cos(-Math.PI / 6)
	const sin = Math.sin(-Math.PI / 6)
	for (const [x, y] of samples(el.d)) {
		const u = (x - 10) * cos - (y - 20) * sin
		const v = (x - 10) * sin + (y - 20) * cos
		assert.ok(Math.abs((u / 30) ** 2 + (v / 10) ** 2 - 1) < 0.002, `${u},${v}`)
	}

	c.beginPath()
	c.roundRect(0, 0, 100, 50, [10, 0, 30])
	c.fill()
	const rr = paths(c)[4]
	assert.deepEqual(rr.d[0], ['M', 10, 0])
	assert.equal(rr.d.filter((s) => s[0] === 'C').length, 2, 'three radii: top-left, top-right and bottom-left, bottom-right: tl and br round')
	assert.ok(rr.d.some((s) => s[0] === 'L' && s[1] === 100 && s[2] === 0), 'top-right sharp')
	assert.ok(rr.d.some((s) => s[0] === 'L' && s[1] === 0 && s[2] === 50), 'bottom-left sharp')
	assert.throws(() => c.roundRect(0, 0, 1, 1, [1, 2, 3, 4, 5]), RangeError)
	assert.throws(() => c.arc(0, 0, -1, 0, 1), RangeError)
})

test('AK3 clip chains intersect and come back with restore; each command keeps the chain it was drawn under', () => {
	const c = ctx()
	c.fillStyle = '#000'
	c.save()
	c.beginPath()
	c.rect(0, 0, 50, 50)
	c.clip()
	c.fillRect(0, 0, 10, 10)
	c.fillRect(5, 5, 10, 10)
	c.beginPath()
	c.rect(10, 10, 50, 50)
	c.clip('evenodd')
	c.fillRect(0, 0, 100, 100)
	c.restore()
	c.fillRect(0, 0, 1, 1)
	const [a, b, d, e] = paths(c)
	assert.equal(a.clip.length, 1)
	assert.equal(a.clip, b.clip, 'the same array while the clip is unchanged')
	assert.equal(d.clip.length, 2)
	assert.equal(d.clip[1].rule, 'evenodd')
	assert.deepEqual(e.clip, [])
})

test('AK3 colours: hex, rgb()/rgba() (commas, spaces, percentages), transparent, names; invalid values are ignored like in a canvas', () => {
	assert.deepEqual(parseColor('#abc'), { rgb: [170, 187, 204], a: 1 })
	assert.deepEqual(parseColor('#FF880080'), { rgb: [255, 136, 0], a: 128 / 255 })
	assert.deepEqual(parseColor('rgba(0, 0, 0, 0.25)'), { rgb: [0, 0, 0], a: 0.25 })
	assert.deepEqual(parseColor('rgb(100% 0% 50% / 50%)'), { rgb: [255, 0, 128], a: 0.5 })
	assert.deepEqual(parseColor('transparent'), { rgb: [0, 0, 0], a: 0 })
	assert.deepEqual(parseColor('White'), { rgb: [255, 255, 255], a: 1 })
	assert.equal(parseColor('red" onload="x'), null)
	assert.equal(parseColor('#12345'), null)
	assert.equal(parseColor(42), null)
	assert.deepEqual(parseColor('teal', (s) => (s === 'teal' ? '#008080' : null)), { rgb: [0, 128, 128], a: 1 }, 'others through the browser')
	assert.equal(parseColor('nonsense', () => null), null)
	const c = ctx()
	c.fillStyle = '#00ff00'
	c.fillStyle = 'red" onload="x'
	assert.equal(c.fillStyle, '#00ff00', 'an invalid colour is ignored')
	c.lineWidth = 3
	c.lineWidth = 0
	c.lineWidth = NaN
	assert.equal(c.lineWidth, 3)
	c.globalAlpha = 0.5
	c.globalAlpha = 2
	assert.equal(c.globalAlpha, 0.5)
	c.fillRect(0, 0, 10, 10)
	assert.deepEqual(paths(c)[0].fill, { kind: 'color', rgb: [0, 255, 0], a: 0.5 }, 'globalAlpha in the paint')
	c.globalAlpha = 0
	c.fillRect(0, 0, 10, 10)
	c.globalAlpha = 1
	c.fillStyle = 'rgba(0,0,0,0)'
	c.fillRect(0, 0, 10, 10)
	assert.equal(paths(c).length, 1, 'nothing that shows nothing')
	assert.deepEqual(parseFont('bold normal 24px Arial, "Liberation Sans", sans-serif'), { size: 24, bold: true, italic: false, family: 'Arial, "Liberation Sans", sans-serif' })
	assert.deepEqual(parseFont('italic 700 13.5px/1.2 serif'), { size: 13.5, bold: true, italic: true, family: 'serif' })
})

test('AK3 gradients keep their stops and the matrix at fill time; Path2D, patterns and image data throw; (job 203) drawImage only for pictures', () => {
	const c = ctx()
	const g = c.createLinearGradient(0, 0, 0, 10)
	g.addColorStop(1, 'rgba(0,0,0,0)')
	g.addColorStop(0, 'rgba(0,0,0,0.25)')
	assert.throws(() => g.addColorStop(2, '#000'), RangeError)
	c.fillStyle = g
	c.globalAlpha = 0.5
	c.save()
	c.transform(1, 0, 0, -1, 5, 7)
	c.fillRect(0, 0, 20, 10)
	c.restore()
	const [p] = paths(c)
	assert.equal(p.fill.kind, 'linear')
	assert.deepEqual(p.fill.coords, [0, 0, 0, 10])
	assert.deepEqual(p.fill.stops.map((s) => [s.t, s.a]), [[0, 0.25], [1, 0]], 'sorted')
	assert.deepEqual(p.fill.m, [1, 0, 0, -1, 5, 7])
	assert.equal(p.fill.a, 0.5)
	assert.throws(() => c.createRadialGradient(0, 0, -1, 0, 0, 5), RangeError)
	assert.throws(() => c.fill({}), TypeError)
	assert.throws(() => c.stroke({}), TypeError)
	assert.throws(() => c.createPattern(), TypeError)
	assert.throws(() => c.getImageData(0, 0, 1, 1), TypeError)
	// job 203: only the picture of an own shape (a data URI by model/shapeImage.js) at a destination box
	assert.throws(() => c.drawImage({ src: 'https://example.org/a.png' }, 0, 0, 1, 1), TypeError)
	assert.throws(() => c.drawImage({ src: PNG }, 0, 0, 1, 1, 0, 0, 1, 1), TypeError)
	assert.equal(c.isPointInPath(0, 0), false)
})

test('AK3 text: its left alphabetic baseline by textAlign and textBaseline, its font, its matrix; empty text is nothing', () => {
	const c = ctx()
	c.font = 'bold normal 20px Arial, sans-serif'
	c.fillStyle = '#1a1a1a'
	c.translate(100, 0)
	c.fillText('abcd', 10, 50)
	c.textAlign = 'center'
	c.textBaseline = 'middle'
	c.fillText('abcd', 10, 50)
	c.textAlign = 'right'
	c.textBaseline = 'top'
	c.fillText('abcd', 10, 50)
	c.fillText('', 10, 50)
	c.strokeStyle = '#ff0000'
	c.lineWidth = 2
	c.textAlign = 'end'
	c.direction = 'rtl'
	c.textBaseline = 'alphabetic'
	c.strokeText('ab', 0, 0)
	const t = c.ops.filter((o) => o.op === 'text')
	assert.equal(t.length, 4)
	assert.deepEqual(t.map((o) => [o.x, o.y]), [[10, 50], [-10, 57], [-30, 68], [0, 0]])
	assert.deepEqual(t[0].m, [1, 0, 0, 1, 100, 0])
	assert.deepEqual([t[0].size, t[0].bold, t[0].italic, t[0].family, t[0].width], [20, true, false, 'Arial, sans-serif', 40])
	assert.deepEqual(t[0].fill, { kind: 'color', rgb: [26, 26, 26], a: 1 })
	assert.equal(t[3].fill, null)
	assert.equal(t[3].stroke.width, 2, 'a text stroke stays in the text\'s units')
	assert.equal(c.measureText('abc').width, 30)
})

test('AK3 the real paint functions run into it: note shadow (rotated), reaction row, vote badges', () => {
	const c = ctx()
	c.save()
	c.translate(200, 100)
	c.rotate(0.3)
	paintShade(c, 200, 200, 17)
	c.restore()
	const shade = paths(c)
	assert.equal(shade.length, 16, 'four bands and four corners per shadow (job 259: two shadows)')
	assert.ok(shade.every((p) => p.fill.kind === 'linear' || p.fill.kind === 'radial'))
	assert.equal(new Set(shade.map((p) => JSON.stringify([p.fill.kind, p.fill.coords, p.fill.stops]))).size, 4, 'two gradients per shadow, many matrices')
	const before = c.ops.length
	paintReactions(c, [{ id: 'n1', x: 0, y: 0, w: 200, h: 200, r: 0, plan: { width: 80, pills: [{ e: '1f44d', n: 3, mine: false, x: 0, w: 60 }], more: null, add: null } }])
	paintBadges(c, { items: [{ id: 'n1', x: 200, y: 0, cx: 200, cy: 0, mine: 1, total: 4, ring: false }], scope: null }, 1, '#0082c9', { live: false })
	const added = c.ops.slice(before)
	assert.ok(added.some((o) => o.op === 'text' && o.text === '👍'), 'the emoji as text')
	assert.ok(added.some((o) => o.op === 'text' && o.text === '3'))
	assert.ok(added.some((o) => o.op === 'path'))
	c.beginGroup('x')
	c.endGroup()
	assert.deepEqual(c.ops.slice(-2), [{ op: 'group', id: 'x' }, { op: 'end' }])
})

test('job 203 AK7: drawImage records the picture of an own shape with its box, matrix, alpha and clip', () => {
	const c = ctx()
	c.save()
	c.translate(10, 20)
	c.rotate(Math.PI / 2)
	c.globalAlpha = 0.5
	c.drawImage({ src: PNG, naturalWidth: 1, naturalHeight: 1 }, 0, 0, 40, 30)
	c.restore()
	c.drawImage({ src: PNG, naturalWidth: 3, naturalHeight: 2 }, 5, 6)
	c.drawImage({ src: PNG }, 0, 0, 0, 10)
	const imgs = c.ops.filter((o) => o.op === 'image')
	assert.equal(imgs.length, 2, 'an empty box draws nothing')
	assert.equal(imgs[0].src, PNG)
	assert.deepEqual([imgs[0].x, imgs[0].y, imgs[0].w, imgs[0].h, imgs[0].alpha], [0, 0, 40, 30, 0.5])
	assert.deepEqual(imgs[0].m.map((v) => Math.round(v * 1000) / 1000), [0, 1, -1, 0, 10, 20])
	assert.deepEqual([imgs[1].x, imgs[1].y, imgs[1].w, imgs[1].h, imgs[1].alpha], [5, 6, 3, 2, 1], 'without a box: the natural size')
})
