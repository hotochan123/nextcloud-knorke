/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Reports of the load run (SPEC-M1 §8.7, §10 P2) in dev/load/out/<ns>/:
 *
 *   <scenario>-<variant>[-<label>].{json,md}  one run; <scenario> in lower
 *       case (s1 s4 s4e s4d s5 sf sc), <variant> = env.json .load.variant
 *       (base | dbpersistent | app-off-<app>), <label> = KD_RUN_LABEL
 *       (^[a-z0-9-]{1,24}$, SPEC-M1 §9.0 point 2). The unlabelled
 *       <scenario>-<variant>.{json,md} is always a copy of the LAST run of
 *       that scenario and variant (without a label it is the same file).
 *   summary.{md,json}  one row per unlabelled report in the folder (the last
 *       run of every scenario and variant): scenario id, variant, seed, label,
 *       verdict, uptime before/after, versions and the app list (§8.7: "Jeder
 *       Lauf schreibt uptime vorher/nachher, Versionen, App-Liste, Variante
 *       und Seed"). With a label also summary-<label>.{md,json} over the
 *       reports of that label. P2 of §10 points at dev/load/out/load/summary.md.
 *
 * S5 (stage 4 phase 2, W3E-07/AUD-06): the run report and the summary carry
 * one row per step (requests/s, sync p95, the errors of S4 rule 2, edge,
 * K1–K3, CPU, saturation, budget) and the verdict of §8.7 "Weitere" (T4-10):
 * the complete steps, the knee, the gate up to 45 and P2 "Knie ≥ 45".
 *
 * Fix round p2d (W3 r2w3): S5 rows name the class of the maximum sync p95
 * (the value the gate judges) and the pooled sync p95 beside it (report only,
 * G1); every run names the sessions a 401 ended and the re-logins (G2), SF
 * the devices that never recovered and the re-logged ones apart (G3), the
 * time-weighted CPU with intervals above the cap (G5), the 5-s budget clock
 * and expired keys (G6); the board lock says "0 Aufrufe" when measured
 * without a call, S5 one line per step (G7); every written report gets a last
 * pass that replaces auth=… completely by [REDACTED] (G8).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESERVED_NS } from '../../sim/lib/report.mjs'
import { GATE_S5, LABEL_RE, reportStem } from './plan.mjs'
import { completeSteps, rule2Errors } from './gates.mjs'
import { redactAuth, redactSecrets } from './metrics.mjs'

export const LOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** File name of a run report: groups scenario, variant, label. */
export const REPORT_FILE_RE = /^(s1|s4|s4e|s4d|s5|sf|sc)-(base|dbpersistent|app-off-[a-z0-9_]{1,32})(?:-([a-z0-9-]{1,24}))?\.json$/

/** dev/load/out/<ns> (same namespace rules as dev/sim/lib/report.mjs outDir). */
export function outDir(ns = process.env.KD_NS || 'load', root = path.join(LOAD_DIR, 'out')) {
	if (!/^[a-z]{1,8}$/.test(ns)) throw new Error(`KD_NS='${ns}' ist ungültig`)
	if (RESERVED_NS.includes(ns)) throw new Error(`KD_NS='${ns}' ist reserviert (nicht erlaubt: ${RESERVED_NS.join(' ')})`)
	return path.join(root, ns)
}

const n = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d).replace('.', ','))
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const verdict = (g) => (g?.invalid ? '**ungültig** (Abbruch durch den Lastschutz)' : !g || g.ok === null ? 'Bericht' : g.ok ? 'grün' : '**rot**')

/** The highest sync p95 of a run or S5 step (null when none was measured). */
export function stepSyncP95(x) {
	const all = ['sync-empty', 'sync-items', 'sync-ops', 'sync-vote'].map((k) => x?.endpoints?.[k]?.p95).filter((v) => typeof v === 'number')
	return all.length ? Math.max(...all) : null
}

/** G1 (p2d): the class of that maximum (null when none was measured). */
export function stepSyncP95Class(x) {
	let best = null
	for (const k of ['sync-empty', 'sync-items', 'sync-ops', 'sync-vote']) {
		const p = x?.endpoints?.[k]?.p95
		if (typeof p === 'number' && (best === null || p > x.endpoints[best].p95)) best = k
	}
	return best
}

