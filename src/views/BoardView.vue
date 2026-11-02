<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div ref="boardEl"
		class="knorke-board"
		:class="{ 'knorke-board--guest': mode === 'guest', 'knorke-board--viewonly': uiMode !== 'edit', 'knorke-board--narrow': narrow, 'knorke-board--votebar': showSessionBar, 'knorke-board--sessionlines': showSessionBar && sessionLines, 'knorke-board--comments': commentsOpen && ready, 'knorke-board--presenting': !!slides, 'knorke-board--outline': outlineShown }"
		@pointerdown.capture="onPointerDown"
		@keydown.capture="onKeyDown">
		<div ref="host"
			class="knorke-canvas"
			tabindex="0"
			:inert="outlineShown || null"
			role="application"
			:aria-label="t('knorke', 'Canvas')" />
		<div v-if="startTiles" class="knorke-start" data-knorke="start-templates">
			<h2 class="knorke-start__title">
				{{ t('knorke', 'Start with a template') }}
			</h2>
			<TemplateGrid mode="start"
				:own="templateOwn"
				@insert="insertTemplate"
				@insert-own="insertOwnTemplate"
				@blank="startBlank" />
		</div>
		<CommentBubbles v-if="ready && comments.bubbles && openThreadCount > 0"
			:places="commentPlaces"
			:active="threadOpen ? threadOpen.id : null"
			@open="openBubble" />
		<SortLabels v-if="sortLabels && ready && uiMode === 'edit' && !frozen"
			ref="sortLabelsEl"
			:labels="sortLabels"
			:places="sortPlaces"
			@input="(i, v) => session && session.sortLabelText(i, v)"
			@name="(i, v) => session && session.nameSortBlock(i, v)"
			@end="() => session && session.endSortLabels()"
			@canvas="focusCanvasHost" />
		<ReactionPicker v-if="reactPicker && ready && !frozen"
			:key="reactPicker.id"
			:rect="reactPicker.rect"
			:mine="reactPicker.mine"
			@pick="pickReaction"
			@close="closeReactionPicker" />
		<ReactionNames v-if="reactNames && ready"
			:key="reactNames.kind + ':' + reactNames.id"
			:kind="reactNames.kind"
			:id="reactNames.id"
			:entries="reactNames.entries"
			:rect="reactNames.rect"
			:can-react="reactNames.canReact && !frozen"
			:hold="reactNames.hold"
			@react="(e) => session && session.react(reactNames.id, e)"
			@close="closeReactionNames" />
		<TagPanels v-if="ready" :view="tagView" @action="tagAction" />
		<PresentationLayer v-if="slides && ready"
			:state="slides"
			:rect="slideRect"
			@step="(d) => session && session.slideStep(d)"
			@to="(id) => session && session.slideTo(id)"
			@move="(id, to) => session && session.moveSlide(id, to)"
			@end="endSlides"
			@look-around="() => session && session.lookAround()"
			@insets="(x) => session && session.setSlideInsets(x)" />
		<ContextMenu v-if="menu && ready && uiMode === 'edit' && !frozen"
			:menu="menu"
			:selection="selection"
			:host="host"
			:apple="apple"
			:template-right="templateRight"
			@action="menuAction"
			@close="menuClose" />
		<textarea ref="catcher"
			class="knorke-paste-catcher"
			data-knorke-paste-catcher
			aria-hidden="true"
			tabindex="-1" />
		<input ref="boardFileEl"
			type="file"
			class="knorke-board-file"
			data-knorke-board-file
			aria-hidden="true"
			tabindex="-1"
			@change="onBoardFile">
		<input ref="bpmnFileEl"
			type="file"
			class="knorke-board-file"
			data-knorke-bpmn-file
			aria-hidden="true"
			tabindex="-1"
			@change="onBpmnFile">
		<input ref="csvFileEl"
			type="file"
			class="knorke-board-file"
			data-knorke-csv-file
			aria-hidden="true"
			tabindex="-1"
			@change="onCsvFile">
		<TopBar ref="topBar"
			:title="boardTitle"
			:is-owner="isOwner"
			:is-guest="mode === 'guest'"
			:mod="isMod"
			:can-moderate="canModerate"
			:can-go-back="mode === 'user'"
			:participants="participants"
			:following="followState.following ? followState.following.pid : null"
			:timer="timerMeta"
			:narrow="narrow"
			:mid="mid"
			:vote-open="!!(votes && votes.open)"
			:private-on="!!privateMeta"
			:presenting="presenting"
			:summon-active="summonActive"
			:can-present="hasFrames"
			:max-title="limits.maxTitle || 200"
			:legal="legal"
			:link-badge="linkBadge"
			:link-info-open="privacyCard !== null && privacyCard.kind === badgeKind"
			:link-info-id="privacyCardId"
			:has-tags="tagView.tags.length !== 0"
			:template-right="templateRight"
			:edit="canInsert"
			:ready="ready"
			:can-edit="mayEdit"
			@board-action="boardAction"
			@link-info="toggleLinkInfo"
			@back="$emit('back')"
			@rename="rename"
			@share="openShare"
			@timer-open="openTimer"
			@vote-setup="openSetup"
			@private-setup="openPrivate"
			@private-reveal="revealPrivate"
			@summon="moderate((s) => s.summon())"
			@summon-end="moderate((s) => s.endSummon())"
			@present="startSlides"
			@menu-open="readHasFrames"
			@vote-end="askVoteEnd"
			@timer-end="timerAction('stop')"
			@follow="onFollowParticipant"
			:comments-open="commentsOpen"
			:search-open="searchOpen"
			:apple="apple"
			:view="outlineShown ? 'outline' : 'board'"
			@comments="toggleComments"
			@search="toggleSearch"
			@view="(e) => setView(e)" />
		<OutlineView v-if="outlineShown"
			ref="outlineEl"
			:source="outlineSource"
			:rev="outlineRev"
			:top="outlineTop"
			:title="boardTitle"
			:narrow="narrow"
			@jump="outlineJump"
			@close="() => setView('escape')" />
		<SearchPanel v-if="searchOpen && ready"
			ref="searchEl"
			:source="searchSource"
			:rev="searchRev"
			:narrow="narrow"
			@jump="searchJump"
			@current="(h) => session && session.setSearchHit(h ? (h.kind === 'comment' ? h.item : h.id) : null)"
			@close="closeSearch" />
		<Toolbar v-if="ready && uiMode === 'edit' && !frozen"
			:active="tool"
			:options="toolOptions"
			:apple="apple"
			:shapes-open="shapesOpen"
			:shapes-id="shapesId"
			:ai="!!(aiView && aiView.available)"
			:ai-busy="!!((aiView && aiView.working) || (aiDiagram && aiDiagram.working))"
			@ai="openAiDiagram"
			@tool="pickTool"
			@options="(tl, o, e) => act(e ?? null, (s) => s.setToolOptions(tl, o))"
			@shapes="toggleShapes"
			@refocus="(e) => refocusAfter(e, session)" />
		<UndoBar v-if="ready && uiMode === 'edit' && !frozen"
			:can-undo="undoState.canUndo"
			:can-redo="undoState.canRedo"
			:apple="apple"
			@undo="(e) => act(e, (s) => s.undo())"
			@redo="(e) => act(e, (s) => s.redo())" />
		<ShapesPanel v-if="shapesOpen && ready && uiMode === 'edit' && !frozen"
			:id="shapesId"
			:autofocus="shapesFocus"
			:start="shapesStart"
			:account="mode === 'user'"
			@arm="armShape"
			@place="placeShape"
			@close="closeShapes" />
		<div ref="stackEl" class="knorke-topstack">
			<div ref="bannersEl" class="knorke-banners" data-knorke-chrome aria-live="polite">
				<ConnectionBanner :status="status"
					:reason="statusReason"
					:role-banner="roleBanner"
					:show-status="notice === 'status'"
					:show-role="notice === 'role'"
					@close="closeNotice" />
				<FollowBanner v-if="notice === 'follow'"
					:following="followState.following"
					@stop="stopFollowing"
					@close="closeNotice" />
				<FollowChip v-if="notice === 'chip'"
					:chip="followState.chip"
					@follow="followPresenter"
					@close="closeNotice" />
				<div v-if="notice === 'time_up'"
					class="knorke-banner knorke-banner--time_up"
					data-knorke-banner="time_up"
					data-knorke-bar="banner"
					role="status">
					<span class="knorke-banner__text">{{ t('knorke', 'Time\'s up') }}</span>
					<NoticeClose @close="closeNotice" />
				</div>
				<div v-if="notice === 'comment'"
					class="knorke-banner knorke-banner--comment"
					data-knorke-banner="comment-place"
					data-knorke-bar="banner"
					role="status">
					<span class="knorke-banner__text">{{ t('knorke', 'Click or tap an item or a spot for your comment.') }}</span>
					<button type="button"
						class="knorke-banner__action"
						data-knorke-action="comment-pick-cancel"
						@click="cancelCommentPick">
						{{ t('knorke', 'Cancel') }}
					</button>
				</div>
				<TagFilterChip v-if="notice === 'tags'"
					:names="filterNames(tagView.tags, tagView.filter)"
					@open="() => session && session.openTagFilter()"
					@clear="closeNotice" />
				<PrivacyInfo v-if="privacyCard"
					:id="privacyCardId"
					ref="privacyInfo"
					:kind="privacyCard.kind"
					:privacy="privacy"
					:vote="me !== null && me.role === 'vote'"
					@close="closePrivacy" />
			</div>
			<ContextBar v-if="ready && uiMode === 'edit' && !frozen && (selection.count > 0 || selection.lockedOffer > 0)"
				ref="contextBar"
				:selection="selection"
				:at="selBox"
				:room="room"
				:apple="apple"
				@away="focusCanvasHost"
				@style="(p, v, e) => act(e, (s) => s.setStyle(p, v))"
				@mindmap="(w, v, e) => act(e, (s) => s.mindmapStyle(w, v))"
				@kind="(k, e) => act(e, (s) => s.setShapeKind(k))"
				@swap-direction="(e) => act(e, (s) => s.swapDirection())"
				@flow="(f, e) => act(e, (s) => s.setFlow(f))"
				@arrange="(b) => session && session.arrange(b)"
				@align="(edge, e) => act(e, (s) => s.align(edge))"
				@distribute="(axis, e) => act(e, (s) => s.distribute(axis))"
				@tidy="(e) => act(e, (s) => s.tidy())"
				@sort-colors="(e) => sortAct(e, (s) => s.sortByColor())"
				@sort-frame="(e) => sortAct(e, (s) => s.sortFrameByColor())"
				@ai-summarise="() => session?.aiSummarise()"
				@ai-cluster="() => session?.aiCluster()"
				@copy="(e) => act(e, (s) => s.copy())"
				@cut="(e) => act(e, (s) => s.cut())"
				@duplicate="(e) => act(e, (s) => s.duplicate())"
				@reorder="(w, e) => act(e, (s) => s.reorder(w))"
				@delete="(e) => act(e, (s) => s.deleteSelection())"
				@connect="connect"
				@group="(e) => groupAct(e, (s) => s.groupSelection())"
				@ungroup="(e) => groupAct(e, (s) => s.ungroupSelection())"
				@frame-around="(e) => frameAct(e)"
				@lock="() => lockAct((s) => s.lockSelection())"
				@unlock="() => lockAct((s) => s.unlockSelection())"
				@filter="(k) => lockAct((s) => s.filterSelection(k))"
				@filter-tag="(id) => lockAct((s) => s.filterSelectionByTag(id))"
				@select-locked="() => lockAct((s) => s.selectLockedOffer())"
				@label="() => session && session.editLabel()"
				@format="(w) => session && session.formatText(w)"
				@open-link="(href) => openLink(href)"
				@rename="() => session && session.renameFrame()"
				@react="reactFromBar"
				@comment="commentFromBar"
				@tags="tagsFromBar" />
		</div>
		<ZoomControls v-if="ready"
			ref="zoomControls"
			:percent="zoom"
			:frames="frameList"
			:has-selection="selection.count > 0"
			:apple="apple"
			@frames="readFrames"
			@zoom-to="(id) => act(null, (s) => s.zoomToItem(id))"
			@zoom-selection="(e) => act(e, (s) => s.zoomToSelection())"
			@zoom-in="(e) => act(e, (s) => s.zoomIn())"
			@zoom-out="(e) => act(e, (s) => s.zoomOut())"
			@zoom-fit="(e) => act(e, (s) => s.zoomFit())"
			@zoom-100="(e) => act(e, (s) => s.zoom100())"
			@shortcuts="(e) => openShortcuts(isPointerActivation(e) ? 'pointer' : 'button')" />
		<TouchTip v-if="touchTip && ready && uiMode === 'edit' && !frozen"
			@close="dismissTouchTip" />
		<SessionBar v-if="showSessionBar"
			:private-writing="privateBar"
			:votes="votes && votes.state ? votes : null"
			:timer="timerMeta"
			:now="nowTick"
			:narrow="narrow"
			:mod="canModerate"
			:presenting="presenting"
			:panel-open="panelOpen"
			:busy="modBusy"
			@mode="(v, e) => act(e, (s) => s.setPreferVote(v))"
			@panel="togglePanel"
			@end="askVoteEnd"
			@extend="moderate((s) => s.updateVote('extend', 5))"
			@live="(v) => session && session.setLiveShown(v)"
			@live-note="showLiveNote"
			@signin="signIn"
			@accounts-note="showAccountsNote"
			@vote-edit="openVoteEdit"
			@timer-open="openTimer"
			@timer-end="timerAction('stop')"
			@present-end="endPresenting"
			@private-reveal="revealPrivate"
			@compact="(on) => { sessionLines = on }" />
		<ConfirmDialog v-if="voteEndAsk"
			:name="t('knorke', 'End voting now? Votes can\'t be changed afterwards.')"
			:confirm-label="t('knorke', 'End voting')"
			danger
			data-knorke-dialog="vote-end"
			@confirm="endVote"
			@cancel="voteEndAsk = false" />
		<VotePanel v-if="panelOpen && votes && votes.state"
			:votes="votes"
			:items="panelItems"
			:lookup="lookupItem"
			:narrow="narrow"
			:busy="modBusy"
			@vote="(id, n) => session && session.vote(id, n)"
			@focus="focusItem"
			@show="moderate((s) => s.updateVote('show'))"
			@hide="moderate((s) => s.updateVote('hide'))"
			@clear="clearResults"
			@copy="copyResults"
			@close="closePanel" />
		<CommentsPanel v-if="commentsOpen && ready"
			ref="commentsPanel"
			:threads="comments.threads"
			:loaded="comments.loaded"
			:can-write="comments.mayWrite"
			:bubbles="comments.bubbles"
			:sheet="narrow"
			:initial-tab="commentsTab"
			:now="nowTick"
			@tab="(x) => { commentsTab = x }"
			@close="closeComments"
			@new="newComment"
			@open="openFromList"
			@bubbles="(v) => session && session.setBubbles(v)">
			<template v-if="threadOpen && threadOpen.inPanel && openThread" #thread>
				<CommentThread ref="threadEl"
					:thread="openThread"
					in-panel
					:can-write="comments.mayWrite"
					:can-reply="comments.mayWrite && !openThread.resolved"
					:can-moderate="comments.mod"
					:search="mentionSearch"
					:draft="draftOf(openThread.id)"
					:busy="commentBusy"
					:now="nowTick"
					:autofocus="false"
					@close="closeThread"
					@send="threadSend"
					@edit="threadEdit"
					@delete="threadDelete"
					@resolve="threadResolve"
					@draft="(d) => saveDraft(openThread.id, d)" />
			</template>
		</CommentsPanel>
		<CommentThread v-if="ready && threadOpen && !threadOpen.inPanel && (threadOpen.id === null || openThread)"
			ref="threadEl"
			:key="threadOpen.id ?? 'new'"
			:thread="threadOpen.id === null ? null : openThread"
			:anchor="threadPos"
			:bounds="boardSize"
			:sheet="narrow"
			:can-write="comments.mayWrite"
			:can-reply="comments.mayWrite && (threadOpen.id === null || !openThread.resolved)"
			:can-moderate="comments.mod"
			:search="mentionSearch"
			:draft="draftOf(threadOpen.id ?? 'new')"
			:busy="commentBusy"
			:now="nowTick"
			@close="closeThread"
			@send="threadSend"
			@edit="threadEdit"
			@delete="threadDelete"
			@resolve="threadResolve"
			@draft="(d) => saveDraft(threadOpen.id ?? 'new', d)" />
		<ConfirmDialog v-if="commentDeleteAsk"
			:name="t('knorke', 'Delete this thread and all its replies?')"
			:confirm-label="t('knorke', 'Delete')"
			danger
			data-knorke-dialog="comment-delete"
			@confirm="confirmThreadDelete"
			@cancel="commentDeleteAsk = null" />
		<VoteStepper v-if="stepper && votes && votes.open && votes.canVote && uiMode === 'vote' && !frozen"
			:id="stepper.id"
			:rect="stepper.rect"
			:mine="(votes.mine && votes.mine[stepper.id]) || 0"
			:per-item="votes.perItem"
			:left="votes.left || 0"
			:text="session ? session.textOf(stepper.id) : ''"
			@set="(n) => session && session.vote(stepper.id, n)"
			@close="closeStepper" />
		<div v-if="!ready && !openError && !openFinal" class="knorke-board__loading">
			<NcLoadingIcon :size="44" :name="t('knorke', 'Loading board …')" />
		</div>
		<NcEmptyContent v-if="openError"
			class="knorke-board__error"
			:name="t('knorke', 'Could not open the board')"
			:description="openError">
			<template #action>
				<NcButton variant="primary" @click="reload">
					{{ t('knorke', 'Try again') }}
				</NcButton>
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-if="openFinal"
			class="knorke-board__error"
			data-knorke-empty="board-final"
			:name="t('knorke', 'Could not open the board')">
			<template v-if="openFinal.back" #action>
				<NcButton variant="primary"
					data-knorke-action="back-to-list"
					@click="$emit('back')">
					{{ t('knorke', 'Back to all boards') }}
				</NcButton>
			</template>
		</NcEmptyContent>
		<ShareDialog v-if="shareOpen && board"
			:board-id="board.id"
			:owner="isOwner"
			:mod="isMod"
			:title="boardTitle"
			:links="board.links || null"
			:links-allowed="board.linksAllowed === false ? false : null"
			:link-policy="board.linkPolicy || null"
			:ai="aiView"
			:ai-busy="aiBusy"
			@ai-allow="allowAi"
			@links="mergeBoard"
			@close="shareOpen = false" />
		<VoteSetupDialog v-if="setupOpen && canModerate"
			:frame="setupFrame"
			:count="(cfg) => (session ? session.votableCount(cfg) : 0)"
			:busy="modBusy"
			:error="setupError"
			@start="startVote"
			@close="setupOpen = false" />
		<VoteSetupDialog v-if="voteEditOpen && canModerate && votes && votes.open"
			:running="votes"
			:busy="modBusy"
			@extend="extendVote"
			@close="voteEditOpen = false" />
		<ShortcutsDialog v-if="shortcuts"
			:mode="frozen ? 'view' : uiMode"
			:apple="apple"
			:touch="shortcuts.touch"
			@close="closeShortcuts" />
		<TemplateDialog v-if="templatesOpen && canInsert"
			:own="templateOwn"
			@insert="insertTemplate"
			@insert-own="insertOwnTemplate"
			@withdraw="askWithdraw"
			@close="closeTemplates" />
		<TemplateEditDialog v-if="templateSave && templateRight"
			:draft="templateSave"
			:right="templateRight"
			@saved="templateSaved"
			@close="closeTemplateSave" />
		<PdfExportDialog v-if="pdfExport"
			:page="pdfExport.page"
			@save="savePdf"
			@close="closePdfExport" />
		<ConfirmDialog v-if="withdrawing"
			:name="t('knorke', 'Withdraw suggestion?')"
			:message="t('knorke', 'The admins will no longer see “{name}”.', { name: withdrawing.name })"
			:confirm-label="t('knorke', 'Withdraw')"
			:busy="withdrawBusy"
			danger
			data-knorke-dialog="template-withdraw"
			@confirm="withdraw"
			@cancel="closeWithdraw" />
		<PrivateWritingDialog v-if="privateDialog && canModerate"
			:frames="privateDialog.frames"
			:initial="privateDialog.initial"
			:busy="modBusy"
			@start="startPrivate"
			@close="privateDialog = null" />
		<TimerDialog v-if="timerOpen && canModerate"
			:timer="timerMeta"
			:now="nowTick"
			:busy="modBusy"
			:muted="muted"
			@action="timerAction"
			@mute="setMuted"
			@close="timerOpen = false" />
		<ConfirmDialog v-if="rescues.length > 0"
			:name="rescueInfo.name"
			:confirm-label="t('knorke', 'Close')"
			hide-cancel
			data-knorke-dialog="rescue"
			@confirm="closeRescues"
			@cancel="closeRescues">
			<!-- NcDialog shows its message only without slot content -->
			<p class="knorke-rescue__label">
				{{ rescueInfo.message }}
			</p>
			<textarea v-for="r in rescues"
				:key="r.key"
				class="knorke-rescue"
				readonly
				:value="r.text" />
		</ConfirmDialog>
		<ConfirmDialog v-if="aiAsk"
			:name="t('knorke', 'Use AI')"
			:confirm-label="t('knorke', 'Continue')"
			data-knorke-dialog="ai-notice"
			@confirm="answerAi(true)"
			@cancel="answerAi(false)">
			<!-- NcDialog shows its message only without slot content -->
			<p class="knorke-ai-notice">
				{{ aiAsk.text || aiBuiltInNotice() }}
			</p>
			<p v-if="aiAsk.url">
				<a :href="aiAsk.url"
					target="_blank"
					rel="noopener noreferrer"
					data-knorke-link="ai-notice">{{ t('knorke', 'More about the AI provider') }}</a>
			</p>
		</ConfirmDialog>
		<div v-if="aiView && aiView.working"
			class="knorke-ai-chip"
			role="status"
			data-knorke-ai="working">
			<span class="knorke-ai-chip__text">{{ t('knorke', 'AI is working…') }}</span>
			<NcButton variant="tertiary"
				data-knorke-action="ai-cancel"
				@click="session?.aiCancel()">
				{{ t('knorke', 'Cancel') }}
			</NcButton>
		</div>
		<AiDiagramDialog v-if="aiDiagram && aiDiagram.open"
			:view="aiDiagram"
			@run="(shape, prompt) => session?.aiDiagramRun(shape, prompt)"
			@insert="session?.aiDiagramInsert()"
			@close="session?.aiDiagramClose()" />
		<ConfirmDialog v-if="ask"
			:name="ask.name"
			:confirm-label="ask.confirmLabel"
			data-knorke-dialog="paste-notes"
			@confirm="answerAsk(true)"
			@cancel="answerAsk(false)" />
		<ConfirmDialog v-if="leaveOpen"
			:name="t('knorke', 'Some changes have not been saved yet. Leave anyway?')"
			:confirm-label="t('knorke', 'Leave')"
			:cancel-label="t('knorke', 'Stay')"
			danger
			data-knorke-dialog="leave"
			@confirm="answerLeave(true)"
			@cancel="answerLeave(false)" />
	</div>
