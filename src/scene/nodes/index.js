/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Node builder per item type (SPEC-M0 §6.3, SPEC-M1 §6.3). Every spec has
 *   build(ctx, item, abs, lod, textHidden) → Entry {root, parts, lod, …}
 *   update(ctx, entry, item, abs, fields, lod) → boolean (true = rebuild)
 *   setLod(ctx, entry, item, abs, lod)
 *   setTextHidden(entry, hidden)
 * and optionally (text items) scaleSensitive + levelOf(item, lod, scale):
 * the level the renderer passes as `lod` depends on the scale inside LOD 1.
 * ctx is {Group, Rect, Text, Shape, Line, shadows}; every shape is built
 * with ...SHAPE_BASE (no hit graph).
 * Routed specs (connector, spec.routed): the renderer passes the model's
 * route (SceneModel.routeOf) instead of the absolute box and places them
 * with spec.place(ctx, entry, item, route) instead of place().
 * Unknown types get the placeholder; nodeSpecFor never throws.
 */
import { connector } from './connector.js'
import { frame } from './frame.js'
import { placeholder } from './placeholder.js'
import { shape } from './shape.js'
import { sticky } from './sticky.js'
import { text } from './text.js'

const SPECS = Object.freeze({ sticky, frame, shape, text, connector })

/**
 * @param {unknown} t item type
 * @return {object} node spec (own keys only: 'constructor' gets the placeholder)
 */
export function nodeSpecFor(t) {
	return typeof t === 'string' && Object.prototype.hasOwnProperty.call(SPECS, t) ? SPECS[t] : placeholder
}

export { place } from './common.js'
