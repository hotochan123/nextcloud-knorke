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
 * Connectors::endpoint). Reserved for later and not used in M1: points,
 * bool, number — a rule without a checker refuses every value. `size` bounds
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
    private const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight'];
    private const DASHES = ['solid', 'dashed', 'dotted'];
    private const ALIGNS = ['left', 'center', 'right'];
    private const VALIGNS = ['top', 'middle', 'bottom'];
    private const ROUTES = ['straight', 'elbow', 'curved'];
    private const CAPS = ['none', 'arrow', 'triangle', 'dot', 'diamond'];

    /** The root fields a type with placement none never has (rule 12). */
    private const BOX_FIELDS = ['x', 'y', 'w', 'h', 'r', 'parent'];

    private const TYPES = [
        'sticky' => [
            'layer' => 'content', 'container' => false, 'childOf' => ['frame'], 'rotatable' => true,
            'size' => [20, 2000], 'textPath' => 'data.text', 'bindable' => true, 'votable' => true, 'placement' => 'box',
            'required' => [],
            'fields' => ['data.text' => ['text', 6000], 'style.fill' => ['color'], 'style.fontSize' => ['int', 8, 200]],
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
                'style.fontSize' => ['int', 8, 200], 'style.align' => ['enum', self::ALIGNS], 'style.valign' => ['enum', self::VALIGNS]],
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
            default:
                // points, bool, number: reserved, no checker yet → every value is refused.
                return [false, null];
        }
    }
}
