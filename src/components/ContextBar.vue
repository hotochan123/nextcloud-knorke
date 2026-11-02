<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="bar"
		class="knorke-contextbar"
		role="toolbar"
		:aria-label="t('knorke', 'Selection')"
		:style="barStyle"
		:data-knorke-place="spot ? spot.place : null"
		@keydown.esc="onEsc"
		@mousedown.capture="onGhost"
		@click.capture="onGhost">
		<template v-for="(g, gi) in groups" :key="'g-' + g.join('-')">
			<div v-if="gi > 0" class="knorke-contextbar__sep" role="separator" />
			<template v-for="item in g" :key="item">
				<button v-if="item === 'chip'"
					type="button"
					class="knorke-contextbar__filter"
					:title="t('knorke', 'Narrow selection')"
					:aria-expanded="panel === 'filter' ? 'true' : 'false'"
					:aria-controls="panelId"
					data-knorke-action="filter"
					@click="toggle('filter')">
					{{ countText }}
					<NcIconSvgWrapper :path="icons.chevronDown" :size="16" />
				</button>
				<span v-else-if="item === 'count'" class="knorke-contextbar__count">{{ countText }}</span>
				<NcButton v-else-if="TOGGLES[item]"
					variant="tertiary"
					:pressed="panel === TOGGLES[item].panel"
					:aria-label="TOGGLES[item].label"
					:title="TOGGLES[item].label"
					:aria-expanded="panel === TOGGLES[item].panel ? 'true' : 'false'"
					:aria-controls="panelId"
					v-bind="{ [TOGGLES[item].hook]: item }"
					@click="toggle(TOGGLES[item].panel)">
					<template #icon>
						<span v-if="item === 'color'"
							class="knorke-fill-dot"
							:style="dotStyle"
							:data-knorke-fill-current="dot.value"
							aria-hidden="true" />
						<NcIconSvgWrapper v-else :path="TOGGLES[item].icon" />
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'label'"
					variant="tertiary"
					:aria-label="t('knorke', 'Edit label')"
					:title="withShortcut(t('knorke', 'Edit label'), 'edit-text', apple)"
					data-knorke-action="label"
					@click="(e) => $emit('label', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.label" />
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'rename'"
					variant="tertiary"
					:aria-label="t('knorke', 'Rename')"
					:title="withShortcut(t('knorke', 'Rename'), 'edit-text', apple)"
					data-knorke-action="rename"
					@click="(e) => $emit('rename', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.pencil" />
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'react'"
					variant="tertiary"
					:aria-label="t('knorke', 'Add reaction')"
					:title="t('knorke', 'Add reaction')"
					aria-haspopup="dialog"
					data-knorke-action="react"
					@click="(e) => $emit('react', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.emoticonPlus" />
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'comment'"
					variant="tertiary"
					:aria-label="t('knorke', 'Comment')"
					:title="t('knorke', 'Comment')"
					aria-haspopup="dialog"
					data-knorke-action="comment"
					@click="(e) => $emit('comment', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.comment" />
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'ai-summarise'"
					class="knorke-ai-mark"
					variant="tertiary"
					:aria-label="t('knorke', 'Summarise')"
					:title="t('knorke', 'Summarise with AI')"
					data-knorke-action="ai-summarise"
					@click="(e) => $emit('ai-summarise', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.sparkle" />
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'ai-cluster'"
					class="knorke-ai-mark"
					variant="tertiary"
					:aria-label="t('knorke', 'Cluster by topic')"
					:title="t('knorke', 'Cluster by topic with AI')"
					data-knorke-action="ai-cluster"
					@click="(e) => $emit('ai-cluster', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.cluster" />
					</template>
				</NcButton>
				<NcButton v-else-if="FORMAT_ITEMS.includes(item)"
					variant="tertiary"
					class="knorke-contextbar__format"
					:aria-label="FORMAT_LABELS[item]()"
					:title="formatTitle(item)"
					:data-knorke-format="item"
					@pointerdown.prevent
					@mousedown.prevent
					@click="(e) => $emit('format', item, e)">
					<template #icon>
						<NcIconSvgWrapper v-if="item === 'list'" :path="icons.listBullets" />
						<span v-else :class="['knorke-fmt', 'knorke-fmt--' + item]" aria-hidden="true">{{ FORMAT_GLYPHS[item] }}</span>
					</template>
				</NcButton>
				<NcButton v-else-if="item === 'link' && links.length === 1"
					variant="tertiary"
					:aria-label="t('knorke', 'Open link')"
					:title="t('knorke', 'Open link') + ': ' + links[0].href"
					data-knorke-action="open-link"
					@click="(e) => $emit('open-link', links[0].href, e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.linkOut" />
					</template>
				</NcButton>
				<div v-else-if="item === 'link'" class="knorke-contextbar__more" data-knorke-menu="links">
					<NcActions force-menu
						variant="tertiary"
						container="#knorke-menus"
						data-knorke-action="open-link"
						:aria-label="t('knorke', 'Open link')"
						:title="t('knorke', 'Open link')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.linkOut" />
						</template>
						<NcActionButton v-for="(l, li) in links"
							:key="'l-' + li"
							close-after-click
							:title="l.href"
							:data-knorke-link="l.href"
							@click="(e) => $emit('open-link', l.href, e)">
							<template #icon>
								<NcIconSvgWrapper :path="icons.linkOut" />
							</template>
							{{ linkLabel(l) }}
						</NcActionButton>
					</NcActions>
				</div>
				<NcButton v-else-if="item === 'tags'"
					variant="tertiary"
					:aria-label="t('knorke', 'Tags')"
					:title="t('knorke', 'Tags')"
					aria-haspopup="dialog"
					data-knorke-action="tags"
					@click="(e) => $emit('tags', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.tag" />
					</template>
				</NcButton>
				<span v-else-if="item === 'badge'"
					class="knorke-contextbar__lock"
					:data-knorke-lock-badge="selection.lockedBy ? selection.lockedBy.kind : 'several'"
					:title="badgeText">{{ badgeText }}</span>
				<NcButton v-else-if="item === 'offer'"
					variant="tertiary"
					class="knorke-contextbar__offer"
					:aria-label="offerText"
					data-knorke-action="select-locked"
					@click="(e) => $emit('select-locked', e)">
					<template #icon>
						<NcIconSvgWrapper :path="icons.lock" />
					</template>
					{{ offerText }}
				</NcButton>
				<div v-else-if="item === 'more'" class="knorke-contextbar__more" data-knorke-menu="selection">
					<NcActions v-model:open="moreOpen"
						force-menu
						variant="tertiary"
						container="#knorke-menus"
						:aria-label="t('knorke', 'More actions')"
						:title="t('knorke', 'More actions')">
						<template #icon>
							<NcIconSvgWrapper :path="icons.dotsHorizontal" />
						</template>
						<template v-for="(mg, mi) in more" :key="'m-' + mg.join('-')">
							<NcActionSeparator v-if="mi > 0" />
							<NcActionButton v-for="name in mg"
								:key="name"
								close-after-click
								:class="{ 'knorke-more--danger': name === 'delete', 'knorke-more--blocked': !!blockedHint(name) }"
								:title="moreTitle(name)"
								:description="blockedHint(name) ?? undefined"
								:data-knorke-action="name"
								@click="(e) => runMore(name, e)">
								<template #icon>
									<NcIconSvgWrapper :path="MORE_ICONS[name]" />
								</template>
								{{ moreLabel(name) }}
							</NcActionButton>
						</template>
					</NcActions>
				</div>
				<div v-if="panel !== null && PANEL_AT[panel] === item"
					:id="panelId"
					:ref="setPanel"
					:class="['knorke-contextbar__panel', { 'knorke-contextbar__panel--filter': panel === 'filter' }]"
					role="group"
					:aria-label="panelLabel"
					:style="panelStyle"
					:data-knorke-panel="panel"
					:data-knorke-panel-side="panelSpot && panelSpot.side ? panelSpot.side : null">
					<template v-if="panel === 'color'">
						<div class="knorke-contextbar__tabs" role="tablist" :aria-label="t('knorke', 'Color and text')">
							<button v-for="tb in tabs"
								:key="tb"
								type="button"
								role="tab"
								class="knorke-contextbar__tab"
								:aria-selected="tab === tb ? 'true' : 'false'"
								:tabindex="tab === tb ? 0 : -1"
								:data-knorke-tab="tb"
								@click="pickTab(tb)"
								@keydown="onTabKey">
								{{ tabLabel(tb) }}
							</button>
						</div>
						<div class="knorke-contextbar__tabpanel" role="tabpanel" :aria-label="tabLabel(tab)">
							<ColorPicker v-if="tab === 'fill'"
								path="style.fill"
								:palette="sections.fill"
								:color="colorOf('fill')"
								:board-colors="boardColors"
								:label="t('knorke', 'Fill')"
								@style="setStyle">
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
							</ColorPicker>
							<ColorPicker v-else-if="tab === 'border'"
								path="style.stroke"
								:palette="sections.stroke"
								:color="colorOf('stroke')"
								:board-colors="boardColors"
								:label="borderLabel"
								@style="setStyle">
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
							</ColorPicker>
							<template v-else-if="tab === 'text'">
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
										:title="noteSizeName(size) ?? undefined"
										:aria-label="noteSizeName(size) ?? undefined"
										@click="(e) => setStyle('style.fontSize', size, e)">
										{{ noteSizeLetter(size) ?? size }}
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
								<ColorPicker v-if="sections.textColor"
									:path="sections.textColor.path"
									:palette="sections.textColor.palette"
									:color="colorOf(textColorKey)"
									:board-colors="boardColors"
									:label="t('knorke', 'Text')"
									@style="setStyle" />
							</template>
						</div>
					</template>
					<template v-else-if="panel === 'header'">
						<div class="knorke-contextbar__row">
							<NcButton variant="tertiary"
								:pressed="headerOn"
								:aria-label="t('knorke', 'Header row')"
								data-knorke-style="style.header"
								:data-knorke-value="headerOn ? 'off' : 'on'"
								@click="(e) => setStyle('style.header', headerOn ? 'off' : 'on', e)">
								<template #icon>
									<NcIconSvgWrapper :path="icons.table" />
								</template>
								{{ t('knorke', 'Header row') }}
							</NcButton>
							<NcButton variant="tertiary"
								:pressed="headerColOn"
								:aria-label="t('knorke', 'Header column')"
								data-knorke-style="style.headerCol"
								:data-knorke-value="headerColOn ? 'off' : 'on'"
								@click="(e) => setStyle('style.headerCol', headerColOn ? 'off' : 'on', e)">
								<template #icon>
									<NcIconSvgWrapper :path="icons.table" />
								</template>
								{{ t('knorke', 'Header column') }}
							</NcButton>
						</div>
						<ColorPicker path="style.headerFill"
							:palette="sections.header.palette"
							:color="colorOf('headerFill')"
							:board-colors="boardColors"
							:label="t('knorke', 'Header')"
							@style="setStyle" />
					</template>
					<template v-else-if="panel === 'mm-node'">
						<ColorPicker path="mm.color"
							:palette="sections.mmNode.colors"
							:color="mmColor"
							:board-colors="boardColors"
							:label="t('knorke', 'Color')"
							@style="(p, v, e) => $emit('mindmap', 'color', v, e)" />
						<div class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Shape')">
							<NcButton v-for="sh in sections.mmNode.shapes"
								:key="sh"
								variant="tertiary"
								:pressed="mmShape === sh"
								:aria-label="nodeShapeLabel(sh)"
								:title="nodeShapeLabel(sh)"
								data-knorke-style="mm.shape"
								:data-knorke-value="sh"
								@click="(e) => $emit('mindmap', 'shape', sh, e)">
								<template #icon>
									<NcIconSvgWrapper :path="NODE_SHAPE_ICONS[sh] || icons.shape" />
								</template>
							</NcButton>
						</div>
					</template>
					<div v-else-if="panel === 'mm-layout'" class="knorke-contextbar__row" role="group" :aria-label="t('knorke', 'Layout')">
						<NcButton v-for="ly in sections.mmLayout.layouts"
							:key="ly"
							variant="tertiary"
							:pressed="mmLayout === ly"
							:aria-label="mindLayoutLabel(ly)"
							:title="mindLayoutLabel(ly)"
							data-knorke-action="mm-layout"
							:data-knorke-value="ly"
							@click="(e) => $emit('mindmap', 'layout', ly, e)">
							<template #icon>
								<NcIconSvgWrapper :path="MIND_LAYOUT_ICONS[ly]" />
							</template>
						</NcButton>
					</div>
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
								<ShapePreview v-if="previewKind(k)" :kind="k" :size="20" />
								<NcIconSvgWrapper v-else :path="kindIcon(k)" />
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
						<div v-if="sections.startCap && sections.endCap && sections.dash && sections.line"
							class="knorke-contextbar__row"
							role="group"
							:aria-label="t('knorke', 'BPMN')"
							data-knorke-section="flow">
							<span class="knorke-contextbar__label">{{ t('knorke', 'BPMN') }}</span>
							<NcButton v-for="f in FLOW_BUTTONS"
								:key="f.flow"
								variant="tertiary"
								:pressed="flowOf(selection) === f.flow"
								:aria-label="f.label"
								:data-knorke-action="'flow-' + f.flow"
								@click="(e) => $emit('flow', f.flow, e)">
								{{ f.label }}
							</NcButton>
						</div>
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
						<div v-if="sections.startCap && sections.endCap" class="knorke-contextbar__row">
							<NcButton variant="tertiary"
								:disabled="!((selection.swappable || 0) > 0)"
								:aria-label="t('knorke', 'Swap direction')"
								:title="t('knorke', 'Swap direction')"
								data-knorke-action="swap-direction"
								@click="(e) => $emit('swap-direction', e)">
								<template #icon>
									<NcIconSvgWrapper :path="icons.swapDirection" />
								</template>
								{{ t('knorke', 'Swap direction') }}
							</NcButton>
						</div>
					</template>
					<ArrangePopover v-else-if="panel === 'arrange'"
						:box="selection.box"
						:rotatable="!!selection.rotatable"
						:types="selection.types"
						:square="!!selection.square"
						@apply="(b) => $emit('arrange', b)" />
					<template v-else-if="panel === 'align'">
						<span class="knorke-contextbar__caption">{{ t('knorke', 'Align edges') }}</span>
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
						<span v-if="sections.distribute" class="knorke-contextbar__caption">{{ t('knorke', 'Distribute') }}</span>
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
						<span class="knorke-contextbar__caption">{{ t('knorke', 'Tidy up (grid)') }}</span>
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
							<NcButton v-if="sections.sortColors"
								variant="tertiary"
								:aria-label="t('knorke', 'Sort by color')"
								:title="t('knorke', 'Sort by color')"
								data-knorke-action="sort-colors"
								@click="(e) => $emit('sort-colors', e)">
								<template #icon>
									<NcIconSvgWrapper :path="icons.sortColors" />
								</template>
							</NcButton>
						</div>
					</template>
					<template v-else-if="panel === 'filter'">
						<button v-for="k in narrow.kinds"
							:key="k.kind"
							type="button"
							class="knorke-contextbar__filteritem"
							:data-knorke-filter="k.kind"
							@click="(e) => pickFilter(k.kind, e)">
							{{ filterLabel(k.kind, k.count) }}
						</button>
						<template v-if="narrow.tags.length > 0">
							<span class="knorke-contextbar__caption">{{ t('knorke', 'By tag') }}</span>
							<button v-for="tg in narrow.tags"
								:key="tg.id"
								type="button"
								class="knorke-contextbar__filteritem"
								:data-knorke-filter-tag="tg.id"
								@click="(e) => pickTag(tg.id, e)">
								<span class="knorke-contextbar__tagdot" :style="tagDotStyle(tg.color)" aria-hidden="true" />
								{{ t('knorke', '{name} ({count})', { name: tg.name, count: String(tg.count) }) }}
							</button>
						</template>
					</template>
				</div>
			</template>
		</template>
	</div>
