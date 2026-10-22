<?php

// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later

// Called directly over HTTP (no Nextcloud around it): 404 and nothing else (P7, SPEC-M1 §33.1 g).
if (!class_exists(\OCP\Util::class)) { http_response_code(404); exit; }

\OCP\Util::addScript('knorke', 'knorke-main');   // loads .mjs as a module + import map, plus l10n/<lang>.js automatically
\OCP\Util::addStyle('knorke', 'knorke-style');
?>
<div id="knorke-root"></div>
