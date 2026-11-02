/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * "Summarise" and "Cluster by topic" of a board session (factory job 267),
 * through the routes 59–61 (api/ai.js; tests: deps.ai). The server writes
 * the result onto the board itself (AiService, also with the tab closed);
 * this module only starts, shows and finishes a task here:
 *
 * - load(): route 59 once the board is open (accounts only, mode user):
 *   whether AI is ready (admin switch, provider), the notice, the limit and
 *   this account's tasks on the board. Running ones come back as the chip
 *   "AI is working…" after a reload.
 * - offer(all): what the context bar shows for a selection (selection v2
 *   ai: {summarise, cluster}): only in mode edit, with AI ready and the
 *   board switch on (meta.ai not "off"), while no task of this tab runs.
 *   summarise: at least one selected item with text or a frame; cluster:
 *   the one selected frame with at least two sortable notes, or at least
 *   two loose sortable notes (actions.sortableNotes, like "Sort by color").
 * - run(kind): the notice first when it is not confirmed (ui.onAiNotice
 *   {text, url} → Promise<boolean>; text null = the built-in text), then
 *   route 60 with the ids in reading order; 409 ai_notice asks again once.
 *   Errors become one toast each (limit with its number).
 * - while a task runs: route 59 every POLL_MS; done → ONE undo step from
 *   the task's ops and inverse (the server wrote them; nothing is sent
 *   again), the result selected once the sync brought it, the task
 *   forgotten (route 61); failed → a toast and forgotten.
 *   (Round 2) The result of a task this tab started is brought into view when
 *   it lies outside (zoomToRect below the top chrome, like an insert).
 * - cancel(): route 61 for every running task (it still counts).
 * - fixHeights(items): an AI card whose stored h differs from what its
 *   content needs by more than HEIGHT_SLACK gets one patch {h} from this
 *   tab, outside the undo history, at most once per card and session (two
 *   browsers with other font metrics never ping-pong).
 * ui.onAi(view) reports {available, working, kinds, allowed, owner, ready}.
 *
 * (Job 268) "Create with AI" of the tool bar: a diagram from a prompt. One
 * diagram task per tab (this.diagram {open, task, shape, status, tree,
 * error}, reported as ui.onAiDiagram(view)); the server writes nothing for
 * it, route 59 brings the tree. openDiagram() shows the window;
 * runDiagram(shape, prompt) asks the notice and starts it (route 60 kind
 * diagram); done keeps the task (the preview) until insertDiagram() (the
 * host's insertAiDiagram builds the mind map, one undo step; then route
 * 61), runDiagram() again ("Try again": the old one is forgotten first) or
 * closeDiagram() (cancels or forgets it). failed shows its message in the
 * window and forgets the task. After a reload (load) the newest diagram
 * task of the account on the board opens the window again; the polls take
 * only the diagram task of this tab. While it runs the bar offers nothing.
 * (Job 269) The shape flowchart: route 59 brings flow {nodes, edges}, kept
 * as the window's tree; the host lays it out and inserts shapes and
 * connectors (insertAiDiagram, async: aiFlow.js comes as a part).
 * (Job 276) The shape workshop: route 59 brings workshop {parts}, kept the
 * same way; the host inserts its frames (aiWorkshop.js, the same part).
 */
import { aiState, forgetAi, startAi } from '../api/ai.js'
import { isLocked } from '../model/locks.js'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'
import { readingOrder, sortableNotes } from './actions.js'

/** How often a running task is asked for (ms). */
export const POLL_MS = 2000
/** A stored card height may differ from the measured one by this much. */
export const HEIGHT_SLACK = 2
/** Types whose text goes to the AI (AiLayout::TEXT_OF). */
const TEXT_PATHS = Object.freeze({ sticky: 'text', text: 'text', shape: 'text', frame: 'title' })

/** The session's fields the host gives as functions without arguments (read at the call). */
export const AI_STATE = Object.freeze(['board', 'boardId', 'clientMode', 'deps', 'destroyed', 'frozen', 'mode', 'model', 'scene', 'selection', 'sync', 'ui', 'undoStack', 'viewOnly'])