</template>

<script setup>
/*
 * Context bar above the canvas while something is selected (SPEC-M0 §6.6;
 * v2 SPEC-M1 §6.5.1, §6.6). What it shows comes from components/contextbar.js:
 * only the fields every selected type has; palettes plus free colours.
 *
 * Job 230 (redesign, docs/redesign zuordnung.md "Kontextleiste"): the bar
 * shows contextbar.js barGroups in their fixed order, a separator between two
 * groups: the chip "%n selected ▾" ([data-knorke-action=filter], from two
 * items on, when there is something to narrow; else the plain count, none
 * for one item), "Align items", the colour dot ([data-knorke-section=color],
 * contextbar.js dotOf), the type's toggles ([data-knorke-section=kind |
 * route | caps | header | mm-node | mm-layout], "Edit label", "Rename"), the
 * collaboration group (react, comment, tags), the lock badge and "Select n
 * locked items", and "…" ([data-knorke-menu=selection], NcActions in
 * #knorke-menus) with contextbar.js moreGroups: NcActionButton
 * [data-knorke-action=<name>] per entry, NcActionSeparator between groups,
 * "Delete" last in the error colour; the key shows in the title; a blocked
 * "Group items" / "Ungroup" stays enabled with its reason as description and
 * title (its click shows the toast). "Arrange…" opens the panel 'arrange'
 * at "…"; opening "…" closes the open panel. The colour dot opens the panel
 * 'color': tabs [data-knorke-tab=fill|border|text] (contextbar.js
 * colorTabs; it opens on the tab picked last while the selection has it;
 * arrow keys, Home and End move between them), under them one tab's rows:
 * Fill = palette, "On this board", opacity, "Custom color…"; Border or Line =
 * palette, "On this board", width, dash, "Custom color…"; Text = size,
 * alignment, text colour. The chip's panel 'filter' ("Narrow selection")
 * lists the kinds and, under "By tag", the tags of contextbar.js
 * narrowEntries ([data-knorke-filter-tag=<id>], emit filter-tag(id, event)).
 * Every open panel follows its toggle in the DOM (the chip for 'filter', "…"
 * for 'arrange') and gives way to the selection (barPlace.js placePanel with
 * the keep box). The older notes below hold where they do not say otherwise.
 *
 * - Section buttons [data-knorke-section=fill|border|text|kind] open ONE
 *   panel below the bar with the style buttons
 *   [data-knorke-style=<path>][data-knorke-value=<value>] (§6.8): fill and
 *   opacity, border colour, width and dash, text colour, font size ("Auto"
 *   = auto-fit, value "auto"), alignment, shape kind. (Job 227) Notes alone get
 *   "Auto", S, M and L (contextbar.js NOTE_SIZES), named Small, Medium and
 *   Large as title and aria-label.
 * - Job 135: the fill toggle comes first for every selection with a fill.
 *   Shapes only: the fill icon. Notes, frames or a mix: a round dot
 *   [data-knorke-fill-current] in the common fill, or 'mixed' and split
 *   into the first two fills (selection v2 fills). Every palette (fill,
 *   border or line, text colour) is a ColorPicker: the grid, the "#" field
 *   with its preview dot and the system colour picker, and the row "On this
 *   board" (selection v2 boardColors); the other rows of the panel follow.
 * - Arrange ([data-knorke-action=arrange], one item) opens the ArrangePopover
 *   in the panel; copy, cut, duplicate ([data-knorke-action=…]), front, back,
 *   delete. No "Paste" button and no vote emit (§6.6).
 * - Connectors (round 1b): sections route ([data-knorke-section=route]:
 *   data.route straight|elbow|curved) and tips ([data-knorke-section=caps]:
 *   style.startCap, style.endCap), the border section as "Line" with the
 *   connector colours (CONNECTOR_COLORS, by name in contextbar.js) and the
 *   widths of the rule (from 1), "Edit label" ([data-knorke-action=label],
 *   exactly one connector) opens the scene's label editor.
 * - Job 153: below the two tip rows a third row with "Swap direction"
 *   ([data-knorke-action=swap-direction], icon and visible text), disabled
 *   (not focusable) while selection v2 swappable is 0 or missing; it emits
 *   swap-direction(event), the panel stays open.
 * - Job 204: above the tip rows (connectors only) a row "BPMN"
 *   ([data-knorke-section=flow]) with "Sequence flow" and "Message flow"
 *   ([data-knorke-action=flow-sequence | flow-message], visible text,
 *   pressed while contextbar.js flowOf names that flow); they emit
 *   flow(flow, event), the panel stays open.
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
 * - Job 139: "Sort by color" ([data-knorke-action=sort-colors],
 *   sections.sortColors: selection v2 sortable ≥ 2) after "Tidy up" in its
 *   row, and "Sort notes by color" ([data-knorke-action=sort-frame],
 *   sections.sortFrame: frameSortable ≥ 2) in the bar before "Arrange";
 *   commands with icons.sortColors, emitting sort-colors(event) and
 *   sort-frame(event).
 * - Job 143: "Rename" ([data-knorke-action=rename], sections.rename:
 *   exactly one unlocked frame) at the place of "Edit label", before the
 *   separator, with icons.pencil and the key Enter in its title; it emits
 *   rename(event), and the view opens the frame's title editor (which takes
 *   the focus, like "Edit label").
 * - Job 144: with a non-empty selection v2 kinds (contextbar.js
 *   filterEntries) the count is a button [data-knorke-action=filter] (the
 *   same text plus icons.chevronDown, title "Filter selection") that toggles
 *   the panel 'filter': one button [data-knorke-filter=<kind>] per entry,
 *   one below the other, "Only notes ({count})" … (filterLabel). An entry
 *   closes the panel and emits filter(kind, event); the view filters and
 *   gives the canvas the focus. Without kinds the count stays plain text.
 *   Finger-sized on phones and coarse pointers.
 *
 * - M2 locks (SPEC-M1 §1.2 "(R20) Sperren", contextbar.js): cut, duplicate,
 *   front, back and delete only with unlocked items (selection v2
 *   unlocked; copy always); after delete and a separator Lock
 *   ([data-knorke-action=lock], lockable > 0), Unlock
 *   ([data-knorke-action=unlock], unlockable > 0, its name from
 *   unlockLabel: the locker visibly named; the key hint Ctrl/⌘+Shift+L only
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
 * - Job 173: only tables selected, the section header ([data-knorke-section=header],
 *   "Header") opens a panel with the switch "Header row"
 *   ([data-knorke-style=style.header], aria-pressed: the header row is on; a click
 *   sets the other value) and a ColorPicker of style.headerFill (contextSections
 *   header.palette). Border and text show only the colour (a table has no width,
 *   dash or size).
 * - Job 195: one unlocked mind map selected: (job 198) the section
 *   "Layout" ([data-knorke-section=mm-layout]) with one button per layout
 *   ([data-knorke-action=mm-layout][data-knorke-value=both|right|org|tree]:
 *   Mind map, Right only, Org chart, Tree; aria-pressed: the map's layout; a
 *   click emits mindmap('layout', value, event)) and, with a
 *   focused node, the section "Branch" ([data-knorke-section=mm-node]): a
 *   ColorPicker of the node's colour (contextSections mmNode.colors, path
 *   mm.color) and the four shapes ([data-knorke-style=mm.shape]); each emits
 *   mindmap('color'|'shape', value, event).
 * - Job 141: every title with a key (Edit label, Rename, Copy, Cut, Duplicate,
 *   Delete, Lock, Unlock, Group items, Ungroup) takes it from the one
 *   formatter (util/shortcuts.js withShortcut): ⌘ symbols with the prop
 *   apple, else Ctrl, Shift and Del translated (Strg+C, Entf).
 *
 * - Job 189: "Comment" ([data-knorke-action=comment], icons.comment) right
 *   after "Add reaction" while selection v2 commentable (exactly one item of
 *   the five types, this person may comment); it emits comment(event).
 * - Job 191: "Tags" ([data-knorke-action=tags], icons.tag) right after it
 *   while selection v2 taggable > 0 (an unlocked selected note); it emits
 *   tags(event), and the view opens the tag panel below it.
 * - Job 267: "Summarise" ([data-knorke-action=ai-summarise], icons.sparkle)
 *   and "Cluster by topic" ([data-knorke-action=ai-cluster], icons.cluster)
 *   in a group of their own after the collaboration group, while selection
 *   v2 ai.summarise / ai.cluster; they emit ai-summarise(event) and
 *   ai-cluster(event).
 * - Job 172: "Add reaction" ([data-knorke-action=react], icons.emoticonPlus)
 *   after "Copy" while selection v2 reactable (exactly one note, this person
 *   may react); it emits react(event), and the view opens the reaction
 *   picker below it.
 * - Job 190: while selection v2 lockedOffer > 0 (a plain marquee or
 *   Ctrl/⌘+A skipped locked items) the text button
 *   [data-knorke-action=select-locked] (icons.lock, "Select 3 locked items")
 *   stands right before the count and emits select-locked(event);
 *   finger-sized on phones and coarse pointers. Without a selection (count
 *   0) the bar shows only this button: no Copy, no count.
 *
 * Emits: style(path, value, event), kind(kind, event), arrange(box),
 * align(edge, event), distribute(axis, event), tidy(event), copy(event),
 * cut(event), duplicate(event), reorder(where, event), delete(event),
 * connect(event), label(event), rename(event) (job 143), group(event), ungroup(event), lock(event),
 * unlock(event), sort-colors(event), sort-frame(event) (job 139), filter(kind, event) (job 144),
 * swap-direction(event) (job 153), flow(flow, event) (job 204), react(event) (job 172), select-locked(event) (job 190), away() (job 137,
 * below). The view gives the focus back to the canvas
 * after pointer clicks on them (components/focus.js); panel toggles keep it.
 *
 * The panel (one element, #knorke-contextbar-panel) stands in the DOM right
 * after the last panel toggle ("Align items", or "Arrange"; the two never
 * show together) and before "Copy": one Tab from "Align items" or "Arrange"
 * leads into it, and a screen reader reads it after its toggle. It is
 * absolutely positioned below the bar, so its place in the DOM does not move
 * it on screen. The count stays the last child; only the panel 'filter'
 * (job 144) stands after it, right after its toggle, the count button.
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
 *
 * Factory job 137, the wide layout (prop room, from the board view; null in
 * the narrow layout, where bar and panel stay in the top stack as before):
 * the bar stands at the selection (prop at = the scene's onSelectionBox,
 * rules in components/barPlace.js), absolutely positioned in the top stack
 * (still its last child: tab order and live region unchanged), with
 * [data-knorke-place=above|below|pinned|hidden]. It is measured (its size
 * and that of the open panel, a ResizeObserver) before it shows: until then
 * and while the scene has no box it is 'hidden' (visibility: hidden, the
 * open panel stays open and comes back with it). Hidden with the focus
 * inside, it emits away (the view gives the canvas the focus). The panel
 * opens on the side from barPlace.js ([data-knorke-panel-side=above|below]).
 * A click (or mousedown) in the bar whose pointerdown landed elsewhere is
 * the compatibility click of a finger that just selected an item under
 * where the bar now shows (ENTWICKLUNG trap 46): it is swallowed; keyboard
 * clicks (detail 0) pass.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { ALIGN_EDGES, DISTRIBUTE_AXES } from '../board/actions.js'
import { ENUMS } from '../model/registry.js'
import { n, t } from '../util/l10n.js'
import { withShortcut } from '../util/shortcuts.js'
import ArrangePopover from './ArrangePopover.vue'
import { placeBar, placePanel } from './barPlace.js'
import ColorPicker from './ColorPicker.vue'
import ShapePreview from './ShapePreview.vue'
import {
	FORMAT_ITEMS, BOARD_COLORS_MAX, NOTE_SIZES, OPACITIES, SELECTION_FIELDS, barGroups, canNarrow, colorTabs, contextSections, dotOf, filterLabel, flowOf, isCurrent,
	lockBadgeText, menuBlocked, menuLabel, menuShortcut, moreGroups, narrowEntries, parseHex,
} from './contextbar.js'
import { icons, OPTION_ICONS } from './icons.js'
import { CANVAS_SELECTOR, closeOnCanvasEscape, closeOnCanvasPress, toggleForEscape } from './panelDismiss.js'
import { alignLabel, capLabel, dashLabel, distributeLabel, itemAlignLabel, mindLayoutLabel, nodeShapeLabel, routeLabel, shapeKindLabel, valignLabel } from './labels.js'

const props = defineProps({
	selection: { type: Object, required: true },
	/** job 137: the scene's selection box ({box, keep}, board px; onSelectionBox) or null */
	at: { type: Object, default: null },
	/** job 137: the wide layout's room ({W, H, T, U, ox, oy}, board px; the board view) or null (narrow layout) */
	room: { type: Object, default: null },
	/** job 141: Apple platform, ⌘ hints in the titles (util/device.js isApplePlatform) */
	apple: { type: Boolean, default: false },
})

