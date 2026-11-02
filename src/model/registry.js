/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Data-driven item types, client side: mirror of lib/Service/ItemRegistry.php
 * (SPEC-M0 §6.2, v2 in SPEC-M1 §4.8, §6.2). tests/js/model/registry.test.mjs
 * checks types, enums and field rules against tests/fixtures/registry-golden.json,
 * which the PHP test reads as well.
 *
 * Per type: layer, container rules (container, childOf), rotatable, size
 * ([min, max] of w and h), defaults for NEW items (stored when created; what
 * a missing field of a stored item means is fieldDefault()), textPath (text
 * lease, M0 §4.11), hit mode, rbush padding (pad), bindable (connector
 * target), votable, placement ('box', or 'none' = position always 0: rule 12),
 * resize/keepRatio (transformer), editor kind, required fields (rule 19) and
 * the typed field rules.
 *
 * Hit modes: 'box' hits the whole (rotated) box; 'frameEdge' only the title
 * band above the frame and a border band of FRAME_EDGE_HIT_PX / scale (the
 * inside counts as empty canvas); 'shape' follows SHAPES[kind].hit (shapes.js);
 * 'line' the routed connector line and its label box; (job 188) 'pad' the
 * box with the sheets and the title band of a note pad (model/pad.js); (job
 * 195) 'tree' the nodes and fold dots of a mind map (model/mindmap.js, the
 * layout the scene hands to SceneModel.setTreeHit).
 *
 * Field rules (same kinds, bounds and normalisation as the server):
 *   ['text', max]      string, "\r\n" → "\n", C0 controls except \t and \n
 *                      removed, then ≤ max code points (never shortened)
 *   ['color']          ^#[0-9a-fA-F]{6}$, normalised to lower case
 *   ['int', min, max]  whole number in bounds (12.0 counts, 12.5 does not), never -0
 *   ['enum', list]     a string of the list (case-sensitive)
 *   ['endpoint']       a connector end (connectors.js normalizeEndpoint: ax/ay as q(v, 10000))
 *   ['tags', max]      (job 191) a list of 1–max different ids in ULID form, kept in its
 *                      order (a note's data.tags; which ids name a tag is model/tags.js's)
 *   ['image', max]     (job 203) a list of pieces whose concatenation is a picture of at
 *                      most max characters (model/shapeImage.js; a shape's data.img)
 *   ['points', max]    (job 273) a flat list x0, y0, x1, y1, … of 2–max finite numbers,
 *                      |v| ≤ 1e7, even length, kept as sent (a pen stroke's data.points)
 * Reserved: bool, number. A rule without a checker
 * rejects every value.
 *
 * Unknown types (import, newer version, downgrade) render as a placeholder,
 * are never a container, never bindable or votable, and only allow
 * parent = null (§4.7 rule 8). All tables are frozen: clone defaults before
 * using them for a new item.
 */
import { normalizeEndpoint } from './connectors.js'
import { deepFreeze } from './freeze.js'
import { ULID_RE } from './ids.js'
import { getPath } from './paths.js'
import { IMAGE_MAX, joinImage } from './shapeImage.js'
import {
	CONNECTOR_STROKE, DEFAULT_STICKY_FILL, FRAME_FILL, NOTE_SIZE_M, SHAPE_BORDER, SHAPE_STROKE, TABLE_HEADER_FILL, TABLE_STROKE, TEXT_COLOR,
} from './tokens.js'

/** Enumerations of the field rules; equal to the PHP constants (registry golden). */
export const ENUMS = deepFreeze({
	// job 201: the flowchart kinds and the symbols (icon…) after the six of M1 (model/shapes.js)
	shapeKinds: [
		'rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight',
		'terminal', 'parallelogram', 'document', 'database', 'subprocess', 'hexagon', 'manualInput', 'trapezoid', 'delay', 'offPage',
		'iconPerson', 'iconPeople', 'iconPlace', 'iconClock', 'iconWarning', 'iconInfo', 'iconQuestion', 'iconDone', 'iconError', 'iconStar', 'iconHeart', 'iconIdea', 'iconFlag', 'iconCalendar', 'iconMail', 'iconPhone', 'iconHome', 'iconSettings', 'iconLock', 'iconCloud',
		// job 203: an own shape, its picture in data.img (model/shapeImage.js)
		'image',
		// job 204: BPMN 2.0, events, tasks, gateways and data (model/shapes.js)
		'bpmnStart', 'bpmnStartMessage', 'bpmnStartTimer', 'bpmnIntermediate', 'bpmnIntermediateMessage', 'bpmnIntermediateTimer', 'bpmnEnd', 'bpmnEndMessage', 'bpmnEndError', 'bpmnEndTerminate',
		'bpmnTask', 'bpmnUserTask', 'bpmnServiceTask', 'bpmnManualTask', 'bpmnScriptTask', 'bpmnRuleTask', 'bpmnSendTask', 'bpmnReceiveTask', 'bpmnSubprocess', 'bpmnCallActivity',
		'bpmnExclusive', 'bpmnParallel', 'bpmnInclusive', 'bpmnEventGateway', 'bpmnDataObject', 'bpmnDataInput', 'bpmnDataOutput', 'bpmnDataStore',
	],
	dashes: ['solid', 'dashed', 'dotted'],
	aligns: ['left', 'center', 'right'],
	valigns: ['top', 'middle', 'bottom'],
	routes: ['straight', 'elbow', 'curved'],
	// job 204: the open circle and the open triangle of a BPMN message flow
	caps: ['none', 'arrow', 'triangle', 'dot', 'diamond', 'circleOpen', 'triangleOpen'],
	// job 173: style.header of a table
	headers: ['on', 'off'],
	// job 195: style.layout of a mind map
	mindLayouts: ['both', 'right', 'org', 'tree'],
	// job 273: data.kind of a pen stroke (pen line or see-through highlighter)
	penKinds: ['pen', 'marker'],
})

/** (job 273) Most numbers in a stroke's data.points: 500 points (= ItemRegistry::POINTS_MAX). */
export const POINTS_MAX = 1000

/**
 * Known types (the only types a put may create). `size` mirrors the server
 * limits for w and h ([min, max]).
 */
export const TYPES = deepFreeze({
	sticky: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: true,
		size: [20, 2000],
		defaults: { w: 200, h: 200, data: { text: '' }, style: { fill: DEFAULT_STICKY_FILL, fontSize: NOTE_SIZE_M } },
		textPath: 'data.text', hit: 'box', pad: 'shadow', bindable: true, votable: true, placement: 'box',
		resize: 'box', keepRatio: true, editor: 'note', required: [],
		// job 191: the note's tags (ids of meta.tags in the order they were ticked)
		fields: { 'data.text': ['text', 6000], 'style.fill': ['color'], 'style.fontSize': ['int', 8, 200], 'data.tags': ['tags', 8] },
	},
	frame: {
		layer: 'back', container: true, childOf: [], rotatable: false,
		size: [50, 100000],
		defaults: { w: 800, h: 600, data: { title: '' }, style: { fill: FRAME_FILL } },
		textPath: 'data.title', hit: 'frameEdge', pad: 'title', bindable: false, votable: false, placement: 'box',
		resize: 'box', keepRatio: false, editor: 'title', required: [],
		fields: { 'data.title': ['text', 200], 'style.fill': ['color'] },
	},
	shape: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: true,
		size: [10, 20000],
		// job 260: the border SHAPE_BORDER (a BPMN kind brings its own, shapes.js BPMN_STYLE)
		defaults: { w: 200, h: 120, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: SHAPE_BORDER, strokeWidth: 2 } },
		textPath: 'data.text', hit: 'shape', pad: 'stroke', bindable: true, votable: true, placement: 'box',
		resize: 'box', keepRatio: false, editor: 'shape', required: [],
		fields: {
			'data.kind': ['enum', ENUMS.shapeKinds], 'data.text': ['text', 6000],
			'style.fill': ['color'], 'style.fillOpacity': ['int', 0, 100], 'style.stroke': ['color'],
			'style.strokeWidth': ['int', 0, 24], 'style.dash': ['enum', ENUMS.dashes], 'style.textColor': ['color'],
			'style.fontSize': ['int', 8, 200], 'style.align': ['enum', ENUMS.aligns], 'style.valign': ['enum', ENUMS.valigns],
			// job 203: the picture of an own shape (kind image)
			'data.img': ['image', IMAGE_MAX],
			// job 240: the tick "1:1" of "Arrange" (model/shapes.js squareOn), the on/off list of style.header
			'style.square': ['enum', ENUMS.headers],
		},
	},
	text: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: true,
		size: [4, 50000],
		// job 241: a new text item is centred; a stored one without style.align stays left (FIELD_DEFAULTS)
		defaults: { w: 240, h: 31, data: { text: '' }, style: { fontSize: 24, color: SHAPE_STROKE, align: 'center' } },
		textPath: 'data.text', hit: 'box', pad: 'none', bindable: true, votable: true, placement: 'box',
		resize: 'text', keepRatio: false, editor: 'text', required: [],
		fields: {
			'data.text': ['text', 6000], 'style.fontSize': ['int', 8, 400], 'style.color': ['color'],
			'style.align': ['enum', ENUMS.aligns],
		},
	},
	connector: {
		layer: 'content', container: false, childOf: [], rotatable: false,
		size: [0, 0],
		// job 153: a new connector is elbow; a stored one without data.route stays straight (FIELD_DEFAULTS)
		// job 261: a new connector ends with a filled triangle (an open arrow until 0.4.0)
		defaults: { w: 0, h: 0, data: { route: 'elbow' }, style: { stroke: CONNECTOR_STROKE, strokeWidth: 2, endCap: 'triangle' } },
		textPath: 'data.label', hit: 'line', pad: 'line', bindable: false, votable: false, placement: 'none',
		resize: 'none', keepRatio: false, editor: 'label', required: ['data.start', 'data.end'],
		fields: {
			'data.start': ['endpoint'], 'data.end': ['endpoint'], 'data.route': ['enum', ENUMS.routes],
			'data.label': ['text', 200], 'style.stroke': ['color'], 'style.strokeWidth': ['int', 1, 24],
			'style.dash': ['enum', ENUMS.dashes], 'style.startCap': ['enum', ENUMS.caps], 'style.endCap': ['enum', ENUMS.caps],
		},
	},
	// job 173: data.cols/rows/cells have no typed rule (their form is checkTable's, model/table.js:
	// a typed leaf would refuse the paths below it); createItem fills data with newTableData()
	table: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: false,
		size: [20, 100000],
		defaults: { w: 480, h: 108, data: {}, style: {} },
		textPath: null, hit: 'box', pad: 'none', bindable: true, votable: false, placement: 'box',
		resize: 'none', keepRatio: false, editor: 'cell', required: ['data.cols', 'data.rows'],
		fields: {
			'style.stroke': ['color'], 'style.textColor': ['color'], 'style.headerFill': ['color'],
			'style.header': ['enum', ENUMS.headers],
			// job 265: the header column
			'style.headerCol': ['enum', ENUMS.headers],
		},
	},
	// job 188: a note pad, a pile of blank notes to take off (model/pad.js); hit 'pad' and the rbush padding
	// 'band' take in its sheets below the box (job 263: and the shadow); four corners like a note, no rotation
	pad: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: false,
		size: [20, 2000],
		defaults: { w: 200, h: 200, data: { title: '' }, style: { fill: DEFAULT_STICKY_FILL } },
		textPath: 'data.title', hit: 'pad', pad: 'band', bindable: false, votable: false, placement: 'box',
		resize: 'box', keepRatio: true, editor: 'padTitle', required: [],
		fields: { 'data.title': ['text', 200], 'style.fill': ['color'] },
	},
	// job 195: a mind map (model/mindmap.js): data.nodes/data.texts have no typed rule (their form is
	// checkMindmap's); hit 'tree' takes only its nodes and fold dots (the scene's layout), the rest of its
	// box is empty canvas; createItem fills data with newMindmapData()
	mindmap: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: false,
		size: [20, 100000],
		defaults: { w: 120, h: 48, data: {}, style: {} },
		textPath: null, hit: 'tree', pad: 'none', bindable: false, votable: false, placement: 'box',
		resize: 'none', keepRatio: false, editor: 'node', required: ['data.nodes'],
		fields: { 'style.layout': ['enum', ENUMS.mindLayouts] },
	},
	// job 267: an AI summary card (scene/nodes/ai.js, model/markdown.js): the AI's Markdown in data.md,
	// the frame it summarises in data.title; nobody edits it (no editor, no text path), it is not resized
	ai: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: false,
		size: [20, 20000],
		defaults: { w: 360, h: 120, data: {}, style: {} },
		textPath: null, hit: 'box', pad: 'none', bindable: true, votable: false, placement: 'box',
		resize: 'none', keepRatio: false, editor: null, required: [],
		fields: { 'data.md': ['text', 12000], 'data.title': ['text', 200] },
	},
	// job 273: a freehand stroke of the pen or the highlighter (model/ink.js): data.points relative to x/y,
	// the box their hull plus half the width at drawing time (rbush padding 'stroke': a wider line set later still
	// lies in the index); hit 'ink' takes only the line, the rest of the box is canvas
	pen: {
		layer: 'content', container: false, childOf: ['frame'], rotatable: false,
		size: [0, 100000],
		defaults: { w: 0, h: 0, data: { kind: 'pen' }, style: { stroke: TEXT_COLOR, strokeWidth: 4 } },
		textPath: null, hit: 'ink', pad: 'stroke', bindable: false, votable: false, placement: 'box',
		resize: 'none', keepRatio: false, editor: null, required: ['data.points'],
		fields: {
			'data.kind': ['enum', ENUMS.penKinds], 'data.points': ['points', POINTS_MAX],
			'style.stroke': ['color'], 'style.strokeWidth': ['int', 1, 64],
		},
	},
})

