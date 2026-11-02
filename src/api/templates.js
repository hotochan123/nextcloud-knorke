/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Template suggestions (factory job 182, routes 28–34): one caller per
 * route, through api/boards.js call (CSRF headers, the 412 rule, a JSON body
 * on every POST). Bodies carry only the keys the server allows
 * (JsonBody::read answers 400 for any other):
 *   createTemplate   name, note, content, sketch
 *   renameTemplate   name (built here, nothing else)
 *   adoptTemplate    an empty body
 * Errors stay HttpErrors of sync/http.js: 409 suggestion_limit carries
 * body.max, 404 not_found a template that is gone (or a foreign
 * suggestion), 403 forbidden the admin routes for anyone else.
 */
import { api } from '../util/routes.js'
import { call, pick } from './boards.js'

/** Body keys of route 29. */
export const CREATE_KEYS = Object.freeze(['name', 'note', 'content', 'sketch'])

/** @param {unknown} x a list of an answer @return {Array} it, [] when it is none */
const list = (x) => (Array.isArray(x) ? x : [])

/**
 * Route 28: the right of this account, the adopted templates and its own open suggestions.
 *
 * @return {Promise<{right: ('suggest'|'save'|null), templates: object[], pending: object[]}>}
 */
export async function listTemplates() {
	const res = await call(api.listTemplates())
	return { right: res?.right === 'suggest' || res?.right === 'save' ? res.right : null, templates: list(res?.templates), pending: list(res?.pending) }
}

/**
 * Route 29: suggests a template (an admin: saves it, adopted at once).
 *
 * @param {{name: string, note?: string, content: string, sketch: Array}} t the template
 * @return {Promise<{id: number, state: string}>}
 */
export function createTemplate(t) {
	return call(api.createTemplate(), pick(t, CREATE_KEYS))
}

/**
 * Route 30: the content of an adopted template.
 *
 * @param {number} id template id
 * @return {Promise<string|null>} the board file's text, null without one
 */
export async function templateContent(id) {
	const res = await call(api.showTemplate(id))
	return typeof res?.content === 'string' ? res.content : null
}

/**
 * Route 31 (admins): renames an adopted template.
 *
 * @param {number} id template id
 * @param {string} name the new name
 * @return {Promise<{id: number, name: string}>}
 */
export function renameTemplate(id, name) {
	return call(api.updateTemplate(id), { name })
}

/**
 * Route 32: withdraws an own suggestion, rejects a suggestion (admins) or
 * deletes an adopted template (admins).
 *
 * @param {number} id template id
 * @return {Promise<{deleted: true}>}
 */
export function deleteTemplate(id) {
	return call(api.deleteTemplate(id))
}

/**
 * Route 33 (admins): adopts a suggestion.
 *
 * @param {number} id template id
 * @return {Promise<{id: number}>}
 */
export function adoptTemplate(id) {
	return call(api.adoptTemplate(id), {})
}

/**
 * Route 34 (admins): the open suggestions (oldest first) and the adopted templates.
 *
 * @return {Promise<{suggestions: object[], templates: object[]}>}
 */
export async function reviewTemplates() {
	const res = await call(api.reviewTemplates())
	return { suggestions: list(res?.suggestions), templates: list(res?.templates) }
}
