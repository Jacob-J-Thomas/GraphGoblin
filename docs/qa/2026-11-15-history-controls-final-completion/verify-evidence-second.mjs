import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const audit = dirname(fileURLToPath(import.meta.url));
const repo = 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin';
const native = join(repo, 'docs/qa/2026-11-15-history-controls-final-native');
const ci = resolve(audit, '../current-ci-5a316');
const head = '5a31678f5a8611ae3a89a1f6aefe797d7106a08e';
const main = '1cfca9bce3967c9d41950266c83aab636667e0ab';
const buildHead = '6b0eae62ea98ae73b22903c9922bba198e219608';
const anchor = 'c2cffebb7ca1bbea41ae72a37b9f232c90681906';
const tested = 'b08bf0ea5f304bd1bfb83b58dd2588607fb943a8';
const currentMerge = '6ae1eff7c27ca49e941b8bb5c4e18f32d34ef7d6';
const oldBase = '48dddb1af1239bbdddc7d7c9c8b0e47c0431c6c6';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 25_000_000 });
const lines = bytes => bytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
const results = { at: new Date().toISOString(), runtime: process.version, head, main };
assert.equal(process.version, 'v22.23.4');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), head);
assert.equal(git('status', '--porcelain=v1').length, 0);
results.identity = [head, main, tested, currentMerge, oldBase].map(ref => git('show', '-s', '--format=%H %T %P', ref).toString().trim());
git('diff', '--quiet', tested, currentMerge);
git('diff', '--quiet', tested, head);
git('diff', '--quiet', oldBase, main);
git('merge-base', '--is-ancestor', main, head);
const productPaths = lines(git('diff', '--name-only', main, head, '--', 'apps', 'packages', 'tooling', '.github', 'package.json', 'pnpm-lock.yaml', 'turbo.json'));
assert.equal(productPaths.length, 13);
git('diff', '--quiet', anchor, head, '--', ...productPaths);
const publication = lines(git('diff', '--name-only', buildHead, head));
assert(publication.every(p => p.startsWith('docs/qa/') || p === 'CHANGELOG.md' || p === 'docs/delivery/2026-11-13-four-intents-register.md'));
const changed = lines(git('diff', '--name-only', '--diff-filter=ACMRT', main, head));
const tree = new Map(git('ls-tree', '-r', '-z', head).toString().split('\0').filter(Boolean).map(row => {
  const [, mode, oid, path] = /^(\d+) blob ([a-f0-9]+)\t(.+)$/s.exec(row);
  return [path, { mode, oid }];
}));
const workingHashes = lines(execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, input: changed.map(p => JSON.stringify(p)).join('\n')+'\n', maxBuffer: 1_000_000 }));
assert.equal(workingHashes.length, changed.length);
changed.forEach((p,i) => assert.equal(workingHashes[i], tree.get(p).oid, p));
const nonQa = git('diff', main, head, '--', '.', ':!docs/qa');
results.patch = { changed: changed.length, workingBlobsMatched: workingHashes.length, productPaths, unchangedFromInitialReview: true, publicationPaths: publication.length, publicationProductDelta: false, nonQaPaths: lines(git('diff', '--name-only', main, head, '--', '.', ':!docs/qa')), nonQaDiffSha256: hash(nonQa) };

