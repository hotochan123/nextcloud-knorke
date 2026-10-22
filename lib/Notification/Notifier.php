<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Notification;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCP\App\IAppManager;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\INotification;
use OCP\Notification\INotifier;
use OCP\Notification\UnknownNotificationException;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Renders "{owner} shared the board {title} with you" (ShareNotifications)
 * when Nextcloud shows it: in the bell, for push and for the mail digest.
 * Whether it still applies is decided here (SPEC-M1 §1.2): the account
 * must have access to the app, the Guests app must let it into Knorke
 * (GuestsAppWhitelist, as in the search: the notifications app is on that
 * app's default whitelist, so it never stops the bell itself) and
 * ShareService::roleFor() must give it a role on the board; otherwise
 * AlreadyProcessedException makes Nextcloud delete it (no app access,
 * Knorke not on the whitelist or the Guests app failing, share removed,
 * group or team left, board deleted). Title and owner name are read
 * fresh; the link is the board page, never a /p/ link. In CLI processes
 * (cron, background-job:worker) SharePolicy's per-process answers are
 * reset before roleFor(), and SharePolicy reads the groups there from the
 * group backends, past Nextcloud's per-process group cache: a group or
 * team left or joined meanwhile counts at once (as fresh as the group
 * backend and Circles). App access (isEnabledForUser, e.g. Knorke limited
 * to groups) stays Nextcloud's own check, only as fresh as Nextcloud's
 * per-process caches.
 *
 * Nextcloud builds every notifier whenever any notification is prepared,
 * so the constructor takes only light services (GuestsAppWhitelist holds
 * just the container); BoardStore, SharePolicy and ShareService come from
 * the container once a Knorke notification passed the cheap checks, the
 * Guests app's whitelist only for one of its accounts.
 */
class Notifier implements INotifier {
    private ?BoardStore $boards = null;
    private ?SharePolicy $policy = null;
    private ?ShareService $shares = null;

    public function __construct(
        private IFactory $l10n,
        private IURLGenerator $urls,
        private IUserManager $users,
        private IAppManager $apps,
        private ContainerInterface $container,
        private GuestsAppWhitelist $guestsApp,
    ) {
    }

    public function getID(): string {
        return Application::APP_ID;
    }

    /** The product name (as <name> in info.xml), not translated. */
    public function getName(): string {
        return 'Knorke';
    }

    public function prepare(INotification $notification, string $languageCode): INotification {
        if ($notification->getApp() !== Application::APP_ID) {
            throw new UnknownNotificationException();
        }
        if ($notification->getSubject() !== ShareNotifications::SUBJECT || $notification->getObjectType() !== ShareNotifications::OBJECT_TYPE) {
            throw new UnknownNotificationException();
        }
        // D: `$` must not match before a trailing newline.
        if (preg_match('/^[1-9][0-9]{0,17}$/D', $notification->getObjectId()) !== 1) {
            throw new AlreadyProcessedException();
        }
        $id = (int)$notification->getObjectId();
        $user = $this->users->get($notification->getUser());
        if ($user === null || !$this->apps->isEnabledForUser(Application::APP_ID, $user)) {
            throw new AlreadyProcessedException();
        }
        // An account the Guests app keeps out of Knorke: deleted like one
        // without app access, before anything of Knorke is read.
        if (!$this->guestsApp->allows($user)) {
            throw new AlreadyProcessedException();
        }
        try {
            $board = ($this->boards ??= $this->container->get(BoardStore::class))->findBoard($id);
            $role = null;
            if ($board !== null && $board['owner'] !== $user->getUID()) {
                if ($this->freshRights()) {
                    ($this->policy ??= $this->container->get(SharePolicy::class))->reset();
                }
                [$role] = ($this->shares ??= $this->container->get(ShareService::class))->roleFor($id, $user);
            }
        } catch (\Throwable $e) {
            // Database or group backend: keep the notification; the bell
            // shows it later. The Notifications app does not retry the push.
            // Its mail digest moves past it as soon as it mails another
            // notification in the same run; if that run mails nothing, the
            // next run tries again.
            $this->warn($e, $id);
            throw new UnknownNotificationException();
        }
        // Board deleted, own board, or no right any more (a role change keeps it).
        if ($board === null || $role === null) {
            throw new AlreadyProcessedException();
        }

        $l = $this->l10n->get(Application::APP_ID, $languageCode);
        $owner = (string)$board['owner'];
        $ownerName = $this->users->getDisplayName($owner) ?? $owner;
        $title = (string)$board['title'];
        $link = $this->urls->linkToRouteAbsolute('knorke.page.board', ['id' => $id]);
        $text = $l->t('{owner} shared the board {title} with you');
        // The plain subject (push, mail) is set explicitly: Nextcloud's own
        // formatter writes a user as "@name". strtr replaces in one pass, so
        // a title containing "{owner}" stays as it is.
        $notification->setParsedSubject(strtr($text, ['{owner}' => $ownerName, '{title}' => $title]));
        // No parameter carries a `link`: the notifications app makes the whole
        // entry a link to getLink() (same tab) only when none does; otherwise
        // just the parameter is clickable, as an external link (new tab, "↗").
        $notification->setRichSubject($text, [
            'owner' => ['type' => 'user', 'id' => $owner, 'name' => $ownerName],
            'title' => ['type' => 'highlight', 'id' => (string)$id, 'name' => $title],
        ]);
        $notification->setLink($link);
        $notification->setIcon($this->urls->getAbsoluteURL($this->urls->imagePath(Application::APP_ID, 'app-dark.svg')));
        return $notification;
    }

    /** Long-running CLI processes (cron.php, occ background-job:worker) forget SharePolicy's answers before every check; a web request is a fresh process. */
    protected function freshRights(): bool {
        return PHP_SAPI === 'cli';
    }

    /** The logger only on this rare path (no constructor argument: the constructor stays light). */
    private function warn(\Throwable $e, int $board): void {
        try {
            $this->container->get(LoggerInterface::class)->warning('Knorke: preparing a share notification failed', ['exception' => $e, 'app' => 'knorke', 'board' => $board]);
        } catch (\Throwable) {
        }
    }
}
