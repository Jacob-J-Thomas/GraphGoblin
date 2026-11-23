import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { createGraphGoblinClient, runs } from '@graphgoblin/api-client';
import {
  CURRENT_DEFINITION_FORMAT,
  RunSnapshotSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { QueryClient } from '@tanstack/react-query';
import { getInspectorRead, trackInspectorRead } from '../src/runs/inspector-read-provenance.js';
import { RunHeaderRegistry } from '../src/runs/run-header-store.js';

// Independent S2 only: native HTTP and real engine/store; explicitly fake inference.
// No browser globals, private receipt manipulation, UI claim or provider invocation.
const evidence = process.env['GG_I5_S2_EVIDENCE'];
assert(evidence, 'Explicit evidence root required');
const output = resolve(evidence);
const scratch = resolve(output, 'scratch');
const prohibitedPorts = new Set([4747, 4748, 7443, 11434]);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const jsonFile = (name: string, value: unknown) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function contained(root: string, child: string): boolean {
  const suffix = relative(root, child);
  return (
    suffix !== '' &&
    suffix !== '..' &&
    !suffix.startsWith('..\\') &&
    !suffix.startsWith('../') &&
    !isAbsolute(suffix)
  );
}
function errorRecord(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
}
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
const waitDefinition: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Independent S2 waiting shape',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'wait',
      kind: 'wait',
      label: 'Owned input',
      config: {
        mode: 'input',
        prompt: 'Controlled input',
        inputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
    { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
  ],
};
const largeDefinition: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Independent S2 large controlled result',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'infer',
      kind: 'inference',
      label: 'Scripted fake result',
      config: {
        harness: 'codex',
        prompt: { template: 'Controlled fake result only' },
        output: { captureTranscript: 'none', toMessages: 'none' },
      },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
    { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
  ],
};
interface Observation {
  label: string;
  url: string;
  status: number;
  bytes: number;
  sha256: string;
  fetchToBodyMs: number;
  rawFile: string;
  keys: string[];
  runStatus: string;
  receipt: { committed: number; pending: number; loss: number };
}
async function main() {
  await mkdir(output, { recursive: true });
  assert.equal(resolve(tmpdir()), scratch, 'Only command-local owned TEMP/TMP may be used');
  const scratchReal = await realpath(scratch);
  assert.equal(scratchReal.toLowerCase(), scratch.toLowerCase());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });
  let app: TestApp | undefined;
  let dataDir: string | undefined;
  let baseUrl: string | undefined;
  let getLabel: string | undefined;
  let rawCount = 0;
  let failure: unknown;
  const raw = new Map<string, { text: string; status: number; ms: number; url: string }>();
  const observations: Observation[] = [];
  const requests: { method: string; path: string; status: number }[] = [];
  try {
    app = await createTestApp({
      tempPrefix: 'gg-i5-s2-',
      env: { GG_OLLAMA_ENABLED: 'false', GG_WEB_DIST: '', GG_GOBLIN_DIST: '' },
    });
    dataDir = await realpath(app.dataDir);
    assert(contained(scratchReal, dataDir), 'App directory must be beneath owned scratch');
    assert.equal(app.container.config.dbUrl, ':memory:');
    assert.equal(app.container.config.ollamaEnabled, false);
    assert.equal(app.container.config.webDist, undefined);
    assert.equal(app.container.config.goblinDist, undefined);
    baseUrl = await app.app.listen({ host: '127.0.0.1', port: 0 });
    const origin = new URL(baseUrl);
    assert.equal(origin.hostname, '127.0.0.1');
    assert(origin.port !== '' && !prohibitedPorts.has(Number(origin.port)));
    await jsonFile('fixture.json', {
      pid: process.pid,
      node: process.version,
      executable: process.execPath,
      origin: origin.origin,
      dataDir,
      scratch: scratchReal,
      database: app.container.config.dbUrl,
      ollamaEnabled: app.container.config.ollamaEnabled,
      staticDisabled: true,
      providerEvidence: 'FakeHarness/FakeDecider/FakeClassifier/FakeStructured',
      tmpdir: tmpdir(),
      browserGlobalsInjected: false,
    });
    const nativeFetch = globalThis.fetch;
    const client = createGraphGoblinClient({
      baseUrl,
      fetch: async (request) => {
        const url = new URL(request.url);
        assert.equal(url.origin, origin.origin);
        assert.equal(request.method, 'GET');
        assert(getLabel, 'Only an explicitly scheduled GET is allowed');
        const label = getLabel;
        const begin = performance.now();
        const response = await nativeFetch(
          new Request(request, {
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
            redirect: 'manual',
          }),
        );
        const text = await response.clone().text();
        const ms = performance.now() - begin;
        rawCount++;
        assert(!raw.has(label), 'No duplicate GET or retry');
        raw.set(label, { text, status: response.status, ms, url: request.url });
        requests.push({ method: 'GET', path: url.pathname, status: response.status });
        await writeFile(join(output, `${label}.raw.json`), text, { flag: 'wx' });
        return response;
      },
    });
    const owner = new RunHeaderRegistry({ client, queryClient });
    async function post(path: string, body: unknown, expectedStatus: number) {
      const response = await nativeFetch(new URL(path, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
      });
      const text = await response.text();
      requests.push({ method: 'POST', path, status: response.status });
      assert.equal(response.status, expectedStatus, text);
      return JSON.parse(text) as unknown;
    }
    async function start(definition: LoopDefinitionInput) {
      const created = await post('/loops', { definition }, 201);
      assert(created && typeof created === 'object' && 'loop' in created);
      const loop = created.loop;
      assert(loop && typeof loop === 'object' && 'id' in loop && typeof loop.id === 'string');
      await post(`/loops/${loop.id}/publish`, {}, 200);
      const started = await post(`/loops/${loop.id}/runs`, {}, 202);
      assert(started && typeof started === 'object' && 'run' in started);
      const run = started.run;
      assert(run && typeof run === 'object' && 'id' in run && typeof run.id === 'string');
      return run.id;
    }
    async function snapshot(label: string, id: string) {
      getLabel = label;
      const queryKey = ['runs', 'one', id] as const;
      const body = await queryClient.fetchQuery({
        queryKey,
        queryFn: (context) =>
          trackInspectorRead(
            owner,
            context,
            () => runs.get(client, id, { signal: context.signal }),
            (value) => value.id === id && RunSnapshotSchema.safeParse(value).success,
          ),
      });
      getLabel = undefined;
      const captured = raw.get(label);
      assert(captured, 'Real GET body required');
      assert.equal(captured.status, 200);
      const exactBody: unknown = JSON.parse(captured.text);
      const validated = RunSnapshotSchema.safeParse(exactBody);
      if (!validated.success)
        await jsonFile(`${label}.schema-failure.json`, validated.error.issues);
      assert(validated.success, 'Untouched HTTP body must satisfy RunSnapshotSchema');
      assert.equal(validated.data.id, id);
      assert.deepEqual(body, exactBody, 'Client data must equal untouched HTTP body');
      const receipt = getInspectorRead(owner, queryKey);
      assert(receipt.committed > 0, 'Actual response must commit eligible proof');
      assert.equal(receipt.pending, 0);
      assert.equal(queryClient.getQueryData(queryKey), body);
      observations.push({
        label,
        url: captured.url,
        status: captured.status,
        bytes: Buffer.byteLength(captured.text),
        sha256: digest(captured.text),
        fetchToBodyMs: captured.ms,
        rawFile: `${label}.raw.json`,
        keys: Object.keys(validated.data).sort(),
        runStatus: validated.data.status,
        receipt,
      });
      console.log(
        JSON.stringify({
          label,
          status: validated.data.status,
          bytes: Buffer.byteLength(captured.text),
          receipt,
        }),
      );
      return validated.data;
    }
    const waitId = await start(waitDefinition);
    await app.idle();
    const waiting = await snapshot('01-waiting', waitId);
    assert.equal(waiting.status, 'waiting');
    assert(waiting.waiting);
    await post(
      `/runs/${waitId}/input`,
      { waitId: waiting.waiting.waitId, input: { ok: true } },
      200,
    );
    await app.idle();
    const completed = await snapshot('02-completed', waitId);
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(completed.result, { ok: true });
    assert(completed.recovery.observedSeq > waiting.recovery.observedSeq);
    const expected = {
      rows: Array.from({ length: 8_192 }, (_, index) => ({ index, value: 'x'.repeat(112) })),
    };
    const scripted = JSON.stringify(expected);
    app.harness.script([
      {
        finalText: scripted,
        items: [{ id: 'controlled', type: 'message', summary: 'Controlled large JSON' }],
      },
    ]);
    const largeId = await start(largeDefinition);
    await app.idle();
    const large = await snapshot('03-large-controlled', largeId);
    assert.equal(large.status, 'succeeded');
    assert.deepEqual(large.result, expected);
    assert.equal(app.harness.started.length, 1);
    const actualResultText = JSON.stringify(large.result);
    assert.equal(digest(actualResultText), digest(scripted));
    assert.equal(rawCount, 3);
    const timings = [];
    for (const observation of observations) {
      const captured = raw.get(observation.label);
      assert(captured);
      const samples = [];
      for (let index = 0; index < 13; index++) {
        const begin = performance.now();
        const value: unknown = JSON.parse(captured.text);
        const parsed = performance.now();
        assert(RunSnapshotSchema.safeParse(value).success);
        const checked = performance.now();
        samples.push({
          phase: index < 3 ? 'warmup' : 'measured',
          index,
          jsonMs: parsed - begin,
          schemaMs: checked - parsed,
        });
      }
      timings.push({ label: observation.label, samples });
    }
    await jsonFile('RESULT.json', {
      passed: true,
      scope: 'S2 real HTTP API shape/public core adapter, not browser or useRun UI',
      observations,
      timings,
      largeControlledResult: {
        rows: 8_192,
        resultBytes: Buffer.byteLength(scripted),
        sha256: digest(scripted),
        harnessTurns: app.harness.started.length,
      },
      timingLimit:
        'Node observations, 3 warmups and 10 measured samples per body, no performance threshold; clone capture included in native GET-to-body time',
    });
  } catch (error) {
    failure = error;
    await jsonFile('FIRST-FAILURE.json', errorRecord(error));
  } finally {
    queryClient.clear();
    let closeError: unknown;
    try {
      await app?.close();
    } catch (error) {
      closeError = error;
    }
    const remaining = dataDir ? await exists(dataDir) : null;
    const listenerListening = app?.app.server.listening ?? false;
    await jsonFile('CLOSURE.json', {
      dataDir: dataDir ?? null,
      dataDirAbsent: remaining === false,
      listener: baseUrl ?? null,
      listenerListening,
      rawGetCount: rawCount,
      requests,
      scratchEntries: await readdir(scratch),
      closeError: closeError ? errorRecord(closeError) : null,
      appCreated: app !== undefined,
    });
    if (!failure && closeError) failure = closeError;
    if (!failure && (remaining !== false || listenerListening))
      failure = new Error('Owned app cleanup incomplete');
  }
  if (failure)
    throw failure instanceof Error ? failure : new Error('S2 failed', { cause: failure });
  console.log('S2 complete: three actual HTTP bodies valid and eligible; owned app/store closed.');
}

void main().catch(async (error: unknown) => {
  await writeFile(
    join(output, 'PROGRAM-ERROR.json'),
    JSON.stringify(errorRecord(error), null, 2) + '\n',
    { flag: 'wx' },
  );
  console.error(error);
  process.exitCode = 1;
});
