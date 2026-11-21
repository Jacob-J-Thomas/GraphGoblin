# ADR-0087: Shorten the pinned Codex SDK schema-directory prefix

Status: Accepted under the delegated delivery decision D177, 2026-11-21.

## Context

#363 replaces the structured adapter's own Windows `mkdtemp` allocation with a short,
exclusive `mkdir` name. At a 226-character temporary root that creates a 249-character
working directory, but the real SDK then allocates its output schema separately under
the same host temporary root. Pinned `@openai/codex-sdk` 0.160.0 uses
`mkdtemp(join(tmpdir(), "codex-output-schema-"))`: the 253-character directory template
fails with `ENAMETOOLONG` on the measured Windows Node 22.23.4 host before the CLI turn.
An allocator test using a fake harness cannot establish this later SDK boundary.

The pinned SDK's public turn options expose an output schema and an abort signal, but
no host schema-file/temp-root override. Its client `env` option configures the CLI child;
it does not change the earlier Node-host `tmpdir()` allocation. GraphGoblin already
manages a patch to this SDK version for `windowsHide` (ADR-0049).

## Decision

Extend that managed patch with exactly one output-schema change: shorten the SDK's
temporary-directory prefix from `codex-output-schema-` to `gg-schema-`. Retain its native
`mkdtemp` exclusive allocation, random suffix, permissions, schema bytes/enforcement and
normal/error/abort cleanup. Keep the existing `windowsHide` change. No SDK version,
dependency, public API, environment policy or failure-classification change is selected.

Generate the patch and its lockfile hash through pnpm and verify installation with the
frozen lockfile. No process-global TEMP/TMP mutation, runtime monkeypatch, custom SDK
allocator or private SDK entry point is used.

Maintained tests run the installed SDK's public API in fresh Node children with short
and exact 226-character TEMP/TMP roots and a harmless schema-reading CLI. They check
schema content, normal/error/abort cleanup and unrelated path preservation. At that
specific long root, the SDK directory is 243 characters and `schema.json` is 255. A
separate full adapter/harness/SDK fixture and independent QA retain their evidence tiers;
none of these controlled CLI fixtures establishes a provider turn or arbitrary long-path
support. Ordinary filesystem, working-directory and CLI path limits still apply.

## Alternatives

- Limit #363 to adapter allocation and document the immediate SDK blocker: declined
  because the same real structured call would still fail at the reported root.
- Change the process-global temp root or monkeypatch SDK/filesystem behavior: declined
  because concurrent calls share that process and the public SDK has no such override.
- Omit the output schema: declined because it removes the structured-call contract.
- Upgrade or replace the SDK/executor: declined as a broader change without evidence
  that it is needed for this bounded failure.
- Copy the adapter's allocator into the SDK patch: declined because shortening the
  existing native `mkdtemp` prefix preserves more upstream behavior.

## Consequences

The SDK remains pinned to 0.160.0 and Apache-2.0; only the managed patch hash changes.
Dependency installation from the updated lockfile is required before rebuilding. Future
SDK updates must re-evaluate both patch hunks and keep the real-SDK schema lifecycle
regression. No stored schema, definition/export format, migration or reset changes.