/** G7 (p2d): the board-lock text – "0 Aufrufe" when measured without a call, "nicht gemessen" only without a measurement. */
export function boardLockText(b) {
	if (!b) return 'nicht gemessen'
	const lock = b.lock?.calls ? `${b.lock.calls} Aufrufe, Mittel ${n(b.lock.meanMs, 3)} ms, max ${n(b.lock.maxMs, 3)} ms` : b.lock || b.measured ? '0 Aufrufe' : 'nicht gemessen'
	const vs = b.voteSync?.n ? `Stimm-Sync p95 ${n(b.voteSync.p95)} ms, max ${n(b.voteSync.max)} ms` : 'Stimm-Sync: keine Anfragen'
	return `lockBoard ${lock}; ${vs}${b.finding ? ` – **Befund an ${b.finding}** (über ${b.thresholds.maxExecMs} ms bzw. ${b.thresholds.voteSyncP95Ms} ms)` : ''}`
}

/** One row per S5 step (W3E-07): what the step measured, with the errors of S4 rule 2 (W3E-06). */
export function s5StepRows(rep) {
	const complete = new Set(completeSteps(rep.steps))
	return (rep.steps || []).map((x) => {
		const e = x.totals ? rule2Errors(x) : null
		const m = x.metrics || {}
		return {
			editors: x.config?.editors ?? null, complete: complete.has(x), aborted: x.aborted?.reason ?? null, error: x.error ?? null,
			rps: x.totals?.rps ?? null, syncP95: stepSyncP95(x), syncP95Class: stepSyncP95Class(x), syncP95Pooled: x.latency?.syncPooled?.p95 ?? null,
			errors: e?.total ?? null, unexpectedCodes: e?.unexpectedCodes ?? null, busy: e?.busy ?? null,
			edgeRejected: x.edge?.rejected ?? null, checks: x.checks?.ok ?? null, ncPgCores: m.ncPgCoresMean ?? null,
			apacheBusyMax: m.apache?.busy?.max ?? null, pgBackendsMax: m.postgres?.numbackends?.max ?? null,
			budgetMax: x.budget?.maxPerPid ?? null, uptimeBefore: x.host?.before?.uptime ?? null, uptimeAfter: x.host?.after?.uptime ?? null,
			boardLock: x.boardLock ? { calls: x.boardLock.lock?.calls ?? (x.boardLock.measured ? 0 : null), maxMs: x.boardLock.lock?.maxMs ?? null, text: boardLockText(x.boardLock) } : null,
		}
	})
}

/**
 * The verdict of §8.7 "Weitere" for S5 (T4-10): complete steps, knee (text),
 * the gate at 45 and P2 "Knie ≥ 45" (step 45 complete and green).
 */
export function s5Verdict(rep) {
	const complete = completeSteps(rep.steps).map((x) => x.config.editors)
	const k = rep.knee
	const kneeText = k?.text ? k.text : k ? `${k.editors} Bearbeiter (p95 ${n(k.p95)} ms, Fehler ${n((k.errorShare ?? 0) * 100, 2)} %)` : `keins bis ${complete.length ? complete[complete.length - 1] : '—'} Bearbeiter`
	const g1 = (rep.gate?.rules || []).find((r) => r.rule === 1)
	const gate45 = g1 ? (g1.ok === null ? 'nicht gemessen' : g1.ok ? 'grün' : '**rot**') : '—'
	const has45 = complete.some((e) => e >= GATE_S5.at)
	const p2 = rep.gate?.ok === true && has45
	return { complete, kneeText, gate45, p2, text: `vollständige Stufen ${complete.join(', ') || '—'}; Knie ${kneeText}; Gate bei ${GATE_S5.at}: ${gate45}; P2 „Knie ≥ ${GATE_S5.at}“: ${p2 ? 'erfüllt' : '**nicht erfüllt**'}` }
}

