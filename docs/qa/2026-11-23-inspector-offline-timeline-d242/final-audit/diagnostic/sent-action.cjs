'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const repo = 'G:/ggq/gg-i5-offline-inspector/GraphGoblin';
const evidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents';
const candidate = 'i5-416-420-post-feedback-browser12-execution-01';
const baseline = 'i5-416-420-baseline-g1-execution-01';
const project = createRequire(repo + '/apps/web/package.json');
const { chromium } = createRequire(project.resolve('@playwright/test'))('playwright');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const origin = 'https://inspector.invalid';
const readPy = [
  'import json,sys,zipfile,pathlib,urllib.parse as u,hashlib',
  "p=next(pathlib.Path(sys.argv[1]).glob('*812c1*/trace.zip'))",
  "assert hashlib.sha256(p.read_bytes()).hexdigest()=='08b00707e26c4940dabdf14a3a56038a5ecf23f2041198d2f15d058b485bddee'",
  'responses={}',
  'with zipfile.ZipFile(p) as z:',
  " for line in z.read('2-trace.network').splitlines():",
  "  o=json.loads(line)['snapshot']; req=o['request']; url=u.urlsplit(req['url']); body=o['response']['content']",
  "  if req['method']=='GET' and not url.path.startswith('/app/') and body.get('_file') and 'json' in body['mimeType']:",
  "   responses[url.path]=json.loads(z.read(body['_file']))",
  'print(json.dumps(responses))'
].join('\n');
const replies = JSON.parse(execFileSync('python', ['-c', readPy, evidence + '/' + candidate + '/browser-artifacts'], {encoding:'utf8'}));
const runPath = Object.keys(replies).find(p => /^\/runs\/[^/]+$/.test(p));
const run = replies[runPath];
if (run.status !== 'failed' || !run.finalizedAt || run.recovery.observedSeq !== 6) throw Error('Unqualified retained B3 projection');
const quiet = ms => new Promise(r => setTimeout(r,ms));
async function until(fn, what, limit=5000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now()-start >= limit) throw Error('Timed out waiting for ' + what);
    await quiet(20);
  }
}
const firstKey='inert-a', secondKey='inert-b';
const keyName='graphgoblin-api-key';
const mime={'.js':'application/javascript', '.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.html':'text/html','.webmanifest':'application/manifest+json'};
function files(build) {
  const packet = path.join(evidence, build === 'candidate' ? candidate : baseline);
  const manifest = JSON.parse(fs.readFileSync(path.join(packet,build === 'candidate' ? 'BUILD-MANIFEST.json' : 'BASELINE-WEB-MANIFEST.json')));
  const dist = path.join(packet, 'owned-web-dist');
  for (const [name, pin] of Object.entries(manifest.webDist)) {
    const b=fs.readFileSync(path.join(dist,name));
    if (b.length!==pin.bytes || hash(b)!==pin.sha256) throw Error(build+' asset mismatch '+name);
  }
  return {dist, bundle:Object.entries(manifest.webDist).find(([n])=>n.startsWith('assets/')&&n.endsWith('.js'))[1].sha256, assetCount:Object.keys(manifest.webDist).length};
}
async function probe(browser, source, action, mode, data) {
  const result={source,action,mode,buildBundle:data.bundle,verifiedDistributionMembers:data.assetCount,steps:[],pendingObserved:false};
  const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:900}});
  const requests=[]; const posts=[]; const held=[]; const unknown=new Set();
  let holdNew=false, failedOld=false;
  const actionPath=action==='script' ? runPath+'/resume' : '/runs/deletion-eligibility';
  const newkey=req=>req.headers().authorization==='Bearer '+secondKey;
  const json=(route,value)=>route.fulfill({json:value,status:200});
  await ctx.addInitScript(({name,key})=>{if(!localStorage.getItem(name))localStorage.setItem(name,key)}, {name:keyName,key:firstKey});
  await ctx.route('**/*',async route=>{
    const req=route.request(), u=new URL(req.url()), p=u.pathname;
    if(u.origin!==origin) {unknown.add('foreign origin blocked');return route.abort('blockedbyclient');}
    if(p==='/publisher')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Inert same-origin storage publisher</title>'});
    if(p.startsWith('/app/')){
      const rel=p.startsWith('/app/runs/')?'index.html':p.slice(5);
      if(!Object.hasOwn(mime,path.extname(rel)) || rel.includes('..') || !fs.existsSync(path.join(data.dist,rel)))return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:mime[path.extname(rel)],body:fs.readFileSync(path.join(data.dist,rel))});
    }
    if(req.method()==='POST'){
      if(p==='/runs/deletion-eligibility/preview')return json(route,{token:'a'.repeat(64),items:[{runId:run.id,reasons:[]}]});
      if(p===actionPath){
        const b=req.postDataJSON();
        posts.push({route,body:action==='script'?{observedSeq:b.observedSeq,retryUncertainScript:b.retryUncertainScript}:{action:b.action,confirmed:b.confirmed,exactSelection:b.runIds.length===1&&b.runIds[0]===run.id,currentPreviewToken:b.token==='a'.repeat(64)}});
        return;
      }
      unknown.add('unhandled POST '+p);return route.fulfill({status:404,body:''});
    }
    if(p===runPath){requests.push({second:newkey(req)});if(holdNew&&newkey(req)){held.push(route);return;}}
    if(Object.hasOwn(replies,p))return json(route,replies[p]);
    if(p.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:': inert stream\n\n'});
    if(p==='/health')return json(route,{status:'ok'});
    unknown.add(req.method()+' '+p);return route.fulfill({status:404,body:''});
  });
  try {
    const page=await ctx.newPage();page.setDefaultTimeout(5000);
    const pub=await ctx.newPage();await pub.goto(origin+'/publisher');
    page.on('requestfailed',req=>{if(req.url()===origin+actionPath&&req.method()==='POST')failedOld=true;});
    await page.goto(origin+'/app'+runPath);
    const header=page.getByRole('heading',{name:'Run '+run.id,exact:true});
    const launcher=page.getByRole('button',{name:action==='script'?'Recover script':'Review delete-ready history',exact:true});
    const confirm=()=>page.getByRole('dialog').getByRole('button',{name:action==='script'?'Resume':'Confirm delete-ready selection',exact:true});
    const dialog=page.getByRole('dialog');
    await header.waitFor();await launcher.click();await confirm().click();
    await until(()=>posts.length===1,'original intercepted request');
    result.steps.push('one original write arrived and is held');
    await header.evaluate(el=>{window.__reviewOriginalHeader=el;});
    await ctx.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);
    if(source==='candidate')await page.getByText('Last observed, may be out of date',{exact:true}).waitFor();
    if(source==='candidate')result.oldDialogDuringLoss=await dialog.isVisible();
    await ctx.setOffline(false);await page.waitForFunction(()=>navigator.onLine);
    if(source==='candidate') {
      await page.getByText('Last observed, may be out of date',{exact:true}).waitFor({state:'hidden'});
      await until(()=>requests.length>=2,'fresh matching run read after browser loss');
    }
    result.dialogAfterRecovery=await dialog.isVisible();
    result.sameHeaderAfterRecovery=await header.evaluate(el=>el===window.__reviewOriginalHeader);
    result.oldPendingAfterRecovery=!failedOld && posts.length===1;
    result.heldByUiBeforeRotation=await dialog.isVisible() ? await confirm().isDisabled():await launcher.isDisabled();
    if(!result.sameHeaderAfterRecovery||!result.oldPendingAfterRecovery||!result.heldByUiBeforeRotation)throw Error('Original pending action or recovery control not established');
    result.steps.push('browser loss and recovery observed, original still pending and UI holds it');
    holdNew=true;
    await pub.evaluate(({name,key})=>localStorage.setItem(name,key),{name:keyName,key:secondKey});
    await until(()=>held.length>0,'new generation matching run GET held');
    result.originalHeaderConnectedWhileNewReadHeld=await page.evaluate(()=>window.__reviewOriginalHeader.isConnected);
    result.visibleRunWhileNewReadHeld=await header.isVisible();
    holdNew=false;for(const r of held.splice(0))await json(r,run);
    await header.waitFor();
    if(source==='candidate')await page.getByText(/This run has not been confirmed since/).waitFor({state:'hidden'});
    result.sameHeaderAfterRequalification=await header.evaluate(el=>el===window.__reviewOriginalHeader);
    result.originalPendingAfterRequalification=!failedOld&&posts.length===1;
    result.launcherEnabled=await launcher.isEnabled();
    result.previousDialogVisible=await dialog.isVisible();
    result.secondConfirmEnabledInOldDialog=result.previousDialogVisible?await confirm().isEnabled():null;
    result.pendingObserved=true;
    if(!result.originalPendingAfterRequalification)throw Error('First transport already settled');
    result.steps.push('new credential generation returned same finalized run on unchanged route');
    if(mode==='duplicate'){
      if(!result.previousDialogVisible&&result.launcherEnabled){
        await launcher.click();await confirm().click();
        await until(()=>posts.length===2,'second controlled write');
      }
      result.outstandingWriteCount=posts.length;
      result.postPayloads=posts.map(p=>p.body);
      result.steps.push('fresh local review and confirm attempted if UI allowed it');
    }else{
      const first=posts[0].route;await first.abort('failed');await until(()=>failedOld,'original network failure');
      const errorPattern=/The GraphGoblin API cannot be reached|may or may not have been saved|the GraphGoblin API could not be reached/i;
      let visibleFeedback=false;
      try { await page.getByText(errorPattern).first().waitFor({state:'visible',timeout:2000});visibleFeedback=true; } catch(err) { if(err.name!=='TimeoutError')throw err; }
      result.feedbackObservedWithinTwoSeconds=visibleFeedback;
      result.visibleFeedback=visibleFeedback?await page.getByText(errorPattern).first().innerText():null;
      result.runStillShown=await header.isVisible();
      result.controlStillPresented=await launcher.isVisible();
      result.postPayloads=posts.map(p=>p.body);result.steps.push('first response failed, observed same-run visible feedback under bounded wait');
    }
    result.state='observed';
  }catch(error){result.state='fixture-error';result.error=String(error).slice(0,1700);}
  finally{result.unhandled=Array.from(unknown);await ctx.close();}
  return result;
}
(async()=>{
 if(process.version!=='v22.23.4')throw Error('Wrong Node runtime');
 const out=process.argv[2];if(fs.existsSync(out))throw Error('Output already exists');
 const distributions={candidate:files('candidate'),baseline:files('baseline')};
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const report={node:process.version,browser:browser.version(),label:'Native browser, intercepted fixture data, no backend listener',cases:[]};
 try{
   for(const [source,action,mode] of [['candidate','script','feedback'],['baseline','script','feedback'],['candidate','script','duplicate'],['candidate','deletion','feedback'],['baseline','deletion','feedback'],['candidate','deletion','duplicate']]){
     report.cases.push(await probe(browser,source,action,mode,distributions[source]));
     fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(source,action,mode,JSON.stringify(report.cases.at(-1)));
   }
 }finally{await browser.close();}
 if(report.cases.some(c=>c.state!=='observed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
