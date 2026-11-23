# Independent behavior QA for GraphGoblin #488 and #496

Candidate base `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. Source was copied into `codex/gg-20261117-ci-gates-qa` without installing or running anything in the author or owner checkout. The author source listed exactly eight changed files. All eight raw SHA-256 and Git blob bindings and the tracked diff SHA-256 matched the frozen candidate. The 72 entries in the author's `SHA256SUMS.txt` matched its files. The copied source remains uncommitted. This is independent behavior QA. The formal review count remains 0/3. [Source receipts](copied-source.json), [original bindings](../i1-ci-implementation-evidence/SOURCE-BINDINGS.txt).

## Findings that require correction

1. **Prepare failure skips the native acceptance command.** In `ci.yml` lines 28–45, a nonzero Prepare prevents the subsequent Install and Build from running under their implicit `success()` condition. Native's explicit condition sees a skipped Build and never invokes `pnpm test:windows-launcher`. The modeled invalid-init case is the only failure in six cases. The resulting outcomes were `evidence=failure`, `install=skipped`, `build=skipped`, `native=skipped`, `finalize=skipped`, `upload=skipped`. The CLI independently produces real code 1 for missing, in-checkout, linked and glob-bearing runner-temp input. Preserve successful build → failed prepare → native execution with a red job and no artifact from invalid prepare. Retain successful prepare → failed install/build → metadata `not-run` behavior. [Windows status model](workflow-controls.json), [GitHub status-check semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions).
2. **Finalization passes through unvalidated manifest bytes.** `readManifest` at lines 562–580 validates only schema, state and UUID. With an otherwise genuine ordinary file, prepending an unknown `path` field with a private path canary or a duplicate `state` field carrying a canary yielded exit 0, `not-run`, and raw `manifest.json` selected for upload. The same pass-through occurs regardless of native status because selection occurs after this shallow read. Validate exact fields and canonical UTF-8 bytes of the entire original manifest, including binding shape and static file and limit declarations, before publishing paths. Do not confuse this check with authentication or protection against a hostile runner. The same byte-canonicality contract currently accepts a UTF-8 BOM before observations because the decoder strips it before the line comparison. The BOM control demonstrates contract drift without demonstrating disclosure. [Exact CLI outcomes](cli-controls.json).
3. **A contradictory binding and duplicate evidence can qualify as complete.** A normal push init with an intentionally wrong event head produced `headMatchesEventHead: false` and `matchesSha: true`, followed by finalize exit 0 and `complete`. Distinct increasing sequence values also allowed three records for contention trial 1 to satisfy three required trials, and two alias-spelling records for each link kind to satisfy the required alias and direct release paths. A second `recorder-open` row was also admitted as valid in a failed suite. Correct these as contradictions or missing requirements in the relevant schemas and summaries. Keep honestly incomplete failure evidence where its data is valid. [Exact CLI outcomes](cli-controls.json).

## Independent controls

| Check | Outcome |
| --- | --- |
| Frozen install, build, tooling lint | All exit 0. Build 12/12 tasks and no cache hits. |
| Helper's focused Vitest file and coverage | 21/21, 99.14% lines and 97.10% branches. Whole tooling coverage and performance suite intentionally did not run. |
| #488 repository inventory | 24/24 previous non-coverage Gates step definitions retained. Both lanes independent. Audit, Chat restart and final checks retained. The existing coverage upload path/name remained and missing summaries now warn. Browser and Template image job definitions, top-level trigger and concurrency settings matched. |
| #488 exact runner-script bodies via Git Bash | Fan-in 25/25, only success/success green. Coverage summary 5/5, partial marked on every non-success and report counts checked on complete, failed and missing cases. This invokes the YAML shell scripts with controlled results. Hosted scheduling and platform cancellation remain separate. |
| Coverage task graph | 13 actual `test:coverage` commands selected under the published serial invocation. Coverage configuration and lockfile unchanged. |
| #496 Windows workflow conditions | 5/6 modeled cases, with the single prepare-order failure above. Existing install, build, native commands and 20-minute job cap preserved. |
| #496 direct CLI | 8/13 grouped controls. Genuine synthetic complete evidence, missing/skipped/failed native outcome handling, exact paths, unsupported init paths, incorrect ID, unexpected files, hard links, a Windows junction, malformed record/duplicate keys/duplicate sequence/truncated and oversized observation reads passed. Five grouped failures under findings 2 and 3. |
| Real synthetic Node test and actual child | Child exit 7 and test exit 1 preserved. Exit 7 demonstrates the evidence directory variable was absent from that child. The ordinary synthetic env/stdout canaries were available to the child by construction, and no stdout, stderr, env, fixture-path, or linked-store canary bytes appeared in the genuine export. One overflow marker, 808 omitted records, 600 retained records and 184,215 bytes across the three regular single-link files. Junction state was `link` and the link was unlinked non-recursively after the probe. |

Local inputs did not include real secrets. The evidence path is removed before children start. General inheritance of ordinary environment values by existing fixture children is outside this evidence-export change.

[Workflow matrix](workflow-controls.json), [dry-run graph](coverage-task-graph.json), [helper test log](helper-tests.log), [tooling lint](tooling-lint.log), [CLI matrix](cli-controls.json), [synthetic TAP](synthetic-node-tap.log).

## Native Windows acceptance

The exact `pnpm.cmd test:windows-launcher` command ran against the built QA copy using disposable ports 63900–63919. Init exited 0, native exited 1 after 270.1 seconds and finalize exited 0. All 25 TAP result lines matched the retained same-host unmodified base run. 23 passed. The directory symlink subtest failed with `EPERM` at `create-alias`, which also failed its parent. The junction, installer, native launcher, lock contention and bounded logging cases passed. The author baseline was verified against its manifest before comparison.

Finalization returned `native-failed` and `valid` with 203 observations, no overflow, and three regular staging files totaling 53,343 bytes. Four typed stdout markers reconciled with the staged observations. The result names the four missing checkout-alias requirements. The verifier found no raw path or environment canary in those files. The local run intentionally recorded GitHub bindings as unavailable. This staged evidence verifies native behavior and file selection on the Windows host. Hosted candidate upload/download and the candidate's complete passing evidence still require the actual CI runner.

The reserved range 63900–63949 had zero listeners after acceptance. Zero surviving launcher or Node processes matched the QA checkout. The controlled synthetic junctions were unlinked by literal path without recursion. The standard fixture directories, isolated checkout, raw results and staged evidence remain available for reproduction. No changes entered the author checkout, owner checkout, Git index, GitHub issues or hosted workflows in this QA lane.

[Native TAP](native-tap.log), [same-host baseline TAP](../i1-ci-implementation-evidence/local/base-same-host/native.log), [TAP comparison](native-baseline-comparison.json), [native status receipt](native-exits.json), [bundle receipts](native-bundle-receipts.json), [bundle verifier](native-author-verifier.json), [cleanup receipt](cleanup.json).

## Reproduction commands

Run from the isolated QA checkout with the project Node `v22.23.4` first on `PATH` and `pnpm.cmd` v12.8.1. The two independent harnesses return exit 1 on the frozen candidate because the assertions capture the defects above. The workflow harness is a bounded source/status model coupled to exact shell bodies. The CLI harness executes the actual helper as a child Node process with synthetic GitHub inputs and writes only under a newly created TEMP fixture.

```powershell
$env:PATH = "$env:USERPROFILE\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64;$env:PATH"
node --version
pnpm.cmd --version
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
pnpm.cmd --filter @graphgoblin/tooling lint
pnpm.cmd --filter @graphgoblin/tooling exec vitest run scripts/windows-launcher-evidence.test.mjs --coverage.enabled --coverage.include=scripts/windows-launcher-evidence.mjs
pnpm.cmd exec turbo run test:coverage --concurrency=1 --dry=json
node 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ci-independent-qa/cli-controls.mjs' (Get-Location).Path
python -I 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-ci-independent-qa/workflow-controls.py' (Get-Location).Path
```

Live `main` resolved to the baseline head, `protected: false`. The branch-protection endpoint returned HTTP 404 with `Branch not protected`, and the ruleset list was empty. The candidate preserves the workflow's `Gates` name. This readback established no platform-required context. No configuration was changed.

The author's first unchanged performance workload run still records a 180.025-second exec deadline and one test failure. The isolation and whole-tooling rerun passes remain separate observations. The reason for exceeding that deadline is unresolved. [Read-only recurrence packet](../i1-perf-timeout-recurrence-readonly/README.md).
