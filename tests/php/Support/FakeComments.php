<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OC\Comments\Comment;
use OCP\Comments\IComment;
use OCP\Comments\ICommentsManager;
use OCP\Comments\NotFoundException;

/**
 * Nextcloud's comment store in memory (factory job 189): manager() is an
 * ICommentsManager (Fake, so it follows the running server's signatures)
 * over $rows, with Nextcloud's own OC\Comments\Comment as the comment
 * class (its setMessage, getMentions and meta data are the real ones).
 *
 * Like the database: save() stores a copy (a new comment gets the next id,
 * parent '0' = a first comment), get() and getForObject() hand out copies
 * (getForObject newest first, as Nextcloud does), delete() removes exactly
 * one row, deleteCommentsAtObject() every row of the object. Every call
 * that writes or counts is logged in $log ("save 3", "delete 3",
 * "deleteCommentsAtObject knorke_board 7", "count knorke_board 7 comment").
 */
final class FakeComments {
    /** @var array<string, IComment> id → stored copy */
    public array $rows = [];
    /** @var list<string> */
    public array $log = [];
    private int $next = 1;
    private ICommentsManager $manager;

    public function __construct() {
        $this->manager = Fake::of(ICommentsManager::class, [
            'create' => fn ($actorType, $actorId, $objectType, $objectId): IComment => (new Comment())->setActor($actorType, $actorId)->setObject($objectType, $objectId),
            'save' => function (IComment $c): bool {
                if ($c->getId() === '') {
                    $c->setId((string)$this->next++);
                    $c->setChildrenCount(0);
                }
                try {
                    $c->getCreationDateTime();
                } catch (\LogicException) {
                    $c->setCreationDateTime(new \DateTime('@1760000000'));
                }
                $this->log[] = 'save ' . $c->getId();
                $this->rows[$c->getId()] = clone $c;
                return true;
            },
            'get' => function ($id): IComment {
                if ((int)$id === 0) {
                    throw new \InvalidArgumentException('IDs must be translatable to a number in this implementation.');
                }
                $c = $this->rows[(string)$id] ?? throw new NotFoundException();
                return clone $c;
            },
            'delete' => function ($id): bool {
                $this->log[] = 'delete ' . $id;
                $had = isset($this->rows[(string)$id]);
                unset($this->rows[(string)$id]);
                return $had;
            },
            'getForObject' => function ($objectType, $objectId, $limit = 0, $offset = 0, $notOlderThan = null): array {
                $out = array_values(array_map(static fn (IComment $c): IComment => clone $c, array_filter($this->rows,
                    static fn (IComment $c): bool => $c->getObjectType() === $objectType && $c->getObjectId() === $objectId)));
                usort($out, static fn (IComment $a, IComment $b): int => (int)$b->getId() <=> (int)$a->getId());
                return $out;
            },
            'getNumberOfCommentsForObject' => function ($objectType, $objectId, $notOlderThan = null, $verb = ''): int {
                $this->log[] = "count $objectType $objectId $verb";
                return count(array_filter($this->rows, static fn (IComment $c): bool => $c->getObjectType() === $objectType
                    && $c->getObjectId() === $objectId && ($verb === '' || $c->getVerb() === $verb)));
            },
            'deleteCommentsAtObject' => function ($objectType, $objectId): bool {
                $this->log[] = "deleteCommentsAtObject $objectType $objectId";
                foreach ($this->rows as $id => $c) {
                    if ($c->getObjectType() === $objectType && $c->getObjectId() === $objectId) {
                        unset($this->rows[$id]);
                    }
                }
                return true;
            },
        ]);
    }

    public function manager(): ICommentsManager {
        return $this->manager;
    }

    /** knorke meta data of a stored comment ([] without). */
    public function knorke(string $id): array {
        return ($this->rows[$id]->getMetaData() ?? [])['knorke'] ?? [];
    }
}
