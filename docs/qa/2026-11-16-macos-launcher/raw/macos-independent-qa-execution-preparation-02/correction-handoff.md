# #456 macOS QA harness: execution preparation 02 correction handoff

Author: Claude Code `claude-opus-5-5` (xhigh), the independent behavior QA worker, on 2026-11-16. This is harness preparation. It is not a review, not a run and not a pass. **The native status is unexecuted.**

- **Source (immutable, not edited):** `../macos-independent-qa-execution-preparation-01/`
- **Output:** this directory.

## Method

1. I copied the four authored files from preparation 01 byte-for-byte with `cp -p`. Their SHA-256 values matched the source before any edit.
2. I patched only the corrections listed below. I made no hand regeneration of the driver.
3. `diff` against preparation 01 shows 68 changed driver lines, all inside the six areas below plus a one-line provenance comment in the header.
4. `binding.template.json` is unchanged: `final: false`, `boundBy: null`, `driverSha256: null`. Root binds the corrected successful build later.

## Deltas

### 1. `startContender` (S7 contender)

- **Driver:** the hand-built environment, which had no `GG_DB_URL`, `GG_WEB_DIST` or `GG_GOBLIN_DIST`, is replaced by `expectedEnv(ctx, ctx.ports.p2)`.
  - That is the clean gateway environment, with the exact byte-percent-encoded `GG_DB_URL` produced by `fileUri()`, which self-checks through `fileURLToPath`.
  - There is no `GG_MACOS_LAUNCHER_LOG_ADMISSION`.
  - Why: without `GG_DB_URL`, `apps/api/src/config.ts:146` falls back to an unescaped `file:` URI. For the `%41 #1` store that URI can name a different SQLite path.
- **case-map:** the C4 value and refs (adds `config.ts:146`) and the S7 `adds` are updated.
- **README:** the S7 row is updated.

### 2. S7 store-blocked diagnostic

- **Driver:** the note `launcherRecordAfterBudget` is replaced by:
  - the note `launcherRecord`;
  - `must launcher-record-no-spawn-failed-or-canary`: no new line contains `child=spawn-failed` or the canary token;
  - `must launcher-record-store-blocked`: not rotated, and the fresh lines in A's `launcher.log` are exactly `["stage=waiting-for-store outcome=store-blocked"]`.
- The format was confirmed read-only from the worktree's uncommitted product correction over 8bddb93a:
  - `NativeLaunchEngine.swift:193-270`: `writeFailureDiagnostic`, the record `stage=<s> outcome=<code>[ child=<c>]`, and the 250 ms tail after the attempt;
  - `Headless.swift:37`: cancelled is 40.
- The elapsed checks are unchanged: `want` 60–63 s and `must` ≤65 s. The band includes the ≤250 ms tail.
- **case-map:**
  - C6 value and refs;
  - S7 `adds` and `checks`;
  - `correctionsToPriorPlan[0]`.

  The claim "store-blocked writes none" is now marked as a historical 8bddb93a assumption.
- **README:** S7 row, §8 item 1, and the §9 band and soft-format bullets.

### 3. `~/Applications` absent before install

- **Driver:** a new `applicationsEntries(ctx, preinstall)` sits behind `matchingApps` and `stageResidue`. Both keep their call shape and gain an optional third or second argument.
  - When `~/Applications` exists, it must be a non-symlink directory owned by the user with no group or other write. This is the same rule as the product's `requireOwnedDirectory` (`Installation.swift:271-276`, `NativeFiles.swift:127-133`).
  - Only ENOENT, and only with `preinstall=true`, returns `[]`. Even then, home must pass the same ownership rule.
  - Every other error is raised.
  - The driver never creates `~/Applications`.
  - `preinstall=true` is used only in the admission name check and in the S0 stage-residue baseline. S0 runs before any install, and without it S0 would throw on a `readdir` ENOENT.
  - S1 and S3 call with the default `false`.
- **Admission:** an error is now an `admission-refused` problem (`~/Applications refused: …`, exit 2, no effects) instead of an uncaught internal error.
  - *Judgment call:* the ownership and mode rule now also applies to an existing `~/Applications`. A directory the installer would refuse is refused at admission rather than failing S1 after effects.
- `ownerSnapshot` and `dirSummary` already tolerated absence and are unchanged.
- **case-map:** S0 `adds`. **README:** §1 admission list, S0 row and §4 created list.

### 4. S3 case alias

