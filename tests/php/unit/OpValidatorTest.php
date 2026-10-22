<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\OpValidator;
use OCA\Knorke\Service\Principal;
use OCA\Knorke\Service\Role;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Generic op validation (SPEC-M0 §4.6, §4.8) — every rule positive and negative. */
final class OpValidatorTest extends TestCase {
    private const ID = '01JA2B3C4D5E6F7G8H9J0KMNPQ';
    private const F = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D';

    private static function editor(Role $role = Role::Edit): Principal {
        return new Principal('u:alice', $role, 'Alice', '3f9a1c0b7d2e4a51', false, 'alice', $role === Role::Owner ? 'owner' : 'link');
    }

    private static function put(array $p = [], string $t = 'sticky', array $extra = []): array {
        return ['o' => 'put', 'id' => self::ID, 't' => $t,
            'p' => $p + ['x' => 100, 'y' => 40, 'w' => 200, 'h' => 200, 'r' => 0, 'z' => 'i1', 'parent' => null,
                'data' => ['text' => ''], 'style' => ['fill' => '#a8d8f8']]] + $extra;
    }

    private static function patch(array $p): array {
        return ['o' => 'patch', 'id' => self::ID, 'p' => $p];
    }

    private static function norm(mixed $op, Role $role = Role::Edit): array {
        return OpValidator::normalize(self::editor($role), $op);
    }

    public function testPutNormalizes(): void {
        $n = self::norm(self::put(['style' => ['fill' => '#A8D8F8']]));
        $this->assertSame('put', $n['o']);
        $this->assertFalse($n['revive']);
        $this->assertSame(['t' => 'sticky', 'x' => 100.0, 'y' => 40.0, 'w' => 200.0, 'h' => 200.0, 'r' => 0.0, 'z' => 'i1',
            'parent' => null, 'data' => ['text' => ''], 'style' => ['fill' => '#a8d8f8'], 'group' => null], $n['item']);
    }

    public function testPutDefaults(): void {
        $n = self::norm(['o' => 'put', 'id' => self::ID, 't' => 'frame', 'p' => ['w' => 800, 'h' => 600, 'z' => 'hz']]);
        $this->assertSame(['t' => 'frame', 'x' => 0.0, 'y' => 0.0, 'w' => 800.0, 'h' => 600.0, 'r' => 0.0, 'z' => 'hz',
            'parent' => null, 'data' => [], 'style' => [], 'group' => null], $n['item']);
        $this->assertTrue(self::norm(self::put([], 'sticky', ['revive' => true]))['revive']);
        $this->assertFalse(self::norm(self::put([], 'sticky', ['revive' => 1]))['revive'], 'revive must be exactly true');
    }

