// Review findings 2 and 3, reproduced against real HTTP/SSE and built Edge.
// Only the transport response is held: snapshots come from the real gateway.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { makeTemp, removeTemp, startApi, restClient, cycle, edge_, edge, delay, until, inspectorState, logger, HERE } from './lib.mjs';
const log = logger('races.log.txt');
const data = await makeTemp('races');
const result = { checks: [] };
let server, browser;
function barrier() { let release; const promise = new Promise(r => release = r); return {promise, release}; }
function check(name, ok, detail) { result.checks.push({name, ok, detail}); log(ok ? 'PASS' : 'FAIL', name, detail); }
function waitingCycle(name, passes) {
  const d = cycle({name, passes});
  d.nodes.push({id:'answer', kind:'wait', label:'Answer', config:{mode:'input',prompt:'Continue?'}});
  d.edges.find(e => e.from.node === 'grow').to.node = 'answer';
  d.edges.push(edge_('answer','out','gate'));
  return d;
}
try {
  server = await startApi({port:6616, dataDir:data, log});
  const api = restClient(server.url);
  browser = await edge(); result.edgeVersion = browser.version();
  async function advance(id) {
    const r = await api.waitStatus(id,['waiting']);
    await api('POST',`/runs/${id}/input`,{waitId:r.waiting.waitId,input:'continue'});
  }
  // First read has no cached data. Hold its old snapshot until the final batch is seen.
  {
    const c = await browser.newContext(); const page = await c.newPage();
    const loop = await api.createLoop(waitingCycle('QA first-load race',2));
    const run = await api.start(loop.loop.id); await api.waitStatus(run.id,['waiting']);
    const held = barrier(); let captured, reads = 0;
    await page.route(`**/runs/${run.id}/thread`, async route => {
      reads++;
      const response = await route.fetch();
      if (!captured) { captured = await response.json(); await held.promise; }
      await route.fulfill({response});
    });
    try {
      await page.goto(`${server.url}/app/runs/${run.id}`);
      await until(() => captured, {what:'first HTTP thread snapshot captured'});
      await advance(run.id);
      await until(async () => (await api('GET',`/runs/${run.id}/thread`)).vars.n === 2);
      await advance(run.id);
      await until(async () => (await api.run(run.id)).finalizedAt);
      const final = await api('GET',`/runs/${run.id}/thread`);
      await until(async () => (await inspectorState(page)).timeline.stream === 'complete');
      await delay(1200); const readsWhileHeld = reads;
      held.release();
      await until(async () => isDeepStrictEqual((await inspectorState(page)).vars,final.vars), {what:'final context after overtaken initial read'});
      await page.getByRole('button',{name:'Full thread JSON',exact:true}).click();
      const full = JSON.parse(await page.getByTestId('thread-json').innerText());
      await delay(1500);
      check('first load overtaken by final live batch converges to entire final thread', captured.vars.n === 1 && final.vars.n === 2 && isDeepStrictEqual(full,final) && reads >= 2 && readsWhileHeld === 1, {capturedN:captured.vars.n, finalN:final.vars.n, readsWhileHeld, reads, entireThreadEqual:isDeepStrictEqual(full,final), settled:await inspectorState(page)});
    } finally { held.release(); await c.close(); }
  }
  // Return from a selected boundary while another batch overtakes the held current read.
  {
    const c = await browser.newContext(); const page = await c.newPage();
    const loop = await api.createLoop(waitingCycle('QA return-live race',3));
    const run = await api.start(loop.loop.id); await api.waitStatus(run.id,['waiting']);
    await page.goto(`${server.url}/app/runs/${run.id}`);
    await page.getByRole('heading',{name:'Current thread',exact:true}).waitFor();
    await until(async () => (await inspectorState(page)).vars?.n === 1);
    await delay(1200);
    const row = page.getByRole('list',{name:'Timeline',exact:true}).getByRole('button',{name:/node\.finished Grow/}).first();
    const seq = Number(await row.getAttribute('data-seq')); await row.click();
    await page.getByRole('heading',{name:`Thread at event ${seq}`,exact:true}).waitFor();
    await advance(run.id);
    await until(async () => (await api('GET',`/runs/${run.id}/thread`)).vars.n === 2);
    await delay(1400);
    const held = barrier(); let reads=0, inFlight=0, maximum=0, captured;
    await page.route(`**/runs/${run.id}/thread`, async route => {
      reads++; inFlight++; maximum = Math.max(maximum,inFlight);
      try {
        const response = await route.fetch();
        if (!captured) { captured=await response.json(); await held.promise; }
        await route.fulfill({response});
      } finally {inFlight--;}
    });
    try {
      await page.getByRole('button',{name:'Follow live',exact:true}).click();
      await until(() => captured, {what:'return current snapshot held'});
      await advance(run.id);
      await until(async () => (await api('GET',`/runs/${run.id}/thread`)).vars.n === 3);
      const waiting = await api.waitStatus(run.id,['waiting']);
      await until(async () => (await inspectorState(page)).timeline.total >= waiting.lastEventSeq);
      await delay(1700); const beforeRelease={reads,inFlight,maximum};
      held.release();
      await until(async () => (await inspectorState(page)).vars?.n === 3, {what:'latest context after serialized return'});
      check('return to current never overlaps another current-thread read and retains overtaking batch', captured.vars.n === 2 && beforeRelease.reads === 1 && maximum === 1 && reads >= 2, {capturedN:captured.vars.n,beforeRelease,reads,maximum,finalN:(await inspectorState(page)).vars?.n});
      await api('POST',`/runs/${run.id}/cancel`,{});
    } finally {held.release(); await c.close();}
  }
} catch(e) {result.error=String(e.stack??e); log('ERROR',result.error);}
finally {
  await browser?.close(); await server?.kill(); await removeTemp(data);
  result.ok=!result.error && result.checks.every(x=>x.ok);
  await writeFile(join(HERE,'races.json'),JSON.stringify(result,null,2)+'\n'); await log.flush();
}
