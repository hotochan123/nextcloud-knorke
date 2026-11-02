<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Unit;

use OC\Notification\Notification;
use OC\RichObjectStrings\RichTextFormatter;
use OC\RichObjectStrings\Validator;
use OCA\Knorke\Notification\TemplateNotifications;
use OCA\Knorke\Tests\Support\TemplateHarness;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\INotification;
use OCP\Notification\UnknownNotificationException;
use OCP\RichObjectStrings\Definitions;
use PHPUnit\Framework\TestCase;

/**
 * The notifications of template suggestions (factory job 182, AK6):
 * TemplateNotifications sends them after the store's write (two admins get
 * one each; a disabled admin, one without the app and bob none; a throwing
 * manager changes nothing; more than FANOUT_MAX admins: nobody, one info
 * line), Notifier renders them (texts in English and German checked by
 * Nextcloud's real Validator, the links, AlreadyProcessedException when
 * they no longer apply).
 */
final class TemplateNotificationsTest extends TestCase {
    private const SKETCH = [[0, 0, 120, 80, '']];
    private const CONTENT = '{"knorke":1,"kind":"board","title":"","origin":[0,0],"items":[{"id":"01JT0000000000000000000001","t":"sticky"}]}';

    private TemplateHarness $h;

    protected function setUp(): void {
        $this->h = new TemplateHarness();
        $this->h->admins = ['admin', 'root', 'dis', 'noapp'];
        $this->h->disabled = ['dis'];
        $this->h->noApp = ['noapp'];
    }

    private function suggest(string $uid, string $name, int $now = 1000): int {
        return $this->h->store->create($this->h->user($uid), ['name' => $name, 'content' => self::CONTENT, 'sketch' => self::SKETCH], $now)['id'];
    }

    private function assertDropped(INotification $n, string $why): void {
        try {
            $this->h->notifier()->prepare($n, 'en');
            $this->fail("AlreadyProcessedException expected: $why");
        } catch (AlreadyProcessedException) {
            $this->addToAssertionCount(1);
        }
    }

    /** A notification as it could be stored. */
    private static function raw(string $user, string $type, string $id, string $subject, array $params = []): INotification {
        $n = new Notification(new Validator(new Definitions()), new RichTextFormatter());
        return $n->setApp('knorke')->setUser($user)->setObject($type, $id)->setSubject($subject, $params)->setDateTime(new \DateTime('@1760000000'));
    }

    public function testAk6TwoAdminsGetExactlyTwoNotifications(): void {
        $a = $this->suggest('bob', 'A');
        $this->assertSame(['admin template_suggested ' . $a, 'root template_suggested ' . $a], $this->h->bellOf(), 'not the disabled admin, not the one without the app, not bob');
        $this->assertSame(['defer', 'notify admin template_suggested ' . $a, 'notify root template_suggested ' . $a, 'flush'], $this->h->log, 'one defer and flush');
        $this->assertSame([[], []], [$this->h->bell[0][4], $this->h->bell[1][4]], 'no name stored: it is read fresh');
    }

    public function testAk6AThrowingManagerKeepsThe201AndTheRow(): void {
        $this->h->notifyFail = new \RuntimeException('notifications down');
        [$status, $data] = $this->h->call('bob', 'create', ['name' => 'A', 'content' => self::CONTENT, 'sketch' => self::SKETCH]);
        $this->assertSame([201, 'pending'], [$status, $data['state']]);
        $a = $data['id'];
        $this->assertSame('pending', $this->h->rows()[0]['state']);
        $this->assertSame($a, (int)$this->h->rows()[0]['id']);
        $this->assertSame(['Knorke: template notification failed', 'Knorke: template notification failed'], $this->h->warnings, 'logged per admin');
        $this->assertSame([], $this->h->bell);
        // adopting with a throwing manager: still adopted
        $this->assertSame([200, ['id' => $a]], $this->h->call('admin', 'adopt', [], $a));
        $this->assertSame('adopted', $this->h->rows()[0]['state']);
    }

    public function testAk6MoreAdminsThanFanoutMaxGetNothing(): void {
        for ($i = 0; $i < 501; $i++) {
            $this->h->names['adm' . $i] = 'Admin ' . $i;
        }
        $this->h->admins = array_keys(array_filter($this->h->names, static fn (string $n): bool => str_starts_with($n, 'Admin ')));
        $this->assertCount(501, $this->h->admins);
        $this->suggest('bob', 'A');
        $this->assertSame([], $this->h->bell);
        $this->assertSame(['Knorke: template notification skipped, too many admins'], $this->h->infos);
        $this->assertCount(1, $this->h->rows());
    }

