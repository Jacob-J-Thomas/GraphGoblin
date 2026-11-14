# #237 unknown publication retry after a local refusal

**Confirmed on the first native browser attempt.** An intervening refused Publish clears the required readback on the next explicit Publish. In this fixture, the extra request returned `409 NO_DRAFT` and the original immutable version stayed intact.

## Observed sequence

1. The built gateway admitted a real Publish at HTTP 200. The browser harness withheld its response after upstream commit and failed the direct detail readback as well as the background refresh. The editor said **Publish not confirmed** and **Publish again checks the server first**. An independent HTTP GET proved version 1 was already current, with the exact original saved graph and no remaining draft.
2. A real keypress inserted `[` into the Variables JSON input. An explicit Publish showed **Publish failed** and correctly emitted zero detail GET, draft PUT, or publish POST. The visible held buffer and unchanged public definition were both recorded. The device draft lookup returned no entry throughout because the fixture started as an accepted clean draft and the malformed buffer never became a definition edit.
3. **Discard the unparsed text** restored the exact earlier Variables editor text. One background detail GET returned 200 during discard. The visible **Publish failed** notice still reflected the refusal. Independent readback proved the immutable version, graph, and token were unchanged. Discard emitted no write.
4. The next explicit Publish began with **POST**, which reached the gateway and returned `409 NO_DRAFT`. Two detail GETs returned HTTP 200 after that POST. Only then did the editor say **Nothing to publish: version 1 already holds this draft**. As promised by the original unknown-outcome notice, the explicit action should settle the exact acknowledged publication with a readback before deciding whether any POST is necessary. The observed extra POST created no version, and no duplicate or data loss occurred.

Source lineage supports the wire observation. In `usePublish.ts`, `start` derives `checkFirst` from the current mutation result. `publishAttempt` can throw for held input before entering its queued readback, and the most recent local refusal replaces the mutation result. A background detail query during discard does not go through the attempt's readback/identity check. The fixture does not assert what a competing writer would cause.

## Identity and tier

- Frozen branch head `9e44bd74bfc40adcc872f8f8a3724c2e2840f378`, tree `2d2b60b9a1ef9f8d015fe3758204715c86ea3288`, target `7c6e635539e12c56b82f226f1ee734d83b985ad4`. Parent source and all 25 listed files match the retained precommit proof. All 1,227 files across 13 distribution directories matched the worker manifests and recorded build hashes before and after the run.
- Actual Windows Edge via the isolated Playwright CLI session, 1280 × 900, service workers blocked. The page loaded `index-DK8I-ydH.js`, SHA-256 `34d23072a825f542b3b3d52922be37afe825b07715e9ab30debf282eefb801fc`. The bundle map embeds the exact frozen Publish source. Gateway checked served HTML/JS/CSS byte hashes. Node v22.23.4 ran the built API's `dist/main.js`, SHA-256 `e011151e143f07f29181c03f616b6d8e5b7c04e1f136f001b508e9a480c8cc98`, with disposable file SQLite and ephemeral loopback. No provider calls or owner data were used. The console recorded the post-commit reply abort, two GET aborts, the unexpected HTTP 409 and the configured service-worker warnings. Uncaught page errors and fixture assertion failures were zero.
- The first launcher invocation failed before starting any gateway because its copied argument offsets read the source list as the binding report. The preflight error was retained and the offsets corrected. A subsequent gateway-only launch closed on EOF before any browser opened. The orchestrated browser scenario then ran once. Cleanup verified all recorded PIDs exited, both listener ports were unbound, and the stores held only their disposable database and generated master key files. No lock or SQLite WAL/SHM remained. Store files and values are outside this evidence proposal.

[Exact observed requests, versions and UI](observed.json) · [Independent build binding](binding-before.json) · [Served bytes](gateway.json) · [Cleanup](cleanup.json) · [First launcher preflight failure](gateway-first-preflight.log)

[Unknown outcome](01-unknown.png) · [Local refusal](02-local-refusal.png) · [Fresh explicit retry](03-fresh-retry.png)

## Reproducing

Use the frozen checkout and existing worker build manifests. Keep the binding scripts in the external batch evidence directory beside the retained root and worker build metadata. Run `node bind.mjs <worktree> binding-before.json` and `node run-native.mjs <worktree> <installed-playwright-cli-entry>` on Node 22.23.4. The launcher uses the existing cached CLI and records owned cleanup. The script returns a structured `finding` independently of the CLI process status. Re-run the binding after the browser and gateway close. Rebind the source and bundle for a corrected head before repeating the behavior.

The broader five-group independent #237 verification stopped after this confirmed diagnostic. The earlier cross-generation pending-button hypothesis remains a separate undispatched behavior check.
