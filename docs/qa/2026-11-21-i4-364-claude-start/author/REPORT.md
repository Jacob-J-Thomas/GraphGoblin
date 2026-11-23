# #364 author report — truthful Claude process-start diagnostics

Worker: Claude Code Opus 5.5 (xhigh), intent 4 unit U4.5. Checkout
`G:/ggq/gg-i4-364-claude-start/GraphGoblin`, branch `codex/gg-i4-364-claude-start`, base
`02351e2fb932b3be44e7cc3fb3943a61d568226c`. Uncommitted, unstaged, unpushed; no issue touched.
Evidence: `evidence/` (logs, probe JSON, mutation logs, `candidate.diff`), scripts: `scripts/`.

## Status

Bounded candidate complete. All focused checks pass. Package-wide infrastructure coverage could not
be evaluated on this host: 50 pre-existing symlink tests fail with `EPERM` (environment, below).
No engine/contract/other-package change was needed.

## Proven defect (native, before the change)

Windows 11 + Node 22.23.4, harmless `node.exe`, disposable paths (`evidence/native-spawn-probe.json`):

| Case                                              | Spawn result                                   |
| ------------------------------------------------- | ---------------------------------------------- |
| valid binary, valid cwd; 240/258-char cwd         | starts (child cwd length 240/258)              |
| missing cwd, cwd below missing parent             | `ENOENT`, `error.path` = binary                |
| cwd is a file, cwd below a file                   | `ENOENT`, `error.path` = binary                |
| existing cwd of 259 chars                         | `ENOENT`                                       |
| existing cwd of 260 / 300 chars                   | `ENOENT` + stdout/stderr `read ENOTCONN`       |
| missing absolute binary, missing bare name        | `ENOENT`                                       |
| binary path is a folder                           | `ENOENT`                                       |

So `ENOENT` (and `error.path`) cannot identify the failing operand. Probe attempt 1 had no stream
error handlers and the plain Node process died on the unhandled `read ENOTCONN`
(`evidence/native-spawn-probe-attempt1-crash.stderr.txt`, exit 1).

Unmodified source through the real runner/harness (`evidence/baseline-unmodified-verbose.log`):
- long-TEMP preflight (check folder 259/300) → `cli-missing`, "Claude CLI was not found at the
  configured path. Install the Claude CLI or set GG_CLAUDE_BINARY…" although the binary exists;
- turn in a 300-char workspace → `HARNESS_NOT_INSTALLED` "The installed Claude executable could
  not be started…";
- 8 uncaught `read ENOTCONN` exceptions from `runClaudeProcess` (cwd ≥ 260). `apps/api` has no
  `uncaughtException` handler (grep), so this would end the API process — inferred, the built API
  was not run.

## Change (only `packages/infrastructure/src/claude/` + docs)

`process.ts` (runner, privacy boundary kept — closed codes only):
- `spawnCode` only for an **actual** refusal (`child.pid === undefined`). A later child `error` of
  a started process (e.g. failed kill) no longer becomes `spawnCode: UNKNOWN` →
  `definitely-not-submitted` (controlled evidence only).
- After a refusal, one read-only `stat` observation → closed `startRefusal`:
  `executable-missing` only for `ENOENT` + fully qualified binary (`isAbsolute` and
  `resolve === normalize`) whose path, `.com` and `.exe` forms (libuv's Windows candidates; POSIX:
  path only) are all ENOENT/ENOTDIR or folders; `working-directory-missing` (ENOENT/ENOTDIR) or
  `working-directory-not-directory`. Any other read error → `unknown` (no cause). Existing folder
  → no cause. No PATH resolution, no subprocess probe, no fallback.
- Abort/deadline during the observation: settle immediately with the refusal, no cause, no
  `timedOut`, no kill timer. `close` after a refusal is ignored (refusal path settles once).
- stdout/stderr/stdin `error` of a never-started child ignored (fixes the ENOTCONN crash); a
  started child's stdout/stderr failure → `outputFailed`, tree killed.

`harness.ts` (fixed text, no paths):

