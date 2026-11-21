# Initial read-only inspection attempts

All commands selected the project Node runtime where Node was invoked; node --version returned v22.23.4. git status --short was empty; HEAD 55c9a5497f9e4a6e7f9ebeaa29283e3898170683.

Attempted Get-Content packages/adapter-codex/fixtures/sdk-schema-case.mjs failed: Cannot find path ... because it does not exist. Parent corrected ownership to existing packages/adapter-codex/src/fixtures/sdk-schema-case.mjs before edits.
Attempted Get-Content packages/adapter-codex/eslint.config.mjs failed: file does not exist.
Attempted rg node_modules/.pnpm/@openai+codex-sdk@0.160.0*/node_modules/@openai/codex-sdk/dist/index.js failed: filename/directory syntax error 123 (PowerShell wildcard in literal rg argument). Corrected lookup uses package symlink.
Attempted Get-Content eslint.config.mjs and tooling/vitest.mjs failed: files do not exist. Correct files are eslint.config.js and tooling/vitest.shared.mjs.
Attempted createRequire(...).resolve('@openai/codex-sdk') failed ERR_PACKAGE_PATH_NOT_EXPORTED: SDK exposes import-only entry. The actual installed dist/index.js was read directly through the package symlink instead.

Required reads completed: AGENTS.md; docs/README.md; docs/12-implementation-plan.md first 100 lines; docs/15-issue-workflow.md; delivery register; decision-190.md; complete final scan3 REPORT.md and marker-race-source.json; all three original fixtures/test; package.json; shared Vitest config. No mutation occurred during these attempts.
