# #456 macOS QA harness: execution preparation 03 correction handoff

Author: Claude Code `claude-opus-5-5` (xhigh), the independent behavior QA worker, on 2026-11-16. This is QA-harness implementation, prepared and locally checked. It is not a review, not a formal scan, not a native run and not a QA pass. **The native status is unexecuted.** QA03 (receipt `../receipt-643542c98b7b489f856a0a90acf11d81/`) remains **incomplete**.

- **Source (immutable, not edited):** `../macos-independent-qa-execution-preparation-02/`
- **Output:** this directory.
- **Binding:** `binding.template.json` is byte-identical to preparation 02, with `final: false`, `boundBy: null` and `driverSha256: null`. No root admission, binding or execution was created.

## Cause established before editing

1. **Where it stopped.** The last recorded S2 check is `no-canary-in-store-names` (`../receipt-643542c98b7b489f856a0a90acf11d81/evidence/stage-S2-cold-env-canary-launch.json`). In driver 02 the next statement is `const served = await shells(ctx, P);` (line 1005). The recorded failure is `driver.mjs:236:38`, which is the `res.destroy(new Error('response exceeded the QA cap'))` branch of `http()`. `shells()` calls `http(port, route)` for each shell and `http(port, asset)` for its first referenced asset. Both use the default `CAP.http` of 2,097,152 bytes (line 36).
2. **Which fetch.** `shells()` selects the first `src`/`href` under `<route>assets/` ending in `.css` or `.js`. In the bound `/app/` shell that is `/app/assets/index-C5U89dQm.js`. Supporting evidence:
   - The build04 log `../macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/pnpm-build-stdout.raw` reports these sizes:
     - `/app/` shell 2.40 kB, JS 2,132.12 kB, CSS 93.16 kB;
     - `/goblin/` shell 2.16 kB, JS 446.18 kB, CSS 77.78 kB.

     Only the `/app/` JS exceeds 2 MiB, under either kB convention.
   - A pre-existing local build in the candidate worktree, read-only, matches build04:
     - `apps/web/dist/index.html` hashes to `c606991f…2fef` and `apps/web/dist-goblin/index.html` to `f74c415b…10af`. Both equal the binding's `files` hashes.
     - `index-C5U89dQm.js` hashes to `a01db82b…cc63`. That equals the `/app/` `assetHash` that engineering acceptance 03 recorded on the Mac for the same build04 checkout (`../macos-owner-acceptance-execution-03/receipts/acceptance-c0f8b7c1ff7548fbb19e8e8475ff6c07/cases/manifest.json`, `shells`).
     - Its exact size is **2,132,126 bytes**, which is 34,974 bytes over the cap.
   - Acceptance 03 uses the same selection expression with a 16 MiB default (`tooling/scripts/macos-launcher.acceptance.mjs:28,252-276`). About three minutes before QA03's S2, at 21:35:08Z, it fetched that asset from the same checkout with HTTP 200 (`cases/final-gateway.log`, `req-c`).
3. **Conclusion.** This is a harness response-bound defect, not a product finding.
   - **Limit:** QA03 retains no per-request record. The stack has no URL and the instance `gateway.log` was not copied back. The overflowing URL is therefore inferred from sizes and the selection rule, not observed.
   - No other fetch in `shells()` can exceed 2 MiB unless the gateway served bytes different from the build. Acceptance 03 saw byte-exact service of both shells and both assets on the same build.

## Delta (driver)

```diff
--- prep02/gg456-native-qa.mjs
+++ prep03/gg456-native-qa.mjs
@@ -7 +7 @@
-// Preparation 02: copy of preparation 01 with the harness corrections listed in correction-handoff.md.
+// Preparation 03: copy of preparation 02 with the built-asset response bound listed in correction-handoff.md.
@@ -36 +36 @@
-const CAP = { stream: 64 * 1024, probe: 4 * 1024 * 1024, http: 2 * 1024 * 1024, excerpt: 256 * 1024, evidence: 96 * 1024 * 1024 };
+const CAP = { stream: 64 * 1024, probe: 4 * 1024 * 1024, http: 2 * 1024 * 1024, asset: 4 * 1024 * 1024, excerpt: 256 * 1024, evidence: 96 * 1024 * 1024 };
@@ -513 +513,3 @@
-      const servedAsset = await http(port, asset);
+      // The served asset is capped at its exact built length, which must itself stay within the fixed CAP.asset.
+      if (builtAsset.length > CAP.asset) throw new Stop(`built asset ${asset} has ${builtAsset.length} bytes, above the ${CAP.asset}-byte QA asset bound`);
+      const servedAsset = await http(port, asset, { cap: builtAsset.length });
```

