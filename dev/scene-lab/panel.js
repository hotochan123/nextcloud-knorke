/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Measurement panel of the scene lab for a real device without a console
 * (iPad session R-A, SPEC-M1 §8.8): opened with ?panel=1, never in the gate
 * run. Runs __lab.measure() and timed hand gestures (__lab.meterFor), shows
 * the numbers the protocol asks for and offers them as JSON to copy. DOM
 * built with createElement/textContent only (no HTML sinks). Labels are
 * German because the user reads them during the session
 * (dev/scene-lab/ipad/ANLEITUNG-R-A.md refers to them).
 */

const HAND_MS = 5000
const COUNTDOWN_S = 3

const CSS = `
.lab-panel { position: fixed; top: 8px; right: 8px; z-index: 10; width: min(380px, calc(100vw - 16px));
	max-height: calc(100vh - 16px); overflow: auto; box-sizing: border-box; padding: 8px 10px;
	background: rgba(255, 255, 255, 0.96); color: #1d1d1b; border: 1px solid #b9b9b3; border-radius: 8px;
	font: 13px/1.35 -apple-system, system-ui, sans-serif; touch-action: manipulation;
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15); }
.lab-panel[data-collapsed="1"] .lab-panel__body { display: none; }
.lab-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lab-panel button { font: inherit; padding: 6px 10px; margin: 3px 3px 3px 0; border: 1px solid #8a8a84;
	border-radius: 6px; background: #f4f4f2; color: inherit; }
.lab-panel button:disabled { opacity: 0.5; }
.lab-panel__info, .lab-panel__status { margin: 6px 0; word-break: break-word; }
.lab-panel__status { font-weight: 600; }
.lab-panel table { border-collapse: collapse; width: 100%; margin: 6px 0; }
.lab-panel th, .lab-panel td { border-bottom: 1px solid #ddd; padding: 2px 4px; text-align: right; }
.lab-panel th:first-child, .lab-panel td:first-child { text-align: left; }
.lab-panel textarea { width: 100%; box-sizing: border-box; font: 11px/1.3 ui-monospace, monospace; }
`

/**
 * @param {Document} doc document
 * @param {string} tag tag
 * @param {object} [attrs] attributes (on* = listener)
 * @param {...(Node|string)} kids children
 * @return {HTMLElement}
 */
function el(doc, tag, attrs = {}, ...kids) {
	const node = doc.createElement(tag)
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
		else node.setAttribute(k, String(v))
	}
	for (const kid of kids) node.append(kid)
	return node
}

const fmt = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('de-DE'))

/**
 * Table rows from the collected runs (pure, unit tested).
 *
 * @param {{auto: object|null, hand: Array<{kind: string, data: object}>}} res collected results
 * @return {Array<string[]>} [label, fps, p50, p95, verpasst %]
 */
export function panelRows(res) {
	const rows = []
	const frameRow = (label, f) => [label, fmt(f?.fps), fmt(f?.p50), fmt(f?.p95), fmt(f?.pctMissed)]
	if (res.auto) {
		const a = res.auto
		rows.push(['Erstes Rendern (Laden), ms', fmt(a.firstRenderMs, 0), '', '', ''])
		rows.push([`Erstes Rendern ganzes Board (${fmt(a.fit?.scale * 100, 0)} %), ms`, fmt(a.fit?.ms, 0), '', '', ''])
		rows.push(frameRow('Schwenken (auto)', a.pan?.frames))
		rows.push(frameRow('Zoomen (auto)', a.zoom?.frames))
		rows.push(frameRow('Notiz ziehen (auto)', a.drag?.frames))
		rows.push(frameRow('Ganzes Board zoomen (auto)', a.board?.frames))
		rows.push(frameRow('Ganzes Board schwenken (auto)', a.boardPan?.frames))
	}
	const n = { pan: 0, pinch: 0 }
	for (const h of res.hand) {
		n[h.kind] = (n[h.kind] ?? 0) + 1
		rows.push(frameRow(`${h.kind === 'pinch' ? 'Hand: Pinch' : 'Hand: Schwenk'} #${n[h.kind]}`, h.data?.frames))
	}
	return rows
}

/**
 * @param {object} lab window.__lab
 * @param {Document} [doc] document
 * @return {HTMLElement} the panel
 */
