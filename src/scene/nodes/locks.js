/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Lock symbols of locked items (M2, SPEC-M1 §1.2 "(R20) Sperren", pattern of
 * badges.js): ONE Konva.Shape in the uiGroup (buildLocks, listening false)
 * whose sceneFunc paints, in world units of the camera and with sizes in
 * screen px, a padlock (LOCK_ICON_PX) on a white rounded square with a 1-px
 * edge for every locked item in view, rotated with its item:
 * - notes and shapes: inside the top-left corner, LOCK_INSET_PX from both
 *   edges (place 'inside')
 * - text items, frames, and shapes whose text starts in the top-left corner
 *   (style.align left and style.valign top): OUTSIDE, left of the top-left
 *   corner, top-aligned, LOCK_INSET_PX away (place 'outside'), so the
 *   symbol never covers the first characters of a text nor the content of a
 *   frame (job 023 review round 1; spec §8 said "inside" for every box)
 * - a connector: centred on the middle of its route (by arc length, the
 *   label point; place 'route'), or with a label, at LOD 0 (the only level
 *   that paints the label), left of the label box, LOCK_INSET_PX away,
 *   centred on it (place 'label'); at LOD 1 the label is not drawn, so the
 *   symbol stays on the route; not at LOD 2, where connectors are not drawn
 * It is drawn in every mode and at every LOD, at LOD 2 by the uiGroup above
 * the coarse painting; during a CSS gesture it moves and scales with the
 * canvas like the vote badges. The name of the locker is never painted
 * (only the DOM shows it: the badge of the context bar, the Unlock label).
 * The renderer keeps the node only while a locked item is in view, so a
 * board without one has no extra Konva shape.
 *
 * planLocks() decides what is drawn (stats().locks counts what the last
 * painting drew); paintLocks() draws a plan into a 2D context. Both are pure
 * (model and a context in, canvas calls out) and unit tested in Node
 * (tests/js/scene/locks.test.mjs).
 */
import { isLocked } from '../../model/locks.js'
import { fieldValue, typeInfo } from '../../model/registry.js'
import {
	LOCK_BORDER, LOCK_BORDER_PX, LOCK_COLOR, LOCK_FILL, LOCK_ICON_PX, LOCK_INSET_PX, LOCK_PAD_PX, LOCK_RADIUS_PX,
} from '../../model/tokens.js'
import { SHAPE_BASE } from './common.js'

/**
 * @typedef {'inside'|'outside'|'route'|'label'} LockPlace
 * @typedef {{id:string, x:number, y:number, r:number, place:LockPlace}} LockItem
 *   x, y: the item's top-left corner (world, rotated with the item) for
 *   inside/outside, the middle of a connector's route for route, the left
 *   edge of its label box (x) at the box's middle (y) for label; r: rotation
 *   in degrees
 * @typedef {{items:LockItem[]}} LockPlan
 */

/**
 * The top-left corner of a box rotated (degrees, clockwise) around its centre.
 *
 * @param {{x:number, y:number, w:number, h:number, r:number}} a absolute box
 * @return {{x:number, y:number}} world point
 */
export function topLeft(a) {
	if (!a.r) return { x: a.x, y: a.y }
	const t = a.r * Math.PI / 180
	const dx = -a.w / 2
	const dy = -a.h / 2
	return { x: a.x + a.w / 2 + dx * Math.cos(t) - dy * Math.sin(t), y: a.y + a.h / 2 + dx * Math.sin(t) + dy * Math.cos(t) }
}

/**
 * Where the symbol of a box item goes: outside for text items, frames and
 * shapes whose text starts in the top-left corner, else inside.
 *
 * @param {object} it WireItem
 * @return {'inside'|'outside'}
 */
export function boxPlace(it) {
	if (it.t === 'text' || typeInfo(it.t).container) return 'outside'
	if (it.t === 'shape' && fieldValue(it, 'style.align') === 'left' && fieldValue(it, 'style.valign') === 'top') return 'outside'
	return 'inside'
}

/**
 * The drawn square of a symbol (edge included) in the local coordinates of
 * its plan point (before the item's rotation), in world units of this scale.
 *
 * @param {LockPlace} place where it goes
 * @param {number} scale camera scale (screen px = world × scale)
 * @return {{x:number, y:number, size:number}} top-left corner and side length
 */
export function lockSquare(place, scale) {
	const px = 1 / (scale > 0 ? scale : 1)
	const edge = LOCK_BORDER_PX * px
	const size = (LOCK_ICON_PX + 2 * LOCK_PAD_PX) * px + 2 * edge
	const inset = LOCK_INSET_PX * px
	switch (place) {
	case 'outside': return { x: -inset - size, y: 0, size }
	case 'route': return { x: -size / 2, y: -size / 2, size }
	case 'label': return { x: -inset - size, y: -size / 2, size }
	default: return { x: inset - edge, y: inset - edge, size }
	}
}

/**
 * What the lock painting draws now.
 *
 * @param {object} model SceneModel
 * @param {Iterable<string>} ids the item ids in view (the renderer's culled set)
 * @param {{lod?:number, offsetOf?:((id:string) => ({dx:number, dy:number}|null))}} [opts] lod: the
 *   level drawn (connectors get nothing at LOD 2); offsetOf: remote drag preview offset of an item
 * @return {LockPlan|null} one entry per locked item, in the order of ids; null without one
 */