SHA-256 of this `diff -U0` output: `ac576bca02340e6dad5a6baca335a3ed7f3d8d27195e86d5928141be3f5159c4`.

**Semantics**
- The served asset may be at most its exact built byte length. One extra byte rejects through the existing `http()` cap error, which stops the stage as before.
- A built asset above the fixed 4 MiB `CAP.asset` stops S2 with a named `Stop` before any fetch. 4 MiB is about 1.97 times the current largest built asset.
- The existing assertion is unchanged: `servedAsset.status === 200 && sha256(served) === sha256(built)`. A mismatching, short or non-200 asset therefore still yields `assetMatch: false`, which leaves the soft `both-shells-served` check unmet.

**Unchanged, byte for byte**
- `http()` itself, `CAP.http` (2 MiB) for every API and shell response, and the 4 KiB `/healthz` cap.
- `BOUND` timeouts and the canary environment.
- Witness, ownership, lease, drain and release logic, and every check ID and level.
- The regression guard confirms every byte outside the three hunks is identical.

**Not changed, flagged for root**
- Any exception inside `shells()`, including the cap rejection, still stops the stage even though `both-shells-served` is a `want`. This is driver 02 behavior, preserved to avoid suppressing failures.

## Delta (supporting files)

`README.md` (preparation 02 `545aeb09…` to `3dbdb322…`) changes in four places:
- the title and status paragraph name preparation 03 and this correction;
- the file table names this handoff and the two regression files;
- §2 gains an "HTTP caps" bullet: 4 KiB health, 2 MiB API and shell, asset exact-length within 4 MiB;
- the §3 S2 row adds "both built HTML shells and their first referenced asset served with HTTP 200 and the exact built bytes".

`case-map.json` (`c7f27c37…` to `19dfeed3…`), exact `diff -U0` hunks:

```diff
@@ -7 +7 @@
-  "revision": "execution-preparation-02: copy of execution-preparation-01 with six harness corrections (correction-handoff.md)",
+  "revision": "execution-preparation-03: copy of execution-preparation-02 with one harness correction, the built-asset response bound (correction-handoff.md)",
@@ -19 +19 @@
-    "hashes": "preparation 02 output hashes are listed in correction-handoff.md; root re-verifies and binds driverSha256"
+    "hashes": "preparation 03 source and output hashes are listed in correction-handoff.md; root re-verifies and binds driverSha256"
@@ -108 +108 @@ S2 "adds": inserted after "independently computed fingerprint matches; " (rest of the line unchanged)
+both built HTML shells and the first JS or CSS asset each references are served with HTTP 200 and the exact built bytes (shells within the 2 MiB CAP.http; the asset response capped at its exact built length, which must itself be at most the fixed 4 MiB CAP.asset or the stage stops before the fetch); 
```

No check IDs, levels, stages, case IDs, CLI modes or exit codes changed.

## Offline regression

`offline-asset-bound-regression.mjs` uses Node 22 built-ins only. It extracts the exact declaration bytes of `Stop`, `sha256`, `FORBIDDEN_PORTS`, `BOUND`, `CAP`, `qaPort`, `http`, `headerValues` and `shells` from drivers 02 and 03, then runs them against an in-process `127.0.0.1` test server on a random port in 49152–65535. It covers synthetic sites and, when present and hash-matched, the actual build04 bytes.

It was run once, as `node offline-asset-bound-regression.mjs <prep02 driver> <prep03 driver> <worktree>/apps/web/dist <worktree>/apps/web/dist-goblin`, under Node v22.23.4 win32-x64. It exited 0. Output: `offline-asset-bound-regression.result.json`.

