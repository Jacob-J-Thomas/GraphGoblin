# WP-A1 runtime, check caching and dependency evidence

## 1. Branch and worktree

Branch `codex-wp-a1-runtime-gates`; worktree `C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-a1-runtime-gates`; base `cfae6966029fe181c2064637c6ca8b2dfc31da37`. Uncommitted; ready for orchestrator commit after review and disposition of the unresolved items below. No staging, commits, branch changes, pushes or GitHub mutations were performed.

Evidence date: 2026-10-18 (America/Chicago). The locally selected gate runtime is Node 22.14.0; the default runtime is Node 23.10.0. The inspected `%APPDATA%/nvm` directory contains 22.14.0 and no Node 24. No runtime was installed or reconfigured. Raw command logs and append-only measurement records are under `C:\Users\98jak\AppData\Local\Temp\wp-a1-evidence`. Gate logs are authoritative for each command's child exit; a driver process finishing does not imply every child passed.

## 2. Per bolt

### #263: measured; runtime reconciliation implemented, qualification limitations remain

- One supported baseline: `.nvmrc` is 22 and root `engines.node` is `^22`. The installed pnpm 12 reported both spellings of engine-strict as undefined while the setting was only in `.npmrc`; after moving it to `pnpm-workspace.yaml` as `engineStrict: true`, the canonical getter reports true and Node 23 installation refuses before store access. The ignored `.npmrc` line was removed. CI reads `.nvmrc`; Docker remains `node:22-bookworm-slim`. Both installers require exactly major 22. API preflight, AGENTS, architecture, implementation-plan notes, README and the guide agree.
- Actual Node 22 gates: commands, child results and wall times are in section 5. Offline upgrade acceptance passed: 21 passed, 3 skipped, 0 failed, 1,992.022 seconds. The first build command passed by replaying 11 cached tasks; it is not fresh-build evidence. Final forced build with parent PATH explicitly selected: exit 0; 139.109 s; Cached: 0 cached, 11 total. Full forced typecheck/lint/coverage: exit 1; 3415.688 s; Cached: 0 cached, 43 total. The full gate remains failed; passing targeted verification does not erase its separate unresolved failures.
- Node 22 locked installation remains **unresolved**. The required command was repeated after loading the engine policy and was stopped by the sandbox store lock. `--store-dir` and read-only `--frozen-store` did not relocate that global lock. This is not a successful no-op installation. Node 23's engine refusal is now independently verified.

```text
ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK
Failed to open the store operation lock at
C:\Users\98jak\AppData\Local\pnpm-store-operation-locks\all-stores.lock:
Access is denied. (os error 5)
```

- Before the engine-policy correction, default Node 23 `pnpm check:deps` failed with the following error. It was reconfirmed after the final setting in `current-node23-deps-refusal`: exit 1; 7.593 s; not a Turbo task.

```text
ERROR: Your node version (23.10.0) is not supported. dependency-cruiser
       follows the node.js release cycle and runs on these node versions:
       ^22||^24||>=26
```

After loading pnpm 12's project setting, `pnpm.cmd install --frozen-lockfile` on Node 23 exits 1 in 1.942 seconds with the exact refusal payload:

```text
Error: ERR_PNPM_UNSUPPORTED_ENGINE

  × Unsupported engine for C:
  │ \Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-a1-
  │ runtime-gates: wanted: {"node":"^22"} (current: {"node":"23.10.0"})
```

- Both actual installers exit 1 on Node 23 before login, install, build or data-directory work. Exact shared refusal:

```text
==> Checking Node.js
error: Node.js v23.10.0 is unsupported; GraphGoblin needs Node 22 LTS. Select Node 22 on PATH and rerun this script.
```

- API preflight regression: the baseline run failed the Node 23/24 rejection cases (two failed, three passed, eighteen skipped). The final cases explicitly assert failure status, the Node 22 baseline message and PATH guidance. Final API coverage result is in section 5; no unrun test is represented as passing.

```text
 FAIL  src/preflight.test.ts > individual checks > refuses unsupported Node 23.10.0 with the supported baseline
AssertionError: expected { id: 'node', label: 'Node.js', …(2) } to match object { status: 'fail', …(1) }
+   "message": "Node 23.10.0",
+   "status": "ok",
 FAIL  src/preflight.test.ts > individual checks > refuses unsupported Node 24.0.0 with the supported baseline
AssertionError: expected { id: 'node', label: 'Node.js', …(2) } to match object { status: 'fail', …(1) }
+   "message": "Node 24.0.0",
+   "status": "ok",
```

- ADR-0040 records the engineering decision and its evidence limits. The #263 CHANGELOG bullet includes the owner's manual **Upgrade:** instruction.

- The first forced domain suite exposed six native adversarial cases using `node:module.registerHooks`, unavailable on Node 22.14 (the installed Node type declarations mark it since 22.15). Their source loader now uses the supported asynchronous `register` API through one shared bootstrap. The same real subprocesses, source imports, 128 MB heap caps, watchdogs and rejection/deadline assertions remain. `node22-domain-native`: exit 0; 29.016 s; not a Turbo task; 22 selected ADV-007 checks passed. No prior build or new dependency is required. Two separate upgrade-test timeouts remain recorded as observations.

