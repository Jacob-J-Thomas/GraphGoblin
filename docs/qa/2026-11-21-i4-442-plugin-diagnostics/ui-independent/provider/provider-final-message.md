## #442 UI/browser QA: CONDITIONAL, no product defect found

I found no defect in the Settings Codex notice. All 24 planned cases ran in the final attempt (`run-03`): 20 passed, 1 static check passed, and the 3 control cases failed exactly where predicted. Of 596 individual checks, 588 passed; the other 8 are those predicted control failures.

**Why it's CONDITIONAL rather than PASS:** the candidate commit `39304c07` isn't in the QA checkout, and fetching was prohibited, so `git checkout --detach` was impossible. I didn't fetch or copy Git objects. Instead I read the 4 changed files' committed bytes from the read-only author checkout and wrote them into the QA checkout. Each file matches the candidate's Git hash and the root receipt's SHA-256, and `git status` shows exactly those 4 files changed. So the checkout's content equals candidate tree `f5d9abae`, but HEAD is still `5b0d806c`. The root needs to decide whether this way of tying the evidence to the source is acceptable. `git checkout -- <4 paths>` undoes it.

**Results against the selected contract (D175/D189/docs09):**
- **Notice content and placement:** the text exactly matches the shared domain constant, with the two commands rendered as `<code>`. It's a muted 12 px paragraph with no live-region role. It appears after the problems, outside the problems list, as the last item in the Codex row.
- **Every Codex state, through the real backend:** Ready, sign-in needed, usage limit, connection failed, unknown, CLI update needed and CLI not found all show the notice. The Claude and Ollama rows never do, and it's absent when there's no Codex row.
- **Ready and sign-in views unchanged:** with the notice removed, the card's HTML is byte-identical to the old 5b build in both states. The loading and request-error views are identical to the old build too.
- **Retry:** one request and the 4 expected CLI checks per click, "Rechecking…" in the existing status region, and still one notice. The server's request log agrees with the browser's counts in all 3 sessions.
- **Offline:** the last result and the one status region stay; nothing is requested while offline, and exactly one request goes out on reconnect.
- **Request failure and loading:** no false Ready anywhere.
- **Read-only:** every browser request was a GET, settings were the same before and after, there were no plugin or MCP inventory commands, and Settings never called `/system/preflight`.
- **Layout:** no overflow at 1440, 375 and 320 px or the 200%-zoom equivalent, in dark and light themes. Notice contrast is 9.98:1 (dark) and 7.68:1 (light). Reduced motion doesn't affect it.
- **Build:** the one incremental build matched my prediction: 12 tasks, 9 cache hits, web rebuilt. The CSS output is byte-identical to the old build.

**Observation, not fixed:** at 375 px and the 200%-zoom width, one command's code span wraps mid-command. Nothing overflows, but you may want to keep the commands unbroken.

**Failed attempts, all kept:** run-01 had one false failure caused by my driver leaving a second browser tab open, not by the product. I overwrote that driver before saving a copy, so its retained copy is a reconstruction I can't prove byte-exact. Run-02 crashed at startup from my own ordering bug before anything launched.

**Limits:**
- Edge 158 headless only; no other browsers.
- Service workers were blocked to keep request counts exact, which produced harmless console warnings.
- Zoom was simulated by viewport size, not the browser's zoom control.
- The accessibility check reads the DOM and accessibility tree; it isn't a screen-reader test.
- No real Codex CLI or account was used.

**Cleanup:** all 3 gateways shut down through authenticated drain with exit 0, and their ports and PIDs were confirmed gone. The browser's processes went from 6 to 0. Ports 4747/4748 were never used. The one other matching process, PID 29204, is your runner that launched this session, and I left it alone. The prior backend packet and the root freeze are byte-identical before and after. No key material was found in the evidence.

This is not CI, a final audit or owner acceptance. No commits, pushes, provider turns or plugin repair were made.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-ui-independent-02` (scratch is at `G:/ggq/qa-scratch/i4-442-ui-qa`); open `REPORT.md` first:
- `REPORT.md`
- `PLAN.md`
- `MANIFEST.sha256.json`
- `binding/`
- `run-01/`
- `run-02/`
- `run-03/`