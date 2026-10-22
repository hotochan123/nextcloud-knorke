/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Undo/redo of own actions only (SPEC-M0 §1.1, §6.5): at most 50 steps, not
 * across a reload. Unconditional (LWW): undo sends the inverse ops as new ops.
 * A text session (several intermediate states plus the final one) merges into
 * ONE step through a shared mergeKey; the first step's inverse survives.
 */

export class UndoStack {
	/**
	 * @param {number} [limit] most steps kept
	 */
	constructor(limit = 50) {
		this.limit = limit
		this.done = []
		this.undone = []
	}

	/**
	 * Records a step. Same mergeKey as the top step → merged into it.
	 *
	 * @param {{ops: object[], inverse: object[], mergeKey?: string|null}} step action
	 */
	push({ ops, inverse, mergeKey = null }) {
		if (!Array.isArray(ops) || ops.length === 0) {
			return
		}
		const top = this.done[this.done.length - 1]
		if (mergeKey !== null && top && top.mergeKey === mergeKey) {
			top.ops = [...top.ops, ...structuredClone(ops)]
			top.inverse = [...structuredClone(inverse ?? []), ...top.inverse]
		} else {
			this.done.push({ ops: structuredClone(ops), inverse: structuredClone(inverse ?? []), mergeKey })
			if (this.done.length > this.limit) {
				this.done.splice(0, this.done.length - this.limit)
			}
		}
		this.undone = []
	}

	/** @return {object[]|null} inverse ops of the last step (fresh copies) or null */
	undo() {
		const step = this.done.pop()
		if (!step) {
			return null
		}
		this.undone.push(step)
		return structuredClone(step.inverse)
	}

	/** @return {object[]|null} ops of the last undone step (fresh copies) or null */
	redo() {
		const step = this.undone.pop()
		if (!step) {
			return null
		}
		this.done.push(step)
		return structuredClone(step.ops)
	}

	/** @return {boolean} */
	canUndo() {
		return this.done.length > 0
	}

	/** @return {boolean} */
	canRedo() {
		return this.undone.length > 0
	}

	/** Forget everything (resync of a different board state is not a reason). */
	clear() {
		this.done = []
		this.undone = []
	}
}
