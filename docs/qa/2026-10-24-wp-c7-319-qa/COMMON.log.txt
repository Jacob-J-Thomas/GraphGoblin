# Common brief for the 2026-10-18 GraphGoblin batch (intents I01 to I07)

Every work-package brief in this folder starts by pointing you here. Read this file completely, then the package brief, then the orientation material in the order the brief lists. You are one worker among several running at the same time in separate git worktrees of the same repository.

## 1. Orientation (read in this order)

1. `AGENTS.md` at the worktree root. Its rules are binding.
2. `docs/README.md`, then `docs/15-issue-workflow.md`.
3. `docs/architecture/README.md`: the structural map of the code (packages, data, storage, API, web, adapters, triggers, one traced loop).
4. The roadmap decision ledger: `%USERPROFILE%\.claude\codex-runs\GraphGoblin\briefs\i01-i07\issues\278.md`, sections "Owner decision ledger", "Shared completion standard" and "Engineering parameters". The owner's latest explicit decisions govern; historical comments are evidence, not a competing specification.
5. The issue bodies your brief names, in `%USERPROFILE%\.claude\codex-runs\GraphGoblin\briefs\i01-i07\issues\<number>.md` (bolt, its UoW parent, and its intent). The "Acceptance criteria", "Verification", "Scope limits" and "Specific owner feedback" sections are the requirements. "Evidence provenance" links describe an older baseline (`c379f80`): reproduce on the current code before relying on them.
6. The numbered docs and source files the brief lists.

## 2. Hard rules (from AGENTS.md and the owner)

