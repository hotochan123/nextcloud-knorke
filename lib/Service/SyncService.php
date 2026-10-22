<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Exception\NothingWritten;
use OCP\AppFramework\Db\TTransactional;
use OCP\IConfig;
use OCP\IDBConnection;

/**
 * The sync engine (SPEC-M0 §4.5–§4.7, §4.10; SPEC-M1 §4.7 rules 12–19,
 * §4.13.2): server-authoritative, last writer wins per path, in server
 * (= rev) order.
 *
 * Write path applyOps(): validation before the transaction; under the board
 * row lock (lockAndBumpRev is the FIRST statement) a state machine per item
 * id — none | live | gone | new | revived | removed — applies the ops to
 * working copies; then every touched item is written EXACTLY ONCE by its end
 * state, with exactly one change row per item and rev. Derived writes join
 * that row: children of a removed container go to the root (rule 6),
 * children of a container patched with keep stay where they are (rule 15),
 * connector ends bound to a removed item become free points (rule 14),
 * and every connector row carries start_item/end_item. A batch that wrote
 * nothing effective is rolled back (no rev jump). Redis is raised only after
 * COMMIT. item_count and item_bytes (the board byte budget) move in the same
 * lock; the text lease is checked against presence re-read under the lock.
 *
 * Locked items (M2, SPEC-M1 §1.2 "(R20) Sperren"): the working copy carries
 * `lock` = null or {by: principal id|null, name: string|null} (columns
 * locked, locked_by, locked_name). authorize() refuses every patch and
 * remove of a locked item with `itemlocked` (also a moderator's: unlock
 * first, visibly) and an unlock of a foreign lock without the moderation
 * right; the lock op ('o' => 'lock') sets the principal as locker (never
 * the value sent) or clears all three columns. Derived writes (rules 6, 14,
 * 15) never ask authorize() and move locked items too; authorizeRef() lets
 * a locked frame be a parent and a locked item a connector end. The change
 * row carries the path `lock` as true or null, never the locker.
 * clearLocker() empties locked_by and locked_name of a deleted account (the
 * lock stays: "locked, locker unknown", only moderators unlock).
 *
 * Groups (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): the working copy carries
 * `group` (column group_id, null or a ULID, OpValidator::isGroupId), set by
 * a put and by the patch path `group` (its own register like z; the type
 * rule is ItemRegistry's). No rule spans several items except one: at the
 * end of the batch (step 16c, dissolveGroups) every group that LOST a
 * member — an item that lived at the start of the batch and is removed at
 * its end or has another group now — is counted again (the stored live
 * members through ItemStore::groupMembers plus the live working copies);
 * when exactly one member is left, its group becomes null in the same rev,
 * a derived write like the releases (no authorize(), a locked member too),
 * merged into its one change row. Groups that only gain members are never
 * counted (a group may be built over several requests). A tombstone keeps
 * its group_id (never sent, never counted; a revive writes the put's).
 *
 * Read path sync() (protocol 2, SPEC-M1 §4.13.8): the epoch check, presence
 * first (so a lease take-over counts for the ops of the same request), then
 * the ops, then the compacted items since the client's cursor — straight
 * from the item rows, one entry per item — and the board metadata while the
 * cursor is below meta_rev. Every answer carries the server time `now`.
 *
 * Votes (stage 3, SPEC-M1 §4.5, §4.6, §4.13.5): vote ops never enter the
 * object transaction; after applyOps they go to VoteService::apply (own
 * transaction, board lock first) and their results are merged back into
 * `res` by position. They never raise the board rev: every other poller
 * stays on the fast path. The `votes` block of the answer is (a) the own
 * votes of the session the vote ops reached when it is open afterwards and
 * (b) step 9 for moderators that send `vt`.
 */
class SyncService {
    use TTransactional;

    private const LIVE = ['live', 'new', 'revived'];
    private const COLUMN = ['x' => 'x', 'y' => 'y', 'w' => 'w', 'h' => 'h', 'r' => 'rotation', 'z' => 'z', 'parent' => 'parent_id', 'group' => 'group_id'];
    /** What a partial copy (liveChildren, groupMembers) may write: its placement and its group (M2, R20), never data or style. */
    private const PARTIAL_PATHS = ['x', 'y', 'parent', 'group'];
    /** The two ends of a connector, each ONE register (SPEC-M1 §4.7 rule 14). */
    private const END_PATHS = ['data.start', 'data.end'];
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;
    /** Containers are walked upwards at most this far (cycle guard, §4.7 rule 6). */
    private const MAX_ANCESTORS = 8;

    public function __construct(
        private ItemStore $items,
        private FastCache $cache,
        private PresenceStore $presence,
        private IDBConnection $db,
        private Limits $limits,
        private IConfig $config,
        private Epoch $epoch,
        private BoardStore $boards,
        private VoteService $votes,
        private WriteBudget $budget,
    ) {
    }

    // ── Write path ─────────────────────────────────────────────────────────

    /**
     * @param list<mixed> $ops raw client ops
     * @param array|null $presence presence map written/read by sync() before (null = no lease
     *   check, plain LWW); a batch with a text patch reads it again under the lock
     * @return array{0: ?int, 1: list<string>} [write rev | observed rev (rollback) | null (no transaction), result per op]
     */
    public function applyOps(Principal $p, int $board, string $client, array $ops, int $nowMs, ?array $presence = null): array {
        [$rev, $res] = $this->applyOpsCounted($p, $board, $client, $ops, $nowMs, $presence);
        return [$rev, $res];
    }

    /**
     * applyOps() plus the number of DERIVED rows the batch wrote (SPEC-M1
     * §4.13.6, R2): change rows of items no op of the batch changed with
     * `ok` — children shifted by keep (rule 15), children released by a
     * removed container (rule 6), connectors whose ends the server released
     * (rule 14), the last member of a group that lost members (M2, R20
     * Gruppieren, step 16c). WriteBudget::charge() counts them after COMMIT.
     * 0 when nothing was written (validation only, or rolled back).
     *
     * @return array{0: ?int, 1: list<string>, 2: int} [rev as applyOps, result per op, derived rows]
     */
    public function applyOpsCounted(Principal $p, int $board, string $client, array $ops, int $nowMs, ?array $presence = null): array {
        if (count($ops) > Limits::MAX_OPS) {
            throw new HttpError(400, 'too_many_ops');
        }
        // Validation BEFORE the transaction: the board row lock stays short.
        // Without 4-byte UTF-8 in the database, emoji become U+FFFD here.
        $fourByte = $this->db->supports4ByteText();
        $norm = array_map(static fn (mixed $op): array => OpValidator::normalize($p, $op, $fourByte), array_values($ops));
        $codes = array_map(static fn (array $n): string => $n['o'], $norm);
        if (array_diff($codes, ['bad', 'denied']) === []) {
            // No transaction, no rev jump (fixes spike defect §4.12).
            return [null, $codes, 0];
        }
        try {
            [$rev, $res, $derived] = $this->atomic(fn (): array => $this->writeBatch($p, $board, $client, $norm, $nowMs, $presence), $this->db);
        } catch (NothingWritten $n) {
            return [$n->observedRev, $n->res, 0];
        }
        // After COMMIT, never before: a poller would look for rows it cannot see yet.
        if (!$this->devSkipBump()) {
            $this->cache->bumpRev($board, $rev);
        }
        return [$rev, $res, $derived];
    }

    /**
     * Object-level rights under the lock (SPEC-M1 §4.13.2 step 9), before
     * the op takes effect. $cur is the WORKING COPY of the item at this point
     * of the batch while it lives (null: it never existed, is a tombstone or
     * was removed earlier in the batch), $row its stored row (tombstones
     * included; null for an id the database never had). With $cur an item
     * created earlier in the same batch is visible, too (finding D6: the row
     * alone is null there). Hook for M2 (hidden frames, private mode).
     *
     * Locked items (M2, R20), on the working copy's `lock`, so a lock or
     * unlock earlier in the same batch counts:
     *  - lock op, lock: always allowed (a second lock is a no-op, the first
     *    locker stays)
     *  - lock op, unlock: allowed when the item is not locked (no-op), the
     *    lock is the principal's own (locked_by = $p->id) or $p may
     *    moderate; else `itemlocked`
     *  - patch (any path, keep too) or remove of a locked item: `itemlocked`,
     *    before checkPatch, the text lease and the references, for every
     *    role (no silent bypass: a moderator unlocks first)
     *  - put: never checked here (a live item is `dup`; a tombstone is never
     *    locked: the remove of writeBatch step 5 clears the three lock
     *    columns, and ItemStore::reviveItem clears them again); vote ops
     *    (VoteService passes them here) never see the lock
     * A gone item ($cur null) is left to the state machine (`gone`).
     *
     * @return string|null null = allowed, otherwise the result code (e.g. 'denied', 'itemlocked')
     */
    protected function authorize(Principal $p, array $op, ?array $cur, ?array $row): ?string {
        $o = $op['o'] ?? null;
        if ($cur === null || !in_array($o, ['patch', 'remove', 'lock'], true)) {
            return null;
        }
        $lock = $cur['lock'] ?? null;
        if ($lock === null) {
            return null;
        }
        if ($o !== 'lock') {
            return 'itemlocked';
        }
        if ($op['on'] === true) {
            return null;
        }
        $mine = ($lock['by'] ?? null) !== null && $lock['by'] === $p->id;
        return $mine || $p->canModerate() ? null : 'itemlocked';
    }

