// #561 behaviour QA in real Edge: the inspector's runs.get / runs.observation success bodies cut short
// after headers (local proxy in front of the built API) present the offline class, not a raw
// transport error; before-headers, malformed JSON and HTTP refusal controls are unchanged.
import { chromium, EDGE, TOKENS, api, publish, startRun, minimalLoop, waitLoop, poll, sleep, uniq, caseDir, record, EV, appendJsonl } from './lib.mjs';

const PROXY = 'http://127.0.0.1:4821';
const arm = (mode, path, count = 1000) =>
  fetch('http://127.0.0.1:4822/', { method: 'POST', body: JSON.stringify({ mode, path, count }) }).then((r) => r.json());
const OFFLINE = 'Run needs the GraphGoblin API, which cannot be reached right now.';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
async function page() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript((t) => localStorage.setItem('graphgoblin-api-key', t), TOKENS.A);
  const p = await context.newPage();
  const failed = [];
  p.on('requestfailed', (r) => failed.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }));
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  return { context, p, failed, errors };
}
const bodyText = (p) => p.locator('main, body').first().innerText();

const results = [];
async function runCase(name, fn) {
  const dir = caseDir(`561-${name}`);
  const checks = [];
  const check = (n, actual, expected, ok = JSON.stringify(actual) === JSON.stringify(expected)) => checks.push({ name: n, expected, actual, pass: ok });
  let error;
  try {
    await fn(dir, check);
  } catch (e) {
    error = String(e?.stack ?? e).slice(0, 1500);
  } finally {
    await arm('pass', '', 0);
  }
  const pass = !error && checks.every((c) => c.pass);
  record(dir, 'result.json', { case: name, pass, error, checks });
  appendJsonl(`${EV}/qa/561-results.jsonl`, { case: name, pass, error: error?.slice(0, 300), failed: checks.filter((c) => !c.pass).map((c) => c.name) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${error ? ' ERROR ' + error.split('\n')[0] : ''}`);
  for (const c of checks) if (!c.pass) console.log('   x', c.name, JSON.stringify(c.expected), JSON.stringify(c.actual)?.slice(0, 300));
}

const finished = await startRun(await publish(minimalLoop(uniq('QA 561'))), {}, 'succeeded');

try {
  // C1: cold runs.get body cut short after a 200's headers -> the offline state.
  await runCase('C1-cold-get-mid', async (dir, check) => {
    await arm('mid', `/runs/${finished}`);
    const { context, p, failed } = await page();
    try {
      await p.goto(`${PROXY}/app/runs/${finished}`);
      await p.getByText(OFFLINE).waitFor({ timeout: 30_000 }).catch(() => {});
      await sleep(1500);
      const text = await bodyText(p);
      check('offline state shown', text.includes(OFFLINE), true);
      check('no "Could not load run"', text.includes('Could not load run'), false);
      check('no raw transport text (network error / Failed to fetch / TypeError)', /network error|Failed to fetch|TypeError/i.test(text), false);
      check('no Replay action offered', await p.getByRole('button', { name: 'Replay...', exact: true }).count(), 0);
      record(dir, 'browser-failed-requests.json', failed);
      await p.screenshot({ path: `${dir}/offline.png`, fullPage: true });
      // recovery once bodies arrive whole again
      await arm('pass', '', 0);
      await p.getByRole('heading', { name: `Run ${finished}` }).waitFor({ timeout: 45_000 }).catch(() => {});
      check('recovers to the run once bodies arrive whole (within 45 s, no reload)', await p.getByRole('heading', { name: `Run ${finished}` }).count(), 1);
      await p.screenshot({ path: `${dir}/recovered.png`, fullPage: true });
    } finally {
      await context.close();
    }
  });

  // C2 control: failure before headers -> the same offline state (unchanged).
  await runCase('C2-cold-get-before-headers', async (dir, check) => {
    await arm('before', `/runs/${finished}`);
    const { context, p } = await page();
    try {
      await p.goto(`${PROXY}/app/runs/${finished}`);
      await p.getByText(OFFLINE).waitFor({ timeout: 30_000 }).catch(() => {});
      const text = await bodyText(p);
      check('offline state shown', text.includes(OFFLINE), true);
      check('no "Could not load run"', text.includes('Could not load run'), false);
      await p.screenshot({ path: `${dir}/offline.png`, fullPage: true });
    } finally {
      await context.close();
    }
  });

  // C3 control: complete malformed JSON stays a non-offline error.
  await runCase('C3-cold-get-malformed', async (dir, check) => {
    await arm('malformed', `/runs/${finished}`);
    const { context, p } = await page();
    try {
      await p.goto(`${PROXY}/app/runs/${finished}`);
      await p.getByText('Could not load run').waitFor({ timeout: 30_000 }).catch(() => {});
      const text = await bodyText(p);
      check('"Could not load run" shown (not offline)', text.includes('Could not load run'), true);
      check('offline state not shown', text.includes(OFFLINE), false);
      record(dir, 'text.json', { excerpt: text.slice(0, 600) });
      await p.screenshot({ path: `${dir}/error.png`, fullPage: true });
    } finally {
      await context.close();
    }
  });

  // C4 control: an HTTP refusal keeps its typed error.
  await runCase('C4-cold-get-http503', async (dir, check) => {
    await arm('http503', `/runs/${finished}`);
    const { context, p } = await page();
    try {
      await p.goto(`${PROXY}/app/runs/${finished}`);
      await p.getByText('Could not load run').waitFor({ timeout: 30_000 }).catch(() => {});
      const text = await bodyText(p);
      check('"Could not load run" with the refusal', text.includes('Could not load run') && text.includes('QA_UNAVAILABLE'), true);
      check('offline state not shown', text.includes(OFFLINE), false);
      await p.screenshot({ path: `${dir}/error.png`, fullPage: true });
    } finally {
      await context.close();
    }
  });

  // C5: observation body cut short on a cold visit, compared with a before-headers observation failure.
  for (const mode of ['mid', 'before']) {
    await runCase(`C5-cold-observation-${mode}`, async (dir, check) => {
      await arm(mode, `/runs/${finished}/observation`);
      const { context, p } = await page();
      try {
        await p.goto(`${PROXY}/app/runs/${finished}`);
        await p.getByRole('heading', { name: `Run ${finished}` }).waitFor({ timeout: 30_000 }).catch(() => {});
        await sleep(4000);
        const text = await bodyText(p);
        const evidence = /Run evidence could not be read: ([^\n]*)/.exec(text)?.[1] ?? null;
        record(dir, 'observed.json', { evidence, excerpt: text.slice(0, 1500) });
        check('no raw transport text (TypeError / bare network error)', /TypeError|^network error$/i.test(evidence ?? ''), false);
        check('evidence error, if shown, is the typed status-0 class', evidence === null || /^(RESPONSE_INTERRUPTED|NETWORK_ERROR|The GraphGoblin API cannot be reached)/.test(evidence), true);
        await p.screenshot({ path: `${dir}/observation.png`, fullPage: true });
      } finally {
        await context.close();
      }
    });
  }

  // C6: warm. The run is shown; then a live change makes the inspector read the run again and that
  // body is cut short: the view goes to the offline class (last observed / reconnecting), no raw error.
  await runCase('C6-warm-get-mid', async (dir, check) => {
    const runId = await startRun(await publish(waitLoop(uniq('QA 561 warm'), { mode: 'input', prompt: 'Approve?' })), { triggerNodeId: 'start', input: {} }, 'waiting');
    const { context, p } = await page();
    try {
      await p.goto(`${PROXY}/app/runs/${runId}`);
      await p.getByRole('heading', { name: `Run ${runId}` }).waitFor({ timeout: 30_000 });
      await p.getByRole('button', { name: 'Submit input' }).waitFor();
      await arm('mid', `/runs/${runId}`);
      const run = (await api('GET', `/runs/${runId}`)).json;
      await api('POST', `/runs/${runId}/input`, { waitId: run.waiting.waitId, input: 'ok' });
      await sleep(5000);
      const text = await bodyText(p);
      record(dir, 'observed.json', { excerpt: text.slice(0, 2000) });
      check('no "Could not load run"', text.includes('Could not load run'), false);
      check('no raw transport text', /TypeError|Failed to fetch|network error/i.test(text), false);
      check('offline-class presentation (last observed or reconnecting)', /Last observed, may be out of date|cannot be reached; reconnecting|Reconnecting: reading this run again/.test(text), true);
      await p.screenshot({ path: `${dir}/warm-interrupted.png`, fullPage: true });
      await arm('pass', '', 0);
      await poll(async () => (await bodyText(p)).includes('Last observed, may be out of date'), (v) => v === false, { timeout: 45_000 }).catch(() => {});
      const after = await bodyText(p);
      check('recovers once bodies arrive whole', /Last observed, may be out of date|cannot be reached; reconnecting/.test(after), false);
      await p.screenshot({ path: `${dir}/warm-recovered.png`, fullPage: true });
    } finally {
      await context.close();
    }
  });
} finally {
  await browser.close();
}
