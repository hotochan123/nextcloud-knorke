<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OCA\Knorke\Controller\AiApiController;
use OCA\Knorke\Controller\BoardApiController;
use OCA\Knorke\Controller\CommentApiController;
use OCA\Knorke\Controller\ModerationApiController;
use OCA\Knorke\Controller\PageController;
use OCA\Knorke\Controller\PublicCommentController;
use OCA\Knorke\Controller\PublicPageController;
use OCA\Knorke\Controller\PublicSyncController;
use OCA\Knorke\Controller\SettingsApiController;
use OCA\Knorke\Controller\ShareApiController;
use OCA\Knorke\Controller\SyncController;
use OCA\Knorke\Controller\PublicTagController;
use OCA\Knorke\Controller\ShapeLibApiController;
use OCA\Knorke\Controller\TagApiController;
use OCA\Knorke\Controller\TemplateApiController;
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
 * with the signatures frozen in stage 0; route 27 of the M2 privacy notice;
 * routes 28–34 of the template suggestions, factory job 182; routes 35–43
 * of the comments, factory job 189; routes 44–45 of the tags, factory job 191;
 * routes 46–54 of the own shape libraries, factory job 203; routes 55–56
 * of the board list favorites, factory job 219; route 57 of the board list
 * sketches, factory job 221):
 * every public action has NoAdminRequired or PublicPage – except route 27
 * and the template routes 31, 33 and 34 and the shape library routes 52
 * and 53, which are for admins only and
 * carry neither (nor NoCSRFRequired); NoCSRFRequired only on pages and
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
        TemplateApiController::class => 'templateApi',
        CommentApiController::class => 'commentApi',
        PublicCommentController::class => 'publicComment',
        TagApiController::class => 'tagApi',
        PublicTagController::class => 'publicTag',
        ShapeLibApiController::class => 'shapeLibApi',
        AiApiController::class => 'aiApi',
    ];

    /**
     * Route 27 (M2 privacy notice): admins only. Neither NoAdminRequired nor
     * PublicPage nor NoCSRFRequired: Nextcloud's middleware answers 401
     * without a login and 403 to a logged-in non-admin; only then comes its
     * CSRF check, 412. CSRF stays on, and there is no CORS
     * (testAdminOnlyRoutesHaveNoCors). Factory job 182: the template routes
     * 31, 33 and 34 the same way.
     */
    private const ADMIN_ONLY = ['settingsApi#update', 'templateApi#update', 'templateApi#adopt', 'templateApi#review', 'shapeLibApi#adopt', 'shapeLibApi#review', 'settingsApi#ai'];

    /** Routes 22–26 (SPEC-M1 §4.1, §4.12): real since stage 3. */
    private const MODERATION = ['startVote', 'updateVote', 'timer', 'summon', 'endSummon', 'moveSummon', 'slides', 'privateWriting'];

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
        $this->assertCount(65, $seen, 'every route has its action');
        $this->assertSame(array_keys($routes), array_values(array_intersect(array_keys($routes), array_keys($seen))), 'no route without an action');
    }

    /**
     * Factory job 182 (AK8): routes 28–34 are templateApi#index, create,
     * show, update, destroy, adopt and review; NoAdminRequired exactly on
     * 28, 29, 30 and 32 (31, 33 and 34 are for admins), never NoCSRFRequired
     * or PublicPage (accounts only, CSRF on); show, update, destroy and adopt
     * with `int $id`.
     */
    public function testTemplateRoutes(): void {
        $want = ['index' => [], 'create' => [], 'show' => ['int $id'], 'update' => ['int $id'], 'destroy' => ['int $id'], 'adopt' => ['int $id'], 'review' => []];
        $admin = ['update', 'adopt', 'review'];
        foreach ($want as $method => $params) {
            $m = new \ReflectionMethod(TemplateApiController::class, $method);
            $attrs = array_map(static fn (\ReflectionAttribute $a): string => substr((string)strrchr($a->getName(), '\\'), 1), $m->getAttributes());
            $this->assertSame(in_array($method, $admin, true) ? [] : ['NoAdminRequired'], $attrs, $method);
            $this->assertSame([], array_intersect($attrs, ['NoCSRFRequired', 'PublicPage']), $method);
            $this->assertSame($params, array_map(static fn (\ReflectionParameter $p): string => $p->getType() . ' $' . $p->getName(), $m->getParameters()), $method);
        }
        $this->assertSame(Controller::class, get_parent_class(TemplateApiController::class), 'no ApiController: no CORS');
    }

    /**
     * Factory job 189 (AK9): routes 35–39 are commentApi#index, create,
     * update, destroy, mentions for accounts (NoAdminRequired, CSRF on);
     * routes 40–43 publicComment#index, create, update, destroy for guests
     * (PublicPage, NoCSRFRequired: the writes refuse cross-site requests
     * themselves); every action takes `int $id` only, both controllers are
     * plain Controllers (no CORS).
     */
    public function testCommentRoutes(): void {
        foreach ([CommentApiController::class => ['index', 'create', 'update', 'destroy', 'mentions'], PublicCommentController::class => ['index', 'create', 'update', 'destroy']] as $class => $methods) {
            $public = $class === PublicCommentController::class;
            foreach ($methods as $method) {
                $m = new \ReflectionMethod($class, $method);
                $attrs = array_map(static fn (\ReflectionAttribute $a): string => substr((string)strrchr($a->getName(), '\\'), 1), $m->getAttributes());
                $this->assertSame($public ? ['PublicPage', 'NoCSRFRequired'] : ['NoAdminRequired'], $attrs, "$class::$method");
                $this->assertSame(['int $id'], array_map(static fn (\ReflectionParameter $p): string => $p->getType() . ' $' . $p->getName(), $m->getParameters()), $method);
                $src = (string)file_get_contents((string)(new \ReflectionClass($class))->getFileName());
                if ($public && $method !== 'index') {
                    $body = substr($src, strpos($src, 'function ' . $method . '('));
                    $this->assertMatchesRegularExpression('/^[^}]*?\$this->refuseCrossSite\(\);/s', substr($body, strpos($body, 'run(function')), "$method: refuseCrossSite first");
                }
            }
            $this->assertSame(Controller::class, get_parent_class($class), 'no ApiController: no CORS');
        }
    }

    /**
     * Factory job 191 (AK1, AK8): route 44 is tagApi#update for accounts
     * (NoAdminRequired, CSRF on), route 45 publicTag#update for guests
     * (PublicPage, NoCSRFRequired; refuseCrossSite first); both take `int
     * $id` only and are plain Controllers (no CORS).
     */
    public function testTagRoutes(): void {
        foreach ([TagApiController::class => ['NoAdminRequired'], PublicTagController::class => ['PublicPage', 'NoCSRFRequired']] as $class => $want) {
            $m = new \ReflectionMethod($class, 'update');
            $attrs = array_map(static fn (\ReflectionAttribute $a): string => substr((string)strrchr($a->getName(), '\\'), 1), $m->getAttributes());
            $this->assertSame($want, $attrs, $class);
            $this->assertSame(['int $id'], array_map(static fn (\ReflectionParameter $p): string => $p->getType() . ' $' . $p->getName(), $m->getParameters()), $class);
            $this->assertSame(Controller::class, get_parent_class($class), 'no ApiController: no CORS');
        }
        $src = (string)file_get_contents((string)(new \ReflectionClass(PublicTagController::class))->getFileName());
        $body = substr($src, strpos($src, 'function update('));
        $this->assertMatchesRegularExpression('/^[^}]*?\$this->refuseCrossSite\(\);/s', substr($body, strpos($body, 'run(function')), 'refuseCrossSite first');
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
