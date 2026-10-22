/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Data side of dev/selftest/upgrade.sh (SPEC-M1 §3.8 "Prüfpfad"): seeds
 * boards through the API of the older code that runs first and, after this
 * code and `occ upgrade`, verifies them through the API of this code
 * (protocol 2).
 *
 *   node dev/selftest/lib/upgrade-data.mjs seed     (KD_NS, older code running)
 *   node dev/selftest/lib/upgrade-data.mjs verify   (KD_NS, this code, after occ upgrade)
 *
 * seed: the protocol of the running app (initialState(…).protocol) decides
 * how. 1 (M0 0.1.0, the default snapshot 0.0): the M0 API without ep. 2 (M1
 * 0.2.0, e.g. from git): with the stack's epoch. Both seed two boards of
 * alice ("Upgrade A", "Upgrade B"), notes, a frame with two children, a
 * deleted note, an edit link, bob as a link member, the guest Gina with a
 * token who wrote a note herself; protocol 2 adds a shape and a connector
 * between two notes on board A. The facts (protocol, ids, the snapshots, the
 * link and guest token, the pids, the live ids and the rows of
 * oc_knorke_items per board, tombstones included) go to
 * dev/.state/<ns>/upgrade-seed.json (mode 600, removed with the stack by
 * dev/down.sh).
 *
 * verify (SPEC-M1 §3.8 step 3): the target version is the one in
 * appinfo/info.xml of the staging directory dev/.state/<ns>/app (the new
 * code since step 3 of upgrade.sh). Every board, item, title, the link, the
 * link member and the guest identity are still valid – same items
 * (canonical comparison of the independent oracle, dev/sim/lib/mirror.mjs),
 * same titles, same rev/minRev, the old guest token works with the same
 * pid, bob still has access, the deleted note stays deleted; protocol 2,
 * epoch, board.links.edit = the seeded link, meta/metaRev; writes work again
 * for owner, member and guest; the database has every migration of the
 * staging directory (lib/Migration/Version*Date*.php) in oc_migrations,
 * meta_rev 0, vote_link_gen 1, installed_version = the target version and a
 * non-lazy epoch. With the M2 migration in the target (U3): every item of
 * the seeded boards carries group and lock, both null, for alice, bob and
 * Gina; no row has group_id, locked, locked_by or locked_name; the rows per
 * board equal those of the seed. Reports: dev/sim/out/<ns>/<KD_REPORT_STEM
 * or upgrade-seed / upgrade-verify>.{md,json}.
 *
 * Exit 0 = green, 1 = red, 2 = could not start.
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, Stack, ROOT } from '../../sim/lib/env.mjs'
import { Client, brief, initialState } from '../../sim/lib/http.mjs'
import { Suite } from '../../sim/lib/report.mjs'
import { ulid, clientId, nextZ } from '../../sim/lib/gen.mjs'
import { snapshotKeys, diffKeys, isObj } from '../../sim/lib/mirror.mjs'

const MODE = process.argv[2]
if (!['seed', 'verify'].includes(MODE)) {
	console.error('usage: KD_NS=<ns> node dev/selftest/lib/upgrade-data.mjs seed|verify')
	process.exit(2)
}

let env
try {
	env = loadEnv(undefined, { anyDb: true })
} catch (e) {
	console.error(`upgrade-data: ${e.message}`)
	process.exit(2)
}
const stack = new Stack(env)
const SEED_FILE = path.join(ROOT, 'dev', '.state', env.ns, 'upgrade-seed.json')
/** The staging directory upgrade.sh mounts as the app; after its step 3 it holds the new code. */
const STAGING = path.join(ROOT, 'dev', '.state', env.ns, 'app')
/** The migration of the M2 data foundation (knorke_items.group_id, locked_by, locked_name). */
const M2_MIGRATION = '000300Date20261017000000'
const M0 = { proto: 1, ep: undefined }