/** The session's methods the host hands over under the same name. */
export const AI_CALLS = Object.freeze(['boundsOf', 'emitSelection', 'emitUndo', 'flushVisible', 'info', 'insertAiDiagram', 'reserveTop', 'select', 'toast', 'viewTop', 'viewportWorld', 'zoomToRect'])

/** (Jobs 268, 269) The shapes of a diagram from a prompt, and the most code points of the prompt (AiLayout). */
export const DIAGRAM_SHAPES = Object.freeze(['mindmap', 'org', 'tree', 'flowchart', 'workshop'])
export const PROMPT_MAX = 1000

/**
 * @param {unknown} meta board meta
 * @return {boolean} the board switch is on
 */
export function boardAllowsAi(meta) {
	return !(meta && typeof meta === 'object' && meta.ai === 'off')
}

/**
 * @param {object} it item
 * @return {boolean} it gives the AI a text (or is a frame)
 */
function hasText(it) {
	const k = TEXT_PATHS[it?.t]
	return k !== undefined && (it.t === 'frame' || (typeof it.data?.[k] === 'string' && it.data[k].trim() !== ''))
}

/**
 * The message of a failed start or task.
 *
 * @param {string} code error code
 * @param {object} [body] error body (max)
 * @return {string|null} the toast, null for none
 */
export function aiMessage(code, body = {}) {
	switch (code) {
	case 'ai_limit': return t('knorke', 'You have used your {max} AI tasks for today.', { max: Number.isInteger(body?.max) ? body.max : 0 })
	case 'ai_unavailable': return t('knorke', 'AI is not available on this board.')
	case 'forbidden': return t('knorke', 'AI is not available on this board.')
	case 'ai_empty': return t('knorke', 'There is no text the AI could work with.')
	case 'ai_too_much': return t('knorke', 'Too much text for the AI. Select fewer items.')
	case 'ai_answer': return t('knorke', 'The AI answer could not be used. Try again.')
	case 'ai_gone': return t('knorke', 'The items changed meanwhile, so the AI result was not placed.')
	// job 275: summarise and cluster wait for the reveal of private writing
	case 'private_on': return t('knorke', 'Not possible during private writing.')
	case 'ai_cancelled': return null
	default: return t('knorke', 'The AI could not finish. Try again later.')
	}
}

/**
 * (Job 268) The message of a failed diagram task in the window.
 *
 * @param {string} code error code
 * @param {number} [max] the limit (ai_limit)
 * @return {string} the message
 */
export function diagramMessage(code, max) {
	if (code === 'ai_too_much') return t('knorke', 'The request is too long (at most {max} characters).', { max: PROMPT_MAX })
	if (code === 'ai_empty') return t('knorke', 'Describe what the diagram should show.')
	if (code === 'ai_cancelled') return t('knorke', 'The AI task was cancelled.')
	return aiMessage(code, { max }) ?? aiMessage('')
}

export class SessionAi {
	/**
	 * @param {object} h host: one function per name of AI_STATE and AI_CALLS
	 */
	constructor(h) {
		this.h = h
		/** route 59's answer, null until loaded (or for guests) */
		this.state = null
		/** task id → kind, the tasks this tab waits for */
		this.running = new Map()
		/** task id → ids to select once the sync brought them */
		this.pendingSelect = null
		/** (round 2) the tasks this tab started: their result is brought into view */
		this.mine = new Set()
		this.reveal = false
		this.timer = null
		this.starting = false
		/** (job 269) an Insert waits for the host */
		this.inserting = false
		/** card ids this session already corrected */
		this.fixed = new Set()
		/** (job 268) the diagram window: {open, task, shape, status: null|running|done|failed, tree, error} */
		this.diagram = { open: false, task: null, shape: 'mindmap', status: null, tree: null, error: null }
	}

	/** @return {object} the route calls (tests: deps.ai) */
	api() {
		return this.h.deps().ai ?? { aiState, startAi, forgetAi }
	}

