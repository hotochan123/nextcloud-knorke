/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Sketches of the board list (factory job 221, AK8).
 *
 * E88 alice with two boards of her own: S "E88 Skizze", seeded through
 * /sync with a frame, a note inside it and a note beside it (two colours,
 * texts that must never show) and a connector between the notes; E "E88
 * Leer" stays empty. Steps:
 *   (1) the server: route 57 answers S with exactly 3 entries (the frame
 *       first, '' as its fill; both note colours), no text of the board in
 *       the answer; E with []; bob (no access) and an unknown id get the
 *       same 404 not_found;
 *   (2) alice (Chromium 1440 × 900) opens the board list: S's row shows
 *       svg[data-knorke-sketch] inside its link with 3 rects, one of them in
 *       the note colour, nothing but rects and no text in it; (job 232)
 *       the card's picture at least 240 px wide at 240 : 150; E's card
 *       keeps the board icon in a place of the same size;
 *   (3) alice on a phone 390 × 844 with a finger: S's picture at 240 : 150
 *       inside its card and the screen, the title keeps room (the star
 *       moved into the sheet, E87 (6)).
 * Own boards, no instance setting: after E87, before E09.
 * Flake gate: --only E88 --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [C] the board
 * list in the browser, [B] a server answer, [D] a harness precondition.
 * Waiting polls from Node with until() (Nextcloud's CSP, ENTWICKLUNG trap
 * 9.10).
 */
import { APP, PHONE, api, put, seedOps, ulid, until } from '../lib/harness.mjs'

const TITLE_S = 'E88 Skizze'
const TITLE_E = 'E88 Leer'
const SECRET = 'E88 Geheimtext'
const FILL_IN = '#ffd6a5'
const FILL_OUT = '#a5d8ff'
const LIST = '[data-knorke=board-list]'
/** (job 232) The card's picture: at least this wide, at this ratio. */
const CARD = { minW: 240, ratio: 240 / 150 }
/** The box is a card's picture: wide enough, at 240 : 150 (± 0.02). */
const cardPicture = (b, minW = CARD.minW) => !!b && b.w >= minW - 0.5 && Math.abs(b.w / b.h - CARD.ratio) <= 0.02

/** Opens the board list and waits for its rows. */
async function openList(page) {
	await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
	await page.locator(LIST).first().waitFor({ state: 'attached', timeout: 15000 })
	return until(async () => (await page.locator('[data-knorke-board]').count()) > 0, { timeout: 10000 })
}

/** What the browser shows as the picture of a row. */
const picture = (page, id) => page.locator(`[data-knorke-board="${id}"]`).first().evaluate((row) => {
	const link = row.querySelector('a.knorke-list__link')
	const svg = link?.querySelector('svg[data-knorke-sketch]') ?? null
	const place = link?.querySelector('.knorke-list__icon')
	const r = place?.getBoundingClientRect()
	return {
		sketch: !!svg,
		rects: svg ? svg.querySelectorAll('rect').length : 0,
		tags: svg ? [...svg.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()) : [],
		fills: svg ? [...svg.querySelectorAll('rect')].map((e) => e.getAttribute('fill')) : [],
		text: svg ? svg.textContent : '',
		hidden: svg ? svg.getAttribute('aria-hidden') : null,
		icon: !!place && !svg && !!place.querySelector('svg'),
		box: r ? { w: r.width, h: r.height, x: r.left, right: r.right } : null,
	}
}).catch(() => null)

/** Bounding box of the first match (null when absent). */
const box = (page, sel) => page.locator(sel).first().boundingBox().catch(() => null)

