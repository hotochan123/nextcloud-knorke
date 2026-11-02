<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<section :id="id"
		ref="rootEl"
		class="knorke-shapes"
		:style="placeStyle"
		role="dialog"
		:aria-label="t('knorke', 'Shapes')"
		data-knorke-shapes
		data-knorke-chrome
		@keydown.esc.stop.prevent="$emit('close')">
		<header class="knorke-shapes__head">
			<h3 class="knorke-shapes__title">
				{{ t('knorke', 'Shapes') }}
			</h3>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Close')"
				:title="t('knorke', 'Close')"
				data-knorke-action="shapes-close"
				@click="$emit('close')">
				<template #icon>
					<NcIconSvgWrapper :path="icons.close" />
				</template>
			</NcButton>
		</header>
		<input ref="searchEl"
			v-model="query"
			type="search"
			class="knorke-shapes__search"
			data-knorke-shapes-search
			:placeholder="t('knorke', 'Search shapes')"
			:aria-label="t('knorke', 'Search shapes')">
		<div class="knorke-shapes__body">
			<p v-if="searching && hits.length === 0" class="knorke-shapes__hint" role="status">
				{{ t('knorke', 'No shapes found.') }}
			</p>
			<section v-for="sec in sections"
				:key="sec.key"
				class="knorke-shapes__lib"
				:data-knorke-shape-lib="sec.key">
				<h4 v-if="sec.caption" class="knorke-shapes__caption">
					<button v-if="sec.fold"
						type="button"
						class="knorke-shapes__fold"
						:aria-expanded="sec.folded ? 'false' : 'true'"
						:aria-controls="id + '-' + sec.key"
						:data-knorke-shape-fold="sec.key"
						:title="sec.lib ? sec.caption : null"
						@click="toggleFold(sec.key)">
						<svg class="knorke-shapes__chevron" viewBox="0 0 24 24" aria-hidden="true"><path :d="sec.folded ? icons.chevronRight : icons.chevronDown" /></svg>
						<span class="knorke-shapes__name">{{ sec.caption }}</span>
					</button>
					<template v-else>
						{{ sec.caption }}
					</template>
					<span v-if="sec.pending" class="knorke-shapes__chip" data-knorke-shape-lib-pending>
						{{ t('knorke', 'Waiting for approval') }}
					</span>
					<NcActions v-if="sec.own"
						class="knorke-shapes__libmenu"
						variant="tertiary"
						container="#knorke-menus"
						force-menu
						:aria-label="t('knorke', 'Library actions')"
						:title="t('knorke', 'Library actions')"
						:data-knorke-shape-lib-menu="sec.key">
						<template #icon>
							<NcIconSvgWrapper :path="icons.dotsHorizontal" />
						</template>
						<NcActionButton close-after-click data-knorke-shape-lib-action="rename" @click="openDialog({ mode: 'rename', lib: sec.lib })">
							{{ t('knorke', 'Rename…') }}
						</NcActionButton>
						<NcActionButton v-if="!sec.pending && libs.right === 'save'"
							close-after-click
							data-knorke-shape-lib-action="publish"
							@click="publish(sec.lib)">
							{{ t('knorke', 'Make available to everyone') }}
						</NcActionButton>
						<NcActionButton v-else-if="!sec.pending"
							close-after-click
							data-knorke-shape-lib-action="suggest"
							@click="openDialog({ mode: 'suggest', lib: sec.lib })">
							{{ t('knorke', 'Suggest to admins…') }}
						</NcActionButton>
						<NcActionButton v-else
							close-after-click
							data-knorke-shape-lib-action="withdraw"
							@click="withdraw(sec.lib)">
							{{ t('knorke', 'Withdraw suggestion') }}
						</NcActionButton>
						<NcActionButton close-after-click data-knorke-shape-lib-action="delete" @click="openDialog({ mode: 'delete', lib: sec.lib })">
							{{ t('knorke', 'Delete…') }}
						</NcActionButton>
					</NcActions>
				</h4>
				<div v-if="!sec.folded" :id="id + '-' + sec.key" class="knorke-shapes__grid">
					<button v-for="e in sec.entries"
						:key="e.id"
						type="button"
						class="knorke-shapes__tile"
						:data-knorke-shape="e.id"
						:title="entryLabel(e)"
						@pointerdown="(ev) => onDown(e, ev)"
						@dragstart.prevent
						@click="(ev) => onClick(e, ev)">
						<img v-if="e.kind === 'image' && pictures.get(e.id)"
							class="knorke-shapes__pic"
							:src="pictures.get(e.id).uri"
							alt=""
							draggable="false"
							width="28"
							height="28">
						<span v-else-if="e.kind === 'image'" class="knorke-shapes__pic knorke-shapes__pic--wait" aria-hidden="true" />
						<ShapePreview v-else :kind="e.kind" :size="28" />
						<span class="knorke-shapes__label">{{ entryLabel(e) }}</span>
					</button>
				</div>
			</section>
			<p v-if="note" class="knorke-shapes__hint" role="status" data-knorke-shapes-note>
				{{ note }}
			</p>
			<p v-if="!searching && shownLibs.length === 0" class="knorke-shapes__hint">
				{{ t('knorke', 'No library is shown.') }}
			</p>
			<section v-if="!searching" class="knorke-shapes__lib knorke-shapes__choose">
				<h4 class="knorke-shapes__caption">
					<button type="button"
						class="knorke-shapes__fold"
						:aria-expanded="libsOpen ? 'true' : 'false'"
						:aria-controls="id + '-libs'"
						data-knorke-action="shapes-libs"
						@click="libsOpen = !libsOpen">
						<svg class="knorke-shapes__chevron" viewBox="0 0 24 24" aria-hidden="true"><path :d="libsOpen ? icons.chevronDown : icons.chevronRight" /></svg>
						<span class="knorke-shapes__name">{{ t('knorke', 'Libraries') }}</span>
					</button>
				</h4>
				<fieldset v-if="libsOpen" :id="id + '-libs'" class="knorke-shapes__libs" data-knorke-shapes-libs>
					<legend class="hidden-visually">
						{{ t('knorke', 'Libraries') }}
					</legend>
					<label v-for="lib in libChoices" :key="lib.key" class="knorke-shapes__check">
						<input type="checkbox"
							:checked="!prefs.hidden.includes(lib.key)"
							:data-knorke-shape-lib-toggle="lib.key"
							@change="(ev) => setShown(lib.key, ev.target.checked)">
						{{ lib.name }}
					</label>
				</fieldset>
			</section>
		</div>
		<div v-if="canImport" class="knorke-shapes__foot">
			<button type="button"
				class="knorke-shapes__import"
				data-knorke-action="shapes-import"
				:disabled="reading"
				@click="pickFiles">
				<svg class="knorke-shapes__importicon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.importShapes" /></svg>
				{{ t('knorke', 'Import shapes…') }}
			</button>
			<input ref="fileEl"
				type="file"
				class="hidden-visually"
				accept=".svg,.xml,image/svg+xml,application/xml,text/xml"
				multiple
				tabindex="-1"
				aria-hidden="true"
				data-knorke-shapes-file
				@change="onFiles">
		</div>
		<div v-if="ghost"
			class="knorke-shapes__ghost"
			data-knorke-shape-ghost
			:style="{ left: ghost.x + 'px', top: ghost.y + 'px' }">
			<img v-if="ghost.uri"
				class="knorke-shapes__pic"
				:src="ghost.uri"
				alt=""
				draggable="false"
				width="40"
				height="40">
			<ShapePreview v-else :kind="ghost.kind" :size="40" />
		</div>
		<ShapeLibDialog v-if="dialog"
			:mode="dialog.mode"
			:draft="dialog.draft ?? null"
			:lib="dialog.lib ?? null"
			@done="onDialogDone"
			@close="dialog = null" />
	</section>
