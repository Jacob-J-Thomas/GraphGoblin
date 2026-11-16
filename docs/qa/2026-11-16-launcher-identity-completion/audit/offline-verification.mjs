import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const checkout='C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const out=batch+'/review-435-astra-final';
const head='6f383da798872aa0e6bd1e0de1fdcd4e702de9ae';
const target='9fa8b2474c7290adb800c5e26be73511095cae25';
const source='c75e277695dae260f0e14279cff8705bab84ef4c';
const old='08e60a0ae6d6b7cae853326825365760166f3ad3';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>fs.readFileSync(p);
const txt=p=>read(p).toString('utf8').replace(/^\uFEFF/,'');
const json=p=>JSON.parse(txt(p));
const git=(...args)=>execFileSync('git.exe',['-C',checkout,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true,maxBuffer:128*1024*1024});
const list=(...args)=>git(...args).toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const report={recordedUtc:new Date().toISOString(),node:process.version,kind:'offline artifact and read-only Git verification; no product execution'};
assert.equal(process.version,'v22.23.4');
assert.equal(git('rev-parse','HEAD').toString().trim(),head);
assert.equal(git('status','--porcelain=v1').toString(),'');
const files=list('diff','--name-only',target,head);
const pub=list('diff','--name-only',source,head);
assert.equal(files.length,385);
assert.equal(pub.length,379);
assert.ok(pub.every(p=>p.startsWith('docs/qa/')||p.startsWith('docs/delivery/')));
const core=files.filter(p=>!p.startsWith('docs/qa/')&&!p.startsWith('docs/delivery/'));
assert.equal(core.length,6);
const coreInventory=core.map(p=>({path:p,headSha256:hash(git('cat-file','blob',head+':'+p)),sourceSha256:hash(git('cat-file','blob',source+':'+p)),bytes:git('cat-file','blob',head+':'+p).length}));
assert.ok(coreInventory.every(p=>p.headSha256===p.sourceSha256));
const nativePath='tooling/scripts/windows-launcher.acceptance.mjs';
assert.equal(hash(git('cat-file','blob',old+':'+nativePath)),coreInventory.find(p=>p.path===nativePath).headSha256);
assert.equal(coreInventory.find(p=>p.path===nativePath).headSha256,'4cac8f617ebe4d96e8b54c4ba0bfe3c5a4647e284480b97f77fe0e847281c4ee');
assert.deepEqual(list('diff','--name-only',target,old),[nativePath]);
const qaPaths=files.filter(p=>p.startsWith('docs/qa/')&&p!=='docs/qa/.gitattributes');
assert.equal(qaPaths.length,377);
const batchBytes=execFileSync('git.exe',['-C',checkout,'cat-file','--batch'],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true,input:qaPaths.map(p=>head+':'+p).join('\n')+'\n',maxBuffer:128*1024*1024});
let offset=0; const qaInventory=[];
for(const p of qaPaths){
 const end=batchBytes.indexOf(10,offset);assert.ok(end>offset);
 const header=batchBytes.subarray(offset,end).toString('ascii');
 const fields=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);assert.ok(fields,header);
 const size=Number(fields[2]);offset=end+1;
 const data=batchBytes.subarray(offset,offset+size);offset+=size+1;
 assert.deepEqual(read(checkout+'/'+p),data,p+' working bytes differ from publication blob');
 qaInventory.push({path:p,gitBlob:fields[1],bytes:size,sha256:hash(data)});
}
assert.equal(offset,batchBytes.length);
const packetDirs=[...new Set(qaPaths.map(p=>p.split('/').slice(0,3).join('/')))];
const manifests=[];
for(const dir of [...packetDirs.map(p=>checkout+'/'+p),batch+'/launcher/435-hosted-candidate-ci']){
 const manifest=dir+'/SHA256SUMS.txt'; if(!fs.existsSync(manifest))continue;
 const rows=txt(manifest).trim().split(/\r?\n/).filter(Boolean);const details=[];
 for(const row of rows){
  const m=/^([a-fA-F0-9]{64})\s+[*]?(.+)$/.exec(row);assert.ok(m,row);
  const abs=path.resolve(dir,m[2]);assert.ok(abs.startsWith(path.resolve(dir)+path.sep));
  const bytes=read(abs);assert.equal(hash(bytes),m[1].toLowerCase(),abs);
  details.push({path:m[2],sha256:m[1].toLowerCase(),bytes:bytes.length});
 }
 manifests.push({path:manifest,sha256:hash(read(manifest)),count:details.length,verified:true,files:details});
}
const fresh=read(out+'/windows-job-133048320156-fresh.log');
const fixedLog=batch+'/launcher/435-hosted-candidate-ci/windows-job.decoded.log';
assert.deepEqual(fresh,read(fixedLog));
assert.equal(hash(fresh),'58b62eb41d88d9962a6e0cebbd0ac193793b10a52945cd2004054ba6bb6eecb4');
assert.equal(fresh.length,53877);
assert.deepEqual([...fresh.subarray(0,3)],[239,187,191]);
assert.deepEqual([...fresh.subarray(-2)],[13,10]);
const rootWindows=json(batch+'/launcher/435-hosted-candidate-root-job-log-response.json');
assert.deepEqual(fresh,Buffer.from(rootWindows.structuredContent.content,'utf8'));
const oldLog=checkout+'/docs/qa/2026-11-16-launcher-identity-candidate/evidence/hosted-old-source/windows-job.decoded.log';
assert.equal(hash(read(oldLog)),'119b5186afa2d98fc015ea8ac44a5e1cf9107802fe23661501a33781d8ecbe85');
assert.equal(read(oldLog).length,52654);
const reporter=process.binding('natives')['internal/test_runner/reporter/tap'];
const match=reporter.match(/function tapEscape\(input\) \{[\s\S]*?\r?\n\}/);assert.ok(match);
const tapEscape=new Function('StringPrototypeReplaceAll',match[0]+'\nreturn tapEscape;')((s,a,b)=>s.replaceAll(a,b));
const decode=p=>txt(p).split(/\r?\n/).filter(l=>l.includes('# {"evidence":"windows-launcher-checkout-alias"')).map(l=>{
 const emitted=l.slice(l.indexOf('# {')+2);
 const original=emitted.replace(/\\#/g,'#').replace(/\\\\/g,'\\');
 assert.equal(tapEscape(original),emitted,'TAP roundtrip');
 return JSON.parse(original);
});
const fixed=decode(fixedLog),baseline=decode(oldLog);
assert.equal(fixed.length,2);assert.equal(baseline.length,2);
const quiet={code:0,signal:null,stdout:'',stderr:''};
const distinct=new Set();let cold=0,warm=0,refusals=0,drains=0;
for(const rec of fixed){
 assert.deepEqual(rec.reparse,{linkType:rec.requestedLinkType,directory:true,reparsePoint:true});
 assert.ok(['Junction','SymbolicLink'].includes(rec.requestedLinkType));
 assert.equal(rec.storeEntriesBeforeCold,0);assert.equal(rec.aliasUnlinked,true);
 assert.equal(rec.failure,undefined);
 const direct=rec.commands['direct-identity'];assert.match(direct.stdout,/^[a-f0-9]{64}\n$/);
 assert.equal(Buffer.byteLength(direct.stdout),65);assert.equal(direct.code,0);assert.equal(direct.stderr,'');
 assert.deepEqual(rec.commands['alias-identity'],direct);
 assert.deepEqual(rec.commands['alias-store-state'],{...quiet,stdout:'{"state":"free"}\n'});
 assert.deepEqual(rec.commands['alias-import'],quiet);
 assert.deepEqual(rec.cold.map(c=>c.spelling),['alias','direct']);
 assert.equal(Object.keys(rec.commands).length,14);
 for(const c of rec.cold){
  assert.deepEqual(rec.commands[c.spelling+'-cold'],quiet);cold++;
  assert.equal(c.release,'drained-pid-listener-leases');drains++;
  distinct.add(c.owner.pid+':'+c.owner.birth);
  assert.ok(c.owner.pid>0);assert.match(c.owner.birth,/^[1-9][0-9]{16,18}$/);
  assert.ok(c.owner.executable.endsWith('\\node\\22.23.4\\x64\\node.exe'));
  const expected=c.spelling==='alias'?path.win32.join(rec.fixture,'checkout alias-α','apps/api/dist/main.js'):'D:\\a\\GraphGoblin\\GraphGoblin\\apps\\api\\dist\\main.js';
  assert.equal(c.owner.main,expected);
  assert.equal(Object.keys(c.owner.leases).length,2);
  for(const digest of Object.values(c.owner.leases))assert.match(digest,/^[a-f0-9]{64}$/);
  for(const via of ['alias','direct']){assert.deepEqual(rec.commands[c.spelling+'-cold-'+via+'-warm'],quiet);warm++;}
  for(const variant of ['wrong-store-config','wrong-settings-config']){
   assert.deepEqual(rec.commands[c.spelling+'-cold-'+variant],{code:1,signal:null,stdout:'',stderr:'unrelated or differently configured service'});refusals++;
  }
 }
}
assert.equal(distinct.size,4);assert.deepEqual([cold,warm,refusals,drains],[4,8,8,4]);
for(const rec of baseline){
 assert.equal(rec.reparse.linkType,rec.requestedLinkType);
 assert.deepEqual(rec.commands['alias-identity'],quiet);
 assert.deepEqual(rec.commands['alias-store-state'],quiet);
 assert.equal(rec.commands['alias-cold'].code,1);
 assert.ok(rec.commands['alias-cold'].stderr.includes('could not be checked'));
 assert.equal(rec.failure.stage,'assert-cli');
 assert.equal(rec.cold.length,1);assert.equal(rec.cold[0].release,'no-gateway-spawned');
 assert.equal(rec.aliasUnlinked,true);
}
for(const [filename,counts] of [[fixedLog,{tests:17,pass:17,fail:0,skipped:0,cancelled:0}],[oldLog,{tests:17,pass:14,fail:3,skipped:0,cancelled:0}]]){
 const lines=txt(filename).split(/\r?\n/);
 for(const [key,n]of Object.entries(counts))assert.ok(lines.some(l=>l.endsWith('# '+key+' '+n)),filename+' '+key);
}
const pr=json(out+'/github-pr.json').response, run=json(out+'/github-run.json').response,jobs=json(out+'/github-jobs.json').response;
assert.deepEqual([pr.head.sha,pr.base.sha,pr.merge_commit_sha],[head,target,'5e386d5cc9ed4b022d15ade32d04fcd89c367688']);
assert.deepEqual([run.head_sha,run.conclusion,run.run_attempt],[head,'success',1]);
assert.equal(jobs.jobs.length,4);assert.ok(jobs.jobs.every(j=>j.head_sha===head&&j.conclusion==='success'&&j.run_attempt===1));
assert.equal(jobs.jobs.find(j=>j.name==='Gates').steps.length,32);
assert.ok(jobs.jobs.find(j=>j.name==='Gates').steps.every(s=>s.conclusion==='success'));
const artifact=json(out+'/github-artifacts.json').response.artifacts;
assert.equal(artifact.length,1);
assert.equal(artifact[0].id,14192079834);assert.equal(artifact[0].name,'coverage');
const zip=batch+'/launcher/435-current-ci/coverage-artifact-14192079834.zip';
assert.equal(hash(read(zip)),'68506d5c108574bcbdd11856ddea6d02940345f8045496a7b4fcc84c01095a27');
assert.equal(artifact[0].digest,'sha256:'+hash(read(zip)));
const opus=batch+'/review-435-opus-scan1/full-report.md';
assert.equal(hash(read(opus)),'284eb4f6df116ed337b8942d75b2cb34657404cbd03d6bdeccc3c22d024ccacd');
const comment=json(out+'/github-comment.json').response;
const normalize=s=>s.replace(/\r\n/g,'\n').trim();
assert.ok(normalize(comment.body).includes(normalize(txt(opus))));
assert.ok(normalize(comment.body).includes(normalize(txt(batch+'/review-435-opus-scan1/root-disposition.md'))));
for(const n of [493,494,495,496]){
 const issue=json(out+'/github-issue'+n+'.json').response;
 assert.equal(issue.state,'open');assert.ok(issue.labels.some(l=>l.name==='backlog'));
 assert.ok(!issue.labels.some(l=>['aidlc-ready','human-in-the-loop','plan-approved'].includes(l.name)));
}
const bindingPath=batch+'/launcher/435-build-candidate-first/build-binding.json';
const binding=json(bindingPath);
assert.equal(hash(read(bindingPath)),'b247b045d4394c976b7339df1ada61b0399677d847e740b4d2b19c4c4ff114f6');
assert.equal(binding.head,source);assert.equal(binding.actualMain,target);
assert.deepEqual([Object.keys(binding.sourceFiles).length,Object.keys(binding.outputFiles).length,binding.outputRoots.length,Object.keys(binding.dependencyFiles).length,Object.keys(binding.workspaceLinks).length],[28809,1231,13,19,22]);
const candidate=checkout+'/docs/qa/2026-11-16-launcher-identity-candidate/evidence';
const before=json(candidate+'/built-candidate-first/before.json'),after=json(candidate+'/built-candidate-first/after.json');
assert.deepEqual(before,after);
assert.equal(hash(git('cat-file','blob',head+':tooling/scripts/launcher-identity.test.mjs')),before.testSha256);
assert.equal(hash(read(checkout+'/apps/api/dist/instance-identity.js')),before.compiledHelperSha256);
assert.equal(hash(read(candidate+'/built-candidate-first/built-regression.log')),json(candidate+'/built-candidate-first/execution.json').logSha256);
assert.equal(hash(read(checkout+'/docs/qa/2026-11-16-launcher-identity-implementation/evidence/built-regression-before.mjs.txt')),before.testSha256);
report.diff={effectivePaths:files.length,documentaryPublicationPaths:pub.length,core,qaFilesComparedToGit:qaInventory.length};
report.manifests=manifests.map(({files,...rest})=>rest);
report.hosted={freshLogBytes:fresh.length,freshLogSha256:hash(fresh),freshEqualsRetained:true,baselineBytes:read(oldLog).length,baselineSha256:hash(read(oldLog)),linkTypes:fixed.map(r=>r.reparse.linkType),cold,warm,refusals,drains,distinctOwners:[...distinct],tapReporterSha256:hash(reporter)};
report.ci={run:run.id,attempt:run.run_attempt,allFourSuccess:true,all32GatesStepsSuccess:true,artifact:artifact.map(a=>({id:a.id,name:a.name,size:a.size_in_bytes,digest:a.digest})),coverageZipSha256:hash(read(zip))};
report.review={opusSha256:hash(read(opus)),publishedComment:comment.id,completeReportAndDispositionPresent:true,parked:[493,494,495,496]};
report.build={path:bindingPath,bytes:read(bindingPath).length,sha256:hash(read(bindingPath)),head:binding.head,sourceCount:28809,outputCount:1231,roots:13,dependencies:19,links:22,indexIsHistorical:binding.indexSha256,localCompiledHelperStillMatches:true,redAndGreenTestBytesEqual:true};
report.result='PASS';
fs.writeFileSync(out+'/offline-verification.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(out+'/source-and-evidence-inventory.json',JSON.stringify({recordedUtc:report.recordedUtc,core:coreInventory,qa:qaInventory,manifests},null,2)+'\n');
fs.writeFileSync(out+'/decoded-native-records.json',JSON.stringify({freshCandidate:fixed,retainedBaseline:baseline},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
