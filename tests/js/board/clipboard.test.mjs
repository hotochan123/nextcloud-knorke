/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Clipboard format, check, storage and DOM paths (SPEC-M1 §6.5.3). The
 * payload is foreign input: every rejection reason has a case.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyPayload } from '../../../src/board/actions.js'
import {
	CATCHER_INSERT_MS, CLIP_KEY, CLIP_MAX_BYTES, CLIP_TTL_MS, PASTE_MAX, attachPasteCatcher, clipAttrOf, clipboardDataOf, comparableText,
	decodeClipAttr, encodeClip, execCopy, fromBase64Url, hasDomSelection, inputFocused, plainTextOf, readStoredClip,
	storeClip, toBase64Url, validatePayload, writeClipboard,
} from '../../../src/board/clipboard.js'
import { TYPES } from '../../../src/model/registry.js'
import { FakeModel, ID, connector, frame, memoryStorage, shape, sticky, textItem } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const F = ID('F1')
const C = ID('C1')

/**
 * @param {object[]} items payload items
 * @param {object} [extra] top-level keys
 * @return {object} raw payload
 */
function raw(items, extra = {}) {
	return { knorke: 1, board: 7, origin: [0, 0], items, ...extra }
}

/**
 * @param {object} it WireItem
 * @return {object} the item as it travels in a payload (no z)
 */
function wire(it) {
	const { z, ...rest } = it
	void z
	return rest
}

test('base64url: UTF-8 round trip without padding; invalid input → null', () => {
	for (const s of ['', 'a', 'ab', 'abc', 'Grüße 😀 \u0000 "quotes" <b>', 'x'.repeat(100000)]) {
		const b = toBase64Url(s)
		assert.match(b, /^[A-Za-z0-9_-]*$/)
		assert.equal(fromBase64Url(b), s)
		assert.equal(fromBase64Url(b + '='.repeat((4 - (b.length % 4)) % 4)), s, 'padding tolerated')
	}
	assert.equal(fromBase64Url('a+b/'), null, 'plain base64 characters')
	assert.equal(fromBase64Url('!!!'), null)
	assert.equal(fromBase64Url(toBase64Url('x').slice(0, 1)), null, 'truncated')
	assert.equal(fromBase64Url(btoa('\xff\xfe')), null, 'no valid UTF-8')
	assert.equal(fromBase64Url(null), null)
})

test('format: html = meta + div[data-knorke-clip="v1.<base64url>"], never item content as markup; text/plain = texts per paragraph, frame titles as "# Title"', () => {
	const m = new FakeModel([
		frame(F, { x: 0, y: 0, z: 'a0', data: { title: 'Plan <b>' } }),
		sticky(A, { parent: F, z: 'i1', data: { text: '<script>alert(1)</script>' } }),
		shape(B, { z: 'i2', x: 900, data: { kind: 'rect', text: 'Box' } }),
		textItem(ID(3), { z: 'i3', x: 900, data: { text: '' } }),
	])
	const p = copyPayload(m, [F, B, ID(3)], { board: 7 })
	const clip = encodeClip(p)
	assert.ok(clip.html.startsWith('<meta charset="utf-8"><div data-knorke-clip="v1.'))
	assert.ok(clip.html.endsWith('"></div>'))
	assert.ok(!clip.html.includes('<script') && !clip.html.includes('<b>'), 'item content only base64')
	assert.equal(clip.attr, clip.html.slice(clip.html.indexOf('"v1.') + 1, -8))
	assert.deepEqual(decodeClipAttr(clip.attr), JSON.parse(JSON.stringify(p)))
	assert.equal(clip.text, '# Plan <b>\n\n<script>alert(1)</script>\n\nBox')
	assert.equal(plainTextOf({ items: [connector(C, { x: 0, y: 0 }, { x: 1, y: 1 }, { data: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, label: 'L' } })] }), '', 'no connector labels')
	assert.ok(clip.bytes > 0)
})

test('clipAttrOf reads the attribute through a parser (an inert document); no marker or a throwing parser → null', () => {
	const parse = (html) => ({
		querySelector: (sel) => {
			assert.equal(sel, '[data-knorke-clip]')
			const mm = /data-knorke-clip="([^"]*)"/.exec(html)
			return mm ? { getAttribute: () => mm[1] } : null
		},
	})
	assert.equal(clipAttrOf('<html><body><!--StartFragment--><div data-knorke-clip="v1.abc"></div></body></html>', parse), 'v1.abc')
	assert.equal(clipAttrOf('<p>plain</p>', parse), null)
	assert.equal(clipAttrOf('<div data-knorke-clip="v1.x">', () => { throw new Error('boom') }), null)
	assert.equal(clipAttrOf(null, parse), null)
})

