/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pass rules of the load run (SPEC-M1 §8.7), evaluated on a finished report.
 * Each rule is {rule, name, ok, value, threshold}: ok true/false, or null
 * when the run did not collect what the rule needs (no stack, collector
 * missing) – null never counts as green. S4 and S4e are judged by rules 1–9
 * of "Bestehensregeln S4" (rule 9 only warns), S5 by its knee rules, SF and
 * SC by theirs; S1 and S4d are report-only (ok null).
 *
 * Revision 19 (SPEC-M1 §8.7 "Weitere", T4-10): a run the load guard aborted
 * is invalid (ok false, invalid true: no result, a repeat needs a new window
 * the user releases) – except S5 after a complete step 45: then only S5
 * ended, and the S5 gate is judged over the complete steps up to 45 (P2
 * "Knie ≥ 45" holds when step 45 is complete and green). SC (T4-11): the
 * model counts only with measured page requests; with the M0 values 85/34
 * rule 1 is "nicht gemessen" (null, P2 not proven for SC).
 *
 * Fix round p2d: the S5 gate keeps the maximum of the class p95 (user
 * decision 14.10.2026, W3B-02) and names the class and the pooled sync p95
 * beside it (report only, G1); SF rule 2 is red for a device that never
 * recovered (G3), re-logged devices are reported apart; SF rule 3 counts per
 * device and session the first 401 (G2).
 *
 * Close-out of stage 4 (R21, P2B-01): the knee's error share counts the
 * errors of S4 rule 2 without `busy` (kneeErrors, the same definition as the
 * S5 gate at 45), no longer only 5xx, timeouts, network errors and 429.
 */
import { GATE_S4, GATE_S5, GATE_SC, GATE_SF } from './plan.mjs'

/**
 * S5 steps that ran to their end: no abort, no harness error, the full
 * window (T4-10: an abort after a complete step 45 ends only S5).
 */
export function completeSteps(steps) {
	return (steps || []).filter((x) => !x.aborted && !x.error && x.totals && x.config)
}

/** Does an S5 abort leave a complete step at GATE_S5.at (45) editors? */
export function step45Complete(steps) {
	return completeSteps(steps).some((x) => x.config.editors >= GATE_S5.at)
}

const rule = (n, name, ok, value, threshold, extra = {}) => ({ rule: n, name, ok, value, threshold, ...extra })
const all = (...xs) => (xs.some((x) => x === false) ? false : xs.some((x) => x === null || x === undefined) ? null : true)
const le = (v, max) => (typeof v === 'number' ? v <= max : null)
const ge = (v, min) => (typeof v === 'number' ? v >= min : null)

/**
 * The errors of S4 rule 2 (§8.7: 0 × 5xx, 0 timeouts, 0 unexpected 4xx –
 * locked/gone/dup/limit/closed allowed – 0 × busy) of one run or S5 step:
 * {status5xx, timeouts, netErrors, status4xx, unexpectedCodes, busy, total};
 * total null when the run made no request. The S5 gate at 45 counts the same
 * (§8.7 "S5 bei 45 Bearbeitern: 0 × busy wie S4 Regel 2"; W3E-06/AUD-01).
 */
export function rule2Errors(rep) {
	const t = rep.totals || {}
	const codes = rep.opCodes || {}
	const unexpected = Object.entries(codes).filter(([k]) => !['ok', 'busy', ...GATE_S4.allowed4xx].includes(k)).reduce((a, [, n]) => a + n, 0)
	const v = { status5xx: t.status5xx ?? 0, timeouts: t.timeouts ?? 0, netErrors: t.netErrors ?? 0, status4xx: t.status4xx ?? 0, unexpectedCodes: unexpected, busy: rep.budget?.busy ?? 0 }
	return { ...v, total: t.requests ? Object.values(v).reduce((a, n) => a + n, 0) : null }
}

/**
 * The knee's errors of one S5 step (§8.7 "Weitere"; R21, P2B-01): the errors of S4 rule 2 (rule2Errors, as the S5
 * gate at 45 counts them) without `busy` – {errors, requests, share}; errors null and share 1 when the step made
 * no request (as before: such a step is the knee).
 */
export function kneeErrors(rep) {
	const e = rule2Errors(rep)
	const requests = rep.totals?.requests ?? 0
	const errors = e.total === null ? null : e.total - e.busy
	return { errors, requests, share: requests ? errors / requests : 1 }
}

/** Latency classes of rule 4 → endpoint keys of the report. */
export const LATENCY_KEYS = Object.freeze({ syncEmpty: 'sync-empty', syncItems: 'sync-items', syncOps: 'sync-ops', syncVote: 'sync-vote', snapshot: 'snapshot' })

