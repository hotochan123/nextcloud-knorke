/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E06 fast path, E07 offline, E08 resync, E09 revocation (SPEC-M0 §8.2).
 * DB/Redis steps go through the host bridge (lib/bridge.mjs).
 */
import { bridge } from '../lib/bridge.mjs'
import { SPOTS } from './collab.mjs'
import {
	K, settle, APP, itemMap, createSticky, dragItem, editText, selectItem, until, sleep, sameList, firstDiff, bannerVisible, action,
	fieldValue, field, waitReady,
} from '../lib/harness.mjs'

async function idleAll(s) {
	await settle(s.pages)
}

async function equalAll(t, s, label, timeout = 10000) {
	const lists = await until(async () => {
		const l = await Promise.all(s.pages.map((p) => K.items(p)))
		return l.every((x) => sameList(x, l[0])) ? l : null
	}, { timeout })
	t.check(lists, `${label}: items() überall gleich`)
	if (!lists) return false
	await idleAll(s)
	const server = await K.serverItems(s.alice.page)
	const now = await K.items(s.alice.page)
	t.check(sameList(now, server), `${label}: gleich serverItems()`, firstDiff(now, server))
	return true
}

export const E06 = {
	id: 'E06',
	phase: 2,
	title: 'Fastpath: 15 s Untätigkeit ohne oc_knorke_-SQL; r: wird nach Löschen neu gesät',
	// The 0-SQL gate counts with pg_stat_statements; another database has nothing to count with.
	skipIf: (env) => ((env.db?.kind ?? 'pgsql') === 'pgsql' ? null : `pg_stat_statements gibt es nur mit KD_DB=pgsql (dieser Stack: ${env.db.kind})`),
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob } = s
		t.step('alice schreibt etwas')
		await createSticky(alice.page, SPOTS.e06.x, SPOTS.e06.y, 'Fastpath')
		await idleAll(s)
		await bridge('redis-del-access', s.board)
		await sleep(2000)
		await bridge('pgss-reset')
		const c0 = await Promise.all([K.counters(alice.page), K.counters(bob.page)])
		t.step('15 s Untätigkeit')
		await sleep(15000)
		const pg = await bridge('pgss-count')
		const c1 = await Promise.all([K.counters(alice.page), K.counters(bob.page)])
		const syncs = (c1[0].syncRequests - c0[0].syncRequests) + (c1[1].syncRequests - c0[1].syncRequests)
		t.check(syncs >= 30, '≥ 30 Syncs von alice und bob im Fenster', syncs)
		t.check(Number(pg.total) === 0, '0 Aufrufe von oc_knorke_-Statements', pg)
		const del = await bridge('redis-del-rev', s.board)
		t.check(del.deleted === 1, 'r: war gesetzt und ist gelöscht', del)
		await sleep(2000)
		const g = await bridge('redis-get-rev', s.board)
		t.check(g.key && Number.isInteger(g.value) && g.ttl > 0 && g.ttl <= 30, 'r: wieder gesetzt, TTL ≤ 30', g)
		const st = await Promise.all(s.pages.map((p) => K.state(p)))
		t.check(st.every((x) => x.status === 'online'), 'Clients laufen fehlerfrei weiter', st.map((x) => x.status))
	},
}