    public function testAk6TheSuggestedTextInEnglishAndGermanAndTheLink(): void {
        $a = $this->suggest('bob', 'A');
        $n = $this->h->stored('admin', $a, TemplateNotifications::SUGGESTED);
        $en = $this->h->notifier()->prepare(clone $n, 'en');
        $this->assertSame('Bob Berg suggested the template A', $en->getParsedSubject());
        $this->assertSame('{user} suggested the template {name}', $en->getRichSubject());
        $this->assertSame([
            'user' => ['type' => 'user', 'id' => 'bob', 'name' => 'Bob Berg'],
            'name' => ['type' => 'highlight', 'id' => (string)$a, 'name' => 'A'],
        ], $en->getRichSubjectParameters());
        $this->assertStringEndsWith('/settings/admin/knorke', $en->getLink());
        $this->assertSame('https://cloud.example/custom_apps/knorke/img/app-dark.svg', $en->getIcon());
        $this->assertTrue($en->isValidParsed(), "Nextcloud's validator accepts the English text");
        $de = $this->h->notifier()->prepare(clone $n, 'de');
        $this->assertSame('Bob Berg hat die Vorlage A vorgeschlagen', $de->getParsedSubject());
        $this->assertTrue($de->isValidParsed());
        // read fresh: a new display name shows at once
        $this->h->names['bob'] = 'Bob B.';
        $this->assertSame('Bob B. suggested the template A', $this->h->notifier()->prepare(clone $n, 'en')->getParsedSubject());
    }

    public function testAk6TheSuggestedOneIsDroppedOnceItNoLongerApplies(): void {
        $a = $this->suggest('bob', 'A', 1000);
        $b = $this->suggest('bob', 'B', 2000);
        $w = $this->suggest('bob', 'W', 3000);
        $nA = $this->h->stored('root', $a, TemplateNotifications::SUGGESTED);
        $nB = $this->h->stored('root', $b, TemplateNotifications::SUGGESTED);
        $nW = $this->h->stored('root', $w, TemplateNotifications::SUGGESTED);
        $this->assertSame('Bob Berg suggested the template W', $this->h->notifier()->prepare(clone $nW, 'en')->getParsedSubject(), 'precondition');
        $this->h->store->adopt($this->h->user('admin'), $a, 4000);
        $this->assertDropped(clone $nA, 'A adopted');
        $this->h->store->delete($this->h->user('admin'), $b);
        $this->assertDropped(clone $nB, 'B rejected (deleted)');
        $this->h->admins = ['admin'];
        $this->assertDropped(clone $nW, 'root is no admin any more');
        $this->h->admins = ['admin', 'root'];
        $this->h->noApp = ['root'];
        $this->assertDropped(clone $nW, 'root has no access to the app');
        $this->h->noApp = [];
        $this->h->deleted = ['root'];
        $this->assertDropped(clone $nW, 'root is gone');
        $this->assertDropped(self::raw('admin', 'template', '0', TemplateNotifications::SUGGESTED), 'no template id');
    }

    public function testAk6AdoptedAndRejectedShowTheStoredName(): void {
        $a = $this->suggest('bob', 'A', 1000);
        $b = $this->suggest('bob', 'B', 2000);
        $this->h->store->adopt($this->h->user('admin'), $a, 3000);
        $this->h->store->rename($this->h->user('admin'), $a, ['name' => 'A neu']);
        $this->h->store->delete($this->h->user('root'), $b);
        $adopted = $this->h->stored('bob', $a, TemplateNotifications::ADOPTED);
        $rejected = $this->h->stored('bob', $b, TemplateNotifications::REJECTED);
        $en = $this->h->notifier()->prepare(clone $adopted, 'en');
        $this->assertSame('Your template A was adopted. Everyone can now insert it.', $en->getParsedSubject(), 'the stored name, not the new one');
        $this->assertSame(['name' => ['type' => 'highlight', 'id' => (string)$a, 'name' => 'A']], $en->getRichSubjectParameters());
        $this->assertSame(TemplateHarness::BASE . '/apps/knorke/', $en->getLink());
        $this->assertTrue($en->isValidParsed());
        $this->assertSame('Deine Vorlage A wurde übernommen. Alle können sie jetzt einfügen.', $this->h->notifier()->prepare(clone $adopted, 'de')->getParsedSubject());
        $en = $this->h->notifier()->prepare(clone $rejected, 'en');
        $this->assertSame('Your template suggestion B was not adopted.', $en->getParsedSubject(), 'the row is gone, the name stays');
        $this->assertSame(TemplateHarness::BASE . '/apps/knorke/', $en->getLink());
        $this->assertTrue($en->isValidParsed());
        $this->assertSame('Dein Vorlagenvorschlag B wurde nicht übernommen.', $this->h->notifier()->prepare(clone $rejected, 'de')->getParsedSubject());
        // dropped: no name, no app, the Guests app keeps the account out
        $this->assertDropped(self::raw('bob', 'template', (string)$a, TemplateNotifications::ADOPTED), 'no name');
        $this->assertDropped(self::raw('bob', 'template', (string)$a, TemplateNotifications::REJECTED, ['name' => '']), 'an empty name');
        $this->h->noApp = ['bob'];
        $this->assertDropped(clone $adopted, 'bob has no access to the app');
        $this->h->noApp = [];
        $this->assertDropped(self::raw('gast', 'template', (string)$a, TemplateNotifications::ADOPTED, ['name' => 'A']), 'the Guests app refuses');
    }

    public function testOtherSubjectsOnTemplatesAreNotOurs(): void {
        foreach ([['template', 'board_shared'], ['template', 'template_other'], ['board', TemplateNotifications::SUGGESTED]] as [$type, $subject]) {
            try {
                $this->h->notifier()->prepare(self::raw('admin', $type, '1', $subject), 'en');
                $this->fail("UnknownNotificationException expected for $type/$subject");
            } catch (UnknownNotificationException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
