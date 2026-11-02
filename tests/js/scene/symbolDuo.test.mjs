/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 244 (redesign round 2): the 20 symbol shapes in Phosphor
 * Duotone. The body draws the light layer (SHAPES[kind].duo) first, in the
 * fill at 20 % of its opacity, then the icon (Regular) as before; none at
 * fill opacity 0; LOD 2 paints the icon only (coarse.test.mjs); the SVG
 * export gets both paths, the PDF export the layer under an alpha; the preview of the shapes panel lies the layer
 * under the icon at fill-opacity 0.2. Also scalePath (svgPath.js), which
 * brings the 256 grid of Phosphor to 24.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PHOSPHOR, PHOSPHOR_DUO, PHOSPHOR_SCALE } from '../../../src/model/phosphor.js'
import { DUO_SHARE, SHAPES, duoCommands, iconCommands, isSymbolKind, shapePreview } from '../../../src/model/shapes.js'
import { parseSvgPath, scalePath } from '../../../src/model/svgPath.js'
import { bodyAttrs, shape } from '../../../src/scene/nodes/shape.js'
import { VectorContext } from '../../../src/scene/vectorContext.js'
import { svgDocument } from '../../../src/scene/exportSvg.js'
import { pdfDocument } from '../../../src/scene/exportPdf.js'
import { readPdf } from '../../../dev/e2e/lib/pdf.mjs'
import { useSfc } from '../shell/sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ShapePreview = (await import('../../../src/components/ShapePreview.vue')).default

/** The symbols and their Phosphor names (spec, table "Symbol-Formen"). */
const NAMES = {
	iconPerson: 'user', iconPeople: 'users', iconPlace: 'map-pin', iconClock: 'clock', iconWarning: 'warning',
	iconInfo: 'info', iconQuestion: 'question', iconDone: 'check-circle', iconError: 'x-circle', iconStar: 'star',
	iconHeart: 'heart', iconIdea: 'lightbulb', iconFlag: 'flag', iconCalendar: 'calendar-blank', iconMail: 'envelope-simple',
	iconPhone: 'phone', iconHome: 'house', iconSettings: 'gear', iconLock: 'lock', iconCloud: 'cloud',
}

/** A canvas (Konva) context that records its calls. */
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

const item = (kind, style = {}) => ({ id: 'S', t: 'shape', x: 0, y: 0, w: 96, h: 96, r: 0, data: { kind, text: '' }, style: { fill: '#c43e45', strokeWidth: 0, ...style } })

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
	k.strokeShape = () => {}
	k.fillStrokeShape = (s) => {
		if (s.getAttr('fillEnabled') !== false) {
			vc.fillStyle = s.getAttr('fill')
			vc.fill()
		}
	}
	return k
}

