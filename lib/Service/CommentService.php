<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\CommentMentionStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Db\ShareStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Notification\CommentNotifications;
use OCP\App\IAppManager;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Collaboration\Collaborators\ISearch;
use OCP\Comments\IComment;
use OCP\Comments\ICommentsManager;
use OCP\Comments\NotFoundException;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use OCP\Share\IShare;
use OCP\Teams\ITeamManager;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Comment threads of a board (factory job 189, routes 35–43) in Nextcloud's
 * own comment store (ICommentsManager, the core table oc_comments, as Deck
 * does): no table, no migration and no version jump.
 *
 * Storage: object knorke_board/<board id>, verb comment; author users/<uid>
 * for accounts, knorke_guests/<gid> for guests (the g of the guest token).
 * A thread is its first comment (parent 0) plus the replies, whose parent
 * is always the first comment. Knorke writes meta_data only under the key
 * `knorke`: per comment name (a guest's name when writing, cut like a
 * reaction's to COMMENT_NAME_MAX; null for accounts, whose name is read
 * fresh), edited (ms or null) and mentions (uids); the first comment adds
 * item (an item id or null), x/y (world coordinates of the spot) and
 * resolved. Without supports4ByteText() text and name go through Input::bmp.
 *
 * Rights: every role reads; writing (thread, reply, resolve, reopen, spot)
 * needs Role::canVote() (owner, edit, vote, guests of both links) → else
 * 403 forbidden; text only of one's own comments (same uid or gid); delete
 * one's own, or any with canModerate(). Then the budget knorke-comment
 * (COMMENT_WRITE_LIMIT per COMMENT_WRITE_PERIOD s and account; guests
 * knorke-comment-<gid> per IP) → 429 slow_down; then the body (400).
 *
 * Every write is one transaction: lockBoard first (gone: 404), the
 * comments read and written under the lock (ICommentsManager::save writes
 * the whole row, the lock keeps two writers apart), meta.comments + 1
 * through MetaService::writeLocked (a whole number, missing while there
 * were never comments), COMMIT, then FastCache::bumpRev (every poller
 * leaves the fast path once and reloads the comments), then the
 * notifications (CommentNotifications; failures are logged, the answer
 * stays). A write without effect (resolve a resolved thread, the same
 * text, the same spot) writes nothing and bumps nothing.
 *
 * Mentions (accounts only): Nextcloud's IComment::getMentions() of type
 * user; at most COMMENT_MENTIONS uids that may see the board now (the rule
 * of route 39: owner, a share to the account, its groups or teams, a valid
 * link membership; an account that exists, is enabled and may open Knorke)
 * are stored, written as @"<uid>"; everything else stays text. Guests'
 * comments have no mentions.
 *
 * Deleted accounts (factory job 249, onUserDeleted): every stored mention
 * of the uid becomes @"deleted_users" (DELETED_MENTION, Nextcloud's
 * ICommentsManager::DELETED_USER) and leaves meta mentions, so an account
 * created later with the same uid never shows up there; parts() shows that
 * token as {m: DELETED_NAME, gone: true} unless an account of that id is a
 * stored mention. Search rules (route 39): while Nextcloud restricts whom
 * users may find (SharePolicy::searchRestricted), the @ list keeps only
 * accounts Nextcloud's ISearch finds for the session user.
 *
 * Nextcloud's DAV comment endpoint stays closed: Knorke registers no
 * CommentsEntityEvent.
 */
class CommentService {
    use TTransactional;

    public const OBJECT_TYPE = 'knorke_board';
    public const VERB = 'comment';
    public const USER_ACTOR = 'users';
    public const GUEST_ACTOR = 'knorke_guests';
    public const META_KEY = 'knorke';
    /** Items a thread can hang on. */
    public const ITEM_TYPES = ['sticky', 'shape', 'text', 'frame', 'table', 'mindmap'];
    /** The name of an account that was deleted (Nextcloud's ICommentsManager::DELETED_USER). */
    public const DELETED_NAME = 'Deleted user';
    /** The token id a deleted account's mention becomes (ICommentsManager::DELETED_USER). */
    public const DELETED_MENTION = 'deleted_users';
    /** A comment id on the wire: a decimal number, no sign, no leading zero. */
    public const ID_RE = '/^[1-9][0-9]{0,18}\z/';
    /**
     * Nextcloud's mention syntax (OC\Comments\Comment::getMentions of
     * Nextcloud 34): the same pattern, so the parts of a comment cut exactly
     * where getMentions() found the mention.
     */
    public const MENTION_RE = '/\B(?<![^a-z0-9_\-@\.\'\s])@("(guest|email)\/[a-f0-9]+"|"(?:federated_)?(?:group|team|user){1}\/[a-z0-9_\-@\.\' \/:]+"|"[a-z0-9_\-@\.\' ]+"|[a-z0-9_\-@\.\']+)/i';

    /** @var array<string, string> uid → display name of this request */
    private array $names = [];
    /** @var array<string, string> principal id → pid of this request */
    private array $pids = [];
    private ?ITeamManager $teams = null;

