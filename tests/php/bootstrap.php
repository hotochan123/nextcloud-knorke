<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

/**
 * Unit-test bootstrap — deliberately WITHOUT lib/base.php (Pulse pattern,
 * SPEC-M0 §9). The server's Composer autoloader provides OCP\…, a PSR-4
 * loader the app; no session, no config, no database: the unit tests cannot
 * touch a Nextcloud instance at all.
 *
 * Runs in a throwaway nextcloud:* container (tests/php/run.sh unit) where the
 * sources live under /usr/src/nextcloud (NEXTCLOUD_ROOT), or inside a dev
 * stack where the app is custom_apps/knorke (default: four levels up).
 */

$ncRoot = getenv('NEXTCLOUD_ROOT') ?: dirname(__DIR__, 4);
$autoload = $ncRoot . '/lib/composer/autoload.php';
if (!is_file($autoload)) {
    fwrite(STDERR, "Nextcloud autoloader not found: $autoload (set NEXTCLOUD_ROOT)\n");
    exit(1);
}
require $autoload;

// ITimeFactory extends Psr\Clock\ClockInterface, which the server autoloader
// does not know.
$psrClock = $ncRoot . '/3rdparty/psr/clock/src/ClockInterface.php';
if (!interface_exists(\Psr\Clock\ClockInterface::class, false) && is_file($psrClock)) {
    require $psrClock;
}

// Only these 3rdparty namespaces, not the whole 3rdparty autoloader:
// Doctrine DBAL (IQueryBuilder constants, schema types), Doctrine
// Deprecations (DBAL schema classes), PSR Log (LoggerInterface), PSR
// Container (LinkPolicy resolves the share manager lazily), PSR
// EventDispatcher (every OCP event implements StoppableEventInterface) and
// Symfony Console (occ commands, SPEC-M1 §5.4 knorke:epoch:rotate) with the
// Symfony String/Service contracts it uses. Besides them the theming app's
// classes (apps/theming/lib/) and Mexitek PHPColors (used by its Util):
// ThemingIconTest drives Nextcloud's real IconBuilder with img/app.svg.
spl_autoload_register(static function (string $class) use ($ncRoot): void {
    foreach ([
        'Doctrine\\DBAL\\' => '/3rdparty/doctrine/dbal/src/',
        'Doctrine\\Deprecations\\' => '/3rdparty/doctrine/deprecations/src/',
        'Psr\\Log\\' => '/3rdparty/psr/log/src/',
        'Psr\\Container\\' => '/3rdparty/psr/container/src/',
        'Psr\\EventDispatcher\\' => '/3rdparty/psr/event-dispatcher/src/',
        'Symfony\\Component\\Console\\' => '/3rdparty/symfony/console/',
        'Symfony\\Component\\String\\' => '/3rdparty/symfony/string/',
        'Symfony\\Contracts\\Service\\' => '/3rdparty/symfony/service-contracts/',
        'OCA\\Theming\\' => '/apps/theming/lib/',
        'Mexitek\\PHPColors\\' => '/3rdparty/mexitek/phpcolors/src/Mexitek/PHPColors/',
    ] as $prefix => $dir) {
        if (!str_starts_with($class, $prefix)) {
            continue;
        }
        $file = $ncRoot . $dir . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
        return;
    }
});

// symfony/deprecation-contracts is a function file (trigger_deprecation), not a class.
$deprecations = $ncRoot . '/3rdparty/symfony/deprecation-contracts/function.php';
if (!function_exists('trigger_deprecation') && is_file($deprecations)) {
    require $deprecations;
}

// PSR-4: OCA\Knorke\ → lib/, OCA\Knorke\Tests\ → tests/php/.
spl_autoload_register(static function (string $class): void {
    foreach ([
        'OCA\\Knorke\\Tests\\' => __DIR__ . '/',
        'OCA\\Knorke\\' => dirname(__DIR__, 2) . '/lib/',
    ] as $prefix => $dir) {
        if (!str_starts_with($class, $prefix)) {
            continue;
        }
        $file = $dir . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
        return;
    }
});
