# ADR-0005 - Codex is the only harness in 1.0; Claude Code and LiteLLM after

Date: 2026-10-02. Status: Accepted.

## Context

The Codex SDK and CLI are Apache-2.0, support structured output natively, resume threads, and work with the owner's subscription login. The Claude Agent SDK is under Anthropic's Commercial Terms, lacks a structured-output option in the SDK, and subscription login cannot be offered inside third-party products. Supporting two harnesses from the start doubles adapter work and parity concerns.

## Decision

Ship 1.0 with Codex as the only `HarnessPort` implementation. Keep the port harness-neutral. Add Claude Code first after 1.0, then LiteLLM as a plain completion provider for decisions and summarisation. Preserve the Claude Code research in `research/claude-code-agent-sdk.md`.

## Consequences

- One adapter to get right, one set of fixtures, one model catalog.
- Every model call in 1.0, including decisions and schema repair, runs through Codex on the subscription, with Jev as the only API-key service.
- The port must not leak Codex concepts; the Claude research doc lists the differences the port already accommodates.
