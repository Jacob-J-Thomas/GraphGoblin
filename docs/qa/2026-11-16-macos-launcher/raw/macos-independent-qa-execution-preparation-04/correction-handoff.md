# #456 macOS QA harness: execution preparation 04 correction handoff

**Author.** Claude Code `claude-opus-5-5` (xhigh), the independent behavior QA worker, on 2026-11-16.

**What this is.** QA-harness implementation, prepared and locally checked. It is not a review, not a formal scan, not a native run and not a QA pass. **The native status is unexecuted.**

**QA05 is unchanged.** Receipt `../macos-independent-qa-transport-correction-05/receipt-c8bc55cacb944f7985574643b8fc2346/` remains a stopped, not-passing run:
- S0–S3 and the recovery drain met their criteria;
- S4 created the loop (201), then got `run-admitted` 404 `LOOP_NOT_FOUND`;
- no fixture manifest was written.

**Candidate (unchanged).** `18089bba4b1c5f4fad19627d4c118b48b656a247`, tree `c6781a4daf2c2b2ee57cd031a774d9724a038787`, owner build05 token `6389524e51bd4c56b39cb8d8bb8ceae8`. No product correction or rebuild is needed for these harness defects.

**Inputs (read-only, not modified):**
- driver 03 at `../macos-independent-qa-execution-preparation-03/`;
- the QA05 receipt;
- the assessment 05 final report;
- the contract note `../macos-independent-qa-api-contract-readback-01.md`. Re-hashed: 8,398 bytes, SHA-256 `688cad0c765e9c3282f073d18cff260cd93adb3bd36be406b842be4b806b7eb3`.

**Output:** this directory.

**Binding:** `binding.template.json` is byte-identical to preparation 03 (`cmp`), and still has `final: false`, `boundBy: null`, `driverSha256: null`. No fixture, admission or binding was created.

## Each defect, confirmed before editing

### 1. S4 started the draft without its `versionId`

The QA05 evidence `E/stage-S4-…json` records `loop-created` 201 with `issues: []`, then `run-admitted` 404 `LOOP_NOT_FOUND`. The driver 03 start body was `{ allowDraft: true }` (line 1073).

The source shows why that fails:
- `POST /loops` returns `{loop, draft, issues}` (`apps/api/src/routes/loops.ts:145-180`).
- SQLite creates a draft-only loop: `currentVersionId` null, `draftVersionId` the draft (`packages/infrastructure/src/sqlite/loops.ts:162-187,565-571`).
- The start route uses `body.versionId || loop.currentVersionId` (`apps/api/src/routes/runs.ts:96`).
- `RunManager.resolveVersion` then loads the latest published version. With none, it throws `LOOP_NOT_FOUND` "has no published version" (`packages/engine/src/run-manager.ts:3362-3371`).
- A draft start freezes a snapshot under a new ID (`run-manager.ts:686-690`, `definition-pin.ts:86-103`).
- The docs give the same contract: `docs/07-api-and-streaming.md:616-630` and `docs/guide/03-run-and-observe.md:74`.
- Two existing API tests pass `{ allowDraft: true, versionId: draft.id }`: `apps/api/src/model-readiness.test.ts:257-260` and `stored-loop-defaults.test.ts:95-103`.

**New evidence from this task.** The portless check below drove the exact driver fixture through the real route composition. It observed 404 `LOOP_NOT_FOUND` with detail "loop … has no published version". Assessment 05 could only infer that branch from source; this observes it in the route composition, though not natively.

### 2. The drain assertion read the pre-drain GET

In driver 03, `drainVerified` returned `state.json`, the pre-POST `GET /system/shutdown` taken at phase `running`, as `shutdown` (lines 572-573). S4 line 1088 then tested `!(drained.shutdown.unconfirmedRunIds ?? []).includes(runId)`.

The 202 is a different snapshot. `POST /system/shutdown` returns `snapshot(await container.requestShutdown(...))` after the transition (`apps/api/src/routes/system.ts:62-92`), with `unconfirmedRunIds` a required array (`apps/api/src/shutdown.ts:7-26`).

The defect was reproduced on the unchanged driver 03 bytes (R2, R3 below): a POST that flags the run, or omits the array, still met the check.

### 3. S5 compared raw `launcher.json` bytes across installs

Driver 03 line 1124 compared the two installs' `launcher.json` SHA-256 values. The 18089 encoder uses `JSONSerialization` with `.withoutEscapingSlashes` only: "Configuration readers ignore member order, so avoid locale-sensitive key sorting" (`apps/macos-launcher/Engine/Installation.swift:112-121`).

The three QA05 records hold seven deep-equal fields in three member orders:

| Record | Member order | SHA-256 |
| --- | --- | --- |
| `installed-a.json` | requireAPIKey, port, version, checkout, node, dataDirectory, ollamaEnabled | `7479f6e8…565c3d` |
| `installed-a-nfd.json` | node, dataDirectory, requireAPIKey, version, checkout, ollamaEnabled, port | `52909c11…6eb94` |
| `installed-a-case.json` | port, dataDirectory, version, checkout, ollamaEnabled, node, requireAPIKey | `4f08dab9…560525` |

For each record, `JSON.stringify` of the parsed object in its recorded order reproduces:
- the recorded 332-byte length;
- the recorded SHA-256;
- the receipt's `installed.configuration` value.

See control C0. Reproduced on driver 03 (R4): a value-identical, reordered B is reported unmet.

## Delta (driver)

The full `diff -U0 ../macos-independent-qa-execution-preparation-03/gg456-native-qa.mjs gg456-native-qa.mjs` output follows, without its two header lines. Its SHA-256 is `f280ecf0b3446c0be5e471cdf500ea21e949c2d4c2d3fcff039d4e9942b7666b` (75 lines).

