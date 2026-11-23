# Corrected inspector verification preparation

The runner is unarmed. `BINDING.template.json` supplies the schema, with admission false and the correction evidence and source hashes unset. After root verifies the actual Opus closure and allocates the heavy slot, bind the four public closure files and all 15 author paths in `BINDING.json`. The runner checks those exact bytes against the checkout and the pinned initial 6924 freeze. It separately records the corrections present before validation and any formatting performed during validation.

Node v22.23.4 and pnpm 12.8.1 run web typecheck, ESLint over the 13 changed TypeScript paths, and a Prettier check over all 15 original author paths. When formatting is the sole failure, the runner retains the original 15 files, performs the authorized formatter write on those paths, saves the delta and rechecks.

Passing static results admit the same 11 focused Vitest files with one worker, no retries and existing timeouts. The runner retains the raw streams and JSON, verifies the prior 164 test identities and reports any added cases. It preserves the checkout index, lockfile, modules metadata, protected provenance files and common-index absence in the before and after snapshots. It invokes no Git command, broader coverage, build, or browser QA.

Preparation verification was a Python AST parse. The runner has not executed.
