# D197 independent corrective QA

**PASS for the bounded documentation correction at `08633913a58cb42c32b4a18c72cd4aed67cfefa6`.** The existing engine suite passed **15/15** and API suite **4/4**, each executed once. The corrected wording matches the inspected public API, engine, UI selection and trigger contracts. All three documents pass Prettier and the exact candidate delta passes `git diff --check`. No product defect was found within this corrective QA scope.

This is independent QA, not author verification, an opposite-family corrective review, a fourth general review or a replacement final audit. The original scan 3 **CHANGES_REQUIRED** report remains unchanged and negative. Fable corrective review, exact-head/current-target CI and canonical native verification, public errata/PR/archive updates and explicit coordinator completion under D035/D042 remain root-owned gates. This report grants no merge or owner acceptance.

## Binding and execution

| Binding | Verified value |
| --- | --- |
| Independent checkout | `G:/ggq/gg-i4-362-qa/GraphGoblin` |
| Initial checkout | Clean at `02351e2fb932b3be44e7cc3fb3943a61d568226c`; preserved initial observations |
| Candidate | `08633913a58cb42c32b4a18c72cd4aed67cfefa6` |
| Tree | `f7b63399b7f66ece81cc711c684073463fa39731` |
| Parent | `505060e2c396db5355f0b1f1f4048cbeb9ec30f8` |
| Acquisition | Local exact-object fetch from author checkout, no tags/FETCH_HEAD update, then authorized detached checkout |
| Source delta | Exactly 3 documents, 18 insertions and 8 deletions; 6 changed paragraphs; runtime, maintained tests, UI, trigger implementation and original archives unchanged from parent |
| Runtime | Node `v22.23.4` first on process PATH; pnpm `12.8.1`; Vitest `5.0.3` |
| TEMP/TMP | `G:/ggq/qa-scratch/i4-362-draft-docs-qa-01`, process scoped |
| Final checkout | Clean; unstaged and staged diffs empty; detached at candidate |
| Held scan 3 SHA-256 | `11ea4ff863fc923388d0d19c26e3d7e4bed8d1e0a5a877626c80b6dbe30710f5`, matches original before and after |

The normal supported package commands were:

```text
pnpm.cmd --filter @graphgoblin/engine test src/definition-pin.test.ts --reporter=verbose --reporter=json --outputFile.json=<this packet>/observations/engine-vitest.json
pnpm.cmd --filter @graphgoblin/api test src/definition-pins.test.ts --reporter=verbose --reporter=json --outputFile.json=<this packet>/observations/api-vitest.json
pnpm.cmd exec prettier --check docs/04-node-catalog.md docs/guide/03-run-and-observe.md docs/guide/07-troubleshooting.md
git diff --check 505060e2c396db5355f0b1f1f4048cbeb9ec30f8 08633913a58cb42c32b4a18c72cd4aed67cfefa6
```

No install or build was required or run. Both selected files use source imports and public methods/in-process injection. `tooling/vitest.shared.mjs:11-25` selects the `development` export condition; package exports point at TypeScript source. The API subprocess-build requirement does not apply to this selected in-process file. No prebuilt API, native API process, browser or provider process was launched. No coverage/full-repository/typecheck/lint claim is made by these focused runs; full CI is a separate gate.

The root clarified before API execution that the existing suite's two disposable `127.0.0.1` fake-classifier listeners were authorized: the no-network boundary excludes external, owner and provider endpoints. The original boundary and clarification are retained in `originals/loopback-clarification.txt`. API routes were exercised by Fastify `inject`, with real disposable file SQLite, fake harnesses/deciders and controlled classifier fixtures. The classifier test name says provider model; its endpoint is the local fake, not a remote provider.

## Complete changed-statement trace

Source paths and lines below are at the exact candidate. Raw source bytes and hashes are retained under `source/` and `observations/source-binding.json`. `observations/changed-paragraphs.json` contains each complete old/current paragraph and line. Nine local links/anchors resolve independently in `observations/local-links.json`. All other paragraphs in the three documents are byte-identical after newline normalization.

