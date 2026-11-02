<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

/**
 * The picture of an own shape (factory job 203); src/model/shapeImage.js is
 * the client mirror (a node test reads these constants).
 *
 * A picture is a data URI data:image/<png|jpeg|gif|webp|svg+xml>;base64,…
 * of at most MAX characters, base64 with padding (length a multiple of 4).
 * An SVG decodes to a text with "<svg" and without a script or
 * foreignObject element (any prefix, any case): pictures are only ever drawn
 * as images, where neither runs, but a foreignObject would taint the canvas
 * of the PNG export on Safari.
 *
 * On the board (ItemRegistry rule `image`, a shape's data.img) a picture is
 * a list of 1–CHUNKS strings of 1–CHUNK characters, so the generic string
 * limit of the sync (Limits::MAX_STRING) stays; a library entry
 * (ShapeLibStore) carries it as one string.
 */
final class ShapeImage {
    /** Characters of a picture's data URI (48 KiB). */
    public const MAX = 49152;
    /** Characters of one piece of data.img (Limits::MAX_STRING). */
    public const CHUNK = 6000;
    /** Pieces of data.img: ceil(MAX / CHUNK). */
    public const CHUNKS = 9;

    private const URI_RE = '/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+\/]+={0,2})\z/';
    /**
     * SECURITY (factory job 251): a block list, safe only because the client
     * draws pictures exclusively as images (Image.src, <img>, <image> in the
     * SVG export), where an SVG runs no script (guard:
     * tests/js/shell/svgOnlyAsImage.test.mjs). Whoever serves an SVG inline,
     * as a document or as a download to open needs an allow list instead.
     */
    private const SVG_BAD_RE ='/<([A-Za-z_][\w.-]*:)?(script|foreignobject)\b/i';

    /** A picture by the rule of the class comment. */
    public static function isUri(mixed $uri): bool {
        if (!is_string($uri) || strlen($uri) > self::MAX || preg_match(self::URI_RE, $uri, $m) !== 1) {
            return false;
        }
        if (strlen($m[2]) % 4 !== 0) {
            return false;
        }
        if ($m[1] !== 'svg+xml') {
            return true;
        }
        $text = base64_decode($m[2], true);
        return is_string($text) && stripos($text, '<svg') !== false && preg_match(self::SVG_BAD_RE, $text) !== 1;
    }

    /**
     * @return string|null the picture of a valid piece list (data.img), else null
     */
    public static function join(mixed $v): ?string {
        if (!is_array($v) || $v === [] || !array_is_list($v) || count($v) > self::CHUNKS) {
            return null;
        }
        foreach ($v as $s) {
            if (!is_string($s) || $s === '' || strlen($s) > self::CHUNK) {
                return null;
            }
        }
        $uri = implode('', $v);
        return self::isUri($uri) ? $uri : null;
    }
}
