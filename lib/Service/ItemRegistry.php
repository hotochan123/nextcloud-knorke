<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Db\ItemStore;

/**
 * Data-driven type rules (SPEC-M0 §4.8, §4.7 rules 6–8; v2: SPEC-M1 §4.8,
 * §4.7 rules 12, 14, 18, 19). The client counterpart is
 * src/model/registry.js; tests/fixtures/registry-golden.json pins both.
 *
 * Kinds of field rules: text (plain text after cleaning, ≤ n code points),
 * color (^#[0-9a-fA-F]{6}\z, stored lower-case), int (whole number in
 * bounds), enum (a string of the list, strictly), endpoint (a connector end,
 * Connectors::endpoint), (factory job 191) tags (a list of 1–n different
 * ids in ULID form: the tags of a note, data.tags; an empty list deletes the
 * field like every empty value), (factory job 203) image (a list of pieces
 * whose concatenation is a picture, ShapeImage::join: a shape's data.img),
 * (factory job 273) points (a flat list x0, y0, x1, y1, … of 2–n finite
 * numbers with |v| ≤ 1e7, even length: a pen stroke's data.points).
 * Reserved for later: bool, number — a rule without a checker refuses every value. `size` bounds
 * w and h. Fields not listed (unknown fields under data/style) are kept and
 * only checked generically (OpValidator).
 *
 * Per type also: bindable (a connector end may point at it), votable,
 * placement (box | none: a connector has no own position, rule 12) and
 * required (fields a put must carry and a patch must not delete, rule 19).
 * Groupable (M2, R20 Gruppieren) is derived, not a table key: a known type
 * with placement box that is no container (isGroupable).
 *
 * Types not listed (stored by a later version, an import, a downgrade) use
 * GENERIC: patch and remove work with generic rules, put does not accept
 * them, they are neither bindable nor votable.
 */
final class ItemRegistry {
    /** Shape kinds; job 201 adds the flowchart kinds and the symbols (icon…), job 203 image, job 204 the BPMN kinds (bpmn…). */
    private const SHAPE_KINDS = [
        'rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight',
        'terminal', 'parallelogram', 'document', 'database', 'subprocess', 'hexagon', 'manualInput', 'trapezoid', 'delay', 'offPage',
        'iconPerson', 'iconPeople', 'iconPlace', 'iconClock', 'iconWarning', 'iconInfo', 'iconQuestion', 'iconDone', 'iconError', 'iconStar', 'iconHeart', 'iconIdea', 'iconFlag', 'iconCalendar', 'iconMail', 'iconPhone', 'iconHome', 'iconSettings', 'iconLock', 'iconCloud',
        // job 203: an own shape, its picture in data.img (ShapeImage)
        'image',
        // job 204: BPMN 2.0, events, tasks, gateways and data
        'bpmnStart', 'bpmnStartMessage', 'bpmnStartTimer', 'bpmnIntermediate', 'bpmnIntermediateMessage', 'bpmnIntermediateTimer', 'bpmnEnd', 'bpmnEndMessage', 'bpmnEndError', 'bpmnEndTerminate',
        'bpmnTask', 'bpmnUserTask', 'bpmnServiceTask', 'bpmnManualTask', 'bpmnScriptTask', 'bpmnRuleTask', 'bpmnSendTask', 'bpmnReceiveTask', 'bpmnSubprocess', 'bpmnCallActivity',
        'bpmnExclusive', 'bpmnParallel', 'bpmnInclusive', 'bpmnEventGateway', 'bpmnDataObject', 'bpmnDataInput', 'bpmnDataOutput', 'bpmnDataStore',
    ];
    private const DASHES = ['solid', 'dashed', 'dotted'];
    private const ALIGNS = ['left', 'center', 'right'];
    private const VALIGNS = ['top', 'middle', 'bottom'];
    private const ROUTES = ['straight', 'elbow', 'curved'];
    /** Connector tips; job 204 adds the open circle and the open triangle of a BPMN message flow. */
    private const CAPS = ['none', 'arrow', 'triangle', 'dot', 'diamond', 'circleOpen', 'triangleOpen'];
    /** style.header of a table (job 173), style.headerCol (job 265). */
    private const HEADERS = ['on', 'off'];
    /** style.layout of a mind map (job 195). */
    private const MIND_LAYOUTS = ['both', 'right', 'org', 'tree'];
    /** data.kind of a pen stroke (job 273): a pen line or a see-through highlighter stroke. */
    private const PEN_KINDS = ['pen', 'marker'];
    /** Most numbers in a stroke's data.points (job 273): 500 points of x and y. */
    public const POINTS_MAX = 1000;

