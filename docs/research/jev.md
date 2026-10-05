# Research - Jev by TypeSafe

Captured 2026-10-02 from public write-ups and listings; the SDK sections were verified in M4 (WP-B) against `@typesafe-ai/sdk` 0.6.0 (`dist/index.d.mts` and `dist/index.mjs`). Live verification on 2026-10-03 confirmed the response shapes against the real API; captured bodies and product evidence are recorded below.

## What it is

Jev is TypeSafe AI's decision model, released 15 September 2026. It takes typed application state plus declared questions and returns typed decisions with calibrated probabilities. It is intended for the control layer of agents: routing, ranking, gating, verification, choosing the next action.

## Primitives

- **Choice**: pick one of up to 255 alternatives, with probabilities.
- **Score**: score against ordered levels.
- **Noul**: answer a yes or no question with a probability between 0 and 1.

## Access

- Hosted API. Input pricing around $0.042 per million tokens, output free, 64K context per request, text input only.
- Official SDKs for JavaScript and Python. Also available through OpenRouter.
- Kev is an open-weight alternative. The owner-served Choice protocol and licences of Kev-4B were inspected on 2026-10-05 (evidence below); other variants were not verified here.

## SDK (verified, `@typesafe-ai/sdk` 0.6.0)

- Licence **MIT** (Copyright 2026 TypeSafe), Node 20 or newer, ESM and CommonJS with types, **no runtime dependencies**. Pinned exactly in `packages/adapter-jev`.
- `new TypeSafeClient({ apiKey, baseURL, defaultModel, timeout, retry, fetch, logger, logLevel, defaultHeaders })`. Unset options fall back to `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` (`https://api.typesafe.ai`), `TYPESAFE_DEFAULT_MODEL` (`jev-latest`), and `TYPESAFE_LOG_LEVEL` (`warn`); GraphGoblin passes all of them explicitly. The constructor throws without an API key.
- `client.systemOne({ state, questions, model? }, { signal, timeout, retry, headers })` and `client.models.list()` (`GET /v1/models`, `{ models: [{ name, description, release_date }] }`).
- Helpers: `choice(instructions, { label: description | null, ... })`, `noul(instructions?, { true?, false? }?)`, `score(instructions, [level0, level1, ...])`.
- Transport: `fetch`-compatible, default global `fetch`. Retries 408, 429, and 5xx plus connection errors and timeouts, twice by default, with exponential backoff (500 ms doubling to 5 s, 25% jitter) and `Retry-After`/`retry-after-ms` up to 60 s. Per-attempt timeout 10 s.
- Errors: `APIError` subclasses by status (`BadRequestError` 400, `AuthenticationError` 401, `PermissionDeniedError` 403, `NotFoundError` 404, `UnprocessableEntityError` 422, `RateLimitError` 429, `InternalServerError` 5xx) with `status`, `body`, `headers`, `requestId`; `APIConnectionError`, `APITimeoutError`, and `APIUserAbortError` for caller aborts.
- The SDK does not validate response bodies; it returns the parsed JSON. GraphGoblin validates with Zod.

## Request and response shapes

```http
POST {baseURL}/v1/systemone
Authorization: Bearer <key>
Accept: application/json
Content-Type: application/json
User-Agent: typesafe-sdk/0.6.0
X-TypeSafe-SDK: typesafe-sdk/0.6.0
X-TypeSafe-Runtime: <runtime>
X-TypeSafe-Retry-Count: <n>          (retries only)
```

```json
{
  "state": "text | JSON object | JSON array | null",
  "questions": {
    "answer": {
      "type": "choice",
      "instructions": "Is the change ready?",
      "criteria": { "ship": "ready to merge", "fix": "needs work" }
    }
  },
  "model": "jev-latest"
}
```

A `noul` question is `{ "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } }` (criteria optional); a `score` question has `"criteria": [level0, level1, ...]`.

Response (`x-typesafe-request-id` header carries the request id):

```json
{
  "model": "jev-...",
  "answers": {
    "answer": {
      "type": "choice",
      "choice": "ship",
      "confidence": 0.81,
      "probabilities": { "ship": 0.81, "fix": 0.19 }
    }
  },
  "usage": { "input_tokens": 120, "output_tokens": 0 }
}
```

