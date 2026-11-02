<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Service;

use OCA\Knorke\Exception\HttpError;
use OCA\Knorke\Notification\ShapeLibNotifications;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;

/**
 * Own shape libraries (factory job 203, routes 46–54) in the app data folder
 * of Knorke (IAppData): no table, so no migration.
 *
 * Folders: FOLDER_USER + sha256(uid) per account (its own libraries; the
 * folder name is a hash, never a path from the uid), FOLDER_ADOPTED (the
 * libraries of this Nextcloud) and FOLDER_PENDING (one marker per open
 * suggestion). A library is two files: <id>.meta.json {id, name, names,
 * created, adopted?} (what the lists read) and <id>.json (its entries
 * [{name, img, w, h}]). A suggestion is a marker <id>.json {uid, note,
 * created} beside the own library <id>; adopting copies that library into
 * FOLDER_ADOPTED under a new id (without note and owner) and the own one
 * stays with its account. Ids are random 15-digit numbers.
 *
 * The right of an account is TemplateStore's (rightOf): an account of the
 * Guests app none (null: 403, empty list), an admin 'save' (suggesting
 * adopts a copy at once), every other account 'suggest'.
 *
 *  - Route 46 listFor: {right, adopted: [{id, name, names}] last adopted
 *    first, own: [{id, name, names, pending}] newest first}.
 *  - Route 47 create: {name, entries} → an own library; at most OWN_MAX per
 *    account (counted without a lock: two parallel requests may pass it by
 *    one, like the templates).
 *  - Route 48 content: the entries of an own or adopted library, of a
 *    foreign one only while it is suggested and only for admins.
 *  - Route 49 rename: own (its account), adopted (admins, 403 for others).
 *  - Route 50 delete: own (also ends its suggestion), adopted (admins, 403
 *    for others), a foreign suggested one (admins: rejected, the library
 *    stays with its account).
 *  - Route 51 suggest {note?}: an own library; an admin adopts a copy at
 *    once, anyone else leaves a marker (at most PENDING_MAX open ones; a
 *    second suggestion of the same library keeps the first).
 *  - Route 52 adopt (admins): a suggested library becomes a copy in
 *    FOLDER_ADOPTED; a second adopt finds no marker (404).
 *  - Route 53 review (admins): the open suggestions, oldest first, with who
 *    made them, and the adopted libraries.
 *  - Route 54 withdraw: the account ends the suggestion of its library.
 * Anything foreign or unknown answers 404, so nobody learns that it exists.
 * Every check comes before the first write. Notifications
 * (ShapeLibNotifications, object shapelib/<id of the own library>) go
 * after the write and never change the answer.
 *
 * Limits (src/board/shapeImport.js holds the same numbers, a node test
 * compares them): OWN_MAX libraries per account, PENDING_MAX open
 * suggestions, ENTRIES_MAX entries per library, MAX_BODY_BYTES of request
 * body (route 47), names by Input::title of 1–NAME_MAX characters, a note
 * of at most NOTE_MAX ('' → none), w and h numbers in [1, SIDE_MAX], each
 * picture by ShapeImage::isUri.
 *
 * A deleted account (UserDeletedListener → onUserDeleted): its folder goes,
 * its suggestions with it (their admin notifications done); adopted
 * libraries carry no uid and stay.
 *
 * Owner file (factory job 247): the folder name is a hash, so create() puts
 * OWNER = {"uid": <uid>} into the account's folder. It counts only while
 * userFolder(uid) is that folder; otherwise the folder has no owner (folders
 * from before job 247). OrphanReconciler finds the libraries of accounts
 * deleted while Knorke was disabled through it (userFolders, markerUids,
 * countOf, countFolder, deleteFolder, claimFolder).
 */
class ShapeLibStore {
    public const OWN_MAX = 20;
    public const PENDING_MAX = 10;
    public const ENTRIES_MAX = 300;
    /** Request body of route 47 (4 MiB). */
    public const MAX_BODY_BYTES = 4194304;
    public const NAME_MAX = 100;
    public const NOTE_MAX = 200;
    public const SIDE_MAX = 4000;