const emit = defineEmits(['style', 'mindmap', 'kind', 'arrange', 'align', 'distribute', 'tidy', 'sort-colors', 'sort-frame', 'copy', 'cut', 'duplicate', 'reorder', 'delete', 'connect', 'label', 'rename', 'group', 'ungroup', 'frame-around', 'lock', 'unlock', 'filter', 'filter-tag', 'swap-direction', 'flow', 'react', 'comment', 'tags', 'select-locked', 'away', 'ai-summarise', 'ai-cluster', 'format', 'open-link'])

const panel = ref(null)
const panelId = 'knorke-contextbar-panel'
/** @type {import('vue').Ref<HTMLElement|null>} */
const bar = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} the open panel */
const panelEl = ref(null)
/** the bar's measured size (border box) and border widths {w, h, bl, bt}; null before the first measurement */
const size = shallowRef(null)
/** the open panel's measured size {w, h} */
const panelSize = shallowRef(null)

/** Where the bar stands (barPlace.js, board px); null in the narrow layout, 'hidden' until measured. */
const spot = computed(() => {
	const r = props.room
	if (r === null) return null
	if (size.value === null) return { place: 'hidden', left: null, top: null }
	return placeBar(props.at, { W: r.W, H: r.H, T: r.T, U: r.U, w: size.value.w, h: size.value.h })
})
/** left/top in the top stack (its offset in the board: room.ox, room.oy) */
const barStyle = computed(() => {
	const s = spot.value
	if (s === null || s.left === null) return undefined
	return { left: `${s.left - props.room.ox}px`, top: `${s.top - props.room.oy}px` }
})
/** Where the open panel stands (barPlace.js); null in the narrow layout or without a panel, side null until placed. */
const panelSpot = computed(() => {
	const s = spot.value
	const ps = panelSize.value
	if (s === null || panel.value === null) return null
	if (s.left === null || ps === null) return { side: null }
	const r = props.room
	return placePanel({ place: s.place, left: s.left, top: s.top, w: size.value.w, h: size.value.h }, { W: r.W, T: r.T, U: r.U, pw: ps.w, ph: ps.h, keep: props.at?.keep ?? props.at?.box ?? null })
})
/** left/top inside the bar (its padding box) */
const panelStyle = computed(() => {
	const p = panelSpot.value
	if (p === null) return undefined
	if (p.side === null) return { visibility: 'hidden' }
	const s = spot.value
	return { left: `${p.left - s.left - size.value.bl}px`, top: `${p.top - s.top - size.value.bt}px` }
})

