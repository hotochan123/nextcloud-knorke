/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Link previews and the Smart Picker of boards (factory job 157) on a real
 * Nextcloud: only HTTP (Basic auth, OCS-APIRequest: true), no browser page.
 *
 * E58 (1) alice creates "E58 Retro" and seeds 3 notes through /sync.
 *   (2) the unified search /ocs/v2.php/search/providers/knorke/search
 *   gives the board's hit with an absolute resourceUrl U.
 *   (3) /ocs/v2.php/references/resolve?reference=U gives alice the card:
 *   openGraphObject name "E58 Retro", a description with "3 items" and
 *   "by ", thumb the board's sketch (job 236: a data:image/svg+xml;base64
 *   picture of the board colour and the 3 notes, no note text), link U; the
 *   same for U in its other form (with or without /index.php), still with
 *   link U.
 *   (4) bob without a share gets null for U; after a share "Can view" he
 *   gets the card.
 *   (5) with the edit link on, …/p/<token> and …/join/<token> resolve to
 *   null for alice and bob (no card, and no OpenGraph card of the link page).
 *   (6) /ocs/v2.php/references/providers lists "knorke" for alice with
 *   search_providers_ids ["knorke"].
 *
 * Own board, no instance setting: before E09, after E57. Check labels start
 * with exactly ONE owner (SPEC-M1 §9.6): [B] server, [D] a harness
 * precondition.
 */
import { BASE, api, put, ulid, seedOps, passOf } from '../lib/harness.mjs'

const TITLE = 'E58 Retro'

