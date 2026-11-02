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
 *            or point), (job 273) 'stroke' (pen: a freehand stroke,
 *            model/ink.js); absent for select, hand and laser
 * - options: the tool options the toolbar offers (data.kind of a shape;
 *            data.route and style.endCap of a connector)
 *
 * Order = toolbar order. Frozen: never mutate.
 *
 * Factory job 171: laser (K) creates nothing; a press draws a short glowing
 * trail that everyone on the board sees and that fades (scene/LaserLayer.js).
 *
 * Factory job 173: table (B) creates like the note tool: a click puts a 3 × 3
 * table centred on the point and opens the editor of its top-left cell.
 *
 * Factory job 195: mindmap (M) creates like the note tool: a click puts a
 * new mind map (its root) centred on the point and opens the root's editor.
 *
 * Factory job 188: the note tool (N) has the option type, NOTE_TOOL_TYPES:
 * 'sticky' ("Note", the default) or 'pad' ("Note pad": the next click puts
 * a note pad, then the option is 'sticky' again, as after every change of
 * the tool). The values are registry types, not a field of an item, so
 * they live here and not in the registry.
 *
 * Factory job 199: the frame tool (F) has the option frameKind,
 * FRAME_TOOL_KINDS: 'frame' ("Frame", the default) or 'lanes' ("Swimlanes":
 * the next frame is divided into lanes, model/lanes.js), put back to 'frame'
 * like the note tool's type.
 *
 * Factory job 273: the pen tool (P) draws freehand strokes (type pen); its
 * option penKind, model/ink.js PEN_TOOL_KINDS: 'pen' (the default),
 * 'marker' ("Highlighter") or 'eraser' (removes whole strokes). It stays
 * after a stroke, and so does its kind; colour and width per kind are the
 * options penColor/penWidth and markerColor/markerWidth.
 */
import { deepFreeze } from './freeze.js'

export const TOOLS = deepFreeze([
	{ id: 'select', key: 'v' },
	{ id: 'hand', key: 'h' },
	{ id: 'sticky', key: 'n', create: 'click', options: ['type'] },
	{ id: 'shape', key: 's', create: 'drag', options: ['kind'] },
	{ id: 'text', key: 't', create: 'click' },
	{ id: 'table', key: 'b', create: 'click' },
	{ id: 'mindmap', key: 'm', create: 'click' },
	{ id: 'connector', key: 'l', create: 'connect', options: ['route', 'endCap'] },
	{ id: 'frame', key: 'f', create: 'drag', options: ['frameKind'] },
	{ id: 'laser', key: 'k' },
	{ id: 'pen', key: 'p', create: 'stroke', options: ['penKind'] },
])

export const TOOL_IDS = Object.freeze(TOOLS.map((t) => t.id))

/** (job 188) What the note tool creates (its option type): a note, the default, or a note pad. */
export const NOTE_TOOL_TYPES = Object.freeze(['sticky', 'pad'])

/** (job 199) What the frame tool creates (its option frameKind): a plain frame, the default, or a frame with lanes. */
export const FRAME_TOOL_KINDS = Object.freeze(['frame', 'lanes'])
