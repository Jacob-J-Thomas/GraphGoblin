import { readFileSync } from 'node:fs';
import {
  ContextThreadSchema,
  LoopDefinitionSchema,
  LoopExportSchema,
  LoopSettingsSchema,
  RunFailureSchema,
  RunRecordSchema,
  type LoopDefinition,
  type LoopRecord,
  type LoopVersionRecord,
  type RunRecord,
} from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

// Every fence is inventoried, including display-only snippets and command fragments.
// Adding a fence without a marker, removing one, or duplicating an ID fails the check.
const inventory = {
  '02-build-a-loop': [
    'editor-url',
    'temp-settings',
    'version-requests',
    'export-request',
    'import-request',
    'draft-request',
    'draft-body',
    'publish-request',
    'first-summary',
    'bounded-repeat',
  ],
  '03-run-and-observe': [
    'run-urls',
    'start-request',
    'start-filename',
    'start-body',
    'start-bash',
    'start-powershell',
    'auth-bash',
    'auth-powershell',
    'start-mcp',
    'resume-bash',
    'resume-powershell',
    'replay-bash',
    'replay-powershell',
    'events-bash',
    'events-powershell',
    'reconnect-bash',
    'returns-bash',
    'returns-powershell',
    'failure-shape',
  ],
};
const guides = Object.entries(inventory).map(([file, ids]) => {
  const source = readFileSync(new URL(`../../../docs/guide/${file}.md`, import.meta.url), 'utf8');
  return {
    ids,
    fences: [...source.matchAll(/^```[^\r\n]*\r?\n([\s\S]*?)^```/gm)],
    marked: [
      ...source.matchAll(/<!-- guide-example: ([a-z-]+) -->\r?\n\r?\n```\w+\r?\n([\s\S]*?)^```/gm),
    ],
  };
});
const examples = new Map<string, string>(
  guides.flatMap(({ marked }) =>
    marked.map((match): [string, string] => [match[1] as string, (match[2] as string).trim()]),
  ),
);
function block(id: string): string {
  const value = examples.get(id);
  if (!value) throw new Error(`Missing guide example ${id}`);
  return value;
}
function json(id: string): unknown {
  return JSON.parse(block(id));
}
// Paid execution excluded: first-summary needs an installed authenticated Codex
// provider and consumes account usage. The exact graph is exercised with fake output.
const summaryText = 'A deterministic summary from the fake harness.';
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

function route(id: string, loopId = ''): string {
  const line = block(id);
  const methods: Record<string, string> = {
    'import-request': 'POST',
    'publish-request': 'POST',
    'draft-request': 'PUT',
    'start-request': 'POST',
    'export-request': 'GET',
  };
  expect(line.split(' ')[0]).toBe(methods[id]);
  expect(line).toMatch(/^(GET|POST|PUT) \/loops\//);
  return line.slice(line.indexOf(' ') + 1).replace('{id}', loopId);
}
async function importExample(definition: unknown): Promise<string> {
  LoopDefinitionSchema.parse(definition);
  const imported = await t.app.inject({
    method: 'POST',
    url: route('import-request'),
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(definition),
  });
  expect(imported.statusCode, imported.body).toBe(201);
  const body = imported.json<{ loop: LoopRecord }>();
  // Current format only: the import response has no conversion notices (ADR-0042).
  expect(Object.keys(body).sort()).toEqual(['draft', 'issues', 'loop']);
  return body.loop.id;
}
async function publish(loopId: string): Promise<LoopVersionRecord> {
  const response = await t.app.inject({ method: 'POST', url: route('publish-request', loopId) });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ version: LoopVersionRecord }>().version;
}
async function summaryLoop(): Promise<string> {
  const id = await importExample(json('first-summary'));
  await publish(id);
  return id;
}
async function runSnapshot(id: string): Promise<RunRecord> {
  await t.idle();
  const response = await t.app.inject(`/runs/${id}`);
  expect(response.statusCode, response.body).toBe(200);
  return RunRecordSchema.parse(response.json());
}
async function startSummary(loopId: string): Promise<RunRecord> {
  const response = await t.app.inject({
    method: 'POST',
    url: route('start-request', loopId),
    headers: { 'content-type': 'application/json' },
    payload: block('start-body'),
  });
  expect(response.statusCode, response.body).toBe(202);
  return runSnapshot(response.json<{ run: RunRecord }>().run.id);
}
function command(id: string, loopId: string, runId = '') {
  const source = block(id);
  const url = /"(http:\/\/127\.0\.0\.1:4747[^"\s]+)"/.exec(source)?.[1];
  if (!url) throw new Error(`Missing URL in ${id}`);
  const path = new URL(
    url.replace(/\$(?:LOOP_ID|loopId)/g, loopId).replace(/\$(?:RUN_ID|runId)/g, runId),
  );
  const body = /(?:-d|-Body) '(\{[^']*\})'/.exec(source)?.[1];
  const fromFile = source.includes('@start.json') || source.includes('-InFile start.json');
  const headers: Record<string, string> = {};
  if (source.includes('Accept: text/event-stream')) headers.accept = 'text/event-stream';
  const cursor = /Last-Event-ID: (\d+)/.exec(source)?.[1];
  if (cursor) headers['last-event-id'] = cursor;
  if (
    source.includes('Content-Type: application/json') ||
    source.includes("-ContentType 'application/json'")
  )
    headers['content-type'] = 'application/json';
  return {
    method: /-X POST|-Method Post/.test(source) ? ('POST' as const) : ('GET' as const),
    url: path.pathname + path.search,
    headers,
    ...(body || fromFile ? { payload: body ?? block('start-body') } : {}),
  };
}

