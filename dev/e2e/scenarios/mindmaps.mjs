/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Mind maps (factory job 195).
 *
 * E76 alice (owner) and bob (shared with "edit"), Chromium 1440 × 900, both
 * at 100 % with the same camera, on a board of their own. Steps:
 *   (1) alice presses M and clicks: a mind map, the editor of its root
 *       open; she types "Thema", Tab "A", Enter "B" and ends with Esc; bob's
 *       __knorke.scene().mindmaps shows the three nodes at the latest 3 s
 *       after her Esc;
 *   (2) both focus the root and press Tab at the same time, type a text and
 *       end with Esc: both have five nodes, every node box equal at both
 *       (±1), and the server has five;
 *   (3) bob drags B onto A: B hangs below A at both;
 *   (4) alice clicks the fold dot of A: B is hidden at bob too; a second
 *       click shows it again;
 *   (5) an indented list of three levels pasted at alice (a paste event on
 *       the paste catcher, the only synthetic event: headless Chromium has
 *       no clipboard) becomes one mind map with its four nodes, at bob too;
 *   (6) "Copy as text" from the menu on that map's root copies the list
 *       (the copy event of the hidden field is read: http has no
 *       navigator.clipboard);
 *   (7) a comment on B ("Comment" with B focused): the server keeps node B;
 *       after a reload its bubble sits at B's top right corner.
 * Own board, no instance setting: directly after E75, before E09. Flake
 * gate: --only E76 --repeat 3.
 *
 * E79 (job 198) alice and bob as above: (1) alice pastes "Chefin / A / A1 /
 * B"; (2) she chooses "Org chart" under "Layout": bob has the layout org
 * within 3 s, A and B side by side below the root, A1 below A, every node a
 * box, the boxes equal at both (±1); (3) "Tree" (A right of the root), then
 * "Mind map": the boxes of the start (±1); (4) "Org chart" again, bob writes
 * "Anna", Shift+Enter, "Lead" into A (its editor has a placeholder): alice
 * sees the name and the role; (5) bob, at 80 % from the start, adds an
 * empty card with Enter: its placeholder has the editor's font, fits in
 * it whole and, in bob's dark theme, has a contrast of at least 4.5 : 1 on
 * the white card. Directly after E78, before E09; flake gate: --only E79
 * --repeat 3.
 *
 * Check labels start with exactly ONE owner (SPEC-M1 §9.6): [S] scene, [C]
 * session and sync, [B] the server, [D] a harness precondition.
 */
import { K, CANVAS, api, openBoard, until, settle, itemMap, idSet, serverMap, dragPath } from '../lib/harness.mjs'
import { parseColor, over, contrastRatio, fmtColor, MIN_RATIO } from '../lib/contrast.mjs'

/** The camera both open with: world (0, 0) 600 px right of and 300 px below the canvas corner, 100 %. */
const CAM = Object.freeze({ x: -600, y: -300, scale: 1 })
/** AK7: bob sees the nodes at the latest this long after alice's Esc. */
const SEEN_MS = 3000
const MENU = '[data-knorke-menu=context]'
const NODE_EDITOR = 'textarea[data-knorke-editor][data-knorke-editor-kind="node"]'

/** Shares a board (route 8 as alice). */
async function shareWith(board, list) {
	const r = await api('alice', 'PUT', `/api/v1/boards/${board}/shares`, { shares: list })
	if (r.status !== 200) throw new Error(`PUT shares ${board}: ${r.status} ${r.text.slice(0, 200)}`)
}

/** Stores the camera the board opens with (BoardSession reads knorke.cam.<board> on open). */
async function storeCamera(page, board, cam) {
	await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`knorke.cam.${board}`, JSON.stringify(cam)])
}

/** The scene's entry of a mind map in stats().mindmaps, or null. */
async function sceneMap(page, id) {
	const s = await K.scene(page).catch(() => null)
	return (s?.mindmaps ?? []).find((x) => x.id === id) ?? null
}

/** The node of a mind map with a text, as the scene lays it out, or null. */
async function nodeWith(page, id, text) {
	return (await sceneMap(page, id))?.nodes.find((n) => n.text === text) ?? null
}

/** Client point of the centre of a node's box. */
async function nodePoint(page, id, text) {
	const n = await nodeWith(page, id, text)
	return n && n.x !== null ? K.w2s(page, n.x + n.w / 2, n.y + n.h / 2) : null
}

/** The open node editor of a page: {node, value} or null. */
const nodeEditor = (page) => page.evaluate((sel) => {
	const ta = document.querySelector(sel)
	return ta ? { node: ta.getAttribute('data-knorke-node'), value: ta.value } : null
}, NODE_EDITOR).catch(() => null)

