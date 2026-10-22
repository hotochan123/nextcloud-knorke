/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Clipboard of the board (SPEC-M1 §6.5.3): format, check, writing, reading.
 *
 * Format `knorke:1` (also the import format for templates in M2):
 *   text/html   <meta charset="utf-8"><div data-knorke-clip="v1.<base64url(JSON)>"></div>
 *   text/plain  the texts of the items (notes, shapes, text items one per
 *               paragraph, frame titles as "# Title")
 *   JSON        {knorke: 1, board, origin: [x, y], items: [{id, t, x, y, w,
 *               h, r, parent, data, style, group}]}, roots absolute, children
 *               relative to their payload parent (actions.copyPayload);
 *               group (M2, R20 Gruppieren) is the item's group id or null,
 *               only a key that pasteItems groups by (never sent); older
 *               versions ignore it, so `knorke: 1` stays
 * Never markup from item content in the HTML: base64 avoids escaping and
 * sanitizer surprises. The HTML is read with DOMParser (an inert document,
 * never the live DOM).
 *
 * The payload is foreign input (another tab, another version, a crafted
 * clipboard): validatePayload() checks it like the server would before
 * anything is pasted (and the server checks again). Empty values count as
 * absent (M0 §4.7 rule 3) and are removed before the typed fields are
 * checked with checkField (SPEC-M1 §6.2, R8).
 *
 * Storage localStorage['knorke.clip'] = {v: 1, ts, text, payload} (≤ 2 MiB,
 * TTL 10 min): Ctrl/⌘+Shift+V is "paste as plain text" in Chromium and
 * Firefox and may bring only text/plain; when that text equals the stored
 * text, the stored payload is pasted (in place stays in place). Older
 * entries are deleted when read; it stays after a paste (pasting the same
 * copy again is common).
 *
 * Writing: in a secure context navigator.clipboard.write with both formats;
 * otherwise (dev stacks over http) or when that throws: a hidden text field
 * with the plain text, select(), document.execCommand('copy'), and the
 * `copy` handler sets both formats with clipboardData.setData (works
 * without a secure context, also in Safari 17, because a selection exists).
 *
 * Reading: the paste catcher, a hidden <textarea data-knorke-paste-catcher
 * aria-hidden="true" tabindex="-1">. The session focuses it synchronously in
 * the keydown of Ctrl/⌘+V (scene intent pasteKey), so the following `paste`
 * event lands on an editable element and fires in Chromium, Firefox AND
 * WebKit (WebKit fires none on a focused, non-editable div). A WebKit
 * without DOM paste access (measured: Playwright's WebKit 18.2) fires the
 * event with an EMPTY clipboardData but still inserts the plain text into
 * the field: the catcher then lets that happen and takes the inserted text
 * as text/plain (the stored copy turns it back into the objects).
 *
 * Reading from a click (stage 4, R19 T4-03): "Paste here" of the context menu
 * calls navigator.clipboard.read() synchronously in its click handler (only
 * offered in a secure context, util/device.js canReadClipboard);
 * clipboardItemsData() turns the ClipboardItems into the same {html, text,
 * files} as a paste event, so the evaluation is the paste event's.
 */
import { ULID_RE } from '../model/ids.js'
import { getPath, isWireValue, itemFromPut, KEY_RE, setPath } from '../model/paths.js'
import { canBeChildOf, checkField, isKnownType, typeInfo } from '../model/registry.js'
import { isSecureContext } from '../util/device.js'
import { keys } from '../util/storage.js'

/** Most items of one paste (SPEC-M1 §4.8). */
export const PASTE_MAX = 1000
/** Most bytes of a payload (UTF-8 JSON) and of the stored entry. */
export const CLIP_MAX_BYTES = 2 * 1024 * 1024
/** Lifetime of the stored copy (§6.5.3). */
export const CLIP_TTL_MS = 10 * 60 * 1000
/** Key of the stored copy (util/storage.js keys.clip()). */
export const CLIP_KEY = keys.clip()
/** Version prefix of the data-knorke-clip attribute. */
export const CLIP_PREFIX = 'v1.'
/** Absolute limit of coordinates and sizes (server NUM_ABS_MAX). */
const NUM_ABS_MAX = 1e7
/** Longest generic string value (server MAX_STRING, code points). */
const MAX_STRING = 6000
/** Most root keys of data/style (server PathOps::MAX_KEYS). */
const MAX_ROOT_KEYS = 100

/**
 * @param {unknown} v value
 * @return {boolean} plain map (not null, not a list)
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {unknown} v value
 * @return {boolean} finite number within ±1e7
 */
function isCoord(v) {
	return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= NUM_ABS_MAX
}

/**
 * @param {string} s text
 * @return {number} UTF-8 bytes
 */
export function utf8Bytes(s) {
	return new TextEncoder().encode(s).length
}

/**
 * @param {string} s text
 * @return {string} base64url of its UTF-8 bytes, without padding
 */
export function toBase64Url(s) {
	const bytes = new TextEncoder().encode(s)
	let bin = ''
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
	}
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * @param {string} s base64url (with or without padding)
 * @return {string|null} the decoded UTF-8 text, null when it is no valid base64url/UTF-8
 */
export function fromBase64Url(s) {
	if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) {
		return null
	}
	try {
		const b64 = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
		const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
		const bytes = new Uint8Array(bin.length)
		for (let i = 0; i < bin.length; i++) {
			bytes[i] = bin.charCodeAt(i)
		}
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch (e) {
		return null
	}
}

/**
 * Plain text of a payload (§6.5.3): every non-empty text in payload order,
 * notes, shapes and text items as they are, frame titles as "# Title", one
 * paragraph each (blank line between).
 *
 * @param {{items: object[]}} payload payload
 * @return {string}
 */
export function plainTextOf(payload) {
	const out = []
	for (const it of payload?.items ?? []) {
		if (it?.t === 'frame') {
			const title = it.data?.title
			if (typeof title === 'string' && title.trim() !== '') {
				out.push('# ' + title)
			}
			continue
		}
		const path = typeInfo(it?.t).textPath
		if (path === 'data.text') {
			const v = it.data?.text
			if (typeof v === 'string' && v.trim() !== '') {
				out.push(v)
			}
		}
	}
	return out.join('\n\n')
}

/**
 * Both clipboard formats of a payload.
 *
 * @param {object} payload knorke:1 payload
 * @return {{html: string, text: string, attr: string, bytes: number}}
 */
export function encodeClip(payload) {
	const json = JSON.stringify(payload)
	const attr = CLIP_PREFIX + toBase64Url(json)
	return {
		html: '<meta charset="utf-8"><div data-knorke-clip="' + attr + '"></div>',
		text: plainTextOf(payload),
		attr,
		bytes: utf8Bytes(json),
	}
}

/**
 * The value of [data-knorke-clip] in clipboard HTML, parsed in an inert
 * document (DOMParser), never in the live DOM.
 *
 * @param {string} html text/html of the clipboard
 * @param {((html: string) => {querySelector: Function})|null} [parse] parser (tests)
 * @return {string|null}
 */
export function clipAttrOf(html, parse = null) {
	if (typeof html !== 'string' || !html.includes('data-knorke-clip')) {
		return null
	}
	try {
		const doc = parse ? parse(html) : new globalThis.DOMParser().parseFromString(html, 'text/html')
		const el = doc?.querySelector?.('[data-knorke-clip]')
		const v = el?.getAttribute?.('data-knorke-clip')
		return typeof v === 'string' ? v : null
	} catch (e) {
		return null
	}
}

/**
 * @param {string} attr value of data-knorke-clip
 * @return {unknown} the parsed JSON (unchecked) or null (wrong version, too
 *   large, no base64url, no JSON)
 */
export function decodeClipAttr(attr) {
	if (typeof attr !== 'string' || !attr.startsWith(CLIP_PREFIX)) {
		return null
	}
	const b64 = attr.slice(CLIP_PREFIX.length)
	// 4 base64 characters carry 3 bytes: reject before decoding anything huge
	if (b64.length > Math.ceil(CLIP_MAX_BYTES / 3) * 4) {
		return { tooLarge: true }
	}
	const json = fromBase64Url(b64)
	if (json === null) {
		return null
	}
	try {
		return JSON.parse(json)
	} catch (e) {
		return null
	}
}

/**
 * @param {unknown} v value
 * @return {boolean} every string in v is well-formed UTF-16 and ≤ MAX_STRING code points
 */
function stringsOk(v) {
	if (typeof v === 'string') {
		if (typeof v.isWellFormed === 'function' ? !v.isWellFormed() : /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v)) {
			return false
		}
		return v.length <= MAX_STRING || Array.from(v).length <= MAX_STRING
	}
	if (Array.isArray(v)) {
		return v.every(stringsOk)
	}
	if (isMap(v)) {
		return Object.keys(v).every((k) => stringsOk(v[k]))
	}
	return true
}

