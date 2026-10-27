# Execution qualifications

## Native process boundary - NOT RUN under D-015

Infrastructure coverage reported 862 passing tests and seven failed native cases (exit 1), with 98.12% lines and 94.26% branches. Numerical coverage is not a pass. [Fresh owned-child probe](native-permission.json) returned `ERROR: Access denied` for taskkill of only its own finite five-second process. That child remained alive and exited naturally with code zero. No alternate kill mechanism or isolated rerun was used to turn a denied termination assertion green.

- `src/adversarial.test.ts:225`: child/grandchild abort left a locked directory (EBUSY).
- `src/process/scripts.test.ts:157`: cancelled incomplete-UTF8 process still alive at assertion line 203.
- `src/claude/process.test.ts:69`: deadline/output-limit cleanup left EBUSY.
- `src/claude/process.test.ts:84`: cancellation cleanup left EBUSY.
- `src/claude/process.test.ts:96`: the exited-root/output-close case returned `terminationUnconfirmed` at line 139. This additional native qualification is not counted as a pass or assumed fixed.
- `src/claude/process.test.ts:150`: descendant marker kept growing at line 199, with EBUSY teardown.
- `src/claude/readiness.test.ts:62`: termination-unconfirmed diagnostic instead of confirmed deadline exit.

All assertions and native production code are unchanged. See [the complete invocation](infra-coverage.log.txt). Disposable locked fixtures remain for orchestrator cleanup; no directory-deletion sweep or other-worker process operation occurred.

## Native consent reproduction

The before/after probes use real SQLite, the built HTTP API and a finite marker-producing Node script; provider turns are not used. Only the dependency acknowledgement after a committed failure append is delayed. The original draft omitted its `effect.mjs`; [adaptations](probe-adaptations.json) disclose the supplied finite exit script. The after probe proves one effect during refused choices, then a distinct explicitly consented Replay produces the second effect. It does not qualify tree termination or graceful shutdown. Its exclusively owned fixture API was stopped by the copied helper's SIGKILL fallback ([process result](after-native-processes.json)); that cleanup is separate from D-015's denied native tree checks. No taskkill denial was routed around.

The original audit directory was read only. `before-probe-*` and `after-probe-*` preserve the executed source variants. Copy them into a fresh task-prefixed system-temp directory, stripping the variant prefix, before executing; their result files intentionally write beside the copied scripts. Run from the built worktree with project Node first on PATH, `GG_AUDIT_REPO` set to that worktree and `GG_QA_ROOT` to a fresh system-temp `gg-wp-d5-scan3-*` child. Native port is 6375. The original before native script exits zero when it reproduces the defect; the corrected after script asserts product refusals. Those meanings are distinct.

## Capped path

The independent scan stopped without a verdict. These are implementation fixes and verification, not a new independent scan. Base-head green CI and independent QA remain historical. The orchestrator must review, commit, obtain independent behaviour QA and green CI at the resulting head, then record the capped disposition. No owner product decision is needed.
