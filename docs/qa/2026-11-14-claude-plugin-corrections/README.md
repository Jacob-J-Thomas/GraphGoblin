# Claude plugin correction verification

This record preserves focused verification for the Claude plugin correction and its integration with the shared output-metadata fix. Code under test is merge commit `e3d41de132f8908cfd90691939267db09f6088f0`; the child correction is commit `38fab562d24a255574c0274e0e60c069df54f454`, merged with parent builder correction `1757c666ae3e64d46c14b52dfd895f53f4625b89`.

The assembled artifact was written to the assigned disposable external batch output `plugin-463-corrections`. Its generated MCP configuration points back to this worktree's built MCP entry. The artifact is a verification fixture, not a portable release.

## Results

- Claude plugin coverage: 8 tests passed; 95% lines, 95.23% branches, 100% functions.
- Claude plugin typecheck, lint, and targeted Prettier check passed.
- Shared output builder tests passed: 20 `plugin-output.test.mjs` cases and 14 `plugin-output-metadata.test.mjs` cases. The former includes a stream arriving during quarantine.
- Through the public Claude `assemble` command, a synthetic NTFS named stream on the generated `README.md` caused refusal. The README SHA-256 remained `11869703136ce0400a4571305fc0f1e8d5cf4ed00d2861c6da020f7190f0ba1d`, and the exact stream payload remained readable. After removing only the test-created stream, the public CLI rebuilt successfully and all seven generated file hashes matched the ownership manifest.
- `claude plugin validate --strict` passed. It reported a missing-icon warning; its marketplace-install suggestion is advice for distributing the local plugin and is not required for this artifact.

The refusal and recovery transcript is in [claude-public-assemble-ads.log.txt](claude-public-assemble-ads.log.txt). Other command transcripts are linked below.

## Runtime guard evidence

The supported floor, refusal just below the floor, other major versions, malformed metadata, and missing-entry cases run in child processes with stubbed `process.versions.node`. Those version values are simulations; the child host was the installed Node v22.23.4. The cases are explicit in [plugin.test.ts](../../../apps/plugin-claude/src/plugin.test.ts).

Separately, the generated config's default command is `${GG_NODE_BINARY:-node}`. With `GG_NODE_BINARY` absent, `node` from project PATH resolved to the same executable as the Node process running the tests: v22.23.4. The final assembled guard accepted that native runtime and the actual built MCP entry path. The guard stat-checked the entry but did not execute the MCP server. No old Node binary, Claude session, gateway request, or model call was used.

See [native-runtime.log.txt](native-runtime.log.txt) and the [Claude plugin coverage log](claude-plugin-coverage.log.txt).

## Manifest provenance and merge correspondence

[hash-correspondence.json](hash-correspondence.json) records the assembled-output inventory and Git blob identities. The raw source plugin manifest and assembled plugin manifest are retained as [source-plugin-manifest.json](source-plugin-manifest.json) and [assembled-plugin-manifest.json](assembled-plugin-manifest.json); both have SHA-256 `b784b847485520ad0250cae44e3706cf8b5e6589ccd9b8860d99fa2b84b9aa38`. The output ownership manifest is retained byte-for-byte as [output-ownership-manifest.json](output-ownership-manifest.json); its SHA-256 is `548ab0c867b98cfe88da569d602200773c248af6ac88b7b6e2336baa8e939863`. Its `.claude-plugin/plugin.json` inventory digest matches both manifest copies.

Git blob IDs prove that `AGENTS.md` and all five files under `apps/plugin-claude` changed by the child correction are byte-identical between `38fab562` and the integrated merge. The only post-`38fab562` edits to `docs/guide/05-mcp-and-codex-plugin.md` and `docs/07-api-and-streaming.md` are the parent commit's output-metadata documentation paragraphs; the child draft-run correction remains intact.

The shared fix's independent Windows and macOS boundary coverage is recorded in [plugin-builder metadata independent QA](../2026-11-14-plugin-builder-metadata-independent/README.md). This child record adds a public Claude CLI integration case against the external output.

## Failures and limits

[initial-failures.log.txt](initial-failures.log.txt) retains the first typecheck and lint failures and their disposition. A broad tooling selector emitted no results for about two minutes and was interrupted; rerunning its two named test files passed. A whole-merge `git diff --cached --check` also flagged CRLF whitespace in inherited raw QA JSON/MJS and the upstream JSONata patch. Those evidence bytes were preserved; scoped checks of the resolved docs and Claude plugin files passed.

The native public-CLI metadata check was Windows on NTFS. Cross-platform and adversarial evidence belongs to the independent parent QA record. Live Claude behavior is assigned to a separate QA agent. No full root suite, browser suite, or full application run was performed in this correction pass.

## Command logs

- [Plugin typecheck](claude-plugin-typecheck.log.txt)
- [Plugin lint](claude-plugin-lint.log.txt)
- [Formatting](format-check.log.txt)
- [Shared public-builder tests](tooling-plugin-output.log.txt)
- [Shared metadata protocol tests](tooling-plugin-output-metadata.log.txt)
- [Strict Claude plugin validator](strict-validator.log.txt)
