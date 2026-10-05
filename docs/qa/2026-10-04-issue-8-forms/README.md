# #8: form controls and field layout, before and after

Date: 2026-10-04. Every form in the app, built with `pnpm build` and served by `apps/web/e2e/server.ts` (the in-memory API with the fake harness), photographed in Edge with reduced motion, in Dark and Light, as element screenshots in a 1280x3200 window so a long node form fits in its dialog.

- `before-dark/`, `before-light/`: `7fca42b`, the integration branch with #15, #23, and #53, before the change.
- `after-dark/`, `after-light/`: after it.

Regenerate with `node docs/qa/2026-10-04-issue-8-forms/capture.mjs before|after` after `pnpm build` (`before` needs a build of the earlier commit). `GG_CAPTURE_ONLY` takes a comma-separated list of screen names.

The seed: `form-gallery`, one node of each kind configured to show most control types (a manual trigger whose input schema has required and optional strings, a number, a boolean, enums of three and six members, and a JSON array; an inference node with session, sandbox, network access, and config overrides; a decision with routes, a codex block, and an expression; a script with args, env, stdin, and exit-code routes; a wait for input with the same schema); `approval-gate`, published, with a run waiting for input; and one secret.

## Screens

| File                     | What it shows                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `node-<kind>.png`        | The node dialog for each of the nine kinds: id and label, the config form, Connections and the Connect form       |
| `node-errors.png`        | The script dialog with Command cleared (a required field's error, linked and announced) and an invalid node id    |
| `loop-panel.png`         | The loop panel: name, description, settings, variables (a record of JSON values)                                  |
| `loops-forms.png`        | Loops: the Create form and the Import file picker                                                                 |
| `loops-import-error.png` | Loops after importing a file that is not JSON: the picker names the file, the alert says why                      |
| `settings.png`           | The whole Settings page: theme (segmented control), model catalog (Enabled switches), defaults, secrets, API keys |
| `settings-add-model.png` | The model catalog with the Add model form open                                                                    |
| `settings-secrets.png`   | Secrets with an invalid name typed: the rule turns into an error                                                  |
| `settings-api-keys.png`  | API keys: the Create key form                                                                                     |
| `settings-defaults.png`  | Defaults: the two selects                                                                                         |
| `api-key-panel.png`      | The API key panel of a server that requires a key                                                                 |
| `new-run.png`            | New run for `approval-gate`: version, trigger, and the input form generated from the trigger's schema             |
| `new-run-invalid.png`    | The same after Start run with the required fields empty                                                           |
| `wait-input.png`         | The run inspector's waiting-for-input form, generated from the wait node's schema                                 |

## What changed, in the pictures

- Booleans: checkboxes and "(not set) / yes / no" selects became switches (a default or required) and **Not set** / **Yes** / **No** segments (optional). In the run input forms, booleans are Yes / No segments (they start empty).
- Enums of two to four options (stdin, stdout, sandbox, approval, capture transcript, to messages, priority) became segmented controls; longer ones stay selects, with **Not set** for an optional one.
- Required fields carry an asterisk and each form says so on its first line; help and errors sit under their control and are linked to it.
- Collection rows sit on a rail with Remove as an icon button beside the row's control; Add is a secondary button with a plus. Nested objects and unions are quiet bordered fieldsets.
- After the review (2026-10-05): record entries are captioned **Key** and **Value**, and each value is a field with its own marker, help, and error; required lists and sets of options show the marker at their legend and say how many they need; the run form shows each problem under its field (`new-run-invalid`) instead of only in a summary.
- Code fields (Liquid, JSONata, JSON) share the input frame and focus ring, are as tall as an input on one line, and carry a language tag (JSON fields gained one).
- The import's raw file input became a picker button with the chosen file's name.

## Checked in Edge beyond the screenshots

`apps/web/e2e/form-controls.spec.ts`: a segmented control by Tab and the arrow keys, saved to the draft; a switch by Space, Enter, and a click on its label, 44 by 24 px; an optional boolean back to unset; a select (more than four options) by the arrow keys; Tab and Shift+Tab out of a code field without inserting anything; `aria-required`, `aria-invalid`, and the error as the accessible description of a required field; the import picker as a labelled native input in the Tab order that names the chosen file. `e2e/theme.spec.ts` covers the theme control on the shared segmented control.

## Not verified

- Edge (Chromium) only; Firefox and Safari were not checked.
- Forced-colours mode was not photographed; the checkbox falls back to the system checkbox there and the switch thumb keeps a solid edge, by CSS only.
- Screen-reader output was not recorded; the names, descriptions, and states were checked through the accessibility tree in the unit and E2E tests.
