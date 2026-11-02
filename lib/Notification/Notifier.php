<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Notification;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Db\BoardStore;
use OCA\Knorke\Service\CommentService;
use OCA\Knorke\Service\GuestsAppWhitelist;
use OCA\Knorke\Service\LinkPolicy;
use OCA\Knorke\Service\SharePolicy;
use OCA\Knorke\Service\ShareService;
use OCA\Knorke\Service\ShapeLibStore;
use OCA\Knorke\Service\TemplateStore;
use OCP\App\IAppManager;
use OCP\IGroupManager;
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
 *
 * Template suggestions (factory job 182, TemplateNotifications, object
 * template/<id>), after the same checks of app access and the Guests app:
 *  - template_suggested: "{user} suggested the template {name}", name and
 *    who suggested it read fresh (TemplateStore::pendingRow); dropped when
 *    the row is no longer pending (adopted, rejected, withdrawn, its account
 *    deleted) or the account is no admin any more. The link is the Knorke
 *    section of the admin settings.
 *  - template_adopted / template_rejected: the stored name parameter
 *    (dropped without one); the link is Knorke's start page.
 * TemplateStore and IGroupManager come from the container, only for these.
 * (Factory job 203) Shape library suggestions (ShapeLibNotifications,
 * object shapelib/<id>) the same way: shapelib_suggested "{user} suggested
 * the shape library {name}" (ShapeLibStore::pendingRow), shapelib_adopted /
 * shapelib_rejected with the stored name.
 *
 * Comments (factory job 189, CommentNotifications), after the same checks
 * of app access and the Guests app:
 *  - comment_mention (object comment/<id>): "{user} mentioned you in a
 *    comment on {board}"; dropped as well when the account is no longer
 *    among the comment's stored mentions.
 *  - comment_reply (object comment_thread/<thread>, subject parameter
 *    comment = the reply): "{user} replied in a comment thread on {board}".
 *  Both read fresh (CommentService::noteContext): {user} is the author's
 *  display name, "{name} (guest)" or "Deleted user"; the message is the
 *  text with @name, at most 200 characters plus "…"; the link is the board
 *  page with ?comment=<thread>. Dropped (AlreadyProcessedException) when
 *  the comment, its thread or the board is gone or the account has no role
 *  on the board any more (CommentService::roleOf: owner, share, valid link
 *  membership). CommentService comes from the container, only for these.
 */
class Notifier implements INotifier {
    /** Characters of a comment's text in its notification (then "…"). */
    public const COMMENT_PREVIEW = 200;

