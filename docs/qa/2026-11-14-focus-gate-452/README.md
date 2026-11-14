# Pairing focus test prerequisite — #452

The current validator candidate's [Linux Gates run](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/43566107320/job/132360273210) reproduced the existing asynchronous-focus assertion race. Main at b3b5e1874a8252cc01c065d18fef42cbfbe075b4 also failed the same recovery and fresh-pairing observations. This bounded test prerequisite is part of the four-intent batch; it does not alter product focus behavior.

GPT-6 Luna at xhigh changed five assertion statements in two test files: four PairScreen checks following the error-focus passive effect and one GoblinApp heading check following fresh pairing. The PairScreen cases cover unavailable storage, typed/link rejected claims, schema/audience recovery failure and failed credential persistence after success. Each now awaits the same `toHaveFocus()` target using the existing `waitFor`. Existing synchronous navigation checks and the already-awaited retry check remain unchanged. No timeout, retry count, coverage threshold or expected target changed.

The source correction is commit `37e2b7dfc74d3d2b86142185faa6bb9c0215ab7b` in PR #461. The identical prerequisite patch is also carried by PR #462. It is separate from the validator and builder production changes.

## Verification

All commands selected project Node 22.23.4.

- `pnpm.cmd --filter @graphgoblin/web exec vitest run src/goblin/PairScreen.test.tsx src/goblin/GoblinApp.test.tsx`: 2 files and 60 tests passed after restoring the negative control.
- Focused ESLint and Prettier checks for those two files passed.
- `pnpm.cmd --filter @graphgoblin/web typecheck`: passed.
- Temporary omission of the two relevant production `focus()` calls made six selected PairScreen cases and one GoblinApp case fail at the required focus assertions. The unchanged assertion deadline remained effective. The negative-control selection deliberately excludes unrelated tests; it is not a coverage run.
- Both production files were restored from captured original bytes in a finally block and their SHA-256 hashes matched. Root also verified their Git diff was empty before committing the tests.

| Restored source                    | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| apps/web/src/goblin/PairScreen.tsx | `130b45d8041aaba3f358da0738c606152134c46044cd20a8b3b7e7248a9f8b4a` |
| apps/web/src/goblin/GoblinApp.tsx  | `7197d1948caf7561c511b84e4a109374b53f7760057b8f06b9e19f3e28db1112` |

## Retained evidence and limits

- [Current PR failure excerpt](candidate-ci-failure.log.txt).
- [Main failure excerpt](main-ci-failure.log.txt).
- [Expanded PairScreen omitted-focus negative control](negative-control-pairscreen-all-same-effect.log.txt): six expected focus failures; two other selected tests passed and 26 were outside selection.
- [GoblinApp omitted-focus negative control](negative-control-goblinapp.log.txt): one expected focus failure.
- [Initial narrower PairScreen negative control](negative-control-pairscreen.log.txt), retained before expanding to the common root cause.

These are implementation verification and retained CI observations. Independent cross-family review, final-current-head CI and Astra audit remain separate gates. This report does not claim the previous failed CI runs passed, complete product acceptance, or close #452.
