# #363 managed SDK correction — author evidence

Author context `/root/i4_448_preflight`, GPT-6.1 Sol xhigh. This is implementation and author
verification, not independent native QA, opposite-family re-review, final audit or acceptance.
No staging/commit/push/issue write is authorized before root inspection.

## Source and selected scope

Worktree `G:/ggq/gg-i4-363-structured/GraphGoblin`, branch `codex/gg-i4-363-structured`, initially
clean at `76beeb0f2e99343697578c2713ac06f80d59e7b5` (parent signed main
`02351e2fb932b3be44e7cc3fb3943a61d568226c`). Read AGENTS, docs/README/12/15, D177, the actual Opus
review and original independent SDK observations plus saved-state readback.

D177 selects only a prefix change in the existing managed @openai/codex-sdk@0.160.0 patch:
`codex-output-schema-` becomes `gg-schema-`. Existing windowsHide remains. No SDK version,
dependency, global environment, private API, replacement allocator, schema omission or runtime
failure-classification change. Original structured.ts/structured.test.ts/isolation.test.ts are
untouched. #442's separate frozen worktree and Claude UI files are untouched.

ADR-0087 records this dependency decision and alternatives. Decision index, research, numbered
doc 06 and CHANGELOG describe the measured boundary and require dependency reinstall before
rebuild. The old four-retries wording is corrected to four attempts / three retries. No arbitrary
Windows long-path support or provider-turn success is claimed.

## Existing negative evidence remains unchanged

The actual Claude review at head 76beeb0f is **CHANGES_REQUIRED**. F1 inferred the subsequent SDK
allocation failure and F2 identified the retry-count wording error. This author correction does
not itself change that review disposition; targeted actual Claude re-review remains required.

The original independent SDK-boundary driver remains **0 PASS / 2 FAIL**, because its whole-TEMP
empty assertion counted tsx's cache as product residue. The separate saved-state readback proves
that the short product call resolved and the 226-root call failed the SDK's 253-character
mkdtemp template after the adapter scratch was created. Neither original case was rerun or
relabelled here. The independent manifest was rehashed unchanged:
`49b577d1a6776ad8c0cd6ca429b5eeec9e70bd56984b03d738c88c4d6c552bc3`.

## Maintained real-SDK regression and original counterfactual

New `src/sdk-schema.test.ts` drives a fresh Node child for each of six cases: short and exactly
226-character TEMP/TMP roots crossed with success, CLI error and abort. The child imports the
actual installed SDK's public JS API. Its harmless CLI stand-in reads the actual schema file,
records bytes/argv, and either emits a successful fixture response, exits 7, or waits for abort.
There is no provider/real Codex executable, filesystem/SDK mock, temp allocator injection or
process-global TEMP mutation. Test parents retain their own TEMP/TMP.

Checks require schema JSON/text to match, the --output-schema argument, the allocated directory
removed on success/error/abort, and a schema file present at the point of abort. Unrelated files
and similarly named gg-schema-KEEP00 / gg-structured-keep directories retain their marker bytes.
Namespace snapshots compare only owned product prefixes, not all temp entries or loader caches.
On the long root the real schema directory/file are asserted at 243/255 characters.

Before changing the SDK, this command failed as expected:
`pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run src/sdk-schema.test.ts -t '226-character root success'`.
Result: 1 failed / 5 skipped; native ENAMETOOLONG names the original codex-output-schema-XXXXXX
template. Exact terminal is original-schema-prefix-control.log; original SDK, patch, lockfile
and counterfactual test/fixture bytes were retained before the managed change.

After managed installation, all six cases PASS. Together with unchanged structured/isolation
suites, focused-sdk-01.log records **3 files / 57 tests PASS**. This tests the real vendor helper;
the separate full source replay below establishes its composition with the adapter/harness.

## Managed pnpm patch and installation

Node v22.23.4 selected for all commands, pnpm.cmd 12.8.1.

1. `pnpm.cmd patch @openai/codex-sdk@0.160.0 --edit-dir G:/ggq/gg363-sdk-edit --offline` extracted
   the package with its existing windowsHide patch applied.
2. Changed only the output-schema prefix in the prepared dist/index.js.
3. `pnpm.cmd patch-commit G:/ggq/gg363-sdk-edit --patches-dir patches --offline` generated the
   patch and synchronized the lock. Existing deprecated-glob/peer warnings are retained in the
   terminal; no peer/dependency remediation was attempted.
