/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Probe OPS-1 (SPEC-M1 §33.1 m, P7-02; the W2 runner and the code verifier
 * run it, in W2 in a throwaway namespace in the prod profile with the app
 * from the release directory): accounts and groups deleted while Knorke is
 * disabled leave shares, link memberships, open votes and boards behind; an
 * account or group created later with the same name would inherit them
 * (review finding AUTHZ-1 = OPS-1). `occ knorke:orphans` reconciles them.
 *
 *   KD_NS=<ns> node dev/selftest/ops1-orphans.mjs
 *
 * Flow (after orch/p7/ops/verify/v-ops1-repro.mjs, extended to all five kinds):
 *   0. precheck: occ knorke:orphans --dry-run reports 0 for every kind and no
 *      ops1* account or group exists (else exit 2, "Stack nicht frisch")
 *   1. accounts ops1dave, ops1owen, ops1mem, ops1ctl, ops1new and groups
 *      ops1grp, ops1gctl (password only through OC_PASS and
 *      occ user:add --password-from-env)
 *   2. alice shares G with ops1grp (edit), U with ops1dave (edit), the
 *      controls GC with ops1gctl and UC with ops1ctl; ops1owen owns O
 *   3. alice turns U's edit link on, ops1mem joins (route 11) and votes in an
 *      open session on U that alice starts (route 22)
 *   4. the controls are deleted while the app runs
 *   5. occ app:disable knorke; ops1grp, ops1dave, ops1owen, ops1mem deleted;
 *      occ app:enable knorke, then ENABLE_SETTLE_MS
 *   6. occ knorke:orphans --dry-run, occ knorke:orphans, occ knorke:orphans again
 *   7. only then every id is created again, ops1new joins the new groups
 * Checks: snapshot of G as ops1new, of U as ops1dave and as ops1mem, of O as
 * ops1owen → 404 each; ops1owen's board list lacks O, GET shares on O → 404;
 * the open session on U has no vote row (SQL); the controls GC, UC → 404;
 * the dry-run numbers equal those of the real run (all 1), the rerun is all 0.
 * Cleanup (always): accounts, groups and alice's boards deleted, the app stays
 * enabled (also when the probe stops between disable and enable).
 *
 * The namespace comes only from KD_NS (missing → exit 2); a protected one
 * (KD_PROTECT_NS, default try) is refused with exit 2 before loadEnv and any
 * docker call (SPEC-M1 §8.1 R20). No password or token is ever printed.
 * Decisive stdout lines (§33.1 m):
 *   OPS-1 ns=<ns> profile=<prod|dev> nc=<version>
 *   OPS-1 dry-run: user-shares: 1, group-shares: 1, link-members: 1, open-votes: 1, owned-boards: 1
 *   OPS-1 orphans: user-shares: 1, group-shares: 1, link-members: 1, open-votes: 1, owned-boards: 1
 *   OPS-1 rerun: user-shares: 0, group-shares: 0, link-members: 0, open-votes: 0, owned-boards: 0
 *   OPS-1 after: G 404, U/ops1dave 404, U/ops1mem 404, O 404, shares O 404, list O absent, votes U 0; controls GC 404, UC 404
 *   OPS-1 ok        (red: the red checks, then "OPS-1 FAIL: <n> checks red")
 * Exit 0 = all as expected, 1 = a check red, 2 = cannot run (no KD_NS,
 * protected namespace, no env.json, stack not fresh, knorke:orphans unknown).
 */
import { spawn } from 'node:child_process'
import { loadEnv, Stack, run, protectedNs } from '../sim/lib/env.mjs'
import { Client, brief } from '../sim/lib/http.mjs'
import { harnessProfile } from '../sim/lib/normalise.mjs'
import { clientId, ulid, nextZ, sleep } from '../sim/lib/gen.mjs'

/** The five output lines of occ knorke:orphans, in this order (§33.1 e). */
export const KINDS = Object.freeze(['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards'])
export const DRY_RUN_LINE = 'Dry run: nothing was changed.'
export const USERS = Object.freeze(['ops1dave', 'ops1owen', 'ops1mem', 'ops1ctl', 'ops1new'])
export const GROUPS = Object.freeze(['ops1grp', 'ops1gctl'])
/** Wait after occ app:enable knorke (route cache, §33.1 m: at least 7 s). */
export const ENABLE_SETTLE_MS = 7000

/**
 * The output of occ knorke:orphans: {counts, dryRun} when the five lines
 * "<kind>: <n>" stand in the order of KINDS (other lines ignored), else null.
 */
