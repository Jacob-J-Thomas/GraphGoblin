# PR #474 A2 UI correction evidence

This external packet preserves the quota-limited initial attempt, the successful resumed worker handoff, selected source/test/static logs, the full A2 patch, exact source snapshots and later root metadata readback. It is a correction-evidence packet, not merge readiness or QA sign-off.

## Status and identity

The resumed worker completed the UI correction and froze its source for root inspection. Root accepted the source for freezing and independent behavioral QA, not merge. The three formal scans for PR #474 are already consumed; this is the D-035/D-042 known-cause completion path, not a fourth scan or Astra sign-off. Native behavior, fresh current-head CI, root completion inspection and owner acceptance remain pending. The PR remains draft and the issue remains open.

The candidate is head `5a4fb439c63755eeb2b5bef945319772623a9905`, tree `caf777a63de7d9938b03dfa81b9ee60e9a1bf3e5`, on `codex/gg-20261114-node-references-native`; actual main is `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. The original attempt ended at the session limit (exit 1 at `2026-11-14T21:36:04.601Z`; its note records a 3:50pm America/Chicago reset). The resume completed with actual model `claude-opus-5-5`, exit 0 at `2026-11-14T22:16:35.452Z`. [The bounded model/exit projection](safe-model-exit-projection.json) uses only those safe metadata fields; no raw model result, events or thinking stream is included.

## Correction evidence

The A2 correction keeps the canonical rename synchronous and atomic. When the open form matches the accepted stored config and repair is string-only, the form applies that repair in place. The in-dialog `RenameNotice` holds only its visual state during a primary press, until the click reaches window bubble or the next-task no-click fallback; it does not delay source repair. The separate page-level notice may mount during the press, but remains on inert content behind the native modal dialog. The code does not synthesize, replay, delay, prevent or intercept a click. A conservative remount fallback remains for divergent form state or structural replacements.

The final corrected jsdom suite passed 41/41 focused tests across six files; related existing tests passed 87/87 across four files, with no act warnings. Final no-emit typecheck, scoped lint and Prettier passed. In the final tests, Add and Remove act once on the original connected/focused button, after the rename; held fields and history are checked. Release-elsewhere and cancellation controls remain canceled, keyboard activation is separate, and invalid/duplicate-ID and steady-ID controls are included.

The paired negative controls distinguish earlier behavior from the final correction:

- [Probe A first run](resume/logs/08-probe-a-batch1-pointer-press.log) compared the final boundary suite with the batch-1 pointer helper: 10 failed and 11 passed. Its [activation-only rerun](resume/logs/12-probe-a-rerun-activation.log) had 2 failed and 6 passed; the action config was correct, but the notice was already visible at click time.
- [Probe B first run](resume/logs/09-probe-b-old-head-source.log) compared the final tests with exact old HEAD web source: 12 failed and 15 passed. Its [activation-only rerun](resume/logs/13-probe-b-rerun-activation.log) had 5 failed and 3 passed, including lost Add/Remove actions.
- [Final corrected focused suite](resume/logs/10-final-focused-tests.log), [final static checks](resume/logs/11-final-static.log), and [related existing tests](resume/logs/15-final-related-existing-tests.log) record the final pass counts.

These are jsdom component results. They do not prove real pointer geometry, Edge event ordering or native hit testing. The documented design assumption that the browser's click follows mouseup in the same task remains unverified in a real browser. No build, browser, native or broad coverage run was performed by the worker.

## Attempt history and preserved failures

- The [original partial outcome](original-partial/quota-outcome.md.txt) records the session limit; [its exit record](original-partial/exit.json) preserves exit 1.
- The existing rename baseline passed 15/15 in [the baseline log](original-partial/logs/03-baseline-existing-rename-tests.log). The initial 5/5 failures in [the first new-test run on old source](original-partial/logs/04-new-tests-on-old-source.log) are attributed in the handoff to a fixture-defaults mistake; [later attempts](original-partial/logs/05-new-tests-on-old-source-attempt2.log) and [attempt 3](original-partial/logs/06-new-tests-on-old-source-attempt3.log) are retained as iteration evidence, not final status.
- The first correction batch retained its red runs in [batch 1 first](original-partial/logs/07-batch1-first-run.log) and [batch 1 second](original-partial/logs/08-batch1-second-run.log). The resume preserves the batch-2 first run, temporary pointer-loop diagnostic, both initial paired probes, and the first static failure/format correction/second static pass under `resume/logs/`. The initial static run recorded a TS2322 fixture error, `no-unsafe-assignment` in `repair.ts`, and five unformatted files; the final static pass is recorded separately.
- [Final worker handoff](final-handoff.md.txt) explains the fixture corrections and test controls. The final source hash manifest and full A2 patch are preserved as exact copies.

## Exact compiled-artifact boundary

The [original before readback](artifact-evidence/artifacts-before.json), [resume-start readback](artifact-evidence/artifacts-resume-start.json), and [resume-end readback](artifact-evidence/artifacts-resume-end.json) are byte-identical, each 4,614 bytes with SHA-256 `4b4355cc8688dcf5094a2921d69a826f155ffb4438f8f5c5d72499a6cf64e71f`. Each records 1,227 artifacts across 13 distribution trees, zero mismatches, and aggregate `ab44d59bdd421767afb9e7547af6dd1f9750908093fb46032dd930a0ae437bce`. The recorded manifest says those compiled artifacts were built from retained source `164c01a2e3a52bf0ef69a409e1a428b45817b1b8`; they were unchanged during the worker correction. This is not evidence that the new source was built or integrated. The [readback helper](artifact-evidence/artifact-readback.mjs) is retained, not rerun.

## Source patch and later root metadata

- [Full A2 source patch](ui-a2-full.patch) and [worker source hash manifest](final-source-hashes.txt) are preserved. The patch is A2 UI scope. The hash manifest has 14 A2 UI/documentation entries plus two unchanged A1 domain hashes for provenance; the A1 domain source itself is not duplicated in this packet.
- [Root source inspection](root-supplement/root-inspection.md.txt) and [root source readback](root-supplement/source-readback.json) are later supplemental records. The readback covers 17 files / 695,413 bytes with records hash `20a5d02da5e8beea6a9051a5dd8ca467d3d25dcea1a502c6eb2d9265f94fbb98` at the same head.
- After the worker handoff, root made only title/comment/documentation alignment: three stale e2e phrases and two `docs/09` phrases. [The exact alignment record](root-supplement/doc-alignment-record.json) says no assertion or executable behavior changed. The worker's `docs/09` hash remains preserved as `198723306c5e550559e01cc4eecc223605f4af32e0257a4e37e87e84f6d43ccf`; the root readback records aligned `docs/09` hash `51c52a1b9fa9f6df90d64d23e28fecadceb3e471de500de2dbb3ce21f52da29e` and e2e metadata hash `dd6d8d5842b98e28ab65f5f86d680c45722852e1d7ce5bbeee533d1478b9450e`. [The formatting log](root-supplement/doc-alignment-format.log) records the check.

The separate #474 final audit and original activation/lookup negatives remain in their [audit packet](../2026-11-14-node-reference-final-audit-scan3/README.md) and [negative-evidence packet](../2026-11-14-node-reference-activation-and-lookup-negative/README.md). A1 correction source remains separately owned and is not duplicated here.

## Integrity

`retained-files-manifest.json` inventories the exact copied evidence files and sizes/hashes. `SHA256SUMS.txt` covers all packet files except itself; `link-checks.json` records local links, including the two external audit-packet links. `.gitattributes` disables text conversion. Raw Markdown reports are retained with `.md.txt` names; raw source, patch, artifact, exit and log bytes are otherwise unchanged.