| Changed passage | Claims checked | Independent supporting source |
| --- | --- | --- |
| `docs/04-node-catalog.md:154-164` | Fresh corrected definition; UI uses published version; explicit editable draft ID plus `allowDraft: true`; fresh unpublished snapshot; publication can change cron/webhook registrations; original Resume/Replay pin and external-repair exception retained | API/selection/snapshot/UI/trigger/recovery traces below |
| `docs/guide/03-run-and-observe.md:175` | Generic configuration/graph fix uses fresh corrected definition, publication qualified to UI, API draft alternative with snapshot, trigger consequence, original recovery pin | All traces below |
| `docs/guide/03-run-and-observe.md:273` | Script configuration fix uses published UI or explicit API saved-draft start; Resume/Replay do not apply the edit | API/UI/recovery traces below; external-repair distinction remains |
| `docs/guide/03-run-and-observe.md:289` | Diagnostic checklist uses fresh corrected definition with published UI or explicit API draft selection, rather than universal promotion | API/UI/selection traces below |
| `docs/guide/07-troubleshooting.md:150` | Script failure guidance distinguishes fresh corrected UI/API paths from original pinned recovery and external repair | API/UI/recovery traces below |
| `docs/guide/07-troubleshooting.md:210-224` | Explicit shell example remains; fresh run and UI/API draft distinction; separate snapshot; trigger consequence; old batch command remains pinned for Resume/Replay; external-only repair can use existing pin | All traces below; authored shell fields, untrusted-text caution and consent wording unchanged |

| Public contract | Exact source and result |
| --- | --- |
| Start route and input | `apps/api/src/routes/runs.ts:72-123`: `POST /loops/:id/runs` accepts `versionId` and `allowDraft`; checks owned loop; forwards selected version and explicit true flag to `manager.startRun`. No publish call is made. Ordinary definition/readiness/manual-trigger validation still applies; this correction is no promise that arbitrary drafts are runnable. |
| Editable draft vs snapshot ID | `packages/engine/src/run-manager.ts:3362-3384`: explicit ID must belong to loop; a draft without `allowDraft` is refused with `VERSION_NOT_PUBLISHED`; a snapshot ID is refused even with true; omitted ID selects the latest published version. Documentation correctly names the editable draft's ID. The missing-allowDraft branch is source-inspected, not an additional executed case in this packet. |
| Fresh immutable draft snapshot | `packages/engine/src/run-manager.ts:657-746,758-806` and `packages/engine/src/definition-pin.ts:96-117`: `prepareStart` reads/validates selected definition, `freezeDraft` structured-clones it under a new ID/status snapshot, and the admitted run pins that ID. No publication occurs. Existing engine fresh-draft case executes old output in the original run and edited output in a distinct fresh snapshot. |
| UI publication boundary | `apps/web/src/runs/new/NewRunPage.tsx:36-47,86-90,120-123`; `RunLauncher.tsx:14-31,91-98`: New run offers published loops/versions, filters status published, and starts the selected published `version.id` without `allowDraft`. No published version yields a warning. This is source evidence; no browser or UI interaction was performed. |
| Publication side effect | `apps/api/src/routes/loops.ts:363-394` invokes `triggers.armVersion` after publish. `apps/api/src/triggers/trigger-service.ts:210-255` builds version-specific cron/webhook drafts and replaces registrations. `packages/infrastructure/src/sqlite/triggers.ts:81-115,222-276` disables earlier versions' schedule/endpoint rows and inserts current rows. `docs/08-triggers-and-integrations.md:29-37` agrees. This verifies the qualified word can; configured/enabled/valid triggers determine which registrations arm. No cron fire/webhook delivery or trigger replacement experiment was run. |
| Resume retains pin | `packages/engine/src/run-manager.ts:1213-1221,1413-1499,1592-1601,2342-2369`: recovery reads the existing run version; failed Resume changes lifecycle/failure fields and requeues without changing version/pinned configuration; execution rereads `run.versionId`. This source trace covers failed Resume; the freshly run pin suites primarily continue parked waits through input/restart. |
| Replay retains pin | `packages/engine/src/run-manager.ts:1782-1825`: Replay reads source version and creates a new run with `source.versionId`/`source.pinned`. Engine and API existing tests directly execute the original snapshot in Replay after edits and restart. |
| External-only prerequisite repair | `packages/engine/src/handlers/script.ts:61-115` makes a new scripts-port call from the pinned configuration and distinguishes definitely-not-started; Resume requeues the same configuration as above. Prior A3 fixture at `docs/qa/2026-11-21-i4-362-batch-commands/independent/evidence/fixtures/a-api.mjs:231-247` restores the missing executable and explicitly Resumes; its historical result is documented in the sealed final report. This correction preserves that case. It was not rerun and is not fresh native evidence. |

## Executed positive and negative evidence

