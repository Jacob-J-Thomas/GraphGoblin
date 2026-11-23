# #363 corrected SDK path — independent native QA

**The reported SDK path blocker is resolved at the tested 226-character temp root.** Independent source-pipeline observations establish the eight intended short/long scenarios: four harmless-CLI success/error controls, two corrected abort controls, and two actual bundled-native-Codex controls against a synthetic loopback Responses endpoint. The real native CLI accepted the 249-character working directory and 255-character schema file and returned the structured proof. This is bounded native/provider-boundary evidence, not live entitlement or arbitrary Windows long-path support.

**Original driver outcomes are retained:** first eight-case driver **0 PASS / 8 FAIL, exit 1**; corrected native pair **2 PASS / 0 FAIL, exit 0**; corrected abort pair **0 PASS / 2 FAIL, exit 1**. The failing guards and fixture errors are explained below. A separate saved-state verifier, which does not rerun behavior, establishes the product facts. This report does not relabel those failed drivers as green runs.

## Binding and independence

Fresh detached checkout `G:/ggq/gg-i4-363-sdk-qa/GraphGoblin`, immutable head **7d8467439b9850a555b92ab4b96b58c8b8b78388**, tree **00f6f08cebc0e83b257e52e4781f5c85a6c52c1c**, sole parent **76beeb0f2e99343697578c2713ac06f80d59e7b5**. No Git fetch, source/index change, commit, push or issue write. The earlier QA checkout was not moved. Read D177, the root freeze, original SDK blocker/report/readback, author correction report/source binding/managed-patch readback and repository instructions. Author new fixtures were not reused; these fixtures were written independently using the previous independent harmless-CLI boundary and the prior #427 native synthetic-provider pattern.

Node **v22.23.4**, native Windows x64; pnpm **12.8.1**. Frozen offline installation exited 0 in 16.6 seconds with zero downloads. The managed installed SDK is **0.160.0**, SHA-256 **`ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7`**. Its bytes equal the original installed SDK with only `codex-output-schema-` replaced by `gg-schema-`; `windowsHide` remains. The lock differs from the parent only at three references to patch hash `119554c3f7cb39db6b24dbb75e9d51fede75171d04aec0114d31356b79693760`. The original adapter allocator is byte-identical to the parent.

`source-binding.json` and the two correction subpackets bind actual SDK/native-binary/source/fixture bytes. The root freeze and author report are copied as inputs, not independent test results. The author's 57 tests, six source cases and 675-test coverage run remain author evidence; none is counted in this agent's native totals.

## What actually executed

Every product call imported actual development-source `CodexStructured` and default `CodexHarness` using the pinned tsx loader and actual installed patched SDK. No clientFactory, cliRunner, temp allocator, filesystem/builtin replacement or private vendor API was used. Each case ran in a separate Node child with child-only TEMP/TMP/TMPDIR and short QA-owned CODEX_HOME/cwd. Parent temp/home environment was checked unchanged. All homes were empty except local fixture configuration; plugins, analytics and feedback were disabled for native CLI cases. No owner login/config/auth or app server was used.

Predictions were written before each finite group. The first group had eight calls. One corrected native pair and one corrected harmless-abort pair followed, each separately archived, for **12 total calls**. Success/error controls were not repeated. There were four native CLI calls total across the original and corrected pairs, each producing exactly one loopback Responses request; no request retry, remote model call or fallback occurred.

| Intended scenario | Actual product evidence |
| --- | --- |
| Harmless CLI, short + 226, success | Original saved states resolve `{ proof: 'sdk363', ok: true }`. Actual CLI markers read the exact schema bytes/JSON and observe empty adapter scratch. Scratch/schema directories are removed; unrelated similarly named directories and plain marker retain contents. |
| Harmless CLI, short + 226, exit 7 | Original saved states reject with HARNESS_TURN_FAILED and the SDK's observed `code 7` error. The CLI had read the matching actual schema first. Both product directories are removed and sentinels preserved. |
| Harmless CLI, short + 226, genuine abort | Corrected abort states observe schema and scratch still present before abort, then public AbortError. The short turn PID **10656** and long turn PID **18448** have native ChildProcess `signalCode: SIGTERM`, no live handle, and both product directories removed. The long paths are exactly **249 / 243 / 255** for scratch/schema directory/schema file. Sentinels survive. Raw exit-event assertion failures remain, as explained below. |
| Actual native Codex, short + 226, synthetic Responses | Corrected native driver passes **2/2**. Native turn PIDs **38220** and **27004** each exit **0**. Each sends one POST `/v1/responses`; its `text.format` is strict JSON schema equal to the requested schema. While handling that request, the local server reads the real SDK schema file and observes the empty scratch. The long paths are exactly **249 / 243 / 255**. The result is the schema-conforming structured proof. Both directories are removed, all observed children exit and sentinels remain. |

The actual native SDK argv contains `--cd <249-character scratch>` and `--output-schema <255-character file>` in the long case. The loopback server records the exact schema file bytes/hash and request body before replying with controlled SSE output. That proves this bundled native CLI accepts these paths and carries the schema into its Responses request. It does not establish account authentication, model availability, billing, real-provider behavior or tool/sandbox operation. No tools were requested or emitted by the local response.

