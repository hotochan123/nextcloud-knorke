/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The half-boundary table of q (SPEC-M1 §4.7, §8.2 (1), §18), the same
 * inputs and results as qTable() in tests/php/unit/ConnectorsTest.php, so
 * PHP and JS are held to one list. Not a test file itself (the glob only runs
 * *.test.mjs); geometry.test.mjs and connectors.test.mjs import it.
 *
 * [v, k, q(v, k)]; every 0 result is +0 (R7).
 */
export const Q_TABLE = Object.freeze([
	[51.945, 100, 51.95], // the double of 51.945·100 is 5194.5
	[-0.005, 100, -0.01], // half away from zero
	[0, 100, 0],
	[-0, 100, 0],
	[-0.001, 100, 0], // the raw formula gives -0 (R7)
	[-0.0049, 100, 0],
	[-1e-300, 100, 0],
	[1.005, 100, 1], // 1.005·100 = 100.49999999999999; PHP round gives 1.01
	[2.675, 100, 2.68],
	[-2.675, 100, -2.68],
	[9999999.995, 100, 9999999.99], // its double lies below the half
	[-10000000, 100, -10000000],
	[0.12345, 10000, 0.1235],
	[0.123456, 10000, 0.1235],
	[0.654321, 10000, 0.6543],
	[0.00015, 10000, 0.0001], // 0.00015·10000 = 1.4999999999999998
	[0.00025, 10000, 0.0003],
	[0.99995, 10000, 1],
	[0.00004, 10000, 0],
	[-0.00004, 10000, 0],
	[1234.56, 10, 1234.6],
	[-0.05, 10, -0.1],
].map((row) => Object.freeze(row)))
