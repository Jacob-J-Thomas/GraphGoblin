import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,readFile,writeFile,access} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const [checkout,cli,which='all',suffix='']=process.argv.slice(2);
assert(isAbsolute(checkout)&&isAbsolute(cli),'Pass exact absolute checkout and Playwright CLI paths');
await access(cli);
assert(/^$|^-fixture-[a-z0-9-]+$/.test(suffix));
assert.equal(process.version,'v22.23.4');
const root=dirname(fileURLToPath(import.meta.url));
const controls=join(root,'prior-controls');
const load=async f=>JSON.parse(await readFile(f,'utf8'));
const binding=await load(join(root,'corrected-binding-before.json'));
const spec=await load(join(root,'final-manifest.json'));
const exact=await load(join(root,'exact-source-admission.json'));
assert(spec.frozen===true&&binding.head===spec.head&&binding.head===exact.head&&binding.base===exact.base);
assert.equal(binding.base,'8fadcb0d44ac2caf80ff6279fe4648ce9398afd9');
assert.equal(binding.builtSource,binding.head);
assert.equal(binding.builtFiles,spec.expectedBuildFiles);
for(const [file,expected] of [
  ['verify-corrected.playwright.js','17d21193ce1d917ee77a1b09fe7a4d0e4cf126fcdc8c20d8a1510aed72e66174'],
  ['prior-controls/verify-save-publish.playwright.js','39b1103119a1f0c0dbf3f32ac311f01109610ea006aef04387298b491e479a9a'],
  ['prior-controls/verify-uncertainty.playwright.js','d9c3d2ccde0d5e2a1f4d2643a9b9ec1449bcf2802a368af39455626e95466509'],
]) {
  const actual=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
  assert.equal(actual,expected,file+' original exact oracle. For a concrete diagnosed fixture correction record the bounded new allowance.');
}
for(const name of ['binding-before.json','source-paths.json']){
  await copyFile(join(root,name==='binding-before.json'?'corrected-binding-before.json':name),join(controls,name));
}
const review=[['f1','divergent'],['f1','held'],['f1','initial'],['f1','healthy'],['f2','default'],
  ['f3','matched'],['f3','mismatch'],['f3','held'],['f4','warm'],['f4','cold']];
const baseline=[['publication',4],['list',3],['committed',1],['not-admitted',1]];
const cases=[
  ...review.map(([family,variant])=>({id:family+'-'+variant,expected:1,cwd:root,script:'run-corrected-native.mjs',
    args:[family,variant],loc:'corrected-'+family+'-'+variant,type:'review'})),
  ...baseline.map(([family,count])=>({id:family,expected:count,cwd:controls,script:'run-native.mjs',
    args:[family],loc:family,type:'control'})),
];
const selected=which==='all'?cases:cases.filter(c=>c.id===which);
assert(selected.length,'Unknown exact fixture name');
const resultPath=join(root,'matrix-'+which+(suffix||'-first')+'.json');
const results=[];
await writeFile(resultPath,JSON.stringify({selected:selected.map(x=>x.id),results},null,2)+'\n',{flag:'wx'});
for(const fixture of selected) {
  console.log('Run exact case',fixture.id);
  const child=spawn(process.execPath,[join(fixture.cwd,fixture.script),checkout,cli,...fixture.args],
    {cwd:fixture.cwd,windowsHide:true,stdio:'inherit',env:{...process.env,GG_QA_RUN_SUFFIX:suffix}});
  const exit=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});
  const folder=join(fixture.cwd,'runs',fixture.loc+suffix);
  const run=await load(join(folder,'run.json'));
  let problem;
  if(exit.code||run.failure||run.finding||run.failures?.length||run.pageErrors?.length||
    run.browserClose!==0||run.gatewayExit?.code!==0)problem=run.failure??run.finding??run.harnessError??'Fixture/cleanup failure';
  let observedCount=0;
  if(!problem){
    const observed=await load(join(folder,'observed.json'));
    if(observed.outcomes?.length)observedCount=observed.outcomes.length;
    else if(['committed','not-admitted'].includes(fixture.id)&&observed.seenBundle?.includes(200)&&
      observed.variant===fixture.id&&observed.checkpoints?.length)observedCount=1;
    if(observedCount!==fixture.expected)problem='Missing strict native outcome or served bundle evidence';
  }
  results.push({id:fixture.id,folder,exit,observedCount,expected:fixture.expected,problem:problem??null});
  await writeFile(resultPath,JSON.stringify({head:binding.head,base:binding.base,selected:selected.map(x=>x.id),results},null,2)+'\n');
  if(problem){
    process.exitCode=2;
    break;
  }
}
