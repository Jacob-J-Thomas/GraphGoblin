const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = 'G:/ggq/gg-i5-provenance-core-qa/GraphGoblin';
const load = (relative) => JSON.parse(fs.readFileSync(path.join(__dirname,relative),'utf8'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const differences = (a,b) => { const old = new Map(a.map((item)=>[item.path,item.sha256])); return b.filter((item)=>old.get(item.path)!==item.sha256).map((item)=>item.path); };
function phase(directory, testName) {
  const before=load(directory+'/before.state.json'), after=load(directory+'/after.state.json');
  const mb=load(directory+'/before.modules.json'), ma=load(directory+'/after.modules.json');
  const tests=load(directory+'/'+testName+'.json');
  const nulls=after.trackedFiles.filter((item)=>item.sha256===null);
  return { directory,head:after.head,tree:after.tree,identityUnchanged:before.head===after.head&&before.tree===after.tree,descriptorCount:after.trackedFiles.length,physicalHashCount:after.trackedFiles.length-nulls.length,nullDescriptorCount:nulls.length,nullLabelsOutsideQa:nulls.filter((item)=>!item.path.startsWith('docs/qa/')&&!item.path.startsWith('"docs/qa/')).map((item)=>item.path),quotedNullLabels:nulls.filter((item)=>item.path.startsWith('"')).map((item)=>item.path),descriptorChanges:differences(before.trackedFiles,after.trackedFiles),rawIndexEqual:before.indexSha256===after.indexSha256,indexSha256:after.indexSha256,orderedStagesEqual:same(before.orderedStagedEntries,after.orderedStagedEntries),commonIndexAbsent:!before.commonIndexExists&&!after.commonIndexExists,status:after.status,modulesEqual:same(mb.selected,ma.selected),nodeEqual:same(mb.node,ma.node),boundaryFileChanges:differences(mb.files,ma.files),tests:{total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests,skipped:tests.numPendingTests,files:tests.testResults.length,cases:tests.testResults[0].assertionResults.map((item)=>({name:item.fullName,status:item.status}))} };
}
const old=phase('old','06-old-seven'), corrected=phase('corrected','04-corrected-seven');
const oldAfter=load('old/after.state.json'), newBefore=load('corrected/before.state.json'), newAfter=load('corrected/after.state.json');
const om=load('old/after.modules.json'), nm=load('corrected/before.modules.json');
const git = (args) => { const result=cp.spawnSync('git',['--no-optional-locks',...args],{cwd:root,maxBuffer:16*1024*1024}); if(result.status!==0)throw new Error(result.stderr.toString());return result.stdout; };
const rawPaths=git(['ls-files','-z']);
fs.writeFileSync(path.join(__dirname,'CURRENT-GIT-PATHS.z'),rawPaths);
const paths=rawPaths.toString('utf8').split('\0').filter(Boolean);
const nonQa=paths.filter((item)=>!item.startsWith('docs/qa/'));
const beforeMap=new Map(newBefore.trackedFiles.map((item)=>[item.path,item.sha256]));
const afterMap=new Map(newAfter.trackedFiles.map((item)=>[item.path,item.sha256]));
const missing=[],hashDrift=[];
for(const relative of nonQa){const file=path.join(root,relative);if(!fs.existsSync(file)){missing.push(relative);continue;}const hash=sha(file);if(hash!==beforeMap.get(relative)||hash!==afterMap.get(relative))hashDrift.push(relative);}
const result={utc:new Date().toISOString(),disposition:'B1 bounded correction independently verified; old failures preserved',old,corrected,crossPhase:{rootRebind:load('ROOT-REBIND.json'),sourcePathsChangedByRoot:differences(oldAfter.trackedFiles,newBefore.trackedFiles),sameSelectedModules:same(om.selected,nm.selected),sameNode:same(om.node,nm.node),fixtureOldSha256:sha(path.join(__dirname,'old/06-executed-fixture.tsx')),fixtureCorrectedSha256:sha(path.join(__dirname,'corrected/04-executed-fixture.tsx')),fixtureIdentical:sha(path.join(__dirname,'old/06-executed-fixture.tsx'))===sha(path.join(__dirname,'corrected/04-executed-fixture.tsx')),caseNamesIdentical:same(old.tests.cases.map((item)=>item.name),corrected.tests.cases.map((item)=>item.name)),oldManifestSha256:sha(path.join(__dirname,'old/MANIFEST.json')),oldManifestPreserved:sha(path.join(__dirname,'old/MANIFEST.json'))==='a6aec3d1c3091e1424fb0321bb65979ef8982ab354a54e72b92d9ac3c3bd99ee'},coverageQualification:{trackedNativePaths:paths.length,decodedNonQaPaths:nonQa.length,decodedQaPaths:paths.length-nonQa.length,missingNonQaPaths:missing,currentNonQaHashDrift:hashDrift,docsQaDirectoryAbsent:!fs.existsSync(path.join(root,'docs/qa')),currentSparseRules:git(['sparse-checkout','list']).toString('utf8').trim().split(/\r?\n/),statement:'41,003 is descriptor count, not physical SHA coverage. Historical docs/qa archive bytes are omitted; physical non-QA files are verified. Old sealed wording is qualified here without rewriting it.'},limits:{networkPacketCapture:false,realListener:false,browser:false,full46Rerun:false,syntheticExactSameRevisionForgeryDefense:false,selectedDependencyIdentityOnly:true}};
fs.writeFileSync(path.join(__dirname,'COMPARISON.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({old:old.tests,corrected:corrected.tests,crossPhase:result.crossPhase,coverageQualification:result.coverageQualification},null,2));