</template>

<script setup>
/*
 * Shapes panel (factory job 201): beside the tool bar, [data-knorke-shapes].
 * From the top: a search over every shape ([data-knorke-shapes-search];
 * shapeLibs.js searchEntries, hidden libraries too), "Recently used", one
 * section per library shown ([data-knorke-shape-lib=<id>], a fold button
 * with aria-expanded), and (job 229) as the list's last foldable section
 * "Libraries" with a check box per library
 * ([data-knorke-shape-lib-toggle=<id>]). Job 229 (redesign P5): the shape
 * tool of the tool bar opens the panel (it has no button of its own any
 * more); "Recently used" holds three shapes (shapeLibs.js RECENT_MAX); the
 * foot, which never scrolls, holds only "Import shapes…", and only with the
 * right to import. Each tile
 * [data-knorke-shape=<entry id>] shows ShapePreview and the label.
 *
 * Use of a tile:
 * - a pointer click emits arm(kind): the shape tool takes this kind, the
 *   next click or drag on the board puts it (the view, setToolOptions);
 * - a click from the keyboard (Enter, Space: components/focus.js
 *   isPointerActivation false) emits place(kind, null): at once, in the
 *   middle of the view;
 * - a drag of DRAG_START_PX or more shows a preview at the pointer
 *   ([data-knorke-shape-ghost], pointer-events none, absolute in the panel);
 *   released over the
 *   board (document.elementFromPoint inside .knorke-canvas, panelDismiss.js
 *   isCanvasTarget) it emits place(kind, {x, y}) with the client point,
 *   anywhere else nothing; Esc or pointercancel end it; the click after a
 *   drag is dropped. Tiles have touch-action pan-y (CSS): a finger or pen
 *   moved up or down scrolls the list (the browser cancels the pointer),
 *   one moved sideways drags the shape.
 * Every use puts the entry first in "Recently used". The choices (hidden
 * and folded libraries, recently used) live in localStorage knorke.shapes
 * (shapeLibs.js readPrefs/usePrefs, util/storage.js never throws).
 *
 * Esc inside the panel emits close (the view gives the focus back to the
 * tool bar's shape tool).
 *
 * The foot is a <div>, never a <footer>: the guest page of Nextcloud places
 * footer elements at the bottom of the window (#body-public footer).
 *
 * Job 203 (own shape libraries), only with the prop account (a signed-in
 * account; never on the guest page): route 46 once per opening gives the
 * libraries of this Nextcloud and the account's own ones (names only).
 * They follow the built-in ones as sections [data-knorke-shape-lib=lib:<id>]
 * (adopted, then own), in "Libraries" as check boxes, and in the search.
 * Their pictures load (components/shapeLibCache.js) when a section is open
 * or the search or "Recently used" shows one of their entries; till then a
 * tile is grey. An own section has "Waiting for approval"
 * ([data-knorke-shape-lib-pending]) while it is suggested and a menu
 * [data-knorke-shape-lib-menu] ([data-knorke-shape-lib-action=rename |
 * suggest | publish | withdraw | delete]; publish for admins: adopted at
 * once). With a right (route 46: not an account of the Guests app) the foot
 * has "Import shapes…" ([data-knorke-action=shapes-import]): the files
 * picked (.svg, .xml) become a draft (board/shapeImport.js importShapes)
 * for ShapeLibDialog. An entry of such a library emits arm('image',
 * picture) and place('image', client, picture) with its picture {uri, w, h}.
 * A short status line ([data-knorke-shapes-note]) tells what happened
 * (adopted, withdrawn, an error). The pictures are never dragged by the
 * browser itself (draggable false, dragstart prevented on the tile): its
 * native image drag would cancel the pointer and so the panel's drag.
 * (Factory job 217) Importing and ShapeLibDialog are the lazy part shapelib
 * (util/parts.js): the file field opens at once, the part comes after the
 * pick; a dialog opens once it is loaded (openDialog). Failing, the toast
 * part-load-failed, and nothing opens.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { t } from '../util/l10n.js'
import { getItem, setItem } from '../util/storage.js'
import { isPointerActivation } from './focus.js'
import { icons } from './icons.js'
import { isCanvasTarget } from './panelDismiss.js'
import { PREFS_KEY, SHAPE_LIBS, entryLabel, entryOf, libKey, libName, ownEntries, prunePrefs, readPrefs, searchEntries, usePrefs } from './shapeLibs.js'
import ShapePreview from './ShapePreview.vue'
import * as libsApi from '../api/shapeLibs.js'
import { loadPart, partComponent } from '../util/parts.js'
import { forgetLib, libEntries } from './shapeLibCache.js'

const props = defineProps({
	/** id of the panel (aria-controls of the tool bar's shape tool) */
	id: { type: String, default: 'knorke-shapes' },
	/** opened from the keyboard: the search gets the focus (never on touch: no screen keyboard) */
	autofocus: { type: Boolean, default: false },
	/** (round 2) board px from the board's start edge to the panel, just beyond the tool bar; null: the CSS default */
	start: { type: Number, default: null },
	/** (job 203) a signed-in account: own and adopted libraries, import */
	account: { type: Boolean, default: false },
})

