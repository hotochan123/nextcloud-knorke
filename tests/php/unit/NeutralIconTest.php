<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * img/app-neutral.svg, the icon of a hit in Nextcloud's unified search
 * (BoardSearchProvider::ICON, job 035): the glyph of img/app-dark.svg in a
 * mid grey. NC 34 shows the icon URL as a background-image without any
 * filter, NC 35 as an <img> with filter: var(--background-invert-if-dark);
 * the grey has to stay at 3 : 1 or more in both themes on both versions,
 * as drawn and as inverted.
 *
 * Contrast after WCAG 2.x (relative luminance of sRGB). The colour is read
 * from the file, the backgrounds are those of NC 34.0.1 and 35.0.1 (equal in
 * both): apps/theming/lib/Themes/DefaultTheme.php and DarkTheme.php,
 * $colorMainBackground, and --color-background-hover = darken / lighten by 4
 * (Mexitek\PHPColors). When a later version changes them, update the
 * constants below.
 */
final class NeutralIconTest extends TestCase {
    private const ICON = 'img/app-neutral.svg';
    private const GLYPH = 'img/app-dark.svg';
    private const FILL = '#808080';
    private const MIN = 3.0;

    /** DefaultTheme.php: $colorMainBackground (NC 34.0.1, 35.0.1). */
    private const LIGHT = '#ffffff';
    /** DefaultTheme.php: --color-background-hover = darken('#ffffff', 4). */
    private const LIGHT_HOVER = '#f5f5f5';
    /** DarkTheme.php: $colorMainBackground (NC 34.0.1, 35.0.1). */
    private const DARK = '#171717';
    /** DarkTheme.php: --color-background-hover = lighten('#171717', 4). */
    private const DARK_HOVER = '#212121';

    private static function root(): string {
        return dirname(__DIR__, 3);
    }

    private static function load(string $rel): \DOMDocument {
        $doc = new \DOMDocument();
        self::assertTrue($doc->loadXML((string)file_get_contents(self::root() . '/' . $rel), LIBXML_NONET), "$rel is well-formed XML");
        return $doc;
    }

    /** @return list<\DOMElement> every element of the document, root first */
    private static function elements(\DOMDocument $doc): array {
        $all = [];
        foreach ($doc->getElementsByTagName('*') as $el) {
            $all[] = $el;
        }
        return $all;
    }

    /** @return list<string> the d of every path, in document order */
    private static function pathData(\DOMDocument $doc): array {
        $d = [];
        foreach ($doc->getElementsByTagNameNS('http://www.w3.org/2000/svg', 'path') as $p) {
            $d[] = $p->getAttribute('d');
        }
        return $d;
    }

