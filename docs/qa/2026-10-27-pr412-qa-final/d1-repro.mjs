// Minimal reproduction of D1: an approved, eligible run older than the previous pass's last
// root is skipped for one pass, and the status/notice claims nothing eligible could be cleaned.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, root, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('13-d1-repro');
const base = join(temp, 'gg-qa-412f-a-d1');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir: join(base, 'data'), port: 6620, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const nextPass = async (prev) => {
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    await sleep(250);
  }
};
try {
  const W = await api.createLoop(workLoop('D1'));
  const older = (await api.startRun(W, { text: 'older' })).id;
  await api.waitFinal(older);
  const newer = (await api.startRun(W, { text: 'newer' })).id;
  await api.waitFinal(newer);
  ev.log('older', older, 'newer', newer, 'older < newer', older < newer);
  ev.check('step 1: mark the newer run', (await api.mark([newer])).status === 200);
  setCapacity(capacityFile, PRESSURE);
  let s = await nextPass((await api.storage()).checkedAt);
  ev.log('step 2: first pressure pass', { state: s.state, deletedRuns: s.deletedRuns }, 'newer', (await api.get(`/runs/${newer}`)).status);
  ev.check('step 3: mark the older run right after the pass', (await api.mark([older])).status === 200);
  ev.log('older approval', (await api.run(older)).deletionApproval);
  s = await nextPass(s.checkedAt);
  const olderStatus = (await api.get(`/runs/${older}`)).status;
  ev.log('step 4: next pass', { state: s.state, deletedRuns: s.deletedRuns }, 'older run status', olderStatus);
  await page.goto(`${server.url}/app/runs`);
  const notice = page.getByRole('status', { name: 'Storage pressure' });
  await notice.waitFor({ timeout: 20_000 });
  ev.log('notice text while the approved older run is still present', JSON.stringify(await notice.innerText()));
  ev.check('pass after approving an eligible run does not claim nothing eligible', !(s.state === 'no-eligible' && olderStatus === 200), { state: s.state, olderStatus });
  s = await nextPass(s.checkedAt);
  ev.log('step 5: following pass', { state: s.state, deletedRuns: s.deletedRuns }, 'older run status', (await api.get(`/runs/${older}`)).status);
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  await browser.close();
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