    public const FOLDER_USER = 'shapelibs_u_';
    public const FOLDER_ADOPTED = 'shapelibs_adopted';
    public const FOLDER_PENDING = 'shapelibs_pending';

    /** The owner file in an account's folder (job 247). */
    public const OWNER = 'owner.json';
    private const META = '.meta.json';
    private const HASH_RE = '/^[0-9a-f]{64}$/D';
    private const DATA = '.json';
    private const ID_RE = '/^[1-9][0-9]{14}$/D';

    /** Tests only (job 251): the candidates of newId() instead of random_int. */
    public ?\Closure $idSource = null;

    public function __construct(
        private IAppData $appData,
        private IUserManager $users,
        private IGroupManager $groups,
        private ShapeLibNotifications $notes,
    ) {
    }

    /** The right of an account: null (Guests app), 'save' (admin) or 'suggest' (TemplateStore::rightOf). */
    public function rightOf(IUser $user): ?string {
        if ($user->getBackendClassName() === GuestsAppWhitelist::BACKEND) {
            return null;
        }
        return $this->groups->isAdmin($user->getUID()) ? 'save' : 'suggest';
    }

    /** Does the account decide on suggestions (rightOf 'save')? */
    public function isAdmin(IUser $user): bool {
        return $this->rightOf($user) === 'save';
    }

    /**
     * Route 46.
     *
     * @return array{right: ?string, adopted: list<array<string, mixed>>, own: list<array<string, mixed>>}
     */
    public function listFor(IUser $user): array {
        $right = $this->rightOf($user);
        if ($right === null) {
            return ['right' => null, 'adopted' => [], 'own' => []];
        }
        $adopted = array_map(static fn (array $m): array => ['id' => $m['id'], 'name' => $m['name'], 'names' => $m['names']], $this->metas(self::FOLDER_ADOPTED, 'adopted'));
        $pending = $this->folder(self::FOLDER_PENDING, false);
        $own = array_map(static fn (array $m): array => ['id' => $m['id'], 'name' => $m['name'], 'names' => $m['names'],
            'pending' => $pending !== null && $pending->fileExists($m['id'] . self::DATA)], $this->metas(self::userFolder($user->getUID()), 'created'));
        return ['right' => $right, 'adopted' => $adopted, 'own' => $own];
    }

    /**
     * Route 47: a new own library. Every check comes before the write.
     *
     * @param array<string, mixed> $body {name, entries} (JsonBody)
     * @return array{id: int}
     * @throws HttpError 400 name_required|bad_request, 403 forbidden, 409 library_limit {max}
     */
    public function create(IUser $user, array $body, int $nowMs): array {
        $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $name = self::checkName($body['name'] ?? null);
        $entries = self::checkEntries($body['entries'] ?? null);
        $folderName = self::userFolder($user->getUID());
        if (count($this->metas($folderName, 'created')) >= self::OWN_MAX) {
            throw new HttpError(409, 'library_limit', '', ['max' => self::OWN_MAX]);
        }
        $folder = $this->folder($folderName, true);
        if ($this->ownerOf($folder) === null) {
            $this->putOwner($folder, $user->getUID());
        }
        $id = $this->newId($folder);
        $this->write($folder, $id, $name, $entries, ['created' => $nowMs]);
        return ['id' => (int)$id];
    }

    /**
     * Route 48: the entries of a library this account may see.
     *
     * @return list<array{name: string, img: string, w: int|float, h: int|float}>
     * @throws HttpError 403 forbidden (Guests app), 404 not_found
     */
    public function content(IUser $user, int $id): array {
        $right = $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $key = self::key($id);
        foreach ([self::userFolder($user->getUID()), self::FOLDER_ADOPTED] as $name) {
            $folder = $this->folder($name, false);
            if ($folder !== null && $folder->fileExists($key . self::DATA) && $folder->fileExists($key . self::META)) {
                return $this->entries($folder, $key);
            }
        }
        $marker = $right === 'save' ? $this->marker($key) : null;
        $folder = $marker === null ? null : $this->folder(self::userFolder($marker['uid']), false);
        if ($folder === null || !$folder->fileExists($key . self::DATA)) {
            throw new HttpError(404, 'not_found');
        }
        return $this->entries($folder, $key);
    }