export function planLocks(model, ids, { lod = 0, offsetOf = null } = {}) {
	const items = []
	for (const id of ids) {
		const it = model.get(id)
		if (!it || !isLocked(it)) continue
		if (typeInfo(it.t).hit === 'line') {
			if (lod === 2) continue
			const route = typeof model.routeOf === 'function' ? model.routeOf(id) : null
			const label = route?.label ?? null
			// the label is painted at LOD 0 only (nodes/connector.js): beside it there, else on the route
			if (lod === 0 && label && [label.x, label.y, label.h].every(Number.isFinite)) {
				items.push({ id, x: label.x, y: label.y + label.h / 2, r: 0, place: 'label' })
				continue
			}
			const g = route?.geom ?? (typeof model.geometryOf === 'function' ? model.geometryOf(id) : null)
			const at = g?.labelAt ?? null
			if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
				items.push({ id, x: at.x, y: at.y, r: 0, place: 'route' })
			}
			continue
		}
		const a = model.abs(id)
		if (!a) continue
		const off = offsetOf ? offsetOf(id) : null
		const c = topLeft(off ? { ...a, x: a.x + off.dx, y: a.y + off.dy } : a)
		items.push({ id, x: c.x, y: c.y, r: a.r || 0, place: boxPlace(it) })
	}
	return items.length > 0 ? { items } : null
}

/**
 * The path of a rounded rectangle (arcs and lines only, no roundRect).
 *
 * @param {object} ctx 2D context
 * @param {number} x left
 * @param {number} y top
 * @param {number} w width
 * @param {number} h height
 * @param {number} r corner radius
 */
function roundedRect(ctx, x, y, w, h, r) {
	const k = Math.max(0, Math.min(r, w / 2, h / 2))
	ctx.beginPath()
	ctx.moveTo(x + k, y)
	ctx.lineTo(x + w - k, y)
	ctx.arc(x + w - k, y + k, k, -Math.PI / 2, 0)
	ctx.lineTo(x + w, y + h - k)
	ctx.arc(x + w - k, y + h - k, k, 0, Math.PI / 2)
	ctx.lineTo(x + k, y + h)
	ctx.arc(x + k, y + h - k, k, Math.PI / 2, Math.PI)
	ctx.lineTo(x, y + k)
	ctx.arc(x + k, y + k, k, Math.PI, 3 * Math.PI / 2)
	ctx.closePath()
}

/**
 * Paints a plan into a 2D context that already carries the camera transform
 * (world units): per item the edged white square and the padlock (body and
 * shackle) in LOCK_COLOR, sizes in screen px.
 *
 * @param {object} ctx 2D context (Konva.Context or a canvas context)
 * @param {LockPlan|null} plan plan
 * @param {number} scale camera scale (screen px = world × scale)
 * @return {number} symbols painted
 */
export function paintLocks(ctx, plan, scale) {
	if (!plan || plan.items.length === 0) return 0
	const px = 1 / (scale > 0 ? scale : 1)
	const icon = LOCK_ICON_PX * px
	const pad = LOCK_PAD_PX * px
	const box = icon + 2 * pad
	const edge = LOCK_BORDER_PX * px
	const radius = LOCK_RADIUS_PX * px
	for (const it of plan.items) {
		ctx.save()
		ctx.translate(it.x, it.y)
		if (it.r) ctx.rotate(it.r * Math.PI / 180)
		// the white square without its edge
		const sq = lockSquare(it.place, scale)
		const ox = sq.x + edge
		const oy = sq.y + edge
		ctx.fillStyle = LOCK_BORDER
		roundedRect(ctx, ox - edge, oy - edge, box + 2 * edge, box + 2 * edge, radius + edge)
		ctx.fill()
		ctx.fillStyle = LOCK_FILL
		roundedRect(ctx, ox, oy, box, box, radius)
		ctx.fill()
		// the padlock in a 16-unit grid: body 10 × 7 at (3, 8), shackle radius 3 above it
		const u = icon / 16
		const x0 = ox + pad
		const y0 = oy + pad
		ctx.fillStyle = LOCK_COLOR
		ctx.fillRect(x0 + 3 * u, y0 + 8 * u, 10 * u, 7 * u)
		ctx.strokeStyle = LOCK_COLOR
		ctx.lineWidth = 2 * u
		ctx.beginPath()
		ctx.moveTo(x0 + 5 * u, y0 + 8 * u)
		ctx.lineTo(x0 + 5 * u, y0 + 5 * u)
		ctx.arc(x0 + 8 * u, y0 + 5 * u, 3 * u, Math.PI, 0)
		ctx.lineTo(x0 + 11 * u, y0 + 8 * u)
		ctx.stroke()
		ctx.restore()
	}
	return plan.items.length
}

/**
 * The one lock node of the uiGroup.
 *
 * @param {{Shape:Function}} ctx builder context
 * @param {(context:object) => void} paint paints the symbols into the Konva context
 * @return {object} Konva.Shape without hit graph
 */
export function buildLocks(ctx, paint) {
	const node = new ctx.Shape({
		...SHAPE_BASE,
		sceneFunc: (context) => paint(context),
	})
	node.transformsEnabled('position')
	return node
}
