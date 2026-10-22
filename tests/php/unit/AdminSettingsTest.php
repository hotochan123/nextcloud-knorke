<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Service\PrivacyNotice;
use OCA\Knorke\Settings\Admin;
use OCA\Knorke\Settings\AdminSection;
use OCA\Knorke\Tests\Support\Fake;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;
use OCP\Settings\IIconSection;
use OCP\Settings\IManager;
use OCP\Settings\ISettings;
use PHPUnit\Framework\TestCase;

/**
 * The admin section "Knorke" (M2 privacy notice, AK8): registered in boot()
 * through the public settings API, without <settings> in appinfo/info.xml;
 * the section's id, name and icon; the form's template and its 12
 * initial-state keys (page 'admin', privacyAdmin, privacy null).
 */
final class AdminSettingsTest extends TestCase {
    public function testRegisterSettings(): void {
        $calls = [];
        $m = Fake::of(IManager::class, [
            'registerSection' => function (string $type, string $section) use (&$calls): void {
                $calls[] = ['section', $type, $section];
            },
            'registerSetting' => function (string $type, string $setting) use (&$calls): void {
                $calls[] = ['setting', $type, $setting];
            },
        ]);
        Application::registerSettings($m);
        $this->assertSame([['section', 'admin', AdminSection::class], ['setting', 'admin', Admin::class]], $calls);
        $boot = new \ReflectionMethod(Application::class, 'boot');
        $src = implode('', array_slice(file((string)$boot->getFileName()), $boot->getStartLine() - 1, $boot->getEndLine() - $boot->getStartLine() + 1));
        $this->assertStringContainsString("\$context->injectFn([self::class, 'registerSettings']);", $src, 'boot() calls it through injectFn');
    }

    public function testInfoXmlHasNoSettings(): void {
        $xml = (string)file_get_contents(dirname(__DIR__, 3) . '/appinfo/info.xml');
        $this->assertStringNotContainsString('<settings>', $xml, 'registration in boot(), info.xml unchanged');
    }

    public function testSection(): void {
        $s = new AdminSection(Fake::of(IURLGenerator::class, ['imagePath' => fn (string $app, string $image): string => "/custom_apps/$app/img/$image"]));
        $this->assertInstanceOf(IIconSection::class, $s);
        $this->assertSame(['knorke', 'Knorke', 80], [$s->getID(), $s->getName(), $s->getPriority()]);
        $this->assertStringEndsWith('app-dark.svg', $s->getIcon());
        $this->assertSame('/custom_apps/knorke/img/app-dark.svg', $s->getIcon());
    }

    public function testFormProvidesTheTwelveKeys(): void {
        $got = [];
        $state = Fake::of(IInitialState::class, ['provideInitialState' => function (string $key, $data) use (&$got): void {
            $got[$key] = json_encode($data);
        }]);
        $appConfig = Fake::of(IAppConfig::class, ['getValueString' => fn (string $app, string $key, string $default = '', bool $lazy = false): string => match ("$app/$key") {
            'knorke/privacy_notice' => PrivacyNotice::encode(['default' => ['text' => 'T0', 'url' => ''], 'languages' => ['de' => ['text' => 'Tde', 'url' => '']]]),
            'theming/privacyUrl' => 'https://example.org/datenschutz',
            default => $default,
        }]);
        $privacy = new PrivacyNotice($appConfig, Fake::of(IFactory::class, ['getLanguages' => fn (): array => [
            'commonLanguages' => [['code' => 'de', 'name' => 'Deutsch']], 'otherLanguages' => [['code' => 'fr', 'name' => 'Français']],
        ]]));
        $form = new Admin($state, Fake::of(IConfig::class), PageControllerTest::limits(), $privacy);
        $this->assertInstanceOf(ISettings::class, $form);
        $this->assertSame(['knorke', 10], [$form->getSection(), $form->getPriority()]);
        $r = $form->getForm();
        $this->assertInstanceOf(TemplateResponse::class, $r);
        $this->assertSame(['knorke', 'admin', ''], [$r->getApp(), $r->getTemplateName(), $r->getRenderAs()]);
        $this->assertSame(PageController::INITIAL_STATE_KEYS, array_keys($got), 'the 12 keys, in order');
        $this->assertCount(12, $got);
        $this->assertSame(['"admin"', 'null', 'null', 'null'], [$got['page'], $got['privacy'], $got['legal'], $got['boardId']]);
        $admin = json_decode($got['privacyAdmin'], true);
        $this->assertSame(['settings', 'languages', 'themingUrl', 'textMax', 'languagesMax'], array_keys($admin));
        $this->assertSame(['default' => ['text' => 'T0', 'url' => ''], 'languages' => ['de' => ['text' => 'Tde', 'url' => '']]], $admin['settings']);
        $this->assertSame([['code' => 'de', 'name' => 'Deutsch'], ['code' => 'fr', 'name' => 'Français']], $admin['languages']);
        $this->assertSame(['https://example.org/datenschutz', 2000, 20], [$admin['themingUrl'], $admin['textMax'], $admin['languagesMax']]);
    }
}