const DASH_ICONS = Object.freeze({ solid: icons.dashSolid, dashed: icons.dashDashed, dotted: icons.dashDotted })
const ALIGN_ICONS = Object.freeze({ left: icons.alignLeft, center: icons.alignCenter, right: icons.alignRight })
const VALIGN_ICONS = Object.freeze({ top: icons.valignTop, middle: icons.valignMiddle, bottom: icons.valignBottom })
const KIND_ICONS = OPTION_ICONS.kind
const ROUTE_ICONS = OPTION_ICONS.route
/** job 195: the shapes of a mind map node */
const NODE_SHAPE_ICONS = Object.freeze({ line: icons.dashSolid, rect: icons.rect, roundRect: icons.roundRect, pill: icons.ellipse })
/** job 198: the layouts of a mind map */
const MIND_LAYOUT_ICONS = Object.freeze({ both: icons.mmBoth, right: icons.arrowRight, org: icons.mindmap, tree: icons.mmTree })
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
/** (Job 204) The buttons of the row "BPMN" in the panel "Tips". */
const FLOW_BUTTONS = Object.freeze([
	{ flow: 'sequence', label: t('knorke', 'Sequence flow') },
	{ flow: 'message', label: t('knorke', 'Message flow') },
])
const CAP_ICONS = OPTION_ICONS.endCap

