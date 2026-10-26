import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
import { createApiProcessFixture, eventually, listening } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
}, 60_000);
async function boot(env: NodeJS.ProcessEnv = {}) {
  const f = await createApiProcessFixture({
    prefix: 'gg-wp-c7-224-',
    portStart: 5760,
    portCount: 10,
  });
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

it('native drain rechecks a wake during delivery cleanup and completes its required child before closing controls', async () => {
  const a = await boot({ GG_MAX_CONCURRENT_RUNS: '2' });
  const release = join(a.f.dataDir, 'release-woken-script');
  const started = join(a.f.dataDir, 'woken-script-started');
  const childStarted = join(a.f.dataDir, 'required-child-started');
  let held: ServerResponse | undefined;
  const receiver = createServer((req, res) => {
    req.resume();
    held = res;
  });
  let receiverPort = 5760;
  while (receiverPort <= 5769 && (await listening(receiverPort))) receiverPort++;
  if (receiverPort > 5769) throw new Error('No disposable receiver port is free');
  await new Promise<void>((resolve, reject) => {
    receiver.once('error', reject);
    receiver.listen(receiverPort, '127.0.0.1', resolve);
  });
  try {
    const leaf = await a.publish(
      loop('Required child after wake', [
        {
          id: 'marker',
          kind: 'script',
          label: 'Child marker',
          config: {
            command: process.execPath,
            args: [
              '-e',
              `require('node:fs').writeFileSync(${JSON.stringify(childStarted)},'done')`,
            ],
          },
        },
      ]),
    );
    const parent = await a.publish(
      loop('Wake during cleanup', [
        input,
        {
          id: 'hold',
          kind: 'script',
          label: 'Hold',
          config: {
            command: process.execPath,
            args: [
              '-e',
              `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'active');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},25);setTimeout(()=>process.exit(0),30000)`,
            ],
          },
        },
        {
          id: 'child',
          kind: 'subloop',
          label: 'Required child',
          config: { loopRef: { loopId: leaf } },
        },
      ]),
    );
    const run = await a.start(parent);
    await eventually(async () => (await a.run(run.id)).status === 'waiting');
    const waiting = (await a.run(run.id)).waiting!;
    const returned = loop('Held return response', []);
    const exit = returned.nodes.find((n) => n.kind === 'exit');
    if (!exit || exit.kind !== 'exit') throw new Error('Missing exit');
    exit.config = {
      returns: '"held"',
      destinations: [{ kind: 'webhook', url: `http://127.0.0.1:${receiverPort}/return` }],
    };
    const delivered = await a.start(await a.publish(returned));
    await eventually(() => held !== undefined);
    const sse = await fetch(`${a.origin}/runs/${run.id}/events`, {
      headers: { ...a.headers, accept: 'text/event-stream' },
    });
    let streamClosed = false;
    const text = sse.text().then((value) => {
      streamClosed = true;
      return value;
    });
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    await eventually(
      async () =>
        ((await (await a.call('GET', '/system/shutdown')).json()) as { phase: string }).phase ===
        'awaiting-choice',
    );
    expect(
      (await a.call('POST', `/runs/${run.id}/input`, { waitId: waiting.waitId, input: 'continue' }))
        .status,
    ).toBe(200);
    await eventually(async () => {
      try {
        await access(started);
        return true;
      } catch {
        return false;
      }
    });
    held!.writeHead(200);
    held!.end('accepted');
    await eventually(async () => {
      const events = (await (await a.call('GET', `/runs/${delivered.id}/events`)).json()) as {
        items: { type: string }[];
      };
      return events.items.some((event) => event.type === 'delivery.finished');
    });
    expect(streamClosed).toBe(false);
    expect((await a.run(run.id)).status).toBe('running');
    expect((await a.call('POST', '/runs/00000000000000000000000000/cancel', {})).status).toBe(404);
    expect((await a.call('POST', '/system/shutdown', { action: 'probe-only' })).status).toBe(400);
    await writeFile(release, 'finish');
    expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
    await expect(access(childStarted)).resolves.toBeUndefined();
    expect(await text).toContain('event: run.finished');
    await expect(access(a.f.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await writeFile(release, 'finish');
    held?.end();
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
}, 120_000);

it('native racing Events retain admitted work or reusable keys through drain and restart', async () => {
  const a = await boot();
  const release = join(a.f.dataDir, 'release-event-race');
  const started = join(a.f.dataDir, 'event-race-started');
  try {
    const holder = await a.publish(
      loop('Event race holder', [
        {
          id: 'hold',
          kind: 'script',
          label: 'Hold',
          config: {
            command: process.execPath,
            args: [
              '-e',
              `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'active');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},25);setTimeout(()=>process.exit(0),30000)`,
            ],
          },
        },
      ]),
    );
    await a.start(holder);
    await eventually(async () => {
      try {
        await access(started);
        return true;
      } catch {
        return false;
      }
    });
    const definition = loop('Racing Event target', []);
    definition.nodes[0] = {
      id: 'start',
      kind: 'trigger',
      label: 'Event',
      config: { type: 'event', eventType: 'drain-race' },
    };
    const target = await a.publish(definition);
    const events = Array.from({ length: 6 }, (_, i) => ({
      loopId: target,
      type: 'drain-race',
      payload: { i },
      dedupeKey: `race-${i}`,
    }));
    const pending = events.map((event) => a.call('POST', '/events', event));
    const draining = a.call('POST', '/system/shutdown', { action: 'drain' });
    const responses = await Promise.all(pending);
    const statuses = responses.map((r) => r.status);
    for (const response of responses) {
      // A targeted Event's 202 carries its durable admission; the run follows (#343).
      const body = (await response.json()) as { admissionId?: string; code?: string };
      if (response.status === 202) expect(body.admissionId).toEqual(expect.any(String));
      else {
        expect(response.status).toBe(503);
        expect(body.code).toBe('SHUTTING_DOWN');
      }
    }
    expect((await draining).status).toBe(202);
    await writeFile(release, 'finish');
    expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
    const restarted = a.f.run();
    await a.f.ready(restarted, a.token);
    for (const [i, event] of events.entries()) {
      const response = await a.call('POST', '/events', event);
      expect(response.status).toBe(202);
      const body = (await response.json()) as { admissionId: string; duplicate: boolean };
      expect(body.admissionId).toEqual(expect.any(String));
      expect(body.duplicate).toBe(statuses[i] === 202);
    }
    await eventually(async () => {
      const runs = (await (await a.call('GET', `/runs?loopId=${target}`)).json()) as {
        items: RunRecord[];
      };
      return runs.items.length === 6 && runs.items.every((run) => run.status === 'succeeded');
    });
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  } finally {
    await writeFile(release, 'finish');
  }
}, 120_000);

it('native HTTP drain keeps SSE and input open, creates a child, fires its timer, and recovers only queued work', async () => {
  const a = await boot({ GG_MAX_CONCURRENT_RUNS: '2' });
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
            `const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},25);setTimeout(()=>process.exit(0),30000)`,
          ],
        },
      },
      { id: 'sub', kind: 'subloop', label: 'Child', config: { loopRef: { loopId: leaf } } },
    ]),
  );
  const keeperRelease = join(a.f.dataDir, 'keeper-release');
  const keeperLoop = await a.publish(
    loop('Drain keeper', [
      {
        id: 'hold',
        kind: 'script',
        label: 'Hold',
        config: {
          command: process.execPath,
          args: [
            '-e',
            `const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(keeperRelease)})){clearInterval(t);process.exit(0)}},25);setTimeout(()=>process.exit(0),30000)`,
          ],
        },
      },
    ]),
  );
  const keeper = await a.start(keeperLoop);
  await eventually(async () => (await a.run(keeper.id)).currentNodeId === 'hold');
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
  await eventually(async () => (await a.run(parent.id)).status === 'succeeded');
  await writeFile(keeperRelease, 'finish');
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
    // Deliberate second keypress is outside the one-second pnpm signal coalescing window.
    await new Promise((resolve) => setTimeout(resolve, 1100));
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