export function evaluateS4(rep) {
	const g = GATE_S4
	const c = rep.checks || {}
	const t = rep.totals || {}
	const e2 = rule2Errors(rep)
	const rules = []
	rules.push(rule(1, 'Korrektheit (K1, K2, K3, Abstimmung, Protokoll)',
		all(c.k1?.ok ?? null, c.k2?.ok ?? null, c.k3?.ok ?? null, c.votes?.ok ?? null, (rep.protocolErrors || []).length === 0),
		{ k1: c.k1 ? `${c.k1.equal}/${c.k1.clients}` : null, k2: c.k2?.ok ?? null, k3: c.k3 ? `${c.k3.checked - c.k3.failures}/${c.k3.checked}` : null, votes: c.votes?.ok ?? null, protocolErrors: (rep.protocolErrors || []).length },
		'alle gleich, 0 Protokollfehler'))
	rules.push(rule(2, 'Fehler', e2.total === null ? null : e2.total === 0,
		{ status5xx: t.status5xx, timeouts: t.timeouts, netErrors: t.netErrors, status4xx: t.status4xx, unexpectedCodes: e2.unexpectedCodes, busy: rep.budget?.busy ?? null },
		`0 × 5xx, 0 Zeitüberschreitungen, 0 unerwartete Codes (${g.allowed4xx.join('/')} erlaubt), 0 × busy`))
	const e = rep.edge
	rules.push(rule(3, 'Edge (Modell)', e ? all(e.rejected === g.edge.rejected, le(e.meanRps, g.edge.meanRpsMax), le(e.max10sRps, g.edge.max10sRpsMax), ge(e.minTokens, g.edge.minTokensMin)) : null,
		e ? { rejected: e.rejected, meanRps: e.meanRps, max10sRps: e.max10sRps, minTokens: e.minTokens } : null,
		`0 Ablehnungen; Mittel ≤ ${g.edge.meanRpsMax}/s; 10-s-Rate ≤ ${g.edge.max10sRpsMax}; Eimer ≥ ${g.edge.minTokensMin}/400`))
	const lat = {}
	const latOk = []
	for (const [name, key] of Object.entries(LATENCY_KEYS)) {
		const s = rep.latency?.[key] ?? rep.endpoints?.[key]
		if (!s || !s.n) { lat[name] = null; latOk.push(name === 'syncVote' && !rep.config?.workshop ? true : null); continue }
		lat[name] = { p95: s.p95, p99: s.p99, max: s.max, n: s.n }
		latOk.push(all(le(s.p95, g.latencyP95Ms[name]), le(s.p99, g.p99OverP95Max * s.p95), le(s.max, g.latencyMaxMs)))
	}
	rules.push(rule(4, 'Latenz p95 (Server)', all(...latOk), lat, { p95: g.latencyP95Ms, p99: '≤ 2 × p95', maxMs: g.latencyMaxMs }))
	const m = rep.metrics || {}
	const ncPg = m.ncPgCoresMean ?? null
	rules.push(rule(5, 'CPU (cgroup)', all(le(ncPg, g.cpu.ncPgCoresHard), le(m.msPerRequest ?? null, g.cpu.msPerRequestMax)),
		{ ncPgCoresMean: ncPg, msPerRequest: m.msPerRequest ?? null, targetMet: typeof ncPg === 'number' ? ncPg <= g.cpu.ncPgCoresTarget : null },
		`NC + PG ≤ ${g.cpu.ncPgCoresHard} Kerne (Ziel ${g.cpu.ncPgCoresTarget}), ≤ ${g.cpu.msPerRequestMax} ms je Anfrage`))
	rules.push(rule(6, 'Sättigung', all(le(m.apache?.busy?.max ?? null, g.apacheBusyMax), le(m.postgres?.numbackends?.max ?? null, g.pgBackendsMax), m.nextcloudLog ? m.nextcloudLog.tooManyClients === 0 : null),
		{ apacheBusyMax: m.apache?.busy?.max ?? null, pgBackendsMax: m.postgres?.numbackends?.max ?? null, tooManyClients: m.nextcloudLog?.tooManyClients ?? null },
		`Apache busy ≤ ${g.apacheBusyMax}/150; PG numbackends ≤ ${g.pgBackendsMax}; 0 × too many clients`))
	rules.push(rule(7, 'Hygiene', all(m.nextcloudLog ? m.nextcloudLog.knorke.atLeast3 === 0 : null, rep.hygiene ? rep.hygiene.noTtl === 0 : null),
		{ knorkeLogAtLeast3: m.nextcloudLog?.knorke?.atLeast3 ?? null, keysWithoutTtl: rep.hygiene?.noTtl ?? null },
		'0 Knorke-Logeinträge ≥ 3; keine r:/p:/vt:/w:/wo: ohne TTL (R19)'))
	const p = rep.presence || {}
	rules.push(rule(8, 'Präsenz', all(le(p.cursorLagMs?.p95 ?? null, g.presence.cursorLagP95Ms), le(p.blobBytes?.max ?? null, g.presence.blobMaxBytes), rep.config?.tablets ? le(p.followLagMs?.p95 ?? null, g.presence.followLagMs) : true),
		{ cursorLagP95: p.cursorLagMs?.p95 ?? null, blobMax: p.blobBytes?.max ?? null, followLagP95: p.followLagMs?.p95 ?? null, followLagMax: p.followLagMs?.max ?? null },
		`Cursor p95 ≤ ${g.presence.cursorLagP95Ms} ms; Blob ≤ 150 KiB; Folgen ≤ ${g.presence.followLagMs} ms`))
	const bw = t.bytesPerSec ?? null
	rules.push(rule(9, 'Bandbreite (nur Bericht)', true, { bytesPerSec: bw, bytesPlainPerSec: t.bytesPlainPerSec ?? null }, `Warnung > ${g.bandwidthWarnBytesPerS} B/s komprimiert`, { warn: typeof bw === 'number' && bw > g.bandwidthWarnBytesPerS }))
	return { kind: 's4', ok: rules.filter((r) => r.rule <= 8).every((r) => r.ok === true), rules }
}