    /** The root fields a type with placement none never has (rule 12). */
    private const BOX_FIELDS = ['x', 'y', 'w', 'h', 'r', 'parent'];

    private const TYPES = [
        'sticky' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => true,
            'size' => [20, 2000], 'textPath' => 'data.text', 'bindable' => true, 'votable' => true, 'placement' => 'box',
            'required' => [],
            // job 191: data.tags, the ids of the board's tags (meta.tags) in the order they were ticked
            'fields' => ['data.text' => ['text', 6000], 'style.fill' => ['color'], 'style.fontSize' => ['int', 8, 200],
                'data.tags' => ['tags', Limits::TAGS_PER_NOTE]],
        ],
        'frame' => [
            'layer' => 'back', 'container' => true, 'childOf' => [], 'rotatable' => false,
            'size' => [50, 100000], 'textPath' => 'data.title', 'bindable' => false, 'votable' => false, 'placement' => 'box',
            'required' => [],
            'fields' => ['data.title' => ['text', 200], 'style.fill' => ['color']],
        ],
        'shape' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => true,
            'size' => [10, 20000], 'textPath' => 'data.text', 'bindable' => true, 'votable' => true, 'placement' => 'box',
            'required' => [],
            'fields' => ['data.kind' => ['enum', self::SHAPE_KINDS], 'data.text' => ['text', 6000],
                'style.fill' => ['color'], 'style.fillOpacity' => ['int', 0, 100], 'style.stroke' => ['color'],
                'style.strokeWidth' => ['int', 0, 24], 'style.dash' => ['enum', self::DASHES], 'style.textColor' => ['color'],
                'style.fontSize' => ['int', 8, 200], 'style.align' => ['enum', self::ALIGNS], 'style.valign' => ['enum', self::VALIGNS],
                // job 203: the picture of an own shape (kind image)
                'data.img' => ['image', ShapeImage::MAX],
                // job 240: the tick "1:1" of "Arrange", the on/off list of style.header
                'style.square' => ['enum', self::HEADERS]],
        ],
        'text' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => true,
            'size' => [4, 50000], 'textPath' => 'data.text', 'bindable' => true, 'votable' => true, 'placement' => 'box',
            'required' => [],
            'fields' => ['data.text' => ['text', 6000], 'style.fontSize' => ['int', 8, 400], 'style.color' => ['color'],
                'style.align' => ['enum', self::ALIGNS]],
        ],
        'connector' => [
            'layer' => 'content', 'container' => false, 'childOf' => [], 'rotatable' => false,
            'size' => [0, 0], 'textPath' => 'data.label', 'bindable' => false, 'votable' => false, 'placement' => 'none',
            'required' => ['data.start', 'data.end'],
            'fields' => ['data.start' => ['endpoint'], 'data.end' => ['endpoint'], 'data.route' => ['enum', self::ROUTES],
                'data.label' => ['text', Limits::MAX_LABEL], 'style.stroke' => ['color'], 'style.strokeWidth' => ['int', 1, 24],
                'style.dash' => ['enum', self::DASHES], 'style.startCap' => ['enum', self::CAPS], 'style.endCap' => ['enum', self::CAPS]],
        ],
        // Job 173: data.cols, data.rows and data.cells carry no typed rule (a typed
        // leaf refuses every path below it); Tables::check judges their form on the
        // stored result under the lock (SyncService).
        'table' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => false,
            'size' => [20, 100000], 'textPath' => null, 'bindable' => true, 'votable' => false, 'placement' => 'box',
            'required' => ['data.cols', 'data.rows'],
            'fields' => ['style.stroke' => ['color'], 'style.textColor' => ['color'], 'style.headerFill' => ['color'],
                'style.header' => ['enum', self::HEADERS], 'style.headerCol' => ['enum', self::HEADERS]],
        ],
        // Job 188: a note pad, a pile of blank notes. The client takes notes off it
        // as ordinary sticky puts; the pad itself gets no reactions (Reactions:
        // notes only), no votes and no connector ends.
        'pad' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => false,
            'size' => [20, 2000], 'textPath' => 'data.title', 'bindable' => false, 'votable' => false, 'placement' => 'box',
            'required' => [],
            'fields' => ['data.title' => ['text', 200], 'style.fill' => ['color']],
        ],
        // Job 195: a mind map. data.nodes and data.texts carry no typed rule (a typed
        // leaf refuses every path below it); Mindmaps::check judges their form on
        // the stored result under the lock (SyncService). No votes, reactions,
        // tags or connector ends.
        'mindmap' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => false,
            'size' => [20, 100000], 'textPath' => null, 'bindable' => false, 'votable' => false, 'placement' => 'box',
            'required' => ['data.nodes'],
            'fields' => ['style.layout' => ['enum', self::MIND_LAYOUTS]],
        ],
        // Job 267: an AI summary card. data.md is the AI's Markdown, data.title the frame
        // the summary is about; no text path: nobody edits it (no editor, no text lease).
        'ai' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => false,
            'size' => [20, 20000], 'textPath' => null, 'bindable' => true, 'votable' => false, 'placement' => 'box',
            'required' => [],
            'fields' => ['data.md' => ['text', 12000], 'data.title' => ['text', 200]],
        ],
        // Job 273: a freehand stroke of the pen or the highlighter. data.points holds its
        // points (x0, y0, x1, y1, …) relative to the item's x/y; the box is their hull
        // plus half the stroke width. No text, votes, reactions or connector ends.
        'pen' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => false,
            'size' => [0, 100000], 'textPath' => null, 'bindable' => false, 'votable' => false, 'placement' => 'box',
            'required' => ['data.points'],
            'fields' => ['data.kind' => ['enum', self::PEN_KINDS], 'data.points' => ['points', self::POINTS_MAX],
                'style.stroke' => ['color'], 'style.strokeWidth' => ['int', 1, 64]],
        ],
    ];

    private const GENERIC = [
        'layer' => 'content', 'container' => false, 'childOf' => [], 'rotatable' => true,
        'size' => [0, 1000000], 'textPath' => null, 'bindable' => false, 'votable' => false, 'placement' => 'box',
        'required' => [], 'fields' => [],
    ];

    /** Is $t a type put may create? */
    public static function has(string $t): bool {
        return array_key_exists($t, self::TYPES);
    }

    /**
     * The rules of type $t (GENERIC for unknown types). Keys as in
     * registry-golden.json types.<t>: layer, container, childOf, rotatable,
     * size, textPath, bindable, votable, placement, required, fields.
     *
     * @return array{layer: string, container: bool, childOf: list<string>, rotatable: bool, size: array{0: int, 1: int}, textPath: ?string, bindable: bool, votable: bool, placement: string, required: list<string>, fields: array<string, array>}
     */
    public static function info(string $t): array {
        return self::TYPES[$t] ?? self::GENERIC;
    }

    public static function isContainer(string $t): bool {
        return self::info($t)['container'];
    }

    /** May a connector end point at an item of type $t (rule 14)? Never for unknown types. */
    public static function isBindable(string $t): bool {
        return self::info($t)['bindable'];
    }

    /** May an item of type $t get votes (stage 3)? Never for unknown types. */
    public static function isVotable(string $t): bool {
        return self::info($t)['votable'];
    }

    /** May an item of type $child live inside an item of type $parent? */
    public static function canBeChildOf(string $child, string $parent): bool {
        return self::isContainer($parent) && in_array($parent, self::info($child)['childOf'], true);
    }

    /**
     * May an item of type $t belong to a group (M2, SPEC-M1 §1.2 "(R20)
     * Gruppieren")? A registered type with placement box that is no
     * container: sticky, shape and text; never a frame, a connector or an
     * unknown stored type. The client counterpart is registry.js
     * isGroupable(t).
     */
    public static function isGroupable(string $t): bool {
        if (!self::has($t)) {
            return false;
        }
        $info = self::info($t);
        return $info['placement'] === 'box' && !$info['container'];
    }

    /** The text path the text lease guards (§4.11), or null. */
    public static function textPath(string $t): ?string {
        return self::info($t)['textPath'];
    }

    /** @return list<string> every text path of every known type, in registry order: data.text, data.title, data.label */
    public static function allTextPaths(): array {
        $out = [];
        foreach (self::TYPES as $info) {
            if ($info['textPath'] !== null && !in_array($info['textPath'], $out, true)) {
                $out[] = $info['textPath'];
            }
        }
        return $out;
    }

    /**
     * Do the required fields of $item's type (rule 19) all have a value?
     * Types without required fields (and unknown types) always pass.
     */
    public static function hasRequired(array $item): bool {
        foreach (self::info((string)($item['t'] ?? ''))['required'] as $path) {
            if (PathOps::getPath($item, $path) === null) {
                return false;
            }
        }
        return true;
    }

    /**
     * Typed check of a complete item for put (generic checks already done by
     * OpValidator). Returns the normalized item or null (`bad`).
     *
     * Placement none (connector, rule 12): x, y, w, h and r must be 0 and
     * parent null; they are stored as +0.0 (a -0.0 never reaches the row).
     * Required fields (rule 19) must be present after the generic cleaning
     * ("empty = absent", so {} counts as missing). A group (M2, R20
     * Gruppieren) other than null only for a groupable type (isGroupable).
     *
     * @param array{t: string, x: float, y: float, w: float, h: float, r: float, z: string, parent: ?string, data: array, style: array, group?: ?string} $item
     */
    public static function checkItem(array $item): ?array {
        if (!self::has($item['t'])) {
            return null;
        }
        if (($item['group'] ?? null) !== null && !self::isGroupable($item['t'])) {
            return null;
        }
        $info = self::info($item['t']);
        foreach (['w', 'h'] as $k) {
            if ($item[$k] < $info['size'][0] || $item[$k] > $info['size'][1]) {
                return null;
            }
        }
        if (!$info['rotatable'] && $item['r'] != 0) {
            return null;
        }
        if ($item['parent'] !== null && $info['childOf'] === []) {
            return null;
        }
        if ($info['placement'] === 'none') {
            foreach (['x', 'y', 'w', 'h', 'r'] as $k) {
                if ($item[$k] != 0) {
                    return null;
                }
                $item[$k] = 0.0;
            }
        }
        foreach ($info['fields'] as $path => $rule) {
            $v = PathOps::getPath($item, $path);
            if ($v === null) {
                continue;
            }
            [$ok, $norm] = self::checkField($rule, $v);
            if (!$ok) {
                return null;
            }
            $item = PathOps::setPath($item, $path, $norm);
        }
        if (!self::hasRequired($item)) {
            return null;
        }
        return self::fitsBytes($item) ? $item : null;
    }

    /**
     * Typed check of a (generically valid) patch against an item of type $t.
     * Returns the normalized patch or null (`bad`).
     *
     *  - w/h in size, r only if rotatable, parent only if the type may have one
     *  - placement none (rule 12): any of x, y, w, h, r, parent → bad
     *  - a typed field: checkField; null/{}/[] deletes it, except a required
     *    field (rule 19) → bad
     *  - a path below a typed field (data.text.x, data.start.item): a typed
     *    leaf never becomes a map → bad (rule 14: an end is ONE register)
     *  - group (M2, R20 Gruppieren): a group id only for a groupable type
     *    (isGroupable; a frame, a connector or an unknown stored type → bad),
     *    null on every type
     *
     * @param array<string, mixed> $patch
     * @return array<string, mixed>|null
     */
    public static function checkPatch(string $t, array $patch): ?array {
        $info = self::info($t);
        foreach ($patch as $path => $v) {
            $path = (string)$path;
            if ($path === 'group') {
                if ($v !== null && !self::isGroupable($t)) {
                    return null;
                }
                continue;
            }
            if ($info['placement'] === 'none' && in_array($path, self::BOX_FIELDS, true)) {
                return null;
            }
            if ($path === 'w' || $path === 'h') {
                if ($v < $info['size'][0] || $v > $info['size'][1]) {
                    return null;
                }
                continue;
            }
            if ($path === 'r') {
                if (!$info['rotatable'] && $v != 0) {
                    return null;
                }
                continue;
            }
            if ($path === 'parent') {
                if ($v !== null && $info['childOf'] === []) {
                    return null;
                }
                continue;
            }
            foreach ($info['fields'] as $field => $rule) {
                if ($path === $field) {
                    if ($v === null || $v === []) {
                        if (in_array($field, $info['required'], true)) {
                            return null;
                        }
                        continue;
                    }
                    [$ok, $norm] = self::checkField($rule, $v);
                    if (!$ok) {
                        return null;
                    }
                    $patch[$path] = $norm;
                } elseif (str_starts_with($path, $field . '.')) {
                    // A typed leaf is never a map: data.text.x would turn it into one.
                    return null;
                }
            }
        }
        return $patch;
    }

    /**
     * MAX_ITEM_BYTES: the stored JSON of data plus style (§4.8). obj() writes
     * no \uXXXX escapes, so 6000 × a 4-byte code point always fits.
     */
    public static function fitsBytes(array $item): bool {
        return self::bytes($item) <= Limits::MAX_ITEM_BYTES;
    }

    /**
     * strlen(obj(data)) + strlen(obj(style)): the stored size of an item, the
     * one formula behind MAX_ITEM_BYTES and the board byte budget.
     */
    public static function bytes(array $item): int {
        $data = is_array($item['data'] ?? null) ? $item['data'] : [];
        $style = is_array($item['style'] ?? null) ? $item['style'] : [];
        return strlen(ItemStore::obj($data)) + strlen(ItemStore::obj($style));
    }

    /**
     * The value rules of put (§4.7 rule 3) on the STORED result of patches:
     * at most MAX_KEYS keys at the root of data/style, every root value a
     * wire value counted from depth 0 (≤ 6 levels, ≤ 100 keys per object,
     * ≤ 1000 list elements). Patch paths add root keys one at a time and
     * nest up to 4 keys plus a 6-level value, so without this check a stored
     * item could be one that put (undo of delete: put + revive) refuses.
     *
     * @param list<string> $containers which of data/style to check
     */
    public static function fitsShape(array $item, array $containers = PathOps::CONTAINERS): bool {
        foreach ($containers as $root) {
            $m = $item[$root] ?? [];
            if (!is_array($m) || count($m) > PathOps::MAX_KEYS) {
                return false;
            }
            foreach ($m as $v) {
                if (!PathOps::isWireValue($v, 0)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * One typed field value (M0 signature; the rule is info(t)['fields'][path]).
     * Like the JS mirror checkField, empty values (null, {}, []) are invalid
     * here: callers apply "empty = absent" before (§6.2 (c)).
     *
     *  - enum: strictly a string of the list (is_string + in_array strict:
     *    a loose in_array would take true, SPEC-M1 §4.8 (R8))
     *  - endpoint: one of the three end forms, normalized
     *    (Connectors::endpoint: ax/ay checked as sent, then q(v, 10000);
     *    item a ULID; free ends as sent, never -0)
     *  - tags (job 191): a JSON list of 1–$rule[1] strings in ULID form, each
     *    once, kept in its order (whether an id names a tag of meta.tags is
     *    the client's business: ids of deleted tags stay until the note's
     *    tags are written again)
     *
     * @param array{0: string, 1?: mixed, 2?: int} $rule
     * @return array{0: bool, 1: mixed} [ok, normalized value]
     */
    public static function checkField(array $rule, mixed $v): array {
        switch ($rule[0]) {
            case 'text':
                $s = Input::text($v, $rule[1]);
                return $s === null ? [false, null] : [true, $s];
            case 'color':
                return is_string($v) && preg_match('/^#[0-9a-fA-F]{6}\z/', $v) === 1 ? [true, strtolower($v)] : [false, null];
            case 'int':
                if (is_float($v) && is_finite($v) && floor($v) === $v && abs($v) < 1e9) {
                    $v = (int)$v;
                }
                return is_int($v) && $v >= $rule[1] && $v <= $rule[2] ? [true, $v] : [false, null];
            case 'enum':
                return is_string($v) && in_array($v, $rule[1], true) ? [true, $v] : [false, null];
            case 'endpoint':
                $ep = Connectors::endpoint($v);
                return $ep === null ? [false, null] : [true, $ep];
            case 'tags':
                if (!is_array($v) || $v === [] || !array_is_list($v) || count($v) > $rule[1]) {
                    return [false, null];
                }
                $seen = [];
                foreach ($v as $id) {
                    if (!is_string($id) || preg_match(OpValidator::ULID_RE, $id) !== 1 || isset($seen[$id])) {
                        return [false, null];
                    }
                    $seen[$id] = true;
                }
                return [true, $v];
            case 'image':
                // job 203: pieces whose concatenation is a picture (ShapeImage)
                $uri = ShapeImage::join($v);
                return $uri !== null && strlen($uri) <= $rule[1] ? [true, $v] : [false, null];
            case 'points':
                // job 273: x0, y0, x1, y1, … of a pen stroke, stored as sent
                if (!is_array($v) || !array_is_list($v) || count($v) < 2 || count($v) > $rule[1] || count($v) % 2 !== 0) {
                    return [false, null];
                }
                foreach ($v as $n) {
                    if ((!is_int($n) && !is_float($n)) || !is_finite((float)$n) || abs((float)$n) > Limits::NUM_ABS_MAX) {
                        return [false, null];
                    }
                }
                return [true, $v];
            default:
                // bool, number: reserved, no checker yet → every value is refused.
                return [false, null];
        }
    }
}
