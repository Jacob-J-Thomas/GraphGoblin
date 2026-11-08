# ADR-0066 - Native Ollama inference and capability-bound model discovery

Date: 2026-11-07. Status: Accepted for the owner's Ollama addition to native Chat work (#443).

## Context

The owner requests Ollama alongside Codex and Claude, model discovery when connecting, a
five-minute refresh and a manual control beside the model list. A native integration must retain
engine evidence and recovery while avoiding invented CLI sessions, model aliases, effort levels
or successful availability claims. The catalog must distinguish presence/capability from the
owner's enabled preference.

## Decision

Add Ollama as an Inference harness through `packages/infrastructure/src/ollama/`, using Node HTTP
and the native `/api/chat` endpoint. No additional SDK, compatibility shim, CLI or workspace
package is needed. Existing inference rendering/transforms, structured result validation,
transcripts, usage, cancellation and failure accounting remain authoritative. Generic LLM
decision evaluation and same-session structured repair are not extended to Ollama in this work.

### One explicit connection and complete snapshots

The gateway-wide catalog has one gateway-wide saved Ollama connection in a dedicated singleton
table, with enabled state, canonical origin and revision. Its initial fallback is `GG_OLLAMA_URL`
or `http://127.0.0.1:11434`, enabled by default through `GG_OLLAMA_ENABLED`. Saved configuration
wins over that fallback. Only an explicit HTTP(S) origin without credentials, query, fragment or
non-root path is accepted. Local/LAN services and trusted proxies are owner choices; the product
does not claim every server/model is local, forward the gateway API key or manage proxy credentials.

The Settings connection read uses `settings:read`; writing it requires gateway-owner wildcard
authority. Generic `/settings` writes cannot bypass that lifecycle. A valid saved connection
remains saved when its immediate refresh fails. The explicit refresh mutation accepts only
`{harness: 'ollama'}` under `settings:write`; it does not imply dynamic Codex/Claude discovery.

After storage is ready, startup schedules immediate discovery without an indefinite startup
block. Saving/enabling/changing a connection also refreshes immediately. An enabled gateway
refreshes every five minutes, and Settings offers **Refresh Ollama models** beside that group.
One in-flight refresh is coalesced per connection revision. Disable/stop cancels scheduled and
discovery work; revision/enabled checks protect every refreshing/failure/success status write as
well as reconciliation from an old origin. Connection configuration atomically owns its new
revision/status. Manual refresh while off returns current status without network work.

Owner disable blocks all new discovery, refresh, preflight, inference or resume HTTP dispatch and
aborts currently open gateway requests. A final dispatch guard closes a race after capturing an
enabled snapshot. Already-dispatched turns retain honest submission evidence; closing the local
request does not prove remote computation stopped and sends no unload/stop command. A URL edit
that stays enabled does not abort/retarget already-dispatched model work; new/unsubmitted work
checks current revision/readiness. Ordinary container shutdown retains native drain ownership.

Discovery reads `/api/tags` then `/api/show`, with at most 256 models, four concurrent detail
requests, a five-second metadata-request deadline, thirty-second whole-scan deadline and 2 MiB
per response. Unchanged detail metadata is cached by connection revision and digest. Only a
complete snapshot reconciles discovery metadata and the model catalog in one transaction.
Partial failure retains the prior complete snapshot and last-success time. Empty successful
discovery is authoritative and marks previously known rows missing. No scan generates text,
pulls, downloads, loads/unloads a model or changes owner defaults.

Ollama catalog rows are harness-managed and use exact server-reported identifiers, including
namespace and tag. New supported rows start enabled; every subsequent refresh preserves the
owner's enabled preference independently of availability. Missing/unsupported rows and stored
selections/defaults remain visible so restoration can reuse them. Catalog reads, pickers,
publication and runtime resolve the same joined availability. `MODEL_UNAVAILABLE` is separate
from `MODEL_DISABLED`. A live service probe still blocks an unreachable server even when the
last successful catalog remains visible. Runtime model disappearance fails honestly without
substitution or automatic pulling. A discovered digest is metadata, not immutable weight pinning.

After startup migrations, effective availability is projected on public/runtime catalog reads from current connection/revision:
Off takes precedence as missing with **Ollama is off in Settings**; absent/mismatched metadata is
missing with **Not yet listed at the new address**. Stored snapshots/Enabled choices and meaningful
observation timestamps remain, without claiming an old row was checked at a new address. Only a
complete current enabled-revision scan restores availability. A failed new-origin scan never
revives an old-origin snapshot. Chat readiness returns this precise safe reason; sends retain
409 `CHAT_NOT_READY` and admit no run. Static harness catalog semantics remain unchanged.

Structurally valid Ollama process defaults with an explicit model defer catalog-dependent
membership/cross-harness-name/effort checks in defaults validation. This keeps first startup,
offline/disabled service and missing/unsupported-model restarts open for correction in Settings,
without blocking unrelated Codex/Claude workflows. Structural JSON/schema/effort-enum checks remain;
effort-only/no-model is unresolved, and model-only remains a partial default. Actual selected-node
resolution still enforces exact available/enabled model and supported effort after inheritance.
An absent Ollama row is restorable `MODEL_UNAVAILABLE`, not proof of a cross-harness mismatch.
No startup model turn, synchronous discovery prerequisite, implicit effort, substitution or rewrite
is added. Owner/loop default authoring and Codex/Claude process semantics retain their normal checks.

