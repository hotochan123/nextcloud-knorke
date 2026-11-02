/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The AI of a board (factory job 267, routes 58–62): one caller per route,
 * through api/boards.js call (CSRF headers, the 412 rule). Bodies carry only
 * the keys the server allows:
 *   startAi          kind (summarise | cluster), ids, frame?, acceptNotice?
 *   allowAi          allowed
 *   saveAiSettings   enabled?, dailyLimit?, notice?
 * Errors stay HttpErrors of sync/http.js: 403 ai_unavailable (body.reason),
 * 409 ai_notice (the notice is not confirmed), 429 ai_limit (body.max),
 * 400 ai_empty / ai_too_much.
 */
import { api } from '../util/routes.js'
import { call } from './boards.js'

/**
 * Route 59: availability, notice, limit and this account's tasks on the board.
 *
 * @param {number} id board id
 * @return {Promise<object>} {available, reason, ready, allowed, owner, notice, limit, tasks}
 */
export async function aiState(id) {
	return (await call(api.aiState(id))) ?? {}
}

/**
 * Route 60: start a task.
 *
 * @param {number} id board id
 * @param {{kind: string, ids?: string[], frame?: (string|null), acceptNotice?: boolean, shape?: string, prompt?: string}} o what to do
 *   (job 268: kind diagram with shape and prompt instead of ids)
 * @return {Promise<number>} the task id
 */
export async function startAi(id, { kind, ids = [], frame = null, acceptNotice = false, shape, prompt }) {
	const body = kind === 'diagram' ? { kind, shape, prompt } : { kind, ids: [...ids] }
	if (frame) {
		body.frame = frame
	}
	if (acceptNotice) {
		body.acceptNotice = true
	}
	const res = await call(api.startAi(id), body)
	return res?.task ?? null
}

/**
 * Route 61: cancel a running task, or forget a finished one.
 *
 * @param {number} id board id
 * @param {number} task task id
 * @return {Promise<void>}
 */
export async function forgetAi(id, task) {
	await call(api.forgetAi(id, task))
}

/**
 * Route 62: the board switch "Allow AI on this board" (owner).
 *
 * @param {number} id board id
 * @param {boolean} allowed wanted state
 * @return {Promise<object>} {board: {title, meta, metaRev}, now}
 */
export async function allowAi(id, allowed) {
	return call(api.allowAi(id), { allowed: allowed === true })
}

/**
 * Route 58: the admin settings of the AI (admins only).
 *
 * @param {{enabled?: boolean, dailyLimit?: number, notice?: object}} s what to change
 * @return {Promise<object>} the stored settings (AiService::adminState)
 */
export async function saveAiSettings(s) {
	const body = {}
	for (const k of ['enabled', 'dailyLimit', 'notice']) {
		if (s && s[k] !== undefined) {
			body[k] = s[k]
		}
	}
	const res = await call(api.saveAiSettings(), body)
	return res?.ai ?? null
}