/**
 * @param {unknown} root data or style of a payload item
 * @return {boolean} wire value rules of a put (§4.7 rule 3, R4): a map with at
 *   most 100 keys matching KEY_RE, each value a wire value from depth 0
 */
function rootOk(root) {
	if (root === undefined || root === null) {
		return true
	}
	if (!isMap(root)) {
		return false
	}
	const keys = Object.keys(root)
	return keys.length <= MAX_ROOT_KEYS && keys.every((k) => KEY_RE.test(k) && isWireValue(root[k], 0))
}

/**
 * One payload item, checked and normalised, or null (skipped).
 *
 * @param {unknown} it raw item
 * @return {object|null}
 */
function checkItem(it) {
	if (!isMap(it) || typeof it.id !== 'string' || !ULID_RE.test(it.id) || !isKnownType(it.t)) {
		return null
	}
	const info = typeInfo(it.t)
	const nums = {}
	for (const f of ['x', 'y', 'w', 'h', 'r']) {
		const v = it[f] === undefined || it[f] === null ? 0 : it[f]
		if (!isCoord(v)) {
			return null
		}
		nums[f] = v + 0
	}
	if (info.placement === 'none') {
		nums.x = 0
		nums.y = 0
		nums.w = 0
		nums.h = 0
		nums.r = 0
	} else {
		const [min, max] = info.size
		if (nums.w < min || nums.w > max || nums.h < min || nums.h > max) {
			return null
		}
		if (Math.abs(nums.r) > 360) {
			return null
		}
		if (!info.rotatable) {
			nums.r = 0
		}
	}
	if (!rootOk(it.data) || !rootOk(it.style) || !stringsOk(it.data ?? null) || !stringsOk(it.style ?? null)) {
		return null
	}
	// empty = absent: cleaned like a put (null, {}, [] entries dropped)
	const clean = itemFromPut({ id: it.id, t: it.t, p: { data: it.data ?? {}, style: it.style ?? {} } })
	const out = { data: clean.data, style: clean.style }
	for (const path of Object.keys(info.fields)) {
		const v = getPath(out, path)
		if (v === null) {
			continue
		}
		const c = checkField(it.t, path, v)
		if (!c.ok) {
			return null
		}
		setPath(out, path, c.norm)
	}
	for (const path of info.required ?? []) {
		if (getPath(out, path) === null) {
			return null
		}
	}
	const parent = info.placement === 'none' || typeof it.parent !== 'string' || !ULID_RE.test(it.parent) ? null : it.parent
	// the group key (M2, R20): only a ULID, anything else counts as no group
	const group = typeof it.group === 'string' && ULID_RE.test(it.group) ? it.group : null
	return { id: it.id, t: it.t, ...nums, parent, data: out.data, style: out.style, group }
}