    /**
     * May $p reference the item $refId (SPEC-M1 §4.13.2 step 9)? Asked for
     * EVERY reference to another item: a parent (put, patch), a connector end
     * (data.start.item, data.end.item) and the server-side release of a
     * connector end (step 16b), which writes the anchor point of the target
     * into a visible connector. $refCur is the target's working copy while it
     * lives, else null. Always true so far: a locked frame is a valid parent
     * (notes go into it, out of it, are created and edited in it) and a
     * locked item a valid connector end (M2, R20). False would make the op
     * `denied`, and a release would leave that end untouched, so no position
     * of the target reaches the connector.
     */
    protected function authorizeRef(Principal $p, string $refId, ?array $refCur): bool {
        return true;
    }

    /**
     * Runs inside atomic(): lock, state machine, release, writes.
     *
     * @param list<array> $norm normalized ops
     * @return array{0: int, 1: list<string>, 2: int} [rev, result per op, derived rows]
     */
    private function writeBatch(Principal $p, int $board, string $client, array $norm, int $nowMs, ?array $presence): array {
        // 1) FIRST statement: board row lock + new rev.
        $head = $this->items->lockAndBumpRev($board, $nowMs) ?? throw new HttpError(404, 'not_found');
        $rev = $head['rev'];

        // 2) Rows of all touched ids and of all referenced ids — parents and
        //    connector ends (SPEC-M1 §4.13.2 step 6) — in one query,
        //    tombstones included.
        $ids = [];
        foreach ($norm as $n) {
            if (isset($n['id'])) {
                $ids[$n['id']] = true;
            }
            foreach (self::refsOf($n) as $ref) {
                $ids[$ref] = true;
            }
        }
        $rows = $this->items->loadItems($board, array_map('strval', array_keys($ids)));
        $work = [];
        // Containers whose stored children are in $work already (keep, rule 15).
        $kids = [];
        $live = $head['item_count'];
        $max = $this->limits->maxItemsPerBoard();
        // Running byte total of the live items (board budget, §4.8): an op
        // that GROWS it beyond the budget answers `limit`; shrinking and
        // size-neutral ops always pass, so a board over a lowered budget can
        // still be cleaned up. Released children contribute 0.
        $bytes = $head['item_bytes'];
        $maxBytes = $this->limits->maxBoardBytes();
        $leaseMs = $nowMs;
        $leaseFresh = false;
        $res = [];

        // 3) The ops in order, on working copies.
        foreach ($norm as $i => $n) {
            if ($n['o'] === 'bad' || $n['o'] === 'denied') {
                $res[$i] = $n['o'];
                continue;
            }
            $id = $n['id'];
            self::touch($work, $rows, $id);
            $state = $work[$id]['state'];
            $deny = $this->authorize($p, $n, in_array($state, self::LIVE, true) ? $work[$id]['cur'] : null, $rows[$id] ?? null);
            if ($deny !== null) {
                $res[$i] = $deny;
                continue;
            }
            if ($n['o'] === 'lock') {
                // Lock or unlock (M2, R20): only the lock changes. The locker
                // is the principal, never the value sent; locking a locked
                // item and unlocking an unlocked one are no-ops (`ok`).
                if (!in_array($state, self::LIVE, true)) {
                    $res[$i] = 'gone';
                    continue;
                }
                $was = $work[$id]['cur']['lock'] ?? null;
                if ($n['on'] && $was === null) {
                    $work[$id]['cur']['lock'] = ['by' => $p->id, 'name' => $this->lockerName($p)];
                    $work[$id]['paths']['lock'] = true;
                } elseif (!$n['on'] && $was !== null) {
                    $work[$id]['cur']['lock'] = null;
                    $work[$id]['paths']['lock'] = true;
                }
                $res[$i] = 'ok';
                continue;
            }
            if ($n['o'] === 'put') {
                if (in_array($state, self::LIVE, true)) {
                    $res[$i] = 'dup';
                    continue;
                }
                if ($state !== 'none' && !$n['revive']) {
                    $res[$i] = 'gone';
                    continue;
                }
                // An id keeps its type: reviving it (or putting an id this
                // batch created and removed) as another type is `bad`. A frame
                // revived as a sticky would keep its children (§4.7 rule 6).
                if ($work[$id]['cur'] !== null && $n['item']['t'] !== $work[$id]['cur']['t']) {
                    $res[$i] = 'bad';
                    continue;
                }
                $item = $this->resolveRefs($p, $board, $work, $rows, $id, $n['item']['t'], $n['item'], true);
                if (is_string($item)) {
                    $res[$i] = $item;
                    continue;
                }
                if ($live + 1 > $max) {
                    $res[$i] = 'limit';
                    continue;
                }
                $size = ItemRegistry::bytes($item);
                if ($bytes + $size > $maxBytes) {
                    $res[$i] = 'limit';
                    continue;
                }
                $live++;
                $bytes += $size;
                $work[$id]['cur'] = $item;
                $work[$id]['size'] = $size;
                $work[$id]['state'] = $state === 'none' ? 'new' : 'revived';
                $res[$i] = 'ok';
            } elseif ($n['o'] === 'patch') {
                if (!in_array($state, self::LIVE, true)) {
                    $res[$i] = 'gone';
                    continue;
                }
                $cur = $work[$id]['cur'];
                $patch = ItemRegistry::checkPatch($cur['t'], $n['p']);
                if ($patch === null) {
                    $res[$i] = 'bad';
                    continue;
                }
                $textPath = ItemRegistry::textPath($cur['t']);
                if ($textPath !== null && array_key_exists($textPath, $patch)) {
                    if ($presence !== null && !$leaseFresh) {
                        // The map of sync() was read BEFORE this lock: a
                        // take-over (tk) and the new holder's text may have
                        // committed since. Read it again, once, under the
                        // lock (§4.11); this request's own presence write
                        // (also its tk) is in Redis already.
                        $leaseMs = max($nowMs, $this->clockMs());
                        $presence = $this->presence->read($board, $leaseMs);
                        $leaseFresh = true;
                    }
                    $holder = PresenceStore::leaseHolder($presence, $id, $leaseMs);
                    if ($holder !== null && $holder !== $p->pid) {
                        $res[$i] = 'locked';
                        continue;
                    }
                }
                $patch = $this->resolveRefs($p, $board, $work, $rows, $id, $cur['t'], $patch, false);
                if (is_string($patch)) {
                    $res[$i] = $patch;
                    continue;
                }
                $before = $cur;
                foreach ($patch as $path => $v) {
                    $cur = PathOps::setPath($cur, (string)$path, $v);
                }
                $roots = self::payloadRoots($patch);
                if ($roots !== []) {
                    // data/style changed: the stored result must fit what a
                    // put accepts (bytes, shape) and the board budget.
                    $size = ItemRegistry::bytes($cur);
                    if ($size > Limits::MAX_ITEM_BYTES || !ItemRegistry::fitsShape($cur, $roots)) {
                        $res[$i] = 'bad';
                        continue;
                    }
                    $grow = $size - self::size($work[$id]);
                    if ($grow > 0 && $bytes + $grow > $maxBytes) {
                        $res[$i] = 'limit';
                        continue;
                    }
                    $bytes += $grow;
                    $work[$id]['size'] = $size;
                }
                $work[$id]['cur'] = $cur;
                foreach (array_keys($patch) as $path) {
                    $work[$id]['paths'][(string)$path] = true;
                }
                $res[$i] = 'ok';
                // 13a) keep (rule 15): the children of a container keep their
                //      absolute position — shifted by the move of THIS op, at
                //      this point of the batch; a later op on a child's
                //      placement wins (LWW in op order, §8.6).
                if ($n['keep'] && ItemRegistry::isContainer($cur['t'])) {
                    $dx = (float)$cur['x'] - (float)$before['x'];
                    $dy = (float)$cur['y'] - (float)$before['y'];
                    if ($dx != 0.0 || $dy != 0.0) {
                        $this->shiftKids($board, $work, $rows, $kids, $id, $dx, $dy);
                    }
                }
            } else {
                if ($state === 'live' || $state === 'revived') {
                    $work[$id]['state'] = 'removed';
                    $live--;
                    $bytes -= self::size($work[$id]);
                    $res[$i] = 'ok';
                } elseif ($state === 'new') {
                    // Created and removed in one batch: nothing to write.
                    $work[$id]['state'] = 'none';
                    $live--;
                    $bytes -= self::size($work[$id]);
                    $res[$i] = 'ok';
                } else {
                    $res[$i] = 'gone';
                }
            }
        }

        // 4) Release (step 16): children of containers that are gone at the
        //    END of the batch go to the root, keeping their absolute position
        //    (§4.7 rule 6); (16b) every live connector end bound to an item
        //    that is gone at the end becomes a free point at its anchor
        //    (rule 14). Both merge their paths into the item's one change row.
        $this->releaseChildren($board, $work, $rows);
        $this->releaseConnectorEnds($p, $board, $work, $rows);
        // 16c) Dissolve (M2, R20 Gruppieren): a group that lost members and
        //      has exactly one live member left loses that member as well.
        $this->dissolveGroups($board, $work, $rows);

        // 5) Write every item exactly once by its end state. item_bytes moves
        //    by the EXACT stored strings (written minus replaced), so it stays
        //    Σ strlen(data) + strlen(style) of the live rows. A row of an item
        //    that no op of the batch changed with `ok` is DERIVED (keep shift,
        //    release of children or connector ends): the write budget counts
        //    it (SPEC-M1 §4.13.6, WriteBudget::charge).
        $okIds = [];
        foreach ($norm as $i => $n) {
            if (($res[$i] ?? null) === 'ok' && isset($n['id'])) {
                $okIds[(string)$n['id']] = true;
            }
        }
        $derived = 0;
        $wrote = false;
        $delta = 0;
        $bytesDelta = 0;
        $moves = [];
        $shifts = [];
        $conns = [];
        foreach ($work as $id => $w) {
            $id = (string)$id;
            $delta += (in_array($w['state'], self::LIVE, true) ? 1 : 0) - ($w['start'] === 'live' ? 1 : 0);
            switch ($w['state']) {
                case 'new':
                    $this->items->insertItem($board, $id, $w['cur'], $rev, $p->id, $nowMs);
                    $this->writeNewLock($board, $id, $w['cur'], $rev, $p->id, $nowMs);
                    $this->items->insertChange($board, $rev, $id, 'put', self::putJson($w['cur']), $p->id, $client, $nowMs);
                    $bytesDelta += self::size($w);
                    $wrote = true;
                    break;
                case 'revived':
                    $this->items->reviveItem($board, $id, $w['cur'], $rev, $p->id, $nowMs);
                    $this->writeNewLock($board, $id, $w['cur'], $rev, $p->id, $nowMs);
                    $this->items->insertChange($board, $rev, $id, 'put', self::putJson($w['cur']), $p->id, $client, $nowMs);
                    $bytesDelta += self::size($w) - ($w['start'] === 'live' ? self::storedBytes($rows[$id]) : 0);
                    $wrote = true;
                    break;
                case 'removed':
                    if ($w['start'] === 'live') {
                        // A tombstone carries no payload (P7, SPEC-M1 §33.1 c): data and
                        // style become '{}' in the same write; type, placement,
                        // parent, z and the bound ends stay (rules 6 and 14 read
                        // only columns, revive brings the full object). The
                        // payload stays in the put/patch rows of the change log.
                        // Nor a lock (M2, R20): authorize() lets only an unlocked
                        // working copy be removed, but [unlock X, remove X] in one
                        // batch has the lock still in the row, and a revive must
                        // never bring it back.
                        $this->items->updateItem($board, $id, ['deleted' => 1, 'data' => '{}', 'style' => '{}'] + self::lockCols(null), $rev, $p->id, $nowMs);
                        $this->items->insertChange($board, $rev, $id, 'remove', null, $p->id, $client, $nowMs);
                        $bytesDelta -= self::storedBytes($rows[$id]);
                        $wrote = true;
                    }
                    break;
                case 'live':
                    [$eff, $cols] = self::effective($w);
                    if ($eff === []) {
                        break;
                    }
                    $wrote = true;
                    if (!isset($okIds[$id])) {
                        $derived++;
                    }
                    $paths = array_keys($eff);
                    $placementOnly = array_diff($paths, OpValidator::PLACEMENT) === [];
                    if ($placementOnly && ($w['released'] ?? false) && $w['cur']['parent'] === null) {
                        // Released and nothing else: one multi-row write for all of them.
                        $moves[] = [$id, (float)$w['cur']['x'], (float)$w['cur']['y'], json_encode($eff, self::JSON_FLAGS)];
                        break;
                    }
                    if ($placementOnly && ($w['shifted'] ?? false) && $w['cur']['parent'] !== null && $w['cur']['parent'] === $w['orig']['parent']) {
                        // Shifted by keep and nothing else, still in its stored
                        // parent: one multi-row write (shiftChildren writes x and
                        // y only, never parent_id). A child another op of the
                        // batch moved into a different container (before or
                        // after the keep op) takes updateItem below, which
                        // writes parent_id (rule 2a: one register; R9 rule 15).
                        $shifts[] = [$id, (float)$w['cur']['x'], (float)$w['cur']['y'], json_encode($eff, self::JSON_FLAGS)];
                        break;
                    }
                    if (($w['ends'] ?? false) && array_diff($paths, self::END_PATHS) === []) {
                        // Connector ends released and nothing else: one multi-row write (releaseConnectors).
                        $conns[] = [$id, $cols['data'], $cols['start_item'], $cols['end_item'], json_encode($eff, self::JSON_FLAGS)];
                        $bytesDelta += strlen($cols['data']) - strlen((string)($rows[$id]['data'] ?? ''));
                        break;
                    }
                    if (($w['partial'] ?? false) && array_diff($paths, self::PARTIAL_PATHS) !== []) {
                        // A row loaded only for its release, shift or dissolve carries no
                        // data/style/size: it writes its placement and its group, nothing else.
                        throw new \LogicException('Knorke: partial item ' . $id . ' written beyond its placement and group');
                    }
                    $this->items->updateItem($board, $id, $cols, $rev, $p->id, $nowMs);
                    $this->items->insertChange($board, $rev, $id, 'patch', json_encode($eff, self::JSON_FLAGS), $p->id, $client, $nowMs);
                    foreach (PathOps::CONTAINERS as $c) {
                        if (isset($cols[$c])) {
                            $bytesDelta += strlen($cols[$c]) - strlen((string)($rows[$id][$c] ?? ''));
                        }
                    }
                    break;
            }
        }
        if ($moves !== []) {
            $this->items->releaseMany($board, $moves, $rev, $p->id, $client, $nowMs);
        }
        if ($shifts !== []) {
            $this->items->shiftChildren($board, $shifts, $rev, $p->id, $client, $nowMs);
        }
        if ($conns !== []) {
            $this->items->releaseConnectors($board, $conns, $rev, $p->id, $client, $nowMs);
        }
        if ($delta !== 0 || $bytesDelta !== 0) {
            $this->items->addItemCount($board, $delta, $bytesDelta);
        }
        if (!$wrote) {
            // Roll back instead of a rev jump: no bumpRev, every poller stays
            // on the fast path; acks.rev = the rev observed under the lock.
            throw new NothingWritten(array_values($res), $rev - 1);
        }
        return [$rev, array_values($res), $derived];
    }