export function parseOrphans(out) {
	const lines = String(out ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
	const counts = {}
	const order = []
	for (const l of lines) {
		const m = /^([a-z-]+): (\d+)$/.exec(l)
		if (m && KINDS.includes(m[1]) && !(m[1] in counts)) {
			counts[m[1]] = Number(m[2])
			order.push(m[1])
		}
	}
	if (order.join(',') !== KINDS.join(',')) return null
	return { counts, dryRun: lines.includes(DRY_RUN_LINE) }
}

/** "user-shares: 1, group-shares: 1, …" (unknown counts as ?). */
export const countsLine = (c) => KINDS.map((k) => `${k}: ${Number.isInteger(c?.[k]) ? c[k] : '?'}`).join(', ')
/** Every kind has exactly n. */
export const allAre = (c, n) => !!c && KINDS.every((k) => c[k] === n)

/** A Knorke sticky put (§4.6). */
const note = (id) => ({ o: 'put', id, t: 'sticky', p: { x: 0, y: 0, w: 200, h: 200, r: 0, z: nextZ(), parent: null, data: { text: 'OPS-1' }, style: { fill: '#a8d8f8' } } })

export async function main(env = process.env) {
	const ns = env.KD_NS
	if (!ns) {
		console.error('OPS-1: KD_NS fehlt (der Namensraum kommt nur aus KD_NS)')
		return 2
	}
	// SPEC-M1 §8.1 (R20): before loadEnv and before any docker call
	if (protectedNs(ns, env)) {
		console.error(`OPS-1: VERWEIGERT: Namensraum '${ns}' ist geschützt (KD_PROTECT_NS)`)
		return 2
	}
	let e
	try {
		e = loadEnv(ns, { anyDb: true })
	} catch (err) {
		console.error(`OPS-1: ${err.message}`)
		return 2
	}
	const stack = new Stack(e)
	const NC = e.containers.nc
	const occ = (...a) => run('docker', ['exec', '-u', 'www-data', NC, 'php', 'occ', ...a.map(String)], { timeoutMs: 120000 })
	/** occ that must succeed; the error text without anything secret. */
	const occOk = async (...a) => {
		const r = await occ(...a)
		if (!r.ok) throw new Error(`occ ${a.join(' ')}: ${(r.err || r.out).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)
		return r.out
	}
	// the password goes through the environment only (OC_PASS), never on a command line or into the output
	const addUser = (uid) => new Promise((resolve, reject) => {
		const p = spawn('docker', ['exec', '-u', 'www-data', '-e', 'OC_PASS', NC, 'php', 'occ', 'user:add', '--password-from-env', uid], { env: { ...process.env, OC_PASS: e.userPass }, stdio: ['ignore', 'ignore', 'pipe'] })
		let err = ''
		p.stderr.on('data', (c) => { err += c })
		p.on('error', reject)
		p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`occ user:add ${uid} (exit ${code}): ${err.trim().slice(0, 200)}`))))
	})
	console.log(`OPS-1 ns=${ns} profile=${harnessProfile(e)} nc=${e.versions?.nextcloud ?? '?'}`)

	// 0. precheck: knorke:orphans exists and finds nothing; no ops1* id of an earlier run
	const pre = await occ('knorke:orphans', '--dry-run')
	if (!pre.ok) {
		const why = (pre.err || pre.out).trim()
		console.error(/not defined|no commands defined|There are no commands/i.test(why) ? 'OPS-1: occ knorke:orphans ist unbekannt (App ohne P7-02?)' : `OPS-1: occ knorke:orphans --dry-run schlug fehl: ${why.split('\n').slice(-2).join(' ').slice(0, 300)}`)
		return 2
	}
	const p0 = parseOrphans(pre.out)
	if (!p0) {
		console.error(`OPS-1: occ knorke:orphans --dry-run ohne die fünf Zeilen ${KINDS.join(', ')}: ${pre.out.trim().slice(0, 300)}`)
		return 2
	}
	if (!allAre(p0.counts, 0)) {
		console.error(`OPS-1: Stack nicht frisch (knorke:orphans --dry-run: ${countsLine(p0.counts)})`)
		return 2
	}
	const userList = await occ('user:list', '--output=json')
	const groupList = await occ('group:list', '--output=json')
	let users = null
	let groups = null
	try { users = JSON.parse(userList.out.slice(userList.out.indexOf('{'))) } catch { /* not JSON */ }
	try { groups = JSON.parse(groupList.out.slice(groupList.out.indexOf('{'))) } catch { /* not JSON */ }
	if (!users || !groups) {
		console.error('OPS-1: occ user:list / group:list --output=json lieferte kein JSON')
		return 2
	}
	const leftover = [...USERS.filter((u) => u in users), ...GROUPS.filter((g) => g in groups)]
	if (leftover.length) {
		console.error(`OPS-1: Stack nicht frisch (es gibt schon ${leftover.join(', ')})`)
		return 2
	}

	const red = []
	const check = (cond, label, info) => {
		if (!cond) red.push(info === undefined ? label : `${label} :: ${JSON.stringify(info).slice(0, 300)}`)
		return !!cond
	}
	const must = (cond, label, info) => {
		if (!cond) throw new Error(info === undefined ? label : `${label} :: ${JSON.stringify(info).slice(0, 300)}`)
	}
	const login = async (uid) => {
		const c = await new Client(e, uid).login(uid)
		c.client = clientId()
		return c
	}
	const boardOf = async (c, title) => {
		const r = await c.createBoard(title)
		must(r.status === 201 && Number.isSafeInteger(r.data?.board?.id), `Setup: Board ${title} anlegen (${c.name}) → 201`, brief(r))
		return r.data.board.id
	}
	const made = { users: [], groups: [], boards: [] }
	let alice = null
	let disabled = false
	try {
		// 1. accounts and groups
		for (const u of USERS) {
			await addUser(u)
			made.users.push(u)
		}
		for (const g of GROUPS) {
			await occOk('group:add', g)
			made.groups.push(g)
		}
		// 2. boards and shares
		alice = await login('alice')
		const G = await boardOf(alice, 'OPS-1 G')
		const U = await boardOf(alice, 'OPS-1 U')
		const GC = await boardOf(alice, 'OPS-1 GC')
		const UC = await boardOf(alice, 'OPS-1 UC')
		made.boards.push(G, U, GC, UC)
		const owen = await login('ops1owen')
		const O = await boardOf(owen, 'OPS-1 O')
		for (const [b, share] of [[G, { kind: 'group', id: 'ops1grp', role: 'edit' }], [U, { kind: 'user', id: 'ops1dave', role: 'edit' }], [GC, { kind: 'group', id: 'ops1gctl', role: 'edit' }], [UC, { kind: 'user', id: 'ops1ctl', role: 'edit' }]]) {
			const r = await alice.saveShares(b, [share])
			must(r.status === 200, `Setup: PUT shares ${share.kind}:${share.id} → 200`, brief(r))
		}
		// 3. link member and open vote on U
		const lk = await alice.enableLink(U, false)
		must(lk.status === 200 && typeof lk.data?.link?.token === 'string', 'Setup: Bearbeitungslink von U (Route 9) → 200', lk.status)
		const mem = await login('ops1mem')
		const jn = await mem.joinLink(lk.data.link.token)
		must(jn.status === 200, 'Setup: ops1mem tritt über den Link bei (Route 11) → 200', jn.status)
		const sa = await alice.snapshot(U)
		must(sa.status === 200, 'Setup: Snapshot U (alice) → 200', sa.status)
		const N = ulid()
		const put = await alice.sync(U, { client: alice.client, since: sa.data.rev, pres: 0, seq: 1, ops: [note(N)] })
		must(put.status === 200 && put.data?.acks?.res?.[0] === 'ok', 'Setup: Notiz auf U → ok', put.data?.acks)
		const sv = await alice.startVote(U, { per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
		const sid = sv.data?.board?.meta?.vote?.sid
		must(sv.status === 200 && Number.isInteger(sid), 'Setup: alice startet eine Sitzung auf U (Route 22) → 200', sv.status)
		const sm = await mem.snapshot(U)
		must(sm.status === 200, 'Setup: Snapshot U (ops1mem) → 200', sm.status)
		const vo = await mem.sync(U, { client: mem.client, since: sm.data.rev, pres: 0, seq: 1, ops: [{ o: 'vote', s: sid, id: N, n: 1 }] })
		must(vo.status === 200 && vo.data?.acks?.res?.[0] === 'ok', 'Setup: ops1mem stimmt ab → ok', vo.data?.acks)
		const votesU = async () => Number((await stack.sqlRow(`SELECT count(*) FROM oc_knorke_votes v JOIN oc_knorke_vote_sessions s ON s.id = v.session_id WHERE s.board_id = ${U} AND s.state = 'open';`))?.[0])
		must((await votesU()) === 1, 'Setup: eine Stimmzeile in der offenen Sitzung von U (SQL)')
		// 4. the controls go while the app runs (the listeners remove their rows)
		await occOk('group:delete', 'ops1gctl')
		await occOk('user:delete', 'ops1ctl')
		// 5. deleted while the app is disabled: no listener runs
		await occOk('app:disable', 'knorke')
		disabled = true
		await occOk('group:delete', 'ops1grp')
		for (const u of ['ops1dave', 'ops1owen', 'ops1mem']) await occOk('user:delete', u)
		await occOk('app:enable', 'knorke')
		disabled = false
		await sleep(ENABLE_SETTLE_MS)
		// 6. reconcile
		const dry = await occ('knorke:orphans', '--dry-run')
		const pd = dry.ok ? parseOrphans(dry.out) : null
		console.log(`OPS-1 dry-run: ${countsLine(pd?.counts)}`)
		const real = await occ('knorke:orphans')
		const pr = real.ok ? parseOrphans(real.out) : null
		console.log(`OPS-1 orphans: ${countsLine(pr?.counts)}`)
		const again = await occ('knorke:orphans')
		const pa = again.ok ? parseOrphans(again.out) : null
		console.log(`OPS-1 rerun: ${countsLine(pa?.counts)}`)
		check(dry.ok && pd && pd.dryRun, `occ knorke:orphans --dry-run: Exit 0, fünf Zeilen und „${DRY_RUN_LINE}“`, { exit: dry.code })
		check(allAre(pd?.counts, 1), 'dry-run: je Art genau 1', pd?.counts)
		check(real.ok && pr && !pr.dryRun && allAre(pr.counts, 1), 'occ knorke:orphans: Exit 0, je Art genau 1', { exit: real.code, counts: pr?.counts })
		check(!!pd && !!pr && countsLine(pd.counts) === countsLine(pr.counts), 'die Zahlen von dry-run und echtem Lauf sind gleich', { dry: pd?.counts, real: pr?.counts })
		check(again.ok && allAre(pa?.counts, 0), 'zweiter Lauf: je Art 0', { exit: again.code, counts: pa?.counts })
		// 7. every id again, ops1new into the new groups
		for (const u of ['ops1dave', 'ops1owen', 'ops1mem', 'ops1ctl']) await addUser(u)
		for (const g of GROUPS) {
			await occOk('group:add', g)
			await occOk('group:adduser', g, 'ops1new')
		}
		const nw = await login('ops1new')
		const dave = await login('ops1dave')
		const mem2 = await login('ops1mem')
		const owen2 = await login('ops1owen')
		const ctl = await login('ops1ctl')
		const st = async (c, b) => (await c.snapshot(b)).status
		const after = {
			G: await st(nw, G),
			Udave: await st(dave, U),
			Umem: await st(mem2, U),
			O: await st(owen2, O),
			sharesO: (await owen2.listShares(O)).status,
			listO: null,
			votesU: await votesU(),
			GC: await st(nw, GC),
			UC: await st(ctl, UC),
		}
		const lb = await owen2.listBoards()
		after.listO = lb.status === 200 && Array.isArray(lb.data?.boards) ? (lb.data.boards.some((x) => x.id === O) ? 'present' : 'absent') : `status ${lb.status}`
		console.log(`OPS-1 after: G ${after.G}, U/ops1dave ${after.Udave}, U/ops1mem ${after.Umem}, O ${after.O}, shares O ${after.sharesO}, list O ${after.listO}, votes U ${after.votesU}; controls GC ${after.GC}, UC ${after.UC}`)
		check(after.G === 404, 'Snapshot G als ops1new (Mitglied der neuen Gruppe ops1grp) → 404', after.G)
		check(after.Udave === 404, 'Snapshot U als neues ops1dave → 404', after.Udave)
		check(after.Umem === 404, 'Snapshot U als neues ops1mem (früheres Link-Mitglied) → 404', after.Umem)
		check(after.O === 404, 'Snapshot O als neues ops1owen → 404 (Board gelöscht)', after.O)
		check(after.sharesO === 404, 'GET shares O als neues ops1owen → 404', after.sharesO)
		check(after.listO === 'absent', 'O fehlt in der Board-Liste des neuen ops1owen', after.listO)
		check(after.votesU === 0, 'die offene Sitzung auf U hat keine Stimmzeile mehr (SQL)', after.votesU)
		check(after.GC === 404 && after.UC === 404, 'Kontrollen: GC als ops1new und UC als neues ops1ctl → 404', { GC: after.GC, UC: after.UC })
	} catch (err) {
		check(false, `Ablauf abgebrochen: ${String(err?.message || err).slice(0, 400)}`)
	} finally {
		if (disabled) await occ('app:enable', 'knorke')
		if (alice) for (const b of made.boards) await alice.deleteBoard(b).catch(() => {})
		for (const u of USERS) await occ('user:delete', u)
		for (const g of GROUPS) await occ('group:delete', g)
	}
	if (red.length) {
		for (const r of red) console.log(`OPS-1 rot: ${r}`)
		console.log(`OPS-1 FAIL: ${red.length} checks red`)
		return 1
	}
	console.log('OPS-1 ok')
	return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().then((c) => process.exit(c), (err) => { console.error('OPS-1: ABBRUCH', err?.message || err); process.exit(2) })
}