/**
 * Checks a payload that came from the clipboard or the storage (foreign
 * input, §6.5.3): knorke === 1, at most PASTE_MAX items, at most 2 MiB as
 * UTF-8 JSON; per item: a ULID id (unique), a known type (unknown types are
 * skipped and counted), finite numbers ≤ 1e7, w/h in TYPES[t].size,
 * data/style by the wire value rules and with well-formed strings ≤ 6000
 * code points, typed fields by their registry rules (normalised),
 * required fields present. A parent that is not a fitting container of the
 * payload makes the item a root (its x/y are then taken as absolute). The
 * group key stays only as a ULID, otherwise null (M2, R20).
 *
 * @param {unknown} raw parsed JSON
 * @return {{ok: true, payload: object, skipped: number}|{ok: false, reason: string, count: number}}
 */
export function validatePayload(raw) {
	if (!isMap(raw) || raw.tooLarge === true) {
		return { ok: false, reason: raw?.tooLarge === true ? 'size' : 'format', count: 0 }
	}
	if (raw.knorke !== 1 || !Array.isArray(raw.items)) {
		return { ok: false, reason: 'format', count: 0 }
	}
	if (raw.items.length > PASTE_MAX) {
		return { ok: false, reason: 'max', count: raw.items.length }
	}
	let bytes
	try {
		bytes = utf8Bytes(JSON.stringify(raw))
	} catch (e) {
		return { ok: false, reason: 'format', count: raw.items.length }
	}
	if (bytes > CLIP_MAX_BYTES) {
		return { ok: false, reason: 'size', count: raw.items.length }
	}
	const items = []
	const seen = new Set()
	let skipped = 0
	for (const it of raw.items) {
		const v = checkItem(it)
		if (v === null || seen.has(v.id)) {
			skipped++
			continue
		}
		seen.add(v.id)
		items.push(v)
	}
	const byId = new Map(items.map((it) => [it.id, it]))
	for (const it of items) {
		if (it.parent === null) {
			continue
		}
		const p = byId.get(it.parent)
		if (!p || !canBeChildOf(it.t, p.t) || p.parent !== null) {
			it.parent = null
		}
	}
	const origin = Array.isArray(raw.origin) && raw.origin.length === 2 && raw.origin.every(isCoord) ? [raw.origin[0], raw.origin[1]] : null
	return {
		ok: true,
		payload: { knorke: 1, board: Number.isInteger(raw.board) ? raw.board : null, origin, items },
		skipped,
	}
}

