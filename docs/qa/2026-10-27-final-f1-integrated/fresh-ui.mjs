import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
let api,browser;const E={};
try{
 api=await L.startApi('fresh-ui',6631);const def=L.loop('Explicit fresh session',[L.inference('think',{policy:'resume-own'}),L.waitNode(),{id:'gate',kind:'decision',label:'Two visits',config:{kind:'expression',jsonata:'"again"',maxPasses:2,routes:[{id:'again',label:'Again',repeat:true},{id:'done',label:'Done'}]}}],{},[L.edge('a','start','think'),L.edge('b','think','park'),L.edge('c','park','gate'),L.edge('d','gate','think','again'),L.edge('e','gate','done','done'),L.edge('f','gate','done','limit-reached')]);
 const run=await L.run(api,await L.publish(api,def));const first=await L.state(api,run.id,['waiting']);
 const requests=fs.readFileSync(path.join(L.CLI,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);const req=requests.findLast(r=>r.prompt.includes(run.id));fs.unlinkSync(path.join(L.CLI,'sessions',req.sessionId));
 await api.post('/runs/'+run.id+'/input',{waitId:first.waiting.waitId,input:'visit two'});const failed=await L.state(api,run.id,['failed']);
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050}});await page.goto(api.base+'/app/runs/'+run.id);await page.getByRole('button',{name:'Start fresh session for think',exact:true}).waitFor();
 L.check('missing-session Resume unavailable before explicit choice',await page.getByRole('button',{name:'Resume',exact:true}).isDisabled(),failed.recovery);
 await page.screenshot({path:path.join(L.RECORD,'fresh-session-choice.png')});await page.getByRole('button',{name:'Start fresh session for think',exact:true}).click();const fresh=await L.state(api,run.id,['waiting']);
 await api.post('/runs/'+run.id+'/input',{waitId:fresh.waiting.waitId,input:'finish'});const done=await L.state(api,run.id,['succeeded']);await L.until(()=>page.locator('[data-status="succeeded"]').isVisible());
 const events=await L.events(api,run.id);L.check('Edge fresh choice retains run and records one deliberate fresh session',done.id===run.id && events.filter(e=>e.type==='run.resumed'&&e.freshSession).length===1,{done,events});E.details={run,first,req,failed,fresh,done,events};
}catch(error){E.error=String(error.stack);L.check('fresh UI driver completed',false,E.error);}
finally{await browser?.close();await L.cleanup();L.save('fresh-ui-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
