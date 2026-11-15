import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const batch=dirname(root);
const parentPacket=join(batch,'history-208-escalation','final-parent-v2b');
const [cli,edge]=process.argv.slice(2);
assert(cli&&edge,'Pass the retained cached CLI and Edge binary paths');
assert.equal(process.version,'v22.23.4');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const text=path=>readFile(path,'utf8');
const json=async path=>JSON.parse(await text(path));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:128*1024*1024});
const source=await json(join(root,'offline-source-binding.json'));
const admission=await json(join(root,'admission-prepared.json'));
const parent=await json(join(parentPacket,'admission-native.json'));
const parentBinding=await json(join(parentPacket,'binding','binding-before.json'));
assert.equal(parent.head,admission.historyParent);
const plan=await readFile(join(batch,'layout-208-independent-preparation','space-cards.md'));
assert.equal(sha(plan),'8cbede75c778ab436f308f339aa11124e919f165b1d976acec5c026d32bead9b');
await access(edge);await access(cli);
const cliManifest=await json(join(dirname(cli),'package.json'));
assert.equal(cliManifest.name,'@playwright/cli');
assert.equal(cliManifest.bin['playwright-cli'],'playwright-cli.js');
const configs={};
for(const filename of await readdir(join(root,'drivers/configs'))){
  const config=await json(join(root,'drivers/configs',filename));
  const {browser}=config;
  assert.equal(browser.browserName,'chromium');
  assert.equal(browser.isolated,true);
  assert.deepEqual(browser.launchOptions,{channel:'msedge',headless:true});
  assert.equal(browser.contextOptions.serviceWorkers,'block');
  configs[filename]=browser.contextOptions;
}
assert.deepEqual(Object.keys(configs).sort(),['d1-fine-light','d2-coarse-dark','n768-fine-light','r512-reflow200'].map(name=>name+'.edge.json'));

const executor={cwd:root,windowsHide:true,stdio:'pipe',maxBuffer:128*1024*1024};
const files={};
async function scan(relative){
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
    const path=relative+'/'+entry.name;
    if(entry.isDirectory())await scan(path);
    else{
      assert(entry.isFile()&&!entry.isSymbolicLink(),path);
      files[path]=sha(await readFile(join(root,path)));
    }
  }
}
await scan('drivers');
for(const name of ['build-frozen.ps1','verify-binding.mjs','verify-domain-map.mjs','offline-preflight.mjs','plan.md']){
  files[name]=sha(await readFile(join(root,name)));
}
for(const path of Object.keys(files).filter(path=>/\.(?:mjs|js)$/.test(path))){
  execFileSync(process.execPath,['--check',join(root,path)],executor);
}
const powershell=[
  "$ErrorActionPreference='Stop'",
  "foreach ($name in 'build-frozen.ps1','drivers/verify-cleanup.ps1') {",
  "$tokens=$null; $failures=$null",
  "[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $name).Path,[ref]$tokens,[ref]$failures) | Out-Null",
  'if ($failures.Count) { throw "$name parser: $failures" }',
  "}",
].join('\n');
execFileSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',powershell],executor);

