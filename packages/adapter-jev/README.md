# Jev adapter

The `jev` decider implements Choice routing through `choose()` and Noul exit-criteria evaluation through `judge()`. See [the Jev research notes](../../docs/research/jev.md) for the SDK and API shapes.

## Live verification

The owner runs `LIVE=1 pnpm --filter @graphgoblin/adapter-jev test -- src/live.test.ts` in a terminal where `JEV_API_KEY` is set. In PowerShell, use `$env:LIVE='1'; pnpm.cmd --filter @graphgoblin/adapter-jev test -- src/live.test.ts`. It makes two requests with retries disabled and costs a fraction of a cent. The test is otherwise skipped and reads the key only from the process environment. It checks Choice routes, confidence and alternatives, Noul predicates, and the raw response model and token usage; `console.warn` reports the model id and usage for each request, plus the Choice confidence and chosen probability for comparison. The key and request headers are never printed.