    /**
     * The locker's display name as stored in locked_name (M2, R20; the write
     * rule of the 0.3.0 migration): Input::displayName(…, 64), plus
     * Input::bmp without 4-byte UTF-8 in the database; '' becomes null.
     */
    private function lockerName(Principal $p): ?string {
        $name = Input::displayName($p->displayName, 64);
        if ($name !== '' && !$this->db->supports4ByteText()) {
            $name = Input::bmp($name);
        }
        return $name === '' ? null : $name;
    }

    /**
     * The columns of a working copy's lock: locked 1 and the locker, or all
     * three NULL.
     *
     * @param array{by: ?string, name: ?string}|null $lock
     * @return array{locked: ?int, locked_by: ?string, locked_name: ?string}
     */
    private static function lockCols(?array $lock): array {
        return $lock === null
            ? ['locked' => null, 'locked_by' => null, 'locked_name' => null]
            : ['locked' => 1, 'locked_by' => $lock['by'] ?? null, 'locked_name' => $lock['name'] ?? null];
    }

    /**
     * An item created or revived in this batch and locked later in it ([put
     * X, lock X]): insertItem writes no lock and reviveItem clears it, so the
     * lock columns follow in the same rev. Nothing for an unlocked item.
     */
    private function writeNewLock(int $board, string $id, array $cur, int $rev, string $actor, int $nowMs): void {
        $lock = $cur['lock'] ?? null;
        if ($lock !== null) {
            $this->items->updateItem($board, $id, self::lockCols($lock), $rev, $actor, $nowMs);
        }
    }