export function mountPanel(lab, doc = document) {
	const res = { device: null, auto: null, hand: [] }
	const style = el(doc, 'style')
	style.textContent = CSS
	doc.head.append(style)

	const info = el(doc, 'p', { class: 'lab-panel__info' }, 'Gerät wird gelesen …')
	const status = el(doc, 'p', { class: 'lab-panel__status', 'aria-live': 'polite' }, 'Bereit.')
	const tbody = el(doc, 'tbody')
	const table = el(doc, 'table', {},
		el(doc, 'thead', {}, el(doc, 'tr', {}, ...['Messung', 'fps / ms', 'p50', 'p95', 'verpasst %'].map((h) => el(doc, 'th', {}, h)))),
		tbody)
	const json = el(doc, 'textarea', { readonly: 'readonly', rows: '6', 'aria-label': 'Ergebnis als JSON' })
	const buttons = []
	const btn = (label, fn) => {
		const b = el(doc, 'button', { type: 'button', onclick: () => fn() }, label)
		buttons.push(b)
		return b
	}
	const busy = (on) => {
		for (const b of buttons) b.disabled = on
	}
	const render = () => {
		tbody.replaceChildren(...panelRows(res).map((r) => el(doc, 'tr', {}, ...r.map((c) => el(doc, 'td', {}, c)))))
		json.value = JSON.stringify({ at: new Date().toISOString(), ...res }, null, 1)
	}
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

	const auto = async () => {
		busy(true)
		status.textContent = 'Automatik-Messung läuft (≈ 1 min), bitte nicht berühren …'
		try {
			res.auto = await lab.measure()
			status.textContent = 'Automatik-Messung fertig.'
		} catch (e) {
			status.textContent = 'Fehler: ' + String(e?.message ?? e)
		}
		render()
		busy(false)
	}
	const hand = async (kind) => {
		busy(true)
		const what = kind === 'pinch' ? 'mit zwei Fingern zoomen (Pinch)' : 'mit einem Finger schwenken'
		for (let s = COUNTDOWN_S; s > 0; s--) {
			status.textContent = `Gleich ${what} … ${s}`
			await sleep(1000)
		}
		status.textContent = `Jetzt ${what}, ${HAND_MS / 1000} s lang ohne Pause!`
		try {
			res.hand.push({ kind, at: new Date().toISOString(), data: await lab.meterFor(HAND_MS) })
			status.textContent = 'Fertig. Wert steht in der Tabelle.'
		} catch (e) {
			status.textContent = 'Fehler: ' + String(e?.message ?? e)
		}
		render()
		busy(false)
	}
	const copy = async () => {
		render()
		try {
			await navigator.clipboard.writeText(json.value)
			status.textContent = 'JSON kopiert.'
			return
		} catch {}
		json.focus()
		json.select()
		json.setSelectionRange(0, json.value.length)
		let ok = false
		try {
			ok = doc.execCommand('copy')
		} catch {}
		status.textContent = ok ? 'JSON kopiert (Ersatzweg).' : 'Kopieren ging nicht: Text im Feld ist markiert, bitte von Hand kopieren.'
	}

	const panel = el(doc, 'aside', { class: 'lab-panel', 'data-lab-panel': '', 'aria-label': 'Messfeld' })
	const toggle = el(doc, 'button', {
		type: 'button',
		'aria-expanded': 'true',
		onclick: () => {
			const collapsed = panel.getAttribute('data-collapsed') !== '1'
			panel.setAttribute('data-collapsed', collapsed ? '1' : '0')
			toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
			toggle.textContent = collapsed ? 'Ausklappen' : 'Einklappen'
		},
	}, 'Einklappen')
	panel.append(
		el(doc, 'div', { class: 'lab-panel__head' }, el(doc, 'strong', {}, 'Knorke-Labor · R-A'), toggle),
		el(doc, 'div', { class: 'lab-panel__body' },
			info,
			el(doc, 'div', {},
				btn('Automatik-Messung', auto),
				btn('Hand: 5 s Schwenk', () => hand('pan')),
				btn('Hand: 5 s Pinch', () => hand('pinch')),
				btn('JSON kopieren', copy)),
			status, table, json))
	doc.body.append(panel)
	render()

	lab.device().then((d) => {
		res.device = d
		info.textContent = `${d.viewport.w}×${d.viewport.h} CSS-px, DPR ${d.devicePixelRatio}, Bildtakt ${fmt(d.refreshMs, 2)} ms ` +
			`(≈ ${fmt(1000 / d.refreshMs, 0)} Hz), crossOriginIsolated ${d.crossOriginIsolated}, Timer-Schritt ${fmt(d.timerStepMs, 3)} ms, ` +
			`${d.items} Objekte`
		render()
	}).catch((e) => {
		info.textContent = 'Gerät: ' + String(e?.message ?? e)
	})
	return panel
}