const curation = await read(join(native,'curation-manifest.json'));
let curatedBytes = 0;
for (const row of curation.files) {
  const bytes = await readFile(join(native,row.packetPath));
  assert.equal(bytes.length,row.bytes,row.packetPath);
  assert.equal(hash(bytes),row.sha256,row.packetPath);
  curatedBytes += bytes.length;
}
const beforeBinding = await readFile(join(native,'binding/binding-before.json'));
assert.deepEqual(await readFile(join(native,'binding/binding-after.json')),beforeBinding);
const readOnlyBytes = await readFile(join(native,'binding/read-only-after.json'));
assert.deepEqual(await readFile(join(native,'binding/read-only-before.json')),readOnlyBytes);
const bound = JSON.parse(readOnlyBytes);
const publicationMetadata = [];
for (const [p,row] of Object.entries(bound.sources)) {
  if (publication.includes(p)) {
    assert(['CHANGELOG.md','docs/delivery/2026-11-13-four-intents-register.md'].includes(p),p);
    assert.equal(git('rev-parse',`${buildHead}:${p}`).toString().trim(),row.gitBlob,p);
    publicationMetadata.push(p);
    continue;
  }
  assert.equal(hash(await readFile(join(repo,p))),row.sha256,p);
  assert.equal(tree.get(p).oid,row.gitBlob,p);
}
for (const [p,sha] of Object.entries(bound.artifacts)) assert.equal(hash(await readFile(join(repo,p))),sha,p);
const embedded = {};
for (const mapPath of Object.keys(bound.artifacts).filter(p => p.startsWith('apps/web/dist/') && p.endsWith('.js.map'))) {
  const map = await read(join(repo,mapPath));
  map.sources.forEach((original,i) => {
    const candidate = Object.keys(bound.sourceMap).find(p => original.replaceAll('\\','/').endsWith('/'+(p.startsWith('apps/web/src/')?p.slice('apps/web/src/'.length):p)));
    if (candidate) { embedded[candidate] = hash(map.sourcesContent[i]); assert.equal(embedded[candidate],bound.sourceMap[candidate],candidate); }
  });
}
assert.deepEqual(embedded,bound.sourceMap);
const domainBytes = await readFile(join(native,'binding/domain-map-after.json'));
assert.deepEqual(await readFile(join(native,'binding/domain-map-before.json')),domainBytes);
const domain = JSON.parse(domainBytes);
for (const key of ['source','compiled','compiledSourceMap']) assert.equal(hash(await readFile(join(repo,domain[key].path))),domain[key].sha256,key);
const browserMap = await read(join(repo,domain.browserEmbedded.path));
assert.equal(hash(browserMap.sourcesContent[browserMap.sources.indexOf(domain.browserEmbedded.sourceName)]),domain.compiled.sha256);
assert.equal(domain.compiledSourceMap.sourceContentEmbedded,false);
const buildReceipt = await read(join(native,'forced-build-exit.json'));
assert.equal(buildReceipt.exitCode,0);
const buildLog = await readFile(join(native,'forced-build.log'));
assert.equal(hash(buildLog),buildReceipt.logSha256);
assert.match(buildLog.toString(),/12 successful, 12 total/);
assert.match(buildLog.toString(),/0 cached, 12 total/);
results.binding = { curatedFiles: curation.files.length, curatedBytes, handoffSha256: hash(await readFile(join(native,'final-native-handoff.md.txt'))), workerManifestSha256:hash(await readFile(join(native,'final-native-handoff-manifest.json'))), beforeAfterBindingSha256:hash(beforeBinding), readOnlyBindingSha256:hash(readOnlyBytes), sourceFiles:Object.keys(bound.sources).length, publicationMetadataVerifiedAgainstBuildCommit:publicationMetadata, builtFiles:Object.keys(bound.artifacts).length, trees:Object.keys(bound.trees).length, embeddedModules:Object.keys(embedded).length, domainReceiptSha256:hash(domainBytes), emittedJsVerified:true, embeddedTypeScriptClaimed:false };

