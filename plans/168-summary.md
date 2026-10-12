# #168: trigger configuration and general webhooks

This is the first approval comment. The technical plan follows as the second comment. Both describe proposed work, not completed implementation. The owner must replace `needs-plan-approval` with `plan-approved`; product review remains required before each child PR merges.

## What changes and what stays

The trigger editor starts with five choices: Manual, Cron, Webhook, Event and Poll. These remain configurations of one trigger node. Cron keeps its name. GitHub becomes an optional recipe below the type selector, and every generated node and field remains editable.

A webhook can receive a normal POST from any sender without requiring a signature. The two existing signature checks remain available. You choose how to read the body and where its event type comes from. GraphGoblin sends a quick 202 acknowledgement after saving the delivery; it does not wait for the loop to finish. Senders requiring a different signing protocol or a verification challenge need later work.

Payload checks move out of triggers. The GitHub recipe adds a decision that checks the signed repository and event body, continues on a match, and otherwise finishes quietly. Classifier decisions and script nodes can also do this work. A decision changes the latest output, so the recipe restores the trigger output before continuing into an existing graph.

Every webhook uses the existing durable receipt path. Saving a delivery also saves its run intent, so a crash cannot consume a delivery and lose its work. Recovery reuses the saved run identity. One admission contract test runs against both the in-memory fake and SQLite. Event fan-out reliability remains a separate backlog proposal.

Existing webhook addresses, owner-scoped signing secrets, consumed receipts, polling dedupe and cron catch-up remain. Both existing poll modes remain because whole-probe and per-item payloads serve different purposes. Poll credentials, pagination, cursors, backfill and rate-limit policy remain outside this issue.

## Decisions for the owner

**Question 5: May identical authenticated bodies start new runs?**

I recommend allowing them, uniformly for every webhook. A sender that legitimately repeats a body can start another run unless its configured business key is already consumed; existing signature and timestamp checks still apply. An unkeyed retry after a lost acknowledgement can also start another run.

The alternative is permanent consumption of each exact body, uniformly for every webhook. A sender that legitimately repeats content starts only one run for that trigger, even after publishing a new version or changing its downstream decision. Identical intentional repeats would need different bytes or a later, separately approved reprocessing feature.

The chosen behavior is fixed in the current implementation, with no per-webhook policy switch. Old receipts and keys remain factual history. Allow removes raw-body suppression for future deliveries, including a body seen before the upgrade; configured business keys still consult preserved claims. Permanent consumption consults all preserved raw-body claims.

**Approve the change caused by moving filters.** A formerly ignored delivery will create a run that immediately finishes, and a bad decision expression will fail that run after acknowledgement. Event keys may be consumed before the downstream check. Each stored filter therefore needs a reviewed graph conversion or an explicit replacement; the converter will not silently discard it.

**Decide #167 before the shared cutover.** The posted recommendation is option 3 (variant C), with medium confidence, and #164 agrees. Decisions own policy, a Continue node owns `maxPasses`, and terminal exits declare outcomes and returns. The pass budget and separate cumulative node safety cap both start from the old `maxIterations`. Choosing this later would require another stored-data cutover. #168's quiet finish uses the approved terminal exit and needs no Continue node.

**Resolve the shared cutover prerequisites.** I recommend unparking #152 so fresh initialization commits its schema and format marker together; alternatively, explicitly approve that scoped fix inside #164. For a store with orphan runs, unpark #118 and repair existing provenance before cutover, or approve exact orphan resolutions in #164's inventory. Missing definitions cannot be guessed. These issues are parked today, so this plan does not assume either is authorized or fixed.

#127 need not be unparked for this issue: verification can bypass the affected local cache. Plan approval does not approve an unseen data manifest or an installed upgrade.

## Effort and confidence

Allow 16-23 worker days, including implementation, independent QA, review fixes and participation in the shared rehearsal. With option 3, the programme total is about 34-51 worker days: #164 takes 12-19, #165 takes 6-9, and #168 takes 16-23. It grew from #164's initial 3-5 day estimate because the programme now includes coordinated contracts, runtime and editor changes, retirement, reviewed conversion, QA and a real-copy rehearsal. Feedback turnaround is additional. Confidence is high for the editor and existing protocols, and medium for receipt recovery and stored-data conversion.

## Child PRs, in order

These children follow #164's single integration sequence, after its decisions and approved exits. There is no earlier presentation exception. Every child targets `feat/format-4-integration`.

1. Step 20, T1 puts the type selector first, makes presets optional, and prepares current fixtures.
2. Step 21, T2 makes GitHub an editable downstream decision graph with a preview and one-step undo.
3. Step 22, T3 replaces `subtype` with `type` throughout the current contract and clients.
4. Step 23, T4 adds general decoding, event extraction and atomic webhook receipt admission, with 202 once saved.
5. Step 24, T5 implements the owner's one repeat decision and one business-key behavior, and explains recovery in Events.
6. Step 25, T6 removes the remaining trigger filters, completes reviewed conversion rules and verifies existing poll behavior.
7. Steps 26-28 compose the manifest, preserve device data and perform #164's one shared cutover rehearsal.

Each child gets independent Claude Opus 5.5 review, separate GPT-6.1 Sol QA, and owner review of a running disposable product. No intermediate integration store is an upgrade target. Nothing ships until the integration branch merges to main.

## Main risks

Allow cannot distinguish an unkeyed retry from a deliberate repeat. Permanent consumption can suppress legitimate repeated events. Moving filters changes visible runs and errors, even when routing is equivalent. Existing event fan-out has a known crash gap; fixing that is separate work. The converter preserves actual history and never invents missing admissions.

There is one stopped-instance format-3-to-format-4 conversion. #164's joint pending-state rule refuses active runs, pending receipts or intents, notifications, timers and unfinished finalization; the old build settles them first. Its sole exception is an owner-approved per-run archive of a retired template's private report, with reason and evidence preserved. The converter never abandons, drains or executes work. The dry run uses a separate copy. The owner's instance, port 4747 and `~/.graphgoblin` remain untouched.

## Running-product reviews and mock-ups

T1 first shows the Manual, Cron and Poll layouts below and the primary Event and Webhook choices. T4 adds general Webhook controls. T5 demonstrates the fixed repeat behavior rather than adding a policy selector. T6 first shows the complete Event and Webhook layouts without trigger filters. T2 first shows the GitHub graph preview; T6 shows its complete final form. T3 gives the owner saved and exported configuration to inspect. Later children demonstrate real deliveries and Events entries.

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

Webhook: general controls in T4, repeat demonstrations in T5, complete layout in T6.

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
| JSON must be valid and nonempty.
| Event type from [Header v]
| Header [x-service-event] Fallback [webhook]
| Or constant [webhook] / body path [/type]
| Repeats: one behavior approved for all hooks.
| Business dedupe [None v / Key]
| Key expression [JSONata ...]
| Keys persist for this trigger across versions.
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

Poll: first shown in T1; T6 verifies existing validation and failure behavior.

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
| Repeats follow the one approved behavior.
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

T4 and T5 demonstrate saved-but-pending webhooks, retries and legitimate repeats. The cutover review shows preserved addresses, receipt and key history, converted downstream checks and existing runs on supplied copies. The technical comment records the #163 debt dispositions, #164 manifest entries and SQL numbering.
