/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The one tool table for the scene and the toolbar (SPEC-M1 §6.2, finding F4
 * of §12.4: in M0 the tool list lived in four places).
 *
 * - id:      tool name (also what setTool(tool, options) takes, §6.3)
 * - key:     single-key shortcut (only with canvas focus, §6.10)
 * - create:  how the tool creates an item: 'click' (sticky, text; dragging a
 *            text sets its wrap width), 'drag' (shape: a click gives the
 *            default size; frame), 'connect' (connector: from item to item
 *            or point); absent for select and hand
 * - options: the tool options the toolbar offers (data.kind of a shape;
 *            data.route and style.endCap of a connector)
 *
 * Order = toolbar order. Frozen: never mutate.
 */
import { deepFreeze } from './freeze.js'

export const TOOLS = deepFreeze([
	{ id: 'select', key: 'v' },
	{ id: 'hand', key: 'h' },
	{ id: 'sticky', key: 'n', create: 'click' },
	{ id: 'shape', key: 's', create: 'drag', options: ['kind'] },
	{ id: 'text', key: 't', create: 'click' },
	{ id: 'connector', key: 'l', create: 'connect', options: ['route', 'endCap'] },
	{ id: 'frame', key: 'f', create: 'drag' },
])

export const TOOL_IDS = Object.freeze(TOOLS.map((t) => t.id))