### #127: confirmed and fixed; controlled cache evidence

The original configuration reproduced false greens in real engine exit tests and type-aware lint. Typecheck already had an effective `^build` edge and correctly failed the exported-type seed before the fix. The fix uses Turbo's documented no-op transit-node pattern: `transit -> ^transit`; `test`, `test:coverage`, `lint` and `typecheck` depend on local `transit`; typecheck retains `^build`.

| Controlled case                           | Before                                      | After                                       |
| ----------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Full engine coverage behavior             | exit 0; 1.656 s; Cached: 1 cached, 1 total  | exit 1; 49.485 s; Cached: 0 cached, 1 total |
| Engine behavior (`test`, five exit tests) | exit 0; 2.656 s; Cached: 1 cached, 1 total  | exit 1; 10.515 s; Cached: 0 cached, 1 total |
| Engine exported-type regression           | exit 1; 22.297 s; Cached: 1 cached, 3 total | exit 1; 13.188 s; Cached: 2 cached, 3 total |
| Engine type-aware lint regression         | exit 0; 1.922 s; Cached: 1 cached, 1 total  | exit 1; 58.187 s; Cached: 0 cached, 1 total |
| Coverage fixture direct dependency B      | exit 0; 2.547 s; Cached: 1 cached, 1 total  | exit 1; 4.359 s; Cached: 0 cached, 1 total  |
| Coverage fixture transitive dependency C  | exit 0; 1.562 s; Cached: 1 cached, 1 total  | exit 1; 2.594 s; Cached: 0 cached, 1 total  |
| Engine unrelated adapter control          | exit 0; 1.485 s; Cached: 1 cached, 1 total  | exit 0; 0.766 s; Cached: 1 cached, 1 total  |
| Coverage fixture unrelated D              | exit 0; 1.954 s; Cached: 1 cached, 1 total  | exit 0; 1.313 s; Cached: 1 cached, 1 total  |

Engine behavior command (identical warm/hit/seed/control arguments):

```powershell
pnpm.cmd exec turbo run test --filter=@graphgoblin/engine --concurrency=1 -- src/handlers/exit.test.ts --maxWorkers=1
```

The temporary domain `evaluateExpression` result became `WP-A1 behavioral seed`. Before, Turbo replayed five passing tests. After, three authored-return assertions failed:

```text
@graphgoblin/engine:test: AssertionError: expected { …(13) } to match object { status: 'succeeded', …(2) }
@graphgoblin/engine:test: +   "result": "WP-A1 behavioral seed",
@graphgoblin/engine:test: AssertionError: expected { …(13) } to match object { status: 'failed', …(2) }
@graphgoblin/engine:test: +   "result": "WP-A1 behavioral seed",
@graphgoblin/engine:test: AssertionError: expected { …(13) } to match object { status: 'exhausted', …(2) }
@graphgoblin/engine:test: +   "result": "WP-A1 behavioral seed",
Cached:    0 cached, 1 total
```

For the exported-type seed, domain's public entry point temporarily exported `threadView = 22`. The dependency builds are valid, but engine callers require a function. Typecheck failed before and after; cached lint passed before, then reran and failed after:

```text
@graphgoblin/engine:typecheck: src/handlers/common.ts(214,12): error TS2349: This expression is not callable.
@graphgoblin/engine:typecheck:   Type 'Number' has no call signatures.
@graphgoblin/engine:typecheck: src/handlers/decision.ts(18,16): error TS2349: This expression is not callable.
@graphgoblin/engine:typecheck:   Type 'Number' has no call signatures.
@graphgoblin/engine:typecheck: src/handlers/decision.ts(52,72): error TS2349: This expression is not callable.
@graphgoblin/engine:typecheck:   Type 'Number' has no call signatures.
@graphgoblin/engine:lint:   213:83  error  Unsafe argument of type `any` assigned to a parameter of type `Record<string, unknown>`  @typescript-eslint/no-unsafe-argument
@graphgoblin/engine:lint:   1896:7  error  This assertion is unnecessary since the receiver accepts the original type of the expression  @typescript-eslint/no-unnecessary-type-assertion
Cached:    0 cached, 1 total
```

The disposable coverage-task fixture is `A -> B -> C` plus unrelated D. A's Node assertion calls B's public entry point, which calls C's. It copies the unmodified HEAD configuration for before and working-tree configuration for after. Breaking B or C must produce a genuine assertion failure; D must retain a hit. Its script tests task invalidation, **not GraphGoblin coverage**:

```text
@wp-a1/a:test:coverage: AssertionError [ERR_ASSERTION]: dependency behavior must remain true
@wp-a1/a:test:coverage: false !== true
Cached:    0 cached, 1 total
```

The fixture needs no installed dependencies, uses relative fixture entry points, and disables pnpm's automatic pre-run installation only there. `.turbo` logs are ignored, as in the real repository, so generated logs cannot contaminate transit inputs. Initial fixture setup exposed the install-lock restriction and generated-log hash contamination; the table is the corrected controlled run with stable warm-hit and unrelated-hit controls. Earlier metadata rows are retained; reused fixture log names contain the latest controlled run.

