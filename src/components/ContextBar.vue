<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="bar"
		class="knorke-contextbar"
		role="toolbar"
		:aria-label="t('knorke', 'Selection')"
		@keydown.esc="onEsc">
		<div v-if="sections.fill && !fillInPanel"
			class="knorke-contextbar__colors"
			role="group"
			:aria-label="t('knorke', 'Fill')">
			<button v-for="c in sections.fill"
				:key="c"
				type="button"
				class="knorke-swatch"
				:class="{ 'knorke-swatch--active': current('fill', c) }"
				:style="{ backgroundColor: c }"
				:aria-label="t('knorke', 'Color {color}', { color: c })"
				:aria-pressed="current('fill', c) ? 'true' : 'false'"
				:data-knorke-fill="c"
				data-knorke-style="style.fill"
				:data-knorke-value="c"
				@click="(e) => setStyle('style.fill', c, e)" />
		</div>
		<NcButton v-if="fillInPanel"
			variant="tertiary"
			:pressed="panel === 'fill'"
			:aria-label="t('knorke', 'Fill')"
			:title="t('knorke', 'Fill')"
			:aria-expanded="panel === 'fill' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-section="fill"
			@click="toggle('fill')">
			<template #icon>
				<NcIconSvgWrapper :path="icons.fill" />
			</template>
		</NcButton>
		<NcButton v-if="sections.stroke"
			variant="tertiary"
			:pressed="panel === 'border'"
			:aria-label="borderLabel"
			:title="borderLabel"
			:aria-expanded="panel === 'border' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-section="border"
			@click="toggle('border')">
			<template #icon>
				<NcIconSvgWrapper :path="sections.line ? icons.lineWidth : icons.border" />
			</template>
		</NcButton>
		<NcButton v-if="hasText"
			variant="tertiary"
			:pressed="panel === 'text'"
			:aria-label="t('knorke', 'Text')"
			:title="t('knorke', 'Text')"
			:aria-expanded="panel === 'text' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-section="text"
			@click="toggle('text')">
			<template #icon>
				<NcIconSvgWrapper :path="icons.textColor" />
			</template>
		</NcButton>
		<NcButton v-if="sections.kind"
			variant="tertiary"
			:pressed="panel === 'kind'"
			:aria-label="t('knorke', 'Shape')"
			:title="t('knorke', 'Shape')"
			:aria-expanded="panel === 'kind' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-section="kind"
			@click="toggle('kind')">
			<template #icon>
				<NcIconSvgWrapper :path="kindIcon(selection.kind)" />
			</template>
		</NcButton>
		<NcButton v-if="sections.route"
			variant="tertiary"
			:pressed="panel === 'route'"
			:aria-label="t('knorke', 'Route')"
			:title="t('knorke', 'Route')"
			:aria-expanded="panel === 'route' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-section="route"
			@click="toggle('route')">
			<template #icon>
				<NcIconSvgWrapper :path="routeIcon(selection.route)" />
			</template>
		</NcButton>
		<NcButton v-if="sections.startCap || sections.endCap"
			variant="tertiary"
			:pressed="panel === 'caps'"
			:aria-label="t('knorke', 'Tips')"
			:title="t('knorke', 'Tips')"
			:aria-expanded="panel === 'caps' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-section="caps"
			@click="toggle('caps')">
			<template #icon>
				<NcIconSvgWrapper :path="capIcon(selection.endCap || 'arrow')" />
			</template>
		</NcButton>
		<NcButton v-if="sections.label"
			variant="tertiary"
			:aria-label="t('knorke', 'Edit label')"
			:title="t('knorke', 'Edit label') + ' (Enter)'"
			data-knorke-action="label"
			@click="(e) => $emit('label', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.label" />
			</template>
		</NcButton>
		<div v-if="sections.styled || sections.fill" class="knorke-contextbar__sep" role="separator" />
		<NcButton v-if="selection.canConnect"
			variant="tertiary"
			:aria-label="t('knorke', 'Connect')"
			:title="t('knorke', 'Connect')"
			data-knorke-action="connect"
			@click="(e) => $emit('connect', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.connect" />
			</template>
		</NcButton>
		<NcButton v-if="sections.arrange"
			variant="tertiary"
			:pressed="panel === 'arrange'"
			:aria-label="t('knorke', 'Arrange')"
			:title="t('knorke', 'Arrange')"
			:aria-expanded="panel === 'arrange' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-action="arrange"
			@click="toggle('arrange')">
			<template #icon>
				<NcIconSvgWrapper :path="icons.arrange" />
			</template>
		</NcButton>
		<NcButton v-if="sections.itemAlign"
			variant="tertiary"
			:pressed="panel === 'align'"
			:aria-label="t('knorke', 'Align items')"
			:title="t('knorke', 'Align items')"
			:aria-expanded="panel === 'align' ? 'true' : 'false'"
			:aria-controls="panelId"
			data-knorke-action="align"
			@click="toggle('align')">
			<template #icon>
				<NcIconSvgWrapper :path="icons.alignItemsLeft" />
			</template>
		</NcButton>
		<div v-if="panel"
			:id="panelId"
			class="knorke-contextbar__panel"
			role="group"
			:aria-label="panelLabel"
			:data-knorke-panel="panel">
			<template v-if="panel === 'fill'">
				<div class="knorke-contextbar__colors knorke-contextbar__colors--grid" role="group" :aria-label="t('knorke', 'Fill')">
					<button v-for="c in sections.fill"
						:key="c"
						type="button"
						class="knorke-swatch"
						:class="{ 'knorke-swatch--active': current('fill', c) }"
						:style="{ backgroundColor: c }"
						:aria-label="t('knorke', 'Color {color}', { color: c })"
						:aria-pressed="current('fill', c) ? 'true' : 'false'"
						data-knorke-style="style.fill"
						:data-knorke-value="c"
						@click="(e) => setStyle('style.fill', c, e)" />
				</div>
				<div v-if="sections.fillOpacity" class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Opacity')">
					<span class="knorke-contextbar__label">{{ t('knorke', 'Opacity') }}</span>
					<button v-for="o in OPACITIES"
						:key="o"
						type="button"
						class="knorke-chip"
						:class="{ 'knorke-chip--active': current('fillOpacity', o) }"
						:aria-pressed="current('fillOpacity', o) ? 'true' : 'false'"
						data-knorke-style="style.fillOpacity"
						:data-knorke-value="o"
						@click="(e) => setStyle('style.fillOpacity', o, e)">
						{{ o }} %
					</button>
				</div>
			</template>
			<template v-else-if="panel === 'border'">
				<div class="knorke-contextbar__colors knorke-contextbar__colors--grid" role="group" :aria-label="borderLabel">
					<button v-for="c in sections.stroke"
						:key="c"
						type="button"
						class="knorke-swatch"
						:class="{ 'knorke-swatch--active': current('stroke', c) }"
						:style="{ backgroundColor: c }"
						:aria-label="t('knorke', 'Color {color}', { color: c })"
						:aria-pressed="current('stroke', c) ? 'true' : 'false'"
						data-knorke-style="style.stroke"
						:data-knorke-value="c"
						@click="(e) => setStyle('style.stroke', c, e)" />
				</div>
				<div v-if="sections.strokeWidth" class="knorke-contextbar__row" role="group" :aria-label="widthLabel">
					<span class="knorke-contextbar__label">{{ widthLabel }}</span>
					<button v-for="wd in sections.strokeWidths"
						:key="wd"
						type="button"
						class="knorke-chip"
						:class="{ 'knorke-chip--active': current('strokeWidth', wd) }"
						:aria-pressed="current('strokeWidth', wd) ? 'true' : 'false'"
						data-knorke-style="style.strokeWidth"
						:data-knorke-value="wd"
						@click="(e) => setStyle('style.strokeWidth', wd, e)">
						{{ wd }}
					</button>
				</div>
				<div v-if="sections.dash" class="knorke-contextbar__row" role="group" :aria-label="borderLabel">
					<NcButton v-for="d in sections.dash"
						:key="d"
						variant="tertiary"
						:pressed="current('dash', d)"
						:aria-label="dashLabel(d)"
						:title="dashLabel(d)"
						data-knorke-style="style.dash"
						:data-knorke-value="d"
						@click="(e) => setStyle('style.dash', d, e)">
						<template #icon>
							<NcIconSvgWrapper :path="DASH_ICONS[d] || icons.dashSolid" />
						</template>
					</NcButton>
				</div>
			</template>
			<template v-else-if="panel === 'text'">
				<div v-if="sections.textColor"
					class="knorke-contextbar__colors knorke-contextbar__colors--grid"
					role="group"
					:aria-label="t('knorke', 'Text')">
					<button v-for="c in sections.textColor.palette"
						:key="c"
						type="button"
						class="knorke-swatch"
						:class="{ 'knorke-swatch--active': current(textColorKey, c) }"
						:style="{ backgroundColor: c }"
						:aria-label="t('knorke', 'Color {color}', { color: c })"
						:aria-pressed="current(textColorKey, c) ? 'true' : 'false'"
						:data-knorke-style="sections.textColor.path"
						:data-knorke-value="c"
						@click="(e) => setStyle(sections.textColor.path, c, e)" />
				</div>
				<div v-if="sections.fontSize" class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Font size')">
					<span class="knorke-contextbar__label">{{ t('knorke', 'Font size') }}</span>
					<button v-if="sections.fontSize.auto"
						type="button"
						class="knorke-chip"
						:class="{ 'knorke-chip--active': current('fontSize', null) }"
						:aria-pressed="current('fontSize', null) ? 'true' : 'false'"
						data-knorke-style="style.fontSize"
						data-knorke-value="auto"
						@click="(e) => setStyle('style.fontSize', null, e)">
						{{ t('knorke', 'Auto') }}
					</button>
					<button v-for="size in sections.fontSize.sizes"
						:key="size"
						type="button"
						class="knorke-chip"
						:class="{ 'knorke-chip--active': current('fontSize', size) }"
						:aria-pressed="current('fontSize', size) ? 'true' : 'false'"
						data-knorke-style="style.fontSize"
						:data-knorke-value="size"
						@click="(e) => setStyle('style.fontSize', size, e)">
						{{ size }}
					</button>
				</div>
				<div v-if="sections.align || sections.valign" class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Text')">
					<NcButton v-for="a in sections.align || []"
						:key="'a-' + a"
						variant="tertiary"
						:pressed="current('align', a)"
						:aria-label="alignLabel(a)"
						:title="alignLabel(a)"
						data-knorke-style="style.align"
						:data-knorke-value="a"
						@click="(e) => setStyle('style.align', a, e)">
						<template #icon>
							<NcIconSvgWrapper :path="ALIGN_ICONS[a] || icons.alignLeft" />
						</template>
					</NcButton>
					<NcButton v-for="v in sections.valign || []"
						:key="'v-' + v"
						variant="tertiary"
						:pressed="current('valign', v)"
						:aria-label="valignLabel(v)"
						:title="valignLabel(v)"
						data-knorke-style="style.valign"
						:data-knorke-value="v"
						@click="(e) => setStyle('style.valign', v, e)">
						<template #icon>
							<NcIconSvgWrapper :path="VALIGN_ICONS[v] || icons.valignMiddle" />
						</template>
					</NcButton>
				</div>
			</template>
			<div v-else-if="panel === 'kind'" class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Shape')">
				<NcButton v-for="k in sections.kind"
					:key="k"
					variant="tertiary"
					:pressed="current('kind', k)"
					:aria-label="shapeKindLabel(k)"
					:title="shapeKindLabel(k)"
					data-knorke-style="data.kind"
					:data-knorke-value="k"
					@click="(e) => setKind(k, e)">
					<template #icon>
						<NcIconSvgWrapper :path="kindIcon(k)" />
					</template>
				</NcButton>
			</div>
			<div v-else-if="panel === 'route'" class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Route')">
				<NcButton v-for="r in sections.route"
					:key="r"
					variant="tertiary"
					:pressed="current('route', r)"
					:aria-label="routeLabel(r)"
					:title="routeLabel(r)"
					data-knorke-style="data.route"
					:data-knorke-value="r"
					@click="(e) => setStyle('data.route', r, e)">
					<template #icon>
						<NcIconSvgWrapper :path="routeIcon(r)" />
					</template>
				</NcButton>
			</div>
			<template v-else-if="panel === 'caps'">
				<div v-for="end in capRows"
					:key="end.key"
					class="knorke-contextbar__row"
					role="group"
					:aria-label="end.label">
					<span class="knorke-contextbar__label">{{ end.label }}</span>
					<NcButton v-for="c in sections[end.key]"
						:key="end.key + '-' + c"
						variant="tertiary"
						:class="{ 'knorke-cap--start': end.key === 'startCap' }"
						:pressed="current(end.key, c)"
						:aria-label="capLabel(c)"
						:title="capLabel(c)"
						:data-knorke-style="end.path"
						:data-knorke-value="c"
						@click="(e) => setStyle(end.path, c, e)">
						<template #icon>
							<NcIconSvgWrapper :path="capIcon(c)" />
						</template>
					</NcButton>
				</div>
			</template>
			<ArrangePopover v-else-if="panel === 'arrange'"
				:box="selection.box"
				:rotatable="!!selection.rotatable"
				:types="selection.types"
				@apply="(b) => $emit('arrange', b)" />
			<template v-else-if="panel === 'align'">
				<div v-for="(row, i) in ITEM_ALIGN_ROWS"
					:key="'align-' + i"
					class="knorke-contextbar__row">
					<NcButton v-for="edge in row"
						:key="edge"
						variant="tertiary"
						:aria-label="itemAlignLabel(edge)"
						:title="itemAlignLabel(edge)"
						:data-knorke-align="edge"
						@click="(e) => $emit('align', edge, e)">
						<template #icon>
							<NcIconSvgWrapper :path="ITEM_ALIGN_ICONS[edge]" />
						</template>
					</NcButton>
				</div>
				<div v-if="sections.distribute" class="knorke-contextbar__row">
					<NcButton v-for="axis in DISTRIBUTE_AXES"
						:key="axis"
						variant="tertiary"
						:aria-label="distributeLabel(axis)"
						:title="distributeLabel(axis)"
						:data-knorke-distribute="axis"
						@click="(e) => $emit('distribute', axis, e)">
						<template #icon>
							<NcIconSvgWrapper :path="DISTRIBUTE_ICONS[axis]" />
						</template>
					</NcButton>
				</div>
				<div class="knorke-contextbar__row">
					<NcButton variant="tertiary"
						:aria-label="t('knorke', 'Tidy up')"
						:title="t('knorke', 'Tidy up')"
						data-knorke-action="tidy"
						@click="(e) => $emit('tidy', e)">
						<template #icon>
							<NcIconSvgWrapper :path="icons.tidyUp" />
						</template>
					</NcButton>
				</div>
			</template>
		</div>
		<NcButton variant="tertiary"
			:aria-label="t('knorke', 'Copy')"
			:title="t('knorke', 'Copy') + ' (Ctrl+C)'"
			data-knorke-action="copy"
			@click="(e) => $emit('copy', e)">
			<template #icon>
				<NcIconSvgWrapper :path="icons.copy" />
			</template>
		</NcButton>
		<template v-if="editable">
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Cut')"
				:title="t('knorke', 'Cut') + ' (Ctrl+X)'"
				data-knorke-action="cut"
				@click="(e) => $emit('cut', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.cut" />
				</template>
			</NcButton>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Duplicate')"
				:title="t('knorke', 'Duplicate') + ' (Ctrl+D)'"
				data-knorke-action="duplicate"
				@click="(e) => $emit('duplicate', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.duplicate" />
				</template>
			</NcButton>
			<div class="knorke-contextbar__sep" role="separator" />
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Bring to front')"
				:title="t('knorke', 'Bring to front')"
				@click="(e) => $emit('reorder', 'front', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.front" />
				</template>
			</NcButton>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Send to back')"
				:title="t('knorke', 'Send to back')"
				@click="(e) => $emit('reorder', 'back', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.back2" />
				</template>
			</NcButton>
			<NcButton variant="tertiary"
				:aria-label="t('knorke', 'Delete')"
				:title="t('knorke', 'Delete') + ' (Del)'"
				@click="(e) => $emit('delete', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.trash" />
				</template>
			</NcButton>
		</template>
		<template v-if="groupRow">
			<div class="knorke-contextbar__sep" role="separator" />
			<NcButton v-if="showGroup(selection)"
				variant="tertiary"
				class="knorke-contextbar__groupbtn"
				:aria-label="t('knorke', 'Group items')"
				:title="groupTitle"
				:aria-disabled="groupBlocked ? 'true' : undefined"
				data-knorke-action="group"
				@click="(e) => $emit('group', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.groupItems" />
				</template>
			</NcButton>
			<NcButton v-if="showUngroup(selection)"
				variant="tertiary"
				class="knorke-contextbar__groupbtn"
				:aria-label="t('knorke', 'Ungroup')"
				:title="ungroupTitle"
				:aria-disabled="ungroupBlocked ? 'true' : undefined"
				data-knorke-action="ungroup"
				@click="(e) => $emit('ungroup', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.ungroup" />
				</template>
			</NcButton>
		</template>
		<template v-if="lockRow">
			<div class="knorke-contextbar__sep" role="separator" />
			<NcButton v-if="(selection.lockable || 0) > 0"
				variant="tertiary"
				class="knorke-contextbar__lockbtn"
				:aria-label="t('knorke', 'Lock')"
				:title="t('knorke', 'Lock') + ' (Ctrl+Shift+L)'"
				data-knorke-action="lock"
				@click="(e) => $emit('lock', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.lock" />
				</template>
			</NcButton>
			<NcButton v-if="(selection.unlockable || 0) > 0"
				variant="tertiary"
				class="knorke-contextbar__lockbtn"
				:aria-label="unlockText"
				:title="unlockTitle"
				data-knorke-action="unlock"
				@click="(e) => $emit('unlock', e)">
				<template #icon>
					<NcIconSvgWrapper :path="icons.unlock" />
				</template>
			</NcButton>
			<span v-if="(selection.locked || 0) > 0"
				class="knorke-contextbar__lock"
				:data-knorke-lock-badge="selection.lockedBy ? selection.lockedBy.kind : 'several'"
				:title="badgeText">{{ badgeText }}</span>
		</template>
		<span class="knorke-contextbar__count">{{ n('knorke', '%n selected', '%n selected', selection.count || 0) }}</span>
	</div>
