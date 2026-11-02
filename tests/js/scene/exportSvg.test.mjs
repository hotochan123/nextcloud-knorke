/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 200 (AK4): "Save as SVG" (src/scene/exportSvg.js) for a fixed
 * recording of the VectorContext:
 * - the root has width, height and viewBox of the frame, a white rectangle
 *   over it, one <g id="item-…"> per item in order, the overlay last
 * - text stays <text> with its content, font, size, weight and matrix
 * - paths, strokes, dashes, opacities; gradients shared per geometry; clips
 *   nested around the commands drawn under them
 * - hostile text and colours: the document stays well-formed XML, holds no
 *   raw "<script", no event attribute, no character XML 1.0 forbids
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VectorContext } from '../../../src/scene/vectorContext.js'
import { esc, num, svgDocument, xmlChars } from '../../../src/scene/exportSvg.js'
import { paintShade } from '../../../src/scene/nodes/shade.js'

const measure = (font, text) => ({ width: 10 * [...text].length, shift: 0 })
const FRAME = Object.freeze({ x: -16, y: -16, w: 432, h: 332 })
const FONT = 'normal normal 24px Arial, "Liberation Sans", Helvetica, sans-serif'

/**
 * A small well-formedness check: matched tags, quoted attributes, known
 * entities, no "<" or "&" outside markup, no forbidden character.
 *
 * @param {string} xml document
 * @return {{tags: string[], texts: string[]}} the element names in order and the decoded text of <text> elements
 */
function parseXml(xml) {
	assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/, 'no character XML 1.0 forbids')
	assert.doesNotMatch(xml, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'no lone surrogate')
	const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
	const stack = []
	const tags = []
	const texts = []
	const decode = (s) => {
		assert.doesNotMatch(s.replace(/&(amp|lt|gt|quot|#39);/g, ''), /[<&]/, 'escaped: ' + s)
		return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
	}
	const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy
	let m
	let at = 0
	let inText = false
	while ((m = re.exec(body)) !== null) {
		at = re.lastIndex
		if (m[5] !== undefined) {
			const t = decode(m[5])
			if (inText) texts.push(t)
			else assert.match(t, /^\s*$/, 'no text outside <text>')
			continue
		}
		for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) decode(a[2])
		if (m[1]) {
			assert.equal(stack.pop(), m[2], 'matched close tag')
			if (m[2] === 'text') inText = false
		} else {
			tags.push(m[2])
			if (!m[4]) {
				stack.push(m[2])
				if (m[2] === 'text') inText = true
			}
		}
	}
	assert.equal(at, body.length, 'the whole document parses')
	assert.deepEqual(stack, [], 'every element closed')
	return { tags, texts }
}

/** @return {VectorContext} two notes and a frame title, recorded */
function recording() {
	const c = new VectorContext({ measure })
	c.beginGroup('01JA0000000000000000000001')
	c.save()
	c.transform(1, 0, 0, 1, 0, 0)
	paintShade(c, 200, 200, 0)
	c.fillStyle = '#ffd6a5'
	c.beginPath()
	c.roundRect(0, 0, 200, 200, 4)
	c.fill()
	c.font = FONT
	c.fillStyle = '#1a1a1a'
	c.fillText('E81 Grüße', 12, 40)
	c.restore()
	c.endGroup()
	c.beginGroup('01JA0000000000000000000002')
	c.save()
	c.translate(200, 100)
	paintShade(c, 200, 200, 0)
	c.strokeStyle = 'rgba(26, 26, 26, 0.5)'
	c.lineWidth = 2
	c.lineCap = 'round'
	c.setLineDash([6, 4])
	c.beginPath()
	c.moveTo(0, 0)
	c.lineTo(100, 0)
	c.stroke()
	c.beginPath()
	c.rect(0, 0, 50, 50)
	c.clip()
	c.fillStyle = '#a8d8f8'
	c.fillRect(0, 0, 200, 200)
	c.restore()
	c.endGroup()
	c.beginGroup('overlay')
	c.font = 'bold 12px Arial'
	c.fillStyle = '#ffffff'
	c.textAlign = 'center'
	c.fillText('3', 400, 0)
	c.endGroup()
	return c
}

test('AK4 the root, the white frame, one group per item in order, the overlay last; text stays text', () => {
	const svg = svgDocument(recording().ops, FRAME)
	assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" version="1\.1" width="432" height="332" viewBox="-16 -16 432 332">\n/)
	assert.match(svg, /<\/defs>\n<rect x="-16" y="-16" width="432" height="332" fill="#ffffff"\/>\n<g id="item-01JA0000000000000000000001">/)
	const { tags, texts } = parseXml(svg)
	assert.equal(tags[0], 'svg')
	assert.deepEqual([...svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1]), ['item-01JA0000000000000000000001', 'item-01JA0000000000000000000002', 'item-overlay'])
	assert.deepEqual(texts, ['E81 Grüße', '3'])
	assert.match(svg, /<text xml:space="preserve" x="12" y="40" font-family="Arial, &quot;Liberation Sans&quot;, Helvetica, sans-serif" font-size="24" fill="#1a1a1a">E81 Grüße<\/text>/)
	assert.match(svg, /<text xml:space="preserve" x="395" y="0" font-family="Arial" font-size="12" font-weight="bold" fill="#ffffff">3<\/text>/, 'centred by its measured width')
	assert.ok(svg.endsWith('</svg>\n'))
})