The bounded full-engine coverage comparison completed with the exact command requested:

```powershell
pnpm.cmd exec turbo run test:coverage --filter=@graphgoblin/engine --concurrency=1
```

Original configuration warm/hit: exit 0; 38.906 s; Cached: 0 cached, 1 total; exit 0; 1.125 s; Cached: 1 cached, 1 total. Under the deliberate domain behavior seed: exit 0; 1.656 s; Cached: 1 cached, 1 total. With transit dependency hashing, healthy warm/hit: exit 0; 37.875 s; Cached: 0 cached, 1 total; exit 0; 1.984 s; Cached: 1 cached, 1 total; the same seed: exit 1; 49.485 s; Cached: 0 cached, 1 total. Unrelated adapter change: exit 0; 1.265 s; Cached: 1 cached, 1 total.

```text
@graphgoblin/engine:test:coverage:       Tests  455 passed (455)
Cached:    1 cached, 1 total
@graphgoblin/engine:test:coverage: AssertionError: expected 'WP-A1 behavioral seed' to be 42 // Object.is equality
@graphgoblin/engine:test:coverage: "WP-A1 behavioral seed"
@graphgoblin/engine:test:coverage: AssertionError: expected 'failed' to be 'succeeded' // Object.is equality
@graphgoblin/engine:test:coverage:       Tests  78 failed | 377 passed (455)
Cached:    0 cached, 1 total
Cached:    1 cached, 1 total
```

Earlier unseeded warm failures remain listed in section 8. They are timing observations that require separate disposition; this later bounded comparison was run to supply the explicitly requested cache evidence after the first forced full run independently executed and passed the engine suite. No thresholds, assertions or test source were weakened.

All source seeds were restored byte for byte in `finally` blocks. Domain and adapter source files have no final diff. Fresh build repairs generated output from the temporary exported-type build. The working cache is private to this worktree (`TURBO_CACHE_DIR=.turbo/wp-a1-cache`); default shared-worktree-cache writes were denied. No fake cache entries or altered assertions/thresholds were used.

CI retains `turbo run test:coverage --concurrency=1`. Transit nodes hash sources without executing dependency test/lint suites; executed coverage task count and serialization stay unchanged. Correct invalidation may do more work when dependencies change. No new CI wall-time measurement is claimed. Manual actual-Turbo proof is documented under CI gates instead of adding a JSON-shape test that only repeats the selected configuration.

`gh run view 37831911183 --log` succeeded: the historical log has Build `0 cached, 11 total`, Typecheck `9 cached, 20 total`, Lint `0 cached, 11 total`, and coverage `0 cached, 12 total`. It is still inspectable; that coverage run itself does not demonstrate a cached coverage false pass. Current controlled reproductions are the corrective evidence.

### #114: confirmed, unresolved; no compatible supported fix found

`pnpm audit --audit-level=high`: exit 0, one moderate finding. `pnpm audit`: exit 1, the same GHSA-67mh-4wv8-2f99. Advisory range: esbuild <=0.24.2; patched >=0.25.0.

| Installed esbuild | Path and scope                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.18.20           | infrastructure **devDependency** drizzle-kit 0.31.11 -> @esbuild-kit/esm-loader 2.6.5 -> @esbuild-kit/core-utils 3.3.2 -> esbuild ~0.18.20; affected |
| 0.25.12           | drizzle-kit 0.31.11 direct esbuild ^0.25.4; patched                                                                                                  |
| 0.28.2            | tsx 4.23.15 (API/client/web development tooling, Drizzle Kit, Vite 8.3.2); patched                                                                   |

`pnpm why esbuild -r --prod` returns no path. `pnpm audit --prod` reports no known vulnerabilities. Docker deploys production dependencies with `--prod`. These support no observed production dependency path; no production exploitation or running esbuild development server is claimed. The migration no-op gate exercises current schema tooling in disposable output.

Registry metadata reconfirmed stable `drizzle-kit` latest 0.31.11 (already installed), esm-loader latest 2.6.5 and core-utils latest 3.3.2. Their stable dependency chain still pins the affected minor. Newer Drizzle versions are 1.0 prereleases with a changed toolchain. An override from `~0.18.20` to >=0.25 crosses incompatible 0.x minor ranges; it is not the permitted version-compatible override. No speculative prerelease migration, forced override, audit suppression, dependency or lockfile change was made. The finding is present, not an absent-finding no-change success.

## 3. Files changed

