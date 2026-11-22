# Independent #364 native and public behavior QA

**Bounded QA outcome: PASS, with no product failure observed in the completed scope.** The requested native and public criteria are established for immutable candidate `99f1de7863dfc6a05b63a9140f7fc7a6833fcb20`, tree `911b2400b7622b5b04b58b3b03092d9ea90f55a3`, parent `02351e2fb932b3be44e7cc3fb3943a61d568226c`. This is independent behavior QA, not formal code-review approval, CI/coverage clearance, final audit, merge authorization, owner acceptance or deployment.

QA agent: `/root/i4_364_independent_qa`, a fresh context assigned GPT 6.1 Sol xhigh, separate from the actual Claude implementer and opposite-family reviewer. Worktree: `G:/ggq/gg-i4-364-qa/GraphGoblin`, detached at the exact candidate. Product source and index remained clean. All original fixtures and evidence are under this directory.

## Results and original failures

| Execution | Actual result | What it establishes |
| --- | --- | --- |
| Frozen offline install | exit 0, pnpm 12.8.1 | Dependencies installed without a lockfile change |
| One coordinated `pnpm.cmd build` | exit 0; 12/12 tasks successful, 5 cached; 51.733 seconds | Built artifacts for the public app; build slot released to root immediately afterwards |
| `native-qa.mjs` | **42/42 predicates passed**, eight native/harness cases | Actual Windows child start/refusal, exact cwd, closed diagnostics and no actual turn on refusals |
| `public-qa-attempt1.mjs` | exit 1; six setup/cleanup predicates passed, **one fixture error** | Initial draft admission request lacked an explicit draft version ID; no intended run behavior established |
| `public-qa-attempt2.mjs` | **55/55 passed**, zero fixture errors | Real built API/engine/SQLite, seven run scenarios including restoration and Resume |
| `probe-path-qa.mjs` | **23/23 passed** | Native and built REST preflight for exact check-folder lengths 258/259/260, probe cleanup and parent survival |
| `controlled-seam-qa.mjs` | **19/20 passed**, **one assertion defect** | Synthetic transport lifecycle cases; actual cancellation was correct but a predicate compared DOMException numeric code 20 with the string AbortError |
| `cancel-predicate-correction.mjs` | **3/3 passed**, fresh rerun of only the misasserted case | Cancellation name/priority, no displaced configuration event, one injected turn; original failed assertion retained |
| `baseline-negative-control.mjs` | **3/3 control checks passed** | Exact parent process/harness source reproduces the false installation claim for the same existing 259-character cwd; candidate oracle rejects it |

These are predicates within named executions, not independent issue counts or a package-coverage denominator. The original public and controlled failures are preserved in full, with rationale in `FIXTURE-REPAIRS.md`. No retry loop or broad rerun was used to manufacture an unqualified green result. No product fix was made by QA.

## Original fixture and prediction method

`PREDICTIONS.md` was written before fixtures executed. Scope came from the live repository instructions, issue workflow, five-intent register and D176, with the author brief/report and formal review read as contract inputs. The author test fixture was not reused.

`FakeClaude.cs` is a small independently compiled native .NET executable. It implements only version/help/auth prerequisite responses and a harmless valid init/result stream. Every actual process appends its PID, exact cwd, argument vector, input length/hash and synthetic home paths before returning output. Turn markers are distinct from no-turn probes. It makes no provider/network request and does not read credentials. `PublicFakeClaude.cs` adds one bounded ten-second auth gate for the public filesystem-race cases. Both source and executable bytes are retained and hashed.

Every child receives an explicit environment with an empty owned HOME/USERPROFILE/APPDATA/LOCALAPPDATA. The public API receives its own disposable GG_DATA_DIR, explicit fake Claude executable, an absent synthetic Codex executable, Ollama disabled and loopback port 0. Five API process instances used ephemeral ports outside 4747/4748. Tests neither touched owner configuration/services/stores nor invoked an installed or paid provider.

`PUBLIC-FIXTURE-DESIGN.md` records a necessary distinction before public execution: real `FsWorkspace.resolve` creates missing fixed paths. Therefore an ordinary missing REST cwd would be repaired, and a file cwd would fail in the workspace layer. To reach this patch honestly, the public missing/file cases first park at a public input wait, then gate the final actual auth probe after workspace resolution. The controller removes/replaces only that owned cwd and releases the probe; native turn start then refuses. This is a controlled real-filesystem race through the unchanged composition, not a claim about every missing fixed-path run.

