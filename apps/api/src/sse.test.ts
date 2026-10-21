import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RunEventSchema,
  type LoopDefinitionInput,
  type RunRecord,
  type RunEvent,
} from '@graphgoblin/contracts';
import { FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
let base: string;

beforeEach(async () => {
  t = await createTestApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await t.close();
});

const waitLoop: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'sse',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { type: 'manual' } },
    { id: 'wait', kind: 'wait', label: 'W', config: { mode: 'input', prompt: 'go?' } },
    { id: 'done', kind: 'exit', label: 'D', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
    { id: 'e2', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
  ],
};

interface Frame {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

function parseFrames(text: string): Frame[] {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const frame: Frame = {};
      for (const line of chunk.split('\n')) {
        if (line.startsWith(':')) frame.comment = line.slice(1).trim();
        else if (line.startsWith('id: ')) frame.id = line.slice(4);
        else if (line.startsWith('event: ')) frame.event = line.slice(7);
        else if (line.startsWith('data: ')) frame.data = line.slice(6);
      }
      return frame;
    });
}

async function readAll(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe('SSE event stream', () => {
  it.each(['replay', 'terminal-check'] as const)(
    'rejects corrupt stored events before SSE headers during %s and releases its subscription',
    async (phase) => {
      const id = await t.publishLoop(waitLoop);
      const { run } = (
        await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
      ).json<{ run: RunRecord }>();
      await t.idle();
      await t.container.manager.provideInput(
        run.id,
        (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
        true,
      );
      await t.idle();
      const good = await t.container.repos.events.read(run.id);
      const seq = good.at(-1)!.seq + 1;
      await t.container.handle.client.execute({
        sql: 'INSERT INTO run_events (run_id, seq, ts, type, node_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
        args: [
          run.id,
          seq,
          FIXTURE_TS,
          'decision.made',
          'choose',
          JSON.stringify({ strategy: 'expression', route: 'yes' }),
        ],
      });
      const store = t.container.repos.events;
      const subscribe = store.subscribe.bind(store);
      const released = vi.fn();
      vi.spyOn(store, 'subscribe').mockImplementation((runId, listener) => {
        const unsubscribe = subscribe(runId, listener);
        return () => {
          unsubscribe();
          released();
        };
      });
      const page = await t.app.inject(`/runs/${run.id}/events`);
      expect(page.statusCode).toBe(500);
      expect(page.json()).toMatchObject({
        code: 'STORED_EVENT_INVALID',
        detail: `Stored run event does not conform: run ${run.id}, seq ${seq}, type decision.made`,
      });
      const response = await fetch(
        `${base}/runs/${run.id}/events?after=${phase === 'replay' ? 0 : seq}`,
        { headers: { accept: 'text/event-stream' } },
      );
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      const body = await response.text();
      expect(JSON.parse(body)).toEqual(page.json());
      expect(body).not.toContain(': connected');
      expect(body).not.toContain('id: ');
      expect(released).toHaveBeenCalledOnce();
    },
  );
  it('streams and pages the same decision evidence and exit evidence, advertised in OpenAPI', async () => {
    t.jev.isAvailable = false;
    const definition: LoopDefinitionInput = {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'evaluation-stream',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: 'Continue?' } },
        {
          id: 'decide',
          kind: 'decision',
          label: 'Choose',
          config: {
            kind: 'expression',
            jsonata: '"yes"',
            routes: [
              { id: 'yes', label: 'Yes', criteria: 'Continue' },
              { id: 'no', label: 'No', criteria: 'Stop' },
            ].map(({ id, label }) => ({ id, label })),
          },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: {},
        },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
        { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'decide' } },
        { id: 'c', from: { node: 'decide', port: 'yes' }, to: { node: 'done' } },
        { id: 'd', from: { node: 'decide', port: 'no' }, to: { node: 'done' } },
      ],
    };
    await t.container.repos.secretsFor('local').set('jev-api-key', 'synthetic-key');
    const id = await t.publishLoop(definition);
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    const response = await fetch(`${base}/runs/${run.id}/events`, {
      headers: { accept: 'text/event-stream' },
    });
    await t.container.manager.provideInput(
      run.id,
      (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
      true,
    );
    await t.idle();
    const streamed = parseFrames(await readAll(response))
      .filter((frame) => frame.event)
      .map((frame) => RunEventSchema.parse(JSON.parse(frame.data!)));
    const page = (await t.app.inject(`/runs/${run.id}/events`)).json<{ items: RunEvent[] }>();
    expect(streamed).toEqual(page.items);
    expect(streamed.find((event) => event.type === 'decision.made')).toMatchObject({
      diagnostics: [],
    });
    expect(streamed.find((event) => event.type === 'exit.evaluated')).toMatchObject({
      outcome: 'success',
    });
    const schema = (await t.app.inject('/openapi.json')).body;
    expect(schema).toContain('exit.evaluated');
    expect(schema).toContain('GateEvidence');
    expect(schema).toContain('EvaluationDiagnostic');
  });

  it('replays history, tails live events, and closes after the run finishes', async () => {
    const id = await t.publishLoop(waitLoop);
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();

    const response = await fetch(`${base}/runs/${run.id}/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);

    // Let the replay flush, then wake the run so the stream sees live events and the terminal event.
    await new Promise((r) => setTimeout(r, 50));
    await t.container.manager.provideInput(
      run.id,
      (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
      { ok: true },
    );
    await t.idle();
    const text = await readAll(response);
    const frames = parseFrames(text);
    expect(frames[0]?.comment).toBe('connected');
    const events = frames.filter((f) => f.event);
    expect(events.map((f) => f.event)).toEqual(
      expect.arrayContaining(['run.queued', 'run.waiting', 'run.woken', 'run.finished']),
    );
    expect(events.at(-1)?.event).toBe('run.finished');
    const seqs = events.map((f) => Number(f.id));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(JSON.parse(events[0]!.data!)).toMatchObject({ runId: run.id, seq: 1 });
  });

  it('resumes from Last-Event-ID and from the after query parameter', async () => {
    const id = await t.publishLoop(waitLoop);
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    await t.container.manager.provideInput(
      run.id,
      (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
      1,
    );
    await t.idle();
    const all = (await t.app.inject(`/runs/${run.id}/events`)).json<{
      items: { seq: number }[];
    }>();
    const total = all.items.length;

    const fromHeader = parseFrames(
      await readAll(
        await fetch(`${base}/runs/${run.id}/events`, {
          headers: { accept: 'text/event-stream', 'last-event-id': String(total - 2) },
        }),
      ),
    ).filter((f) => f.event);
    expect(fromHeader.map((f) => Number(f.id))).toEqual([total - 1, total]);

    const fromQuery = parseFrames(
      await readAll(
        await fetch(`${base}/runs/${run.id}/events?after=${total - 1}`, {
          headers: { accept: 'text/event-stream' },
        }),
      ),
    ).filter((f) => f.event);
    expect(fromQuery.map((f) => Number(f.id))).toEqual([total]);
  });

  describe('closing when the run is terminal', () => {
    async function finishedRun(): Promise<{ runId: string; total: number }> {
      const id = await t.publishLoop(waitLoop);
      const { run } = (
        await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
      ).json<{ run: RunRecord }>();
      await t.idle();
      await t.container.manager.provideInput(
        run.id,
        (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
        1,
      );
      await t.idle();
      const all = (await t.app.inject(`/runs/${run.id}/events`)).json<{
        items: { seq: number; type: string }[];
      }>();
      expect(all.items.at(-1)?.type).toBe('run.finished');
      return { runId: run.id, total: all.items.length };
    }

    async function timed(promise: Promise<string>): Promise<{ text: string; ms: number }> {
      const started = Date.now();
      const text = await promise;
      return { text, ms: Date.now() - started };
    }

    it('ends at once when the run is terminal and nothing follows the cursor', async () => {
      const { runId, total } = await finishedRun();
      const response = await fetch(`${base}/runs/${runId}/events`, {
        headers: { accept: 'text/event-stream', 'last-event-id': String(total) },
      });
      const { text, ms } = await timed(readAll(response));
      const frames = parseFrames(text);
      expect(frames).toEqual([{ comment: 'connected' }]);
      // Well under the 2 s grace and the 15 s heartbeat: the stream did not idle.
      expect(ms).toBeLessThan(1_000);
    });

    it('replays the events after Last-Event-ID and ends when the run is already terminal', async () => {
      const { runId, total } = await finishedRun();
      const response = await fetch(`${base}/runs/${runId}/events`, {
        headers: { accept: 'text/event-stream', 'last-event-id': String(total - 3) },
      });
      const { text, ms } = await timed(readAll(response));
      const events = parseFrames(text).filter((f) => f.event);
      expect(events.map((f) => Number(f.id))).toEqual([total - 2, total - 1, total]);
      expect(events.at(-1)?.event).toBe('run.finished');
      expect(ms).toBeLessThan(1_000);
    });

    it('ends promptly after the terminal event when the run finishes mid-stream', async () => {
      const id = await t.publishLoop(waitLoop);
      const { run } = (
        await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
      ).json<{ run: RunRecord }>();
      await t.idle();
      const response = await fetch(`${base}/runs/${run.id}/events`, {
        headers: { accept: 'text/event-stream' },
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      // Read until the replay has reached the parked run's waiting event.
      while (!text.includes('event: run.waiting')) {
        const { value } = await reader.read();
        text += decoder.decode(value, { stream: true });
      }
      await t.container.manager.provideInput(
        run.id,
        (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
        1,
      );
      const started = Date.now();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      expect(Date.now() - started).toBeLessThan(1_000);
      const events = parseFrames(text).filter((f) => f.event);
      expect(events.at(-1)?.event).toBe('run.finished');
    });
  });

  it('stops writing when the client disconnects', async () => {
    const id = await t.publishLoop(waitLoop);
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    const controller = new AbortController();
    const response = await fetch(`${base}/runs/${run.id}/events`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await new Promise((r) => setTimeout(r, 50));
    await t.container.manager.provideInput(
      run.id,
      (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
      1,
    );
    await t.idle();
    expect((await t.app.inject(`/runs/${run.id}`)).json<RunRecord>().status).toBe('succeeded');
  });
});
