/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pure helpers of the E2E runner (no Playwright, no env.json), so they can be
 * tested on the host with `node --test 'dev/e2e/*.test.mjs'`:
 *
 * - parseArgs: --only, --repeat, --list, --selftest
 * - reportId / selectScenarios: SPEC-M1 §8.4 (R16, TST-10) viewport passes are
 *   passes of the same case – a scenario with `pass` reports as
 *   "<id>@<pass>" (E31@390x844); --only E31 takes every pass of E31,
 *   --only E31@390x844 exactly that one
 * - flakeSummary: green runs per scenario over all repetitions (flake gate)
 * - traceMarkdown: the /sync trace of the actors as a Markdown section, so a
 *   red report keeps the whole protocol trace (report.md table cells are cut
 *   at 600 characters, sections are not)
 */

export const MAX_REPEAT = 20

/**
 * @param {string[]} argv arguments after `node run.mjs`
 * @return {{only: Set<string>|null, repeat: number, list: boolean, selftest: boolean}}
 * @throws {Error} on a malformed --only or --repeat
 */
export function parseArgs(argv) {
	const out = { only: null, repeat: 1, list: false, selftest: false }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--list') out.list = true
		else if (a === '--selftest') out.selftest = true
		else if (a === '--only' || a === '--repeat') {
			const v = argv[i + 1]
			if (v === undefined || v.startsWith('--')) throw new Error(`${a} braucht einen Wert`)
			i++
			if (a === '--only') {
				const ids = v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
				if (!ids.length) throw new Error('--only ohne Fall')
				out.only = new Set(ids)
			} else {
				if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > MAX_REPEAT) {
					throw new Error(`--repeat erwartet 1–${MAX_REPEAT}, nicht „${v}“`)
				}
				out.repeat = Number(v)
			}
		} else if (a.startsWith('--only=') || a.startsWith('--repeat=')) {
			const [k, v] = a.split('=')
			const sub = parseArgs([k, v])
			if (k === '--only') out.only = sub.only
			else out.repeat = sub.repeat
		} else {
			throw new Error(`unbekanntes Argument „${a}“`)
		}
	}
	return out
}

/** Passes of a case (SPEC-M1 §8.4 R16): the viewport as <width>x<height>. */
export const PASS_RE = /^\d{3,4}x\d{3,4}$/

/**
 * The report id of a scenario: its id, or "<id>@<pass>" for a viewport pass
 * of the same case (SPEC-M1 §8.4 R16, e.g. E31@390x844).
 * @param {{id: string, pass?: string}} sc scenario
 * @return {string}
 */
export function reportId(sc) {
	if (sc.pass === undefined || sc.pass === null) return sc.id
	if (!PASS_RE.test(String(sc.pass))) throw new Error(`${sc.id}: Durchgang '${sc.pass}' ist ungültig (<Breite>x<Höhe>)`)
	return `${sc.id}@${sc.pass}`
}

/**
 * Report ids of the scenarios of `all` that `only` selects, in execution
 * order; unknown ids in `only` are reported, never silently ignored. A case
 * id selects all its passes, a report id with "@" exactly that pass.
 *
 * @param {Array<{id: string, pass?: string}>} all scenarios in execution order
 * @param {Set<string>|null} only upper-case ids or null
 * @return {{ids: string[], unknown: string[]}}
 */
export function selectScenarios(all, only) {
	if (!only) return { ids: all.map(reportId), unknown: [] }
	const known = new Set(all.flatMap((s) => [s.id.toUpperCase(), reportId(s).toUpperCase()]))
	return {
		ids: all.filter((s) => only.has(s.id.toUpperCase()) || only.has(reportId(s).toUpperCase())).map(reportId),
		unknown: [...only].filter((id) => !known.has(id)),
	}
}

/**
 * A skipped run (record with `skipped`, the reason) is counted in `runs` and
 * `skipped`, never as green and never as red.
 *
 * @param {Array<{id: string, rep: number, green: boolean, skipped?: string}>} results one record per scenario and repetition
 * @return {Array<{id: string, runs: number, green: number, skipped: number, redReps: number[]}>} in first-seen order
 */
export function flakeSummary(results) {
	const by = new Map()
	for (const r of results) {
		if (!by.has(r.id)) by.set(r.id, { id: r.id, runs: 0, green: 0, skipped: 0, redReps: [] })
		const s = by.get(r.id)
		s.runs++
		if (r.skipped) s.skipped++
		else if (r.green) s.green++
		else s.redReps.push(r.rep)
	}
	return [...by.values()]
}

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * Markdown section with the protocol trace of several actors, merged in time
 * order. Entries are either /sync requests ({at, seq, tk, e, ops, texts, res,
 * holder, rev}) or events ({at, ev}) the scenario recorded.
 *
 * @param {string} title heading text
 * @param {Array<{name: string, trace: object[]}>} actors
 * @param {{since?: number, facts?: string[]}} [o] since = epoch ms (earlier entries dropped); facts = lines above the table
 * @return {string} Markdown
 */
export function traceMarkdown(title, actors, { since = 0, facts = [] } = {}) {
	const rows = []
	for (const a of actors) for (const e of a.trace || []) if ((e.at ?? 0) >= since) rows.push({ who: a.name, ...e })
	rows.sort((x, y) => (x.at ?? 0) - (y.at ?? 0))
	const t0 = rows.length ? rows[0].at : since
	const lines = [`### ${title}`, '']
	for (const f of facts) lines.push(`- ${f}`)
	if (facts.length) lines.push('')
	if (!rows.length) {
		lines.push('_(keine /sync-Einträge im Fenster)_', '')
		return lines.join('\n')
	}
	lines.push('| +ms | Wer | seq | e | tk | Ops | Texte | acks.res | Halter von e | rev |', '|---|---|---|---|---|---|---|---|---|---|')
	for (const r of rows) {
		const ms = (r.at ?? t0) - t0
		if (r.ev) {
			lines.push(`| ${ms} | ${cell(r.who)} | – | – | – | – | **${cell(r.ev)}** | – | – | – |`)
			continue
		}
		lines.push(`| ${ms} | ${cell(r.who)} | ${cell(r.seq ?? '–')} | ${cell(r.e ?? '–')} | ${r.tk ? '**1**' : '0'} | ${r.ops ?? 0} | ${cell((r.texts || []).map((s) => JSON.stringify(s)).join(' '))} | ${cell(r.res ? r.res.join(',') : (r.pending ? '(offen)' : '–'))} | ${cell(r.holder ?? '–')} | ${cell(r.rev ?? '–')} |`)
	}
	lines.push('')
	return lines.join('\n')
}
