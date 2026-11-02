<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\BoardApiController;
use OCA\Knorke\Db\ItemStore;
use OCA\Knorke\Service\BoardSketch;
use OCA\Knorke\Service\TemplateStore;
use OCA\Knorke\Tests\Support\AccessHarness;
use OCA\Knorke\Tests\Support\Fake;
use OCA\Knorke\Tests\Support\SqliteDb;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IDBConnection;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Factory job 221: the sketch of a stored board for the board list
 * (BoardSketch, ItemStore sketchBoxes/stylesOf, route 57). The SQL runs
 * unchanged on SQLite (SqliteDb), so the two reads are checked as the
 * database sees them.
 */
final class BoardSketchTest extends TestCase {
    private SqliteDb $db;
    private int $board;
    private int $rev = 1;

    protected function setUp(): void {
        $this->db = new SqliteDb();
        $this->board = $this->db->addBoard();
    }

    /** An item row with its geometry, data and style. */
    private function item(string $id, string $type, float $x, float $y, float $w, float $h, array|string $style = [], array $data = [],
        ?string $parent = null, bool $deleted = false): void {
        $this->db->pdo->prepare('INSERT INTO oc_knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, version, rev, deleted,'
            . ' created_by, created_at, modified_by, modified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, 0, ?, 0)')
            ->execute([$this->board, $id, $type, $parent, 'a' . $this->rev, $x, $y, $w, $h, json_encode((object)$data),
                is_string($style) ? $style : json_encode((object)$style), $this->rev++, $deleted ? 1 : 0, 'u:alice', 'u:alice']);
    }

    private function sketch(): array {
        $this->db->statements = [];
        return BoardSketch::of((new ItemStore($this->db->connection()))->sketchBoxes($this->board),
            fn (array $ids): array => (new ItemStore($this->db->connection()))->stylesOf($this->board, $ids));
    }

    /** @return list<string> the SELECTs on knorke_items since sketch() began */
    private function itemSelects(): array {
        return array_values(array_filter($this->db->statements, static fn (string $s): bool => str_contains($s, 'oc_knorke_items')));
    }

    /** TemplateStore's check of a stored sketch (private there): the same form. */
    private static function assertSketchForm(array $sketch): void {
        $check = new \ReflectionMethod(TemplateStore::class, 'sketchOf');
        self::assertNotNull($check->invoke(null, $sketch), 'the form of a template sketch');
        foreach ($sketch as [$x, $y, $w, $h]) {
            foreach ([$x, $y, $w, $h] as $v) {
                self::assertTrue(is_finite((float)$v));
            }
        }
    }

    /** @param list<array> $rows boxes (id, type, parent_id, x, y, w, h) */
    private static function pure(array $rows, array $styles = [], ?array &$asked = null): array {
        return BoardSketch::of($rows, static function (array $ids) use ($styles, &$asked): array {
            $asked[] = $ids;
            return array_intersect_key($styles, array_flip($ids));
        });
    }