test('decodeClipAttr: wrong version, garbage, no JSON → null; above 2 MiB → tooLarge without decoding', () => {
	assert.equal(decodeClipAttr('v2.' + toBase64Url('{}')), null)
	assert.equal(decodeClipAttr('v1.%%%'), null)
	assert.equal(decodeClipAttr('v1.' + toBase64Url('not json')), null)
	assert.deepEqual(decodeClipAttr('v1.' + 'A'.repeat(Math.ceil(CLIP_MAX_BYTES / 3) * 4 + 4)), { tooLarge: true })
	assert.deepEqual(decodeClipAttr('v1.' + toBase64Url('{"knorke":1}')), { knorke: 1 })
})

test('validatePayload: payload level – format, PASTE_MAX items, 2 MiB', () => {
	for (const bad of [null, 7, 'x', [], { knorke: 2, items: [] }, { knorke: 1 }, { knorke: '1', items: [] }]) {
		assert.deepEqual(validatePayload(bad), { ok: false, reason: 'format', count: 0 }, JSON.stringify(bad))
	}
	assert.deepEqual(validatePayload({ tooLarge: true }), { ok: false, reason: 'size', count: 0 })
	const many = Array.from({ length: PASTE_MAX + 1 }, (_, i) => wire(sticky(ID(1000 + i))))
	assert.deepEqual(validatePayload(raw(many)), { ok: false, reason: 'max', count: PASTE_MAX + 1 })
	const big = [wire(sticky(A, { data: { text: 'x', blob: Array.from({ length: 900 }, () => 'y'.repeat(2400)) } }))]
	assert.deepEqual(validatePayload(raw(big)), { ok: false, reason: 'size', count: 1 })
})

test('validatePayload: item level – every rejection is skipped and counted, the rest stays', () => {
	const ok = wire(sticky(A, { x: 1, y: 2 }))
	const cases = {
		'id no ULID': { ...ok, id: 'nope' },
		'unknown type': { ...ok, id: ID(10), t: 'pen' },
		'type toString': { ...ok, id: ID(11), t: 'toString' },
		'x not finite': { ...ok, id: ID(12), x: 'NaN' },
		'y beyond 1e7': { ...ok, id: ID(13), y: 1e7 + 1 },
		'w below size': { ...ok, id: ID(14), w: TYPES.sticky.size[0] - 1 },
		'h above size': { ...ok, id: ID(15), h: TYPES.sticky.size[1] + 1 },
		'r beyond 360': { ...ok, id: ID(16), r: 361 },
		'data no map': { ...ok, id: ID(17), data: ['a'] },
		'bad key': { ...ok, id: ID(18), data: { text: 'a', '0bad': 1 } },
		'too deep': { ...ok, id: ID(19), data: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } },
		'lone surrogate': { ...ok, id: ID(20), data: { text: 'ok', note: 'a\uD800' } },
		'generic string too long': { ...ok, id: ID(21), data: { other: 'x'.repeat(6001) } },
		'typed color': { ...ok, id: ID(22), style: { fill: 'red' } },
		'typed size': { ...ok, id: ID(23), style: { fontSize: 9999 } },
		'note text too long': { ...ok, id: ID(24), data: { text: 'x'.repeat(TYPES.sticky.fields['data.text'][1] + 1) } },
		'shape kind': { ...wire(shape(ID(25))), data: { kind: 'star' } },
		'typed leaf as map': { ...ok, id: ID(26), data: { text: { x: 1 } } },
		'connector without end': { ...wire(connector(ID(27), { x: 0, y: 0 }, { x: 1, y: 1 })), data: { start: { x: 0, y: 0 } } },
		'connector bad end': { ...wire(connector(ID(28), { x: 0, y: 0 }, { item: 'nope' })) },
		'not an object': 7,
	}
	const items = [ok, ...Object.values(cases), { ...ok }]
	const v = validatePayload(raw(items))
	assert.equal(v.ok, true)
	assert.deepEqual(v.payload.items.map((it) => it.id), [A], 'the duplicate id is skipped as well')
	assert.equal(v.skipped, Object.keys(cases).length + 1)
})

