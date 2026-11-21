# #442 independent integrated UI/browser QA — report

**Terminal result: CONDITIONAL.** No product defect found. All 24 declared cases ran in the final
attempt (`run-03`): 20 PASS, the 3 declared controls behaved exactly as predicted, and C18 (static
built-asset check) PASS. Across the 23 browser cases, 588 of 596 individual assertions passed; the 8
that did not are exactly the predicted control outcomes (5b baseline lacks the notice; DOM mutation is
flagged). **The condition** is root acceptance of the source-binding method: the candidate commit
object `39304c07` is absent from the QA checkout and Git fetch is prohibited, so I bound the exact
committed candidate bytes by a verified working-tree overlay instead of `git checkout --detach`
(details below). Also see the stated limits.

This is independent behaviour QA by actual Claude Code Opus 5.5 (xhigh) in a fresh context. It is not
the UI author's work, not a formal review, not CI, not a final audit and not owner/human acceptance.
No provider turn, plugin repair, GitHub action, fetch, index/commit/push or author-checkout edit was
made.

## 1. Source, tree and build binding

| Item | Value |
| --- | --- |
| Candidate (author) | commit `39304c07b553f8dfe2d444a19c86f327cd8a32c4`, tree `f5d9abaefbe7be1581a39d22c4eff4e01024e687`, parent `5b0d806c75d409c33a57ea54ffda45e2f89bc500` |
| QA checkout | `G:/ggq/gg-i4-442-qa/GraphGoblin`, verified clean at HEAD `5b0d806c…`, tree `8e24c697b40eb1a4ab4cd81f481fce53494a2ce7` before touching (same 5b tree as the author repo) |
| Candidate delta | author `git diff --raw 5b..39304c07`: exactly 4 modified paths, no add/delete/mode change |
| Overlay result | each path's QA `git hash-object` (no `-w`) equals the candidate blob; SHA-256 equals root receipt; `git status` lists exactly these 4 paths |
| UI/docs SHA-256 | `PreflightSection.tsx` 69afe7f0…29e5; `PreflightSection.test.tsx` a60b0729…5c61; `SettingsPage.test.tsx` ba895a8e…fc70; `docs/09-frontend-and-pwa.md` 5c442062…22e5 (all match `i4-442-ui-root-freeze-01/receipt.json`) |
| 7 backend files | all match the prior backend binding (`binding/source-binding.json`) |
| Runtime | Node v22.23.4 (project runtime on PATH), pnpm 12.8.1 |

**Binding deviation (the condition).** `git cat-file -t 39304c07` failed in the QA checkout (origin
is the author checkout; the commit was never fetched). I did not fetch, bundle or copy objects.
Instead I read the four files' committed bytes from the read-only author checkout
(`GIT_OPTIONAL_LOCKS=0 git show 39304c07:<path>`) and wrote them into the QA working tree. All are
`text=auto eol=lf` with no filters, so blob bytes equal working-tree bytes. Because the 5b trees
are identical in both repositories and the diff has exactly these 4 paths, the QA checkout's tracked
working-tree content equals candidate tree `f5d9abae…`. HEAD, index, refs and object store were not
changed. The overlay is left in place to match the rebuilt output; `git checkout -- <4 paths>`
reverses it. Log: `binding/overlay.log`; binding: `binding/source-binding.json`.

Before I set `GIT_OPTIONAL_LOCKS=0`, one early `git status --porcelain` in the author checkout may
have refreshed that worktree's index stat cache. It changes no content, and the author checkout is
clean at `39304c07`/`f5d9abae` at the end.

**Build.** Before building, all 1,271 retained outputs were byte-identical to the prior backend
binding (`binding/prebuild-vs-prior-binding.json`). The retained 5b `apps/web/dist` (28 files,
hashes verified) was copied to scratch as the baseline control build. Then I ran one
`pnpm.cmd build`, with TEMP/TMP set only for that process to G scratch and telemetry off.
Prediction and result matched: **12 tasks, 9 cache hits, `@graphgoblin/web` cache miss (rebuilt),
plugin-codex/plugin-claude cache bypass (uncacheable), exit 0, 34.0 s** (`build-web-01.log`).