/**
 * Type info for anything not in TYPES (the server's GENERIC): drawn as a
 * placeholder box, moved and deleted with generic rules, never resized (its
 * data may depend on the box), no editor.
 */
export const PLACEHOLDER = deepFreeze({
	layer: 'content', container: false, childOf: [], rotatable: true, size: [0, 1000000], hit: 'box', textPath: null,
	pad: 'none', bindable: false, votable: false, placement: 'box', resize: 'none', keepRatio: false, editor: null,
	required: [], fields: {},
})

/**
 * Display value of a field that is missing in a STORED item (§3.10 table),
 * shared by renderer, LOD-2 painter and context bar. null = nothing stored
 * stands in: style.fontSize of sticky and shape is auto-fit (computed, never
 * stored), data.label of a connector is no label.
 */
const FIELD_DEFAULTS = deepFreeze({
	sticky: { 'data.text': '', 'style.fill': DEFAULT_STICKY_FILL, 'style.fontSize': null, 'data.tags': null },
	frame: { 'data.title': '', 'style.fill': FRAME_FILL },
	shape: {
		'data.kind': 'rect', 'data.text': '', 'style.fill': '#ffffff', 'style.fillOpacity': 100, 'style.stroke': SHAPE_BORDER,
		'style.strokeWidth': 2, 'style.dash': 'solid', 'style.textColor': SHAPE_STROKE, 'style.fontSize': null,
		'style.align': 'center', 'style.valign': 'middle', 'data.img': null,
		// job 240: missing = derived from kind and box (model/shapes.js squareOn)
		'style.square': null,
	},
	text: { 'data.text': '', 'style.fontSize': 24, 'style.color': SHAPE_STROKE, 'style.align': 'left' },
	connector: {
		'data.route': 'straight', 'data.label': null, 'style.stroke': CONNECTOR_STROKE, 'style.strokeWidth': 2,
		'style.dash': 'solid', 'style.startCap': 'none', 'style.endCap': 'none',
	},
	table: { 'style.stroke': TABLE_STROKE, 'style.textColor': TEXT_COLOR, 'style.headerFill': TABLE_HEADER_FILL, 'style.header': 'on', 'style.headerCol': 'off' },
	pad: { 'data.title': '', 'style.fill': DEFAULT_STICKY_FILL },
	mindmap: { 'style.layout': 'both' },
	ai: { 'data.md': '', 'data.title': '' },
	pen: { 'data.kind': 'pen', 'data.points': null, 'style.stroke': TEXT_COLOR, 'style.strokeWidth': 4 },
})