    /**
     * Route 49: renames an own library (its account) or an adopted one (admins).
     *
     * @param array<string, mixed> $body {name} (JsonBody)
     * @return array{id: int, name: string}
     * @throws HttpError 400 name_required|bad_request, 403 forbidden, 404 not_found
     */
    public function rename(IUser $user, int $id, array $body): array {
        $right = $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $name = self::checkName($body['name'] ?? null);
        $key = self::key($id);
        [$folder, $adopted] = $this->ownOrAdopted($user, $key);
        if ($adopted && $right !== 'save') {
            throw new HttpError(403, 'forbidden');
        }
        $meta = $this->meta($folder, $key) ?? throw new HttpError(404, 'not_found');
        $meta['name'] = $name;
        $folder->getFile($key . self::META)->putContent(self::json($meta));
        return ['id' => $id, 'name' => $name];
    }

    /**
     * Route 50: deletes an own library (and ends its suggestion), an adopted
     * one (admins) or rejects a foreign suggestion (admins).
     *
     * @throws HttpError 403 forbidden, 404 not_found
     */
    public function delete(IUser $user, int $id): void {
        $right = $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $key = self::key($id);
        $own = $this->folder(self::userFolder($user->getUID()), false);
        if ($own !== null && $own->fileExists($key . self::META)) {
            $this->remove($own, $key);
            if ($this->dropMarker($key)) {
                $this->notes->processed($id);
            }
            return;
        }
        $adopted = $this->folder(self::FOLDER_ADOPTED, false);
        if ($adopted !== null && $adopted->fileExists($key . self::META)) {
            if ($right !== 'save') {
                throw new HttpError(403, 'forbidden');
            }
            $this->remove($adopted, $key);
            return;
        }
        $marker = $right === 'save' ? $this->marker($key) : null;
        if ($marker === null || !$this->dropMarker($key)) {
            throw new HttpError(404, 'not_found');
        }
        $this->notes->processed($id);
        $meta = $this->meta($this->folder(self::userFolder($marker['uid']), false), $key);
        if ($meta !== null) {
            $this->notes->decided($id, $marker['uid'], false, $meta['name']);
        }
    }

    /**
     * Route 51: suggests an own library to the admins; an admin adopts a copy at once.
     *
     * @param array<string, mixed> $body {note?} (JsonBody)
     * @return array{id: int, state: string} the own library (pending) or the adopted copy
     * @throws HttpError 400 bad_request, 403 forbidden, 404 not_found, 409 suggestion_limit {max}
     */
    public function suggest(IUser $user, int $id, array $body, int $nowMs): array {
        $right = $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $note = self::checkNote($body['note'] ?? null);
        $key = self::key($id);
        $uid = $user->getUID();
        $own = $this->folder(self::userFolder($uid), false);
        $meta = $own === null ? null : $this->meta($own, $key);
        if ($meta === null || !$own->fileExists($key . self::DATA)) {
            throw new HttpError(404, 'not_found');
        }
        if ($right === 'save') {
            return ['id' => $this->adoptCopy($own, $key, $meta, $nowMs), 'state' => 'adopted'];
        }
        if ($this->marker($key) !== null) {
            return ['id' => $id, 'state' => 'pending'];
        }
        $mine = array_filter($this->markers(), static fn (array $m): bool => $m['uid'] === $uid);
        if (count($mine) >= self::PENDING_MAX) {
            throw new HttpError(409, 'suggestion_limit', 'You have reached the most open shape library suggestions an account may have.', ['max' => self::PENDING_MAX]);
        }
        $this->folder(self::FOLDER_PENDING, true)->newFile($key . self::DATA, self::json(['uid' => $uid, 'note' => $note, 'created' => $nowMs]));
        $this->notes->suggested($id);
        return ['id' => $id, 'state' => 'pending'];
    }