	/** Route 59 once the board is open (accounts only). */
	async load() {
		const h = this.h
		if (h.mode() !== 'user' || h.boardId() === null || h.destroyed()) {
			return
		}
		try {
			this.state = await this.api().aiState(h.boardId())
		} catch (e) {
			this.state = null
			console.warn('[knorke] loading the AI state failed', e)
			return
		}
		// (job 268) only the first load takes a diagram task over
		this.take(this.state?.tasks, !this.adopted)
		this.adopted = true
		this.emit()
	}

	/** @return {boolean} AI may be offered here now (role, mode, switches) */
	available() {
		const h = this.h
		const s = this.state
		return !!s && s.ready === true && s.reason !== 'forbidden' && h.clientMode() === 'edit' && !h.viewOnly() && !h.frozen()
			&& boardAllowsAi(h.board()?.meta)
	}

	/**
	 * The bar's AI buttons for a selection.
	 *
	 * @param {object[]} all the selected items (locked too)
	 * @return {{summarise: boolean, cluster: boolean}}
	 */
	offer(all) {
		const none = { summarise: false, cluster: false }
		const model = this.h.model()
		if (!this.available() || this.running.size > 0 || this.starting || this.diagramRunning() || !model || all.length === 0) {
			return none
		}
		return {
			summarise: all.some(hasText),
			cluster: this.clusterTarget(all) !== null,
		}
	}

	/**
	 * @param {object[]} all selected items
	 * @return {{frame: string|null, ids: string[]}|null} what a clustering takes, null when it cannot
	 */
	clusterTarget(all) {
		const model = this.h.model()
		if (all.length === 1 && all[0].t === 'frame' && !isLocked(all[0])) {
			return sortableNotes(model, [], { frame: all[0].id }).length >= 2 ? { frame: all[0].id, ids: [] } : null
		}
		const ids = sortableNotes(model, all.map((it) => it.id))
		return ids.length >= 2 ? { frame: null, ids: readingOrder(model, ids) } : null
	}

	/**
	 * "Summarise" or "Cluster by topic" of the bar.
	 *
	 * @param {'summarise'|'cluster'} kind what to do
	 * @return {Promise<boolean>} started
	 */
	async run(kind) {
		const h = this.h
		const model = h.model()
		if (!model || this.starting || this.running.size > 0 || this.diagramRunning() || !this.available()) {
			return false
		}
		const all = h.selection().filter((id) => model.has(id)).map((id) => model.get(id))
		let body
		if (kind === 'cluster') {
			const target = this.clusterTarget(all)
			if (target === null) return false
			body = { kind, ids: target.ids, frame: target.frame }
		} else if (kind === 'summarise') {
			const ids = readingOrder(model, all.filter(hasText).map((it) => it.id))
			if (ids.length === 0) return false
			body = { kind, ids }
		} else {
			return false
		}
		this.starting = true
		h.emitSelection()
		try {
			for (let attempt = 0; attempt < 2; attempt++) {
				const accept = await this.confirmNotice()
				if (accept === null) return false
				try {
					const task = await this.api().startAi(h.boardId(), { ...body, acceptNotice: accept })
					if (Number.isInteger(task)) {
						this.running.set(task, kind)
						this.mine.add(task)
						if (this.state?.notice) this.state.notice.confirmed = true
						if (this.state?.limit) this.state.limit.used = (this.state.limit.used ?? 0) + 1
						this.schedule()
					}
					return true
				} catch (e) {
					if (e instanceof HttpError && e.code === 'ai_notice' && attempt === 0) {
						// the admin changed the text meanwhile: ask again
						if (this.state?.notice) this.state.notice.confirmed = false
						await this.load()
						continue
					}
					const msg = e instanceof HttpError ? aiMessage(e.code, e.body) : aiMessage('')
					if (msg) h.toast(msg)
					return false
				}
			}
			return false
		} finally {
			this.starting = false
			this.emit()
			h.emitSelection()
		}
	}