    /**
     * Empties the locker of every lock of a principal (M2, R20; account
     * deletion and occ knorke:orphans): locked_by and locked_name become
     * NULL, `locked` stays 1 ("locked, locker unknown": only moderators
     * unlock). Board by board in ascending order, each in ONE short
     * transaction: lockAndBumpRev first, then the rows of that board get the
     * new rev (open clients receive them through itemsSince); no change rows
     * (the log is never replayed, and so no uid enters it anew); bumpRev only
     * after COMMIT. A board whose rows are gone meanwhile is rolled back (no
     * rev jump).
     *
     * @param string $principalId u:<uid> or g:<gid>
     * @return int rows changed
     */
    public function clearLocker(string $principalId, int $nowMs): int {
        $n = 0;
        foreach ($this->items->boardsLockedBy($principalId) as $board) {
            try {
                [$rev, $rows] = $this->atomic(function () use ($board, $principalId, $nowMs): array {
                    $head = $this->items->lockAndBumpRev($board, $nowMs);
                    if ($head === null) {
                        throw new NothingWritten([], 0);
                    }
                    $rows = $this->items->clearLockerRows($board, $principalId, $head['rev']);
                    if ($rows === 0) {
                        throw new NothingWritten([], $head['rev'] - 1);
                    }
                    return [$head['rev'], $rows];
                }, $this->db);
            } catch (NothingWritten) {
                continue;
            }
            $n += $rows;
            $this->cache->bumpRev($board, $rev);
        }
        return $n;
    }

    /** Working-copy entry of $id from its row (or "none"). */
    private static function touch(array &$work, array $rows, string $id): void {
        if (isset($work[$id])) {
            return;
        }
        $row = $rows[$id] ?? null;
        if ($row === null) {
            $work[$id] = ['state' => 'none', 'start' => 'none', 'cur' => null, 'orig' => null, 'paths' => []];
            return;
        }
        $item = self::fromRow($row);
        $state = (int)$row['deleted'] === 1 ? 'gone' : 'live';
        $work[$id] = ['state' => $state, 'start' => $state, 'cur' => $item, 'orig' => $item, 'paths' => []];
    }

    /**
     * Ids an op references besides its own (SPEC-M1 §4.13.2 step 6): the
     * parent of a put or patch, and the bound ends (data.start.item,
     * data.end.item) of a connector put or of a patch of data.start/data.end
     * (the patched item's type is only known under the lock; loading a few
     * ids too many is harmless). Only ULIDs.
     *
     * @return list<string>
     */
    private static function refsOf(array $n): array {
        $out = [];
        if ($n['o'] === 'put') {
            $out[] = $n['item']['parent'];
            if ($n['item']['t'] === 'connector') {
                $out[] = self::boundItem($n['item']['data']['start'] ?? null);
                $out[] = self::boundItem($n['item']['data']['end'] ?? null);
            }
        } elseif ($n['o'] === 'patch') {
            $out[] = $n['p']['parent'] ?? null;
            $out[] = self::boundItem($n['p']['data.start'] ?? null);
            $out[] = self::boundItem($n['p']['data.end'] ?? null);
        }
        return array_values(array_filter($out, static fn (mixed $v): bool => is_string($v) && preg_match(OpValidator::ULID_RE, $v) === 1));
    }

    /** The item a (stored or sent) connector end is bound to, or null (free end, or not an end). */
    private static function boundItem(mixed $ep): ?string {
        $item = is_array($ep) ? ($ep['item'] ?? null) : null;
        return is_string($item) ? $item : null;
    }

    /** The working copy of $id while it lives at this point of the batch, else null (never touches an unknown id). */
    private static function liveCur(array &$work, array $rows, string $id): ?array {
        if (!isset($work[$id]) && !isset($rows[$id])) {
            return null;
        }
        self::touch($work, $rows, $id);
        return in_array($work[$id]['state'], self::LIVE, true) ? $work[$id]['cur'] : null;
    }

    /**
     * The references of one put item or patch (SPEC-M1 §4.13.2 steps 9 and
     * 13): the parent (authorizeRef, then rule 6 via resolveParent) and, for
     * a connector, both ends (resolveEnd, rule 14). Returns the values to
     * apply, or the result code of the whole op ('bad', 'denied').
     *
     * @param array $values a put item (ends under data) or a typed patch (keys 'data.start', 'data.end')
     */
    private function resolveRefs(Principal $p, int $board, array &$work, array &$rows, string $id, string $t, array $values, bool $isPut): array|string {
        if (array_key_exists('parent', $values)) {
            $parent = $values['parent'];
            if (is_string($parent) && !$this->authorizeRef($p, $parent, self::liveCur($work, $rows, $parent))) {
                return 'denied';
            }
            $values = self::resolveParent($work, $rows, $id, $t, $values);
            if ($values === null) {
                return 'bad';
            }
        }
        if ($t === 'connector') {
            foreach (['start', 'end'] as $which) {
                $ep = $isPut ? ($values['data'][$which] ?? null) : ($values['data.' . $which] ?? null);
                if (!is_array($ep)) {
                    // Not part of this patch (a put has both: required, checked before the lock).
                    continue;
                }
                $resolved = $this->resolveEnd($p, $board, $work, $rows, $id, $ep);
                if (is_string($resolved)) {
                    return $resolved;
                }
                if ($isPut) {
                    $values['data'][$which] = $resolved;
                } else {
                    $values['data.' . $which] = $resolved;
                }
            }
        }
        return $values;
    }

    /**
     * One connector end under the lock (SPEC-M1 §4.7 rule 14), against the
     * working copies of the batch (like a parent, rule 6). $ep is already
     * normalized (Connectors::endpoint). For an end bound to E:
     *
     *  - E is the connector itself, never existed, or is not bindable
     *    (frame, connector, unknown stored type)            → bad
     *  - authorizeRef refuses E                              → denied
     *  - E is a tombstone or was removed in this batch       → the free
     *    point {x, y} at E's anchor point (Connectors::anchorPoint); ok
     *  - E lives                                             → bound, as sent
     *
     * A free end references nothing and passes as it is.
     */
    private function resolveEnd(Principal $p, int $board, array &$work, array &$rows, string $selfId, array $ep): array|string {
        if (!array_key_exists('item', $ep)) {
            return $ep;
        }
        $e = (string)$ep['item'];
        if ($e === $selfId || (!isset($work[$e]) && !isset($rows[$e]))) {
            return 'bad';
        }
        self::touch($work, $rows, $e);
        $target = $work[$e]['cur'];
        if ($target === null || !ItemRegistry::isBindable($target['t'])) {
            return 'bad';
        }
        $alive = in_array($work[$e]['state'], self::LIVE, true);
        if (!$this->authorizeRef($p, $e, $alive ? $target : null)) {
            return 'denied';
        }
        return $alive ? $ep : $this->anchorOf($board, $work, $rows, $e, $ep);
    }

    /**
     * The free end {x, y} at the anchor point of $e's current working copy
     * (rule 14, Connectors::anchorPoint): its box relative to its container,
     * whose position comes from the batch (working copy) or the database
     * (loaded here when no op of the batch touched it; containers are roots,
     * so their position is absolute). A container that is gone from the
     * database (never in M1) counts as the root.
     *
     * @param array{item: string, ax?: float, ay?: float} $ep
     * @return array{x: float, y: float}
     */
    private function anchorOf(int $board, array &$work, array &$rows, string $e, array $ep): array {
        if ($work[$e]['partial'] ?? false) {
            // Partial copies (liveChildren) are live children; an anchor is only ever needed for a gone target.
            throw new \LogicException('Knorke: anchor of the partial item ' . $e);
        }
        $target = $work[$e]['cur'];
        $parent = null;
        $pid = $target['parent'];
        if ($pid !== null) {
            if (isset($work[$pid]) && $work[$pid]['cur'] !== null) {
                $parent = $work[$pid]['cur'];
            } else {
                if (!isset($rows[$pid])) {
                    $rows += $this->items->loadItems($board, [$pid]);
                }
                $parent = isset($rows[$pid]) ? self::fromRow($rows[$pid]) : null;
            }
        }
        [$x, $y] = Connectors::anchorPoint($target, $parent === null ? null : ['x' => $parent['x'], 'y' => $parent['y']], $ep);
        return ['x' => $x, 'y' => $y];
    }

