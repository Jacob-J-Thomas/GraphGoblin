# #448 D194 corrective review: **ACCEPT FIX**

Both scan3 findings are corrected in `apps/api/src/preflight-catalog.test.ts`, and I found no introduced defect that requires a change. This is a read-only review: I ran nothing and recomputed no hashes. Scan3's CHANGES_REQUIRED stands as issued; #448 stays open for owner-only closure.

## F1 — Ollama isolation: corrected

- **Fix:** `GG_OLLAMA_ENABLED: 'false'` at line 45 reaches `createOllamaServices` as `defaults.enabled = false` (`config.ts:36`, `container.ts:284`).
- **Why it holds:** on these fixtures `SqliteOllamaRepository.read` inserts the gateway row from those defaults (`sqlite/ollama.ts:20-33`). Migration 0027 only creates the table, so no saved row overrides the flag. `start()` then returns before `schedule()` or `refresh()` (`services.ts:152`), so `discoverOllama` is never reached.
- **Starts retained:** both `container.start()` call sites (lines 160 and 292, four parameterised starts) and their catalog assertions are unchanged.
- **Evidence:** the command 08 observer log has no `blocked-fetch` or `blocked-socket` event. The hooks were live in the fork worker: pid 41992 logged installation and all 125 storage events from the same preload.

## F2 — storage predicate: corrected, matches D186

`expectStoreUnchanged` (lines 88-103) differs from the old strict equality only in allowing an absent WAL to become empty. I traced every transition:

| Before | After | Result |
| --- | --- | --- |
| DB present | identical bytes | pass |
| DB present | changed or missing | reject |
| DB missing | anything | reject (assertion or `TypeError`) |
| WAL present, including empty | identical bytes | pass |
| WAL present | changed, truncated or removed | reject |
| WAL absent | absent or zero bytes | pass |
| WAL absent | non-empty | reject |

- **New fixtures (306-341):** the DB is copied to a path no SQLite client has opened, and only read-only clients touch it afterwards. The initial absent or empty WAL is asserted before the first reader (319-324).
- **Copy is complete:** the copied DB's recorded hash equals that of a directly built fixture with the same rows (`c749672c…`), so the copy is a full checkpointed image.
- **Author's log matches:** case `2U5A69` starts with no WAL, then has a zero-byte one. Case `1QdQjx` stays zero-byte throughout. The frozen control keeps its 8,272-byte WAL at the same hash.
- **Negative controls (377-433):** I traced each `.toThrow()` to the intended WAL or DB assertion. DB equality is pinned beforehand by line 395 or 408, so no control is satisfied by an unrelated throw.
- **Counterfactual:** command 03 fails only on `{…(2)}` versus `{…(1)}`, with the DB hash unchanged and a zero-byte WAL.
- **Nothing dropped:** the patch deletes five lines, the import and the four strict equalities. Every other original assertion and both parameter tables are present.
- **Retained observations agree:** P01 (absent to empty), P03 (16,512-byte WAL unchanged) and P18 (existing empty WAL unchanged).

## Non-blocking notes

1. **Line 408 deep comparison (introduced, low).** `expect(frames['gateway.db']).toEqual(absent['gateway.db'])` still deep-compares two 479,232-byte buffers. That is about 2.1 s of the 2.384 s negative case, inferred from the log gap. The original file ran one or two such comparisons in every test, so the risk is lower than before; `.equals` would remove it.
2. **Writer-finalizer race in the ten retained cases (not introduced).** They still snapshot `before` straight after `fixture(dbFile)` (lines 143, 260), and the log shows a zero-byte WAL held by the unclosed native writer each time. A garbage-collection-driven close before the `after` snapshot could delete it, or raise `ENOENT` inside `storeBytes` (74-86). That fails closed, exactly as under the old equality, and cannot produce a false pass.
3. **No file-level F1 counterfactual.** Zero attempts rests on the source path, the live worker hooks and the separate selfcheck. Neither counterfactual removed the flag, and the worker wrote no exit summary. The Opus QA could run the pre-fix file under the observer.
4. **Receipt label.** `runtimeDiffEmpty: false` reflects the test file being listed under `allowedRuntimeFiles`. Freeze command 14 lists only that file across `apps`, `packages`, `tooling` and the lockfile.

## Scope and limits

- **Not opened:** the typecheck, lint, format and diff-check receipts (05-07, 09-12), `evidence-summary.json`, the 98-artifact seal and the blobs. Those passes are the author's claims.
- **Hashes and tree:** I read the branch ref file, which holds `446da9ce…`. Verification of the hashes and tree is root's.
- **Counterfactual file:** checked by search (helper body and flag present), not by full diff.
- **Evidence script 13 → 14:** I saw the changed line 50, not a full diff of the two versions.
- **SQLite close behaviour:** that a read-only last close leaves the WAL while a writer's close removes it is my knowledge of SQLite, consistent with P18 and the log; I did not verify it in this libsql build.
- **Still open:** non-Windows behaviour, hosted CI and canonical native verification for this head, and the separate Opus behaviour QA.