/** An OCS request of core as `user` (Basic auth, OCS-APIRequest: true); data is ocs.data. */
async function ocs(user, path) {
	const r = await fetch(BASE + '/ocs/v2.php' + path, {
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${user}:${passOf(user)}`).toString('base64'),
			'OCS-APIRequest': 'true',
			Accept: 'application/json',
		},
	})
	const text = await r.text()
	let data
	try { data = JSON.parse(text)?.ocs?.data } catch { /* not JSON */ }
	return { status: r.status, data, text: text.slice(0, 300) }
}

/** The card Nextcloud resolves for `reference` as `user`: { status, ref } (ref null = no card). */
async function resolve(user, reference) {
	const r = await ocs(user, `/references/resolve?reference=${encodeURIComponent(reference)}`)
	const refs = r.data?.references
	const ok = r.status === 200 && refs && typeof refs === 'object' && Object.hasOwn(refs, reference)
	return { status: r.status, ok, ref: ok ? refs[reference] : undefined, text: r.text }
}

/** The board address in its other form: with /index.php ↔ without. */
function otherForm(u) {
	return u.includes('/index.php/apps/knorke/') ? u.replace('/index.php/apps/knorke/', '/apps/knorke/') : u.replace('/apps/knorke/', '/index.php/apps/knorke/')
}

const SKETCH = 'data:image/svg+xml;base64,'
const NOTES = ['Gut', 'Schlecht', 'Ideen']

/** The SVG of a sketch thumb (job 236), else null. */
function sketchSvg(thumb) {
	return typeof thumb === 'string' && thumb.startsWith(SKETCH) ? Buffer.from(thumb.slice(SKETCH.length), 'base64').toString('utf8') : null
}

/** The board's sketch: an SVG of the board colour and the 3 notes as rects, none of their texts. */
function sketchOk(thumb) {
	const svg = sketchSvg(thumb)
	return !!svg && svg.startsWith('<svg') && (svg.match(/<rect /g) || []).length === 4 && NOTES.every((w) => !svg.includes(w))
}

/** Does the card fit "E58 Retro" with 3 items, its sketch and link `u`? */
function cardOk(ref, u) {
	const og = ref?.openGraphObject
	return !!og && og.name === TITLE && typeof og.description === 'string' && og.description.includes('3 items') && og.description.includes('by ')
		&& sketchOk(og.thumb) && og.link === u
}

const brief = (ref) => (ref ? { name: ref.openGraphObject?.name, description: ref.openGraphObject?.description, thumb: sketchSvg(ref.openGraphObject?.thumb) ?? ref.openGraphObject?.thumb, link: ref.openGraphObject?.link } : ref)

export const E58 = {
	id: 'E58',
	title: 'Linkvorschau und Smart Picker (Job 157): die Suche liefert die absolute Board-Adresse, die Karte nur mit Zugang (beide Adressformen), keine Karte für Bearbeitungs- und Beitrittslinks, „Knorke boards“ in den Picker-Anbietern',
	async run(t, world) {
		t.step('(1) alice legt „E58 Retro“ an und füllt es mit 3 Notizen')
		const board = await world.board(TITLE)
		const res = await seedOps('alice', board, [
			put.sticky(ulid(), { x: 0, y: 0, data: { text: 'Gut' } }),
			put.sticky(ulid(), { x: 240, y: 0, data: { text: 'Schlecht' } }),
			put.sticky(ulid(), { x: 480, y: 0, data: { text: 'Ideen' } }),
		])
		t.must(res.length === 3 && res.every((x) => x === 'ok'), '[D] Vorbedingung: 3 Notizen auf dem Board', res)

		t.step('(2) die Suche liefert eine absolute Adresse U')
		const s = await ocs('alice', `/search/providers/knorke/search?term=${encodeURIComponent(TITLE)}&limit=5`)
		const hit = (s.data?.entries || []).find((e) => e.title === TITLE)
		const U = hit?.resourceUrl
		t.must(s.status === 200 && typeof U === 'string', '[B] die Suche nach „E58 Retro“ findet das Board', { status: s.status, text: s.text })
		t.check(/^https?:\/\/[^/]+/.test(U) && new RegExp(`/apps/knorke/b/${board}$`).test(U), '[B] resourceUrl ist absolut und zeigt auf das Board', U)

		t.step('(3) alice bekommt die Karte für U und für die andere Form von U')
		const a1 = await resolve('alice', U)
		t.check(a1.ok && cardOk(a1.ref, U), '[B] alice: Karte für U (Titel, „3 items“, „by “, Skizze mit 3 Notizen ohne Text, link U)', { status: a1.status, ref: brief(a1.ref), text: a1.ok ? undefined : a1.text })
		const U2 = otherForm(U)
		const a2 = await resolve('alice', U2)
		t.check(U2 !== U && a2.ok && cardOk(a2.ref, U), '[B] alice: dieselbe Karte für die andere Form von U, link bleibt U', { U2, status: a2.status, ref: brief(a2.ref) })

		t.step('(4) bob ohne Freigabe: keine Karte; nach „Can view“: die Karte')
		const b1 = await resolve('bob', U)
		t.check(b1.ok && b1.ref === null, '[B] bob ohne Freigabe: null für U', { status: b1.status, ref: brief(b1.ref) })
		const sh = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: [{ kind: 'user', id: 'bob', role: 'view' }] })
		t.must(sh.status === 200, '[D] alice gibt das Board für bob mit „Can view“ frei', { status: sh.status, text: sh.text.slice(0, 200) })
		const b2 = await resolve('bob', U)
		t.check(b2.ok && cardOk(b2.ref, U), '[B] bob mit „Can view“: die Karte für U', { status: b2.status, ref: brief(b2.ref) })

		t.step('(5) Bearbeitungslink an: /p/… und /join/… ergeben für alice und bob null')
		const lk = await api('alice', 'POST', `/api/v1/boards/${board}/link`, {})
		const token = lk.data?.link?.token
		t.must(lk.status === 200 && /^[A-Za-z0-9]{24}$/.test(token || ''), '[D] der Bearbeitungslink ist an', { status: lk.status, text: lk.text.slice(0, 200) })
		const app = U.replace(/\/b\/\d+$/, '')
		for (const link of [`${app}/p/${token}`, `${app}/join/${token}`]) {
			for (const user of ['alice', 'bob']) {
				const r = await resolve(user, link)
				const kind = link.includes('/join/') ? '/join/…' : '/p/…'
				t.check(r.ok && r.ref === null, `[B] ${user}: null für ${kind}`, { status: r.status, ref: brief(r.ref), text: r.ok ? undefined : r.text })
			}
		}

		t.step('(6) „Knorke boards“ in den Anbietern des Smart Pickers')
		const pv = await ocs('alice', '/references/providers')
		const entry = Array.isArray(pv.data) ? pv.data.find((p) => p?.id === 'knorke') : undefined
		t.check(pv.status === 200 && Array.isArray(entry?.search_providers_ids) && entry.search_providers_ids.length === 1 && entry.search_providers_ids[0] === 'knorke',
			'[B] references/providers enthält für alice „knorke“ mit search_providers_ids ["knorke"]', { status: pv.status, entry, text: entry ? undefined : pv.text })
		t.check(entry?.title === 'Knorke boards' && entry?.order === 10 && /^https?:\/\/.+\/img\/app-dark\.svg$/.test(entry?.icon_url || ''),
			'[B] der Eintrag: Titel „Knorke boards“, order 10, absolutes app-dark.svg', entry)
	},
}
