// Finishes only the checks affected by QA-driver mistakes or not yet reached in attempt 1.
// The original logs, fixtures, and failed assertions remain preserved and are adjudicated in README.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(L.OUT,n),'utf8'));
const restore=s=>s.replaceAll('%USERPROFILE%',process.env.USERPROFILE);
const prior=read('results.json');const dirs=prior.disposableStores.map(restore);
const tools=fs.readFileSync(path.join(L.OUT,'tools-path.local.txt'),'utf8').trim();fs.unlinkSync(path.join(L.OUT,'tools-path.local.txt'));
const gateways=[],fixtures=[];
const newGateway=async(dir,port,env,label)=>{const g=await L.gateway(dir,port,env,label);gateways.push(g);return g;};
const oldCli=dir=>({env:{GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')},set:(n,v)=>fs.writeFileSync(path.join(dir,'fake',n),v),requests:()=>fs.readFileSync(path.join(dir,'fake/requests.log.txt'),'utf8').trim().split('\n').map(JSON.parse)});
try{
  // Re-evaluate already captured argv with the correct documented read-only decision policy.
  for(const name of ['decision','repeated-own']){
    const requests=fs.readFileSync(path.join(L.OUT,name+'-requests.log.txt'),'utf8').trim().split('\n').map(JSON.parse);
    const lists=requests.filter(q=>q.kind==='listing'),turns=requests.filter(q=>q.kind==='turn');turns.forEach((t,i)=>L.isolation('adjudicated '+name+' '+i,lists[i],t,['qa423']));
  }
  const cli=oldCli(dirs[0]);
  const g=await newGateway(dirs[0],6390,cli.env,'inspect-followup');
  const missing=read('missing.json');const missingId=missing.run.id;let failedMissing=(await g.call(`/runs/${missingId}`)).json;
  const before=cli.requests().filter(q=>q.kind==='turn').length;
  const resume=await g.call(`/runs/${missingId}/resume`,'POST',{observedSeq:failedMissing.lastEventSeq});await L.end(g,missingId);const fixed=await L.snapshot(g,missingId,'missing-after-install');
  L.check('installation restored Resume submits exactly once',resume.status===200&&fixed.run.status==='succeeded'&&cli.requests().filter(q=>q.kind==='turn').length===before+1&&!cli.requests().filter(q=>q.kind==='turn').at(-1).argv.includes('resume'),fixed.run);
  // Browser inspector across the four preserved failures and a timeout; missing binary uses the
  // captured failed run while a separate missing-config gateway is temporarily running below.
  cli.set('listing-mode.txt','hang');const id=await L.start(g,await L.publish(g,L.inference('QA423 inspector timeout')));await L.end(g,id);await L.snapshot(g,id,'inspect-timeout');cli.set('listing-mode.txt','normal');await L.sleep(3500);
  const req=createRequire(path.join(L.ROOT,'apps/web/package.json'));const testReq=createRequire(req.resolve('@playwright/test/package.json'));const {chromium}=(await import(pathToFileURL(testReq.resolve('playwright')).href)).default;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    for(const [name,runId] of [...['exit','banner','malformed','unusual'].map(n=>[n,read('inspect-'+n+'.json').run.id]),['timeout',id]]){
      await page.goto(g.origin+'/app/runs/'+runId);await page.getByText('could not list',{exact:false}).first().waitFor({timeout:15000});
      const text=await page.locator('body').innerText();L.write('inspector-'+name+'.log.txt',text);L.check('browser '+name+' exposes cause and Resume',text.includes('HARNESS_TURN_FAILED')&&text.includes('could not list')&&await page.getByRole('button',{name:'Resume',exact:true}).count()>0,{runId,text});
      if(name==='exit')await page.screenshot({path:path.join(L.OUT,'inspector-listing-exit.png'),fullPage:true});
    }
  }finally{await browser.close();L.log('QA browser closed',{});}
  await g.stop();
  // Finish the same parked run; the first request was a QA 400 (wrong wait field), not a product fault.
  {
    const dir=dirs[2],cli=oldCli(dir);const g=await newGateway(dir,6392,cli.env,'parked-followup');const id=read('parked-before-restart.json').run.id;const run=(await g.call(`/runs/${id}`)).json;
    const signal=await g.call(`/runs/${id}/signals/qa423-go`,'POST',{waitId:run.waiting.waitId,payload:{qa:true}});L.log('correct parked signal',signal);await L.end(g,id);const snap=await L.snapshot(g,id,'parked-after-restart');const turns=cli.requests().filter(q=>q.kind==='turn'),lists=cli.requests().filter(q=>q.kind==='listing');
    L.check('parked completes after restart with one resumed turn',signal.status===200&&snap.run.status==='succeeded'&&turns.length===2&&turns[1].argv.includes('resume'),{run:snap.run,turns});turns.forEach((t,i)=>L.isolation('parked '+i,lists[i],t));await g.stop();
  }
  // A corrected Claude init includes the documented apiKeySource field omitted by attempt 1.
  {
    const dir=L.store('claude-corrected'),cli=L.cli(dir,path.join(tools,'codex.exe'));fixtures.push(cli);const g=await newGateway(dir,6394,cli.env,'claude-corrected');const def=L.inference('QA423 Claude corrected',{harness:'claude',model:'claude-haiku-5-5',harnessOptions:{sandbox:'read-only',approval:'never'}});const id=await L.start(g,await L.publish(g,def));await L.end(g,id);const snap=await L.snapshot(g,id,'claude-corrected');const argv=cli.requests().find(q=>q.kind==='claude-turn')?.argv??[];
    L.check('corrected Claude completes and launch flags unchanged',snap.run.status==='succeeded'&&argv.includes('--safe-mode')&&argv.includes('--strict-mcp-config')&&argv[argv.indexOf('--setting-sources')+1]==='',{run:snap.run,argv});L.write('claude-corrected-requests.log.txt',cli.requests().map(JSON.stringify).join('\n'));await g.stop();
  }
  // Native force over an accepted fake Codex turn. Self-release is cleanup only.
  {
    const dir=L.store('force'),cli=L.cli(dir,path.join(tools,'codex.exe'));fixtures.push(cli);cli.set('hold.txt','on');const g=await newGateway(dir,6393,cli.env,'force');const id=await L.start(g,await L.publish(g,L.inference('QA423 force held turn')));await L.until(async()=> (await L.events(g,id)).some(e=>e.type==='harness.submission'&&e.submission==='submitted'));const turn=cli.requests().find(q=>q.kind==='turn');
    const force=await g.call('/system/shutdown','POST',{action:'force'});L.log('native force requested',force);await L.sleep(6000);const state=g.exit()?null:await g.call('/system/shutdown');L.write('force-state.json',{exit:g.exit(),state,run:g.exit()?null:(await g.call(`/runs/${id}`)).json});
    // Capture the exact sandbox refusal against only this fixture PID, if it is still alive.
    if(!g.exit()){
      const killed=spawnSync('taskkill.exe',['/PID',String(turn.pid),'/T','/F'],{encoding:'utf8',windowsHide:true});L.write('native-termination-refusal.log.txt',{pid:turn.pid,status:killed.status,error:killed.error?{code:killed.error.code,message:killed.error.message}:null,stdout:killed.stdout,stderr:killed.stderr});L.log('D-015 native termination attempt',{status:killed.status,error:killed.error?.message,stderr:killed.stderr});
    }
    cli.set('release.txt','go');await L.sleep(800);if(!g.exit())await g.call('/system/shutdown','POST',{action:'force'}).catch(()=>{});await g.waitExit(20000).catch(()=>{});g.save();L.log('force fixture self-release cleanup',{exit:g.exit(),pid:g.pid});
    const r=await newGateway(dir,6393,cli.env,'force-restart');const snap=await L.snapshot(r,id,'force-after-restart');L.log('force durable outcome',snap.run);const resume=await r.call(`/runs/${id}/resume`,'POST',{observedSeq:snap.run.lastEventSeq});L.check('force interrupted work not blindly resumed',snap.run.status==='failed'&&resume.status===409,{run:snap.run,resume});await r.stop();
  }
}catch(error){L.check('followup driver completed',false,String(error.stack));}
finally{
  for(const cli of fixtures)cli.set('release.txt','go');for(const g of gateways)if(!g.exit())await g.stop();else g.save();
  L.write('followup-results.json',{checks:L.checks,passed:L.checks.filter(c=>c.ok).length,failed:L.checks.filter(c=>!c.ok).length,processes:gateways.map(g=>({pid:g.pid,exit:g.exit()})),disposableStores:fixtures.map(c=>path.dirname(c.dir)),realProviderTurns:0});
}
