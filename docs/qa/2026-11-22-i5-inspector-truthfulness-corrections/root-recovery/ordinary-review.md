Both named items hold at H2 `2416fc36` on source review. Nothing was executed, no fourth scan was performed, and the third audit and the Opus support verdict stay CHANGES_REQUIRED at their own heads.

## Disposition 1 — D230 R3-1 owner Chat repair: CONFIRMED (bounded)

**Production** (`apps/web/src/app/useOwnerChatClient.ts:19-27`)
- **Captured at send:** each request reads the store generation when it is sent (`:21`), in the same synchronous turn in which the shared client reads the token (`chat/client.ts:71-76`).
- **Retired 401 ignored:** a 401 rejects only when the current key equals the key that client sent and the current generation equals the send generation (`:24`). Generation only ever increases (`api-key.ts:31-35, 50-55`), so a request left pending across same-key recovery, a replacement or a forget cannot match.
- **Caller still gets its error:** the response is returned untouched (`:26`), so the caller receives its `ChatApiError` 401 (`client.ts:87-101`).
- **Current 401 still rejects:** the client is memoized on key alone, so a request sent after recovery through the same client reads the new generation.
- **Scope kept:** the shared Chat client has no owner-state logic. The check lives only in the composition hook, and both owner pages take their client from it.

**Tests** (read, not run)
- **Hook, old defect:** the old-versus-current case on one client (`useOwnerChatClient.test.tsx:64-97`) and the two "accepted again" cases (`:112-151`) would fail against the old key-text comparison.
- **Hook, over-fix:** the reused-client case (`:98-111`) and the second halves of those cases would fail if generation were captured per client instead of per request.
- **Cross-route:** `RunInspectorPage.owner-chat.test.tsx` reproduces the audit's four-step witness through the real app, both credential wrappers and the key panel. After the retired Devices 401 it requires the recovered generation, no key form, the waiting badge, `at real-wait`, one recovery read, cursor 3 and the same route (`:103-124`).

**Docs:** `docs/09-frontend-and-pwa.md:99-106` and `CHANGELOG.md:24-29` now name both request paths and match the code. This answers Opus findings 1 and 2.

**One non-blocking gap:** no linked case isolates the key comparison from the generation comparison. By my reading, removing `current.key === key` would survive all eight cases, because the generation differs in each of them too. The key check matters only when a client still in use after a key change sends its old key under the new generation, for example a later page of `turns` (`client.ts:127-148`).

### GPT type adapter: ACCEPT
- **Exact scope:** the delta removes `, exact: true` from lines 66 and 68 and nothing else. The compiler-error columns (66,68) and (68,72) land on the removed `exact` tokens, and 2 × 13 bytes accounts for 6,440 → 6,414.
- **Preserved:** role, literal names, operations and every assertion are unchanged. There is no cast or suppression, so it follows the AGENTS typecheck rule.
- **Behaviour-neutral, with one dependency:** this holds only if a string `name` is matched by full equality. That rests on root's reading of the installed `role.js` and `matches.js`. It agrees with what I know of Testing Library DOM 10, but I did not read `node_modules`.
- **Root-reported:** the passing typecheck after the adapter.

## Disposition 2 — D232-S3 GPT test correction: ACCEPT, sensitivity qualified

**The delta** (`apps/web/src/api/ApiKeyPanel.test.tsx`)
- **Wait:** `settleQueryActivity` (`:47-55`) waits one macrotask inside `act`, then waits until no query is fetching. Both the unchanged-key negative (`:215-221`) and the real recovery positive (`:82-87`) use it.
- **Preserved:** counts and assertions are unchanged (`before` and one stream in the negative, `before + 1` and two streams in the positive). No timeout or retry is added, and the new import is type-only.

**Negative control:** the mutant removes only `!previous.rejected ||` (`ApiKeyPanel.tsx:37`), and the corrected test fails at the read-count line (`:220`, expected 1, got 2). The generation assertion on `:219` passed under the mutant, which confirms Opus's point that it does not exercise the guard.

**Positive control:** it passes with the same wait and is not weakened, since a longer wait makes "exactly one read" stricter. On its own it does not prove the wait is long enough, because the count on `:87` still follows the earlier `findByText` on `:84`. The mutant failure is what shows the wait catches a panel-initiated read.

**Limits on the sensitivity claim**
- **One mutant, one case:** the other five cases were unselected under the mutant.
- **Original test:** nothing shows how the earlier microtask version behaves under the mutant; it was never run against one.
- **Positive evidence:** it is the six-case run before mutation, and the "recovery log" is that same log.
- **Restoration:** shown by matching size and hash only (4,895 bytes, `eeb305c7…`). No behaviour rerun followed it.
- **Driver not all-green:** it failed its own index byte-hash check after restoration, and the writer is unattributed.
- **Environment:** the run synchronized the workspace and ran two esbuild postinstalls, and network absence is unproven.
- **Descriptor nit:** the behaviour classification cites the index qualification under `d232-mutation-01`, the proof under `d232-mutation-closed-01`. Size and SHA are identical.

## Limits of this review
- **Coverage:** read-only on 24 of the 29 paths, five of them partially. `event-store.ts` and `follow-run-attempts.ts` were not needed, and the three instruction files were taken from the inline blocks. Hashes were compared as supplied, not recomputed.
- **Other writers:** I did not read `ChatSurface` or any file outside the list, so I cannot rule out another `markRejected` caller. In the files read, the only production callers are `api-key.ts:93` and `useOwnerChatClient.ts:25`.
- **Review family:** as the brief describes this worker, this is a Claude-family confirmation of Claude-authored production. On its own it does not meet the cross-family rule in `docs/15-issue-workflow.md`; it is cross-family only for the two GPT test deltas.
- **Not granted:** whole-PR, UI or merge approval. Independent QA, coverage and static checks, current-source CI, native evidence and signed merge remain separate gates, and root owns architecture, semantic acceptance, cost and cleanup.