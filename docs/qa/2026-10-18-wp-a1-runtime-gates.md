# Runtime baseline, dependency-aware caching and the esbuild finding (#263, #127, #114)

## Scope and evidence

Runtime selection, check-cache invalidation and the esbuild advisory were measured on the original implementation and revisited after independent review. Initial evidence is dated 2026-10-18; follow-up verification is dated 2026-10-19. Follow-up source includes the guide and licensing tests from the review baseline `0411eb9`.

## Runtime baseline (#263)

`.nvmrc`, CI, the container, installers, API preflight and documentation select Node 22 LTS (22.x). Root `engines.node` and `devEngines.runtime.version` are `^22`; the runtime declaration uses `name: node` and `onFail: error`. Every pnpm command checks the running Node version, including install, run, exec, filtered exec and package-directory exec. Node 23 installation and `check:layers` now refuse before running their work.

Workspace `engineStrict` was removed: it enforced all dependency engine ranges and rejected a clean Node 22.14.0 installation. Independent review verified that the replacement permits a clean locked install on 22.14.0 and rejects 23.10.0. The follow-up clean-install result is listed in the verification table; a failed local installation attempt is not a successful clean-install qualification.

Several development dependencies declare newer Node 22 patch floors, including undici (22.19.0), react-router (22.22.0), jsdom and related DOM packages (22.22.2), and the Linux lzma binary (22.20). D-014 retains `^22`; local gates run on 22.14.0 while CI uses latest 22.x. The owner can close this patch-level qualification gap by updating their Node 22 installation.

Verbatim Node 23 refusal:

```text
Error: ERR_PNPM_BAD_RUNTIME_VERSION

  × This project requires Node.js ^22. Your current Node.js is v23.10.0
  help: If you want to bypass this version check, set "runtimeOnFail" to
        "warn" or "ignore" (e.g. via --runtime-on-fail=ignore), or set
        "devEngines.runtime.onFail"/"engines.runtime.onFail" to "warn" or
        "ignore"
```

All six entry-point probes refused: install, explicit run, script shorthand, exec, filtered exec and exec from the API package directory.

API preflight rejects every major other than 22. The Node 23/24 regression cases failed before the change; final assertions check failure status and Node 22 selection guidance. The public constant is `SUPPORTED_NODE_MAJOR`, replacing `MIN_NODE_MAJOR`.

Six native adversarial tests failed on main under Node 22 because `registerHooks` starts at 22.15. Their shared source loader now uses asynchronous `module.register`, preserving heap limits, watchdogs, deadlines and assertions. Independent review confirmed that the pre-dispatch green domain result was a cache replay: Turbo gave that task identical hashes under 22.14.0 and 23.10.0 because it hashes the declared engine range, not the running version. Gates must run through pnpm; direct Turbo invocation bypasses the runtime guard.

## Dependency-aware caching (#127)

The no-op `transit -> ^transit` task hashes direct and transitive workspace source inputs. Test, coverage, lint and typecheck depend on local transit; typecheck retains its existing `^build` edge. Root ESLint and TypeScript configurations are global inputs. API/MCP tests declare their guide inputs; domain conversion tests declare API templates. Tooling test and coverage caching is disabled because those tests read across the repository. Package-specific tasks restate transit dependencies and coverage outputs.

CI retains coverage concurrency one. Transit hashes dependencies without running their suites; correct invalidation can increase executed work after relevant changes. No CI wall-time improvement is claimed.

The original full-engine behavioral probe replayed 455 passing tests under a deliberately regressed domain result. After the transit fix, the same regression reran and failed 78 tests. Restoring the dependency and changing an unrelated adapter retained the healthy cache hit:

```text
Before: Cached:    1 cached, 1 total
After:  Cached:    0 cached, 1 total
AssertionError: expected 'WP-A1 behavioral seed' to be 42
Control: Cached:    1 cached, 1 total
```

Typecheck already rejected the exported-type seed before the fix. Type-aware lint replayed a pass before transit, then reran and reported changed diagnostics afterwards. A separate A → B → C fixture confirmed direct and transitive invalidation and unrelated-package reuse. All deliberate source regressions were restored. Historical CI run 37831911183 was inspectable on 2026-10-18 and reported coverage `0 cached, 12 total`; the controlled regressions establish the cached-false-pass evidence.

