# ADR-0024 - Body-signed webhooks and bounded poll items

Date: 2026-10-07. Status: **Accepted architecture; implementation and product review pending**. Owner-approved scope: [#29](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/29).

## Context

GitHub signs the exact request body without GraphGoblin's timestamp header. Its delivery identifier is an unsigned header, so that identifier cannot establish replay protection. Polling also needs to drain several ready items without repeatedly admitting the first result or collecting an unbounded backlog into memory.

## Decision

Keep the existing `hmac-sha256` timestamp-and-body protocol, including its top-level replay window. Add a strict native `hmac-sha256-body` branch, defaulting to `x-hub-signature-256`, with no replay-window field. Authenticate the raw bytes before decoding UTF-8 or parsing JSON. GitHub-specific repository/action/label/base-branch filters remain editable presets over the generic webhook contract.

For body signatures, persist a receipt keyed by owner, loop, trigger node and SHA-256 of the exact body, across versions and without expiry. Neither an unsigned delivery identifier, signature case, secret rotation nor an edited business dedupe expression can reopen consumed content. A filtered delivery consumes its content too. Keep raw signatures and header collections out of persisted receipt evidence. An authored business key is a second check inside the same claim transaction, scoped to owner/loop/trigger across versions. A prior body receipt in any state, or an admitted run with that key (including an older timestamp-signed run), consumes it. A distinct body with a consumed business key is still recorded as a terminal deduplicated receipt, with no admission intent or pins, and returns 409 `DUPLICATE_KEY`. Repeating that body then returns `REPLAYED`. Body-mode authored keys longer than 512 characters are refused before receipt consumption. The timestamp receiver itself keeps its existing window semantics.

Serialize receipt claim, pending target pins and loop deletion through the engine's existing pin lock. A pending receipt retains one frozen run admission: allocated run ID, immutable invocation, initial thread, queued event and subloop pins. The admission port commits the run, initial thread, pins, sequence-1 event and receipt link atomically, then notifies subscribers. Reuse is allowed only for that frozen ID after checking immutable identity. Public run-start surfaces cannot supply it.

Run ordinary recovery before admitting pending webhooks at startup, so fresh work is not inventoried as interrupted. Malformed stored intents fail only their own receipt permanently; a bounded sweep continues with other due receipts. Retry pending admissions at startup and through a non-overlapping 15-second sweep, at most five due receipts per sweep, with persisted backoff capped at five minutes. Filtered, deduplicated, pending, admitted and permanently failed receipts remain distinguishable through safe delivery metadata. This is a narrow webhook recovery mechanism, not a general message queue.

Optional poll `items` mode selects at most 200 curated JSON candidates, computes every unique nonblank item key before I/O, performs one indexed seen-key lookup and starts unseen items sequentially. `maxRunsPerPoll` is 1–25, default 5; seen items do not consume the cap. The batched lookup is an optimization: each item admission atomically checks committed run keys and pending allocated webhook intents under the same owner/loop/node scope and pin lock. A concurrent duplicate creates no run, event or notification and consumes no cap. Pending reservations survive transient failure and release only on permanent failure; admitted keys remain consumed. The body claim also sees committed poll keys, covering either arrival order after republishing a trigger. The first admission failure leaves that item and later candidates for a future poll. Items mode requires successful valid-JSON probes and explicit detection of script stdout overflow above 65,536 bytes. Existing single-result text/exit-code probe behavior is unchanged.

HTTP probes exclude credential-bearing response headers from saved results, and trigger diagnostics use safe codes instead of raw transport/process exception text. This is not arbitrary payload redaction.

## Storage and upgrade

Migration `0008` adds endpoint signing scheme/window constraints, durable receipts and an indexed trigger dedupe lookup. These changes extend the same stopped-instance format-2 converter introduced in ADR-0022. Already-canonical format-2 development stores still require structural readiness and the offline manifest workflow; the version number alone is not proof of readiness. Startup refuses an unconverted nonempty store before ordinary migrations, recovery or trigger arming. The converter refuses all nonterminal runs and pending admissions.

Only a provable old default timestamp-signature dedupe key is rewritten to a signature hash, using matching endpoint and version/node provenance. Custom keys remain authored values; missing or ambiguous provenance is a refusal. Disabled endpoints left by ordinary loop deletion may remain unchanged only when the loop, its versions and runs are absent and every retained delivery has an empty, well-formed run-link list. Their keys are not inferred or rewritten. Enabled endpoints, surviving execution references and inconsistent live-loop provenance still refuse conversion. Existing canonical evaluator history keeps its facts and resumability. No runtime compatibility branch or additional format version is introduced.

## Consequences

Body signing provides authenticity without a timestamp freshness claim. Indefinite content consumption prevents a captured body from being replayed after republishing, but it also prevents reprocessing the same bytes after correcting a filter. The product must explain that tradeoff. Use a separate signing secret per logical endpoint.

Polling observes current state, not every intervening GitHub event. Partition queries that exceed the documented byte or item bounds rather than silently truncating candidates. A laptop can use polling without exposing an inbound receiver; webhook installations should expose only `/hooks/*` through HTTPS.

Implementation tests, real GitHub delivery and owner product review remain required before this issue's child PR merges. This record approves the architecture, not those uncompleted checks.
