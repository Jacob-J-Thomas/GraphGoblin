# Round 5 inventory before source changes

Base HEAD: `96cc1802804c5a2960212e6341ca611d6a89c6e9`; worktree initially clean.

The complete `apps/web/e2e` and `apps/web/scripts` search is retained in
`inventory-search.log.txt`.

Untargeted inbound Event writers:

- `apps/web/e2e/events-refresh.spec.ts`: `postEvent`, its batched `seedEvents`
  caller, and the two local `send` helpers. The receipt-boundary and obsolete
  Refresh tests also call those helpers.
- `apps/web/e2e/history.spec.ts`: the 101-row Events paging setup.
- `apps/web/e2e/responsive.spec.ts`: the shared responsive `seed` function.
- `apps/web/e2e/screens.capture.ts`: the `issue.opened` and `build.finished`
  capture seeds.

No inbound Event writer or body builder was found in `apps/web/scripts`.
`replay-seed-repro.ts` reads execution logs at `/runs/{id}/events`; those are
not inbound Events. The same distinction applies to other run-inspector specs.

GET response interception:

- `events-refresh.spec.ts` holds a Refresh response and overrides one receipt's
  delivery state. Real response fields must be retained.
- `github-triggers.spec.ts` supplies five webhook delivery dispositions.
- `responsive.spec.ts` and `screens.capture.ts` deliberately supply malformed
  items to exercise the error boundary; those fixtures must stay malformed.

The layout-only seeds use dotted names that the published Event trigger's
`SlugSchema` does not accept. Use `issue-opened` and `build-finished` consistently
for those seeds and their readiness text. All #240 types, counts, filters,
batch sizes and response synchronization stay unchanged.