const sections = computed(() => contextSections(props.selection))
/** (Job 230) The bar's elements in their groups (contextbar.js barGroups), a separator between two groups. */
const groups = computed(() => barGroups(props.selection))
/** (Job 279) The links of the one selected item (selection v2 links). */
const links = computed(() => (Array.isArray(props.selection?.links) ? props.selection.links : []))
/** (Job 279) Names of B, I, S and the list button, and the letters B, I and S show. */
const FORMAT_LABELS = Object.freeze({
	bold: () => t('knorke', 'Bold'),
	italic: () => t('knorke', 'Italic'),
	strike: () => t('knorke', 'Strikethrough'),
	list: () => t('knorke', 'List'),
})
const FORMAT_GLYPHS = Object.freeze({ bold: 'B', italic: 'I', strike: 'S' })

/**
 * @param {string} item bold, italic, strike or list
 * @return {string} its tooltip, with Ctrl/⌘+B and Ctrl/⌘+I
 */
function formatTitle(item) {
	return withShortcut(FORMAT_LABELS[item](), item, props.apple)
}

/**
 * @param {{text: string, href: string}} l a link
 * @return {string} its text and the host of its address (the address for mailto)
 */
function linkLabel(l) {
	let host = l.href
	try {
		host = new URL(l.href).host || l.href
	} catch {
		// keep the address
	}
	return l.text === l.href ? host : l.text + ' — ' + host
}
/** (Job 230) The groups of "…" (contextbar.js moreGroups). */
const more = computed(() => moreGroups(props.selection))
/** (Job 230) "…" is open (NcActions v-model:open); opening it closes the bar's panel. */
const moreOpen = ref(false)
const badgeText = computed(() => lockBadgeText(props.selection))
/** job 144, job 230: the entries of the chip's panel "Narrow selection" (kinds and tags) */
const narrow = computed(() => narrowEntries(props.selection))
const countText = computed(() => n('knorke', '%n selected', '%n selected', props.selection.count || 0))
/** job 190: how many offered locked items "Select n locked items" selects (selection v2 lockedOffer) */
const lockedOffer = computed(() => (Number.isInteger(props.selection.lockedOffer) && props.selection.lockedOffer > 0 ? props.selection.lockedOffer : 0))
const offerText = computed(() => n('knorke', 'Select %n locked item', 'Select %n locked items', lockedOffer.value))
/** (Job 230) What the colour dot shows (contextbar.js dotOf): one colour, two halves, or none. */
const dot = computed(() => dotOf(props.selection))
const dotStyle = computed(() => {
	const c = dot.value.colors
	if (c.length >= 2) return { background: `linear-gradient(90deg, ${c[0]} 50%, ${c[1]} 50%)` }
	return c.length === 1 ? { backgroundColor: c[0] } : undefined
})
/** the row "On this board" of every colour block (selection v2 boardColors, validated, at most BOARD_COLORS_MAX) */
const boardColors = computed(() => (props.selection.boardColors ?? []).map(parseHex).filter((c) => c !== null).slice(0, BOARD_COLORS_MAX))
/** (Job 230) The tabs of the colour panel (contextbar.js colorTabs). */
const tabs = computed(() => colorTabs(sections.value))
/** (Job 230) The tab last picked; the panel opens on it while the selection has it, else on the first. */
const lastTab = ref('fill')
const tab = computed(() => (tabs.value.includes(lastTab.value) ? lastTab.value : tabs.value[0] ?? null))
/** job 173: the header row of the selected tables is on (style.header 'on', the default; mixed counts as off) */
const headerOn = computed(() => isCurrent(props.selection, 'header', 'on'))
/** job 265: the header column of the selected tables is on (style.headerCol 'on'; mixed counts as off) */
const headerColOn = computed(() => isCurrent(props.selection, 'headerCol', 'on'))
/** job 198: the layout of the selected mind map (job 195: the colour and shape of its focused node) */
const mmLayout = computed(() => props.selection.mindmap?.layout ?? 'both')
const mmColor = computed(() => parseHex(props.selection.mindmap?.node?.color ?? ''))
const mmShape = computed(() => props.selection.mindmap?.node?.shape ?? null)
const textColorKey = computed(() => (sections.value.textColor?.path === 'style.color' ? 'color' : 'textColor'))
/** Connectors only (job 273: or pen strokes only): their stroke is a line, not a border. */
const borderLabel = computed(() => (sections.value.line || sections.value.ink ? t('knorke', 'Line') : t('knorke', 'Border')))
const widthLabel = computed(() => (sections.value.line || sections.value.ink ? t('knorke', 'Line width') : t('knorke', 'Border width')))
const capRows = computed(() => [
	{ key: 'startCap', path: 'style.startCap', label: t('knorke', 'Start tip') },
	{ key: 'endCap', path: 'style.endCap', label: t('knorke', 'End tip') },
].filter((r) => !!sections.value[r.key]))
/**
 * (Job 230) The toggles of the bar (barGroups items with a panel): the panel
 * they open, their hook ([data-knorke-section=<item>], "Align items"
 * [data-knorke-action=align] as before), their name and icon.
 */
