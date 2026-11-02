<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Tests\Support;

use OCA\Knorke\Db\CommentMentionStore;
use OCA\Knorke\Service\CommentService;
use OCP\IDBConnection;

/**
 * CommentMentionStore over FakeComments (factory job 249): the same
 * pre-filter as the SQL (object type, verb, the uid as a JSON string inside
 * the JSON of meta_data), boards and ids ascending. Calls in $calls;
 * $failWith makes it throw.
 */
final class FakeCommentMentionStore extends CommentMentionStore {
    /** @var list<string> */
    public array $calls = [];
    public ?\Throwable $failWith = null;

    public function __construct(IDBConnection $db, private FakeComments $comments) {
        parent::__construct($db);
    }

    public function mentioning(string $uid): array {
        $this->calls[] = $uid;
        if ($this->failWith !== null) {
            throw $this->failWith;
        }
        $needle = json_encode($uid);
        $out = [];
        foreach ($this->comments->rows as $id => $c) {
            if ($c->getObjectType() === CommentService::OBJECT_TYPE && $c->getVerb() === CommentService::VERB
                && str_contains((string)json_encode($c->getMetaData()), (string)$needle)) {
                $out[(int)$c->getObjectId()][] = (string)$id;
            }
        }
        ksort($out);
        foreach ($out as &$ids) {
            usort($ids, static fn (string $a, string $b): int => (int)$a <=> (int)$b);
        }
        return $out;
    }
}
