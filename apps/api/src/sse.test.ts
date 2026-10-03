import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
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
  schemaVersion: 1,
  name: 'sse',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
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
    await t.container.manager.provideInput(run.id, { ok: true });
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
    await t.container.manager.provideInput(run.id, 1);
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
      await t.container.manager.provideInput(run.id, 1);
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
      await t.container.manager.provideInput(run.id, 1);
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
    await t.container.manager.provideInput(run.id, 1);
    await t.idle();
    expect((await t.app.inject(`/runs/${run.id}`)).json<RunRecord>().status).toBe('succeeded');
  });
});
