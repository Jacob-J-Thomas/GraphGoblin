/** Built-app evidence on an ephemeral API with temporary data; run before, then after. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../../apps/web');
const { chromium } = createRequire(join(web, 'package.json'))('@playwright/test');
const phase = process.argv[2] ?? 'after';
const states = new Set(process.argv.slice(3));
const server = spawn(
  process.execPath,
  ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'],
  {
    cwd: web,
    stdio: ['pipe', 'pipe', 'inherit'],
  },
);
let browser;
try {
  const base = await new Promise((done, reject) => {
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const ready = /GG_E2E_READY (\S+)/.exec(output);
      if (ready) done(ready[1]);
    });
    server.once('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  async function call(path, method, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return res.status === 204 ? undefined : res.json();
  }
  await call('/loops', 'POST', {
    definition: {
      schemaVersion: 1,
      name: 'nightly-triage',
      description: 'Review incoming issues every night.',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [{ id: 'edge', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
  });
  await call('/secrets/jev-api-key', 'PUT', { value: 'screenshot-only' });
  await call('/api-keys', 'POST', { label: 'CI runner', scopes: ['*'] });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const theme of ['dark', 'light']) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      await context.addInitScript((t) => localStorage.setItem('graphgoblin-theme', t), theme);
      const page = await context.newPage();
      const out = join(here, `${phase}-${theme}`);
      mkdirSync(out, { recursive: true });
      async function shot(name) {
        if (states.size > 0 && !states.has(name)) return;
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(out, `${name}-${viewport.width}.png`) });
      }
      await page.goto(`${base}/app/loops`);
      await page.getByRole('button', { name: 'Delete nightly-triage', exact: true }).waitFor();
      await page
        .getByRole('button', { name: 'Delete nightly-triage', exact: true })
        .scrollIntoViewIfNeeded();
      await shot('loops');
      await page.getByRole('button', { name: 'Delete nightly-triage', exact: true }).click();
      await shot('loops-confirm');
      for (const [name, label] of [
        ['model-confirm', 'Delete gpt-6-luna'],
        ['secret-confirm', 'Delete secret jev-api-key'],
        ['key-confirm', 'Revoke CI runner'],
      ]) {
        await page.goto(`${base}/app/settings`);
        const action = page.getByRole('button', { name: label, exact: true });
        await action.scrollIntoViewIfNeeded();
        if (phase === 'after') await action.click();
        await shot(name);
      }
      await context.close();
    }
  }
} finally {
  await browser?.close();
  const exited = once(server, 'exit');
  server.stdin.end('stop\n');
  await exited;
}
