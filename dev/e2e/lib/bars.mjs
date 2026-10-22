/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The bars check of the stage-3 viewport passes (SPEC-M1 §6.6 narrow layout
 * (5), R16; E28, E31, E33 at 390 × 844 and 820 × 1180):
 *
 * - [data-knorke-bar=top|banner|vote|timer|list] stand at their elements in
 *   every width; only VISIBLE elements are checked, with the VotePanel closed
 * - every pair in which neither element contains the other must not overlap
 *   by more than 0.5 px (DOM a.contains(b) → the pair is skipped: timer lies
 *   in top, list in vote)
 * - every checked element lies completely inside the viewport (0.5 px slack)
 * - in every width (R17 K7: §6.6 (2) docks the VoteBar at the bottom in every
 *   layout, so E28, E31 and E33 check it at 390 × 844 AND 820 × 1180): the
 *   bottom of a visible `vote` ≥ viewport height − 1 px; with
 *   {requireVote: true} a missing visible `vote` is a problem too (a pass
 *   with an open session, so the rule cannot hold by absence)
 * - only at ≤ 600 px (the narrow layout, R16 (1)): at most one visible
 *   banner, and at the start of a session [data-knorke-vote-panel] is open
 *   (R16 (4); the caller passes what it saw before it closed the panel)
 *
 * collectBars() runs IN the page (page.evaluate(collectBars)); checkBars()
 * is pure, so dev/e2e/bars.test.mjs pins the rules on the host.
 */

/** The bar names of §6.8 (R2/R16). */
export const BAR_NAMES = Object.freeze(['top', 'banner', 'vote', 'timer', 'list'])
/** Overlap and viewport slack in CSS px (§6.6 (5)). */
export const SLACK = 0.5
/** The VoteBar docks at the bottom: its bottom edge ≥ viewport height − this many CSS px (§6.6 (5), R17 K7). */
export const BOTTOM_SLACK = 1
/** The narrow layout: window width ≤ 600 CSS px (§6.6 (1)). */
export const NARROW_MAX = 600

/**
 * Runs in the page: every [data-knorke-bar] with its name, box, visibility
 * and the indices of the bars it contains (DOM containment), plus the
 * viewport. No closure over Node values (page.evaluate serialises it).
 * @return {{vw: number, vh: number, bars: Array<{i: number, name: string, visible: boolean, rect: {x: number, y: number, w: number, h: number}, contains: number[]}>}}
 */
export function collectBars() {
	const els = [...document.querySelectorAll('[data-knorke-bar]')]
	const seen = (el) => {
		const r = el.getBoundingClientRect()
		if (!(r.width > 0 && r.height > 0)) return false
		for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
			const cs = getComputedStyle(n)
			if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
		}
		return true
	}
	return {
		vw: window.innerWidth,
		vh: window.innerHeight,
		bars: els.map((el, i) => {
			const r = el.getBoundingClientRect()
			return {
				i,
				name: el.getAttribute('data-knorke-bar'),
				visible: seen(el),
				rect: { x: r.left, y: r.top, w: r.width, h: r.height },
				contains: els.flatMap((o, j) => (j !== i && el.contains(o) ? [j] : [])),
			}
		}),
	}
}

/** Overlap of two boxes along both axes (> 0 means they intersect). */
export function overlap(a, b) {
	const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
	return { x: ox, y: oy }
}

/**
 * The problems of one bars snapshot (empty = the layout holds).
 * @param {{vw: number, vh: number, bars: Array<{i: number, name: string, visible: boolean, rect: object, contains: number[]}>}} snap collectBars()
 * @param {{panelOpenAtStart?: boolean|null, requireVote?: boolean}} [o] panelOpenAtStart: was
 *   [data-knorke-vote-panel] open right after the session started (narrow
 *   layout only; null = no session start in this check); requireVote: a
 *   session is open, so a visible [data-knorke-bar=vote] must exist
 * @return {string[]}
 */
export function checkBars(snap, { panelOpenAtStart = null, requireVote = false } = {}) {
	const out = []
	if (!snap || !Array.isArray(snap.bars) || !(snap.vw > 0) || !(snap.vh > 0)) return ['keine Bars-Messung']
	for (const b of snap.bars) if (!BAR_NAMES.includes(b.name)) out.push(`unbekannter Bar-Name "${b.name}"`)
	const vis = snap.bars.filter((b) => b.visible && BAR_NAMES.includes(b.name))
	if (!vis.some((b) => b.name === 'top')) out.push('keine sichtbare [data-knorke-bar=top]')
	const contains = (a, b) => a.contains.includes(b.i) || b.contains.includes(a.i)
	for (let i = 0; i < vis.length; i++) {
		for (let j = i + 1; j < vis.length; j++) {
			const [a, b] = [vis[i], vis[j]]
			if (contains(a, b)) continue
			const o = overlap(a.rect, b.rect)
			if (o.x > SLACK && o.y > SLACK) out.push(`${a.name}#${a.i} überlappt ${b.name}#${b.i} (${o.x.toFixed(1)} × ${o.y.toFixed(1)} px)`)
		}
	}
	for (const b of vis) {
		const r = b.rect
		if (r.x < -SLACK || r.y < -SLACK || r.x + r.w > snap.vw + SLACK || r.y + r.h > snap.vh + SLACK) {
			out.push(`${b.name}#${b.i} liegt nicht ganz im Viewport (${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.w.toFixed(1)} × ${r.h.toFixed(1)} in ${snap.vw} × ${snap.vh})`)
		}
	}
	// R17 K7: the VoteBar docks at the bottom in every layout (§6.6 (2)), so in both test viewports
	const votes = vis.filter((b) => b.name === 'vote')
	if (requireVote && votes.length === 0) out.push('keine sichtbare [data-knorke-bar=vote] (Sitzung offen)')
	for (const v of votes) {
		if (v.rect.y + v.rect.h < snap.vh - BOTTOM_SLACK) out.push(`vote endet bei ${(v.rect.y + v.rect.h).toFixed(1)} px, nicht unten (${snap.vw} × ${snap.vh})`)
	}
	if (snap.vw <= NARROW_MAX) {
		const banners = vis.filter((b) => b.name === 'banner')
		if (banners.length > 1) out.push(`Schmal-Layout: ${banners.length} sichtbare Banner (höchstens einer)`)
		if (panelOpenAtStart === false) out.push('Schmal-Layout: [data-knorke-vote-panel] beim Sitzungsbeginn nicht offen')
	}
	return out
}
