# #363 real SDK boundary investigation

**CONFIRMED blocker for full structured completion at a 226-character temp root.** On native Windows Node **22.23.4**, the immutable candidate reaches the real harness in an empty 249-character scratch, but pinned SDK **0.160.0** then fails its own output-schema `mkdtemp` at a 253-character directory template. A normal short-temp control completes through the same real adapter/harness/SDK with a harmless fake CLI. No provider call occurred.

Candidate **76beeb0f2e99343697578c2713ac06f80d59e7b5**, tree **2544bc2913f9cec0d95a215ea631ab62c7985c1d**, sole parent **02351e2fb932b3be44e7cc3fb3943a61d568226c**. This is a new bounded investigation; the original 19-case allocator QA remains sealed and unchanged at manifest SHA-256 `e4047b7378b612194b3f47ed11e19aac3f2c4d8f80f81c1b46524116ee844c9b`.

## Native observations

Both cases ran once, each in a separate Node child with its own TEMP/TMP/TMPDIR; the parent process environment was not changed. Process cwd was a valid 35-character path; CODEX_HOME was a valid, empty QA-owned 36-character directory with a minimal config file. The real `CodexStructured` and default `CodexHarness` were loaded from development source using the repository's pinned tsx loader. There was no injected clientFactory, cliRunner, temp allocator, filesystem wrapper, builtin modification or SDK mutation. The CLI executable override was the project Node binary with a harmless fake-CLI preload, following `isolation.test.ts`.

| Case | Actual result |
| --- | --- |
| Short control, TEMP length 49 | Public `complete()` resolved `{ fixture: 'sdk-boundary', ok: true }` with usage. Real MCP listing and SDK turn markers exist. The fake CLI received `--output-schema`, read the actual 88-character schema-file path inside a 76-character SDK schema directory, and recorded JSON matching the requested schema. Adapter scratch and SDK schema directory were absent after completion. |
| Long case, TEMP length 226 | Real MCP-list marker records an empty **249-character** adapter scratch. Public `complete()` rejected with `code: HARNESS_TURN_FAILED`, `retriable: false`, `submission: delivery-uncertain`. Its message is native **`ENAMETOOLONG: name too long, mkdtemp '...\\codex-output-schema-XXXXXX'`**. The exact template is **253 characters**; the hypothetical schema file would be 265. No fake CLI turn marker exists. The adapter scratch was absent afterwards; no SDK schema directory entry remained. |

The actual failed native path and returned stack are retained in `raw/long-226.state.json`, its stdout, and `observations.json`. The public harness normalizes the failure, so the original SDK error's errno properties and SDK stack are not exposed; the error message preserves the native errno, operation and exact path. `raw/short-control.turn.json` preserves exact CLI argv, actual schema bytes/JSON/hash, cwd and input hash. The absence of `raw/long-226.turn.json` was explicitly checked.

## Driver assertion failure and saved-state readback

The original driver exited **1**, recording **0 PASS / 2 FAIL**. Both verification failures were my overly broad assertion that the whole TEMP directory must be empty after completion. The pinned tsx loader created its own **`tsx-98jak` cache directory** in each TEMP root. The product calls had already resolved/rejected as described above. The original predictions, driver, states, console, errors and observations are unaltered; neither behavior case was rerun.

`analyze-saved-states.mjs` then validated only those saved states (exit 0). It checked both child exit codes, original failed guard stacks, exact cache-only residue, adapter scratch removal, the short control's schema JSON and CLI argv, the long case's exact failure/path lengths and missing turn marker. Installed tsx source confirms its cache name uses `tmpdir()` and the current username; snippets and hashes are retained in `tsx-source-snippets.json`. This is an explicit readback correction, not a replacement green test run.

All owned fixtures, including loader caches, were removed after an absolute containment check under `G:/ggq`; the unique owner root no longer exists. Parent TEMP/TMP/TMPDIR/CODEX_HOME/NODE_OPTIONS and all bound source bytes stayed unchanged. The checkout and Git index remain clean.

