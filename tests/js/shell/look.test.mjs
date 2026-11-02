/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 226 (redesign foundation, docs/redesign/ tokens.css part 1):
 * the three levels (bars, panels and menus, dialogs) with their radius and
 * one shadow and no visible edge, the 4 px grid, the focus ring in the text
 * colour, notices as light status pairs, the icon set (job 244: Phosphor
 * Regular and a few own drawings; before, MDI outline), the icons of the tool
 * options, the switched-on buttons (job 244) and the dark mark (variant b).
 * The browser side is E92 (dev/e2e/scenarios/look.mjs).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { bannerFor } from '../../../src/components/banner.js'
import { ICON_SOURCE, OPTION_ICONS, icons } from '../../../src/components/icons.js'
import { PHOSPHOR, PHOSPHOR_SCALE } from '../../../src/model/phosphor.js'
import { ENUMS } from '../../../src/model/registry.js'
import { BASIC_KINDS } from '../../../src/model/shapes.js'
import { parseSvgPath, scalePath } from '../../../src/model/svgPath.js'
import { FRAME_TOOL_KINDS, NOTE_TOOL_TYPES } from '../../../src/model/tools.js'
import { FINAL_STATUSES } from '../../../src/sync/SyncClient.js'
import { DARK_ATTR, applyDarkMark, darkMark, isDarkTheme } from '../../../src/util/darkMode.js'

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
const raw = read('src/styles/knorke.css')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

/** Flat rule list (nested @media bodies included), selector whitespace normalised. */
function rules(src = css) {
	const out = []
	const re = /([^{}]+)\{([^{}]*)\}/g
	let m
	while ((m = re.exec(src)) !== null) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
	return out
}