/**
 * @param {string} s plain text
 * @return {string} the text as compared with the stored copy ("\r\n" → "\n",
 *   white space at both ends ignored: clipboards add or drop line breaks, and
 *   a copy without any text puts a single space into the hidden field)
 */
export function comparableText(s) {
	return String(s ?? '').replace(/\r\n?/g, '\n').trim()
}

/**
 * Stores the copy for Ctrl/⌘+Shift+V (§6.5.3), never throwing.
 *
 * @param {{setJson: Function}} storage storage facade (util/storage.js)
 * @param {{text: string, payload: object}} clip copy
 * @param {number} now wall clock ms
 * @return {boolean} stored
 */
export function storeClip(storage, { text, payload }, now) {
	try {
		const entry = { v: 1, ts: now, text: String(text ?? ''), payload }
		if (utf8Bytes(JSON.stringify(entry)) > CLIP_MAX_BYTES) {
			storage.removeItem?.('local', CLIP_KEY)
			return false
		}
		return storage.setJson('local', CLIP_KEY, entry) === true
	} catch (e) {
		return false
	}
}

/**
 * The stored copy for a paste without [data-knorke-clip] (§6.5.3): taken
 * when it is younger than CLIP_TTL_MS and its text equals the clipboard's
 * plain text (whatever formats came). An expired or broken entry is deleted.
 *
 * @param {{getJson: Function, removeItem: Function}} storage storage facade
 * @param {string} text text/plain of the clipboard
 * @param {number} now wall clock ms
 * @return {object|null} the stored payload (unchecked) or null
 */
export function readStoredClip(storage, text, now) {
	let entry
	try {
		entry = storage.getJson('local', CLIP_KEY)
	} catch (e) {
		return null
	}
	if (entry === null || entry === undefined) {
		return null
	}
	const fresh = isMap(entry) && entry.v === 1 && typeof entry.ts === 'number' && Number.isFinite(entry.ts)
		&& now - entry.ts <= CLIP_TTL_MS && entry.ts - now <= CLIP_TTL_MS && typeof entry.text === 'string' && isMap(entry.payload)
	if (!fresh) {
		clearStoredClip(storage)
		return null
	}
	return comparableText(entry.text) === comparableText(text) ? entry.payload : null
}

/**
 * @param {{removeItem: Function}} storage storage facade
 */
export function clearStoredClip(storage) {
	try {
		storage.removeItem('local', CLIP_KEY)
	} catch (e) {
		// nothing stored
	}
}

/**
 * The formats of a paste or drop event.
 *
 * @param {ClipboardEvent|{clipboardData: object}} e event
 * @return {{html: string, text: string, files: number}}
 */
export function clipboardDataOf(e) {
	const dt = e?.clipboardData
	if (!dt) {
		return { html: '', text: '', files: 0 }
	}
	const get = (type) => {
		try {
			const v = dt.getData(type)
			return typeof v === 'string' ? v : ''
		} catch (err) {
			return ''
		}
	}
	let files = 0
	try {
		files = dt.files?.length ?? 0
		if (files === 0 && dt.items) {
			for (const it of Array.from(dt.items)) {
				if (it.kind === 'file') {
					files++
				}
			}
		}
	} catch (err) {
		files = 0
	}
	return { html: get('text/html'), text: get('text/plain'), files }
}

/**
 * The clipboard a click may read ("Paste here", SPEC-M1 §6.5.3 R19, T4-03):
 * only in a secure context (Prod over https, localhost) and only when
 * navigator.clipboard.read exists. The dev stacks run over plain http:
 * there it is null and the menu entry is missing.
 *
 * @param {Window|undefined} [win] window (tests)
 * @return {object|null} navigator.clipboard, or null
 */
