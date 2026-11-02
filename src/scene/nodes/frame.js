/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frame node (port of the spike builder). The fill comes from the frame's own
 * style.fill, not from a constant (spike shortcoming §8.5), read through
 * fieldValue like the title (SPEC-M1 §6.2 R8). The title sits in
 * the band above the box (FRAME_TITLE_BAND, also the frame's hit area) and
 * stays at every level of detail; it is cut with an ellipsis at the frame
 * width so the render bounds match the index box. The border is drawn in
 * screen pixels (strokeScaleEnabled false) so frames stay visible when zoomed out.
 * (Job 227) The fill is drawn through tokens.shownColor, the title semibold
 * (FRAME_TITLE_WEIGHT) and dark.
 *
 * (Job 243, design round 2 A2) The title stands in a tab on the top left
 * edge: FRAME_TITLE_BAND high, frameTabWidth wide (the title in one line of
 * the title font, ctx.measureTitle), filled with frameTabFill of the fill,
 * the title FRAME_TAB_PAD from its left edge in frameTabText, cut with an
 * ellipsis. One outline (traceFrame) runs round tab and frame like an index
 * card, its corners rounded by FRAME_RADIUS; a frame without a title (or
 * one of blanks) is a rounded rectangle with nothing above it. While the
 * title editor is open (textHidden true) the tab is as wide as it can be,
 * without its text. The lanes' heads are clipped to the outline.
 *
 * Children are NOT Konva children of the frame: every item is a root node at
 * its absolute position, the static layer is one ordered list.
 *
 * (Job 199) A frame with lanes (model/lanes.js) also draws, over its body,
 * the head column at the left (headWidth, LANE_HEAD_FILL over style.fill),
 * a line right of it and a line between each two lanes over the full width,
 * like the border, and each lane's name in the head (LANE_TITLE_SIZE, bold,
 * FRAME_TITLE_COLOR, LANE_PAD, left, vertically centred, word wrap with an
 * ellipsis), at LOD 0 and 1. Its height is item.h (the local preview of a
 * dragged lane border grows it); textHidden may name the lane whose editor
 * is open. Any change of a frame with lanes (or of whether it has them)
 * rebuilds the node.
 *
 * (Job 208) No head column for a single lane without a name (laneHeadW 0).
 * With columns: the head row on top (colTop high, LANE_HEAD_FILL, right of
 * the head column, whose fill reaches the top), a line below it over the
 * full width, a line between each two columns over the full height, and each
 * column's name in its head (as a lane's, centred); textHidden may name the
 * column whose editor is open.
 *
 * (Job 225) Groups: each run of a lane group is a cell left of its lanes'
 * names (laneGroupW wide, a line right of it over the run) with the group's
 * name turned by -90° (reading upwards), one line centred with an ellipsis;
 * a lane in a group has its name right of the cell, one without a group
 * over the full head width, and the line between two lanes of one run
 * starts at the cell. A column group's run is a cell above its columns'
 * names (colGroupH high, a line below it over the run), its name level and
 * centred; the line between two columns of one run starts below the cell.
 * textHidden may name the group whose editor is open.
 *
 * (Job 234) A lane's name stands turned by -90° like its group's (reading
 * upwards, centred in its cell, one line), the head column being as narrow
 * as the group cell (model/lanes.js LANE_HEAD_W). The names of lanes and of
 * groups are drawn in one line at nameFontSize (smaller down to
 * LANE_NAME_MIN_SIZE before Konva cuts them with an ellipsis); column names
 * stay level and wrap as before.
 *
 * (Job 264, design round 4 S4) The heads are filled with laneTones(fill).head
 * (the tab tone over the fill, the empty top left corner too), the group
 * cells with .group; the only lines are the dividers between lanes and
 * between columns (1 screen px in .line, columns at LANE_COL_LINE_OPACITY),
 * none along the heads. Names in frameTabText of their fill; column names
 * left, column group names COL_GROUP_SIZE and left.
 */
