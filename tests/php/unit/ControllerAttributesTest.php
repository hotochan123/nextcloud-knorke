<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\BoardApiController;
use OCA\Knorke\Controller\ModerationApiController;
use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Controller\PublicPageController;
use OCA\Knorke\Controller\PublicSyncController;
use OCA\Knorke\Controller\SettingsApiController;
use OCA\Knorke\Controller\ShareApiController;
use OCA\Knorke\Controller\SyncController;
use OCA\Knorke\Service\Access;
use OCA\Knorke\Service\ModerationService;
use OCA\Knorke\Service\VoteService;
use OCP\AppFramework\Controller;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Controller attributes by reflection (SPEC-M0 §4.1, §9.1; SPEC-M1 §4.1: 26
 * routes; routes 17–21 are real since stage 2, routes 22–26 since stage 3,
 * with the signatures frozen in stage 0; route 27 of the M2 privacy notice):
 * every public action has NoAdminRequired or PublicPage – except route 27,
 * which is for admins only and carries neither (nor NoCSRFRequired); NoCSRFRequired only on pages and
 * the public controllers; nowhere UseSession/BruteForceProtection/
 * AnonRateLimit/UserRateLimit; #[\SensitiveParameter] on every $token;
 * method parameters are route parameters only.
 */
final class ControllerAttributesTest extends TestCase {
    private const CONTROLLERS = [
        PageController::class => 'page',
        BoardApiController::class => 'boardApi',
        SyncController::class => 'sync',
        PublicPageController::class => 'publicPage',
        PublicSyncController::class => 'publicSync',
        ShareApiController::class => 'shareApi',
        ModerationApiController::class => 'moderationApi',
        SettingsApiController::class => 'settingsApi',
    ];

    /**
     * Route 27 (M2 privacy notice): admins only. Neither NoAdminRequired nor
     * PublicPage nor NoCSRFRequired: Nextcloud's middleware answers 401
     * without a login and 403 to a logged-in non-admin; only then comes its
     * CSRF check, 412. CSRF stays on, and there is no CORS
     * (testAdminOnlyRoutesHaveNoCors).
     */
    private const ADMIN_ONLY = ['settingsApi#update'];

    /** Routes 22–26 (SPEC-M1 §4.1, §4.12): real since stage 3. */
    private const MODERATION = ['startVote', 'updateVote', 'timer', 'summon', 'endSummon'];

    public function testAttributes(): void {
        $table = require dirname(__DIR__, 3) . '/appinfo/routes.php';
        $routes = [];
        foreach ($table['routes'] as $r) {
            $routes[$r['name']] = $r;
        }
        $seen = [];
        foreach (self::CONTROLLERS as $class => $prefix) {
            $rc = new \ReflectionClass($class);
            $public = str_starts_with($rc->getShortName(), 'Public');
            foreach ($rc->getMethods(\ReflectionMethod::IS_PUBLIC) as $m) {
                if ($m->getDeclaringClass()->getName() !== $class || $m->isConstructor() || $m->isStatic()) {
                    continue;
                }
                $route = $prefix . '#' . $m->getName();
                $this->assertArrayHasKey($route, $routes, "$route has a route");
                $seen[$route] = true;
                $attrs = array_map(static fn (\ReflectionAttribute $a): string => substr((string)strrchr($a->getName(), '\\'), 1), $m->getAttributes());
                if (in_array($route, self::ADMIN_ONLY, true)) {
                    $this->assertSame([], array_intersect($attrs, ['NoAdminRequired', 'PublicPage', 'NoCSRFRequired', 'SubAdminRequired']), "$route: admins only, CSRF on");
                } else {
                    $this->assertContains($public ? 'PublicPage' : 'NoAdminRequired', $attrs, "$route NoAdminRequired/PublicPage");
                }
                $this->assertSame($public || $class === PageController::class, in_array('NoCSRFRequired', $attrs, true), "$route NoCSRFRequired only on pages and public controllers");
                $this->assertSame([], array_intersect($attrs, ['UseSession', 'BruteForceProtection', 'AnonRateLimit', 'UserRateLimit']), "$route forbidden attributes");
                preg_match_all('/\{(\w+)\}/', $routes[$route]['url'], $mm);
                $params = array_map(static fn (\ReflectionParameter $p): string => $p->getName(), $m->getParameters());
                $this->assertSame($mm[1], $params, "$route: parameters are route parameters only");
                foreach ($m->getParameters() as $p) {
                    if ($p->getName() === 'token') {
                        $this->assertNotEmpty($p->getAttributes(\SensitiveParameter::class), "$route #[\\SensitiveParameter] \$token");
                        $this->assertSame('string', (string)$p->getType());
                    }
                    if ($p->getName() === 'id') {
                        $this->assertSame('int', (string)$p->getType());
                    }
                }
            }
            foreach ($rc->getAttributes() as $a) {
                $this->assertNotContains(substr((string)strrchr($a->getName(), '\\'), 1), ['UseSession', 'BruteForceProtection', 'AnonRateLimit', 'UserRateLimit']);
            }
        }
        $this->assertCount(27, $seen, 'every route has its action');
        $this->assertSame(array_keys($routes), array_values(array_intersect(array_keys($routes), array_keys($seen))), 'no route without an action');
    }

