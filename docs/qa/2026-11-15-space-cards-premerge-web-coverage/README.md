# Space cards first full web coverage

This packet preserves the first full web coverage run for the preparatory Space cards stack. Vitest passed **2,886 tests in 223 files** on the first attempt, in 23 minutes 26 seconds.

## Source and limits

- Candidate head: **20875894b0f2a9206141f3c469c649d7155d3e45**
- Tree: **b23ac01c96358443047067cd9fd26d2e3afe4b86**
- Observed main: **1cfca9bce3967c9d41950266c83aab636667e0ab**
- Runtime: project Node **v22.23.4**; Vitest v5.0.3; command: **pnpm.cmd --filter @graphgoblin/web test:coverage** with the coverage output directory redirected to this evidence folder.

This is coverage evidence for that exact premerge stack. It is not coverage of the later integrated head or a native/browser acceptance run. No build, browser, service, provider, native fixture, or formal review ran in this coverage task. The global Space fixture correction budget remained **1 of 2**.

The [raw handoff](handoff.md.txt) is byte-identical to the source handoff; it is stored with a .txt suffix so its original Markdown is not reformatted. The [full original evidence manifest](evidence-manifest.json) retains all 283 source file entries, 7,596,650 bytes total, including the hashes for the generated report files omitted from this packet. The [root verification](root-verification.json) records that file count, byte count, exact before/after identity, and source handoff hash.

## Coverage result

| Metric     | Result                   |
| ---------- | ------------------------ |
| Statements | 97.68% (13,354 / 13,670) |
| Branches   | 94.27% (12,463 / 13,220) |
| Functions  | 97.19% (3,365 / 3,462)   |
| Lines      | 98.60% (11,732 / 11,898) |

SpaceCardsOffer.tsx and space-cards.ts each had 100% line and branch coverage. Canvas.tsx recorded 98.84% lines and 93.95% branches. store.ts recorded 99.54% lines and 99.20% branches. These are executed coverage measurements; they do not substitute for an integrated-build verdict.

The log includes jsdom’s “Not implemented: navigation to another Document” message. It was not a failing assertion: Vitest exited zero and all 2,886 tests passed.

## Retained files

- [Raw coverage handoff](handoff.md.txt), [exact command](command.json), [first command script](first-command.ps1), [exit receipt](exit-first.json), and [complete first log](web-coverage-first.log).
- [Coverage summary JSON](coverage/coverage-summary.json) and [LCOV data](coverage/lcov.info).
- [Result summary](result-summary.json), [source before](source-before.json), [source after](source-after.json), [owned-run progress](owned-run-progress-0600.json), and [terminal readback](terminal-readback.json).
- The [curation manifest](curation-manifest.json) maps each copied source row to its destination and hash. [SHA256SUMS](SHA256SUMS) verifies all files in this packet except itself; [link checks](link-checks.json) records local README link validation.

The packet copies the 12 non-HTML source-manifest rows (621,389 bytes). It omits 271 generated files under coverage/lcov-report (6,975,261 bytes), which are HTML coverage pages and their supporting report assets. Their original source paths and SHA-256 hashes remain in the full manifest, and the source evidence folder remains intact.
