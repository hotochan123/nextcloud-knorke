<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Reference\BoardReferenceProvider;
use PHPUnit\Framework\TestCase;

/**
 * img/board-card.svg, the picture of a board's link preview
 * (BoardReferenceProvider::IMAGE, job 157), after the pattern of
 * NeutralIconTest: the glyph of img/app-dark.svg in the mid grey of
 * img/app-neutral.svg (#808080, whose contrast NeutralIconTest measures),
 * one colour, centred in a picture of 2 : 1. Nextcloud's default card shows
 * it without a filter at 40 % of the card's width; a square picture would
 * make the card about as high as that.
 */
final class BoardCardImageTest extends TestCase {
    private const IMAGE = 'img/board-card.svg';
    private const GLYPH = 'img/app-dark.svg';
    private const FILL = '#808080';
    /** The glyph's box in app-dark.svg's 20 × 20 coordinates: 2 … 18 on both axes. */
    private const GLYPH_CENTRE = [10.0, 10.0];

    private static function root(): string {
        return dirname(__DIR__, 3);
    }

    private static function load(string $rel): \DOMDocument {
        $doc = new \DOMDocument();
        self::assertTrue($doc->loadXML((string)file_get_contents(self::root() . '/' . $rel), LIBXML_NONET), "$rel is well-formed XML");
        return $doc;
    }

    /** @return list<string> the d of every path, in document order */
    private static function pathData(\DOMDocument $doc): array {
        $d = [];
        foreach ($doc->getElementsByTagNameNS('http://www.w3.org/2000/svg', 'path') as $p) {
            $d[] = $p->getAttribute('d');
        }
        return $d;
    }

    /** @return array{float, float, float, float} min-x, min-y, width, height */
    private static function viewBox(): array {
        $vb = self::load(self::IMAGE)->documentElement->getAttribute('viewBox');
        self::assertMatchesRegularExpression('/^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/D', $vb, 'viewBox: four numbers');
        return array_map('floatval', explode(' ', $vb));
    }

    public function testTheProviderNamesTheFile(): void {
        $this->assertSame('board-card.svg', BoardReferenceProvider::IMAGE);
        $file = self::root() . '/' . self::IMAGE;
        $content = (string)file_get_contents($file);
        $this->assertStringStartsWith('<?xml version="1.0" encoding="UTF-8"?>' . "\n", $content, 'the XML declaration first, as the other icons (trap 48)');
        $this->assertSame('image/svg+xml', mime_content_type($file));
        $this->assertStringContainsString('SPDX-License-Identifier: AGPL-3.0-or-later', $content);
    }

    public function testSameGlyphAsTheDarkIcon(): void {
        $doc = self::load(self::IMAGE);
        $root = $doc->documentElement;
        $this->assertSame('svg', $root->localName);
        $this->assertSame('http://www.w3.org/2000/svg', $root->namespaceURI);
        $attrs = [];
        foreach ($root->attributes as $a) {
            $attrs[] = $a->name;
        }
        sort($attrs);
        $this->assertSame(['fill', 'height', 'viewBox', 'width'], $attrs, 'the root carries size, viewBox and fill only');

        $glyph = self::pathData(self::load(self::GLYPH));
        $this->assertNotEmpty($glyph, self::GLYPH . ': at least one path');
        $this->assertSame($glyph, self::pathData($doc), 'the d of every path as in ' . self::GLYPH . ', same order');
        foreach ($doc->getElementsByTagName('*') as $el) {
            $this->assertContains($el->localName, ['svg', 'path'], 'no element besides svg and path (no transform, no group)');
            if ($el->localName === 'path') {
                $names = [];
                foreach ($el->attributes as $a) {
                    $names[] = $a->name;
                }
                $this->assertSame(['d'], $names, 'a path carries d only');
            }
        }
    }

    public function testOneColourOnly(): void {
        $this->assertSame(self::FILL, self::load(self::IMAGE)->documentElement->getAttribute('fill'));
        $content = (string)file_get_contents(self::root() . '/' . self::IMAGE);
        $this->assertSame(1, preg_match_all('/#[0-9a-fA-F]{3,8}\b/', $content, $m), 'exactly one colour value in the file');
        $this->assertSame([self::FILL], $m[0]);
        $this->assertSame(self::FILL, self::load('img/app-neutral.svg')->documentElement->getAttribute('fill'), 'the grey of the search icon');
        foreach (self::load(self::IMAGE)->getElementsByTagName('*') as $el) {
            foreach (['stroke', 'style', 'class', 'opacity', 'fill-opacity', 'filter', 'transform'] as $attr) {
                $this->assertFalse($el->hasAttribute($attr), "<{$el->localName}> has no $attr");
            }
        }
    }

    public function testTwoToOneWithTheGlyphInTheMiddle(): void {
        [$x, $y, $w, $h] = self::viewBox();
        $this->assertGreaterThan(0, $h);
        $this->assertEqualsWithDelta(2.0, $w / $h, 1e-9, 'viewBox width : height = 2 : 1');
        $root = self::load(self::IMAGE)->documentElement;
        $this->assertEqualsWithDelta(2.0, (float)$root->getAttribute('width') / (float)$root->getAttribute('height'), 1e-9, 'width : height = 2 : 1');
        $this->assertSame([$w, $h], [(float)$root->getAttribute('width'), (float)$root->getAttribute('height')], 'one user unit per pixel');
        $this->assertSame(self::GLYPH_CENTRE, [$x + $w / 2, $y + $h / 2], 'the centre of the picture is the centre of the glyph');
        $this->assertGreaterThan(16.0, $h, 'room above and below the 16 units high glyph');
    }
}
