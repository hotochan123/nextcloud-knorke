<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Exception\HttpError;
use OCP\Config\IUserConfig;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Security\ISecureRandom;
use OCP\TaskProcessing\IManager;
use OCP\TaskProcessing\Task;
use Psr\Log\LoggerInterface;

/**
 * "Summarise" and "Cluster by topic" (factory job 267) through Nextcloud's
 * AI (task processing, the provider the admin set up; no API keys here).
 *
 * Available (availability()): an account with the right to edit (owner,
 * edit; never a guest, "Can view" or vote), the admin switch on (app config
 * ai_enabled, missing = on), a provider for core:text2text, and the board
 * switch on (meta.ai missing or not "off"). Otherwise 403 forbidden (the
 * role) or 403 ai_unavailable, and the client shows no AI buttons.
 *
 * start() (route 60): the account confirms the notice (AiNotice, in its
 * language; the hash of what it confirmed in the user value ai_notice; a
 * changed text asks again: 409 ai_notice until the request carries
 * acceptNotice), at most dailyLimit() tasks per account and UTC day (the
 * user value ai_day "YYYY-MM-DD n", counted when the task is scheduled; 429
 * ai_limit with max). The server reads the texts itself (AiLayout), the
 * client only names ids. The task is scheduled for the account with
 * custom id "board:<id>"; its state lives in the user value ai_task_<task>:
 * {b, k, ids, f, at, s: run|done|failed, e?, ops?, inv?, sel?}.
 *
 * finish() (AiTaskListener, the AI worker; no open tab needed): run →
 * done/failed once (setUserValue with the old value as precondition).
 * The result is written as the account, again only while it may edit and
 * AI is still allowed on the board, through SyncService::applyOps with
 * every check of a sync; the ops that went through and their inverse stay
 * in the state for the client's undo step.
 *
 * (Job 268) kind diagram {shape, prompt}: the prompt goes to the AI, the
 * state keeps the shape (sh) but never the prompt; finish() stores the
 * cleaned tree (AiLayout::tree) in the state and writes nothing to the
 * board: the client shows a preview and inserts it as a mind map.
 * (Job 269) The shape flowchart stores the cleaned steps and arrows
 * (AiLayout::flow) as flow instead; route 59 gives flow, not tree.
 * (Job 276) The shape workshop stores its parts (AiLayout::workshop) as
 * workshop; route 59 gives workshop.
 *
 * tasks() (route 59) lists the account's tasks of a board and drops states
 * older than KEEP_MS; forget() (route 61) cancels a running task (it still
 * counts against the limit) or drops a finished one.
 */
class AiService {
    public const TASK_TYPE = 'core:text2text';
    public const KEY_ENABLED = 'ai_enabled';
    public const KEY_LIMIT = 'ai_daily_limit';
    public const DEFAULT_LIMIT = 30;
    public const LIMIT_MAX = 1000;
    public const PREF_DAY = 'ai_day';
    public const PREF_NOTICE = 'ai_notice';
    public const PREF_TASK = 'ai_task_';
    /** A task state is dropped after this. */
    public const KEEP_MS = 24 * 3600 * 1000;
    /** (Round 2) A task that ended this long ago (s) without its event is finished by route 59. */
    public const FINISH_LATE_S = 30;
    /** Client id of the AI's writes (change rows). */
    public const CLIENT = 'knorke-ai';
    public const KINDS = ['summarise', 'cluster', 'diagram'];
    private const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public function __construct(
        private IAppConfig $appConfig,
        private IConfig $config,
        private IManager $tasks,
        private Access $access,
        private ItemStore $items,
        private MetaService $meta,
        private SyncService $sync,
        private AiNotice $notice,
        private IFactory $l10n,
        private IUserManager $users,
        private ISecureRandom $random,
        private LoggerInterface $logger,
        private IUserConfig $userConfig,
    ) {
    }

    // ── Settings ─────────────────────────────────────────────────────────

    public function enabled(): bool {
        return $this->appConfig->getValueString(Application::APP_ID, self::KEY_ENABLED, 'yes') !== 'no';
    }

    public function dailyLimit(): int {
        $v = $this->appConfig->getValueString(Application::APP_ID, self::KEY_LIMIT, '');
        return preg_match('/\A\d{1,4}\z/', $v) === 1 ? min(self::LIMIT_MAX, (int)$v) : self::DEFAULT_LIMIT;
    }

