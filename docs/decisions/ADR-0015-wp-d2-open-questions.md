# ADR-0015 - Visit cap, draft conflicts, and the first API key

Date: 2026-10-03. Status: Accepted. Answers open questions 16, 17, and 18 raised by the WP-D2 adversarial QA pass (defects D28, D26, D27 in `qa/2026-10-03-wp-d2.md`).

## 1. Unbounded cycles: `maxIterations` caps visits per node (question 16, D28)

### Context

A decision that routes back to itself, or any cycle that never passes through an exit loop-back, ran until cancelled: `maxIterations` counted only exit loop-backs. The executor already yields between nodes (D02), so the API stayed responsive, but the run grew its event log without limit.

### Decision

The existing `maxIterations` loop setting stays the only loop limit and now also bounds fresh visits per node. A visit is a `node.started` with `attempt` 1; re-executions of the same visit (a wake after a wait, heartbeat, or child run; recovery after a restart; a resume after a failure) have a higher attempt and do not count. When any node would start for the (`maxIterations` + 1)th time the run fails with the new run-failure code `MAX_ITERATIONS`, `resumable: false`, with the node in `nodeId`, the message, and `details.maxIterations`. The check runs before `node.started` is recorded.

### Consequences

- Nodes inside an exit loop-back are entered once per iteration, so for them the iteration ceiling (`exhausted`) is reached first and nothing changes.
- A loop that legitimately re-enters one node many times inside a single iteration needs a higher `maxIterations`.
- `MAX_ITERATIONS` is a new member of `RunErrorCode`; clients that switch over the codes see one more value.

### Alternatives considered

- `NODE_VISIT_LIMIT` above `maxIterations` times the node count (the WP-D2 proposal): a second, derived limit that is harder to explain and still lets one node run far more often than the setting says.
- A separate `maxNodeVisits` setting: one more knob for a rare case.

## 2. Draft edit conflicts: `If-Match` on draft saves (question 17, D26)

### Context

Two tabs or devices editing one draft overwrote each other silently: `PUT /loops/{id}/draft` was last-write-wins.

### Decision

The draft gets a version token, `draftToken`: a hash (`stableHash`) of the definition a save would replace, the draft or else the published version. No column or migration is needed, and publishing does not change the token because it keeps the content. `GET /loops/{id}` and `PUT /loops/{id}/draft` return it in the body and as `ETag`. `PUT` with `If-Match` saves only when the token still matches and otherwise answers 409 `DRAFT_CONFLICT` with the server's token; conditional saves of a loop are serialized in the process. Without `If-Match` the save stays unconditional. The editor always sends it and, on a conflict, asks the user to reload the server draft or overwrite it.

### Consequences

- Two saves of identical content have the same token, so a save that would change nothing never conflicts. This is intended: the question a conflict answers is whether the server copy differs from the one the edit started from.
- API clients that do not send `If-Match` keep the old behaviour; the MCP server and scripts are unchanged.

### Alternatives considered

- A revision counter column on `loop_versions`: exact, but needs a migration and does not survive publish without extra rules.
- `loop.updatedAt` as the token: it changes on renames and publishes that do not change the draft, and millisecond timestamps can collide.
- Requiring `If-Match` (428 without it): would break existing API and MCP clients for a single-user product.

## 3. The first API key: `--create-api-key` (question 18, D27)

### Context

With `GG_REQUIRE_API_KEY=true` on a fresh install nothing could create the first key, because `POST /api-keys` itself needs one.

### Decision

`graphgoblin-api --create-api-key <name> [--scopes a,b]` creates a key for the local owner directly in the configured database (creating the data directory and applying migrations as a server start would), prints the token once on standard output, and exits without starting the HTTP server. Nothing is logged and only the hash is stored. The install scripts mention it.

### Consequences

- Anyone who can run the command as the server's user with its environment can mint a key. That is the same trust boundary as reading the database or the master key file, so it adds no new exposure.
- The command can run while the server is running (SQLite in WAL mode with a busy timeout).

### Alternatives considered

- Minting a key in the preflight or install script automatically: preflight must not change state, and an install script that prints a secret on every run is easy to leak into logs.
- A bootstrap token in an environment variable: one more secret to manage and rotate.
