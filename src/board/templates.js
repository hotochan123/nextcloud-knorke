/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Board templates (factory job 180): Retrospective, SWOT analysis, Kanban
 * and Brainstorming with a parking lot. Pure: definitions, the item set and
 * the geometry of the dialog's sketch; BoardSession.insertTemplate pastes
 * the set, TemplateDialog.vue draws the sketches.
 *
 * A template is a row of titled frames, each with one coloured note that
 * holds a guiding question and (job 188) a note pad in the same colour
 * beside it, without a title, to take more notes off. The texts are literal t('knorke', …) calls (so
 * build/l10n-check.mjs finds them), read when a set is built: they become
 * board data in the language of the person who inserts the template.
 *
 * Geometry (world units): 80 between the frames, horizontally and
 * vertically; the frames keep the default fill (FRAME_FILL); every note is
 * 200 × 200 at (40, 40) relative to its frame, (job 227) in text size M
 * (NOTE_SIZE_M) and a light tone of the one palette; every pad
 * 200 × 200 at (260, 40).
 * - retro: 3 frames of 640 × 880 side by side
 * - swot: 4 frames of 800 × 560 in a 2 × 2 grid (Strengths, Weaknesses on top)
 * - kanban: 3 frames of 560 × 1200 side by side
 * - brainstorm: "Ideas" 1280 × 880, "Parking lot" 480 × 480 right of it, top-aligned
 *
 * templatePayload(key) is a clipboard set `knorke:1` (board/clipboard.js):
 * the frames are the roots (absolute, the first at (0, 0)), each note and
 * each pad a child of its frame (relative), the ids placeholders in ULID form that
 * actions.pasteItems replaces, board null (never "the same board").
 */
import { FRAME_FILL, NOTE_SIZE_M } from '../model/tokens.js'
import { t } from '../util/l10n.js'

/** The templates in dialog order. */
export const TEMPLATE_KEYS = Object.freeze(['retro', 'swot', 'kanban', 'brainstorm'])
/** Gap between two frames, horizontally and vertically (world units). */
export const TEMPLATE_GAP = 80
/** Side of a template's note (world units). */
export const TEMPLATE_NOTE_SIZE = 200
/** Place of the note inside its frame, x and y (world units). */
export const TEMPLATE_NOTE_INSET = 40
/** (job 188) Place of the note pad inside its frame, x (y as the note's), and its side (world units). */
export const TEMPLATE_PAD_X = 260
export const TEMPLATE_PAD_SIZE = 200

/**
 * @param {number} w width of each frame
 * @param {number} h height of each frame
 * @param {Array<[string, string, string]>} rows [title, question, fill] per frame
 * @return {object[]} the frames side by side
 */
function row(w, h, rows) {
	return rows.map(([title, question, fill], i) => ({ x: i * (w + TEMPLATE_GAP), y: 0, w, h, title, question, fill }))
}

/**
 * The definition of a template, its texts in the current language.
 *
 * @param {string} key one of TEMPLATE_KEYS
 * @return {{key: string, name: string, text: string, frames: Array<{x: number, y: number, w: number, h: number,
 *   title: string, question: string, fill: string}>}|null} null for an unknown key
 */
export function templateOf(key) {
	switch (key) {
	case 'retro':
		return {
			key,
			name: t('knorke', 'Retrospective'),
			text: t('knorke', 'Look back as a team: what should we start, stop and continue?'),
			frames: row(640, 880, [
				[t('knorke', 'Start doing'), t('knorke', 'What should we start doing?'), '#b3e8b3'],
				[t('knorke', 'Stop doing'), t('knorke', 'What should we stop doing?'), '#ffaaa7'],
				[t('knorke', 'Continue doing'), t('knorke', 'What should we keep doing?'), '#a2d9fe'],
			]),
		}
	case 'swot': {
		const [s, w, o, th] = row(800, 560, [
			[t('knorke', 'Strengths'), t('knorke', 'What do we do well?'), '#b3e8b3'],
			[t('knorke', 'Weaknesses'), t('knorke', 'Where are we weak?'), '#febf87'],
			[t('knorke', 'Opportunities'), t('knorke', 'What could help us?'), '#a2d9fe'],
			[t('knorke', 'Threats'), t('knorke', 'What could get in our way?'), '#ffaaa7'],
		])
		const down = 560 + TEMPLATE_GAP
		return {
			key,
			name: t('knorke', 'SWOT analysis'),
			text: t('knorke', 'Strengths, weaknesses, opportunities and threats in four fields.'),
			frames: [s, w, { ...o, x: s.x, y: down }, { ...th, x: w.x, y: down }],
		}
	}
	case 'kanban':
		return {
			key,
			name: t('knorke', 'Kanban'),
			text: t('knorke', 'Move tasks from to do via doing to done.'),
			frames: row(560, 1200, [
				[t('knorke', 'To do'), t('knorke', 'What is waiting to be started?'), '#faea89'],
				[t('knorke', 'Doing'), t('knorke', 'What are we working on right now?'), '#febf87'],
				[t('knorke', 'Done'), t('knorke', 'What is finished?'), '#b3e8b3'],
			]),
		}
	case 'brainstorm':
		return {
			key,
			name: t('knorke', 'Brainstorming'),
			text: t('knorke', 'Collect ideas freely; side topics go to the parking lot.'),
			frames: [
				{ x: 0, y: 0, w: 1280, h: 880, title: t('knorke', 'Ideas'), question: t('knorke', 'Which ideas come to mind? One idea per note.'), fill: '#faea89' },
				{ x: 1280 + TEMPLATE_GAP, y: 0, w: 480, h: 480, title: t('knorke', 'Parking lot'), question: t('knorke', 'What is important but off topic right now?'), fill: '#e0e0dd' },
			],
		}
	default:
		return null
	}
}