- **Driver:** a failed install is no longer accepted for `case`. The old code ran `want(tag+':managed-update', tag === 'case')`, which passed on any case-variant failure.
- Both tags now run the same sequence:
  1. On refusal only, `note <tag>:refusal-left-installation-unchanged`, recorded before the hard stop.
  2. `must <tag>:managed-update` (clean exit 0).
  3. `want <tag>:installer-output`.
  4. `checkInstalled` (same ID; receipt name equals the original NFC bytes).
  5. `must <tag>:new-generation`.
  6. The existing `must` checks for single-bundle-original-spelling, no-new-stage-residue and gateway-undisturbed.
- The case-sensitive skip is preserved: the variant runs only when the upper-case spelling lstat-resolves to A's bundle identity.
- *Judgment call, for root:* in preparation 01, `nfd:managed-update` and `<tag>:new-generation` were `want`, so NFD failure was also only soft. To make "just like NFD" literal, both are now `must` for both tags.
- **case-map:** S3 `adds` and `checks`. **README:** S3 row.

### 5. Canary `GG_HOST`

- **Driver:** `canaryEnvironment` sets `GG_HOST` to `'127.0.0.2'` (was `'0.0.0.0'`), with a comment.
- The S2 hard check `saved-options-override-canaries` still requires `127.0.0.1`.
- **case-map:** S2 `adds`. **README:** S2 row.

### 6. README limits (documentation only; no new framework)

- **§2:** `maxMinutes` is checked between operations, not as a wall-clock cutoff:
  - It is checked in `runProcess` before each child, at each stage start, and in the drain and run poll loops.
  - One bounded operation can overrun it, up to the 600 s installer.
  - A stop with `--on-stop drain` gets a bounded 180 s recovery extension.
  - The worst case is about `maxMinutes` plus 14 minutes.
- **§1:** root supplies the outer finite transport. The recommended bound changes from `maxMinutes` + 5 to `maxMinutes` + 15 minutes. Only `run` is admitted initially.
- **§5:**
  - A child that exceeds its bound is uncertain, with no silent retry or cleanup.
  - If root's outer transport bound expires, the state is uncertain, with no silent retry or cleanup.
- **§7 and case-map `followUp.admission`:**
  - `observe` and `drain` are excluded from the initial execution admission.
  - Before any later use, root hash-binds the generated `fixture-manifest.json` and verifies a fresh physical `--out` parent.
  - The observe and drain code is unchanged.

### Unchanged

- Case IDs, stage order, the CLI modes and flags, and the exit codes.
- The S8 node copy stays optional and off by default (`--include-node-move`).
- No human or GUI cases were added; root selects the GUI criteria after hosted and native evidence.

## Checks actually run

All local, with the project-scoped Node `v22.23.4` (`~/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64`):

- `node --check gg456-native-qa.mjs`: OK.
- `JSON.parse` of `case-map.json` (10 stages) and of `binding.template.json` (`final=false`, `boundBy=null`, `driverSha256=null`): OK.
- A CR byte scan of all four files: none, so line endings are LF.
- `cmp` of the preparation 01 and 02 `binding.template.json`: identical.
- Preparation 01 hashes re-read after the work: unchanged (`ba2b21bf…`, `b16f698a…`, `ca16f98b…`, `bf59183a…`).
- Read-only `git rev-parse HEAD` and `git status --porcelain` in the worktree, for the citation: HEAD 8bddb93a, tree d0f7b3ee, plus the uncommitted correction.

**Not run:**
- nothing on macOS;
- no SSH, QA run, build, tests, install, product, browser or GUI;
- no preference change, provider or Git mutation;
- no execution of driver logic beyond the syntax check.

## Output hashes (SHA-256, bytes)

| File | SHA-256 | Bytes |
| --- | --- | --- |
| `gg456-native-qa.mjs` | `1e5e4b03403cac63b3ecbcb3a84cce15ebacf266929324a570e40cbe5f485148` | 102792 |
| `case-map.json` | `c7f27c372cf9367a06df5728bf77b7f3aa5abfad97267e0da45f520928970fe7` | 31602 |
| `README.md` | `545aeb099225d8f4692868463ca11d17d46f4510067fb9b6c3087144a3484720` | 18291 |
| `binding.template.json` | `b16f698af2780b7fa148fa566f041ae4a3d8fe16ebaa59665cad2a514f92b17a` (unchanged) | 2362 |

This handoff file is not self-hashed; root hashes it on intake.

## Native status and residuals

**Unexecuted.** Root must still:
- inspect the driver;
- bind `driverSha256` from the inspected bytes;
- rebind the candidate, build, Node, files and `launcherSourceDigest` to the corrected successful owner-Mac build;
- set `final: true`.

**Residuals:**
- The S7 record is best-effort in the product: it is skipped if the 250 ms tail lapses. The hard check therefore turns a missed write into an unmet criterion that root must classify.
- On stock macOS, `127.0.0.2` is not configured on `lo0`. A regression that inherited it would fail to bind, which stays local and does not expose anything.
