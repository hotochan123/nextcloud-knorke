<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\AppInfo\Application;
use OCP\IAppConfig;
use OCP\Security\ISecureRandom;
use Psr\Log\LoggerInterface;

/**
 * The instance-wide board epoch (SPEC-M1 §5.4): app config `knorke/epoch`,
 * 6–16 characters [a-z0-9]. It is part of the Redis prefix of FastCache and
 * PresenceStore (`'knorke/' . $epoch . '/'`, §5.1) and every client sends it
 * back as `ep`. Turning it (`occ knorke:epoch:rotate`, after a DB restore)
 * makes every r:/a:/g:/p:/vt:/w:/pwf: key invisible at once and sends every
 * open tab through one resync.
 *
 * An injected service with instance methods, never called statically (§9.7).
 * The value is stored NOT lazy: it then sits in the preloaded app-config set
 * and the fast path reads it without a query. Nextcloud keeps a local copy of
 * that set (APCu, 3 s): after rotate() another PHP process may still see the
 * old epoch for up to 3 s.
 *
 * Missing epoch (repair step InitEpoch did not run) or an unusable value:
 * current() answers '0' and logs one warning per process.
 */
final class Epoch {
    public const KEY = 'epoch';
    /** Answer of current() without a usable stored epoch. */
    public const MISSING = '0';
    /** A stored epoch (InitEpoch and rotate() write 8 characters). */
    public const VALUE_RE = '/^[a-z0-9]{6,16}\z/';
    public const LENGTH = 8;

    private static bool $warned = false;

    public function __construct(
        private IAppConfig $appConfig,
        private ISecureRandom $random,
        private LoggerInterface $logger,
    ) {
    }

    /**
     * The current epoch, or '0' when none is stored (warning once per process).
     * Reads the preloaded (non-lazy) set only: no query on the fast path. A
     * value that sits in the lazy set counts as missing until InitEpoch or
     * rotate() moves it.
     */
    public function current(): string {
        try {
            $value = $this->appConfig->getValueString(Application::APP_ID, self::KEY, '', lazy: false);
        } catch (\Throwable $e) {
            $this->warnOnce('Knorke: the board epoch cannot be read; using "0".', $e);
            return self::MISSING;
        }
        if (preg_match(self::VALUE_RE, $value) !== 1) {
            $this->warnOnce($value === ''
                ? 'Knorke: no board epoch stored (repair step InitEpoch did not run); using "0". Run occ knorke:epoch:rotate.'
                : 'Knorke: the stored board epoch is invalid; using "0". Run occ knorke:epoch:rotate.');
            return self::MISSING;
        }
        return $value;
    }

    /**
     * Stores a new random epoch (never the current one) and returns it.
     * Not lazy, see the class comment.
     */
    public function rotate(): string {
        $old = $this->current();
        do {
            $new = $this->fresh();
        } while ($new === $old);
        $this->appConfig->setValueString(Application::APP_ID, self::KEY, $new, lazy: false);
        return $new;
    }

    /**
     * Repair step InitEpoch (SPEC-M1 §3.1): stores a fresh epoch when none is
     * set; never changes a set one. A set epoch that sits in the lazy set is
     * moved into the preloaded set with the same value.
     *
     * @return string|null the new epoch, null when one was set already
     */
    public function ensure(): ?string {
        $value = $this->appConfig->getValueString(Application::APP_ID, self::KEY, '', lazy: true);
        if ($value !== '') {
            if ($this->appConfig->isLazy(Application::APP_ID, self::KEY)) {
                $this->appConfig->setValueString(Application::APP_ID, self::KEY, $value, lazy: false);
            }
            return null;
        }
        $new = $this->fresh();
        $this->appConfig->setValueString(Application::APP_ID, self::KEY, $new, lazy: false);
        return $new;
    }

    /** 8 random characters [a-z0-9] (ISecureRandom). */
    private function fresh(): string {
        return $this->random->generate(self::LENGTH, ISecureRandom::CHAR_LOWER . ISecureRandom::CHAR_DIGITS);
    }

    private function warnOnce(string $message, ?\Throwable $e = null): void {
        if (self::$warned) {
            return;
        }
        self::$warned = true;
        $this->logger->warning($message, ['app' => Application::APP_ID] + ($e === null ? [] : ['exception' => $e]));
    }

    /** Tests only: forget that the warning was logged in this process. */
    public static function resetWarning(): void {
        self::$warned = false;
    }
}