The dry-run command is `pnpm --config.verifyDepsBeforeRun=false exec turbo run test:coverage lint typecheck --filter=@graphgoblin/api --filter=@graphgoblin/engine --env-mode=loose --dry=json`. Follow-up dry runs use the same task selection while changing guide 02, the root ESLint configuration, the base TypeScript configuration and an unrelated adapter independently. Relevant hashes must change; unrelated hashes must remain stable. Each edit is restored.

| Configuration / edit            | API coverage hash  | Engine lint hash   | Engine typecheck hash |
| ------------------------------- | ------------------ | ------------------ | --------------------- |
| Before: baseline                | `d91ffa5cf50f2a07` | `1c4ef33f6905c5ce` | `a5730c6dcf50ec26`    |
| Before: guide 02                | `d91ffa5cf50f2a07` | `1c4ef33f6905c5ce` | `a5730c6dcf50ec26`    |
| Before: ESLint config           | `d91ffa5cf50f2a07` | `1c4ef33f6905c5ce` | `a5730c6dcf50ec26`    |
| Before: TypeScript config       | `d91ffa5cf50f2a07` | `1c4ef33f6905c5ce` | `a5730c6dcf50ec26`    |
| Before: unrelated plugin README | `d91ffa5cf50f2a07` | `1c4ef33f6905c5ce` | `a5730c6dcf50ec26`    |
| After: baseline                 | `c39b28774edb077d` | `180d89306adc81a2` | `dbfb34bc1a06a96d`    |
| After: guide 02                 | `82a0633199d2eaec` | `180d89306adc81a2` | `dbfb34bc1a06a96d`    |
| After: ESLint config            | `40c9f9418361db2f` | `38a840869f3ef3e6` | `7d1f8f4c2b6b2417`    |
| After: TypeScript config        | `362ef6dec2e8344f` | `4c1edbd8485cc798` | `1c719c0ac0fc8487`    |
| After: unrelated plugin README  | `c39b28774edb077d` | `180d89306adc81a2` | `dbfb34bc1a06a96d`    |

The unrelated plugin edit retained an engine-lint local cache hit (`HIT`, `LOCAL`).

## esbuild finding (#114)

GHSA-67mh-4wv8-2f99 affects esbuild <=0.24.2. Before removal, esbuild 0.18.20 was installed through Drizzle Kit 0.31.11 → deprecated esm-loader 2.6.5 → core-utils 3.3.2, but the package was never loaded by Drizzle Kit. Its only esm-loader reference is the dependency manifest; core-utils uses transform APIs rather than the development server.

D-013 accepts `overrides: { '@esbuild-kit/esm-loader': '-' }`. This removes the unused deprecated package and its affected subtree without forcing an esbuild version or changing the parent dependency. Remaining locked esbuild versions are 0.25.12 and 0.28.2, both patched. Production-only audit was already clear; no shipped development-server path was identified.

Audit after the lockfile removal:

```text
No known vulnerabilities found
```

Drizzle generation, migration no-op checking and license checking are recorded below.

## Verification

All supported-runtime follow-up commands use Node 22.14.0. Non-install commands use `verifyDepsBeforeRun=false` to check existing resolved dependencies; they do not establish a fresh installation. The clean archive begins without `node_modules`; its manifest, workspace settings and lockfile include the follow-up changes. Unsupported-runtime probes use Node 23.10.0.