export const E07 = {
	id: 'E07',
	title: 'Offline: Banner, Änderungen offline, Löschen + Rückgängig, Abgleich nach Rückkehr',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob } = s
		// n3 is not the note of E04b: its lease may still show for up to 10 s
		const [n1, n2] = s.notes.bob || []
		const n3 = s.notes.gina?.[2]
		const n4 = s.notes.gina?.[1]
		t.must(n1 && n2 && n3 && n4, 'Notizen aus E03 vorhanden')
		await idleAll(s)
		t.step('bob geht offline')
		await bob.ctx.setOffline(true)
		try {
			const tOff = Date.now()
			const banner = await until(() => bannerVisible(bob.page, 'offline'), { timeout: 3500, every: 100 })
			t.check(banner && Date.now() - tOff <= 3500, 'bob: [data-knorke-banner=offline] ≤ 3 s', Date.now() - tOff)
			t.step('bob verschiebt 2 Notizen, ändert einen Text, löscht eine und macht es rückgängig')
			await dragItem(bob.page, n1, { dx: 70, dy: 20 })
			await dragItem(bob.page, n2, { dx: -40, dy: 50 })
			await editText(bob.page, n3, 'offline geschrieben')
			await selectItem(bob.page, n4)
			await bob.page.keyboard.press('Delete')
			await sleep(100)
			await bob.page.keyboard.press('Control+z')
			const bobView = await itemMap(bob.page)
			t.check(bobView.has(n4), 'bob: gelöschte Notiz nach Strg+Z wieder sichtbar')
			t.step('alice legt eine Notiz an')
			const na = await createSticky(alice.page, SPOTS.e07.x, SPOTS.e07.y, 'während bob offline')
			await sleep(Math.max(0, 5000 - (Date.now() - tOff)))
			await bob.ctx.setOffline(false)
			const tBack = Date.now()
			const ok = await until(async () => {
				const l = await Promise.all(s.pages.map((p) => K.items(p)))
				return l.every((x) => sameList(x, l[0]))
			}, { timeout: 5000, every: 100 })
			t.check(ok, '≤ 5 s nach der Rückkehr: items() überall gleich', Date.now() - tBack)
			await equalAll(t, s, 'E07', 10000)
			const am = await itemMap(alice.page)
			for (const id of [n1, n2, n3]) {
				const a = am.get(id)
				const b = bobView.get(id)
				t.check(a && b && a.x === b.x && a.y === b.y && a.parent === b.parent && a.data?.text === b.data?.text, `bobs Änderung an ${id.slice(-4)} bei alice`, { alice: a, bob: b })
			}
			t.check(am.has(n4), 'gelöschte-und-wiederhergestellte Notiz lebt überall')
			t.check(am.has(na) && (await itemMap(bob.page)).has(na), 'alices neue Notiz bei bob')
			t.check(!(await bannerVisible(bob.page, 'offline')), 'Offline-Banner wieder weg')
		} finally {
			// an aborted step must not leave bob offline for the following scenarios
			await bob.ctx.setOffline(false)
		}
	},
}

export const E08 = {
	id: 'E08',
	phase: 2,
	title: 'Resync: Cursor aus der Zukunft; set-min-rev → genau ein Resync, dann Konvergenz',
	async run(t, world) {
		const s = await world.shared(t)
		const { bob } = s
		await idleAll(s)
		t.step('(a) bob: setCursor(cursor + 1000)')
		const r0 = (await K.counters(bob.page)).resyncs
		const cur = (await K.state(bob.page)).cursor
		await K.setCursor(bob.page, cur + 1000)
		await until(async () => (await K.counters(bob.page)).resyncs > r0, { timeout: 8000 })
		await sleep(3000)
		const r1 = (await K.counters(bob.page)).resyncs
		t.check(r1 === r0 + 1, '(a) resyncs genau +1', { r0, r1 })
		await equalAll(t, s, '(a)')
		t.step('(b) set-min-rev')
		const before = await Promise.all(s.pages.map((p) => K.counters(p)))
		const res = await bridge('set-min-rev', s.board)
		t.check(res.row && res.row.rev === res.row.min_rev, 'set-min-rev: rev = min_rev', res)
		await until(async () => {
			const c = await Promise.all(s.pages.map((p) => K.counters(p)))
			return c.every((x, i) => x.resyncs > before[i].resyncs)
		}, { timeout: 10000 })
		await sleep(3000)
		const after = await Promise.all(s.pages.map((p) => K.counters(p)))
		t.check(after.every((x, i) => x.resyncs === before[i].resyncs + 1), '(b) resyncs je Seite genau +1', { before: before.map((x) => x.resyncs), after: after.map((x) => x.resyncs) })
		await equalAll(t, s, '(b)')
	},
}