```diff
@@ -7 +7 @@
-// Preparation 03: copy of preparation 02 with the built-asset response bound listed in correction-handoff.md.
+// Preparation 04: copy of preparation 03 with the three S4/S5 oracle corrections listed in correction-handoff.md.
@@ -28,0 +29 @@
+import { isDeepStrictEqual } from 'node:util';
@@ -541,0 +543,12 @@
+// The drain's own accepted 202 snapshot, kept apart from the pre-drain GET. Only these allowlisted members are kept;
+// a run-ID list only as an array of at most 256 ULIDs (otherwise null, with its observed shape). controlToken and every
+// other member are never recorded.
+function acceptedDrainFields(body) {
+  const shape = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
+  const runIds = (value) => (Array.isArray(value) && value.length <= 256 && value.every((id) => typeof id === 'string' && ULID.test(id)) ? [...value] : null);
+  return { phase: typeof body?.phase === 'string' ? body.phase.slice(0, 32) : null, activeRunIds: runIds(body?.activeRunIds),
+    unconfirmedRunIds: runIds(body?.unconfirmedRunIds), shapes: { activeRunIds: shape(body?.activeRunIds), unconfirmedRunIds: shape(body?.unconfirmedRunIds) },
+    choices: Array.isArray(body?.choices) && body.choices.every((c) => c === 'wait' || c === 'force') ? [...body.choices] : null,
+    graceMs: Number.isFinite(body?.graceMs) ? body.graceMs : null };
+}
+
@@ -552,0 +566 @@
+  const accepted = acceptedDrainFields(drain.json);
@@ -571,0 +586 @@
+  // `shutdown` is the pre-drain GET (phase running); `accepted` is the drain's own 202 snapshot.
@@ -573 +588 @@
-    choices: state.json.choices ?? null, graceMs: state.json.graceMs ?? null }, series, elapsedMs: now() - start };
+    choices: state.json.choices ?? null, graceMs: state.json.graceMs ?? null }, accepted, series, elapsedMs: now() - start };
@@ -646,0 +662,4 @@
+// Member order is not part of the saved-configuration contract (18089 removed locale-sensitive key sorting), so two
+// independent installs compare by exact parsed equality: the same members with the same types and values, in any order.
+// Closed keys, canonical values and each receipt's binding to its own configuration bytes stay in checkInstalled.
+const sameConfiguration = (a, b) => a !== null && typeof a === 'object' && !Array.isArray(a) && isDeepStrictEqual(a, b);
@@ -695,0 +715,22 @@
+// C1: POST /loops answers 201 {loop, draft, issues}. A new loop has only that draft and no published version, so the start
+// names the draft explicitly; an omitted versionId selects the latest published version and answers 404 LOOP_NOT_FOUND (QA05).
+const ulidOrNull = (value) => (typeof value === 'string' && ULID.test(value) ? value : null);
+function draftStart(created) {
+  const ids = { loopId: ulidOrNull(created?.loop?.id), loopDraftVersionId: ulidOrNull(created?.loop?.draftVersionId),
+    draftId: ulidOrNull(created?.draft?.id), draftLoopId: ulidOrNull(created?.draft?.loopId),
+    draftStatus: typeof created?.draft?.status === 'string' ? created.draft.status.slice(0, 16) : null,
+    draftVersion: Number.isSafeInteger(created?.draft?.version) && created.draft.version > 0 ? created.draft.version : null };
+  const ok = ids.loopId !== null && ids.draftId !== null && ids.draftId !== ids.loopId && ids.draftLoopId === ids.loopId &&
+    ids.loopDraftVersionId === ids.draftId && ids.draftStatus === 'draft' && ids.draftVersion !== null;
+  return { ok, ids, body: ok ? { versionId: ids.draftId, allowDraft: true } : null };
+}
+// A draft start pins a new immutable snapshot (ADR-0041): run.versionId is a fresh ID, never the submitted draft ID.
+// Only public run fields are read; the same projection is compared after restart.
+function draftRunPin(run, start) {
+  const pin = { runId: ulidOrNull(run?.id), loopId: ulidOrNull(run?.loopId), versionId: ulidOrNull(run?.versionId),
+    source: typeof run?.pinned?.source === 'string' ? run.pinned.source.slice(0, 16) : null,
+    version: Number.isSafeInteger(run?.pinned?.version) ? run.pinned.version : null };
+  const ok = start.ok && pin.runId !== null && pin.loopId === start.ids.loopId && pin.versionId !== null &&
+    ![pin.runId, pin.loopId, start.ids.draftId].includes(pin.versionId) && pin.source === 'draft' && pin.version === start.ids.draftVersion;
+  return { ok, pin };
+}
@@ -1073 +1114,3 @@
-    const started = await api(P, 'POST', `/loops/${loopId}/runs`, { allowDraft: true });
+    const start = draftStart(made.json);
+    must(ctx, 'draft-bound-to-loop', start.ok, start.ids);
+    const started = await api(P, 'POST', `/loops/${loopId}/runs`, start.body);
@@ -1076 +1119,3 @@
-    ctx.data = { loopId, runId, loopName: definition.name, waitSeconds: WAIT_SECONDS, startedAt: iso() };
+    const admitted = draftRunPin(started.json.run, start);
+    ctx.data = { loopId, runId, draftVersionId: start.ids.draftId, runVersionId: admitted.pin.versionId, loopName: definition.name, waitSeconds: WAIT_SECONDS, startedAt: iso() };
+    must(ctx, 'run-pins-new-draft-snapshot', admitted.ok, { pin: admitted.pin, draftVersionId: start.ids.draftId });
@@ -1088 +1133,3 @@
-    want(ctx, 'waiting-run-not-unconfirmed', !(drained.shutdown.unconfirmedRunIds ?? []).includes(runId), drained.shutdown);
+    // The drain's own accepted 202 snapshot, not the pre-drain GET: a real array of unconfirmed run IDs without this run.
+    want(ctx, 'waiting-run-not-unconfirmed', Array.isArray(drained.accepted.unconfirmedRunIds) && !drained.accepted.unconfirmedRunIds.includes(runId),
+      { accepted: drained.accepted, runId });
@@ -1096,0 +1144,2 @@
+    const kept = draftRunPin(retained.json, start);
+    must(ctx, 'run-pin-retained-across-restart', kept.ok && json(kept.pin) === json(admitted.pin), { admitted: admitted.pin, retained: kept.pin });
@@ -1124 +1173,2 @@
-    want(ctx, 'identical-saved-configuration', b.files['Contents/Resources/launcher.json'].sha256 === ctx.app.a.files['Contents/Resources/launcher.json'].sha256);
+    want(ctx, 'identical-saved-configuration', sameConfiguration(b.config, ctx.app.a.config),
+      { configSha256: { a: ctx.app.a.files['Contents/Resources/launcher.json'].sha256, b: b.files['Contents/Resources/launcher.json'].sha256 } });
```

### Semantics

**Defect 1 (S4 start).** `draftStart(made.json)` reads only public create-response fields. It requires all of:
- `loop.id` and `draft.id` are ULIDs, and distinct;
- `draft.loopId === loop.id`;
- `loop.draftVersionId === draft.id`;
- `draft.status === 'draft'`;
- a positive integer `draft.version`.