const LAYER_RANK = Object.freeze({ back: 0, content: 1 })
const COLOR_RE = /^#[0-9a-fA-F]{6}$/
// C0 control characters except \t (09) and \n (0A); \r is removed after "\r\n" → "\n".
const CONTROL_RE = /[\x00-\x08\x0B-\x1F]/g

/**
 * @param {object} o object
 * @param {string} k key
 * @return {boolean} own property
 */
function hasOwn(o, k) {
	return Object.prototype.hasOwnProperty.call(o, k)
}

/**
 * @param {unknown} t type name
 * @return {boolean} true for a registry type (the only types a put may create)
 */
export function isKnownType(t) {
	return typeof t === 'string' && hasOwn(TYPES, t)
}

/**
 * @param {unknown} t type name
 * @return {object} TYPES[t] for known types, otherwise PLACEHOLDER
 *   (own keys only: 'constructor' or 'toString' are unknown types, too)
 */
export function typeInfo(t) {
	return isKnownType(t) ? TYPES[t] : PLACEHOLDER
}

/**
 * @param {unknown} t type name
 * @return {number} 0 for the back layer (frames), 1 for content
 */
export function layerRank(t) {
	return LAYER_RANK[typeInfo(t).layer]
}

/**
 * @param {unknown} childT type of the child
 * @param {unknown} parentT type of the intended parent
 * @return {boolean} true when parentT is a container that accepts childT
 */
