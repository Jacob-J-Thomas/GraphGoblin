# #429 fresh-target fork: independent behaviour QA

**PASS** on candidate `fe07ec84c015f02f7224ef56b202e6e115bde282` (tree `5423612f7ee427cd9a35907150148930a6824901`, parent `325e9bb4ecffb76ecc7dc22e1426009b168a1a2c`): 92 of 92 predicates (34 source/orchestration, 58 behaviour), 0 failed, on the fifth attempt. The first failures of attempts 1 to 3 are kept below. The candidate's `CHANGELOG.md` (blob `b614a866`) and `docs/06-harness-integration.md` (blob `47bd8470`) were checked against observed behaviour for both sides of the fork: recover the stopped original, or deliberately adopt a fresh store after an incompatible immutable snapshot. Machine-readable results are in [results.json](results.json); a portable fixture is in [fresh-target-fixture.json](fresh-target-fixture.json).

## What ran, by evidence category

- **Actual old-main runtime.** Main `491f089a` source in-process. Each of the 9 runtime source files that differ from the candidate was resolved to main's exact git-blob bytes. 8 were loaded: API `app.ts`, `loop-issues.ts`, `plugins/errors.ts`, contracts `index.ts`/`nodes.ts`, domain `graph.ts`, adapter-codex `isolation.ts`/`options.ts`. The 2 candidate-only modules were never requested, and no built output was loaded. All other source and dependencies are byte-identical to main: lockfile, package manifests, `packages/infrastructure` and `packages/engine` (including the store guard and migrations) are unchanged. Fingerprint: no plain-key schema, and a non-plain override key is accepted.
- **Current target runtime.** The candidate checkout as is. Fingerprint: the plain-key schema is present, and a non-plain key is refused.
- **Common harness.** Scoped Node v22.23.4. The shipped `createTestApp` used a fake harness, a fake clock, disabled timers and required API keys, on file-backed disposable stores. Requests were real HTTP to ephemeral `127.0.0.1` listeners. Keys were minted by the product's `--create-api-key` function (`createApiKey`, which also initializes a fresh store). Tokens moved only over IPC and were never printed or written.
- **Fixture-seeded old shape.** None. The incompatible snapshot came from the old-main runtime's ordinary API: draft create, then draft run.
- **Standalone guards.** `guardCurrentStore` over the product read-only client, plus the shipped discovery SQL. These are separate from gateway construction.

## The fork, step by step

1. **Old-main seed (real HTTP).** `POST /loops` returned 201 and stored override key `bad key`, with the Codex harness materialized. A draft run returned 202 and succeeded with one fake turn, leaving exactly one immutable snapshot that carries `bad key`. GET returned 200. No schedules, webhook endpoints or timers were created. The listener closed and the locks were released. A full stopped copy of the data directory became the backup.
2. **Target refuses the original.** Gateway construction failed with `STORE_UNSUPPORTED` before listening. The reason names the first invalid row (the draft). The database bytes stayed identical to the backup; the refused start added only empty-WAL/SHM sidecars (observation 1). The locks were released. Standalone checks agreed: discovery reported the draft and the snapshot, the omission query returned 0 rows, and the guard refused with `STORE_UNSUPPORTED`.
3. **The snapshot alone still blocks (offline copy, no gateway).** The documented `json_remove` recipe cleared the draft (1 row). On the snapshot it changed 0 rows, and the snapshot's bytes were unchanged. A direct UPDATE was refused with `LOOP_VERSION_SNAPSHOT_IMMUTABLE`. Discovery then reported only the snapshot, and the guard still refused, naming the snapshot.
4. **Previous-build operational start on the original (old-main runtime).** The previous build started despite the snapshot. Unauthenticated access returned 401. With the original credential, GET returned 200 and `export?draft=true` returned 200, including `bad key`. The published export returned 404 `VERSION_NOT_FOUND`, because nothing was published. No turn ran. Product tables and credential identities were unchanged, and every file in the data directory was byte-identical across this start.
5. **Fresh store (target runtime).** The structured JSON correction removed only that member and kept the explicit `harness: "codex"`. The corrected definition validates; the raw export does not. `createApiKey` on a new, separate directory initialized a current, empty store with one distinct credential. With the gateway started:
   - A request with no credential got 401. The original credential got 401 for list, for read of the original ID, and for import.
   - With the fresh credential, the original loop ID returned 404 `LOOP_NOT_FOUND`.
   - The uncorrected export returned 400 `LOOP_IMPORT_ERROR`, naming `loop.nodes.1.config.harnessOptions.configOverrides.bad key`. Tables were unchanged.
   - The corrected export returned **201** with a **new loop ID**, a draft only, no current version and no issues.
   - GET by the returned ID returned 200 with the exact corrected draft. The imported loop has one draft version, and there were 0 runs, events, schedules, webhook endpoints, timers, inbound events and fake turns. No original history is present; the only other loop is the product-seeded system chat loop. No publish or run was needed.
