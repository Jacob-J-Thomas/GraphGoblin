# Intent 5, first truthfulness delivery: #386 and #385

You are the actual Claude Code Opus5.5/xhigh UI designer and implementer. Root GPT owns architecture and this bounded contract. Work in the exact clean signed-main checkout supplied by the runner, head3a6943a136594162665667a7a55e2b46520912eb/treea88175975c42062a08e3012a7f106396be0c685f. The user approved continued delivery with all AIDLC gates, Claude for UI, cross-family review and independent QA. D222 admitted these issues after signed PR553. Implement a small, reviewable correction and meaningful regressions. Do not implement #416/#420 yet.

## Tool and file authority

Only Read, Write, Edit, Glob and Grep are available, confined to this checkout. No shell, Git, provider recursion, browser, MCP, networking, account/key/private configuration or global setting access. Do not attempt to work around unavailable tools. Root runs all commands, tests, builds, formatting and browser checks, and performs publication. Only the literal write paths in the runner's scope are authorized. Source files elsewhere may be read to understand contracts; no private files or evidence archives. The checkout sparsely omits docs/qa. There is no image context directory.

Safe mode disables automatic repository instructions; explicitly read AGENTS.md, docs/README.md, relevant sections of docs/12-implementation-plan.md, docs/15-issue-workflow.md and docs/09-frontend-and-pwa.md. Apply their rules: TypeScript strict/NodeNext .js imports, clean package boundaries, no any casts, >=90% lines/branches, no lowered thresholds/exclusions/skips/retries, behavior documentation and CHANGELOG in sync, no compatibility path or stored-content migration. This change adds no dependency, package, schema, store/cache format or backend/API path. Existing independent review/QA/current-target CI/final AstraMAX/merge gates remain pending after your work. Do not claim tests you cannot run.

Budget this author pass to the necessary reads and edits; avoid repository-wide exploration or unchanged file rewrites. Aim to finish within45 tool turns. Your CLI has a bounded estimate limit. If the architecture contract exposes a concrete impossible condition, report it explicitly instead of silently broadening scope. You should critique the contract and implement a sound bounded interpretation; ordinary implementation choices are yours. End with changed paths, design explanation, proposed verification commands and material remaining concerns, not a passing QA verdict.

## #386: confirmed defect and chosen architecture

The original issue requires: once Timeline shows a terminal event, the header shows its execution status; keep the existing apps/web/e2e/claude-harness.spec.ts succeeded assertion exactly unchanged. Refetch-only is insufficient because a run request may remain in flight, and invalidation already exists/coalesces at500ms. Do not change polling/coalescing/read budgets or stream completion semantics merely to pass a test.

Root selected presentation-only status evidence. Keep a bounded per-run current lifecycle/phase observation independent of the displayed/selected history window. Accepted streamed batches must update it before event-cache trimming, including while browsing older history. Existing whole-run observation.lifecycle may supplement it; merge validated run IDs and event order so a delayed older observation/response cannot undo newer observed lifecycle. Keep only small metadata needed for header presentation, not complete result/failure/initialThread payloads. Prefer ephemeral hook-owned metadata; do not alter the persisted event-store shape/version or backend contracts.

Source facts you must account for:

- SQLite append writes runs.lastEventSeq with the event and notifies subscribers before the later run-status projection. A run row at exactly terminal.seq may still say running. Row lastEventSeq is not a status-version counter. A later delivery/audit event can advance it while execution remains terminal.
- The header currently takes run.status directly. RunInspectorPage.tsx separately has useRunEvents, runQuery and observation. useRunEvents calls onEvents with accepted batches; history mode discards fresh payloads from the displayed window but advances the live cursor. A selected old terminal or truncated window is not current-run status.
- /runs/:id/observation.lifecycle is the latest lifecycle marker, including started/resumed/finished/failed/cancelled. Its separate finished field may refer to an older attempt. Do not unconditionally use that field. Do not replay summarizeRun on an incomplete window to invent phase.
- A later started or resumed event supersedes an old terminal immediately, even for the same run ID. run.resumed has no phase/attempt field and can return to a parked wait; it does not prove running. While only supersession is known, show a small neutral **Updating status…** indication until a supported phase or current matching record is available. Never keep showing the invalidated old terminal or invent running from resume.
- Track coverage/provenance when comparing a captured row with observed events. A row tail beyond the evidence currently known can represent either a delivery audit or an unseen resume. Do not let an old terminal latch override a newer record indefinitely. Known later delivery events do not erase a terminal outcome; uncertain unseen history should yield synchronization rather than fabricated status. On reload/navigation, cached historical terminals alone are not a current forever-latch. Distinguish same-run latest live evidence from old callbacks and reset on different run identity.
- Use the actual terminal status for run.finished, failed for run.failed, cancelled for run.cancelled, and preserve exhausted where recorded. Nonterminal/unsupported finish status must not be silently fabricated as success. A supported active phase is separate from transport EOF or stream.complete.

The result is HEADER PRESENTATION ONLY. Do not overwrite RunSnapshot/query cache, run.status, failure/result payloads, recovery tokens/permissions, finishedAt/finalizedAt, delivery state, RunControls, ScriptRecovery, session recovery, WaitPanel or input/cancel behavior. Existing server contracts remain authoritative for those. A terminal badge does not prove finalization/cleanup or grant Resume/Replay. Avoid retaining a stale active-position claim next to an observed terminal or unresolved status; hide or plainly qualify that header position. Claude owns the minimal visual treatment and accessible wording within the existing components/tokens.

