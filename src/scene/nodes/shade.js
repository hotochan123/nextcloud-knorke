/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Drop shadows of a sticky note without canvas shadowBlur (SPEC-M1 §9.5
 * WP-S4, WebKit fixes of stage 4). In the scene lab, WebKit spent most of a
 * static-layer draw on the blurred note shadows: every blurred fill is a
 * blur of its own (a sharp rectangle as the shadow caster did not help),
 * and a pan at 100 % ran at about 25 fps with them against about 59 fps
 * without them (Chromium blurs rounded rectangles cheaply and does not care).
 *
 * Each shadow s of NOTE_SHADOWS (job 259: two, far and near, painted in
 * that order) is painted with gradients that follow the falloff of a canvas
 * shadow with shadowBlur s.blur: a Gaussian with sigma = s.blur / 2 and peak
 * alpha s.opacity, around the note's outline moved by (s.x, s.y) in screen
 * direction (a canvas shadow offset ignores the rotation). Four edge bands
 * share ONE linear gradient, the four corners ONE radial gradient, both
 * built once per canvas context and shadow and placed by transforms; only
 * the band around the outline is painted, the opaque note covers the rest.
 * A shadow reaches 3 sigma beyond the moved outline, so at most 3 sigma +
 * |offset| beyond the note: the index padding of a note (SceneModel
 * STICKY_PAD, the largest over NOTE_SHADOWS). Like the blurred shadow it
 * scales with the camera (world units) and is drawn at LOD 0 only (the
 * sticky builder hides the node at LOD 1).
 *
 * (Job 259) The dog ear: a note's outline is cut at its bottom right corner
 * by a straight edge from (w, h − ear) to (w − ear, h). That corner gets no
 * radial quadrant; a third band runs along the cut edge (the same linear
 * gradient, turned), and the bottom, right and cut bands meet along the
 * bisectors of their edges (each band clipped to the half-plane where its
 * edge is the nearest: the shadow of the convex cut outline).
 */
import { NOTE_SHADOWS, STICKY_RADIUS } from '../../model/tokens.js'

/** Color stops per gradient (spread evenly over its range). */
export const SHADE_STOPS = 12

/** @param {{blur:number}} s a shadow @return {number} Gaussian sigma of a canvas shadow (HTML: sigma = blur / 2) */
export const shadeSigma = (s) => s.blur / 2
/** @param {{blur:number}} s a shadow @return {number} outer reach of the falloff beyond the moved outline */
export const shadeExtent = (s) => 3 * shadeSigma(s)
/** @param {{x:number, y:number}} s a shadow @return {number} inner reach of the bands: what the offset can uncover, plus one unit */
export const shadeInset = (s) => Math.hypot(s.x, s.y) + 1
/** The farthest any note shadow reaches beyond the note (world units). */
export const SHADE_REACH = Math.max(...NOTE_SHADOWS.map((s) => shadeExtent(s) + Math.hypot(s.x, s.y)))

/**
 * Standard normal CDF via erf (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7).
 *
 * @param {number} z argument
 * @return {number} Φ(z)
 */
