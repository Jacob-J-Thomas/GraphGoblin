# Interrupted run response bodies (#561): verification, correction and Edge QA

Issue #561: a successful `GET /runs/{id}` or `GET /runs/{id}/observation` whose body the connection cut short after the 2xx headers escaped `@graphgoblin/api-client` as a raw `TypeError`. Offline handling did not recognise it, so the run inspector could show a definitive load failure instead of its offline state.

This packet binds branch `codex/gg-fu-api-client-561-20261124`:

| Commit     | What it is                                                                 |
| ---------- | -------------------------------------------------------------------------- |
| `34a5d301` | The reviewed candidate; its tracked patch has SHA-256 `5618823e…`          |
| `93749e1a` | Merge of `main` at `4e1037c9`                                              |
| `9673af09` | The type correction, and the head of PR #592 when the packet was assembled |
| `2a3de9df` | The combined #561/#562/#563 integration tree, used only by the Edge QA     |

[MANIFEST.json](MANIFEST.json) records every retained member's source path, byte count and SHA-256.

## Behaviour

`runs.get` and `runs.observation` now read their successful body themselves, from the original native `Response`, with the caller's signal. When a 2xx GET body stops arriving before it is complete, they throw `GraphGoblinApiError` with `status: 0`, the new code `RESPONSE_INTERRUPTED`, and the native read error as `cause`. The web app already treats any `status: 0` error as unreachable.

Only a rejected body read of a `basic` or `cors` response qualifies, and only while the caller's signal is live. Everything else keeps its existing error:

- An abort rethrows the identical rejection.
- Complete malformed JSON stays a `SyntaxError`.
- HTTP refusals stay typed, including a refusal whose own body was cut short.
- 204, HEAD, `Content-Length: 0` and an empty body resolve to `undefined`.
- Constructed or re-wrapped responses and locked or used bodies keep their own errors.

Nothing is retried and no error text is inspected. Raw `client.GET`, the other resource wrappers, writes, `parseAs: 'stream'` callers and the SSE event stream are deliberately unchanged ([docs/07](../../07-api-and-streaming.md)).

## Design and review

- **Design.** The design follows decision FUP-076: a narrow GET-only success-body reader and a distinct interrupted-response code. FUP-076 adopted the Claude transport critique ([design critique](raw/design/DESIGN.claude.md.txt), [root adjudication](raw/design/ROOT-DESIGN-ADJUDICATION.md.txt)).
- **GPT formal review 1 was READY** ([review](raw/review-01/REVIEW.md.txt), [result](raw/review-01/REVIEW-RESULT.json)). It had no production findings and one evidence finding, **V1** (FIX-IN-PR): the author's verification output had been piped and truncated, so it lacked full exit codes and the web test totals.

## Unfiltered verification: FAIL on `34a5d301`

The verification contract ([contract](raw/verification/VERIFICATION-CONTRACT.json)) was run with complete streams and raw exits, inside owned Windows Jobs, with Ollama disabled and the `ProgramFiles` variables kept ([report](raw/verification/VERIFICATION.md.txt)). This resolved V1. It also found a defect that the truncated output had hidden:

| Stage on `34a5d301`                       | Raw exit | Result                                                       |
| ----------------------------------------- | -------- | ------------------------------------------------------------ |
| api-client focused tests (5 files)        | 0        | 100/100 tests                                                |
| web reconnect and offline tests (2 files) | 0        | 72/72 tests (the truncated author output had shown only 60)  |
| web typecheck                             | 0        | clean                                                        |
| MCP typecheck                             | 1        | **FAIL**: 3 errors in `body.ts`                              |
| forced full build                         | —        | not reached, because the contract stops at the first failure |

Cause: `body.ts` used `ResponseType` and `ReadableStreamReadResult`, which only the DOM library defines. `apps/mcp` type-checks the api-client source with `lib: ["ES2023"]` and `types: ["node"]`.

- `tsc -b` passed and `tsc -p` failed ([diagnostics](raw/verification/diagnostics/)).
- After the merge with `main`, the repository typecheck failed only in `@graphgoblin/mcp`.

