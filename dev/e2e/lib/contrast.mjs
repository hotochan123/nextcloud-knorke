/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * WCAG contrast of the guest page's empty states (SPEC-M1 §8.4, E15/E16,
 * M0 leftover SPEC-M0 §16.2): name and description of the NcEmptyContent
 * inside .knorke-public__card against the card's background, composited over
 * black AND over white (the theming background behind the card can be any
 * image or colour, so both extremes are the worst case). The page side only
 * reads computed styles (probeContrast); everything else is pure and covered
 * by dev/e2e/contrast.test.mjs.
 *
 * Model: the colours are painted from the outermost element of the chain
 * (the card) down to the text element. Each element's background is laid
 * over what lies below with its alpha times the product of the opacities from
 * the card down to that element; the text colour is laid over the result with
 * its alpha times the product of all opacities of the chain. WCAG 2.x
 * relative luminance and ratio (sRGB, 0.03928 threshold as in the spec text).
 */

/** Pass mark of SPEC-M1 §8.4 E15/E16: ≥ 4.5:1. */
export const MIN_RATIO = 4.5

const BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 })
const WHITE = Object.freeze({ r: 255, g: 255, b: 255, a: 1 })

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** A CSS number or percentage (of `full`) → number; NaN when malformed. */
function num(s, full) {
	const t = String(s).trim()
	if (/^-?\d*\.?\d+(e-?\d+)?%$/i.test(t)) return (parseFloat(t) / 100) * full
	if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return parseFloat(t)
	if (t === 'none') return 0
	return NaN
}

/**
 * A computed CSS colour → {r, g, b, a} with r/g/b in 0..255 and a in 0..1,
 * or null if the form is not understood (the caller reports that as red,
 * never as a pass). Understands what Chromium's getComputedStyle returns for
 * sRGB colours: rgb()/rgba() with commas or spaces and an optional "/ a",
 * color(srgb r g b [/ a]) (color-mix results), #rgb[a]/#rrggbb[aa] and
 * `transparent`.
 */
export function parseColor(str) {
	if (typeof str !== 'string') return null
	const s = str.trim().toLowerCase()
	if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
	let m = s.match(/^#([0-9a-f]{3,8})$/)
	if (m) {
		let h = m[1]
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
		if (h.length !== 6 && h.length !== 8) return null
		const v = (i) => parseInt(h.slice(i, i + 2), 16)
		return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) / 255 : 1 }
	}
	m = s.match(/^rgba?\((.*)\)$/)
	if (m) {
		const [main, alpha] = m[1].split('/')
		const parts = main.includes(',') ? main.split(',') : main.trim().split(/\s+/)
		let a = 1
		if (alpha !== undefined) {
			if (main.includes(',') || parts.length !== 3) return null
			a = num(alpha, 1)
		} else if (parts.length === 4) {
			a = num(parts.pop(), 1)
		}
		if (parts.length !== 3) return null
		const [r, g, b] = parts.map((p) => num(p, 255))
		if (![r, g, b, a].every(Number.isFinite)) return null
		return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) }
	}
	m = s.match(/^color\(\s*srgb\s+(.*)\)$/)
	if (m) {
		const [main, alpha] = m[1].split('/')
		const parts = main.trim().split(/\s+/)
		if (parts.length !== 3) return null
		const [r, g, b] = parts.map((p) => num(p, 1))
		const a = alpha === undefined ? 1 : num(alpha, 1)
		if (![r, g, b, a].every(Number.isFinite)) return null
		return { r: clamp(r, 0, 1) * 255, g: clamp(g, 0, 1) * 255, b: clamp(b, 0, 1) * 255, a: clamp(a, 0, 1) }
	}
	return null
}

/** Source-over: `top` (with its alpha) over an opaque `below`; result opaque. */
export function over(top, below) {
	const a = clamp(top.a, 0, 1)
	return {
		r: top.r * a + below.r * (1 - a),
		g: top.g * a + below.g * (1 - a),
		b: top.b * a + below.b * (1 - a),
		a: 1,
	}
}

