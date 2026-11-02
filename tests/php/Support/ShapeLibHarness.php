<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Controller\ShapeLibApiController;
use OCA\Knorke\Notification\ShapeLibNotifications;
use OCA\Knorke\Service\ShapeLibStore;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;

/**
 * Own shape libraries (factory job 203) over an app data folder in memory
 * ($files: folder → name → content) and the accounts, groups, bell and
 * logger of TemplateHarness ($t): alice, bob (accounts), admin and root
 * (admins), gast (Guests app).
 *  - call(): one request through ShapeLibApiController as an account; the
 *    Content-Length is $length (default 42)
 *  - writes counts every newFile, putContent and delete; deleteFail (job
 *    247) makes deleting a folder throw; staleCache (job 247) makes
 *    getFolder return a folder it returned once even after it was deleted,
 *    like Nextcloud's AppData cache within one process
 */
final class ShapeLibHarness {
    public TemplateHarness $t;
    public ShapeLibStore $store;
    /** @var array<string, array<string, string>> folder → file → content */
    public array $files = [];
    public int $writes = 0;
    /** (job 247) deleting a folder throws this when set */
    public ?\Throwable $deleteFail = null;
    public bool $staleCache = false;
    /** @var array<string, true> folders getFolder returned */
    private array $fetched = [];

    public function __construct() {
        $this->t = new TemplateHarness();
        $time = Fake::of(ITimeFactory::class, ['getTime' => fn (): int => $this->t->time]);
        $notes = new ShapeLibNotifications($this->t->users, $this->t->groups, $this->t->apps, $this->t->manager, $time, $this->t->logger);
        $this->store = new ShapeLibStore($this->appData(), $this->t->users, $this->t->groups, $notes);
        $this->t->shapeLibs = $this->store;
    }

    public function user(string $uid): ?IUser {
        return $this->t->user($uid);
    }

    private function appData(): IAppData {
        return Fake::of(IAppData::class, [
            'getFolder' => function (string $name): ISimpleFolder {
                if (!isset($this->files[$name]) && !($this->staleCache && isset($this->fetched[$name]))) {
                    throw new NotFoundException($name);
                }
                $this->fetched[$name] = true;
                return $this->folder($name);
            },
            'newFolder' => function (string $name): ISimpleFolder {
                $this->files[$name] ??= [];
                return $this->folder($name);
            },
            'getDirectoryListing' => fn (): array => array_map(fn (string $n): ISimpleFolder => $this->folder($n), array_keys($this->files)),
        ]);
    }

    private function folder(string $name): ISimpleFolder {
        return Fake::of(ISimpleFolder::class, [
            'getName' => fn (): string => $name,
            'getDirectoryListing' => fn (): array => array_map(fn (string $f): ISimpleFile => $this->file($name, $f), array_keys($this->files[$name] ?? [])),
            'fileExists' => fn (string $f): bool => isset($this->files[$name][$f]),
            'getFile' => function (string $f) use ($name): ISimpleFile {
                if (!isset($this->files[$name][$f])) {
                    throw new NotFoundException($f);
                }
                return $this->file($name, $f);
            },
            'newFile' => function (string $f, $content = null) use ($name): ISimpleFile {
                $this->writes++;
                $this->files[$name][$f] = (string)$content;
                return $this->file($name, $f);
            },
            'delete' => function () use ($name): void {
                if ($this->deleteFail !== null) {
                    throw $this->deleteFail;
                }
                $this->writes++;
                unset($this->files[$name]);
            },
        ]);
    }

    private function file(string $folder, string $name): ISimpleFile {
        return Fake::of(ISimpleFile::class, [
            'getName' => fn (): string => $name,
            'getContent' => function () use ($folder, $name): string {
                if (!isset($this->files[$folder][$name])) {
                    throw new NotFoundException($name);
                }
                return $this->files[$folder][$name];
            },
            'putContent' => function ($data) use ($folder, $name): void {
                $this->writes++;
                $this->files[$folder][$name] = (string)$data;
            },
            'delete' => function () use ($folder, $name): void {
                if (!isset($this->files[$folder][$name])) {
                    throw new NotFoundException($name);
                }
                $this->writes++;
                unset($this->files[$folder][$name]);
            },
        ]);
    }

    /**
     * One request through ShapeLibApiController as $uid (the route parameter
     * id as text, like Nextcloud's router passes it).
     *
     * @return array{0: int, 1: mixed} status and data
     */
    public function call(string $uid, string $action, array $body = [], ?int $id = null, int $length = 42): array {
        $url = ['_route' => 'knorke.shapeLibApi.' . $action] + ($id === null ? [] : ['id' => (string)$id]);
        $params = array_merge($body, $url);
        $request = Fake::of(IRequest::class, [
            'getHeader' => fn (string $name): string => strtolower($name) === 'content-length' ? (string)$length : '',
            'getParams' => fn (): array => $params,
            'getParam' => fn (string $key, $default = null) => $params[$key] ?? $default,
        ], ['urlParams' => $url]);
        $user = $this->user($uid);
        $c = new ShapeLibApiController($request, $this->t->logger, Fake::of(IUserSession::class, ['getUser' => fn (): ?IUser => $user]), $this->store);
        $r = match ($action) {
            'index' => $c->index(),
            'create' => $c->create(),
            'show' => $c->show((int)$id),
            'update' => $c->update((int)$id),
            'destroy' => $c->destroy((int)$id),
            'suggest' => $c->suggest((int)$id),
            'adopt' => $c->adopt((int)$id),
            'review' => $c->review(),
            'withdraw' => $c->withdraw((int)$id),
        };
        return [$r->getStatus(), $r->getData()];
    }
}
