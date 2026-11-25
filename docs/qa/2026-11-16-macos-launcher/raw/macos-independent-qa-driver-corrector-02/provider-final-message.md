Preparation 02 is finished: the four files from preparation 01 are copied into the new folder with the six corrections applied, plus a new `correction-handoff.md`. Nothing was run on macOS, and the binding template is unchanged with `final: false`.

**Corrections:**
1. **`startContender`:** now uses `expectedEnv(ctx, ctx.ports.p2)`, which includes the exact encoded `GG_DB_URL` and no log admission. Without it, the API falls back to an unescaped `file:` URI built from the data directory (`apps/api/src/config.ts:146`).
2. **S7:** the old note is replaced by two hard checks:
   - `launcher-record-no-spawn-failed-or-canary`;
   - `launcher-record-store-blocked`: no rotation, and the new lines are exactly `stage=waiting-for-store outcome=store-blocked`.

   I confirmed that line format and the 250 ms tail in the worktree's uncommitted product change to `NativeLaunchEngine.swift`. The 60–63 s and 65 s timing checks are unchanged. README and case-map now call the old "store-blocked writes nothing" claim historical.
3. **`~/Applications`:** a missing folder now counts as empty only in the admission check and the S0 baseline, and only if the home folder passes the installer's own safety rule. A symlink, a non-folder, an unsafe folder or any other error is refused; after an install, a missing folder is an error. Admission failures now give `admission-refused` (exit 2) instead of an internal error. The driver never creates the folder.
4. **S3:** a failed case-variant install no longer counts as success. Both spellings must now pass `must <tag>:managed-update` and `must <tag>:new-generation`, plus the existing checks for same ID, original name and undisturbed gateway. If the installer refuses, whether it left the app unchanged is recorded first. The case-sensitive skip is unchanged.
5. **Canary:** `GG_HOST` is now `127.0.0.2`.
6. **README limits:** these are documentation changes only:
   - The total deadline is checked before each child process, at each stage start and in poll loops. It is not a hard wall-clock cutoff, and recovery gets an extra 180 s.
   - Root supplies the outer time limit. I raised the recommended limit from `maxMinutes` + 5 to `maxMinutes` + 15 minutes, because one installer (up to 600 s) can overrun the deadline.
   - A timed-out child is uncertain, with no silent retry or cleanup.
   - `observe` and `drain` are excluded from the first execution; before later use, root hash-binds the manifest and checks a fresh output parent.

**Decisions for you:**
- **NFD now hard too.** In preparation 01, NFD's install success and new generation were only soft checks, so an NFD failure didn't stop the run either. To make "just like NFD" literal, both spellings now require them. The catch is that an NFD refusal now stops S3; if you want NFD left soft, revert those two checks for the `nfd` tag only.
- **Existing `~/Applications` checked earlier.** An existing `~/Applications` that is owned by someone else, or writable by group or others, is now refused at admission rather than failing in S1 after the run has created things.

**Checks run** (project Node v22.23.4 only):
- `node --check` passed.
- Both JSON files parse; the template still has `final=false`, `boundBy=null`, `driverSha256=null`.
- No CR line endings; the binding template is byte-identical to preparation 01.
- Preparation 01's hashes are unchanged.
- I also ran read-only `git rev-parse` and `git status` for the citation: HEAD 8bddb93a plus the uncommitted correction.

No tests, build, install, SSH, browser or Git changes.

**Output hashes (SHA-256):**

| File | SHA-256 |
| --- | --- |
| `gg456-native-qa.mjs` | `1e5e4b03403cac63b3ecbcb3a84cce15ebacf266929324a570e40cbe5f485148` |
| `case-map.json` | `c7f27c372cf9367a06df5728bf77b7f3aa5abfad97267e0da45f520928970fe7` |
| `README.md` | `545aeb099225d8f4692868463ca11d17d46f4510067fb9b6c3087144a3484720` |
| `binding.template.json` (unchanged) | `b16f698af2780b7fa148fa566f041ae4a3d8fe16ebaa59665cad2a514f92b17a` |
| `correction-handoff.md` | `43f92094d84345005b77e18e09051560edf8862b9fa983773e6059e17f1a0e7c` |

**Still open:** root inspects the driver, binds `driverSha256`, rebinds everything else to the corrected successful build, and sets `final: true`. One risk to note: the product writes the S7 log line on a best-effort basis, so if it misses the 250 ms window, the hard check will show it as unmet and root will need to classify that.

Files are in `C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-independent-qa-execution-preparation-02/`:
- `gg456-native-qa.mjs`
- `case-map.json`
- `README.md`
- `binding.template.json`
- `correction-handoff.md`