# Claude Code plugin independent QA

Independent behavior QA for [#455](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/455) ran on Windows with Claude Code 2.1.311 and Node v22.23.4. The clean product head was `55ca03b18deeb80a436943c3a8e39e8b5f4b7b0d` before and after both runs. The stacked target was builder head `934971a3f3dd0a17489883907127721c12752b18` in [PR #462](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/462). The MCP control checkout was built main `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`.

The native CLI loaded the built plugin and made actual MCP calls to a built gateway on loopback with disposable file SQLite. A scripted loopback Anthropic Messages endpoint selected the tool calls and checked the skill guidance presented to the model. The executed graph had a manual trigger and an exit. Native macOS, live model tool selection, and a personal installation remain outside this evidence. Owner closure remains pending.

## Results

- **Discovery and installation.** Strict Claude validation passed for the default built artifact, a custom artifact, and a copy in a fresh `CLAUDE_CONFIG_DIR/skills` directory. Claude reported all three GraphGoblin skills and one connected MCP server. The copy inspected the persisted run and disappeared from Claude's plugin inventory after removal. The artifact, Node executable, and MCP entry were each exercised at paths containing spaces and non-ASCII characters.
- **Draft state.** Namespaced design dispatch created, read, validated, and saved a draft. A stale token was rejected with `DRAFT_CONFLICT` (409), and REST confirmed the current draft name and token were preserved. A malformed definition returned 400. A disconnected graph returned structured issues and `publishable: false`. REST confirmed no published version and zero runs after design and after a start request lacking draft opt-in.
- **Run and inspection.** An explicit request with draft opt-in started exactly one provider-free run. The snapshot and terminal event returned `independent-result Ω:literal dollars and é`. Inspection retrieved nine consecutive events, including completed node execution, `run.finished` with `succeeded`, and `return.delivered`. REST confirmed one run and a still-unpublished draft.
- **Access and availability.** Missing and wrong keys returned 401. A read-only key could not create a draft and returned 403. Another owner received 404. After shutting down the disposable gateway, the plugin reported `NETWORK_ERROR`.
- **Path recovery and output ownership.** Claude reported a connection failure and displayed the configured missing Node path. Updating the runtime path restored the connection. With the MCP entry moved, Claude reported a closed connection and the guard emitted rebuild and reload guidance when invoked directly. Reassembly into the same owned destination reconnected to the built entry. An extra sentinel made reassembly fail and the original sentinel content was preserved. This is an integration check of the shared builder, whose separate ownership evidence belongs to #344.
- **Credentials and process cleanup.** The runner checked generated artifacts and child output for the disposable gateway credentials. A follow-up scan checked the retained observations and four files in the isolated Claude configuration. No credential match, running fixture process, or gateway lock was found. The isolated fixture configuration was supplied to all native Claude subprocesses.
- **Default MCP compatibility.** A separate SDK client compared complete tool descriptors. Candidate default stdio and candidate Streamable HTTP each matched all 14 baseline stdio descriptors. Opt-in stdio added exactly four draft tools. Combining HTTP and the draft flag exited with status 2. Public draft calls returned matching structured and text JSON, a schema validation failure, and an invalid-token refusal. REST again found no publication or run. This covers the default server contract used by the Codex plugin. Native Codex CLI behavior was outside these two runs.

Both independent drivers returned zero on their first execution. The earlier implementation harness retained an initialization failure while Claude was advertising `WaitForMcpServers`. The adapted transport explicitly waits through that native tool if Claude offers it. The [implementation evidence](../2026-11-14-claude-code-plugin/README.md) records the earlier attempts. Whole-workspace checks and review gates are tracked separately.

## Reproduce

Build both named checkouts with the repository-pinned pnpm and Node 22. Copy the two scripts into an external disposable evidence directory. They create scratch directories beside the scripts. Use the supported Claude executable from a shell with project-scoped Node v22.23.4 selected, and replace the three paths below with the checkout and evidence locations.

```powershell
$candidate = '<clean candidate checkout>'
$baseline = '<built main checkout>'
$evidence = '<external directory with the two scripts>'
$candidateHead = '55ca03b18deeb80a436943c3a8e39e8b5f4b7b0d'
$baselineHead = 'b3b5e1874a8252cc01c065d18fef42cbfbe075b4'
$env:GG_TEST_CLAUDE_BINARY = (Get-Command claude.exe).Source
node "$evidence/native-checks.mjs" $candidate $candidateHead
node "$evidence/mcp-wire-checks.mjs" $candidate $candidateHead $baseline $baselineHead
```

[Native observations](observed.json), [MCP wire observations](observed-mcp.json), [exit statuses](exit-codes.json), and [cleanup readback](cleanup.json) record the exact steps, build hashes, responses, and fixture process IDs. The probes used ephemeral loopback ports and disposable configuration and stores.