const emit = defineEmits(['arm', 'place', 'close'])

/** Way of a pointer on a tile before it drags the shape (CSS px). */
const DRAG_START_PX = 6
/** A click this soon after a drag ended belongs to the drag. */
const AFTER_DRAG_MS = 400

const rootEl = ref(null)
const searchEl = ref(null)
const query = ref('')
const libsOpen = ref(false)
const prefs = ref(readPrefs(getItem('local', PREFS_KEY)))
/** The drag preview {kind, x, y} (px in the panel, which positions it), null without a drag. */
const ghost = ref(null)

/** Beyond the tool bar as it is drawn (its option arrows included), and no wider than the board leaves. */
const placeStyle = computed(() => (typeof props.start === 'number' && Number.isFinite(props.start)
	? { insetInlineStart: props.start + 'px', width: `min(272px, calc(100% - ${props.start + 8}px))` }
	: null))
/** (job 203) route 46: the right and the adopted and own libraries ({id, name, names, pending}) */
const libs = ref({ right: null, adopted: [], own: [] })
/** (job 203) loaded pictures: library id → its entries (shapeLibCache.js) */
const loaded = ref(new Map())
/** (job 203) the open dialog {mode, draft?, lib?}, null without one */
const dialog = ref(null)
/** (job 217) the dialog of an own library, a lazy part */
const ShapeLibDialog = partComponent('shapeLibDialog')
/** (job 203) a status line of the panel */
const note = ref('')
const reading = ref(false)
const fileEl = ref(null)
const extraLibs = computed(() => [...libs.value.adopted, ...libs.value.own])
const canImport = computed(() => props.account && libs.value.right !== null)
const searching = computed(() => query.value.trim() !== '')
const hits = computed(() => searchEntries(query.value, entryLabel, extraLibs.value))
const recent = computed(() => prefs.value.recent.map((id) => entryOf(id, extraLibs.value)).filter((e) => e !== null))
const shownLibs = computed(() => [
	...SHAPE_LIBS.map((lib) => ({ key: lib.id, caption: libName(lib.id), entries: lib.entries, own: false, pending: false, lib: null })),
	...libs.value.adopted.map((lib) => ({ key: libKey(lib.id), caption: lib.name, entries: ownEntries(lib), own: false, pending: false, lib })),
	...libs.value.own.map((lib) => ({ key: libKey(lib.id), caption: lib.name, entries: ownEntries(lib), own: true, pending: lib.pending === true, lib })),
].filter((sec) => !prefs.value.hidden.includes(sec.key)))
/** (job 203) the check boxes of "Libraries": built-in, adopted, own */
const libChoices = computed(() => [
	...SHAPE_LIBS.map((lib) => ({ key: lib.id, name: libName(lib.id) })),
	...extraLibs.value.map((lib) => ({ key: libKey(lib.id), name: lib.name })),
])
/** (job 203) entry id → its picture {uri, w, h} for the loaded ones */
const pictures = computed(() => {
	const out = new Map()
	for (const [id, list] of loaded.value) {
		list.forEach((pic, i) => {
			if (pic) out.set(`lib:${id}.${i}`, pic)
		})
	}
	return out
})
/**
 * The sections of the list, {key, caption, fold, folded, entries}: the hits of a
 * search (no caption), else "Recently used" and every library shown (foldable).
 */
