/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 228 (redesign header, docs/redesign/ P1, P6, P11), run in
 * Node with ./sfc.mjs:
 * - AK1 the top bar: an invisible strip with two islands; left back, title,
 *   the chips "Open by link" (guests too) and "Guest"; right timer,
 *   participants (at most 4), "Comments", "Facilitate" with the word,
 *   "Share" as the one primary button (never guests), "More"; middle width:
 *   "+n" and the chip as an icon; narrow: one island with the subline
 * - AK3 the board view shows one notice (bars.js noticeOf), closes it
 *   through closeNotice, prunes the closed ones
 * - AK5 the comment panel: 296 px, above the zoom controls, "New comment"
 *   secondary
 * - the strip's CSS, the participants' heading "Present ({n})"
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { n, t } from '../../../src/util/l10n.js'
import { useSfc } from './sfc.mjs'

useSfc()
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const TopBar = (await import('../../../src/components/TopBar.vue')).default
const PresenceBar = (await import('../../../src/components/PresenceBar.vue')).default

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
const PEOPLE = Array.from({ length: 6 }, (_, i) => ({ pid: 'p' + i, name: 'Person ' + i, color: '#123456', guest: false, self: i === 0 }))

/** @param {object} C component @param {object} props props @return {Promise<string>} SSR HTML without comments */
async function render(C, props) {
	const app = createSSRApp(C, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

/** @param {string} html @param {string} side left|right @return {string} the island's HTML ('' without) */
function island(html, side) {
	const at = html.indexOf(`data-knorke-island="${side}"`)
	if (at < 0) return ''
	const start = html.lastIndexOf('<div', at)
	let depth = 0
	const re = /<div\b|<\/div>/g
	re.lastIndex = start
	for (let m; (m = re.exec(html));) {
		depth += m[0] === '</div>' ? -1 : 1
		if (depth === 0) return html.slice(start, m.index + 6)
	}
	return ''
}

const hooks = (html) => [...html.matchAll(/data-knorke-(action|menu|guest-chip)(?:="([^"]+)")?/g)].map((m) => m[2] ?? m[1])
const base = { title: 'Retro', participants: PEOPLE, ready: true }
const owner = { ...base, isOwner: true, canModerate: true, canEdit: true }

test('job 228 AK1 wide: the strip holds two islands; left back, title, chip; right participants, comments, Facilitate, Share, More', async () => {
	const html = await render(TopBar, { ...owner, linkBadge: true })
	assert.match(html, /^<header class="knorke-topbar" data-knorke-bar="top" data-knorke-chrome><div class="knorke-island knorke-island--left" data-knorke-island="left">/)
	const left = island(html, 'left')
	const right = island(html, 'right')
	assert.deepEqual(hooks(left), ['back', 'rename-board', 'link-badge'])
	assert.match(left, /Open by link/)
	const r = hooks(right)
	assert.deepEqual(r.filter((h) => !h.startsWith('p') || h === 'participants'), ['participants', 'search', 'comments', 'moderation', 'vote-setup', 'timer-open', 'summon', 'share', 'board', 'keyboard-shortcuts'])
	assert.equal((right.match(/data-knorke-participant="p\d"/g) ?? []).length, 3, 'at most 4 in the bar: the own entry plus 3, the rest behind "+n"')
	assert.match(right, /data-knorke-action="participants"[^>]*>\s*\+2</)
	assert.match(right, /data-stub="NcButton" variant="primary" data-knorke-action="share"/, 'Share is the primary button')
	assert.match(right, /data-knorke-menu="moderation"><div data-stub="NcActions"[^>]*menu-name="Facilitate"/, 'the flag with the word')
	assert.equal((html.match(/variant="primary"/g) ?? []).length, 1, 'the one primary button')
})

test('job 228 AK1 roles: Share only for owners and moderators and never for guests; Facilitate only for moderators; the guest chips', async () => {
	assert.doesNotMatch(await render(TopBar, { ...base }), /data-knorke-action="share"|data-knorke-menu="moderation"/, 'an editor')
	assert.match(await render(TopBar, { ...base, mod: true, canModerate: true }), /data-knorke-action="share"/)
	const guest = await render(TopBar, { ...base, isGuest: true, canGoBack: false, mod: true })
	assert.doesNotMatch(guest, /data-knorke-action="share"/, 'never on the guest page')
	const left = island(guest, 'left')
	assert.deepEqual(hooks(left), ['link-badge', 'guest-chip'], 'guests: the chip "Open by link" (always) and "Guest"')
	assert.match(left, /data-knorke-guest-chip>[\s\S]*Guest/)
	assert.doesNotMatch(await render(TopBar, { ...base }), /data-knorke-action="link-badge"/, 'an account without linkBadge')
	const narrowGuest = await render(TopBar, { ...base, isGuest: true, canGoBack: false, mod: true, narrow: true })
	assert.doesNotMatch(narrowGuest, /data-knorke-action="share"/, 'nor in the overflow menu')
})

test('job 228 AK1 middle width: the participants only as "+n", the chip only its icon with a name', async () => {
	const html = await render(TopBar, { ...owner, linkBadge: true, mid: true })
	const right = island(html, 'right')
	assert.ok(right, 'still two islands')
	assert.doesNotMatch(right, /data-knorke-participant=|knorke-presence__item--self/, 'no avatar in the bar')
	assert.match(right, /data-knorke-action="participants"[^>]*>\s*\+6</)
	assert.match(island(html, 'left'), /class="[^"]*knorke-topbar__linkbadge--icon[^"]*"[^>]*aria-label="Open by link"/)
	assert.doesNotMatch(island(html, 'left'), /knorke-topbar__linkbadge-text/)
})

test('job 228 AK1 narrow: one island with everything; title and subline are one target (round 3): the badge, for the owner the rename button beside the link icon', async () => {
	const guest = await render(TopBar, { ...base, isGuest: true, canGoBack: false, narrow: true })
	assert.equal(island(guest, 'right'), '', 'no right island')
	const left = island(guest, 'left')
	assert.match(left, /<div class="knorke-topbar__head"><button type="button" class="knorke-topbar__headbadge"[^>]*data-knorke-action="link-badge"[^>]*><span class="knorke-topbar__title-text">Retro<\/span><span class="knorke-topbar__subline">Guest · Open by link<\/span><\/button><\/div>/)
	assert.deepEqual(hooks(left).filter((h) => !/^p\d$/.test(h)), ['link-badge', 'participants', 'search', 'comments', 'overflow'])
	assert.doesNotMatch(left, /data-knorke-guest-chip/, 'the subline says it')
	const acc = island(await render(TopBar, { ...base, linkBadge: true, narrow: true }), 'left')
	assert.match(acc, /class="knorke-topbar__headbadge"[^>]*data-knorke-action="link-badge"[^>]*><span class="knorke-topbar__title-text">Retro<\/span><span class="knorke-topbar__subline">Open by link</, 'an account that does not own the board')
	const own = island(await render(TopBar, { ...owner, linkBadge: true, narrow: true }), 'left')
	assert.match(own, /data-knorke-action="rename-board"[^>]*><span class="knorke-topbar__title-text">Retro<\/span><span class="knorke-topbar__subline">Open by link<\/span><\/button><\/h2><\/div><button type="button" class="knorke-topbar__linkbadge knorke-topbar__linkbadge--icon"[^>]*aria-label="Open by link"[^>]*data-knorke-action="link-badge"/, 'owner: the rename button holds title and subline, the link icon is the badge')
	assert.deepEqual(hooks(own).filter((h) => !/^p\d$/.test(h)).slice(0, 3), ['back', 'rename-board', 'link-badge'])
	assert.doesNotMatch(island(await render(TopBar, { ...owner, narrow: true }), 'left'), /knorke-topbar__subline|data-knorke-action="link-badge"/, 'no subline and no badge without a link')
	assert.doesNotMatch(island(await render(TopBar, { ...base, narrow: true }), 'left'), /knorke-topbar__headbadge/, 'a plain title without a link')
})

test('job 228 round 3: narrow, the title target fills the island (36 px, 44 px with pen or finger); while renaming there is no subline', () => {
	const rule = css.match(/\nbutton\.knorke-topbar__headbadge,\n\.knorke-topbar--narrow \.knorke-topbar__title > button\.knorke-topbar__rename-trigger \{([^}]*)\}/)?.[1] ?? ''
	assert.match(rule, /min-height: var\(--knorke-btn\) !important;/)
	assert.match(rule, /flex-direction: column;/)
	assert.match(css, /button\.knorke-topbar__headbadge \{[^}]*width: 100%;[^}]*background: transparent !important;/)
	assert.match(css, /button\.knorke-topbar__headbadge:focus-visible \{[^}]*box-shadow: var\(--k-focus-ring\) !important;/)
	const src = read('src/components/TopBar.vue')
	assert.match(src, /<form v-if="editing"/, 'the field replaces the title block, subline included')
	assert.match(src, /<span v-if="narrow && linkChip" class="knorke-topbar__subline">\{\{ subline \}\}<\/span>\s*<\/button>\s*<\/h2>/, 'the owner\'s subline lives inside the rename button')
})

test('job 228: the participants\' list starts with "Present ({n})"; at most 4 in the bar', () => {
	const src = read('src/components/PresenceBar.vue')
	assert.match(src, /const MAX_SHOWN = 4/)
	assert.match(src, /class="knorke-popover knorke-presence__popover">\s*<h3 class="knorke-presence__heading">\s*\{\{ t\('knorke', 'Present \(\{n\}\)', \{ n: participants\.length \}\) \}\}/)
	assert.equal(JSON.parse(read('l10n/de.json')).translations['Present ({n})'], 'Anwesend ({n})')
})

test('job 228 AK1 CSS: the strip lets pointers through and has no surface; the islands have; the left one shrinks, the right one never', () => {
	const rule = (sel) => css.match(new RegExp('(?:^|\\})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'))?.[1] ?? ''
	const strip = rule('.knorke-topbar')
	assert.match(strip, /position: absolute;/)
	assert.match(strip, /pointer-events: none;/)
	assert.doesNotMatch(strip, /background|box-shadow|padding/)
	const isl = rule('.knorke-island')
	assert.match(isl, /pointer-events: auto;/)
	assert.match(isl, /background: var\(--knorke-surface\);/)
	assert.match(rule('.knorke-island--left'), /flex: 0 1 auto;\s*min-width: 0;/)
	assert.match(rule('.knorke-island--right'), /flex: 0 0 auto;\s*margin-inline-start: auto;/)
	assert.match(rule('.knorke-topbar--narrow .knorke-island--left'), /flex: 1 1 auto;/)
	assert.match(rule('button.knorke-topbar__linkbadge'), /color: var\(--k-info-text\) !important;[\s\S]*background: var\(--k-info-bg\) !important;/, 'the chip is an info pair')
	assert.doesNotMatch(css, /knorke-topbar__spacer/)
})

test('job 228 AK3 board view: one notice by noticeOf; each banner shows only as that notice; closing goes through closeNotice; closed ones are pruned', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /const notice = computed\(\(\) => noticeOf\(noticeWants\.value, dismissedNotices\.value\)\?\.kind \?\? null\)/)
	assert.match(view, /watch\(noticeWants, \(o\) => \{\s+const kept = pruneDismissed\(dismissedNotices\.value, o\)/)
	assert.match(view, /:show-status="notice === 'status'"\s+:show-role="notice === 'role'"\s+@close="closeNotice"/)
	for (const [tag, kind] of [['FollowBanner', 'follow'], ['FollowChip', 'chip'], ['TagFilterChip', 'tags']]) {
		assert.match(view, new RegExp(`<${tag} v-if="notice === '${kind}'"`), tag)
	}
	assert.match(view, /<div v-if="notice === 'time_up'"/)
	assert.match(view, /<div v-if="notice === 'comment'"/)
	assert.match(view, /@clear="closeNotice"/, 'the tag filter\'s × clears through closeNotice')
	const close = view.match(/function closeNotice\(\) \{[\s\S]*?\n\}/)[0]
	assert.match(close, /n\?\.kind === 'time_up'\) \{\s+dismissTimeUp\(\)/)
	assert.match(close, /n\?\.kind === 'tags'\) \{\s+session\.value\?\.setTagFilter\(\[\]\)/)
	assert.match(close, /n\?\.kind === 'comment'\) \{\s+cancelCommentPick\(\)/)
	assert.match(close, /dismissedNotices\.value = new Set\(\[\.\.\.dismissedNotices\.value, n\.key\]\)/)
	assert.match(close, /focusCanvasHost\(\)\s*\}$/, 'the focus goes to the canvas')
	assert.match(view, /follow: followState\.value\.following \? followState\.value\.following\.pid : null,/)
	assert.match(view, /tags: ready\.value && tagView\.value\.filter\.length !== 0,/)
})

