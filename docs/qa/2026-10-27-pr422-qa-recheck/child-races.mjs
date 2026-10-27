import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as L from './lib.mjs';
const E = { scenarios: {} };
const owned = [];
const batchTag = Date.now();
const session = [];
async function boot(name, scenario) {
  const dir = path.join(L.ROOT, 'b1-' + batchTag + '-' + name); fs.mkdirSync(dir, { recursive: true });
  const messages = [];
  const child = spawn(process.execPath, [path.join(L.RECORD, 'child-fixture.mjs')], {
    cwd: L.REPO, windowsHide: true, stdio: ['ignore','pipe','pipe','ipc'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GG_'))), GG_DATA_DIR: dir, GG_DB_URL: 'file:' + path.join(dir,'graphgoblin.db'),
      GG_HOST: '127.0.0.1', GG_PORT: '6662', GG_REQUIRE_API_KEY: 'false',
      GG_MASTER_KEY: Buffer.alloc(32,9).toString('base64'), GG_WEB_DIST: path.join(L.REPO,'apps/web/dist'), QA_SCENARIO: scenario },
  });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  child.on('message', m => { messages.push(m); session.push({pid:child.pid,name,...m});L.save('child-races-ipc.json',session);console.log('IPC '+name+' '+m.type); });
  L.save('child-races-owned.json', [...owned.map(a=>({pid:a.child.pid,dir:a.dir})),{pid:child.pid,dir}]);
  const exited = new Promise(resolve => child.once('exit', (code,signal) => resolve({ code,signal })));
  const api = { child, messages, dir, base: 'http://127.0.0.1:6662',
    message: (type) => L.until(() => messages.find(m => m.type === type)),
    release: (name) => child.send({ type: 'release', name }),
    async call(method, url, body) {
      const response = await fetch(api.base + url, { method,
        headers: body === undefined ? {} : { 'content-type':'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      return { status: response.status, body: await response.json() };
    },
    async get(url) { const r = await api.call('GET',url); if(r.status !== 200) throw Error(JSON.stringify(r)); return r.body; },
    async post(url, body = {}) { const r = await api.call('POST',url,body); if(r.status >= 300) throw Error(JSON.stringify(r)); return r.body; },
    async stop(hard = false) {
      if(child.exitCode === null && child.signalCode === null) hard ? child.kill('SIGKILL') : child.send({ type:'stop' });
      const result = await exited; L.save(`b1-${name}-${child.pid}.log.txt`,log); return result;
    },
    effects: () => fs.existsSync(path.join(dir,'effects.jsonl')) ? fs.readFileSync(path.join(dir,'effects.jsonl'),'utf8').trim().split('\n').map(JSON.parse) : [],
    logs: () => log,
  };
  owned.push(api);
  await api.message('ready'); return api;
}
try {
  for (const scenario of (process.env.QA_SCENARIOS ?? 'pending,early,different,restart').split(',')) {
    let api = await boot(scenario,scenario);
    const effectFile = path.join(api.dir,'effects.jsonl');
    const definition = L.loop('B1 child ' + scenario, ['a','b'].map(label => L.scriptNode(path.join(L.RECORD,'child-effect.mjs'),[effectFile,label,scenario],label)));
    const childLoop = await L.publish(api,definition);
    const parent = await L.run(api, await L.publish(api,L.loop('B1 parent ' + scenario,[{ id:'sub',kind:'subloop',label:'Child',config:{ loopRef:{ loopId:childLoop,version:'latest' } } }])));
    let earlyPromise, childId, childA;
    if (['early','different'].includes(scenario)) {
      const blocked = await api.message('parent-failure-blocked'); childId = blocked.childId;
      childA = await api.get('/runs/' + childId);
      earlyPromise = api.call('POST',`/runs/${childId}/resume`,{ observedSeq:childA.recovery.observedSeq,retryUncertainScript:true });
      earlyPromise.catch(()=>{});
      await api.message('child-resume-blocked'); api.release('parent-failure-blocked');
    }
    let failed = await L.state(api,parent.id,['failed']);
    childId ??= failed.failure.details.childRunId;
    childA ??= await api.get('/runs/' + childId);
    api.child.send({ type:'arm',parentId:parent.id,childId }); await api.message('armed');
    const consent = { observedSeq:failed.recovery.observedSeq,retryUncertainScript:true };
    const acceptedPromise = api.call('POST',`/runs/${parent.id}/resume`,consent);
    await api.message('parent-read-blocked');
    const accepted = await acceptedPromise;
    const pendingChild = await api.get('/runs/' + childId);
    const independent = earlyPromise ? undefined : await api.call('POST',`/runs/${childId}/resume`,{ observedSeq:childA.recovery.observedSeq,retryUncertainScript:true });
    L.check(scenario + ' pending child ownership refuses independent client', earlyPromise ? pendingChild.recovery.resume.code === 'PARENT_RECOVERY_REQUIRED' : independent.status === 409 && independent.body.code === 'PARENT_RECOVERY_REQUIRED',independent ?? pendingChild.recovery);
    let earlyResponse;
    if(earlyPromise) {
      api.release('child-resume-blocked'); earlyResponse = await earlyPromise;
      await L.until(async () => (await api.get('/runs/'+childId)).failure?.nodeId === (scenario === 'different' ? 'a' : 'b'));
      await L.until(() => api.effects().length === (scenario === 'different' ? 2 : 3));
    }
    const pendingEvents = await L.events(api,parent.id);
    const binding = pendingEvents.findLast(e => e.type === 'run.resumed')?.childRecovery;
    L.check(scenario + ' durable consent identifies A failure',binding?.runId === childId && binding.failureSeq === childA.recovery.observedSeq,binding);
    if(scenario === 'restart') { await api.stop(true); api = await boot(scenario,'reboot'); }
    else api.release('parent-read-blocked');
    let changed = await L.state(api,parent.id,['failed']);
    const expectedEffects = scenario === 'different' ? 2 : 3;
    await L.sleep(250);
    const changedChild = await api.get('/runs/' + childId);
    const old = await api.call('POST',`/runs/${parent.id}/resume`,consent);
    L.check(scenario + ' old consent adds no script dispatch', api.effects().length === expectedEffects && old.status === 409 && old.body.code === 'RECOVERY_STALE',{ effects:api.effects(),old,changed,changedChild });
    const noConsent = await api.call('POST',`/runs/${parent.id}/resume`,{ observedSeq:changed.recovery.observedSeq });
    if(scenario !== 'different') L.check(scenario + ' B needs new explicit consent',noConsent.status === 409 && noConsent.body.code === 'SCRIPT_CONSENT_REQUIRED',noConsent);
    const staleReason = api.logs().includes('RECOVERY_STALE') && api.logs().includes('parent child recovery refused; observing current child outcome');
    if(earlyPromise) L.check(scenario + ' changed child reason is explicit',staleReason,api.logs());
    E.scenarios[scenario] = { parentId:parent.id,childId,childA,accepted,pendingChild,independent,earlyResponse,binding,changed,changedChild,old,noConsent,staleReason,effectsBeforeFresh:api.effects() };
    if(scenario === 'different') {
      await L.state(api,parent.id,['succeeded']);
    } else {
      await api.post(`/runs/${parent.id}/resume`,{ observedSeq:changed.recovery.observedSeq,retryUncertainScript:true });
      await L.state(api,parent.id,['succeeded']);
    }
    L.check(scenario + ' fresh review recovers one identical child', (await api.get('/runs?parent='+parent.id)).items.length === 1 && api.effects().length === expectedEffects + (scenario === 'different' ? 2 : 1),api.effects());
    E.scenarios[scenario].finalEffects = api.effects();
    E.scenarios[scenario].parentEvents = await L.events(api,parent.id);
    E.scenarios[scenario].childEvents = await L.events(api,childId);
    await api.stop();
    L.save('child-races-results.json',{ checks:L.checks,evidence:E });
  }
} catch(error) { E.error = error.stack; L.check('child race driver completed',false,String(error.stack)); }
finally {
  for(const api of owned) await api.stop();
  L.save('child-races-results.json',{ checks:L.checks,evidence:E });
  L.save('child-races-processes.json',owned.map(a => ({pid:a.child.pid,code:a.child.exitCode,signal:a.child.signalCode})));
}
process.exitCode = L.checks.some(c => !c.passed) ? 1 : 0;