    /** @return array{int, int, int} r, g, b of #rgb or #rrggbb */
    private static function rgb(string $hex): array {
        self::assertMatchesRegularExpression('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/D', $hex, "$hex is a #rgb or #rrggbb colour");
        $h = substr($hex, 1);
        if (strlen($h) === 3) {
            $h = $h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2];
        }
        return [hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2))];
    }

    /** WCAG 2.x relative luminance. */
    private static function luminance(string $hex): float {
        $lin = static function (int $c): float {
            $s = $c / 255;
            return $s <= 0.03928 ? $s / 12.92 : (($s + 0.055) / 1.055) ** 2.4;
        };
        [$r, $g, $b] = self::rgb($hex);
        return 0.2126 * $lin($r) + 0.7152 * $lin($g) + 0.0722 * $lin($b);
    }

    /** WCAG 2.x contrast ratio, 1 … 21, symmetric. */
    private static function contrast(string $a, string $b): float {
        $la = self::luminance($a);
        $lb = self::luminance($b);
        return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
    }

    /** What filter: invert(100%) makes of a colour: 255 − channel. */
    private static function invert(string $hex): string {
        [$r, $g, $b] = self::rgb($hex);
        return sprintf('#%02x%02x%02x', 255 - $r, 255 - $g, 255 - $b);
    }

    /** The fill of the icon's root element, as the file has it. */
    private static function fileColour(): string {
        return self::load(self::ICON)->documentElement->getAttribute('fill');
    }

    public function testSameGlyphAsTheDarkIcon(): void {
        $doc = self::load(self::ICON);
        $root = $doc->documentElement;
        $this->assertSame('svg', $root->localName, 'root element');
        $this->assertSame('http://www.w3.org/2000/svg', $root->namespaceURI, 'SVG namespace');
        $this->assertSame('0 0 20 20', $root->getAttribute('viewBox'));
        $this->assertSame('20', $root->getAttribute('width'));
        $this->assertSame('20', $root->getAttribute('height'));
        $attrs = [];
        foreach ($root->attributes as $a) {
            $attrs[] = $a->name;
        }
        sort($attrs);
        $this->assertSame(['fill', 'height', 'viewBox', 'width'], $attrs, 'the root carries size, viewBox and fill only');

        $glyph = self::pathData(self::load(self::GLYPH));
        $this->assertCount(2, $glyph, self::GLYPH . ': two paths');
        $this->assertSame($glyph, self::pathData($doc), 'the d of every path as in ' . self::GLYPH . ', same order');

        foreach (self::elements($doc) as $el) {
            $this->assertContains($el->localName, ['svg', 'path'], 'no element besides svg and path');
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
        $this->assertSame(self::FILL, self::fileColour(), 'the fill of the root');
        $content = (string)file_get_contents(self::root() . '/' . self::ICON);
        $this->assertSame(1, preg_match_all('/#[0-9a-fA-F]{3,8}\b/', $content, $m), 'exactly one colour value in the file');
        $this->assertSame([self::FILL], $m[0]);
        foreach (self::elements(self::load(self::ICON)) as $el) {
            foreach (['stroke', 'style', 'class', 'opacity', 'fill-opacity', 'stroke-opacity', 'filter'] as $attr) {
                $this->assertFalse($el->hasAttribute($attr), "<{$el->localName}> has no $attr");
            }
        }
    }

    /** @return array<string, array{bool, string, string}> inverted?, background, background name */
    public static function cases(): array {
        return [
            'NC 34/35 light' => [false, self::LIGHT, 'color-main-background'],
            'NC 34/35 light, hover' => [false, self::LIGHT_HOVER, 'color-background-hover'],
            'NC 34 dark (no filter)' => [false, self::DARK, 'color-main-background'],
            'NC 34 dark (no filter), hover' => [false, self::DARK_HOVER, 'color-background-hover'],
            'NC 35 dark (invert 100%)' => [true, self::DARK, 'color-main-background'],
            'NC 35 dark (invert 100%), hover' => [true, self::DARK_HOVER, 'color-background-hover'],
        ];
    }

    #[DataProvider('cases')]
    public function testContrastOfTheIcon(bool $inverted, string $background, string $what): void {
        $colour = self::fileColour();
        $shown = $inverted ? self::invert($colour) : $colour;
        $ratio = self::contrast($shown, $background);
        $this->assertGreaterThanOrEqual(self::MIN, $ratio, sprintf('%s on %s (%s): %.2f : 1', $shown, $background, $what, $ratio));
    }

    public function testTheMeasureSeparatesOldFromNew(): void {
        // Anchors of the formula: black on white is 21 : 1, the order of the
        // colours does not matter, and the inverted grey is #7f7f7f.
        $this->assertEqualsWithDelta(21.0, self::contrast('#000000', '#ffffff'), 1e-9);
        $this->assertEqualsWithDelta(self::contrast('#ffffff', '#808080'), self::contrast('#808080', '#ffffff'), 1e-12);
        $this->assertSame('#7f7f7f', self::invert('#808080'));
        $this->assertSame('#ffffff', self::invert('#000'));
        // The old icon (app-dark.svg, #000) on NC 34's dark background fails
        // the bar the new one passes.
        $this->assertLessThan(self::MIN, self::contrast('#000000', self::DARK), 'black on ' . self::DARK);
        $this->assertLessThan(self::MIN, self::contrast('#000000', self::DARK_HOVER), 'black on ' . self::DARK_HOVER);
        // The values of the spec's table (behaviour 4), to two decimals.
        foreach ([
            ['#808080', self::LIGHT, 3.95], ['#808080', self::LIGHT_HOVER, 3.62],
            ['#808080', self::DARK, 4.54], ['#808080', self::DARK_HOVER, 4.08],
            ['#7f7f7f', self::DARK, 4.48], ['#7f7f7f', self::DARK_HOVER, 4.02],
            ['#000000', self::DARK, 1.17], ['#000000', self::DARK_HOVER, 1.30],
        ] as [$fg, $bg, $expected]) {
            $this->assertEqualsWithDelta($expected, round(self::contrast($fg, $bg), 2), 1e-9, "$fg on $bg");
        }
    }
}