</template>

<script setup>
/*
 * Board view (SPEC-M0 §6.6): hosts the canvas and mounts a BoardSession
 * (markRaw in a shallowRef, never in reactive data). Only small state is
 * reactive here: status, selection summary, participants, zoom %, tool,
 * undo/redo availability, board metadata.
 *
 * Leaving the board inside the app (Back, browser Back/Forward, T3): a
 * router leave guard first lets the session commit the open editor and wait
 * briefly for the server; whatever is still pending then (offline, failing)
 * would be lost with the session, so the user is asked: Stay or Leave.
 *
 * SPEC-M1 (stage 0):
 * - The board view is MERGED, never replaced (Befund F3): the session sends
 *   its merged view (live title from the meta channel); link changes made
 *   here go into the session first (mergeBoard), so a later meta update
 *   cannot bring an old link back. The edit link is `board.links.edit`.
 * - The own rename answer goes through the session's meta path.
 * - 'password_required' (guest, §6.4): the texts that would be lost go to the
 *   copy dialog first; closing it (or nothing to rescue) hands the guest over
 *   to PublicApp's name and password phase ('password-required').
 *
 * SPEC-M1 stage 1, round 1a:
 * - The canvas host is focusable (.knorke-canvas[tabindex="0"], §6.8): the
 *   scene's single keys work only while it has the focus. After a POINTER
 *   click on a toolbar, context bar or zoom button the focus goes back to
 *   it (components/focus.js); keyboard users keep the focus on the button.
 * - The paste catcher (textarea[data-knorke-paste-catcher], §6.5.3) lives
 *   here; the session focuses it on Ctrl/⌘+V and reads the paste event.
 * - Toolbar v2 (tools of TOOLS, shape kinds), ContextBar v2 (selection v2),
 *   the question before pasting more than 100 notes (ui.onConfirm).
 *
 * SPEC-M1 stage 1, round 1b (connectors):
 * - "Connect" (context bar, two bindable items selected) creates the
 *   connector and selects it; the button then disappears with the old
 *   selection, so the focus goes to the canvas after a pointer AND a
 *   keyboard activation (otherwise a keyboard user would land on <body>,
 *   where single keys do nothing).
 * - "Edit label" opens the scene's label editor, which takes the focus
 *   (no refocus of the canvas); (job 143) "Rename" a frame's title editor
 *   the same way (session.renameFrame).
 * - (M2, R20) Lock and Unlock of the context bar run lockSelection /
 *   unlockSelection; the button changes with the lock, so the canvas gets
 *   the focus after either activation (like "Connect").
 * - (M2, R20 Gruppieren) Group items and Ungroup run groupSelection /
 *   ungroupSelection: when ops went out the button changes (the canvas gets
 *   the focus after either activation, like Lock); a blocked one stays with
 *   its toast, and only a pointer click gives the canvas the focus back.
 *
 * SPEC-M1 stage 2 (sharing and roles):
 * - The client mode comes from the session (ui.onMode, board/mode.js
 *   modeFor): toolbar and context bar only in mode 'edit'; it follows a live
 *   role change. The one role/device banner next to the status banner is
 *   mode.js bannerFor(me.role, device, {votingEnabled: FEATURES.voting}).
 * - Share button and dialog for the owner and for moderators (me.mod, R13);
 *   moderators get the read-only "Links" tab. Losing the right closes an
 *   open dialog. Link changes in the dialog are merged into the session's
 *   board view (mergeBoard), never replacing it.
 * - Guests: the link password of the name dialog goes with the join.
 *
 * SPEC-M1 stage 3 (moderation, §6.6):
 * - SessionBar (job 233, at the bottom while a timer exists, a session is
 *   open or its results stand, or this tab presents; it holds the former
 *   VoteBar and TimerChip, "End" of the vote and the menu's "End voting"
 *   ask first, "Edit voting …" opens VoteSetupDialog with running; a
 *   focus left on a segment that went away moves to the canvas;
 *   formerly the VoteBar), VotePanel (opens once per sid when the session turns closed;
 *   in the narrow layout also at the start, as a bottom sheet),
 *   VoteSetupDialog, VoteStepper (perItem > 1), TimerChip/TimerDialog,
 *   FollowBanner/FollowChip, the moderation menu, participant buttons, the
 *   frame list. One display tick (timeout to the next full second of server
 *   time, session.clock) drives every countdown; never the scene's frames.
 * - Banner strips stand at the top under the TopBar in one stack with the
 *   context bar (no overlap); precedence from components/bars.js (job 228:
 *   one notice in every layout, closable through closeNotice). Narrow =
 *   matchMedia NARROW_QUERY (≤ 600 px), middle width MID_QUERY (≤ 900 px).
 * - "Time's up": banner until its × or 30 s, the memory per pair (seq,
 *   end); the end sound (util/sound.js, unlocked by the first pointerdown or
 *   key) unless muted. Wake lock while a session is open or a timer runs.
 * - The routes 22–26 are called once per click (never repeated); errors are
 *   toasted by the session, vote_config shows in the setup dialog.
 * - (Job 149) The bar's "Live count" goes to session.setLiveShown (this tab
 *   only); the narrow eye of the participants toasts "Moderators see live
 *   counts" ([data-knorke-toast=vote-live-note]).
 * - (Job 175) Accounts only: the narrow symbol toasts "Only signed-in
 *   accounts can vote." ([data-knorke-toast=vote-accounts-note]); "Sign in"
 *   of a guest kept from voting goes to signInUrl(linkToken) in this tab;
 *   the role banner gets voteBlocked, and the narrow vote list does not open
 *   at the start for that guest.
 *
 * Review round P7 (SPEC-M1 §33.1 i, R22):
 * - P7-08: the VoteStepper shows only in mode vote while this person may
 *   vote and the board is not frozen; the session closes it on a camera
 *   change and when its item goes (ui.onStepper(null)); the shell's close
 *   (×, Esc, a press elsewhere) tells the session. The VoteSetupDialog needs
 *   canModerate like the TimerDialog: losing the right closes it.
 * - P7-11: "Show on the board" (focusItem, components/voteLayout.js
 *   focusPlan): the narrow layout closes the bottom sheet first; the side
 *   panel's width stays free (zoomToItem(id, {left, right})).
 *
 * SPEC-M1 stage 4 (§6.6 ContextMenu.vue, R19 T4-02):
 * - The context menu is a sibling of .knorke-canvas (never inside the scene
 *   container), shown while the session reports one (ui.onContextMenu) in
 *   mode edit. Its entries run through session.menuAction; Esc, Tab and a
 *   click outside close it and give the canvas the focus back, window blur
 *   and resize only close it. (Job 230) Its groups are those of the context
 *   bar's "…"; its "Arrange…" opens the bar's panel "Arrange" (ui.onArrange).
 * - (Job 178) The TopBar's board menu "⋯" (every role and mode, frozen
 *   too): "Save as image (PNG)" runs session.exportPng('board'); the
 *   context menu's entry export-png saves the selection (session.menuAction).
 *   (Job 200) "Save as SVG" and "Save as PDF" run
 *   session.exportVector('board', 'svg'|'pdf'); the context menu's
 *   export-svg and export-pdf the selection. (Job 207) "Save as PDF…" runs
 *   session.openPdfExport('board'), the context menu's for the selection;
 *   its ui.onExportPdf({scope, page}) opens PdfExportDialog with the page;
 *   "Save" closes it and runs session.exportVector(scope, 'pdf', {page}),
 *   "Save" and Cancel/Esc give the canvas the focus back.
 *   (Job 217) The share dialog and the PDF dialog are lazy parts
 *   (util/parts.js): openShare and openPdfDialog open them once loaded, and
 *   the BPMN insert waits for its part (insertPicked awaits it).
 *   (Job 179) "Save as CSV" (only while canEdit(me.role), mayEdit) runs
 *   session.exportBoardCsv('board'); the context menu's export-csv the
 *   selection.
 *
 * M2 privacy notice (components/privacy.js, PrivacyInfo.vue):
 * - Accounts: the TopBar badge "Open by link" while linkOpen (board.links of
 *   owners and moderators, else the snapshot's board.linkOpenSince); a press
 *   opens or closes the info card (focus on its close button). The one-time
 *   info appears after the open and for every new linkOpenSince, never for
 *   the owner, without moving the focus, and is remembered when shown.
 * - Guests: the card once the board is ready when PublicApp says so
 *   (guestPrivacyInfo: a returning guest, once per tab session).
 * - A person with the role vote (voting link, vote share) gets the built-in
 *   text of the voting role (no cursor, anonymous votes).
 * - The card is the last child of .knorke-banners (the polite live region),
 *   no banner strip. Closing: back to the badge when it was opened there,
 *   else to the canvas host when the focus was inside the card. An
 *   automatic account card goes when the board is no longer open by link.
 *
 * Factory job 049 (final status on opening): when open() ends in a status of
 * statusOf (gone, revoked, links_disabled, link_expired, logged_out, reload,
 * …) the spinner goes and the empty state [data-knorke-empty=board-final]
 * "Could not open the board" shows, without a description and without the
 * board title; the reason stays in the status banner (hook, live region and
 * its actions as before). Accounts get "Back to all boards"
 * ([data-knorke-action=back-to-list], the TopBar's back path); guests none.
 * A 404 says "Your access through the link ended. Open the link again." only
 * when this tab's board list knew the board came through a link (prop
 * knownSource, components/banner.js finalOpenView). openFinal is set only
 * here: a status after a successful open keeps the frozen board and banner.
 *
 * Factory job 137 (context bar at the selection): the session hands the
 * scene's selection box to the bar (ui.onSelectionBox → prop at). In the
 * wide layout the view measures the bar's room (prop room, board px:
 * W × H, T under the TopBar and the visible banners, U above the visible
 * session bar, components/barPlace.js barLimits, and the top stack's offset)
 * with a ResizeObserver on the board, the TopBar, the banners and the
 * session bar (again when it comes or goes); narrow: room null. The
 * bar's away (hidden with the focus inside) gives the canvas the focus.
 *
 * Job 143 (frame titles): "Rename" in the bar runs session.renameFrame;
 * ui.viewTop (viewTop below) tells the session how far the top chrome and
 * the context bar of a new selection reach down, so a new frame's title
 * band comes into view below them before its editor opens. (Job 193)
 * ui.viewBottom (viewBottom below) how far the bars at the bottom reach
 * up, so a new note pad's title band stays above them. (Job 223)
 * ui.viewInsets (viewInsets below) how far the bars and an open side panel
 * ([data-knorke-chrome]) cover each edge of the canvas, so "Show
 * everything", "Zoom to selection" and the frame list keep clear of them.
 *
 * Factory job 139 (sort notes by colour): "Sort by color" (align panel) and
 * "Sort notes by color" (bar) run session.sortByColor / sortFrameByColor,
 * the menu entries sort-colors and sort-frame session.menuAction. The name
 * fields (SortLabels, a sibling of the canvas while the session reports
 * them, ui.onSortLabels) report typing, names and their end to the session.
 * Focus after sorting: a pointer activation gives it to the canvas, a
 * keyboard activation to the first name field.
 *
 * Factory job 142 (one-time tip about selecting with a finger): TouchTip
 * shows while the session reports it (ui.onTouchTip) in mode edit, ready and
 * not frozen; leaving edit (or a frozen board) ends it for good, the session
 * stored it as it appeared. Its OK tells the session (dismissTouchTip) and
 * gives the canvas the focus after a pointer AND a keyboard activation
 * (like "Connect": the button is gone).
 *
 * Factory job 144 (filter the selection): an entry of the bar's filter
 * panel runs session.filterSelection(kind) through lockAct, so the canvas
 * gets the focus after a pointer AND a keyboard activation (the panel is
 * gone); the menu entries only-<kind> run through session.menuAction.
 *
 * Factory job 190 (locked items by marquee): the context bar shows also
 * without a selection while selection v2 lockedOffer > 0 (then only "Select
 * n locked items"); that button runs session.selectLockedOffer through
 * lockAct (the canvas gets the focus, like after Lock).
 *
 * Factory job 172 (emoji reactions): the session's reaction picker
 * (ReactionPicker, ui.onReactionPicker) and the names or list of a note's
 * reactions (ReactionNames, ui.onReactionNames) are siblings of the canvas.
 * The picker shows while the board is not frozen; a choice runs
 * session.pickReaction, its own close session.closeReactionPicker, both
 * give the canvas the focus. "Add reaction" of the context bar opens it
 * below the button (session.reactFromBar). An entry of the list runs
 * session.react; the names and the list stay on a frozen board, without
 * action.
 *
 * Factory job 145 (shortcuts overview): the key ? on the canvas (the
 * session's ui.onShortcuts), "Keyboard shortcuts" of the zoom menu (job 229:
 * the round "?" button is gone) and of "More" (job 228) open
 * ShortcutsDialog once (again while open: nothing), in every mode and while
 * frozen; its list follows the mode live (frozen: 'view'), the gestures come
 * first when the device has a touch screen at the opening (job 161,
 * util/device.js hasTouchScreen). Closing (Esc, ×, and since job 161 a
 * second ? or a click beside the dialog) gives the focus to the canvas after
 * the key or a pointer, back to the zoom menu's trigger after a keyboard
 * activation of its entry.
 *
 * Factory job 180 (templates): TemplateDialog opens from the board menu's
 * "Insert template…" (TopBar prop edit), the context menu's entry
 * insert-template (the session's ui.onTemplates) and the button "Start with
 * a template" ([data-knorke-action=start-template], in the middle of the
 * canvas while the session reports an empty board, ui.onEmpty). All three
 * need canInsert (ready, mode edit, not frozen); losing it closes the
 * dialog without inserting. A tile (job 237: its "Insert") closes the
 * dialog and, once it is gone (its focus trap would take the focus back),
 * runs session.insertTemplate, which gives the canvas the focus; closing
 * without a tile gives it the focus too.
 *
 * Factory job 232 (redesign, docs/redesign/ V12): instead of that button an
 * empty board shows the template tiles themselves ([data-knorke=start-templates],
 * TemplateGrid mode start: the built-in ones, the adopted ones of route 28,
 * "Blank" last) in the middle of the canvas, while canInsert holds and the
 * session reports an empty board. Native buttons in the tab order after the
 * canvas, no focus taken; their layer lets the pointer through to the
 * canvas, only the tiles take it. They show only with the tools Select and
 * Pan: a creating tool (note, table, …) hides them, so its click in the
 * middle of the board creates its item instead of a template. A tile inserts like the dialog's; "Blank"
 * hides them for this visit and focuses the canvas. A board created by "New
 * board" with a template (components/boardList.js takeStart, read once in
 * setup) shows no tiles until the session first reports whether it is empty
 * and may insert: empty, the template goes in (as from a tile); not empty,
 * the pick is dropped.
 *
 * Factory job 181 (board as a file): the board menu's "Download board" runs
 * session.exportBoardFile. "Insert board file…" (canInsert) calls click()
 * on the hidden file field input[data-knorke-board-file] (no accept
 * filter) synchronously in the menu entry's click, no await before it: the
 * browser opens the picker only inside that user gesture. A picked file
 * over BOARD_FILE_MAX_BYTES goes to session.insertBoardFile as null
 * (invalid, never read), any other file as its text; the field is emptied
 * afterwards, so the same file can be picked again. Cancelling the picker
 * does nothing. A file that is not inserted gives the canvas the focus.
 *
 * Factory job 205 (BPMN files): the board menu's "Save as BPMN" runs
 * session.exportBpmn('board'); "Insert BPMN file…" (canInsert) works like
 * "Insert board file…" with its own hidden field input[data-knorke-bpmn-file]
 * (no accept filter either: Android greys out extensions it does not know),
 * BPMN_FILE_MAX_BYTES and session.insertBpmnFile.
 *
 * Factory job 220 (CSV files): "Import CSV…" (canInsert) works the same way
 * with input[data-knorke-csv-file] (no accept filter), CSV_FILE_MAX_BYTES
 * and session.insertCsvFile, which gets the file's bytes (the session finds
 * the encoding), not its text.
 *
 * Factory job 182 (template suggestions): for accounts (mode user) route 28
 * loads when the board opens and every time the template dialog opens (not
 * again once it answered right null, an account of the Guests app); the
 * newest answer wins. Its right ('suggest' | 'save') goes to the top bar
 * and the context menu as templateRight (save-template; null before the
 * first answer, after an error and on the guest page). The board menu's
 * save-template takes session.templateDraft('board'), the context menu's
 * the session's draft of the selection (ui.onSaveTemplate); a draft opens
 * TemplateEditDialog with the right. Saved: the info template-suggested
 * (a suggestion) or template-saved (adopted at once), the canvas gets the
 * focus; Cancel and Esc give it the focus too. The template dialog gets
 * own {state, templates, pending} (null without a right: nothing loads).
 * An adopted tile closes the dialog, loads route 30 and runs
 * session.insertOwnTemplate (a 404 or a network error: the toast
 * template-load-failed). A withdraw button replaces the dialog by a
 * ConfirmDialog with danger ([data-knorke-dialog=template-withdraw]);
 * confirmed, route 32 withdraws the suggestion (gone already counts as
 * withdrawn, any other error: the toast template-withdraw-failed); either
 * way the template dialog comes back with a fresh list (while canInsert
 * holds, else the canvas gets the focus).
 *
 * Factory job 189 (comments, board/comments.js): the session's
 * ui.onComments (commentsView) drives the TopBar's "Comments" (toggles
 * CommentsPanel, which excludes the vote list both ways), CommentBubbles (a
 * sibling of the canvas while "Show bubbles" is on and a thread is open),
 * CommentThread (a popover at its bubble that follows it every frame; in
 * the panel for a resolved thread; full screen in the narrow layout) and the
 * strip [data-knorke-banner=comment-place] with "Cancel" while "New
 * comment" waits for its click or tap (Esc ends it too); the panel closes
 * when it would cover that strip (always on phones). An entry of the
 * list pans its open thread into the part of the canvas the panel leaves
 * free (session.centerOn; narrow: the panel closes first) and opens it; a
 * resolved one opens in the panel. (Job 233) A bubble (right of its item)
 * opens the panel with its thread inside. The first comment's "Delete" asks with
 * danger ([data-knorke-dialog=comment-delete]), a reply goes at once.
 * Unsent text stays per thread (and for a new one) until the page is left.
 * "Comment" of the context bar and the menu (prop canComment) go to the
 * session (commentOn, menuAction). ?comment=<thread> of the address opens
 * that thread once the comments loaded, like the list, and leaves the
 * address.
 *
 * Job 191 (tags): TagPanels (the session's tagsView, ui.onTags) shows the
 * tag panel, the filter panel and the list of "+n"; its events go to
 * session.tagAction. "Tags" of the context bar opens the tag panel below
 * the button, "Filter by tags…" of the board menu the filter panel; while
 * the filter is on, TagFilterChip ([data-knorke-tag-filter]) stands in the
 * banner stack.
 *
 * Job 201 (shapes panel): ShapesPanel shows only while the tool bar is
 * there. Job 229: the tool bar's shape tool opens it with the tool and
 * closes it (toggleShapes); the key S opens it too (the session's onTool,
 * the canvas keeps the focus); another tool of the bar closes it (pickTool),
 * and closing it while the shape tool is still chosen goes back to select
 * (not after a tile armed it: then the next click or drag puts that shape).
 * Opened from the keyboard on the shape tool, its search gets the focus. Its arm(kind) sets the shape tool's kind
 * (setToolOptions), its place(kind, client point | null) puts the shape
 * through session.placeShape at that point of the canvas (null: the
 * middle of the view). (Job 204) The pool entry (shapeLibs.js POOL_KIND)
 * arms the frame tool with "Swimlanes" and is put through
 * session.placeLanes. Close and Esc give the focus back to the shape tool.
 * The panel starts SHAPES_GAP beyond the tool bar as drawn (measureShapes on
 * opening and with measureRoom), so it covers none of its buttons. Undo and
 * redo stand in their own island (UndoBar, job 229), shown with the tool bar.
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { SceneModel } from '../model/SceneModel.js'
import { SceneManager } from '../scene/index.js'
import { isSearchKey } from '../scene/InputController.js'
import { nextView } from '../board/viewSwitch.js'
import * as aiApi from '../api/ai.js'
import * as boardsApi from '../api/boards.js'
import * as templatesApi from '../api/templates.js'
import { BoardSession, FROZEN_STATUSES } from '../board/BoardSession.js'
import { BOARD_FILE_MAX_BYTES, BPMN_FILE_MAX_BYTES, CSV_FILE_MAX_BYTES } from '../board/boardFile.js'
import { installDebug } from '../board/debug.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { isLinksDisabled } from '../components/join.js'
import { lockoutText } from '../components/share.js'
import { addRescue, rescueDialog } from '../components/rescue.js'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import ContextBar from '../components/ContextBar.vue'
import ContextMenu from '../components/ContextMenu.vue'
import CommentBubbles from '../components/CommentBubbles.vue'
import CommentThread from '../components/CommentThread.vue'
import CommentsPanel from '../components/CommentsPanel.vue'
import NoticeClose from '../components/NoticeClose.vue'
import PrivacyInfo from '../components/PrivacyInfo.vue'
import ReactionNames from '../components/ReactionNames.vue'
import ReactionPicker from '../components/ReactionPicker.vue'
import { accountInfoDue, aiNoticeText, linkOpen, markAccountSeen } from '../components/privacy.js'
import FollowBanner from '../components/FollowBanner.vue'
import PresentationLayer from '../components/PresentationLayer.vue'
import FollowChip from '../components/FollowChip.vue'
import SortLabels from '../components/SortLabels.vue'
import ShapesPanel from '../components/ShapesPanel.vue'
import { POOL_KIND } from '../components/shapeLibs.js'
import TagFilterChip from '../components/TagFilterChip.vue'
import TagPanels from '../components/TagPanels.vue'
import { filterNames } from '../components/tags.js'
import Toolbar from '../components/Toolbar.vue'
import UndoBar from '../components/UndoBar.vue'
import TopBar from '../components/TopBar.vue'
import TemplateDialog from '../components/TemplateDialog.vue'
import TemplateGrid from '../components/TemplateGrid.vue'
import TemplateEditDialog from '../components/TemplateEditDialog.vue'
import TouchTip from '../components/TouchTip.vue'
import SessionBar from '../components/SessionBar.vue'
import VotePanel from '../components/VotePanel.vue'
import VoteStepper from '../components/VoteStepper.vue'
import ZoomControls from '../components/ZoomControls.vue'
import { finalOpenView, bannerFor as statusBannerFor } from '../components/banner.js'
import { EDGE, GAP, barLimits } from '../components/barPlace.js'
import { MID_QUERY, NARROW_QUERY, chromeInsets, noticeOf, pruneDismissed, resultsText } from '../components/bars.js'
import { takeStart } from '../components/boardList.js'
import { focusPlan } from '../components/voteLayout.js'
import { rectsOverlap, tabCounts } from '../board/comments.js'
import { copyText } from '../components/copyText.js'
import { nextTickMs, timeUpShown, timerKey, timerOf } from '../components/countdown.js'
import { summonOf } from '../board/follow.js'
import { privateOf } from '../model/privateWriting.js'
import { createSound } from '../util/sound.js'
import { createWakeLock } from '../util/wakelock.js'
import { isPointerActivation, notePointerDown, refocusAfter } from '../components/focus.js'
import { addLeaveGuard } from '../router.js'
import { loadPart, partComponent } from '../util/parts.js'
import { canEdit, bannerFor as roleBannerFor } from '../board/mode.js'
import { HttpError, PASSWORD_LOCK } from '../sync/http.js'
import { hasTouchScreen, isApplePlatform, isViewOnlyDevice } from '../util/device.js'
import { FEATURES } from '../util/features.js'
import { signInUrl } from '../util/routes.js'
import { t } from '../util/l10n.js'
import { showError, showInfo } from '../util/toast.js'
import { webStorage } from '../util/storage.js'
import { openLink } from '../util/openLink.js'

const props = defineProps({
	mode: { type: String, default: 'user' },
	boardId: { type: Number, default: null },
	linkToken: { type: String, default: null },
	guestName: { type: String, default: null },
	/** link password of the guest name dialog (stage 2), only for this join */
	guestPassword: { type: String, default: null },
	debug: { type: Boolean, default: false },
	limits: { type: Object, default: () => ({}) },
	/** (U9) the instance's legal links (initial state `legal`): the guest page, since job 228 the account page too */
	legal: { type: Object, default: null },
	/** M2 privacy notice: initial state `privacy` ({text, url}) */
	privacy: { type: Object, default: null },
	/** M2: a returning guest (no name dialog) gets the info card once this tab session */
	guestPrivacyInfo: { type: Boolean, default: false },
	/** origin of the board in this tab's board list (own|share|link), null when unknown (factory job 049) */
	knownSource: { type: String, default: null },
})

