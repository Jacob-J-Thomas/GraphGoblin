# Web editor test stability: baseline

This is the original round 1 baseline. See [round2.md](round2.md) for the audit
reproductions on `67c84088` and the follow-up measurements.

Measured on 2026-10-22 in `codex-chore-web-test-stability`, clean baseline
`39705dd7e961cf64e48cf7c66275774ec2b5e958`, Windows, Node **v22.14.0**,
12 available logical processors. No retries were enabled.

## Controlled load and command

A separate Node process ran three worker threads throughout the coverage command.
Each thread continuously executed this loop:

```js
for (;;) {
  let n = 0;
  for (let i = 0; i < 1000000; i++) n += Math.sqrt(i);
}
```

The complete load script ([gg-chore-web-load.cjs](gg-chore-web-load.cjs)) is:

```js
const { Worker } = require('node:worker_threads');
const workers = Array.from(
  { length: 3 },
  () =>
    new Worker('for (;;) { let n = 0; for (let i = 0; i < 1000000; i++) n += Math.sqrt(i); }', {
      eval: true,
    }),
);
setTimeout(() => workers.forEach((worker) => worker.terminate()), 30 * 60 * 1000);
```

The load process was started before pnpm and stopped in `finally` after pnpm
exited. Its threads also have a 30-minute termination limit. Coverage used its
normal worker count; no `maxWorkers`, timeout or coverage-policy overrides:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd --filter @graphgoblin/web test:coverage --reporter=verbose
```

The PowerShell runner starts that script with Node 22 and `Start-Process
-WindowStyle Hidden -PassThru`, invokes pnpm in the current worktree and calls
`Stop-Process -Id $load.Id` in `finally`. Each verification invocation gets its
own three-thread load process; the script's 30-minute bound is only recovery for
an abandoned runner, not a test timeout. Completed load PIDs were checked and
were no longer running.

Retained log: [gg-chore-web-before.log.txt](gg-chore-web-before.log.txt) (the initial logger mixed text
encodings; its Vitest output is UTF-16LE). Later logs use UTF-8 consistently.

## Result: reproduced

```text
FAIL src/editor/TriggerEditor.test.tsx > edits authentication, body and extraction by keyboard with one-step undo and field validation
Error: Test timed out in 20000ms.
src/editor/TriggerEditor.test.tsx:241:1
Test Files  1 failed | 115 passed (116)
Tests       1 failed | 1473 passed (1474)
Duration    397.32s
```

pnpm exited **1**; measured command wall time was **399.944 s**. No coverage
summary was emitted. This is a reproduced test deadline failure, not evidence of
a product race. The other reported failures were near-budget or passed in this
particular run; the historic EditorPage worker-start timeout was not reproduced.

| Named test / parameter                          | Baseline under load (ms) |
| ----------------------------------------------- | -----------------------: |
| Trigger preset: issues-poll                     |                    11022 |
| Trigger preset: issues-labeled                  |                    12668 |
| Trigger keyboard authentication/body/extraction |       **20176, timeout** |
| New default decision: expression                |                     2714 |
| New default decision: llm                       |                     9938 |
| New default decision: classifier                |                    15500 |
| Edit valid decision: expression                 |                     2480 |
| Edit valid decision: llm                        |                     3024 |
| Edit valid classifier: choice                   |                     3180 |
| Edit valid classifier: noul                     |                     3073 |
| Edit valid classifier: score                    |                     4026 |
| Switch decision kinds and source focus          |                    12704 |
| Advanced disclosure through undo/redo           |                    19362 |

## Time-sink investigation

Both dialog helpers rendered the whole routed app. Store-backed form and graph
edits therefore also drove the canvas, toolbar, page validation and related
queries, although the assertions exercised the node dialog, store and autosave.
Preset setup fields use local state, but still processed every character as a
separate UI edit. The default classifier
authoring case additionally typed 45 criteria characters as separate edits.
Preset setup typed every owner, repository, label and signing-secret character.
The Advanced case has no long text entry: repeated whole-page updates and form
remounts around keyboard undo/redo account for its heavy work.

A diagnostic copy of the unchanged keyboard test wrapped only user-event methods
to measure elapsed time, with the same three load threads but without coverage.
It passed in 6713 ms; the event calls totaled 5029 ms. The three `type` calls alone
took **589 + 953 + 250 = 1792 ms**. Selects, body radios and undo/redo took the
remaining event time; mounting, queries and assertions occupied the rest.
This diagnostic ran alongside the initial component investigation, so its timing
is attribution evidence, not a matched coverage comparison. Raw diagnostic log:
[gg-chore-web-event-profile.log.txt](gg-chore-web-event-profile.log.txt). The diagnostic test copy was removed.

An earlier attempted V8 CPU-profile invocation emitted no profile artifact; its
single unchanged case passed in 15446 ms while the baseline suite was still
running. That was diagnostic work, not a retry counted as a passing gate.

The first component-harness check reduced the cases substantially but exposed
two fixture defects: it had omitted API contract defaults (`outcome: success`
and manual `exposeTo`). Both original assertions failed and were kept. The
harness now parses the draft with the public contract before loading the store,
matching the API client's read. No product code was changed.

See [after.md](after.md) for the final verification matrix and matched timings.
