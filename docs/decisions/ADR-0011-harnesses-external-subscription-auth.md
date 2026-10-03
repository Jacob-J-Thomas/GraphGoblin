# ADR-0011 - Harnesses are external engines; Codex uses the machine's subscription login

Date: 2026-10-02. Status: Accepted.

## Context

The owner requires fully ownable, redistributable code and wants to run on subscriptions rather than API billing for 1.0. Codex CLI is Apache-2.0; the Claude Agent SDK is under commercial terms. Both are installed and authenticated by the user.

## Decision

GraphGoblin never bundles a harness. It discovers the installed CLI, checks login state in a preflight, and uses whatever credentials the CLI already has. It stores no harness credentials. For the hosted version after 1.0, users will supply API keys per the vendor's terms.

## Consequences

- The dependency tree stays permissively licensed.
- The install guide must cover installing and logging in to Codex.
- Multi-tenant hosting cannot rely on subscription logins; this is recorded in 11.