</template>

<script setup>
/*
 * Context bar above the canvas while something is selected (SPEC-M0 §6.6;
 * v2 SPEC-M1 §6.5.1, §6.6). What it shows comes from components/contextbar.js:
 * only the fields every selected type has; palettes instead of free colours.
 *
 * - Notes, frames or a mix: the fill palette inline, as in M0
 *   ([data-knorke-fill=#rrggbb] plus [data-knorke-style=style.fill]).
 * - Shapes and text: section buttons [data-knorke-section=fill|border|text|kind]
 *   open ONE panel below the bar with the style buttons
 *   [data-knorke-style=<path>][data-knorke-value=<value>] (§6.8): fill and
 *   opacity, border colour, width and dash, text colour, font size ("Auto"
 *   = auto-fit, value "auto"), alignment, shape kind.
 * - Arrange ([data-knorke-action=arrange], one item) opens the ArrangePopover
 *   in the panel; copy, cut, duplicate ([data-knorke-action=…]), front, back,
 *   delete. No "Paste" button and no vote emit (§6.6).
 * - Connectors (round 1b): sections route ([data-knorke-section=route]:
 *   data.route straight|elbow|curved) and tips ([data-knorke-section=caps]:
 *   style.startCap, style.endCap), the border section as "Line" with the
 *   connector colours (CONNECTOR_COLORS, by name in contextbar.js) and the
 *   widths of the rule (from 1), "Edit label" ([data-knorke-action=label],
 *   exactly one connector) opens the scene's label editor.
 * - "Connect" ([data-knorke-action=connect], SPEC-M1 §6.8, §6.12, WCAG
 *   2.5.7) while exactly two bindable items are selected (selection v2
 *   canConnect).
 * - M2 "Align items" ([data-knorke-action=align], sections.itemAlign: from two
 *   alignable items, selection v2 alignable) opens a panel with six commands
 *   [data-knorke-align=<edge>] in the order of actions.ALIGN_EDGES (left,
 *   center, right; top, middle, bottom). The panel stays open after a click
 *   (the selected ids stay), so another edge can be tried.
 * - M2 "Distribute" (sections.distribute: from three alignable items): a
 *   third row in the align panel with two commands
 *   [data-knorke-distribute=<axis>] in the order of actions.DISTRIBUTE_AXES
 *   (horizontal, vertical); no toggle of its own. Below three alignable
 *   items only the row goes, the panel stays.
 * - M2 "Tidy up": a fourth row in the align panel, always there while the
 *   panel is open (from two alignable items), with one command
 *   [data-knorke-action=tidy] (rows and columns to an exact grid); no
 *   toggle of its own, a command and not a state (no pressed).
 *
 * - M2 locks (SPEC-M1 §1.2 "(R20) Sperren", contextbar.js): cut, duplicate,
 *   front, back and delete only with unlocked items (selection v2
 *   unlocked; copy always); after delete and a separator Lock
 *   ([data-knorke-action=lock], lockable > 0), Unlock
 *   ([data-knorke-action=unlock], unlockable > 0, its name from
 *   unlockLabel: the locker visibly named; the key hint Ctrl+Shift+L only
 *   while nothing can be locked, else the key locks) and the badge
 *   ([data-knorke-lock-badge=<lockedBy.kind>], locked > 0, lockBadgeText;
 *   one line, cut with an ellipsis, the full text in its title; the name
 *   is interpolated text, never HTML). On phones and coarse pointers Lock
 *   and Unlock are finger-sized (knorke.css). A fully locked selection
 *   shows connect (if possible), copy, unlock (if allowed), the badge and
 *   the count.
 * - M2 groups (SPEC-M1 §1.2 "(R20) Gruppieren", contextbar.js): a section
 *   of its own after Delete, a separator before it (the lock row brings its
 *   own): "Group items" ([data-knorke-action=group], showGroup: groupable ≥
 *   2 and not exactly one group; title "Group items (Ctrl+G)") and
 *   "Ungroup" ([data-knorke-action=ungroup], showUngroup: grouped > 0;
 *   title "Ungroup (Ctrl+Shift+G)"). Blocked (groupBlock / ungroupBlock),
 *   a button stays focusable with aria-disabled="true" (never disabled),
 *   looks disabled (knorke.css) and carries the reason as its title; its
 *   click still emits, the session shows the toast group-blocked and sends
 *   nothing. Finger-sized on phones and coarse pointers.
 *
 * Emits: style(path, value, event), kind(kind, event), arrange(box),
 * align(edge, event), distribute(axis, event), tidy(event), copy(event),
 * cut(event), duplicate(event), reorder(where, event), delete(event),
 * connect(event), label(event), group(event), ungroup(event), lock(event),
 * unlock(event). The view gives the focus back to the canvas
 * after pointer clicks on them (components/focus.js); panel toggles keep it.
 *
 * The panel (one element, #knorke-contextbar-panel) stands in the DOM right
 * after the last panel toggle ("Align items", or "Arrange"; the two never
 * show together) and before "Copy": one Tab from "Align items" or "Arrange"
 * leads into it, and a screen reader reads it after its toggle. It is
 * absolutely positioned below the bar, so its place in the DOM does not move
 * it on screen. The count stays the last child.
 *
 * Closing the panel (components/panelDismiss.js): the same toggle, another
 * selection, the section going away (e.g. "Align items" below two alignable
 * items), Esc (inside the panel the focus goes back to its toggle; with the
 * canvas focus or the focus on <body> the key closes the panel and goes no
 * further, so the selection stays until the next Esc), and (R11, C-1b-02) a
 * pointerdown on the canvas. That listener is passive and in the capture
 * phase, so the same press still reaches the scene (the first click of a
 * double click on a connector line is not swallowed), and the line or end
 * handle the panel covered can be reached again right after a style change.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { ALIGN_EDGES, DISTRIBUTE_AXES } from '../board/actions.js'
import { n, t } from '../util/l10n.js'
import ArrangePopover from './ArrangePopover.vue'
import { OPACITIES, contextSections, groupHint, isCurrent, lockBadgeText, showGroup, showUngroup, ungroupHint, unlockLabel, unlockedOf } from './contextbar.js'
import { icons } from './icons.js'
import { closeOnCanvasEscape, closeOnCanvasPress, toggleForEscape } from './panelDismiss.js'
import { alignLabel, capLabel, dashLabel, distributeLabel, itemAlignLabel, routeLabel, shapeKindLabel, valignLabel } from './labels.js'

const props = defineProps({
	selection: { type: Object, required: true },
})

const emit = defineEmits(['style', 'kind', 'arrange', 'align', 'distribute', 'tidy', 'copy', 'cut', 'duplicate', 'reorder', 'delete', 'connect', 'label', 'group', 'ungroup', 'lock', 'unlock'])

const panel = ref(null)
const panelId = 'knorke-contextbar-panel'
/** @type {import('vue').Ref<HTMLElement|null>} */
const bar = ref(null)