The native-binary path and SHA-256 are retained in each source binding; the observed SDK spawn executable matches that binary. MCP listing launcher PIDs in the corrected pair also exit 0. The native turn was the bundled `codex.exe`, not the harmless stand-in.

## Retained fixture failures and corrections

1. **First driver: 0/8, exit 1.** Its observer subscribed to Node's public child-process diagnostics channel but filtered `spawnargs` too early, before Node populated them. It therefore recorded no children and all eight cases stopped at `children.length >= 2`. Product outcomes and filesystem/HTTP/CLI markers had already been saved. The first two native calls actually completed successfully, but have no direct child-exit telemetry from that attempt.
2. **Original harmless aborts were invalid fixtures.** Their preload installed an interval and returned; Node then tried to run a nonexistent main file named `exec` and exited with ERR_MODULE_NOT_FOUND before cancellation. Those two calls are explicitly excluded from abort QA. They do show error cleanup, but are not presented as valid abort outcomes. Original raw error bodies and observations are preserved.
3. **One corrected native pair: 2/2, exit 0.** The new observer registers every published child object and obtains args/PID on its public `spawn` event. It records native exit events and handle termination without awaiting `close`. The corrected pair used the same local HTTP fixture and no product/SDK change.
4. **One corrected abort pair: 0/2, exit 1.** The corrected preload remains in top-level await after reading the schema; cancellation now occurs while both directories exist. Both product calls return AbortError and clean up correctly. The remaining driver assertion expected every observer `exit` callback to fire. On cancellation the SDK's finally removes listeners before that callback; the independently saved public ChildProcess `exitCode`/`signalCode` snapshots nevertheless show termination (SIGTERM for each turn) and `liveHandles: []`. The failed event assertion remains unaltered. No further behavior attempt was made.

`verify-saved-and-seal.mjs` validates these original states without importing or executing the product/fixtures. It checks schema bytes, strict native request schema, exact lengths, outcomes, pre-abort presence, post-operation absence, sentinel contents, process-handle termination and the retained failure signatures. Its `readback-analysis.json` separates the eight intended contract scenarios from the two invalid original abort cases and the additional native pair. This is a saved-state interpretation with explicit telemetry limits, not a replacement green test run.

The observer uses Node's documented [child_process diagnostics channel](https://raw.githubusercontent.com/nodejs/node/v22.23.4/doc/api/diagnostics_channel.md#process), an experimental built-in channel. This subscribes to public events and reads public ChildProcess fields; it does not monkeypatch spawn or the SDK. The first web documentation URL was inaccessible; the pinned-version official source supplied the channel documentation. No unsupported runtime patch was introduced.

## Cleanup and preserved originals

Before cleanup, every case compares only the product prefixes with its seeded sentinels. Loader `tsx-98jak` cache entries are recorded separately, avoiding the original whole-TEMP-empty mistake. Product cleanup never targets the sentinel directories/files. Every schema/scratch is absent after the relevant call; the three unique fixture owner roots were then removed only after absolute containment and exclusive-creation checks under `G:/ggq`.

Final read-only CIM observations find **zero** node.exe/codex.exe command lines containing any of the three unique fixture roots and **zero** currently present known fixture PIDs. This is a scoped current-process readback, not a claim about arbitrary descendants or every host process. Corrected native event telemetry and corrected abort handle snapshots provide the process-specific termination evidence.

Both earlier QA packets were verified file-by-file against their manifests, unchanged:

- Original 19-case allocator QA manifest: `e4047b7378b612194b3f47ed11e19aac3f2c4d8f80f81c1b46524116ee844c9b`.
- Original SDK boundary packet, including **0 PASS / 2 FAIL** and its separate readback: `49b577d1a6776ad8c0cd6ca429b5eeec9e70bd56984b03d738c88c4d6c552bc3`.

No original driver, prediction, failed attempt or report was overwritten. Every current product/SDK/fixture source binding is unchanged; the detached checkout and Git index remain clean.

## Remaining limits and gates

The supported conclusion is the exact tested Windows boundary: 226-character root, adapter scratch 249, SDK directory 243 and schema file 255, with schema preservation and cleanup on success/error/abort. Arbitrary longer roots, subsequent child files, live account entitlement and tool execution are outside this evidence.

The first driver lacks native exit telemetry, and the corrected abort driver's exit-event guard remains failed; its handle-property/CIM readback supplies the stated termination evidence. The coordinator should use that explicit evidence disposition rather than call all raw drivers green. No full monorepo build, package coverage, browser, licence/audit gate, actual Claude re-review, current-head/current-target CI or designated final Astra review was run by this agent. Those gates remain separate. No issue closure, owner acceptance or deployment is implied.

`predictions.json`, three source bindings, raw configs/states/stdout/stderr, CLI markers, native HTTP request bodies, diagnostic PID/exit records, process readbacks, original failure logs and correction generators are sealed by `manifest.json`. `command-ledger.json` records setup and bounded corrections. A read-only patch-file inspection raced checkout population and briefly returned path-not-found; the completed checkout was verified before installation or behavior execution. No product failure is inferred from that setup read.