export function phi(z) {
	const x = Math.abs(z) / Math.SQRT2
	const t = 1 / (1 + 0.3275911 * x)
	const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
	return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/**
 * Shadow alpha at a signed distance from the moved outline (positive outside).
 *
 * @param {number} d distance (world units)
 * @param {{blur:number, opacity:number}} s the shadow
 * @return {number} alpha in [0, s.opacity]
 */
export function shadeAlpha(d, s) {
	return s.opacity * phi(-d / shadeSigma(s))
}

/** @param {number} a alpha @return {string} black with that alpha (4 decimals) */
const black = (a) => `rgba(0,0,0,${Math.round(a * 10000) / 10000})`

/** Per canvas context (Konva.Context): per shadow its two gradients, built on first use. */
const GRADIENTS = new WeakMap()

/**
 * @param {object} c Konva.Context
 * @param {object} s the shadow
 * @return {{band:object, corner:object}} band: linear along +y over [−inset, extent]
 *   (alpha by the distance y from the outline); corner: radial around (0, 0) over
 *   [0, STICKY_RADIUS + extent] (alpha by the distance ρ − STICKY_RADIUS)
 */
function gradientsOf(c, s) {
	let per = GRADIENTS.get(c)
	if (!per) {
		per = new Map()
		GRADIENTS.set(c, per)
	}
	let g = per.get(s)
	if (g) return g
	const inset = shadeInset(s)
	const extent = shadeExtent(s)
	const outer = STICKY_RADIUS + extent
	const band = c.createLinearGradient(0, -inset, 0, extent)
	const corner = c.createRadialGradient(0, 0, 0, 0, 0, outer)
	for (let i = 0; i < SHADE_STOPS; i++) {
		const t = i / (SHADE_STOPS - 1)
		band.addColorStop(t, black(shadeAlpha(-inset + t * (inset + extent), s)))
		corner.addColorStop(t, black(shadeAlpha(t * outer - STICKY_RADIUS, s)))
	}
	g = { band, corner }
	per.set(s, g)
	return g
}

/**
 * The shadow offset in the note's own frame: a canvas shadow falls in screen
 * direction whatever the rotation of the shape.
 *
 * @param {number} rot rotation of the note (degrees, clockwise)
 * @param {{x:number, y:number}} s the shadow
 * @return {{x:number, y:number}} offset (world units, note frame)
 */
export function shadeOffset(rot, s) {
	if (!rot) return { x: s.x, y: s.y }
	const t = rot * Math.PI / 180
	return { x: s.x * Math.cos(t) + s.y * Math.sin(t), y: -s.x * Math.sin(t) + s.y * Math.cos(t) }
}

/**
 * Clips to the half-plane {p : (p − P) · n ≥ 0} (a large quad; n unit length).
 *
 * @param {object} c context
 * @param {number} px point on the border
 * @param {number} py point on the border
 * @param {number} nx inner normal
 * @param {number} ny inner normal
 * @param {number} big half size of the quad
 */
function clipHalf(c, px, py, nx, ny, big) {
	const tx = -ny * big
	const ty = nx * big
	c.beginPath()
	c.moveTo(px + tx, py + ty)
	c.lineTo(px + tx + nx * 2 * big, py + ty + ny * 2 * big)
	c.lineTo(px - tx + nx * 2 * big, py - ty + ny * 2 * big)
	c.lineTo(px - tx, py - ty)
	c.closePath()
	c.clip()
}

const H = Math.SQRT1_2
/** Bisector normals at the ends of the cut edge: bottom minus cut, right minus cut (unit length). */
const N_BOTTOM = (() => { const x = -H; const y = 1 - H; const l = Math.hypot(x, y); return [x / l, y / l] })()
const N_RIGHT = [N_BOTTOM[1], N_BOTTOM[0]]

/**
 * Paints one shadow of a w × h note (corner radius STICKY_RADIUS, as far as
 * the size allows; a dog ear of leg ear at the bottom right) into a context
 * in the note's frame (origin at its top-left corner, the frame Konva gives
 * a sceneFunc of the note's group). Without an ear: eight fillRect calls,
 * per edge band (u along the edge, d outward) and per corner quadrant, each
 * under its own transform; with one: the bottom right quadrant gives way to
 * the cut band, and the three bands near the cut are clipped at the
 * bisectors. Nothing for an empty box.
 *
 * @param {object} c Konva.Context (any 2D context with these methods)
 * @param {number} w width (world units)
 * @param {number} h height (world units)
 * @param {number} rot rotation of the note (degrees)
 * @param {object} s the shadow (an entry of NOTE_SHADOWS)
 * @param {number} [ear] the dog ear's leg (tokens.noteEar), 0 = none
 */
export function paintShadeLayer(c, w, h, rot, s, ear = 0) {
	if (!(w > 0) || !(h > 0)) return
	const { band, corner } = gradientsOf(c, s)
	const inset = shadeInset(s)
	const extent = shadeExtent(s)
	const R = Math.min(STICKY_RADIUS, w / 2, h / 2)
	const e = ear > 0 ? Math.min(ear, w - R, h - R) : 0
	const o = shadeOffset(rot, s)
	const across = inset + extent
	const outer = STICKY_RADIUS + extent
	const big = w + h + 4 * across
	// the cut's ends (moved outline): V at the bottom, W at the right
	const vx = o.x + w - e
	const vy = o.y + h
	const wx = o.x + w
	const wy = o.y + h - e
	c.fillStyle = band
	// bottom (d = +y), top (d = −y)
	for (const [d, y] of [[1, o.y + h], [-1, o.y]]) {
		const cut = e > 0 && d === 1
		const lu = cut ? w - e - R + across : w - 2 * R
		if (!(lu > 0)) continue
		c.save()
		if (cut) clipHalf(c, vx, vy, N_BOTTOM[0], N_BOTTOM[1], big)
		c.transform(1, 0, 0, d, o.x + R, y)
		c.fillRect(0, -inset, lu, across)
		c.restore()
	}
	// right (d = +x), left (d = −x): u runs down the edge
	for (const [d, x] of [[1, o.x + w], [-1, o.x]]) {
		const cut = e > 0 && d === 1
		const lv = cut ? h - e - R + across : h - 2 * R
		if (!(lv > 0)) continue
		c.save()
		if (cut) clipHalf(c, wx, wy, N_RIGHT[0], N_RIGHT[1], big)
		c.transform(0, 1, d, 0, x, o.y + R)
		c.fillRect(0, -inset, lv, across)
		c.restore()
	}
	if (e > 0) {
		// the cut: u from W to V, d outward (1, 1) / √2
		c.save()
		clipHalf(c, vx, vy, -N_BOTTOM[0], -N_BOTTOM[1], big)
		clipHalf(c, wx, wy, -N_RIGHT[0], -N_RIGHT[1], big)
		c.transform(-H, H, H, H, wx, wy)
		c.fillRect(-across, -inset, e * Math.SQRT2 + 2 * across, across)
		c.restore()
	}
	// the corners: the outward quadrant around each corner centre
	c.fillStyle = corner
	for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
		if (e > 0 && sx > 0 && sy > 0) continue
		c.save()
		c.transform(sx, 0, 0, sy, o.x + (sx < 0 ? R : w - R), o.y + (sy < 0 ? R : h - R))
		c.fillRect(0, 0, outer, outer)
		c.restore()
	}
}

/**
 * Paints every note shadow (NOTE_SHADOWS, far first) of a w × h note.
 *
 * @param {object} c Konva.Context (any 2D context with these methods)
 * @param {number} w width (world units)
 * @param {number} h height (world units)
 * @param {number} rot rotation of the note (degrees)
 * @param {number} [ear] the dog ear's leg, 0 = none
 */
export function paintShade(c, w, h, rot, ear = 0) {
	for (const s of NOTE_SHADOWS) paintShadeLayer(c, w, h, rot, s, ear)
}
