# Windows launcher independent QA

The final native candidate passed **10/10 lifecycle scenarios and 8/8 silent-listener trials** on Windows with Node 22.23.4. The final matrix ran with frozen source and built files; its before/after comparison reports no changed files. The executable SHA-256 was `0da56e08eeffebbad9f830853335b81d160b59f3c9eca40a106c3d72744f8e49`.

Implementation and independent native QA used separate GPT-6.1 workers. Opus supplied independent design analysis and native diagnosis. Final exact-head Fable review, repository gates and CI are recorded on the pull request. These native results do not complete owner acceptance on #276/#325.

| Behavior                                                                                               | Evidence                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold/warm/concurrent launch, rapid same-port reuse, unrelated HTTP listener refusal                    | [Final matrix](final/matrix/results.json)                                                                                                                                          |
| Wrong store/configuration, shared external SQLite, hard links, stale/malformed locks, startup failures | [Final matrix](final/matrix/results.json), [hard-link ownership](final/matrix/hardlink-ownership.json)                                                                             |
| Actual headed browser closes while parent/child work and native descendants continue                   | [Browser observation](final/matrix/browser-close.json) and the retained PNG under `final/matrix/`                                                                                  |
| Drain, grace choice, continued waiting, completion, managed force, durable results and relaunch        | [Final matrix](final/matrix/results.json), individual `exit-*.json` observations                                                                                                   |
| Silent TCP listener accepts connections but never serves HTTP; eight refusals start no backend         | [Silent-listener trials](final/silent-tcp/silent-tcp-attempts.json)                                                                                                                |
| Stable tested bytes and complete fixture teardown                                                      | [Provenance](final/matrix/build-provenance.json), [byte comparison](final/matrix/build-byte-stability.json), [final process inventory](final/matrix/final-listener-inventory.json) |

The in-repository native acceptance suite separately exercises Unicode shell links, real COM property readback, a window in a different process, persistence after the stamping process exits, and cold execution of the stored relaunch command. The installer was exercised with disposable outputs and the existing PWA's read-only shortcut metadata. Actual owner desktop/taskbar/PWA deployment verification follows merge and is recorded on the PR; it is not claimed by this disposable test run.

## Defects found before acceptance

Candidates 1–3 were rejected. TCP-table false negatives allowed unwanted startup; stale PID-zero rows falsely blocked restart; and filtering for live owners still missed silent listeners. The final implementation uses direct connection evidence instead. Representative raw rejected results are retained under `rejected/`. An earlier v4 run was also excluded from final qualification because typechecking rebuilt API files during that run; the matrix linked above was repeated after freezing those files.

## Evidence and replay

Raw JSON, script and PNG bytes are preserved. `sha256-manifest.json` lists the committed raw payloads; scoped Git attributes prevent newline conversion. The larger local evidence archive retains additional historical logs and the exact executable. Executables, databases, generated master keys and credentials are not committed here.

Use an isolated Windows worktree, build it with the supported Node runtime, and compile `apps/windows-launcher/Launcher.cs` as described by the installer. With Node 22.23.4 first on PATH, invoke `replay/run-native.mjs` with the repository path, case regex `^(?!L04b).*`, executable path, starting port `4860`, and `reuse`. Use regex `^L04b` and port `4864` for the eight silent-listener trials. The retained runner uses the locally installed Chromium revision recorded in the evidence; it performs no browser download. Its generated stores remain outside the owner's store. No real provider or Jev turn was used.