    /**
     * The admin settings (route 58): {enabled, dailyLimit, notice}; the body
     * replaces what it names. notice as PrivacyNotice::save.
     *
     * @return array{enabled: bool, dailyLimit: int, notice: array}
     * @throws HttpError 400
     */
    public function saveSettings(array $body): array {
        $enabled = $body['enabled'] ?? null;
        $limit = $body['dailyLimit'] ?? null;
        if (($enabled !== null && !is_bool($enabled)) || ($limit !== null && (!is_int($limit) || $limit < 0 || $limit > self::LIMIT_MAX))) {
            throw new HttpError(400, 'bad_request', 'enabled is true or false, dailyLimit a whole number from 0 to ' . self::LIMIT_MAX . '.');
        }
        $notice = null;
        if (array_key_exists('notice', $body)) {
            if (!is_array($body['notice'])) {
                throw new HttpError(400, 'bad_request', 'notice must be an object.');
            }
            $notice = $this->notice->validate($body['notice']);
        }
        if ($enabled !== null) {
            $this->appConfig->setValueString(Application::APP_ID, self::KEY_ENABLED, $enabled ? 'yes' : 'no');
        }
        if ($limit !== null) {
            $this->appConfig->setValueString(Application::APP_ID, self::KEY_LIMIT, (string)$limit);
        }
        if ($notice !== null) {
            $this->notice->save($body['notice']);
        }
        return $this->adminState();
    }

    /** @return array{enabled: bool, dailyLimit: int, limitMax: int, provider: bool, notice: array} the admin form's data */
    public function adminState(): array {
        return [
            'enabled' => $this->enabled(),
            'dailyLimit' => $this->dailyLimit(),
            'limitMax' => self::LIMIT_MAX,
            'provider' => $this->providerReady(null),
            'notice' => $this->notice->adminState(),
        ];
    }

    /** A provider for core:text2text (for $uid; null: the request's account). */
    public function providerReady(?string $uid): bool {
        try {
            return in_array(self::TASK_TYPE, $this->tasks->getAvailableTaskTypeIds(false, $uid), true);
        } catch (\Throwable) {
            return false;
        }
    }

    public static function boardAllowed(array $meta): bool {
        return ($meta['ai'] ?? null) !== 'off';
    }

    /**
     * Why AI is not available to $p on a board with $meta, null when it is.
     *
     * @return ?string forbidden | ai_disabled | ai_no_provider | ai_board_off
     */
    public function why(Principal $p, array $meta): ?string {
        if ($p->isGuest || $p->uid === null || !$p->role->canEdit()) {
            return 'forbidden';
        }
        if (!$this->enabled()) {
            return 'ai_disabled';
        }
        if (!$this->providerReady($p->uid)) {
            return 'ai_no_provider';
        }
        return self::boardAllowed($meta) ? null : 'ai_board_off';
    }

    /** @throws HttpError 403 forbidden | ai_unavailable */
    private function require(Principal $p, array $meta): void {
        $why = $this->why($p, $meta);
        if ($why === 'forbidden') {
            throw new HttpError(403, 'forbidden');
        }
        if ($why !== null) {
            throw new HttpError(403, 'ai_unavailable', '', ['reason' => $why]);
        }
    }

    // ── Routes ───────────────────────────────────────────────────────────

    /**
     * Route 59: what the client needs on a board. available/reason as why();
     * ready = admin switch and provider (the owner's board switch shows
     * then); notice {text: ?string, url, hash, confirmed}; limit {max, used};
     * tasks of this account on this board, oldest first.
     */
    public function state(Principal $p, int $board, int $nowMs): array {
        $meta = $this->meta->read($board)['meta'] ?? [];
        $why = $this->why($p, $meta);
        $out = [
            'available' => $why === null,
            'reason' => $why,
            'ready' => $why === null || $why === 'ai_board_off',
            'allowed' => self::boardAllowed($meta),
            'owner' => $p->role === Role::Owner,
            'notice' => null,
            'limit' => null,
            'tasks' => [],
        ];
        if ($why === 'forbidden') {
            return $out;
        }
        $uid = (string)$p->uid;
        $n = $this->noticeFor($uid);
        $out['notice'] = $n + ['confirmed' => $this->config->getUserValue($uid, Application::APP_ID, self::PREF_NOTICE, '') === $n['hash']];
        $out['limit'] = ['max' => $this->dailyLimit(), 'used' => $this->usedToday($uid, $nowMs)];
        $out['tasks'] = $this->tasks($uid, $board, $nowMs);
        return $out;
    }

