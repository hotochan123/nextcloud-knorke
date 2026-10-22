<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

declare(strict_types=1);

namespace OCA\Knorke\Exception;

/**
 * One exception for every client-visible failure of the app. The controllers
 * turn it into the app's error form (SPEC-M0 §4.2, SPEC-M1 §4.2):
 *
 *   {"error": "<code>", "message": "<English text>", …extra}
 *
 * with the given HTTP status. The code is what clients decide on (together
 * with the status); the message is plain English and never translated.
 *
 * $extra carries the additional body fields some codes define (SPEC-M1 §4.2):
 * `at` (index into the sent `shares`), `max` (too_many_new_shares), `maxDays`
 * (expiry_too_far), `retryMs` (slow_down; ApiResponses also sets the
 * Retry-After header from it) and `proto` (409 protocol). They come after
 * error and message and never replace them. The privacy notice of route 27
 * (M2) uses `at` as "default" or a language code, and `max` with
 * text_too_long and too_many_languages.
 *
 * The machine code lives in $error, not $code: \Exception already declares an
 * untyped $code that a readonly string property may not redeclare.
 */
final class HttpError extends \RuntimeException {
    /** Default English messages per error code (SPEC-M0 §4.2 + SPEC-M1 §4.2 tables). */
    private const MESSAGES = [
        // M0
        'bad_request' => 'Bad request.',
        'too_many_ops' => 'Too many operations in one request.',
        'name_required' => 'A name is required.',
        'title_required' => 'A title is required.',
        'guest_token' => 'The guest token is invalid or has expired.',
        'forbidden' => 'You are not allowed to do this.',
        'link_revoked' => 'This link has been revoked.',
        'links_disabled' => 'Link sharing is disabled by the administrator.',
        'cross_site' => 'Cross-site request refused.',
        'not_found' => 'Not found.',
        'protocol' => 'Outdated client, please reload.',
        'length_required' => 'Content-Length is required.',
        'too_large' => 'The request body is too large.',
        'rate_limited' => 'Too many requests, please try again later.',
        'internal' => 'Internal error.',
        'not_implemented' => 'Not implemented yet.',
        // M1 (SPEC-M1 §4.2)
        'password_enforced' => 'A password is required for links.',
        'password_policy' => 'The password does not meet the password policy.',
        'expiry_required' => 'An expiration date is required for links.',
        'expiry_too_far' => 'The expiration date is too far in the future.',
        'expiry_past' => 'The expiration date is in the past.',
        'group_sharing_disabled' => 'Sharing with groups is disabled.',
        'teams_unavailable' => 'Sharing with teams is not available.',
        'group_members_only' => 'You can only share with members of your own groups.',
        'recipient_not_found' => 'The recipient was not found.',
        'self_share' => 'You cannot share a board with yourself.',
        'too_many_shares' => 'This board has too many shares.',
        'too_many_new_shares' => 'Too many new recipients at once.',
        'vote_config' => 'Invalid voting settings.',
        'meta_too_large' => 'The board metadata is too large.',
        'sharing_disabled' => 'You are not allowed to share.',
        'password_required' => 'This link requires a password.',
        'password_wrong' => 'The password is wrong.',
        'link_expired' => 'This link has expired.',
        'vote_open' => 'A voting session is already open.',
        'vote_closed' => 'There is no matching voting session.',
        'timer_state' => 'The timer is not in a state that allows this.',
        'slow_down' => 'Too many requests, please wait a moment.',
        // M2 privacy notice (route 27, admin setting)
        'text_too_long' => 'The text is too long.',
        'invalid_url' => 'The address must be an absolute http or https URL.',
        'unknown_language' => 'This language is not available on this Nextcloud.',
        'too_many_languages' => 'Too many languages.',
    ];

    /** Keys of the error form itself; $extra never overrides them. */
    private const RESERVED = ['error', 'message'];

    /**
     * @param array<string, int|string|bool|null> $extra additional body fields (at, max, maxDays, retryMs, proto)
     */
    public function __construct(
        public readonly int $status,
        public readonly string $error,
        string $message = '',
        public readonly array $extra = [],
    ) {
        parent::__construct($message !== '' ? $message : (self::MESSAGES[$error] ?? $error));
    }

    /** The default English message of a code, null for an unknown code. */
    public static function messageFor(string $error): ?string {
        return self::MESSAGES[$error] ?? null;
    }

    /**
     * Body of the error response: error and message first, then the extra
     * fields in their given order.
     *
     * @return array<string, mixed>
     */
    public function payload(): array {
        return ['error' => $this->error, 'message' => $this->getMessage()]
            + array_diff_key($this->extra, array_flip(self::RESERVED));
    }

    /**
     * The Retry-After header value in whole seconds (rounded up) when the
     * error carries `retryMs` (slow_down, SPEC-M1 §4.2), else null.
     */
    public function retryAfterSeconds(): ?int {
        $ms = $this->extra['retryMs'] ?? null;
        if (!is_int($ms) || $ms < 0) {
            return null;
        }
        return intdiv($ms + 999, 1000);
    }
}
