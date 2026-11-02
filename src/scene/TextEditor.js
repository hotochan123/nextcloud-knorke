/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Text editor overlay (SPEC-M0 §6.3): a <textarea> over the note (or over a
 * frame's title band) with the same font, line height and padding × scale,
 * horizontally centred for notes. Vertically it starts at the top instead of
 * the middle (accepted for M0); the Konva text is hidden meanwhile.
 *
 * Commits: intermediate states as intent {type:'text', final:false} at most
 * once per second; ending the editor commits with final:true. There is no
 * cancel in M0: blur, Esc, a click beside it and Ctrl/⌘+Enter all END WITH A
 * COMMIT (Enter also ends a frame title, which is one line). flush() (R4, T5)
 * sends the not yet committed text at once as an intermediate commit and
 * leaves the editor open (reload, close, tab hidden: no blur fires).
 *
 * Notice mode (setNotice, after a lost text lease or a rejected text op): the
 * notice is shown above the editor, the textarea gets
 * data-knorke-editor-state="locked", intermediate commits stop, and ending the
 * editor discards without an intent (the user was told to copy the text).
 * Lifting the notice (setNotice(null), a take-over) resumes the commits with
 * whatever was typed or rescued meanwhile.
 *
 * Editor kinds (SPEC-M1 §6.3, R2): note, title (frame), shape, text,
 * label (connector label, round 1b: centred at the route's labelAt, at most
 * limits.maxLabel characters), (job 188) padTitle (the title of a note pad,
 * one line, job 263: bold and left on its binding, at most limits.maxTitle); the
 * textarea carries
 * data-knorke-editor-kind=<kind>. [S] sets position, size, font size, line
 * height and alignment inline (!important, like M0, against Nextcloud's
 * global textarea styles); background, border, shadow, outline and color are
 * set inline WITHOUT priority as defaults, so [C] can style each kind in
 * knorke.css (with !important) over the attribute.
 *
 * Keys: Esc, Ctrl/⌘+Enter (and Enter in a title or a connector label;
 * Shift+Enter breaks the line there; job 188: Enter and Shift+Enter in a
 * pad's title, which stays one line) end with a commit and give the focus
 * back to the canvas. (R2) Series entry: Tab in a NOTE editor ends
 * like a final commit with next:'right' (the session creates the next note
 * to the right and opens its editor); Shift+Tab, and Tab in the other kinds,
 * commit and return the focus to the canvas (as M0, where Tab blurred).
 *
 * Cells (job 173): the kind cell edits one cell of a table
 * (data-knorke-cell=<col>.<row>, path data.cells.<col>.<row>, bold in the
 * header row); its text intents carry `cell`. Tab and Shift+Tab end it like
 * a click beside it and report move 1 / −1 to onClose (the scene opens the
 * next or previous cell); Enter breaks the line.
 *
 * Cells (job 174), only without a notice (with one, keys and paste act as
 * before, so rescued text is never lost): an arrow key without Shift,
 * Ctrl/⌘ or Alt, outside an IME composition, with the caret at the start
 * (← ↑) or at the end (→ ↓) of the text and a cell there (opts.neighbour)
 * ends the editor like Tab (preventDefault) and reports move 'left',
 * 'right', 'up' or 'down'; at the table's edge the key acts in the text.
 * (Job 185) ↑ and ↓ need no more than the caret (no selection) in the
 * first or last line of the text as the editor shows it, wrapping at the
 * cell's width included (a hidden mirror measures it; without a layout only
 * "\n" counts); ← and → still need the very start or end.
 * A paste whose clipboard holds a grid (model/table.js clipGrid: a tab in
 * text/plain or a table in text/html, which is only searched) is taken
 * over: one cell goes in at the caret as if typed (replacing the
 * selection, within maxLength); a larger grid ends the editor like Esc and
 * reports it as paste to onClose (the scene hands it to the session). A
 * paste without a grid is left to the browser. onClose gets notice: true
 * when the editor ended under a notice.
 *
 * Nodes (job 195): the kind node edits one node of a mind map
 * (data-knorke-node=<key>, path data.texts.<pot>.<key>, the root bold); its
 * text intents carry the key as cell, like a table's cell. Enter ends it
 * like a click beside it and reports add 'sibling' to onClose, Tab add
 * 'child' (the scene asks the session for the new node and its editor);
 * Shift+Enter breaks the line, Shift+Tab ends it like Esc; under a notice
 * Enter and Tab only end it.
 *
 * Lanes (job 199): the kind lane edits the name of one lane of a frame
 * (data-knorke-lane=<key>, path data.lanes.<key>.t) over the lane's head;
 * its text intents carry the key as cell. It wraps like the drawn name but
 * stays one line: Enter and Shift+Enter end it, like a pad's title.
 *
 * Markdown (job 279): in the kinds of RICH_KINDS (note, shape, text, cell)
 * format(what) puts or takes away ** * ~~ around the selection or toggles
 * "- " on its lines (the context bar's B, I, S and list button), and
 * Ctrl/⌘+B and Ctrl/⌘+I do bold and italic. The textarea shows the marks.
 *
 * Test hook: textarea[data-knorke-editor][data-knorke-editor-kind]. Text
 * only via value/textContent.
 */
import { setStyles } from './CursorLayer.js'
import { clipGrid } from '../model/table.js'
import { toggleList, toggleMarks } from '../model/richText.js'
import { FONT_FAMILY, FRAME_TITLE_COLOR, LINE_HEIGHT, SELECTION_COLOR, TEXT_COLOR } from '../model/tokens.js'

/** Intermediate commits at most this often. */
export const COMMIT_INTERVAL_MS = 1000

/** Editor kinds (registry `editor`), the values of data-knorke-editor-kind. */
export const EDITOR_KINDS = Object.freeze(['note', 'title', 'shape', 'text', 'label', 'cell', 'padTitle', 'node', 'lane'])

/** (job 279) Editor kinds whose text understands Markdown: they get B, I, S, the list button and Ctrl/⌘+B/I. */
export const RICH_KINDS = Object.freeze(['note', 'shape', 'text', 'cell'])

/** (job 174) The arrow keys of a cell editor and the direction each one moves. */
const CELL_ARROWS = Object.freeze({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })

/** (job 185) The computed text styles of the textarea its line mirror takes over. */
const MIRROR_STYLES = Object.freeze(['font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'letter-spacing',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'white-space', 'overflow-wrap', 'word-break', 'tab-size'])

export class TextEditor {
	#root
	#o
	#ta = null
	#noticeEl = null
	#id = null
	#path = null
	#kind = 'note'
	/** (job 173) the cell of a table the editor writes in, else null */
	#cell = null
	#before = ''
	#notice = null
	#dirty = false
	/** last value handed out as an intent (the model value at opening until then) */
	#sent = ''
	#committed = false
	#lastCommit = -Infinity
	#timer = null
	#closing = false
	#layoutSig = ''

	/**
	 * @param {HTMLElement} root overlay element
	 * @param {object} opts callbacks
	 * @param {(i:object) => void} opts.onIntent text intents
	 * @param {(id:string, info:{byKey:boolean}) => void} opts.onClose editor closed (after the final
	 *   intent, if any); byKey: ended by Esc, Enter or Tab (the scene focuses the canvas)
	 * @param {() => void} [opts.onInput] text changed (scene re-layouts the font size)
	 * @param {(id:string, cell:string, dir:string) => (string|null)} [opts.neighbour] (job 174) the cell beside a
	 *   cell in a direction ('left', 'right', 'up', 'down'), null at the table's edge
	 * @param {() => number} [opts.now] clock
	 * @param {(fn:Function, ms:number) => any} [opts.setTimer] timer
	 * @param {(h:any) => void} [opts.clearTimer] timer
	 */
	constructor(root, opts) {
		this.#root = root
		this.#o = {
			onInput: () => {},
			neighbour: () => null,
			now: () => performance.now(),
			setTimer: (fn, ms) => setTimeout(fn, ms),
			clearTimer: (h) => clearTimeout(h),
			...opts,
		}
	}

	/** @return {string|null} id of the item being edited */
	get id() {
		return this.#id
	}

	/** @return {string} current text in the editor ('' when closed) */
	get value() {
		return this.#ta ? this.#ta.value : ''
	}

	/** @return {string|null} notice shown, if any */
	get notice() {
		return this.#notice
	}

	/** @return {HTMLTextAreaElement|null} the textarea while open */
	get element() {
		return this.#ta
	}

	/** @return {string} kind of the open editor (note, title, shape, text, label, cell) */
	get kind() {
		return this.#kind
	}

	/** @return {string|null} (job 173) the cell of the open cell editor, else null */
	get cell() {
		return this.#cell
	}

	/** @return {boolean} true while finish() runs (final intent emitted, not yet closed) */
	get closing() {
		return this.#closing
	}

	/**
	 * Opens the editor (the caller has closed any other one).
	 *
	 * @param {object} o options
	 * @param {string} o.id item id
	 * @param {string} o.path text path ('data.text' | 'data.title' | 'data.label')
	 * @param {'note'|'title'|'shape'|'text'|'label'} o.kind editor kind (registry `editor`)
	 * @param {string} o.value start text
	 * @param {string} o.before model text at opening (the undo "before")
	 * @param {number} o.maxLength limits.maxText or limits.maxTitle
	 * @param {string|null} [o.notice] open directly in notice mode (text rescue)
	 * @param {string|null} [o.cell] (job 173) the cell of a table (kind cell)
	 * @param {boolean} [o.bold] (job 173) bold text (the header row of a table)
	 * @param {string|null} [o.placeholder] (job 198) the textarea's placeholder (a card of an org chart)
	 */
	open({ id, path, kind, value, before, maxLength, notice = null, cell = null, bold = false, placeholder = null }) {
		this.#id = id
		this.#path = path
		this.#kind = EDITOR_KINDS.includes(kind) ? kind : 'note'
		// job 195: the node of a mind map is the "cell" of a node editor
		// job 199: the lane of a frame is the "cell" of a lane editor
		this.#cell = (this.#kind === 'cell' || this.#kind === 'node' || this.#kind === 'lane') && typeof cell === 'string' ? cell : null
		this.#before = before
		this.#dirty = value !== before
		this.#sent = before
		this.#committed = false
		this.#lastCommit = -Infinity
		this.#closing = false
		this.#layoutSig = ''
		const k = this.#kind
		const ta = document.createElement('textarea')
		ta.className = 'knorke-editor'
		ta.setAttribute('data-knorke-editor', '')
		ta.setAttribute('data-knorke-editor-kind', k)
		if (this.#cell !== null) ta.setAttribute(this.#kind === 'node' ? 'data-knorke-node' : this.#kind === 'lane' ? 'data-knorke-lane' : 'data-knorke-cell', this.#cell)
		ta.setAttribute('spellcheck', 'true')
		ta.setAttribute('rows', '1')
		if (Number.isInteger(maxLength) && maxLength > 0) ta.maxLength = maxLength
		if (typeof placeholder === 'string' && placeholder !== '') ta.placeholder = placeholder
		ta.value = value
		// layout: inline and !important ([S]); Nextcloud styles textareas globally
		setStyles(ta, {
			position: 'absolute', left: '0', top: '0', margin: '0', 'box-sizing': 'border-box', resize: 'none',
			overflow: 'hidden auto', 'min-height': '0', 'min-width': '0', 'max-height': 'none', 'max-width': 'none',
			'font-family': FONT_FAMILY, 'font-weight': bold === true ? 'bold' : 'normal',
			'text-align': k === 'title' || k === 'text' || k === 'cell' || k === 'node' || k === 'lane' ? 'left' : 'center',
			'white-space': k === 'title' || k === 'padTitle' ? 'pre' : 'pre-wrap',
			'overflow-wrap': 'break-word', 'pointer-events': 'auto', 'z-index': '2', cursor: 'text',
			'transform-origin': '50% 50%',
		}, true)
		// look: defaults without priority, styled per kind by [C] (knorke.css, data-knorke-editor-kind)
		setStyles(ta, {
			border: '0', 'border-radius': '0', background: 'transparent', 'box-shadow': 'none',
			outline: '2px solid ' + SELECTION_COLOR, 'outline-offset': '0',
			color: k === 'title' || k === 'lane' ? FRAME_TITLE_COLOR : TEXT_COLOR,
		})
		ta.addEventListener('input', this.#onInput)
		ta.addEventListener('keydown', this.#onKey)
		ta.addEventListener('blur', this.#onBlur)
		// job 174: cells take a grid from the clipboard
		ta.addEventListener('paste', this.#onPaste)
		// wheel is not stopped: Ctrl+wheel must still reach the gesture controller (no page zoom)
		for (const type of ['pointerdown', 'dblclick']) {
			ta.addEventListener(type, stop)
		}
		this.#root.appendChild(ta)
		this.#ta = ta
		this.setNotice(notice)
		try {
			ta.focus({ preventScroll: true })
			ta.setSelectionRange(ta.value.length, ta.value.length)
		} catch {
			// focus can fail in a detached or hidden document
		}
	}

	/**
	 * Positions the editor on the item (container coordinates, live camera).
	 *
	 * @param {{x:number, y:number, w:number, h:number, r:number, padding:number,
	 *          fontSize:number, background:(string|null), align?:string, color?:string, weight?:string, lineHeight?:number}} l layout
	 *   (align: text-align of shape and text editors; color: the item's text color; weight: (job 173) the
	 *   font weight of a cell, bold in the header row; lineHeight: (job 259) a note's NOTE_LINE_HEIGHT, else LINE_HEIGHT;
	 *   paddingX: (job 261) left and right padding of a connector label, else padding;
	 *   outline: (job 265) a table cell's 2 px inner border in this colour, else the default outline)
	 */
	layout(l) {
		if (!this.#ta) return
		const sig = [l.x, l.y, l.w, l.h, l.r, l.padding, l.paddingX, l.fontSize, l.background, l.align, l.color, l.weight, l.lineHeight, l.outline]
			.map((v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)).join('|')
		if (sig === this.#layoutSig) return
		this.#layoutSig = sig
		const layout = {
			width: Math.max(1, l.w) + 'px',
			height: Math.max(1, l.h) + 'px',
			padding: Math.max(0, l.padding) + 'px' + (typeof l.paddingX === 'number' ? ' ' + Math.max(0, l.paddingX) + 'px' : ''),
			'font-size': Math.max(1, l.fontSize) + 'px',
			'line-height': String(this.#kind === 'title' || this.#kind === 'padTitle' ? Math.max(1, l.h - 2 * l.padding) + 'px' : (l.lineHeight ?? LINE_HEIGHT)),
			transform: `translate(${l.x}px, ${l.y}px)` + (l.r ? ` rotate(${l.r}deg)` : ''),
		}
		if (typeof l.align === 'string') layout['text-align'] = l.align
		if (typeof l.weight === 'string') layout['font-weight'] = l.weight
		setStyles(this.#ta, layout, true)
		const look = { background: l.background ?? 'transparent' }
		if (typeof l.color === 'string') look.color = l.color
		if (typeof l.outline === 'string') Object.assign(look, { outline: '2px solid ' + l.outline, 'outline-offset': '-2px' })
		setStyles(this.#ta, look)
		if (this.#noticeEl) {
			setStyles(this.#noticeEl, { transform: `translate(${l.x}px, ${l.y - 6}px) translateY(-100%)`, 'max-width': Math.max(200, l.w) + 'px' })
		}
	}

	/**
	 * Shows a notice (lease lost, text rejected) or removes it (null). Removing
	 * it (take-over) resumes the intermediate commits: text typed or rescued
	 * while the notice was shown has not been committed yet.
	 *
	 * @param {string|null} notice text from the session (already translated)
	 */
	setNotice(notice) {
		if (!this.#ta) return
		const had = this.#notice !== null
		this.#notice = typeof notice === 'string' && notice !== '' ? notice : null
		if (this.#notice === null) {
			this.#ta.removeAttribute('data-knorke-editor-state')
			this.#noticeEl?.remove()
			this.#noticeEl = null
			if (had && this.#ta.value !== this.#sent) {
				this.#dirty = true
				this.#schedule()
			}
			return
		}
		this.#o.clearTimer(this.#timer)
		this.#timer = null
		this.#ta.setAttribute('data-knorke-editor-state', 'locked')
		if (!this.#noticeEl) {
			const n = document.createElement('div')
			n.className = 'knorke-editor-notice'
			n.setAttribute('role', 'status')
			setStyles(n, {
				position: 'absolute', left: '0', top: '0', 'z-index': '5', padding: '4px 8px', 'border-radius': '6px',
				background: '#fff4ce', color: '#3d3000', border: '1px solid #e0c060', 'pointer-events': 'none',
				font: '13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', 'white-space': 'normal',
				'box-shadow': '0 1px 3px rgba(0,0,0,0.2)',
			})
			this.#root.appendChild(n)
			this.#noticeEl = n
			this.#layoutSig = ''
		}
		this.#noticeEl.textContent = this.#notice
	}

	/**
	 * Commits the current text NOW as an intermediate intent (final:false),
	 * the same intent the 1 Hz commit would send, and cancels that pending
	 * commit (SPEC-M0 §6.3 flushEditor, R4/T5). A reload, close or tab switch
	 * fires no blur, so without this the text typed since the last 1 Hz commit
	 * would be lost without a prompt.
	 *
	 * Never closes the editor, never moves the focus, and never touches an
	 * editor with a notice (its text must not be sent; the user copies it).
	 *
	 * @return {boolean} true when an intent was emitted; false when closed,
	 *   under a notice, or the text equals the last value handed out
	 */
	flush() {
		if (!this.#ta || this.#closing || this.#notice !== null) return false
		const value = this.#ta.value
		if (value === this.#sent) return false
		this.#o.clearTimer(this.#timer)
		this.#timer = null
		this.#emit(value, false)
		return true
	}

	/**
	 * Ends the editor: commit (final) unless a notice is shown, then close.
	 * The final intent is emitted while the editor still counts as open for
	 * the item (isActive); a re-entrant finish() from inside it does nothing.
	 *
	 * @param {{next?:('right'|null), byKey?:boolean, move?:(1|-1|'left'|'right'|'up'|'down'|null),
	 *   paste?:(string[][]|null)}} [o] next: series entry (Tab in a note, the final intent always goes out then);
	 *   byKey: ended by a key (focus back to the canvas); move: (job 173) Tab (1) or Shift+Tab (−1) in a cell,
	 *   (job 174) an arrow key at the edge of the text; paste: (job 174) the grid pasted into a cell; both
	 *   reported to onClose
	 */
	finish({ next = null, byKey = false, move = null, paste = null, add = null } = {}) {
		if (!this.#ta || this.#closing) return
		this.#closing = true
		this.#o.clearTimer(this.#timer)
		this.#timer = null
		const id = this.#id
		if (this.#notice === null) {
			const value = this.#ta.value
			if (next !== null || value !== this.#before || this.#committed || this.#dirty) {
				this.#emit(value, true, next)
			}
		}
		const info = { byKey }
		// job 173: the cell of a cell editor, and Tab's move
		if (this.#cell !== null) info.cell = this.#cell
		if (move !== null) info.move = move
		// job 174: the grid of a paste; an editor under a notice appends no row
		if (paste !== null) info.paste = paste
		// job 195: Enter or Tab in a node editor
		if (add !== null) info.add = add
		if (this.#notice !== null) info.notice = true
		this.#close()
		this.#o.onClose(id, info)
	}

	/** Closes without any intent (scene destroyed while a notice is shown, or forced). */
	discard() {
		if (!this.#ta || this.#closing) return
		const id = this.#id
		const info = this.#cell !== null ? { byKey: false, cell: this.#cell } : { byKey: false }
		this.#closing = true
		this.#close()
		this.#o.onClose(id, info)
	}

	// ---------------------------------------------------------------- internals

	#emit(value, final, next = null) {
		this.#lastCommit = this.#o.now()
		this.#committed = true
		this.#dirty = false
		this.#sent = value
		const intent = { type: 'text', id: this.#id, path: this.#path, value, before: this.#before, final }
		if (this.#cell !== null) intent.cell = this.#cell
		if (next !== null) intent.next = next
		this.#o.onIntent(intent)
	}

	/** Intermediate commit of the current text, at most once per COMMIT_INTERVAL_MS. */
	#schedule() {
		if (this.#timer !== null) return
		const wait = Math.max(0, this.#lastCommit + COMMIT_INTERVAL_MS - this.#o.now())
		this.#timer = this.#o.setTimer(() => {
			this.#timer = null
			if (this.#ta && this.#notice === null && this.#dirty) {
				this.#emit(this.#ta.value, false)
			}
		}, wait)
	}

	#close() {
		this.#closing = true
		// a pending intermediate commit belongs to this editor, never to the next one
		this.#o.clearTimer(this.#timer)
		this.#timer = null
		const ta = this.#ta
		ta.removeEventListener('input', this.#onInput)
		ta.removeEventListener('keydown', this.#onKey)
		ta.removeEventListener('blur', this.#onBlur)
		ta.removeEventListener('paste', this.#onPaste)
		ta.remove()
		this.#noticeEl?.remove()
		this.#noticeEl = null
		this.#ta = null
		this.#id = null
		this.#cell = null
		this.#notice = null
		this.#closing = false
	}

	/**
	 * (Job 279) B, I, S and the list button of the context bar, Ctrl/⌘+B/I:
	 * model/richText.js toggleMarks / toggleList on the text and its
	 * selection. Only the changed part is replaced, through
	 * execCommand('insertText') where the browser has it (the textarea's own
	 * undo keeps it), else setRangeText and the input path; then the new
	 * selection. Nothing happens beyond maxLength, under a notice, or in a
	 * kind without Markdown.
	 *
	 * @param {'bold'|'italic'|'strike'|'list'} what the button
	 * @return {boolean} the text changed
	 */
	format(what) {
		const ta = this.#ta
		if (!ta || this.#notice !== null || !RICH_KINDS.includes(this.#kind) || this.#closing) return false
		const v = ta.value
		const a = Number.isInteger(ta.selectionStart) ? ta.selectionStart : v.length
		const b = Number.isInteger(ta.selectionEnd) ? ta.selectionEnd : a
		const r = what === 'list' ? toggleList(v, a, b) : what === 'bold' || what === 'italic' || what === 'strike' ? toggleMarks(v, a, b, what) : null
		if (r === null || r.value === v) return false
		if (Number.isInteger(ta.maxLength) && ta.maxLength > 0 && r.value.length > ta.maxLength) return false
		// the changed part: common start and end of old and new text
		let p = 0
		while (p < v.length && p < r.value.length && v[p] === r.value[p]) p++
		let q = 0
		while (q < v.length - p && q < r.value.length - p && v[v.length - 1 - q] === r.value[r.value.length - 1 - q]) q++
		const ins = r.value.slice(p, r.value.length - q)
		if (typeof ta.focus === 'function' && ta.ownerDocument?.activeElement !== ta) ta.focus()
		ta.setSelectionRange(p, v.length - q)
		let done = false
		try {
			done = typeof document !== 'undefined' && typeof document.execCommand === 'function' && document.execCommand('insertText', false, ins) === true && ta.value === r.value
		} catch {
			done = false
		}
		if (!done) {
			ta.value = r.value
			this.#onInput()
		}
		ta.setSelectionRange(r.start, r.end)
		return true
	}

	#onInput = () => {
		this.#o.onInput()
		if (this.#notice !== null) return
		this.#dirty = true
		this.#schedule()
	}

	#onKey = (e) => {
		// keys typed into the editor never reach the board shortcuts or Nextcloud's
		e.stopPropagation()
		if (e.isComposing) return
		const mod = e.ctrlKey || e.metaKey
		const oneLine = this.#kind === 'title' || this.#kind === 'label' || this.#kind === 'padTitle' || this.#kind === 'lane'
		if (mod && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I') && RICH_KINDS.includes(this.#kind)) {
			// job 279: Ctrl/⌘+B bold, Ctrl/⌘+I italic (never the browser's own)
			e.preventDefault()
			this.format(e.key.toLowerCase() === 'b' ? 'bold' : 'italic')
		} else if (e.key === 'Escape' || (e.key === 'Enter' && (mod || (oneLine && (!e.shiftKey || this.#kind === 'padTitle' || this.#kind === 'lane'))))) {
			e.preventDefault()
			this.finish({ byKey: true })
		} else if (this.#kind === 'node' && (e.key === 'Enter' || e.key === 'Tab') && !mod && !e.altKey) {
			// job 195: Enter a sibling, Tab a child (after the close, the scene asks the session); Shift+Enter breaks
			// the line, Shift+Tab ends like Esc; under a notice neither adds a node
			if (e.key === 'Enter' && e.shiftKey) return
			e.preventDefault()
			const add = e.shiftKey || this.#notice !== null ? null : e.key === 'Tab' ? 'child' : 'sibling'
			this.finish(add === null ? { byKey: true } : { byKey: true, add })
		} else if (e.key === 'Tab' && !mod && !e.altKey) {
			e.preventDefault()
			if (this.#kind === 'cell') {
				// job 173: row by row to the next (Shift: previous) cell
				this.finish({ byKey: true, move: e.shiftKey ? -1 : 1 })
				return
			}
			const series = this.#kind === 'note' && !e.shiftKey && this.#notice === null
			this.finish({ next: series ? 'right' : null, byKey: true })
		} else if (this.#kind === 'cell' && this.#notice === null && Object.prototype.hasOwnProperty.call(CELL_ARROWS, e.key)
			&& !mod && !e.altKey && !e.shiftKey) {
			// job 174: ← → at the very start or end of the text to the cell beside it;
			// job 185: ↑ ↓ from the first or last line of the text as the editor shows it
			const dir = CELL_ARROWS[e.key]
			const ta = this.#ta
			const pos = ta.selectionStart
			if (!Number.isInteger(pos) || ta.selectionEnd !== pos) return
			if (dir === 'left' && pos !== 0) return
			if (dir === 'right' && pos !== ta.value.length) return
			if (this.#o.neighbour(this.#id, this.#cell, dir) === null) return
			if ((dir === 'up' || dir === 'down') && !this.#onEdgeLine(dir === 'up')) return
			e.preventDefault()
			this.finish({ byKey: true, move: dir })
		}
	}

	/**
	 * (Job 185) Whether the caret is in the first (up) or the last (down) line
	 * of the text as the editor shows it: a line ends at a line break and where
	 * the text wraps at the cell's width. Measured with a hidden mirror of the
	 * textarea (#lineTops); without a layout to measure only "\n" counts.
	 *
	 * @param {boolean} up first line (else the last)
	 * @return {boolean}
	 */
	#onEdgeLine(up) {
		const ta = this.#ta
		const v = ta.value
		const pos = Math.min(ta.selectionStart, v.length)
		// the caret, the text's start or end: the same text, only the marker moves
		const tops = this.#lineTops(v, [pos, up ? 0 : v.length])
		if (tops !== null) return Math.abs(tops[0].top - tops[1].top) < tops[0].height / 2
		return up ? !v.slice(0, pos).includes('\n') : !v.slice(pos).includes('\n')
	}

	/**
	 * (Job 185) The line of each position in the text as the textarea lays it
	 * out: a mirror with the textarea's computed text styles and inner width
	 * (hidden, aria-hidden, no pointer events, absolute in the overlay) gets
	 * the text up to the position, then a marker with the rest (and a zero
	 * width space, so the last line always holds something), only through
	 * textContent; the top of the marker's first box is the line's. The
	 * mirror goes away at once; focus, selection and scrolling of the editor
	 * stay as they are.
	 *
	 * @param {string} v text
	 * @param {number[]} at positions in it
	 * @return {Array<{top: number, height: number}>|null} null without a layout (no getComputedStyle, no inner
	 *   width, a marker of height 0)
	 */
	#lineTops(v, at) {
		const ta = this.#ta
		const win = typeof window !== 'undefined' ? window : null
		if (typeof win?.getComputedStyle !== 'function' || !(ta.clientWidth > 0)) return null
		let mirror = null
		try {
			const cs = win.getComputedStyle(ta)
			const st = {
				position: 'absolute', left: '0', top: '0', visibility: 'hidden', 'pointer-events': 'none',
				'box-sizing': 'border-box', border: '0', margin: '0', overflow: 'hidden', height: 'auto',
				width: ta.clientWidth + 'px',
			}
			for (const k of MIRROR_STYLES) st[k] = cs.getPropertyValue(k)
			mirror = document.createElement('div')
			mirror.setAttribute('aria-hidden', 'true')
			setStyles(mirror, st, true)
			this.#root.appendChild(mirror)
			const out = []
			for (const p of at) {
				mirror.textContent = v.slice(0, p)
				const mark = document.createElement('span')
				mark.textContent = v.slice(p) + '\u200B'
				mirror.appendChild(mark)
				const box = mark.getClientRects()[0]
				if (!box || !(box.height > 0)) return null
				out.push({ top: box.top, height: box.height })
			}
			return out
		} catch {
			return null
		} finally {
			mirror?.remove()
		}
	}

	#onBlur = () => {
		if (!this.#closing) this.finish()
	}

	/**
	 * (Job 174) A paste into a cell: a grid from the clipboard goes in at the
	 * caret (one cell) or ends the editor and goes to onClose (more cells);
	 * anything else, and every paste under a notice, is left to the browser.
	 *
	 * @param {ClipboardEvent} e paste event
	 */
	#onPaste = (e) => {
		if (this.#kind !== 'cell' || this.#notice !== null || !this.#ta || this.#closing) return
		let text = ''
		let html = ''
		try {
			text = e.clipboardData?.getData('text/plain') ?? ''
			html = e.clipboardData?.getData('text/html') ?? ''
		} catch {
			return
		}
		const grid = clipGrid(text, html)
		if (grid === null) return
		e.preventDefault()
		if (grid.length === 1 && grid[0].length === 1) {
			this.#insert(grid[0][0])
			return
		}
		this.finish({ byKey: true, paste: grid })
	}

	/**
	 * (Job 174) Text at the caret as if typed: it replaces the selection and
	 * is cut (whole code points) where maxLength ends.
	 *
	 * @param {string} text text to insert
	 */
	#insert(text) {
		const ta = this.#ta
		const v = ta.value
		const s = Number.isInteger(ta.selectionStart) ? Math.min(ta.selectionStart, v.length) : v.length
		const end = Number.isInteger(ta.selectionEnd) ? Math.min(Math.max(s, ta.selectionEnd), v.length) : s
		const room = Number.isInteger(ta.maxLength) && ta.maxLength > 0 ? ta.maxLength - (v.length - (end - s)) : Infinity
		let ins = ''
		for (const ch of text) {
			if (ins.length + ch.length > room) break
			ins += ch
		}
		ta.value = v.slice(0, s) + ins + v.slice(end)
		ta.setSelectionRange(s + ins.length, s + ins.length)
		this.#onInput()
	}
}

/** @param {Event} e event that must not reach the scene container */
function stop(e) {
	e.stopPropagation()
}