Output diff (`binding/build-output-diff.json`): new `index-Cgc9dz32.js` (+.map) replaced
`index-ZDYtIq88.js`; `index.html`, `sw.js` and `sw.js.map` changed. One prediction missed:
`dist-goblin/sw.js.map` changed. Only its `sources` path changed, because Workbox embeds its build
TEMP directory path. `dist-goblin/sw.js` and assets are unchanged. Every other output is unchanged.

| Built file (candidate) | SHA-256 |
| --- | --- |
| `apps/web/dist/assets/index-Cgc9dz32.js` | `C3D7F5AA5B31C12CD0FC02E036F08AE427FC6132C17E8C28688A1CFE86738973` |
| `apps/web/dist/assets/index-DH560BJA.css` | `A3AA8750…77AD` (identical to baseline: notice uses only existing classes) |
| `apps/web/dist/index.html` | `37F9BA16854207D223934F3926D4D8EA93911B1D1EA67239C364E93EC049DD17` |
| `apps/web/dist/sw.js` | `819E2F345114CC28605A238354C3873B4E19C11F3F684EB6FB4814A136CAD1DB` |
| Baseline 5b `assets/index-ZDYtIq88.js` | `510B1C202306A98B7B7C0B4F6F97D853C35007BC6D45FAB9C253B7AD978BFED3` |

Full before/after census of 1,271 outputs: `binding/built-before.json` and
`binding/built-after.json`.

## 2. Method

- **Driver:** `ui-qa.mjs`, independently authored. Attempt-exact bytes are kept in each run as
  `ui-qa.used.mjs`; run-01's is a labelled reconstruction (see §6).
- **Fixture:** `fixture-codex.mjs`, a harmless Codex CLI stand-in. It answers only `--version`,
  `exec --help`, `exec resume --help` and `login status`, and logs pid/ppid/argv/cwd/mode. Any other
  command gets exit 97. Modes: ready, auth, quota, transport, unknown, incompatible; optional delay.
