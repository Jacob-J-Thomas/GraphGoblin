import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import * as L from './lib.mjs';
const prior=JSON.parse(fs.readFileSync(path.join(L.OUT,'results.json')));
const dir=prior.disposableStores[0].replaceAll('%USERPROFILE%',process.env.USERPROFILE);
let g;
try{
  g=await L.gateway(dir,6390,{GG_CODEX_BINARY:path.join(dir,'not-installed.exe')},'missing-inspector');
  const duplicate=JSON.parse(fs.readFileSync(path.join(L.OUT,'plain-one.json')));
  const stale=await g.call(`/runs/${duplicate.run.id}/replay`,'POST',{observedSeq:duplicate.run.lastEventSeq,nodeId:'infer'});L.log('duplicate Replay intent refusal',stale);L.check('duplicate replay intent refused',stale.status===409,stale);
  const source=JSON.parse(fs.readFileSync(path.join(L.OUT,'plain-three.json')));
  const observed=(await g.call(`/runs/${source.run.id}`)).json;
  const replay=await g.call(`/runs/${source.run.id}/replay`,'POST',{observedSeq:observed.lastEventSeq,nodeId:'infer'});L.log('fresh missing inspector Replay response',replay);
  const id=replay.json.run.id;await L.end(g,id);const snap=await L.snapshot(g,id,'missing-inspector');
  const req=createRequire(path.join(L.ROOT,'apps/web/package.json'));const testReq=createRequire(req.resolve('@playwright/test/package.json'));const {chromium}=(await import(pathToFileURL(testReq.resolve('playwright')).href)).default;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.goto(g.origin+'/app/runs/'+id);await page.getByText('could not list',{exact:false}).first().waitFor({timeout:15000});const text=await page.locator('body').innerText();L.write('inspector-missing.log.txt',text);L.check('browser missing binary cause and Resume',text.includes('HARNESS_NOT_INSTALLED')&&text.includes('ENOENT')&&await page.getByRole('button',{name:'Resume',exact:true}).count()>0,{id,text});
  }finally{await browser.close();L.log('QA browser closed',{});}
  L.check('missing inspector run unsubmitted',snap.run.failure?.inference?.submission==='definitely-not-submitted',snap.run.failure);
}catch(error){L.check('final inspector completed',false,String(error.stack));}
finally{await g?.stop();L.write('final-observations.json',{checks:L.checks,process:g?{pid:g.pid,exit:g.exit()}:null});}
