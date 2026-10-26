# Changed files by package

All changes are local and uncommitted. This manifest excludes the evidence folder itself; its retained captures and logs sit beside this file.

## API

- `apps/api/src/adversarial.test.ts`
- `apps/api/src/routes/run-history.test.ts`
- `apps/api/src/routes/runs.ts`
- `apps/api/src/run-history.ts`

## Web

- `apps/web/e2e/bounded-history.spec.ts`
- `apps/web/e2e/inspector-large-values.spec.ts`
- `apps/web/e2e/thread-history.spec.ts`
- `apps/web/scripts/projections.test.ts`
- `apps/web/scripts/replay-seed-repro.ts`
- `apps/web/src/__fixtures__/fake-api.ts`
- `apps/web/src/components/ui/bounded-value.deferred.test.tsx`
- `apps/web/src/runs/RunInspectorPage.test.tsx`
- `apps/web/src/runs/RunInspectorPage.tsx`
- `apps/web/src/runs/event-retention.test.ts`
- `apps/web/src/runs/event-store.ts`
- `apps/web/src/runs/follow-run-attempts.test.ts`
- `apps/web/src/runs/follow-run-attempts.ts`
- `apps/web/src/runs/history-browsing.test.tsx`
- `apps/web/src/runs/inspector/ThreadViewer.test.tsx`
- `apps/web/src/runs/inspector/ThreadViewer.tsx`
- `apps/web/src/runs/inspector/Timeline.test.tsx`
- `apps/web/src/runs/inspector/Timeline.tsx`
- `apps/web/src/runs/projections.test.ts`
- `apps/web/src/runs/projections.ts`
- `apps/web/src/runs/useRunEvents.test.tsx`
- `apps/web/src/runs/useRunHistory.test.tsx`
- `apps/web/src/runs/useRunHistory.ts`

## API client

- `packages/api-client/openapi.json`
- `packages/api-client/src/generated/schema.ts`
- `packages/api-client/src/resources.test.ts`
- `packages/api-client/src/resources.ts`

## Domain

- `packages/domain/src/replay.test.ts`
- `packages/domain/src/replay.ts`

## Infrastructure

- `packages/infrastructure/src/sqlite/event-validation.test.ts`
- `packages/infrastructure/src/sqlite/events.ts`

## Tooling

- `tooling/perf/README.md`
- `tooling/perf/browser.mjs`
- `tooling/perf/observers.test.mjs`
- `tooling/perf/summary.mjs`

## Documentation

- `CHANGELOG.md`
- `docs/07-api-and-streaming.md`
- `docs/09-frontend-and-pwa.md`
- `docs/10-testing-and-quality.md`
- `docs/decisions/ADR-0050-bounded-sse-replay.md`
- `docs/reference/api.md`

## Ownership boundaries

`apps/web/src/runs/useRunEvents.ts`: no production ranges changed. `apps/api/src/sse.ts`, `packages/api-client/src/sse.ts`, the application shell and ShutdownNotice are unchanged. RunInspector status badge, waiting/delivery state and control actions remain based on the run record; the changes add history navigation, server evidence and thread reads. The event-store change is consumed by the unchanged hook. API route changes are read-only additions adjacent to the unchanged SSE branch. The explicitly named SSE/shutdown files are unchanged. Reconcile the changed inspector/thread/projection files with #255 execution evidence and lifecycle observation with #185 during integration. No server stored shape, dependency or migration changes.
