<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Listener;

use OCA\Knorke\AppInfo\Application;
use OCA\Knorke\Service\AiService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\TaskProcessing\Events\TaskFailedEvent;
use OCP\TaskProcessing\Events\TaskSuccessfulEvent;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * An AI task ended (factory job 267): Nextcloud's AI worker sets the result
 * and dispatches TaskSuccessfulEvent or TaskFailedEvent, outside any
 * transaction. Tasks of other apps return before a service is built; a
 * task of Knorke goes to AiService::finish, which writes the result onto the
 * board whether or not a tab is open. Never throws (an exception would land
 * in the worker); failures are logged.
 *
 * @template-implements IEventListener<Event>
 */
class AiTaskListener implements IEventListener {
    public function __construct(
        private ContainerInterface $container,
        private LoggerInterface $logger,
    ) {
    }

    public function handle(Event $event): void {
        if (!($event instanceof TaskSuccessfulEvent) && !($event instanceof TaskFailedEvent)) {
            return;
        }
        try {
            $task = $event->getTask();
            if ($task->getAppId() !== Application::APP_ID) {
                return;
            }
            $this->container->get(AiService::class)->finish($task, (int)floor(microtime(true) * 1000));
        } catch (\Throwable $e) {
            $this->logger->warning('Knorke: AI task result not handled', ['exception' => $e, 'app' => 'knorke']);
        }
    }
}
