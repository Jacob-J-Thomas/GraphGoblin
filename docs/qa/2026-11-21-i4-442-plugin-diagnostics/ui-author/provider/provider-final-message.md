The Codex notice is in place in Settings → Harness preflight, and it's ready for the GPT UI review. All changes are uncommitted and nothing is staged. HEAD is still `5b0d806c`, and the seven frozen backend and docs files still match the root receipt.

**Files changed (my three only)**
- `apps/web/src/settings/sections/PreflightSection.tsx` (+24 lines)
- `apps/web/src/settings/sections/PreflightSection.test.tsx`
- `apps/web/src/settings/SettingsPage.test.tsx`

**What the user sees**
- The Codex row has a small muted paragraph containing the shared constant word for word. It's imported from `@graphgoblin/domain`, not copied.
- The two inventory commands are shown as code by splitting the constant itself, so the visible text is exactly the shared text.
- It sits after any problems and outside the problem list. The badge, problems, Retry, Rechecking/Offline status, loading view and error view are unchanged.
- No new query, request, contract field or control.
- Claude, Ollama and other rows never show it, and neither does a result list without Codex.

**Design choices**
- **Muted paragraph, not `Alert`:** this copies the existing Claude note ("Adapter model listings do not confirm account access"). `Alert` would add a second live region in a card whose tests rely on exactly one. A tinted box under Ready would also read as a problem with Codex.
- **Not a badge, not the problems list:** a second badge would look like a measured plugin state, and D175 ruled out using `problems`.
- **Shown for every Codex state, not only Ready:** it describes what the check covers, which is the same whatever the result. The brief asks for it alongside the sign-in problems, and the docs don't limit it to Ready. This is the one deliberate difference from the backend, which adds its warning only when Codex passes. If the reviewer prefers Ready-only, it's a one-condition change.

**Checks (all retained in `i4-442-ui-author-02/author/`)**
- **Before edits:** the two focused test files passed, 48 tests.
- **Final:** 59 tests pass (11 new). The web typecheck, ESLint with zero warnings and Prettier all pass.
- **Focused coverage on `PreflightSection.tsx`:** passes the unchanged 90% thresholds (100% statements, functions and lines; 96.42% branches). The one uncovered branch is older Claude code (`84d641a`).
- **Mutation testing:** I made nine deliberately wrong versions of the component, and the tests failed for all nine. They covered: notice removed, on every harness, Ready-only, warning colour, live region, no code formatting, visually hidden, placed before the problems, and wording changed. The file was restored and hash-checked after each one. Afterwards only a comment changed.
- **Failures:** no gate check failed. One read-only diff command failed on a shell quirk and was redone with `diff -u`; the report records it.

**Still open**
- **`docs/09-frontend-and-pwa.md` (lines 1064–1071) doesn't mention the Codex notice.** That's the docs owner's file, so I didn't edit it; suggested wording is in the report.
- **Not checked in a real browser:** the unit tests don't load CSS, so real rendering, wrapping at narrow widths and screen-reader order still need browser QA. Two browser test files touch this card: `responsive.spec.ts` (sideways scroll) and `readiness.spec.ts` (single status region). Per the brief, I didn't run them.
- These are author tests only. GPT review, browser QA, CI and the final audit remain separate gates, and #439, #442 and owner acceptance stay open.

The full report, with copy and layout reasoning, is `REPORT.md` in `i4-442-ui-author-02/author/`, and the final patch is `10-final-uncommitted.patch`.