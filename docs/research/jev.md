# Research - Jev by TypeSafe

Captured 2026-10-02 from public write-ups and listings; the SDK sections were verified in M4 (WP-B) against `@typesafe-ai/sdk` 0.6.0 (`dist/index.d.mts` and `dist/index.mjs`). There is no Jev API key on the development machine, so no live call has been made: request and response shapes below come from the SDK's types and source, not from a captured response.

## What it is

Jev is TypeSafe AI's decision model, released 15 September 2026. It takes typed application state plus declared questions and returns typed decisions with calibrated probabilities. It is intended for the control layer of agents: routing, ranking, gating, verification, choosing the next action.

## Primitives

- **Choice**: pick one of up to 255 alternatives, with probabilities.
- **Score**: score against ordered levels.
- **Noul**: answer a yes or no question with a probability between 0 and 1.

## Access

- Hosted API. Input pricing around $0.042 per million tokens, output free, 64K context per request, text input only.
- Official SDKs for JavaScript and Python. Also available through OpenRouter.
- Open-weight alternatives compatible with the Jev API exist under the name Kev, from 0.8B to 27B parameters, for self-hosting.

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
- The API key lives in the GraphGoblin secret store under `jev-api-key` and is the only API-key service in 1.0.

## Open items

- Capture a real response once a key is available and confirm the shapes above, in particular whether `confidence` always equals the chosen label's probability. Still open after WP-I (2026-10-03): no `JEV_API_KEY` was set on the development machine, so no live call was made.