- **Browser:** the repo-installed Playwright 1.63.0 library driving system Edge 158.0.4370.33
  (`channel: 'msedge'`, the repo's documented Windows default), headless.
  - The bundled Chromium 1243 is not installed and was not downloaded.
  - The skill's `playwright-cli` route would need an npx download, so it was not used.
  - The disposable profile lived under G scratch TEMP.
  - Service workers were blocked for exact network accounting (limit below).
- **Backend:** the real built gateway `apps/api/dist/main.js` with its normal production startup
  composition, serving the built web app at `/app/`.
  - Disposable store and an env allowlist; HOME/USERPROFILE/APPDATA/LOCALAPPDATA/CODEX_HOME/TEMP/TMP
    all point to G scratch.
  - `GG_REQUIRE_API_KEY=true`. A disposable key was made with the built `--create-api-key` CLI and
    entered through the real "API key required" panel. Its token stays in memory and is redacted in
    output.
  - `GG_CODEX_BINARY` → fixture; `GG_CLAUDE_BINARY` → absent path; `GG_OLLAMA_ENABLED=false`.
  - No product flag or source edit.
- **Three gateway sessions:**
  - S0: baseline 5b web build.
  - S1: candidate web build.
  - S2: candidate with `GG_CODEX_BINARY` pointing to a missing `.exe`.
- **Assertions:** a self-contained in-page fact collector reads DOM order, classes, roles, live
  regions, notice text nodes and code children. A geometry probe measures boxes, line counts and
  WCAG contrast (canvas sRGB conversion with background compositing). Expected badge labels, tones
  and problem sentences are independent literals; the built domain constant/readinessMessage were
  only cross-checked (all equal).
- **Network evidence:**
  - Browser request/response/failure log per tab, with headers never recorded.
  - Fixture call log as the server-side native command record.
  - Gateway request log cross-check: server-logged `GET /harness/preflight` equals browser-observed
    minus intercepted in S0 (6 = 8−2), S1 (21 = 28−7) and S2 (3 = 3−0).

### Native vs controlled distinctions

| Label | Meaning | Cases |
| --- | --- | --- |
| NATIVE | Real browser → real HTTP → built gateway → real child-process spawn of the fixture (or a real ENOENT spawn for M1). States come from the actual Codex adapter classifying fixture output. | B1–B3, B5, C1–C10, C15, C16, M1, C11/C10 restoration |
| BROWSER-OFFLINE | Playwright `context.setOffline` (browser network emulation; navigator offline) over the native backend | C10 |
| INTERCEPT | `page.route` fulfils `/harness/preflight` in the browser; backend not consulted for that response | B4, C11 failure phase, C12, C13, C14 |
| DOM-CONTROL | In-page mutation of the rendered candidate notice, to prove checker sensitivity; not product behaviour | C17 |
| BASELINE | The retained pre-#442 5b production web build served by the same gateway: a natural missing-notice control | B1–B5 |

No real Codex CLI, account, provider, plugin or MCP inventory was used. Native CLI/plugin facts belong
to the prior backend packet `i4-442-independent-01`, which was not repeated. The fixture recorded 95
calls in run-03, all among the 4 allowed no-turn commands and 0 rejected. No `plugin list`, `mcp list`,
exec turn or app-server command was ever issued. Settings made zero `/system/preflight` requests.

## 3. Criteria results (run-03)

| Criterion (D175/D189/docs09) | Result | Evidence | Overlap with author component tests | Gaps |
| --- | --- | --- | --- | --- |
| Notice text is the exact shared domain constant; 2 commands as `<code>`; node sequence text/code/text/code/text; no other elements | PASS | C2, C3–C10, C13, C16, M1; C18 bundle contains the sentence exactly once, baseline 0 | "shows the shared notice under a Ready Codex badge…" | — |
| Muted paragraph (`p.text-xs.text-muted`, 12 px), no role/aria, not inside a live region | PASS | all notice cases; ARIA readback shows plain `paragraph` | quiet-note tests | No real screen reader |
| After actual problems, outside the problems list, direct last child of the Codex row | PASS | C4, C6–C9, M1 (one problem); C13b (two problems) | it.each(NOT_READY) | — |
| Present in every Codex readiness state | PASS: ready, auth, quota, transport, unknown, cli-incompatible, cli-missing all NATIVE | C2, C4–C9, M1 | it.each(NOT_READY) (component) | — |
| Other harnesses never show it; absent when no Codex row | PASS | native Claude cli-missing + Ollama unknown rows (all S1 cases); C13a Claude/Ollama Ready; C14 Codex absent → 0 | "belongs to the Codex row alone…" | — |
| Ready/auth badge, tone, icon, version, problems unchanged | PASS | Region HTML minus notice is **byte-identical to the 5b baseline** for Ready (C2 vs B1) and auth (C4 vs B2); badge tone classes checked per state | — | Only Ready/auth compared against baseline HTML; the other states were checked by literal expectations |
| Ready/Authenticated semantics | PASS | Native response `authenticated:true` (C2/C5) and `false` (C4) with Ready/Sign-in needed badges; Claude "Signed in with Claude.ai." only for claude.ai+authenticated (C13a, intercept); Defaults says "Codex readiness: Sign-in needed. See Harness preflight below." without the notice (C4) | SettingsPage sign-in test | Real Codex login not exercised |
| Retry = the existing query, once; Rechecking in the one status region; no duplicate commands/notices | PASS | C3: 1 GET, 4 fixture commands, "Rechecking…" status, Ready kept, Retry disabled, 1 notice during/after, no other API request; same 1-GET/command counts for every Retry (C4–C9) | "adds no request: Retry refetches…" | — |
| Offline keeps the last state; one live region; no extra request; restoration | PASS | C10: "Offline; showing the last check.", Ready kept, 1 notice, 1 card live region, 0 GET, 0 commands; back online → 1 GET, 4 commands, status cleared | — | Service worker blocked; network emulation only |
| Loading view unchanged, no false Ready | PASS | C1 (native 3 s delay): "Loading preflight…", no badge/notice/Ready, Retry disabled; HTML **identical to baseline B3** | — | — |
| Request-failure view unchanged, no false Ready | PASS | C11: 503 → "Could not load preflight", no badge/notice/Ready, Defaults "Could not check Codex readiness."; 2 intercepted GETs (existing `retry: 1`); native restoration 1 GET/4 commands. C12 first-load error HTML **identical to baseline B4** | — | Failure is intercepted, not a real backend fault |
| Read-only scope; no policies changed | PASS | Zero non-GET browser requests in all sessions; `GET /settings` identical at start and end of each session | — | — |
| Layout: 1440 / 375 / 320 / 200%-equivalent, dark + light, Ready + auth | PASS (96/96) | C15: no page/card/notice overflow; notice and both codes inside card and viewport; lines 3/7/8/6 | — | Equivalent-viewport method, not real browser zoom |
| Notice contrast | PASS | 9.98:1 dark, 7.68:1 light (codes inherit the same colour) | — | Forced-colours/high-contrast mode not tested |
| Reduced motion / default font size | PASS | C16: `prefers-reduced-motion: reduce` active, identical notice, 0 animations (also 0 by default); root font-size 16 px | — | No claim for user-enlarged default font size |
| Checker sensitivity | Controls as predicted | B1/B2: only the notice checks fail on 5b; C17: muted-class, role/aria, live-region checks fail after mutation, all pass after reload | 9 author mutation controls (component level) | — |
| Missing-notice baseline adds no request | Shown | B1 vs C2: same 1 GET / 4 commands per load; same page live-region count | — | — |

**Totals:** 24 declared cases. 20 browser PASS + C18 PASS. Controls B1, B2 and C17 came out
EXPECTED-CONTROL as predicted. 0 FAIL.

### Renderings retained (`run-03/screens`)

- C2 Ready 1440 and C4 auth 1440 (default theme is dark).
- C15 dark Ready/auth 320, Ready 375, Ready 200%-equivalent (512×384); light Ready 1440 and light
  auth 320.
- C3 Rechecking, C10 Offline, C11 error, C13a all-Ready intercept, M1 CLI not found.
- Baseline B1/B2.

I viewed C2, C4, C15 dark-auth-320, C15 zoom200 and C15 light-ready-1440; each matches the asserted
DOM facts. ARIA readbacks are in `run-03/aria/*.yml`. Normalised card HTML is in `run-03/html`.
These are headless DOM/accessibility-tree readbacks, not a screen-reader experience.

### Observations (non-blocking, no fix made)

- **O1:** the code spans have `white-space: normal`. At 375 px `codex mcp list --json` breaks
  across two lines, and at 512 px (200%-equivalent) `codex plugin list --json` breaks before
  `--json` (`layout-measurements.json` `fragments: 2`; zoom200 screenshot). Nothing overflows, and
  the contract does not specify wrapping. Root/author may consider whether commands should stay
  unbroken; this is optional polish, not a contract defect.
- **O2 (existing behaviour, not #442):** the 503 error alert shows "Service Unavailable (HTTP_503)"
  rather than the response `detail`. Unchanged from the baseline.

## 4. Limits

- Binding was by verified overlay, not by commit checkout (the condition).
- Service workers were blocked. The offline case is browser network emulation over react-query,
  not the PWA shell path.
- The SW block produces console warnings ("Service Worker registration blocked by Playwright" and a
  follow-on `reading 'waiting'` TypeError in registration). These are instrumentation artifacts.
  The other console errors were the expected pre-key 401s and intercepted 503s. No `pageerror`.
- One engine (Chromium-based Edge 158), headless. No Firefox/WebKit, no real zoom UI, no
  forced-colours, touch or RTL checks. The notice is non-interactive, so touch targets do not apply.
- The 200% zoom result uses 512×384 CSS px, the repo's own 1024×768@200% equivalence. 320 px is
  the WCAG reflow width.
- No real Codex CLI/account. Plugin health is out of scope by design (D175); the prior packet holds
  the native CLI and repair evidence.
- Component tests (59 + 9 mutation controls in the author report) are not browser QA. This report
  does not re-run or certify them.
- No CI, coverage, final audit or owner acceptance is claimed. D189's remaining GPT integrated
  review 2, current CI, final Astra 3 and owner gates stay with root.

## 5. Fixtures, ports, processes and cleanup

- **Ports:** OS-assigned loopback only (run-03: 50213, 50136, 49318). 4747, 4748 and 11434 were
  refused by design and never contacted.
- **Ownership:** before any browser use, each `/healthz` `X-GraphGoblin-Pid` equalled the spawned
  PID (28644, 35980, 12896).
- **Shutdown:** each gateway got authenticated `GET` + `POST /system/shutdown {action:'drain'}` with
  its control token → 202 → exit 0. Afterwards each port was refused and each PID returned ESRCH.
  No fallback kill.
- **Browser:** Edge processes using the scratch profile (5 msedge + 1 identity_helper) → 0 after
  `browser.close()`.
- **Final external census** (`final-owned-process-check.json`):
  - All recorded run-01 and run-03 gateway/Edge PIDs are gone; no recorded port is listening.
    Run-01's Edge PIDs were not exposed by Playwright, but the same command-line census found 0
    owned processes before run-03 started.
  - The only command-line matches were the census's own `tee.exe` and PID 29204. PID 29204 is the
    root's `claude-bounded-runner.mjs` that launched this session; it predates my work and was not
    touched.
- **Scratch:** retained (disposable) at `G:/ggq/qa-scratch/i4-442-ui-qa`.
  - Stores, homes, gateway TEMP and probe dirs; unredacted gateway logs.
  - The baseline web copy, the browser profile root and the run-01 reconstruction script.
  - Per-attempt fixture call logs.
- **Key hygiene:** run-03's in-process scan found 0 hits for its 3 keys across all run files. A
  pattern scan of run-01 and scratch logs found no key material; no request URL carried a query
  string.
- **Preservation:** prior packet `i4-442-independent-01` (241 files) and the root freeze (19 files)
  are byte-identical before and after (`binding/preservation-check.json`). `BRIEF.md`, `spec.json`
  and `provider/` in this directory were not modified by me.

## 6. Attempts (all retained)

| Run | Outcome | Cause |
| --- | --- | --- |
| `run-01` | 19 PASS, 3 controls as predicted, **1 FAIL (C10 "restored: four fixture commands": 8)** | **Driver accounting error.** The API-key tab stayed open in the same browser context. On reconnect it also refetched: per-tab logs show exactly 1 GET from the main tab and 1 from the key tab at 11:50:21.30Z. The product's per-tab behaviour was correct (1 GET). Exact run-01 driver bytes were overwritten before I snapshotted them. `run-01/ui-qa.run-01.RECONSTRUCTED.mjs` is produced by `reconstruct-run01-driver.mjs`, which reverses the documented edits; its byte-exactness cannot be independently proven. Also: `browser.process()` returned no PID for the channel launch, so run-03 uses a command-line census instead. |
| `run-02` | Aborted at module start | My new self-copy `writeFileSync` ran before `mkdirSync(RUN)` (ENOENT). No gateway, browser, fixture call or store was created. |
| `run-03` | Complete: 20 PASS, 3 controls as predicted, 0 FAIL | Final changes from run-01, all instrumentation-only: key tab closed; context page count asserted; Edge census; server-log accounting; per-attempt scratch paths; self-copy; leak scan; absolute System32 PowerShell path. |

PLAN.md allowed at most 3 attempts; no further attempt was made.

## 7. Files

`PLAN.md` was written before execution. `REPORT.md` is this file. The scripts are `census.mjs`,
`fixture-codex.mjs` and `ui-qa.mjs` (the run-03 driver). `build-web-01.log` is the build log.
`static-asset-check.json` is C18. `binding/` holds the source, build, baseline, overlay and
preservation records. `run-01`/`run-02`/`run-03` hold the attempts. `final-owned-process-check.json`
is the final census. `MANIFEST.sha256.json` hashes every file here except `provider/` (harness-owned
and still being written) and itself.
