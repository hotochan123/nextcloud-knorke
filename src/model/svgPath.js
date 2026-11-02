/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (Job 201) SVG path data → a few absolute canvas commands, for the symbols
 * of the shape table (shapes.js icon: a 24 × 24 grid; job 244: Phosphor,
 * scaled with scalePath). The renderer scales the points itself, so the
 * border width stays a world width (no ctx.scale).
 *
 * Out: a flat list of commands
 *   ['M', x, y]  ['L', x, y]  ['C', x1, y1, x2, y2, x, y]  ['Q', x1, y1, x, y]  ['Z']
 * H/V become L, S/T C/Q with the reflected control point, A one cubic Bézier
 * per quarter turn at most (the usual endpoint → centre conversion of the
 * SVG spec, appendix B.2.4). Relative commands become absolute; repeated
 * parameters repeat the command (a second pair after M is an L).
 *
 * parseSvgPath never throws: path data it cannot read gives null, and the
 * shape draws without its symbol.
 */

const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const SEP_RE = /[\s,]*/y
const ARGS = Object.freeze({ M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 })

/**
 * @param {string} d path data
 * @return {Array<[string, ...number[]]>} tokens: [letter, …numbers] per command as written
 */
function tokenize(d) {
	const out = []
	let i = 0
	const skip = () => {
		SEP_RE.lastIndex = i
		SEP_RE.exec(d)
		i = SEP_RE.lastIndex
	}
	skip()
	while (i < d.length) {
		const c = d[i]
		if (!/[MLHVCSQTAZmlhvcsqtaz]/.test(c)) {
			return null
		}
		i++
		const up = c.toUpperCase()
		const n = ARGS[up]
		const nums = []
		for (;;) {
			skip()
			if (n === 0 || i >= d.length || /[A-Za-z]/.test(d[i])) break
			// the two flags of an arc may be written without a separator ("0 01 5,5")
			const k = nums.length % 7
			if (up === 'A' && (k === 3 || k === 4) && (d[i] === '0' || d[i] === '1')) {
				nums.push(d[i] === '1' ? 1 : 0)
				i++
				continue
			}
			NUM_RE.lastIndex = i
			const m = NUM_RE.exec(d)
			if (!m) return null
			nums.push(Number(m[0]))
			i = NUM_RE.lastIndex
		}
		if (n === 0) {
			out.push([c])
		} else {
			if (nums.length === 0 || nums.length % n !== 0) return null
			for (let k = 0; k < nums.length; k += n) {
				// M x y x y: the pairs after the first are lines
				const letter = k > 0 && up === 'M' ? (c === 'M' ? 'L' : 'l') : c
				out.push([letter, ...nums.slice(k, k + n)])
			}
		}
	}
	return out
}

/**
 * One SVG arc as cubic Béziers (SVG 1.1 appendix F.6.5 endpoint → centre).
 *
 * @param {number} x1 start x
 * @param {number} y1 start y
 * @param {number} rx radius x
 * @param {number} ry radius y
 * @param {number} phi rotation in degrees
 * @param {number} large large-arc flag
 * @param {number} sweep sweep flag
 * @param {number} x2 end x
 * @param {number} y2 end y
 * @return {Array} ['C', …] commands (an L for a degenerate radius)
 */
function arcToCubics(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
	if (x1 === x2 && y1 === y2) return []
	rx = Math.abs(rx)
	ry = Math.abs(ry)
	if (rx === 0 || ry === 0) return [['L', x2, y2]]
	const rad = (phi * Math.PI) / 180
	const cos = Math.cos(rad)
	const sin = Math.sin(rad)
	const dx = (x1 - x2) / 2
	const dy = (y1 - y2) / 2
	const xp = cos * dx + sin * dy
	const yp = -sin * dx + cos * dy
	const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
	if (lambda > 1) {
		rx *= Math.sqrt(lambda)
		ry *= Math.sqrt(lambda)
	}
	const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
	const den = rx * rx * yp * yp + ry * ry * xp * xp
	let co = Math.sqrt(Math.max(0, num / den))
	if (large === sweep) co = -co
	const cxp = (co * rx * yp) / ry
	const cyp = (-co * ry * xp) / rx
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
	const angle = (ux, uy, vx, vy) => {
		const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
		return a
	}
	const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
	let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
	if (!sweep && dt > 0) dt -= 2 * Math.PI
	if (sweep && dt < 0) dt += 2 * Math.PI
	const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9))
	const step = dt / segs
	const k = (4 / 3) * Math.tan(step / 4)
	const point = (t) => {
		const ex = rx * Math.cos(t)
		const ey = ry * Math.sin(t)
		return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]
	}
	const deriv = (t) => {
		const ex = -rx * Math.sin(t)
		const ey = ry * Math.cos(t)
		return [cos * ex - sin * ey, sin * ex + cos * ey]
	}
	const out = []
	let a = t1
	for (let s = 0; s < segs; s++) {
		const b = a + step
		const [ax, ay] = point(a)
		const [bx, by] = s === segs - 1 ? [x2, y2] : point(b)
		const [dax, day] = deriv(a)
		const [dbx, dby] = deriv(b)
		out.push(['C', ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by])
		a = b
	}
	return out
}