const sections = computed(() => {
	if (searching.value) {
		return hits.value.length > 0 ? [{ key: 'search', caption: '', fold: false, folded: false, entries: hits.value }] : []
	}
	const out = []
	if (recent.value.length > 0) {
		out.push({ key: 'recent', caption: t('knorke', 'Recently used'), fold: false, folded: false, entries: recent.value })
	}
	for (const sec of shownLibs.value) {
		out.push({ ...sec, fold: true, folded: isFolded(sec.key) })
	}
	return out
})

/** (job 203) the libraries whose pictures are shown now: open sections, hits, recently used */
const wanted = computed(() => {
	const ids = new Set()
	for (const sec of sections.value) {
		if (sec.folded) continue
		for (const e of sec.entries) {
			if (e.kind === 'image') ids.add(String(e.lib))
		}
	}
	return [...ids]
})

/**
 * (Job 203) Loads the pictures of a library once.
 *
 * @param {number|string} id library id
 * @return {Promise<Array<object|null>>} its pictures
 */
async function load(id) {
	const key = String(id)
	if (loaded.value.has(key)) return loaded.value.get(key)
	const list = await libEntries(id)
	if (list.length > 0) loaded.value = new Map(loaded.value).set(key, list)
	return list
}

watch(wanted, (ids) => {
	for (const id of ids) load(id)
}, { immediate: true })

