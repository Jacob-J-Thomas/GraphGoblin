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
