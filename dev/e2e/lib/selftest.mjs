/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the host bridge (SPEC-M0 §8.2), `dev/e2e/run.sh --selftest`:
 * every whitelisted action once, from inside the Playwright container, with
 * no browser. Part 1 works on fixtures that run.sh created through
 * selftest-fixtures.sh (two board rows with negative ids, Redis keys under
 * a fake prefix), so its expectations are exact and independent of the app's
 * API. Part 2 ("live") repeats the Redis/resync actions on a real board made
 * through the API. Since stage 3 (SPEC-M1 §8.4 R17 K6) the app always
 * answers there: a board that cannot be created, a snapshot without an
 * epoch, a failing sync or link creation are failed checks, never a skip
 * with a note (only pgss off PostgreSQL stays a note). Part 3 checks that
 * the bridge refuses what is not on the list. On a stack other than
 * KD_DB=pgsql the two pgss actions must answer
 * {ok: false, unsupported: true} (round 2 U2); every other action is the same.
 * The two config actions (links-policy, legal-links; round 2 U11/U9) are
 * switched there and back in Part 1; the run ends with links allowed and
 * no legal links, as it started.
 * SPEC-M1 §8.1: requests carry up to four arguments, each checked on its own;
 * Part 3 also sends missing, extra and malformed argument lists. The fixture
 * keys carry a fake epoch (kdselftest/knorke/kdself01/…), the live part talks
 * protocol 2 with the epoch of the board's snapshot (§4.3).
 * Stage 2 (SPEC-M1 §8.4): Part 1 switches share-policy (one key of each kind:
 * bool, list, number), group-member, circles there and back and builds a
 * harness team (team-create, team-member, same-name replacement; run.sh
 * destroys it when the run ends, normalise_ns); Part 2 expires the live
 * board's edit link (link-expire) and seeds 250 notes into it (seed-board, two
 * batches); Part 3 refuses keys, values, accounts, groups, team names and
 * counts.
 * Stage 2, phase 1 (SPEC-M1 §8.4 R13): Part 2 also clears Nextcloud's
 * ILimiter state (ratelimit-reset: the board creation left a key, the second
 * call finds none) and checks that link-expire raises the generation of the
 * link's role (D-7): a guest who joined before gets 403 link_revoked on its
 * next sync; its re-join answers 403 link_expired (WP-B2; a check since R17
 * K6, lib/selftestLive.mjs rejoinChecks).
 * Nextcloud booleans are compared tolerantly (yes|true|1, no|false|0).
 * Stage 3 (SPEC-M1 §8.4 R16): Part 1 expires the open fixture session of F2
 * (vote-expire: ends_at = now − 1 ms, rev/meta_rev unchanged, vt: deleted,
 * twice) and is refused on F1, whose only session is closed; Part 2 starts a
 * real session through route 22 (anything but 200 is a failed check, R17
 * K6), expires it and checks that the board's rev, metaRev and meta did not
 * move, that the vote op afterwards answers ["closed"] (path (a) of WP-B3),
 * that the snapshot then shows the session closed and that a second
 * vote-expire is refused (lib/selftestLive.mjs liveVote); Part 3 refuses
 * malformed vote-expire requests.
 * Stage 4 (SPEC-M1 §8.4 R19, T4-07; the self-test checks the actions instead
 * of their refusal): Part 1 sets two keys of HARNESS_APP_CONFIG through
 * app-config (budget_ops, changes_cap) and deletes them again with
 * "default"; Part 2 puts and removes a note on the live board and runs
 * purge-tombstones <b> 0 (backdating + occ knorke:compact --board of WP-B4,
 * lib/selftestLive.mjs livePurge: JSON line, min_rev, resync below X, none
 * at X, snapshot, second purge empty) – all checks; Part 3 refuses
 * malformed purge-tombstones and app-config requests (age, key, value,
 * count).
 * P7-C (SPEC-M1 §33.1 j): Part 1 also sets a byte key to 0 (budget_bytes_board_day,
 * 0 = off) and link_limit to 20, and every "default" must store the baseline
 * of the namespace's profile (lib/switches.mjs baselineOf: the profile value
 * of HARNESS_APP_PROFILE in the dev profile, else not set); Part 3 refuses 0
 * for link_limit and budget_ops (0 only for the byte keys, ED-23) and a
 * negative byte value.
 * Part 4 checks the container's own limits (round 2 U4): not root, the
 * scripts the host runs are read-only, the only writable place is the
 * namespace's output dir, and env.json carries no database or Redis password.
 */
