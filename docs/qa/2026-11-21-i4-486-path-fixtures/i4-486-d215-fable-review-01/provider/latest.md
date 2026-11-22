# D215 bounded correction review — GraphGoblin #486 / PR 553

**Verdict: CHANGES REQUIRED.** The P2 half leaves the admitted defect open for a second class of Windows path alias. The P3 half is sound. This review executed nothing; every statement is source-traced unless attributed to the author's logs.

Reviewed head `6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08`, tree `34b80f155c8434abc69fc72105ae7462fc460377`, direct parent `b8126de18080b76b15cbbbbc00fd791030fec3e1`, one path, as recorded in `dispatch-source-before.json` and author logs 47/49. `correction.patch` agrees with the current `fs.test.ts` and with `fs.test.before.ts`. I did not recompute hashes.

## F1 (material): the temp expectation uses a different resolver from production

`fs.test.ts:136` derives the expected workspace from `realpathSync(dataDir)`, the non-native resolver. Production derives it from `realpath` of `node:fs/promises` (`owned-resources.ts:200-204`, used at `:99-100` and `:207-212`), which is native.

- **Production is native:** `@types/node@22.20.5` `fs/promises.d.ts:914` says promises `realpath` uses "the same semantics as the `fs.realpath.native()` function".
- **The test's resolver is not:** `fs.d.ts:1415-1417` says of the non-native form, "No case conversion is performed on case-insensitive file systems".
- **The repository knows the difference:** `physical-path.ts:11` reads "Native realpath resolves junctions/short names".
- **Short names:** the non-native resolver only substitutes link components, so 8.3 names and spelling case survive. This is my knowledge of Node's implementation, not executed here.

Consequence: when the `os.tmpdir()` spelling is not the on-disk canonical spelling, production returns the canonical path and the test expects the spelled one. `fs.test.ts:143` then fails, which is the same assertion as P2. Two spellings trigger it: an 8.3 short component (profile names over eight characters, `RUNNER~1`) or a case-variant `TEMP`. Author log 18 shows `os.tmpdir()` returning `TEMP` verbatim.

The repository treats this alias class as supported for this exact class. `history-cleanup.test.ts:212-232` runs `OwnedRunResources` through a Windows `short-name` data directory, the control scan 3 cited. Comparable fixtures canonicalise natively: `voice.test.ts:90`, `reset.test.ts:694`, `windows-launcher-evidence.test.mjs:59`.

- **Not a regression against `b812`:** those hosts failed there too. The correction leaves admitted P2 open for them.
- **Invisible to the author's runs:** the junction and temp roots were spelled in exact on-disk case with no short components.
- **Invisible to hosted CI:** unit tests run on Ubuntu only (`ci.yml:147-176`); the Windows job runs launcher acceptance only (`:13-51`).

**Remedy:** one token, `realpathSync.native(dataDir)` at `:136`.

**Falsifiable control for the native QA:** run `-t "uses real temp paths"` with process-local `TEMP`/`TMP` set to an upper-cased spelling of an existing temp directory. I predict the head fails at `:143` (expected upper-case, received on-disk) and passes with `.native`. If the head passes, F1 should be withdrawn.

**Adjacent, not introduced by this correction — needs coordinator disposition.** Unchanged `:145` uses the same non-native resolver for the `journal.use` key (`b812` `:143`; scan 3 did not flag it).
- Under a short-name `TEMP`, the fixed and template cases fail at `:147` even after `:136` is fixed.
- The P3 relocation makes the relative case's key depend on checkout spelling. A `subst` or mapped-drive checkout is the likely trigger; I have not verified it.
- `.native` at `:145` closes both.

## Checked and found sound

- **P2, link aliases:** the junction case is fixed. Exact script cwd, file bytes, journal, claim and reuse assertions are retained (`:143-157`). Fixed and template stay lexical. The adapter temp check (`:58`) is rightly lexical, because `FsWorkspace` does not resolve (`workspace.ts:19-24`).
- **P3, relative input:** the fixture root is under `process.cwd()`, so `relative()` cannot return an absolute path or `..`. It is asserted at `:53` and `:96` before use, and `:96` precedes engine creation. There is no `chdir`.
- **Cleanup:** the helper (`:40-44`) removes the exact `mkdtemp` root. Vitest 5.0.3 runs `onFinished` hooks after `afterEach` whatever the result (`vitest/dist/chunks/run.BTlFXlnv.js:3898-3909`) and throws outside a test (`:2162-2167`). These tests are not concurrent and do not call `ctx.skip()`.
- **Untouched:** production, contracts, dependencies, timeouts, retries, skips and coverage configuration. The file still has 20 tests.

## Author evidence

Supported by the logs:
- The original source fails under a real junction at `:141` with exit 1 (log 20; source bound in 19; junction proven in 18). This negative outcome stands.
- The corrected source passes 21/21 on ordinary temp (34) and under the junction (36).
- Both relative cases pass with a G: checkout and C: temp (29). Probe 28 shows the original placement absolute and the corrected one relative.
- Package typecheck, file-scoped ESLint and file-scoped Prettier each exit 0 (31–33).

Limits:
1. **Missing receipts:** four cited cleanup logs (22, 25, 27, 35) are absent from the folder and from the 56-entry manifest. Log 30 holds only the C-root removal line. `Assert-TestCleanup` prints through `Out-Host`, so nothing reached `Tee-Object`. Zero residue is supported indirectly: the script continued past each check, `untrackedBeforeStaging` is empty (37), status is empty (46), and I found no `gg-wp-*` in the checkout.
2. **Failure-path cleanup:** no run shows cleanup after a failing relative case. That rests on the hook semantics above.
3. **Source binding:** corrected runs carry no per-run source hash. Log 29 would also pass on the original source, so the relative input is evidenced by the in-source assertion plus the probe.
4. **Cross-volume coverage:** two cases ran and 18 were skipped.
5. **Folder sweep:** the `src/fs` sweep (24) exited 1 with four failures in unchanged `chat-audio.test.ts` (three symlink `EPERM`, one newline-filename `ENOENT`). No full package, coverage or `pnpm check` run exists for this head.
6. **Wrapper error:** the original-control wrapper threw at its own regex (disclosed). Its result was read back from the log.

## Residual assumptions

- Relative fixtures now sit in `packages/infrastructure/` and are not gitignored. A hard-killed worker would leave an untracked directory in the checkout. D215 authorises the placement, so I ask for no change.
- Short-form `TEMP` prevalence is platform knowledge, not observed on this host (`98jak` has no short component).
- I did not read the D035/D042 texts, `setup.ps1`, logs 01–17 or 38–45, or `fs.test.after.ts`.
- Independent Opus native QA and corrected-head/current-target CI and native verification remain gates.
- Run 44934348117 stays failed and causally unresolved under D213. Run 44950929794 on the parent is not evidence for this head.
- Original final 3 remains CHANGES_REQUIRED on `b812`.
- This is not general scan 4, a reset, a renewed Astra approval, or an acceptance or deployment claim.