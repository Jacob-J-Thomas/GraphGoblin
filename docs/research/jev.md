# Research - Jev by TypeSafe

Captured 2026-10-02 from public write-ups and listings. Verify licence terms of the SDK and the API terms before M4.

## What it is

Jev is TypeSafe AI's decision model, released 15 September 2026. It takes typed application state plus declared questions and returns typed decisions with calibrated probabilities. It is intended for the control layer of agents: routing, ranking, gating, verification, choosing the next action.

## Primitives

- **Choice**: pick one of up to 255 alternatives, with probabilities.
- **Score**: score against ordered levels.
- **Noul**: answer a yes or no question with a probability between 0 and 1.

## Access

- Hosted API. Input pricing around $0.042 per million tokens, output free, 64K context per request, text input only.
- Official SDKs for JavaScript and Python. The npm package is `@typesafe-ai/sdk`, Node 20 or newer, ESM and CommonJS with type declarations, exposing a `TypeSafeClient` with a `systemOne()` method and a `choice()` helper.
- Also available through OpenRouter.
- Open-weight alternatives compatible with the Jev API exist under the name Kev, from 0.8B to 27B parameters, for self-hosting.

## How GraphGoblin uses it

- Decision node strategy `jev` with the Choice primitive: route labels and descriptions become the alternatives; the rendered question and selected thread context become the state. The returned probability is compared with `minConfidence`; below it, the next strategy in the chain runs.
- Exit criteria predicates with strategy `jev` use Noul.
- The API key lives in the GraphGoblin secret store and is the only API-key service in 1.0.

## Open items

- Confirm the SDK licence. If it is not permissive, call the HTTP API directly from `adapter-jev`.
- Confirm request and response shapes for Choice and Noul against the SDK version pinned in M4.