it.each(['drain', 'force'] as const)(
  'native %s preserves durable timer, paused input, and parked parent/child across restart',
  async (action) => {
    const a = await boot();
    const leaf = await a.publish(loop('Preserved leaf', [input]));
    const id = await a.publish(
      loop('Preserved parent', [
        { id: 'sub', kind: 'subloop', label: 'Child', config: { loopRef: { loopId: leaf } } },
      ]),
    );
    const parent = await a.start(id);
    await eventually(async () => (await a.run(parent.id)).waiting?.kind === 'child');
    const childId = (await a.run(parent.id)).waiting!.childRunId!;
    await eventually(async () => (await a.run(childId)).status === 'waiting');
    const paused = await a.start(leaf);
    await eventually(async () => (await a.run(paused.id)).status === 'waiting');
    expect((await a.call('POST', `/runs/${paused.id}/pause`, {})).status).toBe(200);
    const timerLoop = await a.publish(
      loop('Preserved future timer', [
        { id: 'timer', kind: 'wait', label: 'Timer', config: { mode: 'duration', seconds: 5 } },
      ]),
    );
    const timer = await a.start(timerLoop);
    await eventually(async () => (await a.run(timer.id)).status === 'waiting');
    const parked = await Promise.all([parent.id, childId, paused.id].map((id) => a.run(id)));
    const stream = await fetch(`${a.origin}/runs/${parent.id}/events`, {
      headers: { ...a.headers, accept: 'text/event-stream' },
    });
    const text = stream.text();
    expect((await a.call('POST', '/system/shutdown', { action })).status).toBe(202);
    expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
    expect(await text).not.toContain('event: run.failed');
    await expect(access(a.f.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = a.f.run([], { GG_TIMER_POLL_MS: '50' });
    await a.f.ready(restarted, a.token);
    expect(await Promise.all([parent.id, childId, paused.id].map((id) => a.run(id)))).toEqual(
      parked,
    );
    for (const run of [parked[1]!, parked[2]!]) {
      if (run.status === 'paused')
        expect((await a.call('POST', `/runs/${run.id}/resume`, {})).status).toBe(200);
      expect(
        (
          await a.call('POST', `/runs/${run.id}/input`, {
            waitId: run.waiting!.waitId,
            input: 'resume after restart',
          })
        ).status,
      ).toBe(200);
    }
    await eventually(
      async () =>
        (await a.run(timer.id)).status === 'succeeded' &&
        (await a.run(parent.id)).status === 'succeeded' &&
        (await a.run(paused.id)).status === 'succeeded',
    );
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  },
  120_000,
);

it('native Event refusal leaves its dedupe key available after restart', async () => {
  const a = await boot();
  const release = join(a.f.dataDir, 'release-event-holder');
  const hold = await a.publish(
    loop('Event drain holder', [
      {
        id: 'hold',
        kind: 'script',
        label: 'Hold',
        config: {
          command: process.execPath,
          args: [
            '-e',
            `const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(t);process.exit(0)}},25);setTimeout(()=>process.exit(0),30000)`,
          ],
        },
      },
    ]),
  );
  const work = await a.start(hold);
  await eventually(async () => (await a.run(work.id)).currentNodeId === 'hold');
  const definition = loop('Event target', []);
  definition.nodes[0] = {
    id: 'start',
    kind: 'trigger',
    label: 'Event',
    config: { type: 'event', eventType: 'resume-event' },
  };
  const target = await a.publish(definition);
  const event = {
    loopId: target,
    type: 'resume-event',
    payload: { value: 1 },
    dedupeKey: 'same-after-restart',
  };
  try {
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    const refused = await a.call('POST', '/events', event);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: 'SHUTTING_DOWN' });
  } finally {
    await writeFile(release, 'finish');
  }
  expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
  const restarted = a.f.run();
  await a.f.ready(restarted, a.token);
  const accepted = await a.call('POST', '/events', event);
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toMatchObject({
    duplicate: false,
    admissionId: expect.any(String),
  });
  await eventually(async () => {
    const runs = (await (await a.call('GET', `/runs?loopId=${target}`)).json()) as {
      items: RunRecord[];
    };
    return runs.items.length === 1;
  });
  await a.call('POST', '/system/shutdown', { action: 'drain' });
  expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
}, 120_000);