	/**
	 * @return {Promise<boolean|null>} false: confirmed before; true: confirmed now; null: declined
	 */
	async confirmNotice() {
		const n = this.state?.notice
		if (n?.confirmed === true) {
			return false
		}
		const ask = this.h.ui().onAiNotice
		if (typeof ask !== 'function') {
			return null
		}
		const yes = await ask({ text: typeof n?.text === 'string' ? n.text : null, url: typeof n?.url === 'string' ? n.url : '' })
		return yes === true ? true : null
	}

	/** "Cancel" of the chip: every running task of this board. */
	async cancel() {
		const tasks = [...this.running.keys()]
		this.running.clear()
		this.stop()
		this.emit()
		this.h.emitSelection()
		for (const task of tasks) {
			try {
				await this.api().forgetAi(this.h.boardId(), task)
			} catch (e) {
				console.warn('[knorke] cancelling the AI task failed', e)
			}
		}
	}

	/**
	 * The tasks of route 59: running ones are waited for, finished ones handled.
	 *
	 * @param {unknown} tasks route 59 tasks
	 */
	take(tasks, adopt = false) {
		if (!Array.isArray(tasks)) return
		const seen = new Set()
		const diagrams = []
		for (const tk of tasks) {
			if (!tk || !Number.isInteger(tk.task)) continue
			if (tk.kind === 'diagram') {
				diagrams.push(tk)
				continue
			}
			seen.add(tk.task)
			if (tk.status === 'running') {
				this.running.set(tk.task, tk.kind)
			} else if (tk.status === 'done' || tk.status === 'failed') {
				this.running.delete(tk.task)
				this.finish(tk)
			}
		}
		for (const task of [...this.running.keys()]) {
			if (!seen.has(task)) this.running.delete(task)
		}
		this.takeDiagram(diagrams, adopt)
		if (this.running.size > 0 || this.diagramRunning()) this.schedule()
	}

	/**
	 * (Job 268) The diagram tasks of route 59: the one of this tab, or after
	 * a reload (adopt) the newest one when this tab has none.
	 *
	 * @param {object[]} list route 59 tasks of kind diagram, oldest first
	 * @param {boolean} adopt take one over (load)
	 */
	takeDiagram(list, adopt) {
		const d = this.diagram
		if (d.task === null && adopt && list.length > 0) {
			const tk = list[list.length - 1]
			this.diagram = { open: true, task: tk.task, shape: DIAGRAM_SHAPES.includes(tk.shape) ? tk.shape : 'mindmap', status: 'running', tree: null, error: null }
			this.emitDiagram()
		}
		const cur = this.diagram
		if (cur.task === null || cur.status !== 'running') return
		const tk = list.find((x) => x.task === cur.task)
		// (job 269) a flowchart's result is its flow {nodes, edges}, (job 276) a workshop's its parts; the window keeps it as tree
		const result = tk?.[cur.shape === 'flowchart' ? 'flow' : cur.shape === 'workshop' ? 'workshop' : 'tree']
		if (!tk) {
			// gone (forgotten elsewhere or dropped after a day)
			this.diagram = { ...cur, task: null, status: 'failed', error: 'ai_failed' }
		} else if (tk.status === 'done' && result && typeof result === 'object') {
			this.diagram = { ...cur, status: 'done', tree: result, error: null }
		} else if (tk.status === 'failed' || tk.status === 'done') {
			this.diagram = { ...cur, task: null, status: 'failed', error: tk.error ?? 'ai_answer' }
			this.forget(tk.task)
		} else {
			return
		}
		this.emitDiagram()
	}

	/** @return {boolean} a diagram task of this tab runs */
	diagramRunning() {
		return this.diagram.status === 'running'
	}

	/** @param {number} task route 61, errors only logged */
	forget(task) {
		this.api().forgetAi(this.h.boardId(), task).catch((e) => console.warn('[knorke] forgetting the AI task failed', e))
	}

	/** (Job 268) "Create with AI" of the tool bar: the window (only while AI is available). */
	openDiagram() {
		if (!this.available() && this.diagram.task === null) return false
		this.diagram = { ...this.diagram, open: true }
		this.emitDiagram()
		return true
	}

