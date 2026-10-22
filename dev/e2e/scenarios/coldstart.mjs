/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E12 cold start with the M1 bundle (SPEC-M0 §8.2, F7; SPEC-M1 §8.4 E12,
 * Revision 19 T4-11). A context without cache opens (1) the board page
 * signed in, (2) the guest page with app config public_template = public and
 * (3) = base, and (4) the vote link page as a tablet guest (hasTouch,
 * isMobile, 820 × 1180, /p/<vote token>, name left empty). Every request is
 * counted.
 *
 * Gate per page (replaces "no new requests" and "within limits" of WP-C4):
 * assets below /custom_apps/knorke/(js|css|l10n)/ ≤ 5, exactly ONE snapshot
 * or join before the first /sync, and no other request below /apps/knorke/
 * or /custom_apps/knorke/ before the first /sync except the page HTML, app
 * assets (js, css, l10n), the app icon (img/) and the snapshot or join.
 * Reported without a gate: the total per page with its difference to M0
 * (85 / 34 / 32; the vote link page against 34), page HTML, app icons,
 * /sync within 5 s. The column "Pulse 91/142" is gone (R19).
 *
 * The signed-in context logs in through the form first and then clears the
 * browser cache over CDP, so the board page itself starts cold.
 */
import { APP, K, api, field, action, waitReady, sleep, setAppConfig, newActor } from '../lib/harness.mjs'

const ASSET_RE = /\/custom_apps\/knorke\/(js|css|l10n)\//
const ICON_RE = /\/custom_apps\/knorke\/img\//
const SYNC_RE = /\/(api|pub)\/v1\/boards\/\d+\/sync$/
const FIRST_RE = /\/(api\/v1\/boards\/\d+\/snapshot|pub\/v1\/boards\/\d+\/snapshot|pub\/v1\/[A-Za-z0-9]{24}\/join)$/
/** Requests of the app (served by Nextcloud's front controller or as a custom app file). */
const APP_RE = /\/(custom_)?apps\/knorke\//

/** M0's totals per page (SPEC-M1 §8.4 E12: 85 signed in, 34 guest public, 32 guest base; the vote link against 34). */
export const M0_TOTALS = Object.freeze({ user: 85, public: 34, base: 32, vote: 34 })

/**
 * Sorts the requests of one page: counts, and the gate of R19 – which app
 * requests came before the first /sync although they are none of page HTML,
 * app asset, app icon or snapshot/join.
 */