    /**
     * Route 52 (admins): a suggested library becomes an adopted copy; its
     * account keeps its own one and is told.
     *
     * @return array{id: int} the adopted copy
     * @throws HttpError 403 forbidden, 404 not_found
     */
    public function adopt(IUser $user, int $id, int $nowMs): array {
        $this->requireAdmin($user);
        $key = self::key($id);
        $marker = $this->marker($key) ?? throw new HttpError(404, 'not_found');
        $folder = $this->folder(self::userFolder($marker['uid']), false);
        $meta = $folder === null ? null : $this->meta($folder, $key);
        if ($meta === null || !$folder->fileExists($key . self::DATA) || !$this->dropMarker($key)) {
            throw new HttpError(404, 'not_found');
        }
        $copy = $this->adoptCopy($folder, $key, $meta, $nowMs);
        $this->notes->processed($id);
        $this->notes->decided($id, $marker['uid'], true, $meta['name']);
        return ['id' => $copy];
    }

    /**
     * Route 53 (admins): the open suggestions, oldest first, and the adopted libraries, last adopted first.
     *
     * @return array{suggestions: list<array<string, mixed>>, adopted: list<array<string, mixed>>}
     * @throws HttpError 403 forbidden
     */
    public function review(IUser $user): array {
        $this->requireAdmin($user);
        $suggestions = [];
        $names = [];
        foreach ($this->markers() as $m) {
            $meta = $this->meta($this->folder(self::userFolder($m['uid']), false), $m['id']);
            if ($meta === null) {
                continue;
            }
            $names[$m['uid']] ??= $this->users->getDisplayName($m['uid']) ?? $m['uid'];
            $suggestions[] = ['id' => (int)$m['id'], 'name' => $meta['name'], 'names' => $meta['names'], 'note' => $m['note'],
                'by' => $names[$m['uid']], 'created' => $m['created']];
        }
        usort($suggestions, static fn (array $a, array $b): int => [$a['created'], $a['id']] <=> [$b['created'], $b['id']]);
        $adopted = array_map(static fn (array $m): array => ['id' => $m['id'], 'name' => $m['name'], 'names' => $m['names'], 'adopted' => $m['adopted']],
            $this->metas(self::FOLDER_ADOPTED, 'adopted'));
        return ['suggestions' => $suggestions, 'adopted' => $adopted];
    }

    /**
     * Route 54: the account ends the suggestion of its own library.
     *
     * @throws HttpError 403 forbidden, 404 not_found
     */
    public function withdraw(IUser $user, int $id): void {
        $this->rightOf($user) ?? throw new HttpError(403, 'forbidden');
        $key = self::key($id);
        $marker = $this->marker($key);
        if ($marker === null || $marker['uid'] !== $user->getUID() || !$this->dropMarker($key)) {
            throw new HttpError(404, 'not_found');
        }
        $this->notes->processed($id);
    }

    /**
     * What Notifier shows a shapelib_suggested for: {name, suggested_by} of
     * a library while it is suggested, else null.
     *
     * @return array{name: string, suggested_by: string}|null
     */
    public function pendingRow(int $id): ?array {
        $key = self::key($id);
        $marker = $this->marker($key);
        $meta = $marker === null ? null : $this->meta($this->folder(self::userFolder($marker['uid']), false), $key);
        return $meta === null ? null : ['name' => $meta['name'], 'suggested_by' => $marker['uid']];
    }

    /** A deleted account (UserDeletedListener): its libraries and suggestions go. */
    public function onUserDeleted(string $uid): void {
        foreach ($this->markers() as $m) {
            if ($m['uid'] === $uid && $this->dropMarker($m['id'])) {
                $this->notes->processed((int)$m['id']);
            }
        }
        $this->folder(self::userFolder($uid), false)?->delete();
    }

    /** The folder of an account's own libraries: a hash of the uid. */
    public static function userFolder(string $uid): string {
        return self::FOLDER_USER . self::folderHash($uid);
    }

    /** The hash part of userFolder($uid). */
    public static function folderHash(string $uid): string {
        return hash('sha256', $uid);
    }

