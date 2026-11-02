/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A workshop from a prompt (factory job 276), pure: the AI gives the parts
 * of a workshop in order (route 59 workshop {parts: [{title, minutes,
 * question}]}, AiLayout::workshop); Knorke builds them like a built-in
 * template (board/templates.js): one titled frame per part, side by side,
 * each with a note holding the guiding question and a note pad of the same
 * colour beside it. The frames form one row of equal height, so their
 * reading order (arrangeActions readingOrder) is the order of the parts,
 * and so is the slide order of "Frames as slides" (board/slides.js) for
 * frames without a saved place. Part of the lazy part ai (aiFlow.js
 * re-exports workshopPayload; components/aiPreview.js draws workshopPreview).
 *
 * - a frame: WS_FRAME_W × WS_FRAME_H, TEMPLATE_GAP apart, the first at
 *   (0, 0), FRAME_FILL, the title "<title> (<minutes> min)" (without minutes
 *   only the title), cut to the frame title limit;
 * - a part with a question: the note (TEMPLATE_NOTE_SIZE, at
 *   TEMPLATE_NOTE_INSET, text size M) and the pad (TEMPLATE_PAD_X) as
 *   children, coloured in turn from WS_FILLS.
 */
import { ulid } from '../model/ids.js'
import { FRAME_FILL, NOTE_SIZE_M } from '../model/tokens.js'
import { t } from '../util/l10n.js'
import { validatePayload } from './clipboard.js'
import { TEMPLATE_GAP, TEMPLATE_NOTE_INSET, TEMPLATE_NOTE_SIZE, TEMPLATE_PAD_SIZE, TEMPLATE_PAD_X } from './templates.js'

/** Size of a workshop frame (the frames of the template Retrospective). */
export const WS_FRAME_W = 640
export const WS_FRAME_H = 880
/** The colours of the notes, in turn (light tones of the templates). */
export const WS_FILLS = Object.freeze(['#b3e8b3', '#a2d9fe', '#febf87', '#ffaaa7', '#faea89'])
/** Most parts (AiLayout::WORKSHOP_PARTS), code points of a frame title (registry data.title). */
const PARTS_MAX = 12
const TITLE_MAX = 200

/**
 * @param {unknown} ws {parts} of route 59
 * @return {{title: string, question: string}[]|null} the parts with their frame titles; null: not at least two parts
 */
export function workshopParts(ws) {
	if (!ws || typeof ws !== 'object' || !Array.isArray(ws.parts)) return null
	const out = []
	for (const p of ws.parts.slice(0, PARTS_MAX)) {
		const title = typeof p?.title === 'string' ? p.title.trim() : ''
		if (title === '') continue
		const m = p.minutes
		const full = Number.isInteger(m) && m > 0 ? t('knorke', '{title} ({minutes} min)', { title, minutes: m }) : title
		out.push({ title: [...full].slice(0, TITLE_MAX).join(''), question: typeof p.question === 'string' ? p.question.trim() : '' })
	}
	return out.length >= 2 ? out : null
}

/**
 * The item set "Insert" pastes (clipboard format `knorke:1`): the frames as
 * roots (absolute), each note and pad a child of its frame (relative).
 *
 * @param {unknown} ws {parts} of route 59
 * @param {() => string} [newId] ids (tests)
 * @return {{knorke: 1, board: null, origin: [number, number], items: object[]}|null} null: no workshop
 */
export function workshopPayload(ws, newId = ulid) {
	const parts = workshopParts(ws)
	if (!parts) return null
	const items = []
	parts.forEach((p, i) => {
		const id = newId()
		items.push({
			id, t: 'frame', x: i * (WS_FRAME_W + TEMPLATE_GAP), y: 0, w: WS_FRAME_W, h: WS_FRAME_H, r: 0, parent: null,
			data: { title: p.title }, style: { fill: FRAME_FILL }, group: null,
		})
		if (p.question === '') return
		const fill = WS_FILLS[i % WS_FILLS.length]
		items.push({
			id: newId(), t: 'sticky', x: TEMPLATE_NOTE_INSET, y: TEMPLATE_NOTE_INSET, w: TEMPLATE_NOTE_SIZE, h: TEMPLATE_NOTE_SIZE,
			r: 0, parent: id, data: { text: p.question }, style: { fill, fontSize: NOTE_SIZE_M }, group: null,
		}, {
			id: newId(), t: 'pad', x: TEMPLATE_PAD_X, y: TEMPLATE_NOTE_INSET, w: TEMPLATE_PAD_SIZE, h: TEMPLATE_PAD_SIZE,
			r: 0, parent: id, data: { title: '' }, style: { fill }, group: null,
		})
	})
	const v = validatePayload({ knorke: 1, board: null, origin: [0, 0], items }, { maxItems: Infinity })
	return v.ok && v.skipped === 0 ? { ...v.payload, board: null } : null
}
