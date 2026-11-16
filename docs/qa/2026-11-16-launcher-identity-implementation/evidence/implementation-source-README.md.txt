# #435 implementation handoff

The worktree began from actual post-#419 main `9fa8b2474c7290adb800c5e26be73511095cae25`,
tree `88ade580c80b2139b5d1bf51449dca10e33184f1`. The admitted baseline build binding is
`5067bdd664f273e1b391d5d7d7ba96a71b777821dbd76c2b98a4ed48e8e7d29a`.
[Exact baseline source and artifact readback](red-source.json)

The helper now compares both existing entry paths using `realpathSync.native`. Missing and
invalid paths leave the helper inactive. The identity digest and store-state implementations
remain the existing code. The repository test uses a disposable checkout junction on Windows
and a directory symlink elsewhere. Both helper modes must return exactly the direct stdout
and empty stderr. An imported aliased helper remains silent with invalid configuration,
and direct aliased execution with that configuration must emit the existing refusal. The
disposable data directory stays empty. API tests cover relative, unrelated, missing and invalid
entry paths. The Windows launcher docs and changelog describe the checkout alias behavior.
[Five-path source manifest](candidate-source.json)

## Verification

All commands ran with project Node `v22.23.4` through `pnpm.cmd`. Command JSON records exact
arguments, UTC start, elapsed milliseconds and exit.

| Check | Result | Evidence |
| --- | --- | --- |
| Built-helper regression against the admitted old build | Exit 1 in 31.847 s. The existing health, digest and refusal test passed. The new alias test reached and passed direct digest/free-state, import and empty-store controls. The junction digest and state commands both exited 0 with empty stdout and stderr. The invalid configuration through that junction also exited 0 with empty output. All three expected candidate assertions failed. | [Execution](built-regression-baseline.json), [log](built-regression-baseline.log), [exact test bytes](built-regression-before.mjs.txt) |
| Focused API tests | 13 passed. Covers the entry predicate, shared ownership checks, runtime floor, digest and health identity. | [Execution](focused-api.json), [log](focused-api.log) |
| API type check | Exit 0 using `tsc -p tsconfig.json --noEmit` with composite and incremental disabled in that config. | [Execution](api-noemit.json) |
| Scoped lint and format | Both exited 0. The finalized test also passed ESLint before the baseline run. | [Pre-red lint](regression-lint.json), [candidate lint](scoped-lint.json), [candidate format](scoped-format.json) |

The candidate uses the exact regression test bytes run against the old build, SHA-256
`724ef43658d38f0e6357673a06be1c9be6d0649e1bfe3d6aaed1fa97ce4a0a80`. Baseline artifact
readback matched all 1,231 files across 13 output roots, including the compiled helper.
`git diff --check` passed for the five implementation paths.
[Preserved baseline outputs](preserved-baseline-output-readback.json)

Candidate built-helper verification, native candidate QA, hosted true Windows symlink evidence,
formal review and CI remain separate delivery gates. The local native symlink attempt had an
OS capability refusal. No build or coverage run was performed during this implementation pass.
