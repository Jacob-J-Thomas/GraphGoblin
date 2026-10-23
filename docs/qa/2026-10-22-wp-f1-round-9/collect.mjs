// Node 22, built workspace, disposable stores only. Native audit fixtures refuse every turn.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [phase, audit, label = phase] = process.argv.slice(2);
assert(['before', 'after'].includes(phase));
assert(/^[a-z-]+$/.test(label));
const evidence = resolve('docs/qa/2026-10-22-wp-f1-round-9');
const root = await mkdtemp(join(tmpdir(), 'gg-wp-f1-round-9-'));
for (const name of ['claude', 'codex', 'home', 'temp']) {
  await mkdir(join(root, name));
  if (name === 'claude' || name === 'codex') {
    await copyFile(join(audit, name, name + '.exe'), join(root, name, name + '.exe'));
    await writeFile(join(root, name, 'harness.txt'), name);
    await writeFile(join(root, name, 'scenario.txt'), 'ready');
  }
}
for (const key of Object.keys(process.env))
  if (/^GG_|API_KEY$|^ANTHROPIC_|^OPENAI_|^CLAUDE_CODE_OAUTH_TOKEN$|^JEV_/i.test(key))
    delete process.env[key];
Object.assign(process.env, {
  GG_DATA_DIR: join(root, 'store'),
  GG_PORT: '5638',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'false',
  GG_CLAUDE_BINARY: join(root, 'claude', 'claude.exe'),
  GG_CODEX_BINARY: join(root, 'codex', 'codex.exe'),
  GG_WEB_DIST: resolve('apps/web/dist'),
  HOME: join(root, 'home'),
  USERPROFILE: join(root, 'home'),
  CODEX_HOME: join(root, 'home', 'codex'),
  CLAUDE_CONFIG_DIR: join(root, 'home', 'claude'),
  TEMP: join(root, 'temp'),
  TMP: join(root, 'temp'),
});
const { main } = await import(pathToFileURL(resolve('apps/api/dist/main.js')).href);
const base = 'http://127.0.0.1:5638';
const api = async (path, body) => {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  return { status: response.status, data: await response.json() };
};
const graph = (name, steps) => {
  const nodes = [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    ...steps,
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ];
  return {
    schemaVersion: 4,
    name,
    settings: { subloopDepthLimit: 8 },
    nodes,
    edges: nodes.slice(1).map((node, i) => ({
      id: 'e' + i,
      from: { node: nodes[i].id, port: 'out' },
      to: { node: node.id },
    })),
  };
};
const inference = (harness) => ({
  id: 'think',
  kind: 'inference',
  label: 'Think',
  config: {
    harness,
    model: harness === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
    effort: 'high',
    harnessOptions: { sandbox: 'read-only', approval: 'never' },
    prompt: { template: 'Fake only' },
  },
});
const waitFailed = async (id) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await api('/runs/' + id);
    if (result.data.status === 'failed') return result;
    await delay(25);
  }
  throw new Error('Fake run did not fail');
};
let running = await main();
try {
  const child = spawn(process.execPath, [join(audit, 'classification-r2.mjs'), root, base], {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  const classification = JSON.parse(await readFile(join(root, 'classification-r2.json'), 'utf8'));
  await writeFile(
    join(evidence, 'classification-' + label + '.json'),
    JSON.stringify(classification, null, 2),
  );
  const failed = classification.flatMap((test) =>
    test.actual.filter((item) => item.pass === false).map((item) => ({ name: test.name, ...item })),
  );
  console.log(JSON.stringify({ phase, failed }));
  assert(classification.every((test) => test.http === 200 && !test.sentinelExposed));
  assert.equal(failed.length, phase === 'before' ? 2 : 0);
  const settingsBefore = await api('/settings');
  const surfaces = [];
  for (const stream of ['stdout', 'stderr']) {
    for (const h of ['claude', 'codex'])
      await writeFile(
        join(root, h, 'auth.txt'),
        [
          0,
          0,
          Buffer.from(stream === 'stdout' ? 'Not logged in' : '').toString('base64'),
          Buffer.from(stream === 'stderr' ? 'Not logged in' : '').toString('base64'),
          0,
        ].join('\n'),
      );
    const preflight = await api('/harness/preflight');
    const system = await api('/system/preflight');
    const definition = graph('Sign-out ' + stream, [inference('claude')]);
    const created = await api('/loops', { definition });
    assert.equal(created.status, 201);
    const validation = await api('/loops/' + created.data.loop.id + '/validate', { definition });
    const expected = phase === 'before' ? 'unknown' : 'auth';
    assert.equal(preflight.data.items.find((item) => item.harness === 'claude').state, expected);
    assert.equal(system.data.checks.find((item) => item.id === 'harness.claude').state, expected);
    if (phase === 'after') {
      const claude = preflight.data.items.find((item) => item.harness === 'claude');
      assert.equal(claude.authenticated, false);
      assert.deepEqual(claude.problems, [
        'Claude is not signed in. Run claude auth login, then retry preflight.',
      ]);
    }
    assert(
      validation.data.issues.some(
        (issue) => issue.code === 'HARNESS_READINESS_' + expected.toUpperCase(),
      ),
    );
    surfaces.push({ stream, preflight, system, validation });
  }
  assert.deepEqual(await api('/settings'), settingsBefore);
  await writeFile(join(evidence, 'surfaces-' + label + '.json'), JSON.stringify(surfaces, null, 2));
  // The replay policy is separate: establish a source using only a turn-refusing fake.
  for (const h of ['claude', 'codex'])
    await writeFile(
      join(root, h, 'auth.txt'),
      [
        0,
        0,
        Buffer.from(
          h === 'claude' ? '{"authMethod":"claude.ai"}' : 'Logged in using ChatGPT',
        ).toString('base64'),
        '',
        0,
      ].join('\n'),
    );
  const definition = graph('Replay exception', [
    {
      id: 'effect',
      kind: 'mutate',
      label: 'Effect',
      config: { operations: [{ op: 'append-message', content: 'ROUND_9_EFFECT' }] },
    },
    inference('claude'),
  ]);
  const created = await api('/loops', { definition });
  assert.equal(created.status, 201);
  assert.equal((await api('/loops/' + created.data.loop.id + '/publish', {})).status, 200);
  const source = await api('/loops/' + created.data.loop.id + '/runs', {});
  assert.equal(source.status, 202);
  await waitFailed(source.data.run.id);
  await running.app.close();
  running = undefined;
  process.env.GG_CLAUDE_BINARY = join(root, 'missing-claude.exe');
  process.env.GG_CODEX_BINARY = join(root, 'missing-codex.exe');
  running = await main();
  const preflight = await api('/harness/preflight');
  assert(preflight.data.items.every((item) => item.state === 'cli-missing'));
  const normal = await api('/loops/' + created.data.loop.id + '/runs', {});
  const replay = await api('/runs/' + source.data.run.id + '/replay', { nodeId: 'effect' });
  assert.equal(normal.status, 422);
  assert.equal(replay.status, 202);
  const finished = await waitFailed(replay.data.run.id);
  const events = await api('/runs/' + replay.data.run.id + '/events');
  assert(JSON.stringify(events).includes('ROUND_9_EFFECT'));
  const record = { preflight, normal, replay, finished, events };
  await writeFile(join(evidence, 'replay-' + label + '.json'), JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify({
      phase,
      normal: normal.status,
      replay: replay.status,
      terminal: finished.data.status,
      mutationRecorded: true,
    }),
  );
} finally {
  await running?.app.close();
}