    public static function badOps(): array {
        $longText = str_repeat('a', 6001);
        return [
            'not an object' => ['nope'],
            'list' => [[1, 2]],
            'unknown o' => [['o' => 'move', 'id' => self::ID]],
            'id lower case' => [['o' => 'remove', 'id' => strtolower(self::ID)]],
            'id with I' => [['o' => 'remove', 'id' => '01JA2B3C4D5E6F7G8H9J0KMNPI']],
            'id array' => [['o' => 'remove', 'id' => [self::ID]]],
            'put unknown type' => [self::put([], 'pen')],
            'put type array' => [['o' => 'put', 'id' => self::ID, 't' => ['sticky'], 'p' => ['z' => 'i1', 'w' => 50, 'h' => 50]]],
            'put without z' => [['o' => 'put', 'id' => self::ID, 't' => 'sticky', 'p' => ['w' => 50, 'h' => 50]]],
            'put invalid z' => [self::put(['z' => 'a'])],
            'put z upper case' => [self::put(['z' => 'i0V'])],
            'put p list' => [['o' => 'put', 'id' => self::ID, 't' => 'sticky', 'p' => [1, 2]]],
            'put x string' => [self::put(['x' => '100'])],
            'put x bool' => [self::put(['x' => true])],
            'put x too far' => [self::put(['x' => 1.0e7 + 1])],
            'put w negative' => [self::put(['w' => -1])],
            'put r over 360' => [self::put(['r' => 361])],
            'put frame rotated' => [self::put(['r' => 5, 'w' => 800, 'h' => 600], 'frame')],
            'put frame with parent' => [self::put(['parent' => self::F, 'w' => 800, 'h' => 600], 'frame')],
            'put sticky too small' => [self::put(['w' => 10])],
            'put sticky too big' => [self::put(['h' => 2001])],
            'put parent not ulid' => [self::put(['parent' => 'abc'])],
            'put data list' => [self::put(['data' => ['a', 'b']])],
            'put data key' => [self::put(['data' => ['9a' => 1]])],
            'put text too long' => [self::put(['data' => ['text' => $longText]])],
            'put text not string' => [self::put(['data' => ['text' => ['x' => 1]]])],
            'put color' => [self::put(['style' => ['fill' => 'red']])],
            'put fontSize' => [self::put(['style' => ['fill' => '#ffffff', 'fontSize' => 300]])],
            'put bad utf8' => [self::put(['data' => ['text' => "\xff\xfe"]])],
            'put value list with null' => [self::put(['data' => ['l' => [1, null]]])],
            'patch empty' => [self::patch([])],
            'patch list' => [['o' => 'patch', 'id' => self::ID, 'p' => [1]]],
            'patch too many paths' => [self::patch(array_combine(array_map(static fn ($i) => 'data.k' . $i, range(1, 51)), range(1, 51)))],
            'patch unknown root' => [self::patch(['foo' => 1])],
            'patch data alone' => [self::patch(['data' => ['a' => 1]])],
            'patch five levels' => [self::patch(['data.a.b.c.d.e' => 1])],
            'patch bad key' => [self::patch(['data.a b' => 1])],
            'patch numeric key' => [self::patch(['data.1' => 1])],
            'patch x only' => [self::patch(['x' => 1])],
            'patch parent only' => [self::patch(['parent' => null])],
            'patch x y only' => [self::patch(['x' => 1, 'y' => 2])],
            'patch x null' => [self::patch(['x' => null, 'y' => 1, 'parent' => null])],
            'patch z invalid' => [self::patch(['z' => 'a'])],
            'patch w negative' => [self::patch(['w' => -5])],
            'patch nested numeric key' => [self::patch(['data.n' => ['a' => ['1' => 'x']]])],
            'patch list element {}' => [self::patch(['data.l' => [1, []]])],
            'patch depth 7' => [self::patch(['data.d' => ['a' => ['b' => ['c' => ['d' => ['e' => ['f' => ['g' => 1]]]]]]]])],
            'patch long generic string' => [self::patch(['data.foo' => str_repeat('x', 6001)])],
            'patch nested long string' => [self::patch(['data.foo' => ['a' => str_repeat('x', 6001)]])],
        ];
    }

    #[DataProvider('badOps')]
    public function testBad(mixed $op): void {
        $this->assertSame(['o' => 'bad'], self::norm($op));
    }

    public function testViewRoleIsDenied(): void {
        $this->assertSame(['o' => 'denied'], self::norm(self::put(), Role::View));
        $this->assertSame(['o' => 'denied'], self::norm(self::patch(['style.fill' => '#ffffff']), Role::View));
        $this->assertSame(['o' => 'denied'], self::norm(['o' => 'remove', 'id' => self::ID], Role::Vote));
        // Shape first: a broken op stays bad for every role.
        $this->assertSame(['o' => 'bad'], self::norm(['o' => 'remove', 'id' => 'x'], Role::View));
        $this->assertSame('remove', self::norm(['o' => 'remove', 'id' => self::ID], Role::Owner)['o']);
    }

    public function testPatchCleaning(): void {
        $n = self::norm(self::patch([
            'x' => 340, 'y' => -1.5, 'parent' => self::F,
            'data.text' => "a\r\nb\x00c\x07d\te\rf",
            'data.foo.bar' => [1, ['a' => 2]],
            'data.tag' => null, 'data.e' => [], 'style.fill' => '#FFCC00', 'z' => 'i0i', 'r' => 12.5,
        ]));
        $this->assertSame('patch', $n['o']);
        $this->assertSame(340.0, $n['p']['x']);
        $this->assertSame(-1.5, $n['p']['y']);
        $this->assertSame(self::F, $n['p']['parent']);
        $this->assertSame("a\nbcd\tef", $n['p']['data.text'], '\r\n → \n, NUL and C0 except \t\n removed (lone \r too)');
        $this->assertSame([1, ['a' => 2]], $n['p']['data.foo.bar']);
        $this->assertNull($n['p']['data.tag']);
        $this->assertSame([], $n['p']['data.e']);
        $this->assertSame('#FFCC00', $n['p']['style.fill'], 'typed rules run under the lock (ItemRegistry::checkPatch)');
    }

