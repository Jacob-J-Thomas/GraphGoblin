# #168: trigger configuration and general webhooks

This is the first approval comment. The technical plan follows as the second comment. Both describe proposed work, not completed implementation. The owner must replace `needs-plan-approval` with `plan-approved`; product review remains required before each child PR merges.

## What changes and what stays

The trigger editor starts with five choices: Manual, Cron, Webhook, Event and Poll. These remain configurations of one trigger node. Cron keeps its name. GitHub becomes an optional recipe below the type selector, and every generated node and field remains editable.

A webhook can receive a normal POST from any sender without requiring a signature. The two existing signature checks remain available. You choose how to read the body and where its event type comes from. GraphGoblin sends a quick 202 acknowledgement after saving the delivery; it does not wait for the loop to finish. Senders requiring a different signing protocol or a verification challenge need later work.

Payload checks move out of triggers. The GitHub recipe adds a decision that checks the signed repository and event body, continues on a match, and otherwise finishes quietly. Classifier decisions and script nodes can also do this work. A decision changes the latest output, so the recipe restores the trigger output before continuing into an existing graph.

Webhook and event deliveries use the same durable admission path. Saving an event also saves its intended recipients, so a crash cannot leave a consumed event with missing work. Recovery reuses the saved run identities. A shared contract test runs against both the in-memory fake and SQLite.

Existing webhook addresses, owner-scoped signing secrets, consumed receipts, polling dedupe and cron catch-up remain. Both existing poll modes remain because whole-probe and per-item payloads serve different purposes. Poll credentials, pagination, cursors, backfill and rate-limit policy remain outside this issue.

## Decisions for the owner

**Question 5: allow identical bodies, or consume them permanently?**

I recommend allowing identical bodies for newly configured webhooks. A sender that legitimately repeats content can start another run, unless its configured business key makes that delivery a duplicate; timestamp checks still apply. An unkeyed retry after a lost acknowledgement can also start another run.

The alternative is to consume each exact body permanently. A sender that legitimately repeats the same content starts only one run, even after publishing a new loop version or changing the downstream decision. This prevents repeated content from starting work, but also prevents intentional reprocessing of those bytes.

Under either choice, existing consumed bodies and keys stay consumed. Existing body-signed configurations retain their current policy; choosing Allow later does not erase old receipts. Reopening that historical consumption would require a separate reviewed operation.

**Approve the change caused by moving filters.** A formerly ignored delivery will create a run that immediately finishes, and a bad decision expression will fail that run after acknowledgement. Event keys may be consumed before the downstream check. Each stored filter therefore needs a reviewed graph conversion or an explicit replacement; the converter will not silently discard it.

**Decide #167 before the shared cutover.** Its revised recommendation is to keep exit loop-back for now, with medium confidence. If the owner prefers the middle option, where a continuation node owns the iteration budget, decide it now and include it in format 4; choosing it later would require another stored-data cutover. #168 can use either approved terminal exit shape and adds no loop-back to its quiet finish.

**Resolve the shared cutover prerequisites.** I recommend unparking #152 so fresh initialization commits its schema and format marker together; alternatively, explicitly approve that scoped fix inside #164. For a store with orphan runs, unpark #118 and repair existing provenance before cutover, or approve exact orphan resolutions in #164's inventory. Missing definitions cannot be guessed. These issues are parked today, so this plan does not assume either is authorized or fixed.

#127 need not be unparked for this issue: verification can bypass the affected local cache. Plan approval does not approve an unseen data manifest or an installed upgrade.

## Effort and confidence

Allow 14-20 worker days for implementation, independent QA and review fixes, plus 2-3 days of participation in the shared cutover rehearsal. Owner and reviewer turnaround, and the other issues' implementation, are additional. Confidence is high for the editor and existing protocols, and medium for event fan-out recovery and stored-data conversion.

## Child PRs, in order

The shared order is #165 removal, #164 decisions and approved exits, #168 children, then one cutover into `feat/format-4-integration`.

1. T1 puts the type selector first, makes presets optional, and prepares current test fixtures.
2. T2 makes GitHub an editable downstream decision graph with a preview and one-step undo.
3. T3 replaces `subtype` with `type` throughout the current contract and clients.
4. T4 adds general body decoding, event extraction and one durable admission path for every webhook and event, with 202 once saved.
5. T5 adds the approved repeat policy and explains duplicates and recovery in Events.
6. T6 removes the remaining trigger filters, completes reviewed conversion rules and verifies the poll bounds.
7. The shared cutover applies the single #164 manifest and SQL set, then rehearses on supplied offline copies.

Each child gets independent Claude Opus 5.5 review, separate GPT-6.1 Sol QA, and owner review of a running disposable product. No intermediate integration store is an upgrade target. Nothing ships until the integration branch merges to main.

## Main risks

