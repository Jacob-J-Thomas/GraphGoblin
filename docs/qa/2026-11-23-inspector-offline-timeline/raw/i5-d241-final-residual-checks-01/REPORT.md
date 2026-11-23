# D241 residual correction checks

Web typecheck, ESLint across 13 author files, and Prettier across all 15 author files exited 0 under Node 22.23.4 and pnpm 12.8.1. Prettier made no writes. ESLint reported five ref naming warnings and zero errors. The warnings were in RunInspectorPage.tsx (295, 296, 324, 361) and SessionRecoveryControls.tsx (50).

The single focused Vitest run passed all 229 cases across the 14 named files with one worker and zero retries. It retained all 227 prior case names and added two cases.

- run inspector through an outage (#416) keeps a fresh-session choice queued before a shown observation-only loss spent once its receipt is read again under another accepted API key
- run inspector through an outage (#416) keeps a fresh-session choice queued before a shown observation-only loss spent once its receipt is removed and read again

Source and control snapshots agreed throughout execution, including the protected core, lockfiles, module metadata, checkout index and absent common index. The checked worktree was 2231400 with the four admitted changes. Root later froze those bytes at d8bc84937363bbde1d24b561efdcd9e8601a48a7, tree e94fb9c910696baddd7278992ed716af4ca747d0.

The original unexecuted preparation omitted one character from the prior report SHA256 pin. Root preserved those bytes and executed a separately pinned copy with that sole correction. ROOT-PIN-CORRECTION.json and both program files preserve the record. The scoped formatting path was available on a style-only failure and was not triggered.

RESULT.json, the 06-focused command receipt and streams, and vitest-results.json carry the executed evidence. The independent regression, build and browser phases are separate.