test('validatePayload: empty = absent before the typed checks (R8), normalised values, placement rules, parents', () => {
	const items = [
		{ ...wire(frame(F, { r: 0 })), r: 30, data: { title: 'T', gone: null, empty: {} } },
		{ ...wire(sticky(A, { x: 5, y: 6 })), parent: F, style: { fill: '#ABCDEF', fontSize: null } },
		{ ...wire(sticky(B)), parent: ID(99) },
		{ ...wire(sticky(ID(3))), parent: A },
		{ ...wire(connector(C, { item: A, ax: 0.123456, ay: 1 }, { x: -0, y: 3 })), x: 5, parent: F },
	]
	const v = validatePayload(raw(items, { origin: [1, 'x'] }))
	assert.equal(v.ok, true)
	assert.equal(v.skipped, 0)
	const [f, a, b, c3, c] = v.payload.items
	assert.equal(f.r, 0, 'frames are never rotated')
	assert.deepEqual(f.data, { title: 'T' })
	assert.deepEqual(a.style, { fill: '#abcdef' })
	assert.equal(a.parent, F)
	assert.equal(b.parent, null, 'a parent outside the payload makes a root')
	assert.equal(c3.parent, null, 'a note is no container')
	assert.deepEqual([c.x, c.y, c.w, c.h, c.r, c.parent], [0, 0, 0, 0, 0, null])
	assert.deepEqual(c.data.start, { item: A, ax: 0.1235, ay: 1 })
	assert.ok(Object.is(c.data.end.x, 0), 'never -0')
	assert.equal(v.payload.origin, null)
	assert.equal(v.payload.board, 7)
})

test('storage: {v, ts, text, payload}; taken within 10 min when the plain text matches; expired or broken entries are deleted', () => {
	const st = memoryStorage()
	const payload = raw([wire(sticky(A))])
	assert.equal(storeClip(st, { text: 'a\nb', payload }, 1000), true)
	assert.deepEqual(st.getJson('local', CLIP_KEY), { v: 1, ts: 1000, text: 'a\nb', payload })
	assert.deepEqual(readStoredClip(st, 'a\r\nb\n', 1000 + CLIP_TTL_MS), payload, 'CRLF and a trailing line break do not matter')
	assert.equal(readStoredClip(st, 'other', 2000), null)
	assert.ok(st.getJson('local', CLIP_KEY), 'another text leaves the entry')
	assert.equal(readStoredClip(st, 'a\nb', 1000 + CLIP_TTL_MS + 1), null)
	assert.equal(st.getJson('local', CLIP_KEY), null, 'expired: deleted when read')
	st.setItem('local', CLIP_KEY, '{"v":1,"ts":"x"}')
	assert.equal(readStoredClip(st, '', 0), null)
	assert.equal(st.getJson('local', CLIP_KEY), null)
	assert.equal(storeClip(st, { text: 'x', payload: { blob: 'y'.repeat(CLIP_MAX_BYTES) } }, 0), false, 'above 2 MiB: not stored')
	const throwing = { getJson() { throw new Error('quota') }, setJson() { throw new Error('quota') }, removeItem() { throw new Error('no') } }
	assert.equal(storeClip(throwing, { text: 'x', payload }, 0), false)
	assert.equal(readStoredClip(throwing, 'x', 0), null)
	assert.equal(comparableText('a\r\n\r\n'), 'a')
	assert.equal(comparableText(' '), comparableText(''), 'a copy without text puts a space into the hidden field')
})

test('clipboardDataOf: html, text and the number of files of a paste event', () => {
	const ev = (data, files = [], items = []) => ({ clipboardData: { getData: (t) => data[t] ?? '', files, items } })
	assert.deepEqual(clipboardDataOf(ev({ 'text/html': '<b>', 'text/plain': 'x' })), { html: '<b>', text: 'x', files: 0 })
	assert.deepEqual(clipboardDataOf(ev({}, [{}])), { html: '', text: '', files: 1 })
	assert.deepEqual(clipboardDataOf(ev({}, [], [{ kind: 'string' }, { kind: 'file' }])), { html: '', text: '', files: 1 })
	assert.deepEqual(clipboardDataOf({}), { html: '', text: '', files: 0 })
	assert.deepEqual(clipboardDataOf({ clipboardData: { getData() { throw new Error('denied') } } }), { html: '', text: '', files: 0 })
})

