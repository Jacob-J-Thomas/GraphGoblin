import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { ModelCatalogEntry, OllamaConnectionView } from '@graphgoblin/contracts';
import { control, expect, openAdvanced, openNode, test } from './fixtures.js';

const exactModel = 'hf.co/organization/Exact-Qwen3.5-GGUF:Q4_K_M';
const unsupportedModel = 'embedding:latest';

/** Public read-only Ollama metadata endpoints; no model-generation endpoint exists here. */
async function metadataServer() {
  const state = { models: [exactModel, unsupportedModel], fail: false };
  const calls: { method: string; path: string; authorization: string | undefined }[] = [];
  let held: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? '';
      calls.push({
        method: request.method ?? '',
        path,
        authorization: request.headers.authorization,
      });
      response.setHeader('content-type', 'application/json');
      if (path === '/api/tags') {
        await held;
        if (state.fail) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: 'Synthetic unavailable service' }));
        } else
          response.end(
            JSON.stringify({
              models: state.models.map((model) => ({ model, digest: `sha256:${model}` })),
            }),
          );
        return;
      }
      if (path === '/api/show') {
        let text = '';
        for await (const chunk of request) text += String(chunk);
        const body = JSON.parse(text) as { model: string };
        response.end(
          JSON.stringify(
            body.model === unsupportedModel
              ? { capabilities: ['embedding'] }
              : { capabilities: ['completion', 'thinking'], details: { family: 'qwen35' } },
          ),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Only metadata endpoints are implemented' }));
    })().catch(() => {
      response.statusCode = 500;
      response.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    state,
    calls,
    hold() {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release() {
      release?.();
      held = undefined;
    },
    async close() {
      release?.();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test('Ollama connection discovers models and explicit refresh preserves enabled preferences', async ({
  page,
  request,
}, testInfo) => {
  const metadata = await metadataServer();
  const alternate = await metadataServer();
  alternate.state.fail = true;
  const instance = await control(request, '/apps', {
    requireApiKey: true,
    env: { GG_OLLAMA_ENABLED: 'false', GG_OLLAMA_URL: metadata.origin },
  });
  const url = String(instance['url']);
  const token = String(instance['token']);
  const headers = { authorization: `Bearer ${token}` };
  try {
    await page.addInitScript((key) => localStorage.setItem('graphgoblin-api-key', key), token);
    await page.goto(`${url}/app/settings`);
    const section = page.getByRole('region', { name: 'Ollama', exact: true });
    const connection = section.getByRole('button', { name: 'Connection', exact: true });
    await expect(connection).toHaveAttribute('aria-expanded', 'true');
    const address = section.getByRole('textbox', { name: 'Server address' });
    await address.fill(`${metadata.origin}/api`);
    await section.getByRole('button', { name: 'Save connection' }).click();
    await expect(section.getByRole('alert')).toHaveText(
      'Leave off /api. Enter only the address, like http://127.0.0.1:11434.',
    );
    await expect(address).toBeFocused();
    expect(metadata.calls).toHaveLength(0);
    await address.fill(`${metadata.origin}/`);
    await section.getByRole('checkbox', { name: 'Use Ollama on this gateway' }).check();
    await section.getByRole('button', { name: 'Save connection' }).click();
    const outcome = section.locator(':scope > [role="status"]');
    await expect(outcome).toHaveText('Ollama connection saved. Models refreshed.');
    await expect(address).toHaveValue(metadata.origin);
    const table = section.getByRole('table', { name: 'Ollama models' });
    const modelRow = table
      .getByRole('row')
      .filter({ has: page.getByText(exactModel, { exact: true }) });
    const enabled = modelRow.getByRole('switch');
    await expect(modelRow.getByText('Available', { exact: true })).toBeVisible();
    await expect(
      modelRow.getByText('none (no reasoning) (default none)', { exact: true }),
    ).toBeVisible();
    await expect(table.getByText('Unsupported', { exact: true })).toBeVisible();
    await enabled.click();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    const refresh = section.getByRole('button', { name: 'Refresh Ollama models' });
    metadata.state.models = [unsupportedModel];
    metadata.hold();
    const before = metadata.calls.filter((call) => call.path === '/api/tags').length;
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-busy', 'true');
    await expect(refresh).toBeFocused();
    await refresh.dispatchEvent('click');
    metadata.release();
    await expect(outcome).toHaveText('Ollama models refreshed.');
    await expect(modelRow.getByText('Missing', { exact: true })).toBeVisible();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    await expect(refresh).toBeFocused();
    expect(
      metadata.calls.filter((call) => call.path === '/api/tags').length - before,
    ).toBeGreaterThanOrEqual(1);
    metadata.state.models = [exactModel, unsupportedModel];
    await refresh.click();
    await expect(modelRow.getByText('Available', { exact: true })).toBeVisible();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    metadata.state.fail = true;
    await refresh.click();
    await expect(outcome).toContainText('Couldn’t refresh Ollama models:');
    await expect(section.locator('#ollama-status')).toContainText('Showing models from');
    await expect(modelRow.getByText('Available', { exact: true })).toBeVisible();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    metadata.state.fail = false;
    await refresh.click();
    await expect(outcome).toHaveText('Ollama models refreshed.');
    await address.fill(alternate.origin);
    await section.getByRole('button', { name: 'Save connection' }).click();
    await expect(outcome).toContainText('Ollama connection saved, but models couldn’t be listed:');
    await expect(
      modelRow.getByText('Not yet listed at the new address', { exact: true }),
    ).toBeVisible();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    await address.fill(metadata.origin);
    await section.getByRole('button', { name: 'Save connection' }).click();
    await expect(outcome).toHaveText('Ollama connection saved. Models refreshed.');
    await expect(modelRow.getByText('Available', { exact: true })).toBeVisible();
    const catalog = await request.get(`${url}/model-catalog`, { headers });
    const { items } = (await catalog.json()) as { items: ModelCatalogEntry[] };
    expect(
      items.find((entry) => entry.harness === 'ollama' && entry.model === exactModel),
    ).toMatchObject({ enabled: false, availability: { state: 'available' } });
    expect(
      metadata.calls.every(
        (call) =>
          ['/api/tags', '/api/show'].includes(call.path) && call.authorization === undefined,
      ),
    ).toBe(true);
    await connection.click();
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        document.documentElement.dataset['theme'] = value;
        localStorage.setItem('graphgoblin-theme', value);
      }, theme);
      for (const width of [360, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await section.scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`ollama-settings-${theme}-${width}.png`),
          fullPage: true,
        });
        if (width === 360 || width === 1440) {
          await section.screenshot({
            path: testInfo.outputPath(`ollama-section-${theme}-${width}.png`),
          });
          await connection.click();
          await section.screenshot({
            path: testInfo.outputPath(`ollama-connection-${theme}-${width}.png`),
          });
          await connection.click();
        }
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`ollama-settings-${theme}-zoom-200.png`),
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
    }
    await connection.click();
    await section.getByRole('checkbox', { name: 'Use Ollama on this gateway' }).uncheck();
    const beforeOff = metadata.calls.length;
    await section.getByRole('button', { name: 'Save connection' }).click();
    await expect(outcome).toHaveText('Ollama connection saved. Ollama is off.');
    await expect(refresh).toHaveAttribute('aria-disabled', 'true');
    await expect(modelRow.getByText('Ollama is off in Settings', { exact: true })).toBeVisible();
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    expect(metadata.calls).toHaveLength(beforeOff);
    const saved = await request.get(`${url}/harness/ollama/connection`, { headers });
    expect(((await saved.json()) as OllamaConnectionView).connection).toMatchObject({
      enabled: false,
      baseUrl: metadata.origin,
    });
  } finally {
    await request.put(`${url}/harness/ollama/connection`, {
      headers,
      data: { enabled: false, baseUrl: metadata.origin },
    });
    await metadata.close();
    await alternate.close();
  }
});

