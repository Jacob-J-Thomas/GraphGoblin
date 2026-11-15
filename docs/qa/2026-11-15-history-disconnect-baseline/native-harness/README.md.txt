# #419 replay cancellation QA preparation

Prepared from source at `08651317c485062eb90367e1df3f7632f8e1a6c7`. The baseline and candidate have no runtime results. Root review and separate binding of the actual post-#381/#410 integration base, final candidate builds and these fixture bytes are required before either run.

## What runs when admitted

`run.mjs` loads compiled GraphGoblin container, run, authentication, error and system modules from the admitted isolated checkout. It mounts their real route functions on the installed Fastify package with the same validator and serializer compilers as the gateway. It uses a genuine owned SQLite file, real run manager, real API keys and an OS-selected loopback TCP address. The Fastify composition has scoped instrumentation. The ordinary built `main.js` entry point, Swagger and static/browser delivery are outside this fixture. A separate uninstrumented gateway smoke could corroborate basic transport and liveness, with less evidence about page counts and disconnect ordering.

The fixture publishes a provider-free manual → mutate → exit loop and starts four ordinary runs. It then appends deterministic, schema-valid start/finish pairs through the real event repository to make long history, following the repository's existing run-history tests. This explicitly synthetic history is appended after terminal projection. Two runs have a real checkpoint carrying an open-node replay state, two have their test checkpoint columns cleared. Dedicated negative-control rows contain a malformed event or checkpoint. These setup writes are confined to the new fixture database. The response oracle uses the compiled domain full-history reducer on the pristine events, and raw run/event row digests before and after the matrix prove reads preserved the seeded bytes. The fake clock and IDs stabilize wire bytes across builds. Fresh per-pass auth tokens and master key material are absent from receipts.

No provider or script execution is involved. Ollama is disabled, timer pollers are off and the structured/script/probe overrides fail if reached. Expected application traffic stays on the owned listener. The API's normal history-cleanup and startup work use this same disposable store. The container's genuine lock path runs its own bounded, hidden Windows process-identity query during startup. The harness records both fixture lock identities without their tokens. Its own only subprocess is the hidden Windows file exclusivity helper at cleanup.

## Disconnected requests

Every abandonment case uses a new TCP connection. It holds a labelled promise, destroys the exact client request, waits for the server's outgoing response `close` with `writableFinished === false` and the exact client socket close, releases the held operation and waits for production handler settlement. Then it checks the full operation trace and page arguments. Baseline expects advances into later pages after close. Candidate expects zero new repository calls after the observed close, no response replacement or attempted writes, no generic 500, and no tracked lifetime listeners left on handler exit.

| Held stage | What it witnesses |
| --- | --- |
| Before handler | A routed and authenticated request reaches the compiled handler after its response has already closed. The guard should precede run ownership/replay access. Authentication reads precede this artificial barrier. |
| Run ownership | A real ownership read completed inside SQLite and awaits return to the historical route while the response closes. |
| Initial thread | The initial-thread read is pending at the public promise boundary. The next checkpoint lookup must be suppressed. |
| Checkpoint lookup | The selected checkpoint is eligible, but its completion cannot start the boundary read after close. |
| Checkpoint boundary | Exactly the `seq - 1, limit 1` boundary read is held. No replay page starts after close. |
| Page two | A multi-page cold replay completes page one while connected. A distinct `/healthz` and real current-thread read must respond while the page-two promise remains held. |
| First inter-page yield | The real asynchronous callback scheduled by the compiled replay's `setImmediate` is reached after page one, with no repository operation pending. Its continuation is deferred until close. |
| Page two rejects | The pending page rejects at its controlled promise boundary after the client disconnects. A connected version of the same repository fault still emits the established generic 500 and records the internal cause. |

The repository wrappers delegate first, then hold the result at its return to the real handler. SQLite access, page boundaries and replay are real. The barrier models a pending repository promise without holding a native SQLite connection or asserting SQLite promise interruption. Separate health and authenticated current-read requests establish that this held API promise leaves the listener responsive. Their latency is descriptive within a bounded check.