New hard check `draft-bound-to-loop` refuses before any start request is sent. The start body is exactly `{ versionId: <draft.id>, allowDraft: true }`. `run-admitted` is unchanged: 202 plus a ULID `run.id`.

New hard check `run-pins-new-draft-snapshot` requires all of:
- `run.loopId === loop.id`;
- `run.versionId` is a ULID different from the draft, loop and run IDs;
- `pinned.source === 'draft'`;
- `pinned.version === draft.version`.

It never asserts that `run.versionId` equals the submitted draft ID. `ctx.data`, and therefore the manifest `data`, now also carries `draftVersionId` and `runVersionId`.

After restart, new hard check `run-pin-retained-across-restart` requires the same run, loop, snapshot, source and version projection on the flat `GET /runs/{id}`.

**Defect 2 (drain source).** `drainVerified` behavior and deadlines are unchanged:
- the same token pre-read;
- every check: registered-owner, shutdown-state, same-incarnation, drain-accepted (202), never-forcing, released (refused port, PID or birth gone, leases free) and store-free;
- `BOUND.release` stays 30 s.

The only change is that it also returns `accepted`, built by `acceptedDrainFields(drain.json)`. That function keeps exactly `phase`, `activeRunIds`, `unconfirmedRunIds`, `shapes`, `choices` and `graceMs`:
- run-ID lists are kept only as arrays of at most 256 ULIDs; otherwise `null`, with the observed shape recorded;
- `controlToken`, `error`, `startedAt` and every other member are never recorded.

The GET fields under `shutdown` are unchanged. The S4 `waiting-run-not-unconfirmed` check stays `want`. It now requires `Array.isArray(accepted.unconfirmedRunIds)` and that the array excludes the run. A missing, null, string, object or invalid-ID list is therefore unmet.

**Defect 3 (S5 equality).** `identical-saved-configuration` stays `want`, now `sameConfiguration(b.config, ctx.app.a.config)`. That is a non-null, non-array object plus `node:util` `isDeepStrictEqual`:
- members, types and values must match exactly, in any order;
- there is no normalization, and an extra or missing member fails.

Its detail records both configuration SHA-256 values. These checks are unchanged:
- `checkInstalled`: `config-closed-keys`, `config-values`, `config-options`, `receipt-binding` (each receipt equals its own `launcher.json` bytes) and `receipt-settled`;
- `alias-saved-as-canonical-store`;
- `store-spelling-bytes-identical` (byte-string store equality);
- every ownership and publication assertion.

**Unchanged byte for byte.** Guarded mechanically by the controls: every line outside the hunks above is identical, `restIdentical: true`. That covers:
- the canary environment and all hostile fields;
- admission and scope admission;
- `shells()`, `http()`, `CAP` (asset bound and caps) and `BOUND`;
- fixture isolation;
- S0–S3 and S6–S9;
- the recovery drain;
- `observe` and `drain` modes;
- the no-signal, no-force policy;
- exit codes and CLI.

The driver contains no SSH; the transport stays with root.

**Flagged for root.**
- The three new checks are hard (`must`), because later retention and history depend on them.
  - `draft-bound-to-loop` also gates the request.
  - `run-pin-retained-across-restart` reads the existing S4 criterion ("the same run and loop IDs are retained") as covering the run's pinned snapshot identity.
  - Root may downgrade either if it prefers.
- The restart half is verified only by the controlled seam, not by a real process restart (see Evidence limits).

## Delta (supporting files)

`README.md` (`3dbdb322…` to `907cc5f9…`): `diff -U0` body below, SHA-256 `0fafba7f6aec2d487025426e1728a6e0d3e1e627168b30e028a0a067b47fa944`.