import {
	COL_GROUP_SIZE, LANE_PAD, LANE_TITLE_SIZE, colBands, colGroupH, colRuns, colTop, hasLanes, laneBands, laneGroupW, laneHeadW, laneRuns,
	nameFontSize, nameLine,
} from '../../model/lanes.js'
import { fieldValue } from '../../model/registry.js'
import {
	FONT_FAMILY, FRAME_RADIUS, FRAME_STROKE_WIDTH, FRAME_TAB_PAD, FRAME_TITLE_BAND, FRAME_TITLE_COLOR, FRAME_TITLE_SIZE,
	FRAME_SELECTED_TAB_MIX, FRAME_TITLE_WEIGHT, LANE_COL_LINE_OPACITY, SELECTION_GAP_PX, frameStroke, frameTabFill, frameTabText, frameTabWidth, mixColor,
	laneTones, shownColor,
} from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

/**
 * (Job 243) Width of a title in one line of the title font: the renderer's
 * measurement (ctx.measureTitle), else an estimate of 0.55 em per code point.
 *
 * @param {object} ctx builder context
 * @param {string} text the title
 * @return {number} world units
 */
function titleWidth(ctx, text) {
	const w = typeof ctx.measureTitle === 'function' ? ctx.measureTitle(text) : NaN
	return Number.isFinite(w) ? w : Array.from(text).length * FRAME_TITLE_SIZE * 0.55
}

/**
 * (Job 243) The corner radius of a frame w × h: FRAME_RADIUS, at most half
 * of either side.
 *
 * @param {number} w width
 * @param {number} h height
 * @return {number} ≥ 0
 */
export function radiusOf(w, h) {
	return Math.max(0, Math.min(FRAME_RADIUS, w / 2, h / 2))
}

/**
 * (Job 243) Traces the tab's top from its bottom left corner (0, 0), the
 * current point: up its left edge, round its two upper corners and down its
 * right edge to (tabW, 0).
 *
 * @param {object} c 2D context (Konva.Context)
 * @param {number} tabW the tab's width (> 0)
 * @param {number} r the frame's corner radius
 */
export function traceTabTop(c, tabW, r) {
	const t = FRAME_TITLE_BAND
	const rt = Math.max(0, Math.min(r, tabW / 2, t / 2))
	c.lineTo(0, -t + rt)
	c.arc(rt, -t + rt, rt, Math.PI, Math.PI * 1.5)
	c.lineTo(tabW - rt, -t)
	c.arc(tabW - rt, -t + rt, rt, Math.PI * 1.5, Math.PI * 2)
	c.lineTo(tabW, 0)
}

/**
 * (Job 243) Traces the outline of a frame w × h as one closed path: with a
 * tab (tabW > 0) up the left edge to the tab's top, round the tab and along
 * the top edge (the top left corner gives way to the tab), else a rounded
 * rectangle; every corner radiusOf.
 *
 * @param {object} c 2D context (Konva.Context)
 * @param {number} w width
 * @param {number} h height
 * @param {number} tabW the tab's width, 0 without a tab
 * @param {number} [r] the corner radius (job 262: the selection outline passes its own), default radiusOf
 */
export function traceFrame(c, w, h, tabW, r = radiusOf(w, h)) {
	c.beginPath()
	if (tabW > 0) {
		c.moveTo(0, h - r)
		traceTabTop(c, tabW, r)
	} else {
		c.moveTo(0, r)
		c.arc(r, r, r, Math.PI, Math.PI * 1.5)
	}
	// the top right corner, smaller where the tab leaves less room
	const rr = tabW > 0 ? Math.max(0, Math.min(r, w - tabW)) : r
	c.lineTo(w - rr, 0)
	c.arc(w - rr, rr, rr, Math.PI * 1.5, Math.PI * 2)
	c.lineTo(w, h - r)
	c.arc(w - r, h - r, r, 0, Math.PI / 2)
	c.lineTo(r, h)
	c.arc(r, h - r, r, Math.PI / 2, Math.PI)
	c.closePath()
}

/**
 * (Job 262, design round 4 R4) The selection outline of a frame w × h with
 * a tab tabW wide, in the frame's local units from the top left corner of
 * its gap frame (SELECTION_GAP_PX screen px outside): the frame's outline
 * grown by the gap on every side, the tab gap wider on both sides and gap
 * higher, every corner radiusOf + gap (12 screen px at 100 %).
 *
 * @param {{w: number, h: number}} box the frame's box
 * @param {number} tabW the width of its tab now drawn, 0 without a tab
 * @param {number} scale camera scale
 * @return {{w: number, h: number, tabW: number, r: number}} the args of traceFrame
 */
