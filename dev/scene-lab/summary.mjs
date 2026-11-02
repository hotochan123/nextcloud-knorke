/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Summary of several measurement runs against the M1 thresholds (factory
 * job 214):
 *
 *   node dev/scene-lab/summary.mjs dev/scene-lab/out/measure-chromium-*-r?.json
 *
 * Groups the runs by browser, set and variant (cpu|gpu), takes the median
 * of every threshold value over the runs of a group (thresholds.js), judges
 * the medians and prints a markdown table: set, variant, runs (a note below
 * three), S1–S5 with their values and PASS/FAIL, the host's 1-minute load
 * average during the runs (measure.json loadavg, max over the group), then
 * one line per failed threshold. Exit 0 with a table, 2 on a usage error or
 * a file that is no measurement. Runs on the host, no browser.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { THRESHOLDS, evaluate, valueAt } from './thresholds.js'

/** Runs a group should have (SPEC-M1 §8.8 point 4: three per scenario). */
export const RUNS = 3

/**
 * @param {Array<number|null>} values values of the runs
 * @return {number|null} the median of the numbers among them (two middles: their mean), null without one
 */
export function median(values) {
	const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
	if (v.length === 0) return null
	const m = Math.floor(v.length / 2)
	const r = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
	return Math.round(r * 1000) / 1000
}

/**
 * @param {object} run measure-*.json
 * @return {string} the group of a run: browser, set, variant
 */
export function groupKey(run) {
	return `${run.engine ?? 'chromium'}|${run.set ?? 'm1'}|${run.gpu === true ? 'gpu' : 'cpu'}`
}

/**
 * @param {object} obj target
 * @param {string} path dotted path
 * @param {unknown} value value
 */
function setPath(obj, path, value) {
	const keys = path.split('.')
	let o = obj
	for (const k of keys.slice(0, -1)) o = o[k] ??= {}
	o[keys[keys.length - 1]] = value
}

/**
 * @param {object[]} runs measure-*.json of any sets and variants
 * @return {Array<{engine: string, set: string, variant: string, runs: number, labels: string[], load: (number|null), verdicts: ReturnType<typeof evaluate>}>}
 *   one entry per group, in the order of first appearance
 */
export function summarize(runs) {
	const groups = new Map()
	for (const run of runs) {
		const k = groupKey(run)
		if (!groups.has(k)) groups.set(k, [])
		groups.get(k).push(run)
	}
	return [...groups.entries()].map(([k, list]) => {
		const [engine, set, variant] = k.split('|')
		const medians = {}
		for (const t of THRESHOLDS) {
			for (const c of t.checks) setPath(medians, c.path, median(list.map((r) => valueAt(r, c.path))))
		}
		const loads = list.flatMap((r) => [r.loadavg?.start?.[0], r.loadavg?.end?.[0]]).filter((x) => typeof x === 'number')
		return {
			engine, set, variant, runs: list.length, labels: list.map((r) => r.label ?? '–'),
			load: loads.length ? Math.max(...loads) : null, verdicts: evaluate(medians),
		}
	})
}

/**
 * @param {ReturnType<typeof summarize>} groups summarize()
 * @return {string[]} markdown lines
 */
export function summaryLines(groups) {
	const cell = (v) => `${v.checks.map((c) => (c.value === null ? '–' : String(c.value))).join(' / ')} ${v.ok ? 'PASS' : '**FAIL**'}`
	const lines = [
		`| Browser | Satz | Variante | Läufe | ${THRESHOLDS.map((t) => `${t.id} ${t.name} (${t.checks.map((c) => `${c.label} ${c.op === '<=' ? '≤' : '≥'} ${c.limit}`).join(', ')})`).join(' | ')} | Last 1 min |`,
		`|---|---|---|---|${THRESHOLDS.map(() => '---').join('|')}|---|`,
		...groups.map((g) => `| ${g.engine} | ${g.set} | ${g.variant} | ${g.runs}${g.runs < RUNS ? ` (weniger als ${RUNS})` : ''} | ${g.verdicts.map(cell).join(' | ')} | ${g.load ?? '–'} |`),
		'',
		'Werte: Median der Läufe je Größe; Urteil auf den Medianen (gleich der Grenze: bestanden, fehlend: FAIL).',
	]
	const failed = groups.flatMap((g) => g.verdicts.filter((v) => !v.ok).map((v) => `- ${g.set} ${g.variant}: ${v.id} ${v.name} – ` +
		v.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.value === null ? 'fehlt' : c.value} (Grenze ${c.op === '<=' ? '≤' : '≥'} ${c.limit})`).join(', ')))
	lines.push('', failed.length ? 'Gerissene Schwellen:' : 'Keine Schwelle gerissen.', ...(failed.length ? ['', ...failed] : []))
	return lines
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const files = process.argv.slice(2)
	if (files.length === 0) {
		console.error('usage: node dev/scene-lab/summary.mjs <measure-*.json …>')
		process.exit(2)
	}
	const runs = []
	for (const f of files) {
		let run
		try {
			run = JSON.parse(readFileSync(f, 'utf8'))
		} catch (e) {
			console.error(`summary.mjs: ${f}: ${e.message}`)
			process.exit(2)
		}
		if (!run || typeof run !== 'object' || !run.pan || !run.fit) {
			console.error(`summary.mjs: ${basename(f)} is no measurement (run.sh measure)`)
			process.exit(2)
		}
		runs.push(run)
	}
	console.log(summaryLines(summarize(runs)).join('\n'))
}