const DASH_ICONS = Object.freeze({ solid: icons.dashSolid, dashed: icons.dashDashed, dotted: icons.dashDotted })
const ALIGN_ICONS = Object.freeze({ left: icons.alignLeft, center: icons.alignCenter, right: icons.alignRight })
const VALIGN_ICONS = Object.freeze({ top: icons.valignTop, middle: icons.valignMiddle, bottom: icons.valignBottom })
const KIND_ICONS = Object.freeze({
	rect: icons.rect,
	roundRect: icons.roundRect,
	ellipse: icons.ellipse,
	diamond: icons.diamond,
	triangle: icons.triangle,
	arrowRight: icons.arrowRight,
})
const ROUTE_ICONS = Object.freeze({ straight: icons.routeStraight, elbow: icons.routeElbow, curved: icons.routeCurved })
/** "Align items" (not text: ALIGN_ICONS is the text alignment) */
const ITEM_ALIGN_ICONS = Object.freeze({
	left: icons.alignItemsLeft,
	center: icons.alignItemsCenter,
	right: icons.alignItemsRight,
	top: icons.alignItemsTop,
	middle: icons.alignItemsMiddle,
	bottom: icons.alignItemsBottom,
})
/** The two rows of the align panel: horizontal, then vertical (ALIGN_EDGES). */
const ITEM_ALIGN_ROWS = Object.freeze([ALIGN_EDGES.slice(0, 3), ALIGN_EDGES.slice(3)])
/** "Distribute" (third row of the align panel, DISTRIBUTE_AXES) */
const DISTRIBUTE_ICONS = Object.freeze({ horizontal: icons.distributeHorizontal, vertical: icons.distributeVertical })
const CAP_ICONS = Object.freeze({
	none: icons.capNone,
	arrow: icons.capArrow,
	triangle: icons.capTriangle,
	dot: icons.capDot,
	diamond: icons.capDiamond,
})

