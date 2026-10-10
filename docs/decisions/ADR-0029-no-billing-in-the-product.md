# ADR-0029 - No billing in the product

Date: 2026-10-09. Status: **Accepted**. Supersedes the billing portions of [ADR-0023](ADR-0023-installed-claude-code.md).

## Context

GraphGoblin runs the owner's installed account harnesses. A hard-coded Fable restriction had no entitlement verifier or owner setting capable of resolving it. The owner has chosen to remove this product concept; any distant future billing feature needs a new decision.

## Decision

Contracts, current API responses, execution evidence and UI carry no billing metadata, admission classification or billing-only rejection. Claude Opus 5.5 (`claude-opus-5-5`) and Fable 5.1 (`claude-fable-5-1`) pass through identical installed-CLI, account login, exact model, supported effort and execution policy checks. Ordinary provider authentication, quota failures and cancellation remain intact. Owner catalog switches still govern availability.

CLI readiness requires version `2.1.285` or newer and the required capabilities. Login is checked independently of version/capability failures; incompatible streams still fail strict runtime protocol verification.

Fresh stores seed both models enabled. Numbered migration `0011_enable_claude_fable` enables previously blocked Fable rows once. It changes no other catalog entry; later owner disablement survives migrations and startup seeding. Historical transcript artifacts, research and QA observations are retained without rewriting their evidence.

## Consequences

Rebuild and deploy the API and web together, regenerate the API client, and update consumers of the removed strict contract fields. No entitlement setting or replacement admission path is added. Technical model verification still fails closed, and a successful preflight does not claim that a live model turn has been verified.