    /**
     * Every account folder (job 247): the uids of those with a valid owner
     * file, and the hash parts of those without one.
     *
     * @return array{owned: list<string>, unowned: list<string>}
     */
    public function userFolders(): array {
        $owned = [];
        $unowned = [];
        foreach ($this->appData->getDirectoryListing() as $folder) {
            $name = $folder->getName();
            $hash = str_starts_with($name, self::FOLDER_USER) ? substr($name, strlen(self::FOLDER_USER)) : '';
            if (preg_match(self::HASH_RE, $hash) !== 1) {
                continue;
            }
            $uid = $this->ownerOf($folder);
            if ($uid === null) {
                $unowned[] = $hash;
            } else {
                $owned[] = $uid;
            }
        }
        return ['owned' => $owned, 'unowned' => $unowned];
    }

    /** @return list<string> the uids of the open suggestions (job 247) */
    public function markerUids(): array {
        return array_values(array_unique(array_column($this->markers(), 'uid')));
    }

    /** Libraries in the folder of $uid (job 247). */
    public function countOf(string $uid): int {
        return count($this->metas(self::userFolder($uid), 'created'));
    }

    /** Open suggestions of $uid (job 247). */
    public function markerCount(string $uid): int {
        return count(array_filter($this->markers(), static fn (array $m): bool => $m['uid'] === $uid));
    }

    /** Libraries in the account folder with hash part $hash (job 247). */
    public function countFolder(string $hash): int {
        return preg_match(self::HASH_RE, $hash) === 1 ? count($this->metas(self::FOLDER_USER . $hash, 'created')) : 0;
    }

    /**
     * Is there an account folder with hash part $hash (job 247)? Read from
     * the listing: IAppData::getFolder keeps a folder deleted in the same
     * process in its cache.
     */
    public function folderExists(string $hash): bool {
        if (preg_match(self::HASH_RE, $hash) !== 1) {
            return false;
        }
        foreach ($this->appData->getDirectoryListing() as $folder) {
            if ($folder->getName() === self::FOLDER_USER . $hash) {
                return true;
            }
        }
        return false;
    }

    /** Deletes the account folder with hash part $hash (job 247: one without owner whose account Nextcloud no longer knows). */
    public function deleteFolder(string $hash): void {
        if (preg_match(self::HASH_RE, $hash) === 1) {
            $this->folder(self::FOLDER_USER . $hash, false)?->delete();
        }
    }

    /** Writes the owner file of $uid into its folder if that has no valid one (job 247: folders from before it). */
    public function claimFolder(string $uid): void {
        $folder = $this->folder(self::userFolder($uid), false);
        if ($folder !== null && $this->ownerOf($folder) === null) {
            $this->putOwner($folder, $uid);
        }
    }

    /** The uid of a valid owner file in $folder (userFolder(uid) is $folder), else null. */
    private function ownerOf(ISimpleFolder $folder): ?string {
        try {
            if (!$folder->fileExists(self::OWNER)) {
                return null;
            }
            $o = json_decode($folder->getFile(self::OWNER)->getContent(), true);
        } catch (NotFoundException) {
            return null;
        }
        $uid = is_array($o) ? ($o['uid'] ?? null) : null;
        return is_string($uid) && self::userFolder($uid) === $folder->getName() ? $uid : null;
    }

    private function putOwner(ISimpleFolder $folder, string $uid): void {
        $json = self::json(['uid' => $uid]);
        if ($folder->fileExists(self::OWNER)) {
            $folder->getFile(self::OWNER)->putContent($json);
        } else {
            $folder->newFile(self::OWNER, $json);
        }
    }

    /** @throws HttpError 403 forbidden */
    private function requireAdmin(IUser $user): void {
        if (!$this->isAdmin($user)) {
            throw new HttpError(403, 'forbidden');
        }
    }

    /** @throws HttpError 404 not_found for an id that is no library id */
    private static function key(int $id): string {
        $key = (string)$id;
        if (preg_match(self::ID_RE, $key) !== 1) {
            throw new HttpError(404, 'not_found');
        }
        return $key;
    }

