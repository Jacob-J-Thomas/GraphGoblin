# WP-F1 round 5 (#179): documentation findings

## 1. Branch and worktree

`codex-wp-f1-readiness-precision`, worktree `.claude/worktrees/codex-wp-f1-readiness-precision` under the GraphGoblin checkout. Base: `453aee676882f188429080e948dcd7918f09adfd`. Uncommitted; ready for orchestrator commit after independent review. Documentation only; no index changes, owner-app/store access or provider turns.

## 2. Per bolt

All three round-5 findings for #179 are addressed:

- **QA-01:** docs/09 is the shared description of first load, background rechecks, offline pauses and completed failed lookups. Docs/06 and guides 06/07 link to it. The Settings card's lookup failure is distinguished from the fields' `unknown` state. D-017 explicitly includes template drafts, zero-probe saves and concurrent operation-owned admission probes. Duplicate transport paragraphs and the contradictory troubleshooting footer are consolidated.
- **QA-02:** guide 06 describes the current Defaults asymmetry and links to the pending owner decision in delivery register section 9.
- **QA-03:** owner QA steps 1–3 contain pasteable Windows PowerShell 5.1 commands for Node 22, a build, fresh temporary data, both fake CLIs, explicit binary overrides, a loopback server on port 5624 (or another unused port through 5629), and the built web directory. The final block verifies the disposable directory before cleanup, after Ctrl+C and server exit.

Behavioral evidence is the independent [QA record](../2026-10-20-wp-f1-qa.md) supplied with this brief. This documentation pass does not claim a new browser or HTTP reproduction.

## 3. Files changed

Documentation only; no cross-package source edits:

- `docs/06-harness-integration.md`: replaces the overbroad lookup statement and duplicated transport copy with a link to the shared description.
- `docs/09-frontend-and-pwa.md`: documents lookup phases, card versus field failure presentation, template drafts and request-admission probe sharing.
- `docs/guide/06-settings-and-secrets.md`: describes actual Defaults gating, links the deferred asymmetry decision and shared lookup description.
- `docs/guide/07-troubleshooting.md`: separates client-only checking from server states, corrects the authoring rule, removes the stale footer and consolidates login facts in the readiness section.
- `docs/qa/2026-10-19-wp-f1-readiness/README.md`: supplies complete isolated fake-CLI startup and matching stop/cleanup commands.
- `docs/qa/2026-10-19-wp-f1-readiness/round-5.md`: this report, exact replacement sentences and gate evidence.

## 4. Tests

`pnpm.cmd --filter @graphgoblin/api exec vitest run src/guide-examples.test.ts --maxWorkers 1`: **16 passed, one file passed**, 33.98 seconds. The suite uses the test app and fake harness; no paid turn. Its current example inventory covers guides 02/03, not 06/07. All 21 existing code fences in guide 06 and all 14 in guide 07 were compared with HEAD and are unchanged.

All four new owner-QA PowerShell blocks parsed without errors under Windows PowerShell **5.1.26100.9711**, using `System.Management.Automation.Language.Parser.ParseInput`; the commands were not executed. No new or changed tests, runtime code or coverage denominator. Package coverage was not rerun for documentation-only edits.

## 5. Gates

Node **v22.14.0** was selected on PATH for every pnpm command.

| Command                                                                                        | Result                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm.cmd format:check`                                                                        | PASS: all matched files use Prettier style.         |
| `pnpm.cmd check:docs`                                                                          | PASS: generated docs are up to date.                |
| `pnpm.cmd lint`                                                                                | PASS: 11 successful tasks, all 11 from Turbo cache. |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/guide-examples.test.ts --maxWorkers 1` | PASS: 16 tests, one file.                           |
| `git diff --check`                                                                             | PASS.                                               |

The report is formatted and checked with Prettier separately after recording the gate results. Typechecking, package coverage, build and browser gates were not run: this round changes documentation only and the brief specifies the gates above.

## 6. Docs

Exact shared lookup sentences in docs/09 (line wrapping normalized):

> On first load, readiness is `checking` until a result arrives; the Settings preflight card shows "Loading preflight…". A background recheck (window focus or Retry preflight) keeps the last result on screen. The card announces "Rechecking…" in a muted live region; when its request is paused offline, it keeps the last result and announces "Offline; showing the last check." A completed lookup failure or timeout replaces the card's badge list with "Could not load preflight", with no state badge; the model picker and policy field show `unknown` instead of cached success.

Exact operation sentences in docs/09:

> Draft create, import, template draft and save (including 600 ms idle autosaves) never probe readiness (D-017). The editor fetches readiness independently from `/harness/preflight`. Validate, publish, preflight and run start probe once per referenced harness at request admission, sharing the result within that operation and probing distinct harnesses concurrently. Each new operation probes afresh; a later Claude turn-launch inspection is a separate check.

Exact replacement for the authoring claim in guide 07:

> Draft create, import, template draft and save do not probe readiness; validate, publish, preflight and run start do, sharing one probe per harness within the operation and checking distinct harnesses concurrently (D-017). Publication is blocked with the specific readiness reason when prerequisites are not ready.

The second contradictory guide-07 passage is removed; its login facts now sit under **Read harness readiness**, alongside the shared-description link:

> See [readiness lookup behavior](../../09-frontend-and-pwa.md#claude-readiness-and-saved-selections) for first load, background rechecks, offline pauses, completed lookup failures and transport wording.

Exact Defaults sentences in guide 06:

> In Settings **Defaults**, Claude choices are gated by readiness: when Claude is not ready, the saved choice stays selected as "<name> (saved)" with the short help line "Claude readiness: <label>. See Harness preflight below." Codex keeps its enabled catalog choices and shows the same help line for Codex when it is not ready. This asymmetry is recorded for a later owner decision in the [delivery register, section 9](../../delivery/2026-10-18-i01-i07-register.md#9-pending-owner-decisions-and-acceptance).

Exact cross-reference replacing the overbroad docs/06 lookup statement:

> [Frontend readiness behavior](../../09-frontend-and-pwa.md#claude-readiness-and-saved-selections) describes first load, background rechecks, offline pauses, completed lookup failures, Retry controls and transport wording, including the distinction between the Settings card and fields.

Guide 06's short cross-reference is:

> See [readiness lookup behavior](../../09-frontend-and-pwa.md#claude-readiness-and-saved-selections) for first load, background rechecks, offline pauses, completed lookup failures, transport wording and which operations probe readiness.

The full startup and cleanup commands are in [Owner QA](README.md#owner-qa-disposable-instance-no-turns). No ADR, CHANGELOG, contract, component, product string or generated-reference change was needed; this corrects descriptions of existing behavior.

## 7. Decisions and parameters

Docs/09 is the single full description of lookup presentation and transport wording. The owner recipe mirrors the isolated-app shape of the requested WP-G2 recipe (read from Git object `14f845d`, since that file is absent at this branch's HEAD). Port 5624 is an example within the authorized 5624–5629 range; the owner must choose an unused port. Both binary overrides name newly compiled fake executables, independently of installed/bundled defaults. Fresh data and cleared database/master-key overrides prevent reuse of existing state; the temporary API generates its own key.

## 8. Caveats and open items

No component or runtime change, new live-provider evidence, or owner acceptance is claimed. The startup/stop/cleanup recipe was syntax-checked, not launched or executed in this documentation pass. Existing signed-out instructions and historical process-lifetime evidence remain in the owner README; no installed CLI was invoked this round. Defaults symmetry remains the later decision already recorded in delivery register section 9. Owner product acceptance remains required before #179 closure.
