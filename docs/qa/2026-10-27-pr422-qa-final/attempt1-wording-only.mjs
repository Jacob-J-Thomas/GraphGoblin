// Inspect, then decline both choices against the existing native uncertain run.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
const prior=JSON.parse(fs.readFileSync(path.join(L.RECORD,'script-replay-results.json'),'utf8'));
const runId=prior.evidence.source.failed.id;
const store=fs.readdirSync(L.ROOT).find(n=>n.startsWith('native-script-replay-'));
let api,browser;const E={runId,store};
try{
 api=await L.startApi(store,6663);browser=await chromium.launch({channel:'msedge',headless:true});
 const before=await L.events(api,runId);
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 await page.goto(api.base+'/app/runs/'+runId);
 await page.getByRole('button',{name:'Recover script',exact:true}).click();
 const recover=page.getByRole('dialog');await recover.waitFor();E.recoverText=await recover.innerText();E.recoverAria=await recover.ariaSnapshot();
 await page.screenshot({path:path.join(L.RECORD,'recover-script-wording.png')});
 await recover.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Replay...',exact:true}).click();
 const replay=page.getByRole('dialog',{name:'Replay as a new run'});await replay.getByLabel('Replay from node').selectOption('script');
 E.replayText=await replay.innerText();E.replayAria=await replay.ariaSnapshot();
 const checkbox=replay.getByRole('checkbox');
 L.check('uncertain Replay has named unchecked consent and disabled creation',await checkbox.count()===1&&!await checkbox.isChecked()&&await replay.getByRole('button',{name:'Create replay run'}).isDisabled(),E.replayAria);
 await page.screenshot({path:path.join(L.RECORD,'replay-script-consent-wording.png')});
 await replay.getByRole('button',{name:'Cancel',exact:true}).click();
 L.check('declining wording inspections leaves source history unchanged',JSON.stringify(before)===JSON.stringify(await L.events(api,runId)));
}catch(error){E.error=L.redact(error.stack);L.check('wording inspection completed',false,E.error);}
finally{await browser?.close();await L.cleanup();L.save('wording-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