The first post-merge typecheck and lint attempts also exposed a harness defect: turbo could not find its global config folder because the owned profile lacked `home\AppData\Roaming`. The v2 wrapper fixes only that folder layout. Both failed attempts are retained under [post-merge](raw/verification/post-merge/).

## Correction `9673af09`: PASS

"Use runtime-neutral types in the api-client body reader" changes only `body.ts` ([diff](raw/correction-01/CORRECTION.diff), [report](raw/correction-01/CORRECTION.md.txt)):

- `ResponseType` became `Response['type']`.
- `ReadableStreamReadResult<Uint8Array>` became `Awaited<ReturnType<typeof reader.read>>`.

There are no casts and no behaviour change. Each stage below ran separately with full logs, raw exits and owned-Job settlement. The forced build and the coverage run held the heavy-suite lock.

| Check at `9673af09`                                                    | Raw exit | Result                                                                |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `tsc -p` in `apps/mcp`                                                 | 0        | clean                                                                 |
| `tsc -p` in `packages/api-client`                                      | 0        | clean                                                                 |
| `pnpm typecheck --continue`                                            | 0        | 21/21 tasks                                                           |
| api-client tests, 10 files (emitter tests excluded)                    | 0        | 146/146                                                               |
| web `src/runs/`, `queries.reconnect` and `lib/utils` tests             | 0        | 34 files, 419/419                                                     |
| `pnpm lint --continue`                                                 | 0        | 13/13 tasks, 0 errors (5 main-side warnings)                          |
| `pnpm format:check`                                                    | 0        | clean                                                                 |
| `pnpm build --force`                                                   | 0        | 12/12 tasks, 0 cached                                                 |
| api-client `test:coverage`, full suite (port 11434 checked free first) | 0        | 148/148; statements 99.47%, branches 97.44%, functions and lines 100% |

Hosted CI on PR #592 at `9673af09` passed all seven jobs: Browser, Coverage, Gates, Repository checks, Template image, Windows launcher and macOS launcher.

## Independent Edge QA: PASS, 7 of 7 cases

The independent QA ran in real headless Edge against the built API: a disposable store, API keys required, providers disabled. It was part of the combined #561/#562/#563 QA on integration tree `2a3de9df` ([report](raw/edge-qa/QA-REPORT.md.txt), #561 section).

A local proxy ([script](raw/edge-qa/scripts/body-proxy.mjs)) forwarded the real 200 headers and the first half of the real body, then destroyed the socket. Edge reported `net::ERR_CONTENT_LENGTH_MISMATCH`. Every proxy decision is logged in [561-proxy.jsonl](raw/edge-qa/561-proxy.jsonl); per-case results and screenshots are under [cases](raw/edge-qa/cases/).

| Case                                                      | Result                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| C1: cold `runs.get` body cut short after 200 headers      | Offline state, no "Could not load run", no raw transport text, no Replay; recovered without a reload |
| C2 (control): failure before headers                      | Same offline state                                                                                   |
| C3 (control): complete malformed JSON                     | "Could not load run", not offline                                                                    |
| C4 (control): HTTP 503 problem                            | "Could not load run" with `QA_UNAVAILABLE`, not offline                                              |
| C5: cold `runs.observation` cut short, and before headers | Both show the offline-class banner and no raw `TypeError` text                                       |
| C6: warm reread of a shown run, cut short                 | Offline-class banner, status still shown from the last event, no raw error; recovered                |

## Limits and pending gates

The combined QA did not cover:

- a body cut short on the SSE event stream;
- a body cut short on a write.

Both are outside #561's scope, and the client deliberately leaves them unclassified.

The QA also did not establish:

- **CORS responses.** The proxy served the app and the API from one origin, so only `basic` responses were exercised.
- **A controlling service worker.** Service workers were blocked in the QA browser context, so this provenance was not checked.
- **Chunked bodies in Edge.** Only Content-Length framing was exercised in the browser.
- **Explicit cancellation in Edge.** Query-signal cancellation was not exercised in the browser.

The Node tests in `body.test.ts` cover chunked framing, aborts before and after headers, pass-through and synthetic responses, and locked bodies.

The emitter tests ran only inside the coverage stage.

Still pending: the opposite-family (GPT) targeted re-review of correction `9673af09`, the fresh Astra MAX final audit, and owner acceptance.
