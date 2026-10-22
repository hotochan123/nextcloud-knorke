/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The action table of the convergence workload (dev/sim/converge.mjs,
 * SPEC-M1 §8.6), pure so dev/sim/env.test.mjs can pin it without a stack.
 *
 * M1_MIX = [weight, action, connector?]. Round 1a's actions keep their share
 * of the old thresholds (weights summing to 92, i.e. 0.92 of the actions when
 * there were no connector ops); the connector actions of round 1b (weights
 * summing to 23) count only when connectors are on, so a run with them
 * spends 23/115 ≈ 20 % of its actions on connectors – "full strength" of
 * §8.6: create, retarget (also onto items removed in the same batch or by a
 * concurrent one), deleting bound items, keep together with connectors.
 * keepConnector has weight 4 (Phase 1 of round 1b: with 2, a 30-s run had
 * 2–10 batches per keep order, too close to 0 for the K0 check over the six
 * database waves of Phase 2).
 */

export const M1_MIX = Object.freeze([
	[12, 'createSticky'], [7, 'createShape'], [4, 'createText'], [3, 'createFrame'],
	[14, 'move'], [8, 'transform'], [5, 'frameResize'], [11, 'text'], [8, 'style'],
	[5, 'del'], [3, 'delReviveSame'], [2, 'delReviveNext'], [3, 'zMove'], [3, 'unknownField'], [2, 'noop'], [2, 'badOp'],
	[7, 'createConnector', true], [5, 'retarget', true], [2, 'connectorStyle', true],
	[3, 'delBound', true], [2, 'bindRemoved', true], [4, 'keepConnector', true],
].map((row) => Object.freeze(row)))

/** The connector actions of M1_MIX (round 1b). */
export const CONNECTOR_ACTIONS = Object.freeze(M1_MIX.filter(([, , c]) => c).map(([, name]) => name))

/**
 * The action of M1_MIX for a uniform x ∈ [0, 1); without `connectors` the
 * connector rows are left out and the others share the whole range.
 * @param {number} x
 * @param {boolean} connectors
 * @return {string}
 */
export function mixAction(x, connectors) {
	const rows = M1_MIX.filter(([, , conn]) => connectors || !conn)
	const total = rows.reduce((a, [w]) => a + w, 0)
	let acc = 0
	for (const [w, name] of rows) {
		acc += w
		if (x * total < acc) return name
	}
	return rows[rows.length - 1][1]
}

/** The "hot" items of a list of [id, item]: the five smallest ids (the same set pickItem uses). */
export function hotOf(pool, n = 5) {
	return pool.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, n)
}