    /**
     * Parent invariant for one op (§4.7 rule 6): $values holds x, y, parent
     * (a put item or a patch with the full placement group). Returns the
     * values to apply, or null for `bad`.
     *
     *  - P never existed, or breaks a type rule (no container, childOf, cycle) → bad
     *  - P is a tombstone (deleted row, removed in this batch, or created and
     *    removed in this batch) → release: parent = null, x += P.x, y += P.y
     *  - P lives and fits → set
     */
    private static function resolveParent(array &$work, array $rows, string $childId, string $childType, array $values): ?array {
        $pid = $values['parent'] ?? null;
        if ($pid === null) {
            return $values;
        }
        if ($pid === $childId) {
            return null;
        }
        if (!isset($work[$pid]) && !isset($rows[$pid])) {
            return null;
        }
        self::touch($work, $rows, $pid);
        $parent = $work[$pid]['cur'];
        if ($parent === null) {
            return null;
        }
        if (!ItemRegistry::canBeChildOf($childType, $parent['t'])) {
            return null;
        }
        $up = $parent['parent'];
        for ($i = 0; $up !== null; $i++) {
            if ($up === $childId || $i >= self::MAX_ANCESTORS) {
                return null;
            }
            $up = $work[$up]['cur']['parent'] ?? (isset($rows[$up]) ? self::fromRow($rows[$up])['parent'] : null);
        }
        if (!in_array($work[$pid]['state'], self::LIVE, true)) {
            $values['parent'] = null;
            $values['x'] = (float)($values['x'] ?? 0) + $parent['x'];
            $values['y'] = (float)($values['y'] ?? 0) + $parent['y'];
        }
        return $values;
    }

    /**
     * Step 13a, keep (SPEC-M1 §4.7 rule 15): container $c moved by (dx, dy)
     * in this op; every child that lives NOW — stored children (liveChildren,
     * loaded once per container and batch, placement columns only) and
     * working copies with parent == $c — gets x −= dx, y −= dy, so its
     * absolute position stays. The placement group is marked (parent
     * unchanged); step 5 writes children with nothing else to write and
     * still in their stored parent in one multi-row statement
     * (ItemStore::shiftChildren, x/y only), the others — also a child that
     * an op of the batch moved into another container — with their one
     * merged change row (updateItem, parent_id included).
     *
     * Applied at the op, not at the end of the batch: a child a LATER op of
     * the batch places (the client's membership patches after a transform,
     * §6.5.2, relative to the new frame position) keeps exactly those values
     * (LWW in op order; the convergence oracle skips paths a later op of the
     * batch overwrites, §8.6). A child removed later is not written at all.
     */
    private function shiftKids(int $board, array &$work, array &$rows, array &$kids, string $c, float $dx, float $dy): void {
        if (!isset($kids[$c])) {
            $kids[$c] = true;
            if ($work[$c]['start'] !== 'none') {
                foreach ($this->items->liveChildren($board, [$c]) as $cid => $row) {
                    $cid = (string)$cid;
                    if (isset($work[$cid])) {
                        // Already in the batch: its working copy decides (it may have left $c).
                        continue;
                    }
                    $rows[$cid] ??= $row;
                    self::touch($work, $rows, $cid);
                    // A full row when an op of the batch references it, else
                    // only the placement columns (never written beyond them).
                    $work[$cid]['partial'] = !array_key_exists('data', $rows[$cid]);
                }
            }
        }
        foreach ($work as $kid => $w) {
            if ($w['cur'] === null || $w['cur']['parent'] !== $c || !in_array($w['state'], self::LIVE, true)) {
                continue;
            }
            $w['cur']['x'] = (float)$w['cur']['x'] - $dx;
            $w['cur']['y'] = (float)$w['cur']['y'] - $dy;
            foreach (OpValidator::PLACEMENT as $path) {
                $w['paths'][$path] = true;
            }
            $w['shifted'] = true;
            $work[$kid] = $w;
        }
    }

    /**
     * Step 16: for every container whose END state is removed (or that was
     * created and removed in this batch), every child that is still live —
     * from the DB or from the batch — goes to the root with x += C.x,
     * y += C.y. The paths join the child's other patches into ONE change row.
     */
    private function releaseChildren(int $board, array &$work, array &$rows): void {
        $gone = [];
        $inDb = [];
        foreach ($work as $id => $w) {
            $id = (string)$id;
            if (($w['state'] === 'removed' || $w['state'] === 'none') && $w['cur'] !== null && ItemRegistry::isContainer($w['cur']['t'])) {
                $gone[$id] = $w['cur'];
                if ($w['start'] !== 'none') {
                    $inDb[] = $id;
                }
            }
        }
        if ($gone === []) {
            return;
        }
        foreach ($this->items->liveChildren($board, $inDb) as $cid => $row) {
            $cid = (string)$cid;
            if (isset($work[$cid])) {
                // Touched by an op of this batch: its full row is loaded.
                continue;
            }
            $rows[$cid] ??= $row;
            self::touch($work, $rows, $cid);
            // liveChildren() reads only id, type, parent_id, x, y, group_id:
            // data, style, w, h, r and z of this copy are placeholders and are
            // never written (step 5 writes only its placement and its group).
            $work[$cid]['partial'] = !array_key_exists('data', $rows[$cid]);
        }
        foreach ($work as $id => $w) {
            if (!in_array($w['state'], self::LIVE, true) || !isset($gone[$w['cur']['parent'] ?? ''])) {
                continue;
            }
            $c = $gone[$w['cur']['parent']];
            $w['cur']['parent'] = null;
            $w['cur']['x'] = (float)$w['cur']['x'] + $c['x'];
            $w['cur']['y'] = (float)$w['cur']['y'] + $c['y'];
            foreach (OpValidator::PLACEMENT as $path) {
                $w['paths'][$path] = true;
            }
            $w['released'] = true;
            $work[$id] = $w;
        }
    }

    /**
     * Step 16b (SPEC-M1 §4.7 rule 14, release at the end of the batch): for
     * every item whose END state is removed (or that was created and removed
     * in this batch), each LIVE connector bound to it — stored ones found
     * through start_item/end_item (ItemStore::boundConnectors, full rows) and
     * working copies — gets the bound end as a free point {x, y} at the
     * anchor point of the item's last working copy. Same rev, the paths
     * data.start/data.end join the connector's other patches into ONE change
     * row; step 5 writes connectors with nothing else to write in one
     * multi-row statement (ItemStore::releaseConnectors). The byte change is
     * real and counted, but never refused with `limit` (derived by the
     * server). authorizeRef false leaves that end as it is (M2 decides).
     */
    private function releaseConnectorEnds(Principal $p, int $board, array &$work, array &$rows): void {
        $gone = [];
        $inDb = [];
        foreach ($work as $id => $w) {
            $id = (string)$id;
            // Only bindable items can have bound ends (rule 14 checks every
            // binding): removing frames or connectors costs no query.
            if (($w['state'] === 'removed' || $w['state'] === 'none') && $w['cur'] !== null && ItemRegistry::isBindable($w['cur']['t'])) {
                $gone[$id] = true;
                if ($w['start'] !== 'none') {
                    $inDb[] = $id;
                }
            }
        }
        if ($gone === []) {
            return;
        }
        foreach ($this->items->boundConnectors($board, $inDb) as $cid => $row) {
            $cid = (string)$cid;
            if (isset($work[$cid])) {
                // In the batch already: its working copy decides (it may have been re-bound or removed).
                continue;
            }
            $rows[$cid] ??= $row;
            self::touch($work, $rows, $cid);
        }
        $ends = [];
        $parents = [];
        foreach ($work as $cid => $w) {
            if ($w['cur'] === null || $w['cur']['t'] !== 'connector' || !in_array($w['state'], self::LIVE, true)) {
                continue;
            }
            foreach (['start', 'end'] as $which) {
                $e = self::boundItem($w['cur']['data'][$which] ?? null);
                if ($e === null || !isset($gone[$e])) {
                    continue;
                }
                $ends[(string)$cid][$which] = $e;
                $pid = $work[$e]['cur']['parent'];
                if ($pid !== null && !isset($work[$pid]) && !isset($rows[$pid])) {
                    $parents[$pid] = true;
                }
            }
        }
        if ($parents !== []) {
            // The containers of the gone targets that no op touched, in one query.
            $rows += $this->items->loadItems($board, array_map('strval', array_keys($parents)));
        }
        foreach ($ends as $cid => $bound) {
            $w = $work[$cid];
            foreach ($bound as $which => $e) {
                $ep = Connectors::endpoint($w['cur']['data'][$which]);
                if ($ep === null || !$this->authorizeRef($p, $e, null)) {
                    continue;
                }
                $w['cur']['data'][$which] = $this->anchorOf($board, $work, $rows, $e, $ep);
                $w['paths']['data.' . $which] = true;
                $w['ends'] = true;
            }
            // data changed: a new or revived connector's size is computed again in step 5.
            unset($w['size']);
            $work[$cid] = $w;
        }
    }