    public function testPlacementGroupComplete(): void {
        $this->assertSame('patch', self::norm(self::patch(['x' => 1, 'y' => 2, 'parent' => null]))['o']);
        $this->assertSame('patch', self::norm(self::patch(['style.fill' => '#000000']))['o']);
    }

    public function testFalseAndZeroAreValues(): void {
        $n = self::norm(self::patch(['data.flag' => false, 'data.n' => 0, 'data.s' => '']));
        $this->assertSame(['data.flag' => false, 'data.n' => 0, 'data.s' => ''], $n['p']);
    }

    public function testGoldenValuesThroughThePatchPath(): void {
        $g = json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/fixtures/paths-golden.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($g['values'] as $c) {
            $n = self::norm(self::patch(['data.v' => $c['value']]));
            $this->assertSame($c['ok'] ? 'patch' : 'bad', $n['o'], $c['name']);
        }
    }

    public function testSixThousandFourByteCharactersFit(): void {
        foreach (['漢', '😀', '<'] as $ch) {
            $n = self::norm(self::put(['data' => ['text' => str_repeat($ch, 6000)]]));
            $this->assertSame('put', $n['o'], 'text of 6000 × ' . $ch);
        }
    }

    public function testTouchesTextPath(): void {
        $this->assertTrue(OpValidator::touchesTextPath([self::patch(['data.text' => 'x'])]));
        $this->assertTrue(OpValidator::touchesTextPath([['o' => 'remove', 'id' => self::ID], self::patch(['data.title' => 'x'])]));
        $this->assertFalse(OpValidator::touchesTextPath([self::patch(['style.fill' => '#000000'])]));
        $this->assertFalse(OpValidator::touchesTextPath([self::put()]), 'put never needs the lease');
        $this->assertFalse(OpValidator::touchesTextPath(['junk', ['o' => 'patch', 'p' => 'x']]));
    }

    public function testKeepIsTheLiteralTrue(): void {
        // SPEC-M1 §4.6: patch flag keep, only the literal true; ignored by put/remove.
        $this->assertTrue(self::norm(self::patch(['w' => 900.0]) + ['keep' => true])['keep']);
        foreach ([1, 'true', [true], null, false] as $v) {
            $this->assertFalse(self::norm(self::patch(['w' => 900.0]) + ['keep' => $v])['keep'], var_export($v, true));
        }
        $this->assertFalse(self::norm(self::patch(['w' => 900.0]))['keep'], 'absent → false');
        $this->assertArrayNotHasKey('keep', self::norm(self::put() + ['keep' => true]));
    }

    public function testStageOneTypesAndLabelLease(): void {
        // shape, text and connector are put types since stage 1 (C06 → pen);
        // data.label is a text path of the lease (SPEC-M1 §4.8).
        $this->assertSame('put', self::norm(['o' => 'put', 'id' => self::ID, 't' => 'shape', 'p' => ['z' => 'i1', 'w' => 10, 'h' => 10, 'data' => ['kind' => 'ellipse']]])['o']);
        $this->assertSame('put', self::norm(['o' => 'put', 'id' => self::ID, 't' => 'text', 'p' => ['z' => 'i1', 'w' => 240, 'h' => 31.2]])['o']);
        $c = self::norm(['o' => 'put', 'id' => self::ID, 't' => 'connector', 'p' => ['z' => 'i1', 'data' => ['start' => ['item' => self::F, 'ax' => 0.33333, 'ay' => 0], 'end' => ['x' => 1, 'y' => 2]]]]);
        $this->assertSame('put', $c['o']);
        $this->assertSame(['start' => ['item' => self::F, 'ax' => 0.3333, 'ay' => 0.0], 'end' => ['x' => 1.0, 'y' => 2.0]], $c['item']['data'], 'ends normalized before the lock');
        $this->assertSame('bad', self::norm(['o' => 'put', 'id' => self::ID, 't' => 'connector', 'p' => ['z' => 'i1', 'x' => 3, 'data' => ['start' => ['item' => self::F], 'end' => ['x' => 1, 'y' => 2]]]])['o']);
        $this->assertSame('bad', self::norm(['o' => 'put', 'id' => self::ID, 't' => 'pen', 'p' => ['z' => 'i1']])['o']);
        $this->assertTrue(OpValidator::touchesTextPath([self::patch(['data.label' => 'ja'])]));
    }

