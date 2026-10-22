<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\BackgroundJob\CleanupJob;
use OCA\Knorke\BackgroundJob\VoteCloseJob;
use OCA\Knorke\Command\Compact;
use OCA\Knorke\Command\EpochRotate;
use OCA\Knorke\Command\Orphans;
use OCA\Knorke\Migration\BackfillItemBytes;
use OCA\Knorke\Migration\InitEpoch;
use OCP\BackgroundJob\IJob;
use OCP\BackgroundJob\TimedJob;
use OCP\Migration\IRepairStep;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Command\Command;

/**
 * appinfo/info.xml of stage 0 (SPEC-M1 §3, §9.1):
 *  - version 0.3.0: the M2 data foundation (Version000300Date20261017000000,
 *    grouping and locking) needs the bump, like the M1 migration needed
 *    0.2.0; since factory job 050 the description names no version or
 *    milestone (the Apps page shows <version> on its own), so it cannot
 *    go stale with the next bump;
 *  - every class it names exists: Nextcloud registers <background-jobs> only
 *    on install/upgrade and drops a job whose class is missing on the first
 *    cron run, and a <commands> entry without its class prints "Console
 *    command … is unknown" on every occ call — so <commands> named ONLY
 *    EpochRotate in stage 0; Compact (occ knorke:compact) came with its
 *    class in stage 4 (SPEC-M1 §9.5 WP-B4, R2) without a version jump;
 *  - repair steps InitEpoch and BackfillItemBytes on install and after
 *    migrations;
 *  - valid against the app-info schema of the running server
 *    (resources/app-info.xsd).
 */
final class InfoXmlTest extends TestCase {
    private static function xml(): \SimpleXMLElement {
        $xml = simplexml_load_file(dirname(__DIR__, 3) . '/appinfo/info.xml');
        self::assertInstanceOf(\SimpleXMLElement::class, $xml);
        return $xml;
    }

    /** @return list<string> */
    private static function texts(\SimpleXMLElement $parent, string $child): array {
        $out = [];
        foreach ($parent->{$child} as $e) {
            $out[] = trim((string)$e);
        }
        return $out;
    }

    public function testVersionAndId(): void {
        $xml = self::xml();
        $this->assertSame('knorke', (string)$xml->id);
        $this->assertSame('0.3.0', (string)$xml->version);
        $this->assertSame('Knorke', (string)$xml->namespace);
    }

    public function testCommandsNameOnlyExistingClasses(): void {
        $commands = self::texts(self::xml()->commands, 'command');
        $this->assertSame([EpochRotate::class, Compact::class, Orphans::class], $commands, 'P7: EpochRotate, Compact and Orphans, nothing else');
        foreach ($commands as $class) {
            $this->assertTrue(class_exists($class), "$class exists");
            $this->assertTrue(is_subclass_of($class, Command::class), "$class is a console command");
        }
    }

    public function testDescriptionNamesNoVersionOrMilestone(): void {
        // P7-06 (OPS-7, SPEC-M1 §33.1, ED-39): no M0, never "not for production".
        // Factory job 050: the status sections are timeless, so the Apps page
        // shows only <version> and the text does not go stale with a bump.
        $raw = (string)file_get_contents(dirname(__DIR__, 3) . '/appinfo/info.xml');
        $this->assertDoesNotMatchRegularExpression('/\bM0\b/', $raw);
        $this->assertDoesNotMatchRegularExpression('/not for production/i', $raw);
        $en = $de = null;
        foreach (self::xml()->description as $d) {
            if ((string)$d['lang'] === 'de') {
                $de = (string)$d;
            } else {
                $en = (string)$d;
            }
        }
        $this->assertNotNull($en, 'English description');
        $this->assertNotNull($de, 'German description');
        $flat = static fn (string $s): string => (string)preg_replace('/\s+/', ' ', $s);
        $this->assertStringContainsString('Knorke is a young app under active development. The changelog (`CHANGELOG.md`) lists what each version changes.', $flat((string)$en));
        $this->assertStringContainsString('Knorke ist eine junge App und wird aktiv weiterentwickelt. Was sich mit jeder Version ändert, steht in der Liste der Veränderungen (`CHANGELOG.md`).', $flat((string)$de));
        $stale = ['/\b\d+\.\d+\.\d+\b/', '/\bM\d\b/', '/milestone|Meilenstein/i', '/custom app|Custom-App/i', '/follows with|folgt mit/i'];
        foreach (['en' => (string)$en, 'de' => (string)$de] as $lang => $text) {
            foreach ($stale as $pattern) {
                $this->assertDoesNotMatchRegularExpression($pattern, $text, "description ($lang) must not match $pattern");
            }
        }
        $this->assertSame('https://github.com/hotochan123/nextcloud-knorke', (string)self::xml()->website, '<website> stays');
        $this->assertSame('https://github.com/hotochan123/nextcloud-knorke/issues', (string)self::xml()->bugs, '<bugs> stays');
    }

    public function testBackgroundJobsExist(): void {
        $jobs = self::texts(self::xml()->{'background-jobs'}, 'job');
        $this->assertSame([CleanupJob::class, VoteCloseJob::class], $jobs);
        foreach ($jobs as $class) {
            $this->assertTrue(class_exists($class), "$class exists");
            $this->assertTrue(is_subclass_of($class, IJob::class), "$class is a background job");
        }
        $this->assertTrue(is_subclass_of(VoteCloseJob::class, TimedJob::class));
    }

    public function testRepairSteps(): void {
        $steps = self::xml()->{'repair-steps'};
        $want = [InitEpoch::class, BackfillItemBytes::class];
        $this->assertSame($want, self::texts($steps->{'post-migration'}, 'step'), 'post-migration');
        $this->assertSame($want, self::texts($steps->install, 'step'), 'install');
        $this->assertSame(0, count($steps->{'pre-migration'}) + count($steps->{'live-migration'}) + count($steps->uninstall));
        foreach ($want as $class) {
            $this->assertTrue(is_subclass_of($class, IRepairStep::class), "$class is a repair step");
        }
    }

    public function testValidAgainstTheServersSchema(): void {
        $root = getenv('NEXTCLOUD_ROOT') ?: dirname(__DIR__, 5);
        $xsd = $root . '/resources/app-info.xsd';
        $this->assertFileExists($xsd, 'the server ships resources/app-info.xsd');
        $doc = new \DOMDocument();
        $this->assertTrue($doc->load(dirname(__DIR__, 3) . '/appinfo/info.xml'));
        $prev = libxml_use_internal_errors(true);
        try {
            $ok = $doc->schemaValidate($xsd);
            $errors = array_map(static fn (\LibXMLError $e): string => trim($e->message) . ' (line ' . $e->line . ')', libxml_get_errors());
            libxml_clear_errors();
        } finally {
            libxml_use_internal_errors($prev);
        }
        $this->assertTrue($ok, implode("\n", $errors));
    }
}