- Root/runtime/tooling: `.nvmrc`, `package.json` engines, `.npmrc` (remove ignored engine setting), `pnpm-workspace.yaml` (loaded engine setting), `turbo.json`, `scripts/install.ps1`, `scripts/install.sh`, `AGENTS.md` runtime paragraph only, `README.md`, `CHANGELOG.md` (one top Unreleased bullet per bolt).
- API: `apps/api/src/preflight.ts`, `apps/api/src/preflight.test.ts`.
- Domain: `packages/domain/src/adversarial.test.ts`, native source-loader bootstrap only.
- CI shared file: `.github/workflows/ci.yml` changes **only** setup-node's version source to `.nvmrc`. Browser jobs, coverage scheduling and Offline upgrade acceptance are untouched.
- Docs: `docs/02-architecture.md` runtime row, `docs/12-implementation-plan.md` stale runtime note, `docs/guide/01-install-and-first-run.md`, new ADR-0040, this evidence record.
- Other worker ownership: `docs/10-testing-and-quality.md` receives one additive #127 caching subsection in WP-A2's CI section, plus a native-probe explanation under test layers. No WP-A2 browser material or other worker's source regions were edited.
- Dockerfile, dependency versions and lockfile are unchanged. Temporary scripts/logs/fixtures are outside the repository; generated cache/coverage/build output is ignored.

## 4. Tests

- Updated API public `checkNode` cases: Node 22 accepted (with/without `v`); 20, 23, 24 and malformed input refused with baseline/selection guidance. The baseline run demonstrably failed Node 23 and 24 rejection. Existing terminal-exit tests (five cases) provided a real dependent behavior probe; three fail under the seeded expression after the fix.
- Domain native adversarial probes failed six cases before the Node 22 loader correction and passed all 22 selected ADV-007 checks afterwards. Subprocess heap/time/watchdog limits and assertions are unchanged.
- Type/lint seeds and isolated direct/transitive fixture exercised real Turbo hashing/execution. They are controlled manual evidence, not newly committed unit tests or live-provider evidence.
- Engine unseeded coverage failures are retained in section 8. Coverage thresholds, exclusions, timeouts, performance assertions and repository worker defaults are unchanged.

Direct changed-package coverage, independently of Turbo's cache:

```text
API: exit 1; 156.829 s; not a Turbo task
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 612 passed | 2 skipped (616)
Domain: exit 0; 30.766 s; not a Turbo task
      Tests  537 passed (537)
Branches     : 95.55% ( 2151/2251 )
Lines        : 98.4% ( 1918/1949 )
```

The earlier forced API task passed all 614 enabled tests (two live skips) on the final preflight implementation and produced the following coverage. The subsequent direct run timed out in two separate tests and remains failed; the earlier pass is not used to erase it.

```text
@graphgoblin/api:test:coverage:       Tests  614 passed | 2 skipped (616)
@graphgoblin/api:test:coverage: Branches     : 93.46% ( 1229/1315 )
@graphgoblin/api:test:coverage: Lines        : 98.48% ( 1691/1717 )
```

Fresh coverage summaries produced during final verification (successful forced tasks or subsequent direct changed-package coverage; older artifacts are omitted):

| Package                  | Lines % | Branches % |
| ------------------------ | ------: | ---------: |
| `apps/mcp`               |   95.31 |      95.51 |
| `apps/plugin-codex`      |   95.23 |      95.45 |
| `packages/adapter-codex` |   99.64 |      97.89 |
| `packages/adapter-jev`   |   98.82 |      96.77 |
| `packages/api-client`    |     100 |      99.31 |
| `packages/contracts`     |   99.72 |      94.89 |
| `packages/domain`        |    98.4 |      95.55 |
| `packages/engine`        |   98.51 |      93.08 |

## 5. Gates

