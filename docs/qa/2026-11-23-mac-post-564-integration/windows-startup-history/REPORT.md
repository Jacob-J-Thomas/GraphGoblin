Finding1 has earlier Windows execution evidence, with a precise source qualification. No full `main.test.ts` Windows run using the exact current file was found. The Windows-specific branch bodies did run and pass in D237; their source and runtime dependency sources remain unchanged. A later run at the exact current apps/api tree passed only the D238-corrected shared-database case. Neither record is a new current-head full-file pass or authority to run main.test locally.

The actual D237 command in `D237-startup.exit.json` was:

```text
pnpm.cmd --filter @graphgoblin/api exec vitest run --reporter=verbose src/main.test.ts src/main-entry.test.ts src/serve.test.ts src/serve-failure-output.test.ts src/gateway-logger.test.ts
```

It closed exit0 at 2026-11-23 02:20:12–02:21:31UTC under Node22.23.4. Its copied raw stdout and original stream digest agree. The five-file group passed55 and platform-skipped6; main.test itself passed15 and platform-skipped6:

| main.test group | Passed | Platform-skipped |
|---|---:|---:|
| Reserved Windows variable / built entry | 3 | 1 non-Windows-only case |
| Physical Mac entry | 1 Windows/non-Darwin consumption case | 1 Darwin-only case |
| Startup failures | 11 | 1 POSIX-filename case |
| Linux native shutdown | 0 | 3 Linux signal cases |

The passed raw names include the managed private-log test covering unsafe-folder exit71 and competing-owner exit70, the CLI-variable consumption case, and “consumes the Mac variable and preserves ordinary shell startup elsewhere.” These are executed Windows evidence rather than the six skipped cases. The often cited296 passed/27 skipped is the sum of three groups: ownership119/18, startup55/6, log adapters122/3. It is not the main.test count. READBACK.json lists all21 main.test outcomes and each group's literal command/receipt/stream pins.

The author run occurred before root committed e216 at02:25. The author's final edited lock and lock-test pins match that freeze. Comparing immutable e216 to currentd913 across **all** apps/api, packages, tooling, lockfile, root package/workspace/Turbo/TS configs and patches finds exactly one changed path: `apps/api/src/main.test.ts`. The complete delta adds the realpath import and canonicalizes the shared-database assertion with `await realpath(database)`. No runtime API, shared log writer, startup fixture or workspace dependency source changed. The complete Windows/Mac-variable describe groups are byte-identical; specific startup/guard/shared-writer hashes and root objects are recorded, rather than relying on a global carry boolean.

The earlier apps/api tree is `19c59f8b5bf773d62f0e1e81678ef3673e4f0430`; b7,638 and currentd913 all have tree `28e37f32affab301d42348dc61e6dba934118fa1`. Thus the entire old API tree is not identical because of the test correction. `main.test.only-delta.patch` preserves the exact difference. The earlier author capture does not contain a complete precommand API/dist inventory, so object comparison to the subsequent freeze is source-based qualification, not a retrospective full runtime attestation.

The independently captured D238 positive at b7 ran the corrected existing shared-database case on Windows using an owned junction and the same public built entry. Its actual receipt closed0 at03:44:25–03:44:37UTC: **1 passed,20 filtered**, not20 platform passes/skips. The controlled worker applied `GG_OLLAMA_ENABLED=false` only to each verified owned API child, restored TEMP/TMP, and recorded all three children closed and both fixture directories absent. The older expected-path failure and initial zero-active selection mistake remain in their original packet. The current built main entry is3311 bytes, SHA256 `77340d74ad07bebe5875984fee0c92cbeac57afff13585a9bbe7fb3ab62c219c`, matching the actual D238 entry pin. This is not a digest of every earlier built module or installed dependency.

Suggested record wording: “No fresh Windows main.test batch was run at the integrated head. D237's earlier Windows run executed15 cases including managed-log71/70 and cross-platform variable handling, with6 platform skips. Those branch bodies and runtime/dependency sources are unchanged; the sole later API change is D238's two-line canonical-path test correction, separately passed as one controlled Windows case at an API tree identical to this candidate.”

The D237 run predates the later provider-isolation concern and supplies no packet trace or proof that every child had discovery disabled. Do not retrospectively call it isolated or infer absence of contact with the owner's listener. D243 remains in force. This reconciliation ran no tests, provider, network, browser or GUI and changed no repository/index/runtime source. It addresses only finding1's historical record; current hosted seven-job proof, native Mac/device QA, final AstraMAX and owner acceptance remain separate.