    /**
     * @return array{0: ISimpleFolder, 1: bool} the folder of an own (false) or adopted (true) library
     * @throws HttpError 404 not_found
     */
    private function ownOrAdopted(IUser $user, string $key): array {
        foreach ([[self::userFolder($user->getUID()), false], [self::FOLDER_ADOPTED, true]] as [$name, $adopted]) {
            $folder = $this->folder($name, false);
            if ($folder !== null && $folder->fileExists($key . self::META)) {
                return [$folder, $adopted];
            }
        }
        throw new HttpError(404, 'not_found');
    }

    private function folder(string $name, bool $create): ?ISimpleFolder {
        try {
            return $this->appData->getFolder($name);
        } catch (NotFoundException) {
            return $create ? $this->appData->newFolder($name) : null;
        }
    }

    /**
     * A new random id, free in $folder, in FOLDER_ADOPTED and among the
     * suggestion markers of FOLDER_PENDING (job 251: a marker is global by
     * id, so a new own library never takes the id of another account's
     * open suggestion).
     */
    private function newId(ISimpleFolder $folder): string {
        $adopted = $this->folder(self::FOLDER_ADOPTED, false);
        $pending = $this->folder(self::FOLDER_PENDING, false);
        do {
            $id = $this->idSource !== null ? (string)($this->idSource)() : (string)random_int(100000000000000, 999999999999999);
        } while ($folder->fileExists($id . self::META) || ($adopted !== null && $adopted->fileExists($id . self::META))
            || ($pending !== null && $pending->fileExists($id . self::DATA)));
        return $id;
    }

    /**
     * @param list<array{name: string, img: string, w: int|float, h: int|float}> $entries
     * @param array<string, int> $extra created, adopted
     */
    private function write(ISimpleFolder $folder, string $id, string $name, array $entries, array $extra): void {
        $folder->newFile($id . self::DATA, self::json($entries));
        $folder->newFile($id . self::META, self::json(['id' => (int)$id, 'name' => $name, 'names' => array_column($entries, 'name')] + $extra));
    }

    /**
     * @param array{id: int, name: string, names: list<string>, created: int} $meta
     * @return int the id of the adopted copy
     */
    private function adoptCopy(ISimpleFolder $from, string $key, array $meta, int $nowMs): int {
        $entries = $this->entries($from, $key);
        $adopted = $this->folder(self::FOLDER_ADOPTED, true);
        $id = $this->newId($adopted);
        $this->write($adopted, $id, $meta['name'], $entries, ['created' => $meta['created'], 'adopted' => $nowMs]);
        return (int)$id;
    }

    private function remove(ISimpleFolder $folder, string $key): void {
        foreach ([self::META, self::DATA] as $ext) {
            if ($folder->fileExists($key . $ext)) {
                $folder->getFile($key . $ext)->delete();
            }
        }
    }

    /**
     * The metas of a folder, newest first by $order (created or adopted); unreadable ones are left out.
     *
     * @return list<array{id: int, name: string, names: list<string>, created: int, adopted: int}>
     */
    private function metas(string $name, string $order): array {
        $folder = $this->folder($name, false);
        if ($folder === null) {
            return [];
        }
        $out = [];
        foreach ($folder->getDirectoryListing() as $file) {
            $n = $file->getName();
            if (!str_ends_with($n, self::META)) {
                continue;
            }
            $meta = $this->meta($folder, substr($n, 0, -strlen(self::META)));
            if ($meta !== null) {
                $out[] = $meta;
            }
        }
        usort($out, static fn (array $a, array $b): int => [$b[$order], $b['id']] <=> [$a[$order], $a['id']]);
        return $out;
    }

    /** @return array{id: int, name: string, names: list<string>, created: int, adopted: int}|null */
    private function meta(?ISimpleFolder $folder, string $key): ?array {
        if ($folder === null || preg_match(self::ID_RE, $key) !== 1 || !$folder->fileExists($key . self::META)) {
            return null;
        }
        $m = json_decode($folder->getFile($key . self::META)->getContent(), true);
        if (!is_array($m) || !is_string($m['name'] ?? null) || !is_array($m['names'] ?? null)) {
            return null;
        }
        return ['id' => (int)$key, 'name' => $m['name'], 'names' => array_values(array_filter($m['names'], 'is_string')),
            'created' => (int)($m['created'] ?? 0), 'adopted' => (int)($m['adopted'] ?? 0)];
    }

