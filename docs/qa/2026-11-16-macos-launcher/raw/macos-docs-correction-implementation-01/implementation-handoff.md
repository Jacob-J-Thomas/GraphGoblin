# macOS launcher documentation correction handoff

Worktree: `C:\Users\98jak\.codex\worktrees\gg-20261116-macos-launcher\GraphGoblin`
Source snapshot at handoff: `8bddb93aaa61ebb1b962385efa97a468a379929d`

## Changed documentation

- `docs/09-frontend-and-pwa.md` — added the macOS Finder/Dock launcher entrypoint and cross-links.
  SHA-256: `4799347BE21C56B55D4560B271B96FCE42EB7CE63B761CDEFBCD876AB244962A`
- `docs/guide/07-troubleshooting.md` — added launch outcomes and actions, managed-gateway stages/exits, log and lock locations/limits, 60-second admission versus separate 250 ms diagnostic wait, strict bundle and fresh-store refusals, and maintainer-only receipt inspection/recovery with preservation conditions.
  SHA-256: `873C5DA8445594FF1C820AFF0B4AC661F16833D5EFD10410F3BD73CB25A86806`
- `docs/guide/01-install-and-first-run.md` — replaced unsafe installer recovery language, clarified `.DS_Store` fresh-store refusal, and linked troubleshooting.
  SHA-256: `4D01CFA0B8FD03C0FAAE5A428E31EC8AC976F6E752D94B1B0C51794F5E3E412C`

## Checks

- Node selected from project-scoped runtime: `v22.23.4`.
- `pnpm.cmd exec prettier --check docs/09-frontend-and-pwa.md docs/guide/07-troubleshooting.md docs/guide/01-install-and-first-run.md` — passed.
- `git diff --check --` those three paths — passed.
- No tests or product-source changes were made in this documentation task.
- No Git index, commit, or publication actions were made.

The shared worktree also contains source edits owned by the parent implementation task; this handoff and the three hashes cover only the documentation paths above.