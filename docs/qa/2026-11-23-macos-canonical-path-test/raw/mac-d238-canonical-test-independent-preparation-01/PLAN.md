# Independent D238 canonical-expectation causal QA plan

Preparation only. No candidate source, dependency tree, test, child, junction, build, CI, provider or device is touched in this packet. Prior D236/D237 QA stays frozen. D238 authority was read and its SHA-256 verified as `0c3d489615cce02acabb3a5dcd7241a7b73897037a6f92cf986afae72f0c7cb1`. The retained original Mac job lines510–568 show the exact /var versus /private/var ownership-path assertion and 210 passed /8 skipped /1 failed; they do not establish native Swift/installer acceptance or resolve the separate upload timeout.

Root now reports a prepared clean sparse QA checkout at `G:/ggq/gg-mac-d238-alias-qa/GraphGoblin`, frozen head `b7a7bbd83b3ae542f07e432d65ba04483493b57f`, tree `baa8eb9067e1612f568827b743da9050d49d6a6e`, parent `504afbc6d799aa21b16158248ade424783ecc2ce`. This preparation has not opened that source or verified those checkout fields. Checkout preparation is not execution admission. Root must admit the literal controls and heavy slot before the following work.

## Minimal literal additions

- Sole proposed repository overlay: `apps/api/src/main.d238-parent.independent.qa.test.ts`, exact raw bytes of parent504afbc6's `apps/api/src/main.test.ts`, kept in the same directory so every relative import and built-entry path is unchanged. Obtain bytes through a read-only immutable Git-blob read after admission, preserving stream bytes; do not rewrite, shorten or patch the parent test.
- Future execution evidence root: `G:/ggq/delivery-evidence/2026-11-17-five-intents/mac-d238-canonical-test-independent-qa-01`.
- Two small runner-only files there: `vitest.alias.config.mjs` and `worker-alias.setup.mjs`. The config delegates to the frozen API config, preserving forks, execArgv, globalSetup, setupFiles order, timeouts and coverage policy, and adds only the worker setup. The setup runs in the actual selected test worker before importing the test. It sets/restores only that worker's TEMP/TMP, records controlled path observations and passively observes returned owned child handles. It does not change test source or process results. Bind exact installed Vitest ESM resolution before writing it; no helper source exists yet.

Do not change the corrected main.test.ts, production, package scripts, API fixtures or global configuration. Do not add a broader QA framework. If a minimal runner binding cannot preserve these properties, report the binding limit before execution rather than improvising a global environment change.

## Three finite stages, two actual test invocations

| ID | Required observation | Outcome boundary |
| --- | --- | --- |
| A0 real alias precondition | Create a unique owned physical directory and an actual Windows Junction pointing to it. In the target worker, os.tmpdir must equal the admitted alias spelling, and Node realpath must resolve it to the pinned owned physical target with a different path spelling. Observe the actual fixture mkdtemp result and its realpath under this same target, not merely a standalone alias probe. | Real Windows alias capability/path observation only. Unsupported or mismatched capability stops both dependent invocations and remains unexecuted evidence, never a fake Darwin pass. |
| A1 exact parent negative control | Select exactly the existing shared-database case from the byte-identical parent overlay. Run it against the frozen corrected candidate's same built entry, under the junction TEMP/TMP worker control. Require precisely one active target test, exit1 from its exact aliased-versus-canonical ownership-path expectation, and no earlier startup/serving/cleanup failure or unhandled error. Preserve its raw failure, JSON, source bytes and native alias witnesses. | Expected historical-test failure is causal evidence, not a product regression or an ignored green run. Other filtered cases are not exercised or counted as passes. |
| A2 exact corrected positive | Select that same named case from unmodified corrected main.test.ts under the same alias namespace and same built-entry hash. Require one active target test and exit0. The original named-resource, one-line/control-character, blank stdout, owner/database record preservation, contender-directory release and authenticated owner-still-serving assertions all remain and must complete. | Existing real public built-entry behavior on Windows. It does not prove the actual Darwin temp alias or native Mac launcher acceptance. |

The test name is `refuses a shared database in one line and leaves its existing owner serving`. Each invocation gets its own original fixture's fresh stores. Reuse the alias namespace and immutable built entry, not a running owner/store from A1. No normal-path third test, other existing test, full regression or CI rerun is needed for this causal delta.

## Worker-only controls and observations

Before any source overlay or execution, verify the frozen head/tree/parent, exact parent/corrected test blobs, author's two-line correction, unrelaxed assertions, raw alias fixture and unchanged production. Bind the compiled entry and helper paths after reading the frozen source. Build once before both invocations and keep the compiled entry hash identical throughout.

The coordinator/build shell retains its original TEMP/TMP. The extra setup runs after the existing API setup in the selected fork, verifies its worker identity, saves its own old TEMP/TMP, then points both to the alias. Restore them in worker teardown. The API children naturally inherit that fixture environment. Do not set machine/user TEMP, TMP, TMPDIR, SystemRoot or any provider variable, and do not dump environment/credentials.

