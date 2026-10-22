/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Deep freeze for the shared tables of the model (registry, tools, shapes):
 * a table that a caller mutates by accident would change every later item,
 * tool or shape, so all of them are frozen down to the last array.
 */

/**
 * @template T
 * @param {T} o object to freeze, including nested objects and arrays
 * @return {T} the same object
 */
export function deepFreeze(o) {
	for (const v of Object.values(o)) {
		if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
			deepFreeze(v)
		}
	}
	return Object.freeze(o)
}
