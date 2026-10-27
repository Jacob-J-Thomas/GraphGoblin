import assert from 'node:assert/strict';import {readdir,readFile,stat} from 'node:fs/promises';import {join} from 'node:path';
import {HERE} from './lib.mjs';
const json=async name=>JSON.parse((await readFile(join(HERE,name+'.json'),'utf8')).replace(/^\uFEFF/,''));
for(const name of ['races','pending-controlled','history','bounds','bounds-recheck','migration'])assert.equal((await json(name)).ok,true,name);
assert.ok((await json('live-state')).scenarios.every(x=>x.ok));
assert.ok((await json('review-live-state')).states.every(x=>x.browserThreadEqualsApi));
const accessibility=await json('a11y-strict');assert.equal(accessibility.checks.filter(x=>!x.ok).length,1);
assert.equal(accessibility.checks.find(x=>!x.ok).name,'keyboard selection retains row focus and announces pause');
assert.equal((await json('a11y-pause')).ok,true);
assert.equal((await json('timeline-layout')).confirmed,true);
assert.ok((await json('process-exit-check')).every(x=>!x.Running));
const cost=(await json('observation-cost')).samples;assert.equal(cost.length,3);assert.ok(cost.at(-1).decisions>=100_000);
assert.ok(Math.max(...cost.map(x=>x.medianObservationMs))/Math.min(...cost.map(x=>x.medianObservationMs))<2);
const throughput=await json('throughput');assert.ok(!throughput.error);
for(const phase of throughput.phases){assert.equal(phase.inspectorRequests['thread?at']??0,0);for(const n of Object.values(phase.inspectorRequestsPerMinute))assert.ok(n<=121);}
const files=await readdir(HERE);let textFiles=0,links=0;
for(const name of files){
  assert.ok((await stat(join(HERE,name))).size<=1_000_000,name+' size');
  if(!/\.(md|json|mjs|ps1|txt)$/.test(name))continue;
  const content=await readFile(join(HERE,name),'utf8');textFiles++;
  for(const value of [process.env.USERPROFILE,process.env.USERPROFILE.replaceAll('\\','\\\\'),process.env.USERPROFILE.replaceAll('\\','/'),process.env.COMPUTERNAME])if(value)assert.ok(!content.includes(value),name+' redaction');
  assert.ok(!/S-1-\d+(?:-\d+)+/.test(content),name+' SID');
  if(name.endsWith('.json'))JSON.parse(content.replace(/^\uFEFF/,''));
  if(name.endsWith('.md'))for(const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
    const target=match[1].split('#')[0];if(!target||/^[a-z]+:/i.test(target))continue;
    assert.ok(files.includes(target),name+' missing link '+target);links++;
  }
}
console.log(JSON.stringify({sixBehaviorChecks:'PASS',confirmedDefects:['O6 low pre-existing five-digit Timeline overlap'],ownedApiPids:(await json('process-exit-check')).length,ownedApiPidsStillRunning:0,textFiles,localMarkdownLinks:links,maxBytes:Math.max(...await Promise.all(files.map(async f=>(await stat(join(HERE,f))).size))),knownProbeCorrections:['pending-read inconclusive moving locator','a11y-strict pause timestamp after focus']},null,2));
