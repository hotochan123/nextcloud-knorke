/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Boards among a team's resources (factory job 222) on a real Nextcloud:
 * only HTTP (Basic auth, OCS-APIRequest: true), no browser page. Nextcloud's
 * Contacts app shows a team's resources from core's OCS team API; it is not
 * installed here, so the case reads that API itself.
 *
 * E89 (1) alice creates "E89 Team-Board"; the bridge creates the harness
 *   team knorke-e2e-e89 (owner alice) and adds bob; alice shares the board
 *   with the team, "Can view".
 *   (2) bob and alice: GET /ocs/v2.php/teams/<T>/resources has exactly one
 *   entry of provider "knorke": id = board id, label = title, an absolute
 *   url on /apps/knorke/b/<id>, provider name "Knorke boards", provider
 *   icon and iconSvg an <svg>.
 *   (3) carol (not in the team): no Knorke entry; GET
 *   /ocs/v2.php/teams/resources/knorke/<id> gives her no team, bob team T
 *   with the board among its resources.
 *   (4) alice removes the team share: bob's list has no Knorke entry.
 *   (5) shared again, Circles off: bob's list answers below 500 without a
 *   Knorke entry, alice's board list 200; Circles on again: bob's entry is
 *   back.
 *
 * Switches Circles (world.switch, put back by cleanup), so it runs with the
 * cases after E16: after E36, before M01. Check labels start with exactly
 * ONE owner (SPEC-M1 §9.6): [B] server, [D] a harness precondition.
 */
import { BASE, api, passOf, listBoards } from '../lib/harness.mjs'

const TITLE = 'E89 Team-Board'
const TEAM = 'knorke-e2e-e89'

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

/** The Knorke entries among the resources of `team` as `user`: { status, list, text }. */
async function knorkeResources(user, team) {
	const r = await ocs(user, `/teams/${encodeURIComponent(team)}/resources`)
	const all = Array.isArray(r.data?.resources) ? r.data.resources : []
	return { status: r.status, list: all.filter((x) => x?.provider?.id === 'knorke'), text: r.text }
}

/** Is `e` the resource of board `board`? */
function entryOk(e, board) {
	return !!e && e.id === String(board) && e.label === TITLE && typeof e.url === 'string'
		&& /^https?:\/\/[^/]+/.test(e.url) && new RegExp(`/apps/knorke/b/${board}$`).test(e.url)
		&& e.provider?.name === 'Knorke boards' && /^<svg /.test(e.provider?.icon || '') && /^<svg /.test(e.iconSvg || '')
}

const brief = (e) => (e ? { id: e.id, label: e.label, url: e.url, provider: e.provider?.name, icon: (e.provider?.icon || '').slice(0, 20), iconSvg: (e.iconSvg || '').slice(0, 20) } : e)

