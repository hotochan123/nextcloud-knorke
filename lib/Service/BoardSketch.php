<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\ItemStore;

/**
 * The sketch of a stored board for its row in the board list (route 57,
 * factory job 221), in the form of a template's sketch (TemplateStore
 * sketchOf, job 182): a list of at most SKETCH_MAX entries [x, y, w, h,
 * fill] in a SKETCH_W × SKETCH_H box, fill '' for a frame, else #rrggbb.
 * Only numbers and colours: no text, no picture, no name leaves the server.
 *
 * Built from the stored board, quick for large boards too:
 *  1. the boxes of every live item but connectors, numbers only (ItemStore
 *     sketchBoxes: id, type, parent, x, y, w, h; never data or style);
 *  2. absolute places (a child moved by the chain of its parents, at most
 *     MAX_DEPTH steps; a parent not in the set ends the chain), rotation
 *     left out, negative sizes as 0;
 *  3. the union of ALL boxes fitted into the middle of the box with a
 *     margin of PAD, as board/ownTemplates.js ownSketch;
 *  4. frames first, then the others, each by area descending, equal areas
 *     by id: the first SKETCH_MAX, drawn in that order;
 *  5. the style of the chosen items that are no frame (ItemStore stylesOf,
 *     at most SKETCH_MAX ids): fill = style.fill when it is #rrggbb (lower
 *     case), else FILL; broken JSON is FILL too.
 * A board without boxes has the sketch [] (step 5 is left out).
 *
 * The link preview of a board (factory job 236, BoardReferenceProvider)
 * shows the same sketch as its picture: ofBoard() after the provider's own
 * rights check, svg() for the picture.
 */
class BoardSketch {
    /** The margin inside the box (ownTemplates.js SKETCH_PAD). */
    public const PAD = 4;
    /** The fill of an item without a #rrggbb fill (ownTemplates.js SKETCH_FILL). */
    public const FILL = '#d0d0d0';
    /** The board's colour behind the picture of svg() (knorke.css --knorke-board-bg). */
    public const BOARD = '#f3f2f0';
    /** Steps of a parent chain (SyncService MAX_ANCESTORS). */
    private const MAX_DEPTH = 8;

    public function __construct(
        private Access $access,
        private ItemStore $items,
    ) {
    }

    /**
     * Route 57: the sketch of $board for the signed-in account. Any role may
     * (view and vote too); no access and an unknown board get the same 404
     * not_found before any item is read.
     *
     * @return list<array{0: int|float, 1: int|float, 2: int|float, 3: int|float, 4: string}>
     * @throws \OCA\Knorke\Exception\HttpError 401 not_logged_in, 404 not_found
     */
    public function forUser(int $board): array {
        $this->access->forUser($board);
        return $this->ofBoard($board);
    }

    /**
     * The sketch of $board, read only and without a rights check: the caller
     * has checked them (forUser(), BoardReferenceProvider).
     *
     * @return list<array{0: int|float, 1: int|float, 2: int|float, 3: int|float, 4: string}>
     */
    public function ofBoard(int $board): array {
        return self::of($this->items->sketchBoxes($board), fn (array $ids): array => $this->items->stylesOf($board, $ids));
    }

    /**
     * The picture of a sketch for a board's link preview (factory job 236):
     * an SVG of 2 : 1 like img/board-card.svg, so the card stays as low, with
     * the SKETCH_W × SKETCH_H box in its middle on the board's colour; frames
     * white with a grey outline, the others in their fill with a faint
     * outline, as the board list draws them (knorke.css
     * .knorke-templates__frame, __note). Only entries of the form of of()
     * are drawn (numbers inside the box, fill '' or #rrggbb), at most
     * SKETCH_MAX, in their order: the SVG holds nothing but svg and rect
     * elements with numbers and colours.
     *
     * @param list<mixed> $sketch a sketch of of()
     */
    public static function svg(array $sketch): string {
        $out = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="-20 0 160 80">'
            . '<rect x="-20" y="0" width="160" height="80" fill="' . self::BOARD . '"/>';
        foreach (array_slice(array_values($sketch), 0, TemplateStore::SKETCH_MAX) as $e) {
            if (!is_array($e) || !array_is_list($e) || count($e) !== 5) {
                continue;
            }
            [$x, $y, $w, $h, $fill] = $e;
            if (!self::within($x, TemplateStore::SKETCH_W) || !self::within($y, TemplateStore::SKETCH_H)
                || !self::within($w, TemplateStore::SKETCH_W) || !self::within($h, TemplateStore::SKETCH_H)
                || !is_string($fill) || ($fill !== '' && preg_match('/^#[0-9a-fA-F]{6}$/D', $fill) !== 1)) {
                continue;
            }
            $paint = $fill === ''
                ? 'fill="#ffffff" stroke="#7f8790" stroke-width="0.6"'
                : 'fill="' . strtolower($fill) . '" stroke="#000000" stroke-opacity="0.25" stroke-width="0.4"';
            $out .= '<rect x="' . $x . '" y="' . $y . '" width="' . $w . '" height="' . $h . '" ' . $paint . '/>';
        }
        return $out . '</svg>';
    }

