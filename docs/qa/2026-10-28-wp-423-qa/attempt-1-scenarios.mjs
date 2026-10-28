import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as L from './lib.mjs';
const tools=fs.readFileSync(path.join(L.OUT,'tools-path.local.txt'),'utf8').trim();
fs.unlinkSync(path.join(L.OUT,'tools-path.local.txt')); // runtime-only path, never retained as evidence
const binary=path.join(tools,'codex.exe');
const gateways=[],fixtures=[];
const targets=[];
let source,primaryDir,primaryCli;
const newGateway=async(dir,port,cli,label,extra={})=>{const g=await L.gateway(dir,port,{...cli.env,...extra},label);gateways.push(g);return g;};
const setup=name=>{const dir=L.store(name);const cli=L.cli(dir,binary);fixtures.push(cli);return {dir,cli};};
const listing=(cli,names)=>cli.set('listing.json',JSON.stringify(names.map(name=>({name,enabled:true,transport:{type:'stdio',command:'qa423'}}))));
async function execute(g,cli,name,extra={}){
  const before=cli.requests().length;
  const loop=await L.publish(g,L.inference(name,extra));const id=await L.start(g,loop);await L.end(g,id);
  const snap=await L.snapshot(g,id,name);const requests=cli.requests().slice(before);
  L.write(name+'-requests.log.txt',requests.map(r=>JSON.stringify(r)).join('\n'));
  L.log(name,{id,status:snap.run.status,failure:snap.run.failure});return {id,...snap,requests};
}
async function browserInspect(g){
  // The standalone playwright CLI is absent. Reuse the installed browser runtime, without
  // importing @playwright/test, creating test files, installing anything, or changing config.
  const req=createRequire(path.join(L.ROOT,'apps/web/package.json'));
  const testReq=createRequire(req.resolve('@playwright/test/package.json'));
  const {chromium}=await import(pathToFileURL(testReq.resolve('playwright')).href);
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    for(const target of targets){
      await page.goto(g.origin+'/app/runs/'+target.id);await page.getByText('Run inspector',{exact:false}).first().waitFor({timeout:10000}).catch(()=>{});await L.sleep(500);
      const text=await page.locator('body').innerText();L.write('inspector-'+target.name+'.log.txt',text);
      L.check('inspector '+target.name+' cause',text.includes(target.code)&&text.includes('could not list'),{id:target.id,text:text.slice(-7000)});
      const resumes=await page.getByRole('button',{name:'Resume',exact:true}).count();L.log('inspector Resume '+target.name,{buttons:resumes,resumable:target.resumable});
      if(target.name==='listing-exit')await page.screenshot({path:path.join(L.OUT,'inspector-listing-exit.png'),fullPage:true});
    }
  }finally{await browser.close();L.log('QA browser closed',{});}
}
try{
  L.environment();
  const s=setup('matrix');primaryDir=s.dir;primaryCli=s.cli;
  const g=await newGateway(s.dir,6390,s.cli,'matrix');
  for(const [name,names] of [['plain-none',[]],['plain-one',['qa423']],['plain-three',['zeta','alpha','third']],['plain-unusual-safe',['Team-QA_42']]]){
    listing(s.cli,names);const r=await execute(g,s.cli,name);L.check(name+' completes',r.run.status==='succeeded',r.id);
    L.isolation(name,r.requests.find(q=>q.kind==='listing'),r.requests.find(q=>q.kind==='turn'),names);
    if(name==='plain-one')source=r;
  }
  for(const [name,overrides,override] of [
    ['override-server',{'mcp_servers.qa423.enabled':true,approval_policy:'on-request'},{server:'qa423'}],
    ['override-plugins',{features:{plugins:true},approval_policy:'on-request'},{plugins:true}],
  ]){
    listing(s.cli,['qa423','other']);const r=await execute(g,s.cli,name,{harnessOptions:{sandbox:'workspace-write',approval:'never',configOverrides:overrides}});
    L.check(name+' completes',r.run.status==='succeeded',r.id);L.isolation(name,r.requests.find(q=>q.kind==='listing'),r.requests.find(q=>q.kind==='turn'),['qa423','other'],override);
    const args=L.configs(r.requests.find(q=>q.kind==='turn').argv);L.check(name+' thread approval wins',args.includes('approval_policy="on-request"')&&args.at(-1)==='approval_policy="never"',args);
  }
  for(const mode of ['exit','banner','malformed','hang','unusual']){
    listing(s.cli,mode==='unusual'?['team.docs']:['qa423']);s.cli.set('listing-mode.txt',mode==='unusual'?'normal':mode);
    const r=await execute(g,s.cli,'listing-'+mode);const failure=r.run.failure;
    L.check(mode+' listing fails safely',r.run.status==='failed'&&failure?.code==='HARNESS_TURN_FAILED'&&failure?.inference?.submission==='definitely-not-submitted'&&!r.requests.some(q=>q.kind==='turn'),{failure,turns:r.requests.filter(q=>q.kind==='turn').length});
    targets.push({id:r.id,name:'listing-'+mode,code:'HARNESS_TURN_FAILED',resumable:failure?.resumable});
    // Fix external state, then exercise the exact public Resume action offered by the run.
    s.cli.set('listing-mode.txt','normal');listing(s.cli,['qa423']);
    const before=s.cli.requests().filter(q=>q.kind==='turn').length;
    const resume=await g.call(`/runs/${r.id}/resume`,'POST',{observedSeq:r.ev.at(-1).seq});
    L.log(mode+' Resume response',resume);
    if(failure?.resumable){await L.end(g,r.id);const recovered=await L.snapshot(g,r.id,'recovered-'+mode);L.check(mode+' Resume sends one fresh saved task',resume.status===200&&recovered.run.status==='succeeded'&&s.cli.requests().filter(q=>q.kind==='turn').length===before+1&&!s.cli.requests().filter(q=>q.kind==='turn').at(-1).argv.includes('resume'),recovered.run);}
    else L.check(mode+' Resume refused',resume.status===409&&s.cli.requests().filter(q=>q.kind==='turn').length===before,resume);
    if(mode==='hang')await L.sleep(3500); // fake listing naturally exits if sandbox refused taskkill
  }
  // Preserve an unrecovered instance for each inspector cause, since Resume above changes status.
  targets.length=0;
  for(const mode of ['exit','banner','malformed','unusual']){
    s.cli.set('listing-mode.txt',mode==='unusual'?'normal':mode);listing(s.cli,mode==='unusual'?['team.docs']:[]);
    const r=await execute(g,s.cli,'inspect-'+mode);targets.push({id:r.id,name:'listing-'+mode,code:'HARNESS_TURN_FAILED',resumable:r.run.failure?.resumable});
  }
  s.cli.set('listing-mode.txt','normal');listing(s.cli,['qa423']);
  const decision={id:'pick',kind:'decision',label:'Pick',config:{kind:'llm',harness:'codex',instructions:'QA423 choose route',model:{mode:'explicit',value:'gpt-6-luna'},effort:{mode:'explicit',value:'low'},routes:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]}};
  {
    const before=s.cli.requests().length;
    const def={schemaVersion:4,name:'QA423 structured decision',nodes:[L.trigger,decision,L.done],edges:[L.edge('a','start','out','pick'),L.edge('y','pick','yes','done'),L.edge('n','pick','no','done')]};
    const id=await L.start(g,await L.publish(g,def));const result=await L.end(g,id);const snap=await L.snapshot(g,id,'decision');const requests=s.cli.requests().slice(before);L.write('decision-requests.log.txt',requests.map(JSON.stringify).join('\n'));
    const turn=requests.find(q=>q.kind==='turn');L.check('structured decision succeeds',result.status==='succeeded'&&snap.ev.some(e=>e.type==='decision.made')&&turn?.argv.includes('--output-schema'),{result,decision:snap.ev.find(e=>e.type==='decision.made')});L.isolation('decision',requests.find(q=>q.kind==='listing'),turn,['qa423']);
  }
  {
    s.cli.set('decision-cycle.txt','on');s.cli.set('decision-count.txt','0');
    const before=s.cli.requests().length;
    const def=L.inference('QA423 repeated own conversation',{session:{policy:'resume-own'}});def.nodes.splice(2,0,decision);def.edges=[L.edge('a','start','out','infer'),L.edge('b','infer','out','pick'),L.edge('y','pick','yes','infer'),L.edge('n','pick','no','done')];
    const id=await L.start(g,await L.publish(g,def));const result=await L.end(g,id);const snap=await L.snapshot(g,id,'repeated-own');const requests=s.cli.requests().slice(before);L.write('repeated-own-requests.log.txt',requests.map(JSON.stringify).join('\n'));const listings=requests.filter(q=>q.kind==='listing'),turns=requests.filter(q=>q.kind==='turn');
    L.check('second visit resumes same conversation',result.status==='succeeded'&&turns.length===4&&turns[2].argv.includes('resume')&&snap.ev.filter(e=>e.type==='node.started'&&e.nodeId==='infer').length===2,{status:result.status,turns:turns.map(t=>t.argv),sessions:snap.sessions});
    turns.forEach((t,i)=>L.isolation('repeated turn '+i,listings[i],t,['qa423']));s.cli.set('decision-cycle.txt','off');
  }
  {
    const r=await execute(g,s.cli,'claude',{harness:'claude',model:'claude-haiku-5-5',harnessOptions:{sandbox:'read-only',approval:'never'}});const argv=r.requests.find(q=>q.kind==='claude-turn')?.argv??[];
    L.check('Claude completes with unchanged isolation flags',r.run.status==='succeeded'&&argv.includes('--safe-mode')&&argv.includes('--strict-mcp-config')&&argv.includes('--setting-sources')&&argv[argv.indexOf('--setting-sources')+1]==='',argv);
  }
  try{await browserInspect(g);}catch(error){L.check('browser inspector observable',false,String(error.stack));}
  await g.stop();
  // Missing binary after successful admission: Replay intentionally has no readiness probe.
  {
    const missing=await newGateway(s.dir,6390,s.cli,'missing',{GG_CODEX_BINARY:path.join(s.dir,'not-installed.exe')});
    const replay=await missing.call(`/runs/${source.id}/replay`,'POST',{observedSeq:source.ev.at(-1).seq,nodeId:'infer'});L.log('missing binary Replay response',replay);
    const id=replay.json.run?.id??replay.json.runId;
    if(id){await L.end(missing,id);const snap=await L.snapshot(missing,id,'missing');L.check('missing binary definitely not submitted',snap.run.failure?.code==='HARNESS_NOT_INSTALLED'&&snap.run.failure?.inference?.submission==='definitely-not-submitted',snap.run.failure);const resume=await missing.call(`/runs/${id}/resume`,'POST',{observedSeq:snap.ev.at(-1).seq});L.log('missing binary Resume response',resume);if(resume.status===200)await L.end(missing,id);}
    else L.check('missing binary Replay creates run',false,replay);
    await missing.stop();
  }
  // Drain while a real fake CLI process is still running, followed by persisted restart.
  {
    const {dir,cli}=setup('drain');cli.set('hold.txt','on');const g=await newGateway(dir,6391,cli,'drain');const id=await L.start(g,await L.publish(g,L.inference('QA423 drain held turn')));await L.until(()=>cli.requests().some(q=>q.kind==='turn'));await L.until(async()=> (await L.events(g,id)).some(e=>e.type==='harness.submission'&&e.submission==='submitted'));
    const drain=await g.call('/system/shutdown','POST',{action:'drain'});await L.sleep(500);L.check('drain preserves active turn',!g.exit()&&(await g.call(`/runs/${id}`)).json.status==='running',{drain});cli.set('release.txt','go');L.check('drain exits after turn finishes',(await g.waitExit()).code===0,{});g.save();
    const restart=await newGateway(dir,6391,cli,'drain-restart');const snap=await L.snapshot(restart,id,'drain-after-restart');L.check('drained run persisted success',snap.run.status==='succeeded',snap.run);await restart.stop();
  }
  // A parked durable signal wait is not automatically replayed on restart.
  {
    const {dir,cli}=setup('parked');const g=await newGateway(dir,6392,cli,'parked');const def=L.inference('QA423 parked resumed conversation',{session:{policy:'resume-previous'}});const first={...def.nodes[1],id:'first',config:{...def.nodes[1].config,session:{policy:'fresh'}}};def.nodes.splice(1,0,first,{id:'park',kind:'wait',label:'Park',config:{mode:'signal',name:'qa423-go'}});def.edges=[L.edge('a','start','out','first'),L.edge('b','first','out','park'),L.edge('c','park','out','infer'),L.edge('d','infer','out','done')];
    const id=await L.start(g,await L.publish(g,def));await L.until(async()=>(await g.call(`/runs/${id}`)).json.status==='waiting');const prior=await L.snapshot(g,id,'parked-before-restart');const count=cli.requests().filter(q=>q.kind==='turn').length;await g.stop();const restart=await newGateway(dir,6392,cli,'parked-restart');await L.sleep(600);L.check('parked restart does not send another turn',(await restart.call(`/runs/${id}`)).json.status==='waiting'&&cli.requests().filter(q=>q.kind==='turn').length===count,{});
    const ev=(await L.events(restart,id)).findLast(e=>e.type==='wait.started');L.log('parked wait record',ev);const waitId=ev?.waitId??(await restart.call(`/runs/${id}`)).json.wait?.id;
    const signal=await restart.call(`/runs/${id}/signals/qa423-go`,'POST',{waitId,payload:{qa:true}});L.log('parked release signal',signal);await L.end(restart,id);const snap=await L.snapshot(restart,id,'parked-after-restart');const turns=cli.requests().filter(q=>q.kind==='turn'),lists=cli.requests().filter(q=>q.kind==='listing');L.check('parked resumes and completes',snap.run.status==='succeeded'&&turns.length===2&&turns[1].argv.includes('resume'),{run:snap.run,turns});turns.forEach((t,i)=>L.isolation('parked turn '+i,lists[i],t));await restart.stop();
  }
  // Native force is attempted once. D-015 must be recorded as unobservable if taskkill is denied.
  {
    const {dir,cli}=setup('force');cli.set('hold.txt','on');const g=await newGateway(dir,6393,cli,'force');const id=await L.start(g,await L.publish(g,L.inference('QA423 force held turn')));await L.until(()=>cli.requests().some(q=>q.kind==='turn'));await L.sleep(250);const forced=await g.call('/system/shutdown','POST',{action:'force'});L.log('force request',forced);await L.sleep(6000);
    L.write('force-state.json',{exit:g.exit(),run:g.exit()?null:(await g.call(`/runs/${id}`)).json,shutdown:g.exit()?null:await g.call('/system/shutdown'),gatewayLog:g.logs()});
    // Self-release is explicit fixture cleanup, never evidence that native tree termination worked.
    cli.set('release.txt','go');await L.sleep(500);if(!g.exit())await g.call('/system/shutdown','POST',{action:'force'}).catch(()=>{});await g.waitExit(20000).catch(()=>{});g.save();L.log('force cleanup exit',g.exit());
    const restart=await newGateway(dir,6393,cli,'force-restart');const snap=await L.snapshot(restart,id,'force-after-restart');L.log('force restart outcome',snap.run);await restart.stop();
  }
}catch(error){L.check('scenario driver completed',false,String(error.stack));}
finally{
  for(const cli of fixtures)cli.set('release.txt','go');
  for(const g of gateways)if(!g.exit())await g.stop();else g.save();
  for(let i=0;i<fixtures.length;i++)L.write('all-requests-'+i+'.log.txt',fixtures[i].requests().map(JSON.stringify).join('\n'));
  L.write('results.json',{checks:L.checks,passed:L.checks.filter(c=>c.ok).length,failed:L.checks.filter(c=>!c.ok).length,processes:gateways.map(g=>({pid:g.pid,exit:g.exit()})),disposableStores:fixtures.map(c=>path.dirname(c.dir)),realProviderTurns:0});
}