const emit = defineEmits(['back', 'open-failed', 'opened', 'password-required'])

const host = ref(null)
const catcher = ref(null)
const session = shallowRef(null)
const ready = ref(false)
const openError = ref('')
/** null | {back: boolean}: opening the board ended in a final status (factory job 049). */
const openFinal = ref(null)
const status = ref('connecting')
const statusReason = ref(null)
const selection = ref({ ids: [], count: 0, types: new Set(), fields: [], mixed: [], fill: null, hasContainer: false, canConnect: false, box: null })
const toolOptions = ref({})
/** Open question of the session (paste many notes): {name, confirmLabel, resolve}. */
const ask = ref(null)
/** (job 267) the AI of the board (session ui.onAi), the open notice question {text, url, resolve}, the board switch being saved */
const aiView = ref(null)
const aiAsk = ref(null)
const aiBusy = ref(false)
/** (job 268) the window "Create with AI" (session ui.onAiDiagram), a lazy part */
const aiDiagram = ref(null)
const AiDiagramDialog = partComponent('aiDialog')
const participants = ref([])
const zoom = ref(100)
const tool = ref('select')
const undoState = ref({ canUndo: false, canRedo: false })
const board = ref(null)
const me = ref(null)
const shareOpen = ref(false)
/**
 * (Job 268) "Create with AI" of the tool bar: the window opens once its
 * part is loaded.
 */
async function openAiDiagram() {
	if (await loadPart('aiDialog')) session.value?.aiDiagramOpen()
}

