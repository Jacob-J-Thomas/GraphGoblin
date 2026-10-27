// Build immutable main sources without switching branches, installing dependencies, or links.
// TypeScript transpileModule emits ESM; the QA resolver supplies installed external dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { root, here, Evidence } from './qa-lib.mjs';
const ev = new Evidence('00-build-main');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gg-qa-412f-main-'));
const head = execFileSync('git',['rev-parse','0319ae4f'],{cwd:root,encoding:'utf8'}).trim();
execFileSync('git',['archive','--format=tar','--output='+path.join(dir,'source.tar'),head],{cwd:root});
execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);
const ts = createRequire(path.join(root,'packages/contracts/package.json'))('typescript');
let emitted=0;
function walk(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    const a=path.join(src,e.name), b=path.join(dst,e.name);
    if(e.isDirectory()) walk(a,b);
    else if(/\.(test|spec)\.|\.d\.ts$/.test(e.name)) continue;
    else if(e.name.endsWith('.ts')){
      const out=ts.transpileModule(fs.readFileSync(a,'utf8'),{fileName:a,compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true,sourceMap:false}});
      fs.writeFileSync(b.slice(0,-3)+'.js',out.outputText); emitted++;
    }else fs.copyFileSync(a,b);
  }
}
const packages={};
for(const type of ['packages','apps']) for(const name of fs.readdirSync(path.join(dir,type))){
  const p=path.join(dir,type,name), meta=path.join(p,'package.json');
  if(!fs.existsSync(meta)) continue;
  const m=JSON.parse(fs.readFileSync(meta));
  packages[m.name]={dir:p,current:path.join(root,type,name),exports:m.exports};
  if(name!=='web' && fs.existsSync(path.join(p,'src'))) walk(path.join(p,'src'),path.join(p,'dist'));
}
fs.cpSync(path.join(dir,'apps/api/templates'),path.join(dir,'apps/api/dist/catalog'),{recursive:true});
fs.writeFileSync(path.join(here,'main-build.json'),JSON.stringify({dir,head,packages},null,2));
ev.log('main head',head,'TypeScript',ts.version,'emitted modules',emitted,'root',dir);
ev.log('Source is git archive; TypeScript ESM emit, no source changes, no installation, no dependency links. Not a main typecheck/gate claim.');