const { LoopDefinitionSchema } = await import(pathToFileURL(join(repo,'packages/contracts/dist/index.js')).href);
const graph = r => r?.draft?.definition ?? r?.current?.definition;
const pressedPhases = new Set(['top-undo','top-redo','held-put-transition','held-validation-transition','disabled-top-row','held-offline-transition']);
const rows=[];
for (const dir of await readdir(join(native,'runs'))) {
  const here = join(native,'runs',dir), run = await read(join(here,'run.json'));
  const action = await read(join(here,'raw/actions.json'));
  assert.equal(run.head,buildHead);
  assert.equal(run.driverExit,0); assert.equal(run.failure,null);
  assert(!run.harnessError && !run.noStructuredResult);
  assert.equal(run.browserClose,0); assert.equal(run.gatewayExit.code,0); assert(run.store.removed);
  assert.equal(action.out.failure,null); assert.equal(action.out.pageErrors.length,0);
  const row={ group:run.scenario, phases:action.phases.length, samples:0, windows:0, layoutSamples:0, acceptedPuts:0, exactSaveChecks:0, native404s:0, trustedHolds:[], maxMovement:0, fixedMisses:0, excluded:0, maximumVisibleBanners:0, putFlashFrames:0, samplerControl:false };
  for (const req of action.requests) {
    if(req.method==='PUT' && req.path.endsWith('/draft') && req.status===200) row.acceptedPuts++;
    if(req.method==='GET' && req.status===404) row.native404s++;
  }
  let previous;
  for(const cp of action.out.checkpoints) {
    if(cp.label==='post-publish current-only readback') {
      assert(cp.settled.current && !Object.hasOwn(cp.settled,'draft'));
      assert.deepEqual(cp.settled.current.definition,graph(cp.before));
      assert.equal(cp.settled.draftToken,cp.before.draftToken);
    }
    if(cp.request?.body?.definition) {
      assert.equal(cp.request.ifMatch,'"'+previous.draftToken+'"');
      assert.deepEqual(cp.device.definition,cp.request.body.definition);
      assert.deepEqual(LoopDefinitionSchema.parse(cp.request.body.definition),graph(cp.server));
      assert.equal(cp.device.baseToken,cp.server.draftToken); assert.equal(cp.device.synced,true);
      row.exactSaveChecks++;
    }
    previous = cp.server ?? cp.settled ?? cp.baseline ?? previous;
  }
  assert.equal(row.exactSaveChecks,row.acceptedPuts);
  for (const phase of action.phases) {
    const data = await read(join(here,'raw',phase.rawFile));
    assert.equal(data.overflow,false); assert.equal(data.trace.length,phase.samples);
    row.samples += data.trace.length;
    for (const frame of data.trace) {
      const count=frame.banners.filter(b=>b.visible&&!b.hidden).length;
      row.maximumVisibleBanners=Math.max(row.maximumVisibleBanners,count); assert(count<=1);
      if(run.scenario==='put-flash' && frame.banners.length) { row.putFlashFrames++; assert(frame.banners.every(b=>b.where==='editor')); }
    }
    const qualified = action.out.geometry.find(g=>g.label===phase.label);
    if(qualified) {
      row.windows++;
      const comparable = data.trace.filter(f=>f.boxes.every(Boolean)&&f.coords&&!f.modal);
      assert(comparable.length>0);
      const origin=comparable[0], max=[0,0,0,0]; let misses=0, raf=0;
      for(const frame of comparable) {
        assert.deepEqual(frame.viewport,origin.viewport); assert.deepEqual(frame.scroll.slice(0,2),origin.scroll.slice(0,2));
        frame.boxes.forEach((box,i)=>box.forEach((v,j)=>{max[j]=Math.max(max[j],Math.abs(v-origin.boxes[i][j]));}));
        if(frame.hits?.join(',')!=='undo,redo')misses++;
        if(frame.type==='raf')raf++;
      }
      assert.deepEqual(max,qualified.max); assert.equal(misses,qualified.misses);
      assert.equal(comparable.length,qualified.comparable); assert.equal(raf,qualified.layoutSamples); assert(raf>0);
      assert.equal(qualified.excluded,0); assert.equal(misses,0); assert(max.every(v=>v===0));
      row.layoutSamples+=raf; row.maxMovement=Math.max(row.maxMovement,...max); row.fixedMisses+=misses;
    }
    if(pressedPhases.has(phase.label)) {
      const down=data.trace.find(f=>f.type==='mousedown'&&['undo','redo'].includes(f.input?.target));
      const up=data.trace.find(f=>f.type==='mouseup'&&down&&f.t>=down.t);
      const click=data.trace.find(f=>f.type==='click'&&up&&f.t>=up.t);
      assert(down&&up&&click);
      for(const f of [up,click]) { assert.equal(f.input.target,down.input.target); assert.equal(f.input.x,down.input.x); assert.equal(f.input.y,down.input.y); }
      assert([down,up,click].every(f=>f.input.trusted)); assert(up.t-down.t>=245);
      row.trustedHolds.push(up.t-down.t);
    }
    if(phase.label==='sampler-control') {
      const frames=data.trace.filter(f=>f.boxes.every(Boolean));
      assert.equal(Math.max(...frames.map(f=>f.boxes[0][1]))-Math.min(...frames.map(f=>f.boxes[0][1])),1);
      assert.equal(new Set(frames.map(f=>JSON.stringify(f.boxes[1]))).size,1);
      row.samplerControl=true;
    }
  }
  if(run.scenario.startsWith('ownership')) assert.equal(row.native404s,2);
  rows.push(row);
}
const cleanup = await read(join(native,'cleanup-final.json'));
for (const key of ['resourceFailures','ownedLive','listeners','leftoverStoresOrSqlite','unqualifiedPidMatches']) assert.deepEqual(cleanup[key],[]);
const sum=key=>rows.reduce((n,row)=>n+row[key],0);
results.native={ groups:rows.length, phases:sum('phases'), samples:sum('samples'), windows:sum('windows'), layoutSamples:sum('layoutSamples'), acceptedPuts:sum('acceptedPuts'), exactSaveChecks:sum('exactSaveChecks'), native404s:sum('native404s'), holds:rows.flatMap(r=>r.trustedHolds).length, cleanupReceiptClear:true, rows };