export function canBeChildOf(childT, parentT) {
	const parent = typeInfo(parentT)
	if (!isKnownType(parentT) || !parent.container) {
		return false
	}
	return typeInfo(childT).childOf.includes(parentT)
}

/**
 * @param {unknown} t type name
 * @return {string|null} 'data.text' | 'data.title' | 'data.label' | null (no editable text)
 */
export function textPathOf(t) {
	return typeInfo(t).textPath
}

/**
 * @return {string[]} every text path of every known type, in type order
 *   (data.text, data.title, data.label), like ItemRegistry::allTextPaths
 */
export function allTextPaths() {
	const out = []
	for (const info of Object.values(TYPES)) {
		if (info.textPath !== null && !out.includes(info.textPath)) {
			out.push(info.textPath)
		}
	}
	return out
}

/**
 * @param {unknown} t type name
 * @return {boolean} may a connector end bind to an item of this type (rule 14)?
 */
export function isBindable(t) {
	return typeInfo(t).bindable === true
}

/**
 * @param {unknown} t type name
 * @return {boolean} may an item of this type get votes (§4.12.1)?
 */
export function isVotable(t) {
	return typeInfo(t).votable === true
}

/**
 * Mirror of ItemRegistry::isGroupable (M2, SPEC-M1 §1.2 "(R20)
 * Gruppieren"): a known type with placement 'box' that is no container
 * (sticky, shape, text). Derived, not a table key: registry-golden.json
 * stays as it is.
 *
 * @param {unknown} t type name
 * @return {boolean} may an item of this type belong to a group?
 */
