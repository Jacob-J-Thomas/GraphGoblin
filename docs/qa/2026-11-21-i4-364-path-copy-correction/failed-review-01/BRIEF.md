# D206: bounded corrective review of one documentation path

Use actual Fable5.2/xhigh, read-only. This is NOT a new general scan. PR549 already consumed all three general scans; original final3 stays negative, and the existing D-035/D-042 correction procedure applies.

Checkout G:/ggq/gg-i4-364-claude-start/GraphGoblin is frozen clean at 67d5957cfeb5ed65c0b3e6708f3543a30fbe5b40/treebb0bd9a31e1d873c88778ff11b78b9ad46fd5c8e, parentc9d23dd1a996cde40d285c1ce103b8c8291cb3ab. Read relevant repository instructions, C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/decision-206.md, and G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-364-path-copy-author-01/REPORT.md, receipt.json, patch.diff and exact before/after guide bytes.

Root found an ASCII BACKSPACE byte in the newly documented default Claude executable path, line168 of docs/guide/07-troubleshooting.md. The correction restores literal backslash+b, yielding the existing USERPROFILE/.local/bin/claude.exe Windows path; Prettier adjusts trailing cell padding on that same row. All other guide lines/cell contents and every runtime/test/dependency/old archive file are unchanged. Independently check this exact correction against ClaudeHarness's actual constructor default (packages/infrastructure/src/claude/harness.ts:228-237), verify no meaning change elsewhere, and note any introduced defect. Root supplies exact hash/clean/index checks; your read-only tool capabilities may not recompute hashes, so distinguish your source inspection from that evidence.

Prior actual Fable D203 acceptance and independent Opus C1-C5 PASS apply to unchanged runtime; they are not your review. Separate independent path/byte QA is running/completing in E/i4-364-path-copy-independent-01; do not conflate it with your result. No runtime/broad tests, builds, installs, providers, owner data, Git/index/GitHub changes or subagents.

Return a concise full final report: ACCEPT FIX or CHANGE REQUIRED, exact file/line/source binding, what you read/verified, limitations, and whether the only difference is the repaired literal plus formatter padding. No fourth general scan, renewed Astra approval, runtime QA or merge authorization claim.