/** (Job 217) The share dialog, a lazy part: opened by openShare once it is loaded. */
const ShareDialog = partComponent('share')
/** Stage 3: what the session says about the vote (votesView) and following. */
const votes = ref(null)
const followState = ref({ following: null, chip: null })
const panelOpen = ref(false)
const panelItems = ref([])
const setupOpen = ref(false)
const setupFrame = ref(null)
const setupError = ref('')
const timerOpen = ref(false)
/** (job 275) the start dialog of private writing: {frames, initial} while open, else null */
const privateDialog = ref(null)
/** (Job 233) "End voting" of the session bar or the menu asks first */
const voteEndAsk = ref(false)
/** (Job 233) "Edit voting …" of the session bar */
const voteEditOpen = ref(false)
/** (Job 233, round 3) The session bar fell back to its two lines (wide layout): the board gives it their height */
const sessionLines = ref(false)
/** A moderation call is running (buttons wait). */
const modBusy = ref(false)
/** {id, rect} of the open vote stepper */
const stepper = ref(null)
const frameList = ref([])
/** (Job 272) The presentation shown ({role, list, current, index, name}) or null; the shown frame's screen box. */
const slides = ref(null)
const slideRect = ref(null)
/** (Job 272) The board has a frame: "Present frames" (read when the moderation menu opens). */
const hasFrames = ref(false)
/** (Job 272) This tab asked for full screen when it started presenting. */
let slidesFullscreen = false
/** Server time of the display tick (countdowns). */
const nowTick = ref(Date.now())
/** Key (seq:end) of the "Time's up" banner the user clicked away. */
const dismissedTimeUp = ref(null)
const narrow = ref(false)
/** (Job 228) Middle width (601–900 px): the top bar's participants only as "+n". */
const mid = ref(false)
/** (Job 228) Keys of the notices this tab closed (bars.js pruneDismissed keeps those that still apply). */
const dismissedNotices = ref(new Set())
const sound = createSound()
const muted = ref(sound.muted())
const wakeLock = createWakeLock()
/** sids whose results opened the panel automatically (once per sid). */
const autoPanel = new Set()
let tickTimer = null
let narrowQuery = null
let midQuery = null
const rescues = ref([])
const leaveOpen = ref(false)
/** Open context menu of the session ({id, at, seq, items}) or null (stage 4). */
const menu = ref(null)
/** (Job 230) The context bar (its exposed openArrange). */
const contextBar = ref(null)
/** ⌘ hints and Meta+… shortcuts on Apple platforms (menu, tool bar, context bar, zoom controls; job 141). */
const apple = isApplePlatform()
/** The device has no fine pointer (fixed); the mode also follows the role. */
const deviceViewOnly = isViewOnlyDevice()
/** Client mode of the session (SPEC-M1 §6.5.4): 'edit' | 'vote' | 'view'. */
const uiMode = ref(deviceViewOnly ? 'view' : 'edit')
/** Job 137: the scene's selection box ({box, keep}, board px) or null. */
const selBox = shallowRef(null)
/** Job 137: the context bar's room in the wide layout ({W, H, T, U, ox, oy}, board px); null: narrow. */
const room = shallowRef(null)
/** Job 139: the open name fields of the session ([{i, color, x, y, w, h, parent}]) or null. */
const sortLabels = shallowRef(null)
/** Job 139: the SortLabels component (focusFirst). */
const sortLabelsEl = ref(null)
/** Job 142: the session shows the one-time tip about selecting with a finger. */
const touchTip = ref(false)
/** Job 145: the open shortcuts overview ({via: 'key'|'pointer'|'button', touch}) or null. */
const shortcuts = ref(null)
/** Job 145: the zoom controls (focusShortcuts). */
const zoomControls = ref(null)
/** Job 172: the session's reaction picker ({id, rect, mine}) or null. */
const reactPicker = shallowRef(null)
/** Job 172: the session's names or list of a note's reactions ({kind, id, rect, entries, canReact, hold}) or null. */
const reactNames = shallowRef(null)
/** Job 191: what the session says about the tags (tagsView). */
const tagView = shallowRef({ tags: [], mayEdit: false, edit: false, filter: [], busy: false, panel: null })
/** Job 189: what the session says about the comments (commentsView). */
const comments = shallowRef({ threads: [], loaded: false, mayWrite: false, mod: false, guest: false, bubbles: true, picking: false })
/** Job 201: the shapes panel is open; opened from the keyboard (its search takes the focus). */
const shapesOpen = ref(false)
const shapesFocus = ref(false)
/** Job 229: a tile armed the shape tool since the panel opened (closing then keeps the tool). */
let shapesArmed = false
const shapesId = 'knorke-shapes-' + (props.boardId ?? 'board')
/** Job 201: board px from the board's start edge to the shapes panel (beyond the tool bar); null: its CSS default. */
const shapesStart = ref(null)
/** Job 201: space between the tool bar and the shapes panel (--knorke-gap). */
const SHAPES_GAP = 8
/** Job 189: the comment panel is open, its tab. */
const commentsOpen = ref(false)
/**
 * (Job 271) Search on the board, a lazy part (components/SearchPanel.vue):
 * the magnifier of the top bar and Ctrl/⌘+F (the session's ui.onSearch)
 * open it, or focus its field when it is open; searchRev grows with every
 * change of the model (ui.onItems) or the comments, so it counts again.
 */
const SearchPanel = partComponent('search')
/** (Job 271) The shortcuts overview, a lazy part since job 271 (room in the main bundle for the search). */
const ShortcutsDialog = partComponent('shortcuts')
// (job 275) the moderators' dialogs are one lazy part (util/parts.js): each opens once loaded
const PrivateWritingDialog = partComponent('privateDialog')
const VoteSetupDialog = partComponent('voteDialog')
const TimerDialog = partComponent('timerDialog')
const searchOpen = ref(false)
const searchRev = ref(0)
const searchEl = ref(null)
/**
 * (Job 274) "Board | Outline" of the top bar (board/viewSwitch.js nextView):
 * the outline (components/OutlineView.vue, a lazy part) covers the board
 * while the canvas stays mounted (inert); outlineRev grows with every change
 * of the model, so it counts again. Only this tab's choice.
 */
const OutlineView = partComponent('outline')
const view = ref('board')
const outlineEl = ref(null)
const outlineRev = ref(0)
/** (Job 274, round 1) board px where the outline's page starts (measureOutlineTop); null: its CSS default */
const outlineTop = ref(null)
const outlineShown = computed(() => view.value === 'outline' && ready.value)
/** (Job 274) the item an outline jump framed (the next press on the canvas takes the frame away) */
let outlineHit = null
const commentsTab = ref('open')
const commentsPanel = ref(null)
/**
 * Job 189: the open thread – {id, inPanel} (a resolved thread opens in the panel), {id: null, place: {item, x, y}}
 * (the editor of a new thread at a place), or null.
 */
const threadOpen = shallowRef(null)
/** Job 189: board px of the open popover's bubble (follows the camera and the item). */
const threadPos = shallowRef(null)
const threadEl = ref(null)
/** Job 189: a comment call runs. */
const commentBusy = ref(false)
/** Job 189: the first comment whose deletion asks first ({id}) or null. */
const commentDeleteAsk = shallowRef(null)
/** Job 189: unsent text per thread ('new' for a new one) until the page is left. */
const commentDrafts = ref(new Map())
/** Job 189: board size for the popover. */
const boardSize = shallowRef(null)
/** Job 189: a thread id of the address (?comment=), opened once the comments loaded. */
let deepComment = readDeepComment()
let threadRaf = 0
/** Job 180: the session's model holds no item (ui.onEmpty); (job 232) null before its first report. */
const boardEmpty = ref(null)
/** Job 232: the template "New board" picked for this board (components/boardList.js takeStart), until inserted. */
const startPick = ref(takeStart(props.boardId))
/** Job 232: "Blank" of the start tiles was picked on this visit. */
const startDone = ref(false)
/** Job 180: the template dialog is open. */
const templatesOpen = ref(false)
/** Job 181: the hidden file field of "Insert board file…". */
const boardFileEl = ref(null)
/** Job 205: the hidden file field of "Insert BPMN file…". */
const bpmnFileEl = ref(null)
/** Job 220: the hidden file field of "Import CSV…". */
const csvFileEl = ref(null)
/**
 * Job 182: route 28 for this account – right ('suggest' | 'save' | null; undefined before the first answer and after
 * an error), the load state ('loading' | 'ready' | 'error'; null before the first load) and the two lists.
 */
const templateList = shallowRef({ right: undefined, state: null, templates: [], pending: [] })
/** Job 182: the draft of the suggest/save dialog (BoardSession.templateDraft) or null. */
const templateSave = shallowRef(null)
/** Job 207: the open "Save as PDF…" dialog ({scope, page} of ui.onExportPdf) or null. */
const pdfExport = shallowRef(null)
/** (Job 217) The PDF dialog, part of the lazy vector part: opened by openPdfDialog once it is loaded. */
const PdfExportDialog = partComponent('pdfDialog')
/** Job 182: the suggestion the withdraw question is about ({id, name}) or null. */
const withdrawing = shallowRef(null)
/** Job 182: route 32 of the withdraw question runs. */
const withdrawBusy = ref(false)
/** Job 182: the number of the newest load of route 28 (an older answer is dropped). */
let templateLoad = 0
/** Job 182: the right that brings save-template to the menus ('suggest' | 'save'), null without one. */
const templateRight = computed(() => props.mode === 'user' && (templateList.value.right === 'suggest' || templateList.value.right === 'save') ? templateList.value.right : null)
/** Job 182: what the template dialog shows of route 28; null on the guest page and without a right (nothing loads). */
const templateOwn = computed(() => {
	const l = templateList.value
	return props.mode !== 'user' || l.right === null || l.state === null ? null : { state: l.state, templates: l.templates, pending: l.pending }
})
const boardEl = ref(null)
const stackEl = ref(null)
const bannersEl = ref(null)
let roomObserver = null
/** Resolves the pending leave question (Stay → false, Leave → true). */
let leaveAnswer = null
let unguard = null
/** 'password_required' reached: hand over to PublicApp once the copy dialog is closed. */
let handoverPending = false
/** What the hand-over tells PublicApp ({lockText} after the password lock-out). */
let handoverInfo = {}

const isOwner = computed(() => props.mode === 'user' && board.value?.role === 'owner')
/** Job 189: the thread object of threadOpen (null for a new one or when it is gone). */
const openThread = computed(() => (threadOpen.value?.id ? comments.value.threads.find((x) => x.id === threadOpen.value.id) ?? null : null))
/** Job 189: open threads (the bubbles show only with one). */
const openThreadCount = computed(() => tabCounts(comments.value.threads).open)
/** Job 189: the @ list for accounts that may write (null for guests). */
const mentionSearch = computed(() => (props.mode === 'user' && comments.value.mayWrite ? (q) => session.value?.searchMentions(q) ?? Promise.resolve([]) : null))
/** Moderator who is not the owner (me.mod, R13): share button with the read-only links. */
const isMod = computed(() => props.mode === 'user' && !isOwner.value && me.value?.mod === true)
/** This client moderates (me.mod, owners included; stage 3 moderation menu). */
const canModerate = computed(() => props.mode === 'user' && me.value?.mod === true)
/** (Job 179) This person may edit the board (canEdit of me.role; guests with the edit link too): "Save as CSV". */
const mayEdit = computed(() => canEdit(me.value?.role))
/** The one role/device banner (SPEC-M1 §6.5.4, R13); none before the board is known. */
const roleBanner = computed(() => (me.value ? roleBannerFor(me.value.role, deviceViewOnly, { sessionOpen: !!votes.value?.open, votingEnabled: FEATURES.voting, voteBlocked: !!votes.value?.voteBlocked }) : null))
const timerMeta = computed(() => board.value?.meta?.timer ?? null)
const summon = computed(() => summonOf(board.value?.meta?.summon))
const summonActive = computed(() => summon.value !== null)
/** This tab presents (meta.summon = my pid and this tab's client id). */
const presenting = computed(() => summon.value !== null && summon.value.pid === me.value?.pid && summon.value.client === session.value?.client)
/** (Job 233) The session bar: while a timer exists, a vote is open or its results stand, or this tab presents. */
/** (job 275) meta.private (model/privateWriting.js privateOf) or null */
const privateMeta = computed(() => privateOf(board.value?.meta))
/** (job 275) the session bar's segment: {frameTitle} ('' for the whole board) */
const privateBar = computed(() => {
	const p = privateMeta.value
	if (!p) {
		return null
	}
	const f = p.frame ? (session.value?.frames() ?? []).find((x) => x.id === p.frame) : null
	return { frameTitle: f ? f.title : '' }
})
const showSessionBar = computed(() => ready.value && (!!votes.value?.state || timerOf(timerMeta.value) !== null || presenting.value || privateMeta.value !== null))
const timeUp = computed(() => timeUpShown(timerOf(timerMeta.value), nowTick.value, dismissedTimeUp.value))
/** (Job 228) What wants a notice under the TopBar (bars.js noticeCandidates). */
const noticeWants = computed(() => ({
	status: statusBannerFor(status.value, statusReason.value).kind,
	comment: !!comments.value.picking,
	follow: followState.value.following ? followState.value.following.pid : null,
	chip: followState.value.chip,
	timeUp: timeUp.value,
	tags: ready.value && tagView.value.filter.length !== 0,
	role: roleBanner.value,
	frozen: frozen.value,
}))
/** (Job 228, R16 (3)) The one notice under the TopBar, in every layout: precedence, closed ones wait. */
const notice = computed(() => noticeOf(noticeWants.value, dismissedNotices.value)?.kind ?? null)

/**
 * (Job 228) The close button of a notice: it stays away while it applies;
 * the focus goes to the canvas (the button is gone).
 */
function closeNotice() {
	const n = noticeOf(noticeWants.value, dismissedNotices.value)
	if (n?.kind === 'time_up') {
		dismissTimeUp()
	} else if (n?.kind === 'tags') {
		session.value?.setTagFilter([])
	} else if (n?.kind === 'comment') {
		cancelCommentPick()
	} else if (n?.key) {
		dismissedNotices.value = new Set([...dismissedNotices.value, n.key])
	}
	focusCanvasHost()
}

// a live role change took the right away: the dialog goes (R13)
watch(() => isOwner.value || isMod.value, (may) => {
	if (!may) {
		shareOpen.value = false
	}
})

/**
 * (Job 217) "Share" of the top bar: the dialog opens once its lazy part is
 * loaded, and only while the right still holds. Failing (the toast
 * part-load-failed), it stays closed; the next click tries again.
 */
async function openShare() {
	if (await loadPart('share')) {
		shareOpen.value = isOwner.value || isMod.value
	}
}
// R22 (P7-08, CLIENT-7): losing the moderation closes the vote setup for good
watch(canModerate, (may) => {
	if (!may) {
		setupOpen.value = false
		voteEditOpen.value = false
		voteEndAsk.value = false
	}
})
// (job 233) "Edit voting" and the question of "End" belong to the open session
watch(() => (votes.value?.open === true ? votes.value.sid : null), (sid, old) => {
	if (sid !== old) {
		voteEditOpen.value = false
		voteEndAsk.value = false
	}
})
const boardTitle = computed(() => board.value?.title ?? '')
const frozen = computed(() => FROZEN_STATUSES.includes(status.value))
// a closed notice that no longer applies comes back next time
watch(noticeWants, (o) => {
	const kept = pruneDismissed(dismissedNotices.value, o)
	if (kept.size !== dismissedNotices.value.size) {
		dismissedNotices.value = kept
	}
})
const rescueInfo = computed(() => rescueDialog(rescues.value))
/** Job 180: this person may insert a template now (the board menu entry, the button, the dialog). */
const canInsert = computed(() => ready.value && uiMode.value === 'edit' && !frozen.value)
// job 180: leaving edit (or a frozen board) closes the template dialog without inserting
watch(canInsert, (may) => {
	if (!may) {
		templatesOpen.value = false
	}
})
/**
 * Job 232: the start tiles over an empty board (not while the template of
 * "New board" waits, not after "Blank"); only with Select or Pan, so a
 * creating tool's click in the middle never lands on a tile.
 */
const startTiles = computed(() => canInsert.value && boardEmpty.value === true && !startPick.value && !startDone.value && (tool.value === 'select' || tool.value === 'hand'))
// job 232: the template of "New board", once the session may insert and has said whether the board is empty
watch([canInsert, boardEmpty], ([may, empty]) => {
	const p = startPick.value
	if (!p || !may || empty === null) {
		return
	}
	startPick.value = null
	if (empty !== true) {
		return
	}
	if (p.own) {
		insertOwnTemplate(p.own)
	} else {
		insertTemplate(p.key)
	}
})
// job 142: leaving edit (or a frozen board) ends the tip; it is stored already and never comes back
watch(() => uiMode.value === 'edit' && !frozen.value, (editing) => {
	if (!editing) {
		touchTip.value = false
	}
})

// ---- M2 privacy notice ----------------------------------------------------

const topBar = ref(null)
const privacyInfo = ref(null)
const privacyStorage = webStorage()
/** The info card: null | {kind: 'guest'|'account', viaBadge: boolean}. */
const privacyCard = ref(null)
const privacyCardId = 'knorke-privacy-info-' + (props.boardId ?? 'board')
/** The guest card of this view was shown (PublicApp keeps it to once per tab session). */
let guestCardShown = false
/** The board is open by link: the badge of accounts (guests have "Guest"). */
const linkBadge = computed(() => props.mode === 'user' && linkOpen(board.value, serverNow()))

