# #440: additive GPT-6.1 Terra catalog delivery

Date: 2026-11-07. Implementation base: `bb8c4afa0c5a83ae92631d5df800bb131445c02b`; branch `codex/gg-20261107-models`, isolated worktree `C:\Users\98jak\.codex\worktrees\gg-20261107-models\GraphGoblin`. Runtime: Node v22.23.4, pnpm 12.8.1. SDK and bundled Codex CLI remain 0.160.0. This is implementer evidence; independent adversarial review and independent QA are separate gates.

## Scope and source verification

Add enabled `gpt-6.1-terra` immediately after `gpt-6.1-sol` in `DEFAULT_MODEL_CATALOG`, using the existing six-level `CODEX_EFFORTS` and `medium` default. No schema, migration, adapter mapping, dependency, default-model or unrelated retirement change.

Official pages fetched on 2026-11-07:

- [OpenAI GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) names the exact ID and offers `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`.
- [Anthropic model overview](https://platform.claude.com/docs/en/models/overview) and [Fable 5.1 overview](https://platform.claude.com/docs/en/models/fable-5-1/overview) identify Fable 5.1 as the current Fable identity. No official Fable 5.5 identity was verified. The existing Fable 5.1 and Opus, Sonnet and Haiku 5.5 entries are retained.

The pinned binary was read only for public embedded catalog metadata. [pinned-catalog.json](pinned-catalog.json) records its 326,872,368 bytes, SHA-256 `fdda5fa3cf3fb3d000b876720742857676293e4315e4b045fae6f8bd7e866d1d`, and absence of an embedded Terra row. [inspect-pinned-catalog.mjs](inspect-pinned-catalog.mjs) records the method. An initial attempt to resolve the import-only SDK with CommonJS failed locally before reading the binary or making any provider call; the final script uses the installed SDK's real path. The absence of an embedded row is not a provider refusal; the real harness turns below establish named-model acceptance at two efforts.

## Real pinned harness turns

[live-terra.ts](live-terra.ts) uses the unchanged public `CodexHarness` with its default bundled CLI, inherited login, fresh disposable working directory, read-only sandbox, approval `never`, disabled sandbox network and web search, and a 60-second deadline per turn. It opens no GraphGoblin store, reads no credential files, writes no owner configuration, invokes no Jev provider, and starts no service. The prompt requests one exact constant and forbids tools, file reads, commands, network access and changes. Native turn output recorded only an agent message. The temporary working directory is retained for inspection.

Exactly **two real provider turns** ran, one at each requested effort, with **no retries, model substitution, or SDK upgrade**. Preflight reported authenticated and ready on CLI 0.160.0. [live-terra-result.json](live-terra-result.json) preserves normalized events, adapter-resolved settings, output, usage, session handles and timestamps; [live-terra.log.txt](live-terra.log.txt) records the driver outcome.

| Requested model | Requested effort | Adapter-resolved model / canonical effort / CLI effort | Final text             | Outcome |
| --------------- | ---------------- | ------------------------------------------------------ | ---------------------- | ------- |
| `gpt-6.1-terra` | `none`           | `gpt-6.1-terra` / `none` / `none`                      | `GRAPHGOBLIN_TERRA_OK` | pass    |
| `gpt-6.1-terra` | `medium`         | `gpt-6.1-terra` / `medium` / `medium`                  | `GRAPHGOBLIN_TERRA_OK` | pass    |

The normalized SDK event stream reports neither provider-effective model nor provider-effective effort. The resolved fields above name the settings the adapter sent to the pinned CLI, not provider-returned metadata. The other four effort levels are advertised by the official model page and covered by SDK argument tests; they were not exercised with a real provider.

Command, from the worktree root with the project Node 22 first on PATH:

```powershell
pnpm.cmd --filter @graphgoblin/api exec tsx --conditions=development ../../docs/qa/2026-11-07-issue-440/live-terra.ts
```

## Controlled checks

Frozen-lockfile installation passed in this worktree (800 packages; no lockfile changes). Focused checks ran rather than using Turbo cache:

| Command                                                                                                               | Result                   | Evidence                              |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/catalog.test.ts src/sqlite/storage.test.ts` | 53 passed across 2 files | [log](focused-infrastructure.log.txt) |
| `pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run src/effort.test.ts src/effort-names.test.ts`            | 31 passed across 2 files | [log](focused-adapter.log.txt)        |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/catalog.test.ts`                                              | 37 passed in 1 file      | [log](focused-api.log.txt)            |

Storage checks establish the fresh enabled Terra row, exact display name, all offered efforts, medium default and seed order; insertion of only the missing Terra row; idempotence; preservation of existing disabled Codex/Claude switches, a custom LiteLLM row, and owner default choices; and preservation of later Terra disablement with execution refusal. API tests establish catalog output and admission of the new model, including `none` in inference and decision nodes and owner defaults, alongside existing negative admission cases. Adapter tests run the real pinned SDK against a controlled executable and establish exact model and effort arguments for all six levels; those tests do not make provider calls.

Full check, build, whole-repository format and affected model-picker/model-effort browser gates are pending in this working evidence record. Browser coverage uses the built web app and real API with controlled harnesses, not additional provider calls.