export function frameOutline(box, tabW, scale) {
	const g = SELECTION_GAP_PX / (Number.isFinite(scale) && scale > 0 ? scale : 1)
	const w = Math.max(0, box.w)
	const h = Math.max(0, box.h)
	return { w: w + 2 * g, h: h + 2 * g, tabW: tabW > 0 ? tabW + 2 * g : 0, r: radiusOf(w, h) + g }
}

/**
 * (Job 243) The tab of a frame: its width and tone, the title's colour and
 * the width its text may take.
 *
 * @param {{title: string, titleW: number, fill: unknown, w: number, editing: boolean}} s the frame's
 *   state (titleW: the title in one line of the title font)
 * @return {{tabW: number, tabFill: string, textFill: string, textW: number}} tabW 0: no tab
 */
export function tabOf(s) {
	const tabFill = frameTabFill(s.fill)
	const titled = s.title.trim() !== ''
	// the open title editor takes the widest tab (a text as wide as the frame fills it)
	const tabW = s.editing ? frameTabWidth(s.w, s.w) : titled ? frameTabWidth(s.titleW, s.w) : 0
	return { tabW, tabFill, textFill: frameTabText(tabFill), textW: tabW - 2 * FRAME_TAB_PAD }
}

/**
 * (Job 243) Lays the tab of an entry out from its state (entry.tab): its
 * width and tone for the sceneFunc, the title's width, colour and
 * visibility (none while the editor is open, without a tab or room).
 *
 * @param {object} entry node entry
 */
function applyTab(entry) {
	const st = entry.tab
	const t = tabOf(st)
	st.tabW = t.tabW
	st.tabFill = t.tabFill
	entry.parts.text.setAttrs({ width: positive(t.textW), fill: t.textFill, visible: !st.editing && t.tabW > 0 && t.textW > 0 })
}

/**
 * (Job 243) The sceneFunc of a frame's body: the outline filled with the
 * frame's fill, the tab in its tone, then the outline's stroke (screen px).
 *
 * @param {object} c Konva context
 * @param {object} shape the body
 * @param {{w: number, h: number, tabW: number, tabFill: string}} st the frame's state
 */
export function drawFrame(c, shape, st) {
	traceFrame(c, st.w, st.h, st.tabW)
	c.fillShape(shape)
	if (st.tabW > 0) {
		c.beginPath()
		c.moveTo(0, 0)
		traceTabTop(c, st.tabW, radiusOf(st.w, st.h))
		c.closePath()
		// (job 262) the tab of a frame the own user selected, tinted with the selection colour
		c.setAttr('fillStyle', st.tint ? mixColor(st.tint, st.tabFill, FRAME_SELECTED_TAB_MIX) : st.tabFill)
		c.fill()
	}
	traceFrame(c, st.w, st.h, st.tabW)
	c.strokeShape(shape)
}

/**
 * @param {object} ctx builder context
 * @param {object} item frame with lanes
 * @param {number} w width
 * @param {number} H height
 * @param {boolean|string} textHidden the key of the lane (job 208: or column) whose editor is open
 * @param {{tabW: number}} st the frame's tab (job 243: the group is clipped to the outline)
 * @return {{group: object, titles: Map<string, object>}} the lanes' nodes
 */
