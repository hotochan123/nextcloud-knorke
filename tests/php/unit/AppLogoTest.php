<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Teams\BoardTeamResourceProvider;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Logo L7 of design round 5 (factory job 283): an upright note with a dog ear
 * in front of a second note tilted by −14°, one shape on a 20 × 20 grid. The
 * source is docs/redesign/runde5/L7/app.svg; every one-colour icon of the app
 * (img/app.svg, app-dark.svg, app-neutral.svg, board-card.svg and the team
 * icon) carries its path data, img/app-color.svg its parts in three colours.
 * The raster cases render the icons with the Imagick of the container (the
 * one Nextcloud's theming uses) at 16, 20 and 32 px and look at points of
 * the geometry (runde5.md "Empfehlung"): both notes cover their pixel, and
 * at 32 px the gap between the dog ear and the front note stays open.
 */
final class AppLogoTest extends TestCase {
    private const SOURCE = 'docs/redesign/runde5/L7/app.svg';
    private const ICONS = ['img/app.svg', 'img/app-dark.svg', 'img/app-neutral.svg', 'img/board-card.svg'];
    private const COLOUR = 'img/app-color.svg';
    /** Points in grid units: inside the back note only, inside the front note, in the gap of the dog ear. */
    private const BACK = [3.5, 8.0];
    private const FRONT = [10.0, 10.0];
    private const GAP = [13.9, 13.9];

    private static function root(): string {
        return dirname(__DIR__, 3);
    }

    private static function read(string $rel): string {
        return (string)file_get_contents(self::root() . '/' . $rel);
    }

    /** @return list<string> the d of every path, in document order */
    private static function paths(string $svg): array {
        preg_match_all('/\sd="([^"]+)"/', $svg, $m);
        return $m[1];
    }

    /** @return list<string> the subpaths of a path data, each starting with M */
    private static function subpaths(string $d): array {
        preg_match_all('/M[^M]+/', $d, $m);
        return array_map('trim', $m[0]);
    }

    public function testEveryIconCarriesTheGlyphOfL7(): void {
        $l7 = self::paths(self::read(self::SOURCE));
        $this->assertCount(1, $l7, 'L7: one path (one shape, nonzero)');
        $this->assertCount(4, self::subpaths($l7[0]), 'L7: back note in two parts, front note, dog ear');
        foreach (self::ICONS as $rel) {
            $this->assertSame($l7, self::paths(self::read($rel)), "$rel: the path data of L7");
        }
        $this->assertSame($l7, self::paths(BoardTeamResourceProvider::ICON_SVG), 'team icon: the path data of L7');
        $this->assertStringNotContainsString('M4 2h12', self::read('img/app.svg'), 'the old note is gone');
    }

    public function testTheColourVersion(): void {
        $content = self::read(self::COLOUR);
        $this->assertStringStartsWith('<?xml version="1.0" encoding="UTF-8"?>' . "\n", $content, 'the XML declaration first (trap 48)');
        $this->assertSame('image/svg+xml', mime_content_type(self::root() . '/' . self::COLOUR));
        $this->assertStringContainsString('SPDX-License-Identifier: AGPL-3.0-or-later', $content);
        $doc = new \DOMDocument();
        $this->assertTrue($doc->loadXML($content, LIBXML_NONET));
        $this->assertSame('0 0 20 20', $doc->documentElement->getAttribute('viewBox'));
        $fills = [];
        $parts = [];
        foreach ($doc->getElementsByTagNameNS('http://www.w3.org/2000/svg', 'path') as $p) {
            $fills[] = $p->getAttribute('fill');
            $parts[] = self::subpaths($p->getAttribute('d'));
        }
        $this->assertSame(['#e8ce49', '#6bbef2', '#0275a9'], $fills, 'back note yellow, front note light blue, dog ear strong blue');
        $l7 = self::subpaths(self::paths(self::read(self::SOURCE))[0]);
        $this->assertSame([[$l7[0], $l7[1]], [$l7[2]], [$l7[3]]], $parts, 'the parts of L7, unchanged');
    }

    /** @return array<string, array{string, string, int}> file, background, size */
    public static function rasters(): array {
        $cases = [];
        foreach ([16, 20, 32] as $px) {
            $cases["app.svg on #00679e, $px px"] = ['img/app.svg', '#00679e', $px];
            $cases["app-dark.svg on white, $px px"] = ['img/app-dark.svg', '#ffffff', $px];
            $cases["app-color.svg on white, $px px"] = [self::COLOUR, '#ffffff', $px];
        }
        return $cases;
    }

    #[DataProvider('rasters')]
    public function testBothNotesShowAtSmallSizes(string $rel, string $background, int $px): void {
        $this->assertTrue(extension_loaded('imagick'), 'the imagick extension is loaded');
        $img = new \Imagick();
        $img->setBackgroundColor(new \ImagickPixel('transparent'));
        // The viewBox stays 20 × 20; the drawn size is the one asked for.
        $svg = str_replace('width="20" height="20"', "width=\"$px\" height=\"$px\"", self::read($rel), $n);
        $this->assertSame(1, $n, "$rel: one 20 × 20 root");
        $img->readImageBlob($svg);
        $img->setImageFormat('png');
        $this->assertSame([$px, $px], [$img->getImageWidth(), $img->getImageHeight()], "$rel at $px px");
        $alpha = static function (array $pt) use ($img, $px): float {
            $c = $img->getImagePixelColor((int)floor($pt[0] * $px / 20), (int)floor($pt[1] * $px / 20))->getColor(2);
            return $c['a'] / 255;
        };
        $this->assertGreaterThan(0.8, $alpha(self::BACK), "$rel at $px px: the back note covers its pixel");
        $this->assertGreaterThan(0.8, $alpha(self::FRONT), "$rel at $px px: the front note covers its pixel");
        if ($px === 32) {
            $this->assertLessThan(0.2, $alpha(self::GAP), "$rel at 32 px: the gap of the dog ear stays open");
        }
        // On its background: the note differs clearly from it (white on the primary colour, black on white).
        $flat = new \Imagick();
        $flat->newImage($px, $px, new \ImagickPixel($background));
        $flat->compositeImage($img, \Imagick::COMPOSITE_OVER, 0, 0);
        $front = $flat->getImagePixelColor((int)floor(self::FRONT[0] * $px / 20), (int)floor(self::FRONT[1] * $px / 20))->getColor(0);
        $bg = (new \ImagickPixel($background))->getColor(0);
        $distance = abs($front['r'] - $bg['r']) + abs($front['g'] - $bg['g']) + abs($front['b'] - $bg['b']);
        $this->assertGreaterThan(150, $distance, "$rel at $px px: the front note stands out from $background");
        $flat->destroy();
        $img->destroy();
    }
}