## Pinned SDK source and supported options

The frozen offline install completed exit 0 in 17.3 seconds, with zero downloads and unchanged lock SHA-256 `3fda48ff6e5a65af5a280ede5364ea23ae21fb32c068e3e1cf8835c12a0916df`. The installed package is 0.160.0 plus the repository's existing `windowsHide` spawn patch. Its exact `dist/index.js` is copied to `sources/sdk.js`, SHA-256 **`ae27616562385faf2c4540833d27761f348ab035c4f722076f5d7de45d9390e3`**. The package metadata, type declarations and existing patch are copied and hashed too.

- `sources/sdk.js:13` unconditionally calls `fs.mkdtemp(path.join(os.tmpdir(), "codex-output-schema-"))` for a supplied object schema. `:55` calls that helper before the execution generator; `:69` supplies its generated path to the internal exec argument. The public structured adapter always supplies an output schema.
- `sources/sdkTypes.ts:169` exposes TurnOptions with only `outputSchema` and `signal`. No temp-directory or schema-file-path override exists there.
- `sources/sdkTypes.ts:218` exposes CodexOptions (`codexPathOverride`, base URL/key, config/configOverrides and env). `env` is documented for the CLI child. `sources/sdk.js:244-264` applies it only while spawning that child; it does not alter the Node-host `os.tmpdir()` used earlier by the helper.
- Thread workingDirectory changes the CLI `--cd` argument. Config overrides also become CLI arguments after the schema helper. Neither is a supported override for this host-side allocation.
- Omitting outputSchema avoids the helper in this SDK but would drop the structured-call contract. The internal exec argument `outputSchemaFile` is not a public TurnOptions override.

**Supported override conclusion:** none in the pinned SDK's public options can retain schema enforcement while choosing a different host temp root or prewritten output-schema path. This conclusion uses the installed pinned source/types only, with no assumptions about newer releases.

## Concrete alternatives for the coordinator

1. Keep this delivery explicitly limited to adapter scratch allocation, correct the overstated docs/CHANGELOG and retain a linked SDK blocker. The original 19-case QA remains valid at that narrow tier; it cannot establish that full structured calls succeed at the reported 226-character root.
2. Expand the bounded fix to the pinned SDK's output-schema allocation via the repository's managed dependency-patch mechanism, or adopt an independently verified upstream correction. That needs its own owned-directory/collision/cancellation/cleanup checks and another real-SDK harmless-CLI boundary test. No such fix, version change or acceptance decision was made here.

This investigation does not recommend process-global TEMP mutation, runtime monkeypatching, private SDK entry points or disabling schema enforcement. It does not close #363 or decide whether the narrower delivery satisfies its acceptance criteria. Actual Opus review, final Astra MAX and current-head/current-target CI remain coordinator gates.

## Evidence notes and limits

`predictions.json`, `run-input.json`, `source-binding.json`, raw child stdout/stderr and CLI markers bind this one pair of calls. `observations.json` is the original failing-driver artifact; `readback-analysis.json` is the separate corrected interpretation. `command-ledger.json` retains discovery/setup errors and all execution commands. `manifest.json` seals exact file bytes and hashes.

An initial SDK search assumed an unpatched virtual-store path in the primary checkout and returned a path-not-found error. The isolated QA checkout initially had no dependencies. The permitted offline frozen install resolved that setup condition. A separate suppressed read of a nonexistent `raw-does-not-exist` file was an extraneous read-only command and supplied no evidence; both are disclosed in the command ledger.

Filesystem facts here are before/after native directory observations and actual fake-CLI file reads/markers, not a syscall trace. No native Codex CLI, authentication, owner config/store, service/port, paid turn, full build or browser was used. No tracked source/index, original QA artifact, commit, issue, branch or provider package was modified. The installation used the pinned dependency and its already-approved patch unchanged.