export const E09 = {
	id: 'E09',
	title: 'Widerruf: Link erneuern → Gina revoked, bob gone, Ruhe; alte Seite ohne Drossel, neuer Link geht',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice, bob, gina } = s
		const extra = []
		try {
			await idleAll(s)
			t.step('alice erneuert den Link')
			const tStart = Date.now()
			await action(alice.page, 'share')
			await action(alice.page, 'link-rotate')
			await action(alice.page, 'confirm')
			const tRot = Date.now()
			const newUrl = await until(async () => {
				const v = await fieldValue(alice.page, 'link-url').catch(() => '')
				return /\/p\/[A-Za-z0-9]{24}$/.test(v) && !v.endsWith(s.token) ? v : null
			}, { timeout: 10000 })
			t.check(newUrl, 'neue Link-URL', newUrl)
			await alice.page.keyboard.press('Escape')
			const banners = await until(async () => (await bannerVisible(gina.page, 'revoked')) && (await bannerVisible(bob.page, 'gone')), { timeout: 3500, every: 100 })
			t.check(banners && Date.now() - tRot <= 3500, '≤ 3 s: Gina revoked, bob gone', Date.now() - tRot)
			const [gs, bs] = await Promise.all([K.state(gina.page), K.state(bob.page)])
			t.check(gs.status === 'revoked' && bs.status === 'gone', 'state().status passt', { gina: gs.status, bob: bs.status })
			const tq = Date.now()
			const c0 = await Promise.all([K.counters(gina.page), K.counters(bob.page)])
			await sleep(5000)
			const c1 = await Promise.all([K.counters(gina.page), K.counters(bob.page)])
			const reqs = [...gina.requestsSince(tq, /\/(sync|join)$/), ...bob.requestsSince(tq, /\/(sync|join)$/)]
			t.check(c1[0].syncRequests === c0[0].syncRequests && c1[1].syncRequests === c0[1].syncRequests && reqs.length === 0, 'danach 5 s keine /sync- oder Beitritts-Anfragen', { c0, c1, reqs: reqs.length })
			// SPEC-M1 §1.2 (R23), job 028: the bundle sends X-Knorke-End-State, so
			// Gina's sync and her automatic re-join get the end state with 200; an
			// edge ban rule sees no 401/403 from her
			const gReqs = gina.requestsSince(tStart, /\/(sync|join)$/)
			const answered = gReqs.filter((x) => x.status !== null)
			const shown = answered.map((x) => `${x.method} ${x.url.replace(/^.*\/apps\/knorke/, '')} ${x.status}`)
			t.check(answered.length > 0 && answered.every((x) => x.status === 200), 'Ginas /sync- und /join-Anfragen mit Antwort: alle 200 (Endzustand im Body)', shown)
			const syncs = answered.filter((x) => /\/sync$/.test(x.url)).length
			const joins = answered.filter((x) => /\/join$/.test(x.url)).length
			t.check(syncs >= 1 && joins === 1, 'darunter mindestens ein /sync und genau ein /join (der automatische Neu-Beitritt)', { syncs, joins })
			t.check(!gReqs.some((x) => x.status === 401 || x.status === 403), 'keine Antwort 401 oder 403 an Gina', shown)
			t.step('Gina und zwei weitere Gäste laden die alte Link-Seite')
			const oldUrl = `${APP}/p/${s.token}`
			const g2 = await world.actor('gast2')
			const g3 = await world.actor('gast3')
			extra.push(g2, g3)
			for (const [name, a] of [['Gina', gina], ['Gast 2', g2], ['Gast 3', g3]]) {
				const r = await a.page.goto(oldUrl, { waitUntil: 'domcontentloaded' })
				const b = await until(() => bannerVisible(a.page, 'revoked'), { timeout: 10000 })
				t.check(r && r.status() === 200 && b, `${name}: alte Seite → 200 mit [data-knorke-banner=revoked]`, r && r.status())
			}
			t.step('neuer Gast mit dem neuen Link')
			const g4 = await world.actor('gast4')
			extra.push(g4)
			const newToken = String(newUrl || '').match(/\/p\/([A-Za-z0-9]{24})$/)?.[1]
			const r4 = await g4.page.goto(`${APP}/p/${newToken}`, { waitUntil: 'domcontentloaded' })
			t.check(r4 && r4.status() === 200, 'neuer Link → 200 (kein 429)', r4 && r4.status())
			await field(g4.page, 'guest-name', 'Neu')
			await action(g4.page, 'guest-join')
			const joined = await waitReady(g4.page, 30000).then(() => true, () => false)
			t.check(joined, 'neuer Gast kommt herein (Namensdialog, Beitritt)')
		} finally {
			await bridge('bruteforce-reset').catch(() => {})
			for (const a of extra) await world.drop(a)
		}
	},
}
