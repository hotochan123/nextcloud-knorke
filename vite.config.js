/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createAppConfig } from '@nextcloud/vite-config'
import { join, resolve, sep } from 'node:path'
import { LAZY_AREAS } from './build/lazy-areas.mjs'
import { styleFreshness } from './build/style-fresh.mjs'

/**
 * Factory job 172: the roots of the emoji list (emoji-mart-vue-fast with its
 * data and NcEmojiPicker) that only "More…" of the reaction picker loads,
 * by a dynamic import.
 */
const EMOJI_ROOT = /[\\/]node_modules[\\/](emoji-mart-vue-fast[\\/]|@nextcloud[\\/]vue[\\/]dist[\\/](components[\\/]NcEmojiPicker[\\/]|chunks[\\/]NcEmojiPicker\.mjs$|assets[\\/]NcEmojiPicker\.css$))/

/**
 * Is a module part of the emoji list: one of its roots, or a module that
 * only the emoji list imports (every importer, static or dynamic, is part
 * of it)? Those go into the one lazy chunk js/emoji-*.chunk.mjs; a module
 * anything else imports stays in vendor, so main, vendor and canvas never
 * import the emoji chunk statically.
 *
 * @param {string} id module id
 * @param {(id: string) => ({importers: string[], dynamicImporters: string[]}|null)} info rollup's getModuleInfo
 * @param {Set<string>} [path] modules on the way here (a cycle back leads nowhere else)
 * @return {boolean}
 */
function emojiOnly(id, info, path = new Set()) {
	if (EMOJI_ROOT.test(id)) return true
	if (path.has(id)) return true
	const m = info(id)
	const importers = m ? [...m.importers, ...m.dynamicImporters] : []
	if (importers.length === 0) return false
	path.add(id)
	const only = importers.every((x) => emojiOnly(x, info, path))
	path.delete(id)
	return only
}

/** Job 217: absolute path (forward slashes) of each root → its area. */
const ROOT_AREA = new Map(Object.entries(LAZY_AREAS).flatMap(([area, roots]) => roots.map((r) => [resolve(r).split(sep).join('/'), area])))

/**
 * @param {string} id module id
 * @return {string|undefined} the area whose root it is (job 217)
 */
function rootArea(id) {
	return ROOT_AREA.get(id.split('?')[0].split(sep).join('/'))
}

/**
 * Job 217: does a module belong to the lazy area: one of its roots (also a
 * part of an SFC, id with ?vue&type=…), or a module that only the area
 * imports (every importer, static or dynamic, belongs to it), as emojiOnly
 * does for the emoji list? Such modules, of src/ and node_modules alike, go
 * into js/<area>-*.chunk.mjs; anything main needs as well stays in main or
 * vendor. A "no" holds for good and is kept in `no` (a "yes" may rest on a
 * cycle still being walked).
 *
 * @param {string} area key of LAZY_AREAS
 * @param {string} id module id
 * @param {(id: string) => ({importers: string[], dynamicImporters: string[]}|null)} info rollup's getModuleInfo
 * @param {Set<string>} no modules known not to belong to it
 * @param {Set<string>} [path] modules on the way here (a cycle back leads nowhere else)
 * @return {boolean}
 */
function areaOnly(area, id, info, no, path = new Set()) {
	if (rootArea(id) === area) return true
	if (path.has(id)) return true
	if (no.has(id)) return false
	const m = info(id)
	const importers = m ? [...m.importers, ...m.dynamicImporters] : []
	path.add(id)
	const only = importers.length > 0 && importers.every((x) => areaOnly(area, x, info, no, path))
	path.delete(id)
	if (!only) no.add(id)
	return only
}

/**
 * Job 217: the modules the lazy parts import, directly or through others
 * (static imports, from their roots down). Those of them outside an area
 * go into vendor, never into main: Nextcloud loads js/knorke-main.mjs with
 * ?v=…, so a chunk importing "./knorke-main.mjs" would run a second copy of
 * the app. Nothing imports main then.
 *
 * @param {(id: string) => ({importedIds: string[]}|null)} info rollup's getModuleInfo
 * @param {Iterable<string>} ids module ids of the build
 * @return {Set<string>}
 */
function lazyDeps(info, ids) {
	const seen = new Set()
	const todo = [...ids].filter((id) => rootArea(id) !== undefined)
	while (todo.length > 0) {
		const id = todo.pop()
		if (seen.has(id)) continue
		seen.add(id)
		todo.push(...(info(id)?.importedIds ?? []))
	}
	return seen
}

/**
 * Job 217: what manualChunks learns in one build: per area the modules
 * known not to belong to it, and lazyDeps once the graph is known.
 *
 * @return {{notIn: Map<string, Set<string>>, deps: (Set<string>|null)}}
 */
