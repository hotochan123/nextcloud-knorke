<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Exception\HttpError;

/**
 * Timer and "Bring everyone here" (SPEC-M1 §4.12, §4.12.2, §4.12.3, §3.11):
 * meta.timer and meta.summon, written through the meta write path
 * (MetaService::write: board lock first, read under the lock, rev + 1,
 * meta_rev = rev, bumpRev after the COMMIT). The rules are pure functions
 * (timerAfter, summonAfter) so every edge case is a unit test.
 *
 * Timer (§4.12.2, R16): start (ms 1000–TIMER_MAX_MS) replaces any timer;
 * pause needs a running timer that has not run out (end > now); resume
 * needs a paused one; add (ms 1000–TIMER_ADD_MAX_MS) needs a running or
 * paused one — on a running timer that has run out (end ≤ now) the new end
 * is now + ms; the remaining time never exceeds TIMER_MAX_MS (capped), dur
 * grows by ms; stop needs a timer and removes it. A wrong state → 409
 * timer_state; a missing or out-of-range ms for start/add → 400
 * bad_request; an unknown action → 400 bad_request; ms is ignored where it
 * is not needed. Every change increments seq. A run-out timer stays
 * running (every client shows "Time's up") until stop or start.
 *
 * Summon (§4.12.3, R2): POST sets {pid, client, name, seq: old seq + 1,
 * at: now} — client is the id of the presenting tab (CLIENT_RE of sync);
 * DELETE removes it, and without a summon it writes nothing and answers the
 * stored state (idempotent, R16).
 */
class ModerationService {
    public const TIMER_ACTIONS = ['start', 'pause', 'resume', 'add', 'stop'];

    public function __construct(
        private MetaService $meta,
    ) {
    }

    /**
     * Route 24 `PUT …/timer` {action, ms?}.
     *
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 400 bad_request | 404 | 409 timer_state
     */
    public function timer(Principal $p, int $board, mixed $action, mixed $ms, int $nowMs): array {
        if (!is_string($action) || !in_array($action, self::TIMER_ACTIONS, true)) {
            throw new HttpError(400, 'bad_request', 'Unknown timer action.');
        }
        $ms = self::msFor($action, $ms);
        return $this->meta->write($board, static function (array $m) use ($action, $ms, $nowMs, $p): array {
            $timer = self::timerAfter(is_array($m['timer'] ?? null) ? $m['timer'] : null, $action, $ms, $nowMs, $p->displayName);
            if ($timer === null) {
                unset($m['timer']);
            } else {
                $m['timer'] = $timer;
            }
            return $m;
        }, $nowMs);
    }

    /**
     * The ms of start/add checked (start 1000–TIMER_MAX_MS, add
     * 1000–TIMER_ADD_MAX_MS); other actions ignore it (null).
     *
     * @throws HttpError 400 bad_request
     */
    public static function msFor(string $action, mixed $ms): ?int {
        if ($action !== 'start' && $action !== 'add') {
            return null;
        }
        $max = $action === 'start' ? Limits::TIMER_MAX_MS : Limits::TIMER_ADD_MAX_MS;
        $n = Input::whole($ms);
        if ($n === null || $n < Limits::TIMER_MIN_MS || $n > $max) {
            throw new HttpError(400, 'bad_request', 'Invalid ms.');
        }
        return $n;
    }

    /**
     * meta.timer after $action (§4.12.2, R16); null = no timer (stop).
     *
     * @param array|null $timer the stored meta.timer
     * @throws HttpError 409 timer_state
     */
    public static function timerAfter(?array $timer, string $action, ?int $ms, int $nowMs, string $by): ?array {
        $state = is_array($timer) ? ($timer['state'] ?? null) : null;
        $running = $state === 'running' && is_int($timer['end'] ?? null);
        $paused = $state === 'paused' && is_int($timer['left'] ?? null);
        $seq = (is_int($timer['seq'] ?? null) ? $timer['seq'] : 0) + 1;
        $dur = is_int($timer['dur'] ?? null) ? $timer['dur'] : 0;
        $conflict = static fn (): HttpError => new HttpError(409, 'timer_state');
        switch ($action) {
            case 'start':
                return ['state' => 'running', 'dur' => $ms, 'end' => $nowMs + $ms, 'left' => null, 'by' => $by, 'seq' => $seq];
            case 'pause':
                if (!$running || $timer['end'] <= $nowMs) {
                    // Not running, or run out: nothing left to keep (R16).
                    throw $conflict();
                }
                return ['state' => 'paused', 'dur' => $dur, 'end' => null, 'left' => $timer['end'] - $nowMs, 'by' => $timer['by'] ?? $by, 'seq' => $seq];
            case 'resume':
                if (!$paused) {
                    throw $conflict();
                }
                return ['state' => 'running', 'dur' => $dur, 'end' => $nowMs + $timer['left'], 'left' => null, 'by' => $timer['by'] ?? $by, 'seq' => $seq];
            case 'add':
                if ($running) {
                    // A run-out timer starts again from now (R16); the rest never exceeds 99:59.
                    $end = max($timer['end'], $nowMs) + $ms;
                    return ['state' => 'running', 'dur' => $dur + $ms, 'end' => min($end, $nowMs + Limits::TIMER_MAX_MS), 'left' => null,
                        'by' => $timer['by'] ?? $by, 'seq' => $seq];
                }
                if ($paused) {
                    return ['state' => 'paused', 'dur' => $dur + $ms, 'end' => null, 'left' => min($timer['left'] + $ms, Limits::TIMER_MAX_MS),
                        'by' => $timer['by'] ?? $by, 'seq' => $seq];
                }
                throw $conflict();
            case 'stop':
                if ($timer === null) {
                    throw $conflict();
                }
                return null;
        }
        throw new HttpError(400, 'bad_request', 'Unknown timer action.');
    }

    /**
     * Route 25 `POST …/summon` {client}.
     *
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 400 bad_request | 404
     */
    public function summon(Principal $p, int $board, mixed $client, int $nowMs): array {
        if (!is_string($client) || preg_match(SyncRequest::CLIENT_RE, $client) !== 1) {
            throw new HttpError(400, 'bad_request', 'Invalid client id.');
        }
        return $this->meta->write($board, static function (array $m) use ($p, $client, $nowMs): array {
            $m['summon'] = self::summonAfter(is_array($m['summon'] ?? null) ? $m['summon'] : null, $p, $client, $nowMs);
            return $m;
        }, $nowMs);
    }

    /** meta.summon of a new "Bring everyone here" (§4.12.3): seq = old seq + 1 (1 without one). */
    public static function summonAfter(?array $old, Principal $p, string $client, int $nowMs): array {
        $seq = (is_int($old['seq'] ?? null) ? $old['seq'] : 0) + 1;
        return ['pid' => $p->pid, 'client' => $client, 'name' => $p->displayName, 'seq' => $seq, 'at' => $nowMs];
    }

    /**
     * Route 26 `DELETE …/summon`: removes meta.summon; without one nothing is
     * written and the stored state is the answer (same metaRev, R16).
     *
     * @return array{title: string, meta: array, metaRev: int}
     * @throws HttpError 404
     */
    public function endSummon(int $board, int $nowMs): array {
        return $this->meta->write($board, static function (array $m): ?array {
            if (!array_key_exists('summon', $m)) {
                return null;
            }
            unset($m['summon']);
            return $m;
        }, $nowMs);
    }
}