const sections = computed(() => contextSections(props.selection))
/** M2 (R20): cut, duplicate, front, back and delete only with unlocked items */
const editable = computed(() => unlockedOf(props.selection) > 0)
/** M2 (R20): the lock row (Lock, Unlock, badge) */
const lockRow = computed(() => (props.selection.lockable || 0) > 0 || (props.selection.unlockable || 0) > 0 || (props.selection.locked || 0) > 0)
const badgeText = computed(() => lockBadgeText(props.selection))
const unlockText = computed(() => unlockLabel(props.selection))
/** the key hint only where Ctrl/⌘+Shift+L unlocks: it locks while something can be locked */
const unlockTitle = computed(() => ((props.selection.lockable || 0) > 0 ? unlockText.value : unlockText.value + ' (Ctrl+Shift+L)'))
/** M2 (R20 Gruppieren): the group section (Group items, Ungroup) */
const groupRow = computed(() => showGroup(props.selection) || showUngroup(props.selection))
/** why Group items / Ungroup is blocked (null: not blocked) */
const groupBlocked = computed(() => groupHint(props.selection))
const ungroupBlocked = computed(() => ungroupHint(props.selection))
/** a blocked button names the reason, else its name and key */
const groupTitle = computed(() => groupBlocked.value ?? t('knorke', 'Group items') + ' (Ctrl+G)')
const ungroupTitle = computed(() => ungroupBlocked.value ?? t('knorke', 'Ungroup') + ' (Ctrl+Shift+G)')
const types = computed(() => [...(props.selection.types ?? [])])
/** Shapes only: the fill palette and the opacity go into the fill panel. */
const fillInPanel = computed(() => !!sections.value.fill && types.value.length > 0 && types.value.every((x) => x === 'shape'))
const hasText = computed(() => !!(sections.value.textColor || sections.value.fontSize || sections.value.align || sections.value.valign))
const textColorKey = computed(() => (sections.value.textColor?.path === 'style.color' ? 'color' : 'textColor'))
/** Connectors only: their stroke is a line, not a border. */
const borderLabel = computed(() => (sections.value.line ? t('knorke', 'Line') : t('knorke', 'Border')))
const widthLabel = computed(() => (sections.value.line ? t('knorke', 'Line width') : t('knorke', 'Border width')))
const capRows = computed(() => [
	{ key: 'startCap', path: 'style.startCap', label: t('knorke', 'Start tip') },
	{ key: 'endCap', path: 'style.endCap', label: t('knorke', 'End tip') },
].filter((r) => !!sections.value[r.key]))
const panelLabel = computed(() => {
	switch (panel.value) {
	case 'fill': return t('knorke', 'Fill')
	case 'border': return borderLabel.value
	case 'text': return t('knorke', 'Text')
	case 'kind': return t('knorke', 'Shape')
	case 'route': return t('knorke', 'Route')
	case 'caps': return t('knorke', 'Tips')
	case 'arrange': return t('knorke', 'Arrange')
	case 'align': return t('knorke', 'Align items')
	default: return ''
	}
})

