import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test');
const store = await mkdtemp(join(tmpdir(), 'gg-wp-g2-240-baseline-'));
const url = 'http://127.0.0.1:5920';
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: { ...process.env, GG_PORT: '5920', GG_DATA_DIR: store, GG_WEB_DIST: resolve('apps/web/dist') },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let startup = '';
child.stdout.on('data', (chunk) => { startup += chunk; });
child.stderr.on('data', (chunk) => { startup += chunk; });
let browser;
try {
  for (let i = 0; ; i++) {
    if (await fetch(url + '/healthz').then((r) => r.ok).catch(() => false)) break;
    if (i === 120 || child.exitCode !== null) throw new Error('Startup failed: ' + startup);
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const arrivals = async (type, index) => {
    const res = await fetch(url + '/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, payload: { index } }),
    });
    if (res.status !== 202) throw new Error(await res.text());
  };
  for (let i = 0; i < 101; i++) await arrivals('chosen', i);
  let reads = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/events') reads.push(request.url());
  });
  await page.goto(url + '/app/events');
  await page.locator('tbody tr').nth(99).waitFor();
  const first = await page.locator('tbody').innerText();
  const firstReads = reads.length;
  await arrivals('chosen', 'first-arrival');
  await page.waitForTimeout(2400);
  console.log(JSON.stringify({ position: 'first page', unchanged: first === await page.locator('tbody').innerText(), backgroundReads: reads.length - firstReads, refreshControls: await page.getByRole('button', { name: 'Refresh', exact: true }).count() }));
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await page.getByText('All events loaded.', { exact: true }).waitFor();
  const older = await page.locator('tbody').innerText();
  const oldReads = reads.length;
  await arrivals('chosen', 'older-arrival');
  await page.waitForTimeout(2400);
  console.log(JSON.stringify({ position: 'older page', unchanged: older === await page.locator('tbody').innerText(), rows: await page.locator('tbody tr').count(), backgroundReads: reads.length - oldReads, newerNotice: await page.getByText(/new events|newer events/i).count() }));
  await arrivals('other', 'excluded');
  reads = [];
  await page.goto(url + '/app/events?type=chosen&before=2099-01-01T00%3A00%3A00.000Z');
  await page.getByText('other', { exact: true }).waitFor();
  console.log(JSON.stringify({ position: 'URL filters', reads: reads.map((value) => new URL(value).pathname + new URL(value).search), excludedTypeVisible: await page.getByText('other', { exact: true }).count(), url: new URL(page.url()).pathname + new URL(page.url()).search }));
  const filteredRows = await page.locator('tbody').innerText();
  const filteredReads = reads.length;
  await arrivals('chosen', 'filtered-arrival');
  await page.waitForTimeout(2400);
  console.log(JSON.stringify({ position: 'URL filters after arrival', unchanged: filteredRows === await page.locator('tbody').innerText(), backgroundReads: reads.length - filteredReads }));
  // The browser visibility event is the app's supported focus-refetch trigger.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2400);
  console.log(JSON.stringify({ position: 'synthetic visibility event', newArrivalVisible: await page.getByText('"filtered-arrival"', { exact: false }).count(), rowsChanged: filteredRows !== await page.locator('tbody').innerText(), url: new URL(page.url()).pathname + new URL(page.url()).search }));
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await exited;
  }
  console.log('Disposable store preserved; process stopped. Startup log and browser captures not kept.');
}
