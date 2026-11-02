/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SVG path data of the icons the shell uses, rendered with NcIconSvgWrapper
 * :path (20 px) on a 24 × 24 grid. No icon package as a dependency: these
 * strings never change.
 *
 * Factory job 244 (redesign round 2, variant B5): every icon is Phosphor
 * Regular (model/phosphor.js, verbatim from @phosphor-icons/core 2.1.1, MIT;
 * THIRD-PARTY.md), brought from its 256 grid to 24 when this module loads
 * (svgPath.js scalePath). ICON_SOURCE names the Phosphor icon of each key
 * ('phosphor:<name>'); before, the icons were Material Design Icons (job 226).
 *
 * 'picture' marks the own drawings where Phosphor has nothing fitting: the
 * tool variants note pad and swimlanes, the three routes, the end tips, the
 * dash styles, the laser, the two "Distribute" and the mind-map layout
 * "Mind map" (mmBoth), (job 267) the AI sparkle. They follow Phosphor's style on the 24 grid (design
 * round 2, src2/icons.js OWN): lines 1.5 wide with round ends and corners,
 * a few parts filled; each is one filled path, a line as its outline, a hole
 * wound the other way (nonzero fill rule).
 *
 * `star` stays filled: it is the state "favourite set" next to starOutline,
 * the outer contour of Phosphor's star (its first subpath). The scene draws
 * emoticonPlus under a note as well (scene/nodes/reactions.js).
 */
import { PHOSPHOR, PHOSPHOR_SCALE } from '../model/phosphor.js'
import { scalePath } from '../model/svgPath.js'

