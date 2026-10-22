<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Templates that are never run directly (P7, SPEC-M1 §33.1 g, OPS-3):
 * Nextcloud's .htaccess leaves cron.php, public.php, remote.php and
 * status.php at any depth out of its rewrite rules, so no runtime file of
 * the app may have one of these names (templates/public.php is now
 * templates/guest.php), and every template (main, guest and, since the M2
 * privacy notice, admin) begins with a guard: without
 * Nextcloud around them (OCP\Util not loadable) they set 404 and end
 * without any output — no "Fatal error", no server path.
 */
final class TemplatesTest extends TestCase {
    private const RESERVED = ['cron.php', 'public.php', 'remote.php', 'status.php'];
    private const RUNTIME = ['appinfo', 'lib', 'templates', 'img', 'js', 'css', 'l10n'];
    private const GUARD = 'if (!class_exists(\OCP\Util::class)) { http_response_code(404); exit; }';

    private static function root(): string {
        return dirname(__DIR__, 3);
    }

    public function testNoRuntimeFileHasAReservedName(): void {
        $found = [];
        foreach (self::RUNTIME as $dir) {
            if (!is_dir(self::root() . '/' . $dir)) {
                continue;
            }
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(self::root() . '/' . $dir, \FilesystemIterator::SKIP_DOTS));
            foreach ($it as $f) {
                if (in_array(strtolower($f->getFilename()), self::RESERVED, true)) {
                    $found[] = substr($f->getPathname(), strlen(self::root()) + 1);
                }
            }
        }
        $this->assertSame([], $found);
        $this->assertFileExists(self::root() . '/templates/guest.php');
        $this->assertFileExists(self::root() . '/templates/admin.php');
        $this->assertSame(['admin.php', 'guest.php', 'main.php'], array_values(array_diff(scandir(self::root() . '/templates'), ['.', '..'])), 'every template is checked below');
        $this->assertFileDoesNotExist(self::root() . '/templates/public.php');
    }

    public function testEveryTemplateStartsWithTheGuard(): void {
        foreach (['main', 'guest', 'admin'] as $t) {
            $src = (string)file_get_contents(self::root() . "/templates/$t.php");
            $code = array_values(array_filter(array_map('trim', explode("\n", $src)), static fn (string $l): bool => $l !== '' && $l !== '<?php' && !str_starts_with($l, '//')));
            $this->assertSame(self::GUARD, $code[0] ?? null, "$t.php: the first statement after the header is the guard");
        }
    }

    public function testRunDirectlyTheyPrintNothing(): void {
        // A PHP process without Nextcloud's autoloader, like a direct HTTP
        // request would be: no output at all (the guard exits before the
        // first OCP call), exit code 0, no "Fatal error".
        foreach (['main', 'guest', 'admin'] as $t) {
            $out = [];
            $code = -1;
            exec(escapeshellarg(PHP_BINARY) . ' -n -d display_errors=1 ' . escapeshellarg(self::root() . "/templates/$t.php") . ' 2>&1', $out, $code);
            $this->assertSame([0, ''], [$code, implode("\n", $out)], "$t.php run directly");
        }
    }
}