    public function testVoteOp(): void {
        // SPEC-M1 §4.6, §4.13.2 step 2: s ≥ 1, id a ULID, n 0–99 (whole
        // numbers; 2.0 counts), then canVote(); other keys ignored.
        $vote = static fn (array $extra = []): array => $extra + ['o' => 'vote', 's' => 12, 'id' => self::ID, 'n' => 2];
        foreach ([Role::Owner, Role::Edit, Role::Vote] as $role) {
            $this->assertSame(['o' => 'vote', 's' => 12, 'id' => self::ID, 'n' => 2],
                OpValidator::normalizeVote(self::editor($role), $vote(['x' => 1, 'p' => []])), $role->value);
        }
        $this->assertSame(['o' => 'denied'], OpValidator::normalizeVote(self::editor(Role::View), $vote()), 'view may not vote');
        $this->assertSame(['o' => 'vote', 's' => 3, 'id' => self::ID, 'n' => 0],
            OpValidator::normalizeVote(self::editor(), ['o' => 'vote', 's' => 3.0, 'id' => self::ID, 'n' => 0.0]));
        $this->assertSame(99, OpValidator::normalizeVote(self::editor(), $vote(['n' => 99]))['n']);
        foreach ([
            's 0' => ['s' => 0], 's -1' => ['s' => -1], 's text' => ['s' => '12'], 's fraction' => ['s' => 1.5], 's null' => ['s' => null],
            'n 100' => ['n' => 100], 'n -1' => ['n' => -1], 'n text' => ['n' => '2'], 'n bool' => ['n' => true], 'n 0.5' => ['n' => 0.5],
            'id lower case' => ['id' => strtolower(self::ID)], 'id short' => ['id' => '01JA'], 'id number' => ['id' => 7],
        ] as $case => $bad) {
            $this->assertSame(['o' => 'bad'], OpValidator::normalizeVote(self::editor(), $bad + $vote()), $case);
            $this->assertSame(['o' => 'bad'], OpValidator::normalizeVote(self::editor(Role::View), $bad + $vote()), "$case: the form before the role");
        }
        $this->assertSame(['o' => 'bad'], OpValidator::normalizeVote(self::editor(), ['o' => 'vote', 's' => 1, 'id' => self::ID]), 'n missing');
        $this->assertTrue(OpValidator::isVote($vote()));
        $this->assertFalse(OpValidator::isVote(self::put()));
        $this->assertFalse(OpValidator::isVote('vote'));
        // The object path never takes a vote op (it would be bad there).
        $this->assertSame('bad', self::norm($vote())['o']);
    }

