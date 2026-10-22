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
 * limits.maxLabel characters); the textarea carries
 * data-knorke-editor-kind=<kind>. [S] sets position, size, font size, line
 * height and alignment inline (!important, like M0, against Nextcloud's
 * global textarea styles); background, border, shadow, outline and color are
 * set inline WITHOUT priority as defaults, so [C] can style each kind in
 * knorke.css (with !important) over the attribute.
 *
 * Keys: Esc, Ctrl/⌘+Enter (and Enter in a title or a connector label;
 * Shift+Enter breaks the line there) end with a commit and give the focus
 * back to the canvas. (R2) Series entry: Tab in a NOTE editor ends
 * like a final commit with next:'right' (the session creates the next note
 * to the right and opens its editor); Shift+Tab, and Tab in the other kinds,
 * commit and return the focus to the canvas (as M0, where Tab blurred).
 *
 * Test hook: textarea[data-knorke-editor][data-knorke-editor-kind]. Text
 * only via value/textContent.
 */
import { setStyles } from './CursorLayer.js'
import { FONT_FAMILY, FRAME_TITLE_COLOR, LINE_HEIGHT, SELECTION_COLOR, TEXT_COLOR } from '../model/tokens.js'

/** Intermediate commits at most this often. */
export const COMMIT_INTERVAL_MS = 1000

/** Editor kinds (registry `editor`), the values of data-knorke-editor-kind. */
export const EDITOR_KINDS = Object.freeze(['note', 'title', 'shape', 'text', 'label'])

export class TextEditor {
	#root
	#o
	#ta = null
	#noticeEl = null
	#id = null
	#path = null
	#kind = 'note'
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
	 * @param {() => number} [opts.now] clock
	 * @param {(fn:Function, ms:number) => any} [opts.setTimer] timer
	 * @param {(h:any) => void} [opts.clearTimer] timer
	 */
	constructor(root, opts) {
		this.#root = root
		this.#o = {
			onInput: () => {},
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

	/** @return {string} kind of the open editor (note, title, shape, text, label) */
	get kind() {
		return this.#kind
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
	 */
	open({ id, path, kind, value, before, maxLength, notice = null }) {
		this.#id = id
		this.#path = path
		this.#kind = EDITOR_KINDS.includes(kind) ? kind : 'note'
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
		ta.setAttribute('spellcheck', 'true')
		ta.setAttribute('rows', '1')
		if (Number.isInteger(maxLength) && maxLength > 0) ta.maxLength = maxLength
		ta.value = value
		// layout: inline and !important ([S]); Nextcloud styles textareas globally
		setStyles(ta, {
			position: 'absolute', left: '0', top: '0', margin: '0', 'box-sizing': 'border-box', resize: 'none',
			overflow: 'hidden auto', 'min-height': '0', 'min-width': '0', 'max-height': 'none', 'max-width': 'none',
			'font-family': FONT_FAMILY, 'font-weight': 'normal',
			'text-align': k === 'title' || k === 'text' ? 'left' : 'center', 'white-space': k === 'title' ? 'pre' : 'pre-wrap',
			'overflow-wrap': 'break-word', 'pointer-events': 'auto', 'z-index': '2', cursor: 'text',
			'transform-origin': '50% 50%',
		}, true)
		// look: defaults without priority, styled per kind by [C] (knorke.css, data-knorke-editor-kind)
		setStyles(ta, {
			border: '0', 'border-radius': '0', background: 'transparent', 'box-shadow': 'none',
			outline: '2px solid ' + SELECTION_COLOR, 'outline-offset': '0',
			color: k === 'title' ? FRAME_TITLE_COLOR : TEXT_COLOR,
		})
		ta.addEventListener('input', this.#onInput)
		ta.addEventListener('keydown', this.#onKey)
		ta.addEventListener('blur', this.#onBlur)
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
	 *          fontSize:number, background:(string|null), align?:string, color?:string}} l layout
	 *   (align: text-align of shape and text editors; color: the item's text color)
	 */
	layout(l) {
		if (!this.#ta) return
		const sig = [l.x, l.y, l.w, l.h, l.r, l.padding, l.fontSize, l.background, l.align, l.color]
			.map((v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)).join('|')
		if (sig === this.#layoutSig) return
		this.#layoutSig = sig
		const layout = {
			width: Math.max(1, l.w) + 'px',
			height: Math.max(1, l.h) + 'px',
			padding: Math.max(0, l.padding) + 'px',
			'font-size': Math.max(1, l.fontSize) + 'px',
			'line-height': String(this.#kind === 'title' ? Math.max(1, l.h - 2 * l.padding) + 'px' : LINE_HEIGHT),
			transform: `translate(${l.x}px, ${l.y}px)` + (l.r ? ` rotate(${l.r}deg)` : ''),
		}
		if (typeof l.align === 'string') layout['text-align'] = l.align
		setStyles(this.#ta, layout, true)
		const look = { background: l.background ?? 'transparent' }
		if (typeof l.color === 'string') look.color = l.color
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
	 * @param {{next?:('right'|null), byKey?:boolean}} [o] next: series entry (Tab in a note,
	 *   the final intent always goes out then); byKey: ended by a key (focus back to the canvas)
	 */
	finish({ next = null, byKey = false } = {}) {
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
		this.#close()
		this.#o.onClose(id, { byKey })
	}

	/** Closes without any intent (scene destroyed while a notice is shown, or forced). */
	discard() {
		if (!this.#ta || this.#closing) return
		const id = this.#id
		this.#closing = true
		this.#close()
		this.#o.onClose(id, { byKey: false })
	}

	// ---------------------------------------------------------------- internals

	#emit(value, final, next = null) {
		this.#lastCommit = this.#o.now()
		this.#committed = true
		this.#dirty = false
		this.#sent = value
		const intent = { type: 'text', id: this.#id, path: this.#path, value, before: this.#before, final }
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
		ta.remove()
		this.#noticeEl?.remove()
		this.#noticeEl = null
		this.#ta = null
		this.#id = null
		this.#notice = null
		this.#closing = false
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
		const oneLine = this.#kind === 'title' || this.#kind === 'label'
		if (e.key === 'Escape' || (e.key === 'Enter' && (mod || (oneLine && !e.shiftKey)))) {
			e.preventDefault()
			this.finish({ byKey: true })
		} else if (e.key === 'Tab' && !mod && !e.altKey) {
			e.preventDefault()
			const series = this.#kind === 'note' && !e.shiftKey && this.#notice === null
			this.finish({ next: series ? 'right' : null, byKey: true })
		}
	}

	#onBlur = () => {
		if (!this.#closing) this.finish()
	}
}

/** @param {Event} e event that must not reach the scene container */
function stop(e) {
	e.stopPropagation()
}