// another selection closes the panel; the same items keep it (arrange and align stay open)
watch(() => (props.selection.ids ?? []).join(','), () => {
	panel.value = null
})
watch(sections, (s) => {
	const open = panel.value
	if ((open === 'fill' && !fillInPanel.value) || (open === 'border' && !s.stroke) || (open === 'text' && !hasText.value)
		|| (open === 'kind' && !s.kind) || (open === 'arrange' && !s.arrange) || (open === 'route' && !s.route)
		|| (open === 'caps' && !s.startCap && !s.endCap) || (open === 'align' && !s.itemAlign)) {
		panel.value = null
	}
})

// (R11, C-1b-02) a pointerdown on the canvas closes an open panel; passive,
// the scene still gets the press (setting null twice triggers nothing)
let stopCanvasPress = null
// Esc with the canvas focus (or on <body>) closes an open panel first (the
// key stops there, the selection stays); the focus stays where it is
let stopCanvasEscape = null
onMounted(() => {
	stopCanvasPress = closeOnCanvasPress(document, () => {
		panel.value = null
	})
	stopCanvasEscape = closeOnCanvasEscape(document, () => panel.value !== null, () => {
		panel.value = null
	})
})
onBeforeUnmount(() => {
	stopCanvasPress?.()
	stopCanvasPress = null
	stopCanvasEscape?.()
	stopCanvasEscape = null
})