```diff
@@ -1 +1 @@
-# #456 macOS launcher: independent owner-native QA driver (execution preparation 03)
+# #456 macOS launcher: independent owner-native QA driver (execution preparation 04)
@@ -3 +3,12 @@
-**Status: prepared and not run.** Preparation 03 is a byte-for-byte copy of execution preparation 02 with one harness correction, listed in `correction-handoff.md`. It bounds the response for a known built static asset by that asset's exact built length, within a fixed 4 MiB ceiling, instead of the 2 MiB API and shell cap. The QA03 run stopped on that cap at the 2,132,126-byte `/app/` entry asset. The local checks were `node --check`, a JSON parse of the two JSON files, the offline loopback regression beside this file and SHA-256 hashes, all under the project Node 22.23.4 on Windows. Nothing was executed on macOS. It is QA harness authoring. It is not a review, not an adversarial scan and not a pass. Author: Claude Code `claude-opus-5-5` (xhigh), acting as the independent behavior QA worker, on 2026-11-16. It builds on the prior plan in `../macos-independent-qa-preparation-01/` and keeps its case IDs.
+**Status: prepared and not run.** Preparation 04 is a byte-for-byte copy of execution preparation 03 with three S4/S5 oracle corrections, listed in `correction-handoff.md`. QA05 stopped in S4 because the draft run was started without the draft's `versionId`. The three corrections are:
+- S4 now starts the created draft explicitly and checks the new pinned snapshot identity.
+- S4 now judges `unconfirmedRunIds` from the accepted drain's own 202 snapshot.
+- S5 now compares the two installs' saved configurations by exact parsed equality, ignoring member order.
+
+The local checks were all under the project Node 22.23.4 on Windows:
+- `node --check`;
+- the offline controls and the mutation sanity pass beside this file;
+- a recorded portless API-contract run through the repository's own test composition;
+- SHA-256 hashes.
+
+Nothing was executed on macOS. It is QA harness authoring. It is not a review, not an adversarial scan and not a pass. Author: Claude Code `claude-opus-5-5` (xhigh), acting as the independent behavior QA worker, on 2026-11-16. It builds on the prior plan in `../macos-independent-qa-preparation-01/` and keeps its case IDs.
@@ -11,3 +22,8 @@
-| `correction-handoff.md` | The preparation 03 delta and its cause, the exact diffs, the checks actually run, the source and output hashes, and the native status. |
-| `offline-asset-bound-regression.mjs` | Offline Node 22 regression: evaluates the exact `shells()` and `http()` bytes of drivers 02 and 03 against an in-process loopback test server. |
-| `offline-asset-bound-regression.result.json` | The retained output of its one run. |
+| `correction-handoff.md` | The preparation 04 delta and its cause, the exact diffs, the checks actually run, the source and output hashes, and the native status. |
+| `offline-oracle-controls.mjs` | Controlled offline controls. They run the exact S4 and S5 stage bytes of drivers 03 and 04 against a loopback fake API with stubbed native probes, and use the actual QA05 configuration records. |
+| `offline-oracle-controls.result.json` | The retained output of its recorded run. |
+| `mutation-sanity.mjs` | Re-introduces each defect, and some near-miss regressions, into temporary copies of driver 04, and confirms the controls fail on every one. |
+| `mutation-sanity.result.json` | The retained output of its recorded run. |
+| `portless/` | An external Vitest config and test. They drive the repository's portless Fastify `createTestApp` with driver 04's exact fixture and helpers. The folder also holds the retained observations and run log. |
+
+The built-asset regression for preparation 03 (`../macos-independent-qa-execution-preparation-03/offline-asset-bound-regression.*`) is not repeated. `shells()`, `http()` and `CAP` are byte-identical in driver 04.
@@ -86,2 +102,2 @@
-| S4 | O7 adapted, G5 native part | A provider-free durable 45 s wait run created through the public API. The ordinary token-bound drain completes with the run active and is never forced. A verified release is followed by a cold relaunch; the same run and loop IDs are retained and the run completes. No provider child process starts. |
-| S5 | O10 | A second alternate, `GraphGoblin QA ü-<r8>-b.app`, installed from the canonical script with a symlink-aliased `--data-dir` that is saved canonically, with a distinct ID and log directory. Three concurrent cold launches (A, A and B) leave exactly one gateway at every 200 ms poll. |
+| S4 | O7 adapted, G5 native part | A provider-free durable 45 s wait run, created through the public API. It is started as an explicit draft run: the created draft's `versionId` with `allowDraft: true`, sent only after the draft ID and its binding to the loop are validated. The run pins a new immutable draft snapshot, whose run, loop, snapshot and source identity is recorded. The ordinary token-bound drain completes with the run active and is never forced. The accepted drain's own 202 snapshot must carry an `unconfirmedRunIds` array that excludes the run. A verified release is followed by a cold relaunch. The same run, loop and pinned snapshot are retained, and the run completes. No provider child process starts. |
+| S5 | O10 | A second alternate, `GraphGoblin QA ü-<r8>-b.app`, installed from the canonical script with a symlink-aliased `--data-dir` that is saved canonically, with a distinct ID and log directory. Its saved configuration equals A's by exact parsed equality, ignoring member order, with each receipt bound to its own bytes. Three concurrent cold launches (A, A and B) leave exactly one gateway at every 200 ms poll. |
@@ -156 +172 @@
-- the stored `loopId` and `runId`, for G5 history;
+- the stored `loopId`, `runId`, `draftVersionId` and pinned `runVersionId`, for G5 history;
@@ -192,0 +209,3 @@
+7. **Draft start (preparation 04).** A loop created by `POST /loops` has only its draft. A start without `versionId` therefore answers 404 `LOOP_NOT_FOUND`, which is how QA05 stopped. The start names the created draft and sets `allowDraft`. The run answers with a new snapshot `versionId`, never the draft ID.
+8. **Drain snapshot (preparation 04).** The accepted `POST /system/shutdown` 202 is its own snapshot. S4 reads `unconfirmedRunIds` from it, not from the pre-drain GET.
+9. **Configuration member order (preparation 04).** 18089 deliberately saves `launcher.json` without key sorting, so two independent installs can differ in bytes and SHA-256 while holding identical values. S5 compares the parsed objects.
```

`case-map.json` (`19dfeed3…` to `68f504f2…`): `diff -U0` body below, SHA-256 `61d29fc5a5d017a269641854de0d287623586a22ed6c3bc418abeebda186a794`. It changes:
- `revision`, `files.hashes` and `citationRoot`;
- C1 and C2 values and refs;
- the S4 and S5 `adds` and `checks`;
- three `correctionsToPriorPlan` entries.

No case IDs, stage IDs, CLI modes or exit codes changed.

