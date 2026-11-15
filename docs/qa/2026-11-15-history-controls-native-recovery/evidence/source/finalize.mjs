import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
let text=await readFile(join(root,'handoff.md'),'utf8');
const replacements={
  'ports4747/4748':'ports 4747/4748','stack82155142':'stack 82155142','complete1,227-file/13-tree':'complete 1,227-file/13-tree',
  'passed12/12':'passed 12/12','Node22.23.4':'Node 22.23.4','bind1,505':'bind 1,505','all1,227':'all 1,227','in13 trees':'in 13 trees','and21 directly':'and 21 directly',
  'D1,1440x900':'D1, 1440x900','D2,1440x900':'D2, 1440x900','N768,768x900':'N768, 768x900','R512,512x384':'R512, 512x384',
  'holds256.7/260.9ms':'holds of 256.7/260.9 ms','including44px':'including 44 px','holds266.1/262.4ms':'holds of 266.1/262.4 ms',
  'with120-character':'with a 120-character','remained118px':'remained 118 px','holds264.7/259.1ms':'holds of 264.7/259.1 ms',
  'wrap150→194px':'wrap of 150→194 px','holds254.5/263.2ms':'holds of 254.5/263.2 ms','Correction2':'Correction 2',
  'online404s':'online 404s','initial404s':'initial 404s','Across57':'Across 57','delta0CSSpx':'delta 0 CSS px',
  'of1095.7–1107.1ms':'of 1095.7–1107.1 ms','holds287.4–294.5ms':'holds of 287.4–294.5 ms','All59':'All 59','all59':'all 59',
  'third404':'third 404','expected404':'expected 404','default1MiB':'default 1 MiB','Correction1':'Correction 1','explicit128MiB':'explicit 128 MiB',
  'first-stage/1px':'first-stage/1 px','historical821':'historical 821','on899':'on 899','all8 native':'all 8 native','exits were0':'exits were 0'};
for(const [before,after] of Object.entries(replacements))text=text.replaceAll(before,after);
const links=[...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match=>match[1]);
for(const path of links)await access(join(root,path));
const summary=JSON.parse(await readFile(join(root,'final-parent-v2b/result-summary.json'),'utf8'));
const metrics={stationarityWindows:summary.reports.reduce((sum,r)=>sum+r.verifiedStationarityWindows,0),
  frameWindows:summary.reports.reduce((sum,r)=>sum+r.frameWindows,0),
  graphReplays:summary.reports.reduce((sum,r)=>sum+r.persistedGraphReplays,0),
  conditionalPuts:summary.reports.reduce((sum,r)=>sum+r.successfulConditionalPuts,0)};
assert.equal(metrics.stationarityWindows,57);assert.equal(metrics.graphReplays,59);assert.equal(metrics.conditionalPuts,59);
await writeFile(join(root,'handoff.md'),text);
const sha=b=>createHash('sha256').update(b).digest('hex');
const cleanup=JSON.parse(await readFile(join(root,'final-parent-v2b/cleanup-final.json'),'utf8'));
assert.equal(cleanup.recorded.length,8);
for(const key of ['ownedLive','listeners','leftoverStoresOrSqlite','unqualifiedPidMatches','resourceFailures'])assert.equal(cleanup[key].length,0,key);
const completion={status:'six-remaining-groups-complete',head:summary.head,tree:summary.tree,base:summary.base,
  observedMain:summary.actualMain,model:'gpt-6-astra',reasoning:'xhigh',nativeInvocations:8,retainedNativeFixtureFailures:2,
  corrections:{priorExhausted:2,escalationConsumed:2,escalationCap:2},formalScansConsumed:0,
  metrics,heavySlotReleased:true,sourceAndArtifactsByteStable:true,ownedCleanupPassed:true,
  finalMainClaim:false,ownerAcceptanceClaim:false,handoffSha256:sha(text),checkedLocalLinks:links.length};
await writeFile(join(root,'completion.json'),JSON.stringify(completion,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(completion));
