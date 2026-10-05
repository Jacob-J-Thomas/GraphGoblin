# ADR-0021 - Separate owner classifier catalog and Choice registry

Date: 2026-10-05. Status: Accepted (#43 approved plan).

## Context

The harness LLM catalog has model/effort metadata. Jev and Kev classify and score declared options, so they need a separate catalog, credentials, and selection path. The backend half is Part of #43; Settings and the decision picker follow as consumers.

## Decision

Migration `0006_classifier_models.sql` creates `classifier_models`, keyed by `(owner_id, id)`. Entries carry id, displayName, source (`builtin`/`custom`), provider (`typesafe`/`http`), providerModel, unique nonempty primitives (`choice`/`noul`/`score`), endpoint, optional secretRef, and enabled. Ids are URL-safe names of at most 64 characters beginning with a letter; `jev` is reserved. API roots require HTTP(S) without credentials, query strings, or fragments. Secret names use the existing Secrets syntax. Values remain only in the encrypted secret store.

Startup seeds built-in `jev` before recovery, refreshing fixed metadata while preserving enabled. It uses the existing SDK, `jev-latest`, TypeSafe endpoint, and `jev-api-key`. Custom entries use direct HTTP Choice. GET derives configured status without provider calls; missing/blank or unreadable required secrets name the secret in configurationReason. Configured does not mean reachable or authenticated at the provider.

The REST surface is GET `/classifier-models` and PUT/PATCH/DELETE `/classifier-models/{id}`, under settings read/write scopes. PUT custom metadata creates disabled or preserves existing enabled; omitted secretRef clears auth. PATCH accepts exactly enabled. Built-in PUT/DELETE return `CLASSIFIER_MANAGED_BY_SYSTEM`. DELETE custom preserves secrets and loop references. No MCP catalog tools are added.

Decision `jev.model` defaults to `jev` when omitted. An explicit id resolves only that entry through `ClassifierRegistryPort` in engine. API composition owns persistence, secret lookup, SDK, and HTTP transport; infrastructure implements the latter under its existing HTTP subpath. Unknown references and unsupported Choice capability are publish errors. Disabled/missing-secret/unreadable-secret references warn and runtime skips that strategy with the specific reason. Low-confidence fall-through, provider failures, cancellation, and `DECISION_NO_ROUTE` semantics stay unchanged. Successful classifier events add optional classifierModel provenance; lastOutput is unchanged.

Clients are cached per owner/id and immutable metadata/secret snapshot, invalidated on catalog or referenced-secret edits. Resolution also checks current metadata/secrets, so direct store changes cannot retain a stale client. In-flight calls retain their starting configuration. Exit predicates keep the built-in Noul facade; no selector is added there.

## HTTP contract and alternatives

Send `POST {endpoint}/v1/systemone`, `{ model: providerModel, state, questions: { answer: { type: 'choice', instructions, criteria } } }`, and bearer authentication only for a secretRef. Native fetch enforces a 10-second deadline and executor cancellation. Reject redirects and malformed JSON; selected labels must be declared and probabilities must cover exactly the submitted labels with finite values in `[0,1]`. Optional confidence has the same bounds and defaults to the selected probability. Fixed diagnostics never echo credentials or untrusted provider bodies.

Kev-4B is the first documented open-source alternative, hosted with its owner's `kev.serve` instructions. Owner source and model-card licence/protocol were inspected; no real model was deployed for this implementation. A deterministic compatible endpoint verifies GraphGoblin transport and execution. LiteLLM chat-completion support cannot establish this Choice contract; model serving, installers, bridges, and automatic discovery remain out of scope.

## Consequences and migration

The additive table does not rewrite stored definitions, versions, runs, events, secrets, or LLM rows. Earlier migrations still apply their intended changes. Omission is the built-in default, not a tolerant parsing or compatibility branch (ADR-0020). Portable definitions carry selected catalog ids; installation endpoints/credentials do not travel with exports. Strict older readers cannot be promised to read exports with the new field. Regenerate OpenAPI/client and rebuild consumers together. The UI half supplies catalog management and an enabled Choice picker, including stale-selection diagnostics, keyboard operation, and human product review.