	/**
	 * (Job 268) "Create" and "Try again": the notice when needed, then route
	 * 60 kind diagram; a previous task of the window is forgotten first.
	 *
	 * @param {string} shape DIAGRAM_SHAPES
	 * @param {string} prompt the request
	 * @return {Promise<boolean>} started
	 */
	async runDiagram(shape, prompt) {
		const h = this.h
		const text = typeof prompt === 'string' ? prompt.trim() : ''
		if (!DIAGRAM_SHAPES.includes(shape) || text === '' || [...text].length > PROMPT_MAX || this.starting || this.diagramRunning()
			|| this.running.size > 0 || !this.available()) {
			return false
		}
		const old = this.diagram.task
		if (old !== null) this.forget(old)
		this.diagram = { open: true, task: null, shape, status: null, tree: null, error: null }
		this.starting = true
		this.emitDiagram()
		h.emitSelection()
		try {
			for (let attempt = 0; attempt < 2; attempt++) {
				const accept = await this.confirmNotice()
				if (accept === null) return false
				try {
					const task = await this.api().startAi(h.boardId(), { kind: 'diagram', shape, prompt: text, acceptNotice: accept })
					if (!Number.isInteger(task)) return false
					if (this.state?.notice) this.state.notice.confirmed = true
					if (this.state?.limit) this.state.limit.used = (this.state.limit.used ?? 0) + 1
					if (!this.diagram.open) {
						// closed while it was starting
						this.forget(task)
						return false
					}
					this.diagram = { ...this.diagram, task, status: 'running' }
					this.schedule()
					return true
				} catch (e) {
					if (e instanceof HttpError && e.code === 'ai_notice' && attempt === 0) {
						if (this.state?.notice) this.state.notice.confirmed = false
						await this.load()
						continue
					}
					this.diagram = { ...this.diagram, status: 'failed', error: e instanceof HttpError ? e.code : 'ai_failed', limit: e?.body?.max }
					return false
				}
			}
			return false
		} finally {
			this.starting = false
			this.emitDiagram()
			this.emit()
			h.emitSelection()
		}
	}

	/**
	 * (Job 268) "Insert": the preview's tree as a mind map (host
	 * insertAiDiagram: one undo step, selected), then the task is forgotten
	 * and the window closes. A board that is full keeps the window open.
	 *
	 * (Job 269) A flowchart's insert waits for its part (aiFlow.js): one
	 * insert at a time; a window closed meanwhile stays closed.
	 *
	 * @return {Promise<boolean>} inserted
	 */
	async insertDiagram() {
		const d = this.diagram
		if (d.status !== 'done' || !d.tree || this.inserting || this.h.viewOnly() || this.h.frozen()) return false
		this.inserting = true
		let ok
		try {
			ok = await this.h.insertAiDiagram(d.tree, d.shape)
		} finally {
			this.inserting = false
		}
		if (ok !== true) return false
		if (d.task !== null) this.forget(d.task)
		if (this.diagram === d) {
			this.diagram = { open: false, task: null, shape: d.shape, status: null, tree: null, error: null }
			this.emitDiagram()
		}
		return true
	}

	/** (Job 268) "Cancel", Esc, closing: a running task is cancelled, a result forgotten. */
	closeDiagram() {
		const d = this.diagram
		if (d.task !== null) this.forget(d.task)
		this.diagram = { open: false, task: null, shape: d.shape, status: null, tree: null, error: null }
		this.emitDiagram()
		this.emit()
		this.h.emitSelection()
	}

	/** Reports the diagram window (ui.onAiDiagram). */
	emitDiagram() {
		const d = this.diagram
		this.h.ui().onAiDiagram?.({
			open: d.open,
			working: this.starting || d.status === 'running',
			shape: d.shape,
			tree: d.status === 'done' ? d.tree : null,
			error: d.status === 'failed' ? diagramMessage(d.error, d.limit) : null,
		})
	}

