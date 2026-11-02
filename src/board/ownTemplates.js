/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Template suggestions (factory job 182), pure: the limits, the content of
 * a template, its sketch, the name the save dialog starts with and the
 * tiles. BoardSession.templateDraft captures a draft at the click,
 * TemplateEditDialog.vue suggests or saves it (route 29), TemplateDialog.vue
 * and admin/TemplateAdmin.vue draw the tiles, BoardSession.insertOwnTemplate
 * inserts a loaded content.
 *
 * The limits are lib/Service/TemplateStore.php's (a node test compares the
 * numbers): TEMPLATE_MAX_PENDING open suggestions per account,
 * TEMPLATE_MAX_ITEMS objects and TEMPLATE_MAX_BYTES of content (UTF-8), a
 * name of at most TEMPLATE_NAME_MAX characters, a note to the admins of at
 * most TEMPLATE_NOTE_MAX, a sketch of at most TEMPLATE_SKETCH_MAX entries in
 * a SKETCH_W × SKETCH_H box.
 *
 * The content is a board file (board/boardFile.js) with title "": the whole
 * board is boardFileData(model, '', tags), a selection the same envelope with
 * actions.copyPayload(model, selection).items. So it has no reactions,
 * locks, votes, pids or names, and readBoardFile accepts it. (Job 191) It
 * carries tags: the whole board all of its tags, a selection the tags of its
 * notes (copyPayload).
 *
 * The sketch (ownSketch) is a list of [x, y, w, h, fill]: every item but
 * connectors with its absolute box (a child moved by the chain of its
 * parents), the union of the boxes fitted into the middle of 120 × 80 with
 * a margin of 4 like templates.js templateSketch; first the frames, then
 * the other items, each in content order, at most 40 entries, rounded to
 * 0.01. fill is '' for a frame, else style.fill when it is #rrggbb (in
 * lower case), else SKETCH_FILL. Only numbers and colours: the server
 * checks the same form.
 */
import { copyPayload } from './actions.js'
import { boardFileData } from './boardFile.js'
import { utf8Bytes } from './clipboard.js'
import { shownColor } from '../model/tokens.js'
import { SKETCH_FILL, SKETCH_H, SKETCH_HEX as HEX, SKETCH_PAD, SKETCH_W, TEMPLATE_SKETCH_MAX, sketchRects } from '../components/sketch.js'

// (job 221) the sketch form lives in components/sketch.js (the board list reads it too)
export { SKETCH_FILL, SKETCH_H, SKETCH_PAD, SKETCH_W, TEMPLATE_SKETCH_MAX, sketchRects } from '../components/sketch.js'

/** Open suggestions per account (admins save without a limit). */
export const TEMPLATE_MAX_PENDING = 10
/** Objects of one template (the clipboard's PASTE_MAX). */
export const TEMPLATE_MAX_ITEMS = 1000
/** Bytes of the content as UTF-8 (2 MiB, the clipboard's CLIP_MAX_BYTES). */
export const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024
/** Characters (code points) of a template's name. */
export const TEMPLATE_NAME_MAX = 100
/** Characters (code points) of the note to the admins. */
export const TEMPLATE_NOTE_MAX = 200
/**
 * The content of a template as data (see the file comment).
 *
 * @param {object} model SceneModel
 * @param {'board'|'selection'} scope the whole board or the selection
 * @param {string[]|null} [selection] the selected ids (scope selection)
 * @param {Array<{id: string, name: string, color: string}>} [tags] (job 191) the board's tags
 * @return {{knorke: 1, kind: 'board', title: '', origin: [number, number], items: object[], tags: object[]}}
 */
export function templateData(model, scope, selection = null, tags = []) {
	if (scope === 'selection') {
		const p = copyPayload(model, selection ?? [], { tags })
		return { knorke: 1, kind: 'board', title: '', origin: p.origin, items: p.items, tags: p.tags }
	}
	return boardFileData(model, '', tags)
}

/**
 * @param {string} text text
 * @return {boolean} more than TEMPLATE_MAX_BYTES as UTF-8
 */
function tooLarge(text) {
	// one UTF-16 unit is one to three bytes
	if (text.length > TEMPLATE_MAX_BYTES) {
		return true
	}
	return text.length * 3 > TEMPLATE_MAX_BYTES && utf8Bytes(text) > TEMPLATE_MAX_BYTES
}

/**
 * A template of the whole board or the selection, as it is now.
 *
 * @param {object} model SceneModel
 * @param {'board'|'selection'} scope what goes in
 * @param {string[]|null} [selection] the selected ids (scope selection)
 * @param {Array<{id: string, name: string, color: string}>} [tags] (job 191) the board's tags
 * @return {{ok: true, content: string, sketch: Array<[number, number, number, number, string]>}
 *   |{ok: false, reason: 'empty'|'too-large'}} empty: nothing to save; too-large: more than
 *   TEMPLATE_MAX_ITEMS objects or TEMPLATE_MAX_BYTES
 */