export const ICON_SOURCE = Object.freeze({
	plus: 'phosphor:plus',
	tag: 'phosphor:tag',
	comment: 'phosphor:chat',
	// job 267: the AI ("Summarise" and the card, "Cluster by topic")
	sparkle: 'picture',
	// job 279: the list button and "Open link"
	listBullets: 'picture',
	linkOut: 'picture',
	cluster: 'phosphor:squares-four',
	table: 'phosphor:table',
	mindmap: 'phosphor:tree-structure',
	mmTree: 'phosphor:tree-view',
	mmBoth: 'picture',
	laser: 'picture',
	// job 273: the pen tool, the highlighter, the eraser and the three widths
	pen: 'phosphor:pencil-simple',
	marker: 'picture',
	eraser: 'picture',
	widthThin: 'picture',
	widthMedium: 'picture',
	widthThick: 'picture',
	minus: 'phosphor:minus',
	pencil: 'phosphor:pencil-simple',
	trash: 'phosphor:trash',
	share: 'phosphor:share-network',
	back: 'phosphor:arrow-left',
	select: 'phosphor:cursor',
	hand: 'phosphor:hand',
	sticky: 'phosphor:note',
	frame: 'phosphor:frame-corners',
	undo: 'phosphor:arrow-u-up-left',
	redo: 'phosphor:arrow-u-up-right',
	fit: 'phosphor:corners-out',
	front: 'phosphor:selection-foreground',
	back2: 'phosphor:selection-background',
	copy: 'phosphor:copy',
	refresh: 'phosphor:arrow-clockwise',
	link: 'phosphor:link',
	board: 'phosphor:squares-four',
	cut: 'phosphor:scissors',
	duplicate: 'phosphor:copy-simple',
	chevronDown: 'phosphor:caret-down',
	chevronRight: 'phosphor:caret-right',
	check: 'phosphor:check',
	lock: 'phosphor:lock',
	unlock: 'phosphor:lock-open',
	groupItems: 'phosphor:selection-plus',
	ungroup: 'phosphor:selection-slash',
	alignLeft: 'phosphor:text-align-left',
	alignCenter: 'phosphor:text-align-center',
	alignRight: 'phosphor:text-align-right',
	valignTop: 'phosphor:arrow-line-up',
	valignMiddle: 'phosphor:arrows-in-line-vertical',
	valignBottom: 'phosphor:arrow-line-down',
	alignItemsLeft: 'phosphor:align-left',
	alignItemsCenter: 'phosphor:align-center-horizontal',
	alignItemsRight: 'phosphor:align-right',
	alignItemsTop: 'phosphor:align-top',
	alignItemsMiddle: 'phosphor:align-center-vertical',
	alignItemsBottom: 'phosphor:align-bottom',
	distributeHorizontal: 'picture',
	distributeVertical: 'picture',
	tidyUp: 'phosphor:grid-four',
	sortColors: 'phosphor:palette',
	shape: 'phosphor:shapes',
	text: 'phosphor:text-t',
	rect: 'phosphor:rectangle',
	roundRect: 'phosphor:square',
	ellipse: 'phosphor:circle',
	diamond: 'phosphor:diamond',
	triangle: 'phosphor:triangle',
	arrowRight: 'phosphor:arrow-fat-right',
	arrange: 'phosphor:arrows-out-cardinal',
	dashSolid: 'picture',
	dashDashed: 'picture',
	dashDotted: 'picture',
	account: 'phosphor:user',
	connector: 'phosphor:arrow-up-right',
	routeStraight: 'picture',
	routeElbow: 'picture',
	routeCurved: 'picture',
	capNone: 'picture',
	capArrow: 'picture',
	capTriangle: 'picture',
	capDot: 'picture',
	capDiamond: 'picture',
	capCircleOpen: 'picture',
	capTriangleOpen: 'picture',
	label: 'phosphor:textbox',
	connect: 'phosphor:line-segment',
	swapDirection: 'phosphor:arrows-left-right',
	emoticonPlus: 'phosphor:smiley',
	qrcode: 'phosphor:qr-code',
	group: 'phosphor:users-three',
	team: 'phosphor:users',
	present: 'phosphor:presentation',
	eye: 'phosphor:eye',
	eyeOff: 'phosphor:eye-slash',
	close: 'phosphor:x',
	download: 'phosphor:download-simple',
	upload: 'phosphor:upload-simple',
	image: 'phosphor:image',
	timer: 'phosphor:timer',
	vote: 'phosphor:check-square',
	facilitate: 'phosphor:flag',
	zoomSelection: 'phosphor:scan',
	dice: 'phosphor:dice-five',
	star: 'phosphor:star',
	starOutline: 'phosphor:star',
	sort: 'phosphor:funnel-simple',
	notePad: 'picture',
	lanes: 'picture',
	chevronLeft: 'phosphor:caret-left',
	keyboard: 'phosphor:keyboard',
	legal: 'phosphor:scales',
	exportTo: 'phosphor:tray-arrow-down',
	insertFrom: 'phosphor:tray-arrow-up',
	moreTools: 'phosphor:plus-square',
	importShapes: 'phosphor:folder-simple-plus',
	zoom100: 'phosphor:magnifying-glass',
	// job 271: search on the board
	search: 'phosphor:magnifying-glass',
	caretUp: 'phosphor:caret-up',
	caretDown: 'phosphor:caret-down',
	// job 230: the context bar
	dotsHorizontal: 'phosphor:dots-three',
	routes: 'phosphor:path',
	tips: 'phosphor:arrow-right',
	headerRow: 'phosphor:browser',
	branch: 'phosphor:git-branch',
	// job 232: the board list
	viewGrid: 'phosphor:squares-four',
	viewList: 'phosphor:list',
})

