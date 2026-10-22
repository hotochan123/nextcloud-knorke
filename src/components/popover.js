/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A small disclosure popover for the shell (participants "+{n}", frame list;
 * SPEC-M1 §6.6): a button with aria-expanded/aria-controls opens a panel
 * below it; Esc, a pointerdown outside and choosing an entry close it, and
 * Esc gives the focus back to the button. No NcPopover: the panel is a plain
 * element inside the bar, so the bounding-box checks of §6.6 (5) see it
 * where it is drawn.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

let seq = 0

/**
 * @return {{open: import('vue').Ref<boolean>, root: import('vue').Ref<HTMLElement|null>,
 *   button: import('vue').Ref<HTMLElement|null>, id: string, toggle: () => void, close: (refocus?: boolean) => void}}
 */
export function usePopover() {
	const open = ref(false)
	const root = ref(null)
	const button = ref(null)
	const id = 'knorke-popover-' + (++seq)
	const onDown = (e) => {
		if (root.value && e?.target && !root.value.contains(e.target)) {
			open.value = false
		}
	}
	const onKey = (e) => {
		if (e?.key === 'Escape') {
			e.stopPropagation?.()
			close(true)
		}
	}
	const listen = (on) => {
		if (typeof document === 'undefined') {
			return
		}
		if (on) {
			document.addEventListener('pointerdown', onDown, true)
			document.addEventListener('keydown', onKey, true)
		} else {
			document.removeEventListener('pointerdown', onDown, true)
			document.removeEventListener('keydown', onKey, true)
		}
	}
	watch(open, (v) => listen(v))
	onBeforeUnmount(() => listen(false))
	/** @param {boolean} [refocus] put the focus back on the button */
	function close(refocus = false) {
		open.value = false
		if (refocus) {
			// a component (NcButton) or an element
			const el = button.value?.$el ?? button.value
			el?.focus?.()
		}
	}
	function toggle() {
		open.value = !open.value
	}
	return { open, root, button, id, toggle, close }
}