const sticky = (id, p = {}) => ({ o: 'put', id, t: 'sticky', p: { x: 0, y: 0, w: 200, h: 200, r: 0, z: nextZ(), parent: null, data: { text: '' }, style: { fill: '#a8d8f8' }, ...p } })
const frame = (id, p = {}) => ({ o: 'put', id, t: 'frame', p: { x: 0, y: 0, w: 800, h: 600, r: 0, z: nextZ(), parent: null, data: { title: '' }, style: { fill: '#ffffff' }, ...p } })
const shape = (id, p = {}) => ({ o: 'put', id, t: 'shape', p: { x: 0, y: 0, w: 200, h: 120, r: 0, z: nextZ(), parent: null, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }, ...p } })
const connector = (id, start, end) => ({ o: 'put', id, t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, z: nextZ(), parent: null, data: { route: 'straight', start, end }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' } } })
const sameIds = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

let seq = 0
/** One sync with ops (protocol 1 with `extra` = M0, else protocol 2 with the client's epoch); throws unless every op is ok. */
async function write(c, b, list, extra = {}) {
	const s = await c.snapshot(b)
	if (s.status !== 200) throw new Error(`Snapshot ${c.name} ${b}: ${brief(s)}`)
	const r = await c.sync(b, { client: c.client, since: s.data.rev, pres: 0, seq: ++seq, ops: list, ...extra })
	if (r.status !== 200 || !Array.isArray(r.data?.acks?.res)) throw new Error(`Sync ${c.name} ${b}: ${brief(r)}`)
	if (!r.data.acks.res.every((x) => x === 'ok')) throw new Error(`Sync ${c.name} ${b}: ${JSON.stringify(r.data.acks.res)}`)
	return r.data
}

/** Rows of oc_knorke_items of a board, tombstones included. */
async function itemRows(board) {
	const row = await stack.sqlRow(`SELECT count(*) FROM oc_knorke_items WHERE board_id = ${Number(board)};`)
	return Number(row?.[0])
}

async function seed() {
	const suite = new Suite('upgrade-seed')
	await suite.run('U0', 'Daten des älteren Stands säen (Protokoll der laufenden App: 1 ohne ep, 2 mit Epoche)', async (t) => {
		const alice = await new Client(env, 'alice').login('alice')
		alice.client = clientId()
		const bob = await new Client(env, 'bob').login('bob')
		bob.client = clientId()
		const page = await alice.request('GET', '/index.php/apps/knorke/', { headers: { Accept: 'text/html' }, xrw: false })
		const proto = initialState(page.text).protocol
		if (!t.check(proto === 1 || proto === 2, 'die laufende App spricht Protokoll 1 (M0-Stand) oder 2 (M1-Stand)', proto)) return
		let wire = M0
		if (proto === 2) {
			env.epoch = (await stack.epoch()) || undefined
			t.check(typeof env.epoch === 'string', 'Protokoll 2: Epoche des Stacks gelesen', env.epoch)
			wire = {}
		}
		const boards = []
		for (const title of ['Upgrade A ✓ Größe', 'Upgrade B']) {
			const r = await alice.createBoard(title)
			if (r.status !== 201) throw new Error(`Board ${title}: ${brief(r)}`)
			boards.push({ id: r.data.board.id, title })
		}
		const [A, B] = boards
		const [N1, N2, F, C1, C2, D, G1, B1, B2, S, K] = Array.from({ length: 11 }, () => ulid())
		await write(alice, A.id, [sticky(N1, { x: 10, y: 20, data: { text: 'Notiz eins' } }), sticky(N2, { x: 300, y: 20, data: { text: 'Notiz zwei', tag: ['a', { b: 1 }] }, style: { fill: '#ffd6a5' } }),
			frame(F, { x: 1000, y: 100, data: { title: 'Rahmen' } })], wire)
		await write(alice, A.id, [sticky(C1, { parent: F, x: 10, y: 10, data: { text: 'Kind 1' } }), sticky(C2, { parent: F, x: 220, y: 10, data: { text: 'Kind 2' } }), sticky(D, { x: -500, data: { text: 'gelöscht' } })], wire)
		await write(alice, A.id, [{ o: 'remove', id: D }], wire)
		if (proto === 2) {
			// types of M1: a shape and a connector bound to two notes
			await write(alice, A.id, [shape(S, { x: 300, y: 400, data: { kind: 'ellipse', text: 'Form' } }), connector(K, { item: N1 }, { item: N2 })], wire)
		}
		const lr = await alice.enableLink(A.id)
		if (lr.status !== 200 || !lr.data?.link?.token) throw new Error(`Link: ${brief(lr)}`)
		const token = lr.data.link.token
		const jr = await bob.joinLink(token)
		t.check(jr.status === 200 && jr.data?.boardId === A.id, 'bob tritt dem Link bei (Mitglied)', brief(jr))
		const g = new Client(env, 'Gina', { kind: 'guest' })
		g.client = clientId()
		const gj = await g.joinGuest(token, 'Gina', { client: g.client })
		if (gj.status !== 200 || !g.guestToken) throw new Error(`Gast: ${brief(gj)}`)
		if (proto === 1) {
			t.check(gj.data?.proto === 1 && !('epoch' in gj.data), 'Gast-Beitritt in M0-Form (proto 1, ohne epoch)', { proto: gj.data?.proto })
		} else {
			t.check(gj.data?.proto === 2 && gj.data?.epoch === env.epoch, 'Gast-Beitritt in Protokoll 2 (proto 2, epoch des Stacks)', { proto: gj.data?.proto, epoch: gj.data?.epoch })
		}
		await write(g, A.id, [sticky(G1, { x: 600, y: 400, data: { text: 'vom Gast' } })], wire)
		await write(bob, A.id, [{ o: 'patch', id: N2, p: { 'data.text': 'Notiz zwei (bob)' } }], wire)
		await write(alice, B.id, [sticky(B1, { data: { text: 'B eins' } }), sticky(B2, { x: 250, data: { text: 'B zwei' } })], wire)
		const live = { [A.id]: [N1, N2, F, C1, C2, G1, ...(proto === 2 ? [S, K] : [])], [B.id]: [B1, B2] }
		const snaps = {}
		const rows = {}
		for (const b of boards) {
			const s = await alice.snapshot(b.id)
			if (s.status !== 200) throw new Error(`Snapshot ${b.id}: ${brief(s)}`)
			if (proto === 1) {
				t.check(s.data.proto === 1 && isObj(s.data.board) && 'link' in s.data.board, `Board ${b.id}: Snapshot in M0-Form (proto 1, board.link)`, { proto: s.data.proto, keys: Object.keys(s.data.board || {}) })
			} else {
				t.check(s.data.proto === 2 && s.data.epoch === env.epoch, `Board ${b.id}: Snapshot in Protokoll 2 (proto 2, epoch des Stacks)`, { proto: s.data.proto, epoch: s.data.epoch })
			}
			snaps[b.id] = s.data
			const ids = (s.data.items || []).map((i) => i.id)
			t.check(sameIds(ids, live[b.id]), `Board ${b.id}: die ${live[b.id].length} gesäten lebenden Objekte${b.id === A.id ? ', die gelöschte Notiz fehlt' : ''}`, ids)
			rows[b.id] = await itemRows(b.id)
		}
		t.check(rows[A.id] === live[A.id].length + 1 && rows[B.id] === live[B.id].length, 'Zeilen in oc_knorke_items je Board = lebende Objekte + Grabsteine (A: 1)', rows)
		const bs = await bob.snapshot(A.id)
		const gs = await g.snapshot(A.id)
		const seedDoc = {
			at: new Date().toISOString(),
			proto, boards, token, deleted: [D], frame: F, children: [C1, C2], live, rows,
			guest: { token: g.guestToken, pid: gs.data?.me?.pid, client: g.client, name: 'Gina' },
			bob: { pid: bs.data?.me?.pid }, alice: { pid: snaps[A.id].me?.pid },
			snapshots: snaps,
		}
		t.check(typeof seedDoc.guest.pid === 'string' && typeof seedDoc.bob.pid === 'string', 'pids von Gast und bob notiert', { guest: seedDoc.guest.pid, bob: seedDoc.bob.pid })
		fs.writeFileSync(SEED_FILE, JSON.stringify(seedDoc, null, 1), { mode: 0o600 })
		t.note(`gesät (Protokoll ${proto}): Boards ${boards.map((b) => b.id).join(', ')}, Zeilen ${JSON.stringify(rows)}, Link ${token.slice(0, 4)}…, Gast-pid ${seedDoc.guest.pid}`)
	})
	return suite.finish({ ns: env.ns, mode: 'seed', db: stack.dbLabel, nextcloud: env.versions?.nextcloud })
}

/** Gina with her seeded guest token and client id. */
function gina(seedDoc) {
	const g = new Client(env, 'Gina', { kind: 'guest' })
	g.client = seedDoc.guest.client
	g.guestToken = seedDoc.guest.token
	return g
}

async function verify() {
	let seedDoc
	try {
		seedDoc = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'))
	} catch (e) {
		console.error(`upgrade-data verify: ${SEED_FILE} fehlt (${e.message}) – erst seed`)
		return 2
	}
	let target
	let migrations
	try {
		target = fs.readFileSync(path.join(STAGING, 'appinfo', 'info.xml'), 'utf8').match(/<version>([^<]+)<\/version>/)?.[1]
		migrations = fs.readdirSync(path.join(STAGING, 'lib', 'Migration'))
			.map((f) => /^Version(\d+Date\d+)\.php$/.exec(f)?.[1])
			.filter(Boolean)
			.sort()
	} catch (e) {
		console.error(`upgrade-data verify: Staging ${STAGING} unlesbar (${e.message})`)
		return 2
	}
	if (!target) {
		console.error(`upgrade-data verify: keine <version> in ${STAGING}/appinfo/info.xml`)
		return 2
	}
	const hasM2 = migrations.includes(M2_MIGRATION)
	const suite = new Suite('upgrade-verify')
	const ep = await stack.epoch()
	env.epoch = ep || undefined
	const alice = await new Client(env, 'alice').login('alice')
	alice.client = clientId()
	const bob = await new Client(env, 'bob').login('bob')
	bob.client = clientId()
	const [A, B] = seedDoc.boards

	await suite.run('U1', `Datenbank nach occ upgrade: Migrationen des Zielstands ${target}, Vorgaben, Epoche nicht lazy`, async (t) => {
		const mig = await stack.sql(`SELECT version FROM oc_migrations WHERE app = 'knorke' ORDER BY version;`)
		t.check(migrations.length > 0, `Staging hat Migrationen (${migrations.join(', ')})`, migrations)
		for (const v of migrations) {
			t.check(mig.some(([x]) => x === v), `oc_migrations: knorke ${v}`, mig)
		}
		const iv = await stack.occ('config:app:get', 'knorke', 'installed_version').catch(() => '')
		t.check(iv === target, `installed_version ${target} (appinfo/info.xml im Staging)`, iv)
		t.check(/^[a-z0-9]{6,16}$/.test(ep), 'Epoche gesetzt (InitEpoch beim Upgrade)', ep)
		const lazy = await stack.sqlRow(`SELECT lazy FROM oc_appconfig WHERE appid = 'knorke' AND configkey = 'epoch';`).catch((e) => [String(e.message)])
		t.check(lazy && Number(lazy[0]) === 0, 'Epoche nicht lazy gespeichert (vorgeladener Satz, Fastpath ohne Abfrage)', lazy)
		for (const b of [A, B]) {
			const row = await stack.sqlRow(`SELECT rev, meta_rev, vote_link_gen, title FROM oc_knorke_boards WHERE id = ${b.id};`)
			t.check(row && Number(row[1]) === 0 && Number(row[2]) === 1 && row[3] === b.title, `Board ${b.id}: meta_rev 0, vote_link_gen 1, Titel unverändert`, row)
			const acct = await stack.byteAccount(b.id)
			t.check(acct && acct.bytes === acct.sum && acct.count === acct.live, `Board ${b.id}: item_bytes = Σ, item_count = lebende`, acct)
		}
		const st = JSON.parse((await stack.occ('status', '--output=json')).replace(/^[^{]*/, ''))
		t.check(st.needsDbUpgrade === false && st.maintenance === false, 'occ status: kein offenes Upgrade, keine Wartung', st)
		t.note(`Ausgangsstand gesät mit Protokoll ${seedDoc.proto ?? 1}, Zielstand ${target}`)
	})

	await suite.run('U2', 'Besitzerin: gleiche Boards, Titel, Objekte, rev; Protokoll 2 mit Epoche; links.edit = gesäter Link', async (t) => {
		const list = await alice.listBoards()
		const ids = (list.data?.boards || []).map((x) => x.id)
		t.check(list.status === 200 && [A.id, B.id].every((id) => ids.includes(id)), 'beide Boards in der Liste', ids)
		for (const b of [A, B]) {
			const s = await alice.snapshot(b.id)
			if (!t.check(s.status === 200, `Board ${b.id}: Snapshot 200`, brief(s))) continue
			const old = seedDoc.snapshots[b.id]
			const d = diffKeys(snapshotKeys(s.data), snapshotKeys(old), 'nach dem Upgrade', 'vorher')
			t.check(d.length === 0, `Board ${b.id}: Objekte gleich (${old.items.length})`, d.slice(0, 3))
			t.check(s.data.board?.title === b.title && s.data.rev === old.rev && s.data.minRev === old.minRev, `Board ${b.id}: Titel, rev, minRev gleich`, { title: s.data.board?.title, rev: [old.rev, s.data.rev] })
			t.check(s.data.proto === 2 && s.data.epoch === ep && Number.isInteger(s.data.now), `Board ${b.id}: Snapshot proto 2, epoch, now`, { proto: s.data.proto, epoch: s.data.epoch })
			t.check(s.data.board?.metaRev === 0 && isObj(s.data.board?.meta), `Board ${b.id}: metaRev 0, meta {}`, s.data.board)
		}
		const sa = await alice.snapshot(A.id)
		t.check(sa.data?.board?.links?.edit?.token === seedDoc.token && sa.data?.board?.links?.vote === null, 'Board A: links.edit = der gesäte Link, links.vote null', sa.data?.board?.links)
		t.check(!(sa.data?.items || []).some((i) => seedDoc.deleted.includes(i.id)), 'die gelöschte Notiz bleibt gelöscht')
		const kids = (sa.data?.items || []).filter((i) => seedDoc.children.includes(i.id))
		t.check(kids.length === 2 && kids.every((k) => k.parent === seedDoc.frame), 'Kinder bleiben im Frame', kids.map((k) => [k.id, k.parent]))
		t.check(sa.data?.me?.pid === seedDoc.alice.pid, 'pid der Besitzerin gleich', { vorher: seedDoc.alice.pid, nachher: sa.data?.me?.pid })
	})

	// Before U4: its writes add rows to board A.
	const u3 = 'M2-Datenbasis: group und lock in jedem Objekt (beide null) für alice, bob und Gina; Spalten NULL; Zeilen wie gesät'
	if (hasM2) {
		await suite.run('U3', u3, async (t) => {
			const g = gina(seedDoc)
			const seen = []
			for (const [c, list] of [[alice, [A, B]], [bob, [A]], [g, [A]]]) {
				for (const b of list) {
					const s = await c.snapshot(b.id)
					if (!t.check(s.status === 200, `${c.name}: Snapshot Board ${b.id} 200`, brief(s))) continue
					const items = s.data?.items || []
					const bad = items.filter((i) => !('group' in i) || !('lock' in i) || i.group !== null || i.lock !== null)
					t.check(items.length > 0 && bad.length === 0, `${c.name}, Board ${b.id}: jedes der ${items.length} Objekte hat group und lock, beide null`, bad.slice(0, 3).map((i) => ({ id: i.id, group: i.group, lock: i.lock })))
					seen.push(`${c.name} ${b.id}: ${items.length - bad.length}/${items.length}`)
				}
			}
			const ids = [A.id, B.id].map(Number).join(', ')
			const set = await stack.sqlRow(`SELECT count(*) FROM oc_knorke_items WHERE board_id IN (${ids}) AND (group_id IS NOT NULL OR locked IS NOT NULL OR locked_by IS NOT NULL OR locked_name IS NOT NULL);`)
			t.check(Number(set?.[0]) === 0, 'oc_knorke_items: group_id, locked, locked_by und locked_name überall NULL', set)
			const rows = []
			for (const b of [A, B]) {
				const n = await itemRows(b.id)
				const want = seedDoc.rows?.[b.id]
				t.check(Number.isInteger(want) && n === want, `Board ${b.id}: ${want} Zeilen wie gesät (mit Grabsteinen)`, { vorher: want, nachher: n })
				rows.push(`${b.id}: ${n}/${want}`)
			}
			t.note(`group/lock null (Objekte je Snapshot): ${seen.join(', ')}; Zeilen mit gesetzter Spalte: ${set?.[0]}; Zeilen nachher/gesät: ${rows.join(', ')}`)
		})
	} else {
		suite.skip('U3', u3, `Zielstand ${target} hat die Migration ${M2_MIGRATION} nicht`)
	}

	await suite.run('U4', 'Link-Mitglied bob und Gast Gina behalten Zugriff und Identität', async (t) => {
		const sb = await bob.snapshot(A.id)
		t.check(sb.status === 200 && sb.data?.me?.pid === seedDoc.bob.pid, 'bob: Snapshot 200, gleiche pid', { status: sb.status, pid: sb.data?.me?.pid })
		const lb = await bob.listBoards()
		const row = (lb.data?.boards || []).find((x) => x.id === A.id)
		t.check(!!row && row.viaLink === true, 'Board A in bobs Liste (viaLink)', row)
		const g = gina(seedDoc)
		const gs = await g.snapshot(A.id)
		t.check(gs.status === 200 && gs.data?.me?.pid === seedDoc.guest.pid && gs.data?.proto === 2, 'altes Gast-Token gilt: Snapshot 200, gleiche pid, proto 2', { status: gs.status, pid: gs.data?.me?.pid })
		const gj = await g.joinGuest(seedDoc.token, 'Gina', { client: g.client })
		t.check(gj.status === 200 && gj.data?.me?.pid === seedDoc.guest.pid && gj.data?.epoch === ep, 'Gast tritt mit altem Token neu bei: gleiche pid, Antwort mit epoch', { status: gj.status, pid: gj.data?.me?.pid })
		const p = await new Client(env, 'p').publicPage(seedDoc.token)
		t.check(p.status === 200 && p.state.linkState === 'ok' && p.state.boardId === A.id && 'linkInfo' in p.state, '/p/<Link> → linkState ok, 10 Schlüssel mit linkInfo', { status: p.status, keys: Object.keys(p.state) })

		// writes in protocol 2 for all three
		const s0 = await alice.snapshot(A.id)
		let since = s0.data.rev
		const [X, Y, Z] = [ulid(), ulid(), ulid()]
		for (const [c, id] of [[alice, X], [bob, Y], [g, Z]]) {
			const r = await c.sync(A.id, { client: c.client, since, pres: 0, seq: ++seq, ops: [sticky(id, { x: 1500, y: 1500, data: { text: `nach dem Upgrade (${c.name})` } })] })
			t.check(r.status === 200 && r.data?.acks?.res?.[0] === 'ok' && !r.data?.resync, `${c.name}: put nach dem Upgrade (Protokoll 2, ep) → ok`, brief(r))
			since = r.data?.rev ?? since
		}
		const r = await bob.sync(A.id, { client: bob.client, since: s0.data.rev, pres: 0 })
		const seen = new Set((r.data?.items || []).map((i) => i.id))
		t.check(r.status === 200 && [X, Y, Z].every((id) => seen.has(id)), 'bob liest alle drei neuen Objekte', [...seen])
		const m0 = await alice.sync(A.id, { proto: 1, ep: undefined, client: alice.client, since })
		t.check(m0.status === 409 && m0.data?.error === 'protocol', 'ein M0-Tab (proto 1, ohne ep) bekommt 409 protocol (lädt neu)', brief(m0))
	})
	return suite.finish({ ns: env.ns, mode: 'verify', db: stack.dbLabel, nextcloud: env.versions?.nextcloud, seeded: seedDoc.at, from: `Protokoll ${seedDoc.proto ?? 1}`, target })
}

try {
	process.exit(MODE === 'seed' ? await seed() : await verify())
} catch (e) {
	console.error(`upgrade-data ${MODE}: ${e?.stack || e}`)
	process.exit(1)
}
