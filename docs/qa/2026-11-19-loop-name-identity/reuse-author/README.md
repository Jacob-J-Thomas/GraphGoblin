# #472 deletion and equivalent loop-name reuse

Intent 2, unit U2.4 adds one regression to `apps/api/src/loop-names.test.ts` for existing behavior. The coordinator ran the API suite on base `d3f651c83779ded401878094d35374ac2f494d3d` with the new test applied. The test file in the combined source `14a84a180495b65e0788994b25974d05a2b94ca7` is byte-for-byte identical to the file identified in the execution receipt. The #472 change only adds a test.

## What the test verifies

The normal Fastify test app serves the public HTTP handlers through request injection and uses an isolated temporary store. One owner creates `X` and a separate loop named `Kept Name`. A second owner creates equivalent `x` in the same store and both owners receive HTTP 404 when reading the other's original loop. The first owner deletes `X` with HTTP 204 and reads the old ID as HTTP 404 with `LOOP_NOT_FOUND`. Creating `x` returns HTTP 201 with a new ID distinct from both original IDs. The replacement loop and draft retain the submitted spelling.

Creating `kept  NAME` returns HTTP 409 with `LOOP_NAME_CONFLICT` because the first owner's separate loop still holds the equivalent name. HTTP readbacks preserve that loop and draft, the replacement, and the second owner's loop and draft. Only the disposable credential for the second owner is provisioned through a fixture. All loop operations use the HTTP handlers.

## Authorship and execution

The first GPT 6 Luna session at xhigh produced a report, but its local process launcher failed before it could read the repository, change the test or run checks. The outer CLI exited zero despite the tool failure. The source-only retry used the same model and reasoning setting with the exact committed API suite and excerpts of the delete route and auth semantics. The retry returned structured test source and reported that it had not executed the test.

The coordinator applied Luna's test and moved its duplicate-name check from the newly reused name to the separate pre-existing active loop. The coordinator added the active loop and draft readback and ran the local checks. The committed base suite is a verbatim prefix of the combined file. The rest is one separator newline followed by the applied test.

## Local results and limits

On Windows with Node 22.23.4 and pnpm 12.8.1, the API build passed, the targeted Vitest file passed all eight tests, API typecheck and lint passed, and the test file passed Prettier. Turbo reused six upstream build results. The API build, typecheck and lint ran on cache misses. [Output excerpts](results.txt) and the [manifest](manifest.json) record the selected lines, command arguments, exit codes and source hashes.

These results cover the API regression on the base plus the applied test. They carry no whole-repository coverage, networked gateway QA, independent approval, exact combined-head CI or final audit credit. Independent verification and delivery gates are tracked separately.

## Publication edits

The excerpts retain verbatim lines and the exact launcher error text, with headings added for context. The two build and gate sections omit the cache IDs from the three cache-miss lines. The excerpts omit local paths, personal account identifiers, temporary store locations, authentication material, provider events, prompts and full transcripts. The manifest contains selected metadata and SHA-256 digests for original evidence and public files. The digest listed for each complete local log was recomputed before selecting its excerpt.