import fs from 'node:fs'
import path from 'node:path'
import { bridge, bridgeRaw, outDir } from './bridge.mjs'
import { api, ENV, sleep, APP } from './harness.mjs'
import { ncFalse, baselineOf, harnessProfile } from './switches.mjs'
import { rejoinChecks, liveVote, livePurge } from './selftestLive.mjs'

/** Guest request without a browser (join or sync): X-Requested-With like the app, X-Knorke-Guest once joined. */
async function guestCall(path, body, token = null) {
	const headers = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Accept: 'application/json' }
	if (token) headers['X-Knorke-Guest'] = token
	const r = await fetch(APP + path, { method: 'POST', headers, body: JSON.stringify(body) })
	const text = await r.text()
	let data = null
	try { data = JSON.parse(text) } catch { /* not JSON */ }
	return { status: r.status, data, text }
}

// negative: never raise the auto-increment counter of mysql/mariadb/sqlite (selftest-fixtures.sh)
const F1 = '-900000000000000001'
const F2 = '-900000000000000002'

export async function selftest() {
	let ok = 0
	const failed = []
	const notes = []
	const check = (cond, label, info) => {
		if (cond) { ok++; console.log(`  ok    ${label}`); return true }
		const msg = info === undefined ? label : `${label} :: ${JSON.stringify(info)}`
		failed.push(msg)
		console.log(`  FEHLER ${msg}`)
		return false
	}
	const step = async (label, fn) => {
		try { await fn() } catch (e) { check(false, label, String(e?.message || e)) }
	}
	const kind = ENV.db?.kind ?? 'pgsql'
	const pg = kind === 'pgsql'
	console.log(`Brücken-Selbsttest gegen Namensraum ${ENV.ns} (DB ${kind}: ${ENV.containers.db ?? ENV.containers.nc}, ${ENV.containers.redis})`)

	console.log('Teil 1: alle Aktionen auf Fixtures')
	await step('pgss-reset', async () => {
		const r = await bridgeRaw('pgss-reset')
		if (pg) check(r.ok === true, 'pgss-reset antwortet ok', r)
		else check(r.ok === false && r.unsupported === true && /KD_DB=pgsql/.test(r.error), `pgss-reset auf ${kind}: abgelehnt mit unsupported`, r)
	})
	await step('pgss-count', async () => {
		if (!pg) {
			const r = await bridgeRaw('pgss-count')
			check(r.ok === false && r.unsupported === true, `pgss-count auf ${kind}: abgelehnt mit unsupported`, r)
			return
		}
		const r = await bridge('pgss-count')
		check(typeof r.total === 'number' && Array.isArray(r.statements), 'pgss-count liefert {total, statements[]}', r)
	})
	await step('redis-get-rev', async () => {
		const r = await bridge('redis-get-rev', F1)
		check(r.key === `kdselftest/knorke/kdself01/r:${F1}` && r.value === 5 && r.ttl > 0 && r.ttl <= 30, 'redis-get-rev F1 → Wert 5, TTL ≤ 30 (Schlüssel mit Epoche)', r)
	})
	await step('redis-del-rev', async () => {
		const r = await bridge('redis-del-rev', F1)
		check(r.deleted === 1, 'redis-del-rev F1 löscht genau r:', r)
		const g = await bridge('redis-get-rev', F1)
		check(g.key === null, 'danach ist r: F1 weg', g)
	})
	await step('redis-del-access', async () => {
		const r = await bridge('redis-del-access', F1)
		check(r.deleted === 2 && r.keys.some((k) => k.endsWith(`/a:${F1}`)) && r.keys.some((k) => k.includes(`/g:${F1}:`)), 'redis-del-access F1 löscht a: und g:', r)
	})
	await step('set-min-rev', async () => {
		const r = await bridge('set-min-rev', F2)
		check(r.row && r.row.rev === 8 && r.row.min_rev === 8, 'set-min-rev F2: rev 7 → rev 8, min_rev 8 (eine Anweisung)', r)
		check(r.deleted === 2, 'set-min-rev löscht a: und r:', r)
		const r2 = await bridge('set-min-rev', F2)
		check(r2.row && r2.row.rev === 9 && r2.row.min_rev === 9, 'zweimal: rev 9, min_rev 9', r2)
	})
	await step('bruteforce-reset', async () => {
		const r = await bridge('bruteforce-reset')
		check(r.ip === ENV.gatewayIp, 'bruteforce-reset für gatewayIp', r)
	})
	await step('links-policy', async () => {
		try {
			const off = await bridge('links-policy', 'off')
			check(off.policy === 'off' && ncFalse(off.shareapi_allow_links), 'links-policy off → shareapi_allow_links = no (tolerant: no|false|0)', off)
		} finally {
			const on = await bridge('links-policy', 'on')
			check(on.policy === 'on' && on.shareapi_allow_links === null, 'links-policy on → Schlüssel gelöscht (Vorgabe yes)', on)
		}
	})
	await step('legal-links', async () => {
		try {
			const set = await bridge('legal-links', 'set')
			check(set.imprintUrl === 'https://example.org/knorke-harness/impressum' && set.privacyUrl === 'https://example.org/knorke-harness/datenschutz', 'legal-links set → beide Test-URLs', set)
		} finally {
			const clear = await bridge('legal-links', 'clear')
			check(clear.imprintUrl === null && clear.privacyUrl === null, 'legal-links clear → beide gelöscht', clear)
		}
	})

	// stage 3 (SPEC-M1 §8.4 R16): vote-expire on the fixture sessions
	await step('vote-expire', async () => {
		const t0 = Date.now()
		const r = await bridge('vote-expire', F2)
		const t1 = Date.now()
		check(Number.isInteger(r.sid) && r.sid > 0 && r.endsAt === r.now - 1 && r.endsAt >= t0 - 5000 && r.endsAt <= t1 + 5000, 'vote-expire F2 → offene Sitzung, endsAt = jetzt − 1 ms', r)
		check(r.rev === 9 && r.metaRev === 0, 'vote-expire lässt rev (9 nach set-min-rev) und meta_rev (0) stehen', r)
		check(r.deleted === 1 && Array.isArray(r.keys) && r.keys[0] === `kdselftest/knorke/kdself01/vt:${F2}`, 'vote-expire löscht genau vt: des Boards (mit Epoche)', r)
		const again = await bridge('vote-expire', F2)
		check(again.sid === r.sid && again.endsAt >= r.endsAt && again.deleted === 0, 'zweimal: dieselbe Sitzung bleibt offen, vt: schon weg', again)
		const none = await bridgeRaw('vote-expire', F1)
		check(none.ok === false && /keine offene Abstimmung/.test(none.error), 'vote-expire F1 (nur eine geschlossene Sitzung) → Fehler, nichts geändert', none)
	})

	// stage 4 (SPEC-M1 §8.4 R19): app-config on HARNESS_APP_CONFIG keys, back to the baseline;
	// P7-C (§33.1 j): 0 for a byte key, link_limit, "default" = the baseline of the profile
	await step('app-config', async () => {
		const keys = []
		try {
			keys.push('budget_ops')
			const ops = await bridge('app-config', 'budget_ops', '5000')
			check(ops.key === 'budget_ops' && ops.value === '5000' && ops.stored === '5000', 'app-config budget_ops 5000 → gespeichert (nach 4 s)', ops)
			keys.push('changes_cap')
			const cap = await bridge('app-config', 'changes_cap', '1000000000')
			check(cap.key === 'changes_cap' && cap.stored === '1000000000', 'app-config changes_cap 1000000000 (Obergrenze) → gespeichert', cap)
			keys.push('budget_bytes_board_day')
			const zero = await bridge('app-config', 'budget_bytes_board_day', '0')
			check(zero.key === 'budget_bytes_board_day' && zero.value === '0' && zero.stored === '0', 'app-config budget_bytes_board_day 0 (Byte-Schlüssel, 0 = aus) → gespeichert (P7-C)', zero)
			keys.push('link_limit')
			const ll = await bridge('app-config', 'link_limit', '20')
			check(ll.key === 'link_limit' && ll.stored === '20', 'app-config link_limit 20 → gespeichert (P7-C)', ll)
		} finally {
			for (const k of keys) {
				const d = await bridge('app-config', k, 'default')
				const want = baselineOf(ENV, k)
				check(d.stored === want, `app-config ${k} default → Grundstand ${want === null ? 'nicht gesetzt' : want} (Profil ${harnessProfile(ENV)}, §33.1 j)`, d)
			}
		}
	})

	// stage 2 (SPEC-M1 §8.4): the harness group of up.sh and its default members
	const G = 'knorke-e2e'
	const defMembers = [...(ENV.groups?.[G] ?? [])].sort()
	await step('share-policy', async () => {
		const keys = []
		try {
			keys.push('shareapi_enabled')
			const off = await bridge('share-policy', 'shareapi_enabled', 'no')
			// a key typed in Nextcloud's config lexicon reads back as 0/false (NC 35 may type more keys than 34)
			check(off.key === 'shareapi_enabled' && ncFalse(off.stored), 'share-policy shareapi_enabled no → gespeichert (tolerant: no|false|0)', off)
			keys.push('shareapi_exclude_groups_list')
			const list = await bridge('share-policy', 'shareapi_exclude_groups_list', G)
			check(list.stored === JSON.stringify([G]), 'share-policy shareapi_exclude_groups_list knorke-e2e → ["knorke-e2e"] (Liste mit einer Harness-Gruppe)', list)
			keys.push('shareapi_expire_after_n_days')
			const days = await bridge('share-policy', 'shareapi_expire_after_n_days', '3')
			check(days.stored === '3', 'share-policy shareapi_expire_after_n_days 3 → gespeichert', days)
		} finally {
			for (const k of keys) {
				const d = await bridge('share-policy', k, 'default')
				check(d.stored === null, `share-policy ${k} default → Schlüssel gelöscht (Vorgabe)`, d)
			}
		}
	})
	await step('group-member', async () => {
		try {
			const add = await bridge('group-member', 'add', 'alice', G)
			check(Array.isArray(add.members) && add.members.includes('alice') && defMembers.every((u) => add.members.includes(u)), 'group-member add alice knorke-e2e → alice Mitglied', add)
			const rm = await bridge('group-member', 'remove', 'bob', G)
			check(Array.isArray(rm.members) && !rm.members.includes('bob'), 'group-member remove bob knorke-e2e → bob kein Mitglied', rm)
			const again = await bridge('group-member', 'remove', 'bob', G)
			check(JSON.stringify(again.members) === JSON.stringify(rm.members), 'group-member remove ist idempotent', again)
		} finally {
			await bridge('group-member', 'remove', 'alice', G)
			const back = await bridge('group-member', 'add', 'bob', G)
			check(JSON.stringify([...(back.members || [])].sort()) === JSON.stringify(defMembers), 'zurück: knorke-e2e = env.json .groups', { back, defMembers })
		}
	})
	await step('circles', async () => {
		try {
			const off = await bridge('circles', 'off')
			check(off.circles === 'off' && off.enabled === false, 'circles off → App circles aus', off)
		} finally {
			const on = await bridge('circles', 'on')
			check(on.circles === 'on' && on.enabled === true, 'circles on → App circles an', on)
		}
	})
	await step('team-create/team-member', async () => {
		const t1 = await bridge('team-create', 'knorke-e2e-selftest')
		check(/^[A-Za-z0-9]{31}$/.test(t1.singleId) && t1.owner === 'alice' && t1.name === 'knorke-e2e-selftest', 'team-create → singleId (31 Zeichen), Besitzerin alice', t1)
		const m = await bridge('team-member', t1.singleId, 'bob')
		check(Array.isArray(m.members) && m.members.some((x) => x.user === 'bob') && m.members.some((x) => x.user === 'alice'), 'team-member → bob im Team, alice auch', m)
		const t2 = await bridge('team-create', 'knorke-e2e-selftest')
		check(t2.singleId !== t1.singleId && t2.replaced.includes(t1.singleId), 'team-create mit demselben Namen ersetzt das alte Team', t2)
		const old = await bridgeRaw('team-member', t1.singleId, 'carol')
		check(old.ok === false, 'das ersetzte Team gibt es nicht mehr', old)
		console.log('  (das Team knorke-e2e-selftest räumt normalise_ns am Ende des Laufs ab)')
	})

	console.log('Teil 2: live auf einem echten Board')
	await step('live', async () => {
		const cr = await api('alice', 'POST', '/api/v1/boards', { title: 'bridge selftest live' })
		// R17 K6: the app answers in every stage-3 stack; a dead API is red, never a skip with a note
		if (!check(cr.status === 201 && Number.isSafeInteger(cr.data?.board?.id), 'live: Board anlegen → 201', `${cr.status} ${cr.text.slice(0, 120)}`)) return
		const id = cr.data.board.id
		// with the fixtures in place: their ids must not have raised the auto-increment counter
		check(Number.isSafeInteger(id) && id > 0 && id < 1e12, 'live: neue Board-ID klein (Fixtures haben den Zähler nicht hochgezogen)', id)
		// SPEC-M1 §8.4 (R13): creating the board registered an ILimiter attempt (knorke-create)
		const rl = await bridge('ratelimit-reset')
		check(Number.isInteger(rl.deleted) && rl.deleted >= 1, 'live: ratelimit-reset löscht den ILimiter-Zustand (≥ 1 Schlüssel nach dem Anlegen)', rl)
		const rl2 = await bridge('ratelimit-reset')
		check(rl2.deleted === 0, 'live: ein zweites ratelimit-reset findet nichts mehr', rl2)
		try {
			// protocol 2: the epoch of the board's snapshot goes with every sync (SPEC-M1 §4.3)
			const sn = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
			const ep = typeof sn.data?.epoch === 'string' ? sn.data.epoch : null
			if (!check(!!ep, 'live: Snapshot mit epoch (Protokoll 2)', `${sn.status} ${sn.text.slice(0, 120)}`)) return
			const sync = (body) => api('alice', 'POST', `/api/v1/boards/${id}/sync`, { proto: 2, client: 'cSelftest1', pres: 0, ep, ...body })
			const s1 = await sync({ since: 0, seq: 1, ops: [{ o: 'put', id: '01KSE1FTEST00000000000000A', t: 'sticky', p: { x: 0, y: 0, w: 200, h: 200, r: 0, z: 'i0', parent: null, data: { text: 'x' }, style: { fill: '#a8d8f8' } } }] })
			if (!check(s1.status === 200 && Number.isInteger(s1.data?.rev), 'live: Sync mit einer Notiz → 200', `${s1.status} ${s1.text.slice(0, 120)}`)) return
			const rev = s1.data.rev
			const g = await bridge('redis-get-rev', id)
			check(g.key && g.value === rev && g.ttl > 0 && g.ttl <= 30, 'live: r: = rev nach dem Schreiben, TTL ≤ 30', { g, rev })
			const d = await bridge('redis-del-rev', id)
			check(d.deleted === 1, 'live: redis-del-rev', d)
			await sync({ since: rev })
			const g2 = await bridge('redis-get-rev', id)
			check(g2.key && g2.value === rev, 'live: r: nach einem Sync neu gesät', g2)
			const a = await bridge('redis-del-access', id)
			check(a.deleted >= 1 && a.keys.some((k) => k.endsWith(`/a:${id}`)), 'live: redis-del-access findet a:', a)
			const m = await bridge('set-min-rev', id)
			check(m.row && m.row.rev === rev + 1 && m.row.min_rev === rev + 1, 'live: set-min-rev rev + 1', { m, rev })
			const s2 = await sync({ since: rev })
			check(s2.status === 200 && s2.data?.resync === true, 'live: alter Cursor → resync', s2.text)
			// stage 2 (SPEC-M1 §8.4): the edit link expires, 250 notes seeded in two batches
			const ln = await api('alice', 'POST', `/api/v1/boards/${id}/link`, {})
			if (check(ln.status === 200 && !!ln.data?.link?.token, 'live: Bearbeitungslink anlegen (Route 17) → 200', `${ln.status} ${ln.text.slice(0, 120)}`)) {
				// a guest joins before the link expires
				const tok = ln.data.link.token
				const gj = await guestCall(`/pub/v1/${tok}/join`, { client: 'cSelftestG1', name: 'Gesa', guest: null })
				const gtok = gj.data?.guest?.token
				check(gj.status === 200 && typeof gtok === 'string', 'live: Gast tritt vor dem Ablauf bei', gj.text.slice(0, 160))
				const le = await bridge('link-expire', id, 'edit')
				check(le.link && le.link.role === 'edit' && le.link.expiresAt === le.now - 1, 'live: link-expire edit → expires_at = jetzt − 1 ms', le)
				check(le.gen && le.gen.column === 'link_gen' && le.gen.after === le.gen.before + 1, 'live: link-expire edit erhöht link_gen im selben SQL (R13, D-7)', le.gen)
				if (gtok) {
					const gs = await guestCall(`/pub/v1/boards/${id}/sync`, { proto: 2, client: 'cSelftestG1', since: 0, ep, pres: 0 }, gtok)
					check(gs.status === 403 && gs.data?.error === 'link_revoked', 'live: das Gast-Token von vorher → 403 link_revoked (Generation erhöht)', gs.text.slice(0, 160))
					const rj = await guestCall(`/pub/v1/${tok}/join`, { client: 'cSelftestG1', name: 'Gesa', guest: gtok })
					rejoinChecks(check, rj)
				}
				const lv = await bridgeRaw('link-expire', id, 'vote')
				check(lv.ok === false && /keinen nicht widerrufenen Link der Rolle vote/.test(lv.error), 'live: link-expire vote ohne Abstimm-Link → Fehler, nichts geändert', lv)
			}
			// stage 3 (SPEC-M1 §8.4 R16/R17 K6): a real session through route 22, vote-expire, path (a) – all checks
			await liveVote({ id, itemId: '01KSE1FTEST00000000000000A', api, bridge, bridgeRaw, sync, check })
			// stage 4 (SPEC-M1 §8.4 R19, T4-07): purge-tombstones with compact of WP-B4 – all checks
			await livePurge({ id, api, bridgeRaw, sync, check })
			const sd = await bridge('seed-board', id, 250)
			check(sd.created === 250 && sd.batches === 2 && sd.items === 251 && sd.owner === 'alice', 'live: seed-board 250 → 2 Batches, 251 lebende Objekte (1 + 250)', sd)
			const sn2 = await api('alice', 'GET', `/api/v1/boards/${id}/snapshot`)
			const seeded = (sn2.data?.items || []).filter((it) => it.t === 'sticky' && /^Seed \d+$/.test(it.data?.text || ''))
			check(sn2.status === 200 && seeded.length === 250 && new Set(seeded.map((it) => it.z)).size === 250, 'live: Snapshot zeigt 250 gesäte Notizen mit eigenen z-Schlüsseln', { status: sn2.status, seeded: seeded.length })
			if (pg) {
				const p0 = await bridge('pgss-reset')
				await sleep(100)
				const pc = await bridge('pgss-count')
				check(p0 && typeof pc.total === 'number', 'live: pgss-reset/-count nacheinander', pc)
			} else {
				notes.push(`live: pgss übersprungen (DB ${kind})`)
			}
		} finally {
			await api('alice', 'DELETE', `/api/v1/boards/${id}`).catch(() => {})
		}
	})

	console.log('Teil 3: die Brücke verweigert alles außerhalb der Liste')
	await step('refuse', async () => {
		const r1 = await bridgeRaw('drop-all', F1)
		check(r1.ok === false, 'unbekannte Aktion → abgelehnt', r1)
		const r2 = await bridgeRaw('set-min-rev', '1; DROP TABLE oc_knorke_boards')
		check(r2.ok === false && /Board-ID/.test(r2.error), 'Board-ID mit SQL → abgelehnt', r2)
		const r3 = await bridgeRaw('redis-del-rev', '*')
		check(r3.ok === false, 'Board-ID * → abgelehnt', r3)
		const r4 = await bridgeRaw('redis-get-rev', '1234567890123456789')
		check(r4.ok === false, 'Board-ID mit 19 Ziffern → abgelehnt', r4)
		const r5 = await bridgeRaw('redis-get-rev', '--1')
		check(r5.ok === false && /Board-ID/.test(r5.error), 'Board-ID --1 → abgelehnt', r5)
		const r6 = await bridgeRaw('set-min-rev', '1-2')
		check(r6.ok === false && /Board-ID/.test(r6.error), 'Board-ID 1-2 → abgelehnt', r6)
		const r7 = await bridgeRaw('links-policy', 'maybe')
		check(r7.ok === false && /Argument/.test(r7.error), 'links-policy maybe → abgelehnt', r7)
		const r8 = await bridgeRaw('legal-links', 'set; occ user:delete alice')
		check(r8.ok === false && /Argument/.test(r8.error), 'legal-links mit angehängtem Befehl → abgelehnt', r8)
		// SPEC-M1 §8.1: up to four arguments, each checked, the count exact
		const r9 = await bridgeRaw('redis-get-rev', F1, 'x')
		check(r9.ok === false && /2 Argumente statt 1/.test(r9.error), 'zweites Argument zu viel → abgelehnt', r9)
		const r10 = await bridgeRaw('redis-get-rev')
		check(r10.ok === false && /0 Argumente statt 1/.test(r10.error), 'fehlende Board-ID → abgelehnt', r10)
		const r11 = await bridgeRaw('bruteforce-reset', '1')
		check(r11.ok === false && /1 Argumente statt 0/.test(r11.error), 'Argument an einer Aktion ohne Argumente → abgelehnt', r11)
		const r12 = await bridgeRaw('links-policy', 'on', 'off', 'on', 'off', 'on')
		check(r12.ok === false && /höchstens vier/.test(r12.error), 'fünf Argumente → abgelehnt', r12)
		const r13 = await bridgeRaw('links-policy', 'on\noff')
		check(r13.ok === false && /Argument ungültig/.test(r13.error), 'Wort mit Zeilenumbruch → abgelehnt', r13)
		// stage 2 (SPEC-M1 §8.4)
		const refuse = async (label, re, action, ...args) => {
			const r = await bridgeRaw(action, ...args)
			check(r.ok === false && re.test(r.error), label, r)
		}
		await refuse('share-policy mit fremdem Schlüssel → abgelehnt', /Richtlinien-Schlüssel ungültig/, 'share-policy', 'shareapi_allow_resharing', 'no')
		await refuse('share-policy Zahl für einen Ja/Nein-Schlüssel → abgelehnt', /passt nicht zu shareapi_enabled/, 'share-policy', 'shareapi_enabled', '3')
		await refuse('share-policy fremde Gruppe in einer Liste → abgelehnt', /Richtlinien-Wert ungültig/, 'share-policy', 'shareapi_exclude_groups_list', 'admin')
		await refuse('share-policy JSON als Wert → abgelehnt', /Richtlinien-Wert ungültig/, 'share-policy', 'shareapi_exclude_groups_list', '["admin"]')
		await refuse('group-member mit admin → abgelehnt', /Konto ungültig/, 'group-member', 'add', 'admin', G)
		await refuse('group-member in die Gruppe admin → abgelehnt', /Gruppe ungültig/, 'group-member', 'add', 'alice', 'admin')
		await refuse('group-member ohne Gruppe → abgelehnt', /2 Argumente statt 3/, 'group-member', 'add', 'alice')
		await refuse('team-create ohne Harness-Präfix → abgelehnt', /Team-Name ungültig/, 'team-create', 'Team Nord')
		await refuse('team-member mit kaputter singleId → abgelehnt', /singleId ungültig/, 'team-member', 'abc', 'bob')
		await refuse('link-expire mit fremder Rolle → abgelehnt', /Argument ungültig/, 'link-expire', F1, 'owner')
		await refuse('seed-board über 5000 → abgelehnt', /Anzahl ungültig/, 'seed-board', F1, '5001')
		await refuse('circles mit zwei Argumenten → abgelehnt', /2 Argumente statt 1/, 'circles', 'on', 'off')
		await refuse('ratelimit-reset mit Argument → abgelehnt (R13)', /1 Argumente statt 0/, 'ratelimit-reset', '*')
		// stage 3 (R16): vote-expire takes exactly one board id
		await refuse('vote-expire ohne Board-ID → abgelehnt', /0 Argumente statt 1/, 'vote-expire')
		await refuse('vote-expire mit SQL → abgelehnt', /Board-ID ungültig/, 'vote-expire', '1; DELETE FROM oc_knorke_vote_sessions')
		await refuse('vote-expire mit zwei Argumenten → abgelehnt', /2 Argumente statt 1/, 'vote-expire', F1, 'x')
		// stage 4 (R19): purge-tombstones <board> <age>, app-config <key> <value>
		await refuse('purge-tombstones ohne Alter → abgelehnt', /1 Argumente statt 2/, 'purge-tombstones', F1)
		await refuse('purge-tombstones mit Alter über 30 Tagen → abgelehnt', /Alter ungültig/, 'purge-tombstones', F1, '2592000001')
		await refuse('purge-tombstones mit negativem Alter → abgelehnt', /Alter ungültig/, 'purge-tombstones', F1, '-1')
		await refuse('purge-tombstones mit SQL als Board-ID → abgelehnt', /Board-ID ungültig/, 'purge-tombstones', '1; DELETE FROM oc_knorke_items', '0')
		await refuse('app-config mit fremdem Schlüssel → abgelehnt', /App-Config-Schlüssel ungültig/, 'app-config', 'max_items_per_board', '5')
		await refuse('app-config epoch → abgelehnt', /App-Config-Schlüssel ungültig/, 'app-config', 'epoch', 'default')
		await refuse('app-config budget_ops 0 → abgelehnt (0 nur für die Byte-Schlüssel, P7-C)', /App-Config-Wert 0 gilt nur für die Byte-Schlüssel/, 'app-config', 'budget_ops', '0')
		await refuse('app-config link_limit 0 → abgelehnt (0 ist kein „aus“, P7-C)', /App-Config-Wert 0 gilt nur für die Byte-Schlüssel/, 'app-config', 'link_limit', '0')
		await refuse('app-config budget_bytes_user_day -1 → abgelehnt', /App-Config-Wert ungültig/, 'app-config', 'budget_bytes_user_day', '-1')
		await refuse('app-config über 1000000000 → abgelehnt', /App-Config-Wert ungültig/, 'app-config', 'budget_ops', '1000000001')
		await refuse('app-config ohne Wert → abgelehnt', /1 Argumente statt 2/, 'app-config', 'budget_ops')
	})

	console.log('Teil 4: Grenzen des Containers')
	await step('container', async () => {
		const uid = typeof process.getuid === 'function' ? process.getuid() : -1
		check(uid > 0, 'läuft nicht als root', uid)
		const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
		for (const name of ['hostbridge.sh', 'selftest-fixtures.sh', 'run.sh', 'run.mjs']) {
			let code = null
			try { fs.appendFileSync(path.join(here, name), '') } catch (e) { code = e.code }
			check(code === 'EROFS' || code === 'EACCES', `${name} ist für den Container nicht schreibbar`, code)
		}
		let code = null
		try { fs.writeFileSync(path.join(here, 'kd-probe.tmp'), 'x') } catch (e) { code = e.code }
		check(code === 'EROFS' || code === 'EACCES', 'dev/e2e ist nur lesbar', code)
		const shadow = path.join(here, 'out')
		const seen = fs.existsSync(shadow) ? fs.readdirSync(shadow) : []
		check(seen.length === 0, 'dev/e2e/out ist verdeckt (keine Ausgaben anderer Namensräume sichtbar)', seen)
		const out = outDir()
		const probe = path.join(out, `probe-${process.pid}.tmp`)
		fs.writeFileSync(probe, 'x')
		check(fs.readFileSync(probe, 'utf8') === 'x', `Ausgabeverzeichnis ${out} ist schreibbar`)
		fs.rmSync(probe, { force: true })
		check(ENV.db?.pass === undefined && ENV.redis?.pass === undefined, 'env.json im Container ohne DB- und Redis-Passwort', { db: !!ENV.db?.pass, redis: !!ENV.redis?.pass })
	})

	console.log(`\n==== Brücken-Selbsttest: ${ok} ok / ${failed.length} fehlgeschlagen${notes.length ? ' · ' + notes.join('; ') : ''} ====`)
	return failed.length ? 1 : 0
}
