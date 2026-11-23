Found while resolving S2 from the targeted Fable review supporting #416/D240. This is a parked, source-based follow-up about the existing shared API client, not an admitted expansion of the five-intent batch.

## Observed source and possible effect

At main `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`, [the client's network middleware](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/0f6c325becf3e3e0562ae69dfae2c42bcf1d7129/packages/api-client/src/client.ts#L45) maps errors delivered to `onError` into `GraphGoblinApiError` with status 0, preserving aborts. The installed, lockfile-selected openapi-fetch 0.17.0 invokes this middleware around the initial `fetch` promise, but awaits successful response-body text/JSON later, outside that catch (`dist/index.mjs` lines121–155 and183–194).

[The web offline predicate](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/0f6c325becf3e3e0562ae69dfae2c42bcf1d7129/apps/web/src/lib/utils.ts#L176) recognizes only that typed status-0 error. A connection failure while consuming a body after headers may therefore escape the normal offline classification. Invalid JSON and explicit cancellation also fail during body consumption and must remain distinguishable.

The catch placement and predicate are source-confirmed. **No native mid-body disconnect or browser reproduction has been executed for this issue.** The exact resulting exception and user-visible behavior still require reproduction; do not report them as observed. The independent S2 check exercised three successful native GET bodies, not this failure path.

## Scope and acceptance when admitted

- Reproduce a connection failure before headers and a connection interruption after successful headers through the actual typed client and a disposable loopback server.
- Include successful bodies, invalid JSON, HTTP refusal, and explicit abort controls.
- Establish the current error classification and affected UI behavior. Decide and document the appropriate distinction between transport, malformed data, refusal, and cancellation before changing shared behavior.
- If a fix is warranted, keep ordinary response/body contracts and cancellation intact; test public client consumers and inspector behavior without turning arbitrary parsing/programmer errors into offline authority.

## Why deferred

The shared middleware predates the current inspector batch (last source change `b76a7cd5493ae3d178906c7f707c999116366bfa`). D240 changes only retention of an already observed cache revision after cancellation; it does not alter shared response parsing or error classification. Unknown body failures currently retire fallback proof conservatively rather than create write authority. This follow-up does not waive #416's actual listener-outage, recovery, action-safety, UI review, or QA gates.

A bounded all-state duplicate search on November23 used `"response body"`, `"openapi-fetch"`, and `"NETWORK_ERROR"`. Returned #303/#117/#419/#168/#486 concern different server/probe/trigger/evaluator boundaries; no exact existing client-body-classification issue was found. No implementation is dispatched.