/**
 * The account's one-time info: after the open and for every new
 * linkOpenSince (resync); never for the owner; shown without moving the
 * focus and remembered at once (components/privacy.js).
 */
function maybeAccountInfo() {
	if (props.mode !== 'user' || !ready.value || !linkBadge.value) {
		return
	}
	const o = { board: board.value, me: me.value, isOwner: isOwner.value }
	if (!accountInfoDue(o, privacyStorage)) {
		return
	}
	markAccountSeen(o, privacyStorage)
	if (privacyCard.value === null) {
		privacyCard.value = { kind: 'account', viaBadge: false }
	}
}
watch(() => [ready.value, board.value?.linkOpenSince ?? null, me.value?.pid ?? null, isOwner.value, linkBadge.value].join('|'), maybeAccountInfo)
// a returning guest: the card as soon as the board is ready (PublicApp decided it is due)
watch(ready, (r) => {
	if (r && props.mode === 'guest' && props.guestPrivacyInfo && !guestCardShown) {
		guestCardShown = true
		privacyCard.value = { kind: 'guest', viaBadge: false }
	}
})
// the automatic account card goes when the board is no longer open by link
watch(linkBadge, (open) => {
	if (!open && privacyCard.value?.kind === 'account' && !privacyCard.value.viaBadge) {
		privacyCard.value = null
	}
})

/** The card kind of this viewer's badge (job 228: guests have the badge too). */
const badgeKind = computed(() => (props.mode === 'guest' ? 'guest' : 'account'))

/** The badge: opens the card of this viewer (the focus goes to its close button) or closes it. */
async function toggleLinkInfo() {
	if (privacyCard.value?.kind === badgeKind.value) {
		closePrivacy()
		return
	}
	privacyCard.value = { kind: badgeKind.value, viaBadge: true }
	await nextTick()
	privacyInfo.value?.focusClose()
}

/**
 * Closes the card. Opened through the badge: the focus goes back to the
 * badge (to the canvas when the badge is gone); otherwise to the canvas
 * host, but only when it was inside the card.
 *
 * @param {{focusInside?: boolean}} [e] close event of the card
 */
function closePrivacy(e = {}) {
	const card = privacyCard.value
	if (!card) {
		return
	}
	privacyCard.value = null
	if (card.viaBadge) {
		nextTick(() => {
			if (!topBar.value?.focusBadge?.() && e?.focusInside) {
				focusCanvasHost()
			}
		})
	} else if (e?.focusInside) {
		focusCanvasHost()
	}
}

/**
 * (Job 229) A tool of the tool bar (not the shape tool): the session takes
 * it; another tool closes the shapes panel.
 *
 * @param {string} x tool id
 * @param {MouseEvent|null} e click (null: a long press)
 */
function pickTool(x, e) {
	if (shapesOpen.value) {
		shapesOpen.value = false
	}
	act(e, (s) => s.setTool(x))
}

/**
 * (Job 201) Opens the shapes panel; (job 229) from the keyboard on the shape tool its search takes the focus,
 * never from the key S (the canvas keeps it).
 *
 * @param {boolean} focus the search takes the focus
 */
function openShapes(focus) {
	shapesFocus.value = focus
	shapesArmed = false
	measureShapes()
	shapesOpen.value = true
}

/**
 * (Job 229) The tool bar's shape tool: closed, it takes the shape tool and
 * opens the shapes panel; open, it closes the panel (closeShapes).
 *
 * @param {MouseEvent} e click
 */
function toggleShapes(e) {
	if (shapesOpen.value) {
		closeShapes()
		return
	}
	act(e, (s) => s.setTool('shape'))
	openShapes(!isPointerActivation(e))
}

/** (Job 201) Where the shapes panel starts: SHAPES_GAP beyond the tool bar's end edge as drawn. */
function measureShapes() {
	const el = boardEl.value
	const b = el?.getBoundingClientRect?.()
	const r = el?.querySelector?.('[data-knorke-toolbar]')?.getBoundingClientRect?.()
	if (!b || !r || !(r.width > 0)) {
		shapesStart.value = null
		return
	}
	const rtl = getComputedStyle(el).direction === 'rtl'
	const next = Math.round((rtl ? b.right - r.left : r.right - b.left) + SHAPES_GAP)
	if (shapesStart.value !== next) {
		shapesStart.value = next
	}
}

/**
 * (Job 201) Closes the shapes panel; the focus goes back to the shape tool when it was inside. (Job 229) The
 * shape tool, still chosen, gives way to select, unless a tile armed it since the panel opened: then the next
 * click or drag on the board puts that shape (on a phone the panel covers most of the board).
 */
function closeShapes() {
	const inside = document.activeElement?.closest?.('[data-knorke-shapes]') ?? null
	shapesOpen.value = false
	if (tool.value === 'shape' && !shapesArmed) {
		session.value?.setTool('select')
	}
	if (inside) {
		nextTick(() => boardEl.value?.querySelector?.('[data-knorke-tool="shape"]')?.focus?.())
	}
}

/**
 * (Job 201) A tile of the panel clicked: the shape tool takes its kind; (job 204) the pool entry arms
 * the frame tool with "Swimlanes".
 *
 * @param {string} kind data.kind or POOL_KIND
 * @param {{uri: string, w: number, h: number}|null} [picture] (job 203) the picture of an own shape
 */
function armShape(kind, picture = null) {
	shapesArmed = true
	if (kind === POOL_KIND) {
		act(null, (s) => s.setToolOptions('frame', { frameKind: 'lanes' }))
	} else {
		act(null, (s) => s.setToolOptions('shape', { kind, picture: picture ?? null }))
	}
}

/**
 * (Job 201) A shape from the panel: at the client point over the canvas, or in the middle of the view.
 *
 * @param {string} kind data.kind
 * @param {{x: number, y: number}|null} client client point of the drop, null from the keyboard
 * @param {{uri: string, w: number, h: number}|null} [picture] (job 203) the picture of an own shape
 */
function placeShape(kind, client, picture = null) {
	const s = session.value
	if (!s) {
		return
	}
	let screen = null
	if (client) {
		const r = host.value?.getBoundingClientRect?.()
		if (!r) {
			return
		}
		screen = { x: client.x - r.left, y: client.y - r.top }
	}
	// job 204: the pool entry puts a frame with lanes
	if (kind === POOL_KIND) s.placeLanes(screen)
	else s.placeShape(kind, screen, picture)
}

function focusCanvasHost() {
	if (session.value) {
		session.value.focusCanvas()
	} else {
		host.value?.focus?.()
	}
}

/**
 * Leave guard (router, T3): may this board be left now?
 *
 * @return {Promise<boolean>} true: leave; false: stay on the board
 */
async function guardLeave() {
	const s = session.value
	if (!s || s.destroyed) {
		return true
	}
	if (leaveAnswer !== null) {
		return false
	}
	let ok
	try {
		ok = await s.prepareLeave({ timeoutMs: 3000 })
	} catch (e) {
		console.error('[knorke] prepareLeave failed', e)
		ok = false
	}
	if (ok || session.value !== s) {
		return true
	}
	leaveOpen.value = true
	return new Promise((resolve) => {
		leaveAnswer = resolve
	})
}

/** @param {boolean} leave the user chose Leave */
function answerLeave(leave) {
	leaveOpen.value = false
	const resolve = leaveAnswer
	leaveAnswer = null
	resolve?.(leave)
}

/**
 * @param {unknown} e error of open()
 * @return {string|null} banner status for the error, null for a retryable error
 */
function statusOf(e) {
	if (!(e instanceof HttpError)) {
		return null
	}
	if (e.status === 404) {
		return 'gone'
	}
	if (e.status === 403) {
		if (e.code === 'link_expired') {
			return 'link_expired'
		}
		if (e.code === 'password_required' || e.code === 'password_wrong') {
			return 'password_required'
		}
		return e.code === 'link_revoked' ? 'revoked' : isLinksDisabled(e) ? 'links_disabled' : 'gone'
	}
	if (e.status === 401) {
		return props.mode === 'user' ? 'logged_out' : 'revoked'
	}
	if (e.status === 409) {
		return 'reload'
	}
	return null
}

onMounted(async () => {
	unguard = addLeaveGuard(() => guardLeave())
	watchNarrow()
	observeRoom()
	// job 182: the template right for the menus (accounts only)
	loadTemplates()
	const s = markRaw(new BoardSession({
		container: host.value,
		mode: props.mode,
		boardId: props.boardId,
		linkToken: props.linkToken,
		viewOnly: deviceViewOnly,
		// job 183: on a touch screen the smiley-plus button stands at every note in modes vote and view
		touch: hasTouchScreen(),
		debug: props.debug,
		limits: props.limits,
		pasteCatcher: catcher.value,
		ui: {
			onStatus: (x, reason) => {
				status.value = x
				statusReason.value = reason ?? null
				if (x === 'password_required' && props.mode === 'guest') {
					queueMicrotask(handOver)
				}
			},
			onSelection: (x) => { selection.value = x },
			onSelectionBox: (x) => { selBox.value = x ?? null },
			onParticipants: (x) => { participants.value = x },
			onBoard: (x) => {
				// merged, never replaced (F3): a partial update keeps links/linksAllowed
				board.value = x.board ? { ...(board.value ?? {}), ...x.board } : board.value
				me.value = x.me ?? null
			},
			onTool: (x) => {
				// job 229: the shape tool (the key S) opens the shapes panel; the canvas keeps the focus
				if (x === 'shape' && tool.value !== 'shape' && !shapesOpen.value && uiMode.value === 'edit' && !frozen.value) openShapes(false)
				tool.value = x
			},
			onMode: (x) => { uiMode.value = x },
			onToolOptions: (x) => { toolOptions.value = x },
			// job 267: the AI buttons and the chip; the notice before the first AI task
			onAi: (x) => { aiView.value = x && typeof x === 'object' ? x : null },
			onAiDiagram: (x) => { aiDiagram.value = x && typeof x === 'object' ? x : null },
			onAiNotice: (n) => new Promise((resolve) => {
				aiAsk.value?.resolve(false)
				aiAsk.value = { text: typeof n?.text === 'string' ? n.text : null, url: typeof n?.url === 'string' ? n.url : '', resolve }
			}),
			onConfirm: (q) => new Promise((resolve) => {
				ask.value?.resolve(false)
				ask.value = { name: q.name, confirmLabel: q.confirmLabel ?? '', resolve }
			}),
			onZoom: (x) => { zoom.value = x },
			onUndoState: (x) => { undoState.value = x },
			onRescue: (x) => { rescues.value = addRescue(rescues.value, x) },
			onVotes: (x) => onVotes(x),
			onFollow: (x) => {
				const was = followState.value.following
				followState.value = { following: x?.following ?? null, chip: x?.chip ?? null }
				// job 274: following begins (a presentation, "Bring everyone here"): the board shows
				if (!was && followState.value.following) setView('follow')
			},
			onSlides: (x) => onSlides(x),
			onSlideRect: (x) => { slideRect.value = x && Number.isFinite(x.x) ? x : null },
			onStepper: (x) => { stepper.value = x && typeof x.id === 'string' ? { id: x.id, rect: x.rect ?? null } : null },
			onContextMenu: (x) => { menu.value = x && Array.isArray(x.at) ? x : null },
			onSortLabels: (x) => { sortLabels.value = Array.isArray(x) && x.length > 0 ? x : null },
			onTouchTip: (x) => { touchTip.value = x === true },
			onReactionPicker: (x) => { reactPicker.value = x && typeof x.id === 'string' ? x : null },
			onReactionNames: (x) => { reactNames.value = x && typeof x.id === 'string' && Array.isArray(x.entries) ? x : null },
			onShortcuts: () => openShortcuts('key'),
			// job 271: Ctrl/⌘+F, and the model changed (the search counts again)
			onSearch: () => openSearch(),
			onItems: () => {
				if (searchOpen.value) searchRev.value++
				if (outlineShown.value) outlineRev.value++
			},
			onEmpty: (x) => { boardEmpty.value = x === true },
			onTemplates: () => openTemplates(),
			// job 230: the context menu's "Arrange…" opens the bar's panel
			onArrange: () => contextBar.value?.openArrange?.({ focus: true }),
			onSaveTemplate: (d) => openSaveTemplate(d),
			onExportPdf: (x) => openPdfDialog(x),
			onClockSkew: () => tick(),
			onComments: (x) => onComments(x),
			onTags: (x) => { tagView.value = x },
			onCommentPick: () => {},
			onCommentOpen: (id) => openThreadAtBubble(id),
			onCommentCompose: (place) => composeAt(place),
			viewTop: () => viewTop(),
			viewBottom: () => viewBottom(),
			viewInsets: () => viewInsets(),
		},
		deps: { SceneModel, SceneManager, installDebug },
	}))
	session.value = s
	try {
		await s.open(props.guestName, props.guestPassword)
		ready.value = true
		emit('opened', { board: board.value, me: me.value })
	} catch (e) {
		if (s.destroyed) {
			return
		}
		const st = statusOf(e)
		if (st) {
			const v = finalOpenView(st, { mode: props.mode, source: props.knownSource })
			status.value = st
			statusReason.value = v.reason
			openFinal.value = { back: v.back }
		} else if (e instanceof HttpError && e.status === 429 && e.fromApp) {
			openError.value = t('knorke', 'Too many attempts. Please wait a moment and try again.')
		} else {
			openError.value = e instanceof HttpError && e.status === 0
				? t('knorke', 'The server cannot be reached. Check your connection.')
				: t('knorke', 'Something went wrong while opening the board.')
		}
		emit('open-failed', e)
	}
})

onBeforeUnmount(() => {
	clearTimeout(tickTimer)
	tickTimer = null
	stopThreadLoop()
	narrowQuery?.removeEventListener?.('change', onNarrow)
	midQuery?.removeEventListener?.('change', onMid)
	roomObserver?.disconnect()
	roomObserver = null
	wakeLock.destroy()
	sound.close()
	answerAsk(false)
	unguard?.()
	unguard = null
	// unmounted by another path while the question was open: nothing to keep
	answerLeave(true)
	session.value?.destroy()
	session.value = null
})

function reload() {
	window.location.reload()
}

/**
 * Runs a bar command on the session; after a pointer activation the canvas
 * gets the focus back (single keys work at once, SPEC-M1 §6.5.1).
 *
 * @param {Event|null} e activation event (null: decide by the last pointerdown)
 * @param {(s: BoardSession) => void} fn command
 */
function act(e, fn) {
	const s = session.value
	if (!s) {
		return
	}
	fn(s)
	refocusAfter(e, s)
}

/**
 * Lock and Unlock of the context bar (M2, SPEC-M1 §1.2 "(R20) Sperren"):
 * the button goes away with the new lock state, so the canvas gets the
 * focus after a pointer AND a keyboard activation (like "Connect").
 *
 * @param {(s: object) => void} fn lockSelection or unlockSelection (job 144: filterSelection, its
 *   panel closes the same way; job 190: selectLockedOffer, its button goes the same way)
 */
function lockAct(fn) {
	const s = session.value
	if (!s) {
		return
	}
	fn(s)
	s.focusCanvas()
}

/**
 * Group items and Ungroup of the context bar (M2, SPEC-M1 §1.2 "(R20)
 * Gruppieren"): sent, the button goes away with the new state, so the canvas
 * gets the focus after a pointer AND a keyboard activation (like Lock);
 * blocked (toast group-blocked), the button stays and only a pointer click
 * refocuses the canvas.
 *
 * @param {Event} e activation event
 * @param {(s: object) => string} fn groupSelection or ungroupSelection ('sent' | 'blocked' | 'none')
 */
function groupAct(e, fn) {
	const s = session.value
	if (!s) {
		return
	}
	if (fn(s) === 'sent') {
		s.focusCanvas()
	} else {
		refocusAfter(e, s)
	}
}

/**
 * (Job 278) "Frame around" of the bar's "…": sent, the new frame's title
 * editor has the focus (left alone); blocked (toast frame-blocked) or
 * nothing, the focus goes back as after "Group items".
 *
 * @param {Event} e activation event
 */
function frameAct(e) {
	const s = session.value
	if (!s) {
		return
	}
	if (s.frameAroundSelection() !== 'sent') {
		refocusAfter(e, s)
	}
}

/**
 * "Connect" of the context bar (SPEC-M1 §6.12): the new connector is
 * selected and the button is gone, so the canvas gets the focus either way.
 */
function connect() {
	const s = session.value
	if (!s) {
		return
	}
	s.connectSelection()
	s.focusCanvas()
}

/**
 * Job 172: "Add reaction" of the context bar: the session's picker of the
 * one selected note, below the button (board px).
 *
 * @param {Event} e activation of the button
 */