All supported gate commands select Node 22 first on PATH; local Turbo cache stays within the writable worktree. The unsupported-runtime rows intentionally select the default PATH. Results below are child exits, not driver exits.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Node      | Exit | Wall seconds |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---: | -----------: |
| `pnpm.cmd install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                               | v22.14.0  |    1 |        0.502 |
| `pnpm.cmd install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                               | v23.10.0  |    1 |        1.404 |
| `pnpm.cmd build`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | v22.14.0  |    0 |       19.079 |
| `pnpm.cmd test:upgrade`                                                                                                                                                                                                                                                                                                                                                                                                                                            | v22.14.0  |    0 |     1992.022 |
| `pnpm.cmd check:deps`                                                                                                                                                                                                                                                                                                                                                                                                                                              | v23.10.0  |    1 |        4.165 |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/preflight.test.ts -t Node`                                                                                                                                                                                                                                                                                                                                                                                 | v22.14.0  |    1 |      134.333 |
| `pnpm.cmd install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                               | v23.10.0  |    1 |        2.811 |
| `pnpm.cmd check:deps`                                                                                                                                                                                                                                                                                                                                                                                                                                              | v23.10.0  |    1 |        6.387 |
| `pnpm.cmd install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                               | v22.14.0  |    1 |        0.966 |
| `pnpm.cmd install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                               | v23.10.0  |    1 |        1.942 |
| `pnpm.cmd check:deps`                                                                                                                                                                                                                                                                                                                                                                                                                                              | v23.10.0  |    1 |        7.593 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1`                                                                                                                                                                                                                                                                                                                                                                                      | v23.10.0  |    1 |        2.640 |
| `C:\Program Files\Git\bin\bash.exe scripts/install.sh`                                                                                                                                                                                                                                                                                                                                                                                                             | v23.10.0  |    1 |        0.391 |
| `C:\Program Files\Git\bin\bash.exe -n scripts/install.sh`                                                                                                                                                                                                                                                                                                                                                                                                          | v22.14.0  |    0 |        0.093 |
| `pnpm.cmd audit --audit-level=high`                                                                                                                                                                                                                                                                                                                                                                                                                                | v22.14.0  |    0 |        6.148 |
| `pnpm.cmd audit`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | v22.14.0  |    1 |        3.992 |
| `pnpm.cmd audit --prod`                                                                                                                                                                                                                                                                                                                                                                                                                                            | v22.14.0  |    0 |        9.574 |
| `pnpm.cmd why esbuild -r`                                                                                                                                                                                                                                                                                                                                                                                                                                          | v22.14.0  |    0 |        1.555 |
| `pnpm.cmd why esbuild -r --prod`                                                                                                                                                                                                                                                                                                                                                                                                                                   | v22.14.0  |    0 |        5.005 |
| `pnpm.cmd format`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | v22.14.0* |    0 |      814.625 |
| `pnpm.cmd format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                            | v22.14.0* |    0 |      452.219 |
| `TURBO_FORCE=true pnpm.cmd build --concurrency=1`                                                                                                                                                                                                                                                                                                                                                                                                                  | v22.14.0  |    0 |      139.109 |
| `C:\Users\98jak\AppData\Roaming\nvm\v22.14.0\node.exe C:\Users\98jak\AppData\Local\Temp\wp-a1-built-smoke.mjs`                                                                                                                                                                                                                                                                                                                                                     | v22.14.0  |    0 |        8.078 |
| `pnpm.cmd --filter @graphgoblin/domain exec vitest run src/adversarial.test.ts -t ADV-007 --maxWorkers=1`                                                                                                                                                                                                                                                                                                                                                          | v22.14.0  |    0 |       29.016 |
| `pnpm.cmd exec turbo run typecheck lint test:coverage --force --concurrency=1 --continue=always`                                                                                                                                                                                                                                                                                                                                                                   | v22.14.0  |    1 |     3415.688 |
| `pnpm.cmd exec turbo run test:coverage --filter=@graphgoblin/tooling --force --concurrency=1 --env-mode=loose`                                                                                                                                                                                                                                                                                                                                                     | v22.14.0  |    0 |       25.797 |
| `pnpm.cmd typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                               | v22.14.0  |    0 |      183.297 |
| `pnpm.cmd lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | v22.14.0  |    0 |      286.813 |
| `pnpm.cmd check:layers`                                                                                                                                                                                                                                                                                                                                                                                                                                            | v22.14.0  |    0 |        0.641 |
| `pnpm.cmd check:migrations`                                                                                                                                                                                                                                                                                                                                                                                                                                        | v22.14.0  |    0 |        4.406 |
| `pnpm.cmd check:tokens`                                                                                                                                                                                                                                                                                                                                                                                                                                            | v22.14.0  |    0 |        4.391 |
| `pnpm.cmd check:deps`                                                                                                                                                                                                                                                                                                                                                                                                                                              | v22.14.0  |    0 |       54.750 |
| `pnpm.cmd check:templates`                                                                                                                                                                                                                                                                                                                                                                                                                                         | v22.14.0  |    0 |        5.734 |
| `pnpm.cmd check:licenses`                                                                                                                                                                                                                                                                                                                                                                                                                                          | v22.14.0  |    0 |        1.906 |
| `pnpm.cmd check:docs`                                                                                                                                                                                                                                                                                                                                                                                                                                              | v22.14.0  |    0 |        4.344 |
| `pnpm.cmd check:contrast`                                                                                                                                                                                                                                                                                                                                                                                                                                          | v22.14.0  |    0 |        2.156 |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                                                                                                                                                                                                                                                                                                                                                                                 | v22.14.0  |    1 |      156.829 |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                                                                                                                                                                                                                                                                                                                                                                              | v22.14.0  |    0 |       30.766 |
| `pnpm.cmd exec prettier --write .github/workflows/ci.yml AGENTS.md CHANGELOG.md README.md apps/api/src/preflight.ts apps/api/src/preflight.test.ts docs/02-architecture.md docs/10-testing-and-quality.md docs/12-implementation-plan.md docs/guide/01-install-and-first-run.md docs/decisions/ADR-0040-node-22-runtime-baseline.md docs/qa/2026-10-18-wp-a1-runtime-gates.md package.json packages/domain/src/adversarial.test.ts pnpm-workspace.yaml turbo.json` | v22.14.0  |    0 |        3.587 |
| `pnpm.cmd exec prettier --check .github/workflows/ci.yml AGENTS.md CHANGELOG.md README.md apps/api/src/preflight.ts apps/api/src/preflight.test.ts docs/02-architecture.md docs/10-testing-and-quality.md docs/12-implementation-plan.md docs/guide/01-install-and-first-run.md docs/decisions/ADR-0040-node-22-runtime-baseline.md docs/qa/2026-10-18-wp-a1-runtime-gates.md package.json packages/domain/src/adversarial.test.ts pnpm-workspace.yaml turbo.json` | v22.14.0  |    0 |        3.306 |
| `git -c safe.directory=C:/Users/98jak/source/repos/GraphGoblin/.claude/worktrees/codex-wp-a1-runtime-gates diff --check`                                                                                                                                                                                                                                                                                                                                           | v22.14.0  |    0 |        0.265 |