test('AK4 paths: fill, stroke with opacity, width, cap, dashes; the note shadows share two gradients; a clip nests around what it clips', () => {
	const svg = svgDocument(recording().ops, FRAME)
	assert.match(svg, /<path d="M200 100L300 100" fill="none" stroke="#1a1a1a" stroke-opacity="0\.5" stroke-width="2" stroke-linecap="round" stroke-miterlimit="10" stroke-dasharray="6 4"\/>/)
	// job 259: two shadows per note, each with its band and corner gradient
	assert.equal((svg.match(/<linearGradient /g) ?? []).length, 2, 'one band gradient per shadow for both notes')
	assert.equal((svg.match(/<radialGradient /g) ?? []).length, 2, 'one corner gradient per shadow')
	assert.equal((svg.match(/fill="url\(#g\d+\)"/g) ?? []).length, 32, 'eight shadow pieces per shadow and note')
	assert.match(svg, /<radialGradient id="g\d+" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="\d+(\.\d+)?"><stop offset="0" stop-color="#000000" stop-opacity="/)
	assert.match(svg, /<path d="M[^"]+" transform="matrix\(1 0 0 1 [^)]+\)" fill="url\(#g1\)"\/>/, 'the path in the gradient\'s space')
	assert.match(svg, /<clipPath id="c1" clipPathUnits="userSpaceOnUse"><path d="M200 100L250 100L250 150L200 150Z"\/><\/clipPath>/)
	assert.match(svg, /<g clip-path="url\(#c1\)">\n<path d="M200 100L400 100L400 300L200 300Z" fill="#a8d8f8"\/>\n<\/g>/)
	parseXml(svg)
})

test('AK4 a fill and then the stroke of the same path (a shape with its outline) is one element; different paths stay two', () => {
	const c = new VectorContext({ measure })
	c.fillStyle = '#ffffff'
	c.strokeStyle = '#1a1a1a'
	c.lineWidth = 2
	c.beginPath()
	c.ellipse(100, 60, 100, 60, 0, 0, 2 * Math.PI)
	c.fill()
	c.stroke()
	c.beginPath()
	c.rect(0, 0, 10, 10)
	c.fill()
	c.beginPath()
	c.rect(0, 0, 20, 20)
	c.stroke()
	const svg = svgDocument(c.ops, FRAME)
	const paths = svg.match(/<path [^>]*\/>/g)
	assert.equal(paths.length, 3)
	assert.match(paths[0], /^<path d="M200 60C[^"]+" fill="#ffffff" stroke="#1a1a1a" stroke-width="2" stroke-miterlimit="10"\/>$/)
	assert.match(paths[1], /fill="#ffffff"\/>$/)
	assert.match(paths[2], /fill="none" stroke="#1a1a1a"/)
	parseXml(svg)
})

test('AK4 hostile text and colours: well-formed, no raw <script, no event attribute, forbidden characters left out', () => {
	const c = new VectorContext({ measure })
	c.beginGroup('a"b<c')
	c.font = FONT
	c.fillStyle = 'red" onload="alert(1)'
	c.fillText('</text></svg><script>alert(1)</script>&"\'\u0000\u001F\uD800 ]]> ok 👍', 0, 0)
	c.fillStyle = '#000'
	c.fillText('x\uDFFFy￾', 0, 20)
	c.fillText('\u0001', 0, 40)
	c.endGroup()
	const svg = svgDocument(c.ops, FRAME, { background: '#fff" onload="x' })
	const { texts } = parseXml(svg)
	assert.doesNotMatch(svg, /<script/i)
	assert.doesNotMatch(svg, /\son[a-z]+="/i, 'no event attribute')
	assert.deepEqual(texts, ['</text></svg><script>alert(1)</script>&"\' ]]> ok 👍', 'xy'])
	assert.match(svg, /<g id="item-a_b_c">/)
	assert.match(svg, /fill="#000000">x/, 'the text with the invalid colour was drawn in the colour before it')
	assert.equal(xmlChars('a\u0000b👍c\uD83D'), 'ab👍c')
	assert.equal(esc('<&>"\''), '&lt;&amp;&gt;&quot;&#39;')
	assert.deepEqual([num(-0.0001), num(1.23456), num(-2.5), num(1e14 + 0.5)], ['0', '1.235', '-2.5', '100000000000000.5'])
})