```diff
@@ -7 +7 @@
-  "revision": "execution-preparation-03: copy of execution-preparation-02 with one harness correction, the built-asset response bound (correction-handoff.md)",
+  "revision": "execution-preparation-04: copy of execution-preparation-03 with three S4/S5 oracle corrections: explicit draft start with pinned-snapshot identity, the accepted drain snapshot as the unconfirmed-run source, and order-independent parsed configuration equality across installs (correction-handoff.md)",
@@ -19 +19 @@
-    "hashes": "preparation 03 source and output hashes are listed in correction-handoff.md; root re-verifies and binds driverSha256"
+    "hashes": "preparation 04 source and output hashes are listed in correction-handoff.md; root re-verifies and binds driverSha256"
@@ -21 +21 @@
-  "citationRoot": "C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin at 8bddb93a (read-only); preparation-02 refs to NativeLaunchEngine.swift read its uncommitted product correction over 8bddb93a, and root binds the final build",
+  "citationRoot": "C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin at 8bddb93a (read-only); preparation-02 refs to NativeLaunchEngine.swift read its uncommitted product correction over 8bddb93a, and root binds the final build; preparation-04 refs added to C1, C2, S4 and S5 were read at the candidate 18089bba (tree c6781a4d)",
@@ -25 +25 @@
-      "value": "Loop format 4: manual trigger (exposeTo ui/api/mcp) -> wait {mode: duration, seconds: 45} -> exit {outcome: success, returns: none, destinations: []}. Created by POST /loops {definition} (201 {loop, draft, issues}); started by POST /loops/{id}/runs {allowDraft: true} (202 {run}); observed by GET /runs/{id} (status waiting) and GET /loops (runCount).",
+      "value": "Loop format 4: manual trigger (exposeTo ui/api/mcp) -> wait {mode: duration, seconds: 45} -> exit {outcome: success, returns: none, destinations: []}. Created by POST /loops {definition} (201 {loop, draft, issues}; a draft-only loop: no currentVersionId, loop.draftVersionId = draft.id). Started by POST /loops/{id}/runs {versionId: <created draft.id>, allowDraft: true} only after draft.id is a ULID distinct from loop.id, draft.loopId = loop.id, loop.draftVersionId = draft.id, draft.status = draft and draft.version is a positive integer; an omitted versionId resolves to the latest published version and answers 404 LOOP_NOT_FOUND (QA05). 202 {run}: run.versionId is a new immutable draft snapshot, never the submitted draft ID, with run.loopId = loop.id, pinned.source = draft and pinned.version = draft.version; the same projection is compared on GET /runs/{id} after restart. Observed by GET /runs/{id} (flat run snapshot; status waiting, waiting.kind timer) and GET /loops (runCount).",
@@ -28 +28 @@
-      "refs": ["docs/04-node-catalog.md:238-253", "docs/04-node-catalog.md:277-289", "docs/07-api-and-streaming.md:18-41", "docs/07-api-and-streaming.md:525", "docs/07-api-and-streaming.md:756-764", "packages/contracts/src/loop.ts:10,101-118", "packages/contracts/src/nodes.ts:40-43,81-88,635-675,727-750,757-773", "packages/contracts/src/run.ts:19-28,330", "apps/api/src/routes/loops.ts:78,142-180", "apps/api/src/routes/runs.ts:72-120,186-198"]
+      "refs": ["docs/04-node-catalog.md:238-253", "docs/04-node-catalog.md:277-289", "docs/07-api-and-streaming.md:18-41", "docs/07-api-and-streaming.md:525", "docs/07-api-and-streaming.md:756-764", "packages/contracts/src/loop.ts:10,101-118", "packages/contracts/src/nodes.ts:40-43,81-88,635-675,727-750,757-773", "packages/contracts/src/run.ts:19-28,330", "apps/api/src/routes/loops.ts:78,142-180", "apps/api/src/routes/runs.ts:72-120,186-198", "apps/api/src/routes/runs.ts:96", "packages/engine/src/run-manager.ts:686-690,3362-3385", "packages/engine/src/definition-pin.ts:28-44,86-103", "packages/infrastructure/src/sqlite/loops.ts:162-187,546-583", "packages/contracts/src/loop.ts:131-163", "packages/contracts/src/run.ts:211-265", "docs/07-api-and-streaming.md:616-630", "docs/guide/03-run-and-observe.md:74", "apps/api/src/model-readiness.test.ts:248-265", "apps/api/src/stored-loop-defaults.test.ts:95-103"]
@@ -32 +32 @@
-      "value": "GET /healthz body exactly {\"status\":\"ok\"} with single X-GraphGoblin-Instance (64 hex), X-GraphGoblin-Pid, X-GraphGoblin-Phase. GET /system/shutdown -> {phase, graceMs, activeRunIds, unconfirmedRunIds, choices, controlToken}; POST /system/shutdown {\"action\":\"drain\"} with x-graphgoblin-shutdown-token -> 202. Local trusted mode (no key, keys not required) acts with *. Launcher maps running -> running; draining, awaiting-choice, forcing, drain-failed, force-failed -> observe-shutdown; ready, exiting, stopped -> release wait.",
+      "value": "GET /healthz body exactly {\"status\":\"ok\"} with single X-GraphGoblin-Instance (64 hex), X-GraphGoblin-Pid, X-GraphGoblin-Phase. GET /system/shutdown -> {phase, graceMs, activeRunIds, unconfirmedRunIds, choices, controlToken}; POST /system/shutdown {\"action\":\"drain\"} with x-graphgoblin-shutdown-token -> 202 with its own snapshot of the same shape (unconfirmedRunIds a required array). The driver keeps the pre-drain GET fields and, separately, only allowlisted 202 fields (phase, activeRunIds and unconfirmedRunIds as arrays of at most 256 ULIDs or null with their observed shapes, choices, graceMs); control tokens and other members are never recorded. Local trusted mode (no key, keys not required) acts with *. Launcher maps running -> running; draining, awaiting-choice, forcing, drain-failed, force-failed -> observe-shutdown; ready, exiting, stopped -> release wait.",
@@ -34 +34 @@
-      "refs": ["docs/07-api-and-streaming.md:3-8", "docs/07-api-and-streaming.md:296-313", "docs/07-api-and-streaming.md:723-751", "apps/macos-launcher/Engine/Loopback.swift:53-66,78-142"]
+      "refs": ["docs/07-api-and-streaming.md:3-8", "docs/07-api-and-streaming.md:296-313", "docs/07-api-and-streaming.md:723-751", "apps/macos-launcher/Engine/Loopback.swift:53-66,78-142", "apps/api/src/routes/system.ts:16,35-39,51-92", "apps/api/src/shutdown.ts:7-26"]
@@ -120,2 +120,2 @@
-      "adds": "Provider-free active run (durable 45 s timer) created through public routes; ordinary token-bound drain completes with the run active and is never forced; verified release (listener refused, PID gone or reborn, leases and guards absent, store-state free); cold relaunch gives a new incarnation; the same run and loop IDs are retained and the run completes after restart; no provider child process before or after.",
-      "checks": [["loop-created", "must"], ["run-admitted", "must"], ["run-active-waiting", "must"], ["no-provider-process", "must"], ["drain-with-waiting-run:* (registered owner, shutdown state, same incarnation, drain accepted, never forcing, released, store free)", "must"], ["intermediatePhasesObserved", "note"], ["waiting-run-not-unconfirmed", "want"], ["relaunch-envelope", "must"], ["new-gateway-incarnation", "must"], ["run-retained-across-restart", "must", "doc"], ["run-completed-after-restart", "want", "doc"], ["loop-retained", "want"], ["no-provider-process-after-restart", "must"], ["drain-idle:*", "must"]],
+      "adds": "Provider-free active run (durable 45 s timer) created through public routes and started as an explicit draft run (the validated created draft's versionId with allowDraft), pinning a new immutable draft snapshot whose run/loop/snapshot/source/version identity is recorded (ctx.data and the manifest data carry draftVersionId and runVersionId); ordinary token-bound drain completes with the run active and is never forced; the accepted drain's own 202 snapshot carries a real unconfirmedRunIds array without the run; verified release (listener refused, PID gone or reborn, leases and guards absent, store-state free); cold relaunch gives a new incarnation; the same run, loop and pinned snapshot are retained and the run completes after restart; no provider child process before or after.",
+      "checks": [["loop-created", "must"], ["draft-bound-to-loop", "must", "route-schema (draft ULID, draft.loopId = loop.id, loop.draftVersionId = draft.id, status draft, positive version; refused before any start request)"], ["run-admitted", "must"], ["run-pins-new-draft-snapshot", "must", "doc (run.loopId = loop.id; run.versionId a new ULID distinct from the draft, loop and run IDs; pinned.source draft; pinned.version = draft.version)"], ["run-active-waiting", "must"], ["no-provider-process", "must"], ["drain-with-waiting-run:* (registered owner, shutdown state, same incarnation, drain accepted, never forcing, released, store free)", "must"], ["intermediatePhasesObserved", "note"], ["waiting-run-not-unconfirmed", "want", "doc (the accepted 202 snapshot's unconfirmedRunIds must be an array of ULIDs that excludes the run; missing, null, non-array or invalid is unmet)"], ["relaunch-envelope", "must"], ["new-gateway-incarnation", "must"], ["run-retained-across-restart", "must", "doc"], ["run-pin-retained-across-restart", "must", "doc (the same run/loop/snapshot/source/version projection on GET /runs/{id} after restart)"], ["run-completed-after-restart", "want", "doc"], ["loop-retained", "want"], ["no-provider-process-after-restart", "must"], ["drain-idle:*", "must"]],
@@ -126,2 +126,2 @@
-      "adds": "Second alternate 'GraphGoblin QA ü-<r8>-b.app' installed from the canonical script path with --data-dir given as the 'data alias ü' symlink; alias saved as the canonical store; distinct ID, bundle ID and log directory; A, A and B cold-launched concurrently against the same store and port: all three open-management-running and exactly one gateway at every 200 ms poll.",
-      "checks": [["alias-resolves-to-store", "must"], ["installer-exit-zero", "must"], ["b:* installed identity", "must/want as S1"], ["alias-saved-as-canonical-store", "must"], ["store-spelling-bytes-identical", "want"], ["distinct-installation-identity", "must", "doc"], ["identical-saved-configuration", "want"], ["preconditions", "must"], ["envelope-0..2", "must"], ["poller-healthy", "must"], ["never-more-than-one-gateway", "must", "doc"], ["concurrent:* witness", "must"], ["observed-gateway-is-owner", "must"], ["no-helper-or-launcher-left", "want"], ["headless-opened-no-browser", "want"], ["drain-concurrent:*", "must"]],
+      "adds": "Second alternate 'GraphGoblin QA ü-<r8>-b.app' installed from the canonical script path with --data-dir given as the 'data alias ü' symlink; alias saved as the canonical store; distinct ID, bundle ID and log directory; the saved configuration equals A's by exact parsed equality independent of member order (18089 saves launcher.json without key sorting, so the two files' bytes and SHA-256 may differ), while closed keys, canonical values, byte-identical store spelling and each receipt's binding to its own configuration bytes stay separate checks; A, A and B cold-launched concurrently against the same store and port: all three open-management-running and exactly one gateway at every 200 ms poll.",
+      "checks": [["alias-resolves-to-store", "must"], ["installer-exit-zero", "must"], ["b:* installed identity", "must/want as S1"], ["alias-saved-as-canonical-store", "must"], ["store-spelling-bytes-identical", "want"], ["distinct-installation-identity", "must", "doc"], ["identical-saved-configuration", "want", "source-interface (node:util isDeepStrictEqual of the two parsed objects: same members, types and values in any order; no normalization; extra or missing members fail)"], ["preconditions", "must"], ["envelope-0..2", "must"], ["poller-healthy", "must"], ["never-more-than-one-gateway", "must", "doc"], ["concurrent:* witness", "must"], ["observed-gateway-is-owner", "must"], ["no-helper-or-launcher-left", "want"], ["headless-opened-no-browser", "want"], ["drain-concurrent:*", "must"]],
@@ -176 +176,4 @@
-    "Accessibility is not trusted and screen capture is unknown (preflight-02); no other UI controller is assumed."
+    "Accessibility is not trusted and screen capture is unknown (preflight-02); no other UI controller is assumed.",
+    "Preparation 04: POST /loops creates a draft-only loop, so a start without versionId answers 404 LOOP_NOT_FOUND (QA05); the start names the created draft with allowDraft, and the run answers with a new snapshot versionId, never the draft ID.",
+    "Preparation 04: the accepted POST /system/shutdown 202 is its own snapshot; S4 reads unconfirmedRunIds from it, not from the pre-drain GET.",
+    "Preparation 04: launcher.json member order is not a contract (18089 removed locale-sensitive key sorting); QA05 recorded three key orders and three SHA-256 values for value-identical configurations, so S5 compares parsed objects across installs."
```