## Native observations

| Operand/cwd | Raw native observation | Candidate runner/harness outcome |
| --- | --- | --- |
| Existing fixture, ordinary existing directory | PID assigned, exit 0; child observes exact cwd | Harmless turn completes; actual turn marker present |
| Existing fixture, nonexistent cwd | No PID; ENOENT attributed to executable path | `working-directory-missing`, `HARNESS_INVALID_CONFIGURATION`, definitely-not-submitted; no turn marker |
| Existing fixture, cwd is a file | No PID; ENOENT attributed to executable path | `working-directory-not-directory`, same configuration/submission outcome; no turn marker |
| Existing fixture, cwd length 258 | Existing directory; PID assigned, exit 0 | Harmless turn completes in exact cwd |
| Existing fixture, cwd length 259 | Existing directory; no PID, ENOENT | No proved cause; `HARNESS_TURN_FAILED` with length guidance, definitely-not-submitted; no turn marker |
| Existing fixture, cwd length 260 | Existing directory; no PID, ENOENT; raw stdout/stderr emit ENOTCONN | Same conservative failure; candidate parent survives and completes later cases; no turn marker |
| Absent fully qualified executable, ordinary cwd | No PID, ENOENT | `executable-missing`; preflight cli-missing and turn `HARNESS_NOT_INSTALLED`; no turn marker |
| Bare unresolved command, ordinary cwd | No PID, ENOENT | No PATH-resolution proof; unknown/`HARNESS_TURN_FAILED`; no turn marker |

`native-observations.json` retains stdout, stderr, raw error attributes, stream error observations, PID, close code/signal, durations, actual filesystem states, runner outcomes, harness preflight/events/result and marker deltas for every case. Native error bodies are retained only in this local synthetic evidence packet. The public adapter failures contain no planted path/prompt/native-detail canary.

This is a finite three-length boundary experiment, not a path-search campaign. Directory stat success establishes existence, not native startability. The observed limit is for this Windows/Node host and does not prove why every possible existing-directory refusal occurs.

## Public execution, privacy and recovery

Attempt 2 uses real HTTP requests against the built `serve()` composition. No engine private state, source/package mutation or fake engine/harness port is used in these seven run cases. Every request/response and marker delta is retained in `public-attempt2-observations.json`; original stdout/stderr/environment and disposable SQLite store are retained separately.

- Ordinary cwd and length 258 each succeed with exactly one actual turn in the requested cwd. Output is the fixed `independent-harmless-success` value.
- Missing and file cwd at the native turn boundary persist public `HARNESS_TURN_FAILED` with `details.adapterCode: HARNESS_INVALID_CONFIGURATION`, `resumable: false` and `inference.submission: definitely-not-submitted`. Failure and recovery policy remain pinned after the directory is repaired. Public Resume returns 409 with no native turn. Example missing-cwd run: `01M7YQ9X63SYGT2G51MMF6TZK3`.
- Existing 259/260-character cwd runs persist `HARNESS_TURN_FAILED`, definitely-not-submitted and non-resumable, without HARNESS_NOT_INSTALLED or cli-missing in their new diagnostic surfaces. Public snapshot/event/Resume responses remain available after the 260-character pipe refusal; the API remains alive through subsequent cases.
- Missing executable is arranged after successful run admission while the public input wait is parked. Releasing the wait produces a prerequisite-probe refusal, no actual turn marker, public `HARNESS_NOT_INSTALLED`, `resumable: true`, definitely-not-submitted and `recovery.resume.allowed: true`. REST preflight independently reports cli-missing without path disclosure. Restoring the exact configured executable path and POSTing Resume with the observed sequence returns 200 and succeeds with **exactly one actual turn in the whole scenario**. Run: `01M7YQA0ZR6BFYDNWW8PX2GK4H`.
- SQLite is the real composition backing these operations; the owned on-disk database exists and is nonempty. This QA does not claim a restart/durability endurance test.

Privacy assertions cover the **new diagnostics**: snapshot.failure, recovery messages, run.failed/error events, Resume refusal bodies and Claude preflight facts. They reject planted raw cwd/executable/prompt text, argv flags, native spawn/syscall/errno details and stack fragments. Authored loop definitions and intentionally retained local markers may contain their own synthetic paths/prompts; this is not a claim that the whole run history redacts authored data. The prompt is sent through stdin, and marker argv plus stdin length/hash establish that transport without recording an actual provider turn.

