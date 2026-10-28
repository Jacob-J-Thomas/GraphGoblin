// Exact archived source, isolated ES2022 compilation, installed dependencies read-only via loader.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import * as L from './qa.mjs';
const require=createRequire(path.join(L.ROOT,'apps/api/package.json'));
const ts=require('typescript');
const commit='a4fee9a9';
const main=L.state.main;
const archive=path.join(main,'source.tar');
execFileSync('git',['archive',commit,'--output',archive],{cwd:L.ROOT,windowsHide:true});
execFileSync('tar',['-xf',archive,'-C',main],{windowsHide:true});
if(fs.readFileSync(path.join(main,'pnpm-lock.yaml'),'utf8')!==fs.readFileSync(path.join(L.ROOT,'pnpm-lock.yaml'),'utf8')) throw new Error('Missing matching dependencies; stop');
let count=0;
for(const project of [...fs.readdirSync(path.join(main,'packages')).map(n=>'packages/'+n),'apps/api']) {
 const src=path.join(main,project,'src');if(!fs.existsSync(src))continue;
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
  const f=path.join(dir,e.name);if(e.isDirectory()){walk(f);continue;}if(/\.test\.|\.d\.ts$/.test(f))continue;
  const dest=path.join(main,project,'dist',path.relative(src,f)).replace(/\.ts$/,'.js');fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(f.endsWith('.ts')) {const r=ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,verbatimModuleSyntax:true,esModuleInterop:true,isolatedModules:true}});if(r.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw new Error('compile '+f);fs.writeFileSync(dest,r.outputText);count++;}else fs.copyFileSync(f,dest);
 }};walk(src);
}
execFileSync(L.NODE,['--experimental-loader',pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href,path.join(main,'apps/api/dist/templates/copy-catalog.js')],{cwd:main,windowsHide:true,stdio:'pipe'});
fs.writeFileSync(path.join(L.OUT,'baseline-build.log.txt'),L.redact(JSON.stringify({commit,typescript:ts.version,compiledFiles:count,lockfileIdentical:true,method:'Archived source transpilation as in PR426 QA; original exports/migrations/assets, dependency resolution by loader without links',main},null,2))+'\n');
console.log('Baseline compiled '+count+' files at '+commit);