export function isGroupable(t) {
	if (!isKnownType(t)) {
		return false
	}
	const info = TYPES[t]
	return info.placement === 'box' && !info.container
}

/**
 * @param {unknown} t type name
 * @param {string} path field path, e.g. 'style.fill'
 * @return {Array|null} the typed rule (frozen, e.g. ['int', 8, 200]) or null
 *   when the path has none (unknown fields are only checked generically)
 */
export function fieldRule(t, path) {
	const fields = typeInfo(t).fields
	return typeof path === 'string' && hasOwn(fields, path) ? fields[path] : null
}

/**
 * The text rule of the server (Input::text): a string of valid UTF-16 (no
 * lone surrogate: the server cannot decode it), "\r\n" → "\n", C0 controls
 * except \t and \n removed, then at most max code points.
 *
 * @param {unknown} v value
 * @param {number} max code points
 * @return {string|null} cleaned text, or null (`bad`, never shortened)
 */
function cleanText(v, max) {
	if (typeof v !== 'string') {
		return null
	}
	const s = v.replace(/\r\n/g, '\n').replace(CONTROL_RE, '')
	let n = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = s.charCodeAt(i + 1)
			if (!(d >= 0xdc00 && d <= 0xdfff)) {
				return null
			}
			i++
		} else if (c >= 0xdc00 && c <= 0xdfff) {
			return null
		}
		n++
	}
	return n <= max ? s : null
}

/**
 * (Job 191) The rule tags: a list of 1–max strings in ULID form, each once.
 *
 * @param {unknown} v value
 * @param {number} max most ids
 * @return {boolean}
 */
function tagIdsOk(v, max) {
	if (!Array.isArray(v) || v.length === 0 || v.length > max) {
		return false
	}
	const seen = new Set()
	for (const id of v) {
		if (typeof id !== 'string' || !ULID_RE.test(id) || seen.has(id)) {
			return false
		}
		seen.add(id)
	}
	return true
}

/**
 * One typed field rule applied to one value (ItemRegistry::checkField of the
 * server, which takes the rule).
 *
 * @param {Array} rule field rule, e.g. ['int', 0, 100]
 * @param {unknown} v value
 * @return {{ok: boolean, norm: unknown}} norm = normalised value, null when not ok
 */
