# D225 fixture-review helper mechanics

**Accepted for root admission consideration.** Both findings against preparation 01 are resolved in the sealed preparation 02. This review covers four runtime helper entrypoints and their metadata generator. It used public helper sources, the decision and selected ordering receipt, synthetic inputs, and mocked Git responses. Actual runtime admission, provider critique, semantic disposition and the feature review ledger remain with root. The feature ledger stands at one of three scans.

## Two findings and their closure

| Initial observation | Corrected behavior verified on preparation 02 |
| --- | --- |
| With clean mocked Git status, a stable LF-to-CRLF difference in any one of the three permitted files passed both the metadata source predicate and the runtime baseline. | The generator compares each on-disk file with its immutable commit blob and records the ordered relative path, byte count and SHA-256. Generated route and controller configurations share those bindings. The controller checks them before launching and checks final source equality before accepting output. All three stable initial differences and all three post-start differences were independently rejected. |
| A brief containing only the exact diff passed. The prior provider-facing handoff made the full before and after files optional. | The generator requires the full canonical BEFORE, AFTER and DELTA blocks exactly once apiece. Missing, changed or duplicated blocks failed independently. All three correctly delimited blocks passed. The v2 handoff requires all three. |

The retained v1 control result has SHA-256 `0ed0922c2babc2b7708d7af4fabd22e8fcc8a6ee32d9e85e932552eadce8779d`. Its differing files were synthetic. No claim of drift in root's actual review checkout follows from them. [V1 results](independent-controls-v1.json) · [V2 results](independent-controls-v2.json)

## Verified scope

- The role requires a fresh read-only Opus 5.5 session at xhigh for the GPT fixture delta from the single parent `0776` to unsigned candidate `58227ea02a00fcfe67775ddc8d337b3bab61406d`, tree `0585acf06f5f6a2ff7974ae1e8358b4ba09c4fb3`. The signed historical base is `3a6943a136594162665667a7a55e2b46520912eb`. The source checks bind the full parent list, checkout identity, historical ancestry and delta path, and compare the lockfile, index, empty dependency inventory and root node_modules absence across snapshots.
- Prelaunch controls give the provider the restricted checkout and the Read tool. Accepted output requires observed Read requests to stay within the three fixed e2e paths for the inspector fixture, Claude harness and fixture support. Rejected outside-path inputs are suppressed in the public outcome. This exact-path check happens after receipt. The controls do not establish a three-file OS-level preaccess ACL.
- The route binds D225, a maximum estimate of $0.50 and reserve of $0.75 within the existing $20 allowance and cutoff epoch 1795417200. The generator requires a closed preceding reservation and a fresh sole-owner handoff. The reviewed prior closure recorded $13.9551438 spent and $6.0448562 remaining. The fake controls exercised wrong authority, budget, reservation, spend, remaining balance and overlap flags. These are estimate and admission predicates. This packet neither observes actual billing nor dispatches a paid worker.
- The raw and decoded output filter section matches D221 exactly. Six synthetic public/marker checks covered stdout, stderr, escaped text and object keys. The restricted argv, empty MCP configuration, approved environment builder, single CLI spawn site, original cutoff and owned-process cleanup were examined in the public source. V2 preserves the v1 guard, runner and launcher file bytes, and retains the controller's output-inspection function. [Filter controls](filter-results.json) · [Scope controls](scope-controls.json) · [Changed functions](v2-delta-scope.json)
- V1 exercised 34 Python, 12 scope and six filter checks. V2 exercised 34 targeted independent checks with 220 mocked Git calls. All 88 physical v2 preparation members matched the sealed SHA-256 manifest and 179,020 payload bytes. The author reports 64 pure controls in that packet. [Preparation verification](preparation-v2.json)
- A successful worker envelope remains pending root's substantive fixture disposition. D225 cannot change the historical D224 ordering. This independent review did not access the product checkout, private configurations, credentials or raw provider streams, invoke the real metadata generator, execute Git, start a review worker, or evaluate the product change.

## Verified bytes

| Artifact | SHA-256 |
| --- | --- |
| Preparation 02 manifest | `1a971e6412b459fee883fd5a35af9c7c96e54421ff67c48fa4a8aab61c593817` |
| Preparation 02 seal | `6ae03d977f6f733eef3b12238d68bc73c7faeee77c2e8370481baad953b101fd` |
| Generator | `fe8a77e2d0aa8cc1bc055e5d7970069b259f43cce23c4a218c66a48131c4b670` |
| Controller | `07dba268814245c8ca4837a139dd1be61aa0b860e695903b85c8ef771d4c3b35` |
| Guard | `5a9fc2ef5e92ebf4316ab05226425b8ba9c748410ac313af11836c509a26dc99` |
| Runner | `e13531e791269d518652e68668e89147896b812c2fab437a955461e00792c92f` |
| Launcher | `e0831b561611ac645f76c7cdc66416a63654bd9f0013d7a1a76bc658f607912d` |

The generator's separately bound root acceptance receipt refers to the preparation manifest and the finalized independent manifest, with four runtime entry hashes from `runtime-derivation.json`. The generator hash is recorded separately above.
