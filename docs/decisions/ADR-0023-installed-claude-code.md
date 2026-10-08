# ADR-0023 - Owner-installed Claude Code CLI as a local inference harness

Date: 2026-10-07. Status: **Accepted architecture; implementation and product review pending**. Owner approval: [#26](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/26).

## Context

The owner selected Claude.ai account authentication for a local Claude Code harness, with API-provider support deferred to [#100](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/100). The first implementation must not add a Claude Agent SDK, vendor a CLI, or imply that an account subscription includes any particular model. It must remain isolated from Codex evaluator and session state.

## Decision

GraphGoblin invokes the owner's installed Claude Code CLI directly, without an Anthropic runtime dependency or CLI installation step. The initial adapter is native Windows only and pins CLI version `2.1.285`; another platform or version fails closed. `GG_CLAUDE_BINARY` may select an explicit executable. Otherwise the path is `%USERPROFILE%\.local\bin\claude.exe`.

Only the `claude.ai` authentication category is accepted. Preflight and each turn check it under a restricted child environment. Non-turn version, capability and authentication probes use a fresh empty temporary directory rather than the authored project. GraphGoblin stores no Claude credentials and does not return raw authentication output. Billing metadata is `claude.ai-account` with `account-dependent` status; it is not an entitlement or subscription-inclusion guarantee.

The exact admitted model is `claude-opus-5-5`. `claude-fable-5-1` remains blocked while billing is unverified, regardless of its catalog enabled preference. Supported effort values are `low`, `medium`, `high`, `xhigh`, and `max`; `minimal` is unsupported. The CLI exposes the requested effort but not effective effort, so the runtime records the request and leaves `effectiveEffort` unknown.

Native Windows supports only `read-only`/`never` and `danger-full-access`/`never`. Read-only restricts built-in `Read`, `Glob`, and `Grep` tools but does not confine filesystem reads or provide OS isolation. Danger-full-access adds `Edit`, `Write`, and `Bash`; commands and network access are unconfined under the API user's account. There is no automatic policy upgrade or per-run approval flow. Unsupported workspace-write or on-request requests, `networkAccess: false`, `webSearch: true`, nonempty custom capabilities, and nonempty raw overrides fail validation and runtime admission.

For a requested inference output schema, verified CLI `2.1.285` init must advertise the exact execution-tool set plus one virtual `StructuredOutput` carrier. This does not extend the CLI execution allowlist or the read-only/full-access policy. Without a schema, carrier advertisement or use is refused. Carrier calls retain ordinary tool-ID correlation and strict boolean error-marker validation but store only separate `other` progress with the carrier name/status; they cannot create file/command evidence or provide the candidate. Final `result.structured_output` remains authoritative for engine validation and repair. Bounded native fresh and same-session resume schema turns on CLI 2.1.285 at source `3349212` verified the advertisement, correlated carrier calls/settlements, authoritative final candidates and exact `claude-opus-5-5` model usage. Resume reproduced the exact synthetic nonce omitted from its prompt. Requested effort was `xhigh`; effective effort remains unreported. These checks establish that tested path, not general recall, OS/read-path confinement or prompt-delivery proof.

Defaults resolve only within the selected harness: node, loop, owner Settings, then process `GG_DEFAULTS`. Explicit wrong-family and unknown catalog values fail instead of falling through. Existing fresh, resume-previous, and resume-named meanings remain unchanged; stored session lookups filter by harness before selecting the newest match. Claude support is for inference only. Decision evaluation, exit configuration, and the separate Codex structured port remain as before. Inference candidates pass through the existing engine schema repair/failure policy for either harness, including authoritative null or missing output. Engine failures retain their cause and stop the active initial or repair session; unconfirmed termination remains a nonresumable failure.

## Consequences

Claude Code is unavailable in containers and on non-Windows hosts in this release. The read-only label describes a built-in-tool restriction, not a filesystem or OS security boundary. A future provider/API integration requires a separate decision and is not implied by this CLI adapter. The prior [Claude Agent SDK research](../research/claude-code-agent-sdk.md) remains an alternative, not the implementation.

Focused UI evidence and remaining acceptance work are recorded in [the #26 QA report](../qa/2026-10-07-issue-26.md). This ADR records architecture approval and the bounded native fresh/resume evidence; it does not declare broader runtime verification or owner integrated product acceptance complete.
