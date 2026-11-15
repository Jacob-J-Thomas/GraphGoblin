import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,copyFile,cp} from 'node:fs/promises';
import {join} from 'node:path';

const [base]=process.argv.slice(2);
const original=join(base,'space-208-independent');
const sibling=join(base,'space-208-double-hit-supplement');
const sha=(v)=>createHash('sha256').update(v).digest('hex');
await mkdir(sibling,{recursive:true});
const fixed=['source-binding.json','forced-build.log','forced-build-exit.json','verify-binding.mjs','verify-domain-map.mjs','fixture-corrections.json'];
for(const file of fixed)await copyFile(join(original,file),join(sibling,file));
for(const dir of ['drivers','binding','manifests']) {
  if(dir==='binding'){
    await mkdir(join(sibling,dir));
    await copyFile(join(original,dir,'binding-before.json'),join(sibling,dir,'binding-before.json'));
  }else await cp(join(original,dir),join(sibling,dir),{recursive:true});
}

function replaceOnce(content,from,to) {
  assert.equal(content.split(from).length,2,'Expected one exact driver source anchor: '+from);
  return content.replace(from,to);
}
const probe=String.raw`
  async function alternateZoomDoubleHit(){
    await stage('alternate-r512-zoomout',async()=>{
      const locate=()=>page.evaluate(()=>{
        const probe=window.__spaceQA, button=probe.buttons()[0], box=probe.box(button);
        const point=[Math.round(box[0]+box[2]*.16),Math.round(box[1]+box[3]/2)];
        return {point,box,ownsHit:button.contains(probe.hit(point)),atPoint:probe.name(probe.hit(point))};
      });
      const timeline=(rows)=>rows
        .filter(row=>row.viewport)
        .filter((row,i,all)=>i===0 || row.viewport.join()!==all[i-1].viewport.join())
        .map(row=>({t:row.t,type:row.type,target:row.target,viewport:row.viewport,style:row.viewportStyle}));
      const signature=(series)=>series.map(row=>row.viewport.join(','));
      const events=(rows)=>rows.filter(row=>row.trusted &&
        ['pointerdown','mousedown','pointerup','mouseup','click','dblclick'].includes(row.type))
        .map(({type,t,target,hit,detail,point,viewport,zoomOut,canceledAfterDispatch})=>({
          type,t,target,hit,detail,point,viewport,zoomOut,canceledAfterDispatch
        }));
      async function action(label,doubled){
        const prior=await newFixture(label);
        const hit=await locate();
        await checkpoint(label+'-coordinates',hit);
        check(hit.ownsHit && hit.atPoint==='Space cards' && hit.point.join()==='93,290',
          label+' owns the same R512 x93 y290 hit','unwitnessed');
        const measured=await measure(), expected=expectedSpace(definition(prior),heights(measured));
        const before=await snap(hit.point);
        await mark(label,hit.point);
        if(doubled)await page.mouse.dblclick(...hit.point);
        else await page.mouse.click(...hit.point);
        const immediate=await snap(hit.point);
        await settled(label);
        const next=await accepted(label,0,prior,expected);
        const after=await snap(hit.point);
        const rows=await trace(label);
        const sequence=timeline(rows), delivered=events(rows);
        await checkpoint(label+'-readback',{hit,before,immediate,after,sequence,delivered,measurement:await measure()});
        check(delivered.some(row=>row.type==='click' && row.target==='Space cards' && row.detail===1),
          label+' contains the trusted first Space click','unwitnessed');
        check(after.buttons.length===0,label+' removes the offer');
        check(after.history[0]?.[1]!=='true' && after.history[1]?.[1]==='true',label+' creates undo availability');
        return {hit,prior,next,expected,before,immediate,after,sequence,delivered,rows,measured};
      }
      const single=await action('alternate-single-healthy',false);
      check(single.after.hit==='Zoom Out' && single.after.zoomOut?.ownsPoint && !single.after.zoomOut.disabled,
        'Healthy control sees an enabled Zoom Out at the identical post-unmount coordinate','unwitnessed');
      same(single.after.viewport,[1,29,.5],'The same-point single click produces the qualified R512 fit');
      same(signature(single.sequence).length,2,'The healthy Space action produces one observable transform');
      await verifyGeometry('alternate-single-healthy',single.expected,single.measured);
      await mark('deliberate-zoom-out',single.hit.point);
      await page.mouse.click(...single.hit.point);
      const afterControl=await settled('deliberate-zoom-out');
      const controlRows=await trace('deliberate-zoom-out');
      await checkpoint('healthy-deliberate-zoom-out',{before:single.after,after:afterControl,delivered:events(controlRows),sequence:timeline(controlRows)});
      check(events(controlRows).some(row=>row.type==='click' && row.target==='Zoom Out' && !row.zoomOut?.disabled),
        'Real deliberate click reaches available Zoom Out','unwitnessed');
      check(afterControl.viewport[2]<single.after.viewport[2],'Deliberate real Zoom Out visibly reduces zoom','unwitnessed');
      await quiet(single.next,1,await localDraft(),'viewport-only-zoom-control');
      const doubled=await action('alternate-double',true);
      const second=doubled.delivered.filter(row=>row.type==='pointerdown')[1];
      const zoomClick=doubled.delivered.find(row=>row.type==='click' && row.target==='Zoom Out' && row.detail===2);
      same(doubled.before.viewport,single.before.viewport,'Fresh single and double have identical pre-action viewport');
      const comparison={
        testedPoint:doubled.hit.point, healthyFit:single.after.viewport, healthySequence:signature(single.sequence),
        healthyDeliberateZoomOut:afterControl.viewport, doubleFinal:doubled.after.viewport, doubleSequence:signature(doubled.sequence),
        secondDown:second, zoomClick:zoomClick ?? null,
        postUnmountHit:doubled.after.hit, postUnmountZoomOut:doubled.after.zoomOut,
        oneConditionalSave:true,
      };
      await checkpoint('alternate-comparison',comparison);
      check(second && second.point.join()===doubled.hit.point.join() && second.hit==='Zoom Out' &&
        second.target==='Zoom Out' && doubled.after.hit==='Zoom Out',
        'Natural second down was not witnessed on Zoom Out at the same post-unmount hit','unwitnessed');
      if(signature(doubled.sequence).join('|')!==signature(single.sequence).join('|') ||
        doubled.after.viewport.join()!==single.after.viewport.join()){
        check(false,'One Space double-click delivered a second target at Zoom Out and produced an extra viewport action');
      }
      check(!zoomClick || zoomClick.canceledAfterDispatch===true,
        'A trusted second click reached enabled Zoom Out uncanceled despite unchanged observable viewport','unwitnessed');
      check(!doubled.after.modal && !doubled.rows.some(row=>row.modal),'No node dialog from the alternate retarget');
      same(doubled.after.selected,doubled.before.selected,'Alternate double-click preserves settled selection');
      const undone=await historyMove('undo',doubled.next,definition(doubled.prior),'alternate-one-undo');
      check(undone.draftToken!==doubled.next.draftToken && (await snap()).history[0][1]==='true',
        'One Undo exhausts the double-click history');
    });
  }
`;
const driverPath=join(sibling,'drivers','space.playwright.js');
let driver=await readFile(driverPath,'utf8');
driver=replaceOnce(driver,"      const announcer=root()?.querySelector('[aria-live=\"polite\"][aria-atomic=\"true\"]');",
  "      const announcer=root()?.querySelector('[aria-live=\"polite\"][aria-atomic=\"true\"]');\n"+
  "      const zoomOut=document.querySelector('.react-flow__controls-zoomout');");