describe('executable guide examples', () => {
  it('inventories every fence in guides 02 and 03', () => {
    const seen = new Set<string>();
    for (const { ids, fences, marked } of guides) {
      expect(marked.map((match) => match[1])).toEqual(ids);
      expect(marked).toHaveLength(fences.length);
      for (const match of marked) {
        const id = match[1] as string;
        expect(seen.has(id), `Duplicate guide example ${id}`).toBe(false);
        seen.add(id);
      }
    }
  });

  it('validates settings, imports the draft definition, saves, exports, publishes and executes it', async () => {
    const settings = LoopSettingsSchema.parse(json('temp-settings'));
    const payload = json('draft-body') as { definition: LoopDefinition };
    const id = await importExample(payload.definition);
    const saved = await t.app.inject({
      method: 'PUT',
      url: route('draft-request', id),
      payload: block('draft-body'),
      headers: { 'content-type': 'application/json' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const exported = await t.app.inject(route('export-request', id));
    expect(exported.statusCode, exported.body).toBe(200);
    expect(LoopExportSchema.parse(exported.json()).loop).toEqual(
      LoopDefinitionSchema.parse(payload.definition),
    );
    // Apply the standalone settings through the same public draft endpoint too.
    const configured = await t.app.inject({
      method: 'PUT',
      url: route('draft-request', id),
      payload: { definition: { ...payload.definition, settings } },
    });
    expect(configured.statusCode, configured.body).toBe(200);
    const version = await publish(id);
    for (const request of block('version-requests').split(/\r?\n/)) {
      const url = request.slice(4).replace('{id}', id).replace('{versionId}', version.id);
      expect((await t.app.inject(url)).statusCode).toBe(200);
    }
    const started = await t.app.inject({
      method: 'POST',
      url: route('start-request', id),
      payload: {},
    });
    expect(started.statusCode, started.body).toBe(202);
    expect(await runSnapshot(started.json<{ run: RunRecord }>().run.id)).toMatchObject({
      status: 'succeeded',
      outcome: 'success',
    });
    expect(t.harness.started).toHaveLength(0);
  });

  it('executes the exact first-summary and API input, including its prompt and return mapping', async () => {
    const id = await summaryLoop();
    t.harness.script([{ finalText: summaryText }]);
    const run = await startSummary(id);
    expect(run).toMatchObject({ status: 'succeeded', result: { summary: summaryText } });
    expect(t.harness.started).toHaveLength(1);
    expect(t.harness.started[0]?.turn.prompt).toContain(
      'Explain event-sourced workflows in three sentences.',
    );
    // Validate the documented MCP example's input against this exact trigger too.
    const mcp = json('start-mcp') as { loopId: string; triggerNodeId: string; input: unknown };
    expect(mcp.loopId).toBe(LoopDefinitionSchema.parse(json('first-summary')).name);
    const response = await t.app.inject({
      method: 'POST',
      url: route('start-request', id),
      headers: { 'x-graphgoblin-client': 'mcp' },
      payload: { triggerNodeId: mcp.triggerNodeId, input: mcp.input },
    });
    expect(response.statusCode, response.body).toBe(202);
    const mcpRun = await runSnapshot(response.json<{ run: RunRecord }>().run.id);
    expect(mcpRun.status).toBe('succeeded');
    const thread = ContextThreadSchema.parse(
      (await t.app.inject(`/runs/${mcpRun.id}/thread`)).json(),
    );
    expect(thread.invocation.source).toBe('manual.mcp');
  });

  it.each(['start-bash', 'start-powershell'])(
    'executes the HTTP request in %s',
    async (example) => {
      const id = await summaryLoop();
      const request = command(example, id);
      expect(request.method).toBe('POST');
      expect(request.payload).toBe(block('start-body'));
      t.harness.script([{ finalText: summaryText }]);
      const response = await t.app.inject(request);
      expect(response.statusCode, response.body).toBe(202);
      expect(await runSnapshot(response.json<{ run: RunRecord }>().run.id)).toMatchObject({
        status: 'succeeded',
        result: { summary: summaryText },
      });
    },
  );

  it.each(['replay-bash', 'replay-powershell'])(
    'replays the documented node in %s',
    async (example) => {
      const id = await summaryLoop();
      const source = await startSummary(id);
      t.harness.script([{ finalText: summaryText }]);
      const response = await t.app.inject(command(example, id, source.id));
      expect(response.statusCode, response.body).toBe(202);
      expect(await runSnapshot(response.json<{ run: RunRecord }>().run.id)).toMatchObject({
        status: 'succeeded',
        result: { summary: summaryText },
      });
      expect((await runSnapshot(source.id)).result).toEqual(source.result);
    },
  );

  it.each(['resume-bash', 'resume-powershell'])(
    'resumes a fake external failure with %s; refuses a finished run',
    async (example) => {
      const id = await summaryLoop();
      t.harness.script([
        {
          error: { code: 'TEST_PROVIDER_FAILURE', message: 'disposable failure', retriable: true },
        },
      ]);
      const failed = await startSummary(id);
      expect(failed).toMatchObject({ status: 'failed', failure: { resumable: true } });
      t.harness.script([{ finalText: summaryText }]);
      const request = command(example, id, failed.id);
      const resumed = await t.app.inject(request);
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(await runSnapshot(failed.id)).toMatchObject({
        status: 'succeeded',
        result: { summary: summaryText },
      });
      expect((await t.app.inject(request)).statusCode).toBe(409);
    },
  );

  it.each([
    'events-bash',
    'events-powershell',
    'reconnect-bash',
    'returns-bash',
    'returns-powershell',
  ])('reads the documented events request in %s', async (example) => {
    const id = await summaryLoop();
    const run = await startSummary(id);
    const request = command(example, id, run.id);
    if (example === 'reconnect-bash') expect(request.headers['last-event-id']).toBe('12');
    const response = await t.app.inject(request);
    expect(response.statusCode, response.body).toBe(200);
    if (request.headers.accept) {
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('event: run.finished');
      const ids = [...response.body.matchAll(/^id: (\d+)/gm)].map((match) => Number(match[1]));
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((seq) => seq > Number(request.headers['last-event-id'] ?? 0))).toBe(true);
    } else {
      expect(
        response
          .json<{ items: { type: string }[] }>()
          .items.some((event) => event.type === 'return.delivered'),
      ).toBe(true);
    }
  });

  it('runs the bounded-repeat example to exactly three passes and an Exhausted exit', async () => {
    expect(LoopDefinitionSchema.parse(json('bounded-repeat')).settings.maxNodeVisits).toBe(10);
    const id = await importExample(json('bounded-repeat'));
    await publish(id);
    const started = await t.app.inject({
      method: 'POST',
      url: route('start-request', id),
      payload: { triggerNodeId: 'start', input: {} },
    });
    expect(started.statusCode, started.body).toBe(202);
    const run = await runSnapshot(started.json<{ run: RunRecord }>().run.id);
    expect(run).toMatchObject({ status: 'exhausted', outcome: 'exhausted', result: { passes: 3 } });
    const thread = ContextThreadSchema.parse((await t.app.inject(`/runs/${run.id}/thread`)).json());
    expect(thread.messages.filter((message) => message.content === 'One pass')).toHaveLength(3);
    const response = await t.app.inject(`/runs/${run.id}/events`);
    const events = response.json<{ items: { type: string; nodeId?: string }[] }>().items;
    expect(
      events.filter((event) => event.type === 'node.started' && event.nodeId === 'gate'),
    ).toHaveLength(3);
    expect(t.harness.started).toHaveLength(0);
  });

  it('validates the failure response shape and inventories the non-request snippets', () => {
    RunFailureSchema.parse(json('failure-shape'));
    expect(block('start-filename')).toBe('start.json');
    expect(block('editor-url')).toBe('/app/loops/<loop-id>/edit');
    expect(block('run-urls')).toContain('/app/runs/<run-id>');
    expect(block('auth-bash')).toBe('-H "Authorization: Bearer $GG_API_KEY"');
    expect(block('auth-powershell')).toBe('-Headers @{ Authorization = "Bearer $env:GG_API_KEY" }');
  });
});