| Command                                                                                                                             | Node     | Result            |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- |
| `pnpm install --frozen-lockfile` (clean archive)                                                                                    | v22.14.0 | exit 1, 4.484 s   |
| `pnpm install --frozen-lockfile` (clean archive)                                                                                    | v23.10.0 | exit 1, 1.766 s   |
| `pnpm install --frozen-lockfile`                                                                                                    | v22.14.0 | exit 1, 3.797 s   |
| `pnpm install --frozen-lockfile --dry-run`                                                                                          | v22.14.0 | exit 1, 1.141 s   |
| `pnpm check:layers`                                                                                                                 | v23.10.0 | exit 1, 3.297 s   |
| `pnpm check:deps`                                                                                                                   | v23.10.0 | exit 1, 0.062 s   |
| `pnpm --config.verifyDepsBeforeRun=false typecheck --env-mode=loose`                                                                | v22.14.0 | exit 0, 70.375 s  |
| `pnpm --config.verifyDepsBeforeRun=false lint --env-mode=loose`                                                                     | v22.14.0 | exit 0, 139.203 s |
| `pnpm --config.verifyDepsBeforeRun=false format`                                                                                    | v22.14.0 | exit 0, 401.578 s |
| `pnpm --config.verifyDepsBeforeRun=false format:check`                                                                              | v22.14.0 | exit 0, 197.016 s |
| `pnpm --config.verifyDepsBeforeRun=false check:layers`                                                                              | v22.14.0 | exit 0, 0.562 s   |
| `pnpm --config.verifyDepsBeforeRun=false check:deps`                                                                                | v22.14.0 | exit 0, 11.843 s  |
| `pnpm --config.verifyDepsBeforeRun=false check:migrations`                                                                          | v22.14.0 | exit 0, 5.735 s   |
| `pnpm --config.verifyDepsBeforeRun=false check:licenses`                                                                            | v22.14.0 | exit 0, 6.640 s   |
| `pnpm --config.verifyDepsBeforeRun=false check:docs`                                                                                | v22.14.0 | exit 0, 6.484 s   |
| `pnpm --config.verifyDepsBeforeRun=false audit`                                                                                     | v22.14.0 | exit 0, 1.407 s   |
| `pnpm --config.verifyDepsBeforeRun=false --filter @graphgoblin/infrastructure exec drizzle-kit generate --config drizzle.config.ts` | v22.14.0 | exit 0, 7.641 s   |
| `pnpm --config.verifyDepsBeforeRun=false --filter @graphgoblin/domain test:coverage --maxWorkers=2`                                 | v22.14.0 | exit 0, 65.265 s  |
| `pnpm --config.verifyDepsBeforeRun=false --filter @graphgoblin/api test:coverage --maxWorkers=2`                                    | v22.14.0 | exit 0, 257.063 s |
| `pnpm --config.verifyDepsBeforeRun=false --filter @graphgoblin/tooling test:coverage`                                               | v22.14.0 | exit 0, 14.609 s  |

Domain coverage:

```text
Tests  537 passed (537)
Branches     : 95.55% ( 2151/2251 )
Lines        : 98.4% ( 1918/1949 )
```

API coverage:

```text
Tests  630 passed | 2 skipped (632)
Branches     : 93.46% ( 1229/1315 )
Lines        : 98.48% ( 1691/1717 )
```

Tooling's `test:coverage` script passed all 77 Node tests. It currently aliases `node --test` and emits no numerical coverage counters; this does not establish tooling line/branch coverage.

Earlier verification retained as historical evidence: forced build passed with zero cache hits (139 s); offline upgrade acceptance passed 21 tests with three host-capability skips (33m12s). The full forced run completed 39/43 tasks successfully in 56m54s; coverage failures were in domain, infrastructure, tooling and web.

## Independent review classification

The six deterministic domain loader failures were confirmed on main under Node 22 and fixed as described above. Remaining timing failures were classified as machine-load effects: infrastructure and web reproduced the same failures on main under equivalent load, and both branches passed when run alone at lower load. The tooling Git-ownership failure was an isolation artefact; strict environment mode passed in an ordinary checkout. These classifications do not rewrite the earlier failed-run counts or turn cached output into fresh execution evidence.

## Documentation and qualification

[ADR-0040](../decisions/ADR-0040-node-22-runtime-baseline.md) records D-014 and the dependency patch-floor gap. [Testing and quality](../10-testing-and-quality.md) documents declared external inputs, uncached repository-wide tooling tests and the three-step cache check. The Unreleased notes describe the runtime change, owner restart requirement, cache scope and removed unused esbuild subtree. Runtime installation remains an owner action.
