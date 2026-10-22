/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Drop shadow of a sticky note without canvas shadowBlur (SPEC-M1 §9.5
 * WP-S4, WebKit fixes of stage 4). In the scene lab, WebKit spent most of a
 * static-layer draw on the blurred note shadows: every blurred fill is a
 * blur of its own (a sharp rectangle as the shadow caster did not help),
 * and a pan at 100 % ran at about 25 fps with them against about 59 fps
 * without them (Chromium blurs rounded rectangles cheaply and does not care).
 *
 * The shadow is painted instead with gradients that follow the falloff of a
 * canvas shadow with shadowBlur SHADOW.blur: a Gaussian with sigma =
 * SHADOW.blur / 2 and peak alpha SHADOW.opacity, around the note's outline
 * moved by (SHADOW.x, SHADOW.y) in screen direction (a canvas shadow offset
 * ignores the rotation). Four edge bands share ONE linear gradient, the four
 * corners ONE radial gradient, both built once per canvas context and placed
 * by transforms; only the band around the outline is painted, the opaque
 * note covers the rest. The shadow reaches SHADE_EXTENT (3 sigma) beyond the
 * moved outline, so at most 3 sigma + |offset| beyond the note: the index
 * padding of a note (SceneModel STICKY_PAD = SHADOW.blur · 1.5 + |SHADOW.y|).
 * Like the blurred shadow it scales with the camera (world units) and is
 * drawn at LOD 0 only (the sticky builder hides the node at LOD 1).
 */
import { SHADOW, STICKY_RADIUS } from '../../model/tokens.js'

/** Gaussian sigma of a canvas shadow with shadowBlur SHADOW.blur (HTML: sigma = blur / 2). */
export const SHADE_SIGMA = SHADOW.blur / 2
/** Outer reach of the falloff beyond the moved outline (world units). */
export const SHADE_EXTENT = 3 * SHADE_SIGMA
/** Inner reach of the edge bands: what the offset can uncover, plus one unit under the note's edge. */
export const SHADE_INSET = Math.hypot(SHADOW.x, SHADOW.y) + 1
/** Color stops per gradient (spread evenly over its range). */
export const SHADE_STOPS = 12

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
 * @return {number} alpha in [0, SHADOW.opacity]
 */
export function shadeAlpha(d) {
	return SHADOW.opacity * phi(-d / SHADE_SIGMA)
}

/** @param {number} a alpha @return {string} black with that alpha (4 decimals) */
const black = (a) => `rgba(0,0,0,${Math.round(a * 10000) / 10000})`

/** The two shared gradients per canvas context (Konva.Context), built on first use. */
const GRADIENTS = new WeakMap()

/**
 * @param {object} c Konva.Context
 * @return {{band:object, corner:object}} band: linear along +y over [−SHADE_INSET, SHADE_EXTENT]
 *   (alpha by the distance y from the outline); corner: radial around (0, 0) over
 *   [0, STICKY_RADIUS + SHADE_EXTENT] (alpha by the distance ρ − STICKY_RADIUS)
 */
function gradientsOf(c) {
	let g = GRADIENTS.get(c)
	if (g) return g
	const outer = STICKY_RADIUS + SHADE_EXTENT
	const band = c.createLinearGradient(0, -SHADE_INSET, 0, SHADE_EXTENT)
	const corner = c.createRadialGradient(0, 0, 0, 0, 0, outer)
	for (let i = 0; i < SHADE_STOPS; i++) {
		const t = i / (SHADE_STOPS - 1)
		band.addColorStop(t, black(shadeAlpha(-SHADE_INSET + t * (SHADE_INSET + SHADE_EXTENT))))
		corner.addColorStop(t, black(shadeAlpha(t * outer - STICKY_RADIUS)))
	}
	g = { band, corner }
	GRADIENTS.set(c, g)
	return g
}

/**
 * The shadow offset in the note's own frame: a canvas shadow falls in screen
 * direction whatever the rotation of the shape.
 *
 * @param {number} rot rotation of the note (degrees, clockwise)
 * @return {{x:number, y:number}} offset (world units, note frame)
 */
export function shadeOffset(rot) {
	if (!rot) return { x: SHADOW.x, y: SHADOW.y }
	const t = rot * Math.PI / 180
	return { x: SHADOW.x * Math.cos(t) + SHADOW.y * Math.sin(t), y: -SHADOW.x * Math.sin(t) + SHADOW.y * Math.cos(t) }
}

/**
 * Paints the shadow of a w × h note (corner radius STICKY_RADIUS, as far as
 * the size allows) into a context in the note's frame (origin at its
 * top-left corner, the frame Konva gives a sceneFunc of the note's group).
 * Eight fillRect calls: per edge band (u along the edge, d outward) and per
 * corner quadrant, each under its own transform; nothing for an empty box.
 *
 * @param {object} c Konva.Context (any 2D context with these methods)
 * @param {number} w width (world units)
 * @param {number} h height (world units)
 * @param {number} rot rotation of the note (degrees)
 */
export function paintShade(c, w, h, rot) {
	if (!(w > 0) || !(h > 0)) return
	const { band, corner } = gradientsOf(c)
	const R = Math.min(STICKY_RADIUS, w / 2, h / 2)
	const o = shadeOffset(rot)
	const across = SHADE_INSET + SHADE_EXTENT
	const outer = STICKY_RADIUS + SHADE_EXTENT
	const lu = w - 2 * R
	const lv = h - 2 * R
	c.fillStyle = band
	if (lu > 0) {
		// bottom (d = +y), top (d = −y)
		for (const [d, y] of [[1, o.y + h], [-1, o.y]]) {
			c.save()
			c.transform(1, 0, 0, d, o.x + R, y)
			c.fillRect(0, -SHADE_INSET, lu, across)
			c.restore()
		}
	}
	if (lv > 0) {
		// right (d = +x), left (d = −x): u runs down the edge
		for (const [d, x] of [[1, o.x + w], [-1, o.x]]) {
			c.save()
			c.transform(0, 1, d, 0, x, o.y + R)
			c.fillRect(0, -SHADE_INSET, lv, across)
			c.restore()
		}
	}
	// the corners: the outward quadrant around each corner centre
	c.fillStyle = corner
	for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
		c.save()
		c.transform(sx, 0, 0, sy, o.x + (sx < 0 ? R : w - R), o.y + (sy < 0 ? R : h - R))
		c.fillRect(0, 0, outer, outer)
		c.restore()
	}
}
