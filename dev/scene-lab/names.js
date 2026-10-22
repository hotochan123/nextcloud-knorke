/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * File names of the lab reports (SPEC-M1 §9.0 (R15) "Laufbelege" point 2,
 * (R16) TST-12, §9.4 WP-S3, R18-C2): every run keeps its own reports, so
 * two runs of one phase never overwrite each other's evidence.
 *
 *   gates:   gates-<variant>[-<label>].{json,md}
 *   measure: measure-<browser>-<variant>[-<set>][-noshadow][-<label>].json
 *            report-<browser>-<variant>[-<set>][-noshadow][-<label>].md
 *   ipad:    ipad-check[-<label>].{json,md} (ipad/check.mjs; it drives both
 *            engines itself, so neither variant nor browser nor set names it)
 *
 * <variant> = cpu | gpu (KNORKE_GPU=1), <browser> = chromium | webkit, <set>
 * only for a set other than the default m1 (e.g. noconn), -noshadow only for
 * a measurement without note shadows (--shadows off, SPEC-M1 §8.5 and §9.0
 * point 2 R20, K8), so it never overwrites the report with shadows; <label>
 * = the optional KNORKE_LAB_LABEL (^[a-z0-9-]{1,24}$, run.sh passes it as
 * --label). gates.{json,md}, measure.json, report.md and ipad-check.{json,md}
 * stay as copies of the last run (webkit-gpu.mjs and the docs read them;
 * without a label the ipad report and its copy are one file). run.mjs and
 * ipad/check.mjs remove the files of their run before they start, so a
 * broken run leaves no stale report under its name. Pure; unit tested in
 * dev/scene-lab/test/names.test.mjs.
 */

/** KNORKE_LAB_LABEL / --label: lower-case letters, digits, dashes, 1–24 characters. */
export const LABEL_RE = /^[a-z0-9-]{1,24}$/

/**
 * @param {{mode:('gates'|'measure'|'ipad'), gpu?:boolean, browser?:string, set?:string, shadows?:('on'|'off'),
 *          label?:(string|null)}} o run (shadows: run.mjs --shadows, names measure only)
 * @return {{json:string, md:string, copies:{json:string, md:string}}} file names (no directory)
 * @throws {Error} for an invalid label, mode, browser (measure), set (measure) or shadows (measure)
 */
export function reportFiles({ mode, gpu, browser = 'chromium', set = 'm1', shadows = 'on', label = null }) {
	if (label !== null && label !== undefined && !LABEL_RE.test(label)) throw new Error(`invalid run label ${JSON.stringify(label)} (${LABEL_RE})`)
	const variant = gpu === true ? 'gpu' : 'cpu'
	const tail = label ? `-${label}` : ''
	if (mode === 'gates') {
		const stem = `gates-${variant}${tail}`
		return { json: `${stem}.json`, md: `${stem}.md`, copies: { json: 'gates.json', md: 'gates.md' } }
	}
	if (mode === 'measure') {
		if (!['chromium', 'webkit'].includes(browser)) throw new Error(`invalid browser ${JSON.stringify(browser)}`)
		if (typeof set !== 'string' || !/^[a-z0-9]{1,16}$/.test(set)) throw new Error(`invalid set ${JSON.stringify(set)}`)
		if (!['on', 'off'].includes(shadows)) throw new Error(`invalid shadows ${JSON.stringify(shadows)}`)
		// K8 (RSC-03): a run without note shadows keeps its own name after the set
		const stem = `${browser}-${variant}${set === 'm1' ? '' : `-${set}`}${shadows === 'off' ? '-noshadow' : ''}${tail}`
		return { json: `measure-${stem}.json`, md: `report-${stem}.md`, copies: { json: 'measure.json', md: 'report.md' } }
	}
	if (mode === 'ipad') {
		// R18-C2: the tablet package check takes the label like gates and measure
		const stem = `ipad-check${tail}`
		return { json: `${stem}.json`, md: `${stem}.md`, copies: { json: 'ipad-check.json', md: 'ipad-check.md' } }
	}
	throw new Error(`no report names for mode ${JSON.stringify(mode)}`)
}
