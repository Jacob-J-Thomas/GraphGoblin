# Issue #273 domain final correction

This packet records the bounded A1 source correction for the domain node-reference scanner. Its admitted source head was `5a4fb439c63755eeb2b5bef945319772623a9905` (tree `caf777a63de7d9938b03dfa81b9ee60e9a1bf3e5`), based on `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`. The exact two-file source change is preserved in [a1-correction.diff](raw/a1-correction.diff) (5,513 bytes; SHA-256 `e773126f69c587c1ea4bb3fdb99d09d5c46f6a2da581b1087fe335b17cc90aab`), with source identity in [identity.json](raw/identity.json).

## Paired evidence

The original scanner run passed 92 and failed 6 expected assertions; its dynamic-key control passed. The corrected scanner passed all 98 tests across four files. The test file hash was identical in both runs. See the [before verbose log](raw/focused-before.log), [before JSON](raw/focused-before.json), [after verbose log](raw/focused-after.log), [after JSON](raw/focused-after.json), and [paired assertion inventory](raw/paired-result.json).

The focused tests cover computed lookup-key traversal, publication diagnostics, explicit optional probes, and a non-blocking variable key. They exercise domain assertions and in-memory expression evaluation. They do not establish behavior through the public API or native UI. The [AST probe script](raw/lookup-ast-probe.mjs.txt) and [probe output](raw/lookup-ast-probe.jsonl) preserve how the installed evaluator's AST shape informed the bounded correction.

No-emit TypeScript, focused ESLint, Prettier, and `git diff --check` exited 0 on Node v22.23.4 and pnpm 12.8.1. The [no-emit typecheck log](raw/type-noemit.log), [lint log](raw/focused-lint.log), [final format log](raw/format-final.log), and [diff-check log](raw/diff-check.log) preserve those checks, including empty logs for successful no-output commands. The [initial format log](raw/format-initial.log) is retained as well. The [retained runtime readback](raw/retained-runtime-readback.json), produced by [verify-retained-runtime.mjs](raw/verify-retained-runtime.mjs), matched all 1,227 files in 13 trees against the existing build binding. This is a readback of existing compiled output, not a build.

## Limits and next gates

Root accepted this as bounded A1 source completion. The handoff preserves the reviewed source state and next-step details at [handoff.md.txt](raw/handoff.md.txt). The packet contains no native or public-API validation, emitting typecheck, build, coverage, exact-head CI, or parent-completion result. Those remain separate gates. The three formal audit scans have been consumed; this packet makes no new review claim.

The [copy manifest](copy-manifest.json) maps each retained source file to its copied path, byte count, and SHA-256. The [packet manifest](manifest.json), [README link audit](link-checks.json), and [SHA256SUMS](SHA256SUMS.txt) provide integrity checks. `.gitattributes` disables text conversion beneath `raw/` so retained bytes remain unchanged when integrated into Git.