const parts = (selector) => selector.split(',').map((x) => x.trim())
const declOf = (body, prop) => body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`))?.[1].replace(/\s*!important$/, '').trim()

// job 228: the two islands of the top bar instead of the full-width bar; job 229: the undo island instead of the
// round "?" button, the tool bar's popovers on the panel level
const BARS = ['.knorke-island', '.knorke-toolbar', '.knorke-contextbar', '.knorke-zoom', '.knorke-undo', '.knorke-sessionbar', '.knorke-votestepper', '.knorke-banner', '.knorke-touchtip']
const PANELS = ['.knorke-contextbar__panel', '.knorke-privacy-info', '.knorke-popover', '.knorke-votepanel', '.knorke-reactpicker', '.knorke-reactnames', '.knorke-contextmenu', '.knorke-comments', '.knorke-thread', '.knorke-commentfield__mentions', '.knorke-tags', '.knorke-shapes', '.knorke-toolpop', '.knorke-menus .v-popper__inner', '.knorke-board .v-popper__inner']
const DIALOGS = ['.knorke-dialog .modal-container']
const LEVELS = [
	{ name: 'bar', surfaces: BARS, radius: 'var(--k-radius-bar)', shadow: 'var(--k-shadow-bar)' },
	{ name: 'panel', surfaces: PANELS, radius: 'var(--k-radius-panel)', shadow: 'var(--k-shadow-panel)' },
	{ name: 'dialog', surfaces: DIALOGS, radius: 'var(--k-radius-dialog)', shadow: 'var(--k-shadow-dialog)' },
]

/** The custom properties of every unconditional :root rule (first wins). */
function tokens() {
	const out = new Map()
	for (const r of rules().filter((x) => x.selector === ':root')) {
		for (const m of r.body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) if (!out.has(m[1])) out.set(m[1], m[2].trim())
	}
	return out
}

test('job 226 AK1: the tokens of tokens.css part 1 under their names', () => {
	const t = tokens()
	const want = {
		'--k-radius-bar': '12px',
		'--k-radius-panel': '12px',
		'--k-radius-dialog': '16px',
		'--k-radius-control': 'var(--border-radius-element, 8px)',
		'--k-radius-pill': '999px',
		'--k-btn': '36px',
		'--k-btn-touch': '44px',
		'--k-bar-pad': '4px',
		'--k-bar-h': 'calc(var(--k-btn) + 2 * var(--k-bar-pad))',
		'--k-bar-h-touch': 'calc(var(--k-btn-touch) + 2 * var(--k-bar-pad))',
		'--k-shadow-bar': '0 1px 2px rgba(var(--k-shadow-color), 0.08), 0 2px 6px rgba(var(--k-shadow-color), 0.06)',
		'--k-shadow-panel': '0 2px 4px rgba(var(--k-shadow-color), 0.08), 0 8px 24px rgba(var(--k-shadow-color), 0.12)',
		'--k-shadow-dialog': '0 8px 16px rgba(var(--k-shadow-color), 0.12), 0 24px 56px rgba(var(--k-shadow-color), 0.22)',
		'--k-focus-ring': '0 0 0 2px var(--k-surface), 0 0 0 4px var(--k-text)',
		'--k-info-bg': 'var(--k-accent-light)',
		'--k-info-text': 'var(--k-accent-light-text)',
		'--k-warning-bg': 'var(--color-warning, #ffeec5)',
		'--k-error-bg': 'var(--color-error, #ffe7e7)',
	}
	for (const [k, v] of Object.entries(want)) assert.equal(t.get(k), v, k)
	// pen or finger: 52 px bars, 44 px buttons
	assert.match(css, /@media \(pointer: coarse\) \{\s*:root \{\s*--knorke-bar-h: var\(--k-bar-h-touch\);\s*--knorke-btn: var\(--k-btn-touch\);\s*\}/)
	assert.equal(t.get('--knorke-bar-h'), 'var(--k-bar-h)')
	assert.equal(t.get('--knorke-votebar-h'), 'var(--knorke-bar-h)')
	// Nextcloud's variables are never redefined on :root
	for (const r of rules().filter((x) => x.selector === ':root')) assert.doesNotMatch(r.body, /--(color|default|border-radius)-[a-z-]*:/, 'no Nextcloud variable on :root')
})

test('job 226 AK1: each surface has the radius and the one shadow of its level, no border, a transparent outline', () => {
	for (const level of LEVELS) {
		const rule = rules().find((r) => level.surfaces.every((s) => parts(r.selector).includes(s)) && /border-radius/.test(r.body))
		assert.ok(rule, `one rule for the ${level.name} level`)
		assert.deepEqual(parts(rule.selector).sort(), [...level.surfaces].sort(), `${level.name}: exactly these surfaces`)
		assert.equal(declOf(rule.body, 'border-radius'), level.radius)
		assert.equal(declOf(rule.body, 'box-shadow'), level.shadow)
		assert.equal(declOf(rule.body, 'border'), '0')
		assert.equal(declOf(rule.body, 'outline'), '1px solid transparent')
		assert.equal(declOf(rule.body, 'outline-offset'), '-1px')
		// no other rule gives the same surface a border, a shadow or another radius (the docked session bar, job 233, keeps only its top corners round)
		for (const s of level.surfaces) {
			for (const r of rules().filter((x) => (x.selector !== rule.selector || x.body !== rule.body) && parts(x.selector).includes(s))) {
				assert.ok(!/(^|[;\s])(border|border-width|box-shadow):/.test(r.body), `${s}: no other border or shadow (${r.selector})`)
				const radius = declOf(r.body, 'border-radius')
				if (radius !== undefined) {
					assert.equal(s, '.knorke-sessionbar', `${s}: no other radius (${r.selector})`)
					assert.equal(radius, 'var(--k-radius-bar) var(--k-radius-bar) 0 0')
				}
			}
		}
	}
})

test('job 226 AK1: contrast themes draw the edge of every surface (CanvasText)', () => {
	const all = LEVELS.flatMap((l) => l.surfaces)
	const forced = raw.replace(/\/\*[\s\S]*?\*\//g, '').match(/@media \(forced-colors: active\) \{([^{}]*\{[^{}]*\})+\s*\}/g) ?? []
	const rule = forced.flatMap((b) => rules(b.replace(/^@media[^{]*\{/, ''))).find((r) => /outline-color:\s*CanvasText/.test(r.body))
	assert.ok(rule, 'a forced-colors rule with outline-color: CanvasText')
	assert.deepEqual(parts(rule.selector).sort(), [...all].sort())
})

test('job 226 AK1: bars are 44 px (52 px coarse) through min-height and --default-clickable-area', () => {
	const bars = rules().find((r) => parts(r.selector).includes('.knorke-island') && /min-height/.test(r.body))
	assert.deepEqual(parts(bars.selector).sort(), ['.knorke-contextbar', '.knorke-island', '.knorke-sessionbar', '.knorke-undo', '.knorke-zoom'])
	assert.equal(declOf(bars.body, 'min-height'), 'var(--knorke-bar-h)')
	assert.equal(declOf(bars.body, 'box-sizing'), 'border-box')
	assert.equal(declOf(bars.body, '--default-clickable-area'), 'var(--knorke-btn)')
	const tools = rules().find((r) => r.selector === '.knorke-toolbar')
	assert.equal(declOf(tools.body, 'min-width'), 'var(--knorke-bar-h)')
	assert.equal(declOf(tools.body, '--default-clickable-area'), 'var(--knorke-btn)')
	const base = rules().find((r) => r.selector === '.knorke-toolbar, .knorke-contextbar, .knorke-zoom, .knorke-undo')
	assert.equal(declOf(base.body, 'padding'), 'var(--k-bar-pad)')
	const island = rules().find((r) => r.selector === '.knorke-island')
	assert.equal(declOf(island.body, 'padding'), 'var(--k-bar-pad)', 'job 228: the islands')
})

/** Overlays that copy text of the canvas (editor, cursors, name tags) keep their own spacing. */
const GRID_EXEMPT = { from: '/* ---- scene overlays', to: '/* ---- toasts' }

test('job 226 AK2: every gap, padding and margin in px is a multiple of 4 (scene overlays exempt)', () => {
	const lines = raw.split('\n')
	const a = lines.findIndex((l) => l.startsWith(GRID_EXEMPT.from))
	const b = lines.findIndex((l) => l.startsWith(GRID_EXEMPT.to))
	assert.ok(a > 0 && b > a, 'the overlay section is found')
	const bad = []
	let seen = 0
	lines.forEach((l, i) => {
		if (i >= a && i < b) return
		const m = l.match(/^\s*(gap|row-gap|column-gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?):\s*([^;]+);/)
		if (!m) return
		seen++
		const plain = m[2].replace(/!important/, '').replace(/(calc|var|max|min)\([^)]*\)/g, '')
		for (const v of plain.match(/-?[\d.]+px/g) ?? []) if (Math.abs(parseFloat(v)) % 4 !== 0) bad.push(`${i + 1}: ${l.trim()}`)
	})
	assert.ok(seen > 300, `${seen} spacing declarations checked`)
	assert.deepEqual(bad, [])
})

test('job 226 AK3: every focus ring of the chrome is the text-colour ring plus a transparent outline; never the primary colour', () => {
	const focusRules = rules().filter((r) => r.selector.includes(':focus-visible') && !r.selector.includes('.knorke-canvas'))
	assert.ok(focusRules.length >= 30, `${focusRules.length} focus rules`)
	for (const r of focusRules) {
		assert.doesNotMatch(r.body, /outline(-color)?:[^;]*(--knorke-primary|--color-primary-element|currentColor)/, `${r.selector}: no primary or currentColor outline`)
		assert.doesNotMatch(r.body, /box-shadow:[^;]*(--knorke-primary|--color-primary-element)/, `${r.selector}: no primary shadow`)
		if (/(^|[;\s])(outline|box-shadow):/.test(r.body)) {
			assert.equal(declOf(r.body, 'box-shadow'), 'var(--k-focus-ring)', r.selector)
			assert.equal(declOf(r.body, 'outline'), '2px solid transparent', r.selector)
		}
	}
	// a focus rule that only shares the hover background: each of its selectors gets the ring elsewhere
	const ringed = new Set(focusRules.filter((r) => declOf(r.body, 'box-shadow') === 'var(--k-focus-ring)').flatMap((r) => parts(r.selector)))
	for (const r of focusRules) {
		for (const s of parts(r.selector).filter((x) => x.includes(':focus-visible'))) assert.ok(ringed.has(s), `${s} has the ring`)
	}
	// the canvas keeps its own focus (inside the light canvas)
	assert.match(css, /\.knorke-canvas:focus-visible \{\s*outline: 2px solid var\(--knorke-primary\);/)
})

test('job 226 AK4: notices are light status pairs with dark text (info for the neutral ones), never white on grey or primary', () => {
	const notice = (s) => parts(s).some((p) => /^\.knorke-banner|^\.knorke-touchtip\b|^button\.knorke-followchip|^button\.knorke-banner__dismiss/.test(p) && !/__ok/.test(p))
	const own = rules().filter((r) => notice(r.selector))
	assert.ok(own.length >= 6)
	for (const r of own) {
		assert.doesNotMatch(r.body, /(^|[;\s])color:\s*(#fff\b|#ffffff|var\(--knorke-primary-text\))/i, r.selector)
		assert.doesNotMatch(r.body, /background(-color)?:\s*(#4a5560|var\(--knorke-primary\)|var\(--knorke-text-muted\))/, r.selector)
	}
	const base = rules().find((r) => r.selector === '.knorke-banner')
	assert.equal(declOf(base.body, 'color'), 'var(--k-info-text)')
	assert.equal(declOf(base.body, 'background'), 'var(--k-info-bg)')
	const tip = rules().find((r) => r.selector === '.knorke-touchtip')
	assert.equal(declOf(tip.body, 'color'), 'var(--k-info-text)')
	assert.equal(declOf(tip.body, 'background'), 'var(--k-info-bg)')
	// every kind the board can show: the base (info) or a warning/error pair of its own
	const kinds = ['offline', ...FINAL_STATUSES].map((s) => bannerFor(s).kind).concat(['view_role', 'vote_ready', 'device_vote', 'viewonly', 'role', 'following', 'chip', 'time_up', 'comment', 'tags'])
	for (const k of kinds) {
		const mine = rules().filter((r) => parts(r.selector).includes('.knorke-banner--' + k) && /background/.test(r.body))
		for (const r of mine) assert.match(r.body, /background:\s*var\(--knorke-(warning|error)\)/, '.knorke-banner--' + k)
	}
})

/** Job 244: the Phosphor icon of each key (design round 2, runde2.md); the other keys are own drawings. */
const PHOSPHOR_OF = {
	plus: 'plus', tag: 'tag', comment: 'chat', cluster: 'squares-four', table: 'table', mindmap: 'tree-structure', mmTree: 'tree-view',
	minus: 'minus', pencil: 'pencil-simple', pen: 'pencil-simple', trash: 'trash', share: 'share-network', back: 'arrow-left',
	select: 'cursor', hand: 'hand', sticky: 'note', frame: 'frame-corners', undo: 'arrow-u-up-left',
	redo: 'arrow-u-up-right', fit: 'corners-out', front: 'selection-foreground', back2: 'selection-background',
	copy: 'copy', refresh: 'arrow-clockwise', link: 'link', board: 'squares-four', cut: 'scissors',
	duplicate: 'copy-simple', chevronDown: 'caret-down', chevronRight: 'caret-right', check: 'check', lock: 'lock',
	unlock: 'lock-open', groupItems: 'selection-plus', ungroup: 'selection-slash', alignLeft: 'text-align-left',
	alignCenter: 'text-align-center', alignRight: 'text-align-right', valignTop: 'arrow-line-up',
	valignMiddle: 'arrows-in-line-vertical', valignBottom: 'arrow-line-down', alignItemsLeft: 'align-left',
	alignItemsCenter: 'align-center-horizontal', alignItemsRight: 'align-right', alignItemsTop: 'align-top',
	alignItemsMiddle: 'align-center-vertical', alignItemsBottom: 'align-bottom', tidyUp: 'grid-four',
	sortColors: 'palette', shape: 'shapes', text: 'text-t', rect: 'rectangle', roundRect: 'square', ellipse: 'circle',
	diamond: 'diamond', triangle: 'triangle', arrowRight: 'arrow-fat-right', arrange: 'arrows-out-cardinal',
	account: 'user', connector: 'arrow-up-right', label: 'textbox', connect: 'line-segment',
	swapDirection: 'arrows-left-right', emoticonPlus: 'smiley', qrcode: 'qr-code', group: 'users-three', team: 'users',
	present: 'presentation', eye: 'eye', eyeOff: 'eye-slash', close: 'x', download: 'download-simple',
	upload: 'upload-simple', image: 'image', timer: 'timer', vote: 'check-square', facilitate: 'flag',
	zoomSelection: 'scan', dice: 'dice-five', star: 'star', starOutline: 'star', sort: 'funnel-simple',
	chevronLeft: 'caret-left', keyboard: 'keyboard', legal: 'scales', exportTo: 'tray-arrow-down',
	insertFrom: 'tray-arrow-up', moreTools: 'plus-square', importShapes: 'folder-simple-plus',
	zoom100: 'magnifying-glass', search: 'magnifying-glass', caretUp: 'caret-up', caretDown: 'caret-down', dotsHorizontal: 'dots-three', routes: 'path', tips: 'arrow-right', headerRow: 'browser',
	branch: 'git-branch', viewGrid: 'squares-four', viewList: 'list',
}
/** The own drawings (job 244): looks Phosphor has nothing fitting for, in its style. */
const PICTURES = ['mmBoth', 'laser', 'distributeHorizontal', 'distributeVertical', 'dashSolid', 'dashDashed', 'dashDotted', 'routeStraight', 'routeElbow', 'routeCurved', 'capNone', 'capArrow', 'capTriangle', 'capDot', 'capDiamond', 'capCircleOpen', 'capTriangleOpen', 'notePad', 'lanes', 'sparkle', 'marker', 'eraser', 'widthThin', 'widthMedium', 'widthThick', 'listBullets', 'linkOut']

/** Every point of path data (absolute, parsed) lies on the 24 × 24 grid. */
function onGrid(d) {
	const cmds = parseSvgPath(d)
	return cmds !== null && cmds.every((c) => c.slice(1).every((v) => v >= 0 && v <= 24))
}

test('job 244 AK1: every icon is Phosphor Regular from the table, scaled from 256 to the 24 grid, or an own drawing; star is the outer contour', () => {
	assert.deepEqual(Object.keys(ICON_SOURCE).sort(), Object.keys(icons).sort())
	assert.deepEqual(Object.keys(ICON_SOURCE).sort(), [...Object.keys(PHOSPHOR_OF), ...PICTURES].sort())
	assert.equal(PHOSPHOR_SCALE, 3 / 32)
	for (const [k, src] of Object.entries(ICON_SOURCE)) {
		assert.ok(onGrid(icons[k]), `${k} on the grid`)
		if (k in PHOSPHOR_OF) {
			assert.equal(src, 'phosphor:' + PHOSPHOR_OF[k], k)
			if (k !== 'star') assert.equal(icons[k], scalePath(PHOSPHOR[PHOSPHOR_OF[k]], PHOSPHOR_SCALE), k)
		} else {
			assert.equal(src, 'picture', k)
		}
	}
	// the filled star ("favourite set") is the first subpath of Phosphor's star, its outline the whole path
	const star = PHOSPHOR.star
	assert.equal(icons.star, scalePath(star.slice(0, star.indexOf('Z') + 1), PHOSPHOR_SCALE))
	assert.equal(icons.starOutline, scalePath(star, PHOSPHOR_SCALE))
	assert.ok(icons.star.length < icons.starOutline.length)
	// no Material Design Icons left in the shell
	assert.ok(Object.values(ICON_SOURCE).every((s) => !s.startsWith('mdi:')))
})

test('job 244 AK4: each own drawing is one path that parses and stays on the 24 grid, drawn wider than a hair', () => {
	for (const k of PICTURES) {
		const d = icons[k]
		assert.equal(typeof d, 'string', k)
		assert.ok(parseSvgPath(d) !== null, `${k} parses`)
		assert.ok(onGrid(d), `${k} on the grid`)
		assert.match(d, /^M[^M]*Z(M[^M]*Z)*$/, `${k}: closed parts only (lines are their outlines)`)
		const cmds = parseSvgPath(d)
		const xs = cmds.flatMap((c) => c.slice(1).filter((_, i) => i % 2 === 0))
		const ys = cmds.flatMap((c) => c.slice(1).filter((_, i) => i % 2 === 1))
		assert.ok(Math.max(...xs) - Math.min(...xs) >= 1.5 && Math.max(...ys) - Math.min(...ys) >= 1.5, `${k}: lines 1.5 wide at least`)
	}
})

/** Job 244: the switched-on buttons of the bars (spec list 1–5). */
const SWITCHED_ON = [
	'.knorke-toolbar__button--active',
	"button.knorke-toolpop__tile[aria-pressed='true']",
	".knorke-contextbar .button-vue[aria-pressed='true']",
	".knorke-contextbar__panel .button-vue[aria-pressed='true']",
	"button.knorke-contextbar__filter[aria-expanded='true']",
	".knorke-contextbar__more .action-item__menutoggle[aria-expanded='true']",
	"button.knorke-topbar__comments[aria-pressed='true']",
	"button.knorke-topbar__search[aria-pressed='true']",
	"button.knorke-topbar__outline[aria-pressed='true']", // job 274
	".knorke-topbar__views [aria-pressed='true']", // job 274
	".knorke-modmenu .action-item__menutoggle[aria-expanded='true']",
	".knorke-sessionbar [data-knorke-bar='list'][aria-expanded='true']",
	".knorke-zoom__menu .action-item__menutoggle[aria-expanded='true']",
	".knorke-list__views [aria-pressed='true']",
]

test('job 244 AK5: a switched-on button is filled with the accent and draws in its text colour (dark mode b: the colour the admin set, white on it); hovering keeps it; nothing gives it the light accent any more', () => {
	const rule = rules().find((r) => parts(r.selector).includes('.knorke-toolbar__button--active'))
	assert.ok(rule)
	assert.deepEqual(parts(rule.selector), SWITCHED_ON)
	assert.equal(declOf(rule.body, 'background'), 'var(--k-on)')
	assert.equal(declOf(rule.body, 'color'), 'var(--k-on-text)')
	assert.equal(declOf(rule.body, 'border-color'), 'var(--k-on)')
	assert.match(rule.body, /background: var\(--k-on\) !important;/)
	// no other rule paints these buttons, not on hover either (the hover rules leave the switched-on state out)
	for (const r of rules()) {
		if (r.selector === rule.selector || !/background/.test(r.body)) continue
		for (const s of parts(r.selector)) {
			assert.ok(!SWITCHED_ON.includes(s), `${s} painted again (${r.selector})`)
			assert.ok(!/knorke-toolbar__button--active|knorke-list__views \[aria-pressed/.test(s), `${s}: one rule only`)
		}
	}
	assert.match(css, /button\.knorke-toolpop__tile:hover:not\(\[aria-pressed='true'\]\) \{/)
	assert.match(css, /button\.knorke-contextbar__filter:hover:not\(\[aria-expanded='true'\]\) \{/)
	assert.match(css, /button\.knorke-toolpop__tile\[aria-pressed='true'\] \.knorke-toolpop__key \{\s*color: inherit;/)
	// the pair is Nextcloud's accent pair; its dark theme lightens the accent and writes black on it,
	// so dark mode (b) takes the colour the admin set and its text colour (white for the default)
	const root = rules().filter((r) => r.selector === ':root').map((r) => r.body).join('')
	assert.equal(declOf(root, '--k-on'), 'var(--k-accent)')
	assert.equal(declOf(root, '--k-on-text'), 'var(--k-accent-text)')
	assert.equal(declOf(root, '--k-accent'), 'var(--color-primary-element, #00679e)')
	assert.equal(declOf(root, '--k-accent-text'), 'var(--color-primary-element-text, #ffffff)')
	const dark = rules().find((r) => r.selector === "[data-knorke-dark='b']")
	assert.equal(declOf(dark.body, '--k-on'), 'var(--color-primary, #00679e)')
	assert.equal(declOf(dark.body, '--k-on-text'), 'var(--color-primary-text, #ffffff)')
	const surfaces = rules().find((r) => r.selector.startsWith("[data-knorke-dark='b'] :is("))
	assert.doesNotMatch(surfaces.body, /--k-on|--knorke-primary|--color-primary/)
	// the tool bar: a tool whose popover is open counts as switched on
	assert.match(read('src/components/Toolbar.vue'), /function highlighted\(id\) \{\n\treturn pressed\(id\) \|\| \(id === 'shape' && props\.shapesOpen\) \|\| openFor\(id\)\n\}/)
})

test('job 244 AK8: every NcActions of Knorke brings its own icon (Phosphor\'s "⋯" where it showed Nextcloud\'s); the zoom menu hides its icon', () => {
	const files = [...readdirSync(new URL('../../../src/components/', import.meta.url)).map((f) => 'src/components/' + f), ...readdirSync(new URL('../../../src/views/', import.meta.url)).map((f) => 'src/views/' + f)].filter((f) => f.endsWith('.vue'))
	const without = []
	let n = 0
	for (const f of files) {
		const src = read(f)
		for (const m of src.matchAll(/<NcActions\b(?:[^>"]|"[^"]*")*>([\s\S]*?)<\/NcActions>/g)) {
			n++
			// its own slot #icon, not one of an NcActionButton inside it
			const own = m[1].replace(/<NcAction(Button|Link|Checkbox|Radio|Input|Text)\b[\s\S]*?<\/NcAction\1>/g, '')
			if (!/<template #icon>|<template v-if="[^"]*" #icon>/.test(own)) without.push(f)
		}
	}
	assert.ok(n >= 8, `${n} menus`)
	assert.deepEqual(without, ['src/components/ZoomControls.vue'])
	assert.match(css, /\.knorke-zoom__menu \.action-item__menutoggle \.button-vue__icon \{\s*display: none !important;/)
	assert.match(read('src/components/ModerationMenu.vue'), /<template #icon>\s*<NcIconSvgWrapper :path="overflow \|\| board \? icons\.dotsHorizontal : icons\.facilitate" \/>/)
	assert.match(read('src/components/ShapesPanel.vue'), /:data-knorke-shape-lib-menu="sec\.key">\s*<template #icon>\s*<NcIconSvgWrapper :path="icons\.dotsHorizontal" \/>/)
})

test('job 226 AK5: icons are 20 px; 16 px only for the link chip (job 228: and the guest chip) and the small option arrows; (job 229) 28 px pictures on the tiles of the tool bar\'s popovers', () => {
	const files = [...readdirSync(new URL('../../../src/components/', import.meta.url)).map((f) => 'src/components/' + f), ...readdirSync(new URL('../../../src/views/', import.meta.url)).map((f) => 'src/views/' + f), 'src/App.vue', 'src/PublicApp.vue'].filter((f) => f.endsWith('.vue'))
	const odd = []
	for (const f of files) {
		const src = read(f)
		for (const m of src.matchAll(/<NcIconSvgWrapper\b[^>]*?:size="(\d+)"[^>]*>/g)) {
			if (m[1] === '20') continue
			// job 229: a tile shows a picture above its name, like the shapes panel's 28 px previews
			const tile = m[1] === '28' && ['src/components/ToolVariants.vue', 'src/components/Toolbar.vue'].includes(f)
			const ok = tile || (m[1] === '16' && (/icons\.link/.test(m[0]) || /icons\.chevronDown/.test(m[0]) || (f === 'src/components/TopBar.vue' && /icons\.account/.test(m[0]))))
			if (!ok) odd.push(`${f}: ${m[0]}`)
		}
		for (const m of src.matchAll(/<svg\b[^>]*viewBox="0 0 24 24"[^>]*>/g)) {
			const w = m[0].match(/\swidth="(\d+)"/)?.[1]
			if (w !== undefined && w !== '20') odd.push(`${f}: ${m[0]}`)
		}
	}
	assert.deepEqual(odd, [])
	assert.match(css, /\.knorke-contextmenu__check \{[^}]*width: 20px;[^}]*height: 20px;/)
	assert.match(css, /\.knorke-shapes__chevron \{[^}]*width: 20px;[^}]*height: 20px;/)
})

test('job 226 AK6: every entry of the tool options shows an icon; note pad, swimlanes, routes and tips as pictures', () => {
	const values = { kind: BASIC_KINDS, route: ENUMS.routes, endCap: ENUMS.caps, type: NOTE_TOOL_TYPES, frameKind: FRAME_TOOL_KINDS }
	const keyOf = (path) => Object.entries(icons).find(([, p]) => p === path)?.[0]
	for (const [option, list] of Object.entries(values)) {
		for (const v of list) assert.ok(typeof OPTION_ICONS[option]?.[v] === 'string', `${option}=${v} has an icon`)
	}
	assert.equal(OPTION_ICONS.type.pad, icons.notePad)
	assert.equal(OPTION_ICONS.frameKind.lanes, icons.lanes)
	for (const v of [...ENUMS.routes, ...ENUMS.caps]) assert.equal(ICON_SOURCE[keyOf(OPTION_ICONS[v in OPTION_ICONS.route ? 'route' : 'endCap'][v])], 'picture', v)
	for (const v of ['pad']) assert.equal(ICON_SOURCE[keyOf(OPTION_ICONS.type[v])], 'picture')
	assert.equal(ICON_SOURCE[keyOf(OPTION_ICONS.frameKind.lanes)], 'picture')
	assert.equal(ICON_SOURCE[keyOf(OPTION_ICONS.type.sticky)], 'phosphor:note')
	assert.equal(ICON_SOURCE[keyOf(OPTION_ICONS.frameKind.frame)], 'phosphor:frame-corners')
	// job 229: tiles with the picture above the name instead of radio entries
	const src = read('src/components/ToolVariants.vue')
	assert.match(src, /<button v-for="e in g\.entries"[\s\S]*?<NcIconSvgWrapper :path="e\.icon" :size="28" \/>\s*<span class="knorke-toolpop__label">\{\{ e\.label \}\}<\/span>/)
	assert.match(src, /icon: OPTION_ICONS\[option\]\?\.\[value\]/)
	// the context bar reads the same table
	const bar = read('src/components/ContextBar.vue')
	assert.match(bar, /const KIND_ICONS = OPTION_ICONS\.kind/)
	assert.match(bar, /const ROUTE_ICONS = OPTION_ICONS\.route/)
	assert.match(bar, /const CAP_ICONS = OPTION_ICONS\.endCap/)
})

test('job 226: Knorke\'s NcActions menus live in #knorke-menus; App and PublicApp set it up', () => {
	// job 229: the zoom menu instead of the tool options' menu
	const files = ['src/components/ShapesPanel.vue', 'src/components/ModerationMenu.vue', 'src/components/ZoomControls.vue', 'src/views/BoardList.vue']
	let n = 0
	for (const f of files) {
		for (const m of read(f).matchAll(/<NcActions\b(?:[^>"]|"[^"]*")*>/g)) {
			n++
			assert.match(m[0], /container="#knorke-menus"/, f)
		}
	}
	assert.equal(n, 5)
	for (const f of ['src/App.vue', 'src/PublicApp.vue']) assert.match(read(f), /\nuseTheme\(\)\n/, f)
	assert.match(read('src/components/theme.js'), /el\.id = 'knorke-menus'/)
})

test('job 226 (dark mode b): the mark only for a dark theme that is not a contrast theme; set and removed on <body>', () => {
	assert.equal(darkMark(true, 'default'), 'b')
	assert.equal(darkMark(true, 'dark'), 'b')
	assert.equal(darkMark(true, undefined), 'b')
	assert.equal(darkMark(true, 'dark-highcontrast'), null)
	assert.equal(darkMark(false, 'default'), null)
	assert.equal(darkMark('yes', 'dark'), null)
	const attrs = new Map()
	const el = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) }
	applyDarkMark(el, 'b')
	assert.equal(attrs.get(DARK_ATTR), 'b')
	assert.equal(DARK_ATTR, 'data-knorke-dark')
	applyDarkMark(el, null)
	assert.equal(attrs.has(DARK_ATTR), false)
	const style = (v) => () => ({ getPropertyValue: () => v })
	assert.equal(isDarkTheme({}, style(' invert(100%)')), true)
	assert.equal(isDarkTheme({}, style('no')), false)
	assert.equal(isDarkTheme({}, style('')), false)
})

test('job 226 (dark mode b): under the mark the surfaces of all three levels turn #2b2c30 with light text; the canvas keeps its light colour', () => {
	const dark = rules().find((r) => r.selector.startsWith("[data-knorke-dark='b'] :is("))
	assert.ok(dark)
	const inner = dark.selector.match(/:is\((.*)\)$/)[1]
	for (const s of LEVELS.flatMap((l) => l.surfaces).filter((x) => x !== '.knorke-banner')) assert.ok(parts(inner).includes(s.replace(/^button/, '')), s)
	for (const [k, v] of [['--color-main-background', '#2b2c30'], ['--color-main-text', '#ebebeb'], ['--color-text-maxcontrast', '#b4b6b9'], ['--color-background-hover', '#3a3b40'], ['--knorke-surface', '#2b2c30'], ['--knorke-text', '#ebebeb'], ['--k-shadow-bar', '0 1px 2px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.14)']]) {
		assert.equal(declOf(dark.body, k), v, k)
	}
	assert.match(css, /--knorke-board-bg: #f3f2f0;/)
	assert.ok(!rules().some((r) => r.selector.includes('data-knorke-dark') && /knorke-canvas|board-bg/.test(r.selector + r.body)), 'nothing darkens the canvas')
})

/** The tool bar's reserves (px) for a layout: the custom properties of the matching rules, the most specific last. */
function reserves(selectors, coarse) {
	const t = tokens()
	const px = (v) => {
		let e = v
		for (let k = 0; k < 6; k++) e = e.replace(/var\((--[a-z0-9-]+)\)/g, (m, n) => (n === '--knorke-bar-h' ? (coarse ? '52px' : '44px') : t.get(n) ?? m))
		return Function('return ' + e.replace(/calc/g, '').replace(/px/g, ''))()
	}
	let top
	let bottom
	for (const sel of selectors) {
		const r = rules().find((x) => x.selector === sel)
		assert.ok(r, sel)
		top = declOf(r.body, '--knorke-tools-top') ?? top
		bottom = declOf(r.body, '--knorke-tools-bottom') ?? bottom
	}
	return { top: px(top), bottom: px(bottom) }
}

/** Height of the tool bar with a finger (job 229): 8 buttons of 44 px without gaps, the separator (1 + 2 × 4) and 2 × 4 px padding. */
const TOOLS_COARSE = 8 * 44 + 9 + 8

test('job 226 (round 2, risk: a finger on a phone and a tablet held across): the tool bar stays between the top bar, one docked row and (job 229) the undo island, and fits without gaps', () => {
	assert.match(css, /@media \(pointer: coarse\) \{\s*\.knorke-toolbar,\s*\.knorke-zoom,\s*\.knorke-undo \{\s*gap: 0;/)
	const [gap, bar] = [8, 52]
	// tablet across (Galaxy Tab in Chrome, 1316 × 740, Nextcloud header 50 px): wide layout
	const wide = reserves(['.knorke-toolbar'], true)
	assert.equal(wide.top, gap * 2 + bar, 'below the top bar')
	assert.equal(wide.bottom, gap * 2 + bar, 'job 229: above the undo island')
	assert.ok(690 - wide.top - wide.bottom >= TOOLS_COARSE, `${690 - wide.top - wide.bottom} px of room ≥ ${TOOLS_COARSE}: no scrolling`)
	// phone 390 × 844 (board 794) and 393 × 873 (board 823): narrow layout
	const narrow = reserves(['.knorke-toolbar', '.knorke-board--narrow .knorke-toolbar'], true)
	assert.equal(narrow.top, gap * 3 + bar * 2, 'below the top bar and one docked row (context bar or notice)')
	assert.equal(narrow.bottom, gap * 2 + bar, 'above the zoom controls')
	for (const board of [794, 823]) assert.ok(board - narrow.top - narrow.bottom >= TOOLS_COARSE, `board ${board}: fits`)
	// while the touch tip shows: above it (its top edge 2 × gap + bar + 52 above the bottom)
	const tip = reserves(['.knorke-toolbar', '.knorke-board--narrow .knorke-toolbar', '.knorke-board:has(.knorke-touchtip) .knorke-toolbar'], true)
	assert.ok(tip.bottom >= gap * 2 + bar + 52 + gap, 'clear of the tip')
	const both = reserves(['.knorke-toolbar', '.knorke-board--votebar:has(.knorke-touchtip) .knorke-toolbar'], true)
	assert.ok(both.bottom >= gap * 2 + bar + 52 + gap + bar, 'clear of the tip above the vote bar')
	const vote = reserves(['.knorke-toolbar', '.knorke-board--narrow .knorke-toolbar', '.knorke-board--narrow.knorke-board--votebar .knorke-toolbar'], true)
	assert.ok(vote.bottom >= bar + gap + bar + gap, 'narrow: clear of the zoom controls above the vote bar')
	// job 229: the undo island (2 buttons) and the zoom bar (3 buttons and the 64 px percentage) side by side in 360 px (E94 measures it)
	assert.ok(gap + (2 * 44 + 8) + gap + (3 * 44 + 64 + 8) + gap <= 360, 'undo island and zoom bar inside 360 px')
})

test('job 226 (round 2): in the narrow layout the docked context bar stands right of the tool bar\'s column while the tool bar shows', () => {
	const r = rules().find((x) => x.selector === '.knorke-board--narrow:has(.knorke-toolbar) .knorke-topstack > .knorke-contextbar:not([data-knorke-place])')
	assert.ok(r)
	assert.equal(declOf(r.body, 'margin-inline-start'), 'calc(2 * var(--knorke-btn) + 2 * var(--k-bar-pad) + var(--knorke-gap))')
	assert.equal(declOf(r.body, 'max-width'), 'calc(100% - 2 * var(--knorke-btn) - 2 * var(--k-bar-pad) - var(--knorke-gap))')
	// two buttons (44 px each with a finger) plus the bar's padding, then a gap; job 229 keeps it after the options
	// arrows went (the panels of the docked bar open at its inline end, E92 (4))
	assert.equal(2 * 44 + 2 * 4 + 8, 104)
})

test('job 226 (round 3): the panels of the indented docked context bar open at its inline end, so they stay inside the window', () => {
	const r = rules().find((x) => x.selector === '.knorke-board--narrow:has(.knorke-toolbar) .knorke-topstack > .knorke-contextbar:not([data-knorke-place]) .knorke-contextbar__panel:not([data-knorke-panel-side])')
	assert.ok(r)
	assert.equal(declOf(r.body, 'left'), 'auto')
	assert.equal(declOf(r.body, 'inset-inline-end'), '0')
	assert.equal(declOf(r.body, 'transform'), 'none')
	// a panel is at most 92vw wide; the bar ends one gap (8 px) before the window's edge
	const base = rules().find((x) => x.selector === '.knorke-contextbar__panel')
	assert.equal(declOf(base.body, 'max-width'), 'min(92vw, 560px)')
	for (const w of [360, 390, 412]) assert.ok(w - 8 - 0.92 * w >= 0, `${w} px: the panel's left edge inside the window`)
})

test('job 271: the search panel\'s buttons take the bar size (36 px, 44 px with pen or finger)', () => {
	const panel = rules().find((r) => r.selector === '.knorke-search')
	assert.equal(declOf(panel.body, '--default-clickable-area'), 'var(--knorke-btn)')
	const hit = rules().find((r) => r.selector === 'button.knorke-search__hit')
	assert.equal(declOf(hit.body, 'min-height'), 'var(--knorke-touch)', 'the rows 44 px')
})
