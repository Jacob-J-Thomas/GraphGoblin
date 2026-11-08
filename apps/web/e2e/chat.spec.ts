import type { ChatConversation, ChatSession, ChatTurn } from '@graphgoblin/contracts';
import { control, expect, test } from './fixtures.js';

test('owner Chat recovers a lost native-turn acknowledgement by read only, and system loops stay editable', async ({
  page,
  request,
}, testInfo) => {
  const instance = await control(request, '/apps', {
    requireApiKey: true,
  });
  const url = String(instance['url']);
  const token = String(instance['token']);
  const headers = { authorization: `Bearer ${token}` };
  await control(request, '/harness/script', {
    instanceId: String(instance['instanceId']),
    turns: [
      {
        finalText: 'Owner native reply with exact result <strong>plain text</strong>.',
      },
    ],
  });
  await page.addInitScript((key) => localStorage.setItem('graphgoblin-api-key', key), token);
  let posts = 0;
  let recoveryReads = 0;
  let loseAcknowledgement = true;
  await page.route('**/chat/conversations/*/turns', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  await page.route('**/chat/conversations/*/requests/*', async (route) => {
    expect(route.request().method()).toBe('GET');
    recoveryReads++;
    await route.continue();
  });
  await page.goto(`${url}/app/`);
  await expect(page).toHaveURL(`${url}/app/chat`);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Chat', 'Loops', 'Runs', 'Events', 'Settings']);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Remember one native request.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  expect(posts).toBe(1);
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    void dialog.accept();
  });
  await page.reload();
  await expect(page.locator('[data-chat-reply]')).toHaveText(
    /Owner native reply with exact result <strong>plain text<\/strong>\./,
  );
  expect(posts).toBe(1);
  expect(recoveryReads).toBeGreaterThan(0);
  await expect(page.locator('[data-chat-reply] strong')).toHaveCount(0);
  const conversations = (await (
    await request.get(`${url}/chat/conversations`, { headers })
  ).json()) as { items: ChatConversation[] };
  const turns = (await (
    await request.get(`${url}/chat/conversations/${conversations.items[0]!.id}/turns`, { headers })
  ).json()) as { items: ChatTurn[] };
  expect(turns.items).toHaveLength(1);
  expect(turns.items[0]).toMatchObject({
    runStatus: 'succeeded',
    response: { reply: 'Owner native reply with exact result <strong>plain text</strong>.' },
  });
  const run = await request.get(`${url}/runs/${turns.items[0]!.runId}`, { headers });
  expect(await run.json()).toMatchObject({ status: 'succeeded' });
  const session = (await (
    await request.get(`${url}/chat/session`, { headers })
  ).json()) as ChatSession;
  await page.getByRole('link', { name: 'Loops', exact: true }).click();
  // Cards are semantic sections labelled by their headings.
  const systemCard = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'System loops', exact: true }) });
  await expect(systemCard.getByRole('link', { name: /^Gateway chat$/i })).toBeVisible();
  await expect(systemCard.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  await expect(
    page.getByText('No loops of your own yet. Create one above or import an export.'),
  ).toBeVisible();
  await systemCard.getByRole('link', { name: /^Edit Gateway chat$/i }).click();
  await expect(page.getByText('System', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Chat', exact: true })).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Open Chat', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Runs', exact: true })).toHaveCount(0);
  expect(session.systemLoopId).toBeTruthy();
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 900 });
  const voiceWrites: string[] = [];
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname.startsWith('/chat/voice/') && sent.method() !== 'GET')
      voiceWrites.push(`${sent.method()} ${new URL(sent.url()).pathname}`);
  });
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Set up voice', exact: true });
  await expect(setup.getByText('1. Choose a route', { exact: true })).toBeVisible();
  await expect(setup.getByRole('radio', { name: /On this gateway/ })).toBeVisible();
  await setup.getByRole('radio', { name: /Cloud provider/ }).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(setup.getByLabel('OpenAI API key', { exact: true })).toHaveValue('');
  await expect(setup.getByRole('button', { name: 'Save and test', exact: true })).toBeDisabled();
  await expect(setup.getByText(/OpenAI receives each audio clip/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('owner-voice-setup-360.png'), fullPage: true });
  await setup.getByRole('button', { name: 'Close', exact: true }).click();
  expect(voiceWrites).toEqual([]);
  // The disposable API uses its FakeClock; align the browser for the real expiry display.
  await page.clock.setFixedTime(new Date(turns.items[0]!.createdAt));
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
      localStorage.setItem('graphgoblin-theme', value);
    }, theme);
    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${url}/app/chat`);
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`owner-chat-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(`${url}/app/chat/devices`);
    await page.getByRole('button', { name: 'Pair a device', exact: true }).first().click();
    const pairing = page.getByRole('dialog', { name: 'Pair a device' });
    await expect(pairing.getByRole('heading', { name: 'This computer only' })).toBeVisible();
    await pairing.getByRole('button', { name: 'Generate pairing link', exact: true }).click();
    await expect(
      pairing.getByText(/For a phone, set up a reachable HTTPS gateway address first\./),
    ).toBeVisible();
    await expect(pairing.getByLabel('Pairing code', { exact: true })).toHaveText(/^[\w-]{43}$/);
    const pairingLink = await pairing
      .getByRole('link', { name: 'Open Goblin on this computer', exact: true })
      .getAttribute('href');
    expect(new URL(pairingLink!).origin).toBe(url);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`owner-pairing-${theme}-360.png`),
      fullPage: true,
    });
    await pairing.getByRole('button', { name: 'Done', exact: true }).click();
  }
});