function reactFromBar(e) {
	const s = session.value
	if (!s) {
		return
	}
	const el = e?.target?.closest?.('button') ?? e?.currentTarget ?? null
	const r = el?.getBoundingClientRect?.()
	const b = boardEl.value?.getBoundingClientRect?.()
	s.reactFromBar(r && b ? { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height } : null)
}

/**
 * Job 172: a choice of the reaction picker; the picker goes, the canvas
 * gets the focus.
 *
 * @param {string} e emoji (hex form)
 */
function pickReaction(e) {
	const s = session.value
	if (!s) {
		reactPicker.value = null
		return
	}
	s.pickReaction(e)
	s.focusCanvas()
}

/** Job 172: the picker closed itself (Esc, a click beside it, the full list closed): the canvas gets the focus. */
function closeReactionPicker() {
	const s = session.value
	if (!s) {
		reactPicker.value = null
		return
	}
	s.closeReactionPicker()
	s.focusCanvas()
}

/** Job 172: the names or the list closed themselves (Esc, a click beside them). */
function closeReactionNames() {
	const s = session.value
	if (!s) {
		reactNames.value = null
		return
	}
	const inside = typeof document !== 'undefined' && document.activeElement?.closest?.('[data-knorke-reactions]')
	s.closeReactionPopup()
	if (inside) {
		s.focusCanvas()
	}
}

/**
 * OK of the one-time touch tip (job 142): the session hides it; the button
 * is gone, so the canvas gets the focus either way (like "Connect").
 */
function dismissTouchTip() {
	touchTip.value = false
	const s = session.value
	if (!s) {
		return
	}
	s.dismissTouchTip()
	s.focusCanvas()
}

/**
 * Opens the shortcuts overview (job 145; job 271: once its lazy part is loaded) unless it is open; the frame list
 * goes (it would stay open behind the dialog).
 *
 * @param {'key'|'pointer'|'button'} via the key ? on the canvas, a pointer or the keyboard on the "?" button
 */
async function openShortcuts(via) {
	if (shortcuts.value !== null) {
		return
	}
	// (job 271) a lazy part: it opens once loaded, unless it opened meanwhile
	if (await loadPart('shortcuts') && shortcuts.value === null) {
		shortcuts.value = { via, touch: hasTouchScreen() }
	}
}

/** The overview closed (Esc, ×, ?, a click beside it): the focus to the canvas, after a keyboard activation of the button back to it. */
function closeShortcuts() {
	const via = shortcuts.value?.via ?? null
	shortcuts.value = null
	nextTick(() => {
		if (via === 'button' && zoomControls.value?.focusShortcuts?.()) {
			return
		}
		focusCanvasHost()
	})
}

/** Remembers the last pointerdown (components/focus.js: menu changes carry no pointer info). */
function onPointerDown(e) {
	// job 274: the frame of an outline jump goes with the next press on the canvas
	if (outlineHit !== null && host.value?.contains?.(e?.target)) {
		outlineHit = null
		session.value?.setSearchHit(null)
	}
	notePointerDown()
	// the timer's end sound may play only after a user gesture (util/sound.js)
	sound.unlock()
}

/** A key on the board: a user gesture too (end sound). */
function onKeyDown(e) {
	sound.unlock()
	// job 271: Ctrl/⌘+F opens the board search before Nextcloud's search (on the document) sees it
	if (ready.value && isSearchKey(e)) {
		e.preventDefault()
		e.stopPropagation()
		if (!e.repeat) {
			openSearch()
		}
		return
	}
	// job 189: Esc ends "New comment" before anything else sees it
	if (e?.key === 'Escape' && comments.value.picking) {
		e.preventDefault()
		e.stopPropagation()
		cancelCommentPick()
	}
}

/**
 * (Job 178) An action of the board menu "⋯" (components/boardMenu.js).
 *
 * @param {string} key the entry (BOARD_ACTIONS)
 */
function boardAction(key) {
	const s = session.value
	if (s && key === 'export-png') {
		s.exportPng('board')
	} else if (s && key === 'export-svg') {
		s.exportVector('board', 'svg')
	} else if (s && key === 'export-pdf') {
		s.openPdfExport('board')
	} else if (s && key === 'export-bpmn') {
		s.exportBpmn('board')
	} else if (s && key === 'export-csv') {
		s.exportBoardCsv('board')
	} else if (s && key === 'download-board') {
		s.exportBoardFile()
	} else if (s && key === 'save-template') {
		openSaveTemplate(s.templateDraft('board'))
	} else if (key === 'insert-template') {
		openTemplates()
	} else if (key === 'insert-board-file') {
		pickFile(boardFileEl.value)
	} else if (key === 'insert-bpmn-file') {
		pickFile(bpmnFileEl.value)
	} else if (key === 'import-csv') {
		pickFile(csvFileEl.value)
	} else if (s && key === 'filter-tags') {
		s.openTagFilter()
	} else if (key === 'keyboard-shortcuts') {
		openShortcuts('pointer')
	}
}

/**
 * (Job 191) An event of TagPanels: the session acts; a filter or tick keeps the panel open.
 *
 * @param {string} name BoardSession.tagAction name
 * @param {...any} args its arguments
 */
function tagAction(name, ...args) {
	session.value?.tagAction(name, ...args)
}

/**
 * (Job 191) "Tags" of the context bar: the tag panel below the button.
 *
 * @param {Event} e the click
 */
function tagsFromBar(e) {
	const el = e?.target?.closest?.('button') ?? e?.currentTarget ?? null
	const r = el?.getBoundingClientRect?.()
	const b = boardEl.value?.getBoundingClientRect?.()
	session.value?.openTagPanel(r && b ? { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height } : null)
}

/**
 * (Job 181) "Insert board file…" and (job 205) "Insert BPMN file…": the
 * browser's file picker. Synchronous in the menu entry's click (no await
 * before click()): the picker opens only inside the user gesture.
 *
 * @param {HTMLInputElement|null} el the hidden file field
 */
function pickFile(el) {
	if (canInsert.value && el) {
		el.click()
	}
}

/**
 * (Jobs 181, 205) A file was picked (see the file comment): over max →
 * invalid without reading, else its text goes to the session; the field is
 * emptied afterwards. Cancelling fires no change, or one without a file:
 * nothing.
 *
 * @param {Event} e change of the file field
 * @param {number} max largest file that is read (bytes)
 * @param {(s: object, text: (string|null)) => boolean} insert the session's insert
 * @param {(file: File) => Promise<string|Uint8Array>} [read] (job 220) how the file is read (a CSV file: its bytes)
 */
async function insertPicked(e, max, insert, read = (file) => file.text()) {
	const el = e.target
	const file = el?.files?.[0] ?? null
	if (!file) {
		return
	}
	let text = null
	try {
		if (file.size <= max) {
			text = await read(file)
		}
	} catch (err) {
		// unreadable: invalid like a file that is too large
		console.error('[knorke] file not read', err)
	} finally {
		el.value = ''
	}
	// job 217: the BPMN insert is async (its lazy part)
	if (session.value && !(await insert(session.value, text))) {
		focusCanvasHost()
	}
}

/** @param {Event} e change of input[data-knorke-board-file] */
function onBoardFile(e) {
	return insertPicked(e, BOARD_FILE_MAX_BYTES, (s, text) => s.insertBoardFile(text))
}

/** @param {Event} e (job 205) change of input[data-knorke-bpmn-file] */
function onBpmnFile(e) {
	return insertPicked(e, BPMN_FILE_MAX_BYTES, (s, text) => s.insertBpmnFile(text))
}

/** @param {Event} e (job 220) change of input[data-knorke-csv-file] */
function onCsvFile(e) {
	return insertPicked(e, CSV_FILE_MAX_BYTES, (s, bytes) => s.insertCsvFile(bytes), async (file) => new Uint8Array(await file.arrayBuffer()))
}

/** (Job 232) "Blank" of the start tiles: they go for this visit, the canvas gets the focus. */
function startBlank() {
	startDone.value = true
	nextTick(() => focusCanvasHost())
}

/** (Job 180) Opens the template dialog (the board menu, the context menu; job 232: no longer the empty board, it has its tiles). */
function openTemplates() {
	if (canInsert.value) {
		templatesOpen.value = true
		// job 182: a fresh list, unless the account has no right (the Guests app)
		if (templateList.value.right !== null) {
			loadTemplates()
		}
	}
}

/** (Job 182) Loads route 28 (accounts only; the newest load wins, an error forgets the right). */
async function loadTemplates() {
	if (props.mode !== 'user') {
		return
	}
	const n = ++templateLoad
	templateList.value = { ...templateList.value, state: 'loading' }
	try {
		const res = await templatesApi.listTemplates()
		if (n === templateLoad) {
			templateList.value = { right: res.right, state: 'ready', templates: res.templates, pending: res.pending }
		}
	} catch (e) {
		console.warn('[knorke] templates could not be loaded', e)
		if (n === templateLoad) {
			templateList.value = { right: undefined, state: 'error', templates: [], pending: [] }
		}
	}
}

/**
 * (Job 182) A tile of an own template: the dialog goes, route 30 loads,
 * then the session inserts the content (and focuses the canvas).
 *
 * @param {number} id template id
 */
async function insertOwnTemplate(id) {
	templatesOpen.value = false
	await nextTick()
	let content = null
	try {
		content = await templatesApi.templateContent(id)
	} catch (e) {
		console.warn('[knorke] template could not be loaded', e)
	}
	const s = session.value
	if (!s) {
		return
	}
	if (typeof content !== 'string') {
		s.toast(t('knorke', 'The template could not be loaded.'), { hook: 'template-load-failed' })
		s.focusCanvas()
		return
	}
	if (!s.insertOwnTemplate(content)) {
		s.focusCanvas()
	}
}

/**
 * (Job 182) A withdraw button: the question takes the template dialog's
 * place (never two dialogs).
 *
 * @param {{id: number, name: string}} entry the suggestion
 */
function askWithdraw(entry) {
	templatesOpen.value = false
	withdrawing.value = entry
}

/** (Job 182) The question confirmed: route 32 withdraws the suggestion (gone already counts), then the dialog comes back. */
async function withdraw() {
	const entry = withdrawing.value
	if (!entry || withdrawBusy.value) {
		return
	}
	withdrawBusy.value = true
	try {
		await templatesApi.deleteTemplate(entry.id)
	} catch (e) {
		if (!(e instanceof HttpError && e.status === 404)) {
			console.warn('[knorke] suggestion not withdrawn', e)
			session.value?.toast(t('knorke', 'The suggestion could not be withdrawn.'), { hook: 'template-withdraw-failed' })
		}
	} finally {
		withdrawBusy.value = false
	}
	closeWithdraw()
}

/** (Job 182) The question closed (withdrawn, Cancel, Esc): the template dialog comes back with a fresh list. */
function closeWithdraw() {
	withdrawing.value = null
	if (canInsert.value) {
		openTemplates()
	} else {
		nextTick(() => focusCanvasHost())
	}
}

/**
 * (Job 182) Opens the suggest/save dialog with a draft of the session
 * (null: the session said why there is none).
 *
 * @param {object|null} draft BoardSession.templateDraft
 */
function openSaveTemplate(draft) {
	if (draft && templateRight.value) {
		templateSave.value = draft
	}
}

/**
 * (Job 182) Suggested or saved: the dialog goes, the info template-suggested
 * or template-saved, the canvas gets the focus.
 *
 * @param {{id: number, state: string}|null} res the answer of route 29
 */
function templateSaved(res) {
	templateSave.value = null
	if (res?.state === 'adopted') {
		session.value?.info(t('knorke', 'Template saved. Everyone can now insert it.'), { hook: 'template-saved' })
	} else {
		session.value?.info(t('knorke', 'Template suggested. An admin decides whether to adopt it.'), { hook: 'template-suggested' })
	}
	nextTick(() => focusCanvasHost())
}

/** (Job 182) The save dialog closed without saving (Cancel, Esc): the canvas gets the focus. */
function closeTemplateSave() {
	templateSave.value = null
	nextTick(() => focusCanvasHost())
}

/**
 * (Job 207) "Save" of the PDF dialog: the dialog goes, the canvas gets the
 * focus, the session saves the PDF at that page size (and stores it).
 *
 * @param {string} page exportPdf.js PDF_PAGE_KEYS
 */
function savePdf(page) {
	const x = pdfExport.value
	pdfExport.value = null
	nextTick(() => focusCanvasHost())
	if (x) {
		session.value?.exportVector(x.scope, 'pdf', { page })
	}
}

/**
 * (Job 207) ui.onExportPdf: the dialog with the page size; (job 217) it
 * opens once its lazy part is loaded. Failing (the toast part-load-failed),
 * nothing opens and the canvas gets the focus.
 *
 * @param {{scope: string, page: string}|null} x what to save and the page to start with
 */
async function openPdfDialog(x) {
	if (!x || (x.scope !== 'board' && x.scope !== 'selection')) {
		pdfExport.value = null
		return
	}
	if (await loadPart('pdfDialog')) {
		pdfExport.value = x
	} else {
		nextTick(() => focusCanvasHost())
	}
}

/** (Job 207) The PDF dialog closed without saving (Cancel, Esc): the canvas gets the focus. */
function closePdfExport() {
	pdfExport.value = null
	nextTick(() => focusCanvasHost())
}

/**
 * (Job 180) A tile of the template dialog: the dialog goes, then the
 * session inserts the template (and focuses the canvas).
 *
 * @param {string} key board/templates.js TEMPLATE_KEYS
 */
async function insertTemplate(key) {
	templatesOpen.value = false
	await nextTick()
	if (!session.value?.insertTemplate(key)) {
		focusCanvasHost()
	}
}

/** (Job 180) The dialog closed without a tile (Esc, ×, a click beside it): the canvas gets the focus. */
function closeTemplates() {
	templatesOpen.value = false
	nextTick(() => focusCanvasHost())
}

/**
 * An entry of the context menu (synchronous in its click or key event:
 * "Paste here" reads the clipboard inside that user activation). After
 * sort-colors and sort-frame (job 139) the focus goes as after the bar's
 * buttons (sortFocus).
 *
 * @param {string} name entry (contextbar.js MENU_ITEMS)
 * @param {Event|null} [e] the activating click or key
 */
function menuAction(name, e = null) {
	const s = session.value
	if (!s) {
		return
	}
	s.menuAction(name)
	if (name === 'sort-colors' || name === 'sort-frame') {
		sortFocus(e, s, s.sortLabels !== null)
	}
}

/**
 * "Sort by color" and "Sort notes by color" of the context bar (job 139).
 *
 * @param {Event} e activation event
 * @param {(s: BoardSession) => boolean} fn sortByColor or sortFrameByColor (true: sorted)
 */
function sortAct(e, fn) {
	const s = session.value
	if (!s) {
		return
	}
	sortFocus(e, s, fn(s) === true)
}

/**
 * Job 139: after sorting the bar is gone with the selection; a pointer
 * activation gives the canvas the focus, a keyboard activation the first
 * name field (after the render). Nothing sorted: only a pointer activation
 * gives the canvas the focus (like act).
 *
 * @param {Event|null} e activation event
 * @param {BoardSession} s session
 * @param {boolean} sorted the name fields are shown
 */
function sortFocus(e, s, sorted) {
	if (!sorted) {
		refocusAfter(e, s)
	} else if (isPointerActivation(e)) {
		s.focusCanvas()
	} else {
		nextTick(() => sortLabelsEl.value?.focusFirst())
	}
}

/** Job 139: the screen places of the name fields (SortLabels reads them every frame). */
function sortPlaces() {
	return session.value?.sortLabelPlaces() ?? []
}

/**
 * The context menu closed itself: Esc, Tab and a click outside give the
 * canvas the focus back (§6.6); window blur and resize do not here (a focus
 * still inside the menu goes to the canvas when it unmounts, ContextMenu.vue
 * returnFocus, §6.6 R20).
 *
 * @param {'esc'|'tab'|'outside'|'blur'|'resize'} reason why
 */
function menuClose(reason) {
	const s = session.value
	if (!s) {
		menu.value = null
		return
	}
	s.closeMenu()
	if (reason === 'esc' || reason === 'tab' || reason === 'outside') {
		s.focusCanvas()
	}
}

// ---- job 189: comments -----------------------------------------------------

/** @return {string|null} the thread id of ?comment= in the address (digits only), null without one */
function readDeepComment() {
	try {
		const v = new URLSearchParams(window.location.search).get('comment')
		return typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) ? v : null
	} catch (e) {
		return null
	}
}

/** Takes ?comment= out of the address (once used). */
function clearDeepComment() {
	try {
		const u = new URL(window.location.href)
		if (u.searchParams.has('comment')) {
			u.searchParams.delete('comment')
			window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
		}
	} catch (e) {
		// nothing to clear
	}
}