const TOGGLES = computed(() => ({
	align: { panel: 'align', hook: 'data-knorke-action', label: t('knorke', 'Align items'), icon: icons.alignItemsLeft },
	color: { panel: 'color', hook: 'data-knorke-section', label: t('knorke', 'Color and text'), icon: null },
	kind: { panel: 'kind', hook: 'data-knorke-section', label: t('knorke', 'Change shape'), icon: icons.diamond },
	route: { panel: 'route', hook: 'data-knorke-section', label: t('knorke', 'Route'), icon: icons.routes },
	caps: { panel: 'caps', hook: 'data-knorke-section', label: t('knorke', 'Tips'), icon: icons.tips },
	header: { panel: 'header', hook: 'data-knorke-section', label: t('knorke', 'Header'), icon: icons.headerRow },
	'mm-node': { panel: 'mm-node', hook: 'data-knorke-section', label: t('knorke', 'Branch'), icon: icons.branch },
	'mm-layout': { panel: 'mm-layout', hook: 'data-knorke-section', label: t('knorke', 'Layout'), icon: icons.mmTree },
}))
/**
 * (Job 230) The element the open panel follows in the DOM: its toggle (one
 * Tab from it leads into the panel), the chip for 'filter', "…" for
 * 'arrange' (opened from there).
 */
const PANEL_AT = Object.freeze({
	color: 'color', kind: 'kind', route: 'route', caps: 'caps', header: 'header', 'mm-node': 'mm-node', 'mm-layout': 'mm-layout',
	align: 'align', filter: 'chip', arrange: 'more',
})
/** (Job 230) The icons of the entries of "…". */
const MORE_ICONS = Object.freeze({
	cut: icons.cut,
	copy: icons.copy,
	duplicate: icons.duplicate,
	front: icons.front,
	back: icons.back2,
	connect: icons.connect,
	arrange: icons.arrange,
	'sort-colors': icons.sortColors,
	'sort-frame': icons.sortColors,
	group: icons.groupItems,
	ungroup: icons.ungroup,
	'frame-around': icons.frame,
	lock: icons.lock,
	unlock: icons.unlock,
	delete: icons.trash,
})
const panelLabel = computed(() => {
	switch (panel.value) {
	case 'color': return t('knorke', 'Color and text')
	case 'kind': return t('knorke', 'Shape')
	case 'header': return t('knorke', 'Header')
	case 'mm-node': return t('knorke', 'Branch')
	case 'mm-layout': return t('knorke', 'Layout')
	case 'route': return t('knorke', 'Route')
	case 'caps': return t('knorke', 'Tips')
	case 'arrange': return t('knorke', 'Arrange')
	case 'align': return t('knorke', 'Align items')
	case 'filter': return t('knorke', 'Narrow selection')
	default: return ''
	}
})

