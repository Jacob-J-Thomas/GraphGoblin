# Inspector credentials and reflow: #562 / #563

**#562 PASS. #563 PASS WITH LIMITS** (native browser zoom and a physical touch screen are not
established). Combined independent QA also passed #561 and the #575/#577 regression. The code
review is ready for opposite-family review, with no P1 or P2 findings open. Before it was fixed,
QA's Q1 was a P2 failure of #563. It was fixed in `ec5c2bb33` and verified in Edge. The original
failure is kept below.

## Candidate

- Branch `codex/gg-fu-inspector-562-563-20261124`, base `14ea69842` (includes #575/#577).
  - `e7e665237`: bind inspector writes to the accepted API key, and reflow the inspector at 320 px
    with 200% text.
  - `ec5c2bb33`: keep a waiting run's input form inside its card at 320 px with 200% text (QA Q1).
  - `751bd0ba2`: merge of `origin/main` at `4e1037c9e`. `CHANGELOG.md` was resolved as a union;
    main's lines are all kept.
  - This packet is committed on top.
- QA tested a combined tree with #561 (PR #592): `7d971876` first, then `2a3de9df` after the Q1
  fix.

## Behaviour

### #562: inspector writes follow the accepted API key

Every inspector write is bound to the opaque accepted-credential generation it was chosen under:
pause, resume, cancel, replay, script recovery, Start fresh session, input and signal answers, and
the delete-ready preview and confirmation. The app's API-key fetch compares that generation in the
same step that reads the key to send, after every queued and middleware await, and refuses without
calling `fetch`.

- **An open review** closes when another key is accepted, a key is rejected or forgotten, or the
  same key is accepted again after a rejection. It says "Review closed: this browser's API key
  changed. Nothing was sent. Open Replay... again to choose with the current key." Focus returns to
  the trigger, or to the status line when the trigger is disabled, and is never taken from the API
  key panel.
- **A write queued before dispatch** sends nothing and says "Not sent: this browser's API key
  changed before {action} was sent. Choose it again to send with the current key."
- **A write already sent** stays the one request. When it settles under another key, its IDs,
  error text, new run and navigation are not shown; it says "{Action} was requested before this
  browser's API key changed. Its outcome isn't shown under the current key; check Runs before
  trying again."
- **Unchanged:** saving the already-accepted key keeps reviews and consent. Server authorization,
  the actor model, the event-qualified header and #575's outage boundaries are unchanged.

### #563: reflow at 320 px with 200% text

- **Page:** at 320 px with computed 200% text the document is 320 px wide, with no hidden or
  truncated text and no smaller text. It was 469 px on the pre-change build.
- **Shared header:** it grows and wraps. Menu moves to its own row below 640 px, the nav links wrap
  from 640 px, and the menu panel opens at the header's actual bottom edge.
- **Inspector layout:** the page is one shrinkable column. The run ID, replay origin, Resume reason
  and selected-event text wrap anywhere, and the run ID is still selected and copied exactly.
- **Run header:** the controls column takes at most half of it, which removes the 1440/200 overlap
  of the controls over the run ID.
- **Buttons:** the run, review, history, Timeline paging and `JsonSchemaForm` submit buttons wrap
  their labels.
- **Waiting runs:** a run waiting for input, with or without an input schema, keeps its prompt and
  form inside the Input requested card.
- **Unchanged:** layouts that fit are within 0.5 px of the pre-change build. DOM order, accessible
  names, the keyboard order and the Timeline's single tab stop are unchanged.

## Design and decisions

- **Design.** The [Claude design critique](raw/design/DESIGN.claude.md.txt) and the
  [root adjudication FUP-076](raw/design/ROOT-DESIGN-ADJUDICATION.md.txt) fixed four things:
  - a live opaque credential-generation boundary checked at dispatch for all inspector writes;
  - separate copy for expired, unsent and already-sent outcomes;
  - suppression of already-sent outcomes from an old generation;
  - the Claude-designed reflow.
- **Author deviations, all accepted by the review.** Each was driven by baseline evidence:
  - the header wraps from 640 px as well;
  - the run-header controls column uses `fit-content(50%)`;
  - label wrapping applies beyond the history buttons;
  - an inherited `wrap-anywhere` contains Disclosure and ThreadViewer text from outside the write
    paths;
  - the header uses `py-1.5` below 640 px;
  - the credential equality checks `{generation, rejected}` together.
- **Fixture relabels.** Three cells were changed from "unchanged" to "reflow", because they failed
  their own containment checks on the pre-change build: the MATRIX 1440/200 cells, and the header
  at 640/200 and 768/200. The inspector route's 1440/200 cell is also recorded rather than held
  unchanged. No assertion was removed.
- **Scope decision (orchestrator, delegated blocker authority).** For QA Q1,
  `apps/web/src/forms/JsonSchemaForm.tsx` and its test were admitted into #563's write paths,
  because the issue's acceptance requires them. The alternative, deferring Q1 and leaving #563 open,
  was rejected because the overflow is exactly #563's symptom. This is recorded in the orchestration
  `PLAN-STATUS.md`.

## Author evidence

Full report: [AUTHOR-REPORT.md.txt](raw/author/AUTHOR-REPORT.md.txt).

All runs used Edge with workers 1 and retries 0, Node 22.23.4, and Ollama disabled, under the
machine's heavy-suite lock.

| Run                                                                            | Result                                                               | Raw                                                                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Baseline, both specs, unchanged `dist` (28/28 files equal the contract hashes) | 8 passed, 22 failed (expected #562 and #563 reds)                    | [log](raw/author/logs/browser-baseline.log.txt), [hashes](raw/author/hashes/baseline-dist.sha256)                        |
| Candidate, both specs                                                          | 30/30                                                                | [log](raw/author/logs/browser-candidate.log.txt), [hashes](raw/author/hashes/candidate-dist.sha256)                      |
| #575 plus regression, 11 specs                                                 | 53/53                                                                | [log](raw/author/logs/browser-575-regression.log.txt)                                                                    |
| Q1 baseline: waiting runs on a rebuilt 14ea69842 `dist`                        | 2 failed at 320/200 (469 px), as expected                            | [log](raw/author/logs/browser-q1-baseline.log.txt), [provenance](raw/author/geometry/browser-q1-baseline.PROVENANCE.txt) |
| Q1 candidate, run 1                                                            | 32/33. A race in the new test: it measured before the Timeline rows. | [log](raw/author/logs/browser-q1-run1-timeline-race.log.txt)                                                             |
| Q1 candidate, run 2 (the test waits for the rows; no assertion changed)        | 33/33                                                                | [log](raw/author/logs/browser-q1-candidate.log.txt)                                                                      |
| Q1 #575 plus regression                                                        | 53/53                                                                | [log](raw/author/logs/browser-q1-575-regression.log.txt)                                                                 |
| Web coverage after Q1                                                          | 3245 tests; lines 98.71%, branches 94.56%                            | [log](raw/author/logs/q1-web-coverage.log.txt), [summary](raw/author/web-coverage/q1-web-coverage-summary.json)          |
| After the merge: typecheck, lint, `pnpm format:check`, focused groups          | clean, 0 errors, clean, 57/80/102/79                                 | [post-merge](raw/author/logs/post-merge/)                                                                                |

- **Rebuilt baseline.** The rebuilt 14ea69842 `dist` matches the recorded baseline byte for byte
  for every served JS, CSS and `sw.js` file. Only `sw.js.map` differs.
- **Geometry.** Baseline and candidate geometry and the comparison files for representative cells
  are in [geometry](raw/author/geometry/): matrix 320/200, matrix 1440/200 and the waiting runs.
  Cells meant to stay unchanged hold 0 differences beyond 0.5 px.
- **Screenshots.** Before and after of the [1440/200 run header](raw/author/screenshots/), the
  waiting card at 320/200, and the #562 closed-review status.

## Review

The [review](raw/review/REVIEW.md.txt) (Claude Opus 5.5, independent of the author) covered
`e7e665237`, with Addendum 2 for `ec5c2bb33`. It found no P1 or P2 code-review findings.

| ID      | Severity | Finding                                                                                                      | Disposition                     |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| F1      | P3       | An expired review says "Nothing was sent" even when an earlier attempt from it was refused under the old key | DEFER-ISSUE                     |
| F2      | P3       | A write whose own 401 rejects the key is reported as "requested before the key changed"                      | DEFER-ISSUE (copy decision)     |
| F3      | P3       | The inspector-route 1440/200 exemption also stops holding the header boxes                                   | NO-CHANGE                       |
| F4      | P3       | `fit-content(50%)` changes 640–1439 px at 100% where the controls are wide                                   | NO-CHANGE; QA found it improves |
| Note    | P3       | The wrap class string is duplicated between `forms/` and `runs/inspector`                                    | NO-CHANGE                       |
| Note    | P3       | The New run spec records `documentWidth` without asserting it                                                | NO-CHANGE (QA asserts it)       |
| Q1 (QA) | P2       | A waiting-for-input run overflowed to 326 px at 320/200                                                      | FIX-IN-PR, fixed in `ec5c2bb33` |

## Combined QA

The [QA report](raw/qa/QA-REPORT.md.txt) was written by a separate Claude Opus 5.5 session on
real Edge against the built API, with keys required, two real keys and a real second tab.

| Issue                | First run (`7d971876`)                                                                                   | After Q1 (`2a3de9df`)                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| #562                 | PASS: 14/14 product cases; 3 harness-expectation misses kept                                             | PASS                                                                                 |
| #563                 | **FAIL (Q1)**: matrix 202/206 (2 harness artifacts, 2 Q1); a waiting-for-input run was 326 px at 320/200 | **PASS WITH LIMITS**: 128/128 Q1 cells; 320/200 is 320 px; New run unchanged at 100% |
| #561                 | PASS, 7/7                                                                                                | PASS                                                                                 |
| #575/#577 regression | PASS: 53/53, and 30/30 new specs                                                                         | PASS: 53/53, and 33/33 new specs                                                     |

Raw files: [562 results](raw/qa/562-results.jsonl), [Q1 results](raw/qa/q1-results.jsonl), the
[Q1 culprit probe](raw/qa/q1-input-card-culprit.json) and the spec logs in [qa](raw/qa/).

Other QA observations:

- A coarse pointer (emulated) passed.
- The double-click harness misses at 768/200 were diagnosed as a click in the gap between the two
  lines of the ID, not a defect.
- At 768 and 1024 px with 100% text, the pre-change build clipped the run ID under Pause, and the
  candidate shows it in full (F4).

## Not established

- True native browser zoom at 200%. Only computed root-font doubling was measured, because both
  zoom attempts failed to apply.
- A physical touch screen. Touch was checked by emulation only.
- A server-side audit of every write key on the plain built API. Pause, resume and cancel carry
  API actors. Replay, input, signal and delete-ready keys come from browser request headers; the e2e
  credentials spec's server audit covers Replay.
- Combined-tree package-wide coverage, lint and format. The author ran coverage on the branch, and
  ran static checks and focused tests after the merge.
- A #561 body interruption combined with a credential change in the same case.
- Hosted CI on the publication head.

## Remaining gates

The opposite-family GPT review (formal 1) and the fresh Astra MAX final audit are pending until
2026-11-28, followed by current-target CI. Owner acceptance is separate. [MANIFEST.json](MANIFEST.json)
lists every member except itself with its size and SHA-256. Raw bytes are kept with
`-text !eol -whitespace`.