/** @param {object} x the session's commentsView */
function onComments(x) {
	comments.value = x
	if (searchOpen.value) {
		searchRev.value++
	}
	const o = threadOpen.value
	if (o && o.id !== null && x.loaded && !x.threads.some((th) => th.id === o.id)) {
		// deleted (here or elsewhere): the thread goes
		closeThread()
	}
	if (o && o.id === null && !x.mayWrite) {
		closeThread()
	}
	if (deepComment !== null && ready.value && x.loaded) {
		const id = deepComment
		deepComment = null
		clearDeepComment()
		if (x.threads.some((th) => th.id === id)) {
			openFromList(id)
		}
	}
}

// the address may name a thread that loaded before the board was ready
watch(ready, (r) => {
	if (r && deepComment !== null && comments.value.loaded) {
		onComments(comments.value)
	} else if (r && deepComment !== null && session.value && !session.value.comments.loaded && session.value.comments.seen === undefined) {
		// a board without comments: nothing to open
		deepComment = null
		clearDeepComment()
	}
})

/** "Comments" of the top bar: opens or closes the panel (the vote list goes). */
function toggleComments() {
	if (commentsOpen.value) {
		closeComments()
		return
	}
	if (panelOpen.value) {
		closePanel()
	}
	commentsOpen.value = true
	if (threadOpen.value?.inPanel) {
		threadOpen.value = null
	}
}

/** (Job 271) Opens the search, or focuses its field when it is open. */
async function openSearch() {
	// job 274: the search shows its hits on the board
	setView('search')
	outlineHit = null
	if (searchOpen.value) {
		searchEl.value?.focus?.()
		return
	}
	if (await loadPart('search')) {
		searchOpen.value = true
	}
}

/** (Job 271) The magnifier: opens or closes the search. */
function toggleSearch() {
	if (searchOpen.value) {
		closeSearch()
	} else {
		openSearch()
	}
}

/** (Job 271) Closes the search; its frame goes, the canvas takes the focus. */
function closeSearch() {
	searchOpen.value = false
	session.value?.setSearchHit(null)
	focusCanvasHost()
}

/**
 * (Job 274) The view after `event` (board/viewSwitch.js nextView): the
 * outline loads its part first (a failed load keeps the board); the search
 * closes when the outline opens; back on the board after Esc or a jump the
 * canvas takes the focus.
 *
 * @param {string} event 'board', 'outline', 'toggle', 'escape', 'jump', 'search', 'follow', 'thread'
 * @return {Promise<void>}
 */
async function setView(event) {
	const next = nextView(view.value, event)
	if (next === view.value) {
		return
	}
	if (next === 'outline') {
		if (!(await loadPart('outline')) || nextView(view.value, event) !== 'outline') {
			return
		}
		if (searchOpen.value) {
			closeSearch()
		}
		view.value = 'outline'
		return
	}
	view.value = 'board'
	if (event === 'escape' || event === 'board' || event === 'toggle') {
		nextTick(focusCanvasHost)
	}
}

/** @return {object|null} (job 274) what the outline reads (BoardSession.outlineSource) */
function outlineSource() {
	return session.value?.outlineSource?.() ?? null
}

/**
 * (Job 274) A point or a frame heading of the outline: back to the board,
 * the item into view with the search's frame around it (BoardSession
 * showSearchHit); no selection, no op, no undo step. An item that is gone
 * only brings the board back.
 *
 * @param {string} id item
 */
function outlineJump(id) {
	setView('jump')
	const s = session.value
	if (!s || !s.model?.has?.(id)) {
		return
	}
	nextTick(() => {
		outlineHit = id
		s.showSearchHit({ kind: 'item', id, item: id })
		focusCanvasHost()
	})
}

/** @return {object|null} (job 271) what the search reads (BoardSession.searchSource) */
function searchSource() {
	return session.value?.searchSource?.() ?? null
}

/**
 * (Job 271) A hit of the search: Enter, the arrows ('step') and a row
 * ('open') show it beside the panel (on phones the list has folded, the
 * canvas is free); a row of a comment opens its thread like the comment
 * list does.
 *
 * @param {object} hit a hit of board/search.js
 * @param {'step'|'open'} how key or arrow, or a row
 */
function searchJump(hit, how) {
	const s = session.value
	if (!s || !hit) {
		return
	}
	if (hit.kind === 'comment' && how === 'open') {
		openFromList(hit.id)
		s.setSearchHit(hit.item)
		return
	}
	const board = host.value?.getBoundingClientRect?.() ?? null
	const panel = boardEl.value?.querySelector?.('[data-knorke-search]')?.getBoundingClientRect?.() ?? null
	s.showSearchHit(hit, focusPlan(narrow.value, board, panel).reserve)
}

function closeComments() {
	commentsOpen.value = false
	if (threadOpen.value?.inPanel) {
		threadOpen.value = null
	}
}

/**
 * "New comment": the hint, then the next click or tap picks the place. On
 * phones the panel goes first; elsewhere it goes when it covers the hint
 * with its "Cancel" (tablets, small laptops: the hint stands in the middle).
 * When the panel goes, its focused "New comment" goes with it: the canvas
 * takes the focus, so Esc (caught on the board) still ends the pick.
 */
async function newComment() {
	const s = session.value
	if (!s) {
		return
	}
	let closed = false
	if (narrow.value) {
		commentsOpen.value = false
		closed = true
	}
	closeThread()
	if (!s.startCommentPick()) {
		return
	}
	await nextTick()
	const hint = boardEl.value?.querySelector?.('[data-knorke-banner=comment-place]')?.getBoundingClientRect?.() ?? null
	const panel = boardEl.value?.querySelector?.('[data-knorke-comments]')?.getBoundingClientRect?.() ?? null
	if (commentsOpen.value && rectsOverlap(hint, panel)) {
		commentsOpen.value = false
		closed = true
	}
	if (closed) {
		focusCanvasHost()
	}
}

function cancelCommentPick() {
	session.value?.cancelCommentPick()
	focusCanvasHost()
}

/** "Comment" of the context bar: the one selected item's open thread, or a new one there. */
function commentFromBar() {
	const s = session.value
	if (s && s.selection.length === 1) {
		s.commentOn(s.selection[0])
	}
}

/**
 * The editor of a new thread at a place (the session: pick, bar, menu).
 *
 * @param {{item: (string|null), x: number, y: number}} place where
 */
function composeAt(place) {
	threadOpen.value = { id: null, place, inPanel: false }
	startThreadLoop()
}

/**
 * (Job 233, redesign docs/redesign/ P1) A bubble's click: the comment panel
 * opens (tab "Open") with the thread inside it.
 *
 * @param {string} id open thread
 */
function openBubble(id) {
	if (typeof id !== 'string' || !session.value?.comments.get(id)) {
		return
	}
	if (!commentsOpen.value) {
		toggleComments()
	}
	if (threadOpen.value && !threadOpen.value.inPanel) {
		closeThread()
	}
	commentsTab.value = 'open'
	threadOpen.value = { id, inPanel: true }
	nextTick(() => commentsPanel.value?.setTab?.('open'))
}

/** @param {string} id open thread ("Comment" on its item, an entry of the list) */
function openThreadAtBubble(id) {
	if (typeof id !== 'string') {
		return
	}
	threadOpen.value = { id, inPanel: false }
	startThreadLoop()
}

/**
 * An entry of the list: an open thread pans into the free part of the
 * canvas (beside the panel; on phones the panel closes first) and opens at
 * its bubble; a resolved one opens inside the panel.
 *
 * @param {string} id thread
 */
function openFromList(id) {
	setView('thread')
	const s = session.value
	const th = s?.comments.get(id) ?? null
	if (!s || !th) {
		return
	}
	if (th.resolved) {
		if (!commentsOpen.value) {
			toggleComments()
		}
		commentsTab.value = 'resolved'
		threadOpen.value = { id, inPanel: true }
		nextTick(() => commentsPanel.value?.setTab?.('resolved'))
		return
	}
	const board = host.value?.getBoundingClientRect?.() ?? null
	const panel = boardEl.value?.querySelector?.('[data-knorke-comments]')?.getBoundingClientRect?.() ?? null
	const plan = focusPlan(narrow.value, board, panel)
	if (narrow.value) {
		commentsOpen.value = false
	}
	const a = s.threadAnchor(id)
	if (a) {
		s.centerOn(a, plan.reserve)
	}
	openThreadAtBubble(id)
}

function closeThread() {
	const was = threadOpen.value
	threadOpen.value = null
	threadPos.value = null
	stopThreadLoop()
	if (was && !was.inPanel) {
		nextTick(() => {
			if (typeof document !== 'undefined' && (document.activeElement === null || document.activeElement === document.body)) {
				focusCanvasHost()
			}
		})
	}
}

/** The popover follows its bubble: one animation frame at a time while it is open. */
function startThreadLoop() {
	stopThreadLoop()
	const step = () => {
		threadRaf = 0
		const s = session.value
		const o = threadOpen.value
		if (!s || !o || o.inPanel) {
			return
		}
		const p = o.id === null ? s.commentScreen(o.place) : s.commentScreen({ thread: o.id })
		const old = threadPos.value
		const next = p ? { x: Math.round(p.x), y: Math.round(p.y) } : null
		if ((old === null) !== (next === null) || (old && next && (old.x !== next.x || old.y !== next.y))) {
			threadPos.value = next
		}
		const r = boardEl.value?.getBoundingClientRect?.()
		if (r && (!boardSize.value || boardSize.value.w !== r.width || boardSize.value.h !== r.height)) {
			boardSize.value = { w: r.width, h: r.height }
		}
		if (typeof requestAnimationFrame === 'function') {
			threadRaf = requestAnimationFrame(step)
		}
	}
	step()
}

function stopThreadLoop() {
	if (threadRaf && typeof cancelAnimationFrame === 'function') {
		cancelAnimationFrame(threadRaf)
	}
	threadRaf = 0
}

/** @return {Function} the session's bubble places (CommentBubbles) */
function commentPlaces() {
	return session.value?.commentPlaces() ?? []
}

/**
 * @param {string} key thread id or 'new'
 * @return {{text: string, chosen: object[]}} its unsent text
 */
function draftOf(key) {
	return commentDrafts.value.get(key) ?? { text: '', chosen: [] }
}

/**
 * @param {string} key thread id or 'new'
 * @param {{text: string, chosen: object[]}} d unsent text
 */
function saveDraft(key, d) {
	commentDrafts.value.set(key, { text: d?.text ?? '', chosen: Array.isArray(d?.chosen) ? d.chosen : [] })
}

/** @param {string} text wire text of a reply or a new thread */
async function threadSend(text) {
	const s = session.value
	const o = threadOpen.value
	if (!s || !o || commentBusy.value) {
		return
	}
	commentBusy.value = true
	try {
		if (o.id === null) {
			const th = await s.createThread({ text, item: o.place.item, node: o.place.node ?? null, x: o.place.x, y: o.place.y })
			commentDrafts.value.delete('new')
			threadOpen.value = { id: th.id, inPanel: false }
			startThreadLoop()
		} else {
			await s.replyTo(o.id, text)
			commentDrafts.value.delete(o.id)
			threadEl.value?.cleared?.()
		}
	} catch (e) {
		// toasted by the session; the text stays in the field
	} finally {
		commentBusy.value = false
	}
}

/**
 * @param {string} id own comment
 * @param {string} text new wire text
 */
async function threadEdit(id, text) {
	const s = session.value
	if (!s) {
		return
	}
	commentBusy.value = true
	try {
		await s.editComment(id, text)
	} catch (e) {
		// toasted by the session
	} finally {
		commentBusy.value = false
	}
}

/**
 * @param {string} id comment
 * @param {boolean} first the first comment of its thread (asks first)
 */
function threadDelete(id, first) {
	if (first) {
		commentDeleteAsk.value = { id }
		return
	}
	deleteComment(id)
}

async function confirmThreadDelete() {
	const ask = commentDeleteAsk.value
	commentDeleteAsk.value = null
	if (ask) {
		await deleteComment(ask.id)
	}
}

/** @param {string} id comment to delete */
async function deleteComment(id) {
	const s = session.value
	if (!s) {
		return
	}
	commentBusy.value = true
	try {
		await s.deleteComment(id)
	} catch (e) {
		// toasted by the session
	} finally {
		commentBusy.value = false
	}
}

/** @param {boolean} resolved resolve (true) or reopen the open thread */
async function threadResolve(resolved) {
	const s = session.value
	const o = threadOpen.value
	if (!s || !o || o.id === null) {
		return
	}
	commentBusy.value = true
	try {
		await s.setResolved(o.id, resolved)
		if (resolved && !o.inPanel) {
			// its bubble is gone: the popover goes with it
			closeThread()
		}
	} catch (e) {
		// toasted by the session
	} finally {
		commentBusy.value = false
	}
}

// ---- stage 3 ----------------------------------------------------------------

/** The narrow layout (R16 (1)): matchMedia, live. */
function watchNarrow() {
	try {
		narrowQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null
	} catch (e) {
		narrowQuery = null
	}
	narrow.value = !!narrowQuery?.matches
	narrowQuery?.addEventListener?.('change', onNarrow)
	try {
		midQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MID_QUERY) : null
	} catch (e) {
		midQuery = null
	}
	mid.value = !!midQuery?.matches
	midQuery?.addEventListener?.('change', onMid)
}

/** @param {MediaQueryListEvent} e change of the middle-width query (job 228) */
function onMid(e) {
	mid.value = !!e?.matches
}

/** @param {MediaQueryListEvent} e change of the narrow query */
function onNarrow(e) {
	narrow.value = !!e?.matches
}

// ---- job 137: the context bar at the selection ------------------------------

/**
 * The context bar's room in the wide layout (components/barPlace.js, board
 * px): the board's size, T under the TopBar and the visible banners (with
 * the info card), U above the visible session bar, and the top stack's offset in
 * the board (the bar is positioned inside it). Narrow layout: null.
 */
function measureRoom() {
	measureOutlineTop()
	// job 201: the shapes panel follows the tool bar
	if (shapesOpen.value) {
		measureShapes()
	}
	const el = boardEl.value
	if (narrow.value || !el || !stackEl.value) {
		room.value = null
		return
	}
	const b = el.getBoundingClientRect()
	/** @return {number|null} an edge of a visible element, board px */
	const edge = (x, side) => {
		const r = x?.getBoundingClientRect?.()
		return r && r.width > 0 && r.height > 0 ? r[side] - b.top : null
	}
	const chrome = Math.max(edge(el.querySelector('[data-knorke-bar=top]'), 'bottom') ?? 0, edge(bannersEl.value, 'bottom') ?? 0)
	const vote = edge(el.querySelector('[data-knorke-bar=session]'), 'top')
	const W = el.clientWidth
	const H = el.clientHeight
	const { T, U } = barLimits({ W, H, chrome, vote })
	const s = stackEl.value.getBoundingClientRect()
	const next = { W, H, T, U, ox: s.left - b.left, oy: s.top - b.top }
	const o = room.value
	if (o === null || Object.keys(next).some((k) => o[k] !== next[k])) {
		room.value = next
	}
}

/**
 * (job 143) How far the board's top is covered, board px (= the scene's
 * container px): the deeper bottom edge of the TopBar and the visible
 * banners, plus room for the context bar the new selection gets, one row
 * the TopBar's height: in the wide layout one row above the selection
 * (barPlace.js EDGE and GAP), in the narrow layout two rows under the
 * banners (there it wraps on phones). session.createNow brings a new
 * frame's title band below it (scene.revealTitle), so its editor shows.
 *
 * @return {number} board px
 */
function viewTop() {
	const el = boardEl.value
	if (!el) return 0
	const b = el.getBoundingClientRect()
	const bar = el.querySelector('[data-knorke-bar=top]')?.getBoundingClientRect?.()
	/** @return {number} the bottom edge of a visible element, board px (0 for none) */
	const bottom = (r) => (r && r.width > 0 && r.height > 0 ? r.bottom - b.top : 0)
	const chrome = Math.max(bottom(bar), bottom(bannersEl.value?.getBoundingClientRect?.()))
	const row = bar && bar.height > 0 ? bar.height : 44
	return chrome + (narrow.value ? 2 : 1) * row + EDGE + GAP
}

/**
 * (job 193) How far the bars at the board's bottom reach up, board px: the
 * highest top edge of the visible zoom controls (with the round shortcuts
 * button beside them), the session bar and the touch tip. session.createNow
 * keeps a new note pad's title band above them (scene.revealTitle).
 *
 * @return {number} board px
 */
function viewBottom() {
	const el = boardEl.value
	if (!el) return 0
	const b = el.getBoundingClientRect()
	let up = 0
	for (const x of el.querySelectorAll('.knorke-zoom, .knorke-undo, [data-knorke-bar=session], .knorke-touchtip')) {
		const r = x.getBoundingClientRect?.()
		if (r && r.width > 0 && r.height > 0) up = Math.max(up, b.bottom - r.top)
	}
	return up
}