/** Markdown of one run (German, like every report of the harness). */
export function renderRunMd(rep) {
	const L = []
	const t = rep.totals || {}
	L.push(`# Lastlauf ${rep.scenario} (${rep.variant}) – ${rep.finishedAt ?? ''}`, '')
	L.push(`${rep.title ?? ''}`, '')
	L.push(`- Ergebnis: ${verdict(rep.gate)}${rep.aborted ? ` – **abgebrochen**: ${cell(rep.aborted.reason)}` : ''}${rep.error ? ` – Fehler: ${cell(rep.error)}` : ''}`)
	L.push(`- Seed ${rep.seed}, Kennzeichen ${rep.label || '—'}, Namensraum ${rep.ns ?? '—'}, Datei ${rep.files?.stem ?? '—'}`)
	L.push(`- Uptime vorher: ${cell(rep.host?.before?.uptime)}`)
	L.push(`- Uptime nachher: ${cell(rep.host?.after?.uptime)}`)
	const v = rep.versions || {}
	L.push(`- Versionen: Nextcloud ${v.nextcloud ?? '—'}, PHP ${v.php ?? '—'}, DB ${v.db ?? '—'}, Redis ${v.redis ?? '—'}, Image ${v.image ?? '—'}`)
	L.push(`- Apps: ${Array.isArray(rep.apps) ? rep.apps.map(([id, ver]) => `${id} ${ver}`).join(', ') : '—'}`)
	if (rep.config && Array.isArray(rep.steps)) L.push(`- Stufen: ${(rep.config.steps || []).join(' → ')} Bearbeiter je ${rep.config.secs ?? '—'} s, Geräte je Stufe in der Tabelle unten`)
	else if (rep.config) L.push(`- Geräte: ${rep.config.editors ?? '—'} Bearbeiter (${rep.config.moderator ?? 0} Moderator, ${rep.config.accounts ?? 0} Konto, ${rep.config.guests ?? 0} Gast), ${rep.config.tablets ?? '—'} Tablets; Fenster ${rep.config.secs ?? '—'} s${rep.config.fullLength === false ? ' (verkürzt, nicht gültig für das Gate)' : ''}`)
	if (t.requests !== undefined) L.push(`- Anfragen ${t.requests}, ${n(t.rps)} /s; 5xx ${t.status5xx}, 4xx ${t.status4xx}, Zeitüberschreitungen ${t.timeouts}, Netzfehler ${t.netErrors}; ${n((t.bytesPerSec ?? 0) / 1024)} KiB/s`)
	if (rep.knee !== undefined) L.push(`- Knie: ${rep.knee?.text ? cell(rep.knee.text) : rep.knee ? `${rep.knee.editors} Bearbeiter (p95 ${n(rep.knee.p95)} ms, Fehler ${n((rep.knee.errorShare ?? 0) * 100, 2)} %)` : 'keins'}${Array.isArray(rep.completeSteps) ? `; vollständige Stufen: ${rep.completeSteps.join(', ') || '—'}` : ''}`)
	if (rep.gate?.note) L.push(`- Bewertung: ${cell(rep.gate.note)}`)
	if (rep.config?.tabsPerAccount !== undefined) L.push(`- Tabs je Konto: ${rep.config.tabsPerAccount} (eine pid je Tab, §8.7 R19)`)
	if (rep.budget?.maxPerPid) L.push(`- Schreibbudget (Kalibrierung, §8.7 R19): höchster Zähler je pid und Fenster: ${rep.budget.maxPerPid.syncs ?? '—'} Anfragen mit Ops, ${rep.budget.maxPerPid.ops ?? '—'} Ops (mit abgeleiteten Zeilen), ${rep.budget.seed?.counters ? 'ohne das Säen' : 'inkl. Säen (nicht getrennt)'}; busy im Fenster ${rep.budget.busy ?? 0}`)
	if (rep.budget?.seed) {
		const sd = rep.budget.seed
		L.push(`- Säen (getrennt, zählt weder für maxPerPid noch für Regel 2): ${sd.syncs} Anfragen, ${sd.ops} Ops, busy ${sd.busy}, ${sd.batches} Batches${sd.counters ? `; Zähler der Säe-Fenster höchstens ${sd.counters.syncs} Anfragen, ${sd.counters.ops} Ops` : ''}`)
	}
	const bs = rep.budget?.sampling
	if (bs) L.push(`- Schreibbudget-Abtastung (G6): ${bs.reads} Lesungen, ${bs.clock}, Soll alle ${n(bs.everyMs / 1000, 0)} s, Abstand Mittel ${n((bs.meanGapMs ?? NaN) / 1000)} s, max ${n((bs.maxGapMs ?? NaN) / 1000)} s; abgelaufene Schlüssel (nicht vorhanden, nicht 0): ${rep.budget.missing ?? 0}`)
	const cpuC = Object.entries(rep.metrics?.cpu?.containers || {})
	if (cpuC.length) {
		const over = cpuC.filter(([, c]) => c?.overCap?.n > 0)
		L.push(`- cgroup-CPU (Mittel zeitgewichtet, G5): ${cpuC.map(([k, c]) => `${k} ${n(c.coresMean, 3)} Kerne (p95 ${n(c.coresP95, 3)}, max ${n(c.coresMax, 3)}, Deckel ${c.cap ?? '—'})`).join('; ')}${rep.metrics.cpu.droppedReadings ? `; verworfene Abtastwerte (Intervall ≈ 0): ${rep.metrics.cpu.droppedReadings}` : ''}${over.length ? `; **Ausreißer über dem Deckel**: ${over.map(([k, c]) => `${k} ${c.overCap.n} × (max ${n(c.overCap.max, 3)} > ${c.cap})`).join(', ')}` : ''}`)
	}
	const gaps = cpuC.filter(([, c]) => c?.gaps > 0)
	if (gaps.length) L.push(`- cgroup-CPU: Lücken (Zähler zurückgesetzt, Neustart): ${gaps.map(([k, c]) => `${k} ${c.gaps}`).join(', ')}`)
	if (rep.boardLock) {
		const b = rep.boardLock
		L.push(`- Board-Lock (nur Bericht, §8.7 R19): ${boardLockText(b)}`)
		for (const v of b.votes || []) L.push(`  - ${cell(v.query)}: ${v.calls} Aufrufe, Mittel ${n(v.meanMs, 3)} ms, max ${n(v.maxMs, 3)} ms`)
	}
	// G2 (p2d, W3B-05): sessions a 401 ended (device, role, time) and the re-logins
	const ss = rep.sessions
	if (ss && (ss.logouts || ss.relogins || ss.reloginFailures)) {
		L.push(`- Sitzungen (wie der echte Client: erstes 401 → abgemeldet, dann Neuanmeldung): ${ss.logouts} abgemeldet, ${ss.relogins} neu angemeldet, ${ss.reloginFailures} fehlgeschlagene Neuanmeldungen, ${ss.lostOps} Ops mit der toten Sitzung verworfen${ss.stillLoggedOut?.length ? `; am Ende noch abgemeldet: ${ss.stillLoggedOut.join(', ')}` : ''}`)
		if (!rep.faults?.loggedOut) for (const x of ss.loggedOut || []) L.push(`  - abgemeldet: gesendet ${n((x.sentMs ?? NaN) / 1000, 3)} s, ${cell(x.device)} (${cell(x.role)}), Sitzung ${x.sess ?? '—'}, ${cell(x.key)} → ${x.status}`)
		// P1 diagnosis: did the 401 answer set or delete a cookie (names only)?
		const withCookie = (ss.loggedOut || []).filter((x) => x.setCookie?.length)
		if (withCookie.length) L.push(`  - 401-Antworten mit Set-Cookie (nur Namen): ${withCookie.map((x) => `${cell(x.device)}: ${x.setCookie.map(cell).join(', ')}`).join('; ')}`)
	}
	if (rep.pageRequests) {
		const pr = rep.pageRequests
		L.push(`- Seitenzahlen SC: Bearbeiter ${pr.editor}, Tablet ${pr.tablet} – ${cell(pr.source)}; E12 (Stufe 4, M1-Bündel): ${pr.e12?.editor ?? '—'}/${pr.e12?.tablet ?? '—'}; M0-Referenz: ${pr.reference?.editor ?? 85}/${pr.reference?.tablet ?? 34}`)
	}
	if (rep.faults?.played) {
		const f = rep.faults
		const w = Array.isArray(f.redisWindowMs) ? ` (Neustart-Fenster ${n(f.redisWindowMs[0] / 1000, 3)}–${n(f.redisWindowMs[1] / 1000, 3)} s)` : ''
		L.push(`- SF: 5xx außerhalb ±5 s ${f.fiveXxOutside ?? '—'}, 401 nach dem Redis-Neustart ${f.unauthorizedAfterRedis ?? '—'} (gesendet nach dem Ende des Neustart-Fensters, zählt); 401 auf Anfragen, die während des Neustarts gesendet wurden: ${f.unauthorizedDuringRedis ?? '—'} (zählen nicht)${f.unauthorizedBeforeRedis ? `; davor gesendet ${f.unauthorizedBeforeRedis}` : ''}${w}${f.countedBy ? `; gezählt: ${cell(f.countedBy)}${typeof f.unauthorizedTotal === 'number' ? ` (401-Antworten insgesamt ${f.unauthorizedTotal})` : ''}` : ''}`)
		// R21 (W3V-02): `counted` = the first 401 of its device series; only one sent after the window counts for rule 3
		const mark = (u) => (!u.counted ? '' : u.when === 'nach' ? ', zählt für Regel 3' : ', erstes der Serie, zählt nicht')
		for (const u of f.unauthorized || []) L.push(`  - 401 ${u.when ?? '—'}: gesendet ${n(u.sentMs / 1000, 3)} s, Antwort ${n(u.recvMs / 1000, 3)} s, ${cell(u.key)} · ${cell(u.who)}${u.device ? ` (${cell(u.device)}, Sitzung ${u.sess ?? '—'}${u.relogin ? ', Neuanmeldung' : ''}${mark(u)})` : ''}${u.body ? ` – ${cell(u.body)}` : ''}`)
		// G2: the logged-out devices (time, device, role)
		// p2e (finding 3): logouts after a second 412 apart – never in rule 3
		if (f.loggedOut412) L.push(`- SF Abmeldungen nach zweitem 412 (CSRF; getrennt, zählen nicht für Regel 3): ${f.loggedOut412} – ${(f.loggedOut412List || []).map((x) => `${n(x.sentMs / 1000, 3)} s ${cell(x.device)} (${cell(x.role)}, ${x.when ?? '—'})`).join('; ')}`)
		if (Array.isArray(f.loggedOut)) L.push(`- SF abgemeldete Geräte (Zeit, Gerät, Rolle): ${f.loggedOut.length ? f.loggedOut.map((x) => `${n(x.sentMs / 1000, 3)} s ${cell(x.device)} (${cell(x.role)}, ${x.when ?? '—'}${x.relogin ? ', Neuanmeldung' : ''}${x.counted === false ? ', nicht gezählt' : ''})`).join('; ') : 'keine'}`)
		for (const p of rep.faults.played) {
			// G3: never recovered (red) and re-logged (apart)
			const nr = p.notRecovered ? `; **nicht erholt: ${p.notRecovered}** (${(p.notRecoveredDevices || []).map(cell).join(', ')})` : ''
			const rl = p.relogged ? `; neu angemeldet (getrennt, Erholung bis zum ersten erfolgreichen Sync nach der Neuanmeldung): ${(p.reloggedDevices || []).map((x) => `${cell(x.device)} ${n(x.recoveryS)} s`).join(', ')}` : ''
			L.push(`  - ${cell(p.title ?? p.id)}: Erholung ${p.recoveryS ?? '—'} s (${p.devices ?? '—'} Geräte), ${cell(p.note)}${nr}${rl}`)
		}
	}
	if (rep.scenario === 'S5' && Array.isArray(rep.steps)) {
		L.push(`- Wertung nach T4-10 (§8.7 „Weitere“): ${s5Verdict(rep).text}`, '')
		L.push('| Stufe (Bearbeiter) | vollständig | Anfragen/s | Sync p95 ms (Max der Klassen, Urteil) | Klasse des Max | Sync p95 gepoolt (nur Bericht) | Fehler wie S4 Regel 2 | davon unerwartete Codes | busy | Edge-Ablehnungen | K1–K3 | NC+PG Kerne | Apache busy max | PG numbackends max | Budget max je pid (Anfragen/Ops) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
		const rows = s5StepRows(rep)
		for (const x of rows) {
			const done = x.complete ? 'ja' : x.aborted ? `**abgebrochen** (${cell(x.aborted)})` : x.error ? '**Fehler**' : 'nein'
			L.push(`| ${x.editors ?? '—'} | ${done} | ${n(x.rps)} | ${n(x.syncP95)} | ${x.syncP95Class ?? '—'} | ${n(x.syncP95Pooled)} | ${x.errors ?? '—'} | ${x.unexpectedCodes ?? '—'} | ${x.busy ?? '—'} | ${x.edgeRejected ?? '—'} | ${x.checks === null ? '—' : x.checks ? 'ok' : '**rot**'} | ${n(x.ncPgCores, 2)} | ${x.apacheBusyMax ?? '—'} | ${x.pgBackendsMax ?? '—'} | ${x.budgetMax ? `${x.budgetMax.syncs ?? '—'}/${x.budgetMax.ops ?? '—'}` : '—'} |`)
		}
		// G7 (p2d, W3B-08): one board-lock line per step
		L.push('', '- Board-Lock je Stufe (nur Bericht, §8.7 R19):')
		for (const x of rows) L.push(`  - Stufe ${x.editors ?? '—'}: ${x.boardLock ? x.boardLock.text : 'nicht gemessen'}`)
	}
	L.push('')
	if (rep.gate?.rules?.length) {
		L.push('| Regel | Kriterium | Ergebnis | Wert | Schwelle |', '|---|---|---|---|---|')
		for (const r of rep.gate.rules) L.push(`| ${r.rule} | ${cell(r.name)} | ${r.ok === null ? 'nicht gemessen' : r.ok ? 'ok' : '**rot**'}${r.warn ? ' (Warnung)' : ''} | ${cell(JSON.stringify(r.value))} | ${cell(typeof r.threshold === 'string' ? r.threshold : JSON.stringify(r.threshold))} |`)
		L.push('')
	}
	return L.join('\n')
}

/**
 * Writes the run report: <stem>.{json,md} and, with a label, the copy
 * <latest>.{json,md}. Returns the written paths.
 */
export function writeRunReports(dir, rep, label = '') {
	const { stem, latest } = reportStem({ scenario: rep.scenario, variant: rep.variant || 'base', label })
	rep.label = label || null
	rep.files = { stem, latest }
	// P2B-03: the log messages in the report are redacted again on every write (also a re-render of an old JSON)
	const top = rep.metrics?.nextcloudLog?.top
	if (Array.isArray(top)) for (const e of top) if (e && typeof e.m === 'string') e.m = redactSecrets(e.m)
	fs.mkdirSync(dir, { recursive: true })
	// G8 (p2d, W3B-10): last pass over the whole text – no "auth=" stays anywhere (log tops, bodies, errors)
	const json = redactAuth(JSON.stringify(rep))
	const md = redactAuth(renderRunMd(rep))
	const out = []
	for (const s of label ? [stem, latest] : [stem]) {
		fs.writeFileSync(path.join(dir, `${s}.json`), json)
		fs.writeFileSync(path.join(dir, `${s}.md`), md)
		out.push(path.join(dir, `${s}.json`), path.join(dir, `${s}.md`))
	}
	return out
}

/** The summary of the folder; with a label also summary-<label>.{md,json}. Returns the written paths. */
export function writeSummary(dir, label = '') {
	if (label && !LABEL_RE.test(label)) throw new Error(`KD_RUN_LABEL '${label}' ist ungültig`)
	const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => REPORT_FILE_RE.test(f)).sort() : []
	const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }
	const sets = [['summary', files.filter((f) => !REPORT_FILE_RE.exec(f)[3])]]
	if (label) sets.push([`summary-${label}`, files.filter((f) => REPORT_FILE_RE.exec(f)[3] === label)])
	const out = []
	for (const [stem, list] of sets) {
		const reps = list.map((f) => [f, read(f)]).filter(([, r]) => r)
		const rows = reps.map(([f, r]) => ({
			file: f, scenario: r.scenario, variant: r.variant, seed: r.seed, label: r.label ?? null,
			verdict: r.gate?.ok ?? null, aborted: r.aborted?.reason ?? null, error: r.error ?? null,
			rps: r.totals?.rps ?? null, edgeRejected: r.edge?.rejected ?? null, ncPgCores: r.metrics?.ncPgCoresMean ?? null,
			uptimeBefore: r.host?.before?.uptime ?? null, uptimeAfter: r.host?.after?.uptime ?? null, finishedAt: r.finishedAt ?? null,
			// S5 (W3E-07): the T4-10 verdict and one row per step
			...(r.scenario === 'S5' && Array.isArray(r.steps) ? { abortedAfter45: r.gate?.abortedAfter45 === true, s5: s5Verdict(r), steps: s5StepRows(r) } : {}),
		}))
		const newest = reps.map(([, r]) => r).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0]
		const L = [`# Lastlauf – Übersicht${stem === 'summary' ? '' : ` (Kennzeichen ${label})`}`, '',
			`Stand ${new Date().toISOString()}; je Szenario und Variante ${stem === 'summary' ? 'der letzte Lauf' : `die Läufe mit dem Kennzeichen ${label}`} (SPEC-M1 §8.7, §10 P2).`, '',
			'| Szenario | Variante | Seed | Kennzeichen | Ergebnis | Anfragen/s | Edge-Ablehnungen | NC+PG Kerne | Uptime vorher | Uptime nachher | Datei |',
			'|---|---|---|---|---|---|---|---|---|---|---|']
		for (const r of rows) {
			const plain = r.verdict === null ? 'Bericht' : r.verdict ? 'grün' : '**rot**'
			let res = r.aborted ? `**abgebrochen** (${r.aborted})` : r.error ? `**Fehler**` : plain
			// S5: the verdict of T4-10 – an abort after the complete step 45 ends only S5, judged up to 45
			if (r.s5) res = `${r.abortedAfter45 || !r.aborted ? plain : res} – ${r.s5.text}${r.aborted ? ` (Lastschutz: ${r.aborted})` : ''}`
			L.push(`| ${r.scenario} | ${r.variant} | ${r.seed} | ${r.label ?? '—'} | ${cell(res)} | ${n(r.rps)} | ${r.edgeRejected ?? '—'} | ${n(r.ncPgCores, 2)} | ${cell(r.uptimeBefore)} | ${cell(r.uptimeAfter)} | ${r.file} |`)
			for (const x of r.steps || []) {
				const st = x.complete ? `Stufe vollständig; Fehler wie S4 Regel 2: ${x.errors ?? '—'}; Sync p95 ${n(x.syncP95)} ms (Max der Klassen: ${x.syncP95Class ?? '—'}; gepoolt ${n(x.syncP95Pooled)} ms, nur Bericht); K1–K3 ${x.checks === null ? '—' : x.checks ? 'ok' : 'rot'}; Board-Lock ${x.boardLock?.calls ?? '—'} Aufrufe` : x.aborted ? `Stufe abgebrochen (${x.aborted})` : x.error ? 'Stufe mit Fehler' : 'Stufe unvollständig'
				L.push(`| ${r.scenario} · ${x.editors ?? '—'} | ${r.variant} | ${r.seed} | ${r.label ?? '—'} | ${cell(st)} | ${n(x.rps)} | ${x.edgeRejected ?? '—'} | ${n(x.ncPgCores, 2)} | ${cell(x.uptimeBefore)} | ${cell(x.uptimeAfter)} | ${r.file} |`)
			}
		}
		if (!rows.length) L.push('| – | – | – | – | keine Läufe | – | – | – | – | – | – |')
		const v = newest?.versions || {}
		L.push('', '## Versionen (letzter Lauf)', '', `Nextcloud ${v.nextcloud ?? '—'}, PHP ${v.php ?? '—'}, DB ${v.db ?? '—'}, Redis ${v.redis ?? '—'}, Image ${v.image ?? '—'}`)
		L.push('', '## App-Liste (letzter Lauf)', '', Array.isArray(newest?.apps) ? newest.apps.map(([id, ver]) => `${id} ${ver}`).join(', ') : '—', '')
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, `${stem}.md`), redactAuth(L.join('\n')))
		fs.writeFileSync(path.join(dir, `${stem}.json`), redactAuth(JSON.stringify({ at: new Date().toISOString(), label: stem === 'summary' ? null : label, rows, versions: newest?.versions ?? null, apps: newest?.apps ?? null }, null, 1)))
		out.push(path.join(dir, `${stem}.md`), path.join(dir, `${stem}.json`))
	}
	return out
}