A pass-through observation of the actual public mkdtemp result confirms that the existing test really created its fixture through the alias. Resolve the returned directory immediately and require containment in the pinned owned physical target before it can be used or cleaned up. Preserve original filesystem results; no mocked realpath/canonicalizer or fabricated path is allowed.

A passive pass-through child-spawn observer may record the actual returned handles, PID/spawn/exit/close identity, built entry and only nonsecret path/port fields necessary for ownership. Do not log API keys, full environment or provider data. Preserve actual child results and existing source cleanup. Read the existing helper before execution to bind its owned-handle termination. The observer never stops anything; no PID-only enumeration/kill, unrelated process, or unverified reused PID is permitted. Require all observed direct test children closed, including the original owner after each invocation. If an owned child remains, retain the failure and use only its verified original handle/generation for any admitted cleanup; never substitute a broad process sweep.

## Alias creation and cleanup guard

Allocate one unique task-owned scratch root below the new execution evidence root, never under old QA or an owner store. Proposed shape is `scratch/run-<uuid>/physical` plus sibling `scratch/run-<uuid>/alias`. Neither path exists now. Pin the physical root, alias spelling, native Junction type, recorded target and actual Node realpaths before execution. All source fixture directories must resolve within physical.

Use PowerShell/native .NET end to end for junction creation/removal and final recursive sandbox cleanup. Do not pass enumerated paths into cmd, batch or a second deletion shell. Before cleanup, require every owned child closed, re-read the alias as the same Junction with the same resolved owned target, and verify the physical target remains the originally allocated contained directory. Refuse unexpected replacement/type/target changes.

Remove only the verified junction entry nonrecursively, for example `[System.IO.Directory]::Delete($alias, $false)` after its live type/target guards. Verify the link is absent and physical target still exists. Then recursively remove only the verified resolved owned physical/scratch paths, after absolute containment checks. Existing Node test cleanup is limited by the actual mkdtemp containment witness above. Preserve both link/target before/after identity and cleanup results. No broad recursive removal of an unchecked reparse point is permitted.

## Proposed future commands, not executed

Use the project Node22.23.4 shell and pnpm.cmd. Fresh offline installation and build require explicit root execution admission; retain actual install/postinstall/build output and each exit. The API typecheck covers the unchanged parent TS copy and corrected source. Syntax-check the two small external runner files; do not claim ignored external-file lint as verification.

```powershell
pnpm.cmd install --frozen-lockfile --offline
pnpm.cmd build
pnpm.cmd --filter @graphgoblin/api typecheck
# Read-only syntax checks of the admitted external .mjs runner files.
node --check <execution-evidence>/vitest.alias.config.mjs
node --check <execution-evidence>/worker-alias.setup.mjs
# Expected exit1; inspect exact mismatch before admitting dependent A2 evidence.
pnpm.cmd --filter @graphgoblin/api exec vitest run src/main.d238-parent.independent.qa.test.ts --config <execution-evidence>/vitest.alias.config.mjs --maxWorkers=1 --retry=0 -t "refuses a shared database in one line and leaves its existing owner serving" --reporter=default --reporter=json --outputFile=<parent-negative.json>
pnpm.cmd --filter @graphgoblin/api exec vitest run src/main.test.ts --config <execution-evidence>/vitest.alias.config.mjs --maxWorkers=1 --retry=0 -t "refuses a shared database in one line and leaves its existing owner serving" --reporter=default --reporter=json --outputFile=<corrected-positive.json>
```

Resolve literal paths, actual ESM imports, config delegation and one-case selection before execution. Use only `--maxWorkers=1 --retry=0`; Vitest5 rejects `--minWorkers`, as the author already recorded. Preserve original configured test/hook deadlines and no retries. Do not increase them or rerun to obtain green. A1's expected failure and any unexpected initial failure remain; A2's actual outcome is recorded separately.

## Closure and scope

Capture original stdout/stderr/actual exit for every install/build/check/test command, exact fixture/config/setup bytes, alias/type/realpath witnesses, child close receipts and all first failures. Compare head/tree/parent, lock and physically present tracked source, raw index and ordered stage entries before/after. Record sparse omitted `docs/qa` and skip-worktree state explicitly; do not materialize it, hash its absence as full source coverage, or change sparse/index settings. Only the admitted parent-copy overlay may be untracked in the QA repository.

Keep test-source parity against immutable blobs and ensure the built production entry is identical for A1/A2. Seal outcome, environmental controls, cleanup, limitations and manifest, then explicitly release the heavy slot after necessary checks. No product fix, assertion relaxation, platform skip, retry/timeout/coverage change, global environment change, old-QA write, CI push/rerun, device action, provider call or general review scan is part of this work. Root's full corrected-head/target seven-job CI, required native artifacts/coverage, actual Claude named review, final audit, Mac GUI evidence and owner acceptance remain separate and required.
