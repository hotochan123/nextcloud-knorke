/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Fakes for the board tests (helper, not a test file): a SceneModel with the
 * subset of the §6.2 API that actions.js and BoardSession use, and a scene
 * that follows the §6.3 facade and records every call. Independent of [S]'s
 * real implementation, so these tests only pin [C]'s side of the contract.
 */
import { routeConnector } from '../../../src/model/connectors.js'
import { typeInfo, layerRank } from '../../../src/model/registry.js'
import { applyPatch } from '../../../src/model/paths.js'
import { cmpBytes, isValidKey } from '../../../src/model/zorder.js'

export const ID = (n) => '01JA' + String(n).padStart(22, '0')

/**
 * @param {string} id item id
 * @param {object} [extra] fields
 * @return {object} sticky WireItem
 */
export function sticky(id, extra = {}) {
	return { id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'i0', parent: null, data: { text: '' }, style: { fill: '#a8d8f8' }, ...extra }
}

/**
 * @param {string} id item id
 * @param {object} [extra] fields
 * @return {object} frame WireItem
 */
export function frame(id, extra = {}) {
	return { id, t: 'frame', x: 0, y: 0, w: 800, h: 600, r: 0, z: 'a0', parent: null, data: { title: '' }, style: { fill: '#ffffff' }, ...extra }
}

/**
 * @param {string} id item id
 * @param {object} [extra] fields
 * @return {object} shape WireItem (SPEC-M1 §3.10)
 */
export function shape(id, extra = {}) {
	return { id, t: 'shape', x: 0, y: 0, w: 200, h: 120, r: 0, z: 'i0', parent: null, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }, ...extra }
}

/**
 * @param {string} id item id
 * @param {object} [extra] fields
 * @return {object} text WireItem (SPEC-M1 §3.10)
 */
export function textItem(id, extra = {}) {
	return { id, t: 'text', x: 0, y: 0, w: 240, h: 28.8, r: 0, z: 'i0', parent: null, data: { text: '' }, style: { fontSize: 24, color: '#1a1a1a', align: 'left' }, ...extra }
}

/**
 * @param {string} id item id
 * @param {object} start data.start
 * @param {object} end data.end
 * @param {object} [extra] fields
 * @return {object} connector WireItem (SPEC-M1 §3.10)
 */