    private ?BoardStore $boards = null;
    private ?SharePolicy $policy = null;
    private ?ShareService $shares = null;
    private ?LinkPolicy $linkPolicy = null;

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
        if ($notification->getObjectType() === TemplateNotifications::OBJECT_TYPE
            && in_array($notification->getSubject(), [TemplateNotifications::SUGGESTED, TemplateNotifications::ADOPTED, TemplateNotifications::REJECTED], true)) {
            return $this->prepareTemplate($notification, $languageCode);
        }
        if ($notification->getObjectType() === ShapeLibNotifications::OBJECT_TYPE
            && in_array($notification->getSubject(), [ShapeLibNotifications::SUGGESTED, ShapeLibNotifications::ADOPTED, ShapeLibNotifications::REJECTED], true)) {
            return $this->prepareTemplate($notification, $languageCode);
        }
        if (in_array($notification->getSubject(), [CommentNotifications::MENTION, CommentNotifications::REPLY], true)
            && in_array($notification->getObjectType(), [CommentNotifications::OBJECT_COMMENT, CommentNotifications::OBJECT_THREAD], true)) {
            return $this->prepareComment($notification, $languageCode);
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
        // A disabled owner hides the board (job 245): not shown, but kept,
        // so it comes back when the account is enabled again.
        if ($board !== null && $board['owner'] !== $user->getUID()
            && ($this->linkPolicy ??= $this->container->get(LinkPolicy::class))->ownerHidden((string)$board['owner'])) {
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

    /**
     * A notification of a template suggestion, (job 203) or of a shape
     * library suggestion (see the class comment).
     *
     * @throws AlreadyProcessedException|UnknownNotificationException
     */
    private function prepareTemplate(INotification $notification, string $languageCode): INotification {
        if (preg_match('/^[1-9][0-9]{0,17}$/D', $notification->getObjectId()) !== 1) {
            throw new AlreadyProcessedException();
        }
        $id = (int)$notification->getObjectId();
        $user = $this->users->get($notification->getUser());
        if ($user === null || !$this->apps->isEnabledForUser(Application::APP_ID, $user) || !$this->guestsApp->allows($user)) {
            throw new AlreadyProcessedException();
        }
        $l = $this->l10n->get(Application::APP_ID, $languageCode);
        $subject = $notification->getSubject();
        // job 203: a shape library suggestion
        $lib = $notification->getObjectType() === ShapeLibNotifications::OBJECT_TYPE;
        if ($subject === TemplateNotifications::SUGGESTED || $subject === ShapeLibNotifications::SUGGESTED) {
            try {
                $admin = $this->container->get(IGroupManager::class)->isAdmin($user->getUID());
                $row = $admin ? $this->container->get($lib ? ShapeLibStore::class : TemplateStore::class)->pendingRow($id) : null;
            } catch (\Throwable $e) {
                // Database: keep the notification, the bell shows it later.
                $this->warn($e, $id, $lib ? 'shapelib' : 'template');
                throw new UnknownNotificationException();
            }
            if ($row === null) {
                throw new AlreadyProcessedException();
            }
            $by = $row['suggested_by'];
            $byName = $this->users->getDisplayName($by) ?? $by;
            $text = $lib ? $l->t('{user} suggested the shape library {name}') : $l->t('{user} suggested the template {name}');
            $notification->setParsedSubject(strtr($text, ['{user}' => $byName, '{name}' => $row['name']]));
            $notification->setRichSubject($text, [
                'user' => ['type' => 'user', 'id' => $by, 'name' => $byName],
                'name' => ['type' => 'highlight', 'id' => (string)$id, 'name' => $row['name']],
            ]);
            $notification->setLink($this->urls->linkToRouteAbsolute('settings.AdminSettings.index', ['section' => Application::APP_ID]));
        } else {
            $name = $notification->getSubjectParameters()['name'] ?? null;
            if (!is_string($name) || $name === '') {
                throw new AlreadyProcessedException();
            }
            if ($lib) {
                $text = $subject === ShapeLibNotifications::ADOPTED
                    ? $l->t('Your shape library {name} was adopted. Everyone can now use it.')
                    : $l->t('Your shape library suggestion {name} was not adopted.');
            } else {
                $text = $subject === TemplateNotifications::ADOPTED
                    ? $l->t('Your template {name} was adopted. Everyone can now insert it.')
                    : $l->t('Your template suggestion {name} was not adopted.');
            }
            $notification->setParsedSubject(strtr($text, ['{name}' => $name]));
            $notification->setRichSubject($text, ['name' => ['type' => 'highlight', 'id' => (string)$id, 'name' => $name]]);
            $notification->setLink($this->urls->linkToRouteAbsolute('knorke.page.index'));
        }
        $notification->setIcon($this->urls->getAbsoluteURL($this->urls->imagePath(Application::APP_ID, 'app-dark.svg')));
        return $notification;
    }

    /**
     * A notification of a comment (factory job 189, see the class comment).
     *
     * @throws AlreadyProcessedException|UnknownNotificationException
     */
    private function prepareComment(INotification $notification, string $languageCode): INotification {
        $mention = $notification->getSubject() === CommentNotifications::MENTION;
        if ($mention !== ($notification->getObjectType() === CommentNotifications::OBJECT_COMMENT)) {
            throw new AlreadyProcessedException();
        }
        $id = $mention ? $notification->getObjectId() : $notification->getSubjectParameters()['comment'] ?? null;
        if (!is_string($id) || preg_match('/^[1-9][0-9]{0,18}$/D', $id) !== 1) {
            throw new AlreadyProcessedException();
        }
        $user = $this->users->get($notification->getUser());
        if ($user === null || !$this->apps->isEnabledForUser(Application::APP_ID, $user) || !$this->guestsApp->allows($user)) {
            throw new AlreadyProcessedException();
        }
        try {
            $comments = $this->container->get(CommentService::class);
            $ctx = $comments->noteContext($id);
            $role = null;
            if ($ctx !== null) {
                if ($this->freshRights()) {
                    ($this->policy ??= $this->container->get(SharePolicy::class))->reset();
                }
                $role = $comments->roleOf($ctx['board'], $user);
            }
        } catch (\Throwable $e) {
            // Database or group backend: keep the notification, the bell shows it later.
            $this->warn($e, (int)$id, 'comment');
            throw new UnknownNotificationException();
        }
        if ($ctx === null || $role === null
            || (!$mention && $ctx['thread'] !== $notification->getObjectId())
            || ($mention && !in_array($user->getUID(), $ctx['mentions'], true))) {
            throw new AlreadyProcessedException();
        }
        $l = $this->l10n->get(Application::APP_ID, $languageCode);
        $author = $ctx['author'];
        $name = match ($author['type']) {
            'user' => $author['name'],
            'guest' => strtr($l->t('{name} (guest)'), ['{name}' => $author['name']]),
            default => $l->t('Deleted user'),
        };
        $text = $mention ? $l->t('{user} mentioned you in a comment on {board}') : $l->t('{user} replied in a comment thread on {board}');
        $notification->setParsedSubject(strtr($text, ['{user}' => $name, '{board}' => $ctx['title']]));
        $notification->setRichSubject($text, [
            'user' => $author['type'] === 'user'
                ? ['type' => 'user', 'id' => $author['id'], 'name' => $name]
                : ['type' => 'highlight', 'id' => $id, 'name' => $name],
            'board' => ['type' => 'highlight', 'id' => (string)$ctx['board'], 'name' => $ctx['title']],
        ]);
        $message = $ctx['text'];
        if (mb_strlen($message, 'UTF-8') > self::COMMENT_PREVIEW) {
            $message = mb_substr($message, 0, self::COMMENT_PREVIEW, 'UTF-8') . '…';
        }
        if ($message !== '') {
            $notification->setParsedMessage($message);
        }
        $notification->setLink($this->urls->linkToRouteAbsolute('knorke.page.board', ['id' => $ctx['board']]) . '?comment=' . $ctx['thread']);
        $notification->setIcon($this->urls->getAbsoluteURL($this->urls->imagePath(Application::APP_ID, 'app-dark.svg')));
        return $notification;
    }

    /** Long-running CLI processes (cron.php, occ background-job:worker) forget SharePolicy's answers before every check; a web request is a fresh process. */
    protected function freshRights(): bool {
        return PHP_SAPI === 'cli';
    }

    /** The logger only on this rare path (no constructor argument: the constructor stays light). */
    private function warn(\Throwable $e, int $id, string $kind = 'board'): void {
        try {
            $this->container->get(LoggerInterface::class)->warning('Knorke: preparing a ' . ($kind === 'board' ? 'share' : $kind) . ' notification failed', ['exception' => $e, 'app' => 'knorke', $kind => $id]);
        } catch (\Throwable) {
        }
    }
}