test('Ollama authoring makes provider limits explicit and corrects them in one undo step', async ({
  page,
  request,
}, testInfo) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const source = minimalLoop();
  const definition = {
    ...source,
    name: 'Ollama authoring limits',
    nodes: [
      source.nodes[0],
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: 'Keep deliberate loop context in the prompt.' },
          session: { policy: 'resume-own' },
          harnessOptions: {
            sandbox: 'workspace-write',
            approval: 'on-request',
            networkAccess: true,
          },
          contextFiles: [{ path: 'context.txt', template: 'Restore this with undo.' }],
          output: { schema: { jsonSchema: { type: 'object' }, repair: { enabled: true } } },
        },
      },
      source.nodes[1],
    ].map((node, index) => ({ ...node, ui: { x: index * 260, y: 80 } })),
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const created = await request.post(`${url}/loops`, { data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`${url}/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'infer');
  await dialog.getByText('Ollama', { exact: true }).click();
  await expect(
    dialog.getByText('6 settings here don’t work with Ollama.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Effort', { exact: true })).toHaveValue('');
  const settings = dialog.getByRole('tab', { name: /^Settings\b/ });
  const context = dialog.getByRole('tab', { name: /^Context\b/ });
  const prompt = dialog.locator('[data-field="prompt"] .cm-content');
  const conversation = dialog
    .getByRole('group', { name: 'Session', exact: true })
    .getByLabel('Conversation', { exact: true });
  await context.click();
  await expect(prompt).toHaveText('Keep deliberate loop context in the prompt.');
  await expect(conversation).toHaveValue('resume-own');
  await expect(conversation.locator('option:checked')).toHaveText(
    "Resume this node's conversation",
  );
  await expect(
    dialog.getByText('Ollama can’t resume a session. Choose Fresh, or switch harness.', {
      exact: true,
    }),
  ).toBeVisible();
  await settings.click();
  await dialog.getByRole('button', { name: 'Use Ollama limits' }).click();
  await expect(dialog.getByRole('button', { name: 'Use Ollama limits' })).toHaveCount(0);
  await expect(
    dialog.getByText('Changed 6 settings for Ollama. Undo restores them.', { exact: true }),
  ).toHaveCount(1);
  const undoShortcut = await page
    .getByRole('button', { name: /^Undo/ })
    .getAttribute('aria-keyshortcuts');
  if (!undoShortcut) throw new Error('The native editor did not expose its undo shortcut');
  await page.keyboard.press(undoShortcut.replace(/Z$/, 'z'));
  await expect(dialog.getByRole('radio', { name: 'Ollama', exact: true })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Use Ollama limits' })).toBeVisible();
  await context.click();
  await expect(conversation).toHaveValue('resume-own');
  await expect(prompt).toHaveText('Keep deliberate loop context in the prompt.');
  await settings.click();
  await dialog.getByRole('button', { name: 'Use Ollama limits' }).click();
  await openAdvanced(dialog);
  await expect(
    dialog.getByText(
      'Ollama doesn’t repair invalid structured output in the same session; an invalid result fails this step.',
      { exact: true },
    ),
  ).toBeVisible();
  await context.click();
  await expect(prompt).toHaveText('Keep deliberate loop context in the prompt.');
  await expect(
    dialog.getByText('Session: fresh (required for Ollama)', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Conversation', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Edit as JSON: Files', exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Edit as JSON: Input' })).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
    }, theme);
    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`ollama-context-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});