results.ci=[];
for(const file of (await readdir(ci)).filter(p=>/^job-.*\.log$/.test(p)).sort()) {
  const bytes=await readFile(join(ci,file));
  const contents=bytes.toString().replace(/\u001b\[[0-9;]*m/g,'');
  const cleanLines=contents.split(/\r?\n/).map(l=>l.replace(/^\d{4}-\S+\s+/,''));
  assert(contents.includes('HEAD is now at b08bf0ea Merge '+head+' into '+oldBase),file);
  assert(!contents.includes('##[error]'),file);
  results.ci.push({file,bytes:bytes.length,sha256:hash(bytes),lines:cleanLines.length,checkout:tested,
    commands:cleanLines.filter(l=>l.startsWith('##[group]Run ')),
    outcomes:cleanLines.filter(l=>/^\s*(Test Files|Tests\s+\d|Tasks:|Cached:|\d+ passed|\d+ skipped|# (tests|pass|fail)|\d+ vulnerabilities|Severity:)/.test(l)),
    routing:cleanLines.filter(l=>l.startsWith('Routing performance: ')).map(l=>{const d=JSON.parse(l.slice('Routing performance: '.length));return {nodes:d.nodes,medianRoutingP95Ms:d.medianRoutingP95Ms,drags:d.repetitions.map(x=>({routing:x.routingP95Ms,frame:x.frameP95Ms})),targets:d.targets};}) });
}
assert.equal(results.ci.length,5);
results.runAttempts=[];
for(const id of [43682228998,43682229004]) {
  const run=await read(join(ci,`run-${id}.json`));
  results.runAttempts.push({id,event:run.event,attempt:run.run_attempt,head:run.head_sha,status:run.status,conclusion:run.conclusion});
}
const coverage=[];
async function walk(directory) {
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const p=join(directory,item.name);
    if(item.isDirectory())await walk(p);
    else if(item.name==='coverage-summary.json') {const data=await read(p);coverage.push({file:p.slice(ci.length+1).replaceAll('\\','/'),total:data.total});}
  }
}
await walk(join(ci,'coverage-artifact'));
for(const row of coverage) for(const metric of ['lines','branches','functions','statements']) assert(row.total[metric].pct>=90,`${row.file} ${metric}`);
results.coverage=coverage;
results.checkStatus='PASS';
await writeFile(join(audit,'evidence-verification.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checkStatus:results.checkStatus,patch:results.patch,binding:results.binding,native:{...results.native,rows:undefined},ciFiles:results.ci.length,coverageReports:coverage.length,runAttempts:results.runAttempts},null,2));
