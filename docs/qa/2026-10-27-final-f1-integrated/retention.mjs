// Real SQLite, scripts and fake provider CLI; capacity alone uses a public override.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
import * as C from './capacity.mjs';
let api,browser;const E={};const capacity=path.join(L.ROOT,'retention-capacity.json');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function tree(dir){const out={};if(!fs.existsSync(dir))return out;for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p);if(s.isSymbolicLink())out[n]='LINK';else if(s.isDirectory()){for(const [k,v] of Object.entries(tree(p)))out[n+'/'+k]=v;}else out[n]=hash(fs.readFileSync(p));}return out;}
const boot=async()=>api=await C.start('retention3-store',6636,capacity);
const finalized=async id=>L.until(async()=>{const s=await api.get('/runs/'+id);return s.finalizedAt?s:false;},60000);
async function all(){const ids=[];let cursor;do{const p=await api.get('/runs?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''));ids.push(...p.items.map(r=>r.id));cursor=p.nextCursor;}while(cursor);return ids;}
try{
 C.control(capacity,C.adequate);await boot();
 const source=`const fs=require('node:fs');fs.mkdirSync('nested');for(let i=0;i<Number(process.argv[1]);i++)fs.writeFileSync((i%2?'nested/':'')+'f'+i+'.txt','fixture-'+i);`;
 const writeNode={id:'files',kind:'script',label:'Disposable files',config:{command:process.execPath,args:['-e',source,'{{ trigger.payload.files }}'],cwd:'workspace'}};
 const def=L.loop('Retention fixture',[L.inference(),writeNode],{workingDirectory:{kind:'temp'}});const loop=await L.publish(api,def);
 const approved=[],retained=[];
 for(let i=0;i<6;i++){const r=(await api.post('/loops/'+loop+'/runs',{input:{files:1800}})).run;await finalized(r.id);approved.push(r.id);}
 for(let i=0;i<3;i++){const r=(await api.post('/loops/'+loop+'/runs',{input:{files:12}})).run;await finalized(r.id);retained.push(r.id);}
 const childLoop=await L.publish(api,L.loop('Retain required child'));const parent=await L.run(api,await L.publish(api,L.loop('Retain required parent',[{id:'sub',kind:'subloop',label:'Child',config:{loopRef:{loopId:childLoop,version:'latest'}}}])));await finalized(parent.id);
 const child=(await api.get('/runs?parent='+parent.id)).items[0];retained.push(parent.id,child.id);
 const pairPreview=await api.post('/runs/deletion-eligibility/preview',{runIds:[parent.id]});
 E.pairPreview=pairPreview;
 const pairMark=await api.call('POST','/runs/deletion-eligibility',{runIds:[parent.id],token:pairPreview.token,action:'mark',confirmed:true});
 L.check('required child prevents isolated parent approval',pairMark.status===409 && !(await api.get('/runs/'+parent.id)).deletionApproval,pairMark);
 const parked=await L.run(api,await L.publish(api,L.loop('Retain live park',[L.waitNode()])));await L.state(api,parked.id,['waiting']);retained.push(parked.id);
 const activePreview=await api.post('/runs/deletion-eligibility/preview',{runIds:[parked.id]});
 const activeMark=await api.call('POST','/runs/deletion-eligibility',{runIds:[parked.id],token:activePreview.token,action:'mark',confirmed:true});
 L.check('waiting history stays protected',activeMark.status===409,activeMark);
 const beforeList=await all();const retainedEvents={};for(const id of retained)retainedEvents[id]=hash(JSON.stringify(await L.events(api,id)));
 const retainedFiles=Object.fromEntries(retained.map(id=>[id,tree(path.join(api.dir,'workspaces',id))]));
 const unrelated=path.join(api.dir,'unrelated.txt');fs.writeFileSync(unrelated,'keep unrelated');
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(api.base+'/app/runs/'+approved[0]);
 await page.getByRole('button',{name:'Review delete-ready history',exact:true}).waitFor();
 await page.screenshot({path:path.join(L.RECORD,'retention-before.png')});
 const preview=await api.post('/runs/deletion-eligibility/preview',{runIds:approved});
 const marked=await api.post('/runs/deletion-eligibility',{runIds:approved,token:preview.token,action:'mark',confirmed:true});
 L.check('exact reviewed six-run selection approved',marked.items.length===6 && marked.items.every(i=>i.approval),marked);
 const approvedBefore=await all();
 L.check('adequate storage and approval do not delete history',JSON.stringify(beforeList)===JSON.stringify(approvedBefore),{beforeList,approvedBefore});
 await api.stop();C.control(capacity,C.pressure);await boot();
 const quarantine=path.join(api.dir,'cleanup-pending');
 const atKill=await L.until(()=>{if(!fs.existsSync(quarantine))return false;const names=fs.readdirSync(quarantine);for(const n of names){const p=path.join(quarantine,n);let entries;try{entries=fs.readdirSync(p).length;}catch{continue;}if(entries>0)return {name:n,entries};}return false;},60000);
 await api.kill();E.interrupted={...atKill,when:'quarantine exists with inventoried entries still present; real TerminateProcess'};
 L.check('cleanup interrupted after staging began',atKill.entries>0,atKill);
 await boot();
 await L.until(async()=>{const list=await all();return approved.every(id=>!list.includes(id));},90000);
 await L.until(async()=>{const s=await api.get('/system/storage');E.lastStorage=s;return !s.cleaning && (!fs.existsSync(quarantine)||fs.readdirSync(quarantine).length===0);},180000);
 const afterList=await all();
 L.check('paging after interruption contains exactly retained runs',afterList.length===retained.length && new Set(afterList).size===retained.length && retained.every(id=>afterList.includes(id)),{retained,afterList});
 for(const id of retained){L.check('retained history unchanged '+id,hash(JSON.stringify(await L.events(api,id)))===retainedEvents[id]);L.check('retained workspace bytes unchanged '+id,JSON.stringify(tree(path.join(api.dir,'workspaces',id)))===JSON.stringify(retainedFiles[id]));}
 L.check('unrelated file survives cleanup',fs.readFileSync(unrelated,'utf8')==='keep unrelated');
 const missing=await api.call('GET','/runs/'+approved[0]);L.check('approved inspector resource is now absent',missing.status===404,missing);
 await page.goto(api.base+'/app/runs/'+approved[0]);await page.screenshot({path:path.join(L.RECORD,'retention-deleted-inspector.png')});
 await page.goto(api.base+'/app/runs');await page.getByText(/Storage is low/).waitFor();await page.screenshot({path:path.join(L.RECORD,'retention-runs-after.png')});
 const listText=await page.locator('body').innerText();
 await page.goto(api.base+'/app/runs/'+retained[0]);await page.getByText('History retained.',{exact:true}).waitFor();await page.screenshot({path:path.join(L.RECORD,'retention-retained-inspector.png')});
 E.summary={approved,retained,beforeList,afterList,preview,marked,retainedEvents,retainedFiles,listText,storage:await api.get('/system/storage'),edge:browser.version()};
}catch(error){E.error=String(error.stack);L.check('retention driver completed',false,E.error);}
finally{await browser?.close();await L.cleanup();L.save('retention-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
