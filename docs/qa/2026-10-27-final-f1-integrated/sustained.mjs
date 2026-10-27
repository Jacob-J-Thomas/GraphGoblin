// Sustained real Edge/SSE observation. No execution cap is inferred from sample time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
import * as C from './capacity.mjs';
import {cycle,recordRequests,countByKind,latencyByKind,inspectorState,heapMiB,sessionStorageBytes,processMemory} from './observation-lib.mjs';
const E={samples:[]};let api,browser;const cap=path.join(L.ROOT,'sustained-capacity.json');
const sse={count:0,last:0,gaps:[],complete:null,bytes:0};const digest=crypto.createHash('sha256');let streamPromise;
async function follow(id){const response=await fetch(api.base+'/runs/'+id+'/events?after=0',{headers:{accept:'text/event-stream'}});const reader=response.body.getReader();const decoder=new TextDecoder();let text='';for(;;){const {done,value}=await reader.read();if(done)break;sse.bytes+=value.length;digest.update(value);text+=decoder.decode(value,{stream:true});let i;while((i=text.indexOf('\n\n'))>=0){const frame=text.slice(0,i);text=text.slice(i+2);const match=/^id: (\d+)$/m.exec(frame);if(match){const seq=Number(match[1]);if(seq!==sse.last+1)sse.gaps.push({from:sse.last,to:seq});sse.last=seq;sse.count++;}if(frame.includes('event: stream.complete'))sse.complete=JSON.parse(/^data: (.+)$/m.exec(frame)[1]);}}sse.sha256=digest.digest('hex');return sse;}
try{
 C.control(cap,C.pressure);api=await C.start('sustained2-store',6638,cap);
 const def=n=>{const d=cycle({name:n,passes:4000});d.nodes.splice(1,0,L.inference('provider'));d.edges=d.edges.filter(e=>e.from.node!=='start');d.edges.push(L.edge('to-fake','start','provider'),L.edge('from-fake','provider','grow'));return d;};
 const a=await L.run(api,await L.publish(api,def('Observed cyclic A')));const b=await L.run(api,await L.publish(api,def('Concurrent cyclic B')));E.runs={a,b};streamPromise=follow(a.id);
 browser=await chromium.launch({channel:'msedge',headless:true});E.edge=browser.version();const context=await browser.newContext({viewport:{width:1440,height:1050}});const rec=recordRequests(context);
 let page;let previous;
 async function sample(label,seconds){const start=Date.now();const a0=await api.get('/runs/'+a.id);const b0=await api.get('/runs/'+b.id);await L.sleep(seconds*1000);const a1=await api.get('/runs/'+a.id);const b1=await api.get('/runs/'+b.id);const elapsed=(Date.now()-start)/1000;const reqs=rec.all.filter(r=>r.t>=start);const sample={label,elapsed,A:{from:a0.lastEventSeq,to:a1.lastEventSeq,rate:(a1.lastEventSeq-a0.lastEventSeq)/elapsed,status:a1.status},B:{from:b0.lastEventSeq,to:b1.lastEventSeq,rate:(b1.lastEventSeq-b0.lastEventSeq)/elapsed,status:b1.status},apiMemory:await processMemory(api.child.pid),requests:countByKind(reqs),latency:latencyByKind(reqs)};if(page){sample.heapMiB=await heapMiB(page);sample.sessionStorageBytes=await sessionStorageBytes(page);sample.view=await inspectorState(page);}E.samples.push(sample);L.save('sustained-progress.json',E);console.log(JSON.stringify(sample));previous=sample;return sample;}
 await sample('baseline without inspector',15);
 page=await context.newPage();await page.goto(api.base+'/app/runs/'+a.id);await page.getByRole('heading',{name:/Timeline \(/}).waitFor();
 await L.until(async()=>{const s=await inspectorState(page);return s.timeline.stream==='live' && s.threadHeading==='Current thread';},60000);
 const opened=await api.get('/runs/'+a.id);E.openedSeq=opened.lastEventSeq;
 await page.getByText('History retained.',{exact:true}).waitFor();await page.getByText(/Storage is low/).waitFor();
 await page.getByRole('button',{name:'Review delete-ready history',exact:true}).click();
 await page.getByRole('dialog').waitFor();E.eligibilityDialog=await page.getByRole('dialog').innerText();await page.screenshot({path:path.join(L.RECORD,'sustained-storage-eligibility.png')});
 L.check('live run deletion panel refuses protected work',await page.getByRole('button',{name:'Confirm delete-ready selection',exact:true}).isDisabled(),E.eligibilityDialog);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 for(let i=0;i<30;i++){const s=await sample('live '+i,15);if(s.A.to>=E.openedSeq+11000)break;}
 const last=await api.get('/runs/'+a.id);E.followedEvents=last.lastEventSeq-E.openedSeq;
 L.check('Edge followed at least 10000 additional events',E.followedEvents>=10000,E.followedEvents);
 await page.screenshot({path:path.join(L.RECORD,'sustained-over-10000.png')});
 // Detach the observer briefly to measure the same history range without it.
 await page.close();page=undefined;await sample('late baseline without inspector',15);
 page=await context.newPage();await page.goto(api.base+'/app/runs/'+a.id);await page.getByRole('heading',{name:/Timeline \(/}).waitFor();
 await L.until(async()=>(await api.get('/runs/'+a.id)).status==='succeeded' && (await api.get('/runs/'+b.id)).status==='succeeded',180000);
 await L.until(async()=>{const s=await inspectorState(page);return s.status==='succeeded' && s.timeline.stream==='complete';},90000);
 const finalA=await api.get('/runs/'+a.id),finalB=await api.get('/runs/'+b.id);const finalView=await inspectorState(page);const thread=await api.get('/runs/'+a.id+'/thread');
 E.final={A:finalA,B:finalB,view:finalView,vars:thread.vars,heapMiB:await heapMiB(page),cacheBytes:await sessionStorageBytes(page),requests:countByKind(rec.all),latency:latencyByKind(rec.all)};
 L.check('both cyclic runs naturally succeed at authored count',thread.vars.n===4000 && finalA.status==='succeeded' && finalB.status==='succeeded',E.final);
 L.check('browser row count and cache stay bounded',E.samples.filter(s=>s.view).every(s=>s.view.rowsMounted<=80 && s.sessionStorageBytes<3*1024*1024) && finalView.rowsMounted<=80,E.samples.filter(s=>s.view).map(s=>({seq:s.A.to,heap:s.heapMiB,cache:s.sessionStorageBytes,rows:s.view.rowsMounted})));
 L.check('live following issued no historical thread reads',!rec.all.some(r=>r.kind==='thread?at'),countByKind(rec.all));
 E.sse=await Promise.race([streamPromise,L.sleep(10000).then(()=>({timeout:true}))]);
 L.check('SSE contiguous through authoritative final completion',sse.gaps.length===0 && sse.complete?.after===finalA.lastEventSeq && sse.last===finalA.lastEventSeq,E.sse);
 await page.screenshot({path:path.join(L.RECORD,'sustained-final.png')});
 L.save('sustained-requests.json',rec.all);
}catch(error){E.error=String(error.stack);L.check('sustained driver completed',false,E.error);}
finally{await browser?.close();await L.cleanup();await streamPromise?.catch(()=>{});L.save('sustained-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
