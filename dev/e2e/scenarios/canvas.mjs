/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * E10 CSS-transform gesture path (wheel), E11 view-only mode on a touch
 * device with a one-finger pan over CDP (SPEC-M0 §8.2).
 */
import { K, itemMap, centerOf, dragItem, openBoard, until, sleep } from '../lib/harness.mjs'

export const E10 = {
	id: 'E10',
	title: 'Gestenpfad: Strg+Wheel −60 ×5 → CSS-Transform während, Faktor exp(0,45), Anker fest',
	async run(t, world) {
		const s = await world.shared(t)
		const { alice } = s
		const N = s.notes.alice?.[0]
		t.must(N, 'Notiz aus E03 vorhanden')
		await K.waitIdle(alice.page, 15000)
		const c = await centerOf(alice.page, N)
		const cam0 = await K.camera(alice.page)
		await alice.page.mouse.move(c.x, c.y)
		await alice.page.keyboard.down('Control')
		let during = null
		let camDuring = null
		for (let i = 0; i < 5; i++) {
			await alice.page.mouse.wheel(0, -60)
			if (i === 2) {
				during = (await K.scene(alice.page))?.cssTransform ?? null
				camDuring = await K.camera(alice.page)
			}
			await sleep(16)
		}
		await alice.page.keyboard.up('Control')
		await sleep(300)
		const st = await K.scene(alice.page)
		const cam1 = await K.camera(alice.page)
		const want = Math.exp(5 * 60 * 0.0015)
		t.check(during !== null && during !== undefined && during !== '', 'während der Geste: scene().cssTransform gesetzt', during)
		t.check(JSON.stringify(camDuring) === JSON.stringify(cam0), 'während der Geste: camera() (bestätigt) unverändert', { cam0, camDuring })
		t.check(st && st.cssTransform === null, '≥ 250 ms danach: cssTransform null', st?.cssTransform)
		const k = cam1.scale / cam0.scale
		t.check(Math.abs(k / want - 1) <= 0.01, `scale × ${want.toFixed(4)} (±1 %)`, { k, cam0, cam1 })
		const c1 = await centerOf(alice.page, N)
		t.check(Math.abs(c1.x - c.x) <= 2 && Math.abs(c1.y - c.y) <= 2, 'Notizmitte bleibt am Bildschirmpunkt (±2 px)', { before: c, after: c1 })
		// back to the old zoom for the following scenarios
		await alice.page.mouse.move(c.x, c.y)
		await alice.page.keyboard.down('Control')
		for (let i = 0; i < 5; i++) {
			await alice.page.mouse.wheel(0, 60)
			await sleep(16)
		}
		await alice.page.keyboard.up('Control')
		await sleep(300)
	},
}

export const E11 = {
	id: 'E11',
	title: 'Ansehen-Modus (Touch, 820×1180): keine Werkzeuge, Banner, Touch-Schwenk per CSS-Pfad',
	async run(t, world) {
		const s = await world.shared(t)
		const tab = await world.actor('bob-tablet', { user: 'bob', touch: true })
		try {
			await openBoard(tab, s.board)
			const page = tab.page
			t.check(await page.locator('[data-knorke-toolbar]').count() === 0, 'kein [data-knorke-toolbar]')
			// SPEC-M1 §12.3 (R13, CLI-04): from stage 3 (FEATURES.voting, data-knorke-features="voting") an editor on a
			// touch device sees device_vote instead of the M0 banner viewonly (mode.js bannerFor rule 4)
			const features = await page.locator('[data-knorke-features]').first().getAttribute('data-knorke-features', { timeout: 5000 }).catch(() => null)
			const stage3 = typeof features === 'string' && features.split(/\s+/).includes('voting')
			const banner = stage3 ? 'device_vote' : 'viewonly'
			const shown = await until(() => page.locator(`[data-knorke-banner=${banner}]`).first().isVisible().catch(() => false), { timeout: 5000 })
			t.check(shown, `[data-knorke-banner=${banner}] sichtbar (data-knorke-features="${features}")`)
			if (stage3) {
				const txt = (await page.locator('[data-knorke-banner=device_vote]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
				t.check(txt.includes('On this device you can view and vote. Editing works on a computer.'), 'device_vote: „On this device you can view and vote. Editing works on a computer.“ (§6.5.4)', txt)
				t.check(!(await page.locator('[data-knorke-banner=viewonly]').first().isVisible().catch(() => false)), 'kein zweiter Banner viewonly')
			}
			const st = await K.state(page)
			t.check(st.viewOnly === true, 'state().viewOnly === true', st)
			t.step('Doppelklick erzeugt nichts')
			const before = await K.items(page)
			const box = await page.locator('.knorke-canvas').first().boundingBox()
			t.must(box, 'Leinwand gefunden')
			const cx = box.x + box.width / 2
			const cy = box.y + box.height * 0.8
			await page.mouse.dblclick(cx, cy)
			await sleep(1000)
			const after = await K.items(page)
			t.check(after.length === before.length && !(await page.locator('textarea[data-knorke-editor]').isVisible().catch(() => false)), 'kein neues Objekt, kein Editor', { before: before.length, after: after.length })
			t.step('Touch-Schwenk 200 px nach links (CDP)')
			const cam0 = await K.camera(page)
			const cdp = await tab.ctx.newCDPSession(page)
			const y = box.y + box.height / 2
			const x0 = box.x + box.width / 2 + 100
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
			let during = null
			for (let i = 1; i <= 10; i++) {
				await sleep(16)
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - 20 * i, y }] })
				if (i === 6) during = (await K.scene(page))?.cssTransform ?? null
			}
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			await sleep(300)
			const sc = await K.scene(page)
			const cam1 = await K.camera(page)
			t.check(during !== null && during !== undefined && during !== '', 'während des Schwenks: cssTransform gesetzt', during)
			t.check(sc && sc.cssTransform === null, 'danach: cssTransform null', sc?.cssTransform)
			const dx = cam1.x - cam0.x
			t.check(Math.abs(dx - 200 / cam0.scale) <= 2, 'camera().x um 200 / scale gewachsen (±2)', { dx, want: 200 / cam0.scale, cam0, cam1 })
			t.step('Änderungen von alice kommen an')
			const N = s.notes.alice?.[2]
			t.must(N, 'Notiz aus E03 vorhanden')
			const before2 = (await itemMap(page)).get(N)
			await dragItem(s.alice.page, N, { dx: 40, dy: 0 })
			await K.waitIdle(s.alice.page, 15000)
			const want2 = (await itemMap(s.alice.page)).get(N)
			const seen = await until(async () => {
				const it = (await itemMap(page)).get(N)
				return it && want2 && it.x === want2.x && it.y === want2.y
			}, { timeout: 6000 })
			t.check(want2 && before2 && want2.x !== before2.x, 'alice hat die Notiz verschoben', { before2, want2 })
			t.check(seen, 'alices Verschiebung kommt auf dem Tablet an')
		} finally {
			await world.drop(tab)
		}
	},
}