    /**
     * M2 data foundation, followed up by job 026 (group items): a put never
     * sets a lock; a value for it is bad ("", {}, false and 0 too), null or no
     * key sets nothing and the item never carries it. A group is null or a
     * ULID (testGroupWireForm); a put with any other group value is bad, null
     * or no key gives group null. Other spellings stay unknown keys; the
     * patch paths group.x, lock.by and lock.name are no valid paths (the path
     * `lock` itself is the lock op of job 023, testLockPatch; the path
     * `group` is the group register of job 026); the role is checked first.
     */
    public function testGroupAndLockCannotBeSet(): void {
        foreach (['', [], false, 0, '01ja2b3c4d5e6f7g8h9j0kmnpq'] as $v) {
            $this->assertSame(['o' => 'bad'], self::norm(self::put(['group' => $v])), 'put group ' . json_encode($v));
        }
        foreach ([['by' => 'x'], ['name' => 'x'], true, [], 0, ''] as $v) {
            $this->assertSame(['o' => 'bad'], self::norm(self::put(['lock' => $v])), 'put lock ' . json_encode($v));
        }
        $this->assertSame(['o' => 'bad'], self::norm(self::put(['group' => null, 'lock' => ['by' => null, 'name' => null]])), 'lock {by: null, name: null} is a value');
        $want = self::norm(self::put());
        $this->assertSame('put', $want['o']);
        foreach ([['group' => null], ['lock' => null], ['group' => null, 'lock' => null],
            ['group_id' => 'G', 'locked' => 1, 'lockedBy' => 'u:x', 'locked_by' => 'u:x', 'lockedName' => 'X', 'locked_name' => 'X']] as $extra) {
            $n = self::norm(self::put($extra));
            $this->assertSame($want, $n, 'put with ' . json_encode($extra) . ': the same item as without');
            $this->assertNull($n['item']['group']);
            $this->assertArrayNotHasKey('lock', $n['item']);
        }
        $this->assertSame(['t', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style', 'group'], array_keys($want['item']));
        foreach (['lock.by', 'lock.name', 'group.x'] as $path) {
            foreach (['01JA2B3C4D5E6F7G8H9J0KMNPQ', null, ['by' => 'x']] as $v) {
                $this->assertSame(['o' => 'bad'], self::norm(self::patch([$path => $v])), "patch $path = " . json_encode($v));
            }
        }
        $this->assertSame(['o' => 'bad'], self::norm(self::patch(['group' => ['by' => 'x']])), 'patch group = a map');
        $this->assertSame(['o' => 'bad'], self::norm(self::patch(['lock' => '01JA2B3C4D5E6F7G8H9J0KMNPQ'])), 'patch lock = a string');
        $this->assertSame(['o' => 'denied'], self::norm(self::put(['group' => 'G']), Role::View), 'the role first: view is denied');
        $this->assertSame(['o' => 'denied'], self::norm(self::put(['lock' => true]), Role::Vote));
    }

    /**
     * AK1 (job 026, group items): the wire form of `group`. put p.group is
     * null/missing or a ULID (the item carries it), every other value is
     * bad; the patch path `group` takes only null and a ULID, beside other
     * paths too (its own register) but never beside `lock`; group.<k> is
     * no path; vote and view are denied first.
     */
    public function testGroupWireForm(): void {
        $g = '01JA2B3C4D5E6F7G8H9J0KMNPQ';
        $n = self::norm(self::put(['group' => $g]));
        $this->assertSame('put', $n['o']);
        $this->assertSame($g, $n['item']['group']);
        $this->assertNull(self::norm(self::put())['item']['group'], 'no key: null');
        $this->assertNull(self::norm(self::put(['group' => null]))['item']['group']);
        $bad = ['', strtolower($g), $g . 'A', substr($g, 0, 25), 'ÄÖÜÄÖÜÄÖÜÄÖÜÄÖÜÄÖÜÄÖÜÄÖÜÄÖ', 5, true, [], ['a' => 1], "01JA2B3C4D5E6F7G8H9J0KMNP\n", 5.0];
        $this->assertSame(26, mb_strlen($bad[4]), 'the umlaut id has 26 characters');
        foreach ($bad as $v) {
            $this->assertSame(['o' => 'bad'], self::norm(self::put(['group' => $v])), 'put group ' . json_encode($v));
        }
        // JSON {} and [] (both [] after json_decode(…, true)), and an object
        foreach (['{}', '[]', '{"a":1}'] as $json) {
            $raw = json_decode('{"o":"put","id":"' . self::ID . '","t":"sticky","p":{"z":"i1","w":200,"h":200,"group":' . $json . '}}', true);
            $this->assertSame(['o' => 'bad'], self::norm($raw), 'put group ' . $json);
        }
        $this->assertSame(['o' => 'patch', 'id' => self::ID, 'p' => ['group' => $g], 'keep' => false], self::norm(self::patch(['group' => $g])));
        $this->assertSame(['o' => 'patch', 'id' => self::ID, 'p' => ['group' => null], 'keep' => false], self::norm(self::patch(['group' => null])));
        $this->assertSame(['o' => 'patch', 'id' => self::ID, 'p' => ['group' => $g, 'z' => 'i1'], 'keep' => false], self::norm(self::patch(['group' => $g, 'z' => 'i1'])));
        foreach ([['group' => ''], ['group' => []], ['group' => 7], ['group' => true], ['group.a' => 'x'], ['group' => $g, 'lock' => null],
            ['group' => strtolower($g)], ['group' => ['a' => 1]]] as $p) {
            $this->assertSame(['o' => 'bad'], self::norm(self::patch($p)), 'patch ' . json_encode($p));
        }
        $raw = json_decode('{"o":"patch","id":"' . self::ID . '","p":{"group":{}}}', true);
        $this->assertSame(['o' => 'bad'], self::norm($raw), 'patch group {}');
        foreach ([Role::Vote, Role::View] as $role) {
            $this->assertSame(['o' => 'denied'], self::norm(self::put(['group' => $g]), $role), $role->value . ' put');
            $this->assertSame(['o' => 'denied'], self::norm(self::patch(['group' => $g]), $role), $role->value . ' patch');
            $this->assertSame(['o' => 'denied'], self::norm(self::patch(['group' => 'x']), $role), $role->value . ': the role before the form');
        }
        $this->assertTrue(OpValidator::isGroupId(null));
        $this->assertTrue(OpValidator::isGroupId($g));
        $this->assertFalse(OpValidator::isGroupId('G'));
    }

    /**
     * AK1 (job 023, lock items): the patch path `lock` is the lock op. A
     * non-empty object locks (its content is never read), null, {} and []
     * unlock; any other value, `lock` beside another path and the sub-paths
     * are bad; keep is ignored; vote and view are denied first.
     */
    public function testLockPatch(): void {
        $lock = ['o' => 'lock', 'id' => self::ID, 'on' => true];
        $unlock = ['o' => 'lock', 'id' => self::ID, 'on' => false];
        $this->assertSame($lock, self::norm(self::patch(['lock' => ['by' => 'x', 'name' => 'N']])));
        $this->assertSame($lock, self::norm(['o' => 'patch', 'id' => self::ID, 'p' => ['lock' => ['by' => 'someone-else']], 'keep' => true]), 'keep ignored, the content is not read');
        $this->assertSame($lock, self::norm(self::patch(['lock' => ['by' => null, 'name' => null]])), 'a non-empty object');
        $this->assertSame($lock, self::norm(self::patch(['lock' => ['by' => 'x', 'name' => str_repeat('😀', 10)]]), Role::Owner));
        foreach ([null, [], new \stdClass()] as $v) {
            $raw = json_decode(json_encode(['o' => 'patch', 'id' => self::ID, 'p' => ['lock' => $v]]), true);
            $this->assertSame($unlock, self::norm($raw), 'unlock with ' . json_encode($v));
        }
        $bad = [
            ['lock' => true], ['lock' => false], ['lock' => 0], ['lock' => 'x'], ['lock' => ['a']], ['lock' => ['1a' => 1]],
            ['lock' => ['by' => 'x'], 'x' => 1, 'y' => 1, 'parent' => null],
            ['lock' => null, 'style.fill' => '#ffffff'],
            ['lock.by' => 'x'],
            ['lock' => ['by' => "\xff"]],
            ['lock' => ['by' => str_repeat('a', 6001)]],
        ];
        foreach ($bad as $p) {
            $this->assertSame(['o' => 'bad'], self::norm(self::patch($p)), 'bad: ' . json_encode($p));
        }
        foreach ([Role::Vote, Role::View] as $role) {
            $this->assertSame(['o' => 'denied'], self::norm(self::patch(['lock' => ['by' => 'x', 'name' => 'N']]), $role), $role->value . ' locks');
            $this->assertSame(['o' => 'denied'], self::norm(self::patch(['lock' => null]), $role), $role->value . ' unlocks');
        }
        foreach ([Role::Owner, Role::Edit] as $role) {
            $this->assertSame($unlock, self::norm(self::patch(['lock' => null]), $role));
        }
        // the 022 put rules stay
        $this->assertSame(['o' => 'bad'], self::norm(self::put(['lock' => ['by' => 'x']])));
        $this->assertSame(['o' => 'bad'], self::norm(self::put(['group' => 'G'])));
        $this->assertFalse(OpValidator::touchesTextPath([self::patch(['lock' => ['by' => 'x']])]), 'no text path: no presence read for a lock');
    }
}
