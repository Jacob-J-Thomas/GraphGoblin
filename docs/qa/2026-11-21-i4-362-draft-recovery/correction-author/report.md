# D197 bounded documentation correction: frozen author handoff

Implemented the selected fresh-run correction in the three authorized documents at clean starting head `505060e2c396db5355f0b1f1f4048cbeb9ec30f8`. Scoped Prettier, `git diff --check` and author source/scope checks pass. No runtime, maintained test, historical archive or Git index changed. No build, test suite, native matrix, provider, GitHub action, commit, push or publication was invoked.

| Document | Final SHA-256 |
| --- | --- |
| `docs/04-node-catalog.md` | `fffee01d1e68409ec140bfc2f71ff132eec5e6a1baf58e24d88652547f39c830` |
| `docs/guide/03-run-and-observe.md` | `9b7329496f4e28b427d6389bcbf9b5affd2abccddcf7a9472edc19bea707075b` |
| `docs/guide/07-troubleshooting.md` | `33bdd0b1b0ffcb7fa24c9dfd45f785b5be1ca99c4fd27fe7f3b948b638e85bc9` |

The six selected recovery paragraphs now direct a fresh run from the corrected definition. They distinguish the UI's **New run**, which uses a published version, from an API start of an unpublished saved draft using the editable draft's `versionId` and `allowDraft: true`. The detailed passages give `POST /loops/{id}/runs` explicitly. The new run freezes a separate snapshot, so testing that saved draft does not require publication. Publication can arm its cron and webhook triggers and disable earlier registrations, with links to the existing trigger contract.

All four #362-introduced recovery passages were corrected: the Script catalog paragraph, the run guide's `SCRIPT_START_FAILED` guidance, troubleshooting's script-failure paragraph and the Windows batch-command example. The run guide's generic configuration-recovery paragraph and diagnostic checklist prose were also corrected so they do not repeat a blanket publication requirement. Resume and Replay retain their original pin; the existing external-prerequisite-repair case still permits ordinary Resume. The existing authored-shell example, `/d` and `/c` explanation, untrusted-text caution, script consent rules, error codes and other contents remain unchanged. Existing unrelated provider/error-table advice was reviewed and retained within the selected scope.

`final/change.patch` is the exact Git diff, comprising three files, 18 insertions and 8 deletions. `observations/source-checks.json` identifies every changed paragraph, its current line and full text. The source check verifies that all paragraphs outside those six selected blocks remain identical after newline normalization, that all nine local links and anchors resolve, and that the Git index remains unchanged. Its eight protected source/test/UI/trigger-contract hashes match the starting binding.

The author trace is source-backed. It records ten exact excerpts and full-file hashes, with retained source copies under `source/`:

| Claim | Source inspected |
| --- | --- |
| API accepts and forwards `versionId` and `allowDraft` | `apps/api/src/routes/runs.ts:72-123` |
| Draft start freezes the validated definition into a snapshot | `packages/engine/src/run-manager.ts:657-730` |
| Explicit editable draft selection requires `allowDraft`; snapshot IDs cannot start directly | `packages/engine/src/run-manager.ts:3362-3384` |
| Recovery uses the existing version; Replay copies its version and pinned fields | `packages/engine/src/run-manager.ts:1213-1221` and `1782-1824` |
| UI starts a selected published version | `apps/web/src/runs/new/RunLauncher.tsx:14-97`, also `NewRunPage.tsx` |
| Publication invokes trigger arming | `apps/api/src/routes/loops.ts:363-394` |
| Arming replaces version-specific schedule/webhook registrations | `apps/api/src/triggers/trigger-service.ts:210-255` and `docs/08-triggers-and-integrations.md:29-37` |
| Existing draft criterion observes old output in the original snapshot and edited output in a fresh draft run | `packages/engine/src/definition-pin.test.ts:103-149` |

That last test was inspected, not executed by this author. The existing API definition-pinning test was also inspected and hash-bound. Separate independent QA owns execution of the existing draft snapshot criterion; these source checks are not behavior QA or a fourth review.

| Retained command | Result |
| --- | --- |
| `01-three-doc-format` | PASS: `pnpm.cmd exec prettier --check` on exactly the three documents |
| `02-diff-check` | PASS: `git diff --check` |
| `03-source-contract-and-scope` | FAIL in external author checker: it expected one space where the catalog's Markdown wraps a phrase across a newline |
| `04-source-contract-line-wrap-corrected` | PASS: only prose whitespace matching in that external checker changed; document hashes remained identical |

Every scoped command has stdout, stderr and a JSON receipt under `commands/`. Receipts bind all three document hashes before and after each command. The failed checker and its original script are preserved. No unchanged failing command was rerun to seek a different result. Commands selected project-scoped Node `v22.23.4` first on PATH and used per-command TEMP/TMP `G:/ggq/qa-scratch/i4-362-draft-docs-author-01`; no global or HOME setting changed.

The initial brief contained an administrative path typo, naming nonexistent `docs/guide/03-nodes.md`. Root confirmed the intended `docs/guide/03-run-and-observe.md`, corrected the brief before any document edit, and preserved the old brief. Both versions are copied verbatim under `originals/`. Read-only discovery also tried outdated UI paths `apps/web/src/pages/RunsPage.tsx` and `apps/web/src/routes/runs.tsx`, and `apps/api/src/triggers/service.ts`; those lookup errors preceded discovery of the actual files and caused no source mutation. The only failed scoped verification was command 03, whose full error is retained.

The D197 decision and sealed negative scan-3 report are retained unchanged. The latter still hashes to `11ea4ff863fc923388d0d19c26e3d7e4bed8d1e0a5a877626c80b6dbe30710f5`. This handoff makes no claim that historical A/A6 requests were authenticated or that a same-loop republish was executed. The report's separate evidence corrections remain: those HTTP cases disabled enforcement and supplied no credential; the five fixture loops were each published once, while same-loop version semantics were source-backed. Root owns the two separate public errata, current PR body and new corrective archive README; no historical evidence was rewritten here.

The source and author evidence are frozen for root handoff. Remaining gates are the selected actual Fable corrective review, separate independent QA, exact-head/current-target CI and canonical native verification, plus explicit coordinator completion under D035/D042. The three general scans remain consumed. No further general review or renewed Astra approval was requested.
