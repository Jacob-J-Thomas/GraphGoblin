import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import * as L from './lib.mjs';
const rec=new L.Recorder('defaults'),{loadConfig}=await import(pathToFileURL(path.join(L.ROOT,'apps/api/dist/config.js'))),{createContainer}=await import(pathToFileURL(path.join(L.ROOT,'apps/api/dist/container.js')));
for(const [h,model]of[['codex','gpt-5.5'],['claude','claude-haiku-5-5']]){
 const defaults={byHarness:{[h]:{model,effort:'none'}}},dir=L.makeStore('defaults-'+h);
 const g=await L.startGateway({dir,port:6364,env:{GG_DEFAULTS:JSON.stringify(defaults)},label:h,rec});
 const lines=g.failedStart?.trim().split(/\r?\n/);
 rec.check('built '+h+' startup exits 1 with code, model, effort, no stack',g.exitCode()===1&&lines?.length===3&&lines[0]==='GraphGoblin did not start: Invalid GG_DEFAULTS (EVALUATION_INVALID_CONFIGURATION).'&&lines[1].includes(`${h}: EFFORT_UNSUPPORTED at effort (model "${model}", effort "none")`),{exit:g.exitCode(),lines});
 g.copyLog('defaults-'+h+'-gateway.log.txt');
 rec.check(h+' startup writes no database or master key',['graphgoblin.db','master.key','graphgoblin.lock'].every(n=>!fs.existsSync(path.join(dir,n))));
 let refusal;try{await createContainer(loadConfig({GG_DATA_DIR:L.makeStore('error-'+h),GG_DEFAULTS:JSON.stringify(defaults)}),{startTimers:false})}catch(e){refusal=e}
 rec.check(h+' public container has exact process refusal details',refusal?.code==='EVALUATION_INVALID_CONFIGURATION'&&JSON.stringify(refusal?.details)===JSON.stringify({code:'EFFORT_UNSUPPORTED',path:'effort',level:'process',harness:h}),{code:refusal?.code,details:refusal?.details});
}
rec.finish();