/** The own drawings ('picture' in ICON_SOURCE), on the 24 × 24 grid. */
const PICTURES = Object.freeze({
	// job 279: three dots with their lines; a box with an arrow out of its corner
	listBullets: 'M3.75 5.25h2.5v2.5h-2.5ZM9 5.75h11a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1 0-1.5ZM3.75 10.75h2.5v2.5h-2.5ZM9 11.25h11a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1 0-1.5ZM3.75 16.25h2.5v2.5h-2.5ZM9 16.75h11a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1 0-1.5Z',
	linkOut: 'M19 13.5v5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5h5v1.5h-5v12h12v-5ZM14 3.5h6.5V10H19V6.06l-7.47 7.47-1.06-1.06L17.94 5H14Z',
	// job 267: a four-pointed star, filled
	sparkle: 'M12 3C12.6 8.4 15.6 11.4 21 12C15.6 12.6 12.6 15.6 12 21C11.4 15.6 8.4 12.6 3 12C8.4 11.4 11.4 8.4 12 3Z',
	notePad: 'M7 2.25H18A3.75 3.75 0 0 1 21.75 6V17a.75.75 0 0 1-1.5 0V6A2.25 2.25 0 0 0 18 3.75H7a.75.75 0 0 1 0-1.5ZM5 6.25H15A2.75 2.75 0 0 1 17.75 9V19A2.75 2.75 0 0 1 15 21.75H5A2.75 2.75 0 0 1 2.25 19V9A2.75 2.75 0 0 1 5 6.25ZM5 7.75A1.25 1.25 0 0 0 3.75 9V19A1.25 1.25 0 0 0 5 20.25H15A1.25 1.25 0 0 0 16.25 19V9A1.25 1.25 0 0 0 15 7.75H5Z',
	lanes: 'M5 3.25H19A2.75 2.75 0 0 1 21.75 6V18A2.75 2.75 0 0 1 19 20.75H5A2.75 2.75 0 0 1 2.25 18V6A2.75 2.75 0 0 1 5 3.25ZM5 4.75A1.25 1.25 0 0 0 3.75 6V18A1.25 1.25 0 0 0 5 19.25H19A1.25 1.25 0 0 0 20.25 18V6A1.25 1.25 0 0 0 19 4.75H5ZM3 11.25H21a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5ZM8.75 4V20a.75.75 0 0 1-1.5 0V4a.75.75 0 0 1 1.5 0Z',
	routeStraight: 'M4.47 18.47l14-14a.75.75 0 0 1 1.06 1.06l-14 14a.75.75 0 0 1-1.06-1.06ZM5 17.9a1.1 1.1 0 0 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM19 3.9a1.1 1.1 0 0 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z',
	routeElbow: 'M4 5.25h7a.75.75 0 0 1 .75.75V17.25H20a.75.75 0 0 1 0 1.5H11a.75.75 0 0 1-.75-.75V6.75H4a.75.75 0 0 1 0-1.5Z',
	routeCurved: 'M3.26 18.88l.34-2.12.99-1.77 1.47-1.32 1.77-.98 1.94-.76 2-.64 1.96-.64 1.8-.7 1.53-.85 1.16-1.04.75-1.32.29-1.86a.75.75 0 0 1 1.48.24L20.4 7.24l-.99 1.77-1.47 1.32-1.77.98-1.94.76-2 .64-1.96.64-1.8.7-1.53.85L5.78 15.94l-.75 1.32-.29 1.86a.75.75 0 0 1-1.48-.24Z',
	capNone: 'M4 11.25H20a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5Z',
	capArrow: 'M4 11.25H19a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM14.53 6.47l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 0 1-1.06-1.06L17.94 12 13.47 7.53a.75.75 0 0 1 1.06-1.06Z',
	capTriangle: 'M4 11.25h9a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM13.27 7.08l7 4.5a.5.5 0 0 1 0 .84l-7 4.5a.5.5 0 0 1-.77-.42v-9a.5.5 0 0 1 .77-.42Z',
	capDot: 'M4 11.25H14a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM17.5 8.9a3.1 3.1 0 0 1 0 6.2 3.1 3.1 0 0 1 0-6.2Z',
	capDiamond: 'M4 11.25h8a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM16.85 8.15l3.5 3.5a.5.5 0 0 1 0 .7l-3.5 3.5a.5.5 0 0 1-.7 0l-3.5-3.5a.5.5 0 0 1 0-.7l3.5-3.5a.5.5 0 0 1 .7 0Z',
	capCircleOpen: 'M4 11.25h9a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM17 7.75a4.25 4.25 0 0 1 0 8.5 4.25 4.25 0 0 1 0-8.5ZM17 9.25a2.75 2.75 0 0 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z',
	capTriangleOpen: 'M4 11.25h9a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM13.41 6.87l7 4.5a.75.75 0 0 1 0 1.26l-7 4.5a.75.75 0 0 1-1.16-.63v-9a.75.75 0 0 1 1.16-.63ZM13.75 8.87v6.26L18.61 12 13.75 8.87Z',
	dashSolid: 'M4 11.25H20a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5Z',
	dashDashed: 'M4 11.25H7a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5ZM10.5 11.25h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5ZM17 11.25h3a.75.75 0 0 1 0 1.5H17a.75.75 0 0 1 0-1.5Z',
	dashDotted: 'M4 11.25a.75.75 0 0 1 0 1.5.75.75 0 0 1 0-1.5ZM8 11.25a.75.75 0 0 1 0 1.5.75.75 0 0 1 0-1.5ZM12 11.25a.75.75 0 0 1 0 1.5.75.75 0 0 1 0-1.5ZM16 11.25a.75.75 0 0 1 0 1.5.75.75 0 0 1 0-1.5ZM20 11.25a.75.75 0 0 1 0 1.5.75.75 0 0 1 0-1.5Z',
	mmBoth: 'M10 8.75h4A2.25 2.25 0 0 1 16.25 11v2A2.25 2.25 0 0 1 14 15.25H10A2.25 2.25 0 0 1 7.75 13V11A2.25 2.25 0 0 1 10 8.75ZM10 10.25a.75.75 0 0 0-.75.75v2a.75.75 0 0 0 .75.75h4a.75.75 0 0 0 .75-.75V11a.75.75 0 0 0-.75-.75H10ZM8.5 12.75H6a.75.75 0 0 1 0-1.5H8.5a.75.75 0 0 1 0 1.5ZM6.75 6.5v11a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 1.5 0ZM6 7.25H3a.75.75 0 0 1 0-1.5H6a.75.75 0 0 1 0 1.5ZM6 18.25H3a.75.75 0 0 1 0-1.5H6a.75.75 0 0 1 0 1.5ZM15.5 11.25H18a.75.75 0 0 1 0 1.5H15.5a.75.75 0 0 1 0-1.5ZM18.75 6.5v11a.75.75 0 0 1-1.5 0V6.5a.75.75 0 0 1 1.5 0ZM18 5.75h3a.75.75 0 0 1 0 1.5H18a.75.75 0 0 1 0-1.5ZM18 16.75h3a.75.75 0 0 1 0 1.5H18a.75.75 0 0 1 0-1.5Z',
	laser: 'M3.47 19.47l7-7a.75.75 0 0 1 1.06 1.06l-7 7a.75.75 0 0 1-1.06-1.06ZM16.25 3V4.5a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 1.5 0ZM20.5 9.25H19a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 0 1.5ZM19.53 5.53l-1 1a.75.75 0 0 1-1.06-1.06l1-1a.75.75 0 0 1 1.06 1.06ZM15 6.7a2.3 2.3 0 0 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z',
	// job 273: a highlighter, its chisel tip down left; an eraser over its line; three line widths
	marker: 'M15.47 2.47a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-9 9a.75.75 0 0 1-1.06 0l-5-5a.75.75 0 0 1 0-1.06ZM16 4.06 8.06 12 12 15.94 19.94 8ZM5.53 13.47l5 5a.75.75 0 0 1-.21 1.2l-3 1.5a.75.75 0 0 1-.86-.14l-.5-.5-1.43 1.43a.75.75 0 0 1-1.06-1.06l1.43-1.43-.5-.5a.75.75 0 0 1-.14-.86l1.5-3a.75.75 0 0 1 1.2-.21Z',
	eraser: 'M13.47 3.47a.75.75 0 0 1 1.06 0l6 6a.75.75 0 0 1 0 1.06l-8.22 8.22H20a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 0-1.06ZM14 5.06 9.06 10 14 14.94 18.94 10ZM8 11.06 5.06 14l3.25 3.25h2.38l2.25-2.25Z',
	widthThin: 'M4 11.25H20a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5Z',
	widthMedium: 'M5 10.5H19a1.5 1.5 0 0 1 0 3H5a1.5 1.5 0 0 1 0-3Z',
	widthThick: 'M6 9H18a3 3 0 0 1 0 6H6a3 3 0 0 1 0-6Z',
	distributeHorizontal: 'M6.5 5.25h2A2.25 2.25 0 0 1 10.75 7.5v9A2.25 2.25 0 0 1 8.5 18.75h-2A2.25 2.25 0 0 1 4.25 16.5v-9A2.25 2.25 0 0 1 6.5 5.25ZM6.5 6.75a.75.75 0 0 0-.75.75v9a.75.75 0 0 0 .75.75h2a.75.75 0 0 0 .75-.75v-9a.75.75 0 0 0-.75-.75h-2ZM15.5 7.25h2A2.25 2.25 0 0 1 19.75 9.5v5a2.25 2.25 0 0 1-2.25 2.25h-2a2.25 2.25 0 0 1-2.25-2.25v-5A2.25 2.25 0 0 1 15.5 7.25ZM15.5 8.75a.75.75 0 0 0-.75.75v5a.75.75 0 0 0 .75.75h2a.75.75 0 0 0 .75-.75v-5a.75.75 0 0 0-.75-.75h-2ZM3.75 3V21a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 1.5 0ZM21.75 3V21a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 1.5 0Z',
	distributeVertical: 'M7.5 4.25h9A2.25 2.25 0 0 1 18.75 6.5v2a2.25 2.25 0 0 1-2.25 2.25h-9A2.25 2.25 0 0 1 5.25 8.5v-2A2.25 2.25 0 0 1 7.5 4.25ZM7.5 5.75a.75.75 0 0 0-.75.75v2a.75.75 0 0 0 .75.75h9a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 0-.75-.75h-9ZM9.5 13.25h5a2.25 2.25 0 0 1 2.25 2.25v2a2.25 2.25 0 0 1-2.25 2.25h-5A2.25 2.25 0 0 1 7.25 17.5v-2A2.25 2.25 0 0 1 9.5 13.25ZM9.5 14.75a.75.75 0 0 0-.75.75v2a.75.75 0 0 0 .75.75h5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 0-.75-.75h-5ZM3 2.25H21a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5ZM3 20.25H21a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5Z',
})