    /**
     * Route 60 {kind, ids, frame?, acceptNotice?} → {task: id}.
     *
     * @throws HttpError 400 bad_request|ai_empty|ai_too_much, 403, 409 ai_notice, 429 ai_limit, 503 ai_failed
     */
    public function start(Principal $p, int $board, array $body, int $nowMs): array {
        $meta = $this->meta->read($board)['meta'] ?? throw new HttpError(404, 'not_found');
        $this->require($p, $meta);
        $uid = (string)$p->uid;
        $kind = $body['kind'] ?? null;
        $ids = $body['ids'] ?? [];
        $frame = $body['frame'] ?? null;
        $accept = $body['acceptNotice'] ?? false;
        $shape = $body['shape'] ?? null;
        $request = null;
        if ($kind === 'diagram') {
            // (job 268) a prompt instead of items
            $ids = [];
            $frame = null;
            $request = is_string($body['prompt'] ?? null) ? Input::text($body['prompt'], PHP_INT_MAX) : null;
            if ($request === null || !in_array($shape, AiLayout::DIAGRAM_SHAPES, true)) {
                throw new HttpError(400, 'bad_request');
            }
            $request = trim($request);
            if ($request === '') {
                throw new HttpError(400, 'ai_empty');
            }
            if (mb_strlen($request, 'UTF-8') > AiLayout::PROMPT_MAX) {
                throw new HttpError(400, 'ai_too_much', '', ['max' => AiLayout::PROMPT_MAX]);
            }
        }
        if (!in_array($kind, self::KINDS, true) || !is_array($ids) || !array_is_list($ids) || count($ids) > AiLayout::MAX_ITEMS
            || ($frame !== null && (!is_string($frame) || preg_match(OpValidator::ULID_RE, $frame) !== 1)) || !is_bool($accept)) {
            throw new HttpError(400, 'bad_request');
        }
        foreach ($ids as $id) {
            if (!is_string($id) || preg_match(OpValidator::ULID_RE, $id) !== 1) {
                throw new HttpError(400, 'bad_request');
            }
        }
        $ids = array_values(array_unique($ids));
        if ($kind !== 'diagram' && PrivateWriting::state($meta) !== null) {
            // (job 275) summarise and cluster read the notes' texts: not while some are hidden
            throw new HttpError(409, 'private_on');
        }
        $hash = $this->noticeFor($uid)['hash'];
        if ($this->config->getUserValue($uid, Application::APP_ID, self::PREF_NOTICE, '') !== $hash) {
            if (!$accept) {
                throw new HttpError(409, 'ai_notice');
            }
            $this->config->setUserValue($uid, Application::APP_ID, self::PREF_NOTICE, $hash);
        }
        $max = $this->dailyLimit();
        if ($this->usedToday($uid, $nowMs) >= $max) {
            throw new HttpError(429, 'ai_limit', '', ['max' => $max]);
        }
        [$prompt, $keep] = match ($kind) {
            'summarise' => $this->summaryRequest($board, $ids, $frame),
            'cluster' => $this->clusterRequest($board, $ids, $frame),
            default => [AiLayout::diagramPrompt((string)$shape, (string)$request), []],
        };
        $task = new Task(self::TASK_TYPE, ['input' => $prompt], Application::APP_ID, $uid, 'board:' . $board);
        try {
            $this->tasks->scheduleTask($task);
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: AI task could not be scheduled', ['exception' => $e, 'app' => 'knorke']);
            throw new HttpError(503, 'ai_failed');
        }
        $tid = (int)$task->getId();
        $this->count($uid, $nowMs);
        $this->config->setUserValue($uid, Application::APP_ID, self::PREF_TASK . $tid, self::encode(
            ['b' => $board, 'k' => $kind, 'ids' => $keep, 'f' => $frame, 'at' => $nowMs, 's' => 'run'] + ($kind === 'diagram' ? ['sh' => $shape] : [])
        ));
        return ['task' => $tid];
    }