    /** @return list<array{name: string, img: string, w: int|float, h: int|float}> */
    private function entries(ISimpleFolder $folder, string $key): array {
        $list = json_decode($folder->getFile($key . self::DATA)->getContent(), true);
        return is_array($list) ? array_values(array_filter($list, 'is_array')) : [];
    }

    /** @return array{id: string, uid: string, note: ?string, created: int}|null the open suggestion of library $key */
    private function marker(string $key): ?array {
        $pending = $this->folder(self::FOLDER_PENDING, false);
        if ($pending === null || !$pending->fileExists($key . self::DATA)) {
            return null;
        }
        $m = json_decode($pending->getFile($key . self::DATA)->getContent(), true);
        if (!is_array($m) || !is_string($m['uid'] ?? null)) {
            return null;
        }
        return ['id' => $key, 'uid' => $m['uid'], 'note' => is_string($m['note'] ?? null) ? $m['note'] : null, 'created' => (int)($m['created'] ?? 0)];
    }

    /** @return list<array{id: string, uid: string, note: ?string, created: int}> every open suggestion */
    private function markers(): array {
        $pending = $this->folder(self::FOLDER_PENDING, false);
        $out = [];
        foreach ($pending === null ? [] : $pending->getDirectoryListing() as $file) {
            $key = substr($file->getName(), 0, -strlen(self::DATA));
            $m = preg_match(self::ID_RE, $key) === 1 ? $this->marker($key) : null;
            if ($m !== null) {
                $out[] = $m;
            }
        }
        return $out;
    }

    /** @return bool the marker of library $key was there and is gone now */
    private function dropMarker(string $key): bool {
        $pending = $this->folder(self::FOLDER_PENDING, false);
        if ($pending === null || !$pending->fileExists($key . self::DATA)) {
            return false;
        }
        try {
            $pending->getFile($key . self::DATA)->delete();
        } catch (NotFoundException) {
            // another admin was first
            return false;
        }
        return true;
    }

    /** @throws HttpError 400 name_required|bad_request */
    private static function checkName(mixed $v): string {
        $name = Input::title($v, self::NAME_MAX);
        if ($name === null) {
            throw new HttpError(400, 'bad_request', 'Invalid name.');
        }
        if ($name === '') {
            throw new HttpError(400, 'name_required', 'A name is required.');
        }
        return $name;
    }

    /** @throws HttpError 400 bad_request */
    private static function checkNote(mixed $v): ?string {
        $note = Input::title($v, self::NOTE_MAX);
        if ($note === null) {
            throw new HttpError(400, 'bad_request', 'Invalid note.');
        }
        return $note === '' ? null : $note;
    }

    /**
     * @return list<array{name: string, img: string, w: int|float, h: int|float}>
     * @throws HttpError 400 bad_request
     */
    private static function checkEntries(mixed $v): array {
        if (!is_array($v) || $v === [] || !array_is_list($v) || count($v) > self::ENTRIES_MAX) {
            throw new HttpError(400, 'bad_request', 'Invalid entries.');
        }
        $out = [];
        foreach ($v as $e) {
            $name = is_array($e) ? Input::title($e['name'] ?? null, self::NAME_MAX) : null;
            $img = is_array($e) ? ($e['img'] ?? null) : null;
            $w = is_array($e) ? ($e['w'] ?? null) : null;
            $h = is_array($e) ? ($e['h'] ?? null) : null;
            if ($name === null || $name === '' || !ShapeImage::isUri($img) || !self::side($w) || !self::side($h)) {
                throw new HttpError(400, 'bad_request', 'Invalid entry.');
            }
            $out[] = ['name' => $name, 'img' => $img, 'w' => $w, 'h' => $h];
        }
        return $out;
    }

    private static function side(mixed $v): bool {
        return (is_int($v) || (is_float($v) && is_finite($v))) && $v >= 1 && $v <= self::SIDE_MAX;
    }

    private static function json(mixed $v): string {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
