# Independent QA for WP-D1 #321

Target of the historical round-1 observations: `0e6ab27e21caa9ec99b4088d92c8e1ebb88ba767`. Source branch: `codex-wp-d1-child-recovery`, stacked on `wp-d1-320`; independent QA worktree `codex-qa-wp-d1-321`.

The historical report is [report.md](report.md). [checks.json](checks.json) retains per-check steps, expectations, original results and evidence-loss notes. [gate-checks.json](gate-checks.json) and [gates.jsonl](gates.jsonl) retain the original gate results, commands and durations. Missing raw transcripts cannot authenticate those historical summaries. The [round-4 report](round-4/README.md) and [28-path disposition manifest](round-4/citation-dispositions.json) explicitly identify every missing original. No original was recovered and no behavior was rerun in round 4.

## Retained replay recipe

The round-1 `prepare-fixtures.mjs` (original not kept) and `run-gates.ps1` (original not kept) are gone. Use the explicitly reconstructed [round-2 fixture generator](round-2/prepare-fixtures.mjs), [round-2 runner](round-2/run-gates.ps1) and [round-2 instructions](round-2/README.md). These are retained replacements, not the original sources. Their recorded outputs are fresh round-2 observations at `a5cd26c496e7ae59e13748e7c879d072064ace0f`; they are not current-head results.

The root command history is archival. Its root-local fixture/configuration inputs were not kept; each affected gate entry now identifies its reconstructed round-2 input. Do not execute the archival commands as if those root inputs still existed. Node 22 must be first on PATH and PowerShell uses pnpm.cmd. The retained recipe documents disposable stores, ports 5920–5929, fake harnesses, process exit and cleanup. Owner ports 4747/4748 and the owner store remain excluded.

The [round-3 report](round-3/README.md) at `a44744f11d5c37000fe8354754fb3d8a82e3a4fa` independently verifies the restart-port split and API suites. It contains no fresh Edge, MCP, full contracts/engine/infrastructure/web coverage, or full-repository lint/layer/dependency/docs/token gate replacement. Matching round-2 evidence is linked where available; otherwise the loss is explicit and no equivalent replacement is claimed.

[retained-temp-files.json](retained-temp-files.json) is a historical round-1 inventory, not a current availability promise. Those files are no longer present in the original TEMP locations checked in round 4. Round 4 started no application or provider, created no temporary store and removed no directory.
