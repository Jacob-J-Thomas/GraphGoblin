import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { RunRecord } from '@graphgoblin/contracts';
import { control, expect, test } from './fixtures.js';

test('missing inherited session: decline, reload, choose fresh and follow it to success without a reload', async ({
  page,
  request,
}) => {
  const base = minimalLoop();
  const definition = {
    ...base,
    name: 'Missing session recovery',
    nodes: [
      base.nodes[0]!,
      {
        id: 'warm',
        kind: 'inference',
        label: 'Warm',
        config: { prompt: { template: 'Warm task' } },
      },
      {
        id: 'worker',
        kind: 'inference',
        label: 'Worker',
        config: {
          session: { policy: 'resume-previous' },
          model: 'gpt-6-luna',
          effort: 'low',
          prompt: { template: 'Original task with selected inputs' },
        },
      },
      base.nodes[1]!,
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'warm' } },
      { id: 'e2', from: { node: 'warm', port: 'out' }, to: { node: 'worker' } },
      { id: 'e3', from: { node: 'worker', port: 'out' }, to: { node: 'done' } },
    ],
  };
  await control(request, '/harness/script', {
    turns: [
      {},
      {
        announceSession: false,
        accepted: false,
        items: [],
        submission: 'session-missing',
        error: { code: 'HARNESS_SESSION_MISSING', message: 'Session removed from provider store' },
      },
      { finalText: 'Recovered task' },
    ],
  });
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  expect((await request.post(`/loops/${loop.id}/publish`)).status()).toBe(200);
  const started = await request.post(`/loops/${loop.id}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: RunRecord };
  await expect
    .poll(async () => ((await (await request.get(`/runs/${run.id}`)).json()) as RunRecord).status)
    .toBe('failed');
  await page.goto(`/app/runs/${run.id}`);
  await expect(page.getByText('Failed: HARNESS_SESSION_MISSING')).toBeVisible();
  await expect(
    page.getByText(/prior provider conversation will not be carried over/),
  ).toBeVisible();
  expect((await request.post(`/runs/${run.id}/resume`)).status()).toBe(409);
  await page.reload();
  await expect(page.getByText('Failed: HARNESS_SESSION_MISSING')).toBeVisible();
  const choose = page.getByRole('button', { name: 'Start fresh session for worker' });
  await expect(choose).toBeEnabled();
  await choose.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await (await request.get(`/runs/${run.id}`)).json()) as RunRecord).status)
    .toBe('succeeded');
  const finished = (await (await request.get(`/runs/${run.id}`)).json()) as RunRecord;
  // Without a reload: the inspector keeps observing the recovered run to its outcome.
  await expect(
    page.getByText(new RegExp(`Timeline \\(${finished.lastEventSeq} events`)),
  ).toBeVisible();
  await expect(
    page.getByText(/chose a fresh session for worker; prior provider context was not carried over/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start fresh session for worker' })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText(/chose a fresh session for worker; prior provider context was not carried over/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start fresh session for worker' })).toHaveCount(0);
});