    /**
     * Route 61: a running task is cancelled (it keeps counting), a finished
     * one forgotten. A task of another account or board: 404.
     */
    public function forget(Principal $p, int $board, mixed $task): array {
        $tid = is_string($task) && preg_match('/\A[1-9]\d{0,17}\z/', $task) === 1 ? (int)$task : Input::whole($task);
        $uid = $p->uid;
        if ($uid === null || $tid === null || $tid < 1) {
            throw new HttpError(400, 'bad_request');
        }
        $st = $this->readState($uid, $tid);
        if ($st === null || $st['b'] !== $board) {
            throw new HttpError(404, 'not_found');
        }
        if ($st['s'] === 'run') {
            try {
                $this->tasks->cancelTask($tid);
            } catch (\Throwable) {
                // gone already: nothing to cancel
            }
        }
        $this->config->deleteUserValue($uid, Application::APP_ID, self::PREF_TASK . $tid);
        return ['task' => $tid, 'forgotten' => true];
    }

    /**
     * Route 62 {allowed}: the board switch, owner only; meta.ai "off" or
     * removed (MetaService, live for every client).
     *
     * @return array{title: string, meta: array, metaRev: int}
     */
    public function allow(Principal $p, int $board, mixed $allowed, int $nowMs): array {
        if ($p->role !== Role::Owner) {
            throw new HttpError(403, 'forbidden');
        }
        if (!is_bool($allowed)) {
            throw new HttpError(400, 'bad_request', 'allowed must be true or false.');
        }
        return $this->meta->write($board, static function (array $meta) use ($allowed): ?array {
            if (self::boardAllowed($meta) === $allowed) {
                return null;
            }
            if ($allowed) {
                unset($meta['ai']);
            } else {
                $meta['ai'] = 'off';
            }
            return $meta;
        }, $nowMs);
    }

    // ── The worker side ──────────────────────────────────────────────────

    /**
     * A task of Knorke ended (AiTaskListener). Never throws: a failure is
     * logged and lands as state failed.
     */
    public function finish(Task $task, int $nowMs): void {
        if ($task->getAppId() !== Application::APP_ID || $task->getUserId() === null || $task->getId() === null) {
            return;
        }
        $uid = $task->getUserId();
        $key = self::PREF_TASK . $task->getId();
        // round 2: a worker process holds the account's values of its first task;
        // the state of a later one was written by another process
        try {
            $this->userConfig->clearCache($uid);
        } catch (\Throwable) {
            // the values as cached
        }
        $raw = $this->config->getUserValue($uid, Application::APP_ID, $key, '');
        $st = self::decode($raw);
        if ($st === null || $st['s'] !== 'run') {
            return;
        }
        try {
            $st = $task->getStatus() === Task::STATUS_SUCCESSFUL
                ? $this->apply($uid, $st, $task->getOutput()['output'] ?? null, $nowMs)
                : ['s' => 'failed', 'e' => 'ai_failed'] + $st;
        } catch (\Throwable $e) {
            $this->logger->error('Knorke: the AI result could not be written', ['exception' => $e, 'app' => 'knorke']);
            $st = ['s' => 'failed', 'e' => 'ai_failed'] + $st;
        }
        try {
            // run → done/failed once, even if the event came twice
            $this->config->setUserValue($uid, Application::APP_ID, $key, self::encode($st), $raw);
        } catch (\Throwable) {
            // someone else finished or forgot it meanwhile
        }
    }

