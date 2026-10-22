/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Groups of items (M2, SPEC-M1 §1.2 "(R20) Gruppieren"), pure: no scene, no
 * DOM. `group` of a WireItem is a group id (a ULID) or null; the server
 * stores it per item (group_id) and dissolves a group that loses all but
 * one member. The SceneModel keeps the index (membersOf, groupSize).
 *
 * - The group of an item is its `group` only while the model knows at
 *   least two items with that value (groupOf); with fewer the item counts
 *   as ungrouped for selection, outline, ungroup and blocks (no data is
 *   written for that).
 * - Members of G: every item of the model with group G.
 * - A fully selected group: every member of G is in the ids.
 * - A block: a fully selected group, or a single item.
 * - The current item: the last id of a selection; expandGroups keeps it last.
 *
 * Functions:
 * - groupOf(model, id), expandGroups(model, ids), wholeGroups(model, ids),
 *   heldGroup(model, g) (a member is locked, model/locks.js),
 *   movableIds(model, ids) (without locked items and without every member of
 *   a held group), blocksOf(model, ids)
 * - groupPlan(model, ids): what "Group items" would do (C and the first
 *   reason it is blocked: 'frame', 'locked', 'parent'); board/actions.js
 *   groupItems builds its ops from it
 * - ungroupPlan(model, ids): the groups "Ungroup" would dissolve, blocked
 *   'locked' while a member of one of them is locked
 * - groupSummary(model, ids, {writable}): the fields of selection v2
 *   (groupable, groupBlock, grouped, ungroupBlock, oneGroup)
 *
 * The model is read through get, has, groupSize, membersOf and (groupPlan)
 * sortByOrder. Cost (round 1, code review): groupOf asks groupSize (the
 * size of the index set, no sorting; membersOf as a fallback for a model
 * without it); every function asks membersOf at most once per group and
 * call, and an item without a group never asks either. So a group of 5000
 * notes costs linear time, never 5000 sorts of 5000 ids.
 */
import { isLocked } from './locks.js'
import { isGroupable, typeInfo } from './registry.js'

/**
 * @param {object} model SceneModel
 * @param {string} g group id
 * @return {string[]} its members in stacking order ([] without a group index)
 */
function members(model, g) {
	return typeof model?.membersOf === 'function' ? model.membersOf(g) ?? [] : []
}

/**
 * @param {object} model SceneModel
 * @param {string} g group id
 * @return {number} how many items the model knows with this group (groupSize, else membersOf)
 */
function sizeOf(model, g) {
	return typeof model?.groupSize === 'function' ? model.groupSize(g) : members(model, g).length
}

/**
 * @param {object} model SceneModel
 * @param {string} id item id
 * @return {string|null} the item's group while the model knows at least two
 *   items with it, else null (also for an unknown id)
 */
export function groupOf(model, id) {
	const g = model?.has?.(id) ? model.get(id)?.group : null
	if (typeof g !== 'string') {
		return null
	}
	return sizeOf(model, g) >= 2 ? g : null
}

/**
 * The ids plus every member of their groups. The given ids keep their
 * order; the added members come first (stacking order), so the current
 * item (the last id) stays the last.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {string[]} new array without duplicates
 */
export function expandGroups(model, ids) {
	const list = [...new Set(ids ?? [])]
	const have = new Set(list)
	const seen = new Set()
	const extra = []
	for (const id of list) {
		const g = groupOf(model, id)
		if (g === null || seen.has(g)) {
			continue
		}
		seen.add(g)
		for (const m of members(model, g)) {
			if (!have.has(m)) {
				have.add(m)
				extra.push(m)
			}
		}
	}
	return [...extra, ...list]
}

/**
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {string[]} the groups whose members all lie in ids (each once, in order of first appearance)
 */
export function wholeGroups(model, ids) {
	const set = new Set(ids ?? [])
	const seen = new Set()
	const out = []
	for (const id of set) {
		const g = groupOf(model, id)
		if (g === null || seen.has(g)) {
			continue
		}
		seen.add(g)
		if (members(model, g).every((m) => set.has(m))) {
			out.push(g)
		}
	}
	return out
}

/**
 * @param {object} model SceneModel
 * @param {string|null} g group id
 * @return {boolean} a member of g is locked: the group does not move as a whole
 */
export function heldGroup(model, g) {
	return typeof g === 'string' && members(model, g).some((m) => isLocked(model.get(m)))
}

/**
 * The items a move, "Align", "Distribute", "Tidy up" or an arrow key may
 * move: known, not locked (M2, R20), and not a member of a group with a
 * locked member (heldGroup, once per group; also a member selected alone).
 * Order kept.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {string[]}
 */