export function templateDraft(model, scope, selection = null, tags = []) {
	const data = templateData(model, scope, selection, tags)
	if (data.items.length === 0) {
		return { ok: false, reason: 'empty' }
	}
	if (data.items.length > TEMPLATE_MAX_ITEMS) {
		return { ok: false, reason: 'too-large' }
	}
	const content = JSON.stringify(data)
	if (tooLarge(content)) {
		return { ok: false, reason: 'too-large' }
	}
	return { ok: true, content, sketch: ownSketch(data.items) }
}

/**
 * @param {number} v number
 * @param {number} max upper end of the box
 * @return {number} v rounded to 0.01, inside [0, max]
 */
function r2(v, max) {
	const x = Math.round(v * 100) / 100
	return x > 0 ? Math.min(x, max) : 0
}

/**
 * @param {unknown} v a number of an item
 * @return {number} v when finite, else 0
 */
function num(v) {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * The sketch of a template's items (see the file comment).
 *
 * @param {object[]} items the content's items (roots absolute, children relative to their parent)
 * @return {Array<[number, number, number, number, string]>} at most TEMPLATE_SKETCH_MAX entries
 */
export function ownSketch(items) {
	const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : []
	const byId = new Map(list.map((it) => [it.id, it]))
	/** @param {object} it item @return {{x: number, y: number}} its absolute place (the chain of its parents) */
	const abs = (it) => {
		let x = num(it.x)
		let y = num(it.y)
		let p = typeof it.parent === 'string' ? byId.get(it.parent) : undefined
		for (let depth = 0; p && depth < 8; depth++) {
			x += num(p.x)
			y += num(p.y)
			p = typeof p.parent === 'string' ? byId.get(p.parent) : undefined
		}
		return { x, y }
	}
	const boxes = list.filter((it) => it.t !== 'connector').map((it) => {
		const a = abs(it)
		return { ...a, w: Math.max(0, num(it.w)), h: Math.max(0, num(it.h)), frame: it.t === 'frame', fill: it.style?.fill }
	})
	if (boxes.length === 0) {
		return []
	}
	const x0 = Math.min(...boxes.map((b) => b.x))
	const y0 = Math.min(...boxes.map((b) => b.y))
	const W = Math.max(...boxes.map((b) => b.x + b.w)) - x0
	const H = Math.max(...boxes.map((b) => b.y + b.h)) - y0
	const sx = W > 0 ? (SKETCH_W - 2 * SKETCH_PAD) / W : Infinity
	const sy = H > 0 ? (SKETCH_H - 2 * SKETCH_PAD) / H : Infinity
	const s = Number.isFinite(Math.min(sx, sy)) ? Math.min(sx, sy) : 1
	const ox = (SKETCH_W - W * s) / 2
	const oy = (SKETCH_H - H * s) / 2
	const ordered = [...boxes.filter((b) => b.frame), ...boxes.filter((b) => !b.frame)].slice(0, TEMPLATE_SKETCH_MAX)
	return ordered.map((b) => [
		r2(ox + (b.x - x0) * s, SKETCH_W),
		r2(oy + (b.y - y0) * s, SKETCH_H),
		r2(b.w * s, SKETCH_W),
		r2(b.h * s, SKETCH_H),
		b.frame ? '' : (typeof b.fill === 'string' && HEX.test(b.fill) ? b.fill.toLowerCase() : SKETCH_FILL),
	])
}

/**
 * A tile of an entry of route 28 or 34 (an adopted template or a
 * suggestion): its id, name, the note (suggestions; null without one) and
 * the rectangles of its sketch.
 *
 * @param {object} e entry {id, name, sketch, note?}
 * @return {{id: number, name: string, note: (string|null), rects: Array}|null} null for anything that is no entry
 *   (no whole id ≥ 1, no name)
 */
export function templateTile(e) {
	if (!e || typeof e !== 'object' || !Number.isSafeInteger(e.id) || e.id < 1 || typeof e.name !== 'string' || e.name === '') {
		return null
	}
	// job 227: an old palette colour as its new tone, as on the board
	const rects = sketchRects(e.sketch).map((r) => (r.fill === null ? r : { ...r, fill: shownColor(r.fill) }))
	return { id: e.id, name: e.name, note: typeof e.note === 'string' && e.note !== '' ? e.note : null, rects }
}

/**
 * @param {unknown} list entries of route 28 or 34
 * @return {Array<{id: number, name: string, note: (string|null), rects: Array}>} the tiles, entries that are no
 *   template left out
 */
export function templateTiles(list) {
	return (Array.isArray(list) ? list : []).map(templateTile).filter((e) => e !== null)
}

/**
 * @param {unknown} title board title
 * @return {string} the name the save dialog starts with: the title cut to TEMPLATE_NAME_MAX characters
 */
export function templateName(title) {
	return Array.from(typeof title === 'string' ? title : '').slice(0, TEMPLATE_NAME_MAX).join('')
}

/**
 * @param {unknown} name a typed name or note
 * @return {string} the text as the server keeps it: trimmed (Input::title)
 */
export function cleanName(name) {
	return typeof name === 'string' ? name.replace(/^[\s\p{Z}]+|[\s\p{Z}]+$/gu, '') : ''
}
