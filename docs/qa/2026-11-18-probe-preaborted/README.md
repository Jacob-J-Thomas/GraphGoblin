# PR #505 cancellation before test entry

PR #505 repairs the test fixtures used for the Codex readiness probe. On Windows, Vitest 5.0.3 can cancel a run during a `beforeEach` hook and still enter a test with an already-aborted signal. At the original integrated head, the controlled lifecycle test started four fake CLI processes after cancellation and reported a pass. The direct probe test started zero children and reported the same readiness assertion twice. The [original final audit](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/505#issuecomment-6994615633) held that revision.

The correction checks for cancellation before entering either test wrapper. Vitest receives its original cancellation reason, launches no fake CLI, and reports a user-cancelled skip. A real cancellation still gives the Vitest process exit code 1. The two entry regressions and the running-child regression bring the maintained file to 12 cases. These controls use disposable fixtures and fake Node subprocesses.

| Evidence                                                 | Scope                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Original final finding](final-finding/README.md)        | Both observed failures on the original source, a narrower attempted fix, and two independent entry-check controls. |
| [Claude Code author verification](author/README.md)      | Implementation, old and corrected source comparisons, native runner behavior and adapter gates.                    |
| [Independent Windows behavior QA](independent/README.md) | Separate native checks and source-bound observations for both entries, running work and fault cleanup.             |

The exact pre-correction source was `0ff00d6717bfb397e42bf85db8fe62ed1fc0d9b7`, targeting main at `4cea34be3150a0d7af8a7d4a368eb864291ce47e`. The repaired test-file SHA-256 is `bf35aebd27666194aec20fd08c4168a16c452c7706f18353e6f1afee70f590d4`. The [publication receipt](receipt.json) records the retained bytes. The PR records the bounded Fable correction review and hosted gate outcomes when available.

The existing Windows production timeout residue and a skipped-suite fixture allocation have separate follow-ups. [#506](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/506) · [#511](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/511)
