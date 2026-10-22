<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Http\GuestPageResponse;
use OCP\AppFramework\Http\TemplateResponse;
use PHPUnit\Framework\TestCase;

/**
 * The guest page links no web app manifest (job 131): the removal rule of
 * GuestPageResponse::withoutManifest(), and the same rule against the real
 * core/templates/layout.public.php of the Nextcloud image (NC 34 and 35).
 */
final class GuestPageResponseTest extends TestCase {
    private const NC_TAG = '<link rel="manifest" href="/apps/theming/manifest/knorke?v=0a1b2c3d" crossorigin="use-credentials">';

    private static function head(string $links): string {
        return "<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset=\"utf-8\">\n" . $links . "\n\t<script nonce=\"x\" src=\"/a.js\"></script>\n</head>\n<body></body>\n</html>\n";
    }

    /** NC's root, determined as in tests/php/bootstrap.php (one level deeper). */
    private static function ncRoot(): string {
        return getenv('NEXTCLOUD_ROOT') ?: dirname(__DIR__, 5);
    }

    /** A core layout template with every <?php … ?> block replaced by an example URL. */
    private static function layout(string $name): string {
        $file = self::ncRoot() . '/core/templates/' . $name;
        self::assertFileExists($file, "the server ships core/templates/$name");
        $html = preg_replace('/<\?php.*?\?>/s', '/apps/theming/manifest/knorke?v=0a1b2c3d', (string)file_get_contents($file));
        self::assertIsString($html);
        self::assertStringNotContainsString('<?', $html, 'every PHP block replaced');
        return $html;
    }

    public function testIsATemplateResponse(): void {
        $r = new GuestPageResponse('knorke', 'guest', [], TemplateResponse::RENDER_AS_PUBLIC);
        $this->assertInstanceOf(TemplateResponse::class, $r, 'CompressionMiddleware gzips only TemplateResponse (and JSON/OCS)');
        $this->assertSame(['guest', TemplateResponse::RENDER_AS_PUBLIC], [$r->getTemplateName(), $r->getRenderAs()]);
    }

    /** AK1 (a): Nextcloud's form of the tag. */
    public function testRemovesNextcloudsManifestLink(): void {
        $html = self::head("\t<link rel=\"apple-touch-icon\" href=\"/t.png\">\n\t" . self::NC_TAG . "\n\t<link rel=\"icon\" href=\"/f.ico\">");
        $this->assertSame(str_replace(self::NC_TAG, '', $html), GuestPageResponse::withoutManifest($html));
        $this->assertStringContainsString("\n\t\n\t<link rel=\"icon\"", GuestPageResponse::withoutManifest($html), 'only the tag, white space around it stays');
    }

    /** AK1 (b): either quote, self-closing, any case, rel not first. */
    public function testRemovesOtherSpellings(): void {
        foreach (["<link href=\"/x\" rel='manifest' />", '<LINK REL="Manifest" href="/x">', "<link\n\thref=\"/x\"\n\trel = \"manifest\">"] as $tag) {
            $html = self::head("\t<link rel=\"icon\" href=\"/f.ico\">\n\t$tag");
            $this->assertSame(str_replace($tag, '', $html), GuestPageResponse::withoutManifest($html), $tag);
        }
    }

    /** AK1 (c): every match in the document. */
    public function testRemovesEveryMatch(): void {
        $html = self::head("\t" . self::NC_TAG . "\n\t<link rel=\"icon\" href=\"/f.ico\">\n\t<link rel='manifest' href='/y'>");
        $want = str_replace([self::NC_TAG, "<link rel='manifest' href='/y'>"], '', $html);
        $this->assertSame($want, GuestPageResponse::withoutManifest($html));
        $this->assertStringNotContainsStringIgnoringCase('manifest', GuestPageResponse::withoutManifest($html));
    }

    /** AK1 (d) and (e): look-alikes stay byte for byte, no match → the identical string. */
    public function testLeavesEverythingElse(): void {
        $links = implode("\n\t", [
            '<link rel="manifestx" href="/a">',
            '<link data-rel="manifest" href="/b">',
            '<link rel="icon" href="/f.ico">',
            '<link rel="apple-touch-icon" href="/t.png">',
            '<link rel="apple-touch-icon-precomposed" href="/t.png">',
            '<link rel="manifest-x" href="/c">',
            '<link rel="xmanifest" href="/d">',
            '<meta name="manifest" content="manifest">',
            '<meta rel="manifest">',
            '<a rel="manifest" href="/g">g</a>',
            '<p>rel="manifest"</p>',
        ]);
        $html = self::head("\t" . $links);
        $this->assertSame($html, GuestPageResponse::withoutManifest($html));
        foreach (['', 'plain text', self::head('')] as $other) {
            $this->assertSame($other, GuestPageResponse::withoutManifest($other));
        }
    }

    /** A PCRE error leaves the page as it is (fails open, no exception). */
    public function testPcreErrorReturnsTheInput(): void {
        $html = '<link' . str_repeat(' a', 2000) . ' rel="manifest">';
        $old = ini_set('pcre.backtrack_limit', '1');
        try {
            $out = GuestPageResponse::withoutManifest($html);
            $this->assertSame(PREG_BACKTRACK_LIMIT_ERROR, preg_last_error(), 'the limit really hit');
        } finally {
            ini_set('pcre.backtrack_limit', (string)$old);
        }
        $this->assertSame($html, $out);
        $this->assertSame('', GuestPageResponse::withoutManifest($html), 'removed with the normal limit');
    }

    /**
     * AK2: Nextcloud's real public layout (the image's NC 34 or 35) has
     * exactly one manifest link; the result is the input without exactly
     * this tag, and the icons, header and footer stay.
     */
    public function testRealPublicLayout(): void {
        $html = self::layout('layout.public.php');
        $this->assertSame(1, preg_match_all(GuestPageResponse::MANIFEST_LINK, $html), 'one manifest link before');
        $start = strpos($html, '<link rel="manifest"');
        $this->assertIsInt($start, 'NC writes <link rel="manifest" …>');
        $tag = substr($html, $start, (int)strpos($html, '>', $start) - $start + 1);
        $this->assertSame(1, substr_count($html, $tag), $tag);
        $out = GuestPageResponse::withoutManifest($html);
        $this->assertSame(substr_replace($html, '', $start, strlen($tag)), $out, "only $tag removed");
        $this->assertSame(0, preg_match_all(GuestPageResponse::MANIFEST_LINK, $out), 'none after');
        $this->assertStringNotContainsString('rel="manifest"', $out);
        foreach (['<link rel="apple-touch-icon" href=', '<link rel="icon" href=', '<header id="header"', '<footer'] as $kept) {
            $this->assertStringContainsString($kept, $out, "$kept stays");
        }
    }

    /** AK2: the base layout (public_template = base, E12) links no manifest. */
    public function testRealBaseLayoutHasNoManifest(): void {
        $html = self::layout('layout.base.php');
        $this->assertStringNotContainsString('rel="manifest"', $html);
        $this->assertSame(0, preg_match_all(GuestPageResponse::MANIFEST_LINK, $html));
        $this->assertSame($html, GuestPageResponse::withoutManifest($html));
    }
}
