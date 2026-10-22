<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Http\RawJsonResponse;
use OCP\AppFramework\Http\JSONResponse;
use PHPUnit\Framework\TestCase;

/** gzip by Nextcloud's CompressionMiddleware needs a JSONResponse (SPEC-M0 §4.2). */
final class RawJsonResponseTest extends TestCase {
    public function testIsAJsonResponseRenderingVerbatim(): void {
        $json = '{"rev":42,"items":[{"id":"x","data":{}}]}';
        $r = new RawJsonResponse($json);
        $this->assertInstanceOf(JSONResponse::class, $r);
        $this->assertSame($json, $r->render());
        $this->assertSame(200, $r->getStatus());
        // getHeaders() needs a running server; the stored header is enough here.
        $headers = (new \ReflectionProperty(\OCP\AppFramework\Http\Response::class, 'headers'))->getValue($r);
        $this->assertStringStartsWith('application/json', $headers['Content-Type']);
        $this->assertSame(201, (new RawJsonResponse('{}', 201))->getStatus());
    }
}
