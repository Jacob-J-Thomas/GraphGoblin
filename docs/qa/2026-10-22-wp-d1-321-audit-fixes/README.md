# #321 final-audit fixes: B1 and B2

Base `ccb69b812b04a4128a671c581a5c731de5bd3def`, branch `codex-wp-d1-child-recovery`. Work is uncommitted; Claude review and independent QA remain separate. The orchestrator owns B3 and `../2026-10-22-wp-d1-321-qa/`; this round does not change that bundle.

## Reproduction before correction

Built the unchanged head with Node 22.14.0 and `pnpm.cmd build`. Added regressions first, then ran them against that build. [Before API](before-api.log.txt): all three regressions failed. [Before engine](before-engine.log.txt): five regressions failed, eleven controls passed.

- **B1, progress and completion:** after a real marker produced one effect, a SQLite `BEFORE INSERT ON run_events` trigger refused either `node.progress` or `node.finished` for that run's `script` node with `RAISE(ABORT, 'WP_D1_OUTCOME_FAULT')`. Both outcomes became `INTERNAL_ERROR`, with no script provenance; hard kill/restart preserved that generic failure. Dropping the trigger and explicitly resuming produced marker count 2. Both failed the required typed-failure assertion: `- "code": "SCRIPT_OUTCOME_UNCERTAIN"`, `+ "code": "INTERNAL_ERROR"`. This reproduces the audit's two persistence paths on this head.
- **B2, constructed pre-change history:** after the real marker produced one effect, killed the built API, released its orphan and observed exit. Removed only that run's tail `script.dispatched` event and set `runs.last_event_seq` to the remaining maximum. This is the previous build's valid unfinished script prefix, not execution of an archived binary. Restart automatically succeeded with marker count 2, without Resume or Replay: `AssertionError: expected 2 to be 1 // Object.is equality`.
- **Engine:** generic/different-visit/different-dispatch failures and an interrupted markerless visit each failed `AssertionError: expected [Function] to throw an error`. The pre-dispatch acknowledgement-loss case failed `expected [ { command: 'effect', …(5) } ] to have a length of +0 but got 1`.

The regression is `apps/api/src/script-persistence-restart.test.ts`; it uses the real SQLite file and built API, hard kills, restarts and actual marker effects. No private component access, test-only production export, provider turn or schema migration is involved. The driver allocates ports 5690–5699 and `%TEMP%/gg-wp-d1-outcome-*`. `GG_WP_D1_KEEP_STORES=1` retains this round's owned stores for inspection without directory deletion; normal CI fixture disposal remains available.

## Implementation and exact markerless-visit rule

Only a `run.failed` whose script provenance matches the node, visit and dispatch can dispose a pending dispatch. Before writing a failure, the manager classifies an unfinished script against its durable history. Generic post-dispatch progress/completion bookkeeping failures become `SCRIPT_OUTCOME_UNCERTAIN` with the original identity. Matching typed completed/start-failed outcomes retain their existing class. Existing inspector and MCP presentation receive the typed failure and provenance; their visibility rules do not change.

The executor appends `node.started` for each handler entry. The first fresh entry can run if it has no earlier unfinished start and no pending dispatch. Re-entering a visit with an earlier unfinished start but no marker is uncertain, whether the prefix came from an earlier build or a current-build crash before dispatch. A recorded completion ends the visit. A recorded failure without a dispatch ends that attempt; execution after failure still requires explicit Resume. When a dispatch exists, only matching typed provenance disposes it. Explicit retry retains the visit identity and writes a fresh dispatch ID. No new stored marker, parser, migration or exactly-once guarantee is added.

## Verification

Both native findings now pass (3/3); the engine selection passes 16/16. Full coverage: engine 560 passed; MCP 44 passed; API 708 passed / 1 failed / 6 skipped. All coverage thresholds pass. The API failure is the inherited #320 zero-delay 60-second disposal hook; it passed once unchanged in isolation, and the full red result is retained. C6 passed. Root formatting fails on three protected QA Markdown files, which remain untouched. The [eight-section report](report.md) records the exact commands, shared-file ranges, upgrade rule, remaining audit notes and retained-store inventory. Source changes are limited to `handlers/script-dispatch.ts` and failure classification in `run-manager.ts`; script handler, process start/output capture, #320, web and MCP runtime code are unchanged.

## Non-blocking audit items

N1 (client-observed attempt precondition) requires a separate API/MCP/UI recovery contract and remains open. N2 gate reliability is reported with the original failure and any single isolation result, without retry-to-green. N3 bounded safe runner diagnostics remains open; it does not change the conservative classification. N4 inherited local paths belong to a separate documentation cleanup. The incorrect unrestricted markerless-recovery and upgrade wording is corrected in docs/04, docs/05, guide 07 and the `(#321)` CHANGELOG bullet. The UoW remains #184/U11; no #301/U12 label is introduced.