    /**
     * Step 16c (M2, SPEC-M1 §1.2 "(R20) Gruppieren"), after the releases:
     *
     *  1. losing groups: the stored group (orig.group ≠ null) of every item
     *     that was live at the start of the batch and is removed at its end
     *     or carries another group now
     *  2. their live members: stored rows (ItemStore::groupMembers, ONE query,
     *     only when there is a losing group) that no op of the batch touched
     *     — partial copies like those of liveChildren, never written beyond
     *     their placement and group — plus every live working copy whose
     *     group is one of them
     *  3. exactly one member left: its group becomes null (the path `group`
     *     joins its one change row, same rev, a derived row in the write
     *     budget; no authorize(): a locked member is dissolved too); none or
     *     two and more: nothing
     *
     * A group that only gains members is never counted.
     */
    private function dissolveGroups(int $board, array &$work, array &$rows): void {
        $losing = [];
        foreach ($work as $w) {
            $g = $w['start'] === 'live' ? ($w['orig']['group'] ?? null) : null;
            if ($g === null) {
                continue;
            }
            if (!in_array($w['state'], self::LIVE, true) || ($w['cur']['group'] ?? null) !== $g) {
                $losing[$g] = true;
            }
        }
        if ($losing === []) {
            return;
        }
        foreach ($this->items->groupMembers($board, array_map('strval', array_keys($losing))) as $mid => $row) {
            $mid = (string)$mid;
            if (isset($work[$mid])) {
                // In the batch already: its working copy decides (it may have left the group).
                continue;
            }
            $rows[$mid] ??= $row;
            self::touch($work, $rows, $mid);
            // Only the columns of a partial row: never written beyond its group and placement.
            $work[$mid]['partial'] = !array_key_exists('data', $rows[$mid]);
        }
        $members = [];
        foreach ($work as $id => $w) {
            $g = $w['cur']['group'] ?? null;
            if ($g !== null && isset($losing[$g]) && in_array($w['state'], self::LIVE, true)) {
                $members[$g][] = (string)$id;
            }
        }
        foreach ($members as $ids) {
            if (count($ids) === 1) {
                $work[$ids[0]]['cur']['group'] = null;
                $work[$ids[0]]['paths']['group'] = true;
            }
        }
    }

    /** Stored size of a working copy (ItemRegistry::bytes), computed once and kept in the entry. */
    private static function size(array &$w): int {
        return $w['size'] ??= ItemRegistry::bytes($w['cur'] ?? []);
    }

    /** strlen(data) + strlen(style) of a stored row: what boards.item_bytes counts. */
    private static function storedBytes(array $row): int {
        return strlen((string)($row['data'] ?? '')) + strlen((string)($row['style'] ?? ''));
    }

    /**
     * data/style roots a patch touches ([] for root fields only: placement,
     * size, z — then data/style and their size stay as they were).
     *
     * @return list<string>
     */
    private static function payloadRoots(array $patch): array {
        $roots = [];
        foreach (array_keys($patch) as $path) {
            $root = strstr((string)$path, '.', true);
            if ($root !== false) {
                $roots[$root] = true;
            }
        }
        return array_keys($roots);
    }

    /** Milliseconds since the epoch now (the lease is re-read under the lock, later than $nowMs). */
    protected function clockMs(): int {
        return (int)floor(microtime(true) * 1000);
    }

    /**
     * Effective paths of a live item (no-op paths dropped) and the columns
     * they touch. A data.* / style.* path rewrites the whole column; a
     * connector's data comes with its derived start_item/end_item (SPEC-M1
     * §4.13.2 step 17). A child shifted by keep writes its whole placement
     * group (rule 15): parent stays in the change row although unchanged.
     * The lock (M2, R20) writes locked, locked_by and locked_name; its
     * change-row value is true (locked) or null (unlocked), never the locker.
     * The group (M2, R20 Gruppieren) writes group_id, in the change row as
     * the id or null.
     *
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function effective(array $w): array {
        $eff = [];
        $cols = [];
        $group = ($w['shifted'] ?? false)
            && (!PathOps::same($w['cur']['x'], $w['orig']['x']) || !PathOps::same($w['cur']['y'], $w['orig']['y']));
        foreach (array_keys($w['paths']) as $path) {
            $path = (string)$path;
            $new = PathOps::getPath($w['cur'], $path);
            if (PathOps::same($new, PathOps::getPath($w['orig'], $path)) && !($group && $path === 'parent')) {
                continue;
            }
            if ($path === 'lock') {
                $eff['lock'] = $new === null ? null : true;
                $cols += self::lockCols($new);
                continue;
            }
            $eff[$path] = $new;
            if (isset(self::COLUMN[$path])) {
                $cols[self::COLUMN[$path]] = $new;
            } elseif (str_starts_with($path, 'data.')) {
                $cols['data'] = ItemStore::obj($w['cur']['data']);
            } else {
                $cols['style'] = ItemStore::obj($w['cur']['style']);
            }
        }
        if (isset($cols['data']) && $w['cur']['t'] === 'connector') {
            [$cols['start_item'], $cols['end_item']] = ItemStore::endItems($w['cur']);
        }
        return [$eff, $cols];
    }

    /**
     * Change-log payload of a put: the full item without its id; an item in
     * a group (M2, R20 Gruppieren) adds "group":"<id>", an item locked in the
     * same batch ([put X, lock X]) ends with "lock":true. Without either it
     * is the put of M1.
     */
    private static function putJson(array $item): string {
        $group = $item['group'] ?? null;
        return '{"t":' . json_encode($item['t'], self::JSON_FLAGS)
            . ',"x":' . ItemStore::num((float)$item['x']) . ',"y":' . ItemStore::num((float)$item['y'])
            . ',"w":' . ItemStore::num((float)$item['w']) . ',"h":' . ItemStore::num((float)$item['h'])
            . ',"r":' . ItemStore::num((float)$item['r'])
            . ',"z":' . json_encode($item['z'], self::JSON_FLAGS)
            . ',"parent":' . json_encode($item['parent'], self::JSON_FLAGS)
            . ',"data":' . ItemStore::obj($item['data']) . ',"style":' . ItemStore::obj($item['style'])
            . ($group !== null ? ',"group":' . json_encode($group, self::JSON_FLAGS) : '')
            . (($item['lock'] ?? null) !== null ? ',"lock":true' : '') . '}';
    }

    /**
     * Working copy of a stored row. group (M2, R20 Gruppieren): null for a
     * NULL or '' group_id, else the stored id. lock: null while `locked` is
     * NULL or 0, else {by: locked_by, name: locked_name} (each null when
     * NULL or ''); a partial row (liveChildren, groupMembers: no lock
     * columns) counts as unlocked and is never written beyond its placement
     * and its group.
     */
    private static function fromRow(array $r): array {
        $data = json_decode((string)($r['data'] ?? ''), true);
        $style = json_decode((string)($r['style'] ?? ''), true);
        $by = (string)($r['locked_by'] ?? '');
        $name = (string)($r['locked_name'] ?? '');
        $group = (string)($r['group_id'] ?? '');
        // w/h/rotation/z/data/style are missing in a partial row.
        return [
            't' => (string)$r['type'],
            'x' => (float)$r['x'], 'y' => (float)$r['y'], 'w' => (float)($r['w'] ?? 0), 'h' => (float)($r['h'] ?? 0),
            'r' => (float)($r['rotation'] ?? 0),
            'z' => (string)($r['z'] ?? ''),
            'parent' => $r['parent_id'] === null || $r['parent_id'] === '' ? null : (string)$r['parent_id'],
            'data' => PathOps::isMap($data) ? $data : [],
            'style' => PathOps::isMap($style) ? $style : [],
            'group' => $group === '' ? null : $group,
            'lock' => (int)($r['locked'] ?? 0) === 0 ? null : ['by' => $by === '' ? null : $by, 'name' => $name === '' ? null : $name],
        ];
    }

    /**
     * Dev hook knorke_dev_skip_bump (SPEC-M0 §8.3): with knorke_dev = true,
     * skip the Redis bump after a commit with the configured probability
     * (0–1) to simulate a lost bump. Inert everywhere else.
     */
    private function devSkipBump(): bool {
        if (!$this->config->getSystemValueBool('knorke_dev', false)) {
            return false;
        }
        $p = $this->config->getSystemValue('knorke_dev_skip_bump', 0);
        $p = is_int($p) || is_float($p) || (is_string($p) && is_numeric($p)) ? (float)$p : 0.0;
        return $p > 0 && random_int(0, 999999) < $p * 1000000;
    }

    // ── Read path ──────────────────────────────────────────────────────────