    /**
     * The result of a successful task on the board, as the account.
     *
     * @return array the new state (done with ops/inv/sel, or failed with e)
     */
    private function apply(string $uid, array $st, mixed $output, int $nowMs): array {
        $fail = static fn (string $e): array => ['s' => 'failed', 'e' => $e] + $st;
        $board = $st['b'];
        $user = $this->users->get($uid);
        if ($user === null) {
            return $fail('forbidden');
        }
        try {
            $p = $this->access->forAccount($user, $board)[0]->principal;
        } catch (HttpError) {
            return $fail('forbidden');
        }
        $meta = $this->meta->read($board)['meta'] ?? null;
        if ($meta === null) {
            return $fail('forbidden');
        }
        $why = $this->why($p, $meta);
        if ($why === 'forbidden') {
            return $fail('forbidden');
        }
        if ($why === 'ai_disabled' || $why === 'ai_board_off') {
            return $fail('ai_unavailable');
        }
        if ($st['k'] === 'diagram') {
            // (job 268) the preview's tree only; the client inserts it; (job 269) a flowchart's steps and arrows
            if ($st['sh'] === 'workshop') {
                // (job 276) the parts of a workshop
                $ws = AiLayout::workshop($output);
                return $ws === null ? $fail('ai_answer') : ['s' => 'done', 'workshop' => $ws] + $st;
            }
            if ($st['sh'] === 'flowchart') {
                $flow = AiLayout::flow($output);
                return $flow === null ? $fail('ai_answer') : ['s' => 'done', 'flow' => $flow] + $st;
            }
            $tree = AiLayout::tree($output, (string)($st['sh'] ?? 'mindmap'));
            return $tree === null ? $fail('ai_answer') : ['s' => 'done', 'tree' => $tree] + $st;
        }
        $plan = $st['k'] === 'summarise' ? $this->planSummary($board, $st, $output) : $this->planCluster($board, $st, $output, $user);
        if (is_string($plan)) {
            return $fail($plan);
        }
        [, $res] = $this->sync->applyOps($p, $board, self::CLIENT, $plan['ops'], $nowMs);
        $ops = [];
        $inv = [];
        foreach ($plan['ops'] as $i => $op) {
            if (($res[$i] ?? null) === 'ok') {
                $ops[] = $op;
                $inv[] = $plan['inverse'][$i];
            }
        }
        if ($ops === []) {
            return $fail('ai_gone');
        }
        $ok = array_flip(array_column($ops, 'id'));
        $sel = array_values(array_filter($plan['select'], fn (string $id): bool => isset($ok[$id]) || $st['k'] === 'cluster'));
        return ['s' => 'done', 'ops' => $ops, 'inv' => $inv, 'sel' => $sel] + $st;
    }

    /** @return array|string the card's ops, or the failure code */
    private function planSummary(int $board, array $st, mixed $output): array|string {
        $md = AiLayout::markdown($output);
        if ($md === null) {
            return 'ai_answer';
        }
        $sel = $this->live($board, $st['ids']);
        if ($sel === []) {
            return 'ai_gone';
        }
        $frames = $this->parents($board, $sel);
        $hulls = array_map(static fn (array $it): array => AiLayout::hull(AiLayout::abs($it, $frames)), $sel);
        $frame = null;
        $selFrames = array_values(array_filter($sel, static fn (array $it): bool => $it['t'] === 'frame'));
        if (count($selFrames) === 1 && count($sel) === 1) {
            $frame = $selFrames[0];
        } else {
            $parents = array_unique(array_map(static fn (array $it): string => (string)$it['parent'], $sel));
            if (count($parents) === 1 && $sel[0]['parent'] !== null && isset($frames[$sel[0]['parent']])) {
                $frame = $frames[$sel[0]['parent']];
            }
        }
        $z = AiLayout::zAbove($this->items->contentZ($board), 1)[0];
        return AiLayout::cardOps($hulls, $frame, $md, $frame === null ? '' : AiLayout::textOf($frame), $this->ulid(), $z, $this->obstacles($board));
    }

    /** @return array|string the clustering's ops, or the failure code */
    private function planCluster(int $board, array $st, mixed $output, \OCP\IUser $user): array|string {
        $lang = $this->l10n->getUserLanguage($user);
        $other = $this->l10n->get(Application::APP_ID, $lang)->t('Other');
        $topics = AiLayout::topics($output, count($st['ids']), $other);
        if ($topics === null) {
            return 'ai_answer';
        }
        $frame = null;
        if ($st['f'] !== null) {
            $frame = $this->live($board, [$st['f']])[0] ?? null;
            if ($frame === null || $frame['t'] !== 'frame' || $frame['locked']) {
                return 'ai_gone';
            }
        }
        $now = [];
        foreach ($this->live($board, $st['ids']) as $it) {
            $now[$it['id']] = $it;
        }
        // notes that changed meanwhile (deleted, locked, grouped, moved to another parent) stay where they are
        $want = $frame === null ? null : $frame['id'];
        $notes = [];
        $map = [];
        foreach ($st['ids'] as $i => $id) {
            $it = $now[$id] ?? null;
            if ($it !== null && $it['t'] === 'sticky' && !$it['locked'] && $it['group'] === null && $it['parent'] === $want) {
                $map[$i] = count($notes);
                $notes[] = $it;
            }
        }
        $kept = [];
        foreach ($topics as $t) {
            $ns = array_values(array_filter(array_map(static fn (int $i): ?int => $map[$i] ?? null, $t['notes']), static fn (?int $i): bool => $i !== null));
            if ($ns !== []) {
                $kept[] = ['title' => $t['title'], 'notes' => $ns];
            }
        }
        if ($kept === []) {
            return 'ai_gone';
        }
        $ids = array_map(fn (): string => $this->ulid(), $kept);
        $zs = AiLayout::zAbove($this->items->contentZ($board), count($kept));
        return AiLayout::clusterOps($notes, $kept, $frame, $ids, $zs);
    }

