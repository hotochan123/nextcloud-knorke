<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Db;

use OCA\Knorke\Service\CommentService;
use OCP\IDBConnection;

/**
 * Finds Knorke comments whose meta data may mention an account (factory job
 * 249): rows of Nextcloud's core table comments with object type
 * knorke_board and verb comment whose meta_data contains the uid as a JSON
 * string, encoded as Nextcloud's comment manager stores it (json_encode
 * without flags). Only a pre-filter: the caller checks the decoded mentions.
 */
class CommentMentionStore {
    public function __construct(
        protected IDBConnection $db,
    ) {
    }

    /**
     * @return array<int, list<string>> board id → comment ids, boards and ids ascending
     */
    public function mentioning(string $uid): array {
        $needle = json_encode($uid);
        if (!is_string($needle)) {
            return [];
        }
        $qb = $this->db->getQueryBuilder();
        $qb->select('id', 'object_id')
            ->from('comments')
            ->where($qb->expr()->eq('object_type', $qb->createNamedParameter(CommentService::OBJECT_TYPE)))
            ->andWhere($qb->expr()->eq('verb', $qb->createNamedParameter(CommentService::VERB)))
            ->andWhere($qb->expr()->like('meta_data', $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($needle) . '%')))
            ->orderBy('id', 'ASC');
        $out = [];
        $res = $qb->executeQuery();
        try {
            while (($row = $res->fetchAssociative()) !== false) {
                $board = (int)$row['object_id'];
                if ($board > 0 && (string)$board === (string)$row['object_id']) {
                    $out[$board][] = (string)$row['id'];
                }
            }
        } finally {
            $res->closeCursor();
        }
        ksort($out);
        return $out;
    }
}