/** Is any text editor open in a page? */
const anyEditor = (page) => page.evaluate(() => !!document.querySelector('textarea[data-knorke-editor]')).catch(() => false)

/** The comments hook of a page. */
const comments = (p) => p.evaluate(() => (typeof window.__knorke?.comments === 'function' ? window.__knorke.comments() : null)).catch(() => null)

/** Waits for a new node editor (another node than `prev`) and returns it. */
const nextEditor = (page, prev) => until(async () => {
	const e = await nodeEditor(page)
	return e && e.node !== prev ? e : null
}, { timeout: 3000 })

/** The texts of a mind map's nodes, sorted. */
const textsOf = (m) => (m?.nodes ?? []).map((n) => n.text).sort()

export const E76 = {
	id: 'E76',
	title: 'Mindmaps (Job 195): alice legt mit M eine Mindmap an und schreibt „Thema“, Tab „A“, Enter „B“, bob sieht sie ≤ 3 s; beide hängen zugleich einen Hauptast an, die Knoten liegen bei beiden gleich; bob zieht B auf A; alice klappt A ein; eine eingefügte eingerückte Liste wird zur Mindmap, „Copy as text“ gibt sie zurück; ein Kommentar an B hängt nach dem Neuladen an B',
	async run(t, world) {
		const board = await world.board('E76 Mindmaps')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const a = await world.actor('alice-mindmap', { user: 'alice' })
		const b = await world.actor('bob-mindmap', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}

			t.step('(1) alice drückt M, klickt und schreibt „Thema“, Tab „A“, Enter „B“')
			const empty = await K.w2s(pa, -400, 300)
			await pa.mouse.click(empty.x, empty.y)
			await pa.locator(CANVAS).first().focus()
			await pa.keyboard.press('m')
			t.must(await until(async () => (await pa.locator('[data-knorke-tool=more][data-knorke-tool-picked=mindmap]').first().getAttribute('aria-pressed')) === 'true', { timeout: 2000 }), '[S] (1) M wählt das Werkzeug Mindmap (aria-pressed; Job 229: „Mehr Werkzeuge“ zeigt sie)')
			const before = await idSet(pa)
			const at = await K.w2s(pa, 0, 0)
			await pa.mouse.click(at.x, at.y)
			const M = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before.has(k) && it.t === 'mindmap') return k
				return null
			}, { timeout: 5000 })
			t.must(M, '[S] (1) ein Klick legt eine Mindmap an')
			const root = await until(() => nodeEditor(pa), { timeout: 3000 })
			t.must(root !== null, '[S] (1) der Editor der Mitte ist offen', root)
			await pa.keyboard.type('Thema')
			await pa.keyboard.press('Tab')
			const ea = await nextEditor(pa, root.node)
			t.must(ea !== null, '[S] (1) Tab: der Editor des neuen Kinds ist offen', ea)
			await pa.keyboard.type('A')
			await pa.keyboard.press('Enter')
			const eb = await nextEditor(pa, ea.node)
			t.must(eb !== null, '[S] (1) Enter: der Editor des neuen Geschwisters ist offen', eb)
			await pa.keyboard.type('B')
			await pa.keyboard.press('Escape')
			const done = Date.now()
			const seen = await until(async () => {
				const m = await sceneMap(pb, M)
				return m && JSON.stringify(textsOf(m)) === JSON.stringify(['A', 'B', 'Thema']) ? Date.now() : null
			}, { timeout: SEEN_MS + 2000, every: 50 })
			t.check(seen !== null && seen - done <= SEEN_MS, `[C] (1) bob sieht die drei Knoten spätestens ${SEEN_MS} ms nach alices Esc`, seen === null ? await sceneMap(pb, M) : seen - done)
			await settle([pa, pb])
			const m1 = await sceneMap(pa, M)
			const nA = m1.nodes.find((n) => n.text === 'A')
			const nB = m1.nodes.find((n) => n.text === 'B')
			const nR = m1.nodes.find((n) => n.text === 'Thema')
			t.check(nA?.parent === nR?.key && nB?.parent === nR?.key && nA.side !== 0, '[C] (1) A und B sind Hauptäste der Mitte', m1.nodes)
			t.check(Math.abs(nR.x + nR.w / 2) <= 1 && Math.abs(nR.y + nR.h / 2) <= 1, '[S] (1) die Mitte blieb am Klickpunkt', { x: nR.x, y: nR.y, w: nR.w, h: nR.h })
			t.check((await K.scene(pa)).tool === 'select', '[S] (1) das Werkzeug springt auf Auswahl')
			t.check(!(await anyEditor(pa)), '[S] (1) Esc schließt den Editor')

			t.step('(2) beide hängen zugleich einen Hauptast an')
			const ra = await nodePoint(pa, M, 'Thema')
			const rb = await nodePoint(pb, M, 'Thema')
			await Promise.all([pa.mouse.click(ra.x, ra.y), pb.mouse.click(rb.x, rb.y)])
			t.must(await until(async () => (await sceneMap(pa, M))?.focus === nR.key && (await sceneMap(pb, M))?.focus === nR.key, { timeout: 3000 }), '[S] (2) bei beiden hat die Mitte den Fokus')
			await Promise.all([pa.keyboard.press('Tab'), pb.keyboard.press('Tab')])
			t.must(await until(async () => (await nodeEditor(pa)) !== null && (await nodeEditor(pb)) !== null, { timeout: 3000 }), '[S] (2) beide Editoren sind offen')
			await Promise.all([pa.keyboard.type('Von Alice', { delay: 30 }), pb.keyboard.type('Von Bob', { delay: 30 })])
			await Promise.all([pa.keyboard.press('Escape'), pb.keyboard.press('Escape')])
			await settle([pa, pb])
			const ok5 = await until(async () => (await sceneMap(pa, M))?.nodes.length === 5 && (await sceneMap(pb, M))?.nodes.length === 5, { timeout: 5000 })
			t.check(ok5, '[C] (2) beide haben fünf Knoten', { a: textsOf(await sceneMap(pa, M)), b: textsOf(await sceneMap(pb, M)) })
			const ma = await sceneMap(pa, M)
			const mb = await sceneMap(pb, M)
			const diff = ma.nodes.map((n) => {
				const o = mb.nodes.find((x) => x.key === n.key)
				return o ? Math.max(Math.abs(n.x - o.x), Math.abs(n.y - o.y), Math.abs(n.w - o.w), Math.abs(n.h - o.h)) : Infinity
			})
			t.check(diff.every((d) => d <= 1), '[C] (2) jede Knotenkiste liegt bei beiden gleich (±1)', { diff, a: ma.nodes, b: mb.nodes })
			const sv = (await serverMap('alice', board)).get(M)
			const count = Object.values(sv?.data?.nodes ?? {}).reduce((s, pot) => s + Object.keys(pot).length, 0)
			t.check(count === 5, '[B] (2) der Server hat fünf Knoten', sv?.data)

			t.step('(3) bob zieht B auf A')
			await pb.locator(CANVAS).first().focus()
			await pb.keyboard.press('Escape')
			await pb.keyboard.press('Escape')
			const from = await nodePoint(pb, M, 'B')
			const to = await nodePoint(pb, M, 'A')
			await dragPath(pb, from, to, { steps: 16 })
			t.check(await until(async () => (await nodeWith(pa, M, 'B'))?.parent === nA.key && (await nodeWith(pb, M, 'B'))?.parent === nA.key, { timeout: 5000 }), '[C] (3) B hängt bei beiden unter A', { a: await nodeWith(pa, M, 'B'), b: await nodeWith(pb, M, 'B') })
			await settle([pa, pb])

			t.step('(4) alice klappt A ein und wieder auf')
			const dotA = (await nodeWith(pa, M, 'A'))?.dot
			t.must(dotA, '[S] (4) A hat einen Klapppunkt', await nodeWith(pa, M, 'A'))
			const d = await K.w2s(pa, dotA.x, dotA.y)
			await pa.mouse.click(d.x, d.y)
			t.check(await until(async () => (await nodeWith(pb, M, 'B'))?.hidden === true, { timeout: 5000 }), '[C] (4) B ist bei bob verborgen', await nodeWith(pb, M, 'B'))
			t.check((await nodeWith(pa, M, 'A'))?.folded === true, '[S] (4) A ist eingeklappt')
			await settle([pa, pb])
			const d2 = await K.w2s(pa, (await nodeWith(pa, M, 'A')).dot.x, (await nodeWith(pa, M, 'A')).dot.y)
			await pa.mouse.click(d2.x, d2.y)
			t.check(await until(async () => (await nodeWith(pb, M, 'B'))?.hidden === false, { timeout: 5000 }), '[C] (4) ein zweiter Klick zeigt B wieder')
			await settle([pa, pb])

			t.step('(5) eine eingerückte Liste wird beim Einfügen zur Mindmap')
			const LIST = 'Liste\n\tEins\n\t\tZwei\n\tDrei'
			const spot = await K.w2s(pa, 0, 500)
			await pa.mouse.move(spot.x, spot.y)
			const before5 = await idSet(pa)
			const pasted = await pa.evaluate((text) => {
				const dt = new DataTransfer()
				dt.setData('text/plain', text)
				const catcher = document.querySelector('textarea[data-knorke-paste-catcher]')
				if (!catcher) return { error: 'kein Einfüge-Fänger' }
				catcher.focus()
				const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
				catcher.dispatchEvent(e)
				return { prevented: e.defaultPrevented }
			}, LIST)
			t.check(pasted?.prevented === true, '[C] (5) Knorke nimmt das Einfügen an', pasted)
			const P = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before5.has(k) && it.t === 'mindmap') return k
				return null
			}, { timeout: 5000 })
			t.must(P, '[C] (5) eine neue Mindmap entsteht')
			t.check(JSON.stringify(textsOf(await sceneMap(pa, P))) === JSON.stringify(['Drei', 'Eins', 'Liste', 'Zwei']), '[C] (5) mit ihren vier Knoten', await sceneMap(pa, P))
			t.check((await nodeWith(pa, P, 'Zwei'))?.depth === 2, '[C] (5) „Zwei“ auf der dritten Ebene', await nodeWith(pa, P, 'Zwei'))
			t.check(await until(async () => textsOf(await sceneMap(pb, P)).length === 4, { timeout: 5000 }), '[C] (5) auch bei bob')
			await settle([pa, pb])

			t.step('(6) „Copy as text“ gibt die Liste zurück')
			await pa.evaluate(() => {
				window.__kdCopied = null
				document.addEventListener('copy', (e) => {
					window.__kdCopied = typeof e.target?.value === 'string' ? e.target.value : String(document.getSelection())
				}, true)
			})
			const rp = await nodePoint(pa, P, 'Liste')
			await pa.mouse.move(rp.x, rp.y)
			await pa.mouse.click(rp.x, rp.y, { button: 'right' })
			t.must(await until(async () => (await pa.locator(MENU).count()) > 0, { timeout: 3000 }), '[S] (6) das Kontextmenü öffnet sich auf der Mitte')
			const names = await pa.locator(`${MENU} button[data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			t.check(names.includes('mm-child') && names.includes('mm-text') && !names.includes('mm-delete'), '[S] (6) an der Mitte: „Add child“ und „Copy as text“, kein „Delete branch“', names)
			await pa.locator(`${MENU} button[role="menuitem"][data-knorke-menu-item="mm-text"]`).first().click({ timeout: 3000 })
			const copied = await until(() => pa.evaluate(() => window.__kdCopied), { timeout: 3000 })
			t.check(copied === LIST, '[C] (6) kopiert ist die eingerückte Liste', JSON.stringify(copied))

			t.step('(7) ein Kommentar an B hängt nach dem Neuladen an B')
			const bp = await nodePoint(pa, M, 'B')
			await pa.mouse.click(bp.x, bp.y)
			t.must(await until(async () => (await sceneMap(pa, M))?.focus === nB.key, { timeout: 3000 }), '[S] (7) B hat den Fokus')
			const bar = pa.locator('[data-knorke-action=comment]').first()
			t.must(await bar.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (7) die Leiste zeigt „Comment“')
			await bar.click()
			const field = pa.locator('[data-knorke-thread="new"] [data-knorke-field=comment]').first()
			t.must(await field.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), '[C] (7) das Feld eines neuen Threads ist offen')
			await field.click()
			await pa.keyboard.type('Zu B', { delay: 20 })
			await pa.keyboard.press('Enter')
			const T = await until(async () => (await comments(pa))?.threads?.[0]?.id ?? null, { timeout: 8000 })
			t.must(typeof T === 'string', '[C] (7) ein Thread entsteht')
			const st = (await api('alice', 'GET', `/api/v1/boards/${board}/comments`)).data?.threads ?? []
			t.check(st.length === 1 && st[0].item === M && st[0].node === nB.key, '[B] (7) gespeichert an der Mindmap mit dem Knoten B', st)
			await openBoard(a, board)
			const bubble = await until(async () => (await comments(pa))?.places?.find((x) => x.id === T) ?? null, { timeout: 8000 })
			const nb = await nodeWith(pa, M, 'B')
			const cam = await K.camera(pa)
			const want = { x: (nb.x + nb.w - cam.x) * cam.scale, y: (nb.y - cam.y) * cam.scale }
			t.check(!!bubble && Math.abs(bubble.x - want.x) <= 2 && Math.abs(bubble.y - want.y) <= 2, '[C] (7) nach dem Neuladen sitzt die Blase oben rechts an B', { bubble, want })
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}

/*
 * E77 (factory job 196) alice (owner) and bob ("edit"), Chromium 1440 × 900,
 * the same camera, a board of their own. Steps:
 *   (1) alice pastes "Thema / A / A1 / B / C" as an indented list: one mind
 *       map, at bob too;
 *   (2) alice drags A with the mouse onto empty space: at both, within 3 s,
 *       A is placed freely with the centre of its box at the drop point
 *       (±1), its child A1 beside it, no node box overlaps A's, and the
 *       server stores m at A;
 *   (3) bob chooses "Rearrange" in the menu of A: at both A is no longer
 *       free and every node box is equal at both (±1); the server has no m.
 * Own board, no instance setting: directly after E76, before E09. Flake
 * gate: --only E77 --repeat 3.
 */
/** Do two node boxes overlap (with area)? */
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** The largest difference of the node boxes of one map at two pages (Infinity: a node missing). */
const boxDiff = (ma, mb) => Math.max(0, ...(ma?.nodes ?? []).filter((n) => n.x !== null).map((n) => {
	const o = mb?.nodes.find((x) => x.key === n.key)
	return o && o.x !== null ? Math.max(Math.abs(n.x - o.x), Math.abs(n.y - o.y), Math.abs(n.w - o.w), Math.abs(n.h - o.h)) : Infinity
}))

export const E77 = {
	id: 'E77',
	title: 'Mindmap-Knoten frei verschieben (Job 196): alice fügt eine Liste ein und zieht A auf freie Fläche, bei beiden steht A dort ≤ 3 s, A1 neben A, kein Knoten überdeckt A; bob wählt im Menü von A „Rearrange“, A steht wieder im Layout, bei beiden gleich',
	async run(t, world) {
		const board = await world.board('E77 Mindmap frei')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const a = await world.actor('alice-mmfree', { user: 'alice' })
		const b = await world.actor('bob-mmfree', { user: 'bob' })
		const pa = a.page
		const pb = b.page
		try {
			for (const x of [a, b]) {
				await storeCamera(x.page, board, CAM)
				await openBoard(x, board)
			}

			t.step('(1) alice fügt „Thema / A / A1 / B / C“ als Liste ein')
			const spot = await K.w2s(pa, 0, 0)
			await pa.mouse.move(spot.x, spot.y)
			const before = await idSet(pa)
			const pasted = await pa.evaluate((text) => {
				const dt = new DataTransfer()
				dt.setData('text/plain', text)
				const catcher = document.querySelector('textarea[data-knorke-paste-catcher]')
				if (!catcher) return { error: 'kein Einfüge-Fänger' }
				catcher.focus()
				const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
				catcher.dispatchEvent(e)
				return { prevented: e.defaultPrevented }
			}, 'Thema\n\tA\n\t\tA1\n\tB\n\tC')
			t.check(pasted?.prevented === true, '[C] (1) Knorke nimmt das Einfügen an', pasted)
			const P = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before.has(k) && it.t === 'mindmap') return k
				return null
			}, { timeout: 5000 })
			t.must(P, '[C] (1) eine Mindmap entsteht')
			t.must(await until(async () => textsOf(await sceneMap(pb, P)).length === 5, { timeout: 5000 }), '[C] (1) bob sieht ihre fünf Knoten', await sceneMap(pb, P))
			await settle([pa, pb])

			t.step('(2) alice zieht A mit der Maus auf freie Fläche')
			const root = await nodeWith(pa, P, 'Thema')
			const nA = await nodeWith(pa, P, 'A')
			const drop = { x: root.x + root.w / 2 + 450, y: root.y + root.h / 2 - 300 }
			const from = await nodePoint(pa, P, 'A')
			const to = await K.w2s(pa, drop.x, drop.y)
			// the pointer moves by as much as the ghost: it starts at A's centre and ends at the drop point
			await dragPath(pa, from, to, { steps: 16 })
			const t0 = Date.now()
			const freeAt = async (p) => {
				const n = await nodeWith(p, P, 'A')
				return n?.free === true && Math.abs(n.x + n.w / 2 - drop.x) <= 1 && Math.abs(n.y + n.h / 2 - drop.y) <= 1
			}
			const both = await until(async () => (await freeAt(pa)) && (await freeAt(pb)), { timeout: 5000 })
			t.check(both && Date.now() - t0 <= SEEN_MS, '[C] (2) bei beiden steht A binnen 3 s frei am Ablageort (±1)', { a: await nodeWith(pa, P, 'A'), b: await nodeWith(pb, P, 'A'), drop, ms: Date.now() - t0 })
			for (const [who, p] of [['alice', pa], ['bob', pb]]) {
				const m = await sceneMap(p, P)
				const A = m.nodes.find((n) => n.text === 'A')
				const A1 = m.nodes.find((n) => n.text === 'A1')
				t.check(A1?.parent === A.key && Math.abs(A1.x - (A.x + A.w + 40)) <= 1, `[S] (2) bei ${who} steht A1 neben A (Teilbaum zieht mit)`, { A, A1 })
				const hit = m.nodes.filter((n) => n.key !== A.key && n.x !== null && overlap(n, A)).map((n) => n.text)
				t.check(hit.length === 0, `[S] (2) bei ${who} überdeckt A keinen Knoten`, hit)
			}
			const sv = (await serverMap('alice', board)).get(P)
			const mA = sv?.data?.nodes?.[`b${nA.key[1]}`]?.[nA.key]?.m
			t.check(Array.isArray(mA) && mA.length === 2, '[B] (2) der Server speichert m an A', sv?.data?.nodes)
			await settle([pa, pb])

			t.step('(3) bob wählt im Menü von A „Rearrange“')
			await pb.locator(CANVAS).first().focus()
			const ap = await nodePoint(pb, P, 'A')
			await pb.mouse.click(ap.x, ap.y)
			t.must(await until(async () => (await sceneMap(pb, P))?.focus === nA.key, { timeout: 3000 }), '[S] (3) bei bob hat A den Fokus')
			await pb.mouse.click(ap.x, ap.y, { button: 'right' })
			t.must(await until(async () => (await pb.locator(MENU).count()) > 0, { timeout: 3000 }), '[S] (3) das Kontextmenü öffnet sich auf A')
			const names = await pb.locator(`${MENU} button[data-knorke-menu-item]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-knorke-menu-item')))
			t.check(names.includes('mm-rearrange'), '[S] (3) das Menü von A hat „Rearrange“', names)
			await pb.locator(`${MENU} button[role="menuitem"][data-knorke-menu-item="mm-rearrange"]`).first().click({ timeout: 3000 })
			const back = await until(async () => (await nodeWith(pa, P, 'A'))?.free === false && (await nodeWith(pb, P, 'A'))?.free === false, { timeout: 5000 })
			t.check(back, '[C] (3) bei beiden steht A wieder im Layout', { a: await nodeWith(pa, P, 'A'), b: await nodeWith(pb, P, 'A') })
			await settle([pa, pb])
			const d = boxDiff(await sceneMap(pa, P), await sceneMap(pb, P))
			t.check(d <= 1, '[C] (3) jede Knotenkiste liegt bei beiden gleich (±1)', { d })
			const sv3 = (await serverMap('alice', board)).get(P)
			t.check(sv3?.data?.nodes?.[`b${nA.key[1]}`]?.[nA.key]?.m === undefined, '[B] (3) der Server hat kein m mehr an A', sv3?.data?.nodes)
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}

