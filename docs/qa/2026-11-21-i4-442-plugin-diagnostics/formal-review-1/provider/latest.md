# #442 backend review, formal scan 1: APPROVE

**Verdict: APPROVE** for backend `5b0d806c` against parent `02351e2f`, covering the seven frozen files only. I found no blocking introduced defects. This is not approval of the unfinished UI, the integrated PR, merge, CI, the final audit, #439 or owner acceptance.

## Limits of this review
- **Read-only.** I used Read, Glob and Grep only. I ran no commands, builds, tests, typecheck, lint or coverage, made no edits, and touched no GitHub, index or provider.
- **No hash or Git check.** I did not compute any SHA-256 or confirm HEAD, tree or parent. I read the seven files in the checkout and they match `backend.diff` line for line. I took the freeze and binding hashes, the author logs and the independent QA report (stated SHA `c0d91dd…`) as given.
- **`apps/web` not reviewed.** Its uncommitted edits are outside scope.
- **Reviewer identity.** I am running as model `claude-opus-5-5` in the Claude Agent SDK. I cannot independently confirm the "xhigh" effort tier.

## What I checked and why it holds
- **Notice text.** The constant in `packages/domain/src/readiness.ts:4-5` matches the D175 wording character for character. It is exported through `packages/domain/src/index.ts:31` and contains no paths or executable output.
- **Shown only when Codex is Ready.** The row is added only when the Codex check succeeds (`apps/api/src/preflight.ts:238-241`). The Codex adapter only reports success together with `state:'ready'` (`adapter-codex/src/cli.ts:235`).
- **Placement.** The row is pushed straight after `harness.codex`, inside the same try block, with nothing awaited in between, so it always sits next to the Codex row. A thrown check goes to the catch branch and gets no row.
- **Separate from readiness.** The row has no `state` field (test at `preflight.test.ts:207-212` checks the exact four fields), so it can't be mistaken for harness readiness.
- **No extra work.** It adds no subprocess, inventory, config, app-server or provider call. The tests confirm one Codex check, each data source read once, and no session started or resumed (`preflight.test.ts:190-218`). Over HTTP the probe count stays at 2 then 4 (`:698-742`). Independent QA saw only the existing four no-turn CLI commands.
- **Exit status and counts.** `report.ok` (`preflight.ts:451`) and the exit code (`:703`) are unchanged. The warning count goes up by exactly one; tests pin "0 failed, 1 warning(s)" (`:501`) and "2 warning(s)" (`:440`).
- **Failures get no notice.** Each of the six failure states has a test showing no row and an unchanged failure (`:220-239`). The same holds for the CLI sign-in failure with exit 1 (`:512-515`), the HTTP auth failure (`:718-738`), and a Claude-only or empty harness setup (`:241-249`).
- **`/harness/preflight` unchanged.** Its responses are checked for exact equality (`:705-707`, `:725-727`).
- **No contract change.** The check `id` is a plain string in both the schema and `openapi.json`. The route summary is unchanged, so no regenerated docs are needed. No stored format, migration or reset change.
- **Nothing else breaks on the new row.**
  - The install scripts only look at the exit code (`install.sh:68,96`, `install.ps1:89-90,119`).
  - The perf readiness script uses absent executables and doesn't parse the output (`measure.mjs:354-387`).
  - The web, MCP and plugin apps don't call `/system/preflight`.
  - Other API tests look checks up by id or use partial matching (`preflight-ollama.test.ts:121-127,155-159`, `model-readiness.test.ts:333-337`, `readiness-evidence.test.ts:116-121`). The only exact list is updated (`preflight.test.ts:177-186`).
- **The commands in the notice are real.** Discovery shows both list commands exist in CLI 0.160.0. In the missing-asset case `plugin list` shows the plugin installed and enabled while `mcp list` is `[]`, and an unknown plugin ID is simply left out (discovery `REPORT.md:38-43,69-74,191-204`). So "neither proves every enabled plugin loaded" is accurate. The docs make no claim that the CLI as a whole can't diagnose plugins.
- **The pre-change control is meaningful.** `original-no-warning-control.log` shows the positive test failing with `undefined` on the old code. The negative tests pass before and after by design; they guard against the row being shown too widely.
- **Scope.** No plugin repair, policy change or #448 catalog change is in the diff.

## Introduced findings (non-blocking, optional)
1. **Install guide is slightly out of date** (`docs/guide/01-install-and-first-run.md:261,267`). It lists the checks and defines WARN as "works, or is set up on first start". The new `Codex plugins` warning never clears and fits neither description. `docs/11:157` and `preflight.ts:41` were updated; this guide wasn't. It isn't blocking because the guide already left out other warnings (e.g. Jev with no key), and the row explains itself. Suggested fix: mention the row and link to guide 07.
2. **Guide 02 points at #442** (`docs/guide/02-build-a-loop.md:86`). "Diagnostics are tracked in #442" is still true while the issue is open. Once it closes, linking `07-troubleshooting.md#codex-plugin-tools-are-missing` would be clearer.
3. **"Effective configuration" overstates what the CLI shows** (`docs/guide/07-troubleshooting.md:284-286`). Running `codex mcp list --json` directly shows the CLI's own settings for that folder. A GraphGoblin turn disables standalone MCP servers by name unless a node turns them back on (`docs/06:508`, guide 02:88), and applies node overrides. "Neither proves" and "verify in the worker" keep the text from being false. An optional clause would make it precise. The guide also doesn't say how to find the SDK's bundled CLI.
4. **Small test gaps, correct by reading the code.** There is no test for:
   - a Codex check that throws (catch branch at `preflight.ts:242-246`);
   - an Ollama-only setup where Codex is Ready (the row appears, matching the docs);
   - row order with several harnesses.

## Conditions to carry forward (not backend defects)
- **Docs already describe UI that doesn't exist yet at `5b0d806`.** `CHANGELOG.md:7-9`, `docs/06:510`, `docs/11:175-176` and guide 07 lines 277-282 say the Settings Codex card shows the notice and that **Retry preflight** exists. These are only true once the integrated UI lands. The UI reviewer should check it renders this exact constant, on Ready Codex only, without changing Ready, Authenticated, icon or severity. If the UI is dropped or its wording changes, those lines must be amended.
- **A healthy install now always shows one warning.** "0 failed, 1 warning(s)" is now the healthy result. D175 chose this and the CHANGELOG states it; it's worth flagging at owner QA.

## Pre-existing (separate, optional)
- `preflight.test.ts:505-511` uses `state:'unknown'` together with `authenticated:false`. That contradicts the contract comment at `contracts/src/harness.ts:36`, which says `authenticated` is absent when login couldn't be checked. It's test-only and not introduced here.

## Still open
Integrated UI review and browser QA, full coverage (nobody has claimed it), current-head and current-target CI, the final Astra audit, and #439 and owner acceptance.