A `noul` answer is `{ "type": "noul", "noul": 0.9 }`, where `noul` is the probability of yes. A `score` answer is `{ "type": "score", "score": 1.4, "confidence": ..., "legend": {...}, "probabilities": {...} }`.

## How GraphGoblin uses it

- Decision node strategy `jev` with the Choice primitive: route labels and descriptions become the criteria, the rendered question becomes the instructions, and the selected decision context (trigger, messages, vars, last output) becomes the state. Scalar contexts are wrapped as `{ "value": ... }` because state must be text, an object, an array, or null. The adapter returns the reported confidence (falling back to the chosen label's probability) and the other labels as alternatives; the engine compares the confidence with `minConfidence` and, below it, runs the next strategy.
- Exit criteria predicates with strategy `jev` use Noul: `holds = noul >= 0.5`, `confidence` is the probability of the answer given.
- The built-in API key lives in the GraphGoblin secret store under `jev-api-key`. Decision `jev.model` optionally selects an owner-scoped classifier catalog id; omission defaults to built-in `jev`, whose provider model remains `jev-latest`. Custom HTTP entries use their own providerModel and optional bearer secretRef. No credentials travel with loop exports. The registry resolves current metadata/secrets on every decision and captures an immutable request configuration; catalog or referenced-secret edits invalidate cached clients. Disabled/unconfigured entries skip this strategy; provider failures retain existing failure behaviour. Exit Noul uses the built-in only.

## Kev HTTP protocol verification (2026-10-05)

Verified the owner's [Kev-4B model card](https://huggingface.co/jaredpalmer/kev-4b/tree/6cfce5c2fa4b4bd64026336ab649c5ca78857d52) and [Kev repository](https://github.com/jaredpalmer/kev/tree/fe64b1274ea7f80d4095866df90666abb03e9cf6), specifically `kev/api.py`, `kev/serve.py`, `tests/test_api.py`, and `LICENSE`. The card identifies the Kev adapter/heads and the Qwen3.5-4B base as Apache-2.0; the serving repository also carries Apache-2.0. No Kev code or dependency is bundled in GraphGoblin.

The card recommends the owner's `kev.serve`, using CUDA bf16/fused kernels or automatic Apple Silicon MLX selection:

```sh
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8008
```

The optional pinned run is `jaredpalmer/kev-4b@v1.0`. Register the resulting API root (for example `http://127.0.0.1:8008`) as provider `http`, providerModel `kev-latest`, primitives including `choice`. The server permits unauthenticated requests when `KEV_API_KEY` is unset; if the operator sets it, put that value in GraphGoblin Secrets and register its name as secretRef.

The inspected server implements native `POST /v1/systemone`. Its request includes model, state, and named questions; a Choice question accepts type, instructions, and a criteria map of submitted labels to descriptions. It returns `answers.<question>` with type `choice`, a declared selected label, confidence, and probabilities for every submitted label. Its own tests assert label coverage and bounded probabilities. `choice_confidence` rescales the selected maximum probability as `(p_max - 1/K) / (1 - 1/K)`, where `K` is the number of labels: two labels at selected probability 0.75 give confidence 0.5. GraphGoblin preserves reported confidence and only uses the selected probability when confidence is omitted. Optional response model/usage/latency/truncation metadata is accepted without affecting routing. The bearer middleware checks `Authorization: Bearer <KEV_API_KEY>` and returns 401 on mismatch.

This verifies the served protocol and licence from owner source, without loading weights or running Kev inference. Local deterministic HTTP fixtures exercise GraphGoblin's actual request/response, authentication, failure, timeout, and cancellation paths. No owner-supplied running Kev endpoint was available. Hosting/installing models and bridges for other protocols remain outside this change; ordinary LiteLLM chat routing does not establish compatibility with this Choice contract. See [06](../06-harness-integration.md#http-classifier-endpoint-contract-decided-adr-0021).

## Verified live (2026-10-03)

Verified against the real TypeSafe API with the pinned SDK 0.6.0, default model alias `jev-latest`, and SDK/test retries disabled. Choice, five-label classification (also Choice), and Noul passed through `createJevDecider`; Score called `TypeSafeClient.systemOne` directly because the adapter does not implement Score. All four returned model **`jev-1.13.0`**.

| Case           | Input tokens | Output tokens | Observed result                     |     Confidence | Chosen probability |
| -------------- | -----------: | ------------: | ----------------------------------- | -------------: | -----------------: |
| Choice         |          361 |            38 | `ship`                              |              1 |                  1 |
| Classification |          404 |            53 | `billing`                           |              1 |                  1 |
| Noul           |          309 |            20 | `noul: 0.96`, adapter `holds: true` | 0.96 (adapter) |               0.96 |
| Score          |          336 |            17 | `score: 3` (`critical`)             |              1 |     1 at level `3` |

The captured response bodies were:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "answer": {
      "type": "choice",
      "choice": "ship",
      "confidence": 1,
      "probabilities": { "ship": 1, "drop": 0, "fix": 0 }
    }
  },
  "usage": { "input_tokens": 361, "output_tokens": 38 }
}
```

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "answer": {
      "type": "choice",
      "choice": "billing",
      "confidence": 1,
      "probabilities": {
        "other": 0,
        "account": 0,
        "billing": 1,
        "bug": 0,
        "feature request": 0
      }
    }
  },
  "usage": { "input_tokens": 404, "output_tokens": 53 }
}
```

