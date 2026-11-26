# Guarded PWA update test error precedence (#555): native Edge QA

Issue #555, the guarded PWA update retry that stalls after a dirty tab closes, stays open. Its product cause is unresolved. This packet covers only the test-only change to `apps/web/e2e/pwa.spec.ts` (FUP-029). When the dirty-tab case fails, the body error stays the reported test error. A cleanup error after it is printed on stderr and attached as `guarded-update cleanup error`; it no longer replaces the body error. A cleanup error after a passing body still fails the test. The setup, the 30 body statements, both cleanup steps and the deadlines are unchanged.

Candidate commit `fd7e26752cf1deb1f914bdddddf67258cf3cc234` on `631d16e39b8e9932f4763390a4166fa67eea8df3` carries the reviewed full-index patch `47e3e1b9b9e944f5ba0b4792cdc2a45f4c68587ff5758f0a1215e17d81c678e0` exactly; the spec's SHA-256 is `b36f27c183b1e201c6a1cb394066fd9cca8f6696b0a872b221aacc7037b30bf1`. Merge `a1f1a94649382b045bb007f5674d30fbf3fb9212` brings in main `4e1037c9e9922ffa27237fe79850403b6b54fc70` without conflicts. The merged tree differs from that main only in this one file.

## Review and authoring

The GPT-6.1 Sol xhigh formal review 1 returned READY with no P1 or P2 findings. Its TypeScript AST comparison matched the 6 setup statements, all 30 normalized body statements and both original cleanup steps. The Claude Opus 5.5 author's four browser-free controls passed. A temporary restoration of the old `try/finally` failed only the dual-failure control. The author's own native target run never started because Playwright looked for Edge under an emptied per-user path. [Formal review](raw/review-01/REVIEW.md.txt) · [Review binding](raw/review-01/REVIEW.json) · [AST comparison](raw/review-01/AST-COMPARE.json) · [Author report](raw/author-01/IMPLEMENTATION-REPORT.claude.md.txt)

## Native Windows Edge runs

Each run was a single attempt with one Playwright worker, zero retries and the spec's own deadlines (60 s per test, 10 s per expectation). No run was retried or repeated.

| Run | Tree                                 | Selection                       | Result    | Target case |
| --- | ------------------------------------ | ------------------------------- | --------- | ----------- |
| 01  | `631d16e` with the uncommitted patch | `pwa.spec.ts --grep=unresolved` | 1 passed  | 6.4 s       |
| 02  | `631d16e` with the uncommitted patch | whole `pwa.spec.ts`             | 17 passed | 6.1 s       |
| 03  | merge `a1f1a946`                     | whole `pwa.spec.ts`             | 17 passed | 5.5 s       |

The venue was Windows 11 Pro 10.0.26300 with Playwright 1.63.0 using the `msedge` channel. That resolved to Microsoft Edge 158.0.4370.33 at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, SHA-256 `5b07e50eaba5ca60fe6b900cc418a2081cdb8de6c621bfaf85b58865ede378ee`. `ProgramFiles`, `ProgramFiles(x86)` and `ProgramW6432` were kept. Node was 22.23.4 and pnpm 12.8.1, with `CI=1`, temp and browser profiles under a disposable folder. Ollama discovery was disabled and the Codex and Claude binaries pointed at absent paths. Each run served a byte-identical disposable copy of `apps/web/dist`, and that copy hashed the same before and after the run.

Runs 01 and 02 served the 28-file build recorded for the completed 12-task `631d16e` build. The change is test-only, so that build still applies. Run 03 served a fresh `pnpm build` of the merged tree: 12 of 12 tasks succeeded and the web app was rebuilt. The run receipts, verbatim stdout and stderr, and Playwright JSON reports are under [`raw/native-631d16e/`](raw/native-631d16e/) and [`raw/native-merged/`](raw/native-merged/).

## Assessment

**Target case.** The target passed in all three runs. These runs therefore neither reproduce #555 nor drive the real case through its failure path. A pass does not establish the product cause, the missing second-Apply reload, or how a real 60-second timeout of the page wait is reported on this venue.

**Error precedence.** The real case did not fail, so its own report could not show precedence. The dual-failure control at `pwa.spec.ts:691` passed in runs 02 and 03. In that control the body's `apiRequestContext.get` error remained the rejection, with the same object and stack. The cleanup's `apiRequestContext.post: Target page, context or browser has been closed` was printed once on stderr, and the stderr logs keep it verbatim. It was attached once, and the test recorded no errors. The other three controls also passed: body failure with a passing cleanup, cleanup failure after a passing body, and both passing. The controls use disposed request contexts. They stand in for fixture teardown but are not a real timeout.

**Next case.** In runs 02 and 03 the case after the target ran cleanly on the same Playwright worker 0: the dual-failure control at `:691`. So did the next case using the browser and the normal worker fixture, the legacy active-worker case at `:815`, in 9.9 s and 10.1 s. Both runs had retry 0 and no errors. This checks the sequence after a passing target only. The sequence after a real target failure was not exercised.

## Gates on the merged tree

Web typecheck passed. Web lint reported 0 errors and 5 warnings, all in untouched `apps/web/src/runs` files and the same five the author recorded. `pnpm format:check` passed. Web unit coverage was not run, because the change touches only a Playwright spec outside the Vitest coverage gate. [Gate logs](raw/gates/)

The opposite-family review of the final head, current-target CI, the fresh Astra MAX final audit (reserved for 2026-11-28), merge and owner acceptance remain separate gates. #555 stays open.

## Files

[`MANIFEST.json`](MANIFEST.json) lists every raw member with its source, size and SHA-256. Markdown originals keep their exact bytes as `.md.txt`, and logs are stored as `.log.txt`. The packet's `.gitattributes` keeps `raw/**` byte-exact. The run receipts and drivers keep their original local paths and are not portable replay scripts. No provider prompt, session event journal or private reasoning is published.
