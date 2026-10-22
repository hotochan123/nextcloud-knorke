<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

/**
 * Integration-test bootstrap (SPEC-M0 §9.2): loads lib/base.php of the dev
 * stack's Nextcloud — its real database (any KD_DB kind), real Redis — and
 * REFUSES to run unless the instance carries the dev mark knorke_dev =
 * true (set by dev/up.sh). The tests write and delete rows (and create and
 * delete their own accounts); they must never meet a real instance.
 *
 * Run as www-data inside knorke-dev-$KD_NS-nc (tests/php/run.sh integration).
 */

$ncRoot = getenv('NEXTCLOUD_ROOT') ?: dirname(__DIR__, 4);
if (!is_file($ncRoot . '/lib/base.php')) {
    fwrite(STDERR, "Nextcloud not found at $ncRoot (integration tests run inside the dev stack)\n");
    exit(1);
}
require_once $ncRoot . '/lib/base.php';

if (\OCP\Server::get(\OCP\IConfig::class)->getSystemValueBool('knorke_dev', false) !== true) {
    fwrite(STDERR, "Refusing to run: this instance is not a Knorke dev stack (system config knorke_dev is not true).\n");
    exit(1);
}
$appManager = \OCP\Server::get(\OCP\App\IAppManager::class);
if (!$appManager->isEnabledForAnyone('knorke')) {
    fwrite(STDERR, "Refusing to run: the knorke app is not enabled.\n");
    exit(1);
}
// Like a web request does it: the app is loaded (autoloader, register()),
// so its routes can be generated (Router: "app MUST be loaded before app routes").
$appManager->loadApp('knorke');

// The app itself is autoloaded by Nextcloud (enabled app); the test helpers here.
spl_autoload_register(static function (string $class): void {
    $prefix = 'OCA\\Knorke\\Tests\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
