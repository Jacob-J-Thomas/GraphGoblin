// Compile the exact archived main source with the already-installed TypeScript compiler.
// No dependency install, links, checkout change, or product-source mutation is involved.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import * as L from './lib.mjs';
const require = createRequire(path.join(L.PR_ROOT,'apps/api/package.json'));
const ts = require('typescript');
const commit = 'b33a6d9f9f55fb4dc2379a257d38d938bfaf4703';
if (fs.existsSync(L.MAIN_ROOT) && !process.argv.includes('--resume-compile')) throw new Error('Refusing to overwrite baseline directory');
fs.mkdirSync(L.MAIN_ROOT,{recursive:true});
const archive = path.join(L.MAIN_ROOT,'source.tar');
if(!process.argv.includes('--resume-compile')) {
  execFileSync('git',['archive',commit,'--output',archive],{cwd:L.PR_ROOT,windowsHide:true});
  execFileSync('tar',['-xf',archive,'-C',L.MAIN_ROOT],{windowsHide:true});
}
const prLock = fs.readFileSync(path.join(L.PR_ROOT,'pnpm-lock.yaml'),'utf8');
const mainLock = fs.readFileSync(path.join(L.MAIN_ROOT,'pnpm-lock.yaml'),'utf8');
if (prLock !== mainLock) throw new Error('Baseline dependencies differ; stop instead of installing');
let count=0;
const projects = [...fs.readdirSync(path.join(L.MAIN_ROOT,'packages')).map(n=>'packages/'+n),'apps/api'];
for (const project of projects) {
  const src=path.join(L.MAIN_ROOT,project,'src');
  if (!fs.existsSync(src)) continue;
  const walk=(dir)=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()) { walk(file); continue; }
      if (/\.test\.|\.d\.ts$/.test(file)) continue;
      const destination=path.join(L.MAIN_ROOT,project,'dist',path.relative(src,file)).replace(/\.ts$/,'.js');
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      if(file.endsWith('.ts')) {
        const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,verbatimModuleSyntax:true,esModuleInterop:true,isolatedModules:true}});
        if(result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error)) throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>L.MAIN_ROOT,getNewLine:()=> '\n'}));
        fs.writeFileSync(destination,result.outputText);
        count++;
      } else fs.copyFileSync(file,destination);
    }
  };
  walk(src);
}
execFileSync(L.NODE,['--experimental-loader',pathToFileURL(path.join(L.OUT,'scripts/baseline-loader.mjs')).href,path.join(L.MAIN_ROOT,'apps/api/dist/templates/copy-catalog.js')],{cwd:L.MAIN_ROOT,windowsHide:true});
const detail={commit,typescript:ts.version,compiledFiles:count,lockfileIdentical:true,root:L.MAIN_ROOT,method:'TypeScript ES2022 isolatedModules compilation; original package exports, migrations and template assets; external dependencies resolved read-only from this worktree by loader; no dependency directories or links created'};
fs.writeFileSync(path.join(L.OUT,'baseline-build.log.txt'),L.redact(JSON.stringify(detail,null,2))+'\n');
console.log(L.redact(JSON.stringify(detail)));
