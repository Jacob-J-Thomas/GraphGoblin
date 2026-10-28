SIGN-OFF: WP-424 at af3b6ebc91c1b60faa438721088cb31a557c9268 may merge.

# Independent review of WP-424 (#424): the seeded Jev key's logged source

Reviewed commit `af3b6ebc91c1b60faa438721088cb31a557c9268` (branch `codex-wp-424-jev-log`, checked out detached) against base `a4fee9a9`. The reviewer changed no product code or tests and committed nothing. The three findings below are all P3 and none blocks the merge. Finding 1 is a two-sentence doc fix that the orchestrator can apply before merging.

Runtime: Node `v22.23.4` at `%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe`, pnpm `12.8.1`. `pnpm install --frozen-lockfile` ran once in the review worktree. The inherited `JEV_API_KEY` (the owner's) was unset for every command. The only `GG_*` variables set were `GG_TEST_PORT_START=7460` and `GG_TEST_PORT_COUNT=40`, plus each gateway's own variables listed below. Ports 6340 to 6345 and `%TEMP%\gg-rev424-*` were used. Real provider turns: **0**.

## Findings

1. **P3: the re-seed sentences still name only `GG_JEV_API_KEY`.** The code re-seeds a deleted `jev-api-key` from `JEV_API_KEY` when `GG_JEV_API_KEY` is unset, which is how the owner's store is set up. Three sentences still say only `GG_JEV_API_KEY` re-seeds it:
   - `docs/guide/06-settings-and-secrets.md` line 165 (a file this change touched): "startup re-seeds it if `GG_JEV_API_KEY` is set".
   - `docs/09-frontend-and-pwa.md` line 247: "If `GG_JEV_API_KEY` is set at startup, the deleted `jev-api-key` secret is re-seeded at the next server start."
   - The Settings deletion confirmation, `apps/web/src/settings/sections/SecretsSection.tsx` lines 152 to 154: "If GG_JEV_API_KEY is set, startup re-seeds the deleted secret at the next server start."

   This text predates the change, but an operator who deletes the secret in Settings is told that the key returns only under a variable they may not have set. That is the same confusion #424 fixes in the log. Suggested fix: "if `GG_JEV_API_KEY` is set, or `JEV_API_KEY` when `GG_JEV_API_KEY` is unset". The two doc sentences can change in this branch. The dialog text sits in `apps/web/src/settings/*`, which this wave assigns to #205, so it is a follow-up or a coordinated edit; the `SettingsPage.test.tsx` line 241 assertion (`toHaveTextContent('GG_JEV_API_KEY')`) would still pass.

   Optional in the same edit: `docs/06-harness-integration.md` and `docs/guide/01-install-and-first-run.md` say "A fresh store seeds…". Seeding actually happens whenever the secret is absent, including after a deletion, as `docs/11` and the guide/06 paragraph say. "When the secret is absent" would be more exact.

2. **P3: the implementer's record now overstates one thing.** `README.md` line 3 says "Changes are uncommitted for orchestrator review and commit". They are now committed as `af3b6ebc`. Update that sentence when this review is copied to the branch.

3. **P3 (note, no change asked): the "red before" claim holds for three of the four new expectations, not every case.** The four failing expectations listed under "Tests and red before" are real. The neither-variable, empty-value and `GG_JEV_API_KEY` container cases pass on `main` too, because `main` already behaved correctly there. They are controls, and the implementer's record says so accurately ("Neither-variable and primary-log controls already passed"). Recorded so nobody reads the brief's "red-before … for neither" as having been met by a failing test. No such test can exist, since `main` was already right for that case.

## Correctness review (`apps/api/src/config.ts`, `container.ts`)

- **Precedence:** `value = e.GG_JEV_API_KEY ?? env.JEV_API_KEY` and `source = e.GG_JEV_API_KEY !== undefined ? 'GG_JEV_API_KEY' : 'JEV_API_KEY'` use the same test, so the source always names the variable the value came from. `GG_JEV_API_KEY` wins when both are set (unit case 3, container test with `JEV_API_KEY: 'unused-key'`, gateway d1).
- **Empty values:** an explicitly empty `GG_JEV_API_KEY` gives `'' ?? …` = `''`, which is falsy, so there is no `jevApiKey` and the fallback is suppressed (unit case, container case, gateway e1). An empty `JEV_API_KEY` alone also seeds nothing.
- **Existing secret:** the guard `config.jevApiKey && (await ownerSecrets.resolve(JEV_SECRET)) === undefined` is unchanged, so an existing secret is never overwritten. Gateway a2 shows the same `updatedAt` before and after the restart.
- **Value never logged:** the only log call is `logger.info({}, \`seeded jev-api-key from ${config.jevApiKey.source}\`)`, with an empty object and only the literal source name interpolated. `source`is typed as the literal union`'GG_JEV_API_KEY' | 'JEV_API_KEY'`, and `value`only reaches`ownerSecrets.set`.
- **Other places that log or serialise `config`:** none found. `ApiConfig` is read field by field everywhere:
  - `app.ts`: `swaggerUi`, `webDist`
  - `plugins/auth.ts`: `requireApiKey`
  - `routes/settings.ts` and `routes/system.ts`: `defaults`, `requireApiKey`
  - `model-issues.ts`: `defaults`
  - `preflight.ts`: `dataDir`, `masterKey`, `dbUrl`, `defaults`, `codexBinary`, `claudeBinary`
  - `create-api-key.ts` and `reset/reset.ts`: `dataDir`, `dbUrl`

  `main.ts` logs only `host`, `port`, `dataDir` and `requireApiKey`. `/healthz`, `/version`, `/system/*`, `/system/preflight` and `/openapi.json` do not include `config`, and `emit-openapi.ts` builds its own config from an explicit environment map. Preflight's Jev check reads the stored secret and reports only presence. The key value sits in the same field it occupied on `main`, so the exposure surface is unchanged.

- **Typecheck and lint:** `pnpm --filter @graphgoblin/api typecheck` and `pnpm --filter @graphgoblin/api lint` both exit 0. Prettier `--check` passes on the 10 changed source and doc files.

## Tests and red before

- **Red before, reviewer-run** ([review-red-before.log.txt](review-red-before.log.txt)). Method:
  1. Restore `config.ts` and `container.ts` from `a4fee9a9`.
  2. Run the branch's tests: `vitest run src/units.test.ts src/container.test.ts -t "Jev"`.
  3. Restore both files from `HEAD`. `git status` was clean afterwards.

  Result: **4 failed | 15 passed | 24 skipped (43)**.
  - Three `loadConfig` cases received the bare string instead of `{ value, source }`.
  - `seeds from JEV_API_KEY when GG_JEV_API_KEY is unset…` expected `seeded jev-api-key from JEV_API_KEY` but received `seeded jev-api-key from GG_JEV_API_KEY`. This is the behavioural regression test for #424.

  The implementer's 13 passed / 26 skipped differ only because of a different `-t` filter.

- **API coverage, reviewer-run** ([review-coverage.log.txt](review-coverage.log.txt)). `pnpm test:coverage --filter @graphgoblin/api -- --maxWorkers=2` passed on the first run:
  - Tasks: 8 of 8 succeeded, 0 cached, 13 min 14 s.
  - Test files: 103 passed, 2 skipped.
  - Tests: 1,684 passed, 14 skipped (1,698).
  - Coverage: statements 94.74% (3104/3276), **branches 90.98% (2029/2230)**, functions 91.7% (575/627), **lines 96.22% (2832/2943)**.

  There was no failure, so no #407 rerun was needed. The implementer reported 1,686 passed and 12 skipped. The two-test difference is the two D-015 runtime skips in `shutdown-process.test.ts` (lines 673 and 733). They run only where `taskkill` is denied, as in the implementer's sandbox. This host confirms termination, so they skip here.

- **Build:** `pnpm build` exited 0 with 11 of 11 tasks (6 cached). The built `apps/api/dist/container.js` line 329 contains the source-template log call.

## Behaviour through the built product (reviewer-run evidence)

Driver: [review-drive.mjs.txt](review-drive.mjs.txt). It spawns `node apps/api/dist/main.js` with every inherited `GG_*`, `JEV_API_KEY` and `LIVE*` variable removed, then sets these variables:

- `GG_DATA_DIR`, a disposable store under `%TEMP%\gg-rev424-stores`
- `GG_PORT`
- `GG_HOST=127.0.0.1`
- `GG_LOG_LEVEL=trace`, so a value in any debug or trace object field would also have been caught
- `GG_WEB_DIST=''`
- the scenario's Jev variables

For each gateway the driver waits for `/healthz`, lists `GET /secrets` (names and timestamps only), drains it through `POST /system/shutdown {"action":"drain"}` and waits for the exit. It then scans the log and every file in the store directory for the plaintext `review-fake-key`. The fake values were `JEV_API_KEY=review-fake-key` and `GG_JEV_API_KEY=review-fake-key-gg`; the substring check covers both. Logs: [review-behaviour.log.txt](review-behaviour.log.txt). Summary: [review-behaviour-results.json](review-behaviour-results.json).

| Gateway      | Store           | Port | Jev environment       | Seed log line                            | `GET /secrets`                                       | Drain → exit |
| ------------ | --------------- | ---- | --------------------- | ---------------------------------------- | ---------------------------------------------------- | ------------ |
| a1           | `store-a` fresh | 6340 | `JEV_API_KEY` only    | `seeded jev-api-key from JEV_API_KEY`    | `jev-api-key`, updated `2026-10-28T05:00:40.996Z`    | 202 → 0      |
| a2 (restart) | `store-a`       | 6341 | `JEV_API_KEY` + `GG_` | none                                     | `jev-api-key`, same `05:00:40.996Z`: not overwritten | 202 → 0      |
| c1           | `store-c` fresh | 6342 | `GG_JEV_API_KEY` only | `seeded jev-api-key from GG_JEV_API_KEY` | `jev-api-key`                                        | 202 → 0      |
| d1           | `store-d` fresh | 6343 | both set              | `seeded jev-api-key from GG_JEV_API_KEY` | `jev-api-key`                                        | 202 → 0      |
| e1           | `store-e` fresh | 6344 | `GG_` empty + `JEV_`  | none                                     | empty                                                | 202 → 0      |
| f1           | `store-f` fresh | 6345 | neither               | none                                     | empty                                                | 202 → 0      |

- **Fake key:** absent from all six gateway logs and from every store file in plaintext (`graphgoblin.db`, `-wal`, `-shm` and `master.key`).
- **Log levels:** only info-level (30) lines were emitted at `trace` level.
- **Shutdown:** all six gateways (PIDs 47732, 51300, 24520, 21848, 15736, 28784) exited 0 after the drain, none needed a kill, and ports 6340 to 6345 showed only `TIME_WAIT` afterwards. The disposable stores were removed after the run.

## Docs

The five touched documents agree with each other and with the code on every point:

- `GG_JEV_API_KEY` wins, and `JEV_API_KEY` applies only when `GG_JEV_API_KEY` is unset.
- An explicitly empty `GG_JEV_API_KEY` disables seeding, including the fallback.
- An existing secret is never overwritten.
- The startup log names the variable actually used, with both exact strings.
- The value is never logged.
- An empty seed or an existing secret produces no seed line.

The five documents are `CHANGELOG.md` (one bullet at the top of Unreleased), `docs/06-harness-integration.md` (one paragraph added, additive only), `docs/11-security-and-distribution.md`, `docs/guide/01-install-and-first-run.md` (new `JEV_API_KEY` row and paragraph) and `docs/guide/06-settings-and-secrets.md`. `docs/reference` lists no environment variables, so no regeneration is needed. No route or schema changed. Finding 1 covers the re-seed sentences outside these paragraphs.

## Observed outside scope (not findings against this change)

- **Empty variables on Windows.** In Windows PowerShell 5.1, `$env:GG_JEV_API_KEY = ''` deletes the variable rather than setting it empty; the reviewer checked this on this host. `cmd`'s `set GG_JEV_API_KEY=` behaves the same way (also checked here: the variable is then "not defined"). So "an explicitly empty `GG_JEV_API_KEY` disables seeding, including the fallback" cannot be expressed from those shells. There the fallback `JEV_API_KEY` seeds, and the only way to suppress it is to unset `JEV_API_KEY` for that process. Gateway e1 confirms the documented behaviour when a launcher does pass an empty entry (a Node spawn here, or Docker). This is a possible docs note for the Windows owner.
- **Docker Compose.** The commented `docker-compose.yml` line `GG_JEV_API_KEY: ${GG_JEV_API_KEY-${JEV_API_KEY-}}` maps a host `JEV_API_KEY` into the container's `GG_JEV_API_KEY`. The container log will therefore say `seeded jev-api-key from GG_JEV_API_KEY` even when the host value came from `JEV_API_KEY`. That is truthful for the container process. guide/06 could say so in a later docs pass.