driver=replaceOnce(driver,"        hit:name(hit(point)),d3:d3(),d3Observable:Array.isArray(window.__on),",
  "        hit:name(hit(point)),zoomOut:zoomOut ? {disabled:zoomOut.disabled,ownsPoint:zoomOut.contains(hit(point)),box:box(zoomOut)} : null,\n"+
  "        d3:d3(),d3Observable:Array.isArray(window.__on),");
driver=replaceOnce(driver,"  page.on('pageerror',error=>out.pageErrors.push(String(error)));",probe+"\n  page.on('pageerror',error=>out.pageErrors.push(String(error)));");
driver=replaceOnce(driver,"    if(group==='apply-d1')await applyGroup();","    if(group==='alternate-r512')await alternateZoomDoubleHit();\n    else if(group==='apply-d1')await applyGroup();");
await writeFile(driverPath,driver);
const runnerPath=join(sibling,'drivers','run-case.mjs');
let runner=await readFile(runnerPath,'utf8');
runner=replaceOnce(runner,"  'touch-d2': 'd2-coarse-dark', 'double-r512': 'r512-reflow200', 'device-d1': 'd1-fine-light',",
  "  'touch-d2': 'd2-coarse-dark', 'double-r512': 'r512-reflow200', 'device-d1': 'd1-fine-light',\n"+
  "  'alternate-r512': 'r512-reflow200',");
await writeFile(runnerPath,runner);
const manifest={version:'space-208-alternate-double-v1',files:{}};
const bindPaths=['drivers/space.playwright.js','drivers/run-case.mjs','drivers/gateway.mjs','drivers/verify-cleanup.ps1',
  'verify-binding.mjs','verify-domain-map.mjs','plan-addendum.md'];
for(const name of await readdir(join(sibling,'drivers/configs')))bindPaths.push('drivers/configs/'+name);
for(const relative of bindPaths)manifest.files[relative]=sha(await readFile(join(sibling,relative)));
const manifestBytes=JSON.stringify(manifest,null,2)+'\n';
await writeFile(join(sibling,'driver-manifest.json'),manifestBytes,{flag:'wx'});
const admission=JSON.parse(await readFile(join(original,'admission-native-authorized.json'),'utf8'));
assert.equal(admission.beforeBindingSha256,sha(await readFile(join(sibling,'binding','binding-before.json'))));
assert.equal(admission.cacheCliSha256,sha(await readFile(admission.cacheCli)));
admission.buildGrant=JSON.stringify({grantedBy:'/root',authority:'Reuse already built and verified exact 5c80 outputs; rebind on both sides',rebuildAllowed:false});
admission.nativeGrant={grantedBy:'/root',scope:'One alternate native R512 double-click plus same-point single and settled Zoom Out positive controls. Exclusive native slot.'};
admission.driverManifestSha256=sha(manifestBytes);
admission.authorizedGroups=['alternate-r512'];
await writeFile(join(sibling,'admission-native-authorized.json'),JSON.stringify(admission,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({head:admission.head,tree:admission.tree,beforeBindingSha256:admission.beforeBindingSha256,driverManifestSha256:admission.driverManifestSha256}));

