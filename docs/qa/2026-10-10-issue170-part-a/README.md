# #170 part A: node form browser evidence

Date: 2026-10-10. This evidence covers placement, Context tabs and node dialog width. Typed inputs and optional JSON collection editing remain part B. See the [placement tables](../../09-frontend-and-pwa.md#basic-advanced-and-context-placement-decided-14-and-170) and [ADR-0031](../../decisions/ADR-0031-mounted-context-tabs.md).

The built app ran against the real API's isolated test composition with fake providers, using installed Microsoft Edge. `e2e/node-placement.spec.ts` passed all 11 tests: seven supported evaluator/answer pairs, keyboard tab activation, single-panel kinds, Context issue focus into collapsed Advanced, undo across tabs, held JSON text, unchanged values through switching, save/reload and the width matrix. Seed loops are drafts with incomplete graph wiring and fake providers; their header issue badges remain in the screenshots and are separate from configuration tab counts.

Both inference and classifier Noul dialogs were checked in dark and light themes, on Settings and Context with all visible Advanced groups open. Assertions check dialog width, horizontal scroll and control clipping against overflow ancestors. The height-bounded body retains vertical scrolling. The unrelated delete confirmation retained its existing 520 px width.

| Viewport width | Node dialog width (16 px root font) |
| -------------- | ----------------------------------- |
| 360 px         | 360 px bottom sheet                 |
| 768 px         | 640 px                              |
| 1024 px        | 832 px                              |
| 1280 px        | 1024 px                             |
| 1440 px        | 1024 px                             |
| 1920 px        | 1024 px                             |

Below 768 px the existing 92dvh bottom sheet remains. Desktop caps are 40rem below 1024 px, 52rem at 1024–1279 px, and 64rem from 1280 px, each limited to the viewport minus 2rem. Only the node editor has the new overrides.

Default placement at 1440 px, with Advanced collapsed:

| Theme | Inference Settings                                      | Inference Context                                     | Decision Settings                                      | Decision Context                                     |
| ----- | ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Dark  | [Settings](dark-inference-1440-Settings-collapsed.png)  | [Context](dark-inference-1440-Context-collapsed.png)  | [Settings](dark-decision-1440-Settings-collapsed.png)  | [Context](dark-decision-1440-Context-collapsed.png)  |
| Light | [Settings](light-inference-1440-Settings-collapsed.png) | [Context](light-inference-1440-Context-collapsed.png) | [Settings](light-decision-1440-Settings-collapsed.png) | [Context](light-decision-1440-Context-collapsed.png) |

Additional expanded states:

- Inference Context at 360 px: [dark](dark-inference-360-Context.png), [light](light-inference-360-Context.png).
- Classifier decision Settings at 1920 px: [dark](dark-decision-1920-Settings.png), [light](light-decision-1920-Settings.png).

Browser regression results (each spec run separately after `pnpm.cmd build`):

| Spec            | Passed |
| --------------- | ------ |
| node-placement  | 11     |
| forms           | 12     |
| editor-modal    | 7      |
| decision-routes | 11     |
| undo            | 14     |
| validation      | 9      |
| classifiers     | 5      |
| responsive      | 22     |
| Total           | 91     |

Contracts coverage passed 248 tests across 16 files: lines 99.76% (421/422), branches 99.14% (231/233). Web coverage passed 1,159 tests across 102 files: lines 98.67% (6,246/6,330), branches 93.90% (6,286/6,694). The web run used `--maxWorkers=4` after a default-worker run hit the existing 20-second test timeout in a long undo case. Thresholds and exclusions were unchanged. The three domain parse-identity tests also passed unchanged. The five tab primitive tests passed again after the test callback's lint correction.

The modal regression now asserts the new 832 px width and centered position at 1024 px. The classifier regression's strict endpoint request expectation now includes the current format-3 `type: "choice"` field, which the existing test server already returns. These test corrections change no runtime behavior. The new width test's confirmation selectors were corrected against the current alertdialog before its final passing run. No browser failure was caused by the sandbox.

Placement remains subject to the issue's owner review in the running product. The screenshots and automated checks support that review; they do not replace the independent review or owner acceptance gate.
