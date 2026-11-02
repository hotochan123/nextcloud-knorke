/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The entries of own and adopted shape libraries (factory job 203), loaded
 * once per page (route 48) and kept while the shapes panel opens and closes:
 * libEntries(id) gives the same promise until it failed or forgetLib(id)
 * (deleted) drops it. An entry is {name, uri, w, h}; one whose picture does
 * not pass model/shapeImage.js placeablePicture is null in its place, so
 * the indexes of the panel's entry ids stay.
 */
import { shapeLibEntries } from '../api/shapeLibs.js'
import { placeablePicture } from '../model/shapeImage.js'

/** library id → Promise of its entries */
const cache = new Map()

/**
 * @param {number|string} id library id
 * @param {(id: number) => Promise<object[]>} [load] route 48 (tests)
 * @return {Promise<Array<({name: string, uri: string, w: number, h: number}|null)>>} its entries; [] when it cannot be loaded
 */
export function libEntries(id, load = shapeLibEntries) {
	const key = String(id)
	let p = cache.get(key)
	if (!p) {
		p = load(Number(id)).then((list) => list.map((e) => {
			const pic = placeablePicture({ uri: e?.img, w: e?.w, h: e?.h })
			return pic ? { name: String(e.name ?? ''), ...pic } : null
		}), (err) => {
			console.warn('[knorke] shape library not loaded', err)
			cache.delete(key)
			return []
		})
		cache.set(key, p)
	}
	return p
}

/** @param {number|string} id library id whose entries are loaded again next time */
export function forgetLib(id) {
	cache.delete(String(id))
}
