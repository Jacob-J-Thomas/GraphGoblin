# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: script-recovery.browser.ts >> a real interrupted script explains its effect and only Resume repeats it (#321)
- Location: e2e\script-recovery.browser.ts:38:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-status="succeeded"]')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('[data-status="succeeded"]') with timeout 15000ms
  - waiting for locator('[data-status="succeeded"]')

```

```yaml
- banner:
    - text: GraphGoblin
    - navigation "Main":
        - link "Loops":
            - /url: /app/loops
        - link "Runs":
            - /url: /app/runs
        - link "Events":
            - /url: /app/events
        - link "Settings":
            - /url: /app/settings
- banner:
    - heading "Run 01M5GR4GBSD0T2BVJDXKX5PHHC" [level=1]
    - text: running at script
    - link "loop":
        - /url: /app/loops/01M5GR4G8WQ6DD23GDETM11FJM/edit
    - link "child runs":
        - /url: /app/runs?parent=01M5GR4GBSD0T2BVJDXKX5PHHC
    - button "Pause"
    - button "Cancel run"
- region "Timeline (9 events, complete)":
    - heading "Timeline (9 events, complete)" [level=2]
    - list "Timeline":
        - listitem:
            - button "#1 run.queued":
                - text: '#1'
                - code: run.queued
        - listitem:
            - button "#2 run.started attempt 1":
                - text: '#2'
                - code: run.started
                - text: attempt 1
        - listitem:
            - button "#3 node.started start (trigger) attempt 1":
                - text: '#3'
                - code: node.started
                - text: start (trigger) attempt 1
        - listitem:
            - button "#4 node.finished start → out, 2 changes, 0 ms":
                - text: '#4'
                - code: node.finished
                - text: start → out, 2 changes, 0 ms
        - listitem:
            - button "#5 node.started script (script) attempt 1":
                - text: '#5'
                - code: node.started
                - text: script (script) attempt 1
        - listitem:
            - 'button "#6 script.dispatched script: script dispatch 01M5GR4GTE3NAVQ2MPY4DHZ63C (visit 01M5GR4GBSD0T2BVJDXKX5PHHC:5)"':
                - text: '#6'
                - code: script.dispatched
                - text: 'script: script dispatch 01M5GR4GTE3NAVQ2MPY4DHZ63C (visit 01M5GR4GBSD0T2BVJDXKX5PHHC:5)'
        - listitem:
            - button "#7 run.started attempt 2":
                - text: '#7'
                - code: run.started
                - text: attempt 2
        - listitem:
            - button "#8 node.started script (script) attempt 2":
                - text: '#8'
                - code: node.started
                - text: script (script) attempt 2
        - listitem:
            - 'button "#9 run.failed SCRIPT_OUTCOME_UNCERTAIN: The previous script attempt may already have produced its effect. Its outcome was not recorded. Resume runs the script again and may repeat that effect; Replay starts a new run from this node."':
                - text: '#9'
                - code: run.failed
                - text: 'SCRIPT_OUTCOME_UNCERTAIN: The previous script attempt may already have produced its effect. Its outcome was not recorded. Resume runs the script again and may repeat that effect; Replay starts a new run from this node.'
- region "Thread at event 9":
    - heading "Thread at event 9" [level=2]
    - heading "Messages (0)" [level=3]
    - list "Messages"
    - heading "Variables" [level=3]
    - text: '{}'
    - button "Full thread JSON"
