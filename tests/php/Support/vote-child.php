<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

/**
 * A second PHP process — its own database connection — for the vote
 * integration tests (SPEC-M1 §8.2 PHP integration: two voters on a second
 * connection, closing under load, four concurrent ways of closing). Runs as
 * www-data inside the dev stack, started by VoteFlowIntegrationTest through
 * proc_open with:
 *   KT_NC   the Nextcloud root (\OC::$SERVERROOT)
 *   KT_CMD  one command as JSON:
 *     {"cmd":"apply","board":7,"sid":3,"pid":"…","ops":[["<item>",1],…]}
 *     {"cmd":"loop","board":7,"sid":3,"pid":"…","items":[…],"rounds":200,"seed":1,"gapUs":2000}
 *     {"cmd":"progress","board":7} | {"cmd":"end","board":7} | {"cmd":"job"}
 * Protocol: prints "ready" after the bootstrap, waits for one line on stdin
 * (the start barrier), runs the command, prints ONE JSON line and exits.
 * It refuses to run outside a Knorke dev stack (knorke_dev = true).
 */

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Service\VoteService;
use OCP\Server;

require (string)getenv('KT_NC') . '/lib/base.php';
if (Server::get(\OCP\IConfig::class)->getSystemValueBool('knorke_dev', false) !== true) {
    fwrite(STDERR, "not a Knorke dev stack\n");
    exit(2);
}
Server::get(\OCP\App\IAppManager::class)->loadApp('knorke');

$cmd = json_decode((string)getenv('KT_CMD'), true, 16, JSON_THROW_ON_ERROR);
$votes = Server::get(VoteService::class);
$now = static fn (): int => (int)floor(microtime(true) * 1000);
$pid = (string)($cmd['pid'] ?? 'kt-moderator0000');
$voter = new Principal('u:' . $pid, Role::Vote, 'Child', substr($pid, 0, 16), false, $pid, 'share');
$moderator = new Principal('u:kt-mod', Role::Owner, 'Moderator', 'kt-moderator0000', false, 'kt-mod', 'owner');
$op = static fn (string $item, int $n): array => ['o' => 'vote', 's' => (int)$cmd['sid'], 'id' => $item, 'n' => $n];

fwrite(STDOUT, "ready\n");
fflush(STDOUT);
fgets(STDIN);
$t0 = microtime(true);

switch ($cmd['cmd']) {
    case 'apply':
        $out = $votes->apply($voter, (int)$cmd['board'], array_map(static fn (array $o): array => $op($o[0], $o[1]), $cmd['ops']), $now());
        break;
    case 'loop':
        // One op per batch over the items in turn; each pass flips every item
        // (n = 1, then 0), so every batch after the first pass changes the
        // state (an effective batch: seq + 1) and the budget never runs out.
        $res = [];
        $last = null;
        $items = $cmd['items'];
        for ($i = 0; $i < (int)$cmd['rounds']; $i++) {
            $item = $items[($i * 7 + (int)$cmd['seed']) % count($items)];
            $r = $votes->apply($voter, (int)$cmd['board'], [$op($item, (intdiv($i, count($items)) + $i) % 2)], $now());
            $res[] = $r['res'][0];
            if ($r['sid'] !== null) {
                $last = $r['mine'];
            }
            usleep((int)($cmd['gapUs'] ?? 0));
        }
        $out = ['res' => $res, 'last' => $last];
        break;
    case 'progress':
        $out = ['progress' => $votes->progress($moderator, (int)$cmd['board'], 0, $now())];
        break;
    case 'end':
        try {
            $votes->update($moderator, (int)$cmd['board'], 'end', null, $now());
            $out = ['status' => 200];
        } catch (HttpError $e) {
            $out = ['status' => $e->status, 'error' => $e->error];
        }
        break;
    case 'job':
        $out = ['closed' => $votes->closeExpired($now())];
        break;
    default:
        fwrite(STDERR, 'unknown command' . "\n");
        exit(2);
}
$out['ms'] = (int)round((microtime(true) - $t0) * 1000);
fwrite(STDOUT, json_encode($out, JSON_THROW_ON_ERROR) . "\n");
