/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Own shape libraries (factory job 203, routes 46–54): one caller per
 * route, through api/boards.js call (CSRF headers, the 412 rule, a JSON body
 * on every POST). Bodies carry only the keys the server allows
 * (JsonBody::read answers 400 for any other):
 *   createShapeLib    name, entries
 *   renameShapeLib    name
 *   suggestShapeLib   note (only when there is one)
 *   adoptShapeLib     an empty body
 * Errors stay HttpErrors of sync/http.js: 409 library_limit and
 * suggestion_limit carry body.max, 404 not_found a library that is gone
 * (or a foreign one), 403 forbidden the admin routes for anyone else and
 * every route for an account of the Guests app.
 */
import { api } from '../util/routes.js'
import { call } from './boards.js'

/** @param {unknown} x a list of an answer @return {Array} it, [] when it is none */
const list = (x) => (Array.isArray(x) ? x : [])

/**
 * Route 46: the right of this account, the adopted libraries and its own ones (names only, no pictures).
 *
 * @return {Promise<{right: ('suggest'|'save'|null), adopted: object[], own: object[]}>}
 */
export async function listShapeLibs() {
	const res = await call(api.listShapeLibs())
	return { right: res?.right === 'suggest' || res?.right === 'save' ? res.right : null, adopted: list(res?.adopted), own: list(res?.own) }
}

/**
 * Route 47: a new own library.
 *
 * @param {string} name its name
 * @param {Array<{name: string, img: string, w: number, h: number}>} entries its shapes
 * @return {Promise<{id: number}>}
 */
export function createShapeLib(name, entries) {
	return call(api.createShapeLib(), { name, entries })
}

/**
 * Route 48: the entries of a library, with their pictures.
 *
 * @param {number} id library id
 * @return {Promise<Array<{name: string, img: string, w: number, h: number}>>}
 */
export async function shapeLibEntries(id) {
	const res = await call(api.showShapeLib(id))
	return list(res?.entries)
}

/**
 * Route 49: renames an own library (an adopted one: admins).
 *
 * @param {number} id library id
 * @param {string} name the new name
 * @return {Promise<{id: number, name: string}>}
 */
export function renameShapeLib(id, name) {
	return call(api.updateShapeLib(id), { name })
}

/**
 * Route 50: deletes an own library, an adopted one (admins) or rejects a suggestion (admins).
 *
 * @param {number} id library id
 * @return {Promise<{deleted: true}>}
 */
export function deleteShapeLib(id) {
	return call(api.deleteShapeLib(id))
}

/**
 * Route 51: suggests an own library to the admins (an admin: adopts a copy at once).
 *
 * @param {number} id library id
 * @param {string} [note] a note to the admins
 * @return {Promise<{id: number, state: string}>}
 */
export function suggestShapeLib(id, note = '') {
	return call(api.suggestShapeLib(id), note ? { note } : {})
}

/**
 * Route 52 (admins): adopts a suggestion.
 *
 * @param {number} id library id
 * @return {Promise<{id: number}>}
 */
export function adoptShapeLib(id) {
	return call(api.adoptShapeLib(id), {})
}

/**
 * Route 53 (admins): the open suggestions (oldest first) and the adopted libraries.
 *
 * @return {Promise<{suggestions: object[], adopted: object[]}>}
 */
export async function reviewShapeLibs() {
	const res = await call(api.reviewShapeLibs())
	return { suggestions: list(res?.suggestions), adopted: list(res?.adopted) }
}

/**
 * Route 54: withdraws the suggestion of an own library.
 *
 * @param {number} id library id
 * @return {Promise<{withdrawn: true}>}
 */
export function withdrawShapeLib(id) {
	return call(api.withdrawShapeLib(id))
}
