/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Measurement series of the lab (SPEC-M1 §16: WebKit with the GPU as an
 * approximation of Safari, before stage 1 phase 0). Pure helpers without
 * Playwright and without file access: webkit-gpu.mjs runs
 * "run.sh measure" several times per variant and keeps every measure.json;
 * these functions reduce them to the median and the range per figure,
 * apply the decision rule of SPEC-M1 §8.8 point 6 as a hint and write the
 * report (German like out/report.md). Unit tested in
 * dev/scene-lab/test/series.test.mjs. (R12) The whole-board pan (boardPan,
 * since round 1b; LOD 2 since stage 2) is part of the figures.
 */

/**
 * The variants of the series. env goes to run.sh (KNORKE_GPU, KNORKE_LAB_*),
 * args to run.mjs; every variant sets all variables, so nothing leaks in from
 * the caller.
 */
export const VARIANTS = Object.freeze([
	{ id: 'webkit-sw', label: 'WebKit ohne GPU', env: { KNORKE_LAB_BROWSER: 'webkit', KNORKE_GPU: '0', KNORKE_LAB_WEBKIT_SKIA: 'cpu' } },
	{ id: 'webkit-gpu', label: 'WebKit mit KNORKE_GPU=1', env: { KNORKE_LAB_BROWSER: 'webkit', KNORKE_GPU: '1', KNORKE_LAB_WEBKIT_SKIA: 'cpu' } },
	{
		// everything the build offers towards the GPU: no forced CPU painting, the
		// render node named for the web process (GBM path of WebGL)
		id: 'webkit-gpu-max', label: 'WebKit mit KNORKE_GPU=1, ohne CPU-Zwang, Render-Knoten gesetzt',
		env: { KNORKE_LAB_BROWSER: 'webkit', KNORKE_GPU: '1', KNORKE_LAB_WEBKIT_SKIA: 'gpu' },
		args: ['--browser-env', 'WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128'],
	},
	{ id: 'chromium-gpu', label: 'Chromium mit KNORKE_GPU=1 (Bezug)', env: { KNORKE_LAB_BROWSER: 'chromium', KNORKE_GPU: '1', KNORKE_LAB_WEBKIT_SKIA: 'cpu' } },
].map((v) => Object.freeze(v)))

/** The three variants of the task; webkit-gpu-max is an extra on request. */
export const DEFAULT_VARIANTS = Object.freeze(['webkit-sw', 'webkit-gpu', 'chromium-gpu'])

/**
 * @param {number[]} values numbers (non-finite ones ignored)
 * @return {number|null} median (mean of the two middle values for an even count)
 */
