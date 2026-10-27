// Public RunManager/EventStore composition over the built API and real SQLite.
// The only controlled boundary is loss of acknowledgement after durable parent Resume.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const built = (relative) => import(pathToFileURL(path.join(process.env.GG_AUDIT_REPO, relative)).href);
const {createContainer,buildApp,loadConfig}=await built('apps/api/dist/index.js');
const {RunManager}=await built('packages/engine/dist/index.js');
const container=await createContainer(loadConfig(process.env), {startTimers:false});
await container.start();
await container.manager.waitForIdle();
container.manager.stop();
const store=container.ports.events;
const events={
  recoveryFacts:(...args)=>store.recoveryFacts(...args),
  read:(...args)=>store.read(...args),
  subscribe:(...args)=>store.subscribe(...args),
  append:async (...args)=>{
    const stored=await store.append(...args);
    const intent=stored.find(e=>e.type==='run.resumed' && e.childRecovery);
    if(intent){
      fs.writeFileSync(path.join(process.env.GG_DATA_DIR,'resume-committed.json'),JSON.stringify(intent),'utf8');
      await new Promise(()=>{});
    }
    return stored;
  },
};
const manager=new RunManager({...container.ports,events},container.settings);
await manager.start();
const app=await buildApp({...container,manager},{logger:false});
await app.listen({host:'127.0.0.1',port:Number(process.env.GG_PORT)});
