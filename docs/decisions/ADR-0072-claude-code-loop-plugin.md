# ADR-0072 - Local Claude Code loop plugin

Date 2026-11-14. Status accepted for [#455](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/455).

## Context

Claude Code needs a native plugin that can design a draft, start a requested loop and inspect the result. The existing Codex plugin's marketplace and MCP configuration follow Codex conventions. Its design skill edits through REST while its run and inspection skills use MCP.

## Decision

Assemble a Claude-native plugin using Claude Code's manifest, skill namespace, and stdio MCP registration. Keep the portable skill guidance in the existing checked-in skills and adapt invocation and authoring text at build time. Offer a directory that Claude Code loads per session and can copy into a local skills directory. A copied plugin continues to reference the same built MCP entry in the local checkout. The shared ownership-safe builder stages the artifact and refuses output containing foreign entries. Assembly runs for the current checkout so its absolute path is never supplied by a build cache.

Use `--draft-tools` to explicitly select a capability on the existing stdio process. The new tools create, read, validate, and save drafts through the typed API client and gateway authorization. Saves require the draft's observed version token. The plugin's design workflow ends with an unpublished draft and has no publication tool. Run and inspection use the existing MCP tool contracts. Credentials come from the launching process and the generated artifact contains no credential.

## Verification

The [integration guide](../guide/05-mcp-and-codex-plugin.md#load-the-claude-code-plugin) names the supported commands and [the plugin README](../../apps/plugin-claude/README.md) records the exercised host and CLI version. A disposable configuration and gateway can exercise the plugin loader, tool registration and invocation without changing a personal installation.
