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
| [emoji-mart-vue-fast](https://github.com/serebrov/emoji-mart-vue) 15.0.5 (in the emoji picker, loaded on demand) | BSD-3-Clause |

The icons of the bars, menus and tool variants in `src/components/icons.js`
and the 20 symbols of the shapes panel are SVG path data copied unchanged from
[Phosphor Icons](https://phosphoricons.com/) (`@phosphor-icons/core` 2.1.1),
licensed under the MIT License. The path data sits in `src/model/phosphor.js`
(on Phosphor's 256 × 256 grid, scaled to 24 × 24 when the module loads) and ends
up in the JavaScript bundle. Each key is one Phosphor icon, weight Regular:

| Key in `icons.js` | Phosphor icon |
|---|---|
| `plus` | `plus` |
| `tag` | `tag` |
| `comment` | `chat` |
| `cluster` | `squares-four` |
| `table` | `table` |
| `mindmap` | `tree-structure` |
| `mmTree` | `tree-view` |
| `minus` | `minus` |
| `pencil` | `pencil-simple` |
| `pen` | `pencil-simple` |
| `trash` | `trash` |
| `share` | `share-network` |
| `back` | `arrow-left` |
| `select` | `cursor` |
| `hand` | `hand` |
| `sticky` | `note` |
| `frame` | `frame-corners` |
| `undo` | `arrow-u-up-left` |
| `redo` | `arrow-u-up-right` |
| `fit` | `corners-out` |
| `front` | `selection-foreground` |
| `back2` | `selection-background` |
| `copy` | `copy` |
| `refresh` | `arrow-clockwise` |
| `link` | `link` |
| `board` | `squares-four` |
| `cut` | `scissors` |
| `duplicate` | `copy-simple` |
| `chevronDown` | `caret-down` |
| `chevronRight` | `caret-right` |
| `check` | `check` |
| `lock` | `lock` |
| `unlock` | `lock-open` |
| `groupItems` | `selection-plus` |
| `ungroup` | `selection-slash` |
| `alignLeft` | `text-align-left` |
| `alignCenter` | `text-align-center` |
| `alignRight` | `text-align-right` |
| `valignTop` | `arrow-line-up` |
| `valignMiddle` | `arrows-in-line-vertical` |
| `valignBottom` | `arrow-line-down` |
| `alignItemsLeft` | `align-left` |
| `alignItemsCenter` | `align-center-horizontal` |
| `alignItemsRight` | `align-right` |
| `alignItemsTop` | `align-top` |
| `alignItemsMiddle` | `align-center-vertical` |
| `alignItemsBottom` | `align-bottom` |
| `tidyUp` | `grid-four` |
| `sortColors` | `palette` |
| `shape` | `shapes` |
| `text` | `text-t` |
| `rect` | `rectangle` |
| `roundRect` | `square` |
| `ellipse` | `circle` |
| `diamond` | `diamond` |
| `triangle` | `triangle` |
| `arrowRight` | `arrow-fat-right` |
| `arrange` | `arrows-out-cardinal` |
| `account` | `user` |
| `connector` | `arrow-up-right` |
| `label` | `textbox` |
| `connect` | `line-segment` |
| `swapDirection` | `arrows-left-right` |
| `emoticonPlus` | `smiley` |
| `qrcode` | `qr-code` |
| `group` | `users-three` |
| `team` | `users` |
| `present` | `presentation` |
| `eye` | `eye` |
| `eyeOff` | `eye-slash` |
| `close` | `x` |
| `download` | `download-simple` |
| `upload` | `upload-simple` |
| `image` | `image` |
| `timer` | `timer` |
| `vote` | `check-square` |
| `facilitate` | `flag` |
| `zoomSelection` | `scan` |
| `dice` | `dice-five` |
| `star` | `star` |
| `starOutline` | `star` |
| `sort` | `funnel-simple` |
| `chevronLeft` | `caret-left` |
| `keyboard` | `keyboard` |
| `legal` | `scales` |
| `exportTo` | `tray-arrow-down` |
| `insertFrom` | `tray-arrow-up` |
| `moreTools` | `plus-square` |
| `importShapes` | `folder-simple-plus` |
| `zoom100` | `magnifying-glass` |
| `search` | `magnifying-glass` |
| `caretUp` | `caret-up` |
| `caretDown` | `caret-down` |
| `dotsHorizontal` | `dots-three` |
| `routes` | `path` |
| `tips` | `arrow-right` |
| `headerRow` | `browser` |
| `branch` | `git-branch` |
| `viewGrid` | `squares-four` |
| `viewList` | `list` |

The symbols (the shape kinds `iconPerson` … `iconCloud` in
`src/model/shapes.js`) draw the Regular icon as their line and the light layer
of the Duotone weight of the same icon (the path its `-duotone` file draws at
opacity 0.2) as their fill:

| Shape kind | Phosphor icon |
|---|---|
| `iconPerson` | `user` |
| `iconPeople` | `users` |
| `iconPlace` | `map-pin` |
| `iconClock` | `clock` |
| `iconWarning` | `warning` |
| `iconInfo` | `info` |
| `iconQuestion` | `question` |
| `iconDone` | `check-circle` |
| `iconError` | `x-circle` |
| `iconStar` | `star` |
| `iconHeart` | `heart` |
| `iconIdea` | `lightbulb` |
| `iconFlag` | `flag` |
| `iconCalendar` | `calendar-blank` |
| `iconMail` | `envelope-simple` |
| `iconPhone` | `phone` |
| `iconHome` | `house` |
| `iconSettings` | `gear` |
| `iconLock` | `lock` |
| `iconCloud` | `cloud` |

Licence of Phosphor Icons:

> MIT License
>
> Copyright (c) 2023 Phosphor Icons
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The preview of the image shape (`IMAGE_PREVIEW` in `src/model/shapes.js`) is
SVG path data copied unchanged from
[Material Design Icons](https://pictogrammers.com/library/mdi/) 7.4.47
(Pictogrammers, `mdi-image-outline`), licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
The markers of the BPMN shapes (the `mark` and `badge` of the kinds `bpmn…`
in the same file) are MDI 7.4.47 path data, too: `mdi-email-outline`,
`mdi-email`, `mdi-clock-outline`, `mdi-flash`, `mdi-circle`, `mdi-account`,
`mdi-cog-outline`, `mdi-hand-back-right-outline`, `mdi-script-text-outline`,
`mdi-table-large`, `mdi-plus-box-outline`, `mdi-close-thick`,
`mdi-plus-thick`, `mdi-circle-outline`, `mdi-arrow-right-bold-outline` and
`mdi-arrow-right-bold`.

Own drawings (AGPL-3.0-or-later like the rest of the code), where Phosphor has
nothing fitting:

| Key in `icons.js` | Origin |
|---|---|
| `mmBoth` | own drawing |
| `laser` | own drawing |
| `distributeHorizontal` | own drawing |
| `distributeVertical` | own drawing |
| `dashSolid` | own drawing |
| `dashDashed` | own drawing |
| `dashDotted` | own drawing |
| `routeStraight` | own drawing |
| `routeElbow` | own drawing |
| `routeCurved` | own drawing |
| `capNone` | own drawing |
| `capArrow` | own drawing |
| `capTriangle` | own drawing |
| `capDot` | own drawing |
| `capDiamond` | own drawing |
| `capCircleOpen` | own drawing |
| `capTriangleOpen` | own drawing |
| `notePad` | own drawing |
| `lanes` | own drawing |
| `sparkle` | own drawing |
| `marker` | own drawing |
| `eraser` | own drawing |
| `widthThin` | own drawing |
| `widthMedium` | own drawing |
| `widthThick` | own drawing |
| `listBullets` | own drawing |
| `linkOut` | own drawing |

The validity check for z-order keys in `lib/Service/ZOrder.php` and
`src/model/zorder.js` is a port of `validateOrderKey` from fractional-indexing
(CC0-1.0).