    // ── Requests ─────────────────────────────────────────────────────────

    /**
     * @return array{0: string, 1: list<string>} prompt, the ids kept in the state
     * @throws HttpError 400 ai_empty|ai_too_much
     */
    private function summaryRequest(int $board, array $ids, ?string $frame): array {
        $sel = $this->live($board, $ids);
        $frameIds = array_map(static fn (array $it): string => $it['id'], array_filter($sel, static fn (array $it): bool => $it['t'] === 'frame'));
        $kids = [];
        if ($frameIds !== []) {
            $childIds = array_keys($this->items->liveChildren($board, array_values($frameIds)));
            if (count($childIds) + count($sel) > AiLayout::MAX_ITEMS) {
                throw new HttpError(400, 'ai_too_much', '', ['max' => AiLayout::MAX_ITEMS]);
            }
            foreach ($this->live($board, array_map('strval', $childIds)) as $k) {
                $kids[(string)$k['parent']][] = $k;
            }
        }
        $in = AiLayout::summaryInput($sel, $kids);
        if ($in['items'] > AiLayout::MAX_ITEMS || $in['chars'] > AiLayout::MAX_CHARS) {
            throw new HttpError(400, 'ai_too_much', '', ['max' => AiLayout::MAX_ITEMS]);
        }
        if ($in['text'] === '' || $in['chars'] === 0) {
            throw new HttpError(400, 'ai_empty');
        }
        return [AiLayout::summaryPrompt($in['text']), array_map(static fn (array $it): string => $it['id'], $sel)];
    }

