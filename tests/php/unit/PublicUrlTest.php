<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Service\BoardService;
use OCA\Knorke\Tests\Support\AccessHarness;
use PHPUnit\Framework\TestCase;

/**
 * Link URLs from the app config public_url (P7, SPEC-M1 §33.1 a/h, OPS-2,
 * user decision U-LINKHOST; C83 in small): a valid origin
 * http(s)://host[:port] with at most one trailing "/" → url =
 * rtrim(public_url, "/") + the route path (linkToRoute), exactly one "/" in
 * between; unset, empty or invalid → linkToRouteAbsolute (the request's
 * host), an invalid value logging at most one warning per PHP process;
 * overwrite.cli.url is never read.
 */
final class PublicUrlTest extends TestCase {
    private const ABSOLUTE = 'https://cloud.example/index.php/apps/knorke/p/';
    private AccessHarness $h;
    private int $b;

    protected function setUp(): void {
        $this->h = new AccessHarness();
        $this->b = $this->h->service->create('alice', 'A')['id'];
        (new \ReflectionProperty(BoardService::class, 'publicUrlWarned'))->setValue(null, false);
    }

    /** @return array{edit: string, vote: string} the urls of route 19 / board.links */
    private function urls(): array {
        $links = $this->h->service->links($this->b, 'alice');
        return ['edit' => $links['edit']['url'], 'vote' => $links['vote']['url']];
    }

    public function testWithoutTheKeyTheRequestHost(): void {
        $edit = $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->h->service->enableLink('alice', $this->b, 'vote', []);
        $this->assertSame(self::ABSOLUTE . $edit['token'], $edit['url']);
        $this->assertStringStartsWith(self::ABSOLUTE, $this->urls()['vote']);
        $this->h->appValues['public_url'] = '';
        $this->assertSame(self::ABSOLUTE . $edit['token'], $this->urls()['edit'], 'empty = unset');
        $this->assertSame([], $this->h->warnings);
    }

    public function testAValidOriginReplacesTheHost(): void {
        $edit = $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $vote = $this->h->service->enableLink('alice', $this->b, 'vote', []);
        foreach (['https://knorke-harness.example.org/', 'https://knorke-harness.example.org', 'HTTPS://knorke-harness.example.org'] as $origin) {
            $this->h->appValues['public_url'] = $origin;
            $this->assertSame([
                'edit' => rtrim($origin, '/') . '/index.php/apps/knorke/p/' . $edit['token'],
                'vote' => rtrim($origin, '/') . '/index.php/apps/knorke/p/' . $vote['token'],
            ], $this->urls(), $origin);
        }
        $this->h->appValues['public_url'] = 'https://knorke-harness.example.org/';
        $again = $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->assertSame('https://knorke-harness.example.org/index.php/apps/knorke/p/' . $edit['token'], $again['url'], 'route 9 answer, unchanged link');
        foreach (['http://10.0.0.5:8080/', 'https://[2001:db8::1]:8443', 'http://localhost'] as $origin) {
            $this->h->appValues['public_url'] = $origin;
            $this->assertSame(rtrim($origin, '/') . '/index.php/apps/knorke/p/' . $edit['token'], $this->urls()['edit'], $origin);
        }
        $this->assertSame([], $this->h->warnings);
    }

    public function testInvalidValuesFallBackWithOneWarningPerProcess(): void {
        $edit = $this->h->service->enableLink('alice', $this->b, 'edit', []);
        $this->h->service->enableLink('alice', $this->b, 'vote', []);
        foreach (['knorke-harness.example.org', 'ftp://knorke-harness.example.org', 'https://knorke-harness.example.org/x',
            'https://knorke-harness.example.org//', 'https://user:pw@knorke-harness.example.org', 'https://knorke-harness.example.org?x=1',
            'https://knorke-harness.example.org/#a', 'https://knorke-harness.example.org:0', 'https://knorke-harness.example.org:65536',
            'https://[nope]:443', ' https://knorke-harness.example.org', "https://knorke-harness.example.org\n", 'https://'] as $bad) {
            $this->h->appValues['public_url'] = $bad;
            $this->assertSame(self::ABSOLUTE . $edit['token'], $this->urls()['edit'], 'invalid → the request host: ' . json_encode($bad));
            $this->assertFalse(BoardService::validPublicUrl($bad), json_encode($bad));
        }
        $this->assertCount(1, $this->h->warnings, 'at most one warning per PHP process, never an error');
        $this->assertStringContainsString('public_url', $this->h->warnings[0]);
        unset($this->h->appValues['public_url']);
        $this->assertSame(self::ABSOLUTE . $edit['token'], $this->urls()['edit'], 'deleted → as before');
    }
}
