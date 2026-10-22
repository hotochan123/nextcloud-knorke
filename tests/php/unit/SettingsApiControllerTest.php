<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\SettingsApiController;
use OCA\Knorke\Service\PrivacyNotice;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use OCP\L10N\IFactory;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Route 27 `PUT /api/v1/settings/privacy` (M2 privacy notice, AK2): admins
 * only (own IGroupManager::isAdmin check on top of Nextcloud's middleware),
 * the body through JsonBody, 200 {"privacy": <normalised form>}; a non-admin
 * gets 403 forbidden and nothing is written.
 */
final class SettingsApiControllerTest extends TestCase {
    /** @var list<string> app config writes */
    private array $writes = [];
    /** @var list<string> isAdmin calls */
    private array $asked = [];

    private function controller(?string $uid, array $body, array $extraHeaders = []): SettingsApiController {
        $route = ['_route' => 'knorke.settingsApi.update'];
        $params = array_merge($route, $body);
        $request = Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? '42' : ($extraHeaders[$name] ?? ''),
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
        ], ['urlParams' => $route]);
        $user = $uid === null ? null : Fake::of(IUser::class, ['getUID' => fn (): string => $uid]);
        $appConfig = Fake::of(IAppConfig::class, [
            'setValueString' => function (string $app, string $key, string $value, bool $lazy = false, bool $sensitive = false): bool {
                $this->writes[] = "set $app/$key " . ($lazy ? 'lazy' : 'eager') . " $value";
                return true;
            },
            'deleteKey' => function (string $app, string $key): void {
                $this->writes[] = "delete $app/$key";
            },
        ]);
        $l10n = Fake::of(IFactory::class, ['getLanguages' => fn (): array => [
            'commonLanguages' => [['code' => 'de', 'name' => 'Deutsch'], ['code' => 'en', 'name' => 'English (US)']],
            'otherLanguages' => [['code' => 'fr', 'name' => 'Français']],
        ]]);
        return new SettingsApiController(
            $request,
            Fake::of(LoggerInterface::class),
            Fake::of(IUserSession::class, ['getUser' => fn (): ?IUser => $user]),
            Fake::of(IGroupManager::class, ['isAdmin' => function ($id): bool {
                $this->asked[] = (string)$id;
                return $id === 'admin';
            }]),
            new PrivacyNotice($appConfig, $l10n),
        );
    }

    public function testNonAdminIs403AndNothingIsWritten(): void {
        foreach (['bob', null] as $uid) {
            $r = $this->controller($uid, ['default' => ['text' => 'T0']])->update();
            $this->assertInstanceOf(JSONResponse::class, $r);
            $this->assertSame(403, $r->getStatus(), (string)$uid);
            $this->assertSame(['error' => 'forbidden', 'message' => 'You are not allowed to do this.'], $r->getData());
        }
        $this->assertSame([], $this->writes, 'IAppConfig not written');
        $this->assertSame(['bob'], $this->asked, 'isAdmin asked for the signed-in user');
        // 403 before the body is read: a broken body still gives 403
        $r = $this->controller('bob', ['nope' => 1])->update();
        $this->assertSame(403, $r->getStatus());
    }

    public function testAdminGets200WithTheNormalisedForm(): void {
        $r = $this->controller('admin', ['default' => ['text' => "Line 1\r\nLine 2 ", 'url' => ' https://example.org/p '], 'languages' => [
            'fr' => ['text' => 'Bonjour'], 'de' => ['text' => 'Hallo', 'url' => null], 'en' => ['text' => '', 'url' => ''],
        ]])->update();
        $this->assertSame(200, $r->getStatus());
        $this->assertSame('{"privacy":{"default":{"text":"Line 1\nLine 2","url":"https:\/\/example.org\/p"},"languages":{"de":{"text":"Hallo","url":""},"fr":{"text":"Bonjour","url":""}}}}',
            json_encode($r->getData()));
        $this->assertCount(1, $this->writes);
        $this->assertStringStartsWith('set knorke/privacy_notice lazy {"default":', $this->writes[0]);
        $this->assertSame(['admin'], $this->asked);
    }

    public function testAdminEmptyBodyGivesEmptyObjectAndDeletes(): void {
        $r = $this->controller('admin', [])->update();
        $this->assertSame(200, $r->getStatus());
        $this->assertSame('{"privacy":{"default":{"text":"","url":""},"languages":{}}}', json_encode($r->getData()), 'languages {} never []');
        $this->assertSame(['delete knorke/privacy_notice'], $this->writes);
    }

    public function testAdminErrorsInTheAppsForm(): void {
        $cases = [
            [['default' => ['text' => 'x'], 'extra' => 1], 400, ['error' => 'bad_request', 'message' => 'Unknown field in the request body.']],
            [['languages' => ['xx' => ['text' => 'a']]], 400, ['error' => 'unknown_language', 'message' => 'This language is not available on this Nextcloud.', 'at' => 'xx']],
            [['default' => ['url' => 'javascript:alert(1)']], 400, ['error' => 'invalid_url', 'message' => 'The address must be an absolute http or https URL.', 'at' => 'default']],
            [['languages' => ['de' => ['text' => str_repeat('a', 2001)]]], 400, ['error' => 'text_too_long', 'message' => 'The text is too long.', 'at' => 'de', 'max' => 2000]],
        ];
        foreach ($cases as [$body, $status, $data]) {
            $r = $this->controller('admin', $body)->update();
            $this->assertSame([$status, $data], [$r->getStatus(), $r->getData()], json_encode(array_keys($body)));
        }
        $this->assertSame([], $this->writes, 'no error writes anything');
    }
}