| Established                    | Preflight                                                        | Turn                                                                                          |
| ------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| executable missing             | `cli-missing` (text unchanged)                                   | `HARNESS_NOT_INSTALLED` (restorable)                                                          |
| turn cwd missing / not folder  | —                                                                | `HARNESS_INVALID_CONFIGURATION` "…working directory does not exist / is not a folder…" (pinned) |
| check folder missing / file    | `unknown` "…temporary check folder does not exist / is not a folder." | `HARNESS_TURN_FAILED` (never configuration)                                              |
| nothing, resolved cwd > 258    | `unknown` "…check folder, whose path (from TEMP or TMP) is longer than the 258 characters Windows allows…" | `HARNESS_TURN_FAILED` "…working directory path is longer than the 258 characters Windows allows" |
| nothing                        | `unknown` "Claude CLI could not be started (ENOENT)."             | `HARNESS_TURN_FAILED` "Claude could not be started (ENOENT); check the Claude executable's path and permissions and the working directory" |

All refusals keep `definitely-not-submitted`; precedence unchanged (termination-unconfirmed >
abort > refusal > timeout/overflow …). `outputFailed` added to the turn's transport-cutoff
precedence block (ahead of stderr refusals, since lost stdout can hide acceptance) and to probe
outcomes ("Claude CLI check output could not be read.").

Docs: `docs/06-harness-integration.md` (start-refusal paragraph + table, Windows paragraph link),
`docs/guide/07-troubleshooting.md` (row rewritten to new wording, new turn row, `unknown` row;
column widths kept), `CHANGELOG.md` (Unreleased entry, no upgrade action). Fixture `turn-cli.mjs`
gains a `success` scenario returning the child's actual cwd.

## Tests added/changed

- `start-refusal.test.ts` (new, native, real runner + `node.exe` fake CLI, canary
  `PRIVATE_CANARY_364` in paths/TEMP/prompt): ordinary success in requested cwd; missing cwd →
  INVALID_CONFIGURATION, cwd passed as-is; cwd is a file (win32); existing 258 (starts, finalText ==
  cwd) / 259 / 260 / 300 (TURN_FAILED long text, no unhandled error) (win32); long-TEMP preflight
  258 ready / 259 / 300 unknown + check folder removed (win32); absolute missing binary → preflight
  `cli-missing` exact text, turn NOT_INSTALLED, no turn spawned; binary path is a folder →
  `cli-missing` (win32); bare missing name → `unknown`; engine-backed run failures: missing cwd →
  `HARNESS_TURN_FAILED`, `adapterCode: HARNESS_INVALID_CONFIGURATION`, `resumable: false`,
  `definitely-not-submitted`; missing binary → `HARNESS_NOT_INSTALLED`, `resumable: true`.
  Privacy: no canary, root path, `spawn `, `errno`, `syscall` in events/errors/preflight/failure.
- `process-failure.test.ts` (controlled, mocked spawn + `stat`): candidate rule, file/EACCES/
  unclassified binary reads leave cause open, cwd missing/ENOTDIR/file/folder/EACCES/EPERM, bare &
  relative names never stat'ed, EACCES never claims absence, abort/deadline during observation,
  pipe faults + close after refusal, failed-kill error after start, stdout/stderr failure of a
  started child. Mocked child now carries a pid (it models a started process).
- `harness.test.ts`: every turn/probe mapping with exact text, cwd passed unchanged, cancellation
  ahead of diagnosis, output failure ahead of refusal, long check folder wording, unreadable check
  output; the existing "missing executable" case now carries `executable-missing` and a new
  "unexplained start refusal" case asserts `unknown`/`HARNESS_TURN_FAILED`.
- `process.test.ts`: existing native missing-executable test asserts `executable-missing`.

Negative controls (`evidence/mutations/`, each restored byte-identically, SHA-256 checked):
M1 drop stdio error handlers → 8 unhandled errors, exit 1; M2 ENOENT ⇒ executable-missing → 18
failures; M3 no started-guard → 1; M4 literal name only → 4; M5 abort waits for observation → 2;
M6 uncertain read ⇒ missing → 4; M7 check folder as configuration → 2; M8 output failure below
refusal → 2.

## Checks (project Node v22.23.4 verified first; `pnpm.cmd` in PowerShell)