```json
{
  "model": "jev-1.13.0",
  "answers": { "answer": { "type": "noul", "noul": 0.96 } },
  "usage": { "input_tokens": 309, "output_tokens": 20 }
}
```

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "severity": {
      "type": "score",
      "score": 3,
      "confidence": 1,
      "legend": { "0": "low", "1": "medium", "2": "high", "3": "critical" },
      "probabilities": { "0": 0, "1": 0, "2": 0, "3": 1 }
    }
  },
  "usage": { "input_tokens": 336, "output_tokens": 17 }
}
```

Choice used the ready README typo context and chose `ship`. Classification used a duplicate card charge and refund request; all five categorical labels, including the label containing a space, appeared in probabilities and the adapter preserved the other four as alternatives. Noul's response has no separate confidence field: the adapter returned `holds = noul >= 0.5` and the probability of that boolean. Score's ordered levels are zero-based numeric-string keys in both `legend` and `probabilities`; its numeric score equalled the probability-weighted index, and the full production outage scored `critical`.

Reported Choice confidence equalled the chosen probability in both sampled Choice calls. This verifies these observations, not a universal equality guarantee; the adapter continues to preserve reported confidence with its existing fallback. All returned fields matched the SDK-derived schemas, and no runtime adapter change or validation relaxation was needed. The earlier example's zero output tokens were not representative: every real request reported nonzero output usage, even though output pricing had been described as free. Counts here belong to these exact requests, and `jev-latest` can resolve to a different model later.

**Repeat the checks:** set `LIVE=1` and `JEV_API_KEY` (or `GG_JEV_API_KEY`) in the process environment. `pnpm.cmd --filter @graphgoblin/adapter-jev test -- src/live.test.ts` runs the package tests; to expose all safe observations and target only the live file, use `pnpm.cmd --filter @graphgoblin/adapter-jev exec vitest run src/live.test.ts --silent=false --reporter=verbose`. There are four requests across three tests, each with retries disabled. The tests validate probability bounds and complete label coverage and print redacted response JSON; credentials and request headers are never printed. Without `LIVE=1`, these cases stay skipped.

**Product verification:** after `pnpm.cmd build`, a background `node apps/api/dist/main.js` used a fresh temporary `GG_DATA_DIR` and `GG_PORT=4799`. First startup seeded the encrypted `jev-api-key` from `JEV_API_KEY`; `GET /system/preflight` reported the Jev check `ok` (key present; preflight itself does not contact TypeSafe). Through the REST API, a manual trigger, Jev-only decision with `billing`, `bug`, and `account` routes, and one labelled-return exit per route were created and published. A duplicate-charge payload produced run `01M41VB1WVF129RCT0A90C90GM`, status `succeeded`, and a `decision.made` event with strategy `jev`, route `billing`, confidence `1`, and both alternative probabilities `0`; the exit returned `billing`. The API was stopped and its temporary data directory deleted. Package typecheck and lint passed; coverage was 98.64% statements, 98% branches, and 100% functions and lines.