The current QueryState hides the inspector on a refused run read. That is #416's separately ordered outage-retention unit. Do not add full outage retention/global QueryState changes here. Delayed/in-flight reads and successfully returned stale rows are #386. Preserve truthful read refusal; no infinite retry added.

Root's separate baseline experiment at this exact tree used real React/api-client through FakeApi/renderApp (controlled component evidence, not a real server/browser or historical-incident cause). Both intended terminal badge assertions failed:
1. Timeline displayed #3 run.finished succeeded; two subsequent GETs were held; no row returned; badge running.
2. The held reads were released with status running,lastEventSeq3 equal terminal.seq3. A visible refreshed node label proved that row rendered; badge still running.
The first setup-only selector error is retained separately. No product source changed. The corrected baseline fixture is appended below for reference. Its node-label witness can change if your correct header intentionally suppresses stale position; retain proof that the stale response was consumed and the terminal badge assertion, not a required stale node label.

Add meaningful tests through the public component/hook boundary and a deterministic browser case in the new spec (root will execute them). Cover the held-response/equal-sequence cases, actual terminal variants, later known delivery evidence, history browsing/eviction/oversized payload boundaries, same-ID resume/start/parked resume, late old observation/record, different-run navigation, and transport-completion separation. Pure helper tests may cover combinatorial state transitions, but the original bug must be established through rendered header/timeline behavior. Preserve the original browser assertion rather than increasing its timeout. Keep tests finite, correctly typed, without sleep-based ordering or provider billing.

## #385: verify existing correction; avoid unnecessary production change

The issue described append Before(absent),After(absent). Current patchDiff already uses op.value for add operations, and projections.exact-values.test.ts covers repeated/nested/null appends. This is the desired source-of-truth behavior: do not use the final array's last element for every earlier append. Preserve every non-add operation's existing semantics and literal object '-' handling.

Add any missing meaningful regression for add /messages/- and add /vars/list/-, showing Before absent and After exactly the recorded appended value. Supply public inspector evidence tests selecting real node.finished patches through the normal ThreadViewer/patch view, with multiple appended values/nested arrays so a final-array shortcut fails. A new browser spec may exercise the built disposable API's ordinary event/run paths using repository fixtures. No live provider is required. If current production already satisfies all criteria, leave projections.ts unchanged and clearly recommend an evidence-backed issue disposition after independent QA, not a fabricated code fix.

## Delivery boundaries

Keep #386 and #385 together as the first truthfulness candidate. Root will review your actual diff, run focused checks and the relevant browser tests, arrange independent GPT adversarial review and separate QA, preserve raw evidence, integrate fresh main and run every required final gate. #416 offline retention and #420 long-sequence layout follow these dispositions. No writes to their unrelated UI concerns, the event store format, dependency/lock/config files, docs/qa, Git/index or existing evidence. Your final result is an author handoff only.

## Corrected baseline fixture (root-provided, not executed by you)

```tsx
import { act, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

it.each([
  { name: 'refresh held after the terminal event', releaseStaleRow: false },
  { name: 'refreshed row has the terminal sequence but stale status', releaseStaleRow: true },
])('shows the terminal header when $name (#386)', async ({ name, releaseStaleRow }) => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'running', lastEventSeq: 2 });
  const runPath = '/runs/' + run.id;
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));

  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let blockRefresh = false;
  let heldRequests = 0;
  const returnedRows: { status: string; lastEventSeq: number }[] = [];
  api.override('GET /runs/:id', async (call) => {
    if (blockRefresh) {
      heldRequests += 1;
      await refreshGate;
      const row = api.runs.get(run.id)!;
      returnedRows.push({ status: row.status, lastEventSeq: row.lastEventSeq });
    }
    return api.builtIn(call);
  });

  const view = renderApp(runPath, api);
  try {
    const heading = await screen.findByRole('heading', { name: 'Run ' + run.id });
    const header = heading.closest('header')!;
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run.started/ });
    expect(
      api
        .callsTo('GET', runPath + '/events')
        .some((call) => call.headers.get('accept') === 'text/event-stream'),
    ).toBe(true);

    const terminal = event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' });
    blockRefresh = true;
    api.runs.set(run.id, {
      ...run,
      status: releaseStaleRow ? 'running' : 'succeeded',
      lastEventSeq: terminal.seq,
      currentNodeId: 'refreshed-record-witness',
    });
    act(() => api.pushEvent(run.id, terminal));
    const terminalRow = await within(timeline).findByRole('button', {
      name: /run.finished.*succeeded/,
    });
    expect(terminalRow).toBeVisible();
    expect(terminalRow).toHaveTextContent('#3');
    await waitFor(() => expect(heldRequests).toBeGreaterThan(0), { timeout: 5000 });
    expect(returnedRows).toHaveLength(0);

    if (releaseStaleRow) {
      releaseRefresh();
      await within(header).findByText(/at refreshed-record-witness/);
      expect(returnedRows[0]).toEqual({ status: 'running', lastEventSeq: terminal.seq });
    }

    const badge = header.querySelector('[data-status]');
    console.info(
      '386-baseline-observation',
      JSON.stringify({
        case: name,
        terminalSequence: terminal.seq,
        timelineShowsTerminal: true,
        heldRequests,
        returnedRows,
        refreshedRecordVisible: within(header).queryByText(/at refreshed-record-witness/) !== null,
        headerBadge: badge?.getAttribute('data-status'),
      }),
    );
    expect(badge).toHaveAttribute('data-status', 'succeeded');
  } finally {
    releaseRefresh();
    view.unmount();
  }
});

```
