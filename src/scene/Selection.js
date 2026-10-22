/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Local selection (SPEC-M0 §6.3): an ordered set of item ids plus the helper
 * that picks the items a drag actually moves. Descendants of a selected frame
 * are not moved themselves; they follow through the model's cascade.
 */

/**
 * Selected items without a selected ancestor.
 *
 * @param {Iterable<string>} ids selection
 * @param {{get(id:string):(object|undefined)}} model SceneModel (parent chain via get(id).parent)
 * @return {string[]} top-level ids, in the given order, unknown ids dropped
 */
export function topLevel(ids, model) {
	const set = new Set(ids)
	const out = []
	for (const id of set) {
		const it = model.get(id)
		if (!it) continue
		let p = it.parent
		let covered = false
		const seen = new Set([id])
		for (let depth = 0; depth < 8 && p !== null && p !== undefined && !seen.has(p); depth++) {
			if (set.has(p)) {
				covered = true
				break
			}
			seen.add(p)
			const parent = model.get(p)
			p = parent ? parent.parent : null
		}
		if (!covered) out.push(id)
	}
	return out
}

export class Selection {
	/** @type {string[]} */
	#ids = []

	/** @return {string[]} copy of the selected ids */
	values() {
		return this.#ids.slice()
	}

	/** @return {number} */
	get size() {
		return this.#ids.length
	}

	/**
	 * @param {string} id item id
	 * @return {boolean}
	 */
	has(id) {
		return this.#ids.includes(id)
	}

	/**
	 * @param {Iterable<string>} ids new selection (duplicates dropped)
	 * @return {boolean} true when it changed
	 */
	set(ids) {
		const next = [...new Set(ids)].filter((id) => typeof id === 'string')
		if (next.length === this.#ids.length && next.every((id, i) => id === this.#ids[i])) {
			return false
		}
		this.#ids = next
		return true
	}

	/**
	 * @param {string} id item id to add or remove
	 * @return {boolean} true (always a change)
	 */
	toggle(id) {
		const i = this.#ids.indexOf(id)
		if (i >= 0) {
			this.#ids.splice(i, 1)
		} else {
			this.#ids.push(id)
		}
		return true
	}

	/** @return {boolean} true when it changed */
	clear() {
		return this.set([])
	}

	/**
	 * Drops ids the model no longer has.
	 *
	 * @param {{has(id:string):boolean}} model SceneModel
	 * @return {boolean} true when it changed
	 */
	prune(model) {
		return this.set(this.#ids.filter((id) => model.has(id)))
	}
}
