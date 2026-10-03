---
name: graphgoblin-delivery
description: The GraphGoblin multi-model delivery process. Use when planning, delegating, reviewing, or merging work on this repository, when spawning Claude subagents or Codex worker sessions, or when deciding which model does which task.
---

# GraphGoblin delivery process

Claude (the session running this skill) is the orchestrator. It never implements large work packages itself. It plans, writes briefs, spawns workers, reviews diffs, runs every gate, merges, commits, and keeps `docs/` and task state current. Workers are Claude subagents (Opus 5.5) and Codex CLI sessions (the user's ChatGPT subscription), each in its own git worktree.

## Model routing

| Work | Model | Effort | Launch |
| --- | --- | --- | --- |
| Mundane, mechanical: tidy-ups, status rows, mechanical edits, ledger consolidation | `gpt-6-luna` | `xhigh` (routine heartbeat-style checks: `low`) | Codex worker |
| Basic implementation and review; **default when unsure** | `gpt-6.1-sol` | `xhigh` | Codex worker |
| Harder implementation and review, final sign-off reviews | Opus 5.5 | default (highest available) | `Agent` tool, `model: "opus"`, `isolation: "worktree"` |
| Hardest tasks, escalation after another model failed | `gpt-6-astra` | `xhigh` | Codex worker |
| Product's own test inference (loops under test) | `gpt-6-luna` | `low` | engine, never changed by workers |

**Cross-vendor review rule:** whatever a GPT model implemented, a Claude model reviews; whatever a Claude model implemented, a GPT model reviews. Reviews run at `xhigh`. The orchestrator's own diff read before merging does not replace this review.

**Escalation:** if a worker reports it could not finish, re-brief one level up (luna → sol → opus → astra) with the previous worker's summary attached. Do not retry the same model with the same brief.

## Launching workers

### Claude subagent (Opus)

```
Agent({ subagent_type: "general-purpose", model: "opus", isolation: "worktree",
        description: "<WP id>: <short>", prompt: <brief> })
```

The harness creates `.claude/worktrees/agent-<id>` on branch `worktree-agent-<id>`. Its report arrives as a message; resume an interrupted or finished agent with `SendMessage` to its id (context is kept).

### Codex worker

```
node .claude/scripts/codex-task.mjs --name <slug> --prompt <brief.md> --model gpt-6.1-sol --effort xhigh
```

Run it with the Bash tool in the background (timeout up to two hours). It creates `.claude/worktrees/codex-<slug>` on branch `codex-<slug>` from `main`, pipes the brief to `codex exec` (workspace-write sandbox, approvals never, network on, write access to the pnpm store, the repo `.git`, and temp), and writes `.claude/codex-runs/<slug>/summary.md` with the thread id, commands run, files changed, errors, usage, and the final message. Read the summary, not the raw stream. `--resume` continues the same thread with a new prompt (follow-ups, escalations within the same model). `--no-worktree` runs in the current checkout; only use it for read-only reviews. Codex reads `AGENTS.md` on its own.

Codex-written briefs must still say: work only in the current worktree and branch, commit with conventional messages and no attribution lines, never push, merge, rebase, stash, or switch branches, and end with a report listing what changed and what was left open.

## Every brief contains

1. Orientation: which docs and files to read first (`AGENTS.md`, `docs/README.md`, the numbered docs for the area, the files to change).
2. Hard rules: conventional commits with **no attribution of any kind**; coverage at or above 90% on all four metrics per package; permissive licences only with a `docs/research/licenses.md` row for every new dependency; `.js` extensions on relative imports; keep docs in sync; `pnpm check:deps` via the nvm Node 22 binary as `AGENTS.md` describes.
3. Constraints of the moment: disk headroom, which other worker is touching which shared files (so edits there stay small and additive), live-inference budget (Codex sessions: at most two per worker, `gpt-6-luna` low, read-only sandbox, ephemeral dirs, gated behind `LIVE=1`), secrets never printed or committed.
4. Tasks, numbered, each with its acceptance test and docs to update.
5. Gates to run before reporting: `pnpm typecheck`, `pnpm lint`, `pnpm check:layers`, `pnpm test:coverage`, `pnpm check:licenses`, `pnpm check:docs` (when present), `pnpm build`, `pnpm format` then `pnpm format:check`, `node --test tooling/scripts/*.test.mjs`, dependency-cruiser under Node 22, and the web E2E suite when `apps/web` changed.
6. Report shape: branch and commits, coverage table for changed packages, exact changes to shared files, live results, every caveat and decision for the orchestrator to review.

## Orchestrator loop per work package

1. **Brief** from `docs/14-work-packages.md` and `docs/12-implementation-plan.md`. Pick the model from the routing table. Create a task (`TaskCreate`) and mark it in progress.
2. **Launch** the worker. Run independent work packages in parallel in separate worktrees; tell each what the others are touching.
3. **Review** the report, then read the diff of every shared or risky file (`git diff main..<branch> -- <paths>`). Check for scope creep, weakened types, lowered thresholds, attribution lines, secrets, new dependencies without a ledger row.
4. **Cross-vendor review.** Spawn the opposite vendor at `xhigh` as a reviewer against the branch: findings only, with reproducing tests for real defects. Fix blockers before merging (re-brief the implementer with `--resume` or `SendMessage`).
5. **Merge** with `git merge --no-ff <branch> -m "merge: <WP> <summary>"`. Resolve `pnpm-lock.yaml` by taking the branch side and running `pnpm install`; resolve root `tsconfig.json` as the union of references; resolve `docs/research/licenses.md` by keeping `main` and appending the new rows; resolve additive code conflicts as the union. `pnpm format`, commit with `--no-edit`.
6. **Gates on main.** Run everything in step 5 of the brief on `main` plus the E2E suite. Delete `coverage/` directories afterwards. Two or more API or infrastructure tests timing out under full parallel load means re-run that package alone before concluding anything.
7. **Clean up.** `git worktree unlock` if locked, `git worktree remove --force`, then `git worktree prune` and `git branch -d`. On "Directory not empty" or "Filename too long", mirror an empty folder over it with `robocopy /MIR` and remove it.
8. **Record.** Mark the task complete, update `docs/12` statuses and `docs/14` delivered notes if the worker did not, update the project memory, and tell the user what merged, what is running, and what needs them.

## Adversarial validation before sign-off

Work is not complete until it has survived an adversarial pass that exercises the running product, not just the unit tests:

- **Behaviour QA** (Opus or Sol at `xhigh`): drive the real API and the built web app with Playwright on the installed Edge (`channel: 'msedge'`, never download browsers), attack every form, edge rule, run control, SSE reconnect, auth mode, webhook receiver, and static route; record every defect with steps, expected, actual, severity, and fix commit in `docs/qa/<date>-<wp>.md`.
- **Design review** (Astra or Opus at `xhigh`): read the ADRs and the numbered docs, then try to break the invariants in code with targeted tests (state machine, crash recovery, replay, trigger security, concurrency). Real defects get a fix when small, otherwise a `.todo` test plus a report entry.
- **Final sign-off** (Opus): confirms gates, reviews the QA and design reports, and states residual risks in `docs/12`.

## Commit and git rules

- Commits use the repository's configured identity. No `Co-Authored-By`, no "Generated with", no assistant name anywhere in a commit, merge message, or PR.
- Commit when a milestone or merge is complete; never ask whether to commit or continue.
- Worktrees live under `.claude/worktrees/` (gitignored). Codex run logs live under `.claude/codex-runs/` (gitignored). Never use bare `git stash`.

## Machine notes (Windows 11 development box)

- Node 23.10 globally; dependency-cruiser needs Node 22: `"$APPDATA/nvm/v22.14.0/node.exe" node_modules/dependency-cruiser/bin/dependency-cruiser.mjs packages apps --config .dependency-cruiser.cjs`.
- pnpm 12 installed with `npm i -g pnpm`; TypeScript pinned to 6.x; Vitest forks pool wherever libsql loads.
- Codex CLI 0.160.0 with ChatGPT login; the user's global `config.toml` defaults differ from the product's, so adapters and briefs always set model, effort, sandbox, and approval explicitly.
- Disk is tight: delete `coverage/`, `playwright-report/`, `test-results/` after reading them; worktrees are cheap because pnpm hard-links.
- Secrets such as the Jev API key arrive as user environment variables (`setx JEV_API_KEY ...`) and are read from the registry, never pasted into chat or committed.
