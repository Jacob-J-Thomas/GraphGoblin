# Broad gate failures

These are retained failures, not waived gates. D-015 labels only the native termination/cleanup group; conversion and scope/template timeouts remain separately unresolved.

## infrastructure-coverage-final.log.txt

```text
 FAIL  src/adversarial.test.ts > adversarial infrastructure invariants (forks pool) > 6/QA-LIMIT-001: ProcessScripts
abort kills a real child and its grandchild
Error: Test timed out in 30000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/adversarial.test.ts:225:3
    223|     expect(() => decryptSecret(Buffer.alloc(32, 5), ciphertext as stri…
    224|   });
    225|   it('6/QA-LIMIT-001: ProcessScripts abort kills a real child and its …
       |   ^
    226|     const dir = await mkdtemp(join(tmpdir(), 'gg-process-tree-'));
    227|     const pidFile = join(dir, 'grandchild.pid');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/16]⎯

 FAIL  src/claude/process.test.ts > owned native Claude process transport > kills on deadline and output overflow
Error: EBUSY: resource busy or locked, rmdir '%USERPROFILE%\AppData\Local\Temp\gg-claude-process-bu6fbK'
```

```text
 FAIL  src/claude/process.test.ts > owned native Claude process transport > kills on deadline and output overflow
Error: EBUSY: resource busy or locked, rmdir '%USERPROFILE%\AppData\Local\Temp\gg-claude-process-bu6fbK'
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/16]⎯

 FAIL  src/claude/process.test.ts > owned native Claude process transport > does not spawn for an already aborted
signal and cancels a running process
Error: EBUSY: resource busy or locked, rmdir '%USERPROFILE%\AppData\Local\Temp\gg-claude-process-P2mcvO'
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/16]⎯

 FAIL  src/claude/process.test.ts > owned native Claude process transport > kills the descendant that a long-lived
child started
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' //
Object.is equality

Expected: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
Received: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

```text
 FAIL  src/claude/process.test.ts > owned native Claude process transport > does not spawn for an already aborted
signal and cancels a running process
Error: EBUSY: resource busy or locked, rmdir '%USERPROFILE%\AppData\Local\Temp\gg-claude-process-P2mcvO'
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/16]⎯

 FAIL  src/claude/process.test.ts > owned native Claude process transport > kills the descendant that a long-lived
child started
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' //
Object.is equality

Expected: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
Received: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

 ❯ src/claude/process.test.ts:146:46
    144|       const stopped = await readFile(marker, 'utf8');
    145|       await new Promise((resolve) => setTimeout(resolve, 100));
```

```text
 FAIL  src/claude/process.test.ts > owned native Claude process transport > kills the descendant that a long-lived
child started
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' //
Object.is equality

Expected: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
Received: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

 ❯ src/claude/process.test.ts:146:46
    144|       const stopped = await readFile(marker, 'utf8');
    145|       await new Promise((resolve) => setTimeout(resolve, 100));
    146|       expect(await readFile(marker, 'utf8')).toBe(stopped);
       |                                              ^
    147|     } finally {
    148|       controller.abort();

```

```text
 FAIL  src/claude/process.test.ts > owned native Claude process transport > kills the descendant that a long-lived
child started
Error: EBUSY: resource busy or locked, rmdir '%USERPROFILE%\AppData\Local\Temp\gg-claude-process-VrdQPu'
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/16]⎯

 FAIL  src/claude/readiness.test.ts > Claude no-turn executable boundary > hang reports unknown without exposing CLI
bodies
AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]

- Expected
+ Received

  [
    "Claude CLI did not answer before the check deadline. Check that the Claude CLI starts and responds, then retry
preflight.",
+   "Claude CLI check process did not confirm that it stopped. Check that the Claude CLI starts and responds, then
```

```text
 FAIL  src/claude/readiness.test.ts > Claude no-turn executable boundary > hang reports unknown without exposing CLI
bodies
AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]

- Expected
+ Received

  [
    "Claude CLI did not answer before the check deadline. Check that the Claude CLI starts and responds, then retry
preflight.",
+   "Claude CLI check process did not confirm that it stopped. Check that the Claude CLI starts and responds, then
retry preflight.",
  ]

 ❯ src/claude/readiness.test.ts:62:31
     60|         hang: ['Claude CLI did not answer before the check deadline.' …
```

```text
 FAIL  src/process/scripts.test.ts > ProcessScripts > kills and closes a real process cancelled with incomplete UTF-8
pending on both streams
AssertionError: native process-tree cancellation must finish before fixture cleanup: expected true to be false //
Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/process/scripts.test.ts:194:7
    192|       cleanupRequired,
    193|       'native process-tree cancellation must finish before fixture cle…
    194|     ).toBe(false);
       |       ^
```

```text
 FAIL  src/process/scripts.test.ts > ProcessScripts > kills the process tree on timeout
Error: Test timed out in 15000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/process/scripts.test.ts:237:3
    235|   });
    236|
    237|   it('kills the process tree on timeout', async () => {
       |   ^
    238|     const scripts = new ProcessScripts();
    239|     const started = Date.now();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/16]⎯

 FAIL  src/process/scripts.test.ts > ProcessScripts > kills the process when the signal aborts, including when already
aborted
Error: Test timed out in 15000ms.
```

```text
 FAIL  src/process/scripts.test.ts > ProcessScripts > kills the process when the signal aborts, including when already
aborted
Error: Test timed out in 15000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/process/scripts.test.ts:248:3
    246|   }, 15_000);
    247|
    248|   it('kills the process when the signal aborts, including when already…
       |   ^
    249|     const scripts = new ProcessScripts();
    250|     const controller = new AbortController();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/16]⎯

 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary queued runs without cancelling