export function evaluateS5(rep) {
	const steps = rep.steps || []
	const at = steps.find((s) => s.config?.editors >= GATE_S5.at)
	// the verdict: the maximum of the class p95 (W3B-02, user decision 14.10.); class and pooled p95 beside it (G1, report only)
	const p95 = (s) => Math.max(...['sync-empty', 'sync-items', 'sync-ops', 'sync-vote'].map((k) => s.endpoints?.[k]?.p95 ?? 0))
	const maxClass = (s) => ['sync-empty', 'sync-items', 'sync-ops', 'sync-vote'].reduce((b, k) => (typeof s.endpoints?.[k]?.p95 === 'number' && (b === null || s.endpoints[k].p95 > s.endpoints[b].p95) ? k : b), null)
	// the error definition of S4 rule 2 (W3E-06/AUD-01): 5xx, timeouts, net errors, 4xx, unexpected op codes, busy
	const errs = (s) => (s.totals ? rule2Errors(s) : null)
	const kneeAt = rep.knee?.editors ?? Infinity
	const before = steps.filter((s) => s.config?.editors < kneeAt)
	const e45 = at ? errs(at) : null
	const rules = [
		rule(1, `Gate bei ${GATE_S5.at} Bearbeitern`, at ? all(e45 ? (e45.total === null ? null : e45.total === 0) : null, le(p95(at), GATE_S5.p95Ms), at.edge ? at.edge.rejected === 0 : null) : null,
			at ? { editors: at.config.editors, errors: e45?.total ?? null, errorsBy: e45 ? { status5xx: e45.status5xx, timeouts: e45.timeouts, netErrors: e45.netErrors, status4xx: e45.status4xx, unexpectedCodes: e45.unexpectedCodes, busy: e45.busy } : null, syncP95: p95(at), syncP95Class: maxClass(at), syncP95Pooled: at.latency?.syncPooled?.p95 ?? null, edgeRejected: at.edge?.rejected ?? null } : null,
			`0 Fehler wie S4 Regel 2 (5xx, Zeitüberschreitungen, Netzfehler, unerwartete 4xx und Codes – ${GATE_S4.allowed4xx.join('/')} erlaubt –, busy), p95 ≤ ${GATE_S5.p95Ms} ms (Maximum der Klassen-p95; gepoolter p95 nur Bericht), Edge 0 Ablehnungen`),
		rule(2, '0 Abweichungen bis zum Knie', before.length ? all(...before.map((s) => s.checks?.ok ?? null)) : null, before.map((s) => ({ editors: s.config?.editors, ok: s.checks?.ok ?? null })), 'K1–K3 grün je Stufe'),
		rule(3, 'Knie (Bericht)', true, rep.knee, `p95 Sync > ${GATE_S5.kneeP95Ms} ms oder ≥ ${GATE_S5.kneeErrorShare * 100} % Fehler`),
	]
	return { kind: 's5', ok: rules[0].ok === true && rules[1].ok === true, rules }
}