    /**
     * The /sync answer as JSON (SPEC-M1 §4.5, §4.13.8):
     *
     *   {"rev", "now", "board"?, "me"?, "items"?, "removed"?, "more"?, "acks"?, "presence"?, "resync"?}
     *
     * -1  epochOk: `ep` equals the current epoch (app config, no query)
     *  0  presence (role ≠ view), the entry after §5.5
     *  1  ops: the write budget and the daily byte quota (§4.13.6, §33.1 b;
     *     over either → `busy` for every op, nothing applied, acks.rev null,
     *     acks.retryMs, the larger one when both are over), else applyOps
     *     (its derived rows charged after COMMIT) and the vote ops
     *  2–4 rev from the access check, Redis or the DB; the own write; the
     *     safety net since > rev
     *  5  !epochOk → resync
     *  6  since < minRev → resync
     *  7  slow path (rev > since, no resync): the board head — reused from
     *     the full check (or an earlier DB read in this request) only while
     *     its rev is the rev answered, else read again (ItemStore::readHead);
     *     since < head.min_rev → resync; else the item page, then min_rev
     *     read again (R19: since < min_rev → the page is dropped, resync),
     *     and `board` ({title, meta, metaRev}, BoardStore::meta) when
     *     since < meta_rev
     *  8  `me` = {role, mod} when the request sent `role` and it differs from
     *     the principal's access level (owner|moderate|edit|vote|view,
     *     SPEC-M1 §4.5): role and moderation right change live
     *  9  `votes` (SPEC-M1 §4.5, §4.13.8, R16): (a) {sid, mine, left} from
     *     step 1b while the session of the vote ops is open after the batch
     *     (mine an object, {} when empty); (b) for canModerate() with `vt`:
     *     (i) vt:<board> present and its seq equal to `vt` → nothing, no
     *     query; (ii) else VoteService::progress → {sid, voters, vt}. Both
     *     name the same sid (when they would not, the fresher (b) wins).
     *
     * The fast path (rev == since, no ops) stays without app SQL: step 7
     * does not run, `now` costs nothing, step 9 (i) is one cache read.
     */
    public function sync(AccessResult $a, int $board, SyncRequest $r, int $nowMs): string {
        $p = $a->principal;
        $selfKey = $p->pid . ':' . $r->client;

        // -1) The board epoch (§5.4): a tab from before a rotation resyncs.
        $epochOk = $r->epoch === $this->epoch->current();

        // 0) Presence BEFORE the ops: a lease (also a take-over) counts already.
        $map = null;
        if ($r->me !== null && $p->role !== Role::View) {
            [, $map] = $this->presence->write($board, $selfKey, PresenceStore::entry($p, $r->me, $nowMs), $nowMs);
        }

        // 1) Ops: (4) the write budget and the daily byte quota first (all
        //    four counters w:, wo:, wd:, wu: raised, then decided; §33.1 b) —
        //    over either, NOTHING of the request is applied and every result
        //    is `busy` (never mixed, §4.5/§4.6), acks.rev = null,
        //    acks.retryMs with `now` of this answer (§4.13.6, C76, C81);
        //    then 1a object ops (applyOps; their
        //    derived rows charged after COMMIT), 1b vote ops
        //    (VoteService::apply), results merged back by position; acks.rev
        //    from 1a only.
        $acks = null;
        $over = 0;
        $written = null;
        $voted = null;
        if ($r->ops !== []) {
            $over = $this->budget->admit($p, $board, count($r->ops), $r->bodyBytes(), $nowMs);
        }
        $busy = $over !== 0;
        if ($busy) {
            $acks = '{"seq":' . (int)$r->seq . ',"rev":null,"res":' . json_encode(array_fill(0, count($r->ops), 'busy'));
        } elseif ($r->ops !== []) {
            $objects = [];
            $votes = [];
            foreach ($r->ops as $i => $op) {
                if (OpValidator::isVote($op)) {
                    $votes[$i] = OpValidator::normalizeVote($p, $op);
                } else {
                    $objects[$i] = $op;
                }
            }
            $res = [];
            if ($objects !== []) {
                if ($map === null && $this->presence->available() && OpValidator::touchesTextPath($objects)) {
                    $map = $this->presence->read($board, $nowMs);
                }
                [$written, $objectRes, $derived] = $this->applyOpsCounted($p, $board, $r->client, array_values($objects), $nowMs, $map);
                $res = array_combine(array_keys($objects), $objectRes);
                $this->budget->charge($p, $board, $derived, $nowMs);
            }
            if ($votes !== []) {
                $voted = $this->votes->apply($p, $board, array_values($votes), $nowMs,
                    fn (Principal $who, array $op, ?array $cur, ?array $row): ?string => $this->authorize($who, $op, $cur, $row));
                $res += array_combine(array_keys($votes), $voted['res']);
            }
            ksort($res);
            $acks = '{"seq":' . (int)$r->seq . ',"rev":' . ($written === null ? 'null' : $written) . ',"res":' . json_encode(array_values($res)) . '}';
        }

        // 2) The board rev: from the access check, Redis or the DB. $head is a
        //    board head (rev, min_rev, meta_rev) read in ONE statement, if any.
        $head = $a->head();
        $rev = $a->dbRev ?? $this->cache->getRev($board);
        $minRev = $a->minRev;
        if ($rev === null) {
            $head = $this->items->readHead($board) ?? throw new HttpError(404, 'not_found');
            $rev = $head['rev'];
            $minRev = $head['min_rev'];
            $this->cache->seedRev($board, $rev);
        }
        // 3) The cursor covers the own write.
        if ($written !== null) {
            $rev = max($rev, $written);
        }
        // 4) Safety net (b): clients only know committed revs, so Redis lags provably.
        $resync = false;
        if ($r->since > $rev) {
            $db = $this->items->readHead($board) ?? throw new HttpError(404, 'not_found');
            $minRev = $db['min_rev'];
            if ($db['rev'] >= $r->since) {
                $this->cache->bumpRev($board, $db['rev']);
                $rev = $db['rev'];
                $head = $db;
            } else {
                // Client "from the future" (DB restore, reset).
                $resync = true;
            }
        }
        // 5) Another epoch: the client's cursor belongs to another history.
        if (!$epochOk) {
            $resync = true;
        }
        // 6) History below min_rev is gone.
        if ($r->since < $minRev) {
            $resync = true;
        }

        // 7) Slow path. A head read before the own write (or before a meta
        //    write that committed in between) could miss a meta_rev ≤ rev:
        //    the client would move its cursor past a title it never got.
        $json = '{"rev":';
        $page = null;
        if (!$resync && $rev > $r->since) {
            if ($head === null || $head['rev'] !== $rev) {
                $head = $this->items->readHead($board) ?? throw new HttpError(404, 'not_found');
            }
            if ($r->since < $head['min_rev']) {
                $resync = true;
            } else {
                $page = $this->items->itemsSince($board, $r->since, $rev, Limits::PAGE);
                // (R19, T4-05) min_rev once more AFTER the page: a purge block
                // that committed between the head and the page deleted
                // tombstones the page then lacks. min_rev only rises, so every
                // purge committed before this read is visible here; a later
                // one does not touch the page already read.
                $minAfter = $this->items->readMinRev($board) ?? throw new HttpError(404, 'not_found');
                if ($r->since < $minAfter) {
                    $page = null;
                    $resync = true;
                }
            }
        }
        // 8) The access level the client knows is outdated: the new role and moderation right.
        $me = $r->role !== null && $r->role !== $p->access()
            ? ',"me":{"role":' . json_encode($p->role->value) . ',"mod":' . ($p->canModerate() ? 'true' : 'false') . '}'
            : '';
        // `now` of this answer, once: the busy retryMs is computed from the same value (C76, C81).
        $now = $this->serverNow($nowMs);
        if ($busy) {
            $acks .= ',"retryMs":' . WriteBudget::busyRetryMs($over, $now) . '}';
        }
        if ($page !== null) {
            [$rows, $upTo, $more] = $page;
            unset($page);
            $json .= $upTo . ',"now":' . $now;
            if ($r->since < $head['meta_rev']) {
                $json .= ',"board":' . $this->boardMetaJson($board);
            }
            $json .= $me;
            // The answer is built while the rows are consumed (each row freed
            // after use): peak ≤ about 2 × the page (string growth), not rows
            // + fragments + implode (≈ 3 ×).
            $removed = [];
            $n = 0;
            $pidOf = $this->pidOf($board);
            foreach (array_keys($rows) as $k) {
                $row = $rows[$k];
                unset($rows[$k]);
                if ((int)$row['deleted'] === 1) {
                    $removed[] = (string)$row['id'];
                    continue;
                }
                $json .= $n++ === 0 ? ',"items":[' : ',';
                $json .= ItemStore::itemJson($row, $pidOf);
            }
            unset($row);
            if ($n > 0) {
                $json .= ']';
            }
            if ($removed !== []) {
                $json .= ',"removed":' . json_encode($removed);
            }
            if ($more) {
                $json .= ',"more":true';
            }
        } else {
            $json .= $rev . ',"now":' . $now . $me;
        }
        if ($acks !== null) {
            $json .= ',"acks":' . $acks;
        }
        // 9) Votes: the own (a) and, for moderators with vt, the number of voters (b).
        $votesJson = $this->votesJson($p, $board, $r, $voted, $nowMs);
        if ($votesJson !== null) {
            $json .= ',"votes":' . $votesJson;
        }

        // Presence of the others: ALWAYS present with pres = 1 (frozen
        // contract §10.2, §5.1), also as {} — when Redis is unavailable
        // presence is off and the key still comes, empty. read() answers
        // [] without touching any cache in that case.
        if ($r->wantPresence) {
            $map ??= $this->presence->read($board, $nowMs);
            $json .= ',"presence":' . self::object(PresenceStore::public($map, $selfKey, $nowMs));
        }
        if ($resync) {
            $json .= ',"resync":true';
        }
        return $json . '}';
    }

