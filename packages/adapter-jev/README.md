# Jev adapter

The `jev` decider implements Choice routing through `choose()` and Noul exit-criteria evaluation through `judge()`. See [the Jev research notes](../../docs/research/jev.md) for the SDK and API shapes.

## Live verification

The owner runs `LIVE=1 pnpm --filter @graphgoblin/adapter-jev test -- src/live.test.ts` in a terminal where `JEV_API_KEY` is set. In PowerShell, use `$env:LIVE='1'; pnpm.cmd --filter @graphgoblin/adapter-jev test -- src/live.test.ts`. It makes four requests with retries disabled: Choice and Noul through the adapter, a five-label Choice classification through the adapter, and Score directly through the pinned SDK. The test is otherwise skipped and reads the key only from the process environment. It checks Choice routes, confidence and alternatives, classification label coverage, Noul predicates, the ordered Score response shape, and each response's model and token usage. To target only the live file and show all observations, run `pnpm.cmd --filter @graphgoblin/adapter-jev exec vitest run src/live.test.ts --silent=false --reporter=verbose`; `console.warn` reports redacted response JSON, usage, confidence, and chosen probability for comparison. The key and request headers are never printed.
