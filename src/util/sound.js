/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The timer's end sound (SPEC-M1 §6.6 util/sound.js, stage 3): a short
 * WebAudio tone from an oscillator, no audio asset. Browsers start an
 * AudioContext only after a user gesture, so unlock() runs on the first
 * pointerdown/keydown of the board (the context is created and resumed
 * there); a timer that ends before any gesture stays silent. Muting is a
 * per-viewer convenience in localStorage `knorke.mute` ('1' = muted); the
 * storage helpers never throw (private windows).
 */
import { getItem, keys, removeItem, setItem } from './storage.js'

/** Tone of the end signal: three short beeps. */
export const BEEP = Object.freeze({ freq: 880, beepMs: 160, gapMs: 120, count: 3, gain: 0.18 })

/**
 * @param {object} [o] injection points (tests)
 * @param {object} [o.win] window (AudioContext / webkitAudioContext)
 * @param {object} [o.storage] storage helpers {getItem, setItem, removeItem}
 * @return {object} sound {unlock, play, muted, setMuted}
 */
export function createSound({ win = globalThis.window, storage = { getItem, setItem, removeItem } } = {}) {
	let ctx = null
	const Ctx = () => win?.AudioContext ?? win?.webkitAudioContext ?? null
	return {
		/** @return {boolean} sound is off for this viewer */
		muted() {
			return storage.getItem('local', keys.mute()) === '1'
		},
		/** @param {boolean} on true = mute */
		setMuted(on) {
			if (on) {
				storage.setItem('local', keys.mute(), '1')
			} else {
				storage.removeItem('local', keys.mute())
			}
		},
		/**
		 * Inside a user gesture: creates and resumes the AudioContext.
		 *
		 * @return {boolean} a context exists
		 */
		unlock() {
			try {
				const C = Ctx()
				if (!C) {
					return false
				}
				if (!ctx) {
					ctx = new C()
				}
				if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
					ctx.resume().catch(() => {})
				}
				return true
			} catch (e) {
				return false
			}
		},
		/**
		 * The end signal (nothing when muted, locked or without WebAudio).
		 *
		 * @return {boolean} played
		 */
		play() {
			if (this.muted() || !ctx || ctx.state !== 'running') {
				return false
			}
			try {
				const t0 = ctx.currentTime + 0.02
				for (let i = 0; i < BEEP.count; i++) {
					const start = t0 + i * (BEEP.beepMs + BEEP.gapMs) / 1000
					const end = start + BEEP.beepMs / 1000
					const osc = ctx.createOscillator()
					const gain = ctx.createGain()
					osc.type = 'sine'
					osc.frequency.value = BEEP.freq
					gain.gain.setValueAtTime(0, start)
					gain.gain.linearRampToValueAtTime(BEEP.gain, start + 0.01)
					gain.gain.setValueAtTime(BEEP.gain, end - 0.02)
					gain.gain.linearRampToValueAtTime(0, end)
					osc.connect(gain)
					gain.connect(ctx.destination)
					osc.start(start)
					osc.stop(end + 0.01)
				}
				return true
			} catch (e) {
				return false
			}
		},
		/** Closes the context (board left). */
		close() {
			try {
				ctx?.close?.()
			} catch (e) {
				// already closed
			}
			ctx = null
		},
	}
}
