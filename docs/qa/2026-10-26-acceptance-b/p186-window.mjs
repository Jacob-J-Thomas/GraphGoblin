// #186 focused re-check: after Load older on an executing run, does the browsed window stay put
// while the live acknowledgement advances? Samples the mounted rows every 500 ms for 10 s.
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6457;
const log = logger('p186-window.log.txt');
const data = await makeTemp('186win');
const results = { attempts: [] };
let api;
let browser;
const rowsOf = (page) =>
  page.$$eval('ol[aria-label="Timeline"] button[data-seq]', (buttons) => buttons.map((b) => Number(b.dataset.seq)));
const headingOf = async (page) => {
  const text = await page.locator('h2').filter({ hasText: /^Timeline \(/ }).first().textContent();
  const m = /Timeline \((\d+) events, ([^)]+)\)/.exec(text ?? '');
  return m ? Number(m[1]) : NaN;
};
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loop = await rest.createLoop(cycle({ name: 'Window cycle', passes: 1_000_000 }));
  const run = await rest.start(loop.loop.id, {});
  await until(async () => (await rest('GET', `/runs/${run.id}`)).lastEventSeq >= 1500, { timeout: 300_000, interval: 500 });
  browser = await edge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.locator('ol[aria-label="Timeline"] button[data-seq]').first().waitFor({ timeout: 60_000 });
  await delay(5000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await rowsOf(page);
    await page.getByRole('button', { name: 'Load older' }).click();
    const samples = [];
    for (let i = 0; i < 20; i++) {
      await delay(500);
      const rows = await rowsOf(page);
      samples.push({ t: (i + 1) * 500, first: rows[0], last: rows.at(-1), count: rows.length, heading: await headingOf(page) });
    }
    const firsts = new Set(samples.slice(4).map((s) => `${s.first}-${s.last}`));
    const entry = { attempt, before: [before[0], before.at(-1)], samples, stableAfter2s: firsts.size === 1 };
    results.attempts.push(entry);
    log(JSON.stringify({ attempt, before: entry.before, ranges: samples.map((s) => `${s.t}:${s.first}-${s.last}/${s.heading}`), stableAfter2s: entry.stableAfter2s }));
    await page.getByRole('button', { name: 'Follow live' }).click();
    await delay(4000);
  }
  await rest('POST', `/runs/${run.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-window.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