    private static function box(string $id, string $type, float $x, float $y, float $w, float $h, ?string $parent = null): array {
        return ['id' => $id, 'type' => $type, 'parent_id' => $parent, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
    }

    public function testAk1FramesAndColouredBoxesInPlaceWithoutConnectorsTombstonesOrText(): void {
        $this->item('01F', 'frame', 0, 0, 1000, 500, [], ['title' => 'Confidential frame']);
        $this->item('01G', 'frame', 1200, 0, 300, 300, ['fill' => '#AABBCC']);
        $this->item('01N', 'sticky', 100, 100, 200, 200, ['fill' => '#FFEB3B'], ['text' => 'Secret plan'], '01F');
        $this->item('01T', 'text', -100, 600, 300, 50, ['color' => '#ff0000'], ['text' => 'Hidden words']);
        $this->item('01C', 'connector', 0, 0, 0, 0, ['stroke' => '#000000'], ['start' => ['item' => '01N'], 'end' => ['x' => 5000, 'y' => 5000]]);
        $this->item('01D', 'sticky', 9000, 9000, 200, 200, ['fill' => '#00ff00'], ['text' => 'deleted'], null, true);
        $sketch = $this->sketch();
        // union -100…1500 × 0…650, scale 112 / 1600 = 0.07, offset (4, 17.25)
        $this->assertEquals([
            [11, 17.25, 70, 35, ''],
            [95, 17.25, 21, 21, ''],
            [18, 24.25, 14, 14, '#ffeb3b'],
            [4, 59.25, 21, 3.5, '#d0d0d0'],
        ], $sketch, 'frames first, the note at its absolute place in its colour, the text grey');
        self::assertSketchForm($sketch);
        $json = json_encode($sketch, JSON_THROW_ON_ERROR);
        foreach (['Confidential', 'Secret', 'Hidden', 'deleted', 'aabbcc', '#00ff00', '#000000', '#ff0000'] as $word) {
            $this->assertStringNotContainsStringIgnoringCase($word, $json, 'no text, no colour of a frame, connector, tombstone or text');
        }
    }

    public function testAk1EmptyBoardHasNoSketch(): void {
        $this->item('01C', 'connector', 0, 0, 0, 0);
        $this->item('01D', 'sticky', 0, 0, 200, 200, ['fill' => '#00ff00'], [], null, true);
        $this->assertSame([], $this->sketch());
        $this->assertCount(1, $this->itemSelects(), 'no second read');
    }

    public function testAk1AtMost40FramesFirstThenByAreaThenById(): void {
        $rows = [self::box('01Z', 'frame', 0, 0, 100, 100), self::box('01Y', 'frame', 0, 0, 400, 400), self::box('01X', 'frame', 0, 0, 200, 200)];
        $styles = [];
        for ($i = 0; $i < 50; $i++) {
            $id = sprintf('02%02d', $i);
            $side = 20 + ($i % 10) * 10;
            $rows[] = self::box($id, 'sticky', $i * 30, 500, $side, $side);
            $styles[$id] = '{"fill":"#112233"}';
        }
        $asked = [];
        $sketch = self::pure($rows, $styles, $asked);
        $this->assertCount(40, $sketch);
        $this->assertSame(['', '', ''], array_column(array_slice($sketch, 0, 3), 4), 'the three frames first');
        $this->assertGreaterThan($sketch[1][2], $sketch[0][2], 'frames by area, largest first');
        $this->assertGreaterThan($sketch[2][2], $sketch[1][2]);
        $this->assertCount(1, $asked, 'one read of styles');
        $this->assertCount(37, $asked[0], 'only the drawn notes');
        // sides 110 (i % 10 = 9: ids 0209, 0219, …) first, equal areas by id
        $this->assertSame(['0209', '0219', '0229', '0239', '0249', '0208'], array_slice($asked[0], 0, 6));
        $areas = array_map(static fn (array $e): float => (float)$e[2] * (float)$e[3], array_slice($sketch, 3));
        $sorted = $areas;
        rsort($sorted);
        $this->assertSame($sorted, $areas, 'the other boxes by area, largest first');
        self::assertSketchForm($sketch);
    }

    public function testAk1EdgeCasesStayInsideTheBox(): void {
        $asked = null;
        // an outlier far away, a child of a missing parent, a negative size, broken and hostile styles
        $sketch = self::pure([
            self::box('01A', 'sticky', 0, 0, 200, 200),
            self::box('01B', 'sticky', 1e7, 1e7, 200, 200),
            self::box('01C', 'shape', 50, 50, -30, 100, '01GONE'),
            self::box('01D', 'sticky', 300, 0, 200, 200),
            self::box('01E', 'sticky', 600, 0, 200, 200),
        ], ['01A' => '{"fill":', '01B' => '{"fill":"</svg><script>alert(1)</script>"}', '01D' => '{"fill":"#ABCDEF"}', '01E' => null], $asked);
        $this->assertCount(5, $sketch);
        self::assertSketchForm($sketch);
        $fills = array_column($sketch, 4);
        $this->assertNotContains('</svg><script>alert(1)</script>', $fills);
        $this->assertContains('#abcdef', $fills, 'kept in lower case');
        $this->assertSame(4, count(array_keys($fills, '#d0d0d0', true)), 'broken JSON, hostile fill, no style, no fill: grey');
        // a negative width counts as 0; a child of a missing parent stays at its own place (scale 0.48, offset (36, 4))
        $this->assertEquals([[36, 4, 48, 48, '#d0d0d0'], [60, 28, 0, 48, '#d0d0d0']],
            self::pure([self::box('01A', 'sticky', 0, 0, 100, 100), self::box('01C', 'shape', 50, 50, -30, 100, '01GONE')]));
        // a frame alone needs no styles; frames are outlines whatever their fill
        $asked = null;
        $this->assertEquals([[4, 4, 112, 72, '']], self::pure([self::box('01F', 'frame', -50, -50, 1400, 900)], [], $asked));
        $this->assertNull($asked, 'no read of styles for frames');
        // a single point-like box: no division by zero
        $this->assertEquals([[60, 40, 0, 0, '#d0d0d0']], self::pure([self::box('01P', 'text', 5, 5, 0, 0)]));
        $this->assertSame([], self::pure([]));
    }

    public function testAk2LargeBoardTwoReadsNoDataAtMost40Ids(): void {
        for ($i = 0; $i < 3; $i++) {
            $this->item(sprintf('01F%d', $i), 'frame', $i * 2000, 0, 1800, 1800, ['fill' => '#eeeeee'], ['title' => str_repeat('T', 200)]);
        }
        for ($i = 0; $i < 497; $i++) {
            $this->item(sprintf('02N%03d', $i), 'sticky', ($i % 30) * 210, intdiv($i, 30) * 210, 200, 200, ['fill' => '#ffeb3b'],
                ['text' => str_repeat('x', 2000)], $i < 30 ? '01F0' : null);
        }
        $sketch = $this->sketch();
        $this->assertCount(40, $sketch);
        $selects = $this->itemSelects();
        $this->assertCount(2, $selects, 'exactly two reads');
        $this->assertDoesNotMatchRegularExpression('/\b(data|style)\b/', $selects[0], 'the boxes: numbers only');
        $this->assertStringContainsString("type <> ?", $selects[0]);
        $this->assertDoesNotMatchRegularExpression('/\bdata\b/', $selects[1], 'never data');
        $this->assertLessThanOrEqual(40, substr_count($selects[1], '?') - 1, 'at most 40 ids');
        $this->assertSame(37, substr_count($selects[1], '?') - 1, 'the drawn notes, not the frames');
        self::assertSketchForm($sketch);
    }

    public function testAk2FramesOnlyNeedOneRead(): void {
        $this->item('01F', 'frame', 0, 0, 500, 500, ['fill' => '#123456']);
        $this->assertEquals([[24, 4, 72, 72, '']], $this->sketch());
        $this->assertCount(1, $this->itemSelects());
    }

    // --- the picture of a link preview (factory job 236) --------------------

    /** svg() parsed: the root and its rect elements as attribute lists. */
    private static function parse(string $svg): array {
        $doc = new \DOMDocument();
        self::assertTrue($doc->loadXML($svg, LIBXML_NONET), 'well-formed XML');
        $root = $doc->documentElement;
        self::assertSame('svg', $root->localName);
        self::assertSame('http://www.w3.org/2000/svg', $root->namespaceURI);
        self::assertSame('', $doc->textContent, 'no text');
        $rects = [];
        foreach ($root->childNodes as $n) {
            self::assertInstanceOf(\DOMElement::class, $n, 'only elements below the root');
            self::assertSame('rect', $n->localName, 'only rect elements');
            self::assertSame(0, $n->childNodes->length);
            $attrs = [];
            foreach ($n->attributes as $a) {
                $attrs[$a->name] = $a->value;
            }
            $rects[] = $attrs;
        }
        $top = [];
        foreach ($root->attributes as $a) {
            $top[$a->name] = $a->value;
        }
        return [$top, $rects];
    }

    private const BG = ['x' => '-20', 'y' => '0', 'width' => '160', 'height' => '80', 'fill' => '#f3f2f0'];
    private const FRAME = ['fill' => '#ffffff', 'stroke' => '#7f8790', 'stroke-width' => '0.6'];
    private const NOTE = ['stroke' => '#000000', 'stroke-opacity' => '0.25', 'stroke-width' => '0.4'];

    public function testJob236Ak5TheSketchOnTheBoardAsTheListDrawsIt(): void {
        $this->item('01F', 'frame', 0, 0, 1000, 500, [], ['title' => 'Confidential frame']);
        $this->item('01G', 'frame', 1200, 0, 300, 300, ['fill' => '#AABBCC']);
        $this->item('01N', 'sticky', 100, 100, 200, 200, ['fill' => '#FFEB3B'], ['text' => 'Secret plan'], '01F');
        $this->item('01T', 'text', -100, 600, 300, 50, ['color' => '#ff0000'], ['text' => 'Hidden words']);
        $sketch = (new AccessHarness())->sketches(new ItemStore($this->db->connection()))->ofBoard($this->board);
        $this->assertEquals($this->sketch(), $sketch, 'ofBoard(): the same sketch as of(), without a rights check');
        $svg = BoardSketch::svg($sketch);
        [$top, $rects] = self::parse($svg);
        $this->assertSame(['width' => '160', 'height' => '80', 'viewBox' => '-20 0 160 80'], $top, '2 : 1 as board-card.svg, the box in the middle');
        $this->assertSame([
            self::BG,
            ['x' => '11', 'y' => '17.25', 'width' => '70', 'height' => '35'] + self::FRAME,
            ['x' => '95', 'y' => '17.25', 'width' => '21', 'height' => '21'] + self::FRAME,
            ['x' => '18', 'y' => '24.25', 'width' => '14', 'height' => '14', 'fill' => '#ffeb3b'] + self::NOTE,
            ['x' => '4', 'y' => '59.25', 'width' => '21', 'height' => '3.5', 'fill' => '#d0d0d0'] + self::NOTE,
        ], $rects, 'the board colour first, then the entries in their order');
        foreach (['Confidential', 'Secret', 'Hidden', 'aabbcc', '#ff0000'] as $word) {
            $this->assertStringNotContainsStringIgnoringCase($word, $svg);
        }
    }

    public function testJob236Ak5OnlyEntriesOfTheFormAtMost40(): void {
        $svg = BoardSketch::svg([
            [0, 0, 10, 10, '"><script>alert(1)</script>'],
            [0, 0, 10, 10, '#abc'],
            [121, 0, 1, 1, ''],
            [0, 81, 1, 1, ''],
            [-1, 0, 1, 1, ''],
            [0, 0, 1, 1],
            [0, 0, 1, 1, '', 'extra'],
            ['1', 0, 1, 1, ''],
            [0, 0, NAN, 1, ''],
            [0, 0, INF, 1, ''],
            ['x' => 0, 'y' => 0, 'w' => 1, 'h' => 1, 'fill' => ''],
            'a string',
            null,
            [0, 0, 1, 1, null],
            [1.5, 2, 120, 80, '#ABCDEF'],
        ]);
        [, $rects] = self::parse($svg);
        $this->assertSame([self::BG, ['x' => '1.5', 'y' => '2', 'width' => '120', 'height' => '80', 'fill' => '#abcdef'] + self::NOTE], $rects,
            'only the last entry; its colour in lower case');
        $this->assertStringNotContainsString('script', $svg);

        [, $rects] = self::parse(BoardSketch::svg([]));
        $this->assertSame([self::BG], $rects, 'an empty sketch: only the board colour');

        $many = [];
        for ($i = 0; $i < 41; $i++) {
            $many[] = [119.99, 79.99, 119.99, 79.99, $i % 2 === 0 ? '' : '#123456'];
        }
        [, $rects] = self::parse(BoardSketch::svg($many));
        $this->assertCount(41, $rects, 'the board colour and at most 40 entries');
        $url = 'data:image/svg+xml;base64,' . base64_encode(BoardSketch::svg(array_slice($many, 0, 40)));
        $this->assertLessThan(8192, strlen($url), 'the card\'s picture stays below 8 KiB');
    }

    public function testJob236Ak2ConnectorsOnlyIsEmptyOfBoardReadsNoRights(): void {
        $h = new AccessHarness();
        $sketches = $h->sketches(new ItemStore($this->db->connection()));
        $this->item('01C', 'connector', 0, 0, 0, 0);
        $this->assertSame([], $sketches->ofBoard($this->board), 'connectors only: no sketch, the card keeps its symbol');
        $this->assertSame([], $h->mem->log, 'no rights asked, nothing cached');
    }

    // --- route 57 -----------------------------------------------------------

    /** @return array{0: int, 1: mixed} */
    private static function out(Response $r): array {
        self::assertInstanceOf(JSONResponse::class, $r);
        return [$r->getStatus(), $r->getData()];
    }

    public function testAk3RouteForEveryRoleSame404OtherwiseNoItemRead(): void {
        $h = new AccessHarness();
        $b = $h->service->create('alice', 'A')['id'];
        $h->shareRows->add($b, 'user', 'bob', 'view');
        $items = new class(Fake::of(IDBConnection::class)) extends ItemStore {
            /** @var list<string> */
            public array $reads = [];

            public function sketchBoxes(int $board): array {
                $this->reads[] = "boxes $board";
                return [['id' => '01N', 'type' => 'sticky', 'parent_id' => null, 'x' => 0, 'y' => 0, 'w' => 200, 'h' => 200]];
            }

            public function stylesOf(int $board, array $ids): array {
                $this->reads[] = "styles $board";
                return ['01N' => '{"fill":"#ffeb3b"}'];
            }
        };
        $api = function (int $id) use ($h, $items): BoardApiController {
            $params = ['id' => (string)$id];
            $request = Fake::of(IRequest::class, [
                'getHeader' => fn (string $name): string => '',
                'getParams' => fn (): array => $params,
                'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
                'getRemoteAddress' => fn (): string => '10.0.0.1',
            ], ['urlParams' => $params]);
            $session = Fake::of(IUserSession::class, ['getUser' => fn () => $h->uid === null ? null : $h->user($h->uid)]);
            return new BoardApiController($request, $h->service, $session, Fake::of(ILimiter::class), PageControllerTest::limits(),
                Fake::of(LoggerInterface::class), $h->sketches($items));
        };

        $h->uid = 'carol';
        $stranger = self::out($api($b)->sketch($b));
        $unknown = self::out($api(999999)->sketch(999999));
        $this->assertSame(404, $stranger[0]);
        $this->assertSame($stranger, $unknown, 'no access and no such board look the same');
        $this->assertSame('not_found', $stranger[1]['error']);
        $this->assertSame([], $items->reads, 'no item read without access');

        $h->uid = null;
        $this->assertSame(401, self::out($api($b)->sketch($b))[0]);
        $this->assertSame([], $items->reads);

        $h->uid = 'bob';
        $this->assertEquals([200, ['sketch' => [[24, 4, 72, 72, '#ffeb3b']]]], self::out($api($b)->sketch($b)), 'a viewer gets the sketch');
        $this->assertSame(["boxes $b", "styles $b"], $items->reads);
    }
}
