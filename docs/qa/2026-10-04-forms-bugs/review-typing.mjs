/**
 * Isolated Edge typing check for the PR #52 review follow-up. Build first, then run:
 *   node docs/qa/2026-10-04-forms-bugs/review-typing.mjs before
 *   node docs/qa/2026-10-04-forms-bugs/review-typing.mjs after
 * Uses the existing E2E server, its temporary data directory, and the built web app.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../apps/web');
const require = createRequire(join(webRoot, 'package.json'));
const { chromium } = require('@playwright/test');
const phase = process.argv[2];
assert(['before', 'after'].includes(phase), 'Specify before or after');
const child = spawn(
  process.execPath,
  ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'],
  {
    cwd: webRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
  },
);
let browser;

try {
  const base = await new Promise((resolveUrl, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('E2E server startup timed out')), 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /GG_E2E_READY (\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`E2E server exited during startup: ${code}`));
    });
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2).slice(0, 60);

  async function openForm(kind, config) {
    const response = await fetch(`${base}/loops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        definition: {
          schemaVersion: 1,
          name: `typing ${kind}`,
          nodes: [
            {
              id: 'start',
              kind: 'trigger',
              label: 'Start',
              config: { subtype: 'manual' },
              ui: { x: 0, y: 80 },
            },
            { id: 'measure', kind, label: 'Measure', config, ui: { x: 260, y: 80 } },
            { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
          ],
          edges: [
            { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'measure' } },
            { id: 'e2', from: { node: 'measure', port: 'out' }, to: { node: 'done' } },
          ],
        },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    const id = body.loop.id;
    await page.goto(`${base}/app/loops/${id}/edit`);
    await page.getByTestId('node-measure').click();
    const form = page.getByRole('form', { name: 'measure config', exact: true });
    await form.getByLabel(kind === 'inference' ? 'Model' : 'Question', { exact: true }).waitFor();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    return form;
  }

  const inference = {
    prompt: { template: 'Measure' },
    model: 'bench',
    input: [],
    contextFiles: [],
  };
  const empty = await openForm('inference', inference);
  const baseFields = await empty.locator('[data-field]').count();
  let remaining = 457 - baseFields;
  let sets = Math.floor(remaining / 4);
  remaining %= 4;
  // A set mutation has four field groups, a delete two, and a context-file object three.
  if (remaining === 1) {
    sets -= 1;
    remaining += 4;
  }
  const contextFiles =
    remaining === 3 || remaining === 5 ? [{ path: 'context.txt', template: 'Context' }] : [];
  const deletes =
    remaining === 2 || remaining === 5 ? [{ op: 'delete', path: '/vars/removed' }] : [];
  inference.input = [
    ...Array.from({ length: sets }, (_, i) => ({
      op: 'set',
      path: `/vars/value${i}`,
      value: { kind: 'literal', value: i },
    })),
    ...deletes,
  ];
  inference.contextFiles = contextFiles;

  const results = [];
  for (const [kind, config, label] of [
    ['inference', inference, 'Model'],
    [
      'decision',
      {
        routes: Array.from({ length: 64 }, (_, i) => ({
          label: `route${i}`,
          description: 'Route',
        })),
        question: 'Choose a route',
        strategy: ['jev'],
      },
      'Description',
    ],
  ]) {
    const form = await openForm(kind, config);
    const fieldCount = await form.locator('[data-field]').count();
    if (kind === 'inference') assert.equal(fieldCount, 457);
    const controlCount = await form.locator('input, select, textarea, .cm-content').count();
    const target = form.getByLabel(label, { exact: true }).first();
    const rounds = [];
    for (let round = 1; round <= 2; round += 1) {
      await target.fill('bench');
      await target.focus();
      await page.evaluate(() => new Promise((done) => setTimeout(done, 800)));
      await page.evaluate(() => {
        window.typingTasks = [];
        window.typingObserver = new PerformanceObserver((list) => {
          window.typingTasks.push(...list.getEntries().map((entry) => entry.duration));
        });
        window.typingObserver.observe({ type: 'longtask' });
      });
      const start = performance.now();
      await target.pressSequentially(characters, { delay: 0 });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const elapsed = performance.now() - start;
      assert.equal(await target.inputValue(), `bench${characters}`);
      const tasks = await page.evaluate(() => {
        const durations = [
          ...window.typingTasks,
          ...window.typingObserver.takeRecords().map((entry) => entry.duration),
        ];
        window.typingObserver.disconnect();
        return durations;
      });
      rounds.push({
        round,
        characters: characters.length,
        elapsedMs: elapsed,
        msPerCharacter: elapsed / characters.length,
        longTaskCount: tasks.length,
        longTaskDurationsMs: tasks,
      });
    }
    results.push({ kind, fieldCount, controlCount, target: label, rounds });
  }
  const report = {
    phase,
    browser: await browser.version(),
    baseInferenceFields: baseFields,
    inferenceSetRows: sets,
    inferenceDeleteRows: deletes.length,
    inferenceContextFiles: contextFiles.length,
    method:
      '60 native keystrokes per round via Playwright pressSequentially, including completion through two animation frames; two rounds per form; no CPU throttling',
    results,
  };
  await writeFile(
    join(here, `review-typing-${phase}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.stdin.end('stop\n');
    const timer = setTimeout(() => child.kill(), 10_000);
    await stopped;
    clearTimeout(timer);
  }
}