    /**
     * The sketch of a board's boxes (see the class comment).
     *
     * @param list<array<string, mixed>> $rows id, type, parent_id, x, y, w, h of every live item but connectors
     * @param \Closure(list<string>): array<string, ?string> $styles the stored style JSON of the given ids
     * @return list<array{0: int|float, 1: int|float, 2: int|float, 3: int|float, 4: string}>
     */
    public static function of(array $rows, \Closure $styles): array {
        $byId = [];
        foreach ($rows as $r) {
            $byId[(string)$r['id']] = $r;
        }
        $boxes = [];
        foreach ($rows as $r) {
            $x = self::num($r['x'] ?? null);
            $y = self::num($r['y'] ?? null);
            $p = $r['parent_id'] ?? null;
            for ($depth = 0; $p !== null && isset($byId[(string)$p]) && $depth < self::MAX_DEPTH; $depth++) {
                $parent = $byId[(string)$p];
                $x += self::num($parent['x'] ?? null);
                $y += self::num($parent['y'] ?? null);
                $p = $parent['parent_id'] ?? null;
            }
            $w = max(0.0, self::num($r['w'] ?? null));
            $h = max(0.0, self::num($r['h'] ?? null));
            $boxes[] = ['id' => (string)$r['id'], 'frame' => $r['type'] === 'frame', 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
        }
        if ($boxes === []) {
            return [];
        }
        $x0 = min(array_column($boxes, 'x'));
        $y0 = min(array_column($boxes, 'y'));
        $W = max(array_map(static fn (array $b): float => $b['x'] + $b['w'], $boxes)) - $x0;
        $H = max(array_map(static fn (array $b): float => $b['y'] + $b['h'], $boxes)) - $y0;
        $sx = $W > 0 ? (TemplateStore::SKETCH_W - 2 * self::PAD) / $W : INF;
        $sy = $H > 0 ? (TemplateStore::SKETCH_H - 2 * self::PAD) / $H : INF;
        $s = is_finite(min($sx, $sy)) ? min($sx, $sy) : 1.0;
        $ox = (TemplateStore::SKETCH_W - $W * $s) / 2;
        $oy = (TemplateStore::SKETCH_H - $H * $s) / 2;

        usort($boxes, static fn (array $a, array $b): int => [$b['frame'], $b['w'] * $b['h'], $a['id']] <=> [$a['frame'], $a['w'] * $a['h'], $b['id']]);
        $chosen = array_slice($boxes, 0, TemplateStore::SKETCH_MAX);
        $ids = array_values(array_map(static fn (array $b): string => $b['id'], array_filter($chosen, static fn (array $b): bool => !$b['frame'])));
        $style = $ids === [] ? [] : $styles($ids);

        $out = [];
        foreach ($chosen as $b) {
            $out[] = [
                self::r2($ox + ($b['x'] - $x0) * $s, TemplateStore::SKETCH_W),
                self::r2($oy + ($b['y'] - $y0) * $s, TemplateStore::SKETCH_H),
                self::r2($b['w'] * $s, TemplateStore::SKETCH_W),
                self::r2($b['h'] * $s, TemplateStore::SKETCH_H),
                $b['frame'] ? '' : self::fill($style[$b['id']] ?? null),
            ];
        }
        return $out;
    }

    /** A number of a row (the database may return text): finite, else 0. */
    private static function num(mixed $v): float {
        $f = is_int($v) || is_float($v) || (is_string($v) && is_numeric($v)) ? (float)$v : 0.0;
        return is_finite($f) ? $f : 0.0;
    }

    /** A number of a sketch: an int or a finite float in [0, $max] (as TemplateStore::within). */
    private static function within(mixed $v, int $max): bool {
        return (is_int($v) || (is_float($v) && is_finite($v))) && $v >= 0 && $v <= $max;
    }

    /** $v rounded to 0.01, inside [0, $max]. */
    private static function r2(float $v, int $max): int|float {
        $x = round($v, 2);
        return $x > 0 ? min($x, $max) : 0;
    }

    /** The fill of a stored style: style.fill when it is #rrggbb (lower case), else FILL. */
    private static function fill(mixed $json): string {
        if (!is_string($json) || $json === '') {
            return self::FILL;
        }
        try {
            $style = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::FILL;
        }
        $fill = is_array($style) ? ($style['fill'] ?? null) : null;
        return is_string($fill) && preg_match('/^#[0-9a-fA-F]{6}$/D', $fill) === 1 ? strtolower($fill) : self::FILL;
    }
}
