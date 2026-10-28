// Additional observable recovery/inspector checks not covered by the quick regression driver.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import * as L from './lib.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(L.OUT,n),'utf8'));
const restore=s=>s.replaceAll('%USERPROFILE%',process.env.USERPROFILE);
const prior=read('results.json'),rejections=read('rejections-continued-results.json');
const gateways=[];
const existingCli=dir=>({env:{GG_CODEX_BINARY:path.join(dir,'fake/codex.exe'),GG_CLAUDE_BINARY:path.join(dir,'fake/claude.exe')},set:(n,v)=>fs.writeFileSync(path.join(dir,'fake',n),String(v)),requests:()=>fs.readFileSync(path.join(dir,'fake/requests.log.txt'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)});
const startGateway=async(dir,port,cli,name)=>{const g=await L.gateway(dir,port,cli.env,name);gateways.push(g);return g;};
try{
  {
    const dir=restore(rejections.store),cli=existingCli(dir),g=await startGateway(dir,6396,cli,'rejection-recovery');
    cli.set('listing.json',JSON.stringify([{name:'toString'},{name:'node_repl'}]));
    for(const target of rejections.targets.filter(t=>t.allowed)){
      const before=cli.requests().filter(q=>q.kind==='turn').length;
      const run=(await g.call(`/runs/${target.id}`)).json;const resume=await g.call(`/runs/${target.id}/resume`,'POST',{observedSeq:run.lastEventSeq});await L.end(g,target.id);const snap=await L.snapshot(g,target.id,target.name+'-fixed');
      L.check(target.name+' fixed configuration submits once fresh',resume.status===200&&snap.run.status==='succeeded'&&cli.requests().filter(q=>q.kind==='turn').length===before+1&&!cli.requests().filter(q=>q.kind==='turn').at(-1).argv.includes('resume'),snap.run);
    }
    const before=cli.requests().length;const def=L.inference('node_repl re-enable',{harnessOptions:{sandbox:'workspace-write',approval:'never',configOverrides:{mcp_servers:{node_repl:{enabled:true}}}}});
    const id=await L.start(g,await L.publish(g,def));await L.end(g,id);const snap=await L.snapshot(g,id,'ordinary-node-repl-reenable');const calls=cli.requests().slice(before);
    L.check('node_repl nested override succeeds',snap.run.status==='succeeded',snap.run);L.isolation('node_repl nested override',calls.find(q=>q.kind==='listing'),calls.find(q=>q.kind==='turn'),['toString','node_repl'],{server:'node_repl'});await g.stop();
  }
  {
    const dir=restore(prior.disposableStores[0]),cli=existingCli(dir),g=await startGateway(dir,6390,cli,'remaining-inspectors');
    const missing=read('missing.json');
    cli.set('listing-mode.txt','hang');const timeout=await L.start(g,await L.publish(g,L.inference('timeout inspector')));await L.end(g,timeout);await L.snapshot(g,timeout,'inspect-timeout');cli.set('listing-mode.txt','normal');await L.sleep(3500);
    const req=createRequire(path.join(L.ROOT,'apps/web/package.json')),testReq=createRequire(req.resolve('@playwright/test/package.json'));const {chromium}=(await import(pathToFileURL(testReq.resolve('playwright')).href)).default;
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
      const page=await browser.newPage();
      for(const [name,id,code] of [['timeout',timeout,'HARNESS_TURN_FAILED'],['missing',missing.run.id,'HARNESS_NOT_INSTALLED']]){
        await page.goto(g.origin+'/app/runs/'+id);await page.getByText('could not list',{exact:false}).first().waitFor({timeout:15000});const text=await page.locator('body').innerText();L.write('inspector-'+name+'.log.txt',text);const resume=page.getByRole('button',{name:'Resume',exact:true});L.check(name+' inspector cause and Resume',text.includes(code)&&text.includes('could not list')&&await resume.count()>0&&await resume.isEnabled(),{id,code});
      }
    }finally{await browser.close();L.log('final QA browser closed',{});}
    const before=cli.requests().filter(q=>q.kind==='turn').length;const run=(await g.call(`/runs/${missing.run.id}`)).json;const resume=await g.call(`/runs/${run.id}/resume`,'POST',{observedSeq:run.lastEventSeq});await L.end(g,run.id);const snap=await L.snapshot(g,run.id,'missing-fixed');L.check('missing installation restored submits once',resume.status===200&&snap.run.status==='succeeded'&&cli.requests().filter(q=>q.kind==='turn').length===before+1,snap.run);await g.stop();
  }
  {
    const dir=restore(prior.disposableStores[3]),cli=existingCli(dir),g=await startGateway(dir,6393,cli,'force-verification');const id=read('force-after-restart.json').run.id;const run=(await g.call(`/runs/${id}`)).json;const resume=await g.call(`/runs/${id}/resume`,'POST',{observedSeq:run.lastEventSeq});L.check('force interruption remains non-resumable',run.failure?.code==='RUN_INTERRUPTED_BY_STOP'&&run.failure?.resumable===false&&resume.status===409,{run,resume});await g.stop();
  }
}catch(error){L.check('final observations completed',false,String(error.stack));}
finally{for(const g of gateways)if(!g.exit())await g.stop();L.write('final-results.json',{checks:L.checks,passed:L.checks.filter(c=>c.ok).length,failed:L.checks.filter(c=>!c.ok).length,processes:gateways.map(g=>({pid:g.pid,exit:g.exit()})),realProviderTurns:0});}
