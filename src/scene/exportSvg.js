/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Save as SVG" (factory job 200): the commands of a VectorContext
 * (scene/vectorContext.js) as one SVG document.
 *
 * - The root is width × height = the frame (1 world unit = 1 px) with the
 *   viewBox on the frame in world units, then a white rectangle over the
 *   frame (EXPORT_BACKGROUND), then one <g id="item-<id>"> per group of the
 *   commands (an item; the reactions and vote badges are the group
 *   "overlay"), in their order.
 * - A path is a <path> in world units (no transform), with fill and stroke
 *   as #rrggbb plus an opacity, the stroke's width, caps, joins, miter limit
 *   and dashes; a fill followed by the stroke of the same path (a shape with
 *   its outline) is one element with both. A gradient goes into <defs> once per geometry and stops as a
 *   linearGradient or radialGradient in user space; a path filled with it
 *   carries the matrix it was filled under and its points in that space (a
 *   board's note shadows share two gradients); a gradient stroke or text, or
 *   a fill under a singular matrix, gets a gradient of its own with that
 *   matrix as gradientTransform; a
 *   clip chain becomes nested <g clip-path> around the commands drawn under
 *   it (each clip path once in <defs>).
 * - A text is one <text xml:space="preserve"> per fillText at its left
 *   alphabetic baseline, with its matrix, the font family, size, weight and
 *   style of the canvas font: text that stays editable.
 * - (Job 203) The picture of an own shape is an <image> with its data URI
 *   (xlink:href), its box, the matrix and its opacity, stretched
 *   (preserveAspectRatio none) like on the board.
 * Numbers have at most 3 decimals. Text and attribute values are escaped
 * (& < > " '), characters XML 1.0 forbids (controls but tab, LF and CR,
 * lone surrogates, U+FFFE, U+FFFF) are left out, ids keep only
 * [A-Za-z0-9_.-]. The document never holds a script, a foreignObject, an
 * event attribute or a reference outside itself.
 */
import { EXPORT_BACKGROUND } from './exportImage.js'
import { apply, invert, multiply } from './vectorContext.js'

/**
 * @param {number} n a number
 * @return {string} at most 3 decimals, never "-0" nor an exponent for |n| < 1e15
 */
export function num(n) {
	const r = Math.round(n * 1000) / 1000
	return Object.is(r, -0) || r === 0 ? '0' : String(r)
}

/**
 * @param {unknown} s text
 * @return {string} without the characters XML 1.0 forbids
 */
export function xmlChars(s) {
	// eslint-disable-next-line no-control-regex
	return String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

/**
 * @param {unknown} s text
 * @return {string} escaped for an element's content or an attribute value
 */
export function esc(s) {
	return xmlChars(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * @param {number[]} rgb [r, g, b]
 * @return {string} #rrggbb
 */
export function hex(rgb) {
	return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/**
 * @param {Array} d a device path
 * @return {string} its SVG path data
 */
export function pathData(d) {
	const out = []
	for (const s of d) {
		if (s[0] === 'Z') out.push('Z')
		else out.push(s[0] + s.slice(1).map(num).join(' '))
	}
	return out.join('')
}

/**
 * @param {Array} s a path segment
 * @param {number[]} m matrix
 * @return {Array} the segment with its points mapped
 */
function mapSeg(s, m) {
	const out = [s[0]]
	for (let i = 1; i + 1 < s.length; i += 2) out.push(...apply(m, s[i], s[i + 1]))
	return out
}

/**
 * @param {number[]} m matrix
 * @return {string} a transform attribute (empty for the identity)
 */
function matrixAttr(m) {
	if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return ''
	return ` transform="matrix(${m.map(num).join(' ')})"`
}

/**
 * @param {string} id an item id
 * @return {string} an XML name safe in an id attribute
 */
function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9_.-]/g, '_')
}

/**
 * The SVG document of an export (see the file comment).
 *
 * @param {Array} ops VectorContext commands
 * @param {{x:number, y:number, w:number, h:number}} frame the drawn world rectangle (exportLayout's frame)
 * @param {{background?: string}} [opts] background colour
 * @return {string}
 */
export function svgDocument(ops, frame, { background = EXPORT_BACKGROUND } = {}) {
	const defs = []
	const clipIds = new Map()
	const shared = new Map()
	let gradients = 0
	const body = []
	let openClips = null
	let depth = 0

	const clipId = (entry) => {
		let id = clipIds.get(entry)
		if (!id) {
			id = 'c' + (clipIds.size + 1)
			clipIds.set(entry, id)
			defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${pathData(entry.d)}"${entry.rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`)
		}
		return id
	}
	const closeClips = () => {
		if (openClips) body.push('</g>'.repeat(openClips.length))
		openClips = null
	}
	const useClip = (chain) => {
		if (chain === openClips) return
		closeClips()
		if (chain && chain.length > 0) {
			for (const entry of chain) body.push(`<g clip-path="url(#${clipId(entry)})">`)
			openClips = chain
		}
	}
	/**
	 * @param {object} paint a gradient
	 * @param {number[]|null} tf its gradientTransform; null: a shared one without
	 * @return {string} its id in <defs>
	 */
	const gradientId = (paint, tf) => {
		const key = tf ? null : JSON.stringify([paint.kind, paint.coords, paint.stops, paint.a])
		if (key && shared.has(key)) return shared.get(key)
		const id = 'g' + (++gradients)
		if (key) shared.set(key, id)
		const stops = paint.stops.map((s) => `<stop offset="${num(s.t)}" stop-color="${hex(s.rgb)}"${s.a * paint.a < 1 ? ` stop-opacity="${num(s.a * paint.a)}"` : ''}/>`).join('')
		const c = paint.coords
		const tfa = tf ? ` gradientTransform="matrix(${tf.map(num).join(' ')})"` : ''
		if (paint.kind === 'linear') {
			defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(c[0])}" y1="${num(c[1])}" x2="${num(c[2])}" y2="${num(c[3])}"${tfa}>${stops}</linearGradient>`)
		} else {
			const focus = c[0] !== c[3] || c[1] !== c[4] ? ` fx="${num(c[0])}" fy="${num(c[1])}"` : ''
			const fr = c[2] > 0 ? ` fr="${num(c[2])}"` : ''
			defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(c[3])}" cy="${num(c[4])}" r="${num(c[5])}"${focus}${fr}${tfa}>${stops}</radialGradient>`)
		}
		return id
	}
	/**
	 * @param {object} paint a paint
	 * @param {string} which fill or stroke
	 * @param {number[]} [space] the matrix of the element's user space (a gradient of its own)
	 * @return {string} the paint's attribute, its opacity attribute after it
	 */
	const paintAttrs = (paint, which, space = [1, 0, 0, 1, 0, 0]) => {
		if (paint.kind === 'color') {
			return ` ${which}="${hex(paint.rgb)}"` + (paint.a < 1 ? ` ${which}-opacity="${num(paint.a)}"` : '')
		}
		const inv = invert(space)
		return ` ${which}="url(#${gradientId(paint, inv ? multiply(inv, paint.m) : paint.m)})"`
	}
	const strokeAttrs = (s, space) => {
		let a = paintAttrs(s.paint, 'stroke', space) + ` stroke-width="${num(s.width)}"`
		if (s.cap !== 'butt') a += ` stroke-linecap="${s.cap}"`
		if (s.join !== 'miter') a += ` stroke-linejoin="${s.join}"`
		else a += ` stroke-miterlimit="${num(s.miter)}"`
		if (s.dash.length > 0 && s.dash.some((v) => v > 0)) {
			a += ` stroke-dasharray="${s.dash.map(num).join(' ')}"`
			if (s.offset) a += ` stroke-dashoffset="${num(s.offset)}"`
		}
		return a
	}

	for (let i = 0; i < ops.length; i++) {
		const op = ops[i]
		if (op.op === 'group') {
			closeClips()
			body.push(`<g id="item-${esc(safeId(op.id))}">`)
			depth++
		} else if (op.op === 'end') {
			closeClips()
			if (depth > 0) {
				body.push('</g>')
				depth--
			}
		} else if (op.op === 'path') {
			useClip(op.clip)
			const g = op.fill && op.fill.kind !== 'color' ? op.fill : null
			const back = g ? invert(g.m) : null
			let a
			if (back) {
				// the path in the gradient's space: one shared gradient
				a = ` d="${pathData(op.d.map((s) => mapSeg(s, back)))}"${matrixAttr(g.m)} fill="url(#${gradientId(g, null)})"`
			} else {
				a = ` d="${pathData(op.d)}"` + (op.fill ? paintAttrs(op.fill, 'fill') : ' fill="none"')
			}
			if (op.fill && op.rule === 'evenodd') a += ' fill-rule="evenodd"'
			let stroke = op.stroke
			const next = ops[i + 1]
			if (!back && op.fill && !stroke && next?.op === 'path' && !next.fill && next.stroke && next.clip === op.clip && pathData(next.d) === pathData(op.d)) {
				// fill, then stroke of the same path (Konva's fillStrokeShape): one element with both
				stroke = next.stroke
				i++
			}
			if (stroke) a += strokeAttrs(stroke)
			body.push(`<path${a}/>`)
		} else if (op.op === 'image') {
			// job 203: the picture of an own shape, embedded (vectorContext checked its data URI)
			useClip(op.clip)
			const a = op.alpha < 1 ? ` opacity="${num(op.alpha)}"` : ''
			body.push(`<image x="${num(op.x)}" y="${num(op.y)}" width="${num(op.w)}" height="${num(op.h)}" preserveAspectRatio="none"${a}${matrixAttr(op.m)} xlink:href="${esc(op.src)}"/>`)
		} else if (op.op === 'text') {
			const text = xmlChars(op.text)
			if (text === '') continue
			useClip(op.clip)
			let a = ` x="${num(op.x)}" y="${num(op.y)}" font-family="${esc(op.family)}" font-size="${num(op.size)}"`
			if (op.bold) a += ' font-weight="bold"'
			if (op.italic) a += ' font-style="italic"'
			a += op.fill ? paintAttrs(op.fill, 'fill', op.m) : ' fill="none"'
			if (op.stroke) a += strokeAttrs(op.stroke, op.m)
			body.push(`<text xml:space="preserve"${a}${matrixAttr(op.m)}>${esc(text)}</text>`)
		}
	}
	closeClips()
	body.push('</g>'.repeat(depth))

	const f = frame
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${num(f.w)}" height="${num(f.h)}" viewBox="${num(f.x)} ${num(f.y)} ${num(f.w)} ${num(f.h)}">\n`
		+ (defs.length > 0 ? `<defs>${defs.join('')}</defs>\n` : '')
		+ `<rect x="${num(f.x)}" y="${num(f.y)}" width="${num(f.w)}" height="${num(f.h)}" fill="${esc(background)}"/>\n`
		+ body.join('\n')
		+ '\n</svg>\n'
}
