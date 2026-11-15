import assert from 'node:assert/strict';
import {cp,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=dirname(fileURLToPath(import.meta.url));
await cp(join(root,'driver-v2'),join(root,'driver-v3'),{recursive:true,errorOnExist:true,force:false});
let driver=await readFile(join(root,'driver-v3/history.playwright.js'),'utf8');
const helper=`  async function openWorkCard(card) {
    if (config === 'r512-reflow200') {
      const before = await get();
      const beforeFrame = await snapshot();
      const count = writes().length;
      await mark('native-Fit-View-preparation');
      await page.getByRole('button', {name:/^fit view$/i}).click({timeout:10000});
      const target = await until(() => card.evaluate(el => {
        const r=el.getBoundingClientRect();
        const c=el.closest('.react-flow').getBoundingClientRect();
        const x=r.x+r.width/2,y=r.y+r.height/2;
        const hit=document.elementFromPoint(x,y);
        return x>=c.left && x<c.right && y>=c.top && y<c.bottom && el.contains(hit)
          ? {box:[r.x,r.y,r.width,r.height],canvas:[c.x,c.y,c.width,c.height],point:[x,y],actualTarget:hit.closest('.react-flow__node')?.getAttribute('data-id')} : null;
      }), 'work card real centre hit after native Fit View');
      const after=await get();
      same(def(after),def(before),'Native Fit View kept complete server graph');
      same(after.draftToken,before.draftToken,'Native Fit View kept content token');
      check(writes().length===count,'Native Fit View unexpectedly wrote graph');
      same((await snapshot()).boxes,beforeFrame.boxes,'Native Fit View kept history targets');
      notes.push({label:'native Fit View prepared actual work target',target,before,after});
      await trace('native-fit-view-preparation');
    }
    await card.click({timeout:10000});
  }

`;
assert(driver.includes('  async function dialog(prior) {'));
driver=driver.replace('  async function dialog(prior) {',helper+'  async function dialog(prior) {');
assert.equal(driver.split('await card.click({ timeout: 10000 });').length,3);
driver=driver.replaceAll('await card.click({ timeout: 10000 });','await openWorkCard(card);');
assert.equal(driver.split('await card.click({timeout:10000});').length,3);
// Preserve the helper's actual native click; replace only the held-validation call.
const begin=driver.indexOf('  async function heldValidation(prior) {');
driver=driver.slice(0,begin)+driver.slice(begin).replace('await card.click({timeout:10000});','await openWorkCard(card);');
const remaining=`  async function remainingR512() {
    // The first R512 run passed all normal history phases through held PUT. Preserve those.
    await open(false);
    await historyAttributes(true);
    await publish(false);
    let current=await apply('one distinctive step for remaining modal',addScript,baseline);
    recordAdd(baseline,current);
    await trace('remaining-modal-fixture');
    current=await dialog(current);
    await heldValidation(current);
    out.limits.push('R512 correction2 runs only remaining modal and held-validation phases; first-run history/keyboard/held-PUT/wrap passes retained');
  }

`;
driver=driver.replace('  async function inPageBanner(prefix, where) {',remaining+'  async function inPageBanner(prefix, where) {');
driver=driver.replace("    if (group.startsWith('h-')) await normal();", "    if (group === 'h-r512') await remainingR512();\n    else if (group.startsWith('h-')) await normal();");
const ownershipStart=driver.indexOf('  async function ownership() {');
const settingsStart=driver.indexOf('    out.settings = ',ownershipStart);
const nameStart=driver.indexOf("    const name = 'QA missing escalation",settingsStart);
assert(ownershipStart>0&&settingsStart>ownershipStart&&nameStart>settingsStart);
const settings=driver.slice(settingsStart,nameStart);
driver=driver.slice(0,settingsStart)+driver.slice(nameStart);
const reload=driver.indexOf('    await page.reload();',ownershipStart);
assert(reload>ownershipStart);
const reloadEnd=reload+'    await page.reload();'.length;
driver=driver.slice(0,reloadEnd)+'\n'+settings.trimEnd()+driver.slice(reloadEnd);
await writeFile(join(root,'driver-v3/history.playwright.js'),driver);
let run=await readFile(join(root,'driver-v3/run-case.mjs'),'utf8');
run=run.replaceAll('driver-v2-manifest.json','driver-v3-manifest.json');
await writeFile(join(root,'driver-v3/run-case.mjs'),run);
const digest=b=>createHash('sha256').update(b).digest('hex');
const files={};
async function collect(dir){for(const item of await readdir(join(root,dir),{withFileTypes:true})){
  const path=dir+'/'+item.name;if(item.isDirectory())await collect(path);else files[path]=digest(await readFile(join(root,path)));
}}
await collect('driver-v3');
for(const path of Object.keys(files).filter(path=>/\.(mjs|js)$/.test(path)))execFileSync(process.execPath,['--check',join(root,path)],{windowsHide:true,stdio:'pipe',maxBuffer:128*1024*1024});
const manifest=JSON.stringify({version:'driver-v3-correction2',files},null,2)+'\n';
await writeFile(join(root,'driver-v3-manifest.json'),manifest,{flag:'wx'});
const admission=JSON.parse(await readFile(join(root,'admission-native.json'),'utf8'));
admission.authorizedGroups=['h-r512','ownership-d1','ownership-r512'];admission.driverManifestSha256=digest(manifest);
await writeFile(join(root,'admission-correction2.json'),JSON.stringify(admission,null,2)+'\n',{flag:'wx'});
const ledger=JSON.parse(await readFile(join(root,'..','fixture-corrections.json'),'utf8'));
assert.equal(ledger.length,1);
ledger.push({attempt:'correction2',groups:['h-r512','ownership-d1','ownership-r512'],firstEvidence:['final-parent-v2b/runs/h-r512-initial/observed.json','final-parent-v2b/runs/ownership-d1-initial/observed.json'],
  fixtureCause:'R512 surviving work card is outside clipped canvas and covered by toolbar. Native public Fit View and actual centre hit check prepare modal with exact unchanged graph/token/no-write/history geometry; repeat only modal and held-validation remainder. Ownership configuration was checked before existing reload applied stored light theme; move unchanged configuration oracle after that reload for both ownership groups.',
  evidence:'Canvas.tsx initial minZoom0.5; native Fit View control and repository e2e fixtures; first-failure screenshot retained',
  unchangedOracles:true});
await writeFile(join(root,'..','fixture-corrections.json'),JSON.stringify(ledger,null,2)+'\n');
console.log(JSON.stringify({manifestSha256:digest(manifest),correctionsConsumed:2,cap:2,groups:admission.authorizedGroups}));