/**
 * @param {unknown} d SVG path data
 * @return {Array|null} absolute commands (header), null for anything unreadable
 */
export function parseSvgPath(d) {
	if (typeof d !== 'string') return null
	const tokens = tokenize(d)
	if (tokens === null || tokens.length === 0 || tokens[0][0].toUpperCase() !== 'M') return null
	const out = []
	let x = 0
	let y = 0
	let sx = 0
	let sy = 0
	// the last control point of a C/S (for S) or Q/T (for T)
	let lastC = null
	let lastQ = null
	for (const [c, ...a] of tokens) {
		const rel = c !== c.toUpperCase()
		const up = c.toUpperCase()
		const ox = rel ? x : 0
		const oy = rel ? y : 0
		let nextC = null
		let nextQ = null
		switch (up) {
		case 'M':
			x = a[0] + ox
			y = a[1] + oy
			sx = x
			sy = y
			out.push(['M', x, y])
			break
		case 'L':
			x = a[0] + ox
			y = a[1] + oy
			out.push(['L', x, y])
			break
		case 'H':
			x = a[0] + ox
			out.push(['L', x, y])
			break
		case 'V':
			y = a[0] + oy
			out.push(['L', x, y])
			break
		case 'C': {
			const cmd = ['C', a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy]
			out.push(cmd)
			nextC = [cmd[3], cmd[4]]
			x = cmd[5]
			y = cmd[6]
			break
		}
		case 'S': {
			const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]
			const cmd = ['C', c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]
			out.push(cmd)
			nextC = [cmd[3], cmd[4]]
			x = cmd[5]
			y = cmd[6]
			break
		}
		case 'Q': {
			const cmd = ['Q', a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]
			out.push(cmd)
			nextQ = [cmd[1], cmd[2]]
			x = cmd[3]
			y = cmd[4]
			break
		}
		case 'T': {
			const c1 = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]
			const cmd = ['Q', c1[0], c1[1], a[0] + ox, a[1] + oy]
			out.push(cmd)
			nextQ = c1
			x = cmd[3]
			y = cmd[4]
			break
		}
		case 'A': {
			const ex = a[5] + ox
			const ey = a[6] + oy
			out.push(...arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey))
			x = ex
			y = ey
			break
		}
		case 'Z':
			out.push(['Z'])
			x = sx
			y = sy
			break
		}
		lastC = nextC
		lastQ = nextQ
	}
	for (const cmd of out) {
		for (let i = 1; i < cmd.length; i++) {
			if (!Number.isFinite(cmd[i])) return null
		}
	}
	return out
}

/**
 * @param {number} v a number
 * @return {string} v with at most 3 decimals, never "-0"
 */
function n3(v) {
	const r = Math.round(v * 1000) / 1000
	return r === 0 ? '0' : String(r)
}

/**
 * (Job 244) Path data scaled by k about the origin, command by command as
 * written (relative stays relative, an arc keeps its rotation and flags):
 * the Phosphor icons (256 × 256) on the 24 × 24 grid of the shell and the
 * symbols.
 *
 * @param {unknown} d SVG path data
 * @param {number} k factor (> 0)
 * @return {string} the scaled path data, '' for anything unreadable
 */
export function scalePath(d, k) {
	const tokens = typeof d === 'string' && k > 0 ? tokenize(d) : null
	if (tokens === null || tokens.length === 0 || tokens[0][0].toUpperCase() !== 'M') return ''
	return tokens.map(([c, ...a]) => c + a.map((v, i) => (c.toUpperCase() === 'A' && i >= 2 && i <= 4 ? String(v) : n3(v * k))).join(' ')).join('')
}

/**
 * Traces parsed commands into a canvas context, each point mapped by
 * (x · sx + dx, y · sy + dy).
 *
 * @param {object} ctx canvas context (moveTo, lineTo, bezierCurveTo, quadraticCurveTo, closePath)
 * @param {Array} cmds commands of parseSvgPath
 * @param {number} sx scale x
 * @param {number} sy scale y
 * @param {number} [dx] offset x
 * @param {number} [dy] offset y
 */
export function traceCommands(ctx, cmds, sx, sy, dx = 0, dy = 0) {
	const X = (v) => v * sx + dx
	const Y = (v) => v * sy + dy
	for (const c of cmds) {
		switch (c[0]) {
		case 'M': ctx.moveTo(X(c[1]), Y(c[2])); break
		case 'L': ctx.lineTo(X(c[1]), Y(c[2])); break
		case 'C': ctx.bezierCurveTo(X(c[1]), Y(c[2]), X(c[3]), Y(c[4]), X(c[5]), Y(c[6])); break
		case 'Q': ctx.quadraticCurveTo(X(c[1]), Y(c[2]), X(c[3]), Y(c[4])); break
		case 'Z': ctx.closePath(); break
		}
	}
}