/** @param {string} name panel to open or close */
function toggle(name) {
	panel.value = panel.value === name ? null : name
}

/**
 * Esc closes an open panel first (and goes no further); without a panel it
 * reaches the scene as usual (clear the selection). Pressed inside the
 * panel, the focus goes back to the panel's toggle instead of falling to
 * <body> with the removed panel.
 *
 * @param {KeyboardEvent} e keydown
 */
function onEsc(e) {
	if (panel.value !== null) {
		e.stopPropagation()
		toggleForEscape(bar.value, e.target, panelId)?.focus()
		panel.value = null
	}
}

/**
 * @param {string} key flat selection key
 * @param {unknown} value candidate
 * @return {boolean}
 */
function current(key, value) {
	return isCurrent(props.selection, key, value)
}

/**
 * @param {string} kind shape kind
 * @return {string} icon path
 */
function kindIcon(kind) {
	return KIND_ICONS[kind] ?? icons.shape
}

/**
 * @param {string} route connector route
 * @return {string} icon path
 */
function routeIcon(route) {
	return ROUTE_ICONS[route] ?? icons.routeStraight
}

/**
 * @param {string} cap tip of a connector end
 * @return {string} icon path
 */
function capIcon(cap) {
	return CAP_ICONS[cap] ?? icons.capNone
}

/**
 * @param {string} path field path
 * @param {unknown} value value
 * @param {Event} e click event
 */
function setStyle(path, value, e) {
	emit('style', path, value, e)
}

/**
 * @param {string} kind shape kind
 * @param {Event} e click event
 */
function setKind(kind, e) {
	emit('kind', kind, e)
}
</script>
