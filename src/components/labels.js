/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Translated names of the enum values the shell offers (shape kinds,
 * dashes, alignments, connector routes and tips; SPEC-M1 §6.11). Every
 * text is written out as t('knorke', …) so build/l10n-check.mjs finds it.
 * An unknown value (a later version) shows as itself.
 *
 * Aligning items (itemAlignLabel, M2) has source texts of its own, apart
 * from the text alignment (alignLabel, valignLabel), so each meaning gets
 * its own translation. Distributing items (distributeLabel, M2) as well.
 */
import { t } from '../util/l10n.js'

/**
 * @param {string} kind shape kind
 * @return {string} label
 */
export function shapeKindLabel(kind) {
	switch (kind) {
	case 'rect': return t('knorke', 'Rectangle')
	case 'roundRect': return t('knorke', 'Rounded rectangle')
	case 'ellipse': return t('knorke', 'Ellipse')
	case 'diamond': return t('knorke', 'Diamond')
	case 'triangle': return t('knorke', 'Triangle')
	case 'arrowRight': return t('knorke', 'Arrow')
	default: return String(kind)
	}
}

/**
 * @param {string} dash solid|dashed|dotted
 * @return {string} label
 */
export function dashLabel(dash) {
	switch (dash) {
	case 'solid': return t('knorke', 'Solid')
	case 'dashed': return t('knorke', 'Dashed')
	case 'dotted': return t('knorke', 'Dotted')
	default: return String(dash)
	}
}

/**
 * @param {string} align left|center|right
 * @return {string} label
 */
export function alignLabel(align) {
	switch (align) {
	case 'left': return t('knorke', 'Align left')
	case 'center': return t('knorke', 'Align center')
	case 'right': return t('knorke', 'Align right')
	default: return String(align)
	}
}

/**
 * @param {string} valign top|middle|bottom
 * @return {string} label
 */
export function valignLabel(valign) {
	switch (valign) {
	case 'top': return t('knorke', 'Align top')
	case 'middle': return t('knorke', 'Align middle')
	case 'bottom': return t('knorke', 'Align bottom')
	default: return String(valign)
	}
}

/**
 * @param {string} edge left|center|right|top|middle|bottom (actions.ALIGN_EDGES)
 * @return {string} label of that edge's command in the "Align items" panel
 */
export function itemAlignLabel(edge) {
	switch (edge) {
	case 'left': return t('knorke', 'Align left edges')
	case 'center': return t('knorke', 'Align horizontal centers')
	case 'right': return t('knorke', 'Align right edges')
	case 'top': return t('knorke', 'Align top edges')
	case 'middle': return t('knorke', 'Align vertical centers')
	case 'bottom': return t('knorke', 'Align bottom edges')
	default: return String(edge)
	}
}

/**
 * @param {string} axis horizontal|vertical (actions.DISTRIBUTE_AXES)
 * @return {string} label of the "Distribute" button for that axis
 */
export function distributeLabel(axis) {
	switch (axis) {
	case 'horizontal': return t('knorke', 'Distribute horizontally')
	case 'vertical': return t('knorke', 'Distribute vertically')
	default: return String(axis)
	}
}

/**
 * @param {string} tool tool id
 * @return {string} label
 */
export function toolLabel(tool) {
	switch (tool) {
	case 'select': return t('knorke', 'Select')
	case 'hand': return t('knorke', 'Pan')
	case 'sticky': return t('knorke', 'Sticky note')
	case 'shape': return t('knorke', 'Shape')
	case 'text': return t('knorke', 'Text')
	case 'connector': return t('knorke', 'Connector')
	case 'frame': return t('knorke', 'Frame')
	default: return String(tool)
	}
}

/**
 * @param {string} route straight|elbow|curved (connector data.route)
 * @return {string} label
 */
export function routeLabel(route) {
	switch (route) {
	case 'straight': return t('knorke', 'Straight')
	case 'elbow': return t('knorke', 'Elbow')
	case 'curved': return t('knorke', 'Curved')
	default: return String(route)
	}
}

/**
 * @param {string} cap none|arrow|triangle|dot|diamond (style.startCap, style.endCap)
 * @return {string} label
 */
export function capLabel(cap) {
	switch (cap) {
	case 'none': return t('knorke', 'No tip')
	case 'arrow': return t('knorke', 'Arrow tip')
	case 'triangle': return t('knorke', 'Triangle tip')
	case 'dot': return t('knorke', 'Dot tip')
	case 'diamond': return t('knorke', 'Diamond tip')
	default: return String(cap)
	}
}