export function connector(id, start, end, extra = {}) {
	return { id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'i9', parent: null, data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' }, ...extra }
}

/**
 * The fake text measurement (scene.measureTextHeight): lines × fontSize × 1.2,
 * a line holding w / (fontSize / 2) characters. Deterministic, so tests can
 * compute the expected heights.
 *
 * @param {object} item WireItem
 * @return {number} height
 */
export function fakeTextHeight(item) {
	const fs = item.style?.fontSize ?? 24
	const perLine = Math.max(1, Math.floor((item.w ?? 240) / (fs / 2)))
	const lines = String(item.data?.text ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
	return lines * fs * 1.2
}

export class FakeModel {
	constructor(items = []) {
		this.items = new Map()
		this.calls = { load: 0, apply: [] }
		this.loadItems(items)
	}

	loadItems(items) {
		this.items = new Map(items.map((it) => [it.id, structuredClone(it)]))
	}

	load(items) {
		this.calls.load++
		this.loadItems(items)
	}

	apply({ upserts = [], removes = [] } = {}) {
		const summary = { added: [], removed: [], updated: new Map(), geometry: new Set(), reordered: false }
		for (const it of upserts) {
			if (this.items.has(it.id)) {
				summary.updated.set(it.id, new Set(['geom']))
			} else {
				summary.added.push(it.id)
			}
			this.items.set(it.id, structuredClone(it))
			summary.geometry.add(it.id)
		}
		for (const id of removes) {
			if (this.items.delete(id)) {
				summary.removed.push(id)
			}
		}
		this.calls.apply.push({ upserts: upserts.map((u) => u.id), removes: [...removes] })
		return summary
	}

	get(id) {
		return this.items.get(id) ?? null
	}

	has(id) {
		return this.items.has(id)
	}

	get size() {
		return this.items.size
	}

	ids() {
		return this.items.keys()
	}

	abs(id) {
		const it = this.items.get(id)
		if (!it) {
			return null
		}
		let x = it.x
		let y = it.y
		let p = it.parent
		for (let depth = 0; p && depth < 8; depth++) {
			const parent = this.items.get(p)
			if (!parent || !typeInfo(parent.t).container) {
				break
			}
			x += parent.x
			y += parent.y
			p = parent.parent
		}
		return { x, y, w: it.w, h: it.h, r: it.r ?? 0 }
	}

	compareOrder(a, b) {
		const A = this.items.get(a)
		const B = this.items.get(b)
		const ra = layerRank(A.t)
		const rb = layerRank(B.t)
		if (ra !== rb) {
			return ra - rb
		}
		return cmpBytes(A.z, B.z) || cmpBytes(a, b)
	}

	sortByOrder(ids) {
		return [...ids].filter((id) => this.items.has(id)).sort((a, b) => this.compareOrder(a, b))
	}

	topContainerAt(wx, wy, exclude = new Set()) {
		let best = null
		for (const [id, it] of this.items) {
			if (exclude.has(id) || !typeInfo(it.t).container) {
				continue
			}
			const a = this.abs(id)
			if (wx >= a.x && wy >= a.y && wx <= a.x + a.w && wy <= a.y + a.h && (best === null || this.compareOrder(id, best) > 0)) {
				best = id
			}
		}
		return best
	}

	queryRect(rect, mode = 'intersect') {
		const minX = Math.min(rect.x, rect.x + rect.w)
		const maxX = Math.max(rect.x, rect.x + rect.w)
		const minY = Math.min(rect.y, rect.y + rect.h)
		const maxY = Math.max(rect.y, rect.y + rect.h)
		const out = []
		for (const id of this.items.keys()) {
			const a = this.abs(id)
			const hit = mode === 'contain'
				? a.x >= minX && a.y >= minY && a.x + a.w <= maxX && a.y + a.h <= maxY
				: a.x <= maxX && a.x + a.w >= minX && a.y <= maxY && a.y + a.h >= minY
			if (hit) {
				out.push(id)
			}
		}
		return this.sortByOrder(out)
	}

	childrenOf(id) {
		return this.sortByOrder([...this.items.values()].filter((it) => it.parent === id).map((it) => it.id))
	}

	/** Group index (M2, R20 Gruppieren, SceneModel.membersOf): the items with this group, in stacking order. */
	membersOf(g) {
		return this.sortByOrder([...this.items.values()].filter((it) => typeof g === 'string' && it.group === g).map((it) => it.id))
	}

	/** SceneModel.groupSize: how many items have this group (no sorting). */
	groupSize(g) {
		let n = 0
		for (const it of this.items.values()) {
			if (typeof g === 'string' && it.group === g) n++
		}
		return n
	}

	descendantsOf(id) {
		const out = []
		let level = [id]
		for (let d = 0; d < 8 && level.length; d++) {
			const next = []
			for (const p of level) {
				for (const c of this.childrenOf(p)) {
					out.push(c)
					next.push(c)
				}
			}
			level = next
		}
		return out
	}

	maxZ(layer) {
		let best = null
		for (const it of this.items.values()) {
			if (typeInfo(it.t).layer === layer && isValidKey(it.z) && (best === null || it.z > best)) {
				best = it.z
			}
		}
		return best
	}

	minZ(layer) {
		let best = null
		for (const it of this.items.values()) {
			if (typeInfo(it.t).layer === layer && isValidKey(it.z) && (best === null || it.z < best)) {
				best = it.z
			}
		}
		return best
	}

	allBounds() {
		return null
	}

	/** Test helper: move items locally like a drag (no ops). */
	moveLocal(ids, dx, dy) {
		for (const id of ids) {
			const it = this.items.get(id)
			applyPatch(it, { x: it.x + dx, y: it.y + dy })
		}
	}
}

/**
 * FakeModel plus the connector part of the SceneModel v2 API (SPEC-M1 §6.2,
 * round 1b): connectorsOf(ids) (also through descendants) and geometryOf(id)
 * routed with the frozen routeConnector of src/model/connectors.js from the
 * absolute boxes, so what the session reads as "visible docking point" is
 * exactly what the model would draw.
 */
export class RoutedModel extends FakeModel {
	connectorsOf(ids) {
		const all = new Set()
		for (const id of ids) {
			all.add(id)
			for (const d of this.descendantsOf(id)) {
				all.add(d)
			}
		}
		const out = new Set()
		for (const it of this.items.values()) {
			if (it.t === 'connector' && ['start', 'end'].some((w) => all.has(it.data?.[w]?.item))) {
				out.add(it.id)
			}
		}
		return out
	}

	geometryOf(id) {
		const it = this.items.get(id)
		if (!it || it.t !== 'connector') {
			return null
		}
		const end = (ep) => ({ box: ep && typeof ep.item === 'string' && this.items.has(ep.item) ? this.abs(ep.item) : null, ep, point: null })
		return routeConnector(end(it.data?.start), end(it.data?.end), it.data?.route)
	}
}

export class FakeScene {
	constructor(container, model, opts) {
		this.container = container
		this.model = model
		this.opts = opts
		this.callbacks = opts.callbacks
		this.viewOnly = !!opts.viewOnly
		this.active = new Set()
		this.calls = []
		this.camera = { x: 0, y: 0, scale: 1 }
		this.tool = 'select'
		this.selection = []
		this.presenceChangedCount = 0
		this.sampler = null
		// the background grid (M2, R12): the option of the session, then setGrid
		this.grid = opts.grid === true
		// snapping to the shown grid (M2, R12, job 019): the option of the session, then setGridSnap
		this.gridSnap = opts.gridSnap === true
		FakeScene.last = this
	}

	log(name, ...args) {
		this.calls.push([name, ...args])
	}

	callsOf(name) {
		return this.calls.filter((c) => c[0] === name)
	}

	mount() { this.log('mount') }
	destroy() { this.log('destroy') }
	getCamera() { return { ...this.camera } }
	setCamera(c) { this.camera = { ...c }; this.log('setCamera', c) }
	fit() { this.log('fit') }
	zoomBy(f, anchor = null) { this.camera.scale *= f; this.log('zoomBy', f, anchor) }
	screenToWorld(x, y) { return { x, y } }
	worldToScreen(x, y) { return { x: x + 1, y: y + 2 } }
	itemScreenRect(id) { return this.model.has(id) ? { x: 10, y: 20, w: 30, h: 40 } : null }
	update(summary) { this.log('update', summary) }
	reset() { this.log('reset') }
	setTool(t, opts = null) { this.tool = t; this.toolOpts = { ...(this.toolOpts ?? {}), [t]: opts }; this.log('setTool', t, opts) }
	getTool() { return this.tool }
	getToolOptions(t) { return this.toolOpts?.[t] ?? (t === 'shape' ? { kind: 'rect' } : {}) }
	/** SPEC-M1 §6.3: deterministic fake (fakeTextHeight), every call recorded. */
	measureTextHeight(item) { this.log('measureTextHeight', structuredClone(item)); return fakeTextHeight(item) }
	focusCanvas() { this.log('focusCanvas') }
	handles() { return this.handleList ?? [] }
	getSelection() { return [...this.selection] }
	setSelection(ids) { this.selection = [...ids]; this.log('setSelection', [...ids]) }
	setViewOnly(v) { this.viewOnly = v; this.log('setViewOnly', v) }
	setGrid(on) { this.grid = on === true; this.log('setGrid', on) }
	getGrid() { return this.grid }
	setGridSnap(on) { this.gridSnap = on === true; this.log('setGridSnap', on) }
	getGridSnap() { return this.gridSnap }
	setRemoteSampler(fn) { this.sampler = fn }
	presenceChanged() { this.presenceChangedCount++ }
	isActive(id) { return this.active.has(id) }
	openTextEditor(id, opts = {}) { this.log('openTextEditor', id, opts) }
	setEditorNotice(id, notice) { this.log('setEditorNotice', id, notice) }
	/**
	 * §6.3 flushEditor(): when the test set `dirty` ({id, value, before, path}),
	 * an open editor holds text that was not emitted yet: emit it as an
	 * intermediate intent (final:false), synchronously, and report true.
	 */
	flushEditor() {
		this.log('flushEditor')
		const d = this.dirty
		if (!d) {
			return false
		}
		this.dirty = null
		this.callbacks.onIntent({ type: 'text', id: d.id, path: d.path ?? 'data.text', value: d.value, before: d.before ?? '', final: false })
		return true
	}
	stats() { return { items: this.model.size, cssTransform: null } }
}

/**
 * In-memory storage facade (same shape as util/storage.js webStorage()).
 *
 * @return {object} storage with .data
 */
export function memoryStorage() {
	const data = { local: new Map(), session: new Map() }
	return {
		data,
		getItem: (kind, key) => data[kind].get(key) ?? null,
		setItem: (kind, key, value) => { data[kind].set(key, String(value)); return true },
		removeItem: (kind, key) => { data[kind].delete(key) },
		getJson: (kind, key) => {
			const v = data[kind].get(key)
			return v === undefined ? null : JSON.parse(v)
		},
		setJson: (kind, key, value) => { data[kind].set(key, JSON.stringify(value)); return true },
	}
}