    /**
     * @return array{0: string, 1: list<string>} prompt, the note ids in prompt order
     * @throws HttpError 400 ai_empty|ai_too_much
     */
    private function clusterRequest(int $board, array $ids, ?string $frame): array {
        $f = null;
        $children = [];
        if ($frame !== null) {
            $f = $this->live($board, [$frame])[0] ?? null;
            if ($f === null || $f['t'] !== 'frame' || $f['locked']) {
                throw new HttpError(400, 'ai_empty');
            }
            $childIds = array_map('strval', array_keys($this->items->liveChildren($board, [$frame])));
            if (count($childIds) > 1000) {
                throw new HttpError(400, 'ai_too_much', '', ['max' => AiLayout::CLUSTER_MAX]);
            }
            $children = $this->live($board, $childIds);
        }
        $notes = AiLayout::sortable($f === null ? $this->live($board, $ids) : [], $f, $children);
        $notes = array_values(array_filter($notes, static fn (array $n): bool => AiLayout::textOf($n) !== ''));
        if (count($notes) < AiLayout::CLUSTER_MIN) {
            throw new HttpError(400, 'ai_empty');
        }
        $chars = array_sum(array_map(static fn (array $n): int => mb_strlen(AiLayout::textOf($n), 'UTF-8'), $notes));
        if (count($notes) > AiLayout::CLUSTER_MAX || $chars > AiLayout::MAX_CHARS) {
            throw new HttpError(400, 'ai_too_much', '', ['max' => AiLayout::CLUSTER_MAX]);
        }
        return [AiLayout::clusterPrompt($notes), array_map(static fn (array $n): string => $n['id'], $notes)];
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /**
     * The live items of $ids on this board, in the order of $ids.
     *
     * @param list<string> $ids
     * @return list<array> AiLayout::item maps
     */
    private function live(int $board, array $ids): array {
        if ($ids === []) {
            return [];
        }
        $rows = $this->items->loadItems($board, $ids);
        $out = [];
        foreach ($ids as $id) {
            $r = $rows[$id] ?? null;
            if ($r === null) {
                continue;
            }
            $it = AiLayout::item($r);
            if (!$it['deleted']) {
                $out[] = $it;
            }
        }
        return $out;
    }

    /**
     * The absolute boxes of the live items of the board (connectors have
     * none): what the card must not cover (round 1).
     *
     * @return list<array{id: string, 0: float, 1: float, 2: float, 3: float}>
     */
    private function obstacles(int $board): array {
        $rows = $this->items->sketchBoxes($board);
        $byId = [];
        foreach ($rows as $r) {
            $byId[(string)$r['id']] = $r;
        }
        $out = [];
        foreach ($rows as $r) {
            $x = (float)$r['x'];
            $y = (float)$r['y'];
            $p = $r['parent_id'] === null ? null : ($byId[(string)$r['parent_id']] ?? null);
            if ($p !== null && $p['type'] === 'frame') {
                $x += (float)$p['x'];
                $y += (float)$p['y'];
            }
            $out[] = ['id' => (string)$r['id'], $x, $y, $x + (float)$r['w'], $y + (float)$r['h']];
        }
        return $out;
    }

    /** @return array<string, array> the live frames that are parents of $items, by id */
    private function parents(int $board, array $items): array {
        $ids = array_values(array_unique(array_filter(array_map(static fn (array $it): ?string => $it['parent'], $items))));
        $out = [];
        foreach ($this->live($board, $ids) as $f) {
            if ($f['t'] === 'frame') {
                $out[$f['id']] = $f;
            }
        }
        return $out;
    }

    /** @return array{text: ?string, url: string, hash: string} the notice in the account's language */
    private function noticeFor(string $uid): array {
        $lang = $this->l10n->getUserLanguage($this->users->get($uid));
        $n = $this->notice->resolve($lang);
        return $n + ['hash' => substr(hash('sha256', json_encode([$n['text'], $n['url']], JSON_THROW_ON_ERROR)), 0, 16)];
    }

    private static function day(int $nowMs): string {
        return gmdate('Y-m-d', intdiv($nowMs, 1000));
    }

    private function usedToday(string $uid, int $nowMs): int {
        $v = $this->config->getUserValue($uid, Application::APP_ID, self::PREF_DAY, '');
        $parts = explode(' ', $v);
        return count($parts) === 2 && $parts[0] === self::day($nowMs) && ctype_digit($parts[1]) ? (int)$parts[1] : 0;
    }

    private function count(string $uid, int $nowMs): void {
        $this->config->setUserValue($uid, Application::APP_ID, self::PREF_DAY, self::day($nowMs) . ' ' . ($this->usedToday($uid, $nowMs) + 1));
    }

    /**
     * The account's tasks on $board for the client (route 59): {task, kind,
     * status: running|done|failed, error?, ops?, inverse?, select?}; states
     * older than KEEP_MS (any board) are dropped.
     *
     * @return list<array>
     */
    private function tasks(string $uid, int $board, int $nowMs): array {
        $out = [];
        foreach ($this->config->getUserKeys($uid, Application::APP_ID) as $key) {
            if (!str_starts_with((string)$key, self::PREF_TASK)) {
                continue;
            }
            $tid = (int)substr((string)$key, strlen(self::PREF_TASK));
            $st = $this->readState($uid, $tid);
            if ($st === null || $nowMs - $st['at'] > self::KEEP_MS) {
                $this->config->deleteUserValue($uid, Application::APP_ID, (string)$key);
                continue;
            }
            if ($st['b'] !== $board) {
                continue;
            }
            if ($st['s'] === 'run') {
                $st = $this->checkTask($uid, $tid, $st, $nowMs);
            }
            $t = ['task' => $tid, 'kind' => $st['k'], 'status' => $st['s'] === 'run' ? 'running' : $st['s'], 'at' => $st['at']];
            if ($st['s'] === 'failed') {
                $t['error'] = $st['e'] ?? 'ai_failed';
            }
            if ($st['k'] === 'diagram') {
                $t['shape'] = $st['sh'];
                if ($st['s'] === 'done' && $st['sh'] === 'workshop') {
                    $t['workshop'] = $st['workshop'] ?? null;
                } elseif ($st['s'] === 'done' && $st['sh'] === 'flowchart') {
                    $t['flow'] = $st['flow'] ?? null;
                } elseif ($st['s'] === 'done') {
                    $t['tree'] = $st['tree'] ?? null;
                }
            } elseif ($st['s'] === 'done') {
                $t['ops'] = self::wireOps($st['ops'] ?? []);
                $t['inverse'] = self::wireOps($st['inv'] ?? []);
                $t['select'] = $st['sel'] ?? [];
            }
            $out[] = $t;
        }
        usort($out, static fn (array $a, array $b): int => $a['at'] <=> $b['at'] ?: $a['task'] <=> $b['task']);
        return $out;
    }

    /**
     * A running state whose task Nextcloud cancelled, lost or failed without
     * the event: failed. (Round 2) One that ended more than FINISH_LATE_S ago
     * but is still running here (the event was missed): finished now.
     */
    private function checkTask(string $uid, int $tid, array $st, int $nowMs): array {
        $task = null;
        try {
            $task = $this->tasks->getUserTask($tid, $uid);
            $status = $task->getStatus();
        } catch (\Throwable) {
            $status = Task::STATUS_UNKNOWN;
        }
        if ($task !== null && in_array($status, [Task::STATUS_SUCCESSFUL, Task::STATUS_FAILED], true)
            && $task->getEndedAt() !== null && intdiv($nowMs, 1000) - $task->getEndedAt() > self::FINISH_LATE_S) {
            $this->finish($task, $nowMs);
            return $this->readState($uid, $tid) ?? $st;
        }
        if (in_array($status, [Task::STATUS_SCHEDULED, Task::STATUS_RUNNING, Task::STATUS_SUCCESSFUL], true)) {
            return $st;
        }
        $st = ['s' => 'failed', 'e' => $status === Task::STATUS_CANCELLED ? 'ai_cancelled' : 'ai_failed'] + $st;
        $this->config->setUserValue($uid, Application::APP_ID, self::PREF_TASK . $tid, self::encode($st));
        return $st;
    }

    private function readState(string $uid, int $tid): ?array {
        return self::decode($this->config->getUserValue($uid, Application::APP_ID, self::PREF_TASK . $tid, ''));
    }

    /** A stored state, null when unreadable. */
    public static function decode(string $raw): ?array {
        if ($raw === '') {
            return null;
        }
        $d = json_decode($raw, true);
        if (!is_array($d) || !is_int($d['b'] ?? null) || !in_array($d['k'] ?? null, self::KINDS, true) || !is_array($d['ids'] ?? null)
            || !is_int($d['at'] ?? null) || !in_array($d['s'] ?? null, ['run', 'done', 'failed'], true)) {
            return null;
        }
        $d['f'] = is_string($d['f'] ?? null) ? $d['f'] : null;
        if ($d['k'] === 'diagram' && !in_array($d['sh'] ?? null, AiLayout::DIAGRAM_SHAPES, true)) {
            return null;
        }
        return $d;
    }

    private static function encode(array $st): string {
        return json_encode($st, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * Ops for JSON: the maps p, p.data and p.style as objects also when
     * empty (PHP arrays would turn into []).
     *
     * @param list<array> $ops
     * @return list<array>
     */
    public static function wireOps(array $ops): array {
        foreach ($ops as &$op) {
            if (!isset($op['p']) || !is_array($op['p'])) {
                continue;
            }
            foreach (['data', 'style'] as $k) {
                if (array_key_exists($k, $op['p']) && $op['p'][$k] === []) {
                    $op['p'][$k] = new \stdClass();
                }
            }
        }
        return $ops;
    }

    /** A new item id (ULID: 10 characters time in ms, 16 random). */
    private function ulid(): string {
        $ms = (int)floor(microtime(true) * 1000);
        $time = '';
        for ($i = 0; $i < 10; $i++) {
            $time = self::ULID_CHARS[$ms % 32] . $time;
            $ms = intdiv($ms, 32);
        }
        return $time . $this->random->generate(16, self::ULID_CHARS);
    }
}