For long TEMP, both direct native harness checks and three separate built API instances use temp roots chosen so the newly generated check folder is exactly 258, 259 or 260 characters. At 258, readiness succeeds and native markers show three prerequisite launches in the exact-length folder. At 259/260, no native CLI starts, state is unknown, the message names the temporary check folder and numeric 258 limit without asserting absence, and the generated probe directory is removed. REST remains responsive. All are no-turn probes.

## Controlled lifecycle and negative control

The controlled seam loads unchanged built runner/harness modules in its own process. A narrowly scoped Node resolver replaces only the runner's tree-kill dependency with a recording stub; built-in spawn/stat exports are temporarily controlled and restored. The synthetic PID values are not native process evidence. The harness-priority cases use its supported runner injection. No kill is issued against a synthetic PID or unrelated native process.

Observed cases: abort and deadline settle a genuine no-PID refusal while metadata is pending, without a kill/invented timeout/diagnosis; abort listener is removed; late stat completion does not mutate the settled result. An error after PID assignment adds no spawnCode and performs no diagnostic stat. Started stdout/stderr loss requests exactly one owned-tree termination, retains outputFailed, carries no spawn-refusal proof or raw pipe text, and cannot be downgraded by later auth-refusal stderr. At the harness port, output loss yields delivery-uncertain TURN_FAILED, cancellation outranks cwd diagnosis, and termination-unconfirmed outranks cancellation. The cancellation predicate correction is explicitly separate from a native cancellation/termination claim.

The negative control extracts the exact parent commit's process.ts/harness.ts into this evidence directory, records hashes and transpiles only those two files into isolated modules, binding unchanged helpers to the built tree. It runs the same independently compiled CLI in the native matrix's existing 259-character directory. The unchanged parent reports `HARNESS_NOT_INSTALLED` while both binary and cwd exist; the candidate reports TURN_FAILED. This demonstrates sensitivity to the original diagnosis defect without changing candidate source or consuming a second pnpm build.

## Binding, cleanup and limits

Runtime: project Node **v22.23.4**, SHA-256 `dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f`. Both install/build and QA shells select it before commands. `source-runtime-binding.json` records exact source/input/runtime/fixture hashes; `build-artifact-manifest.json` records **1,271 built files**. Source process.ts SHA-256: `c44ed660f69b7e4999f0d89704818164ca027356b9f4c6b8c4ec99fb827ad322`; harness.ts: `bc45a1849e0b8ac7e4c89ecc423faa8511da5bee374200b90328469863e6bf1b`. Candidate source tree and Git status were read back after execution. `manifest.json` seals this report and the substantive packet; verification is performed after final sealing.

Cleanup observations show **107 unique recorded API/fake-CLI PIDs absent**, all **five ephemeral loopback listeners released**, no auth gate files left, and the candidate worktree clean. Servers used their real public drain control and exited 0. Disposable databases and finite fixture directories remain as evidence; only owned scenario cwd/gate paths were removed, after containment checks. No unrelated process was terminated. Native raw-spawn callbacks and synthetic abort-listener removal are separately recorded.

Remaining limits and gates:

1. No installed-owner Claude login, provider capability/account/model acceptance, paid inference, native output-loss race, native late-PID error race or kernel termination-unconfirmed scenario was exercised. Readiness/auth/model results here belong to the fake executable; controlled seams establish ordering only.
2. No browser/visual QA, Linux/macOS execution, full regression, full package/monorepo test or new coverage run was performed. Exact-head/current-target CI and root's reserved fresh final audit remain required.
3. The author's focused **259 passed / 2 skipped** and scoped coverage are separately attributed author evidence. Its aggregate infrastructure run **51 failed / 1,153 passed / 2 skipped** (50 symlink EPERM and one SQLite EBUSY) remains a failing run. This QA neither erases those failures nor establishes aggregate coverage or a clean base/full-package result. Normal coverage thresholds remain unchanged.
4. Public missing/file cwd behavior is established at the actual native launch boundary using the documented owned-filesystem race. Workspace creation behavior, diagnostic observation races, permissions uncertainty, the current platform boundary and other adapters remain outside claims of universal startability or safety.

No commits, staging, publication, GitHub changes, services/configuration changes, issue closure, merge or owner acceptance were performed.
