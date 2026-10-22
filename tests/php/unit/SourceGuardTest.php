<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Greps over lib/ (SPEC-M0 §9.1): no raw request parameters, getParams()
 * only in JsonBody, no ->fetch( (only fetchAssociative), no Types::JSON, no
 * JSON_HEX_TAG, no spike leftovers (§11.2), SPDX header and strict types in
 * every file, no forbidden attributes.
 */
final class SourceGuardTest extends TestCase {
    /** @return array<string, string> path → source */
    private static function sources(): array {
        $root = dirname(__DIR__, 3);
        $out = [];
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root . '/lib', \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->getExtension() === 'php') {
                $out[substr($f->getPathname(), strlen($root) + 1)] = (string)file_get_contents($f->getPathname());
            }
        }
        foreach (['appinfo/routes.php', 'templates/main.php', 'templates/guest.php', 'templates/admin.php'] as $f) {
            $out[$f] = (string)file_get_contents($root . '/' . $f);
        }
        ksort($out);
        return $out;
    }

    /** The source without comments (rules apply to code, comments may name what is forbidden). */
    private static function code(string $src): string {
        $out = '';
        foreach (token_get_all($src) as $t) {
            if (is_array($t) && ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT)) {
                continue;
            }
            $out .= is_array($t) ? $t[1] : $t;
        }
        return $out;
    }

    public function testNoRawRequestParameters(): void {
        foreach (self::sources() as $path => $src) {
            $src = self::code($src);
            $this->assertDoesNotMatchRegularExpression('/\$_(GET|POST|REQUEST|COOKIE)\b/', $src, $path);
            $this->assertDoesNotMatchRegularExpression('/\(string\)\s*\$this->request->getParam/', $src, $path);
            if ($path !== 'lib/Http/JsonBody.php') {
                $this->assertDoesNotMatchRegularExpression('/->getParams\(\)/', $src, "$path: getParams() only in JsonBody");
                $this->assertDoesNotMatchRegularExpression('/->getParam\(/', $src, "$path: body fields only through JsonBody");
            }
        }
    }

    public function testDatabaseAndJsonRules(): void {
        foreach (self::sources() as $path => $src) {
            $src = self::code($src);
            $this->assertDoesNotMatchRegularExpression('/->fetch\(/', $src, "$path: fetchAssociative only");
            $this->assertStringNotContainsString('Types::JSON', $src, $path);
            $this->assertStringNotContainsString('JSON_HEX_TAG', $src, $path);
            $this->assertStringNotContainsString('gzencode', $src, "$path: gzip is the middleware's job");
        }
    }

    public function testNoSpikeLeftovers(): void {
        foreach (self::sources() as $path => $src) {
            $src = self::code($src);
            foreach (['open_to_users', 'share_gen', 'X-Knorke-Spike', 'voteKey', 'foreignPaths', 'example.invalid', 'KnorkeSpike', "'pw'", '"src"', "'cf'"] as $needle) {
                $this->assertStringNotContainsString($needle, $src, "$path: spike leftover $needle");
            }
            $this->assertDoesNotMatchRegularExpression('/substr\(\$p->id,\s*0,\s*47\)/', $src, "$path: actor never shortened");
        }
    }

    public function testDistributedCachesCarryTheEpochPrefix(): void {
        // SPEC-M1 §5.1 (R2, literal form; the same regex as the drift test
        // dev/selftest/docs.test.mjs): every createDistributed( argument in
        // lib/ is exactly 'knorke/' . $epoch . '/', so */knorke/*/<key> finds
        // every key and occ knorke:epoch:rotate hides all of them at once.
        $calls = [];
        foreach (self::sources() as $path => $src) {
            if (!str_starts_with($path, 'lib/')) {
                continue;
            }
            preg_match_all('/createDistributed\(([^)]*)\)/', $src, $m);
            foreach ($m[1] as $arg) {
                $calls[] = $path;
                $this->assertMatchesRegularExpression('/^\'knorke\/\' \. \$epoch \. \'\/\'$/', $arg, "$path: createDistributed($arg)");
            }
        }
        $this->assertSame(['lib/Service/FastCache.php', 'lib/Service/PresenceStore.php'], $calls, 'the two caches of §5.1, also counted in comments');
    }

    public function testHeadersAndForbiddenAttributes(): void {
        foreach (self::sources() as $path => $src) {
            $this->assertStringStartsWith("<?php\n\n// SPDX-FileCopyrightText: 2026 hotochan123\n// SPDX-License-Identifier: AGPL-3.0-or-later\n", $src, "$path: SPDX header");
            if (str_starts_with($path, 'lib/') || $path === 'appinfo/routes.php') {
                $this->assertStringContainsString("\ndeclare(strict_types=1);\n", $src, $path);
            }
            $this->assertDoesNotMatchRegularExpression('/#\[(UseSession|BruteForceProtection|AnonRateLimit|UserRateLimit)\b/', $src, $path);
        }
    }
}