*Early Python metadata queried bare `node` with a child environment, but Windows executable lookup selected the parent default Node 23. Native `pnpm exec node` under the identical child environment reports 22.14.0 at the installed Node 22 path; the inspected tool CMD shims use PATH and `.bin/node.exe` is absent. `runtime-launcher-probe.json` records both observations. The early format rows' reporter field is corrected here with that explicit provenance; raw parent-probe fields are retained. The build was rerun with Node 22 selected before Python started, and all later gate launchers also set their own parent PATH. The old reporter-labelled build (exit 0, 276.172 s) is not used as the canonical build result.

Final forced task summary:

```text
@graphgoblin/tooling#test:coverage:  ERROR  command (C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-a1-runtime-gates\tooling) C:\nvm4w\nodejs\pnpm.cmd run test:coverage exited (1)
@graphgoblin/domain#test:coverage:  ERROR  command (C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-a1-runtime-gates\packages\domain) C:\nvm4w\nodejs\pnpm.cmd run test:coverage exited (1)
@graphgoblin/infrastructure#test:coverage:  ERROR  command (C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-a1-runtime-gates\packages\infrastructure) C:\nvm4w\nodejs\pnpm.cmd run test:coverage exited (1)
@graphgoblin/web#test:coverage:  ERROR  command (C:\Users\98jak\source\repos\GraphGoblin\.claude\worktrees\codex-wp-a1-runtime-gates\apps\web) C:\nvm4w\nodejs\pnpm.cmd run test:coverage exited (1)
 Tasks:    39 successful, 43 total
Cached:    0 cached, 43 total
  Time:    56m54.435s
Failed:    @graphgoblin/domain#test:coverage, @graphgoblin/infrastructure#test:coverage, @graphgoblin/tooling#test:coverage, @graphgoblin/web#test:coverage
```

An earlier `TURBO_FORCE=true pnpm.cmd check` attempt was interrupted during lint after fresh typechecking while shared-cache writes were denied; it is not a successful full check. Its wrapper was interrupted before recording a stopwatch result. Final forced verification uses one Turbo task at a time and continues through independent failures to retain all results. No broader browser suite was run: web source, routes and schemas were unchanged. No paid provider turns or owner application operations were run.

The complete strict-environment forced pass exposed the Node 22 native-loader failures above and a sandbox Git ownership failure in `tooling/scripts/dockerignore.test.mjs:70`. Turbo omitted the outer Git trust environment, and the test's real `git ls-files` could not read the user-owned worktree. A Node 22 probe with a per-process safe.directory for exactly this worktree succeeded and listed 908 tracked source files. One scoped tooling follow-up uses `--env-mode=loose` with only Windows essentials, PATH, the private cache, `LIVE=0`, and that one current-worktree Git setting. No persistent/global Git configuration, credential environment, source assertions or CI configuration were changed. An initially planned broad repeated full pass was cancelled while its waiter was idle, before any child began. Remaining verification is direct coverage for the changed packages and the scoped tooling check; unchanged infrastructure/web failures require separate disposition. Earlier failures remain in the table.

## 6. Docs

Runtime instructions and numbered docs are reconciled; ADR-0040 records the baseline and evidence limits; the CI-gates subsection preserves the manual cache proof. CHANGELOG contains #263's **Upgrade:** note, #127's behavior fix and #114's explicit unresolved finding. Generated references require no schema/route update; `check:docs` result is reported above.

## 7. Decisions and parameters

- Node 22 major baseline with locally tested 22.14.0 and CI 22.x; `^22` permits maintenance releases without claiming each patch independently tested. Loaded pnpm 12 workspace engineStrict plus explicit installer/preflight checks avoids a redundant preinstall dependency. Native probes use one supported `module.register` loader, not a runtime-version compatibility branch.
- Transit nodes preserve source-based parallel test/lint execution and existing typecheck builds. Default package inputs are retained; no broad global input list makes unrelated packages invalidate every task.
- Probe workers are limited to one to bound local pressure. Repository test defaults, budgets and thresholds are unchanged. Full forced gates use Turbo concurrency one; this is a run parameter, not a product-policy change.
- A development-only installed vulnerability remains reportable. Cross-minor esbuild overrides and prerelease Drizzle migration were not treated as supported compatible fixes.

## 8. Caveats and open items

