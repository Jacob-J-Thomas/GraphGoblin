import {
  ContextThreadSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  RunRecordSchema,
} from '@graphgoblin/contracts';
import { replayThread } from '@graphgoblin/domain';
import { replaySeedLoop } from '../scripts/replay-seed-fixture.js';
import { expect, publishLoop, test } from './fixtures.js';

test('a replay inspector shows inherited counters and values at its first event', async ({
  page,
  request,
}) => {
  const definition = LoopDefinitionSchema.parse(replaySeedLoop('Browser replay seed'));
  const loopId = await publishLoop(request, definition);
  const started = await request.post(`/loops/${loopId}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const source = RunRecordSchema.parse((await started.json()).run);
  await expect
    .poll(
      async () =>
        RunRecordSchema.parse(await (await request.get(`/runs/${source.id}`)).json()).status,
    )
    .toBe('succeeded');
  const sourceEvents = RunEventSchema.array().parse(
    (await (await request.get(`/runs/${source.id}/events`)).json()).items,
  );
  const queued = sourceEvents[0];
  const gateStart = sourceEvents.find(
    (event) => event.type === 'node.started' && event.nodeId === 'gate',
  );
  if (queued?.type !== 'run.queued' || !queued.initialThread || !gateStart)
    throw new Error('Missing source history');
  const expectedSeed = replayThread(queued.initialThread, sourceEvents, gateStart.seq - 1);
  const replay = await request.post(`/runs/${source.id}/replay`, { data: { nodeId: 'gate' } });
  expect(replay.status()).toBe(202);
  const fork = RunRecordSchema.parse((await replay.json()).run);
  await expect
    .poll(
      async () =>
        RunRecordSchema.parse(await (await request.get(`/runs/${fork.id}`)).json()).status,
    )
    .toBe('succeeded');
  await page.goto(`/app/runs/${fork.id}`);
  await page.getByRole('list', { name: 'Timeline' }).getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Thread at event 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Full thread JSON' }).click();
  const thread = ContextThreadSchema.parse(
    JSON.parse(await page.getByTestId('thread-json').innerText()),
  );
  expect(thread.counters).toEqual(expectedSeed.counters);
  expect(thread.gates).toEqual(expectedSeed.gates);
  expect(thread.run.iteration).toBe(expectedSeed.run.iteration);
  expect(thread.vars).toEqual(expectedSeed.vars);
  expect(thread.messages).toEqual(expectedSeed.messages);
});
