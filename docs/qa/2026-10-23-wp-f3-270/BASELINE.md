# Baseline reproduction

Base: `fbd48d3da5f162539964516a34d5de7e387d63c6`, branch `codex-wp-f3-270`.
Both reproductions ran before production edits, under Node v22.14.0. They use a
controlled StructuredPort promise that remains pending until explicit test teardown,
not a live provider. The completion starts through a mutate/coerce repair node.

Commands:

- `pnpm --filter @graphgoblin/engine exec vitest run src/structured-deadline.test.ts`
- `pnpm --filter @graphgoblin/api exec vitest run src/structured-deadline.test.ts`

Both configured the already-visible one-second run deadline and capacity 1, started
the stalled repair, then queued another run and advanced the public FakeClock past
the deadline. The fake wall clock was advanced past the configured deadline; the retained status
assertion is the direct runtime observation. Watcher/abort behavior is source reasoning,
not a separately retained baseline signal capture.
The outcome assertion in both was:

```text
AssertionError: expected 'running' to be 'failed' // Object.is equality
Expected: "failed"
Received: "running"
Caused by: Error: Matcher did not succeed in time.
```

The engine failure took 2,219 ms in the corrected baseline fixture. The API confirmed
the second run was `queued` before its failing public GET status assertion. The stalled
node had started and never produced a node.finished event: the pending port held the
sole run slot while the provider promise remained pending. The baseline signal state
was not captured separately; the post-fix tests assert abort explicitly. This reproduces the binding defect
with the supported visible deadline; the old engine setting itself had no call site.

Initial fixture corrections (an invalid empty mutate list, then an API response-envelope
assumption) were resolved before treating either failure as defect evidence. Baseline
API teardown also timed out because the stopped manager retained queued work; final
teardown explicitly cancels remaining candidates. This was test cleanup, not a product fix.
Raw terminal captures were not kept. The exact asserted regression output above is
transcribed from the observed terminal output; no native/provider claim is made.