- Node 22 locked install/no-op verification remains blocked by the global operation-lock path outside sandbox writable roots. The orchestrator must run that required locked install in an environment that can open the lock. The native pnpm Node 23 engine refusal and both installer refusal messages are verified above.
- #114 remains unresolved and must not be closed as absent/fixed. A compatible upstream release or separately qualified toolchain change is needed.
- Observed outside scope, with no fix or retry-to-green claim: `packages/engine/src/edge-cases.test.ts:656` timed out at 5 s in the first unseeded warm. With one worker, `packages/engine/src/recovery.test.ts:607` measured 2,981.46 ms against <2,000 ms and `packages/engine/src/run-manager.test.ts:171` saw one decision against an expectation of >1 within a 200 ms timer window. These were not seeded. They are observed timing failures, not a demonstrated Node-runtime root cause. Fresh final results do not erase them.
- The first forced domain suite also timed out in `packages/domain/src/upgrade.test.ts:62` and `:199` at the existing 5 s limits. Those conversion paths/budgets were not changed; the deterministic native-loader incompatibility was fixed separately.
- The requested full-engine coverage cached-pass seed and unrelated-change cache hit are demonstrated above; earlier unseeded timing failures remain unresolved observations.
- Offline upgrade has three host capability skips (file symlinks), with directory-junction refusal covered. No Node 24 installation or owner runtime/app/store changes occurred.
- Independent Claude Opus 5.5 review remains with the orchestrator. Ignored `.turbo/wp-a1-cache`, coverage/build output and temporary evidence are retained; this worker does not delete generated directories. Source restoration and final generated output are checked separately before handoff.

Final handoff verification: `git diff --check` passed. The dependency expression and Turbo configuration match their pre-probe backups byte for byte; domain/adapter seed entry points have no diff. The fresh built-output smoke verifies the function export and original expression result after the exported-type build was repaired; subsequent coverage probes did not build dependency outputs. The handoff snapshot records 20 changed/untracked files, no staged files, the original branch and base HEAD. All final format-supported changed files passed the delta Prettier check after the full repository format/format-check pair. Logs and `handoff-state.json` are retained in the evidence directory.

Failure inventory from the initial strict forced run (raw log `final-forced-gates.log`; includes the in-scope native-loader defect fixed above and separate observations outside scope):

