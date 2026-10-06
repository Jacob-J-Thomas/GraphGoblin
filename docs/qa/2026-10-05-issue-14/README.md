# Issue #14: basic fields first, advanced options behind a disclosure

Screenshots of the node editor after #14, in Edge at 1440 px wide, dark and light, taken from the E2E server (in-memory database, built app) on 2026-10-05. Each shows the whole dialog.

| File                                     | What it shows                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `inference-collapsed-{dark,light}`       | The inference basic set (harness, model, effort, session, prompt, sandbox) with help under each field, then Advanced collapsed, saying "1 set" |
| `inference-advanced-{dark,light}`        | Advanced open: the Context, Harness options, Output, and Limits sections                                                                       |
| `inference-collapsed-error-{dark,light}` | Advanced collapsed again after an invalid timeout: "2 set" and "1 error", with the node's badge beside the title                               |
| `script-collapsed-{dark,light}`          | Script: command, args, cwd, then Advanced collapsed                                                                                            |
| `script-advanced-{dark,light}`           | Script's Advanced open: Process (env, timeout) and Input and output (stdin, stdout, exit code routes)                                          |
| `decision-collapsed-{dark,light}`        | Decision: routes, question, strategy, and the strategy blocks, then Advanced collapsed (context, record alternatives)                          |
| `subloop-collapsed-{dark,light}`         | Subloop: the loop reference, Input mode, and Output mode, then Advanced collapsed (the other mapping fields, the depth limit)                  |
| `mutate-{dark,light}`                    | Mutate: each operation collapsed to its kind and path, with Remove beside it                                                                   |
| `mutate-open-{dark,light}`               | One operation opened                                                                                                                           |
| `trigger-{dark,light}`                   | A manual trigger: every field in sight as before, now with help, and no Advanced section                                                       |

The behaviour is described in [09 - Frontend and PWA](../../09-frontend-and-pwa.md), "Basic and advanced fields"; the regression specs are listed there.