export const E89 = {
	id: 'E89',
	title: 'Team-Ressourcen (Job 222): ein mit einem Team geteiltes Board steht unter den Ressourcen des Teams, nur für Mitglieder, die es öffnen dürfen; weg ohne Freigabe und mit Circles aus',
	async run(t, world) {
		t.step('(1) alice: Board, Team mit bob, Freigabe „Can view“ an das Team')
		const board = await world.board(TITLE)
		const tc = await world.switch('team-create', TEAM)
		const T = tc?.singleId
		t.must(/^[A-Za-z0-9]{31}$/.test(T || ''), '[D] Vorbedingung: Harness-Team knorke-e2e-e89 angelegt (Besitzerin alice)', tc)
		const tm = await world.switch('team-member', T, 'bob')
		t.must(JSON.stringify(tm?.members || '').includes('bob'), '[D] Vorbedingung: bob ist Mitglied des Teams', tm)
		const share = () => api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: [{ kind: 'team', id: T, role: 'view' }] })
		let sh = await share()
		t.must(sh.status === 200, '[D] alice gibt das Board für das Team mit „Can view“ frei', { status: sh.status, text: sh.text.slice(0, 200) })

		t.step('(2) bob und alice sehen das Board unter den Ressourcen des Teams')
		const b1 = await knorkeResources('bob', T)
		t.check(b1.status === 200 && b1.list.length === 1 && entryOk(b1.list[0], board), '[B] bob: genau ein Knorke-Eintrag (id, Titel, absolute url, „Knorke boards“, Symbole als <svg>)', { status: b1.status, list: b1.list.map(brief), text: b1.status === 200 ? undefined : b1.text })
		const a1 = await knorkeResources('alice', T)
		t.check(a1.status === 200 && a1.list.length === 1 && entryOk(a1.list[0], board), '[B] alice (Besitzerin, Mitglied): derselbe Eintrag', { status: a1.status, list: a1.list.map(brief) })

		t.step('(3) carol ist nicht im Team: kein Eintrag, kein Team für das Board')
		const c1 = await knorkeResources('carol', T)
		t.check(c1.status < 500 && c1.list.length === 0, '[B] carol: kein Knorke-Eintrag unter den Ressourcen des Teams', { status: c1.status, list: c1.list.map(brief) })
		const c2 = await ocs('carol', `/teams/resources/knorke/${board}`)
		const cTeams = Array.isArray(c2.data?.teams) ? c2.data.teams : null
		t.check(c2.status === 200 && cTeams !== null && cTeams.length === 0, '[B] carol: teams/resources/knorke/<id> ohne Team', { status: c2.status, teams: cTeams, text: c2.text })
		const b2 = await ocs('bob', `/teams/resources/knorke/${board}`)
		const bTeams = Array.isArray(b2.data?.teams) ? b2.data.teams : []
		const bt = bTeams.find((x) => x?.teamId === T)
		t.check(b2.status === 200 && bTeams.length === 1 && !!bt && (bt.resources || []).some((e) => e?.provider?.id === 'knorke' && entryOk(e, board)),
			'[B] bob: teams/resources/knorke/<id> nennt das Team mit dem Board unter resources', { status: b2.status, teams: bTeams.map((x) => ({ teamId: x?.teamId, resources: (x?.resources || []).map(brief) })), text: b2.text })

		t.step('(4) alice nimmt die Team-Freigabe weg')
		sh = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: [] })
		t.must(sh.status === 200, '[D] alice entfernt die Team-Freigabe', { status: sh.status, text: sh.text.slice(0, 200) })
		const b3 = await knorkeResources('bob', T)
		t.check(b3.status === 200 && b3.list.length === 0, '[B] bob: ohne Freigabe kein Knorke-Eintrag mehr', { status: b3.status, list: b3.list.map(brief) })

		t.step('(5) wieder freigegeben, dann Circles aus und wieder an')
		sh = await share()
		t.must(sh.status === 200, '[D] alice gibt das Board wieder für das Team frei', { status: sh.status, text: sh.text.slice(0, 200) })
		const off = await world.switch('circles', 'off')
		t.must(off?.enabled === false, '[D] Vorbedingung: Circles ist aus', off)
		const b4 = await knorkeResources('bob', T)
		t.check(b4.status < 500 && b4.list.length === 0, '[B] Circles aus: bob bekommt keinen Knorke-Eintrag und keinen Serverfehler', { status: b4.status, list: b4.list.map(brief), text: b4.text })
		let listOk = true
		try { await listBoards('alice') } catch (e) { listOk = String(e.message) }
		t.check(listOk === true, '[B] Circles aus: alices Board-Liste antwortet 200', listOk)
		const on = await world.switch('circles', 'on')
		t.must(on?.enabled === true, '[D] Vorbedingung: Circles ist wieder an', on)
		const b5 = await knorkeResources('bob', T)
		t.check(b5.status === 200 && b5.list.length === 1 && entryOk(b5.list[0], board), '[B] Circles wieder an: bobs Eintrag ist wieder da', { status: b5.status, list: b5.list.map(brief) })
	},
}
