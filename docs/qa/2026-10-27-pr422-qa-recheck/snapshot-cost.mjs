// Public built composition + real HTTP + SQLite. Port decorator counts returned evidence;
// event appends prepare valid large histories without measuring producer throughput.
import path from 'node:path';
import fs from 'node:fs';
import { createContainer, loadConfig, buildApp } from '../../../apps/api/dist/index.js';
import { RunManager } from '../../../packages/engine/dist/index.js';
import * as L from './lib.mjs';
const dir = path.join(L.ROOT,'snapshot-cost');
fs.mkdirSync(dir,{recursive:true});
const base = await createContainer(loadConfig({
  GG_DATA_DIR: dir, GG_DB_URL:'file:'+path.join(dir,'graphgoblin.db'),
  GG_MASTER_KEY:Buffer.alloc(32,9).toString('base64'), GG_SWAGGER_UI:'false',
}),{startTimers:false});
await base.start(); base.manager.stop();
let reads = [], measuring = false;
const store = base.ports.events;
const events = {
  append:(...a)=>store.append(...a), subscribe:(...a)=>store.subscribe(...a),
  read: async (...a) => {
    const result = await store.read(...a);
    if(measuring) reads.push({method:'read', rows:result.length,bytes:Buffer.byteLength(JSON.stringify(result))});
    return result;
  },
  recoveryFacts: async (...a) => {
    const result = await store.recoveryFacts(...a);
    const markers = [...new Map([result.lifecycle,result.failed,result.resumed].filter(Boolean).map(e=>[e.seq,e])).values()];
    if(measuring) reads.push({method:'recoveryFacts',rows:markers.length,bytes:Buffer.byteLength(JSON.stringify(markers)),nodes:result.reachedNodeIds.length});
    return result;
  },
};
const manager = new RunManager({...base.ports,events},base.settings);
const app = await buildApp({...base,manager},{logger:false});
const E = {dataDir:dir,measurements:[]};
const api = {
  base:'http://127.0.0.1:6660',
  async call(method,url,body) {
    const r=await fetch(api.base+url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    return {status:r.status,body:await r.json()};
  },
  async get(url){const r=await api.call('GET',url);if(r.status!==200)throw Error(JSON.stringify(r));return r.body;},
  async post(url,body={}){const r=await api.call('POST',url,body);if(r.status>=300)throw Error(JSON.stringify(r));return r.body;},
};
const median = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
try {
  await manager.start(); await app.listen({host:'127.0.0.1',port:6660});
  const run = await L.run(api,await L.publish(api,L.loop('Snapshot scaling',[L.waitNode()])));
  await L.state(api,run.id,['waiting']);
  let seq=(await api.get('/runs/'+run.id)).lastEventSeq;
  for(const target of [100,10000,50000]) {
    while(seq<target) {
      const n=Math.min(250,target-seq);
      await store.append(run.id,Array.from({length:n},()=>({type:'signal.received',name:'unrelated',payload:'x'.repeat(1024)})));
      seq+=n;
    }
    for(const endpoint of ['', '/observation']) {
      const samples=[]; reads=[]; measuring=true;
      let bytes;
      for(let i=0;i<12;i++) {
        const t=performance.now(); const response=await api.get(`/runs/${run.id}${endpoint}`);
        samples.push(performance.now()-t);bytes=Buffer.byteLength(JSON.stringify(response));
      }
      measuring=false;
      const fullReads=reads.filter(r=>r.method==='read');
      const record={events:target,endpoint:endpoint||'/runs/{id}',medianMs:median(samples.slice(2)),samplesMs:samples,
        responseBytes:bytes,fullReads:fullReads.length,markersPerRequest:reads.filter(r=>r.method==='recoveryFacts').map(r=>r.rows),reads};
      E.measurements.push(record);
      L.check(`${target} ${endpoint||'GET run'} bounded evidence`,fullReads.length===0 && reads.every(r=>r.rows<=3),record);
      console.log(JSON.stringify({events:target,endpoint:record.endpoint,medianMs:record.medianMs,responseBytes:bytes,fullReads:fullReads.length,markerRows:record.markersPerRequest}));
    }
  }
  E.runId=run.id;
} catch(error) {E.error=error.stack;L.check('snapshot scaling driver completed',false,String(error.stack));}
finally {await app.close();manager.stop();await base.dispose();L.save('snapshot-cost-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
