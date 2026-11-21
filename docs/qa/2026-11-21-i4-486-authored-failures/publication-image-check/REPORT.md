# #486 publication image and credential-context check

**No visible credential or unrelated private-content finding in any of the 12 selected screenshot files (11 unique SHA-256 values).** Every exact file was opened with `view_image`, including the duplicate alias. This is a static publication check, not additional product QA, a general review cycle or authorization to publish.

The two plaintext credentials identified in selected text records are independently supported as **generated disposable local QA API admin keys**. They are **NOT REVOKED**: both retained task database rows have `revoked_at = NULL` and scopes `["*"]`. Stopping/retiring their stores does not invalidate the credentials. If those exact stores are served again, the keys retain wildcard local API capability. Root's stated D208 disposition explicitly retires both stores from future serving with the disclosed keys; future reproductions use new stores/keys. This report supports that accurately qualified intentional disclosure, not a claim of revoked or intrinsically harmless credentials.

## Exact selection and pixels

The canonical selection payload hash independently recomputed to **`0f9a207cb45465574c81e556feb8d5dc53d3f3b6c08e50466a5bed72482b2ac9`**. All 12 selected image lengths/hashes match both the credential-context inventory and physical selection entries. The selection-plan file's byte SHA is separately `894cad7b2bf8a69598bf88fb515e0ad29401d4e427352885c994243900e5fff0`; the canonical payload hash is intentionally a different hash construction. Credential-review input byte SHA: `32ba3bb4daa52cb7515e97049ece6d4652fbe334def8b2d85cc5d653fcaa3e82`.

Complete source/archive paths, exact lengths, SHA-256, dimensions and individual observations are recorded in [image-inventory.json](./image-inventory.json). All images are1400×1000.

| Selected image | Visible content assessed |
| --- | --- |
| Opus `ext.png` | Safe internal failure and task-generated QA run/version/loop identifiers. |
| Opus `followed-leaf.png`, `leaf2.png` | Same exact bytes, both separately opened; heartbeat failure and synthetic parent/child identifiers. |
| Opus `inf.png` | Fixed inference output failure and synthetic QA identifiers. |
| Opus `leaf.png` | Fixed heartbeat failure and synthetic QA identifiers. |
| Opus `map.png` | Fixed subloop mapping failure and synthetic QA identifiers. |
| Opus `mid.png`, `top.png` | Nested failure copy and task-generated parent/child links and identifiers. |
| Opus `p01.png` | Intentionally visible `QA486-LIT-D6P01` test canary. Original d6 driver line67 explicitly authors it; it is not an account/provider credential. |
| Supplemental `after.png` | Fixed authored-output failure and synthetic QA identifiers. |
| Supplemental `b17.png` | Safe canonical internal failure; no visible private cause/stack marker. |
| Supplemental `ws-empty.png` | Fixed empty-workspace failure and synthetic QA identifiers. |

No visible API key, bearer token, account login, provider credential, personal email, browser account/profile UI, unrelated application/window or unrelated private content was observed. Visible fixture IDs, loop labels, product copy and the deliberate P01 canary are QA content. No screenshot edit, redaction, browser session or new screenshot capture was performed.

## Text credential provenance and remaining capability

All **11 selected occurrences** matched the exact token hash at the recorded **UTF-8 byte offset**, preserving original bytes/CRLF. No token value is printed or copied into this packet. Only the existing hashes identify the groups:

| Attempt | SHA-256 of credential | Occurrences | Direct read-only task-store observation |
| --- | --- | --- | --- |
| 1 | `9ae28d8a718e979270437340caec9593583434768b665e6d8671fb5af4f028c0` | 4 | Exactly one matching key row; owner `local`, label `D205 disposable admin`, wildcard scopes, `revoked_at = NULL`. |
| 2 | `8ae55f437e84336228dfc449d062573feacc0ff45e49fe773d1ccb5005a58976` | 7 | Exactly one matching key row with the same local QA label/scope and `revoked_at = NULL`. |

The source/provenance was re-read rather than accepted from the selection's classification:

- [run.py](<G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-supplemental-independent-01/run.py:5>) creates a fresh per-attempt task workspace and removes inherited `GG_*`/`JEV_*` configuration.
- [api-helper.mjs](<G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-supplemental-independent-01/drivers/api-helper.mjs:10>) sets task `GG_DATA_DIR`, loopback host, required API auth and disabled Ollama; creates `D205 disposable admin` with `['*']`; injects fake Codex/Claude harnesses. The driver derives the store from `QA_WORK/data` and reuses the same task key only across its controlled reopen.
- [create-api-key.ts](<G:/ggq/gg-i4-486-d204-qa/GraphGoblin/apps/api/src/create-api-key.ts:79>) creates in that configured local database. [settings.ts](<G:/ggq/gg-i4-486-d204-qa/GraphGoblin/packages/infrastructure/src/sqlite/settings.ts:265>) hashes tokens with SHA-256, generates fresh random24-byte tokens and authenticates matching rows unless revoked. There is no expiry condition in the inspected authentication method.
- Both task stores were opened **read-only with immutable mode** solely to inspect matching hash/label/scope/revocation metadata. Their byte hashes still match the sealed scratch inventory and remained unchanged. No authentication request, owner-store read, key use, revocation or store mutation was performed.

These observations support local QA origin, not provider/account credential origin. They also establish the residual wildcard capability explicitly. The QA shutdown/cleanup records support prior stopped-process observations; this static check does not reassert current service absence through a new live probe. Root's no-future-serving/new-store-and-key disposition is therefore a material publication condition, not a property inferred from the token format or a false invalidation claim.

Exact source hashes, occurrence paths/byte offsets and database hash checks are in [credential-provenance.json](./credential-provenance.json) and [input-inventory.json](./input-inventory.json).

## Limits and release

The image conclusion covers the **visible pixels of these12 exact files**, not hidden metadata, steganography or content outside their captured viewport. No OCR or exhaustive archive secret audit is claimed. This check verifies the11 selected credential occurrences and their source/store provenance; it does not repeat the parent selection task's1517-file/six-pattern scan or clear every unselected record. Absolute local paths and fixture/session identifiers elsewhere in exact raw evidence remain the root's separately disclosed publication context.

Original QA, selection packets, repositories, providers and browser state were not altered. Only this new report packet was written. No live app, revocation, product test, new agent/provider or additional general review was run. Final exact-byte publication admission remains root-owned and must retain the explicit still-unrevoked/retired-store condition.