test('job 228 board view: the middle width is live; the badge opens the card of this viewer (guests: the guest card)', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /midQuery = [^\n]*window\.matchMedia\(MID_QUERY\)/)
	assert.match(view, /midQuery\?\.addEventListener\?\.\('change', onMid\)/)
	assert.match(view, /midQuery\?\.removeEventListener\?\.\('change', onMid\)/)
	assert.match(view, /:narrow="narrow"\s+:mid="mid"/)
	assert.match(view, /const badgeKind = computed\(\(\) => \(props\.mode === 'guest' \? 'guest' : 'account'\)\)/)
	assert.match(view, /if \(privacyCard\.value\?\.kind === badgeKind\.value\) \{\s+closePrivacy\(\)\s+return\s+\}\s+privacyCard\.value = \{ kind: badgeKind\.value, viaBadge: true \}/)
	assert.match(view, /:link-info-open="privacyCard !== null && privacyCard\.kind === badgeKind"/)
})

test('job 228 AK5 comment panel: 296 px on the right, under the right island and above the zoom controls; "New comment" secondary', () => {
	assert.match(css, /--k-panel-w: 296px;/)
	const panel = css.match(/\n\.knorke-comments \{([^}]*)\}/)[1]
	assert.match(panel, /top: calc\(var\(--knorke-gap\) \* 2 \+ var\(--knorke-bar-h\)\);/)
	assert.match(panel, /bottom: calc\(var\(--knorke-gap\) \* 2 \+ var\(--knorke-bar-h\)\);/, 'the zoom controls (one gap from the bottom, one bar high) stay free')
	assert.match(panel, /inset-inline-end: var\(--knorke-gap\);/)
	assert.match(panel, /width: min\(var\(--k-panel-w\), calc\(100% - 2 \* var\(--knorke-gap\)\)\);/)
	assert.match(css, /\n\.knorke-zoom \{\s*bottom: var\(--knorke-gap\);\s*inset-inline-end: var\(--knorke-gap\);/, 'precondition: where the zoom controls stand')
	assert.match(read('src/components/CommentsPanel.vue'), /<NcButton v-if="canWrite"\s+variant="secondary"\s+data-knorke-action="comment-new"/)
	assert.match(css, /\.knorke-comments__tabs \{[^}]*background: var\(--k-hover\);[^}]*border-radius: var\(--k-radius-pill\);/, 'a segment')
	assert.match(css, /button\.knorke-comments__tab--active \{[^}]*background: var\(--knorke-surface\) !important;/)
	// round 1: during a vote the zoom controls stand on the vote bar; the panel ends above both
	assert.match(css, /\.knorke-board--votebar \.knorke-zoom,\s*\.knorke-board--votebar \.knorke-undo \{\s*bottom: calc\(var\(--knorke-gap\) \+ var\(--knorke-votebar-h\)\);/, 'precondition: the zoom controls (job 229: and the undo island) during a vote')
	assert.match(css, /\.knorke-board--votebar \.knorke-comments:not\(\.knorke-comments--sheet\) \{\s*bottom: calc\(var\(--knorke-gap\) \* 2 \+ var\(--knorke-bar-h\) \+ var\(--knorke-votebar-h\)\);/)
})

test('job 228 round 1: the buttons of a notice (its ×) are as large as a bar\'s: 36 px, 44 px with pen or finger', () => {
	const banner = css.match(/\n\.knorke-banner \{([^}]*)\}/)[1]
	assert.match(banner, /--default-clickable-area: var\(--knorke-btn\);/)
	assert.match(banner, /min-height: var\(--knorke-bar-h\);/, 'the notice is high enough for it')
	assert.match(read('src/styles/knorke.css'), /@media \(pointer: coarse\) \{\s*:root \{\s*--knorke-bar-h: var\(--k-bar-h-touch\);\s*--knorke-btn: var\(--k-btn-touch\);/, '44 px with pen or finger')
})

test('job 228 PresenceBar renders the heading in its popover only when open (SSR closed: no list)', async () => {
	const html = await render(PresenceBar, { participants: PEOPLE })
	assert.match(html, /data-knorke-action="participants"[^>]*>\s*\+2</)
	assert.doesNotMatch(html, /knorke-presence__heading/, 'closed')
})

test('job 228 round 2: while the participants\' list is open the strip lies over the notices (top stack), the privacy card and the side panels', () => {
	const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const z = (sel) => Number(css.match(new RegExp('\\n' + esc(sel) + ' \\{[^}]*z-index: (\\d+);'))?.[1])
	const open = z('.knorke-topbar:has(.knorke-presence__popover)')
	assert.ok(open > z('.knorke-topstack'), 'over the notices and the privacy card')
	assert.ok(open > z('.knorke-comments') && open > z('.knorke-votepanel') && open > z('.knorke-thread'), 'over the side panels')
	assert.equal(z('.knorke-topbar'), 30, 'closed: as before')
	assert.match(read('src/components/PresenceBar.vue'), /class="knorke-popover knorke-presence__popover"/, 'the list carries the class the rule looks for')
})

test('job 271 AK6: the magnifier for everyone (owner, editor, guest, view-only), wide and narrow, with its shortcut; pressed while the search is open', async () => {
	for (const props of [{ ...owner }, { ...base }, { ...base, isGuest: true, canGoBack: false }, { ...base, canEdit: false, edit: false }]) {
		for (const narrow of [false, true]) {
			const html = await render(TopBar, { ...props, narrow })
			assert.equal((html.match(/data-knorke-action="search"/g) ?? []).length, 1, JSON.stringify({ ...props, narrow, participants: undefined }))
		}
	}
	const html = await render(TopBar, { ...base, searchOpen: true })
	assert.match(html, /aria-label="Search on the board \(Ctrl\+F\)"[^>]*aria-keyshortcuts="Control\+F"[^>]*aria-pressed="true"[^>]*data-knorke-action="search"/)
	assert.match(await render(TopBar, { ...base, apple: true }), /aria-label="Search on the board \(⌘F\)"[^>]*aria-keyshortcuts="Meta\+F"[^>]*aria-pressed="false"/)
	assert.doesNotMatch(await render(TopBar, { ...base, ready: false }), /data-knorke-action="search"/, 'not before the board is ready')
})

test('job 274 AK4: "Board | Outline" for everyone (owner, editor, guest, view-only) once ready; wide two buttons, narrow one list button; aria-pressed follows the view', async () => {
	for (const props of [{ ...owner }, { ...base }, { ...base, isGuest: true, canGoBack: false }, { ...base, canEdit: false, edit: false }]) {
		const wide = await render(TopBar, { ...props, narrow: false })
		assert.equal((wide.match(/data-knorke-view-switch/g) ?? []).length, 1, 'wide: the group')
		assert.equal((wide.match(/data-knorke-view="(board|outline)"/g) ?? []).length, 2, 'wide: two buttons')
		const narrow = await render(TopBar, { ...props, narrow: true })
		assert.equal((narrow.match(/data-knorke-view-switch/g) ?? []).length, 0, 'narrow: no group')
		assert.equal((narrow.match(/data-knorke-view="outline"/g) ?? []).length, 1, 'narrow: the list button')
	}
	const board = await render(TopBar, { ...base })
	assert.match(board, /aria-pressed="true"[^>]*data-knorke-view="board"/)
	assert.match(board, /aria-pressed="false"[^>]*data-knorke-view="outline"/)
	const outline = await render(TopBar, { ...base, view: 'outline' })
	assert.match(outline, /aria-pressed="false"[^>]*data-knorke-view="board"/)
	assert.match(outline, /aria-pressed="true"[^>]*data-knorke-view="outline"/)
	assert.match(await render(TopBar, { ...base, narrow: true, view: 'outline' }), /aria-label="Outline"[^>]*aria-pressed="true"[^>]*data-knorke-view="outline"/)
	assert.match(await render(TopBar, { ...base, mid: true }), /aria-label="Outline"[^>]*title="Outline"[^>]*aria-pressed="false"[^>]*data-knorke-view="outline"/, 'mid: icons named by aria-label')
	const right = island(board, 'right')
	assert.ok(right.indexOf('data-knorke-view-switch') < right.indexOf('data-knorke-action="search"'), 'before the magnifier')
	assert.doesNotMatch(await render(TopBar, { ...base, ready: false }), /data-knorke-view/, 'not before the board is ready')
})

test('job 274 round 1: the outline starts below the top bar and its notices (prop top), each point with its own bullet at its first line', async () => {
	const OutlineView = (await import('../../../src/components/OutlineView.vue')).default
	const items = [{ id: 'a', t: 'sticky', parent: null, data: { text: 'eins\nzwei' } }]
	const model = { ids: () => ['a'], get: (id) => items.find((x) => x.id === id), has: () => true, abs: () => ({ x: 0, y: 0, w: 10, h: 10, r: 0 }), sortByOrder: (x) => x }
	const html = await render(OutlineView, { source: () => ({ model, frames: [] }), top: 150, title: 'B' })
	assert.match(html, /style="padding-top:calc\(150px \+ var\(--knorke-gap\)\);?"/)
	assert.doesNotMatch(await render(OutlineView, { source: () => null, title: 'B' }), /padding-top/, 'without a measure: the CSS default')
	assert.match(html, /<ul class="knorke-outline__list" role="list">/)
	const rule = css.match(/button\.knorke-outline__item::before \{[^}]*\}/)?.[0] ?? ''
	assert.match(rule, /content: "\\2022"/, 'the bullet is the button\'s own')
	assert.match(css, /\.knorke-outline__list \{[^}]*list-style: none;/)
})
