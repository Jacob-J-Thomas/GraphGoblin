**Verdict: ACCEPT** for tree `b7f195c3…` and for D243 as a routing decision. I request no change to the candidate tree. Findings 1–3 are record corrections to close before publication, and I do not accept the "isolated" claim for files I could not read (finding 3).

I ran nothing; this is from reading the listed paths and the supplied receipts.

## The three assessments

1. **Metadata and doc unions: sound.** Every hunk in `manual-resolution.patch` is additions only, and the checkout matches on read-through:
   - `.gitattributes:272-285` and `.prettierignore:132-148` keep the Mac raw-evidence rules and add the three inspector archives; patterns are disjoint and the negation order at `.prettierignore:139-142` is intact.
   - `CHANGELOG.md:7-19` (Mac) sits above `21-71` (#416/#420).
   - `docs/09-frontend-and-pwa.md:25-46` (Mac) and `140-263` (inspector) are both present; both patches end at blob `7dc7eef2c`.
   - The register's "six jobs" (`:440`) is the pre-Mac main run and `docs/10:205` "seven jobs" is the Mac workflow, so they do not conflict.
   - Mac obligations are retained at register `:444`, `CHANGELOG.md:18-19` and `docs/10:15-22`.

2. **Composition receipts: internally consistent.** Tree and ordered parents agree across STAGED-PROOF, FREEZE and the brief. Entry counts reconcile: 41001 + 1663 + 2015 + 65 = 44744. `ci.yml` has the seven jobs and the 12 static steps (`:172-206`) the brief expects. Exceptions are findings 2, 4 and 7.

3. **D243: the exclusion rationale is verified in source.**
   - The fixture drops every `GG_*` and does not set `GG_OLLAMA_ENABLED` (`api-subprocess.ts:126-149`).
   - The in-process case does the same (`main.test.ts:171-175`).
   - Config defaults Ollama on at `127.0.0.1:11434` (`config.ts:36-39`).
   - The container builds and starts the service (`container.ts:298-305`, `:580`).
   - No hosted or native fixture is dropped: `ci.yml:47-54` (macOS) and `:237` (coverage) still run the file.

## Findings

1. **Medium: the Windows legs of `main.test.ts` have no venue at this head.**
   - `main.test.ts:80-136` is `runIf(win32)`: the managed Windows log entry, exit 71 and exit 70.
   - `:53-64` and `:154-164` are the Mac branch's own "Mac variable consumed elsewhere" checks, whose Windows leg is also unrun.
   - Coverage runs on `ubuntu-latest` (`ci.yml:210`) and the macOS job on `macos-15`.
   - The Windows job runs only `pnpm test:windows-launcher` (`ci.yml:112`), which `docs/10:52-56` and `:242` describe as the native launcher TAP suite.
   - D243 and register `:444` say hosted and native "retain that file", which is true only at file level.
   - `CHANGELOG.md:13-14` and `docs/11:104-105` say this branch moved Windows and Mac onto one shared log writer, so the unrun path is one the branch touched.
   - Ask: state the residual in the next register entry. Cite an earlier Windows run at object-identical `apps/api` if one exists; otherwise say none. The launcher log cases (`docs/10:76-83`) overlap but are a different fixture.

2. **Medium: FREEZE.json `mainRef` is `a60843a9050b…`, not `d2df8600…`.** Nothing supplied says which ref that field reads. A stale local branch is harmless; a moved `origin/main` means the second parent is no longer the current target. Ask: label the field and add a remote main readback.

3. **Medium: the inclusion side of the isolation basis is only partly established.**
   - `serve.test.ts:99-100` disables Ollama and Jev only inside `environment()` (`:82-115`).
   - The control case (`:327-347`) goes through `createTestApp` and listens on port 0 (`:333`), outside 62400–62439. `test-app.ts` is not in my read set and D243 does not cite it.
   - I confirm `main-entry.test.ts` never calls `main()`, and `data-dir-lock-failures.test.ts` touches only owned temp locks.
   - The other eight API files are unnamed and unreadable to me. Any that starts a container on default config follows the same route D243 identified.
   - Ask: cite the containing line per retained file in the admission record, and amend the port statement.

4. **Low: fixture pins made at `4690b54` need an object-identity statement.** D243 requires a rebind after integration. STAGED-PROOF gives only the `apps/web` tree and one global boolean. Ask: record the `apps/api`, `packages` and `tooling` tree IDs against the Mac parent, or supply the rebind receipt.

5. **Low: no tracked follow-up for the fixture default.** `api-subprocess.ts:1` and `docs/10:442-446` still say no owner listener or process is used, while register `:444` records a source-supported route to one. Declining to patch here is right. Ask: open an issue and reference it. The fix would mirror `serve.test.ts:99` and restore the Windows leg from finding 1.

6. **Low: D243 is not traceable from the tree.** Register `:444` and the core-delivery `README.md:17` cite it by name only; earlier decisions carry links (`:312-313`, `:366`). Register `:40-41` requires blocker decisions to be catalogued with alternatives. Ask: bind sha256 `4108e174…` or a public link in the next entry.

7. **Low: receipt labelling and snapshot wording.**
   - `manualPaths` lists `docs/09` (auto-merged) and the register (appended, no conflict).
   - The merge commit also carries 65 non-parent files and a new register section, so "normal merge" should read "merge plus supplement".
   - Main-side byte preservation for the three conflict files is a boolean; only `docs/09` has a target-relative patch.
   - Register `:444` calls the integration "upcoming" and its checks "pending" inside the integration commit. Leave it and record actual results in a new entry.

8. **Low: two benign host interactions are undisclosed.**
   - `serve()` reaches `ownWindowsProcessIdentity` (`data-dir-lock.ts:495`), which `docs/11:134-136` says uses PowerShell and WMI.
   - Ports 62400–62439 lie inside Windows' default dynamic range, so "nonowner" is point-in-time. I did not observe the host's configured range.

## Evidence limits

- I ran no commands, git, hashes or tests. I did not confirm the checkout's HEAD; matches are by reading, not by bytes.
- Root's receipts and results (build, API 193 passed / 21 skipped / 11 files, web 162 / 9 files) are taken as supplied. The cleanup report is still pending.
- Not readable to me:
  - `package.json` scripts and the shared Vitest config;
  - `test-app.ts`, `serve.ts`, `main.ts` and the Ollama service;
  - the other eight API and nine web files;
  - the 65 archive members;
  - D243's REPORT.md and SOURCE-PINS.json.
- Because of that, "disabled means no network I/O" and "start performs discovery" are not source-verified by me.
- Partial reads: `docs/09` lines 1–270, register lines 1–120 and 300–445, `CHANGELOG.md` lines 1–110.
- Nothing here assesses or infers Swift, Finder, Dock or GUI acceptance.