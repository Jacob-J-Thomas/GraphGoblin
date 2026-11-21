# #363 structured scratch-directory author handoff

Frozen candidate **76beeb0f2e99343697578c2713ac06f80d59e7b5**, tree **2544bc2913f9cec0d95a215ea631ab62c7985c1d**, sole parent signed main **02351e2fb932b3be44e7cc3fb3943a61d568226c**. Clean branch codex/gg-i4-363-structured; four files, +278/−6. No push, PR, issue, merge, paid-provider, owner configuration/store or service operation.

## Bounded change

Only the default freshTempDir allocator changes runtime behavior. It exclusively creates a short gg-structured- name with eight random hexadecimal characters using mkdir, mode 0700. It retries EEXIST up to four total attempts; any other creation error propagates immediately. Cleanup ownership is returned only after successful creation. A colliding directory is never reused or removed.

The existing options interface, parseLoose, complete(), request-over-option working-directory precedence, abort/cancel processing, primary-error precedence and cleanup flow remain unchanged. No new injection surface, shared helper, package, dependency, schema or runtime policy was added. cli.ts, options.ts and the delivery register are unchanged. Numbered docs and CHANGELOG describe the bounded path improvement without unlimited OS/CLI path support.

## Actual baseline and corrected controls

On this Windows host with Node 22.23.4, the original production allocator failed the new public complete() case under a real 226-character temporary root: **ENAMETOOLONG from mkdtemp**, before the source's harness-start call. The selected baseline run exited 1, with one failed case and ten explicitly skipped cases, 4.64s. The original log, pre-run hashes and exact failed production/test bytes are retained.

The corrected exact structured.test.ts passed **21/21**, exit 0, 5.95s. Its real 226-character root reaches the fake harness with an empty 249-character scratch directory, then verifies removal. The existing ten tests and eleven new controls cover:

- Ordinary completion and the real long-root boundary, with no paid/native Codex turn.
- One real mkdir-produced EEXIST followed by success, and four real collisions causing bounded exhaustion. Existing markers remain readable and allocator cleanup never targets them. Test-owned case teardown happens only after those assertions.
- A controlled non-collision EACCES error propagated by identity after one attempt, no harness start and no cleanup. This is an injected filesystem-boundary error, not a host permission experiment.
- Already-aborted requests, abort during actual successful allocation with cleanup success/failure, and retained cancellation-settlement precedence.
- Synchronous harness rejection with cleanup success/failure, successful result despite controlled cleanup failure, and the existing asynchronous primary-failure control.
- Request directory over configured directory, no allocator/cleanup calls for either, and preserved caller markers.

These are native filesystem plus public-method/fake-harness observations. They do not prove an arbitrary Codex CLI/provider operation or every child-file path works at that length.

## Terminal author checks

| Check                                 | Result                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Offline frozen install                | Exit 0, Node v22.23.4 / pnpm 12.8.1, 34.6s; lock unchanged                       |
| Baseline long-root selection          | Expected exit 1, ENAMETOOLONG; 1 failed / 10 skipped                             |
| Corrected exact structured test file  | Exit 0, 21/21                                                                    |
| Focused adapter lint / typecheck      | Each exit 0                                                                      |
| Four-file Prettier / git diff --check | Each exit 0                                                                      |
| Allocator-only source comparison      | complete/parseLoose/export tail and existing options interface identical to base |

No full build, coverage suite, browser suite or pnpm check was run under the coordinator's resource allocation. Coverage thresholds and exclusions remain unchanged; exact combined-source CI must still enforce the numerical gate. No provider/login/preflight command or owner service was selected.

## Evidence and remaining gates

source-binding.json records the exact commit, Git blobs, diff, unchanged owned-boundary source and command-result hashes. Baseline production/test files were recovered from the unchanged Git base and exact recorded first test patch, then byte-hash matched to baseline-input.json captured before execution. baseline-source-preservation.json records that reconstruction; the files are not mislabelled as copies made at execution time. Original logs are unchanged.

Independent QA, actual opposite-family Claude review, exact-head/current-target CI and fresh Astra MAX final review remain coordinator-managed. This author result does not close #363, complete intent 4, qualify arbitrary long paths or complete any owner acceptance gate.