/** (Job 203) Route 46 again (after a change), then the choices without libraries that are gone. */
async function refresh() {
	if (!props.account) return
	try {
		const res = await libsApi.listShapeLibs()
		libs.value = res
		const next = prunePrefs(prefs.value, [...res.adopted, ...res.own])
		if (next !== prefs.value) save(next)
	} catch (e) {
		console.warn('[knorke] shape libraries not loaded', e)
	}
}

/**
 * (Job 203) The picture of an own or adopted entry, loading its library when needed.
 *
 * @param {{id: string, lib: number, index: number}} e entry
 * @return {Promise<{uri: string, w: number, h: number}|null>}
 */
async function pictureFor(e) {
	const list = await load(e.lib)
	return list[e.index] ?? null
}

/** (Job 203) "Import shapes…": the file picker. */
function pickFiles() {
	note.value = ''
	fileEl.value?.click?.()
}

/** Files above this size are skipped unread. */
const FILE_MAX = 20 * 1024 * 1024

/**
 * (Job 217) Opens the dialog of an own library once its lazy part is loaded.
 *
 * @param {{mode: string, draft?: object, lib?: object}} d the dialog
 */
async function openDialog(d) {
	if (await loadPart('shapeLibDialog')) {
		dialog.value = d
	}
}

/**
 * (Job 203) The picked files: read, turned into a draft, shown in the import dialog.
 *
 * @param {Event} ev change of the file input
 */
async function onFiles(ev) {
	const input = ev.target
	const files = [...(input?.files ?? [])]
	if (input) input.value = ''
	if (files.length === 0) return
	reading.value = true
	try {
		const read = []
		let big = 0
		for (const f of files) {
			if (f.size > FILE_MAX) big++
			else read.push({ name: f.name, text: await f.text() })
		}
		// job 217: the import comes on first use
		const lib = await loadPart('shapelib')
		if (!lib) return
		const draft = await lib.importShapes(read, t('knorke', 'My shapes'))
		await openDialog({ mode: 'import', draft: { ...draft, skipped: draft.skipped + big } })
	} catch (e) {
		console.warn('[knorke] shapes not imported', e)
		note.value = t('knorke', 'The files could not be read.')
	} finally {
		reading.value = false
	}
}

/**
 * (Job 203) An admin's "Make available to everyone": a copy is adopted at once.
 *
 * @param {{id: number}} lib own library
 */
async function publish(lib) {
	note.value = ''
	try {
		await libsApi.suggestShapeLib(lib.id)
		note.value = t('knorke', 'Everyone can use the library now.')
	} catch (e) {
		console.warn('[knorke] shape library not adopted', e)
		note.value = t('knorke', 'The library could not be saved.')
	}
	await refresh()
}

/**
 * (Job 203) Withdraws the suggestion of an own library.
 *
 * @param {{id: number}} lib own library
 */
async function withdraw(lib) {
	note.value = ''
	try {
		await libsApi.withdrawShapeLib(lib.id)
		note.value = t('knorke', 'Suggestion withdrawn.')
	} catch (e) {
		console.warn('[knorke] suggestion not withdrawn', e)
		note.value = t('knorke', 'The library could not be saved.')
	}
	await refresh()
}

/** (Job 203) A dialog succeeded: its effect, then the list again. */
async function onDialogDone() {
	const d = dialog.value
	dialog.value = null
	if (d?.mode === 'delete') {
		forgetLib(d.lib.id)
		const m = new Map(loaded.value)
		m.delete(String(d.lib.id))
		loaded.value = m
	}
	if (d?.mode === 'suggest') note.value = t('knorke', 'The admins were asked.')
	await refresh()
}

/**
 * @param {{hidden: string[], folded: string[], recent: string[]}} next new choices (stored at once)
 */
function save(next) {
	prefs.value = next
	setItem('local', PREFS_KEY, JSON.stringify(next))
}

/**
 * @param {string} lib library id
 * @return {boolean} its section is folded
 */
function isFolded(lib) {
	return prefs.value.folded.includes(lib)
}

/** @param {string} lib library id */
function toggleFold(lib) {
	const folded = prefs.value.folded.filter((x) => x !== lib)
	save({ ...prefs.value, folded: isFolded(lib) ? folded : [...folded, lib] })
}

/**
 * @param {string} lib library id
 * @param {boolean} shown its check box
 */
