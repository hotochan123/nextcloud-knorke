<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\Input;
use OCA\Knorke\Service\Limits;
use OCA\Knorke\Service\OpValidator;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\SyncHarness as H;
use PHPUnit\Framework\TestCase;

/**
 * Legacy MySQL/MariaDB without 4-byte UTF-8 (IDBConnection::supports4ByteText()
 * false, review finding NC-3): every code point above U+FFFF the server
 * stores becomes U+FFFD during validation — never a 500 — and the writer
 * gets the stored value back (SPEC-M0 §4.8).
 */
final class FourByteTextTest extends TestCase {
    private const R = "\u{FFFD}";

    public function testBmpReplacesOnlySupplementaryCodePoints(): void {
        $this->assertSame('great idea ' . self::R, Input::bmp('great idea 👍'));
        $this->assertSame('€ ü 中 ' . "\u{FFFF}", Input::bmp('€ ü 中 ' . "\u{FFFF}"), '1–3-byte characters stay');
        $this->assertSame(self::R . self::R . 'x' . self::R, Input::bmp("😀\u{10000}x\u{10FFFF}"));
        $this->assertSame(self::R . "\u{200D}" . self::R, Input::bmp("\u{1F468}\u{200D}\u{1F469}"), 'a ZWJ sequence keeps its joiner');
        $this->assertSame('', Input::bmp(''));
        $text = str_repeat('😀', Limits::MAX_TEXT);
        $this->assertSame(Limits::MAX_TEXT, mb_strlen(Input::bmp($text)), 'same number of code points: length limits keep holding');
        $this->assertSame(3 * Limits::MAX_TEXT, strlen(Input::bmp($text)));
    }

    private static function editor(): Principal {
        return new Principal('u:alice', Role::Edit, 'Alice', '3f9a1c0b7d2e4a51', false, 'alice', 'link');
    }

    public function testValidatorReplacesInEveryStringOfDataAndStyle(): void {
        $put = ['o' => 'put', 'id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 't' => 'sticky', 'p' => [
            'x' => 1, 'y' => 2, 'w' => 200, 'h' => 200, 'z' => 'i1', 'parent' => null,
            'data' => ['text' => 'Retro 👍', 'tags' => ['🔥', 'ok'], 'meta' => ['by' => ['n' => '🦊 Fuchs']]],
            'style' => ['fill' => '#a8d8f8', 'emoji' => '🎉'],
        ]];
        $n = OpValidator::normalize(self::editor(), $put, false);
        $this->assertSame('put', $n['o']);
        $this->assertSame(['text' => 'Retro ' . self::R, 'tags' => [self::R, 'ok'], 'meta' => ['by' => ['n' => self::R . ' Fuchs']]], $n['item']['data']);
        $this->assertSame(['fill' => '#a8d8f8', 'emoji' => self::R], $n['item']['style']);
        $this->assertSame('Retro 👍', OpValidator::normalize(self::editor(), $put)['item']['data']['text'], 'with 4-byte support the text is kept');

        $patch = ['o' => 'patch', 'id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 'p' => ['data.text' => 'great idea 👍', 'data.x.y' => ['a' => '🙂'], 'style.fill' => '#000000']];
        $this->assertSame(['data.text' => 'great idea ' . self::R, 'data.x.y' => ['a' => self::R], 'style.fill' => '#000000'], OpValidator::normalize(self::editor(), $patch, false)['p']);
        $this->assertSame('bad', OpValidator::normalize(self::editor(), ['o' => 'patch', 'id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 'p' => ['data.text' => str_repeat('😀', Limits::MAX_TEXT + 1)]], false)['o'], 'too long stays too long');
        $title = OpValidator::normalize(self::editor(), ['o' => 'put', 'id' => '01JA2B3C4D5E6F7G8H9J0KMNPQ', 't' => 'frame', 'p' => ['w' => 800, 'h' => 600, 'z' => 'hz', 'data' => ['title' => str_repeat('🗂', 200)]]], false);
        $this->assertSame(str_repeat(self::R, 200), $title['item']['data']['title'], 'a frame title of 200 emoji fits as 200 × U+FFFD');
    }

    public function testSyncStoresTheReplacementAndAnswersTheStoredItem(): void {
        $h = new H();
        $h->fourByte = false;
        $h->store->addBoard(1, 0);
        $id = '01JA0000000000000000000001';
        $plain = '01JA0000000000000000000002';
        $d = $h->syncDecoded(['since' => 0, 'seq' => 1, 'pres' => 0, 'ops' => [
            H::put($id, H::sticky(['data' => ['text' => 'great idea 👍']])),
            H::put($plain, H::sticky(['data' => ['text' => '€ ü 中']])),
            H::patch($id, ['style.label' => 'Zielbild 🎯']),
        ]]);
        $this->assertSame(['seq' => 1, 'rev' => 1, 'res' => ['ok', 'ok', 'ok']], $d['acks'], 'the whole batch is written, nothing is lost');
        $byId = array_column($d['items'], null, 'id');
        $this->assertSame('great idea ' . self::R, $byId[$id]['data']['text'], 'the writer gets the STORED value in the same answer');
        $this->assertSame('Zielbild ' . self::R, $byId[$id]['style']['label']);
        $this->assertSame('€ ü 中', $byId[$plain]['data']['text']);
        $this->assertSame('great idea ' . self::R, $h->store->live(1, $id)['data']['text']);
        $this->assertStringContainsString('great idea ' . self::R, (string)$h->store->changesOf($id)[0]['patch'], 'the change log holds the stored value');
        $this->assertSame($h->store->liveBytes(1), $h->store->boards[1]['item_bytes'], 'item_bytes counts the stored (3-byte) form');

        $h->fourByte = true;
        $d = $h->syncDecoded(['since' => 1, 'seq' => 2, 'pres' => 0, 'ops' => [H::patch($id, ['data.text' => 'great idea 👍'])]]);
        $this->assertSame('great idea 👍', $d['items'][0]['data']['text'], 'utf8mb4 databases keep the emoji');
    }

    public function testBoardTitle(): void {
        $h = new AccessHarness();
        $h->fourByte = false;
        $board = $h->service->create('alice', '  Retro 👍 ');
        $this->assertSame('Retro ' . self::R, $board['title'], 'the answer carries the stored title');
        $this->assertSame('Retro ' . self::R, $h->boards->boards[$board['id']]['title']);
        $this->assertSame(self::R . ' Sprint', $h->service->rename('alice', $board['id'], '🏁 Sprint')['title']);
        $this->assertSame(str_repeat(self::R, 200), $h->service->create('alice', str_repeat('😀', 200))['title'], '200 emoji are still 200 characters');
        $h->fourByte = true;
        $this->assertSame('Retro 👍', $h->service->create('alice', 'Retro 👍')['title']);
    }
}