export function median(values) {
	const s = values.filter(Number.isFinite).sort((a, b) => a - b)
	if (!s.length) return null
	const m = s.length >> 1
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * @param {number[]} values numbers (non-finite ones ignored)
 * @return {{median: number|null, min: number|null, max: number|null, n: number}}
 */
export function spread(values) {
	const s = values.filter(Number.isFinite)
	return { median: median(s), min: s.length ? Math.min(...s) : null, max: s.length ? Math.max(...s) : null, n: s.length }
}

/**
 * The figures of SPEC-M1 §8.8 points 5/6 from one measure.json.
 *
 * @param {object} m measure.json of run.mjs --mode measure
 * @return {Object<string, number|null>} figure → value
 */
export function runFigures(m) {
	const out = {
		firstRenderMs: m.firstRenderMs ?? null,
		boardFirstRenderMs: m.fit?.ms ?? null,
	}
	for (const s of ['pan', 'zoom', 'board', 'boardPan', 'drag']) {
		const f = m[s]?.frames ?? {}
		out[`${s}Fps`] = f.fps ?? null
		out[`${s}Missed`] = f.pctMissed ?? null
		out[`${s}P50`] = f.p50 ?? null
		out[`${s}P95`] = f.p95 ?? null
	}
	out.gfxMs = m.gpuEvidence?.verdict?.gfxMs ?? null
	return out
}

/**
 * Rows of the report table: [figure key, label, unit].
 */
export const ROWS = Object.freeze([
	['panFps', 'Schwenken fps', ''],
	['panMissed', 'Schwenken verpasst', '%'],
	['panP50', 'Schwenken Frame p50', 'ms'],
	['panP95', 'Schwenken Frame p95', 'ms'],
	['zoomFps', 'Zoomen fps', ''],
	['zoomMissed', 'Zoomen verpasst', '%'],
	['zoomP50', 'Zoomen Frame p50', 'ms'],
	['zoomP95', 'Zoomen Frame p95', 'ms'],
	['boardFps', 'Zoom aufs ganze Board fps', ''],
	['boardMissed', 'Zoom aufs ganze Board verpasst', '%'],
	['boardP50', 'Zoom aufs ganze Board Frame p50', 'ms'],
	['boardP95', 'Zoom aufs ganze Board Frame p95', 'ms'],
	['boardPanFps', 'Ganzes Board schwenken fps', ''],
	['boardPanMissed', 'Ganzes Board schwenken verpasst', '%'],
	['boardPanP50', 'Ganzes Board schwenken Frame p50', 'ms'],
	['boardPanP95', 'Ganzes Board schwenken Frame p95', 'ms'],
	['dragFps', 'Notiz ziehen fps', ''],
	['firstRenderMs', 'Erstes Rendern (Laden)', 'ms'],
	['boardFirstRenderMs', 'Erstes Rendern ganzes Board (fit)', 'ms'],
	['gfxMs', 'gfx-Engine der GPU während der Szenarien', 'ms'],
])

/**
 * Median and range of every figure over the runs of one variant, plus the
 * GPU verdicts of the runs.
 *
 * @param {object[]} runs measure.json objects of one variant
 * @return {{n: number, figures: Object<string, ReturnType<typeof spread>>, verdicts: string[]}}
 */
export function aggregate(runs) {
	const figs = runs.map(runFigures)
	const figures = {}
	for (const [key] of ROWS) figures[key] = spread(figs.map((f) => f[key]))
	return { n: runs.length, figures, verdicts: runs.map((m) => m.gpuEvidence?.verdict?.verdict ?? 'n/a') }
}

/**
 * Decision rule of SPEC-M1 §8.8 point 6 on the medians of one variant. For
 * the container this is a HINT only: the rule is written for the device.
 *
 * @param {ReturnType<typeof aggregate>} agg aggregate of one variant
 * @return {{lod2: boolean, lod2Reasons: string[], profiling: boolean, profilingReasons: string[]}}
 */
export function ruleHint(agg) {
	const m = (k) => agg.figures[k]?.median
	const lod2Reasons = []
	if (m('boardFps') !== null && m('boardFps') < 30) lod2Reasons.push(`Zoom aufs ganze Board ${fmt(m('boardFps'))} fps < 30`)
	if (m('boardMissed') !== null && m('boardMissed') > 25) lod2Reasons.push(`Zoom aufs ganze Board ${fmt(m('boardMissed'))} % verpasst > 25 %`)
	if (m('firstRenderMs') !== null && m('firstRenderMs') > 1000) lod2Reasons.push(`erstes Rendern ${fmt(m('firstRenderMs'), 0)} ms > 1 s`)
	if (m('boardFirstRenderMs') !== null && m('boardFirstRenderMs') > 1000) lod2Reasons.push(`erstes Rendern ganzes Board ${fmt(m('boardFirstRenderMs'), 0)} ms > 1 s`)
	const profilingReasons = m('panFps') !== null && m('panFps') < 45 ? [`Schwenken ${fmt(m('panFps'))} fps < 45`] : []
	return { lod2: lod2Reasons.length > 0, lod2Reasons, profiling: profilingReasons.length > 0, profilingReasons }
}

/**
 * @param {number|null} v value
 * @param {number} [d] decimals
 * @return {string} German decimal comma, "–" for null
 */
export function fmt(v, d = 1) {
	if (v === null || v === undefined || !Number.isFinite(v)) return '–'
	return (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('de-DE', { maximumFractionDigits: d })
}

/**
 * @param {ReturnType<typeof spread>} s spread
 * @param {number} [d] decimals
 * @return {string} "median (min–max)"
 */
export function cell(s, d = 1) {
	if (!s || s.median === null) return '–'
	return s.n > 1 ? `${fmt(s.median, d)} (${fmt(s.min, d)}–${fmt(s.max, d)})` : fmt(s.median, d)
}

/**
 * Report of the series.
 *
 * @param {{at: string, env: object, variants: Array<{id: string, label: string, agg: ReturnType<typeof aggregate>, sample: object|null}>}} s summary (webkit-gpu.json)
 * @return {string} markdown
 */
export function seriesMarkdown(s) {
	const vs = s.variants
	const lines = [
		'# WebKit mit GPU im Labor-Container – Annäherung an Safari',
		'',
		`Stand ${s.at}. SPEC-M1 §16: Labor-Lauf mit WebKit und GPU im Container ([S], vor Stufe-1-Phase 0). ` +
			'**Container ≠ Gerät:** Die Zahlen sind keine iPad- und keine Android-Werte; sie zeigen nur, wie sich WebKit und Chromium ' +
			'auf demselben Rechner mit derselben Szene unterscheiden.',
		'',
		'## Umgebung',
		'',
		`- Image: \`${s.env.image}\`; Playwright ${s.env.playwright}; ${s.env.browsers.join('; ')}`,
		`- Viewport ${s.env.viewport}, DPR ${s.env.dpr}; Szene ${s.env.scene}; Container-Kerne ${s.env.cpuset}`,
		`- Host-GPU: ${s.env.hostGpu}`,
		`- Je Variante ${s.env.reps} Läufe von \`dev/scene-lab/run.sh measure\`, abwechselnd (Variante 1, 2, 3, 1, 2, 3 …); ` +
			'Zelle = Median (kleinster–größter Wert).',
		'',
		'## Messwerte',
		'',
		`| Kennzahl | ${vs.map((v) => v.label).join(' | ')} |`,
		`|---|${vs.map(() => '---|').join('')}`,
		...ROWS.map(([key, label, unit]) => `| ${label}${unit ? ` (${unit})` : ''} | ${vs.map((v) => cell(v.agg.figures[key])).join(' | ')} |`),
		`| GPU-Urteil je Lauf | ${vs.map((v) => v.agg.verdicts.join(', ')).join(' | ')} |`,
		'',
		'## GPU-Nachweis je Variante (Rohwerte des ersten Laufs)',
		'',
	]
	for (const v of vs) {
		const e = v.sample
		if (!e) continue
		lines.push(`**${v.label}** – ${e.verdict.verdict}: ${e.verdict.reasons.join('; ')}.`)
		lines.push(`Prozesse: ${e.processes.map((p) => `${p.kind} (Mesa ${p.drivers.join('+') || '–'}, ${p.drmFds} /dev/dri)`).join(', ')}. Start: ${e.launch?.note ?? '–'}.`)
		lines.push('')
	}
	lines.push('## Entscheidungsregel §8.8 Punkt 6 – nur als Hinweis', '')
	lines.push('Die Regel gilt für das Gerät (R-A auf Android/Chrome, R-B auf dem iPad). Hier angewandt nur, um die Lage einzuordnen; ' +
		'sie entscheidet **nicht** über LOD 2.', '')
	for (const v of vs) {
		const h = ruleHint(v.agg)
		lines.push(`- ${v.label}: LOD 2 vorziehen? ${h.lod2 ? `**ja** (${h.lod2Reasons.join('; ')})` : 'nein'}; ` +
			`Culling-Profiling auf WebKit? ${h.profiling ? `**ja** (${h.profilingReasons.join('; ')})` : 'nein'}.`)
	}
	lines.push('')
	if (s.findings?.length) lines.push('## Befund', '', ...s.findings.flatMap((f) => [f, '']))
	return lines.join('\n')
}