function setShown(lib, shown) {
	const hidden = prefs.value.hidden.filter((x) => x !== lib)
	save({ ...prefs.value, hidden: shown ? hidden : [...hidden, lib] })
}

/** @param {{id: string}} e the entry just used */
function remember(e) {
	save(usePrefs(prefs.value, e.id))
}

/** The press on a tile: {entry, pid, x0, y0, el, moving}; null without one. */
let press = null
/** When the last drag ended (performance.now()), for the click it leaves behind. */
let dragEnded = -Infinity

/**
 * @param {{id: string, kind: string}} e entry
 * @param {MouseEvent} ev click
 */
function onClick(e, ev) {
	if (performance.now() - dragEnded < AFTER_DRAG_MS) {
		dragEnded = -Infinity
		return
	}
	remember(e)
	const pointer = isPointerActivation(ev)
	if (e.kind === 'image') {
		// job 203: an own shape needs its picture
		pictureFor(e).then((pic) => {
			if (!pic) return
			if (pointer) emit('arm', 'image', pic)
			else emit('place', 'image', null, pic)
		})
		return
	}
	if (pointer) {
		emit('arm', e.kind)
	} else {
		emit('place', e.kind, null)
	}
}

/**
 * @param {{id: string, kind: string}} e entry
 * @param {PointerEvent} ev pointerdown on its tile
 */
function onDown(e, ev) {
	if (ev.button !== 0 || !ev.isPrimary) return
	end()
	press = { entry: e, pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, el: ev.currentTarget, moving: false }
	window.addEventListener('pointermove', onMove, true)
	window.addEventListener('pointerup', onUp, true)
	window.addEventListener('pointercancel', onCancel, true)
	window.addEventListener('keydown', onKey, true)
}

/** @param {PointerEvent} ev pointermove */
function onMove(ev) {
	if (!press || ev.pointerId !== press.pid) return
	if (!press.moving) {
		if (Math.hypot(ev.clientX - press.x0, ev.clientY - press.y0) < DRAG_START_PX) return
		press.moving = true
		try {
			press.el?.setPointerCapture?.(press.pid)
		} catch (err) {
			// the pointer is gone already: its pointercancel ends the drag
		}
	}
	// the preview is absolute in the panel: a client point minus the panel's corner (a fixed one would be
	// placed against whatever ancestor Nextcloud gives it a frame, not the window)
	const r = rootEl.value?.getBoundingClientRect?.() ?? { left: 0, top: 0 }
	// job 203: an own shape shows its picture
	const uri = press.entry.kind === 'image' ? pictures.value.get(press.entry.id)?.uri ?? null : null
	ghost.value = { kind: press.entry.kind, ...(uri ? { uri } : {}), x: ev.clientX - r.left, y: ev.clientY - r.top }
}

/** @param {PointerEvent} ev pointerup */
function onUp(ev) {
	if (!press || ev.pointerId !== press.pid) return
	const p = press
	end()
	if (!p.moving) return
	dragEnded = performance.now()
	let target = null
	try {
		target = document.elementFromPoint(ev.clientX, ev.clientY)
	} catch (err) {
		target = null
	}
	if (isCanvasTarget(target)) {
		remember(p.entry)
		const client = { x: ev.clientX, y: ev.clientY }
		if (p.entry.kind === 'image') pictureFor(p.entry).then((pic) => pic && emit('place', 'image', client, pic))
		else emit('place', p.entry.kind, client)
	}
}

/** @param {PointerEvent} ev pointercancel */
function onCancel(ev) {
	if (press && ev.pointerId === press.pid) {
		if (press.moving) dragEnded = performance.now()
		end()
	}
}

/** @param {KeyboardEvent} ev keydown during a press: Esc ends a drag */
function onKey(ev) {
	if (ev.key === 'Escape' && press?.moving) {
		ev.stopPropagation()
		ev.preventDefault()
		dragEnded = performance.now()
		end()
	}
}

/** Ends the press and the drag, without placing anything. */
function end() {
	if (press?.moving) {
		try {
			press.el?.releasePointerCapture?.(press.pid)
		} catch (err) {
			// released already
		}
	}
	press = null
	ghost.value = null
	window.removeEventListener('pointermove', onMove, true)
	window.removeEventListener('pointerup', onUp, true)
	window.removeEventListener('pointercancel', onCancel, true)
	window.removeEventListener('keydown', onKey, true)
}

onMounted(() => {
	if (props.autofocus) searchEl.value?.focus?.()
	refresh()
})

onBeforeUnmount(end)
</script>