- `@graphgoblin/domain`: src/adversarial.test.ts > adversarial domain invariants > ADV-007: JSONata native regex is bounded by its expression timeout (src/adversarial.test.ts:118:20); expected 'exit:1:file:///C:/Users/98jak/source/…' to match /^exit:0:.*can run without bound/.
- `@graphgoblin/domain`: src/adversarial.test.ts > adversarial domain invariants > ADV-007 review: 10 nested failing $evals stay small in a 128 MB process (see raw log); see raw log for grouped parameter-case failure.
- `@graphgoblin/domain`: src/adversarial.test.ts > adversarial domain invariants > ADV-007 review: 20 nested failing $evals stay small in a 128 MB process (see raw log); see raw log for grouped parameter-case failure.
- `@graphgoblin/domain`: src/adversarial.test.ts > adversarial domain invariants > ADV-007 review: 30 nested failing $evals stay small in a 128 MB process (src/adversarial.test.ts:230:29); expected 1 to be +0 // Object.is equality.
- `@graphgoblin/domain`: src/adversarial.test.ts > adversarial domain invariants > ADV-007 review: nested-alternative is rejected in an isolated process (see raw log); see raw log for grouped parameter-case failure.
- `@graphgoblin/domain`: src/adversarial.test.ts > adversarial domain invariants > ADV-007 review: runtime-eval is rejected in an isolated process (src/adversarial.test.ts:289:29); expected '' to match /^rejected:.*can run without bound/.
- `@graphgoblin/domain`: src/upgrade.test.ts > offline v1 authoring conversion > converts a singleton codex without changing edge ids/waypoints (src/upgrade.test.ts:62:42); Test timed out in 5000ms..
- `@graphgoblin/domain`: src/upgrade.test.ts > offline v1 authoring conversion > uses real frozen AIDLC exports as refusal inputs, never selected-first fallbacks (src/upgrade.test.ts:199:3); Test timed out in 5000ms..
- `@graphgoblin/infrastructure`: src/adversarial.test.ts > adversarial infrastructure invariants (forks pool) > 6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild (src/adversarial.test.ts:225:3); Test timed out in 30000ms..
- `@graphgoblin/infrastructure`: src/claude/process.test.ts > owned native Claude process transport > kills on deadline and output overflow (see raw log); EBUSY: resource busy or locked, rmdir 'C:\Users\98jak\AppData\Local\Temp\gg-claude-process-TcZ313'.
- `@graphgoblin/infrastructure`: src/claude/process.test.ts > owned native Claude process transport > does not spawn for an already aborted signal and cancels a running process (see raw log); EBUSY: resource busy or locked, rmdir 'C:\Users\98jak\AppData\Local\Temp\gg-claude-process-BMGw9t'.
- `@graphgoblin/infrastructure`: src/claude/process.test.ts > owned native Claude process transport > kills the descendant that a long-lived child started (src/claude/process.test.ts:146:46); expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' // Object.is equality.
- `@graphgoblin/infrastructure`: src/claude/process.test.ts > owned native Claude process transport > kills the descendant that a long-lived child started (see raw log); EBUSY: resource busy or locked, rmdir 'C:\Users\98jak\AppData\Local\Temp\gg-claude-process-9qtGbh'.
- `@graphgoblin/infrastructure`: src/process/scripts.test.ts > ProcessScripts > kills the process tree on timeout (src/process/scripts.test.ts:54:3); Test timed out in 15000ms..
- `@graphgoblin/infrastructure`: src/process/scripts.test.ts > ProcessScripts > kills the process when the signal aborts, including when already aborted (src/process/scripts.test.ts:65:3); Test timed out in 15000ms..
- `@graphgoblin/infrastructure`: src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > deletes all history and configured templates, converts definitions, retains signing identities/secrets/settings, and starts through ordinary migrations (src/sqlite/upgrade.test.ts:118:3); Test timed out in 20000ms..
- `@graphgoblin/infrastructure`: src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary queued runs without cancelling them (src/sqlite/upgrade.test.ts:205:54); Test timed out in 20000ms..
- `@graphgoblin/infrastructure`: src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > requires every hash-bound review, binds repeated nodes to their stored version, and rejects stale/unused resolutions (src/sqlite/upgrade.test.ts:230:3); Test timed out in 20000ms..
- `@graphgoblin/infrastructure`: src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > refuses changed source, damaged SQL/ledger, malformed template identities and invalid definitions (src/sqlite/upgrade.test.ts:302:3); Test timed out in 20000ms..
- `@graphgoblin/infrastructure`: src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > refuses invalid/conflicting owner defaults: UPDATE settings SET value='not JSON' (see raw log); see raw log for grouped parameter-case failure.
- `@graphgoblin/infrastructure`: src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > refuses invalid/conflicting owner defaults: INSERT INTO settings VALUES ('local','defaultModel','"unknown"','2026-10-17T00:00:00.000Z') (src/sqlite/upgrade.test.ts:432:5); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/DecisionAuthoring.test.tsx > decision authoring checkpoint > keeps row ownership through invalid ids, reorders and labels, and reviews removal before one undoable edit (src/editor/DecisionAuthoring.test.tsx:532:3); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/DecisionAuthoring.test.tsx > decision authoring checkpoint > refuses a many-route Noul conversion, then preserves ids in an incomplete Score form (src/editor/DecisionAuthoring.test.tsx:570:3); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/EditorPage.restore.test.tsx > restoring a set-aside copy > converts a v1 draft, archives the exact original and requires explicit first-save overwrite (src/editor/EditorPage.restore.test.tsx:123:25); Unable to find role="heading" and name "legacy device copy".
- `@graphgoblin/web`: src/editor/EditorPage.test.tsx > EditorPage > describes valid pending JSON accurately and refuses Publish until applied or cancelled (src/editor/EditorPage.test.tsx:54:18); Unable to find an element with the text: Ready to publish. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible..
- `@graphgoblin/web`: src/editor/EditorPage.test.tsx > EditorPage > edits loop settings, variables, node ids, and edges (src/editor/EditorPage.test.tsx:1151:3); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/EditorPage.test.tsx > EditorPage > applies an id typed in the dialog when it closes, and stops once for an id that cannot apply (src/editor/EditorPage.test.tsx:1222:88); expected false to be true // Object.is equality.
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog evaluator-specific decisions > authors and saves a new llm decision from the default editor fields (see raw log); see raw log for grouped parameter-case failure.
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog evaluator-specific decisions > authors and saves a new classifier decision from the default editor fields (src/editor/NodeEditorDialog.test.tsx:112:56); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog disclosures across undo and redo > keeps Advanced open through an undo and a redo of a basic picker, with focus restored (src/editor/NodeEditorDialog.test.tsx:521:3); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog disclosures across undo and redo > keeps opened and added list items open through an undo and a redo (src/editor/NodeEditorDialog.test.tsx:571:3); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog disclosures across undo and redo > redoing removal from an injected message focuses the surviving operation header (open: false) (see raw log); see raw log for grouped parameter-case failure.
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog disclosures across undo and redo > redoing removal from an injected message focuses the surviving operation header (open: true) (src/editor/NodeEditorDialog.test.tsx:741:25); Test timed out in 20000ms..
- `@graphgoblin/web`: src/editor/NodeEditorDialog.test.tsx > NodeEditorDialog disclosures across undo and redo > undoing an injected message add returns to its surviving operation collection (src/editor/NodeEditorDialog.test.tsx:780:3); Test timed out in 20000ms..
- `@graphgoblin/web`: src/forms/saved-values.test.tsx > the same edits save the same config > inference: basic, split, and advanced fields (src/forms/saved-values.test.tsx:72:3); Test timed out in 20000ms..

The initial web run also had three worker-start errors for `apps/web/src/forms/structure.test.tsx`, `apps/web/src/lib/reachability.test.ts` and `apps/web/src/settings/sections/ApiKeysSection.test.tsx`. Its final result was 5 failed / 108 passed files, 14 failed / 1,408 passed tests, three unhandled errors.

Subsequent direct changed-package failures, if any:

- `final-api-coverage`: src/container.test.ts > configuration admission before startup writes > reads existing manual catalog entries without changing database bytes or rows on invalid effort (src/container.test.ts:411:3); Test timed out in 20000ms..
- `final-api-coverage`: src/routes/templates.test.ts > template API without runtime authority > reads only manifests without provider, script or credential probes (src/routes/templates.test.ts:19:3); Test timed out in 20000ms..

No domain coverage-test failure block captured; see its exact command result.

Final scoped tooling verification:

exit 0; 25.797 s; Cached: 0 cached, 1 total. This checks the environment correction only and does not make the full gate green.
