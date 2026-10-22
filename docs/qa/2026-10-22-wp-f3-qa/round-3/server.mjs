// Built API composition root; the prepared F4 tree is used read-only.
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { repo, evidence } from './qa-lib.mjs';
const [name, mode = 'candidate', portText = '5905'] = process.argv.slice(2),
  port = Number(portText);
if (!/^gg-qa-243-[A-Za-z0-9-]+$/.test(name ?? '') || port < 5900 || port > 5909)
  throw Error('Invalid QA store/port');
const tree = mode === 'base' ? resolve(repo, '..', 'codex-qa-wp-f4') : repo;
const imported = (path) => import(pathToFileURL(join(tree, path)).href);
const { createContainer } = await imported('apps/api/dist/container.js'),
  { loadConfig } = await imported('apps/api/dist/config.js'),
  { buildApp } = await imported('apps/api/dist/app.js');
const { FakeHarness } = await imported('packages/engine/dist/testing/index.js'),
  { createInitialThread } = await imported('packages/engine/dist/index.js');
const data = join(tmpdir(), name),
  fake = new FakeHarness(),
  facts = [];
let scenario = 'large';
const harnesses = { codex: fake };
if (mode === 'claude') {
  const { ClaudeHarness } = await imported('packages/infrastructure/dist/claude/index.js'),
    { runClaudeProcess } = await imported('packages/infrastructure/dist/claude/process.js');
  const native = new ClaudeHarness({
    platform: 'win32',
    runner: (request, onStdout) => {
      const fact =
        request.stdin !== undefined
          ? {
              mode: scenario,
              timeoutMs: request.timeoutMs,
              maxTurns: request.args.includes('--max-turns'),
            }
          : undefined;
      if (fact) facts.push(fact);
      return runClaudeProcess(
        {
          ...request,
          binary: process.execPath,
          args: [join(evidence, 'fake-claude.mjs'), ...request.args],
          env: {
            ...request.env,
            GG_QA_MODE: scenario,
            GG_QA_CLI_LOG: join(data, 'fake-cli.jsonl'),
          },
        },
        onStdout,
      ).then((result) => {
        if (fact) {
          fact.returnedAt = performance.now();
          fact.terminationUnconfirmed = !!result.terminationUnconfirmed;
        }
        return result;
      });
    },
  });
  const wrap = (session) => ({
    ...session,
    events: (async function* () {
      for await (const event of session.events) {
        if (event.type === 'submitted') {
          const fact = facts.at(-1);
          if (fact) {
            fact.acceptedAt = performance.now();
            fact.marker = event.marker;
          }
        }
        yield event;
      }
    })(),
  });
  harnesses.claude = {
    id: native.id,
    preflight: (signal) => native.preflight(signal),
    start: (r, s) => wrap(native.start(r, s)),
    resume: (id, r, s) => wrap(native.resume(id, r, s)),
  };
}
const container = await createContainer(
  loadConfig({
    GG_DATA_DIR: data,
    GG_DB_URL: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/'),
    GG_REQUIRE_API_KEY: 'false',
    GG_WEB_DIST: join(tree, 'apps/web/dist'),
  }),
  { harnesses },
);
await container.start();
const app = await buildApp(container, { logger: false });
for (const path of ['/qa/script', '/harness/script'])
  app.post(path, async (r) => {
    fake.script(r.body.turns);
    return { ok: true };
  });
app.post('/harness/requests', async () => ({
  started: fake.started.map((r) => ({ model: r.model, effort: r.effort })),
}));
app.get('/qa/requests', async () => ({
  count: fake.started.length,
  cancelled: fake.cancelled.length,
}));
app.post('/qa/mode', async (r) => {
  scenario = r.body.mode;
  return { mode: scenario };
});
app.get('/qa/observations', async () => ({
  facts,
  cli: (await readFile(join(data, 'fake-cli.jsonl'), 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((x) => JSON.parse(x)),
}));
app.get('/qa/transcript/:id', async (r) => {
  const thread = await container.repos.runs.getThread(r.params.id);
  const ref = thread.artifacts.find((x) => x.kind === 'transcript');
  return { items: JSON.parse(await container.ports.artifacts.get(ref.ref)) };
});
app.post('/qa/seed-admission', async (r) => {
  const template = await container.repos.runs.get(r.body.templateRunId),
    next = () => container.ports.ids.next(),
    now = new Date().toISOString();
  function intent() {
    const run = {
      id: next(),
      ownerId: template.ownerId,
      loopId: template.loopId,
      versionId: template.versionId,
      pinned: template.pinned,
      invocationId: next(),
      status: 'queued',
      iteration: 1,
      createdAt: now,
      lastEventSeq: 0,
    };
    const initialThread = createInitialThread({
      runId: run.id,
      loopId: run.loopId,
      versionId: run.versionId,
      invocation: {
        id: run.invocationId,
        source: 'webhook',
        trigger: {
          nodeId: 'start',
          kind: 'webhook',
          payload: { qa: 'saved-intent' },
          receivedAt: now,
        },
      },
    });
    return {
      run,
      initialThread,
      pinnedLoopIds: [run.loopId],
      queued: { type: 'run.queued', versionId: run.versionId, pinned: run.pinned, initialThread },
    };
  }
  const queued = await container.ports.admission.create(intent()),
    saved = intent(),
    claim = {
      id: next(),
      ownerId: template.ownerId,
      loopId: template.loopId,
      triggerNodeId: 'start',
      contentHash: 'a'.repeat(64),
      inbound: {
        id: next(),
        ownerId: template.ownerId,
        type: 'webhook',
        source: 'webhook:qa',
        payload: { qa: 'saved-intent' },
        receivedAt: now,
        runIds: [],
      },
    };
  const { receipt } = await container.ports.admission.claim(claim, saved);
  return {
    queuedRunId: queued.id,
    savedRunId: saved.run.id,
    receiptId: receipt.id,
    inboundId: claim.inbound.id,
    status: receipt.status,
  };
});
app.get('/qa/store', async () => {
  const sql = async (text) => (await container.handle.client.execute(text)).rows;
  return {
    migrations: await sql(
      'SELECT id,hash,created_at FROM __drizzle_migrations ORDER BY created_at',
    ),
    runs: await sql('SELECT id,status,pinned FROM runs ORDER BY id'),
    queued: await sql(
      "SELECT run_id,payload FROM run_events WHERE type='run.queued' ORDER BY run_id",
    ),
    receipts: await sql('SELECT id,status,intent FROM webhook_receipts ORDER BY id'),
    inbound: await sql('SELECT id,run_ids FROM inbound_events ORDER BY id'),
  };
});
app.post('/qa/stop', async () => {
  setTimeout(async () => {
    await app.close();
    await container.stop();
    process.exit(0);
  }, 100);
  return { stopping: true };
});
await app.listen({ host: '127.0.0.1', port });
console.log('QA_READY');
