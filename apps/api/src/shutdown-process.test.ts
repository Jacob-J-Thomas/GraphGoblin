import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
import { createApiProcessFixture, eventually, listening } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
}, 60_000);
async function boot(env: NodeJS.ProcessEnv = {}) {
  const f = await createApiProcessFixture({ prefix: 'gg-wp-c7-', portStart: 5760, portCount: 10 });
  fixtures.push(f);
  const token = await f.createKey();
  const child = f.run([], {
    GG_MAX_CONCURRENT_RUNS: '1',
    GG_TIMER_POLL_MS: '50',
    GG_SHUTDOWN_GRACE_MS: '100',
    ...env,
  });
  await f.ready(child, token);
  const origin = `http://127.0.0.1:${f.port}`;
  const headers = { authorization: `Bearer ${token}` };
  async function call(method: string, path: string, body?: unknown) {
    return fetch(origin + path, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function publish(definition: LoopDefinitionInput) {
    const created = await call('POST', '/loops', { definition });
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { loop: { id: string } }).loop.id;
    const published = await call('POST', `/loops/${id}/publish`);
    expect(published.status, await published.clone().text()).toBe(200);
    return id;
  }
  async function start(id: string) {
    const response = await call('POST', `/loops/${id}/runs`, {});
    expect(response.status, await response.clone().text()).toBe(202);
    return ((await response.json()) as { run: RunRecord }).run;
  }
  async function run(id: string): Promise<RunRecord> {
    return (await (await call('GET', `/runs/${id}`)).json()) as RunRecord;
  }
  return { f, child, token, origin, headers, call, publish, start, run };
}
function loop(name: string, work: LoopDefinitionInput['nodes'][number][]): LoopDefinitionInput {
  const nodes: LoopDefinitionInput['nodes'] = [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    ...work,
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ];
  return {
    schemaVersion: 4,
    name,
    nodes,
    edges: nodes.slice(1).map((node, i) => ({
      id: 'e' + i,
      from: { node: nodes[i]!.id, port: 'out' },
      to: { node: node.id },
    })),
  };
}
const input = {
  id: 'ask',
  kind: 'wait',
  label: 'Input',
  config: { mode: 'input', prompt: 'Answer' },
} as const;

it('native HTTP drain keeps SSE and input open, creates a child, fires its timer, and recovers only queued work', async () => {
  const a = await boot();
  const leaf = await a.publish(
    loop('Timer child', [
      { id: 'timer', kind: 'wait', label: 'Timer', config: { mode: 'duration', seconds: 1 } },
    ]),
  );
  const inputLoop = await a.publish(loop('Input', [input]));
  const parked = await a.start(inputLoop);
  await eventually(async () => (await a.run(parked.id)).status === 'waiting');
  const release = join(a.f.dataDir, 'release');
  const parentLoop = await a.publish(
    loop('Parent', [
      {
        id: 'script',
        kind: 'script',
        label: 'Hold',
        config: {
          command: process.execPath,
          args: [
            '-e',
            `const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},25)`,
          ],
        },
      },
      { id: 'sub', kind: 'subloop', label: 'Child', config: { loopRef: { loopId: leaf } } },
    ]),
  );
  const parent = await a.start(parentLoop);
  await eventually(async () => (await a.run(parent.id)).currentNodeId === 'script');
  const queued = await a.start(parentLoop);
  expect((await a.run(queued.id)).status).toBe('queued');
  const activeSse = await fetch(`${a.origin}/runs/${parent.id}/events`, {
    headers: { ...a.headers, accept: 'text/event-stream' },
  });
  const queuedSse = await fetch(`${a.origin}/runs/${queued.id}/events`, {
    headers: { ...a.headers, accept: 'text/event-stream' },
  });
  const activeText = activeSse.text();
  const queuedText = queuedSse.text();
  expect((await a.call('POST', '/system/shutdown', { action: 'drain' })).status).toBe(202);
  await eventually(
    async () =>
      ((await (await a.call('GET', '/system/shutdown')).json()) as { phase: string }).phase ===
      'awaiting-choice',
  );
  expect((await a.call('POST', `/loops/${inputLoop}/runs`, {})).status).toBe(503);
  expect((await a.run(queued.id)).status).toBe('queued');
  expect((await a.call('POST', '/system/shutdown', { action: 'wait' })).status).toBe(202);
  const wait = (await a.run(parked.id)).waiting!;
  expect(
    (
      await a.call('POST', `/runs/${parked.id}/input`, {
        waitId: wait.waitId,
        input: 'answered during drain',
      })
    ).status,
  ).toBe(200);
  await writeFile(release, 'finish');
  expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
  expect(await activeText).toContain('event: run.finished');
  expect(await queuedText).not.toContain('event: run.started');
  await expect(access(a.f.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await listening(a.f.port)).toBe(false);
  const restarted = a.f.run([], { GG_TIMER_POLL_MS: '50' });
  await a.f.ready(restarted, a.token);
  await eventually(async () => (await a.run(queued.id)).status === 'succeeded');
  expect((await a.run(parent.id)).status).toBe('succeeded');
  expect((await a.run(parked.id)).status).toBe('succeeded');
  const events = (await (await a.call('GET', `/runs/${parent.id}/events`)).json()) as {
    items: { type: string }[];
  };
  expect(events.items.filter((e) => e.type === 'child_run.started')).toHaveLength(1);
  await a.call('POST', '/system/shutdown', { action: 'drain' });
  expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
}, 120_000);

// D-015: sandbox taskkill /T /F is denied on Windows; child.kill(SIGINT/SIGTERM) bypasses JS.
// Linux CI supplies real native signal and tree-termination evidence.
it.skipIf(process.platform !== 'linux').each(['SIGINT', 'SIGTERM'] as const)(
  'native first %s drains and second signal explicitly forces script descendants',
  async (signal) => {
    const a = await boot();
    const pidFile = join(a.f.dataDir, 'pids.json');
    const id = await a.publish(
      loop('Native script tree', [
        {
          id: 'native',
          kind: 'script',
          label: 'Native',
          config: {
            command: process.execPath,
            args: [
              '-e',
              `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`,
            ],
          },
        },
      ]),
    );
    const run = await a.start(id);
    await eventually(async () => {
      try {
        await access(pidFile);
        return true;
      } catch {
        return false;
      }
    });
    const pids = JSON.parse(await readFile(pidFile, 'utf8')) as number[];
    expect(a.child.child.kill(signal)).toBe(true);
    await eventually(
      async () =>
        ((await (await a.call('GET', '/system/shutdown')).json()) as { phase: string }).phase ===
        'awaiting-choice',
    );
    expect((await a.run(run.id)).status).toBe('running');
    expect(a.child.child.kill(signal)).toBe(true);
    expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
    for (const pid of pids)
      await eventually(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    const restarted = a.f.run();
    await a.f.ready(restarted, a.token);
    expect(await a.run(run.id)).toMatchObject({
      status: 'failed',
      failure: {
        code: 'RUN_INTERRUPTED_BY_STOP',
        nodeId: 'native',
        resumable: false,
        details: { attempt: 1 },
      },
    });
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    await restarted.waitForExit();
  },
  120_000,
);

it.skipIf(process.platform !== 'linux')(
  'native explicit force cancels a controlled harness turn and does not replay it on restart',
  async () => {
    const a = await boot();
    const binary = join(a.f.dataDir, 'fake-codex');
    const pidFile = join(a.f.dataDir, 'harness-pid');
    await writeFile(
      binary,
      `#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('codex-cli 0.160.0');process.exit(0)}if(process.argv.includes('--help')){console.log('--json --model --sandbox --cd --skip-git-repo-check --output-schema --config');process.exit(0)}if(process.argv.includes('login')){console.log('Logged in using ChatGPT');process.exit(0)}require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));console.log(JSON.stringify({type:'thread.started',thread_id:'controlled-session'}));console.log(JSON.stringify({type:'turn.started'}));setInterval(()=>{},1000);`,
    );
    await chmod(binary, 0o700);
    // Use a new process with this fixture executable, never an installed provider.
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    await a.child.waitForExit();
    const child = a.f.run([], { GG_CODEX_BINARY: binary });
    await a.f.ready(child, a.token);
    const id = await a.publish(
      loop('Controlled harness', [
        {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { harness: 'codex', prompt: { template: 'Hold for explicit force' } },
        },
      ]),
    );
    const run = await a.start(id);
    await eventually(async () => {
      try {
        await access(pidFile);
        return true;
      } catch {
        return false;
      }
    });
    const pid = Number(await readFile(pidFile, 'utf8'));
    await a.call('POST', '/system/shutdown', { action: 'force' });
    expect(await child.waitForExit()).toEqual({ code: 0, signal: null });
    await eventually(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    const restarted = a.f.run();
    await a.f.ready(restarted, a.token);
    expect(await a.run(run.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'RUN_INTERRUPTED_BY_STOP', nodeId: 'infer' },
    });
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    await restarted.waitForExit();
  },
  120_000,
);

it('native API force of parked parent/child work closes streams, releases ownership and persists interruption across restart', async () => {
  const a = await boot();
  const leaf = await a.publish(loop('Force leaf', [input]));
  const id = await a.publish(
    loop('Force parent', [
      { id: 'sub', kind: 'subloop', label: 'Child', config: { loopRef: { loopId: leaf } } },
    ]),
  );
  const parent = await a.start(id);
  await eventually(async () => (await a.run(parent.id)).waiting?.kind === 'child');
  const childId = (await a.run(parent.id)).waiting!.childRunId!;
  await eventually(async () => (await a.run(childId)).status === 'waiting');
  const stream = await fetch(`${a.origin}/runs/${parent.id}/events`, {
    headers: { ...a.headers, accept: 'text/event-stream' },
  });
  const text = stream.text();
  await a.call('POST', '/system/shutdown', { action: 'drain' });
  await a.call('POST', '/system/shutdown', { action: 'wait' });
  expect((await a.run(parent.id)).status).toBe('waiting');
  expect((await a.call('POST', '/system/shutdown', { action: 'force' })).status).toBe(202);
  expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
  expect(await text).toContain('event: run.failed');
  await expect(access(a.f.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  const restarted = a.f.run();
  await a.f.ready(restarted, a.token);
  for (const runId of [parent.id, childId])
    expect(await a.run(runId)).toMatchObject({
      status: 'failed',
      failure: { code: 'RUN_INTERRUPTED_BY_STOP', resumable: false, details: { attempt: 1 } },
    });
  await a.call('POST', '/system/shutdown', { action: 'drain' });
  expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
}, 120_000);
