/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The built-in shape libraries of the shapes panel (factory job 201) and
 * what the panel keeps per browser.
 *
 * - SHAPE_LIBS: the libraries in panel order, each with its entries
 *   {id: '<lib>.<name>', kind}; one kind may stand in two libraries (the
 *   flowchart's process is the rectangle). Every kind of the registry stands
 *   in a library; the symbols (shapes.js icon) only in 'symbols'.
 * - entryLabel / englishLabel: the label of an entry, translated and in
 *   English. LABELS takes the translator as its parameter t, so every text
 *   is a literal t('knorke', …) for build/l10n-check.mjs, and the English
 *   text comes from the same table (an identity translator).
 * - searchEntries: the panel's search, over every library (hidden ones too).
 * - readPrefs / usePrefs: localStorage knorke.shapes, JSON {hidden, folded,
 *   recent}: hidden and folded library ids, the RECENT_MAX entries used last
 *   (newest first). Anything unreadable counts as nothing stored; unknown
 *   ids are dropped.
 *
 * Job 204 (BPMN): the library 'bpmn' after the flowchart, its kinds in the
 * order of shapes.js BPMN_GROUPS, then the entry 'bpmn.pool' of the kind
 * POOL_KIND, which is no shape: the panel puts a frame with lanes for it
 * (the frame tool with "Swimlanes"), its tile shows POOL_PREVIEW.
 *
 * Job 203 (own shape libraries): the libraries of this Nextcloud and of the
 * account (route 46: {id, name, names}) stand after the built-in ones. A
 * library's id in the choices is libKey(id) = 'lib:<id>', an entry's
 * 'lib:<id>.<index>' (ownEntries: {id, kind: 'image', lib, index, name},
 * its label the name); readPrefs keeps such ids by their form,
 * prunePrefs drops those of libraries that are gone; searchEntries goes
 * over their names too.
 */
import { deepFreeze } from '../model/freeze.js'
import { t as translate } from '../util/l10n.js'

/** localStorage key of the panel's choices (util/storage.js header). */
export const PREFS_KEY = 'knorke.shapes'

/** (Job 204) The kind of the entry "Pool with lanes": no shape kind, the panel puts a frame with lanes. */
export const POOL_KIND = 'pool'

/** (Job 204) The preview of POOL_KIND in the 24 × 24 grid: a box with its head column and two lane lines, stroked. */
export const POOL_PREVIEW = Object.freeze({ d: 'M2 5H22V19H2ZM6 5V19M6 9.67H22M6 14.33H22', filled: false, mark: null, thick: false })

/** Entries kept in "Recently used" (job 229: three, one row of the three-column grid; a longer stored list is cut). */
export const RECENT_MAX = 3

/**
 * @param {string} lib library id
 * @param {Array<[string, string]>} list [name, kind] pairs
 * @return {Array<{id: string, kind: string}>} entries
 */
function entries(lib, list) {
	return list.map(([name, kind]) => ({ id: lib + '.' + name, kind }))
}

export const SHAPE_LIBS = deepFreeze([
	{
		id: 'basic',
		entries: entries('basic', [
			['rect', 'rect'], ['roundRect', 'roundRect'], ['ellipse', 'ellipse'], ['diamond', 'diamond'],
			['triangle', 'triangle'], ['arrowRight', 'arrowRight'],
		]),
	},
	{
		id: 'flowchart',
		entries: entries('flowchart', [
			['process', 'rect'], ['decision', 'diamond'], ['terminal', 'terminal'], ['inputOutput', 'parallelogram'],
			['document', 'document'], ['database', 'database'], ['subprocess', 'subprocess'], ['preparation', 'hexagon'],
			['manualInput', 'manualInput'], ['manualOperation', 'trapezoid'], ['delay', 'delay'], ['offPage', 'offPage'],
		]),
	},
	{
		id: 'bpmn',
		entries: entries('bpmn', [
			['start', 'bpmnStart'], ['startMessage', 'bpmnStartMessage'], ['startTimer', 'bpmnStartTimer'],
			['intermediate', 'bpmnIntermediate'], ['intermediateMessage', 'bpmnIntermediateMessage'], ['intermediateTimer', 'bpmnIntermediateTimer'],
			['end', 'bpmnEnd'], ['endMessage', 'bpmnEndMessage'], ['endError', 'bpmnEndError'],
			['endTerminate', 'bpmnEndTerminate'], ['task', 'bpmnTask'], ['userTask', 'bpmnUserTask'],
			['serviceTask', 'bpmnServiceTask'], ['manualTask', 'bpmnManualTask'], ['scriptTask', 'bpmnScriptTask'],
			['ruleTask', 'bpmnRuleTask'], ['sendTask', 'bpmnSendTask'], ['receiveTask', 'bpmnReceiveTask'],
			['subprocess', 'bpmnSubprocess'], ['callActivity', 'bpmnCallActivity'], ['exclusive', 'bpmnExclusive'],
			['parallel', 'bpmnParallel'], ['inclusive', 'bpmnInclusive'], ['eventGateway', 'bpmnEventGateway'],
			['dataObject', 'bpmnDataObject'], ['dataInput', 'bpmnDataInput'], ['dataOutput', 'bpmnDataOutput'],
			['dataStore', 'bpmnDataStore'],
			['pool', POOL_KIND],
		]),
	},
	{
		id: 'symbols',
		entries: entries('symbols', [
			['person', 'iconPerson'], ['people', 'iconPeople'], ['place', 'iconPlace'], ['clock', 'iconClock'],
			['warning', 'iconWarning'], ['info', 'iconInfo'], ['question', 'iconQuestion'], ['done', 'iconDone'],
			['error', 'iconError'], ['star', 'iconStar'], ['heart', 'iconHeart'], ['idea', 'iconIdea'],
			['flag', 'iconFlag'], ['calendar', 'iconCalendar'], ['mail', 'iconMail'], ['phone', 'iconPhone'],
			['home', 'iconHome'], ['settings', 'iconSettings'], ['lock', 'iconLock'], ['cloud', 'iconCloud'],
		]),
	},
])

/** Every entry by id. */
const BY_ID = new Map(SHAPE_LIBS.flatMap((lib) => lib.entries.map((e) => [e.id, e])))
const LIB_IDS = Object.freeze(SHAPE_LIBS.map((lib) => lib.id))

/* eslint-disable no-shadow */
/** Label of each entry; t is the translator (literal texts for build/l10n-check.mjs). */
const LABELS = Object.freeze({
	'basic.rect': (t) => t('knorke', 'Rectangle'),
	'basic.roundRect': (t) => t('knorke', 'Rounded rectangle'),
	'basic.ellipse': (t) => t('knorke', 'Ellipse'),
	'basic.diamond': (t) => t('knorke', 'Diamond'),
	'basic.triangle': (t) => t('knorke', 'Triangle'),
	'basic.arrowRight': (t) => t('knorke', 'Arrow'),
	'flowchart.process': (t) => t('knorke', 'Process'),
	'flowchart.decision': (t) => t('knorke', 'Decision'),
	'flowchart.terminal': (t) => t('knorke', 'Start / end'),
	'flowchart.inputOutput': (t) => t('knorke', 'Input / output'),
	'flowchart.document': (t) => t('knorke', 'Document'),
	'flowchart.database': (t) => t('knorke', 'Database'),
	'flowchart.subprocess': (t) => t('knorke', 'Subprocess'),
	'flowchart.preparation': (t) => t('knorke', 'Preparation'),
	'flowchart.manualInput': (t) => t('knorke', 'Manual input'),
	'flowchart.manualOperation': (t) => t('knorke', 'Manual operation'),
	'flowchart.delay': (t) => t('knorke', 'Delay'),
	'flowchart.offPage': (t) => t('knorke', 'Off-page reference'),
	'symbols.person': (t) => t('knorke', 'Person'),
	'symbols.people': (t) => t('knorke', 'People'),
	'symbols.place': (t) => t('knorke', 'Place'),
	'symbols.clock': (t) => t('knorke', 'Clock'),
	'symbols.warning': (t) => t('knorke', 'Warning'),
	'symbols.info': (t) => t('knorke', 'Info'),
	'symbols.question': (t) => t('knorke', 'Question'),
	'symbols.done': (t) => t('knorke', 'Done'),
	'symbols.error': (t) => t('knorke', 'Error'),
	'symbols.star': (t) => t('knorke', 'Star'),
	'symbols.heart': (t) => t('knorke', 'Heart'),
	'symbols.idea': (t) => t('knorke', 'Idea'),
	'symbols.flag': (t) => t('knorke', 'Flag'),
	'symbols.calendar': (t) => t('knorke', 'Calendar'),
	'symbols.mail': (t) => t('knorke', 'Mail'),
	'symbols.phone': (t) => t('knorke', 'Phone'),
	'symbols.home': (t) => t('knorke', 'Home'),
	'symbols.settings': (t) => t('knorke', 'Settings'),
	'symbols.lock': (t) => t('knorke', 'Padlock'),
	'symbols.cloud': (t) => t('knorke', 'Cloud'),
	// job 204
	'bpmn.start': (t) => t('knorke', 'Start event'),
	'bpmn.startMessage': (t) => t('knorke', 'Message start event'),
	'bpmn.startTimer': (t) => t('knorke', 'Timer start event'),
	'bpmn.intermediate': (t) => t('knorke', 'Intermediate event'),
	'bpmn.intermediateMessage': (t) => t('knorke', 'Message intermediate event'),
	'bpmn.intermediateTimer': (t) => t('knorke', 'Timer intermediate event'),
	'bpmn.end': (t) => t('knorke', 'End event'),
	'bpmn.endMessage': (t) => t('knorke', 'Message end event'),
	'bpmn.endError': (t) => t('knorke', 'Error end event'),
	'bpmn.endTerminate': (t) => t('knorke', 'Terminate end event'),
	'bpmn.task': (t) => t('knorke', 'Task'),
	'bpmn.userTask': (t) => t('knorke', 'User task'),
	'bpmn.serviceTask': (t) => t('knorke', 'Service task'),
	'bpmn.manualTask': (t) => t('knorke', 'Manual task'),
	'bpmn.scriptTask': (t) => t('knorke', 'Script task'),
	'bpmn.ruleTask': (t) => t('knorke', 'Business rule task'),
	'bpmn.sendTask': (t) => t('knorke', 'Send task'),
	'bpmn.receiveTask': (t) => t('knorke', 'Receive task'),
	'bpmn.subprocess': (t) => t('knorke', 'Collapsed subprocess'),
	'bpmn.callActivity': (t) => t('knorke', 'Call activity'),
	'bpmn.exclusive': (t) => t('knorke', 'Exclusive gateway'),
	'bpmn.parallel': (t) => t('knorke', 'Parallel gateway'),
	'bpmn.inclusive': (t) => t('knorke', 'Inclusive gateway'),
	'bpmn.eventGateway': (t) => t('knorke', 'Event-based gateway'),
	'bpmn.dataObject': (t) => t('knorke', 'Data object'),
	'bpmn.dataInput': (t) => t('knorke', 'Data input'),
	'bpmn.dataOutput': (t) => t('knorke', 'Data output'),
	'bpmn.dataStore': (t) => t('knorke', 'Data store'),
	'bpmn.pool': (t) => t('knorke', 'Pool with lanes'),
})

/** Name of each library. */
const LIB_NAMES = Object.freeze({
	basic: (t) => t('knorke', 'Basic shapes'),
	flowchart: (t) => t('knorke', 'Flowchart'),
	bpmn: (t) => t('knorke', 'BPMN'),
	symbols: (t) => t('knorke', 'Symbols'),
})
/* eslint-enable no-shadow */

/**
 * @param {string} app app id
 * @param {string} text English source text
 * @return {string} the text itself
 */
function english(app, text) {
	return text
}

/** (job 203) The id of an own or adopted library in the choices, and of one of its entries. */
const LIB_KEY_RE = /^lib:[1-9][0-9]{14}$/
const LIB_ENTRY_RE = /^lib:([1-9][0-9]{14})\.(0|[1-9][0-9]{0,2})$/

/**
 * @param {number|string} id library id
 * @return {string} (job 203) its id in the choices
 */
export function libKey(id) {
	return 'lib:' + id
}

/**
 * @param {{id: number, names: string[]}} lib a library of route 46
 * @return {Array<{id: string, kind: string, lib: number, index: number, name: string}>} (job 203) its entries
 */
export function ownEntries(lib) {
	const names = Array.isArray(lib?.names) ? lib.names : []
	return names.map((name, index) => ({ id: `lib:${lib.id}.${index}`, kind: 'image', lib: lib.id, index, name: String(name) }))
}

/**
 * @param {string} id entry id
 * @param {Array<{id: number, names: string[]}>} [libs] (job 203) the own and adopted libraries
 * @return {{id: string, kind: string}|null} the entry
 */
export function entryOf(id, libs = []) {
	const e = BY_ID.get(id)
	if (e) return e
	const m = LIB_ENTRY_RE.exec(String(id))
	const lib = m ? libs.find((l) => String(l.id) === m[1]) : null
	return lib ? (ownEntries(lib)[Number(m[2])] ?? null) : null
}

/**
 * @param {{id: string}} entry entry
 * @return {string} its label in the UI language
 */
export function entryLabel(entry) {
	if (typeof entry?.name === 'string') return entry.name
	const f = LABELS[entry?.id]
	return f ? f(translate) : String(entry?.id ?? '')
}

/**
 * @param {{id: string}} entry entry
 * @return {string} its English label
 */
export function englishLabel(entry) {
	const f = LABELS[entry?.id]
	return f ? f(english) : String(entry?.id ?? '')
}

/**
 * @param {string} lib library id
 * @return {string} its name in the UI language
 */
export function libName(lib) {
	const f = LIB_NAMES[lib]
	return f ? f(translate) : String(lib)
}

/**
 * The panel's search: trimmed, case-insensitive, a part of the label in the
 * UI language or in English; every library, hidden ones too, in panel order.
 *
 * @param {unknown} query typed text
 * @param {(entry: object) => string} [labelOf] label in the UI language (tests)
 * @param {Array<{id: number, names: string[]}>} [libs] (job 203) the adopted and own libraries, after the built-in ones
 * @return {Array<{id: string, kind: string}>} hits; none for an empty query
 */
export function searchEntries(query, labelOf = entryLabel, libs = []) {
	const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
	if (q === '') return []
	const out = []
	for (const lib of SHAPE_LIBS) {
		for (const e of lib.entries) {
			if (String(labelOf(e)).toLowerCase().includes(q) || englishLabel(e).toLowerCase().includes(q)) out.push(e)
		}
	}
	for (const lib of libs) {
		for (const e of ownEntries(lib)) {
			if (e.name.toLowerCase().includes(q)) out.push(e)
		}
	}
	return out
}

/**
 * @param {unknown} v value
 * @param {(id: string) => boolean} known accepted ids
 * @param {number} [max] most ids
 * @return {string[]} the known string ids of v, each once, at most max
 */
function idList(v, known, max = Infinity) {
	const out = []
	for (const id of Array.isArray(v) ? v : []) {
		if (typeof id === 'string' && known(id) && !out.includes(id)) out.push(id)
		if (out.length >= max) break
	}
	return out
}

/**
 * @param {string|null} raw stored JSON (localStorage knorke.shapes) or null
 * @return {{hidden: string[], folded: string[], recent: string[]}} the choices; defaults for anything unreadable
 */
export function readPrefs(raw) {
	let v = null
	try {
		v = typeof raw === 'string' ? JSON.parse(raw) : null
	} catch (e) {
		v = null
	}
	const o = v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {}
	// job 203: own and adopted libraries by the form of their ids
	const lib = (id) => LIB_IDS.includes(id) || LIB_KEY_RE.test(id)
	return {
		hidden: idList(o.hidden, lib),
		folded: idList(o.folded, lib),
		recent: idList(o.recent, (id) => BY_ID.has(id) || LIB_ENTRY_RE.test(id), RECENT_MAX),
	}
}

/**
 * (Job 203) The choices without the ids of own or adopted libraries that are gone.
 *
 * @param {{hidden: string[], folded: string[], recent: string[]}} prefs choices
 * @param {Array<{id: number, names: string[]}>} libs the libraries there are now
 * @return {{hidden: string[], folded: string[], recent: string[]}} prefs itself when nothing went
 */
export function prunePrefs(prefs, libs) {
	const keys = new Set(libs.map((l) => libKey(l.id)))
	const lib = (id) => LIB_IDS.includes(id) || keys.has(id)
	const entry = (id) => BY_ID.has(id) || entryOf(id, libs) !== null
	const next = { hidden: prefs.hidden.filter(lib), folded: prefs.folded.filter(lib), recent: prefs.recent.filter(entry) }
	const same = next.hidden.length === prefs.hidden.length && next.folded.length === prefs.folded.length && next.recent.length === prefs.recent.length
	return same ? prefs : next
}

/**
 * @param {{hidden: string[], folded: string[], recent: string[]}} prefs choices
 * @param {string} id the entry just used
 * @return {{hidden: string[], folded: string[], recent: string[]}} new choices: id first in recent, at most RECENT_MAX
 */
export function usePrefs(prefs, id) {
	if (!BY_ID.has(id) && !LIB_ENTRY_RE.test(String(id))) return prefs
	return { ...prefs, recent: [id, ...prefs.recent.filter((x) => x !== id)].slice(0, RECENT_MAX) }
}