| Case group | Actual observation | Scope |
| --- | --- | --- |
| Engine editable draft, lines 104-149 | Original snapshot differs from editable draft ID, is unpublished, retains old output after editing; a new draft start with the editable ID/true gets a different snapshot and new output | Fresh public `RunManager` behavior over fake ports; directly establishes the D197 criterion without publication |
| Engine active edit / restart / Replay, lines 151-188 | Mid-execution draft edit does not change old output; restart retains old pin; Replay fork retains ID/pinned fields and old output | Public-method tests over fake ports |
| Engine published version, lines 200-214 | Original waiting run retains old version/output after newer version; fresh run takes newer version/output | Controlled same-loop published-version semantics; not a native Windows script republish experiment |
| API definition pin, lines 220-359 | Injected explicit editable-ID/true start returns different snapshot ID; snapshot survives edit/publish, Settings changes and container reopen; original outputs remain old; fresh published run returns new; Replay retains original draft snapshot and old result | Real API route/in-process Fastify plus disposable SQLite and controlled components; container/store reopen, not OS-process restart |
| Direct snapshot-start negative | Engine rejects `VERSION_NOT_PUBLISHED`; injected API returns 409 with same code even with true; snapshot absent from version history | Both executed existing suites |
| Typed input negatives | API invalid types return 400 `INVALID_INPUT` for selected schemas across versions/loops/reopen; corresponding valid values succeed | Executed existing API case |
| Other negative controls | Disabled classifier fails explicitly without substitution; missing/unbound inherited property names stay unbound; shared child bindings/defaults remain pinned | Executed engine controls and API loopback classifier cases; not remote-provider evidence |

All 19 case names, durations and statuses are in `observations/test-cases.json` and original Vitest JSON/stdout. There were zero failed or skipped cases and no repeated product-test command. This packet establishes the draft/pin criterion; it does not newly establish failed native batch execution, shell quoting, real UI behavior, authentication, actual trigger firing or external-provider availability.

The two fake endpoint cases await `fixture.close()` in finally; `apps/api/src/testing/fake-classifier.ts:91-112` binds only loopback and closes the server/connections. The suite completed normally with exit 0. The attempted during-process snapshot was late and captured no workers/listener ports, so independent post-close port verification is unavailable. The task shell no longer existed at the after snapshot. Four `gg-pins-*` directories and `node-compile-cache` remain in task TEMP and are preserved; the suite suppresses disposable-store removal failures. `api-process-after.json` contains a mistaken empty-TEMP phrase contradicted by its actual entries; `api-process-after-erratum.json` explicitly corrects that phrase and inventories retained files. No complete filesystem-cleanup claim is made.

## Preserve original attribution errata

1. **A/A6 authentication:** earlier short summaries called the original REST cases authenticated. Their driver disabled enforcement and sent no credential. Those original cases establish loopback HTTP/SQLite behavior. This QA adds no authenticated-native-REST claim; in-process test injection likewise does not complete authentication acceptance.
2. **Same-loop republish:** original review 2 prose implied an observed same-loop publish/fix/retry sequence. Its five native fixture loops were each published once; A5 explicit-shell success was a different loop from A1. Original pinned retries and distinct explicit-shell/external-repair controls were observed; same-loop version semantics were source-backed there. The newly executed existing engine/API tests establish same-loop pin behavior only at the controlled component/in-process level stated above. The combined native Windows batch-after-same-loop-republish scenario remains unobserved.

Neither original archive nor review text was rewritten. Root owns two separate append-only public errata. The sealed held final report and its findings remain the authoritative original scan-3 record.

## Verification record and failures retained

| Command | Result |
| --- | --- |
| 01 local exact fetch | Exit 0, local path only |
| 02 detached candidate checkout | Exit 0, exact frozen head/tree |
| 03 engine definition-pin | Exit 0; 15 passed |
| 04 API definition-pins | Exit 0; 4 passed |
| 05 three-doc Prettier | Exit 0; all three formatted |
| 06 exact candidate diff check | Exit 0; no whitespace errors |
| 07 source-only verifier | Stopped, exit -1: local PowerShell helper function named Git recursively shadowed git.exe; no source copies or product mutations occurred |
| 08 corrected source-only verifier | Exit 0: same assertions, renamed helper with explicit git.exe and named array binding; exact head/tree/parent, 3 docs/6 paragraphs/9 links, 19 cases, 34 byte-verified source copies, clean source/index and unchanged negative scan3 seal |

Each numbered command has stdout, stderr and a receipt. No failed command was rerun unchanged, no product assertion was weakened and no product-test failure was hidden. The original verifier and terminated task-specific helper binding are retained. Initial read-only discovery also used an invalid `.git/index` assumption in this worktree and guessed nonexistent Vitest/SQLite filenames; those errors and the null partial state are preserved as identified transcriptions/failed observations. The corrected initial collector asks Git for its actual worktree index path before any checkout.

No source, maintained test, original archive, Git index contents, global setting, owner store, provider account, commit, push or GitHub record was edited by this QA. The explicitly authorized checkout changed the worktree/index to the candidate; final tracked/staged contents match it. All created evidence and helper files are in this new packet, with process scratch isolated under the task TEMP. Artifacts have a manifest and seal for root handoff.
