import * as L from './lib.mjs';import {recipe} from './recipe.mjs';
const rec=new L.Recorder('sql-checks'),{find,correct}=recipe(),updates=correct.split('\n').filter(l=>l.startsWith('UPDATE ')).slice(0,8);
const schemas=[['loop_versions','id TEXT,status TEXT,definition TEXT'],['settings','key TEXT,value TEXT'],['model_catalog','harness TEXT,model TEXT,efforts TEXT,default_effort TEXT'],['runs','id TEXT,pinned TEXT,failure TEXT'],['run_events','run_id TEXT,seq INTEGER,type TEXT,payload TEXT'],['harness_sessions','run_id TEXT,node_id TEXT,attempt INTEGER,effort TEXT'],['webhook_receipts','id TEXT,intent TEXT'],['event_receipts','id TEXT,intent TEXT']];
const trigger="CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";
async function init(db){for(const [t,s]of schemas)await db.execute(`CREATE TABLE ${t} (${s})`);await db.execute(trigger)}
const json=JSON.stringify,clone=x=>JSON.parse(json(x)),authored={effort:'minimal',literal:['minimal',true,null,1.25,{effort:'minimal'}]};
const pin=()=>({defaults:{owner:{byHarness:{codex:{effort:'minimal'},claude:{effort:'low'}}},process:{byHarness:{codex:{effort:'high'},claude:{effort:'minimal'}}}}});
function fixPin(p){for(const level of ['owner','process'])for(const h of ['codex','claude'])if(p.defaults?.[level]?.byHarness?.[h]?.effort==='minimal')p.defaults[level].byHarness[h].effort='none';return p}
const fixtures=[];const add=(table,key,column,value,expected)=>fixtures.push({table,key,column,value:typeof value==='string'?value:json(value),expected:typeof expected==='string'?expected:json(expected)});
const nodes=Array.from({length:14},(_,i)=>({id:'node'+i,kind:i===4?'decision':i===0?'trigger':i===13?'exit':'inference',config:i===4?{kind:'llm',effort:{mode:'explicit',value:'minimal'},output:authored}:i===0||i===13?{}:{effort:i===8?'low':'minimal',prompt:{template:'Authored {"effort":"minimal"}'},output:authored}}));
const definition={variables:{data:{default:authored}},settings:{defaults:{byHarness:{codex:{effort:'minimal'}}}},nodes};const expectedDefinition=clone(definition);expectedDefinition.settings.defaults.byHarness.codex.effort='none';for(const n of expectedDefinition.nodes){if(n.kind==='inference'&&n.config.effort==='minimal')n.config.effort='none';if(n.kind==='decision')n.config.effort.value='none'}
add('loop_versions',"id='lv'",'definition',definition,expectedDefinition);add('loop_versions',"id='snap'",'definition',definition,expectedDefinition);
add('settings',"key='defaults'",'value',{byHarness:{codex:{effort:'minimal'},claude:{effort:'high'}}},{byHarness:{codex:{effort:'none'},claude:{effort:'high'}}});
add('settings',"key='custom'",'value',json({byHarness:{codex:authored}}),json({byHarness:{codex:authored}}));
add('model_catalog',"model='dedup'",'efforts',['minimal','low','none','medium'],['low','none','medium']);add('model_catalog',"model='replace'",'efforts',['low','minimal','high'],['low','none','high']);
add('runs',"id='r'",'pinned',pin(),fixPin(pin()));add('runs',"id='r'",'failure',{missingSession:{effort:'minimal'},details:authored},{missingSession:{effort:'none'},details:authored});
const eventValues=[['run.queued',{pinned:pin(),initialThread:authored},{pinned:fixPin(pin()),initialThread:authored}],['run.failed',{failure:{missingSession:{effort:'minimal'},details:authored}},{failure:{missingSession:{effort:'none'},details:authored}}],['run.resumed',{freshSession:{effort:'minimal',prompt:json(authored)}},{freshSession:{effort:'none',prompt:json(authored)}}],['harness.session',{effort:'minimal'},{effort:'none'}],['decision.made',{provenance:{effort:'minimal'},diagnostics:[{code:'d0',provenance:{effort:'minimal'}},{code:'d1',provenance:{effort:'low'}},{code:'d2',provenance:{effort:null}}],reasoning:json(authored)},{provenance:{effort:'none'},diagnostics:[{code:'d0',provenance:{effort:'none'}},{code:'d1',provenance:{effort:'low'}},{code:'d2',provenance:{effort:null}}],reasoning:json(authored)}],['node.finished',{patch:authored},{patch:authored}]];
for(let i=0;i<eventValues.length;i++)add('run_events',`seq=${i+1}`,'payload',eventValues[i][1],eventValues[i][2]);
for(const t of ['webhook_receipts','event_receipts'])add(t,"id='receipt'",'intent',{run:{pinned:pin()},queued:{pinned:pin()},initialThread:authored},{run:{pinned:fixPin(pin())},queued:{pinned:fixPin(pin())},initialThread:authored});
const dir=L.makeStore('sql-matrix');await L.withDb(dir,async db=>{
 await init(db);
 for(const [id,status]of[['lv','draft'],['snap','snapshot']])await db.execute({sql:'INSERT INTO loop_versions VALUES (?,?,?)',args:[id,status,json(definition)]});
 for(const f of fixtures.filter(f=>f.table==='settings'))await db.execute({sql:'INSERT INTO settings VALUES (?,?)',args:[f.key.includes('custom')?'custom':'defaults',f.value]});
 for(const f of fixtures.filter(f=>f.table==='model_catalog'))await db.execute({sql:'INSERT INTO model_catalog VALUES (?,?,?,?)',args:['codex',f.key.includes('dedup')?'dedup':'replace',f.value,'minimal']});
 await db.execute({sql:'INSERT INTO runs VALUES (?,?,?)',args:['r',json(pin()),json({missingSession:{effort:'minimal'},details:authored})]});
 for(let i=0;i<eventValues.length;i++)await db.execute({sql:'INSERT INTO run_events VALUES (?,?,?,?)',args:['r',i+1,eventValues[i][0],json(eventValues[i][1])]});
 await db.execute("INSERT INTO harness_sessions VALUES ('r','worker',1,'minimal')");for(const t of ['webhook_receipts','event_receipts'])await db.execute({sql:`INSERT INTO ${t} VALUES (?,?)`,args:['receipt',json({run:{pinned:pin()},queued:{pinned:pin()},initialThread:authored})]});
 const rows=(await db.execute(find)).rows;rec.check('discovery covers all eight places; ignores custom settings and authored node.finished',rows.length===14&&new Set(rows.map(r=>r.place)).size===8&&!rows.some(r=>r.ref==='custom'||String(r.ref).includes('node.finished')),{rows});
 await db.executeMultiple(correct);
 for(const f of fixtures){const actual=(await db.execute(`SELECT ${f.column} value FROM ${f.table} WHERE ${f.key}`)).rows[0].value;rec.check(`path scoped ${f.table} ${f.key} ${f.column} preserves element order and all authored fields`,actual===f.expected,{equal:actual===f.expected});}
 rec.check('catalog default efforts corrected',(await db.execute("SELECT count(*) n FROM model_catalog WHERE default_effort='none'")).rows[0].n===2);
 rec.check('session effort corrected',(await db.execute('SELECT effort FROM harness_sessions')).rows[0].effort==='none');
 rec.check('snapshot trigger exact after transaction',(await db.execute("SELECT sql FROM sqlite_master WHERE name='loop_versions_snapshot_immutable'")).rows[0].sql===trigger);
 rec.check('discovery empty after full recipe',(await db.execute(find)).rows.length===0);
});
// Independently check the published promise that damaged JSON is guarded and skipped.
for(const [name,insert,index]of[['malformed catalog efforts',"INSERT INTO model_catalog VALUES ('codex','broken','not-json','minimal')",2],['malformed run pin',`INSERT INTO runs VALUES ('broken','not-json','{"missingSession":{"effort":"minimal"}}')`,3],['malformed run failure',`INSERT INTO runs VALUES ('broken','{"defaults":{"owner":{"byHarness":{"codex":{"effort":"minimal"}}}}}','not-json')`,3]]){
 await L.withDb(L.makeStore('guard'),async db=>{await init(db);await db.execute(insert);let selectError,updateError;try{await db.execute(find)}catch(e){selectError=e.message}try{await db.execute(updates[index])}catch(e){updateError=e.message}rec.observe(name,{selectError:selectError??null,updateError:updateError??null});});
}
rec.finish();