export function checkRule(rule, v) {
	switch (Array.isArray(rule) ? rule[0] : null) {
	case 'text': {
		const s = cleanText(v, rule[1])
		return s === null ? { ok: false, norm: null } : { ok: true, norm: s }
	}
	case 'color':
		return typeof v === 'string' && COLOR_RE.test(v) ? { ok: true, norm: v.toLowerCase() } : { ok: false, norm: null }
	case 'int':
		return typeof v === 'number' && Number.isInteger(v) && v >= rule[1] && v <= rule[2]
			? { ok: true, norm: v + 0 }
			: { ok: false, norm: null }
	case 'enum':
		return typeof v === 'string' && Array.isArray(rule[1]) && rule[1].includes(v) ? { ok: true, norm: v } : { ok: false, norm: null }
	case 'endpoint': {
		const ep = normalizeEndpoint(v)
		return ep === null ? { ok: false, norm: null } : { ok: true, norm: ep }
	}
	case 'tags':
		return tagIdsOk(v, rule[1]) ? { ok: true, norm: [...v] } : { ok: false, norm: null }
	case 'image': {
		// job 203: pieces whose concatenation is a picture (shapeImage.js)
		const uri = joinImage(v)
		return uri !== null && uri.length <= rule[1] ? { ok: true, norm: [...v] } : { ok: false, norm: null }
	}
	case 'points':
		// job 273: x0, y0, x1, y1, … of a pen stroke, kept as sent
		return Array.isArray(v) && v.length >= 2 && v.length <= rule[1] && v.length % 2 === 0
			&& v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)
			? { ok: true, norm: [...v] }
			: { ok: false, norm: null }
	default:
		return { ok: false, norm: null }
	}
}

/**
 * Typed check of one field value of type t (mirror of the server's
 * ItemRegistry::checkField with fieldRule(t, path)), frozen from stage 1
 * phase 0. Used by registry.test.mjs (golden values) and the clipboard.
 *
 * - a path with a rule: the rule decides, norm is the stored form
 *   (lower-case colour, cleaned text, +0, ends with ax/ay on the 1e-4 grid)
 * - a path BELOW a typed field (data.start.item, data.text.x): never ok, a
 *   typed leaf is never a map (rule 14, ItemRegistry::checkPatch)
 * - any other path: no typed rule, {ok: true, norm: value} (only the generic
 *   rules of paths.js apply)
 *
 * Like the server, an empty value (null, undefined, {}, []) is not ok under
 * a rule: "empty = absent" (M0 §4.7 rule 3) is the caller's business, as in
 * ItemRegistry::checkItem/checkPatch, which skip such values (and rule 19
 * for required fields).
 *
 * @param {unknown} t type name
 * @param {string} path field path
 * @param {unknown} value value as sent
 * @return {{ok: boolean, norm: unknown}}
 */
export function checkField(t, path, value) {
	const rule = fieldRule(t, path)
	if (rule !== null) {
		return checkRule(rule, value)
	}
	const p = String(path)
	for (const field of Object.keys(typeInfo(t).fields)) {
		if (p.startsWith(field + '.')) {
			return { ok: false, norm: null }
		}
	}
	return { ok: true, norm: value }
}

/**
 * What a missing field of a stored item means for drawing (§3.10 table; the
 * registry defaults only apply to NEW items). A stored enum value this
 * client does not know counts as missing (rule 18): use fieldValue() to read
 * a field with that rule applied.
 *
 * @param {unknown} t type name
 * @param {string} path field path
 * @return {unknown} the value to draw with; null = computed or nothing
 *   (style.fontSize of sticky/shape: auto-fit; data.label: no label);
 *   undefined = no display default for this path (unknown type or field)
 */
export function fieldDefault(t, path) {
	if (!isKnownType(t) || typeof path !== 'string') {
		return undefined
	}
	const table = FIELD_DEFAULTS[t]
	return hasOwn(table, path) ? table[path] : undefined
}

/**
 * The value to draw for a field of a stored item: the stored value, or
 * fieldDefault() when it is missing (null, {}, []) or does not pass its rule
 * (an enum value of a later version, rule 18; an invalid colour or size, as
 * in M0's fillOf/noteFontSize). Text values are only required to be strings.
 *
 * @param {object} item WireItem
 * @param {string} path field path
 * @return {unknown} stored (normalised) value or fieldDefault(item.t, path)
 */
export function fieldValue(item, path) {
	const t = item?.t
	const v = getPath(item, path)
	const empty = v === null || (typeof v === 'object' && Object.keys(v).length === 0)
	const rule = fieldRule(t, path)
	if (!empty && rule === null) {
		return v
	}
	if (!empty && rule[0] === 'text') {
		return typeof v === 'string' ? v : fieldDefault(t, path)
	}
	if (!empty) {
		const r = checkRule(rule, v)
		if (r.ok) {
			return r.norm
		}
	}
	return fieldDefault(t, path)
}
