/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * knorke.css: Nextcloud's --color-error/-warning/-success are pastel
 * backgrounds (NC 34/35 measured: #ffe7e7, #ffeec5, #d8f3da) meant for a dark
 * --color-*-text. White text on them (the state banners and toasts until
 * 11.10.) is unreadable, and using them as a text colour is invisible.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bannerFor } from '../../../src/components/banner.js'
import { MARQUEE_STROKE } from '../../../src/model/tokens.js'
import { FINAL_STATUSES } from '../../../src/sync/SyncClient.js'

const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * @param {string} [src] CSS without comments (default: knorke.css)
 * @return {Array<{selector: string, body: string}>} flat rule list (nested @media bodies included)
 */
function rules(src = css) {
	const out = []
	const re = /([^{}]+)\{([^{}]*)\}/g
	let m
	while ((m = re.exec(src)) !== null) {
		out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
	}
	return out
}

const STATUS = ['error', 'warning', 'success']

test('css: status tokens come in pairs (background + text), bound to the Nextcloud pairs', () => {
	for (const s of STATUS) {
		assert.match(css, new RegExp(`--knorke-${s}: var\\(--color-${s}, #[0-9a-f]{6}\\);`), s)
		assert.match(css, new RegExp(`--knorke-${s}-text: var\\(--color-${s}-text, #[0-9a-f]{6}\\);`), s + '-text')
	}
})

test('css: every rule with a status background sets the paired text colour; no status background as text colour', () => {
	let seen = 0
	for (const { selector, body } of rules()) {
		for (const s of STATUS) {
			if (new RegExp(`background(-color)?:\\s*var\\(--knorke-${s}\\)`).test(body)) {
				seen++
				assert.match(body, new RegExp(`(^|[;\\s])color:\\s*var\\(--knorke-${s}-text\\)`), selector + ' needs color: var(--knorke-' + s + '-text)')
			}
			assert.doesNotMatch(body, new RegExp(`(^|[;\\s])color:\\s*var\\(--knorke-${s}\\)`), selector + ' uses a pastel background as text colour')
		}
	}
	assert.ok(seen >= 4, 'banner and toast rules found: ' + seen)
})

test('css: every banner kind (offline + final statuses) has its own coloured rule', () => {
	const sel = rules().map((r) => r.selector).join(',')
	for (const s of ['offline', ...FINAL_STATUSES]) {
		const kind = bannerFor(s).kind
		assert.equal(kind, s)
		assert.ok(sel.split(',').map((x) => x.trim()).includes('.knorke-banner--' + kind), '.knorke-banner--' + kind)
	}
})

// ---- M0 §16.2 / SPEC-M1 §1.4: empty guest states in a card (WP-C0) -----------------

/**
 * WCAG relative luminance contrast of two #rrggbb colours.
 *
 * @param {string} a colour
 * @param {string} b colour
 * @return {number} ratio ≥ 1
 */