// Retained native requests and readbacks, replayed using only the prior pure contracts.
const packageFiles=Object.keys(source.sourceReadback).filter(path=>path.startsWith('packages/contracts/'));
assert(packageFiles.length>30);
for(const path of packageFiles)assert.equal(source.sourceReadback[path],parentBinding.sourceReadback[path],path);
assert.deepEqual(git(admission.checkout,'diff','--name-only',parent.head,admission.head,'--','packages/contracts','pnpm-lock.yaml'),Buffer.alloc(0));
const contractsManifest=await text(join(parentPacket,'manifests','packages_contracts_dist.sha256'));
for(const row of contractsManifest.trim().split(/\r?\n/)){
  const [,hash,file]=/^([0-9a-f]{64}) \*(.+)$/.exec(row);
  assert.equal(sha(await readFile(join(parent.checkout,file))),hash,file);
}
const {LoopDefinitionSchema}=await import(pathToFileURL(join(parent.checkout,'packages/contracts/dist/index.js')).href);
const script=await text(join(root,'drivers/space.playwright.js'));
const pure=/\/\/ begin pure fixture contract\s+([\s\S]+?)\s+\/\/ end pure fixture contract/.exec(script)?.[1];
assert(pure);
const {graph,definition,wireToCanonical,exactShape,expectedSpace}=Function(pure+'\nreturn {graph,definition,wireToCanonical,exactShape,expectedSpace};')();
const actionsPath=join(parentPacket,'runs','h-d1-initial','raw','actions.json');
const retained=await json(actionsPath);
const captures=retained.out.checkpoints.filter(row=>row.request?.body?.definition&&row.device&&row.server?.draft);
assert(captures.length>=8);
for(const row of captures){
  const wire=row.request.body.definition;
  const canonical=LoopDefinitionSchema.parse(wire);
  assert.deepEqual(wireToCanonical(wire),canonical,row.label);
  assert.deepEqual(definition(row.server),canonical,row.label);
  assert.deepEqual(row.request.responseBody.draft.definition,canonical,row.label);
  assert.equal(row.request.responseBody.draftToken,row.server.draftToken);
  assert.equal(row.device.baseToken,row.server.draftToken);
  assert.deepEqual(exactShape(row.device.definition),exactShape(wire),row.label);
}
const published=retained.out.checkpoints.find(row=>row.label==='post-publish current-only readback');
const candidates=[...Object.values(published??{}),published];
const current=candidates.find(record=>record?.current?.definition && record.draftToken);
assert(current,'Actual retained current-only record missing: '+Object.keys(published??{}));
assert(!Object.hasOwn(current,'draft'));
assert.deepEqual(definition(current),current.current.definition);
assert.throws(()=>definition({draft:{definition:{}},draftToken:null}));
const omitted=graph('Offline probe'), zero=graph('Offline probe',{coordinates:'zero'});
const ordinary=LoopDefinitionSchema.parse(omitted);
assert.deepEqual(ordinary,LoopDefinitionSchema.parse(zero));
assert(ordinary.nodes.every(node=>Object.hasOwn(node,'ui')&&node.ui.x===0&&node.ui.y===0));
const invalid=graph('Offline probe',{invalid:true});
const admitted=LoopDefinitionSchema.parse(invalid);
assert.deepEqual(admitted.edges,invalid.edges);
assert.deepEqual(LoopDefinitionSchema.parse(graph('Offline route',{routed:true})).edges[0].ui,{route:[230,124,300]});
assert.equal(LoopDefinitionSchema.parse(graph('Offline single',{single:true})).nodes.length,1);
assert.notDeepEqual(exactShape({}),exactShape({ui:undefined}));
assert.notDeepEqual(exactShape({x:0}),exactShape({x:-0}));
assert.notDeepEqual(exactShape(['first','second']),exactShape(['second','first']));
const standard=expectedSpace(ordinary,{start:110,tall:119});
const larger=expectedSpace(ordinary,{start:166,tall:163});
assert.deepEqual(standard.nodes[0],ordinary.nodes[0]);
assert.deepEqual(standard.edges,ordinary.edges);
assert.deepEqual(standard.nodes.find(node=>node.id==='peer').ui,{x:544,y:184});
assert.deepEqual(larger.nodes.find(node=>node.id==='peer').ui,{x:544,y:207});
assert.deepEqual(LoopDefinitionSchema.parse(standard),standard);
for(const path of ['forced-build.log','forced-build-exit.json','isolated-turbo-cache','runs']){
  await assert.rejects(access(join(root,path)),{code:'ENOENT'});
}
assert.deepEqual(await json(join(root,'fixture-corrections.json')),[]);
const manifestBytes=JSON.stringify({version:'space-208-combined-v1',files},null,2)+'\n';
const driverManifestSha256=sha(manifestBytes);
await writeFile(join(root,'driver-manifest.json'),manifestBytes,{flag:'wx'});
admission.driverManifestSha256=driverManifestSha256;
admission.cacheCli=resolve(cli);
admission.cacheCliSha256=sha(await readFile(cli));
await writeFile(join(root,'admission-offline-frozen.json'),JSON.stringify(admission,null,2)+'\n',{flag:'wx'});
const report={status:'offline-ready-awaiting-root-grant',node:process.version,head:admission.head,tree:admission.tree,
  sourceFiles:Object.keys(source.sourceReadback).length,contractSources:packageFiles.length,retainedCaptureSha256:sha(await readFile(actionsPath)),
  replayedWrites:captures.length,currentOnlyOmission:true,planSha256:sha(plan),cli:admission.cacheCli,cliVersion:cliManifest.version,configs,
  driverManifestSha256,fixtureCorrections:0,formalScans:0,buildStarted:false,nativeStarted:false};
await writeFile(join(root,'offline-preflight.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));

