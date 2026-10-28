import {pathToFileURL} from 'node:url';import * as L from './lib.mjs';import {recipe} from './recipe.mjs';import {createHash} from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
const rec=new L.Recorder('adversarial'),{find,correct,sql}=recipe(),j=JSON.stringify,cp=x=>JSON.parse(j(x));
const schemas=[['loop_versions','id TEXT,status TEXT,definition TEXT'],['settings','key TEXT,value TEXT'],['model_catalog','harness TEXT,model TEXT,efforts TEXT,default_effort TEXT'],['runs','id TEXT,pinned TEXT,failure TEXT'],['run_events','run_id TEXT,seq INTEGER,type TEXT,payload TEXT'],['harness_sessions','run_id TEXT,node_id TEXT,attempt INTEGER,effort TEXT'],['webhook_receipts','id TEXT,intent TEXT'],['event_receipts','id TEXT,intent TEXT']];
const trigger="CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";
async function init(db){for(const [t,s]of schemas)await db.execute(`CREATE TABLE ${t} (${s})`);await db.execute(trigger)}
const pin=()=>({defaults:{owner:{byHarness:{codex:{effort:'minimal'},claude:{effort:'minimal'}}},process:{byHarness:{codex:{effort:'minimal'},claude:{effort:'minimal'}}}}});
const fixedPin=()=>JSON.parse(j(pin()).replaceAll('minimal','none'));
const row=(table,value,fixed=value)=>({table,value,fixed});
const lv=(id,d,status='draft',fixed=d)=>row('loop_versions',{id,status,definition:typeof d==='string'||d===null?d:j(d)},{id,status,definition:typeof fixed==='string'||fixed===null?fixed:j(fixed)});
const ev=(seq,p,fixed=p,type='decision.made')=>row('run_events',{run_id:'r',seq,type,payload:typeof p==='string'||p===null?p:j(p)},{run_id:'r',seq,type,payload:typeof fixed==='string'||fixed===null?fixed:j(fixed)});
async function scenario(name,fixtures,beforeCounts,afterCounts){
 try{await L.withDb(L.makeStore('edge'),async db=>{
  await init(db);const refs=[];
  for(const f of fixtures){const cols=Object.keys(f.value),r=await db.execute({sql:`INSERT INTO ${f.table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,args:Object.values(f.value)});refs.push({...f,rowid:r.lastInsertRowid});}
  const count=rs=>({typed:rs.filter(r=>r.place!=='unreadable').length,unreadable:rs.filter(r=>r.place==='unreadable').length});
  const before=count((await db.execute(find)).rows);await db.executeMultiple(correct);
  const mismatches=[];for(const f of refs){const actual=(await db.execute({sql:`SELECT * FROM ${f.table} WHERE rowid=?`,args:[f.rowid]})).rows[0];for(const [k,v]of Object.entries(f.fixed))if(actual[k]!==v)mismatches.push({table:f.table,column:k,expectedBytes:typeof v==='string'?Buffer.byteLength(v):v,actualBytes:typeof actual[k]==='string'?Buffer.byteLength(actual[k]):actual[k]});}
  const after=count((await db.execute(find)).rows),triggerOK=(await db.execute("SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0]?.sql===trigger;
  await db.executeMultiple(correct);for(const f of refs){const actual=(await db.execute({sql:`SELECT * FROM ${f.table} WHERE rowid=?`,args:[f.rowid]})).rows[0];for(const [k,v]of Object.entries(f.fixed))if(actual[k]!==v)mismatches.push({repeat:true,table:f.table,column:k});}
  rec.check(name,j(before)===j(beforeCounts)&&j(after)===j(afterCounts)&&triggerOK&&mismatches.length===0,{before,after,triggerOK,mismatches});
 });}catch(e){rec.check(name,false,{error:String(e.message)});}
}
const counts=(typed,unreadable=0)=>({typed,unreadable});
await scenario('malformed JSON in every read column; valid siblings corrected and all damage preserved',[
 lv('d','{"nodes":'),lv('s','[','snapshot'),row('settings',{key:'defaults',value:'not-json'}),row('settings',{key:'custom',value:'not-json'}),
 row('model_catalog',{harness:'codex',model:'bad',efforts:'not-json',default_effort:'minimal'},{harness:'codex',model:'bad',efforts:'not-json',default_effort:'none'}),
 row('runs',{id:'pin',pinned:'not-json',failure:'{"missingSession":{"effort":"minimal"}}'},{id:'pin',pinned:'not-json',failure:'{"missingSession":{"effort":"none"}}'}),
 row('runs',{id:'failure',pinned:j(pin()),failure:'not-json'},{id:'failure',pinned:j(fixedPin()),failure:'not-json'}),
 ev(1,'{"effort":','{"effort":','harness.session'),row('webhook_receipts',{id:'w',intent:'not-json'}),row('event_receipts',{id:'e',intent:'not-json'}),
 row('harness_sessions',{run_id:'r',node_id:'n',attempt:1,effort:'minimal'},{run_id:'r',node_id:'n',attempt:1,effort:'none'})
],counts(4,9),counts(0,9));
await scenario('NULL in every JSON column, including a snapshot; nullable session effort remains NULL',[
 lv('d',null),lv('s',null,'snapshot'),row('settings',{key:'defaults',value:null}),row('model_catalog',{harness:'codex',model:'null',efforts:null,default_effort:null}),row('runs',{id:'r',pinned:null,failure:null}),ev(1,null),row('webhook_receipts',{id:'w',intent:null}),row('event_receipts',{id:'e',intent:null}),row('harness_sessions',{run_id:'r',node_id:'n',attempt:1,effort:null})
],counts(0),counts(0));
await scenario('NULL siblings do not block correction of catalog default, valid pinned or valid failure',[
 row('model_catalog',{harness:'codex',model:'null',efforts:null,default_effort:'minimal'},{harness:'codex',model:'null',efforts:null,default_effort:'none'}),
 row('runs',{id:'p',pinned:j(pin()),failure:null},{id:'p',pinned:j(fixedPin()),failure:null}),row('runs',{id:'f',pinned:null,failure:'{"missingSession":{"effort":"minimal"}}'},{id:'f',pinned:null,failure:'{"missingSession":{"effort":"none"}}'})
],counts(3),counts(0));
for(const bad of ['', 'not-json','"unterminated','[1,','{'])await scenario('CASE guards skip malformed input '+j(bad),[lv('d',bad)],counts(0,1),counts(0,1));
const mixed=['abc',7,true,null,[],{}, {id:'work',kind:'inference',config:{effort:'minimal'}}];
const mixDef={nodes:mixed,settings:{defaults:{byHarness:{codex:{effort:'minimal'}}}}},mixFixed=cp(mixDef);mixFixed.settings.defaults.byHarness.codex.effort='none';
await scenario('mixed node element types are preserved; valid defaults corrected and unresolved node remains discoverable',[lv('mixed',mixDef,'draft',mixFixed)],counts(1),counts(1));
await scenario('snapshot mixed node array preserved and trigger restored',[lv('mixed',mixDef,'snapshot',mixFixed)],counts(1),counts(1));
const diagMixed=['abc',7,true,null,[],{provenance:{effort:'minimal'}}];
await scenario('mixed diagnostic types preserved; top provenance corrected and unresolved diagnostic remains discoverable',[ev(1,{provenance:{effort:'minimal'},diagnostics:diagMixed},{provenance:{effort:'none'},diagnostics:diagMixed})],counts(1),counts(1));
const catMixed=j(['minimal',5,true,null,{},[],'none']);await scenario('mixed catalog elements preserved while default corrected',[row('model_catalog',{harness:'codex',model:'mixed',efforts:catMixed,default_effort:'minimal'},{harness:'codex',model:'mixed',efforts:catMixed,default_effort:'none'})],counts(1),counts(1));
for(const efforts of ['{"a":"minimal"}','"minimal"','["minimal",null]'])await scenario('wrong catalog shape stays discoverable '+efforts,[row('model_catalog',{harness:'codex',model:'wrong',efforts,default_effort:'minimal'},{harness:'codex',model:'wrong',efforts,default_effort:'none'})],counts(1),counts(1));
const wrongNodes={nodes:{n:{kind:'inference',config:{effort:'minimal'}}},settings:{defaults:{byHarness:{claude:{effort:'minimal'}}}}},wrongNodesFixed=cp(wrongNodes);wrongNodesFixed.settings.defaults.byHarness.claude.effort='none';
await scenario('object instead of nodes array stays discoverable and valid default corrected',[lv('wrong',wrongNodes,'draft',wrongNodesFixed)],counts(1),counts(1));
await scenario('missing nodes path is not inserted when a default is corrected',[lv('missing',{settings:{defaults:{byHarness:{codex:{effort:'minimal'}}}}},'draft',{settings:{defaults:{byHarness:{codex:{effort:'none'}}}}})],counts(1),counts(0));
await scenario('missing settings path is not inserted when inference effort corrected',[lv('missing',{nodes:[{kind:'inference',config:{effort:'minimal'}},{kind:'inference'},{kind:'decision',config:{effort:{mode:'inherit'}}}]},'draft',{nodes:[{kind:'inference',config:{effort:'none'}},{kind:'inference'},{kind:'decision',config:{effort:{mode:'inherit'}}}]})],counts(1),counts(0));
for(const diagnostics of [undefined,null,[],{}]){
 const p={provenance:{effort:'minimal'},...(diagnostics===undefined?{}:{diagnostics})},fixed={...p,provenance:{effort:'none'}};
 await scenario('decision diagnostics '+(diagnostics===undefined?'absent':j(diagnostics))+' preserved without insertion',[ev(1,p,fixed)],counts(1),counts(0));
}
const oddPin=pin();oddPin.defaults.owner.byHarness.codex.effort={odd:'minimal'};oddPin.defaults.owner.byHarness.claude.effort=['minimal'];oddPin.defaults.process.byHarness.claude.effort=true;oddPin.untyped={effort:'minimal',x:[null,9007199254740991,1.25]};
const oddFixed=cp(oddPin);oddFixed.defaults.process.byHarness.codex.effort='none';await scenario('non-string sibling efforts keep exact JSON types and authored values',[row('runs',{id:'r',pinned:j(oddPin),failure:null},{id:'r',pinned:j(oddFixed),failure:null})],counts(1),counts(0));
await scenario('settings preserve object and array effort values beside one canonical minimal',[row('settings',{key:'defaults',value:'{"byHarness":{"codex":{"effort":{"odd":"minimal"}},"claude":{"effort":"minimal"}},"authored":["minimal"]}'},{key:'defaults',value:'{"byHarness":{"codex":{"effort":{"odd":"minimal"}},"claude":{"effort":"none"}},"authored":["minimal"]}'})],counts(1),counts(0));
await scenario('receipt and event paths do not create absent defaults or fresh-session properties',[
 row('webhook_receipts',{id:'w',intent:j({run:{pinned:pin()},authored:{effort:'minimal'}})},{id:'w',intent:j({run:{pinned:fixedPin()},authored:{effort:'minimal'}})}),
 row('event_receipts',{id:'e',intent:j({queued:{pinned:pin()},authored:{effort:'minimal'}})},{id:'e',intent:j({queued:{pinned:fixedPin()},authored:{effort:'minimal'}})}),
 ev(1,{freshSession:{effort:'minimal'},untyped:{effort:'minimal'}},{freshSession:{effort:'none'},untyped:{effort:'minimal'}},'run.resumed')
],counts(3),counts(0));
for(const root of ['{}','[]','[1,2]','"scalar"','1','true','null'])await L.withDb(L.makeStore('sentinel'),async db=>{const r=(await db.execute({sql:"SELECT json_replace(?, '$[#]', 'none') AS sentinel, json_replace(?, '$.absent.nested', 'none') AS missing",args:[root,root]})).rows[0];rec.check('json_replace absent paths and sentinel preserve '+root,r.sentinel===root&&r.missing===root,r)});
const bigNodes=Array.from({length:498},(_,i)=>L.inferenceNode('n'+i,{model:'gpt-6-luna',effort:i%2===0?'minimal':'low',template:'Authored minimal / none: '+('x'.repeat(8192))}));
const large=L.loop('Large definition at the 500-node contract bound',bigNodes,[L.edge('e0','start','n0'),...bigNodes.slice(1).map((n,i)=>L.edge('e'+(i+1),'n'+i,n.id)),L.edge('last','n497','done')],{defaults:{byHarness:{codex:{effort:'minimal'}}}});large.variables={data:{type:'object',default:{rawInteger:'placeholder',effort:'minimal',text:'y'.repeat(1000000)}}};
const fixedLarge=cp(large);fixedLarge.settings.defaults.byHarness.codex.effort='none';for(const n of fixedLarge.nodes)if(n.kind==='inference'&&n.config.effort==='minimal')n.config.effort='none';
const raw=x=>j(x).replace('"rawInteger":"placeholder"','"rawInteger":9007199254740993123456789'),largeBytes=Buffer.byteLength(raw(large));rec.observe('large definition fixture',{nodes:large.nodes.length,bytes:largeBytes,expectedSHA256:createHash('sha256').update(raw(fixedLarge)).digest('hex')});
await scenario('large 500-node definition with 1 MB authored default and exact large-integer token',[lv('large',raw(large),'draft',raw(fixedLarge)),lv('large-snapshot',raw(large),'snapshot',raw(fixedLarge))],counts(2),counts(0));
const doc=fs.readFileSync(path.join(L.ROOT,'docs/qa/2026-10-28-wp-205-none/round1/hand-fix.sql.txt'),'utf8');rec.check('independently parsed CHANGELOG text matches checked-in hand recipe byte for byte',sql+'\n'===doc,{bytes:Buffer.byteLength(doc)});
const {recipe:generated}=await import(pathToFileURL(path.join(L.ROOT,'docs/qa/2026-10-28-wp-205-none/scripts/effort-sql.mjs')));rec.check('generated recipe matches published CHANGELOG verbatim',generated()===sql+'\n');
const result=rec.finish();if(result.failed)process.exitCode=1;