    /**
     * Route 27 has no CORS (SPEC-M1 §4.1, route 27). Nextcloud's CSRF check
     * lets a request with a non-empty OCS-APIRequest header through even
     * without a requesttoken; that is only harmless as long as a foreign
     * page cannot send this header, that is without CORS. Hence, for every
     * admin-only route: no #[CORS] attribute, no CORS annotation in the
     * docblock (Nextcloud 34 and 35 still read it), and the controller
     * extends a plain Controller, not an ApiController (nor OCSController,
     * which extends ApiController).
     */
    public function testAdminOnlyRoutesHaveNoCors(): void {
        foreach (self::ADMIN_ONLY as $route) {
            [$prefix, $method] = explode('#', $route, 2);
            $class = array_search($prefix, self::CONTROLLERS, true);
            $this->assertIsString($class, "$route: its controller is in CONTROLLERS");
            $this->assertSame(Controller::class, get_parent_class($class), "$route: $class extends Controller, not ApiController");
            $m = new \ReflectionMethod($class, $method);
            $attrs = array_map(static fn (\ReflectionAttribute $a): string => substr((string)strrchr($a->getName(), '\\'), 1), $m->getAttributes());
            $this->assertNotContains('CORS', $attrs, "$route: no #[CORS]");
            $this->assertDoesNotMatchRegularExpression('/^\h+\*\h+@cors\b/mi', (string)$m->getDocComment(), "$route: no @CORS");
        }
    }

    /**
     * Since stage 3 every route is real (routes 22–26: SPEC-M1 §4.12): no
     * controller answers 501 not_implemented any more.
     */
    public function testNoStubsLeft(): void {
        foreach (array_keys(self::CONTROLLERS) as $class) {
            $src = (string)file_get_contents((string)(new \ReflectionClass($class))->getFileName());
            $this->assertStringNotContainsString("'not_implemented'", $src, $class);
        }
        foreach (self::MODERATION as $method) {
            $this->assertTrue(method_exists(ModerationApiController::class, $method), $method);
        }
    }

    /** The moderation controller gets its services by constructor autowiring (stage 3). */
    public function testModerationControllerDependencies(): void {
        $params = array_map(static fn (\ReflectionParameter $p): string => (string)$p->getType(),
            (new \ReflectionMethod(ModerationApiController::class, '__construct'))->getParameters());
        $this->assertSame([IRequest::class, LoggerInterface::class, Access::class, VoteService::class, ModerationService::class,
            IUserSession::class, ILimiter::class], $params);
    }

    public function testSensitiveParametersInServices(): void {
        $checks = [
            [\OCA\Knorke\Service\Access::class, 'forGuest', ['token']],
            [\OCA\Knorke\Service\Access::class, 'joinGuest', ['linkToken', 'name', 'existing', 'password']],
            [\OCA\Knorke\Service\Access::class, 'checkPassword', ['password']],
            [\OCA\Knorke\Service\GuestToken::class, 'verify', ['t']],
            [\OCA\Knorke\Service\BoardService::class, 'joinLinkAsUser', ['token', 'password']],
            [\OCA\Knorke\Service\BoardService::class, 'enableLink', ['body']],
            [\OCA\Knorke\Service\LinkSecrets::class, 'hashChecked', ['password']],
            [\OCA\Knorke\Service\LinkSecrets::class, 'verify', ['password', 'stored']],
            [\OCA\Knorke\Db\BoardStore::class, 'findLinkByToken', ['token']],
            [\OCA\Knorke\Db\BoardStore::class, 'insertLink', ['token', 'hash']],
            [\OCA\Knorke\Db\BoardStore::class, 'updateLinkSecrets', ['hash']],
            [\OCA\Knorke\Db\BoardStore::class, 'replaceLinkHash', ['old', 'new']],
        ];
        foreach ($checks as [$class, $method, $names]) {
            $found = [];
            foreach ((new \ReflectionMethod($class, $method))->getParameters() as $p) {
                if (in_array($p->getName(), $names, true)) {
                    $found[] = $p->getName();
                    $this->assertNotEmpty($p->getAttributes(\SensitiveParameter::class), "$class::$method \${$p->getName()}");
                }
            }
            $this->assertSame($names, $found, "$class::$method has every named parameter");
        }
    }
}