it.skipIf(process.platform !== 'win32')(
  'native earlier unconfirmed script timeout does not trap a later normal stop',
  async (context) => {
    const a = await boot();
    const id = await a.publish(
      loop('Earlier timeout', [
        {
          id: 'native',
          kind: 'script',
          label: 'Timeout',
          config: {
            command: process.execPath,
            args: ['-e', 'setTimeout(()=>process.exit(0),5000)'],
            timeoutSeconds: 1,
          },
        },
      ]),
    );
    const run = await a.start(id);
    await eventually(async () => (await a.run(run.id)).status === 'failed');
    const failed = await a.run(run.id);
    if (failed.failure?.code !== 'SCRIPT_TERMINATION_UNCONFIRMED')
      context.skip(
        'D-015 unconfirmed termination requires sandbox taskkill denial; this host confirmed termination',
      );
    const stopped = await a.call('POST', '/system/shutdown', { action: 'drain' });
    expect(stopped.status).toBe(202);
    expect(await stopped.json()).toMatchObject({ unconfirmedRunIds: [run.id] });
    expect(await a.child.waitForExit()).toEqual({ code: 0, signal: null });
    const restarted = a.f.run();
    await a.f.ready(restarted, a.token);
    expect((await a.run(run.id)).failure).toEqual(failed.failure);
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  },
  120_000,
);

