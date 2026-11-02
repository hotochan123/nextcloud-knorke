<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * Factory job 251 AK3: a guest token is bound to board, role and the
 * generation of that link role, not to the link id. So every place that
 * revokes or renews a link must bump that generation (lockBoard(…, true,
 * $role)) or delete the board. This test runs each of today's places and
 * checks that a guest token from before is refused afterwards (fast and
 * full path), and a source guard makes a new revokeLinks() call site
 * without a bump in the same method fail.
 */
final class LinkRevokeGuestTest extends TestCase {
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'A')['id'];
    }

    /** A valid guest token of the current $role link generation. */
    private function guestOf(string $role): string {
        $row = $this->h->boards->boards[$this->b];
        $t = $this->h->token($this->b, $role === 'edit' ? $row['link_gen'] : $row['vote_link_gen'], $role, $role === 'edit' ? 'gEDIT0000001' : 'gVOTE0000001');
        $this->h->access->forGuest($t, $this->b);
        $this->h->access->forGuest($t, $this->b, true);
        return $t;
    }

    private function assertRefused(string $token, string $what): void {
        foreach ([false, true] as $full) {
            try {
                $this->h->access->forGuest($token, $this->b, $full);
                $this->fail("$what: the old guest token still works (full: " . ($full ? 'yes' : 'no') . ')');
            } catch (HttpError $e) {
                $this->assertContains($e->status, [401, 403, 404], "$what: " . $e->error);
            }
        }
    }

    /** @return array<string, array{0: string, 1: \Closure(self): void}> */
    public static function places(): array {
        $on = static fn (self $t, string $role, array $body = []) => $t->h->service->enableLink('alice', $t->b, $role, $body);
        return [
            'renew edit' => ['edit', static fn (self $t) => $on($t, 'edit', ['rotate' => true])],
            'renew vote' => ['vote', static fn (self $t) => $on($t, 'vote', ['rotate' => true])],
            'switch edit off' => ['edit', static fn (self $t) => $t->h->service->disableLink('alice', $t->b, 'edit')],
            'switch vote off' => ['vote', static fn (self $t) => $t->h->service->disableLink('alice', $t->b, 'vote')],
            'set a password' => ['edit', static fn (self $t) => $on($t, 'edit', ['password' => 'pw-one'])],
            'expiry earlier' => ['vote', static fn (self $t) => $on($t, 'vote', ['expiresAt' => '2025-10-20'])],
            'delete the board' => ['edit', static fn (self $t) => $t->h->service->delete('alice', $t->b)],
            'delete the owner' => ['vote', static fn (self $t) => $t->h->service->onUserDeleted('alice')],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('places')]
    public function testEveryRevokeOrRenewRefusesOldGuestTokens(string $role, \Closure $act): void {
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->h->service->enableLink('alice', $this->b, 'vote', []);
        $token = $this->guestOf($role);
        $act($this);
        $this->assertRefused($token, $role);
    }

    public function testRenewingAnExpiredLinkRefusesOldGuestTokens(): void {
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $token = $this->guestOf('edit');
        $link = $this->h->boards->activeLinkOf($this->b, 'edit');
        $this->h->boards->links[$link['id']]['expires_at'] = $this->h->nowMs() - 1;
        $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->assertNotSame($link['token'], $this->h->boards->activeLinkOf($this->b, 'edit')['token'], 'renewed');
        $this->assertRefused($token, 'renew expired');
    }

    // ── source guard ────────────────────────────────────────────────────────

    /**
     * Methods of $src that call ->revokeLinks( without a generation bump
     * (lockBoard( with true as second argument) in the same method.
     *
     * @return list<string>
     */
    private static function unbumped(string $src): array {
        $out = [];
        if (preg_match_all('/function\s+(\w+)\s*\(/', $src, $m, PREG_OFFSET_CAPTURE) === 0) {
            return [];
        }
        $starts = array_column($m[0], 1);
        foreach ($starts as $i => $start) {
            $body = substr($src, $start, ($starts[$i + 1] ?? strlen($src)) - $start);
            if (str_contains($body, '->revokeLinks(') && preg_match('/->lockBoard\([^,()]+,\s*true\s*,/', $body) !== 1) {
                $out[] = $m[1][$i][0];
            }
        }
        return $out;
    }

    public function testEveryRevokeLinksCallSiteBumpsAGeneration(): void {
        $root = dirname(__DIR__, 3) . '/lib';
        $sites = 0;
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->getExtension() !== 'php' || str_ends_with($f->getPathname(), '/Db/BoardStore.php')) {
                continue;
            }
            $src = (string)file_get_contents($f->getPathname());
            $sites += substr_count($src, '->revokeLinks(');
            $this->assertSame([], self::unbumped($src), $f->getPathname() . ': revokeLinks() without lockBoard(…, true, …) in the same method');
        }
        $this->assertGreaterThanOrEqual(3, $sites, 'the call sites were found');
    }

    public function testTheGuardCatchesAMissingBump(): void {
        $bad = 'class X { function a() { $this->boards->lockBoard($b, false, null, $now); $this->boards->revokeLinks($b, $now, $r); } '
            . 'function b() { $this->boards->lockBoard($b, true, $role, $now); $this->boards->revokeLinks($b, $now, $role); } }';
        $this->assertSame(['a'], self::unbumped($bad));
    }
}