| Case | Expectation | Observed |
| --- | --- | --- |
| R1 driver 02, legitimate 2,132,126-byte asset | stops with `response exceeded the QA cap` (reproduces QA03) | as expected |
| R2 driver 03, same | both shells and both assets HTTP 200 and exact | as expected |
| R3 driver 02, actual build04 bytes (hash-matched, 2,132,126 B) | stops with the cap error | as expected |
| R4 driver 03, actual build04 bytes | all four 200 and exact | as expected |
| N1 same length, one byte flipped | `/app/` `assetMatch: false` | as expected |
| N2 one byte overlong | rejects with the cap error | as expected |
| N3 one byte short | `assetMatch: false` | as expected |
| N4 exact bytes with HTTP 404 | `assetMatch: false` | as expected |
| N5 built asset 4,194,305 B | named `Stop`, asset never requested | as expected |
| N6 `/app/` shell 2 MiB + 1 B | rejects with the cap error (`CAP.http` unchanged) | as expected |

The guard also passed:
- every byte outside the three driver hunks is identical;
- the `/healthz` cap 4096 and the shell fetch line are unchanged;
- `CAP.http` is 2,097,152 in both drivers, `CAP.asset` is absent in 02 and 4,194,304 in 03.

## Checks actually run

All local, with the project-scoped Node v22.23.4:
- `node --check` of `gg456-native-qa.mjs` and `offline-asset-bound-regression.mjs`: OK.
- `JSON.parse` of `case-map.json`, `binding.template.json` and the regression result: OK. The template has `final=false`.
- A byte-level CR count over all files here: 0, so line endings are LF.
- `cmp` of the preparation 02 and 03 `binding.template.json`: identical.
- Preparation 02 hashes re-read after the work: unchanged.
- QA03 receipt files: none modified after 15:40 local.

**Not run:**
- the driver itself, in any mode;
- SSH, the remote host or macOS;
- the product, a gateway, the installer, a build, tests or a browser;
- any Git, GitHub, configuration or credential action.

## Hashes (SHA-256, bytes)

| File | Preparation 02 (source) | Preparation 03 (output) | Bytes (03) |
| --- | --- | --- | --- |
| `gg456-native-qa.mjs` | `1e5e4b03403cac63b3ecbcb3a84cce15ebacf266929324a570e40cbe5f485148` | `9be9a517754877ab3f68b72e74f476d0ced04f34216e10e12d48e7685927736f` | 103121 |
| `README.md` | `545aeb099225d8f4692868463ca11d17d46f4510067fb9b6c3087144a3484720` | `3dbdb322766970dd7cf6557dc67c4ce3b65a5dea407e3c54c0178201fa3ae275` | 19292 |
| `case-map.json` | `c7f27c372cf9367a06df5728bf77b7f3aa5abfad97267e0da45f520928970fe7` | `19dfeed37e6cb83505cca69932b833332e6e0465a681c67ff8a94011e210c267` | 31945 |
| `binding.template.json` | `b16f698af2780b7fa148fa566f041ae4a3d8fe16ebaa59665cad2a514f92b17a` | unchanged | 2362 |
| `offline-asset-bound-regression.mjs` | — | `89d6706a027601f50a57820fe7ac7d62349a735a638a4d22dc19efdecfa8b5dd` | 11689 |
| `offline-asset-bound-regression.result.json` | — | `a3dea185a354dd1d1063b897a982ac98493bf390560fcd32fa05019845965240` | 7077 |

Preparation 02 `correction-handoff.md` (`43f92094…7c`) was not copied. This handoff is not self-hashed; root hashes it on intake.

## Evidence limits

- The regression runs on Windows with Node 22.23.4 and an in-process test server. On the Mac, the bound Node is 22.22.2 and the server is the product's own static server. The function bytes under test are exactly driver 03's, but they are evaluated by extraction, not through a full driver run.
- The overflowing URL in QA03 is inferred (see Cause). The fresh rerun will record `both-shells-served` details for both routes.
- `shells()` still reads the whole built asset with `readFile` before the bound check. The file comes from the bound checkout, whose `index.html` is hash-bound but whose assets are not individually hash-bound.
- A future build with an entry asset above 4 MiB will stop S2 by design. Root then decides whether to raise the fixed bound.

## Native status

Unexecuted. Before any rerun, root inspects this driver and binds the final candidate, build, Node, files, `launcherSourceDigest` and `driverSha256` (`9be9a517…`). Root then sets `final: true` in a separate root-owned binding, with a fresh run ID, fresh ports and a fresh transport. Fixture `91191432` is not reusable: its scope exists and it has no manifest.