    public function __construct(
        private ICommentsManager $comments,
        private BoardStore $boards,
        private ItemStore $items,
        private ShareStore $shares,
        private MetaService $meta,
        private FastCache $cache,
        private Access $access,
        private LinkPolicy $linkPolicy,
        private SharePolicy $sharePolicy,
        private IUserManager $users,
        private IGroupManager $groups,
        private IAppManager $apps,
        private GuestsAppWhitelist $guestsApp,
        private ILimiter $limiter,
        private IDBConnection $db,
        private ITimeFactory $time,
        private CommentNotifications $notifications,
        private ContainerInterface $container,
        private LoggerInterface $logger,
        private ?CommentMentionStore $mentionStore = null,
    ) {
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /**
     * Routes 35 and 40: {threads: [{id, item, x, y, resolved, comments: [{id,
     * name, guest, pid, mine, parts, at, edited}]}]}, threads and comments
     * ascending. Only on $p's own comments of an account: raw (the stored
     * text) and mentions {uid: name}; nobody else ever sees a uid.
     */
    public function threads(Principal $p, int $board): array {
        $this->forget();
        $out = [];
        foreach ($this->load($board) as [$root, $replies]) {
            $out[] = $this->threadJson($p, $board, $root, $replies);
        }
        return ['threads' => $out];
    }

    /** One thread as in threads(); 404 when it is gone. */
    public function thread(Principal $p, int $board, string $id): array {
        $this->forget();
        foreach ($this->load($board) as [$root, $replies]) {
            if ($root->getId() === $id) {
                return $this->threadJson($p, $board, $root, $replies);
            }
        }
        throw new HttpError(404, 'not_found');
    }

    /**
     * The comments of a board as threads: [first comment, replies], both by
     * id ascending; a reply whose first comment is gone is left out.
     *
     * @return list<array{0: IComment, 1: list<IComment>}>
     */
    private function load(int $board): array {
        $roots = [];
        $replies = [];
        foreach ($this->comments->getForObject(self::OBJECT_TYPE, (string)$board) as $c) {
            if ($c->getVerb() !== self::VERB) {
                continue;
            }
            if (self::isRoot($c)) {
                $roots[$c->getId()] = $c;
            } else {
                $replies[$c->getParentId()][] = $c;
            }
        }
        uksort($roots, static fn ($a, $b): int => self::cmpId((string)$a, (string)$b));
        $out = [];
        foreach ($roots as $id => $root) {
            $list = $replies[(string)$id] ?? [];
            usort($list, static fn (IComment $a, IComment $b): int => self::cmpId($a->getId(), $b->getId()));
            $out[] = [$root, $list];
        }
        return $out;
    }

    /** @param list<IComment> $replies */
    private function threadJson(Principal $p, int $board, IComment $root, array $replies): array {
        $k = self::knorke($root);
        $comments = [];
        foreach ([$root, ...$replies] as $c) {
            $comments[] = $this->commentJson($p, $board, $c);
        }
        return [
            'id' => $root->getId(),
            'item' => is_string($k['item'] ?? null) ? $k['item'] : null,
            // job 195: the node of a mind map (null for every other thread)
            'node' => is_string($k['node'] ?? null) && preg_match(Mindmaps::NODE_RE, $k['node']) === 1 ? $k['node'] : null,
            'x' => self::num($k['x'] ?? 0),
            'y' => self::num($k['y'] ?? 0),
            'resolved' => ($k['resolved'] ?? false) === true,
            'comments' => $comments,
        ];
    }

    private function commentJson(Principal $p, int $board, IComment $c): array {
        $k = self::knorke($c);
        $mentions = self::uidList($k['mentions'] ?? null);
        $mine = self::isMine($p, $c);
        $out = [
            'id' => $c->getId(),
            'name' => $this->authorName($c),
            'guest' => $c->getActorType() === self::GUEST_ACTOR,
            'pid' => $this->pidOf($board, $c),
            'mine' => $mine,
            'parts' => self::parts($c->getMessage(), $mentions, fn (string $uid): string => $this->displayName($uid)),
            'at' => self::ms($c),
            'edited' => is_int($k['edited'] ?? null) ? $k['edited'] : null,
        ];
        if ($mine && !$p->isGuest) {
            $map = [];
            foreach ($mentions as $uid) {
                $map[$uid] = $this->displayName($uid);
            }
            if (!isset($map[self::DELETED_MENTION]) && str_contains($c->getMessage(), '@"' . self::DELETED_MENTION . '"')) {
                $map[self::DELETED_MENTION] = self::DELETED_NAME;
            }
            $out['raw'] = $c->getMessage();
            $out['mentions'] = $map === [] ? new \stdClass() : $map;
        }
        return $out;
    }

    /**
     * The text of a comment as parts: strings and {m: name} for every stored
     * mention (the token @"uid" or @uid of a uid in $mentions), {m:
     * DELETED_NAME, gone: true} for the token @"deleted_users" of a deleted
     * account (job 249) unless that id is a stored mention. Never a uid.
     *
     * @param list<string> $mentions stored uids
     * @param callable(string): string $nameOf uid → display name
     * @return list<string|array{m: string, gone?: true}>
     */
    public static function parts(string $message, array $mentions, callable $nameOf): array {
        $out = [];
        $pos = 0;
        $buf = '';
        $gone = '@"' . self::DELETED_MENTION . '"';
        if (($mentions !== [] || str_contains($message, $gone)) && preg_match_all(self::MENTION_RE, $message, $hits, PREG_OFFSET_CAPTURE | PREG_SET_ORDER) > 0) {
            foreach ($hits as $hit) {
                [$token, $at] = $hit[0];
                $id = trim(substr($token, 1), '"');
                $known = in_array($id, $mentions, true);
                if (!$known && $token !== $gone) {
                    continue;
                }
                $buf .= substr($message, $pos, $at - $pos);
                if ($buf !== '') {
                    $out[] = $buf;
                    $buf = '';
                }
                $out[] = $known ? ['m' => $nameOf($id)] : ['m' => self::DELETED_NAME, 'gone' => true];
                $pos = $at + strlen($token);
            }
        }
        $buf .= substr($message, $pos);
        if ($buf !== '') {
            $out[] = $buf;
        }
        return $out;
    }

    /** The text with every stored mention as "@name" (notifications). */
    public static function plainText(string $message, array $mentions, callable $nameOf): string {
        $out = '';
        foreach (self::parts($message, $mentions, $nameOf) as $part) {
            $out .= is_string($part) ? $part : '@' . $part['m'];
        }
        return $out;
    }

    // ── Writing ─────────────────────────────────────────────────────────────

    /**
     * Routes 36 and 41: {text, thread} a reply, {text, x, y, item?} a new
     * thread (an item that is no live sticky, shape, text, frame or table of
     * this board makes it a free one at x/y). Answer: the thread.
     *
     * @throws HttpError 400 bad_request|comment_empty|comment_too_long, 403, 404, 409 thread_resolved|comments_full, 429
     */
    public function create(Principal $p, int $board, array $body, string $ip, int $nowMs): array {
        $this->gate($p, $ip);
        $text = self::text($body['text'] ?? null);
        $thread = ($body['thread'] ?? null) === null ? null : self::id($body['thread']);
        $x = $y = 0.0;
        $item = null;
        $node = null;
        if ($thread !== null) {
            if (array_intersect(array_keys($body), ['x', 'y', 'item', 'node']) !== []) {
                throw new HttpError(400, 'bad_request', 'A reply has no spot.');
            }
        } else {
            $x = self::coord($body['x'] ?? null);
            $y = self::coord($body['y'] ?? null);
            $item = $body['item'] ?? null;
            if ($item !== null && !is_string($item)) {
                throw new HttpError(400, 'bad_request', 'item must be an item id or null.');
            }
            // job 195: the node of a mind map the thread hangs on
            $node = $body['node'] ?? null;
            if ($node !== null && !is_string($node)) {
                throw new HttpError(400, 'bad_request', 'node must be a node key or null.');
            }
        }
        $out = $this->write($board, $nowMs, function (array $row) use ($p, $board, $text, $thread, $x, $y, $item, $node, $nowMs): array {
            $this->checkRoom($board);
            [$message, $mentions] = $this->prepareText($p, $board, $text);
            if ($thread === null) {
                $live = $this->liveItem($board, $item);
                $k = ['mentions' => $mentions, 'item' => $live, 'x' => $x, 'y' => $y, 'resolved' => false];
                $n = $this->liveNode($board, $live, $node);
                if ($n !== null) {
                    $k['node'] = $n;
                }
                $c = $this->newComment($p, $board, $message, '0', $nowMs, $k);
                $id = $c->getId();
                return ['thread' => $id, 'notify' => fn () => $this->notifications->mentioned($id, $mentions, $p->uid)];
            }
            $root = $this->root($board, $thread);
            if (self::resolved($root)) {
                throw new HttpError(409, 'thread_resolved');
            }
            $writers = $this->accountWriters($board, $root);
            $c = $this->newComment($p, $board, $message, $root->getId(), $nowMs, ['mentions' => $mentions]);
            $id = $c->getId();
            $rootId = $root->getId();
            return ['thread' => $rootId, 'notify' => function () use ($id, $rootId, $mentions, $writers, $p): void {
                $this->notifications->mentioned($id, $mentions, $p->uid);
                $this->notifications->replied($rootId, $id, array_values(array_diff($writers, $mentions)), $p->uid);
            }];
        });
        return ['thread' => $this->thread($p, $board, $out['thread'])];
    }

    /**
     * Routes 37 and 42: {comment, text} edits one's own comment, {comment,
     * resolved} resolves or reopens a thread (first comment only), {comment,
     * x, y} moves the spot of a thread with an item (first comment only).
     * Exactly one of the three. Answer: the thread.
     *
     * @throws HttpError 400, 403, 404, 429
     */
    public function update(Principal $p, int $board, array $body, string $ip, int $nowMs): array {
        $this->gate($p, $ip);
        $id = self::id($body['comment'] ?? null);
        $hasText = array_key_exists('text', $body);
        $hasResolved = array_key_exists('resolved', $body);
        $hasSpot = array_key_exists('x', $body) || array_key_exists('y', $body);
        if ((int)$hasText + (int)$hasResolved + (int)$hasSpot !== 1) {
            throw new HttpError(400, 'bad_request', 'Send text, resolved or x and y.');
        }
        $text = $hasText ? self::text($body['text']) : '';
        $resolved = $body['resolved'] ?? null;
        if ($hasResolved && !is_bool($resolved)) {
            throw new HttpError(400, 'bad_request', 'resolved must be true or false.');
        }
        $x = $hasSpot ? self::coord($body['x'] ?? null) : 0.0;
        $y = $hasSpot ? self::coord($body['y'] ?? null) : 0.0;
        $out = $this->write($board, $nowMs, function (array $row) use ($p, $board, $id, $hasText, $hasResolved, $text, $resolved, $x, $y, $nowMs): array {
            $c = $this->comment($board, $id);
            $rootId = self::isRoot($c) ? $c->getId() : $c->getParentId();
            if ($hasText) {
                if (!self::isMine($p, $c)) {
                    throw new HttpError(403, 'forbidden');
                }
                [$message, $mentions] = $this->prepareText($p, $board, $text);
                $k = self::knorke($c);
                $old = self::uidList($k['mentions'] ?? null);
                if ($message === $c->getMessage() && $mentions === $old) {
                    return ['thread' => $rootId, 'changed' => false];
                }
                $c->setMessage($message, Limits::COMMENT_MAX);
                $k['mentions'] = $mentions;
                $k['edited'] = $nowMs;
                $this->save($c, $k);
                $cid = $c->getId();
                $added = array_values(array_diff($mentions, $old));
                $removed = array_values(array_diff($old, $mentions));
                return ['thread' => $rootId, 'notify' => function () use ($cid, $added, $removed, $p): void {
                    $this->notifications->mentioned($cid, $added, $p->uid);
                    $this->notifications->unmentioned($cid, $removed);
                }];
            }
            if (!self::isRoot($c)) {
                throw new HttpError(400, 'bad_request', 'Only the first comment of a thread has this.');
            }
            $k = self::knorke($c);
            if ($hasResolved) {
                if (self::resolved($c) === $resolved) {
                    return ['thread' => $rootId, 'changed' => false];
                }
                $k['resolved'] = $resolved;
            } else {
                if (!is_string($k['item'] ?? null)) {
                    throw new HttpError(400, 'bad_request', 'Only a thread on an item moves its spot.');
                }
                // stored JSON writes 100.0 as 100: compare as floats
                if ((float)self::num($k['x'] ?? null) === $x && (float)self::num($k['y'] ?? null) === $y) {
                    return ['thread' => $rootId, 'changed' => false];
                }
                $k['x'] = $x;
                $k['y'] = $y;
            }
            $this->save($c, $k);
            return ['thread' => $rootId];
        });
        return ['thread' => $this->thread($p, $board, $out['thread'])];
    }

    /**
     * Routes 38 and 43 `?comment=<id>`: one's own comment, or any with
     * canModerate(). The first comment of a thread takes its replies with
     * it: the replies first, then itself (ICommentsManager::delete removes
     * one row). Answer: {deleted: [ids]}.
     *
     * @throws HttpError 400, 403, 404, 429
     */
    public function delete(Principal $p, int $board, mixed $commentId, string $ip, int $nowMs): array {
        $this->gate($p, $ip);
        $id = self::id($commentId);
        $out = $this->write($board, $nowMs, function (array $row) use ($p, $board, $id): array {
            $c = $this->comment($board, $id);
            if (!self::isMine($p, $c) && !$p->canModerate()) {
                throw new HttpError(403, 'forbidden');
            }
            $ids = [];
            $root = self::isRoot($c);
            if ($root) {
                foreach ($this->load($board) as [$r, $replies]) {
                    if ($r->getId() !== $c->getId()) {
                        continue;
                    }
                    foreach ($replies as $reply) {
                        $this->comments->delete($reply->getId());
                        $ids[] = $reply->getId();
                    }
                }
            }
            $this->comments->delete($c->getId());
            $ids[] = $c->getId();
            $thread = $root ? $c->getId() : null;
            return ['deleted' => $ids, 'notify' => fn () => $this->notifications->deleted($ids, $thread)];
        });
        return ['deleted' => $out['deleted']];
    }

    /**
     * Route 39 `?q=` (0–64 characters): the accounts the @ list offers,
     * {accounts: [{id, name}]}, at most MENTION_RESULTS, by name. Candidates:
     * the owner, shares to accounts, the members of shared groups and teams
     * (at most MENTION_MEMBERS_MAX each), valid link members (while links
     * count for the owner); without the asking account and accounts that do
     * not exist, are disabled or may not open Knorke (the Notifier's checks).
     * q matches uid or display name, case-insensitive. Accounts with the
     * right to write only.
     *
     * @throws HttpError 400 bad_request, 403 forbidden, 404
     */
    public function mentionable(Principal $p, int $board, string $q): array {
        if ($p->isGuest || !$p->role->canVote()) {
            throw new HttpError(403, 'forbidden');
        }
        if (!mb_check_encoding($q, 'UTF-8') || mb_strlen($q, 'UTF-8') > Limits::MENTION_QUERY_MAX) {
            throw new HttpError(400, 'bad_request', 'q must have at most ' . Limits::MENTION_QUERY_MAX . ' characters.');
        }
        $row = $this->boards->findBoard($board) ?? throw new HttpError(404, 'not_found');
        $needle = mb_strtolower(trim($q), 'UTF-8');
        $findable = $this->sharePolicy->searchRestricted() ? $this->findable($q) : null;
        $out = [];
        foreach ($this->candidates($board, $row) as $uid) {
            if ($findable !== null && !isset($findable[$uid])) {
                continue;
            }
            $user = $this->users->get($uid);
            if ($user === null || !$user->isEnabled() || $user->getUID() === $p->uid || isset($out[$user->getUID()]) || !$this->appAccess($user)) {
                continue;
            }
            $name = $user->getDisplayName();
            if ($needle !== '' && !str_contains(mb_strtolower($user->getUID(), 'UTF-8'), $needle) && !str_contains(mb_strtolower($name, 'UTF-8'), $needle)) {
                continue;
            }
            $out[$user->getUID()] = ['id' => $user->getUID(), 'name' => $name];
        }
        $list = array_values($out);
        usort($list, static fn (array $a, array $b): int => [mb_strtolower($a['name'], 'UTF-8'), $a['id']] <=> [mb_strtolower($b['name'], 'UTF-8'), $b['id']]);
        return ['accounts' => array_slice($list, 0, Limits::MENTION_RESULTS)];
    }

    /**
     * A deleted account (job 249; UserDeletedListener, OrphanReconciler):
     * every stored mention of $uid becomes @"deleted_users" and $uid leaves
     * meta mentions; edited stays. One transaction per board (lockBoard
     * first, the comments read fresh under the lock), meta_rev + 1 through
     * writeLocked and bumpRev after COMMIT when a comment changed. A board
     * that fails is logged and skipped. Answer: the comments rewritten.
     */
    public function onUserDeleted(string $uid): int {
        if ($uid === '' || $this->mentionStore === null) {
            return 0;
        }
        $n = 0;
        foreach ($this->mentionStore->mentioning($uid) as $board => $ids) {
            try {
                $n += $this->forgetMentions((int)$board, $ids, $uid);
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: rewriting the mentions of a deleted account failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
            }
        }
        return $n;
    }

    /** @param list<string> $ids */
    private function forgetMentions(int $board, array $ids, string $uid): int {
        $nowMs = $this->nowMs();
        $out = $this->atomic(function () use ($board, $ids, $uid, $nowMs): array {
            if ($this->boards->lockBoard($board, false, null, $nowMs) === null) {
                return ['n' => 0, 'metaRev' => null];
            }
            $n = 0;
            foreach ($ids as $id) {
                try {
                    $c = $this->comment($board, $id);
                } catch (HttpError) {
                    continue;
                }
                $k = self::knorke($c);
                $mentions = self::uidList($k['mentions'] ?? null);
                if (!in_array($uid, $mentions, true)) {
                    continue;
                }
                $message = $c->getMessage();
                $text = preg_replace_callback(self::MENTION_RE, static function (array $hit) use ($uid): string {
                    return trim(substr($hit[0], 1), '"') === $uid ? '@"' . self::DELETED_MENTION . '"' : $hit[0];
                }, $message) ?? $message;
                $c->setMessage($text, 0);
                $k['mentions'] = array_values(array_filter($mentions, static fn (string $m): bool => $m !== $uid));
                $this->save($c, $k);
                $n++;
            }
            if ($n === 0) {
                return ['n' => 0, 'metaRev' => null];
            }
            $w = $this->meta->writeLocked($board, static fn (array $m): array => $m, $nowMs);
            return ['n' => $n, 'metaRev' => $w['metaRev']];
        }, $this->db);
        // After COMMIT, never before (as write()).
        if ($out['metaRev'] !== null) {
            $this->cache->bumpRev($board, $out['metaRev']);
        }
        return $out['n'];
    }

    /**
     * The role of an account on a board now (owner, a share, a valid link
     * membership while links count), null without one: who may be
     * mentioned, and whom Notifier still shows a notification.
     */
    public function roleOf(int $board, IUser $user): ?Role {
        $uid = $user->getUID();
        $row = $this->boards->findBoardForUser($board, $uid, $this->nowMs());
        if ($row === null) {
            return null;
        }
        if ($row['owner'] === $uid) {
            return Role::Owner;
        }
        return $this->access->memberRole($board, $row, $user, $this->linkPolicy->allows((string)$row['owner']))[0];
    }

    /**
     * What Notifier shows for the comment $id: board, its title, the thread,
     * the author ({type: user|guest|deleted, id, name}) and the text with
     * @name; null when the comment, its thread or the board is gone.
     *
     * @return array{board: int, title: string, thread: string, author: array{type: string, id: string, name: string}, text: string, mentions: list<string>}|null
     */
    public function noteContext(string $id): ?array {
        if (preg_match(self::ID_RE, $id) !== 1) {
            return null;
        }
        try {
            $c = $this->comments->get($id);
        } catch (NotFoundException) {
            return null;
        }
        if ($c->getObjectType() !== self::OBJECT_TYPE || $c->getVerb() !== self::VERB || preg_match(self::ID_RE, $c->getObjectId()) !== 1) {
            return null;
        }
        $board = (int)$c->getObjectId();
        $thread = self::isRoot($c) ? $c->getId() : $c->getParentId();
        if (!self::isRoot($c)) {
            try {
                $root = $this->comments->get($thread);
            } catch (NotFoundException) {
                return null;
            }
            if ($root->getObjectType() !== self::OBJECT_TYPE || $root->getObjectId() !== $c->getObjectId()) {
                return null;
            }
        }
        $row = $this->boards->findBoard($board);
        if ($row === null) {
            return null;
        }
        $this->forget();
        $k = self::knorke($c);
        $mentions = self::uidList($k['mentions'] ?? null);
        $type = match ($c->getActorType()) {
            self::USER_ACTOR => $this->users->get($c->getActorId()) === null ? 'deleted' : 'user',
            self::GUEST_ACTOR => 'guest',
            default => 'deleted',
        };
        return [
            'board' => $board,
            'title' => (string)$row['title'],
            'thread' => $thread,
            'author' => ['type' => $type, 'id' => $c->getActorId(), 'name' => $this->authorName($c)],
            'text' => self::plainText($c->getMessage(), $mentions, fn (string $uid): string => $this->displayName($uid)),
            'mentions' => $mentions,
        ];
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /** Names and pids are read fresh for every answer (a cron process lives long). */
    private function forget(): void {
        $this->names = [];
        $this->pids = [];
    }

    /**
     * The write right, then the budget (429 slow_down, retryMs 2000).
     *
     * @throws HttpError 403 forbidden | 429 slow_down
     */
    private function gate(Principal $p, string $ip): void {
        if (!$p->role->canVote()) {
            throw new HttpError(403, 'forbidden');
        }
        try {
            if ($p->isGuest) {
                $this->limiter->registerAnonRequest('knorke-comment-' . substr($p->id, 2), Limits::COMMENT_WRITE_LIMIT, Limits::COMMENT_WRITE_PERIOD, $ip);
            } else {
                $user = $this->users->get((string)$p->uid) ?? throw new HttpError(404, 'not_found');
                $this->limiter->registerUserRequest('knorke-comment', Limits::COMMENT_WRITE_LIMIT, Limits::COMMENT_WRITE_PERIOD, $user);
            }
        } catch (IRateLimitExceededException) {
            throw new HttpError(429, 'slow_down', '', ['retryMs' => (int)ceil(Limits::COMMENT_WRITE_PERIOD * 1000 / Limits::COMMENT_WRITE_LIMIT)]);
        }
    }

    /**
     * One write transaction (see the class comment). $fn gets the locked
     * board row and returns {…, changed?: false, notify?: callable}.
     *
     * @param callable(array): array $fn
     * @return array what $fn returned
     */
    private function write(int $board, int $nowMs, callable $fn): array {
        if ($this->db->inTransaction()) {
            throw new \LogicException('Knorke: CommentService write inside an open transaction');
        }
        $out = $this->atomic(function () use ($board, $nowMs, $fn): array {
            $row = $this->boards->lockBoard($board, false, null, $nowMs) ?? throw new HttpError(404, 'not_found');
            $r = $fn($row);
            if (($r['changed'] ?? true) === false) {
                return $r + ['metaRev' => null];
            }
            $w = $this->meta->writeLocked($board, static function (array $m): array {
                $m['comments'] = (is_int($m['comments'] ?? null) ? $m['comments'] : 0) + 1;
                return $m;
            }, $nowMs);
            return $r + ['metaRev' => $w['metaRev']];
        }, $this->db);
        // After COMMIT, never before: a poller would look for a rev it cannot see yet.
        if ($out['metaRev'] !== null) {
            $this->cache->bumpRev($board, $out['metaRev']);
        }
        if (isset($out['notify']) && is_callable($out['notify'])) {
            try {
                ($out['notify'])();
            } catch (\Throwable $e) {
                $this->logger->warning('Knorke: comment notification failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
            }
        }
        return $out;
    }

    /** @throws HttpError 409 comments_full */
    private function checkRoom(int $board): void {
        $n = $this->comments->getNumberOfCommentsForObject(self::OBJECT_TYPE, (string)$board, null, self::VERB);
        if ($n >= Limits::COMMENTS_PER_BOARD) {
            throw new HttpError(409, 'comments_full');
        }
    }

    /** A comment of this board (404 for any other id: unknown, another board, another verb). */
    private function comment(int $board, string $id): IComment {
        try {
            $c = $this->comments->get($id);
        } catch (NotFoundException|\InvalidArgumentException) {
            throw new HttpError(404, 'not_found');
        }
        if ($c->getObjectType() !== self::OBJECT_TYPE || $c->getObjectId() !== (string)$board || $c->getVerb() !== self::VERB) {
            throw new HttpError(404, 'not_found');
        }
        return $c;
    }

    /** The first comment of a thread of this board (404 also for a reply's id). */
    private function root(int $board, string $id): IComment {
        $c = $this->comment($board, $id);
        if (!self::isRoot($c)) {
            throw new HttpError(404, 'not_found');
        }
        return $c;
    }

    /**
     * Saves a new comment with the knorke meta $k (name for guests, edited
     * null, mentions; the first comment's spot and state).
     */
    private function newComment(Principal $p, int $board, string $message, string $parent, int $nowMs, array $k): IComment {
        $c = $p->isGuest
            ? $this->comments->create(self::GUEST_ACTOR, substr($p->id, 2), self::OBJECT_TYPE, (string)$board)
            : $this->comments->create(self::USER_ACTOR, (string)$p->uid, self::OBJECT_TYPE, (string)$board);
        $c->setVerb(self::VERB);
        $c->setParentId($parent);
        $c->setMessage($message, Limits::COMMENT_MAX);
        $c->setCreationDateTime(new \DateTime('@' . intdiv($nowMs, 1000)));
        $name = null;
        if ($p->isGuest) {
            $name = Input::displayName($p->displayName, Limits::COMMENT_NAME_MAX);
            if (!$this->db->supports4ByteText()) {
                $name = Input::bmp($name);
            }
        }
        $this->save($c, ['name' => $name, 'edited' => null] + $k);
        return $c;
    }

    /** Writes $k as meta_data.knorke (other keys of meta_data stay) and saves the whole row. */
    private function save(IComment $c, array $k): void {
        $meta = $c->getMetaData() ?? [];
        $meta[self::META_KEY] = $k;
        $c->setMetaData($meta);
        $this->comments->save($c);
    }

    /**
     * The text to store and the stored mentions: an account's verified
     * mentions written as @"uid"; without 4-byte UTF-8 Input::bmp; longer
     * than COMMENT_MAX → 400 comment_too_long.
     *
     * @return array{0: string, 1: list<string>}
     */
    private function prepareText(Principal $p, int $board, string $text): array {
        $mentions = [];
        if (!$p->isGuest) {
            [$text, $mentions] = $this->resolveMentions($board, $text);
        }
        if (!$this->db->supports4ByteText()) {
            $text = Input::bmp($text);
        }
        if (mb_strlen($text, 'UTF-8') > Limits::COMMENT_MAX) {
            throw new HttpError(400, 'comment_too_long');
        }
        return [$text, $mentions];
    }

    /**
     * Nextcloud's getMentions() of type user, checked in the order they
     * appear: at most COMMENT_MENTIONS distinct accounts that may be
     * mentioned (mentionTarget); their tokens become @"<canonical uid>".
     *
     * @return array{0: string, 1: list<string>}
     */
    private function resolveMentions(int $board, string $text): array {
        $probe = $this->comments->create(self::USER_ACTOR, 'knorke', self::OBJECT_TYPE, (string)$board);
        $probe->setMessage($text, 0);
        $typed = [];
        foreach ($probe->getMentions() as $m) {
            if (($m['type'] ?? null) === 'user' && is_string($m['id'] ?? null)) {
                $typed[$m['id']] = true;
            }
        }
        if ($typed === [] || preg_match_all(self::MENTION_RE, $text, $hits, PREG_SET_ORDER) < 1) {
            return [$text, []];
        }
        $canon = [];
        $uids = [];
        foreach ($hits as $hit) {
            $id = trim(substr($hit[0], 1), '"');
            if (!isset($typed[$id]) || array_key_exists($id, $canon)) {
                continue;
            }
            $uid = count($uids) < Limits::COMMENT_MENTIONS ? $this->mentionTarget($board, $id) : null;
            $canon[$id] = $uid;
            if ($uid !== null && !in_array($uid, $uids, true)) {
                $uids[] = $uid;
            }
        }
        $text = preg_replace_callback(self::MENTION_RE, static function (array $hit) use ($canon): string {
            $uid = $canon[trim(substr($hit[0], 1), '"')] ?? null;
            return $uid === null ? $hit[0] : '@"' . $uid . '"';
        }, $text) ?? $text;
        return [$text, $uids];
    }

    /**
     * The uids Nextcloud's own search finds for the session user (job 249,
     * while the admin restricts whom users may find): ISearch with users
     * only, exact and wide hits. A query below sharing.minSearchStringLength
     * or a failing search finds nobody (never more than allowed).
     *
     * @return array<string, true>
     */
    private function findable(string $q): array {
        try {
            $min = $this->container->get(IConfig::class)->getSystemValueInt('sharing.minSearchStringLength', 0);
            if (mb_strlen(trim($q), 'UTF-8') < $min) {
                return [];
            }
            [$result] = $this->container->get(ISearch::class)->search($q, [IShare::TYPE_USER], false, Limits::MENTION_SEARCH_MAX, 0);
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: the account search for the @ list failed', ['exception' => $e, 'app' => 'knorke']);
            return [];
        }
        $out = [];
        foreach ([$result['exact']['users'] ?? [], $result['users'] ?? []] as $set) {
            foreach (is_array($set) ? $set : [] as $hit) {
                $id = is_array($hit) ? ($hit['value']['shareWith'] ?? null) : null;
                if (is_string($id) && $id !== '') {
                    $out[$id] = true;
                }
            }
        }
        return $out;
    }

    /** The canonical uid of an account that may be mentioned on the board now, else null. */
    private function mentionTarget(int $board, string $id): ?string {
        $user = $this->users->get($id);
        if ($user === null || !$user->isEnabled() || !$this->appAccess($user)) {
            return null;
        }
        return $this->roleOf($board, $user) !== null ? $user->getUID() : null;
    }

    /**
     * The candidate uids of the @ list (route 39), unchecked: owner, shares
     * to accounts, members of shared groups and teams (MENTION_MEMBERS_MAX
     * each), valid link members (while links count for the owner).
     *
     * @return list<string>
     */
    private function candidates(int $board, array $row): array {
        $owner = (string)$row['owner'];
        $out = [$owner => true];
        $ownerUser = null;
        foreach ($this->shares->forBoard($board) as $s) {
            $recipient = (string)$s['recipient'];
            if ($s['kind'] === 'user') {
                $out[$recipient] = true;
            } elseif ($s['kind'] === 'group') {
                foreach ($this->groups->get($recipient)?->searchUsers('', Limits::MENTION_MEMBERS_MAX) ?? [] as $u) {
                    $out[$u->getUID()] = true;
                }
            } elseif ($s['kind'] === 'team') {
                $ownerUser ??= $this->users->get($owner);
                if ($ownerUser === null || !$this->sharePolicy->teamSupport($ownerUser)) {
                    continue;
                }
                try {
                    $this->teams ??= $this->container->get(ITeamManager::class);
                    $members = array_slice(array_keys($this->teams->getMembersOfTeam($recipient, $owner)), 0, Limits::MENTION_MEMBERS_MAX);
                } catch (\Throwable $e) {
                    $this->logger->warning('Knorke: team members for the @ list failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
                    $members = [];
                }
                foreach ($members as $uid) {
                    $out[(string)$uid] = true;
                }
            }
        }
        $links = $this->linkPolicy->allows($owner);
        foreach ($this->boards->validMembers($board, $this->nowMs()) as $m) {
            if (!$m['link'] || $links) {
                $out[$m['uid']] = true;
            }
        }
        return array_map('strval', array_keys($out));
    }

    /** May the account open Knorke? The Notifier's checks: app access, then the Guests app. */
    private function appAccess(IUser $user): bool {
        return $this->apps->isEnabledForUser(Application::APP_ID, $user) && $this->guestsApp->allows($user);
    }

    /** The live item of the five types, else null (the thread is free). */
    private function liveItem(int $board, ?string $item): ?string {
        if ($item === null || preg_match(OpValidator::ULID_RE, $item) !== 1) {
            return null;
        }
        $row = $this->items->loadItems($board, [$item])[$item] ?? null;
        return $row !== null && (int)$row['deleted'] === 0 && in_array($row['type'], self::ITEM_TYPES, true) ? $item : null;
    }

    /**
     * (Job 195) The node of a new thread: a key of a node that the live mind
     * map $item has now, else null (any other item, a missing node).
     */
    private function liveNode(int $board, ?string $item, ?string $node): ?string {
        if ($item === null || $node === null || preg_match(Mindmaps::NODE_RE, $node) !== 1) {
            return null;
        }
        $row = $this->items->loadItems($board, [$item])[$item] ?? null;
        if ($row === null || $row['type'] !== 'mindmap') {
            return null;
        }
        $data = json_decode((string)($row['data'] ?? ''), true);
        $pot = is_array($data) && is_array($data['nodes'] ?? null) ? ($data['nodes'][Mindmaps::bucketOf($node)] ?? null) : null;
        return is_array($pot) && array_key_exists($node, $pot) ? $node : null;
    }

    /**
     * The accounts that wrote in a thread (first comment and replies), in
     * order, without duplicates.
     *
     * @return list<string>
     */
    private function accountWriters(int $board, IComment $root): array {
        $out = [];
        foreach ($this->load($board) as [$r, $replies]) {
            if ($r->getId() !== $root->getId()) {
                continue;
            }
            foreach ([$r, ...$replies] as $c) {
                if ($c->getActorType() === self::USER_ACTOR && !in_array($c->getActorId(), $out, true)) {
                    $out[] = $c->getActorId();
                }
            }
        }
        return $out;
    }

    private function authorName(IComment $c): string {
        if ($c->getActorType() === self::USER_ACTOR) {
            return $this->displayName($c->getActorId());
        }
        if ($c->getActorType() === self::GUEST_ACTOR) {
            $name = self::knorke($c)['name'] ?? null;
            return is_string($name) && $name !== '' ? $name : 'Guest';
        }
        return self::DELETED_NAME;
    }

    private function displayName(string $uid): string {
        return $this->names[$uid] ??= ($this->users->getDisplayName($uid) ?? self::DELETED_NAME);
    }

    private function pidOf(int $board, IComment $c): ?string {
        $id = match ($c->getActorType()) {
            self::USER_ACTOR => 'u:' . $c->getActorId(),
            self::GUEST_ACTOR => 'g:' . $c->getActorId(),
            default => null,
        };
        return $id === null ? null : ($this->pids[$id] ??= $this->access->pid($board, $id));
    }

    /** The same account (uid) or the same guest (gid) wrote $c. */
    private static function isMine(Principal $p, IComment $c): bool {
        if ($p->isGuest) {
            return $c->getActorType() === self::GUEST_ACTOR && 'g:' . $c->getActorId() === $p->id;
        }
        return $c->getActorType() === self::USER_ACTOR && $p->uid !== null && $c->getActorId() === $p->uid;
    }

    private static function isRoot(IComment $c): bool {
        return $c->getParentId() === '0' || $c->getParentId() === '';
    }

    private static function resolved(IComment $root): bool {
        return (self::knorke($root)['resolved'] ?? false) === true;
    }

    /** meta_data.knorke of a comment ([] without one). */
    private static function knorke(IComment $c): array {
        $k = ($c->getMetaData() ?? [])[self::META_KEY] ?? null;
        return is_array($k) ? $k : [];
    }

    /** @return list<string> */
    private static function uidList(mixed $v): array {
        return is_array($v) ? array_values(array_filter($v, static fn ($u): bool => is_string($u) && $u !== '')) : [];
    }

    /** Creation time in ms (the store keeps whole seconds). */
    private static function ms(IComment $c): int {
        try {
            return $c->getCreationDateTime()->getTimestamp() * 1000;
        } catch (\Throwable) {
            return 0;
        }
    }

    private static function num(mixed $v): int|float {
        return is_int($v) || (is_float($v) && is_finite($v)) ? $v : 0;
    }

    private static function cmpId(string $a, string $b): int {
        return [strlen($a), $a] <=> [strlen($b), $b];
    }

    /**
     * The comment text of a body: a string, cleaned like an item's text
     * (Input::text), trimmed; empty → 400 comment_empty, longer than
     * COMMENT_MAX → 400 comment_too_long, no string → 400 bad_request.
     */
    private static function text(mixed $v): string {
        $t = Input::text($v, Limits::MAX_BODY_BYTES);
        if ($t === null) {
            throw new HttpError(400, 'bad_request', 'text must be a string.');
        }
        $t = trim($t);
        if ($t === '') {
            throw new HttpError(400, 'comment_empty');
        }
        if (mb_strlen($t, 'UTF-8') > Limits::COMMENT_MAX) {
            throw new HttpError(400, 'comment_too_long');
        }
        return $t;
    }

    /** A comment id of a body or query: a decimal string or a whole number ≥ 1. */
    private static function id(mixed $v): string {
        if (is_int($v) && $v > 0) {
            return (string)$v;
        }
        if (is_string($v) && preg_match(self::ID_RE, $v) === 1) {
            return $v;
        }
        throw new HttpError(400, 'bad_request', 'Invalid comment id.');
    }

    /** A world coordinate: a finite JSON number within ±NUM_ABS_MAX. */
    private static function coord(mixed $v): float {
        if ((!is_int($v) && !is_float($v)) || !is_finite((float)$v) || abs((float)$v) > Limits::NUM_ABS_MAX) {
            throw new HttpError(400, 'bad_request', 'x and y must be numbers within ±' . (int)Limits::NUM_ABS_MAX . '.');
        }
        return (float)$v;
    }

    private function nowMs(): int {
        return (int)floor((float)$this->time->now()->format('U.u') * 1000);
    }
}