function lazyState() {
	return { notIn: new Map(Object.keys(LAZY_AREAS).map((a) => [a, new Set()])), deps: null }
}

/** Job 217: the state of the current build (fresh at buildStart). */
let LAZY = lazyState()

/**
 * Job 217: forgets LAZY at the start of every build (watch mode builds again).
 *
 * @return {object} vite plugin
 */
function lazyAreas() {
	return {
		name: 'knorke-lazy-areas',
		buildStart() {
			LAZY = lazyState()
		},
	}
}

/** Job 172: the modules of the emoji list that register @nextcloud/vue translations. */
const EMOJI_L10N_IMPORTERS = /[\\/]@nextcloud[\\/]vue[\\/]dist[\\/]chunks[\\/](NcEmojiPicker|NcColorPicker|colors)\.mjs$/
/** Job 172: @nextcloud/vue's emoji helpers (skin tone, search) import the package's CommonJS bundle. */
const EMOJI_HELPERS = /[\\/]@nextcloud[\\/]vue[\\/]dist[\\/]chunks[\\/]emoji\.mjs$/

/**
 * Job 172: keeps what only the emoji list needs out of vendor.
 * - NcEmojiPicker, NcColorPicker and colors.mjs import @nextcloud/vue's
 *   translation module (_l10n.mjs, every language of every component in
 *   one module): they get their own copy of it (the same file under the id
 *   …?knorke-emoji, with its own gettext instance), so the tables they
 *   register stay in the emoji chunk; everything else keeps vendor's.
 * - emoji.mjs imports emoji-mart-vue-fast's CommonJS bundle while
 *   NcEmojiPicker imports its sources: both get the sources (one copy, one
 *   store of recently used emoji).
 *
 * @return {object} vite plugin
 */
function emojiChunk() {
	return {
		name: 'knorke-emoji-chunk',
		enforce: 'pre',
		async resolveId(source, importer, options) {
			if (!importer) return null
			if (source === './_l10n.mjs' && EMOJI_L10N_IMPORTERS.test(importer)) {
				const r = await this.resolve(source, importer, { ...options, skipSelf: true })
				return r ? { ...r, id: r.id + '?knorke-emoji' } : null
			}
			if (source === 'emoji-mart-vue-fast' && EMOJI_HELPERS.test(importer)) {
				return this.resolve('emoji-mart-vue-fast/src/index.js', importer, { ...options, skipSelf: true })
			}
			return null
		},
	}
}

export default createAppConfig({ main: resolve(join('src', 'main.js')) }, {
	// Without it the name comes from appinfo/info.xml or npm_package_name;
	// a build without info.xml would otherwise risk "undefined-main.mjs".
	appName: 'knorke',
	nodePolyfills: false,
	config: {
		// SPEC-M1 §9.5 WP-C4 (b): the hash of every src/styles/*.css, taken in the
		// plugin's transform hook from the text vite translates, goes to
		// js/knorke-style.fresh.json for build/check-fresh.mjs (CSS has no map).
		// The plugin returns no code: js/ and css/ stay as they are.
		plugins: [styleFreshness(), emojiChunk(), lazyAreas()],
		resolve: { dedupe: ['vue'] },
		build: {
			// Exactly one CSS file: css/knorke-style.css
			cssCodeSplit: false,
			chunkSizeWarningLimit: 1500,
			rollupOptions: {
				output: {
					manualChunks: (id, { getModuleInfo, getModuleIds }) => {
						if (/[\\/]node_modules[\\/](konva|rbush|quickselect|fractional-indexing)[\\/]/.test(id)) return 'canvas'
						// Job 172: the emoji list and what only it needs, one chunk loaded by "More…"
						if (/[\\/]node_modules[\\/]/.test(id) && emojiOnly(id, getModuleInfo)) return 'emoji'
						// Job 217: the parts most visitors never use, each one chunk loaded on first use
						for (const area of Object.keys(LAZY_AREAS)) {
							if (areaOnly(area, id, getModuleInfo, LAZY.notIn.get(area))) return area
						}
						// Also catches lazy imports inside @nextcloud/vue, so no other lazy chunks appear.
						if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor'
						// Job 217: what a lazy part shares with the rest (also virtual modules such as
						// vite's preload helper) goes into vendor, the rest stays with the entry. A module
						// left unnamed would be pulled into the first chunk that needs it.
						LAZY.deps ??= lazyDeps(getModuleInfo, getModuleIds())
						if (LAZY.deps.has(id) || id.startsWith('\0')) return 'vendor'
						return 'main'
					},
				},
			},
		},
	},
})