Allow cannot distinguish an unkeyed retry from a deliberate repeat. Permanent consumption can suppress legitimate repeated events. Moving filters changes visible runs and errors, even when routing is equivalent. Event fan-out must preserve every selected recipient through crashes, and the converter must preserve actual history rather than inventing missing admissions.

There is one stopped-instance format-3-to-format-4 conversion. Pending deliveries, active runs, unresolved finalization and unsupported provenance block it. The dry run executes the real conversion on a separate copy. The owner's instance, port 4747 and `~/.graphgoblin` remain untouched during this work.

## Running-product reviews and mock-ups

T1 first shows the Manual, Cron and Poll layouts below. It also shows the primary Event and Webhook choices. T4 adds the general Webhook controls, T5 adds repetition controls, and T6 first shows the complete Event and Webhook layouts without trigger filters. T2 first shows the GitHub graph preview; T6 shows its complete final form. T3 gives the owner saved and exported configuration to inspect. Each later child also demonstrates real deliveries and the resulting Events entries.

Manual: first shown in T1.

```text
+-- Manual --------------------------------+
| Trigger type [Manual v]
| Manual / Cron / Webhook / Event / Poll
| Input schema [Edit JSON schema] (optional)
| Expose to [x] UI [x] API [x] MCP
| Start from Runs > New run, API or MCP.
+------------------------------------------+
```

Cron: first shown in T1.

```text
+-- Cron ----------------------------------+
| Trigger type [Cron v]
| Schedule [Daily v] Time [07:30]
| Timezone [America/Chicago] [Use mine]
| Missed fires [run-once v] Enabled [x]
| Next five fires: trigger and viewer zones
| > Advanced expression [30 7 * * *]
+------------------------------------------+
```

Webhook: general controls in T4, repetition in T5, complete layout in T6.

```text
+-- Webhook -------------------------------+
| Trigger type [Webhook v]
| Endpoint [/hooks/<stable-address>] [Copy]
| Available after publish
| Authentication [None v]
| None / HMAC body / HMAC timestamp + body
| HMAC secret name [hook-secret]
| Signature header [x-hub-signature-256]
| Fixed protocol: SHA256, hex, sha256=
| Timestamp window [300] seconds
| Body [JSON v / Text / Bytes]
| Empty JSON [Null v / Reject]
| Event type from [Header v]
| Header [x-service-event] Fallback [webhook]
| Or constant [webhook] / body path [/type]
| Repeated body [Allow v / Consume forever]
| Business dedupe [None v / Key]
| Key expression [JSONata ...]
| Scope [Trigger: forever v]
| Or endpoint version: window [300] seconds
| Reply: 202 after saving; work runs later.
| Payload checks use downstream nodes.
| > Optional presets [GitHub ...]
+------------------------------------------+
```

Event: primary layout in T1, complete filter-free layout in T6.

```text
+-- Event ---------------------------------+
| Trigger type [Event v]
| Event type [issue-ready]
| Dedupe key [expression ...] (optional)
| Source: POST /events or loop return events
| Payload checks use downstream nodes.
+------------------------------------------+
```

Poll: first shown in T1; T6 verifies failure and byte-bound behavior.

```text
+-- Poll ----------------------------------+
| Trigger type [Poll v]
| Interval [60] seconds Enabled [x]
| Probe [HTTP v] Method [GET] URL [https://...]
| Headers [...] Body [...] Timeout [30]
| Script: Command [node] Args [...] Timeout [60]
| Scripts run in the data directory.
| Fire when [probe.status = 200]
| Result [Whole probe v / Items]
| Whole probe: dedupe key [...] (optional)
| Items: select [probe.json], key [item.id]
| Maximum new runs [5], at most 200 items
| > Optional presets [GitHub issues poll ...]
+------------------------------------------+
```

GitHub: graph preview in T2, complete final recipe in T6.

```text
+-- Optional GitHub recipe ----------------+
| Recipe [Issue gets a label v]
| Owner [octo-team] Repository [service-repo]
| Label [ready] Secret name [github-hook]
| Pull request recipes: base branch [main]
| Preview: body HMAC, JSON, x-github-event
| Business key: x-github-delivery
| Repeat policy: the approved default
| hook -> check --pass--> restore -> work
|               --ignore--> quiet finish
| Expression [full editable expression ...]
| Repository checks use the signed body.
| Headers are unsigned hints.
| Adds three nodes and rewires hook.out.
| [Apply recipe] [Cancel]
| All nodes are editable; Undo restores all.
+------------------------------------------+
```

T4 and T5 will demonstrate saved-but-pending deliveries, retries and multi-recipient events. The cutover review shows preserved addresses and consumption, converted downstream checks, and existing run history on supplied copies. The technical comment specifies the #163 debt dispositions, #164 manifest entries and reserved SQL numbering.