- button "Node progress (0 nodes)"
```

# Test source

```ts
  71  |     });
  72  |     let diagnostics = '';
  73  |     child.stdout.on('data', () => undefined);
  74  |     child.stderr.on('data', (chunk: Buffer) => {
  75  |       diagnostics += chunk.toString();
  76  |     });
  77  |     const exited = new Promise<void>((resolve, reject) => {
  78  |       child.once('error', reject);
  79  |       child.once('close', () => resolve());
  80  |     });
  81  |     const server = { child, exited, diagnostics: () => diagnostics };
  82  |     servers.push(server);
  83  |     return server;
  84  |   }
  85  |   async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  86  |     const response = await fetch(origin + path, {
  87  |       method,
  88  |       headers: { 'content-type': 'application/json' },
  89  |       ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  90  |     });
  91  |     if (!response.ok) throw new Error(`Disposable ${method} ${path} returned ${response.status}`);
  92  |     return (await response.json()) as T;
  93  |   }
  94  |   async function ready(server: ReturnType<typeof boot>) {
  95  |     await eventually(async () => {
  96  |       if (server.child.exitCode !== null)
  97  |         throw new Error(`Disposable API exited: ${server.diagnostics()}`);
  98  |       try {
  99  |         return (await fetch(origin + '/loops')).ok;
  100 |       } catch {
  101 |         return false;
  102 |       }
  103 |     });
  104 |   }
  105 |   const count = async () => (await readFile(marker, 'utf8')).match(/effect\n/g)?.length ?? 0;
  106 |   try {
  107 |     let server = boot();
  108 |     await ready(server);
  109 |     const definition = {
  110 |       schemaVersion: CURRENT_DEFINITION_FORMAT,
  111 |       name: 'Script recovery browser',
  112 |       nodes: [
  113 |         { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
  114 |         {
  115 |           id: 'script',
  116 |           kind: 'script',
  117 |           label: 'Effect',
  118 |           config: {
  119 |             command: process.execPath,
  120 |             args: [script, marker, release, '60000'],
  121 |             cwd: dataDir,
  122 |           },
  123 |         },
  124 |         { id: 'done', kind: 'exit', label: 'Done', config: {} },
  125 |       ],
  126 |       edges: [
  127 |         { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'script' } },
  128 |         { id: 'b', from: { node: 'script', port: 'out' }, to: { node: 'done' } },
  129 |       ],
  130 |     };
  131 |     const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
  132 |     await call('POST', `/loops/${loop.id}/publish`);
  133 |     const { run } = await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`);
  134 |     await eventually(async () => {
  135 |       try {
  136 |         return (await count()) === 1;
  137 |       } catch {
  138 |         return false;
  139 |       }
  140 |     });
  141 |     server.child.kill('SIGKILL');
  142 |     await server.exited;
  143 |     await writeFile(release, 'done');
  144 |     server = boot();
  145 |     await ready(server);
  146 |     await eventually(
  147 |       async () =>
  148 |         (await call<RunRecord>('GET', `/runs/${run.id}`)).failure?.code ===
  149 |         'SCRIPT_OUTCOME_UNCERTAIN',
  150 |     );
  151 |     await page.goto(`${origin}/app/runs/${run.id}`);
  152 |     await expect(page.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')).toBeVisible();
  153 |     await expect(page.getByRole('alert')).toContainText('may already have produced its effect');
  154 |     await page.getByRole('button', { name: 'Recover script' }).click();
  155 |     const dialog = page.getByRole('dialog', { name: 'Recover script' });
  156 |     await expect(dialog).toContainText('Resume runs the script again');
  157 |     await page.screenshot({
  158 |       path: fileURLToPath(
  159 |         new URL(
  160 |           '../../../docs/qa/2026-10-22-wp-d1-uncertain-scripts/inspector-uncertain.png',
  161 |           import.meta.url,
  162 |         ),
  163 |       ),
  164 |     });
  165 |     await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  166 |     await expect(dialog).toBeHidden();
  167 |     expect(await count()).toBe(1);
  168 |     expect((await call<RunRecord>('GET', `/runs/${run.id}`)).status).toBe('failed');
  169 |     await page.getByRole('button', { name: 'Recover script' }).click();
  170 |     await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
> 171 |     await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
      |                                                             ^ Error: expect(locator).toBeVisible() failed
  172 |     expect(await count()).toBe(2);
  173 |   } finally {
  174 |     await writeFile(release, 'done');
  175 |     for (const server of servers) {
  176 |       if (server.child.exitCode === null && server.child.signalCode === null)
  177 |         server.child.kill('SIGKILL');
  178 |       await server.exited;
  179 |     }
  180 |     await eventually(
  181 |       async () =>
  182 |         !(await readdir(dataDir))
  183 |           .filter((name) => name.startsWith('marker.active-'))
  184 |           .some((name) => {
  185 |             try {
  186 |               process.kill(Number(name.slice('marker.active-'.length)), 0);
  187 |               return true;
  188 |             } catch (error) {
  189 |               if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
  190 |               throw error;
  191 |             }
  192 |           }),
  193 |     );
  194 |     await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  195 |     await expect(access(dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  196 |   }
  197 | });
  198 |
```
