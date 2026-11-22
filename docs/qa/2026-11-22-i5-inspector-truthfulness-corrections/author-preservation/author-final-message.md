I've made the D230 correction in all five admitted paths, but nothing has been run. I had no shell, so no tests, typecheck, lint, format check, browser or CI ran, and none of the new tests has been seen to pass. I did not commit or stage anything, and I couldn't confirm the starting head myself.

**Starting point:** expected head `2ac09bc116e1541eac5f93a4aaf47d6a36faa766`, tree `0c18ca86c42606016ea6b1528ccd10cd4d6e0591`, both from your brief and not checked by me. Before editing I read `docs/README.md`, `AGENTS.md`, `docs/15-issue-workflow.md`, and read-only context such as `api-key.ts`, `chat/client.ts` and the test fixtures.

**The fix, in `apps/web/src/app/useOwnerChatClient.ts`:**
- **Captured per request:** the owner fetch wrapper now reads the credential generation each time a request is sent, not when the memoized client is created.
- **When a 401 rejects:** it calls `markRejected()` only if the key this client sent is still the stored key and the generation is unchanged.
- **Responses:** every response, including an ignored 401, is returned to its caller unchanged, so callers still get their `ChatApiError(401)`.
- **Unchanged:** the shared Chat client, cancellation, retries, timeouts, polling, persistence, dependencies and the ESLint boundary.
- **Effect:** a Devices or Chat request left pending across a rejection plus same-key recovery, a key replacement, or forget-then-re-enter can no longer reject the newer state. A request sent after recovery still rejects on a 401, even through the same memoized client. If two pending requests both get 401, the first rejects and the second finds the key already rejected, the same end state as before.

**Tests added:**
- **`useOwnerChatClient.test.tsx`:** the two existing tests are untouched. New cases:
  - An old request and a new request on the same client are both pending across a same-key recovery. The old 401 leaves the key accepted at the recovered generation; the new 401 rejects it (generation +1). It also checks the client object is reused and that only two requests were made.
  - A minimal reused-client case: after recovery, a 401 from the same client still rejects. A capture-at-creation version would fail this.
  - Three related cases: forget then re-enter the same key, replace then re-enter, and forget only. In each, the old 401 is ignored and a new request's 401 rejects. The first two fail under the old key-text-only check.
- **`RunInspectorPage.owner-chat.test.tsx` (new):** the original audit witness, adapted. Every original assertion is kept, including the exact expected end state. Changes:
  - `console.info` became assertions, since the lint config rejects it.
  - `String(input)` became a small `requestUrl` helper, so the type-aware lint should not flag it.
  - The heading lookup is split into two lines.
  - One extra macrotask wait after the old Devices 401 is released.
  - New checks that one Devices call was made, the run read count is still one above the pre-recovery count, the event cursor stays at 3, and the route stays on the run.

**Docs:**
- **`docs/09-frontend-and-pwa.md`:** the delayed-401 paragraph now names management API requests and owner Chat requests (the Chat and Devices pages) explicitly. It also states that a 401 after recovery still rejects, including through the same reused client.
- **`CHANGELOG.md`:** two lines in the #386 entry were reworded the same way. Everything else in both files is preserved.

**For your verification:**
- **Unverified formatting:** Prettier layout was worked out by hand, and the witness's long test title stays on one line.
- **Type assumptions:** `Response.json` is assumed to type-check under TypeScript 6. The `run.waiting` event fields copy the existing corrective test.
- **New file creation:** I had no Write tool, so I created the new test file with Edit and an empty `old_string`. Please confirm its content on disk.
- **Your checks:** focused tests, web typecheck, scoped lint and format, full coverage and checks, independent QA, and the unchanged original witness.

**Limitations:**
- **Reused-client coverage:** the "same client after recovery" case is tested only at the hook level. Each mount of the Devices page creates its own client, so the component test can't easily exercise it.
- **Out of scope:** event-stream 401 handling and the Goblin device client were not reviewed or changed. Support finding 3 is D232 work.

**Boundaries kept:** no other files changed, including the evidence directory, witness, the two protected e2e specs, other existing tests, protocols, coverage thresholds and dependencies. No casts to `any`, skips, retries or weakened assertions, and no network, provider, Git, credentials, owner store or port access.