/**
 * @param {number} n running number
 * @return {string} a placeholder id in ULID form (pasteItems gives every item a new id)
 */
function placeholderId(n) {
	return String(n).padStart(26, '0')
}

/**
 * The item set of a template (clipboard format `knorke:1`, see the file comment).
 *
 * @param {string} key one of TEMPLATE_KEYS
 * @return {{knorke: 1, board: null, origin: [number, number], items: object[]}|null} null for an unknown key
 */
export function templatePayload(key) {
	const def = templateOf(key)
	if (!def) {
		return null
	}
	const frames = def.frames.map((f, i) => ({
		id: placeholderId(1 + i), t: 'frame', x: f.x, y: f.y, w: f.w, h: f.h, r: 0, parent: null,
		data: { title: f.title }, style: { fill: FRAME_FILL }, group: null,
	}))
	const notes = def.frames.map((f, i) => ({
		id: placeholderId(101 + i), t: 'sticky', x: TEMPLATE_NOTE_INSET, y: TEMPLATE_NOTE_INSET, w: TEMPLATE_NOTE_SIZE, h: TEMPLATE_NOTE_SIZE,
		r: 0, parent: frames[i].id, data: { text: f.question }, style: { fill: f.fill, fontSize: NOTE_SIZE_M }, group: null,
	}))
	// job 188: a pad in the colour of the guiding question, without a title
	const pads = def.frames.map((f, i) => ({
		id: placeholderId(201 + i), t: 'pad', x: TEMPLATE_PAD_X, y: TEMPLATE_NOTE_INSET, w: TEMPLATE_PAD_SIZE, h: TEMPLATE_PAD_SIZE,
		r: 0, parent: frames[i].id, data: { title: '' }, style: { fill: f.fill }, group: null,
	}))
	return { knorke: 1, board: null, origin: [0, 0], items: [...frames, ...notes, ...pads] }
}

/**
 * @param {number} v number
 * @return {number} v rounded to 0.01
 */
function r2(v) {
	return Math.round(v * 100) / 100
}

/**
 * The sketch of a template for the dialog: its frame rectangles to scale,
 * centred in a w × h box with `pad` around them, and one colour square per
 * note and (job 188) per note pad at its place. Only numbers and the
 * palette colours of the definition.
 *
 * @param {string} key one of TEMPLATE_KEYS
 * @param {{w?: number, h?: number, pad?: number}} [box] size of the drawing (SVG user units)
 * @return {{w: number, h: number, frames: Array<{x: number, y: number, w: number, h: number}>,
 *   notes: Array<{x: number, y: number, size: number, fill: string}>, pads: Array<{x: number, y: number, size: number,
 *   fill: string}>}|null} null for an unknown key
 */
export function templateSketch(key, { w = 120, h = 80, pad = 4 } = {}) {
	const def = templateOf(key)
	if (!def) {
		return null
	}
	const W = Math.max(...def.frames.map((f) => f.x + f.w))
	const H = Math.max(...def.frames.map((f) => f.y + f.h))
	const s = Math.min((w - 2 * pad) / W, (h - 2 * pad) / H)
	const ox = (w - W * s) / 2
	const oy = (h - H * s) / 2
	return {
		w,
		h,
		frames: def.frames.map((f) => ({ x: r2(ox + f.x * s), y: r2(oy + f.y * s), w: r2(f.w * s), h: r2(f.h * s) })),
		notes: def.frames.map((f) => ({
			x: r2(ox + (f.x + TEMPLATE_NOTE_INSET) * s), y: r2(oy + (f.y + TEMPLATE_NOTE_INSET) * s), size: r2(TEMPLATE_NOTE_SIZE * s), fill: f.fill,
		})),
		pads: def.frames.map((f) => ({
			x: r2(ox + (f.x + TEMPLATE_PAD_X) * s), y: r2(oy + (f.y + TEMPLATE_NOTE_INSET) * s), size: r2(TEMPLATE_PAD_SIZE * s), fill: f.fill,
		})),
	}
}