// another selection closes the panel; the same items keep it (arrange and align stay open)
watch(() => (props.selection.ids ?? []).join(','), () => {
	panel.value = null
})
watch(sections, (s) => {
	const open = panel.value
	if ((open === 'color' && colorTabs(s).length === 0)
		|| (open === 'kind' && !s.kind) || (open === 'header' && !s.header) || (open === 'mm-node' && !s.mmNode) || (open === 'mm-layout' && !s.mmLayout)
		|| (open === 'arrange' && !s.arrange)
		|| (open === 'route' && !s.route)
		|| (open === 'caps' && !s.startCap && !s.endCap) || (open === 'align' && !s.itemAlign)) {
		panel.value = null
	}
})
// job 144: the filter panel closes as soon as the selection has nothing to narrow
watch(() => canNarrow(props.selection), (can) => {
	if (!can && panel.value === 'filter') {
		panel.value = null
	}
})
// (job 230) one popup at a time: "…" opening closes the panel
watch(moreOpen, (open) => {
	if (open) {
		panel.value = null
	}
})
// (job 230) another tab changes the panel's size: it hides until it is measured anew and placed again
// (else it would stand a frame at the old place, maybe outside the view)
watch(tab, () => {
	if (panel.value === 'color' && panelSize.value !== null) {
		panelSize.value = null
		nextTick(measure)
	}
}, { flush: 'post' })

// (R11, C-1b-02) a pointerdown on the canvas closes an open panel; passive,
// the scene still gets the press (setting null twice triggers nothing)
let stopCanvasPress = null
// Esc with the canvas focus (or on <body>) closes an open panel first (the
// key stops there, the selection stays); the focus stays where it is
let stopCanvasEscape = null
// job 137: the sizes of the bar and the open panel
let sizes = null
onMounted(() => {
	stopCanvasPress = closeOnCanvasPress(document, () => {
		panel.value = null
	})
	stopCanvasEscape = closeOnCanvasEscape(document, () => panel.value !== null, () => {
		panel.value = null
	})
	document.addEventListener('pointerdown', onDocDown, { capture: true, passive: true })
	measure()
	if (typeof ResizeObserver === 'function') {
		sizes = new ResizeObserver(() => measure())
		sizes.observe(bar.value)
	}
})
onBeforeUnmount(() => {
	stopCanvasPress?.()
	stopCanvasPress = null
	stopCanvasEscape?.()
	stopCanvasEscape = null
	document.removeEventListener('pointerdown', onDocDown, { capture: true })
	sizes?.disconnect()
	sizes = null
})
// the panel is measured when it opens and whenever its size changes
watch(panelEl, (el, old) => {
	if (old) sizes?.unobserve(old)
	if (el) sizes?.observe(el)
	measure()
}, { flush: 'post' })
// hidden with the focus inside (a wheel gesture, the selection out of view):
// the canvas takes it, so the scene's keys keep working (before the bar hides)
watch(() => spot.value?.place, (place) => {
	if (place === 'hidden' && bar.value?.contains(document.activeElement)) {
		emit('away')
	}
})

/** Measures the bar and the open panel, unrounded (only real changes go into the reactive sizes). */
function measure() {
	const el = bar.value
	if (el) {
		const r = el.getBoundingClientRect()
		const s = { w: r.width, h: r.height, bl: el.clientLeft, bt: el.clientTop }
		const o = size.value
		if (o === null || o.w !== s.w || o.h !== s.h || o.bl !== s.bl || o.bt !== s.bt) size.value = s
	}
	const p = panelEl.value
	const pr = p ? p.getBoundingClientRect() : null
	const ps = pr ? { w: pr.width, h: pr.height } : null
	const po = panelSize.value
	if (ps === null ? po !== null : po === null || po.w !== ps.w || po.h !== ps.h) panelSize.value = ps
}

/** the last pointerdown landed in the bar (job 137: a click without one is a finger's compatibility click) */
let downInBar = false

/** @param {PointerEvent} e any pointerdown (document, capture phase, passive) */
function onDocDown(e) {
	downInBar = !!bar.value && !!e?.target && bar.value.contains(e.target)
}

/**
 * Wide layout: a mousedown or click in the bar whose pointerdown landed
 * elsewhere (a finger that selected the item under where the bar shows now)
 * does nothing; a keyboard click (detail 0) passes.
 *
 * @param {MouseEvent} e mousedown or click (capture phase of the bar)
 */
function onGhost(e) {
	if (props.room === null || downInBar || (e.type === 'click' && e.detail === 0)) {
		return
	}
	e.preventDefault()
	e.stopPropagation()
}

/** @param {string} name panel to open or close */
function toggle(name) {
	panel.value = panel.value === name ? null : name
}

/** @param {HTMLElement|null} el the open panel (a function ref: it stands inside the v-for of the groups) */
function setPanel(el) {
	panelEl.value = el ?? null
}

/**
 * @param {string} tb fill, border or text
 * @return {string} (job 230) the name of a tab of the colour panel
 */
function tabLabel(tb) {
	switch (tb) {
	case 'fill': return t('knorke', 'Fill')
	case 'border': return borderLabel.value
	case 'text': return t('knorke', 'Text')
	default: return ''
	}
}

/** @param {string} tb (job 230) the tab of the colour panel to show (kept for the next panel) */
function pickTab(tb) {
	lastTab.value = tb
}

/**
 * (Job 230) Arrow keys, Home and End move between the tabs of the colour
 * panel (automatic activation, WAI-ARIA tabs pattern).
 *
 * @param {KeyboardEvent} e keydown on a tab
 */
function onTabKey(e) {
	const list = tabs.value
	const i = list.indexOf(tab.value)
	let next = null
	if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = list[(i + 1) % list.length]
	else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length]
	else if (e.key === 'Home') next = list[0]
	else if (e.key === 'End') next = list[list.length - 1]
	if (next === null || next === undefined) return
	e.preventDefault()
	lastTab.value = next
	e.currentTarget?.parentElement?.querySelector('[data-knorke-tab="' + next + '"]')?.focus()
}

