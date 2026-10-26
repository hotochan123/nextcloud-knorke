<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Security policy

## Status of the code

Knorke is written by AI coding agents (Anthropic's Claude Code), not by hand.
It has had no independent human code review and no security audit. Before
releases, AI agents reviewed the changes for security problems; the fixes are
listed under "Security" in [`CHANGELOG.md`](CHANGELOG.md), and what remains is
described under "Known limits" in [`docs/ADMIN.md`](docs/ADMIN.md#known-limits).
Please evaluate Knorke yourself before you rely on it. Details:
[How this app is built](README.md#how-this-app-is-built-ai-disclosure).

## Reporting a vulnerability

Please do not describe a security problem in a public issue.

- **Preferred:** GitHub's private vulnerability reporting – "Report a
  vulnerability" on the repository's
  [Security tab](https://github.com/hotochan123/nextcloud-knorke/security).
- **If that button is not there** (for example because private reporting has
  been switched off): open an
  [issue](https://github.com/hotochan123/nextcloud-knorke/issues) that only
  says you have found a security problem and asks for a private way to send the
  details – no description, no proof of concept. The maintainer will answer
  with a contact.

Helpful in a report: the Knorke version or commit, the Nextcloud version and
database, what an attacker needs (an edit or voting link, its password, a
guest name, a Nextcloud account, a share with a certain role, …), the steps to
reproduce and the effect.

Knorke is maintained by one person. There is no bug bounty and no guaranteed
response time; fixes go into the next release, and only the newest release is
supported.

## Scope

In scope:

- the app in this repository: the PHP code, the templates, the JavaScript
  bundle and its sources;
- the board pages and the API for accounts and for guests of edit and voting
  links, the background jobs and the `occ` commands;
- the release tooling (`dev/release.sh`) and the CI configuration, as far as
  they affect what gets shipped;
- a way around a protection or limit that the documentation describes, for
  example link passwords and their throttle, the guest limits per network
  address, the write budget and the daily quotas or the `.htaccess` that
  hides the development tree.

Out of scope:

- Nextcloud server itself and other apps – please report those to Nextcloud
  (<https://nextcloud.com/security/>);
- the configuration of your web server or proxy;
- the limits [`docs/ADMIN.md`](docs/ADMIN.md#known-limits) documents as known,
  as long as they stay within the stated bounds, for example that guest votes
  are not one per person or that guests behind one network address share
  their limits;
- the tools under `dev/` and `tests/`, which are not part of a release.