	/**
	 * A finished task: the undo step (done) or the toast (failed), then it is forgotten.
	 *
	 * @param {object} tk route 59 task
	 */
	finish(tk) {
		const h = this.h
		if (tk.status === 'done' && Array.isArray(tk.ops) && Array.isArray(tk.inverse) && tk.ops.length > 0 && tk.ops.length === tk.inverse.length) {
			// the server wrote the ops: one undo step, nothing sent again
			h.undoStack().push({ ops: tk.ops, inverse: tk.inverse })
			h.emitUndo()
			this.pendingSelect = Array.isArray(tk.select) ? tk.select.filter((id) => typeof id === 'string') : null
			this.reveal = this.mine.delete(tk.task)
			h.sync()?.poke?.()
			this.selectArrived()
		} else if (tk.status === 'failed') {
			const msg = aiMessage(tk.error)
			if (msg) h.toast(msg)
		}
		this.api().forgetAi(h.boardId(), tk.task).catch((e) => console.warn('[knorke] forgetting the AI task failed', e))
	}

	/** The result is selected once the model holds it (the sync brings the server's writes). */
	selectArrived() {
		const ids = this.pendingSelect
		const model = this.h.model()
		if (!ids || !model) return
		if (ids.length === 0 || ids.every((id) => model.has(id))) {
			this.pendingSelect = null
			if (ids.length > 0) this.h.select(ids)
			if (this.reveal && ids.length > 0) this.bringIntoView(ids)
			this.reveal = false
		}
	}

	/**
	 * (Round 2) The result of a task of this tab outside the view: the camera
	 * shows it, below the top chrome and the context bar (like an insert).
	 *
	 * @param {string[]} ids the result
	 */
	bringIntoView(ids) {
		const h = this.h
		const b = h.boundsOf(ids)
		const v = h.viewportWorld()
		if (b && v && !(b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h)) {
			h.zoomToRect(h.reserveTop(b, h.viewTop()))
		}
	}

	schedule() {
		if (this.timer !== null || this.h.destroyed()) return
		const sleep = this.h.deps().aiSleep
		const tick = async () => {
			this.timer = null
			if (this.h.destroyed() || (this.running.size === 0 && !this.diagramRunning())) return
			try {
				this.state = await this.api().aiState(this.h.boardId())
				this.take(this.state?.tasks)
			} catch (e) {
				console.warn('[knorke] asking for the AI task failed', e)
				this.schedule()
			}
			this.emit()
			this.h.emitSelection()
		}
		this.timer = typeof sleep === 'function' ? sleep(POLL_MS).then(tick) : setTimeout(tick, POLL_MS)
	}

	stop() {
		if (this.timer !== null && typeof this.timer !== 'object') clearTimeout(this.timer)
		this.timer = null
	}

	/**
	 * AI cards whose stored height differs from their content (file comment).
	 *
	 * @param {Iterable<object>} items items just arrived or loaded
	 */
	fixHeights(items) {
		const h = this.h
		const scene = h.scene()
		const sync = h.sync()
		if (!scene?.measureAiHeight || !sync || h.clientMode() !== 'edit' || h.viewOnly() || h.frozen()) return
		const ops = []
		for (const it of items) {
			if (it?.t !== 'ai' || this.fixed.has(it.id) || isLocked(it)) continue
			const need = scene.measureAiHeight(it)
			if (need === null || Math.abs(need - it.h) <= HEIGHT_SLACK) continue
			this.fixed.add(it.id)
			ops.push({ o: 'patch', id: it.id, p: { h: Math.min(20000, Math.max(20, need)) } })
		}
		if (ops.length > 0) h.flushVisible(sync.enqueue(ops, { urgent: false }))
	}

	/** Reports the view (ui.onAi). */
	emit() {
		const s = this.state
		this.h.ui().onAi?.({
			available: this.available(),
			ready: s?.ready === true,
			owner: s?.owner === true,
			allowed: boardAllowsAi(this.h.board()?.meta),
			working: this.running.size > 0,
			kinds: [...new Set(this.running.values())],
		})
	}

	destroy() {
		this.stop()
		this.running.clear()
		this.diagram = { open: false, task: null, shape: 'mindmap', status: null, tree: null, error: null }
	}
}