them
```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary queued runs without cancelling
them
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary running runs without
cancelling them
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary waiting runs without
cancelling them
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary paused runs without cancelling
them
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:205:54
    203|     expect(await snapshot(handle.client)).toEqual(before);
    204|   });
    205|   it.each(['queued', 'running', 'waiting', 'paused'])(
       |                                                      ^
    206|     'blocks ordinary %s runs without cancelling them',
```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary running runs without
cancelling them
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary waiting runs without
cancelling them
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary paused runs without cancelling
them
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:205:54
    203|     expect(await snapshot(handle.client)).toEqual(before);
    204|   });
    205|   it.each(['queued', 'running', 'waiting', 'paused'])(
       |                                                      ^
    206|     'blocks ordinary %s runs without cancelling them',
    207|     async (status) => {

```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary waiting runs without
cancelling them
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary paused runs without cancelling
them
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:205:54
    203|     expect(await snapshot(handle.client)).toEqual(before);
    204|   });
    205|   it.each(['queued', 'running', 'waiting', 'paused'])(
       |                                                      ^
    206|     'blocks ordinary %s runs without cancelling them',
    207|     async (status) => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/16]⎯

```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks ordinary paused runs without cancelling
them
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:205:54
    203|     expect(await snapshot(handle.client)).toEqual(before);
    204|   });
    205|   it.each(['queued', 'running', 'waiting', 'paused'])(
       |                                                      ^
    206|     'blocks ordinary %s runs without cancelling them',
    207|     async (status) => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/16]⎯

 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks a pending ordinary receipt and its
frozen admission intent
```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > blocks a pending ordinary receipt and its
frozen admission intent
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:220:3
    218|     },
    219|   );
    220|   it('blocks a pending ordinary receipt and its frozen admission inten…
       |   ^
    221|     const handle = await fixture();
    222|     await handle.client.execute(

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/16]⎯

 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > requires every hash-bound review, binds
repeated nodes to their stored version, and rejects stale/unused resolutions
```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > requires every hash-bound review, binds
repeated nodes to their stored version, and rejects stale/unused resolutions
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:230:3
    228|     await refuses(handle, await request(handle), /admission intents/);
    229|   });
    230|   it('requires every hash-bound review, binds repeated nodes to their …
       |   ^
    231|     const handle = await fixture();
    232|     const definition = frozenDefinition('llm', {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/16]⎯

 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > refuses changed source, damaged SQL/ledger,
malformed template identities and invalid definitions
```

```text
 FAIL  src/sqlite/upgrade.test.ts > definitions-only format-4 cutover > refuses changed source, damaged SQL/ledger,
malformed template identities and invalid definitions
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/sqlite/upgrade.test.ts:302:3
    300|     expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    301|   });
    302|   it('refuses changed source, damaged SQL/ledger, malformed template i…
       |   ^
    303|     const handle = await fixture();
    304|     const selected = await request(handle);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/16]⎯


 Test Files  5 failed | 47 passed (52)
```

Test Files 5 failed | 47 passed (52)

      Tests  15 failed | 765 passed (780)

## targeted-verified.log.txt

```text
 FAIL  src/adversarial.test.ts > adversarial API invariants > ADV-008: every advertised route against every scope
Error: Test timed out in 20000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/adversarial.test.ts:178:3
    176|   };
    177|
    178|   it('ADV-008: every advertised route against every scope', async () =…
       |   ^
    179|     const t = await app({ requireApiKey: true });
    180|     const scopes = [...new Set(Object.values(ROUTE_SCOPES))];

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 57 passed (58)
```

Test Files 1 failed | 2 passed (3)

      Tests  1 failed | 57 passed (58)

## client-coverage-standalone.log.txt

```text
 FAIL  src/templates.test.ts > creates an ordinary editable draft with the generated client without automation setup
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/templates.test.ts:19:1
     17| }
     18|
     19| it('creates an ordinary editable draft with the generated client witho…
       | ^
     20|   const client = await setup();
     21|   app!.harness.preflightResult = {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  src/templates.test.ts > creates an ordinary editable draft with the generated client without automation setup
 FAIL  src/templates.test.ts > reads manifest-only catalogue entries through the generated API
Error: Hook timed out in 10000ms.
```

```text
 FAIL  src/templates.test.ts > creates an ordinary editable draft with the generated client without automation setup
 FAIL  src/templates.test.ts > reads manifest-only catalogue entries through the generated API
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ src/templates.test.ts:7:1
      5|
      6| let app: TestApp | undefined;
      7| afterEach(async () => {
       | ^
      8|   await app?.close();
      9|   app = undefined;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  src/templates.test.ts > reads manifest-only catalogue entries through the generated API
Error: Test timed out in 5000ms.
```

```text
 FAIL  src/templates.test.ts > reads manifest-only catalogue entries through the generated API
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ src/templates.test.ts:7:1
      5|
      6| let app: TestApp | undefined;
      7| afterEach(async () => {
       | ^
      8|   await app?.close();
      9|   app = undefined;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  src/templates.test.ts > reads manifest-only catalogue entries through the generated API
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
```

```text
 FAIL  src/templates.test.ts > reads manifest-only catalogue entries through the generated API
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ src/templates.test.ts:45:1
     43| });
     44|
     45| it('reads manifest-only catalogue entries through the generated API', …
       | ^
     46|   const client = await setup();
     47|   const entries = await templates.list(client);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯


 Test Files  1 failed | 7 passed (8)
      Tests  2 failed | 70 passed (72)
```

Test Files 1 failed | 7 passed (8)

      Tests  2 failed | 70 passed (72)