Existing current-format stores retain read-only process-default validation before mutable storage
and additive migrations. Its dedicated early catalog view reads established base columns without
discovery/connection joins or writes; it preserves custom static rows and Enabled preferences.
Normal discovery-aware catalog reads begin after migration. No reset, definition conversion,
schema-probing fallback or retained-content rewrite is required for this upgrade.

System/CLI preflight reports unused unavailable/off Ollama as a warning; an explicit Ollama process
model makes service failure a failed diagnostic. Its separate default-model check warns until
discovery is known, then checks availability, Enabled and exact effort. Only an explicit Ollama
process model with no Codex process-default entry makes unavailable Codex optional and omits its
undefined-model check; other Codex/Claude policy stays unchanged. These diagnostics do not gate
container startup or replace selected-node admission readiness.

CLI preflight resolves saved connection state by pure read only after the current-format guard and
zero pending migrations. Existing pending/unsupported/unreadable stores defer the Ollama probe
with a warning and zero HTTP/writes, never environment fallback over unread saved state. A missing
database or missing singleton in a verified current store may use environment defaults. This
inspection neither initializes the connection nor starts the discovery service.

### Honest controls and fresh-only sessions

The first increment supports fresh tool-free text and structured JSON. Send only the rendered
prompt as one user message, the exact selected model, streaming and the node's JSON Schema when
present. The request has no tools, images, filesystem/context-file reads, plugins, MCP, web search
or raw provider overrides. Fresh/read-only/never and empty capabilities/config/context files are
enforced during authoring, publication, admission and in the adapter. Network/web-search flags
must be false. These policies describe the tool-free request, not OS confinement of an HTTP server.

Capabilities determine effort without guessing:

- A model reporting no thinking capability offers `none` and omits `think`.
- Explicit false metadata maps `none` to `think: false`.
- Named values exactly matching canonical `low`, `medium`, `high`, `xhigh`, `max` map identically.
- With absent/null optional thinking metadata, a bounded server `qwen35` family or explicit
  `qwen3.5` renderer profile plus completion/thinking capabilities maps `none` to `think: false`.
  Explicit advertised controls take precedence; a model-name substring cannot select a profile.
- Unknown names and `true` do not acquire invented intensity labels. A thinking-capable model
  without a supported explicit control or verified profile is detected but unavailable with its
  reason.

The catalog prefers `none`, then an exact supported reported default, then its first supported
canonical level. This remains guidance: native node/loop/owner/process resolution needs an
explicit/inherited model and effort and never changes owner defaults. The adapter rechecks the
same revision/digest control metadata before dispatch instead of relying on server fallback.

Ollama's local `ollama:<id>` correlation handle is not a provider conversation handle. Authored
resume policies and enabled same-session schema repair are refused. Adapter resume returns
`HARNESS_SESSION_MISSING` for explicit **Start fresh** recovery; invalid structured results fail
normally. Multi-turn Chat continues to work because its protocol intentionally supplies bounded
history in each fresh prompt. Audio normalizes through the existing system-loop Script/Subloop
before Ollama receives text. Existing gateway/device loops are not rewritten on discovery. A new
Chat seed chooses a configured model's harness in owner Codex → Claude → Ollama order, then the
same process-default order; with no configured model it retains Codex and unavailable readiness.

### Completion, ambiguity and cancellation

Parse incremental UTF-8 NDJSON with a 1 MiB per-frame bound and 8 MiB total stream/final-content
bound. A terminal `done: true` is required. EOF without it, malformed frames, server errors and
unexpected nonempty tool calls fail without accepting partial content. Thinking content never
becomes the final answer. Usage uses finite nonnegative terminal counters; absent counts are zero.
The engine validates native structured output independently of the server's format support.

Emit `ollama.response` only when the first valid response frame establishes response evidence.
Validation and definite HTTP rejections are distinct from conservative post-dispatch transport,
5xx or truncated-stream uncertainty. Safe summaries omit raw server bodies. Uncertain work never
repeats automatically. A turn binds one origin/revision at start, so connection edits cannot
retarget it. Abort closes the request/reader without claiming remote computation stopped or
unloading the model. Authored node/run deadlines govern generation; metadata discovery's short
deadline is not a hidden inference deadline or cold-loading limit.

## Consequences

Ollama works for ordinary native inference and contract-valid Chat loops with the same admission
and output guards as other harnesses. Capability restrictions and unavailable model reasons are
visible in Settings and the editor. The peripheral has no provider configuration surface. Schema
tables use ordinary migrations without changing the portable loop format or rewriting existing
content. Codex/Claude behavior, including their catalog seeds and Conversation layout, is retained.

The integration follows the native [chat API](https://docs.ollama.com/api/chat),
[model list](https://docs.ollama.com/api/tags),
[model details](https://docs.ollama.com/api-reference/show-model-details),
[thinking controls](https://docs.ollama.com/capabilities/thinking),
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs) and
[streaming errors](https://docs.ollama.com/api/errors).
The bounded Qwen3.5 profile is established by the official
[boolean thinking API](https://ollama.com/blog/thinking) and
[Qwen3.5 renderer test](https://raw.githubusercontent.com/ollama/ollama/main/model/renderers/qwen35_test.go).

See [Harness integration](../06-harness-integration.md#native-ollama-and-discovered-models-443),
[Frontend and PWA](../09-frontend-and-pwa.md#ollama-connection-and-model-discovery-443) and
[ADR-0065](ADR-0065-native-chat-system-loops-and-device-pairing.md).