/** WCAG 2.x relative luminance of an opaque sRGB colour (0..1). */
export function luminance(c) {
	const lin = (v) => {
		const x = v / 255
		return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** WCAG contrast ratio of two opaque colours (1..21). */
export function contrastRatio(c1, c2) {
	const l1 = luminance(c1)
	const l2 = luminance(c2)
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Readable form of a colour for reports: rgb(…) rounded, alpha only if < 1. */
export function fmtColor(c) {
	if (!c) return 'null'
	const r = Math.round(c.r)
	const g = Math.round(c.g)
	const b = Math.round(c.b)
	return c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${Math.round(c.a * 1000) / 1000})` : `rgb(${r}, ${g}, ${b})`
}

/**
 * Worst-case contrast of one text element.
 * probe = {color, chain: [{bg, opacity}]} with chain[0] = the text element
 * itself and the last entry = the card (outermost), as probeContrast returns
 * it. Returns {ok, ratio, onBlack, onWhite, text, background, error}; `ratio`
 * is the smaller of the two composites, `ok` = ratio ≥ min. A colour that
 * cannot be parsed gives ok false with `error` (never a silent pass).
 */
export function worstContrast(probe, min = MIN_RATIO) {
	const text = parseColor(probe?.color)
	const chain = Array.isArray(probe?.chain) ? probe.chain : []
	if (!text) return { ok: false, ratio: null, error: `Textfarbe nicht lesbar: ${probe?.color}` }
	if (chain.length === 0) return { ok: false, ratio: null, error: 'keine Hintergrundkette (Karte fehlt?)' }
	const layers = []
	for (const el of chain) {
		const bg = parseColor(el.bg)
		const op = Number(el.opacity)
		if (!bg) return { ok: false, ratio: null, error: `Hintergrund nicht lesbar: ${el.bg}` }
		if (!Number.isFinite(op)) return { ok: false, ratio: null, error: `opacity nicht lesbar: ${el.opacity}` }
		layers.push({ bg, opacity: clamp(op, 0, 1) })
	}
	const paint = (base) => {
		let below = base
		let cum = 1
		// outermost (card) first, down to the text element
		for (let i = layers.length - 1; i >= 0; i--) {
			cum *= layers[i].opacity
			below = over({ ...layers[i].bg, a: layers[i].bg.a * cum }, below)
		}
		const fg = over({ ...text, a: text.a * cum }, below)
		return { background: below, fg, ratio: contrastRatio(fg, below) }
	}
	const b = paint(BLACK)
	const w = paint(WHITE)
	const ratio = Math.min(b.ratio, w.ratio)
	return {
		ok: ratio >= min,
		ratio,
		onBlack: b.ratio,
		onWhite: w.ratio,
		text: fmtColor(text),
		background: `${fmtColor(b.background)} | ${fmtColor(w.background)}`,
	}
}

/**
 * Reads, in the page, the computed colours of name and description of the
 * empty state `[data-knorke-banner=<banner>]` and the background chain up to
 * the enclosing .knorke-public__card. Returns {scheme, card, name, description}
 * where name/description are {color, chain} or null when the element is
 * missing, `card` says whether the empty state sits in a card at all, and
 * `scheme` is matchMedia('(prefers-color-scheme: dark)') of the page.
 */
export async function probeContrast(page, banner) {
	return page.evaluate((b) => {
		const root = document.querySelector(`[data-knorke-banner="${b}"]`)
		const card = root ? root.closest('.knorke-public__card') : null
		const read = (sel) => {
			const el = root ? root.querySelector(sel) : null
			if (!el || !card) return null
			const chain = []
			for (let n = el; n; n = n.parentElement) {
				const cs = getComputedStyle(n)
				chain.push({ bg: cs.backgroundColor, opacity: cs.opacity })
				if (n === card) break
			}
			return { color: getComputedStyle(el).color, chain, text: String(el.textContent || '').trim().slice(0, 80) }
		}
		return {
			scheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
			card: Boolean(card),
			name: read('.empty-content__name'),
			description: read('.empty-content__description'),
		}
	}, banner)
}

/**
 * Checks name and description of one empty state in one context and records
 * every result as a check of the scenario `t` (label names banner and
 * scheme). `expectScheme` = 'light' | 'dark' guards against a vacuous pass
 * (the context must really render in that scheme). Returns the ratios.
 */
export async function checkEmptyStateContrast(t, page, banner, expectScheme, label = banner) {
	// the computed colours must have settled (theme stylesheets, transitions):
	// two equal reads 250 ms apart, at most ~5 s
	let p = await probeContrast(page, banner)
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 250))
		const q = await probeContrast(page, banner)
		const same = JSON.stringify(q) === JSON.stringify(p)
		p = q
		if (same) break
	}
	t.check(p.scheme === expectScheme, `${label} (${expectScheme}): Seite rendert im Schema ${expectScheme}`, p.scheme)
	t.check(p.card, `${label} (${expectScheme}): leerer Zustand in .knorke-public__card`)
	const out = {}
	for (const part of ['name', 'description']) {
		const probe = p[part]
		if (!t.check(probe !== null, `${label} (${expectScheme}): ${part} vorhanden`)) continue
		const r = worstContrast(probe)
		out[part] = r.ratio
		const detail = r.error || `${r.ratio.toFixed(2)}:1 (über Schwarz ${r.onBlack.toFixed(2)}, über Weiß ${r.onWhite.toFixed(2)}; Text ${r.text}, Karte ${r.background})`
		t.check(r.ok, `${label} (${expectScheme}): Kontrast ${part} ≥ ${MIN_RATIO}:1`, detail)
		if (typeof t.note === 'function' && r.ratio !== null) t.note(`Kontrast ${label} ${expectScheme} ${part}: ${detail}`)
	}
	return out
}