/** Minimal DOM for the execCommand path: the copy event goes to the document's listeners. */
function fakeDoc({ execResult = true } = {}) {
	const listeners = new Set()
	const doc = {
		data: null,
		focused: [],
		body: { children: [], appendChild(el) { this.children.push(el); el.parent = this } },
		activeElement: { focus: () => doc.focused.push('canvas') },
		createElement(tag) {
			assert.equal(tag, 'textarea')
			return {
				value: '', style: {}, attrs: {},
				setAttribute(k, v) { this.attrs[k] = v },
				focus() {},
				select() { doc.selected = this.value },
				remove() { doc.body.children = doc.body.children.filter((c) => c !== this) },
			}
		},
		addEventListener(type, fn) { assert.equal(type, 'copy'); listeners.add(fn) },
		removeEventListener(type, fn) { listeners.delete(fn) },
		execCommand(cmd) {
			assert.equal(cmd, 'copy')
			doc.calls = (doc.calls ?? 0) + 1
			doc.listenersAtCall = [...(doc.listenersAtCall ?? []), listeners.size]
			const data = {}
			const e = { clipboardData: { setData: (k, v) => { data[k] = v } }, preventDefault: () => { data.prevented = true } }
			for (const fn of listeners) {
				fn(e)
			}
			doc.data = data
			return execResult
		},
		listeners,
	}
	return doc
}

test('writeClipboard: secure context → navigator.clipboard.write with both formats (async)', async () => {
	const written = []
	const cb = { write: async (items) => { written.push(...items) } }
	class Item { constructor(o) { this.o = o } }
	class FakeBlob { constructor(parts, opt) { this.text = parts.join(''); this.type = opt.type } }
	const r = writeClipboard({ html: '<div>', text: 'plain' }, { clipboard: cb, ClipboardItem: Item, Blob: FakeBlob, doc: fakeDoc() })
	assert.equal(r, 'async')
	await Promise.resolve()
	assert.equal(written.length, 1)
	assert.deepEqual(Object.keys(written[0].o), ['text/html', 'text/plain'])
	assert.equal(written[0].o['text/plain'].text, 'plain')
	assert.equal(written[0].o['text/html'].type, 'text/html')
})

test('writeClipboard: no secure context → hidden field + execCommand, the copy handler sets BOTH formats; focus returns; nothing left behind', () => {
	const doc = fakeDoc()
	assert.equal(writeClipboard({ html: '<div data-knorke-clip="v1.x"></div>', text: 'a' }, { clipboard: null, doc }), 'exec')
	assert.deepEqual(doc.listenersAtCall, [0, 1], 'first the native copy of the selected text, then the one that sets both formats')
	assert.deepEqual(doc.data, { 'text/plain': 'a', 'text/html': '<div data-knorke-clip="v1.x"></div>', prevented: true })
	assert.equal(doc.selected, 'a')
	assert.deepEqual(doc.body.children, [], 'field removed')
	assert.equal(doc.listeners.size, 0, 'listener removed')
	assert.deepEqual(doc.focused, ['canvas'])
	// empty plain text: the field still has a selection (a space)
	const d2 = fakeDoc()
	execCopy({ html: 'h', text: '' }, d2)
	assert.equal(d2.selected, ' ')
	assert.equal(d2.data['text/plain'], '')
})

test('writeClipboard: an async write that fails tries execCommand; without exec only writeText; nothing at all → false', async () => {
	const doc = fakeDoc()
	class Item { constructor(o) { this.o = o } }
	const r = writeClipboard({ html: 'h', text: 't' }, { clipboard: { write: () => Promise.reject(new Error('denied')) }, ClipboardItem: Item, Blob: class { constructor() {} }, doc })
	assert.equal(r, 'async')
	await new Promise((resolve) => setTimeout(resolve, 0))
	assert.equal(doc.data['text/html'], 'h', 'fallback after the rejection')
	const texts = []
	assert.equal(writeClipboard({ html: 'h', text: 't' }, { clipboard: { writeText: async (s) => texts.push(s) }, ClipboardItem: null, doc: fakeDoc({ execResult: false }) }), 'text')
	assert.deepEqual(texts, ['t'])
	assert.equal(writeClipboard({ html: 'h', text: 't' }, { clipboard: null, doc: null }), false)
})