- **Coverage:** every package stays above 90% lines and 90% branches. `pnpm test:coverage` fails otherwise. Never lower a threshold or add an exclusion beyond generated code. Keep denominators truthful.
- **Types:** `pnpm typecheck` type-checks test files and fixtures too. Fix types; do not cast to `any`, do not add `@ts-expect-error` to hide a real problem.
- **Imports:** relative imports use explicit `.js` extensions (NodeNext). Reach other packages only through their `@graphgoblin/*` entry points. Zod 4: `.prefault({})` for object defaults whose fields have defaults.
- **Dependencies:** permissive licences only (MIT, Apache-2.0, BSD, ISC); `pnpm check:licenses` enforces `tooling/license-allowlist.json`; every new dependency gets a line in `docs/research/licenses.md`. Prefer no new dependency.
- **Docs in sync:** a behaviour change updates the relevant numbered doc under `docs/`; a decision change adds an ADR under `docs/decisions/` (next free number); a node-schema or route change requires `pnpm docs:generate` and the regenerated `docs/reference/*` committed; every user-visible or contract change gets a bullet under `## Unreleased` in `CHANGELOG.md` ending with the issue number in parentheses, for example `(#263)`. Upgrade notes for the owner's instance go in that bullet as **Upgrade:**.
- **Clean design over backward compatibility (ADR-0020):** no compatibility schemas, deprecated input paths, tolerant parsing of old data shapes, or dual code paths. Change the contract to its clean shape. When stored data must change, the owner resets by hand; say so in the CHANGELOG upgrade note.
- **Test quality (owner decision, #278 "Test quality"):** test through supported public or component interfaces. Private-method access, reflection, invasive casts, monkey-patching the component under test, and test-only production exports are defects, not tests. Legitimate dependency injection through public constructors or ports, fake clocks, malformed external inputs, and real storage/process/network fault injection are valid. A regression test must demonstrably fail on the current code before your fix and pass after it; say so in the report. No retry-to-green: a test that passes only on retry is a failure to resolve. Do not rerun whole suites repeatedly without a new reason.
- **Evidence first:** for a bolt marked "Evidence-dependent admission" or any human-reported defect, reproduce or measure on the current code before writing a corrective change. If you cannot reproduce, preserve the report, write down exactly what you tested and stop at a documented negative result. Do not manufacture a change to satisfy an old report, and never call the report disproven.
- **Native and live claims:** process shutdown, restart, signal and subprocess behaviour require disposable real-process evidence (spawn the built app or a script in a temp data directory), not invocations of captured callbacks. Fake-harness results never establish live-provider behaviour. Live provider turns are out of scope for Codex workers unless the brief says otherwise.
- **Engineering parameters:** unsettled numbers (grace periods, retry counts, byte bounds, thresholds) are yours to choose and justify in code comments and docs. Never describe one as owner-approved.
- **Owner environment:** never touch the owner's running app on ports 4747/4748, its store under the user's home (`~/.graphgoblin` or any `GG_DATA_DIR` outside your worktree), or the main checkout at `%USERPROFILE%\source\repos\GraphGoblin` outside your own worktree. Use disposable data directories inside your worktree or the system temp directory, and alternate ports (the e2e server and the API tests pick free ports; for manual runs use 5600 to 5699). Never upgrade or reconfigure the owner's runtime, Node, pnpm, Codex or Claude installation.
- **Scope:** implement only the bolts in your brief. Something outside scope that looks wrong goes into your report under "Observed outside scope", with file and line; do not fix it.
- **Git and attribution:** commits carry no assistant attribution of any kind (no Co-Authored-By, no "Generated with", no model names). Never push. Never merge, rebase, stash or switch branches. Codex workers do not commit at all (the sandbox keeps `.git` read-only); leave changes in the worktree and the orchestrator commits after review. Claude workers commit on their worktree branch with clear messages that name the issue, for example `Pin draft run definitions at start (#247)`.
- **Codex sandbox specifics:** work only in the current worktree and branch; never create symbolic links or junctions to any directory outside the worktree; if dependencies are missing, stop and report instead of linking another checkout's `node_modules`; do not try to delete directories (report `coverage/` or report folders for the orchestrator to remove); work alone in your thread (no sub-agents); in Windows PowerShell call `pnpm.cmd`, in Git Bash call `pnpm`.
- **GitHub:** workers never post comments, edit issues, open PRs or change labels. The orchestrator does. Everything you want recorded goes into your report.

## 3. Environment

- Windows 11, PowerShell is the default shell; Git Bash is available. The default `node` is v23.10.0. The supported gate runtime is Node 22 at `%USERPROFILE%\AppData\Roaming\nvm\v22.14.0\node.exe` (dependency-cruiser refuses Node 23). Run every gate with Node 22 first on PATH:
  - PowerShell: `$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"` then `pnpm.cmd ...`
  - Git Bash: `export PATH="$APPDATA/nvm/v22.14.0:$PATH"` then `pnpm ...`
- Tests, lint and typecheck need no prior build (the `development` export condition resolves TypeScript source). Node at runtime loads `dist/`, so `pnpm build` before starting an app or the browser suite.
- Browser suite: `pnpm build`, then from `apps/web`: `pnpm exec playwright test` (Microsoft Edge channel by default on Windows; no browser download). Run a single spec with `pnpm exec playwright test e2e/<name>.spec.ts`. The suite takes 10 to 15 minutes; run only the specs relevant to your change unless the brief says otherwise. Six tests in `claude-harness.spec.ts`, `model-picker.spec.ts` and related model-picker flows are known to fail on current main (tracked under #205/#241); do not fix them unless your brief owns them, and list them separately in your report.
- Turbo caches `typecheck`, `lint` and `test:coverage` results. Because `test:coverage` has no dependency inputs (#127), a cache hit can hide a regression in a dependency. When you need certainty for a package, run `pnpm exec turbo run test:coverage --force --filter=@graphgoblin/<name>` or `pnpm --filter @graphgoblin/<name> test:coverage` directly.
- Other workers are editing the repository at the same time. `WAVE.md` in this folder lists who owns which files right now. Keep edits to files owned by another package small and additive, and name every such edit in your report.

## 4. Gates before you report

Run with Node 22 on PATH, from the worktree root:

```
pnpm typecheck
pnpm lint
pnpm format:check          # fix with: pnpm format
pnpm check:layers
pnpm check:deps
pnpm --filter @graphgoblin/<each changed package> test:coverage
pnpm check:docs            # only if a node schema or route changed; regenerate with pnpm docs:generate
pnpm check:licenses        # only if dependencies changed
pnpm check:tokens          # only if apps/web source changed
```

Then the browser specs relevant to any `apps/web` change (after `pnpm build`). Report every gate with its exact command and result. A gate you could not run is reported as not run, with the reason.

## 5. Report shape (end your run with exactly these sections)

1. **Branch and worktree:** branch name, worktree path, base commit, and either the commit list (Claude workers) or "uncommitted; ready for orchestrator commit" (Codex workers).
2. **Per bolt:** for each issue number, each acceptance criterion with the evidence that satisfies it (test name and file, command output, or measurement), or "unresolved" with the reason. Research bolts end with a clearly labelled "confirmed", "not reproduced" or "measured" result.
3. **Files changed:** grouped by package; every edit to a file owned by another package in `WAVE.md` called out.
4. **Tests:** names of new or changed tests; which regression tests failed before the fix (quote the failure); coverage summary for each changed package.
5. **Gates:** each command and its result.
6. **Docs:** numbered docs, ADRs, CHANGELOG lines and generated references updated.
7. **Decisions and parameters:** every engineering choice with its justification.
8. **Caveats and open items:** what is left undone, what needs the orchestrator or the owner, anything observed outside scope.
