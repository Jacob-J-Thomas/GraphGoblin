// Built gateway, real Windows console events, real script and fake Codex CLI.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
const E = { phases: [] }; let api, browser;
const effect = path.join(L.RECORD, 'effect.mjs');
const marker = n => path.join(L.ROOT, n + '.jsonl');
const release = n => path.join(L.ROOT, n + '.release');
const count = n => fs.existsSync(marker(n)) ? fs.readFileSync(marker(n), 'utf8').trim().split('\n').length : 0;
const sub = loopId => ({ id: 'sub', kind: 'subloop', label: 'Await child', config: { loopRef: { loopId, version: 'latest' } } });
async function phase(mode) {
  const name = 'nested2-' + mode; const consoleHost = mode === 'console';
  L.control('delay-ms.txt', '12000');
  api = await L.startApi(name, 6635, { GG_MAX_CONCURRENT_RUNS: '2', GG_SHUTDOWN_GRACE_MS: '1000' }, undefined, {consoleHost});
  const park = await L.run(api, await L.publish(api, L.loop(name + ' durable park', [L.waitNode()])));
  const waiting = await L.state(api, park.id, ['waiting']);
  const childLoop = await L.publish(api, L.loop(name + ' child', [L.scriptNode(effect, ['hold', marker(name), release(name)])]));
  const parent = await L.run(api, await L.publish(api, L.loop(name + ' parent', [sub(childLoop)])));
  const child = await L.until(async () => (await api.get('/runs?parent=' + parent.id)).items[0]);
  await L.until(() => count(name) === 1);
  const codexDef = L.loop(name + ' fake Codex', [L.inference()]);
  codexDef.nodes[1].config.harness = 'codex'; codexDef.nodes[1].config.model = 'gpt-5.5';
  const provider = await L.run(api, await L.publish(api, codexDef));
  await L.state(api, provider.id, ['running']);
  const queued = await L.run(api, await L.publish(api, L.loop(name + ' independent queue')));
  const queuedBefore = await api.get('/runs/' + queued.id);
  L.check(name + ' independent is queued before drain', queuedBefore.status === 'queued', queuedBefore);
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  await page.goto(api.base + '/app/runs/' + parent.id);
  let signal;
  if (consoleHost) {
    await L.sleep(800);
    const result = execFileSync(path.join(L.CLI,'console-tool.exe'), ['ctrlc', String(api.child.pid)], {windowsHide:true, encoding:'utf8'});
    signal = { delivered: true, output: result };
  } else signal = await api.post('/system/shutdown', {action:'drain'});
  const choice = await L.until(async () => {const s=await api.get('/system/shutdown'); return s.phase === 'awaiting-choice' ? s : false;});
  await page.getByText(/grace period elapsed/).waitFor({timeout:15000});
  const notice = await page.locator('body').innerText();
  L.check(name + ' notice explains drain and active work', /grace period elapsed/.test(notice) && /waiting|drain/i.test(notice), notice);
  await page.screenshot({path:path.join(L.RECORD,name+'-choice.png')});
  const waitingChoice = await api.post('/system/shutdown', {action:'wait'});
  await L.sleep(3200);
  const afterWait = await api.get('/system/shutdown');
  const stillQueued = await api.get('/runs/' + queued.id);
  const stillActive = await api.get('/runs/' + child.id);
  L.check(name + ' keep waiting has no new countdown', afterWait.phase === 'draining', afterWait);
  L.check(name + ' nested script continues and independent queue stays closed', stillActive.status === 'running' && stillQueued.status === 'queued' && count(name)===1, {stillActive,stillQueued});
  // A fake Codex turn's completion is delayed, not aborted by the terminal event.
  fs.writeFileSync(release(name), 'finish child');
  const ended = await Promise.race([api.exit, L.sleep(30000).then(()=>({timeout:true}))]);
  L.check(name + ' drains to process exit zero', ended.code===0, ended);
  await api.kill();
  L.control('delay-ms.txt');
  const restartAt = Date.now();
  api = await L.startApi(name,6635);
  const parentDone = await L.state(api,parent.id,['succeeded']);
  const childDone = await L.state(api,child.id,['succeeded']);
  const providerDone = await api.get('/runs/'+provider.id);
  const queuedDone = await L.state(api,queued.id,['succeeded']);
  const parkAfter = await api.get('/runs/'+park.id);
  const childEvents = await L.events(api,parent.id);
  const queueEvents = await L.events(api,queued.id);
  L.check(name + ' fake Codex finishes successfully through drain', providerDone.status==='succeeded',providerDone);
  L.check(name + ' exact awaited child completes once', (await api.get('/runs?parent='+parent.id)).items.length===1 && childEvents.filter(e=>e.type==='child_run.started').length===1 && childEvents.filter(e=>e.type==='child_run.finished').length===1 && count(name)===1,childEvents);
  L.check(name + ' durable wait keeps identity on restart', parkAfter.status==='waiting' && parkAfter.waiting.waitId===waiting.waiting.waitId,parkAfter);
  L.check(name + ' independent starts only after restart', queueEvents.filter(e=>e.type==='run.started').length===1 && queueEvents.filter(e=>e.type==='run.started').every(e=>Date.parse(e.ts)>=restartAt),{restartAt,queueEvents});
  E.phases.push({mode,signal,choice,waitingChoice,afterWait,queuedBefore,ended,parentDone,childDone,providerDone,queuedDone,parkAfter,queueEvents,notice});
  await api.stop(); await page.close();
}
try {
  browser=await chromium.launch({channel:'msedge',headless:true}); E.edge=browser.version();
  await phase('api'); await phase('console');
  // Hard process death while the parent awaits the same child across two wait visits.
  api=await L.startApi('hard2-child',6635);
  const def=L.loop('revisited child wait',[L.waitNode(),{id:'gate',kind:'decision',label:'Two visits',config:{kind:'expression',jsonata:'"again"',maxPasses:2,routes:[{id:'again',label:'Again',repeat:true},{id:'done',label:'Done'}]}}],{},[L.edge('a','start','park'),L.edge('b','park','gate'),L.edge('c','gate','park','again'),L.edge('d','gate','done','done'),L.edge('e','gate','done','limit-reached')]);
  const childLoop=await L.publish(api,def); const parent=await L.run(api,await L.publish(api,L.loop('hard parent',[sub(childLoop)])));
  const child=await L.until(async()=>(await api.get('/runs?parent='+parent.id)).items[0]);
  const first=await L.state(api,child.id,['waiting']); await api.kill(); api=await L.startApi('hard2-child',6635);
  const firstReopen=await api.get('/runs/'+child.id);
  L.check('hard kill mid-child reuses child and wait',firstReopen.waiting.waitId===first.waiting.waitId && (await api.get('/runs?parent='+parent.id)).items.length===1,firstReopen);
  await api.post('/runs/'+child.id+'/input',{waitId:first.waiting.waitId,input:'first'});
  const second=await L.until(async()=>{const s=await api.get('/runs/'+child.id);return s.status==='waiting' && s.waiting.waitId!==first.waiting.waitId ? s : false;});
  await api.kill(); api=await L.startApi('hard2-child',6635);
  const secondReopen=await api.get('/runs/'+child.id);
  const stale=await api.call('POST','/runs/'+child.id+'/input',{waitId:first.waiting.waitId,input:'stale'});
  L.check('stale wake cannot cross visit after hard restart',stale.status===409 && secondReopen.waiting.waitId===second.waiting.waitId,stale);
  await api.post('/runs/'+child.id+'/input',{waitId:secondReopen.waiting.waitId,input:'finish'});
  const done=await L.state(api,parent.id,['succeeded']); const ev=await L.events(api,parent.id);
  L.check('two hard restarts retain one child and one completion',ev.filter(e=>e.type==='child_run.started').length===1 && ev.filter(e=>e.type==='child_run.finished').length===1,ev);
  E.hard={parent,child,first,firstReopen,second,secondReopen,stale,done,events:ev};
} catch(error){E.error=String(error.stack); L.check('nested shutdown driver completed',false,E.error);}
finally { await browser?.close(); await L.cleanup(); L.save('nested-results.json',{checks:L.checks,evidence:E}); }
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
