# #442 backend author evidence

Implementation context `/root/i4_448_preflight`, GPT-6.1 Sol xhigh. This is author verification,
not independent QA/review or owner acceptance. No staging or commit is authorized until root
integrates the separate actual Claude UI work.

## Admission and source binding

- Worktree: `G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin`, branch
  `codex/gg-i4-442-plugin-diagnostics`, initial clean base
  `02351e2fb932b3be44e7cc3fb3943a61d568226c`.
- Parent-selected D175 read and SHA-256 verified:
  `5fca75cc1328fc5e7461fc0d1a3efe193446c33945279a510b54e5236e65e140`.
  This is delegated coordinator selection, not human plan approval or acceptance.
- Read the existing AGENTS/docs and sealed discovery plan/report. The discovery packet is
  unchanged: PLAN.md SHA C67EB744B189E136713C959D49C97364A361A9EE489578E821E1A9E80C6833BC;
  REPORT.md SHA E2196B5EE98A55CF9F09738417F1CCA2F245B87487615425DCDB87008A9505BD.
- Commands prepend project Node v22.23.4 and use pnpm.cmd. Dependencies were already installed
  offline/frozen for discovery; lock remains unchanged. No further install/build/native provider
  or app-server discovery was performed for this implementation.

## Owned change

`packages/domain/src/readiness.ts` exports fixed `CODEX_PLUGIN_OBSERVABILITY_NOTICE` through the
existing public index. Its exact coordinator-selected text is shared with the actual Claude UI
worker; it makes a claim about this check's scope, never universal CLI inability or plugin failure.

`apps/api/src/preflight.ts` adds `plugins.codex` / `Codex plugins` / `warn` immediately after a
successful Codex check in system preflight. CLI/login readiness, authentication, warning-only
exit 0 and existing refusals remain. It performs no new inventory/config/app-server/provider
probe. No harness implementation, inheritance, node override, SDK or persistence code changed.

`apps/api/src/preflight.test.ts` extends the existing focused suite with the informational result,
six failed states, absent/other harness controls, probe/fact call counts and no start/resume,
CLI first-run/ready/auth output and real HTTP handler responses preserving readiness/auth fields.
Expected warning counts include the intentional new fixed warning.

Numbered docs 06/11, troubleshooting and CHANGELOG describe the scope and inventory limitations.
CHANGELOG tells output parsers to allow the additional row/count; no schema/format/reset change.

Actual Claude exclusively owns web PreflightSection/component/Settings tests. The backend author
does not edit, format, stage or commit any web file. Domain/API ownership has been signalled to
root, with the shared export available before UI implementation.

## Original failing control

Before adding the API warning, after introducing the new test and shared constant:

`pnpm.cmd --filter @graphgoblin/api exec vitest run src/preflight.test.ts -t 'reports plugin observability separately'`

Expected negative result: 1 failed / 40 skipped, exit 1. The report's `plugins.codex` check was
undefined. Exact terminal is `original-no-warning-control.log`. This proves the new positive
regression discriminates the old behavior. Source was then changed, without weakening the test.

The earlier discovery failures are preserved, not overwritten: two plugin-enabled attempts ended
termination-unconfirmed; Git environment controls and remote_plugin=false did not prevent curated
fetching; a healthy CLI-only turn exposed an invalid injected `close` observer assertion because
the SDK removes listeners. The sealed discovery packet distinguishes those from the two passing
plugins-off controls and twelve passing distinct continuation cases, with native/process limits.
None of those earlier failed attempts is relabelled as passing implementation evidence.

## Focused verification

| Command after pnpm.cmd | Result | Evidence |
| --- | --- | --- |
| `--filter @graphgoblin/api exec vitest run src/preflight.test.ts src/preflight-ollama.test.ts` | PASS: 2 files / 59 tests, 12.06 s | focused-preflight-01.log |
| `--filter @graphgoblin/domain exec vitest run src/readiness.test.ts` | PASS: 1 file / 22 tests | focused-domain-01.log |
| `--filter @graphgoblin/api typecheck` | PASS | api-typecheck.log |
| `--filter @graphgoblin/domain typecheck` | PASS after the API compiler finished | domain-typecheck.log |
| `--filter @graphgoblin/api lint` | PASS | api-lint.log |
| `--filter @graphgoblin/domain lint` | PASS | domain-lint.log |
| `exec prettier --check <seven backend-owned files>` | PASS | tool transcript |
| `git diff --check` | PASS | tool transcript |

The new condition is exercised for successful Codex, unsuccessful Codex, and another ready
harness. Public CLI-handler tests establish warning-only exit 0 and retained authentication
failure exit 1; HTTP injection executes the real registered routes over controlled fakes.
The unchanged /harness/preflight response keeps its exact ready/auth objects and one probe per
operation. These are public method/component evidence, not a built/native gateway session.

No thresholds, coverage exclusions, test timeouts, casts or runtime policies were changed.
Quantitative package coverage, built public/native/browser QA, opposite-family review,
exact-head/current-target CI and final audit remain coordinator-owned serialized gates.

## Safety and integration boundaries

Only disposable test stores/directories and controlled fake harnesses were used. No owner store,
configuration, credentials, service, ports 4747/4748, personal plugin installation or paid provider
was used. No new app-server attempt ran. No issue write/closure, push, deployment or publication.
#439 and owner acceptance obligations remain separate.

The current source is unstaged. Root must integrate actual Claude's UI work and authorize the
index/commit action; this report does not claim those gates complete.

## Backend handoff

The seven backend-owned files are frozen for root inspection, with `backend.diff` and
`backend-source-binding.json` preserving the exact source delta and per-file SHA-256. The base
commit is unchanged; no backend commit exists. `artifact-sha256.json` binds the author packet.
Shared discovery PLAN.md/REPORT.md hashes were reverified unchanged after implementation.

No unexpected test/lint/typecheck failure occurred in this backend implementation phase. The
single original-no-warning failure is the deliberate pre-change regression control above.
Full coverage/build/browser gates were not started while #448 QA held the heavy-work slot.