4. `pnpm.cmd install --offline --frozen-lockfile` PASS, up-to-date lock with no resolution change.
   The installed SDK was then read back and exercised, not a manually edited node_modules copy.

Logs: pnpm-patch-prepare.log, pnpm-patch-commit.log and frozen-reinstall.log.

The lock diff contains only three references to this SDK patch hash:
`3d897be4ca6f078ed158b30bb1a58bc02e1e689560dc658e8bd2d93d27b7338d` becomes
`119554c3f7cb39db6b24dbb75e9d51fede75171d04aec0114d31356b79693760`.
No package/workspace manifest, version, resolution or other dependency changed.

managed-patch-readback.json verifies installed SDK text is byte-for-text identical to the
original installed SDK except replacing that one prefix, with windowsHide retained. Installed
SDK SHA-256 is `ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7`;
the original installed SDK was `ae27616562385faf2c4540833d27761f348ab035c4f722076f5d7de45d9390e3`.

## Full source adapter/harness/SDK replay — author tier

replay-source.mjs launches six independent Windows Node children (short/226 × success/error/abort)
with child-only TEMP/TMP/TMPDIR and a disposable CODEX_HOME. It imports the actual development
source CodexStructured and default CodexHarness, using the installed SDK, with only the public
CLI executable/env override pointing at a harmless schema-reading Node stand-in. No clientFactory,
cliRunner, structuredTemp, builtin or SDK injection is used.

**6/6 PASS.** Each reaches real MCP listing and the schema-reading SDK turn. Exact requested
schema bytes hash identically in every case. At root length 226, listing records empty adapter
scratch length 249, and the CLI reads actual SDK directory/file lengths 243/255. Normal resolution,
controlled CLI failure and abort all remove the adapter scratch and SDK schema directory, preserve
similarly named unrelated sentinel directories/files, and leave the tsx cache classified separately.
Abort is requested only after the CLI has read a still-existing schema. No provider request occurs.

Raw config/state/listing/turn/stdout files are under raw/, with source-replay.log and
source-replay-result.json. Helpers are new author copies; the independent scripts/artifacts remain
unaltered. The evidence root is retained for inspection, not as a running service. This is a
controlled real-SDK/harmless-CLI boundary, not native Codex sandbox/provider-model verification.

## Checks and retained author failure

- Focused SDK/structured/isolation: 57 PASS (focused-sdk-01.log).
- Adapter typecheck: PASS (typecheck.log).
- First lint: FAIL, 16 no-undef errors for Node globals in new JS fixtures (lint.log). Corrected by
  explicit node:process/node:timers/node:url imports and globalThis.AbortController, without rule
  suppression. Final lint: PASS (lint-02.log).
- Changed source/fixture/doc Prettier check and git diff --check: PASS.
- Full adapter coverage: one serialized slot granted by root after the above checks; LIVE=0,
  maxWorkers=1, no threshold/exclusion/timeout policy changes. PASS on the first full run:
  18 files passed / 1 skipped, **675 tests passed / 4 live tests skipped**, 42.73 s.
  V8 adapter-owned TS coverage: lines 99.41% (511/514), branches 95.50% (467/489),
  statements 98.26% (567/577), functions 99.31% (146/147). The vendor helper is exercised
  behaviorally in real Node children; it is not included in those adapter TS percentages.
  Exact log: adapter-coverage.log; raw summary retained in adapter-coverage-summary.json.
- Licence allowlist: PASS, 226 packages checked (licenses.log). No new dependency licence.
- Layer rules: PASS (layers.log).

No full monorepo build was needed or started. Licence/audit policy, current-head/current-target
CI, targeted actual Claude re-review, independent native SDK QA and final designated review
remain required delivery gates. No owner config/store/credential/service, paid provider,
ports 4747/4748, issue closure, deployment or publication was used.

## Frozen candidate handoff

Ten source files are frozen, unstaged, at unchanged HEAD 76beeb0f. Root owns the inspection and
commit action. candidate-source/ retains all ten raw files, source-binding.json records their
SHA-256 and the empty index, and tracked.diff records the six tracked-file changes (the four new
files are represented by their complete copied bytes, not omitted from the binding).
artifact-sha256.json seals this author packet. The source replay owner is retained for inspection;
lock-and-cleanup-readback.json reports zero matching running processes. The original independent
manifest remains unchanged. Original counterfactual and lint failures remain retained alongside
successful corrected-source checks.
