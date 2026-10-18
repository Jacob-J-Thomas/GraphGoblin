import type { ContextThread, RunRecord } from '@graphgoblin/contracts';
import { approvalLoop, expect, openNode, publishLoop, test, triggerConfig } from './fixtures.js';

test('the published receiver address accepts a JSON delivery and creates a run', async ({
  page,
  request,
}) => {
  const definition = approvalLoop('Webhook receiver address');
  const config = triggerConfig('webhook', {
    authentication: { type: 'none' },
    body: { type: 'json' },
    eventType: { source: 'constant', value: 'webhook' },
  });
  const loopId = await publishLoop(request, {
    ...definition,
    nodes: definition.nodes.map((node) => (node.id === 'start' ? { ...node, config } : node)),
  });

  await page.goto(`/app/loops/${loopId}/edit`);
  const dialog = await openNode(page, 'start');
  await expect(dialog.getByLabel('Authentication recipe').locator('option:checked')).toHaveText(
    'None',
  );
  const receiver = dialog.getByRole('region', { name: 'Receiver', exact: true });
  const output = receiver.getByLabel('Receiver URL', { exact: true });
  const origin = new URL(page.url()).origin;
  await expect(output).toHaveText(`${origin}/hooks/••••••••`);
  await receiver.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(output).toHaveText(new RegExp(`^${origin}/hooks/[^•]+$`));
  const url = (await output.textContent())!.trim();
  expect(new URL(url).origin).toBe(origin);

  const payload = { message: 'receiver address browser test' };
  const accepted = await request.post(url, { data: payload });
  expect(accepted.status()).toBe(202);
  expect(await accepted.json()).toEqual({ accepted: true });
  await expect
    .poll(async () => {
      const response = await request.get(`/runs?loopId=${encodeURIComponent(loopId)}`);
      expect(response.ok()).toBe(true);
      return ((await response.json()) as { items: RunRecord[] }).items;
    })
    .toMatchObject([{ loopId }]);
  const runsResponse = await request.get(`/runs?loopId=${encodeURIComponent(loopId)}`);
  const { items } = (await runsResponse.json()) as { items: RunRecord[] };
  expect(items).toHaveLength(1);
  const threadResponse = await request.get(`/runs/${items[0]!.id}/thread`);
  expect(threadResponse.ok()).toBe(true);
  const thread = (await threadResponse.json()) as ContextThread;
  expect(thread.invocation.trigger).toMatchObject({ nodeId: 'start', payload });
});