| Command                                                                  | Result |
| ------------------------------------------------------------------------ | ------ |
| `pnpm install --frozen-lockfile`                                         | 0 (no lockfile change) |
| existing `src/claude` tests after production change, before test updates | 2 expected failures (ENOENT⇒cli-missing case; mocked child w/o pid) — `existing-tests-after-prod-change.log` |
| `process-failure.test.ts` first run                                      | 1 failure: my table captured `Stats` before `beforeAll`; fixed with runtime tokens |
| `pnpm run typecheck` (infrastructure)                                    | 0 |
| `pnpm run lint` (infrastructure)                                         | 0 |
| `prettier --check` changed files/docs                                    | 0 (after `--write` on my files; bases were clean) |
| `vitest run src/claude --coverage` (include `src/claude/**`, disposable home) | 259 passed, 2 skipped; 99.24 st / 98.15 br / 100 fn / 99.82 ln; exit 0 |
| `pnpm run test:coverage` (whole infrastructure, disposable home)         | exit 1: 50 `fs.symlink` EPERM (chat-audio 4, voice 46) + 1 `EBUSY` WAL unlink (sqlite/chat); all claude tests passed; coverage not reported on failure |
| same 3 failing files without home redirect                               | 50 EPERM again (host has no `SeCreateSymbolicLinkPrivilege`, Developer Mode unset); sqlite/chat passed (EBUSY not reproduced) |
| `pnpm run check:layers` / `check:deps`                                   | OK / 0 errors (4 pre-existing orphan warnings) |

Not run (per brief): full monorepo build/coverage, browser suite, `apps/api` tests (need an API
build; no API test uses `spawnCode` or the changed texts — grep). No paid/provider/network call.
The two existing tests that run the owner's installed `claude.exe` were skipped by pointing
`USERPROFILE`/`HOME` at an empty disposable folder (removed after; stayed empty), to avoid reading
the owner's real Claude auth/config.

## Remaining limits

- The 258-character wording is a length fact against the documented limit, not proof of cause;
  stat success never proves startability. Windows-specific native cases skip on other platforms;
  this run did not execute Linux CI.
- An executable named without a full path (PATH lookup) that fails to start is now `unknown`, not
  `cli-missing` (no resolver by contract).
- Observation races: a path changed between refusal and `stat` is reported as observed; uncertain
  reads report no cause.
- Synchronous spawn throws (Node throws for codes other than EACCES/EAGAIN/EMFILE/ENFILE/ENOENT,
  e.g. POSIX `ENOTDIR`) still reject the runner → generic `Claude turn failed`, delivery
  uncertain (conservative; unchanged; no Windows case observed).

## Decisions for root's catalogue (proposed, not blockers)

1. Unexplained refusal → `HARNESS_TURN_FAILED`, `retriable: false` (non-resumable for Claude, like
   existing EACCES/UNKNOWN). Previously ENOENT was `HARNESS_NOT_INSTALLED` (resumable) on a false
   claim. Alternative declined: `retriable: true` to keep resumability — would stretch
   "retriable" to a non-transient start failure.
2. Turn cwd missing/not a folder → `HARNESS_INVALID_CONFIGURATION` (pinned, non-resumable;
   engine shows `HARNESS_TURN_FAILED` + `adapterCode`). Alternative: generic `HARNESS_TURN_FAILED`
   (same resumability, less specific). Contract `WORKING_DIRECTORY_MISSING` exists but is unused;
   using it needs an engine mapping change (out of scope).
3. Included two fixes on the same start path beyond wording: unhandled ENOTCONN (natively proven)
   and the started-child error guard (controlled evidence only).

## Out-of-scope observations for root (not changed)

- Codex maps any `enoent` to `HARNESS_NOT_INSTALLED` (`packages/adapter-codex/src/events.ts:354`,
  `isolation.ts:177`) — same misdiagnosis class.
- `packages/infrastructure/src/process/scripts.ts` and `packages/adapter-codex/src/cli.ts` attach
  no stdout/stderr `error` handlers; the same uncaught ENOTCONN for a ≥260-char cwd is plausible
  but was not exercised.
- Host: symlink tests need Developer Mode or the symlink privilege; one transient SQLite `EBUSY`.