it.skipIf(process.platform !== 'win32')(
  'native further force exits nonzero after failed stop cleanup, leaves lock, and restart reclaims it',
  async (context) => {
    const a = await boot();
    const marker = join(a.f.dataDir, 'finite-native-pid');
    const id = await a.publish(
      loop('Unconfirmed force', [
        {
          id: 'native',
          kind: 'script',
          label: 'Force',
          config: {
            command: process.execPath,
            args: [
              '-e',
              `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setTimeout(()=>process.exit(0),10000)`,
            ],
          },
        },
      ]),
    );
    const run = await a.start(id);
    await eventually(async () => {
      try {
        await access(marker);
        return true;
      } catch {
        return false;
      }
    });
    await a.call('POST', '/system/shutdown', { action: 'force' });
    await eventually(async () => {
      if (a.child.exited) return true;
      try {
        const state = (await (await a.call('GET', '/system/shutdown')).json()) as {
          phase: string;
        };
        return state.phase === 'force-failed';
      } catch {
        // A host that confirms termination closes the listener while this poll is in flight.
        return false;
      }
    });
    if (a.child.exited)
      context.skip(
        'D-015 unconfirmed termination requires sandbox taskkill denial; this host confirmed termination',
      );
    const failure = (await a.run(run.id)).failure;
    expect(failure?.code).toBe('SCRIPT_TERMINATION_UNCONFIRMED');
    expect((await a.call('POST', '/system/shutdown', { action: 'force' })).status).toBe(202);
    expect(await a.child.waitForExit()).toEqual({ code: 1, signal: null });
    await expect(access(a.f.lockPath)).resolves.toBeUndefined();
    const restarted = a.f.run();
    await a.f.ready(restarted, a.token);
    expect((await a.run(run.id)).failure).toEqual(failure);
    await a.call('POST', '/system/shutdown', { action: 'drain' });
    expect(await restarted.waitForExit()).toEqual({ code: 0, signal: null });
  },
  120_000,
);