export function evaluateSF(rep) {
	const f = rep.faults || {}
	const rules = [
		rule(1, 'K1–K3 ohne Abweichung', rep.checks ? all(rep.checks.k1?.ok ?? null, rep.checks.k2?.ok ?? null, rep.checks.k3?.ok ?? null) : null, rep.checks ? { k1: rep.checks.k1?.ok, k2: rep.checks.k2?.ok, k3: rep.checks.k3?.ok } : null, '0 Abweichungen'),
		// G3 (p2d): a device without a successful sync after the fault's end is not recovered – red, never skipped
		rule(2, `Erholung ≤ ${GATE_SF.recoveryS} s je Fehler`, Array.isArray(f.played) && f.played.length ? f.played.every((x) => typeof x.recoveryS === 'number' && x.recoveryS <= GATE_SF.recoveryS && !(x.notRecovered > 0)) : null, f.played ?? null,
			`≤ ${GATE_SF.recoveryS} s; jedes Gerät mit erfolgreichem Sync nach Fehlerende (sonst nicht erholt = rot); neu angemeldete Geräte getrennt berichtet`),
		// 401: reading (a) – counts when SENT after the end of the restart window; during it reported, not counted (W3E-02)
		rule(3, `5xx nur ±${GATE_SF.fiveXxWindowS} s um Fehlerfenster, 0 × 401 nach Redis-Neustart`, f.fiveXxOutside === undefined ? null : f.fiveXxOutside === 0 && f.unauthorizedAfterRedis === 0,
			{ fiveXxOutside: f.fiveXxOutside ?? null, unauthorizedAfterRedis: f.unauthorizedAfterRedis ?? null, unauthorizedDuringRedis: f.unauthorizedDuringRedis ?? null, countedBy: f.countedBy ?? null },
			'beides 0; je Gerät und Sitzung zählt das erste 401, wenn die Anfrage nach dem Ende des Redis-Neustart-Fensters gesendet wurde (während des Neustarts gesendete werden berichtet, zählen nicht)'),
	]
	return { kind: 'sf', ok: rules.every((r) => r.ok === true), rules }
}

export function evaluateSC(rep) {
	const m = (rep.coldStart || []).find((x) => x.spreadS === GATE_SC.spreadS)
	// T4-11: without measured page requests the model is no proof (85/34 "nicht gemessen")
	const measured = rep.pageRequests ? rep.pageRequests.measured === true : true
	const rules = [
		rule(1, `Modell: ${GATE_SC.spreadS} s Ankunft`, m ? (measured ? m.rejected === GATE_SC.rejected : null) : null, m ? { rejected: m.rejected, minTokens: m.minTokens, max10sRps: m.max10sRps } : null, '0 Ablehnungen, mit gemessenen Seitenzahlen'),
		rule(2, 'Modell: alle Verteilungen (Bericht)', true, (rep.coldStart || []).map((x) => ({ spreadS: x.spreadS, rejected: x.rejected })), 'Bericht'),
		rule(3, 'Seitenzahlen (Quelle)', measured, rep.pageRequests ?? null, 'gemessen unmittelbar vor SC (--page-requests); sonst nicht gemessen'),
	]
	return { kind: 'sc', ok: rules[0].ok === true, rules }
}

/** The pass rules that decide a scenario's exit code; report-only scenarios get ok null. */
export function evaluate(rep) {
	if (rep.aborted) {
		// §8.7 "Weitere" (R19, T4-10)
		if (rep.scenario === 'S5' && step45Complete(rep.steps)) {
			const upTo = completeSteps(rep.steps).filter((x) => x.config.editors <= GATE_S5.at)
			const g = evaluateS5({ ...rep, steps: upTo, knee: null })
			return { ...g, abortedAfter45: true, note: `Abbruch durch den Lastschutz nach der vollständigen Stufe ${GATE_S5.at}: nur S5 beendet; bewertet über die Stufen bis ${GATE_S5.at}; Knie ${rep.knee?.text ?? '—'}` }
		}
		return { kind: rep.scenario === 'S5' ? 's5' : 'aborted', ok: false, invalid: true, rules: [], note: `Abbruch durch den Lastschutz (${rep.aborted.reason ?? '—'}): Lauf ungültig, kein Ergebnis; Wiederholung nur in einem neuen, vom Nutzer freigegebenen Zeitfenster (§8.7)` }
	}
	switch (rep.scenario) {
		case 'S4': case 'S4e': return evaluateS4(rep)
		case 'S5': return evaluateS5(rep)
		case 'SF': return evaluateSF(rep)
		case 'SC': return evaluateSC(rep)
		default: return { kind: 'report', ok: null, rules: [] }
	}
}