export function movableIds(model, ids) {
	const held = new Map()
	return (ids ?? []).filter((id) => {
		if (!model?.has?.(id) || isLocked(model.get(id))) {
			return false
		}
		const g = groupOf(model, id)
		if (g === null) {
			return true
		}
		if (!held.has(g)) {
			held.set(g, heldGroup(model, g))
		}
		return !held.get(g)
	})
}

/**
 * The blocks of a selection: every fully selected group is one block (its
 * members in the order of ids), every other id a block of its own. Blocks
 * in the order of their first id.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {string[][]}
 */
export function blocksOf(model, ids) {
	const list = [...new Set(ids ?? [])]
	const whole = new Set(wholeGroups(model, list))
	const byGroup = new Map()
	const blocks = []
	for (const id of list) {
		const g = groupOf(model, id)
		if (g === null || !whole.has(g)) {
			blocks.push([id])
			continue
		}
		let block = byGroup.get(g)
		if (!block) {
			block = []
			byGroup.set(g, block)
			blocks.push(block)
		}
		block.push(id)
	}
	return blocks
}

/**
 * What "Group items" would put into the new group (SPEC-M1 §1.2 (R20)):
 * C = expandGroups(ids) without connectors and without unknown types (no
 * members, they may be selected; a frame stays in C and blocks), in
 * stacking order. Blocked, the first reason wins: a frame in C ('frame'),
 * a locked item in C ('locked'), items of C with different parents
 * ('parent').
 *
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {{ids: string[], blocked: (null|'frame'|'locked'|'parent')}}
 */
export function groupPlan(model, ids) {
	const known = expandGroups(model, ids).filter((id) => model?.has?.(id))
	const c = known.filter((id) => {
		const t = model.get(id).t
		return isGroupable(t) || typeInfo(t).container
	})
	const sorted = typeof model.sortByOrder === 'function' ? model.sortByOrder(c) : c
	let blocked = null
	if (sorted.some((id) => typeInfo(model.get(id).t).container)) {
		blocked = 'frame'
	} else if (sorted.some((id) => isLocked(model.get(id)))) {
		blocked = 'locked'
	} else if (new Set(sorted.map((id) => model.get(id).parent ?? null)).size > 1) {
		blocked = 'parent'
	}
	return { ids: sorted, blocked }
}

/**
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {boolean} ids are exactly the members of one group
 */
export function isOneGroup(model, ids) {
	const set = new Set(ids ?? [])
	if (set.size < 2) {
		return false
	}
	const first = set.values().next().value
	const g = groupOf(model, first)
	if (g === null || sizeOf(model, g) !== set.size) {
		return false
	}
	return members(model, g).every((id) => set.has(id))
}

/**
 * The groups "Ungroup" would dissolve: every group of the ids (groupOf);
 * blocked 'locked' while a member of one of them is locked (it could not be
 * patched, itemlocked).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids item ids
 * @return {{groups: string[], blocked: (null|'locked')}}
 */
export function ungroupPlan(model, ids) {
	const groups = new Set()
	for (const id of new Set(ids ?? [])) {
		const g = groupOf(model, id)
		if (g !== null) {
			groups.add(g)
		}
	}
	const list = [...groups]
	return { groups: list, blocked: list.some((g) => heldGroup(model, g)) ? 'locked' : null }
}

/**
 * The group fields of selection v2 (BoardSession.selectionInfo):
 * - groupable: how many items "Group items" would put into a NEW group
 *   (groupPlan C, frames not counted); 0 when C is exactly the members of
 *   one group (round 1: a single member after the second click, or a group
 *   with connectors in the selection: grouping would change nothing, so
 *   neither the bar nor the menu offers it)
 * - groupBlock: null, 'frame', 'locked' or 'parent' (groupPlan)
 * - grouped: how many groups the selection touches
 * - ungroupBlock: null or 'locked' (ungroupPlan)
 * - oneGroup: the selection is exactly the members of one group
 * All 0, null or false while the session cannot write (writable false).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected ids
 * @param {{writable?: boolean}} [o] writable: the session may write now
 * @return {{groupable: number, groupBlock: (string|null), grouped: number, ungroupBlock: (string|null), oneGroup: boolean}}
 */
export function groupSummary(model, ids, { writable = true } = {}) {
	if (!writable || !model) {
		return { groupable: 0, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false }
	}
	const plan = groupPlan(model, ids)
	const un = ungroupPlan(model, ids)
	return {
		groupable: isOneGroup(model, plan.ids) ? 0 : plan.ids.filter((id) => !typeInfo(model.get(id).t).container).length,
		groupBlock: plan.blocked,
		grouped: un.groups.length,
		ungroupBlock: un.blocked,
		oneGroup: isOneGroup(model, (ids ?? []).filter((id) => model.has(id))),
	}
}
