# Independent QA for WP-D1 #321

Target: `0e6ab27e21caa9ec99b4088d92c8e1ebb88ba767`. Source branch: `codex-wp-d1-child-recovery`, stacked on `wp-d1-320`. Independent QA branch: `codex-qa-wp-d1-321`.

The final report is [report.md](report.md). [checks.json](checks.json) records the steps, expectations, actual results, status and evidence source for every independent check. Gate commands, exit codes and durations are in [gates.jsonl](gates.jsonl).

The independent runner uses the built API, real process kills, the repository marker script and headless Microsoft Edge. It never starts inference or calls a provider. Its native timeout/cancellation probes use a finite process after an initial unbounded probe demonstrated the documented D-015 sandbox limitation. Initial failed probes remain in `initial-results.json`; corrected probes are separate. The narrow-viewport probe initially collided with another QA fixture's listener; its corrected run reserves port 5928 and requires its own API listening log before readiness.

The specified checked-in subprocess and browser fixtures use ports outside this brief's permitted range. QA-only configuration transforms test resource prefixes and fixture port ranges to `gg-qa-321-*` and 5920–5929. `prepare-fixtures.mjs` makes local copies of the standalone browser and recovery-process scripts with those same resource substitutions, corrected relative imports and a text capture in place of a screenshot. Production source, original fixtures, assertions, coverage thresholds and coverage exclusions are unchanged. The adapted commands are recorded exactly; the original hard-coded commands were not run against their disallowed targets.

Run PowerShell commands with Node 22 first on PATH. Build before native checks. `run-gates.ps1` accepts a comma-separated `-Only` list. Its process-scoped execution-policy option permits running this local script without altering the installed PowerShell policy. Gate failures remain failures after isolation; no whole suite is retried to obtain a passing result.

Runtime stores are listed in a temporary manifest outside the repository. Evidence records only their generated basenames, ports and process-exit/cleanup results. The cleanup procedure verifies absolute paths remain under the system temp directory, verifies owned processes have exited, then removes only this QA run's prefixed directories. No owner application or owner store is used.