/**
 * @param {string} name entry of "…" (contextbar.js moreGroups)
 * @return {string} (job 230) its text, the right-click menu's (contextbar.js menuLabel)
 */
function moreLabel(name) {
	return menuLabel(name, props.selection)
}

/**
 * @param {string} name entry of "…"
 * @return {string|null} (job 230) why "Group items" / "Ungroup" is blocked (contextbar.js menuBlocked), else null
 */
function blockedHint(name) {
	return menuBlocked(name, props.selection)
}

/**
 * @param {string} name entry of "…"
 * @return {string} (job 230) its tooltip: the reason of a blocked entry, else its text and key (Strg+X …;
 *   Unlock names no key while something can be locked: the key locks then, M2 R20)
 */
function moreTitle(name) {
	const label = moreLabel(name)
	const key = name === 'unlock' && (props.selection.lockable ?? 0) > 0 ? null : menuShortcut(name, props.apple)
	return blockedHint(name) ?? (key ? label + ' (' + key.hint + ')' : label)
}

/**
 * (Job 230) An entry of "…": the same emits as the bar's former buttons;
 * "Arrange…" opens the panel "Arrange" at "…" (by key with the focus in its
 * first field). NcActions closes the menu after the entry without giving the
 * focus back; after a key (detail 0) a focus left in the closing menu or on
 * <body> goes back to "…", or to the canvas when the bar went away with the
 * selection (cut, delete). A focus the view already moved (Lock: the canvas)
 * stays.
 *
 * @param {string} name entry of "…"
 * @param {Event} e click (pointer, or Enter and Space on the entry)
 */
function runMore(name, e) {
	const byKey = e?.detail === 0
	if (name === 'arrange') {
		openArrange({ focus: byKey })
		return
	}
	if (name === 'front' || name === 'back') {
		emit('reorder', name, e)
	} else {
		emit(name, e)
	}
	if (byKey) {
		nextTick(refocusMore)
	}
}

/** (Job 230) After an entry of "…" by key: the focus back to "…" (or the canvas) unless the view moved it. */
function refocusMore() {
	if (typeof document === 'undefined') {
		return
	}
	const a = document.activeElement
	if (a && a !== document.body && !a.closest?.('#knorke-menus')) {
		return
	}
	const trigger = bar.value?.querySelector?.('[data-knorke-menu=selection] button') ?? null
	const target = trigger ?? document.querySelector(CANVAS_SELECTOR)
	target?.focus?.({ preventScroll: true })
}

/** (Job 230) The panel "Arrange" opened by the right-click menu takes the focus once it shows. */
let focusArrange = false

/**
 * (Job 230) Opens the panel "Arrange" (the right-click menu's "Arrange…",
 * through the board view); with focus its first field takes the focus once
 * the panel is placed (a hidden panel cannot take it).
 *
 * @param {{focus?: boolean}} [o] options
 */
function openArrange({ focus = false } = {}) {
	if (!sections.value.arrange) {
		return
	}
	panel.value = 'arrange'
	focusArrange = focus
	if (focus && props.room === null) {
		nextTick(focusPanel)
	}
}

/** Gives the first field of the open panel the focus (openArrange). */
function focusPanel() {
	focusArrange = false
	panelEl.value?.querySelector?.('input, button')?.focus?.()
}

watch(() => panelSpot.value?.side ?? null, (side) => {
	if (side !== null && focusArrange && panel.value === 'arrange') {
		nextTick(focusPanel)
	}
})

defineExpose({ openArrange })

/**
 * (Job 230) An entry "By tag" of the chip's panel: the panel closes; the view narrows the selection.
 *
 * @param {string} id tag id
 * @param {Event} e click
 */
function pickTag(id, e) {
	panel.value = null
	emit('filter-tag', id, e)
}

/**
 * @param {unknown} c a tag's colour
 * @return {object|undefined} (job 230) the dot of an entry "By tag": the colour when it is valid #rrggbb
 */
function tagDotStyle(c) {
	const hex = parseHex(typeof c === 'string' ? c : '')
	return hex === null ? undefined : { backgroundColor: hex }
}

/**
 * An entry of the filter panel (job 144): the panel closes, also when the
 * selection stays as it is; the view filters.
 *
 * @param {string} kind sticky, shape, text, connector, frame or group
 * @param {Event} e click (pointer, or Enter and Space on the button)
 */
function pickFilter(kind, e) {
	panel.value = null
	emit('filter', kind, e)
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
		// (job 230) the panel "Arrange" has no toggle of its own (it opens from "…"): the focus goes back to "…"
		const inPanel = typeof e.target?.closest === 'function' && e.target.closest('#' + panelId) !== null
		const back = toggleForEscape(bar.value, e.target, panelId) ?? (inPanel ? bar.value?.querySelector?.('[data-knorke-menu=selection] button') ?? null : null)
		back?.focus()
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
 * @param {string} key flat selection key of a colour (fill, stroke, textColor, color)
 * @return {string|null} the common colour of the selection; null while it differs (or none)
 */
function colorOf(key) {
	if ((props.selection.mixed ?? []).includes(SELECTION_FIELDS[key])) {
		return null
	}
	return parseHex(props.selection[key])
}

/** (Job 227) The font size row offers the note sizes S, M and L (only notes selected). */
const noteSizeRow = computed(() => {
	const sizes = sections.value.fontSize?.sizes ?? []
	return sizes.length === NOTE_SIZES.length && sizes.every((s, i) => s === NOTE_SIZES[i])
})

/**
 * @param {number} size a font size of the row
 * @return {string|null} (job 227) its letter S, M or L in the row of note sizes, else null (the number shows)
 */
function noteSizeLetter(size) {
	return noteSizeRow.value ? (['S', 'M', 'L'][NOTE_SIZES.indexOf(size)] ?? null) : null
}

/**
 * @param {number} size a font size of the row
 * @return {string|null} (job 227) its name (tooltip and label) in the row of note sizes, else null
 */
function noteSizeName(size) {
	if (!noteSizeRow.value) {
		return null
	}
	return [t('knorke', 'Small'), t('knorke', 'Medium'), t('knorke', 'Large')][NOTE_SIZES.indexOf(size)] ?? null
}

/**
 * @param {string} kind shape kind
 * @return {string} icon path
 */
function kindIcon(kind) {
	return KIND_ICONS[kind] ?? icons.shape
}

/**
 * @param {unknown} kind shape kind
 * @return {boolean} (job 201) a registry kind without an own icon: its button shows ShapePreview
 */
function previewKind(kind) {
	return typeof kind === 'string' && !Object.prototype.hasOwnProperty.call(KIND_ICONS, kind) && ENUMS.shapeKinds.includes(kind)
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