The before-handler hook and inter-page yield have separate instrumentation. The hook lets the actual registered handler run on the already-disconnected request. The yield wrapper exists only for that case, delegates unrelated immediates untouched under request-scoped `AsyncLocalStorage`, and is restored in that case's `finally`. Its source-frame guard requires the compiled `historicalThread` in `run-history.js` and a settled first page. The trace distinguishes scheduling, entry to the native callback and the held continuation. A changed candidate scheduler that bypasses this seam yields an incomplete fixture result. Inspect and rebind the seam before interpreting its product behavior. The other barriers retain original scheduling.

## Connected controls

- Real completed GET at the seed, first event, a 128-row boundary plus one, cold multi-page target, selected checkpoint, before a later checkpoint and past the event tail. Every returned domain value is checked, and every read argument is bounded by the requested sequence.
- Ordinary keep-alive, bodyless GET and one explicitly drained ordinary incoming stream. The drained control verifies that the incoming request ends normally while its outgoing response remains open. It yields identical bytes to the same natural GET. This is a controlled request-stream timing case.
- Current-thread read through the real manager. The route trace includes ownership and current-thread access without historical replay calls. Its SQL access is owned by the unwrapped current manager.
- Missing and wrong-scope credentials, authenticated other owner, nonexistent run, negative/unsafe/extra query fields. Assert existing status, typed problem and absence of replay entry. Other-owner and nonexistent-run controls still perform ownership lookup.
- Real SQLite decoding failures for the malformed event and malformed checkpoint, and successful requests before their damaged sequence. A separate controlled generic repository rejection must retain the connected generic 500 and server diagnostic.
- Compare the completed 200 response body bytes, status and content type against the admitted baseline output. Ignore incidental wall-time fields, connection timing and response headers unrelated to the body contract. Request tracking records listener identities added on raw request/response and the socket at handler settlement and instruments `onSend` plus the raw response write methods. That evidence is for those observable lifetime hooks, not inferred internals of unrelated event targets. Failed auth and validation exercise no historical-handler listeners.

## Ownership and cleanup

The runner uses an explicit fresh `evidence-<phase>-<suffix>` basename directly under this directory. The only owned store path is its literal `store` child. The runner accepts only an isolated `gg-*/GraphGoblin` checkout under the host worktree root and the project Node 22.23.4 executable. It refuses additional Node flags and requires `NODE_OPTIONS` to be absent. No owner service, normal worktree, owner store or 4747/4748 bind is involved. Resource bounds are per operation and an overall watchdog bounds the asynchronous run. Capture the PID and process creation identity in the outer binding, since a native hang can block the watchdog.

Successful cleanup closes the exact already-owned client and server sockets, verifies Fastify no longer listens, then disposes the container and its SQLite handles and locks. It performs two fixed GC passes before one hidden PowerShell helper opens all verified DB/WAL/SHM files together with Windows `FileShare.None`. It checks the helper's exact exit and count marker, inventories the same owned paths again, unlinks just those files and verifies an empty store directory. Unexpected entries or a file-sharing disagreement preserve first evidence. There is no fixture or sharing-check retry. For a failed run, retain the owned store and JSON. For a blocked teardown, independently verify the recorded exact runner/helper and its owned listener before closing those resources, then retain the files. The runner itself performs no guessed-process or recursive file cleanup.

## Later invocation

The orchestrator must bind the exact head, clean isolated checkout, complete built source and transitive dependency manifest, Node executable, fixture hashes and fresh evidence path. The primary loaded paths and SHA-256 values in `runner.json` supplement that binding. Candidate execution also binds the retained, completed baseline `summary.json` from this same harness version. The following commands are examples for a later admitted execution.

```powershell
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaHarness = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\runtime-419-native-preparation\run.mjs'
& $qaNode --expose-gc $qaHarness baseline '<admitted baseline checkout>' evidence-baseline-review
& $qaNode --expose-gc $qaHarness candidate '<admitted candidate checkout>' evidence-candidate-review evidence-baseline-review
```

Review `summary.json` for first failure, per-case ordering, actual read arguments, raw-response bytes and cleanup evidence. `runner.json` is written before compiled imports. Normalize neither case failures nor abandoned-request logs across phases. Fixed bounds, same dependency builds and first-evidence retention distinguish a fixture mismatch from a runtime result. Preparation uses project Node syntax checks only.