6. **Check, then resume the adopted store.** With the store stopped, both discovery queries returned 0 rows, the guard returned `current`, and the stored draft text equals the intended correction. A restart with the fresh store's configuration served GET 200 for the returned ID; the original credential still got 401. Tables were unchanged.
7. **The original is unaffected.** Adoption left every file in the original data directory byte-identical. The target gateway and the standalone guard still refuse it with `STORE_UNSUPPORTED`, with no further file change and no lock left. The backup stayed byte-identical throughout.

## Prior evidence still applies

The 41/41 operator predicates and 11/11 shipped tests ran on `02472475`. I recomputed that source manifest from git objects: 1,733 non-QA files, `57434e0b…`, as recorded. The candidate's manifest (`7539656c…`, unchanged before and after this QA) differs from it only in `CHANGELOG.md` and `docs/06-harness-integration.md`.

The four SQL recipes are byte-identical at `676289df`, `02472475`, `325e9bb4` and `fe07ec84`:

- Executed digests: `275280df…`, `22731d8b…`, `eaec7add…`, `8edea155…`.
- Raw fenced-body digests: `885ba63d…`, `3e80ddec…`, `5d74fd96…`, `a005ea90…`.

The shipped tests extract them with four fence-anchored expressions, which select identical text at both sources. The 41/11 matrix was therefore not repeated.

## The snapshot version-read sentence

"An explicit version read can still return `500 RESPONSE_INVALID`" for a manually authored omission-only snapshot. Three sources bear on it:

- **Formal reviewer.** Source inference only; it was not executed.
- **Root.** An independent native loopback A/B, recorded separately, observed 500 `RESPONSE_INVALID` on both the reviewed build and a main-equivalent build.
- **This QA.** Did not re-run that read. Nothing here contradicts it; this QA's snapshot has a different shape (invalid key).

That an omitted harness alone passes the guard remains the live observation from the prior 41/11 run.

## First failures (kept)

- **Attempt 1 (driver).** The seed phase did not pass its own newly minted credential to its request helper. This happened after 26 source checks and 3 phase checks had passed, and no product behaviour was involved.
- **Attempt 2 (first product-facing failure).** A strict whole-directory byte check after the target refusal failed. Per-step manifests in attempt 3 showed the cause: the refused start creates an empty `graphgoblin.db-wal` and a 32,768-byte `graphgoblin.db-shm` beside the original. The database bytes were unchanged, and the later standalone inspection changed nothing further. From then on, the checks pin the database bytes and allow only empty-WAL/SHM sidecars.
- **Attempt 3 (driver).** An observation expression assumed the import error's `errors` field was an array. The request had already completed, after 7 checks had passed.
- **Attempt 4.** Passed (90 of 90). Attempt 5 added the adopted-store pre-service checks.

## Observations (non-blocking, not introduced by this candidate)

1. A refused start's read-only open leaves WAL/SHM sidecars, as described under attempt 2. The refusal says "No stored data was changed", which is accurate for content, but a byte comparison of the data directory will see the new files. Container and store code are unchanged from main. The note never starts the new build on the backup.
2. The uncorrected import's top-level detail says "document is neither a loop export nor a loop definition". The nested error does name the exact key.
3. Import needs the new build running on the fresh store before the note's final start. A fresh store has nothing to recover or arm, and the exercised order (import, stop, check, start) matches the note.

## Limits

- Everything was synthetic: no owner store or service, real provider, schedule, webhook, poll or external network, and only loopback.
- Both runtimes ran source in-process, not a built gateway process, launcher or cold start.
- The fake clock repeats key-usage timestamps.
- Both stores used the same synthetic master key, so separation of master keys, secrets and settings for the adopted store was not exercised.
- The original had no published triggers or active runs, so the previous build's recovery and re-arming were not exercised.
- The alternatives of deleting the loop or resetting were not re-run here. `DELETE` is covered by the unchanged shipped test.
- pnpm was not needed.
- The private driver depends on this host; the fixture is portable.

## Product state and teardown

Tracked source matched HEAD blobs, and status was clean before and after. Git use was read-only object, diff and listing commands, with status run under optional locks off; only one initial status probe at session start ran without that setting. Another process updated this worktree's sparse-checkout patterns and index before the first run; both were unchanged afterwards.

Every gateway closed: a request after close was refused, and the locks were released. All disposable stores and the temp and profile directories were removed, and no QA process or listener remains. Private receipts contain no token value or token-shaped text. This appendix omits paths, credentials, databases and logs.