    /**
     * principal id → pid on this board, for lock.by of the items of one
     * answer (ItemStore::itemJson; snapshot, guest join, slow sync path):
     * the formula of Access::pid, so lock.by equals me.pid and the presence
     * key of the locker; a stored u:<uid>/g:<gid> never leaves the server.
     * The system secret is read at most once per answer, and only when a
     * locked row asks for it (itemJson calls this only then).
     *
     * @return \Closure(string): string
     */
    private function pidOf(int $board): \Closure {
        $secret = null;
        return function (string $principalId) use ($board, &$secret): string {
            $secret ??= $this->config->getSystemValueString('secret');
            return Access::derivePid($secret, $board, $principalId);
        };
    }

    /**
     * Snapshot (SPEC-M1 §4.4, protocol 2):
     *
     *   {"proto", "epoch", "now", "rev", "minRev", "schema",
     *    "board": {"id", "title", "role", "metaRev", "meta", …$boardMeta},
     *    "me": {"pid", "name", "role", "guest", "mod", "source"},
     *    "items": […], "guest"?}
     *
     * The rev is read BEFORE the metadata and the items: a write committing
     * in between is then in the snapshot AND in the next sync. Title, meta
     * and metaRev come from ONE read after the rev (BoardStore::meta), so a
     * meta change ≤ rev is always in it (one read before the rev could hand
     * out an old title with a cursor past its change).
     *
     * @param array $boardMeta {id, role, schema?} plus what only some roles get
     *   (links, linksAllowed); a `title` in it is ignored (the stored one wins)
     * @param array|null $guest {token, exp} on a guest join
     * @param int|null $nowMs request time (ms); `now` is never earlier
     */
    public function snapshotJson(AccessResult $a, int $board, array $boardMeta, ?array $guest = null, ?int $nowMs = null): string {
        $rev = $a->dbRev;
        $minRev = $a->minRev;
        if ($rev === null) {
            $db = $this->items->readRev($board) ?? throw new HttpError(404, 'not_found');
            $rev = $db['rev'];
            $minRev = $db['min_rev'];
        }
        $meta = $this->boards->meta($board) ?? throw new HttpError(404, 'not_found');
        $schema = (int)($boardMeta['schema'] ?? 1);
        $extra = array_diff_key($boardMeta, ['id' => 1, 'title' => 1, 'role' => 1, 'schema' => 1]);
        $p = $a->principal;
        $flags = self::JSON_FLAGS | JSON_INVALID_UTF8_SUBSTITUTE;
        $boardJson = '{"id":' . (int)($boardMeta['id'] ?? $board)
            . ',"title":' . json_encode($meta['title'], $flags)
            . ',"role":' . json_encode((string)($boardMeta['role'] ?? $p->role->value), $flags)
            . ',"metaRev":' . $meta['meta_rev']
            . ',"meta":' . MetaService::wire($meta['meta'])
            . ($extra === [] ? '' : ',' . substr(json_encode($extra, $flags), 1, -1))
            . '}';
        $me = [
            'pid' => $p->pid, 'name' => $p->displayName, 'role' => $p->role->value, 'guest' => $p->isGuest,
            'mod' => $p->canModerate(), 'source' => $p->source(),
        ];
        $json = '{"proto":' . Application::PROTOCOL
            . ',"epoch":' . json_encode($this->epoch->current())
            . ',"now":' . $this->serverNow($nowMs ?? 0)
            . ',"rev":' . $rev . ',"minRev":' . $minRev . ',"schema":' . $schema
            . ',"board":' . $boardJson
            . ',"me":' . json_encode($me, $flags)
            . $this->snapshotVotes($p, $board, $meta['meta'])
            . ',"items":[';
        // Appended one item at a time while the rows stream in: peak ≤ about
        // 2 × the answer (string growth), not rows + fragments + implode.
        $first = true;
        foreach ($this->items->snapshotItems($board, $this->pidOf($board)) as $item) {
            if (!$first) {
                $json .= ',';
            }
            $json .= $item;
            $first = false;
        }
        $json .= ']';
        $this->cache->seedRev($board, $rev);
        if ($guest !== null) {
            $json .= ',"guest":' . json_encode($guest, self::JSON_FLAGS);
        }
        return $json . '}';
    }

    /**
     * The `votes` block of a sync answer (SPEC-M1 §4.5 R16, §4.13.8 step 9)
     * or null when neither (a) nor (b) delivers. Keys in the order sid,
     * mine, left, voters, vt; `mine` is a JSON object, {} when empty.
     *
     * @param array{res: list<string>, sid: ?int, mine: ?array, left: ?int}|null $voted step 1b
     */
    private function votesJson(Principal $p, int $board, SyncRequest $r, ?array $voted, int $nowMs): ?string {
        $block = [];
        if ($voted !== null && $voted['sid'] !== null) {
            $block = ['sid' => $voted['sid'], 'mine' => $voted['mine'] ?? [], 'left' => $voted['left'] ?? 0];
        }
        if ($p->canModerate() && $r->voteTally !== null) {
            $c = $this->cache->getVoteSeq($board);
            // (i) The key confirms what the moderator saw: no query (the fast path stays without app SQL).
            if ($c === null || $c['seq'] !== $r->voteTally) {
                $prog = $this->votes->progress($p, $board, $r->voteTally, $nowMs);
                if ($prog !== null) {
                    if (($block['sid'] ?? $prog['sid']) !== $prog['sid']) {
                        // Another session opened in between: the older block (a) is stale.
                        $block = [];
                    }
                    $block['sid'] = $prog['sid'];
                    $block['voters'] = $prog['voters'];
                    $block['vt'] = $prog['vt'];
                }
            }
        }
        if ($block === []) {
            return null;
        }
        $out = '{"sid":' . (int)$block['sid'];
        if (array_key_exists('mine', $block)) {
            $out .= ',"mine":' . self::object($block['mine']) . ',"left":' . (int)$block['left'];
        }
        if (array_key_exists('voters', $block)) {
            $out .= ',"voters":' . (int)$block['voters'] . ',"vt":' . (int)$block['vt'];
        }
        return $out . '}';
    }

    /**
     * `,"votes":{sid, mine, left}` of snapshot and join (SPEC-M1 §4.4, R16)
     * or '': only while meta.vote is open (no query otherwise) and only for
     * a principal that may vote; mine counts live items, {} when empty.
     */
    private function snapshotVotes(Principal $p, int $board, ?string $storedMeta): string {
        if (!$p->role->canVote()) {
            return '';
        }
        $vote = MetaService::decode($storedMeta)['vote'] ?? null;
        if (!is_array($vote) || ($vote['state'] ?? null) !== 'open') {
            return '';
        }
        $mine = $this->votes->mine($board, $p->pid);
        if ($mine === null) {
            return '';
        }
        return ',"votes":{"sid":' . $mine['sid'] . ',"mine":' . self::object($mine['mine']) . ',"left":' . $mine['left'] . '}';
    }

    /** `board` of the slow sync path: {"title", "meta", "metaRev"} as stored now. */
    private function boardMetaJson(int $board): string {
        $m = $this->boards->meta($board) ?? throw new HttpError(404, 'not_found');
        return '{"title":' . json_encode($m['title'], self::JSON_FLAGS | JSON_INVALID_UTF8_SUBSTITUTE)
            . ',"meta":' . MetaService::wire($m['meta']) . ',"metaRev":' . $m['meta_rev'] . '}';
    }

    /** Server time `now` in ms while the answer is built (never before the request time). */
    private function serverNow(int $nowMs): int {
        return max($nowMs, $this->clockMs());
    }

    /** JSON object of a string-keyed array; "{}" when empty (never "[]"). */
    private static function object(array $map): string {
        return $map === [] ? '{}' : json_encode($map, self::JSON_FLAGS | JSON_INVALID_UTF8_SUBSTITUTE);
    }
}