/** Selects a mind map by a click on its node with the text, then chooses a layout in the context bar's section "Layout". */
async function chooseLayout(t, page, id, text, value) {
	await page.locator(CANVAS).first().focus()
	const p = await nodePoint(page, id, text)
	await page.mouse.click(p.x, p.y)
	t.must(await until(async () => (await sceneMap(page, id))?.focus !== null, { timeout: 3000 }), `[S] ${value}: die Mindmap ist gewählt`)
	const section = page.locator('[data-knorke-section="mm-layout"]').first()
	t.must(await until(async () => (await section.count()) > 0, { timeout: 3000 }), `[S] ${value}: die Kontextleiste hat „Layout“`)
	if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click({ timeout: 3000 })
	await page.locator(`[data-knorke-action="mm-layout"][data-knorke-value="${value}"]`).first().click({ timeout: 3000 })
}

/** E79: bob's camera, not at 100 %, so the editor's font is scaled (job 198 round 3: the placeholder follows it). */
const CAM_B = Object.freeze({ x: -600, y: -300, scale: 0.8 })

/** The open node editor: its font size, that of its placeholder, and whether the placeholder fits in it. */
const placeholderFit = (page) => page.evaluate((sel) => {
	const ta = document.querySelector(sel)
	if (!ta) return null
	const mirror = ta.cloneNode()
	mirror.value = ta.placeholder
	mirror.style.setProperty('visibility', 'hidden', 'important')
	ta.parentNode.appendChild(mirror)
	const ph = getComputedStyle(ta, '::placeholder')
	const out = {
		font: getComputedStyle(ta).fontSize, placeholderFont: ph.fontSize,
		need: mirror.scrollHeight, has: ta.clientHeight, placeholder: ta.placeholder, value: ta.value,
		color: ph.color, opacity: ph.opacity,
		scheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
	}
	mirror.remove()
	return out
}, NODE_EDITOR).catch(() => null)

