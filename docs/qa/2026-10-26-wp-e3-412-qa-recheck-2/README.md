NO VERDICT (interrupted)

# PR #412 behaviour QA re-check 2: interrupted, no verdict

This folder holds the partial work of an independent behaviour QA re-check of PR #412 at `57b4f79e9a10160cf9e4457bd1b5be9945ab6fa5`, after the fixes for re-check 1's findings R1 to R3. The QA agent was stopped by an account session limit on 2026-10-27 at about 00:20 UTC, before it wrote its record or a verdict. It never resumed for this head. **This folder is not a verdict and is not counted as a pass.**

What is here, as the agent left it:

| Log                           | Script                 | Content                                                                                  | Outcome recorded in the log       |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| `01-mkstore-main.log.txt`     | `mkstore-main.mjs`     | A store created by a pre-PR build, with terminal and live template runs                  | `failures 0`                      |
| `02-migrated.log.txt`         | `migrated.mjs`         | That store reopened by this build                                                        | `failures 0`                      |
| `03-template-unknown.log.txt` | `template-unknown.mjs` | R1 reproduction                                                                          | `failures 0`                      |
| `04-datadir-alias.log.txt`    | `datadir-alias.mjs`    | R2: data directory through plain, case, 8.3 and junction spellings, with a pressure pass | `failures 0`                      |
| `05-artifact-alias.log.txt`   | `artifact-alias.mjs`   | Artifact directories reached through junctions                                           | `failures 0`                      |
| `07-interrupt-phases.log.txt` | `interrupt-phases.mjs` | Kills at observed cleanup phases                                                         | `failures 0`                      |
| `10-r3-focus.log.txt`         | `r3-focus.mjs`         | R3 focus after confirm and withdraw                                                      | `failures 0`                      |
| `11-append-bound.log.txt`     | (VM-step probe)        | Append and Resume cost                                                                   | 80/80 and 358/358 VM instructions |
| `06-realistic.log.txt`        | `realistic.mjs`        | 488-run store under pressure                                                             | `failures 0` (see below)          |

`06-realistic.log.txt` was not produced by the QA agent: after the agent stopped, the orchestrator ran the agent's own `realistic.mjs`, unchanged, against the same build on port 6588 (2026-10-27, 00:28 to 00:39 UTC). It is recorded here as the orchestrator's run of that script.

The independent behaviour QA that #412's merge relied on is the later final QA at the merged head `fa53e34a475bcf3c6adb6f088173c1f7abfa37fa`: [`../2026-10-27-pr412-qa-final/README.md`](../2026-10-27-pr412-qa-final/README.md) (PASS, six checks). The earlier records are [`../2026-10-26-wp-e3-412-qa/README.md`](../2026-10-26-wp-e3-412-qa/README.md) (FAIL, D1 to D4) and [`../2026-10-26-wp-e3-412-qa-recheck/README.md`](../2026-10-26-wp-e3-412-qa-recheck/README.md) (FAIL, R1 to R3).