function buildLanes(ctx, item, w, H, textHidden, st) {
	const group = new ctx.Group({ listening: false, clipFunc: (c) => traceFrame(c, w, H, st.tabW) })
	const bands = laneBands(item, H)
	const hw = laneHeadW(item, w)
	// (job 208) the columns and their head row
	const cols = colBands(item, w)
	const top = colTop(item, H)
	// (job 225) the group cells
	const gw = laneGroupW(item, w)
	const runs = hw > 0 ? laneRuns(item, H) : []
	const cg = colGroupH(item, H)
	const cruns = cols.length > 0 ? colRuns(item, w) : []
	const sameRun = (a, b) => a.g !== null && a.g === b.g
	// (job 264, S4) heads in the tab tone over the fill (the empty corner too), group cells stronger
	const tone = laneTones(fieldValue(item, 'style.fill'))
	const rect = (x, y, width, height, fill) => group.add(new ctx.Rect({ ...SHAPE_BASE, x, y, width, height, fill }))
	if (hw > 0) rect(0, 0, hw, H, tone.head)
	if (cols.length > 0) rect(hw, 0, Math.max(0, w - hw), top, tone.head)
	for (const r of runs) rect(0, r.y, gw, r.h, tone.group)
	for (const r of cruns) rect(r.x, 0, r.w, cg, tone.group)
	// (job 264) dividers only between lanes and between columns, 1 screen px; none along the heads
	const divider = (opacity, trace) => group.add(new ctx.Shape({
		...SHAPE_BASE,
		stroke: tone.line,
		strokeWidth: 1,
		strokeScaleEnabled: false,
		opacity,
		sceneFunc: (c, shape) => {
			c.beginPath()
			trace(c)
			c.strokeShape(shape)
		},
	}))
	divider(1, (c) => {
		for (let i = 1; i < bands.length; i++) {
			c.moveTo(hw > 0 && sameRun(bands[i - 1], bands[i]) ? gw : 0, bands[i].y)
			c.lineTo(w, bands[i].y)
		}
	})
	if (cols.length > 1) {
		divider(LANE_COL_LINE_OPACITY, (c) => {
			for (let i = 1; i < cols.length; i++) {
				c.moveTo(cols[i].x, sameRun(cols[i - 1], cols[i]) ? cg : 0)
				c.lineTo(cols[i].x, H)
			}
		})
	}
	const titles = new Map()
	const name = (key, attrs, fill) => {
		const t = new ctx.Text({
			...SHAPE_BASE,
			padding: LANE_PAD,
			fontStyle: 'bold',
			fontFamily: FONT_FAMILY,
			fill: frameTabText(fill),
			verticalAlign: 'middle',
			ellipsis: true,
			visible: textHidden !== key,
			...attrs,
		})
		group.add(t)
		return t
	}
	for (const b of hw > 0 ? bands : []) {
		// (job 225) right of its group's cell; (job 234) turned by -90° like a group's name
		const x = b.g !== null ? gw : 0
		titles.set(b.key, name(b.key, {
			x,
			y: b.y + b.h,
			width: positive(b.h),
			height: positive(hw - x),
			rotation: -90,
			text: nameLine(b.title),
			fontSize: nameFontSize(b.title, b.h),
			align: 'center',
			wrap: 'none',
		}, tone.head))
	}
	for (const b of cols) {
		// (job 225) below its group's cell; (job 264) level, left, wrapping
		const y = b.g !== null ? cg : 0
		titles.set(b.key, name(b.key, {
			x: b.x,
			y,
			width: positive(b.w),
			height: positive(top - y),
			text: b.title,
			fontSize: LANE_TITLE_SIZE,
			align: 'left',
			wrap: 'word',
		}, tone.head))
	}
	// (job 225) the names of the groups: a lane group's turned by -90° over its cell, a column group's level
	for (const [r, lane] of [...runs.map((r) => [r, true]), ...cruns.map((r) => [r, false])]) {
		// a group split in two runs by a race: both hide while its editor is open
		titles.set(r.key + ':' + (lane ? r.from : r.x), name(r.key, {
			x: lane ? 0 : r.x,
			y: lane ? r.y + r.h : 0,
			width: positive(lane ? r.h : r.w),
			height: positive(lane ? gw : cg),
			rotation: lane ? -90 : 0,
			text: nameLine(r.title),
			// (job 234) smaller before it is cut; (job 264) a column group's 14, left
			fontSize: lane ? nameFontSize(r.title, r.h) : COL_GROUP_SIZE,
			align: lane ? 'center' : 'left',
			wrap: 'none',
		}, tone.group))
	}
	return { group, titles }
}

