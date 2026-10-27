# Integration execution notes

The complete commands and exit codes are in [checks.json](checks.json). These observations apply to the integrated worktree, not the historical scan-1 tree.

## Infrastructure coverage and D-015

The full command exited 1: 859 passed, seven failed, 866 total. It measured 98.10% lines and 94.32% branches. Six failures concern native shutdown: `src/adversarial.test.ts:225` process-tree cancellation; `src/claude/process.test.ts:69`, `:84` and `:150` deadline/cancellation/descendant shutdown; `src/claude/readiness.test.ts:62` hung CLI termination; and `src/process/scripts.test.ts:157` cancellation with incomplete UTF-8. The log records live children, continued marker writes, unconfirmed termination and EBUSY cleanup. See [full output](infra-coverage.log.txt).

A separate bounded probe spawned exactly its own five-second Node child and invoked `taskkill /PID <that child> /T /F`. The command exited 1 with `ERROR: Access denied`; the child remained alive and subsequently exited by its own timer. [Current permission evidence](native-permission.json). Under D-015, those native shutdown qualifications are **NOT RUN / sandbox-blocked**, never passes. No escalation, broad process termination or manual directory deletion was attempted.

The seventh failure was an integration fixture, not a native denial: SQLite readiness expected two pending migrations after 0021 but found three. The fixture now includes the 0024 intent columns, derives counts from the shipped ledger, and retains all old history/index assertions. Its focused file passes **23/23**, followed by passing infrastructure typecheck and lint. See [focused verification](readiness-focused.log.txt). Production source did not change after the full coverage run. The unchanged native suite was not retried, and the full coverage gate remains recorded as nonzero.

## API coverage and installed SDK qualification

The full API command exited 1: **1,668 passed, 12 skipped, two failed** (1,682 total). It measured **96.22% lines and 90.79% branches**. Both failures are in `apps/api/src/shutdown-console.test.ts:268`: "The gateway exited with code 0 after one Ctrl+C instead of draining", in the first-Ctrl+C drain and later-Ctrl+C force cases. [Full output](api-coverage.log.txt).

The merged source patch and Codex harness/options match main exactly, but the installed SDK still lacks the merged `windowsHide` change. See [source/runtime audit](integration-audit.json). These two observed failures are not classified as confirmed taskkill denials: their cause has not been isolated. The installed SDK/console behavior is **unqualified**, and the API coverage gate is **not a pass**. The orchestrator must refresh this worktree's dependencies from the merged lockfile before qualifying #417's native console behavior. No dependency files, links, manifests or machine configuration were changed here; no live provider turn was used. COMMON section 2 supplies the dependency boundary.

The current focused recovery/API group passed **54/54**, including the canonical-source/deletion-revocation integration case, the original `infer`/`sub` pinned replays, missing-session recovery and script restart/consent cases. This narrower success does not replace the nonzero full API result.

## Other completed coverage

- Engine: **1,738/1,738**, **97.01% lines**, **91.13% branches**, passing full gate.
- API client: **98/98**, **100% lines**, **97.05% branches**, passing full gate after regenerating the merged contract.

Web coverage passes **1,810/1,810**, **98.93% lines** and **94.76% branches**. The full Edge suite was run once, exit **1**, final counts `{'failed': 13, 'skipped': 1, 'passed': 422}`. See [complete browser output](edge-full.log.txt) and [relevant case results](edge-summary.json). No retry-to-green run was made. Final migration validation and Drizzle generation pass; client/docs regeneration is hash-identical: [generator idempotence](generated-idempotence.json).

## Browser consumer corrections

The single full Edge run found 12 strict-schema failures (`Unrecognized key: "recovery"`) in exit, large-value and live-follow specs. These callers now parse GET snapshots with `RunSnapshotSchema`; command envelopes retain `RunRecordSchema`. My new Claude assertion also expected the wrong refusal code after cancellation; it now expects the observed `409 RUN_CANCELLED`, while preserving the unconfirmed-termination failure checks. No production behavior, replay node or UI assertion was weakened. Exact before-fix contexts are retained as UTF-8 text under `full-edge-errors/`, alongside the complete full-run log.

A first focused launch was interrupted after diff review found a Unicode encoding error in my fixture-edit script. The original main Unicode text was restored from Git bytes and the nine intended GET-schema edits reapplied with explicit UTF-8; its partial log and wrapper interruption are retained, with no Playwright result claimed. The corrected affected-spec run used a fresh task-temp output directory and zero retries. It exited **0**, with final counts `{'passed': 24}`: [output](edge-consumers.log.txt), [cases](edge-consumers-summary.json). The complete suite was not rerun, following the one-full-run instruction. The full-run result remains 422 passed, one live-provider case skipped and 13 before-fix failures; current focused success does not turn that original gate green. Production web source was unchanged after its passing coverage run.