## Controls actually run

All ran on Windows with the project Node v22.23.4 (`$HOME/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64`). Everything was provider-free and bounded, with no owner service, SSH, remote host, installer, GUI or network beyond 127.0.0.1.

**Run count.** The offline controls, the mutation sanity pass and the portless test each ran twice:
- first an unrecorded pass to the shell;
- then the recorded run, against the final driver bytes `bafe9533…`.

Every run passed.

1. **Syntax.** `node --check` on `gg456-native-qa.mjs`, `offline-oracle-controls.mjs` and `mutation-sanity.mjs`: OK.
2. **File checks.**
   - `JSON.parse` of `case-map.json` and `binding.template.json`: OK, and the template still has `final: false`.
   - CR count across all authored files: 0.
   - `cmp` of the template against preparation 03: identical.

### 3. Offline oracle controls (controlled seam)

```sh
node offline-oracle-controls.mjs ../macos-independent-qa-execution-preparation-03/gg456-native-qa.mjs gg456-native-qa.mjs \
  ../macos-independent-qa-transport-correction-05/receipt-c8bc55cacb944f7985574643b8fc2346/evidence > offline-oracle-controls.result.json
```

Exit 0, **49/49**, `pass: true`.

**What it executes.** It extracts and runs the exact declaration bytes of both drivers:
- the whole `stageWaitRunDrain` and `drainVerified`;
- `api`, `http`, `health`, `pollRun`, `stage`, `must` and `want`;
- `checkInstalled`;
- `stageSecondInstallConcurrent`;
- the new helpers.

**The fake API.** A loopback fake on a random 49152–65535 port, labelled controlled. It models the documented contracts:
- an omitted `versionId` gives 404 `LOOP_NOT_FOUND`;
- a draft without `allowDraft` gives 409;
- the pre-drain GET and the drain POST are separate snapshots, and each incarnation issues a fresh token.

**Stubs.** Only the native probes are stubs: witness, process row, leases, store helper, port state, children, headless relaunch, installer, bundle readback and links.

**S5 stop.** S5 stops deliberately at its next precondition (`precondition-port-refused`), after the configuration assertions.

