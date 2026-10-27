import path from 'node:path';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
let api,browser;const E={};
try{
 api=await L.startApi('accessibility-'+Date.now(),6663);
 const source=await L.run(api,await L.publish(api,L.loop('Recovery wording and keyboard',[
  {id:'script',kind:'script',label:'Local script',config:{command:process.execPath,args:['-e','console.log("null")'],cwd:L.ROOT}},L.waitNode()
 ])));
 const run=await L.state(api,source.id,['waiting']);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 await page.goto(api.base+'/app/runs/'+run.id);
 const resume=page.getByRole('button',{name:'Resume',exact:true});await resume.waitFor();
 const cdp=await page.context().newCDPSession(page);
 E.ax=(await cdp.send('Accessibility.getFullAXTree')).nodes.filter(n=>n.role?.value==='button'&&n.name?.value==='Resume');
 L.check('disabled Resume exposes server explanation in Edge accessibility tree',await resume.isDisabled()&&E.ax[0]?.description?.value?.includes(run.recovery.resume.message),E.ax);
 const opener=page.getByRole('button',{name:'Replay...',exact:true});await opener.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Replay as a new run'});await dialog.waitFor();
 E.dialogAttrs=await dialog.evaluate(e=>({role:e.getAttribute('role'),modal:e.getAttribute('aria-modal'),labelledBy:e.getAttribute('aria-labelledby')}));
 L.check('Replay dialog is named and modal',E.dialogAttrs.modal==='true',E.dialogAttrs);
 const inside=()=>page.evaluate(()=>!!document.activeElement?.closest('dialog,[role="dialog"]'));
 const focusChecks=[await inside()];for(let i=0;i<12;i++){await page.keyboard.press('Tab');focusChecks.push(await inside());}for(let i=0;i<8;i++){await page.keyboard.press('Shift+Tab');focusChecks.push(await inside());}
 L.check('Replay keyboard focus stays inside modal in both directions',focusChecks.every(Boolean),focusChecks);
 await dialog.getByLabel('Replay from node').selectOption('done');
 const reason=page.locator('#replay-reason-'+run.id);const create=dialog.getByRole('button',{name:'Create replay run'});
 E.unreached={text:await reason.innerText(),live:await reason.getAttribute('aria-live'),describedBy:await dialog.getByLabel('Replay from node').getAttribute('aria-describedby'),disabled:await create.isDisabled()};
 L.check('unreached Replay is disabled with live associated reason',E.unreached.disabled&&E.unreached.live==='polite'&&E.unreached.describedBy?.includes('replay-reason-'+run.id),E.unreached);
 await dialog.getByLabel('Replay from node').selectOption('script');
 E.wording=await dialog.innerText();E.aria=await dialog.ariaSnapshot();
 L.check('Replay wording identifies new ID repeated work and source preservation',E.wording.includes('separate run with a new ID')&&E.wording.includes('Scripts, provider turns, child runs and deliveries')&&E.wording.includes('does not undo')&&E.wording.includes(run.id)&&E.wording.includes('Local script'),E.wording);
 await dialog.getByLabel('Replay from node').focus();await page.keyboard.press('Tab');
 await page.screenshot({path:path.join(L.RECORD,'keyboard-replay.png')});
 await page.keyboard.press('Escape');
 L.check('Escape closes Replay and restores opener focus',!await dialog.isVisible()&&await opener.evaluate(e=>document.activeElement===e));
 await cdp.detach();
 E.edge=browser.version();E.run=run;E.current=await api.get('/runs/'+run.id);
 L.check('review and dismissal perform no replay',(await api.get('/runs')).items.length===1);
}catch(error){E.error=L.redact(error.stack);L.check('accessibility driver completed',false,E.error);}
finally{await browser?.close();await L.cleanup();L.save('accessibility-results.json',{checks:L.checks,evidence:E});}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