export const frame = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @param {boolean|string} [textHidden] title is being edited; (job 199) the key of the lane being named
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod, textHidden = false) {
		const root = makeGroup(ctx)
		const lanes = hasLanes(item)
		const H = lanes && Number.isFinite(item.h) ? item.h : abs.h
		const fill = fieldValue(item, 'style.fill')
		const name = str(fieldValue(item, 'data.title'))
		// (job 243) what the outline, the tab and the title are drawn from (the sceneFunc reads it on every draw)
		const st = { w: abs.w, h: H, fill, title: name, titleW: titleWidth(ctx, name), editing: textHidden === true, tabW: 0, tabFill: null, tint: null }
		const body = new ctx.Shape({
			...SHAPE_BASE,
			width: abs.w,
			height: H,
			fill: shownColor(fill),
			stroke: frameStroke(fill),
			strokeWidth: FRAME_STROKE_WIDTH,
			strokeScaleEnabled: false,
			shadowForStrokeEnabled: false,
			sceneFunc: (c, shape) => drawFrame(c, shape, st),
		})
		body.transformsEnabled('position')
		const title = new ctx.Text({
			...SHAPE_BASE,
			x: FRAME_TAB_PAD,
			y: -FRAME_TITLE_BAND,
			width: 1,
			height: FRAME_TITLE_BAND,
			text: name,
			fontSize: FRAME_TITLE_SIZE,
			fontFamily: FONT_FAMILY,
			fontStyle: FRAME_TITLE_WEIGHT,
			fill: FRAME_TITLE_COLOR,
			verticalAlign: 'middle',
			wrap: 'none',
			ellipsis: true,
		})
		title.transformsEnabled('position')
		root.add(body)
		const parts = { body, text: title }
		if (lanes) {
			const l = buildLanes(ctx, item, abs.w, H, textHidden, st)
			root.add(l.group)
			parts.lanes = l.group
			parts.laneTitles = l.titles
		}
		root.add(title)
		const entry = { root, parts, lod, transforms: null, textHidden, lanes, tab: st }
		applyTab(entry)
		place(entry, abs)
		return entry
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem (new state)
	 * @param {object} abs absolute box
	 * @param {Set<string>} fields changed fields
	 * @return {boolean} true = rebuild
	 */
	update(ctx, entry, item, abs, fields) {
		if (fields.has('type')) {
			return true
		}
		// (job 199) a frame with lanes, or one that gains or loses them, is built anew
		if ((entry.lanes || hasLanes(item)) && (fields.has('geom') || fields.has('data') || fields.has('text') || fields.has('style'))) {
			return true
		}
		const { body, text } = entry.parts
		const st = entry.tab
		if (fields.has('geom')) {
			body.setAttrs({ width: abs.w, height: abs.h })
			st.w = abs.w
			st.h = abs.h
		}
		if (fields.has('style')) {
			st.fill = fieldValue(item, 'style.fill')
			body.fill(shownColor(st.fill))
			body.stroke(frameStroke(st.fill))
		}
		if (fields.has('text')) {
			st.title = str(fieldValue(item, 'data.title'))
			st.titleW = titleWidth(ctx, st.title)
			text.text(st.title)
		}
		applyTab(entry)
		return false
	},

	/**
	 * The title stays at every level of detail.
	 *
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod new level of detail
	 */
	setLod(ctx, entry, item, abs, lod) {
		entry.lod = lod
	},

	/**
	 * (job 262, design round 4 R4) Tints the tab of a frame the own user
	 * selected with FRAME_SELECTED_TAB_MIX of the selection colour; null: untinted.
	 * The title keeps the colour of the untinted tone.
	 *
	 * @param {object} entry node entry
	 * @param {string|null} color #rrggbb, or null
	 * @return {boolean} true when it changed
	 */
	setTint(entry, color) {
		const next = typeof color === 'string' ? color : null
		if (entry.tab.tint === next) return false
		entry.tab.tint = next
		return true
	},

	/**
	 * @param {object} entry node entry
	 * @param {boolean|string} hidden true while the title editor is open (job 243: the widest tab, no title);
	 *   (job 199) the key of the lane (job 208: or column) being named
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = hidden
		entry.tab.editing = hidden === true
		applyTab(entry)
		// (job 199) the name of the lane (job 208: or column) whose editor is open
		// (job 225) a group's names carry their run after the key
		for (const [key, t] of entry.parts.laneTitles ?? []) t.visible(hidden !== key.split(':')[0])
	},
}