| Group | Cases | Result |
| --- | --- | --- |
| Reproduce on driver 03 | **R1** sends `{"allowDraft":true}` and stops at `run-admitted`, 404 `LOOP_NOT_FOUND`, as in QA05. **R2** (lenient start, reproduction only) meets the check although the POST flags the run. **R3** meets it with the POST array missing. **R4** reports reordered, value-identical B configs unmet. | all as expected |
| Explicit draft (driver 04) | **A1** sends exactly `{"versionId":"<draft>","allowDraft":true}` to `/loops/<loop>/runs`, and all 28 S4 checks are met. **A1b**: pin `versionId` is the snapshot ≠ draft, source `draft`, version 1, with `ctx.data.draftVersionId` and `runVersionId` recorded. **A1c**: the same projection after the controlled restart. **A1d**: no issued control token appears in the stage record or `ctx.data`, and both drains sent the matching token. | met |
| Refusals before any start request | **A2** missing draft, **A3** foreign `draft.loopId`, **A4** non-ULID draft ID, **A5** `loop.draftVersionId` mismatch, **A6** absent, **A7** status not `draft`, **A8** draft ID = loop ID. Each stops at `draft-bound-to-loop` with 0 start requests. | met |
| Snapshot identity | **P1** `versionId` = draft, **P2** = run ID, **P3** source `published`, **P4** foreign loop: each stops at `run-pins-new-draft-snapshot`. **P5** different `versionId` after restart and **P6** different source after restart: each stops at `run-pin-retained-across-restart`. | met |
| Drain source | **D1** POST `[]` is met. Unmet, with the rest of the stage met: **D2** missing, **D3** string, **D4** object, **D5** null, **D6** `[timerRun]`, **D10** non-ULID entry. **D7**: GET `[]` with POST `[run]` is unmet. **D8**: GET `[run]` with POST `[]` is met, so the POST is the source. **D9**: POST `[otherRun]` is met. **D11**: the allowlist drops `controlToken`, `error` and other members. **D12**: more than 256 entries are not retained. | met |
| Helpers directly | **H1** `draftStart`: exact body; 7 malformed variants refuse with no body. **H2** `draftRunPin`: accepted, and 6 bad variants rejected. | met |
| Configuration | **C0**: the reconstruction shown above, 3 orders and 3 hashes, each bound to its own receipt. **C1** `sameConfiguration`: all 3 QA05 pairs are equal both ways; all 12 changed variants are unequal both ways: port, port as a string, checkout, node, NFC and case-changed data path, `requireAPIKey`, `ollamaEnabled`, version, extra member, extra null member, missing member. `null`/`null` and `[]`/`[]` are unequal. **B1** (×3): the unchanged `checkInstalled` meets every check on each actual QA05 record, with expected values from the QA05 admission and binding. **B2**: a record carrying another install's configuration hash stops at `receipt-binding`. | met |
| S5 stage (driver 04) | **S1** B in A's original order against the final A (case-update order), and **S2** NFD order: `identical-saved-configuration`, `receipt-binding` and `config-closed-keys` are met. **S3** option change: unmet, and `config-options` unmet. **S4** extra member: unmet, and `config-closed-keys` unmet. **S5** the store under its NFC spelling: unmet, and `store-spelling-bytes-identical` unmet, while `config-values` and `alias-saved-as-canonical-store` are met. Stops at the hard check: **S6** port change and **S7** checkout change at `b:config-values`; **S8** a receipt bound to other bytes at `b:receipt-binding`. | met |

### 4. Mutation sanity (controlled)

```sh
node mutation-sanity.mjs ../macos-independent-qa-execution-preparation-03/gg456-native-qa.mjs gg456-native-qa.mjs \
  ../macos-independent-qa-transport-correction-05/receipt-c8bc55cacb944f7985574643b8fc2346/evidence > mutation-sanity.result.json
```

Exit 0, `pass: true`.

**Method.** Each mutant is a scratch copy of driver 04 in a fresh OS temp directory, with one exact line changed. The temp directory was removed afterwards. The source guard stayed `restIdentical: true` for every mutant, so detection comes from the cases, not the guard.

| Mutant | Detected by |
| --- | --- |
| M1: the want reads the GET with `?? []` | D2–D8, D10 |
| M2: start body `{ allowDraft: true }` | A1, A1b, A1d, P1–P6, D1–D10 |
| M3: snapshot may equal the draft | P1, H2 |
| M4: `draft.loopId` binding dropped | A3 |
| M5: missing or null array coerced to `[]` | D2, D5 |
| M6: `controlToken` kept | A1d, D1–D11 |
| M7: order-sensitive config compare | S1, S2 |
| M8: config values NFC-normalized | C1, S5 |

### 5. Portless API-contract check (authorized; repository composition, not native)

```sh
pnpm.cmd --dir <worktree>/apps/api exec vitest run --config <packet>/portless/vitest.config.mjs --reporter=verbose
```

The run used pnpm 12.8.1, Vitest 5.0.3 and Node v22.23.4. Result: 1 test passed, exit 0 (`portless/vitest-run.log`).

**Setup.**
- The test imports the worktree's `apps/api/src/testing/test-app.ts` (`createTestApp`: real routes, RunManager and SQLite repositories, in-memory store, fake harnesses, timers not started, `app.inject`, no port).
- It evaluates driver 04's exact `ULID`, `WAIT_SECONDS`, `waitLoop`, `ulidOrNull`, `draftStart`, `draftRunPin` and `acceptedDrainFields` bytes.
- The config and test are external. Vite's cache went to OS temp and was removed.

Observed (`portless/draft-start.portless.observations.json`):

| Step | Observed |
| --- | --- |
| Create the exact fixture (`QA wait 7c5ae3c2`, 45 s) | 201, `issues: []`, no `currentVersionId`, `loop.draftVersionId = draft.id`, `draft.loopId = loop.id`, status `draft`, version 1, `draftStart.ok` |
| Driver 03 request `{allowDraft:true}` | 404 `LOOP_NOT_FOUND`, "loop <loop> has no published version" |
| `{versionId: draft}` without `allowDraft` | 409 `VERSION_NOT_PUBLISHED` |
| Driver 04 `start.body` | 202 `{run}` (only key `run`), status `queued`, `draftRunPin.ok`, `versionId ≠ draft`, pinned `draft` v1, "QA wait 7c5ae3c2 draft v1" |
| Snapshot | `GET /loops/{id}/versions/{run.versionId}` 200, status `snapshot`, definition deep-equal to the draft. The loop's draft is unchanged and there is no `current`. The snapshot is not in the version history. Starting it directly gives 409 `VERSION_NOT_PUBLISHED`. |
| Flat run after idle | `GET /runs/{id}` 200, flat (no `run` wrapper), status `waiting`, `waiting.kind` `timer` with `until`, `recovery` present, the same pin projection |
| List | `GET /loops`: the driver's `loop-retained` predicate is true, `runCount` 1, `latestRun` is this run |
| Drain | The GET reads phase `running`, with an array. The POST with the token returns 202, with keys `activeRunIds`, `choiceAt`, `choices`, `controlToken`, `graceMs`, `phase`, `startedAt`, `unconfirmedRunIds`. `acceptedDrainFields` gives `unconfirmedRunIds: []` (excludes the run) and no token. |