export function clipboardReader(win = globalThis.window) {
	try {
		if (!win || win.isSecureContext !== true) {
			return null
		}
		const cb = win.navigator?.clipboard
		return cb && typeof cb.read === 'function' ? cb : null
	} catch (e) {
		return null
	}
}

/**
 * @param {Window|undefined} [win] window (tests)
 * @return {boolean} window.isSecureContext === true and navigator.clipboard.read is a function
 */
export function canReadClipboard(win = globalThis.window) {
	return clipboardReader(win) !== null
}

/**
 * The formats of navigator.clipboard.read() (SPEC-M1 §6.5.3 R19, "Paste
 * here"): the first text/html and text/plain of the items, and how many
 * items carry something else (an image: "Images can't be pasted yet.").
 * Firefox wraps the HTML in <html><body>; clipAttrOf finds the marker anyway.
 *
 * @param {Iterable<{types: Iterable<string>, getType: (type: string) => Promise<Blob|string>}>} items ClipboardItems
 * @return {Promise<{html: string, text: string, files: number}>} rejects when a type cannot be read
 */
export async function clipboardItemsData(items) {
	let html = ''
	let text = ''
	let files = 0
	const read = async (it, type) => {
		const v = await it.getType(type)
		return typeof v === 'string' ? v : (v && typeof v.text === 'function' ? String(await v.text()) : '')
	}
	for (const it of Array.from(items ?? [])) {
		const types = Array.from(it?.types ?? [])
		let other = false
		for (const type of types) {
			if (type === 'text/html') {
				html = html === '' ? await read(it, type) : html
			} else if (type === 'text/plain') {
				text = text === '' ? await read(it, type) : text
			} else {
				other = true
			}
		}
		if (other) {
			// like dt.files of a paste event: counted whether or not text comes along
			files++
		}
	}
	return { html, text, files }
}

/**
 * @param {Window|null} win window
 * @return {boolean} the page has a non-empty DOM text selection (the browser copies it)
 */
export function hasDomSelection(win = globalThis.window) {
	try {
		const sel = win?.getSelection?.()
		return !!sel && sel.isCollapsed === false && String(sel).length > 0
	} catch (e) {
		return false
	}
}

/**
 * @param {Element|null|undefined} el element (e.g. the target of a key event)
 * @return {boolean} an input field (input, textarea, select, contenteditable), never the paste catcher
 */