/** (job 198, round 5) Contrast of the placeholder on the card under the editor, which is always white (MM_FILL); null if unreadable. */
const placeholderContrast = (fit) => {
	const c = parseColor(fit?.color)
	if (!c) return null
	const a = c.a * Number(fit.opacity ?? 1)
	const white = { r: 255, g: 255, b: 255, a: 1 }
	const shown = over({ ...c, a }, white)
	return { ratio: contrastRatio(shown, white), color: fmtColor(shown) }
}

export const E79 = {
	id: 'E79',
	title: 'Organigramm und Baum (Job 198): alice fügt „Chefin / A / A1 / B“ ein und wählt „Org chart“, bei bob ≤ 3 s A und B nebeneinander unter der Mitte, A1 unter A, gleiche Kisten; „Tree“ und zurück „Mind map“ ergibt die Kisten vom Anfang; im Organigramm schreibt bob in A „Anna“, Umschalt+Enter, „Lead“, alice sieht Name und Rolle',
	async run(t, world) {
		const board = await world.board('E79 Organigramm')
		await shareWith(board, [{ kind: 'user', id: 'bob', role: 'edit' }])
		const a = await world.actor('alice-orgchart', { user: 'alice' })
		// (job 198, round 5) bob in the dark theme: the placeholder of a card must stay readable there (step 5)
		const b = await world.actor('bob-orgchart', { user: 'bob', colorScheme: 'dark' })
		const pa = a.page
		const pb = b.page
		try {
			await storeCamera(pa, board, CAM)
			await storeCamera(pb, board, CAM_B)
			for (const x of [a, b]) await openBoard(x, board)

			t.step('(1) alice fügt „Chefin / A / A1 / B“ als Liste ein')
			const spot = await K.w2s(pa, 0, 0)
			await pa.mouse.move(spot.x, spot.y)
			const before = await idSet(pa)
			const pasted = await pa.evaluate((text) => {
				const dt = new DataTransfer()
				dt.setData('text/plain', text)
				const catcher = document.querySelector('textarea[data-knorke-paste-catcher]')
				if (!catcher) return { error: 'kein Einfüge-Fänger' }
				catcher.focus()
				const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
				catcher.dispatchEvent(e)
				return { prevented: e.defaultPrevented }
			}, 'Chefin\n\tA\n\t\tA1\n\tB')
			t.check(pasted?.prevented === true, '[C] (1) Knorke nimmt das Einfügen an', pasted)
			const P = await until(async () => {
				for (const [k, it] of await itemMap(pa)) if (!before.has(k) && it.t === 'mindmap') return k
				return null
			}, { timeout: 5000 })
			t.must(P, '[C] (1) eine Mindmap entsteht')
			t.must(await until(async () => textsOf(await sceneMap(pb, P)).length === 4, { timeout: 5000 }), '[C] (1) bob sieht ihre vier Knoten', await sceneMap(pb, P))
			await settle([pa, pb])
			const start = await sceneMap(pa, P)
			const nA = start.nodes.find((n) => n.text === 'A')

			t.step('(2) alice wählt „Org chart“')
			await chooseLayout(t, pa, P, 'Chefin', 'org')
			const t0 = Date.now()
			const seen = await until(async () => (await sceneMap(pb, P))?.layout === 'org', { timeout: 5000 })
			t.check(seen && Date.now() - t0 <= SEEN_MS, '[C] (2) bei bob ist binnen 3 s das Organigramm da', { ms: Date.now() - t0 })
			await settle([pa, pb])
			for (const [who, p] of [['alice', pa], ['bob', pb]]) {
				const m = await sceneMap(p, P)
				const [R, A, A1, B] = ['Chefin', 'A', 'A1', 'B'].map((x) => m.nodes.find((n) => n.text === x))
				t.check(A.y > R.y + R.h && Math.abs(A.y - B.y) <= 1 && A.x + A.w <= B.x, `[S] (2) bei ${who} stehen A und B nebeneinander unter der Mitte`, { R, A, B })
				t.check(A1.y > A.y + A.h && A1.x < A.x + A.w && A1.x + A1.w > A.x, `[S] (2) bei ${who} steht A1 unter A`, { A, A1 })
				t.check(m.nodes.every((n) => n.shape !== 'line'), `[S] (2) bei ${who} sind alle Knoten Kästen`, m.nodes.map((n) => n.shape))
			}
			t.check(boxDiff(await sceneMap(pa, P), await sceneMap(pb, P)) <= 1, '[C] (2) jede Kiste liegt bei beiden gleich (±1)')
			t.check((await serverMap('alice', board)).get(P)?.style?.layout === 'org', '[B] (2) der Server speichert „org“')

			t.step('(3) alice wählt „Tree“, dann „Mind map“')
			await chooseLayout(t, pa, P, 'Chefin', 'tree')
			t.must(await until(async () => (await sceneMap(pb, P))?.layout === 'tree', { timeout: 5000 }), '[C] (3) bei bob ist der Baum da')
			await settle([pa, pb])
			const tr = await sceneMap(pb, P)
			const [tR, tA] = ['Chefin', 'A'].map((x) => tr.nodes.find((n) => n.text === x))
			t.check(tA.x > tR.x + tR.w, '[S] (3) im Baum steht A rechts der Mitte', { tR, tA })
			await chooseLayout(t, pa, P, 'Chefin', 'both')
			t.must(await until(async () => (await sceneMap(pb, P))?.layout === 'both', { timeout: 5000 }), '[C] (3) bei bob ist die Mindmap wieder da')
			await settle([pa, pb])
			t.check(boxDiff(start, await sceneMap(pa, P)) <= 1 && boxDiff(start, await sceneMap(pb, P)) <= 1, '[C] (3) die Kisten sind wieder die vom Anfang (±1)')

			t.step('(4) Organigramm: bob schreibt in A „Anna“, Umschalt+Enter, „Lead“')
			await chooseLayout(t, pa, P, 'Chefin', 'org')
			t.must(await until(async () => (await sceneMap(pb, P))?.layout === 'org', { timeout: 5000 }), '[C] (4) bei bob ist das Organigramm da')
			await settle([pa, pb])
			await pb.locator(CANVAS).first().focus()
			const ap = await nodePoint(pb, P, 'A')
			await pb.mouse.click(ap.x, ap.y)
			t.must(await until(async () => (await sceneMap(pb, P))?.focus === nA.key, { timeout: 3000 }), '[S] (4) bei bob hat A den Fokus')
			await pb.keyboard.press('F2')
			t.must(await until(async () => (await nodeEditor(pb))?.node === nA.key, { timeout: 3000 }), '[S] (4) der Editor von A ist offen')
			const ph = await pb.evaluate((sel) => document.querySelector(sel)?.placeholder ?? null, NODE_EDITOR)
			t.check(typeof ph === 'string' && ph.length > 0, '[S] (4) der Karteneditor hat einen Platzhalter', ph)
			await pb.keyboard.press('ControlOrMeta+A')
			await pb.keyboard.type('Anna')
			await pb.keyboard.press('Shift+Enter')
			await pb.keyboard.type('Lead')
			await pb.keyboard.press('Escape')
			const card = async (p) => (await sceneMap(p, P))?.nodes.find((n) => n.key === nA.key) ?? null
			const ok = await until(async () => {
				const c = await card(pa)
				return c?.name === 'Anna' && c?.role === 'Lead'
			}, { timeout: 5000 })
			t.check(ok, '[C] (4) alice sieht Name „Anna“ und Rolle „Lead“', await card(pa))
			await settle([pa, pb])
			t.check(boxDiff(await sceneMap(pa, P), await sceneMap(pb, P)) <= 1, '[C] (4) jede Kiste liegt bei beiden gleich (±1)')

			t.step('(5) bob hängt bei 80 % mit Enter eine leere Karte an: ihr Platzhalter passt ganz hinein')
			await pb.locator(CANVAS).first().focus()
			const ap5 = await nodePoint(pb, P, 'Anna\nLead')
			await pb.mouse.click(ap5.x, ap5.y)
			t.must(await until(async () => (await sceneMap(pb, P))?.focus === nA.key, { timeout: 3000 }), '[S] (5) bei bob hat A den Fokus')
			await pb.keyboard.press('Enter')
			t.must(await until(async () => {
				const e = await nodeEditor(pb)
				return e && e.node !== nA.key && e.value === ''
			}, { timeout: 3000 }), '[S] (5) der Editor der neuen leeren Karte ist offen')
			await settle([pb])
			const fit = await placeholderFit(pb)
			t.check(fit && fit.placeholder.length > 0 && fit.font === fit.placeholderFont, '[S] (5) der Platzhalter hat die Schrift des Editors (80 %)', fit)
			t.check(fit && fit.need <= fit.has + 1, '[S] (5) der Platzhalter passt ganz in den Editor der leeren Karte', fit)
			t.check(fit?.scheme === 'dark', '[D] (5) bobs Seite rendert im dunklen Schema', fit?.scheme)
			const pc = placeholderContrast(fit)
			t.check(pc !== null && pc.ratio >= MIN_RATIO, `[S] (5) der Platzhalter hat auf der weißen Karte Kontrast ≥ ${MIN_RATIO} : 1 (dunkles Thema)`, { ...pc, raw: fit?.color, opacity: fit?.opacity })
			await pb.keyboard.press('Escape')
			await settle([pa, pb])
		} finally {
			await world.drop(b)
			await world.drop(a)
		}
	},
}