export function classify(reqs, pageUrl) {
	const firstSync = reqs.findIndex((r) => SYNC_RE.test(r.path))
	const t0 = reqs[0]?.t ?? 0
	const pre = firstSync < 0 ? reqs : reqs.slice(0, firstSync)
	const beforeSync = pre.filter((r) => FIRST_RE.test(r.path))
	const extra = pre.filter((r) => APP_RE.test(r.path) && !(r.type === 'document' || ASSET_RE.test(r.path) || ICON_RE.test(r.path) || FIRST_RE.test(r.path)))
	return {
		total: reqs.length,
		html: reqs.filter((r) => r.type === 'document').length,
		assets: reqs.filter((r) => ASSET_RE.test(r.path)).length,
		assetList: reqs.filter((r) => ASSET_RE.test(r.path)).map((r) => r.path.replace(/^.*\/custom_apps\/knorke\//, '')),
		icons: reqs.filter((r) => ICON_RE.test(r.path)).length,
		firstBeforeSync: beforeSync.length,
		extraBeforeSync: extra.map((r) => r.path),
		sawSync: firstSync >= 0,
		syncs5s: reqs.filter((r) => SYNC_RE.test(r.path) && r.t - t0 <= 5000).length,
		page: pageUrl,
	}
}

async function measure(world, name, { user = null, url, guestName = null, touch = false }) {
	const a = await newActor(world.browser, name, { user, touch })
	world.actors.add(a)
	try {
		const cdp = await a.ctx.newCDPSession(a.page)
		await cdp.send('Network.enable')
		await cdp.send('Network.clearBrowserCache')
		await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
		const reqs = []
		a.page.on('request', (r) => {
			const u = new URL(r.url())
			reqs.push({ t: Date.now(), path: u.pathname, type: r.resourceType() })
		})
		const resp = await a.page.goto(url, { waitUntil: 'domcontentloaded' })
		if (guestName !== null) {
			await field(a.page, 'guest-name', guestName)
			await action(a.page, 'guest-join')
		}
		await waitReady(a.page, 30000)
		await sleep(5000)
		const c = classify(reqs, url)
		c.status = resp ? resp.status() : null
		c.counters = await K.counters(a.page).catch(() => null)
		return c
	} finally {
		await world.drop(a)
	}
}

export const E12 = {
	id: 'E12',
	phase: 2,
	title: 'Kaltstart mit M1-Bündel (R19): angemeldet, Gast public, Gast base, Gast Abstimm-Link (Tablet); Gate je Seite: Assets ≤ 5, genau ein Snapshot/Beitritt vor dem ersten /sync, keine weitere App-Anfrage davor; Bericht gegen M0 (85/34/32, Abstimm-Link 34)',
	async run(t, world) {
		const s = await world.shared(t)
		const vl = await api('alice', 'POST', `/api/v1/boards/${s.board}/votelink`, {})
		t.must(vl.status === 200 && typeof vl.data?.link?.token === 'string', '[B] Vorbedingung: Abstimm-Link (Route 17) → 200', `${vl.status} ${vl.text.slice(0, 160)}`)
		const rows = []
		world.touchedConfig = true
		const user = await measure(world, 'alice-cold', { user: 'alice', url: `${APP}/b/${s.board}` })
		rows.push(['angemeldet', user, M0_TOTALS.user])
		for (const mode of ['public', 'base']) {
			const r = await setAppConfig('knorke', 'public_template', mode)
			t.check(r.status === 200, `[D] App-Config public_template = ${mode}`, r)
			const g = await measure(world, `gast-cold-${mode}`, { url: `${APP}/p/${s.token}`, guestName: `Kalt ${mode}` })
			rows.push([`Gast (${mode})`, g, M0_TOTALS[mode]])
		}
		await setAppConfig('knorke', 'public_template', 'public')
		const v = await measure(world, 'tablet-cold-vote', { url: `${APP}/p/${vl.data.link.token}`, guestName: '', touch: true })
		rows.push(['Gast Abstimm-Link (Tablet)', v, M0_TOTALS.vote])
		// the shared world keeps only its edit link (E09 and later cases)
		const off = await api('alice', 'DELETE', `/api/v1/boards/${s.board}/votelink`)
		t.check(off.status === 200, '[B] Abstimm-Link danach wieder aus (Route 18)', `${off.status} ${off.text.slice(0, 120)}`)
		for (const [label, m] of rows) {
			t.check(m.status === 200, `[C] ${label}: Seite 200`, m.status)
			t.check(m.assets <= 5, `[C] ${label}: Assets unter /custom_apps/knorke/(js|css|l10n)/ ≤ 5`, m.assetList)
			t.check(m.sawSync && m.firstBeforeSync === 1, `[C] ${label}: genau ein Snapshot bzw. Beitritt vor dem ersten /sync`, { firstBeforeSync: m.firstBeforeSync, sawSync: m.sawSync })
			t.check(m.extraBeforeSync.length === 0, `[C] ${label}: keine weitere Anfrage unter /apps/knorke/ oder /custom_apps/knorke/ vor dem ersten /sync (außer Seiten-HTML, Assets, App-Icon, Snapshot/Beitritt)`, m.extraBeforeSync)
		}
		for (const [label, m, m0] of rows) {
			t.note(`${label}: ${m.total} Anfragen gesamt (M0 ${m0}, Differenz ${m.total - m0 >= 0 ? '+' : ''}${m.total - m0}), HTML ${m.html}, Assets ${m.assets}, Icons ${m.icons}, /sync in 5 s ${m.syncs5s}`)
		}
		t.report([
			'## E12 Kaltstart mit M1-Bündel (Gate je Seite: Assets ≤ 5, genau ein Snapshot/Beitritt, keine weitere App-Anfrage vor dem ersten /sync; Gesamtzahl nur Bericht)',
			'',
			'| Seite | gesamt | M0 | Differenz | Seiten-HTML | Assets js/css/l10n | App-Icons | Snapshot/Beitritt vor 1. /sync | weitere App-Anfragen davor | /sync in 5 s |',
			'|---|---|---|---|---|---|---|---|---|---|',
			...rows.map(([label, m, m0]) => `| ${label} | ${m.total} | ${m0} | ${m.total - m0 >= 0 ? '+' : ''}${m.total - m0} | ${m.html} | ${m.assets} | ${m.icons} | ${m.firstBeforeSync} | ${m.extraBeforeSync.length} | ${m.syncs5s} |`),
			'',
			`Differenz Gast public − base: ${rows[1][1].total - rows[2][1].total} Anfragen (F7 ist entschieden, R3: public bleibt Vorgabe).`,
		].join('\n'))
	},
}
