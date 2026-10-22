<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Theming\IconBuilder;
use OCA\Theming\ImageManager;
use OCA\Theming\ThemingDefaults;
use OCA\Theming\Util;
use OCP\App\IAppManager;
use OCP\Files\IAppData;
use OCP\IConfig;
use OCP\ServerVersion;
use PHPUnit\Framework\TestCase;

/**
 * App icon in Nextcloud's theming (job 033): /apps/theming/icon/knorke (touch
 * icon, PNG 512 × 512) and /apps/theming/favicon/knorke (ICO) are rendered by
 * the theming app's IconBuilder from img/app.svg. renderAppIcon treats the
 * file as SVG only if mime_content_type() says image/svg+xml or the content
 * starts with "<svg" or "<?xml"; a file that starts with the SPDX comment is
 * text/plain for libmagic, Imagick reads it without a format hint and fails,
 * and the controller answers 404. So every file in ICONS starts with the XML
 * declaration: img/app.svg, which theming reads, and img/app-dark.svg
 * (notifications, admin section) and img/app-neutral.svg (search hits,
 * job 035), which theming does not read but which follow the same rule
 * (docs/ENTWICKLUNG.md §9, trap 48).
 *
 * Drives the real OCA\Theming\IconBuilder and Util of the Nextcloud sources
 * in the container (NC 34 and 35) with the repo's files. Mocked are the app
 * manager (path of knorke = the repo), the theming defaults (primary colour)
 * and the image manager (canConvert), plus IConfig and IAppData, which Util's
 * constructor needs; these two get no behaviour. These are Nextcloud
 * internals, not public API: when a later version changes a constructor this
 * test fails loudly and gets adapted — the icon stays as it is.
 */
final class ThemingIconTest extends TestCase {
    private const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
    private const PRIMARY = '#00679e';
    private const ICONS = ['img/app.svg', 'img/app-dark.svg', 'img/app-neutral.svg'];

    private static function root(): string {
        return dirname(__DIR__, 3);
    }

    protected function setUp(): void {
        // Without Imagick and its SVG delegate the rendering cases would
        // measure nothing: red, never skipped.
        $this->assertTrue(extension_loaded('imagick'), 'the imagick extension is loaded');
        foreach (['SVG', 'PNG', 'ICO'] as $format) {
            $this->assertNotEmpty(\Imagick::queryFormats($format), "Imagick knows $format");
        }
    }

    private function util(): Util {
        $appManager = $this->createMock(IAppManager::class);
        $appManager->method('cleanAppId')->willReturnArgument(0);
        $appManager->method('getAppPath')->willReturnCallback(static function (string $app): string {
            self::assertSame('knorke', $app);
            return self::root();
        });
        return new Util(
            new ServerVersion(),
            $this->createMock(IConfig::class),
            $appManager,
            $this->createMock(IAppData::class),
            $this->imageManager(),
        );
    }

    private function imageManager(): ImageManager {
        $imageManager = $this->createMock(ImageManager::class);
        $imageManager->method('canConvert')->willReturn(true);
        return $imageManager;
    }

    private function builder(string $primary): IconBuilder {
        $defaults = $this->createMock(ThemingDefaults::class);
        $defaults->method('getColorPrimary')->willReturn($primary);
        return new IconBuilder($defaults, $this->util(), $this->imageManager());
    }

    /** PNG signature and width/height from the IHDR chunk. */
    private function assertPng512(mixed $png, string $what): void {
        $this->assertIsString($png, "$what is an image blob");
        $this->assertSame("\x89PNG\r\n\x1a\n", substr($png, 0, 8), "$what: PNG signature");
        $this->assertSame(512, unpack('N', substr($png, 16, 4))[1], "$what: width");
        $this->assertSame(512, unpack('N', substr($png, 20, 4))[1], "$what: height");
    }

    public function testIconFilesAreRecognisedAsSvg(): void {
        foreach (self::ICONS as $rel) {
            $file = self::root() . '/' . $rel;
            $content = (string)file_get_contents($file);
            $this->assertStringStartsWith(self::XML_DECL . "\n", $content, "$rel: the XML declaration is the first line (no BOM, no blank before it)");
            $this->assertSame('image/svg+xml', mime_content_type($file), "$rel: MIME type");
            $xml = simplexml_load_string($content);
            $this->assertInstanceOf(\SimpleXMLElement::class, $xml, "$rel is well-formed XML");
            $this->assertSame('svg', $xml->getName(), "$rel: root element");
            $this->assertStringContainsString('SPDX-FileCopyrightText: 2026 hotochan123', $content, "$rel keeps its SPDX header");
            $this->assertStringContainsString('SPDX-License-Identifier: AGPL-3.0-or-later', $content, "$rel keeps its SPDX header");
        }
    }

    public function testThemingTakesTheRepoIcon(): void {
        // Not the Nextcloud logo fallback of Util::getAppIcon.
        $icon = $this->util()->getAppIcon('knorke', true);
        $this->assertIsString($icon);
        $this->assertSame(realpath(self::root() . '/img/app.svg'), realpath($icon));
    }

    public function testTouchIconOnTheDefaultPrimaryColour(): void {
        $png = $this->builder(self::PRIMARY)->getTouchIcon('knorke');
        $this->assertPng512($png, 'getTouchIcon(knorke) at ' . self::PRIMARY);
        $img = new \Imagick();
        $img->readImageBlob($png);
        $pixel = static fn (int $x, int $y): array => $img->getImagePixelColor($x, $y)->getColor(2);
        $this->assertSame(['r' => 255, 'g' => 255, 'b' => 255, 'a' => 255], $pixel(256, 256), 'centre: the white note');
        $this->assertSame(['r' => 0, 'g' => 103, 'b' => 158, 'a' => 255], $pixel(60, 256), 'left of the note: the primary colour');
        $this->assertSame(0, $pixel(5, 5)['a'], 'rounded corner: transparent');
        $img->destroy();
    }

    public function testTouchIconOnABrightPrimaryColour(): void {
        // Nextcloud inverts the icon on bright colours (its behaviour, not
        // checked by pixel): it must still be rendered.
        $this->assertPng512($this->builder('#ffffff')->getTouchIcon('knorke'), 'getTouchIcon(knorke) at #ffffff');
    }

    public function testFavicon(): void {
        $ico = $this->builder(self::PRIMARY)->getFavicon('knorke');
        $this->assertIsString($ico, 'getFavicon(knorke) is an image blob');
        $this->assertNotSame('', $ico);
        $this->assertSame("\x00\x00\x01\x00", substr($ico, 0, 4), 'ICO header');
        $this->assertGreaterThanOrEqual(1, unpack('v', substr($ico, 4, 2))[1], 'number of images');
    }
}
