# #442 independent integrated UI/browser QA — declared plan and finite predictions

Independent behaviour QA by actual Claude Code Opus 5.5 (xhigh), in a fresh context. Not the UI
author, not formal review, not CI, not final audit, not owner/human acceptance. Written before
any build, overlay or browser execution.

## Documents read before planning

AGENTS.md; docs/README.md; docs/15-issue-workflow.md; register
`docs/delivery/2026-11-17-five-intents-register.md` (Intent 4, U4.8/#442); D175, D185, D189
(Q/decision-17x/18x.md, hashes recorded in the manifest); candidate docs09 "Claude readiness and
saved selections"; prior backend packet `i4-442-independent-01` PLAN/REPORT/fixture-cli.mjs/
public-qa.mjs/backend-source-build-binding.json (background only, read-only); root freeze receipt
`i4-442-ui-root-freeze-01/receipt.json`; web `e2e/readiness.spec.ts`, `e2e/responsive.spec.ts`,
`e2e/fixtures.ts`, `e2e/server.ts`, `e2e/global-setup.ts`, `playwright.config.ts`; candidate
`PreflightSection.tsx`; `packages/domain/src/readiness.ts`; Codex CLI preflight classification
(`packages/adapter-codex/src/cli.ts`); `/harness/preflight` route; QueryClient defaults;
`C:/Users/98jak/.codex/skills/playwright/SKILL.md`.

## Contract under test (D175 + D189 + candidate docs09)

In Settings → Harness preflight, each Codex row shows the shared domain constant
`CODEX_PLUGIN_OBSERVABILITY_NOTICE` as one muted paragraph (`text-xs text-muted`) after any actual
problems, outside the problems list, in every Codex readiness state; `codex plugin list --json` and
`codex mcp list --json` render as `<code>`; words exactly the shared text. Other harness rows never
show it. Badge label/tone/icon, version, problems, Retry and the single preflight query are
unchanged; initial loading and request-error views are unchanged; the card keeps its one existing
`role=status` (Rechecking…/Offline) live region and the notice adds none. The notice makes no
request. Backend `plugins.codex` system warning (success-only) is not part of this UI and is not
retested (prior packet). D189 records that the earlier backend-review Ready-only UI checklist was
a coordinator mistake; I evaluate the all-states contract.

## Source binding plan and a declared deviation

Pre-check done: QA checkout `G:/ggq/gg-i4-442-qa/GraphGoblin` clean, detached at
`5b0d806c75d409c33a57ea54ffda45e2f89bc500`, tree `8e24c697b40eb1a4ab4cd81f481fce53494a2ce7`.

**Deviation:** `git cat-file -t 39304c07…` fails in the QA checkout: the candidate commit object is
absent (origin is the author checkout; Git fetch is prohibited). `git checkout --detach 39304c07`
is therefore impossible without a fetch. I will not fetch, bundle, or copy objects. Instead:

1. Read the candidate's exact committed bytes read-only from the author checkout's object store
   (`GIT_OPTIONAL_LOCKS=0 git show 39304c07:<path>`). Author `diff --raw 5b..39304c07` lists exactly
   4 modified paths (no adds/deletes/mode changes); both repos have identical 5b tree `8e24c697`.
2. Overwrite those 4 working-tree files in the QA checkout (all `text=auto eol=lf`, no filters,
   so blob bytes == working-tree bytes).
3. Verify each file: `git hash-object` (no `-w`) equals the candidate blob id from author
   `ls-tree`, and SHA-256 equals root receipt. `git status` must list exactly those 4 paths
   modified, nothing else. Therefore tracked working-tree content == candidate tree `f5d9abae…`.
4. HEAD stays `5b0d806c`; no index/commit/ref/object writes. The overlay is left in place after QA
   (the rebuilt web output corresponds to it); `git checkout -- <4 paths>` reverses it.

One unintended owner-adjacent write risk already occurred during reading: a single
`git status --porcelain` in the author checkout (before I switched to `GIT_OPTIONAL_LOCKS=0`) may
have refreshed that worktree's index stat cache; it changes no content. Reported as-is.

## Build plan (one incremental build)

Before building: hash all 1,271 built outputs and compare with the prior binding (expect identical);
copy the retained 5b `apps/web/dist` (28 files) to scratch as a **baseline control build** and verify
hashes against the prior binding. Then one `pnpm.cmd build` (Node v22.23.4, pnpm 12.8.1) with
TEMP/TMP set only for that process to G scratch, telemetry disabled for that process.

Prediction: Turbo reports 12 tasks; 9 cache hits (backend/domain/etc., inputs unchanged), web cache
miss (rebuilt), plugin-codex/plugin-claude uncacheable (re-run). Non-web outputs byte-identical to
the prior binding; `apps/web/dist` changes; `dist-goblin` predicted unchanged (does not import
Settings). Report actual cache lines and output diffs, whatever they are.

Static built-asset prediction: the candidate web bundle contains the full notice sentence exactly
once (shared constant, no copied text); the baseline 5b web bundle contains it zero times.

## Execution harness (independently authored)

- `fixture-codex.mjs`: harmless Codex CLI stand-in. Accepts only `--version`, `exec --help`,
  `exec resume --help`, `login status`; logs pid/ppid/argv/cwd/mode/timestamps; rejects anything
  else with exit 97 (so plugin/MCP inventory or worker commands would be visible). Modes: ready,
  auth, quota, transport, unknown, incompatible; optional delay on `--version`. Never contacts a
  provider.
- `ui-qa.mjs`: driver using the repo-installed Playwright 1.63.0 library (the skill's CLI route
  needs an npx download of `@playwright/cli`, not installed, so not applicable). Browser: system
  Edge via `channel: 'msedge'` (the repo's documented Windows default; Playwright's expected
  Chromium 1243 is not installed and will not be downloaded), headless, disposable profile under G
  scratch TEMP, service workers blocked (deterministic network accounting; documented limit).
- Real built production gateway `apps/api/dist/main.js` (normal startup composition), disposable
  store, `GG_REQUIRE_API_KEY=true`, disposable key created with the built `--create-api-key` CLI and
  entered through the real "API key required" panel; `GG_CODEX_BINARY` → fixture;
  `GG_CLAUDE_BINARY` → absent path; `GG_OLLAMA_ENABLED=false`; env allowlist with HOME/USERPROFILE/
  APPDATA/LOCALAPPDATA/CODEX_HOME/TEMP/TMP → G scratch. No product flags, no source edits.
- Labels: **NATIVE** = real browser → real HTTP → built gateway → real child-process spawn of the
  fixture. **INTERCEPT** = Playwright `page.route` fulfilling/aborting `/harness/preflight` in the
  browser (backend not consulted). **DOM-CONTROL** = in-page mutation of the rendered candidate to
  prove checker sensitivity. **BASELINE** = retained pre-#442 5b production web build served by the
  same gateway (natural missing-notice control).

## Declared cases and predictions

Session S0 — BASELINE build (5b web), NATIVE backend:
- B1 Ready: badge Ready/good, v0.160.0, no problems; checker reports exactly one violation class,
  notice missing. 1 `GET /harness/preflight` on load; 4 fixture commands.
- B2 Retry → auth: Sign-in needed/bad + exact problem; only violation notice missing. Region HTML
  stored for C2/C4 comparison.
- B3 Loading (fixture delay): "Loading preflight…", no badge; region HTML stored.
- B4 First-load request failure (INTERCEPT 503): "Could not load preflight"; region HTML stored.
- B5 320 px page geometry at Ready (attribution for any pre-existing page overflow).

Session S1 — CANDIDATE build, NATIVE unless labelled:
- C1 Loading: "Loading preflight…", no `[data-state]`, no notice, no Ready anywhere in card, Retry
  disabled; then Ready + notice. Region HTML during loading == B3.
- C2 Ready (1440): notice text === constant (independent literal and built domain export agree);
  exactly 2 `<code>` with the two commands; class `text-xs text-muted`; direct child of Codex `li`,
  after header, not inside any `ul`, no role/aria-live; exactly 1 notice page-wide; Claude
  (cli-missing) and Ollama (unknown) rows have none; card has exactly 1 live region; response
  `authenticated:true`. Region HTML minus notice == B1. Screenshot + ARIA snapshot.
- C3 Retry while Ready (fixture delay): exactly 1 GET, 4 fixture commands, "Rechecking…" in the
  one status region, Ready kept, Retry disabled, notice count 1 during and after.
- C4 Retry → auth (NATIVE negative path): Sign-in needed/bad; problem "Codex sign-in is missing or
  invalid. Run codex login, then retry preflight." in `ul` before notice; response
  `authenticated:false`; Defaults says "Codex readiness: Sign-in needed. See Harness preflight
  below." without notice. Region HTML minus notice == B2. Screenshot + ARIA snapshot.
- C5 Retry → ready (restoration): Ready, no problems, notice once, `authenticated:true`.
- C6–C9 Retry → quota / transport / unknown / incompatible: labels Usage limit/warn, Connection
  failed/warn, Unknown/warn, CLI update needed/bad; exact domain problem text; notice after
  problems once. Commands 4/4/1/2.
- C10 Offline (browser `setOffline`): Retry → "Offline; showing the last check.", last Ready kept,
  notice once, still 1 card live region, 0 HTTP, 0 fixture commands; back online → exactly 1 GET,
  status cleared, Ready + notice.
- C11 Retry request failure (INTERCEPT 503): "Rechecking…" then "Could not load preflight", no
  badge/notice/Ready in card, Defaults "Could not check Codex readiness."; predicted 2 intercepted
  GETs (existing `retry: 1`), 0 fixture commands; unroute + Retry → NATIVE Ready restored (1 GET).
- C12 First-load request failure (INTERCEPT 503): error view, no notice/Ready; region HTML == B4.
- C13 INTERCEPT multi-harness: (a) Codex/Claude(claude.ai, authenticated)/Ollama all Ready → one
  notice, Codex only; "Signed in with Claude.ai." shown; (b) Codex auth with two problems → notice
  after both.
- C14 INTERCEPT Codex absent (Claude + Ollama only) → zero notices.
- C15 Layout (NATIVE, Ready and auth; dark and light themes): 1440, 375, 320 and 200%-zoom
  equivalent (512×384 CSS px, the repo's own 1024×768@200% method). No page/card horizontal
  overflow attributable to the notice; notice and code boxes inside card and viewport; wrapped line
  counts recorded; notice contrast ≥ 4.5:1 (prediction) for 12 px text. Screenshots: ready-1440,
  auth-1440, ready-320, auth-320, ready-375, ready-zoom200, ready-light.
- C16 `reducedMotion: 'reduce'`: notice identical, visible, no animations; default root font size
  recorded (no other font-size claim).
- C17 DOM-CONTROL: mutate rendered notice to failure tone + `role="alert"`; checker must flag tone
  and extra live region; reload restores.
- C18 Static built-asset check as above.
- Read-only scope: every browser request in S0–S2 is GET (no settings/policy writes); `GET /settings`
  identical at session start and end; fixture log contains only the 4 allowed commands; zero
  `/system/preflight` requests from Settings.

Session S2 — CANDIDATE, gateway with `GG_CODEX_BINARY` → absent `.exe`:
- M1 NATIVE cli-missing: CLI not found/bad; "Codex CLI was not found. Install the Codex CLI or set
  GG_CODEX_BINARY, then retry preflight."; notice after problem once; 0 fixture commands.

Totals: 5 baseline + 18 candidate + 1 missing-binary = 24 declared cases.

## Resource ownership and lifecycle

- Scratch (all disposable, retained): `G:/ggq/qa-scratch/i4-442-ui-qa/` (temp, home, stores,
  fixture state/log, baseline web copy, browser profiles, logs).
- Evidence: this directory only; `provider/` belongs to the launching harness and is not touched.
- Ports: OS-assigned free loopback ports, refusing 4747/4748/11434; `/healthz`
  `X-GraphGoblin-Pid` must equal my spawned PID before any browser use.
- Every HTTP call bounded by timeouts; gateway start ≤ 30 s; whole driver watchdog 15 min.
- Shutdown: authenticated `GET /system/shutdown` + `POST /system/shutdown {action:'drain'}` with
  control token → 202 → exit 0; then port refused and PID absent. Browser closed; final command-line
  census for anything referencing the scratch root must be empty. Fallback kill only of an exact
  owned child handle; no name-based cleanup; never touch owner/other processes.
- At most 3 driver attempts; every attempt directory, failure and log retained.
- No owner store/config/credentials/plugins/services, ports 4747/4748, Ollama 11434, provider
  turns, plugin repair, GitHub, fetch, index, commit or push. Prior packet
  `i4-442-independent-01` hashed before and after; must be unchanged.
- Synthetic QA API keys never written to evidence (headers not recorded; key-creation stdout
  redacted); final scan of evidence for each key string.

## Verdict rule

PASS only if every declared candidate criterion holds; CONDITIONAL if criteria hold but with a
material limit or a non-#442 finding that needs a root decision; FAIL on any concrete defect in the
selected contract. Baseline B1/B2 "notice missing" are expected control outcomes, not failures.