export function isInputElement(el) {
	if (!el || el.hasAttribute?.('data-knorke-paste-catcher')) {
		return false
	}
	const tag = String(el.tagName ?? '').toLowerCase()
	return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

/**
 * @param {Document|null} doc document
 * @return {boolean} an input field (input, textarea, select, contenteditable) has the focus
 */
export function inputFocused(doc = globalThis.document) {
	return isInputElement(doc?.activeElement)
}

/**
 * Hidden text field + execCommand('copy') (works without a secure context
 * while the user activation lasts), twice in the same gesture:
 * 1. the native copy of the selected plain text, without a handler – the
 *    only copy some engines take at all (measured: Playwright's WebKit 18.2
 *    ignores a cancelled copy event with setData and keeps the old content);
 * 2. with a copy handler that sets BOTH formats and cancels the event
 *    (Chromium, Firefox, Safari: the clipboard then has text/html and
 *    text/plain). An engine that ignores step 2 keeps the plain text of
 *    step 1, and the stored copy turns it back into objects on paste.
 *
 * @param {{html: string, text: string}} clip formats
 * @param {Document} doc document
 * @return {boolean} the browser reported success
 */
export function execCopy({ html, text }, doc) {
	if (!doc?.body || typeof doc.createElement !== 'function') {
		return false
	}
	const prev = doc.activeElement
	const ta = doc.createElement('textarea')
	ta.value = text || ' '
	ta.setAttribute('readonly', '')
	ta.setAttribute('aria-hidden', 'true')
	ta.setAttribute('tabindex', '-1')
	ta.style.position = 'fixed'
	ta.style.left = '-10000px'
	ta.style.top = '0'
	ta.style.width = '1px'
	ta.style.height = '1px'
	ta.style.opacity = '0'
	const onCopy = (e) => {
		try {
			e.clipboardData.setData('text/plain', text)
			e.clipboardData.setData('text/html', html)
			e.preventDefault()
		} catch (err) {
			// the selected text is copied instead
		}
	}
	doc.body.appendChild(ta)
	let ok = false
	try {
		ta.focus?.({ preventScroll: true })
		ta.select()
		try {
			ok = doc.execCommand('copy') === true
		} catch (e) {
			ok = false
		}
		doc.addEventListener('copy', onCopy, true)
		ok = doc.execCommand('copy') === true || ok
	} catch (e) {
		// ok stays what the native copy said
	} finally {
		doc.removeEventListener('copy', onCopy, true)
		ta.remove()
		try {
			prev?.focus?.({ preventScroll: true })
		} catch (e) {
			// focus stays where it is
		}
	}
	return ok
}

/**
 * Writes both formats (§6.5.3), synchronously started inside the user's
 * gesture (keydown or click): navigator.clipboard.write in a secure context,
 * otherwise (or when that is missing or throws) the execCommand path.
 *
 * @param {{html: string, text: string}} clip formats
 * @param {{doc?: Document, clipboard?: object|null, ClipboardItem?: Function|null, Blob?: Function}} [deps] injection (tests)
 * @return {'async'|'exec'|'text'|false} the path taken (false: nothing worked)
 */
export function writeClipboard(clip, deps = {}) {
	const doc = deps.doc !== undefined ? deps.doc : globalThis.document
	const cb = deps.clipboard !== undefined ? deps.clipboard : (isSecureContext() ? globalThis.navigator?.clipboard : null)
	const Item = deps.ClipboardItem !== undefined ? deps.ClipboardItem : globalThis.ClipboardItem
	const BlobC = deps.Blob ?? globalThis.Blob
	if (cb && typeof cb.write === 'function' && typeof Item === 'function' && typeof BlobC === 'function') {
		try {
			const item = new Item({
				'text/html': new BlobC([clip.html], { type: 'text/html' }),
				'text/plain': new BlobC([clip.text], { type: 'text/plain' }),
			})
			Promise.resolve(cb.write([item])).catch(() => {
				// late failure (permission): the activation may be gone, try anyway
				execCopy(clip, doc)
			})
			return 'async'
		} catch (e) {
			// fall through to execCommand
		}
	}
	if (execCopy(clip, doc)) {
		return 'exec'
	}
	if (cb && typeof cb.writeText === 'function') {
		try {
			Promise.resolve(cb.writeText(clip.text)).catch(() => {})
			return 'text'
		} catch (e) {
			// nothing left
		}
	}
	return false
}

/** How long the catcher waits for the text a browser inserts itself (empty clipboardData). */
export const CATCHER_INSERT_MS = 50

/**
 * Wires the paste catcher (§6.5.3). On `paste` at the catcher: preventDefault,
 * read the formats, empty the field, hand them to onPaste (the session puts
 * the focus back on the canvas). When the event carries no data at all
 * (WebKit without DOM paste access), the browser's own insertion is let
 * through and the inserted text is handed over as text/plain (on `input`,
 * or after CATCHER_INSERT_MS with whatever arrived). Typing into it (it
 * should never get typed into) is cleared. A paste anywhere else is not
 * touched.
 *
 * @param {HTMLTextAreaElement} el the catcher
 * @param {(data: {html: string, text: string, files: number}) => void} onPaste handler
 * @param {{setTimeout?: Function, clearTimeout?: Function}} [timers] timers (tests)
 * @return {() => void} detach
 */
export function attachPasteCatcher(el, onPaste, timers = globalThis) {
	if (!el || typeof el.addEventListener !== 'function') {
		return () => {}
	}
	let waiting = null
	const takeInserted = () => {
		if (waiting !== null) {
			timers.clearTimeout(waiting)
			waiting = null
		}
		const text = typeof el.value === 'string' ? el.value : ''
		el.value = ''
		onPaste({ html: '', text, files: 0 })
	}
	const onEvent = (e) => {
		const data = clipboardDataOf(e)
		el.value = ''
		if (data.html === '' && data.text === '' && data.files === 0) {
			// no access to the data: the browser inserts the plain text itself
			waiting = timers.setTimeout(takeInserted, CATCHER_INSERT_MS)
			return
		}
		e.preventDefault?.()
		onPaste(data)
	}
	const onInput = () => {
		if (waiting !== null) {
			takeInserted()
			return
		}
		el.value = ''
	}
	el.addEventListener('paste', onEvent)
	el.addEventListener('input', onInput)
	return () => {
		if (waiting !== null) {
			timers.clearTimeout(waiting)
			waiting = null
		}
		el.removeEventListener('paste', onEvent)
		el.removeEventListener('input', onInput)
	}
}
