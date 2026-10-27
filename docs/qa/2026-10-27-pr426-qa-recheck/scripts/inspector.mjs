// Finish the browser observation against the existing failed run; do not repeat any turn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';
const rec=new L.Recorder('inspector');
const name=process.argv[2];
if(!/^gg-qa-426r-review-[A-Za-z0-9]+$/.test(name??'')) throw new Error('Expected this QA run store name');
const dir=path.join(os.tmpdir(),name);
const fake=L.fakeCli(dir);
const prior=JSON.parse(fs.readFileSync(path.join(L.OUT,'review-run-snapshots.json'),'utf8')).refused;
let g,browser;
try {
  const before=fake.requests().length;
  g=await L.startGateway({dir,port:6719,label:'inspector',env:fake.env,rec});
  const stored=(await g.call(`/runs/${prior.runId}`)).json;
  const luna=(await g.call('/model-catalog')).json.items.find(i=>i.harness==='codex'&&i.model==='gpt-6-luna');
  rec.check('after restart: seed removes minimal and pinned refusal is unchanged',!luna.efforts.includes('minimal') && stored.failure?.message===prior.failure.message && stored.failure?.details?.adapterCode==='HARNESS_ARGUMENTS_REJECTED' && stored.recovery?.resume?.allowed===false,{efforts:luna.efforts,failure:stored.failure,recovery:stored.recovery});
  browser=await L.launchEdge();
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.goto(`${g.origin}/app/runs/${prior.runId}`);
  const replay=page.getByRole('button',{name:'Replay...',exact:true});
  await replay.waitFor({timeout:30_000});
  const resume=page.getByRole('button',{name:'Resume',exact:true});
  const text=await page.locator('body').innerText();
  const reason=await page.locator(`#resume-reason-${prior.runId}`).innerText();
  rec.check('loaded inspector: exact refusal, disabled Resume with reason, enabled Replay',text.includes('HARNESS_TURN_FAILED') && text.includes("Unsupported value: 'minimal'") && await resume.isDisabled() && /^Resume unavailable:/.test(reason) && await replay.isEnabled(),{text,reason});
  await L.shot(page,'refused-minimal-inspector-ready');
  await replay.click();
  const dialog=page.getByRole('dialog',{name:'Replay as a new run'});
  await dialog.waitFor({timeout:10_000});
  const select=dialog.getByLabel('Replay from node',{exact:true});
  await select.selectOption('work');
  const replayReason=await dialog.locator(`#replay-reason-${prior.runId}`).innerText();
  rec.check('Replay dialog offers reached work node and permits creating a replay',await select.inputValue()==='work' && /Replay is available at this node\./.test(replayReason) && await dialog.getByRole('button',{name:'Create replay run',exact:true}).isEnabled(),{node:await select.inputValue(),reason:replayReason});
  await L.shot(page,'refused-minimal-replay-dialog');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  rec.check('inspector and restart made zero additional fake turns',fake.requests().length===before,{before,after:fake.requests().length});
}catch(error){rec.check('inspector completed without exception',false,String(error.stack??error));}
finally{await browser?.close().catch(()=>{});if(g){rec.check('gateway drains to exit 0',await g.stop()===0,g.exitCode());g.copyLog('inspector-gateway.log.txt');}rec.finish();}
