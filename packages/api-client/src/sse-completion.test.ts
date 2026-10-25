import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@graphgoblin/contracts';
import { FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  createGraphGoblinClient,
  GraphGoblinApiError,
  RunEventParseError,
  subscribeRunEvents,
} from './index.js';

const runId = FIXTURE_IDS.run;
const response = (body: string, init?: ResponseInit) => Promise.resolve(new Response(body, init));
const frame = (seq: number, type: 'run.cancelled' | 'run.resumed' | 'return.delivered') => {
  const event: RunEvent =
    type === 'run.cancelled'
      ? { runId, seq, ts: FIXTURE_TS, type }
      : type === 'run.resumed'
        ? { runId, seq, ts: FIXTURE_TS, type, actor: { kind: 'user', id: 'local' } }
        : { runId, seq, ts: FIXTURE_TS, type, channel: { kind: 'caller' }, target: 'run.result' };
  return `event: ${type}\ndata: ${JSON.stringify(event)}\nid: ${seq}\n\n`;
};
const complete = (after: number) =>
  `event: stream.complete\ndata: ${JSON.stringify({ after })}\n\n`;

describe('stream completion contract', () => {
  it('delivers historical terminals, resumes and delivery audits before authoritative completion', async () => {
    const seen: number[] = [];
    let requests = 0;
    const client = createGraphGoblinClient({
      baseUrl: 'http://api',
      fetch: () => {
        requests++;
        return response(
          frame(1, 'run.cancelled') +
            frame(2, 'run.resumed') +
            frame(3, 'run.cancelled') +
            frame(4, 'return.delivered') +
            complete(4),
        );
      },
    });
    const sub = subscribeRunEvents({
      client,
      runId,
      onEvent: (event) => {
        seen.push(event.seq);
      },
      backoff: { maxAttempts: 1 },
    });
    await sub.done;
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(sub.lastSeq).toBe(4);
    expect(requests).toBe(1);
  });

  it.each([387, 487])(
    'resolves an empty consumed-cursor response at %s without retry or cursor advance',
    async (after) => {
      let requests = 0;
      const errors: unknown[] = [];
      const sub = subscribeRunEvents({
        client: createGraphGoblinClient({
          baseUrl: 'http://api',
          fetch: () => {
            requests++;
            return response(': connected\n\n' + complete(after));
          },
        }),
        runId,
        after,
        onEvent: () => {
          throw new Error('unexpected event');
        },
        onError: (error) => {
          errors.push(error);
        },
        backoff: { maxAttempts: 1 },
      });
      await sub.done;
      expect(sub.lastSeq).toBe(after);
      expect(requests).toBe(1);
      expect(errors).toEqual([]);
    },
  );

  it('retries EOF after a terminal event from that cursor until completion is authoritative', async () => {
    const urls: string[] = [];
    const seen: number[] = [];
    const errors: unknown[] = [];
    const sub = subscribeRunEvents({
      client: createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: (request) => {
          urls.push(request.url);
          return response(
            urls.length === 1
              ? frame(1, 'run.cancelled')
              : frame(2, 'return.delivered') + complete(2),
          );
        },
      }),
      runId,
      onEvent: (event) => {
        seen.push(event.seq);
      },
      onError: (error) => {
        errors.push(error);
      },
      sleep: async () => {},
    });
    await sub.done;
    expect(seen).toEqual([1, 2]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/after=1$/);
    expect(errors).toHaveLength(1);
  });

  it.each([0, 8])(
    'rejects an initial corruption problem as typed fatal at cursor %s',
    async (after) => {
      let requests = 0;
      const problem = {
        status: 500,
        code: 'STORED_EVENT_INVALID',
        detail: 'Stored history could not be read.',
      };
      const errors: unknown[] = [];
      const sub = subscribeRunEvents({
        client: createGraphGoblinClient({
          baseUrl: 'http://api',
          fetch: () => {
            requests++;
            return response(JSON.stringify(problem), { status: 500 });
          },
        }),
        runId,
        after,
        onEvent: () => {
          throw new Error('unexpected event');
        },
        onError: (error) => {
          errors.push(error);
        },
        backoff: { maxAttempts: 1 },
      });
      await expect(sub.done).rejects.toBeInstanceOf(GraphGoblinApiError);
      await expect(sub.done).rejects.toMatchObject({ code: problem.code, problem });
      expect(sub.lastSeq).toBe(after);
      expect(requests).toBe(1);
      expect(errors).toEqual([]);
    },
  );

  it.each(['{', '{}', 'null', '{"after":999}'])(
    'rejects malformed completion %s without consuming its id',
    async (data) => {
      const sub = subscribeRunEvents({
        client: createGraphGoblinClient({
          baseUrl: 'http://api',
          fetch: () => response(`id: 999\nevent: stream.complete\ndata: ${data}\n\n`),
        }),
        runId,
        after: 8,
        onEvent: () => undefined,
        backoff: { maxAttempts: 1 },
      });
      await expect(sub.done).rejects.toBeInstanceOf(RunEventParseError);
      expect(sub.lastSeq).toBe(8);
    },
  );
});
