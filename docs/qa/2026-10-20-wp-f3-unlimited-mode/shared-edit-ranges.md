# Shared production and fixture edit ranges

New-line ranges against base 624aaa9cd4699b20f8330a0cee0b4a7d736c88db; source formatting finalized before capture.

- `apps/api/src/subloop-restart.test.ts`: 198-199 (WP-D1 fixture clock domain)
- `apps/api/src/retired-event-startup.test.ts`: 63-64 (native startup fixture clock domain)
- `apps/web/src/editor/DecisionGateFields.tsx`: 9, 59-60, 62-67, 69-70
- `apps/web/src/editor/LoopSettingsPanel.tsx`: 74-75, 82-87
- `apps/web/src/editor/field-controls.ts`: 1, 18, 35-39
- `apps/web/src/runs/RunInspectorPage.tsx`: 1, 152
- `apps/web/src/runs/inspector/EvaluationDetails.tsx`: 280
- `apps/web/src/runs/projections.ts`: 199
- `apps/web/src/settings/SettingsPage.tsx`: 5, 23
- `packages/contracts/src/evaluation.ts`: 266-269, 317, 320-322, 580, 605, 612-613
- `packages/contracts/src/loop.ts`: 2, 19-48, 52
- `packages/contracts/src/run.ts`: 2, 42-44, 163
- `packages/contracts/src/testing/index.ts`: 72
- `packages/domain/src/convert-v3-v4/index.ts`: 512-515
- `packages/domain/src/graph.ts`: 256-261, 268
- `packages/engine/src/definition-pin.ts`: 37-40
- `packages/engine/src/handlers/decision.ts`: 115
- `packages/engine/src/handlers/inference.ts`: 224-230, 407-435
- `packages/engine/src/run-manager.ts`: 1-7, 290, 1139-1140, 1185-1212, 1235, 1375-1376, 1453-1454, 1529-1536, 1555-1559, 1562, 1565, 1617-1624, 1659-1671, 1857
- `packages/engine/src/testing/admission-contract.ts`: 106
- `packages/infrastructure/src/claude/harness.ts`: 45, 46, 178, 409, 430
- `packages/infrastructure/src/claude/process.ts`: 13, 97-103
- `packages/infrastructure/src/claude/protocol.ts`: 429, 536

The only WP-D2 finalization edit is the condition on run-manager.ts line 1857: deadline failure uses the existing child-cancellation finalizer. WP-D1 subloop/script recovery and WP-F1 API admission/readiness production code are unchanged. The inference handler adds the narrow retry path while retaining WP-F4 submission classification.
