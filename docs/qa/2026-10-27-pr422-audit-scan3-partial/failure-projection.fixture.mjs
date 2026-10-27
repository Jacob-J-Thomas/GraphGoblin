// Real SQLite and native scripts; delay only acknowledgement of the durable failure append.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const built=p=>import(pathToFileURL(path.join(process.env.GG_AUDIT_REPO,p)).href);
const {createContainer,buildApp,loadConfig}=await built('apps/api/dist/index.js');
const {RunManager}=await built('packages/engine/dist/index.js');
const c=await createContainer(loadConfig(process.env),{startTimers:false});
await c.start();await c.manager.waitForIdle();c.manager.stop();
const store=c.ports.events;
let held=false;
const events={
 recoveryFacts:(...args)=>store.recoveryFacts(...args),read:(...args)=>store.read(...args),subscribe:(...args)=>store.subscribe(...args),
 append:async(...args)=>{
  const stored=await store.append(...args);
  const failed=stored.find(e=>e.type==='run.failed');
  if(failed&&!held){
    held=true;
    fs.writeFileSync(path.join(process.env.GG_DATA_DIR,'failure-committed.json'),JSON.stringify(failed),'utf8');
    const until=Date.now()+120000;
    while(!fs.existsSync(path.join(process.env.GG_DATA_DIR,'release-failure'))){
      if(Date.now()>until)throw Error('Audit acknowledgement deadline');
      await new Promise(r=>setTimeout(r,10));
    }
  }
  return stored;
 },
};
const manager=new RunManager({...c.ports,events},c.settings);await manager.start();
const app=await buildApp({...c,manager},{logger:false});
await app.listen({host:'127.0.0.1',port:Number(process.env.GG_PORT)});