/**
 * @param {string} key a key of ICON_SOURCE
 * @return {string} its path data on the 24 × 24 grid
 */
function iconOf(key) {
	const src = ICON_SOURCE[key]
	if (src === 'picture') return PICTURES[key]
	const d = PHOSPHOR[src.slice('phosphor:'.length)]
	return scalePath(key === 'star' ? d.slice(0, d.indexOf('Z') + 1) : d, PHOSPHOR_SCALE)
}

export const icons = Object.freeze(Object.fromEntries(Object.keys(ICON_SOURCE).map((k) => [k, iconOf(k)])))

/**
 * Icon of each value of a creation tool's options (ToolVariants.vue, and the
 * context bar for the same values): Phosphor for the shape kinds, note and frame,
 * pictures for the routes, the end tips, the note pad and swimlanes.
 */
export const OPTION_ICONS = Object.freeze({
	kind: Object.freeze({
		rect: icons.rect,
		roundRect: icons.roundRect,
		ellipse: icons.ellipse,
		diamond: icons.diamond,
		triangle: icons.triangle,
		arrowRight: icons.arrowRight,
	}),
	route: Object.freeze({ straight: icons.routeStraight, elbow: icons.routeElbow, curved: icons.routeCurved }),
	endCap: Object.freeze({
		none: icons.capNone,
		arrow: icons.capArrow,
		triangle: icons.capTriangle,
		dot: icons.capDot,
		diamond: icons.capDiamond,
		circleOpen: icons.capCircleOpen,
		triangleOpen: icons.capTriangleOpen,
	}),
	type: Object.freeze({ sticky: icons.sticky, pad: icons.notePad }),
	frameKind: Object.freeze({ frame: icons.frame, lanes: icons.lanes }),
	// job 273: what the pen tool does, and its three widths (thin, medium, thick)
	penKind: Object.freeze({ pen: icons.pen, marker: icons.marker, eraser: icons.eraser }),
	width: Object.freeze([icons.widthThin, icons.widthMedium, icons.widthThick]),
})