/**
 * (job 223) How far the bars and an open side panel cover each edge of the
 * canvas, canvas px: components/bars.js chromeInsets of the visible
 * [data-knorke-chrome] elements, measured where they stand now.
 *
 * @return {{top: number, right: number, bottom: number, left: number}|null} canvas px; null before the board is there
 */
function viewInsets() {
	const el = boardEl.value
	return el && chromeInsets(host.value.getBoundingClientRect(), [...el.querySelectorAll('[data-knorke-chrome]')].map((x) => x.getBoundingClientRect()))
}

/**
 * (Job 274, round 1) Where the outline's page starts, board px: below the
 * top bar and the notices under it (the banners lie above the outline), so
 * none of them covers its head. Measured with the room (the banners are
 * observed).
 */
function measureOutlineTop() {
	const el = boardEl.value
	if (!el) return
	const b = el.getBoundingClientRect()
	/** @return {number} the bottom edge of a visible element, board px (0 for none) */
	const bottom = (x) => {
		const r = x?.getBoundingClientRect?.()
		return r && r.width > 0 && r.height > 0 ? r.bottom - b.top : 0
	}
	const top = Math.round(Math.max(bottom(el.querySelector('[data-knorke-bar=top]')), bottom(bannersEl.value)))
	if (top !== outlineTop.value) outlineTop.value = top
}

/** Watches the sizes the room depends on: the board, the TopBar, the banners, the session bar (when shown). */
function observeRoom() {
	roomObserver?.disconnect()
	roomObserver = null
	const el = boardEl.value
	if (el && typeof ResizeObserver === 'function') {
		roomObserver = new ResizeObserver(() => measureRoom())
		for (const x of [el, el.querySelector('[data-knorke-bar=top]'), bannersEl.value, el.querySelector('[data-knorke-bar=session]')]) {
			if (x) roomObserver.observe(x)
		}
	}
	measureRoom()
}

// the session bar comes or goes: observe it (and measure anew); a layout switch acts at once
watch(showSessionBar, () => observeRoom(), { flush: 'post' })
// (job 233) a segment of the session bar went away with the focus on it (End, ×): the canvas takes it
watch(() => [showSessionBar.value, timerOf(timerMeta.value) !== null, votes.value?.state === 'open', presenting.value], (now, old) => {
	const gone = !!old && now.some((x, i) => old[i] && !x)
	if (gone && typeof document !== 'undefined' && (document.activeElement === null || document.activeElement === document.body)) {
		focusCanvasHost()
	}
}, { flush: 'post' })
watch(narrow, () => measureRoom(), { flush: 'post' })

/** @return {number} server time now (the session's clock; local before the board opened) */
function serverNow() {
	return session.value?.clock ? session.value.clock.now() : Date.now()
}

/**
 * The display tick: one timeout to the next full second of the nearest
 * countdown (timer rest, vote rest); runs only while one exists.
 */
function tick() {
	clearTimeout(tickTimer)
	tickTimer = null
	const now = serverNow()
	nowTick.value = now
	const timer = timerOf(timerMeta.value)
	const rests = []
	if (timer) {
		rests.push(timer.state === 'running' ? timer.end - now : 1000)
	}
	if (votes.value?.open && Number.isFinite(votes.value.endsAt)) {
		rests.push(votes.value.endsAt - now)
	}
	if (rests.length === 0) {
		return
	}
	const delay = Math.min(...rests.map((r) => nextTickMs(r > 0 ? r : 1000)))
	tickTimer = setTimeout(tick, delay)
}

/**
 * The session's vote view (ui.onVotes): bar, panel, stepper, the automatic
 * panel (once per sid at the close; narrow: at the start).
 *
 * @param {object} v BoardSession.votesView()
 */
function onVotes(v) {
	const prev = votes.value
	votes.value = v
	if (!v || v.state === null) {
		panelOpen.value = false
		stepper.value = null
	} else if (v.event === 'closed' && !autoPanel.has(v.sid)) {
		autoPanel.add(v.sid)
		stepper.value = null
		openPanel()
	} else if (v.event === 'started' && narrow.value && !v.voteBlocked) {
		// job 175: a guest kept from voting keeps the bar with its notice and "Sign in" in view
		openPanel()
	}
	if (!v?.open) {
		stepper.value = null
	}
	if (panelOpen.value) {
		panelItems.value = session.value?.votableItems() ?? []
	}
	session.value?.setVotePanelOpen(panelOpen.value)
	if (prev?.open !== v?.open || prev?.endsAt !== v?.endsAt) {
		tick()
	}
}

/**
 * "Show on the board" of a row text in the vote list or the ranking
 * (SPEC-M1 §6.6, R22 P7-11): the narrow layout's bottom sheet would cover
 * the item, so it closes first (the vote bar opens it again); the side
 * panel stays and the canvas part it covers is kept free. (Job 223)
 * zoomToItem measures the bars (viewInsets): after closing the sheet it
 * waits for the DOM update, so the sheet no longer counts.
 *
 * @param {string} id item id
 */
function focusItem(id) {
	const s = session.value
	if (!s) {
		return
	}
	const board = host.value?.getBoundingClientRect?.() ?? null
	const panel = host.value?.parentElement?.querySelector?.('[data-knorke-vote-panel]')?.getBoundingClientRect?.() ?? null
	const plan = focusPlan(narrow.value, board, panel)
	if (plan.closeSheet) {
		closePanel()
		nextTick(() => session.value?.zoomToItem(id, plan.reserve))
		return
	}
	s.zoomToItem(id, plan.reserve)
}

/** The stepper's own close (×, Esc, a press elsewhere): the session forgets it too. */
function closeStepper() {
	stepper.value = null
	session.value?.closeStepper()
}

function openPanel() {
	panelItems.value = session.value?.votableItems() ?? []
	panelOpen.value = true
	session.value?.setVotePanelOpen(true)
	// job 189: the vote list and the comment panel exclude each other
	commentsOpen.value = false
}

function closePanel() {
	panelOpen.value = false
	session.value?.setVotePanelOpen(false)
}

function togglePanel() {
	if (panelOpen.value) {
		closePanel()
	} else {
		openPanel()
	}
}

/**
 * @param {string} id item id of a result
 * @return {{text: string, exists: boolean}}
 */
function lookupItem(id) {
	const s = session.value
	return { text: s ? s.textOf(id) : '', exists: !!s?.model?.has(id) }
}

/** (Job 149) The eye of the narrow vote bar: the notice as a toast (a tap shows the sentence on touch). */
function showLiveNote() {
	showInfo(t('knorke', 'Moderators see live counts'), { hook: 'vote-live-note' })
}

/** (Job 175) The symbol of the narrow vote bar in a session with accountsOnly: the sentence as a toast. */
function showAccountsNote() {
	showInfo(t('knorke', 'Only signed-in accounts can vote.'), { hook: 'vote-accounts-note' })
}

/**
 * (Job 175) "Sign in" of a guest kept from voting: the Nextcloud login in
 * this tab, back to /p/<token> afterwards (the page asks first while ops
 * are unsent, beforeunload).
 */
function signIn() {
	if (props.linkToken) {
		window.location.assign(signInUrl(props.linkToken))
	}
}

/** "Copy results": the plain-text ranking over the copy path (until export in M2). */
async function copyResults() {
	const text = resultsText(votes.value?.results ?? [], (id) => lookupItem(id).text, t('knorke', '(no text)'))
	if (await copyText(text)) {
		showInfo(t('knorke', 'Results copied'))
	} else {
		showError(t('knorke', 'The results could not be copied.'))
	}
}

/** "Close results" (clear): the panel closes with the session's meta. */
async function clearResults() {
	await moderate((s) => s.updateVote('clear'))
}

/**
 * Runs one moderation call (never repeated automatically).
 *
 * @param {(s: BoardSession) => Promise<{ok: boolean, code: (string|null)}>} fn call
 * @return {Promise<{ok: boolean, code: (string|null)}>}
 */
async function moderate(fn) {
	const s = session.value
	if (!s || modBusy.value) {
		return { ok: false, code: null }
	}
	modBusy.value = true
	try {
		return await fn(s)
	} finally {
		modBusy.value = false
	}
}

/** "Start voting" in the menu: the setup dialog (scope "frame" when exactly one frame is selected). */
async function openSetup() {
	if (!(await loadPart('voteDialog'))) {
		return
	}
	const s = session.value
	const ids = selection.value.ids ?? []
	let frame = null
	if (s && ids.length === 1 && s.model?.has(ids[0]) && s.model.get(ids[0]).t === 'frame') {
		const f = s.frames().find((x) => x.id === ids[0])
		frame = f ? { id: f.id, title: f.title } : null
	}
	setupFrame.value = frame
	setupError.value = ''
	setupOpen.value = true
}

/** @param {object} cfg settings of the setup dialog */
async function startVote(cfg) {
	const r = await moderate((s) => s.startVote(cfg))
	if (r.ok) {
		setupOpen.value = false
	} else if (r.code === 'vote_config') {
		setupError.value = t('knorke', 'These vote settings are not possible.')
	} else if (r.code === 'vote_open') {
		setupOpen.value = false
	}
}

async function openTimer() {
	if (await loadPart('timerDialog')) {
		timerOpen.value = true
	}
}

/** (Job 275) "Private writing …": the start dialog (a lazy part), the selected frame picked. */
async function openPrivate() {
	const s = session.value
	if (!s || privateDialog.value !== null || !(await loadPart('privateDialog'))) {
		return
	}
	const ids = selection.value.ids ?? []
	const frames = s.frames()
	const initial = ids.length === 1 && frames.some((f) => f.id === ids[0]) ? ids[0] : null
	privateDialog.value = { frames, initial }
}

/** (Job 275) "Start" of the dialog: it closes once the server took it. */
async function startPrivate(frame) {
	const r = await moderate((s) => s.privateWriting('start', frame))
	if (r.ok) {
		privateDialog.value = null
	}
}

/** (Job 275) "Reveal" of the session bar and the menu. */
function revealPrivate() {
	moderate((s) => s.privateWriting('reveal'))
}

/** (Job 233) "End" of the session bar or "End voting" of the menu: ask first. */
function askVoteEnd() {
	if (votes.value?.open) {
		voteEndAsk.value = true
	}
}

/** (Job 233) The question's yes: end the session. */
async function endVote() {
	voteEndAsk.value = false
	await moderate((s) => s.updateVote('end'))
}

/** (Job 233) "Edit voting …": the setup dialog of the running session. */
async function openVoteEdit() {
	if (votes.value?.open && await loadPart('voteDialog')) {
		voteEditOpen.value = true
	}
}

/**
 * (Job 233) "Save" of "Edit voting" with minutes: lengthen the session (route 23 extend).
 *
 * @param {number} minutes 1–1440
 */
async function extendVote(minutes) {
	const r = await moderate((s) => s.updateVote('extend', minutes))
	if (r.ok || r.code === 'vote_closed') {
		voteEditOpen.value = false
	}
}

/** (Job 272) The moderation menu opens: does the board have a frame? */
function readHasFrames() {
	hasFrames.value = (session.value?.frames() ?? []).length > 0
}

/**
 * (Job 272) "Present frames": full screen first (still inside the click),
 * then the presentation starts.
 */
function startSlides() {
	setView('board')
	const el = document.documentElement
	if (!document.fullscreenElement && typeof el?.requestFullscreen === 'function') {
		slidesFullscreen = true
		el.requestFullscreen().catch(() => { slidesFullscreen = false })
	}
	session.value?.startSlides().then((ok) => {
		if (!ok) {
			leaveFullscreen()
		}
	})
}

/** (Job 272) "End" or Esc of the presenter. */
function endSlides() {
	session.value?.endSlides()
}

/** (Job 272) Leaves the full screen this tab asked for. */
function leaveFullscreen() {
	if (slidesFullscreen && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
		document.exitFullscreen().catch(() => {})
	}
	slidesFullscreen = false
}

/** @param {object|null} x the presentation state of the session */
function onSlides(x) {
	const was = slides.value?.role === 'presenter'
	slides.value = x && (x.role === 'presenter' || x.role === 'viewer') ? x : null
	if (was && slides.value?.role !== 'presenter') {
		leaveFullscreen()
	}
	if (!slides.value) {
		slideRect.value = null
	}
}

/** (Job 233) "End" of the presenting segment. */
function endPresenting() {
	moderate((s) => s.endSummon())
}

/**
 * @param {string} action timer action
 * @param {number} [ms] for start and add
 */
async function timerAction(action, ms) {
	const r = await moderate((s) => s.timer(action, ms))
	if (r.ok && (action === 'start' || action === 'stop')) {
		timerOpen.value = false
	}
}

/** @param {boolean} on mute the end sound (per viewer) */
function setMuted(on) {
	sound.setMuted(on)
	muted.value = sound.muted()
}

function dismissTimeUp() {
	dismissedTimeUp.value = timerKey(timerOf(timerMeta.value))
}

/**
 * A participant button: follow, or stop when this tab follows them already.
 *
 * @param {string} pid participant
 * @param {boolean} was this tab follows them
 */
function onFollowParticipant(pid, was) {
	const s = session.value
	if (!s) {
		return
	}
	if (was) {
		s.stopFollow()
	} else {
		s.followParticipant(pid)
	}
}

function stopFollowing() {
	session.value?.stopFollow()
}

function followPresenter() {
	session.value?.followPresenter()
}

/** The frame list reads the frames when it opens. */
function readFrames() {
	frameList.value = session.value?.frames() ?? []
}

// a timer appears or changes: the display tick follows
watch(() => JSON.stringify(timerMeta.value ?? null), () => tick())
// "Time's up" starts: the end sound (unless muted or locked)
watch(timeUp, (up, was) => {
	if (up && !was) {
		sound.play()
	}
})
// wake lock while a session is open or a timer runs (tablets, §6.6)
watch(() => !!votes.value?.open || timerOf(timerMeta.value)?.state === 'running', (on) => wakeLock.want(on), { immediate: true })

/** @param {boolean} ok the user's answer to the session's question */
function answerAsk(ok) {
	const q = ask.value
	ask.value = null
	q?.resolve(ok)
}

/** @param {boolean} ok (job 267) the answer to the AI notice */
function answerAi(ok) {
	const q = aiAsk.value
	aiAsk.value = null
	q?.resolve(ok)
}

/** @return {string} (job 267) the notice when the admin set none */
function aiBuiltInNotice() {
	return aiNoticeText()
}

/**
 * (Job 267) The owner's switch "Allow AI on this board" (route 62); the
 * answer takes the meta path, so the buttons follow at once.
 *
 * @param {boolean} allowed wanted state
 */
async function allowAi(allowed) {
	if (!board.value || aiBusy.value) {
		return
	}
	aiBusy.value = true
	try {
		const res = await aiApi.allowAi(board.value.id, allowed)
		session.value?.onMeta(res?.board)
	} catch (e) {
		showError(t('knorke', 'The setting could not be saved.'))
	} finally {
		aiBusy.value = false
	}
}

/**
 * Guest hand-over after 'password_required' (SPEC-M1 §4.2, §6.4): unsent
 * texts first into the copy dialog; PublicApp takes over when it closes.
 */
function handOver() {
	if (handoverPending) {
		return
	}
	handoverPending = true
	// R13 (§6.4): the automatic re-join hit the password lock-out: the password
	// phase shows the lock-out text instead of "Enter the password …"
	const err = statusReason.value === PASSWORD_LOCK ? session.value?.sync?.finalError : null
	handoverInfo = err ? { lockText: lockoutText(err) } : {}
	for (const x of session.value?.unsentTexts() ?? []) {
		rescues.value = addRescue(rescues.value, x)
	}
	if (rescues.value.length === 0) {
		emit('password-required', handoverInfo)
	}
}

function closeRescues() {
	rescues.value = []
	if (handoverPending) {
		emit('password-required', handoverInfo)
	}
}

/**
 * @param {object} partial board keys changed in the share dialog (links, linksAllowed)
 */
function mergeBoard(partial) {
	if (session.value) {
		session.value.mergeBoard(partial)
	} else if (board.value) {
		board.value = { ...board.value, ...partial }
	}
}

/** @param {string} title new board title */
async function rename(title) {
	if (!isOwner.value || !board.value) {
		return
	}
	try {
		const b = await boardsApi.renameBoard(board.value.id, title)
		if (session.value) {
			// SPEC-M1 §6.5.1: the own rename takes the meta path (metaRev)
			session.value.applyBoardUpdate(b)
		} else {
			board.value = { ...board.value, title: b.title }
		}
	} catch (e) {
		showError(e instanceof HttpError && e.status === 400
			? t('knorke', 'Please enter a title (1–200 characters).')
			: t('knorke', 'The board could not be renamed.'))
	}
}
</script>