export const E88 = {
	id: 'E88',
	title: 'Skizzen der Boardliste (Job 221, Job 232): eine Karte zeigt Frames und farbige Kästen ihres Boards ohne Text, ein leeres Board das Icon, Route 57 antwortet nur Berechtigten',
	async run(t, world) {
		const S = await world.board(TITLE_S)
		const E = await world.board(TITLE_E)
		const F = ulid()
		const N1 = ulid()
		const N2 = ulid()
		const res = await seedOps('alice', S, [
			put.frame(F, { x: 0, y: 0, w: 800, h: 600, data: { title: SECRET } }),
			put.sticky(N1, { x: 100, y: 100, parent: F, data: { text: SECRET }, style: { fill: FILL_IN } }),
			put.sticky(N2, { x: 1000, y: 200, data: { text: SECRET }, style: { fill: FILL_OUT } }),
			put.connector(ulid(), { item: N1 }, { item: N2 }, { data: { label: SECRET } }),
		])
		t.must(res.length === 4 && res.every((r) => r === 'ok'), '[D] Vorbedingung: Frame, zwei Notizen und ein Verbinder liegen auf S', res)

		t.step('(1) Route 57: S mit 3 Einträgen ohne Text, E leer, Fremde 404')
		const s = await api('alice', 'GET', `/api/v1/boards/${S}/sketch`)
		const sk = s.data?.sketch
		t.check(s.status === 200 && Array.isArray(sk) && sk.length === 3, '[B] (1) S hat genau 3 Einträge: Frame und zwei Notizen, kein Verbinder', s.text.slice(0, 300))
		t.check(Array.isArray(sk) && sk[0]?.[4] === '' && sk.slice(1).map((e) => e[4]).sort().join() === [FILL_IN, FILL_OUT].sort().join(), '[B] (1) der Frame zuerst ohne Füllung, dann die zwei Notizfarben', sk)
		t.check(!s.text.includes('Geheim'), '[B] (1) kein Text des Boards in der Antwort', s.text.slice(0, 300))
		const e = await api('alice', 'GET', `/api/v1/boards/${E}/sketch`)
		t.check(e.status === 200 && JSON.stringify(e.data) === '{"sketch":[]}', '[B] (1) das leere Board hat keine Skizze', e.text.slice(0, 200))
		const stranger = await api('bob', 'GET', `/api/v1/boards/${S}/sketch`)
		const unknown = await api('bob', 'GET', '/api/v1/boards/999999999/sketch')
		t.check(stranger.status === 404 && stranger.data?.error === 'not_found', '[B] (1) bob ohne Zugriff bekommt 404 not_found', stranger.text.slice(0, 200))
		t.check(unknown.status === 404 && stranger.text === unknown.text, '[B] (1) ein unbekanntes Board antwortet genauso', { stranger: stranger.text, unknown: unknown.text })

		const a = await world.actor('alice-sketches', { user: 'alice' })
		const pa = a.page
		try {
			t.step('(2) Boardliste: Skizze in der Zeile von S, Icon bei E')
			t.must(await openList(pa), '[D] Vorbedingung: die Boardliste zeigt Zeilen')
			t.check(await until(async () => (await picture(pa, S))?.sketch === true, { timeout: 10000 }), '[C] (2) die Zeile von S zeigt svg[data-knorke-sketch] im Link', await picture(pa, S))
			const ps = await picture(pa, S)
			t.check(ps?.rects === 3 && ps.tags.every((x) => x === 'rect'), '[C] (2) die Skizze besteht aus genau 3 Rechtecken und sonst nichts', ps)
			t.check(ps?.fills.includes(FILL_IN) && ps.fills.includes(FILL_OUT), '[C] (2) die Notizen stehen in ihren Farben da', ps?.fills)
			t.check(ps?.text === '' && ps.hidden === 'true', '[C] (2) kein Text in der Skizze, aria-hidden', ps)
			t.check(cardPicture(ps?.box), '[C] (2) das Bild der Karte ist ≥ 240 px breit im Verhältnis 240 : 150 (Job 232)', ps?.box)
			const html = await pa.locator(`[data-knorke-board="${S}"]`).first().innerHTML().catch(() => '')
			t.check(!html.includes('Geheim'), '[C] (2) kein Text des Boards in der Zeile', html.slice(0, 300))
			const pe = await picture(pa, E)
			t.check(pe?.sketch === false && pe.icon === true, '[C] (2) das leere Board zeigt das Board-Icon', pe)
			t.check(cardPicture(pe?.box) && Math.abs(pe.box.w - ps.box.w) <= 1, '[C] (2) das Icon steht in einem gleich großen Platz', { icon: pe?.box, sketch: ps?.box })
		} finally {
			await world.drop(a)
		}

		const p = await world.actor('alice-sketches-phone', { user: 'alice', touch: true, viewport: PHONE })
		const pp = p.page
		try {
			t.step('(3) Telefon 390 × 844: Bild 240 : 150 in Karte und Bild, Titel mit Platz')
			t.must(await openList(pp), '[D] Vorbedingung: die Boardliste zeigt auf dem Telefon Zeilen')
			t.check(await until(async () => (await picture(pp, S))?.sketch === true, { timeout: 10000 }), '[C] (3) die Skizze erscheint auch auf dem Telefon', await picture(pp, S))
			const ps = await picture(pp, S)
			const row = await box(pp, `[data-knorke-board="${S}"]`)
			t.check(cardPicture(ps?.box, 100) && !!row && ps.box.x >= row.x - 0.5 && ps.box.right <= row.x + row.width + 0.5 && ps.box.right <= PHONE.width,
				'[C] (3) das Bild steht im Verhältnis 240 : 150 in seiner Karte und im Bild', { picture: ps?.box, row })
			const title = await box(pp, `[data-knorke-board="${S}"] .knorke-list__title`)
			t.check(title && title.width >= 60, '[C] (3) der Titel behält Platz', title)
		} finally {
			await world.drop(p)
		}
	},
}
