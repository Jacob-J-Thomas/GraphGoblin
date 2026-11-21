**Verdict: PASS on all four criteria** for the corrected test file at candidate `446da9ce`. This QA does not complete hosted CI, native verification, root completion or the owner-only #448 closure.

| Criterion | Result | Basis |
| --- | --- | --- |
| C1: the new file is isolated and keeps its startup paths | PASS | **Guard:** blocks deliberate attempts with either layer alone. **Real Ollama path, enabled:** one blocked `/api/tags` request from `discovery.ts:80`. **Candidate's `false` setting:** zero attempts. **Ordinary single-file run, two replicates:** 14/14 pass, zero attempts in both Vitest processes, zero TCP rows. **Startup paths:** exactly 4, all through `container.start()`, two from the positive tests and two from the disabled-default tests. |
| C2: storage contract on real SQLite files | PASS | **Actual candidate run:** absent WAL → 0 B, DB unchanged; empty WAL stays 0 B; the 8,272 B WAL stays byte-identical. My readings of these files match all 81 of the test's own reads byte for byte. **My own preflight scenarios:** DB, catalog rows and migrations unchanged in all four (absent, two empty, frozen nonempty). **19 real-file controls:** the test's helper, run verbatim, agrees with my independent check on every one. These include real SQLite-written frames, appended frames, a real checkpoint and a 32-byte header-only WAL. |
| C3: the original strict check rejects the absent→empty case | PASS | The parent commit's exact assertion rejects all 4 captured absent→empty transitions: 2 from my scenario, 2 from the actual candidate run. It accepts the 6 unchanged cases. The new helper accepts all 10. On this host both the product reader and a `node:sqlite` reader really created the empty WAL; I measured the before and after states rather than assuming them. |
| C4: scope, preservation and cleanup | PASS | **QA checkout:** clean and detached at the candidate, prior branch still at `b45807f0`. **Author checkout:** unchanged. **Original evidence:** author seal re-verifies 98/98, Astra seal 2/2. **Brief/spec:** unchanged. **Processes:** none of the 56 recorded PIDs is alive, and nothing is listening on 4747/4748/11434. **Scratch:** my own entries removed; only the runner's `claude/` folder remains. |

**Failures and fixes:**
- My first self-check (`01a`) failed because of a bug in my own guard: it blocked the IP-address lookup that `server.listen` does. One fix (v2) let those lookups through while still blocking every hostname lookup. That used 2 of the 3 allowed driver versions; the v1 code, output and error are kept.
- My first attempt to load Vitest's `expect` used the wrong (CommonJS) entry and was refused. The second probe used the correct entry.
- Two broken spec drafts were never run; they are kept and renamed.
- One logged command line in `00c` doesn't match what actually ran. An erratum file records the correct command.
- No test, threshold or product file was changed, and nothing was re-run to get a green result.

**Limits:**
- The network guard only covers Node processes. pnpm, cmd, esbuild and the product's lock-check PowerShell are covered only by the TCP poller, which polls rather than intercepts. It missed some short-lived children, including Vite's `cmd /c "net use"`, and it cannot attribute DNS done by Windows.
- The handle-layer half of the guard relies on Node's deprecated `process.binding`, which works on Node 22.23.4.
- All evidence is from one Windows host.
- Some negative controls are file edits (byte flips, removal, truncation) rather than SQLite operations; the report marks which.
- For C3, the old assertion was run on captured file contents. The parent's whole test file was not re-run, since no source changes were allowed.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01/`:
- `report.md`
- `PLAN.md`
- `seal.json` (184 files sealed)