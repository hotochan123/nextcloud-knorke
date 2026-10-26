<!--
  - SPDX-FileCopyrightText: 2026 hotochan123
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Third-party code in Knorke

Knorke itself is licensed under AGPL-3.0-or-later, see [`LICENSE`](LICENSE).
Every source file carries the matching SPDX header.

The JavaScript bundle contains third-party code under these licences:

| Package | Licence |
|---|---|
| [Konva](https://konvajs.org/) 10.7.1 | MIT |
| [rbush](https://github.com/mourner/rbush) 4.0.1 | MIT |
| [quickselect](https://github.com/mourner/quickselect) 3.0.0 | ISC |
| [fractional-indexing](https://github.com/rocicorp/fractional-indexing) 4.0.0 | CC0-1.0 |
| [Vue](https://vuejs.org/) 3.5 | MIT |
| @nextcloud/vue | AGPL-3.0-or-later |
| @nextcloud/l10n, @nextcloud/router, @nextcloud/initial-state, @nextcloud/auth | GPL-3.0-or-later |

Most icons in `src/components/icons.js` are SVG path data copied unchanged
from [Material Design Icons](https://pictogrammers.com/library/mdi/) 7.4.47
(Pictogrammers), licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0); the rest are
simple outlines drawn for Knorke itself (AGPL-3.0-or-later like the rest of the
code). They end up in the JavaScript bundle. Each MDI key is one MDI icon:

| Key in `icons.js` | MDI icon |
|---|---|
| `plus` | `mdi-plus` |
| `minus` | `mdi-minus` |
| `pencil` | `mdi-pencil` |
| `trash` | `mdi-trash-can-outline` |
| `share` | `mdi-share-variant` |
| `back` | `mdi-arrow-left` |
| `select` | `mdi-cursor-default` |
| `hand` | `mdi-hand-back-right` |
| `sticky` | `mdi-sticker-outline` |
| `frame` | `mdi-rectangle-outline` |
| `undo` | `mdi-undo` |
| `redo` | `mdi-redo` |
| `fit` | `mdi-fit-to-screen-outline` |
| `front` | `mdi-arrange-bring-to-front` |
| `back2` | `mdi-arrange-send-to-back` |
| `copy` | `mdi-content-copy` |
| `refresh` | `mdi-refresh` |
| `link` | `mdi-link-variant` |
| `board` | `mdi-view-dashboard-outline` |
| `account` | `mdi-account-outline` |
| `cut` | `mdi-content-cut` |
| `duplicate` | `mdi-content-duplicate` |
| `chevronDown` | `mdi-chevron-down` |
| `check` | `mdi-check` |
| `lock` | `mdi-lock` |
| `unlock` | `mdi-lock-open-variant` |
| `groupItems` | `mdi-group` |
| `ungroup` | `mdi-ungroup` |
| `alignLeft` | `mdi-format-align-left` |
| `alignCenter` | `mdi-format-align-center` |
| `alignRight` | `mdi-format-align-right` |
| `alignItemsLeft` | `mdi-align-horizontal-left` |
| `alignItemsCenter` | `mdi-align-horizontal-center` |
| `alignItemsRight` | `mdi-align-horizontal-right` |
| `alignItemsTop` | `mdi-align-vertical-top` |
| `alignItemsMiddle` | `mdi-align-vertical-center` |
| `alignItemsBottom` | `mdi-align-vertical-bottom` |
| `distributeHorizontal` | `mdi-distribute-horizontal-center` |
| `distributeVertical` | `mdi-distribute-vertical-center` |
| `tidyUp` | `mdi-view-grid` |
| `connector` | `mdi-arrow-top-right` |
| `qrcode` | `mdi-qrcode` |
| `group` | `mdi-account-group` |
| `eye` | `mdi-eye` |
| `eyeOff` | `mdi-eye-off` |
| `close` | `mdi-close` |
| `dotsVertical` | `mdi-dots-vertical` |
| `timer` | `mdi-timer-outline` |

Own drawings:

| Key in `icons.js` | Origin |
|---|---|
| `team` | own drawing |
| `vote` | own drawing |
| `facilitate` | own drawing |
| `zoomSelection` | own drawing |
| `present` | own drawing |
| `dice` | own drawing |
| `shape` | own drawing |
| `text` | own drawing |
| `rect` | own drawing |
| `roundRect` | own drawing |
| `ellipse` | own drawing |
| `diamond` | own drawing |
| `triangle` | own drawing |
| `arrowRight` | own drawing |
| `arrange` | own drawing |
| `valignTop` | own drawing |
| `valignMiddle` | own drawing |
| `valignBottom` | own drawing |
| `dashSolid` | own drawing |
| `dashDashed` | own drawing |
| `dashDotted` | own drawing |
| `fill` | own drawing |
| `border` | own drawing |
| `textColor` | own drawing |
| `routeStraight` | own drawing |
| `routeElbow` | own drawing |
| `routeCurved` | own drawing |
| `capNone` | own drawing |
| `capArrow` | own drawing |
| `capTriangle` | own drawing |
| `capDot` | own drawing |
| `capDiamond` | own drawing |
| `label` | own drawing |
| `connect` | own drawing |
| `lineWidth` | own drawing |

The validity check for z-order keys in `lib/Service/ZOrder.php` and
`src/model/zorder.js` is a port of `validateOrderKey` from fractional-indexing
(CC0-1.0).
