import { access } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const leaf = (result: string): LoopDefinitionInput => ({
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Native pinned child',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Continue?' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: JSON.stringify(result) } },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
    { id: 'b', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
  ],
});

it('retains a child pin through a real API restart and Replay while new runs use the new publish', async () => {
  const fixture = await createApiProcessFixture({ prefix: 'gg-wp-d1-int-pinned-' });
  try {
    const token = await fixture.createKey();
    const origin = `http://127.0.0.1:${fixture.port}`;
    async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await fetch(origin + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.ok, `${method} ${path}: ${response.status}`).toBe(true);
      return (await response.json()) as T;
    }
    const run = (id: string) => call<RunRecord>('GET', `/runs/${id}`);
    async function publish(definition: LoopDefinitionInput) {
      const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
      const { version } = await call<{ version: { id: string } }>(
        'POST',
        `/loops/${loop.id}/publish`,
      );
      return { loopId: loop.id, versionId: version.id };
    }
    let server = fixture.run();
    await fixture.ready(server, token);
    const childLoop = await publish(leaf('old'));
    const parentLoop = await publish({
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'Native pinned parent',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: { loopRef: { loopId: childLoop.loopId } },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: 'outputs.sub.value.result' },
        },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
        { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
      ],
    });
    async function waitingChild(parentId: string): Promise<RunRecord> {
      let child: RunRecord | undefined;
      await eventually(async () => {
        const { items } = await call<{ items: RunRecord[] }>('GET', `/runs?parent=${parentId}`);
        [child] = items;
        return items.length === 1 && child?.status === 'waiting';
      });
      if (!child) throw new Error('No waiting child');
      return child;
    }
    async function finish(parentId: string, versionId: string, result: string) {
      const child = await waitingChild(parentId);
      expect(child.versionId).toBe(versionId);
      await call('POST', `/runs/${child.id}/input`, { waitId: child.waiting!.waitId, input: true });
      await eventually(async () => (await run(parentId)).status === 'succeeded');
      expect(await run(parentId)).toMatchObject({ result });
      const { items } = await call<{ items: RunEvent[] }>(
        'GET',
        `/runs/${parentId}/events?limit=500`,
      );
      expect(items.filter((event) => event.type === 'child_run.started')).toHaveLength(1);
      expect(items.filter((event) => event.type === 'child_run.finished')).toHaveLength(1);
      return child;
    }
    const { run: original } = await call<{ run: RunRecord }>(
      'POST',
      `/loops/${parentLoop.loopId}/runs`,
      {},
    );
    const originalChild = await waitingChild(original.id);
    await call('PUT', `/loops/${childLoop.loopId}/draft`, { definition: leaf('new') });
    const { version: newer } = await call<{ version: { id: string } }>(
      'POST',
      `/loops/${childLoop.loopId}/publish`,
    );
    server.child.kill('SIGKILL');
    await server.waitForExit();
    server = fixture.run();
    await fixture.ready(server, token);
    expect((await finish(original.id, childLoop.versionId, 'old')).id).toBe(originalChild.id);
    const { run: next } = await call<{ run: RunRecord }>(
      'POST',
      `/loops/${parentLoop.loopId}/runs`,
      {},
    );
    await finish(next.id, newer.id, 'new');
    const { run: replay } = await call<{ run: RunRecord }>('POST', `/runs/${original.id}/replay`, {
      nodeId: 'sub',
    });
    expect((await finish(replay.id, childLoop.versionId, 'old')).id).not.toBe(originalChild.id);
  } finally {
    await fixture.dispose();
    await expect(access(fixture.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 180_000);