function contrast(a, b) {
	const lum = (hex) => {
		const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
			.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
		return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
	}
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

/** Nextcloud 34.0.1 theme values (apps/theming/lib/Themes/DefaultTheme.php, DarkTheme.php). */
const THEMES = {
	light: { background: '#ffffff', text: '#222222', maxcontrast: '#6b6b6b' },
	// dark: #EBEBEB, #171717, maxcontrast = darken(#EBEBEB, 32 %) = #999999
	dark: { background: '#171717', text: '#ebebeb', maxcontrast: '#999999' },
}

test('M1 .knorke-public__card: opaque main background with main text; descriptions in max-contrast text', () => {
	const card = rules().find((r) => r.selector === '.knorke-public__card')
	assert.ok(card, '.knorke-public__card rule')
	assert.match(card.body, /(^|[;\s])background:\s*var\(--knorke-surface\)/)
	assert.match(card.body, /(^|[;\s])color:\s*var\(--knorke-text\)/)
	assert.match(css, /--knorke-surface: var\(--color-main-background, #ffffff\);/)
	assert.match(css, /--knorke-text: var\(--color-main-text, #222222\);/)
	const bg = card.body.match(/(?:^|[;\s])background(?:-color)?:\s*([^;]+);/g) ?? []
	assert.equal(bg.length, 1, 'one background declaration')
	assert.doesNotMatch(bg[0], /blur|rgba|transparent/, 'never translucent: the theming background must not show through')
	assert.doesNotMatch(card.body, /(^|[;\s])opacity:/)
	const desc = rules().find((r) => r.selector === '.knorke-public__card .empty-content__description')
	assert.ok(desc)
	assert.match(desc.body, /color:\s*var\(--knorke-text-muted\)/)
	assert.match(css, /--knorke-text-muted: var\(--color-text-maxcontrast, #6b6b6b\);/)
})

test('M1 empty guest states: ≥ 4.5:1 contrast in the light and the dark theme (name and description on the card)', () => {
	for (const [name, t] of Object.entries(THEMES)) {
		assert.ok(contrast(t.text, t.background) >= 4.5, name + ' name ' + contrast(t.text, t.background).toFixed(2))
		assert.ok(contrast(t.maxcontrast, t.background) >= 4.5, name + ' description ' + contrast(t.maxcontrast, t.background).toFixed(2))
	}
})

test('M1 PublicApp: every empty state (revoked, disabled, expired, invalid) sits inside .knorke-public__card', () => {
	const src = readFileSync(new URL('../../../src/PublicApp.vue', import.meta.url), 'utf8')
	const tpl = src.slice(src.indexOf('<template>'), src.indexOf('<script'))
	const open = tpl.indexOf('<div class="knorke-public__card">')
	const close = tpl.indexOf('</div>', open)
	assert.ok(open > 0 && close > open)
	const inside = tpl.slice(open, close)
	for (const hook of ['revoked', 'links_disabled', 'expired', 'invalid']) {
		assert.match(inside, new RegExp('data-knorke-banner="' + hook + '"'), hook + ' inside the card')
	}
	assert.equal((tpl.match(/<NcEmptyContent/g) ?? []).length, 4, 'no empty state outside the card')
})

test('M1 §6.5.4, job 226 AK4: the role/device banners (view_role, vote_ready, device_vote, viewonly) take the base rule, the info pair (light surface, dark text, ≥ 4.5:1)', () => {
	const base = rules().find((r) => r.selector === '.knorke-banner')
	assert.match(base.body, /(^|[;\s])color:\s*var\(--k-info-text\)/)
	assert.match(base.body, /background:\s*var\(--k-info-bg\)/)
	for (const kind of ['view_role', 'vote_ready', 'device_vote', 'viewonly']) {
		assert.ok(!rules().some((r) => r.selector.split(',').map((x) => x.trim()).includes('.knorke-banner--' + kind)), '.knorke-banner--' + kind + ' has no colour of its own')
	}
	// the fallbacks of the info pair (Nextcloud's --color-primary-element-light pair)
	assert.ok(contrast('#00293f', '#e5f0f5') >= 4.5)
})

test('M1 QR code: dark modules on a white square in both themes (scannable); never theme colours', () => {
	const bg = rules().find((r) => r.selector === '.knorke-qr__bg')
	const mod = rules().find((r) => r.selector === '.knorke-qr__modules')
	assert.match(bg.body, /fill:\s*#ffffff/)
	assert.match(mod.body, /fill:\s*#141414/)
	assert.ok(contrast('#141414', '#ffffff') >= 15)
})

// ---- SPEC-M1 §6.6 (R16 (2), R17 K7): the vote bar docks flush at the bottom ----------

/** The custom properties of the :root rules (first declaration wins: the
    mouse values; job 226 added the tokens block and the coarse-pointer one). */
function tokens() {
	const out = new Map()
	for (const root of rules().filter((r) => r.selector === ':root')) {
		for (const m of root.body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
			if (!out.has(m[1])) out.set(m[1], m[2].trim())
		}
	}
	return out
}

/**
 * A CSS length in px: numbers in px (or unitless), %, + − × ÷, parentheses,
 * calc(), min(), max() and var() with the :root tokens (unknown custom
 * properties take their fallback, e.g. --default-clickable-area → 34px).
 *
 * @param {string} expr CSS value
 * @param {number} [base] what 100 % resolves to (the board height for top/bottom/max-height)
 * @return {number} px
 */
function cssPx(expr, base = 0) {
	const vars = tokens()
	const s = expr.trim()
	let i = 0
	const ws = () => { while (/\s/.test(s[i] ?? '')) i++ }
	const expect = (c) => {
		ws()
		assert.equal(s[i], c, `"${c}" at ${i} in "${s}"`)
		i++
	}
	const sum = () => {
		let v = term()
		for (;;) {
			ws()
			if (s[i] === '+' || s[i] === '-') {
				const op = s[i++]
				const r = term()
				v = op === '+' ? v + r : v - r
			} else return v
		}
	}
	const term = () => {
		let v = primary()
		for (;;) {
			ws()
			if (s[i] === '*' || s[i] === '/') {
				const op = s[i++]
				const r = primary()
				v = op === '*' ? v * r : v / r
			} else return v
		}
	}
	const primary = () => {
		ws()
		for (const fn of ['calc', 'min', 'max']) {
			if (s.startsWith(fn + '(', i)) {
				i += fn.length + 1
				const args = [sum()]
				ws()
				while (s[i] === ',') {
					i++
					args.push(sum())
					ws()
				}
				expect(')')
				if (fn === 'calc') return args[0]
				return Math[fn](...args)
			}
		}
		if (s.startsWith('var(', i)) {
			i += 4
			ws()
			const name = /^--[a-z0-9-]+/.exec(s.slice(i))[0]
			i += name.length
			ws()
			let fallback
			if (s[i] === ',') {
				i++
				fallback = sum()
			}
			expect(')')
			if (vars.has(name)) return cssPx(vars.get(name), base)
			assert.ok(fallback !== undefined, `${name} is neither a :root token nor has a fallback`)
			return fallback
		}
		if (s[i] === '(') {
			i++
			const v = sum()
			expect(')')
			return v
		}
		const m = /^(\d+(?:\.\d+)?)(px|%)?/.exec(s.slice(i))
		assert.ok(m, `number at ${i} in "${s}"`)
		i += m[0].length
		return m[2] === '%' ? Number(m[1]) / 100 * base : Number(m[1])
	}
	const v = sum()
	ws()
	assert.equal(i, s.length, `trailing "${s.slice(i)}" in "${s}"`)
	return v
}

/** The declarations of the (single, unconditional) rule with exactly this selector. */
function decls(selector) {
	// the rule of exactly this selector; else (job 229: zoom bar and undo island share one) the one rule that lists it
	let found = rules().filter((r) => r.selector === selector)
	if (found.length === 0) found = rules().filter((r) => r.selector.split(',').map((x) => x.trim()).includes(selector))
	assert.equal(found.length, 1, `one rule "${selector}"`)
	const out = {}
	for (const m of found[0].body.matchAll(/([a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\s*!important$/, '').trim()
	return out
}

test('css calc helper: px, %, var with fallback, calc/max nesting', () => {
	assert.equal(cssPx('0'), 0)
	assert.equal(cssPx('var(--knorke-gap)'), 8)
	assert.equal(cssPx('var(--knorke-clickable)'), 34, 'fallback of --default-clickable-area')
	assert.equal(cssPx('calc(100% - 2 * (var(--knorke-gap) + 4px))', 200), 176)
	assert.equal(cssPx('max(10px, calc(var(--knorke-gap) * 2))'), 16)
})

test('M1 §6.6 (2) R17 K7: the vote bar (job 233: the session bar) docks flush on the bottom edge in every layout (wide: board bottom, narrow: viewport bottom), never floats above it', () => {
	const h = cssPx('var(--knorke-votebar-h)')
	assert.ok(h >= 44, 'the bar is a ≥ 44 px strip: ' + h)
	const wide = decls('.knorke-sessionbar')
	assert.equal(wide.position, 'absolute', 'wide: inside the board, whose bottom edge is the viewport\'s in Nextcloud\'s layout ≤ 1024 px')
	assert.equal(cssPx(wide.bottom), 0, 'wide: bottom 0 (was var(--knorke-gap): the bar ended 8 px above the bottom, r1-w1 E31@820x1180)')
	assert.equal(wide.height, 'var(--knorke-votebar-h)')
	assert.equal(wide['box-sizing'], 'border-box', 'padding lies inside the bar height')
	assert.doesNotMatch(wide.transform ?? '', /translateY|translate\(|translate3d|matrix/, 'only a horizontal centring shift')
	assert.ok(!('margin' in wide) && !('margin-bottom' in wide) && !('margin-block-end' in wide), 'no margin lifts the bar')
	assert.match(wide['border-radius'] ?? '', /^var\(--k-radius-bar\) var\(--k-radius-bar\) 0 0$/, 'docked: only the top corners are round')
	assert.ok(!('border' in wide) && !('border-width' in wide), 'job 226: no border at all (the level rule sets border: 0 and a transparent outline)')
	const narrow = decls('.knorke-sessionbar--narrow')
	assert.equal(narrow.position, 'fixed')
	assert.equal(cssPx(narrow.bottom), 0)
	assert.ok(!('transform' in narrow) || narrow.transform === 'none')
	// the K7 measurement of r1-w1: 820 × 1180, Nextcloud header 50 px, board 50 … 1180
	const [vh, boardTop] = [1180, 50]
	const barBottom = boardTop + (vh - boardTop) - cssPx(wide.bottom)
	assert.ok(barBottom >= vh - 1, `bottom edge ${barBottom} ≥ ${vh - 1} (§6.6 (5))`)
})

test('M1 §6.6 (2): zoom controls, (job 229) the undo island, toolbar and the open vote panel stand above the docked vote bar, never over it', () => {
	const gap = cssPx('var(--knorke-gap)')
	const barH = cssPx('var(--knorke-votebar-h)')
	const barTop = barH + cssPx(decls('.knorke-sessionbar').bottom) // distance of the bar's top edge from the board bottom
	const zoom = decls('.knorke-board--votebar .knorke-zoom')
	assert.ok(cssPx(zoom.bottom) >= barTop + gap, `zoom bottom ${cssPx(zoom.bottom)} ≥ ${barTop + gap}`)
	const zoomNarrow = decls('.knorke-board--narrow.knorke-board--votebar .knorke-zoom')
	assert.equal(zoomNarrow.position, 'fixed')
	assert.ok(cssPx(zoomNarrow.bottom ?? zoom.bottom) >= barH + gap)
	// job 229: the undo island on the zoom controls' bottom edge, in every layout
	assert.deepEqual(decls('.knorke-board--votebar .knorke-undo'), zoom)
	assert.deepEqual(decls('.knorke-board--narrow.knorke-board--votebar .knorke-undo'), zoomNarrow)
	// job 233: the vote list ends where the comment panel ends, above the zoom controls standing on the bar
	const panel = decls('.knorke-board--votebar .knorke-votepanel:not(.knorke-votepanel--sheet)')
	assert.ok(cssPx(panel.bottom) >= cssPx(zoom.bottom) + cssPx('var(--knorke-bar-h)') + gap - 0.01, `panel bottom ${cssPx(panel.bottom)} above the zoom controls`)
	assert.deepEqual(panel, decls('.knorke-board--votebar .knorke-comments:not(.knorke-comments--sheet)'), 'the same bottom as the comment panel')
	// job 226 (round 2): the toolbar never reaches into its two reserves (top: the top bar; bottom: job 229 the
	// undo island above the vote bar): max-height fills the room, then it scrolls; job 229: it stands at the
	// top, under the left island, not centred
	const tb = decls('.knorke-toolbar')
	assert.equal(tb.top, 'var(--knorke-tools-top)')
	assert.ok(!('bottom' in tb) && !('margin-block' in tb), 'not centred any more')
	assert.equal(tb['max-height'], 'calc(100% - var(--knorke-tools-top) - var(--knorke-tools-bottom))')
	assert.equal(tb['overflow-y'], 'auto')
	assert.ok(!('transform' in tb), 'no centring shift')
	const top = decls('.knorke-topbar')
	// job 226: the bar height, no border (44 px with a mouse: top bar 8 … 52 px in the board)
	const topBottom = cssPx(top.top) + cssPx('var(--knorke-bar-h)')
	const reserveTop = cssPx(tb['--knorke-tools-top'])
	const reserveBottom = cssPx(decls('.knorke-board--votebar .knorke-toolbar')['--knorke-tools-bottom'])
	assert.ok(reserveTop >= topBottom + gap - 0.01, `toolbar top reserve ${reserveTop} clear of the top bar (${topBottom} + gap)`)
	assert.ok(reserveBottom >= barTop + gap - 0.01, `toolbar bottom reserve ${reserveBottom} clear of the vote bar (top edge ${barTop} above the bottom)`)
	const undoTop = cssPx(decls('.knorke-board--votebar .knorke-undo').bottom) + cssPx('var(--knorke-bar-h)')
	assert.ok(reserveBottom >= undoTop + gap - 0.01, `toolbar bottom reserve ${reserveBottom} clear of the undo island over the vote bar (${undoTop})`)
})

// ---- SPEC-M1 §6.3: the look of the text editor per kind ------------------------------

/** The bodies of all rules whose selector list contains exactly `selector`. */
function bodiesFor(selector, src = css) {
	return rules(src).filter((r) => r.selector.split(',').map((x) => x.trim()).includes(selector)).map((r) => r.body)
}

const editorOf = (kind) => `textarea[data-knorke-editor][data-knorke-editor-kind='${kind}']`

/** The outline* declarations of the bodies, whitespace normalised. */
const outlinesIn = (bodies) => bodies.join(';').split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter((d) => /^outline/.test(d))

const FORCED_COLORS = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/g
const REDUCED_MOTION = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g

/**
 * Splits `src` at its blocks whose head matches `head` (a global regex up to
 * the opening brace), each at brace depth 0: `inside` is their contents,
 * `outside` the CSS without them (head included), `blocks` their number.
 *
 * @param {string} src CSS without comments
 * @param {RegExp} head block head, global
 * @return {{inside: string, outside: string, blocks: number}}
 */
function blocksOf(src, head) {
	const re = new RegExp(head.source, 'g')
	const depth = (s) => (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length
	const inside = []
	const outside = []
	let from = 0
	let m
	while ((m = re.exec(src)) !== null) {
		assert.equal(depth(src.slice(0, m.index)), 0, `a block ${m[0]} at brace depth 0, offset ${m.index}`)
		let d = 1
		let i = re.lastIndex
		for (; i < src.length && d > 0; i++) d += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0
		assert.equal(d, 0, `the block ${m[0]} at offset ${m.index} is closed`)
		inside.push(src.slice(re.lastIndex, i - 1))
		outside.push(src.slice(from, m.index))
		from = re.lastIndex = i
	}
	outside.push(src.slice(from))
	return { inside: inside.join('\n'), outside: outside.join('\n'), blocks: inside.length }
}

/**
 * Splits `css` at its @media (forced-colors: active) blocks, each at brace
 * depth 0: `inside` is their contents, `outside` the CSS without them (head
 * included), `blocks` their number.
 */
function forcedColors() {
	return blocksOf(css, FORCED_COLORS)
}

/** The editor kinds that show only the caret (job 150: the frame title joined note, shape and text). */
const CARET_ONLY = ['shape', 'note', 'text', 'title']

/** The declarations of the bodies starting with `prop`, whitespace normalised. */
const declsOf = (bodies, prop) => bodies.join(';').split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter((d) => d.startsWith(prop))

test('M1 §6.3 shape, note, text and (job 150) frame title editor: no frame around the text field (outline none, transparent, no border, no shadow; all !important over the inline defaults; no other outline*)', () => {
	for (const kind of CARET_ONLY) {
		const bodies = bodiesFor(editorOf(kind))
		assert.ok(bodies.length > 0, 'a rule for the ' + kind + ' editor')
		assert.ok(bodies.some((b) => /outline:\s*none\s*!important/.test(b)), kind + ': outline: none !important (TextEditor.open sets a 2 px outline inline)')
		const all = bodies.join(';')
		assert.match(all, /background:\s*transparent\s*!important/, kind)
		assert.match(all, /border:\s*0\s*!important/, kind)
		assert.match(all, /box-shadow:\s*none\s*!important/, kind)
		// an outline-style (or -width, -color) of the same specificity would bring a frame back
		const outlines = all.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter((d) => /^outline/.test(d))
		for (const d of outlines) assert.equal(d, 'outline: none !important', kind)
	}
	// (job 150) the title lost its white field with rounded corners and shadow: nothing of it may stay
	const title = bodiesFor(editorOf('title'))
	assert.match(title.join(';'), /border-radius:\s*0\s*!important/, 'title: border-radius: 0 !important')
	for (const d of declsOf(title, 'border-radius')) assert.equal(d, 'border-radius: 0 !important', 'title')
	for (const d of declsOf(title, 'background')) assert.equal(d, 'background: transparent !important', 'title')
	for (const d of declsOf(title, 'box-shadow')) assert.equal(d, 'box-shadow: none !important', 'title')
})

test('M1 §6.3 the connector label keeps its outline and its light background (label and the base rule never switch the outline off)', () => {
	const off = [/outline(-style)?:\s*none/, /outline(-width)?:\s*0/]
	for (const kind of ['label']) {
		const bodies = bodiesFor(editorOf(kind))
		assert.ok(bodies.length > 0, 'a rule for the ' + kind + ' editor')
		for (const body of bodies) for (const re of off) assert.doesNotMatch(body, re, kind)
	}
	assert.match(bodiesFor(editorOf('label')).join(';'), /background:\s*#f3f2f0\s*!important/, 'the label keeps its background')
	const base = bodiesFor('textarea[data-knorke-editor]')
	assert.ok(base.length > 0, 'the base rule textarea[data-knorke-editor]')
	for (const body of base) for (const re of off) assert.doesNotMatch(body, re, 'base rule')
})

test('M1 §6.3 forced colors: the focused shape, note, text and (job 150) frame title editor show a 2 px Highlight outline (WCAG 2.4.7)', () => {
	const { inside, blocks } = forcedColors()
	assert.ok(blocks >= 1, 'an @media (forced-colors: active) block in knorke.css')
	for (const kind of CARET_ONLY) {
		const bodies = bodiesFor(editorOf(kind) + ':focus', inside)
		assert.ok(bodies.length > 0, 'a forced-colors rule for the focused ' + kind + ' editor')
		const outlines = outlinesIn(bodies)
		assert.ok(outlines.length > 0, kind + ': an outline for the focus')
		for (const d of outlines) assert.equal(d, 'outline: 2px solid Highlight !important', kind)
	}
})

test('M1 §6.3 outside forced colors: no outline for the shape, note, text and (job 150) frame title editor in any state', () => {
	const { outside } = forcedColors()
	for (const kind of CARET_ONLY) {
		// every state: the bare editor, :focus, :focus-visible, [data-knorke-editor-state=…]
		const own = rules(outside).filter((r) => r.selector.split(',').some((x) => x.trim().startsWith(editorOf(kind))))
		assert.ok(own.length > 0, 'a rule for the ' + kind + ' editor outside forced colors')
		for (const { selector, body } of own) {
			for (const d of outlinesIn([body])) assert.equal(d, 'outline: none !important', kind + ': ' + selector)
		}
	}
})

// ---- SPEC-M1 §6.6 ContextMenu.vue: the box of the context menu (UX B9) -----------------

test('M1 §6.6 context menu (UX B9): border-box with !important, so max-height and the widths bound the outer box whatever box-sizing the page sets; outside 200 … 320 px as NC (already border-box) showed it on main; scrolls, CSS max-height as the fallback', () => {
	const d = decls('.knorke-contextmenu')
	assert.equal(d['box-sizing'], 'border-box')
	const raw = rules().filter((r) => r.selector === '.knorke-contextmenu')
	assert.equal(raw.length, 1)
	assert.match(raw[0].body, /box-sizing: border-box !important/, 'over a universal rule, an inherit from the root or an id selector')
	assert.equal(d['min-width'], '200px', 'the outer minimum of main in NC (#content[class*=app-] * is border-box)')
	assert.equal(d['max-width'], 'min(320px, calc(100vw - 16px))', 'the outer maximum of main in NC')
	assert.equal(d['max-height'], 'calc(100vh - 16px)', 'the fallback until ContextMenu.vue sets it from the bounds')
	assert.equal(d.overflow, 'auto', 'what does not fit scrolls')
	assert.equal(d.padding, '4px')
	assert.ok(!('border' in d), 'job 226: no border (the level rule: border 0 and a transparent outline)')
	assert.equal(cssPx(d['min-width']) - 2 * cssPx(d.padding), 192, 'border-box: the content of the narrowest menu is 200 − 2 × 4 px (2 px wider than with the old 1 px border)')
})

// ---- SPEC-M1 §6.3 (R38): the hold ring of the touch marquee ------------------------------

/**
 * @param {string[]} bodies rule bodies
 * @return {object} their declarations, later ones win, whitespace normalised
 */
function declsIn(bodies) {
	const out = {}
	for (const m of bodies.join(';').matchAll(/([a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim().replace(/\s+/g, ' ')
	return out
}

test('R38 hold ring: fixed colours in the light and the dark theme (marquee blue, white edge, round, ≥ 3:1 on the canvas), a 150 ms fade-in', () => {
	const fc = blocksOf(css, FORCED_COLORS)
	const plain = blocksOf(fc.outside, REDUCED_MOTION).outside
	const base = bodiesFor('.knorke-hold-ring', plain)
	assert.equal(base.length, 1, 'one unconditional .knorke-hold-ring rule')
	const d = declsIn(base)
	assert.equal(d.position, 'absolute')
	assert.equal(d['box-sizing'], 'border-box', 'the 120 px the scene sets include the border')
	assert.equal(d['border-radius'], '50%')
	assert.equal(d.border, '3px solid #0082c9')
	assert.equal(d['box-shadow'], '0 0 0 2px #ffffff')
	assert.match(d.animation ?? '', /(^|\s)knorke-hold-ring-in(\s|$)/)
	assert.match(d.animation, /150ms ease-out/)
	assert.doesNotMatch(base[0], /var\(--color-/, 'no theme variable: the canvas stays light in the dark theme')
	assert.doesNotMatch(base[0], /var\(/)
	assert.equal(MARQUEE_STROKE, '#0082c9', 'the ring has the colour of the marquee')
	assert.ok(contrast('#0082c9', '#f3f2f0') >= 3, 'on the board background ' + contrast('#0082c9', '#f3f2f0').toFixed(2))
	assert.ok(contrast('#0082c9', '#ffffff') >= 3, 'on white ' + contrast('#0082c9', '#ffffff').toFixed(2))
	const kf = blocksOf(css, /@keyframes\s+knorke-hold-ring-in\s*\{/g)
	assert.equal(kf.blocks, 1, '@keyframes knorke-hold-ring-in')
	assert.match(kf.inside.replace(/\s+/g, ' '), /from \{ opacity: 0; transform: scale\(0\.5\); \}/)
	assert.match(kf.inside.replace(/\s+/g, ' '), /to \{ opacity: 1; transform: none; \}/)
	// the media rules come after the base rule: same specificity, the later one wins
	const all = rules().filter((r) => r.selector === '.knorke-hold-ring')
	assert.equal(all[0].body, base[0], 'the unconditional rule first')
})

test('R38 hold ring in forced colors: Highlight border with a Canvas outline, no shadow, no fill', () => {
	const inside = bodiesFor('.knorke-hold-ring', blocksOf(css, FORCED_COLORS).inside)
	assert.ok(inside.length > 0, 'a .knorke-hold-ring rule in an @media (forced-colors: active) block')
	const d = declsIn(inside)
	assert.equal(d['border-color'], 'Highlight')
	assert.equal(d.outline, '2px solid Canvas')
	assert.equal(d['box-shadow'], 'none')
	assert.equal(d.background, 'transparent')
})

test('R38 hold ring with reduced motion: no animation, but still shown', () => {
	const rm = blocksOf(css, REDUCED_MOTION)
	const inside = bodiesFor('.knorke-hold-ring', rm.inside)
	assert.ok(inside.length > 0, 'a .knorke-hold-ring rule in an @media (prefers-reduced-motion: reduce) block')
	const d = declsIn(inside)
	assert.equal(d.animation, 'none')
	assert.notEqual(d.display, 'none')
	assert.notEqual(d.visibility, 'hidden')
	assert.notEqual(d.opacity, '0')
	assert.ok(!('display' in d) && !('visibility' in d) && !('opacity' in d), 'nothing that hides it')
})

test('job 173 (round 2): the context menu entries are finger-sized (--knorke-touch) on phones and coarse pointers, 32 px elsewhere', () => {
	assert.match(css, /@media \(max-width: 600px\), \(pointer: coarse\) \{\s*button\.knorke-contextmenu__item \{\s*min-height: var\(--knorke-touch\) !important;\s*\}\s*\}/)
	const base = rules().find((r) => r.selector === 'button.knorke-contextmenu__item' && /min-height: 32px !important/.test(r.body))
	assert.ok(base, 'the desktop size stays 32 px')
	assert.match(css, /--knorke-touch: 44px;/)
})

test('job 227 (round 1): the font size chips (Auto, S, M, L) are finger-sized (--knorke-touch) on phones and coarse pointers, 30 px elsewhere', () => {
	assert.match(css, /@media \(max-width: 600px\), \(pointer: coarse\) \{\s*button\.knorke-chip\[data-knorke-style='style\.fontSize'\] \{\s*min-width: var\(--knorke-touch\) !important;\s*height: var\(--knorke-touch\) !important;\s*\}\s*\}/)
	const chip = bodiesFor('button.knorke-chip').join(';')
	assert.match(chip, /height: 30px !important/, 'with a mouse the chip stays 30 px high')
})
