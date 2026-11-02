<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\AiLayout;
use OCA\Knorke\Service\RichText;
use PHPUnit\Framework\TestCase;

/**
 * Factory job 279 (AK2): the text without Markdown marks on the server, the
 * same vectors as src/model/richText.js plainText, and what the AI gets.
 */
final class RichTextTest extends TestCase {
    public function testVectorsAsTheClient(): void {
        $doc = json_decode((string)file_get_contents(__DIR__ . '/../../fixtures/rich-plain.json'), true, 16, JSON_THROW_ON_ERROR);
        $this->assertGreaterThanOrEqual(10, count($doc['vectors']));
        foreach ($doc['vectors'] as $v) {
            $this->assertSame($v['plain'], RichText::plain($v['in']), 'for ' . json_encode($v['in']));
        }
    }

    /** Round 1: a line of MAX_TEXT characters full of marks without partners is read in linear time. */
    public function testLongLinesStayFast(): void {
        foreach (['*x **y ', '**a *b ', '~~a **b *c `d ', '*a ', '[a '] as $p) {
            $s = substr(str_repeat($p, intdiv(6000, strlen($p)) + 1), 0, 6000);
            $t = hrtime(true);
            RichText::plain($s);
            $this->assertLessThan(200, (hrtime(true) - $t) / 1e6, $p);
        }
    }

    public function testTextWithoutMarksStaysAsItIs(): void {
        foreach (['', 'plain', "two\nlines", 'a_b_c', 'Grüße 😀'] as $s) {
            $this->assertSame($s, RichText::plain($s));
        }
    }

    public function testTheAiGetsTheTextWithoutMarks(): void {
        $it = static fn (string $t, array $data): array => ['id' => 'x', 't' => $t, 'parent' => null, 'x' => 0.0, 'y' => 0.0, 'w' => 1.0, 'h' => 1.0,
            'r' => 0.0, 'data' => $data, 'group' => null, 'locked' => false, 'deleted' => false];
        $this->assertSame('Ziel Doku (https://x.de)', AiLayout::textOf($it('sticky', ['text' => '**Ziel** [Doku](https://x.de)'])));
        $this->assertSame('fett', AiLayout::textOf($it('shape', ['text' => ' **fett** '])));
        $this->assertSame('- a', AiLayout::textOf($it('text', ['text' => '- *a*'])));
        // a frame title is never Markdown
        $this->assertSame('**T**', AiLayout::textOf($it('frame', ['title' => '**T**'])));
    }
}