test('paste catcher: paste → preventDefault, formats to the handler, field emptied; typing is cleared; detach removes both listeners', () => {
	const handlers = {}
	const el = {
		value: 'junk',
		addEventListener: (type, fn) => { handlers[type] = fn },
		removeEventListener: (type, fn) => { if (handlers[type] === fn) delete handlers[type] },
	}
	const got = []
	const detach = attachPasteCatcher(el, (d) => got.push(d))
	let prevented = false
	handlers.paste({ preventDefault: () => { prevented = true }, clipboardData: { getData: (t) => (t === 'text/plain' ? 'x' : ''), files: [] } })
	assert.equal(prevented, true)
	assert.deepEqual(got, [{ html: '', text: 'x', files: 0 }])
	assert.equal(el.value, '')
	el.value = 'typed'
	handlers.input()
	assert.equal(el.value, '')
	detach()
	assert.deepEqual(Object.keys(handlers), [])
	assert.equal(typeof attachPasteCatcher(null, () => {}), 'function')
})

test('copy is left to the browser with a DOM text selection or a focused input field (not the catcher)', () => {
	assert.equal(hasDomSelection({ getSelection: () => ({ isCollapsed: false, toString: () => 'Board title' }) }), true)
	assert.equal(hasDomSelection({ getSelection: () => ({ isCollapsed: true, toString: () => '' }) }), false)
	assert.equal(hasDomSelection(null), false)
	assert.equal(hasDomSelection({ getSelection() { throw new Error('x') } }), false)
	const el = (tag, attrs = {}, extra = {}) => ({ tagName: tag, hasAttribute: (k) => k in attrs, ...extra })
	assert.equal(inputFocused({ activeElement: el('INPUT') }), true)
	assert.equal(inputFocused({ activeElement: el('TEXTAREA') }), true)
	assert.equal(inputFocused({ activeElement: el('DIV', {}, { isContentEditable: true }) }), true)
	assert.equal(inputFocused({ activeElement: el('TEXTAREA', { 'data-knorke-paste-catcher': '' }) }), false)
	assert.equal(inputFocused({ activeElement: el('DIV') }), false)
	assert.equal(inputFocused(null), false)
})

test('paste catcher without access to the data (WebKit: empty clipboardData): the browser inserts the plain text, the catcher hands it over; nothing inserted → empty after a short wait', () => {
	const handlers = {}
	const el = { value: '', addEventListener: (t, fn) => { handlers[t] = fn }, removeEventListener: (t, fn) => { if (handlers[t] === fn) delete handlers[t] } }
	const pending = []
	const timers = { setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length }, clearTimeout: (n) => { if (pending[n - 1]) pending[n - 1].fn = null } }
	const got = []
	const detach = attachPasteCatcher(el, (d) => got.push(d), timers)
	let prevented = false
	const empty = { preventDefault: () => { prevented = true }, clipboardData: { getData: () => '', files: [] } }
	handlers.paste(empty)
	assert.equal(prevented, false, 'the default insertion must happen')
	assert.deepEqual(got, [])
	el.value = 'L1\nL2'
	handlers.input()
	assert.deepEqual(got, [{ html: '', text: 'L1\nL2', files: 0 }])
	assert.equal(el.value, '')
	assert.equal(pending[0].fn, null, 'the wait is cancelled')
	assert.equal(pending[0].ms, CATCHER_INSERT_MS)
	// nothing inserted: after the wait the (empty) result still reaches the session
	handlers.paste(empty)
	pending[1].fn()
	assert.deepEqual(got.at(-1), { html: '', text: '', files: 0 })
	handlers.paste(empty)
	detach()
	assert.equal(pending[2].fn, null, 'detach cancels a wait')
})

// ---- Job 026 (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): the group key of knorke:1 ----

test('job 026 (AK5): validatePayload keeps group only as a ULID, any other value becomes null; knorke stays 1; copyPayload writes it', () => {
	const g = '01JG0000000000000000000001'
	const items = [
		wire(sticky(A, { group: g })),
		wire(sticky(B, { group: 'x' })),
		wire(sticky(ID(3), { group: 5 })),
		wire(sticky(ID(4), { group: g.toLowerCase() })),
		wire(sticky(ID(5))),
		wire(sticky(ID(6), { group: g + '\n' })),
	]
	const v = validatePayload(raw(items))
	assert.equal(v.ok, true)
	assert.deepEqual(v.payload.items.map((it) => it.group), [g, null, null, null, null, null])
	assert.equal(v.payload.knorke, 1)
	const m = new FakeModel([sticky(A, { group: g }), sticky(B, { x: 300, group: g }), frame(F, { x: 2000 })])
	const p = copyPayload(m, [A, B, F])
	assert.deepEqual(p.items.map((it) => [it.id, it.group]), [[F, null], [A, g], [B, g]], 'group per item (string or null)')
	assert.deepEqual(validatePayload(p).payload.items.map((it) => it.group), [null, g, g], 'the own payload passes the check unchanged')
})