### 6. Integrity after the work

- **QA05 receipt.** A sorted SHA-256 manifest of all 109 files was taken before the work and again afterwards. The two are byte-identical; the before-manifest digest is `aaa91bff…a6e7`.
- **Preparation 03.** All 7 file hashes are unchanged.
- **Contract note.** The hash is unchanged.
- **Assessment 05.** No file is newer than the before-snapshot.
- **Repository.** No repository, Git, GitHub, configuration or credential action was taken by me. `git status` is clean, and `git diff --quiet 18089bba -- apps packages tooling scripts` holds.

## Concurrent repository change (not mine)

During this task, root committed `635a637c4be4f8d63647c01996cdb80e3c262323` at 16:35:31 −06:00, the parent being `18089bba`.

I verified it independently. It changes only:
- `.gitattributes`, `.gitignore` and `.prettierignore`;
- `docs/delivery/2026-11-13-four-intents-register.md`;
- `docs/qa/**`, now sparse-excluded.

It changes zero files under `apps/`, `packages/`, `tooling/` or `scripts/`.

Root also placed `ROOT-COORDINATION-NOTE.md` in this directory: 1,018 bytes, SHA-256 `8599e98faab4654b6af37614c8f593e6aa7e357142835729d83fe55b4c2475d2`. It is root-authored and is not part of my output. Its account matches my verification.

The source I read and the source the portless test imported equal candidate `18089bba` for every product path used.

## Hashes (SHA-256, bytes)

| File | Preparation 03 (source) | Preparation 04 (output) | Bytes (04) |
| --- | --- | --- | --- |
| `gg456-native-qa.mjs` | `9be9a517754877ab3f68b72e74f476d0ced04f34216e10e12d48e7685927736f` | `bafe95338dc22402a29b5805f0f0ec4862d8d3c6155220f03ca005946be4729e` | 107620 |
| `README.md` | `3dbdb322766970dd7cf6557dc67c4ce3b65a5dea407e3c54c0178201fa3ae275` | `907cc5f91315ce1c3ffab8520986181b8fd580f7325df30548a472d02f991351` | 21519 |
| `case-map.json` | `19dfeed37e6cb83505cca69932b833332e6e0465a681c67ff8a94011e210c267` | `68f504f2677b78bb8f8e7e594845959f98905c119a33f20a96c8a13b36d1d8e3` | 35925 |
| `binding.template.json` | `b16f698af2780b7fa148fa566f041ae4a3d8fe16ebaa59665cad2a514f92b17a` | unchanged | 2362 |
| `offline-oracle-controls.mjs` | — | `a9ecfecc2cf1066389b262bed58f914c2c1dcc01baee5da8f0366e1e994b1c77` | 39385 |
| `offline-oracle-controls.result.json` | — | `9da27bb281197491223618761f97c78bbd6e306d1d8f43da830560d20df0c170` | 51716 |
| `mutation-sanity.mjs` | — | `d653d82dd07622fba33cecdb6b35b3c287c7a814f6056ffb2e73e93a673f7d12` | 5899 |
| `mutation-sanity.result.json` | — | `87ab76025e0e2292014e87d6cebfc53eaf0582aa71342ef666338e00ddd63236` | 4930 |
| `portless/vitest.config.mjs` | — | `e54b45eac80d19b6c8df0199b0bf240dfc5ae9b8097bf1cbfb12ac2423f0d533` | 879 |
| `portless/draft-start.portless.test.mjs` | — | `9dc0a87d51b492db52c2e4ef2df3806247e38e6d92cbb7fa7b8679d46832ccb4` | 9563 |
| `portless/draft-start.portless.observations.json` | — | `3e6b0322dd8e14fc59b9297cd32644a01141cbe5c5a03fb566c087ef62845df5` | 2547 |
| `portless/vitest-run.log` | — | `d2c28a9af0e47028bcf2edd36f6fb50bfa149f8fb5108b924eeca29bd5517d35` | 867 |

Notes:
- The QA05 records the controls read are `installed-a.json` `86adf8cc…6e07`, `installed-a-nfd.json` `101bfb11…597d` and `installed-a-case.json` `04d3ce98…425e`.
- Preparation 03's `correction-handoff.md` and asset-regression files were not copied. Their code paths are byte-identical in driver 04, so the 10 asset controls were not rerun.
- This handoff is not self-hashed; root hashes it on intake.

## Evidence limits

- **Controlled seams.** The offline controls and mutants are not native.
  - The fake API models the documented contracts. The native probes are stubs.
  - The S5 "B" record is derived from QA05 A records, because no B exists in QA05.
  - The functions under test are driver 04's exact bytes, evaluated by extraction, not through a full driver run.
- **Portless check: route contracts only.** Its setup was an in-memory store, fake harnesses, timers not started, `app.inject`, and the test container's own shutdown controller. It did not exercise:
  - a real process exit and release;
  - persistence across a real restart;
  - timer resumption;
  - native Node 22.22.2 on macOS.

  So `run-pin-retained-across-restart` and `run-completed-after-restart` are verified only by the controlled seam until the native run.
- **ID validity.** `acceptedDrainFields` treats a non-ULID entry or more than 256 entries as an invalid list, so the soft check is unmet. This is deliberate: run IDs are ULIDs by contract.
- **Scope of review.** I did not re-review S5–S9 beyond the S5 line changed here. No other definite defect blocking these corrections was found in the paths read.
- **Assessment 05 limitations not addressed (out of scope):**
  - the independent fingerprint borrows the saved data directory;
  - the per-install executables are not the pinned build artifact;
  - NFC shell-user spelling is untested.
- **Still open, unchanged by this work:**
  - the Swift coverage-policy decision;
  - final CI;
  - actual GUI;
  - the fresh Astra MAX audit.

  Formal scans 2/3 are unchanged.

## Native status

Unexecuted, and this is not a native QA pass. Root independently reviews this driver, binds it to a fresh fixture, and executes it once. That binding covers:
- the candidate, build05, Node, files and `launcherSourceDigest`;
- `driverSha256` `bafe9533…`, in a separate root-owned binding with `final: true`;
- a fresh run ID, ports and transport.

Fixture `7c5ae3c2` is not reusable: its scope exists, it has no manifest, and its store holds the unretained draft loop "QA wait 7c5ae3c2".
