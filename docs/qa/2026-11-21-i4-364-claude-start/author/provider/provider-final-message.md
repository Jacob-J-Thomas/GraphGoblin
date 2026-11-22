The #364 fix is ready for your review, uncommitted on `codex/gg-i4-364-claude-start` (base `02351e2f`, nothing staged, no engine/contract/other-package changes needed). Claude no longer says the CLI is missing when Windows actually refused the working directory. All focused checks pass. The package-wide infrastructure coverage run fails on this machine because 50 existing symlink tests can't create symlinks here (details below).

## What was wrong (reproduced natively)
On Windows 11 with Node 22.23.4, starting a real executable in any of these working directories fails with the same `ENOENT` as a missing executable, and Node blames the executable:
- a directory that doesn't exist;
- a path that is a file;
- an existing directory of 259 or more characters (258 still starts).

From 260 characters the stdout/stderr pipes also throw `read ENOTCONN`. Nothing handled it, so my first plain-Node probe died with exit 1. On the unchanged code:
- **Long TEMP:** preflight reported `cli-missing` ("Claude CLI was not found…") even though the binary was present.
- **Turn in a 300-character workspace:** reported `HARNESS_NOT_INSTALLED`.
- **Crash risk:** 8 uncaught `ENOTCONN` exceptions fired, and `apps/api` has no handler for those. That this would stop the API is my inference; I didn't run the built API.

## What changed (`packages/infrastructure/src/claude/` plus docs)
- **`process.ts` (the runner):** a start counts as refused only when Node created no process. A later error from a running CLI, such as a failed kill, is no longer misread as "nothing was submitted" (proven only with mocked tests). After a refusal the runner checks the filesystem once, read-only, and returns a fixed label rather than any error text:
  - **Executable missing:** only when the configured path is a full path and that path and its `.com` and `.exe` forms are all absent or folders. No PATH search, no extra process, no fallback.
  - **Working directory** missing or not a folder.
  - **Otherwise no cause:** an existing folder proves nothing, and any other read error means "unknown".
- **Interruptions and pipes:** a cancel or deadline during that check reports the refusal straight away, with no cause and no timeout. Pipe errors from a never-started process are ignored, which removes the crash. If a running CLI's output pipe fails, the CLI is stopped and the turn is "delivery uncertain", ahead of any stderr refusal, because lost output could hide that the prompt was accepted.
- **`harness.ts` (fixed messages, no paths):**
  - Proven missing executable: `cli-missing` / `HARNESS_NOT_INSTALLED`, as before.
  - A turn's working directory missing or not a folder: `HARNESS_INVALID_CONFIGURATION`.
  - The temporary check folder missing or not a folder: `HARNESS_TURN_FAILED`, never treated as configuration.
  - No cause established: `unknown` in preflight or `HARNESS_TURN_FAILED` for a turn. The message states the path is over 258 characters when it is, otherwise names both the executable and the working directory.
  - Every refusal stays `definitely-not-submitted`, and the working directory is used exactly as given.
- **Docs:** doc 06 (new start-refusal paragraph and table), the troubleshooting guide (rows rewritten, column widths kept), and the CHANGELOG. The fake CLI fixture gained a `success` scenario.

## Tests and checks
- **New native tests (`start-refusal.test.ts`):** cover every case the brief listed, through `ClaudeHarness` and the real runner with a fake CLI. That includes 258/259/260/300-character working directories and long-TEMP preflight, plus two run-through-the-engine checks:
  - missing working directory → `HARNESS_TURN_FAILED`, `adapterCode: HARNESS_INVALID_CONFIGURATION`, not resumable;
  - missing executable → `HARNESS_NOT_INSTALLED`, resumable.

  Every case asserts that no planted test path appears in any message.
- **Mocked tests:** cover the path rules, uncertain reads, cancel/deadline during the check, and each message variant.
- **Mutation checks:** I broke the code 8 different ways; the tests caught every one, and each file was restored byte-identical.
- **Results:** frozen install, typecheck, lint, Prettier, `check:layers` and `check:deps` all pass. Claude folder: 259 passed, 2 skipped, coverage 99.24% statements / 98.15% branches / 100% functions / 99.82% lines.
- **Two pre-existing tests skipped on purpose:** they run your installed `claude.exe`. I pointed `USERPROFILE`/`HOME` at an empty throwaway folder so they skipped rather than reading your real Claude login.
- **Package-wide run:** exit 1. 50 symlink tests in `src/fs/chat-audio` and `src/process/voice` fail with `EPERM` because this machine lacks the symlink privilege and Developer Mode. They fail the same way without my folder redirect. One SQLite `EBUSY` happened once and didn't recur. All Claude tests passed in that run, but vitest printed no package coverage because of the failures.
- **Not run (per brief):** monorepo build or coverage, browser suite, `apps/api` tests. No API test uses the changed fields or messages.

## Remaining limits
- The 258-character message reports the path's length against the Windows limit; it isn't proof of the cause.
- A `GG_CLAUDE_BINARY` given as a bare name that fails to start now shows "unknown" rather than "CLI not found", because looking it up on PATH was ruled out.
- Windows-only native tests skip elsewhere, and I didn't run on Linux CI.
- For spawn errors Node throws immediately (only seen on POSIX), the runner still rejects and the turn gets the generic "Claude turn failed" (delivery uncertain). That's conservative and unchanged.

## Decisions for you
1. **Unexplained refusals are not resumable** (`HARNESS_TURN_FAILED`, not retriable), like the existing `EACCES` path. Before, `ENOENT` was resumable only because it was wrongly labelled "not installed". Marking it retriable would keep resumability but stretch what "retriable" means.
2. **A bad turn working directory is `HARNESS_INVALID_CONFIGURATION`** (pinned, not resumable). The plain `HARNESS_TURN_FAILED` alternative has the same resumability but is less specific. The unused `WORKING_DIRECTORY_MISSING` code would need an engine change.
3. **I included two fixes beyond the wording** on the same start path: the `ENOTCONN` crash (proven natively) and the running-CLI error guard (proven only with mocked tests).

## Found but not changed (outside scope)
- The Codex adapter maps any `enoent` to `HARNESS_NOT_INSTALLED` (`adapter-codex/src/events.ts:354`, `isolation.ts:177`).
- `infrastructure/src/process/scripts.ts` and `adapter-codex/src/cli.ts` also lack stdout/stderr error handlers, so the same `ENOTCONN` crash is plausible for long working directories there. I didn't test it.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-364-author-01`; open `REPORT.md` first. `evidence/candidate.diff` has the full change and `evidence-manifest.json` hashes 32 files.