describe('job 244 AK3: scalePath', () => {
	test('scales every coordinate as written: relative stays relative, H and V, an arc keeps rotation and flags', () => {
		assert.equal(scalePath('M10 20l5-5h3v2H4V8z', 2), 'M20 40l10 -10h6v4H8V16z')
		assert.equal(scalePath('M0,0C1,2,3,4,5,6s1,1,2,2Q1,1,2,2t3,3', 0.5), 'M0 0C0.5 1 1.5 2 2.5 3s0.5 0.5 1 1Q0.5 0.5 1 1t1.5 1.5')
		// Phosphor's tight writing: numbers glued with "." and "-", flags without separators
		assert.equal(scalePath('M1 1a.37.37,0,0,1-.17.48', 2), 'M2 2a0.74 0.74 0 0 1 -0.34 0.96')
		assert.equal(scalePath('M0 0a1 1 30 01 5,5', 3), 'M0 0a3 3 30 0 1 15 15')
		assert.equal(scalePath('M1 1L2 2', 1 / 3), 'M0.333 0.333L0.667 0.667', 'at most 3 decimals')
		assert.equal(scalePath('M-1 1L1 -1', 0.0001), 'M0 0L0 0', 'never -0')
	})

	test('factor 1 gives the commands of parseSvgPath; the scaled path parses into the scaled points', () => {
		/** @param {Array} cmds parsed commands @return {number[]} the starts of the subpaths and the bounding box of the drawn curve, flat */
		const frame = (cmds) => {
			const pts = []
			let p = [0, 0]
			for (const c of cmds) {
				if (c[0] === 'C') {
					for (let t = 1 / 16; t <= 1; t += 1 / 16) {
						const u = 1 - t
						pts.push([0, 1].map((a) => u * u * u * p[a] + 3 * u * u * t * c[1 + a] + 3 * u * t * t * c[3 + a] + t * t * t * c[5 + a]))
					}
				}
				if (c.length > 1) p = c.slice(-2)
				pts.push(p)
			}
			const xs = pts.map((q) => q[0])
			const ys = pts.map((q) => q[1])
			return [...cmds.filter((c) => c[0] === 'M').flatMap((c) => c.slice(1)), Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
		}
		for (const [name, d] of Object.entries(PHOSPHOR)) {
			const want = parseSvgPath(d)
			assert.ok(want !== null, name)
			const one = parseSvgPath(scalePath(d, 1))
			assert.equal(one.length, want.length, name)
			want.forEach((c, i) => {
				assert.equal(one[i][0], c[0], name)
				for (let j = 1; j < c.length; j++) assert.ok(Math.abs(one[i][j] - c[j]) < 2e-3, `${name}: ${one[i]} ~ ${c}`)
			})
			// scaled: an arc may split into one cubic more or less (a quarter turn after rounding), the shape stays
			const small = frame(parseSvgPath(scalePath(d, PHOSPHOR_SCALE)))
			const big = frame(want)
			assert.equal(small.length, big.length, name)
			small.forEach((v, i) => assert.ok(Math.abs(v - big[i] * PHOSPHOR_SCALE) < 0.02, `${name}: ${v} ~ ${big[i]} × 3/32`))
		}
	})

	test('anything unreadable gives the empty string', () => {
		for (const d of [null, undefined, 3, '', 'L1 1', 'M1', 'M1 1X2', 'M a b']) assert.equal(scalePath(d, 2), '', String(d))
		assert.equal(scalePath('M1 1', 0), '')
		assert.equal(scalePath('M1 1', -1), '')
	})
})

describe('job 244: the symbols in Phosphor Duotone', () => {
	test('each symbol: icon = Regular, duo = the light layer of Duotone, both scaled to the 24 grid and on it', () => {
		assert.deepEqual(Object.keys(NAMES).sort(), Object.keys(SHAPES).filter((k) => typeof SHAPES[k].duo === 'string').sort())
		for (const k of Object.keys(NAMES)) assert.equal(isSymbolKind(k), true, k)
		for (const [k, name] of Object.entries(NAMES)) {
			assert.equal(SHAPES[k].icon, scalePath(PHOSPHOR[name], PHOSPHOR_SCALE), k)
			assert.equal(SHAPES[k].duo, scalePath(PHOSPHOR_DUO[name], PHOSPHOR_SCALE), k)
			for (const cmds of [iconCommands(k), duoCommands(k)]) {
				assert.ok(cmds.length > 2, k)
				for (const c of cmds) for (const v of c.slice(1)) assert.ok(v >= 0 && v <= 24, `${k}: ${c}`)
			}
		}
		assert.equal(DUO_SHARE, 0.2)
		assert.equal(duoCommands('rect'), null)
		assert.equal(SHAPES.rect.duo, undefined)
	})

	test('AK6: the body fills the light layer first, in the fill at 20 % of its opacity, then the icon; nothing at fill opacity 0', () => {
		const c = fakeContext()
		draw(item('iconPerson', { fillOpacity: 50 }), c)
		const fills = c.calls.map((x, i) => [x, i]).filter(([x]) => x[0] === 'fill' || x[0] === 'fillStrokeShape')
		assert.equal(fills[0][0][0], 'fill', 'first the light layer')
		assert.deepEqual(c.calls.filter((x) => x[0] === 'setAttr' && x[1] === 'fillStyle'), [['setAttr', 'fillStyle', 'rgba(196,62,69,0.1)']], '0.2 × 50 %')
		assert.equal(fills[1][0][0], 'fillStrokeShape', 'then the icon in fill and border')
		// the points of the layer: duo's commands × 96 / 24
		const first = c.calls.find((x) => x[0] === 'moveTo')
		const d0 = duoCommands('iconPerson')[0]
		assert.deepEqual(first, ['moveTo', d0[1] * 4, d0[2] * 4])
		const between = c.calls.slice(fills[0][1] + 1, fills[1][1]).find((x) => x[0] === 'moveTo')
		const i0 = iconCommands('iconPerson')[0]
		assert.deepEqual(between, ['moveTo', i0[1] * 4, i0[2] * 4], 'the icon after it')
		const body = draw(item('iconPerson'), fakeContext())
		assert.equal(body.getAttr('duoFill'), 'rgba(196,62,69,0.2)', 'full opacity: 20 %')
		assert.equal(bodyAttrs(item('iconStar', { fill: '#191b1d' }), { w: 96, h: 96 }).duoFill, 'rgba(25,27,29,0.2)')
		// fill opacity 0: no layer, no fill at all
		const none = fakeContext()
		draw(item('iconPerson', { fillOpacity: 0 }), none)
		assert.equal(none.calls.filter((x) => x[0] === 'fill').length, 0)
		assert.ok(!none.calls.some((x) => x[0] === 'setAttr' && x[1] === 'fillStyle'))
		// no layer for a kind without one
		const rect = fakeContext()
		draw(item('rect'), rect)
		assert.equal(rect.calls.filter((x) => x[0] === 'fill').length, 0)
	})

	test('AK6: the SVG export of a symbol has two paths, the layer at fill-opacity 0.2, the icon at 1', () => {
		const vc = new VectorContext()
		vc.beginGroup('S')
		draw(item('iconStar'), konvaOn(vc))
		vc.endGroup()
		const svg = svgDocument(vc.ops, { x: -10, y: -10, w: 120, h: 120 })
		const group = svg.match(/<g id="item-S">\n([\s\S]*?)<\/g>/)[1]
		const paths = group.match(/<path [^>]*>/g)
		assert.equal(paths.length, 2, group)
		assert.match(paths[0], /fill="#c43e45" fill-opacity="0\.2"/)
		assert.match(paths[1], /fill="#c43e45"/)
		assert.doesNotMatch(paths[1], /fill-opacity/)
	})

	test('risk: the PDF export keeps the layer transparent (an ExtGState at 0.2), the icon opaque', async () => {
		const measure = () => ({ width: 0, shift: 0 })
		const vc = new VectorContext({ measure })
		draw(item('iconStar'), konvaOn(vc))
		const pdf = readPdf(Buffer.from((await pdfDocument(vc.ops, { x: -10, y: -10, w: 120, h: 120 }, { measure, deflate: null })).bytes))
		const fills = [...pdf.content.matchAll(/\/(A\d+) gs 0\.769 0\.243 0\.271 rg/g)].map((m) => m[1])
		assert.equal(fills.length, 2, pdf.content)
		const alpha = (name) => {
			const ref = Number(new RegExp(`/${name} (\\d+) 0 R`).exec(pdf.resources)[1])
			return /\/ca ([\d.]+)/.exec(pdf.objects.get(ref).dict)[1]
		}
		assert.deepEqual(fills.map(alpha), ['0.2', '1'])
	})
})

describe('job 244 AK7: the preview', () => {
	test('shapePreview gives a symbol its light layer; ShapePreview draws it under the icon at fill-opacity 0.2', async () => {
		assert.equal(shapePreview('iconStar').duo, SHAPES.iconStar.duo)
		assert.equal(shapePreview('rect').duo, null)
		const html = await renderToString(createSSRApp(ShapePreview, { kind: 'iconStar', size: 28 }))
		const paths = html.match(/<path [^>]*>/g)
		assert.equal(paths.length, 2, html)
		assert.ok(paths[0].includes(`d="${SHAPES.iconStar.duo}"`) && /fill-opacity="0\.2"/.test(paths[0]) && /knorke-shapepreview__duo/.test(paths[0]), paths[0])
		assert.ok(paths[1].includes(`d="${SHAPES.iconStar.icon}"`), paths[1])
		assert.match(html, /knorke-shapepreview--filled/)
		const plain = await renderToString(createSSRApp(ShapePreview, { kind: 'rect' }))
		assert.equal(plain.match(/<path [^>]*>/g).length, 1)
	})
})
