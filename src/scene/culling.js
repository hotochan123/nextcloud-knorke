/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Viewport culling by detaching (SPEC-M0 §6.3), the pure part: which nodes
 * enter the static layer and which leave it. The renderer removes leaving
 * nodes from the layer (node.remove()) instead of hiding them, and builds a
 * node only when its item enters for the first time.
 */

/**
 * @param {Set<string>} prev ids attached to the static layer now
 * @param {Iterable<string>} hits ids whose index box intersects viewport + margin
 * @param {Set<string>} exempt ids culling never touches (dragged or previewed nodes
 *   live in the overlay layer; an exempt id that is attached stays attached)
 * @return {{enter:string[], leave:string[], next:Set<string>}} next = attached set afterwards
 */
export function diffVisible(prev, hits, exempt) {
	const next = new Set()
	for (const id of hits) {
		if (!exempt.has(id)) next.add(id)
	}
	for (const id of prev) {
		if (exempt.has(id)) next.add(id)
	}
	const enter = []
	for (const id of next) {
		if (!prev.has(id)) enter.push(id)
	}
	const leave = []
	for (const id of prev) {
		if (!next.has(id)) leave.push(id)
	}
	return { enter, leave, next }
}
