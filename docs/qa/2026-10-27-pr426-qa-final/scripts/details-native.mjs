// One scalar details shape, exercised only through built main.js, HTTP and disposable SQLite.
import * as L from './lib.mjs';
const rec=new L.Recorder('details-native');let g;
const defaults={byHarness:{codex:{model:'gpt-6-luna',effort:'minimal'}}};
try {
  for(const source of ['node','decision','loop','owner','repair-default']) {
    const dir=L.makeStore('details-'+source);const fake=L.fakeCli(dir);
    g=await L.startGateway({dir,port:6737,label:'details-'+source,env:fake.env,rec});
    const setEfforts=async allow=>L.withDb(dir,db=>db.execute({sql:"UPDATE model_catalog SET efforts = ? WHERE harness = 'codex' AND model = 'gpt-6-luna'",args:[JSON.stringify([...(allow?['minimal']:[]),'low','medium','high','xhigh','max'])]}));
    await setEfforts(true);
    let node=source==='decision'?L.llmDecisionNode('work',{model:'gpt-6-luna',effort:'minimal'}):L.inferenceNode('work',{model:'gpt-6-luna',...(source==='node'?{effort:'minimal'}:{})});
    if(source==='repair-default') node={id:'work',kind:'mutate',label:'Work',config:{operations:[{op:'coerce',source:'/vars/value',target:'/vars/value',jsonSchema:{type:'number'},repair:{enabled:true,maxAttempts:1}}]}};
    if(source==='owner'||source==='repair-default') {const put=await g.call('/settings',{method:'PUT',body:{defaults}});rec.check(source+': catalog temporarily admits saved minimal',put.status===200,put.json);}
    const id=await L.publishLoop(g.call,L.single('Details '+source,node,source==='loop'?{defaults}:{}));
    await setEfforts(false);
    const runId=await L.startRun(g.call,id,{input:null,initialVars:{value:'bad'}});
    const done=await L.waitRun(g.call,runId,['failed','succeeded','cancelled'],30000);
    const expected={code:'EFFORT_UNSUPPORTED',path:'effort',...(['loop','owner','repair-default'].includes(source)?{level:source==='loop'?'loop':'owner',harness:'codex'}:{})};
    rec.check(source+': scalar details.code, no nested issue shape and no CLI turn',done.status==='failed'&&done.failure?.code==='EVALUATION_INVALID_CONFIGURATION'&&done.failure?.resumable===false&&JSON.stringify(done.failure?.details)===JSON.stringify(expected)&&fake.requests().length===0,{expected,failure:done.failure,requests:fake.requests()});
    rec.check(source+': gateway exit 0',await g.stop()===0,g.exitCode());g.copyLog('details-'+source+'-gateway.log.txt');g=undefined;
    L.cleanupStore(dir,rec);
  }
}catch(error){rec.check('details native completed without exception',false,String(error.stack??error));}
finally{if(g) await g.stop();rec.finish();}
